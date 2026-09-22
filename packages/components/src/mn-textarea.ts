/**
 * mn-textarea — Garden's core multiline input primitive, lifted as a
 * backend-free, skin-aware control.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnTextareaResize = 'none' | 'vertical' | 'horizontal' | 'both'

export interface MnTextareaValueDetail {
  readonly value: string
}

let nextTextareaId = 0

@customElement('mn-textarea')
export class MnTextarea extends SkinAware(LitElement) {
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

    .wrap {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 100%;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, var(--mn-color-surface-base, #fff));
      color: var(--mn-color-text-primary, #111827);
      transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }

    .wrap:hover:not(.disabled) {
      border-color: var(--mn-color-border-strong, #9ca3af);
    }

    .wrap.focused:not(.error-state) {
      border-color: var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
    }

    .wrap.error-state {
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #b91c1c));
    }

    .wrap.error-state.focused {
      box-shadow: var(--mn-shadow-error-ring, 0 0 0 2px rgba(185, 28, 28, 0.18));
    }

    .wrap.disabled {
      border-color: var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-muted, #f9fafb);
      cursor: not-allowed;
      opacity: 0.58;
    }

    textarea {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      line-height: var(--mn-leading-normal, 1.45);
    }

    textarea:disabled {
      cursor: not-allowed;
    }

    textarea::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    textarea.resize-none {
      resize: none;
    }

    textarea.resize-vertical {
      resize: vertical;
    }

    textarea.resize-horizontal {
      resize: horizontal;
    }

    textarea.resize-both {
      resize: both;
    }

    .char-count {
      align-self: flex-end;
      padding: 0 var(--mn-space-2, 8px) var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.2;
    }

    .char-count.over-limit {
      color: var(--mn-color-danger, #b91c1c);
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

    :host([data-skin='98']) .wrap {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .wrap.focused:not(.error-state) {
      box-shadow: var(--mn-98-sunken), var(--mn-focus-ring);
    }
    :host([data-skin='glass']) .wrap {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .wrap.focused:not(.error-state) {
      box-shadow: var(--mn-control-shadow-active), var(--mn-focus-ring);
    }
  `

  private readonly textareaId = `mn-textarea-${++nextTextareaId}`

  @property({ type: String }) label = ''
  @property({ type: String }) value = ''
  @property({ type: String }) placeholder = ''
  @property({ type: String }) name = ''
  @property({ type: Number }) rows = 4
  @property({ type: Number }) maxlength?: number
  @property({ type: String }) resize: MnTextareaResize = 'vertical'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean, reflect: true }) required = false
  @property({ type: Boolean, reflect: true }) error = false
  @property({ type: String, attribute: 'error-message' }) errorMessage = ''
  @property({ type: String, attribute: 'helper-text' }) helperText = ''

  @state() private focused = false

  @query('textarea') private textareaEl!: HTMLTextAreaElement

  private emitValue(name: string, value: string): void {
    this.dispatchEvent(
      new CustomEvent<MnTextareaValueDetail>(name, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private handleInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement
    this.value = textarea.value
    this.emitValue('mn-input', this.value)
  }

  private handleChange(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement
    this.value = textarea.value
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

  override focus(options?: FocusOptions): void {
    this.textareaEl?.focus(options)
  }

  override blur(): void {
    this.textareaEl?.blur()
  }

  select(): void {
    this.textareaEl?.select()
  }

  override render() {
    const charCount = this.value.length
    const overLimit = this.maxlength != null && charCount > this.maxlength
    const descriptionId = this.error && this.errorMessage
      ? `${this.textareaId}-error`
      : this.helperText
        ? `${this.textareaId}-helper`
        : undefined

    return html`
      <div class="container">
        ${this.label
          ? html`
              <label id=${`${this.textareaId}-label`} for=${this.textareaId}>
                ${this.label}${this.required ? html`<span class="required-mark" aria-hidden="true">*</span>` : nothing}
              </label>
            `
          : nothing}

        <div
          class=${classMap({
            wrap: true,
            focused: this.focused,
            'error-state': this.error,
            disabled: this.disabled,
          })}
        >
          <textarea
            id=${this.textareaId}
            .value=${this.value}
            name=${ifDefined(this.name || undefined)}
            placeholder=${ifDefined(this.placeholder || undefined)}
            rows=${this.rows}
            maxlength=${ifDefined(this.maxlength)}
            class=${`resize-${this.resize}`}
            aria-label=${ifDefined(this.label ? undefined : 'textarea')}
            aria-labelledby=${ifDefined(this.label ? `${this.textareaId}-label` : undefined)}
            aria-describedby=${ifDefined(descriptionId)}
            aria-required=${this.required ? 'true' : 'false'}
            aria-invalid=${this.error ? 'true' : 'false'}
            ?disabled=${this.disabled}
            ?required=${this.required}
            @input=${(event: Event) => this.handleInput(event)}
            @change=${(event: Event) => this.handleChange(event)}
            @focus=${() => this.handleFocus()}
            @blur=${() => this.handleBlur()}
          ></textarea>

          ${this.maxlength != null
            ? html`
                <span class=${classMap({ 'char-count': true, 'over-limit': overLimit })} aria-live="polite">
                  ${charCount}/${this.maxlength}
                </span>
              `
            : nothing}
        </div>

        ${this.error && this.errorMessage
          ? html`
              <div id=${`${this.textareaId}-error`} class="error-msg" role="alert">
                ${icon('alert-circle', { size: 12 })}<span>${this.errorMessage}</span>
              </div>
            `
          : this.helperText
            ? html`<div id=${`${this.textareaId}-helper`} class="helper">${this.helperText}</div>`
            : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-textarea': MnTextarea
  }
}
