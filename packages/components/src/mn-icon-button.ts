/**
 * mn-icon-button — icon-only toolbar/control primitive.
 *
 * The label is required by convention and is used for aria-label, title, and the
 * hover/focus tooltip. Like mn-button, keep-focus prevents toolbar mousedown from
 * stealing an editor selection.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon as renderIcon, iconStyles, type IconName } from './icons.js'

export type MnIconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

@customElement('mn-icon-button')
export class MnIconButton extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      position: relative;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 2px;
    }

    button:hover:not(:disabled),
    button:active:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    button[aria-pressed='true'] {
      background: var(--mn-color-interactive-selected, #dbeafe);
      color: var(--mn-color-text-accent, #2563eb);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }

    .size-xs {
      width: max(22px, var(--mn-icon-button-hit-size, 0px));
      height: max(22px, var(--mn-icon-button-hit-size, 0px));
    }
    .size-sm {
      width: max(26px, var(--mn-icon-button-hit-size, 0px));
      height: max(26px, var(--mn-icon-button-hit-size, 0px));
    }
    .size-md {
      width: max(30px, var(--mn-icon-button-hit-size, 0px));
      height: max(30px, var(--mn-icon-button-hit-size, 0px));
    }
    .size-lg {
      width: max(36px, var(--mn-icon-button-hit-size, 0px));
      height: max(36px, var(--mn-icon-button-hit-size, 0px));
    }

    .loading {
      pointer-events: none;
    }

    .loading .icon-wrap {
      opacity: 0;
    }

    .spinner {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }

    .spinner::after {
      content: '';
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: mn-icon-button-spin 650ms linear infinite;
    }

    @keyframes mn-icon-button-spin {
      to { transform: rotate(360deg); }
    }

    .icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }

    .tooltip {
      position: fixed;
      z-index: var(--mn-z-tooltip, 1200);
      display: none;
      align-items: center;
      gap: 6px;
      max-width: 240px;
      padding: 4px 8px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-text-primary, #111827);
      color: var(--mn-color-text-inverse, #fff);
      box-shadow: var(--mn-shadow-raised, 0 4px 12px rgba(15, 23, 42, 0.18));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.2;
      pointer-events: none;
      white-space: nowrap;
    }

    :host(:hover) .tooltip,
    :host(:focus-within) .tooltip,
    .tooltip.visible {
      display: inline-flex;
    }

    .tooltip-shortcut {
      padding: 1px 4px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-2xs, 11px);
    }

    :host([data-skin='98']) button {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) button:hover:not(:disabled) {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
    }
    :host([data-skin='98']) button:active:not(:disabled),
    :host([data-skin='98']) button[aria-pressed='true'] {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='98']) button:focus-visible {
      outline: 1px dotted currentColor;
      outline-offset: -4px;
    }
    :host([data-skin='98']) .tooltip {
      border: 1px solid var(--mn-98-dark, #000);
      border-radius: 0;
      background: var(--mn-color-surface-warm, #ffffe1);
      color: var(--mn-color-text-primary, #000);
      box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.48);
    }
    :host([data-skin='glass']) button {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      color: var(--mn-color-text-primary);
      box-shadow: var(--mn-control-shadow);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) button:hover:not(:disabled) {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) button:active:not(:disabled),
    :host([data-skin='glass']) button[aria-pressed='true'] {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
      transform: translateY(1px);
    }
    :host([data-skin='glass']) .tooltip {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-elevated);
      box-shadow: var(--mn-shadow-popover);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
  `

  @property({ type: String }) icon: IconName | '' = ''
  @property({ type: String }) label = ''
  @property({ type: String, reflect: true }) size: MnIconButtonSize = 'md'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean, reflect: true }) loading = false
  @property({ type: Boolean, reflect: true }) pressed = false
  @property({ type: Boolean, attribute: 'keep-focus' }) keepFocus = false
  @property({ type: String }) shortcut: string | null = null
  @property({ attribute: false }) expanded: boolean | null = null
  @property({ attribute: false }) controls: string | null = null

  @state() private tooltipVisible = false

  @query('.tooltip') private tooltipEl!: HTMLElement | null

  protected override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties)
    if (changedProperties.has('tooltipVisible') && this.tooltipVisible) this.positionTooltip()
  }

  /**
   * The tooltip is `position: fixed` with no inset set, so absent this it
   * falls back to its static position — computed once from where it'd sit in
   * normal flow, then frozen in viewport coordinates. That's invisible until
   * the toolbar itself scrolls horizontally, at which point the button's
   * viewport position moves but the tooltip's frozen static position doesn't,
   * so it drifts further off from the button (and eventually off-screen) the
   * further the toolbar is scrolled. Anchoring explicitly to the host's live
   * `getBoundingClientRect()` on every show keeps it correct at any scroll offset.
   */
  private positionTooltip(): void {
    const tip = this.tooltipEl
    if (!tip) return
    const anchorRect = this.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    const gap = 6
    let top = anchorRect.bottom + gap
    if (top + tipRect.height > window.innerHeight) top = anchorRect.top - tipRect.height - gap
    let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2
    left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4))
    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }

  private handleMouseDown(event: MouseEvent): void {
    if (this.keepFocus) event.preventDefault()
  }

  private handleClick(event: MouseEvent): void {
    this.tooltipVisible = false
    if (!this.disabled && !this.loading) return
    event.preventDefault()
    event.stopPropagation()
  }

  private iconSize(): number {
    return { xs: 12, sm: 14, md: 16, lg: 18 }[this.size] ?? 16
  }

  override render() {
    const classes = {
      [`size-${this.size}`]: true,
      loading: this.loading,
    }
    const label = this.label || this.icon || 'Action'

    return html`
      <button
        type="button"
        class=${classMap(classes)}
        ?disabled=${this.disabled}
        aria-label=${label}
        aria-pressed=${String(this.pressed)}
        aria-expanded=${this.expanded === null ? nothing : String(this.expanded)}
        aria-controls=${this.controls ?? nothing}
        aria-busy=${this.loading ? 'true' : 'false'}
        title=${label}
        @mouseover=${() => { this.tooltipVisible = true }}
        @mouseout=${() => { this.tooltipVisible = false }}
        @mouseenter=${() => { this.tooltipVisible = true }}
        @mouseleave=${() => { this.tooltipVisible = false }}
        @focus=${() => { this.tooltipVisible = true }}
        @blur=${() => { this.tooltipVisible = false }}
        @mousedown=${(event: MouseEvent) => this.handleMouseDown(event)}
        @click=${(event: MouseEvent) => this.handleClick(event)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Escape') this.tooltipVisible = false
        }}
      >
        ${this.loading ? html`<span class="spinner" aria-hidden="true"></span>` : nothing}
        <span class="icon-wrap" aria-hidden="true">
          ${renderIcon(this.icon || 'circle', { size: this.iconSize() })}
        </span>
      </button>
      <div class=${classMap({ tooltip: true, visible: this.tooltipVisible })} role="tooltip">
        <span>${label}</span>
        ${this.shortcut ? html`<span class="tooltip-shortcut" aria-hidden="true">${this.shortcut}</span>` : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-icon-button': MnIconButton
  }
}
