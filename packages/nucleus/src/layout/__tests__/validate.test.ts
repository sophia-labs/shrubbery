/**
 * validateLayoutDocument unit tests — one case per invariant validator
 * (LAY-000 document schema, LAY-001, LAY-002, LAY-003/004, LAY-010), plus the
 * mandatory face-registration allow-list, closed-schema rejection tests
 * (design §9.2 Phase 1 diff-review r1), content-free diagnostic leakage
 * tests, and the validated immutable-document constructor.
 *
 * `validateLayoutDocument`/`solveLayout` calls in THIS file go through a
 * local shim that injects `TEST_VALIDATE_OPTIONS` (fixtures.ts) by default —
 * the production default predicate is now a MANDATORY, closed allow-list
 * containing only `sophia.home` (validate.ts's `PHASE1_KNOWN_FACE_IDS`), so
 * fixtures built with 'test.face' etc. need the test registry to validate.
 * Tests that specifically probe the REAL production default call the raw,
 * unwrapped `validateLayoutDocumentRaw` / `defaultFaceRegistrationPredicate`
 * directly (see the "mandatory face-registration allow-list" describe block).
 */
import { describe, expect, it } from 'vitest'
import type { GridChildrenSource, LayoutDocument, LayoutGridNode, LayoutLeafNode, LayoutNode, LayoutSplitNode } from '../types.js'
import { SOPHIA_HOME_FACE_ID } from '../types.js'
import type { ValidateOptions, ValidationResult } from '../validate.js'
import { makeDiagnostic as makeDiagnosticForTest, sortDiagnostics as sortDiagnosticsForTest } from '../diagnostics.js'
import {
  anyClosedParams,
  createExactParamsSchema,
  createFaceAllowListPredicate,
  createValidatedLayoutDocument,
  defaultFaceGridEligibilityPredicate,
  defaultFaceRegistrationPredicate,
  isWellShapedGridChildrenSource,
  isWellShapedViewDescriptor,
  noParamsAllowed,
  validateLayoutDocument as validateLayoutDocumentRaw,
} from '../validate.js'
import {
  GRID_INELIGIBLE_FACE_ID,
  STRICT_MODE_FACE_ID,
  TEST_FACE_REGISTRATIONS,
  TEST_VALIDATE_OPTIONS,
  leafAndGridDoc,
  makeCollectionChildren,
  makeDescriptor,
  makeFixedChildren,
  makeGridCell,
  makeQueryLocator,
  singleGridDoc,
  singleLeafDoc,
  testFaceRegistrationPredicate,
  twoLeafDoc,
} from './fixtures.js'

function validateLayoutDocument(doc: LayoutDocument, options?: ValidateOptions): ValidationResult {
  return validateLayoutDocumentRaw(doc, options ?? TEST_VALIDATE_OPTIONS)
}

function codesOf(result: ReturnType<typeof validateLayoutDocument>): string[] {
  if (result.ok) return []
  return result.diagnostics.map((d) => d.code)
}

describe('validateLayoutDocument — valid documents pass', () => {
  it('a single-leaf document is valid', () => {
    expect(validateLayoutDocument(singleLeafDoc())).toEqual({ ok: true })
  })

  it('a two-leaf split document is valid', () => {
    expect(validateLayoutDocument(twoLeafDoc().doc)).toEqual({ ok: true })
  })
})

describe('validateLayoutDocument — LAY-000 document schema', () => {
  it('rejects a non-object document', () => {
    const result = validateLayoutDocument(null as unknown as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_DOCUMENT_SHAPE')
  })

  it('rejects an unknown top-level field', () => {
    const doc = singleLeafDoc()
    const withExtra = { ...doc, extraField: 'sneaky' } as unknown as LayoutDocument
    const result = validateLayoutDocument(withExtra)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_UNKNOWN_TOP_LEVEL_FIELD')
  })

  it('rejects a wrong schemaVersion (LAY000_INVALID_SCHEMA_VERSION)', () => {
    const doc = singleLeafDoc()
    const broken = { ...doc, schemaVersion: 2 } as unknown as LayoutDocument
    const result = validateLayoutDocument(broken)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_SCHEMA_VERSION')
  })

  it('rejects an empty layoutId (LAY000_INVALID_LAYOUT_ID)', () => {
    const doc = singleLeafDoc()
    const broken = { ...doc, layoutId: '' }
    const result = validateLayoutDocument(broken)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_LAYOUT_ID')
  })

  it('rejects an illegal scope, e.g. "admin" (LAY000_INVALID_SCOPE)', () => {
    const doc = singleLeafDoc()
    const broken = { ...doc, scope: 'admin' } as unknown as LayoutDocument
    const result = validateLayoutDocument(broken)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_SCOPE')
  })

  it('rejects a numeric graphId (LAY000_INVALID_GRAPH_ID)', () => {
    const doc = singleLeafDoc()
    const broken = { ...doc, graphId: 12345 } as unknown as LayoutDocument
    const result = validateLayoutDocument(broken)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_GRAPH_ID')
  })

  it('accepts a string graphId and a null graphId', () => {
    const doc = singleLeafDoc()
    expect(validateLayoutDocument({ ...doc, graphId: 'some-graph' })).toEqual({ ok: true })
    expect(validateLayoutDocument({ ...doc, graphId: null })).toEqual({ ok: true })
  })

  it('rejects a non-ISO createdAt/updatedAt (LAY000_INVALID_TIMESTAMP)', () => {
    const doc = singleLeafDoc()
    const brokenCreated = { ...doc, createdAt: 'not-a-date' }
    expect(codesOf(validateLayoutDocument(brokenCreated))).toContain('LAY000_INVALID_TIMESTAMP')
    const brokenUpdated = { ...doc, updatedAt: '' }
    expect(codesOf(validateLayoutDocument(brokenUpdated))).toContain('LAY000_INVALID_TIMESTAMP')
  })

  it('rejects a nodes map that is not a plain own-property object (LAY000_INVALID_NODES_MAP)', () => {
    const doc = singleLeafDoc()
    const asArray = { ...doc, nodes: [] } as unknown as LayoutDocument
    expect(codesOf(validateLayoutDocument(asArray))).toContain('LAY000_INVALID_NODES_MAP')

    class NotPlain {
      leafRoot = doc.nodes['leaf-root']
    }
    const asClassInstance = { ...doc, nodes: new NotPlain() } as unknown as LayoutDocument
    expect(codesOf(validateLayoutDocument(asClassInstance))).toContain('LAY000_INVALID_NODES_MAP')
  })

  it('a maximally adversarial forged document (multiple violations at once) is rejected, not partially accepted', () => {
    const forged = {
      schemaVersion: 2,
      layoutId: 'x',
      scope: 'admin',
      graphId: 42,
      rootNodeId: 'root',
      nodes: {
        root: {
          kind: 'leaf',
          id: 'root',
          descriptor: { schemaVersion: 1, faceId: 'x', resource: { kind: 'iri', iri: 'x' } },
          descriptorRevision: 0,
        },
      },
      createdAt: 'nope',
      updatedAt: 'nope',
      sneaky: 'field',
    } as unknown as LayoutDocument
    const result = validateLayoutDocument(forged)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'LAY000_INVALID_SCHEMA_VERSION',
        'LAY000_INVALID_SCOPE',
        'LAY000_INVALID_GRAPH_ID',
        'LAY000_INVALID_TIMESTAMP',
        'LAY000_UNKNOWN_TOP_LEVEL_FIELD',
      ]),
    )
  })
})

