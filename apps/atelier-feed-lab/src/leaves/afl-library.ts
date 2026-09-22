/**
 * afl-library — the run library and inspector: the surgical way into every
 * storyboard generation the ledger holds. Runs list with sheet thumbnails →
 * run inspector (sheet at size, the four anchors, per-reference cards, the
 * FULL composed prompt, each bridge clip individually playable) → entity
 * inspection (a study at size, its language, which runs used it) → a compare
 * surface pinning two runs side-by-side.
 *
 * NOT a layout-stamped leaf: like afl-pack it is app furniture (the workspace
 * fossil is untouched) — a full-viewport overlay mounted by main.ts, following
 * the runtime's own overlay precedent (doc-history). The feed keeps playing
 * underneath; the library is a reading room over a live broadcast.
 *
 * Controlled like every leaf: the orchestrator (director.ts) owns all fetches
 * and state; every user intent leaves as a composed event —
 *   afl-library-close        afl-library-show-list
 *   afl-library-open-run     { runId }
 *   afl-library-pin          { runId }   (toggle)
 *   afl-library-compare
 *   afl-library-queue        { runId }
 *   afl-entity-inspect       { id }      (shared with the composer's cards)
 *
 * Privacy is rendered, not implied: character references show a locked
 * browser-private card carrying the plate's SHA-256 — the 403 doctrine made
 * visible — and never an <img> to the study endpoint.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'

const ANCHOR_LETTERS = ['a', 'b', 'c', 'd'] as const

export interface RunSummary {
  readonly runId: string
  readonly storyId: string
  readonly createdAt?: number
  readonly createdAtIso?: string
  readonly mode?: string | null
  readonly direction?: string | null
  readonly refCount?: number
  readonly bridgeCount?: number
  readonly totalCost?: number | null
  readonly hasSheet?: boolean
  readonly partial?: boolean
  readonly backfilled?: boolean
  readonly note?: string
  readonly inputHash?: string | null
  readonly latencyMs?: number | null
  readonly pack?: ReadonlyArray<{ role: string; id: string }> | null
  readonly references?: ReadonlyArray<{ role: string; id: string; filename: string }> | null
}

export interface RunBridge {
  readonly jobId?: string
  readonly remoteId?: string | null
  readonly status?: string
  readonly direction?: string
  readonly directionReconstructed?: boolean
  readonly bridgeIndex?: number
  readonly firstAnchor?: string
  readonly lastAnchor?: string
  readonly cost?: number | null
  readonly submitLatencyMs?: number | null
  readonly generationLatencyMs?: number | null
  readonly totalLatencyMs?: number | null
  readonly videoUrl?: string | null
}

export interface RunEntityInfo {
  readonly id: string
  readonly kind: string
  readonly role: string
  readonly name: string
  readonly description: string
  readonly pending?: boolean
  readonly embeddedIn?: string
  readonly compositionNotes?: string
  readonly invariant?: string
  readonly studyLocked?: boolean
  readonly studySha256?: string
}

export interface RunQaSeam {
  readonly boundary: string
  readonly ssim: number | null
  readonly pair?: readonly string[]
}

export interface RunDetail extends RunSummary {
  readonly request?: {
    readonly mode?: string | null
    readonly pack?: ReadonlyArray<{ role: string; id: string }> | null
    readonly propId?: string | null
    readonly sceneId?: string | null
    readonly direction?: string | null
    readonly beats?: readonly string[] | null
    readonly references?: ReadonlyArray<{ role: string; id: string; filename: string }> | null
    readonly inputHash?: string | null
    readonly prompt?: string | null
  }
  readonly bridges?: readonly RunBridge[]
  readonly qa?: { readonly seams?: readonly RunQaSeam[]; readonly method?: string }
  readonly entities?: Readonly<Record<string, RunEntityInfo>>
  readonly assembledUrl?: string | null
}

/** What the orchestrator assembles for an entity inspection. */
export interface EntityInspection {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly compositionNotes: string
  readonly invariant: string
  readonly locked: boolean
  readonly doctrine?: string
  readonly sha256?: string | null
  readonly studyUrl?: string | null
  readonly pendingNote?: string
  readonly usedBy: readonly RunSummary[]
}

