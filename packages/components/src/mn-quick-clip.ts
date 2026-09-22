/**
 * Controlled Garden Quick Clip popover.
 *
 * The component owns only ephemeral form/popover state. The host owns the
 * authenticated import, status, errors, sidebar refresh, and document opening.
 * That keeps the reusable component backend-free while preserving Garden's
 * web/YouTube auto-detect interaction.
 */

import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnQuickClipStatus = 'idle' | 'processing' | 'complete' | 'error'
export type MnQuickClipKind = 'web' | 'youtube'

export interface MnQuickClipRequestDetail {
  readonly url: string
  readonly kind: MnQuickClipKind
}

function clipKind(rawUrl: string): MnQuickClipKind {
  try {
    const host = new URL(rawUrl).hostname.toLocaleLowerCase().replace(/^www\./, '')
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
      ? 'youtube'
      : 'web'
  } catch {
    return 'web'
  }
}

@customElement('mn-quick-clip')
export class MnQuickClip extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: relative;
      display: inline-flex;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    button,
    input {
      font: inherit;
    }

    .trigger {
      display: inline-flex;
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      cursor: pointer;
    }

    .trigger:hover:not(:disabled),
    .trigger[aria-expanded='true'] {
      background: var(--mn-color-surface-accent, #f3f4f6);
      color: var(--mn-top-bar-text, #111827);
    }

    .trigger:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .panel {
      position: absolute;
      z-index: 60;
      inset-block-start: calc(100% + var(--mn-space-2, 6px));
      inset-inline-end: 0;
      width: min(330px, calc(100vw - 24px));
      box-sizing: border-box;
      padding: var(--mn-space-4, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 12px 28px rgb(0 0 0 / 0.16));
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-block-end: var(--mn-space-3, 8px);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
    }

    .close {
      display: inline-flex;
      width: 26px;
      height: 26px;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .close:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    form {
      display: flex;
      gap: var(--mn-space-2, 6px);
    }

    form label {
      display: flex;
      min-width: 0;
      flex: 1;
    }

    .mn-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    input {
      min-width: 0;
      flex: 1;
      height: 32px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-3, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      outline: none;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-xs, 12px);
    }

    input:focus {
      border-color: var(--mn-color-border-focus, #4f7c65);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--mn-color-border-focus, #4f7c65) 20%, transparent);
    }

    .submit,
    .another {
      min-height: 32px;
      padding: 0 var(--mn-space-4, 12px);
      border: 1px solid var(--mn-color-border-accent, #356b50);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-action-primary, #356b50);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
    }

    .submit:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .disclosure,
    .error,
    .status {
      margin-block-start: var(--mn-space-2, 6px);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .disclosure {
      color: var(--mn-color-text-muted, #6b7280);
    }

    .error {
      color: var(--mn-color-text-danger, #b42318);
    }

    .status {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      color: var(--mn-color-text-muted, #6b7280);
    }

    .status.complete {
      color: var(--mn-color-text-success, #26734d);
    }

    .another {
      margin-block-start: var(--mn-space-3, 8px);
      border-color: var(--mn-color-border-default, #d1d5db);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
    }

    :host([data-skin='emporium']) .panel {
      border-radius: var(--mn-radius-surface, 0);
    }
  `

  @property({ type: Boolean }) disabled = false
  @property({ type: String }) status: MnQuickClipStatus = 'idle'
  @property({ type: String }) error = ''

  @state() private panelOpen = false
  @state() private url = ''
  @state() private validationError = ''

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.panelOpen || event.composedPath().includes(this)) return
    this.closePanel()
  }

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown)
    super.disconnectedCallback()
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private async togglePanel(): Promise<void> {
    if (this.disabled) return
    if (this.panelOpen) {
      this.closePanel()
      return
    }
    this.panelOpen = true
    this.validationError = ''
    this.emit('mn-quick-clip-open-change', { open: true })
    await this.updateComplete
    this.renderRoot.querySelector<HTMLInputElement>('input')?.focus()
  }

  private closePanel(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.validationError = ''
    this.emit('mn-quick-clip-open-change', { open: false })
  }

  private submit(event: Event): void {
    event.preventDefault()
    if (this.status === 'processing') return
    const normalized = this.url.trim()
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
      this.validationError = ''
      this.emit('mn-quick-clip-request', {
        url: parsed.href,
        kind: clipKind(parsed.href),
      } satisfies MnQuickClipRequestDetail)
    } catch {
      this.validationError = 'Enter a valid http:// or https:// URL.'
    }
  }

  private reset(): void {
    this.url = ''
    this.validationError = ''
    this.emit('mn-quick-clip-reset')
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('input')?.focus())
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.closePanel()
  }

  render() {
    const message = this.validationError || this.error
    const editable = this.status === 'idle' || this.status === 'error'
    return html`
      <button
        class="trigger"
        type="button"
        aria-label="Quick clip"
        aria-haspopup="dialog"
        aria-expanded=${this.panelOpen ? 'true' : 'false'}
        aria-controls="quick-clip-panel"
        ?disabled=${this.disabled}
        @click=${this.togglePanel}
      >${icon('paperclip', { size: 18 })}</button>

      <section
        id="quick-clip-panel"
        class="panel"
        role="dialog"
        aria-label="Quick clip"
        ?hidden=${!this.panelOpen}
        aria-hidden=${this.panelOpen ? 'false' : 'true'}
        @keydown=${this.onKeyDown}
      >
          <div class="header">
            <span>Quick Clip</span>
            <button class="close" type="button" aria-label="Close quick clip" @click=${this.closePanel}>
              ${icon('x', { size: 15 })}
            </button>
          </div>

          <form @submit=${this.submit} novalidate ?hidden=${!editable} aria-hidden=${editable ? 'false' : 'true'}>
            <label>
              <span class="mn-sr-only">Web page or YouTube URL</span>
              <input
                type="url"
                inputmode="url"
                autocomplete="url"
                placeholder="https://…"
                aria-label="Web page or YouTube URL"
                aria-invalid=${message ? 'true' : 'false'}
                .value=${this.url}
                @input=${(event: Event) => {
                  this.url = (event.currentTarget as HTMLInputElement).value
                  this.validationError = ''
                }}
              />
            </label>
            <button class="submit" type="submit" ?disabled=${!this.url.trim()}>Clip</button>
          </form>
          <div class="error" role="alert" ?hidden=${!message}>${message}</div>
          <div class="disclosure" ?hidden=${Boolean(message) || !editable}>
            Auto-detects web text or YouTube transcripts.
          </div>

          <div class="status processing" role="status" ?hidden=${this.status !== 'processing'}>
            ${icon('loader-circle', { size: 15 })} Clipping…
          </div>

          <div class="status complete" role="status" ?hidden=${this.status !== 'complete'}>
            ${icon('circle-check', { size: 15 })} Clipped!
          </div>
          <button class="another" type="button" ?hidden=${this.status !== 'complete'} @click=${this.reset}>
            Clip another
          </button>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-quick-clip': MnQuickClip
  }
}
