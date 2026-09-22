/**
 * mn-search-input — Garden's specialized search primitive, lifted as a
 * backend-free, skin-aware control.
 *
 * It keeps Garden's tiny event surface (`mn-input`, `mn-clear`, `mn-focus`,
 * `mn-blur`) and the shortcut-chip / clear-button behavior used across search
 * fields.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnSearchInputDetail {
  readonly value: string
}

@customElement('mn-search-input')
export class MnSearchInput extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .wrap {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      box-sizing: border-box;
      width: 100%;
      min-height: var(--mn-control-height, 28px);
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, var(--mn-color-surface-base, #fff));
      color: var(--mn-color-text-primary, #111827);
      transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
      cursor: text;
    }

    .wrap:hover:not(.disabled) {
      border-color: var(--mn-color-border-strong, #9ca3af);
    }

    .wrap.focused {
      border-color: var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
    }

    .wrap.disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }

    .search-icon {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      line-height: 0;
      pointer-events: none;
    }

    input {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.3;
    }

    input::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    input:disabled {
      cursor: not-allowed;
    }

    .shortcut-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      min-width: 0;
      height: 16px;
      padding: 0 var(--mn-space-1, 4px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-2xs, 11px);
      line-height: 1;
      white-space: nowrap;
      pointer-events: none;
    }

    .clear-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }

    .clear-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .clear-btn:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 1px;
    }
    :host([data-skin='98']) .wrap {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .wrap.focused {
      box-shadow: var(--mn-98-sunken), var(--mn-focus-ring);
    }
    :host([data-skin='98']) .shortcut-chip,
    :host([data-skin='98']) .clear-btn {
      border-radius: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='glass']) .wrap {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .wrap.focused {
      box-shadow: var(--mn-control-shadow-active), var(--mn-focus-ring);
    }
    :host([data-skin='glass']) .shortcut-chip,
    :host([data-skin='glass']) .clear-btn {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
  `

  @property({ type: String }) value = ''
  @property({ type: String }) placeholder = 'Search...'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: String }) shortcut: string | null = null
  @property({ type: String }) label = 'Search'

  @state() private focused = false

  @query('input') private inputEl!: HTMLInputElement

  private emitInput(value: string): void {
    this.dispatchEvent(
      new CustomEvent<MnSearchInputDetail>('mn-input', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement
    this.value = input.value
    this.emitInput(this.value)
  }

  private handleFocus(): void {
    this.focused = true
    this.dispatchEvent(new CustomEvent('mn-focus', { bubbles: true, composed: true }))
  }

  private handleBlur(): void {
    this.focused = false
    this.dispatchEvent(new CustomEvent('mn-blur', { bubbles: true, composed: true }))
  }

  private handleClear(): void {
    this.value = ''
    if (this.inputEl) {
      this.inputEl.value = ''
      this.inputEl.focus()
    }
    this.dispatchEvent(new CustomEvent('mn-clear', { bubbles: true, composed: true }))
    this.emitInput('')
  }

  override focus(options?: FocusOptions): void {
    this.inputEl?.focus(options)
  }

  override blur(): void {
    this.inputEl?.blur()
  }

  override render() {
    const hasValue = Boolean(this.value)
    return html`
      <div
        class=${classMap({ wrap: true, focused: this.focused, disabled: this.disabled })}
        @click=${() => this.inputEl?.focus()}
      >
        <span class="search-icon" aria-hidden="true">${icon('search', { size: 14 })}</span>
        <input
          type="search"
          .value=${this.value}
          placeholder=${this.placeholder}
          aria-label=${this.label}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          ?disabled=${this.disabled}
          @input=${(event: Event) => this.handleInput(event)}
          @focus=${() => this.handleFocus()}
          @blur=${() => this.handleBlur()}
        />
        ${!hasValue && this.shortcut
          ? html`<span class="shortcut-chip" aria-hidden="true">${this.shortcut}</span>`
          : nothing}
        ${hasValue
          ? html`
              <button class="clear-btn" type="button" aria-label="Clear search" tabindex="-1" @click=${() => this.handleClear()}>
                ${icon('x', { size: 12 })}
              </button>
            `
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-search-input': MnSearchInput
  }
}
