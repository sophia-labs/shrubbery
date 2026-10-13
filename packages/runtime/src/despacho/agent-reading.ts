/**
 * agent-reading.ts — the PURE reading of one pokédex ENTRY (el Despacho W11,
 * plans/2026-09-15-despacho-operational-memo.md §6): a seat of the correo
 * canon read as a catalogue entry — number and name, type and habitat, a
 * status stamped honestly, stats, moves, rules, lineage, evolutions, the card
 * verbatim. It is the seat's elder sibling: everything `seat-reading.ts`
 * already folds is reused as-is; this module adds the two shapes the entry
 * needs on top (run counts by state over EVERY run, and the supersession
 * lineage in both directions) and the pure derivations (habitat, dormancy).
 *
 * Data-only: no DOM, no network. Every derived word is a claim the view can
 * say with its source: `dormancy` names what the graph says (a `cor:status`
 * claim) before what the runs imply (no run in a fortnight), and never
 * invents activity.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { COR_NS, SEAT_MAX_ROWS, type SeatReading } from './seat-reading.js'

export const AGENT_SILENT_AFTER_DAYS = 14

export interface AgentRunStats {
  readonly completed: number
  readonly failed: number
  /** started (queued/running) — open at the register's last word. */
  readonly open: number
  readonly total: number
  readonly firstAt: string | null
  readonly lastAt: string | null
}

export interface AgentLineageLink {
  readonly iri: string
  readonly title: string | null
  readonly status: string | null
}

export interface AgentLineage {
  /** The seat this one replaces (`cor:supersedes`), resolved. */
  readonly ancestor: AgentLineageLink | null
  /** Seats that name this one as what they replace. */
  readonly heirs: readonly AgentLineageLink[]
}

/** What the entry says about the agent's life, and where the word comes from. */
export type AgentDormancy = 'active' | 'idle' | 'dormant' | 'retired' | 'silent' | 'unknown'

export interface AgentEntry {
  readonly seat: SeatReading
  readonly runStats: AgentRunStats
  readonly lineage: AgentLineage
  /** Where it runs, in words, derived from its kind and its definitions. */
  readonly habitat: string
  readonly dormancy: AgentDormancy
  /** Which fact `dormancy` rests on, in words, for the view to say. */
  readonly dormancyBasis: string
}

function iri(subject: string): string {
  return `<${subject}>`
}

/** Every run recorded for the seat, counted by state, with the first and last timestamps. */
export function agentRunStatsQuery(subject: string): string {
  return (
    `SELECT ?state (COUNT(DISTINCT ?run) AS ?n) (MIN(?at) AS ?first) (MAX(?at) AS ?last) WHERE { GRAPH ?g { ` +
    `?run <${COR_NS}seat> ${iri(subject)} ; <${COR_NS}state> ?state ; <${COR_NS}at> ?at } } GROUP BY ?state`
  )
}

/** Supersession both ways: what this seat replaces, and what replaces it. */
export function agentLineageQuery(subject: string): string {
  const s = iri(subject)
  return (
    `SELECT ?rel ?other ?title ?status WHERE { GRAPH ?g { ` +
    `{ ${s} <${COR_NS}supersedes> ?other . BIND("supersedes" AS ?rel) } UNION ` +
    `{ ?other <${COR_NS}supersedes> ${s} . BIND("superseded-by" AS ?rel) } ` +
    `OPTIONAL { ?other <${COR_NS}title> ?title } OPTIONAL { ?other <${COR_NS}status> ?status } } } ` +
    `ORDER BY ?rel ?other LIMIT ${SEAT_MAX_ROWS}`
  )
}

/** Pure — where a seat of this kind lives, in words. */
export function habitatOf(seatKind: string | null, definitions: readonly string[], trigger: string | null): string {
  switch (seatKind) {
    case 'choreograph-agent':
      return definitions.length > 0
        ? `the choreograph host; defined in ${definitions.length} graph document${definitions.length === 1 ? '' : 's'}${trigger ? `; woken by ${trigger}` : ''}`
        : `the choreograph host${trigger ? `; woken by ${trigger}` : ''}`
    case 'keeper':
      return 'the swarm graph — a facility, folded into correo'
    case 'house-seat':
      return 'the Sirin house — a seat of the cloud-3 move, folded into correo'
    case 'demanation':
    case 'cross-repo':
    case 'repo':
    case 'system':
      return 'the Demi network — bodies run as codex subagents and Claude watches'
    case 'unrostered':
      return 'the register only — it appears in letters or runs but not in the roster'
    default:
      return 'unknown'
  }
}

