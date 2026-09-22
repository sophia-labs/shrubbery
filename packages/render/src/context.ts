/**
 * context.ts — the SHARED JSON-LD `@context` + vocabulary, defined ONCE up front.
 *
 * Per the ratified SFDM design (decision #6 amendment): the `json` face emits
 * COMPACTED JSON-LD built from the triples we already produce (jsonld.fromRDF →
 * compact). The real win is defining the `@context` ONCE here — alongside the
 * ontology — rather than retrofitting consumers. Both the catalog/component
 * resource triples (this module's `comp:` vocab) and the workspace config
 * triples (nucleus's `sux:` vocab, via serializeConfigToTriples) compact through
 * THIS one context, so every JSON-LD face of every resource shares term names.
 *
 * Pure data + a frozen object — no Lit, no DOM, no network.
 */

// ── Namespaces ───────────────────────────────────────────────────────────────

/** The component/catalog vocabulary (the Emporium catalog faces). */
export const COMP_NS = 'http://sophia.ai/component#'
/** The catalog/collection vocabulary. */
export const CAT_NS = 'http://sophia.ai/catalog#'
/** The sux: UX/workspace vocabulary (mirrors nucleus ux-rdf NS.sux). */
export const SUX_NS = 'http://sophia.ai/ux#'
/** The Emporium vocab-catalogue vocabulary (the catalogue OF vocabularies). */
export const EMP_NS = 'http://sophia.ai/emporium#'
/**
 * The Sophia Memory vocabulary — the LIVE :projection:memory predicates a gardend
 * cell serves (status / content / kind / createdAt / supersedes / …). This is the
 * REAL store NS (NOT a sophia.ai/ NS): the turtle/json faces of a memory resource
 * use the very predicate IRIs the cell holds, so the faces describe the actual
 * records, not a re-coined mirror.
 */
export const MEM_NS = 'http://mnemosyne.dev/memory#'
/**
 * The Rhizome resource vocabulary — the small app-level vocab for the OBSERVATORY
 * nodes themselves (the plot collection + each subject "bed"). Distinct from
 * MEM_NS (the records' own predicates): a rz:Plot/rz:Subject is the rendered VIEW,
 * the mem: triples are the data it views.
 */
export const RZ_NS = 'http://sophia.ai/rhizome#'
/**
 * The WALK vocabulary — the app-level vocab for an agentic-run trace rendered as a
 * turn-by-turn session (the Walk index + one run's ribbon of turns). Distinct from
 * MEM_NS (the records the run wrote) and RZ_NS (the Plot view): a wk:Run/wk:Turn is
 * the rendered VIEW of a JSONL trace FILE, and its `wk:supersedes` edges JOIN back
 * to the mem: records (and thus the Plot beds) the run produced.
 */
export const WK_NS = 'http://sophia.ai/walk#'
/**
 * The BOUQUET vocabulary — the app-level vocab for the READ-side constellation
 * reader (the counterpart to WK_NS's write-side). A bq:Bouquet is the rendered
 * VIEW that blooms when a belief (a Plot bed) is opened: bq:Star nodes annotate
 * each member with WHY it is in the configuration (current / resolved-conflict /
 * standing / entity-link / gotcha / evidence), and the bq:retrieval node surfaces
 * the read reasoning (ClassifyQueryShape verdict, gate→fuse). The stars point at
 * the SAME mem: records the Plot beds render (the cross-surface join), so a bloom
 * and a bed never disagree on the underlying belief.
 */
export const BQ_NS = 'http://sophia.ai/bouquet#'
/**
 * The TUNE vocabulary — the app-level vocab for THE GREENHOUSE (the cultivation
 * knobs). A tn:ConfigDimension is the rendered VIEW of a tuning dimension; it carries
 * a tn:ConfigValue (the current setting) + per-axis tn:hasAxis nodes + a tn:hasMeter
 * (the DERIVED live-effect read over :projection:memory, never a stored field) + the
 * provenance (tn:justifiedBy → a bench:Run, tn:createdBy, tn:createdAt). Distinct
 * from MEM_NS (the records the meter reads) and RZ_NS (the Plot view): the knobs live
 * in the NON-RESERVED `:tune:` named graph (config writes; memory stays authority-
 * walled). The marquee knob's meter measures the (entity,attribute) both-active leak.
 */