describe('validateLayoutDocument — LAY-001 tree', () => {
  it('rejects a rootNodeId that does not resolve (LAY001_NO_ROOT)', () => {
    const doc = singleLeafDoc()
    const broken: LayoutDocument = { ...doc, rootNodeId: 'does-not-exist' }
    const result = validateLayoutDocument(broken)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_NO_ROOT')
  })

  it('rejects an invalid split axis (LAY001_INVALID_AXIS)', () => {
    const { doc, splitId } = twoLeafDoc()
    const nodes = { ...doc.nodes }
    const split = nodes[splitId]
    if (split.kind !== 'split') throw new Error('fixture invariant')
    nodes[splitId] = { ...split, axis: 'diagonal' as unknown as 'horizontal' }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_INVALID_AXIS')
  })

  it.each([0, 10000, 1.5, -1, Number.NaN])(
    'rejects an out-of-range/non-integer startBasisPoints=%s (LAY001_INVALID_RATIO_RANGE)',
    (bad) => {
      const { doc, splitId } = twoLeafDoc()
      const nodes = { ...doc.nodes }
      const split = nodes[splitId]
      if (split.kind !== 'split') throw new Error('fixture invariant')
      nodes[splitId] = { ...split, startBasisPoints: bad }
      const result = validateLayoutDocument({ ...doc, nodes })
      expect(result.ok).toBe(false)
      expect(codesOf(result)).toContain('LAY001_INVALID_RATIO_RANGE')
    },
  )

  it('rejects a split whose start/end children are the same id (LAY001_DEGENERATE_SPLIT)', () => {
    const { doc, splitId, leafAId } = twoLeafDoc()
    const nodes = { ...doc.nodes }
    const split = nodes[splitId]
    if (split.kind !== 'split') throw new Error('fixture invariant')
    nodes[splitId] = { ...split, endNodeId: leafAId }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_DEGENERATE_SPLIT')
  })

  it('rejects a dangling child reference (LAY001_DANGLING_CHILD)', () => {
    const { doc, splitId } = twoLeafDoc()
    const nodes = { ...doc.nodes }
    const split = nodes[splitId]
    if (split.kind !== 'split') throw new Error('fixture invariant')
    nodes[splitId] = { ...split, endNodeId: 'ghost-leaf' }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_DANGLING_CHILD')
  })

  it('rejects a 2-cycle without throwing (LAY001_CYCLE)', () => {
    const nodes: Record<string, LayoutNode> = {
      a: { kind: 'split', id: 'a', axis: 'horizontal', startNodeId: 'b', endNodeId: 'leaf-x', startBasisPoints: 5000 },
      b: { kind: 'split', id: 'b', axis: 'vertical', startNodeId: 'a', endNodeId: 'leaf-y', startBasisPoints: 5000 },
      'leaf-x': { kind: 'leaf', id: 'leaf-x', descriptor: makeDescriptor(), descriptorRevision: 0 },
      'leaf-y': { kind: 'leaf', id: 'leaf-y', descriptor: makeDescriptor(), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'cyclic',
      scope: 'session',
      graphId: null,
      rootNodeId: 'a',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    let result: ReturnType<typeof validateLayoutDocument> | undefined
    expect(() => {
      result = validateLayoutDocument(doc)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    expect(codesOf(result!)).toContain('LAY001_CYCLE')
  })

  it('rejects a shared child / diamond (LAY001_MULTIPLE_PARENTS)', () => {
    const nodes: Record<string, LayoutNode> = {
      root: {
        kind: 'split',
        id: 'root',
        axis: 'horizontal',
        startNodeId: 'mid-a',
        endNodeId: 'mid-b',
        startBasisPoints: 5000,
      },
      'mid-a': {
        kind: 'split',
        id: 'mid-a',
        axis: 'vertical',
        startNodeId: 'shared',
        endNodeId: 'leaf-1',
        startBasisPoints: 5000,
      },
      'mid-b': {
        kind: 'split',
        id: 'mid-b',
        axis: 'vertical',
        startNodeId: 'shared',
        endNodeId: 'leaf-2',
        startBasisPoints: 5000,
      },
      shared: { kind: 'leaf', id: 'shared', descriptor: makeDescriptor(), descriptorRevision: 0 },
      'leaf-1': { kind: 'leaf', id: 'leaf-1', descriptor: makeDescriptor(), descriptorRevision: 0 },
      'leaf-2': { kind: 'leaf', id: 'leaf-2', descriptor: makeDescriptor(), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'diamond',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const result = validateLayoutDocument(doc)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_MULTIPLE_PARENTS')
  })

  it('rejects an orphan node present in the map but unreachable from root (LAY001_ORPHAN_NODE)', () => {
    const doc = singleLeafDoc()
    const nodes = {
      ...doc.nodes,
      orphan: { kind: 'leaf' as const, id: 'orphan', descriptor: makeDescriptor(), descriptorRevision: 0 },
    }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_ORPHAN_NODE')
  })

  it('rejects root appearing as some split\'s child (LAY001_MULTIPLE_PARENTS)', () => {
    const { doc, splitId, leafAId } = twoLeafDoc()
    // Point leafA's descriptor-carrying entry aside and make the ROOT split
    // itself also be referenced as a child — construct a second split above
    // it that points back at the existing root id, which is structurally
    // impossible to reach through normal ops, so build it by hand.
    const nodes = { ...doc.nodes }
    nodes['above'] = {
      kind: 'split',
      id: 'above',
      axis: 'vertical',
      startNodeId: splitId,
      endNodeId: leafAId,
      startBasisPoints: 5000,
    }
    // rootNodeId still points at splitId (not 'above'), so splitId now has an
    // incoming edge from 'above' while still being declared the document root.
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_MULTIPLE_PARENTS')
  })
})

describe('validateLayoutDocument — LAY-002 stable identity (self-consistency)', () => {
  it('rejects a node whose embedded id does not match its map key', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = { ...doc.nodes, 'leaf-root': { ...node, id: 'someone-else' } }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY002_ID_MISMATCH')
  })

  it.each([-1, 1.5, Number.NaN, '0', null, undefined])(
    'rejects an invalid descriptorRevision=%s (LAY002_INVALID_DESCRIPTOR_REVISION)',
    (bad) => {
      const doc = singleLeafDoc('leaf-root')
      const node = doc.nodes['leaf-root']
      const nodes = { ...doc.nodes, 'leaf-root': { ...node, descriptorRevision: bad as unknown as number } }
      const result = validateLayoutDocument({ ...doc, nodes })
      expect(result.ok).toBe(false)
      expect(codesOf(result)).toContain('LAY002_INVALID_DESCRIPTOR_REVISION')
    },
  )

  it('accepts descriptorRevision 0 and larger non-negative integers', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = { ...doc.nodes, 'leaf-root': { ...node, descriptorRevision: 7 } }
    expect(validateLayoutDocument({ ...doc, nodes })).toEqual({ ok: true })
  })
})

describe('validateLayoutDocument — prototype-colliding lookups and node shape closure (design §9.2 Phase 1 r2)', () => {
  it('a rootNodeId that only resolves via the PROTOTYPE CHAIN (e.g. "toString" against an empty nodes map) is rejected, not treated as a real node', () => {
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'proto-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: 'toString',
      nodes: {},
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    let result: ValidationResult | undefined
    expect(() => {
      result = validateLayoutDocument(doc)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    expect(codesOf(result!)).toContain('LAY001_NO_ROOT')
  })

  it('a split whose child id only resolves via the prototype chain ("constructor"/"hasOwnProperty") is a dangling child, not a real node', () => {
    for (const protoKey of ['constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const nodes: Record<string, LayoutNode> = {
        root: {
          kind: 'split',
          id: 'root',
          axis: 'horizontal',
          startNodeId: protoKey,
          endNodeId: 'leaf-b',
          startBasisPoints: 5000,
        },
        'leaf-b': { kind: 'leaf', id: 'leaf-b', descriptor: makeDescriptor(), descriptorRevision: 0 },
      }
      const doc: LayoutDocument = {
        schemaVersion: 1,
        layoutId: 'proto-probe',
        scope: 'session',
        graphId: null,
        rootNodeId: 'root',
        nodes,
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      }
      let result: ValidationResult | undefined
      expect(() => {
        result = validateLayoutDocument(doc)
      }).not.toThrow()
      expect(result!.ok).toBe(false)
      expect(codesOf(result!)).toContain('LAY001_DANGLING_CHILD')
    }
  })

  it('rejects a leaf node carrying an extra, unrecognized field (LAY001_INVALID_NODE_SHAPE) — the r1 implementation checked node FIELDS but never its key closure', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root'] as LayoutLeafNode
    const nodes = { ...doc.nodes, 'leaf-root': { ...node, extra: () => 'executable' } as unknown as LayoutNode }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_INVALID_NODE_SHAPE')
  })

  it('rejects a split node carrying an extra, unrecognized field', () => {
    const { doc, splitId } = twoLeafDoc()
    const node = doc.nodes[splitId] as LayoutSplitNode
    const nodes = { ...doc.nodes, [splitId]: { ...node, sneaky: 'field' } as unknown as LayoutNode }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_INVALID_NODE_SHAPE')
  })

  it('rejects a node that is not a plain object (a class instance masquerading as a leaf)', () => {
    class FakeLeaf {
      kind = 'leaf' as const
      id = 'leaf-root'
      descriptor = makeDescriptor()
      descriptorRevision = 0
    }
    const doc = singleLeafDoc('leaf-root')
    const nodes = { ...doc.nodes, 'leaf-root': new FakeLeaf() as unknown as LayoutNode }
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_INVALID_NODE_SHAPE')
  })

  it('a nodes map with a non-Object.prototype prototype (carrying an inherited "phantom" entry) is rejected outright, not silently walked for its inherited key', () => {
    const doc = singleLeafDoc('leaf-root')
    const nodesWithInherited: Record<string, LayoutNode> = Object.create(
      { phantom: doc.nodes['leaf-root'] },
      Object.getOwnPropertyDescriptors(doc.nodes),
    )
    // Sanity: the phantom key IS reachable via a bare bracket lookup...
    expect((nodesWithInherited as Record<string, unknown>).phantom).toBeDefined()
    // ...but isPlainObject's exact-prototype gate (Object.prototype or null
    // only) rejects this nodes map BEFORE any walk ever has the chance to
    // see — or ignore — that inherited key.
    const result = validateLayoutDocument({ ...doc, nodes: nodesWithInherited })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY000_INVALID_NODES_MAP')
  })

  it('an inherited (non-own) entry that survives on an OTHERWISE plain nodes object (Object.prototype in the chain) is never treated as a node', () => {
    // Object.prototype itself can carry an enumerable own-ish lookup target
    // via a prototype-chain collision on a NODE's key (e.g. 'toString') —
    // already covered by the "prototype-colliding lookups" describe block
    // above via rootNodeId/startNodeId/endNodeId. This test confirms the
    // per-node walk ITSELF (`Object.entries(nodes)`) never sees such a key:
    // Object.entries only ever enumerates OWN enumerable properties, so a
    // document whose nodes map has EXTRA own keys colliding with
    // Object.prototype member NAMES (but shadowing them with a real, valid
    // leaf) still validates as exactly that many real leaves — no phantom.
    const doc = singleLeafDoc('leaf-root')
    const phantomLeaf: LayoutNode = { kind: 'leaf', id: 'toString', descriptor: makeDescriptor(), descriptorRevision: 0 }
    const nodes: Record<string, LayoutNode> = { ...doc.nodes, toString: phantomLeaf }
    // This is now a TWO-leaf document (an orphan, since only 'leaf-root' is
    // reachable from root) — proving 'toString' was walked as a REAL own
    // key (own-property shadowing an inherited name is legitimate), not
    // silently merged with/confused for the inherited Object.prototype
    // member of the same name.
    const result = validateLayoutDocument({ ...doc, nodes })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY001_ORPHAN_NODE')
  })

  describe('createValidatedLayoutDocument — constructor revalidation catches what r1 missed', () => {
    it('rejects (and never freezes/clones) a leaf carrying an executable extra field — r1 let this through with the function left unfrozen', () => {
      const doc = singleLeafDoc('leaf-root')
      const node = doc.nodes['leaf-root'] as LayoutLeafNode
      let called = false
      const nodes = {
        ...doc.nodes,
        'leaf-root': {
          ...node,
          onClick: () => {
            called = true
          },
        } as unknown as LayoutNode,
      }
      const result = createValidatedLayoutDocument({ ...doc, nodes }, TEST_VALIDATE_OPTIONS)
      expect(result.ok).toBe(false)
      expect(called).toBe(false)
    })

    it('rejects a prototype-colliding rootNodeId rather than constructing anything from it', () => {
      const doc: LayoutDocument = {
        schemaVersion: 1,
        layoutId: 'proto-probe',
        scope: 'session',
        graphId: null,
        rootNodeId: 'toString',
        nodes: {},
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      }
      const result = createValidatedLayoutDocument(doc, TEST_VALIDATE_OPTIONS)
      expect(result.ok).toBe(false)
    })
  })
})

describe('validateLayoutDocument — LAY-003 typed leaf / face registration', () => {
  it('rejects a descriptor with the wrong schemaVersion (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': { ...node, descriptor: { ...(node as { descriptor: object }).descriptor, schemaVersion: 2 } },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a descriptor with an empty faceId (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': { ...node, descriptor: { ...(node as { descriptor: object }).descriptor, faceId: '' } },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a resource locator missing a required field for its kind (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: { schemaVersion: 1, faceId: 'x', resource: { kind: 'document', graphId: 'g' } },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a resource locator with an unknown/extra key (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: {
          schemaVersion: 1,
          faceId: 'x',
          resource: { kind: 'iri', iri: 'urn:x', extraField: 'sneaky' },
        },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a descriptor with an unknown/extra top-level key (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: { ...(node as { descriptor: object }).descriptor, sneaky: 'field' },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects a non-plain-object params (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: { ...(node as { descriptor: object }).descriptor, params: 'not-an-object' },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects params containing a FUNCTION at any depth (LAY003_INVALID_DESCRIPTOR)', () => {
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const withTopLevelFn = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: {
          ...(node as { descriptor: object }).descriptor,
          params: { onClick: () => undefined },
        },
      },
    }
    expect(codesOf(validateLayoutDocument({ ...doc, nodes: withTopLevelFn } as LayoutDocument))).toContain(
      'LAY003_INVALID_DESCRIPTOR',
    )

    const withNestedFn = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: {
          ...(node as { descriptor: object }).descriptor,
          params: { nested: { deeper: { handler: function boom() {} } } },
        },
      },
    }
    expect(codesOf(validateLayoutDocument({ ...doc, nodes: withNestedFn } as LayoutDocument))).toContain(
      'LAY003_INVALID_DESCRIPTOR',
    )
  })

  it('rejects params containing a class/provider/DOM-like instance, not just plain objects (LAY003_INVALID_DESCRIPTOR)', () => {
    class FakeProvider {
      connected = true
    }
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: {
          ...(node as { descriptor: object }).descriptor,
          params: { provider: new FakeProvider() },
        },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_INVALID_DESCRIPTOR')
  })

  it('rejects params carrying the class/provider instance AS the top-level value directly', () => {
    class FakeProvider {}
    expect(
      isWellShapedViewDescriptor({
        schemaVersion: 1,
        faceId: 'x',
        resource: { kind: 'iri', iri: 'urn:x' },
        params: new FakeProvider(),
      }),
    ).toBe(false)
  })

  it('rejects params with a prototype-pollution-shaped key (__proto__/constructor/prototype)', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const descriptor = {
        schemaVersion: 1 as const,
        faceId: 'x',
        resource: { kind: 'iri' as const, iri: 'urn:x' },
        params: JSON.parse(`{"${key}": {"polluted": true}}`) as Record<string, unknown>,
      }
      expect(isWellShapedViewDescriptor(descriptor)).toBe(false)
    }
  })

  it('rejects a circular params object rather than looping forever', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const descriptor = {
      schemaVersion: 1 as const,
      faceId: 'x',
      resource: { kind: 'iri' as const, iri: 'urn:x' },
      params: circular,
    }
    let ok: boolean | undefined
    expect(() => {
      ok = isWellShapedViewDescriptor(descriptor)
    }).not.toThrow()
    expect(ok).toBe(false)
  })

  it('accepts nested plain arrays/objects/primitives within params', () => {
    const descriptor = {
      schemaVersion: 1 as const,
      faceId: 'x',
      resource: { kind: 'iri' as const, iri: 'urn:x' },
      params: { maxRows: 100, tags: ['a', 'b'], nested: { flag: true, value: null } },
    }
    expect(isWellShapedViewDescriptor(descriptor)).toBe(true)
  })
})