export type LibraryView = 'list' | 'run' | 'entity' | 'compare'

function money(cost: number | null | undefined): string {
  return typeof cost === 'number' ? `$${cost.toFixed(3)}` : '—'
}

function seconds(ms: number | null | undefined): string {
  return typeof ms === 'number' ? `${(ms / 1000).toFixed(1)}s` : '—'
}

function when(summary: RunSummary): string {
  if (typeof summary.createdAt === 'number') {
    return new Date(summary.createdAt).toLocaleString('en-GB', { hour12: false })
  }
  return summary.createdAtIso ?? '—'
}

@customElement('afl-library')
export class AflLibrary extends LitElement {
  /** Whether the overlay is shown (reflected so :host([open]) styles apply). */
  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) view: LibraryView = 'list'
  @property({ type: Boolean }) loading = false
  @property({ attribute: false }) runs: readonly RunSummary[] = []
  @property({ attribute: false }) activeRun: RunDetail | null = null
  @property({ attribute: false }) compareRuns: readonly [RunDetail, RunDetail] | null = null
  @property({ attribute: false }) pinned: readonly string[] = []
  @property({ attribute: false }) entity: EntityInspection | null = null
  /** Transient status line (e.g. "queued to the feed"). */
  @property({ type: String }) status = ''

  /** The zoom lightbox — pure view state, like the broadcast clock. */
  @state() private zoomSrc: string | null = null

  static styles = css`
    :host {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 60;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--mn-color-surface-canvas, #0b0c10) 88%, transparent);
      backdrop-filter: blur(6px);
      color: var(--mn-color-text-primary, #e8e9f0);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    :host([open]) {
      display: flex;
      flex-direction: column;
    }

    header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      flex: none;
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      background: var(--mn-color-surface-panel, #16171d);
      border-bottom: 1px solid var(--mn-color-border-subtle, #23242c);
    }
    header .eyebrow {
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    header h1 {
      margin: 0;
      font-family: var(--mn-font-display, Georgia, serif);
      font-size: var(--mn-text-lg, 20px);
      font-weight: 440;
    }
    header .status {
      overflow: hidden;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-success, #52a37c);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    header .spacer {
      flex: 1;
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-5, 20px);
    }

    .empty {
      max-width: 52ch;
      margin: 10vh auto 0;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.6;
      color: var(--mn-color-text-muted, #8b8e9c);
      text-align: center;
    }

    /* ── List ── */
    .run-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--mn-space-3, 12px);
    }
    .run-card {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      text-align: left;
      cursor: pointer;
      padding: 0;
      font: inherit;
      color: inherit;
      background: var(--mn-color-surface-raised, #16171d);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-surface, 6px);
      transition: border-color 120ms;
    }
    .run-card:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #7fb1e8));
    }
    .run-card.is-pinned {
      border-color: var(--mn-color-warning, #d98d3a);
    }
    .run-thumb {
      position: relative;
      aspect-ratio: 1;
      background: #08090c;
    }
    .run-thumb img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .run-thumb .lost {
      display: grid;
      place-items: center;
      height: 100%;
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-tertiary, #6f7280);
      background: repeating-linear-gradient(
        135deg,
        var(--mn-color-surface-raised, #16171d) 0 10px,
        var(--mn-color-surface-sunken, #0e0f13) 10px 20px
      );
    }
    .run-card-body {
      display: grid;
      gap: 4px;
      padding: var(--mn-space-3, 12px);
    }
    .run-card-body code {
      overflow: hidden;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #9a9daa);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .run-card-body .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .chip {
      display: inline-block;
      padding: 1px 6px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid var(--mn-color-border-strong, #4a4d5a);
      border-radius: var(--mn-radius-sm, 3px);
      color: var(--mn-color-text-secondary, #b9bcc8);
    }
    .chip.mode-pack {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
      border-color: color-mix(in srgb, var(--mn-color-accent, #7fb1e8) 55%, transparent);
    }
    .chip.partial {
      color: var(--mn-color-warning, #d98d3a);
      border-color: color-mix(in srgb, var(--mn-color-warning, #d98d3a) 55%, transparent);
    }
    .chip.seam {
      text-transform: none;
      letter-spacing: 0.03em;
    }

    /* ── Shared section furniture ── */
    .section {
      margin-bottom: var(--mn-space-5, 20px);
    }
    .section-label {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .section-label i {
      flex: 1;
      height: 1px;
      background: var(--mn-color-border-subtle, #23242c);
    }
    pre {
      max-height: 420px;
      margin: 0;
      padding: var(--mn-space-3, 12px);
      overflow: auto;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.55;
      white-space: pre-wrap;
      color: var(--mn-color-text-secondary, #b9bcc8);
      background: var(--mn-color-surface-sunken, #0e0f13);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }

    /* ── Run inspector ── */
    .inspector {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      gap: var(--mn-space-5, 20px);
      max-width: 1500px;
      margin: 0 auto;
    }
    .sheet-figure {
      margin: 0;
    }
    .sheet-figure img {
      display: block;
      width: 100%;
      cursor: zoom-in;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-surface, 6px);
    }
    .sheet-lost {
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mn-color-text-tertiary, #6f7280);
      background: repeating-linear-gradient(
        135deg,
        var(--mn-color-surface-raised, #16171d) 0 12px,
        var(--mn-color-surface-sunken, #0e0f13) 12px 24px
      );
      border: 1px dashed var(--mn-color-border-strong, #4a4d5a);
      border-radius: var(--mn-radius-surface, 6px);
    }
    .anchor-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mn-space-2, 8px);
    }
    .anchor-row figure {
      position: relative;
      margin: 0;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }
    .anchor-row img {
      display: block;
      width: 100%;
      cursor: zoom-in;
    }
    .anchor-row figcaption {
      position: absolute;
      top: 4px;
      left: 6px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: 10px;
      text-transform: uppercase;
      color: #fff;
      text-shadow: 0 1px 3px #000;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 14px;
      font-size: var(--mn-text-xs, 12px);
    }
    .meta-grid dt {
      margin: 0;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .meta-grid dd {
      margin: 0;
      overflow: hidden;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.7;
      color: var(--mn-color-text-secondary, #b9bcc8);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .note {
      margin: var(--mn-space-2, 8px) 0 0;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.5;
      color: var(--mn-color-warning, #d98d3a);
    }

    .bridge {
      display: grid;
      grid-template-columns: minmax(0, 220px) 1fr;
      gap: var(--mn-space-3, 12px);
      margin-bottom: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px);
      background: var(--mn-color-surface-raised, #16171d);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }
    .bridge video {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      background: #000;
      border-radius: var(--mn-radius-sm, 3px);
    }
    .bridge .bridge-title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 10px;
      margin-bottom: 6px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    .bridge .direction {
      margin: 0 0 6px;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.5;
      color: var(--mn-color-text-secondary, #b9bcc8);
    }
    .bridge .stats {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #9a9daa);
    }

    .ref-card {
      display: grid;
      grid-template-columns: minmax(0, 128px) 1fr;
      gap: var(--mn-space-3, 12px);
      margin-bottom: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      cursor: pointer;
      background: var(--mn-color-surface-raised, #16171d);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
      transition: border-color 120ms;
    }
    .ref-card:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #7fb1e8));
    }
    .ref-card img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: var(--mn-radius-sm, 3px);
    }
    .locked-plate {
      display: grid;
      place-items: center;
      gap: 4px;
      aspect-ratio: 1;
      padding: var(--mn-space-2, 8px);
      box-sizing: border-box;
      text-align: center;
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--mn-color-warning, #d98d3a);
      background: repeating-linear-gradient(
        135deg,
        var(--mn-color-surface-raised, #16171d) 0 8px,
        var(--mn-color-surface-sunken, #0e0f13) 8px 16px
      );
      border: 1px dashed color-mix(in srgb, var(--mn-color-warning, #d98d3a) 55%, transparent);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .ref-card .ref-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
      margin-bottom: 4px;
    }
    .ref-card strong {
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
    }
    .ref-card .ref-text {
      margin: 0;
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.5;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .ref-card .hash {
      display: block;
      margin-top: 4px;
      overflow: hidden;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #6f7280);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Entity view ── */
    .entity-view {
      display: grid;
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      gap: var(--mn-space-5, 20px);
      max-width: 1300px;
      margin: 0 auto;
    }
    .entity-view .study img {
      display: block;
      width: 100%;
      cursor: zoom-in;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-surface, 6px);
    }
    .entity-view h2 {
      margin: 0 0 4px;
      font-family: var(--mn-font-display, Georgia, serif);
      font-size: var(--mn-text-lg, 20px);
      font-weight: 440;
    }
    .entity-view .prose {
      margin: 0 0 var(--mn-space-3, 12px);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.6;
      color: var(--mn-color-text-secondary, #b9bcc8);
    }
    .entity-view .doctrine {
      padding: var(--mn-space-3, 12px);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.55;
      color: var(--mn-color-warning, #d98d3a);
      background: color-mix(in srgb, var(--mn-color-warning, #d98d3a) 6%, transparent);
      border: 1px dashed color-mix(in srgb, var(--mn-color-warning, #d98d3a) 55%, transparent);
      border-radius: var(--mn-radius-control, 4px);
    }
    .used-by {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--mn-space-2, 8px);
    }

    /* ── Compare ── */
    .compare-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mn-space-5, 20px);
      max-width: 1500px;
      margin: 0 auto;
    }
    .compare-col .col-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 10px;
      margin-bottom: var(--mn-space-3, 12px);
    }
    .compare-col img.sheet {
      display: block;
      width: 100%;
      cursor: zoom-in;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-surface, 6px);
      margin-bottom: var(--mn-space-3, 12px);
    }

    /* ── Buttons (library-local, token-voiced) ── */
    button.ghost {
      padding: 5px 10px;
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary, #b9bcc8);
      background: transparent;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }
    button.ghost:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.05));
    }
    button.ghost.is-pinned {
      color: var(--mn-color-warning, #d98d3a);
      border-color: color-mix(in srgb, var(--mn-color-warning, #d98d3a) 55%, transparent);
    }
    button.primary {
      padding: 5px 12px;
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
      color: var(--mn-color-surface-canvas, #0b0c10);
      background: var(--mn-color-accent, #7fb1e8);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 4px);
    }
    button.primary:disabled {
      opacity: 0.4;
      cursor: default;
    }

    /* ── Zoom lightbox ── */
    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: grid;
      place-items: center;
      cursor: zoom-out;
      overflow: auto;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
      background: rgba(4, 5, 7, 0.92);
    }
    .lightbox img {
      max-width: min(1024px, 96vw);
      width: 96vw;
      height: auto;
    }

    @media (max-width: 980px) {
      .inspector,
      .entity-view,
      .compare-grid {
        grid-template-columns: 1fr;
      }
      .bridge {
        grid-template-columns: 1fr;
      }
      .body {
        padding: var(--mn-space-3, 12px);
      }
    }
  `

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private artifactUrl(runId: string, artifact: string): string {
    return `/api/runs/${encodeURIComponent(runId)}/${artifact}`
  }

  /** The exact role section the recorded prompt carried for reference i
   *  (the "Image N …" line), falling back to the entity's own notes. */
  private roleSectionFor(detail: RunDetail, index: number, entity: RunEntityInfo | undefined): string {
    const prompt = detail.request?.prompt
    if (prompt) {
      const line = prompt.split('\n').find((candidate) => candidate.startsWith(`Image ${index + 1} `))
      if (line) return line
    }
    return entity?.compositionNotes ?? ''
  }

  private headerTitle(): string {
    switch (this.view) {
      case 'run':
        return this.activeRun?.runId ?? 'Run'
      case 'entity':
        return this.entity?.name ?? 'Entity'
      case 'compare':
        return 'Compare'
      default:
        return 'Run library'
    }
  }

  private renderHeader(): TemplateResult {
    const canCompare = this.pinned.length === 2
    return html`<header>
      ${this.view !== 'list'
        ? html`<button id="library-back" class="ghost" @click=${() => this.emit('afl-library-show-list')}>
            ← runs
          </button>`
        : nothing}
      <div>
        <span class="eyebrow">the ledger</span>
        <h1 id="library-title">${this.headerTitle()}</h1>
      </div>
      <span class="status" id="library-status">${this.status}</span>
      <span class="spacer"></span>
      ${this.view === 'list' && canCompare
        ? html`<button id="library-compare" class="primary" @click=${() => this.emit('afl-library-compare')}>
            Compare pinned (2)
          </button>`
        : nothing}
      <button id="library-close" class="ghost" @click=${() => this.emit('afl-library-close')}>Close</button>
    </header>`
  }

  private renderList(): TemplateResult {
    if (this.runs.length === 0) {
      return html`<p class="empty">
        ${this.loading
          ? 'Reading the ledger…'
          : 'No runs recorded yet. Every real storyboard generation writes itself here — sheet, anchors, references, the full composed prompt, and each bridge as it lands.'}
      </p>`
    }
    return html`<div class="run-grid">
      ${this.runs.map((run) => {
        const pinned = this.pinned.includes(run.runId)
        return html`<div
          class=${classMap({ 'run-card': true, 'is-pinned': pinned })}
          data-run-id=${run.runId}
          role="button"
          tabindex="0"
          @click=${() => this.emit('afl-library-open-run', { runId: run.runId })}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter') this.emit('afl-library-open-run', { runId: run.runId })
          }}
        >
          <div class="run-thumb">
            ${run.hasSheet
              ? html`<img src=${this.artifactUrl(run.runId, 'sheet.jpg')} alt=${`Sheet for ${run.runId}`} loading="lazy" />`
              : html`<div class="lost">sheet lost</div>`}
          </div>
          <div class="run-card-body">
            <code>${run.runId}</code>
            <div class="row">
              <span class="chip ${run.mode === 'pack' ? 'mode-pack' : ''}">${run.mode ?? 'unknown'}</span>
              ${run.partial ? html`<span class="chip partial">partial</span>` : nothing}
              <span>${when(run)}</span>
            </div>
            <div class="row">
              <span>${run.refCount ?? '—'} refs</span>
              <span>${run.bridgeCount ?? 0} bridges</span>
              <span class="cost">${money(run.totalCost)}</span>
            </div>
            <div class="row">
              <button
                class=${classMap({ ghost: true, 'pin-toggle': true, 'is-pinned': pinned })}
                @click=${(event: Event) => {
                  event.stopPropagation()
                  this.emit('afl-library-pin', { runId: run.runId })
                }}
              >
                ${pinned ? '★ pinned' : '☆ pin to compare'}
              </button>
            </div>
          </div>
        </div>`
      })}
    </div>`
  }

  private renderReferenceCards(detail: RunDetail): TemplateResult {
    const references = detail.request?.references ?? []
    const entities = detail.entities ?? {}
    // Pack entries that hold no image slot of their own (embedded riders).
    const riders = (detail.request?.pack ?? []).filter(
      (entry) => !references.some((reference) => reference.id === entry.id),
    )
    return html`
      ${references.map((reference, index) => {
        const entity = entities[reference.id]
        const locked = entity?.studyLocked ?? reference.role === 'identity'
        return html`<div
          class=${classMap({ 'ref-card': true, 'is-locked': locked })}
          data-entity-id=${reference.id}
          @click=${() => this.emit('afl-entity-inspect', { id: reference.id })}
        >
          ${locked
            ? html`<div class="locked-plate">
                <span>browser-private</span>
                <span>identity plate</span>
              </div>`
            : html`<img
                src=${`/api/entity-study/${encodeURIComponent(reference.id)}`}
                alt=${`Reference study ${reference.id}`}
                loading="lazy"
              />`}
          <div>
            <div class="ref-head">
              <span class="chip">${reference.role}</span>
              <strong>${entity?.name ?? reference.id}</strong>
              <code class="hash">${reference.filename}</code>
            </div>
            <p class="ref-text">${this.roleSectionFor(detail, index, entity)}</p>
            ${locked && entity?.studySha256
              ? html`<code class="hash" title="SHA-256 of the private plate">sha256:${entity.studySha256}</code>`
              : nothing}
          </div>
        </div>`
      })}
      ${riders.map((rider) => {
        const entity = entities[rider.id]
        return html`<div class="ref-card is-rider" data-entity-id=${rider.id} @click=${() => this.emit('afl-entity-inspect', { id: rider.id })}>
          <div class="locked-plate">
            <span>rider</span>
            <span>no image slot</span>
          </div>
          <div>
            <div class="ref-head">
              <span class="chip">${rider.role}</span>
              <strong>${entity?.name ?? rider.id}</strong>
            </div>
            <p class="ref-text">
              ${entity?.embeddedIn
                ? `Rides embedded in ${entity.embeddedIn}'s plate — its invariant line folds into that section.`
                : entity?.compositionNotes ?? ''}
            </p>
          </div>
        </div>`
      })}
    `
  }

  private renderRun(): TemplateResult {
    const detail = this.activeRun
    if (!detail) return html`<p class="empty">${this.loading ? 'Reading the run…' : 'Run not found.'}</p>`
    const bridges = detail.bridges ?? []
    const playable = bridges.filter((bridge) => bridge.videoUrl)
    const anchorPoster = (bridge: RunBridge): string | undefined => {
      const index = bridge.bridgeIndex
      return detail.hasSheet && typeof index === 'number' && index >= 0 && index < 4
        ? this.artifactUrl(detail.runId, `anchor-${ANCHOR_LETTERS[index]}.jpg`)
        : undefined
    }
    return html`<div class="inspector">
      <div>
        <div class="section">
          <div class="section-label"><span>sheet</span><i></i><code>${detail.inputHash ?? ''}</code></div>
          ${detail.hasSheet
            ? html`<figure class="sheet-figure">
                <img
                  id="run-sheet"
                  src=${this.artifactUrl(detail.runId, 'sheet.jpg')}
                  alt=${`Storyboard sheet ${detail.runId}`}
                  @click=${() => (this.zoomSrc = this.artifactUrl(detail.runId, 'sheet.jpg'))}
                />
              </figure>`
            : html`<div class="sheet-lost" id="run-sheet-lost">sheet lost — not recoverable</div>`}
        </div>
        ${detail.hasSheet
          ? html`<div class="section">
              <div class="section-label"><span>anchors</span><i></i></div>
              <div class="anchor-row">
                ${ANCHOR_LETTERS.map(
                  (letter) => html`<figure class="anchor-figure">
                    <img
                      src=${this.artifactUrl(detail.runId, `anchor-${letter}.jpg`)}
                      alt=${`Anchor ${letter.toUpperCase()}`}
                      @click=${() => (this.zoomSrc = this.artifactUrl(detail.runId, `anchor-${letter}.jpg`))}
                    />
                    <figcaption>${letter}</figcaption>
                  </figure>`,
                )}
              </div>
            </div>`
          : nothing}
        <div class="section">
          <div class="section-label">
            <span>bridges</span><i></i><span>${bridges.length}</span>
          </div>
          ${bridges.length === 0
            ? html`<p class="ref-text">No bridge clips belong to this run.</p>`
            : bridges.map(
                (bridge) => html`<div class="bridge" data-job-id=${bridge.jobId ?? ''}>
                  ${bridge.videoUrl
                    ? html`<video
                        class="bridge-clip"
                        controls
                        preload="metadata"
                        playsinline
                        src=${bridge.videoUrl}
                        poster=${anchorPoster(bridge) ?? ''}
                      ></video>`
                    : html`<div class="locked-plate"><span>${bridge.status ?? 'no clip'}</span></div>`}
                  <div>
                    <div class="bridge-title">
                      <span>${bridge.firstAnchor ?? '?'} → ${bridge.lastAnchor ?? '?'}</span>
                      <span class="chip">${bridge.status ?? 'unknown'}</span>
                      ${bridge.directionReconstructed
                        ? html`<span class="chip partial" title="Direction reconstructed from the story family during backfill">reconstructed</span>`
                        : nothing}
                    </div>
                    <p class="direction">${bridge.direction ?? '—'}</p>
                    <div class="stats">
                      cost ${money(bridge.cost)} · submit ${seconds(bridge.submitLatencyMs)} · generation
                      ${seconds(bridge.generationLatencyMs)} · total ${seconds(bridge.totalLatencyMs)} · remote
                      ${bridge.remoteId ?? '—'}
                    </div>
                  </div>
                </div>`,
              )}
          ${detail.assembledUrl
            ? html`<div class="bridge" data-assembled>
                <video class="bridge-clip" controls preload="metadata" playsinline src=${detail.assembledUrl}></video>
                <div>
                  <div class="bridge-title"><span>assembled story</span></div>
                  <p class="direction">All bridges concatenated — the full twelve seconds as one clip.</p>
                </div>
              </div>`
            : nothing}
        </div>
      </div>
      <div>
        <div class="section">
          <div class="section-label"><span>provenance</span><i></i></div>
          <dl class="meta-grid">
            <dt>run</dt>
            <dd>${detail.runId}</dd>
            <dt>story</dt>
            <dd>${detail.storyId}</dd>
            <dt>created</dt>
            <dd>${when(detail)}</dd>
            <dt>mode</dt>
            <dd>${detail.mode ?? 'unknown'}</dd>
            <dt>model</dt>
            <dd>${(detail as { model?: string }).model ?? '—'}</dd>
            <dt>request</dt>
            <dd>${(detail as { providerRequestId?: string | null }).providerRequestId ?? '—'}</dd>
            <dt>latency</dt>
            <dd>${seconds(detail.latencyMs)}</dd>
            <dt>input</dt>
            <dd>${detail.inputHash ?? '—'}</dd>
            <dt>refs</dt>
            <dd>${detail.refCount ?? '—'}</dd>
            <dt>cost</dt>
            <dd>${money(detail.totalCost)}</dd>
          </dl>
          ${detail.partial && detail.note ? html`<p class="note" id="run-note">${detail.note}</p>` : nothing}
          ${!detail.partial && detail.note ? html`<p class="ref-text" id="run-note">${detail.note}</p>` : nothing}
          ${detail.qa?.seams?.length
            ? html`<div class="row" style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                ${detail.qa.seams.map(
                  (seam) => html`<span class="chip seam" title=${(seam.pair ?? []).join(' vs ')}>
                    seam ${seam.boundary} · SSIM ${seam.ssim === null ? '—' : seam.ssim.toFixed(4)}
                  </span>`,
                )}
              </div>`
            : nothing}
        </div>
        <div class="section">
          <div class="section-label"><span>queue</span><i></i></div>
          <button
            id="queue-run"
            class="primary"
            ?disabled=${playable.length === 0}
            @click=${() => this.emit('afl-library-queue', { runId: detail.runId })}
          >
            Queue this story to the feed (${playable.length} clip${playable.length === 1 ? '' : 's'})
          </button>
        </div>
        <div class="section">
          <div class="section-label"><span>references</span><i></i><span>${detail.refCount ?? ''}</span></div>
          ${this.renderReferenceCards(detail)}
        </div>
        <div class="section">
          <div class="section-label"><span>composed prompt</span><i></i></div>
          ${detail.request?.prompt
            ? html`<pre id="run-prompt">${detail.request.prompt}</pre>`
            : html`<p class="ref-text" id="run-prompt-lost">
                The composed prompt did not survive for this run — it predates the ledger.
              </p>`}
        </div>
      </div>
    </div>`
  }

  private renderEntity(): TemplateResult {
    const entity = this.entity
    if (!entity) return html`<p class="empty">${this.loading ? 'Reading the entity…' : 'No entity selected.'}</p>`
    return html`<div class="entity-view">
      <div class="study">
        ${entity.locked
          ? html`<div class="locked-plate" id="entity-locked" style="aspect-ratio:1;">
              <span>browser-private</span>
              <span>identity plate</span>
              ${entity.sha256 ? html`<code class="hash">sha256:${entity.sha256.slice(0, 24)}…</code>` : nothing}
            </div>`
          : entity.studyUrl
            ? html`<img
                id="entity-study-img"
                src=${entity.studyUrl}
                alt=${`Reference study — ${entity.name}`}
                @click=${() => (this.zoomSrc = entity.studyUrl ?? null)}
              />`
            : html`<div class="locked-plate" id="entity-pending" style="aspect-ratio:1;">
                <span>${entity.pendingNote ?? 'no study yet'}</span>
              </div>`}
      </div>
      <div>
        <h2>${entity.name}</h2>
        <div class="row" style="display:flex; gap:8px; margin-bottom:12px;">
          <span class="chip">${entity.kind}</span>
          <code class="hash">${entity.id}</code>
        </div>
        <p class="prose">${entity.description}</p>
        ${entity.locked && entity.doctrine
          ? html`<div class="section">
              <div class="section-label"><span>doctrine</span><i></i></div>
              <p class="doctrine" id="entity-doctrine">
                ${entity.doctrine}${entity.sha256 ? html`<code class="hash">sha256:${entity.sha256}</code>` : nothing}
              </p>
            </div>`
          : nothing}
        <div class="section">
          <div class="section-label"><span>composition notes</span><i></i></div>
          <p class="prose" id="entity-notes">${entity.compositionNotes}</p>
        </div>
        <div class="section">
          <div class="section-label"><span>invariant</span><i></i></div>
          <p class="prose" id="entity-invariant">${entity.invariant}</p>
        </div>
        <div class="section">
          <div class="section-label"><span>used by</span><i></i><span>${entity.usedBy.length}</span></div>
          ${entity.usedBy.length === 0
            ? html`<p class="ref-text">No recorded run has spent with this entity.</p>`
            : html`<div class="used-by">
                ${entity.usedBy.map(
                  (run) => html`<div
                    class="run-card"
                    data-run-id=${run.runId}
                    role="button"
                    tabindex="0"
                    @click=${() => this.emit('afl-library-open-run', { runId: run.runId })}
                  >
                    <div class="run-thumb">
                      ${run.hasSheet
                        ? html`<img src=${this.artifactUrl(run.runId, 'sheet.jpg')} alt="" loading="lazy" />`
                        : html`<div class="lost">sheet lost</div>`}
                    </div>
                    <div class="run-card-body"><code>${run.runId}</code></div>
                  </div>`,
                )}
              </div>`}
        </div>
      </div>
    </div>`
  }

  private renderCompare(): TemplateResult {
    const pair = this.compareRuns
    if (!pair) return html`<p class="empty">${this.loading ? 'Reading both runs…' : 'Pin two runs to compare them.'}</p>`
    return html`<div class="compare-grid">
      ${pair.map(
        (detail) => html`<div class="compare-col" data-run-id=${detail.runId}>
          <div class="col-head">
            <code>${detail.runId}</code>
            <span class="chip ${detail.mode === 'pack' ? 'mode-pack' : ''}">${detail.mode ?? 'unknown'}</span>
            <span class="chip">${detail.refCount ?? '—'} refs</span>
            <span class="chip">${money(detail.totalCost)}</span>
            <button class="ghost" @click=${() => this.emit('afl-library-pin', { runId: detail.runId })}>unpin</button>
          </div>
          ${detail.hasSheet
            ? html`<img
                class="sheet"
                src=${this.artifactUrl(detail.runId, 'sheet.jpg')}
                alt=${`Sheet ${detail.runId}`}
                @click=${() => (this.zoomSrc = this.artifactUrl(detail.runId, 'sheet.jpg'))}
              />`
            : html`<div class="sheet-lost">sheet lost</div>`}
          <dl class="meta-grid">
            <dt>direction</dt>
            <dd title=${detail.direction ?? ''}>${detail.direction ?? '—'}</dd>
            <dt>input</dt>
            <dd>${detail.inputHash ?? '—'}</dd>
            <dt>latency</dt>
            <dd>${seconds(detail.latencyMs)}</dd>
          </dl>
          ${detail.request?.prompt
            ? html`<pre class="compare-prompt">${detail.request.prompt}</pre>`
            : html`<p class="ref-text">No recorded prompt.</p>`}
        </div>`,
      )}
    </div>`
  }

  render(): TemplateResult {
    return html`
      ${this.renderHeader()}
      <div class="body">
        ${this.view === 'list'
          ? this.renderList()
          : this.view === 'run'
            ? this.renderRun()
            : this.view === 'entity'
              ? this.renderEntity()
              : this.renderCompare()}
      </div>
      ${this.zoomSrc
        ? html`<div class="lightbox" id="library-lightbox" @click=${() => (this.zoomSrc = null)}>
            <img src=${this.zoomSrc} alt="Zoomed artifact" />
          </div>`
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'afl-library': AflLibrary
  }
}
