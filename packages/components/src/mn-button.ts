/**
 * mn-button — Garden's core button primitive, lifted as a backend-free control.
 *
 * This preserves the editor-toolbar-critical behavior: variants/sizes, pressed
 * toolbar state, shortcut text, loading/disabled affordance, leading icon, and
 * keep-focus mousedown suppression for ProseMirror-style selections.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { SkinAware } from './skin-aware.js'
import { icon as renderIcon, iconStyles, type IconName } from './icons.js'

export type MnButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'toolbar'
export type MnButtonSize = 'xs' | 'sm' | 'md' | 'lg'

@customElement('mn-button')
export class MnButton extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: inline-block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([block]) {
      display: block;
    }

    :host([block]) button {
      width: 100%;
    }

    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      overflow: hidden;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      font-weight: var(--mn-font-weight-medium, 550);
      line-height: 1.2;
      text-decoration: none;
      white-space: nowrap;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 2px;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }

    .size-xs {
      min-height: max(24px, var(--mn-button-hit-size, 0px));
      padding: 0 var(--mn-space-2, 8px);
      font-size: var(--mn-text-xs, 12px);
    }

    .size-sm {
      min-height: max(var(--mn-control-height, 28px), var(--mn-button-hit-size, 0px));
      padding: 0 var(--mn-space-3, 12px);
    }

    .size-md {
      min-height: max(32px, var(--mn-button-hit-size, 0px));
      padding: 0 var(--mn-space-4, 16px);
    }

    .size-lg {
      min-height: max(38px, var(--mn-button-hit-size, 0px));
      padding: 0 var(--mn-space-5, 20px);
      font-size: var(--mn-text-base, 15px);
    }

    .variant-primary {
      border-color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .variant-primary:hover:not(:disabled) {
      border-color: var(--mn-color-accent-hover, #1d4ed8);
      background: var(--mn-color-accent-hover, #1d4ed8);
      box-shadow: var(--mn-shadow-primary, 0 2px 8px rgba(37, 99, 235, 0.24));
    }

    .variant-secondary {
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .variant-secondary:hover:not(:disabled) {
      border-color: var(--mn-color-border-strong, #9ca3af);
      background: var(--mn-color-surface-active, #e5e7eb);
    }

    .variant-ghost,
    .variant-toolbar {
      border-color: transparent;
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .variant-toolbar {
      border-radius: var(--mn-radius-sm, 4px);
    }

    .variant-ghost:hover:not(:disabled),
    .variant-toolbar:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .variant-danger {
      border-color: var(--mn-color-danger, #b91c1c);
      background: var(--mn-color-danger, #b91c1c);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .variant-danger:hover:not(:disabled) {
      border-color: var(--mn-color-danger-strong, #991b1b);
      background: var(--mn-color-danger-strong, #991b1b);
      box-shadow: var(--mn-shadow-status-danger, 0 2px 8px rgba(185, 28, 28, 0.24));
    }

    .pressed {
      border-color: transparent;
      background: var(--mn-color-interactive-selected, #dbeafe);
      color: var(--mn-color-text-accent, #2563eb);
    }

    .loading {
      pointer-events: none;
    }

    .loading .button-inner {
      opacity: 0;
    }

    .spinner {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      pointer-events: none;
    }

    .spinner::after {
      content: '';
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: mn-button-spin 650ms linear infinite;
    }

    @keyframes mn-button-spin {
      to { transform: rotate(360deg); }
    }

    .button-inner {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
    }

    .button-icon {
      display: inline-flex;
      flex: 0 0 auto;
      line-height: 0;
    }

    .button-label {
      display: var(--mn-label-display, inline);
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .button-shortcut {
      color: currentColor;
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-2xs, 11px);
      letter-spacing: 0;
      opacity: 0.68;
    }

    :host([data-skin='98']) button {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) button:hover:not(:disabled) {
      border-color: transparent;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) button:active:not(:disabled),
    :host([data-skin='98']) button.pressed {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='98']) button:focus-visible {
      outline: 1px dotted currentColor;
      outline-offset: -4px;
    }
    :host([data-skin='98']) .variant-danger {
      color: var(--mn-color-danger-strong, #800000);
    }
    :host([data-skin='glass']) button {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      color: var(--mn-color-text-primary);
      box-shadow: var(--mn-control-shadow);
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.42);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) button:hover:not(:disabled) {
      border: var(--mn-control-border);
      background: var(--mn-control-background-hover);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) button:active:not(:disabled),
    :host([data-skin='glass']) button.pressed {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
      transform: translateY(1px);
    }
    :host([data-skin='glass']) .variant-primary {
      color: var(--mn-color-text-on-accent);
      background: linear-gradient(180deg, rgba(112, 221, 239, 0.96), var(--mn-color-accent));
      text-shadow: 0 1px 1px rgba(0, 38, 66, 0.42);
    }
  `

  @property({ type: String, reflect: true }) variant: MnButtonVariant = 'primary'
  @property({ type: String, reflect: true }) size: MnButtonSize = 'md'
  @property({ type: String }) label: string | null = null
  @property({ type: String }) icon: IconName | '' = ''
  @property({ type: Boolean, reflect: true }) pressed = false
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean, reflect: true }) loading = false
  @property({ type: Boolean, attribute: 'keep-focus' }) keepFocus = false
  @property({ type: String }) shortcut: string | null = null
  @property({ type: String }) type: 'button' | 'submit' | 'reset' = 'button'
  @property({ type: Boolean, reflect: true }) block = false

  private handleMouseDown(event: MouseEvent): void {
    if (this.keepFocus) event.preventDefault()
  }

  private handleClick(event: MouseEvent): void {
    if (!this.disabled && !this.loading) return
    event.preventDefault()
    event.stopPropagation()
  }

  private iconSize(): number {
    return { xs: 12, sm: 14, md: 16, lg: 18 }[this.size] ?? 16
  }

  override render() {
    const isToolbar = this.variant === 'toolbar'
    const classes = {
      [`variant-${this.variant}`]: true,
      [`size-${this.size}`]: true,
      pressed: isToolbar && this.pressed,
      loading: this.loading,
    }

    return html`
      <button
        type=${this.type}
        class=${classMap(classes)}
        ?disabled=${this.disabled}
        aria-pressed=${ifDefined(isToolbar ? String(this.pressed) : undefined)}
        aria-busy=${this.loading ? 'true' : 'false'}
        aria-keyshortcuts=${ifDefined(this.shortcut ?? undefined)}
        @mousedown=${(event: MouseEvent) => this.handleMouseDown(event)}
        @click=${(event: MouseEvent) => this.handleClick(event)}
      >
        ${this.loading ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
        <span class="button-inner">
          ${this.icon
            ? html`<span class="button-icon" aria-hidden="true">${renderIcon(this.icon, { size: this.iconSize() })}</span>`
            : nothing}
          ${this.label !== null
            ? html`<span class="button-label">${this.label}</span>`
            : html`<span class="button-label"><slot></slot></span>`}
          ${this.shortcut
            ? html`<span class="button-shortcut" aria-hidden="true">${this.shortcut}</span>`
            : nothing}
        </span>
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-button': MnButton
  }
}
