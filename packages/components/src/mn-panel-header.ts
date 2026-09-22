/**
 * mn-panel-header — Garden's shared panel title/action row, kept pure.
 *
 * This replaces repeated panel header chrome with a token-driven primitive. The
 * component owns only its collapsible affordance state and emits composed intents
 * for hosts that need to hide/show panel bodies.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-tooltip.js'

@customElement('mn-panel-header')
export class MnPanelHeader extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: var(--mn-y-slice-1-height, 40px);
      min-height: var(--mn-y-slice-1-height, 40px);
      box-sizing: border-box;
      flex-shrink: 0;
      gap: var(--mn-space-4, 16px);
      padding: 0 var(--mn-space-4, 16px);
      overflow: hidden;
      border-bottom: var(--mn-panel-header-rule, 1px solid var(--mn-color-border-subtle, #e5e7eb));
      background: transparent;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .left {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 1 1 auto;
      gap: var(--mn-space-2, 8px);
    }

    .icon-slot {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .title {
      display: var(--mn-label-display, inline);
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, var(--mn-font-chrome, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
      letter-spacing: 0.05em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      box-sizing: border-box;
      flex: 0 0 auto;
      padding: 0 var(--mn-space-1, 4px);
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 550;
      line-height: 1;
    }

    .actions {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      gap: var(--mn-space-1, 4px);
    }

    .collapse-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, var(--mn-radius-md, 6px));
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      outline: none;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .collapse-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .collapse-btn:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    .collapse-btn[aria-expanded='false'] .mn-icon {
      transform: rotate(-90deg);
    }
    :host([data-skin='98']) {
      border-bottom: 2px groove var(--mn-98-face);
      background: var(--mn-98-face);
    }
    :host([data-skin='98']) :is(.badge, .collapse-btn) {
      border-radius: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='glass']) {
      border-bottom: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-chrome);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) :is(.badge, .collapse-btn) {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
  `

  @property({ type: String }) title = ''
  @property({ type: Number }) count: number | undefined
  @property({ type: Boolean }) collapsible = false
  @property({ type: Boolean, reflect: true }) collapsed = false

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed
    this.dispatchEvent(
      new CustomEvent(this.collapsed ? 'mn-collapse' : 'mn-expand', {
        detail: { collapsed: this.collapsed },
        bubbles: true,
        composed: true,
      }),
    )
  }

  override render() {
    const label = this.collapsed ? 'Expand panel' : 'Collapse panel'

    return html`
      <div class="left">
        <slot name="icon" class="icon-slot"></slot>
        <span class="title">${this.title}</span>
        ${this.count !== undefined ? html`<span class="badge">${this.count}</span>` : nothing}
      </div>

      <div class="actions">
        <slot name="actions"></slot>
        ${this.collapsible
          ? html`
              <mn-tooltip .label=${label} placement="bottom">
                <button
                  class="collapse-btn"
                  type="button"
                  aria-expanded=${this.collapsed ? 'false' : 'true'}
                  aria-label=${label}
                  @click=${this.toggleCollapsed}
                >
                  ${icon('chevron-down', { size: 14 })}
                </button>
              </mn-tooltip>
            `
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-panel-header': MnPanelHeader
  }
}
