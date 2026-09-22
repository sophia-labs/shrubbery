/**
 * Tests for the selection bus (semantic edge overlay, slice 1).
 *
 * The bus is a `ReactiveSource<SelectedObject | null>` with `publish()`:
 * publish notifies every live subscriber and updates `get()`; unsubscribe
 * stops delivery; the initial value seeds `get()` before the first publish.
 *
 * No mocks — subscribers are real closures that record what they receive.
 */

import { describe, expect, it } from 'vitest'
import { createSelectionBus } from '../selection-bus.js'
import type { SelectedObject } from '../selection.js'

const COMMENT: SelectedObject = { kind: 'comment', commentId: 'c-1' }
const BLOCK: SelectedObject = {
  kind: 'block',
  graphId: 'g-1',
  documentId: 'd-1',
  blockId: 'b-1',
}

describe('createSelectionBus', () => {
  it('defaults to a null selection', () => {
    expect(createSelectionBus().get()).toBeNull()
  })

  it('seeds get() from the initial value', () => {
    expect(createSelectionBus(COMMENT).get()).toEqual(COMMENT)
  })

  it('publish notifies subscribers and updates get()', () => {
    const bus = createSelectionBus()
    const seen: Array<SelectedObject | null> = []
    bus.subscribe((v) => seen.push(v))

    bus.publish(COMMENT)
    bus.publish(BLOCK)

    expect(seen).toEqual([COMMENT, BLOCK])
    expect(bus.get()).toEqual(BLOCK)
  })

  it('notifies every live subscriber on each publish', () => {
    const bus = createSelectionBus()
    const a: Array<SelectedObject | null> = []
    const b: Array<SelectedObject | null> = []
    bus.subscribe((v) => a.push(v))
    bus.subscribe((v) => b.push(v))

    bus.publish(COMMENT)

    expect(a).toEqual([COMMENT])
    expect(b).toEqual([COMMENT])
  })

  it('keeps source-scoped delivery directed while global subscribers observe every publish', () => {
    const bus = createSelectionBus()
    const global: Array<SelectedObject | null> = []
    const comments: Array<SelectedObject | null> = []
    const graph: Array<SelectedObject | null> = []
    bus.subscribe((v) => global.push(v))
    bus.subscribeFrom('face:comments', (v) => comments.push(v))
    bus.subscribeFrom('face:graph', (v) => graph.push(v))

    bus.publishFrom('face:comments', COMMENT)
    bus.publishFrom('face:graph', BLOCK)
    bus.publish(null)

    expect(global).toEqual([COMMENT, BLOCK, null])
    expect(comments).toEqual([COMMENT])
    expect(graph).toEqual([BLOCK])
    expect(bus.get()).toBeNull()
  })

  it('snapshots a source notification when a callback replaces its subscription synchronously', () => {
    const bus = createSelectionBus()
    const calls: string[] = []
    let unsubscribe = (): void => {}

    const replacement = (): void => {
      calls.push('replacement')
    }
    const original = (): void => {
      calls.push('original')
      unsubscribe()
      unsubscribe = bus.subscribeFrom('face:comments', replacement)
    }
    unsubscribe = bus.subscribeFrom('face:comments', original)

    // The replacement is not part of the in-flight snapshot, so a synchronous
    // dispose+reinstall cannot extend this publication into an endless loop.
    bus.publishFrom('face:comments', COMMENT)
    expect(calls).toEqual(['original'])

    bus.publishFrom('face:comments', BLOCK)
    expect(calls).toEqual(['original', 'replacement'])
  })

  it('a stale scoped unsubscribe cannot remove a replacement subscriber set', () => {
    const bus = createSelectionBus()
    const calls: string[] = []
    const unsubscribeOld = bus.subscribeFrom('face:comments', () => calls.push('old'))

    unsubscribeOld()
    bus.subscribeFrom('face:comments', () => calls.push('replacement'))
    unsubscribeOld()
    bus.publishFrom('face:comments', COMMENT)

    expect(calls).toEqual(['replacement'])
  })

  it('captures each publication value across a nested publish', () => {
    const bus = createSelectionBus()
    const secondSubscriberSeen: Array<SelectedObject | null> = []
    bus.subscribe((value) => {
      if (value === COMMENT) bus.publish(BLOCK)
    })
    bus.subscribe((value) => secondSubscriberSeen.push(value))

    bus.publish(COMMENT)

    // The nested publish completes first; the remaining callback in the outer
    // snapshot still receives COMMENT rather than reading the now-new bus state.
    expect(secondSubscriberSeen).toEqual([BLOCK, COMMENT])
    expect(bus.get()).toEqual(BLOCK)
  })

  it('unsubscribe stops delivery but leaves get() reflecting the last publish', () => {
    const bus = createSelectionBus()
    const seen: Array<SelectedObject | null> = []
    const unsubscribe = bus.subscribe((v) => seen.push(v))

    bus.publish(COMMENT)
    unsubscribe()
    bus.publish(BLOCK)

    expect(seen).toEqual([COMMENT])
    expect(bus.get()).toEqual(BLOCK)
  })

  it('publish(null) clears the selection', () => {
    const bus = createSelectionBus(COMMENT)
    const seen: Array<SelectedObject | null> = []
    bus.subscribe((v) => seen.push(v))

    bus.publish(null)

    expect(seen).toEqual([null])
    expect(bus.get()).toBeNull()
  })
})
