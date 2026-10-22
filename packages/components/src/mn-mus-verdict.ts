/**
 * mn-mus-verdict — the face beside Hoja's MUS mode: what the checker said, and the render.
 *
 * WHAT IT SHOWS.
 *   - The verdict: clean (and which Ariadne Worlds will play it), or each diagnostic (severity, where: bar, hand,
 *     token; the engine's message). Clicking one asks the host to show it in the score (`mn-mus-reveal`).
 *   - RENDER: enabled only while the verdict is clean and about the text on screen. It runs the host's `renderer`
 *     (the engine in a Worker) with a progress bar and a Cancel, then plays the take (`player`, default
 *     `<mn-mus-take-player>`) and shows the receipt as stated: the WAV's digest, the World's touch counts, and its
 *     ledger, each number with its unit. Ledger values are in the World's own energy units (eu; SPEC-FIELD's
 *     normalized energy unit, not calibrated to joules), printed to four significant figures with the exact value on
 *     hover; residuals are printed as numbers, never as "balanced".
 *
 * BACKEND-FREE. The verdict comes in as data (`report`, plus `current`, `checking`, `sourceError`); the render is a
 * function the host passes (`renderer`); the face reaches no store and imports no engine. Ariadne only is the engine's
 * rule: a score with any other track is refused there and arrives here as an error diagnostic, so RENDER stays off.
 *
 * Events (bubbling, composed): `mn-mus-reveal` {diagnostic}, `mn-mus-render-start`, `mn-mus-take` {take},
 * `mn-mus-render-error` {message}.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'
import { SkinAware } from './skin-aware.js'
import './mn-mus-take-player.js'
import { formatClock, type MnMusTakeLike } from './mn-mus-take-player.js'

/** The parts of `MusCheckReport` (`@shrubbery/hoja/mus`) this face reads. */
export interface MnMusDiagnostic {
  readonly severity: 'error' | 'warning' | 'info'
  readonly code: string
  readonly message: string
  readonly anchor: { readonly kind: string; readonly bar?: number; readonly track?: string; readonly token?: string; readonly abbrev?: string; readonly key?: string }
  readonly span?: { readonly from: number; readonly to: number; readonly line: number }
}

export interface MnMusReport {
  readonly clean: boolean
  readonly score?: { readonly title?: string; readonly bars?: number | null; readonly durationSeconds?: number | null }
  readonly worlds?: readonly { readonly abbrev: string; readonly anatomy: string; readonly hands: readonly { readonly abbrev: string }[] }[]
  readonly diagnostics: readonly MnMusDiagnostic[]
}

export interface MnMusWorldReceipt {
  readonly instrument: string
  readonly anatomy: string
  readonly plucks: number
  readonly hammerOns: number
  readonly pullOffs: number
  readonly slides: number
  readonly simulatedSeconds?: number
  readonly sourceWork: number
  readonly controlWork: number
  readonly internalLoss: number
  readonly radiation: number
  readonly cumulativeClosureResidual: number
  readonly maximumFrameResidual: number
}

export interface MnMusTake extends MnMusTakeLike {
  readonly receipt: {
    readonly renderDigest: string
    readonly durationSeconds: number
    readonly peakDbfs: number
    readonly rmsDbfs: number
    readonly wallSeconds: number
    readonly badTokens?: readonly string[]
    readonly ariadneWorlds?: readonly MnMusWorldReceipt[]
  }
}

export interface MnMusRenderProgress {
  readonly done: number
  readonly total: number
  readonly fraction: number
  readonly elapsedSeconds: number
}

export type MnMusRenderer = (options: { readonly signal: AbortSignal; readonly onProgress: (p: MnMusRenderProgress) => void }) => Promise<MnMusTake>
export type MnMusPlayerFactory = (take: MnMusTake) => TemplateResult | HTMLElement

type RenderState = 'idle' | 'rendering' | 'done' | 'error'

/** Four significant figures, the exponent as ×10ⁿ for small and large magnitudes. */
export function formatEnergy(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e-3 && abs < 1e4) return value.toPrecision(4)
  const [m, e] = value.toExponential(3).split('e')
  const sup = String(Number(e)).replace(/[-0-9]/g, c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]!)
  return `${m} × 10${sup}`
}

