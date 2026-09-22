/**
 * mn-continuity-status: controlled feedback for work that crosses an async or
 * connectivity boundary.
 *
 * The component never infers transport or persistence state. Hosts supply an
 * honest state/copy pair and handle the optional action intent. `ready` is
 * deliberately quiet unless the host supplies a label (for a transient
 * confirmation such as "Saved").
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

export type MnContinuityState =
  | 'ready'
  | 'loading'
  | 'saving'
  | 'offline'
  | 'reconnecting'
  | 'error'

export type MnContinuityVariant = 'banner' | 'inline'

export interface MnContinuityActionDetail {
  readonly state: MnContinuityState
}

const DEFAULT_LABELS: Record<MnContinuityState, string> = {
  ready: 'Up to date',
  loading: 'Loading',
  saving: 'Saving changes',
  offline: 'Offline',
  reconnecting: 'Reconnecting',
  error: 'Something went wrong',
}

@customElement('mn-continuity-status')
export class MnContinuityStatus extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      min-width: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .status {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: 44px;
      padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      border-block: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .status[data-variant='inline'] {
      min-height: 36px;
      padding: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 8px);
    }

    .status[data-state='offline'],
    .status[data-state='reconnecting'] {
      color: var(--mn-color-warning-strong, #92400e);
      background: var(--mn-color-warning-surface, #fffbeb);
      border-color: color-mix(in srgb, currentColor 18%, transparent);
    }

    .status[data-state='error'] {
      color: var(--mn-color-danger, #b91c1c);
      background: var(--mn-color-danger-surface, #fff1f2);
      border-color: color-mix(in srgb, currentColor 18%, transparent);
    }

    .indicator {
      display: inline-grid;
      width: 18px;
      height: 18px;
      place-items: center;
      flex: 0 0 auto;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
    }

    [data-progress='true'] .dot {
      width: 12px;
      height: 12px;
      border: 2px solid color-mix(in srgb, currentColor 26%, transparent);
      border-top-color: currentColor;
      background: transparent;
      animation: mn-continuity-spin 0.8s linear infinite;
    }

    .copy {
      min-width: 0;
      line-height: 1.35;
    }

    .label {
      color: currentColor;
      font-size: var(--mn-text-sm, 13px);
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    .detail {
      margin-inline-start: var(--mn-space-1, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
    }

    button {
      min-width: var(--mn-touch-target-size, 48px);
      min-height: var(--mn-touch-target-size, 48px);
      margin-block: -4px;
      padding-inline: var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-control, 8px);
      background: transparent;
      color: currentColor;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      font-weight: var(--mn-font-weight-semibold, 600);
      cursor: pointer;
      touch-action: manipulation;
    }

    button:hover {
      background: color-mix(in srgb, currentColor 9%, transparent);
    }

    button:focus-visible {
      outline: var(--mn-focus-ring-width, 2px) solid var(--mn-focus-ring-color, currentColor);
      outline-offset: -3px;
    }

    :host([data-skin='98']) .status {
      border-radius: 0;
    }

    @keyframes mn-continuity-spin {
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      [data-progress='true'] .dot { animation: none; }
    }

    @media (max-width: 600px) {
      .status {
        padding-inline:
          max(var(--mn-space-3, 12px), env(safe-area-inset-left, 0px))
          max(var(--mn-space-3, 12px), env(safe-area-inset-right, 0px));
      }

      .detail {
        display: block;
        margin-inline-start: 0;
        font-size: var(--mn-text-xs, 12px);
      }
    }
  `

  @property({ type: String, reflect: true }) state: MnContinuityState = 'ready'
  @property({ type: String, reflect: true }) variant: MnContinuityVariant = 'banner'
  @property({ type: String }) label = ''
  @property({ type: String }) detail = ''
  @property({ type: String, attribute: 'action-label' }) actionLabel = ''

  private emitAction(): void {
    this.dispatchEvent(new CustomEvent<MnContinuityActionDetail>('continuity-action', {
      detail: { state: this.state },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    if (this.state === 'ready' && !this.label && !this.detail && !this.actionLabel) return nothing

    const progress = this.state === 'loading' || this.state === 'saving' || this.state === 'reconnecting'
    const label = this.label || DEFAULT_LABELS[this.state]
    const role = this.state === 'error' ? 'alert' : 'status'

    return html`
      <div
        class="status"
        data-state=${this.state}
        data-variant=${this.variant}
        data-progress=${progress}
        role=${role}
        aria-live=${this.state === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy=${progress ? 'true' : 'false'}
      >
        <span class="indicator" aria-hidden="true"><span class="dot"></span></span>
        <span class="copy">
          <span class="label">${label}</span>
          ${this.detail ? html`<span class="detail">${this.detail}</span>` : nothing}
        </span>
        ${this.actionLabel
          ? html`<button type="button" @click=${this.emitAction}>${this.actionLabel}</button>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-continuity-status': MnContinuityStatus
  }
}
