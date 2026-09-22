/**
 * resource-triples.ts — the ONE place a Resource becomes Triple[].
 *
 * Both the turtle face AND the json (JSON-LD) face read from this single triple
 * production, so a resource's RDF and its JSON-LD can never disagree on shape —
 * the same no-drift discipline the catalog already uses for Storybook⇄manifest.
 *
 *   - workspace  → REUSE nucleus serializeConfigToTriples (the existing, tested,
 *     round-tripping sux: contract — near-free, exactly as the design specifies).
 *   - catalog    → a `cat:Catalog` node + one `comp:Component` node per row.
 *   - component  → the single `comp:Component` node (the item face).
 *
 * Pure: no DOM, no network.
 */

import {
  I,
  L,
  Lbool,
  Lint,
  compareTriples,
  epochMsToIso,
  serializeConfigToTriples,
  type DisplayKind,
  type Term,
  type Triple,
} from '@shrubbery/nucleus'
import {
  BQ_NS,
  CAT_NS,
  DK_NS,
  EMP_NS,
  FLOW_NS,
  MEM_NS,
  RDF_TYPE,
  RDFS_LABEL,
  RZ_NS,
  TN_NS,
  WK_NS,
  flowRowIri,
  axisIri,
  bouquetIri,
  catIri,
  callIri,
  compIri,
  empIri,
  greenhouseIri,
  knobIri,
  lawIri,
  meterIri,
  kindedValueIri,
  plotIri,
  retrievalIri,
  runIri,
  starIri,
  subjectIri,
  turnIri,
  vocabIri,
  walkIndexIri,
} from './context.js'
import { FLOW_TABLES, type FlowDatatype, type FlowTableSpec } from './flow-vocab.js'
import type {
  BouquetResource,
  BouquetStar,
  CatalogComponent,
  CatalogResource,
  ComponentResource,
  FlowBoardResource,
  FlowScalar,
  GreenhouseResource,
  KindedValueResource,
  KnobResource,
  MemoryRecord,
  PlotResource,
  Resource,
  SubjectResource,
  VocabPack,
  VocabResource,
  WalkIndexResource,
  WalkResource,
  WalkTurn,
  WorkspaceResource,
} from './target.js'

const comp = (local: string): string => 'http://sophia.ai/component#' + local
const cat = (local: string): string => CAT_NS + local
const emp = (local: string): string => EMP_NS + local
const mem = (local: string): string => MEM_NS + local
const rz = (local: string): string => RZ_NS + local
const wk = (local: string): string => WK_NS + local
const bq = (local: string): string => BQ_NS + local
const tn = (local: string): string => TN_NS + local
const dk = (local: string): string => DK_NS + local

/** The short record sha of a memory record IRI (last `:record:<sha>`). */
function recordSha(iri: string): string {
  const parts = iri.split(':record:')
  return parts[parts.length - 1] || iri
}

const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal'
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer'

/** Emit the triples for a single component node (shared by catalog + item faces). */
function componentTriples(c: CatalogComponent): Triple[] {
  const C = compIri(c.tag)
  return [
    { s: C, p: RDF_TYPE, o: I(comp('Component')) },
    { s: C, p: comp('tag'), o: L(c.tag) },
    { s: C, p: RDFS_LABEL, o: L(c.tag) },
    { s: C, p: comp('persistence'), o: L(c.persistence) },
    { s: C, p: comp('manifested'), o: Lbool(c.manifested) },
    { s: C, p: comp('built'), o: Lbool(c.built) },
    { s: C, p: comp('face'), o: L(c.face) },
    { s: C, p: comp('blurb'), o: L(c.blurb) },
  ]
}

function catalogTriples(r: CatalogResource): Triple[] {
  const K = catIri(r.id)
  const out: Triple[] = [
    { s: K, p: RDF_TYPE, o: I(cat('Catalog')) },
    { s: K, p: RDFS_LABEL, o: L(r.title) },
    { s: K, p: cat('summary'), o: L(r.summary) },
    { s: K, p: cat('count'), o: Lint(r.components.length) },
  ]
  for (const c of r.components) {
    out.push({ s: K, p: cat('hasEntry'), o: I(compIri(c.tag)) })
    out.push(...componentTriples(c))
  }
  return out
}

function workspaceTriples(r: WorkspaceResource): Triple[] {
  // REUSE the existing, tested sux: serialization contract verbatim.
  return serializeConfigToTriples(r.config)
}

/**
 * Emit the triples for a single vocab pack node (shared by catalogue + item
 * faces). Carries the FULL golden-contract anatomy the deepened pack-detail
 * renders, so the turtle + JSON-LD faces are ISOMORPHIC to the markdown face:
 * per-class required/optional predicates (datatype + required/multi + CLOSED
 * ENUM values + the object-property range), the per-class subject-minting rule,
 * the class→class RELATIONSHIPS (predicate ranges + CRDT wire rules), the
 * prefix→namespace table, the pack-level MINTING (slug + uri/doc-id rules), and
 * the derived STATS. Every section is conditional — a trimmed pack emits only
 * what it carries (no faked rows).
 */