function count(n: number, one: string): TemplateResult {
  return html`<span class="count"><span class="num">${n}</span> ${n === 1 ? one : `${one}s`}</span>`
}

function where(d: MnMusDiagnostic): string {
  const a = d.anchor
  if (a.kind === 'event') return `bar ${a.bar} · ${a.track}${a.token ? ` · ${a.token}` : ''}`
  if (a.kind === 'instrument') return `instrument ${a.abbrev}`
  if (a.kind === 'header') return `# ${a.key}:`
  return 'score'
}

const LEDGER: ReadonlyArray<{ key: keyof MnMusWorldReceipt; label: string }> = [
  { key: 'sourceWork', label: 'Source work (the hands)' },
  { key: 'controlWork', label: 'Control work (the fretting hand)' },
  { key: 'internalLoss', label: 'Internal loss' },
  { key: 'radiation', label: 'Radiation' },
  { key: 'cumulativeClosureResidual', label: 'Closure residual' },
  { key: 'maximumFrameResidual', label: 'Largest frame residual' },
]

@customElement('mn-mus-verdict')
export class MnMusVerdict extends SkinAware(LitElement) {
  static styles = css`
    :host { display: block; min-width: 0; font-family: var(--mn-font-sans, system-ui, sans-serif); color: var(--mn-color-text-primary, #1d2420); font-size: 14px; line-height: 1.45; }
    section { padding: 12px 14px; border: 1px solid var(--mn-color-border-subtle, #dfe5e1); border-radius: var(--mn-radius-md, 10px); background: var(--mn-color-surface-raised, #fff); }
    section + section { margin-top: 10px; }
    h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--mn-color-text-secondary, #4d5952); }
    .status { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .status strong { font-family: var(--mn-font-serif, Literata, Georgia, serif); font-size: 16px; font-weight: 600; }
    .clean strong { color: var(--mn-color-text-success, #2f7a45); }
    .bad strong { color: var(--mn-color-text-danger, #b3261e); }
    .muted { color: var(--mn-color-text-muted, #768079); }
    ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
    li button {
      all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;
      padding: 6px 8px; border-radius: 6px; border-left: 3px solid var(--sev, #768079); background: color-mix(in srgb, var(--sev, #768079) 7%, transparent);
    }
    li button:focus-visible { outline: 2px solid var(--mn-color-border-focus, #39765a); outline-offset: 1px; }
    li.error { --sev: var(--mn-color-danger, #b3261e); }
    li.warning { --sev: var(--mn-color-warning, #9a6400); }
    li.info { --sev: var(--mn-color-text-muted, #768079); }
    .sev { font-weight: 700; color: var(--sev); font-size: 12px; text-transform: uppercase; }
    .loc { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 12px; color: var(--mn-color-text-secondary, #4d5952); overflow-wrap: anywhere; }
    .msg { grid-column: 1 / -1; overflow-wrap: anywhere; }
    .render { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .go {
      font: inherit; font-weight: 700; letter-spacing: 0.06em; padding: 8px 16px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--mn-color-accent, #39765a); background: var(--mn-color-accent, #39765a); color: var(--mn-color-text-on-accent, #fff);
    }
    .go:disabled { cursor: default; opacity: 0.45; }
    .ghost { font: inherit; padding: 6px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--mn-color-border-default, #c9d1cc); background: transparent; color: inherit; }
    .bar { flex: 1 1 160px; height: 8px; border-radius: 99px; background: var(--mn-color-surface-sunken, #eef2ef); overflow: hidden; min-width: 120px; }
    .bar > div { height: 100%; background: var(--mn-color-accent, #39765a); transition: width 120ms linear; }
    .num { font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
    .ledger { margin-top: 10px; font-size: 13px; }
    .ledger .caption { margin: 0 0 2px; color: var(--mn-color-text-muted, #768079); }
    dl { margin: 0; }
    dl .row { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px solid var(--mn-color-border-subtle, #dfe5e1); }
    dt { color: var(--mn-color-text-secondary, #4d5952); }
    dd { margin: 0; text-align: right; white-space: nowrap; }
    .unit { color: var(--mn-color-text-muted, #768079); font-size: 12px; }
    .facts { display: flex; gap: 6px 14px; flex-wrap: wrap; margin-top: 8px; font-size: 13px; }
    .digest { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 12px; overflow-wrap: anywhere; color: var(--mn-color-text-secondary, #4d5952); }
    .note { margin-top: 6px; font-size: 12px; color: var(--mn-color-text-muted, #768079); }
    .player { margin-top: 10px; }
    .err { color: var(--mn-color-text-danger, #b3261e); }
  `

