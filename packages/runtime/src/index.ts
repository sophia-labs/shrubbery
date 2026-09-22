/**
 * @shrubbery/runtime — the render host.
 *
 * The REAL planFor → LayoutPlan → Lit DOM host. It takes a WorkspaceConfig,
 * computes the layout plan via @shrubbery/nucleus `planFor`, and renders the
 * structural frame (chrome + spine split-tree) into a Lit template / DOM
 * container. Panel bodies are INERT `<tag></tag>` placeholders (via nucleus
 * `stampPanelBody`) for un-lifted components.
 *
 * ISLAND (top-level src/*.ts): depends ONLY on @shrubbery/nucleus + lit — no
 * reactive state containers, no token supply, no native bridge, no backend seam.
 * (grep-verified by render-workspace-island.test.ts, which scans only top-level
 * files.) The rung-3 CRDT plane (the collaboration runtime + the collaboration
 * extension + the pure kernel) is QUARANTINED to the src/collab/ subdir — not
 * island-scanned — and the host element reaches it through a sibling relative
 * import. The island invariant therefore still holds for the scanned surface even
 * though the live editor body is real. (The scanned files carry no collab import
 * or usage; the island guard's token scan confirms it.)
 */
export {
  renderWorkspace,
  renderWorkspaceTemplate,
  workspaceSurfaceReady,
  engineRegionRole,
  LAYOUT_DASHBOARD_COMPONENT,
  type WorkspaceFragmentChangeDetail,
  type WorkspaceFragmentRegion,
  type WorkspaceFragmentState,
  type WorkspaceFragmentsOptions,
  type RegionRole,
  type RenderWorkspaceOptions,
  type WorkspaceCenterPanesOptions,
  type WorkspacePanelLayoutOptions,
  type WorkspacePanelRepositionDetail,
  type WorkspacePanelSplitRole,
  type WorkspaceChromeBreadcrumb,
  type WorkspaceChromeDocumentStats,
  type WorkspaceChromePresencePerson,
  type WorkspaceQuickClipKind,
  type WorkspaceQuickClipOptions,
  type WorkspaceQuickClipRequestDetail,
  type WorkspaceQuickClipStatus,
  type WorkspaceAccessAddDetail,
  type WorkspaceAccessBusyAction,
  type WorkspaceAccessCurrentRole,
  type WorkspaceAccessGrant,
  type WorkspaceAccessOptions,
  type WorkspaceAccessRemoveDetail,
  type WorkspaceAccessRole,
  type WorkspaceAccessRoleChangeDetail,
  type WorkspaceAccessStatus,
  type WorkspaceTtsAction,
  type WorkspaceTtsActionDetail,
  type WorkspaceTtsOptions,
  type WorkspaceTtsStatus,
  type WorkspaceTtsToolbarDetail,
  type WorkspaceCellState,
  type WorkspaceHomeDocument,
  type WorkspaceHomeOptions,
  type WorkspaceLifetimeSummary,
  type WorkspaceRole,
  type WorkspaceSummary,
  type ArtifactHistoryOptions,
  type ArtifactHistoryRevision,
  type ArtifactHistoryRevisionDetail,
  type ArtifactHistoryStatus,
  type ArtifactEditorGenerateDetail,
  type ArtifactEditorSaveDetail,
  type ArtifactViewIntentDetail,
  type ArtifactViewOpenDocumentDetail,
  type ArtifactViewOptions,
  type ArtifactViewStatus,
  type GraphPanelEdge,
  type GraphPanelEdgeSelectDetail,
  type GraphPanelNode,
  type GraphPanelNodeKind,
  type GraphPanelNodeOpenDetail,
  type GraphPanelNodeSelectDetail,
  type GraphPanelOptions,
  type GraphPanelRefreshDetail,
  type GraphPanelStatus,
  type GraphPanelViewMode,
  type GraphPanelViewModeChangeDetail,
  type OutlinePanelCommandDetail,
  type OutlinePanelHeading,
  type OutlinePanelNavigateDetail,
  type OutlinePanelOptions,
  type ChatSurfaceActionIntent,
  type DailyNoteAdjacency,
  type DailyNoteCalendarAnchorDetail,
  type DailyNoteDoc,
  type DailyNoteOpenDetail,
  type DailyNotePopoverState,
  type DocHistoryCursorDetail,
  type DocHistoryCursorId,
  type DocHistoryDiffStyle,
  type DocHistoryDiffStyleDetail,
  type DocHistoryFocusedSide,
  type DocHistoryOptions,
  type DocHistoryRestoreDetail,
  type DocHistorySnapshot,
  type DocHistorySnapshotDetail,
  type DocHistoryStatus,
  type SidebarAction,
  type SidebarActionDetail,
  type SidebarDropPosition,
  type SidebarNode,
  type SidebarNodeDetail,
  type SidebarNodeDropDetail,
  type SidebarNodeKind,
  type SidebarSection,
  type TagLensBlock,
  type TagLensOpenBlockDetail,
  type TagLensOptions,
  type TagLensRefreshDetail,
  type TagLensStatus,
  type ZoteroSourceAnnotation,
  type ZoteroSourceBaseDetail,
  type ZoteroSourceIncomingWire,
  type ZoteroSourceItem,
  type ZoteroSourceOpenDocumentDetail,
  type ZoteroSourceOpenTagDetail,
  type ZoteroSourceOpenZoteroDetail,
  type ZoteroSourceOptions,
  type ZoteroSourcePromoteAnnotationDetail,
  type WorkspaceComment,
  type WorkspaceCommentDetail,
  type WorkspaceCommentEditDetail,
  type WorkspaceCommentHoverDetail,
  type WorkspaceCommentResolveDetail,
  type WorkspaceCommentsOptions,
  type WorkspaceInspectorAction,
  type WorkspaceInspectorActionDetail,
  type WorkspaceInspectorActionDivider,
  type WorkspaceInspectorActionHeader,
  type WorkspaceInspectorActionItem,
  type WorkspaceInspectorIdentity,
  type WorkspaceInspectorIdentityChip,
  type WorkspaceInspectorModel,
  type WorkspaceInspectorModifiers,
  type WorkspaceInspectorOptions,
  type WorkspaceInspectorRelationGroup,
  type WorkspaceInspectorRelationItem,
  type WorkspaceInspectorRelationOpenDetail,
  type WorkspaceInspectorRelations,
  type WorkspaceInspectorRelationsScope,
  type WorkspaceContestedOptions,
  type WorkspaceContestedSelection,
  type ParkedWorkOptions,
  type ParkedWorkModel,
  type ParkedWorkDocumentRow,
  type ParkedWorkOperationRow,
  setWorkspaceNamedQueryRegistry,
} from './render-workspace.js'
export {
  type SubjectRowActivateDetail,
} from './layout/faces/sparql-table-view-element.js'
export {
  OBJECT_INTENT_EVENT,
  type ObjectCardIntent,
  type ObjectIntentProposal,
  type ObjectIntentDetail,
} from './layout/faces/object-card-view-element.js'

