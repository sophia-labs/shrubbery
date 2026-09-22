/**
 * Compact primary navigation for a Shrubbery surface.
 *
 * This remains a controlled projection: the host owns the active root and the
 * resource/navigation lifetime.  The element only renders stable top-level
 * destinations and emits navigation intents.  A document is deliberately not
 * one of those destinations; it is presented by the host as a detail within
 * Home or Browse.
 *
 * The historical `MnMobileTab` name remains exported because it is part of the
 * public component package.  Its values are primary roots, not ARIA tabs.
 */
import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { icon, iconStyles } from './icons.js'

export type MnMobileTab = 'home' | 'browse' | 'sophia'
export type MnMobileCenterMode = 'document' | 'home'

export interface MnMobileTabDetail {
  tab: MnMobileTab
}

@customElement('mn-mobile-tabs')
export class MnMobileTabs extends LitElement {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      flex-shrink: 0;
      width: 100%;
      z-index: 100;
      background: var(--mn-bottom-bar-bg, var(--mn-color-surface-chrome, var(--mn-color-surface-base)));
      border: 0;
      box-shadow:
        inset 0 1px 0 var(--mn-bottom-bar-border, var(--mn-color-rule, var(--mn-color-border-default))),
        0 -1px 5px rgba(30, 45, 36, 0.045);
      padding-bottom: var(--organism-safe-area-bottom, env(safe-area-inset-bottom, 0px));
    }

    .navigation-bar {
      display: flex;
      width: 100%;
      max-width: 600px;
      height: var(--organism-mobile-navigation-height, 64px);
      margin: 0 auto;
    }

    .destination {
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: var(--mn-touch-target-size, 48px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      background: transparent;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: var(--mn-bottom-bar-text-muted, var(--mn-color-text-muted));
      transition:
        color var(--mn-transition-fast),
        background var(--mn-transition-fast);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      font-family: var(--mn-font-utility, var(--mn-font-chrome));
    }

    .destination:active {
      background: var(--mn-color-interactive-active, rgba(34, 68, 53, 0.1));
    }

    .destination[data-active='true'] {
      color: var(--mn-color-text-accent);
    }

    .destination::before {
      content: '';
      position: absolute;
      inset: 0 auto auto 50%;
      width: 28px;
      height: 2px;
      border-radius: 0 0 2px 2px;
      background: currentColor;
      opacity: 0;
      transform: translateX(-50%) scaleX(0.35);
      transform-origin: center;
      transition:
        opacity var(--mn-transition-normal),
        transform var(--mn-transition-normal);
    }

    .destination[data-active='true']::before {
      opacity: 0.9;
      transform: translateX(-50%) scaleX(1);
    }

    .destination:focus-visible {
      outline: var(--mn-focus-ring-width, 2px) solid var(--mn-focus-ring-color, currentColor);
      outline-offset: -4px;
      border-radius: 8px;
    }

    .tab-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      transition: transform var(--mn-transition-normal);
    }

    .tab-label {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.6875rem;
      font-weight: var(--mn-font-weight-medium);
      letter-spacing: 0.02em;
      line-height: 1;
    }

    @keyframes mn-tab-pop {
      0% { transform: scale(1); }
      40% { transform: translateY(-1px) scale(1.1); }
      100% { transform: scale(1); }
    }

    .tab-icon[data-pop='true'] {
      animation: mn-tab-pop 0.22s ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .tab-icon[data-pop='true'] {
        animation: none;
      }
    }
  `

  @property({ type: String })
  activeTab: MnMobileTab = 'home'

  /** @deprecated Documents are details within Home or Browse, never tabs. */
  @property({ type: String })
  centerMode: MnMobileCenterMode = 'home'

  private poppingTab: MnMobileTab | null = null
  private popTimer: ReturnType<typeof setTimeout> | null = null

  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has('activeTab')) return
    // Prepare transient animation state before this render instead of mutating
    // reactive state from updated() and forcing a second Lit update.
    if (this.popTimer) clearTimeout(this.popTimer)
    this.poppingTab = this.activeTab
    this.popTimer = setTimeout(() => {
      this.poppingTab = null
      this.popTimer = null
      this.requestUpdate()
    }, 250)
  }

  disconnectedCallback() {
    if (this.popTimer) clearTimeout(this.popTimer)
    this.popTimer = null
    this.poppingTab = null
    super.disconnectedCallback()
  }

  private emit(detail: MnMobileTabDetail) {
    this.dispatchEvent(new CustomEvent('navigation-change', {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private handleDestinationClick(tab: MnMobileTab) {
    if (tab === this.activeTab) return
    this.emit({ tab })
  }

  private renderDestination(tab: MnMobileTab, label: string, iconName: string) {
    const active = this.activeTab === tab
    return html`
      <button
        type="button"
        class="destination"
        data-active=${active}
        aria-current=${active ? 'page' : 'false'}
        @click=${() => this.handleDestinationClick(tab)}
      >
        <span class="tab-icon" data-pop=${this.poppingTab === tab}>
          ${icon(iconName, { size: 18 })}
        </span>
        <span class="tab-label">${label}</span>
      </button>
    `
  }

  render() {
    return html`
      <nav class="navigation-bar" aria-label="Primary">
        ${this.renderDestination('home', 'Home', 'sprout')}
        ${this.renderDestination('browse', 'Browse', 'folder')}
        ${this.renderDestination('sophia', 'Sophia', 'message-circle')}
      </nav>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-mobile-tabs': MnMobileTabs
  }
}