describe('validateLayoutDocument — mandatory face-registration allow-list (design §9.2 Phase 1 r1)', () => {
  it('the production default predicate REJECTS an arbitrary well-shaped faceId (not the old permissive shape check)', () => {
    expect(defaultFaceRegistrationPredicate(makeDescriptor('anything.goes'))).toBe(false)
  })

  it('the production default predicate ACCEPTS sophia.home', () => {
    expect(defaultFaceRegistrationPredicate(makeDescriptor(SOPHIA_HOME_FACE_ID))).toBe(true)
  })

  it('validateLayoutDocument with NO options (true production default) rejects an unregistered faceId document', () => {
    const doc = singleLeafDoc('leaf-root', 'test.face')
    const result = validateLayoutDocumentRaw(doc) // no options — real default
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_UNREGISTERED_FACE')
  })

  it('validateLayoutDocument with NO options accepts a sophia.home-only document', () => {
    const doc = singleLeafDoc('leaf-root', SOPHIA_HOME_FACE_ID)
    expect(validateLayoutDocumentRaw(doc)).toEqual({ ok: true })
  })

  it('an injected isFaceRegistered predicate can reject a well-shaped but unregistered faceId', () => {
    const doc = singleLeafDoc('leaf-root', 'unregistered.face')
    const result = validateLayoutDocumentRaw(doc, { isFaceRegistered: () => false })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('LAY003_UNREGISTERED_FACE')
  })

  it('an injected isFaceRegistered predicate can allow-list specific faceIds', () => {
    const doc = singleLeafDoc('leaf-root', 'hoja.document')
    const result = validateLayoutDocumentRaw(doc, {
      isFaceRegistered: (d) => d.faceId === 'hoja.document',
    })
    expect(result).toEqual({ ok: true })
  })

  it('createFaceAllowListPredicate builds a closed allow-list: only listed ids pass, and only well-shaped descriptors', () => {
    const predicate = createFaceAllowListPredicate([
      { faceId: 'a.face', validateParams: anyClosedParams },
      { faceId: 'b.face', validateParams: anyClosedParams },
    ])
    expect(predicate(makeDescriptor('a.face'))).toBe(true)
    expect(predicate(makeDescriptor('b.face'))).toBe(true)
    expect(predicate(makeDescriptor('c.face'))).toBe(false)
    expect(predicate({ schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'x' } })).toBe(false)
  })
})

