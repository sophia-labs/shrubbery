/**
 * seat-reading.test.ts — the pure fold of real result rows into a
 * `SeatReading` (el Despacho W2). Rows are shaped exactly as the cell's
 * SELECT bindings arrive, using the real seat `sophia` of sophia-cluster's
 * correo projection as read on 2026-09-15 for the property rows.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { CTA_NS } from '../cuenta-reading.js'
import {
  COR_NS,
  readSeat,
  seatCapabilitiesQuery,
  seatCorrespondentsQuery,
  seatCountsQuery,
  seatHeldBeadsQuery,
  seatLocalId,
  seatPropertiesQuery,
  seatRunsQuery,
  siblingSeatIri,
} from '../seat-reading.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const SOPHIA = `${G}:seat:sophia`
const CLOUD3 = `${G}:seat:cloud3`
const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer'

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string, datatype?: string) {
  return datatype ? { type: 'literal' as const, value, datatype } : { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}

const propsRows: QueryBlockRow[] = [
  { p: uri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), o: uri(`${COR_NS}Seat`) },
  { p: uri(`${COR_NS}seatId`), o: lit('sophia') },
  { p: uri(`${COR_NS}title`), o: lit('Demi of Sophia — convenor') },
  { p: uri(`${COR_NS}seatKind`), o: lit('system') },
  { p: uri(`${COR_NS}scope`), o: lit('The human conversation, network integration, uncovered responsibilities and continuity; no automatic production authority') },
  { p: uri(`${COR_NS}handoff`), o: lit('NOW.md') },
  { p: uri(`${COR_NS}evidence`), o: lit('CASEBOOK.md') },
  { p: uri(`${COR_NS}evidence`), o: lit('CONVENING.md') },
  { p: uri(`${COR_NS}attestation`), o: lit('operator-attested-local') },
]

describe('the seat query shapes', () => {
  it('name the subject in angle brackets, scan every named graph, and cap rows', () => {
    expect(seatPropertiesQuery(SOPHIA)).toBe(`SELECT ?p ?o WHERE { GRAPH ?g { <${SOPHIA}> ?p ?o } } LIMIT 500`)
    expect(seatCountsQuery(SOPHIA)).toContain(`FILTER NOT EXISTS { ?a <${COR_NS}acknowledges> ?u ; <${COR_NS}actor> <${SOPHIA}> }`)
    expect(seatRunsQuery(SOPHIA)).toContain('ORDER BY DESC(?at) LIMIT 5')
    expect(seatHeldBeadsQuery(SOPHIA)).toContain(`?b <${CTA_NS}owner> ?id`)
    expect(seatCorrespondentsQuery(SOPHIA)).toContain(`FILTER(?peer != <${SOPHIA}>)`)
  })

  it('derive local ids and sibling seat IRIs from the subject shape only', () => {
    expect(seatLocalId(SOPHIA)).toBe('sophia')
    expect(seatLocalId('urn:x:not-a-seat')).toBeNull()
    expect(siblingSeatIri(SOPHIA, 'cloud3')).toBe(CLOUD3)
    expect(siblingSeatIri(SOPHIA, 'a b/c')).toBe(`${G}:seat:a-b-c`)
    expect(siblingSeatIri('urn:x:not-a-seat', 'cloud3')).toBeNull()
  })
})

describe('readSeat', () => {
  it('folds the five results into one character with a heartbeat', () => {
    const counts = bindings(['in', 'out', 'unacked'], [{ in: lit('477', XSD_INT), out: lit('515', XSD_INT), unacked: lit('12', XSD_INT) }])
    const runs = bindings(
      ['run', 'state', 'runtime', 'at', 'body'],
      [
        { run: uri(`${G}:run:r-2`), state: lit('completed'), runtime: lit('codex-subagent'), at: lit('2026-09-14T10:00:00.000Z'), body: lit('/root/curation_cold_reader') },
        { run: uri(`${G}:run:r-1`), state: lit('failed'), runtime: lit('codex'), at: lit('2026-09-13T10:00:00.000Z') },
      ],
    )
    const held = bindings(['b', 'title', 'status', 'kind'], [])
    const peers = bindings(
      ['peer', 'ptitle', 'n'],
      [
        { peer: uri(CLOUD3), ptitle: lit('Cloud-3 — the move'), n: lit('208', XSD_INT) },
        { peer: uri(`${G}:seat:garden`), n: lit('142', XSD_INT) },
      ],
    )
    const reading = readSeat(SOPHIA, bindings(['p', 'o'], propsRows), counts, runs, held, peers)
    expect(reading.found).toBe(true)
    expect(reading.isSeat).toBe(true)
    expect(reading.seatId).toBe('sophia')
    expect(reading.title).toBe('Demi of Sophia — convenor')
    expect(reading.seatKind).toBe('system')
    expect(reading.evidence).toEqual(['CASEBOOK.md', 'CONVENING.md'])
    expect(reading.attestation).toBe('operator-attested-local')
    expect(reading.lettersIn).toBe(477)
    expect(reading.lettersOut).toBe(515)
    expect(reading.unacknowledged).toBe(12)
    expect(reading.recentRuns).toHaveLength(2)
    expect(reading.recentRuns[0]).toEqual({ iri: `${G}:run:r-2`, state: 'completed', runtime: 'codex-subagent', at: '2026-09-14T10:00:00.000Z', bodyIdentity: '/root/curation_cold_reader' })
    expect(reading.recentRuns[1]!.bodyIdentity).toBeNull()
    expect(reading.heldBeads).toEqual([])
    expect(reading.correspondents).toEqual([
      { iri: CLOUD3, title: 'Cloud-3 — the move', letters: 208 },
      { iri: `${G}:seat:garden`, title: null, letters: 142 },
    ])
    expect(reading.parent).toBeNull()
  })

  it('resolves a roster parent id to a sibling seat IRI, and reads held beads when a bead names the seat', () => {
    const props = bindings(['p', 'o'], [...propsRows, { p: uri(`${COR_NS}parent`), o: lit('cloud3') }])
    const held = bindings(['b', 'title', 'status', 'kind'], [{ b: uri('urn:b:1'), title: lit('A bead'), status: lit('open'), kind: lit('task') }])
    const empty = bindings([], [])
    const reading = readSeat(SOPHIA, props, empty, empty, held, empty)
    expect(reading.parent).toEqual({ seatId: 'cloud3', iri: CLOUD3 })
    expect(reading.heldBeads).toEqual([{ iri: 'urn:b:1', title: 'A bead', status: 'open', beadKind: 'task' }])
    expect(reading.lettersIn).toBe(0)
    expect(reading.recentRuns).toEqual([])
  })

  it('reads the correo v0.2.0 fields and the moves held when present, and leaves them empty on a plain seat', () => {
    const empty = bindings([], [])
    const plain = readSeat(SOPHIA, bindings(['p', 'o'], propsRows), empty, empty, empty, empty)
    expect(plain.seatStatus).toBeNull()
    expect(plain.capabilities).toEqual([])
    expect(plain.seals).toEqual([])
    expect(plain.lastRunAt).toBeNull()
    const folded = bindings(['p', 'o'], [
      ...propsRows,
      { p: uri(`${COR_NS}status`), o: lit('dormant') },
      { p: uri(`${COR_NS}agentUri`), o: lit('urn:sophia:agent:agent-7f4df2576d9333e1') },
      { p: uri(`${COR_NS}model`), o: lit('sonnet') },
      { p: uri(`${COR_NS}jail`), o: lit('Never executes a chosen workflow.') },
      { p: uri(`${COR_NS}seal`), o: lit('Reports, never mutates.') },
      { p: uri(`${COR_NS}seal`), o: lit('Scoped to wf: RDF.') },
      { p: uri(`${COR_NS}card`), o: lit('I am the Keeper of Workflow Books.') },
      { p: uri(`${COR_NS}lastRunAt`), o: lit('2026-09-12T09:00:00Z', 'http://www.w3.org/2001/XMLSchema#dateTime') },
      { p: uri(`${COR_NS}foldedFrom`), o: uri('urn:sophia:swarm:keeper:workflow-books') },
    ])
    const caps = bindings(
      ['cap', 'name', 'definition', 'contract', 'confidence', 'verdict', 'attestation'],
      [
        { cap: uri(`${G}:capability:open-workflow-book`), name: lit('open-workflow-book'), definition: lit('Open a workflow as a book.'), contract: lit('A page per step.'), confidence: lit('0.8'), verdict: lit('settled'), attestation: lit('swarm-graph') },
        { cap: uri(`${G}:capability:open-workflow-book`), name: lit('open-workflow-book') },
        { cap: uri(`${G}:capability:report-choice`), name: lit('report-choice') },
      ],
    )
    const reading = readSeat(SOPHIA, folded, empty, empty, empty, empty, caps)
    expect(reading.seatStatus).toBe('dormant')
    expect(reading.agentUri).toBe('urn:sophia:agent:agent-7f4df2576d9333e1')
    expect(reading.model).toBe('sonnet')
    expect(reading.jail).toBe('Never executes a chosen workflow.')
    expect(reading.seals).toEqual(['Reports, never mutates.', 'Scoped to wf: RDF.'])
    expect(reading.card).toBe('I am the Keeper of Workflow Books.')
    expect(reading.lastRunAt).toBe('2026-09-12T09:00:00Z')
    expect(reading.foldedFrom).toEqual(['urn:sophia:swarm:keeper:workflow-books'])
    expect(reading.capabilities).toEqual([
      { iri: `${G}:capability:open-workflow-book`, name: 'open-workflow-book', definition: 'Open a workflow as a book.', contract: 'A page per step.', confidence: '0.8', mergeVerdict: 'settled', attestation: 'swarm-graph' },
      { iri: `${G}:capability:report-choice`, name: 'report-choice', definition: null, contract: null, confidence: null, mergeVerdict: null, attestation: null },
    ])
    expect(seatCapabilitiesQuery(SOPHIA)).toContain(`?cap <${COR_NS}heldBy> <${SOPHIA}> ; <${COR_NS}capabilityName> ?name`)
  })

  it('is honest about a subject with no triples, and about one that is not a seat', () => {
    const empty = bindings([], [])
    const missing = readSeat('urn:x:nothing', bindings(['p', 'o'], []), empty, empty, empty, empty)
    expect(missing.found).toBe(false)
    expect(missing.isSeat).toBe(false)
    expect(missing.title).toBe('urn:x:nothing')
    const bead = readSeat('urn:b:1', bindings(['p', 'o'], [{ p: uri(`${CTA_NS}title`), o: lit('A bead') }]), empty, empty, empty, empty)
    expect(bead.found).toBe(true)
    expect(bead.isSeat).toBe(false)
  })
})
