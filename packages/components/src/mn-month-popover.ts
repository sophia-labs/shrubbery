/**
 * mn-month-popover -- Garden daily-note calendar jump popover.
 *
 * Purely presentational: callers provide anchor coordinates, the viewed/today
 * keys, and the set of dates with notes. Selection and close are emitted.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import {
  addDays,
  daysInMonthGrid,
  isSameDay,
  isSameMonth,
  parseDateKey,
  startOfMonth,
  toDateKey,
} from './mn-daily-note-utils.js'
import { hidePopover, showPopover } from './popover.js'
import './mn-icon-button.js'

export interface MnMonthPopoverDateSelectDetail {
  dateKey: string
}

function todayKeyFallback(): string {
  const d = new Date()
  return toDateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())))
}

function parseDateKeyFallback(dateKey: string): Date {
  return parseDateKey(dateKey) ?? parseDateKey(todayKeyFallback())!
}

@customElement('mn-month-popover')
export class MnMonthPopover extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .popover {
      position: fixed;
      inset: unset;
      margin: 0;
      z-index: var(--mn-z-popover, 1100);
      box-sizing: border-box;
      width: 300px;
      padding: var(--mn-space-4, 16px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff));
      box-shadow: var(--mn-shadow-raised, 0 8px 24px rgba(15, 23, 42, 0.16));
      animation: mn-month-popover-fade-in 120ms ease-out;
    }

    [popover]:not([popover-open]):not(:popover-open) {
      display: none;
    }

    @keyframes mn-month-popover-fade-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
    }

    .month-label {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-lg, 18px);
      font-weight: 500;
      letter-spacing: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-controls {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 2px;
    }

    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px;
      margin-bottom: var(--mn-space-1, 4px);
    }

    .weekday {
      padding: 2px 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 500;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px;
    }

    .cell {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 34px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 400;
      line-height: 1;
      transition: background 120ms ease;
    }

    .cell:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .cell:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: -2px;
    }

    .cell.outside {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    .cell.viewed {
      background: var(--mn-color-surface-selected, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      font-weight: 500;
    }

    .cell.today {
      background: var(--mn-color-interactive-selected, #eef2ff);
      color: var(--mn-color-text-accent, var(--mn-color-accent, #4f46e5));
      font-weight: 500;
      box-shadow: inset 0 0 0 1px var(--mn-color-border-accent, #6366f1);
    }

    .cell.today.viewed {
      box-shadow: inset 0 0 0 1.5px var(--mn-color-border-accent, #6366f1);
    }

    .has-note-dot {
      width: 3px;
      height: 3px;
      margin-top: 2px;
      border-radius: 999px;
      background: var(--mn-color-border-accent, var(--mn-color-accent, #6366f1));
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-top: var(--mn-space-3, 12px);
      padding-top: var(--mn-space-2, 8px);
      border-top: 1px dashed var(--mn-color-border-subtle, #e5e7eb);
    }

    .footer-link {
      padding: 2px 4px;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0;
      white-space: nowrap;
    }

    .footer-link:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #4f46e5));
    }

    .footer-link:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 2px;
    }

    .date-input-host {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
  `

  @property({ type: Number }) x = 0
  @property({ type: Number }) y = 0
  @property({ type: String, attribute: 'today-key' }) todayKey = ''
  @property({ type: String, attribute: 'viewed-key' }) viewedKey = ''
  @property({ attribute: false }) datesWithNotes: Set<string> = new Set()
  @property({ type: Number, attribute: 'week-start' }) weekStart: 0 | 1 = 1
  @property({ type: String }) locale = 'en-US'

  @state() private displayedMonthKey = ''

  @query('.popover') private popoverEl?: HTMLElement

  override connectedCallback(): void {
    super.connectedCallback()
    this.initializeDisplayedMonth()
    document.addEventListener('keydown', this.onGlobalKeydown)
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', this.onOutsidePointerDown, true)
    })
    // Promotes `.popover` to the native top layer (Popover API) so it
    // escapes the editor/daily-note stacking context it mounts in — see the
    // layer-contract campaign diagnosis. This component has no internal
    // `open` state (it is caller-mounted/-unmounted, position owned by the
    // caller's x/y props), so "mounted" is treated as "open": promote on
    // EVERY connection, once the pending render has settled `.popover` into
    // the shadow DOM (not just firstUpdated(), which fires once per
    // instance and would leave a disconnected-then-reinserted popover
    // permanently hidden — disconnectedCallback below hides it on every
    // disconnect, so the show has to be equally symmetric). The isConnected
    // guard drops a stale promotion if the element was disconnected again
    // before this microtask ran.
    void this.updateComplete.then(() => {
      if (this.isConnected && this.popoverEl) showPopover(this.popoverEl)
    })
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    document.removeEventListener('keydown', this.onGlobalKeydown)
    document.removeEventListener('pointerdown', this.onOutsidePointerDown, true)
    if (this.popoverEl) hidePopover(this.popoverEl)
  }

  private initializeDisplayedMonth(): void {
    const key = this.viewedKey || this.todayKey || todayKeyFallback()
    this.displayedMonthKey = toDateKey(startOfMonth(parseDateKeyFallback(key)))
  }

  private onGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  private onOutsidePointerDown = (event: PointerEvent): void => {
    const path = event.composedPath()
    if (!path.includes(this)) this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private shiftMonth(delta: number): void {
    const current = parseDateKeyFallback(this.displayedMonthKey)
    const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + delta, 1))
    this.displayedMonthKey = toDateKey(next)
  }

  private selectDate(dateKey: string): void {
    this.dispatchEvent(
      new CustomEvent<MnMonthPopoverDateSelectDetail>('date-select', {
        detail: { dateKey },
        bubbles: true,
        composed: true,
      }),
    )
    this.close()
  }

  private onDateInputChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value
    if (value) this.selectDate(value)
  }

  private openJumpInput(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[type="date"]')
    if (!input) return
    const picker = input as HTMLInputElement & { showPicker?: () => void }
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker()
        return
      } catch {
        // Fallback below.
      }
    }
    input.focus()
    input.click()
  }

  private weekdayLabels(): string[] {
    const sunday = parseDateKeyFallback('2026-01-04')
    const labels: string[] = []
    for (let i = 0; i < 7; i++) {
      const day = addDays(sunday, (i + this.weekStart) % 7)
      labels.push(new Intl.DateTimeFormat(this.locale, { timeZone: 'UTC', weekday: 'narrow' }).format(day))
    }
    return labels
  }

  private monthLabel(): string {
    return new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
    }).format(parseDateKeyFallback(this.displayedMonthKey))
  }

  private cellAriaLabel(date: Date, isToday: boolean, hasNote: boolean): string {
    const label = new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
    return `${label}${isToday ? ', today' : ''}${hasNote ? ', has note' : ''}`
  }

  override render() {
    if (!this.displayedMonthKey) return nothing

    const displayedMonth = parseDateKeyFallback(this.displayedMonthKey)
    const todayDate = this.todayKey ? parseDateKey(this.todayKey) : null
    const viewedDate = this.viewedKey ? parseDateKey(this.viewedKey) : null
    const cells = daysInMonthGrid(displayedMonth, this.weekStart)
    const labels = this.weekdayLabels()
    const hideBackToToday = this.viewedKey === this.todayKey

    return html`
      <div
        class="popover"
        popover="manual"
        role="dialog"
        aria-label="Calendar"
        style=${`left: ${this.x}px; top: ${this.y}px;`}
      >
        <div class="header">
          <span class="month-label">${this.monthLabel()}</span>
          <span class="header-controls">
            <mn-icon-button
              icon="chevron-left"
              label="Previous month"
              size="xs"
              @click=${() => this.shiftMonth(-1)}
            ></mn-icon-button>
            <mn-icon-button
              icon="chevron-right"
              label="Next month"
              size="xs"
              @click=${() => this.shiftMonth(1)}
            ></mn-icon-button>
          </span>
        </div>

        <div class="weekdays" aria-hidden="true">
          ${labels.map(label => html`<span class="weekday">${label}</span>`)}
        </div>

        <div class="grid" role="grid">
          ${cells.map((date) => {
            const inMonth = isSameMonth(date, displayedMonth)
            const isToday = todayDate ? isSameDay(date, todayDate) : false
            const isViewed = viewedDate ? isSameDay(date, viewedDate) : false
            const key = toDateKey(date)
            const hasNote = this.datesWithNotes.has(key)
            const classes = {
              cell: true,
              outside: !inMonth,
              today: isToday,
              viewed: isViewed,
            }
            return html`
              <button
                class=${classMap(classes)}
                type="button"
                role="gridcell"
                aria-label=${this.cellAriaLabel(date, isToday, hasNote)}
                aria-current=${isToday ? 'date' : 'false'}
                aria-selected=${isViewed ? 'true' : 'false'}
                @click=${() => this.selectDate(key)}
              >
                ${date.getUTCDate()}
                ${hasNote ? html`<span class="has-note-dot" aria-hidden="true"></span>` : nothing}
              </button>
            `
          })}
        </div>

        <div class="footer">
          <button class="footer-link" type="button" @click=${this.openJumpInput}>Jump to date...</button>
          ${hideBackToToday
            ? html`<span></span>`
            : html`<button class="footer-link" type="button" @click=${() => this.selectDate(this.todayKey)}>
                Back to today
              </button>`}
        </div>

        <span class="date-input-host">
          <input type="date" .value=${this.todayKey} @change=${this.onDateInputChange} />
        </span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-month-popover': MnMonthPopover
  }
}