  /** The newest verdict (or null before the first). */
  @property({ attribute: false }) report: MnMusReport | null = null
  /** True when `report` is about the text on screen. */
  @property({ type: Boolean }) current = false
  @property({ type: Boolean }) checking = false
  /** The page holds no single ```mus fence (or the engine could not load). */
  @property({ type: String, attribute: 'source-error' }) sourceError: string | null = null
  /** Runs the render (the host binds it to the engine and the current score). */
  @property({ attribute: false }) renderer: MnMusRenderer | null = null
  /** Swap the player: return the element (or template) that plays a take. */
  @property({ attribute: false }) player: MnMusPlayerFactory | null = null

  @state() private renderState: RenderState = 'idle'
  @state() private progress: MnMusRenderProgress | null = null
  @state() private take: MnMusTake | null = null
  @state() private renderError: string | null = null
  private abort: AbortController | null = null

  /** The last take (tests, hosts). */
  get lastTake(): MnMusTake | null {
    return this.take
  }

  get renderable(): boolean {
    return Boolean(this.renderer && this.report?.clean && this.current && !this.checking && this.renderState !== 'rendering')
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.abort?.abort()
  }

  private emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  /** Start a render (what RENDER does). */
  async startRender(): Promise<MnMusTake | null> {
    if (!this.renderable || !this.renderer) return null
    this.abort = new AbortController()
    this.renderState = 'rendering'
    this.progress = { done: 0, total: 0, fraction: 0, elapsedSeconds: 0 }
    this.renderError = null
    this.emit('mn-mus-render-start')
    try {
      const take = await this.renderer({ signal: this.abort.signal, onProgress: p => { this.progress = p } })
      this.take = take
      this.renderState = 'done'
      this.emit('mn-mus-take', { take })
      return take
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError'
      this.renderState = this.take && aborted ? 'done' : aborted ? 'idle' : 'error'
      this.renderError = aborted ? null : error instanceof Error ? error.message : String(error)
      if (!aborted) this.emit('mn-mus-render-error', { message: this.renderError })
      return null
    } finally {
      this.abort = null
    }
  }

  cancel(): void {
    this.abort?.abort()
  }

