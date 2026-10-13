/**
 * cuenta-reading.ts — the PURE reading of one bead (`cta:Cuenta`) for el
 * Despacho (plans/2026-09-15-despacho-design.md §7): the three fixed SPARQL
 * shapes the `card.cuenta` face runs, and the pure fold of their real result
 * rows into one `CuentaReading` the view renders and the verb planner
 * restates.
 *
 * Data-only: no DOM, no network. The cuentas vocabulary (v0.2.0, the active
 * `chm:DomainOntology` in sophia-cluster's chamber) is transcribed here as
 * constants — predicate IRIs, the multi-valued set, the edge set — because
 * this codebase has no runtime CURIE registry (card-subject-face.ts's own
 * header) and a planner that restates a bead must know which predicates are
 * lists. Ready is COMPUTED, never stored (the contract's own rule): open with
 * every `needs`/`gatedBy` target done.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'

export const CTA_NS = 'http://mnemosyne.dev/cuentas#'
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

export const CUENTA_EDGE_PREDICATES = ['needs', 'gatedBy', 'partOf', 'discoveredFrom', 'supersedes'] as const
export type CuentaEdgeKind = (typeof CUENTA_EDGE_PREDICATES)[number]

/** The `multi: true` predicates of the cuentas contract — restated as JSON arrays, never joined. */
export const CUENTA_MULTI_PREDICATES: ReadonlySet<string> = new Set(['needs', 'gatedBy', 'evidence'])
/** The `datatype: integer` predicates — restated as JSON numbers so SHACL sees an integer. */
export const CUENTA_INTEGER_PREDICATES: ReadonlySet<string> = new Set(['priority'])

export const CUENTA_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'composted'] as const
export type CuentaStatus = (typeof CUENTA_STATUSES)[number]
export const CUENTA_BEAD_KINDS = ['campaign', 'wave', 'task', 'gate'] as const
export type CuentaBeadKind = (typeof CUENTA_BEAD_KINDS)[number]

export interface CuentaEdge {
  readonly edge: CuentaEdgeKind
  readonly target: string
  /** The target's `cta:title`, when the target is itself a bead in the graph; null = unknown. */
  readonly title: string | null
  readonly status: string | null
}

export interface CuentaRendicion {
  readonly iri: string
  readonly verdict: string
  readonly witness: string
  readonly summary: string
  readonly renderedAt: string | null
  /** cuentas v0.2.0: the substance of a word that closed a gate. */
  readonly word: string | null
  /** cuentas v0.2.0: the words themselves, verbatim. */
  readonly utterance: string | null
  readonly evidence: readonly string[]
}

export interface CuentaReading {
  readonly subject: string
  /** False when the subject has no triples at all — the view says so, never a blank bead. */
  readonly found: boolean
  /** The cuentas local id (the segment after `:cuenta:`), or null when the subject is not a cuentas bead IRI. */
  readonly localId: string | null
  /** Every predicate → plain values, exactly as read (the planner restates from this). */
  readonly props: Readonly<Record<string, readonly string[]>>
  readonly title: string
  readonly beadKind: string | null
  readonly status: string | null
  readonly owner: string | null
  readonly venue: string | null
  readonly priority: number | null
  readonly note: string | null
  readonly createdAt: string | null
  readonly evidence: readonly string[]
  readonly edges: readonly CuentaEdge[]
  readonly rendiciones: readonly CuentaRendicion[]
  /** open ∧ every needs/gatedBy target is done (an unknown target status counts as NOT done — honest). */
  readonly ready: boolean
}

/** The row cap shared by the three shapes — mirrors the sibling query faces' `SERVICE_MAX_ROWS`. */
export const CUENTA_MAX_ROWS = 500

function iri(subject: string): string {
  return `<${subject}>`
}

/** `SELECT ?p ?o` over every named graph — the same cross-graph-safe shape card.subject uses. */
export function cuentaPropertiesQuery(subject: string): string {
  return `SELECT ?p ?o WHERE { GRAPH ?g { ${iri(subject)} ?p ?o } } LIMIT ${CUENTA_MAX_ROWS}`
}

/** The bead's outgoing edges, each with its target's own title/status when the target is a bead. */
export function cuentaEdgesQuery(subject: string): string {
  const values = CUENTA_EDGE_PREDICATES.map((p) => `<${CTA_NS}${p}>`).join(' ')
  return (
    `SELECT ?p ?target ?ttitle ?tstatus WHERE { ` +
    `GRAPH ?g { ${iri(subject)} ?p ?target . VALUES ?p { ${values} } } ` +
    `OPTIONAL { GRAPH ?g2 { ?target <${CTA_NS}title> ?ttitle ; <${CTA_NS}status> ?tstatus } } ` +
    `} LIMIT ${CUENTA_MAX_ROWS}`
  )
}

