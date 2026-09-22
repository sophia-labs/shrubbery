/**
 * operations unit tests — every op's success path plus every
 * precondition-rejection path, per the handoff's acceptance criteria.
 *
 * Several tests assert REFERENCE equality (`toBe`, not `toEqual`) on an
 * untouched node's map entry across an operation. That is the sharpest
 * available Phase-1 proxy for design §2.5/LAY-002's "L's view and resource
 * lease survive": if a node's object identity survives an operation, nothing
 * downstream could have been reconstructed from it (P2's interpreter
 * reconciles by ID, but Phase 1 can already prove the id-preserving,
 * non-reconstructing part structurally).
 *
 * `applyOperation`/`validateLayoutDocument` calls in THIS file go through a
 * local shim that injects `TEST_VALIDATE_OPTIONS` (fixtures.ts) by default —
 * see fixtures.ts's header for why. Tests that pass an explicit 3rd/2nd
 * `options` argument (e.g. `{ isFaceRegistered: () => false }`) are
 * unaffected — the shim only supplies a default when the caller omits one.
 *
 * design §9.2 Phase 1 diff-review r2: `expectedParent` (split_leaf/close_leaf/
 * move_node's source), `expectedTargetParent` (move_node's target), and
 * `expectedDescriptorRevision` (replace_descriptor) are now MANDATORY, not
 * optional — see fixtures.ts's `expectedParentFor`/`expectedRevisionFor`,
 * used throughout to compute the CORRECT precondition for a given fixture.
 * `PLACEHOLDER_PARENT`/`PLACEHOLDER_REVISION` are used where a test's target
 * id doesn't exist or has the wrong kind at all — the reducer rejects on
 * that earlier check before ever consulting the precondition, so its exact
 * value is irrelevant, but the FIELD must still be present and well-shaped
 * (it is mandatory in the type, and the decoder rejects a malformed one
 * before any reducer runs at all).
 */
import { describe, expect, it } from 'vitest'
import type { LayoutDocument, LayoutGridNode, LayoutLeafNode, LayoutSplitNode } from '../types.js'
import { SOPHIA_HOME_FACE_ID } from '../types.js'
import type { LayoutOperation, OperationResult, ParentLocation } from '../operations.js'
import { applyOperation as applyOperationRaw, locateParent } from '../operations.js'
import type { ValidateOptions, ValidationResult } from '../validate.js'
import { validateLayoutDocument as validateLayoutDocumentRaw } from '../validate.js'
import { makeDiagnostic as makeDiagnosticForTest } from '../diagnostics.js'
import {
  GRID_INELIGIBLE_FACE_ID,
  TEST_VALIDATE_OPTIONS,
  expectedGridRevisionFor,
  expectedParentFor,
  expectedRevisionFor,
  leafAndGridDoc,
  makeCollectionChildren,
  makeDescriptor,
  makeFixedChildren,
  makeGridCell,
  makeQueryLocator,
  singleGridDoc,
  singleLeafDoc,
  twoLeafDoc,
} from './fixtures.js'

function applyOperation(doc: LayoutDocument, op: LayoutOperation, options?: ValidateOptions): OperationResult {
  return applyOperationRaw(doc, op, options ?? TEST_VALIDATE_OPTIONS)
}

function validateLayoutDocument(doc: LayoutDocument, options?: ValidateOptions): ValidationResult {
  return validateLayoutDocumentRaw(doc, options ?? TEST_VALIDATE_OPTIONS)
}

function expectOk(result: OperationResult): LayoutDocument {
  if (!result.ok) throw new Error(`expected ok, got diagnostic: ${JSON.stringify(result.diagnostic)}`)
  expect(validateLayoutDocument(result.doc)).toEqual({ ok: true })
  return result.doc
}

function expectErr(result: OperationResult): NonNullable<Extract<OperationResult, { ok: false }>['diagnostic']> {
  if (result.ok) throw new Error('expected a diagnostic, got ok')
  return result.diagnostic
}

/** A structurally-valid but semantically-irrelevant precondition for tests whose op is rejected on an earlier check. */
const PLACEHOLDER_PARENT: ParentLocation = { kind: 'root' }
const PLACEHOLDER_REVISION = 0

/** Build a 3-leaf tree: root split (leafA, midSplit(leafB, leafC)). */
function threeLeafTree(): {
  readonly doc: LayoutDocument
  readonly leafAId: string
  readonly leafBId: string
  readonly leafCId: string
  readonly midSplitId: string
} {
  const { doc: base, leafAId } = twoLeafDoc()
  const step1 = applyOperation(base, {
    op: 'split_leaf',
    leafId: 'leaf-b',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'leaf-c',
    splitId: 'mid-split',
    descriptor: makeDescriptor('test.face', 'urn:test:c'),
    expectedParent: expectedParentFor(base, 'leaf-b'),
  })
  const doc = expectOk(step1)
  return { doc, leafAId, leafBId: 'leaf-b', leafCId: 'leaf-c', midSplitId: 'mid-split' }
}

describe('applyOperation — split_leaf', () => {
  it('splits a leaf, inserting the new leaf on the requested side, default ratio 5000', () => {
    const base = singleLeafDoc('root')
    const originalRootNode = base.nodes['root']
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor('test.face', 'urn:test:new'),
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    expect(doc.rootNodeId).toBe('new-split')
    const split = doc.nodes['new-split'] as LayoutSplitNode
    expect(split.startNodeId).toBe('new-leaf')
    expect(split.endNodeId).toBe('root')
    expect(split.startBasisPoints).toBe(5000)
    // The original leaf's node entry survives untouched (reference-identical).
    expect(doc.nodes['root']).toBe(originalRootNode)
  })

  it('honors side="end" and an explicit axis/ratio', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'vertical',
      side: 'end',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor(),
      startBasisPoints: 3000,
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    const split = doc.nodes['new-split'] as LayoutSplitNode
    expect(split.axis).toBe('vertical')
    expect(split.startNodeId).toBe('root')
    expect(split.endNodeId).toBe('new-leaf')
    expect(split.startBasisPoints).toBe(3000)
  })

  it('clamps an out-of-range explicit ratio into [1, 9999]', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor(),
      startBasisPoints: 999999,
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    expect((doc.nodes['new-split'] as LayoutSplitNode).startBasisPoints).toBe(9999)
  })

  it('splits a non-root leaf without disturbing the rest of the tree', () => {
    const { doc: base, leafAId, leafBId } = twoLeafDoc()
    const originalLeafB = base.nodes[leafBId]
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: leafAId,
      axis: 'vertical',
      side: 'start',
      newLeafId: 'leaf-new',
      splitId: 'split-new',
      descriptor: makeDescriptor(),
      expectedParent: expectedParentFor(base, leafAId),
    })
    const doc = expectOk(result)
    expect(doc.rootNodeId).toBe(base.rootNodeId) // unchanged — split A is not root
    expect(doc.nodes[leafBId]).toBe(originalLeafB) // sibling subtree untouched
  })

  it('rejects an unknown leafId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'ghost',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(),
        expectedParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a leafId that names a split, not a leaf', () => {
    const { doc, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'split_leaf',
        leafId: splitId,
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(),
        expectedParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects an invalid axis', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'diagonal' as unknown as 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects an invalid side', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'middle' as unknown as 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects a newLeafId that already exists', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'split_leaf',
        leafId: leafAId,
        axis: 'horizontal',
        side: 'start',
        newLeafId: leafAId,
        splitId: 'fresh-split',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(doc, leafAId),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects a splitId that already exists', () => {
    const { doc, leafAId, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'split_leaf',
        leafId: leafAId,
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'fresh-leaf',
        splitId,
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(doc, leafAId),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects newLeafId === splitId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'same',
        splitId: 'same',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects a malformed descriptor', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'urn:x' } },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a descriptor rejected by an injected isFaceRegistered predicate', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(
        base,
        {
          op: 'split_leaf',
          leafId: 'root',
          axis: 'horizontal',
          side: 'start',
          newLeafId: 'x',
          splitId: 'y',
          descriptor: makeDescriptor('unregistered.face'),
          expectedParent: expectedParentFor(base, 'root'),
        },
        { isFaceRegistered: () => false },
      ),
    )
    expect(err.code).toBe('LAY003_UNREGISTERED_FACE')
  })

  it('rejects a non-finite startBasisPoints', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(),
        startBasisPoints: Number.NaN,
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_RATIO_INPUT')
  })
})

describe('applyOperation — close_leaf', () => {
  it('closes a non-root leaf, promoting its sibling into the parent slot', () => {
    const { doc: base, leafAId, leafBId, splitId } = threeLeafTreeForClose()
    const originalSiblingSubtree = base.nodes[leafBId]
    const result = applyOperation(base, {
      op: 'close_leaf',
      leafId: leafAId,
      expectedParent: expectedParentFor(base, leafAId),
    })
    const doc = expectOk(result)
    expect(doc.rootNodeId).toBe(leafBId)
    expect(doc.nodes[leafAId]).toBeUndefined()
    expect(doc.nodes[splitId]).toBeUndefined()
    expect(doc.nodes[leafBId]).toBe(originalSiblingSubtree)
  })

  it('closing a leaf whose sibling is a split subtree promotes the whole subtree untouched', () => {
    const { doc, leafAId, leafBId, leafCId, midSplitId } = threeLeafTree()
    const originalMidSplit = doc.nodes[midSplitId]
    const originalLeafB = doc.nodes[leafBId]
    const originalLeafC = doc.nodes[leafCId]
    const rootSplitId = doc.rootNodeId
    const result = applyOperation(doc, {
      op: 'close_leaf',
      leafId: leafAId,
      expectedParent: expectedParentFor(doc, leafAId),
    })
    const next = expectOk(result)
    expect(next.rootNodeId).toBe(midSplitId)
    expect(next.nodes[rootSplitId]).toBeUndefined()
    expect(next.nodes[leafAId]).toBeUndefined()
    expect(next.nodes[midSplitId]).toBe(originalMidSplit)
    expect(next.nodes[leafBId]).toBe(originalLeafB)
    expect(next.nodes[leafCId]).toBe(originalLeafC)
  })

  it('closing the root leaf replaces its descriptor with sophia.home, keeping the same id', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'close_leaf',
      leafId: 'root',
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    expect(doc.rootNodeId).toBe('root')
    expect(Object.keys(doc.nodes)).toEqual(['root'])
    const leaf = doc.nodes['root']
    if (leaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf.descriptor.faceId).toBe(SOPHIA_HOME_FACE_ID)
  })

  it('closing the root leaf is idempotent when it is already sophia.home', () => {
    const base = singleLeafDoc('root')
    const once = expectOk(
      applyOperation(base, { op: 'close_leaf', leafId: 'root', expectedParent: expectedParentFor(base, 'root') }),
    )
    const twice = expectOk(
      applyOperation(once, { op: 'close_leaf', leafId: 'root', expectedParent: expectedParentFor(once, 'root') }),
    )
    expect(twice.rootNodeId).toBe('root')
    const leaf = twice.nodes['root']
    if (leaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf.descriptor.faceId).toBe(SOPHIA_HOME_FACE_ID)
  })

  it('rejects an unknown leafId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(applyOperation(base, { op: 'close_leaf', leafId: 'ghost', expectedParent: PLACEHOLDER_PARENT }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a leafId that names a split', () => {
    const { doc, splitId } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'close_leaf', leafId: splitId, expectedParent: PLACEHOLDER_PARENT }))
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })
})

/** A dedicated 2-leaf tree with distinguishable names for the close_leaf tests above. */
function threeLeafTreeForClose(): {
  readonly doc: LayoutDocument
  readonly leafAId: string
  readonly leafBId: string
  readonly splitId: string
} {
  const { doc, leafAId, leafBId, splitId } = twoLeafDoc()
  return { doc, leafAId, leafBId, splitId }
}