function vocabPackTriples(p: VocabPack): Triple[] {
  const V = vocabIri(p.name, p.version)
  const out: Triple[] = [
    { s: V, p: RDF_TYPE, o: I(emp('Vocabulary')) },
    { s: V, p: emp('vocabName'), o: L(p.name) },
    { s: V, p: RDFS_LABEL, o: L(p.title) },
    { s: V, p: emp('version'), o: L(p.version) },
    { s: V, p: emp('namespace'), o: L(p.namespace) },
  ]
  if (p.sha) out.push({ s: V, p: emp('sha'), o: L(p.sha) })
  if (p.description) out.push({ s: V, p: emp('description'), o: L(p.description) })

  // ── prefix → namespace table ───────────────────────────────────────────────
  if (p.namespaces) {
    for (const [prefix, ns] of Object.entries(p.namespaces).sort(([a], [b]) => a.localeCompare(b))) {
      const N = `${V}/ns/${prefix || '_base'}`
      out.push({ s: V, p: emp('hasNamespace'), o: I(N) })
      out.push({ s: N, p: RDF_TYPE, o: I(emp('Namespace')) })
      out.push({ s: N, p: emp('nsPrefix'), o: L(prefix) })
      out.push({ s: N, p: emp('nsUri'), o: L(ns) })
    }
  }

  // ── classes → predicates (datatype/required/multi + enum + range + subject) ──
  for (const cls of p.classes) {
    const C = `${V}/class/${cls.name}`
    out.push({ s: V, p: emp('hasClass'), o: I(C) })
    out.push({ s: C, p: RDF_TYPE, o: I(emp('Class')) })
    out.push({ s: C, p: emp('className'), o: L(cls.name) })
    out.push({ s: C, p: RDFS_LABEL, o: L(cls.name) })
    if (cls.subjectRule) out.push({ s: C, p: emp('subjectRule'), o: L(cls.subjectRule) })
    for (const pred of cls.predicates) {
      const P = `${C}/pred/${pred.name}`
      out.push({ s: C, p: emp('hasPredicate'), o: I(P) })
      out.push({ s: P, p: RDF_TYPE, o: I(emp('Predicate')) })
      out.push({ s: P, p: emp('predicateName'), o: L(pred.name) })
      if (pred.datatype) out.push({ s: P, p: emp('datatype'), o: L(pred.datatype) })
      if (pred.required !== undefined) out.push({ s: P, p: emp('required'), o: Lbool(pred.required) })
      if (pred.multi !== undefined) out.push({ s: P, p: emp('multi'), o: Lbool(pred.multi) })
      if (pred.relatesTo) out.push({ s: P, p: emp('relatesTo'), o: L(pred.relatesTo) })
      // CLOSED-ENUM allowed values, in declared order (one triple per value).
      if (pred.enumValues) {
        for (const v of pred.enumValues) out.push({ s: P, p: emp('enumValue'), o: L(v) })
      }
    }
  }

  // ── class→class RELATIONSHIPS (predicate ranges + CRDT wire rules) ───────────
  for (const [i, rel] of (p.relationships ?? []).entries()) {
    const R = `${V}/rel/${rel.kind}-${i}`
    out.push({ s: V, p: emp('hasRelationship'), o: I(R) })
    out.push({ s: R, p: RDF_TYPE, o: I(emp('Relationship')) })
    out.push({ s: R, p: emp('relFrom'), o: L(rel.from) })
    out.push({ s: R, p: emp('relTo'), o: L(rel.to) })
    out.push({ s: R, p: emp('relPredicate'), o: L(rel.predicate) })
    out.push({ s: R, p: emp('relKind'), o: L(rel.kind) })
    if (rel.note) out.push({ s: R, p: emp('relNote'), o: L(rel.note) })
  }

  // ── pack-level MINTING (slug rule + per-template uri/doc-id rules) ───────────
  const m = p.minting
  if (m) {
    if (m.slugPattern !== undefined) out.push({ s: V, p: emp('slugPattern'), o: L(m.slugPattern) })
    if (m.slugReplacement !== undefined) out.push({ s: V, p: emp('slugReplacement'), o: L(m.slugReplacement) })
    if (m.slugLowercase !== undefined) out.push({ s: V, p: emp('slugLowercase'), o: Lbool(m.slugLowercase) })
    if (m.uriRules) {
      for (const [tpl, rule] of Object.entries(m.uriRules).sort(([a], [b]) => a.localeCompare(b))) {
        const U = `${V}/uri-rule/${tpl}`
        out.push({ s: V, p: emp('hasUriRule'), o: I(U) })
        out.push({ s: U, p: RDF_TYPE, o: I(emp('UriRule')) })
        out.push({ s: U, p: emp('ruleTemplate'), o: L(tpl) })
        out.push({ s: U, p: emp('ruleValue'), o: L(rule) })
      }
    }
    if (m.docIdRules) {
      for (const [tpl, rule] of Object.entries(m.docIdRules).sort(([a], [b]) => a.localeCompare(b))) {
        const D = `${V}/doc-id-rule/${tpl}`
        out.push({ s: V, p: emp('hasDocIdRule'), o: I(D) })
        out.push({ s: D, p: RDF_TYPE, o: I(emp('DocIdRule')) })
        out.push({ s: D, p: emp('ruleTemplate'), o: L(tpl) })
        out.push({ s: D, p: emp('ruleValue'), o: L(rule) })
      }
    }
  }

  // ── derived STATS (class / predicate / relationship counts) ──────────────────
  const predicateCount =
    p.predicateCount ?? p.classes.reduce((n, c) => n + c.predicates.length, 0)
  const relationshipCount = p.relationshipCount ?? p.relationships?.length ?? 0
  out.push({ s: V, p: emp('classCount'), o: Lint(p.classes.length) })
  out.push({ s: V, p: emp('predicateCount'), o: Lint(predicateCount) })
  out.push({ s: V, p: emp('relationshipCount'), o: Lint(relationshipCount) })

  return out
}

