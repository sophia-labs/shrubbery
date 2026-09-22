/**
 * layout-interpreter.test.ts — reconcile-by-leaf-id (LAY-007) is the property
 * this file exists to prove: a ratio change and a structural move
 * (`swap_nodes`/`move_node`) must NOT remount a leaf's face, while
 * `replace_descriptor` and leaf removal MUST tear it down exactly once. Two
 * genuinely different real faces (a document-shaped face and a media/blob
 * face — see fixtures.ts) are mounted side by side throughout, so nothing
 * here can pass by accident of both leaves being "editor-ish."
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyOperation, locateParent, type LayoutDocument, type LayoutOperation } from '@shrubbery/nucleus/layout'
import { LayoutInterpreter } from '../layout-interpreter.js'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import {
  noFaceParams,
  type FaceRegistration,
  type ResourceAdapter,
  type ResourceBroker,
  type ResourceBrokerDiagnostics,
  type ResourceLease,
} from '../types.js'
import {
  buildTestBroker,
  buildTestRegistry,
  createBlobAdapter,
  createFocusableFace,
  documentDescriptor,
  focusableDescriptor,
  freshDocument,
  leafNode,
  mediaDescriptor,
  splitNode,
} from './fixtures.js'

function applyOp(doc: LayoutDocument, op: LayoutOperation, registry: FaceRegistry): LayoutDocument {
  const result = applyOperation(doc, op, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
  if (!result.ok) throw new Error(`applyOperation(${op.op}) failed: ${result.diagnostic.code}`)
  return result.doc
}

function twoLeafDoc() {
  return freshDocument('split', {
    split: splitNode('split', 'horizontal', 'a', 'b', 5000),
    a: leafNode('a', documentDescriptor('doc-a')),
    b: leafNode('b', mediaDescriptor('urn:test:blob-a')),
  })
}

function deferredVoid(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('LayoutInterpreter — initial reconcile mounts two genuinely different real faces', () => {
  it('mounts each leaf exactly once, through the recursive split tree (not a flat grid)', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const result = await interpreter.reconcile(twoLeafDoc(), { width: 1001, height: 600 })
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])

    expect(documentFace.mounts).toHaveLength(1)
    expect(mediaFace.mounts).toHaveLength(1)
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(blobAdapter.loadCalls).toHaveLength(1)

    const splitEl = interpreter.splitWrapperElement('split')
    const wrapperA = interpreter.leafWrapperElement('a')
    const wrapperB = interpreter.leafWrapperElement('b')
    expect(splitEl).not.toBeNull()
    expect(wrapperA).not.toBeNull()
    expect(wrapperB).not.toBeNull()

    // Every wrapper — split OR leaf — is a DIRECT child of `root`, never
    // nested inside another wrapper (diff-review WRONG: "the DOM is never
    // allowed to disagree with the solver, at any nesting depth" — see
    // `layout-interpreter.ts`'s `ensureWrapper` doc comment for why nesting
    // would double-count a descendant's already-root-absolute coordinates).
    expect(wrapperA!.parentElement).toBe(root)
    expect(wrapperB!.parentElement).toBe(root)
    expect(splitEl!.parentElement).toBe(root)

    // Exact solver geometry (design §6.1 formula: 1001 width, 1px divider → 500/500).
    expect(wrapperA!.style.left).toBe('0px')
    expect(wrapperA!.style.width).toBe('500px')
    expect(wrapperB!.style.left).toBe('501px')
    expect(wrapperB!.style.width).toBe('500px')

    // Each face genuinely mounted its own distinct element kind.
    expect(documentFace.mounts[0].element.tagName).toBe('DIV')
    expect(mediaFace.mounts[0].element.tagName).toBe('CANVAS')

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — structural-first sibling activation', () => {
  it('starts both sibling faces and exposes both loading shells before either async mount settles', async () => {
    const registry = new FaceRegistry()
    const gates = [deferredVoid(), deferredVoid()]
    let nextGate = 0
    const face: FaceRegistration = {
      faceId: 'test.async-shell',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: (locator) => locator.kind === 'document',
      paramsSchema: noFaceParams,
      async mount({ target, descriptor }) {
        const shell = document.createElement('div')
        shell.dataset.activationShell = descriptor.resource.kind === 'document'
          ? descriptor.resource.documentId
          : 'unexpected'
        target.replaceChildren(shell)
        const gate = gates[nextGate++]!
        await gate.promise
        return {
          focus: () => true,
          blur: () => {},
          resize: () => {},
          serialize: () => descriptor,
          dispose: () => shell.remove(),
        }
      },
    }
    registry.register(face)
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const descriptor = (documentId: string) => ({
      schemaVersion: 1 as const,
      faceId: face.faceId,
      resource: { kind: 'document' as const, graphId: 'g1', documentId },
    })
    const doc = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: leafNode('a', descriptor('doc-a')),
      b: leafNode('b', descriptor('doc-b')),
    })

    const reconciling = interpreter.reconcile(doc, { width: 800, height: 400 })
    for (let turn = 0; turn < 10 && root.querySelectorAll('[data-activation-shell]').length < 2; turn++) {
      await Promise.resolve()
    }
    expect(Array.from(root.querySelectorAll<HTMLElement>('[data-activation-shell]'))
      .map((element) => element.dataset.activationShell)
      .sort()).toEqual(['doc-a', 'doc-b'])

    gates[0]!.resolve()
    gates[1]!.resolve()
    await expect(reconciling).resolves.toMatchObject({ ok: true })
    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — a ratio change does NOT remount (LAY-007)', () => {
  it('preserves both views/leases/wrappers and only calls resize()', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = twoLeafDoc()
    await interpreter.reconcile(doc0, { width: 1001, height: 600 })

    const wrapperABefore = interpreter.leafWrapperElement('a')
    const wrapperBBefore = interpreter.leafWrapperElement('b')

    const doc1 = applyOp(doc0, { op: 'set_ratio', splitId: 'split', startBasisPoints: 7000 }, registry)
    const result = await interpreter.reconcile(doc1, { width: 1001, height: 600 })
    expect(result.ok).toBe(true)

    // No remount: mount() was never called a second time for either face.
    expect(documentFace.mounts).toHaveLength(1)
    expect(mediaFace.mounts).toHaveLength(1)
    expect(documentFace.mounts[0].disposed).toBe(false)
    expect(mediaFace.mounts[0].disposed).toBe(false)
    // Resource lifecycle untouched: no second load, no dispose.
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(documentAdapter.disposeCalls).toHaveLength(0)
    expect(blobAdapter.loadCalls).toHaveLength(1)
    expect(blobAdapter.disposeCalls).toHaveLength(0)

    // Same wrapper element references (`toBe`, not `toEqual`) — LAY-002/007.
    expect(interpreter.leafWrapperElement('a')).toBe(wrapperABefore)
    expect(interpreter.leafWrapperElement('b')).toBe(wrapperBBefore)

    // resize() WAS called with the new geometry (mount-time resize + this one = 2).
    expect(documentFace.mounts[0].resizeCalls).toHaveLength(2)
    expect(mediaFace.mounts[0].resizeCalls).toHaveLength(2)
    const latestABox = documentFace.mounts[0].resizeCalls.at(-1)!
    const latestBBox = mediaFace.mounts[0].resizeCalls.at(-1)!
    expect(latestABox.width).toBe(700) // round(1000 * 7000/10000)
    expect(latestBBox.width).toBe(300)
    expect(wrapperABefore!.style.width).toBe('700px')
    expect(wrapperBBefore!.style.width).toBe('300px')

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — a structural move does NOT remount (LAY-007)', () => {
  it('swap_nodes: same wrapper identity, geometry follows the node to its new position', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = twoLeafDoc()
    await interpreter.reconcile(doc0, { width: 1001, height: 600 })

    const wrapperABefore = interpreter.leafWrapperElement('a')
    const wrapperBBefore = interpreter.leafWrapperElement('b')
    expect(wrapperABefore!.style.left).toBe('0px') // a starts on the left

    const doc1 = applyOp(doc0, { op: 'swap_nodes', firstNodeId: 'a', secondNodeId: 'b' }, registry)
    const result = await interpreter.reconcile(doc1, { width: 1001, height: 600 })
    expect(result.ok).toBe(true)

    expect(documentFace.mounts).toHaveLength(1) // still no remount
    expect(mediaFace.mounts).toHaveLength(1)
    expect(documentFace.mounts[0].disposed).toBe(false)
    expect(mediaFace.mounts[0].disposed).toBe(false)

    // Same element references, but now on the OTHER side — the wrapper moved, it was not recreated.
    expect(interpreter.leafWrapperElement('a')).toBe(wrapperABefore)
    expect(interpreter.leafWrapperElement('b')).toBe(wrapperBBefore)
    expect(wrapperABefore!.style.left).toBe('501px')
    expect(wrapperBBefore!.style.left).toBe('0px')

    await interpreter.dispose()
  })

  it('move_node: a leaf relocated into a brand-new split keeps its view, lease, and wrapper element', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    // root(S1, horizontal): start=a(document face) | end=S2(vertical): start=b(media face) / end=c(document face)
    const doc0 = freshDocument('S1', {
      S1: splitNode('S1', 'horizontal', 'a', 'S2', 5000),
      S2: splitNode('S2', 'vertical', 'b', 'c', 5000),
      a: leafNode('a', documentDescriptor('doc-a')),
      b: leafNode('b', mediaDescriptor('urn:test:blob-b')),
      c: leafNode('c', documentDescriptor('doc-c')),
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })
    expect(documentFace.mounts).toHaveLength(2) // a and c
    expect(mediaFace.mounts).toHaveLength(1) // b

    const wrapperBBefore = interpreter.leafWrapperElement('b')
    expect(wrapperBBefore).not.toBeNull()

    // Move leaf 'b' out of S2 to become a new sibling of leaf 'a'.
    const doc1 = applyOp(
      doc0,
      {
        op: 'move_node',
        nodeId: 'b',
        targetLeafId: 'a',
        side: 'end',
        axis: 'vertical',
        splitId: 'moved-split',
        expectedParent: locateParent(doc0, 'b')!,
        expectedTargetParent: locateParent(doc0, 'a')!,
      },
      registry,
    )
    const result = await interpreter.reconcile(doc1, { width: 1000, height: 600 })
    expect(result.ok).toBe(true)

    // No remount anywhere — same 3 mount records as before, nothing disposed.
    expect(documentFace.mounts).toHaveLength(2)
    expect(mediaFace.mounts).toHaveLength(1)
    for (const m of [...documentFace.mounts, ...mediaFace.mounts]) expect(m.disposed).toBe(false)
    expect(documentAdapter.loadCalls).toHaveLength(2) // a, c — never reloaded
    expect(blobAdapter.loadCalls).toHaveLength(1) // b — never reloaded
    expect(documentAdapter.disposeCalls).toHaveLength(0)
    expect(blobAdapter.disposeCalls).toHaveLength(0)

    // Same wrapper element, still attached, just relocated.
    const wrapperBAfter = interpreter.leafWrapperElement('b')
    expect(wrapperBAfter).toBe(wrapperBBefore)
    expect(wrapperBAfter!.isConnected).toBe(true)
    // The old split S2 is gone; a fresh 'moved-split' now hosts a+b.
    expect(interpreter.splitWrapperElement('S2')).toBeNull()
    expect(interpreter.splitWrapperElement('moved-split')).not.toBeNull()

    await interpreter.dispose()
  })

  it('move_node on an ANCESTOR SPLIT (not a leaf) preserves every descendant leaf\'s view/lease/wrapper (diff-review MISSING)', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    // root(S1, horizontal): start=Sub(vertical: x(document) / y(media)) | end=z(document)
    // `move_node`'s source `nodeId` can be a SPLIT — design Appendix C: "move
    // node | target outside moved subtree | detach by sibling promotion,
    // insert beside target" makes no leaf-only restriction (only the TARGET
    // must be a leaf). Moving the WHOLE Sub subtree must carry x and y along
    // with it, preserving BOTH their live views/leases — not just the moved
    // node's own identity.
    const doc0 = freshDocument('S1', {
      S1: splitNode('S1', 'horizontal', 'Sub', 'z', 5000),
      Sub: splitNode('Sub', 'vertical', 'x', 'y', 5000),
      x: leafNode('x', documentDescriptor('doc-x')),
      y: leafNode('y', mediaDescriptor('urn:test:blob-y')),
      z: leafNode('z', documentDescriptor('doc-z')),
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })
    expect(documentFace.mounts).toHaveLength(2) // x and z
    expect(mediaFace.mounts).toHaveLength(1) // y

    const subWrapperBefore = interpreter.splitWrapperElement('Sub')
    const wrapperXBefore = interpreter.leafWrapperElement('x')
    const wrapperYBefore = interpreter.leafWrapperElement('y')
    expect(subWrapperBefore).not.toBeNull()

    // Move the ENTIRE 'Sub' subtree to become a sibling of leaf 'z'.
    const doc1 = applyOp(
      doc0,
      {
        op: 'move_node',
        nodeId: 'Sub',
        targetLeafId: 'z',
        side: 'end',
        axis: 'vertical',
        splitId: 'moved-ancestor-split',
        expectedParent: locateParent(doc0, 'Sub')!,
        expectedTargetParent: locateParent(doc0, 'z')!,
      },
      registry,
    )
    const result = await interpreter.reconcile(doc1, { width: 1000, height: 600 })
    expect(result.ok).toBe(true)

    // No remount anywhere in the moved subtree OR the untouched target.
    expect(documentFace.mounts).toHaveLength(2)
    expect(mediaFace.mounts).toHaveLength(1)
    for (const m of [...documentFace.mounts, ...mediaFace.mounts]) expect(m.disposed).toBe(false)
    expect(documentAdapter.loadCalls).toHaveLength(2) // x, z — never reloaded
    expect(blobAdapter.loadCalls).toHaveLength(1) // y — never reloaded
    expect(documentAdapter.disposeCalls).toHaveLength(0)
    expect(blobAdapter.disposeCalls).toHaveLength(0)

    // Sub's OWN split wrapper survives by reference — it is not a leaf, but
    // it is still a stable geometry node whose identity must follow it.
    expect(interpreter.splitWrapperElement('Sub')).toBe(subWrapperBefore)
    expect(interpreter.splitWrapperElement('Sub')!.isConnected).toBe(true)
    // Both descendant leaves' wrapper elements survive by reference too.
    expect(interpreter.leafWrapperElement('x')).toBe(wrapperXBefore)
    expect(interpreter.leafWrapperElement('y')).toBe(wrapperYBefore)
    expect(interpreter.leafWrapperElement('x')!.isConnected).toBe(true)
    expect(interpreter.leafWrapperElement('y')!.isConnected).toBe(true)
    // The new split exists; S1's old direct child slot is now the new split.
    expect(interpreter.splitWrapperElement('moved-ancestor-split')).not.toBeNull()

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — replace_descriptor DOES remount (the LAY-007 boundary)', () => {
  it('disposes the old view/lease exactly once and mounts a fresh one', async () => {
    const { registry, documentFace } = buildTestRegistry()
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('a', { a: leafNode('a', documentDescriptor('doc-a')) })
    await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(documentFace.mounts).toHaveLength(1)
    const firstRecord = documentFace.mounts[0]

    const doc1 = applyOp(
      doc0,
      {
        op: 'replace_descriptor',
        leafId: 'a',
        descriptor: documentDescriptor('doc-a-v2'),
        expectedDescriptorRevision: 0,
      },
      registry,
    )
    const result = await interpreter.reconcile(doc1, { width: 400, height: 300 })
    expect(result.ok).toBe(true)

    // The OLD view was disposed and its lease released...
    expect(firstRecord.disposed).toBe(true)
    expect(documentAdapter.disposeCalls).toHaveLength(1)
    // ...and a genuinely NEW view was mounted (not the same record reused).
    expect(documentFace.mounts).toHaveLength(2)
    expect(documentFace.mounts[1]).not.toBe(firstRecord)
    expect(documentFace.mounts[1].disposed).toBe(false)
    expect(documentAdapter.loadCalls).toHaveLength(2)

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — closing the last-referenced leaf tears it down once', () => {
  it('close_leaf disposes the view, releases the lease, and removes the wrapper', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = twoLeafDoc()
    await interpreter.reconcile(doc0, { width: 1001, height: 600 })

    const doc1 = applyOp(doc0, { op: 'close_leaf', leafId: 'b', expectedParent: locateParent(doc0, 'b')! }, registry)
    const result = await interpreter.reconcile(doc1, { width: 1001, height: 600 })
    expect(result.ok).toBe(true)

    expect(mediaFace.mounts[0].disposed).toBe(true)
    expect(blobAdapter.disposeCalls).toHaveLength(1)
    expect(interpreter.leafWrapperElement('b')).toBeNull()
    // The surviving leaf ('a') is untouched.
    expect(documentFace.mounts[0].disposed).toBe(false)
    expect(documentAdapter.disposeCalls).toHaveLength(0)

    await interpreter.dispose()
  })
})

// F4 (repair round 3): close/promote focus handoff — real DOM focus (not
// merely a recorded call — `createFocusableFace`'s `focus()` moves
// `document.activeElement` onto a real, tabbable element), the destination
// leaf id is NEVER supplied by the test, and every reconcile call is a
// production-shaped `interpreter.reconcile()` — nothing here reaches into
// interpreter internals.
describe('LayoutInterpreter — F4: close/promote focus handoff', () => {
  it('closing the FOCUSED leaf hands DOM focus to its promoted sibling, reason "promoted", with no destination supplied by the caller', async () => {
    const registry = new FaceRegistry()
    const focusable = createFocusableFace()
    registry.register(focusable.registration)
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0 = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: leafNode('a', focusableDescriptor('doc-a')),
      b: leafNode('b', focusableDescriptor('doc-b')),
    })
    await interpreter.reconcile(doc0, { width: 800, height: 400 })

    // Real DOM focus lands in leaf 'a', via the interpreter's own public API
    // — not a hand-rolled `.focus()` on the element (this proves the SAME
    // route a real activation would use).
    expect(await interpreter.focus('a')).toBe(true)
    expect(document.activeElement).toBe(interpreter.leafWrapperElement('a')!.querySelector('[data-face]'))

    const doc1 = applyOp(doc0, { op: 'close_leaf', leafId: 'a', expectedParent: locateParent(doc0, 'a')! }, registry)
    const bFocusCallsBefore = focusable.mounts[1]!.focusCalls.length
    const result = await interpreter.reconcile(doc1, { width: 800, height: 400 })
    expect(result.ok).toBe(true)

    // 'a' is gone; DOM focus must have moved to 'b' (its only sibling, hence
    // the promoted leaf) WITHOUT this test ever calling `interpreter.focus`
    // again or naming 'b' anywhere in the close operation.
    expect(interpreter.leafWrapperElement('a')).toBeNull()
    expect(document.activeElement).toBe(interpreter.leafWrapperElement('b')!.querySelector('[data-face]'))
    expect(focusable.mounts[1]!.focusCalls.length).toBe(bFocusCallsBefore + 1)
    expect(focusable.mounts[1]!.focusCalls.at(-1)).toEqual({ reason: 'promoted' })

    await interpreter.dispose()
  })

  it('closing a leaf that did NOT hold focus never hands focus to anything (no phantom promotion)', async () => {
    const registry = new FaceRegistry()
    const focusable = createFocusableFace()
    registry.register(focusable.registration)
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0 = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: leafNode('a', focusableDescriptor('doc-a')),
      b: leafNode('b', focusableDescriptor('doc-b')),
    })
    await interpreter.reconcile(doc0, { width: 800, height: 400 })
    // Deliberately give focus to 'a', then close the OTHER leaf ('b') —
    // 'a' never lost focus, so there is nothing to hand off.
    expect(await interpreter.focus('a')).toBe(true)
    const aFocusCallsBefore = focusable.mounts[0]!.focusCalls.length

    const doc1 = applyOp(doc0, { op: 'close_leaf', leafId: 'b', expectedParent: locateParent(doc0, 'b')! }, registry)
    await interpreter.reconcile(doc1, { width: 800, height: 400 })

    expect(document.activeElement).toBe(interpreter.leafWrapperElement('a')!.querySelector('[data-face]'))
    expect(focusable.mounts[0]!.focusCalls.length).toBe(aFocusCallsBefore) // no extra/handoff focus() call

    await interpreter.dispose()
  })

  it('when the promoted sibling is itself a SPLIT subtree, focus lands on its leftmost leaf', async () => {
    const registry = new FaceRegistry()
    const focusable = createFocusableFace()
    registry.register(focusable.registration)
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    // a | (c / d) — closing 'a' promotes the WHOLE (c/d) split into a's old
    // slot; the leftmost leaf under it ('c') is where focus should land.
    const doc0 = freshDocument('outer', {
      outer: splitNode('outer', 'horizontal', 'a', 'inner', 5000),
      a: leafNode('a', focusableDescriptor('doc-a')),
      inner: splitNode('inner', 'vertical', 'c', 'd', 5000),
      c: leafNode('c', focusableDescriptor('doc-c')),
      d: leafNode('d', focusableDescriptor('doc-d')),
    })
    await interpreter.reconcile(doc0, { width: 800, height: 400 })
    expect(await interpreter.focus('a')).toBe(true)

    const doc1 = applyOp(doc0, { op: 'close_leaf', leafId: 'a', expectedParent: locateParent(doc0, 'a')! }, registry)
    await interpreter.reconcile(doc1, { width: 800, height: 400 })

    expect(interpreter.leafWrapperElement('a')).toBeNull()
    expect(document.activeElement).toBe(interpreter.leafWrapperElement('c')!.querySelector('[data-face]'))

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — LAY-012: an invalid document never touches previously mounted state', () => {
  it('returns ok:false and leaves the prior mount/DOM exactly as it was', async () => {
    const { registry, documentFace } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('a', { a: leafNode('a', documentDescriptor('doc-a')) })
    await interpreter.reconcile(doc0, { width: 400, height: 300 })
    const wrapperBefore = interpreter.leafWrapperElement('a')
    const styleBefore = wrapperBefore!.style.width

    const broken: LayoutDocument = { ...doc0, rootNodeId: 'does-not-exist' }
    const result = await interpreter.reconcile(broken, { width: 400, height: 300 })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)

    expect(documentFace.mounts).toHaveLength(1) // no remount attempt at all
    expect(documentFace.mounts[0].disposed).toBe(false)
    expect(interpreter.leafWrapperElement('a')).toBe(wrapperBefore)
    expect(wrapperBefore!.style.width).toBe(styleBefore)

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — a resource the broker cannot resolve renders an error leaf, not a crash', () => {
  it('reconcile still returns ok:true; the leaf gets a diagnosable error element instead of a mounted face', async () => {
    const { registry, documentFace } = buildTestRegistry()
    // A broker with ONLY the blob adapter registered — no adapter accepts a
    // 'document' locator, so acquiring one must fail with NoResourceAdapterError.
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createBlobAdapter().adapter)
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0 = freshDocument('a', { a: leafNode('a', documentDescriptor('doc-unresolvable')) })
    const result = await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(result.ok).toBe(true) // the DOCUMENT is valid; only the resource failed to resolve
    const wrapper = interpreter.leafWrapperElement('a')
    expect(wrapper!.getAttribute('data-layout-error-reason')).toBe('resource-unavailable')
    expect(interpreter.mountedView('a')).toBeNull()
    expect(documentFace.mounts).toHaveLength(0) // mount() was never reached

    await interpreter.dispose()
  })
})

// diff-review r2 MISSING: "minimum constraints ... not exercised" — the
// solver already computes LayoutPlanNode.constrained (nucleus solver.ts),
// but the interpreter never surfaced it onto the DOM at all (design §6.2:
// "mark affected wrappers data-layout-constrained and expose a diagnostic").
describe('LayoutInterpreter — data-layout-constrained (design §6.2)', () => {
  it('marks a leaf wrapper data-layout-constrained when the container is smaller than its declared minimum', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    // test.document-face declares minWidth:200, minHeight:120 (fixtures.ts).
    const doc0 = freshDocument('a', { a: leafNode('a', documentDescriptor('doc-a')) })

    const fits = await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(fits.ok).toBe(true)
    expect(interpreter.leafWrapperElement('a')!.hasAttribute('data-layout-constrained')).toBe(false)

    const tooSmall = await interpreter.reconcile(doc0, { width: 50, height: 40 })
    expect(tooSmall.ok).toBe(true) // LAY-012's infeasibility path never mutates the document — it still solves an emergency floor
    expect(interpreter.leafWrapperElement('a')!.getAttribute('data-layout-constrained')).toBe('true')
    // The wrapper still fully covers the (too-small) container — an
    // emergency floor allocation, not a crash or a zero-size box.
    const style = interpreter.leafWrapperElement('a')!.style
    expect(Number.parseFloat(style.width)).toBeGreaterThan(0)
    expect(Number.parseFloat(style.height)).toBeGreaterThan(0)

    // Growing back past the minimum clears the mark — it is live, not sticky.
    const fitsAgain = await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(fitsAgain.ok).toBe(true)
    expect(interpreter.leafWrapperElement('a')!.hasAttribute('data-layout-constrained')).toBe(false)

    await interpreter.dispose()
  })

  it('marks the SPLIT wrapper too when a descendant leaf is constrained', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = twoLeafDoc()

    await interpreter.reconcile(doc0, { width: 30, height: 30 })
    expect(interpreter.splitWrapperElement('split')!.getAttribute('data-layout-constrained')).toBe('true')

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter.dispose', () => {
  it('tears down every mounted view/lease and clears the DOM', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    await interpreter.reconcile(twoLeafDoc(), { width: 1001, height: 600 })

    await interpreter.dispose()

    expect(documentFace.mounts[0].disposed).toBe(true)
    expect(mediaFace.mounts[0].disposed).toBe(true)
    expect(documentAdapter.disposeCalls).toHaveLength(1)
    expect(blobAdapter.disposeCalls).toHaveLength(1)
    expect(root.children).toHaveLength(0)
    expect(interpreter.diagnostics().mountedLeafIds).toEqual([])

    await expect(interpreter.reconcile(twoLeafDoc(), { width: 400, height: 300 })).rejects.toThrow(
      /after dispose/,
    )
  })
})

describe('LayoutInterpreter — every wrapper is a DIRECT child of root, at ANY nesting depth', () => {
  it('a two-levels-deep split tree still parents every leaf/split wrapper straight to root, geometry root-absolute', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    // root S1(horizontal): start=a | end=S2(vertical): start=b / end=c — TWO
    // levels of split nesting, the exact shape the double-offset bug
    // (diff-review WRONG "the DOM is never allowed to disagree with the
    // solver, at any nesting depth") needed to manifest: a naive
    // `appendChild`-nested renderer would place `c`'s wrapper inside `S2`'s
    // wrapper (itself offset from root), double-counting S2's own offset.
    const nested = freshDocument('S1', {
      S1: splitNode('S1', 'horizontal', 'a', 'S2', 5000),
      S2: splitNode('S2', 'vertical', 'b', 'c', 5000),
      a: leafNode('a', documentDescriptor('doc-a')),
      b: leafNode('b', mediaDescriptor('urn:test:blob-b')),
      c: leafNode('c', documentDescriptor('doc-c')),
    })
    const result = await interpreter.reconcile(nested, { width: 1000, height: 600 })
    expect(result.ok).toBe(true)

    const s1El = interpreter.splitWrapperElement('S1')!
    const s2El = interpreter.splitWrapperElement('S2')!
    const aEl = interpreter.leafWrapperElement('a')!
    const bEl = interpreter.leafWrapperElement('b')!
    const cEl = interpreter.leafWrapperElement('c')!

    // Structural invariant: NOTHING is ever a DOM child of a split wrapper —
    // every wrapper (however deep in the LOGICAL tree) is a direct child of
    // `root` in the ACTUAL DOM.
    for (const el of [s1El, s2El, aEl, bEl, cEl]) {
      expect(el.parentElement).toBe(root)
    }

    // Geometry invariant: each wrapper's rendered position is the solver's
    // plan allocation VERBATIM — never adjusted for (nonexistent) DOM
    // nesting. `c` is the deepest node (child of S2, which is itself the end
    // child of S1) — the exact position a double-offset bug would corrupt.
    const plan = interpreter.currentPlan()!
    function findNode(node: typeof plan.root, id: string): typeof plan.root | null {
      if (node.id === id) return node
      if (node.kind === 'split') return findNode(node.start, id) ?? findNode(node.end, id)
      return null
    }
    for (const [id, el] of [['S1', s1El], ['S2', s2El], ['a', aEl], ['b', bEl], ['c', cEl]] as const) {
      const planned = findNode(plan.root, id)!
      expect(el.style.left).toBe(`${planned.allocation.x}px`)
      expect(el.style.top).toBe(`${planned.allocation.y}px`)
      expect(el.style.width).toBe(`${planned.allocation.width}px`)
      expect(el.style.height).toBe(`${planned.allocation.height}px`)
    }
    // `c`'s allocation.x must be STRICTLY greater than S2's own — i.e. it is
    // genuinely offset from the container origin, not accidentally zero
    // (which would make a double-offset bug invisible even to this check).
    const cPlanned = findNode(plan.root, 'c')!
    expect(cPlanned.allocation.x).toBeGreaterThan(0)

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — failure paths release leases and clear bookkeeping (diff-review WRONG)', () => {
  it('mount() throwing after the lease was acquired still releases the lease (no leak)', async () => {
    const registry = new FaceRegistry()
    const throwingFace: FaceRegistration = {
      faceId: 'test.throws-on-mount',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('boom: mount always fails')
      },
    }
    registry.register(throwingFace)
    // `buildTestBroker()`'s real document adapter accepts `{kind:'document'}`
    // locators regardless of faceId — the descriptor below routes to it, so
    // `broker.acquire` succeeds (the lease IS handed out) and only the
    // FACE's `mount()` fails.
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('a', {
      a: { kind: 'leaf', id: 'a', descriptor: { schemaVersion: 1, faceId: 'test.throws-on-mount', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-a' } }, descriptorRevision: 0 },
    })
    const result = await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(result.ok).toBe(true) // the DOCUMENT is valid; the FACE's own mount failure is a diagnosable per-leaf error, not a reconcile failure
    expect(documentAdapter.loadCalls).toHaveLength(1) // the lease WAS acquired…
    expect(documentAdapter.disposeCalls).toHaveLength(1) // …and released, even though mount() never returned a view
    expect(interpreter.mountedView('a')).toBeNull()
    expect(interpreter.leafWrapperElement('a')!.getAttribute('data-layout-error-reason')).toBe('mount-failed')

    await interpreter.dispose()
  })

  it('the INITIAL resize() throwing (mount() itself succeeded) still releases the lease and disposes the partial view', async () => {
    const registry = new FaceRegistry()
    let mountedViewDisposeReasons: unknown[] = []
    const throwingFace: FaceRegistration = {
      faceId: 'test.throws-on-initial-resize',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => ({
        focus: () => true,
        blur: () => {},
        resize: () => {
          throw new Error('boom: initial resize always fails')
        },
        serialize: (): never => {
          throw new Error('unreachable in this test')
        },
        dispose: (reason: unknown) => {
          mountedViewDisposeReasons.push(reason)
        },
      }),
    }
    registry.register(throwingFace)
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('a', {
      a: { kind: 'leaf', id: 'a', descriptor: { schemaVersion: 1, faceId: 'test.throws-on-initial-resize', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-a' } }, descriptorRevision: 0 },
    })
    const result = await interpreter.reconcile(doc0, { width: 400, height: 300 })
    expect(result.ok).toBe(true) // per-leaf error, not a reconcile failure

    // mount() DID return a view — the interpreter's ownership guard must have
    // called dispose() on that partially-constructed view (best-effort, since
    // resize() never completed) before treating the leaf as unmounted.
    expect(mountedViewDisposeReasons).toEqual(['unmountable'])
    expect(documentAdapter.loadCalls).toHaveLength(1) // the lease WAS acquired…
    expect(documentAdapter.disposeCalls).toHaveLength(1) // …and released
    expect(interpreter.mountedView('a')).toBeNull() // never tracked as mounted — resize() never completed
    expect(interpreter.leafWrapperElement('a')!.getAttribute('data-layout-error-reason')).toBe('mount-failed')

    await interpreter.dispose()
  })

  it('a throwing view.dispose() when a NON-root leaf closes (pruneStale) still releases the lease and clears bookkeeping', async () => {
    // Leaf 'b' below needs a REGISTERED face too (`mediaDescriptor` names
    // `test.media-face`) — reuse the fixtures' real media face registration
    // rather than a fresh, empty registry that would fail LAY-003 for 'b'
    // and never mount anything at all.
    const { registry } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const throwingDisposeFace: FaceRegistration = {
      faceId: 'test.throws-on-dispose',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => ({
        focus: () => true,
        blur: () => {},
        resize: () => {},
        serialize: (): never => {
          throw new Error('unreachable in this test')
        },
        dispose: () => {
          throw new Error('boom: dispose always fails')
        },
      }),
    }
    registry.register(throwingDisposeFace)
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    // Two leaves so closing 'a' goes through `pruneStale` (a genuinely
    // removed leaf, sibling promoted) rather than LAY-010's root-replacement
    // path — the scenario this fix's "aggregate errors after all leaves are
    // cleaned up" language actually describes.
    const doc0 = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: { kind: 'leaf', id: 'a', descriptor: { schemaVersion: 1, faceId: 'test.throws-on-dispose', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-a' } }, descriptorRevision: 0 },
      b: leafNode('b', mediaDescriptor('urn:test:blob-b')),
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })
    expect(interpreter.mountedView('a')).not.toBeNull()

    const doc1 = applyOp(doc0, { op: 'close_leaf', leafId: 'a', expectedParent: locateParent(doc0, 'a')! }, registry)
    // `pruneStale` aggregates and re-throws — the CALLER learns something
    // went wrong — but bookkeeping/lease-release must have ALREADY happened
    // by the time it does (see the assertions below, made after the throw).
    await expect(interpreter.reconcile(doc1, { width: 1000, height: 600 })).rejects.toThrow(/FaceView\.dispose\(\) calls threw/i)

    expect(interpreter.mountedView('a')).toBeNull() // bookkeeping cleared despite the throw
    expect(documentAdapter.disposeCalls).toHaveLength(1) // the lease WAS released despite the throw
    expect(interpreter.leafWrapperElement('a')).toBeNull() // the wrapper was still removed
    // The surviving leaf's own resource is untouched by 'a''s dispose failure.
    expect(blobAdapter.disposeCalls).toHaveLength(0)

    await interpreter.dispose()
  })

  it('LayoutInterpreter.dispose() tears down EVERY leaf even when one throws, then aggregates the error(s)', async () => {
    const registry = new FaceRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    let goodDisposed = false
    const throwingFace: FaceRegistration = {
      faceId: 'test.throws-on-dispose-2',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => ({
        focus: () => true,
        blur: () => {},
        resize: () => {},
        serialize: (): never => {
          throw new Error('unreachable in this test')
        },
        dispose: () => {
          throw new Error('boom: this leaf never disposes cleanly')
        },
      }),
    }
    const goodFace: FaceRegistration = {
      faceId: 'test.disposes-fine',
      persistence: 'stamp',
      resourceAdapterId: 'test.blob-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => ({
        focus: () => true,
        blur: () => {},
        resize: () => {},
        serialize: (): never => {
          throw new Error('unreachable in this test')
        },
        dispose: () => {
          goodDisposed = true
        },
      }),
    }
    registry.register(throwingFace)
    registry.register(goodFace)
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'bad', 'good', 5000),
      bad: { kind: 'leaf', id: 'bad', descriptor: { schemaVersion: 1, faceId: 'test.throws-on-dispose-2', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-bad' } }, descriptorRevision: 0 },
      good: { kind: 'leaf', id: 'good', descriptor: { schemaVersion: 1, faceId: 'test.disposes-fine', resource: { kind: 'iri', iri: 'urn:test:blob-good' } }, descriptorRevision: 0 },
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })

    await expect(interpreter.dispose()).rejects.toThrow(/dispose\(\) calls threw/i)

    // The THROWING leaf's lease was still released…
    expect(documentAdapter.disposeCalls).toHaveLength(1)
    // …and the OTHER (well-behaved) leaf was torn down too — one throwing
    // view must not prevent every other mounted leaf from being cleaned up.
    expect(goodDisposed).toBe(true)
    expect(blobAdapter.disposeCalls).toHaveLength(1)
    expect(interpreter.diagnostics().mountedLeafIds).toEqual([])
    expect(root.children).toHaveLength(0)
  })

  // diff-review r2 WRONG: "lease release can still throw synchronously: the
  // broker invokes adapter.dispose() before Promise.resolve ... the
  // interpreter calls lease.release() in finally without catching it; such a
  // throw aborts the outer disposal loop after disposed is already set". A
  // real `LayoutResourceBroker` is now non-throwing by construction
  // (resource-broker.test.ts's own "release() never throws" suite), so THIS
  // test exercises the interpreter's OWN independent guard: a real,
  // hand-written `ResourceBroker` implementation (not `LayoutResourceBroker`)
  // whose `lease.release()` itself throws synchronously — the interpreter
  // must not assume every `ResourceBroker` implementation is well-behaved.
  it('a SYNCHRONOUSLY throwing lease.release() (a non-LayoutResourceBroker implementation) still lets every other leaf tear down, and is aggregated', async () => {
    const releaseCalls: string[] = []
    const throwingReleaseBroker: ResourceBroker = {
      registerAdapter(_adapter: ResourceAdapter): void {},
      async acquire(locator, _adapterId): Promise<ResourceLease> {
        const key = locator.kind === 'document' ? locator.documentId : locator.kind === 'iri' ? locator.iri : 'other'
        const lease: ResourceLease = {
          key,
          shape: 'durable',
          value: { key },
          released: false,
          release(): void {
            releaseCalls.push(key)
            throw new Error(`boom: release() itself throws for ${key}`)
          },
        }
        return lease
      },
      diagnostics(): ResourceBrokerDiagnostics {
        return { durableRefCounts: {}, outstandingLeases: 0, disposalErrorCount: 0 }
      },
    }
    const registry = new FaceRegistry()
    let goodDisposed = false
    const plainFace = (id: string, onDispose: () => void): FaceRegistration => ({
      faceId: id,
      persistence: 'stamp',
      // Irrelevant to this test's own fake broker (it ignores adapterId
      // entirely and returns a lease unconditionally) — present only to
      // satisfy the FaceRegistration contract.
      resourceAdapterId: 'irrelevant',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => ({
        focus: () => true,
        blur: () => {},
        resize: () => {},
        serialize: (): never => { throw new Error('unreachable in this test') },
        dispose: onDispose,
      }),
    })
    registry.register(plainFace('test.release-throws-a', () => {}))
    registry.register(plainFace('test.release-throws-b', () => { goodDisposed = true }))
    const interpreter = new LayoutInterpreter(root, { registry, broker: throwingReleaseBroker })
    const doc0 = freshDocument('split', {
      split: splitNode('split', 'horizontal', 'a', 'b', 5000),
      a: { kind: 'leaf', id: 'a', descriptor: { schemaVersion: 1, faceId: 'test.release-throws-a', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-a' } }, descriptorRevision: 0 },
      b: { kind: 'leaf', id: 'b', descriptor: { schemaVersion: 1, faceId: 'test.release-throws-b', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-b' } }, descriptorRevision: 0 },
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })

    await expect(interpreter.dispose()).rejects.toThrow(/dispose\(\) calls threw/i)

    // BOTH leaves' release() were called despite 'a''s throwing first — the
    // throw did not abort the loop before 'b' was even reached.
    expect(releaseCalls.sort()).toEqual(['doc-a', 'doc-b'])
    expect(goodDisposed).toBe(true)
    expect(interpreter.diagnostics().mountedLeafIds).toEqual([])
    expect(root.children).toHaveLength(0)
  })
})
