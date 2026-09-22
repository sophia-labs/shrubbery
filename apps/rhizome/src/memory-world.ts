/**
 * memory-world.ts — the RHIZOME data layer over a live :projection:memory graph.
 *
 * Reads the REAL gardend cell (NO MOCKS) via GardenClient and produces the pure
 * @shrubbery/render resource shapes (PlotResource / SubjectResource). Three views:
 *
 *   - listSubjects(now)        → the PLOT rows: each subject-bed's lineage root +
 *                                its current head + active/superseded counts.
 *   - subject(rootId, asof?)   → ONE bed: the full record chain + the RESOLVED head.
 *   - plot(asof?)              → the PLOT resource (rows resolved at the lens).
 *
 * THE ?asof SUBTLETY (the design's whole point): mem:status is GLOBAL and
 * non-temporal in this store (a single mutated flag), so "what was current
 * as-of T" is RECOMPUTED from mem:createdAt + lineage-root grouping — the record
 * with the greatest createdAt ≤ T within a bed is the as-of-then head. The "now"
 * view may use status="active" as a shortcut; the as-of view MUST NOT.
 *
 * All queries are scoped to the :projection:memory named graph IRI (a query
 * without that scope returns 0 rows — verified live).
 *
 * App/tooling level — the render package never speaks SPARQL.
 */

import type {
  BouquetResource,
  BouquetStar,
  MemoryRecord,
  PlotResource,
  PlotSubject,
  SubjectResource,
} from '@shrubbery/render'
import { GardenClient, val, type SparqlRow } from './garden-client.js'
import { canonicalOf, entityLinksIri, SAME_SUBJECT_AS } from './entity-resolution.js'

const MEM = 'http://mnemosyne.dev/memory#'
const XSD_DT = 'http://www.w3.org/2001/XMLSchema#dateTime'

/** The :projection:memory named-graph IRI for a graph id (where memory records live). */
export function projectionMemoryIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:memory`
}

/** The short display id of a record IRI — the last `:record:<sha>` segment, first 12. */
export function shortId(iri: string): string {
  const parts = iri.split(':record:')
  return (parts[parts.length - 1] || iri).slice(0, 12)
}

/** As-of literal for SPARQL: an ISO date/datetime → a typed xsd:dateTime literal. */
function asofLiteral(asof: string): string {
  // Accept a bare date (2023-05-25) or a full dateTime; the cell stores full
  // dateTimes, and an xsd:dateTime comparison promotes a bare date to midnight Z.
  const dt = /T/.test(asof) ? asof : `${asof}T00:00:00Z`
  return `"${dt}"^^<${XSD_DT}>`
}

/**
 * Salient terms of a head's content — the lower-cased content tokens that carry
 * meaning (length ≥ 3, not a stop word), PLUS any time/number tokens (e.g. "25:50",
 * "5k") which are highly discriminating. Used to (a) match episodic evidence whose
 * content CONTAINS a head term and (b) decide which sibling beds are entity-links
 * (a shared salient term). Deterministic, no LLM.
 */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'their', 'they', 'them', 'this',
  'that', 'these', 'those', 'user', 'users', 'has', 'have', 'had', 'his', 'her',
  'its', 'as', 'by', 'from', 'into', 'achieved', 'working', 'specifically',
])
export function salientTerms(content: string): string[] {
  const out = new Set<string>()
  for (const raw of content.toLowerCase().split(/[^a-z0-9:]+/)) {
    const t = raw.trim()
    if (!t) continue
    // Keep time/number-ish tokens (25:50, 5k, 27:12) regardless of length.
    const timeish = /[0-9]/.test(t)
    if (timeish || (t.length >= 3 && !STOP.has(t))) out.add(t)
  }
  return [...out]
}

/** Derive a short topic label from a head's content (the headline noun phrase). */
export function topicOf(content: string): string {
  const c = content.toLowerCase()
  if (/\b5k\b/.test(c) || /personal best/.test(c)) return '5K personal best'
  if (/tennis/.test(c)) return 'tennis'
  if (/soccer/.test(c)) return 'soccer'
  if (/marathon/.test(c)) return 'marathon'
  // fallback: the first ~6 words.
  return content.split(/\s+/).slice(0, 6).join(' ')
}

export function allRecordsQuery(memGraph: string): string {
  return `PREFIX mem: <${MEM}>
