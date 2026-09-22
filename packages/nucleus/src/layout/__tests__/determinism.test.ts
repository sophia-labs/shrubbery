/**
 * determinism.test.ts — acceptance gate (b), design §9.2 Phase 1 / LAY-011:
 *
 *   "Same input document yields byte-stable plan and diagnostics."
 *
 * Stronger than "calling a pure function twice gives the same result" (true
 * of almost any function): these tests rebuild the SAME logical document
 * with its `nodes` map keys inserted in a DIFFERENT order and assert the
 * `LayoutPlan` / diagnostics are still byte-identical — this is what would
 * actually break if `solveLayout` or `validateLayoutDocument` ever leaked
 * `Object.keys`/Map iteration order into their output instead of following
 * the document's own start/end tree structure.
 *
 * `applyOperation`/`validateLayoutDocument`/`solveLayout` calls in THIS file
 * go through a local shim that injects `TEST_VALIDATE_OPTIONS` (fixtures.ts)
 * by default — see fixtures.ts's header.
 */
import { describe, expect, it } from 'vitest'
import type { LayoutDocument, LayoutNode } from '../types.js'
import type { LayoutOperation, OperationResult } from '../operations.js'
import { applyOperation as applyOperationRaw } from '../operations.js'
import type { ValidateOptions, ValidationResult } from '../validate.js'
import { validateLayoutDocument as validateLayoutDocumentRaw } from '../validate.js'
import type { LeafConstraintsMap, SolveOptions, SolveResult } from '../solver.js'
import { solveLayout as solveLayoutRaw } from '../solver.js'
import { TEST_VALIDATE_OPTIONS, expectedParentFor, makeDescriptor, singleLeafDoc } from './fixtures.js'

function applyOperation(doc: LayoutDocument, op: LayoutOperation, options?: ValidateOptions): OperationResult {
  return applyOperationRaw(doc, op, options ?? TEST_VALIDATE_OPTIONS)
}

function validateLayoutDocument(doc: LayoutDocument, options?: ValidateOptions): ValidationResult {
  return validateLayoutDocumentRaw(doc, options ?? TEST_VALIDATE_OPTIONS)
}

function solveLayout(
  doc: LayoutDocument,
  leafConstraints: LeafConstraintsMap,
  containerWidth: number,
  containerHeight: number,
  options?: SolveOptions,
): SolveResult {
  return solveLayoutRaw(doc, leafConstraints, containerWidth, containerHeight, {
    ...TEST_VALIDATE_OPTIONS,
    ...options,
  })
}

function reorderNodeKeys(doc: LayoutDocument): LayoutDocument {
  const keys = Object.keys(doc.nodes)
  const nodes: Record<string, LayoutNode> = {}
  for (const key of [...keys].reverse()) nodes[key] = doc.nodes[key]
  return { ...doc, nodes }
}

function mustOk(result: ReturnType<typeof applyOperation>): LayoutDocument {
  if (!result.ok) throw new Error(`fixture build failed: ${JSON.stringify(result.diagnostic)}`)
  return result.doc
}

/** A 4-leaf tree built through real operations: root(leaf-2 | (leaf-4 | leaf-2's-old-place)) etc. */
function buildSampleTree(): LayoutDocument {
  let doc = singleLeafDoc('root')
  doc = mustOk(
    applyOperation(doc, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'horizontal',
      side: 'start',
      newLeafId: 'leaf-2',
      splitId: 'split-1',
      descriptor: makeDescriptor('test.face', 'urn:test:2'),
      expectedParent: expectedParentFor(doc, 'root'),
    }),
  )
  doc = mustOk(
    applyOperation(doc, {
      op: 'split_leaf',
      leafId: 'root',
      axis: 'vertical',
      side: 'end',
      newLeafId: 'leaf-3',
      splitId: 'split-2',
      descriptor: makeDescriptor('test.face', 'urn:test:3'),
      startBasisPoints: 6500,
      expectedParent: expectedParentFor(doc, 'root'),
    }),
  )
  doc = mustOk(
    applyOperation(doc, {
      op: 'split_leaf',
      leafId: 'leaf-2',
      axis: 'vertical',
      side: 'start',
      newLeafId: 'leaf-4',
      splitId: 'split-3',
      descriptor: makeDescriptor('test.face', 'urn:test:4'),
      startBasisPoints: 3000,
      expectedParent: expectedParentFor(doc, 'leaf-2'),
    }),
  )
  return doc
}

