/**
 * mn-input — Garden's core text input primitive, lifted as a backend-free,
 * skin-aware control.
 *
 * Preserves Garden's public event surface (`mn-input`, `mn-change`, `mn-clear`,
 * `mn-focus`, `mn-blur`) while adapting icons/tokens to the Shrubbery component
 * island. The element owns only local focus/password-toggle state; value remains
 * a normal reflected property that a shell may control.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnInputType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search'
export type MnInputSize = 'sm' | 'md' | 'lg'

export interface MnInputValueDetail {
  readonly value: string
}

let nextInputId = 0

@customElement('mn-input')
export class MnInput extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .container {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }

    label {
      display: var(--mn-label-display, inline);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: var(--mn-font-weight-medium, 550);
      line-height: 1.3;
    }

    .required-mark {
      margin-inline-start: 3px;
      color: var(--mn-color-danger, #b91c1c);
    }

    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      box-sizing: border-box;
      width: 100%;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, var(--mn-color-surface-base, #fff));
      color: var(--mn-color-text-primary, #111827);
      transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
      cursor: text;
    }

    .input-wrap:hover:not(.disabled) {
      border-color: var(--mn-color-border-strong, #9ca3af);
    }

    .input-wrap.focused:not(.error-state) {
      border-color: var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
    }

    .input-wrap.error-state {
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #b91c1c));
    }

    .input-wrap.error-state.focused {
      box-shadow: var(--mn-shadow-error-ring, 0 0 0 2px rgba(185, 28, 28, 0.18));
    }

    .input-wrap.disabled {
      border-color: var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-muted, #f9fafb);
      cursor: not-allowed;
      opacity: 0.58;
    }

    .size-sm .input-wrap {
      min-height: 28px;
      padding: 0 var(--mn-space-2, 8px);
    }

    .size-md .input-wrap {
      min-height: 32px;
      padding: 0 var(--mn-space-3, 12px);
    }

    .size-lg .input-wrap {
      min-height: 38px;
      padding: 0 var(--mn-space-4, 16px);
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

    .size-sm input {
      font-size: var(--mn-text-xs, 12px);
    }

    .size-lg input {
      font-size: var(--mn-text-base, 15px);
    }

    input::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    input:disabled {
      cursor: not-allowed;
    }

    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus {
      -webkit-text-fill-color: var(--mn-color-text-primary, #111827);
      -webkit-box-shadow: inset 0 0 0 1000px var(--mn-color-surface-base, #fff);
      transition: background-color 5000s ease-in-out 0s;
    }

    .adornment {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      min-width: 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      line-height: 0;
      pointer-events: none;
    }

    .adornment:empty {
      display: none;
    }

    .adornment-suffix {
      pointer-events: auto;
    }

    ::slotted([slot='prefix']),
    ::slotted([slot='suffix']) {
      display: inline-flex;
      align-items: center;
    }

    .ctrl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }

    .ctrl-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .ctrl-btn:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 1px;
    }

    .helper,
    .error-msg {
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .helper {
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .error-msg {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      color: var(--mn-color-danger, #b91c1c);
    }

    @media (max-width: 768px) {
      input {
        font-size: 16px;
      }
    }

    :host([data-skin='98']) .input-wrap {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken, #fff);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .input-wrap:hover:not(.disabled) {
      border-color: transparent;
    }
    :host([data-skin='98']) .input-wrap.focused:not(.error-state) {
      border-color: transparent;
      box-shadow: var(--mn-98-sunken), var(--mn-focus-ring);
    }
    :host([data-skin='98']) .ctrl-btn {
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .ctrl-btn:active {
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='glass']) .input-wrap {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .input-wrap.focused:not(.error-state) {
      box-shadow: var(--mn-control-shadow-active), var(--mn-focus-ring);
    }
    :host([data-skin='glass']) .ctrl-btn {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) .ctrl-btn:active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }
  `

  private readonly inputId = `mn-input-${++nextInputId}`

  @property({ type: String }) label = ''
  @property({ type: String }) type: MnInputType = 'text'
  @property({ type: String }) placeholder = ''
  @property({ type: String }) value = ''
  @property({ type: String }) name = ''
  @property({ type: String, reflect: true }) size: MnInputSize = 'md'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean, reflect: true }) required = false
  @property({ type: Boolean, reflect: true }) error = false
  @property({ type: String, attribute: 'error-message' }) errorMessage = ''
  @property({ type: String, attribute: 'helper-text' }) helperText = ''
  @property({ type: Boolean }) clearable = false
  @property({ type: String }) autocomplete = ''

  @state() private focused = false
  @state() private passwordVisible = false

  @query('input') private inputEl!: HTMLInputElement

  private emitValue(name: string, value: string): void {
    this.dispatchEvent(
      new CustomEvent<MnInputValueDetail>(name, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement
    this.value = input.value
    this.emitValue('mn-input', this.value)
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement
    this.value = input.value
    this.emitValue('mn-change', this.value)
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
    this.emitValue('mn-change', '')
  }

  private togglePassword(): void {
    this.passwordVisible = !this.passwordVisible
  }

  override focus(options?: FocusOptions): void {
    this.inputEl?.focus(options)
  }

  override blur(): void {
    this.inputEl?.blur()
  }

  select(): void {
    this.inputEl?.select()
  }

  override render() {
    const inputType = this.type === 'password' && this.passwordVisible ? 'text' : this.type
    const showClear = this.clearable && Boolean(this.value) && !this.disabled
    const showPasswordToggle = this.type === 'password' && !this.disabled
    const descriptionId = this.error && this.errorMessage ? `${this.inputId}-error` : this.helperText ? `${this.inputId}-helper` : undefined

    return html`
      <div class="container size-${this.size}">
        ${this.label
          ? html`
              <label id=${`${this.inputId}-label`} for=${this.inputId}>
                ${this.label}${this.required ? html`<span class="required-mark" aria-hidden="true">*</span>` : nothing}
              </label>
            `
          : nothing}

        <div
          class=${classMap({
            'input-wrap': true,
            focused: this.focused,
            'error-state': this.error,
            disabled: this.disabled,
          })}
          @click=${() => this.inputEl?.focus()}
        >
          <span class="adornment"><slot name="prefix"></slot></span>
          <input
            id=${this.inputId}
            .value=${this.value}
            type=${inputType}
            name=${ifDefined(this.name || undefined)}
            placeholder=${ifDefined(this.placeholder || undefined)}
            autocomplete=${ifDefined(this.autocomplete || undefined)}
            aria-label=${ifDefined(this.label ? undefined : 'input')}
            aria-labelledby=${ifDefined(this.label ? `${this.inputId}-label` : undefined)}
            aria-describedby=${ifDefined(descriptionId)}
            aria-required=${this.required ? 'true' : 'false'}
            aria-invalid=${this.error ? 'true' : 'false'}
            ?disabled=${this.disabled}
            ?required=${this.required}
            @input=${(event: Event) => this.handleInput(event)}
            @change=${(event: Event) => this.handleChange(event)}
            @focus=${() => this.handleFocus()}
            @blur=${() => this.handleBlur()}
          />

          ${showClear
            ? html`
                <button class="ctrl-btn" type="button" aria-label="Clear" @click=${() => this.handleClear()}>
                  ${icon('x', { size: 12 })}
                </button>
              `
            : nothing}

          ${showPasswordToggle
            ? html`
                <button
                  class="ctrl-btn"
                  type="button"
                  aria-label=${this.passwordVisible ? 'Hide password' : 'Show password'}
                  @click=${() => this.togglePassword()}
                >
                  ${icon(this.passwordVisible ? 'eye-off' : 'eye', { size: 14 })}
                </button>
              `
            : nothing}

          <span class="adornment adornment-suffix"><slot name="suffix"></slot></span>
        </div>

        ${this.error && this.errorMessage
          ? html`
              <div id=${`${this.inputId}-error`} class="error-msg" role="alert">
                ${icon('alert-circle', { size: 12 })}<span>${this.errorMessage}</span>
              </div>
            `
          : this.helperText
            ? html`<div id=${`${this.inputId}-helper`} class="helper">${this.helperText}</div>`
            : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-input': MnInput
  }
}
