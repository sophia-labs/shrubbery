import { describe, expect, it } from 'vitest'
import type { SparqlRow } from '../garden-client.js'
import {
  allRecordsQuery,
  evidenceForQuery,
  memoryRecordFromSparqlRow,
  projectionMemoryIri,
} from '../memory-world.js'

const GRAPH = 'test-graph'
const MEM_GRAPH = projectionMemoryIri(GRAPH)

function compact(q: string): string {
  return q.replace(/\s+/g, ' ').trim()
}

describe('memory-world SPARQL builders', () => {
  it('selects observer bindings with OPTIONAL clauses on all live memory reads', () => {
    const allRecords = compact(allRecordsQuery(MEM_GRAPH))
    const evidence = compact(evidenceForQuery(MEM_GRAPH, ['tennis'], 7) ?? '')

    expect(allRecords).toContain('SELECT ?rec ?content ?status ?kind ?created ?observed ?observer ?scope ?orient ?root')
    expect(allRecords).toContain('OPTIONAL { ?rec mem:observer ?observer }')

    expect(evidence).toContain('SELECT ?rec ?content ?status ?kind ?created ?observed ?observer ?scope ?orient')
    expect(evidence).toContain('OPTIONAL { ?rec mem:observer ?observer }')
    expect(evidence).toContain('LIMIT 7')
  })

  it('maps an observer binding onto MemoryRecord and preserves root tracking', () => {
    const roots = new Map<string, string>()
    const row: SparqlRow = {
      rec: { type: 'iri', value: 'urn:mnemosyne:local:graph:test:record:abcdef1234567890' },
      root: { type: 'iri', value: 'urn:mnemosyne:local:graph:test:record:rootfedcba987654' },
      content: { type: 'literal', value: 'User prefers clay courts.' },
      status: { type: 'literal', value: 'active' },
      kind: { type: 'literal', value: 'SemanticMemory' },
      created: { type: 'literal', value: '2026-07-05T12:00:00Z' },
      observed: { type: 'literal', value: '2026-07-05T12:01:00Z' },
      observer: { type: 'literal', value: 'agent:gamma' },
      scope: { type: 'literal', value: 'user' },
      orient: { type: 'literal', value: 'preference' },
    }

    const record = memoryRecordFromSparqlRow(row, roots)

    expect(record).toMatchObject({
      id: row.rec.value,
      localId: 'abcdef123456',
      content: 'User prefers clay courts.',
      status: 'active',
      kind: 'SemanticMemory',
      createdAt: '2026-07-05T12:00:00Z',
      observedAt: '2026-07-05T12:01:00Z',
      observer: 'agent:gamma',
      scope: 'user',
      contentOrientation: 'preference',
    })
    expect(roots.get(row.rec.value)).toBe(row.root.value)
  })
})
