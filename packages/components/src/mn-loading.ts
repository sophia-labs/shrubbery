/**
 * mn-loading: composed loading indicators for async UI.
 *
 * Generalized from Garden's pure loading component. The primitive is props-only
 * and token-driven; callers choose spinner/dots/pulse/skeleton plus optional
 * text. Fullscreen is a visual state, not a data fetch.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import './mn-spinner.js'

export type MnLoadingVariant = 'spinner' | 'dots' | 'pulse' | 'skeleton'
export type MnLoadingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

@customElement('mn-loading')
export class MnLoading extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    :host([fullscreen]) {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-overlay, 1500);
      background: var(--mn-color-surface-overlay, rgba(255, 255, 255, 0.82));
    }

    .container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
    }

    .text {
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .dots {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
    }
    .dot {
      border-radius: var(--mn-radius-full, 9999px);
      background: var(--mn-color-accent, #2563eb);
      animation: mn-loading-bounce 1.4s infinite ease-in-out both;
    }
    .dot:nth-child(1) { animation-delay: -0.32s; }
    .dot:nth-child(2) { animation-delay: -0.16s; }

    .dots.size-xs .dot { width: 4px; height: 4px; }
    .dots.size-sm .dot { width: 6px; height: 6px; }
    .dots.size-md .dot { width: 8px; height: 8px; }
    .dots.size-lg .dot { width: 10px; height: 10px; }
    .dots.size-xl .dot { width: 12px; height: 12px; }

    .pulse {
      border-radius: var(--mn-radius-full, 9999px);
      background: var(--mn-color-accent, #2563eb);
      animation: mn-loading-pulse 1.2s ease-in-out infinite;
    }
    .pulse.size-xs { width: 16px; height: 16px; }
    .pulse.size-sm { width: 20px; height: 20px; }
    .pulse.size-md { width: 24px; height: 24px; }
    .pulse.size-lg { width: 32px; height: 32px; }
    .pulse.size-xl { width: 48px; height: 48px; }

    .skeleton {
      width: 100%;
      min-width: 10rem;
      border-radius: var(--mn-radius-control, 4px);
      background: linear-gradient(
        90deg,
        var(--mn-color-surface-sunken, #f3f4f6) 25%,
        var(--mn-color-surface-hover, #e5e7eb) 50%,
        var(--mn-color-surface-sunken, #f3f4f6) 75%
      );
      background-size: 200% 100%;
      animation: mn-loading-shimmer 1.5s ease-in-out infinite;
    }
    .skeleton.size-xs { height: 12px; }
    .skeleton.size-sm { height: 16px; }
    .skeleton.size-md { height: 20px; }
    .skeleton.size-lg { height: 24px; }
    .skeleton.size-xl { height: 32px; }

    :host([data-skin='emporium']) .dot,
    :host([data-skin='emporium']) .pulse {
      border-radius: var(--mn-radius-control, 4px);
    }
    :host([data-skin='98']) .dot,
    :host([data-skin='98']) .pulse,
    :host([data-skin='98']) .skeleton {
      border-radius: 0;
    }
    :host([data-skin='98'][fullscreen]) {
      background: var(--mn-98-face);
    }
    :host([data-skin='glass'][fullscreen]) {
      background: var(--mn-color-surface-overlay);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }

    @keyframes mn-loading-bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
    }
    @keyframes mn-loading-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
    @keyframes mn-loading-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `

  @property({ type: String, reflect: true }) variant: MnLoadingVariant = 'spinner'
  @property({ type: String, reflect: true }) size: MnLoadingSize = 'md'
  @property({ type: String }) text = ''
  @property({ type: Boolean, reflect: true }) fullscreen = false

  private _indicator() {
    switch (this.variant) {
      case 'dots':
        return html`
          <span class="dots size-${this.size}" aria-hidden="true">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </span>
        `
      case 'pulse':
        return html`<span class="pulse size-${this.size}" aria-hidden="true"></span>`
      case 'skeleton':
        return html`<span class="skeleton size-${this.size}" aria-hidden="true"></span>`
      default:
        return html`<mn-spinner size=${this.size} label=${this.text || 'Loading'}></mn-spinner>`
    }
  }

  render() {
    return html`
      <div class="container" role="status" aria-label=${this.text || 'Loading'}>
        ${this._indicator()}
        ${this.text ? html`<span class="text">${this.text}</span>` : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-loading': MnLoading
  }
}
