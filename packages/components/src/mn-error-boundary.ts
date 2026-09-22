/**
 * Mnemosyne error boundary surface lifted from Garden.
 *
 * Pure display component: the host decides what failed and handles recovery
 * intents. The component renders the error state and optional diagnostics.
 */
import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { icon, iconStyles } from './icons.js'

export type MnErrorBoundaryVariant = 'error' | 'warning' | 'not-found' | 'network'

@customElement('mn-error-boundary')
export class MnErrorBoundary extends LitElement {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
    }

    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-12) var(--mn-space-6);
      text-align: center;
      min-height: 300px;
      box-sizing: border-box;
    }

    :host([fullscreen]) .container {
      min-height: 100vh;
    }

    .icon-container {
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--mn-radius-full);
      margin-bottom: var(--mn-space-5);
    }

    .variant-error .icon-container {
      background: var(--mn-color-danger-surface);
      color: var(--mn-color-text-danger);
    }

    .variant-warning .icon-container {
      background: var(--mn-color-warning-surface);
      color: var(--mn-color-text-warning);
    }

    .variant-not-found .icon-container {
      background: var(--mn-color-surface-hover);
      color: var(--mn-color-text-tertiary);
    }

    .variant-network .icon-container {
      background: var(--mn-color-info-surface);
      color: var(--mn-color-info);
    }

    .title {
      font-size: var(--mn-text-2xl);
      font-weight: var(--mn-font-weight-semibold);
      color: var(--mn-color-text-primary);
      margin: 0 0 var(--mn-space-3);
      line-height: 1.15;
    }

    .message {
      font-size: var(--mn-text-base);
      color: var(--mn-color-text-secondary);
      line-height: 1.6;
      max-width: 500px;
      margin: 0 0 var(--mn-space-6);
    }

    .error-details {
      width: 100%;
      max-width: 600px;
      margin-bottom: var(--mn-space-6);
    }

    .details-toggle {
      padding: var(--mn-space-2) var(--mn-space-3);
      font-family: var(--mn-font-chrome);
      font-size: var(--mn-text-sm);
      color: var(--mn-color-text-tertiary);
      background: transparent;
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-md);
      cursor: pointer;
      transition: all var(--mn-transition-fast);
      display: flex;
      align-items: center;
      gap: var(--mn-space-2);
      margin: 0 auto var(--mn-space-3);
    }

    .details-toggle:hover {
      background: var(--mn-color-surface-raised);
      border-color: var(--mn-color-border-strong);
      color: var(--mn-color-text-secondary);
    }

    .details-content {
      padding: var(--mn-space-4);
      background: var(--mn-color-surface-sunken);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-lg);
      text-align: left;
      overflow: auto;
      max-height: 300px;
    }

    .error-stack {
      font-family: var(--mn-font-mono);
      font-size: var(--mn-text-xs);
      color: var(--mn-color-text-secondary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3);
      flex-wrap: wrap;
      justify-content: center;
    }

    button {
      padding: var(--mn-space-2-5) var(--mn-space-5);
      font-family: var(--mn-font-chrome);
      font-size: var(--mn-text-sm);
      font-weight: var(--mn-font-weight-medium);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-md);
      cursor: pointer;
      transition: all var(--mn-transition-fast);
    }

    button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color);
      outline-offset: 2px;
    }

    .primary-action {
      background: var(--mn-color-accent);
      color: var(--mn-color-text-on-accent);
    }

    .primary-action:hover {
      background: var(--mn-color-accent-hover);
      box-shadow: var(--mn-shadow-primary);
    }

    .secondary-action {
      background: transparent;
      color: var(--mn-color-text-secondary);
      border-color: var(--mn-color-border-default);
    }

    .secondary-action:hover {
      background: var(--mn-color-surface-hover);
      border-color: var(--mn-color-border-strong);
      color: var(--mn-color-text-primary);
    }

    @media (max-width: 768px) {
      .container {
        padding: var(--mn-space-8) var(--mn-space-4);
      }

      .icon-container {
        width: 64px;
        height: 64px;
      }

      .title {
        font-size: var(--mn-text-xl);
      }

      .actions {
        flex-direction: column;
        width: 100%;
      }

      button {
        width: 100%;
      }
    }
  `

  @property({ type: String, reflect: true })
  variant: MnErrorBoundaryVariant = 'error'

  @property({ type: String })
  title = 'Something went wrong'

  @property({ type: String })
  message = 'An unexpected error occurred. Please try again.'

  @property({ type: String, attribute: 'action-text' })
  actionText = 'Try Again'

  @property({ type: String, attribute: 'secondary-action-text' })
  secondaryActionText = ''

  @property({ type: Boolean, attribute: 'show-details' })
  showDetails = false

  @property({ type: String, attribute: 'error-stack' })
  errorStack = ''

  @property({ type: Boolean, reflect: true })
  fullscreen = false

  @state() private detailsExpanded = false

  private iconName(): string {
    return {
      error: 'alert-circle',
      warning: 'alert-triangle',
      'not-found': 'search-x',
      network: 'wifi-off',
    }[this.variant]
  }

  private defaultTitle(): string {
    return this.title || {
      error: 'Something went wrong',
      warning: 'Warning',
      'not-found': 'Not Found',
      network: 'Connection Error',
    }[this.variant]
  }

  private emit(name: 'mn-action' | 'mn-secondary-action') {
    this.dispatchEvent(new CustomEvent(name, {
      bubbles: true,
      composed: true,
    }))
  }

  private toggleDetails() {
    this.detailsExpanded = !this.detailsExpanded
  }

  render() {
    return html`
      <div class="container variant-${this.variant}">
        <div class="icon-container">
          ${icon(this.iconName(), { size: 40, strokeWidth: 2 })}
        </div>

        <h1 class="title">${this.defaultTitle()}</h1>
        <p class="message">${this.message}</p>

        ${this.showDetails && this.errorStack ? html`
          <div class="error-details">
            <button
              class="details-toggle"
              @click=${() => this.toggleDetails()}
              aria-expanded=${this.detailsExpanded}
            >
              ${icon('code', { size: 14 })}
              ${this.detailsExpanded ? 'Hide' : 'Show'} Error Details
            </button>

            ${this.detailsExpanded ? html`
              <div class="details-content">
                <pre class="error-stack">${this.errorStack}</pre>
              </div>
            ` : nothing}
          </div>
        ` : nothing}

        <div class="actions">
          ${this.actionText ? html`
            <button class="primary-action" @click=${() => this.emit('mn-action')}>
              ${this.actionText}
            </button>
          ` : nothing}

          ${this.secondaryActionText ? html`
            <button class="secondary-action" @click=${() => this.emit('mn-secondary-action')}>
              ${this.secondaryActionText}
            </button>
          ` : nothing}

          <slot name="actions"></slot>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-error-boundary': MnErrorBoundary
  }
}
