/**
 * mn-doc-history-panel - controlled document history comparison surface.
 *
 * Garden's original doc-history-panel is a singleton overlay that fetches
 * snapshot lists, reads snapshot markdown/html, observes documentStore comments,
 * and restores via a window event. The Shrubbery lift keeps the timeline/diff
 * UI and user intents, but all IO and restore work are shell-owned props/events.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type MnDocHistoryCursorId = 'live' | string
export type MnDocHistoryFocusedSide = 'older' | 'newer'
export type MnDocHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnDocHistoryDiffStyle = 'split' | 'unified'

export interface MnDocHistorySnapshot {
  readonly id: string
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly label?: string | null
  readonly createdAt: string | number | Date
  readonly tier?: string | null
  readonly isManual?: boolean
  readonly snapshotCount?: number | null
  readonly charsAdded?: number | null
  readonly charsRemoved?: number | null
  readonly blocksAdded?: number | null
  readonly blocksRemoved?: number | null
  readonly blocksModified?: number | null
}

export interface MnDocHistoryCursorDetail {
  readonly olderId: MnDocHistoryCursorId
  readonly newerId: MnDocHistoryCursorId
  readonly focusedSide: MnDocHistoryFocusedSide
}

export interface MnDocHistorySnapshotDetail {
  readonly snapshotId: string
}

export interface MnDocHistoryRestoreDetail {
  readonly snapshotId: string
}

export interface MnDocHistoryDiffLine {
  readonly index: number
  readonly older?: string
  readonly newer?: string
  readonly kind: 'same' | 'added' | 'removed' | 'changed'
}

interface Row {
  readonly id: MnDocHistoryCursorId
  readonly kind: 'live' | 'manual' | 'auto'
  readonly label: string
  readonly sublabel: string
  readonly snapshot?: MnDocHistorySnapshot
}

function timestamp(value: string | number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function relativeTime(value: string | number | Date): string {
  const then = timestamp(value)
  if (!then) return 'unknown time'
  const diff = Math.max(0, Date.now() - then)
  const min = Math.floor(diff / 60_000)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day === 1) return 'yesterday'
  if (day < 14) return `${day}d ago`
  return `${Math.floor(day / 7)}w ago`
}

function absoluteTime(value: string | number | Date): string {
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

function tierBadge(tier: string | null | undefined): string {
  switch (tier) {
    case '20min':
      return '20m'
    case '2h':
      return '2h'
    case '12h':
      return '12h'
    case 'daily':
      return 'day'
    case 'weekly':
      return 'wk'
    default:
      return tier || 'snap'
  }
}

export function diffHistoryLines(olderText: string, newerText: string): MnDocHistoryDiffLine[] {
  const older = olderText.split(/\r?\n/)
  const newer = newerText.split(/\r?\n/)
  const length = Math.max(older.length, newer.length)
  const lines: MnDocHistoryDiffLine[] = []
  for (let index = 0; index < length; index++) {
    const oldLine = older[index]
    const newLine = newer[index]
    let kind: MnDocHistoryDiffLine['kind']
    if (oldLine === newLine) kind = 'same'
    else if (oldLine === undefined) kind = 'added'
    else if (newLine === undefined) kind = 'removed'
    else kind = 'changed'
    lines.push({ index: index + 1, older: oldLine, newer: newLine, kind })
  }
  return lines
}

@customElement('mn-doc-history-panel')
export class MnDocHistoryPanel extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fafaf8);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      box-sizing: border-box;
    }

    .header,
    .footer {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      flex: 0 0 auto;
      min-height: 48px;
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .footer {
      min-height: 52px;
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-bottom: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
    }

    .title-wrap {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .title {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 17px);
      font-weight: 650;
      line-height: 1.2;
    }

    .subtitle {
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .spacer {
      flex: 1 1 auto;
      min-width: var(--mn-space-2, 8px);
    }

    .body-host {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }

    .body {
      display: grid;
      grid-template-columns: minmax(210px, 260px) minmax(0, 1fr);
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      overflow: hidden;
    }

    .footer-action {
      display: inline-flex;
      flex: 0 0 auto;
    }

    .rail {
      display: flex;
      min-height: 0;
      flex-direction: column;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .rail-header {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .rail-title {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .cursor-summary {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .cursor-summary b {
      color: var(--mn-color-text-primary, #111827);
    }

    .rail-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 4px 0;
    }

    .rail-row {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      width: 100%;
      padding: 7px var(--mn-space-3, 12px);
      border: 0;
      border-left: 2px solid transparent;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
    }

    .rail-row:hover {
      background: var(--mn-color-surface-hover, #eef2f0);
    }

    .rail-row[data-cursor~='older'] {
      border-left-color: var(--mn-color-warning-strong, #b45309);
    }

    .rail-row[data-cursor~='newer'] {
      border-left-color: var(--mn-color-accent-strong, #2563eb);
    }

    .rail-row[data-focused='true'] {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: -2px;
    }

    .cursor-mark {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: 10px;
      line-height: 1;
    }

    .cursor-mark [data-active='true'][data-side='older'] {
      color: var(--mn-color-warning-strong, #b45309);
      font-weight: 800;
    }

    .cursor-mark [data-active='true'][data-side='newer'] {
      color: var(--mn-color-accent-strong, #2563eb);
      font-weight: 800;
    }

    .row-body {
      min-width: 0;
    }

    .row-label,
    .row-sublabel {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-label {
      color: var(--mn-color-text-primary, #111827);
      font-weight: 600;
    }

    .row-sublabel {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .row-actions {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .tier {
      display: inline-flex;
      align-items: center;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-accent, #eef2ff);
      color: var(--mn-color-text-tertiary, #4b5563);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .icon-button,
    .ghost-button,
    .restore-button,
    .toggle-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      cursor: pointer;
      box-sizing: border-box;
    }

    .icon-button {
      width: 28px;
      height: 28px;
      padding: 0;
      border-color: transparent;
      background: transparent;
      opacity: 0.72;
    }

    .icon-button:hover,
    .ghost-button:hover,
    .toggle-button:hover {
      background: var(--mn-color-surface-hover, #eef2f0);
      color: var(--mn-color-text-primary, #111827);
      opacity: 1;
    }

    .toggle-button[data-active='true'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-accent-strong, #1d4ed8);
    }

    .restore-button {
      border-color: var(--mn-color-warning-border, #f59e0b);
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #9a3412);
      font-weight: 700;
    }

    button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .diff-pane {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      background: var(--mn-color-surface-base, #fff);
    }

    .diff-toolbar {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: 42px;
      padding: 0 var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      box-sizing: border-box;
    }

    .pair-label {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
    }

    .side-pill {
      display: inline-flex;
      max-width: 16rem;
      align-items: center;
      padding: 2px 8px;
      border-radius: var(--mn-radius-full, 999px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .side-pill[data-side='older'] {
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #9a3412);
    }

    .side-pill[data-side='newer'] {
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-accent-strong, #1d4ed8);
    }

    .diff-host {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
    }

    .diff-table {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      min-height: 100%;
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.55;
    }

    .diff-unified {
      display: block;
      min-height: 100%;
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.55;
    }

    .diff-side {
      min-width: 0;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .diff-side:last-child {
      border-right: 0;
    }

    .diff-line {
      display: grid;
      grid-template-columns: 3.5rem minmax(0, 1fr);
      min-height: 22px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      white-space: pre-wrap;
    }

    .line-no {
      padding: 2px 8px;
      color: var(--mn-color-text-muted, #9ca3af);
      text-align: right;
      user-select: none;
    }

    .line-text {
      min-width: 0;
      padding: 2px 8px;
    }

    .diff-line[data-kind='added'] {
      background: rgba(22, 163, 74, 0.12);
    }

    .diff-line[data-kind='removed'] {
      background: rgba(220, 38, 38, 0.1);
    }

    .diff-line[data-kind='changed'] {
      background: rgba(245, 158, 11, 0.12);
    }

    .status {
      display: grid;
      min-height: 220px;
      align-content: center;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
    }

    .hint {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 720px) {
      .body {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(170px, 34%) minmax(0, 1fr);
      }

      .rail {
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }

      .diff-table {
        grid-template-columns: 1fr;
      }

      .diff-side {
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }
    }
  `

  @property({ type: String }) title = 'Document History'
  @property({ type: String }) subtitle = ''
  @property({ type: String }) status: MnDocHistoryStatus = 'ready'
  @property({ type: String }) error = ''
  @property({ attribute: false }) snapshots: readonly MnDocHistorySnapshot[] = []
  @property({ type: String }) olderId: MnDocHistoryCursorId = ''
  @property({ type: String }) newerId: MnDocHistoryCursorId = 'live'
  @property({ type: String }) focusedSide: MnDocHistoryFocusedSide = 'older'
  @property({ type: String }) olderText = ''
  @property({ type: String }) newerText = ''
  @property({ type: String }) diffStatus: MnDocHistoryStatus = 'ready'
  @property({ type: String }) diffError = ''
  @property({ type: String }) diffStyle: MnDocHistoryDiffStyle = 'split'
  @property({ type: Boolean, attribute: 'restore-disabled' }) restoreDisabled = false
  @property({ type: Boolean, attribute: 'show-close' }) showClose = true

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _rows(): Row[] {
    return [
      { id: 'live', kind: 'live', label: 'Live (now)', sublabel: 'unsaved working copy' },
      ...this.snapshots.map((snapshot) => ({
        id: snapshot.id,
        kind: snapshot.isManual ? 'manual' as const : 'auto' as const,
        label: snapshot.label || relativeTime(snapshot.createdAt),
        sublabel: absoluteTime(snapshot.createdAt),
        snapshot,
      })),
    ]
  }

  private _rowLabel(id: MnDocHistoryCursorId): string {
    if (id === 'live') return 'Live (now)'
    return this._rows().find((row) => row.id === id)?.label ?? id
  }

  private _setCursor(side: MnDocHistoryFocusedSide, id: MnDocHistoryCursorId): void {
    if (side === 'older' && id === 'live') return
    const detail: MnDocHistoryCursorDetail = {
      olderId: side === 'older' ? id : this.olderId,
      newerId: side === 'newer' ? id : this.newerId,
      focusedSide: side,
    }
    this._emit('mn-doc-history-cursor-change', detail)
  }

  private _selectRow(row: Row): void {
    this._setCursor(this.focusedSide, row.id)
  }

  private _focusSide(side: MnDocHistoryFocusedSide): void {
    this._emit<MnDocHistoryCursorDetail>('mn-doc-history-cursor-change', {
      olderId: this.olderId,
      newerId: this.newerId,
      focusedSide: side,
    })
  }

  private _saveCurrent(): void {
    this._emit('mn-doc-history-save-current', {})
  }

  private _bookmark(snapshotId: string, event: Event): void {
    event.stopPropagation()
    this._emit<MnDocHistorySnapshotDetail>('mn-doc-history-bookmark', { snapshotId })
  }

  private _delete(snapshotId: string, event: Event): void {
    event.stopPropagation()
    this._emit<MnDocHistorySnapshotDetail>('mn-doc-history-delete', { snapshotId })
  }

  private _restore(): void {
    if (!this.olderId || this.olderId === 'live' || this.restoreDisabled) return
    this._emit<MnDocHistoryRestoreDetail>('mn-doc-history-restore', { snapshotId: this.olderId })
  }

  private _refresh(): void {
    this._emit('mn-doc-history-refresh', {})
  }

  private _close(): void {
    this._emit('mn-doc-history-close', {})
  }

  private _setDiffStyle(diffStyle: MnDocHistoryDiffStyle): void {
    this._emit<{ diffStyle: MnDocHistoryDiffStyle }>('mn-doc-history-diff-style-change', { diffStyle })
  }

  private _renderRestoreButton(disabled: boolean): TemplateResult {
    if (disabled) {
      return html`
        <button type="button" class="restore-button" disabled>
          ${icon('rotate-ccw', { size: 14 })} Restore older
        </button>
      `
    }
    return html`
      <button type="button" class="restore-button" @click=${() => this._restore()}>
        ${icon('rotate-ccw', { size: 14 })} Restore older
      </button>
    `
  }

  private _renderRow(row: Row): TemplateResult {
    const isOlder = this.olderId === row.id
    const isNewer = this.newerId === row.id
    const cursor = [isOlder ? 'older' : '', isNewer ? 'newer' : ''].filter(Boolean).join(' ')
    const focused = (this.focusedSide === 'older' && isOlder) || (this.focusedSide === 'newer' && isNewer)
    return html`
      <div
        class=${classMap({ 'rail-row': true, 'live-row': row.kind === 'live' })}
        data-cursor=${cursor}
        data-focused=${focused ? 'true' : 'false'}
        role="option"
        tabindex="0"
        aria-selected=${focused ? 'true' : 'false'}
        @click=${() => this._selectRow(row)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          this._selectRow(row)
        }}
      >
        <span class="cursor-mark" aria-hidden="true">
          <span data-side="older" data-active=${isOlder ? 'true' : 'false'}>${isOlder ? '<' : ''}</span>
          <span data-side="newer" data-active=${isNewer ? 'true' : 'false'}>${isNewer ? '>' : ''}</span>
        </span>
        <span class="row-body">
          <span class="row-label">${row.kind === 'manual' ? 'Manual: ' : ''}${row.label}</span>
          <span class="row-sublabel">${row.sublabel}</span>
        </span>
        <span class="row-actions">
          ${row.snapshot ? html`<span class="tier">${tierBadge(row.snapshot.tier)}</span>` : nothing}
          ${row.snapshot ? html`
            <button
              type="button"
              class="icon-button"
              title="Bookmark snapshot"
              aria-label="Bookmark snapshot"
              @click=${(event: Event) => this._bookmark(row.snapshot!.id, event)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') this._bookmark(row.snapshot!.id, event)
              }}
            >${icon('bookmark', { size: 14 })}</button>
            <button
              type="button"
              class="icon-button"
              title="Delete snapshot"
              aria-label="Delete snapshot"
              @click=${(event: Event) => this._delete(row.snapshot!.id, event)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') this._delete(row.snapshot!.id, event)
              }}
            >${icon('trash', { size: 14 })}</button>
          ` : nothing}
        </span>
      </div>
    `
  }

  private _renderRail(): TemplateResult {
    const rows = this._rows()
    return html`
      <aside class="rail">
        <div class="rail-header">
          <span class="rail-title">Snapshots</span>
          <span class="cursor-summary">
            <b>Older:</b> ${this._rowLabel(this.olderId) || 'Select a snapshot'}<br>
            <b>Newer:</b> ${this._rowLabel(this.newerId) || 'Select a snapshot'}
          </span>
          <span>
            <button type="button" class="ghost-button" @click=${() => this._focusSide(this.focusedSide === 'older' ? 'newer' : 'older')}>
              Focus ${this.focusedSide === 'older' ? 'newer' : 'older'}
            </button>
            <button type="button" class="ghost-button" @click=${() => this._saveCurrent()}>
              ${icon('save', { size: 14 })} Save
            </button>
          </span>
        </div>
        <div class="rail-list" role="listbox" aria-label="Document snapshots">
          ${this.status === 'loading'
            ? html`<div class="status"><mn-loading size="sm" text="Loading history"></mn-loading></div>`
            : repeat(rows, (row) => row.id, (row) => this._renderRow(row))}
        </div>
      </aside>
    `
  }

  private _renderSplitDiff(lines: readonly MnDocHistoryDiffLine[]): TemplateResult {
    return html`
      <div class="diff-table">
        <div class="diff-side" aria-label="Older snapshot text">
          ${lines.map((line) => html`
            <div class="diff-line" data-kind=${line.kind === 'added' ? 'same' : line.kind}>
              <span class="line-no">${line.older === undefined ? '' : line.index}</span>
              <span class="line-text">${line.older ?? ''}</span>
            </div>
          `)}
        </div>
        <div class="diff-side" aria-label="Newer snapshot text">
          ${lines.map((line) => html`
            <div class="diff-line" data-kind=${line.kind === 'removed' ? 'same' : line.kind}>
              <span class="line-no">${line.newer === undefined ? '' : line.index}</span>
              <span class="line-text">${line.newer ?? ''}</span>
            </div>
          `)}
        </div>
      </div>
    `
  }

  private _renderUnifiedDiff(lines: readonly MnDocHistoryDiffLine[]): TemplateResult {
    return html`
      <div class="diff-unified" aria-label="Unified snapshot diff">
        ${lines.map((line) => {
          if (line.kind === 'same') {
            return html`<div class="diff-line" data-kind="same"><span class="line-no">${line.index}</span><span class="line-text"> ${line.older ?? ''}</span></div>`
          }
          if (line.kind === 'added') {
            return html`<div class="diff-line" data-kind="added"><span class="line-no">${line.index}</span><span class="line-text">+${line.newer ?? ''}</span></div>`
          }
          if (line.kind === 'removed') {
            return html`<div class="diff-line" data-kind="removed"><span class="line-no">${line.index}</span><span class="line-text">-${line.older ?? ''}</span></div>`
          }
          return html`
            <div class="diff-line" data-kind="removed"><span class="line-no">${line.index}</span><span class="line-text">-${line.older ?? ''}</span></div>
            <div class="diff-line" data-kind="added"><span class="line-no">${line.index}</span><span class="line-text">+${line.newer ?? ''}</span></div>
          `
        })}
      </div>
    `
  }

  private _renderDiff(): TemplateResult {
    if (!this.olderId) {
      return html`
        <div class="status">
          <mn-empty-state
            icon="clock"
            title="Select a snapshot"
            description="Choose an older snapshot to compare against the live document."
          ></mn-empty-state>
        </div>
      `
    }
    if (this.diffStatus === 'loading') {
      return html`<div class="status"><mn-loading text="Loading diff"></mn-loading></div>`
    }
    if (this.diffStatus === 'error') {
      return html`
        <div class="status">
          <mn-empty-state
            icon="alert-circle"
            title="Could not load diff"
            description=${this.diffError || 'The selected versions could not be read.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    const lines = diffHistoryLines(this.olderText, this.newerText)
    if (lines.every((line) => line.kind === 'same')) {
      return html`
        <div class="status">
          <mn-empty-state
            icon="file-text"
            title="No changes"
            description="These two versions have the same markdown text."
          ></mn-empty-state>
        </div>
      `
    }
    return this.diffStyle === 'unified' ? this._renderUnifiedDiff(lines) : this._renderSplitDiff(lines)
  }

  private _renderBody(): TemplateResult {
    if (this.status === 'error') {
      return html`
        <div class="body">
          ${this._renderRail()}
          <div class="status">
            <mn-empty-state
              icon="alert-circle"
              title="Could not load history"
              description=${this.error || 'The snapshot list could not be read.'}
              mood="danger"
            ></mn-empty-state>
          </div>
        </div>
      `
    }
    return html`
      <div class="body">
        ${this._renderRail()}
        <section class="diff-pane" aria-label="Snapshot comparison">
          <div class="diff-toolbar">
            <span class="pair-label">
              <span class="side-pill" data-side="older">${this._rowLabel(this.olderId) || 'Older'}</span>
              <span>vs</span>
              <span class="side-pill" data-side="newer">${this._rowLabel(this.newerId) || 'Newer'}</span>
            </span>
            <span class="spacer"></span>
            <button
              type="button"
              class="toggle-button"
              data-active=${this.diffStyle === 'split' ? 'true' : 'false'}
              @click=${() => this._setDiffStyle('split')}
            >Split</button>
            <button
              type="button"
              class="toggle-button"
              data-active=${this.diffStyle === 'unified' ? 'true' : 'false'}
              @click=${() => this._setDiffStyle('unified')}
            >Unified</button>
          </div>
          <div class="diff-host">${this._renderDiff()}</div>
        </section>
      </div>
    `
  }

  render(): TemplateResult {
    const restoreDisabled = !this.olderId || this.olderId === 'live' || this.restoreDisabled
    return html`
      <header class="header">
        <span class="title-wrap">
          <h2 class="title">${icon('clock', { size: 17 })}${this.title}</h2>
          <span class="subtitle">${this.subtitle || 'Compare snapshots against the live document'}</span>
        </span>
        <span class="spacer"></span>
        <button type="button" class="ghost-button" @click=${() => this._refresh()}>
          ${icon('refresh', { size: 14 })} Refresh
        </button>
        ${this.showClose
          ? html`<button type="button" class="icon-button" aria-label="Close history" @click=${() => this._close()}>${icon('x', { size: 16 })}</button>`
          : nothing}
      </header>
      <div class="body-host">${this._renderBody()}</div>
      <footer class="footer">
        <span class="hint">Restoring replaces the current document with the selected older snapshot. The shell owns confirmation and persistence.</span>
        <span class="footer-action">${this._renderRestoreButton(restoreDisabled)}</span>
      </footer>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-doc-history-panel': MnDocHistoryPanel
  }
}
