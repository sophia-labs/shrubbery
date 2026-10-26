/**
 * layout/faces — face implementations. `hoja.document`, `sparql.bindings-
 * table`, and `sophia.home` are the RATIFIED v1 P2 catalog (design §9.2
 * Phase 2: "Register exactly hoja.document, sparql.bindings-table, and an
 * honest sophia.home fallback") — `layout-workbench-main.ts` registers
 * exactly these three onto the PRODUCTION-shaped `FaceRegistry` +
 * `LayoutResourceBroker` pair; nothing here constructs either.
 *
 * `stat.scalar`, `chart.vega-lite`, and `card.subject` (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4) are the ratified Wave-2
 * GENERIC-face additions — three new query-backed faces plus the reused
 * `sparql.bindings-table`, none obs-branded (the obs-ness lives in the query
 * text, not the face). Unlike `media.viewer` below, these are NOT
 * quarantined: they are exported from this public barrel like the P2 three.
 *
 * `obs.evidence-chain` (P6, plans/observatory-ux-implementation-spec-
 * 20260728.md §3 P6) is DELIBERATELY obs-branded in its face id — unlike the
 * Wave-2 four above, its one fixed query is the Observatory's own
 * `evidenceEventId`-to-raw-capture join, not a generic shape a non-Observatory
 * caller would reuse. Still exported from this public barrel (not
 * quarantined like `media.viewer`) because `subject-drill-down.ts`'s
 * `installSubjectDrillDown` is a generic runtime door any host can wire up —
 * only the query text inside the face is Observatory-specific.
 *
 * `media-face.ts`/`media-view-element.ts` (`media.viewer`) remain real and
 * tested (F6, repair round 3 faces-mvp review) — see
 * `plans/shrubbery-surface-north-star-20260716.md` §2.1, which names
 * `media.viewer` the Wave-2 STATIC-resource-shape template — but are
 * DELIBERATELY NOT exported from this barrel (nor its `layout/index.ts`
 * re-export). `media.viewer` is not part of the ratified v1 P2 catalog
 * (diff-review r2 WRONG: "the catalog explicitly admits that media.viewer is
 * a fourth addition beyond the authority's 'exactly' wording"), and a casual
 * consumer of `@shrubbery/runtime/layout` must not reach it by accident. The
 * "genuinely different, provider-free pane" property it used to demonstrate
 * is now demonstrated by `sparql.bindings-table` instead (a DERIVED reactive
 * store that may be retained briefly, still distinct from
 * `hoja.document`'s DURABLE identity-bearing shape).
 *
 * `media.viewer` is reachable ONLY via the explicitly-internal
 * `media-face-internal.ts` module path, whose own header documents the one
 * registered consumer (`layout-workbench-main.ts`'s harness-only
 * registration) and what re-promoting it to the production catalog would
 * take (an explicit authority revision from Vera, or extracting/sharing the
 * production `mn-original-viewer` artifact viewer in its place —
 * `packages/runtime` cannot depend on `@shrubbery/components` today, see
 * `media-face.ts`'s own header for the cross-package restructuring that
 * would take).
 */
export {
  HOJA_DOCUMENT_FACE_ID,
  createHojaDocumentFace,
  createHojaDocumentResourceAdapter,
  // W14.1 — the leaf-level lossless content port (see the face module's own
  // doc comment for why the seam is here and not on the room pool).
  hojaDocumentContentPort,
  type HojaDocumentContentPort,
  type HojaDocumentFaceView,
} from './hoja-document-face.js'

export {
  DOC_HISTORY_FACE_ID,
  DOC_HISTORY_RESOURCE_ADAPTER_ID,
  createDocHistoryFace,
  createDocHistoryResourceAdapter,
  type DocHistoryParams,
  type DocHistoryRoomResource,
} from './doc-history-face.js'

export {
  SETTINGS_PAGE_FACE_ID,
  SETTINGS_PAGE_RESOURCE_ADAPTER_ID,
  SETTINGS_PAGE_IRI,
  SETTINGS_PAGE_SECTION_IDS,
  createSettingsPageFace,
  createSettingsPageResourceAdapter,
  type SettingsPageSectionId,
  type SettingsPageParams,
  type SettingsPageService,
  type SettingsPageSnapshot,
  type SettingsPageSection,
  type SettingsPageToggleChangeDetail,
  type SettingsPageSelectChangeDetail,
  type SettingsPageSecretActionDetail,
  type SettingsPageActionDetail,
  type SettingsPageJobActionDetail,
} from './settings-page-face.js'