export const TN_NS = 'http://sophia.ai/tune#'
/** The DisplayKind vocabulary — render-layer annotations for kinded values. */
export const DK_NS = 'http://sophia.ai/display#'
/**
 * The Mithras Flow board vocabulary (unit S5, FLOW-SHRUB-1a) — the SAME
 * namespace the gardend cell's `flow` Emporium pack declares
 * (`flow.golden.json` `namespaces.flow`), NOT a re-coined mirror: the turtle/
 * json faces of a Flow board must describe the very `:projection:flow`
 * subjects the cell holds, so the integration seat can diff the two turtles
 * (contracts/vocabulary-map.md; interfaces.md §G).
 */
export const FLOW_NS = 'urn:sophia:flow:vocab:'

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#'
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema#'

export const RDF_TYPE = RDF_NS + 'type'
export const RDFS_LABEL = RDFS_NS + 'label'

/** Mint a `comp:` IRI for a component tag (the join key across faces). */
export const compIri = (tag: string): string => COMP_NS + tag
/** Mint a `cat:` IRI for a catalog-local id. */
export const catIri = (localId: string): string => CAT_NS + localId
/** Mint an `emp:` IRI for an Emporium catalogue-local id. */
export const empIri = (localId: string): string => EMP_NS + localId
/** Mint an `emp:` IRI for a vocab pack (the join key across faces), e.g. workflow@1.0.0. */
export const vocabIri = (name: string, version: string): string =>
  EMP_NS + `pack/${name}@${version}`
/** Mint an `rz:` IRI for the plot collection (the index of subject-beds). */
export const plotIri = (localId: string): string => RZ_NS + `plot/${localId}`
/** Mint an `rz:` IRI for one subject-bed (keyed by its lineage-root id). */
export const subjectIri = (rootId: string): string => RZ_NS + `subject/${rootId}`
/** Mint a `bq:` IRI for one bouquet — the constellation of a bed (keyed by root id). */
export const bouquetIri = (rootId: string): string => BQ_NS + `bouquet/${rootId}`
/** Mint a `bq:` IRI for one star of a bouquet (keyed by root id + why + record sha). */
export const starIri = (rootId: string, why: string, recordSha: string): string =>
  BQ_NS + `bouquet/${rootId}/star/${why}-${recordSha.slice(0, 12)}`
/** Mint a `bq:` IRI for a bouquet's retrieval-reasoning node. */
export const retrievalIri = (rootId: string): string => BQ_NS + `bouquet/${rootId}/retrieval`
/** Mint a `wk:` IRI for the walk index (the list of runs). */
export const walkIndexIri = (localId: string): string => WK_NS + `index/${localId}`
/** Mint a `wk:` IRI for one run (keyed by its trace-file run id). */
export const runIri = (runId: string): string => WK_NS + `run/${runId}`
/** Mint a `wk:` IRI for one turn of a run (keyed by run id + phase label + index). */
export const turnIri = (runId: string, label: string, turn: number): string =>
  WK_NS + `run/${runId}/turn/${slug(label)}-${turn}`
/** Mint a `wk:` IRI for one tool call within a turn (keyed by the call id). */
export const callIri = (runId: string, callId: string): string =>
  WK_NS + `run/${runId}/call/${slug(callId)}`
