/**
 * mn-calendar-event-specimen -- Garden calendar event block visual.
 *
 * This is UI-only. The editor kernel owns the calendarEvent atom and runtime
 * owns persistence/sync; this component renders the rich editable specimen and
 * emits small patch events.
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import './mn-badge.js'

export interface MnCalendarEventSpecimenAttrs {
  id: string
  timeStart: string | null
  timeEnd: string | null
  allDay: boolean
  title: string
  location: string
  annotation: string
  source: 'manual' | 'gcal'
  externalEventId: string | null
}

export type MnCalendarEventSpecimenChangeDetail = Partial<MnCalendarEventSpecimenAttrs>

export function defaultCalendarEventSpecimenAttrs(): MnCalendarEventSpecimenAttrs {
  return {
    id: '',
    timeStart: null,
    timeEnd: null,
    allDay: true,
    title: '',
    location: '',
    annotation: '',
    source: 'manual',
    externalEventId: null,
  }
}

function syncFieldContent(el: Element | null, value: string, focused: Element | null): void {
  if (!el || el === focused) return
  const span = el as HTMLElement
  if (span.textContent !== value) span.textContent = value
}

function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  )
}

@customElement('mn-calendar-event-specimen')
export class MnCalendarEventSpecimen extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
    }

    .specimen {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: baseline;
      column-gap: var(--mn-space-3, 12px);
      row-gap: 2px;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-left: 3px solid var(--mn-color-border-default, #9ca3af);
    }

    .specimen.source-gcal {
      border-left-color: var(--mn-color-border-accent, var(--mn-color-accent, #6366f1));
    }

    .time {
      margin: -1px -4px;
      padding: 1px 4px;
      border-radius: var(--mn-radius-sm, 3px);
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0;
      white-space: nowrap;
    }

    .time.all-day {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-sm, 13px);
    }

    .time:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .time[role='button']:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 1px;
    }

    .title {
      min-width: 0;
      min-height: 1em;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-base, 15px);
      font-weight: 500;
      outline: none;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title[contenteditable]:not([contenteditable='false']):empty::before {
      content: attr(data-placeholder);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-weight: 400;
      pointer-events: none;
    }

    .title[contenteditable]:not([contenteditable='false']):focus,
    .subline span[contenteditable]:not([contenteditable='false']):focus {
      margin: 0 -2px;
      padding: 0 2px;
      border-radius: var(--mn-radius-sm, 3px);
      background: var(--mn-color-surface-hover, #f9fafb);
    }

    .badge-slot {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
    }

    .subline {
      grid-column: 2 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
    }

    .subline .location,
    .subline .annotation {
      min-width: 0.5em;
      outline: none;
    }

    .subline .location[contenteditable]:not([contenteditable='false']):empty::before,
    .subline .annotation[contenteditable]:not([contenteditable='false']):empty::before {
      content: attr(data-placeholder);
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: normal;
      pointer-events: none;
    }

    .sep {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    .sep.hidden {
      visibility: hidden;
    }

    .time-editor {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin-top: var(--mn-space-1, 4px);
      padding: 6px 0 0;
      border-top: 1px dashed var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
    }

    .time-editor label {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      user-select: none;
    }

    .time-editor input[type='datetime-local'] {
      padding: 2px 6px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
    }

    .time-editor input[type='datetime-local']:focus {
      border-color: transparent;
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-accent, #6366f1));
      outline-offset: 1px;
    }

    .time-editor-done {
      margin-left: auto;
      padding: 2px 6px;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2563eb));
      cursor: pointer;
      font: inherit;
    }

    .time-editor-done:hover {
      background: var(--mn-color-surface-accent, #eef2ff);
    }
  `

  @property({ attribute: false }) attrs: MnCalendarEventSpecimenAttrs = defaultCalendarEventSpecimenAttrs()
  @property({ type: Boolean }) editable = true
  @property({ type: String }) locale = ''

  @state() private timeEditing = false

  protected override firstUpdated(): void {
    this.syncEditableContent()
    if (this.editable && !this.attrs.title.trim()) {
      requestAnimationFrame(() => this.focusTitle())
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('attrs')) this.syncEditableContent()
  }

  focusTitle(): void {
    const el = this.renderRoot?.querySelector<HTMLElement>('.title')
    el?.focus()
    if (!el || !window.getSelection || !document.createRange) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  private syncEditableContent(): void {
    const focused = (this.shadowRoot?.activeElement ?? null) as Element | null
    const root = this.renderRoot as ShadowRoot | HTMLElement
    syncFieldContent(root.querySelector('.title'), this.attrs.title, focused)
    syncFieldContent(root.querySelector('.location'), this.attrs.location, focused)
    syncFieldContent(root.querySelector('.annotation'), this.attrs.annotation, focused)
  }

  private emitChange(patch: MnCalendarEventSpecimenChangeDetail): void {
    this.dispatchEvent(
      new CustomEvent<MnCalendarEventSpecimenChangeDetail>('specimen-change', {
        detail: patch,
        bubbles: true,
        composed: true,
      }),
    )
  }

  private onTextFieldBlur(field: 'title' | 'location' | 'annotation', event: Event): void {
    const text = ((event.target as HTMLElement).innerText ?? (event.target as HTMLElement).textContent ?? '').trim()
    if (text !== this.attrs[field]) this.emitChange({ [field]: text })
  }

  private onTextFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      ;(event.target as HTMLElement).blur()
    } else if (event.key === 'Escape') {
      ;(event.target as HTMLElement).blur()
    }
  }

  private onTimeClick(): void {
    if (this.editable) this.timeEditing = true
  }

  private onAllDayChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked
    this.emitChange({
      allDay: checked,
      timeStart: checked ? null : this.attrs.timeStart,
      timeEnd: checked ? null : this.attrs.timeEnd,
    })
  }

  private onTimeStartChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value || null
    this.emitChange({ timeStart: value, allDay: value ? false : this.attrs.allDay })
  }

  private onTimeEndChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value || null
    this.emitChange({ timeEnd: value })
  }

  private formatTime(): string {
    const { allDay, timeStart, timeEnd } = this.attrs
    if (allDay || !timeStart) return this.editable ? 'All day' : '.'
    const start = parseLocalDateTime(timeStart)
    if (!start) return this.editable ? 'All day' : '.'
    const formatter = new Intl.DateTimeFormat(this.locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
    const startText = formatter.format(start)
    if (!timeEnd) return `${startText} ->`
    const end = parseLocalDateTime(timeEnd)
    if (!end) return `${startText} ->`
    return `${startText}-${formatter.format(end)}`
  }

  private renderTimeEditor() {
    return html`
      <div class="time-editor" @click=${(event: Event) => event.stopPropagation()}>
        <label>
          <input
            type="checkbox"
            .checked=${this.attrs.allDay}
            @change=${(event: Event) => this.onAllDayChange(event)}
          />
          All-day
        </label>
        ${this.attrs.allDay
          ? nothing
          : html`
              <input
                type="datetime-local"
                .value=${this.attrs.timeStart ?? ''}
                @change=${(event: Event) => this.onTimeStartChange(event)}
                aria-label="Start"
              />
              <span aria-hidden="true">-></span>
              <input
                type="datetime-local"
                .value=${this.attrs.timeEnd ?? ''}
                @change=${(event: Event) => this.onTimeEndChange(event)}
                aria-label="End"
              />
            `}
        <button class="time-editor-done" type="button" @click=${() => { this.timeEditing = false }}>
          Done
        </button>
      </div>
    `
  }

  override render() {
    const { allDay, annotation, id, location, source } = this.attrs
    const hasLocation = location.trim().length > 0
    const hasAnnotation = annotation.trim().length > 0
    const specimenClasses = {
      specimen: true,
      'source-gcal': source === 'gcal',
      'source-manual': source === 'manual',
    }

    return html`
      <div class=${classMap(specimenClasses)} data-block-id=${id || nothing}>
        <span
          class=${classMap({ time: true, 'all-day': allDay })}
          role=${this.editable ? 'button' : nothing}
          tabindex=${this.editable ? '0' : nothing}
          @click=${() => this.onTimeClick()}
          @keydown=${(event: KeyboardEvent) => {
            if (this.editable && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              this.onTimeClick()
            }
          }}
        >${this.formatTime()}</span>
        <span
          class="title"
          contenteditable=${this.editable ? 'plaintext-only' : 'false'}
          data-placeholder="Untitled event"
          @blur=${(event: Event) => this.onTextFieldBlur('title', event)}
          @keydown=${this.onTextFieldKeydown}
        ></span>
        <span class="badge-slot">
          ${source === 'gcal' ? html`<mn-badge variant="primary" size="sm" outline>GCAL</mn-badge>` : nothing}
        </span>

        ${this.editable || hasLocation || hasAnnotation
          ? html`
              <div class="subline">
                <span
                  class="location"
                  contenteditable=${this.editable ? 'plaintext-only' : 'false'}
                  data-placeholder="Location"
                  @blur=${(event: Event) => this.onTextFieldBlur('location', event)}
                  @keydown=${this.onTextFieldKeydown}
                ></span>
                <span class=${classMap({ sep: true, hidden: !(hasLocation && hasAnnotation) && !this.editable })}>-</span>
                <span
                  class="annotation"
                  contenteditable=${this.editable ? 'plaintext-only' : 'false'}
                  data-placeholder="Notes"
                  @blur=${(event: Event) => this.onTextFieldBlur('annotation', event)}
                  @keydown=${this.onTextFieldKeydown}
                ></span>
              </div>
            `
          : nothing}

        ${this.timeEditing && this.editable ? this.renderTimeEditor() : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-calendar-event-specimen': MnCalendarEventSpecimen
  }
}