describe('createFaceAllowListPredicate — face-OWNED params schemas, not just id membership (design §2.2/§3.1, §9.2 Phase 1 r2)', () => {
  it('a registration with noParamsAllowed rejects a descriptor that carries ANY params, even well-shaped ones', () => {
    const predicate = createFaceAllowListPredicate([{ faceId: 'bare.face', validateParams: noParamsAllowed }])
    expect(predicate({ schemaVersion: 1, faceId: 'bare.face', resource: { kind: 'iri', iri: 'urn:x' } })).toBe(true)
    expect(
      predicate({
        schemaVersion: 1,
        faceId: 'bare.face',
        resource: { kind: 'iri', iri: 'urn:x' },
        params: { mode: 'document' },
      }),
    ).toBe(false)
  })

  it('sophia.home (registered via PHASE1_FACE_REGISTRATIONS/the real production default) rejects ANY params', () => {
    expect(
      defaultFaceRegistrationPredicate({
        schemaVersion: 1,
        faceId: SOPHIA_HOME_FACE_ID,
        resource: { kind: 'iri', iri: 'urn:sophia:home' },
        params: { anything: true },
      }),
    ).toBe(false)
  })

  it('a face with a NARROWER schema than the generic closed-shape floor rejects a well-shaped-but-non-conforming params object', () => {
    // STRICT_MODE_FACE_ID (fixtures.ts) requires EXACTLY {mode: 'document'|'composer'} —
    // a generically closed/serializable params object that doesn't match its
    // narrower shape must still be rejected by the FACE's own validator, even
    // though it would pass the generic isWellShapedViewDescriptor floor.
    const genericallyValidButWrongForThisFace = {
      schemaVersion: 1 as const,
      faceId: STRICT_MODE_FACE_ID,
      resource: { kind: 'iri' as const, iri: 'urn:x' },
      params: { maxRows: 100 },
    }
    expect(isWellShapedViewDescriptor(genericallyValidButWrongForThisFace)).toBe(true)
    expect(testFaceRegistrationPredicate(genericallyValidButWrongForThisFace)).toBe(false)

    const conforming = {
      schemaVersion: 1 as const,
      faceId: STRICT_MODE_FACE_ID,
      resource: { kind: 'iri' as const, iri: 'urn:x' },
      params: { mode: 'document' as const },
    }
    expect(testFaceRegistrationPredicate(conforming)).toBe(true)
  })
})

describe('LAY-004 closed catalog is ACTUALLY proven, not vacuous (Builder P1 hardening finding 1)', () => {
  it('createExactParamsSchema rejects an unlisted key even when every declared field is satisfied', () => {
    const schema = createExactParamsSchema({ count: { type: 'number', optional: true } })
    expect(schema({ count: 1 })).toBe(true)
    expect(schema(undefined)).toBe(true) // count is optional
    expect(schema({ count: 1, arbitraryUnknownKey: 1 })).toBe(false)
    expect(schema({ arbitraryUnknownKey: 1 })).toBe(false)
  })

  it('createExactParamsSchema enforces per-field TYPE, and REQUIRES a non-optional field', () => {
    const schema = createExactParamsSchema({
      mode: { type: 'enum', values: ['document', 'composer'] },
      maxRows: { type: 'number', optional: true },
    })
    expect(schema({ mode: 'document' })).toBe(true)
    expect(schema({ mode: 'document', maxRows: 10 })).toBe(true)
    expect(schema({ mode: 'not-a-legal-value' })).toBe(false)
    expect(schema({ mode: 'document', maxRows: 'ten' })).toBe(false)
    expect(schema({ maxRows: 10 })).toBe(false) // mode is required, missing
    expect(schema(undefined)).toBe(false) // mode is required
  })

  it('every REGISTERED test face rejects a plain {arbitraryUnknownKey:1} params object — the closed catalog is not vacuous', () => {
    // This is the exact regression the finding names: when every registration
    // used `anyClosedParams`, an arbitrary unknown key trivially passed for
    // EVERY face (any closed/serializable value was accepted), so LAY-004
    // was never actually exercised. TEST_FACE_REGISTRATIONS (fixtures.ts) now
    // gives every face a REAL closed schema (`noParamsAllowed` or
    // `createExactParamsSchema`) — prove the rejection for every one of them.
    for (const entry of TEST_FACE_REGISTRATIONS) {
      const descriptor = {
        schemaVersion: 1 as const,
        faceId: entry.faceId,
        resource: { kind: 'iri' as const, iri: 'urn:closed-catalog-probe' },
        params: { arbitraryUnknownKey: 1 },
      }
      expect(
        isWellShapedViewDescriptor(descriptor) && testFaceRegistrationPredicate(descriptor),
        `face '${entry.faceId}' accepted an arbitrary unknown params key — LAY-004 is vacuous for it`,
      ).toBe(false)
    }
  })

  it("the production default's sole registration (sophia.home) also rejects {arbitraryUnknownKey:1}", () => {
    const descriptor = {
      schemaVersion: 1 as const,
      faceId: SOPHIA_HOME_FACE_ID,
      resource: { kind: 'iri' as const, iri: 'urn:sophia:home' },
      params: { arbitraryUnknownKey: 1 },
    }
    expect(defaultFaceRegistrationPredicate(descriptor)).toBe(false)
  })
})

