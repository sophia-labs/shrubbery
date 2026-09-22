/**
 * observatory-dashboard-document.test.ts — real, no-mock coverage for Stage 0
 * "tell the truth"'s refresh-cadence wiring in the canned "observatory
 * surface v0" `LayoutDocument` (`observatory-dashboard-document.ts`): every
 * refreshable cell carries `OBSERVATORY_REFRESH_SECONDS`, the load-once
 * table stays load-once, and the whole document still validates against the
 * real sealed fragment face registry — the offline proof that adding a
 * `refreshSeconds` param to every one of those descriptors clears each
 * face's own CLOSED params schema.
 */
import { describe, expect, it } from 'vitest'
import { createFragmentFaceRegistry, findRawQueryLocators } from '@shrubbery/runtime/layout'
import { validateLayoutDocument, type LayoutGridNode, type LayoutLeafNode } from '@shrubbery/nucleus/layout'
import { buildObservatoryDashboardDocument, OBSERVATORY_REFRESH_SECONDS } from './observatory-dashboard-document.js'
import { OBS_QUERY, createObservatoryNamedQueryRegistry } from './observatory-query-catalog.js'

// The seven fixed stat/chart cells `ObsStatsGrid` carries — enumerated by id
// so a future added cell that forgets `refreshSeconds` fails this test
// instead of silently shipping load-once.
const FIXED_CELL_IDS = [
  'freshness',
  'active-runs',
  'failed-runs',
  'cold-start-p95',
  'estimated-compute-usd',
  'dau-chart',
  'kind-chart',
] as const

describe('buildObservatoryDashboardDocument — refresh cadence (Stage 0 "tell the truth")', () => {
  it('every stat/chart fixed cell carries refreshSeconds === OBSERVATORY_REFRESH_SECONDS', () => {
    const doc = buildObservatoryDashboardDocument('observatory-refresh-test')
    const statsGrid = doc.nodes.ObsStatsGrid as LayoutGridNode
    if (statsGrid.children.kind !== 'fixed') throw new Error('expected ObsStatsGrid to carry fixed cells')

    const byId = new Map(statsGrid.children.cells.map((cell) => [cell.id, cell]))
    expect(byId.size).toBe(FIXED_CELL_IDS.length)

    for (const id of FIXED_CELL_IDS) {
      const cell = byId.get(id)
      expect(cell, `missing fixed cell ${id}`).toBeDefined()
      expect(cell!.descriptor.params?.refreshSeconds, `${id}.params.refreshSeconds`).toBe(OBSERVATORY_REFRESH_SECONDS)
    }
  })

  it('the ObsGapsGrid collection source carries refreshSeconds as a SIBLING of itemParams — itemParams itself does NOT', () => {
    const doc = buildObservatoryDashboardDocument('observatory-refresh-test')
    const gapsGrid = doc.nodes.ObsGapsGrid as LayoutGridNode
    if (gapsGrid.children.kind !== 'collection') throw new Error('expected ObsGapsGrid to carry a collection source')

    expect(gapsGrid.children.refreshSeconds).toBe(OBSERVATORY_REFRESH_SECONDS)
    expect(gapsGrid.children.itemParams).not.toHaveProperty('refreshSeconds')
  })

  it('ObsRunsTable (sparql.bindings-table) carries no refreshSeconds — that face has no such param', () => {
    const doc = buildObservatoryDashboardDocument('observatory-refresh-test')
    const runsTable = doc.nodes.ObsRunsTable as LayoutLeafNode
    expect(runsTable.descriptor.params).not.toHaveProperty('refreshSeconds')
  })

  it('the canned document validates against the real sealed fragment face registry — ok:true, zero diagnostics', () => {
    const doc = buildObservatoryDashboardDocument('observatory-refresh-test')
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

  it('the canned document carries no raw query text for either supported graph id', () => {
    expect(findRawQueryLocators(buildObservatoryDashboardDocument('observatory'))).toEqual([])
    expect(findRawQueryLocators(buildObservatoryDashboardDocument('other-cell'))).toEqual([])
  })

  it('every query id in the document names an entry in the sealed catalogue', () => {
    const registry = createObservatoryNamedQueryRegistry()
    const doc = buildObservatoryDashboardDocument()
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'leaf' && node.descriptor.resource.kind === 'query') expect(registry.has(node.descriptor.resource.queryId)).toBe(true)
      if (node.kind === 'grid') {
        if (node.children.kind === 'fixed') {
          for (const cell of node.children.cells) {
            if (cell.descriptor.resource.kind === 'query') expect(registry.has(cell.descriptor.resource.queryId)).toBe(true)
          }
        } else if (node.children.collection.kind === 'query') {
          expect(Object.values(OBS_QUERY)).toContain(node.children.collection.queryId)
          expect(registry.has(node.children.collection.queryId)).toBe(true)
        }
      }
    }
  })
})
