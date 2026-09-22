/**
 * mn-restore-overlay - controlled workspace restore status overlay.
 *
 * Garden's original component subscribes to historyStore and performs reloads.
 * Shrubbery keeps the branded overlay but emits host-owned intents instead.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnRestoreOperationState =
  | 'pending'
  | 'locking'
  | 'backing_up'
  | 'restoring'
  | 'rebuilding'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'

const TERMINAL_STATES: ReadonlySet<MnRestoreOperationState> = new Set(['succeeded', 'failed', 'rolled_back'])

function stageLabel(state: MnRestoreOperationState | ''): string {
  switch (state) {
    case 'pending':
      return 'Preparing'
    case 'locking':
      return 'Acquiring lock'
    case 'backing_up':
      return 'Backing up'
    case 'restoring':
      return 'Restoring'
    case 'rebuilding':
      return 'Rebuilding'
    case 'verifying':
      return 'Verifying'
    case 'succeeded':
      return 'Complete'
    case 'failed':
      return 'Failed'
    case 'rolled_back':
      return 'Rolled back'
    default:
      return ''
  }
}

@customElement('mn-restore-overlay')
export class MnRestoreOverlay extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-overlay, 1500);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-6, 24px);
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.62));
      color: white;
      backdrop-filter: blur(4px);
      box-sizing: border-box;
    }

    :host([active]) {
      display: flex;
    }

    .content {
      display: flex;
      width: min(100%, 420px);
      flex-direction: column;
      align-items: center;
      gap: var(--mn-space-5, 20px);
      text-align: center;
    }

    .spinner-container {
      position: relative;
      width: 64px;
      height: 64px;
    }

    .spinner-ring {
      width: 64px;
      height: 64px;
      border: 3px solid rgba(255, 255, 255, 0.22);
      border-top-color: white;
      border-radius: 999px;
      animation: restore-spin 1.1s ease-in-out infinite;
      box-sizing: border-box;
    }

    .spinner-icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.92;
    }

    @keyframes restore-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .state-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 58px;
      height: 58px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
    }

    .state-icon[data-tone='success'] {
      color: var(--mn-color-success, #86efac);
    }

    .state-icon[data-tone='danger'] {
      color: var(--mn-color-danger, #fca5a5);
    }

    .title {
      margin: 0;
      color: white;
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-xl, 20px);
      font-weight: 650;
      line-height: 1.2;
    }

    .message {
      max-width: 34rem;
      margin: 0;
      color: rgba(255, 255, 255, 0.78);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 14px);
      line-height: 1.55;
    }

    .progress {
      width: min(100%, 300px);
    }

    .progress-track {
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
    }

    .progress-fill {
      height: 100%;
      border-radius: inherit;
      background: white;
      transition: width 180ms ease;
    }

    .progress-label,
    .error-detail {
      margin-top: var(--mn-space-2, 8px);
      color: rgba(255, 255, 255, 0.68);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
    }

    .progress-label {
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .error-detail {
      max-width: 100%;
      overflow-wrap: anywhere;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }

    .dismiss-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 var(--mn-space-5, 20px);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: var(--mn-radius-control, 6px);
      background: rgba(255, 255, 255, 0.08);
      color: white;
      font: inherit;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 14px);
      cursor: pointer;
    }

    .dismiss-button:hover {
      background: rgba(255, 255, 255, 0.16);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-3, 12px);
      justify-content: center;
    }

    .secondary-button {
      background: transparent;
    }
  `

  @property({ type: Boolean, reflect: true }) active = false
  @property({ type: String }) operationState: MnRestoreOperationState | '' = ''
  @property({ type: Number }) progress = 0
  @property({ type: String }) message = ''
  @property({ type: String }) error = ''

  /**
   * MO object-face integration spec, master §3 Slice 9 (03 §6.3, C-D27).
   * Four additive properties, every default preserving current behaviour
   * byte-for-byte, so no existing caller changes and none grows a second
   * button unless it opts in.
   */
  /** Optional heading override. Empty keeps this component's own restore
   *  copy byte-for-byte. Reapply supplies its own register — parked work
   *  is not a workspace restore. */
  @property({ type: String }) heading = ''
  /** Terminal primary-action label. Empty ⇒ today's `Reload` (succeeded) /
   *  `Dismiss` (failed|rolled_back), exactly as before. */
  @property({ type: String, attribute: 'primary-label' }) primaryLabel = ''
  /** Terminal SECONDARY action. Empty ⇒ not rendered at all, so every
   *  existing caller keeps its single-button terminal state unchanged.
   *  Non-empty ⇒ a second button emitting `mn-restore-overlay-secondary`. */
  @property({ type: String, attribute: 'secondary-label' }) secondaryLabel = ''
  /** Stable overlay identity for the modal-owner contract
   *  (`docs/architecture/MOBILE_INTERACTION_SYSTEM.md:285`). */
  @property({ type: String, attribute: 'overlay-id' }) overlayId = 'restore-overlay'

  private overlayAnnouncedOpen = false

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this._handleDocumentKeyDown)
    if (this.hasUpdated && this.active) this.announceModalState(true)
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this._handleDocumentKeyDown)
    if (this.overlayAnnouncedOpen) this.announceModalState(false)
    super.disconnectedCallback()
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('active')) return
    this.announceModalState(this.active)
  }

  /** Copied verbatim from the shipped precedent, `mn-confirmation-
   *  dialog.ts:354-364` — balanced, so the shell's modal-owner counter
   *  never gets stuck suppressing bottom navigation. */
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

  private _dismissSecondary(): void {
    this.dispatchEvent(new CustomEvent('mn-restore-overlay-secondary', { bubbles: true, composed: true }))
  }

  private _handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || !TERMINAL_STATES.has(this.operationState as MnRestoreOperationState)) return
    if (event.key !== 'Escape') return
    event.preventDefault()
    this._dismiss()
  }

  private _dismiss(): void {
    const type = this.operationState === 'succeeded' ? 'mn-restore-overlay-reload' : 'mn-restore-overlay-dismiss'
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }))
  }

  private _progressPercent(): number {
    if (!Number.isFinite(this.progress)) return 0
    return Math.max(0, Math.min(100, this.progress))
  }

  private _renderSuccess(): TemplateResult {
    return html`
      <div class="content" role="alertdialog" aria-modal="true" aria-label=${this.heading || 'Restore completed'}>
        <div class="state-icon" data-tone="success">${icon('check', { size: 34 })}</div>
        <h2 class="title">${this.heading || 'Restore Complete'}</h2>
        <p class="message">${this.message || 'Your workspace has been restored. Reload to reconnect to the restored state.'}</p>
        <div class="actions">
          <button type="button" class="dismiss-button" @click=${() => this._dismiss()}>${this.primaryLabel || 'Reload'}</button>
          ${this.secondaryLabel
            ? html`<button type="button" class="dismiss-button secondary-button" @click=${() => this._dismissSecondary()}>${this.secondaryLabel}</button>`
            : nothing}
        </div>
      </div>
    `
  }

  private _renderFailure(): TemplateResult {
    const rolledBack = this.operationState === 'rolled_back'
    return html`
      <div class="content" role="alertdialog" aria-modal="true" aria-label=${this.heading || (rolledBack ? 'Restore rolled back' : 'Restore failed')}>
        <div class="state-icon" data-tone="danger">${icon('alert-circle', { size: 34 })}</div>
        <h2 class="title">${this.heading || (rolledBack ? 'Restore Rolled Back' : 'Restore Failed')}</h2>
        <p class="message">
          ${this.message || (rolledBack
            ? 'The restore could not be completed. Your workspace has been returned to its previous state.'
            : 'Something went wrong during the restore. Your workspace may need attention.')}
        </p>
        ${this.error ? html`<div class="error-detail">${this.error}</div>` : nothing}
        <div class="actions">
          <button type="button" class="dismiss-button" @click=${() => this._dismiss()}>${this.primaryLabel || 'Dismiss'}</button>
          ${this.secondaryLabel
            ? html`<button type="button" class="dismiss-button secondary-button" @click=${() => this._dismissSecondary()}>${this.secondaryLabel}</button>`
            : nothing}
        </div>
      </div>
    `
  }

  private _renderProgress(): TemplateResult {
    const label = stageLabel(this.operationState)
    return html`
      <div class="content" role="alert" aria-live="polite" aria-label=${this.heading || 'Restore in progress'}>
        <div class="spinner-container">
          <div class="spinner-ring"></div>
          <div class="spinner-icon">${icon('clock', { size: 24 })}</div>
        </div>
        <h2 class="title">${this.heading || 'Restoring Workspace'}</h2>
        <p class="message">${this.message || 'Please wait while your workspace is being restored.'}</p>
        <div class="progress">
          <div class="progress-track">
            <div class="progress-fill" style=${`width: ${this._progressPercent()}%`}></div>
          </div>
          ${label ? html`<div class="progress-label">${label}</div>` : nothing}
        </div>
      </div>
    `
  }

  render(): TemplateResult | typeof nothing {
    if (!this.active) return nothing
    if (this.operationState === 'succeeded') return this._renderSuccess()
    if (this.operationState === 'failed' || this.operationState === 'rolled_back') return this._renderFailure()
    return this._renderProgress()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-restore-overlay': MnRestoreOverlay
  }
}