export {
  NULL_EDITOR_HOST_STATE,
  type EditorHostState,
  type EditorHostBinding,
} from './editor-host-binding.js'

// The editor room pool (CRDT-plane; subdir-quarantined like collab/live-editor
// — not island-scanned). Hoisted here from apps/organism so the layout-as-data
// P2 face module (layout/faces/hoja-document-face.ts) can wrap the SAME pool
// instance type without reimplementing its key/refcount logic. Organism now
// re-exports this from its own former location (apps/organism/src/cell/
// editor-room-pool.ts) rather than holding a second implementation.
export {
  EditorRoomPool,
  editorRoomKey,
  type EditorRoomKey,
  type EditorRoomLease,
  type EditorRoomDiagnostic,
  type EditorRoomPoolSnapshot,
} from './collab/editor-room-pool.js'

export {
  ShEditorHost,
  computeHostVars,
  type EditorBlockFocusRequest,
  type EditorCommentInsertedDetail,
  // W14.1 — lossless content exposure on the hosted path.
  type EditorContentChange,
  type EditorContentChangeReason,
  type EditorContentSubscribeOptions,
  type LiveDocumentJSON,
  type EditorDocumentAccess,
  type EditorHostVars,
  type EditorImageInsert,
  type EditorImageInserter,
  type EditorOriginalFileChapter,
  type EditorOriginalFileView,
  type LiveEditorHandle,
  type LiveOutlinerCommand,
  type LiveZoteroPromotion,
  type LiveZoteroPromotionResult,
  type ZoomChangeDetail,
  type BlockWireRequestDetail,
  type BlockWireMenuRequestDetail,
  type WireRadialContextBlock,
  type WireRadialContextData,
  type WireRadialContextMap,
  type WireRadialContextState,
} from './editor-host.js'

