/**
 * trace-waterfall-element.ts — `<sh-trace-waterfall>`: one trace as a waterfall (la Lente, 2026-10-25).
 *
 * Input is the neutral span array (`NeutralSpan`, trace-spans.ts); it does not know whether the spans came from the
 * `perf` ledger, a `GARDEN_OTEL_FILE`, or later Jaeger. Two views of the same tree:
 *   - waterfall: a row per span, indented by depth, a bar at `startOffsetMs` for `durationMs`; the bar's dark part is
 *     the span's SELF time (duration minus its children), so "where did the time go" is the dark ink;
 *   - icicle: the same tree as stacked depth rows over the shared time axis (a time-ordered flame graph).
 * Collapse and expand per span; hover or focus a row for start, duration, self time, fsyncs and the trimmed attributes.
 *
 * fsync marks: the ledger records the COUNT of fsyncs per span, not when each happened, so a span with fsyncs wears a
 * count badge and a tick on its bar's trailing edge: the position is not claimed.
 *
 * Privacy: renders names, numbers and the trimmed attributes only. Tokens only (`--mn-*`), light and dark follow the
 * theme tokens. All visible copy goes through `t()`.
 */
import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  buildSpanTree,
  defaultCollapsed,
  expandableIds,
  flattenVisible,
  formatMs,
  slowestPathIds,
  topSelfTime,
  type NeutralSpan,
  type SpanForest,
  type SpanNode,
} from './trace-spans.js'

/** Rows drawn at once; a 1,000-span trace stays cheap and the rest is one click away. */
export const ROW_PAGE = 400

export type TraceWaterfallMode = 'waterfall' | 'icicle'

/** Bar geometry in percent of the trace, with a floor so a 0.01 ms span is still a visible sliver. */
export function barGeometry(node: SpanNode, totalMs: number): { readonly leftPct: number; readonly widthPct: number } {
  const total = totalMs > 0 ? totalMs : 1
  const leftPct = Math.min(100, Math.max(0, (node.span.startOffsetMs / total) * 100))
  const widthPct = Math.min(100 - leftPct, Math.max(0.3, (node.span.durationMs / total) * 100))
  return { leftPct, widthPct }
}

/** Axis ticks at 0, 25, 50, 75, 100 % of the trace. */
export function axisTicks(totalMs: number): { readonly pct: number; readonly label: string }[] {
  return [0, 25, 50, 75, 100].map((pct) => ({ pct, label: formatMs((totalMs * pct) / 100) }))
}

@customElement('sh-trace-waterfall')
export class ShTraceWaterfall extends LitElement {
  protected readonly _locale = new LocaleController(this)

  /** The spans to draw. Setting a new array rebuilds the tree and clears the collapse state. */
  @property({ attribute: false }) spans: readonly NeutralSpan[] = []
  /** A short heading, e.g. the case id and the call's wall time. Plain text, never document content. */
  @property({ type: String }) heading = ''
  @property({ type: String }) mode: TraceWaterfallMode = 'waterfall'

  @state() private collapsed: ReadonlySet<string> = new Set()
  @state() private active: string | null = null
  /** Show only the slowest path (root to leaf). */
  @state() private pathOnly = false
  /** Rendered-row cap for huge traces; "show more" raises it. */
  @state() private rowLimit = ROW_PAGE

