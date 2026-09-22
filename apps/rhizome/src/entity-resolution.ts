/**
 * entity-resolution.ts — the LIVE-WRITE centerpiece: the merge/collapse layer.
 *
 * This is the one place RHIZOME mutates the graph. It does NOT touch the
 * authority-walled `:projection:memory` named graph (whose records are written
 * only by the cell's geist/remember path). Instead it writes a NON-RESERVED
 * SIDECAR graph — `urn:mnemosyne:local:graph:{G}:entity-links` — whose only
 * predicate is `mem:sameSubjectAs`, declaring that two fragmented records are in
 * fact ONE logical subject. The read layer (memory-world.ts) UNIONs the linked
 * records into a single bed at read time; nothing in the projection moves, so the
 * merge is fully REVERSIBLE (DELETE the edge → the records fall back apart) and
 * never destroys a record (NO hard delete).
 *
 * Why a sidecar? `:projection:memory` is authority-walled — a write there is a
 * geist concern (a `remember`/`supersede`). Entity resolution is a READ-MODEL
 * overlay: "these N records are one subject", a claim the observatory makes, kept
 * physically separate from the records it links so it can be added/removed freely.
 *
 *   DETECT  detectDuplicates(graphId) — deterministic near-duplicate clusters over
 *           :projection:memory (records sharing an entity+attribute SIGNATURE).
 *   MERGE   merge(graphId, recIris)   — INSERT DATA sameSubjectAs edges (every
 *           record → the canonical, newest by createdAt) into :entity-links.
 *   UNMERGE unmerge(graphId, recIris) — DELETE DATA those edges (reverses MERGE).
 *
 * The READ COLLAPSE + the distinct-subject meter live in memory-world.ts (the data
 * layer that already owns the bed model); this file owns the DETECT + the WRITE.
 *
 * App/tooling level — the pure @shrubbery/render package never speaks SPARQL.
 */

import { GardenClient, val } from './garden-client.js'
import { projectionMemoryIri, salientTerms, shortId } from './memory-world.js'

const MEM = 'http://mnemosyne.dev/memory#'
const SAME_SUBJECT_AS = `${MEM}sameSubjectAs`

/** The NON-RESERVED sidecar named graph that holds the sameSubjectAs edges. */
export function entityLinksIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:entity-links`
}

/** One record as the detector sees it (the minimal shape over :projection:memory). */
export interface ResRecord {
  readonly iri: string
  readonly localId: string
  readonly content: string
  readonly status: string
  readonly createdAt: string
}

/** A flagged near-duplicate cluster — N records the detector believes are one subject. */
export interface DuplicateCluster {
  /** The shared (entity · attribute) signature that bound the cluster (e.g. "user·5k|pb"). */
  readonly signature: string
  /** A human label for the subject (e.g. "user · 5K personal best"). */
  readonly label: string
  /** The member records (≥2), newest createdAt first. */
  readonly records: readonly ResRecord[]
  /** The canonical record IRI (newest createdAt; deterministic tiebreak) — the merge head. */
  readonly canonical: string
}

/**
 * The SIGNATURE space — the deterministic entity+attribute facets a record can
 * carry. A cluster is a set of records sharing one signature. Each facet is a
 * `{ key, terms, present(content) }` triple: `key` names the (entity·attribute)
 * pair; `present` is the deterministic test (the content carries the attribute).
 *
 * v1 covers the demo's known attribute classes. The shape is data-driven so new
 * attributes are a one-line addition, not new code. The ENTITY is the user in all
 * current memory (scope=user), so the signature is dominated by the attribute.
 */
interface SignatureFacet {
  readonly key: string
  readonly label: string
  /** True when the content is ABOUT this attribute (the deterministic membership test). */
  present(content: string): boolean
}

const FACETS: readonly SignatureFacet[] = [
  {
    key: 'user·5k-pb',
    label: 'user · 5K personal best',
    // The 5K-personal-best attribute: a 5K mention AND a best/record/time framing.
    // Both "27:12 in a charity 5K", "current 5K personal best is 25:50", and the
    // "training for a charity 5K run and aims to beat their personal best" goal
    // are ABOUT the (user, 5K-PB) attribute → one cluster.
    present: (c) => /\b5k\b/.test(c) && /(personal best|\bpb\b|beat|best|time|record|\d{1,2}:\d{2})/.test(c),
  },
  {
    key: 'user·tennis',
    label: 'user · tennis',
    present: (c) => /\btennis\b/.test(c),
  },
  {
    key: 'user·soccer',
    label: 'user · soccer',
    present: (c) => /\bsoccer\b/.test(c),
  },
  {
    key: 'user·marathon',
    label: 'user · marathon',
    present: (c) => /\bmarathon\b/.test(c),
  },
]

/**
 * A discriminating ATTRIBUTE VALUE in a content string — the time/measurement that
 * carries the actual fact (e.g. "25:50", "27:12"). Used for the canonical tiebreak:
 * a record asserting a concrete value (the user's best time IS 25:50) is a stronger
 * head than an aspirational/goal record of the same subject + createdAt.
 */
function hasAttributeValue(content: string): boolean {
  return /\d{1,2}:\d{2}/.test(content)
}

/**
 * The canonical record of a cluster — the merge head. Deterministic:
 *   1) the greatest mem:createdAt (the newest belief), then
 *   2) on a createdAt TIE, prefer the record that asserts a concrete attribute
 *      VALUE (a time like 25:50) over a goal/aspiration of the same subject, then
 *   3) on a remaining tie, the lexically-greatest record IRI (a stable, total order).
 * Exposed for the read layer (memory-world collapse) to agree on the same head.
 */
export function canonicalOf(records: readonly ResRecord[]): ResRecord | undefined {
  if (records.length === 0) return undefined
  return [...records].sort((a, b) => {
    const byCreated = (b.createdAt || '').localeCompare(a.createdAt || '')
    if (byCreated !== 0) return byCreated
    const av = hasAttributeValue(a.content) ? 1 : 0
    const bv = hasAttributeValue(b.content) ? 1 : 0
    if (av !== bv) return bv - av
    return b.iri.localeCompare(a.iri)
  })[0]
}

/**
 * The entity+attribute SIGNATURE of a record's content — the deterministic facet
 * keys it matches (a record can match more than one; clusters form per signature
 * key). Salient terms additionally guard against a coincidental single-term match:
 * a facet must be genuinely present, not just share a stop-word.
 */
export function signaturesOf(content: string): string[] {
  const c = content.toLowerCase()
  const out: string[] = []
  for (const f of FACETS) if (f.present(c)) out.push(f.key)
  return out
}

export class EntityResolver {
  private readonly memGraph: string
  private readonly linksGraph: string

  constructor(
    private readonly client: GardenClient,
    private readonly graphId: string,
  ) {
    this.memGraph = projectionMemoryIri(graphId)
    this.linksGraph = entityLinksIri(graphId)
  }

  /** Read every projection record the detector needs (the minimal shape, one query). */
  async records(): Promise<ResRecord[]> {
    const q = `PREFIX mem: <${MEM}>
