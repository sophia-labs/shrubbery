/**
 * mywork-reading.ts — el Despacho W4: the PURE reading of one office's held
 * work (plans/2026-09-15-despacho-operational-memo.md §2 "Do", §3 W4).
 *
 * Two fixed shapes: the beads an office holds (`cta:owner` = the office
 * name — cuentas names holders by office, not by seat), grouped by status in
 * the ontology's own order; and the beads gated on that office — beads whose
 * `gatedBy` names an open gate the office owns, i.e. work that waits on a
 * word only this office can give. Data-only; explicit `GRAPH <…cuentas>` so a
 * room mirror answers locally.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { CTA_NS, CUENTA_STATUSES } from './cuenta-reading.js'
import { sparqlStringLiteral } from './inbox-reading.js'

export const MY_WORK_MAX_ROWS = 500

function iri(value: string): string {
  return `<${value}>`
}

export interface MyWorkBead {
  readonly iri: string
  readonly title: string
  readonly kind: string | null
  readonly status: string
  readonly priority: number | null
  readonly createdAt: string | null
  readonly partOf: string | null
  readonly partTitle: string | null
}

export interface MyWorkGatedBead {
  readonly iri: string
  readonly title: string
  readonly kind: string | null
  readonly status: string
  readonly gate: string
  readonly gateTitle: string
}

export interface MyWorkReading {
  readonly owner: string
  /** In the ontology's status order: open, in_progress, blocked, done, composted; unknown statuses last, under their own name. */
  readonly groups: ReadonlyArray<{ readonly status: string; readonly beads: readonly MyWorkBead[] }>
  readonly gatedOn: readonly MyWorkGatedBead[]
  readonly counts: { readonly held: number; readonly open: number; readonly inProgress: number; readonly gatedOn: number }
}

export function myWorkHeldQuery(cuentasGraph: string, owner: string): string {
  return (
    `SELECT ?bead ?title ?kind ?status ?priority ?createdAt ?partOf ?partTitle WHERE { GRAPH ${iri(cuentasGraph)} { ` +
    `?bead <${CTA_NS}owner> ${sparqlStringLiteral(owner)} ; <${CTA_NS}title> ?title ; <${CTA_NS}status> ?status . ` +
    `OPTIONAL { ?bead <${CTA_NS}beadKind> ?kind } OPTIONAL { ?bead <${CTA_NS}priority> ?priority } OPTIONAL { ?bead <${CTA_NS}createdAt> ?createdAt } ` +
    `OPTIONAL { ?bead <${CTA_NS}partOf> ?partOf OPTIONAL { ?partOf <${CTA_NS}title> ?partTitle } } ` +
    `} } ORDER BY ?status ?priority DESC(?createdAt) ?bead LIMIT ${MY_WORK_MAX_ROWS}`
  )
}

export function myWorkGatedOnQuery(cuentasGraph: string, owner: string): string {
  return (
    `SELECT ?bead ?title ?kind ?status ?gate ?gateTitle WHERE { GRAPH ${iri(cuentasGraph)} { ` +
    `?gate <${CTA_NS}beadKind> "gate" ; <${CTA_NS}status> "open" ; <${CTA_NS}owner> ${sparqlStringLiteral(owner)} ; <${CTA_NS}title> ?gateTitle . ` +
    `?bead <${CTA_NS}gatedBy> ?gate ; <${CTA_NS}title> ?title ; <${CTA_NS}status> ?status . OPTIONAL { ?bead <${CTA_NS}beadKind> ?kind } ` +
    `} } ORDER BY ?gate ?bead LIMIT ${MY_WORK_MAX_ROWS}`
  )
}

/** A bindings row exactly as the query service renders it. */
type Row = Extract<QueryBlockResult, { resultKind: 'bindings' }>['rows'][number]

function rows(result: QueryBlockResult): readonly Row[] {
  return result.resultKind === 'bindings' ? result.rows : []
}

function text(row: Row, name: string): string | null {
  const term = row[name]
  return term ? plainQueryBlockTermValue(term) : null
}

export function readMyWork(owner: string, heldResult: QueryBlockResult, gatedResult: QueryBlockResult): MyWorkReading {
  const held = new Map<string, MyWorkBead>()
  for (const row of rows(heldResult)) {
    const bead = text(row, 'bead')
    if (!bead || held.has(bead)) continue
    const priorityRaw = text(row, 'priority')
    held.set(bead, {
      iri: bead,
      title: text(row, 'title') ?? bead,
      kind: text(row, 'kind'),
      status: text(row, 'status') ?? 'unknown',
      priority: priorityRaw !== null && Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : null,
      createdAt: text(row, 'createdAt'),
      partOf: text(row, 'partOf'),
      partTitle: text(row, 'partTitle'),
    })
  }
  const order: string[] = [...CUENTA_STATUSES]
  const byStatus = new Map<string, MyWorkBead[]>()
  for (const bead of held.values()) {
    const list = byStatus.get(bead.status) ?? []
    list.push(bead)
    byStatus.set(bead.status, list)
  }
  for (const status of byStatus.keys()) if (!order.includes(status)) order.push(status)
  const groups = order.filter((s) => byStatus.has(s)).map((status) => ({ status, beads: byStatus.get(status)! }))
  const gatedOn: MyWorkGatedBead[] = []
  const seenGated = new Set<string>()
  for (const row of rows(gatedResult)) {
    const bead = text(row, 'bead')
    const gate = text(row, 'gate')
    if (!bead || !gate) continue
    const key = `${bead}|${gate}`
    if (seenGated.has(key)) continue
    seenGated.add(key)
    gatedOn.push({ iri: bead, title: text(row, 'title') ?? bead, kind: text(row, 'kind'), status: text(row, 'status') ?? 'unknown', gate, gateTitle: text(row, 'gateTitle') ?? gate })
  }
  return {
    owner,
    groups,
    gatedOn,
    counts: {
      held: held.size,
      open: byStatus.get('open')?.length ?? 0,
      inProgress: byStatus.get('in_progress')?.length ?? 0,
      gatedOn: gatedOn.length,
    },
  }
}
