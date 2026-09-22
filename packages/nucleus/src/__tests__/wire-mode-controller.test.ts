/**
 * Tests for the default WireModeController.
 *
 * State machine: INACTIVE → ACTIVE (via enter) → INACTIVE (via exit OR commit
 * resolution). transferActiveHost rebinds activeHostId without leaving ACTIVE.
 * enter while ACTIVE replaces source + config + activeHostId (matches prod's
 * Mod+Shift+; behavior — opening the advanced menu mid-mode overrides
 * predicate / direction without exiting first). commit() honors direction:
 * forward = no swap; reverse = swap source/target; bidirectional = sets the
 * flag (no swap).
 */

import { describe, expect, it, vi } from 'vitest'
import { createWireModeController } from '../wire-mode-controller.js'
import type {
  WireCreateRequest,
  WireWriter,
  WireModeSource,
  WireModeTarget,
  WireModeConfig,
  WireModeView,
} from '../contract.js'

function makeWireWriter(): {
  writer: WireWriter
  calls: Array<{ graphId: string; params: WireCreateRequest }>
} {
  const calls: Array<{ graphId: string; params: WireCreateRequest }> = []
  const writer: WireWriter = {
    async create(graphId, params) {
      calls.push({ graphId, params })
      return { wireId: params.wireId ?? 'wire-created' }
    },
    async delete() {
      /* unused here */
    },
  }
  return { writer, calls }
}

const SOURCE: WireModeSource = {
  graphId: 'graph-a',
  documentId: 'doc-source',
  blockId: 'block-source',
}

const TARGET: WireModeTarget = {
  graphId: 'graph-a',
  documentId: 'doc-target',
  blockId: 'block-target',
}

const FORWARD_CFG: WireModeConfig = { predicate: 'supports', direction: 'forward' }
const REVERSE_CFG: WireModeConfig = { predicate: 'supports', direction: 'reverse' }
const BIDI_CFG: WireModeConfig = { predicate: 'relatedTo', direction: 'bidirectional' }

describe('createWireModeController — state machine', () => {
  it('starts in INACTIVE state with all fields null', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    expect(controller.view()).toEqual({
      isActive: false,
      source: null,
      config: null,
      activeHostId: null,
    })
  })

  it('enter activates the mode and sets source + config + activeHostId', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    expect(controller.view()).toEqual({
      isActive: true,
      source: SOURCE,
      config: FORWARD_CFG,
      activeHostId: 'host-1',
    })
  })

  it('exit returns to INACTIVE and is idempotent when already inactive', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    controller.exit()
    expect(controller.view().isActive).toBe(false)
    expect(controller.view().source).toBeNull()
    // Idempotent: a second exit() does not throw.
    expect(() => controller.exit()).not.toThrow()
  })

  it('enter while ACTIVE replaces source + config + activeHostId', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    const newSource: WireModeSource = { graphId: 'graph-b', documentId: 'doc-other', blockId: null }
    controller.enter(newSource, BIDI_CFG, 'host-2')
    expect(controller.view()).toEqual({
      isActive: true,
      source: newSource,
      config: BIDI_CFG,
      activeHostId: 'host-2',
    })
  })
})

