/**
 * target.ts — the render-target abstraction (the heart of the SFDM design).
 *
 * `RenderTarget` is a PARAMETER. `planFor`/the resource model is target-agnostic;
 * `renderResource(resource, target, ctx)` dispatches to one of four FACES of the
 * SAME resource:
 *
 *   dom        — serialized HTML (lives in @shrubbery/runtime; out of scope here)
 *   hypertext  — beautiful markdown + a "Navigate" curl block + the AltLinks
 *   turtle     — RDF/Turtle (reuses nucleus serializeConfigToTriples for configs)
 *   json       — compacted JSON-LD (jsonld.fromRDF → compact w/ the shared @context)
 *
 * Content negotiation (one URL grammar, four faces) is an APP/TOOLING concern —
 * the local conneg dev server maps Accept→target and an explicit `.ext` wins.
 * THIS module is the pure library: it only knows how to render a face + advertise
 * its siblings via `links`.
 *
 * Pure: no Lit, no DOM, no network.
 */

import type { Attributed, DisplayKind, Recency, Stance, WorkspaceConfig } from '@shrubbery/nucleus'

// ── The four faces ────────────────────────────────────────────────────────────

/** The render target — `dom` | `hypertext` | `turtle` | `json` (json = JSON-LD). */
export type RenderTarget = 'dom' | 'hypertext' | 'turtle' | 'json'

/** The text faces this pure package renders (`dom` is the runtime/Lit face). */
export type TextTarget = Exclude<RenderTarget, 'dom'>

/** FAIR Signposting / RFC 8288 link relation. */
export type LinkRel =
  | 'self'
  | 'alternate'
  | 'up'
  | 'collection'
  | 'item'
  | 'describedby'
  | 'related'

/** One advertised neighbor/sibling of a resource (→ Link header + Navigate block). */
export interface AltLink {
  readonly rel: LinkRel
  readonly href: string
  readonly type: string
  readonly title?: string
}

/** The rendered output of one face of one resource. */
export interface RenderedResource {
  /** The serialized body for this face (markdown / turtle / JSON-LD text). */
  readonly body: string
  /** The HTTP `Content-Type` for this face. */
  readonly contentType: string
  /**
   * The OTHER faces of THIS resource + its neighbors — Link headers + the
   * in-body Navigate block. Identical set across all four faces of one resource
   * (the "Link-set parity" invariant the tests pin).
   */
  readonly links: readonly AltLink[]
}

// ── Content types (one place, so faces never disagree) ────────────────────────

export const CONTENT_TYPE: Readonly<Record<RenderTarget, string>> = Object.freeze({
  dom: 'text/html; charset=utf-8',
  hypertext: 'text/markdown; charset=utf-8',
  turtle: 'text/turtle; charset=utf-8',
  json: 'application/ld+json; charset=utf-8',
})

/** The path extension that pins each face (explicit `.ext` wins in conneg). */
export const FACE_EXT: Readonly<Record<RenderTarget, string>> = Object.freeze({
  dom: 'html',
  hypertext: 'md',
  turtle: 'ttl',
  json: 'json',
})

// ── The resource model — what gets rendered to the four faces ─────────────────

/**
 * A single component as the catalog presents it (one row, derived from the
 * MANIFEST + built-chrome set). This is the EXISTING catalog data (iter-3
 * `CatalogEntry`) passed in as a parameter — the render package never imports the
 * tooling-level catalog, it renders whatever resource model the host hands it.
 */
export interface CatalogComponent {
  /** The custom-element tag — the join key across all faces. */
  readonly tag: string
  /** The engine persistence class (Class A/B/C). */
  readonly persistence: string
  /** Whether the engine MANIFEST knows this tag. */
  readonly manifested: boolean
  /** Whether shrubbery has BUILT (registered) this tag. */
  readonly built: boolean
  /** Which face the entry is presented under (`built-chrome` | `manifest-panel`). */
  readonly face: string
  /** A short human note (a description of the real component — not mock data). */
  readonly blurb: string
}

/**
 * The catalog COLLECTION resource — the third/fourth face of the one catalog,
 * alongside Storybook + the manifest. Rendered to all four faces.
 */
export interface CatalogResource {
  readonly kind: 'catalog'
  /** Stable local id, e.g. 'catalog'. */
  readonly id: string
  readonly title: string
  readonly summary: string
  /** The component rows (derived from the manifest + built chrome). */
  readonly components: readonly CatalogComponent[]
}

/**
 * A single catalog-item resource — one component seen on its own page (the
 * `…/catalog/{tag}` item face).
 */
export interface ComponentResource {
  readonly kind: 'component'
  readonly component: CatalogComponent
}

/**
 * A workspace resource — a `WorkspaceConfig` (e.g. GARDEN_DEFAULT) rendered as a
 * curl resource. Its turtle face reuses nucleus serializeConfigToTriples verbatim.
 */
export interface WorkspaceResource {
  readonly kind: 'workspace'
  readonly config: WorkspaceConfig
}

