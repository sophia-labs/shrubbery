import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { usageExplorerNote } from './billing-copy.js'
import { splitUsageTotals, usageCsv, usageMoney, type UsageCoverage, type UsageEvent, type UsageReader } from './usage-explorer.js'
const labels: Record<string, string> = { id: 'Event ID', source: 'Source', ts: 'Time coordinate (ms)', recordedAt: 'Recorded time', timezone: 'Timezone', provider: 'Provider', model: 'Model', status: 'Status', surface: 'Surface', graphId: 'Graph', sessionId: 'Session', fundingSource: 'Funding source', inputTokens: 'Input tokens', outputTokens: 'Output tokens', cacheReadTokens: 'Cache read tokens', cacheWriteTokens: 'Cache write tokens', totalTokens: 'Total tokens', costMicroUsd: 'Recorded cost', providerCostMicroUsd: 'Provider cost', providerReportedCostMicroUsd: 'Provider reported cost', markupMicroUsd: 'Markup' }
const day = (ts: number): string => new Date(ts).toISOString().slice(0, 10)
const number = (n: number | null): string => n === null ? '—' : n.toLocaleString(localeSource.get())
@customElement('mn-usage-explorer')
export class UsageExplorerView extends LitElement {
  protected readonly _locale = new LocaleController(this)