describe('isWellShapedViewDescriptor — params closedness: arrays and accessors (design §9.2 Phase 1 r2)', () => {
  const baseDescriptor = (params: unknown) => ({
    schemaVersion: 1 as const,
    faceId: 'x',
    resource: { kind: 'iri' as const, iri: 'urn:x' },
    params,
  })

  it('rejects an array carrying a non-index own property (e.g. arr.onClick = fn) — the r1 array check only walked indexed values', () => {
    const arr: unknown[] = [1, 2, 3]
    ;(arr as unknown as { onClick: () => void }).onClick = () => undefined
    expect(isWellShapedViewDescriptor(baseDescriptor({ items: arr }))).toBe(false)
  })

  it('rejects an array carrying a non-index own property whose value is itself benign data, not just a function', () => {
    const arr: unknown[] = [1, 2, 3]
    ;(arr as unknown as { extra: string }).extra = 'sneaky-but-not-even-executable'
    expect(isWellShapedViewDescriptor(baseDescriptor({ items: arr }))).toBe(false)
  })

  it('rejects a sparse array (a hole) rather than silently skipping the missing index', () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [1, , 3]
    expect(isWellShapedViewDescriptor(baseDescriptor({ items: sparse }))).toBe(false)
  })

  it('rejects an array with an accessor-defined index', () => {
    const arr: unknown[] = [1, 2, 3]
    Object.defineProperty(arr, 0, { get: () => 1, enumerable: true, configurable: true })
    expect(isWellShapedViewDescriptor(baseDescriptor({ items: arr }))).toBe(false)
  })

  it('rejects a plain object with an accessor (getter) property, not just a function-VALUED property', () => {
    const withGetter: Record<string, unknown> = {}
    Object.defineProperty(withGetter, 'liveValue', { get: () => 'looks fine', enumerable: true, configurable: true })
    expect(isWellShapedViewDescriptor(baseDescriptor(withGetter))).toBe(false)
  })

  it('rejects params carrying a symbol-keyed own property', () => {
    const withSymbol: Record<string, unknown> = { safe: 1 }
    ;(withSymbol as Record<symbol, unknown>)[Symbol('hidden')] = 'sneaky'
    expect(isWellShapedViewDescriptor(baseDescriptor(withSymbol))).toBe(false)
  })

  it('still accepts a genuine dense array with only index + length own properties', () => {
    expect(isWellShapedViewDescriptor(baseDescriptor({ items: [1, 2, 3], tags: ['a', 'b'] }))).toBe(true)
  })
})