export {
  EDITOR_STRUCTURE_CHANGE_EVENT,
  type EditorStructureChangeDetail,
  EDITOR_HEADING_IN_VIEW_EVENT,
  type EditorHeadingInViewDetail,
} from './editor-host.js'

export { type LiveHeadingOutlineEntry } from './collab/live-editor.js'

// W14.2 — the SEELe source projection (D16): a pure function over the same
// `LiveDocumentJSON` shape W14.1 exposes, picking the one `seele`-tagged
// fenced code block that is the authoritative compile source, or failing
// loudly and typed when there is zero or more than one.
export {
  projectSeeleSource,
  NoSeeleSourceError,
  MultipleSeeleSourcesError,
  type SourceRegion,
  type SeeleSourceProjection,
} from './seele/source-projection.js'

// W7.1 (consumer half) — the compile seam's report shape plus one real HTTP
// client for the dev-server route that shells to the `nature` binary.
export {
  createHttpSeeleCompiler,
  countCompileErrors,
  SeeleCompileTransportError,
  DEFAULT_COMPILE_URL,
  type SeeleCompiler,
  type SeeleCompileRequest,
  type SeeleCompileReport,
  type SeeleDiagnostic,
  type SeeleDeclaredObject,
  type HttpSeeleCompilerOptions,
} from './seele/compile-seam.js'

// W9.1b / D18 — the wax seal's v1 state: five members, no persistence arm, no
// warning arm. See drift-state.ts before adding a sixth.
export {
  deriveDriftState,
  describeDriftState,
  DRIFT_STATE_KINDS,
  type DriftState,
  type DriftStateInputs,
} from './seele/drift-state.js'

// W14 (v1 slice) — the controller that joins the content port, the projection
// and the compile route into one subscribable report.
export {
  createSeeleWorkbenchController,
  type SeeleWorkbenchController,
  type SeeleWorkbenchControllerOptions,
  type SeeleWorkbenchReportHandle,
  type SeeleWorkbenchSnapshot,
} from './seele/workbench-controller.js'

export {
  SALIENCE_RATE_REQUEST_EVENT,
  type SalienceRateRequestDetail,
} from './editor-host.js'

