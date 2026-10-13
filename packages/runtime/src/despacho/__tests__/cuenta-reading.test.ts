/**
 * cuenta-reading.test.ts — the pure fold of real result rows into a
 * `CuentaReading` (el Despacho W1). Rows are shaped exactly as the cell's
 * SELECT bindings arrive (`QueryBlockRow` terms), using the real Sirin gate
 * `sirin-g-slice-accepted` as read on 2026-09-15 for the property rows.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import {
  CTA_NS,
  cuentaAwaitsWord,
  cuentaEdgesQuery,
  cuentaLocalId,
  cuentaPropertiesQuery,
  cuentaRendicionesQuery,
  readCuenta,
} from '../cuenta-reading.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas'
const GATE = `${G}:cuenta:sirin-g-slice-accepted`
const REPOINT = `${G}:cuenta:sirin-g-repoint`

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string, datatype?: string) {
  return datatype ? { type: 'literal' as const, value, datatype } : { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}
function empty(columns: readonly string[]): QueryBlockResult {
  return bindings(columns, [])
}

const propsRows: QueryBlockRow[] = [
  { p: uri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), o: uri(`${CTA_NS}Cuenta`) },
  { p: uri(`${CTA_NS}title`), o: lit("Vera's word — she reaches sophia-cluster inside Sirin; the slice is accepted") },
  { p: uri(`${CTA_NS}owner`), o: lit('vera') },
  { p: uri(`${CTA_NS}priority`), o: lit('0', 'http://www.w3.org/2001/XMLSchema#integer') },
  { p: uri(`${CTA_NS}beadKind`), o: lit('gate') },
  { p: uri(`${CTA_NS}venue`), o: lit('human') },
  { p: uri(`${CTA_NS}status`), o: lit('open') },
  { p: uri(`${CTA_NS}partOf`), o: uri(`${G}:cuenta:sirin-w1`) },
  { p: uri(`${CTA_NS}needs`), o: uri(REPOINT) },
]

const edgeRows: QueryBlockRow[] = [
  { p: uri(`${CTA_NS}partOf`), target: uri(`${G}:cuenta:sirin-w1`), ttitle: lit('W1 — The Slice'), tstatus: lit('open') },
  { p: uri(`${CTA_NS}needs`), target: uri(REPOINT), ttitle: lit("Vera's word — repoint clients to api.sirin"), tstatus: lit('open') },
]

describe('the three query shapes', () => {
  it('name the subject in angle brackets, scan every named graph, and cap rows', () => {
    expect(cuentaPropertiesQuery(GATE)).toBe(`SELECT ?p ?o WHERE { GRAPH ?g { <${GATE}> ?p ?o } } LIMIT 500`)
    expect(cuentaEdgesQuery(GATE)).toContain(`<${GATE}> ?p ?target`)
    expect(cuentaEdgesQuery(GATE)).toContain(`<${CTA_NS}gatedBy>`)
    expect(cuentaRendicionesQuery(GATE)).toContain(`<${CTA_NS}forCuenta> <${GATE}>`)
    expect(cuentaRendicionesQuery(GATE)).toContain(`<${CTA_NS}utterance>`)
  })
})

describe('readCuenta', () => {
  it('folds the real gate rows: identity, state, edges with their targets’ state, and computed readiness', () => {
    const reading = readCuenta(GATE, bindings(['p', 'o'], propsRows), bindings(['p', 'target', 'ttitle', 'tstatus'], edgeRows), empty(['r']))
    expect(reading.found).toBe(true)
    expect(reading.localId).toBe('sirin-g-slice-accepted')
    expect(reading.title).toContain('the slice is accepted')
    expect(reading.beadKind).toBe('gate')
    expect(reading.status).toBe('open')
    expect(reading.owner).toBe('vera')
    expect(reading.priority).toBe(0)
    expect(reading.edges).toHaveLength(2)
    expect(reading.edges[1]).toEqual({ edge: 'needs', target: REPOINT, title: "Vera's word — repoint clients to api.sirin", status: 'open' })
    // open, but its `needs` target is still open → NOT ready (honest).
    expect(reading.ready).toBe(false)
    expect(cuentaAwaitsWord(reading)).toBe(true)
    expect(reading.props[`${CTA_NS}needs`]).toEqual([REPOINT])
  })

  it('is ready only when every needs/gatedBy target is done; an unknown target state is not done', () => {
    const doneEdges = bindings(['p', 'target', 'ttitle', 'tstatus'], [
      { p: uri(`${CTA_NS}needs`), target: uri(REPOINT), ttitle: lit('x'), tstatus: lit('done') },
      { p: uri(`${CTA_NS}partOf`), target: uri(`${G}:cuenta:sirin-w1`), ttitle: lit('W1'), tstatus: lit('open') },
    ])
    expect(readCuenta(GATE, bindings(['p', 'o'], propsRows), doneEdges, empty(['r'])).ready).toBe(true)
    const unknownEdges = bindings(['p', 'target'], [{ p: uri(`${CTA_NS}gatedBy`), target: uri('urn:x:not-a-bead') }])
    expect(readCuenta(GATE, bindings(['p', 'o'], propsRows), unknownEdges, empty(['r'])).ready).toBe(false)
  })

  it('folds a Rendición’s evidence fan-out into one account and keeps the word and utterance verbatim', () => {
    const r = `${G}:rendicion:sirin-g-slice-accepted-r1`
    const rows: QueryBlockRow[] = [
      { r: uri(r), verdict: lit('done'), witness: lit('vera, in chat'), summary: lit('Word given.'), renderedAt: lit('2026-09-15T19:00:00Z'), word: lit('yes'), utterance: lit("Yes — it's on Sirin.\nAccepted."), evidence: lit('receipt-1') },
      { r: uri(r), verdict: lit('done'), witness: lit('vera, in chat'), summary: lit('Word given.'), renderedAt: lit('2026-09-15T19:00:00Z'), word: lit('yes'), utterance: lit("Yes — it's on Sirin.\nAccepted."), evidence: lit('receipt-2') },
    ]
    const reading = readCuenta(GATE, bindings(['p', 'o'], propsRows), empty(['p']), bindings(['r'], rows))
    expect(reading.rendiciones).toHaveLength(1)
    expect(reading.rendiciones[0]).toEqual({
      iri: r,
      verdict: 'done',
      witness: 'vera, in chat',
      summary: 'Word given.',
      renderedAt: '2026-09-15T19:00:00Z',
      word: 'yes',
      utterance: "Yes — it's on Sirin.\nAccepted.",
      evidence: ['receipt-1', 'receipt-2'],
    })
  })

  it('a subject with no triples is honestly not found, keeps the IRI as its title, and takes no word', () => {
    const reading = readCuenta('urn:x:nothing', empty(['p', 'o']), empty(['p']), empty(['r']))
    expect(reading.found).toBe(false)
    expect(reading.title).toBe('urn:x:nothing')
    expect(reading.localId).toBeNull()
    expect(cuentaAwaitsWord(reading)).toBe(false)
  })

  it('cuentaLocalId reads the segment after :cuenta:', () => {
    expect(cuentaLocalId(GATE)).toBe('sirin-g-slice-accepted')
    expect(cuentaLocalId(`${G}:rendicion:x-r1`)).toBeNull()
    expect(cuentaLocalId(`${G}:cuenta:`)).toBeNull()
  })
})