function vocabCatalogTriples(r: VocabResource): Triple[] {
  const K = empIri(r.id)
  const out: Triple[] = [
    { s: K, p: RDF_TYPE, o: I(emp('Catalog')) },
    { s: K, p: RDFS_LABEL, o: L(r.title) },
    { s: K, p: cat('summary'), o: L(r.summary) },
    { s: K, p: emp('count'), o: Lint(r.vocabs.length) },
  ]
  for (const v of r.vocabs) {
    const V = vocabIri(v.name, v.version)
    out.push({ s: K, p: emp('hasVocab'), o: I(V) })
    out.push({ s: V, p: RDF_TYPE, o: I(emp('Vocabulary')) })
    out.push({ s: V, p: emp('vocabName'), o: L(v.name) })
    out.push({ s: V, p: RDFS_LABEL, o: L(v.title) })
    out.push({ s: V, p: emp('version'), o: L(v.version) })
    out.push({ s: V, p: emp('namespace'), o: L(v.namespace) })
    out.push({ s: V, p: emp('sha'), o: L(v.sha) })
  }
  return out
}

/**
 * Emit the triples for a single memory RECORD — the LIVE store's own `mem:`
 * predicates against the REAL record IRI (so the turtle/json faces describe the
 * actual :projection:memory subject, not a re-coined mirror). Shared by the plot
 * rows and the subject (bed) detail face.
 */
function memoryRecordTriples(r: MemoryRecord): Triple[] {
  const R = r.id
  const out: Triple[] = [
    { s: R, p: RDF_TYPE, o: I(mem('MemoryRecord')) },
    { s: R, p: RDFS_LABEL, o: L(r.localId) },
    { s: R, p: mem('content'), o: L(r.content) },
    { s: R, p: mem('status'), o: L(r.status) },
  ]
  if (r.kind) out.push({ s: R, p: mem('kind'), o: L(r.kind) })
  if (r.createdAt) out.push({ s: R, p: mem('createdAt'), o: L(r.createdAt, XSD_DATETIME) })
  if (r.observedAt) out.push({ s: R, p: mem('observedAt'), o: L(r.observedAt, XSD_DATETIME) })
  if (r.observer) out.push({ s: R, p: mem('observer'), o: L(r.observer) })
  if (r.scope) out.push({ s: R, p: mem('scope'), o: L(r.scope) })
  if (r.contentOrientation) out.push({ s: R, p: mem('contentOrientation'), o: L(r.contentOrientation) })
  if (r.supersedes) out.push({ s: R, p: mem('supersedes'), o: I(r.supersedes) })
  return out
}

/**
 * One SUBJECT bed → an `rz:Subject` view node + the FULL chain of mem: records.
 * The view node carries the resolved-head pointer + the as-of stamp (the whole
 * point: the head is recomputed for `?asof`, not read off the status flag); the
 * records carry the store's own predicates (status/createdAt/supersedes) so the
 * superseded predecessors and the lineage are all visible in the RDF.
 */
function subjectTriples(r: SubjectResource): Triple[] {
  const S = subjectIri(r.rootId)
  const out: Triple[] = [
    { s: S, p: RDF_TYPE, o: I(rz('Subject')) },
    { s: S, p: RDFS_LABEL, o: L(r.title) },
    { s: S, p: rz('rootId'), o: L(r.rootId) },
    { s: S, p: rz('topic'), o: L(r.topic) },
  ]
  if (r.asOf) out.push({ s: S, p: rz('asOf'), o: L(r.asOf, XSD_DATETIME) })
  // The resolved current-as-of head (by record IRI) — the as-of recomputation.
  const headRec = r.records.find((rec) => rec.localId === r.head)
  if (headRec) out.push({ s: S, p: rz('currentHead'), o: I(headRec.id) })
  for (const rec of r.records) {
    out.push({ s: S, p: rz('hasRecord'), o: I(rec.id) })
    out.push(...memoryRecordTriples(rec))
  }
  return out
}

