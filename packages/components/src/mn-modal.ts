/**
 * mn-modal — Garden's slot-based modal shell.
 *
 * This is the light-DOM compatible modal used by shared Garden flows. It stays
 * controlled and backend-free: hosts own `open`, content, and persistence.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

@customElement('mn-modal')
export class MnModal extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
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
      background: var(--mn-color-backdrop, rgba(15, 23, 42, 0.45));
      backdrop-filter: var(--mn-window-backdrop-filter, blur(2px));
      opacity: 0;
      transition: opacity var(--mn-transition-normal, 180ms ease);
    }

    :host([open]) .overlay {
      opacity: 1;
    }

    .container {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
    }

    .size-sm .dialog {
      max-width: 400px;
    }

    .size-md .dialog {
      max-width: 560px;
    }

    .size-lg .dialog {
      max-width: 720px;
    }

    .size-xl .dialog {
      max-width: 960px;
    }

    .size-full {
      padding: 0;
    }

    .size-full .dialog {
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      border-radius: 0;
    }

    .dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      max-height: calc(100vh - var(--mn-space-8, 32px));
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, transparent);
      border-radius: var(--mn-radius-surface, var(--mn-radius-xl, 12px));
      background: var(--mn-color-surface-overlay, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-xl, var(--mn-shadow-modal, 0 24px 60px rgba(15, 23, 42, 0.2)));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
      opacity: 0;
      transform: scale(0.96) translateY(12px);
      transition:
        opacity var(--mn-transition-normal, 180ms ease),
        transform var(--mn-transition-normal, 180ms ease);
    }

    :host([open]) .dialog {
      opacity: 1;
      transform: scale(1) translateY(0);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-5, 20px) var(--mn-space-6, 24px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 34%, transparent);
    }

    .header-content {
      min-width: 0;
      flex: 1 1 auto;
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
    }

    .close-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      outline: none;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .close-button:hover,
    .close-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .close-button:focus-visible {
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }

    .body {
      min-height: 0;
      flex: 1 1 auto;
      overflow-y: auto;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.6;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex: 0 0 auto;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-4, 16px) var(--mn-space-6, 24px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-subtle, #fff);
    }

    @media (max-width: 768px) {
      .container:not(.size-full) {
        align-items: flex-end;
        padding: 0;
      }

      .container:not(.size-full) .dialog {
        max-height: 100%;
        border-radius: var(--mn-radius-xl, 12px) var(--mn-radius-xl, 12px) 0 0;
      }

      .header,
      .body,
      .footer {
        padding-inline: var(--mn-space-4, 16px);
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String, reflect: true }) size: MnModalSize = 'md'
  @property({ type: Boolean }) closable = true
  @property({ type: Boolean, attribute: 'close-on-backdrop' }) closeOnBackdrop = true
  @property({ type: Boolean, attribute: 'close-on-escape' }) closeOnEscape = true
  @property({ type: Boolean, attribute: 'lock-body-scroll' }) lockBodyScroll = true

  @query('.dialog') private dialogElement?: HTMLElement

  private previousFocus?: HTMLElement
  private previousBodyOverflow = ''

  override connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('keydown', this.handleKeyDown)
  }

  override disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this.handleKeyDown)
    this.allowBodyScroll()
    this.restoreFocus()
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('open')) return
    if (this.open) {
      this.captureFocus()
      if (this.lockBodyScroll) this.preventBodyScroll()
      void this.updateComplete.then(() => this.focusFirstElement())
    } else {
      this.allowBodyScroll()
      this.restoreFocus()
    }
  }

  openModal(): void {
    if (this.open) return
    this.open = true
    this.dispatchEvent(new CustomEvent('mn-open', { bubbles: true, composed: true }))
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private captureFocus(): void {
    this.previousFocus = this.ownerDocument.activeElement as HTMLElement | undefined
  }

  private restoreFocus(): void {
    this.previousFocus?.focus?.()
    this.previousFocus = undefined
  }

  private preventBodyScroll(): void {
    const body = this.ownerDocument.body
    if (!body) return
    if (body.style.overflow !== 'hidden') this.previousBodyOverflow = body.style.overflow
    body.style.overflow = 'hidden'
  }

  private allowBodyScroll(): void {
    const body = this.ownerDocument.body
    if (!body) return
    body.style.overflow = this.previousBodyOverflow
    this.previousBodyOverflow = ''
  }

  private focusFirstElement(): void {
    const focusable = this.dialogElement?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || !this.closeOnEscape || event.key !== 'Escape') return
    event.preventDefault()
    this.close()
  }

  private handleOverlayClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop || event.target !== event.currentTarget) return
    this.close()
  }

  override render() {
    return html`
      <div class="overlay" @click=${this.handleOverlayClick}>
        <div class=${classMap({ container: true, [`size-${this.size}`]: true })} @click=${this.handleOverlayClick}>
          <div class="dialog" role="dialog" aria-modal="true" @click=${(event: Event) => event.stopPropagation()}>
            <div class="header">
              <div class="header-content"><slot name="header"></slot></div>
              ${this.closable
                ? html`
                    <button class="close-button" type="button" aria-label="Close" @click=${() => this.close()}>
                      ${icon('x', { size: 20 })}
                    </button>
                  `
                : nothing}
            </div>

            <div class="body"><slot></slot></div>
            <div class="footer"><slot name="footer"></slot></div>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-modal': MnModal
  }
}