// ── Emporium vocab catalogue (the KG-layer catalogue of vocabularies) ─────────
//
// EMPORIUM is the catalogue of VOCABULARIES (the golden contract packs). "The
// pack IS the catalog." A gardend cell serves it live at:
//   GET /emporium/vocabs                  → { vocabularies: VocabSummary[] }
//   GET /emporium/vocab/{name}/{version}  → the golden contract JSON (classes…)
// The render package is target-agnostic + network-free: it renders whatever vocab
// data the HOST (the shell, which reads the cell live) hands it — it never fetches.

/** One vocabulary's catalogue summary (the row in GET /emporium/vocabs). */
export interface VocabSummary {
  readonly name: string
  readonly version: string
  readonly namespace: string
  readonly sha: string
  readonly title: string
}

/**
 * The golden contract pack of ONE vocabulary (a view of
 * GET /emporium/vocab/{name}/{version}). We carry the FULL anatomy the Emporium
 * pack-detail view renders: the summary fields, the classes (each with its
 * predicates, datatype/required/multi, subject-minting rule, and closed enums),
 * the namespace table, the class→class RELATIONSHIPS (predicate links + CRDT
 * wire rules), and the pack-level minting (slug) rule + STATS.
 *
 * These fields are PURE DATA the shell-side read-model (apps/organism
 * emporium-client) parses out of the live golden contract — the render package
 * stays network-free; it only ever RENDERS the shape, never fetches it. Every
 * field is OPTIONAL so a trimmed pack (or a contract that omits a section) still
 * deserializes losslessly and the views show an honest absence, never a fake.
 */

/** A single allowed-value set for a CLOSED ENUM predicate (e.g. mem:sourceKind). */
export interface VocabEnum {
  /** The enum predicate's CURIE (the same as the owning VocabClassPredicate.name). */
  readonly predicate: string
  /** The allowed values, in declared order (e.g. ['user','agent',…]). */
  readonly values: readonly string[]
}

export interface VocabClassPredicate {
  readonly name: string
  readonly datatype?: string
  readonly required?: boolean
  readonly multi?: boolean
  /**
   * The CLOSED-ENUM allowed value set, when the contract declares one for this
   * predicate (parsed from the golden `source` `enum: a|b|c` convention). Absent
   * for free predicates — never a fake empty set.
   */
  readonly enumValues?: readonly string[]
  /**
   * The name of ANOTHER class in this pack this predicate's value points at, when
   * this is an object property (`datatype:'uri'`) whose range resolves to a pack
   * class (e.g. wf:partOfWorkflow → Workflow). Drives the RELATIONSHIPS view.
   */
  readonly relatesTo?: string
}

export interface VocabClass {
  readonly name: string
  readonly predicates: readonly VocabClassPredicate[]
  readonly rdfTypes?: readonly string[]
  /** The class's subject-minting convention (golden `subject_rule`), when declared. */
  readonly subjectRule?: string
}

/**
 * A class→class RELATIONSHIP edge: a directed link FROM one pack class TO
 * another. Two provenances both surface here:
 *   - `predicate` edges — a `datatype:'uri'` predicate whose range is a pack
 *     class (from→pred→to, e.g. AgentNode →wf:partOfWorkflow→ Workflow).
 *   - `wire` edges — a CRDT doc-connection rule (golden `wires`: from_kind →
 *     to_kind via a predicate, e.g. node doc →flowsInto→ node doc).
 */
export interface VocabRelationship {
  /** The source class name (a pack class). */
  readonly from: string
  /** The target class name (a pack class). */
  readonly to: string
  /** The linking predicate CURIE (or wire short-name). */
  readonly predicate: string
  /** Where this edge came from: a predicate range, or a CRDT wire rule. */
  readonly kind: 'predicate' | 'wire'
  /** Optional human note (from the golden `source`/`comment`). */
  readonly note?: string
}

/** One pack-level minting rule row (slug rule + the per-template URI/doc-id rules). */
export interface VocabMinting {
  /** The slug regex pattern (golden `slug_rule.pattern`). */
  readonly slugPattern?: string
  /** The slug replacement char (golden `slug_rule.replacement`). */
  readonly slugReplacement?: string
  /** Whether slugs are lowercased (golden `slug_rule.lowercase`). */
  readonly slugLowercase?: boolean
  /** Per-template subject-URI rules (golden `uri_rules`: template → rule string). */
  readonly uriRules?: Readonly<Record<string, string>>
  /** Per-template doc-id rules (golden `doc_id_rules`: template → rule string). */
  readonly docIdRules?: Readonly<Record<string, string>>
}

export interface VocabPack {
  readonly name: string
  readonly version: string
  readonly title: string
  readonly namespace: string
  readonly sha?: string
  readonly description?: string
  readonly namespaces?: Readonly<Record<string, string>>
  readonly classes: readonly VocabClass[]
  /**
   * The class→class relationship edges (predicate ranges + CRDT wire rules),
   * derived by the read-model. Empty when the pack declares none.
   */
  readonly relationships?: readonly VocabRelationship[]
  /** The pack's subject/slug minting rules (golden slug_rule + uri/doc-id rules). */
  readonly minting?: VocabMinting
  /** Total predicate count across all classes (a derived STAT). */
  readonly predicateCount?: number
  /** Total class→class relationship count (a derived STAT). */
  readonly relationshipCount?: number
}

/**
 * The Emporium vocab CATALOGUE collection resource — the list of vocab packs the
 * cell serves. The third/fourth curl-able face of the live registry.
 */