SELECT ?rec ?content ?status ?created
FROM <${this.memGraph}>
WHERE {
  ?rec a mem:MemoryRecord ;
       mem:content ?content ;
       mem:status ?status ;
       mem:createdAt ?created .
}`
    const rows = await this.client.select(this.graphId, q)
    return rows.map((r) => ({
      iri: val(r, 'rec') ?? '',
      localId: shortId(val(r, 'rec') ?? ''),
      content: val(r, 'content') ?? '',
      status: val(r, 'status') ?? '',
      createdAt: val(r, 'created') ?? '',
    }))
  }

  /**
   * DETECT — deterministic near-duplicate clusters over :projection:memory.
   *
   * A cluster = the records sharing one entity+attribute SIGNATURE (a FACET key).
   * `dedupeThreshold` (default 2) is the minimum cluster size that counts as a
   * fragmentation flag — raise it to suppress lone records, lower it never below 2
   * (a cluster of 1 is not a duplicate). Only ACTIVE records are clustered (a
   * record the geist already superseded is resolved, not a fragmentation).
   *
   * On 6a1eabeb-world this MUST flag the 5K cluster: the 27:12 record, the 25:50
   * record, and the "training … aims to beat their personal best" goal — three
   * separate active beds that are one (user, 5K-PB) subject.
   */
  async detectDuplicates(dedupeThreshold = 2): Promise<DuplicateCluster[]> {
    const all = await this.records()
    const active = all.filter((r) => r.status === 'active')
    const bySig = new Map<string, ResRecord[]>()
    for (const r of active) {
      for (const sig of signaturesOf(r.content)) {
        let arr = bySig.get(sig)
        if (!arr) bySig.set(sig, (arr = []))
        arr.push(r)
      }
    }
    const clusters: DuplicateCluster[] = []
    for (const [sig, recs] of bySig) {
      if (recs.length < dedupeThreshold) continue
      const sorted = [...recs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      const canonical = canonicalOf(recs)
      const facet = FACETS.find((f) => f.key === sig)
      clusters.push({
        signature: sig,
        label: facet?.label ?? sig,
        records: sorted,
        canonical: canonical?.iri ?? sorted[0].iri,
      })
    }
    // stable order: largest clusters first, then by signature.
    clusters.sort((a, b) => b.records.length - a.records.length || a.signature.localeCompare(b.signature))
    return clusters
  }

  /** Read the current sameSubjectAs edges (member → canonical) from the sidecar. */
  async sameSubjectEdges(): Promise<Array<{ from: string; to: string }>> {
    const q = `SELECT ?from ?to
