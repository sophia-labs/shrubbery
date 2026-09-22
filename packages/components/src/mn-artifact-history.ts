/**
 * mn-artifact-history - controlled artifact revision-history panel.
 *
 * Garden's original component fetches revisions, creates thumbnail object URLs,
 * and POSTs restores. This Shrubbery lift keeps the visual revision rail and
 * user intents only. Hosts own revision loading, thumbnail URL lifetime, and
 * restore side effects.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type MnArtifactHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnArtifactRevisionTrigger = 'manual' | 'checkpoint' | string

export interface MnArtifactRevision {
  readonly revisionId: string
  readonly createdAt: number | string | Date
  readonly trigger?: MnArtifactRevisionTrigger
  readonly label?: string | null
  readonly filename?: string | null
  readonly mimeType?: string | null
  readonly sizeBytes?: number | null
  readonly thumbnailUrl?: string | null
}

export interface MnArtifactHistoryRevisionDetail {
  readonly graphId: string
  readonly artifactId: string
  readonly revisionId: string
}

export interface MnArtifactHistoryIntentDetail {
  readonly graphId: string
  readonly artifactId: string
}

function timestamp(value: number | string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function relativeTime(value: number | string | Date): string {
  const then = timestamp(value)
  if (!then) return 'unknown time'
  const diff = Math.max(0, Date.now() - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function absoluteTime(value: number | string | Date): string {
  const date = new Date(timestamp(value))
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function revisionLabel(revision: MnArtifactRevision): string {
  const label = revision.label?.trim()
  if (label) return label
  if (revision.trigger === 'checkpoint') return 'Snapshot'
  if (revision.trigger === 'manual') return 'Edit'
  return 'Revision'
}

@customElement('mn-artifact-history')
export class MnArtifactHistory extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 280px;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      border-left: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      box-sizing: border-box;
    }

    .head {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: 46px;
      padding: 0 var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
      font-weight: 700;
      box-sizing: border-box;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .icon-button,
    .restore {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      box-sizing: border-box;
    }

    .icon-button {
      width: 28px;
      height: 28px;
      padding: 0;
    }

    .restore {
      gap: 4px;
      min-height: 27px;
      padding: 0 8px;
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .icon-button:hover,
    .restore:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    button:disabled {
      cursor: default;
      opacity: 0.48;
    }

    .list {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      overflow: auto;
      padding: var(--mn-space-2, 8px);
      box-sizing: border-box;
    }

    .card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .thumb {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      overflow: hidden;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-muted, #9ca3af);
      flex: 0 0 auto;
    }

    .thumb img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .meta {
      min-width: 0;
    }

    .label {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
    }

    .label-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sub,
    .file {
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file {
      margin-top: 1px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: 11px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-accent-strong, #1d4ed8);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      flex: 0 0 auto;
    }

    .state {
      display: grid;
      min-height: 180px;
      align-content: center;
      padding: var(--mn-space-2, 8px);
    }

    :host([data-skin='emporium']) .card,
    :host([data-skin='emporium']) .icon-button,
    :host([data-skin='emporium']) .restore {
      border-radius: var(--mn-radius-control, 4px);
    }
  `

  @property({ type: String }) graphId = ''
  @property({ type: String }) artifactId = ''
  @property({ type: String }) status: MnArtifactHistoryStatus = 'ready'
  @property({ type: String }) error = ''
  @property({ type: String }) restoringRevisionId = ''
  @property({ attribute: false }) revisions: readonly MnArtifactRevision[] = []

  private _intent(): MnArtifactHistoryIntentDetail {
    return { graphId: this.graphId, artifactId: this.artifactId }
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _close(): void {
    this._emit<MnArtifactHistoryIntentDetail>('mn-artifact-history-close', this._intent())
  }

  private _refresh(): void {
    this._emit<MnArtifactHistoryIntentDetail>('mn-artifact-history-refresh', this._intent())
  }

  private _restore(revisionId: string): void {
    if (!revisionId || this.restoringRevisionId) return
    this._emit<MnArtifactHistoryRevisionDetail>('mn-artifact-history-restore', {
      ...this._intent(),
      revisionId,
    })
  }

  private _renderState(): TemplateResult | typeof nothing {
    if (this.status === 'loading' || this.status === 'idle') {
      return html`<div class="state"><mn-loading size="sm" text="Loading artifact history"></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`
        <div class="state">
          <mn-empty-state
            icon="alert-circle"
            title="Could not load history"
            description=${this.error || 'The artifact revision list could not be loaded.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    if (!this.revisions.length) {
      return html`
        <div class="state">
          <mn-empty-state
            icon="clock"
            title="No versions yet"
            description="Edits and generated artifact revisions will appear here."
          ></mn-empty-state>
        </div>
      `
    }
    return nothing
  }

  private _renderCard(revision: MnArtifactRevision, isCurrent: boolean): TemplateResult {
    const label = revisionLabel(revision)
    const bytes = formatBytes(revision.sizeBytes)
    const filename = revision.filename?.trim()
    const sub = [relativeTime(revision.createdAt), bytes].filter(Boolean).join(' - ')
    const thumbnailUrl = revision.thumbnailUrl?.trim()
    const restoring = this.restoringRevisionId === revision.revisionId
    return html`
      <article class="card" data-revision-id=${revision.revisionId} data-current=${isCurrent ? 'true' : 'false'}>
        <span class="thumb" aria-hidden="true">
          ${thumbnailUrl ? html`<img src=${thumbnailUrl} alt="" />` : icon('file', { size: 18 })}
        </span>
        <span class="meta">
          <span class="label">
            <span class="label-text">${label}</span>
            ${isCurrent ? html`<span class="badge">current</span>` : nothing}
          </span>
          <span class="sub" title=${absoluteTime(revision.createdAt)}>${sub}</span>
          ${filename ? html`<span class="file">${filename}</span>` : nothing}
        </span>
        ${isCurrent
          ? nothing
          : html`
            <button
              type="button"
              class="restore"
              ?disabled=${this.restoringRevisionId !== ''}
              aria-label=${`Restore ${label}`}
              @click=${() => this._restore(revision.revisionId)}
            >
              ${icon('undo', { size: 13 })} ${restoring ? 'Restoring' : 'Restore'}
            </button>
          `}
      </article>
    `
  }

  render(): TemplateResult {
    const state = this._renderState()
    return html`
      <header class="head">
        ${icon('clock', { size: 15 })} Version history
        <span class="spacer"></span>
        <button type="button" class="icon-button" title="Refresh history" aria-label="Refresh history" @click=${() => this._refresh()}>
          ${icon('refresh', { size: 15 })}
        </button>
        <button type="button" class="icon-button" title="Close history" aria-label="Close history" @click=${() => this._close()}>
          ${icon('x', { size: 16 })}
        </button>
      </header>
      <div class="list">
        ${state === nothing
          ? repeat(this.revisions, (revision) => revision.revisionId, (revision, index) => this._renderCard(revision, index === 0))
          : state}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-artifact-history': MnArtifactHistory
  }
}
