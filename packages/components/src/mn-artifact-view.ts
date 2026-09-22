/**
 * mn-artifact-view - controlled center-pane artifact surface.
 *
 * Garden's original artifact view owns download, revision history, image editing,
 * Excalidraw, and upload side effects. This Shrubbery component keeps only the
 * visual shell and user intents: callers provide preview state and receive
 * refresh/download/history/open-document events. It never fetches, creates
 * object URLs, persists, or talks to a workspace contract.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, type IconName } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'
import './mn-excalidraw-canvas.js'

export type MnArtifactViewStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnArtifactViewKind = 'image' | 'pdf' | 'audio' | 'video' | 'scene' | 'text' | 'binary'

export interface MnArtifactIntentDetail {
  readonly graphId: string
  readonly artifactId: string
}

export interface MnArtifactOpenDocumentDetail extends MnArtifactIntentDetail {
  readonly documentId: string
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function artifactKindFromMime(
  mimeType: string | null | undefined,
  fileType?: string | null,
): MnArtifactViewKind {
  const mime = trimmed(mimeType).toLowerCase()
  const type = trimmed(fileType).toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || type === 'pdf') return 'pdf'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/vnd.excalidraw+json' || type === 'excalidraw') return 'scene'
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/xhtml+xml'
  ) {
    return 'text'
  }
  return 'binary'
}

function kindIcon(kind: MnArtifactViewKind): IconName {
  switch (kind) {
    case 'image':
      return 'image-plus'
    case 'pdf':
    case 'text':
      return 'file-text'
    case 'scene':
      return 'network'
    case 'audio':
    case 'video':
    case 'binary':
    default:
      return 'file'
  }
}

function kindLabel(kind: MnArtifactViewKind): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'pdf':
      return 'PDF'
    case 'audio':
      return 'Audio'
    case 'video':
      return 'Video'
    case 'scene':
      return 'Scene'
    case 'text':
      return 'Text'
    case 'binary':
    default:
      return 'Artifact'
  }
}

@customElement('mn-artifact-view')
export class MnArtifactView extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .artifact-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      overflow: hidden;
    }

    mn-excalidraw-canvas {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 320px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: 56px;
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eef2ff);
      flex: 0 0 auto;
    }

    .title-wrap {
      flex: 1 1 auto;
      min-width: 0;
    }

    .title {
      margin: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-xl, 20px);
      font-weight: var(--mn-font-weight-semibold, 600);
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin-top: 4px;
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .meta span {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.6;
      flex: 0 0 auto;
    }

    .actions {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      flex: 0 0 auto;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      box-sizing: border-box;
    }

    .icon-button:hover {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .icon-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .surface {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: var(--mn-space-5, 20px);
      background:
        linear-gradient(180deg, rgba(17, 24, 39, 0.035), transparent 160px),
        var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .preview-frame {
      width: 100%;
      height: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .preview-frame img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
      background: var(--mn-color-surface-base, #fff);
    }

    .state {
      width: min(460px, 100%);
    }

    :host([data-skin='emporium']) .glyph,
    :host([data-skin='emporium']) .icon-button {
      border-radius: var(--mn-radius-control, 4px);
    }
  `

  @property({ type: String }) graphId = ''
  @property({ type: String }) artifactId = ''
  @property({ type: String }) title = ''
  @property({ type: String }) mimeType = ''
  @property({ type: String }) fileType = ''
  @property({ type: String }) artifactStatus = ''
  @property({ type: String }) ingestedDocumentId = ''
  @property({ type: String }) previewUrl = ''
  @property({ type: String }) status: MnArtifactViewStatus = 'idle'
  @property({ type: String }) error = ''

  private _intent(): MnArtifactIntentDetail {
    return { graphId: this.graphId, artifactId: this.artifactId }
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _refresh(): void {
    this._emit<MnArtifactIntentDetail>('mn-artifact-refresh', this._intent())
  }

  private _download(): void {
    this._emit<MnArtifactIntentDetail>('mn-artifact-download', this._intent())
  }

  private _openHistory(): void {
    this._emit<MnArtifactIntentDetail>('mn-artifact-history-open', this._intent())
  }

  private _openEditor(): void {
    this._emit<MnArtifactIntentDetail>('mn-artifact-edit-open', this._intent())
  }

  private _openDocument(): void {
    const documentId = trimmed(this.ingestedDocumentId)
    if (!documentId) return
    this._emit<MnArtifactOpenDocumentDetail>('mn-artifact-open-document', {
      ...this._intent(),
      documentId,
    })
  }

  private _renderSurface(kind: MnArtifactViewKind, label: string): TemplateResult {
    if (this.status === 'idle' || this.status === 'loading') {
      return html`<div class="state"><mn-loading size="sm" text=${`Loading ${label.toLowerCase()}`}></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`
        <div class="state">
          <mn-empty-state
            icon="alert-circle"
            title="Could not load artifact"
            description=${this.error || 'The artifact preview read failed.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    if (kind === 'image' && trimmed(this.previewUrl)) {
      return html`<div class="preview-frame"><img src=${this.previewUrl} alt=${this.title || 'Artifact preview'} /></div>`
    }
    if (kind === 'image') {
      return html`
        <div class="state">
          <mn-empty-state
            icon="image-plus"
            title="No image preview"
            description="The image artifact is selected, but no preview URL is available."
          ></mn-empty-state>
        </div>
      `
    }
    return html`
      <div class="state">
        <mn-empty-state
          icon=${kindIcon(kind)}
          title=${`No inline preview for ${label.toLowerCase()}`}
          description="The artifact is selected and ready for shell-owned actions."
        ></mn-empty-state>
      </div>
    `
  }

  render(): TemplateResult {
    const kind = artifactKindFromMime(this.mimeType, this.fileType)
    const label = kindLabel(kind)
    const title = trimmed(this.title) || trimmed(this.artifactId) || 'Artifact'
    // Garden scenes render directly as the Excalidraw island. It owns its own
    // toolbar, save flow, projection inspector, and node-link picker.
    if (kind === 'scene') {
      return html`
        <mn-excalidraw-canvas
          .graphId=${this.graphId}
          .artifactId=${this.artifactId}
          .title=${title}
        ></mn-excalidraw-canvas>
      `
    }
    const mime = trimmed(this.mimeType)
    const artifactStatus = trimmed(this.artifactStatus)
    const canDownload = trimmed(this.graphId) !== '' && trimmed(this.artifactId) !== ''
    const canOpenHistory = canDownload
    const canEdit = kind === 'image' && this.status === 'ready' && trimmed(this.previewUrl) !== ''
    const canOpenDocument = trimmed(this.ingestedDocumentId) !== ''

    return html`
      <section class="artifact-view" aria-label=${`Artifact ${title}`}>
        <header class="header">
          <span class="glyph" aria-hidden="true">${icon(kindIcon(kind), { size: 19 })}</span>
          <span class="title-wrap">
            <h2 class="title">${title}</h2>
            <span class="meta">
              <span>${label}</span>
              ${mime ? html`<span class="dot" aria-hidden="true"></span><span>${mime}</span>` : nothing}
              ${artifactStatus ? html`<span class="dot" aria-hidden="true"></span><span>${artifactStatus}</span>` : nothing}
            </span>
          </span>
          <span class="actions">
            <button type="button" class="icon-button" title="Refresh artifact" aria-label="Refresh artifact" @click=${this._refresh}>
              ${icon('refresh', { size: 16 })}
            </button>
            <button
              type="button"
              class="icon-button"
              title="Edit artifact"
              aria-label="Edit artifact"
              ?disabled=${!canEdit}
              @click=${this._openEditor}
            >
              ${icon('pencil', { size: 16 })}
            </button>
            <button
              type="button"
              class="icon-button"
              title="Open artifact history"
              aria-label="Open artifact history"
              ?disabled=${!canOpenHistory}
              @click=${this._openHistory}
            >
              ${icon('clock', { size: 16 })}
            </button>
            <button
              type="button"
              class="icon-button"
              title="Download artifact"
              aria-label="Download artifact"
              ?disabled=${!canDownload}
              @click=${this._download}
            >
              ${icon('download', { size: 16 })}
            </button>
            ${canOpenDocument
              ? html`
                  <button
                    type="button"
                    class="icon-button"
                    title="Open ingested document"
                    aria-label="Open ingested document"
                    @click=${this._openDocument}
                  >
                    ${icon('file-text', { size: 16 })}
                  </button>
                `
              : nothing}
          </span>
        </header>
        <div class="surface">${this._renderSurface(kind, label)}</div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-artifact-view': MnArtifactView
  }
}