  private forestCache: { readonly source: readonly NeutralSpan[]; readonly forest: SpanForest } | null = null

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.45 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .frame {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
    }
    h3 {
      margin: 0;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
      color: var(--mn-color-text-title, var(--mn-color-text-primary));
    }
    .summary {
      color: var(--mn-color-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .note {
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-xs, 12px);
    }
    .controls {
      display: inline-flex;
      gap: var(--mn-space-1, 4px);
      margin-inline-start: auto;
    }
    button {
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-base);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-sm, 4px);
      padding: 2px 8px;
      cursor: pointer;
    }
    button:hover {
      background: var(--mn-color-surface-hover);
    }
    button[aria-pressed='true'] {
      color: var(--mn-color-on-accent, var(--mn-color-text-inverse));
      background: var(--mn-color-accent);
      border-color: var(--mn-color-accent);
    }
    button:focus-visible,
    .row:focus-visible,
    .cell:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 1px;
    }
    .more {
      margin: var(--mn-space-2, 8px);
      align-self: flex-start;
    }
    .empty {
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary);
      font-style: italic;
    }
    .axis,
    .row {
      display: grid;
      grid-template-columns: minmax(180px, 38%) 1fr;
      align-items: center;
    }
    .axis {
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-2xs, 11px);
      font-variant-numeric: tabular-nums;
    }
    .ticks {
      position: relative;
      height: 16px;
    }
    .tick {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .tick:first-child {
      transform: none;
    }
    .tick:last-child {
      transform: translateX(-100%);
    }
    .rows {
      display: flex;
      flex-direction: column;
      max-height: 560px;
      overflow: auto;
    }
    .row {
      min-height: 22px;
      border-top: 1px solid var(--mn-chart-grid, var(--mn-color-border-subtle));
      cursor: default;
    }
    .row:hover,
    .row[data-active='true'] {
      background: var(--mn-color-surface-hover);
    }
    .label {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      min-width: 0;
      padding-inline-end: var(--mn-space-2, 8px);
    }
    .caret {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-tertiary);
      line-height: 1;
    }
    .caret-spacer {
      flex: 0 0 auto;
      width: 16px;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
    .tag {
      flex: 0 0 auto;
      font-size: var(--mn-text-2xs, 11px);
      padding: 0 6px;
      border-radius: var(--mn-radius-full, 9999px);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-sunken);
      border: 1px solid var(--mn-color-border-subtle);
    }
    .tag[data-kind='fsync'] {
      color: var(--mn-color-warning-strong, var(--mn-color-text-secondary));
      border-color: var(--mn-chart-status-warning, var(--mn-color-border-default));
    }
    .track {
      position: relative;
      height: 16px;
      background: linear-gradient(to right, var(--mn-chart-grid, var(--mn-color-border-subtle)) 1px, transparent 1px) 0 0 / 25% 100%;
    }
    .bar {
      position: absolute;
      top: 2px;
      bottom: 2px;
      min-width: 2px;
      box-sizing: border-box;
      border-radius: 2px;
      background: color-mix(in srgb, var(--mn-chart-categorical-1) 28%, var(--mn-color-surface-base));
      border: 1px solid var(--mn-chart-categorical-1);
      overflow: hidden;
    }
    .bar[data-orphan='true'] {
      border-style: dashed;
    }
    .self {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--mn-chart-categorical-1);
    }
    .fsync-tick {
      position: absolute;
      top: 0;
      bottom: 0;
      inset-inline-end: 0;
      width: 3px;
      background: var(--mn-chart-status-warning, var(--mn-color-warning, currentColor));
    }
    .dur {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      padding-inline-start: 4px;
      font-size: var(--mn-text-2xs, 11px);
      font-variant-numeric: tabular-nums;
      color: var(--mn-color-text-secondary);
      white-space: nowrap;
      pointer-events: none;
    }
    .detail {
      min-height: 56px;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      background: var(--mn-color-surface-sunken);
      border-radius: var(--mn-radius-sm, 4px);
      font-size: var(--mn-text-xs, 12px);
    }
    .detail dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 2px var(--mn-space-3, 12px);
      margin: var(--mn-space-1, 4px) 0 0;
    }
    .detail dt {
      color: var(--mn-color-text-tertiary);
    }
    .detail dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .detail .mono {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .hint {
      color: var(--mn-color-text-tertiary);
    }
    .selftop {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 2px;
      font-size: var(--mn-text-xs, 12px);
    }
    .selftop li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--mn-space-3, 12px);
      font-variant-numeric: tabular-nums;
    }
    .selftop .nm {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .ice {
      position: relative;
    }
    .ice-row {
      position: relative;
      height: 20px;
      border-top: 1px solid var(--mn-chart-grid, var(--mn-color-border-subtle));
    }
    .cell {
      position: absolute;
      top: 1px;
      bottom: 1px;
      min-width: 2px;
      box-sizing: border-box;
      overflow: hidden;
      padding: 0 3px;
      border: 1px solid var(--mn-chart-categorical-1);
      border-radius: 2px;
      background: color-mix(in srgb, var(--mn-chart-categorical-1) calc(var(--share, 0) * 100%), var(--mn-color-surface-base));
      color: var(--mn-color-text-primary);
      font-size: var(--mn-text-2xs, 11px);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .cell[data-active='true'] {
      outline: 2px solid var(--mn-color-accent);
    }
  `

  /** The tree for the current `spans`, rebuilt only when the array identity changes. */
  private get forest(): SpanForest {
    if (!this.forestCache || this.forestCache.source !== this.spans) {
      this.forestCache = { source: this.spans, forest: buildSpanTree(this.spans) }
    }
    return this.forestCache.forest
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('spans')) {
      this.collapsed = defaultCollapsed(this.forest)
      this.active = null
      this.rowLimit = ROW_PAGE
      this.pathOnly = false
    }
  }

  private toggle(spanId: string): void {
    const next = new Set(this.collapsed)
    if (next.has(spanId)) next.delete(spanId)
    else next.add(spanId)
    this.collapsed = next
  }

  private expandAll(): void {
    this.collapsed = new Set()
    this.rowLimit = ROW_PAGE
  }

  private collapseAll(): void {
    this.collapsed = new Set(expandableIds(this.forest))
  }

  private renderSummary(forest: SpanForest): TemplateResult {
    const fsyncs = [...forest.byId.values()].reduce((sum, n) => sum + n.span.fsyncs, 0)
    return html`
      <span class="summary">${t('trace.summary', { spans: forest.spanCount, ms: formatMs(forest.totalMs), fsyncs })}</span>
      ${forest.orphanCount > 0 ? html`<span class="note">${t('trace.orphans', { count: forest.orphanCount })}</span>` : nothing}
      ${forest.duplicateCount > 0 ? html`<span class="note">${t('trace.duplicates', { count: forest.duplicateCount })}</span>` : nothing}
    `
  }

  private renderDetail(forest: SpanForest): TemplateResult {
    const node = this.active ? forest.byId.get(this.active) : undefined
    if (!node) return html`<div class="detail"><span class="hint">${t('trace.hoverHint')}</span></div>`
    const span = node.span
    const attrs = Object.entries(span.attrs)
    return html`
      <div class="detail" aria-live="polite">
        <strong class="mono">${span.name}</strong>
        <dl>
          <dt>${t('trace.start')}</dt><dd>${formatMs(span.startOffsetMs)}</dd>
          <dt>${t('trace.duration')}</dt><dd>${formatMs(span.durationMs)}</dd>
          <dt>${t('trace.selfTime')}</dt><dd>${formatMs(node.selfMs)}</dd>
          <dt>${t('trace.fsyncsLabel')}</dt><dd>${span.fsyncs}</dd>
          <dt>${t('trace.spanId')}</dt><dd class="mono">${span.spanId}</dd>
          ${attrs.length === 0
            ? html`<dt>${t('trace.attributes')}</dt><dd class="hint">${t('trace.noAttrs')}</dd>`
            : attrs.map(([key, value]) => html`<dt class="mono">${key}</dt><dd class="mono">${String(value)}</dd>`)}
        </dl>
      </div>
    `
  }

  private rowTitle(node: SpanNode): string {
    return `${node.span.name}: ${formatMs(node.span.durationMs)} (${t('trace.selfTime')} ${formatMs(node.selfMs)})`
  }

  private renderWaterfall(forest: SpanForest): TemplateResult {
    const pathIds = this.pathOnly ? new Set(slowestPathIds(forest)) : null
    const visible = pathIds ? flattenVisible(forest, new Set()).filter((n) => pathIds.has(n.span.spanId)) : flattenVisible(forest, this.collapsed)
    const rows = visible.slice(0, this.rowLimit)
    const expandable = pathIds ? new Set<string>() : expandableIds(forest)
    return html`
      <div class="axis" aria-hidden="true">
        <span></span>
        <div class="ticks">
          ${axisTicks(forest.totalMs).map((tick) => html`<span class="tick" style="left:${tick.pct}%">${tick.label}</span>`)}
        </div>
      </div>
      <div class="rows" role="tree" aria-label=${this.heading || t('trace.title')}>
        ${rows.map((node) => {
          const { leftPct, widthPct } = barGeometry(node, forest.totalMs)
          const isOpen = !this.collapsed.has(node.span.spanId)
          const hasKids = expandable.has(node.span.spanId)
          const selfPct = node.span.durationMs > 0 ? Math.min(100, (node.selfMs / node.span.durationMs) * 100) : 100
          const labelRight = leftPct + widthPct < 82
          return html`
            <div
              class="row"
              role="treeitem"
              aria-level=${node.depth + 1}
              aria-expanded=${hasKids ? String(isOpen) : nothing}
              tabindex="0"
              title=${this.rowTitle(node)}
              data-active=${String(this.active === node.span.spanId)}
              data-span-id=${node.span.spanId}
              @mouseenter=${() => { this.active = node.span.spanId }}
              @focus=${() => { this.active = node.span.spanId }}
            >
              <div class="label" style="padding-inline-start:${node.depth * 14}px">
                ${hasKids
                  ? html`<button
                      class="caret"
                      type="button"
                      aria-label=${isOpen ? t('trace.collapse', { name: node.span.name }) : t('trace.expand', { name: node.span.name })}
                      @click=${(event: Event) => { event.stopPropagation(); this.toggle(node.span.spanId) }}
                    >${isOpen ? '▾' : '▸'}</button>`
                  : html`<span class="caret-spacer"></span>`}
                <span class="name">${node.span.name}</span>
                ${node.orphan ? html`<span class="tag">${t('trace.orphanTag')}</span>` : nothing}
                ${node.span.fsyncs > 0 ? html`<span class="tag" data-kind="fsync">${t('trace.fsyncs', { count: node.span.fsyncs })}</span>` : nothing}
              </div>
              <div class="track">
                <div class="bar" data-orphan=${String(node.orphan)} style="left:${leftPct}%;width:${widthPct}%">
                  <div class="self" style="width:${selfPct}%"></div>
                  ${node.span.fsyncs > 0 ? html`<div class="fsync-tick"></div>` : nothing}
                </div>
                <span class="dur" style=${labelRight ? `left:${leftPct + widthPct}%` : `right:${100 - leftPct}%;padding-inline-end:4px`}>${formatMs(node.span.durationMs)}</span>
              </div>
            </div>
          `
        })}
        ${visible.length > rows.length
          ? html`<button type="button" class="more" @click=${() => { this.rowLimit += ROW_PAGE }}>${t('trace.showMore', { shown: rows.length, total: visible.length })}</button>`
          : nothing}
      </div>
    `
  }

  private renderIcicle(forest: SpanForest): TemplateResult {
    const byDepth = new Map<number, SpanNode[]>()
    for (const node of forest.byId.values()) {
      const list = byDepth.get(node.depth) ?? []
      list.push(node)
      byDepth.set(node.depth, list)
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b)
    const total = forest.totalMs > 0 ? forest.totalMs : 1
    return html`
      <div class="axis" aria-hidden="true">
        <span></span>
        <div class="ticks">${axisTicks(forest.totalMs).map((tick) => html`<span class="tick" style="left:${tick.pct}%">${tick.label}</span>`)}</div>
      </div>
      <div class="ice rows">
        ${depths.map((depth) => html`
          <div class="ice-row">
            ${(byDepth.get(depth) ?? []).filter((n) => barGeometry(n, forest.totalMs).widthPct >= 0.15).map((node) => {
              const { leftPct, widthPct } = barGeometry(node, forest.totalMs)
              const share = Math.min(1, node.selfMs / total)
              return html`
                <div
                  class="cell"
                  tabindex="0"
                  title=${this.rowTitle(node)}
                  data-active=${String(this.active === node.span.spanId)}
                  data-span-id=${node.span.spanId}
                  style="left:${leftPct}%;width:${widthPct}%;--share:${Math.max(0.08, Math.min(0.95, share * 4))}"
                  @mouseenter=${() => { this.active = node.span.spanId }}
                  @focus=${() => { this.active = node.span.spanId }}
                >${widthPct > 6 ? node.span.name : ''}</div>
              `
            })}
          </div>
        `)}
      </div>
    `
  }

  private renderSelfTop(forest: SpanForest): TemplateResult | typeof nothing {
    const rows = topSelfTime(forest, 6)
    if (rows.length === 0) return nothing
    return html`
      <div>
        <div class="note">${t('trace.topSelf')}</div>
        <ul class="selftop">
          ${rows.map((row) => html`<li><span class="nm">${row.name}</span><span>${formatMs(row.selfMsTotal)}</span><span class="hint">×${row.n}</span></li>`)}
        </ul>
      </div>
    `
  }

  protected render(): TemplateResult {
    const forest = this.forest
    return html`
      <section class="frame" aria-label=${this.heading || t('trace.title')}>
        <header>
          <h3>${this.heading || t('trace.title')}</h3>
          ${forest.spanCount > 0 ? this.renderSummary(forest) : nothing}
          ${forest.spanCount > 0
            ? html`<span class="controls">
                <button type="button" aria-pressed=${String(this.mode === 'waterfall')} @click=${() => { this.mode = 'waterfall' }}>${t('trace.waterfall')}</button>
                <button type="button" aria-pressed=${String(this.mode === 'icicle')} @click=${() => { this.mode = 'icicle' }}>${t('trace.icicle')}</button>
                <button type="button" aria-pressed=${String(this.pathOnly)} @click=${() => { this.pathOnly = !this.pathOnly }}>${t('trace.slowestPath')}</button>
                ${this.mode === 'waterfall' && !this.pathOnly
                  ? html`<button type="button" @click=${() => this.expandAll()}>${t('trace.expandAll')}</button>
                         <button type="button" @click=${() => this.collapseAll()}>${t('trace.collapseAll')}</button>`
                  : nothing}
              </span>`
            : nothing}
        </header>
        ${forest.spanCount === 0
          ? html`<div class="empty">${t('trace.empty')}</div>`
          : html`${this.mode === 'icicle' ? this.renderIcicle(forest) : this.renderWaterfall(forest)}${this.renderDetail(forest)}${this.renderSelfTop(forest)}`}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-trace-waterfall': ShTraceWaterfall
  }
}