export {
  PRESENCE_INSPECTOR_FACE_ID,
  PRESENCE_INSPECTOR_RESOURCE_ADAPTER_ID,
  createPresenceInspectorFace,
  createPresenceInspectorResourceAdapter,
  type PresenceInspectorParams,
} from './presence-inspector-face.js'

export {
  WORKSPACE_PICKER_FACE_ID,
  WORKSPACE_PICKER_RESOURCE_ADAPTER_ID,
  WORKSPACE_CATALOG_IRI,
  WORKSPACE_CATALOG_RESOURCE,
  createWorkspacePickerFace,
  createWorkspacePickerResourceAdapter,
  type WorkspacePickerParams,
  type WorkspaceCatalogResource,
} from './workspace-picker-face.js'

export {
  ACCESS_MANAGER_FACE_ID,
  ACCESS_MANAGER_RESOURCE_ADAPTER_ID,
  createAccessManagerFace,
  createAccessManagerResourceAdapter,
  type AccessManagerParams,
  type AccessManagerResource,
  type ConfirmRemoveOptions,
} from './access-manager-face.js'

// el Despacho W1 (plans/2026-09-15-despacho-design.md §7): one cuentas bead
// as a chapter with one act — the first face with a WRITE path (the closed
// verb union in ../../despacho/), threaded through `CuentaVerbSeam`.
export {
  CARD_CUENTA_FACE_ID,
  NO_CUENTA_VERB_SEAM,
  createCardCuentaFace,
  createCardCuentaResourceAdapter,
  focusHrefFrom,
  type CardCuentaParams,
  type CuentaQueryHandle,
  type CuentaVerbSeam,
} from './card-cuenta-face.js'
export type {
  CuentaChapterMode,
  CuentaChapterViewStatus,
  CuentaVerbViewState,
  CuentaWordDetail,
} from './cuenta-chapter-view-element.js'

// el Despacho W2: a seat as a character with a heartbeat, a letter as a page,
// and the focus as what it is (bead | seat | letter) — the delegating face a
// focus-driven layout names once and a mixed collection grid renders through.
export {
  CARD_SEAT_FACE_ID,
  createCardSeatFace,
  createCardSeatResourceAdapter,
  isSubjectLocator,
  subjectAndGraphOfLocator,
  type CardSeatParams,
  type SeatQueryHandle,
} from './card-seat-face.js'
export { formatAgo, type SeatViewMode, type SeatViewStatus } from './seat-character-view-element.js'
export {
  CARD_LETTER_FACE_ID,
  createCardLetterFace,
  createCardLetterResourceAdapter,
  type CardLetterParams,
  type LetterQueryHandle,
} from './card-letter-face.js'
export type { LetterViewMode, LetterViewStatus } from './letter-page-view-element.js'
export {
  CARD_AGENT_FACE_ID,
  createCardAgentFace,
  createCardAgentResourceAdapter,
  type AgentQueryHandle,
  type CardAgentParams,
} from './card-agent-face.js'
export { entrySlug, type AgentViewMode, type AgentViewStatus } from './agent-entry-view-element.js'
export {
  CARD_FOCUS_FACE_ID,
  createCardFocusFace,
  createCardFocusResourceAdapter,
  type CardFocusParams,
  type FocusQueryHandle,
  type FocusResolution,
} from './card-focus-face.js'

// el Despacho W4: the inbox room (gates awaiting a word, unanswered letters,
// unread accounts) with its one act `read`, and the work an office holds.
export {
  CARD_INBOX_FACE_ID,
  DEFAULT_INBOX_OWNER,
  convenedSeats,
  createCardInboxFace,
  createCardInboxResourceAdapter,
  type CardInboxParams,
  type InboxQueryHandle,
} from './card-inbox-face.js'
export type { InboxReadDetail, InboxReadState, InboxRoomViewStatus } from './inbox-room-view-element.js'
export {
  CARD_MY_WORK_FACE_ID,
  createCardMyWorkFace,
  createCardMyWorkResourceAdapter,
  type CardMyWorkParams,
  type MyWorkQueryHandle,
} from './card-my-work-face.js'
export type { MyWorkViewStatus } from './my-work-view-element.js'