export {
  WIRE_DOCUMENT_REQUEST_EVENT,
  WIRE_HIGHLIGHT_BLOCK_EVENT,
  WIRE_PIN_BLOCK_REQUEST_EVENT,
  WIRE_PIN_DOCUMENT_REQUEST_EVENT,
  WIRE_PIN_WIRE_REQUEST_EVENT,
  WIRE_RADIAL_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_BLOCK_CLOSE_EVENT,
  WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_BLOCK_MOVE_EVENT,
  WIRE_PINNED_BLOCK_OPEN_EVENT,
  WIRE_PINNED_BLOCK_REFRESH_EVENT,
  WIRE_PINNED_DOC_CLOSE_EVENT,
  WIRE_PINNED_DOC_MOVE_EVENT,
  WIRE_PINNED_DOC_OPEN_EVENT,
  WIRE_PINNED_WIRE_CLOSE_EVENT,
  WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_WIRE_MOVE_EVENT,
  WIRE_PINNED_WIRE_OPEN_EVENT,
  WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT,
  type DocumentWireRequestDetail,
  type WirePinBlockRequestDetail,
  type WirePinDocumentRequestDetail,
  type WirePinWireRequestDetail,
  type WireRadialContextRequestDetail,
  type WireHighlightBlockDetail,
  type WirePinnedBlockCloseDetail,
  type WirePinnedBlockContextRequestDetail,
  type WirePinnedBlockMoveDetail,
  type WirePinnedBlockOpenDetail,
  type WirePinnedBlockRefreshDetail,
  type WirePinnedDocCloseDetail,
  type WirePinnedDocMoveDetail,
  type WirePinnedDocOpenDetail,
  type WirePinnedWireCloseDetail,
  type WirePinnedWireContextRequestDetail,
  type WirePinnedWireMoveDetail,
  type WirePinnedWireOpenDetail,
  type WirePinnedWireUpdateRequestDetail,
} from './wire-events.js'
export {
  isPersistentCenter,
  renderCenterSlotAnchor,
  mountEditorHost,
  type EditorHostMountOptions,
} from './mount.js'

// The CRDT plane factory (subdir-quarantined; composes the pure kernel +
// Collaboration over the shared doc, history owned exactly once). EditorKernelOptions
// is the OPAQUE kernel-options alias (Omit<KernelOptions,'collaborative'>) the shell
// threads through mountEditorHost into the live editor's kernel slot.
export {
  createLiveCollabEditor,
  createLiveAwareness,
  COLLAB_FIELD,
  type LiveCollabEditorOptions,
  type EditorKernelOptions,
  type LiveCitationAttrs,
  type LiveTagChipAttrs,
  type LiveWikiLinkAttrs,
  type LiveZoomCrumb,
  type LiveZoomSnapshot,
} from './collab/live-editor.js'

