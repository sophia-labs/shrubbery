/**
 * mn-inline-edit — Garden's inline rename primitive, made backend-free.
 *
 * The component owns only transient edit text/error state. Committing emits a
 * cancelable `mn-save` event; hosts decide whether the rename is accepted.
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

export interface MnInlineEditSaveDetail {
  readonly value: string
  readonly previousValue: string
}

@customElement('mn-inline-edit')
export class MnInlineEdit extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      flex: 1 1 auto;
      position: relative;
      font-family: inherit;
      color: inherit;
    }

    .label {
      display: block;
      min-width: 0;
      max-width: 100%;
      margin: -2px -4px;
      padding: 2px 4px;
      overflow: hidden;
      border-radius: var(--mn-radius-sm, 4px);
      cursor: text;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: background var(--mn-transition-fast, 120ms ease);
    }

    .label:hover,
    .label:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      width: 100%;
      min-width: 0;
      position: relative;
    }

    .input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      margin: -2px -6px;
      padding: 2px 6px;
      border: 2px solid var(--mn-color-border-accent, #2563eb);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
      box-shadow: var(--mn-focus-ring, 0 0 0 3px rgba(37, 99, 235, 0.16));
      font: inherit;
      outline: none;
    }

    .input.error {
      border-color: var(--mn-color-danger, var(--mn-color-text-danger, #b91c1c));
      box-shadow: 0 0 0 3px var(--mn-color-danger-surface, #fef2f2);
    }

    .error-message {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: var(--mn-z-tooltip, 1200);
      max-width: min(280px, 90vw);
      padding: 4px 8px;
      border: 1px solid var(--mn-color-danger-border, #fecaca);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-text-danger, #b91c1c);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.3;
      white-space: normal;
    }

    :host(:not([editing])) .input-wrapper {
      display: none;
    }

    :host([editing]) .label {
      display: none;
    }
  `

  @property({ type: String }) value = ''
  @property({ type: String }) placeholder = 'Enter name...'
  @property({ type: Boolean, reflect: true }) editing = false
  @property({ type: String }) error = ''
  @property({ type: Boolean, attribute: 'select-all' }) selectAll = true
  @property({ type: String, attribute: 'aria-label' }) label = 'Edit name'

  @state() private editValue = ''

  @query('input') private inputElement?: HTMLInputElement

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('editing') && this.editing && !changed.get('editing')) {
      this.editValue = this.value
      void this.updateComplete.then(() => this.focusInput())
    }
    if (changed.has('value') && !this.editing) {
      this.editValue = this.value
    }
  }

  startEditing(): void {
    this.editValue = this.value
    this.error = ''
    this.editing = true
    void this.updateComplete.then(() => this.focusInput())
  }

  save(): void {
    const nextValue = this.editValue.trim()
    if (!nextValue) {
      this.error = 'Name cannot be empty'
      return
    }
    if (nextValue === this.value) {
      this.cancel()
      return
    }

    const event = new CustomEvent<MnInlineEditSaveDetail>('mn-save', {
      detail: { value: nextValue, previousValue: this.value },
      bubbles: true,
      composed: true,
      cancelable: true,
    })
    if (!this.dispatchEvent(event)) return

    this.value = nextValue
    this.editValue = nextValue
    this.editing = false
    this.error = ''
  }

  cancel(): void {
    this.editing = false
    this.editValue = this.value
    this.error = ''
    this.dispatchEvent(new CustomEvent('mn-cancel', { bubbles: true, composed: true }))
  }

  private focusInput(): void {
    const input = this.inputElement
    if (!input) return
    input.focus()
    if (this.selectAll) input.select()
  }

  private handleInput(event: Event): void {
    this.editValue = (event.target as HTMLInputElement).value
    this.error = ''
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      this.save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
    }
  }

  private handleBlur(): void {
    window.setTimeout(() => {
      if (this.editing) this.save()
    }, 100)
  }

  private handleLabelActivate(event: Event): void {
    event.stopPropagation()
    this.startEditing()
  }

  override render() {
    return html`
      <span
        class="label"
        role="button"
        tabindex="0"
        title="Click to rename"
        @click=${this.handleLabelActivate}
        @dblclick=${this.handleLabelActivate}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.handleLabelActivate(event)
          }
        }}
      >
        ${this.value || this.placeholder}
      </span>

      <div class="input-wrapper">
        <input
          class=${classMap({ input: true, error: !!this.error })}
          type="text"
          .value=${this.editValue}
          placeholder=${this.placeholder}
          aria-label=${this.label}
          aria-invalid=${this.error ? 'true' : 'false'}
          aria-describedby=${this.error ? 'mn-inline-edit-error' : nothing}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
          @blur=${this.handleBlur}
        />
        ${this.error
          ? html`<div id="mn-inline-edit-error" class="error-message" role="alert">${this.error}</div>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-inline-edit': MnInlineEdit
  }
}
