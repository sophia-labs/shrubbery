/**
 * mn-comment-popover - Garden's floating comment preview/editor, made controlled.
 *
 * Garden's popover was fed by documentStore comment data. Shrubbery keeps this
 * component as overlay chrome: comment data arrives as props, local editing and
 * dragging stay transient, and save/resolve/delete/move/close leave as events.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnCommentPopoverMode = 'peek' | 'pinned'

export interface MnCommentPopoverComment {
  readonly id: string
  readonly author?: string | null
  readonly text?: string | null
  readonly createdAt?: number | Date | null
  readonly updatedAt?: number | Date | null
  readonly resolved?: boolean
}

export interface MnCommentPopoverDetail {
  readonly commentId: string
  readonly comment: MnCommentPopoverComment | null
}

export interface MnCommentPopoverSaveDetail extends MnCommentPopoverDetail {
  readonly text: string
}

export interface MnCommentPopoverMoveDetail extends MnCommentPopoverDetail {
  readonly x: number
  readonly y: number
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function timestamp(value: number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  return typeof value === 'number' ? value : Date.now()
}

function formatDate(value: number | Date | null | undefined): string {
  const date = new Date(timestamp(value))
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

@customElement('mn-comment-popover')
export class MnCommentPopover extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    :host([mode='peek']) {
      pointer-events: none;
    }

    .popover {
      position: var(--mn-comment-popover-position, fixed);
      width: min(320px, calc(100vw - var(--mn-space-6, 24px)));
      min-width: 220px;
      max-width: 320px;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(15, 23, 42, 0.18));
      box-sizing: border-box;
    }

    .popover.peek {
      opacity: 0.96;
      pointer-events: none;
    }

    .popover.pinned {
      border-color: var(--mn-color-border-accent, #93c5fd);
      box-shadow:
        var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.2)),
        0 0 0 2px var(--mn-color-border-accent, #93c5fd);
      pointer-events: auto;
    }

    :host([mobile]) .popover {
      inset: auto 0 0 0;
      width: 100%;
      max-width: none;
      border-right: 0;
      border-bottom: 0;
      border-left: 0;
      border-radius: var(--mn-radius-lg, 8px) var(--mn-radius-lg, 8px) 0 0;
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
    }

    .popover.pinned .header {
      cursor: grab;
    }

    :host([mobile]) .popover.pinned .header {
      cursor: default;
    }

    .identity {
      min-width: 0;
    }

    .author {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .time {
      margin-top: 2px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .close {
      display: inline-flex;
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .close:hover,
    .close:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .quote {
      display: -webkit-box;
      max-height: 44px;
      overflow: hidden;
      margin-bottom: var(--mn-space-2, 8px);
      padding-left: var(--mn-space-2, 8px);
      border-left: 2px solid var(--mn-color-border-accent, #93c5fd);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
      line-height: 1.45;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .comment-text {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .comment-text.editable {
      margin: calc(-1 * var(--mn-space-2, 8px));
      padding: var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-sm, 4px);
      cursor: text;
    }

    .comment-text.editable:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .comment-text.placeholder {
      color: var(--mn-color-text-muted, #6b7280);
      font-style: italic;
    }

    .textarea {
      width: 100%;
      min-height: 72px;
      padding: var(--mn-space-2, 8px);
      border: 2px solid var(--mn-color-border-accent, #93c5fd);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-family: var(--mn-font-serif, Georgia, serif);
      line-height: 1.5;
      resize: vertical;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(37, 99, 235, 0.2));
      box-sizing: border-box;
    }

    .textarea:focus {
      border-color: var(--mn-color-border-focus, #2563eb);
      outline: none;
    }

    .hint,
    .resolved {
      margin-top: var(--mn-space-1, 4px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .resolved {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      color: var(--mn-color-text-success, #166534);
    }

    .actions {
      display: flex;
      gap: var(--mn-space-2, 8px);
      margin-top: var(--mn-space-3, 12px);
      padding-top: var(--mn-space-2, 8px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      flex-wrap: wrap;
    }

    .action {
      display: inline-flex;
      min-height: 28px;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    .action:hover,
    .action:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .action.resolve:hover {
      border-color: var(--mn-color-success-border, #86efac);
      background: var(--mn-color-success-surface, #f0fdf4);
      color: var(--mn-color-text-success, #166534);
    }

    .action.delete:hover {
      border-color: var(--mn-color-danger-border, #fecaca);
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger, #b91c1c);
    }
  `

  @property({ type: String, attribute: 'comment-id' }) commentId = ''
  @property({ attribute: false }) comment: MnCommentPopoverComment | null = null
  @property({ type: String, attribute: 'quoted-text' }) quotedText = ''
  @property({ type: String, reflect: true }) mode: MnCommentPopoverMode = 'peek'
  @property({ type: Number }) x = 0
  @property({ type: Number }) y = 0
  @property({ type: Number }) zIndex = 900
  @property({ type: Boolean, reflect: true }) mobile = false
  @property({ type: Boolean }) editable = false
  @property({ type: Boolean, reflect: true, attribute: 'resolved' }) commentResolved = false
  @property({ type: Boolean, attribute: 'start-editing' }) startEditing = false

  @state() private isEditing = false
  @state() private editText = ''
  @state() private hasUserInteracted = false
  @state() private isDragging = false

  @query('.textarea') private textarea?: HTMLTextAreaElement

  private dragStartX = 0
  private dragStartY = 0
  private initialX = 0
  private initialY = 0

  private readonly onDragMove = (event: MouseEvent): void => this.handleDragMove(event)
  private readonly onDragEnd = (): void => this.handleDragEnd()

  override connectedCallback(): void {
    super.connectedCallback()
    if (this.startEditing && this.editable) this.beginEditing()
  }

  override disconnectedCallback(): void {
    document.removeEventListener('mousemove', this.onDragMove)
    document.removeEventListener('mouseup', this.onDragEnd)
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('startEditing') && this.startEditing && this.editable) {
      this.beginEditing()
    }
  }

  private get activeCommentId(): string {
    return trimmed(this.commentId) || trimmed(this.comment?.id)
  }

  private detail(): MnCommentPopoverDetail {
    return { commentId: this.activeCommentId, comment: this.comment }
  }

  private get isResolved(): boolean {
    return this.commentResolved || this.comment?.resolved === true
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private beginEditing(): void {
    if (!this.editable) return
    this.editText = this.comment?.text ?? ''
    this.isEditing = true
    this.hasUserInteracted = false
    void this.updateComplete.then(() => this.textarea?.focus())
  }

  private save(): void {
    const text = trimmed(this.editText)
    const current = this.comment?.text ?? ''
    if (!current && !text && !this.hasUserInteracted) {
      void this.updateComplete.then(() => this.textarea?.focus())
      return
    }
    if (text !== current) {
      this.emit<MnCommentPopoverSaveDetail>('mn-save', { ...this.detail(), text })
      this.emit<MnCommentPopoverSaveDetail>('mn-comment-popover-save', { ...this.detail(), text })
    }
    this.isEditing = false
    this.hasUserInteracted = false
  }

  private cancel(): void {
    this.editText = this.comment?.text ?? ''
    this.isEditing = false
    this.hasUserInteracted = false
  }

  private close(event?: Event): void {
    event?.stopPropagation()
    this.emit<MnCommentPopoverDetail>('mn-close', this.detail())
    this.emit<MnCommentPopoverDetail>('mn-comment-popover-close', this.detail())
  }

  private resolve(event: Event): void {
    event.stopPropagation()
    this.emit<MnCommentPopoverDetail>('mn-resolve', this.detail())
    this.emit<MnCommentPopoverDetail>('mn-comment-popover-resolve', this.detail())
  }

  private delete(event: Event): void {
    event.stopPropagation()
    this.emit<MnCommentPopoverDetail>('mn-delete', this.detail())
    this.emit<MnCommentPopoverDetail>('mn-comment-popover-delete', this.detail())
  }

  private focusSelf(): void {
    this.emit<MnCommentPopoverDetail>('mn-focus', this.detail())
    this.emit<MnCommentPopoverDetail>('mn-comment-popover-focus', this.detail())
  }

  private startDrag(event: MouseEvent): void {
    if (this.mode !== 'pinned' || this.mobile) return
    event.preventDefault()
    this.isDragging = true
    this.dragStartX = event.clientX
    this.dragStartY = event.clientY
    this.initialX = this.x
    this.initialY = this.y
    document.addEventListener('mousemove', this.onDragMove)
    document.addEventListener('mouseup', this.onDragEnd)
  }

  private handleDragMove(event: MouseEvent): void {
    if (!this.isDragging) return
    const maxX = Math.max(10, window.innerWidth - 220)
    const maxY = Math.max(10, window.innerHeight - 100)
    const x = Math.max(10, Math.min(maxX, this.initialX + event.clientX - this.dragStartX))
    const y = Math.max(10, Math.min(maxY, this.initialY + event.clientY - this.dragStartY))
    this.emit<MnCommentPopoverMoveDetail>('mn-move', { ...this.detail(), x, y })
    this.emit<MnCommentPopoverMoveDetail>('mn-comment-popover-move', { ...this.detail(), x, y })
  }

  private handleDragEnd(): void {
    if (!this.isDragging) return
    this.isDragging = false
    document.removeEventListener('mousemove', this.onDragMove)
    document.removeEventListener('mouseup', this.onDragEnd)
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      this.save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    }
  }

  private positionStyle(): string {
    if (this.mobile) return `z-index: var(--mn-z-overlay, ${this.zIndex});`
    const maxX = Math.max(10, window.innerWidth - 340)
    const maxY = Math.max(10, window.innerHeight - 200)
    const x = Math.max(10, Math.min(this.x, maxX))
    const y = Math.max(10, Math.min(this.y, maxY))
    return `left:${x}px;top:${y}px;z-index:${this.zIndex};`
  }

  private renderHeader(): TemplateResult {
    const author = trimmed(this.comment?.author) || 'Anonymous'
    return html`
      <div class="header" @mousedown=${this.startDrag}>
        <div class="identity">
          <div class="author">${author}</div>
          <div class="time">${formatDate(this.comment?.createdAt)}</div>
        </div>
        ${this.mode === 'pinned'
          ? html`
              <button type="button" class="close" aria-label="Close comment" @click=${this.close} @mousedown=${(event: Event) => event.stopPropagation()}>
                ${icon('x', { size: 14 })}
              </button>
            `
          : nothing}
      </div>
    `
  }

  private renderBody(): TemplateResult {
    if (this.isEditing) {
      return html`
        <textarea
          class="textarea"
          .value=${this.editText}
          placeholder="Add your comment..."
          @input=${(event: Event) => {
            this.editText = (event.target as HTMLTextAreaElement).value
            this.hasUserInteracted = true
          }}
          @keydown=${this.handleKeydown}
          @blur=${this.save}
        ></textarea>
        <div class="hint">Cmd/Ctrl+Enter to save, Esc to cancel</div>
      `
    }
    const text = this.comment?.text ?? ''
    const paragraphClass = `comment-text ${this.editable ? 'editable' : ''} ${text ? '' : 'placeholder'}`
    if (this.isResolved) {
      return html`
        <p class=${paragraphClass} @click=${() => this.beginEditing()}>
          ${text || 'Add a comment...'}
        </p>
        <div class="resolved" aria-label="Resolved">${icon('check', { size: 13 })}<span>Resolved</span></div>
      `
    }
    return html`
      <p class=${paragraphClass} @click=${() => this.beginEditing()}>
        ${text || 'Add a comment...'}
      </p>
    `
  }

  private renderActions(): TemplateResult | typeof nothing {
    if (this.mode !== 'pinned' || !this.editable || this.isEditing) return nothing
    if (this.isResolved) {
      return html`
        <div class="actions">
          <button type="button" class="action delete" @click=${this.delete}>${icon('trash', { size: 13 })}Delete</button>
        </div>
      `
    }
    return html`
      <div class="actions">
        <button type="button" class="action resolve" @click=${this.resolve}>${icon('check', { size: 13 })}Resolve</button>
        <button type="button" class="action delete" @click=${this.delete}>${icon('trash', { size: 13 })}Delete</button>
      </div>
    `
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.comment) return nothing
    return html`
      <div
        class=${`popover ${this.mode}`}
        style=${this.positionStyle()}
        data-comment-popover
        data-comment-id=${this.activeCommentId}
        @click=${this.mode === 'pinned' ? this.focusSelf : nothing}
      >
        ${this.renderHeader()}
        ${trimmed(this.quotedText) ? html`<div class="quote">${this.quotedText}</div>` : nothing}
        ${this.renderBody()}
        ${this.renderActions()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-comment-popover': MnCommentPopover
  }
}