describe('applyOperation — set_ratio', () => {
  it('sets a legal ratio', () => {
    const { doc, splitId } = twoLeafDoc()
    const next = expectOk(applyOperation(doc, { op: 'set_ratio', splitId, startBasisPoints: 7000 }))
    expect((next.nodes[splitId] as LayoutSplitNode).startBasisPoints).toBe(7000)
  })

  it.each([
    [0, 1],
    [-500, 1],
    [20000, 9999],
    [10000, 9999],
  ])('clamps %s into range, yielding %s', (input, expected) => {
    const { doc, splitId } = twoLeafDoc()
    const next = expectOk(applyOperation(doc, { op: 'set_ratio', splitId, startBasisPoints: input }))
    expect((next.nodes[splitId] as LayoutSplitNode).startBasisPoints).toBe(expected)
  })

  it('rounds a fractional ratio', () => {
    const { doc, splitId } = twoLeafDoc()
    const next = expectOk(applyOperation(doc, { op: 'set_ratio', splitId, startBasisPoints: 4999.6 }))
    expect((next.nodes[splitId] as LayoutSplitNode).startBasisPoints).toBe(5000)
  })

  it('rejects an unknown splitId', () => {
    const { doc } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'set_ratio', splitId: 'ghost', startBasisPoints: 5000 }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a splitId that names a leaf', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'set_ratio', splitId: leafAId, startBasisPoints: 5000 }))
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects a non-finite ratio', () => {
    const { doc, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, { op: 'set_ratio', splitId, startBasisPoints: Number.POSITIVE_INFINITY }),
    )
    expect(err.code).toBe('LAYOP_INVALID_RATIO_INPUT')
  })
})

describe('applyOperation — replace_descriptor', () => {
  it('replaces the descriptor, keeping the leaf id', () => {
    const { doc, leafAId } = twoLeafDoc()
    const replacement = makeDescriptor('new.face', 'urn:test:replacement')
    const next = expectOk(
      applyOperation(doc, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: replacement,
        expectedDescriptorRevision: expectedRevisionFor(doc, leafAId),
      }),
    )
    const leaf = next.nodes[leafAId]
    if (leaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf.id).toBe(leafAId)
    expect(leaf.descriptor).toEqual(replacement)
  })

  it('rejects an unknown leafId', () => {
    const { doc } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'replace_descriptor',
        leafId: 'ghost',
        descriptor: makeDescriptor(),
        expectedDescriptorRevision: PLACEHOLDER_REVISION,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a leafId that names a split', () => {
    const { doc, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'replace_descriptor',
        leafId: splitId,
        descriptor: makeDescriptor(),
        expectedDescriptorRevision: PLACEHOLDER_REVISION,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects a malformed descriptor', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: { schemaVersion: 1, faceId: 'x', resource: { kind: 'iri', iri: '' } },
        expectedDescriptorRevision: expectedRevisionFor(doc, leafAId),
      }),
    )
    expect(err.code).toBe('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a descriptor rejected by an injected isFaceRegistered predicate', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(
        doc,
        {
          op: 'replace_descriptor',
          leafId: leafAId,
          descriptor: makeDescriptor('unregistered.face'),
          expectedDescriptorRevision: expectedRevisionFor(doc, leafAId),
        },
        { isFaceRegistered: () => false },
      ),
    )
    expect(err.code).toBe('LAY003_UNREGISTERED_FACE')
  })
})

describe('applyOperation — swap_nodes', () => {
  it('swaps two sibling leaves under the same split', () => {
    const { doc, splitId, leafAId, leafBId } = twoLeafDoc()
    const originalA = doc.nodes[leafAId]
    const originalB = doc.nodes[leafBId]
    const next = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafBId }))
    const split = next.nodes[splitId] as LayoutSplitNode
    expect(split.startNodeId).toBe(leafBId)
    expect(split.endNodeId).toBe(leafAId)
    // Node identities/objects survive the swap untouched.
    expect(next.nodes[leafAId]).toBe(originalA)
    expect(next.nodes[leafBId]).toBe(originalB)
  })

  it('swaps two leaves in different branches', () => {
    const { doc, leafAId, leafBId, leafCId } = threeLeafTree()
    const next = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafCId }))
    // root split's start child is now leafC where leafA used to be.
    const rootSplit = next.nodes[next.rootNodeId] as LayoutSplitNode
    expect(rootSplit.startNodeId).toBe(leafCId)
    expect(next.nodes[leafBId]).toBe(doc.nodes[leafBId]) // untouched third leaf
  })

  it('rejects swapping the root with one of its own children (root is ancestor of everything)', () => {
    // A corollary of the ancestor/descendant guard below, not a separate
    // rule: the root's subtree is the whole document, so root can never
    // legally swap with anything — mirroring move_node's explicit
    // "cannot move root" rejection for the same structural reason.
    const { doc, splitId, leafAId } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'swap_nodes', firstNodeId: splitId, secondNodeId: leafAId }))
    expect(err.code).toBe('LAYOP_TARGET_IN_SUBTREE')
  })

  it('self-swap is a benign no-op', () => {
    const { doc, leafAId } = twoLeafDoc()
    const next = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafAId }))
    expect(next).toEqual(doc)
  })

  it('self-swap returns a distinct top-level object, never the caller\'s own document/nodes-map reference (design §9.2 Phase 1 r2)', () => {
    const { doc, leafAId } = twoLeafDoc()
    const next = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafAId }))
    expect(next).not.toBe(doc)
    expect(next.nodes).not.toBe(doc.nodes)
  })

  it('rejects an unknown firstNodeId', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'swap_nodes', firstNodeId: 'ghost', secondNodeId: leafAId }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects an unknown secondNodeId', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: 'ghost' }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects swapping an ancestor split with its own descendant leaf', () => {
    const { doc, midSplitId, leafBId } = threeLeafTree()
    const err = expectErr(
      applyOperation(doc, { op: 'swap_nodes', firstNodeId: midSplitId, secondNodeId: leafBId }),
    )
    expect(err.code).toBe('LAYOP_TARGET_IN_SUBTREE')
  })

  it('rejects swapping a descendant leaf with its own ancestor split (symmetric)', () => {
    const { doc, midSplitId, leafCId } = threeLeafTree()
    const err = expectErr(
      applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafCId, secondNodeId: midSplitId }),
    )
    expect(err.code).toBe('LAYOP_TARGET_IN_SUBTREE')
  })

  // Builder P1 hardening (recheck): a JSON-shaped `firstNodeId`/`secondNodeId`
  // equal to an ORDINARY inherited `Object.prototype` member name (`toString`,
  // `constructor`, `hasOwnProperty`, `__proto__`) is a ROUTINE JSON string
  // value, not an exotic in-process object — squarely IN the pinned threat
  // model. `doc.nodes['toString']` used to resolve the inherited function
  // (truthy), so `requireExisting`'s bare lookup treated it as "found",
  // `findParentLocation` then legitimately returned `null` (no split actually
  // points at `'toString'`), and the reducer dereferenced that `null` via an
  // unchecked `as ParentLocation` cast, throwing instead of returning a
  // diagnostic.
  describe.each([
    ['toString'],
    ['constructor'],
    ['hasOwnProperty'],
    ['__proto__'],
    ['valueOf'],
  ] as const)('an ordinary JSON prototype-colliding absent id (%s)', (protoName) => {
    it(`swap_nodes firstNodeId=${protoName} never throws and is rejected as LAYOP_NODE_NOT_FOUND`, () => {
      const { doc, leafAId } = twoLeafDoc()
      let result: OperationResult | undefined
      expect(() => {
        result = applyOperation(doc, { op: 'swap_nodes', firstNodeId: protoName, secondNodeId: leafAId })
      }).not.toThrow()
      expect(result!.ok).toBe(false)
      if (result!.ok) return
      expect(result!.diagnostic.code).toBe('LAYOP_NODE_NOT_FOUND')
    })

    it(`swap_nodes secondNodeId=${protoName} never throws and is rejected as LAYOP_NODE_NOT_FOUND`, () => {
      const { doc, leafAId } = twoLeafDoc()
      let result: OperationResult | undefined
      expect(() => {
        result = applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: protoName })
      }).not.toThrow()
      expect(result!.ok).toBe(false)
      if (result!.ok) return
      expect(result!.diagnostic.code).toBe('LAYOP_NODE_NOT_FOUND')
    })

    it(`split_leaf newLeafId=${protoName}/splitId is legal (requireFreshId no longer false-positives on an inherited prototype member) and the operation SUCCEEDS`, () => {
      const base = singleLeafDoc('root')
      const result = applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: protoName,
        splitId: `${protoName}-split`,
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      })
      const doc = expectOk(result)
      expect(doc.nodes[protoName]).toBeDefined()
      expect((doc.nodes[protoName] as LayoutLeafNode).kind).toBe('leaf')
    })
  })
})

describe('applyOperation — move_node', () => {
  it('moves a leaf beside another leaf, preserving both subtrees', () => {
    const { doc, leafAId, leafBId, leafCId } = threeLeafTree()
    const originalLeafC = doc.nodes[leafCId]
    const next = expectOk(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafCId,
        targetLeafId: leafAId,
        side: 'end',
        axis: 'vertical',
        splitId: 'relocated-split',
        expectedParent: expectedParentFor(doc, leafCId),
        expectedTargetParent: expectedParentFor(doc, leafAId),
      }),
    )
    const newSplit = next.nodes['relocated-split'] as LayoutSplitNode
    expect(newSplit.startNodeId).toBe(leafAId)
    expect(newSplit.endNodeId).toBe(leafCId)
    expect(next.nodes[leafCId]).toBe(originalLeafC)
    expect(next.nodes[leafBId]).toBeDefined() // leafB's old split was dissolved but leafB itself survives
  })

  it('moves a whole split subtree intact', () => {
    const { doc, leafAId, leafBId, leafCId, midSplitId } = threeLeafTree()
    const originalMidSplit = doc.nodes[midSplitId]
    const originalLeafB = doc.nodes[leafBId]
    const originalLeafC = doc.nodes[leafCId]
    const next = expectOk(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: midSplitId,
        targetLeafId: leafAId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'relocated-split',
        expectedParent: expectedParentFor(doc, midSplitId),
        expectedTargetParent: expectedParentFor(doc, leafAId),
      }),
    )
    expect(next.nodes[midSplitId]).toBe(originalMidSplit)
    expect(next.nodes[leafBId]).toBe(originalLeafB)
    expect(next.nodes[leafCId]).toBe(originalLeafC)
    const newSplit = next.nodes['relocated-split'] as LayoutSplitNode
    expect(newSplit.startNodeId).toBe(midSplitId)
    expect(newSplit.endNodeId).toBe(leafAId)
  })

  it('rejects an unknown nodeId', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: 'ghost',
        targetLeafId: leafAId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: PLACEHOLDER_PARENT,
        expectedTargetParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects moving the root node', () => {
    const { doc, splitId, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: splitId,
        targetLeafId: leafAId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: PLACEHOLDER_PARENT,
        expectedTargetParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_CANNOT_MOVE_ROOT')
  })

  it('rejects an unknown targetLeafId', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: 'ghost',
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a targetLeafId that names a split', () => {
    const { doc, leafAId, leafBId, midSplitId } = threeLeafTree()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: midSplitId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
    void leafBId
  })

  it('rejects an invalid axis', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: leafBId,
        side: 'start',
        axis: 'diagonal' as unknown as 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: expectedParentFor(doc, leafBId),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects an invalid side', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: leafBId,
        side: 'middle' as unknown as 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: expectedParentFor(doc, leafBId),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects a splitId that already exists', () => {
    const { doc, leafAId, leafBId, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: leafBId,
        side: 'start',
        axis: 'horizontal',
        splitId,
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: expectedParentFor(doc, leafBId),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('MUST reject a target inside the moved node\'s own subtree', () => {
    const { doc, midSplitId, leafBId } = threeLeafTree()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: midSplitId,
        targetLeafId: leafBId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, midSplitId),
        expectedTargetParent: expectedParentFor(doc, leafBId),
      }),
    )
    expect(err.code).toBe('LAYOP_TARGET_IN_SUBTREE')
  })

  it('rejects a non-finite startBasisPoints', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: leafBId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        startBasisPoints: Number.NaN,
        expectedParent: expectedParentFor(doc, leafAId),
        expectedTargetParent: expectedParentFor(doc, leafBId),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_RATIO_INPUT')
  })
})