describe('validateLayoutDocument — determinism (LAY-011)', () => {
  it('the same invalid document yields byte-identical diagnostics across repeated calls', () => {
    const nodes: Record<string, LayoutNode> = {
      a: { kind: 'split', id: 'a', axis: 'horizontal', startNodeId: 'b', endNodeId: 'leaf-x', startBasisPoints: 5000 },
      b: { kind: 'split', id: 'b', axis: 'vertical', startNodeId: 'a', endNodeId: 'leaf-y', startBasisPoints: 5000 },
      'leaf-x': { kind: 'leaf', id: 'leaf-x', descriptor: makeDescriptor(), descriptorRevision: 0 },
      'leaf-y': { kind: 'leaf', id: 'leaf-y', descriptor: makeDescriptor(), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'cyclic',
      scope: 'session',
      graphId: null,
      rootNodeId: 'a',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const first = JSON.stringify(validateLayoutDocument(doc))
    const second = JSON.stringify(validateLayoutDocument(doc))
    const third = JSON.stringify(validateLayoutDocument({ ...doc }))
    expect(first).toBe(second)
    expect(first).toBe(third)
  })
})

describe('validateLayoutDocument / diagnostics — content-free leakage (design §3.3 item 10, §9.2 Phase 1 r1)', () => {
  it('a document whose resource locators and params carry long content-shaped strings never leaks them into diagnostics', () => {
    const SECRET = 'sk-super-secret-token-do-not-leak-1234567890-XYZ-content-body-text'
    const doc = singleLeafDoc('leaf-root')
    const node = doc.nodes['leaf-root']
    // Malformed on purpose (extra key) so the validator actually emits a
    // diagnostic that could, if leaky, quote this content back.
    const nodes = {
      ...doc.nodes,
      'leaf-root': {
        ...node,
        descriptor: {
          schemaVersion: 1,
          faceId: 'x',
          resource: { kind: 'iri', iri: SECRET, notAllowed: SECRET },
          params: { blob: SECRET.repeat(10) },
        },
      },
    }
    const result = validateLayoutDocument({ ...doc, nodes } as LayoutDocument)
    expect(result.ok).toBe(false)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(SECRET)
  })

  it('an orphan/cycle/multi-parent document with resource-content-shaped node ids never leaks the id — nodeId is TOKENIZED, not just bounded (r3)', () => {
    const longId = `leaf-${'x'.repeat(500)}`
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: longId, endNodeId: 'b', startBasisPoints: 5000 },
      [longId]: { kind: 'leaf', id: longId, descriptor: makeDescriptor(), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'x',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const result = validateLayoutDocument(doc)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // r3: message is a fixed per-code template (never quotes an id at all)
    // and nodeId is a short, fixed-width TOKEN — every string field is both
    // bounded AND, for anything id-shaped, non-reversible to the original.
    for (const d of result.diagnostics) {
      expect(d.message.length).toBeLessThanOrEqual(205)
      expect((d.nodeId ?? '').length).toBeLessThanOrEqual(201)
      if (d.nodeId !== undefined) expect(d.nodeId).not.toContain(longId)
    }
    expect(JSON.stringify(result)).not.toContain(longId)
  })

  it('a forged schemaVersion/scope/graphId carrying secret-shaped content never round-trips through the message text (design §9.2 Phase 1 r2)', () => {
    // r1's LAY000_INVALID_SCHEMA_VERSION/LAY000_INVALID_SCOPE messages
    // interpolated `JSON.stringify(raw.schemaVersion)` / `JSON.stringify(
    // raw.scope)` directly — boundString's 200-char truncation still let a
    // real secret round-trip. r2's fixed-template messages never embed the
    // raw value at all; only `details.actualType` (a `typeof` string) does.
    const SECRET = 'sk-super-secret-schema-version-do-not-leak-1234567890'
    const doc = singleLeafDoc('leaf-root')
    const forged = { ...doc, schemaVersion: SECRET, scope: SECRET, graphId: SECRET } as unknown as LayoutDocument
    const result = validateLayoutDocument(forged)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(SECRET)
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toEqual(
      expect.arrayContaining(['LAY000_INVALID_SCHEMA_VERSION', 'LAY000_INVALID_SCOPE']),
    )
  })

  it('an unbounded caller-chosen nodeId (a long leaf id) is tokenized — bounded to a fixed short width regardless of input length (r3)', () => {
    const SECRET = 'sk-'.padEnd(500, 'x')
    // Force a descriptor-shape violation on a long-id leaf so a diagnostic
    // carrying that nodeId is actually produced.
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'long-id-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: SECRET,
      nodes: {
        [SECRET]: {
          kind: 'leaf',
          id: SECRET,
          descriptor: { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'x' } },
          descriptorRevision: 0,
        },
      },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const result = validateLayoutDocument(doc)
    expect(result.ok).toBe(false)
    if (result.ok) return
    for (const d of result.diagnostics) {
      expect((d.nodeId ?? '').length).toBeLessThanOrEqual(201)
    }
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('a SHORT secret supplied as a node id is tokenized too — bounding alone (truncation) would not have caught this, since it never exceeds the length bound (Builder P1 hardening finding 3)', () => {
    const SECRET = 'sk-short'
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'short-secret-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: SECRET,
      nodes: {
        [SECRET]: {
          kind: 'leaf',
          id: SECRET,
          // Malformed on purpose (empty faceId) so a diagnostic carrying this nodeId is actually produced.
          descriptor: { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'x' } },
          descriptorRevision: 0,
        },
      },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const result = validateLayoutDocument(doc)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(JSON.stringify(result)).not.toContain(SECRET)
    for (const d of result.diagnostics) {
      expect(d.nodeId).not.toBe(SECRET)
    }
  })

  it('a secret-shaped UNKNOWN TOP-LEVEL FIELD NAME never survives verbatim in details.field — tokenized, not merely bounded (Builder P1 hardening finding 2)', () => {
    // Short on purpose (mirrors the SHORT-secret node-id test above): r1/r2's
    // 200-char `boundString` truncation only helps once a payload EXCEEDS the
    // bound — this proves the fix is structural (tokenization), not
    // truncation, by using a secret far under that bound. Unlike every OTHER
    // `field`-keyed diagnostic detail in this module (whose value is always a
    // small, code-controlled label such as `'leafId'`/`'axis'`), LAY000's
    // unknown-top-level-field name is copied VERBATIM from whatever key the
    // untrusted document actually used — an agent-authored document could
    // name an unknown property `sk-...` to smuggle a secret straight through
    // a rejection diagnostic.
    const SECRET = 'sk-short-secret'
    const doc = singleLeafDoc('leaf-root')
    const withSecretField = { ...doc, [SECRET]: 'anything' } as unknown as LayoutDocument
    const result = validateLayoutDocument(withSecretField)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const unknownFieldDiagnostic = result.diagnostics.find((d) => d.code === 'LAY000_UNKNOWN_TOP_LEVEL_FIELD')
    expect(unknownFieldDiagnostic).toBeDefined()
    expect(unknownFieldDiagnostic?.details?.field).not.toBe(SECRET)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('a LONG secret-shaped unknown top-level field name is also never leaked, even truncated (Builder P1 hardening finding 2)', () => {
    const SECRET = 'sk-'.padEnd(500, 'x')
    const doc = singleLeafDoc('leaf-root')
    const withSecretField = { ...doc, [SECRET]: 'anything' } as unknown as LayoutDocument
    const result = validateLayoutDocument(withSecretField)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const unknownFieldDiagnostic = result.diagnostics.find((d) => d.code === 'LAY000_UNKNOWN_TOP_LEVEL_FIELD')
    expect(unknownFieldDiagnostic).toBeDefined()
    // A tokenized value is short and fixed-width regardless of input length —
    // the same guarantee r3 already gives node ids (see the long-id test
    // above), now extended to this field name too.
    expect((unknownFieldDiagnostic?.details?.field as string | undefined)?.length).toBeLessThanOrEqual(20)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain('sk-xxx')
  })
})

describe('diagnostics — sortDiagnostics canonical detail tie-break (Builder P1 hardening finding 6)', () => {
  it('two diagnostics sharing code + nodeId (and therefore, since r3, the SAME fixed message) but differing only in details still sort deterministically, regardless of producer/insertion order', () => {
    const a = makeDiagnosticForTest('LAYOP_INVALID_ENUM', undefined, {
      field: 'axis',
      legalValues: 'horizontal|vertical',
    })
    const b = makeDiagnosticForTest('LAYOP_INVALID_ENUM', undefined, {
      field: 'side',
      legalValues: 'start|end',
    })
    expect(a.code).toBe(b.code)
    expect(a.nodeId).toBe(b.nodeId)
    expect(a.message).toBe(b.message)
    expect(a.details).not.toEqual(b.details)

    const forward = sortDiagnosticsForTest([a, b])
    const reversed = sortDiagnosticsForTest([b, a])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
  })

  it('a whole-document validation run reproduces the SAME diagnostics order regardless of nodes-map insertion order, even when two diagnostics share code+nodeId and differ only in details', () => {
    // Two leaves under the SAME split, each with a distinct shape violation
    // that carries different `details` but happens to share `code`
    // ('LAY001_INVALID_RATIO_RANGE' on the split itself would only fire
    // once; instead use two leaves with LAY002_INVALID_DESCRIPTOR_REVISION,
    // whose nodeId differs per leaf, to prove the FULL run — not just one
    // synthetic pair — is order-independent).
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'leaf-p', endNodeId: 'leaf-q', startBasisPoints: 5000 },
      'leaf-p': { kind: 'leaf', id: 'leaf-p', descriptor: makeDescriptor(), descriptorRevision: -1 },
      'leaf-q': { kind: 'leaf', id: 'leaf-q', descriptor: makeDescriptor(), descriptorRevision: 1.5 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'tie-break-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const reversedNodes: Record<string, LayoutNode> = {}
    for (const key of Object.keys(nodes).reverse()) reversedNodes[key] = nodes[key]
    const reversedDoc: LayoutDocument = { ...doc, nodes: reversedNodes }

    const a = JSON.stringify(validateLayoutDocument(doc))
    const b = JSON.stringify(validateLayoutDocument(reversedDoc))
    expect(a).toBe(b)
  })

  it('two diagnostics whose `details` VALUES contain the sort-key\'s own delimiter shape produce DISTINCT sort keys — no canonical-encoding collision (Builder P1 hardening finding 4)', () => {
    // The exact adversarial pair from the review: naively concatenating
    // `key=value` pairs with a fixed separator is not injective — a value
    // that itself contains `<separator>anotherKey=anotherValue` can make two
    // STRUCTURALLY DIFFERENT `details` objects concatenate to the IDENTICAL
    // string. Both diagnostics below share code+nodeId (undefined), so the
    // FINAL tie-break is exactly `detailsSortKey` — if it collided, sorting
    // [a,b] vs [b,a] would (by luck of `Array.prototype.sort`'s stability)
    // still often look "sorted", but the two diagnostics would be
    // indistinguishable by the ordering, and a real collision could reorder
    // unrelated pairs sharing that same colliding key. We assert the
    // stronger, directly-testable property: the two `details` objects must
    // NOT produce output that lets forward/reversed input silently swap.
    const a = makeDiagnosticForTest('LAYOP_INVALID_ENUM', undefined, {
      field: 'a',
      legalValues: 'b legalValues=c',
    })
    const b = makeDiagnosticForTest('LAYOP_INVALID_ENUM', undefined, {
      field: 'a legalValues=b',
      legalValues: 'c',
    })
    expect(a.code).toBe(b.code)
    expect(a.nodeId).toBe(b.nodeId)
    expect(a.details).not.toEqual(b.details)

    // Injective encoding means these two distinct `details` objects sort
    // into a STABLE, well-defined relative order — reversing the input order
    // reverses (or preserves) it identically both ways, never silently
    // collapsing the pair into an unordered tie that could scramble
    // unrelated output between runs.
    const forward = sortDiagnosticsForTest([a, b])
    const reversed = sortDiagnosticsForTest([b, a])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
    // The two diagnostics remain individually distinguishable after sorting
    // — a genuine collision would make them serialize identically apart from
    // whichever object happened to sort first, which is exactly what an
    // injective encoding rules out.
    expect(JSON.stringify(forward[0].details)).not.toBe(JSON.stringify(forward[1].details))
  })

  it('a numeric detail value and its string look-alike never collide in the sort key (type-preserving canonical encoding, Builder P1 hardening finding 4)', () => {
    // `String(5) === '5'` — a naive `${key}=${String(value)}` encoding cannot
    // distinguish the NUMBER 5 from the STRING '5'. Builder P1 hardening
    // (recheck): the PREVIOUS version of this test built two IDENTICAL
    // numeric `{expected: 5, actual: 0}` objects, so it never actually
    // exercised a differing-primitive-type pair — it could not have caught a
    // regression to `String(value)`-style coercion. This version builds one
    // diagnostic with a genuine NUMBER 5 and one with the STRING look-alike
    // '5' for the SAME key. `Diagnostic['details']`'s value type
    // (`string | number | boolean`) is not tied to any particular key, so
    // this is a legal (if synthetic) pair for probing the encoding itself.
    const numeric = makeDiagnosticForTest('LAYOP_STALE_DESCRIPTOR_REVISION', undefined, {
      expected: 5,
      actual: 0,
    })
    const stringLookAlike = makeDiagnosticForTest('LAYOP_STALE_DESCRIPTOR_REVISION', undefined, {
      expected: '5',
      actual: 0,
    })
    expect(numeric.details?.expected).toBe(5)
    expect(stringLookAlike.details?.expected).toBe('5')
    // The two details objects must be genuinely distinguishable — this is
    // the property a `String(value)` coercion bug would destroy.
    expect(JSON.stringify(numeric.details)).not.toBe(JSON.stringify(stringLookAlike.details))

    // Sorting is stable and order-independent regardless of which one comes
    // first (LAY-011) — reversing the input never flips the relative order.
    const forward = sortDiagnosticsForTest([numeric, stringLookAlike])
    const reversed = sortDiagnosticsForTest([stringLookAlike, numeric])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))
    // And the two remain individually distinguishable after sorting — a
    // `String(value)`-coercion regression would collapse them onto the same
    // sort key and make this comparison spuriously pass either way.
    expect(JSON.stringify(forward[0].details)).not.toBe(JSON.stringify(forward[1].details))

    // Identical inputs still MUST produce identical sort keys (determinism).
    const alsoNumeric = makeDiagnosticForTest('LAYOP_STALE_DESCRIPTOR_REVISION', undefined, {
      expected: 5,
      actual: 0,
    })
    const identicalForward = sortDiagnosticsForTest([numeric, alsoNumeric])
    const identicalReversed = sortDiagnosticsForTest([alsoNumeric, numeric])
    expect(JSON.stringify(identicalForward)).toBe(JSON.stringify(identicalReversed))
  })
})

describe('createValidatedLayoutDocument — validated immutable-document constructor (design §9.2 Phase 1 r1)', () => {
  it('rejects an invalid candidate without constructing anything', () => {
    const doc = singleLeafDoc('leaf-root')
    const broken = { ...doc, rootNodeId: 'ghost' }
    const result = createValidatedLayoutDocument(broken, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(false)
  })

  it('returns a document that is deep-frozen: mutating any level throws', () => {
    const doc = twoLeafDoc().doc
    const result = createValidatedLayoutDocument(doc, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.isFrozen(result.doc)).toBe(true)
    expect(Object.isFrozen(result.doc.nodes)).toBe(true)
    const someLeaf = Object.values(result.doc.nodes).find((n) => n.kind === 'leaf')!
    expect(Object.isFrozen(someLeaf)).toBe(true)
    expect(Object.isFrozen(someLeaf.kind === 'leaf' ? someLeaf.descriptor : {})).toBe(true)
    expect(() => {
      ;(result.doc as { layoutId: string }).layoutId = 'mutated'
    }).toThrow()
    expect(() => {
      ;(result.doc.nodes as Record<string, unknown>)['new-key'] = {}
    }).toThrow()
  })

  it("mutating the CALLER's original descriptor after construction does NOT affect the returned document (deep clone, not a live reference)", () => {
    const mutableDescriptor = {
      schemaVersion: 1 as const,
      faceId: 'test.face',
      resource: { kind: 'iri' as const, iri: 'urn:test:x' },
      params: { count: 1 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'mutation-probe',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes: { root: { kind: 'leaf', id: 'root', descriptor: mutableDescriptor, descriptorRevision: 0 } },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const result = createValidatedLayoutDocument(doc, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Mutate the CALLER's original object graph after construction.
    ;(mutableDescriptor.params as { count: number }).count = 999
    ;(mutableDescriptor as { faceId: string }).faceId = 'corrupted.face'

    const storedLeaf = result.doc.nodes['root']
    if (storedLeaf.kind !== 'leaf') throw new Error('expected a leaf')
    expect(storedLeaf.descriptor.faceId).toBe('test.face')
    expect(storedLeaf.descriptor.params).toEqual({ count: 1 })
    // The stored document is still valid despite the caller's corruption of
    // their own (now-disconnected) original object.
    expect(validateLayoutDocument(result.doc)).toEqual({ ok: true })
  })
})

// ── grid/collection node (Wave 2 x Lane B, design
// plans/surface-wave2-laneb-slice-20260716.md §2) ───────────────────────────

describe('validateLayoutDocument — grid node, valid documents pass', () => {
  it('a single root grid (fixed source) is valid', () => {
    expect(validateLayoutDocument(singleGridDoc())).toEqual({ ok: true })
  })

  it('a root grid with zero cells is valid (an empty fixed grid is legal data)', () => {
    expect(validateLayoutDocument(singleGridDoc('grid-root', []))).toEqual({ ok: true })
  })

  it('a grid as a non-root split child, beside a leaf, is valid', () => {
    expect(validateLayoutDocument(leafAndGridDoc().doc)).toEqual({ ok: true })
  })

  it('a root grid bound to a collection source is valid', () => {
    const nodes: Record<string, LayoutNode> = {
      'grid-root': {
        kind: 'grid',
        id: 'grid-root',
        flow: 'stack',
        minCellWidth: 240,
        children: makeCollectionChildren(),
        gridRevision: 0,
      },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'test-layout',
      scope: 'session',
      graphId: null,
      rootNodeId: 'grid-root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    expect(validateLayoutDocument(doc)).toEqual({ ok: true })
  })

  it('a grid cell may carry a legal span (1|2|3)', () => {
    const doc = singleGridDoc('grid-root', [
      makeGridCell('cell-a', 'test.face', undefined, 1),
      makeGridCell('cell-b', 'test.face', undefined, 2),
      makeGridCell('cell-c', 'test.face', undefined, 3),
    ])
    expect(validateLayoutDocument(doc)).toEqual({ ok: true })
  })
})

describe('validateLayoutDocument — LAY-010 broadened: a grid counts as a terminal (Wave 2 x Lane B)', () => {
  it('a document consisting solely of a root grid is valid (zero leaf-kind nodes)', () => {
    // Without the LAY-010 broadening this documents.ts's own header explains,
    // this would spuriously fail LAY010_NO_LEAVES even though the grid is
    // fully renderable content (design §2.1: "grids legal wherever a leaf
    // is").
    expect(validateLayoutDocument(singleGridDoc())).toEqual({ ok: true })
  })

  it('a mixed leaf+grid document is valid', () => {
    expect(validateLayoutDocument(leafAndGridDoc().doc)).toEqual({ ok: true })
  })
})

function gridDocWith(overrides: Partial<LayoutGridNode>): LayoutDocument {
  const base = singleGridDoc().nodes['grid-root'] as LayoutGridNode
  const node = { ...base, ...overrides } as LayoutNode
  return {
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId: 'grid-root',
    nodes: { 'grid-root': node },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

describe('validateLayoutDocument — grid node field-level rejections', () => {
  it('rejects an unknown field on a grid node', () => {
    const doc = gridDocWith({})
    const withExtraField = {
      ...doc,
      nodes: { 'grid-root': { ...doc.nodes['grid-root'], extra: 'nope' } },
    }
    expect(codesOf(validateLayoutDocument(withExtraField as unknown as LayoutDocument))).toContain('LAY001_INVALID_NODE_SHAPE')
  })

  it.each([
    ['freeform (reserved, unbuilt)', 'freeform'],
    ['radial (reserved, unbuilt)', 'radial'],
    ['garbage string', 'diagonal'],
    ['wrong type', 42],
    ['missing', undefined],
  ])('rejects an invalid flow: %s', (_label, flow) => {
    const doc = gridDocWith({ flow: flow as never })
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_FLOW')
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 12.5],
    ['NaN', Number.NaN],
    ['wrong type', '200'],
    ['missing', undefined],
  ])('rejects an invalid minCellWidth: %s', (_label, minCellWidth) => {
    const doc = gridDocWith({ minCellWidth: minCellWidth as never })
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_MIN_CELL_WIDTH')
  })

  it.each([
    ['negative', -1],
    ['non-integer', 1.5],
    ['wrong type', '0'],
    ['missing', undefined],
  ])('rejects an invalid gridRevision: %s', (_label, gridRevision) => {
    const doc = gridDocWith({ gridRevision: gridRevision as never })
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY002_INVALID_GRID_REVISION')
  })

  it('accepts gridRevision 0 and a large positive integer', () => {
    expect(validateLayoutDocument(gridDocWith({ gridRevision: 0 }))).toEqual({ ok: true })
    expect(validateLayoutDocument(gridDocWith({ gridRevision: 4242 }))).toEqual({ ok: true })
  })
})

describe('validateLayoutDocument — grid children source shape (LAY-001)', () => {
  it.each([
    ['unknown kind', { kind: 'exotic', cells: [] }],
    ['missing kind', { cells: [] }],
    ['fixed with unknown key', { kind: 'fixed', cells: [], bogus: 1 }],
    ['fixed cells not an array', { kind: 'fixed', cells: 'nope' }],
    ['fixed cells with a hole', { kind: 'fixed', cells: [makeGridCell('a'), , makeGridCell('b')] }],
  ])('rejects malformed children: %s', (_label, children) => {
    const doc = gridDocWith({ children: children as unknown as GridChildrenSource })
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects duplicate cell ids within one fixed grid', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('dup'), makeGridCell('dup')])
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects a cell with an invalid span', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', 'test.face', undefined, 4 as never)])
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('rejects a cell whose descriptor is not well-shaped', () => {
    const badCell = { id: 'a', descriptor: { schemaVersion: 1, faceId: '', resource: { kind: 'iri', iri: 'x' } } }
    const doc = singleGridDoc('grid-root', [badCell as never])
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
  })

  it('two DIFFERENT grids may reuse the same cell id (grid-local namespace, not document-wide)', () => {
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'grid-1', endNodeId: 'grid-2', startBasisPoints: 5000 },
      'grid-1': { kind: 'grid', id: 'grid-1', flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([makeGridCell('shared')]), gridRevision: 0 },
      'grid-2': { kind: 'grid', id: 'grid-2', flow: 'reflow', minCellWidth: 100, children: makeFixedChildren([makeGridCell('shared')]), gridRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'test-layout',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    expect(validateLayoutDocument(doc)).toEqual({ ok: true })
  })

  describe('collection source', () => {
    it('rejects a collection locator whose kind is not "query"', () => {
      const doc = gridDocWith({
        children: makeCollectionChildren({ collection: { kind: 'iri', iri: 'urn:test:not-a-query' } }),
      })
      expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
    })

    it('rejects an empty itemFaceId', () => {
      const doc = gridDocWith({ children: makeCollectionChildren({ itemFaceId: '' }) })
      expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
    })

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['non-integer', 2.5],
      ['missing', undefined],
    ])('rejects an invalid maxItems: %s', (_label, maxItems) => {
      const doc = gridDocWith({ children: makeCollectionChildren({ maxItems: maxItems as never }) })
      expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
    })

    it('rejects a negative refreshSeconds', () => {
      const doc = gridDocWith({ children: makeCollectionChildren({ refreshSeconds: -1 }) })
      expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
    })

    it('accepts refreshSeconds 0 (load-once) and an absent refreshSeconds (also load-once)', () => {
      expect(validateLayoutDocument(gridDocWith({ children: makeCollectionChildren({ refreshSeconds: 0 }) }))).toEqual({ ok: true })
      expect(validateLayoutDocument(gridDocWith({ children: makeCollectionChildren() }))).toEqual({ ok: true })
    })

    it('rejects a non-string itemParams value', () => {
      const doc = gridDocWith({
        children: makeCollectionChildren({ itemParams: { title: 42 as unknown as string } }),
      })
      expect(codesOf(validateLayoutDocument(doc))).toContain('LAY001_INVALID_GRID_CHILDREN_SHAPE')
    })

    it('accepts a well-formed itemParams var-substitution map', () => {
      const doc = gridDocWith({ children: makeCollectionChildren({ itemParams: { title: '?label' } }) })
      expect(validateLayoutDocument(doc)).toEqual({ ok: true })
    })
  })
})

describe('validateLayoutDocument — grid face registration + cell-persistence rule (LAY-003, design §2.1)', () => {
  it('rejects a fixed cell whose face is not registered at all', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', 'nonexistent.face')])
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY003_UNREGISTERED_FACE')
  })

  it('rejects a fixed cell whose face is registered but grid-INELIGIBLE (persistent-non-relocatable)', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', GRID_INELIGIBLE_FACE_ID)])
    const result = validateLayoutDocument(doc)
    expect(codesOf(result)).toContain('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
    expect(codesOf(result)).not.toContain('LAY003_UNREGISTERED_FACE')
  })

  it('the grid-ineligible faceId is TOKENIZED in the diagnostic, never surfaced verbatim (mirrors LAY003_UNREGISTERED_FACE)', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', GRID_INELIGIBLE_FACE_ID)])
    const result = validateLayoutDocument(doc)
    if (result.ok) throw new Error('expected rejection')
    const found = result.diagnostics.find((d) => d.code === 'LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
    expect(found?.details?.faceId).not.toBe(GRID_INELIGIBLE_FACE_ID)
    expect(typeof found?.details?.faceId).toBe('string')
  })

  it('rejects a collection source whose itemFaceId is grid-ineligible', () => {
    const doc = gridDocWith({ children: makeCollectionChildren({ itemFaceId: GRID_INELIGIBLE_FACE_ID }) })
    expect(codesOf(validateLayoutDocument(doc))).toContain('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')
  })

  it('the DEFAULT grid-eligibility predicate (no real P2 registry yet) is permissive — Phase 1 excludes nothing by default', () => {
    expect(defaultFaceGridEligibilityPredicate('literally.anything')).toBe(true)
  })

  it('accepts a well-registered, grid-eligible face in a fixed cell', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', 'test.face')])
    expect(validateLayoutDocument(doc)).toEqual({ ok: true })
  })
})

describe('isWellShapedGridChildrenSource — exported shape floor (mirrors isWellShapedViewDescriptor)', () => {
  it('accepts a well-shaped fixed source', () => {
    expect(isWellShapedGridChildrenSource(makeFixedChildren([makeGridCell('a')]))).toBe(true)
  })

  it('accepts a well-shaped collection source', () => {
    expect(isWellShapedGridChildrenSource(makeCollectionChildren())).toBe(true)
  })

  it('rejects non-plain-object input without throwing', () => {
    expect(isWellShapedGridChildrenSource(null)).toBe(false)
    expect(isWellShapedGridChildrenSource(undefined)).toBe(false)
    expect(isWellShapedGridChildrenSource('nope')).toBe(false)
    expect(isWellShapedGridChildrenSource(42)).toBe(false)
    expect(isWellShapedGridChildrenSource([])).toBe(false)
  })

  it('rejects a collection locator of kind "document" (v1 requires "query")', () => {
    expect(
      isWellShapedGridChildrenSource(
        makeCollectionChildren({ collection: { kind: 'document', graphId: 'g', documentId: 'd' } }),
      ),
    ).toBe(false)
  })

  it('a query locator built by makeQueryLocator is itself well-shaped', () => {
    const source = makeCollectionChildren({ collection: makeQueryLocator('SELECT ?item WHERE {}', 'g') })
    expect(isWellShapedGridChildrenSource(source)).toBe(true)
  })
})