export interface VocabResource {
  readonly kind: 'vocab-catalog'
  /** Stable local id, e.g. 'emporium'. */
  readonly id: string
  readonly title: string
  readonly summary: string
  /** One row per vocabulary the cell serves (from GET /emporium/vocabs). */
  readonly vocabs: readonly VocabSummary[]
}

/** A single vocab-pack item resource (the `…/{id}/{name}` golden-contract face). */
export interface VocabPackResource {
  readonly kind: 'vocab-pack'
  readonly pack: VocabPack
}

// ── RHIZOME — the memory observatory (the read-only :projection:memory faces) ──
//
// RHIZOME renders a gardend cell's `:projection:memory` named graph as curl-able
// resources: a PLOT (the index of subject "beds") and one SUBJECT per bed (a
// lineage chain — the current head + its superseded predecessors). The whole
// design point is `?asof`: supersession status is GLOBAL/non-temporal in the
// store, so "what was current as-of T" is RECOMPUTED from mem:createdAt +
// lineage-root grouping (NOT the mutated mem:status flag). A SUBJECT therefore
// carries both an `asOf` stamp (null = "now") and the head it resolves to.
//
// These are PURE DATA shapes the host (the rhizome GardenClient/data layer) reads
// live from the cell over the SPARQL /mcp wire — the render package stays
// network-free; it only ever RENDERS the shape it is handed. Every field that an
// honestly-trimmed record could omit is `?` so an absent triple shows as honest
// absence, never a fake.

/**
 * One memory RECORD as the observatory presents it — a single mem:MemoryRecord
 * node from the live :projection:memory store. `id` is the FULL record IRI (the
 * URN the cell holds) so the turtle/json faces describe the real subject; `localId`
 * is its short hash (the display/lineage key).
 */
export interface MemoryRecord {
  /** The full record IRI (`urn:mnemosyne:local:graph:…:record:<sha>`). */
  readonly id: string
  /** The short display id (first 12 of the record sha). */
  readonly localId: string
  readonly content: string
  /** mem:status — "active" | "superseded" (GLOBAL, non-temporal in this store). */
  readonly status: string
  readonly kind?: string
  /** mem:createdAt — xsd:dateTime; the basis of the as-of recomputation. */
  readonly createdAt?: string
  readonly observedAt?: string
  readonly observer?: string
  readonly scope?: string
  readonly contentOrientation?: string
  /** The record this one supersedes (`mem:supersedes`), if any (the lineage edge). */
  readonly supersedes?: string
}

/**
 * One SUBJECT "bed" — a lineage chain keyed by its root record. Carries the full
 * chain of records (newest-first) PLUS the resolved head:
 *   - `asOf` null  → the NOW view (head = the mem:status="active" record).
 *   - `asOf` a T   → the as-of-then view (head RECOMPUTED = the record with the
 *                    greatest createdAt ≤ T; the status flag is ignored).
 * `head` is the resolved current-as-of record's localId; `records` is the whole
 * bed so the page shows the current head AND its superseded predecessors.
 */
export interface SubjectResource {
  readonly kind: 'mem-subject'
  /** The lineage-root record id (short hash) — the bed's stable URL key. */
  readonly rootId: string
  readonly title: string
  /** A short topic label derived from the head content (e.g. "5K personal best"). */
  readonly topic: string
  /** The as-of stamp this view was resolved at (ISO dateTime), or null = "now". */
  readonly asOf?: string | null
  /** The resolved current-as-of head record's localId. */
  readonly head: string
  /** The whole bed, newest createdAt first (head + superseded predecessors). */
  readonly records: readonly MemoryRecord[]
}

/**
 * The PLOT collection — the index of subject-beds in a cell's :projection:memory.
 * The root observatory resource (`/plot`), with one row per bed.
 */
export interface PlotResource {
  readonly kind: 'mem-plot'
  /** Stable local id, e.g. 'memory'. */
  readonly id: string
  readonly title: string
  readonly summary: string
  /** The as-of stamp the whole plot was resolved at (ISO dateTime), or null = "now". */
  readonly asOf?: string | null
  /** One row per subject-bed (the lineage roots + their head + counts). */
  readonly subjects: readonly PlotSubject[]
}

/** One row of the PLOT — a subject-bed summary (no full record list). */
export interface PlotSubject {
  /** The lineage-root record id (short hash) — the bed's URL key. */
  readonly rootId: string
  /** A short topic label derived from the head content. */
  readonly topic: string
  /** The resolved current-as-of head's content (the headline). */
  readonly headContent: string
  /** The resolved head record's localId. */
  readonly head: string
  /** Total records in the bed. */
  readonly recordTotal: number
  /** How many are mem:status="active" (the NOW currency). */
  readonly activeCount: number
  /** How many are mem:status="superseded". */
  readonly supersededCount: number
}

// ── WALK — the turn-by-turn agentic-session view (a FILE source) ──────────────
//
// The WALK renders an agentic-run TRACE (a JSONL file at lme-bench/out/runs/
// agentic-*.trace.jsonl) as a navigable timeline of turns — the ONE divergence
// from the Plot's SPARQL data layer (the Walk reads FILES, not the cell). A run
// is the agent absorbing a session into durable memory then answering: each turn
// is an observe→think→act step (the model's reasoning + its tool calls + the tool
// results + the token usage/cost), and the run's `supersessionEdges` tie the WRITE
// turns back to the Plot's beds (a `remember` that "met its past self").
//
// These are PURE DATA shapes the host (the rhizome trace reader) parses out of the
// JSONL — the render package stays file-free + network-free; it only RENDERS what
// it is handed. Every field an honestly-trimmed trace could omit is `?`.

