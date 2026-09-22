/**
 * mn-storage-banner - Garden's graph storage warning banner, made controlled.
 *
 * Garden fetched usage, read graph roles/tier, watched stores, and persisted
 * dismissal thresholds. Shrubbery renders only the resolved threshold state and
 * emits upgrade/dismiss intents.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnStorageThreshold = 80 | 90 | 95 | 100
export type MnStorageBannerTone = 'warning' | 'error'

export interface MnStorageBannerConfig {
  readonly level: MnStorageThreshold
  readonly tone?: MnStorageBannerTone
  readonly message?: string | null
  readonly dismissable?: boolean
}

export interface MnStorageBannerDetail {
  readonly level: MnStorageThreshold
  readonly tone: MnStorageBannerTone
}

const DEFAULT_MESSAGES: Record<MnStorageThreshold, string> = {
  80: 'Your graph is over 80% of its storage limit. Upgrade to Pro for more space.',
  90: 'Your graph is at 90% storage capacity. Consider upgrading to avoid hitting the limit.',
  95: 'Your graph is almost full (95%+ storage used). Upgrade to Pro for 512MB of storage.',
  100: 'Your graph has reached its storage limit. You cannot create new documents until you free up space or upgrade.',
}

function defaultTone(level: MnStorageThreshold): MnStorageBannerTone {
  return level >= 95 ? 'error' : 'warning'
}

function defaultDismissable(level: MnStorageThreshold): boolean {
  return level < 100
}

@customElement('mn-storage-banner')
export class MnStorageBanner extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      margin: var(--mn-space-2, 8px) var(--mn-space-4, 16px) 0;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-radius: var(--mn-radius-md, 6px);
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      line-height: 1.5;
      animation: mn-storage-banner-in 300ms ease-out;
      box-sizing: border-box;
    }

    @keyframes mn-storage-banner-in {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .warning {
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
    }

    .error {
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger-strong, #991b1b);
    }

    .banner-row {
      display: contents;
    }

    .banner-text {
      min-width: 0;
      flex: 1 1 auto;
    }

    button {
      font: inherit;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: 1px;
    }

    .upgrade-btn {
      display: inline-flex;
      min-height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-full, 999px);
      cursor: pointer;
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      font-weight: 600;
      white-space: nowrap;
      transition: background var(--mn-transition-fast, 120ms ease);
    }

    .warning .upgrade-btn {
      background: var(--mn-color-warning, #d97706);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .warning .upgrade-btn:hover {
      background: var(--mn-color-warning-strong, #92400e);
    }

    .error .upgrade-btn {
      background: var(--mn-color-danger, #dc2626);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .error .upgrade-btn:hover {
      background: var(--mn-color-danger-strong, #991b1b);
    }

    .dismiss-btn {
      display: inline-flex;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-default, 4px);
      background: transparent;
      cursor: pointer;
      opacity: 0.65;
      transition: opacity var(--mn-transition-fast, 120ms ease);
    }

    .warning .dismiss-btn {
      color: var(--mn-color-text-warning, #b45309);
    }

    .error .dismiss-btn {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .dismiss-btn:hover {
      opacity: 1;
    }

    :host([mobile]) .banner {
      align-items: stretch;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      margin: 0;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-radius: 0;
      font-size: var(--mn-type-ui-sm-size, var(--mn-text-xs, 12px));
    }

    :host([mobile]) .banner-row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    :host([mobile]) .upgrade-btn {
      min-height: 44px;
      align-self: stretch;
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
    }

    :host([mobile]) .dismiss-btn {
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
    }
  `

  @property({ attribute: false }) threshold: MnStorageBannerConfig | null = null
  @property({ type: Boolean, reflect: true }) mobile = false
  @property({ type: String, attribute: 'upgrade-label' }) upgradeLabel = 'Upgrade to Pro'

  private get level(): MnStorageThreshold | null {
    return this.threshold?.level ?? null
  }

  private get tone(): MnStorageBannerTone {
    return this.threshold ? (this.threshold.tone ?? defaultTone(this.threshold.level)) : 'warning'
  }

  private get message(): string {
    if (!this.threshold) return ''
    return this.threshold.message ?? DEFAULT_MESSAGES[this.threshold.level]
  }

  private get dismissable(): boolean {
    if (!this.threshold) return false
    return this.threshold.dismissable ?? defaultDismissable(this.threshold.level)
  }

  private detail(): MnStorageBannerDetail {
    return {
      level: this.level ?? 80,
      tone: this.tone,
    }
  }

  private upgrade(): void {
    this.dispatchEvent(new CustomEvent<MnStorageBannerDetail>('mn-upgrade', { detail: this.detail(), bubbles: true, composed: true }))
  }

  private dismiss(): void {
    if (!this.dismissable) return
    this.dispatchEvent(new CustomEvent<MnStorageBannerDetail>('mn-dismiss', { detail: this.detail(), bubbles: true, composed: true }))
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.threshold) return nothing
    const tone = this.tone
    const dismiss = this.dismissable
    if (this.mobile) {
      return html`
        <div class=${`banner ${tone}`} data-storage-level=${this.threshold.level}>
          <div class="banner-row">
            <span class="banner-text">${this.message}</span>
            ${dismiss
              ? html`<button type="button" class="dismiss-btn" aria-label="Dismiss" @click=${this.dismiss}>${icon('x', { size: 14 })}</button>`
              : nothing}
          </div>
          <button type="button" class="upgrade-btn" @click=${this.upgrade}>${this.upgradeLabel}</button>
        </div>
      `
    }
    return html`
      <div class=${`banner ${tone}`} data-storage-level=${this.threshold.level}>
        <span class="banner-text">${this.message}</span>
        <button type="button" class="upgrade-btn" @click=${this.upgrade}>
          ${this.upgradeLabel} ${icon('external-link', { size: 14 })}
        </button>
        ${dismiss
          ? html`<button type="button" class="dismiss-btn" aria-label="Dismiss" @click=${this.dismiss}>${icon('x', { size: 14 })}</button>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-storage-banner': MnStorageBanner
  }
}
