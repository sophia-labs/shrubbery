/**
 * observatory-surface-document.test.ts — real, no-mock coverage for the
 * tabs-composed "Observatory as ONE surface" document (P7). Mirrors
 * `observatory-dashboard-document.test.ts`'s own pattern (validate against
 * the real sealed fragment face registry, `findRawQueryLocators` for the
 * "born clean" invariant), plus the tests unique to a `tabs` root: the three
 * page subtrees partition the non-root nodes, and every polled descriptor
 * carries a positive `refreshSeconds`.
 */
import { describe, expect, it } from 'vitest'
import { createFragmentFaceRegistry, findRawQueryLocators } from '@shrubbery/runtime/layout'
import {
  childNodeIds,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutGridNode,
  type LayoutLeafNode,
  type LayoutTabsNode,
} from '@shrubbery/nucleus/layout'
import {
  OBSERVATORY_SURFACE_LAYOUT_ID,
  buildObservatorySurfaceDocument,
} from './observatory-surface-document.js'
import { OBS_SURFACE_QUERY, createObservatorySurfaceNamedQueryRegistry } from './observatory-surface-query-catalog.js'

/** Every non-root node id reachable from `startId`, walking `childNodeIds` (splits/grids/leaves — grids and leaves are terminal). */
function subtreeNodeIds(doc: LayoutDocument, startId: string): Set<string> {
  const seen = new Set<string>()
  const stack = [startId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = doc.nodes[id]
    if (!node) continue
    for (const childId of childNodeIds(node)) stack.push(childId)
  }
  return seen
}

