/**
 * REAL component tests for Garden daily-note micro-surfaces.
 *
 * These elements render date chrome and emit navigation/calendar intents; hosts
 * still own document lookup, calendar popovers, and editor mounting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import '../mn-daily-note-header.js'
import '../mn-daily-note-row.js'
import '../mn-month-popover.js'
import type {
  MnDailyNoteCalendarAnchorRequestDetail,
  MnDailyNoteHeader,
  MnDailyNoteOpenRequestDetail,
} from '../mn-daily-note-header.js'
import type { MnDailyNoteRow } from '../mn-daily-note-row.js'
import type { MnMonthPopover, MnMonthPopoverDateSelectDetail } from '../mn-month-popover.js'

async function mountHeader(setup?: (el: MnDailyNoteHeader) => void): Promise<MnDailyNoteHeader> {
  const el = document.createElement('mn-daily-note-header') as MnDailyNoteHeader
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountRow(setup?: (el: MnDailyNoteRow) => void): Promise<MnDailyNoteRow> {
  const el = document.createElement('mn-daily-note-row') as MnDailyNoteRow
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountMonth(setup?: (el: MnMonthPopover) => void): Promise<MnMonthPopover> {
  const el = document.createElement('mn-month-popover') as MnMonthPopover
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function openDetailsFrom(el: HTMLElement): MnDailyNoteOpenRequestDetail[] {
  const details: MnDailyNoteOpenRequestDetail[] = []
  el.addEventListener('daily-note-open-request', (event) => {
    details.push((event as CustomEvent<MnDailyNoteOpenRequestDetail>).detail)
  })
  return details
}

function calendarDetailsFrom(el: HTMLElement): MnDailyNoteCalendarAnchorRequestDetail[] {
  const details: MnDailyNoteCalendarAnchorRequestDetail[] = []
  el.addEventListener('daily-note-calendar-anchor-request', (event) => {
    details.push((event as CustomEvent<MnDailyNoteCalendarAnchorRequestDetail>).detail)
  })
  return details
}

function monthSelectDetailsFrom(el: HTMLElement): MnMonthPopoverDateSelectDetail[] {
  const details: MnMonthPopoverDateSelectDetail[] = []
  el.addEventListener('date-select', (event) => {
    details.push((event as CustomEvent<MnMonthPopoverDateSelectDetail>).detail)
  })
  return details
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-daily-note-header', () => {
  it('registers and formats today with an adjacency subcaption', async () => {
    const el = await mountHeader((node) => {
      node.dateKey = '2026-06-23'
      node.todayKey = '2026-06-23'
      node.adjacency = { before: 3, after: 2 }
      node.locale = 'en-US'
    })

    expect(customElements.get('mn-daily-note-header')).toBeDefined()
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Today · June 23, 2026')
    expect(el.shadowRoot!.querySelector('.subcaption')?.textContent).toContain('3 before')
    expect(el.shadowRoot!.querySelector('.subcaption')?.textContent).toContain('today')
    expect(el.shadowRoot!.querySelector('.subcaption')?.textContent).toContain('2 after')
  })

  it('formats non-today dates and hides empty adjacency', async () => {
    const el = await mountHeader((node) => {
      node.dateKey = '2026-06-24'
      node.todayKey = '2026-06-23'
      node.adjacency = { before: 0, after: 0 }
    })

    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Wednesday · June 24, 2026')
    expect(el.shadowRoot!.querySelector('.subcaption')).toBeNull()
  })

  it('emits previous, next, and calendar-anchor intents', async () => {
    const el = await mountHeader((node) => {
      node.dateKey = '2026-06-23'
      node.todayKey = '2026-06-23'
    })
    const opens = openDetailsFrom(el)
    const calendars = calendarDetailsFrom(el)
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>('mn-icon-button')]

    buttons[0].click()
    buttons[2].click()
    buttons[1].click()

    expect(opens).toEqual([{ dateKey: '2026-06-22' }, { dateKey: '2026-06-24' }])
    expect(calendars).toHaveLength(1)
    expect(calendars[0].anchor).toBe(buttons[1])
  })
})

describe('mn-daily-note-row', () => {
  it('registers and renders the empty today affordance', async () => {
    const el = await mountRow((node) => {
      node.displayedDate = '2026-06-23'
      node.todayKey = '2026-06-23'
      node.doc = null
    })
    const row = el.shadowRoot!.querySelector('.row')!

    expect(customElements.get('mn-daily-note-row')).toBeDefined()
    expect(row.classList.contains('is-today')).toBe(true)
    expect(row.classList.contains('is-empty')).toBe(true)
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Today, Tuesday · June 23')
    expect(el.shadowRoot!.querySelector('.placeholder')?.textContent).toBe('— begin today')
  })

  it('renders past/future classes, relative update text, and today escape', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-23T12:00:00Z').getTime())
    const el = await mountRow((node) => {
      node.displayedDate = '2026-06-22'
      node.todayKey = '2026-06-23'
      node.doc = { id: 'daily-note-2026-06-22', updatedAt: new Date('2026-06-23T10:00:00Z').getTime() }
    })
    const row = el.shadowRoot!.querySelector('.row')!

    expect(row.classList.contains('is-past')).toBe(true)
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Monday · June 22')
    expect(el.shadowRoot!.querySelector('.relative-time')?.textContent).toBe('2 hr ago')
    expect(el.shadowRoot!.querySelector('.today-link')?.textContent).toBe('← today')

    el.displayedDate = '2026-06-24'
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.row')?.classList.contains('is-future')).toBe(true)
  })

  it('emits row, keyboard, previous, next, today, and calendar intents', async () => {
    const el = await mountRow((node) => {
      node.displayedDate = '2026-06-24'
      node.todayKey = '2026-06-23'
      node.doc = { id: 'daily-note-2026-06-24' }
    })
    const opens = openDetailsFrom(el)
    const calendars = calendarDetailsFrom(el)
    const row = el.shadowRoot!.querySelector<HTMLElement>('.row')!
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>('mn-icon-button')]

    row.click()
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    buttons[0].click()
    buttons[1].click()
    el.shadowRoot!.querySelector<HTMLButtonElement>('.today-link')!.click()
    buttons[2].click()

    expect(opens).toEqual([
      { dateKey: '2026-06-24' },
      { dateKey: '2026-06-24' },
      { dateKey: '2026-06-23' },
      { dateKey: '2026-06-25' },
      { dateKey: '2026-06-23' },
    ])
    expect(calendars).toHaveLength(1)
    expect(calendars[0].anchor).toBe(buttons[2])
  })
})

describe('mn-month-popover', () => {
  it('registers and renders a six-week grid with today/viewed/note state', async () => {
    const el = await mountMonth((node) => {
      node.todayKey = '2026-06-23'
      node.viewedKey = '2026-06-23'
      node.datesWithNotes = new Set(['2026-06-21', '2026-06-23'])
      node.weekStart = 1
    })
    const cells = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.cell')]
    const today = cells.find(cell => cell.getAttribute('aria-label')?.includes('June 23, 2026'))!

    expect(customElements.get('mn-month-popover')).toBeDefined()
    // Layer-contract campaign: no internal open state (caller-mounted), so
    // "mounted" promotes to the native top layer immediately.
    const popover = el.shadowRoot!.querySelector('.popover')!
    expect(popover.hasAttribute('popover')).toBe(true)
    expect(popover.hasAttribute('popover-open')).toBe(true)
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toBe('June 2026')
    expect(cells).toHaveLength(42)
    expect(cells[0].textContent?.trim()).toBe('1')
    expect(today.classList.contains('today')).toBe(true)
    expect(today.classList.contains('viewed')).toBe(true)
    expect(today.querySelector('.has-note-dot')).not.toBeNull()
  })

  it('shifts months and keeps weekday ordering controlled by week-start', async () => {
    const el = await mountMonth((node) => {
      node.todayKey = '2026-06-23'
      node.viewedKey = '2026-06-23'
      node.weekStart = 0
    })
    const weekdays = [...el.shadowRoot!.querySelectorAll('.weekday')].map(node => node.textContent)
    expect(weekdays[0]).toBe('S')

    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>('mn-icon-button')]
    buttons[1].click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toBe('July 2026')

    buttons[0].click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toBe('June 2026')
  })

  it('emits date-select and mn-close when a day or back-to-today is selected', async () => {
    const el = await mountMonth((node) => {
      node.todayKey = '2026-06-23'
      node.viewedKey = '2026-06-20'
    })
    const selects = monthSelectDetailsFrom(el)
    const closes: Event[] = []
    el.addEventListener('mn-close', event => closes.push(event))

    const june24 = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.cell')]
      .find(cell => cell.getAttribute('aria-label')?.includes('June 24, 2026'))!
    june24.click()

    expect(selects).toEqual([{ dateKey: '2026-06-24' }])
    expect(closes).toHaveLength(1)

    el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.footer-link')[1]!.click()
    expect(selects.at(-1)).toEqual({ dateKey: '2026-06-23' })
  })

  it('emits close on Escape and supports the hidden date input escape hatch', async () => {
    const el = await mountMonth((node) => {
      node.todayKey = '2026-06-23'
      node.viewedKey = '2026-06-23'
    })
    const selects = monthSelectDetailsFrom(el)
    const closes: Event[] = []
    el.addEventListener('mn-close', event => closes.push(event))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closes).toHaveLength(1)

    const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="date"]')!
    input.value = '2026-07-04'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(selects).toEqual([{ dateKey: '2026-07-04' }])
    expect(closes).toHaveLength(2)
  })
})