/** The PLOT collection → an `rz:Plot` node + one `rz:Subject` summary per bed. */
function plotTriples(r: PlotResource): Triple[] {
  const P = plotIri(r.id)
  const out: Triple[] = [
    { s: P, p: RDF_TYPE, o: I(rz('Plot')) },
    { s: P, p: RDFS_LABEL, o: L(r.title) },
    { s: P, p: cat('summary'), o: L(r.summary) },
    { s: P, p: rz('subjectCount'), o: Lint(r.subjects.length) },
  ]
  if (r.asOf) out.push({ s: P, p: rz('asOf'), o: L(r.asOf, XSD_DATETIME) })
  for (const s of r.subjects) {
    const S = subjectIri(s.rootId)
    out.push({ s: P, p: rz('hasSubject'), o: I(S) })
    out.push({ s: S, p: RDF_TYPE, o: I(rz('Subject')) })
    out.push({ s: S, p: rz('rootId'), o: L(s.rootId) })
    out.push({ s: S, p: rz('topic'), o: L(s.topic) })
    out.push({ s: S, p: mem('content'), o: L(s.headContent) })
    out.push({ s: S, p: rz('recordTotal'), o: Lint(s.recordTotal) })
    out.push({ s: S, p: rz('activeCount'), o: Lint(s.activeCount) })
    out.push({ s: S, p: rz('supersededCount'), o: Lint(s.supersededCount) })
  }
  return out
}

// ── BOUQUET — the read-side constellation as RDF (bq: bloom/star, mem: records) ──

/**
 * One STAR of a bouquet → a `bq:Star` node carrying its WHY annotation, its note,
 * and a pointer at the SAME mem: record the Plot bed renders (the cross-surface
 * join). The record's own mem: triples are emitted alongside so the turtle/json
 * faces describe the real belief, not a re-coined mirror.
 */
function starTriples(rootId: string, star: BouquetStar): Triple[] {
  const S = starIri(rootId, star.why, recordSha(star.record.id))
  const out: Triple[] = [
    { s: S, p: RDF_TYPE, o: I(bq('Star')) },
    { s: S, p: RDFS_LABEL, o: L(`${star.why} · ${star.record.localId}`) },
    { s: S, p: bq('why'), o: L(star.why) },
    { s: S, p: bq('record'), o: I(star.record.id) },
  ]
  if (star.note) out.push({ s: S, p: bq('note'), o: L(star.note) })
  out.push(...memoryRecordTriples(star.record))
  return out
}

/**
 * ONE BOUQUET → a `bq:Bouquet` node + the whole bloom of annotated stars + the
 * surfaced retrieval reasoning. The bright `bq:currentHead` is the answer; the
 * per-arm `bq:hasPredecessor`/`hasDisposition`/`hasEntityLink`/`hasGotcha`/
 * `hasEvidence` edges group the stars by their role; `bq:hasStar` carries the whole
 * configuration. The `bq:retrieval` node holds the ClassifyQueryShape verdict +
 * gate→fuse (the read-side analog of the Walk's write reasoning).
 */