// The EditorServices ontology (subdir-quarantined; the host-side projection over the
// contract that the SHELL assembles + builds the kernel callbacks from). Exported so a
// shell can do: assembleEditorServices(contract.rest, contract.wire, getScope) →
// buildKernelOptions(services, scope) → mountEditorHost(binding, kernelOptions).
export {
  type EditorServices,
  assembleEditorServices,
  buildKernelOptions,
  type NavigationService,
  type OpenDocumentDetail,
  type OpenZoteroSourceDetail,
  OPEN_DOCUMENT_EVENT,
  OPEN_ZOTERO_SOURCE_EVENT,
  eventNavigationService,
  type WikiLinkSearchService,
  type WikiLinkSearchScope,
  type WikiLinkSuggestionItem,
  docListSparql,
  makeWikiLinkSearchService,
  workspaceProjectionGraphIri,
  type WireService,
  type WireCreateParams,
  type WireBundle,
  type WireSummary,
  type WireBundleService,
  EMPTY_WIRE_BUNDLE,
  wireBundleSparql,
  makeWireBundleService,
  makeScopedWireBundleLoader,
  type SalienceBundle,
  type SalienceBundleService,
  type SalienceScoreCheckpoint,
  EMPTY_SALIENCE_BUNDLE,
  captureSalienceScore,
  withSalienceScore,
  rollbackSalienceScore,
  makeSalienceBundleService,
  makeScopedSalienceBundleLoader,
  IMPORTANCE_CYCLE,
  VALENCE_CYCLE,
  signalLevel,
  signalIcon,
  nextImportance,
  nextValence,
  importanceIcon,
  isVeryImportant,
  hasUserImportance,
  valenceIcon,
  importanceLabel,
  valenceLabel,
  combinedImportance,
  combinedValence,
  inferQueryBlockQueryKind,
  formatQueryBlockTerm,
  plainQueryBlockTermValue,
  makeQueryBlockService,
  makeQueryBlockRenderer,
  type QueryBlockService,
  type QueryBlockResult,
  type QueryBlockRow,
  type QueryBlockTerm,
  type QueryBlockQueryKind,
  type QueryBlockRendererOptions,
  QUERY_BLOCK_VEGA_CONFIG,
  mountQueryBlockVega,
  parseVegaLiteSpec,
  transformBindingsToVegaValues,
  vegaTermPrimitive,
  setVegaThemeScopeOverrides,
  resolveVegaThemeOverride,
  type MountQueryBlockVegaOptions,
  type QueryBlockVegaEmbed,
  type QueryBlockVegaEmbedLoader,
  type QueryBlockVegaEmbedResult,
  type QueryBlockVegaView,
  buildVegaTheme,
  mergeVegaTheme,
  resolveVegaThemeMode,
  assignCategoricalScale,
  createCategoricalSlotAssignment,
  isValidVegaThemeOverride,
  validateVegaThemeOverride,
  isLawfulSeriesColor,
  sanitizeAuthoredVegaConfig,
  sanitizeAuthoredVegaSpecColors,
  observeVegaThemeFlips,
  ensureVegaTooltipStyles,
  statusColor,
  sequentialRange,
  divergingRange,
  CATEGORICAL_PALETTE,
  DARK_BASELINE_SKINS,
  MAX_CATEGORICAL_SERIES,
  VEGA_THEME_OVERRIDE_KEYS,
  VEGA_THEME_LAW_GUARDED_KEYS,
  VEGA_THEME_COLOR_LAW_MARK_PROPERTIES,
  type VegaLawSanitization,
  type VegaThemeOverrideVerdict,
  type VegaThemeConfig,
  type VegaThemeMode,
  type VegaCategoricalSlot,
  type VegaCategoricalScale,
  type VegaCategoricalSlotAssignment,
  type VegaSeriesValue,
  type VegaStatusTone,
  applyMermaidSvg,
  buildMermaidThemeVariables,
  defaultMermaidRenderHost,
  makeMermaidRenderHost,
  parseSafeMermaidSvg,
  type MermaidEngine,
  type MermaidRendererOptions,
  type MermaidRenderController,
  type MermaidRenderResult,
  mintWireId,
  createDocumentSnapshotService,
  type DocumentSnapshotService,
  type DocumentSnapshotListResult,
  type DocumentSnapshotTransport,
  createWorkspaceCatalogService,
  createAccessGrantService,
  WorkspaceGatewayHttpError,
  type WorkspaceGatewayTransport,
  type WorkspaceGraphRole,
  type WorkspaceGraphCellState,
  type WorkspaceCatalogEntry,
  type WorkspaceCatalogService,
  type AccessGrantEntry,
  type PutAccessGrantRequest,
  type AccessGrantService,
} from './editor-services/index.js'

// The SHIPPED wikilink-picker glue (subdir-quarantined like collab/ + editor-services/;
// the shell-side listener that catches the kernel's open-wikilink-picker CustomEvent,
// runs the real wikiLinkSearch, renders a minimal candidate dropdown, and on select
// wire-first-creates the wire + inserts the WikiLink node through the public host handle).
// The shell (apps/organism/src/main.ts) calls installWikiLinkPickerGlue once per claim.
export {
  installWikiLinkPickerGlue,
  type BlockWireCreatedDetail,
  type BlockWireDeletedDetail,
  type CitationGroundingRequest,
  type CitationMaterializedSource,
  type CitationPickerItem,
  type CitationPickerService,
  type BlockWireCreateOptions,
  type WireCreateOptions,
  type WireCreatedDetail,
  type InstallPickerGlueOptions,
  type PickerEditorHandle,
  type WireDirection,
} from './picker/install-glue.js'

// The ChatService ontology (subdir-quarantined like collab/ + editor-services/;
// the host-side imperative chat seam the SHELL assembles + builds the kernel
// callbacks from). The local impl + the assemble/build boundary land in later
// rungs; C2.1 re-exports the interface + its types only. Typed in the kernel's
// pure vocabulary — the contract/scope-typed factory params live behind the
// assemble.js subdir module, so the island token-scan stays clean here.
export type {
  ChatService,
  ChatFailurePhase,
  ChatFailureRecovery,
  ChatTurnHandle,
  ChatTurnOutcome,
  CreateSessionOpts,
  HydratedSession,
} from './chat-services/index.js'

