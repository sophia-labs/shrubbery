/**
 * layout-edge-interpreter.test.ts — proves the layout-edge substrate against
 * the REAL reducer and a REAL `LayoutDocument`: no mocks, no spy framework
 * (scripts/validate-no-mocks.mjs forbids them). The "source" is a hand-written
 * in-memory intent emitter; observation is done with plain recording closures.
 *
 * All fixtures use `sophia.home` leaves so the DEFAULT face-registration
 * predicate suffices (no registry wiring) — the same face the 'opensInSplit'
 * predicate itself opens.
 *
 * EPHEMERAL / SESSION-ONLY, like the substrate under test: every doc here is a
 * plain in-memory value; nothing is persisted or expected to be.
 */
import { describe, expect, it } from 'vitest'
import {
  applyOperation,
  createSophiaHomeDescriptor,
  locateParent,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutEdge,
  type LayoutLeafNode,
} from '@shrubbery/nucleus/layout'
import {
  createCounterIdMinter,
  installLayoutEdges,
  synthesizeLayoutOperation,
  type LayoutEdgeRejection,
  type LayoutIdMinter,
  type LayoutIntentEvent,
  type LayoutIntentSource,
} from '../layout-edge-interpreter.js'
import { freshDocument, splitNode } from './fixtures.js'

function sophiaLeaf(id: string): LayoutLeafNode {
  return { kind: 'leaf', id, descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 }
}

/** Split `S1` over two sophia.home leaves `A` (start) and `B` (end). */
function twoLeafDoc(): LayoutDocument {
  return freshDocument('S1', {
    S1: splitNode('S1', 'horizontal', 'A', 'B', 5000),
    A: sophiaLeaf('A'),
    B: sophiaLeaf('B'),
  })
}

/** A single sophia.home leaf as the whole document (root === leaf). */
function oneLeafDoc(): LayoutDocument {
  return freshDocument('R', { R: sophiaLeaf('R') })
}

/**
 * A real in-memory intent source with a recording closure — the `onIntent`
 * shape the interpreter subscribes, plus a `fire` to drive it and a
 * `listenerCount` to prove the disposer actually unsubscribes.
 */
function createIntentSource() {
  const listeners = new Set<(event: LayoutIntentEvent) => void>()
  const source: LayoutIntentSource = {
    onIntent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    source,
    fire(event: LayoutIntentEvent) {
      for (const listener of [...listeners]) listener(event)
    },
    listenerCount: () => listeners.size,
  }
}

/**
 * A tiny session harness: a mutable `doc`, a `getDoc` reader, and a `commit`
 * that records every adopted doc (the workbench's applyOp-swaps-doc seam,
 * minus reconcile). Fixed-value `mintId` so split ids are deterministic and an
 * expected op can be constructed to compare against.
 */
function createSession(initial: LayoutDocument) {
  let doc = initial
  const committed: LayoutDocument[] = []
  const rejections: LayoutEdgeRejection[] = []
  return {
    getDoc: () => doc,
    commit: (next: LayoutDocument) => {
      doc = next
      committed.push(next)
    },
    onReject: (rejection: LayoutEdgeRejection) => rejections.push(rejection),
    committed,
    rejections,
  }
}

/** Deterministic minter yielding known ids for a single fire. */
const fixedMinter: LayoutIdMinter = (role) => (role === 'leaf' ? 'new-leaf' : 'new-split')

describe('installLayoutEdges — closesLeaf', () => {
  it('(a) fires close_leaf with the live leafId; result equals applyOperation directly', () => {
    const initial = twoLeafDoc()
    const session = createSession(initial)
    const edges: LayoutEdge[] = [{ from: 'closer', predicate: 'closesLeaf' }]
    const src = createIntentSource()

    const dispose = installLayoutEdges(edges, src.source, session.getDoc, session.commit, {
      onReject: session.onReject,
    })
    src.fire({ from: 'closer', leafId: 'A' })
    dispose()

    // Exactly one commit, no rejections.
    expect(session.committed).toHaveLength(1)
    expect(session.rejections).toHaveLength(0)
    const produced = session.committed[0]

    // Assert against the reducer's OWN result for the operation the edge should
    // synthesize (leafId from the event, expectedParent from the live doc).
    const direct = applyOperation(initial, {
      op: 'close_leaf',
      leafId: 'A',
      expectedParent: locateParent(initial, 'A')!,
    })
    expect(direct.ok).toBe(true)
    if (!direct.ok) throw new Error('unreachable')
    expect(produced).toEqual(direct.doc)

    // A gone, sibling B promoted to root.
    expect(produced.nodes.A).toBeUndefined()
    expect(produced.nodes.S1).toBeUndefined()
    expect(produced.rootNodeId).toBe('B')
  })

  it('(e) the produced doc passes validateLayoutDocument', () => {
    const session = createSession(twoLeafDoc())
    const src = createIntentSource()
    installLayoutEdges([{ from: 'closer', predicate: 'closesLeaf' }], src.source, session.getDoc, session.commit)
    src.fire({ from: 'closer', leafId: 'A' })

    expect(session.committed).toHaveLength(1)
    const verdict = validateLayoutDocument(session.committed[0])
    expect(verdict.ok).toBe(true)
  })
})

