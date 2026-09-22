import { describe, expect, it } from 'vitest'
import { singleTabsDoc, tabsInSplitDoc, TEST_VALIDATE_OPTIONS } from './fixtures.js'
import { validateLayoutDocument } from '../validate.js'

function hasCode(result: ReturnType<typeof validateLayoutDocument>, code: string): boolean {
  return !result.ok && result.diagnostics.some((diagnostic) => diagnostic.code === code)
}

describe('tabs validation', () => {
  it('accepts root tabs and tabs containing an arbitrary inactive subtree', () => {
    expect(validateLayoutDocument(singleTabsDoc(), TEST_VALIDATE_OPTIONS).ok).toBe(true)
    expect(validateLayoutDocument(tabsInSplitDoc(), TEST_VALIDATE_OPTIONS).ok).toBe(true)
  })

  it('keeps unknown-kind rejection for root and non-root nodes', () => {
    const root = singleTabsDoc()
    const rootUnknown = { ...root, rootNodeId: 'exotic', nodes: { exotic: { kind: 'exotic', id: 'exotic' } } } as never
    expect(hasCode(validateLayoutDocument(rootUnknown, TEST_VALIDATE_OPTIONS), 'LAY001_UNKNOWN_NODE_KIND')).toBe(true)

    const nonRoot = { ...root, nodes: { ...root.nodes, exotic: { kind: 'exotic', id: 'exotic' } } } as never
    expect(hasCode(validateLayoutDocument(nonRoot, TEST_VALIDATE_OPTIONS), 'LAY001_UNKNOWN_NODE_KIND')).toBe(true)
  })

  it('reports a dangling tab edge and reaches inactive descendants', () => {
    const doc = singleTabsDoc()
    const dangling = { ...doc, nodes: { ...doc.nodes, T: { ...doc.nodes.T, tabs: [{ nodeId: 'missing', label: 'Missing' }], activeNodeId: 'missing' } } } as never
    const result = validateLayoutDocument(dangling, TEST_VALIDATE_OPTIONS)
    expect(hasCode(result, 'LAY001_DANGLING_CHILD')).toBe(true)
    const reachable = validateLayoutDocument(tabsInSplitDoc(), TEST_VALIDATE_OPTIONS)
    expect(reachable.ok).toBe(true)
  })

  it('detects a cycle through a tabs edge', () => {
    const doc = singleTabsDoc()
    const cyclic = {
      ...doc,
      rootNodeId: 'T',
      nodes: {
        T: { kind: 'tabs', id: 'T', tabs: [{ nodeId: 'S', label: 'S' }], activeNodeId: 'S', tabsRevision: 0 },
        S: { kind: 'split', id: 'S', axis: 'horizontal', startNodeId: 'T', endNodeId: 't-a', startBasisPoints: 5000 },
        't-a': doc.nodes['t-a'],
      },
    } as never
    expect(hasCode(validateLayoutDocument(cyclic, TEST_VALIDATE_OPTIONS), 'LAY001_CYCLE')).toBe(true)
  })
})
