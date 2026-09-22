/**
 * mn-feedback-form - Garden's private-beta feedback form, made controlled.
 *
 * Garden submitted directly through ApiClient and created toast elements. This
 * Shrubbery lift keeps the modal form and local form editing only; submit/cancel
 * leave as typed events for the host to handle.
 */

import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-modal.js'
import './mn-button.js'

export type MnFeedbackType = 'general' | 'bug' | 'feature' | 'question'

export interface MnFeedbackSubmitDetail {
  readonly content: string
  readonly feedbackType: MnFeedbackType
  readonly rating: number | null
}

export interface MnFeedbackCloseDetail {
  readonly reason: 'cancel' | 'modal'
}

interface FeedbackTypeOption {
  readonly type: MnFeedbackType
  readonly label: string
  readonly icon: string
}

const TYPE_OPTIONS: readonly FeedbackTypeOption[] = [
  { type: 'general', label: 'General', icon: 'message-circle' },
  { type: 'bug', label: 'Bug Report', icon: 'bug' },
  { type: 'feature', label: 'Feature Request', icon: 'lightbulb' },
  { type: 'question', label: 'Question', icon: 'help-circle' },
]

function clampContent(value: string, maxLength: number): string {
  return value.slice(0, maxLength)
}

@customElement('mn-feedback-form')
export class MnFeedbackForm extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: contents;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
      overflow-x: hidden;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
    }

    .field-label {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: var(--mn-font-weight-medium, 550);
    }

    .optional {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-weight: 400;
    }

    .type-chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
    }

    .type-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .type-chip:hover,
    .type-chip:focus-visible {
      border-color: var(--mn-color-border-accent, #93c5fd);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .type-chip.selected {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent-strong, #1d4ed8);
    }

    .textarea {
      width: 100%;
      min-height: 120px;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-base, 15px);
      resize: vertical;
      transition: border-color var(--mn-transition-fast, 120ms ease);
      box-sizing: border-box;
    }

    .textarea::placeholder {
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .textarea:focus {
      border-color: var(--mn-color-border-focus, #2563eb);
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
    }

    .textarea:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .char-count {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: right;
    }

    .char-count.warning {
      color: var(--mn-color-text-warning, #b45309);
    }

    .char-count.error {
      color: var(--mn-color-text-danger, #b91c1c);
    }

    .rating {
      display: flex;
      gap: var(--mn-space-1, 4px);
    }

    .star {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-1, 4px);
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
      transition:
        color var(--mn-transition-fast, 120ms ease),
        transform var(--mn-transition-fast, 120ms ease);
    }

    .star:hover,
    .star.hovered,
    .star.filled {
      color: var(--mn-color-warning, #d97706);
    }

    .star:hover,
    .star.hovered {
      transform: scale(1.1);
    }

    .star.filled .mn-icon,
    .star.hovered .mn-icon {
      fill: currentColor;
    }

    .star:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: 1px;
    }

    .footer-buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: Boolean }) submitting = false
  @property({ type: Number, attribute: 'min-length' }) minLength = 10
  @property({ type: Number, attribute: 'max-length' }) maxLength = 5000
  @property({ type: String }) content = ''
  @property({ type: String, attribute: 'feedback-type' }) feedbackType: MnFeedbackType = 'general'
  @property({ type: Number }) rating: number | null = null

  @state() private hoveredRating: number | null = null

  private get trimmedContent(): string {
    return this.content.trim()
  }

  private get isValid(): boolean {
    return this.trimmedContent.length >= this.minLength
  }

  private get charCountClass(): string {
    const length = this.content.length
    if (length >= this.maxLength) return 'error'
    if (length >= Math.floor(this.maxLength * 0.9)) return 'warning'
    return ''
  }

  private emitClose(reason: MnFeedbackCloseDetail['reason']): void {
    const detail: MnFeedbackCloseDetail = { reason }
    this.dispatchEvent(new CustomEvent<MnFeedbackCloseDetail>('mn-close', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnFeedbackCloseDetail>('mn-feedback-close', { detail, bubbles: true, composed: true }))
  }

  private resetForm(): void {
    this.content = ''
    this.feedbackType = 'general'
    this.rating = null
    this.hoveredRating = null
  }

  private selectType(type: MnFeedbackType): void {
    this.feedbackType = type
  }

  private changeContent(event: Event): void {
    this.content = clampContent((event.target as HTMLTextAreaElement).value, this.maxLength)
  }

  private toggleRating(value: number): void {
    this.rating = this.rating === value ? null : value
  }

  private submit(): void {
    if (!this.isValid || this.submitting) return
    const detail: MnFeedbackSubmitDetail = {
      content: this.trimmedContent,
      feedbackType: this.feedbackType,
      rating: this.rating,
    }
    this.dispatchEvent(new CustomEvent<MnFeedbackSubmitDetail>('mn-submit', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnFeedbackSubmitDetail>('mn-feedback-submit', { detail, bubbles: true, composed: true }))
  }

  private cancel(reason: MnFeedbackCloseDetail['reason'] = 'cancel', event?: Event): void {
    event?.stopPropagation()
    this.resetForm()
    this.emitClose(reason)
  }

  private renderTypeChip(option: FeedbackTypeOption): TemplateResult {
    return html`
      <button
        type="button"
        class=${`type-chip ${this.feedbackType === option.type ? 'selected' : ''}`}
        @click=${() => this.selectType(option.type)}
      >
        ${icon(option.icon, { size: 14 })}
        ${option.label}
      </button>
    `
  }

  private renderStar(value: number): TemplateResult {
    const active = this.rating !== null && value <= this.rating
    const hovered = this.hoveredRating !== null && value <= this.hoveredRating
    return html`
      <button
        type="button"
        class=${`star ${active ? 'filled' : ''} ${hovered ? 'hovered' : ''}`}
        aria-label=${`Rate ${value} out of 5`}
        @click=${() => this.toggleRating(value)}
        @mouseenter=${() => {
          this.hoveredRating = value
        }}
        @mouseleave=${() => {
          this.hoveredRating = null
        }}
      >
        ${icon('star', { size: 24 })}
      </button>
    `
  }

  override render(): TemplateResult {
    return html`
      <mn-modal
        ?open=${this.open}
        size="md"
        style="position:var(--mn-feedback-form-modal-position,fixed);inset:var(--mn-feedback-form-modal-inset,0);z-index:var(--mn-feedback-form-modal-z-index,var(--mn-z-modal,1400));"
        @mn-close=${(event: Event) => this.cancel('modal', event)}
      >
        <span slot="header">Send Feedback</span>

        <div class="form">
          <div class="field">
            <label class="field-label">What type of feedback?</label>
            <div class="type-chips">
              ${TYPE_OPTIONS.map(option => this.renderTypeChip(option))}
            </div>
          </div>

          <div class="field">
            <label class="field-label">Your feedback</label>
            <textarea
              class="textarea"
              placeholder=${`Tell us what you think... (minimum ${this.minLength} characters)`}
              .value=${this.content}
              maxlength=${this.maxLength}
              ?disabled=${this.submitting}
              @input=${this.changeContent}
            ></textarea>
            <div class=${`char-count ${this.charCountClass}`}>${this.content.length} / ${this.maxLength}</div>
          </div>

          <div class="field">
            <label class="field-label">Rate your experience <span class="optional">(optional)</span></label>
            <div class="rating">
              ${[1, 2, 3, 4, 5].map(value => this.renderStar(value))}
            </div>
          </div>
        </div>

        <div slot="footer" class="footer-buttons">
          <mn-button
            variant="secondary"
            label="Cancel"
            ?disabled=${this.submitting}
            @click=${(event: Event) => this.cancel('cancel', event)}
          ></mn-button>
          <mn-button
            variant="primary"
            label=${this.submitting ? 'Submitting...' : 'Send Feedback'}
            ?disabled=${!this.isValid || this.submitting}
            @click=${this.submit}
          ></mn-button>
        </div>
      </mn-modal>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-feedback-form': MnFeedbackForm
  }
}