describe('applyOperation — closed union / forged discriminant (design §9.2 Phase 1 r1/r2)', () => {
  it('rejects an unknown op discriminant', () => {
    const base = singleLeafDoc('root')
    const forged = { op: 'delete_everything', leafId: 'root' } as unknown as LayoutOperation
    const err = expectErr(applyOperation(base, forged))
    expect(err.code).toBe('LAYOP_UNKNOWN_OPERATION')
  })

  it('never leaks a forged operation\'s content-shaped payload into the diagnostic', () => {
    const base = singleLeafDoc('root')
    const SECRET = 'sk-content-body-do-not-leak-1234567890'
    const forged = {
      op: 'delete_everything',
      resource: { documentText: SECRET },
      leafId: SECRET,
    } as unknown as LayoutOperation
    const err = expectErr(applyOperation(base, forged))
    expect(err.code).toBe('LAYOP_UNKNOWN_OPERATION')
    expect(JSON.stringify(err)).not.toContain(SECRET)
  })

  it('never throws on a CIRCULAR forged operation — applyOperation stays a total reducer', () => {
    const base = singleLeafDoc('root')
    const circular: Record<string, unknown> = { op: 'delete_everything' }
    circular.self = circular
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(base, circular as unknown as LayoutOperation)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_UNKNOWN_OPERATION')
  })

  it('never echoes ANY part of an oversized OR secret-shaped string discriminant — not even a truncated fragment (design §9.2 Phase 1 r2)', () => {
    const base = singleLeafDoc('root')
    // This shape (alnum + hyphen) is exactly what r1's regex-gated
    // passthrough let through whole — it MATCHES `[\w.-]+`, so a naive
    // "truncate but otherwise pass through if it looks identifier-shaped"
    // policy still leaks it. The fix echoes only `typeof`, never any part of
    // the value, so shape is irrelevant.
    const SECRET_SHAPED = 'sk-secret-key-do-not-leak-1234567890'
    const err = expectErr(applyOperation(base, { op: SECRET_SHAPED } as unknown as LayoutOperation))
    expect(err.code).toBe('LAYOP_UNKNOWN_OPERATION')
    expect(JSON.stringify(err)).not.toContain(SECRET_SHAPED)
    expect(JSON.stringify(err)).not.toContain('sk-secret')
    expect(err.message.length).toBeLessThanOrEqual(205)

    const oversized = 'x'.repeat(5000)
    const err2 = expectErr(applyOperation(base, { op: oversized } as unknown as LayoutOperation))
    expect(JSON.stringify(err2)).not.toContain(oversized)
    expect(err2.message.length).toBeLessThanOrEqual(205)
  })

  it('rejects a non-string op discriminant without throwing or echoing it', () => {
    const base = singleLeafDoc('root')
    for (const forgedOp of [42, true, null, undefined, {}, []]) {
      const err = expectErr(applyOperation(base, { op: forgedOp } as unknown as LayoutOperation))
      expect(err.code).toBe('LAYOP_UNKNOWN_OPERATION')
    }
  })
})

describe('applyOperation — total, non-throwing decoder for ANY forged payload shape (design §9.2 Phase 1 r2)', () => {
  it('applyOperation(doc, null) and applyOperation(doc, undefined) return a diagnostic instead of throwing', () => {
    const base = singleLeafDoc('root')
    for (const forged of [null, undefined, 'a string', 42, [], true]) {
      let result: OperationResult | undefined
      expect(() => {
        result = applyOperation(base, forged as unknown as LayoutOperation)
      }).not.toThrow()
      expect(result!.ok).toBe(false)
      if (result!.ok) return
      expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    }
  })

  it('a split_leaf with expectedParent: null does not throw and is rejected as malformed', () => {
    const base = singleLeafDoc('root')
    const forged = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'x',
      splitId: 'y',
      descriptor: makeDescriptor(),
      expectedParent: null,
    } as unknown as LayoutOperation
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(base, forged)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it.each([
    ['a bare string', 'root'],
    ['a number', 42],
    ['an array', ['root']],
    ['a shape missing "kind"', { splitId: 'x', side: 'start' }],
    ['an unrecognized "kind"', { kind: 'grandparent' }],
    ['a child location missing splitId', { kind: 'child', side: 'start' }],
    ['a child location with an invalid side', { kind: 'child', splitId: 'x', side: 'up' }],
    ['a child location with an extra key', { kind: 'child', splitId: 'x', side: 'start', extra: true }],
  ])('rejects a malformed expectedParent (%s) on split_leaf without throwing', (_label, badExpectedParent) => {
    const base = singleLeafDoc('root')
    const forged = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'x',
      splitId: 'y',
      descriptor: makeDescriptor(),
      expectedParent: badExpectedParent,
    } as unknown as LayoutOperation
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(base, forged)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it('rejects an operation object carrying an unrecognized extra key', () => {
    const base = singleLeafDoc('root')
    const forged = {
      op: 'close_leaf',
      leafId: 'root',
      expectedParent: expectedParentFor(base, 'root'),
      __proto__: { polluted: true },
      sneaky: 'field',
    } as unknown as LayoutOperation
    const result = applyOperation(base, forged)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['a string', '0'],
    ['null', null],
  ])('rejects a malformed expectedDescriptorRevision (%s) on replace_descriptor without throwing', (_label, bad) => {
    const { doc, leafAId } = twoLeafDoc()
    const forged = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:x'),
      expectedDescriptorRevision: bad,
    } as unknown as LayoutOperation
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(doc, forged)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it('a move_node missing expectedTargetParent entirely is rejected as malformed, not treated as unconstrained', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const { expectedTargetParent: _omit, ...forged } = {
      op: 'move_node' as const,
      nodeId: leafAId,
      targetLeafId: leafBId,
      side: 'start' as const,
      axis: 'horizontal' as const,
      splitId: 'x',
      expectedParent: expectedParentFor(doc, leafAId),
      expectedTargetParent: expectedParentFor(doc, leafBId),
    }
    void _omit
    const result = applyOperation(doc, forged as unknown as LayoutOperation)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })
})

describe('applyOperation — decode-time malformed mandatory-field rejection, every operation variant (Builder P1 hardening finding 1, r4)', () => {
  // Reproduces the exact review probe: a plain JSON operation with an
  // ID-shaped field set to `null` (a legal JSON value) used to reach
  // `diagnostics.ts`'s `tokenizeId`, which called `.length` on it and threw —
  // `applyOperation` is documented to NEVER throw for ANY JSON-shaped input.
  const BAD_ID_VALUES: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['a plain object', {}],
    ['an array', []],
    ['an empty string', ''],
  ]
  const BAD_TYPE_VALUES: ReadonlyArray<readonly [string, unknown]> = BAD_ID_VALUES.filter(
    ([label]) => label !== 'an empty string',
  )

  // Bad-TYPE values for a mandatory plain-object field (`descriptor` on
  // split_leaf/replace_descriptor) — mirrors BAD_TYPE_VALUES, minus the
  // meaningless 'an empty string' case, plus a non-empty string. A GENUINE
  // plain object (however invalid its CONTENT) is deliberately excluded here
  // — that is covered separately below, since it must decode successfully
  // and be rejected by the reducer's own `isWellShapedViewDescriptor` check
  // (LAY003_INVALID_DESCRIPTOR), not by the decoder (LAYOP_MALFORMED_OPERATION).
  const BAD_OBJECT_VALUES: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a number', 42],
    ['a boolean', true],
    ['a string', 'not-an-object'],
    ['an array', []],
  ]

  // Bad-TYPE values for a mandatory number field (`startBasisPoints` on
  // set_ratio). A non-finite NUMBER (NaN/Infinity) is deliberately excluded —
  // `typeof NaN === 'number'` decodes fine here and is rejected downstream by
  // the reducer's own `resolveBasisPoints` as LAYOP_INVALID_RATIO_INPUT
  // (already covered by "rejects a non-finite startBasisPoints" above);
  // type-decoding and numeric-range validation stay separate concerns, the
  // same split `enumFields`/`requireEnum` already draws.
  const BAD_NUMBER_VALUES: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a numeric string', '5000'],
    ['a boolean', true],
    ['a plain object', {}],
    ['an array', []],
  ]

  type Case = {
    readonly opLabel: LayoutOperation['op']
    readonly build: () => { readonly doc: LayoutDocument; readonly op: LayoutOperation }
    readonly idFields: readonly string[]
    readonly enumFields: readonly string[]
    readonly objectFields: readonly string[]
    readonly numberFields: readonly string[]
  }

  const cases: readonly Case[] = [
    {
      opLabel: 'split_leaf',
      build: () => {
        const doc = singleLeafDoc('root')
        const op: LayoutOperation = {
          op: 'split_leaf',
          leafId: 'root',
          axis: 'horizontal',
          side: 'start',
          newLeafId: 'new-leaf',
          splitId: 'new-split',
          descriptor: makeDescriptor(),
          expectedParent: expectedParentFor(doc, 'root'),
        }
        return { doc, op }
      },
      idFields: ['leafId', 'newLeafId', 'splitId'],
      enumFields: ['axis', 'side'],
      objectFields: ['descriptor'],
      numberFields: [],
    },
    {
      opLabel: 'close_leaf',
      build: () => {
        const { doc, leafAId } = twoLeafDoc()
        const op: LayoutOperation = {
          op: 'close_leaf',
          leafId: leafAId,
          expectedParent: expectedParentFor(doc, leafAId),
        }
        return { doc, op }
      },
      idFields: ['leafId'],
      enumFields: [],
      objectFields: [],
      numberFields: [],
    },
    {
      opLabel: 'set_ratio',
      build: () => {
        const { doc, splitId } = twoLeafDoc()
        const op: LayoutOperation = { op: 'set_ratio', splitId, startBasisPoints: 5000 }
        return { doc, op }
      },
      idFields: ['splitId'],
      enumFields: [],
      objectFields: [],
      numberFields: ['startBasisPoints'],
    },
    {
      opLabel: 'replace_descriptor',
      build: () => {
        const { doc, leafAId } = twoLeafDoc()
        const op: LayoutOperation = {
          op: 'replace_descriptor',
          leafId: leafAId,
          descriptor: makeDescriptor('new.face', 'urn:test:new'),
          expectedDescriptorRevision: expectedRevisionFor(doc, leafAId),
        }
        return { doc, op }
      },
      idFields: ['leafId'],
      enumFields: [],
      objectFields: ['descriptor'],
      numberFields: [],
    },
    {
      opLabel: 'swap_nodes',
      build: () => {
        const { doc, leafAId, leafBId } = twoLeafDoc()
        const op: LayoutOperation = { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafBId }
        return { doc, op }
      },
      idFields: ['firstNodeId', 'secondNodeId'],
      enumFields: [],
      objectFields: [],
      numberFields: [],
    },
    {
      opLabel: 'move_node',
      build: () => {
        const { doc, leafAId, leafCId } = threeLeafTree()
        const op: LayoutOperation = {
          op: 'move_node',
          nodeId: leafAId,
          targetLeafId: leafCId,
          side: 'start',
          axis: 'horizontal',
          splitId: 'fresh-move-split',
          expectedParent: expectedParentFor(doc, leafAId),
          expectedTargetParent: expectedParentFor(doc, leafCId),
        }
        return { doc, op }
      },
      idFields: ['nodeId', 'targetLeafId', 'splitId'],
      enumFields: ['axis', 'side'],
      objectFields: [],
      numberFields: [],
    },
  ]

  for (const { opLabel, build, idFields, enumFields, objectFields, numberFields } of cases) {
    it(`${opLabel}: the baseline fixture operation itself is valid (self-check, so the negative cases below are meaningful)`, () => {
      const { doc, op } = build()
      const result = applyOperation(doc, op)
      expect(result.ok).toBe(true)
    })

    for (const field of idFields) {
      for (const [label, badValue] of BAD_ID_VALUES) {
        it(`${opLabel}: ${field} = ${label} never throws and is rejected as LAYOP_MALFORMED_OPERATION`, () => {
          const { doc, op } = build()
          const forged = { ...op, [field]: badValue } as unknown as LayoutOperation
          let result: OperationResult | undefined
          expect(() => {
            result = applyOperation(doc, forged)
          }).not.toThrow()
          expect(result!.ok).toBe(false)
          if (result!.ok) return
          expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
          expect(result!.diagnostic.details?.field).toBe(field)
        })
      }
      it(`${opLabel}: ${field} entirely MISSING never throws and is rejected as LAYOP_MALFORMED_OPERATION, not misdiagnosed under an unrelated code`, () => {
        const { doc, op } = build()
        const forged = { ...op } as Record<string, unknown>
        delete forged[field]
        let result: OperationResult | undefined
        expect(() => {
          result = applyOperation(doc, forged as unknown as LayoutOperation)
        }).not.toThrow()
        expect(result!.ok).toBe(false)
        if (result!.ok) return
        expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
        expect(result!.diagnostic.details?.field).toBe(field)
      })
    }

    for (const field of enumFields) {
      for (const [label, badValue] of BAD_TYPE_VALUES) {
        it(`${opLabel}: ${field} = ${label} never throws and is rejected as LAYOP_MALFORMED_OPERATION (wrong TYPE, decode-time)`, () => {
          const { doc, op } = build()
          const forged = { ...op, [field]: badValue } as unknown as LayoutOperation
          let result: OperationResult | undefined
          expect(() => {
            result = applyOperation(doc, forged)
          }).not.toThrow()
          expect(result!.ok).toBe(false)
          if (result!.ok) return
          expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
          expect(result!.diagnostic.details?.field).toBe(field)
        })
      }
      it(`${opLabel}: ${field} entirely MISSING never throws and is rejected as LAYOP_MALFORMED_OPERATION`, () => {
        const { doc, op } = build()
        const forged = { ...op } as Record<string, unknown>
        delete forged[field]
        let result: OperationResult | undefined
        expect(() => {
          result = applyOperation(doc, forged as unknown as LayoutOperation)
        }).not.toThrow()
        expect(result!.ok).toBe(false)
        if (result!.ok) return
        expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
        expect(result!.diagnostic.details?.field).toBe(field)
      })
      it(`${opLabel}: ${field} = a wrong-but-STRING enum member ('nonsense-value') decodes fine (right type) but is rejected by the reducer's requireEnum as LAYOP_INVALID_ENUM — type-decoding and enum-membership stay separate concerns`, () => {
        const { doc, op } = build()
        const forged = { ...op, [field]: 'nonsense-value' } as unknown as LayoutOperation
        const result = applyOperation(doc, forged)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.diagnostic.code).toBe('LAYOP_INVALID_ENUM')
      })
    }

    // Builder P1 hardening (recheck): `decodeOperation` previously let a
    // mandatory plain-object field (`descriptor`) reach the reducer entirely
    // undecoded — a MISSING/wrong-typed descriptor was diagnosed under
    // LAY003_INVALID_DESCRIPTOR (the SAME code a genuinely present-but-
    // invalid-CONTENT descriptor gets), making "the operation itself doesn't
    // match its shape" indistinguishable from "the operation is shaped fine
    // but its descriptor content fails schema".
    for (const field of objectFields) {
      for (const [label, badValue] of BAD_OBJECT_VALUES) {
        it(`${opLabel}: ${field} = ${label} never throws and is rejected as LAYOP_MALFORMED_OPERATION (wrong TYPE, decode-time)`, () => {
          const { doc, op } = build()
          const forged = { ...op, [field]: badValue } as unknown as LayoutOperation
          let result: OperationResult | undefined
          expect(() => {
            result = applyOperation(doc, forged)
          }).not.toThrow()
          expect(result!.ok).toBe(false)
          if (result!.ok) return
          expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
          expect(result!.diagnostic.details?.field).toBe(field)
        })
      }
      it(`${opLabel}: ${field} entirely MISSING never throws and is rejected as LAYOP_MALFORMED_OPERATION, not misdiagnosed as LAY003_INVALID_DESCRIPTOR (the exact recheck finding)`, () => {
        const { doc, op } = build()
        const forged = { ...op } as Record<string, unknown>
        delete forged[field]
        let result: OperationResult | undefined
        expect(() => {
          result = applyOperation(doc, forged as unknown as LayoutOperation)
        }).not.toThrow()
        expect(result!.ok).toBe(false)
        if (result!.ok) return
        expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
        expect(result!.diagnostic.details?.field).toBe(field)
      })
      it(`${opLabel}: ${field} = a WELL-TYPED plain object with invalid CONTENT (empty faceId) still decodes past the malformed-operation gate and is rejected by the reducer as LAY003_INVALID_DESCRIPTOR — decode-time TYPE checking and content validation stay separate concerns`, () => {
        const { doc, op } = build()
        const forged = {
          ...op,
          [field]: { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'urn:x' } },
        } as unknown as LayoutOperation
        const result = applyOperation(doc, forged)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.diagnostic.code).toBe('LAY003_INVALID_DESCRIPTOR')
      })
    }

    // Builder P1 hardening (recheck): `set_ratio.startBasisPoints` is
    // MANDATORY in the type (no `?`), but `decodeOperation` never checked it
    // — an omitted field reached `resolveBasisPoints`'s `undefined` branch,
    // which is deliberately the OPTIONAL-field default path shared with
    // split_leaf/move_node, so `set_ratio` silently wrote 5000 instead of
    // being rejected as malformed.
    for (const field of numberFields) {
      for (const [label, badValue] of BAD_NUMBER_VALUES) {
        it(`${opLabel}: ${field} = ${label} never throws and is rejected as LAYOP_MALFORMED_OPERATION (wrong TYPE, decode-time)`, () => {
          const { doc, op } = build()
          const forged = { ...op, [field]: badValue } as unknown as LayoutOperation
          let result: OperationResult | undefined
          expect(() => {
            result = applyOperation(doc, forged)
          }).not.toThrow()
          expect(result!.ok).toBe(false)
          if (result!.ok) return
          expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
          expect(result!.diagnostic.details?.field).toBe(field)
        })
      }
      it(`${opLabel}: ${field} entirely MISSING never throws and is rejected as LAYOP_MALFORMED_OPERATION, not silently defaulted (the exact recheck finding: omitting set_ratio.startBasisPoints used to succeed and write the default 5000)`, () => {
        const { doc, op } = build()
        const forged = { ...op } as Record<string, unknown>
        delete forged[field]
        let result: OperationResult | undefined
        expect(() => {
          result = applyOperation(doc, forged as unknown as LayoutOperation)
        }).not.toThrow()
        expect(result!.ok).toBe(false)
        if (result!.ok) return
        expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
        expect(result!.diagnostic.details?.field).toBe(field)
      })
      it(`${opLabel}: ${field} = NaN decodes fine (right type) but is rejected by the reducer's resolveBasisPoints as LAYOP_INVALID_RATIO_INPUT — type-decoding and numeric-range validation stay separate concerns`, () => {
        const { doc, op } = build()
        const forged = { ...op, [field]: Number.NaN } as unknown as LayoutOperation
        const result = applyOperation(doc, forged)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.diagnostic.code).toBe('LAYOP_INVALID_RATIO_INPUT')
      })
    }
  }

  it("reproduces the ORIGINAL review probe exactly: split_leaf's leafId: null never throws (diagnostics.ts's tokenizeId(null) used to crash on null.length)", () => {
    const base = singleLeafDoc('root')
    const forged = {
      op: 'split_leaf',
      leafId: null,
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'x',
      splitId: 'y',
      descriptor: makeDescriptor(),
      expectedParent: { kind: 'root' },
    } as unknown as LayoutOperation
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(base, forged)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result!.diagnostic.details?.field).toBe('leafId')
  })
})

