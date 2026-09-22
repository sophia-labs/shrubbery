/**
 * mn-timeline-rail - controlled snapshot cursor rail.
 *
 * Lifted from Garden's history timeline, with the selection math and events
 * retained but all snapshot IO left to the host.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnTimelineSnapshot {
  readonly snapshot_id: string
  readonly graph_id?: string
  readonly doc_id?: string
  readonly is_manual?: boolean
  readonly tier?: string
  readonly snapshot_count?: number
  readonly chars_added?: number
  readonly chars_removed?: number
  readonly blocks_added?: number
  readonly blocks_removed?: number
  readonly blocks_modified?: number
  readonly created_at: string
  readonly label?: string
}

export type MnTimelineCursorId = 'live' | string
export type MnTimelineFocusedSide = 'older' | 'newer'

export interface MnTimelineCursorDetail {
  readonly olderId: MnTimelineCursorId
  readonly newerId: MnTimelineCursorId
  readonly focusedSide: MnTimelineFocusedSide
}

export interface MnTimelineSnapshotDetail {
  readonly snapshotId: string
}

interface RailRow {
  readonly id: MnTimelineCursorId
  readonly kind: 'live' | 'manual' | 'auto'
  readonly label: string
  readonly sublabel: string
  readonly tier?: string
  readonly snapshot?: MnTimelineSnapshot
}

const TIER_BADGE: Record<string, string> = {
  '20min': '20m',
  '2h': '2h',
  '12h': '12h',
  daily: 'day',
  weekly: 'wk',
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

@customElement('mn-timeline-rail')
export class MnTimelineRail extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fafafa);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      box-sizing: border-box;
    }

    .rail-header {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
    }

    .rail-title {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .rail-cursor-summary {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .rail-cursor-summary b {
      color: var(--mn-color-text-primary, #111827);
    }

    .rail-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 28px;
      padding: 3px 8px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      cursor: pointer;
    }

    .action-button:hover {
      background: var(--mn-color-surface-hover, #eef2f0);
      color: var(--mn-color-text-primary, #111827);
    }

    .action-button:disabled {
      cursor: default;
      opacity: 0.45;
    }

    .rail-list {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 4px 0;
    }

    .rail-row {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
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

    .rail-row[data-cursor~='both'] {
      border-left-color: var(--mn-color-secondary-strong, #6366f1);
    }

    .rail-row[data-focused='true'] {
      outline: 2px solid var(--mn-color-border-focus, #2563eb);
      outline-offset: -2px;
    }

    .row-cursor {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: 10px;
      line-height: 1;
      text-align: center;
    }

    .row-cursor [data-active='true'][data-side='older'] {
      color: var(--mn-color-warning-strong, #b45309);
      font-weight: 800;
    }

    .row-cursor [data-active='true'][data-side='newer'] {
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
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }

    .row-sublabel {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: 11px;
    }

    .row-actions {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      opacity: 0.62;
    }

    .rail-row:hover .icon-button,
    .icon-button:hover,
    .icon-button:focus-visible {
      opacity: 1;
    }

    .icon-button:hover {
      background: var(--mn-color-surface-hover, #eef2f0);
      color: var(--mn-color-text-primary, #111827);
    }

    .icon-button[data-tone='danger']:hover {
      color: var(--mn-color-danger-strong, #b91c1c);
    }

    .tier-badge,
    .count-chip {
      display: inline-flex;
      align-items: center;
      height: 18px;
      padding: 0 5px;
      border-radius: var(--mn-radius-sm, 4px);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .tier-badge {
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-tertiary, #4b5563);
    }

    .count-chip {
      background: var(--mn-color-secondary-surface, #eef2ff);
      color: var(--mn-color-secondary-strong, #4338ca);
    }

    .star-mark {
      color: var(--mn-color-warning-strong, #b45309);
    }

    .empty {
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: center;
    }
  `

  @property({ attribute: false }) snapshots: readonly MnTimelineSnapshot[] = []
  @property({ type: String }) olderId: MnTimelineCursorId = ''
  @property({ type: String }) newerId: MnTimelineCursorId = 'live'
  @property({ type: String }) focusedSide: MnTimelineFocusedSide = 'older'
  @property({ type: Boolean }) loading = false

  @state() private _focusedRowId: MnTimelineCursorId | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.tabIndex = 0
    this.addEventListener('keydown', this._handleKeyDown)
  }

  disconnectedCallback(): void {
    this.removeEventListener('keydown', this._handleKeyDown)
    super.disconnectedCallback()
  }

  private _rows(): RailRow[] {
    return [
      {
        id: 'live',
        kind: 'live',
        label: 'Live (now)',
        sublabel: 'unsaved working copy',
      },
      ...this.snapshots.map((snapshot) => ({
        id: snapshot.snapshot_id,
        kind: snapshot.is_manual ? 'manual' as const : 'auto' as const,
        label: snapshot.label || relativeTime(snapshot.created_at),
        sublabel: absoluteTime(snapshot.created_at),
        tier: snapshot.tier,
        snapshot,
      })),
    ]
  }

  private _rowLabel(id: MnTimelineCursorId): string {
    return this._rows().find((row) => row.id === id)?.label ?? (id === 'live' ? 'Live (now)' : '—')
  }

  private _emitCursor(detail: MnTimelineCursorDetail): void {
    this.dispatchEvent(new CustomEvent<MnTimelineCursorDetail>('cursor-change', {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private _emitSnapshot(type: 'snapshot-bookmark' | 'snapshot-delete', snapshotId: string, event: Event): void {
    event.stopPropagation()
    this.dispatchEvent(new CustomEvent<MnTimelineSnapshotDetail>(type, {
      detail: { snapshotId },
      bubbles: true,
      composed: true,
    }))
  }

  private _validOlderFallback(rows: readonly RailRow[]): MnTimelineCursorId {
    return rows.find((row) => row.kind !== 'live')?.id ?? ''
  }

  private _normalizedCursor(
    rows: readonly RailRow[],
    olderId: MnTimelineCursorId,
    newerId: MnTimelineCursorId,
    focusedSide: MnTimelineFocusedSide,
  ): MnTimelineCursorDetail {
    const ids = new Set(rows.map((row) => row.id))
    let older = ids.has(olderId) ? olderId : this._validOlderFallback(rows)
    let newer = ids.has(newerId) ? newerId : 'live'
    if (older === 'live') older = this._validOlderFallback(rows)
    if (older && older === newer) {
      const fallback = rows.find((row) => row.kind !== 'live' && row.id !== newer)
      if (fallback) older = fallback.id
    }
    return { olderId: older, newerId: newer, focusedSide }
  }

  private _setCursor(side: MnTimelineFocusedSide, id: MnTimelineCursorId): void {
    if (side === 'older' && id === 'live') return
    const detail = this._normalizedCursor(
      this._rows(),
      side === 'older' ? id : this.olderId,
      side === 'newer' ? id : this.newerId,
      side,
    )
    this._focusedRowId = id
    this._emitCursor(detail)
  }

  private _focusOtherSide(): void {
    this._emitCursor({
      olderId: this.olderId,
      newerId: this.newerId,
      focusedSide: this.focusedSide === 'older' ? 'newer' : 'older',
    })
  }

  private _swapCursors(): void {
    if (this.newerId === 'live') return
    this._emitCursor({
      olderId: this.newerId,
      newerId: this.olderId,
      focusedSide: this.focusedSide,
    })
  }

  private _setNewerToLive(): void {
    this._emitCursor(this._normalizedCursor(this._rows(), this.olderId, 'live', this.focusedSide))
  }

  private _saveCurrent(): void {
    this.dispatchEvent(new CustomEvent('save-current', { bubbles: true, composed: true }))
  }

  private _handleKeyDown = (event: KeyboardEvent): void => {
    const rows = this._rows()
    if (!rows.length) return
    const focusedId = this._focusedRowId ?? (this.focusedSide === 'older' ? this.olderId : this.newerId)
    const currentIndex = Math.max(0, rows.findIndex((row) => row.id === focusedId))
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = Math.max(0, Math.min(rows.length - 1, currentIndex + delta))
      this._setCursor(this.focusedSide, rows[next].id)
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      this._focusOtherSide()
    } else if (event.key === '[' || event.key === ']') {
      event.preventDefault()
      const next = this._stepByTier(currentIndex, event.key === ']' ? 1 : -1, rows)
      this._setCursor(this.focusedSide, rows[next].id)
    }
  }

  private _stepByTier(fromIndex: number, dir: 1 | -1, rows: readonly RailRow[]): number {
    const startTier = rows[fromIndex]?.tier
    let index = fromIndex + dir
    while (index >= 0 && index < rows.length) {
      const row = rows[index]
      if (row.kind === 'live' || row.kind === 'manual') return index
      if (row.tier !== startTier) return index
      index += dir
    }
    return Math.max(0, Math.min(rows.length - 1, index - dir))
  }

  private _renderRow(row: RailRow): TemplateResult {
    const isOlder = this.olderId === row.id
    const isNewer = this.newerId === row.id
    const cursorMarks = [isOlder ? 'older' : '', isNewer ? 'newer' : '', isOlder && isNewer ? 'both' : '']
      .filter(Boolean)
      .join(' ')
    const focused = this._focusedRowId === row.id ||
      (this._focusedRowId === null && ((this.focusedSide === 'older' && isOlder) || (this.focusedSide === 'newer' && isNewer)))
    return html`
      <div
        class="rail-row"
        data-cursor=${cursorMarks}
        data-focused=${focused ? 'true' : 'false'}
        role="option"
        tabindex="0"
        aria-selected=${focused ? 'true' : 'false'}
        aria-label=${`${row.label} - ${row.sublabel}`}
        @click=${() => this._setCursor(this.focusedSide, row.id)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          this._setCursor(this.focusedSide, row.id)
        }}
      >
        <span class="row-cursor" aria-hidden="true">
          <span data-side="older" data-active=${isOlder ? 'true' : 'false'}>${isOlder ? '<' : ''}</span>
          <span data-side="newer" data-active=${isNewer ? 'true' : 'false'}>${isNewer ? '>' : ''}</span>
        </span>
        <span class="row-body">
          <span class="row-label">
            ${row.kind === 'manual' ? html`<span class="star-mark">*</span> ` : nothing}${row.label}
          </span>
          <span class="row-sublabel">${row.sublabel}</span>
        </span>
        <span class="row-actions">
          ${row.snapshot && (row.snapshot.snapshot_count ?? 0) > 1
            ? html`<span class="count-chip" title="Consolidates earlier auto-saves">${row.snapshot.snapshot_count}x</span>`
            : nothing}
          ${row.tier ? html`<span class="tier-badge">${TIER_BADGE[row.tier] ?? row.tier}</span>` : nothing}
          ${row.snapshot && !row.snapshot.is_manual ? html`
            <button
              type="button"
              class="icon-button"
              title="Save this version"
              aria-label="Save this version"
              @click=${(event: Event) => this._emitSnapshot('snapshot-bookmark', row.snapshot!.snapshot_id, event)}
            >${icon('bookmark', { size: 13 })}</button>
          ` : nothing}
          ${row.snapshot && row.snapshot.is_manual ? html`
            <button
              type="button"
              class="icon-button"
              data-tone="danger"
              title="Delete this saved version"
              aria-label="Delete this saved version"
              @click=${(event: Event) => this._emitSnapshot('snapshot-delete', row.snapshot!.snapshot_id, event)}
            >${icon('trash', { size: 13 })}</button>
          ` : nothing}
        </span>
      </div>
    `
  }

  render(): TemplateResult {
    const rows = this._rows()
    return html`
      <header class="rail-header">
        <span class="rail-title">Timeline</span>
        <div class="rail-cursor-summary">
          <b>&lt; Older:</b> ${this._rowLabel(this.olderId)}<br />
          <b>&gt; Newer:</b> ${this._rowLabel(this.newerId)}
        </div>
        <div class="rail-actions">
          <button type="button" class="action-button" ?disabled=${this.newerId === 'live'} @click=${() => this._swapCursors()}>
            ${icon('refresh', { size: 13 })} Swap
          </button>
          <button type="button" class="action-button" ?disabled=${this.newerId === 'live'} @click=${() => this._setNewerToLive()}>
            ${icon('zap', { size: 13 })} Use live
          </button>
          <button type="button" class="action-button" @click=${() => this._focusOtherSide()}>
            Focus ${this.focusedSide === 'older' ? 'newer' : 'older'}
          </button>
          <button type="button" class="action-button" @click=${() => this._saveCurrent()}>
            ${icon('save', { size: 13 })} Save now
          </button>
        </div>
      </header>
      <div class="rail-list" role="listbox" aria-label="Snapshot timeline" aria-busy=${this.loading ? 'true' : 'false'}>
        ${this.loading
          ? html`<div class="empty">Loading history...</div>`
          : rows.length > 1
            ? repeat(rows, (row) => row.id, (row) => this._renderRow(row))
            : html`<div class="empty">No saved versions yet.</div>`}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-timeline-rail': MnTimelineRail
  }
}