// The ChatService factory (local in-process or hosted Choreograph) + the
// boundary adapter. The shell does:
//   assembleChatServices(contract, getScope, 'local') → a real ChatService;
//   buildChatKernelOptions(store, () => store.getState()) → pure kernel props.
// (The factory's contract/scope-typed params live behind the subdir module — the
// island token-scan only sees value names here, not the param token types.)
export {
  assembleChatServices,
  buildChatKernelOptions,
  defaultModels,
  makeLocalChatService,
  makeHostedChatService,
  makeGrowTurnDriver,
  ChatServiceFailure,
  asChatServiceFailure,
  InProcessChatStore,
  computeAggregates,
  type ChatServiceMode,
  type ChatProjection,
  type ChatProjectionSource,
  type LocalChatServiceOptions,
  type HostedChatServiceOptions,
  type AssembleChatServicesOptions,
  type TurnDriver,
  type SessionAggregates,
  type CreateSessionRow,
} from './chat-services/index.js'

// The Class-B CHAT HOST (C3) — <sh-chat-host> mounts ONCE + SURVIVES interface-grow
// re-renders (the chat analog of <sh-editor-host>). Subdir-quarantined like collab/
// + editor-services/ + chat-services/; the host owns the ChatServiceStore internally
// + drives an imperatively-held <sh-chat-panel>. The shell does:
//   const svc = assembleChatServices(contract, scope, 'local')
//   const session = await svc.createSession({ title })   // SHELL POLICY
//   render(html`${spine}${mountChatHost(svc, session.id)}`, container)
export {
  ShChatHost,
  CHAT_CODE_COPY_EVENT,
  CHAT_HEADER_ACTION_EVENT,
  CHAT_MESSAGE_ACTION_EVENT,
  CHAT_SESSION_ACTION_EVENT,
  mountChatHost,
  createChatServiceStore,
  type ChatCodeCopyDetail,
  type ChatHeaderActionDetail,
  type ChatMessageActionDetail,
  type ChatMessageExportDetail,
  type ChatMessageRegenerateDetail,
  type ChatPresentation,
  type ChatSessionActionDetail,
  type HojaComposerDetail,
  type HojaWikiLinkResolver,
  type HojaWikiLinkSuggestion,
  type ChatServiceStore,
  type ChatServiceStoreState,
} from './chat-host/index.js'

// Excalidraw React island — mounts the real drawing runtime into the controlled
// component's named slot while graph semantics stay injected shell callbacks.
export {
  EXCALIDRAW_NODE_DND_MIME,
  EXCALIDRAW_SCENE_MIME,
  decodeExcalidrawArtifact,
  embedExcalidrawProjection,
  mountExcalidrawRuntime,
  type ExcalidrawApi,
  type ExcalidrawArtifactCallbacks,
  type ExcalidrawArtifactLoadRequest,
  type ExcalidrawArtifactPayload,
  type ExcalidrawArtifactSaveRequest,
  type ExcalidrawCanvasHost,
  type ExcalidrawCanvasStatus,
  type ExcalidrawDiagnostic,
  type ExcalidrawDroppedNodeIntent,
  type ExcalidrawElementIntent,
  type ExcalidrawEngineContext,
  type ExcalidrawInitialData,
  type ExcalidrawLinkCallbacks,
  type ExcalidrawLinkOpenIntent,
  type ExcalidrawNodeLinkTarget,
  type ExcalidrawOperationStatus,
  type ExcalidrawPredicateIntent,
  type ExcalidrawProjectionCallbacks,
  type ExcalidrawProjectionReason,
  type ExcalidrawProjectionRequest,
  type ExcalidrawProjectionSummary,
  type ExcalidrawProjectionView,
  type ExcalidrawReactRoot,
  type ExcalidrawRuntimeHandle,
  type ExcalidrawRuntimeLoader,
  type ExcalidrawRuntimeModule,
  type ExcalidrawRuntimeOptions,
  type ExcalidrawSaveStatus,
  type ExcalidrawSceneOperationResult,
  type ExcalidrawScope,
  type ExcalidrawSelectedElement,
  type ExcalidrawSnapshot,
  type ExcalidrawSnapshotChangeRequest,
  type ExcalidrawWireCallbacks,
  type ExcalidrawWireSummary,
} from './excalidraw/excalidraw-runtime.js'

