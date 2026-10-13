/**
 * agent-reading.test.ts — the pure fold of an entry (el Despacho W11, the
 * roster pokédex). Rows are shaped as the cell's SELECT bindings arrive;
 * the seat fixture is the folded choreograph agent `sophia-1` as read from
 * sophia-cluster's correo projection on 2026-09-16 (status dormant, last run
 * claimed at fold time, two retired generations in its lineage).
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow } from '../../editor-services/query-block-service.js'
import { COR_NS, readSeat } from '../seat-reading.js'
import { AGENT_SILENT_AFTER_DAYS, agentLineageQuery, agentRunStatsQuery, deriveDormancy, habitatOf, readAgent } from '../agent-reading.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const SOPHIA_1 = `${G}:seat:sophia-1`
const RETIRED = `${G}:seat:agent-e0e9f8f3fc949e14`
const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer'
const XSD_DT = 'http://www.w3.org/2001/XMLSchema#dateTime'
const NOW = new Date('2026-09-16T06:00:00.000Z')

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string, datatype?: string) {
  return datatype ? { type: 'literal' as const, value, datatype } : { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}
const empty = (columns: readonly string[]) => bindings(columns, [])

const propsRows: QueryBlockRow[] = [
  { p: uri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), o: uri(`${COR_NS}Seat`) },
  { p: uri(`${COR_NS}seatId`), o: lit('sophia-1') },
  { p: uri(`${COR_NS}title`), o: lit('sophia-1 (choreograph agent)') },
  { p: uri(`${COR_NS}seatKind`), o: lit('choreograph-agent') },
  { p: uri(`${COR_NS}status`), o: lit('dormant') },
  { p: uri(`${COR_NS}agentUri`), o: lit('urn:sophia:agent:agent-8dc95d85e3b09eb7') },
  { p: uri(`${COR_NS}model`), o: lit('pilot gpt-5.6-sol; emanation gpt-5.6-luna (openai-codex)') },
  { p: uri(`${COR_NS}trigger`), o: lit('sophia-cluster.message; mode direct-owner-session; ingress owner') },
  { p: uri(`${COR_NS}definition`), o: lit('domain-agent-definition') },
  { p: uri(`${COR_NS}definition`), o: lit('sophia-1-grant-13bef65fd6678e75f859d440 (graph=observatory)') },
  { p: uri(`${COR_NS}lastRunAt`), o: lit('2026-08-11T17:49:41Z', XSD_DT) },
  { p: uri(`${COR_NS}supersedes`), o: uri(RETIRED) },
  { p: uri(`${COR_NS}foldedFrom`), o: lit('regidora-ledger-addendum-20260915-roster') },
  { p: uri(`${COR_NS}attestation`), o: lit('choreograph-host') },
]

function seatFixture() {
  return readSeat(
    SOPHIA_1,
    bindings(['p', 'o'], propsRows),
    bindings(['in', 'out', 'unacked'], [{ in: lit('0', XSD_INT), out: lit('0', XSD_INT), unacked: lit('0', XSD_INT) }]),
    empty(['run', 'state', 'runtime', 'at', 'body']),
    empty(['b', 'title', 'status', 'kind']),
    empty(['peer', 'ptitle', 'n']),
    empty(['cap', 'name', 'definition', 'contract', 'confidence', 'verdict', 'attestation']),
  )
}

describe('the entry query shapes', () => {
  it('count runs by state over every run and read supersession both ways', () => {
    expect(agentRunStatsQuery(SOPHIA_1)).toContain(`?run <${COR_NS}seat> <${SOPHIA_1}> ; <${COR_NS}state> ?state ; <${COR_NS}at> ?at`)
    expect(agentRunStatsQuery(SOPHIA_1)).toContain('GROUP BY ?state')
    expect(agentLineageQuery(SOPHIA_1)).toContain(`<${SOPHIA_1}> <${COR_NS}supersedes> ?other`)
    expect(agentLineageQuery(SOPHIA_1)).toContain(`?other <${COR_NS}supersedes> <${SOPHIA_1}>`)
  })
})

describe('readAgent', () => {
  it('folds run counts, lineage, habitat and a dormancy that rests on the source claim', () => {
    const stats = bindings(
      ['state', 'n', 'first', 'last'],
      [
        { state: lit('completed'), n: lit('7', XSD_INT), first: lit('2026-08-10T00:00:00Z', XSD_DT), last: lit('2026-08-11T01:00:00Z', XSD_DT) },
        { state: lit('failed'), n: lit('4', XSD_INT), first: lit('2026-08-10T00:00:00Z', XSD_DT), last: lit('2026-08-11T17:49:41Z', XSD_DT) },
        { state: lit('started'), n: lit('5', XSD_INT), first: lit('2026-08-11T00:00:00Z', XSD_DT), last: lit('2026-08-11T17:00:00Z', XSD_DT) },
      ],
    )
    const lineage = bindings(
      ['rel', 'other', 'title', 'status'],
      [
        { rel: lit('supersedes'), other: uri(RETIRED), title: lit('retired generation (superseded by sophia-1)'), status: lit('retired') },
        { rel: lit('superseded-by'), other: uri(`${G}:seat:sophia-2`), title: lit('sophia-2'), status: lit('active') },
      ],
    )
    const entry = readAgent(seatFixture(), stats, lineage, NOW)
    expect(entry.runStats).toEqual({ completed: 7, failed: 4, open: 5, total: 16, firstAt: '2026-08-10T00:00:00Z', lastAt: '2026-08-11T17:49:41Z' })
    expect(entry.lineage.ancestor).toEqual({ iri: RETIRED, title: 'retired generation (superseded by sophia-1)', status: 'retired' })
    expect(entry.lineage.heirs).toEqual([{ iri: `${G}:seat:sophia-2`, title: 'sophia-2', status: 'active' }])
    expect(entry.habitat).toBe('the choreograph host; defined in 2 graph documents; woken by sophia-cluster.message; mode direct-owner-session; ingress owner')
    // The graph's own status claim wins over what the runs imply.
    expect(entry.dormancy).toBe('dormant')
    expect(entry.dormancyBasis).toBe('its source says dormant; last run claimed 2026-08-11T17:49:41Z')
  })

  it('says silent from the runs alone when no status is claimed, and unknown when nothing is', () => {
    const seat = { ...seatFixture(), seatStatus: null, lastRunAt: null }
    const old = { completed: 1, failed: 0, open: 0, total: 1, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-08-01T00:00:00Z' }
    expect(deriveDormancy(seat, old, NOW)).toEqual({ dormancy: 'silent', basis: 'no run in 46 days (last 2026-08-01T00:00:00Z)' })
    const fresh = { ...old, lastAt: '2026-09-15T00:00:00Z' }
    expect(deriveDormancy(seat, fresh, NOW).dormancy).toBe('active')
    expect(deriveDormancy(seat, { ...old, lastAt: null, total: 0 }, NOW)).toEqual({ dormancy: 'unknown', basis: 'no run recorded; no status claimed' })
    expect(AGENT_SILENT_AFTER_DAYS).toBe(14)
  })

  it('names a non-lifecycle status instead of reporting that none was claimed', () => {
    // The fold maps a keeper's formationVerdict and a house seat's own state
    // onto `cor:status`, so a keeper reads "confident" — a claim about how it
    // was formed, not about its life. The first live proof of this face said
    // "no status claimed" of exactly such a keeper; naming it is the point.
    const keeper = { ...seatFixture(), seatKind: 'keeper', seatStatus: 'confident', lastRunAt: null }
    const none = { completed: 0, failed: 0, open: 0, total: 0, firstAt: null, lastAt: null }
    expect(deriveDormancy(keeper, none, NOW)).toEqual({
      dormancy: 'unknown',
      basis: 'no run recorded; its source claims "confident", which says nothing about its life',
    })
    // A lifecycle word still wins outright; the runs still speak when it is silent.
    expect(deriveDormancy({ ...keeper, seatStatus: 'retired' }, none, NOW).dormancy).toBe('retired')
    expect(deriveDormancy(keeper, { ...none, total: 1, completed: 1, lastAt: '2026-08-01T00:00:00Z' }, NOW).dormancy).toBe('silent')
  })

  it('names a habitat for every seat kind the fold minted, and unknown for none', () => {
    expect(habitatOf('keeper', [], null)).toContain('swarm graph')
    expect(habitatOf('house-seat', [], null)).toContain('Sirin house')
    expect(habitatOf('demanation', [], null)).toContain('Demi network')
    expect(habitatOf('unrostered', [], null)).toContain('register only')
    expect(habitatOf('choreograph-agent', [], 'demi.manual.probe')).toBe('the choreograph host; woken by demi.manual.probe')
    expect(habitatOf(null, [], null)).toBe('unknown')
  })

  it('folds an empty stats result and an empty lineage honestly', () => {
    const entry = readAgent(seatFixture(), empty(['state', 'n', 'first', 'last']), empty(['rel', 'other', 'title', 'status']), NOW)
    expect(entry.runStats).toEqual({ completed: 0, failed: 0, open: 0, total: 0, firstAt: null, lastAt: null })
    expect(entry.lineage).toEqual({ ancestor: null, heirs: [] })
    expect(entry.seat.isSeat).toBe(true)
  })
})