describe('installLayoutEdges — opensInSplit', () => {
  it('(b) fires split_leaf opening a fresh sophia.home leaf', () => {
    const initial = oneLeafDoc()
    const session = createSession(initial)
    const edges: LayoutEdge[] = [{ from: 'opener', predicate: 'opensInSplit', axis: 'vertical', side: 'end' }]
    const src = createIntentSource()

    installLayoutEdges(edges, src.source, session.getDoc, session.commit, {
      mintId: fixedMinter,
      onReject: session.onReject,
    })
    src.fire({ from: 'opener', leafId: 'R' })

    expect(session.rejections).toHaveLength(0)
    expect(session.committed).toHaveLength(1)
    const produced = session.committed[0]

    // Same op the edge should synthesize, applied directly.
    const direct = applyOperation(initial, {
      op: 'split_leaf',
      leafId: 'R',
      axis: 'vertical',
      side: 'end',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: createSophiaHomeDescriptor(),
      expectedParent: locateParent(initial, 'R')!,
    })
    expect(direct.ok).toBe(true)
    if (!direct.ok) throw new Error('unreachable')
    expect(produced).toEqual(direct.doc)

    // A new split with the original leaf + a fresh sophia.home leaf.
    expect(produced.rootNodeId).toBe('new-split')
    const split = produced.nodes['new-split']
    expect(split?.kind).toBe('split')
    const newLeaf = produced.nodes['new-leaf']
    expect(newLeaf?.kind).toBe('leaf')
    expect((newLeaf as LayoutLeafNode).descriptor.faceId).toBe('sophia.home')

    // Validity by construction — assert it (test-e for this predicate too).
    expect(validateLayoutDocument(produced).ok).toBe(true)
  })
})

describe('installLayoutEdges — closed-vocabulary + routing no-ops', () => {
  it('(c) an unknown predicate no-ops: no commit, no op emitted, doc unchanged', () => {
    const initial = twoLeafDoc()
    const session = createSession(initial)
    // A forged predicate outside the closed union — only reachable via a cast.
    const forged = { from: 'x', predicate: 'flipsTable' } as unknown as LayoutEdge
    const src = createIntentSource()

    installLayoutEdges([forged], src.source, session.getDoc, session.commit, { onReject: session.onReject })
    src.fire({ from: 'x', leafId: 'A' })

    expect(session.committed).toHaveLength(0)
    expect(session.rejections).toHaveLength(0)
    expect(session.getDoc()).toBe(initial) // same reference — nothing mutated

    // The synthesizer itself returns null for the unknown predicate.
    expect(synthesizeLayoutOperation(forged, { from: 'x', leafId: 'A' }, initial, fixedMinter)).toBeNull()
  })

  it('an edge whose from does not match the event emits nothing', () => {
    const session = createSession(twoLeafDoc())
    const src = createIntentSource()
    installLayoutEdges([{ from: 'closer', predicate: 'closesLeaf' }], src.source, session.getDoc, session.commit)
    src.fire({ from: 'someone-else', leafId: 'A' })
    expect(session.committed).toHaveLength(0)
  })
})

describe('installLayoutEdges — precondition failure surfaces, never throws', () => {
  it('(d) a fire on an absent leaf surfaces the reducer diagnostic; doc unchanged', () => {
    const initial = twoLeafDoc()
    const session = createSession(initial)
    const src = createIntentSource()
    installLayoutEdges([{ from: 'closer', predicate: 'closesLeaf' }], src.source, session.getDoc, session.commit, {
      onReject: session.onReject,
    })

    // Firing (not the interpreter) must not throw.
    expect(() => src.fire({ from: 'closer', leafId: 'ghost' })).not.toThrow()

    expect(session.committed).toHaveLength(0) // no half-mutation
    expect(session.getDoc()).toBe(initial) // same reference — untouched
    expect(session.rejections).toHaveLength(1)
    expect(session.rejections[0].diagnostic.code).toBe('LAYOP_NODE_NOT_FOUND')
    expect(session.rejections[0].operation.op).toBe('close_leaf')
  })
})

describe('installLayoutEdges — disposer + minter', () => {
  it('the disposer unsubscribes; is idempotent; post-dispose fires are inert', () => {
    const session = createSession(twoLeafDoc())
    const src = createIntentSource()
    const dispose = installLayoutEdges(
      [{ from: 'closer', predicate: 'closesLeaf' }],
      src.source,
      session.getDoc,
      session.commit,
    )
    expect(src.listenerCount()).toBe(1)

    dispose()
    expect(src.listenerCount()).toBe(0)
    dispose() // idempotent — no throw, still zero
    expect(src.listenerCount()).toBe(0)

    src.fire({ from: 'closer', leafId: 'A' })
    expect(session.committed).toHaveLength(0)
  })

  it('the default counter minter is deterministic and yields distinct split/leaf ids', () => {
    const mint = createCounterIdMinter()
    const event: LayoutIntentEvent = { from: 'opener', leafId: 'R' }
    const leafId = mint('leaf', event)
    const splitId = mint('split', event)
    expect(leafId).not.toBe(splitId)
    expect(leafId).toBe('layout-edge:R:leaf:1')
    expect(splitId).toBe('layout-edge:R:split:2')
  })
})