/** Every Rendición rendered FOR this bead, oldest first (an unstamped renderedAt sorts first — it is older testimony by convention). */
export function cuentaRendicionesQuery(subject: string): string {
  return (
    `SELECT ?r ?verdict ?witness ?summary ?renderedAt ?word ?utterance ?evidence WHERE { ` +
    `GRAPH ?g { ?r <${CTA_NS}forCuenta> ${iri(subject)} ; <${CTA_NS}verdict> ?verdict ; <${CTA_NS}witness> ?witness ; <${CTA_NS}summary> ?summary . ` +
    `OPTIONAL { ?r <${CTA_NS}renderedAt> ?renderedAt } OPTIONAL { ?r <${CTA_NS}word> ?word } ` +
    `OPTIONAL { ?r <${CTA_NS}utterance> ?utterance } OPTIONAL { ?r <${CTA_NS}evidence> ?evidence } } ` +
    `} ORDER BY ?renderedAt ?r LIMIT ${CUENTA_MAX_ROWS}`
  )
}

/** The cuentas local id of a bead subject, or null when the IRI is not shaped `…:cuenta:<localId>`. */
export function cuentaLocalId(subject: string): string | null {
  const marker = ':cuenta:'
  const at = subject.lastIndexOf(marker)
  if (at < 0) return null
  const local = subject.slice(at + marker.length)
  return local.length > 0 ? local : null
}

function groupProperties(result: QueryBlockResult): Record<string, string[]> {
  const byPredicate: Record<string, string[]> = {}
  if (result.resultKind !== 'bindings') return byPredicate
  for (const row of result.rows) {
    const predicate = plainQueryBlockTermValue(row.p)
    if (!predicate) continue
    const values = byPredicate[predicate] ?? (byPredicate[predicate] = [])
    values.push(plainQueryBlockTermValue(row.o))
  }
  return byPredicate
}

function first(props: Record<string, string[]>, local: string): string | null {
  return props[`${CTA_NS}${local}`]?.[0] ?? null
}

function readEdges(result: QueryBlockResult): CuentaEdge[] {
  if (result.resultKind !== 'bindings') return []
  const edges: CuentaEdge[] = []
  for (const row of result.rows) {
    const predicate = plainQueryBlockTermValue(row.p)
    const edge = predicate.startsWith(CTA_NS) ? (predicate.slice(CTA_NS.length) as CuentaEdgeKind) : null
    if (!edge || !(CUENTA_EDGE_PREDICATES as readonly string[]).includes(edge)) continue
    const target = plainQueryBlockTermValue(row.target)
    if (!target) continue
    edges.push({
      edge,
      target,
      title: row.ttitle ? plainQueryBlockTermValue(row.ttitle) : null,
      status: row.tstatus ? plainQueryBlockTermValue(row.tstatus) : null,
    })
  }
  return edges
}

function readRendiciones(result: QueryBlockResult): CuentaRendicion[] {
  if (result.resultKind !== 'bindings') return []
  // One Rendición spans several rows when it carries several evidence values
  // (the OPTIONAL fans out) — fold by ?r, in first-seen (ORDER BY) order.
  const byIri = new Map<string, { rendicion: Omit<CuentaRendicion, 'evidence'>; evidence: string[] }>()
  for (const row of result.rows) {
    const r = plainQueryBlockTermValue(row.r)
    if (!r) continue
    let entry = byIri.get(r)
    if (!entry) {
      entry = {
        rendicion: {
          iri: r,
          verdict: plainQueryBlockTermValue(row.verdict),
          witness: plainQueryBlockTermValue(row.witness),
          summary: plainQueryBlockTermValue(row.summary),
          renderedAt: row.renderedAt ? plainQueryBlockTermValue(row.renderedAt) : null,
          word: row.word ? plainQueryBlockTermValue(row.word) : null,
          utterance: row.utterance ? plainQueryBlockTermValue(row.utterance) : null,
        },
        evidence: [],
      }
      byIri.set(r, entry)
    }
    if (row.evidence) {
      const value = plainQueryBlockTermValue(row.evidence)
      if (value && !entry.evidence.includes(value)) entry.evidence.push(value)
    }
  }
  return [...byIri.values()].map(({ rendicion, evidence }) => ({ ...rendicion, evidence }))
}

/** Pure — fold the three real results into one reading. */
export function readCuenta(
  subject: string,
  properties: QueryBlockResult,
  edges: QueryBlockResult,
  rendiciones: QueryBlockResult,
): CuentaReading {
  const props = groupProperties(properties)
  const found = Object.keys(props).length > 0
  const edgeList = readEdges(edges)
  const status = first(props, 'status')
  const priorityRaw = first(props, 'priority')
  const priority = priorityRaw !== null && Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : null
  const blockers = edgeList.filter((edge) => edge.edge === 'needs' || edge.edge === 'gatedBy')
  const ready = status === 'open' && blockers.every((edge) => edge.status === 'done')
  return {
    subject,
    found,
    localId: cuentaLocalId(subject),
    props,
    title: first(props, 'title') ?? subject,
    beadKind: first(props, 'beadKind'),
    status,
    owner: first(props, 'owner'),
    venue: first(props, 'venue'),
    priority,
    note: first(props, 'note'),
    createdAt: first(props, 'createdAt'),
    evidence: props[`${CTA_NS}evidence`] ?? [],
    edges: edgeList,
    rendiciones: readRendiciones(rendiciones),
    ready,
  }
}

/** True when this bead is a gate still waiting for its word — the ONE state W1's affordance exists for. */
export function cuentaAwaitsWord(reading: CuentaReading): boolean {
  return reading.found && reading.beadKind === 'gate' && reading.status === 'open'
}