/** Mint a `tn:` IRI for the greenhouse index (the list of knobs). */
export const greenhouseIri = (localId: string): string => TN_NS + `greenhouse/${localId}`
/** Mint a `tn:` IRI for one knob — a tn:ConfigDimension (keyed by its local id). */
export const knobIri = (id: string): string => TN_NS + `knob/${id}`
/** Mint a `tn:` IRI for one knob's live-effect meter node. */
export const meterIri = (id: string): string => TN_NS + `knob/${id}/meter`
/** Mint a `tn:` IRI for one PATCH-able axis of a multi-axis knob (keyed by axis key). */
export const axisIri = (id: string, axisKey: string): string =>
  TN_NS + `knob/${id}/axis/${slug(axisKey)}`
/** Mint a `tn:` IRI for one LAWS legend row (keyed by the world-model kind). */
export const lawIri = (id: string, kind: string): string =>
  TN_NS + `knob/${id}/law/${slug(kind)}`
/** Mint a `dk:` IRI for one render-layer kinded value. */
export const kindedValueIri = (id: string): string => DK_NS + `value/${slug(id)}`

/**
 * The graph subject of a Mnemosyne graph — the `{graph_subject}` of
 * vocabulary-map.md's subject rule (mirrors garden `rdf::graph_subject`).
 */
