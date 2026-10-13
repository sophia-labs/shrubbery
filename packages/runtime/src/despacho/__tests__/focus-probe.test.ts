/**
 * focus-probe.test.ts — one `rdf:type` read classifies the thing under the
 * cursor (el Despacho W2): a bead, a seat, a letter, or honestly unknown.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { CTA_NS } from '../cuenta-reading.js'
import { COR_NS } from '../seat-reading.js'
import { classifyFocus, focusTypesQuery } from '../focus-probe.js'

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function types(rows: readonly string[]): QueryBlockResult {
  const bound: QueryBlockRow[] = rows.map((t) => ({ t: uri(t) }))
  return { queryKind: 'select', resultKind: 'bindings', columns: ['t'], rows: bound, totalRowCount: bound.length, durationMs: 1, raw: null } as QueryBlockResult
}

describe('focusTypesQuery', () => {
  it('asks for the distinct rdf:types across every named graph, capped', () => {
    expect(focusTypesQuery('urn:x:s')).toBe(
      'SELECT DISTINCT ?t WHERE { GRAPH ?g { <urn:x:s> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?t } } LIMIT 20',
    )
  })
})

describe('classifyFocus', () => {
  it('names a bead, a seat and a letter by their vocabulary class', () => {
    expect(classifyFocus('urn:b', types([`${CTA_NS}Cuenta`])).kind).toBe('cuenta')
    expect(classifyFocus('urn:s', types([`${COR_NS}Seat`])).kind).toBe('seat')
    expect(classifyFocus('urn:l', types([`${COR_NS}Letter`])).kind).toBe('letter')
  })

  it('prefers bead over seat over letter when a subject carries several, and keeps every type it saw', () => {
    const probe = classifyFocus('urn:x', types([`${COR_NS}Letter`, `${CTA_NS}Cuenta`, `${COR_NS}Letter`]))
    expect(probe.kind).toBe('cuenta')
    expect(probe.types).toEqual([`${COR_NS}Letter`, `${CTA_NS}Cuenta`])
  })

  it('is unknown, with the types it found, for anything else — and for no types at all', () => {
    expect(classifyFocus('urn:r', types([`${COR_NS}Run`]))).toEqual({ subject: 'urn:r', kind: 'unknown', types: [`${COR_NS}Run`] })
    expect(classifyFocus('urn:n', types([]))).toEqual({ subject: 'urn:n', kind: 'unknown', types: [] })
  })
})
