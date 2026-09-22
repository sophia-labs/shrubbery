/**
 * mn-cloud-mode-pill - Garden's local/Sophia Cloud status marker, made controlled.
 *
 * Garden derives this from hosted-mode services, auth store, credential bridge,
 * timers, and body-level panel creation. Shrubbery keeps it as a tiny controlled
 * status button: the host provides mode/status and receives an open-panel intent.
 */

import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

export type MnCloudMode = 'local' | 'hosted'
export type MnCloudModeStatus = 'local' | 'connected' | 'stale' | 'signed-out'

export interface MnCloudModePillOpenDetail {
  readonly mode: MnCloudMode
  readonly status: MnCloudModeStatus
}

@customElement('mn-cloud-mode-pill')
export class MnCloudModePill extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1-5, 6px);
      height: 20px;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-full, 999px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      letter-spacing: var(--mn-type-label-tracking, 0.05em);
      line-height: 1;
      text-transform: uppercase;
      transition:
        color var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        opacity var(--mn-transition-fast, 120ms ease);
    }

    button:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: 1px;
    }

    .dot {
      width: 5px;
      height: 5px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: currentColor;
      transition: transform var(--mn-transition-fast, 120ms ease);
    }

    button:hover .dot {
      transform: scale(1.15);
    }

    .local {
      opacity: 0.75;
    }

    .local .dot {
      background: var(--mn-color-text-disabled, #9ca3af);
    }

    .local:hover {
      opacity: 1;
    }

    .connected {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .connected .dot {
      background: var(--mn-color-accent, #2563eb);
    }

    .connected:hover {
      border-color: var(--mn-color-accent, #2563eb);
    }

    .stale {
      border-color: var(--mn-color-warning-border, #f59e0b);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #b45309);
    }

    .stale .dot {
      background: var(--mn-color-warning, #d97706);
      animation: mn-cloud-pulse 1.4s ease-in-out infinite;
    }

    .signed-out {
      border-color: var(--mn-color-border-accent, #93c5fd);
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .signed-out .dot {
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-accent, #93c5fd);
      background: transparent;
    }

    .signed-out:hover {
      border-color: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    @keyframes mn-cloud-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .stale .dot {
        animation: none;
      }

      button .dot {
        transition: none;
      }
    }
  `

  @property({ type: String, reflect: true }) mode: MnCloudMode = 'local'
  @property({ type: String, reflect: true }) status: MnCloudModeStatus = 'local'

  private get effectiveStatus(): MnCloudModeStatus {
    if (this.mode !== 'hosted') return 'local'
    return this.status === 'local' ? 'signed-out' : this.status
  }

  private get label(): string {
    switch (this.effectiveStatus) {
      case 'connected':
        return 'Cloud'
      case 'stale':
        return 'Reconnecting'
      case 'signed-out':
        return 'Signed out'
      default:
        return 'Local'
    }
  }

  private get tooltip(): string {
    return this.effectiveStatus === 'local'
      ? 'Local mode - click to connect to Sophia Cloud'
      : 'Sophia Cloud - click to manage'
  }

  private openPanel(): void {
    const detail: MnCloudModePillOpenDetail = {
      mode: this.mode,
      status: this.effectiveStatus,
    }
    this.dispatchEvent(new CustomEvent<MnCloudModePillOpenDetail>('mn-open', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnCloudModePillOpenDetail>('mn-cloud-mode-open', { detail, bubbles: true, composed: true }))
  }

  override render(): TemplateResult {
    const status = this.effectiveStatus
    const label = this.label
    return html`
      <button
        type="button"
        class=${status}
        title=${this.tooltip}
        aria-label=${`Mode: ${label}`}
        @click=${this.openPanel}
      >
        <span class="dot"></span>
        ${label}
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-cloud-mode-pill': MnCloudModePill
  }
}