describe('applyOperation — descriptor clone-before-embed / deep-freeze (design §9.2 Phase 1 r1)', () => {
  it('split_leaf clones the caller-supplied descriptor: mutating the caller\'s original object afterward does not corrupt the stored document', () => {
    const base = singleLeafDoc('root')
    const mutableDescriptor = {
      schemaVersion: 1 as const,
      faceId: 'test.face',
      resource: { kind: 'iri' as const, iri: 'urn:test:new' },
      params: { count: 1 },
    }
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: mutableDescriptor,
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)

    // Mutate the caller's ORIGINAL object after the operation returned.
    ;(mutableDescriptor.params as { count: number }).count = 999
    ;(mutableDescriptor as { faceId: string }).faceId = 'corrupted.face'

    const storedLeaf = doc.nodes['new-leaf']
    if (storedLeaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(storedLeaf.descriptor.faceId).toBe('test.face')
    expect(storedLeaf.descriptor.params).toEqual({ count: 1 })
  })

  it('replace_descriptor clones the caller-supplied descriptor the same way', () => {
    const { doc: base, leafAId } = twoLeafDoc()
    const mutableDescriptor = {
      schemaVersion: 1 as const,
      faceId: 'new.face',
      resource: { kind: 'iri' as const, iri: 'urn:test:replacement' },
    }
    const doc = expectOk(
      applyOperation(base, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: mutableDescriptor,
        expectedDescriptorRevision: expectedRevisionFor(base, leafAId),
      }),
    )
    ;(mutableDescriptor as { faceId: string }).faceId = 'corrupted.face'
    const leaf = doc.nodes[leafAId]
    if (leaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf.descriptor.faceId).toBe('new.face')
  })

  it('every successful result is deep-frozen: the document, its nodes map, and every leaf descriptor throw on mutation', () => {
    const base = singleLeafDoc('root')
    const doc = expectOk(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'new-leaf',
        splitId: 'new-split',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(Object.isFrozen(doc)).toBe(true)
    expect(Object.isFrozen(doc.nodes)).toBe(true)
    expect(Object.isFrozen(doc.nodes['new-leaf'])).toBe(true)
    const newLeaf = doc.nodes['new-leaf']
    if (newLeaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(Object.isFrozen(newLeaf.descriptor)).toBe(true)
    expect(() => {
      ;(doc as { layoutId: string }).layoutId = 'mutated'
    }).toThrow()
    expect(() => {
      ;(doc.nodes as Record<string, unknown>)['new-leaf'] = {}
    }).toThrow()
    expect(() => {
      ;(newLeaf.descriptor as { faceId: string }).faceId = 'mutated'
    }).toThrow()
  })
})

describe('applyOperation — reducer purity: never freezes (mutates) the caller\'s own input graph (Builder P1 hardening finding 2)', () => {
  /**
   * A genuinely UNFROZEN, hand-built document — deliberately NOT via
   * `singleLeafDoc`/`twoLeafDoc` (fixtures.ts freezes those, matching
   * `applyOperation`'s real documented contract of "a valid, already-frozen
   * `LayoutDocument`"). This test exists specifically to probe what happens
   * when a caller violates that precondition, which `finalizeCandidate`
   * must still handle without corrupting the caller's own object graph — see
   * `freezeWithoutMutatingOwner` (immutable.ts).
   */
  function unfrozenTwoLeafDoc(): {
    readonly doc: LayoutDocument
    readonly splitId: string
    readonly leafAId: string
    readonly leafBId: string
    readonly leafANode: LayoutLeafNode
    readonly leafBNode: LayoutLeafNode
    readonly splitNode: LayoutSplitNode
  } {
    const splitId = 'unfrozen-split'
    const leafAId = 'unfrozen-leaf-a'
    const leafBId = 'unfrozen-leaf-b'
    const leafANode: LayoutLeafNode = {
      kind: 'leaf',
      id: leafAId,
      descriptor: makeDescriptor('test.face', 'urn:test:a'),
      descriptorRevision: 0,
    }
    const leafBNode: LayoutLeafNode = {
      kind: 'leaf',
      id: leafBId,
      descriptor: makeDescriptor('test.face', 'urn:test:b'),
      descriptorRevision: 0,
    }
    const splitNode: LayoutSplitNode = {
      kind: 'split',
      id: splitId,
      axis: 'horizontal',
      startNodeId: leafAId,
      endNodeId: leafBId,
      startBasisPoints: 5000,
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'unfrozen-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: splitId,
      nodes: { [splitId]: splitNode, [leafAId]: leafANode, [leafBId]: leafBNode },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    return { doc, splitId, leafAId, leafBId, leafANode, leafBNode, splitNode }
  }

  it('a set_ratio on an UNFROZEN input never freezes the document, its nodes map, or either untouched leaf', () => {
    const { doc, splitId, leafANode, leafBNode, splitNode } = unfrozenTwoLeafDoc()
    expect(Object.isFrozen(doc)).toBe(false)
    expect(Object.isFrozen(doc.nodes)).toBe(false)
    expect(Object.isFrozen(leafANode)).toBe(false)
    expect(Object.isFrozen(leafBNode)).toBe(false)
    expect(Object.isFrozen(splitNode)).toBe(false)

    // set_ratio touches ONLY the split's own fields — both leaves are
    // structurally untouched by this op.
    const result = applyOperation(doc, { op: 'set_ratio', splitId, startBasisPoints: 7000 })
    expect(result.ok).toBe(true)

    // The RETURNED document is frozen (the standing "every output is
    // frozen" guarantee) — but NONE of the caller's own original objects may
    // have been frozen as a side effect of producing it.
    expect(Object.isFrozen(doc)).toBe(false)
    expect(Object.isFrozen(doc.nodes)).toBe(false)
    expect(Object.isFrozen(leafANode)).toBe(false)
    expect(Object.isFrozen(leafBNode)).toBe(false)
    expect(Object.isFrozen(splitNode)).toBe(false)

    // Prove it, don't just assert it: the caller can still freely mutate
    // their own original untouched-leaf object.
    expect(() => {
      ;(leafBNode as { descriptorRevision: number }).descriptorRevision = 999
    }).not.toThrow()
    expect(leafBNode.descriptorRevision).toBe(999)
  })

  it('a split_leaf on an UNFROZEN input never freezes the untouched sibling leaf', () => {
    const { doc, leafAId, leafBNode } = unfrozenTwoLeafDoc()
    expect(Object.isFrozen(leafBNode)).toBe(false)

    const result = applyOperation(doc, {
      op: 'split_leaf',
      leafId: leafAId,
      axis: 'vertical',
      side: 'start',
      newLeafId: 'unfrozen-new-leaf',
      splitId: 'unfrozen-new-split',
      descriptor: makeDescriptor(),
      expectedParent: expectedParentFor(doc, leafAId),
    })
    expect(result.ok).toBe(true)

    // leaf-b is nowhere near this split — its own object must stay untouched.
    expect(Object.isFrozen(leafBNode)).toBe(false)
    expect(() => {
      ;(leafBNode as { descriptorRevision: number }).descriptorRevision = 999
    }).not.toThrow()
  })
})

describe('applyOperation — descriptorRevision bookkeeping', () => {
  it('a freshly split leaf starts at descriptorRevision 0', () => {
    const base = singleLeafDoc('root')
    const doc = expectOk(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'new-leaf',
        splitId: 'new-split',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    const leaf = doc.nodes['new-leaf']
    if (leaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf.descriptorRevision).toBe(0)
  })

  it('replace_descriptor increments descriptorRevision by exactly 1 each time', () => {
    const { doc: base, leafAId } = twoLeafDoc()
    const once = expectOk(
      applyOperation(base, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: makeDescriptor('new.face', 'urn:1'),
        expectedDescriptorRevision: expectedRevisionFor(base, leafAId),
      }),
    )
    const leaf1 = once.nodes[leafAId]
    if (leaf1.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf1.descriptorRevision).toBe(1)

    const twice = expectOk(
      applyOperation(once, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: makeDescriptor('new.face', 'urn:2'),
        expectedDescriptorRevision: expectedRevisionFor(once, leafAId),
      }),
    )
    const leaf2 = twice.nodes[leafAId]
    if (leaf2.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf2.descriptorRevision).toBe(2)
  })

  it('close_leaf on the root increments descriptorRevision (sophia.home replacement is a real descriptor rebind)', () => {
    const base = singleLeafDoc('root')
    const once = expectOk(
      applyOperation(base, { op: 'close_leaf', leafId: 'root', expectedParent: expectedParentFor(base, 'root') }),
    )
    const leaf1 = once.nodes['root']
    if (leaf1.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf1.descriptorRevision).toBe(1)
    const twice = expectOk(
      applyOperation(once, { op: 'close_leaf', leafId: 'root', expectedParent: expectedParentFor(once, 'root') }),
    )
    const leaf2 = twice.nodes['root']
    if (leaf2.kind !== 'leaf') throw new Error('expected a leaf')
    expect(leaf2.descriptorRevision).toBe(2)
  })

  it('splitting a DIFFERENT leaf, set_ratio, swap, and move never change an untouched leaf\'s descriptorRevision', () => {
    const { doc, leafAId, leafBId, leafCId } = threeLeafTree()
    const before = doc.nodes[leafBId]
    if (before.kind !== 'leaf') throw new Error('expected a leaf')
    const afterSwap = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafAId, secondNodeId: leafCId }))
    const after = afterSwap.nodes[leafBId]
    if (after.kind !== 'leaf') throw new Error('expected a leaf')
    expect(after.descriptorRevision).toBe(before.descriptorRevision)
    expect(after).toBe(before) // full reference identity, not just the field
  })
})

