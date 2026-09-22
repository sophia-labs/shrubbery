/**
 * mn-daily-note-header -- Garden daily-note editor banner.
 *
 * Purely presentational: date state flows in, open/calendar intents flow out.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { addDaysToDateKey, parseDateKey } from './mn-daily-note-utils.js'
import './mn-icon-button.js'

export interface MnDailyNoteHeaderAdjacency {
  before: number
  after: number
}

export interface MnDailyNoteOpenRequestDetail {
  dateKey: string
}

export interface MnDailyNoteCalendarAnchorRequestDetail {
  anchor: HTMLElement
}

@customElement('mn-daily-note-header')
export class MnDailyNoteHeader extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .banner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-4, 16px) var(--mn-space-6, 24px) var(--mn-space-2, 8px);
    }

    .title-row {
      display: flex;
      align-items: center;
      max-width: 100%;
      gap: var(--mn-space-2, 8px);
    }

    .title {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-2xl, 24px);
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.2;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .calendar-trigger {
      display: inline-flex;
      opacity: 0.56;
      transition: opacity 120ms ease;
    }

    .calendar-trigger:hover,
    .title-row:hover .calendar-trigger {
      opacity: 1;
    }

    .subcaption {
      margin-top: 2px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 400;
      line-height: 1.3;
      text-align: center;
    }

    .subcaption .emphasis {
      color: var(--mn-color-text-secondary, #4b5563);
    }
  `

  @property({ type: String, attribute: 'date-key' }) dateKey = ''
  @property({ type: String, attribute: 'today-key' }) todayKey = ''
  @property({ attribute: false }) adjacency: MnDailyNoteHeaderAdjacency | null = null
  @property({ type: String }) locale = 'en-US'

  private get isToday(): boolean {
    return this.dateKey !== '' && this.dateKey === this.todayKey
  }

  private formatTitle(): string {
    if (!this.dateKey) return ''
    const date = parseDateKey(this.dateKey)
    if (!date) return this.dateKey
    const long = new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
    if (this.isToday) return `Today · ${long}`
    const weekday = new Intl.DateTimeFormat(this.locale, {
      timeZone: 'UTC',
      weekday: 'long',
    }).format(date)
    return `${weekday} · ${long}`
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

  private onPrev(event: Event): void {
    event.stopPropagation()
    this.dispatchOpen(addDaysToDateKey(this.dateKey, -1))
  }

  private onNext(event: Event): void {
    event.stopPropagation()
    this.dispatchOpen(addDaysToDateKey(this.dateKey, 1))
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

  private renderSubcaption() {
    if (!this.adjacency) return nothing
    const { before, after } = this.adjacency
    if (before === 0 && after === 0) return nothing
    const prefix = before > 0 ? `${before} before · ` : ''
    const suffix = after > 0 ? ` · ${after} after` : ''

    return html`
      <div class="subcaption">
        ${prefix}
        <span class="emphasis">${this.isToday ? 'today' : 'this day'}</span>
        ${suffix}
      </div>
    `
  }

  override render() {
    return html`
      <div class=${classMap({ banner: true, 'is-today': this.isToday })}>
        <div class="title-row">
          <mn-icon-button
            icon="arrow-left"
            label="Previous day"
            size="sm"
            @click=${this.onPrev}
          ></mn-icon-button>
          <span class="title">${this.formatTitle()}</span>
          <span class="calendar-trigger">
            <mn-icon-button
              icon="calendar-days"
              label="Jump to date"
              size="sm"
              @click=${this.onCalendar}
            ></mn-icon-button>
          </span>
          <mn-icon-button
            icon="arrow-right"
            label="Next day"
            size="sm"
            @click=${this.onNext}
          ></mn-icon-button>
        </div>
        ${this.renderSubcaption()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-daily-note-header': MnDailyNoteHeader
  }
}
