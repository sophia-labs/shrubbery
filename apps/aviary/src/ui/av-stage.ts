/**
 * av-stage.ts — `<av-stage>`: the main surface.
 *
 * Controlled, like the rail: the shell pushes `library` / `route` / `query` /
 * playback identity in, and the stage emits `av-play` out. It never touches an
 * audio element and never fetches — the one media element lives in the shell
 * (audio-player.ts) and the bytes arrive over the shell's `/media` route.
 *
 * Every visible number is a MEASURED value carried by the `aig:` graph, and
 * anything the analysis pipeline did not measure renders as an em dash (see
 * format.ts) rather than a confident zero.
 *
 * Composition over CSS: a sample is an `mn-card interactive` (which already
 * gives it `role="button"`, `tabindex=0`, and Enter/Space activation), its
 * measurements are `mn-chip`s, its counts are `mn-badge`s, and section titles
 * are `mn-panel-header`s. The only hand-written CSS is layout — grids, gaps,
 * scroll containers — plus a scrubber input, for which no primitive exists.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@shrubbery/components'
import type { Bed, Figure, Library, RenderPiece, Sample, Voice } from '../library/model.js'
import { ROUTE, hz } from '../shell/routes.js'
import { formatBytes, mediaUrl } from '../shell/media.js'
import { DASH, decibels, hertz, pitchLabel, seconds, semitones, text } from './format.js'

export interface AvPlayDetail {
  /** The graph IRI of the resource to play. */
  readonly iri: string
  /** Optional start offset in seconds (a render cue). */
  readonly at?: number
}

