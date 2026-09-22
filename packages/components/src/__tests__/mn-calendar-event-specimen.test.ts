/**
 * REAL component tests for Garden calendar event specimen.
 *
 * The component owns UI/edit affordances only. It emits partial patch events;
 * editor transactions and calendar sync remain host concerns.
 */
import { afterEach, describe, expect, it } from 'vitest'
import '../mn-calendar-event-specimen.js'
import type {
  MnCalendarEventSpecimen,
  MnCalendarEventSpecimenAttrs,
  MnCalendarEventSpecimenChangeDetail,
} from '../mn-calendar-event-specimen.js'

const baseEvent: MnCalendarEventSpecimenAttrs = {
  id: 'event-a',
  timeStart: '2026-06-23T14:00',
  timeEnd: '2026-06-23T15:30',
  allDay: false,
  title: 'Garden parity review',
  location: 'Studio',
  annotation: 'Check event atoms.',
  source: 'gcal',
  externalEventId: 'gcal-a',
}

async function mount(
  setup?: (el: MnCalendarEventSpecimen) => void,
): Promise<MnCalendarEventSpecimen> {
  const el = document.createElement('mn-calendar-event-specimen') as MnCalendarEventSpecimen
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  return el
}

function changesFrom(el: MnCalendarEventSpecimen): MnCalendarEventSpecimenChangeDetail[] {
  const changes: MnCalendarEventSpecimenChangeDetail[] = []
  el.addEventListener('specimen-change', (event) => {
    changes.push((event as CustomEvent<MnCalendarEventSpecimenChangeDetail>).detail)
  })
  return changes
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('mn-calendar-event-specimen', () => {
  it('registers and renders time, editable fields, source badge, and block id', async () => {
    const el = await mount((node) => {
      node.attrs = baseEvent
      node.locale = 'en-US'
    })

    expect(customElements.get('mn-calendar-event-specimen')).toBeDefined()
    expect(el.shadowRoot!.querySelector('.specimen')?.getAttribute('data-block-id')).toBe('event-a')
    expect(el.shadowRoot!.querySelector('.specimen')?.classList.contains('source-gcal')).toBe(true)
    expect(el.shadowRoot!.querySelector('.time')?.textContent).toContain('02:00')
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Garden parity review')
    expect(el.shadowRoot!.querySelector('.location')?.textContent).toBe('Studio')
    expect(el.shadowRoot!.querySelector('.annotation')?.textContent).toBe('Check event atoms.')
    expect(el.shadowRoot!.querySelector('mn-badge')?.textContent?.trim()).toBe('GCAL')
  })

  it('renders read-only all-day specimens quietly without edit-only subline', async () => {
    const el = await mount((node) => {
      node.editable = false
      node.attrs = {
        ...baseEvent,
        allDay: true,
        timeStart: null,
        timeEnd: null,
        location: '',
        annotation: '',
        source: 'manual',
      }
    })

    expect(el.shadowRoot!.querySelector('.time')?.textContent).toBe('.')
    expect(el.shadowRoot!.querySelector('.time')?.getAttribute('role')).toBeNull()
    expect(el.shadowRoot!.querySelector('.subline')).toBeNull()
    expect(el.shadowRoot!.querySelector('mn-badge')).toBeNull()
  })

  it('emits text-field patch changes on blur', async () => {
    const el = await mount((node) => {
      node.attrs = baseEvent
    })
    const changes = changesFrom(el)
    const title = el.shadowRoot!.querySelector<HTMLElement>('.title')!
    const location = el.shadowRoot!.querySelector<HTMLElement>('.location')!

    title.textContent = 'Updated review'
    title.dispatchEvent(new FocusEvent('blur'))
    location.textContent = 'Library'
    location.dispatchEvent(new FocusEvent('blur'))

    expect(changes).toEqual([{ title: 'Updated review' }, { location: 'Library' }])
  })

  it('opens the time editor and emits all-day/start/end patch changes', async () => {
    const el = await mount((node) => {
      node.attrs = baseEvent
    })
    const changes = changesFrom(el)
    el.shadowRoot!.querySelector<HTMLElement>('.time')!.click()
    await el.updateComplete

    const editor = el.shadowRoot!.querySelector('.time-editor')
    expect(editor).not.toBeNull()

    const allDay = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    allDay.checked = true
    allDay.dispatchEvent(new Event('change'))

    const inputs = [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')]
    inputs[0].value = '2026-06-23T16:00'
    inputs[0].dispatchEvent(new Event('change'))
    inputs[1].value = '2026-06-23T16:30'
    inputs[1].dispatchEvent(new Event('change'))

    expect(changes).toEqual([
      { allDay: true, timeStart: null, timeEnd: null },
      { timeStart: '2026-06-23T16:00', allDay: false },
      { timeEnd: '2026-06-23T16:30' },
    ])
  })

  it('hides the time editor when Done is clicked', async () => {
    const el = await mount((node) => {
      node.attrs = baseEvent
    })
    el.shadowRoot!.querySelector<HTMLElement>('.time')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.time-editor')).not.toBeNull()

    el.shadowRoot!.querySelector<HTMLButtonElement>('.time-editor-done')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.time-editor')).toBeNull()
  })
})
