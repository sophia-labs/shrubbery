/**
 * mn-confirmation-dialog — Garden's confirm/alert dialog, made backend-free.
 *
 * The component handles modal presentation, keyboard dismissal, variant styling,
 * and confirm/cancel events. Callers own any destructive work and loading state.
 */

import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { hidePopover, showPopover } from './popover.js'

export type MnConfirmationVariant = 'default' | 'warning' | 'danger'

let confirmationDialogInstance = 0

function deepestActiveElement(ownerDocument: Document): HTMLElement | null {
  let active: Element | null = ownerDocument.activeElement
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active instanceof HTMLElement ? active : null
}

function iconForVariant(variant: MnConfirmationVariant): string {
  switch (variant) {
    case 'warning':
      return 'alert-triangle'
    case 'danger':
      return 'alert-circle'
    case 'default':
    default:
      return 'help-circle'
  }
}

@customElement('mn-confirmation-dialog')
export class MnConfirmationDialog extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      margin: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      max-width: none;
      max-height: none;
      border: 0;
      background: transparent;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-4, 16px);
      box-sizing: border-box;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
    }

    :host([open]) {
      display: flex;
    }

    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: inherit;
      background: var(--mn-color-backdrop, rgba(15, 23, 42, 0.5));
      backdrop-filter: blur(2px);
      box-sizing: border-box;
    }

    .dialog {
      position: relative;
      display: flex;
      width: min(100%, 440px);
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-overlay, #fff);
      box-shadow: var(--mn-shadow-xl, 0 24px 60px rgba(15, 23, 42, 0.22));
    }

    .dialog:focus {
      outline: none;
    }

    .header {
      display: flex;
      align-items: flex-start;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-5, 20px);
      padding-bottom: var(--mn-space-4, 16px);
    }

    .icon-container {
      display: inline-flex;
      width: 40px;
      height: 40px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #2563eb);
    }

    .variant-warning .icon-container {
      background: var(--mn-color-warning-surface, #fef3c7);
      color: var(--mn-color-warning-strong, #b45309);
    }

    .variant-danger .icon-container {
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger-strong, #b91c1c);
    }

    .header-content {
      min-width: 0;
      flex: 1 1 auto;
    }

    .title {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-size: var(--mn-text-lg, 17px);
      font-weight: 650;
      line-height: 1.25;
    }

    .message {
      margin: var(--mn-space-2, 8px) 0 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .rich-content {
      margin-top: var(--mn-space-3, 12px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px) var(--mn-space-5, 20px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-subtle, transparent);
    }

    button {
      min-height: var(--mn-control-height, 30px);
      padding: 0 var(--mn-space-3, 12px);
      border-radius: var(--mn-radius-control, 6px);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
    }

    button:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .cancel-button {
      border: 1px solid transparent;
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .cancel-button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .confirm-button {
      border: 1px solid var(--mn-color-accent, #2563eb);
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
      min-width: 92px;
    }

    .confirm-button:hover:not(:disabled) {
      background: var(--mn-color-accent-hover, #1d4ed8);
      border-color: var(--mn-color-accent-hover, #1d4ed8);
    }

    .variant-warning .confirm-button {
      border-color: var(--mn-color-action-warning, #b45309);
      background: var(--mn-color-action-warning, #b45309);
      color: var(--mn-color-on-warning, #fff);
    }

    .variant-danger .confirm-button {
      border-color: var(--mn-color-action-danger, #b91c1c);
      background: var(--mn-color-action-danger, #b91c1c);
      color: var(--mn-color-on-danger, #fff);
    }

    /* The generic accent hover selector is more specific because of its
       pseudo-classes; keep semantic variants semantic under the pointer too. */
    .variant-warning .confirm-button:hover:not(:disabled) {
      border-color: var(--mn-color-action-warning, #b45309);
      background: var(--mn-color-action-warning, #b45309);
    }

    .variant-danger .confirm-button:hover:not(:disabled) {
      border-color: var(--mn-color-action-danger, #b91c1c);
      background: var(--mn-color-action-danger, #b91c1c);
    }

    @media (max-width: 640px) {
      :host {
        align-items: flex-end;
        padding: 0;
      }

      .overlay {
        align-items: flex-end;
        justify-content: stretch;
        padding: max(var(--mn-space-4, 16px), env(safe-area-inset-top)) 0 0;
      }

      .dialog {
        width: 100%;
        max-height: min(88vh, calc(100vh - max(var(--mn-space-4, 16px), env(safe-area-inset-top))));
        max-height: min(88dvh, calc(100dvh - max(var(--mn-space-4, 16px), env(safe-area-inset-top))));
        overflow: auto;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: var(--mn-radius-xl, 12px) var(--mn-radius-xl, 12px) 0 0;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }

      .header {
        padding-top: var(--mn-space-5, 20px);
      }

      .title {
        font-size: var(--mn-text-xl, 19px);
      }

      .footer {
        flex-direction: column-reverse;
        align-items: stretch;
        padding-bottom: max(var(--mn-space-4, 16px), env(safe-area-inset-bottom));
      }

      button {
        width: 100%;
        min-height: 48px;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) title = 'Confirm Action'
  @property({ type: String }) message = 'Are you sure you want to proceed?'
  @property({ type: String, attribute: 'confirm-text' }) confirmText = 'Confirm'
  @property({ type: String, attribute: 'secondary-confirm-text' }) secondaryConfirmText = ''
  @property({ type: String, attribute: 'cancel-text' }) cancelText = 'Cancel'
  @property({ type: String, reflect: true }) variant: MnConfirmationVariant = 'default'
  @property({ type: Boolean, reflect: true }) loading = false

  @query('.dialog') private dialogEl?: HTMLElement

  private readonly instanceId = ++confirmationDialogInstance
  private readonly overlayId = `confirmation-dialog-${this.instanceId}`
  private previousFocus: HTMLElement | null = null
  private overlayAnnouncedOpen = false

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('popover', 'manual')
    this.ownerDocument.addEventListener('keydown', this.handleKeyDown)
    if (this.hasUpdated && this.open) {
      this.rememberFocus()
      this.announceModalState(true)
      void this.updateComplete.then(() => this.focusInitialControl())
    }
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this.handleKeyDown)
    if (this.overlayAnnouncedOpen) this.announceModalState(false)
    this.restoreFocus()
    // See mn-input-dialog's identical disconnectedCallback comment: the host
    // IS the popover, so hide() must run here to reconcile top-layer state.
    this.hide()
    super.disconnectedCallback()
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return
    if (this.open) {
      showPopover(this)
      this.rememberFocus()
      this.announceModalState(true)
      this.focusInitialControl()
    } else {
      hidePopover(this)
      this.announceModalState(false)
      this.restoreFocus()
    }
  }

  /**
   * Promotes into the native top layer — see mn-input-dialog.show()'s
   * identical doc comment for why (host-as-popover, no PopoverController).
   */
  show(): void {
    this.rememberFocus()
    this.open = true
    showPopover(this)
  }

  hide(): void {
    this.open = false
    this.loading = false
    hidePopover(this)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    } else if (event.key === 'Tab') {
      this.containFocus(event)
    }
  }

  private announceModalState(open: boolean): void {
    if (this.overlayAnnouncedOpen === open) return
    this.overlayAnnouncedOpen = open
    const event = new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: this.overlayId, open, modality: 'modal' },
    })
    if (this.isConnected) this.dispatchEvent(event)
    else this.ownerDocument.dispatchEvent(event)
  }

  private rememberFocus(): void {
    if (this.previousFocus) return
    const active = deepestActiveElement(this.ownerDocument)
    if (active && active !== this) this.previousFocus = active
  }

  private restoreFocus(): void {
    const target = this.previousFocus
    this.previousFocus = null
    if (target?.isConnected) target.focus()
  }

  private focusableElements(): readonly HTMLElement[] {
    const lightDomSelector =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    const slotted = Array.from(this.querySelectorAll<HTMLElement>(lightDomSelector)).filter(
      (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
    )
    const controls = Array.from(
      this.shadowRoot?.querySelectorAll<HTMLElement>('.footer button:not(:disabled)') ?? [],
    )
    return [...slotted, ...controls]
  }

  private focusInitialControl(): void {
    if (!this.open) return
    const cancel = this.shadowRoot?.querySelector<HTMLButtonElement>('.cancel-button:not(:disabled)')
    ;(cancel ?? this.focusableElements()[0] ?? this.dialogEl)?.focus()
  }

  private containFocus(event: KeyboardEvent): void {
    const focusable = this.focusableElements()
    if (focusable.length === 0) {
      event.preventDefault()
      this.dialogEl?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = deepestActiveElement(this.ownerDocument)
    const activeIndex = focusable.indexOf(active as HTMLElement)
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
      event.preventDefault()
      first.focus()
    }
  }

  private confirm(): void {
    this.dispatchEvent(new CustomEvent('mn-confirm', { bubbles: true, composed: true }))
  }

  private secondaryConfirm(): void {
    this.dispatchEvent(new CustomEvent('mn-secondary-confirm', { bubbles: true, composed: true }))
  }

  private cancel(): void {
    if (this.loading) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-cancel', { bubbles: true, composed: true }))
  }

  render() {
    const dialogClass = `dialog variant-${this.variant} ${this.loading ? 'loading' : ''}`
    return html`
      <div class="overlay" @click=${() => this.cancel()}>
        <section
          class=${dialogClass}
          role="alertdialog"
          tabindex="-1"
          aria-modal="true"
          aria-labelledby=${`${this.overlayId}-title`}
          aria-describedby=${`${this.overlayId}-message`}
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="header">
            <span class="icon-container" aria-hidden="true">
              ${icon(iconForVariant(this.variant), { size: 22 })}
            </span>
            <div class="header-content">
              <h2 class="title" id=${`${this.overlayId}-title`}>${this.title}</h2>
              <p class="message" id=${`${this.overlayId}-message`}>${this.message}</p>
              <div class="rich-content"><slot></slot></div>
            </div>
          </header>
          <footer class="footer">
            <button class="cancel-button" type="button" ?disabled=${this.loading} @click=${() => this.cancel()}>
              ${this.cancelText}
            </button>
            ${this.secondaryConfirmText
              ? html`
                  <button
                    class="confirm-button secondary-confirm-button"
                    type="button"
                    ?disabled=${this.loading}
                    @click=${() => this.secondaryConfirm()}
                  >
                    ${this.secondaryConfirmText}
                  </button>
                `
              : ''}
            <button class="confirm-button" type="button" ?disabled=${this.loading} @click=${() => this.confirm()}>
              ${this.confirmText}
            </button>
          </footer>
        </section>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-confirmation-dialog': MnConfirmationDialog
  }
}