function bouquetTriples(r: BouquetResource): Triple[] {
  const B = bouquetIri(r.rootId)
  const out: Triple[] = [
    { s: B, p: RDF_TYPE, o: I(bq('Bouquet')) },
    { s: B, p: RDFS_LABEL, o: L(r.title) },
    { s: B, p: rz('rootId'), o: L(r.rootId) },
    { s: B, p: bq('topic'), o: L(r.topic) },
    { s: B, p: bq('currentHead'), o: I(r.currentHead.id) },
    { s: B, p: bq('starCount'), o: Lint(r.stars.length) },
  ]
  if (r.asOf) out.push({ s: B, p: rz('asOf'), o: L(r.asOf, XSD_DATETIME) })

  // The bright head's own mem: triples (so the answer's record is fully described).
  out.push(...memoryRecordTriples(r.currentHead))

  // The per-arm record-pointer edges (predecessors / dispositions / evidence are
  // raw mem: records; entity-links + gotchas are annotated stars).
  for (const rec of r.predecessors) {
    out.push({ s: B, p: bq('hasPredecessor'), o: I(rec.id) })
    out.push(...memoryRecordTriples(rec))
  }
  for (const rec of r.dispositions) {
    out.push({ s: B, p: bq('hasDisposition'), o: I(rec.id) })
    out.push(...memoryRecordTriples(rec))
  }
  for (const rec of r.evidence) {
    out.push({ s: B, p: bq('hasEvidence'), o: I(rec.id) })
    out.push(...memoryRecordTriples(rec))
  }
  for (const star of r.entityLinks) {
    out.push({ s: B, p: bq('hasEntityLink'), o: I(starIri(r.rootId, star.why, recordSha(star.record.id))) })
  }
  for (const star of r.gotchas) {
    out.push({ s: B, p: bq('hasGotcha'), o: I(starIri(r.rootId, star.why, recordSha(star.record.id))) })
  }

  // The WHOLE bloom — every annotated star (the configuration).
  for (const star of r.stars) {
    out.push({ s: B, p: bq('hasStar'), o: I(starIri(r.rootId, star.why, recordSha(star.record.id))) })
    out.push(...starTriples(r.rootId, star))
  }

  // The surfaced RETRIEVAL reasoning (the read-side analog of the Walk's write
  // reasoning) — emitted only when the bloom carries an honest value for it.
  const rv = r.retrieval
  if (rv.queryShape || rv.question || rv.gate || rv.fuse) {
    const R = retrievalIri(r.rootId)
    out.push({ s: B, p: bq('hasRetrieval'), o: I(R) })
    out.push({ s: R, p: RDF_TYPE, o: I(bq('Retrieval')) })
    if (rv.queryShape) out.push({ s: R, p: bq('queryShape'), o: L(rv.queryShape) })
    if (rv.question) out.push({ s: R, p: bq('question'), o: L(rv.question) })
    if (rv.gate) out.push({ s: R, p: bq('gate'), o: L(rv.gate) })
    if (rv.fuse) out.push({ s: R, p: bq('fuse'), o: L(rv.fuse) })
  }

  return out
}

// ── WALK — the agentic-run trace as RDF (wk: run/turn/call, mem: lineage join) ──

/**
 * One TURN of a run → a `wk:Turn` node + its tool CALL nodes. The turn carries
 * the model's reasoning, the phase + index, the usage/cost, and a `wk:supersedes`
 * flag-edge for the supersession moment. Each tool call is its own node (name +
 * args verbatim + the supersedesRef join to the mem: record it updates), and the
 * call's result lands on the same call node (so the I/O is co-located in the RDF).
 */
function turnTriples(runId: string, t: WalkTurn): Triple[] {
  const T = turnIri(runId, t.label, t.turn)
  const out: Triple[] = [
    { s: T, p: RDF_TYPE, o: I(wk('Turn')) },
    { s: T, p: RDFS_LABEL, o: L(`${t.label} · turn ${t.turn}`) },
    { s: T, p: wk('phase'), o: L(t.label) },
    { s: T, p: wk('turnIndex'), o: Lint(t.turn) },
    { s: T, p: wk('reasoning'), o: L(t.reasoning) },
  ]
  if (t.stopReason) out.push({ s: T, p: wk('stopReason'), o: L(t.stopReason) })
  if (t.usage) {
    const u = t.usage
    if (u.inputTokens !== undefined) out.push({ s: T, p: wk('inputTokens'), o: Lint(u.inputTokens) })
    if (u.outputTokens !== undefined) out.push({ s: T, p: wk('outputTokens'), o: Lint(u.outputTokens) })
    if (u.totalTokens !== undefined) out.push({ s: T, p: wk('totalTokens'), o: Lint(u.totalTokens) })
    if (u.costUsd !== undefined) {
      out.push({ s: T, p: wk('costUsd'), o: L(String(u.costUsd), 'http://www.w3.org/2001/XMLSchema#decimal') })
    }
  }
  // The tool calls (the act), each with its result (the observation) co-located.
  const resultByCall = new Map(t.toolResults.map((r) => [r.toolCallId, r]))
  for (const c of t.toolCalls) {
    const C = callIri(runId, c.id)
    out.push({ s: T, p: wk('hasCall'), o: I(C) })
    out.push({ s: C, p: RDF_TYPE, o: I(wk('ToolCall')) })
    out.push({ s: C, p: wk('toolName'), o: L(c.name) })
    out.push({ s: C, p: RDFS_LABEL, o: L(c.name) })
    // Arguments serialized verbatim (JSON text) — a faithful copy of the call.
    out.push({ s: C, p: wk('toolArguments'), o: L(JSON.stringify(c.arguments)) })
    // The supersession JOIN: the mem: record this remember updates (the lineage
    // edge back to the Plot's bed).
    if (c.supersedesRef) out.push({ s: C, p: wk('supersedes'), o: I(c.supersedesRef) })
    const r = resultByCall.get(c.id)
    if (r) {
      out.push({ s: C, p: wk('toolResult'), o: L(r.result) })
      out.push({ s: C, p: wk('isError'), o: Lbool(r.isError) })
      if (r.subject) out.push({ s: C, p: wk('superseded'), o: I(r.subject) })
    }
  }
  return out
}