SELECT ?rec ?content ?status ?kind ?created ?observed ?observer ?scope ?orient ?root
FROM <${memGraph}>
WHERE {
  ?rec a mem:MemoryRecord ;
       mem:content ?content ;
       mem:status ?status ;
       mem:createdAt ?created ;
       (mem:supersedes*) ?root .
  FILTER NOT EXISTS { ?root mem:supersedes ?x }
  OPTIONAL { ?rec mem:kind ?kind }
  OPTIONAL { ?rec mem:observedAt ?observed }
  OPTIONAL { ?rec mem:observer ?observer }
  OPTIONAL { ?rec mem:scope ?scope }
  OPTIONAL { ?rec mem:contentOrientation ?orient }
}
ORDER BY ?root DESC(?created)`
}

export function evidenceForQuery(memGraph: string, terms: readonly string[], limit = 3): string | null {
  if (terms.length === 0) return null
  const escaped = terms.map((t) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
  const disj = escaped.map((t) => `CONTAINS(LCASE(STR(?content)), "${t}")`).join(' || ')
  return `PREFIX mem: <${MEM}>
SELECT ?rec ?content ?status ?kind ?created ?observed ?observer ?scope ?orient
FROM <${memGraph}>
WHERE {
  ?rec a mem:MemoryRecord ;
       mem:kind ?kind ;
       mem:content ?content .
  FILTER(CONTAINS(STR(?kind), "Episode"))
  FILTER(${disj})
  OPTIONAL { ?rec mem:status ?status }
  OPTIONAL { ?rec mem:createdAt ?created }
  OPTIONAL { ?rec mem:observedAt ?observed }
  OPTIONAL { ?rec mem:observer ?observer }
  OPTIONAL { ?rec mem:scope ?scope }
  OPTIONAL { ?rec mem:contentOrientation ?orient }
}
LIMIT ${limit}`
}

export function memoryRecordFromSparqlRow(
  r: SparqlRow,
  rootByRecord?: Map<string, string>,
): MemoryRecord {
  const id = val(r, 'rec') ?? ''
  const root = val(r, 'root')
  if (root) rootByRecord?.set(id, root)
  const observer = val(r, 'observer')
  return {
    id,
    localId: shortId(id),
    content: val(r, 'content') ?? '',
    status: val(r, 'status') ?? '',
    kind: val(r, 'kind'),
    createdAt: val(r, 'created'),
    observedAt: val(r, 'observed'),
    ...(observer ? { observer } : {}),
    scope: val(r, 'scope'),
    contentOrientation: val(r, 'orient'),
  }
}

export class MemoryWorld {
  private readonly memGraph: string
  private readonly linksGraph: string

  constructor(
    private readonly client: GardenClient,
    private readonly graphId: string,
  ) {
    this.memGraph = projectionMemoryIri(graphId)
    this.linksGraph = entityLinksIri(graphId)
  }

  /** Fetch every record in the projection (the raw chain data, one query). */
  async allRecords(): Promise<MemoryRecord[]> {
    const rows = await this.client.select(this.graphId, allRecordsQuery(this.memGraph))
    return rows.map((r) => this.toRecord(r))
  }

  /** Fetch the `mem:supersedes` edges (record → the record it supersedes). */
  private async supersedesEdges(): Promise<Map<string, string>> {
    const q = `PREFIX mem: <${MEM}>