describe('buildObservatorySurfaceDocument — the tabs-composed Observatory surface (P7)', () => {
  it('validates against a real sealed registry with ok:true and zero diagnostics', () => {
    const doc = buildObservatorySurfaceDocument('observatory-surface-test')
    const registry = createFragmentFaceRegistry()
    const result = validateLayoutDocument(doc, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
      isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      // Never reached given the assertion above — surfaces the real
      // diagnostics in the failure message if this test ever regresses.
      expect(result.diagnostics).toEqual([])
    }
  })

  it('carries no raw query text (ruling 4 — born clean) for either supported graph id', () => {
    expect(findRawQueryLocators(buildObservatorySurfaceDocument('observatory'))).toEqual([])
    expect(findRawQueryLocators(buildObservatorySurfaceDocument('other-cell'))).toEqual([])
  })

  it('every queryId names a catalogue entry, contains no whitespace, and never contains SELECT', () => {
    const registry = createObservatorySurfaceNamedQueryRegistry()
    const doc = buildObservatorySurfaceDocument()
    let sawQuery = false
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'leaf' && node.descriptor.resource.kind === 'query') {
        sawQuery = true
        const queryId = node.descriptor.resource.queryId
        expect(queryId).not.toMatch(/\s/)
        expect(queryId).not.toContain('SELECT')
        expect(registry.has(queryId)).toBe(true)
      }
      if (node.kind === 'grid') {
        if (node.children.kind === 'fixed') {
          for (const cell of node.children.cells) {
            if (cell.descriptor.resource.kind !== 'query') continue
            sawQuery = true
            const queryId = cell.descriptor.resource.queryId
            expect(queryId).not.toMatch(/\s/)
            expect(queryId).not.toContain('SELECT')
            expect(registry.has(queryId)).toBe(true)
          }
        } else if (node.children.collection.kind === 'query') {
          sawQuery = true
          const queryId = node.children.collection.queryId
          expect(queryId).not.toMatch(/\s/)
          expect(queryId).not.toContain('SELECT')
          expect(registry.has(queryId)).toBe(true)
        }
      }
    }
    expect(sawQuery).toBe(true)
    // Every one of the 19 catalogue names is actually used somewhere.
    const usedNames = new Set<string>()
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'leaf' && node.descriptor.resource.kind === 'query') usedNames.add(node.descriptor.resource.queryId)
      if (node.kind === 'grid') {
        if (node.children.kind === 'fixed') {
          for (const cell of node.children.cells) {
            if (cell.descriptor.resource.kind === 'query') usedNames.add(cell.descriptor.resource.queryId)
          }
        } else if (node.children.collection.kind === 'query') {
          usedNames.add(node.children.collection.queryId)
        }
      }
    }
    expect(usedNames).toEqual(new Set(Object.values(OBS_SURFACE_QUERY)))
  })

  it('the three tab subtrees PARTITION the non-root nodes — all reachable, none in two subtrees, none with two parents', () => {
    const doc = buildObservatorySurfaceDocument()
    const root = doc.nodes[doc.rootNodeId] as LayoutTabsNode
    expect(root.kind).toBe('tabs')
    expect(root.tabs.map((t) => t.nodeId)).toEqual(['ObsPulse', 'ObsFleet', 'ObsCapture'])

    const subtrees = root.tabs.map((tab) => subtreeNodeIds(doc, tab.nodeId))
    const allNonRootIds = new Set(Object.keys(doc.nodes).filter((id) => id !== doc.rootNodeId))

    // Every non-root node is reachable from exactly one tab's subtree.
    const union = new Set<string>()
    for (const subtree of subtrees) for (const id of subtree) union.add(id)
    expect(union).toEqual(allNonRootIds)

    for (let i = 0; i < subtrees.length; i += 1) {
      for (let j = i + 1; j < subtrees.length; j += 1) {
        const intersection = [...subtrees[i]].filter((id) => subtrees[j].has(id))
        expect(intersection, `subtree ${i} and ${j} must not overlap`).toEqual([])
      }
    }
  })

  it('every polled descriptor (stat.scalar, chart.vega-lite, the collection source) sets a positive refreshSeconds', () => {
    const doc = buildObservatorySurfaceDocument()
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'grid' && node.children.kind === 'fixed') {
        for (const cell of node.children.cells) {
          if (cell.descriptor.faceId === 'stat.scalar' || cell.descriptor.faceId === 'chart.vega-lite') {
            const refreshSeconds = cell.descriptor.params?.refreshSeconds
            expect(typeof refreshSeconds, `${cell.id}.params.refreshSeconds`).toBe('number')
            expect(refreshSeconds as number, `${cell.id}.params.refreshSeconds`).toBeGreaterThan(0)
          }
        }
      }
      if (node.kind === 'grid' && node.children.kind === 'collection') {
        expect(node.children.refreshSeconds, `${node.id}.children.refreshSeconds`).toBeGreaterThan(0)
        expect(node.children.itemParams).not.toHaveProperty('refreshSeconds')
      }
    }
    // The two sparql.bindings-table + the Fleet runs table carry NO refreshSeconds — that face has no such param.
    for (const leafId of ['ObsFleetRuns', 'ObsCaptureRuns', 'ObsCaptureFailures'] as const) {
      const leaf = doc.nodes[leafId] as LayoutLeafNode
      expect(leaf.descriptor.params).not.toHaveProperty('refreshSeconds')
    }
  })

  it('the builder is pure and its output deep-frozen', () => {
    const a = buildObservatorySurfaceDocument('observatory')
    const b = buildObservatorySurfaceDocument('observatory')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(a.nodes)).toBe(true)
    expect(Object.isFrozen(a.nodes.ObsPages)).toBe(true)
    const statsGrid = a.nodes.ObsPulseStats as LayoutGridNode
    expect(Object.isFrozen(statsGrid)).toBe(true)
    if (statsGrid.children.kind === 'fixed') expect(Object.isFrozen(statsGrid.children.cells)).toBe(true)
  })

  it('carries the declared layoutId and workspace scope', () => {
    const doc = buildObservatorySurfaceDocument()
    expect(doc.layoutId).toBe(OBSERVATORY_SURFACE_LAYOUT_ID)
    expect(doc.layoutId).toBe('observatory-surface-v1')
    expect(doc.scope).toBe('workspace')
  })
})