/** ONE run → a `wk:Run` node + its ribbon of turns + the confirmed edges. */
function walkRunTriples(r: WalkResource): Triple[] {
  const R = runIri(r.id)
  const out: Triple[] = [
    { s: R, p: RDF_TYPE, o: I(wk('Run')) },
    { s: R, p: RDFS_LABEL, o: L(r.title) },
    { s: R, p: wk('runId'), o: L(r.id) },
    { s: R, p: wk('graphId'), o: L(r.graphId) },
    { s: R, p: wk('question'), o: L(r.question) },
    { s: R, p: wk('gold'), o: L(r.gold) },
    { s: R, p: wk('finalAnswer'), o: L(r.finalAnswer) },
    { s: R, p: wk('turnCount'), o: Lint(r.turns.length) },
    { s: R, p: wk('supersessionCount'), o: Lint(r.supersessionEdges.length) },
  ]
  for (const t of r.turns) {
    out.push({ s: R, p: wk('hasTurn'), o: I(turnIri(r.id, t.label, t.turn)) })
    out.push(...turnTriples(r.id, t))
  }
  // The run-level confirmed supersession edges (run_end): new record supersedes
  // old — the SAME mem: lineage the Plot's beds render (the cross-surface join).
  for (const e of r.supersessionEdges) {
    out.push({ s: e.newUrn, p: mem('supersedes'), o: I(e.oldUrn) })
  }
  return out
}

/** The WALK INDEX → a `wk:Index` node + one `wk:Run` summary per trace file. */
function walkIndexTriples(r: WalkIndexResource): Triple[] {
  const K = walkIndexIri(r.id)
  const out: Triple[] = [
    { s: K, p: RDF_TYPE, o: I(wk('Index')) },
    { s: K, p: RDFS_LABEL, o: L(r.title) },
    { s: K, p: cat('summary'), o: L(r.summary) },
    { s: K, p: wk('runCount' /* count of runs */), o: Lint(r.runs.length) },
  ]
  for (const run of r.runs) {
    const R = runIri(run.id)
    out.push({ s: K, p: wk('hasRun'), o: I(R) })
    out.push({ s: R, p: RDF_TYPE, o: I(wk('Run')) })
    out.push({ s: R, p: wk('runId'), o: L(run.id) })
    out.push({ s: R, p: RDFS_LABEL, o: L(run.question) })
    out.push({ s: R, p: wk('question'), o: L(run.question) })
    out.push({ s: R, p: wk('gold'), o: L(run.gold) })
    out.push({ s: R, p: wk('finalAnswer'), o: L(run.finalAnswer) })
    out.push({ s: R, p: wk('turnCount'), o: Lint(run.turnCount) })
    out.push({ s: R, p: wk('supersessionCount'), o: Lint(run.supersessionCount) })
    // The reverse cross-surface join — the Plot bed rootId(s) this run minted.
    for (const rootId of run.supersededRoots) {
      out.push({ s: R, p: wk('mintedBed'), o: L(rootId) })
    }
  }
  return out
}

// ── GREENHOUSE — the cultivation knobs as RDF (tn: ConfigDimension + the meter) ──

/**
 * ONE KNOB → a `tn:ConfigDimension` node + its current value + the per-axis nodes +
 * the DERIVED live-effect meter node + the LAWS legend rows + the provenance. The
 * meter is a tn:Meter NODE (not a stored field on the projection) carrying the
 * recomputed value/target/green + the verbatim offenders — so the turtle/json faces
 * describe the CONSEQUENCE of the setting, the same number the DOM/markdown faces show.
 */
