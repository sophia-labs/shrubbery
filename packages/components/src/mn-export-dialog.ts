/**
 * mn-export-dialog - Garden's document export preview/action dialog, controlled.
 *
 * Garden read the live editor from documentStore, rendered HTML/Markdown, copied
 * to the clipboard, created downloads, and printed the iframe. Shrubbery renders
 * host-owned preview/export state and emits action intents for the shell.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnExportAction =
  | 'close'
  | 'theme'
  | 'copy-markdown'
  | 'download-markdown'
  | 'print'
  | 'download-html'

export type MnExportCopyStatus = 'idle' | 'success' | 'error'

export interface MnExportTheme {
  readonly id: string
  readonly label: string
  readonly page: string
  readonly ink: string
  readonly accent: string
}

export interface MnExportActionDetail {
  readonly action: MnExportAction
  readonly themeId?: string
  readonly documentTitle: string
}

export const defaultExportThemes: readonly MnExportTheme[] = Object.freeze([
  { id: 'garden', label: 'Garden', page: '#f7f5f0', ink: '#1a1918', accent: '#4a8b6f' },
  { id: 'manuscript', label: 'Manuscript', page: '#faf8f3', ink: '#1a1714', accent: '#8b3a2a' },
  { id: 'dusk', label: 'Dusk', page: '#181926', ink: '#e5e0d8', accent: '#d4976a' },
  { id: 'meridian', label: 'Meridian', page: '#ffffff', ink: '#111827', accent: '#0055d4' },
  { id: 'vesper', label: 'Vesper', page: '#1a1512', ink: '#ede6d6', accent: '#c9a84c' },
])

@customElement('mn-export-dialog')
export class MnExportDialog extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      box-sizing: border-box;
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
      padding: var(--mn-space-4, 16px);
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.45));
      opacity: 0;
      transition: opacity var(--mn-transition-normal, 180ms ease);
    }

    :host([open]) .overlay {
      opacity: 1;
    }

    .dialog {
      position: relative;
      display: flex;
      width: 100%;
      max-width: 900px;
      height: 80vh;
      max-height: 700px;
      flex-direction: column;
      border-radius: var(--mn-radius-xl, 12px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-xl, var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.2)));
      opacity: 0;
      transform: scale(0.95) translateY(20px);
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
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-4, 16px) var(--mn-space-6, 24px);
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
    }

    .close-button {
      display: inline-flex;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .close-button:hover,
    .close-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-base, 15px);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .theme-bar {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-4, 16px);
      overflow-x: auto;
      padding: var(--mn-space-3, 12px) var(--mn-space-6, 24px);
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
    }

    .theme-bar-label {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .theme-options {
      display: flex;
      gap: var(--mn-space-3, 12px);
    }

    .theme-option {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: 2px;
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      cursor: pointer;
      transition: transform var(--mn-transition-fast, 120ms ease);
    }

    .theme-option:hover .theme-preview {
      box-shadow: var(--mn-shadow-raised, 0 2px 8px rgba(15, 23, 42, 0.12));
      transform: translateY(-1px);
    }

    .theme-option:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: 2px;
    }

    .theme-preview {
      position: relative;
      display: flex;
      width: 44px;
      height: 56px;
      flex-direction: column;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      overflow: hidden;
      padding-top: 10px;
      border-radius: var(--mn-radius-sm, 4px);
      box-shadow: 0 0 0 1.5px var(--mn-color-border-default, #d1d5db);
      transition:
        box-shadow var(--mn-transition-fast, 120ms ease),
        transform var(--mn-transition-fast, 120ms ease);
    }

    .theme-option[aria-selected='true'] .theme-preview {
      box-shadow: 0 0 0 2px var(--mn-color-border-accent, #2563eb);
    }

    .theme-preview-accent {
      width: 60%;
      height: 3px;
      border-radius: 1px;
      opacity: 0.9;
    }

    .theme-preview-line {
      height: 2px;
      border-radius: 1px;
      opacity: 0.35;
    }

    .theme-preview-line:nth-child(2) {
      width: 70%;
    }

    .theme-preview-line:nth-child(3) {
      width: 65%;
    }

    .theme-preview-line:nth-child(4) {
      width: 50%;
    }

    .theme-name {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      white-space: nowrap;
    }

    .theme-option[aria-selected='true'] .theme-name {
      color: var(--mn-color-text-primary, #111827);
    }

    .body {
      position: relative;
      min-height: 0;
      flex: 1 1 auto;
      overflow: hidden;
    }

    .preview-iframe {
      width: 100%;
      height: 100%;
      border: 0;
    }

    .loading-container,
    .error-container {
      display: flex;
      height: 100%;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-sm, 13px);
    }

    .error-container {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--mn-color-border-default, #d1d5db);
      border-top-color: var(--mn-color-text-accent, #2563eb);
      border-radius: 50%;
      animation: mn-export-spin 600ms linear infinite;
    }

    @keyframes mn-export-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .footer {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px) var(--mn-space-6, 24px);
      border-top: 1px solid var(--mn-color-border-default, #d1d5db);
    }

    .action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease);
    }

    .action-button:hover:not(:disabled),
    .action-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .action-button.primary {
      border-color: transparent;
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .action-button.primary:hover:not(:disabled),
    .action-button.primary:focus-visible {
      background: var(--mn-color-accent-hover, #1d4ed8);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .action-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
      pointer-events: none;
    }

    .copy-success {
      color: var(--mn-color-text-success, #166534);
    }

    .copy-error {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    @media (max-width: 768px) {
      :host {
        padding: var(--mn-space-2, 8px);
      }

      .dialog {
        max-width: 100%;
        height: 90vh;
        max-height: none;
      }

      .theme-bar {
        gap: var(--mn-space-2, 8px);
        padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      }

      .theme-bar-label {
        display: none;
      }

      .theme-options {
        gap: var(--mn-space-2, 8px);
      }

      .footer {
        flex-wrap: wrap;
      }

      .action-button {
        flex: 1 1 auto;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String, attribute: 'document-title' }) documentTitle = ''
  @property({ type: String, attribute: 'html-content' }) htmlContent = ''
  @property({ type: String }) error = ''
  @property({ type: Boolean }) loading = false
  @property({ type: Boolean, attribute: 'markdown-available' }) markdownAvailable = true
  @property({ type: String, attribute: 'selected-theme' }) selectedTheme = 'garden'
  @property({ type: String, attribute: 'copy-status' }) copyStatus: MnExportCopyStatus = 'idle'
  @property({ attribute: false }) themes: readonly MnExportTheme[] = defaultExportThemes

  private detail(action: MnExportAction, themeId?: string): MnExportActionDetail {
    return {
      action,
      documentTitle: this.documentTitle,
      ...(themeId ? { themeId } : {}),
    }
  }

  private emitAction(type: string, action: MnExportAction, themeId?: string): void {
    this.dispatchEvent(new CustomEvent<MnExportActionDetail>(type, {
      detail: this.detail(action, themeId),
      bubbles: true,
      composed: true,
    }))
  }

  private close(event?: Event): void {
    event?.stopPropagation()
    this.emitAction('mn-close', 'close')
    this.emitAction('mn-export-close', 'close')
  }

  private selectTheme(themeId: string): void {
    if (themeId === this.selectedTheme) return
    this.emitAction('mn-theme-select', 'theme', themeId)
    this.emitAction('mn-export-theme-select', 'theme', themeId)
  }

  private action(type: 'copy-markdown' | 'download-markdown' | 'print' | 'download-html'): void {
    this.emitAction(`mn-${type}`, type)
    this.emitAction(`mn-export-${type}`, type)
  }

  private renderThemeSwatch(theme: MnExportTheme): TemplateResult {
    const selected = theme.id === this.selectedTheme
    return html`
      <button
        type="button"
        class="theme-option"
        aria-selected=${selected ? 'true' : 'false'}
        aria-label=${`${theme.label} theme`}
        @click=${() => this.selectTheme(theme.id)}
      >
        <div class="theme-preview" style=${`background:${theme.page};`}>
          <div class="theme-preview-accent" style=${`background:${theme.accent};`}></div>
          <div class="theme-preview-line" style=${`background:${theme.ink};`}></div>
          <div class="theme-preview-line" style=${`background:${theme.ink};`}></div>
          <div class="theme-preview-line" style=${`background:${theme.ink};`}></div>
        </div>
        <span class="theme-name">${theme.label}</span>
      </button>
    `
  }

  private renderBody(): TemplateResult {
    if (this.loading) {
      return html`<div class="loading-container"><span class="spinner"></span> Rendering preview...</div>`
    }
    if (this.error) {
      return html`<div class="error-container" role="alert">${this.error}</div>`
    }
    return html`<iframe class="preview-iframe" .srcdoc=${this.htmlContent} sandbox="allow-same-origin allow-modals allow-scripts"></iframe>`
  }

  private renderCopyContent(): TemplateResult {
    if (this.copyStatus === 'success') {
      return html`<span class="copy-success">${icon('check', { size: 16 })} Copied!</span>`
    }
    if (this.copyStatus === 'error') {
      return html`<span class="copy-error">${icon('alert-circle', { size: 16 })} Copy failed</span>`
    }
    return html`${icon('clipboard', { size: 16 })} Copy Markdown`
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing
    const title = this.documentTitle || 'Untitled'
    const hasPreview = Boolean(this.htmlContent) && !this.error && !this.loading
    const markdownDisabled = this.loading || Boolean(this.error) || !this.markdownAvailable
    return html`
      <div class="overlay" @click=${this.close}>
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-dialog-title"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <div class="header">
            <button type="button" class="close-button" aria-label="Close" @click=${this.close}>
              ${icon('x', { size: 18 })}
            </button>
            <h2 class="title" id="export-dialog-title">Export "${title}"</h2>
          </div>

          <div class="theme-bar">
            <span class="theme-bar-label">Theme</span>
            <div class="theme-options" role="radiogroup" aria-label="Export theme">
              ${this.themes.map(theme => this.renderThemeSwatch(theme))}
            </div>
          </div>

          <div class="body">${this.renderBody()}</div>

          <div class="footer">
            <button type="button" class="action-button" ?disabled=${markdownDisabled} @click=${() => this.action('copy-markdown')}>
              ${this.renderCopyContent()}
            </button>
            <button type="button" class="action-button" ?disabled=${markdownDisabled} @click=${() => this.action('download-markdown')}>
              ${icon('download', { size: 16 })} Download Markdown
            </button>
            <button type="button" class="action-button" ?disabled=${!hasPreview} @click=${() => this.action('print')}>
              ${icon('printer', { size: 16 })} Print
            </button>
            <button type="button" class="action-button primary" ?disabled=${!hasPreview} @click=${() => this.action('download-html')}>
              ${icon('download', { size: 16 })} Download HTML
            </button>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-export-dialog': MnExportDialog
  }
}