function readRunStats(result: QueryBlockResult): AgentRunStats {
  let completed = 0
  let failed = 0
  let open = 0
  let firstAt: string | null = null
  let lastAt: string | null = null
  if (result.resultKind === 'bindings') {
    for (const row of result.rows) {
      const state = plainQueryBlockTermValue(row.state)
      const n = Number(plainQueryBlockTermValue(row.n))
      const count = Number.isFinite(n) ? n : 0
      if (state === 'completed') completed += count
      else if (state === 'failed') failed += count
      else open += count
      const first = row.first ? plainQueryBlockTermValue(row.first) : ''
      const last = row.last ? plainQueryBlockTermValue(row.last) : ''
      if (first && (firstAt === null || first < firstAt)) firstAt = first
      if (last && (lastAt === null || last > lastAt)) lastAt = last
    }
  }
  return { completed, failed, open, total: completed + failed + open, firstAt, lastAt }
}

function readLineage(result: QueryBlockResult): AgentLineage {
  let ancestor: AgentLineageLink | null = null
  const heirs: AgentLineageLink[] = []
  if (result.resultKind === 'bindings') {
    for (const row of result.rows) {
      const other = plainQueryBlockTermValue(row.other)
      if (!other) continue
      const link: AgentLineageLink = {
        iri: other,
        title: row.title ? plainQueryBlockTermValue(row.title) : null,
        status: row.status ? plainQueryBlockTermValue(row.status) : null,
      }
      if (plainQueryBlockTermValue(row.rel) === 'supersedes') ancestor = ancestor ?? link
      else if (!heirs.some((h) => h.iri === other)) heirs.push(link)
    }
  }
  return { ancestor, heirs }
}

/** Pure — the entry's life, said with its basis. The graph's own status claim wins; the runs speak only when it is silent. */
export function deriveDormancy(seat: SeatReading, stats: AgentRunStats, now: Date): { readonly dormancy: AgentDormancy; readonly basis: string } {
  const status = seat.seatStatus
  if (status === 'retired') return { dormancy: 'retired', basis: 'its source says retired' }
  if (status === 'dormant') return { dormancy: 'dormant', basis: `its source says dormant${seat.lastRunAt ? `; last run claimed ${seat.lastRunAt}` : ''}` }
  if (status === 'active') return { dormancy: 'active', basis: 'its source says active' }
  if (status === 'idle') return { dormancy: 'idle', basis: 'its source says idle' }
  // A status may be CLAIMED without being a lifecycle word: the fold maps a
  // keeper's `formationVerdict` and a house seat's own state onto `cor:status`
  // ("confident", "requests-opus-review", "minted-not-certified", "lead"), so
  // name what was claimed instead of reporting that nothing was — the first
  // live proof said "no status claimed" of a keeper whose source says
  // "confident", which is the one thing this module must never do.
  const claimed = status ? `its source claims "${status}", which says nothing about its life` : 'no status claimed'
  const last = stats.lastAt ?? seat.lastRunAt
  if (!last) return { dormancy: 'unknown', basis: `no run recorded; ${claimed}` }
  const ageDays = (now.getTime() - new Date(last).getTime()) / 86_400_000
  if (Number.isNaN(ageDays)) return { dormancy: 'unknown', basis: `last run timestamp unreadable: ${last}` }
  if (ageDays > AGENT_SILENT_AFTER_DAYS) return { dormancy: 'silent', basis: `no run in ${Math.floor(ageDays)} days (last ${last})` }
  return { dormancy: 'active', basis: `ran ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? '' : 's'} ago (${last})` }
}

/** Pure — fold the seat's reading and the two entry shapes into one entry. */
export function readAgent(seat: SeatReading, stats: QueryBlockResult, lineage: QueryBlockResult, now: Date = new Date()): AgentEntry {
  const runStats = readRunStats(stats)
  const { dormancy, basis } = deriveDormancy(seat, runStats, now)
  return {
    seat,
    runStats,
    lineage: readLineage(lineage),
    habitat: habitatOf(seat.seatKind, seat.definitions, seat.trigger),
    dormancy,
    dormancyBasis: basis,
  }
}