SELECT ?rec ?sup
FROM <${this.memGraph}>
WHERE { ?rec mem:supersedes ?sup }`
    const rows = await this.client.select(this.graphId, q)
    const m = new Map<string, string>()
    for (const r of rows) {
      const rec = val(r, 'rec')
      const sup = val(r, 'sup')
      if (rec && sup) m.set(rec, sup)
    }
    return m
  }

  /**
   * Read the `mem:sameSubjectAs` edges from the NON-RESERVED :entity-links sidecar
   * (member record IRI → canonical record IRI). The entity-resolution merge layer
   * writes these; the read collapse below UNIONs the linked records into one bed.
   * With NO edges (e.g. 6a1eabeb-agentic) this returns [] → collapse is a no-op.
   */
  private async sameSubjectEdges(): Promise<Array<[string, string]>> {
    const q = `SELECT ?from ?to
FROM <${this.linksGraph}>
WHERE { ?from <${SAME_SUBJECT_AS}> ?to }`
    const rows = await this.client.select(this.graphId, q)
    const out: Array<[string, string]> = []
    for (const r of rows) {
      const from = val(r, 'from')
      const to = val(r, 'to')
      if (from && to) out.push([from, to])
    }
    return out
  }

  /**
   * Group records into subject beds, with the ENTITY-RESOLUTION COLLAPSE applied.
   *
   * First each record is placed in its LINEAGE bed (keyed by its lineage-root, as
   * before). Then the `mem:sameSubjectAs` edges from the sidecar UNION the lineage
   * beds whose records they link into ONE logical bed (a fragmented subject becomes
   * a single bed). Each collapsed bed is keyed by the lineage-root of its CANONICAL
   * record (newest createdAt) so the bed's URL key tracks its head, and its records
   * are re-sorted newest-first across the whole union (head = newest createdAt; the
   * rest are predecessors / soil).
   *
   * NO edges → no unions → behaviour is byte-identical to the pre-merge model.
   */
  private async beds(): Promise<Map<string, { rootIri: string; records: MemoryRecord[] }>> {
    const [records, edges, sameSubject] = await Promise.all([
      this.allRecords(),
      this.supersedesEdges(),
      this.sameSubjectEdges(),
    ])
    // re-attach the supersedes edge (allRecords() projects root, not the direct edge).
    for (const r of records) {
      const sup = edges.get(r.id)
      if (sup) (r as { supersedes?: string }).supersedes = sup
    }
    // 1) the LINEAGE beds (keyed by lineage-root short id), as before.
    const byRoot = new Map<string, { rootIri: string; records: MemoryRecord[] }>()
    const bedKeyOfRecord = new Map<string, string>()
    for (const r of records) {
      const rootIri = this.rootByRecord.get(r.id) ?? r.id
      const key = shortId(rootIri)
      bedKeyOfRecord.set(r.id, key)
      let bed = byRoot.get(key)
      if (!bed) byRoot.set(key, (bed = { rootIri, records: [] }))
      bed.records.push(r)
    }
    // 2) the COLLAPSE: union the bed keys linked by sameSubjectAs (union-find).
    if (sameSubject.length > 0) {
      const parent = new Map<string, string>()
      const find = (k: string): string => {
        let root = k
        while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!
        return root
      }
      const union = (a: string, b: string): void => {
        const ra = find(a)
        const rb = find(b)
        if (ra !== rb) parent.set(ra, rb)
      }
      for (const key of byRoot.keys()) if (!parent.has(key)) parent.set(key, key)
      for (const [from, to] of sameSubject) {
        const kf = bedKeyOfRecord.get(from)
        const kt = bedKeyOfRecord.get(to)
        // Only union beds that actually exist in the projection (a stray edge whose
        // endpoints are not memory records — e.g. a leftover probe — is ignored).
        if (kf && kt && byRoot.has(kf) && byRoot.has(kt)) union(kf, kt)
      }
      // 3) coalesce each union group into one super-bed, re-keyed by its canonical.
      const groups = new Map<string, { rootIri: string; records: MemoryRecord[] }>()
      for (const [key, bed] of byRoot) {
        const g = find(key)
        let acc = groups.get(g)
        if (!acc) groups.set(g, (acc = { rootIri: bed.rootIri, records: [] }))
        acc.records.push(...bed.records)
      }
      // pick each group's stable key = the lineage-bed of its CANONICAL record.
      const collapsed = new Map<string, { rootIri: string; records: MemoryRecord[] }>()
      for (const [g, acc] of groups) {
        acc.records.sort((a, b) => this.headOrder(b, a))
        const canon = canonicalOf(
          acc.records.map((r) => ({
            iri: r.id,
            localId: r.localId,
            content: r.content,
            status: r.status,
            createdAt: r.createdAt ?? '',
          })),
        )
        const canonKey = canon ? (bedKeyOfRecord.get(canon.iri) ?? g) : g
        collapsed.set(canonKey, {
          rootIri: this.rootByRecord.get(canon?.iri ?? '') ?? acc.rootIri,
          records: acc.records,
        })
      }
      return collapsed
    }
    // newest createdAt first within each (un-collapsed) bed.
    for (const bed of byRoot.values()) {
      bed.records.sort((a, b) => this.headOrder(b, a))
    }
    return byRoot
  }

  /**
   * The total order used to put a bed's HEAD first (newest createdAt → concrete
   * attribute value → IRI). Mirrors entity-resolution `canonicalOf` so the collapsed
   * head agrees with the merge canonical (e.g. 25:50 wins over the same-day goal).
   * Returns >0 when `a` should sort before `b`.
   */
  private headOrder(a: MemoryRecord, b: MemoryRecord): number {
    const byCreated = (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    if (byCreated !== 0) return byCreated
    const av = /\d{1,2}:\d{2}/.test(a.content) ? 1 : 0
    const bv = /\d{1,2}:\d{2}/.test(b.content) ? 1 : 0
    if (av !== bv) return av - bv
    return a.id.localeCompare(b.id)
  }

  private readonly rootByRecord = new Map<string, string>()

  private toRecord(r: SparqlRow): MemoryRecord {
    return memoryRecordFromSparqlRow(r, this.rootByRecord)
  }

  /**
   * Resolve the current-as-of head of a bed.
   *   - asof null → the mem:status="active" record (the NOW shortcut).
   *   - asof T    → the record with the greatest createdAt ≤ T (RECOMPUTED;
   *                 the status flag is ignored — the design's whole point).
   * Records are assumed newest-first. Returns the head record, or undefined for
   * an empty bed / a T before the bed's earliest record.
   */
  static resolveHead(records: readonly MemoryRecord[], asof: string | null): MemoryRecord | undefined {
    if (records.length === 0) return undefined
    if (!asof) {
      return records.find((r) => r.status === 'active') ?? records[0]
    }
    const t = /T/.test(asof) ? asof : `${asof}T00:00:00Z`
    // records are newest-first; the first with createdAt ≤ T is the as-of head.
    const eligible = records.filter((r) => (r.createdAt ?? '') <= t)
    if (eligible.length === 0) return undefined
    return eligible.reduce((best, r) =>
      (r.createdAt ?? '') > (best.createdAt ?? '') ? r : best,
    )
  }

  /** The PLOT resource — one row per subject-bed, heads resolved at the lens. */
  async plot(asof: string | null = null): Promise<PlotResource> {
    const beds = await this.beds()
    const subjects: PlotSubject[] = []
    for (const [rootId, bed] of [...beds.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const head = MemoryWorld.resolveHead(bed.records, asof)
      const activeCount = bed.records.filter((r) => r.status === 'active').length
      const supersededCount = bed.records.filter((r) => r.status === 'superseded').length
      subjects.push({
        rootId,
        topic: topicOf(head?.content ?? bed.records[0]?.content ?? rootId),
        headContent: head?.content ?? '(no record as-of this date)',
        head: head?.localId ?? '',
        recordTotal: bed.records.length,
        activeCount,
        supersededCount,
      })
    }
    return {
      kind: 'mem-plot',
      id: 'memory',
      title: 'Rhizome — memory observatory',
      summary: `The :projection:memory of graph \`${this.graphId}\` — its subject-beds, each a lineage chain (current head + superseded predecessors). Read-only; rendered live from the cell. Add \`?asof=YYYY-MM-DD\` to recompute the heads as-of a date (from mem:createdAt, NOT the mutated status flag).`,
      asOf: asof,
      subjects,
    }
  }

  /** ONE subject-bed — the full record chain + the head resolved at the lens. */
  async subject(rootId: string, asof: string | null = null): Promise<SubjectResource | null> {
    const beds = await this.beds()
    const bed = beds.get(rootId)
    if (!bed) return null
    const head = MemoryWorld.resolveHead(bed.records, asof)
    return {
      kind: 'mem-subject',
      rootId,
      title: `Subject — ${topicOf(head?.content ?? bed.records[0]?.content ?? rootId)}`,
      topic: topicOf(head?.content ?? bed.records[0]?.content ?? rootId),
      asOf: asof,
      head: head?.localId ?? '',
      records: bed.records,
    }
  }

  /**
   * Fetch the episodic-floor EVIDENCE for a head — EpisodeMemory records whose
   * content CONTAINS one of the head's salient terms (the minimal verbatim floor
   * the belief rests on). A genuine query against the live cell (NO MOCK): in a
   * cell with no episodic floor it returns an empty list (honest absence, never a
   * faked fragment). Capped at `limit` fragments, longest-match-richness first.
   */
  private async evidenceFor(head: MemoryRecord, limit = 3): Promise<MemoryRecord[]> {
    const terms = salientTerms(head.content)
    // Build a CONTAINS disjunction over the salient terms (escaped for a SPARQL
    // string literal). Scope to EpisodeMemory (the episodic floor) + exclude the
    // head itself. The head's own lineage is NOT episodic, so this never returns it.
    const q = evidenceForQuery(this.memGraph, terms, limit)
    if (!q) return []
    const rows = await this.client.select(this.graphId, q)
    return rows.map((r) => this.toRecord(r))
  }

  /**
   * THE BOUQUET — the READ-side constellation that blooms when a belief (a bed) is
   * opened. Assembled DETERMINISTICALLY from :projection:memory (no LLM):
   *   - the bright CURRENT head (the answer; as-of-resolved),
   *   - the dimmed dated STRUCK predecessors (resolved conflicts the head superseded),
   *   - the STANDING dispositions about the same subject (here: durable, non-
   *     superseded sibling facts in the same scope — the floor of traits),
   *   - the ENTITY links (sibling beds whose head shares a salient term),
   *   - the GOTCHAS (do-not-strike markers — e.g. an EpisodeMemory/Event fragment
   *     that grounds the belief and must NOT be superseded),
   *   - the minimal verbatim EVIDENCE (episodic fragments carrying a head term),
   * each annotated with WHY it earned its place. `?asof` recomputes the head from
   * mem:createdAt — the same temporal lens the Plot uses (reuse resolveHead). NULL
   * for an unknown bed (the host surfaces a 404).
   */
  async bouquet(rootId: string, asof: string | null = null): Promise<BouquetResource | null> {
    const beds = await this.beds()
    const bed = beds.get(rootId)
    if (!bed) return null
    const head = MemoryWorld.resolveHead(bed.records, asof)
    if (!head) return null

    // The struck predecessors of THIS bed (everything in the chain that is not the
    // resolved head) — the resolved conflicts.
    const predecessors = bed.records.filter((r) => r.localId !== head.localId)

    // The entity links — OTHER beds whose resolved head shares a salient term with
    // this head (the same subject, seen from another belief). Deterministic overlap.
    const headTerms = new Set(salientTerms(head.content))
    const entityLinks: BouquetStar[] = []
    const dispositions: MemoryRecord[] = []
    for (const [otherRoot, otherBed] of beds) {
      if (otherRoot === rootId) continue
      const otherHead = MemoryWorld.resolveHead(otherBed.records, asof)
      if (!otherHead) continue
      const shared = salientTerms(otherHead.content).filter((t) => headTerms.has(t))
      if (shared.length > 0) {
        entityLinks.push({
          why: 'entity-link',
          record: otherHead,
          note: `shares term \`${shared[0]}\` with this belief`,
        })
      } else if (otherHead.scope === head.scope && head.scope) {
        // A same-scope sibling that does NOT share a term is a STANDING disposition
        // about the same subject (the user) — a durable trait, not a rival belief.
        dispositions.push(otherHead)
      }
    }

    // The episodic EVIDENCE floor (a genuine live query; empty when no floor exists).
    const evidence = await this.evidenceFor(head)

    // GOTCHAS — a do-not-strike marker: an episodic/Event fragment that grounds the
    // belief and must NOT be superseded (it is the floor, not a rival belief). We
    // mark the evidence fragments as gotchas when they carry an Event-like kind, so
    // a reader knows not to strike them in a future write. Honest: empty when none.
    const gotchas: BouquetStar[] = evidence
      .filter((e) => /Event/i.test(e.kind ?? ''))
      .map((e) => ({
        why: 'gotcha' as const,
        record: e,
        note: 'an Event fragment — must NOT be superseded (it is the grounding floor)',
      }))

    // The WHOLE bloom — every annotated star, in render order: the answer first,
    // then the resolved conflicts, the standing dispositions, the entity links, the
    // gotchas, and the evidence floor (the configuration, never one row).
    const stars: BouquetStar[] = [
      { why: 'current', record: head, note: asof ? `head as-of ${asof}` : 'the current head' },
      ...predecessors.map(
        (r): BouquetStar => ({ why: 'resolved-conflict', record: r, note: 'superseded by the head' }),
      ),
      ...dispositions.map(
        (r): BouquetStar => ({ why: 'standing', record: r, note: 'a durable trait about the same subject' }),
      ),
      ...entityLinks,
      ...gotchas,
      ...evidence.map(
        (r): BouquetStar => ({ why: 'evidence', record: r, note: 'an episodic fragment grounding the head' }),
      ),
    ]

    return {
      kind: 'mem-bouquet',
      rootId,
      title: `Bouquet — ${topicOf(head.content)}`,
      topic: topicOf(head.content),
      asOf: asof,
      currentHead: head,
      predecessors,
      dispositions,
      entityLinks,
      gotchas,
      evidence,
      stars,
      // The DETERMINISTIC read verdict: a lineage-head resolution (the default
      // subject read). A question-driven bloom (the optional stretch) would carry a
      // captured ClassifyQueryShape verdict + gate→fuse here.
      retrieval: {
        queryShape: 'lineage-head',
      },
    }
  }

  /** The list of bed root ids (for route generation). */
  async subjectIds(): Promise<string[]> {
    const beds = await this.beds()
    return [...beds.keys()].sort()
  }

  /**
   * The DISTINCT-SUBJECT METER for an entity attribute — how many distinct beds
   * mention it AFTER the entity-resolution collapse, against a target of 1.
   *
   * `entity` is a content substring/regex-source naming the attribute (e.g. "5k",
   * "tennis"); a bed counts if its CURRENT head (now-resolved) carries the term.
   * Pre-merge the 5K subject is fragmented across 3 beds → count 3 (RED, the
   * problem); after a merge collapses them → count 1 (GREEN, the goal). `target`
   * is 1 by default (one subject should be one bed).
   */
  async distinctSubjectMeter(
    entity: string,
    target = 1,
  ): Promise<{ entity: string; count: number; target: number; green: boolean; rootIds: string[] }> {
    const beds = await this.beds()
    const re = new RegExp(entity, 'i')
    const rootIds: string[] = []
    for (const [rootId, bed] of beds) {
      const head = MemoryWorld.resolveHead(bed.records, null)
      // a bed counts if ANY of its (collapsed) records carries the term — so the
      // meter reflects the subject's spread, not just whichever record won the head.
      const hit = head && (re.test(head.content) || bed.records.some((r) => re.test(r.content)))
      if (hit) rootIds.push(rootId)
    }
    rootIds.sort()
    return { entity, count: rootIds.length, target, green: rootIds.length <= target, rootIds }
  }
}

/** Convenience: a MemoryWorld bound to a live cell + graph (env-overridable). */
export function makeMemoryWorld(graphId: string, client = new GardenClient()): MemoryWorld {
  return new MemoryWorld(client, graphId)
}

export { asofLiteral }