function knobTriples(r: KnobResource): Triple[] {
  const K = knobIri(r.id)
  const out: Triple[] = [
    { s: K, p: RDF_TYPE, o: I(tn('ConfigDimension')) },
    { s: K, p: RDFS_LABEL, o: L(r.title) },
    { s: K, p: tn('family'), o: L(r.family) },
    { s: K, p: tn('glyph'), o: L(r.glyph) },
    { s: K, p: tn('focal'), o: Lbool(r.focal) },
    { s: K, p: cat('summary'), o: L(r.summary) },
    { s: K, p: tn('value'), o: L(r.value) },
    { s: K, p: tn('writeMode'), o: L(r.writeMode) },
  ]
  for (const c of r.choices) out.push({ s: K, p: tn('choice'), o: L(c) })
  if (r.justifiedBy) out.push({ s: K, p: tn('justifiedBy'), o: L(r.justifiedBy) })
  if (r.createdBy) out.push({ s: K, p: tn('createdBy'), o: L(r.createdBy) })
  // Knob createdAt is EPOCH MS in the carrier (R4c); the wire gets xsd:dateTime.
  if (r.createdAt != null) out.push({ s: K, p: tn('createdAt'), o: L(epochMsToIso(r.createdAt), XSD_DATETIME) })
  if (r.asOf) out.push({ s: K, p: rz('asOf'), o: L(r.asOf, XSD_DATETIME) })
  if (r.governsBed) out.push({ s: K, p: tn('governsBed'), o: L(r.governsBed) })

  // The per-axis PATCH-able settings (the JUDGMENT forks).
  for (const a of r.axes) {
    const A = axisIri(r.id, a.key)
    out.push({ s: K, p: tn('hasAxis'), o: I(A) })
    out.push({ s: A, p: RDF_TYPE, o: I(tn('Axis')) })
    out.push({ s: A, p: tn('axisKey'), o: L(a.key) })
    out.push({ s: A, p: RDFS_LABEL, o: L(a.label) })
    out.push({ s: A, p: tn('axisValue'), o: L(a.value) })
    for (const c of a.choices) out.push({ s: A, p: tn('choice'), o: L(c) })
    if (a.locked !== undefined) out.push({ s: A, p: tn('axisLocked'), o: Lbool(a.locked) })
    if (a.note) out.push({ s: A, p: tn('axisNote'), o: L(a.note) })
  }

  // The LAWS legend rows (the read-mostly world-model lifecycle taxonomy-as-code).
  for (const law of r.laws) {
    const Lw = lawIri(r.id, law.kind)
    out.push({ s: K, p: tn('hasLaw'), o: I(Lw) })
    out.push({ s: Lw, p: RDF_TYPE, o: I(tn('Law')) })
    out.push({ s: Lw, p: tn('lawKind'), o: L(law.kind) })
    out.push({ s: Lw, p: tn('lawRule'), o: L(law.rule) })
    out.push({ s: Lw, p: tn('lawDetail'), o: L(law.detail) })
  }

  // The DERIVED live-effect meter (a node, never a stored projection field).
  const m = r.meter
  const M = meterIri(r.id)
  out.push({ s: K, p: tn('hasMeter'), o: I(M) })
  out.push({ s: M, p: RDF_TYPE, o: I(tn('Meter')) })
  out.push({ s: M, p: tn('meterLabel'), o: L(m.label) })
  out.push({ s: M, p: tn('meterValue'), o: L(String(m.value), XSD_DECIMAL) })
  out.push({ s: M, p: tn('meterTarget'), o: L(String(m.target), XSD_DECIMAL) })
  out.push({ s: M, p: tn('meterGreen'), o: Lbool(m.green) })
  if (m.unit) out.push({ s: M, p: tn('meterUnit'), o: L(m.unit) })
  for (const off of m.offenders) out.push({ s: M, p: tn('meterOffender'), o: L(off) })

  return out
}

/** THE GREENHOUSE → a `tn:Greenhouse` node + one `tn:ConfigDimension` per knob. */
function greenhouseTriples(r: GreenhouseResource): Triple[] {
  const G = greenhouseIri(r.id)
  const out: Triple[] = [
    { s: G, p: RDF_TYPE, o: I(tn('Greenhouse')) },
    { s: G, p: RDFS_LABEL, o: L(r.title) },
    { s: G, p: cat('summary'), o: L(r.summary) },
  ]
  if (r.asOf) out.push({ s: G, p: rz('asOf'), o: L(r.asOf, XSD_DATETIME) })
  for (const knob of r.knobs) {
    out.push({ s: G, p: tn('hasKnob'), o: I(knobIri(knob.id)) })
    out.push(...knobTriples(knob))
  }
  return out
}

function kindedValueTriples(r: KindedValueResource): Triple[] {
  const K = kindedValueIri(r.id)
  const n = r.node
  const out: Triple[] = [
    { s: K, p: RDF_TYPE, o: I(dk('KindedValue')) },
    { s: K, p: RDFS_LABEL, o: L(r.title) },
    { s: K, p: dk('kind'), o: L(displayKindLiteral(n.kind)) },
    { s: K, p: dk('value'), o: L(n.value) },
  ]
  if (n.label) out.push({ s: K, p: dk('label'), o: L(n.label) })
  if (n.unit) out.push({ s: K, p: dk('unit'), o: L(n.unit) })
  if (n.href) out.push({ s: K, p: dk('href'), o: L(n.href) })
  if (n.stance) out.push({ s: K, p: dk('stance'), o: L(n.stance) })
  if (n.attribution?.observer) out.push({ s: K, p: dk('observer'), o: L(n.attribution.observer) })
  if (n.attribution?.observedAt !== undefined) {
    out.push({ s: K, p: dk('observedAt'), o: L(String(n.attribution.observedAt), XSD_INTEGER) })
  }
  if (n.recency) {
    out.push({ s: K, p: dk('capturedAt'), o: L(String(n.recency.capturedAt), XSD_INTEGER) })
    if (n.recency.previous) {
      out.push({ s: K, p: dk('previousValue'), o: L(n.recency.previous.value) })
      out.push({ s: K, p: dk('previousCapturedAt'), o: L(String(n.recency.previous.capturedAt), XSD_INTEGER) })
    }
  }
  return out
}

