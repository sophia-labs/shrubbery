/**
 * mn-zotero-source-workbench - controlled Zotero source workbench.
 *
 * Garden's original source workbench resolved Zotero items, loaded incoming
 * wires, read annotations, materialized sources, queued daily-note promotions,
 * and navigated through global window/session/filesystem stores. Shrubbery keeps
 * the main-pane source surface only: callers provide the resolved source,
 * annotations, incoming wires, loading/error/promoted state, then handle tag,
 * document, Zotero-open, reload, and promotion intents outside this component.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnZoteroSourceItem {
  readonly key?: string | null
  readonly title?: string | null
  readonly label?: string | null
  readonly itemType?: string | null
  readonly creatorSummary?: string | null
  readonly year?: string | null
  readonly abstractNote?: string | null
  readonly tags?: readonly string[]
}

export interface MnZoteroSourceIncomingWire {
  readonly id: string
  readonly predicateLabel?: string | null
  readonly otherDocumentId?: string | null
  readonly otherBlockId?: string | null
  readonly otherTitle?: string | null
  readonly otherSnippet?: string | null
}

export interface MnZoteroSourceAnnotation {
  readonly key: string
  readonly kind: string
  readonly text?: string | null
  readonly comment?: string | null
  readonly color?: string | null
  readonly page?: string | null
}

export interface MnZoteroSourceBaseDetail {
  readonly artifactId: string
  readonly zoteroKey: string
  readonly graphId: string | null
}

export interface MnZoteroSourceOpenZoteroDetail extends MnZoteroSourceBaseDetail {
  readonly url: string
}

export interface MnZoteroSourceOpenTagDetail extends MnZoteroSourceBaseDetail {
  readonly tag: string
  readonly normalizedTag: string
}

export interface MnZoteroSourceOpenDocumentDetail extends MnZoteroSourceBaseDetail {
  readonly documentId: string
  readonly wire: MnZoteroSourceIncomingWire
}

export interface MnZoteroSourcePromoteAnnotationDetail extends MnZoteroSourceBaseDetail {
  readonly annotation: MnZoteroSourceAnnotation
  readonly annotationKey: string
  readonly citation: string
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function asKeySet(value: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value)
}

function yearOf(item: MnZoteroSourceItem | null): string {
  return clean(item?.year).slice(0, 4)
}

@customElement('mn-zotero-source-workbench')
export class MnZoteroSourceWorkbench extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: auto;
      padding: var(--mn-space-7, 28px) var(--mn-space-8, 32px);
      color: var(--mn-color-text-primary, #1f2937);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      box-sizing: border-box;
    }

    .wrap {
      display: grid;
      max-width: 860px;
      min-width: 0;
      margin: 0 auto;
      grid-template-columns: minmax(0, 1fr) 240px;
      gap: 28px;
    }

    header {
      min-width: 0;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--mn-color-border-default, #e5e7eb);
      grid-column: 1 / -1;
    }

    .kicker,
    section h2,
    .rail .label {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    h1 {
      margin: 6px 0 8px;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-2xl, 22px);
      font-weight: 650;
      line-height: 1.3;
    }

    .byline {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-sm, 14px);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    button,
    .btn {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 12px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-decoration: none;
      box-sizing: border-box;
    }

    button:hover:not(:disabled),
    button:focus-visible:not(:disabled),
    .btn:hover,
    .btn:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    button:disabled {
      cursor: default;
      opacity: 0.56;
    }

    section {
      min-width: 0;
    }

    section h2 {
      margin: 0 0 10px;
    }

    .incoming,
    .annotation {
      min-width: 0;
      margin-bottom: 8px;
      border: 1px solid var(--mn-color-border-subtle, #eef2f7);
      border-radius: var(--mn-radius-xl, 10px);
      background: var(--mn-color-surface-base, #fff);
      box-sizing: border-box;
    }

    .incoming {
      display: block;
      width: 100%;
      padding: 10px 12px;
      text-align: left;
    }

    .incoming .rel {
      color: var(--mn-color-accent-700, #5b3fd6);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .incoming .snip {
      margin-top: 3px;
      color: var(--mn-color-text-primary, #1f2937);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
    }

    .annotation {
      padding: 10px 12px;
      border-left-width: 3px;
    }

    .quote {
      color: var(--mn-color-text-primary, #1f2937);
      font-size: var(--mn-text-sm, 14px);
      line-height: 1.5;
    }

    .note {
      margin-top: 5px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
      line-height: 1.45;
    }

    .annotation-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
    }

    .annotation-meta .kind {
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .promote,
    .promoted {
      margin-left: auto;
    }

    .promote {
      min-height: 24px;
      padding: 0 8px;
      border: 0;
      background: transparent;
      color: var(--mn-color-accent-700, #5b3fd6);
    }

    .promoted {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .empty,
    .state {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
      line-height: 1.45;
    }

    .state.error {
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .rail {
      min-width: 0;
      color: var(--mn-color-text-primary, #1f2937);
      font-size: var(--mn-text-sm, 13px);
    }

    .rail .label {
      margin: 14px 0 4px;
    }

    .rail .label:first-child {
      margin-top: 0;
    }

    .abstract {
      color: var(--mn-color-text-primary, #1f2937);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .tag {
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--mn-color-surface-subtle, #f3f4f6);
      font-size: var(--mn-text-xs, 12px);
    }

    .muted {
      color: var(--mn-color-text-muted, #6b7280);
    }

    @media (max-width: 760px) {
      :host {
        padding: var(--mn-space-5, 20px);
      }

      .wrap {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `

  @property({ type: String }) artifactId = ''
  @property({ type: String }) zoteroKey = ''
  @property({ type: String }) graphId = ''
  @property({ type: Boolean }) loading = false
  @property({ type: String }) error = ''
  @property({ attribute: false }) item: MnZoteroSourceItem | null = null
  @property({ attribute: false }) annotations: readonly MnZoteroSourceAnnotation[] = []
  @property({ attribute: false }) incomingWires: readonly MnZoteroSourceIncomingWire[] = []
  @property({ attribute: false }) promotedAnnotationKeys: ReadonlySet<string> | readonly string[] = []

  private resolvedKey(): string {
    return clean(this.zoteroKey) || clean(this.item?.key) || clean(this.artifactId).replace(/^zot-/, '')
  }

  private resolvedArtifactId(): string {
    const artifactId = clean(this.artifactId)
    if (artifactId) return artifactId
    const key = this.resolvedKey()
    return key ? `zot-${key}` : ''
  }

  private zoteroUrl(): string {
    const key = this.resolvedKey()
    return key ? `zotero://select/library/items/${encodeURIComponent(key)}` : '#'
  }

  private citation(): string {
    const key = this.resolvedKey()
    const creator = clean(this.item?.creatorSummary)
    const year = yearOf(this.item)
    return [creator, year ? `(${year})` : ''].filter(Boolean).join(' ') ||
      clean(this.item?.title) ||
      clean(this.item?.label) ||
      key
  }

  private byline(): string {
    return [clean(this.item?.creatorSummary), yearOf(this.item)].filter(Boolean).join(' - ')
  }

  private tags(): readonly string[] {
    const seen = new Set<string>()
    const tags: string[] = []
    for (const tag of this.item?.tags ?? []) {
      const value = clean(tag)
      const normalized = value.toLowerCase()
      if (!value || seen.has(normalized)) continue
      seen.add(normalized)
      tags.push(value)
    }
    return tags
  }

  private baseDetail(): MnZoteroSourceBaseDetail {
    return {
      artifactId: this.resolvedArtifactId(),
      zoteroKey: this.resolvedKey(),
      graphId: clean(this.graphId) || null,
    }
  }

  private emit<T extends object>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private openZotero(event: Event): void {
    const key = this.resolvedKey()
    if (!key) {
      event.preventDefault()
      return
    }
    this.emit<MnZoteroSourceOpenZoteroDetail>('mn-zotero-source-open-zotero', {
      ...this.baseDetail(),
      url: this.zoteroUrl(),
    })
  }

  private reload(): void {
    this.emit<MnZoteroSourceBaseDetail>('mn-zotero-source-reload', this.baseDetail())
  }

  private openTag(tag: string): void {
    const normalizedTag = clean(tag).toLowerCase()
    if (!normalizedTag) return
    this.emit<MnZoteroSourceOpenTagDetail>('mn-zotero-source-open-tag', {
      ...this.baseDetail(),
      tag,
      normalizedTag,
    })
  }

  private openDocument(wire: MnZoteroSourceIncomingWire): void {
    const documentId = clean(wire.otherDocumentId)
    if (!documentId) return
    this.emit<MnZoteroSourceOpenDocumentDetail>('mn-zotero-source-open-document', {
      ...this.baseDetail(),
      documentId,
      wire,
    })
  }

  private promote(annotation: MnZoteroSourceAnnotation): void {
    if (asKeySet(this.promotedAnnotationKeys).has(annotation.key)) return
    this.emit<MnZoteroSourcePromoteAnnotationDetail>('mn-zotero-source-promote-annotation', {
      ...this.baseDetail(),
      annotation,
      annotationKey: annotation.key,
      citation: this.citation(),
    })
  }

  private renderAnnotation(annotation: MnZoteroSourceAnnotation): TemplateResult {
    const promoted = asKeySet(this.promotedAnnotationKeys).has(annotation.key)
    const hasQuote = clean(annotation.text)
    const hasComment = clean(annotation.comment)
    return html`
      <div
        class="annotation"
        data-zotero-annotation
        data-zotero-annotation-key=${annotation.key}
        style=${styleMap({ borderLeftColor: clean(annotation.color) || null })}
      >
        ${hasQuote ? html`<div class="quote">${annotation.text}</div>` : nothing}
        ${hasComment ? html`<div class="note">${annotation.comment}</div>` : nothing}
        <div class="annotation-meta">
          <span class="kind">${annotation.kind || 'annotation'}</span>
          ${clean(annotation.page) ? html`<span>p. ${annotation.page}</span>` : nothing}
          ${promoted
            ? html`<span class="promoted">${icon('check', { size: 13 })}Promoted</span>`
            : html`
                <button
                  type="button"
                  class="promote"
                  data-zotero-promote
                  title="Promote into today's daily note as a quote"
                  @click=${() => this.promote(annotation)}
                >
                  ${icon('corner-up-right', { size: 13 })}Promote
                </button>
              `}
        </div>
      </div>
    `
  }

  private renderIncoming(wire: MnZoteroSourceIncomingWire): TemplateResult {
    const disabled = !clean(wire.otherDocumentId)
    return html`
      <button
        type="button"
        class="incoming"
        data-zotero-incoming
        data-zotero-wire-id=${wire.id}
        ?disabled=${disabled}
        @click=${() => this.openDocument(wire)}
      >
        <div class="rel">${clean(wire.predicateLabel) || 'cites'}</div>
        <div class="snip">${clean(wire.otherSnippet) || clean(wire.otherTitle) || clean(wire.otherDocumentId) || 'Untitled document'}</div>
      </button>
    `
  }

  private renderRail(): TemplateResult {
    const type = clean(this.item?.itemType)
    const abstract = clean(this.item?.abstractNote)
    const tags = this.tags()
    return html`
      <div class="rail">
        ${this.error
          ? html`
              <div class="state error" data-zotero-error>${this.error}</div>
              <button type="button" data-zotero-reload @click=${this.reload}>
                ${icon('refresh-cw', { size: 13 })}Retry
              </button>
            `
          : nothing}
        ${abstract ? html`<div class="label">Abstract</div><div class="abstract">${abstract}</div>` : nothing}
        ${type ? html`<div class="label">Type</div><div data-zotero-type>${type}</div>` : nothing}
        ${tags.length
          ? html`
              <div class="label">Tags</div>
              <div class="tags">
                ${tags.map(tag => html`
                  <button
                    type="button"
                    class="tag"
                    data-zotero-tag
                    data-zotero-tag-name=${tag}
                    title=${`See everything tagged #${tag.toLowerCase()}`}
                    @click=${() => this.openTag(tag)}
                  >#${tag}</button>
                `)}
              </div>
            `
          : nothing}
        ${this.loading ? html`<div class="label muted" data-zotero-loading>Resolving from Zotero...</div>` : nothing}
      </div>
    `
  }

  override render() {
    const key = this.resolvedKey()
    const title = clean(this.item?.title) || clean(this.item?.label) || key || 'Untitled source'
    const byline = this.byline()
    const type = clean(this.item?.itemType) || 'reference'
    const bylineText = [byline || type, key].filter(Boolean).join(' - ')
    return html`
      <div class="wrap" data-zotero-source-workbench>
        <header>
          <div class="kicker">Source - Zotero</div>
          <h1>${title}</h1>
          <div class="byline">${bylineText}</div>
          <div class="actions">
            <a class="btn" data-zotero-open href=${this.zoteroUrl()} @click=${this.openZotero}>
              ${icon('external-link', { size: 14 })}Open in Zotero
            </a>
            <button type="button" data-zotero-reload @click=${this.reload}>
              ${icon('refresh-cw', { size: 14 })}Reload
            </button>
          </div>
        </header>

        <section>
          <h2>From your reading${this.annotations.length ? ` - ${this.annotations.length}` : ''}</h2>
          ${this.annotations.length
            ? this.annotations.map(annotation => this.renderAnnotation(annotation))
            : html`<div class="empty">No notes or highlights on this source in Zotero.</div>`}
        </section>

        <section>
          <h2>In your graph</h2>
          ${this.incomingWires.length
            ? this.incomingWires.map(wire => this.renderIncoming(wire))
            : html`<div class="empty">Nothing cites this source yet. Use /cite in a document to ground a claim here.</div>`}
        </section>

        ${this.renderRail()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-zotero-source-workbench': MnZoteroSourceWorkbench
  }
}
