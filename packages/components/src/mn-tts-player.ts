/**
 * mn-tts-player - Garden's floating text-to-speech playback bar, made controlled.
 *
 * Garden subscribed directly to ttsStore and called ttsService. Shrubbery keeps
 * the desktop playback chrome: host-owned playback state comes in as props and
 * all playback/settings changes leave as intent events.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnTtsStatus = 'idle' | 'loading' | 'playing' | 'paused'
export type MnTtsTier = 'classic' | 'enhanced' | 'local' | string
export type MnTtsAction = 'play' | 'pause' | 'resume' | 'stop' | 'skip-back' | 'skip-forward' | 'speed' | 'tier'

export interface MnTtsTierOption {
  readonly value: MnTtsTier
  readonly label: string
}

export interface MnTtsActionDetail {
  readonly action: MnTtsAction
  readonly status: MnTtsStatus
  readonly speed?: number
  readonly tier?: MnTtsTier
}

const DEFAULT_SPEEDS: readonly number[] = [0.75, 1, 1.25, 1.5, 2]
const DEFAULT_TIERS: readonly MnTtsTierOption[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'enhanced', label: 'Enhanced' },
  { value: 'local', label: 'Local' },
]

@customElement('mn-tts-player')
export class MnTtsPlayer extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([mobile]) {
      display: none;
    }

    .tts-bar {
      position: var(--mn-tts-player-position, fixed);
      right: 0;
      bottom: 0;
      left: 0;
      z-index: var(--mn-z-overlay, 1500);
      display: flex;
      height: 40px;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: 0 var(--mn-space-4, 16px);
      border-top: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      animation: mn-tts-slide-up 150ms ease-out;
      box-sizing: border-box;
    }

    @keyframes mn-tts-slide-up {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }

    .controls,
    .end-controls {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    .end-controls {
      margin-left: auto;
    }

    .tts-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-1, 4px);
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      transition:
        color var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease);
    }

    .tts-btn:hover:not(:disabled),
    .tts-btn:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .tts-btn:disabled {
      cursor: default;
      opacity: 0.35;
    }

    .tts-btn.primary {
      color: var(--mn-color-text-accent, #2563eb);
    }

    .tts-btn.stop {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .tts-btn.stop:hover,
    .tts-btn.stop:focus-visible {
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .progress {
      min-width: 50px;
      flex: 0 0 auto;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .loading {
      color: var(--mn-color-text-muted, #6b7280);
    }

    .block-preview {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      padding: 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-type-ui-xs-size, 11px);
      font-style: italic;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    select {
      flex: 0 0 auto;
      padding: 2px var(--mn-space-1, 4px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-type-ui-xs-size, 11px);
    }

    select:hover,
    select:focus-visible {
      border-color: var(--mn-color-border-strong, #9ca3af);
      outline: none;
    }

    .separator {
      width: 1px;
      height: 16px;
      flex: 0 0 auto;
      background: var(--mn-color-border-default, #d1d5db);
    }
  `

  @property({ type: String, reflect: true }) status: MnTtsStatus = 'idle'
  @property({ type: Number, attribute: 'current-block-index' }) currentBlockIndex = 0
  @property({ type: Number, attribute: 'total-blocks' }) totalBlocks = 0
  @property({ type: String, attribute: 'current-block-text' }) currentBlockText = ''
  @property({ type: String }) tier: MnTtsTier = 'classic'
  @property({ type: Number }) speed = 1
  @property({ attribute: false }) speeds: readonly number[] = DEFAULT_SPEEDS
  @property({ attribute: false }) tiers: readonly MnTtsTierOption[] = DEFAULT_TIERS
  @property({ type: String, attribute: 'stop-shortcut' }) stopShortcut = 'Ctrl+Alt+L'
  @property({ type: Boolean, reflect: true }) mobile = false

  private emitAction(detail: MnTtsActionDetail): void {
    this.dispatchEvent(new CustomEvent<MnTtsActionDetail>('mn-tts-action', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnTtsActionDetail>(`mn-tts-${detail.action}`, { detail, bubbles: true, composed: true }))
  }

  private togglePlayPause(): void {
    if (this.status === 'playing') {
      this.emitAction({ action: 'pause', status: this.status })
    } else if (this.status === 'paused') {
      this.emitAction({ action: 'resume', status: this.status })
    } else {
      this.emitAction({ action: 'play', status: this.status })
    }
  }

  private stop(): void {
    this.emitAction({ action: 'stop', status: this.status })
  }

  private skipBack(): void {
    this.emitAction({ action: 'skip-back', status: this.status })
  }

  private skipForward(): void {
    this.emitAction({ action: 'skip-forward', status: this.status })
  }

  private changeSpeed(event: Event): void {
    const speed = Number.parseFloat((event.target as HTMLSelectElement).value)
    this.emitAction({ action: 'speed', status: this.status, speed })
  }

  private changeTier(event: Event): void {
    const tier = (event.target as HTMLSelectElement).value
    this.emitAction({ action: 'tier', status: this.status, tier })
  }

  private renderPlaybackControls(): TemplateResult {
    if (this.status === 'loading') return html`<span class="loading">Loading...</span>`
    return html`
      <button
        type="button"
        class="tts-btn primary"
        title=${this.status === 'playing' ? 'Pause' : 'Resume'}
        @click=${this.togglePlayPause}
      >
        ${icon(this.status === 'playing' ? 'pause' : 'play', { size: 16 })}
      </button>
    `
  }

  private renderBlockControls(): TemplateResult | typeof nothing {
    if (this.totalBlocks <= 1) return nothing
    return html`
      <div class="separator"></div>
      <button type="button" class="tts-btn" title="Previous block" ?disabled=${this.currentBlockIndex === 0} @click=${this.skipBack}>
        ${icon('skip-back', { size: 14 })}
      </button>
      <span class="progress">${this.currentBlockIndex + 1} / ${this.totalBlocks}</span>
      <button
        type="button"
        class="tts-btn"
        title="Next block"
        ?disabled=${this.currentBlockIndex >= this.totalBlocks - 1}
        @click=${this.skipForward}
      >
        ${icon('skip-forward', { size: 14 })}
      </button>
    `
  }

  override render(): TemplateResult | typeof nothing {
    if (this.status === 'idle') return nothing
    return html`
      <div class="tts-bar">
        <div class="controls">
          ${this.renderPlaybackControls()}
          <button type="button" class="tts-btn stop" title=${`Stop (${this.stopShortcut})`} @click=${this.stop}>
            ${icon('stop', { size: 14 })}
          </button>
          ${this.renderBlockControls()}
        </div>

        ${this.currentBlockText ? html`<span class="block-preview">${this.currentBlockText}</span>` : nothing}

        <div class="end-controls">
          <select .value=${String(this.speed)} title="Playback speed" @change=${this.changeSpeed}>
            ${this.speeds.map(value => html`<option value=${value} ?selected=${this.speed === value}>${value}x</option>`)}
          </select>
          <select .value=${this.tier} title="Voice tier" @change=${this.changeTier}>
            ${this.tiers.map(option => html`<option value=${option.value} ?selected=${this.tier === option.value}>${option.label}</option>`)}
          </select>
          <div class="separator"></div>
          <button type="button" class="tts-btn" title="Close" @click=${this.stop}>
            ${icon('x', { size: 14 })}
          </button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-tts-player': MnTtsPlayer
  }
}