// ── MITHRAS FLOW — the board's rows as :projection:flow triples (unit S5) ─────

/**
 * One board → the exact `:projection:flow` triple set the cell materializes
 * (garden `flow_board.rs::board_desired_triples`, mirrored per
 * contracts/vocabulary-map.md): one `rdf:type` per row plus one triple per
 * materialized, NON-NULL predicate. No view-level vocabulary (no rdfs:label,
 * no cat:summary) — the integration seat diffs this against the cell's dump,
 * so every extra subject or predicate would be a false divergence.
 *
 * A `uri` predicate's object is the referenced row's own class-qualified
 * subject IRI, resolved by looking the id up across the WHOLE board (Flow
 * mints every id from one global uuid(), never reused across tables) —
 * several of these predicates are `sh:or` unions (`ownedBy`, `target`,
 * `sourceNode`/`targetNode`, `predecessor`/`successor`), so no single fixed
 * target class would be correct. A dangling reference is skipped, never
 * guessed at or fabricated (the cell does the same).
 *
 * Deterministic: tables in the fixed FLOW_TABLES order, rows in authored
 * order, then a canonical sort — never an unsorted map iteration.
 */
function flowBoardTriples(r: FlowBoardResource): Triple[] {
  // id → owning table, across the whole board (the sh:or resolution index).
  const idTable = new Map<string, FlowTableSpec>()
  for (const spec of FLOW_TABLES) {
    for (const row of r.board[spec.ddl]) {
      if (typeof row.id === 'string') idTable.set(row.id, spec)
    }
  }

  const out: Triple[] = []
  for (const spec of FLOW_TABLES) {
    for (const row of r.board[spec.ddl]) {
      if (typeof row.id !== 'string') continue
      const S = flowRowIri(r.graphId, spec.kebab, row.id)
      out.push({ s: S, p: RDF_TYPE, o: I(FLOW_NS + spec.pascal) })
      for (const pred of spec.predicates) {
        const raw = row[pred.column]
        if (raw === null || raw === undefined) continue
        const o = flowObjectTerm(raw, pred.datatype, r.graphId, idTable)
        if (!o) continue
        out.push({ s: S, p: FLOW_NS + pred.local, o })
      }
    }
  }
  out.sort(compareTriples)
  return out
}

/** One Flow cell value → an RDF term per its declared datatype (RTRIP-6). */
function flowObjectTerm(
  raw: FlowScalar,
  datatype: FlowDatatype,
  graphId: string,
  idTable: ReadonlyMap<string, FlowTableSpec>,
): Term | null {
  switch (datatype) {
    case 'uri': {
      if (typeof raw !== 'string') return null
      const target = idTable.get(raw)
      if (!target) return null // dangling reference: no triple (mirrors the cell)
      return I(flowRowIri(graphId, target.kebab, raw))
    }
    case 'string':
      // Empty strings ARE facts (DDL DEFAULT '') and are emitted as such.
      return L(typeof raw === 'string' ? raw : '')
    case 'integer':
      return Lint(typeof raw === 'number' ? raw : 0)
    case 'boolean':
      return Lbool(raw === true)
    default:
      return assertNever(datatype)
  }
}

function displayKindLiteral(kind: DisplayKind): string {
  switch (kind) {
    case 'identity':
      return 'identity'
    case 'state':
      return 'state'
    case 'metric':
      return 'metric'
    case 'prose':
      return 'prose'
    case 'reference':
      return 'reference'
    case 'testimony':
      return 'testimony'
    case 'affordance':
      return 'affordance'
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled render resource kind: ${JSON.stringify(value)}`)
}

/** Produce the canonical Triple[] for any Resource (the shared RDF production). */
export function resourceToTriples(resource: Resource): Triple[] {
  switch (resource.kind) {
    case 'catalog':
      return catalogTriples(resource)
    case 'component':
      return componentTriples((resource as ComponentResource).component)
    case 'workspace':
      return workspaceTriples(resource)
    case 'vocab-catalog':
      return vocabCatalogTriples(resource)
    case 'vocab-pack':
      return vocabPackTriples(resource.pack)
    case 'mem-plot':
      return plotTriples(resource)
    case 'mem-subject':
      return subjectTriples(resource)
    case 'mem-bouquet':
      return bouquetTriples(resource)
    case 'walk-run':
      return walkRunTriples(resource)
    case 'walk-index':
      return walkIndexTriples(resource)
    case 'tn-knob':
      return knobTriples(resource)
    case 'tn-greenhouse':
      return greenhouseTriples(resource)
    case 'kinded-value':
      return kindedValueTriples(resource)
    case 'flow-board':
      return flowBoardTriples(resource)
    default:
      return assertNever(resource)
  }
}