export const flowGraphSubject = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}`

/**
 * Mint one Flow board row's subject IRI per vocabulary-map.md's subject rule:
 * `{graph_subject}:projection:flow:<kebab-class>:{localId}` — e.g.
 * `urn:mnemosyne:local:graph:g1:projection:flow:workflow-link:wl-1`. The SAME
 * rule the cell's materializer applies (garden `flow_board.rs::subject_iri`),
 * so the two turtles' subjects agree byte-for-byte.
 */
export const flowRowIri = (graphId: string, kebabClass: string, localId: string): string =>
  `${flowGraphSubject(graphId)}:projection:flow:${kebabClass}:${localId}`

/** A path-safe slug of an arbitrary label (spaces/odd chars → '-'). */
const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || '_'

/**
 * The prefix table — used by BOTH the Turtle serializer (for `@prefix`
 * abbreviation) and the JSON-LD `@context` below. Single source so the two RDF
 * faces never disagree on a prefix.
 */
export const PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  comp: COMP_NS,
  cat: CAT_NS,
  sux: SUX_NS,
  emp: EMP_NS,
  mem: MEM_NS,
  rz: RZ_NS,
  wk: WK_NS,
  bq: BQ_NS,
  tn: TN_NS,
  dk: DK_NS,
  flow: FLOW_NS,
  rdf: RDF_NS,
  rdfs: RDFS_NS,
  xsd: XSD_NS,
})

/**
 * The shared JSON-LD `@context`. Defined ONCE, alongside the ontology.
 *
 * Term-name design (so the compacted JSON reads naturally):
 *   - `label` ← rdfs:label
 *   - `persistence`, `manifested`, `built`, `face`, `blurb` ← comp: predicates
 *   - `entries` ← cat:hasEntry (an @container:@set of component nodes)
 *   - `count`, `summary` ← cat: predicates
 *   - the sux: workspace predicates keep their local names (localId, hasRegion,
 *     hasPanel, hasDimension, …) so a workspace JSON-LD face is also readable.
 *
 * Typed literals (xsd:boolean / xsd:integer) get `@type` coercion so booleans
 * and ints round-trip as real JSON booleans/numbers, not strings.
 */
export const SHARED_CONTEXT: Readonly<Record<string, unknown>> = Object.freeze({
  comp: COMP_NS,
  cat: CAT_NS,
  sux: SUX_NS,
  emp: EMP_NS,
  mem: MEM_NS,
  rz: RZ_NS,
  wk: WK_NS,
  bq: BQ_NS,
  tn: TN_NS,
  dk: DK_NS,
  // ── Mithras Flow board (flow: — the cell's own vocab NS, unit S5) ──
  // A bare prefix, no term aliases: the compacted JSON keeps honest
  // `flow:name`/`flow:ownedBy` compact IRIs, visibly the cell's vocabulary.
  flow: FLOW_NS,
  rdf: RDF_NS,
  rdfs: RDFS_NS,
  xsd: XSD_NS,

  label: { '@id': 'rdfs:label' },

  // ── GREENHOUSE (tn: the cultivation-knob view) ──
  // A tn:ConfigDimension (a knob) carries its current value + axes + the DERIVED
  // live-effect meter (NEVER a stored field — recomputed at render time over
  // :projection:memory) + provenance. The marquee knob's meter measures the
  // (entity,attribute) both-active leak (the under-supersession the A/B exposed).
  knobFamily: { '@id': 'tn:family' },
  knobValue: { '@id': 'tn:value' },
  knobGlyph: { '@id': 'tn:glyph' },
  knobFocal: { '@id': 'tn:focal', '@type': 'xsd:boolean' },
  knobWriteMode: { '@id': 'tn:writeMode' },
  knobChoice: { '@id': 'tn:choice', '@container': '@list' },
  hasKnob: { '@id': 'tn:hasKnob', '@type': '@id', '@container': '@set' },
  hasAxis: { '@id': 'tn:hasAxis', '@type': '@id', '@container': '@set' },
  hasMeter: { '@id': 'tn:hasMeter', '@type': '@id' },
  hasLaw: { '@id': 'tn:hasLaw', '@type': '@id', '@container': '@set' },
  axisKey: { '@id': 'tn:axisKey' },
  axisValue: { '@id': 'tn:axisValue' },
  axisLocked: { '@id': 'tn:axisLocked', '@type': 'xsd:boolean' },
  axisNote: { '@id': 'tn:axisNote' },
  lawKind: { '@id': 'tn:lawKind' },
  lawRule: { '@id': 'tn:lawRule' },
  lawDetail: { '@id': 'tn:lawDetail' },
  meterLabel: { '@id': 'tn:meterLabel' },
  meterValue: { '@id': 'tn:meterValue', '@type': 'xsd:decimal' },
  meterTarget: { '@id': 'tn:meterTarget', '@type': 'xsd:decimal' },
  meterGreen: { '@id': 'tn:meterGreen', '@type': 'xsd:boolean' },
  meterUnit: { '@id': 'tn:meterUnit' },
  meterOffender: { '@id': 'tn:meterOffender', '@container': '@set' },
  justifiedBy: { '@id': 'tn:justifiedBy' },
  createdBy: { '@id': 'tn:createdBy' },
  governsBed: { '@id': 'tn:governsBed' },
  // The knob's own createdAt (when the value was set) — a tn: term distinct from the
  // shared `createdAt` (mem:createdAt) so a knob's provenance date round-trips clean.
  knobCreatedAt: { '@id': 'tn:createdAt', '@type': 'xsd:dateTime' },

  // ── BOUQUET (bq: read-side constellation view) ──
  // The bloom (bq:Bouquet) + its annotated stars (bq:Star) + the surfaced read
  // reasoning (bq:retrieval). A star's `bq:record` points at the SAME mem: record
  // the Plot bed renders (the cross-surface join); `bq:why` is the closed-set
  // annotation (current / resolved-conflict / standing / entity-link / gotcha /
  // evidence) that turns a row into a configuration.
  topicLabel: { '@id': 'bq:topic' },
  hasStar: { '@id': 'bq:hasStar', '@type': '@id', '@container': '@set' },
  why: { '@id': 'bq:why' },
  starRecord: { '@id': 'bq:record', '@type': '@id' },
  starNote: { '@id': 'bq:note' },
  bouquetHead: { '@id': 'bq:currentHead', '@type': '@id' },
  hasPredecessor: { '@id': 'bq:hasPredecessor', '@type': '@id', '@container': '@set' },
  hasDisposition: { '@id': 'bq:hasDisposition', '@type': '@id', '@container': '@set' },
  hasEntityLink: { '@id': 'bq:hasEntityLink', '@type': '@id', '@container': '@set' },
  hasGotcha: { '@id': 'bq:hasGotcha', '@type': '@id', '@container': '@set' },
  hasEvidence: { '@id': 'bq:hasEvidence', '@type': '@id', '@container': '@set' },
  starCount: { '@id': 'bq:starCount', '@type': 'xsd:integer' },
  hasRetrieval: { '@id': 'bq:hasRetrieval', '@type': '@id' },
  queryShape: { '@id': 'bq:queryShape' },
  retrievalQuestion: { '@id': 'bq:question' },
  gate: { '@id': 'bq:gate' },
  fuse: { '@id': 'bq:fuse' },

  // ── WALK (wk: agentic-run trace view) ──
  // The run/turn/call VIEW nodes (wk:) of a JSONL trace. `wk:supersedes` JOINs a
  // WRITE turn's new record to the old one (the same lineage the Plot beds show).
  runId: { '@id': 'wk:runId' },
  question: { '@id': 'wk:question' },
  gold: { '@id': 'wk:gold' },
  finalAnswer: { '@id': 'wk:finalAnswer' },
  graphId: { '@id': 'wk:graphId' },
  turnCount: { '@id': 'wk:turnCount', '@type': 'xsd:integer' },
  runCount: { '@id': 'wk:runCount', '@type': 'xsd:integer' },
  supersessionCount: { '@id': 'wk:supersessionCount', '@type': 'xsd:integer' },
  hasRun: { '@id': 'wk:hasRun', '@type': '@id', '@container': '@set' },
  hasTurn: { '@id': 'wk:hasTurn', '@type': '@id', '@container': '@set' },
  hasCall: { '@id': 'wk:hasCall', '@type': '@id', '@container': '@set' },
  turnIndex: { '@id': 'wk:turnIndex', '@type': 'xsd:integer' },
  phase: { '@id': 'wk:phase' },
  reasoning: { '@id': 'wk:reasoning' },
  stopReason: { '@id': 'wk:stopReason' },
  toolName: { '@id': 'wk:toolName' },
  toolArguments: { '@id': 'wk:toolArguments' },
  toolResult: { '@id': 'wk:toolResult' },
  isError: { '@id': 'wk:isError', '@type': 'xsd:boolean' },
  inputTokens: { '@id': 'wk:inputTokens', '@type': 'xsd:integer' },
  outputTokens: { '@id': 'wk:outputTokens', '@type': 'xsd:integer' },
  totalTokens: { '@id': 'wk:totalTokens', '@type': 'xsd:integer' },
  costUsd: { '@id': 'wk:costUsd', '@type': 'xsd:decimal' },
  supersedesEdge: { '@id': 'wk:supersedes', '@type': '@id' },
  supersededEdge: { '@id': 'wk:superseded', '@type': '@id' },
  // The Plot bed rootId(s) a run MINTED (the reverse cross-surface join, from the
  // run_end edges' OLD records). A short-id literal (the bed's URL key), so it
  // round-trips losslessly without needing the host's baseUrl to mint an IRI.
  mintedBed: { '@id': 'wk:mintedBed', '@container': '@set' },

  // ── Sophia Memory (rz: observatory view + mem: record predicates) ──
  // The plot/subject VIEW nodes (rz:) and the record-level mem: predicates the
  // turtle/json faces carry verbatim from the live :projection:memory store.
  asOf: { '@id': 'rz:asOf' },
  subjectCount: { '@id': 'rz:subjectCount', '@type': 'xsd:integer' },
  rootId: { '@id': 'rz:rootId' },
  topic: { '@id': 'rz:topic' },
  recordTotal: { '@id': 'rz:recordTotal', '@type': 'xsd:integer' },
  activeCount: { '@id': 'rz:activeCount', '@type': 'xsd:integer' },
  supersededCount: { '@id': 'rz:supersededCount', '@type': 'xsd:integer' },
  hasSubject: { '@id': 'rz:hasSubject', '@type': '@id', '@container': '@set' },
  hasRecord: { '@id': 'rz:hasRecord', '@type': '@id', '@container': '@set' },
  currentHead: { '@id': 'rz:currentHead', '@type': '@id' },
  // mem: record predicates (the live store's own terms).
  content: { '@id': 'mem:content' },
  kind: { '@id': 'mem:kind' },
  status: { '@id': 'mem:status' },
  scope: { '@id': 'mem:scope' },
  contentOrientation: { '@id': 'mem:contentOrientation' },
  createdAt: { '@id': 'mem:createdAt', '@type': 'xsd:dateTime' },
  observedAt: { '@id': 'mem:observedAt', '@type': 'xsd:dateTime' },
  observer: { '@id': 'mem:observer' },
  supersedes: { '@id': 'mem:supersedes', '@type': '@id' },

  // ── DisplayKind value wrapper (dk:) ──
  displayKind: { '@id': 'dk:kind' },
  displayValue: { '@id': 'dk:value' },
  displayLabel: { '@id': 'dk:label' },
  displayUnit: { '@id': 'dk:unit' },
  displayHref: { '@id': 'dk:href' },
  displayStance: { '@id': 'dk:stance' },
  displayObserver: { '@id': 'dk:observer' },
  displayObservedAt: { '@id': 'dk:observedAt', '@type': 'xsd:integer' },
  displayCapturedAt: { '@id': 'dk:capturedAt', '@type': 'xsd:integer' },
  displayPreviousValue: { '@id': 'dk:previousValue' },
  displayPreviousCapturedAt: { '@id': 'dk:previousCapturedAt', '@type': 'xsd:integer' },

  // ── Emporium vocab-catalogue vocab (the catalogue OF vocabularies) ──
  vocabName: { '@id': 'emp:vocabName' },
  vocabVersion: { '@id': 'emp:version' },
  namespace: { '@id': 'emp:namespace' },
  sha: { '@id': 'emp:sha' },
  vocabCount: { '@id': 'emp:count', '@type': 'xsd:integer' },
  description: { '@id': 'emp:description' },
  hasVocab: { '@id': 'emp:hasVocab', '@type': '@id', '@container': '@set' },
  hasClass: { '@id': 'emp:hasClass', '@type': '@id', '@container': '@set' },
  hasPredicate: { '@id': 'emp:hasPredicate', '@type': '@id', '@container': '@set' },
  hasRelationship: { '@id': 'emp:hasRelationship', '@type': '@id', '@container': '@set' },
  hasNamespace: { '@id': 'emp:hasNamespace', '@type': '@id', '@container': '@set' },
  className: { '@id': 'emp:className' },
  predicateName: { '@id': 'emp:predicateName' },
  datatype: { '@id': 'emp:datatype' },
  required: { '@id': 'emp:required', '@type': 'xsd:boolean' },
  multi: { '@id': 'emp:multi', '@type': 'xsd:boolean' },

  // ── deepened pack anatomy (closed enums, class→class edges, minting, stats) ──
  // enum allowed values — an ORDERED list (@list) so declared order round-trips.
  enumValue: { '@id': 'emp:enumValue', '@container': '@list' },
  // a predicate's object-property range → the pack class it points at.
  relatesTo: { '@id': 'emp:relatesTo' },
  // the class's subject-minting rule (golden subject_rule).
  subjectRule: { '@id': 'emp:subjectRule' },
  // a class→class relationship edge (predicate range OR CRDT wire rule).
  relFrom: { '@id': 'emp:relFrom' },
  relTo: { '@id': 'emp:relTo' },
  relPredicate: { '@id': 'emp:relPredicate' },
  relKind: { '@id': 'emp:relKind' },
  relNote: { '@id': 'emp:relNote' },
  // pack-level namespace rows + minting rules.
  nsPrefix: { '@id': 'emp:nsPrefix' },
  nsUri: { '@id': 'emp:nsUri' },
  slugPattern: { '@id': 'emp:slugPattern' },
  slugReplacement: { '@id': 'emp:slugReplacement' },
  slugLowercase: { '@id': 'emp:slugLowercase', '@type': 'xsd:boolean' },
  uriRule: { '@id': 'emp:uriRule' },
  docIdRule: { '@id': 'emp:docIdRule' },
  ruleTemplate: { '@id': 'emp:ruleTemplate' },
  ruleValue: { '@id': 'emp:ruleValue' },
  hasUriRule: { '@id': 'emp:hasUriRule', '@type': '@id', '@container': '@set' },
  hasDocIdRule: { '@id': 'emp:hasDocIdRule', '@type': '@id', '@container': '@set' },
  // derived stats.
  classCount: { '@id': 'emp:classCount', '@type': 'xsd:integer' },
  predicateCount: { '@id': 'emp:predicateCount', '@type': 'xsd:integer' },
  relationshipCount: { '@id': 'emp:relationshipCount', '@type': 'xsd:integer' },

  // ── component / catalog vocab ──
  persistence: { '@id': 'comp:persistence' },
  face: { '@id': 'comp:face' },
  blurb: { '@id': 'comp:blurb' },
  tag: { '@id': 'comp:tag' },
  manifested: { '@id': 'comp:manifested', '@type': 'xsd:boolean' },
  built: { '@id': 'comp:built', '@type': 'xsd:boolean' },
  summary: { '@id': 'cat:summary' },
  count: { '@id': 'cat:count', '@type': 'xsd:integer' },
  entries: { '@id': 'cat:hasEntry', '@type': '@id', '@container': '@set' },

  // ── sux: workspace vocab (so the workspace JSON-LD face is readable too) ──
  localId: { '@id': 'sux:localId' },
  renderedByComponent: { '@id': 'sux:renderedByComponent' },
  hasRegion: { '@id': 'sux:hasRegion', '@type': '@id', '@container': '@set' },
  hasPanel: { '@id': 'sux:hasPanel', '@type': '@id', '@container': '@set' },
  hasDimension: { '@id': 'sux:hasDimension', '@type': '@id', '@container': '@set' },
  hasValue: { '@id': 'sux:hasValue', '@type': '@id', '@container': '@set' },
  hasRootEntry: { '@id': 'sux:hasRootEntry', '@type': '@id', '@container': '@set' },
  hasAppRootEntry: { '@id': 'sux:hasAppRootEntry', '@type': '@id', '@container': '@set' },
  childRegion: { '@id': 'sux:childRegion', '@type': '@id' },
  docksPanel: { '@id': 'sux:docksPanel', '@type': '@id', '@container': '@set' },
  rootRegion: { '@id': 'sux:rootRegion', '@type': '@id' },
  defaultValue: { '@id': 'sux:defaultValue' },
  defaultVisible: { '@id': 'sux:defaultVisible', '@type': 'xsd:boolean' },
  collapsible: { '@id': 'sux:collapsible', '@type': 'xsd:boolean' },
  resizable: { '@id': 'sux:resizable', '@type': 'xsd:boolean' },
  order: { '@id': 'sux:order', '@type': 'xsd:integer' },
  ordinalIndex: { '@id': 'sux:ordinalIndex', '@type': 'xsd:integer' },
  atIndex: { '@id': 'sux:atIndex', '@type': 'xsd:integer' },
  sizeFraction: { '@id': 'sux:sizeFraction', '@type': 'xsd:decimal' },
  splitOrientation: { '@id': 'sux:splitOrientation' },
  dockState: { '@id': 'sux:dockState' },
  literalValue: { '@id': 'sux:literalValue' },
  appliesAttribute: { '@id': 'sux:appliesAttribute' },
  forApp: { '@id': 'sux:forApp' },
})