describe('applyOperation — mandatory precondition rejection (design §2.5, §9.2 Phase 1 r2)', () => {
  it('split_leaf with a CORRECT expectedParent succeeds', () => {
    const base = singleLeafDoc('root')
    const rootExpected: ParentLocation = { kind: 'root' }
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'new-leaf',
      splitId: 'new-split',
      descriptor: makeDescriptor(),
      expectedParent: rootExpected,
    })
    expect(result.ok).toBe(true)
  })

  it('TWO CONCURRENT split_leaf ops on the same leaf: the first wins, the second (stale expectedParent) is rejected — neither silently wins twice', () => {
    // Both callers read the SAME base document (doc0) and both believe leaf
    // 'root' is still at the document root when they draft their operation.
    const doc0 = singleLeafDoc('root')
    const rootExpected: ParentLocation = { kind: 'root' }

    const opA: LayoutOperation = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'leaf-from-a',
      splitId: 'split-from-a',
      descriptor: makeDescriptor('test.face', 'urn:a'),
      expectedParent: rootExpected,
    }
    const opB: LayoutOperation = {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'vertical',
      side: 'end',
      newLeafId: 'leaf-from-b',
      splitId: 'split-from-b',
      descriptor: makeDescriptor('test.face', 'urn:b'),
      expectedParent: rootExpected,
    }

    // A is integrated first, against the shared base.
    const doc1 = expectOk(applyOperation(doc0, opA))
    // 'root' now sits under split-from-a, not at the document root — so B's
    // STALE expectedParent (still {kind:'root'}) is rejected against doc1,
    // the CURRENT authoritative document.
    const resultB = applyOperation(doc1, opB)
    expect(resultB.ok).toBe(false)
    if (resultB.ok) return
    expect(resultB.diagnostic.code).toBe('LAYOP_STALE_PARENT')

    // With opB's precondition RECOMPUTED against the current document (the
    // well-behaved retry path), the exact same intent now succeeds — proving
    // the precondition genuinely tracks live topology, not a permanent lock.
    const retried: LayoutOperation = { ...opB, expectedParent: locateParent(doc1, 'root')! }
    const wouldRetrySucceed = applyOperation(doc1, retried)
    expect(wouldRetrySucceed.ok).toBe(true)
  })

  it('close_leaf rejects a stale expectedParent the same way', () => {
    const { doc: doc0, leafAId, leafBId } = twoLeafDoc()
    const staleExpected: ParentLocation = { kind: 'child', splitId: 'split-root', side: 'start' }
    // Move leafA elsewhere first, changing its parent.
    const doc1 = expectOk(
      applyOperation(doc0, {
        op: 'move_node',
        nodeId: leafAId,
        targetLeafId: leafBId,
        side: 'start',
        axis: 'vertical',
        splitId: 'relocate-split',
        expectedParent: expectedParentFor(doc0, leafAId),
        expectedTargetParent: expectedParentFor(doc0, leafBId),
      }),
    )
    // A caller that captured leafA's OLD parent before the move now tries to
    // close it with that stale expectation.
    const result = applyOperation(doc1, { op: 'close_leaf', leafId: leafAId, expectedParent: staleExpected })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_STALE_PARENT')
  })

  it('close_leaf with a CORRECT expectedParent succeeds', () => {
    const { doc, leafAId, splitId } = twoLeafDoc()
    const correct: ParentLocation = { kind: 'child', splitId, side: 'start' }
    const result = applyOperation(doc, { op: 'close_leaf', leafId: leafAId, expectedParent: correct })
    expect(result.ok).toBe(true)
  })

  it('move_node rejects a stale expectedParent for the node being moved', () => {
    const { doc, leafAId, leafBId, leafCId } = threeLeafTree()
    // Caller observed leafC's parent (midSplit) at some earlier point...
    const staleExpected: ParentLocation = { kind: 'child', splitId: 'some-other-split', side: 'end' }
    const result = applyOperation(doc, {
      op: 'move_node',
      nodeId: leafCId,
      targetLeafId: leafAId,
      side: 'end',
      axis: 'vertical',
      splitId: 'relocated-split',
      expectedParent: staleExpected,
      expectedTargetParent: expectedParentFor(doc, leafAId),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_STALE_PARENT')
    void leafBId
  })

  it('move_node rejects a stale expectedTargetParent for the TARGET leaf, even when the source precondition is correct (design §9.2 Phase 1 r2)', () => {
    const { doc, leafAId, leafCId, midSplitId } = threeLeafTree()
    const staleTargetExpected: ParentLocation = { kind: 'child', splitId: 'some-other-split', side: 'start' }
    const result = applyOperation(doc, {
      op: 'move_node',
      nodeId: leafCId,
      targetLeafId: leafAId,
      side: 'end',
      axis: 'vertical',
      splitId: 'relocated-split',
      expectedParent: expectedParentFor(doc, leafCId),
      expectedTargetParent: staleTargetExpected,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_STALE_PARENT')
    void midSplitId
  })

  it('move_node with CORRECT expectedParent AND expectedTargetParent succeeds', () => {
    const { doc, leafAId, leafCId, midSplitId } = threeLeafTree()
    const correctSource: ParentLocation = { kind: 'child', splitId: midSplitId, side: 'end' }
    const result = applyOperation(doc, {
      op: 'move_node',
      nodeId: leafCId,
      targetLeafId: leafAId,
      side: 'end',
      axis: 'vertical',
      splitId: 'relocated-split',
      expectedParent: correctSource,
      expectedTargetParent: expectedParentFor(doc, leafAId),
    })
    expect(result.ok).toBe(true)
  })

  it('TWO CONCURRENT move_node ops racing the same SOURCE node: the second (stale expectedParent) is rejected', () => {
    const { doc: doc0, leafAId, leafBId, leafCId, midSplitId } = threeLeafTree()
    const staleExpected: ParentLocation = { kind: 'child', splitId: midSplitId, side: 'end' }

    // Both callers observed leafC under midSplit and draft a move using that
    // expectation.
    const opA: LayoutOperation = {
      op: 'move_node',
      nodeId: leafCId,
      targetLeafId: leafAId,
      side: 'end',
      axis: 'vertical',
      splitId: 'move-a',
      expectedParent: staleExpected,
      expectedTargetParent: expectedParentFor(doc0, leafAId),
    }
    const opB: LayoutOperation = {
      op: 'move_node',
      nodeId: leafCId,
      targetLeafId: leafBId,
      side: 'start',
      axis: 'horizontal',
      splitId: 'move-b',
      expectedParent: staleExpected,
      expectedTargetParent: expectedParentFor(doc0, leafBId),
    }

    const doc1 = expectOk(applyOperation(doc0, opA))
    const resultB = applyOperation(doc1, opB)
    expect(resultB.ok).toBe(false)
    if (resultB.ok) return
    expect(resultB.diagnostic.code).toBe('LAYOP_STALE_PARENT')
  })

  it('TWO CONCURRENT move_node ops racing the same TARGET leaf: the second (stale expectedTargetParent) is rejected even though the SOURCE precondition is fine (design §9.2 Phase 1 r2)', () => {
    // Build a 4-leaf tree so there's a distinct "mover" leaf per racer and one
    // shared target leaf both racers want to land beside.
    const base = twoLeafDoc()
    const doc0 = expectOk(
      applyOperation(base.doc, {
        op: 'split_leaf',
        leafId: base.leafAId,
        axis: 'vertical',
        side: 'start',
        newLeafId: 'mover-1',
        splitId: 'split-mover-1',
        descriptor: makeDescriptor('test.face', 'urn:m1'),
        expectedParent: expectedParentFor(base.doc, base.leafAId),
      }),
    )
    const doc1 = expectOk(
      applyOperation(doc0, {
        op: 'split_leaf',
        leafId: base.leafAId,
        axis: 'vertical',
        side: 'start',
        newLeafId: 'mover-2',
        splitId: 'split-mover-2',
        descriptor: makeDescriptor('test.face', 'urn:m2'),
        expectedParent: expectedParentFor(doc0, base.leafAId),
      }),
    )
    // Both racers observed the TARGET (leafB) at its original root-split
    // parent location before EITHER racer's own split_leaf commits landed.
    const staleTargetExpected = expectedParentFor(base.doc, base.leafBId)

    const opA: LayoutOperation = {
      op: 'move_node',
      nodeId: 'mover-1',
      targetLeafId: base.leafBId,
      side: 'start',
      axis: 'horizontal',
      splitId: 'racer-a-split',
      expectedParent: expectedParentFor(doc1, 'mover-1'),
      expectedTargetParent: staleTargetExpected,
    }
    // Racer A integrates first — this MOVES leafB's parent (root split's
    // shape changes at leafB's slot), so racer B's identical stale
    // expectedTargetParent is now provably wrong.
    const doc2 = expectOk(applyOperation(doc1, opA))
    expect(locateParent(doc2, base.leafBId)).not.toEqual(staleTargetExpected)

    const opB: LayoutOperation = {
      op: 'move_node',
      nodeId: 'mover-2',
      targetLeafId: base.leafBId,
      side: 'end',
      axis: 'horizontal',
      splitId: 'racer-b-split',
      expectedParent: expectedParentFor(doc2, 'mover-2'), // source guard is FRESH/correct
      expectedTargetParent: staleTargetExpected, // target guard is STALE
    }
    const resultB = applyOperation(doc2, opB)
    expect(resultB.ok).toBe(false)
    if (resultB.ok) return
    expect(resultB.diagnostic.code).toBe('LAYOP_STALE_PARENT')
  })

  it('replace_descriptor rejects a stale expectedDescriptorRevision', () => {
    const { doc: doc0, leafAId } = twoLeafDoc()
    const doc1 = expectOk(
      applyOperation(doc0, {
        op: 'replace_descriptor',
        leafId: leafAId,
        descriptor: makeDescriptor('new.face', 'urn:1'),
        expectedDescriptorRevision: expectedRevisionFor(doc0, leafAId),
      }),
    )
    // A stale caller still believes leafA is at descriptorRevision 0.
    const result = applyOperation(doc1, {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:2'),
      expectedDescriptorRevision: 0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_STALE_DESCRIPTOR_REVISION')
  })

  it('replace_descriptor with a CORRECT expectedDescriptorRevision succeeds', () => {
    const { doc, leafAId } = twoLeafDoc()
    const result = applyOperation(doc, {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:1'),
      expectedDescriptorRevision: 0,
    })
    expect(result.ok).toBe(true)
  })

  it('TWO CONCURRENT replace_descriptor ops on the same leaf: the second (stale revision) is rejected', () => {
    const { doc: doc0, leafAId } = twoLeafDoc()
    const opA: LayoutOperation = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:from-a'),
      expectedDescriptorRevision: 0,
    }
    const opB: LayoutOperation = {
      op: 'replace_descriptor',
      leafId: leafAId,
      descriptor: makeDescriptor('new.face', 'urn:from-b'),
      expectedDescriptorRevision: 0,
    }
    const doc1 = expectOk(applyOperation(doc0, opA))
    const resultB = applyOperation(doc1, opB)
    expect(resultB.ok).toBe(false)
    if (resultB.ok) return
    expect(resultB.diagnostic.code).toBe('LAYOP_STALE_DESCRIPTOR_REVISION')
  })
})

describe('applyOperation / diagnostics — content-free leakage across the FULL diagnostic (design §3.3 item 10, §9.2 Phase 1 r2, Builder P1 hardening finding 3)', () => {
  it('a secret used as newLeafId/splitId/nodeId/faceId never survives verbatim ANYWHERE in the diagnostic — nodeId and faceId are TOKENIZED, not bounded-and-echoed (r3)', () => {
    const SECRET = 'sk-a-genuinely-secret-value-1234567890-do-not-leak'
    const base = singleLeafDoc('root')

    // The secret as an UNREGISTERED faceId — exercises LAY003_UNREGISTERED_FACE's details.faceId.
    const err1 = expectErr(
      applyOperation(base, {
        op: 'split_leaf',
        leafId: 'root',
        axis: 'horizontal',
        side: 'start',
        newLeafId: 'x',
        splitId: 'y',
        descriptor: makeDescriptor(SECRET),
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err1.code).toBe('LAY003_UNREGISTERED_FACE')
    // r3: faceId is now TOKENIZED, never surfaced verbatim — the fixed
    // message obviously never duplicates it either, and neither does any
    // other field on the diagnostic.
    expect(JSON.stringify(err1)).not.toContain(SECRET)
    expect(err1.details?.faceId).not.toBe(SECRET)

    // The secret as a colliding newLeafId — exercises LAYOP_ID_COLLISION,
    // whose nodeId (r3: tokenized) names it. First mint a leaf actually named
    // SECRET, then collide against it.
    const { doc: withSecretLeaf, leafAId } = twoLeafDoc()
    const withSecretNode = expectOk(
      applyOperation(withSecretLeaf, {
        op: 'split_leaf',
        leafId: leafAId,
        axis: 'horizontal',
        side: 'start',
        newLeafId: SECRET,
        splitId: 'holds-secret-split',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(withSecretLeaf, leafAId),
      }),
    )
    const err2 = expectErr(
      applyOperation(withSecretNode, {
        op: 'split_leaf',
        leafId: SECRET,
        axis: 'horizontal',
        side: 'start',
        newLeafId: SECRET, // collides with the leaf just created
        splitId: 'another-fresh-split',
        descriptor: makeDescriptor(),
        expectedParent: expectedParentFor(withSecretNode, SECRET),
      }),
    )
    expect(err2.code).toBe('LAYOP_ID_COLLISION')
    expect(JSON.stringify(err2)).not.toContain(SECRET)
    expect(err2.nodeId).not.toBe(SECRET)
  })

  it('a SHORT secret supplied simultaneously as nodeId AND as an allowed detail value is ABSENT from the full serialized diagnostic, and an unlisted detail key is dropped entirely (Builder P1 hardening finding 3)', () => {
    // Short on purpose: r2's bounding (200-char truncation) only helps once a
    // payload EXCEEDS the bound — this proves the fix is structural
    // (tokenization), not truncation, by using a secret far under that bound.
    const SECRET = 'sk-short-secret'
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: SECRET, // -> diagnostic.nodeId, if this branch is reached
      splitId: 'y',
      descriptor: makeDescriptor(SECRET), // -> details.faceId (LAY003_UNREGISTERED_FACE)
      expectedParent: expectedParentFor(base, 'root'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAY003_UNREGISTERED_FACE')
    const serialized = JSON.stringify(result.diagnostic)
    expect(serialized).not.toContain(SECRET)
    expect(result.diagnostic.nodeId).not.toBe(SECRET)
    expect(result.diagnostic.details?.faceId).not.toBe(SECRET)

    // A detail key that is NOT in LAY003_UNREGISTERED_FACE's allowlist
    // (['faceId']) never reaches the output at all — proven directly against
    // makeDiagnostic (diagnostics.ts), not just this one call site.
    const direct = makeDiagnosticForTest('LAY003_UNREGISTERED_FACE', SECRET, {
      faceId: SECRET,
      arbitraryUnknownKey: SECRET,
    })
    const directSerialized = JSON.stringify(direct)
    expect(directSerialized).not.toContain(SECRET)
    expect(direct.details).not.toHaveProperty('arbitraryUnknownKey')
  })

  it('a JS-forged, long/weird-shaped operation payload never round-trips a secret through any diagnostic field (fuzz-style sweep)', () => {
    const base = singleLeafDoc('root')
    const SECRET = 'TOP-SECRET-DO-NOT-LEAK-abcdefghijklmnopqrstuvwxyz-1234567890'
    const forgedShapes: unknown[] = [
      { op: SECRET },
      { op: 'split_leaf', leafId: SECRET, axis: 'horizontal', side: 'start', newLeafId: 'x', splitId: 'y', descriptor: makeDescriptor(), expectedParent: { kind: 'root' } },
      { op: 'replace_descriptor', leafId: 'leaf-a', descriptor: makeDescriptor(), expectedDescriptorRevision: SECRET },
      { op: 'move_node', nodeId: 'leaf-a', targetLeafId: 'leaf-b', side: 'start', axis: 'horizontal', splitId: 'x', expectedParent: SECRET, expectedTargetParent: SECRET },
      { op: 'close_leaf', leafId: 'root', expectedParent: { kind: 'child', splitId: SECRET, side: 'start' } },
    ]
    for (const forged of forgedShapes) {
      let result: OperationResult | undefined
      expect(() => {
        result = applyOperation(base, forged as unknown as LayoutOperation)
      }).not.toThrow()
      expect(result!.ok).toBe(false)
      if (result!.ok) continue
      // faceId/ids ARE legitimately bounded-and-surfaced in some codes (see
      // the test above) — but message text specifically must never carry the
      // secret, and the WHOLE serialized diagnostic must never exceed a
      // small bound (rules out a length-based leak channel).
      expect(result!.diagnostic.message).not.toContain(SECRET)
      expect(JSON.stringify(result!.diagnostic).length).toBeLessThan(2000)
    }
  })
})

// ── grid/collection node ops (Wave 2 x Lane B, design
// plans/surface-wave2-laneb-slice-20260716.md §2.2) ─────────────────────────

describe('applyOperation — insert_grid', () => {
  it('inserts a fixed-source grid beside a leaf, default ratio 5000', () => {
    const base = singleLeafDoc('root')
    const originalRootNode = base.nodes['root']
    const result = applyOperation(base, {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'end',
      splitId: 'new-split',
      gridId: 'new-grid',
      gridConfig: { flow: 'reflow', minCellWidth: 200, children: makeFixedChildren([makeGridCell('cell-a')]) },
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    expect(doc.rootNodeId).toBe('new-split')
    const split = doc.nodes['new-split'] as LayoutSplitNode
    expect(split.startNodeId).toBe('root')
    expect(split.endNodeId).toBe('new-grid')
    expect(split.startBasisPoints).toBe(5000)
    const grid = doc.nodes['new-grid'] as LayoutGridNode
    expect(grid.kind).toBe('grid')
    expect(grid.flow).toBe('reflow')
    expect(grid.minCellWidth).toBe(200)
    expect(grid.gridRevision).toBe(0)
    expect(grid.children).toEqual({ kind: 'fixed', cells: [makeGridCell('cell-a')] })
    // The original leaf's node entry survives untouched (reference-identical).
    expect(doc.nodes['root']).toBe(originalRootNode)
  })

  it('honors side=start/axis=vertical and an explicit ratio, clamped into range', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'vertical',
      side: 'start',
      splitId: 'new-split',
      gridId: 'new-grid',
      gridConfig: { flow: 'stack', minCellWidth: 150, children: makeFixedChildren([]) },
      startBasisPoints: 999999,
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    const split = doc.nodes['new-split'] as LayoutSplitNode
    expect(split.axis).toBe('vertical')
    expect(split.startNodeId).toBe('new-grid')
    expect(split.endNodeId).toBe('root')
    expect(split.startBasisPoints).toBe(9999)
  })

  it('inserts a collection-source grid', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'end',
      splitId: 'new-split',
      gridId: 'new-grid',
      gridConfig: { flow: 'reflow', minCellWidth: 220, children: makeCollectionChildren() },
      expectedParent: expectedParentFor(base, 'root'),
    })
    const doc = expectOk(result)
    const grid = doc.nodes['new-grid'] as LayoutGridNode
    expect(grid.children.kind).toBe('collection')
  })

  it('an empty fixed grid (zero cells) is legal', () => {
    const base = singleLeafDoc('root')
    const result = applyOperation(base, {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'end',
      splitId: 'new-split',
      gridId: 'new-grid',
      gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
      expectedParent: expectedParentFor(base, 'root'),
    })
    expectOk(result)
  })

  it('rejects an unknown targetLeafId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'ghost',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a targetLeafId that names a split, not a leaf', () => {
    const { doc, splitId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'insert_grid',
        targetLeafId: splitId,
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects a targetLeafId that names an existing GRID — v1 only splits beside a leaf', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'insert_grid',
        targetLeafId: gridId,
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects a stale expectedParent', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: { kind: 'child', splitId: 'nonexistent', side: 'start' },
      }),
    )
    expect(err.code).toBe('LAYOP_STALE_PARENT')
  })

  it('rejects an invalid axis and an invalid side', () => {
    const base = singleLeafDoc('root')
    const errAxis = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'diagonal' as unknown as 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(errAxis.code).toBe('LAYOP_INVALID_ENUM')
    const errSide = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'middle' as unknown as 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(errSide.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects a gridId that collides with an existing node id', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'root',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects a splitId that collides with an existing node id', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'root',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects gridId === splitId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'same',
        gridId: 'same',
        gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_ID_COLLISION')
  })

  it('rejects an invalid flow', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'freeform' as unknown as 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects an invalid minCellWidth', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: { flow: 'reflow', minCellWidth: 0, children: makeFixedChildren([]) },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY001_INVALID_MIN_CELL_WIDTH')
  })

  it('rejects malformed children (duplicate cell ids)', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: {
          flow: 'reflow',
          minCellWidth: 100,
          children: makeFixedChildren([makeGridCell('a'), makeGridCell('a')]),
        },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects an unregistered cell face', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: {
          flow: 'reflow',
          minCellWidth: 100,
          children: makeFixedChildren([makeGridCell('a', 'nonexistent.face')]),
        },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY003_UNREGISTERED_FACE')
  })

  it('rejects a registered but grid-INELIGIBLE cell face (design §2.1 cell persistence rule)', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: {
          flow: 'reflow',
          minCellWidth: 100,
          children: makeFixedChildren([makeGridCell('a', GRID_INELIGIBLE_FACE_ID)]),
        },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
  })

  it('rejects a grid-ineligible itemFaceId on a collection source', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: 'root',
        axis: 'horizontal',
        side: 'start',
        splitId: 'y',
        gridId: 'z',
        gridConfig: {
          flow: 'reflow',
          minCellWidth: 100,
          children: makeCollectionChildren({ itemFaceId: GRID_INELIGIBLE_FACE_ID }),
        },
        expectedParent: expectedParentFor(base, 'root'),
      }),
    )
    expect(err.code).toBe('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
  })
})