/** One tool CALL the model emitted in a turn (the `act` of observe→think→act). */
export interface WalkToolCall {
  /** The tool-call id (joins a call to its result). */
  readonly id: string
  /** The tool name (e.g. `graph_sparql_select` | `remember_memory`). */
  readonly name: string
  /** The call arguments, verbatim (a SPARQL query, a remember payload, …). */
  readonly arguments: Readonly<Record<string, unknown>>
  /**
   * The record this call supersedes, when it is a `remember` that updates an
   * earlier belief (the `supersedes_ref` arg) — the supersession MOMENT, surfaced
   * so the face can highlight where the agent "met its past self".
   */
  readonly supersedesRef?: string
}

/** One tool RESULT for a call (the observation the next turn reasons over). */
export interface WalkToolResult {
  /** The id of the call this answers (`toolCallId`). */
  readonly toolCallId: string
  readonly toolName: string
  /** The result payload, verbatim (JSON text the cell returned). */
  readonly result: string
  readonly isError: boolean
  /**
   * For a `remember` result, the newly-minted record subject — paired with
   * `supersededSubject` it is a confirmed supersession edge (the run's edge set).
   */
  readonly subject?: string
  /** For a `remember` that superseded an older record, the superseded subject. */
  readonly supersededSubject?: string
}

/** Per-turn token usage + cost (USD), when the trace carried it. */
export interface WalkUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly costUsd?: number
}

/**
 * ONE turn of a run — an observe→think→act step. `label` groups turns into the
 * run's phases (e.g. "WRITE answer_…" vs "READ"); `turn` is the 1-based index
 * within that phase. `reasoning` is the model's `rawAssistant` (the think);
 * `toolCalls`/`toolResults` are the act + the observation; `usage` is the cost.
 */
export interface WalkTurn {
  /** The 1-based turn index within its phase. */
  readonly turn: number
  /** The phase label (e.g. "WRITE answer_a25d4a91_1" | "READ"). */
  readonly label: string
  /** The model's reasoning for this turn (the `rawAssistant` text). */
  readonly reasoning: string
  /** Why the model stopped this turn (`toolUse` | `stop`). */
  readonly stopReason?: string
  /** The tool calls the model emitted (the act). */
  readonly toolCalls: readonly WalkToolCall[]
  /** The tool results (the observation). */
  readonly toolResults: readonly WalkToolResult[]
  /** Token usage + cost for the turn. */
  readonly usage?: WalkUsage
  /**
   * Whether this turn carries a SUPERSESSION moment — a `remember` with a
   * `supersedesRef` (or a confirming result `supersededSubject`). The face
   * highlights it ("met its past self").
   */
  readonly supersedes: boolean
}

/** A confirmed run-level supersession edge (run_end): new record → old record. */
export interface WalkEdge {
  readonly newUrn: string
  readonly oldUrn: string
}

/**
 * ONE run's WALK — the turn-by-turn agentic session. `id` is the run id (the
 * trace file's numeric stamp); `question`/`gold` frame the task; `turns` is the
 * ribbon; `supersessionEdges` are the confirmed updates (each ties a WRITE to a
 * Plot bed). The `?turn=N` lens (the Walk's analog of `?asof`) positions a cursor.
 */
export interface WalkResource {
  readonly kind: 'walk-run'
  /** The run id (the trace file's numeric stamp), e.g. '1781976018654'. */
  readonly id: string
  readonly title: string
  /** The graph the run wrote into (joins back to the Plot). */
  readonly graphId: string
  /** The question the run answered. */
  readonly question: string
  /** The gold answer (the benchmark target). */
  readonly gold: string
  /** The run's final answer. */
  readonly finalAnswer: string
  /** The whole ribbon of turns (in trace order). */
  readonly turns: readonly WalkTurn[]
  /** The confirmed supersession edges (run_end) — each ties a WRITE to a bed. */
  readonly supersessionEdges: readonly WalkEdge[]
  /** The turn cursor (`?turn=N`), or null = the whole run. */
  readonly turnCursor?: number | null
}

/** One row of the WALK INDEX — a run summary (no full turn list). */
export interface WalkIndexRun {
  /** The run id (the trace file's numeric stamp) — the bed's URL key. */
  readonly id: string
  readonly question: string
  readonly gold: string
  /** Total turns across all phases. */
  readonly turnCount: number
  /** How many confirmed supersession edges the run wrote. */
  readonly supersessionCount: number
  readonly finalAnswer: string
  /**
   * The Plot bed rootIds this run MINTED — the short lineage-root id of each
   * supersession edge's OLD record (the bed the run "met its past self" in). Drives
   * the REVERSE cross-surface join (a Plot bed → the run that minted its head); the
   * forward join (a run → its beds) is the run's rel=related links. Empty for a
   * read-only run that superseded nothing — never faked.
   */
  readonly supersededRoots: readonly string[]
}

