/**
 * mn-spinner: a backend-free loading spinner primitive.
 *
 * Lifted from Garden's pure spinner shape and rebound to Shrubbery role tokens.
 * No stores, no runtime, no transport. It only reflects ambient skin/theme and
 * renders a CSS spinner with stable ARIA.
 */

import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

export type MnSpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

@customElement('mn-spinner')
export class MnSpinner extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--mn-color-accent, #2563eb);
    }

    .spinner {
      box-sizing: border-box;
      display: inline-block;
      flex-shrink: 0;
      border-style: solid;
      border-color: var(--mn-color-border-default, #d1d5db);
      border-top-color: currentColor;
      border-radius: var(--mn-radius-full, 9999px);
      animation: mn-spinner-spin 0.65s linear infinite;
    }

    .size-xs { width: 12px; height: 12px; border-width: 1.5px; }
    .size-sm { width: 16px; height: 16px; border-width: 2px; }
    .size-md { width: 20px; height: 20px; border-width: 2px; }
    .size-lg { width: 28px; height: 28px; border-width: 3px; }
    .size-xl { width: 40px; height: 40px; border-width: 3px; }

    :host([data-skin='emporium']) .spinner {
      border-radius: var(--mn-radius-control, 4px);
    }

    @keyframes mn-spinner-spin {
      to { transform: rotate(360deg); }
    }
  `

  @property({ type: String, reflect: true }) size: MnSpinnerSize = 'md'
  @property({ type: String }) label = 'Loading'

  render() {
    return html`
      <span
        class="spinner size-${this.size}"
        role="status"
        aria-label=${this.label}
      ></span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-spinner': MnSpinner
  }
}
