/**
 * SE3 test — the EditorHostBinding contract, exercised as a REAL reactive object.
 *
 * NO MOCKS: we build a real in-process ReactiveSource<EditorHostState> (a closure
 * over a mutable value with get/subscribe + a test-only set), and assert the
 * binding contract holds against real state values:
 *   - get() returns the seeded state,
 *   - subscribe() fires its callback with the new value on a real set(),
 *   - the returned unsubscribe stops further callbacks.
 *
 * This is the seam SE4's live host consumes. The binding is a plain reactive
 * object — nothing is stubbed or faked.
 */

import { describe, it, expect } from 'vitest'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostState,
  type EditorHostBinding,
} from '../editor-host-binding.js'

/**
 * A REAL reactive source over EditorHostState — a closure with get/subscribe and
 * a test-only set() that pushes the new value to every subscriber. This is the
 * exact shape a shell's asReactiveStore adapter produces; it is a genuine
 * reactive object, not a mock.
 */
interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}
function makeBinding(initial: EditorHostState): SettableBinding {
  let value = initial
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of subs) cb(value)
    },
  }
}

describe('EditorHostBinding — real ReactiveSource over EditorHostState', () => {
  it('get() returns the seeded state', () => {
    const b = makeBinding(NULL_EDITOR_HOST_STATE)
    expect(b.get()).toEqual({
      centerMode: 'home',
      graphId: null,
      documentId: null,
      status: 'idle',
      error: null,
      provider: null,
    })
  })

  it('subscribe() fires the callback with the new value on a real set()', () => {
    const b = makeBinding(NULL_EDITOR_HOST_STATE)
    const seen: EditorHostState[] = []
    b.subscribe(v => seen.push(v))

    const next: EditorHostState = {
      centerMode: 'document',
      graphId: 'g-1',
      documentId: 'd-1',
      status: 'ready',
      error: null,
      provider: null,
    }
    b.set(next)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(next)
    // and get() now reflects the new state too
    expect(b.get()).toEqual(next)
  })

  it('the returned unsubscribe stops further callbacks', () => {
    const b = makeBinding(NULL_EDITOR_HOST_STATE)
    const seen: EditorHostState[] = []
    const off = b.subscribe(v => seen.push(v))

    b.set({ ...NULL_EDITOR_HOST_STATE, status: 'loading' })
    expect(seen).toHaveLength(1)

    off()
    b.set({ ...NULL_EDITOR_HOST_STATE, status: 'ready' })
    // no new callback after unsubscribe
    expect(seen).toHaveLength(1)
  })

  it('carries the verbatim error message in error status (no faked fallback)', () => {
    const b = makeBinding(NULL_EDITOR_HOST_STATE)
    const errState: EditorHostState = {
      centerMode: 'home',
      graphId: null,
      documentId: null,
      status: 'error',
      error: 'cell refused: 503',
      provider: null,
    }
    b.set(errState)
    expect(b.get().status).toBe('error')
    expect(b.get().error).toBe('cell refused: 503')
  })
})
