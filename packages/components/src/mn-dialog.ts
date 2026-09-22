/**
 * mn-dialog — Garden's native-dialog primitive.
 *
 * This provides the general slot-based `<dialog>` shell used by Garden for rich
 * editor flows. It stays backend-free; static confirm/prompt helpers create only
 * DOM nodes and resolve local user intent.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnDialogSize = 'sm' | 'md' | 'lg'

export interface MnDialogCloseDetail {
  readonly returnValue: string
}

export interface MnDialogConfirmOptions {
  readonly title: string
  readonly message: string
  readonly confirmText?: string
  readonly cancelText?: string
  readonly variant?: 'default' | 'danger' | 'warning'
  readonly size?: MnDialogSize
}

export interface MnDialogPromptOptions {
  readonly title: string
  readonly message?: string
  readonly value?: string
  readonly placeholder?: string
  readonly confirmText?: string
  readonly cancelText?: string
  readonly size?: MnDialogSize
}

type DialogWithOptionalApi = HTMLDialogElement & {
  showModal?: () => void
  close?: (returnValue?: string) => void
}

function buttonStyle(kind: 'cancel' | 'confirm' | 'danger' | 'warning'): string {
  const base =
    'padding:var(--mn-space-2,8px) var(--mn-space-4,16px);' +
    'font-family:var(--mn-font-utility,system-ui,sans-serif);' +
    'font-size:var(--mn-text-sm,13px);border:none;cursor:pointer;' +
    'border-radius:var(--mn-radius-control,var(--mn-radius-md,6px));min-width:72px;'
  if (kind === 'cancel') {
    return `${base}background:transparent;color:var(--mn-color-text-secondary,#4b5563);`
  }
  const bg =
    kind === 'danger'
      ? 'var(--mn-color-text-danger,#b91c1c)'
      : kind === 'warning'
        ? 'var(--mn-color-text-warning,#b45309)'
        : 'var(--mn-color-accent,#2563eb)'
  return `${base}background:${bg};color:var(--mn-color-text-on-accent,#fff);`
}

function requestFrame(callback: FrameRequestCallback): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback)
  else window.setTimeout(() => callback(performance.now()), 0)
}

@customElement('mn-dialog')
export class MnDialog extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: contents;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
    }

    dialog {
      width: min(560px, calc(100vw - var(--mn-space-8, 32px)));
      max-height: calc(100dvh - var(--mn-space-8, 32px));
      margin: auto;
      padding: 0;
      overflow: visible;
      border: 0;
      background: transparent;
      color: inherit;
    }

    dialog::backdrop {
      background: var(--mn-color-backdrop, rgba(15, 23, 42, 0.45));
      backdrop-filter: var(--mn-window-backdrop-filter, blur(2px));
    }

    dialog.size-sm {
      width: min(400px, calc(100vw - var(--mn-space-8, 32px)));
    }

    dialog.size-md {
      width: min(560px, calc(100vw - var(--mn-space-8, 32px)));
    }

    dialog.size-lg {
      width: min(720px, calc(100vw - var(--mn-space-8, 32px)));
    }

    .dialog-inner {
      display: flex;
      flex-direction: column;
      max-height: calc(100dvh - var(--mn-space-8, 32px));
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, transparent);
      border-radius: var(--mn-radius-surface, var(--mn-radius-xl, 12px));
      background: var(--mn-color-surface-overlay, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-modal, 0 24px 60px rgba(15, 23, 42, 0.2));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }

    dialog[open] .dialog-inner {
      opacity: 1;
      transform: scale(1) translateY(0);
      transition:
        opacity var(--mn-transition-normal, 180ms ease),
        transform var(--mn-transition-normal, 180ms ease);
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
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-size: var(--mn-type-heading-size, 1rem);
      font-weight: 650;
      line-height: 1.2;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, var(--mn-radius-md, 6px));
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      outline: none;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .close-btn:hover,
    .close-btn:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .close-btn:focus-visible {
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }

    .body {
      min-height: 0;
      flex: 1 1 auto;
      overflow-y: auto;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      line-height: var(--mn-leading-relaxed, 1.65);
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

    @media (max-width: 640px) {
      dialog.size-sm,
      dialog.size-md,
      dialog.size-lg {
        width: 100%;
        margin: auto auto 0;
      }

      .dialog-inner {
        max-height: 90dvh;
        border-radius: var(--mn-radius-xl, 12px) var(--mn-radius-xl, 12px) 0 0;
      }
    }
  `

  @property({ type: String, reflect: true }) size: MnDialogSize = 'md'
  @property({ type: Boolean }) closable = true
  @property({ type: Boolean, attribute: 'close-on-backdrop' }) closeOnBackdrop = true
  @property({ type: Boolean, reflect: true }) open = false

  @query('dialog') private dialogElement?: HTMLDialogElement

  private previousFocus: HTMLElement | null = null
  private nativeCloseHandlerAttached = false

  override disconnectedCallback(): void {
    this.dialogElement?.removeEventListener('close', this.handleNativeClose)
    this.dialogElement?.removeEventListener('cancel', this.handleNativeCancel)
    this.nativeCloseHandlerAttached = false
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) {
      const dialog = this.dialogElement
      if (!dialog) return
      this.previousFocus = (this.ownerDocument.activeElement as HTMLElement | null) ?? null
      this.attachNativeHandlers(dialog)
    }
  }

  showModal(): void {
    const dialog = this.requireDialog()
    this.previousFocus = (this.ownerDocument.activeElement as HTMLElement | null) ?? null
    this.attachNativeHandlers(dialog)
    this.callShowModal(dialog)
    this.open = true
  }

  close(returnValue = ''): void {
    const dialog = this.requireDialog()
    this.callClose(dialog, returnValue)
  }

  private requireDialog(): HTMLDialogElement {
    const dialog = this.dialogElement
    if (!dialog) throw new Error('mn-dialog is not ready yet')
    return dialog
  }

  private attachNativeHandlers(dialog: HTMLDialogElement): void {
    if (!this.nativeCloseHandlerAttached) {
      dialog.addEventListener('close', this.handleNativeClose)
      dialog.addEventListener('cancel', this.handleNativeCancel)
      this.nativeCloseHandlerAttached = true
    }
  }

  private callShowModal(dialog: DialogWithOptionalApi): void {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else {
      dialog.setAttribute('open', '')
      dialog.focus()
    }
  }

  private callClose(dialog: DialogWithOptionalApi, returnValue: string): void {
    if (!dialog.hasAttribute('open')) return
    dialog.returnValue = returnValue
    if (typeof dialog.close === 'function') {
      dialog.close(returnValue)
    } else {
      dialog.removeAttribute('open')
      dialog.dispatchEvent(new Event('close'))
    }
  }

  private readonly handleNativeClose = (): void => {
    const dialog = this.requireDialog()
    dialog.removeEventListener('cancel', this.handleNativeCancel)
    dialog.removeEventListener('close', this.handleNativeClose)
    this.nativeCloseHandlerAttached = false
    this.open = false
    this.previousFocus?.focus?.()
    this.previousFocus = null
    this.dispatchEvent(
      new CustomEvent<MnDialogCloseDetail>('mn-close', {
        detail: { returnValue: dialog.returnValue ?? '' },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private readonly handleNativeCancel = (event: Event): void => {
    event.preventDefault()
    this.close('cancel')
  }

  private handleBackdropClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop) return
    if (event.target !== this.dialogElement) return
    const rect = this.dialogElement.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (!inside) this.close('cancel')
  }

  override render() {
    return html`
      <dialog class=${`size-${this.size}`} ?open=${this.open} @click=${this.handleBackdropClick}>
        <div class="dialog-inner">
          <div class="header">
            <div class="header-content"><slot name="header"></slot></div>
            ${this.closable
              ? html`
                  <button class="close-btn" type="button" aria-label="Close dialog" @click=${() => this.close('cancel')}>
                    ${icon('x', { size: 16 })}
                  </button>
                `
              : nothing}
          </div>

          <div class="body"><slot></slot></div>
          <div class="footer"><slot name="footer"></slot></div>
        </div>
      </dialog>
    `
  }

  static confirm(options: MnDialogConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement('mn-dialog') as MnDialog
      dialog.size = options.size ?? 'sm'
      dialog.closable = true

      const header = document.createElement('span')
      header.slot = 'header'
      header.textContent = options.title

      const body = document.createElement('p')
      body.style.margin = '0'
      body.textContent = options.message

      const footer = document.createElement('div')
      footer.slot = 'footer'
      footer.style.cssText = 'display:flex;gap:var(--mn-space-2,8px);align-items:center;'

      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'mn-dialog-cancel-btn'
      cancel.textContent = options.cancelText ?? 'Cancel'
      cancel.style.cssText = buttonStyle('cancel')

      const confirm = document.createElement('button')
      confirm.type = 'button'
      confirm.className = 'mn-dialog-confirm-btn'
      confirm.textContent = options.confirmText ?? 'Confirm'
      confirm.style.cssText = buttonStyle(options.variant === 'danger' ? 'danger' : options.variant === 'warning' ? 'warning' : 'confirm')

      footer.append(cancel, confirm)
      dialog.append(header, body, footer)

      let settled = false
      const settle = (result: boolean): void => {
        if (settled) return
        settled = true
        dialog.close(result ? 'confirm' : 'cancel')
        window.setTimeout(() => dialog.remove(), 0)
        resolve(result)
      }

      cancel.addEventListener('click', () => settle(false))
      confirm.addEventListener('click', () => settle(true))
      dialog.addEventListener('mn-close', (event) => {
        if ((event as CustomEvent<MnDialogCloseDetail>).detail.returnValue !== 'confirm') settle(false)
      })

      document.body.appendChild(dialog)
      void dialog.updateComplete.then(() => dialog.showModal())
    })
  }

  static prompt(options: MnDialogPromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const dialog = document.createElement('mn-dialog') as MnDialog
      dialog.size = options.size ?? 'sm'
      dialog.closable = true

      const header = document.createElement('span')
      header.slot = 'header'
      header.textContent = options.title

      const body = document.createElement('div')
      if (options.message) {
        const message = document.createElement('p')
        message.style.cssText = 'margin:0 0 var(--mn-space-3,12px);color:var(--mn-color-text-secondary,#4b5563);'
        message.textContent = options.message
        body.appendChild(message)
      }

      const input = document.createElement('input')
      input.type = 'text'
      input.value = options.value ?? ''
      input.placeholder = options.placeholder ?? ''
      input.style.cssText =
        'width:100%;box-sizing:border-box;padding:var(--mn-space-2,8px) var(--mn-space-3,12px);' +
        'font-family:var(--mn-font-chrome,system-ui,sans-serif);font-size:var(--mn-text-sm,13px);' +
        'color:var(--mn-color-text-primary,#111827);background:var(--mn-color-surface-base,#fff);' +
        'border:1px solid var(--mn-color-border-default,#d1d5db);border-radius:var(--mn-radius-control,var(--mn-radius-md,6px));'
      body.appendChild(input)

      const footer = document.createElement('div')
      footer.slot = 'footer'
      footer.style.cssText = 'display:flex;gap:var(--mn-space-2,8px);align-items:center;'

      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = options.cancelText ?? 'Cancel'
      cancel.style.cssText = buttonStyle('cancel')

      const confirm = document.createElement('button')
      confirm.type = 'button'
      confirm.textContent = options.confirmText ?? 'OK'
      confirm.style.cssText = buttonStyle('confirm')

      footer.append(cancel, confirm)
      dialog.append(header, body, footer)

      let settled = false
      const settle = (result: string | null): void => {
        if (settled) return
        settled = true
        dialog.close(result === null ? 'cancel' : 'confirm')
        window.setTimeout(() => dialog.remove(), 0)
        resolve(result)
      }

      cancel.addEventListener('click', () => settle(null))
      confirm.addEventListener('click', () => settle(input.value))
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') settle(input.value)
        else if (event.key === 'Escape') settle(null)
      })
      dialog.addEventListener('mn-close', (event) => {
        if ((event as CustomEvent<MnDialogCloseDetail>).detail.returnValue !== 'confirm') settle(null)
      })

      document.body.appendChild(dialog)
      void dialog.updateComplete.then(() => dialog.showModal())
      requestFrame(() => {
        input.focus()
        if (options.value) input.select()
      })
    })
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-dialog': MnDialog
  }
}