const SAMPLE_CONSTRAINTS: LeafConstraintsMap = {
  root: { minWidth: 50, minHeight: 50 },
  'leaf-2': { minWidth: 80, minHeight: 40 },
  'leaf-3': { minWidth: 60, minHeight: 60 },
  'leaf-4': { minWidth: 40, minHeight: 40 },
}

describe('determinism (LAY-011) — solveLayout', () => {
  it('is byte-stable across repeated calls on the same document', () => {
    const doc = buildSampleTree()
    const first = JSON.stringify(solveLayout(doc, SAMPLE_CONSTRAINTS, 1000, 800))
    const second = JSON.stringify(solveLayout(doc, SAMPLE_CONSTRAINTS, 1000, 800))
    expect(first).toBe(second)
  })

  it('is byte-stable regardless of nodes-map key insertion order', () => {
    const doc = buildSampleTree()
    const reordered = reorderNodeKeys(doc)
    expect(Object.keys(doc.nodes)).not.toEqual(Object.keys(reordered.nodes)) // sanity: order really differs
    const a = JSON.stringify(solveLayout(doc, SAMPLE_CONSTRAINTS, 1000, 800))
    const b = JSON.stringify(solveLayout(reordered, SAMPLE_CONSTRAINTS, 1000, 800))
    expect(a).toBe(b)
  })

  it('infeasible-container constrained diagnostics are byte-stable regardless of key order', () => {
    const doc = buildSampleTree()
    const reordered = reorderNodeKeys(doc)
    const tightConstraints: LeafConstraintsMap = {
      root: { minWidth: 500, minHeight: 500 },
      'leaf-2': { minWidth: 500, minHeight: 500 },
      'leaf-3': { minWidth: 500, minHeight: 500 },
      'leaf-4': { minWidth: 500, minHeight: 500 },
    }
    const a = solveLayout(doc, tightConstraints, 200, 200)
    const b = solveLayout(reordered, tightConstraints, 200, 200)
    expect(a.ok).toBe(true)
    if (a.ok) expect(a.diagnostics.length).toBeGreaterThan(0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('determinism (LAY-011) — validateLayoutDocument diagnostics', () => {
  it('multiple violations are reported in a byte-stable order regardless of key insertion order', () => {
    const doc = buildSampleTree()
    const nodes = { ...doc.nodes }
    const split1 = nodes['split-1']
    if (split1.kind !== 'split') throw new Error('fixture invariant')
    nodes['split-1'] = { ...split1, endNodeId: 'ghost-node' } // violation 1: dangling child
    const leaf4 = nodes['leaf-4']
    if (leaf4.kind !== 'leaf') throw new Error('fixture invariant')
    nodes['leaf-4'] = { ...leaf4, descriptor: { ...leaf4.descriptor, faceId: '' } } // violation 2: bad descriptor
    const broken: LayoutDocument = { ...doc, nodes }
    const reordered = reorderNodeKeys(broken)

    const a = validateLayoutDocument(broken)
    const b = validateLayoutDocument(reordered)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.diagnostics.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('the same invalid document yields byte-identical diagnostics across repeated calls', () => {
    const nodes: Record<string, LayoutNode> = {
      a: {
        kind: 'split',
        id: 'a',
        axis: 'horizontal',
        startNodeId: 'b',
        endNodeId: 'leaf-x',
        startBasisPoints: 5000,
      },
      b: {
        kind: 'split',
        id: 'b',
        axis: 'vertical',
        startNodeId: 'a',
        endNodeId: 'leaf-y',
        startBasisPoints: 5000,
      },
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
    expect(first).toBe(second)
  })
})