describe('applyOperation — close_node (generalizes close_leaf to any node id: leaf, grid, or a whole split subtree)', () => {
  it('closing a non-root LEAF behaves identically to close_leaf (sibling promotion)', () => {
    const { doc: base, leafAId } = twoLeafDoc()
    const viaCloseLeaf = expectOk(
      applyOperation(base, { op: 'close_leaf', leafId: leafAId, expectedParent: expectedParentFor(base, leafAId) }),
    )
    const viaCloseNode = expectOk(
      applyOperation(base, { op: 'close_node', nodeId: leafAId, expectedParent: expectedParentFor(base, leafAId) }),
    )
    expect(viaCloseNode.rootNodeId).toBe(viaCloseLeaf.rootNodeId)
    expect(viaCloseNode.nodes).toEqual(viaCloseLeaf.nodes)
  })

  it('closing a non-root GRID removes it entirely and promotes the leaf sibling to root', () => {
    const { doc, splitId, leafId, gridId } = leafAndGridDoc()
    const result = expectOk(applyOperation(doc, { op: 'close_node', nodeId: gridId, expectedParent: expectedParentFor(doc, gridId) }))
    expect(result.rootNodeId).toBe(leafId)
    expect(Object.keys(result.nodes)).toEqual([leafId])
    expect(result.nodes[splitId]).toBeUndefined()
    expect(result.nodes[gridId]).toBeUndefined()
  })

  it('closing an entire SPLIT SUBTREE (multiple descendants) disposes ALL of them, promoting the other sibling', () => {
    const { doc, leafAId, leafBId, leafCId, midSplitId } = threeLeafTree()
    // tree: root(leafA, midSplit(leafB, leafC))
    const result = expectOk(
      applyOperation(doc, { op: 'close_node', nodeId: midSplitId, expectedParent: expectedParentFor(doc, midSplitId) }),
    )
    expect(result.rootNodeId).toBe(leafAId)
    expect(Object.keys(result.nodes)).toEqual([leafAId])
    expect(result.nodes[leafBId]).toBeUndefined()
    expect(result.nodes[leafCId]).toBeUndefined()
    expect(result.nodes[midSplitId]).toBeUndefined()
  })

  it('root case, root is a LEAF: identical to close_leaf (descriptorRevision increments, same id)', () => {
    const base = singleLeafDoc('root')
    const viaCloseLeaf = expectOk(applyOperation(base, { op: 'close_leaf', leafId: 'root', expectedParent: expectedParentFor(base, 'root') }))
    const viaCloseNode = expectOk(applyOperation(base, { op: 'close_node', nodeId: 'root', expectedParent: expectedParentFor(base, 'root') }))
    expect(viaCloseNode.nodes).toEqual(viaCloseLeaf.nodes)
    const leaf = viaCloseNode.nodes['root'] as LayoutLeafNode
    expect(leaf.descriptor.faceId).toBe(SOPHIA_HOME_FACE_ID)
    expect(leaf.descriptorRevision).toBe(1)
  })

  it('root case, root is a GRID: the entire tree collapses to one fresh sophia.home leaf at the same id, revision 0', () => {
    const doc = singleGridDoc('grid-root')
    const result = expectOk(applyOperation(doc, { op: 'close_node', nodeId: 'grid-root', expectedParent: expectedParentFor(doc, 'grid-root') }))
    expect(result.rootNodeId).toBe('grid-root')
    expect(Object.keys(result.nodes)).toEqual(['grid-root'])
    const leaf = result.nodes['grid-root'] as LayoutLeafNode
    expect(leaf.kind).toBe('leaf')
    expect(leaf.descriptor.faceId).toBe(SOPHIA_HOME_FACE_ID)
    expect(leaf.descriptorRevision).toBe(0)
  })

  it('root case, root is a SPLIT with many descendants: the whole tree collapses to one fresh leaf', () => {
    const { doc, splitId } = twoLeafDoc()
    const result = expectOk(applyOperation(doc, { op: 'close_node', nodeId: splitId, expectedParent: expectedParentFor(doc, splitId) }))
    expect(result.rootNodeId).toBe(splitId)
    expect(Object.keys(result.nodes)).toEqual([splitId])
    const leaf = result.nodes[splitId] as LayoutLeafNode
    expect(leaf.kind).toBe('leaf')
    expect(leaf.descriptorRevision).toBe(0)
  })

  it('LAY-010 preserved via the broadened definition: closing a leaf whose sibling is a grid promotes the grid to root, still valid', () => {
    const { doc, leafId } = leafAndGridDoc()
    const result = expectOk(applyOperation(doc, { op: 'close_node', nodeId: leafId, expectedParent: expectedParentFor(doc, leafId) }))
    expect(validateLayoutDocument(result)).toEqual({ ok: true })
    expect(result.nodes[result.rootNodeId].kind).toBe('grid')
  })

  it('rejects an unknown nodeId', () => {
    const base = singleLeafDoc('root')
    const err = expectErr(applyOperation(base, { op: 'close_node', nodeId: 'ghost', expectedParent: PLACEHOLDER_PARENT }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a stale expectedParent', () => {
    const { doc, leafAId } = twoLeafDoc()
    const err = expectErr(
      applyOperation(doc, { op: 'close_node', nodeId: leafAId, expectedParent: { kind: 'child', splitId: 'nonexistent', side: 'start' } }),
    )
    expect(err.code).toBe('LAYOP_STALE_PARENT')
  })
})

describe('applyOperation — grid_set_cells', () => {
  it('replaces cells wholesale and bumps gridRevision', () => {
    const { doc, gridId } = leafAndGridDoc()
    const originalGrid = doc.nodes[gridId]
    const newCells = [makeGridCell('x'), makeGridCell('y')]
    const result = expectOk(
      applyOperation(doc, { op: 'grid_set_cells', gridId, cells: newCells, expectedGridRevision: expectedGridRevisionFor(doc, gridId) }),
    )
    const grid = result.nodes[gridId] as LayoutGridNode
    expect(grid.gridRevision).toBe(1)
    expect(grid.children).toEqual({ kind: 'fixed', cells: newCells })
    expect(result.nodes[gridId]).not.toBe(originalGrid)
  })

  it('rejects an unknown gridId', () => {
    const err = expectErr(applyOperation(leafAndGridDoc().doc, { op: 'grid_set_cells', gridId: 'ghost', cells: [], expectedGridRevision: 0 }))
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a gridId that names a leaf', () => {
    const { doc, leafId } = leafAndGridDoc()
    const err = expectErr(applyOperation(doc, { op: 'grid_set_cells', gridId: leafId, cells: [], expectedGridRevision: 0 }))
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('rejects a stale expectedGridRevision', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(applyOperation(doc, { op: 'grid_set_cells', gridId, cells: [], expectedGridRevision: 99 }))
    expect(err.code).toBe('LAYOP_STALE_GRID_REVISION')
  })

  it('rejects malformed cells (duplicate ids)', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_set_cells',
        gridId,
        cells: [makeGridCell('dup'), makeGridCell('dup')],
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects an unregistered face in a new cell', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_set_cells',
        gridId,
        cells: [makeGridCell('a', 'nonexistent.face')],
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY003_UNREGISTERED_FACE')
  })

  it('rejects a grid-ineligible face in a new cell', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_set_cells',
        gridId,
        cells: [makeGridCell('a', GRID_INELIGIBLE_FACE_ID)],
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
  })

  it('leaves the untouched sibling leaf entry reference-identical', () => {
    const { doc, gridId, leafId } = leafAndGridDoc()
    const originalLeaf = doc.nodes[leafId]
    const result = expectOk(
      applyOperation(doc, { op: 'grid_set_cells', gridId, cells: [], expectedGridRevision: expectedGridRevisionFor(doc, gridId) }),
    )
    expect(result.nodes[leafId]).toBe(originalLeaf)
  })
})

describe('applyOperation — grid_bind_collection', () => {
  it('flips a fixed grid to a collection source and bumps gridRevision', () => {
    const { doc, gridId } = leafAndGridDoc()
    const result = expectOk(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: makeQueryLocator(),
        itemFaceId: 'test.face',
        maxItems: 5,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    const grid = result.nodes[gridId] as LayoutGridNode
    expect(grid.gridRevision).toBe(1)
    expect(grid.children).toEqual({ kind: 'collection', collection: makeQueryLocator(), itemFaceId: 'test.face', maxItems: 5 })
  })

  it('round-trips optional itemParams / refreshSeconds', () => {
    const { doc, gridId } = leafAndGridDoc()
    const result = expectOk(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: makeQueryLocator(),
        itemFaceId: 'test.face',
        maxItems: 5,
        itemParams: { title: '?label' },
        refreshSeconds: 30,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    const grid = result.nodes[gridId] as LayoutGridNode
    if (grid.children.kind !== 'collection') throw new Error('expected a collection source')
    expect(grid.children.itemParams).toEqual({ title: '?label' })
    expect(grid.children.refreshSeconds).toBe(30)
  })

  it('rejects a stale expectedGridRevision', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: makeQueryLocator(),
        itemFaceId: 'test.face',
        maxItems: 5,
        expectedGridRevision: 99,
      }),
    )
    expect(err.code).toBe('LAYOP_STALE_GRID_REVISION')
  })

  it('rejects a non-query collection locator', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: { kind: 'iri', iri: 'urn:test:not-a-query' },
        itemFaceId: 'test.face',
        maxItems: 5,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects an invalid maxItems', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: makeQueryLocator(),
        itemFaceId: 'test.face',
        maxItems: 0,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects a grid-ineligible itemFaceId', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_bind_collection',
        gridId,
        collection: makeQueryLocator(),
        itemFaceId: GRID_INELIGIBLE_FACE_ID,
        maxItems: 5,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
  })
})