export {
  ShWiresPanel,
  mountWiresPanel,
  WIRE_CONTEXT_REQUEST_EVENT,
  WIRE_PANEL_CLOSE_EVENT,
  WIRE_REFRESH_REQUEST_EVENT,
  WIRE_REFRESH_ALL_REQUEST_EVENT,
  type WirePanelCapabilities,
  type WirePanelStatus,
  type WireContextBlock,
  type WireContextData,
  type WireContextState,
  type WireContextMap,
  type WireContextRequestDetail,
  type WireDeleteRequestDetail,
  type WireRefreshRequestDetail,
  type WiresPanelMountOptions,
} from './wires-panel/wires-panel.js'

export {
  ShWirePinnedLayer,
  mountWirePinnedLayer,
  type PinnedWireBlockContextBlock,
  type PinnedWireBlockContextData,
  type PinnedWireBlockContextMap,
  type PinnedWireBlockContextState,
  type PinnedWireNodeContextMap,
  type PinnedWireBlock,
  type PinnedWireDocument,
  type PinnedWireNode,
  type WirePinnedLayerMountOptions,
} from './wire-pinned-layer/wire-pinned-layer.js'

// The host-side GROW cycle (G1) — the one canonical READ → catalog-gate →
// spine-gate → additive-delta → rdf_load → re-read path. Subdir-quarantined like
// collab/ (it takes an injected GrowCell port; no contract concrete, no socket).
// The choreograph C4 tool is a thin wrapper over this identical grow().
export { grow, type GrowCell, type GrowResult } from './grow/grow.js'
// The reusable GrowCell port recipe (lifted from the atelier shell so every shell
// shares one factory + the rdf_load arg shape).
export { makeGrowCell, rdfLoadArgs } from './grow/grow-cell.js'

// The Atelier's set_vtuber_appearance verb (S2) — a SIBLING cycle to grow()
// above, not a member of its VerbSpec union: it targets the :ux:control graph
// with a bounded SPARQL DELETE/INSERT (not an additive :ux:config write).
// Same quarantine + single-choke-point discipline as the grow/ cycle.
export {
  applySetVtuberAppearance,
  growVtuberAppearance,
  makeAppearanceGrowCell,
  sparqlUpdateArgs,
  type AppearanceGrowCell,
  type SetAppearanceGate,
  type SetAppearanceResult,
  type SetVtuberAppearanceSpec,
  type VtuberAppearanceEdit,
  type VtuberAppearanceTarget,
} from './grow/set-appearance.js'

// Visual wire mode — overlays, body-class-via-host-attribute, lifecycle. Subdir-
// quarantined like collab/: it touches the DOM and reads the contract's wireMode
// view, so it is not part of the island. Shells call installWireMode() once per
// editor-host instance and handle.uninstall() on host disconnect.
export {
  createSourceHighlightOverlay,
  createTargetHighlightOverlay,
  installAdvancedWireMenuBridge,
  installDocumentSwitcherWireBridge,
  installWireMode,
  ADVANCED_WIRE_MENU_CONFIRM_EVENT,
  ADVANCED_WIRE_MENU_CLOSE_EVENT,
  DOCUMENT_SWITCHER_WIRE_TARGET_EVENT,
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
  type AdvancedWireMenuConfirmDetail,
  type AdvancedWireMenuHandle,
  type CreateSourceHighlightOverlayOptions,
  type CreateTargetHighlightOverlayOptions,
  type DocumentSwitcherHandle,
  type DocumentSwitcherWireTargetDetail,
  type InstallAdvancedWireMenuBridgeOptions,
  type InstallDocumentSwitcherWireBridgeOptions,
  type InstallWireModeHandle,
  type InstallWireModeOptions,
  type SourceHighlightOverlayHandle,
  type TargetHighlightOverlayHandle,
  type WireModeDocumentScope,
  type WireModeEditorHandle,
} from './wire-mode/index.js'