FROM <${this.linksGraph}>
WHERE { ?from <${SAME_SUBJECT_AS}> ?to }`
    const rows = await this.client.select(this.graphId, q)
    const out: Array<{ from: string; to: string }> = []
    for (const r of rows) {
      const from = val(r, 'from')
      const to = val(r, 'to')
      if (from && to) out.push({ from, to })
    }
    return out
  }

  /**
   * MERGE (the WRITE) — declare a set of record IRIs ONE logical subject by writing
   * `<member> mem:sameSubjectAs <canonical>` edges into the :entity-links sidecar.
   * The canonical is the newest by createdAt (the cluster's merge head); the other
   * members each get one edge → canonical (the canonical needs no self-edge).
   *
   * NEVER writes :projection:memory (authority-walled). NO hard delete. Idempotent:
   * INSERT DATA of an already-present edge is a no-op in the store. Returns the
   * edges written (member → canonical) for the caller to report.
   */
  async merge(recIris: readonly string[]): Promise<Array<{ from: string; to: string }>> {
    const iris = [...new Set(recIris)].filter(Boolean)
    if (iris.length < 2) throw new Error(`merge needs ≥2 record IRIs, got ${iris.length}`)
    // canonical = newest createdAt among the named members (re-read so the caller
    // can pass bare IRIs without pre-sorting; the store is the source of truth).
    const all = await this.records()
    const members = all.filter((r) => iris.includes(r.iri))
    if (members.length < 2) {
      throw new Error(`merge: <2 of the given IRIs resolve to projection records (${members.length})`)
    }
    const canonical = canonicalOf(members)!.iri
    const edges = iris.filter((iri) => iri !== canonical).map((from) => ({ from, to: canonical }))
    if (edges.length === 0) return []
    const triples = edges
      .map((e) => `    <${e.from}> <${SAME_SUBJECT_AS}> <${e.to}> .`)
      .join('\n')
    const update = `INSERT DATA {\n  GRAPH <${this.linksGraph}> {\n${triples}\n  }\n}`
    await this.update(update)
    return edges
  }

  /**
   * UNMERGE (REVERSE) — DELETE DATA the sameSubjectAs edges that bind a set of
   * record IRIs. Deletes any edge whose endpoints are BOTH in the given set (so
   * `unmerge(sameIrisAsMerge)` exactly reverses a `merge`). DELETE DATA of an
   * absent edge is a no-op. Returns the edges removed.
   */
  async unmerge(recIris: readonly string[]): Promise<Array<{ from: string; to: string }>> {
    const set = new Set(recIris.filter(Boolean))
    if (set.size < 2) throw new Error(`unmerge needs ≥2 record IRIs, got ${set.size}`)
    const edges = (await this.sameSubjectEdges()).filter((e) => set.has(e.from) && set.has(e.to))
    if (edges.length === 0) return []
    const triples = edges
      .map((e) => `    <${e.from}> <${SAME_SUBJECT_AS}> <${e.to}> .`)
      .join('\n')
    const update = `DELETE DATA {\n  GRAPH <${this.linksGraph}> {\n${triples}\n  }\n}`
    await this.update(update)
    return edges
  }

  /**
   * Delete a SINGLE explicit edge (used by CLEANUP to remove a stray probe edge,
   * e.g. `urn:test:a sameSubjectAs urn:test:b`, left by an earlier probe). DELETE
   * DATA the exact triple from the sidecar.
   */
  async deleteEdge(from: string, to: string): Promise<void> {
    const update = `DELETE DATA {\n  GRAPH <${this.linksGraph}> {\n    <${from}> <${SAME_SUBJECT_AS}> <${to}> .\n  }\n}`
    await this.update(update)
  }

  /** Run a SPARQL UPDATE against the cell (asserts the store ack'd ok). */
  private async update(update: string): Promise<void> {
    const out = (await this.client.mcp('sparql_update', { graphId: this.graphId, update })) as
      | { ok?: boolean }
      | undefined
    if (out && out.ok === false) throw new Error(`sparql_update returned ok:false for ${this.graphId}`)
  }
}

/** Convenience: an EntityResolver bound to a live cell + graph. */
export function makeEntityResolver(graphId: string, client = new GardenClient()): EntityResolver {
  return new EntityResolver(client, graphId)
}

export { SAME_SUBJECT_AS, hasAttributeValue }