export {
  SPARQL_BINDINGS_TABLE_FACE_ID,
  createSparqlBindingsTableFace,
  createSparqlBindingsTableResourceAdapter,
} from './sparql-bindings-table-face.js'

export {
  SOPHIA_HOME_FACE_ID,
  createSophiaHomeFace,
  createSophiaHomeResourceAdapter,
} from './sophia-home-face.js'

// `seele.context` (W8.1) — the contract-parameterized MO workbench pane. NOT
// quarantined the way `media.viewer` is (it is a real face any host may
// register), but deliberately NOT promoted into `fragment-face-set.ts` either
// (W6.6): a GRAPH-AUTHORED layout in the generic `?graph=` app still cannot
// name it, because that widening is its own decision. Its one registered
// consumer today is `apps/seele-workbench`.
export {
  SEELE_CONTEXT_FACE_ID,
  SEELE_CONTEXT_ADAPTER_ID,
  createSeeleContextFace,
  createSeeleContextResourceAdapter,
  type SeeleWorkbenchHandleResolver,
} from './seele-context-face.js'

export {
  STAT_SCALAR_FACE_ID,
  createStatScalarFace,
  createStatScalarResourceAdapter,
  formatStatScalarValue,
  type StatScalarFormat,
  type StatScalarParams,
} from './stat-scalar-face.js'

export {
  CHART_VEGA_LITE_FACE_ID,
  createChartVegaLiteFace,
  createChartVegaLiteResourceAdapter,
  buildChartVegaLiteSpec,
  chartFieldType,
  type ChartVegaLiteMark,
  type ChartVegaLiteParams,
} from './chart-vega-lite-face.js'

export {
  CARD_SUBJECT_FACE_ID,
  createCardSubjectFace,
  createCardSubjectResourceAdapter,
  selectCardSubjectFields,
  type CardSubjectParams,
  type CardSubjectSelection,
  type SubjectQueryHandle,
} from './card-subject-face.js'

export {
  EVIDENCE_CHAIN_FACE_ID,
  EVIDENCE_CHAIN_ADAPTER_ID,
  createEvidenceChainFace,
  createEvidenceChainResourceAdapter,
  type EvidenceChainParams,
  type EvidenceChainQueryHandle,
} from './evidence-chain-face.js'

export {
  FILMSTRIP_FACE_ID,
  FILMSTRIP_ADAPTER_ID,
  createFilmstripFace,
  createFilmstripResourceAdapter,
  parseFilmstripCoordinates,
  type FilmstripCoordinate,
  type FilmstripEvidenceRef,
  type FilmstripEvidenceService,
  type FilmstripFrame,
  type FilmstripResource,
} from './filmstrip-face.js'

export {
  CARD_OBJECT_FACE_ID,
  CARD_OBJECT_ADAPTER_ID,
  createCardObjectFace,
  createCardObjectResourceAdapter,
  selectObjectCardFields,
  inferFieldKind,
  SAFE_REFERENCE_SCHEMES,
  type CardObjectParams,
  type ObjectCardSelection,
  type ObjectQueryHandle,
} from './card-object-face.js'

export {
  COMPUTE_CELL_FACE_ID,
  COMPUTE_CELL_ADAPTER_ID,
  COMPUTE_NS,
  createComputeCellFace,
  createComputeCellResourceAdapter,
  computeCellFromResult,
  type ComputeCellParams,
  type ComputeCellQueryHandle,
} from './compute-cell-face.js'

export {
  ShComputeCellView,
  preferredComputeMime,
  type ComputeCellOutputView,
  type ComputeCellViewModel,
  type ComputeCellViewStatus,
} from './compute-cell-view-element.js'

export {
  AGENT_SESSION_FAMILY_FACE_ID,
  AGENT_SESSION_FAMILY_ADAPTER_ID,
  AGENT_SESSION_FAMILY_REFRESH_MS,
  AGENT_RUNTIME_NS,
  agentSessionUserRdfGraphIri,
  agentSessionFamilyQuery,
  agentSessionFamilyFromResult,
  createAgentSessionFamilyFace,
  createAgentSessionFamilyResourceAdapter,
  type AgentSessionFamilyQueryHandle,
} from './agent-session-family-face.js'