/**
 * The WALK INDEX collection — the list of agentic runs the reader found (one per
 * trace file). The root walk resource (`/walk`), with one row per run.
 */
export interface WalkIndexResource {
  readonly kind: 'walk-index'
  /** Stable local id, e.g. 'walk'. */
  readonly id: string
  readonly title: string
  readonly summary: string
  /** One row per run (the trace files). */
  readonly runs: readonly WalkIndexRun[]
}

// ── BOUQUET — the READ-side constellation reader (Benjamin: a configuration) ───
//
// THE BOUQUET is the counterpart to the Walk's WRITE-side: opening a belief blooms
// a CONSTELLATION of stars, each annotated with WHY it was chosen — the bright
// CURRENT head (the answer), the dimmed dated STRUCK predecessors (resolved
// conflicts, what the head superseded), the STANDING dispositions, the ENTITY
// links (sibling beds about the same subject), the GOTCHAS (e.g. an Event that
// must NOT be superseded), and the MINIMAL verbatim EVIDENCE that grounds the head
// (an episodic fragment whose content carries the head's key terms). It surfaces
// RETRIEVAL reasoning (the ClassifyQueryShape verdict, gate→fuse) the way the Walk
// surfaces WRITE reasoning. Meaning is never one row — it is the whole bloom.
//
// DETERMINISTIC, no LLM: the data layer assembles the constellation from
// :projection:memory via SPARQL (the current head, the supersession lineage, the
// same-subject standing dispositions, the entity links, the episodic evidence).
// `?asof` recomputes the head from mem:createdAt (the same lens the Plot uses), so
// the bloom can be read at any point in the belief's history. Pure data the host
// (the rhizome BouquetWorld) reads live; the render package only RENDERS the shape.

/**
 * WHY a star is in the constellation — the annotation that turns a row into a
 * configuration. A CLOSED set so the faces (and the DOM bloom) agree on the
 * vocabulary:
 *   - 'current'           — the bright head: the answer (mem:status active / the
 *                           as-of-resolved head).
 *   - 'resolved-conflict' — a dimmed dated STRUCK predecessor (what the head
 *                           superseded; a resolved conflict in the lineage).
 *   - 'standing'          — a standing DISPOSITION about the same subject (a
 *                           durable trait, not a superseded fact).
 *   - 'entity-link'       — a sibling bed about the SAME subject/entity (another
 *                           active head sharing a salient term).
 *   - 'gotcha'            — a star that must be read with care (e.g. an Event that
 *                           must NOT be superseded — a do-not-strike marker).
 *   - 'evidence'          — the minimal verbatim episodic fragment grounding the
 *                           head (the floor the belief rests on).
 */
export type StarWhy =
  | 'current'
  | 'resolved-conflict'
  | 'standing'
  | 'entity-link'
  | 'gotcha'
  | 'evidence'

/**
 * One STAR of the constellation — a memory record positioned in the bloom with the
 * WHY that earned it its place. `record` is the underlying record (the verbatim
 * content + the store's own predicates); `why` is the annotation; `note` is an
 * optional human-legible reason (e.g. "head as-of 2023-05-30" / "shares term
 * `charity run`"). The same MemoryRecord may appear once — the bloom is a SET of
 * annotated stars, not a re-listing of the chain.
 */
export interface BouquetStar {
  /** The annotation that earned this star its place in the constellation. */
  readonly why: StarWhy
  /** The underlying memory record (verbatim content + the store's predicates). */
  readonly record: MemoryRecord
  /** A short human-legible reason (e.g. "shares term `charity run`"), when known. */
  readonly note?: string
}

/**
 * The RETRIEVAL reasoning surfaced alongside the bloom — the read-side analog of
 * the Walk's write reasoning. Carries the ClassifyQueryShape verdict (the query
 * shape the reader resolved to) and the gate→fuse trace, when a question-driven
 * read produced one. DETERMINISTIC subject reads (the default) carry the
 * deterministic verdict ("lineage-head"); a replayed agentic READ carries the real
 * captured trace. Every field is `?` so a pure deterministic bloom omits the bits
 * it has no honest value for, never faking a verdict.
 */
export interface BouquetRetrieval {
  /** The ClassifyQueryShape verdict (e.g. 'lineage-head' | 'temporal' | 'count'). */
  readonly queryShape?: string
  /** The question that drove the read (a question-driven bloom), when present. */
  readonly question?: string
  /** The gate verdict (the retrieval gate's keep/drop reasoning), verbatim. */
  readonly gate?: string
  /** The fuse output (the FUSE step's synthesized answer), verbatim. */
  readonly fuse?: string
}

/**
 * ONE BOUQUET — the constellation that blooms when a belief (a subject bed) is
 * opened. The bright `currentHead` is the answer; `predecessors` are the dimmed
 * struck stars (resolved conflicts); `dispositions` are the standing traits;
 * `entityLinks` are the sibling beds about the same subject; `gotchas` are the
 * do-not-strike markers; `evidence` is the minimal verbatim episodic floor;
 * `stars` is the WHOLE bloom (every annotated star, the configuration); `retrieval`
 * is the surfaced read reasoning. `asOf` (null = now) recomputes the head from
 * mem:createdAt — the same temporal lens the Plot uses.
 */
