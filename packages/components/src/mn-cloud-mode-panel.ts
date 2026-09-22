/**
 * mn-cloud-mode-panel - Garden's Sophia Cloud management panel, made controlled.
 *
 * Garden talks to auth, hosted-mode, Tauri credentials, and OS utilities here.
 * Shrubbery keeps the panel as dialog chrome: host-owned mode/account data comes
 * in as props, and connect/local/sign-out/close leave as intent events.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import type { MnCloudMode } from './mn-cloud-mode-pill.js'

export type MnCloudSignInState = 'signed-out' | 'connected' | 'stale'
export type MnCloudOs = 'mac' | 'windows' | 'linux' | 'unknown'
export type MnCloudModeAction = 'connect' | 'switch-local' | 'sign-out' | 'close'

export interface MnCloudModeActionDetail {
  readonly action: MnCloudModeAction
  readonly mode: MnCloudMode
  readonly signInState: MnCloudSignInState
}

function osLabel(os: MnCloudOs): string {
  if (os === 'mac') return 'this Mac'
  if (os === 'windows') return 'this Windows PC'
  if (os === 'linux') return 'this Linux PC'
  return 'your machine'
}

@customElement('mn-cloud-mode-panel')
export class MnCloudModePanel extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-overlay, 1500);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-6, 24px);
      background: var(--mn-color-surface-overlay, rgba(0, 53, 107, 0.18));
      backdrop-filter: blur(2px);
      animation: mn-cloud-fade 120ms ease-out;
      box-sizing: border-box;
    }

    .card {
      width: 100%;
      max-width: 480px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-accent, #93c5fd);
      border-radius: var(--mn-radius-surface, 12px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.2));
      animation: mn-cloud-rise 160ms ease-out;
    }

    .backdrop {
      display: flex;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
    }

    .title-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      padding: 18px var(--mn-space-6, 24px) 14px;
      border-bottom: 1px solid var(--mn-color-border-strong, #cbd5e1);
    }

    .title {
      margin: 0;
      color: var(--mn-color-accent-hover, var(--mn-color-text-accent, #1d4ed8));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-type-ui-size, 13px);
      font-weight: 600;
      letter-spacing: var(--mn-type-label-tracking, 0.05em);
      text-transform: uppercase;
    }

    .close {
      display: inline-flex;
      width: 24px;
      height: 24px;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      font: inherit;
      transition:
        color var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease);
    }

    .close:hover,
    .close:focus-visible {
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
      outline: none;
    }

    .close:disabled {
      cursor: progress;
      opacity: 0.55;
    }

    .lede {
      margin: 0;
      padding: 18px var(--mn-space-6, 24px) var(--mn-space-4, 16px);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-type-ui-size, 13px);
      line-height: 1.55;
    }

    .section {
      padding: var(--mn-space-4, 16px) var(--mn-space-6, 24px) 18px;
      border-top: 1px solid var(--mn-color-border-accent, #bfdbfe);
    }

    .section-label {
      margin: 0 0 var(--mn-space-2-5, 10px);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      letter-spacing: var(--mn-type-label-tracking, 0.05em);
      text-transform: uppercase;
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-4, 16px);
    }

    .row-text {
      display: flex;
      min-width: 0;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 3px;
    }

    .row-primary {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-base, 15px);
      font-weight: 600;
    }

    .row-primary .dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 50%;
    }

    .row-meta {
      padding-left: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .row-email {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #374151);
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dot.local {
      background: var(--mn-color-text-disabled, #9ca3af);
    }

    .dot.connected {
      background: var(--mn-color-accent, #2563eb);
    }

    .dot.stale {
      background: var(--mn-color-warning, #d97706);
    }

    .dot.signed-out {
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-accent, #93c5fd);
      background: transparent;
    }

    .action {
      flex: 0 0 auto;
      padding: var(--mn-space-2, 8px) var(--mn-space-3-5, 14px);
      border-radius: var(--mn-radius-control, 6px);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-type-ui-xs-size, 11px);
      font-weight: 600;
      letter-spacing: var(--mn-type-label-tracking, 0.05em);
      text-transform: uppercase;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .action:disabled {
      cursor: progress;
      opacity: 0.55;
    }

    .action:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: 1px;
    }

    .primary {
      border: 1px solid var(--mn-color-accent-hover, var(--mn-color-accent, #2563eb));
      background: var(--mn-color-accent-hover, var(--mn-color-accent, #2563eb));
      color: var(--mn-color-text-on-accent, #fff);
    }

    .primary:hover:not(:disabled) {
      border-color: var(--mn-color-accent-active, #1e40af);
      background: var(--mn-color-accent-active, #1e40af);
    }

    .ghost {
      border: 1px solid var(--mn-color-border-accent, #93c5fd);
      background: transparent;
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .ghost:hover:not(:disabled) {
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .danger {
      border: 1px solid var(--mn-color-danger-border, #fecaca);
      background: transparent;
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .danger:hover:not(:disabled) {
      border-color: var(--mn-color-text-danger, #b91c1c);
      background: var(--mn-color-danger-surface, #fef2f2);
    }

    .error {
      margin: 0 var(--mn-space-6, 24px) var(--mn-space-4, 16px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-left: 2px solid var(--mn-color-text-danger, #b91c1c);
      color: var(--mn-color-text-danger, #b91c1c);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    .footer {
      padding: var(--mn-space-2-5, 10px) var(--mn-space-6, 24px) 14px;
      border-top: 1px solid var(--mn-color-border-accent, #bfdbfe);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-type-ui-xs-size, 11px);
      letter-spacing: 0;
    }

    @keyframes mn-cloud-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes mn-cloud-rise {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 560px) {
      :host([open]) {
        align-items: flex-end;
        padding: 0;
      }

      .backdrop {
        align-items: flex-end;
      }

      .card {
        max-width: none;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: var(--mn-radius-lg, 8px) var(--mn-radius-lg, 8px) 0 0;
      }

      .row {
        align-items: stretch;
        flex-direction: column;
      }

      .action {
        width: 100%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :host([open]),
      .card {
        animation: none;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String, reflect: true }) mode: MnCloudMode = 'local'
  @property({ type: String, attribute: 'sign-in-state' }) signInState: MnCloudSignInState = 'signed-out'
  @property({ type: String, attribute: 'user-email' }) userEmail = ''
  @property({ type: Number, attribute: 'expires-at' }) expiresAt: number | null = null
  @property({ type: Boolean }) busy = false
  @property({ type: String }) error = ''
  @property({ type: String }) os: MnCloudOs = 'unknown'

  show(): void {
    this.open = true
    this.dispatchEvent(new CustomEvent('mn-open', { bubbles: true, composed: true }))
  }

  hide(): void {
    this.requestClose()
  }

  private detail(action: MnCloudModeAction): MnCloudModeActionDetail {
    return {
      action,
      mode: this.mode,
      signInState: this.signInState,
    }
  }

  private emitAction(type: string, action: MnCloudModeAction): void {
    const detail = this.detail(action)
    this.dispatchEvent(new CustomEvent<MnCloudModeActionDetail>(type, { detail, bubbles: true, composed: true }))
  }

  private requestClose(): void {
    if (this.busy) return
    this.emitAction('mn-close', 'close')
    this.emitAction('mn-cloud-mode-close', 'close')
  }

  private connect(): void {
    this.emitAction('mn-connect', 'connect')
    this.emitAction('mn-cloud-mode-connect', 'connect')
  }

  private switchLocal(): void {
    this.emitAction('mn-switch-local', 'switch-local')
    this.emitAction('mn-cloud-mode-switch-local', 'switch-local')
  }

  private signOut(): void {
    this.emitAction('mn-sign-out', 'sign-out')
    this.emitAction('mn-cloud-mode-sign-out', 'sign-out')
  }

  private onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.requestClose()
  }

  private modeDotClass(): 'local' | MnCloudSignInState {
    return this.mode === 'hosted' ? this.signInState : 'local'
  }

  private modeLabel(): string {
    return this.mode === 'hosted' ? 'Sophia Cloud' : 'Local'
  }

  private modeMeta(): string {
    if (this.mode !== 'hosted') return `Running locally on ${osLabel(this.os)}`
    if (this.signInState === 'connected') return 'Synced with Sophia Cloud'
    if (this.signInState === 'stale') return 'Connection stale - credentials need refresh'
    return 'Sophia Cloud enabled, signed out'
  }

  private accountStatusLabel(): string {
    if (this.signInState === 'connected') return 'Connected'
    if (this.signInState === 'stale') return 'Reconnecting'
    return 'Signed out'
  }

  private accountMeta(): string {
    if (this.signInState === 'connected') return 'Signed in to Sophia Cloud'
    if (this.signInState === 'stale') return 'Token expired - sign in to resume Sophia Cloud sync'
    return 'No active credentials on this device'
  }

  private formatExpiry(expiresAt: number): string {
    const ms = expiresAt - Date.now()
    if (ms <= 0) {
      const ago = Math.round(-ms / 60000)
      return `Token expired ${ago}m ago`
    }
    const minutes = Math.round(ms / 60000)
    if (minutes < 60) return `Token expires in ${minutes}m`
    return `Token expires in ${Math.round(minutes / 60)}h`
  }

  private renderModeAction(): TemplateResult {
    if (this.mode === 'hosted') {
      return html`
        <button type="button" class="action danger" ?disabled=${this.busy} @click=${this.switchLocal}>
          Switch to Local
        </button>
      `
    }
    return html`
      <button type="button" class="action primary" ?disabled=${this.busy} @click=${this.connect}>
        ${this.busy ? 'Signing in...' : 'Connect to Sophia Cloud'}
      </button>
    `
  }

  private renderAccountSection(): TemplateResult | typeof nothing {
    if (this.mode !== 'hosted') return nothing
    return html`
      <section class="section">
        <div class="section-label">Account</div>
        <div class="row">
          <div class="row-text">
            <div class="row-primary">
              <span class=${`dot ${this.signInState}`}></span>
              ${this.accountStatusLabel()}
              ${this.userEmail ? html`<span class="row-email">- ${this.userEmail}</span>` : nothing}
            </div>
            <div class="row-meta">${this.accountMeta()}</div>
          </div>
          ${this.signInState === 'signed-out' || this.signInState === 'stale'
            ? html`<button type="button" class="action primary" ?disabled=${this.busy} @click=${this.connect}>Sign in</button>`
            : html`<button type="button" class="action ghost" ?disabled=${this.busy} @click=${this.signOut}>Sign out</button>`}
        </div>
      </section>
    `
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing
    return html`
      <div class="backdrop" @click=${this.onBackdropClick}>
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="cloud-mode-title" @click=${(event: Event) => event.stopPropagation()}>
          <header class="title-bar">
            <h2 id="cloud-mode-title" class="title">Sophia Cloud</h2>
            <button type="button" class="close" aria-label="Close" ?disabled=${this.busy} @click=${this.requestClose}>
              ${icon('x', { size: 14 })}
            </button>
          </header>

          <p class="lede">
            Sophia Cloud is the hosted side of the platform - your cloud graphs, collaborators,
            and account sign-in. Connect to sync, or stay local and your graphs stay on this
            machine. Toggle back any time.
          </p>

          <section class="section">
            <div class="section-label">Mode</div>
            <div class="row">
              <div class="row-text">
                <div class="row-primary">
                  <span class=${`dot ${this.modeDotClass()}`}></span>${this.modeLabel()}
                </div>
                <div class="row-meta">${this.modeMeta()}</div>
              </div>
              ${this.renderModeAction()}
            </div>
          </section>

          ${this.renderAccountSection()}
          ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
          ${this.mode === 'hosted' && this.expiresAt ? html`<div class="footer">${this.formatExpiry(this.expiresAt)}</div>` : nothing}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-cloud-mode-panel': MnCloudModePanel
  }
}
