/**
 * mn-upgrade-banner - Garden's free-tier upgrade banner, made controlled.
 *
 * Garden self-managed billing tier, dismissal, navigation, and active-view state.
 * Shrubbery keeps only the banner chrome: host-owned visibility and mobile mode
 * come in as props; upgrade/dismiss leave as events.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnUpgradeBannerDetail {
  readonly source: 'upgrade-banner'
}

@customElement('mn-upgrade-banner')
export class MnUpgradeBanner extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      color: var(--mn-color-warning-strong, #92400e);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      margin: var(--mn-space-2, 8px) var(--mn-space-4, 16px) 0;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      line-height: 1.5;
      animation: mn-upgrade-banner-in 300ms ease-out;
      box-sizing: border-box;
    }

    @keyframes mn-upgrade-banner-in {
      from {
        max-height: 0;
        margin-top: 0;
        padding-top: 0;
        padding-bottom: 0;
        opacity: 0;
      }
      to {
        max-height: 80px;
        opacity: 1;
      }
    }

    .banner-row {
      display: contents;
    }

    .banner-text {
      min-width: 0;
      flex: 1 1 auto;
    }

    .banner-text strong {
      font-weight: 650;
    }

    button {
      font: inherit;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-warning, #d97706));
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
      background: var(--mn-color-warning, #d97706);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      font-weight: 600;
      white-space: nowrap;
      transition: background var(--mn-transition-fast, 120ms ease);
    }

    .upgrade-btn:hover {
      background: var(--mn-color-warning-strong, #92400e);
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
      color: var(--mn-color-text-warning, #b45309);
      cursor: pointer;
      opacity: 0.65;
      transition: opacity var(--mn-transition-fast, 120ms ease);
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

  @property({ type: Boolean, reflect: true }) visible = false
  @property({ type: Boolean, reflect: true }) mobile = false
  @property({ type: String }) headline = 'Unlock the full Garden'
  @property({ type: String }) message = 'Pro gives you shared graphs with collaborators, 512MB graph storage, and $5/mo in bonus Sophia API credits.'
  @property({ type: String, attribute: 'mobile-message' }) mobileMessage = 'Shared graphs, 512MB storage, $5/mo bonus API credits.'
  @property({ type: String, attribute: 'upgrade-label' }) upgradeLabel = '$14.99/mo - Upgrade'

  private detail(): MnUpgradeBannerDetail {
    return { source: 'upgrade-banner' }
  }

  private upgrade(): void {
    this.dispatchEvent(new CustomEvent<MnUpgradeBannerDetail>('mn-upgrade', { detail: this.detail(), bubbles: true, composed: true }))
  }

  private dismiss(): void {
    this.dispatchEvent(new CustomEvent<MnUpgradeBannerDetail>('mn-dismiss', { detail: this.detail(), bubbles: true, composed: true }))
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.visible) return nothing
    if (this.mobile) {
      return html`
        <div class="banner">
          <div class="banner-row">
            <span class="banner-text">
              <strong>${this.headline}</strong> - ${this.mobileMessage}
            </span>
            <button type="button" class="dismiss-btn" aria-label="Dismiss" @click=${this.dismiss}>
              ${icon('x', { size: 14 })}
            </button>
          </div>
          <button type="button" class="upgrade-btn" @click=${this.upgrade}>${this.upgradeLabel}</button>
        </div>
      `
    }
    return html`
      <div class="banner">
        <span class="banner-text">
          <strong>${this.headline}</strong> - ${this.message}
        </span>
        <button type="button" class="upgrade-btn" @click=${this.upgrade}>${this.upgradeLabel}</button>
        <button type="button" class="dismiss-btn" aria-label="Dismiss" @click=${this.dismiss}>
          ${icon('x', { size: 14 })}
        </button>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-upgrade-banner': MnUpgradeBanner
  }
}