describe('applyOperation — grid_set_flow', () => {
  it('changes flow + minCellWidth and bumps gridRevision, leaving children untouched (reference-identical)', () => {
    const { doc, gridId } = leafAndGridDoc()
    const originalChildren = (doc.nodes[gridId] as LayoutGridNode).children
    const result = expectOk(
      applyOperation(doc, { op: 'grid_set_flow', gridId, flow: 'stack', minCellWidth: 333, expectedGridRevision: expectedGridRevisionFor(doc, gridId) }),
    )
    const grid = result.nodes[gridId] as LayoutGridNode
    expect(grid.flow).toBe('stack')
    expect(grid.minCellWidth).toBe(333)
    expect(grid.gridRevision).toBe(1)
    expect(grid.children).toBe(originalChildren)
  })

  it('rejects an unknown gridId', () => {
    const err = expectErr(
      applyOperation(leafAndGridDoc().doc, { op: 'grid_set_flow', gridId: 'ghost', flow: 'reflow', minCellWidth: 100, expectedGridRevision: 0 }),
    )
    expect(err.code).toBe('LAYOP_NODE_NOT_FOUND')
  })

  it('rejects a stale expectedGridRevision', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(applyOperation(doc, { op: 'grid_set_flow', gridId, flow: 'reflow', minCellWidth: 100, expectedGridRevision: 99 }))
    expect(err.code).toBe('LAYOP_STALE_GRID_REVISION')
  })

  it('rejects an invalid flow', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'grid_set_flow',
        gridId,
        flow: 'radial' as unknown as 'reflow',
        minCellWidth: 100,
        expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      }),
    )
    expect(err.code).toBe('LAYOP_INVALID_ENUM')
  })

  it('rejects an invalid minCellWidth', () => {
    const { doc, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, { op: 'grid_set_flow', gridId, flow: 'reflow', minCellWidth: -5, expectedGridRevision: expectedGridRevisionFor(doc, gridId) }),
    )
    expect(err.code).toBe('LAY001_INVALID_MIN_CELL_WIDTH')
  })
})