  @property({ attribute: false }) reader: UsageReader | null = null
  /** The service fee the backend charges, in percent; null while it names none (the note then says it without a number). */
  @property({ attribute: false }) feePercent: number | null = null
  @state() private rows: UsageEvent[] = []
  @state() private coverage: UsageCoverage[] = []
  @state() private cursor: string | null = null
  @state() private loading = false
  @state() private loaded = false
  @state() private error = ''
  @state() private from = ''
  @state() private to = ''
  @state() private provider = ''
  @state() private model = ''
  @state() private source = ''
  @state() private query = ''
  @state() private sort = 'newest'
  @state() private page = 0
  @state() private selected: UsageEvent | null = null
  private generation = 0
  static styles = css`
    :host{display:block;color:var(--mn-color-text-primary,#20252b);font:13px/1.5 var(--mn-font-sans,system-ui)}
    .bar,.filters,.totals{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:0 0 16px}.bar{justify-content:space-between}.filters{align-items:end}
    label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--mn-color-text-secondary,#667)}
    input,select,button{font:inherit;color:var(--mn-color-text-primary,#20252b);border:1px solid var(--mn-color-border-default,#ccc);background:var(--mn-color-surface-base,#fff);border-radius:4px;padding:6px 8px;max-width:100%;box-sizing:border-box}
    button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:var(--mn-color-surface-hover,#eee)}input[type=search]{min-width:220px}
    .muted{color:var(--mn-color-text-secondary,#667);font-size:12px}.totals{padding:12px 0;border-block:1px solid var(--mn-color-border-default,#ddd);gap:28px}.totals strong{display:block;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.chart{display:flex;height:90px;align-items:end;gap:2px;border-bottom:1px solid var(--mn-color-border-default,#ddd)}.chart button{flex:1;min-width:2px;padding:0;border:0;border-radius:2px 2px 0 0;background:var(--mn-color-accent-primary,#6475bc)}
    h3{font:600 12px var(--mn-font-sans,system-ui);margin:0 0 12px}.group{display:grid;grid-template-columns:1fr auto;gap:8px;padding:4px 0;border-bottom:1px solid var(--mn-color-border-default,#eee)}.group button{text-align:left;border:0;padding:0;background:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .table{overflow:auto;border:1px solid var(--mn-color-border-default,#ddd);border-radius:4px}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;font-variant-numeric:tabular-nums}th{font-weight:500;color:var(--mn-color-text-secondary,#667);white-space:nowrap}th,td{padding:8px 10px;border-bottom:1px solid var(--mn-color-border-default,#eee)}td.numeric{text-align:right;white-space:nowrap}td:first-child{white-space:nowrap}tr:hover td{background:var(--mn-color-surface-hover,#f6f6f6)}td button{border:0;background:none;padding:0;text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .details{margin:16px 0;border:1px solid var(--mn-color-border-default,#ddd);padding:16px;overflow-wrap:anywhere}.details dl{display:grid;grid-template-columns:minmax(140px,1fr) 2fr;gap:6px}.details dt{color:var(--mn-color-text-secondary,#667)}.details dd{margin:0}.error{color:var(--mn-color-text-danger,#b22)}.coverage{margin-top:24px;padding-top:12px;border-top:1px solid var(--mn-color-border-default,#ddd)}
    @media(max-width:700px){.charts{grid-template-columns:1fr}.filters label{flex:1;min-width:130px}.totals{gap:16px}input[type=search]{min-width:0;width:100%}}
  `
  protected override updated(changed: PropertyValues): void { if (changed.has('reader')) void this.load(true) }
  override disconnectedCallback(): void { this.generation++; super.disconnectedCallback() }
  private async load(reset = false): Promise<void> {
    const reader = this.reader
    if (!reader) return
    const generation = ++this.generation
    if (reset) { this.rows = []; this.coverage = []; this.cursor = null; this.loaded = false; this.page = 0; this.selected = null }
    this.loading = true; this.error = ''
    const seen = new Set(this.rows.map(r => r.id)), cursors = new Set<string>()
    try {
      // Bounded batches, with an explicit continuation for very large accounts.
      for (let i = 0; i < 25; i++) {
        const page = await reader.page(this.cursor ?? undefined)
        if (generation !== this.generation || !this.isConnected) return
        if (page.items.some(r => seen.has(r.id)) || new Set(page.items.map(r => r.id)).size !== page.items.length || (page.nextCursor && cursors.has(page.nextCursor))) throw new Error('Usage pagination changed. Refresh to reload.')
        page.items.forEach(r => seen.add(r.id)); if (page.nextCursor) cursors.add(page.nextCursor)
        this.rows = [...this.rows, ...page.items]; this.cursor = page.nextCursor; this.coverage = page.coverage; this.loaded = true
        if (!this.cursor) break
      }
    } catch (error) { if (generation === this.generation) this.error = error instanceof Error ? error.message : 'Usage history could not be loaded.' }
    finally { if (generation === this.generation) this.loading = false }
  }
  private filtered(): UsageEvent[] {
    const start = this.from ? Date.parse(this.from + 'T00:00:00Z') : 0, end = this.to ? Date.parse(this.to + 'T00:00:00Z') + 86400000 : Infinity
    const query = this.query.toLocaleLowerCase()
    return this.rows.filter(r => r.ts >= start && r.ts < end && (!this.provider || r.provider === this.provider) && (!this.model || r.model === this.model) && (!this.source || r.source === this.source) && `${r.model} ${r.provider} ${r.graphId ?? ''} ${r.status} ${r.surface ?? ''} ${r.id}`.toLocaleLowerCase().includes(query)).sort((a,b) => this.sort === 'cost' ? b.costMicroUsd - a.costMicroUsd || b.ts - a.ts : this.sort === 'oldest' ? a.ts - b.ts : b.ts - a.ts)
  }
  private change(set: () => void): void { set(); this.page = 0; this.selected = null }
  private preset(days: number): void { this.change(() => { this.from = days ? day(Date.now() - days * 86400000) : ''; this.to = '' }) }
  private export(rows: UsageEvent[]): void {
    const url = URL.createObjectURL(new Blob([usageCsv(rows)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'sophia-usage.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  override render() {
    const rows = this.filtered(), complete = this.loaded && !this.cursor && !this.loading && !this.error
    const cost = rows.reduce((n,r) => n + r.costMicroUsd, 0), input = rows.reduce((n,r) => n + (r.inputTokens ?? 0), 0), output = rows.reduce((n,r) => n + (r.outputTokens ?? 0), 0)
    const days = new Map<string, number>(), models = new Map<string, number>()
    for (const r of rows) { const d = day(r.ts); days.set(d, (days.get(d) ?? 0) + r.costMicroUsd); models.set(r.model, (models.get(r.model) ?? 0) + r.costMicroUsd) }
    const split = splitUsageTotals(rows)
    const daily = [...days].sort(([a],[b]) => a.localeCompare(b)), max = Math.max(1,...days.values())
    const groups = [...models].sort((a,b) => b[1] - a[1]).slice(0,5)
    const page = Math.min(this.page, Math.max(0, Math.ceil(rows.length / 50) - 1))
    const choice = (value: string, values: string[], title: string, change: (s: string) => void) => html`<label>${title}<select .value=${value} @change=${(e: Event) => this.change(() => change((e.target as HTMLSelectElement).value))}><option value="">${t('All')}</option>${values.map(v => html`<option value=${v}>${v}</option>`)}</select></label>`
    return html`<div class="explorer">
      <div class="bar"><span class="muted">Recorded inference usage · USD · ${complete ? 'all retained events loaded' : this.loading ? `loading · ${number(this.rows.length)} events` : 'partial coverage'}</span><span><button ?disabled=${this.loading} @click=${() => void this.load(true)}>${t('Refresh')}</button> <button ?disabled=${!rows.length || this.loading} @click=${() => this.export(rows)}>Export ${complete ? '' : 'loaded '}CSV</button></span></div>
      <div class="filters"><button @click=${() => this.preset(0)}>${t('All history')}</button><button @click=${() => this.preset(30)}>${t('30 days')}</button><button @click=${() => this.preset(7)}>${t('7 days')}</button>
        <label>${t('From (UTC)')}<input type="date" .value=${this.from} @change=${(e: Event) => this.change(() => { this.from = (e.target as HTMLInputElement).value })}></label><label>${t('Through (UTC)')}<input type="date" .value=${this.to} @change=${(e: Event) => this.change(() => { this.to = (e.target as HTMLInputElement).value })}></label>
        ${choice(this.source, ['sirin','cloud-1'], t('Source'), v => { this.source = v })}${choice(this.provider, [...new Set(this.rows.map(r => r.provider))].sort(), t('Provider'), v => { this.provider = v })}${choice(this.model, [...new Set(this.rows.map(r => r.model))].sort(), t('Model'), v => { this.model = v })}
        <label>${t('Search events')}<input type="search" placeholder=${t('Model, graph, status, event…')} .value=${this.query} @input=${(e: Event) => this.change(() => { this.query = (e.target as HTMLInputElement).value })}></label>
      </div>
      ${this.error ? html`<p class="error" role="alert">${this.error} Retained rows below may be incomplete.</p>` : nothing}
      <div class="totals"><div><span class="muted">${complete ? 'Filtered' : t('Loaded filtered')} cost</span><strong>${this.loaded ? usageMoney(cost) : '—'}</strong></div><div data-usage-split="deducted"><span class="muted">${t('Deducted from credits')}</span><strong>${this.loaded ? usageMoney(split.deducted.costMicroUsd) : '—'}</strong></div><div data-usage-split="ownKey"><span class="muted">${t('Paid with your own key')}</span><strong>${this.loaded ? usageMoney(split.ownKey.costMicroUsd) : '—'}</strong></div><div data-usage-split="imported"><span class="muted">${t('Imported, not deducted here')}</span><strong>${this.loaded ? usageMoney(split.imported.costMicroUsd) : '—'}</strong></div><div><span class="muted">${t('Events')}</span><strong>${this.loaded ? number(rows.length) : '—'}</strong></div><div><span class="muted">${t('Recorded input / output tokens')}</span><strong>${this.loaded ? number(input) + ' / ' + number(output) : '—'}</strong></div></div>
      <p class="muted" data-usage-note>${usageExplorerNote(this.feePercent)}</p>
      ${rows.length ? html`<div class="charts"><section><h3>${t('Cost per active day · click to filter')}</h3><div class="chart">${daily.map(([date,value]) => html`<button style=${`height:${Math.max(2, value/max*100)}%`} title=${`${date}: ${usageMoney(value)}`} aria-label=${`${date}: ${usageMoney(value)}`} @click=${() => this.change(() => { this.from = date; this.to = date })}></button>`)}</div><div class="bar muted"><span>${daily[0]?.[0]}</span><span>${daily.at(-1)?.[0]}</span></div></section><section><h3>${t('Top models by cost · click to filter')}</h3>${groups.map(([model,value]) => html`<div class="group"><button title=${model} @click=${() => this.change(() => { this.model = model })}>${model}</button><span>${usageMoney(value)}</span></div>`)}</section></div>` : nothing}
      <div class="bar"><span class="muted">${rows.length ? `${page*50+1}–${Math.min((page+1)*50,rows.length)} of ${number(rows.length)} events` : this.loaded ? 'No events match these filters.' : 'Loading events…'}</span><label>${t('Sort')}<select .value=${this.sort} @change=${(e: Event) => this.change(() => { this.sort = (e.target as HTMLSelectElement).value })}><option value="newest">${t('Newest first')}</option><option value="oldest">${t('Oldest first')}</option><option value="cost">${t('Highest cost')}</option></select></label></div>
      <div class="table"><table><thead><tr><th>${t('Recorded time')}</th><th>${t('Model / provider')}</th><th>${t('Tokens in / out')}</th><th>${t('Cost')}</th><th>${t('Source / status')}</th></tr></thead><tbody>${rows.slice(page*50,(page+1)*50).map(r => html`<tr><td><button @click=${() => { this.selected = r }}>${r.recordedAt.replace('T',' ').replace('Z',' UTC')}${r.timezone === 'unspecified' ? ' *' : ''}</button></td><td><button title=${r.model} @click=${() => { this.selected = r }}>${r.model}</button><div class="muted">${r.provider}</div></td><td class="numeric">${number(r.inputTokens)} / ${number(r.outputTokens)}</td><td class="numeric">${usageMoney(r.costMicroUsd)}</td><td>${r.source}<div class="muted">${r.status}</div></td></tr>`)}</tbody></table></div>
      <div class="bar"><span><button ?disabled=${page === 0} @click=${() => { this.page = page-1 }}>${t('Previous')}</button> <button ?disabled=${(page+1)*50 >= rows.length} @click=${() => { this.page = page+1 }}>${t('Next')}</button></span>${this.cursor ? html`<button ?disabled=${this.loading} @click=${() => void this.load()}>${t('Load remaining history')}</button>` : nothing}</div>
      ${this.selected ? html`<section class="details"><div class="bar"><strong>${t('Usage event')}</strong><button @click=${() => { this.selected = null }}>${t('Close details')}</button></div><dl>${Object.entries(this.selected).map(([key,value]) => html`<dt>${labels[key] ?? key}</dt><dd>${key.endsWith('MicroUsd') ? usageMoney(value as number | null) : value === null ? t('Unknown / not recorded') : String(value)}</dd>`)}</dl></section>` : nothing}
      <section class="coverage"><h3>${t('History coverage')}</h3>${this.coverage.map(c => html`<div class="group"><span>${c.source} · ${number(c.eventCount)} retained ${c.eventCount === 1 ? 'event' : 'events'}${c.firstTs !== null ? ` · ${day(c.firstTs)} – ${day(c.lastTs!)}` : ''}</span><span>${c.state === 'not-imported' ? 'History not imported' : c.capturedAt ? `Snapshot ${c.capturedAt}` : 'Recorded Sirin events'}</span></div>`)}<p class="muted">* Legacy timestamps without a timezone preserve the recorded calendar date; their timezone is unknown. Coverage reflects retained ledger records, not a guarantee that every historical request was metered.</p></section>
    </div>`
  }
}
