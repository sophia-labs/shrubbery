/**
 * mn-toast — Garden's floating notification primitive.
 *
 * It is intentionally store-free: hosts create/remove toasts and listen for
 * `mn-action`, `mn-show`, and `mn-dismiss` intents.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnToastType = 'info' | 'success' | 'warning' | 'error'
export type MnToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

@customElement('mn-toast')
export class MnToast extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      z-index: var(--mn-z-toast, 1600);
      max-width: min(400px, calc(100vw - 32px));
      pointer-events: none;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([visible]) {
      pointer-events: auto;
    }

    :host([position='top-left']) {
      top: var(--mn-space-4, 16px);
      left: var(--mn-space-4, 16px);
    }

    :host([position='top-center']) {
      top: var(--mn-space-4, 16px);
      left: 50%;
      transform: translateX(-50%);
    }

    :host([position='top-right']) {
      top: var(--mn-space-4, 16px);
      right: var(--mn-space-4, 16px);
    }

    :host([position='bottom-left']) {
      bottom: var(--mn-space-4, 16px);
      left: var(--mn-space-4, 16px);
    }

    :host([position='bottom-center']) {
      bottom: var(--mn-space-4, 16px);
      left: 50%;
      transform: translateX(-50%);
    }

    :host([position='bottom-right']) {
      right: var(--mn-space-4, 16px);
      bottom: var(--mn-space-4, 16px);
    }

    .toast {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: var(--mn-space-3, 12px);
      box-sizing: border-box;
      width: 100%;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-left-width: 3px;
      border-radius: var(--mn-radius-surface, var(--mn-radius-lg, 8px));
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-modal, 0 18px 40px rgba(15, 23, 42, 0.16));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
      opacity: 0;
      transform: translateY(-12px);
      transition:
        opacity var(--mn-transition-normal, 180ms ease),
        transform var(--mn-transition-normal, 180ms ease);
    }

    :host([visible]) .toast {
      opacity: 1;
      transform: translateY(0);
    }

    :host([closing]) .toast {
      opacity: 0;
      transform: translateY(-12px);
    }

    .type-info {
      border-left-color: var(--mn-color-border-accent, #2563eb);
    }

    .type-success {
      border-left-color: var(--mn-color-text-success, #15803d);
    }

    .type-warning {
      border-left-color: var(--mn-color-text-warning, #b45309);
    }

    .type-error {
      border-left-color: var(--mn-color-text-danger, #b91c1c);
    }

    .type-info .toast-icon {
      color: var(--mn-color-text-accent, #4338ca);
    }

    .type-success .toast-icon {
      color: var(--mn-color-text-success, #15803d);
    }

    .type-warning .toast-icon {
      color: var(--mn-color-text-warning, #b45309);
    }

    .type-error .toast-icon {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .toast-icon {
      display: inline-flex;
      flex: 0 0 auto;
      margin-top: 2px;
    }

    .content {
      min-width: 0;
      flex: 1 1 auto;
    }

    .message,
    .description {
      margin: 0;
    }

    .message {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .description {
      margin-top: var(--mn-space-1, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .actions {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      gap: var(--mn-space-2, 8px);
    }

    .action-button,
    .close-button {
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      cursor: pointer;
      font: inherit;
      outline: none;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .action-button {
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      color: var(--mn-color-text-accent, #4338ca);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }

    .action-button:hover,
    .action-button:focus-visible {
      background: var(--mn-color-surface-accent, #eef2ff);
    }

    .close-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .close-button:hover,
    .close-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .progress-bar {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 2px;
      overflow: hidden;
      background: var(--mn-color-surface-sunken, #f3f4f6);
    }

    .progress-fill {
      height: 100%;
      background: var(--mn-color-accent, #2563eb);
      transition: width linear;
    }
  `

  @property({ type: String, reflect: true }) type: MnToastType = 'info'
  @property({ type: String, reflect: true }) position: MnToastPosition = 'bottom-right'
  @property({ type: String }) message = ''
  @property({ type: String }) description = ''
  @property({ type: String, attribute: 'action-text' }) actionText = ''
  @property({ type: Boolean }) closable = true
  @property({ type: Number }) duration = 5000
  @property({ type: Boolean, attribute: 'show-progress' }) showProgress = false
  @property({ type: Boolean, reflect: true }) visible = false
  @property({ type: Boolean, reflect: true }) closing = false
  @property({ type: Boolean, attribute: 'auto-remove' }) autoRemove = true
  @property({ type: Boolean, attribute: 'auto-show' }) autoShow = true
  @property({ type: Number, attribute: 'animation-ms' }) animationMs = 180

  @state() private progress = 100

  private timeoutId: number | undefined
  private rafId: number | undefined
  private startedAt = 0

  override connectedCallback(): void {
    super.connectedCallback()
    if (this.autoShow) window.setTimeout(() => this.show(), 100)
  }

  override disconnectedCallback(): void {
    this.clearTimers()
    super.disconnectedCallback()
  }

  show(): void {
    this.clearTimers()
    this.visible = true
    this.closing = false
    this.progress = 100
    this.startAutoDismiss()
    this.dispatchEvent(new CustomEvent('mn-show', { bubbles: true, composed: true }))
  }

  dismiss(): void {
    this.clearTimers()
    if (!this.visible && this.closing) return
    this.closing = true
    window.setTimeout(() => {
      this.visible = false
      this.closing = false
      this.dispatchEvent(new CustomEvent('mn-dismiss', { bubbles: true, composed: true }))
      if (this.autoRemove && this.isConnected) this.remove()
    }, this.animationMs)
  }

  private iconName(): string {
    if (this.type === 'success') return 'check'
    if (this.type === 'warning') return 'alert-triangle'
    if (this.type === 'error') return 'alert-circle'
    return 'info'
  }

  private clearTimers(): void {
    if (this.timeoutId !== undefined) window.clearTimeout(this.timeoutId)
    if (this.rafId !== undefined) window.cancelAnimationFrame(this.rafId)
    this.timeoutId = undefined
    this.rafId = undefined
  }

  private startAutoDismiss(): void {
    if (this.duration <= 0) return
    this.startedAt = Date.now()
    if (this.showProgress) this.updateProgress()
    this.timeoutId = window.setTimeout(() => this.dismiss(), this.duration)
  }

  private updateProgress(): void {
    const elapsed = Date.now() - this.startedAt
    this.progress = Math.max(0, 100 - (elapsed / this.duration) * 100)
    if (this.progress > 0) {
      this.rafId = window.requestAnimationFrame(() => this.updateProgress())
    }
  }

  private handleAction(event: MouseEvent): void {
    event.stopPropagation()
    this.dispatchEvent(new CustomEvent('mn-action', { bubbles: true, composed: true }))
    this.dismiss()
  }

  private handleClose(event: MouseEvent): void {
    event.stopPropagation()
    this.dismiss()
  }

  override render() {
    return html`
      <div class=${classMap({ toast: true, [`type-${this.type}`]: true })} role="alert" aria-live="polite">
        <span class="toast-icon" aria-hidden="true">${icon(this.iconName(), { size: 18 })}</span>

        <div class="content">
          <p class="message">${this.message}</p>
          ${this.description ? html`<p class="description">${this.description}</p>` : nothing}
        </div>

        <div class="actions">
          ${this.actionText
            ? html`<button class="action-button" type="button" @click=${this.handleAction}>${this.actionText}</button>`
            : nothing}
          ${this.closable
            ? html`
                <button class="close-button" type="button" aria-label="Close" @click=${this.handleClose}>
                  ${icon('x', { size: 16 })}
                </button>
              `
            : nothing}
        </div>

        ${this.showProgress && this.duration > 0
          ? html`
              <div class="progress-bar" aria-hidden="true">
                <div
                  class="progress-fill"
                  style=${`width: ${this.progress}%; transition-duration: ${this.duration}ms;`}
                ></div>
              </div>
            `
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-toast': MnToast
  }
}
