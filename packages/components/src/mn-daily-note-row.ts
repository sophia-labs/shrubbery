/**
 * mn-daily-note-row -- Garden daily-note home row.
 *
 * Purely presentational: hosts provide the displayed date/document and receive
 * open/calendar intents. No store, backend, session, or editor imports.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { addDaysToDateKey, parseDateKey, relativeTime } from './mn-daily-note-utils.js'
import './mn-icon-button.js'
import type {
  MnDailyNoteCalendarAnchorRequestDetail,
  MnDailyNoteOpenRequestDetail,
} from './mn-daily-note-header.js'

export interface MnDailyNoteRowDoc {
  id: string
  updatedAt?: number
}

@customElement('mn-daily-note-row')
export class MnDailyNoteRow extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      width: 100%;
      max-width: 500px;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-left: 2px solid transparent;
      border-radius: var(--mn-radius-md, 6px);
      cursor: pointer;
      outline: none;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
    }

    .row:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .row:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }

    .row.is-past {
      border-left-color: var(--mn-color-border-subtle, #d1d5db);
    }

    .row.is-future {
      border-left-color: var(--mn-color-border-accent, #6366f1);
    }

    .leading-icon {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #6366f1));
      line-height: 0;
    }

    .row.is-empty .leading-icon {
      color: var(--mn-color-text-tertiary, #9ca3af);
    }

    .title {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #4f46e5));
      font-family: var(--mn-font-prose, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row.is-past .title,
    .row.is-future .title,
    .row.is-empty .title {
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .placeholder {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-family: var(--mn-font-prose, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
      white-space: nowrap;
    }

    .spacer {
      flex: 1 1 auto;
      min-width: var(--mn-space-2, 8px);
    }

    .relative-time {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .controls {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 2px;
    }

    .controls-prev-next {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity var(--mn-transition-fast, 120ms ease);
    }

    .row:hover .controls-prev-next,
    .row:focus-within .controls-prev-next {
      opacity: 1;
    }

    @media (hover: none) {
      .controls-prev-next {
        display: none;
      }
    }

    .calendar-trigger {
      display: inline-flex;
      opacity: 0.62;
      transition: opacity var(--mn-transition-fast, 120ms ease);
    }

    .calendar-trigger:hover {
      opacity: 1;
    }

    .today-link {
      flex: 0 0 auto;
      padding: 0 4px;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0;
      line-height: 20px;
      text-decoration: none;
      white-space: nowrap;
    }

    .today-link:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #4f46e5));
    }

    .today-link:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }
  `

  @property({ type: String, attribute: 'displayed-date' }) displayedDate = ''
  @property({ type: String, attribute: 'today-key' }) todayKey = ''
  @property({ attribute: false }) doc: MnDailyNoteRowDoc | null = null
  @property({ type: String }) locale = 'en-US'

  private get isToday(): boolean {
    return this.displayedDate !== '' && this.displayedDate === this.todayKey
  }

  private get isPast(): boolean {
    return this.displayedDate !== '' && this.todayKey !== '' && !this.isToday && this.displayedDate < this.todayKey
  }

  private get isFuture(): boolean {
    return this.displayedDate !== '' && this.todayKey !== '' && !this.isToday && this.displayedDate > this.todayKey
  }

  private get isEmpty(): boolean {
    return this.isToday && this.doc === null
  }

  private formatTitle(): string {
    if (!this.displayedDate) return ''
    const date = parseDateKey(this.displayedDate)
    if (!date) return this.displayedDate
    const weekday = new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      weekday: 'long',
    }).format(date)
    const monthDay = new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      month: 'long',
      day: 'numeric',
    }).format(date)
    return this.isToday ? `Today, ${weekday} · ${monthDay}` : `${weekday} · ${monthDay}`
  }

  private dispatchOpen(dateKey: string): void {
    this.dispatchEvent(
      new CustomEvent<MnDailyNoteOpenRequestDetail>('daily-note-open-request', {
        detail: { dateKey },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private onRowClick(): void {
    this.dispatchOpen(this.displayedDate)
  }

  private onPrev(event: Event): void {
    event.stopPropagation()
    this.dispatchOpen(addDaysToDateKey(this.displayedDate, -1))
  }

  private onNext(event: Event): void {
    event.stopPropagation()
    this.dispatchOpen(addDaysToDateKey(this.displayedDate, 1))
  }

  private onCalendar(event: Event): void {
    event.stopPropagation()
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : this
    this.dispatchEvent(
      new CustomEvent<MnDailyNoteCalendarAnchorRequestDetail>('daily-note-calendar-anchor-request', {
        detail: { anchor },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private onBackToToday(event: Event): void {
    event.stopPropagation()
    this.dispatchOpen(this.todayKey)
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.dispatchOpen(this.displayedDate)
  }

  override render() {
    const classes = {
      row: true,
      'is-today': this.isToday,
      'is-past': this.isPast,
      'is-future': this.isFuture,
      'is-empty': this.isEmpty,
    }

    return html`
      <div
        class=${classMap(classes)}
        role="button"
        tabindex="0"
        @click=${this.onRowClick}
        @keydown=${this.onKeydown}
      >
        <span class="leading-icon">${icon('calendar-days', { size: 16 })}</span>
        <span class="title">${this.formatTitle()}</span>
        <span class="spacer"></span>
        ${this.isEmpty
          ? html`<span class="placeholder">— begin today</span>`
          : this.doc?.updatedAt
            ? html`<span class="relative-time">${relativeTime(this.doc.updatedAt)}</span>`
            : nothing}
        <span class="controls">
          <span class="controls-prev-next">
            <mn-icon-button
              icon="chevron-left"
              label="Previous day"
              size="xs"
              @click=${this.onPrev}
            ></mn-icon-button>
            <mn-icon-button
              icon="chevron-right"
              label="Next day"
              size="xs"
              @click=${this.onNext}
            ></mn-icon-button>
          </span>
          <span class="calendar-trigger">
            <mn-icon-button
              icon="calendar"
              label="Jump to date"
              size="xs"
              @click=${this.onCalendar}
            ></mn-icon-button>
          </span>
          ${!this.isToday
            ? html`<button class="today-link" type="button" @click=${this.onBackToToday}>← today</button>`
            : nothing}
        </span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-daily-note-row': MnDailyNoteRow
  }
}
