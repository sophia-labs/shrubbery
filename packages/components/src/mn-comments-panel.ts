/**
 * mn-comments-panel — Garden's comments sidebar, made controlled.
 *
 * Garden's original panel subscribed directly to documentStore/Y.Map and mutated
 * comment data itself. This Shrubbery lift keeps the UI surface and interaction
 * model, but all data and writes are host-owned: comments are props, and select /
 * hover / edit / resolve / delete leave as composed intents.
 */

import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnComment {
  readonly id: string
  readonly author: string
  readonly text: string
  readonly quotedText?: string | null
  readonly createdAt: number | Date
  readonly updatedAt?: number | Date | null
  readonly resolved?: boolean
  readonly documentPosition?: number | null
  readonly blockId?: string | null
  /** A highlight (made over an original in the Reader) has a quote and a colour but no words of its own. */
  readonly kind?: 'comment' | 'highlight' | null
  /** The highlighter's colour name: yellow, green, blue or pink. */
  readonly color?: string | null
  /** Where it sits in the original, as a reader says it: "p. 12", a chapter's title. */
  readonly location?: string | null
  /** Its place in reading order (when the host knows it): the list follows the book, as Kindle's does. */
  readonly order?: number | null
}

/** Ask to see a comment in the other view of an imported document (its original, or the text made from it). */
export interface MnCommentCrossDetail extends MnCommentDetail {
  readonly to: 'original' | 'text'
}

export interface MnCommentDetail {
  readonly id: string
  readonly comment: MnComment
}

export interface MnCommentHoverDetail {
  readonly id: string | null
  readonly comment: MnComment | null
}

export interface MnCommentEditDetail extends MnCommentDetail {
  readonly text: string
}

export interface MnCommentResolveDetail extends MnCommentDetail {
  readonly resolved: boolean
}

function commentTimestamp(value: number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  return typeof value === 'number' ? value : 0
}

function formatDate(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('Just now')
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(localeSource.get())
}

function osShortcutLabel(): string {
  const platform =
    globalThis.navigator?.platform ??
    globalThis.navigator?.userAgent ??
    ''
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd' : 'Ctrl'
}

