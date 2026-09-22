/**
 * REAL component test — Garden daily-note calendar jump popover.
 *
 * NO MOCKS: mounts the real custom element into a real (happy-dom) DOM.
 * Covers baseline rendering plus the layer-contract campaign's top-layer
 * promotion, including the remove/reinsert lifecycle (regression r1 —
 * mn-month-popover previously promoted only in firstUpdated(), which fires
 * once per instance, so a disconnect+reconnect left the popover hidden
 * permanently).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-month-popover.js'
import type { MnMonthPopover, MnMonthPopoverDateSelectDetail } from '../mn-month-popover.js'

async function mount(setup?: (el: MnMonthPopover) => void): Promise<MnMonthPopover> {
  const el = document.createElement('mn-month-popover') as MnMonthPopover
  el.todayKey = '2026-07-15'
  el.viewedKey = '2026-07-15'
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function isOpen(el: MnMonthPopover): boolean {
  const popoverEl = el.shadowRoot!.querySelector('.popover') as HTMLElement | null
  if (!popoverEl) return false
  try {
    if (popoverEl.matches(':popover-open')) return true
  } catch {
    // happy-dom doesn't recognize :popover-open; the attribute fallback below is authoritative.
  }
  return popoverEl.hasAttribute('popover-open')
}

describe('mn-month-popover', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('registers the tag and renders the calendar grid, month label, and weekdays', async () => {
    expect(customElements.get('mn-month-popover')).toBeDefined()
    const el = await mount()

    const root = el.shadowRoot!
    expect(root.querySelector('.popover')).not.toBeNull()
    expect(root.querySelector('.month-label')?.textContent).toContain('July')
    expect(root.querySelectorAll('.weekday')).toHaveLength(7)
    expect(root.querySelectorAll('.cell').length).toBeGreaterThan(27)
  })

  it('promotes to the native top layer on mount', async () => {
    const el = await mount()
    // Layer-contract campaign: `.popover` is a Popover-API element, escaping
    // whatever stacking context the editor/daily-note surface it mounts in
    // forms.
    expect(el.shadowRoot!.querySelector('.popover')?.hasAttribute('popover')).toBe(true)
    expect(isOpen(el)).toBe(true)
  })

  it('selecting a date emits date-select with the day key and closes', async () => {
    const el = await mount(node => {
      node.datesWithNotes = new Set(['2026-07-03'])
    })
    const selections: MnMonthPopoverDateSelectDetail[] = []
    let closed = 0
    el.addEventListener('date-select', event => {
      selections.push((event as CustomEvent<MnMonthPopoverDateSelectDetail>).detail)
    })
    el.addEventListener('mn-close', () => {
      closed += 1
    })

    const noteCell = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.cell')).find(cell =>
      cell.querySelector('.has-note-dot'),
    )
    expect(noteCell).toBeDefined()
    noteCell!.click()

    expect(selections).toEqual([{ dateKey: '2026-07-03' }])
    expect(closed).toBe(1)
  })

  it('Escape and outside pointerdown close the popover', async () => {
    const el = await mount()
    let closed = 0
    el.addEventListener('mn-close', () => {
      closed += 1
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closed).toBe(1)

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    expect(closed).toBe(2)
  })

  it('re-promotes to the top layer after disconnect + reinsert (regression r1)', async () => {
    const el = await mount()
    expect(isOpen(el)).toBe(true)

    el.remove()
    // disconnectedCallback hides the popover synchronously — observable
    // immediately, matching the native Popover API's own auto-close on
    // removal from the document.
    expect(isOpen(el)).toBe(false)

    document.body.appendChild(el)
    await el.updateComplete

    // The defect this regresses: promoting only in firstUpdated() (which
    // fires once per instance, not once per connection) would leave this
    // permanently false after a reconnect. connectedCallback's
    // updateComplete-gated, isConnected-guarded show() must re-promote it.
    expect(isOpen(el)).toBe(true)
    expect(el.shadowRoot!.querySelector('.month-label')).not.toBeNull()
  })

  it('does not resurrect a popover that was disconnected again before its pending show() microtask ran', async () => {
    const el = await mount()
    el.remove()
    expect(isOpen(el)).toBe(false)

    // Reconnect then immediately disconnect again, before the connect's
    // `updateComplete.then()` promotion microtask has had a chance to run.
    document.body.appendChild(el)
    el.remove()
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    // The isConnected guard must have skipped the stale promotion.
    expect(isOpen(el)).toBe(false)
  })
})
