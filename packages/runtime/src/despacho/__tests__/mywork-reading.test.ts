/**
 * mywork-reading.test.ts — the pure fold of one office's held work (el
 * Despacho W4). Beads are the real Despacho campaign beads of
 * sophia-cluster's cuentas projection as read on 2026-09-16.
 *
 * What these tests hold to: the ontology's own status order, an unknown
 * status kept under its own name rather than dropped, and "gated on me" =
 * beads whose gatedBy names an OPEN gate this office owns.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { CTA_NS } from '../cuenta-reading.js'
import { cuentasGraphIri } from '../inbox-reading.js'
import { myWorkGatedOnQuery, myWorkHeldQuery, readMyWork } from '../mywork-reading.js'

const CUENTAS = cuentasGraphIri('sophia-cluster')
const bead = (local: string) => `${CUENTAS}:cuenta:${local}`

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string) {
  return { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}
const empty = bindings([], [])

describe('the my-work query shapes', () => {
  it('name the graph explicitly and bind the office as an escaped literal', () => {
    const q = myWorkHeldQuery(CUENTAS, 'demi')
    expect(q).toContain(`GRAPH <${CUENTAS}>`)
    expect(q).toContain(`<${CTA_NS}owner> "demi"`)
  })

  it('ask for gated-on work only through OPEN gates this office owns', () => {
    const q = myWorkGatedOnQuery(CUENTAS, 'vera')
    expect(q).toContain(`?gate <${CTA_NS}beadKind> "gate" ; <${CTA_NS}status> "open" ; <${CTA_NS}owner> "vera"`)
    expect(q).toContain(`?bead <${CTA_NS}gatedBy> ?gate`)
  })
})

describe('readMyWork', () => {
  const held = bindings(
    ['bead', 'title', 'kind', 'status', 'priority', 'createdAt', 'partOf', 'partTitle'],
    [
      { bead: uri(bead('despacho-w4-inbox')), title: lit('W4 Inbox'), kind: lit('wave'), status: lit('open'), priority: lit('0'), partOf: uri(bead('despacho')), partTitle: lit('El Despacho') },
      { bead: uri(bead('despacho-w2')), title: lit('W2 — seats and letters'), kind: lit('wave'), status: lit('done'), priority: lit('0') },
      { bead: uri(bead('despacho-d-deploy-record-lags')), title: lit('the deploy record lags'), kind: lit('task'), status: lit('in_progress'), priority: lit('0') },
      { bead: uri(bead('despacho-w11-elenco')), title: lit('elenco (superseded)'), kind: lit('task'), status: lit('composted') },
      // a status the ontology does not name — kept, under its own name, never dropped
      { bead: uri(bead('odd-one')), title: lit('something else'), status: lit('parked') },
    ],
  )

  it('groups by status in the ontology’s order, unknown statuses last', () => {
    const reading = readMyWork('demi', held, empty)
    expect(reading.groups.map((g) => g.status)).toEqual(['open', 'in_progress', 'done', 'composted', 'parked'])
    expect(reading.groups[0]!.beads[0]!.title).toBe('W4 Inbox')
    expect(reading.groups[0]!.beads[0]!.partTitle).toBe('El Despacho')
  })

  it('counts what the room claims: held, open, in progress', () => {
    const reading = readMyWork('demi', held, empty)
    expect(reading.counts.held).toBe(5)
    expect(reading.counts.open).toBe(1)
    expect(reading.counts.inProgress).toBe(1)
    expect(reading.counts.gatedOn).toBe(0)
    expect(reading.owner).toBe('demi')
  })

  it('de-duplicates a bead that arrives on several rows', () => {
    const doubled = bindings(
      ['bead', 'title', 'status'],
      [
        { bead: uri(bead('despacho-w2')), title: lit('W2'), status: lit('done') },
        { bead: uri(bead('despacho-w2')), title: lit('W2'), status: lit('done') },
      ],
    )
    expect(readMyWork('demi', doubled, empty).counts.held).toBe(1)
  })

  it('reads the work waiting on an office’s own open gates', () => {
    const gated = bindings(
      ['bead', 'title', 'kind', 'status', 'gate', 'gateTitle'],
      [
        { bead: uri(bead('despacho-w1-proof')), title: lit('the proof'), kind: lit('task'), status: lit('open'), gate: uri(bead('despacho-g-name')), gateTitle: lit('the name') },
        { bead: uri(bead('despacho-w1-proof')), title: lit('the proof'), kind: lit('task'), status: lit('open'), gate: uri(bead('despacho-g-name')), gateTitle: lit('the name') },
      ],
    )
    const reading = readMyWork('vera', empty, gated)
    expect(reading.gatedOn).toHaveLength(1)
    expect(reading.gatedOn[0]!.gateTitle).toBe('the name')
    expect(reading.counts.gatedOn).toBe(1)
  })

  it('reads an empty office honestly — no groups, no gated work, zero counts', () => {
    const reading = readMyWork('nobody', empty, empty)
    expect(reading.groups).toEqual([])
    expect(reading.counts).toEqual({ held: 0, open: 0, inProgress: 0, gatedOn: 0 })
  })
})