export interface BouquetResource {
  readonly kind: 'mem-bouquet'
  /** The lineage-root record id (short hash) — the bed's stable URL key. */
  readonly rootId: string
  readonly title: string
  /** A short topic label derived from the head content (e.g. "5K personal best"). */
  readonly topic: string
  /** The as-of stamp this bloom was resolved at (ISO dateTime), or null = "now". */
  readonly asOf?: string | null
  /** The bright CURRENT head — the answer (the as-of-resolved head). */
  readonly currentHead: MemoryRecord
  /** The dimmed dated STRUCK predecessors (resolved conflicts the head superseded). */
  readonly predecessors: readonly MemoryRecord[]
  /** The STANDING dispositions about the same subject (durable traits). */
  readonly dispositions: readonly MemoryRecord[]
  /** The ENTITY links — sibling beds about the same subject (active heads). */
  readonly entityLinks: readonly BouquetStar[]
  /** The GOTCHAS — do-not-strike markers (e.g. an Event that must NOT be superseded). */
  readonly gotchas: readonly BouquetStar[]
  /** The minimal verbatim EVIDENCE (episodic fragments grounding the head), or empty. */
  readonly evidence: readonly MemoryRecord[]
  /** The WHOLE bloom — every annotated star (the configuration), in render order. */
  readonly stars: readonly BouquetStar[]
  /** The surfaced RETRIEVAL reasoning (ClassifyQueryShape verdict, gate→fuse). */
  readonly retrieval: BouquetRetrieval
}

// ── GREENHOUSE — the cultivation knobs (the tuning :tune: ConfigDimensions) ────
//
// THE GREENHOUSE is the fourth RHIZOME surface (greenhouse-design-20260620): the
// climate house where the gardener tunes HOW the agent forms + reaches its beliefs.
// Every knob is a `tn:ConfigDimension` resource in the NON-RESERVED `:tune:` named
// graph (a sibling of `:projection:`, open to config writes the way `:projection:`
// is authority-walled). A knob carries:
//   - its CONFIG VALUE (the current setting; read from :tune:, default-shown when
//     the graph holds none yet) + per-axis sub-settings (the two JUDGMENT forks are
//     multi-axis), each PATCH-able,
//   - a LIVE-EFFECT METER — a DERIVED read (a SPARQL/COUNT over :projection:memory,
//     NEVER a stored field): the current CONSEQUENCE of the setting, computed at
//     render time, so turning the dial is never blind,
//   - PROVENANCE (justifiedBy → a bench:Run, createdBy, createdAt) — self-documenting
//     + dated, so the `?asof` scrubber can re-render the knob's past value.
//
// The CONFIG knobs (tier/salience/cutoff/laws/spend + supersession-as-policy) are
// READ-FIRST: the meters + GET faces are REAL now; a PATCH lands in :tune: but is
// honestly badged "staged (WP5.2)" — the write-through to the live runtime inherits
// the ux_seed cliff. ENTITY-RESOLUTION is the exception: it WRITES FOR REAL (the
// merge/collapse layer in entity-resolution.ts), so its meter changes 3→1 live.
//
// These are PURE DATA shapes the host (the rhizome greenhouse-world) computes from
// the live cell — the render package stays network-free; it only RENDERS the shape.

/** The knob FAMILY — the §2 common-region zone a knob shares (P1 grouping). */
export type KnobFamily = 'CLIMATE' | 'JUDGMENT' | 'REACH' | 'LAWS' | 'METER & SPEND'

/** Whether a knob's write is real-now, staged-until-WP5.2, or read-only by design. */
export type KnobWriteMode = 'live' | 'staged' | 'read-only'

/**
 * ONE LIVE-EFFECT METER reading — the DERIVED consequence of a knob's current
 * setting, measured against the real `:projection:memory` (+ bench:) at render time.
 * `value`/`target` drive the VU bar; `green` is the verdict (clean ↔ flagging); the
 * `offenders` name the verbatim culprits (e.g. "both active: 27:12 AND 25:50 (user ·
 * 5K-PB)") so a RED meter is tangible, never an abstract number.
 */
export interface KnobMeter {
  /** A short label for what the meter measures (e.g. "(entity,attribute) with ≥2 active heads"). */
  readonly label: string
  /** The measured count (e.g. how many subjects leak two heads). */
  readonly value: number
  /** The target the dial aims at (e.g. 0 misses, distinct-subjects = 1). */
  readonly target: number
  /** Verdict: true = at-or-below target (clean/quiet, P7); false = flagging (RED). */
  readonly green: boolean
  /** The verbatim offenders a RED meter names (empty when clean). */
  readonly offenders: readonly string[]
  /** An optional unit/suffix for the displayed value (e.g. "$", "GB", "%"). */
  readonly unit?: string
  /**
   * Whether this meter is a REAL derived read (default true) or a not-yet-measured
   * PLACEHOLDER (false). A placeholder (e.g. a 0/0 escalation rate, a stubbed budget
   * spend) must NOT render with the same confident green-tick weight as a genuinely-
   * derived clean pass (P7 — "don't spend weight on absence"): the surface demotes a
   * `measured:false` meter to a quiet "not yet measured" state so the gardener is not
   * told a wager is winning when nothing was actually counted.
   */
  readonly measured?: boolean
}

