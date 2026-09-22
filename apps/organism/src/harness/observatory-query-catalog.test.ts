import { describe, expect, it } from 'vitest'
import { OBS_QUERY, OBSERVATORY_NAMED_QUERIES, createObservatoryNamedQueryRegistry } from './observatory-query-catalog.js'
import { observatoryDashboardQueries } from './observatory-dashboard-document.js'

describe('observatory named-query catalogue', () => {
  it('resolves all nine entries to the expected graph-scoped SPARQL', () => {
    const queries = observatoryDashboardQueries('other-cell')
    expect(Object.keys(queries)).toHaveLength(9)
    expect(queries.freshness).toContain('urn:mnemosyne:local:graph:other-cell:projection:obs:rollups')
    expect(queries.activityByKind).toContain('urn:mnemosyne:local:graph:other-cell:projection:obs:raw')
    expect(queries.dauOverTime).toContain('urn:sophia:observatory:metric:billing_llm_dau_v1')
    expect(queries.recentMachineRuns).toContain('LIMIT 50')
    expect(queries.sequenceGaps).toContain('obs:SequenceGap')
    expect(Object.values(queries).every((query) => !query.includes('{{graphId}}'))).toBe(true)
  })

  it('returns exactly the nine sealed names', () => {
    const registry = createObservatoryNamedQueryRegistry()
    expect(registry.names()).toEqual([...Object.values(OBS_QUERY)].sort())
    expect(OBSERVATORY_NAMED_QUERIES).toHaveLength(9)
    expect(registry.isSealed).toBe(true)
    expect(() => registry.register({ name: 'urn:sophia:query:extra', text: 'ASK {}', description: 'extra' })).toThrow()
  })
})