@customElement('mn-comments-panel')
export class MnCommentsPanel extends SkinAware(LitElement) {
  protected readonly _locale = new LocaleController(this)

  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-panel-bg, var(--mn-color-surface-base, #fff));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      min-height: var(--mn-y-slice-1-height, 44px);
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: var(--mn-panel-header-rule, 1px solid var(--mn-color-border-subtle, #e5e7eb));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .header-left {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
    }

    .header-title {
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      font-weight: var(--mn-font-weight-semibold, 650);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .header-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 20px;
      padding: 0 7px;
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #9a3412);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      box-sizing: border-box;
    }

    .comments-container {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-4, 16px);
    }

    .comments-list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .comment-card {
      display: block;
      width: 100%;
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-base, #fff));
      color: inherit;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    .comment-card:hover,
    .comment-card.hovered {
      border-color: var(--mn-color-warning-border, #f59e0b);
      background: var(--mn-color-warning-surface, #fff7ed);
      box-shadow: var(--mn-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08));
    }

    .comment-card.resolved {
      opacity: 0.62;
    }

    .comment-card[data-color='yellow'] { --mn-comment-stripe: rgb(234, 179, 8); }
    .comment-card[data-color='green'] { --mn-comment-stripe: rgb(34, 160, 90); }
    .comment-card[data-color='blue'] { --mn-comment-stripe: rgb(59, 130, 246); }
    .comment-card[data-color='pink'] { --mn-comment-stripe: rgb(219, 39, 119); }
    .comment-card[data-color] .comment-quoted-text {
      border-left: 3px solid var(--mn-comment-stripe);
      background: color-mix(in srgb, var(--mn-comment-stripe) 12%, var(--mn-color-surface-base, #fff));
    }
    .comment-card[data-kind='highlight'] .comment-quoted-text {
      font-style: normal;
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-primary, #1f2937);
      margin-bottom: var(--mn-space-1-5, 6px);
    }
    /* Where the passage is (a chapter, a page), on its own line under the quote, as Kindle lists highlights. */
    .comment-location {
      margin: calc(-1 * var(--mn-space-1, 4px)) 0 var(--mn-space-1-5, 6px);
      color: var(--mn-color-text-tertiary, #8a9099);
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .comment-kind {
      color: var(--mn-color-text-tertiary, #8a9099);
      font-size: var(--mn-text-xs, 12px);
    }
    .comment-cross {
      margin-left: auto;
    }

    .comment-quoted-text {
      margin-bottom: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px);
      border-left: 2px solid var(--mn-color-warning-border, #f59e0b);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
      line-height: 1.45;
    }

    .comment-card-header {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
    }

    .comment-author {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .comment-date {
      margin-left: auto;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .comment-text {
      margin: calc(-1 * var(--mn-space-2, 8px));
      padding: var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-sm, 4px);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
      cursor: text;
    }

    .comment-text:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .comment-text.placeholder {
      color: var(--mn-color-text-muted, #6b7280);
      font-style: italic;
    }

    .comment-edit-textarea {
      width: 100%;
      min-height: 64px;
      padding: var(--mn-space-2, 8px);
      border: 2px solid var(--mn-color-warning-border, #f59e0b);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-family: var(--mn-font-serif, Georgia, serif);
      line-height: 1.5;
      resize: vertical;
      box-sizing: border-box;
    }

    .comment-edit-textarea:focus {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: 1px;
    }

    .comment-edit-hint {
      margin-top: var(--mn-space-1, 4px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .comment-actions {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      margin-top: var(--mn-space-3, 12px);
      padding-top: var(--mn-space-2, 8px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .comment-action-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      min-height: 26px;
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    .comment-action-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .comment-action-btn.resolve:hover {
      background: var(--mn-color-success-surface, #ecfdf5);
      color: var(--mn-color-success-strong, #047857);
    }

    .comment-action-btn.delete {
      margin-left: auto;
    }

    .comment-action-btn.delete:hover {
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger-strong, #b91c1c);
    }

    .empty-state {
      display: grid;
      flex: 1 1 auto;
      justify-items: center;
      align-content: center;
      min-height: 240px;
      padding: var(--mn-space-8, 32px);
      box-sizing: border-box;
      color: var(--mn-color-text-muted, #6b7280);
      text-align: center;
    }

    .empty-state-icon {
      display: inline-flex;
      margin-bottom: var(--mn-space-3, 12px);
      opacity: 0.38;
    }

    .empty-state-title {
      margin-bottom: var(--mn-space-1, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
    }

    .empty-state-description {
      max-width: 220px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.5;
    }
  `

  @property({ attribute: false }) comments: readonly MnComment[] = []
  @property({ type: String }) hoveredCommentId: string | null = null
  @property({ type: String }) emptyShortcut: string | null = null
  /**
   * An imported document has two views: each comment offers to show itself in the other one ('original' while the
   * text is showing, 'text' while the original is). Null: no such offer.
   */
  @property({ type: String, attribute: 'cross-view' }) crossView: 'original' | 'text' | null = null

  @state() private inlineEditingId: string | null = null
  @state() private inlineEditContent = ''

  private orderedComments(): MnComment[] {
    return [...this.comments].sort((a, b) => {
      // Reading order first, when the host knows it (an original's pages and chapters), as Kindle lists them.
      const orderA = a.order ?? Number.POSITIVE_INFINITY
      const orderB = b.order ?? Number.POSITIVE_INFINITY
      if (orderA !== orderB) return orderA - orderB
      const posA = a.documentPosition ?? Number.POSITIVE_INFINITY
      const posB = b.documentPosition ?? Number.POSITIVE_INFINITY
      if (posA !== posB) return posA - posB
      return commentTimestamp(a.createdAt) - commentTimestamp(b.createdAt)
    })
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private selectComment(comment: MnComment, event: Event): void {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('textarea,button,.comment-text')) return
    this.emit<MnCommentDetail>('mn-comment-select', { id: comment.id, comment })
  }

  private hoverComment(comment: MnComment | null): void {
    this.emit<MnCommentHoverDetail>('mn-comment-hover', {
      id: comment?.id ?? null,
      comment,
    })
  }

  private startInlineEdit(comment: MnComment, event?: Event): void {
    event?.stopPropagation()
    this.inlineEditingId = comment.id
    this.inlineEditContent = comment.text
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector<HTMLTextAreaElement>(`textarea[data-edit-id="${comment.id}"]`)
        ?.focus()
    })
  }

  private saveInlineEdit(): void {
    const comment = this.comments.find((item) => item.id === this.inlineEditingId)
    if (!comment) return
    this.emit<MnCommentEditDetail>('mn-comment-edit', {
      id: comment.id,
      comment,
      text: this.inlineEditContent.trim(),
    })
    this.inlineEditingId = null
    this.inlineEditContent = ''
  }

  private cancelInlineEdit(): void {
    this.inlineEditingId = null
    this.inlineEditContent = ''
  }

  private handleInlineEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      this.saveInlineEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.cancelInlineEdit()
    }
  }

  private resolveComment(comment: MnComment, event: Event): void {
    event.stopPropagation()
    this.emit<MnCommentResolveDetail>('mn-comment-resolve', {
      id: comment.id,
      comment,
      resolved: !comment.resolved,
    })
  }

  private deleteComment(comment: MnComment, event: Event): void {
    event.stopPropagation()
    this.emit<MnCommentDetail>('mn-comment-delete', { id: comment.id, comment })
  }

  private renderEmpty(): TemplateResult {
    const shortcut = this.emptyShortcut ?? `${osShortcutLabel()}+Shift+.`
    return html`
      <div class="empty-state">
        <div class="empty-state-icon">${icon('message-square', { size: 48 })}</div>
        <div class="empty-state-title">${t('No comments yet')}</div>
        <div class="empty-state-description">
          Select text or a block, then press ${shortcut} to comment.
        </div>
      </div>
    `
  }

  private crossComment(comment: MnComment, event: Event): void {
    event.stopPropagation()
    if (!this.crossView) return
    this.emit<MnCommentCrossDetail>('mn-comment-cross', { id: comment.id, comment, to: this.crossView })
  }

  private renderComment(comment: MnComment): TemplateResult {
    const editing = this.inlineEditingId === comment.id
    const resolved = comment.resolved === true
    const highlight = comment.kind === 'highlight'
    const classes = {
      'comment-card': true,
      hovered: this.hoveredCommentId === comment.id,
      resolved,
    }
    return html`
      <li>
        <article
          class=${classMap(classes)}
          data-comment-id=${comment.id}
          data-kind=${highlight ? 'highlight' : 'comment'}
          data-color=${comment.color || nothing}
          data-private="true"
          @click=${(event: Event) => this.selectComment(comment, event)}
          @mouseenter=${() => this.hoverComment(comment)}
          @mouseleave=${() => this.hoverComment(null)}
        >
          <div class="comment-quoted-text">${comment.quotedText || t('Selected text...')}</div>
          ${comment.location ? html`<div class="comment-location" title=${comment.location}>${comment.location}</div>` : nothing}
          <div class="comment-card-header">
            ${highlight ? html`<span class="comment-kind">${t('Highlight')}</span>` : html`<span class="comment-author">${comment.author}</span>`}
            <span class="comment-date">${formatDate(comment.createdAt)}</span>
          </div>
          ${editing
            ? html`
                <textarea
                  class="comment-edit-textarea"
                  data-edit-id=${comment.id}
                  .value=${this.inlineEditContent}
                  @input=${(event: Event) => {
                    this.inlineEditContent = (event.target as HTMLTextAreaElement).value
                  }}
                  @keydown=${(event: KeyboardEvent) => this.handleInlineEditKeydown(event)}
                  @blur=${() => this.saveInlineEdit()}
                  @click=${(event: Event) => event.stopPropagation()}
                  placeholder=${t('Add your comment...')}
                ></textarea>
                <div class="comment-edit-hint">${osShortcutLabel()}+Enter to save, Escape to cancel</div>
              `
            : html`
                <div
                  class="comment-text ${comment.text ? '' : 'placeholder'}"
                  @click=${(event: Event) => this.startInlineEdit(comment, event)}
                >
                  ${comment.text || (highlight ? t('Add a note…') : '(Click to add comment...)')}
                </div>
              `}
          ${editing
            ? nothing
            : html`
                <div class="comment-actions">
                  ${this.crossView ? html`<button
                    type="button"
                    class="comment-action-btn comment-cross"
                    title=${this.crossView === 'original' ? t('Show it in the original') : t('Show it in the text')}
                    @click=${(event: Event) => this.crossComment(comment, event)}
                  >${this.crossView === 'original' ? t('Show in original') : t('Show in text')}</button>` : nothing}
                  <button
                    type="button"
                    class="comment-action-btn resolve"
                    title=${resolved ? 'Reopen' : 'Resolve'}
                    @click=${(event: Event) => this.resolveComment(comment, event)}
                  >
                    ${icon(resolved ? 'undo' : 'check', { size: 12 })}
                    ${resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button
                    type="button"
                    class="comment-action-btn delete"
                    title=${t('Delete comment')}
                    aria-label=${`Delete comment ${comment.id}`}
                    @click=${(event: Event) => this.deleteComment(comment, event)}
                  >
                    ${icon('trash', { size: 12 })}
                  </button>
                </div>
              `}
        </article>
      </li>
    `
  }

  override render(): TemplateResult {
    const ordered = this.orderedComments()
    const unresolvedCount = ordered.filter((comment) => !comment.resolved).length
    const body =
      ordered.length === 0
        ? this.renderEmpty()
        : html`<ol class="comments-list">
            ${repeat(ordered, (comment) => comment.id, (comment) => this.renderComment(comment))}
          </ol>`
    return html`
      <header class="header">
        <div class="header-left">
          <span class="header-title">${ordered.some(comment => comment.kind === 'highlight') ? t('Notes & Highlights') : t('Comments')}</span>
          ${unresolvedCount > 0 ? html`<span class="header-count">${unresolvedCount}</span>` : nothing}
        </div>
      </header>
      <main class="comments-container">
        ${body}
      </main>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-comments-panel': MnCommentsPanel
  }
}
