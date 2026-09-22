/**
 * mn-consent-banner - Garden's analytics consent banner, made controlled.
 *
 * Garden reads/writes analytics consent through a service backed by localStorage.
 * Shrubbery keeps this as a pure banner: the host supplies the consent state and
 * handles accept/decline intents.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

export type MnConsentState = 'pending' | 'accepted' | 'declined'
export type MnConsentChoice = 'accepted' | 'declined'

export interface MnConsentChoiceDetail {
  readonly choice: MnConsentChoice
}

@customElement('mn-consent-banner')
export class MnConsentBanner extends SkinAware(LitElement) {
  static styles = css`
    :host {
      position: fixed;
      right: var(--mn-space-4, 16px);
      bottom: var(--mn-space-4, 16px);
      z-index: var(--mn-z-toast, 1600);
      display: block;
      max-width: min(360px, calc(100vw - 32px));
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2-5, 10px);
      padding: var(--mn-space-2, 8px) var(--mn-space-2-5, 10px) var(--mn-space-2, 8px) var(--mn-space-3-5, 14px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-md, 10px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(15, 23, 42, 0.18));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.3;
    }

    .copy {
      min-width: 0;
      color: var(--mn-color-text-muted, #6b7280);
    }

    a {
      margin-left: var(--mn-space-1, 4px);
      color: var(--mn-color-text-link, var(--mn-color-accent, #2563eb));
      text-decoration: none;
    }

    a:hover,
    a:focus-visible {
      text-decoration: underline;
      outline: none;
    }

    .actions {
      display: flex;
      flex: 0 0 auto;
      gap: var(--mn-space-1, 4px);
    }

    button {
      min-height: 24px;
      padding: var(--mn-space-1, 4px) var(--mn-space-2-5, 10px);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-sm, 6px);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.2;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: 1px;
    }

    .primary {
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .primary:hover {
      filter: brightness(1.05);
    }

    .secondary {
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .secondary:hover {
      color: var(--mn-color-text-primary, #111827);
    }

    @media (max-width: 520px) {
      :host {
        right: var(--mn-space-4, 16px);
        left: var(--mn-space-4, 16px);
        max-width: none;
      }

      .banner {
        align-items: flex-start;
      }
    }
  `

  @property({ type: String, reflect: true, attribute: 'consent-state' }) consentState: MnConsentState = 'pending'
  @property({ type: String, attribute: 'privacy-href' }) privacyHref = '/privacy'
  @property({ type: String }) copy = 'Anonymous usage analytics?'
  @property({ type: String, attribute: 'learn-more-label' }) learnMoreLabel = 'Learn more'
  @property({ type: String, attribute: 'accept-label' }) acceptLabel = 'Sure'
  @property({ type: String, attribute: 'decline-label' }) declineLabel = 'No'

  private emitChoice(choice: MnConsentChoice): void {
    const detail: MnConsentChoiceDetail = { choice }
    this.dispatchEvent(new CustomEvent<MnConsentChoiceDetail>('mn-consent-choice', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnConsentChoiceDetail>(
      choice === 'accepted' ? 'mn-consent-accept' : 'mn-consent-decline',
      { detail, bubbles: true, composed: true },
    ))
  }

  private accept(): void {
    this.emitChoice('accepted')
  }

  private decline(): void {
    this.emitChoice('declined')
  }

  override render(): TemplateResult | typeof nothing {
    if (this.consentState !== 'pending') return nothing
    return html`
      <div class="banner" role="dialog" aria-live="polite" aria-label="Analytics consent">
        <span class="copy">
          ${this.copy}
          <a href=${this.privacyHref} target="_blank" rel="noopener">${this.learnMoreLabel}</a>
        </span>
        <div class="actions">
          <button type="button" class="secondary" @click=${this.decline}>${this.declineLabel}</button>
          <button type="button" class="primary" @click=${this.accept}>${this.acceptLabel}</button>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-consent-banner': MnConsentBanner
  }
}