// Controlled OG-style document center. The component emits typed intents; the
// session controller owns pane/history/layout state while shells own providers.
export {
  CENTER_PANE_CLOSE_EVENT,
  CENTER_PANE_FOCUS_EVENT,
  CENTER_PANE_NAVIGATE_EVENT,
  CENTER_PANE_OPEN_EVENT,
  CENTER_PANE_RESIZE_EVENT,
  DEFAULT_CENTER_PANES_CAPABILITIES,
  PRIMARY_CENTER_PANE_ID,
  SECONDARY_CENTER_PANE_ID,
  type CenterPaneCapabilities,
  type CenterPaneCloseIntentDetail,
  type CenterPaneDocumentLocation,
  type CenterPaneFocusIntentDetail,
  type CenterPaneHomeLocation,
  type CenterPaneId,
  type CenterPaneLocation,
  type CenterPaneNavigateIntentDetail,
  type CenterPaneNavigationState,
  type CenterPaneOpenIntentDetail,
  type CenterPanePosition,
  type CenterPanePosture,
  type CenterPaneProjection,
  type CenterPaneResizeIntentDetail,
  type CenterPaneSplitCommand,
  type CenterPanesCapabilities,
  type CenterPanesIntent,
  type CenterPanesProjection,
  type CenterPanesState,
} from './center-panes-contract.js'

export {
  CENTER_PANE_HISTORY_LIMIT,
  DEFAULT_CENTER_DIVIDER_PERCENT,
  MAX_CENTER_DIVIDER_PERCENT,
  MIN_CENTER_DIVIDER_PERCENT,
  centerPaneById,
  centerPaneLocationKey,
  clampCenterDivider,
  closeCenterPane,
  createCenterPanesState,
  focusCenterPane,
  homeLocation,
  navigateCenterPane,
  openCenterPane,
  projectCenterPanes,
  reduceCenterPanes,
  resizeCenterPanes,
  sameCenterPaneLocation,
  setCenterPanesPosture,
  type CenterPaneProjectionOptions,
  type CreateCenterPanesStateOptions,
} from './center-panes-model.js'

export {
  CenterPanesController,
  createMutableEditorHostBinding,
  type CenterPanesControllerOptions,
  type MutableEditorHostBinding,
} from './center-panes-controller.js'

export {
  CENTER_PANES_SESSION_SCHEMA_VERSION,
  CENTER_PANES_SESSION_STORAGE_PREFIX,
  CenterPanesSessionRepository,
  centerPanesSessionStorageKey,
  decodeCenterPanesSession,
  encodeCenterPanesSession,
  normalizeCenterPanesSessionState,
  type CenterPanesSessionStorage,
} from './center-panes-session.js'

export {
  ShCenterPanes,
  type CenterPaneEditorHostOptions,
} from './center-panes-host.js'

export {
  CENTER_ROOT_SPLIT_ID,
  centerPanesStateToLayoutDocument,
  dividerPercentToBasisPoints,
} from './center-panes-layout-adapter.js'

// The generic reactive reader of `:ux:config` selection edges (semantic edge
// overlay, slice 1). Lives OUTSIDE the subscription-free render host: the shell
// calls installEdgeInterpreter(config, faces, bus) right after renderWorkspace,
// and runs the returned disposer before re-installing on config reload.
export {
  installEdgeInterpreter,
  type FacePort,
} from './edge-interpreter.js'

export {
  projectPresence,
  canEditSelfPresence,
  updateLocalPresenceProfile,
  PRESENCE_COLORS,
  type PresenceAwarenessLike,
  type PresenceActorType,
  type PresencePerson,
  type PresenceSession,
  type PresenceProfilePatch,
} from './presence-projection.js'
