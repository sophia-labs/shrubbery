import { describe, expect, it } from 'vitest'
import { createHeadingsChangeGate } from '../structure-change-gate.js'
import { headingsSignature } from '../editor-host.js'

function fire(
  from: HTMLElement,
  reason: 'mounted' | 'transaction' | 'selection',
  signature: string | undefined,
): Event {
  let seen: Event | null = null
  const listener = (event: Event): void => { seen = event }
  document.addEventListener('mn-editor-structure-change', listener)
  from.dispatchEvent(new CustomEvent('mn-editor-structure-change', {
    bubbles: true,
    composed: true,
    detail: { reason, activeBlockId: null, headingsSignature: signature },
  }))
  document.removeEventListener('mn-editor-structure-change', listener)
  return seen!
}

describe('headingsSignature', () => {
  it('changes with heading text, level, id and order, but not with identical outlines', () => {
    const a = [{ id: 'a', level: 1, text: 'One' }, { id: 'b', level: 2, text: 'Two' }]
    expect(headingsSignature(a)).toBe(headingsSignature(a.map(h => ({ ...h }))))
    expect(headingsSignature(a)).not.toBe(headingsSignature([{ ...a[0]!, text: 'Uno' }, a[1]!]))
    expect(headingsSignature(a)).not.toBe(headingsSignature([a[0]!, { ...a[1]!, level: 3 }]))
    expect(headingsSignature(a)).not.toBe(headingsSignature([a[1]!, a[0]!]))
    expect(headingsSignature([])).toBe('')
  })
})

describe('createHeadingsChangeGate', () => {
  it('reports a change only when that editor heading list differs from its last event', () => {
    const gate = createHeadingsChangeGate()
    const one = document.createElement('div')
    const two = document.createElement('div')
    document.body.append(one, two)

    expect(gate(fire(one, 'mounted', 'A'))).toBe(true)
    expect(gate(fire(one, 'transaction', 'A'))).toBe(false)
    expect(gate(fire(one, 'transaction', 'A'))).toBe(false)
    expect(gate(fire(one, 'transaction', 'AB'))).toBe(true)
    expect(gate(fire(one, 'transaction', 'AB'))).toBe(false)
    // Another editor is tracked independently.
    expect(gate(fire(two, 'transaction', 'AB'))).toBe(true)
    expect(gate(fire(two, 'transaction', 'AB'))).toBe(false)
    // Selection never changes headings; mounting always counts.
    expect(gate(fire(one, 'selection', 'AB'))).toBe(false)
    expect(gate(fire(one, 'mounted', 'AB'))).toBe(true)
    // No signature (older editor): assume changed.
    expect(gate(fire(one, 'transaction', undefined))).toBe(true)
    one.remove()
    two.remove()
  })
})
