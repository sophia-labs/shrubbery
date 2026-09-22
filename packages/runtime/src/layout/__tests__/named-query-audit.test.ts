import { describe, expect, it } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { findRawQueryLocators } from '../named-query-audit.js'

function documentWith(raw: boolean): LayoutDocument {
  const queryId = raw ? 'SELECT * WHERE {}' : 'urn:sophia:query:obs.example'
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'audit',
    scope: 'session',
    graphId: 'observatory',
    rootNodeId: 'root',
    nodes: {
      root: { kind: 'split', id: 'root', axis: 'vertical', startNodeId: 'leaf', endNodeId: 'grid', startBasisPoints: 5000 },
      leaf: { kind: 'leaf', id: 'leaf', descriptor: { schemaVersion: 1, faceId: 'stat.scalar', resource: { kind: 'query', graphId: 'observatory', queryId } }, descriptorRevision: 0 },
      grid: {
        kind: 'grid', id: 'grid', flow: 'reflow', minCellWidth: 200, gridRevision: 0,
        children: { kind: 'fixed', cells: [{ id: 'cell', descriptor: { schemaVersion: 1, faceId: 'chart.vega-lite', resource: { kind: 'query', graphId: 'observatory', queryId } } }] },
      },
      collection: {
        kind: 'grid', id: 'collection', flow: 'reflow', minCellWidth: 200, gridRevision: 0,
        children: { kind: 'collection', collection: { kind: 'query', graphId: 'observatory', queryId }, itemFaceId: 'card.subject', maxItems: 2 },
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as LayoutDocument
}

describe('findRawQueryLocators', () => {
  it('reports leaf, fixed-cell, and collection sites and ignores non-query locators', () => {
    expect(findRawQueryLocators(documentWith(true))).toEqual([
      { nodeId: 'leaf', site: 'leaf', cellId: null, faceId: 'stat.scalar', queryId: 'SELECT * WHERE {}' },
      { nodeId: 'grid', site: 'grid-cell', cellId: 'cell', faceId: 'chart.vega-lite', queryId: 'SELECT * WHERE {}' },
      { nodeId: 'collection', site: 'grid-collection', cellId: null, faceId: 'card.subject', queryId: 'SELECT * WHERE {}' },
    ])
  })

  it('returns an empty frozen result for a fully named document', () => {
    const result = findRawQueryLocators(documentWith(false))
    expect(result).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })
})