describe('createWireModeController — subscribe', () => {
  it('notifies subscribers on enter and exit', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    const events: WireModeView[] = []
    const unsubscribe = controller.subscribe((view) => events.push(view))

    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    controller.exit()

    expect(events).toHaveLength(2)
    expect(events[0]?.isActive).toBe(true)
    expect(events[0]?.activeHostId).toBe('host-1')
    expect(events[1]?.isActive).toBe(false)
    expect(events[1]?.activeHostId).toBeNull()

    unsubscribe()
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    expect(events).toHaveLength(2)
  })

  it('does not notify when exit is called from INACTIVE', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    const cb = vi.fn()
    controller.subscribe(cb)
    controller.exit()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('createWireModeController — transferActiveHost', () => {
  it('rebinds activeHostId without leaving ACTIVE', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    controller.transferActiveHost('host-2')
    expect(controller.view()).toEqual({
      isActive: true,
      source: SOURCE,
      config: FORWARD_CFG,
      activeHostId: 'host-2',
    })
  })

  it('is a no-op when wire mode is INACTIVE', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    const cb = vi.fn()
    controller.subscribe(cb)
    controller.transferActiveHost('host-2')
    expect(controller.view().isActive).toBe(false)
    expect(controller.view().activeHostId).toBeNull()
    expect(cb).not.toHaveBeenCalled()
  })

  it('is a no-op when the requested host is already active', () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    const cb = vi.fn()
    controller.subscribe(cb)
    controller.transferActiveHost('host-1')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('createWireModeController — commit', () => {
  it('forward direction: calls wire.create with source → target, no swap, bidirectional=false', async () => {
    const { writer, calls } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')

    const result = await controller.commit(TARGET)
    expect(result.wireId).toBe('wire-created')
    expect(calls).toHaveLength(1)
    expect(calls[0].graphId).toBe(SOURCE.graphId)
    expect(calls[0].params).toEqual({
      sourceDocumentId: SOURCE.documentId,
      targetDocumentId: TARGET.documentId,
      targetGraphId: TARGET.graphId,
      bidirectional: false,
      predicate: 'supports',
      sourceBlockId: SOURCE.blockId,
      targetBlockId: TARGET.blockId,
    })
  })

  it('reverse direction: swaps source/target before calling wire.create', async () => {
    const { writer, calls } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, REVERSE_CFG, 'host-1')

    await controller.commit(TARGET)
    expect(calls[0].graphId).toBe(TARGET.graphId)
    expect(calls[0].params).toEqual({
      sourceDocumentId: TARGET.documentId,
      targetDocumentId: SOURCE.documentId,
      targetGraphId: SOURCE.graphId,
      bidirectional: false,
      predicate: 'supports',
      sourceBlockId: TARGET.blockId,
      targetBlockId: SOURCE.blockId,
    })
  })

  it('bidirectional direction: sets bidirectional=true, no swap', async () => {
    const { writer, calls } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, BIDI_CFG, 'host-1')

    await controller.commit(TARGET)
    expect(calls[0].graphId).toBe(SOURCE.graphId)
    expect(calls[0].params.sourceDocumentId).toBe(SOURCE.documentId)
    expect(calls[0].params.targetDocumentId).toBe(TARGET.documentId)
    expect(calls[0].params.bidirectional).toBe(true)
    expect(calls[0].params.predicate).toBe('relatedTo')
  })

  it('exits wire mode on successful commit', async () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')
    await controller.commit(TARGET)
    expect(controller.view().isActive).toBe(false)
  })

  it('omits sourceBlockId / targetBlockId from the request when null', async () => {
    const { writer, calls } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    const docOnlySource: WireModeSource = { ...SOURCE, blockId: null }
    const docOnlyTarget: WireModeTarget = { ...TARGET, blockId: null }
    controller.enter(docOnlySource, FORWARD_CFG, 'host-1')

    await controller.commit(docOnlyTarget)
    expect(calls[0].params.sourceBlockId).toBeUndefined()
    expect(calls[0].params.targetBlockId).toBeUndefined()
  })

  it('throws when wire mode is inactive', async () => {
    const { writer } = makeWireWriter()
    const controller = createWireModeController({ wire: writer })
    await expect(controller.commit(TARGET)).rejects.toThrow(
      'WireModeController.commit(): wire mode is not active',
    )
  })
})

/**
 * A wire writer whose create() blocks until release() is called, so a test can
 * interleave a second commit / enter / exit while the first commit is mid-flight.
 */
function makeBlockableWireWriter(): {
  writer: WireWriter
  calls: Array<{ graphId: string; params: WireCreateRequest }>
  release: () => void
} {
  const calls: Array<{ graphId: string; params: WireCreateRequest }> = []
  let releaseFn: () => void = () => {}
  const writer: WireWriter = {
    create(graphId, params) {
      calls.push({ graphId, params })
      return new Promise((resolve) => {
        releaseFn = () => resolve({ wireId: 'wire-created' })
      })
    },
    async delete() {
      /* unused */
    },
  }
  return { writer, calls, release: () => releaseFn() }
}

describe('createWireModeController — concurrent / interleaved commit', () => {
  it('a second commit while the first is in flight does NOT fire a second wire.create', async () => {
    const { writer, calls, release } = makeBlockableWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')

    const firstP = controller.commit(TARGET)
    // Second commit before the first resolves — must be rejected by the
    // in-flight guard, NOT fire a duplicate wire.create.
    await expect(controller.commit(TARGET)).rejects.toThrow('a commit is already in flight')
    expect(calls).toHaveLength(1)

    release()
    await firstP
    expect(calls).toHaveLength(1)
    expect(controller.view().isActive).toBe(false)
  })

  it('enter() during a pending commit() is NOT clobbered when the commit resolves', async () => {
    const { writer, release } = makeBlockableWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')

    const firstP = controller.commit(TARGET)
    // Replace the session mid-flight (the Mod-Shift-; re-open path).
    const newSource: WireModeSource = { graphId: 'graph-b', documentId: 'doc-new', blockId: 'block-new' }
    controller.enter(newSource, BIDI_CFG, 'host-2')
    expect(controller.view().isActive).toBe(true)

    release()
    await firstP
    // The resolved first commit must NOT reset the new session.
    expect(controller.view()).toEqual({
      isActive: true,
      source: newSource,
      config: BIDI_CFG,
      activeHostId: 'host-2',
    })
  })

  it('exit() during a pending commit() does NOT cause a second exit emit', async () => {
    const { writer, release } = makeBlockableWireWriter()
    const controller = createWireModeController({ wire: writer })
    controller.enter(SOURCE, FORWARD_CFG, 'host-1')

    const events: WireModeView[] = []
    controller.subscribe((v) => events.push(v))

    const firstP = controller.commit(TARGET)
    controller.exit() // one exit emit here
    const exitEmitsAfterExit = events.filter((e) => !e.isActive).length

    release()
    await firstP
    const exitEmitsAfterCommit = events.filter((e) => !e.isActive).length
    // The post-await finalize must NOT emit a second inactive view.
    expect(exitEmitsAfterCommit).toBe(exitEmitsAfterExit)
    expect(exitEmitsAfterCommit).toBe(1)
  })
})
