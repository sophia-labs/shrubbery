/**
 * mn-original-viewer - controlled original-file preview surface.
 *
 * Garden's original element reads native files, refreshes presigned URLs, builds
 * EPUB previews, runs pdfjs, and decorates source annotations. This Shrubbery
 * lift keeps the viewer contract only: callers provide a ready URL/srcdoc/text,
 * PDF page previews, EPUB chapters, and annotation rows; the component emits
 * intents for reload, download, external-open, chapter selection, and annotation
 * selection.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type MnOriginalViewerKind = 'auto' | 'pdf' | 'html' | 'text' | 'epub' | 'image' | 'file'
export type MnOriginalViewerStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable'

export interface MnOriginalViewerPage {
  readonly pageNumber: number
  readonly width?: number | null
  readonly height?: number | null
  readonly imageUrl?: string | null
  readonly label?: string | null
}

export interface MnOriginalViewerChapter {
  readonly id: string
  readonly title: string
  readonly href?: string | null
  readonly src?: string | null
  readonly srcdoc?: string | null
  readonly text?: string | null
}

export interface MnOriginalViewerAnnotation {
  readonly id: string
  readonly label?: string | null
  readonly quote?: string | null
  readonly pageNumber?: number | null
  readonly sourceRef?: string | null
}

export interface MnOriginalViewerIntentDetail {
  readonly graphId: string | null
  readonly documentId: string | null
}

export interface MnOriginalViewerChapterDetail extends MnOriginalViewerIntentDetail {
  readonly chapterId: string
  readonly chapter: MnOriginalViewerChapter
}

export interface MnOriginalViewerAnnotationDetail extends MnOriginalViewerIntentDetail {
  readonly annotationId: string
  readonly annotation: MnOriginalViewerAnnotation
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function extensionFrom(filename: string): string {
  const clean = filename.split('?')[0]?.split('#')[0] ?? ''
  const idx = clean.lastIndexOf('.')
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : ''
}

function inferKind(kind: MnOriginalViewerKind, mimeType: string, fileType: string, filename: string): MnOriginalViewerKind {
  if (kind !== 'auto') return kind
  const mime = mimeType.toLowerCase()
  const type = fileType.toLowerCase()
  const ext = extensionFrom(filename)
  if (mime.includes('pdf') || type === 'pdf' || ext === 'pdf') return 'pdf'
  if (mime.includes('html') || type === 'html' || ext === 'html' || ext === 'htm') return 'html'
  if (mime.includes('epub') || type === 'epub' || ext === 'epub') return 'epub'
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml', 'log'].includes(ext)) return 'text'
  return 'file'
}

@customElement('mn-original-viewer')
export class MnOriginalViewer extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .root {
      display: flex;
      width: 100%;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      min-height: 54px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
    }

    .title-wrap {
      min-width: 0;
      flex: 1 1 auto;
    }

    .title {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    button,
    .file-action {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0 10px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-decoration: none;
      box-sizing: border-box;
    }

    button:hover:not(:disabled),
    .file-action:hover {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    button:disabled,
    .file-action[aria-disabled='true'] {
      cursor: default;
      opacity: 0.48;
    }

    .stage {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .viewer {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
    }

    iframe {
      width: 100%;
      height: 100%;
      flex: 1 1 auto;
      border: 0;
      background: var(--mn-color-surface-base, #fff);
    }

    .text-view {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-6, 24px);
      background: var(--mn-color-surface-base, #fff);
      box-sizing: border-box;
    }

    .source-pre {
      max-width: 920px;
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.55;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .image-wrap {
      display: grid;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-5, 20px);
      place-items: center;
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .image-wrap img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
    }

    .pdf-reader {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .pdf-pages {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      padding: 24px 18px 36px;
      box-sizing: border-box;
    }

    .pdf-page {
      width: min(100%, 980px);
      margin: 0;
    }

    .pdf-image,
    .pdf-placeholder {
      display: block;
      width: 100%;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-md, 0 12px 30px rgba(31, 41, 51, 0.16));
      box-sizing: border-box;
    }

    .pdf-placeholder {
      display: grid;
      min-height: 360px;
      place-items: center;
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .pdf-page-label {
      margin: 8px 0 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: center;
    }

    .epub-reader {
      display: grid;
      flex: 1 1 auto;
      min-height: 0;
      grid-template-columns: minmax(190px, 248px) minmax(0, 1fr);
      background: var(--mn-color-surface-base, #fff);
    }

    .epub-nav {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: 16px 10px;
      border-right: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .epub-title {
      margin: 0 6px 4px;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 700;
      line-height: 1.35;
    }

    .epub-meta {
      margin: 0 6px 14px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .chapter-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .chapter-button {
      justify-content: flex-start;
      width: 100%;
      min-height: 34px;
      border: 0;
      padding: 7px 8px;
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      text-align: left;
    }

    .chapter-button:hover,
    .chapter-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .chapter-button[aria-current='true'] {
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
      font-weight: 700;
    }

    .epub-stage {
      display: flex;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .file-fallback {
      display: grid;
      flex: 1 1 auto;
      min-height: 0;
      align-content: center;
      justify-content: center;
      overflow: auto;
      padding: var(--mn-space-6, 24px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .file-panel {
      max-width: 560px;
      padding: 18px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .file-title {
      margin: 0 0 8px;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      font-weight: 700;
    }

    .file-meta {
      margin: 0 0 14px;
      color: var(--mn-color-text-tertiary, #6b7280);
      line-height: 1.45;
    }

    .annotation-rail {
      width: min(280px, 32vw);
      min-width: 220px;
      flex: 0 0 auto;
      overflow: auto;
      border-left: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .annotation-head {
      position: sticky;
      top: 0;
      padding: 10px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .annotation-button {
      display: flex;
      width: 100%;
      min-height: 0;
      align-items: flex-start;
      justify-content: flex-start;
      padding: 10px 12px;
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      text-align: left;
    }

    .annotation-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .annotation-label {
      display: block;
      font-weight: 700;
    }

    .annotation-quote {
      display: block;
      margin-top: 3px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .state {
      display: grid;
      flex: 1 1 auto;
      min-height: 220px;
      align-content: center;
      padding: var(--mn-space-6, 24px);
      box-sizing: border-box;
    }

    @media (max-width: 760px) {
      .toolbar {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .actions {
        width: 100%;
      }

      .stage {
        flex-direction: column;
      }

      .annotation-rail {
        width: 100%;
        min-width: 0;
        max-height: 180px;
        border-left: 0;
        border-top: 1px solid var(--mn-color-border-default, #d1d5db);
      }

      .epub-reader {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }

      .epub-nav {
        max-height: 164px;
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
      }
    }
  `

  @property({ type: String }) graphId = ''
  @property({ type: String }) documentId = ''
  @property({ type: String }) status: MnOriginalViewerStatus = 'idle'
  @property({ type: String }) kind: MnOriginalViewerKind = 'auto'
  @property({ type: String }) title = ''
  @property({ type: String }) filename = ''
  @property({ type: String }) fileType = ''
  @property({ type: String }) mimeType = ''
  @property({ type: String }) src = ''
  @property({ type: String }) srcdoc = ''
  @property({ type: String }) text = ''
  @property({ type: String }) error = ''
  @property({ type: String }) selectedChapterId = ''
  @property({ type: Boolean }) downloadable = false
  @property({ type: Boolean }) externalOpenable = false
  @property({ attribute: false }) pages: readonly MnOriginalViewerPage[] = []
  @property({ attribute: false }) chapters: readonly MnOriginalViewerChapter[] = []
  @property({ attribute: false }) annotations: readonly MnOriginalViewerAnnotation[] = []

  private _detail(): MnOriginalViewerIntentDetail {
    return {
      graphId: trimmed(this.graphId) || null,
      documentId: trimmed(this.documentId) || null,
    }
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _reload(): void {
    this._emit<MnOriginalViewerIntentDetail>('mn-original-viewer-reload', this._detail())
  }

  private _download(): void {
    this._emit<MnOriginalViewerIntentDetail>('mn-original-viewer-download', this._detail())
  }

  private _openExternal(): void {
    this._emit<MnOriginalViewerIntentDetail>('mn-original-viewer-open-external', this._detail())
  }

  private _selectChapter(chapter: MnOriginalViewerChapter): void {
    this._emit<MnOriginalViewerChapterDetail>('mn-original-viewer-chapter-select', {
      ...this._detail(),
      chapterId: chapter.id,
      chapter,
    })
  }

  private _selectAnnotation(annotation: MnOriginalViewerAnnotation): void {
    this._emit<MnOriginalViewerAnnotationDetail>('mn-original-viewer-annotation-select', {
      ...this._detail(),
      annotationId: annotation.id,
      annotation,
    })
  }

  private _kind(): MnOriginalViewerKind {
    return inferKind(this.kind, this.mimeType, this.fileType, this.filename)
  }

  private _heading(): string {
    return trimmed(this.title) || trimmed(this.filename) || 'Original file'
  }

  private _meta(): string {
    return [this.filename, this.mimeType || this.fileType].map(trimmed).filter(Boolean).join(' - ')
  }

  private _state(iconName: string, title: string, description: string, mood: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`
      <div class="state">
        <mn-empty-state
          icon=${iconName}
          title=${title}
          description=${description}
          mood=${mood}
          variant="compact"
        ></mn-empty-state>
      </div>
    `
  }

  private _renderFrame(): TemplateResult | typeof nothing {
    if (this.srcdoc) {
      return html`<iframe title=${this._heading()} sandbox="allow-same-origin allow-popups" .srcdoc=${this.srcdoc}></iframe>`
    }
    if (this.src) {
      return html`<iframe title=${this._heading()} sandbox="allow-same-origin allow-popups" src=${this.src}></iframe>`
    }
    return nothing
  }

  private _renderText(): TemplateResult {
    return html`<div class="text-view"><pre class="source-pre">${this.text}</pre></div>`
  }

  private _renderImage(): TemplateResult {
    if (!this.src) return this._renderFileFallback()
    return html`<div class="image-wrap"><img src=${this.src} alt=${this._heading()} /></div>`
  }

  private _renderPdf(): TemplateResult {
    if (this.src && this.pages.length === 0) {
      return html`<div class="viewer">${this._renderFrame()}</div>`
    }
    if (this.pages.length === 0) return this._renderFileFallback()
    return html`
      <div class="pdf-reader">
        <div class="pdf-pages">
          ${repeat(this.pages, (page) => page.pageNumber, (page) => html`
            <figure class="pdf-page">
              ${page.imageUrl
                ? html`<img class="pdf-image" src=${page.imageUrl} alt=${page.label || `Page ${page.pageNumber}`} />`
                : html`
                    <div
                      class="pdf-placeholder"
                      style=${page.width && page.height ? `aspect-ratio:${page.width}/${page.height};` : ''}
                    >
                      ${icon('file-text', { size: 28 })} Page ${page.pageNumber}
                    </div>
                  `}
              <figcaption class="pdf-page-label">${page.label || `Page ${page.pageNumber}`}</figcaption>
            </figure>
          `)}
        </div>
      </div>
    `
  }

  private _activeChapter(): MnOriginalViewerChapter | null {
    if (this.chapters.length === 0) return null
    const selected = trimmed(this.selectedChapterId)
    return this.chapters.find((chapter) => chapter.id === selected) ?? this.chapters[0] ?? null
  }

  private _renderEpub(): TemplateResult {
    const chapter = this._activeChapter()
    if (!chapter) return this._renderFileFallback()
    return html`
      <div class="epub-reader">
        <aside class="epub-nav" aria-label="EPUB chapters">
          <p class="epub-title">${this._heading()}</p>
          <p class="epub-meta">${this.chapters.length} chapter${this.chapters.length === 1 ? '' : 's'}</p>
          <div class="chapter-list">
            ${repeat(this.chapters, (item) => item.id, (item) => html`
              <button
                type="button"
                class="chapter-button"
                aria-current=${item.id === chapter.id ? 'true' : 'false'}
                @click=${() => this._selectChapter(item)}
              >${item.title}</button>
            `)}
          </div>
        </aside>
        <div class="epub-stage">
          ${chapter.srcdoc
            ? html`<iframe title=${chapter.title} sandbox="allow-same-origin allow-popups" .srcdoc=${chapter.srcdoc}></iframe>`
            : chapter.src
              ? html`<iframe title=${chapter.title} sandbox="allow-same-origin allow-popups" src=${chapter.src}></iframe>`
              : html`<div class="text-view"><pre class="source-pre">${chapter.text || ''}</pre></div>`}
        </div>
      </div>
    `
  }

  private _renderFileFallback(): TemplateResult {
    return html`
      <div class="file-fallback">
        <div class="file-panel">
          <h3 class="file-title">${this._heading()}</h3>
          <p class="file-meta">${this._meta() || 'This original file is available, but it cannot be previewed inline.'}</p>
          <span class="actions">
            <button type="button" ?disabled=${!this.downloadable} @click=${() => this._download()}>
              ${icon('download', { size: 13 })} Download
            </button>
            <button type="button" ?disabled=${!this.externalOpenable} @click=${() => this._openExternal()}>
              ${icon('external-link', { size: 13 })} Open
            </button>
          </span>
        </div>
      </div>
    `
  }

  private _renderBody(): TemplateResult | typeof nothing {
    if (this.status === 'loading' || this.status === 'idle') {
      return html`<div class="state"><mn-loading size="sm" text="Loading original file"></mn-loading></div>`
    }
    if (this.status === 'error') {
      return this._state('alert-circle', 'Original file failed', this.error || 'The original file could not be loaded.', 'danger')
    }
    if (this.status === 'empty' || this.status === 'unavailable') {
      return this._state('file-text', 'No original file', this.error || 'No original file is attached to this document.')
    }

    const kind = this._kind()
    if (kind === 'pdf') return this._renderPdf()
    if (kind === 'html') {
      const frame = this._renderFrame()
      return frame === nothing ? this._renderFileFallback() : html`<div class="viewer">${frame}</div>`
    }
    if (kind === 'text') return this._renderText()
    if (kind === 'epub') return this._renderEpub()
    if (kind === 'image') return this._renderImage()
    return this._renderFileFallback()
  }

  private _renderAnnotations(): TemplateResult | typeof nothing {
    if (this.annotations.length === 0) return nothing
    return html`
      <aside class="annotation-rail" aria-label="Source annotations">
        <div class="annotation-head">Source annotations</div>
        ${repeat(this.annotations, (annotation) => annotation.id, (annotation) => html`
          <button
            type="button"
            class="annotation-button"
            data-annotation-id=${annotation.id}
            @click=${() => this._selectAnnotation(annotation)}
          >
            <span>
              <span class="annotation-label">${annotation.label || annotation.sourceRef || annotation.id}</span>
              ${annotation.pageNumber ? html`<span class="annotation-quote">Page ${annotation.pageNumber}</span>` : nothing}
              ${trimmed(annotation.quote) ? html`<span class="annotation-quote">${annotation.quote}</span>` : nothing}
            </span>
          </button>
        `)}
      </aside>
    `
  }

  render(): TemplateResult {
    return html`
      <section class="root" role="region" aria-label="Original file viewer">
        <header class="toolbar">
          ${icon('file-text', { size: 18 })}
          <span class="title-wrap">
            <span class="title">${this._heading()}</span>
            <span class="meta">${this._meta()}</span>
          </span>
          <span class="actions">
            <button type="button" @click=${() => this._reload()} aria-label="Reload original file">
              ${icon('refresh', { size: 13 })} Reload
            </button>
            <button type="button" ?disabled=${!this.downloadable} @click=${() => this._download()} aria-label="Download original file">
              ${icon('download', { size: 13 })} Download
            </button>
          </span>
        </header>
        <div class="stage">
          <main class="viewer">${this._renderBody()}</main>
          ${this._renderAnnotations()}
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-original-viewer': MnOriginalViewer
  }
}
