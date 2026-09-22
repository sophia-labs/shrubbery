/**
 * afl-broadcast — the live-composition leaf: the video frame (two playout
 * decks + the generated-frame overlay), the topline (live chip + clock), the
 * caption, the playout buffer strip, and the storyboard filmstrip.
 *
 * Stamped by the workspace frame from layout DATA (panel-broadcast →
 * renderedByComponent 'afl-broadcast'); upgrades in place once this module is
 * imported (the upgrade seam).
 *
 * PLAYOUT CONTRACT (unchanged from the original app): the two <video> decks
 * are handed by reference to VideoPlayout, which toggles their `is-active`
 * class itself; the styles here keep `.feed-video.is-active` as the visible
 * deck. `document.body.dataset.feed` stays owned by the orchestrator. The
 * deck elements are STATIC template nodes (no bindings on the tags), so Lit
 * re-renders never recreate them and playout's imperative class writes stick.
 *
 * Controlled: the orchestrator (director.ts) sets props; the only outbound
 * intent is `afl-replay` (composed) from the replay button.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'

export interface BroadcastAnchor {
  readonly imageDataUrl: string
}

const ANCHOR_BEATS = ['quiet', 'recognition', 'release', 'receiving'] as const

@customElement('afl-broadcast')
export class AflBroadcast extends LitElement {
  /** Caption line 1 — what the feed is playing. */
  @property({ type: String }) nowPlaying = 'warming the feed…'
  /** Caption line 2 — idle loop | generated splice | pipeline phase. */
  @property({ type: String }) feedState = 'idle loop'
  /** The buffer-strip copy (playout status prose). */
  @property({ type: String }) bufferCopy = 'booting local idle'
  /** The restored/generated four-anchor storyboard (empty = hidden). */
  @property({ attribute: false }) anchors: readonly BroadcastAnchor[] = []
  /** Index of the anchor the playing story clip departs from (-1 = none). */
  @property({ type: Number }) currentAnchor = -1
  /** Whether the replay-story affordance is offered. */
  @property({ type: Boolean }) replayVisible = false

  /** The generated still shown over the decks until motion takes the feed. */
  @state() private generatedSrc = ''
  @state() private generatedActive = false
  @state() private clock = ''

  private clockTimer: number | null = null

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      background: var(--mn-color-surface-canvas, #101014);
      color: var(--mn-color-text-primary, #e8e9f0);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .frame {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      isolation: isolate;
      background: #08090c;
      border: 1px solid var(--mn-color-border-default, #2a2c36);
      border-radius: var(--mn-radius-surface, 6px);
      box-shadow: var(--mn-observatory-instrument-glow, var(--mn-shadow-card, none));
    }

    .feed-video,
    .generated-frame {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
    }
    .feed-video {
      transform: scale(1.005);
      transition: opacity 140ms steps(2, jump-none);
    }
    .generated-frame {
      z-index: 1;
      transform: scale(1.008);
      transition: opacity 180ms ease-out;
    }
    .feed-video.is-active,
    .generated-frame.is-active {
      opacity: 1;
    }

    .vignette {
      position: absolute;
      inset: 0;
      z-index: 2;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(5, 6, 9, 0.45), transparent 20%, transparent 68%, rgba(5, 6, 9, 0.72)),
        radial-gradient(circle, transparent 55%, rgba(4, 5, 7, 0.3));
    }

    .topline,
    .caption {
      position: absolute;
      z-index: 3;
      left: var(--mn-space-4, 16px);
      right: var(--mn-space-4, 16px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
    }
    .topline {
      top: var(--mn-space-3, 12px);
    }
    .caption {
      bottom: var(--mn-space-3, 12px);
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.78);
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
    }
    .caption strong {
      font-weight: 640;
      color: #fff;
    }

    .clock {
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
      font-size: var(--mn-text-sm, 13px);
      color: rgba(255, 255, 255, 0.88);
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
    }

    .buffer {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      flex: none;
      min-height: 32px;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .buffer-title {
      flex: none;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    .buffer-track {
      flex: 0 1 120px;
      height: 2px;
      overflow: hidden;
      border-radius: 1px;
      background: var(--mn-color-surface-raised, rgba(255, 255, 255, 0.12));
    }
    .buffer-fill {
      display: block;
      width: 44%;
      height: 100%;
      background: var(--mn-color-accent, #7fb1e8);
      animation: buffering 4.5s ease-in-out infinite;
    }
    .buffer-copy {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .buffer mn-button {
      flex: none;
    }

    .filmstrip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mn-space-2, 8px);
      flex: none;
      height: 84px;
    }
    .filmstrip figure {
      position: relative;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      opacity: 0.62;
      background: #0b0c10;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
      transition: border-color 140ms, opacity 140ms;
    }
    .filmstrip figure.is-current {
      opacity: 1;
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #7fb1e8));
    }
    .filmstrip img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .filmstrip figcaption {
      position: absolute;
      inset: auto 6px 5px;
      display: flex;
      justify-content: space-between;
      gap: 6px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #fff;
      text-shadow: 0 1px 3px #000;
    }
    .filmstrip figcaption span {
      color: var(--mn-color-accent, #7fb1e8);
    }
    .filmstrip figcaption em {
      overflow: hidden;
      font-style: normal;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @keyframes buffering {
      0%, 100% { transform: translateX(-55%); }
      50% { transform: translateX(125%); }
    }

    @media (prefers-reduced-motion: reduce) {
      .buffer-fill { animation: none; }
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.tickClock()
    this.clockTimer = window.setInterval(() => this.tickClock(), 1000)
  }

  disconnectedCallback(): void {
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer)
    this.clockTimer = null
    super.disconnectedCallback()
  }

  private tickClock(): void {
    this.clock = new Date().toLocaleTimeString('en-GB', { hour12: false })
  }

  /** The two playout decks, by reference, for VideoPlayout (after first render). */
  async decks(): Promise<[HTMLVideoElement, HTMLVideoElement]> {
    await this.updateComplete
    const a = this.renderRoot.querySelector<HTMLVideoElement>('#deck-a')
    const b = this.renderRoot.querySelector<HTMLVideoElement>('#deck-b')
    if (!a || !b) throw new Error('afl-broadcast rendered without its playout decks')
    return [a, b]
  }

  /**
   * Show a generated still over the decks. Mirrors the original semantics:
   * set src, await decode, THEN fade in — never flash an undecoded image.
   */
  async presentFrame(imageDataUrl: string): Promise<void> {
    this.generatedSrc = imageDataUrl
    await this.updateComplete
    const img = this.renderRoot.querySelector<HTMLImageElement>('.generated-frame')
    if (!img) throw new Error('afl-broadcast rendered without its generated-frame image')
    await img.decode()
    this.generatedActive = true
  }

  /** Drop the generated still (motion has taken the feed). */
  clearFrame(): void {
    this.generatedActive = false
  }

  private emitReplay(): void {
    this.dispatchEvent(new CustomEvent('afl-replay', { bubbles: true, composed: true }))
  }

  private emitLibrary(): void {
    this.dispatchEvent(new CustomEvent('afl-library-open', { bubbles: true, composed: true }))
  }

  render(): TemplateResult {
    return html`
      <div class="frame">
        <video id="deck-a" class="feed-video" muted playsinline preload="auto"></video>
        <video id="deck-b" class="feed-video" muted playsinline preload="auto"></video>
        <img
          class="generated-frame ${this.generatedActive ? 'is-active' : ''}"
          src=${this.generatedSrc || nothing}
          alt="The latest artistic frame generated from the private VTuber reference"
        />
        <div class="vignette"></div>
        <div class="topline">
          <mn-chip glyph="●" tone="danger" label="live composition"></mn-chip>
          <span id="feed-clock" class="clock">${this.clock}</span>
        </div>
        <div class="caption">
          <strong id="now-playing">${this.nowPlaying}</strong>
          <span id="feed-state">${this.feedState}</span>
        </div>
      </div>

      <div class="buffer">
        <span class="buffer-title">playout</span>
        <span class="buffer-track"><i class="buffer-fill"></i></span>
        <span id="buffer-copy" class="buffer-copy">${this.bufferCopy}</span>
        ${this.replayVisible
          ? html`<mn-button
              id="replay-story"
              variant="secondary"
              size="xs"
              label="Replay story"
              @click=${this.emitReplay}
            ></mn-button>`
          : nothing}
        <mn-button
          id="open-library"
          variant="ghost"
          size="xs"
          label="Library"
          @click=${this.emitLibrary}
        ></mn-button>
      </div>

      ${this.anchors.length > 0
        ? html`<div class="filmstrip" aria-label="Generated story anchors">
            ${this.anchors.map(
              (anchor, index) => html`<figure
                data-anchor-index=${index}
                class=${classMap({ 'is-current': index === this.currentAnchor })}
              >
                <img src=${anchor.imageDataUrl} alt=${`Storyboard anchor ${String.fromCharCode(65 + index)}`} />
                <figcaption>
                  <span>${String.fromCharCode(65 + index)}</span>
                  <em>${ANCHOR_BEATS[index] ?? ''}</em>
                </figcaption>
              </figure>`,
            )}
          </div>`
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'afl-broadcast': AflBroadcast
  }
}
