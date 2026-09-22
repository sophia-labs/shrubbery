import { describe, expect, it } from 'vitest'
import {
  OBS_SURFACE_QUERY,
  OBSERVATORY_SURFACE_NAMED_QUERIES,
  createObservatorySurfaceNamedQueryRegistry,
} from './observatory-surface-query-catalog.js'

describe('observatory surface (tabs-composed) named-query catalogue', () => {
  it('every template wraps its patterns in an explicit GRAPH<iri>{…} naming only the raw or rollups slot', () => {
    for (const def of OBSERVATORY_SURFACE_NAMED_QUERIES) {
      expect(def.text, def.name).toMatch(/GRAPH <urn:mnemosyne:local:graph:\{\{graphId\}\}:projection:obs:(raw|rollups)>/)
    }
  })

  it('no query applies STRENDS to a bare variable — every STRENDS( is followed by STR(?', () => {
    for (const def of OBSERVATORY_SURFACE_NAMED_QUERIES) {
      const matches = def.text.match(/STRENDS\(/g) ?? []
      for (const _ of matches) {
        expect(def.text, def.name).not.toMatch(/STRENDS\((?!STR\()/)
      }
    }
  })

  it('DAU queries reference usage_dau_v1 and never billing_llm_dau_v1', () => {
    const dau = OBSERVATORY_SURFACE_NAMED_QUERIES.find((d) => d.name === OBS_SURFACE_QUERY.dau)!
    const dauSeries = OBSERVATORY_SURFACE_NAMED_QUERIES.find((d) => d.name === OBS_SURFACE_QUERY.dauSeries)!
    expect(dau.text).toContain('urn:sophia:observatory:metric:usage_dau_v1')
    expect(dauSeries.text).toContain('urn:sophia:observatory:metric:usage_dau_v1')
    expect(dau.text).not.toContain('billing_llm_dau_v1')
    expect(dauSeries.text).not.toContain('billing_llm_dau_v1')
    for (const def of OBSERVATORY_SURFACE_NAMED_QUERIES) {
      expect(def.text, def.name).not.toContain('billing_llm_dau_v1')
    }
  })

  it('the name union, the exported name list, and the registry keys are the same 19-member set', () => {
    const nameUnionValues = Object.values(OBS_SURFACE_QUERY)
    expect(nameUnionValues).toHaveLength(19)
    expect(new Set(nameUnionValues).size).toBe(19)

    expect(OBSERVATORY_SURFACE_NAMED_QUERIES).toHaveLength(19)
    expect(new Set(OBSERVATORY_SURFACE_NAMED_QUERIES.map((d) => d.name))).toEqual(new Set(nameUnionValues))

    const registry = createObservatorySurfaceNamedQueryRegistry()
    expect(registry.names()).toEqual([...nameUnionValues].sort())
    expect(registry.isSealed).toBe(true)
    expect(() => registry.register({ name: 'urn:sophia:query:obs.extra', text: 'ASK {}', description: 'extra' })).toThrow()
  })

  it('every name matches the urn:sophia:query:obs.<page>.<slug> shape and resolves without leaving {{graphId}} behind', () => {
    const registry = createObservatorySurfaceNamedQueryRegistry()
    for (const name of Object.values(OBS_SURFACE_QUERY)) {
      expect(name).toMatch(/^urn:sophia:query:obs\.(pulse|fleet|capture)\.[a-z][a-z0-9-]*$/)
      const resolved = registry.resolve(name, 'other-cell')
      expect(resolved).not.toContain('{{graphId}}')
      expect(resolved).toContain('urn:mnemosyne:local:graph:other-cell:')
    }
  })
})