export {
  ShAgentSessionFamilyView,
  shortAgentSessionId,
  type AgentSessionFamilyBudgetView,
  type AgentSessionFamilyChildView,
  type AgentSessionFamilyViewModel,
  type AgentSessionFamilyViewStatus,
} from './agent-session-family-view-element.js'

export type { QueryHandle } from './query-handle-resource-adapter.js'

/**
 * `layout.grid-collection.query-handle` — the production grid-collection
 * adapter (Wave 2 / Lane B spec §3/§6.3). Not bound to any one face's
 * `resourceAdapterId`; a caller registers it on the broker AND passes its id
 * as `LayoutInterpreterOptions.gridCollectionResourceAdapterId` — see that
 * module's own header for why it lives here rather than under one face.
 */
export {
  GRID_COLLECTION_QUERY_ADAPTER_ID,
  createGridCollectionQueryResourceAdapter,
} from './grid-collection-query-resource-adapter.js'

export { ShHomeView } from './home-view-element.js'
export {
  ShSparqlTableView,
  SUBJECT_ROW_ACTIVATE_EVENT,
  type SparqlTableViewStatus,
  type SubjectRowActivateDetail,
} from './sparql-table-view-element.js'
export { ShStatScalarView, type StatScalarViewStatus } from './stat-scalar-view-element.js'
export { ShVegaChartView, type VegaChartViewStatus } from './vega-chart-view-element.js'
export { ShSubjectCardView, type SubjectCardViewStatus, type SubjectCardField } from './subject-card-view-element.js'
export {
  ShObjectCardView,
  OBJECT_INTENT_EVENT,
  type ObjectCardViewStatus,
  type ObjectCardField,
  type ObjectCardProposal,
  type ObjectCardIntent,
  type ObjectIntentProposal,
  type ObjectIntentDetail,
} from './object-card-view-element.js'

// la Lente (2026-10-25): the perf hill-climb's instruments. The neutral span model + adapters, the ledger queries and
// arithmetic, the trace waterfall (`<sh-trace-waterfall>`), and the bench dashboard face (`bench.dashboard`).
export {
  buildSpanTree,
  expandableIds,
  flattenVisible,
  formatMs,
  groupOtlpTraces,
  isRootParent,
  parseAttrsJson,
  parseOtlpJsonLines,
  selfTimeMs,
  spansFromBenchRows,
  spansFromOtlpLines,
  topSelfTime,
  trimOtlpAttributes,
  unionLengthMs,
  type NeutralSpan,
  type OtlpLine,
  type PlainRow,
  type SelfTimeRow,
  type SpanAttrValue,
  type SpanForest,
  type SpanNode,
} from './trace-spans.js'
export {
  BENCH_KINDS,
  BENCH_NS,
  BENCH_PREFIX,
  SAME_BAND,
  SPAN_PAGE,
  caseKey,
  caseResultsQuery,
  chartGeometry,
  compareRuns,
  defaultComparePair,
  judgeOf,
  deltaVerdict,
  exemplarsQuery,
  filterByKind,
  kindsPresent,
  linePath,
  mapCaseResultRows,
  mapRunRows,
  mapSeriesRows,
  niceCeil,
  plainRows,
  runsQuery,
  seriesLabel,
  seriesQuery,
  spansQuery,
  type BenchCaseResult,
  type BenchCompareRow,
  type BenchDelta,
  type BenchKind,
  type BenchKindFilter,
  type BenchRunSummary,
  type BenchSeriesPoint,
  type BenchVerdict,
  type ChartGeometry,
  type ChartPoint,
} from './bench-model.js'
export { ShTraceWaterfall, barGeometry, axisTicks, type TraceWaterfallMode } from './trace-waterfall-element.js'
export { ShBenchDashboard, formatDeltaPct } from './bench-dashboard-element.js'
export {
  BENCH_DASHBOARD_FACE_ID,
  BENCH_DASHBOARD_ADAPTER_ID,
  createBenchDashboardFace,
  createBenchDashboardResourceAdapter,
  isBenchLedgerLocator,
  type BenchLedgerHandle,
} from './bench-dashboard-face.js'