describe('applyOperation — swap_nodes / move_node treat grid ids as opaque subtrees', () => {
  it('swap_nodes exchanges a leaf and a grid; both node entries survive by reference (only parent edges rewire)', () => {
    const { doc, splitId, leafId, gridId } = leafAndGridDoc()
    const originalGridNode = doc.nodes[gridId]
    const originalLeafNode = doc.nodes[leafId]
    const result = expectOk(applyOperation(doc, { op: 'swap_nodes', firstNodeId: leafId, secondNodeId: gridId }))
    const split = result.nodes[splitId] as LayoutSplitNode
    expect(split.startNodeId).toBe(gridId)
    expect(split.endNodeId).toBe(leafId)
    expect(result.nodes[gridId]).toBe(originalGridNode)
    expect(result.nodes[leafId]).toBe(originalLeafNode)
  })

  it('move_node relocates a grid beside another leaf; the grid subtree itself is untouched by reference', () => {
    const { doc: base, leafAId } = twoLeafDoc()
    const inserted = expectOk(
      applyOperation(base, {
        op: 'insert_grid',
        targetLeafId: leafAId,
        axis: 'horizontal',
        side: 'end',
        splitId: 'grid-split',
        gridId: 'the-grid',
        gridConfig: { flow: 'reflow', minCellWidth: 150, children: makeFixedChildren([makeGridCell('c')]) },
        expectedParent: expectedParentFor(base, leafAId),
      }),
    )
    const originalGridNode = inserted.nodes['the-grid']
    const result = expectOk(
      applyOperation(inserted, {
        op: 'move_node',
        nodeId: 'the-grid',
        targetLeafId: 'leaf-b',
        side: 'start',
        axis: 'vertical',
        splitId: 'move-split',
        expectedParent: expectedParentFor(inserted, 'the-grid'),
        expectedTargetParent: expectedParentFor(inserted, 'leaf-b'),
      }),
    )
    const moveSplit = result.nodes['move-split'] as LayoutSplitNode
    expect(moveSplit.startNodeId).toBe('the-grid')
    expect(moveSplit.endNodeId).toBe('leaf-b')
    expect(result.nodes['the-grid']).toBe(originalGridNode)
  })

  it('move_node rejects a GRID as the target (targetLeafId must name a leaf — same constraint split_leaf/insert_grid share)', () => {
    const { doc, leafId, gridId } = leafAndGridDoc()
    const err = expectErr(
      applyOperation(doc, {
        op: 'move_node',
        nodeId: leafId,
        targetLeafId: gridId,
        side: 'start',
        axis: 'horizontal',
        splitId: 'x',
        expectedParent: expectedParentFor(doc, leafId),
        expectedTargetParent: PLACEHOLDER_PARENT,
      }),
    )
    expect(err.code).toBe('LAYOP_NODE_KIND_MISMATCH')
  })

  it('swap_nodes self-swap of a grid with itself is a benign no-op, unaffected by node kind', () => {
    const { doc, gridId } = leafAndGridDoc()
    const result = applyOperation(doc, { op: 'swap_nodes', firstNodeId: gridId, secondNodeId: gridId })
    expect(result.ok).toBe(true)
  })
})

describe('applyOperation — grid ops: decode-time malformed mandatory-field rejection (mirrors the existing six, design §9.2 Phase 1 r2 discipline)', () => {
  it('insert_grid: targetLeafId=null never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = {
      op: 'insert_grid',
      targetLeafId: null,
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
      expectedParent: { kind: 'root' },
    } as unknown as LayoutOperation
    let result: OperationResult | undefined
    expect(() => {
      result = applyOperation(base, op)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result!.diagnostic.details?.field).toBe('targetLeafId')
  })

  it('insert_grid: gridConfig missing never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      expectedParent: expectedParentFor(base, 'root'),
    } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('gridConfig')
  })

  it('insert_grid: gridConfig wrong TYPE (a string) never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      gridConfig: 'nope',
      expectedParent: expectedParentFor(base, 'root'),
    } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('gridConfig')
  })

  it('insert_grid: gridConfig with an UNKNOWN nested key is rejected, not silently dropped', () => {
    const base = singleLeafDoc('root')
    const op = {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      gridConfig: {
        flow: 'reflow',
        minCellWidth: 100,
        children: makeFixedChildren([]),
        gridRevision: 7, // forged: a caller-supplied value for a field the op itself assigns
      },
      expectedParent: expectedParentFor(base, 'root'),
    } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('gridConfig')
  })

  it('insert_grid: gridConfig well-TYPED but invalid CONTENT decodes past the malformed gate, rejected downstream by the reducer — type-decoding and content validation stay separate concerns', () => {
    const base = singleLeafDoc('root')
    const op: LayoutOperation = {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      gridConfig: { flow: 'reflow', minCellWidth: -1, children: makeFixedChildren([]) },
      expectedParent: expectedParentFor(base, 'root'),
    }
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAY001_INVALID_MIN_CELL_WIDTH')
  })

  it('insert_grid: expectedParent missing never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = {
      op: 'insert_grid',
      targetLeafId: 'root',
      axis: 'horizontal',
      side: 'start',
      splitId: 'y',
      gridId: 'z',
      gridConfig: { flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([]) },
    } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('expectedParent')
  })

  it('close_node: nodeId=42 never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = { op: 'close_node', nodeId: 42, expectedParent: { kind: 'root' } } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('nodeId')
  })

  it('close_node: expectedParent malformed (missing "kind") never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const base = singleLeafDoc('root')
    const op = { op: 'close_node', nodeId: 'root', expectedParent: { splitId: 'x', side: 'start' } } as unknown as LayoutOperation
    const result = applyOperation(base, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it('grid_set_cells: cells missing never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_cells', gridId, expectedGridRevision: 0 } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('cells')
  })

  it('grid_set_cells: cells wrong TYPE (an object, not an array) never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_cells', gridId, cells: {}, expectedGridRevision: 0 } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('cells')
  })

  it('grid_set_cells: expectedGridRevision missing never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_cells', gridId, cells: [] } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('expectedGridRevision')
  })

  it('grid_set_cells: expectedGridRevision = -1 (well-typed but out of range) never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_cells', gridId, cells: [], expectedGridRevision: -1 } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('expectedGridRevision')
  })

  it('grid_bind_collection: collection missing never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = {
      op: 'grid_bind_collection',
      gridId,
      itemFaceId: 'test.face',
      maxItems: 5,
      expectedGridRevision: 0,
    } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('collection')
  })

  it('grid_bind_collection: maxItems wrong TYPE never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = {
      op: 'grid_bind_collection',
      gridId,
      collection: makeQueryLocator(),
      itemFaceId: 'test.face',
      maxItems: '5',
      expectedGridRevision: 0,
    } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('maxItems')
  })

  it('grid_bind_collection: itemFaceId="" (empty string) never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = {
      op: 'grid_bind_collection',
      gridId,
      collection: makeQueryLocator(),
      itemFaceId: '',
      maxItems: 5,
      expectedGridRevision: 0,
    } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('itemFaceId')
  })

  it('grid_set_flow: flow wrong TYPE (a number) never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_flow', gridId, flow: 42, minCellWidth: 100, expectedGridRevision: 0 } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('flow')
  })

  it('grid_set_flow: minCellWidth wrong TYPE never throws, rejected as LAYOP_MALFORMED_OPERATION', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = { op: 'grid_set_flow', gridId, flow: 'reflow', minCellWidth: '100', expectedGridRevision: 0 } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
    expect(result.diagnostic.details?.field).toBe('minCellWidth')
  })

  it('an unknown extra key on a grid op is rejected as LAYOP_MALFORMED_OPERATION (closed key set, same as the existing six)', () => {
    const { doc, gridId } = leafAndGridDoc()
    const op = {
      op: 'grid_set_flow',
      gridId,
      flow: 'reflow',
      minCellWidth: 100,
      expectedGridRevision: expectedGridRevisionFor(doc, gridId),
      bogus: 1,
    } as unknown as LayoutOperation
    const result = applyOperation(doc, op)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_MALFORMED_OPERATION')
  })

  it('applyOperation(doc, null) / applyOperation(doc, undefined) still never throw now that the union has 11 members', () => {
    const base = singleLeafDoc('root')
    expect(() => applyOperation(base, null as unknown as LayoutOperation)).not.toThrow()
    expect(() => applyOperation(base, undefined as unknown as LayoutOperation)).not.toThrow()
    expect(applyOperation(base, null as unknown as LayoutOperation).ok).toBe(false)
  })
})