@customElement('av-stage')
export class AvStage extends LitElement {
  @property({ attribute: false }) library: Library | null = null
  @property({ type: String }) route = ''
  /** The app bar's search text — filters samples by id, note, or shape. */
  @property({ type: String }) query = ''
  /** IRI of whatever the single shell audio element currently holds. */
  @property({ type: String }) nowPlaying = ''
  @property({ type: Boolean }) isPlaying = false
  /** A read-seam failure, surfaced verbatim — never swallowed. */
  @property({ type: String }) error = ''

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    .wrap {
      padding: var(--mn-space-4, 1rem) var(--mn-space-5, 1.25rem) var(--mn-space-8, 2rem);
      max-width: 1100px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-2, 0.5rem);
      margin-bottom: var(--mn-space-1, 0.25rem);
    }
    h1 {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, system-ui));
      font-size: var(--mn-text-2xl, 24px);
      font-weight: var(--mn-font-weight-semibold, 600);
      letter-spacing: var(--mn-tracking-tight, -0.01em);
    }
    .lede {
      margin: 0 0 var(--mn-space-4, 1rem);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: var(--mn-leading-ui, 1.5);
      max-width: 68ch;
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 0.25rem);
      margin-bottom: var(--mn-space-4, 1rem);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 0.5rem);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: var(--mn-space-3, 0.75rem);
    }
    .row-head {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      width: 100%;
    }
    .glyph {
      flex: 0 0 auto;
      width: 1.4em;
      text-align: center;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #376d57));
      font-variant-numeric: tabular-nums;
    }
    .row-name {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-sm, 13px);
    }
    .row-pitch {
      font-weight: var(--mn-font-weight-semibold, 600);
      font-variant-numeric: tabular-nums;
    }
    .spacer {
      flex: 1 1 auto;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 0.25rem);
    }
    .cues {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 0.25rem);
      margin-top: var(--mn-space-2, 0.5rem);
    }
    figure {
      margin: 0;
    }
    figure img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
    }
    /* A render's own analysis image is a thumbnail in the list; the Analysis
       route shows the same file at full width. */
    [slot='footer'] figure img {
      max-height: 220px;
      width: auto;
      max-width: 100%;
      object-fit: contain;
    }
    figcaption {
      margin-top: var(--mn-space-1, 0.25rem);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    p.note {
      margin: 0;
      font-size: var(--mn-text-sm, 13px);
      line-height: var(--mn-leading-prose, 1.6);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .mono {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted, #6b7280);
    }
  `

  // ── intent ────────────────────────────────────────────────────────────────

  private _play(iri: string, at?: number): void {
    this.dispatchEvent(
      new CustomEvent<AvPlayDetail>('av-play', {
        detail: at === undefined ? { iri } : { iri, at },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * ArrowUp/ArrowDown roving focus across the playable rows. `mn-card` puts its
   * focusable node inside its own shadow root, so we move focus by reaching for
   * that node — the same open-shadow query the repo's own component tests use.
   */
  private _onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const cards = [...this.renderRoot.querySelectorAll<HTMLElement>('mn-card[interactive]')]
    if (cards.length === 0) return
    // `renderRoot` is a ShadowRoot here (LitElement's default); the DOM lib
    // types it as the wider ParentNode union, so narrow before asking.
    const root = this.renderRoot as ShadowRoot
    const active = (root.activeElement ?? null) as HTMLElement | null
    const index = active === null ? -1 : cards.indexOf(active)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    const target = cards[Math.max(0, Math.min(cards.length - 1, next))]
    const focusable = target?.shadowRoot?.querySelector<HTMLElement>('.card')
    if (!focusable) return
    event.preventDefault()
    focusable.focus()
  }

  // ── row primitives ────────────────────────────────────────────────────────

  private _glyphFor(iri: string): string {
    if (this.nowPlaying !== iri) return '▷'
    return this.isPlaying ? '❚❚' : '▷'
  }

  private _chip(label: string, tone = 'neutral'): TemplateResult {
    return html`<mn-chip .label=${label} .tone=${tone}></mn-chip>`
  }

  private _sampleRow(sample: Sample): TemplateResult {
    const hasAudio = sample.media.some((m) => m.isAudio)
    return html`<mn-card
      ?interactive=${hasAudio}
      .label=${hasAudio ? `Play ${sample.id}` : `${sample.id} — no audio in the graph`}
      data-sample=${sample.id}
      @mn-card-activate=${() => hasAudio && this._play(sample.iri)}
    >
      <div slot="header" class="row-head">
        <span class="glyph" aria-hidden="true">${hasAudio ? this._glyphFor(sample.iri) : '·'}</span>
        <span class="row-name">${sample.id}</span>
        <span class="row-pitch">${pitchLabel(sample.note, sample.cents)}</span>
        <span class="spacer"></span>
        <span class="mono">${seconds(sample.durationSeconds)}</span>
      </div>
      <div class="chips">
        ${this._chip(`shape ${text(sample.shape)}`, 'accent')}
        ${this._chip(`f0 ${hertz(sample.f0Hz)}`)}
        ${this._chip(`centroid ${hertz(sample.centroidHz)}`)}
        ${this._chip(`span ${semitones(sample.spanSemitones)}`)}
        ${this._chip(`AM ${hertz(sample.amRateHz)}`)}
        ${this._chip(`rms ${decibels(sample.rmsDb)}`, 'muted')}
        ${this._chip(`onset ${seconds(sample.t0)}`, 'muted')}
        ${sample.midi === undefined ? nothing : this._chip(`midi ${sample.midi}`, 'muted')}
        ${hasAudio ? nothing : this._chip('no audio file on disk', 'warning')}
      </div>
    </mn-card>`
  }

  private _mediaChips(item: { media: readonly { path: string; mediaType: string; byteSize: number | undefined }[] }): TemplateResult {
    return html`<div class="chips">
      ${item.media.map((m) => {
        const size = formatBytes(m.byteSize)
        const ext = m.path.slice(m.path.lastIndexOf('.') + 1)
        return this._chip(size === undefined ? ext : `${ext} · ${size}`, 'muted')
      })}
    </div>`
  }

  // ── views ─────────────────────────────────────────────────────────────────

  private _voiceView(voice: Voice): TemplateResult {
    const q = this.query.trim().toLowerCase()
    const samples =
      q === ''
        ? voice.samples
        : voice.samples.filter(
            (s) =>
              s.id.toLowerCase().includes(q) ||
              (s.note ?? '').toLowerCase().includes(q) ||
              (s.shape ?? '').toLowerCase().includes(q),
          )
    return html`<div class="wrap">
      <div class="head">
        <h1>${voice.name}</h1>
        <mn-badge size="sm" .label=${`${voice.samples.length} at hand`}></mn-badge>
        ${voice.population === undefined
          ? nothing
          : html`<mn-badge size="sm" variant="info" .label=${`${voice.population} in the recording`}></mn-badge>`}
      </div>
      <p class="lede">${text(voice.family)}</p>
      <div class="facts">
        ${voice.f0Median === undefined ? nothing : this._chip(`median f0 ${hz(voice.f0Median)}`, 'accent')}
        ${voice.cluster === undefined ? nothing : this._chip(`cluster ${voice.cluster}`, 'muted')}
        ${voice.notesAtHand.map((n) => this._chip(n))}
      </div>
      ${samples.length === 0
        ? html`<mn-empty-state
            icon="search"
            variant="compact"
            title="No samples match"
            .description=${`${voice.samples.length} in this voice; the filter "${this.query}" matches none.`}
          ></mn-empty-state>`
        : html`<div class="list" @keydown=${this._onKeydown}>${samples.map((s) => this._sampleRow(s))}</div>`}
    </div>`
  }

  private _bedRow(bed: Bed): TemplateResult {
    const hasAudio = bed.media.some((m) => m.isAudio)
    return html`<mn-card
      ?interactive=${hasAudio}
      .label=${`Play ${bed.name}`}
      @mn-card-activate=${() => hasAudio && this._play(bed.iri)}
    >
      <div slot="header" class="row-head">
        <span class="glyph" aria-hidden="true">${hasAudio ? this._glyphFor(bed.iri) : '·'}</span>
        <span class="row-name">${bed.name}</span>
        <span class="spacer"></span>
        <span class="mono">${seconds(bed.durationSeconds)}</span>
      </div>
      <p class="note">${text(bed.comment)}</p>
      ${this._mediaChips(bed)}
    </mn-card>`
  }

  private _renderRow(piece: RenderPiece): TemplateResult {
    const hasAudio = piece.media.some((m) => m.isAudio)
    return html`<mn-card
      ?interactive=${hasAudio}
      .label=${`Play ${piece.name}`}
      @mn-card-activate=${() => hasAudio && this._play(piece.iri)}
    >
      <div slot="header" class="row-head">
        <span class="glyph" aria-hidden="true">${hasAudio ? this._glyphFor(piece.iri) : '·'}</span>
        <span class="row-name">${piece.name}</span>
        <span class="spacer"></span>
        ${piece.cues.length === 0
          ? nothing
          : html`<mn-badge size="sm" .label=${`${piece.cues.length} cues`}></mn-badge>`}
      </div>
      ${this._mediaChips(piece)}
      ${piece.cues.length === 0
        ? nothing
        : html`<div class="cues">
            ${piece.cues.map(
              (cue) => html`<mn-button
                variant="ghost"
                size="xs"
                .label=${`${cue.label ?? DASH} · ${cue.t0.toFixed(2)}s`}
                title=${cue.comment ?? ''}
                @click=${(event: Event) => {
                  // The cue seeks WITHIN this render; it must not also trigger
                  // the card's own activate handler.
                  event.stopPropagation()
                  this._play(piece.iri, cue.t0)
                }}
              ></mn-button>`,
            )}
          </div>`}
      ${piece.figures.length === 0
        ? nothing
        : html`<div slot="footer">${piece.figures.map((f) => this._figure(f))}</div>`}
    </mn-card>`
  }

  private _figure(figure: Figure): TemplateResult {
    const image = figure.media.find((m) => !m.isAudio)
    if (!image) {
      return html`<mn-empty-state
        icon="alert-triangle"
        variant="inline"
        .title=${figure.name}
        description="The graph declares this figure but carries no image media for it."
      ></mn-empty-state>`
    }
    return html`<figure>
      <img src=${mediaUrl(image.path)} alt=${`Analysis figure: ${figure.name}`} loading="lazy" />
      <figcaption>${image.path} · ${formatBytes(image.byteSize) ?? DASH}</figcaption>
    </figure>`
  }

  private _libraryHeader(library: Library, title: string, lede?: string): TemplateResult {
    return html`<div class="head">
        <h1>${title}</h1>
      </div>
      ${lede === undefined ? nothing : html`<p class="lede">${lede}</p>`}
      ${library.bandwidthNote === undefined
        ? nothing
        : html`<div class="facts">${this._chip(library.bandwidthNote, 'warning')}</div>`}`
  }

  render(): TemplateResult {
    if (this.error !== '') {
      return html`<div class="wrap">
        <mn-empty-state
          icon="alert-triangle"
          mood="danger"
          title="The library could not be read"
          .description=${this.error}
        ></mn-empty-state>
      </div>`
    }
    const library = this.library
    if (library === null) {
      return html`<div class="wrap"><mn-loading variant="dots" text="reading the aig: graph…"></mn-loading></div>`
    }

    if (this.route.startsWith('voice:')) {
      const name = this.route.slice('voice:'.length)
      const voice = library.voices.find((v) => v.name === name)
      if (voice) return this._voiceView(voice)
    }

    if (this.route === ROUTE.beds) {
      return html`<div class="wrap">
        ${this._libraryHeader(library, 'Noise beds')}
        <div class="list" @keydown=${this._onKeydown}>${library.beds.map((b) => this._bedRow(b))}</div>
      </div>`
    }

    if (this.route === ROUTE.renders) {
      return html`<div class="wrap">
        ${this._libraryHeader(library, 'Renders')}
        <div class="list" @keydown=${this._onKeydown}>${library.renders.map((r) => this._renderRow(r))}</div>
      </div>`
    }

    if (this.route === ROUTE.recordings) {
      return html`<div class="wrap">
        ${this._libraryHeader(library, 'Source recording', library.source)}
        <div class="list" @keydown=${this._onKeydown}>
          ${library.recordings.map(
            (rec) => html`<mn-card
              ?interactive=${rec.media.some((m) => m.isAudio)}
              .label=${`Play ${rec.name}`}
              @mn-card-activate=${() => this._play(rec.iri)}
            >
              <div slot="header" class="row-head">
                <span class="glyph" aria-hidden="true">${this._glyphFor(rec.iri)}</span>
                <span class="row-name">${rec.name}</span>
              </div>
              ${this._mediaChips(rec)}
            </mn-card>`,
          )}
        </div>
      </div>`
    }

    if (this.route === ROUTE.analysis) {
      return html`<div class="wrap">
        ${this._libraryHeader(library, 'Analysis')}
        <div class="grid">
          ${library.figures.map(
            (f) => html`<mn-card><div slot="header" class="row-name">${f.name}</div>${this._figure(f)}</mn-card>`,
          )}
        </div>
      </div>`
    }

    if (this.route === ROUTE.technique) {
      return html`<div class="wrap">
        ${this._libraryHeader(library, 'Shifting')}
        <div class="list">
          ${library.techniques.map(
            (k) => html`<mn-card><div slot="header" class="row-name">${k.name}</div>
              <p class="note">${text(k.comment)}</p>
            </mn-card>`,
          )}
        </div>
      </div>`
    }

    return html`<div class="wrap">
      <mn-empty-state
        icon="inbox"
        title="Nothing selected"
        .description=${`No route in this library answers to "${this.route}". Pick a voice from the rail.`}
      ></mn-empty-state>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'av-stage': AvStage
  }
}
