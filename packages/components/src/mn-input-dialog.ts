/**
 * mn-input-dialog — Garden's text prompt dialog, made backend-free.
 *
 * This replaces `window.prompt()`-style flows with a themed, controlled custom
 * element. The component owns only transient input/focus state; callers own
 * validation, persistence, loading, and closing policy.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { hidePopover, showPopover } from './popover.js'

export interface MnInputDialogConfirmDetail {
  readonly value: string
}

let inputDialogInstance = 0

function deepestActiveElement(ownerDocument: Document): HTMLElement | null {
  let active: Element | null = ownerDocument.activeElement
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active instanceof HTMLElement ? active : null
}

@customElement('mn-input-dialog')
export class MnInputDialog extends SkinAware(LitElement) {
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
      padding: var(--mn-space-5, 20px) var(--mn-space-5, 20px) var(--mn-space-3, 12px);
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

    .body {
      padding: 0 var(--mn-space-5, 20px) var(--mn-space-4, 16px);
    }

    .input {
      width: 100%;
      height: var(--mn-control-height-lg, 36px);
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      box-sizing: border-box;
    }

    .input:focus {
      border-color: var(--mn-focus-ring-color, #2563eb);
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
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

      .input {
        min-height: 48px;
        height: 48px;
        font-size: max(16px, var(--mn-text-base, 15px));
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
  @property({ type: String }) title = 'Enter Value'
  @property({ type: String }) message = ''
  @property({ type: String }) value = ''
  @property({ type: String }) placeholder = ''
  @property({ type: String, attribute: 'confirm-text' }) confirmText = 'OK'
  @property({ type: String, attribute: 'cancel-text' }) cancelText = 'Cancel'
  @property({ type: Boolean, reflect: true }) loading = false
  @property({ type: Boolean, attribute: 'select-on-open' }) selectOnOpen = true

  @query('.input') private inputEl?: HTMLInputElement
  @query('.dialog') private dialogEl?: HTMLElement

  private readonly instanceId = ++inputDialogInstance
  private readonly overlayId = `input-dialog-${this.instanceId}`
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
    // The host IS the popover (no inner wrapper), so nothing else clears its
    // top-layer state on removal — mirrors mn-context-menu's disconnect
    // handling. hide() is idempotent and reconciles both the native/attribute
    // popover-open state and `open`.
    this.hide()
    super.disconnectedCallback()
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return
    if (this.open) {
      // `open` is a controlled property in the mobile shell, while `show()` is
      // still the imperative compatibility seam. Keep both paths in the same
      // native top-layer lifecycle.
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
   * Promotes into the native top layer via the raw showPopover()/hidePopover()
   * functions (the host itself is the popover, so PopoverController's
   * anchor+child-popover shape doesn't fit here) — without this, a dialog
   * opened while another top-layer surface (a context menu, the workspace
   * selector, etc.) is already open would render UNDER it regardless of
   * z-index, since native top-layer content unconditionally outranks
   * regular stacking contexts.
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

  private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing || this.loading) return
    event.preventDefault()
    this.confirm()
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
    return Array.from(
      this.shadowRoot?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? [],
    )
  }

  private focusInitialControl(): void {
    if (!this.open) return
    const input = this.inputEl
    const target = input?.disabled ? this.focusableElements()[0] : input
    ;(target ?? this.dialogEl)?.focus()
    if (input && target === input && this.selectOnOpen && this.value) input.select()
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
    const value = this.inputEl?.value ?? this.value
    this.dispatchEvent(
      new CustomEvent<MnInputDialogConfirmDetail>('mn-confirm', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private cancel(): void {
    if (this.loading) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-cancel', { bubbles: true, composed: true }))
  }

  private handleInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value
  }

  render() {
    return html`
      <div class="overlay" @click=${() => this.cancel()}>
        <section
          class=${`dialog ${this.loading ? 'loading' : ''}`}
          role="dialog"
          tabindex="-1"
          aria-modal="true"
          aria-labelledby=${`${this.overlayId}-title`}
          aria-describedby=${this.message ? `${this.overlayId}-message` : nothing}
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="header">
            <span class="icon-container" aria-hidden="true">${icon('file-text', { size: 22 })}</span>
            <div class="header-content">
              <h2 class="title" id=${`${this.overlayId}-title`}>${this.title}</h2>
              ${this.message ? html`<p class="message" id=${`${this.overlayId}-message`}>${this.message}</p>` : ''}
            </div>
          </header>
          <div class="body">
            <input
              class="input"
              type="text"
              .value=${this.value}
              placeholder=${this.placeholder}
              ?disabled=${this.loading}
              @input=${this.handleInput}
              @keydown=${this.handleInputKeyDown}
            />
          </div>
          <footer class="footer">
            <button class="cancel-button" type="button" ?disabled=${this.loading} @click=${() => this.cancel()}>
              ${this.cancelText}
            </button>
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
    'mn-input-dialog': MnInputDialog
  }
}