  private renderVerdict(): TemplateResult {
    if (this.sourceError) {
      return html`<div class="status bad"><strong>No score</strong><span>${this.sourceError}</span></div>`
    }
    const report = this.report
    if (!report) return html`<div class="status"><strong class="muted">${this.checking ? 'Checking…' : 'Not checked yet'}</strong></div>`
    const errors = report.diagnostics.filter(d => d.severity === 'error').length
    const warnings = report.diagnostics.filter(d => d.severity === 'warning').length
    const worlds = report.worlds ?? []
    const freshness = this.checking ? html`<span class="muted">checking…</span>` : !this.current ? html`<span class="muted">(about an earlier text)</span>` : nothing
    const head = report.clean
      ? html`<div class="status clean"><strong>Clean</strong>
          <span>${worlds.length === 1 ? 'one Ariadne World' : `${worlds.length} Ariadne Worlds`}${worlds.length ? `: ${worlds.map(w => `${w.abbrev} (${w.anatomy}, ${w.hands.length} ${w.hands.length === 1 ? 'hand' : 'hands'})`).join(', ')}` : ''}${warnings ? ` · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}</span>${freshness}</div>`
      : html`<div class="status bad"><strong>${errors} ${errors === 1 ? 'error' : 'errors'}</strong>${warnings ? html`<span>${warnings} ${warnings === 1 ? 'warning' : 'warnings'}</span>` : nothing}${freshness}</div>`
    return html`<div class="verdict">${head}
      ${report.diagnostics.length ? html`<ul aria-label="Diagnostics">${report.diagnostics.map(d => html`
        <li class=${d.severity}><button type="button" data-code=${d.code} @click=${() => this.emit('mn-mus-reveal', { diagnostic: d })}>
          <span class="sev">${d.severity}</span><span class="loc">${where(d)}</span>
          <span class="msg">${d.message}</span>
        </button></li>`)}</ul>` : nothing}</div>`
  }

  private renderRender(): TemplateResult {
    const p = this.progress
    const rendering = this.renderState === 'rendering'
    const eta = p && p.fraction > 0.02 && rendering ? (p.elapsedSeconds / p.fraction) * (1 - p.fraction) : null
    return html`<div class="render-face">
      <div class="render">
        <button class="go" type="button" ?disabled=${!this.renderable} @click=${() => void this.startRender()}>RENDER</button>
        ${rendering
          ? html`
            <div class="bar" role="progressbar" aria-label="Rendering the World" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round((p?.fraction ?? 0) * 100)}>
              <div style=${styleMap({ width: `${((p?.fraction ?? 0) * 100).toFixed(1)}%` })}></div>
            </div>
            <span class="num">${Math.round((p?.fraction ?? 0) * 100)}%</span>
            <span class="muted num">${formatClock(p?.elapsedSeconds ?? 0)}${eta !== null ? ` · about ${formatClock(eta)} left` : ''}</span>
            <button class="ghost" type="button" @click=${() => this.cancel()}>Cancel</button>`
          : !this.renderable && !this.take
            ? html`<span class="muted">${!this.renderer ? 'The engine is not loaded.' : !this.report?.clean ? 'A score renders once it checks clean.' : 'Waiting for the check…'}</span>`
            : nothing}
      </div>
      ${this.renderError ? html`<div class="err" role="alert">${this.renderError}</div>` : nothing}
      ${this.take ? this.renderTake(this.take) : nothing}</div>`
  }

  private renderTake(take: MnMusTake): TemplateResult {
    const r = take.receipt
    const audio = take.frames / take.sampleRate
    const speed = r.wallSeconds > 0 ? audio / r.wallSeconds : null
    // Every binding sits inside an element: happy-dom (the test DOM) drops Lit's markers at a template's top level.
    return html`<div class="take">
      <div class="player">${this.player ? this.player(take) : html`<mn-mus-take-player .take=${take}></mn-mus-take-player>`}</div>
      <div class="facts">
        <span><span class="num">${audio.toFixed(2)}</span> <span class="unit">s</span> of audio</span>
        <span>peak <span class="num">${r.peakDbfs.toFixed(1)}</span> <span class="unit">dBFS</span></span>
        <span>RMS <span class="num">${r.rmsDbfs.toFixed(1)}</span> <span class="unit">dBFS</span></span>
        <span>rendered in <span class="num">${r.wallSeconds.toFixed(1)}</span> <span class="unit">s</span>${speed !== null ? html` (<span class="num">${speed.toFixed(2)}</span>× real time)` : nothing}</span>
      </div>
      <div class="digest" title="SHA-256 of the 24-bit WAV, as mus render --json states it">renderDigest ${r.renderDigest}</div>
      ${(r.ariadneWorlds ?? []).map(w => html`
        <div class="ledger" role="group" aria-label=${`Ledger of ${w.instrument}`}>
          <p class="caption">${w.instrument} on ${w.anatomy}: ${count(w.plucks, 'pluck')}, ${count(w.hammerOns, 'hammer-on')}, ${count(w.pullOffs, 'pull-off')}, ${count(w.slides, 'slide')}</p>
          <dl>${LEDGER.map(row => {
            const value = Number(w[row.key])
            return html`<div class="row" data-ledger=${row.key}><dt>${row.label}</dt>
              <dd class="num" title=${String(value)} data-exact=${String(value)}>${formatEnergy(value)} <span class="unit">eu</span></dd></div>`
          })}<div class="row" data-ledger="residualShare"><dt>Closure residual ÷ source work</dt>
            <dd class="num">${w.sourceWork ? formatEnergy(w.cumulativeClosureResidual / w.sourceWork) : '—'}</dd></div></dl>
        </div>`)}
      <div class="note">eu: the World's own energy units (normalized, not calibrated to joules). The residuals are what the World's bookkeeping leaves; near zero means the books close.</div></div>`
  }

  protected override render(): TemplateResult {
    return html`
      <section aria-label="Check"><h3>Check</h3>${this.renderVerdict()}</section>
      <section aria-label="Render"><h3>Hear the World</h3>${this.renderRender()}</section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-mus-verdict': MnMusVerdict
  }
}
