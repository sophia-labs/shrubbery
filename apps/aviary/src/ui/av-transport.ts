/**
 * av-transport.ts — `<av-transport>`: the bottom bar.
 *
 * Two jobs, both of them honesty jobs:
 *   1. THE TRANSPORT — play/pause, stop, a scrubber, and the clock for whatever
 *      the shell's single audio element holds. It owns no audio: it renders
 *      `playback` and emits `av-transport-action`.
 *   2. THE TESTIMONY STRIP — what the `TripleSource` actually said: the adapter
 *      kind, the graph IRI, the parsed triple count, and the read time. A read
 *      error is printed VERBATIM here, which is why neither the rail nor the
 *      stage has to invent a reassuring empty state.
 *
 * The scrubber is a native `<input type="range">` — the one place this app
 * writes a control from scratch, because `@shrubbery/components` has no slider
 * primitive. Its colors are token-derived so it follows skin and theme.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@shrubbery/components'
import type { PlaybackState } from '../shell/audio-player.js'
import { clock } from './format.js'

export type TransportAction = 'toggle' | 'stop'

export interface TransportActionDetail {
  readonly action: TransportAction
}
export interface TransportSeekDetail {
  readonly seconds: number
}

/** What the read seam testified on the last read — displayed, never inferred. */
export interface ReadTestimony {
  readonly kind: string
  readonly liveness: string
  readonly graphIri: string
  readonly tripleCount: number
  readonly readAt: number
}

@customElement('av-transport')
export class AvTransport extends LitElement {
  @property({ attribute: false }) playback: PlaybackState | null = null
  @property({ attribute: false }) testimony: ReadTestimony | null = null
  /** A read-seam failure message, verbatim. */
  @property({ type: String }) error = ''

  static styles = css`
    :host {
      display: block;
      background: var(--mn-bottom-bar-bg, var(--mn-color-surface-chrome, #f3f4f6));
      border-top: var(--mn-chrome-rule, 1px solid var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-bottom-bar-text, var(--mn-color-text-secondary, #4b5563));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      padding: var(--mn-space-1, 0.25rem) var(--mn-space-3, 0.75rem);
      min-height: var(--mn-bottom-bar-height, 34px);
    }
    .now {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 0 0 auto;
      max-width: 32ch;
    }
    .now-label {
      font-size: var(--mn-text-xs, 12px);
      font-weight: var(--mn-font-weight-semibold, 600);
      color: var(--mn-color-text-primary, #111827);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .now-sub {
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #6b7280);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .clockface {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
      flex: 0 0 auto;
    }
    input[type='range'] {
      flex: 1 1 auto;
      min-width: 80px;
      accent-color: var(--mn-color-accent, #376d57);
      background: transparent;
      cursor: pointer;
    }
    input[type='range']:disabled {
      cursor: default;
      opacity: 0.45;
    }
    .testimony {
      flex: 0 0 auto;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #6b7280);
      white-space: nowrap;
    }
    .fault {
      padding: var(--mn-space-1, 0.25rem) var(--mn-space-3, 0.75rem);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-danger, #b91c1c);
      background: var(--mn-color-danger-surface, transparent);
      white-space: pre-wrap;
      border-top: 1px solid var(--mn-color-danger-border, transparent);
    }
  `

  private _act(action: TransportAction): void {
    this.dispatchEvent(
      new CustomEvent<TransportActionDetail>('av-transport-action', {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _seek(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isFinite(value)) return
    this.dispatchEvent(
      new CustomEvent<TransportSeekDetail>('av-transport-seek', {
        detail: { seconds: value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _renderTestimony(): TemplateResult | typeof nothing {
    const t = this.testimony
    if (t === null) return nothing
    const when = new Date(t.readAt).toLocaleTimeString()
    return html`<span class="testimony" title=${t.graphIri}
      >${t.kind} · ${t.liveness} · ${t.tripleCount} triples · read ${when}</span
    >`
  }

  render(): TemplateResult {
    const playback = this.playback
    const track = playback?.track ?? null
    const status = playback?.status ?? 'idle'
    const duration = playback?.duration
    const position = playback?.currentTime ?? 0
    const scrubbable = track !== null && duration !== undefined && Number.isFinite(duration) && duration > 0

    return html`
      <div class="bar">
        <mn-icon-button
          .icon=${status === 'playing' ? 'pause' : 'play'}
          .label=${status === 'playing' ? 'Pause' : 'Play'}
          size="sm"
          ?disabled=${track === null}
          @click=${() => this._act('toggle')}
        ></mn-icon-button>
        <mn-icon-button
          icon="square"
          label="Stop"
          size="sm"
          ?disabled=${track === null}
          @click=${() => this._act('stop')}
        ></mn-icon-button>

        <div class="now">
          <span class="now-label">${track?.label ?? 'nothing loaded'}</span>
          <span class="now-sub">${track?.subtitle ?? 'pick a sample — Enter or Space plays the focused row'}</span>
        </div>

        <span class="clockface">${clock(track === null ? undefined : position)}</span>
        <input
          type="range"
          min="0"
          .max=${String(scrubbable ? duration : 1)}
          step="0.01"
          .value=${String(scrubbable ? Math.min(position, duration) : 0)}
          ?disabled=${!scrubbable}
          aria-label="Seek"
          @input=${this._seek}
        />
        <span class="clockface">${clock(scrubbable ? duration : undefined)}</span>

        ${status === 'loading' ? html`<mn-spinner size="xs" label="Loading audio"></mn-spinner>` : nothing}
        ${this._renderTestimony()}
      </div>
      ${playback?.error
        ? html`<div class="fault" role="alert">playback error (verbatim): ${playback.error}</div>`
        : nothing}
      ${this.error === '' ? nothing : html`<div class="fault" role="alert">${this.error}</div>`}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'av-transport': AvTransport
  }
}
