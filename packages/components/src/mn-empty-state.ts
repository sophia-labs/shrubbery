/**
 * mn-empty-state: a token-driven empty/error/placeholder state.
 *
 * Lifted from Garden's pure empty-state component and generalized for Shrubbery.
 * The caller supplies copy, icon, and actions; this component only arranges them.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { icon as renderIcon, iconStyles } from './icons.js'
import { SkinAware } from './skin-aware.js'

export type MnEmptyStateVariant = 'default' | 'compact' | 'inline'
export type MnEmptyStateMood = 'neutral' | 'success' | 'warning' | 'danger'

@customElement('mn-empty-state')
export class MnEmptyState extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #111827);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: var(--mn-space-8, 32px);
    }
    .variant-default { padding: var(--mn-space-10, 40px) var(--mn-space-6, 24px); }
    .variant-compact { padding: var(--mn-space-4, 16px); }
    .variant-inline {
      flex-direction: row;
      align-items: center;
      justify-content: flex-start;
      gap: var(--mn-space-4, 16px);
      text-align: left;
      padding: var(--mn-space-4, 16px);
    }

    .icon-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      margin-bottom: var(--mn-space-4, 16px);
      border-radius: var(--mn-radius-full, 9999px);
      color: var(--mn-color-text-tertiary, #6b7280);
      background: var(--mn-color-surface-sunken, #f3f4f6);
    }
    .variant-compact .icon-container {
      width: 40px;
      height: 40px;
      margin-bottom: var(--mn-space-3, 12px);
    }
    .variant-inline .icon-container {
      margin-bottom: 0;
      flex: 0 0 auto;
    }

    .mood-success .icon-container {
      color: var(--mn-color-success-strong, #166534);
      background: var(--mn-color-success-surface, #dcfce7);
    }
    .mood-warning .icon-container {
      color: var(--mn-color-warning-strong, #92400e);
      background: var(--mn-color-warning-surface, #fef3c7);
    }
    .mood-danger .icon-container {
      color: var(--mn-color-danger, #be123c);
      background: var(--mn-color-danger-surface, #ffe4e6);
    }

    .content {
      max-width: 320px;
    }
    .variant-inline .content {
      align-items: flex-start;
    }
    .title {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      font-weight: var(--mn-font-weight-semibold, 600);
      line-height: var(--mn-leading-tight, 1.2);
    }
    .variant-compact .title {
      margin-bottom: var(--mn-space-1, 4px);
      font-size: var(--mn-text-sm, 13px);
    }
    .description {
      margin: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      line-height: var(--mn-leading-relaxed, 1.5);
    }
    .variant-compact .description {
      font-size: var(--mn-text-xs, 12px);
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      margin-top: var(--mn-space-5, 20px);
    }
    .variant-compact .actions { margin-top: var(--mn-space-3, 12px); }
    .variant-inline .actions {
      justify-content: flex-start;
      margin-top: var(--mn-space-2, 8px);
    }

    .illustration {
      margin-bottom: var(--mn-space-4, 16px);
    }
    ::slotted([slot='illustration']) {
      max-width: 200px;
      max-height: 150px;
    }

    :host([data-skin='emporium']) .icon-container {
      border-radius: var(--mn-radius-control, 4px);
      border: var(--mn-rule-line, 1px solid var(--mn-color-border-default, #d1d5db));
    }
    :host([data-skin='98']) .icon-container {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='glass']) .icon-container {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
    }
  `

  @property({ type: String }) icon = 'inbox'
  @property({ type: String }) title = ''
  @property({ type: String }) description = ''
  @property({ type: String, reflect: true }) variant: MnEmptyStateVariant = 'default'
  @property({ type: String, reflect: true }) mood: MnEmptyStateMood = 'neutral'
  @property({ type: Boolean, attribute: 'hide-icon' }) hideIcon = false

  private _iconSize(): number {
    return this.variant === 'compact' ? 20 : 28
  }

  render() {
    const classes = {
      'empty-state': true,
      [`variant-${this.variant}`]: true,
      [`mood-${this.mood}`]: true,
    }

    return html`
      <div class=${classMap(classes)}>
        <slot name="illustration" class="illustration">
          ${this.hideIcon ? nothing : html`
            <div class="icon-container" aria-hidden="true">
              ${renderIcon(this.icon, { size: this._iconSize(), strokeWidth: 1.5 })}
            </div>
          `}
        </slot>

        <div class="content">
          ${this.title ? html`<h3 class="title">${this.title}</h3>` : nothing}
          ${this.description ? html`<p class="description">${this.description}</p>` : nothing}
          <slot name="description"></slot>
          <div class="actions">
            <slot name="action"></slot>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-empty-state': MnEmptyState
  }
}