/** One independently-PATCHable AXIS of a multi-axis knob (the JUDGMENT forks). */
export interface KnobAxis {
  /** The axis key (e.g. `onSameEntityAttrState`). */
  readonly key: string
  /** A human label for the axis. */
  readonly label: string
  /** The current value of this axis (e.g. "confident", "add-only"). */
  readonly value: string
  /** The ordered choices for this axis (drives the selector / the VU position). */
  readonly choices: readonly string[]
  /** Whether this axis is LOCKED (e.g. Events never supersede — the dangerous flip). */
  readonly locked?: boolean
  /** A short why/consider note (the quiet P4 layer). */
  readonly note?: string
}

/** A LAWS legend row — the world-model lifecycle taxonomy-as-code (P3 one-liner). */
export interface KnobLaw {
  /** The world-model class (Entity / Event / State / Relation / Disposition). */
  readonly kind: string
  /** The one-line rule (e.g. "supersedes-same-attr", "never-superseded"). */
  readonly rule: string
  /** The full law text (the P3 details-on-demand expansion). */
  readonly detail: string
}

/**
 * ONE KNOB — a `tn:ConfigDimension` rendered to all four faces. The GET face reads
 * `value` + `meter` + provenance; the markdown face IS the docs; `?asof` reads its
 * past value. The marquee knob (`focal: true`) is the surface's P0 focal element.
 */
export interface KnobResource {
  readonly kind: 'tn-knob'
  /** Stable local id / URL key (e.g. 'supersession-conservatism'). */
  readonly id: string
  /** Human title (e.g. "supersession conservatism"). */
  readonly title: string
  /** The family common-region zone (P1). */
  readonly family: KnobFamily
  /** The registered lucide glyph for the knob (never emoji). */
  readonly glyph: string
  /** Whether this is the marquee focal knob (the P0 RED miss-meter). */
  readonly focal: boolean
  /** A short blurb / what the dial governs. */
  readonly summary: string
  /** The current scalar value (the single-setting knobs) — e.g. "T1", "0.92", "verbatim". */
  readonly value: string
  /** The multi-axis settings (the JUDGMENT forks); empty for a single-value knob. */
  readonly axes: readonly KnobAxis[]
  /** The choices for a single-value knob (the strategy/tier selector); empty for axis knobs. */
  readonly choices: readonly string[]
  /** The LIVE-EFFECT METER (the derived consequence read). */
  readonly meter: KnobMeter
  /** The LAWS legend rows (only the world-model-lifecycle knob carries these). */
  readonly laws: readonly KnobLaw[]
  /** Whether the knob's write is live / staged-WP5.2 / read-only. */
  readonly writeMode: KnobWriteMode
  /** The bench:Run id that justifies the current value (provenance), or null. */
  readonly justifiedBy?: string | null
  /** Who set the current value (provenance). */
  readonly createdBy?: string | null
  /**
   * When the current value was set — EPOCH MS (the carrier register, R4c). The
   * host parses the SPARQL wire's xsd:dateTime ISO string into epoch ms at the
   * boundary; the faces re-derive xsd:dateTime via `epochMsToIso`. The basis of
   * the as-of recompute.
   */
  readonly createdAt?: number | null
  /** The as-of stamp this knob view was resolved at (null = now). */
  readonly asOf?: string | null
  /**
   * The Plot bed rootId this knob governs (the cross-surface join — a knob → the bed
   * it tunes). For the JUDGMENT knobs this is the 5K bed; absent for the global knobs.
   */
  readonly governsBed?: string | null
}

/**
 * THE GREENHOUSE — the index collection of all knobs (the `/tune` root resource),
 * grouped by family. The marquee miss-meter (the focal knob's) is the P0 element;
 * the families are the common-region zones.
 */
export interface GreenhouseResource {
  readonly kind: 'tn-greenhouse'
  /** Stable local id, e.g. 'greenhouse'. */
  readonly id: string
  readonly title: string
  readonly summary: string
  /** The as-of stamp the whole surface was resolved at (null = now). */
  readonly asOf?: string | null
  /** Every knob, in the stable family order (the §2 table). */
  readonly knobs: readonly KnobResource[]
}

// ── MITHRAS FLOW — the board as a curl-able resource (FLOW-SHRUB-1a, unit S5) ──
//
// A Flow board's RESOURCE half (the geometry-stripped row model — the board
// Y.Doc's `resource` root re-joined into plain rows, interfaces.md §B/§C)
// rendered to the four faces, bypassing the face registry on the planter
// source-page precedent, "so one board is reachable as turtle and JSON without
// a browser". The triple production mirrors contracts/vocabulary-map.md — the
// SAME map the gardend cell's `:projection:flow` materializer implements — so
// the turtle face and the cell's dump describe identical subjects.
//
// This package stays Lit-free and APP-free: `FlowBoardRows` is a minimal pure
// row model defined HERE (keyed by the 13 DDL table names); apps/flow adapts
// its Y.Doc-derived `Model` to it (geometry stripped, camelCase JSON keys
// mapped to the DDL spellings). The scene half (placement/extent/waypoints)
// never enters this type — geometry is not a resource fact.

