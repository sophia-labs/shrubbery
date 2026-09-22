/**
 * layout-edge-interpreter-live.test.ts — the PROOF that a DATA-DECLARED
 * `LayoutEdge` mutates a LIVE tree through the WHOLE runtime stack, not just the
 * reducer. Where `layout-edge-interpreter.test.ts` proves the substrate at the
 * DOCUMENT level (a `commit` that only records the adopted doc), this file wires
 * `installLayoutEdges` to a REAL session-doc holder AND a REAL
 * `LayoutInterpreter` reconciling into a real container — the exact
 * `commit(doc) => swap session doc + reconcile` seam
 * `apps/organism/src/harness/layout-workbench-main.ts` now uses live. Firing an
 * intent must both mutate the doc AND move the rendered DOM.
 *
 * NO MOCKS (scripts/validate-no-mocks.mjs): a REAL `FaceRegistry` +
 * `LayoutResourceBroker` + `sophia.home` face/adapter, the REAL `applyOperation`
 * reducer (reached only THROUGH the edge interpreter — this test NEVER calls it
 * or `close_leaf`/`split_leaf` itself; the money assertion is that a fired
 * intent is the ONLY driver), and a hand-written in-memory intent source with a
 * plain listener Set. Every fixture leaf is a `sophia.home` leaf — the same face
 * `opensInSplit` itself opens — so the registry needs exactly one registration.
 *
 * EPHEMERAL / SESSION-ONLY: every doc here is a plain in-memory value and the
 * interpreter's DOM is a throwaway container; nothing is persisted, exactly like
 * the harness session this mirrors.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSophiaHomeDescriptor,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutEdge,
  type LayoutLeafNode,
} from '@shrubbery/nucleus/layout'
import {
  installLayoutEdges,
  type LayoutIdMinter,
  type LayoutIntentEvent,
  type LayoutIntentSource,
} from '../layout-edge-interpreter.js'
import { LayoutInterpreter } from '../layout-interpreter.js'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from '../faces/sophia-home-face.js'
import { freshDocument, splitNode } from './fixtures.js'

const CONTAINER = { width: 1000, height: 600 } as const

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

/** A real in-memory intent source (recording-free listener Set) + a `fire`. */
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
    fire: (event: LayoutIntentEvent) => {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

/** Deterministic split ids for a single fire (like the harness's counter minter, but pinned). */
const fixedMinter: LayoutIdMinter = (role) => (role === 'leaf' ? 'new-leaf' : 'new-split')

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

/**
 * Build the LIVE stack: a real registry/broker/interpreter, plus a session that
 * holds a mutable `doc` and a `commit` that swaps it AND reconciles the real
 * interpreter (the workbench's exact seam). `reconciles` collects the async
 * reconcile promises `commit` kicks so a test can await the render synchronously
 * after a (synchronous) fire.
 */
function createLiveSession(initial: LayoutDocument) {
  const registry = new FaceRegistry()
  registry.register(createSophiaHomeFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createSophiaHomeResourceAdapter())
  const interpreter = new LayoutInterpreter(root, { registry, broker })

  let doc = initial
  const committed: LayoutDocument[] = []
  const reconciles: Promise<unknown>[] = []
  return {
    interpreter,
    registry,
    getDoc: () => doc,
    commit: (next: LayoutDocument) => {
      doc = next
      committed.push(next)
      reconciles.push(interpreter.reconcile(next, CONTAINER))
    },
    committed,
    settle: () => Promise.all(reconciles),
  }
}

describe('installLayoutEdges over a LIVE LayoutInterpreter — closesLeaf (the money proof)', () => {
  it('(a)+(d) a fired closesLeaf intent mutates the doc AND removes the rendered leaf wrapper — nothing but the intent drives it', async () => {
    const initial = twoLeafDoc()
    const session = createLiveSession(initial)
    await session.interpreter.reconcile(initial, CONTAINER) // initial live render

    // Both leaves are really rendered before we touch anything.
    const wrapperBBefore = session.interpreter.leafWrapperElement('B')
    expect(session.interpreter.leafWrapperElement('A')).not.toBeNull()
    expect(wrapperBBefore).not.toBeNull()

    const edges: LayoutEdge[] = [{ from: 'closer', predicate: 'closesLeaf' }]
    const src = createIntentSource()
    installLayoutEdges(edges, src.source, session.getDoc, session.commit, {
      validate: { isFaceRegistered: session.registry.toFaceRegistrationPredicate() },
    })

    // The ONLY thing this test does to cause a mutation: fire an intent. It
    // never calls applyOperation, never authors a close_leaf op — a
    // DATA-DECLARED edge, matched by `from`, synthesizes and applies it.
    src.fire({ from: 'closer', leafId: 'A' })
    await session.settle()

    // Doc mutated exactly as close_leaf specifies: A gone, its split collapsed,
    // sibling B promoted to root, doc still valid.
    expect(session.committed).toHaveLength(1)
    const produced = session.committed[0]
    expect(produced.nodes.A).toBeUndefined()
    expect(produced.nodes.S1).toBeUndefined()
    expect(produced.rootNodeId).toBe('B')
    expect(validateLayoutDocument(produced).ok).toBe(true)

    // THE LIVE RENDER PATH reflects it: A's wrapper is gone from the real DOM,
    // B survives by the SAME element reference (promoted, not remounted).
    expect(session.interpreter.leafWrapperElement('A')).toBeNull()
    expect(session.interpreter.leafWrapperElement('B')).toBe(wrapperBBefore)
    expect(wrapperBBefore!.isConnected).toBe(true)

    await session.interpreter.dispose()
  })
})

describe('installLayoutEdges over a LIVE LayoutInterpreter — opensInSplit', () => {
  it('(b) a fired opensInSplit intent grows a new split with a freshly-rendered sophia.home leaf', async () => {
    const initial = oneLeafDoc()
    const session = createLiveSession(initial)
    await session.interpreter.reconcile(initial, CONTAINER)
    expect(session.interpreter.leafWrapperElement('R')).not.toBeNull()
    expect(session.interpreter.leafWrapperElement('new-leaf')).toBeNull() // does not exist yet

    const edges: LayoutEdge[] = [{ from: 'opener', predicate: 'opensInSplit', axis: 'vertical', side: 'end' }]
    const src = createIntentSource()
    installLayoutEdges(edges, src.source, session.getDoc, session.commit, {
      mintId: fixedMinter,
      validate: { isFaceRegistered: session.registry.toFaceRegistrationPredicate() },
    })

    src.fire({ from: 'opener', leafId: 'R' })
    await session.settle()

    expect(session.committed).toHaveLength(1)
    const produced = session.committed[0]
    // A new split now roots the tree, holding the original leaf + a fresh
    // sophia.home leaf the EDGE chose (the test never named a descriptor).
    expect(produced.rootNodeId).toBe('new-split')
    expect(produced.nodes['new-split']?.kind).toBe('split')
    const newLeaf = produced.nodes['new-leaf']
    expect(newLeaf?.kind).toBe('leaf')
    expect((newLeaf as LayoutLeafNode).descriptor.faceId).toBe('sophia.home')
    expect(validateLayoutDocument(produced).ok).toBe(true)

    // LIVE render: both leaves AND the new split are now real wrappers in the DOM.
    expect(session.interpreter.leafWrapperElement('R')).not.toBeNull()
    expect(session.interpreter.leafWrapperElement('new-leaf')).not.toBeNull()
    expect(session.interpreter.leafWrapperElement('new-leaf')!.isConnected).toBe(true)
    expect(session.interpreter.splitWrapperElement('new-split')).not.toBeNull()

    await session.interpreter.dispose()
  })
})

describe('installLayoutEdges over a LIVE LayoutInterpreter — closed-vocabulary no-op', () => {
  it('(c) a predicate outside the closed vocabulary emits no op: doc AND rendered DOM unchanged', async () => {
    const initial = twoLeafDoc()
    const session = createLiveSession(initial)
    await session.interpreter.reconcile(initial, CONTAINER)
    const wrapperABefore = session.interpreter.leafWrapperElement('A')
    const wrapperBBefore = session.interpreter.leafWrapperElement('B')

    // A forged predicate outside `LayoutEdge`'s closed union — reachable only
    // via a cast, exactly the shape the interpreter must treat as inert.
    const forged = { from: 'x', predicate: 'flipsTable' } as unknown as LayoutEdge
    const src = createIntentSource()
    installLayoutEdges([forged], src.source, session.getDoc, session.commit, {
      validate: { isFaceRegistered: session.registry.toFaceRegistrationPredicate() },
    })

    src.fire({ from: 'x', leafId: 'A' })
    await session.settle()

    // No commit, no mutation — session doc is the SAME reference it started as.
    expect(session.committed).toHaveLength(0)
    expect(session.getDoc()).toBe(initial)
    // And the LIVE DOM is byte-for-byte the same wrappers (nothing re-rendered).
    expect(session.interpreter.leafWrapperElement('A')).toBe(wrapperABefore)
    expect(session.interpreter.leafWrapperElement('B')).toBe(wrapperBBefore)

    await session.interpreter.dispose()
  })
})
