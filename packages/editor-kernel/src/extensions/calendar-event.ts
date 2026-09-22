/**
 * CalendarEvent block atom.
 *
 * Garden renders this through a Lit <mn-calendar-event-specimen> NodeView with
 * inline editing controls. The kernel keeps the document structure pure:
 * schema attrs, parse/render, and an insert command only. Host-owned UI can
 * layer richer editing back on top without importing Lit/components here.
 */
import { Node, mergeAttributes } from '@tiptap/core'

export interface CalendarEventAttrs {
  /** Client-stable identifier. Wires attach here; also rendered as data-block-id. */
  id: string
  /** ISO datetime-local strings ("YYYY-MM-DDTHH:mm"). Null means unset. */
  timeStart: string | null
  timeEnd: string | null
  allDay: boolean
  title: string
  location: string
  annotation: string
  source: 'manual' | 'gcal'
  externalEventId: string | null
}

export function defaultCalendarEventAttrs(): CalendarEventAttrs {
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

function readStringAttr(el: HTMLElement, name: string, fallback: string): string {
  return el.getAttribute(name) ?? el.getAttribute(`data-${name}`) ?? fallback
}

function readOptionalStringAttr(el: HTMLElement, name: string): string | null {
  const value = el.getAttribute(name) ?? el.getAttribute(`data-${name}`)
  return value && value.length > 0 ? value : null
}

function readBooleanAttr(el: HTMLElement, camelName: string, kebabName: string, fallback: boolean): boolean {
  const raw =
    el.getAttribute(camelName) ??
    el.getAttribute(kebabName) ??
    el.getAttribute(`data-${camelName}`) ??
    el.getAttribute(`data-${kebabName}`)
  if (raw === null) return fallback
  return raw === 'true' || raw === ''
}

function generateCalendarEventId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `calendar-${uuid.slice(0, 8)}`
}

function normalizeAttrs(attrs: Partial<CalendarEventAttrs> = {}): CalendarEventAttrs {
  const defaults = defaultCalendarEventAttrs()
  const source = attrs.source === 'gcal' ? 'gcal' : 'manual'
  const id = typeof attrs.id === 'string' && attrs.id.trim() ? attrs.id.trim() : generateCalendarEventId()
  return {
    ...defaults,
    ...attrs,
    id,
    allDay: attrs.allDay ?? defaults.allDay,
    source,
    timeStart: attrs.timeStart || null,
    timeEnd: attrs.timeEnd || null,
    externalEventId: attrs.externalEventId || null,
  }
}

function compactDateTime(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace('T', ' ')
}

function eventTimeLabel(attrs: CalendarEventAttrs): string {
  if (attrs.allDay) return 'All day'
  const start = compactDateTime(attrs.timeStart)
  const end = compactDateTime(attrs.timeEnd)
  if (start && end) return `${start} - ${end}`
  return start || end || 'Time unset'
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    calendarEvent: {
      insertCalendarEvent: (attrs?: Partial<CalendarEventAttrs>) => ReturnType
    }
  }
}

export const CalendarEvent = Node.create({
  name: 'calendarEvent',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const d = defaultCalendarEventAttrs()
    return {
      id: {
        default: d.id,
        parseHTML: (el: HTMLElement) => readStringAttr(el, 'id', d.id),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.id ? { id: attrs.id, 'data-block-id': attrs.id } : {},
      },
      timeStart: {
        default: d.timeStart,
        parseHTML: (el: HTMLElement) =>
          readOptionalStringAttr(el, 'timeStart') ?? readOptionalStringAttr(el, 'time-start'),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.timeStart ? { timeStart: attrs.timeStart } : {},
      },
      timeEnd: {
        default: d.timeEnd,
        parseHTML: (el: HTMLElement) =>
          readOptionalStringAttr(el, 'timeEnd') ?? readOptionalStringAttr(el, 'time-end'),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.timeEnd ? { timeEnd: attrs.timeEnd } : {},
      },
      allDay: {
        default: d.allDay,
        parseHTML: (el: HTMLElement) => readBooleanAttr(el, 'allDay', 'all-day', d.allDay),
        renderHTML: (attrs: CalendarEventAttrs) => ({ allDay: String(attrs.allDay) }),
      },
      title: {
        default: d.title,
        parseHTML: (el: HTMLElement) => readStringAttr(el, 'title', d.title),
        renderHTML: (attrs: CalendarEventAttrs) => (attrs.title ? { title: attrs.title } : {}),
      },
      location: {
        default: d.location,
        parseHTML: (el: HTMLElement) => readStringAttr(el, 'location', d.location),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.location ? { location: attrs.location } : {},
      },
      annotation: {
        default: d.annotation,
        parseHTML: (el: HTMLElement) => readStringAttr(el, 'annotation', d.annotation),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.annotation ? { annotation: attrs.annotation } : {},
      },
      source: {
        default: d.source,
        parseHTML: (el: HTMLElement) => {
          const raw = readStringAttr(el, 'source', d.source)
          return raw === 'gcal' ? 'gcal' : 'manual'
        },
        renderHTML: (attrs: CalendarEventAttrs) => ({ source: attrs.source }),
      },
      externalEventId: {
        default: d.externalEventId,
        parseHTML: (el: HTMLElement) =>
          readOptionalStringAttr(el, 'externalEventId') ??
          readOptionalStringAttr(el, 'external-event-id'),
        renderHTML: (attrs: CalendarEventAttrs) =>
          attrs.externalEventId ? { externalEventId: attrs.externalEventId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'mn-calendar-event' }, { tag: 'div[data-calendar-event]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = normalizeAttrs(node.attrs as Partial<CalendarEventAttrs>)
    const title = attrs.title || 'Untitled event'
    const details = [attrs.location, attrs.annotation].filter(Boolean).join(' - ')
    return [
      'mn-calendar-event',
      mergeAttributes(HTMLAttributes, {
        'data-calendar-event': '',
        class: 'calendar-event-block',
        contenteditable: 'false',
      }),
      ['span', { class: 'calendar-event-time' }, eventTimeLabel(attrs)],
      ['span', { class: 'calendar-event-title' }, title],
      ...(details ? [['span', { class: 'calendar-event-details' }, details]] : []),
    ]
  },

  addCommands() {
    return {
      insertCalendarEvent:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: normalizeAttrs(attrs),
          }),
    }
  },
})

export default CalendarEvent