/** The 13 Flow DDL table names, in Flow's own `emptyModel()` order. */
export type FlowTableName =
  | 'systems'
  | 'requirements'
  | 'tasks'
  | 'workflows'
  | 'workflow_links'
  | 'outcomes'
  | 'trades'
  | 'trade_links'
  | 'constraints'
  | 'constraint_links'
  | 'sources'
  | 'edges'
  | 'deps'

/** A Flow row scalar (the DDL's own value space; null = SQL NULL). */
export type FlowScalar = string | number | boolean | null

/**
 * One geometry-stripped row: `id` plus the table's resource columns by their
 * DDL names (`parent_id`, `sort_order`, …). Geometry keys (x/y/width/height/
 * waypoints) must already be stripped by the adapter; the render path only
 * reads the columns the vocabulary map declares, so a smuggled extra key is
 * structurally inert either way.
 */
export type FlowBoardRow = Readonly<Record<string, FlowScalar>>

/** The whole board's rows: every table present (empty array = no rows). */
export type FlowBoardRows = Readonly<Record<FlowTableName, readonly FlowBoardRow[]>>

/** The Flow board resource — one graph's one board (`flow-board`) as rows. */
export interface FlowBoardResource {
  readonly kind: 'flow-board'
  /** The owning graph's id — mints `{graph_subject}` for every subject IRI. */
  readonly graphId: string
  readonly board: FlowBoardRows
}

export type KindedAttribution = Pick<Attributed<unknown>, 'observer' | 'observedAt'>

export interface KindedValueNode {
  readonly kind: DisplayKind
  readonly value: string
  readonly label?: string
  readonly unit?: string
  readonly href?: string
  readonly stance?: Stance
  readonly attribution?: KindedAttribution
  readonly recency?: Recency<string>
}

export interface KindedValueResource {
  readonly kind: 'kinded-value'
  readonly id: string
  readonly title: string
  readonly node: KindedValueNode
}

/** The union of resources this package can render to the four faces. */
export type Resource =
  | CatalogResource
  | ComponentResource
  | WorkspaceResource
  | VocabResource
  | VocabPackResource
  | PlotResource
  | SubjectResource
  | BouquetResource
  | WalkResource
  | WalkIndexResource
  | KnobResource
  | GreenhouseResource
  | KindedValueResource
  | FlowBoardResource

// ── Render context (host-supplied URLs + which app spine) ─────────────────────

/**
 * The per-render context — the host (Vite build plugin OR the live cell) supplies
 * the base URL and the resource's own path so the renderer can mint correct,
 * copy-pasteable links WITHOUT knowing how it is served.
 *
 *   - baseUrl   — scheme+host (+ optional /g/{graph} prefix), NO trailing slash.
 *                 e.g. 'https://api.canary.sophia-labs.com/g/emporium' or
 *                 'http://localhost:8787'.
 *   - selfPath  — the resource's path under baseUrl, NO extension, leading slash.
 *                 e.g. '/catalog' or '/catalog/mn-graph-panel'.
 *   - upPath    — the parent collection path (for rel=up), or null at the root.
 *   - app       — the 4th `app` dimension passed to planFor for workspace configs.
 */
export interface RenderCtx {
  readonly baseUrl: string
  readonly selfPath: string
  readonly upPath?: string | null
  readonly app?: string
  /**
   * The Plot collection's base path (e.g. '/plot'), supplied by the host so a WALK
   * run can mint `rel=related` links straight to the Plot BEDS it wrote (the
   * cross-surface join). Absent for a pure unit render (no server) → the run omits
   * its bed links rather than faking them.
   */
  readonly plotPath?: string | null
  /**
   * The Walk-run path (e.g. '/walk/1781976018654') of the agentic run that MINTED
   * this Plot bed's head, supplied by the host (which knows the trace files) for a
   * `mem-subject` resource. The REVERSE of `plotPath`: it lets a Plot bed advertise
   * `rel=related` straight to the run that wrote it (face parity with the in-shell
   * "open the Walk" affordance). Absent when no minting run is known (a read-only
   * bed, or a pure unit render) → the bed omits the link rather than faking it.
   */
  readonly walkRunPath?: string | null
  /**
   * The Bouquet path (e.g. '/bouquet/3c3734609b68') for the constellation reader of
   * this same bed, supplied by the host for a `mem-subject` resource so the Plot
   * bed (the structural lineage view) can advertise `rel=related` straight to its
   * BOUQUET (the read-side constellation) — the deep-link the in-shell Plot
   * drill-down mirrors (no island). Absent for a pure unit render → omitted.
   */
  readonly bouquetPath?: string | null
  /**
   * The Plot path ('/plot') the host supplies for a GREENHOUSE knob so the knob can
   * advertise `rel=related` straight to the Plot bed it governs (a knob → the bed it
   * tunes — the §6 cross-surface join). Combined with the knob's own `governsBed`.
   * Absent for a pure unit render → the knob omits its Plot link rather than faking it.
   */
  readonly tunePlotPath?: string | null
  /**
   * The Ledger/bench path prefix (e.g. '/ledger') the host supplies for a knob so it
   * can advertise `rel=related` to the bench:Run that JUSTIFIES its value (the §6
   * provenance join). Combined with the knob's `justifiedBy`. Absent → omitted.
   */
  readonly benchRunPath?: string | null
}
