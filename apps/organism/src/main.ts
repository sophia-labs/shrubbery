/**
 * The ORGANISM — a plain Vite app that boots the REAL render host against REAL
 * RDF, with NO mock.
 *
 * Two flavours of "real" sit side by side, chosen by the `source` selector:
 *   - GARDEN_DEFAULT / GARDEN_VARIANT / seed .nt — the REAL library literals +
 *     committed N-Triples seed, parsed via the production read path. NO backend.
 *   - gardend cell (live) — the SHELL-SIDE ShrubberyContract reads the layout
 *     from a REAL local gardend cell's :ux:config NAMED graph over the Vite dev
 *     proxy (/cell), then renders it through @shrubbery/runtime. Read status
 *     (last-read time, triple count, errors verbatim) is shown — NO faked
 *     fallback.
 *
 * What it wires together (all real, all from the workspace packages):
 *   - @shrubbery/components — registers the chrome custom elements (upgrade seam).
 *   - @shrubbery/atelier-vtuber — registers <mn-vtuber> (carved out of
 *     @shrubbery/components for its heavier @pixiv/three-vrm footprint): the
 *     CELL_LIVE :ux:config renderWorkspace reads below can dock a vtuber panel,
 *     which must upgrade the same way, not stamp inert.
 *   - @shrubbery/runtime — the real planFor → LayoutPlan → Lit DOM render host.
 *   - @shrubbery/nucleus — the real literals + parseNT + parseTriplesToConfig +
 *     the committed N-Triples seed (imported `?raw`).
 *
 * The library stays BACKEND-FREE. The gardend contract + the session-store live
 * here, in the shell (apps/organism), and the browser never sees the loopback
 * token or port — the Vite proxy injects them server-side (see vite.config.ts).
 */

// 0) The REAL design tokens — the layered reference → semantic → component →
//    theme → skin CSS. One import gives the chrome its --mn-* values + the
//    [data-skin]/[data-theme] skin/theme blocks. Backend-free.
import '@shrubbery/tokens/tokens.css'
import {
  applySkinTheme,
  isVisualIdentitySkin,
  nextVisualIdentitySkin,
  type Skin,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'

// 1) Register the chrome components (side-effect import = the upgrade seam).
import '@shrubbery/components'
// The layout interpreter emits real Shoelace split panels. Register the same
// implementation Garden uses so pointer and keyboard dividers own layout.
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js'
// mn-vtuber (the WebGL/VRM avatar puppet) is registered by its own package —
// carved out of @shrubbery/components for its heavier @pixiv/three-vrm
// dependency. Same upgrade seam, separate side-effect import: renderWorkspace
// below can dock a live :ux:config panel onto <mn-vtuber>, and without this it
// would stamp an inert, un-upgraded element.
import '@shrubbery/atelier-vtuber'
import { artifactKindFromMime } from '@shrubbery/components'
import type {
  MnConfirmationDialog,
  MnContextMenu,
  MnDocumentSwitcher,
  MnDocumentSwitcherActionDetail,
  MnDocumentSwitcherIntentDetail,
  MnDocumentSwitcherOpenBlockDetail,
  MnDocumentSwitcherOpenDocumentDetail,
  MnDocumentSwitcherQueryDetail,
  MnDocumentSwitcherScope,
  MnDocumentSwitcherScopeDetail,
  MnDocumentSwitcherSort,
  MnDocumentSwitcherSortDetail,
  MnAdvancedWireMenu,
  MnExportDialog,
  MnFolderPickerDialog,
  MnFolderPickerOption,
  MnFolderPickerSelectDetail,
  MnInputDialog,
  MnInputDialogConfirmDetail,
  MnExcalidrawCanvas,
  MnShortcutsDialog,
  MnShortcutCommand,
  MnShortcutRunDetail,
  MnRelations,
  MnGardenHomeAccount,
  MnWorkspaceSummary as GardenHomeWorkspaceSummary,
  MnLifetimeBannerState,
  MnWorkspaceLifetimeState,
  ChromeSourceBadgeActivateDetail,
} from '@shrubbery/components'
// The PURE config.edges → MnRelation[] projection the dev edge overlay renders.
// Same source the interpreter installs behavior from — imported here, mounted below.
import { configEdgesToRelations } from './edge-overlay.js'

// 2) The real render host + the editor-seam wiring (assemble services, build the kernel
//    options, the reactive editor-host binding, and the shipped wikilink picker glue).
import {
  renderWorkspace,
  workspaceSurfaceReady,
  installEdgeInterpreter,
  type FacePort,
  CenterPanesController,
  CenterPanesSessionRepository,
  createCenterPanesState,
  homeLocation,
  mountExcalidrawRuntime,
  assembleEditorServices,
  makeWikiLinkSearchService,
  buildKernelOptions,
  installWikiLinkPickerGlue,
  assembleChatServices,
  makeGrowCell,
  makeGrowTurnDriver,
  EDITOR_STRUCTURE_CHANGE_EVENT,
  EDITOR_HEADING_IN_VIEW_EVENT,
  SALIENCE_RATE_REQUEST_EVENT,
  type SalienceRateRequestDetail,
  OPEN_DOCUMENT_EVENT,
  makeScopedWireBundleLoader,
  rdfLoadArgs,
  WIRE_CONTEXT_REQUEST_EVENT,
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
  WIRE_REFRESH_ALL_REQUEST_EVENT,
  WIRE_REFRESH_REQUEST_EVENT,
  type ShEditorHost,
  type CenterPaneCloseIntentDetail,
  type CenterPaneEditorHostOptions,
  type CenterPaneFocusIntentDetail,
  type CenterPaneId,
  type CenterPaneLocation,
  type CenterPaneNavigateIntentDetail,
  type CenterPaneOpenIntentDetail,
  type CenterPaneResizeIntentDetail,
  type EditorServices,
  type EditorHostBinding,
  type EditorHostState,
  type EditorImageInsert,
  type EditorImageInserter,
  type EditorKernelOptions,
  type PickerEditorHandle,
  type ChatService,
  type ChatHeaderActionDetail,
  type ChatPresentation,
  type ChatSurfaceActionIntent,
  type HojaWikiLinkResolver,
  type CitationPickerItem,
  type CitationPickerService,
  type DailyNoteCalendarAnchorDetail,
  type DailyNoteDoc,
  type DailyNoteOpenDetail,
  type DailyNotePopoverState,
  type DocHistoryCursorDetail,
  type DocHistoryDiffStyle,
  type DocHistoryDiffStyleDetail,
  type DocHistoryRestoreDetail,
  type DocHistorySnapshot,
  type DocHistorySnapshotDetail,
  type DocHistoryStatus,
  type EditorBlockFocusRequest,
  type EditorCommentInsertedDetail,
  type EditorDocumentAccess,
  type EditorStructureChangeDetail,
  type GrowCell,
  type GraphPanelNode,
  type GraphPanelNodeSelectDetail,
  type GraphPanelNodeOpenDetail,
  type GraphPanelRefreshDetail,
  type GraphPanelEdge,
  type GraphPanelEdgeSelectDetail,
  type GraphPanelViewMode,
  type GraphPanelViewModeChangeDetail,
  type OutlinePanelCommandDetail,
  type OutlinePanelNavigateDetail,
  type OpenDocumentDetail,
  type ArtifactEditorGenerateDetail,
  type ArtifactEditorSaveDetail,
  type ArtifactHistoryRevision,
  type ArtifactHistoryRevisionDetail,
  type ArtifactHistoryStatus,
  type ArtifactViewIntentDetail,
  type ArtifactViewOpenDocumentDetail,
  type PinnedWireBlock,
  type PinnedWireBlockContextState,
  type PinnedWireDocument,
  type PinnedWireNode,
  type RenderWorkspaceOptions,
  type ExcalidrawRuntimeHandle,
  type SidebarActionDetail,
  type SidebarNode,
  type SidebarNodeDetail,
  type SidebarNodeDropDetail,
  type SidebarSection,
  type TagLensBlock,
  type TagLensOpenBlockDetail,
  type ZoteroSourceAnnotation,
  type ZoteroSourceBaseDetail,
  type ZoteroSourceIncomingWire,
  type ZoteroSourceItem,
  type ZoteroSourceOpenDocumentDetail,
  type ZoteroSourceOpenTagDetail,
  type ZoteroSourceOpenZoteroDetail,
  type ZoteroSourcePromoteAnnotationDetail,
  type WireContextBlock,
  type WireContextData,
  type WireContextRequestDetail,
  type WireContextState,
  type WireDeleteRequestDetail,
  type WirePinBlockRequestDetail,
  type WirePinDocumentRequestDetail,
  type WirePinWireRequestDetail,
  type WireRadialContextRequestDetail,
  type WireRadialContextState,
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
  type WireRefreshRequestDetail,
  type WireBundle,
  type SalienceBundle,
  makeScopedSalienceBundleLoader,
  captureSalienceScore,
  withSalienceScore,
  rollbackSalienceScore,
  type WorkspaceComment,
  type WorkspaceCommentDetail,
  type WorkspaceCommentEditDetail,
  type WorkspaceCommentHoverDetail,
  type WorkspaceCommentResolveDetail,
  type WorkspaceInspectorActionDetail,
  type WorkspaceInspectorRelationOpenDetail,
  type WorkspaceHomeDocument,
  type WorkspacePanelRepositionDetail,
  type WorkspaceFragmentsOptions,
  type WorkspaceQuickClipRequestDetail,
  type WorkspaceQuickClipStatus,
  type WorkspaceSummary,
  type WorkspaceContestedOptions,
  type ParkedWorkOptions,
  type SubjectRowActivateDetail,
  setWorkspaceNamedQueryRegistry,
  OBJECT_INTENT_EVENT,
  type ObjectCardIntent,
  type ObjectIntentDetail,
} from '@shrubbery/runtime'
import {
  CommandRegistryImpl,
  DEFAULT_RIGHT_PANEL,
  NULL_EDITOR_SCOPE,
  getWirePredicateLabel,
  rightPanelModeFromPanels,
  selectRightPanel,
  type CommandContext,
  type EditorScope,
  type FilePaneColumnPathChangeDetail,
  type FilePaneGroupingChangeDetail,
  type FilePaneOperationFeedback,
  type FilePaneSelectionDetail,
  type FilePaneSortChangeDetail,
  type MenuEntry,
  type MenuSelectDetail,
  type PanelId,
  type RightPanelMode,
  type ProviderHandle,
  createSelectionBus,
  type SelectionBus,
  type SelectedObject,
  type NavResource,
  type ShrubberyStore,
  type StoreState,
  type AppId,
  type BlockScore,
} from '@shrubbery/nucleus'

// 3) The real nucleus: literals + RDF codec + serializer.
import {
  GARDEN_DEFAULT,
  GARDEN_VARIANT,
  parseNT,
  parseTriplesToConfig,
  serializeConfigToTriples,
  triplesToNT,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'

// 4) The REAL committed seed .nt (the body the Rust ux_seed.rs inserts into a
//    cell's :ux:config graph), imported as a raw string by Vite.
import SEED_NT from '@shrubbery/nucleus/seed/garden-default.ux.nt?raw'

// 5) SHELL-SIDE: the gardend-backed contract + the session-store factory.
import { dispatchCenterPaneIntentChange } from './cell/center-pane-intent.js'
import {
  createGardendContract,
  type GardendContract,
} from './cell/gardend-contract.js'
import type { DocumentActivationManager } from './cell/document-activation.js'
import { EditorRoomPool, type EditorRoomLease } from './cell/editor-room-pool.js'
import {
  addGraphPanelDocumentNode,
  addGraphPanelEdge,
  projectDocumentGraph,
  projectSidebarNodeToGraphPanel,
  pushNodeHistory,
  upsertGraphPanelNode,
} from './cell/graph-panel-projection.js'
import { bootstrapTauriLocalCell } from './cell/tauri-local-bootstrap.js'
import {
  createSessionStore,
  loadConfigFromCell,
  workspaceConfigStore,
  type CellContract,
  type SessionStore,
  type SessionStoreState,
} from './cell/session-store.js'
import {
  clearCellErrorPanel,
  makeDefaultWorkspaceNotice,
  renderCellErrorPanel,
} from './cell/default-workspace-ui.js'
import { WorkspaceFragmentsController } from './cell/workspace-fragments.js'
import { createSourceObjectService } from './cell/source-object-runtime.js'
import {
  decorateSidebarSectionsWithSourceState,
  sourceMirrorRefreshDecision,
  sourceStatusModel,
} from './cell/source-status.js'
import { createObservatoryFreshnessAttachment } from './cell/observatory-freshness-attachment.js'
import { createShellNamedQueryRegistry } from './harness/shell-named-query-registry.js'
import { SYNC_QUERY } from './harness/source-sync-query-catalog.js'
import {
  contestedSelectionFrom,
  reconcileContestedSelection,
  type ContestedSurfaceState,
} from './cell/contested-surface.js'
import {
  exportParkedWork,
  loadParkedWork,
  parkedDocumentsCountFor,
  parkedExportFilename,
  parkedRecoveryKeyOf,
  parkedSidebarSection,
  type ParkedWorkModel,
} from './cell/parked-work.js'
import {
  resolutionMenuModel,
  pickResolution,
  pickComposedRecord,
  showLostRaceDialog,
  type ResolutionMenuInput,
  type ResolutionMenuProposal,
} from './cell/resolution-flow.js'
import {
  ReapplyController,
  type ContestedHandoff,
  type ReapplyOutcome,
  type ReapplyView,
} from './cell/reapply-controller.js'
import {
  LEFT_PANEL_SNAP,
  PANEL_SNAP_THRESHOLD_PX,
  RIGHT_PANEL_SNAP,
  readPanelLayoutState,
  writePanelLayoutState,
  type OrganismPanelLayoutState,
} from './cell/panel-layout-state.js'
import { FilePaneController } from './cell/file-pane-controller.js'
import {
  handleLandmarkCycleShortcut,
  handleRegistryDocumentShortcut,
} from './cell/keyboard-shortcuts.js'
import {
  loadSidebarSections,
  sidebarFolderMoveExcludeIds,
  sidebarFolderOptionsFromSections,
} from './cell/sidebar-documents.js'
import { resolveSidebarDrop } from './cell/sidebar-drop.js'
import {
  documentSwitcherActionRows,
  documentSwitcherDocumentsFromSidebar,
  documentSwitcherOfflineSemanticItems,
  documentSwitcherItems,
  loadDocumentSwitcherBlocks,
  mergeDocumentSwitcherBlockItems,
} from './cell/document-switcher.js'
import {
  createSidebarDocument,
  createSidebarFolder,
  deleteSidebarDocument,
  deleteSidebarFolder,
  moveSidebarDocument,
  moveSidebarFolder,
  renameSidebarDocument,
  renameSidebarFolder,
  SidebarMutationRejectedError,
} from './cell/sidebar-mutations.js'
import {
  MobileFileMutationFlow,
  type MobileFileMutationIntent,
} from './cell/mobile-file-mutation-flow.js'
import { loadTagLensBlocks } from './cell/tag-lens.js'
import {
  ensureDailyNote,
  loadDailyNotes,
  todayKeyForTimeZone,
  type DailyNoteDocument,
} from './cell/daily-notes.js'
import {
  artifactIdFromZoteroKey,
  createZoteroGroundingWire,
  loadZoteroSource,
  materializedSourceArtifactId,
  materializeZoteroSource,
  QUOTES_FROM_PREDICATE,
  searchZoteroItems,
  zoteroKeyFromArtifactId,
} from './cell/zotero-source.js'
import {
  createDocumentCommentsSource,
  type DocumentCommentData,
  type DocumentCommentsSource,
} from './cell/document-comments.js'
import {
  activeDocumentSelection,
  projectInspectorActions,
  projectInspectorModel,
  type InspectorProjectionInput,
} from './cell/inspector-projection.js'
import {
  detectOrganismAppRoute,
  lifetimeBannerTemplate,
  mountOrganismAppRoute,
  reapplyOverlayTemplate,
  type MountOrganismAppRouteOptions,
  type OrganismAuthActions,
  type OrganismAppRoute,
  type OrganismAppRouteMount,
  type OrganismOpsHealthService,
} from './cell/app-routes.js'
import {
  gardenGraphLocation,
  gardenGraphPath,
  type OrganismGardenHomeService,
  type OrganismGardenHomeSnapshot,
} from './cell/garden-home-route.js'
import {
  settingsCellGraph,
  settingsNavigationUrl,
  settingsReturnPath,
} from './cell/settings-navigation.js'
import { createSettingsOverlayTransition } from './cell/settings-overlay-transition.js'
import { ChoreographStudioService } from './cell/choreograph-studio-service.js'
import { mountPublicShellRoute } from './cell/public-shell.js'
import {
  installOrganismWireMode,
  wireModeEditorFromHost,
  type OrganismWireModeLifecycle,
} from './cell/wire-mode-lifecycle.js'
import {
  attachDocumentExportDialog,
  documentImportDirectoryParts,
  GardendDocumentTransferService,
  pickDocumentFiles,
  saveBlob,
  type DocumentExportDialogController,
} from './cell/document-transfer.js'
import {
  cellRequestHeaders,
  fetchArtifactBlob,
  fetchArtifactRevisionBlob,
  fetchArtifactRevisionList,
  fetchDocumentSnapshotJson,
  fetchDocumentSnapshotText,
  fetchDocumentSnapshotVoid,
  graphCellUrl,
  normalizeArtifactRevision,
  normalizeDocumentSnapshot,
  pickImageFile,
  postArtifactRevision,
  restoreArtifactRevision,
  uploadImageForEditor,
  type HostedDocumentSnapshotEntry,
  type HostedDocumentSnapshotListResponse,
} from './cell/rest-helpers.js'
import {
  createCognitoAuthSession,
  type CognitoAuthSession,
} from './cell/cognito-auth-session.js'
import { createHostedEvidenceService } from './cell/hosted-evidence-service.js'
import {
  EXCALIDRAW_PREDICATE_OPTIONS,
  excalidrawLinkCandidates,
  makeOrganismExcalidrawOptions,
  type ExcalidrawWorkspaceNode,
} from './cell/excalidraw-cell-service.js'
import type { SceneLinkTarget } from './cell/excalidraw-scene-links.js'
import {
  documentIdOf,
  type SourceBundle,
  type SourceMirrorState,
  type SourceOutboxRecord,
  type ResolveCurrentIntent,
} from '@shrubbery/source'
import {
  createHostedGatewayContract,
  type HostedGatewayContract,
} from './cell/hosted-gateway-contract.js'
import { createDevServiceProxyAuthStorage } from './cell/dev-service-proxy-auth.js'
import type { GatewayGraphInfo } from './cell/gateway-transport.js'
import { HomeActivityStore, type HomeDocumentSource } from './cell/home-activity.js'
import {
  OpenRouterImageGenerationService,
  TauriImageProviderKeySource,
} from './cell/image-generation-service.js'
import { generateArtifactImage } from './cell/image-generation-flow.js'
import {
  resolveOrganismDeploymentConfig,
  selectHostedGraphId,
  type HostedDeploymentConfig,
} from './cell/deployment-config.js'
import {
  createShellContext,
  type OrganismSourceMode,
  type ShellContext,
} from './cell/shell-context.js'
import { createShellFeatureHost } from './cell/shell-feature-host.js'
import {
  createOrganismShellFeatureHost,
  ORGANISM_APPEARANCE_CHANGE_EVENT,
  type OrganismAppearanceChangeDetail,
} from './cell/shell-features.js'
import {
  persistAppearancePreferences,
  readAppearancePreferences,
  resolveThemePreference,
} from './cell/settings-service.js'
import { createOrganismMobileShellFeature } from './cell/mobile-shell-controller.js'
import {
  ORGANISM_ROUTE_VIEWPORT_FRAME_ATTRIBUTE,
  OrganismVisualViewportFrameController,
} from './cell/visual-viewport-frame-controller.js'

interface OrganismMcpClient {
  toolsCall(name: string, args: Record<string, unknown>): Promise<unknown>
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

/** The RAW (unwrapped) caller shape `createSourceObjectService`'s authority path needs — see `GardendContract.rawMcp`'s own doc comment. */
interface OrganismRawMcpCaller {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

type OrganismCellContract = CellContract & {
  readonly mcp: OrganismMcpClient
  readonly rawMcp: OrganismRawMcpCaller
  readonly documentActivation: DocumentActivationManager
  readonly sourceMirror: GardendContract['sourceMirror']
}
type OrganismSessionStore = SessionStore<OrganismCellContract>

// This is the only app-lifetime composition point for isolated shell features.
// Feature modules plug into the five lifecycle hooks in shell-feature-host.ts;
// the workspace, route, and provider call sites below do not need to move again.
// The workspace surface resolves `urn:sophia:query:*` refs through this
// registry. Injected HERE, at module top level, because the surface is defined
// lazily on first render and its resolver closes over whatever registry exists
// at that moment — a later call throws rather than silently not applying.
//
// Without it the Observatory's tabs layout renders every pane as
// `resource-unavailable`: its 19 queries are all named refs, and the surface's
// default registry is empty. `rawTextPolicy: 'allow-raw'` keeps inline-SPARQL
// layouts working either way, which is precisely what made the gap invisible.
//
// MO object-face integration spec, master §3 Slice 5: the shell registry now
// composes the Observatory's nineteen WITH source-sync's two
// (`sync.conflicts-open`/`sync.conflict-candidates`, §2.7) — the contested
// wayfinding surface resolves its table through this SAME sealed registry,
// not a second one.
setWorkspaceNamedQueryRegistry(createShellNamedQueryRegistry())

const shellFeatureHost = createOrganismShellFeatureHost<OrganismCellContract>()
const visualViewportFrameController = new OrganismVisualViewportFrameController()
const mobileShellFeatureHost = createShellFeatureHost<OrganismCellContract>([
  createOrganismMobileShellFeature<OrganismCellContract>(),
])

const deploymentConfig = resolveOrganismDeploymentConfig({
  VITE_GATEWAY_BASE_URL: import.meta.env.VITE_GATEWAY_BASE_URL,
  VITE_COGNITO_REGION: import.meta.env.VITE_COGNITO_REGION,
  VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
  VITE_COGNITO_USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  VITE_CHAT_API_BASE_URL: import.meta.env.VITE_CHAT_API_BASE_URL,
  VITE_CLOUD2_SERVICE_PROXY_SUBJECT: import.meta.env.DEV
    ? import.meta.env.VITE_CLOUD2_SERVICE_PROXY_SUBJECT
    : undefined,
})
let deploymentContract: OrganismCellContract | null = null
let hostedGatewayContract: HostedGatewayContract | null = null
let hostedAuthSession: CognitoAuthSession | null = null
let hostedEvidenceService: ReturnType<typeof createHostedEvidenceService> | null = null
let stopHostedAuthRefresh: (() => void) | null = null
let hostedGraphs: readonly GatewayGraphInfo[] = []
let hostedGraphsStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
let hostedGraphsError = ''
let hostedWorkspaceBusyId = ''

// 6) SHELL-SIDE: the live Emporium vocab-catalogue store + the DOM views built
//    from the GENERALIZED iter-4a components (mn-card/mn-chip/mn-badge). lit's
//    `render` mounts these TemplateResults into the same #host frame.
import { render as litRender } from 'lit'
import { createEmporiumStore, type EmporiumStore, type EmporiumStoreState } from './cell/emporium-store.js'
import { renderVocabCatalogue, renderVocabPack } from './cell/vocab-views.js'

// ── DOM handles ───────────────────────────────────────────────────────────────
const editor = document.getElementById('seed-editor') as HTMLTextAreaElement
const sourceSelect = document.getElementById('source-select') as HTMLSelectElement
/**
 * The active `app` dimension — REAL shell state (Slice 10,
 * `06-observatory-app-dimension-defect.md` D1/D2), client-local per LAY-008,
 * the same projection discipline `currentSkin`/`currentTheme` (a few lines
 * down) use for other chrome state. `#app-select`, the legacy hidden debug
 * `<select>` this replaced, is retired outright (bundle audit finding 13,
 * 2026-07-31) rather than kept as a second convenience writer: unlike
 * `currentSkin`/`currentTheme`'s debug selects (a closed, static enum with no
 * "invalid" value), `#app-select` hardcoded a 'garden'/'choreograph' pair —
 * exactly the closed-tab-list anti-pattern D1 eliminated from the real
 * switcher (`deriveAppTabs(config)`, no hardcoded list) — so keeping it would
 * have reintroduced a second, driftable, config-blind source of app ids right
 * next to the mechanism built to stop that. The real `mn-top-bar` switcher
 * already renders live inside `#host` for every source mode, including this
 * debug harness, so nothing is lost: clicking it is the one write path now,
 * via the `mn-app-change` listener below.
 */
let currentApp: AppId | undefined
const reparseBtn = document.getElementById('reparse-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLDivElement
const hostEl = document.getElementById('host') as HTMLDivElement
/**
 * The ordinary workspace's OWN banner/overlay mount (bundle audit findings
 * 2/3, 2026-07-31) — plain flow siblings of `#host` in `.shell-pane`, filled
 * by `reflectWorkspaceLifetimeAndReapply()` via the SAME `lifetimeBannerTemplate`/
 * `reapplyOverlayTemplate` `app-routes.ts` uses for its own frames. `#host`
 * itself stays exclusively owned by `renderWorkspace()`/`mountOrganismAppRoute()`,
 * exactly as before — these two slots are additive siblings, never touching it.
 */
const workspaceLifetimeBannerSlot = document.getElementById('workspace-lifetime-banner-slot') as HTMLDivElement
const workspaceReapplyOverlaySlot = document.getElementById('workspace-reapply-overlay-slot') as HTMLDivElement
// Settings-in-place preserves this entire surface below its modal route
// frame. It deliberately includes both shell-owned slots as well as #host:
// inverting only #host would leave fixed workspace chrome interactive.
const workspaceSurfaceEl = hostEl.closest<HTMLElement>('.shell-pane')
if (!workspaceSurfaceEl) throw new Error('Organism: #host has no workspace surface')
const cellControls = document.getElementById('cell-controls') as HTMLDivElement
const cellGraphId = document.getElementById('cell-graph-id') as HTMLInputElement
const cellDocId = document.getElementById('cell-doc-id') as HTMLInputElement
const cellRefreshBtn = document.getElementById('cell-refresh-btn') as HTMLButtonElement
const cellOpenDocBtn = document.getElementById('cell-open-doc-btn') as HTMLButtonElement
const cellPoll = document.getElementById('cell-poll') as HTMLInputElement
const skinSelect = document.getElementById('skin-select') as HTMLSelectElement
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement
const commandMenuEl = document.createElement('mn-context-menu') as MnContextMenu
const documentSwitcherEl = document.createElement('mn-document-switcher') as MnDocumentSwitcher
const advancedWireMenuEl = document.createElement('mn-advanced-wire-menu') as MnAdvancedWireMenu
const exportDialogEl = document.createElement('mn-export-dialog') as MnExportDialog
const inputDialogEl = document.createElement('mn-input-dialog') as MnInputDialog
const confirmationDialogEl = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
const folderPickerDialogEl = document.createElement('mn-folder-picker-dialog') as MnFolderPickerDialog
const shortcutsDialogEl = document.createElement('mn-shortcuts-dialog') as MnShortcutsDialog
const settingsOverlayTransition = createSettingsOverlayTransition({
  host: workspaceSurfaceEl,
  history: window.history,
  mount(routeHost, location, onClose): OrganismAppRouteMount | null {
    return mountOrganismAppRoute(
      routeHost,
      organismAppRouteOptions(location, () => onClose()),
    )
  },
  onBeforeOpen: clearWorkspaceLifetimeAndReapply,
  onAfterClose: reflectWorkspaceLifetimeAndReapply,
})
document.body.appendChild(commandMenuEl)
document.body.appendChild(documentSwitcherEl)
document.body.appendChild(advancedWireMenuEl)
document.body.appendChild(exportDialogEl)
document.body.appendChild(inputDialogEl)
document.body.appendChild(confirmationDialogEl)
document.body.appendChild(folderPickerDialogEl)
document.body.appendChild(shortcutsDialogEl)
const emporiumControls = document.getElementById('emporium-controls') as HTMLDivElement
const emporiumRefreshBtn = document.getElementById('emporium-refresh-btn') as HTMLButtonElement
const emporiumBackBtn = document.getElementById('emporium-back-btn') as HTMLButtonElement

// ── The N-Triples for each built-in config (real serialization, not mock) ─────
const ntFor = (config: WorkspaceConfig): string => triplesToNT(serializeConfigToTriples(config))

const PRESETS: Record<string, () => string> = {
  GARDEN_DEFAULT: () => ntFor(GARDEN_DEFAULT),
  GARDEN_VARIANT: () => ntFor(GARDEN_VARIANT),
  SEED_NT: () => SEED_NT,
}

// The once-per-graph "default workspace" notice (chrome over read.defaulted —
// see default-workspace-ui.ts). Lives outside the render host so workspace
// re-renders never clobber it.
const defaultWorkspaceNotice = makeDefaultWorkspaceNotice(document)

// ── Status reporting ──────────────────────────────────────────────────────────
function ok(msg: string): void {
  statusEl.className = 'ok'
  statusEl.textContent = msg
}
function err(msg: string): void {
  statusEl.className = 'err'
  statusEl.textContent = msg
}

function makeEditorImageInserter(contract: OrganismCellContract, graphId: string): EditorImageInserter {
  return async () => {
    const file = await pickImageFile()
    if (!file) return null
    try {
      const attrs = await uploadImageForEditor(contract, graphId, file)
      ok(`uploaded image "${file.name}"`)
      return attrs
    } catch (e) {
      err(`image upload error:\n${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }
}

function makeCitationPickerService(contract: OrganismCellContract, graphId: string): CitationPickerService {
  return {
    search(query: string): Promise<readonly CitationPickerItem[]> {
      return searchZoteroItems(contract, graphId, query)
    },
    async materialize(item: CitationPickerItem): Promise<{ artifactId: string }> {
      const raw = await materializeZoteroSource(contract, graphId, item.key)
      return { artifactId: materializedSourceArtifactId(raw, item.key) }
    },
    async ground(request): Promise<void> {
      await createZoteroGroundingWire(contract, request.graphId, {
        sourceDocumentId: request.sourceDocumentId,
        sourceBlockId: request.sourceBlockId,
        targetArtifactId: request.targetArtifactId,
      })
    },
  }
}

interface PromptDialogOptions {
  readonly title: string
  readonly message?: string
  readonly value?: string
  readonly placeholder?: string
  readonly confirmText?: string
}

function promptForText(opts: PromptDialogOptions): Promise<string | null> {
  inputDialogEl.title = opts.title
  inputDialogEl.message = opts.message ?? ''
  inputDialogEl.value = opts.value ?? ''
  inputDialogEl.placeholder = opts.placeholder ?? ''
  inputDialogEl.confirmText = opts.confirmText ?? 'OK'
  inputDialogEl.cancelText = 'Cancel'
  inputDialogEl.loading = false

  return new Promise((resolve) => {
    function cleanup(): void {
      inputDialogEl.removeEventListener('mn-confirm', onConfirm)
      inputDialogEl.removeEventListener('mn-cancel', onCancel)
    }
    function onConfirm(event: Event): void {
      cleanup()
      inputDialogEl.hide()
      resolve((event as CustomEvent<MnInputDialogConfirmDetail>).detail.value.trim())
    }
    function onCancel(): void {
      cleanup()
      resolve(null)
    }
    inputDialogEl.addEventListener('mn-confirm', onConfirm)
    inputDialogEl.addEventListener('mn-cancel', onCancel)
    inputDialogEl.show()
  })
}

interface ConfirmDialogOptions {
  readonly title: string
  readonly message: string
  readonly confirmText?: string
  readonly variant?: MnConfirmationDialog['variant']
}

function confirmAction(opts: ConfirmDialogOptions): Promise<boolean> {
  confirmationDialogEl.title = opts.title
  confirmationDialogEl.message = opts.message
  confirmationDialogEl.confirmText = opts.confirmText ?? 'Confirm'
  confirmationDialogEl.secondaryConfirmText = ''
  confirmationDialogEl.cancelText = 'Cancel'
  confirmationDialogEl.variant = opts.variant ?? 'default'
  confirmationDialogEl.loading = false

  return new Promise((resolve) => {
    function cleanup(): void {
      confirmationDialogEl.removeEventListener('mn-confirm', onConfirm)
      confirmationDialogEl.removeEventListener('mn-cancel', onCancel)
    }
    function onConfirm(): void {
      cleanup()
      confirmationDialogEl.hide()
      resolve(true)
    }
    function onCancel(): void {
      cleanup()
      resolve(false)
    }
    confirmationDialogEl.addEventListener('mn-confirm', onConfirm)
    confirmationDialogEl.addEventListener('mn-cancel', onCancel)
    confirmationDialogEl.show()
  })
}

type DocumentImportPickerKind = 'files' | 'folder'

/** Garden exposes both file and directory transfer from the sidebar upload
 * affordance. Reuse the lifted confirmation dialog as a small two-choice
 * launcher; cancellation performs no filesystem or network work. */
function pickDocumentImportKind(): Promise<DocumentImportPickerKind | null> {
  confirmationDialogEl.title = 'Import Documents'
  confirmationDialogEl.message = 'Choose files, or preserve a folder hierarchy from your computer.'
  confirmationDialogEl.confirmText = 'Choose Files'
  confirmationDialogEl.secondaryConfirmText = 'Choose Folder'
  confirmationDialogEl.cancelText = 'Cancel'
  confirmationDialogEl.variant = 'default'
  confirmationDialogEl.loading = false

  return new Promise((resolve) => {
    function cleanup(): void {
      confirmationDialogEl.removeEventListener('mn-confirm', onFiles)
      confirmationDialogEl.removeEventListener('mn-secondary-confirm', onFolder)
      confirmationDialogEl.removeEventListener('mn-cancel', onCancel)
      confirmationDialogEl.secondaryConfirmText = ''
    }
    function finish(value: DocumentImportPickerKind | null): void {
      cleanup()
      confirmationDialogEl.hide()
      resolve(value)
    }
    function onFiles(): void {
      finish('files')
    }
    function onFolder(): void {
      finish('folder')
    }
    function onCancel(): void {
      finish(null)
    }
    confirmationDialogEl.addEventListener('mn-confirm', onFiles)
    confirmationDialogEl.addEventListener('mn-secondary-confirm', onFolder)
    confirmationDialogEl.addEventListener('mn-cancel', onCancel)
    confirmationDialogEl.show()
  })
}

interface FolderPickOptions {
  readonly title: string
  readonly currentParentId: string | null
  readonly section: 'documents' | 'artifacts'
  readonly excludeIds?: readonly string[]
}

function pickSidebarFolder(opts: FolderPickOptions): Promise<string | null | undefined> {
  folderPickerDialogEl.title = opts.title
  folderPickerDialogEl.currentParentId = opts.currentParentId
  folderPickerDialogEl.section = opts.section
  folderPickerDialogEl.excludeIds = [...(opts.excludeIds ?? [])]
  folderPickerDialogEl.folders = sidebarFolderOptionsFromSections(currentSidebarSections) as MnFolderPickerOption[]

  return new Promise((resolve) => {
    function cleanup(): void {
      folderPickerDialogEl.removeEventListener('mn-select', onSelect)
      folderPickerDialogEl.removeEventListener('mn-cancel', onCancel)
    }
    function onSelect(event: Event): void {
      cleanup()
      resolve((event as CustomEvent<MnFolderPickerSelectDetail>).detail.folderId)
    }
    function onCancel(): void {
      cleanup()
      resolve(undefined)
    }
    folderPickerDialogEl.addEventListener('mn-select', onSelect)
    folderPickerDialogEl.addEventListener('mn-cancel', onCancel)
    folderPickerDialogEl.show()
  })
}

/** Label still-undefined custom elements so they read as inert placeholders. */
function labelInertPlaceholders(): void {
  const all = hostEl.querySelectorAll('*')
  for (const el of Array.from(all)) {
    const tag = el.tagName.toLowerCase()
    if (!tag.includes('-')) continue
    if (customElements.get(tag)) continue
    el.setAttribute('data-placeholder-for', tag)
  }
}

// ── EDITOR WIRING (GAP 1 close) — net-new open-document state + the editor seam ──
//
// main.ts had NO open-document concept (it reads :ux:config). The live editor mounts
// only in CELL_LIVE mode when a document is open: a real cell + graphId + documentId.
// Without a documentId the scope is NULL_EDITOR_SCOPE (home) and no editor mounts — the
// honest default. The doc_id is chosen via the #cell-doc-id override OR a first-doc-from-
// cell pick (a doc-list SELECT the contract.rest can already issue).
//
// MULTIPLEXER CONTRACT: panes own attachment leases, never sockets. The room pool opens
// one ProviderHandle per browser-session room and shares it between pane-local TipTap
// views. The host keys teardown SOLELY on ProviderHandle identity, so layout/focus renders
// re-emit stable objects and preserve each mounted view's undo history.

let openDocId: string | null = null
let currentGraphId = 'organism-dev'
const homeActivityStore = new HomeActivityStore(browserLocalStorage())
let currentZoomBlockId: string | null = null
let currentBlockFocusRequest: EditorBlockFocusRequest | null = null
let nextBlockFocusToken = 0
let currentPinnedWireDocs: PinnedWireDocument[] = []
let currentPinnedWireNodes: PinnedWireNode[] = []
let currentPinnedWireBlocks: PinnedWireBlock[] = []
type LeftPanelMode = 'files' | 'graph' | 'outline'

const VALID_RIGHT_PANEL_IDS = new Set<PanelId>(['chat', 'comments', 'wires', 'inspector', 'graph'])
const panelLayoutStorage = browserSessionStorage()
const filePaneController = new FilePaneController(panelLayoutStorage)
const centerPanesSessionRepository = new CenterPanesSessionRepository(panelLayoutStorage)
let centerPanesSessionGraphId = currentGraphId
const centerPanesController = new CenterPanesController({ graphId: currentGraphId })
const restoredInitialCenterPanes = centerPanesSessionRepository.load(currentGraphId)
if (restoredInitialCenterPanes) centerPanesController.replaceState(restoredInitialCenterPanes)
centerPanesController.subscribe((state) => {
  centerPanesSessionRepository.save(centerPanesSessionGraphId, state)
})
let documentSwitcherTargetPaneId: CenterPaneId | null = null
let documentSwitcherPlacement: 'active' | 'split' = 'active'
const GRAPH_PANEL_VIEW_MODE_KEY = 'shrubbery:graph-panel-view-mode'
let currentGraphPanelViewMode: GraphPanelViewMode =
  panelLayoutStorage?.getItem(GRAPH_PANEL_VIEW_MODE_KEY) === 'document' ? 'document' : 'workspace'
// Back/forward history of graph-node selections. Not persisted — a
// browser-history-style stack for one live session, reset naturally on
// reload same as everything else in this module.
let graphNodeHistory: string[] = []
let graphNodeHistoryIndex = -1
let currentPanelLayout: OrganismPanelLayoutState = readPanelLayoutState(panelLayoutStorage)
const initialRightPanel = readRightPanelFromUrl()
let preExpandRightPanel: RightPanelMode = initialRightPanel
let currentRightPanel: RightPanelMode = currentPanelLayout.rightCollapsed || currentPanelLayout.leftExpanded
  ? 'none'
  : initialRightPanel
let currentLeftPanelMode: LeftPanelMode = 'files'
let currentSidebarSections: readonly SidebarSection[] = []
let currentSidebarStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
let currentSidebarError = ''
let currentSidebarSearchQuery = ''
let currentSidebarSelectedId: string | null = null
let currentSidebarExpandedFolders = new Set<string>()
let latestSidebarRequest = 0

type OrganismMobileFileMutationIntent = MobileFileMutationIntent & {
  readonly store: OrganismSessionStore
  readonly graphId: string
  /** Runs the gardend mutation and refreshes every dependent shell projection. */
  readonly perform: () => Promise<void>
  /** Checks the refreshed authoritative sidebar projection, never optimistic UI. */
  readonly isReflected: () => boolean
  readonly reflectedMessage: string
  readonly notReflectedMessage: string
}

let currentMobileFileOperation: FilePaneOperationFeedback | null = null
let mobileFileOperationDismissTimer: ReturnType<typeof setTimeout> | null = null

function publishMobileFileOperation(feedback: FilePaneOperationFeedback | null): void {
  currentMobileFileOperation = feedback
  if (mobileFileOperationDismissTimer !== null) {
    clearTimeout(mobileFileOperationDismissTimer)
    mobileFileOperationDismissTimer = null
  }
  if (feedback?.state === 'success') {
    const operationId = feedback.id
    mobileFileOperationDismissTimer = setTimeout(() => {
      mobileFileOperationDismissTimer = null
      mobileFileMutationFlow.clear(operationId)
    }, 1_800)
  }
  if (sourceSelect.value === 'CELL_LIVE' && store) rerenderCurrentSource()
}

const mobileFileMutationFlow = new MobileFileMutationFlow<OrganismMobileFileMutationIntent>({
  execute: async intent => {
    await intent.perform()
    if (!intent.isReflected()) {
      throw new SidebarMutationRejectedError(intent.notReflectedMessage)
    }
  },
  reconcile: async intent => {
    const stillCurrent = await refreshAfterSidebarMutation(intent.store, intent.graphId)
    if (!stillCurrent) {
      return {
        state: 'indeterminate',
        message: 'The workspace changed before Garden could check the current files.',
      }
    }
    return intent.isReflected()
      ? { state: 'success', message: intent.reflectedMessage }
      : {
          state: 'terminal-error',
          message: intent.notReflectedMessage,
          retryable: false,
        }
  },
  onChange: feedback => publishMobileFileOperation(feedback),
})

function mobileFileMutationMessage(
  result: FilePaneOperationFeedback,
  fallback: string,
): string {
  return result.message?.trim() || fallback
}

async function runMobileFileMutation(
  intent: OrganismMobileFileMutationIntent,
  successLog: string,
  errorLabel: string,
): Promise<void> {
  try {
    if (
      currentMobileFileOperation
      && currentMobileFileOperation.graphId !== intent.graphId
      && currentMobileFileOperation.state !== 'pending'
    ) {
      mobileFileMutationFlow.clear(currentMobileFileOperation.id)
    }
    const result = await mobileFileMutationFlow.run(intent)
    if (result.state === 'success') ok(successLog)
    else err(`${errorLabel}:\n${mobileFileMutationMessage(result, 'Garden could not complete the operation.')}`)
  } catch (error) {
    err(`${errorLabel}:\n${error instanceof Error ? error.message : String(error)}`)
  }
}

async function recoverMobileFileOperation(detail: {
  readonly operationId: string
  readonly action: 'retry' | 'reconcile'
}): Promise<void> {
  const result = detail.action === 'reconcile'
    ? await mobileFileMutationFlow.reconcile(detail.operationId)
    : await mobileFileMutationFlow.retry(detail.operationId)
  if (!result) return
  if (result.state === 'success') {
    ok(mobileFileMutationMessage(result, 'The current files now confirm the operation.'))
  } else if (result.state !== 'pending') {
    err(`file operation ${detail.action}:\n${mobileFileMutationMessage(
      result,
      'Garden still could not confirm the operation.',
    )}`)
  }
}

let currentDailyNotes: DailyNoteDocument[] = []
let currentDailyNotePopover: DailyNotePopoverState | null = null
let latestDailyNotesRequest = 0
let currentHoveredCommentId: string | null = null
let currentCommentsSource: DocumentCommentsSource | null = null
let stopCommentsSubscription: (() => void) | null = null
let currentInspectorSelection: SelectedObject | null = null

// ── Semantic edge overlay, slice 1 — selection bus + per-face select emitters ──
// The three Tier-A couplings (comments→inspector drivesSelection, graph→editor
// reveals, comments→editor reveals) are lifted out of the imperative handlers
// below and installed by the edge-interpreter from `config.edges`. The bus is
// the single reactive selection hub; `inspector.reflect` is ONE ADDITIONAL
// writer of `currentInspectorSelection` (the ~16 other writers stay). Seeded
// with the current inspector selection so the `currentInspectorSelection ??
// activeDocumentSelection(…)` null-fallback parity holds until the first publish.
//
// A per-face emitter is a REAL Set-of-subscribers + emit (not a mock): the
// Tier-A handlers push their raw select detail into it, and the interpreter
// subscribes it as the face's `onSelect`. This decouples the interpreter from
// the panel event wiring while keeping the exact detail payload the panes emit.
interface FaceSelectEmitter<T> {
  subscribe(cb: (raw: T) => void): () => void
  emit(raw: T): void
}
function createFaceSelectEmitter<T>(): FaceSelectEmitter<T> {
  const subscribers = new Set<(raw: T) => void>()
  return {
    subscribe: (cb) => {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
    emit: (raw) => {
      // A selection can synchronously rerender and reinstall the interpreter,
      // which removes this callback and adds its replacement. Keep the current
      // event bounded to the listeners present when it began.
      for (const cb of [...subscribers]) cb(raw)
    },
  }
}
const commentSelectEmitter = createFaceSelectEmitter<WorkspaceCommentDetail>()
const graphSelectEmitter = createFaceSelectEmitter<GraphPanelNodeSelectDetail>()
// Slice-2 OPEN emitters — distinct from the SELECT emitters above. A face's open
// event (graph node-OPEN, sidebar doc-open) is a separate gesture from its select
// event, so the interpreter subscribes it via `onOpen` (not `onSelect`) to drive
// navigatesTo. The split handlers push their raw open detail here; face:graph /
// face:sidebar's `onOpen` replay it and `toResource` normalizes it to a NavResource.
const graphOpenEmitter = createFaceSelectEmitter<GraphPanelNodeOpenDetail>()
const sidebarOpenEmitter = createFaceSelectEmitter<{ documentId: string }>()
const selectionBus: SelectionBus = createSelectionBus(currentInspectorSelection)
// The interpreter's disposer from the last install. Run before re-installing on
// config reload (idempotence) so bus/emitter subscriptions never leak.
let disposeEdgeInterpreter: (() => void) | null = null
type CurrentTagLens = {
  readonly tagName: string
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly blocks: readonly TagLensBlock[]
  readonly error?: string
}
let currentTagLens: CurrentTagLens | null = null
let latestTagLensRequest = 0

type CurrentZoteroSourceSurface = {
  readonly graphId: string
  readonly artifactId: string
  readonly zoteroKey: string
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly item: ZoteroSourceItem | null
  readonly annotations: readonly ZoteroSourceAnnotation[]
  readonly incomingWires: readonly ZoteroSourceIncomingWire[]
  readonly promotedAnnotationKeys: ReadonlySet<string>
  readonly error?: string | null
}
let currentZoteroSourceSurface: CurrentZoteroSourceSurface | null = null
let latestZoteroSourceRequest = 0

type PendingZoteroPromotion = {
  readonly annotationKey: string
  readonly sourceGraphId: string
  readonly targetDocumentId: string
  readonly text: string
  readonly comment: string | null
  readonly artifactId: string
  readonly zoteroKey: string
  readonly citation: string
}
const pendingZoteroPromotionsByDoc = new Map<string, PendingZoteroPromotion[]>()
let pendingZoteroPromotionDrainToken = 0

type CurrentArtifactSurface = {
  readonly graphId: string
  readonly artifactId: string
  readonly title: string
  readonly mimeType: string | null
  readonly fileType: string | null
  readonly artifactStatus: string | null
  readonly ingestedDocumentId: string | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly previewUrl: string | null
  readonly error?: string
  readonly editorOpen: boolean
  readonly editorPrompt: string
  readonly editorGenerationTarget: 'version' | 'artifact'
  readonly editorGenerating: boolean
  readonly editorGenerationError?: string | null
  readonly historyOpen: boolean
  readonly historyStatus: ArtifactHistoryStatus
  readonly historyError?: string | null
  readonly historyRevisions: readonly ArtifactHistoryRevision[]
  readonly historyRestoringRevisionId: string | null
}
let currentArtifactSurface: CurrentArtifactSurface | null = null
let latestArtifactPreviewRequest = 0
let latestArtifactHistoryRequest = 0
let currentArtifactPreviewObjectUrl: string | null = null
let currentArtifactHistoryObjectUrls = new Map<string, string>()
const artifactImageGenerator = new OpenRouterImageGenerationService({
  keys: new TauriImageProviderKeySource(),
})
let artifactImageGenerationAbort: AbortController | null = null
let currentExcalidrawRuntime: ExcalidrawRuntimeHandle | null = null
let currentExcalidrawHost: MnExcalidrawCanvas | null = null
let currentExcalidrawKey = ''
let latestExcalidrawMountRequest = 0

function destroyExcalidrawRuntime(): void {
  currentExcalidrawRuntime?.destroy()
  currentExcalidrawRuntime = null
  currentExcalidrawHost = null
  currentExcalidrawKey = ''
}

function teardownExcalidrawRuntime(): void {
  latestExcalidrawMountRequest += 1
  destroyExcalidrawRuntime()
}

function excalidrawWorkspaceNodes(): readonly ExcalidrawWorkspaceNode[] {
  const nodes: ExcalidrawWorkspaceNode[] = []
  const visit = (entries: readonly SidebarNode[]): void => {
    for (const node of entries) {
      if (node.kind === 'document' || node.kind === 'artifact') {
        nodes.push({
          kind: node.kind,
          id: node.id,
          title: node.label,
          graphId: currentGraphId,
          mimeType: node.mimeType,
          wireDocumentId: node.kind === 'artifact' ? node.ingestedDocumentId : node.id,
        })
      }
      if (node.children?.length) visit(node.children)
    }
  }
  for (const section of currentSidebarSections) visit(section.nodes ?? [])
  return nodes
}

function sidebarNodeById(id: string): SidebarNode | null {
  const find = (entries: readonly SidebarNode[]): SidebarNode | null => {
    for (const node of entries) {
      if (node.id === id) return node
      const nested = node.children?.length ? find(node.children) : null
      if (nested) return nested
    }
    return null
  }
  for (const section of currentSidebarSections) {
    const node = find(section.nodes ?? [])
    if (node) return node
  }
  return null
}

if (import.meta.env.DEV) {
  Object.defineProperty(window, '__shrubberySurfaceTestimony', {
    configurable: true,
    value: (nodeId: string) => ({
      label: sidebarNodeById(nodeId)?.label ?? '',
      status: currentSidebarStatus,
      error: currentSidebarError,
    }),
  })
}

async function openExcalidrawLinkedNode(target: SceneLinkTarget): Promise<void> {
  if (target.kind === 'document') {
    await openDocumentFromShell({ graphId: target.graphId, documentId: target.id })
    return
  }
  if (target.graphId !== currentGraphId) {
    sourceSelect.value = 'CELL_LIVE'
    cellGraphId.value = target.graphId
    // Same rule as openDocumentFromShell: only a null store is a genuine mode
    // entry (e.g. arriving from a non-cell source); an already-active session
    // switching to a different graph must not re-show the strip.
    if (!store) cellControls.hidden = false
    startCellMode()
  }
  const node = sidebarNodeById(target.id)
  openArtifactFromSidebar(target.id, node ?? {
    id: target.id,
    label: target.id,
    kind: 'artifact',
    section: 'artifacts',
  })
}

async function syncCurrentExcalidrawRuntime(): Promise<void> {
  const requestId = ++latestExcalidrawMountRequest
  const surface = currentArtifactSurface
  const activeStore = store
  if (
    !surface
    || artifactSurfaceKind(surface) !== 'scene'
    || !activeStore
    || sourceSelect.value !== 'CELL_LIVE'
  ) {
    if (requestId === latestExcalidrawMountRequest) destroyExcalidrawRuntime()
    return
  }

  const artifactView = hostEl.querySelector('mn-artifact-view') as (HTMLElement & { updateComplete?: Promise<unknown> }) | null
  await artifactView?.updateComplete
  if (requestId !== latestExcalidrawMountRequest || currentArtifactSurface !== surface || store !== activeStore) return
  const canvas = artifactView?.shadowRoot?.querySelector('mn-excalidraw-canvas') as MnExcalidrawCanvas | null
  if (!canvas) return

  const key = `${surface.graphId}/${surface.artifactId}`
  const workspaceNodes = excalidrawWorkspaceNodes()
  canvas.predicateOptions = EXCALIDRAW_PREDICATE_OPTIONS
  canvas.linkCandidates = excalidrawLinkCandidates(workspaceNodes, surface.graphId)
  if (
    currentExcalidrawRuntime
    && !currentExcalidrawRuntime.destroyed
    && currentExcalidrawKey === key
    && currentExcalidrawHost === canvas
  ) {
    return
  }

  destroyExcalidrawRuntime()
  if (requestId !== latestExcalidrawMountRequest || currentArtifactSurface !== surface) return
  currentExcalidrawKey = key
  currentExcalidrawHost = canvas
  currentExcalidrawRuntime = mountExcalidrawRuntime(canvas, makeOrganismExcalidrawOptions({
    contract: activeStore.contract,
    scope: { graphId: surface.graphId, artifactId: surface.artifactId },
    getWorkspaceNodes: excalidrawWorkspaceNodes,
    onOpenNode: openExcalidrawLinkedNode,
    onWorkspaceChanged: async () => { await refreshSidebarSections() },
    onArtifactSaved: async () => { await refreshSidebarSections() },
    onWiresChanged: refreshWireBundle,
  }))
  void currentExcalidrawRuntime.ready.catch((error) => {
    if (currentExcalidrawHost === canvas) {
      err(`Excalidraw scene failed:\n${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

type CurrentDocHistorySurface = {
  readonly graphId: string
  readonly documentId: string
  readonly status: DocHistoryStatus
  readonly error?: string | null
  readonly snapshots: readonly DocHistorySnapshot[]
  readonly totalCount: number | null
  readonly olderId: string
  readonly newerId: 'live' | string
  readonly focusedSide: 'older' | 'newer'
  readonly olderText: string
  readonly newerText: string
  readonly diffStatus: DocHistoryStatus
  readonly diffError?: string | null
  readonly diffStyle: DocHistoryDiffStyle
  readonly restoreBusy: boolean
}
let currentDocHistorySurface: CurrentDocHistorySurface | null = null
let latestDocHistoryRequest = 0
let latestDocHistoryDiffRequest = 0

function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && VALID_RIGHT_PANEL_IDS.has(value as PanelId)
}

function isLeftPanelMode(value: unknown): value is LeftPanelMode {
  return value === 'files' || value === 'graph' || value === 'outline'
}

function normalizeRightPanels(values: readonly unknown[]): PanelId[] {
  const seen = new Set<PanelId>()
  const next: PanelId[] = []
  for (const value of values) {
    if (!isPanelId(value) || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function readRightPanelFromUrl(): RightPanelMode {
  try {
    const raw = new URLSearchParams(window.location.search).get('r')
    if (raw === null || !raw.trim()) return DEFAULT_RIGHT_PANEL
    if (raw.trim().toLowerCase() === 'none') return 'none'
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const valid = normalizeRightPanels(parsed)
    return valid.length > 0 ? rightPanelModeFromPanels(valid) : DEFAULT_RIGHT_PANEL
  } catch {
    return DEFAULT_RIGHT_PANEL
  }
}

function writeRightPanelToUrl(panel: RightPanelMode): void {
  try {
    const params = new URLSearchParams(window.location.search)
    // Absence means the default Chat rail; collapse needs its own URL value so
    // reload/back cannot silently reopen it.
    params.set('r', panel === 'none' ? 'none' : panel)
    const next = params.toString()
    const nextUrl = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  } catch {
    // URL reflection is best-effort; the shell state remains authoritative.
  }
}

function describeRightPanel(): string {
  return currentRightPanel === 'none' ? '(collapsed)' : currentRightPanel
}

function updatePanelLayout(patch: Partial<OrganismPanelLayoutState>): void {
  currentPanelLayout = { ...currentPanelLayout, ...patch }
  writePanelLayoutState(panelLayoutStorage, currentPanelLayout)
}

function handlePanelReposition(detail: WorkspacePanelRepositionDetail): void {
  if (detail.role === 'left') {
    // Expanded mode is the discrete 70% view; dragging through it must not
    // replace the remembered normal pixel width restored on exit.
    if (!currentPanelLayout.leftExpanded) updatePanelLayout({ leftPanelWidth: detail.width })
    return
  }
  updatePanelLayout({ rightPanelWidth: detail.width })
}

function handleLeftExpandedChange(expanded: boolean): void {
  if (expanded === currentPanelLayout.leftExpanded) return
  if (expanded) {
    preExpandRightPanel = currentRightPanel === 'none' ? DEFAULT_RIGHT_PANEL : currentRightPanel
    currentRightPanel = 'none'
  } else {
    currentRightPanel = preExpandRightPanel
  }
  writeRightPanelToUrl(currentRightPanel)
  updatePanelLayout({
    leftCollapsed: false,
    leftExpanded: expanded,
    rightCollapsed: expanded ? true : currentRightPanel === 'none',
  })
  rerenderCurrentSource()
}

function handleLeftCollapsedChange(collapsed: boolean): void {
  if (collapsed === currentPanelLayout.leftCollapsed) return
  if (collapsed && currentPanelLayout.leftExpanded) {
    currentRightPanel = preExpandRightPanel
    writeRightPanelToUrl(currentRightPanel)
  }
  updatePanelLayout({
    leftCollapsed: collapsed,
    leftExpanded: collapsed ? false : currentPanelLayout.leftExpanded,
    rightCollapsed: currentRightPanel === 'none',
  })
  rerenderCurrentSource()
}

function handleRightCollapsedChange(collapsed: boolean): void {
  if (collapsed === (currentRightPanel === 'none')) return
  if (collapsed) {
    currentRightPanel = 'none'
  } else {
    // Match the legacy right-edge rail: reopening the collapsed right pane
    // always returns to Sophia, while left expansion separately restores its
    // remembered pre-expansion mode.
    currentRightPanel = DEFAULT_RIGHT_PANEL
  }
  writeRightPanelToUrl(currentRightPanel)
  updatePanelLayout({
    leftExpanded: collapsed ? currentPanelLayout.leftExpanded : false,
    rightCollapsed: collapsed,
  })
  rerenderCurrentSource()
}

function transitionRightPanel(panel: RightPanelMode, reflectUrl = true): void {
  currentRightPanel = panel
  if (panel !== 'none') {
    preExpandRightPanel = panel
  }
  if (reflectUrl) writeRightPanelToUrl(currentRightPanel)
  updatePanelLayout({
    leftExpanded: currentRightPanel !== 'none' ? false : currentPanelLayout.leftExpanded,
    rightCollapsed: currentRightPanel === 'none',
  })
}

function setRightPanel(panel: RightPanelMode, origin: string): void {
  // The graph is one persistent Class-C surface. Moving it into the right rail
  // first returns the left rail to Files so we never stamp two graph anchors or
  // destroy/recreate the WebGL owner.
  if (panel === 'graph' && currentLeftPanelMode === 'graph') {
    currentLeftPanelMode = 'files'
  }
  transitionRightPanel(panel)
  rerenderCurrentSource()
  ok(`${origin} → rightPanel=${describeRightPanel()}`)
}

function currentDocumentComments(): readonly WorkspaceComment[] {
  return currentCommentsSource?.get() ?? []
}

function currentInspectorInput(): InspectorProjectionInput {
  const selection = currentInspectorSelection ?? activeDocumentSelection(currentGraphId, openDocId)
  return {
    selection,
    graphId: currentGraphId,
    graphTitle: currentGraphId,
    activeDocumentId: openDocId,
    activeDocumentTitle: openDocId,
    wireBundle: currentWireBundle,
    comments: currentDocumentComments(),
  }
}

function currentDocumentGraphProjection(): {
  readonly nodes: readonly GraphPanelNode[]
  readonly edges: readonly GraphPanelEdge[]
} {
  if (!openDocId || sourceSelect.value !== 'CELL_LIVE') return { nodes: [], edges: [] }
  const live = currentLiveEditor()
  if (!live) return { nodes: [], edges: [] }
  return projectDocumentGraph({
    graphId: currentGraphId,
    documentId: openDocId,
    documentTitle: openDocId,
    blocks: live.getOrderedBlockElements(),
    wires: currentWireBundle,
  })
}

function currentGraphPanelOptions(): RenderWorkspaceOptions['graphPanel'] {
  const live = sourceSelect.value === 'CELL_LIVE'
  const rootNodeId = `graph:${currentGraphId}`
  const nodes = new Map<string, GraphPanelNode>()
  const edges: GraphPanelEdge[] = []
  const seenEdges = new Set<string>()

  if (!live) {
    return {
      title: 'Workspace Graph',
      subtitle: 'Open a live cell source to inspect the workspace graph',
      status: 'ready',
      nodes: [],
      edges: [],
      documentNodes: [],
      documentEdges: [],
      viewMode: 'workspace',
      onRefresh: handleGraphPanelRefresh,
      onSelectNode: handleGraphPanelNodeSelect,
      onOpenNode: handleGraphPanelNodeOpen,
      onSelectEdge: handleGraphPanelEdgeSelect,
      onViewModeChange: handleGraphPanelViewModeChange,
    }
  }

  upsertGraphPanelNode(nodes, {
    id: rootNodeId,
    label: currentGraphId,
    note: 'Active graph',
    kind: 'graph',
    graphId: currentGraphId,
  })

  for (const section of currentSidebarSections) {
    for (const node of section.nodes ?? []) {
      projectSidebarNodeToGraphPanel(section, node, rootNodeId, nodes, edges, seenEdges, currentGraphId)
    }
  }

  if (openDocId) {
    const localDocumentNodeId = addGraphPanelDocumentNode(
      nodes,
      edges,
      seenEdges,
      rootNodeId,
      currentGraphId,
      openDocId,
      currentGraphId,
      openDocId,
      'Open document',
    )
    for (const wire of currentWireBundle?.outgoingWires ?? []) {
      const otherNodeId = addGraphPanelDocumentNode(
        nodes,
        edges,
        seenEdges,
        rootNodeId,
        wire.otherGraphId || currentGraphId,
        wire.otherDocumentId,
        currentGraphId,
        wire.otherTitle,
        wire.otherSnippet ?? null,
      )
      addGraphPanelEdge(edges, seenEdges, {
        id: `wire:outgoing:${wire.id}`,
        from: localDocumentNodeId,
        to: otherNodeId,
        predicate: wire.predicate,
        predicateLabel: wire.predicateLabel || getWirePredicateLabel(wire.predicate),
        kind: 'wire',
        note: wire.localSnippet ?? wire.otherSnippet ?? undefined,
        bidirectional: wire.bidirectional,
      })
    }
    for (const wire of currentWireBundle?.incomingWires ?? []) {
      const otherNodeId = addGraphPanelDocumentNode(
        nodes,
        edges,
        seenEdges,
        rootNodeId,
        wire.otherGraphId || currentGraphId,
        wire.otherDocumentId,
        currentGraphId,
        wire.otherTitle,
        wire.otherSnippet ?? null,
      )
      addGraphPanelEdge(edges, seenEdges, {
        id: `wire:incoming:${wire.id}`,
        from: otherNodeId,
        to: localDocumentNodeId,
        predicate: wire.predicate,
        predicateLabel: wire.predicateLabel || getWirePredicateLabel(wire.predicate),
        kind: 'wire',
        note: wire.otherSnippet ?? wire.localSnippet ?? undefined,
        bidirectional: wire.bidirectional,
      })
    }
  }

  const documentProjection = currentDocumentGraphProjection()
  return {
    title: 'Knowledge Space',
    subtitle: openDocId ? `${currentGraphId} / ${openDocId}` : currentGraphId,
    status: 'ready',
    nodes: [...nodes.values()],
    edges,
    documentNodes: documentProjection.nodes,
    documentEdges: documentProjection.edges,
    viewMode: currentGraphPanelViewMode,
    selectedNodeId: currentGraphPanelViewMode === 'document'
      ? currentLiveEditor()?.getActiveBlockId() ?? null
      : null,
    canNavigateBack: graphNodeHistoryIndex > 0,
    canNavigateForward: graphNodeHistoryIndex < graphNodeHistory.length - 1,
    onRefresh: handleGraphPanelRefresh,
    onSelectNode: handleGraphPanelNodeSelect,
    onOpenNode: handleGraphPanelNodeOpen,
    onSelectEdge: handleGraphPanelEdgeSelect,
    onViewModeChange: handleGraphPanelViewModeChange,
    onNavigateBack: handleGraphPanelNavigateBack,
    onNavigateForward: handleGraphPanelNavigateForward,
  }
}

function handleGraphPanelRefresh(_detail: GraphPanelRefreshDetail): void {
  if (sourceSelect.value !== 'CELL_LIVE') return
  ok('refreshing workspace graph projection...')
  void refreshSidebarSections()
  if (openDocId) void refreshWireBundle()
}

function focusGraphBlock(blockId: string): void {
  document.dispatchEvent(new CustomEvent(WIRE_HIGHLIGHT_BLOCK_EVENT, {
    detail: { blockId },
  }))
  currentLiveEditor()?.focusBlock(blockId)
}

function pushGraphNodeHistory(blockId: string): void {
  // The pure transform owns the browser-history semantics (dedupe the current
  // tip, drop forward entries on divergence); the shell just applies the result
  // to its two mutable cells.
  const next = pushNodeHistory(graphNodeHistory, graphNodeHistoryIndex, blockId)
  graphNodeHistory = [...next.history]
  graphNodeHistoryIndex = next.index
}

function handleGraphPanelNodeSelect(detail: GraphPanelNodeSelectDetail): void {
  const blockId = detail.node.blockId
  if (!blockId || detail.node.kind === 'portal') return
  pushGraphNodeHistory(blockId)
  // The block focus (graph→editor reveals) is now installed by the
  // edge-interpreter: pushing the detail fires graphNodeToSelected →
  // editor.reveal → focusGraphBlock(blockId). The history push and the rerender
  // stay here — reveals never touches the bus, so nothing else rerenders.
  graphSelectEmitter.emit(detail)
  rerenderCurrentSource()
}

function handleGraphPanelNavigateBack(): void {
  if (graphNodeHistoryIndex <= 0) return
  graphNodeHistoryIndex -= 1
  focusGraphBlock(graphNodeHistory[graphNodeHistoryIndex]!)
  rerenderCurrentSource()
}

function handleGraphPanelNavigateForward(): void {
  if (graphNodeHistoryIndex >= graphNodeHistory.length - 1) return
  graphNodeHistoryIndex += 1
  focusGraphBlock(graphNodeHistory[graphNodeHistoryIndex]!)
  rerenderCurrentSource()
}

function handleGraphPanelEdgeSelect(detail: GraphPanelEdgeSelectDetail): void {
  const options = currentGraphPanelOptions()
  const nodes = [...(options?.nodes ?? []), ...(options?.documentNodes ?? [])]
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  const from = byId.get(detail.edge.from)
  const to = byId.get(detail.edge.to)
  const external = [to, from].find((node) => node && (
    node.kind === 'portal' ||
    (!!node.documentId && (node.graphId !== currentGraphId || node.documentId !== openDocId))
  ))
  if (external) {
    handleGraphPanelNodeOpen({ id: external.id, node: external })
    return
  }
  const block = [to, from].find((node) => node?.blockId)
  if (block) handleGraphPanelNodeSelect({ id: block.id, node: block })
}

function handleGraphPanelViewModeChange(detail: GraphPanelViewModeChangeDetail): void {
  if (detail.mode === currentGraphPanelViewMode) return
  currentGraphPanelViewMode = detail.mode
  panelLayoutStorage?.setItem(GRAPH_PANEL_VIEW_MODE_KEY, detail.mode)
  rerenderCurrentSource()
}

function handleGraphPanelNodeOpen(detail: GraphPanelNodeOpenDetail): void {
  const node = detail.node
  if (node.blockId && node.kind !== 'portal') {
    handleGraphPanelNodeSelect({ id: node.id, node })
    return
  }
  if ((node.kind === 'document' || node.kind === 'read-only-document' || node.kind === 'portal') && node.documentId) {
    // graph →navigatesTo→ editor is now installed by the edge-interpreter: the
    // open detail flows through graphOpenEmitter → face:graph.toResource → the
    // identical `openDocumentFromShell({graphId: node.graphId ?? currentGraphId,
    // documentId: node.documentId})` (byte-identical to the old direct call).
    graphOpenEmitter.emit(detail)
    return
  }
  if (node.kind === 'artifact' && node.artifactId) {
    openArtifactFromSidebar(node.artifactId, {
      id: node.artifactId,
      label: node.label ?? node.artifactId,
      kind: 'artifact',
      parentId: node.parentId ?? null,
      section: 'artifacts',
      mimeType: node.mimeType ?? null,
      fileType: node.fileType ?? null,
      status: node.status ?? null,
      ingestedDocumentId: node.ingestedDocumentId ?? null,
    })
    return
  }
  if (node.kind === 'tag' && node.tagName) {
    handleTagIntent(node.tagName, 'graph panel')
    return
  }
  if (node.kind === 'folder' && node.folderId) {
    setSidebarFolderExpanded(node.folderId, !currentSidebarExpandedFolders.has(node.folderId))
    currentSidebarSelectedId = node.folderId
    currentInspectorSelection = {
      kind: 'folder',
      graphId: node.graphId ?? currentGraphId,
      folderId: node.folderId,
      label: node.label ?? node.folderId,
      parentId: node.parentId ?? null,
      section: node.section === 'artifacts' ? 'artifacts' : 'documents',
    }
    rerenderCurrentSource()
    return
  }
  if (node.kind === 'graph') {
    currentSidebarSelectedId = null
    currentInspectorSelection = {
      kind: 'graph',
      graphId: node.graphId ?? currentGraphId,
      label: node.label ?? node.graphId ?? currentGraphId,
    }
    rerenderCurrentSource()
  }
}

function localCommentAuthor(): Pick<DocumentCommentData, 'author' | 'authorId'> {
  return {
    author: 'You',
    authorId: 'local',
  }
}

function ensureCommentsPanelVisible(): void {
  if (currentRightPanel === 'comments') return
  transitionRightPanel('comments')
}

function installCommentsSource(provider: ProviderHandle): void {
  teardownCommentsSource()
  currentCommentsSource = createDocumentCommentsSource(provider.doc)
  stopCommentsSubscription = currentCommentsSource.subscribe((comments) => {
    if (currentHoveredCommentId && !comments.some((comment) => comment.id === currentHoveredCommentId)) {
      currentHoveredCommentId = null
      currentLiveEditor()?.setActiveComment(null)
    }
    rerenderCurrentSource()
  })
}

function teardownCommentsSource(): void {
  stopCommentsSubscription?.()
  stopCommentsSubscription = null
  currentCommentsSource?.destroy()
  currentCommentsSource = null
  currentHoveredCommentId = null
}

function handleEditorCommentInserted(detail: EditorCommentInsertedDetail | undefined): void {
  const commentId = detail?.commentId?.trim()
  if (!detail || !commentId) return
  const source = currentCommentsSource
  if (!source) return
  const now = Date.now()
  const existing = source.commentsMap().get(commentId)
  const author = localCommentAuthor()
  const next: DocumentCommentData = existing
    ? {
        ...existing,
        quotedText: detail.selectedText || existing.quotedText,
        documentPosition: detail.from,
        updatedAt: now,
      }
    : {
        ...author,
        text: '',
        quotedText: detail.selectedText,
        createdAt: now,
        updatedAt: now,
        resolved: false,
        documentPosition: detail.from,
      }
  currentHoveredCommentId = commentId
  currentInspectorSelection = openDocId
    ? {
        kind: 'comment',
        graphId: currentGraphId,
        documentId: openDocId,
        commentId,
      }
    : currentInspectorSelection
  currentLiveEditor()?.setActiveComment(commentId, { scroll: false })
  ensureCommentsPanelVisible()
  source.set(commentId, next)
  ok(`comment added → rightPanel=${describeRightPanel()}`)
}

function handleCommentSelect(detail: WorkspaceCommentDetail): void {
  currentHoveredCommentId = detail.id
  // The inspector stamp (comments→inspector drivesSelection) AND the editor
  // scroll (comments→editor reveals) are now installed by the edge-interpreter:
  // pushing the detail fires commentToSelected → bus publish → inspector.reflect
  // (writes currentInspectorSelection + rerenders) and → editor.reveal
  // (setActiveComment(id,{scroll:true})). Net effect is identical for every
  // REACHABLE state — a comment can only be picked with an open document, and
  // in that state the old inline stamp and this bus round-trip produce the same
  // inspector selection + editor scroll. (The one divergent branch — no open
  // document, where the old code left currentInspectorSelection untouched and the
  // bus would publish null — is unreachable: there is no comment to select.)
  commentSelectEmitter.emit(detail)
}

function handleCommentHover(detail: WorkspaceCommentHoverDetail): void {
  const nextId = detail.id
  if (currentHoveredCommentId === nextId) return
  currentHoveredCommentId = nextId
  currentLiveEditor()?.setActiveComment(nextId, { scroll: false })
  rerenderCurrentSource()
}

function handleCommentEdit(detail: WorkspaceCommentEditDetail): void {
  currentCommentsSource?.update(detail.id, { text: detail.text, updatedAt: Date.now() })
}

function handleCommentResolve(detail: WorkspaceCommentResolveDetail): void {
  currentCommentsSource?.update(detail.id, { resolved: detail.resolved, updatedAt: Date.now() })
}

function handleCommentDelete(detail: WorkspaceCommentDetail): void {
  currentLiveEditor()?.removeComment(detail.id)
  if (currentHoveredCommentId === detail.id) currentHoveredCommentId = null
  if (currentInspectorSelection?.kind === 'comment' && currentInspectorSelection.commentId === detail.id) {
    currentInspectorSelection = activeDocumentSelection(currentGraphId, openDocId)
  }
  currentCommentsSource?.delete(detail.id)
}

function handleInspectorRelationOpen(detail: WorkspaceInspectorRelationOpenDetail): void {
  if (detail.groupKey === 'comments') {
    const comment = currentDocumentComments().find((item) => item.id === detail.id)
    if (!comment || !openDocId) return
    currentHoveredCommentId = detail.id
    currentInspectorSelection = {
      kind: 'comment',
      graphId: currentGraphId,
      documentId: openDocId,
      commentId: detail.id,
      ...(comment.blockId ? { blockId: comment.blockId } : {}),
    }
    currentLiveEditor()?.setActiveComment(detail.id, { scroll: true })
    rerenderCurrentSource()
    return
  }
  if (detail.groupKey === 'wires' || detail.groupKey === 'backlinks') {
    currentInspectorSelection = {
      kind: 'wire',
      graphId: currentGraphId,
      wireId: detail.id,
    }
    rerenderCurrentSource()
  }
}

function handleInspectorAction(detail: WorkspaceInspectorActionDetail): void {
  const selection = currentInspectorSelection
  if (!selection || selection.kind !== 'comment') return
  const comment = currentDocumentComments().find((item) => item.id === selection.commentId)
  if (!comment) return
  if (detail.id === 'comment.resolve') {
    handleCommentResolve({ id: comment.id, comment, resolved: !comment.resolved })
  } else if (detail.id === 'comment.delete') {
    handleCommentDelete({ id: comment.id, comment })
  }
}

function normalizeTagName(value: string): string | null {
  const name = value.trim().replace(/^#/, '').toLowerCase()
  return /^[a-z0-9_-]+$/.test(name) ? name : null
}

function releaseArtifactPreviewObjectUrl(): void {
  if (!currentArtifactPreviewObjectUrl) return
  URL.revokeObjectURL(currentArtifactPreviewObjectUrl)
  currentArtifactPreviewObjectUrl = null
}

function releaseArtifactHistoryObjectUrls(): void {
  for (const url of currentArtifactHistoryObjectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  currentArtifactHistoryObjectUrls = new Map()
}

function clearArtifactSurfaceState(): void {
  artifactImageGenerationAbort?.abort()
  artifactImageGenerationAbort = null
  teardownExcalidrawRuntime()
  currentArtifactSurface = null
  latestArtifactPreviewRequest++
  latestArtifactHistoryRequest++
  releaseArtifactPreviewObjectUrl()
  releaseArtifactHistoryObjectUrls()
}

function clearDocHistoryState(): void {
  currentDocHistorySurface = null
  latestDocHistoryRequest++
  latestDocHistoryDiffRequest++
}

function clearGraphNodeHistory(): void {
  // Entries are bare block IDs with no owning document/graph recorded, so a
  // stale entry from a different document silently no-ops on navigate —
  // scope the history to the document/graph it was built in instead.
  graphNodeHistory = []
  graphNodeHistoryIndex = -1
}

function clearTagLensState(): void {
  currentTagLens = null
  latestTagLensRequest++
}

function clearZoteroSourceState(): void {
  currentZoteroSourceSurface = null
  latestZoteroSourceRequest++
}

function switchToTagLens(name: string): void {
  clearZoteroSourceState()
  clearArtifactSurfaceState()
  openDocId = null
  currentZoomBlockId = null
  currentBlockFocusRequest = null
  currentHoveredCommentId = null
  currentInspectorSelection = null
  currentWireBundle = null
  currentWireContexts = new Map()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  currentDailyNotePopover = null
  clearDocHistoryState()
  writeZoomBlockIdToUrl(null)
  teardownEditorClaim()
  currentSidebarSelectedId = `tag:${name}`
  currentTagLens = {
    tagName: name,
    status: 'loading',
    blocks: [],
  }
}

function artifactSurfaceKind(surface: CurrentArtifactSurface): ReturnType<typeof artifactKindFromMime> {
  return artifactKindFromMime(surface.mimeType, surface.fileType)
}

function refreshArtifactPreview(detail?: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurface
  if (!surface) return
  if (detail && (detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId)) return

  const requestId = ++latestArtifactPreviewRequest
  releaseArtifactPreviewObjectUrl()

  if (artifactSurfaceKind(surface) !== 'image') {
    currentArtifactSurface = { ...surface, status: 'ready', previewUrl: null, error: undefined }
    rerenderCurrentSource()
    return
  }

  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    currentArtifactSurface = {
      ...surface,
      status: 'error',
      previewUrl: null,
      error: 'Open a live cell source to load artifact previews.',
    }
    rerenderCurrentSource()
    return
  }

  const activeStore = store
  currentArtifactSurface = { ...surface, status: 'loading', previewUrl: null, error: undefined }
  rerenderCurrentSource()

  void fetchArtifactBlob(activeStore.contract, surface.graphId, surface.artifactId)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      if (
        requestId !== latestArtifactPreviewRequest ||
        store !== activeStore ||
        currentArtifactSurface?.graphId !== surface.graphId ||
        currentArtifactSurface?.artifactId !== surface.artifactId
      ) {
        URL.revokeObjectURL(url)
        return
      }
      const latest = currentArtifactSurface
      if (!latest) {
        URL.revokeObjectURL(url)
        return
      }
      releaseArtifactPreviewObjectUrl()
      currentArtifactPreviewObjectUrl = url
      currentArtifactSurface = {
        ...latest,
        status: 'ready',
        previewUrl: url,
        error: undefined,
      }
      rerenderCurrentSource()
    })
    .catch((e) => {
      if (
        requestId !== latestArtifactPreviewRequest ||
        store !== activeStore ||
        currentArtifactSurface?.graphId !== surface.graphId ||
        currentArtifactSurface?.artifactId !== surface.artifactId
      ) {
        return
      }
      const latest = currentArtifactSurface
      if (!latest) return
      currentArtifactSurface = {
        ...latest,
        status: 'error',
        previewUrl: null,
        error: e instanceof Error ? e.message : String(e),
      }
      rerenderCurrentSource()
    })
}

function handleArtifactDownload(detail: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurface
  if (!surface || detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId) return
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    err('open a CELL_LIVE source first (no cell store).')
    return
  }
  const activeStore = store
  void fetchArtifactBlob(activeStore.contract, detail.graphId, detail.artifactId)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = surface.title || surface.artifactId || 'artifact'
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      ok(`downloaded artifact "${surface.title || surface.artifactId}"`)
    })
    .catch((e) => {
      err(`artifact download error:\n${e instanceof Error ? e.message : String(e)}`)
    })
}

function handleArtifactOpenDocument(detail: ArtifactViewOpenDocumentDetail): void {
  if (!detail.documentId) return
  void openCellDocument(detail.documentId)
}

function currentArtifactSurfaceForIntent(detail: ArtifactViewIntentDetail): CurrentArtifactSurface | null {
  const surface = currentArtifactSurface
  if (!surface || detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId) return null
  return surface
}

function handleArtifactEditOpen(detail: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurfaceForIntent(detail)
  if (!surface) return
  if (artifactSurfaceKind(surface) !== 'image' || surface.status !== 'ready' || !surface.previewUrl) {
    err(`artifact "${surface.title || surface.artifactId}" is not ready for image editing.`)
    return
  }
  currentArtifactSurface = {
    ...surface,
    editorOpen: true,
    editorGenerating: false,
    editorGenerationError: null,
    historyOpen: false,
  }
  rerenderCurrentSource()
}

function handleArtifactEditorCancel(detail: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurfaceForIntent(detail)
  if (!surface) return
  currentArtifactSurface = {
    ...surface,
    editorOpen: false,
    editorGenerating: false,
    editorGenerationError: null,
  }
  rerenderCurrentSource()
}

async function handleArtifactEditorSave(detail: ArtifactEditorSaveDetail): Promise<void> {
  const surface = currentArtifactSurfaceForIntent(detail)
  if (!surface || surface.editorGenerating) return
  const activeStore = liveSidebarMutationStore('save artifact revision')
  if (!activeStore) return

  currentArtifactSurface = {
    ...surface,
    editorGenerating: true,
    editorGenerationError: null,
  }
  rerenderCurrentSource()

  try {
    await postArtifactRevision(activeStore.contract, detail.graphId, detail.artifactId, detail.dataUrl, detail.mimeType, 'Edited')
    if (
      store !== activeStore ||
      currentArtifactSurface?.graphId !== detail.graphId ||
      currentArtifactSurface?.artifactId !== detail.artifactId
    ) {
      return
    }
    const latest = currentArtifactSurface
    if (latest) {
      currentArtifactSurface = {
        ...latest,
        editorOpen: false,
        editorGenerating: false,
        editorGenerationError: null,
      }
      rerenderCurrentSource()
    }
    ok(`saved edited revision for artifact "${surface.title || surface.artifactId}"`)
    refreshArtifactPreview(detail)
  } catch (e) {
    if (
      store !== activeStore ||
      currentArtifactSurface?.graphId !== detail.graphId ||
      currentArtifactSurface?.artifactId !== detail.artifactId
    ) {
      return
    }
    const message = e instanceof Error ? e.message : String(e)
    const latest = currentArtifactSurface
    if (latest) {
      currentArtifactSurface = {
        ...latest,
        editorGenerating: false,
        editorGenerationError: `Save failed: ${message}`,
      }
      rerenderCurrentSource()
    }
    err(`artifact revision save error:\n${message}`)
  }
}

async function handleArtifactEditorGenerate(detail: ArtifactEditorGenerateDetail): Promise<void> {
  const surface = currentArtifactSurfaceForIntent(detail)
  if (!surface || surface.editorGenerating) return
  const activeStore = liveSidebarMutationStore('generate artifact image')
  if (!activeStore) return
  artifactImageGenerationAbort?.abort()
  const abort = new AbortController()
  artifactImageGenerationAbort = abort
  const generatedParentId = currentInspectorSelection?.kind === 'artifact'
    && typeof currentInspectorSelection.parentId === 'string'
    ? currentInspectorSelection.parentId
    : null
  currentArtifactSurface = {
    ...surface,
    editorPrompt: detail.prompt,
    editorGenerationTarget: detail.target,
    editorGenerating: true,
    editorGenerationError: null,
  }
  rerenderCurrentSource()

  try {
    const result = await generateArtifactImage(activeStore.contract, artifactImageGenerator, {
      graphId: detail.graphId,
      artifactId: detail.artifactId,
      sourceDataUrl: detail.dataUrl,
      prompt: detail.prompt,
      target: detail.target,
      title: detail.target === 'artifact' ? `Generated from ${surface.title || surface.artifactId}` : undefined,
      parentId: generatedParentId,
      signal: abort.signal,
    })
    if (abort.signal.aborted || store !== activeStore) return
    await refreshSidebarSections()

    if (result.target === 'artifact') {
      openArtifactFromSidebar(result.artifactId, {
        id: result.artifactId,
        label: `Generated from ${surface.title || surface.artifactId}`,
        kind: 'artifact',
        section: 'artifacts',
        parentId: generatedParentId,
        mimeType: result.mimeType,
        fileType: result.mimeType === 'image/jpeg' ? 'jpg' : 'png',
        status: 'ready',
      })
      ok(`created generated image artifact "${result.artifactId}"`)
      return
    }

    if (
      currentArtifactSurface?.graphId !== detail.graphId
      || currentArtifactSurface?.artifactId !== detail.artifactId
    ) {
      return
    }
    currentArtifactSurface = {
      ...currentArtifactSurface,
      editorOpen: false,
      editorGenerating: false,
      editorGenerationError: null,
    }
    rerenderCurrentSource()
    refreshArtifactPreview(detail)
    ok(`saved generated revision for artifact "${surface.title || surface.artifactId}"`)
  } catch (error) {
    if (abort.signal.aborted) return
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (
      store === activeStore
      && currentArtifactSurface?.graphId === detail.graphId
      && currentArtifactSurface?.artifactId === detail.artifactId
    ) {
      currentArtifactSurface = {
        ...currentArtifactSurface,
        editorGenerating: false,
        editorGenerationError: errorMessage,
      }
      rerenderCurrentSource()
    }
    err(`artifact image generation error:\n${errorMessage}`)
  } finally {
    if (artifactImageGenerationAbort === abort) artifactImageGenerationAbort = null
  }
}

function artifactRevisionTimestamp(revision: ArtifactHistoryRevision): number {
  if (revision.createdAt instanceof Date) return revision.createdAt.getTime()
  if (typeof revision.createdAt === 'number') return revision.createdAt
  const parsed = Date.parse(revision.createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function artifactRevisionSupportsThumbnail(surface: CurrentArtifactSurface, revision: ArtifactHistoryRevision): boolean {
  return artifactKindFromMime(revision.mimeType ?? surface.mimeType, surface.fileType) === 'image'
}

function loadArtifactHistoryThumbnail(
  activeStore: OrganismSessionStore,
  requestId: number,
  graphId: string,
  artifactId: string,
  revision: ArtifactHistoryRevision,
): void {
  void fetchArtifactRevisionBlob(activeStore.contract, graphId, artifactId, revision.revisionId)
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      if (
        requestId !== latestArtifactHistoryRequest ||
        store !== activeStore ||
        currentArtifactSurface?.graphId !== graphId ||
        currentArtifactSurface?.artifactId !== artifactId
      ) {
        URL.revokeObjectURL(url)
        return
      }
      const latest = currentArtifactSurface
      if (!latest) {
        URL.revokeObjectURL(url)
        return
      }
      const previousUrl = currentArtifactHistoryObjectUrls.get(revision.revisionId)
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      currentArtifactHistoryObjectUrls.set(revision.revisionId, url)
      currentArtifactSurface = {
        ...latest,
        historyRevisions: latest.historyRevisions.map((item) =>
          item.revisionId === revision.revisionId ? { ...item, thumbnailUrl: url } : item,
        ),
      }
      rerenderCurrentSource()
    })
    .catch(() => {
      // Thumbnail enrichment is optional; the revision row still renders without it.
    })
}

function refreshArtifactHistory(detail?: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurface
  if (!surface) return
  if (detail && (detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId)) return

  const requestId = ++latestArtifactHistoryRequest
  releaseArtifactHistoryObjectUrls()

  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    currentArtifactSurface = {
      ...surface,
      historyOpen: true,
      historyStatus: 'error',
      historyError: 'Open a live cell source to load artifact history.',
      historyRevisions: [],
      historyRestoringRevisionId: null,
    }
    rerenderCurrentSource()
    return
  }

  const activeStore = store
  currentArtifactSurface = {
    ...surface,
    historyOpen: true,
    historyStatus: 'loading',
    historyError: null,
    historyRevisions: [],
    historyRestoringRevisionId: null,
  }
  rerenderCurrentSource()

  void fetchArtifactRevisionList(activeStore.contract, surface.graphId, surface.artifactId)
    .then((list) => {
      if (
        requestId !== latestArtifactHistoryRequest ||
        store !== activeStore ||
        currentArtifactSurface?.graphId !== surface.graphId ||
        currentArtifactSurface?.artifactId !== surface.artifactId
      ) {
        return
      }
      const latest = currentArtifactSurface
      if (!latest) return
      const revisions = (list.revisions ?? [])
        .map(normalizeArtifactRevision)
        .filter((revision): revision is ArtifactHistoryRevision => revision !== null)
        .sort((a, b) => artifactRevisionTimestamp(b) - artifactRevisionTimestamp(a))
      currentArtifactSurface = {
        ...latest,
        historyStatus: 'ready',
        historyError: null,
        historyRevisions: revisions,
        historyRestoringRevisionId: null,
      }
      rerenderCurrentSource()
      for (const revision of revisions.slice(0, 20)) {
        if (artifactRevisionSupportsThumbnail(latest, revision)) {
          loadArtifactHistoryThumbnail(activeStore, requestId, surface.graphId, surface.artifactId, revision)
        }
      }
    })
    .catch((e) => {
      if (
        requestId !== latestArtifactHistoryRequest ||
        store !== activeStore ||
        currentArtifactSurface?.graphId !== surface.graphId ||
        currentArtifactSurface?.artifactId !== surface.artifactId
      ) {
        return
      }
      const latest = currentArtifactSurface
      if (!latest) return
      currentArtifactSurface = {
        ...latest,
        historyStatus: 'error',
        historyError: e instanceof Error ? e.message : String(e),
        historyRevisions: [],
        historyRestoringRevisionId: null,
      }
      rerenderCurrentSource()
    })
}

function handleArtifactHistoryOpen(detail: ArtifactViewIntentDetail): void {
  refreshArtifactHistory(detail)
}

function handleArtifactHistoryRefresh(detail: ArtifactViewIntentDetail): void {
  refreshArtifactHistory(detail)
}

function handleArtifactHistoryClose(detail: ArtifactViewIntentDetail): void {
  const surface = currentArtifactSurface
  if (!surface || detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId) return
  currentArtifactSurface = {
    ...surface,
    historyOpen: false,
    historyRestoringRevisionId: null,
  }
  rerenderCurrentSource()
}

async function handleArtifactHistoryRestore(detail: ArtifactHistoryRevisionDetail): Promise<void> {
  const surface = currentArtifactSurface
  if (!surface || detail.graphId !== surface.graphId || detail.artifactId !== surface.artifactId) return
  const revision = surface.historyRevisions.find((item) => item.revisionId === detail.revisionId)
  const label = revision?.label || revision?.filename || detail.revisionId
  const confirmed = await confirmAction({
    title: 'Restore artifact revision?',
    message: `Restore "${surface.title || surface.artifactId}" to ${label}? This replaces the current artifact bytes.`,
    confirmText: 'Restore',
    variant: 'danger',
  })
  if (!confirmed) return

  const latest = currentArtifactSurface
  if (!latest || latest.graphId !== detail.graphId || latest.artifactId !== detail.artifactId) return
  const activeStore = liveSidebarMutationStore('restore artifact revision')
  if (!activeStore) return
  currentArtifactSurface = {
    ...latest,
    historyOpen: true,
    historyError: null,
    historyRestoringRevisionId: detail.revisionId,
  }
  rerenderCurrentSource()

  try {
    await restoreArtifactRevision(activeStore.contract, detail.graphId, detail.artifactId, detail.revisionId)
    if (
      store !== activeStore ||
      currentArtifactSurface?.graphId !== detail.graphId ||
      currentArtifactSurface?.artifactId !== detail.artifactId
    ) {
      return
    }
    const after = currentArtifactSurface
    if (after) currentArtifactSurface = { ...after, historyRestoringRevisionId: null }
    ok(`restored artifact "${surface.title || surface.artifactId}" to ${label}`)
    refreshArtifactPreview(detail)
    refreshArtifactHistory(detail)
  } catch (e) {
    if (
      store !== activeStore ||
      currentArtifactSurface?.graphId !== detail.graphId ||
      currentArtifactSurface?.artifactId !== detail.artifactId
    ) {
      return
    }
    const after = currentArtifactSurface
    if (after) {
      currentArtifactSurface = {
        ...after,
        historyOpen: true,
        historyStatus: 'error',
        historyError: e instanceof Error ? e.message : String(e),
        historyRestoringRevisionId: null,
      }
      rerenderCurrentSource()
    }
    err(`artifact restore error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function liveDocumentTextForHistory(graphId: string, documentId: string): string {
  if (graphId !== currentGraphId || documentId !== openDocId) return ''
  return currentLiveEditor()?.getText() ?? ''
}

async function readDocHistoryText(surface: CurrentDocHistorySurface, id: 'live' | string): Promise<string> {
  if (id === 'live') return liveDocumentTextForHistory(surface.graphId, surface.documentId)
  if (!store || sourceSelect.value !== 'CELL_LIVE') throw new Error('Open a live cell source to read snapshots.')
  return fetchDocumentSnapshotText(store.contract, surface.graphId, surface.documentId, id, 'text')
}

function refreshDocHistoryDiff(): void {
  const surface = currentDocHistorySurface
  if (!surface) return
  if (!surface.olderId) {
    currentDocHistorySurface = {
      ...surface,
      olderText: '',
      newerText: liveDocumentTextForHistory(surface.graphId, surface.documentId),
      diffStatus: 'idle',
      diffError: null,
    }
    rerenderCurrentSource()
    return
  }

  const requestId = ++latestDocHistoryDiffRequest
  currentDocHistorySurface = { ...surface, diffStatus: 'loading', diffError: null }
  rerenderCurrentSource()

  void Promise.all([
    readDocHistoryText(surface, surface.olderId),
    readDocHistoryText(surface, surface.newerId),
  ])
    .then(([olderText, newerText]) => {
      const latest = currentDocHistorySurface
      if (
        requestId !== latestDocHistoryDiffRequest ||
        !latest ||
        latest.graphId !== surface.graphId ||
        latest.documentId !== surface.documentId ||
        latest.olderId !== surface.olderId ||
        latest.newerId !== surface.newerId
      ) return
      currentDocHistorySurface = {
        ...latest,
        olderText,
        newerText,
        diffStatus: 'ready',
        diffError: null,
      }
      rerenderCurrentSource()
    })
    .catch((e) => {
      const latest = currentDocHistorySurface
      if (
        requestId !== latestDocHistoryDiffRequest ||
        !latest ||
        latest.graphId !== surface.graphId ||
        latest.documentId !== surface.documentId
      ) return
      currentDocHistorySurface = {
        ...latest,
        diffStatus: 'error',
        diffError: e instanceof Error ? e.message : String(e),
      }
      rerenderCurrentSource()
    })
}

function loadDocHistorySurface(graphId: string, documentId: string): void {
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    currentDocHistorySurface = {
      graphId,
      documentId,
      status: 'error',
      error: 'Open a live cell source to load document history.',
      snapshots: [],
      totalCount: null,
      olderId: '',
      newerId: 'live',
      focusedSide: 'older',
      olderText: '',
      newerText: liveDocumentTextForHistory(graphId, documentId),
      diffStatus: 'idle',
      diffError: null,
      diffStyle: 'split',
      restoreBusy: false,
    }
    rerenderCurrentSource()
    return
  }

  const activeStore = store
  const requestId = ++latestDocHistoryRequest
  currentDocHistorySurface = {
    graphId,
    documentId,
    status: 'loading',
    error: null,
    snapshots: [],
    totalCount: null,
    olderId: '',
    newerId: 'live',
    focusedSide: 'older',
    olderText: '',
    newerText: liveDocumentTextForHistory(graphId, documentId),
    diffStatus: 'idle',
    diffError: null,
    diffStyle: currentDocHistorySurface?.diffStyle ?? 'split',
    restoreBusy: false,
  }
  rerenderCurrentSource()

  void Promise.all([
    fetchDocumentSnapshotJson<HostedDocumentSnapshotListResponse>(activeStore.contract, graphId, documentId, '?limit=200'),
    fetchDocumentSnapshotJson<{ count?: number }>(activeStore.contract, graphId, documentId, '/count')
      .catch(() => ({ count: undefined })),
  ])
    .then(([list, count]) => {
      if (
        requestId !== latestDocHistoryRequest ||
        store !== activeStore ||
        sourceSelect.value !== 'CELL_LIVE'
      ) return
      const snapshots = (list.snapshots ?? [])
        .map((entry) => normalizeDocumentSnapshot(entry, graphId, documentId))
        .filter((snapshot): snapshot is DocHistorySnapshot => snapshot !== null)
      const olderId = snapshots[0]?.id ?? ''
      currentDocHistorySurface = {
        graphId,
        documentId,
        status: 'ready',
        error: null,
        snapshots,
        totalCount: typeof count.count === 'number' ? count.count : snapshots.length,
        olderId,
        newerId: 'live',
        focusedSide: 'older',
        olderText: '',
        newerText: liveDocumentTextForHistory(graphId, documentId),
        diffStatus: olderId ? 'loading' : 'idle',
        diffError: null,
        diffStyle: currentDocHistorySurface?.diffStyle ?? 'split',
        restoreBusy: false,
      }
      rerenderCurrentSource()
      if (olderId) refreshDocHistoryDiff()
    })
    .catch((e) => {
      if (
        requestId !== latestDocHistoryRequest ||
        store !== activeStore ||
        sourceSelect.value !== 'CELL_LIVE'
      ) return
      currentDocHistorySurface = {
        graphId,
        documentId,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
        snapshots: [],
        totalCount: null,
        olderId: '',
        newerId: 'live',
        focusedSide: 'older',
        olderText: '',
        newerText: liveDocumentTextForHistory(graphId, documentId),
        diffStatus: 'idle',
        diffError: null,
        diffStyle: currentDocHistorySurface?.diffStyle ?? 'split',
        restoreBusy: false,
      }
      rerenderCurrentSource()
    })
}

function openDocHistory(documentId = openDocId, origin = 'document history'): void {
  if (!documentId) {
    err('open a document before opening version history.')
    return
  }
  if (documentId !== openDocId) {
    void openCellDocument(documentId).then(() => loadDocHistorySurface(currentGraphId, documentId))
    return
  }
  loadDocHistorySurface(currentGraphId, documentId)
  ok(`${origin} -> opened version history for ${documentId}`)
}

function handleDocHistoryCursorChange(detail: DocHistoryCursorDetail): void {
  const surface = currentDocHistorySurface
  if (!surface) return
  currentDocHistorySurface = {
    ...surface,
    olderId: detail.olderId === 'live' ? '' : detail.olderId,
    newerId: detail.newerId,
    focusedSide: detail.focusedSide,
  }
  refreshDocHistoryDiff()
}

function handleDocHistoryDiffStyleChange(detail: DocHistoryDiffStyleDetail): void {
  const surface = currentDocHistorySurface
  if (!surface) return
  currentDocHistorySurface = { ...surface, diffStyle: detail.diffStyle }
  rerenderCurrentSource()
}

function handleDocHistoryRefresh(): void {
  const surface = currentDocHistorySurface
  if (!surface) return
  loadDocHistorySurface(surface.graphId, surface.documentId)
}

function handleDocHistorySaveCurrent(): void {
  const surface = currentDocHistorySurface
  if (!surface || !store || sourceSelect.value !== 'CELL_LIVE') return
  const activeStore = store
  void fetchDocumentSnapshotJson<HostedDocumentSnapshotEntry>(activeStore.contract, surface.graphId, surface.documentId, '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(() => {
      ok(`saved snapshot for ${surface.documentId}`)
      loadDocHistorySurface(surface.graphId, surface.documentId)
    })
    .catch((e) => err(`save snapshot error:\n${e instanceof Error ? e.message : String(e)}`))
}

function handleDocHistoryBookmark(detail: DocHistorySnapshotDetail): void {
  const surface = currentDocHistorySurface
  if (!surface || !store || sourceSelect.value !== 'CELL_LIVE') return
  const snapshot = surface.snapshots.find((item) => item.id === detail.snapshotId)
  const label = snapshot?.label || 'Saved version'
  const activeStore = store
  void fetchDocumentSnapshotJson<HostedDocumentSnapshotEntry>(
    activeStore.contract,
    surface.graphId,
    surface.documentId,
    `/${encodeURIComponent(detail.snapshotId)}/copy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    },
  )
    .then(() => {
      ok(`bookmarked snapshot ${detail.snapshotId}`)
      loadDocHistorySurface(surface.graphId, surface.documentId)
    })
    .catch((e) => err(`bookmark snapshot error:\n${e instanceof Error ? e.message : String(e)}`))
}

function handleDocHistoryDelete(detail: DocHistorySnapshotDetail): void {
  const surface = currentDocHistorySurface
  if (!surface || !store || sourceSelect.value !== 'CELL_LIVE') return
  void confirmAction({
    title: 'Delete Saved Version',
    message: 'Delete this saved version? This cannot be undone.',
    confirmText: 'Delete',
    variant: 'danger',
  }).then((confirmed) => {
    if (!confirmed || !store) return
    const activeStore = store
    void fetchDocumentSnapshotVoid(
      activeStore.contract,
      surface.graphId,
      surface.documentId,
      `/${encodeURIComponent(detail.snapshotId)}`,
      { method: 'DELETE' },
    )
      .then(() => {
        ok(`deleted snapshot ${detail.snapshotId}`)
        loadDocHistorySurface(surface.graphId, surface.documentId)
      })
      .catch((e) => err(`delete snapshot error:\n${e instanceof Error ? e.message : String(e)}`))
  })
}

function handleDocHistoryRestore(detail: DocHistoryRestoreDetail): void {
  const surface = currentDocHistorySurface
  if (!surface || !store || sourceSelect.value !== 'CELL_LIVE') return
  const snapshot = surface.snapshots.find((item) => item.id === detail.snapshotId)
  const label = snapshot?.label || detail.snapshotId
  void confirmAction({
    title: 'Restore Version',
    message: `Restore "${surface.documentId}" to "${label}"? This replaces the current document contents.`,
    confirmText: 'Restore',
    variant: 'warning',
  }).then((confirmed) => {
    if (!confirmed || !store) return
    const latest = currentDocHistorySurface
    if (!latest) return
    currentDocHistorySurface = { ...latest, restoreBusy: true }
    rerenderCurrentSource()
    const activeStore = store
    void fetchDocumentSnapshotText(activeStore.contract, surface.graphId, surface.documentId, detail.snapshotId, 'html')
      .then((html) => {
        const live = currentLiveEditor()
        if (!live || surface.documentId !== openDocId) {
          throw new Error('The document editor is not open.')
        }
        if (!live.restoreHtml(html)) {
          throw new Error('The editor rejected the snapshot content.')
        }
        clearDocHistoryState()
        ok(`restored ${surface.documentId} to ${label}`)
        rerenderCurrentSource()
      })
      .catch((e) => {
        const after = currentDocHistorySurface
        if (after) currentDocHistorySurface = { ...after, restoreBusy: false }
        err(`restore snapshot error:\n${e instanceof Error ? e.message : String(e)}`)
        rerenderCurrentSource()
      })
  })
}

function closeOpenDocumentSurface(documentId: string): void {
  if (openDocId !== documentId) return
  openDocId = null
  if (cellDocId.value.trim() === documentId) cellDocId.value = ''
  currentZoomBlockId = null
  currentBlockFocusRequest = null
  currentHoveredCommentId = null
  currentInspectorSelection = null
  currentWireBundle = null
  currentWireContexts = new Map()
  clearDocHistoryState()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  currentDailyNotePopover = null
  clearTagLensState()
  writeZoomBlockIdToUrl(null)
  teardownEditorClaim()
}

async function refreshTagLens(rawName: string): Promise<void> {
  const name = normalizeTagName(rawName)
  if (!name) return
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    currentTagLens = {
      tagName: name,
      status: 'error',
      blocks: [],
      error: 'Open a live cell source to read tagged blocks.',
    }
    rerenderCurrentSource()
    return
  }

  const requestId = ++latestTagLensRequest
  const graphId = currentGraphId
  currentSidebarSelectedId = `tag:${name}`
  currentTagLens = {
    tagName: name,
    status: 'loading',
    blocks: currentTagLens?.tagName === name ? currentTagLens.blocks : [],
  }
  rerenderCurrentSource()
  try {
    const blocks = await loadTagLensBlocks(store.contract.rest, graphId, name)
    if (
      requestId !== latestTagLensRequest ||
      graphId !== currentGraphId ||
      sourceSelect.value !== 'CELL_LIVE' ||
      currentTagLens?.tagName !== name
    ) {
      return
    }
    currentSidebarSelectedId = `tag:${name}`
    currentTagLens = {
      tagName: name,
      status: 'ready',
      blocks,
    }
    rerenderCurrentSource()
    ok(`#${name}: ${blocks.length} tagged block${blocks.length === 1 ? '' : 's'}`)
  } catch (e) {
    if (
      requestId !== latestTagLensRequest ||
      graphId !== currentGraphId ||
      sourceSelect.value !== 'CELL_LIVE' ||
      currentTagLens?.tagName !== name
    ) {
      return
    }
    currentTagLens = {
      tagName: name,
      status: 'error',
      blocks: [],
      error: e instanceof Error ? e.message : String(e),
    }
    rerenderCurrentSource()
    err(`tag lens read error for #${name}:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function handleTagIntent(rawName: string, origin: string): void {
  const name = normalizeTagName(rawName)
  if (!name) return
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    err(`${origin}: open a CELL_LIVE source before selecting #${name}`)
    return
  }
  switchToTagLens(name)
  rerenderCurrentSource()
  ok(`${origin}: loading #${name}`)
  void refreshTagLens(name)
}

function openZoteroSourceFromArtifact(
  artifactId: string,
  zoteroKey = zoteroKeyFromArtifactId(artifactId),
  origin = 'zotero source',
): void {
  const key = zoteroKey.trim()
  const sourceArtifactId = artifactId.trim() || artifactIdFromZoteroKey(key)
  if (!sourceArtifactId || !key) {
    err(`${origin}: Zotero source requires an artifact id or key.`)
    return
  }
  clearTagLensState()
  clearArtifactSurfaceState()
  clearDocHistoryState()
  openDocId = null
  currentZoomBlockId = null
  currentBlockFocusRequest = null
  currentHoveredCommentId = null
  currentWireBundle = null
  currentWireContexts = new Map()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  currentDailyNotePopover = null
  writeZoomBlockIdToUrl(null)
  teardownEditorClaim()
  currentSidebarSelectedId = sourceArtifactId
  currentInspectorSelection = {
    kind: 'artifact',
    graphId: currentGraphId,
    artifactId: sourceArtifactId,
    label: sourceArtifactId,
    section: 'artifacts',
  }
  currentZoteroSourceSurface = {
    graphId: currentGraphId,
    artifactId: sourceArtifactId,
    zoteroKey: key,
    status: 'idle',
    item: null,
    annotations: [],
    incomingWires: [],
    promotedAnnotationKeys: new Set(),
  }
  rerenderCurrentSource()
  void refreshZoteroSource()
  ok(`${origin}: opening Zotero source ${key}`)
}

async function refreshZoteroSource(detail?: ZoteroSourceBaseDetail): Promise<void> {
  const surface = currentZoteroSourceSurface
  if (!surface) return
  if (detail && (detail.artifactId !== surface.artifactId || detail.zoteroKey !== surface.zoteroKey)) return
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    currentZoteroSourceSurface = {
      ...surface,
      status: 'error',
      error: 'Open a live cell source to load Zotero sources.',
    }
    rerenderCurrentSource()
    return
  }
  const requestId = ++latestZoteroSourceRequest
  const graphId = currentGraphId
  currentZoteroSourceSurface = { ...surface, status: 'loading', error: null }
  rerenderCurrentSource()
  try {
    const read = await loadZoteroSource(store.contract, graphId, surface.artifactId, surface.zoteroKey)
    if (
      requestId !== latestZoteroSourceRequest ||
      graphId !== currentGraphId ||
      sourceSelect.value !== 'CELL_LIVE' ||
      currentZoteroSourceSurface?.artifactId !== surface.artifactId
    ) {
      return
    }
    const latest = currentZoteroSourceSurface
    currentZoteroSourceSurface = {
      ...latest,
      status: read.item ? 'ready' : 'error',
      item: read.item,
      annotations: read.annotations,
      incomingWires: read.incomingWires,
      error: read.error,
    }
    rerenderCurrentSource()
  } catch (e) {
    if (
      requestId !== latestZoteroSourceRequest ||
      graphId !== currentGraphId ||
      sourceSelect.value !== 'CELL_LIVE' ||
      currentZoteroSourceSurface?.artifactId !== surface.artifactId
    ) {
      return
    }
    const latest = currentZoteroSourceSurface
    currentZoteroSourceSurface = {
      ...latest,
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    }
    rerenderCurrentSource()
    err(`Zotero source read error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function handleZoteroSourceOpenZotero(detail: ZoteroSourceOpenZoteroDetail): void {
  ok(`open Zotero source ${detail.zoteroKey}`)
}

async function handleZoteroSourceOpenTag(detail: ZoteroSourceOpenTagDetail): Promise<void> {
  const activeStore = liveSidebarMutationStore('open Zotero source tag')
  if (!activeStore) return
  try {
    await materializeZoteroSource(activeStore.contract, currentGraphId, detail.zoteroKey)
  } catch (e) {
    err(`Zotero source materialize error:\n${e instanceof Error ? e.message : String(e)}`)
  }
  handleTagIntent(detail.normalizedTag || detail.tag, 'Zotero source tag')
}

function handleZoteroSourceOpenDocument(detail: ZoteroSourceOpenDocumentDetail): void {
  void openDocumentFromShell({
    graphId: detail.graphId ?? currentGraphId,
    documentId: detail.documentId,
    ...(detail.wire.otherBlockId ? { blockId: detail.wire.otherBlockId } : {}),
  })
}

async function handleZoteroSourcePromote(detail: ZoteroSourcePromoteAnnotationDetail): Promise<void> {
  const surface = currentZoteroSourceSurface
  if (!surface || surface.artifactId !== detail.artifactId || surface.zoteroKey !== detail.zoteroKey) return
  if (surface.promotedAnnotationKeys.has(detail.annotationKey)) return
  const activeStore = liveSidebarMutationStore('promote Zotero annotation')
  if (!activeStore) return
  try {
    const todayKey = currentTodayKey()
    const targetDocumentId = dailyNoteDocumentId(todayKey)
    await materializeZoteroSource(activeStore.contract, currentGraphId, detail.zoteroKey)
    queueZoteroPromotion({
      annotationKey: detail.annotationKey,
      sourceGraphId: currentGraphId,
      targetDocumentId,
      text: detail.annotation.text ?? '',
      comment: detail.annotation.comment ?? null,
      artifactId: detail.artifactId,
      zoteroKey: detail.zoteroKey,
      citation: detail.citation,
    })
    currentZoteroSourceSurface = {
      ...surface,
      promotedAnnotationKeys: new Set([...surface.promotedAnnotationKeys, detail.annotationKey]),
    }
    rerenderCurrentSource()
    await openDailyNoteByDate(todayKey)
    schedulePendingZoteroPromotionDrain()
    ok(`queued Zotero annotation ${detail.annotationKey} for ${targetDocumentId}`)
  } catch (e) {
    err(`Zotero annotation promotion error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function currentTodayKey(): string {
  return todayKeyForTimeZone(currentTimeZone())
}

function dailyNoteDocumentId(dateKey: string): string {
  return `daily-note-${dateKey}`
}

function queueZoteroPromotion(promotion: PendingZoteroPromotion): void {
  const existing = pendingZoteroPromotionsByDoc.get(promotion.targetDocumentId) ?? []
  if (existing.some(item => item.annotationKey === promotion.annotationKey && item.artifactId === promotion.artifactId)) return
  pendingZoteroPromotionsByDoc.set(promotion.targetDocumentId, [...existing, promotion])
}

function schedulePendingZoteroPromotionDrain(delayMs = 0): void {
  if (!openDocId || !pendingZoteroPromotionsByDoc.has(openDocId)) return
  const token = ++pendingZoteroPromotionDrainToken
  const run = () => {
    if (token !== pendingZoteroPromotionDrainToken) return
    void drainPendingZoteroPromotionsForOpenDoc(0)
  }
  if (delayMs > 0) {
    window.setTimeout(run, delayMs)
  } else {
    queueMicrotask(run)
  }
}

async function drainPendingZoteroPromotionsForOpenDoc(attempt: number): Promise<void> {
  const documentId = openDocId
  if (!documentId) return
  const pending = pendingZoteroPromotionsByDoc.get(documentId)
  if (!pending?.length) return

  const live = currentLiveEditor()
  if (!live) {
    if (attempt < 20) {
      window.setTimeout(() => void drainPendingZoteroPromotionsForOpenDoc(attempt + 1), 50)
    }
    return
  }

  const activeStore = store
  const graphId = currentGraphId
  const remaining: PendingZoteroPromotion[] = []
  for (const promotion of pending) {
    if (promotion.sourceGraphId !== graphId || promotion.targetDocumentId !== documentId) {
      remaining.push(promotion)
      continue
    }
    const inserted = live.insertZoteroPromotion({
      text: promotion.text,
      comment: promotion.comment,
      artifactId: promotion.artifactId,
      zoteroKey: promotion.zoteroKey,
      citation: promotion.citation,
    })
    if (!inserted.applied) {
      remaining.push(promotion)
      continue
    }
    if (activeStore && sourceSelect.value === 'CELL_LIVE') {
      try {
        await createZoteroGroundingWire(activeStore.contract, graphId, {
          sourceDocumentId: documentId,
          sourceBlockId: inserted.blockId,
          targetArtifactId: promotion.artifactId,
          predicate: QUOTES_FROM_PREDICATE,
        })
      } catch (e) {
        err(`Zotero grounding wire error:\n${e instanceof Error ? e.message : String(e)}`)
      }
    }
    ok(`promoted Zotero annotation ${promotion.annotationKey} into ${documentId}`)
  }

  if (remaining.length) pendingZoteroPromotionsByDoc.set(documentId, remaining)
  else pendingZoteroPromotionsByDoc.delete(documentId)
}

function dailyNoteDateFromId(documentId: string | null): string | null {
  if (!documentId) return null
  const match = /^daily-note-(\d{4}-\d{2}-\d{2})$/.exec(documentId)
  return match ? match[1] : null
}

function dailyNoteForDate(dateKey: string): DailyNoteDocument | null {
  return currentDailyNotes.find(note => note.dateKey === dateKey) ?? null
}

function activeDailyNote(): DailyNoteDocument | null {
  if (!openDocId) return null
  const explicit = currentDailyNotes.find(note => note.id === openDocId)
  if (explicit) return explicit
  const dateKey = dailyNoteDateFromId(openDocId)
  return dateKey
    ? { id: openDocId, title: openDocId, dateKey, timeZone: currentTimeZone() }
    : null
}

function dailyNoteAdjacency(note: DailyNoteDocument | null): { before: number; after: number } | null {
  if (!note) return null
  let before = 0
  let after = 0
  for (const other of currentDailyNotes) {
    if (other.id === note.id) continue
    if (other.dateKey < note.dateKey) before++
    else if (other.dateKey > note.dateKey) after++
  }
  return before === 0 && after === 0 ? null : { before, after }
}

function dailyNoteRenderState(): NonNullable<RenderWorkspaceOptions['dailyNotes']> {
  const todayKey = currentTodayKey()
  const todayDoc = dailyNoteForDate(todayKey)
  const active = activeDailyNote()
  const datesWithNotes = new Set(currentDailyNotes.map(note => note.dateKey))
  if (active) datesWithNotes.add(active.dateKey)
  const todayDocProp: DailyNoteDoc | null = todayDoc
    ? { id: todayDoc.id, updatedAt: todayDoc.updatedAt }
    : null
  return {
    todayKey,
    todayDoc: todayDocProp,
    showHomeRow: openDocId == null && currentTagLens == null && currentZoteroSourceSurface == null && currentArtifactSurface == null,
    activeDateKey: active?.dateKey ?? null,
    activeAdjacency: dailyNoteAdjacency(active),
    datesWithNotes,
    popover: currentDailyNotePopover,
    onOpenDate: (detail: DailyNoteOpenDetail) => {
      void openDailyNoteByDate(detail.dateKey)
    },
    onCalendarAnchor: (detail: DailyNoteCalendarAnchorDetail) => {
      openDailyNotePopover(detail.anchor)
    },
    onClosePopover: () => {
      currentDailyNotePopover = null
      rerenderCurrentSource()
    },
  }
}

async function refreshDailyNotes(): Promise<void> {
  if (!store) {
    currentDailyNotes = []
    currentDailyNotePopover = null
    latestDailyNotesRequest++
    if (sourceSelect.value === 'CELL_LIVE') rerenderCurrentSource()
    return
  }
  const requestId = ++latestDailyNotesRequest
  const graphId = currentGraphId
  try {
    const notes = await loadDailyNotes(store.contract.rest, graphId)
    if (requestId !== latestDailyNotesRequest || graphId !== currentGraphId || sourceSelect.value !== 'CELL_LIVE') return
    currentDailyNotes = notes
    rerenderCurrentSource()
  } catch (e) {
    if (requestId !== latestDailyNotesRequest || graphId !== currentGraphId || sourceSelect.value !== 'CELL_LIVE') return
    currentDailyNotes = []
    err(`daily-note projection read error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function openDailyNotePopover(anchor: HTMLElement): void {
  const popoverWidth = 300
  const popoverHeight = 400
  const margin = 8
  const rect = anchor.getBoundingClientRect()
  const x = Math.min(Math.max(margin, rect.left), window.innerWidth - popoverWidth - margin)
  const y = Math.min(rect.bottom + 6, window.innerHeight - popoverHeight - margin)
  currentDailyNotePopover = {
    x,
    y,
    viewedKey: activeDailyNote()?.dateKey ?? currentTodayKey(),
  }
  rerenderCurrentSource()
}

async function openDailyNoteByDate(rawDateKey: string): Promise<void> {
  const dateKey = rawDateKey.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    err(`daily note date must be YYYY-MM-DD: ${rawDateKey}`)
    return
  }
  const activeStore = liveSidebarMutationStore('open daily note')
  if (!activeStore) return
  const graphId = currentGraphId
  const timeZone = currentTimeZone()
  currentDailyNotePopover = null
  try {
    ok(`opening daily note ${dateKey}...`)
    if (!dailyNoteForDate(dateKey)) {
      await refreshDailyNotes()
      if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return
    }
    const result = await ensureDailyNote(activeStore.contract.mcp, {
      graphId,
      dateKey,
      timeZone,
      existing: currentDailyNotes,
    })
    if (result.created) {
      const stillCurrent = await refreshAfterSidebarMutation(activeStore, graphId)
      if (!stillCurrent) return
    }
    await openCellDocument(result.documentId)
    if (result.created) homeActivityStore.markCreated(graphId, result.documentId)
    ok(`${result.created ? 'created and opened' : 'opened'} daily note ${dateKey}`)
  } catch (e) {
    err(`daily-note open error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Appended after `loadSidebarSections` returns (master §3 Slice 8, WS3
 * §5.3) so `sidebar-documents.ts` remains a pure SPARQL projection of the
 * CURRENT life. Graph-gated on `currentParkedWork`'s own `graphId`: a
 * teardown/switch leaves `currentParkedWork` momentarily stale for the new
 * graph (its own async `refreshParkedWork` has not resolved yet), and this
 * guard is what stops a wrong-graph parked section from briefly appearing.
 */
function sidebarSectionsWithParkedWork(sections: readonly SidebarSection[], graphId: string): readonly SidebarSection[] {
  if (!currentParkedWork || currentParkedWork.graphId !== graphId) return sections
  const parked = parkedSidebarSection(currentParkedWork)
  return parked ? [...sections, parked] : sections
}

async function refreshSidebarSections(): Promise<boolean> {
  if (!store) {
    currentSidebarSections = []
    currentSidebarStatus = 'idle'
    currentSidebarError = ''
    latestSidebarRequest++
    if (documentSwitcherEl.open) refreshDocumentSwitcherRows()
    if (sourceSelect.value === 'CELL_LIVE') rerenderCurrentSource()
    return false
  }
  const activeStore = store
  const requestId = ++latestSidebarRequest
  const graphId = currentGraphId
  currentSidebarStatus = 'loading'
  currentSidebarError = ''
  if (sourceSelect.value === 'CELL_LIVE') rerenderCurrentSource()
  try {
    const sections = await loadSidebarSections(activeStore.contract.rest, graphId, openDocId, currentSidebarExpandedFolders)
    if (
      requestId !== latestSidebarRequest
      || store !== activeStore
      || graphId !== currentGraphId
      || sourceSelect.value !== 'CELL_LIVE'
    ) return false
    // Document-plane pending/parked decoration (master §3 Slice 4). A pure
    // overlay — folders/artifacts/tags pass through unchanged.
    currentSidebarSections = sidebarSectionsWithParkedWork(
      decorateSidebarSectionsWithSourceState(sections, currentSourceOutboxRecords()),
      graphId,
    )
    currentSidebarStatus = 'ready'
    currentSidebarError = ''
    // Membership pruning belongs to SourceMirrorRuntime.importCompleteMirror,
    // where it is causally tied to one verified complete source epoch. A
    // sidebar projection can be an older local epoch while another client has
    // just created or recreated a document; treating that view as deletion
    // authority races positive incarnation-bearing snapshot testimony.
    if (documentSwitcherEl.open) refreshDocumentSwitcherRows()
    rerenderCurrentSource()
    return true
  } catch (e) {
    if (
      requestId !== latestSidebarRequest
      || store !== activeStore
      || graphId !== currentGraphId
      || sourceSelect.value !== 'CELL_LIVE'
    ) return false
    // Keep the last authoritative projection mounted through a transient read
    // failure. Status/error remain honest while Home and Browse preserve the
    // resource face and offer the existing refresh intent.
    currentSidebarStatus = 'error'
    currentSidebarError = e instanceof Error ? e.message : String(e)
    if (documentSwitcherEl.open) refreshDocumentSwitcherRows()
    err(`sidebar document-list read error:\n${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

function liveSidebarMutationStore(action: string): OrganismSessionStore | null {
  if (!store || sourceSelect.value !== 'CELL_LIVE') {
    err(`${action}: open a CELL_LIVE source first.`)
    return null
  }
  return store
}

async function refreshAfterSidebarMutation(activeStore: OrganismSessionStore, graphId: string): Promise<boolean> {
  if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return false
  // File-tree operations do not mutate :ux:config. Refresh it opportunistically
  // without making local acceptance wait for an unavailable cell.
  void activeStore.refresh()
  try {
    const sections = await loadSidebarSections(
      activeStore.contract.rest,
      graphId,
      openDocId,
      currentSidebarExpandedFolders,
    )
    if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return false
    // This mutation owns a post-acceptance projection commit. Invalidate older
    // reads already queued by source-mirror phase notifications, then publish
    // the source+outbox view exactly once.
    latestSidebarRequest += 1
    // A second, independent call site (master §3 Slice 4) — decorate here
    // too, or every sidebar mutation would silently erase every badge.
    currentSidebarSections = sidebarSectionsWithParkedWork(
      decorateSidebarSectionsWithSourceState(sections, currentSourceOutboxRecords()),
      graphId,
    )
    currentSidebarStatus = 'ready'
    currentSidebarError = ''
    // The complete source import owns absence/deletion testimony. This
    // projection is only a Surface face over that epoch plus local intents.
    if (documentSwitcherEl.open) refreshDocumentSwitcherRows()
    rerenderCurrentSource()
  } catch (error) {
    if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return false
    currentSidebarStatus = 'error'
    currentSidebarError = error instanceof Error ? error.message : String(error)
    rerenderCurrentSource()
    return false
  }
  await refreshDailyNotes()
  return store === activeStore && currentGraphId === graphId && sourceSelect.value === 'CELL_LIVE'
}

let activeDocumentTransferAbort: AbortController | null = null
let documentExportController: DocumentExportDialogController | null = null
let activeQuickClipAbort: AbortController | null = null
let quickClipRequestId = 0
let quickClipStatus: WorkspaceQuickClipStatus = 'idle'
let quickClipError = ''

function documentTransferService(activeStore: OrganismSessionStore): GardendDocumentTransferService {
  return new GardendDocumentTransferService(activeStore.contract)
}

function resetQuickClip(abort = true, rerender = true): void {
  quickClipRequestId += 1
  if (abort) activeQuickClipAbort?.abort()
  activeQuickClipAbort = null
  quickClipStatus = 'idle'
  quickClipError = ''
  if (rerender && sourceSelect.value === 'CELL_LIVE' && store) rerenderCurrentSource()
}

function handleQuickClipOpenChange(open: boolean): void {
  // Closing the popover should never leave a stale 'complete'/'error' state
  // for the next time it's opened. Don't abort a genuinely in-flight clip —
  // only clear terminal states.
  if (open) {
    // A clip that was still 'processing' when the popover was last closed
    // may have finished (or errored) in the background while hidden — the
    // close-time reset below never got a chance to fire for it. Don't show
    // that stale terminal screen now that it's opening again.
    if (quickClipStatus === 'complete' || quickClipStatus === 'error') resetQuickClip(false, true)
    return
  }
  if (quickClipStatus === 'processing') return
  resetQuickClip(false, true)
}

async function handleQuickClipRequest(detail: WorkspaceQuickClipRequestDetail): Promise<void> {
  const activeStore = liveSidebarMutationStore('quick clip')
  if (!activeStore || quickClipStatus === 'processing') return
  const graphId = currentGraphId
  const controller = new AbortController()
  activeQuickClipAbort?.abort()
  activeQuickClipAbort = controller
  const requestId = ++quickClipRequestId
  quickClipStatus = 'processing'
  quickClipError = ''
  rerenderCurrentSource()
  try {
    const transfer = documentTransferService(activeStore)
    const result = detail.kind === 'youtube'
      ? await transfer.importYouTubeClip(graphId, detail.url, { signal: controller.signal })
      : await transfer.importWebClip(graphId, detail.url, { signal: controller.signal })
    if (
      requestId !== quickClipRequestId
      || store !== activeStore
      || currentGraphId !== graphId
      || sourceSelect.value !== 'CELL_LIVE'
    ) return
    homeActivityStore.markCreated(graphId, result.documentId)
    if (!(await refreshAfterSidebarMutation(activeStore, graphId))) return
    if (requestId !== quickClipRequestId) return
    quickClipStatus = 'complete'
    quickClipError = ''
    rerenderCurrentSource()
    const warnings = result.warnings.length > 0 ? ` (${result.warnings.join('; ')})` : ''
    ok(`clipped ${detail.kind === 'youtube' ? 'YouTube transcript' : 'web page'} into ${result.documentId}${warnings}`)
  } catch (error) {
    if (requestId !== quickClipRequestId) return
    if (error instanceof Error && error.name === 'AbortError') {
      quickClipStatus = 'idle'
      quickClipError = ''
    } else {
      quickClipStatus = 'error'
      quickClipError = error instanceof Error ? error.message : String(error)
      err(`quick clip error:\n${quickClipError}`)
    }
    if (store === activeStore && currentGraphId === graphId && sourceSelect.value === 'CELL_LIVE') {
      rerenderCurrentSource()
    }
  } finally {
    if (activeQuickClipAbort === controller) activeQuickClipAbort = null
  }
}

async function createDocumentImportFolders(
  activeStore: OrganismSessionStore,
  graphId: string,
  files: readonly File[],
  directoryMode: boolean,
): Promise<Map<string, string>> {
  const folderIds = new Map<string, string>()
  const directoryPaths = directoryMode
    ? Array.from(new Set(files.flatMap(file => {
        const parts = documentImportDirectoryParts(file)
        return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
      }))).sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
    : []

  // Match Garden's flat multi-file behavior: group one import gesture under a
  // dated folder, while a single file remains at the graph root.
  if (!directoryMode && files.length > 1) {
    const now = new Date()
    const name = `Imports ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    const { folderId } = await createSidebarFolder(activeStore.contract.mcp, {
      graphId,
      name,
      parentId: null,
      section: 'documents',
    })
    folderIds.set('', folderId)
    currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders).add(folderId)
    return folderIds
  }

  for (const path of directoryPaths) {
    const parts = path.split('/').filter(Boolean)
    const name = parts.at(-1)
    if (!name) continue
    const parentPath = parts.slice(0, -1).join('/')
    const parentId = parentPath ? folderIds.get(parentPath) ?? null : null
    const { folderId } = await createSidebarFolder(activeStore.contract.mcp, {
      graphId,
      name,
      parentId,
      section: 'documents',
    })
    folderIds.set(path, folderId)
    currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders).add(folderId)
  }
  return folderIds
}

async function importDocumentsFromSidebar(): Promise<void> {
  const activeStore = liveSidebarMutationStore('import documents')
  if (!activeStore) return
  if (activeDocumentTransferAbort) {
    activeDocumentTransferAbort.abort()
    return
  }

  const kind = await pickDocumentImportKind()
  if (!kind) {
    ok('document import cancelled')
    return
  }
  const files = await pickDocumentFiles({ directory: kind === 'folder' })
  if (!files || files.length === 0) {
    ok('document import cancelled')
    return
  }
  await runDocumentImport(activeStore, files, kind === 'folder')
}

/**
 * Shared upload body for both the button-triggered picker flow
 * (importDocumentsFromSidebar) and drag-and-drop (handleSidebarFileDrop) —
 * everything from "files are in hand" through create-folders/upload/refresh/
 * error-handling. directoryMode only matters for the folder-structure picker
 * flow; a drag-and-drop of loose files is always treated as a flat batch
 * (Garden's own "group under a dated Imports folder" behavior for >1 file
 * already lives in createDocumentImportFolders and applies here too).
 */
async function runDocumentImport(
  activeStore: OrganismSessionStore,
  files: readonly File[],
  directoryMode: boolean,
): Promise<void> {
  if (store !== activeStore || sourceSelect.value !== 'CELL_LIVE') return

  const graphId = currentGraphId
  const controller = new AbortController()
  activeDocumentTransferAbort = controller
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || activeDocumentTransferAbort !== controller) return
    event.preventDefault()
    controller.abort()
    ok('cancelling document import…')
  }
  window.addEventListener('keydown', cancelOnEscape)

  try {
    ok(`preparing ${files.length} document${files.length === 1 ? '' : 's'} for ${graphId}…`)
    const folderIds = await createDocumentImportFolders(activeStore, graphId, files, directoryMode)
    const transfer = documentTransferService(activeStore)
    const result = await transfer.uploadFiles(graphId, files, {
      signal: controller.signal,
      parentIdForFile: file => {
        const path = documentImportDirectoryParts(file).join('/')
        return folderIds.get(path) ?? folderIds.get('') ?? null
      },
      onFileStart: (file, index, total) => {
        ok(`importing ${index + 1}/${total}: ${file.name} — press Escape to cancel`)
      },
      onProgress: (file, progress) => {
        const pct = progress.percent === undefined ? '' : ` ${Math.round(progress.percent)}%`
        ok(`${progress.message ?? `importing ${file.name}`}${pct} — press Escape to cancel`)
      },
    })

    if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return
    await refreshAfterSidebarMutation(activeStore, graphId)
    if (result.cancelled) {
      ok(`document import cancelled (${result.succeeded.length} completed)`)
      return
    }
    if (result.failed.length > 0) {
      const details = result.failed.map(item => `${item.file.name}: ${item.error.message}`).join('\n')
      err(`imported ${result.succeeded.length}, failed ${result.failed.length}${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}:\n${details}`)
      return
    }
    if (result.succeeded.length === 1) {
      await openCellDocument(result.succeeded[0].documentId)
    }
    ok(`imported ${result.succeeded.length} document${result.succeeded.length === 1 ? '' : 's'}${result.skipped.length ? ` (skipped ${result.skipped.length} system files)` : ''}`)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ok('document import cancelled')
    } else {
      err(`document import error:\n${e instanceof Error ? e.message : String(e)}`)
    }
  } finally {
    window.removeEventListener('keydown', cancelOnEscape)
    if (activeDocumentTransferAbort === controller) activeDocumentTransferAbort = null
  }
}

/**
 * Drag-and-drop entry point. Scoped to loose files dropped directly onto the
 * sidebar — NOT recursive folder drops (reading a dropped folder's contents
 * needs the async DataTransferItem.webkitGetAsEntry() directory-walking API,
 * a separate, larger piece of work; OG has this, this pass doesn't). Files
 * dropped from within a folder in the OS file picker still arrive as loose
 * files here (the browser only exposes directory structure for entries the
 * *drag source* explicitly marks as directories), so this covers the
 * overwhelmingly common "drag a few files in" case.
 */
async function handleSidebarFileDrop(fileList: FileList): Promise<void> {
  const activeStore = liveSidebarMutationStore('drop import')
  if (!activeStore) return
  if (activeDocumentTransferAbort) {
    ok('an import is already in progress — press Escape to cancel it first')
    return
  }
  const files = Array.from(fileList)
  if (files.length === 0) return
  await runDocumentImport(activeStore, files, false)
}

async function importArtifactAsDocument(
  artifactId: string,
  title: string,
  parentId: string | null,
): Promise<void> {
  const activeStore = liveSidebarMutationStore('import artifact')
  if (!activeStore) return
  const graphId = currentGraphId
  const controller = new AbortController()
  activeDocumentTransferAbort?.abort()
  activeDocumentTransferAbort = controller
  try {
    ok(`importing artifact "${title}"…`)
    const result = await documentTransferService(activeStore).importArtifact(graphId, artifactId, {
      title,
      parentId,
      readOnly: false,
      signal: controller.signal,
      onProgress: progress => {
        const pct = progress.percent === undefined ? '' : ` ${Math.round(progress.percent)}%`
        ok(`${progress.message ?? `importing artifact "${title}"`}${pct}`)
      },
    })
    if (!(await refreshAfterSidebarMutation(activeStore, graphId))) return
    await openCellDocument(result.documentId)
    ok(`imported artifact "${title}" as editable document (${result.documentId})`)
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') ok('artifact import cancelled')
    else err(`artifact import error:\n${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (activeDocumentTransferAbort === controller) activeDocumentTransferAbort = null
  }
}

function openDocumentExport(documentId: string, title: string): void {
  const activeStore = liveSidebarMutationStore('export document')
  if (!activeStore) return
  documentExportController?.destroy()
  documentExportController = attachDocumentExportDialog(exportDialogEl, documentTransferService(activeStore))
  void documentExportController.open({
    graphId: currentGraphId,
    documentId,
    title,
  })
}

async function createDocumentFromSidebar(title: string, parentId: string | null = null): Promise<void> {
  const activeStore = liveSidebarMutationStore('create document')
  if (!activeStore) return
  const graphId = currentGraphId
  let createdDocumentId: string | null = null
  ok(`creating document "${title}"...`)
  await runMobileFileMutation({
    action: 'create-document',
    graphId,
    label: title,
    store: activeStore,
    perform: async () => {
      const created = await createSidebarDocument(activeStore.contract.mcp, { graphId, title, parentId })
      createdDocumentId = created.documentId
      if (parentId) {
        currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
        currentSidebarExpandedFolders.add(parentId)
      }
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the new document could be checked.')
      }
      await openCellDocument(created.documentId)
      homeActivityStore.markCreated(graphId, created.documentId)
    },
    isReflected: () => Boolean(
      createdDocumentId
      && sidebarNodeById(createdDocumentId)?.label === title,
    ),
    reflectedMessage: `${title} is present in the current files.`,
    notReflectedMessage: `Garden did not return ${title} in the refreshed file list.`,
  }, `created document "${title}"`, 'create document error')
}

async function createFolderFromSidebar(
  name: string,
  parentId: string | null = null,
  section: 'documents' | 'artifacts' = 'documents',
): Promise<void> {
  const activeStore = liveSidebarMutationStore('create folder')
  if (!activeStore) return
  const graphId = currentGraphId
  let createdFolderId: string | null = null
  ok(`creating folder "${name}"...`)
  await runMobileFileMutation({
    action: 'create-folder',
    graphId,
    label: name,
    store: activeStore,
    perform: async () => {
      const created = await createSidebarFolder(activeStore.contract.mcp, { graphId, name, parentId, section })
      createdFolderId = created.folderId
      currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
      if (parentId) currentSidebarExpandedFolders.add(parentId)
      currentSidebarExpandedFolders.add(created.folderId)
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the new folder could be checked.')
      }
    },
    isReflected: () => Boolean(
      createdFolderId
      && sidebarNodeById(createdFolderId)?.label === name,
    ),
    reflectedMessage: `${name} is present in the current files.`,
    notReflectedMessage: `Garden did not return ${name} in the refreshed file list.`,
  }, `created folder "${name}"`, 'create folder error')
}

async function moveDocumentFromSidebar(
  documentId: string,
  title: string,
  parentId: string | null,
  order: number | null = null,
): Promise<void> {
  const activeStore = liveSidebarMutationStore('move document')
  if (!activeStore) return
  const graphId = currentGraphId
  ok(`moving document "${documentId}"...`)
  await runMobileFileMutation({
    action: 'move',
    graphId,
    nodeId: documentId,
    label: title,
    store: activeStore,
    perform: async () => {
      await moveSidebarDocument(activeStore.contract.mcp, { graphId, documentId, parentId, order })
      if (parentId) {
        currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
        currentSidebarExpandedFolders.add(parentId)
      }
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the document move could be checked.')
      }
    },
    isReflected: () => (sidebarNodeById(documentId)?.parentId ?? null) === parentId,
    reflectedMessage: `${title} is in the selected location.`,
    notReflectedMessage: `Garden did not return ${title} in the selected location.`,
  }, `moved document "${title}" (${documentId})`, 'move document error')
}

async function moveFolderFromSidebar(
  folderId: string,
  label: string,
  parentId: string | null,
  order: number | null = null,
): Promise<void> {
  const activeStore = liveSidebarMutationStore('move folder')
  if (!activeStore) return
  const graphId = currentGraphId
  ok(`moving folder "${folderId}"...`)
  await runMobileFileMutation({
    action: 'move',
    graphId,
    nodeId: folderId,
    label,
    store: activeStore,
    perform: async () => {
      await moveSidebarFolder(activeStore.contract.mcp, { graphId, folderId, parentId, order })
      currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
      currentSidebarExpandedFolders.add(folderId)
      if (parentId) currentSidebarExpandedFolders.add(parentId)
      if (currentInspectorSelection?.kind === 'folder' && currentInspectorSelection.folderId === folderId) {
        currentInspectorSelection = { ...currentInspectorSelection, parentId }
      }
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the folder move could be checked.')
      }
    },
    isReflected: () => (sidebarNodeById(folderId)?.parentId ?? null) === parentId,
    reflectedMessage: `${label} is in the selected location.`,
    notReflectedMessage: `Garden did not return ${label} in the selected location.`,
  }, `moved folder "${label}" (${folderId})`, 'move folder error')
}

async function renameDocumentFromSidebar(documentId: string, title: string): Promise<void> {
  const activeStore = liveSidebarMutationStore('rename document')
  if (!activeStore) return
  const graphId = currentGraphId
  ok(`renaming document "${documentId}"...`)
  await runMobileFileMutation({
    action: 'rename',
    graphId,
    nodeId: documentId,
    label: title,
    store: activeStore,
    perform: async () => {
      await renameSidebarDocument(activeStore.contract.mcp, { graphId, documentId, title })
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the document rename could be checked.')
      }
      if (currentInspectorSelection?.kind === 'document' && currentInspectorSelection.documentId === documentId) {
        currentInspectorSelection = { ...currentInspectorSelection, title }
        rerenderCurrentSource()
      }
    },
    isReflected: () => sidebarNodeById(documentId)?.label === title,
    reflectedMessage: `${title} is the current document name.`,
    notReflectedMessage: `Garden did not return ${title} as the current document name.`,
  }, `renamed document "${documentId}" -> "${title}"`, 'rename document error')
}

async function deleteDocumentFromSidebar(documentId: string, title: string): Promise<void> {
  const activeStore = liveSidebarMutationStore('delete document')
  if (!activeStore) return
  const graphId = currentGraphId
  const wasOpen = openDocId === documentId
  ok(`deleting document "${documentId}"...`)
  await runMobileFileMutation({
    action: 'delete',
    graphId,
    nodeId: documentId,
    label: title,
    store: activeStore,
    perform: async () => {
      await deleteSidebarDocument(activeStore.contract.mcp, { graphId, documentId })
      await activeStore.contract.documentActivation.delete({
        userId: activeStore.contract.auth.userId(),
        graphId,
        documentId,
      })
      if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') {
        throw new SidebarMutationRejectedError('The workspace changed before the document deletion could be checked.')
      }
      if (wasOpen) closeOpenDocumentSurface(documentId)
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the document deletion could be checked.')
      }
    },
    isReflected: () => sidebarNodeById(documentId) === null,
    reflectedMessage: `${title} is no longer in the current files.`,
    notReflectedMessage: `${title} is still present in the refreshed file list.`,
  }, `deleted document "${title}" (${documentId})`, 'delete document error')
}

async function renameFolderFromSidebar(folderId: string, name: string): Promise<void> {
  const activeStore = liveSidebarMutationStore('rename folder')
  if (!activeStore) return
  const graphId = currentGraphId
  ok(`renaming folder "${folderId}"...`)
  await runMobileFileMutation({
    action: 'rename',
    graphId,
    nodeId: folderId,
    label: name,
    store: activeStore,
    perform: async () => {
      await renameSidebarFolder(activeStore.contract.mcp, { graphId, folderId, name })
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the folder rename could be checked.')
      }
      if (currentInspectorSelection?.kind === 'folder' && currentInspectorSelection.folderId === folderId) {
        currentInspectorSelection = { ...currentInspectorSelection, label: name }
        rerenderCurrentSource()
      }
    },
    isReflected: () => sidebarNodeById(folderId)?.label === name,
    reflectedMessage: `${name} is the current folder name.`,
    notReflectedMessage: `Garden did not return ${name} as the current folder name.`,
  }, `renamed folder "${folderId}" -> "${name}"`, 'rename folder error')
}

async function deleteFolderFromSidebar(folderId: string, label: string): Promise<void> {
  const activeStore = liveSidebarMutationStore('delete folder')
  if (!activeStore) return
  const graphId = currentGraphId
  ok(`deleting folder "${folderId}"...`)
  await runMobileFileMutation({
    action: 'delete',
    graphId,
    nodeId: folderId,
    label,
    store: activeStore,
    perform: async () => {
      await deleteSidebarFolder(activeStore.contract.mcp, { graphId, folderId, cascade: false })
      if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') {
        throw new SidebarMutationRejectedError('The workspace changed before the folder deletion could be checked.')
      }
      currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
      currentSidebarExpandedFolders.delete(folderId)
      if (currentSidebarSelectedId === folderId) currentSidebarSelectedId = null
      if (currentInspectorSelection?.kind === 'folder' && currentInspectorSelection.folderId === folderId) {
        currentInspectorSelection = null
      }
      if (!(await refreshAfterSidebarMutation(activeStore, graphId))) {
        throw new SidebarMutationRejectedError('The workspace changed before the folder deletion could be checked.')
      }
    },
    isReflected: () => sidebarNodeById(folderId) === null,
    reflectedMessage: `${label} is no longer in the current files.`,
    notReflectedMessage: `${label} is still present in the refreshed file list.`,
  }, `deleted folder "${label}" (${folderId})`, 'delete folder error')
}

function handleSidebarNodeOpen(detail: SidebarNodeDetail): void {
  if (detail.node.kind === 'tag') {
    const name = detail.id.startsWith('tag:') ? detail.id.slice('tag:'.length) : detail.node.label
    handleTagIntent(name, 'sidebar tag')
    return
  }
  if (detail.node.kind === 'folder') {
    // Retained mechanics: the folder EXPANSION toggle and the sidebar's own
    // highlight-reflection id (currentSidebarSelectedId feeds sidebar.selectedId —
    // the bus SelectedObject cannot carry it). These stay HERE and must run BEFORE
    // the publish to match the old mutate-then-render order.
    toggleSidebarFolder(detail.id)
    currentSidebarSelectedId = detail.id
    // sidebar →drivesSelection→ inspector is now installed by the edge-interpreter:
    // publishing the SelectedFolder (same shape as the old stamp, matching
    // selectionForSidebarNode) makes face:inspector.reflect write
    // currentInspectorSelection + rerender — net one rerender, preserved.
    // NOTE (deferred-handler pattern): the publish is inline here (shell-owned)
    // while the reflect is edge-driven — so this coupling depends on the
    // sidebar→inspector edge existing in config; GARDEN_DEFAULT ships it, and I8
    // validates face existence but NOT publisher/reflector pairing, so a config
    // that dropped the edge would silently stop folder clicks reaching the inspector.
    selectionBus.publishFrom('face:sidebar', {
      kind: 'folder',
      graphId: currentGraphId,
      folderId: detail.id,
      label: detail.node.label,
      parentId: detail.node.parentId ?? null,
      section: detail.node.section === 'artifacts' ? 'artifacts' : 'documents',
    })
    return
  }
  if (detail.node.kind === 'artifact') {
    openArtifactFromSidebar(detail.id, detail.node)
    return
  }
  // master §3 Slice 8 (WS3 §5.3 REPAIR, C-D26). A parked row is
  // `kind:'document'` (it IS a document, from a previous life) but its
  // destination is the parked-work face, never an editor — keyed on
  // `section`, not on the `parked:` id prefix, because a prefix is a
  // string convention and a section is the model. This branch MUST
  // precede the `kind === 'document'` fallthrough below, or the shell
  // would call `prepareDocumentIntent` with `parked:{recoveryKey}` as
  // though it were a real document id (R22).
  if (detail.node.section === 'parked') {
    openParkedWorkRoute(currentGraphId, parkedRecoveryKeyOf(detail.id))
    return
  }
  if (detail.node.kind !== 'document') {
    ok(`sidebar node "${detail.node.label}" selected (no opener wired for kind=${detail.node.kind ?? 'document'})`)
    return
  }
  currentSidebarSelectedId = null
  // A click is stronger than hover/focus. Promote the same delayed intent
  // before navigation reaches the asynchronous render/provider boundary.
  prepareDocumentIntent(currentGraphId, detail.id, 'intent')
  // sidebar →navigatesTo→ editor is now installed by the edge-interpreter: the
  // open intent flows through sidebarOpenEmitter → face:sidebar.toResource →
  // face:editor.navigate → openDocumentFromShell({graphId: currentGraphId,
  // documentId}). For a same-graph cell-mode sidebar click that is observationally
  // equal to the old openCellDocument(detail.id): openDocumentFromShell's extra
  // sourceSelect.value/cellGraphId.value writes are same-value (DOM setters, no
  // event), its EMPORIUM_LIVE guard is false in cell mode, and startCellMode never
  // fires (store non-null AND graphId === currentGraphId). The one path they do
  // NOT share — openDocumentFromShell's `zot-` prefix branch → openZoteroSourceFromArtifact
  // — is unreachable from here: zotero items arrive as kind:'artifact' (handled
  // above), never as a document-kind node with a zot- id.
  sidebarOpenEmitter.emit({ documentId: detail.id })
}

function toggleSidebarFolder(folderId: string): void {
  currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
  if (currentSidebarExpandedFolders.has(folderId)) {
    currentSidebarExpandedFolders.delete(folderId)
  } else {
    currentSidebarExpandedFolders.add(folderId)
  }
  reflectSidebarExpansionState()
}

function setSidebarFolderExpanded(folderId: string, expanded: boolean): void {
  currentSidebarExpandedFolders = new Set(currentSidebarExpandedFolders)
  if (expanded) {
    currentSidebarExpandedFolders.add(folderId)
  } else {
    currentSidebarExpandedFolders.delete(folderId)
  }
  reflectSidebarExpansionState()
}

function openArtifactFromSidebar(artifactId: string, node?: SidebarNode | null): void {
  if (artifactId.startsWith('zot-')) {
    openZoteroSourceFromArtifact(artifactId, zoteroKeyFromArtifactId(artifactId), 'sidebar artifact')
    return
  }
  const label = node?.label ?? artifactId
  clearTagLensState()
  clearZoteroSourceState()
  clearDocHistoryState()
  openDocId = null
  currentZoomBlockId = null
  currentBlockFocusRequest = null
  currentHoveredCommentId = null
  currentWireBundle = null
  currentWireContexts = new Map()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  currentDailyNotePopover = null
  writeZoomBlockIdToUrl(null)
  teardownEditorClaim()
  currentSidebarSelectedId = artifactId
  currentInspectorSelection = {
    kind: 'artifact',
    graphId: currentGraphId,
    artifactId,
    label,
    parentId: node?.parentId ?? null,
    section: 'artifacts',
    mimeType: node?.mimeType ?? null,
    fileType: node?.fileType ?? null,
    status: node?.status ?? null,
    ingestedDocumentId: node?.ingestedDocumentId ?? null,
  }
  clearArtifactSurfaceState()
  const surface: CurrentArtifactSurface = {
    graphId: currentGraphId,
    artifactId,
    title: label,
    mimeType: node?.mimeType ?? null,
    fileType: node?.fileType ?? null,
    artifactStatus: node?.status ?? null,
    ingestedDocumentId: node?.ingestedDocumentId ?? null,
    status: 'idle',
    previewUrl: null,
    editorOpen: false,
    editorPrompt: '',
    editorGenerationTarget: 'version',
    editorGenerating: false,
    editorGenerationError: null,
    historyOpen: false,
    historyStatus: 'idle',
    historyRevisions: [],
    historyRestoringRevisionId: null,
  }
  currentArtifactSurface = surface
  rerenderCurrentSource()
  refreshArtifactPreview({ graphId: currentGraphId, artifactId })
  ok(`opened artifact "${label}" (${artifactId})`)
}

function handleSidebarNodeToggle(detail: SidebarNodeDetail): void {
  if (detail.node.kind !== 'folder') return
  toggleSidebarFolder(detail.id)
  rerenderCurrentSource()
}

/** Apply the backend-free tree's drop intent through the same gardend mutation
 * adapters used by the Move commands. The component owns only hover geometry;
 * graph writes and refresh policy remain shell effects. */
function handleSidebarNodeDrop(detail: SidebarNodeDropDetail): void {
  const mutation = resolveSidebarDrop(currentSidebarSections, detail)
  if (!mutation) return
  const { source, parentId, order } = mutation

  if (source.kind === 'folder') {
    void moveFolderFromSidebar(source.id, source.label, parentId, order)
  } else {
    void moveDocumentFromSidebar(source.id, source.label, parentId, order)
  }
}

function sidebarNodeContainsActive(node: SidebarNode, activeId: string | null): boolean {
  if (!activeId) return false
  if (node.id === activeId) return true
  return (node.children ?? []).some((child) => sidebarNodeContainsActive(child, activeId))
}

function reflectSidebarExpansionState(): void {
  function reflectNode(node: SidebarNode): SidebarNode {
    const children = (node.children ?? []).map(reflectNode)
    if (node.kind !== 'folder') {
      return children.length > 0 ? { ...node, children } : node
    }
    return {
      ...node,
      expanded: currentSidebarExpandedFolders.has(node.id) || children.some((child) => sidebarNodeContainsActive(child, openDocId)),
      children,
    }
  }

  currentSidebarSections = currentSidebarSections.map((section) => ({
    ...section,
    nodes: (section.nodes ?? []).map(reflectNode),
  }))
}

function selectionForSidebarNode(detail: SidebarActionDetail): SelectedObject | null {
  const node = detail.node
  if (!node || !detail.nodeId) return null
  switch (node.kind) {
    case 'folder':
      return {
        kind: 'folder',
        graphId: currentGraphId,
        folderId: detail.nodeId,
        label: node.label,
        parentId: node.parentId ?? null,
        section: node.section === 'artifacts' ? 'artifacts' : 'documents',
      }
    case 'artifact':
      return {
        kind: 'artifact',
        graphId: currentGraphId,
        artifactId: detail.nodeId,
        label: node.label,
        parentId: node.parentId ?? null,
        section: 'artifacts',
        mimeType: node.mimeType ?? null,
        fileType: node.fileType ?? null,
        status: node.status ?? null,
        ingestedDocumentId: node.ingestedDocumentId ?? null,
      }
    case 'tag':
      return { kind: 'tag', graphId: currentGraphId, tagName: node.label, id: detail.nodeId }
    case 'document':
    case undefined:
      return {
        kind: 'document',
        graphId: currentGraphId,
        documentId: detail.nodeId,
        title: node.label,
        parentId: node.parentId ?? null,
        section: 'documents',
      }
    default:
      return { kind: node.kind, graphId: currentGraphId, id: detail.nodeId, label: node.label }
  }
}

function handleSidebarAction(detail: SidebarActionDetail): void {
  switch (detail.action) {
    case 'refresh':
      if (
        currentMobileFileOperation?.state === 'indeterminate'
        && currentMobileFileOperation.graphId === currentGraphId
      ) {
        void recoverMobileFileOperation({
          operationId: currentMobileFileOperation.id,
          action: 'reconcile',
        })
      } else {
        void refreshSidebarSections()
      }
      return
    case 'node-menu':
      showSidebarNodeMenu(detail)
      return
    case 'rename':
      if (detail.proposedLabel !== undefined) {
        const selection = selectionForSidebarNode(detail)
        const proposedLabel = detail.proposedLabel.trim()
        if (!selection || !proposedLabel) return
        if (selection.kind === 'document') {
          const documentId = selectedDocumentId(selection)
          if (!documentId || proposedLabel === selectedDocumentTitle(selection, documentId)) return
          void renameDocumentFromSidebar(documentId, proposedLabel)
        } else if (selection.kind === 'folder') {
          const folderId = selectedFolderId(selection)
          if (!folderId || proposedLabel === selectedFolderTitle(selection, folderId)) return
          void renameFolderFromSidebar(folderId, proposedLabel)
        }
        return
      }
      // Desktop/context surfaces still use the command-owned prompt.
      // Mobile Browse sends a validated proposedLabel and takes the branch above.
      {
        const selection = selectionForSidebarNode(detail)
        const commandId = selection?.kind === 'document'
          ? 'document.rename'
          : selection?.kind === 'folder'
            ? 'folder.rename'
            : null
        if (!commandId) return
        void shellCommandRegistry.exec(commandId, buildCommandContext({
          selection,
          origin: `sidebar rename: ${detail.nodeId ?? 'unknown node'}`,
        }))
        return
      }
    case 'move':
    case 'delete': {
      const selection = selectionForSidebarNode(detail)
      const commandId = selection?.kind === 'document'
        ? `document.${detail.action}`
        : selection?.kind === 'folder'
          ? `folder.${detail.action}`
          : null
      if (!commandId) return
      void shellCommandRegistry.exec(commandId, buildCommandContext({
        selection,
        origin: `sidebar ${detail.action}: ${detail.nodeId ?? 'unknown node'}`,
      }))
      return
    }
    case 'new-document':
      void promptForText({
        title: 'New Document',
        message: 'Name the document to create in this graph.',
        placeholder: 'Untitled document',
        confirmText: 'Create',
      }).then((name) => {
        if (!name) return
        void createDocumentFromSidebar(name)
      })
      return
    case 'new-folder':
      void promptForText({
        title: 'New Folder',
        message: 'Name the folder to create in this graph.',
        placeholder: 'Folder name',
        confirmText: 'Create',
      }).then((name) => {
        if (!name) return
        void createFolderFromSidebar(name)
      })
      return
    case 'upload':
      void importDocumentsFromSidebar()
      return
  }
}

function buildCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    selection: currentInspectorSelection,
    graphId: currentGraphId,
    documentId: openDocId,
    rightPanelMode: currentRightPanel,
    posture: 'application',
    ...overrides,
  }
}

/** F2 always targets Garden's active document, never a transient inspector object. */
function buildDocumentShortcutContext(): CommandContext {
  const documentId = openDocId
  const node = documentId ? sidebarNodeById(documentId) : null
  return buildCommandContext({
    selection: documentId
      ? {
          kind: 'document',
          graphId: currentGraphId,
          documentId,
          title: node?.label ?? documentId,
          parentId: node?.parentId ?? null,
          section: 'documents',
        }
      : null,
    origin: 'keyboard shortcut',
  })
}

function commandOrigin(ctx: CommandContext, fallback: string): string {
  const origin = ctx.origin
  return typeof origin === 'string' && origin.length > 0 ? origin : fallback
}

let commandMenuContext: CommandContext | null = null

function menuHasEnabledItem(entries: readonly MenuEntry[]): boolean {
  return entries.some((entry) => !('type' in entry) && entry.disabled !== true)
}

function selectedDocumentId(selection: SelectedObject | null): string | null {
  if (selection?.kind !== 'document') return null
  return typeof selection.documentId === 'string' ? selection.documentId : null
}

function selectedDocumentTitle(selection: SelectedObject | null, fallback: string): string {
  if (!selection || selection.kind !== 'document') return fallback
  return typeof selection.title === 'string' && selection.title.length > 0 ? selection.title : fallback
}

function selectedFolderId(selection: SelectedObject | null): string | null {
  if (selection?.kind !== 'folder') return null
  return typeof selection.folderId === 'string' ? selection.folderId : null
}

function selectedFolderTitle(selection: SelectedObject | null, fallback: string): string {
  if (!selection || selection.kind !== 'folder') return fallback
  return typeof selection.label === 'string' && selection.label.length > 0 ? selection.label : fallback
}

function selectedParentId(selection: SelectedObject | null): string | null {
  if (!selection) return null
  return typeof selection.parentId === 'string' && selection.parentId.length > 0 ? selection.parentId : null
}

function selectedSection(selection: SelectedObject | null): 'documents' | 'artifacts' {
  return selection?.section === 'artifacts' ? 'artifacts' : 'documents'
}

function isDocumentSectionFolder(selection: SelectedObject | null): boolean {
  return selection?.kind === 'folder' && selectedSection(selection) === 'documents'
}

function selectedArtifactId(selection: SelectedObject | null): string | null {
  if (selection?.kind !== 'artifact') return null
  return typeof selection.artifactId === 'string' ? selection.artifactId : null
}

function selectedArtifactTitle(selection: SelectedObject | null, fallback: string): string {
  if (!selection || selection.kind !== 'artifact') return fallback
  return typeof selection.label === 'string' && selection.label.length > 0 ? selection.label : fallback
}

function showSidebarNodeMenu(detail: SidebarActionDetail): void {
  const selection = selectionForSidebarNode(detail)
  const ctx = buildCommandContext({
    selection,
    origin: detail.nodeId ? `sidebar node menu: ${detail.nodeId}` : 'sidebar node menu',
  })
  const entries = shellCommandRegistry.toMenuEntries(ctx, 'context')
  if (!menuHasEnabledItem(entries)) {
    ok(`sidebar action: node-menu${detail.nodeId ? ` for ${detail.nodeId}` : ''} (no available commands)`)
    return
  }

  commandMenuContext = ctx
  commandMenuEl.items = entries
  commandMenuEl.show(
    {
      x: typeof detail.clientX === 'number' ? detail.clientX : 240,
      y: typeof detail.clientY === 'number' ? detail.clientY : 96,
    },
    'top-right',
  )
}

function showBreadcrumbDocumentMenu(x: number, y: number): void {
  if (!openDocId) return
  const node = sidebarNodeById(openDocId)
  const selection: SelectedObject = {
    kind: 'document',
    graphId: currentGraphId,
    documentId: openDocId,
    title: node?.label ?? openDocId,
    parentId: node?.parentId ?? null,
    section: 'documents',
  }
  const ctx = buildCommandContext({ selection, origin: 'top-bar breadcrumb menu' })
  const entries = shellCommandRegistry.toMenuEntries(ctx, 'context')
  if (!menuHasEnabledItem(entries)) {
    ok('breadcrumb action: document-menu (no available commands)')
    return
  }
  commandMenuContext = ctx
  commandMenuEl.items = entries
  commandMenuEl.show({ x, y }, 'top-left')
}

const shellCommandRegistry = new CommandRegistryImpl()
const RIGHT_PANEL_COMMAND_SPECS = [
  {
    panel: 'chat',
    label: 'Toggle Chat Panel',
    icon: 'message-circle',
    shortcut: 'Mod+Shift+C',
    keywords: ['chat', 'assistant', 'ai', 'panel', 'sidebar'],
  },
  {
    panel: 'wires',
    label: 'Toggle Wires Panel',
    icon: 'git-branch',
    shortcut: 'Mod+Shift+W',
    keywords: ['wires', 'connections', 'graph', 'links', 'panel'],
  },
  {
    panel: 'graph',
    label: 'Toggle Graph Panel',
    icon: 'network',
    shortcut: 'Mod+Shift+G',
    keywords: ['graph', 'map', 'workspace', 'connections', 'panel'],
  },
  {
    panel: 'comments',
    label: 'Toggle Comments Panel',
    icon: 'message-square',
    shortcut: 'Mod+Shift+.',
    keywords: ['comments', 'annotations', 'notes', 'panel'],
  },
  {
    panel: 'inspector',
    label: 'Toggle Inspector Panel',
    icon: 'panel-right',
    shortcut: 'Mod+Shift+I',
    keywords: ['inspector', 'properties', 'details', 'panel'],
  },
] as const satisfies ReadonlyArray<{
  readonly panel: PanelId
  readonly label: string
  readonly icon: string
  readonly shortcut: string
  readonly keywords: readonly string[]
}>

shellCommandRegistry.register(
  RIGHT_PANEL_COMMAND_SPECS.map(({ panel, label, icon, shortcut, keywords }) => ({
    id: `panel.toggle.${panel}`,
    label,
    category: 'View',
    icon,
    shortcut,
    keywords,
    surfaces: ['palette', 'toolbar', 'context', 'shortcut'] as const,
    run: (ctx: CommandContext) => {
      setRightPanel(
        selectRightPanel(currentRightPanel, panel),
        commandOrigin(ctx, `command: panel.toggle.${panel}`),
      )
    },
  })),
)

shellCommandRegistry.register([
  {
    id: 'view.shortcuts',
    label: 'Show Keyboard Shortcuts',
    category: 'View',
    icon: 'help-circle',
    shortcut: 'Mod+/',
    keywords: ['keyboard', 'shortcuts', 'help', 'commands'],
    surfaces: ['palette', 'shortcut'] as const,
    run: () => {
      showShortcutsDialog()
    },
  },
  {
    id: 'document.new',
    label: 'New Document',
    category: 'Document',
    icon: 'file-text',
    shortcut: 'Mod+Alt+N',
    keywords: ['new', 'create', 'document', 'page'],
    surfaces: ['palette', 'shortcut'] as const,
    when: () => sourceSelect.value === 'CELL_LIVE' && store !== null,
    run: () => {
      void promptForText({
        title: 'New Document',
        message: 'Name the document to create in this graph.',
        placeholder: 'Untitled document',
        confirmText: 'Create',
      }).then((name) => {
        if (!name) return
        void createDocumentFromSidebar(name)
      })
    },
  },
  {
    id: 'document.open',
    label: 'Open Document',
    category: 'Document',
    icon: 'file-text',
    shortcut: 'Enter',
    keywords: ['open', 'document'],
    surfaces: ['palette', 'context'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection)
      if (!documentId) return
      void openCellDocument(documentId)
    },
  },
  {
    id: 'document.inspect',
    label: 'Inspect Document',
    category: 'Document',
    icon: 'panel-right',
    keywords: ['inspect', 'details', 'document'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection)
      if (!documentId || ctx.selection?.kind !== 'document') return
      const selection = { ...ctx.selection, documentId }
      currentInspectorSelection = selection
      if (currentRightPanel !== 'inspector') {
        setRightPanel('inspector', commandOrigin(ctx, 'command: document.inspect'))
      } else {
        rerenderCurrentSource()
        ok(`${commandOrigin(ctx, 'command: document.inspect')} → inspector selected ${documentId}`)
      }
    },
  },
  {
    id: 'document.history',
    label: 'Open Version History',
    category: 'Document',
    icon: 'clock',
    shortcut: 'Mod+Shift+H',
    keywords: ['history', 'versions', 'snapshots', 'restore', 'document'],
    surfaces: ['palette', 'context', 'shortcut'] as const,
    when: (ctx: CommandContext) =>
      sourceSelect.value === 'CELL_LIVE' && Boolean(selectedDocumentId(ctx.selection) ?? ctx.documentId),
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection) ?? ctx.documentId
      if (!documentId) return
      openDocHistory(documentId, commandOrigin(ctx, 'command: document.history'))
    },
  },
  {
    id: 'document.rename',
    label: 'Rename Document',
    category: 'Document',
    icon: 'file-text',
    shortcut: 'F2',
    keywords: ['rename', 'title', 'document'],
    surfaces: ['context', 'shortcut'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection)
      if (!documentId) return
      const currentTitle = selectedDocumentTitle(ctx.selection, documentId)
      void promptForText({
        title: 'Rename Document',
        message: `Enter a new name for "${currentTitle}".`,
        value: currentTitle,
        placeholder: 'Document name',
        confirmText: 'Rename',
      }).then((name) => {
        if (!name || name === currentTitle) return
        void renameDocumentFromSidebar(documentId, name)
      })
    },
  },
  {
    id: 'document.move',
    label: 'Move to Folder...',
    category: 'Document',
    icon: 'folder',
    keywords: ['move', 'folder', 'document'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection)
      if (!documentId) return
      const title = selectedDocumentTitle(ctx.selection, documentId)
      const currentParentId = selectedParentId(ctx.selection)
      void pickSidebarFolder({
        title: `Move "${title}"`,
        currentParentId,
        section: 'documents',
      }).then((parentId) => {
        if (parentId === undefined || parentId === currentParentId) return
        void moveDocumentFromSidebar(documentId, title, parentId)
      })
    },
  },
  {
    id: 'document.export',
    label: 'Export Document…',
    category: 'Document',
    icon: 'download',
    keywords: ['export', 'download', 'markdown', 'html', 'document'],
    surfaces: ['context', 'palette'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    when: (ctx: CommandContext) =>
      sourceSelect.value === 'CELL_LIVE' && Boolean(selectedDocumentId(ctx.selection) ?? ctx.documentId),
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection) ?? ctx.documentId
      if (!documentId) return
      openDocumentExport(documentId, selectedDocumentTitle(ctx.selection, documentId))
    },
  },
  {
    id: 'document.delete',
    label: 'Delete Document',
    category: 'Document',
    icon: 'trash',
    keywords: ['delete', 'remove', 'document'],
    variant: 'danger',
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'document',
    run: (ctx: CommandContext) => {
      const documentId = selectedDocumentId(ctx.selection)
      if (!documentId) return
      const title = selectedDocumentTitle(ctx.selection, documentId)
      void confirmAction({
        title: 'Delete Document',
        message: `Delete "${title}" from this graph? This cannot be undone here.`,
        confirmText: 'Delete',
        variant: 'danger',
      }).then((confirmed) => {
        if (!confirmed) return
        void deleteDocumentFromSidebar(documentId, title)
      })
    },
  },
  {
    id: 'folder.open',
    label: 'Open Folder',
    category: 'Folder',
    icon: 'folder',
    keywords: ['open', 'folder', 'expand'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'folder',
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      setSidebarFolderExpanded(folderId, true)
      currentSidebarSelectedId = folderId
      currentInspectorSelection = ctx.selection
      rerenderCurrentSource()
      ok(`${commandOrigin(ctx, 'command: folder.open')} -> opened ${folderId}`)
    },
  },
  {
    id: 'folder.new-document',
    label: 'New Document',
    category: 'Folder',
    icon: 'file-text',
    keywords: ['new', 'document', 'folder'],
    surfaces: ['context'] as const,
    appliesTo: isDocumentSectionFolder,
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      const folderTitle = selectedFolderTitle(ctx.selection, folderId)
      void promptForText({
        title: 'New Document',
        message: `Name the document to create in "${folderTitle}".`,
        placeholder: 'Untitled document',
        confirmText: 'Create',
      }).then((name) => {
        if (!name) return
        void createDocumentFromSidebar(name, folderId)
      })
    },
  },
  {
    id: 'folder.new-folder',
    label: 'New Folder',
    category: 'Folder',
    icon: 'folder',
    keywords: ['new', 'folder'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'folder',
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      const folderTitle = selectedFolderTitle(ctx.selection, folderId)
      const section = selectedSection(ctx.selection)
      void promptForText({
        title: 'New Folder',
        message: `Name the folder to create in "${folderTitle}".`,
        placeholder: 'Folder name',
        confirmText: 'Create',
      }).then((name) => {
        if (!name) return
        void createFolderFromSidebar(name, folderId, section)
      })
    },
  },
  {
    id: 'folder.rename',
    label: 'Rename Folder',
    category: 'Folder',
    icon: 'folder',
    keywords: ['rename', 'folder'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'folder',
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      const currentTitle = selectedFolderTitle(ctx.selection, folderId)
      void promptForText({
        title: 'Rename Folder',
        message: `Enter a new name for "${currentTitle}".`,
        value: currentTitle,
        placeholder: 'Folder name',
        confirmText: 'Rename',
      }).then((name) => {
        if (!name || name === currentTitle) return
        void renameFolderFromSidebar(folderId, name)
      })
    },
  },
  {
    id: 'folder.move',
    label: 'Move to Folder...',
    category: 'Folder',
    icon: 'folder',
    keywords: ['move', 'folder'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'folder',
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      const title = selectedFolderTitle(ctx.selection, folderId)
      const currentParentId = selectedParentId(ctx.selection)
      const section = selectedSection(ctx.selection)
      void pickSidebarFolder({
        title: `Move "${title}"`,
        currentParentId,
        section,
        excludeIds: sidebarFolderMoveExcludeIds(currentSidebarSections, folderId),
      }).then((parentId) => {
        if (parentId === undefined || parentId === currentParentId) return
        void moveFolderFromSidebar(folderId, title, parentId)
      })
    },
  },
  {
    id: 'folder.delete',
    label: 'Delete Folder',
    category: 'Folder',
    icon: 'trash',
    keywords: ['delete', 'remove', 'folder'],
    variant: 'danger',
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'folder',
    run: (ctx: CommandContext) => {
      const folderId = selectedFolderId(ctx.selection)
      if (!folderId) return
      const title = selectedFolderTitle(ctx.selection, folderId)
      void confirmAction({
        title: 'Delete Folder',
        message: `Delete "${title}" from this graph? Items inside are not deleted.`,
        confirmText: 'Delete',
        variant: 'danger',
      }).then((confirmed) => {
        if (!confirmed) return
        void deleteFolderFromSidebar(folderId, title)
      })
    },
  },
  {
    id: 'artifact.open',
    label: 'Open Artifact',
    category: 'Artifact',
    icon: 'diamond',
    shortcut: 'Enter',
    keywords: ['open', 'artifact', 'file'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'artifact',
    run: (ctx: CommandContext) => {
      const artifactId = selectedArtifactId(ctx.selection)
      if (!artifactId) return
      openArtifactFromSidebar(artifactId, {
        id: artifactId,
        label: selectedArtifactTitle(ctx.selection, artifactId),
        kind: 'artifact',
        mimeType: typeof ctx.selection?.mimeType === 'string' ? ctx.selection.mimeType : null,
        status: typeof ctx.selection?.status === 'string' ? ctx.selection.status : null,
        ingestedDocumentId: typeof ctx.selection?.ingestedDocumentId === 'string' ? ctx.selection.ingestedDocumentId : null,
      })
    },
  },
  {
    id: 'artifact.import-document',
    label: 'Import as Editable Document',
    category: 'Artifact',
    icon: 'file-text',
    keywords: ['import', 'convert', 'editable', 'document', 'artifact'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'artifact',
    run: (ctx: CommandContext) => {
      const artifactId = selectedArtifactId(ctx.selection)
      if (!artifactId) return
      void importArtifactAsDocument(
        artifactId,
        selectedArtifactTitle(ctx.selection, artifactId),
        selectedParentId(ctx.selection),
      )
    },
  },
  {
    id: 'artifact.inspect',
    label: 'Inspect Artifact',
    category: 'Artifact',
    icon: 'panel-right',
    keywords: ['inspect', 'details', 'artifact'],
    surfaces: ['context'] as const,
    appliesTo: (selection) => selection?.kind === 'artifact',
    run: (ctx: CommandContext) => {
      const artifactId = selectedArtifactId(ctx.selection)
      if (!artifactId) return
      currentSidebarSelectedId = artifactId
      currentInspectorSelection = ctx.selection
      if (currentRightPanel !== 'inspector') {
        setRightPanel('inspector', commandOrigin(ctx, 'command: artifact.inspect'))
      } else {
        rerenderCurrentSource()
        ok(`${commandOrigin(ctx, 'command: artifact.inspect')} -> inspector selected ${artifactId}`)
      }
    },
  },
])

commandMenuEl.addEventListener('mn-select', ((event: CustomEvent<MenuSelectDetail>) => {
  const detail = event.detail
  // master §3 Slice 6: the resolution menu (WS2 §6.6) reuses the SAME
  // `commandMenuEl` singleton with its OWN id vocabulary (`keep:{id}` /
  // `compose` / `copy-key`), never routed through `shellCommandRegistry`.
  if (activeResolutionMenu) {
    handleResolutionMenuSelect(activeResolutionMenu, detail.id)
    return
  }
  const base = commandMenuContext ?? buildCommandContext({ origin: 'context menu' })
  const ctx = buildCommandContext({
    ...base,
    modifiers: detail.modifiers,
    origin: commandOrigin(base, 'context menu'),
  })
  void shellCommandRegistry.exec(detail.id, ctx)
}) as EventListener)

commandMenuEl.addEventListener('mn-close', () => {
  commandMenuContext = null
  activeResolutionMenu = null
})

function documentSwitcherOrigin(): string {
  return documentSwitcherEl.scope === 'actions' ? 'command palette' : 'document switcher'
}

let latestDocumentSwitcherBlockRequest = 0

function documentSwitcherStatusText(scope: MnDocumentSwitcherScope): string {
  if (scope === 'actions') return ''
  if (sourceSelect.value !== 'CELL_LIVE') return 'Open a cell graph to search documents'
  return ''
}

function refreshDocumentSwitcherRows(): void {
  const requestId = ++latestDocumentSwitcherBlockRequest
  const scope = documentSwitcherEl.scope as MnDocumentSwitcherScope
  const sort = documentSwitcherEl.sort as MnDocumentSwitcherSort
  const query = documentSwitcherEl.query
  const ctx = buildCommandContext({ origin: documentSwitcherOrigin() })
  documentSwitcherEl.graphId = currentGraphId
  documentSwitcherEl.status = 'idle'
  documentSwitcherEl.statusText = documentSwitcherStatusText(scope)

  if (scope === 'actions') {
    documentSwitcherEl.items = []
    documentSwitcherEl.actions = documentSwitcherActionRows(shellCommandRegistry, query, ctx)
    return
  }

  documentSwitcherEl.actions = []
  const documents = documentSwitcherDocumentsFromSidebar(currentSidebarSections, currentGraphId)
  documentSwitcherEl.items = documentSwitcherItems(documents, query, scope, sort)
  if (scope !== 'all' && scope !== 'blocks') return
  if (query.trim().length < 2) return
  if (sourceSelect.value !== 'CELL_LIVE' || !store) return

  const activeStore = store
  const graphId = currentGraphId
  const semanticItems = documentSwitcherEl.semanticEnabled
    ? documentSwitcherOfflineSemanticItems(
        activeStore.contract.sourceMirror.semanticSearch(graphId, query, 40) ?? [],
        graphId,
      )
    : []
  documentSwitcherEl.status = 'loading'
  documentSwitcherEl.statusText = ''
  void loadDocumentSwitcherBlocks(activeStore.contract.rest, graphId, query, sort)
    .then((lexicalBlocks) => {
      if (
        requestId !== latestDocumentSwitcherBlockRequest ||
        store !== activeStore ||
        currentGraphId !== graphId ||
        documentSwitcherEl.query !== query ||
        documentSwitcherEl.scope !== scope ||
        documentSwitcherEl.sort !== sort
      ) return
      const freshDocuments = documentSwitcherDocumentsFromSidebar(currentSidebarSections, graphId)
      const documentRows = scope === 'all'
        ? documentSwitcherItems(freshDocuments, query, 'documents', sort)
        : []
      const blocks = mergeDocumentSwitcherBlockItems(lexicalBlocks, semanticItems)
      documentSwitcherEl.items = [...documentRows, ...blocks]
      documentSwitcherEl.status = 'idle'
      documentSwitcherEl.statusText = documentSwitcherStatusText(scope)
    })
    .catch((error) => {
      if (
        requestId !== latestDocumentSwitcherBlockRequest ||
        store !== activeStore ||
        currentGraphId !== graphId ||
        documentSwitcherEl.query !== query ||
        documentSwitcherEl.scope !== scope ||
        documentSwitcherEl.sort !== sort
      ) return
      documentSwitcherEl.status = 'error'
      documentSwitcherEl.statusText = error instanceof Error ? error.message : 'Block search failed'
    })
}

function openDocumentSwitcher(
  scope: MnDocumentSwitcherScope,
  query = '',
  target: CenterPaneOpenTarget | null = null,
): void {
  // While visual wire mode is active, the switcher is a target picker. Hand
  // active-host ownership away from the editor first so its capture-phase
  // Enter/Escape keymap does not swallow the switcher's own keyboard controls.
  const wireTargeting = activeEditorIntegration?.wireModeLifecycle.handoffToDocumentSwitcher() ?? false
  documentSwitcherTargetPaneId = target?.paneId ?? null
  documentSwitcherPlacement = target?.placement ?? 'active'
  documentSwitcherEl.scope = wireTargeting ? 'documents' : scope
  documentSwitcherEl.query = query
  documentSwitcherEl.sort = 'smart'
  documentSwitcherEl.semanticEnabled = true
  documentSwitcherEl.wireMode = wireTargeting
  documentSwitcherEl.selectedIndex = 0
  refreshDocumentSwitcherRows()
  documentSwitcherEl.open = true
}

function shouldOpenDocumentSwitcher(event: KeyboardEvent): MnDocumentSwitcherScope | null {
  if (event.defaultPrevented || event.repeat) return null
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null
  const key = event.key.toLowerCase()
  if (key === 'o') return 'all'
  if (key === 'k') return 'actions'
  return null
}

documentSwitcherEl.addEventListener('mn-document-switcher-query-change', ((event: CustomEvent<MnDocumentSwitcherQueryDetail>) => {
  documentSwitcherEl.query = event.detail.query
  documentSwitcherEl.scope = event.detail.scope
  refreshDocumentSwitcherRows()
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-scope-change', ((event: CustomEvent<MnDocumentSwitcherScopeDetail>) => {
  documentSwitcherEl.scope = event.detail.scope
  documentSwitcherEl.selectedIndex = 0
  refreshDocumentSwitcherRows()
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-sort-change', ((event: CustomEvent<MnDocumentSwitcherSortDetail>) => {
  documentSwitcherEl.sort = event.detail.sort
  refreshDocumentSwitcherRows()
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-document-intent', ((
  event: CustomEvent<MnDocumentSwitcherIntentDetail>,
) => {
  prepareDocumentIntent(
    event.detail.graphId ?? currentGraphId,
    event.detail.documentId,
    'intent',
    125,
  )
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-document-intent-end', ((
  event: CustomEvent<MnDocumentSwitcherIntentDetail>,
) => {
  cancelDocumentIntent(
    event.detail.graphId ?? currentGraphId,
    event.detail.documentId,
  )
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-open-document', ((event: CustomEvent<MnDocumentSwitcherOpenDocumentDetail>) => {
  const detail = event.detail
  prepareDocumentIntent(
    detail.graphId ?? currentGraphId,
    detail.documentId,
    'intent',
  )
  const target = {
    ...(documentSwitcherTargetPaneId ? { paneId: documentSwitcherTargetPaneId } : {}),
    placement: documentSwitcherPlacement,
  } satisfies CenterPaneOpenTarget
  documentSwitcherTargetPaneId = null
  documentSwitcherPlacement = 'active'
  void openDocumentFromShell({
    graphId: detail.graphId ?? currentGraphId,
    documentId: detail.documentId,
  }, target)
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-open-document-split', ((event: CustomEvent<MnDocumentSwitcherOpenDocumentDetail>) => {
  const detail = event.detail
  prepareDocumentIntent(
    detail.graphId ?? currentGraphId,
    detail.documentId,
    'intent',
  )
  documentSwitcherTargetPaneId = null
  documentSwitcherPlacement = 'active'
  void openDocumentFromShell({
    graphId: detail.graphId ?? currentGraphId,
    documentId: detail.documentId,
  }, {
    paneId: centerPanesController.state.activePaneId,
    placement: 'split',
  })
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-open-block', ((event: CustomEvent<MnDocumentSwitcherOpenBlockDetail>) => {
  const detail = event.detail
  prepareDocumentIntent(
    detail.graphId ?? currentGraphId,
    detail.documentId,
    'intent',
  )
  const target = {
    ...(documentSwitcherTargetPaneId ? { paneId: documentSwitcherTargetPaneId } : {}),
    placement: documentSwitcherPlacement,
  } satisfies CenterPaneOpenTarget
  documentSwitcherTargetPaneId = null
  documentSwitcherPlacement = 'active'
  void openDocumentFromShell({
    graphId: detail.graphId ?? currentGraphId,
    documentId: detail.documentId,
    blockId: detail.blockId,
  }, target)
}) as EventListener)

documentSwitcherEl.addEventListener('mn-document-switcher-run-action', ((event: CustomEvent<MnDocumentSwitcherActionDetail>) => {
  void shellCommandRegistry.exec(
    event.detail.actionId,
    buildCommandContext({ origin: 'command palette' }),
  )
}) as EventListener)

document.addEventListener('keydown', (event) => {
  const scope = shouldOpenDocumentSwitcher(event)
  if (!scope) return
  event.preventDefault()
  event.stopPropagation()
  openDocumentSwitcher(scope)
}, true)

document.addEventListener('keydown', (event) => {
  if (handleLandmarkCycleShortcut(event, hostEl, document)) return
  handleRegistryDocumentShortcut(
    event,
    shellCommandRegistry,
    buildDocumentShortcutContext(),
    error => err(`keyboard command error:\n${error instanceof Error ? error.message : String(error)}`),
  )
}, true)

function shortcutCommandsFromRegistry(): MnShortcutCommand[] {
  return shellCommandRegistry
    .available(buildDocumentShortcutContext(), 'shortcut')
    .filter(command => typeof command.shortcut === 'string' && command.shortcut.trim().length > 0)
    .map(command => ({
      id: command.id,
      label: command.label,
      category: command.category,
      shortcut: command.shortcut!,
      ...(command.keywords ? { keywords: command.keywords } : {}),
      ...(command.disabled ? { disabled: command.disabled } : {}),
    }))
}

function showShortcutsDialog(): void {
  shortcutsDialogEl.commands = shortcutCommandsFromRegistry()
  shortcutsDialogEl.show()
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function shouldOpenShortcutsDialog(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  const key = event.key
  if ((event.metaKey || event.ctrlKey) && key === '/') return true
  if (key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTextEntryTarget(event.target)) {
    return true
  }
  return false
}

document.addEventListener('keydown', (event) => {
  if (!shouldOpenShortcutsDialog(event)) return
  event.preventDefault()
  event.stopPropagation()
  showShortcutsDialog()
}, true)

shortcutsDialogEl.addEventListener('mn-shortcut-run', ((event: CustomEvent<MnShortcutRunDetail>) => {
  const detail = event.detail
  const ctx = detail.id === 'document.new' || detail.id === 'document.rename'
    ? buildDocumentShortcutContext()
    : buildCommandContext({ origin: 'shortcuts dialog' })
  void shellCommandRegistry.exec(
    detail.id,
    buildCommandContext({
      ...ctx,
      origin: 'shortcuts dialog',
      modifiers: detail.modifiers,
    }),
  )
}) as EventListener)

function readZoomBlockIdFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('b')
  } catch {
    return null
  }
}

function writeZoomBlockIdToUrl(blockId: string | null): void {
  try {
    const url = new URL(window.location.href)
    if (blockId) {
      url.searchParams.set('b', blockId)
    } else {
      url.searchParams.delete('b')
    }
    window.history.replaceState(window.history.state, '', url)
  } catch {
    // URL reflection is best-effort; the editor zoom state remains authoritative.
  }
}

function applyZoomBlockIdToLiveHost(blockId: string | null): void {
  const host = activeEditorHostElement()
  const live = host?.liveEditor
  if (!live) return
  if (blockId) {
    live.zoomIntoBlock(blockId)
  } else {
    live.zoomOut()
  }
}

function currentLiveEditor(): ShEditorHost['liveEditor'] {
  return activeEditorHostElement()?.liveEditor ?? null
}

function currentOutlinePanelOptions(): RenderWorkspaceOptions['outlinePanel'] {
  const live = currentLiveEditor()
  return {
    documentOpen: live != null,
    headings: live?.getHeadings() ?? [],
    activeHeadingId: live?.getCurrentHeadingId() ?? null,
    onNavigate: handleOutlineNavigate,
    onCommand: handleOutlineCommand,
  }
}

function handleOutlineNavigate(detail: OutlinePanelNavigateDetail): void {
  currentLiveEditor()?.focusBlock(detail.blockId)
}

function handleOutlineCommand(detail: OutlinePanelCommandDetail): void {
  currentLiveEditor()?.runOutlinerCommand(detail.command)
}

let graphProjectionRenderTimer: ReturnType<typeof setTimeout> | null = null
document.addEventListener(EDITOR_STRUCTURE_CHANGE_EVENT, ((event: CustomEvent<EditorStructureChangeDetail>) => {
  const graphWantsRefresh = currentGraphPanelViewMode === 'document' && currentRightPanel === 'graph'
  const outlineWantsRefresh = currentLeftPanelMode === 'outline'
  if (!graphWantsRefresh && !outlineWantsRefresh) return
  if (graphProjectionRenderTimer) clearTimeout(graphProjectionRenderTimer)
  graphProjectionRenderTimer = setTimeout(() => {
    graphProjectionRenderTimer = null
    rerenderCurrentSource()
  }, event.detail?.reason === 'selection' ? 0 : 140)
}) as EventListener)

// Scroll-position heading highlight — decoupled from EDITOR_STRUCTURE_CHANGE_EVENT
// (which only fires on edits/selection) so the outline panel's active entry
// tracks pure scrolling too. Only worth a rerender while the panel is visible.
document.addEventListener(EDITOR_HEADING_IN_VIEW_EVENT, (() => {
  if (currentLeftPanelMode !== 'outline') return
  rerenderCurrentSource()
}) as EventListener)

/** Reads state AT CALL TIME so the assembled bundle tracks the open doc. */
const getScope = (): EditorScope =>
  openDocId
    ? {
        app: currentApp as EditorScope['app'],
        centerMode: 'document',
        graphId: currentGraphId,
        documentId: openDocId,
      }
    : NULL_EDITOR_SCOPE

/** One memoized pane-to-document attachment claim. */
interface EditorClaim {
  key: string
  paneId: CenterPaneId
  graphId: string
  documentId: string
  services: EditorServices
  kernelOptions: EditorKernelOptions
  imageInserter: EditorImageInserter
  citationPicker: CitationPickerService
  roomLease: EditorRoomLease
  provider: ProviderHandle
  binding: EditorHostBinding
  setPickerOverlayOpen: (open: boolean) => void
}

interface ActiveEditorIntegration {
  claimKey: string
  unbindShellFeatures: () => void
  uninstallGlue: () => void
  wireModeLifecycle: OrganismWireModeLifecycle
}
let editorClaim: EditorClaim | null = null
const editorClaims = new Map<CenterPaneId, EditorClaim>()
let editorRoomPool: EditorRoomPool | null = null
let editorRoomPoolBackend: CellContract['crdt'] | null = null
let activeEditorIntegration: ActiveEditorIntegration | null = null
let currentWireBundle: WireBundle | null = null
let currentSalienceBundle: SalienceBundle | null = null
let currentWireContexts = new Map<string, WireContextState>()
let currentWireRadialContexts = new Map<string, WireRadialContextState>()
let currentPinnedWireBlockContexts = new Map<string, PinnedWireBlockContextState>()
let currentPinnedWireNodeContexts = new Map<string, PinnedWireBlockContextState>()
let latestWireBundleRequest = 0
let latestSalienceBundleRequest = 0
let latestSalienceRatingRequest = 0
let latestWireContextRequest = 0
let latestWireRadialContextRequest = 0
let latestPinnedWireBlockContextRequest = 0
let latestPinnedWireNodeContextRequest = 0
const wireContextRequestIds = new Map<string, number>()
const wireRadialContextRequestIds = new Map<string, number>()
const pinnedWireBlockContextRequestIds = new Map<string, number>()
const pinnedWireNodeContextRequestIds = new Map<string, number>()
const salienceRatingRequestIds = new Map<string, number>()

/** A minimal settable reactive binding (get/subscribe + set), no framework. */
function makeBinding(initial: EditorHostState): EditorHostBinding & { set(s: EditorHostState): void } {
  let value = initial
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of subs) cb(value)
    },
  }
}

function centerPaneDomToken(paneId: CenterPaneId): string {
  return paneId.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function editorHostElementForPane(paneId: CenterPaneId): ShEditorHost | null {
  const token = centerPaneDomToken(paneId)
  const surfaceHost = hostEl.querySelector(
    `sh-editor-host[data-center-pane-host="${token}"]`,
  ) as ShEditorHost | null
  if (surfaceHost) return surfaceHost
  const center = hostEl.querySelector('sh-center-panes')
  return center?.shadowRoot?.querySelector(
    `sh-editor-host[data-center-pane-host="${token}"]`,
  ) as ShEditorHost | null
}

function activeEditorHostElement(): ShEditorHost | null {
  return editorClaim ? editorHostElementForPane(editorClaim.paneId) : null
}

function fixedEditorScope(graphId: string, documentId: string): EditorScope {
  return {
    app: currentApp as EditorScope['app'],
    centerMode: 'document',
    graphId,
    documentId,
  }
}

/**
 * Bind room ownership to the concrete shell backend. Local Vite refreshes can
 * replace that backend even when the graph id is unchanged; no attachment may
 * silently retain the retired contract.
 */
function roomPoolFor(backend: CellContract['crdt']): EditorRoomPool {
  if (editorRoomPool && editorRoomPoolBackend === backend) return editorRoomPool
  teardownEditorClaim()
  editorRoomPool?.destroyAll()
  editorRoomPool = new EditorRoomPool(backend)
  editorRoomPoolBackend = backend
  return editorRoomPool
}

function buildPaneEditorClaim(
  paneId: CenterPaneId,
  location: Extract<CenterPaneLocation, { kind: 'document' }>,
): EditorClaim | null {
  if (!store || location.graphId !== currentGraphId) return null
  const contract = store.contract
  const roomPool = roomPoolFor(contract.crdt)
  const key = `${paneId}::${location.graphId}::${location.documentId}`
  const existing = editorClaims.get(paneId)
  if (existing?.key === key) return existing
  teardownPaneEditorClaim(paneId)

  const claimGraphId = location.graphId
  const claimDocumentId = location.documentId
  const claimScope = () => fixedEditorScope(claimGraphId, claimDocumentId)
  const services = assembleEditorServices(contract.rest, contract.wire, claimScope)
  let pickerOverlayOpen = false
  const kernelOptions: EditorKernelOptions = {
    ...buildKernelOptions(services, claimScope()),
    isOverlayOpen: () => pickerOverlayOpen,
    onTagClick: ({ name }) => handleTagIntent(name, 'editor tag chip'),
  }
  const imageInserter = makeEditorImageInserter(contract, claimGraphId)
  const citationPicker = makeCitationPickerService(contract, claimGraphId)
  const roomLease = roomPool.acquire(
    { kind: 'doc', graphId: claimGraphId, docId: claimDocumentId },
    key,
  )
  const provider = roomLease.provider
  const binding = makeBinding({
    centerMode: 'document',
    graphId: claimGraphId,
    documentId: claimDocumentId,
    status: 'ready',
    error: null,
    provider,
  })
  const claim: EditorClaim = {
    key,
    paneId,
    graphId: claimGraphId,
    documentId: claimDocumentId,
    services,
    kernelOptions,
    imageInserter,
    citationPicker,
    roomLease,
    provider,
    binding,
    setPickerOverlayOpen: (open) => { pickerOverlayOpen = open },
  }
  editorClaims.set(paneId, claim)
  return claim
}

function teardownActiveEditorIntegration(): void {
  if (!activeEditorIntegration) {
    editorClaim = null
    return
  }
  teardownCommentsSource()
  activeEditorIntegration.wireModeLifecycle.uninstall()
  activeEditorIntegration.uninstallGlue()
  activeEditorIntegration.unbindShellFeatures()
  activeEditorIntegration = null
  editorClaim = null
}

function installActiveEditorIntegration(claim: EditorClaim | null): void {
  if (!claim) {
    teardownActiveEditorIntegration()
    return
  }
  if (activeEditorIntegration?.claimKey === claim.key) {
    editorClaim = claim
    return
  }
  teardownActiveEditorIntegration()
  editorClaim = claim
  const unbindShellFeatures = shellFeatureHost.bindProvider(claim.provider, currentShellContext())
  installCommentsSource(claim.provider)
  const uninstallGlue = installWikiLinkPickerGlue({
    getEditor: (): PickerEditorHandle | null => editorHostElementForPane(claim.paneId)?.liveEditor ?? null,
    getAnchorRect: () =>
      editorHostElementForPane(claim.paneId)?.liveEditor?.getOverlayAnchorRect() ?? null,
    services: claim.services,
    citation: claim.citationPicker,
    getScope: () => fixedEditorScope(claim.graphId, claim.documentId),
    onOverlayOpenChange: claim.setPickerOverlayOpen,
  })
  const wireModeLifecycle = installOrganismWireMode({
    contract: store!.contract,
    hostId: `organism-editor:${claim.paneId}:${claim.graphId}:${claim.documentId}`,
    getHostElement: () => editorHostElementForPane(claim.paneId),
    getEditor: () => wireModeEditorFromHost(editorHostElementForPane(claim.paneId)),
    getDocumentScope: () => ({ graphId: claim.graphId, documentId: claim.documentId }),
    menu: advancedWireMenuEl,
    switcher: documentSwitcherEl,
    doc: document,
  })
  activeEditorIntegration = {
    claimKey: claim.key,
    unbindShellFeatures,
    uninstallGlue,
    wireModeLifecycle,
  }
}

function teardownPaneEditorClaim(paneId: CenterPaneId): void {
  const claim = editorClaims.get(paneId)
  if (!claim) return
  if (activeEditorIntegration?.claimKey === claim.key) teardownActiveEditorIntegration()
  claim.roomLease.release()
  editorClaims.delete(paneId)
}

function ensureEditorClaim(): EditorClaim | null {
  if (!store || !openDocId || currentTagLens || currentZoteroSourceSurface || currentArtifactSurface) {
    teardownEditorClaim()
    return null
  }
  const state = centerPanesController.state
  const panes = [state.primary, ...(state.secondary ? [state.secondary] : [])]
  const desiredPaneIds = new Set(
    panes.filter((pane) => pane.current.kind === 'document').map((pane) => pane.id),
  )
  for (const paneId of [...editorClaims.keys()]) {
    if (!desiredPaneIds.has(paneId)) teardownPaneEditorClaim(paneId)
  }
  for (const pane of panes) {
    if (pane.current.kind === 'document') buildPaneEditorClaim(pane.id, pane.current)
  }
  const active = panes.find((pane) => pane.id === state.activePaneId)
  const activeClaim = active?.current.kind === 'document'
    ? editorClaims.get(active.id) ?? null
    : null
  installActiveEditorIntegration(activeClaim)
  return activeClaim
}

/** Tear down every visible pane claim and the one active shell integration. */
function teardownEditorClaim(): void {
  teardownActiveEditorIntegration()
  for (const claim of editorClaims.values()) claim.roomLease.release()
  editorClaims.clear()
}

async function refreshWireBundle(): Promise<void> {
  const graphId = currentGraphId
  const documentId = openDocId
  if (!store || !documentId) {
    currentWireBundle = null
    currentWireContexts = new Map()
    currentWireRadialContexts = new Map()
    wireContextRequestIds.clear()
    wireRadialContextRequestIds.clear()
    return
  }
  const requestId = ++latestWireBundleRequest
  try {
    const loader = makeScopedWireBundleLoader(store.contract.rest, getScope)
    const bundle = await loader()
    if (requestId !== latestWireBundleRequest || graphId !== currentGraphId || documentId !== openDocId) return
    currentWireBundle = bundle
    rerenderCurrentSource()
  } catch (e) {
    if (requestId !== latestWireBundleRequest || graphId !== currentGraphId || documentId !== openDocId) return
    currentWireBundle = null
    err(`wire bundle read error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

async function refreshSalienceBundle(): Promise<void> {
  const graphId = currentGraphId
  const documentId = openDocId
  if (!store || !documentId) {
    currentSalienceBundle = null
    return
  }
  const requestId = ++latestSalienceBundleRequest
  try {
    const loader = makeScopedSalienceBundleLoader(store.contract.salience, getScope)
    const bundle = await loader()
    if (requestId !== latestSalienceBundleRequest || graphId !== currentGraphId || documentId !== openDocId) return
    currentSalienceBundle = bundle
    rerenderCurrentSource()
  } catch (e) {
    if (requestId !== latestSalienceBundleRequest || graphId !== currentGraphId || documentId !== openDocId) return
    currentSalienceBundle = null
    err(`salience bundle read error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function setWireContextState(wireId: string, state: WireContextState): void {
  currentWireContexts = new Map(currentWireContexts)
  currentWireContexts.set(wireId, state)
  rerenderCurrentSource()
}

function clearWireContextState(wireId: string): void {
  if (!currentWireContexts.has(wireId)) return
  currentWireContexts = new Map(currentWireContexts)
  currentWireContexts.delete(wireId)
  rerenderCurrentSource()
}

function setWireRadialContextState(nodeId: string, state: WireRadialContextState): void {
  currentWireRadialContexts = new Map(currentWireRadialContexts)
  currentWireRadialContexts.set(nodeId, state)
  rerenderCurrentSource()
}

function setPinnedWireBlockContextState(blockId: string, state: PinnedWireBlockContextState): void {
  currentPinnedWireBlockContexts = new Map(currentPinnedWireBlockContexts)
  currentPinnedWireBlockContexts.set(blockId, state)
  rerenderCurrentSource()
}

function clearPinnedWireBlockContextState(blockId: string): void {
  if (!currentPinnedWireBlockContexts.has(blockId)) return
  currentPinnedWireBlockContexts = new Map(currentPinnedWireBlockContexts)
  currentPinnedWireBlockContexts.delete(blockId)
  pinnedWireBlockContextRequestIds.delete(blockId)
  rerenderCurrentSource()
}

function setPinnedWireNodeContextState(id: string, state: PinnedWireBlockContextState): void {
  currentPinnedWireNodeContexts = new Map(currentPinnedWireNodeContexts)
  currentPinnedWireNodeContexts.set(id, state)
  rerenderCurrentSource()
}

function clearPinnedWireNodeContextState(id: string): void {
  if (!currentPinnedWireNodeContexts.has(id)) return
  currentPinnedWireNodeContexts = new Map(currentPinnedWireNodeContexts)
  currentPinnedWireNodeContexts.delete(id)
  pinnedWireNodeContextRequestIds.delete(id)
  rerenderCurrentSource()
}

function clearPinnedWireNodeContexts(nodeId: string): void {
  clearPinnedWireNodeContextState(`${nodeId}:source`)
  clearPinnedWireNodeContextState(`${nodeId}:target`)
}

function movePinnedWireNodeContexts(oldId: string, newId: string, swap: boolean): void {
  if (oldId === newId && !swap) return
  const next = new Map(currentPinnedWireNodeContexts)
  const nextRequestIds = new Map(pinnedWireNodeContextRequestIds)
  const pairs = swap
    ? [
        [`${oldId}:source`, `${newId}:target`],
        [`${oldId}:target`, `${newId}:source`],
      ] as const
    : [
        [`${oldId}:source`, `${newId}:source`],
        [`${oldId}:target`, `${newId}:target`],
      ] as const
  let changed = false
  for (const [from, to] of pairs) {
    if (next.has(from)) {
      next.set(to, next.get(from)!)
      next.delete(from)
      changed = true
    }
    if (nextRequestIds.has(from)) {
      nextRequestIds.set(to, nextRequestIds.get(from)!)
      nextRequestIds.delete(from)
      changed = true
    }
  }
  if (!changed) return
  currentPinnedWireNodeContexts = next
  pinnedWireNodeContextRequestIds.clear()
  for (const [key, value] of nextRequestIds) pinnedWireNodeContextRequestIds.set(key, value)
}

function pinnedDocId(graphId: string, documentId: string): string {
  return `pindoc-${graphId}-${documentId}`
}

function pinnedWireNodeId(graphId: string, wireId: string): string {
  return `pinwire-${graphId}-${wireId}`
}

function pinnedBlockId(graphId: string, documentId: string, blockId: string): string {
  return `pinblock-${graphId}-${documentId}-${blockId}`
}

function pinWireDocument(detail: WirePinDocumentRequestDetail | undefined): void {
  if (!detail) return
  const graphId = detail.graphId.trim()
  const documentId = detail.documentId.trim()
  if (!graphId || !documentId) return
  const id = pinnedDocId(graphId, documentId)
  if (currentPinnedWireDocs.some((doc) => doc.id === id)) return
  const offset = currentPinnedWireDocs.length * 18
  currentPinnedWireDocs = [
    ...currentPinnedWireDocs,
    {
      id,
      graphId,
      documentId,
      title: detail.title.trim() || documentId,
      x: 32 + offset,
      y: 72 + offset,
    },
  ]
  rerenderCurrentSource()
}

function pinWireNode(detail: WirePinWireRequestDetail | undefined): void {
  if (!detail) return
  const graphId = detail.graphId.trim()
  const wireId = detail.wireId.trim()
  if (!graphId || !wireId) return
  const id = pinnedWireNodeId(graphId, wireId)
  if (currentPinnedWireNodes.some((node) => node.id === id)) return
  const offset = currentPinnedWireNodes.length * 18
  const x = typeof detail.x === 'number' && Number.isFinite(detail.x) ? detail.x : 32 + offset
  const y = typeof detail.y === 'number' && Number.isFinite(detail.y) ? detail.y : 72 + offset
  currentPinnedWireNodes = [
    ...currentPinnedWireNodes,
    {
      id,
      wireId,
      graphId,
      predicate: detail.predicate,
      predicateLabel: detail.predicateLabel.trim() || detail.predicate,
      bidirectional: detail.bidirectional,
      sourceGraphId: detail.sourceGraphId,
      sourceDocumentId: detail.sourceDocumentId,
      sourceBlockId: detail.sourceBlockId ?? null,
      sourceTitle: detail.sourceTitle.trim() || detail.sourceDocumentId,
      sourceText: detail.sourceText.trim(),
      targetGraphId: detail.targetGraphId,
      targetDocumentId: detail.targetDocumentId,
      targetBlockId: detail.targetBlockId ?? null,
      targetTitle: detail.targetTitle.trim() || detail.targetDocumentId,
      targetText: detail.targetText.trim(),
      x,
      y,
    },
  ]
  rerenderCurrentSource()
}

function pinWireBlock(detail: WirePinBlockRequestDetail | undefined): void {
  if (!detail) return
  const graphId = detail.graphId.trim()
  const documentId = detail.documentId.trim()
  const blockId = detail.blockId.trim()
  if (!graphId || !documentId || !blockId) return
  const id = pinnedBlockId(graphId, documentId, blockId)
  if (currentPinnedWireBlocks.some((block) => block.id === id)) return
  const offset = currentPinnedWireBlocks.length * 18
  currentPinnedWireBlocks = [
    ...currentPinnedWireBlocks,
    {
      id,
      graphId,
      documentId,
      blockId,
      text: detail.text.trim(),
      documentTitle: detail.documentTitle.trim() || documentId,
      x: 260 + offset,
      y: 72 + offset,
    },
  ]
  rerenderCurrentSource()
}

function openPinnedWireDocument(detail: WirePinnedDocOpenDetail | undefined): void {
  if (!detail) return
  void openDocumentFromShell({
    graphId: detail.graphId,
    documentId: detail.documentId,
  })
}

function openPinnedWireBlock(detail: WirePinnedBlockOpenDetail | undefined): void {
  if (!detail) return
  void openDocumentFromShell({
    graphId: detail.graphId,
    documentId: detail.documentId,
    blockId: detail.blockId,
  })
}

function openPinnedWireNode(detail: WirePinnedWireOpenDetail | undefined): void {
  if (!detail) return
  void openDocumentFromShell({
    graphId: detail.graphId,
    documentId: detail.documentId,
    ...(detail.blockId ? { blockId: detail.blockId } : {}),
  })
}

function closePinnedWireDocument(detail: WirePinnedDocCloseDetail | undefined): void {
  if (!detail) return
  currentPinnedWireDocs = currentPinnedWireDocs.filter((doc) => doc.id !== detail.id)
  rerenderCurrentSource()
}

function closePinnedWireNode(detail: WirePinnedWireCloseDetail | undefined): void {
  if (!detail) return
  currentPinnedWireNodes = currentPinnedWireNodes.filter((node) => node.id !== detail.id)
  clearPinnedWireNodeContexts(detail.id)
  rerenderCurrentSource()
}

function closePinnedWireBlock(detail: WirePinnedBlockCloseDetail | undefined): void {
  if (!detail) return
  currentPinnedWireBlocks = currentPinnedWireBlocks.filter((block) => block.id !== detail.id)
  clearPinnedWireBlockContextState(detail.id)
  rerenderCurrentSource()
}

function movePinnedWireDocument(detail: WirePinnedDocMoveDetail | undefined): void {
  if (!detail) return
  currentPinnedWireDocs = currentPinnedWireDocs.map((doc) =>
    doc.id === detail.id ? { ...doc, x: detail.x, y: detail.y } : doc,
  )
  rerenderCurrentSource()
}

function movePinnedWireNode(detail: WirePinnedWireMoveDetail | undefined): void {
  if (!detail) return
  currentPinnedWireNodes = currentPinnedWireNodes.map((node) =>
    node.id === detail.id ? { ...node, x: detail.x, y: detail.y } : node,
  )
  rerenderCurrentSource()
}

async function updatePinnedWireNode(detail: WirePinnedWireUpdateRequestDetail | undefined): Promise<void> {
  if (!detail) return
  const node = currentPinnedWireNodes.find((item) => item.id === detail.id)
  if (!node) return
  if (detail.wireId !== node.wireId) return
  if (!editorClaim) {
    err(`pinned wire update ignored: no open editor claim for ${detail.wireId}`)
    return
  }
  const source = detail.swap
    ? {
        documentId: node.targetDocumentId,
        blockId: node.targetBlockId ?? undefined,
      }
    : {
        documentId: node.sourceDocumentId,
        blockId: node.sourceBlockId ?? undefined,
      }
  const target = detail.swap
    ? {
        graphId: node.sourceGraphId,
        documentId: node.sourceDocumentId,
        blockId: node.sourceBlockId ?? undefined,
      }
    : {
        graphId: node.targetGraphId,
        documentId: node.targetDocumentId,
        blockId: node.targetBlockId ?? undefined,
      }

  try {
    await editorClaim.services.wire.delete(node.wireId)
    const created = await editorClaim.services.wire.create({
      sourceDocumentId: source.documentId,
      ...(source.blockId ? { sourceBlockId: source.blockId } : {}),
      targetDocumentId: target.documentId,
      targetGraphId: target.graphId,
      ...(target.blockId ? { targetBlockId: target.blockId } : {}),
      predicate: detail.predicate,
      bidirectional: detail.bidirectional,
    })
    const nextId = pinnedWireNodeId(node.graphId, created.wireId)
    currentPinnedWireNodes = currentPinnedWireNodes.map((item) => {
      if (item.id !== node.id) return item
      const updated = detail.swap
        ? {
            ...item,
            id: nextId,
            wireId: created.wireId,
            predicate: detail.predicate,
            predicateLabel: getWirePredicateLabel(detail.predicate),
            bidirectional: detail.bidirectional,
            sourceGraphId: item.targetGraphId,
            sourceDocumentId: item.targetDocumentId,
            sourceBlockId: item.targetBlockId ?? null,
            sourceTitle: item.targetTitle,
            sourceText: item.targetText,
            targetGraphId: item.sourceGraphId,
            targetDocumentId: item.sourceDocumentId,
            targetBlockId: item.sourceBlockId ?? null,
            targetTitle: item.sourceTitle,
            targetText: item.sourceText,
          }
        : {
            ...item,
            id: nextId,
            wireId: created.wireId,
            predicate: detail.predicate,
            predicateLabel: getWirePredicateLabel(detail.predicate),
            bidirectional: detail.bidirectional,
          }
      return updated
    })
    movePinnedWireNodeContexts(node.id, nextId, detail.swap)
    document.dispatchEvent(new CustomEvent('mn-wire-deleted', { detail: { wireId: node.wireId } }))
    document.dispatchEvent(new CustomEvent('mn-wire-created', { detail: { wireId: created.wireId } }))
    rerenderCurrentSource()
    void refreshWireBundle()
  } catch (e) {
    err(`pinned wire update error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function movePinnedWireBlock(detail: WirePinnedBlockMoveDetail | undefined): void {
  if (!detail) return
  currentPinnedWireBlocks = currentPinnedWireBlocks.map((block) =>
    block.id === detail.id ? { ...block, x: detail.x, y: detail.y } : block,
  )
  rerenderCurrentSource()
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeWireContextEnvelope(value: unknown, fallbackTitle?: string): WireContextData {
  const obj = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const blocks = Array.isArray(obj.blocks) ? obj.blocks : []
  return {
    mode: stringField(obj.mode) ?? 'context',
    title: stringField(obj.title),
    ...(fallbackTitle ? { wireTitle: fallbackTitle } : {}),
    blocks: blocks.map((block): WireContextBlock => {
      const b = block && typeof block === 'object' ? block as Record<string, unknown> : {}
      return {
        id: stringField(b.id) ?? '',
        type: stringField(b.type) ?? 'paragraph',
        level: numberOrNull(b.level),
        text: stringField(b.text) ?? '',
        isTarget: b.isTarget === true || b.is_target === true,
      }
    }),
  }
}

function pinnedBlockTextFromContext(data: WireContextData, fallback: string): string {
  const target = data.blocks.find((block) => block.isTarget)
  return target?.text ?? data.blocks[0]?.text ?? fallback
}

function pinnedBlockContextStateFromData(data: WireContextData): PinnedWireBlockContextState {
  return {
    status: 'ready',
    data: {
      blocks: data.blocks.map((block) => ({
        id: block.id,
        text: block.text,
        isTarget: block.isTarget,
      })),
    },
  }
}

async function loadPinnedWireBlockContext(detail: WirePinnedBlockContextRequestDetail | undefined): Promise<void> {
  if (!detail) return
  const id = detail.id.trim()
  const graphIdValue = detail.graphId.trim()
  const documentIdValue = detail.documentId.trim()
  const blockIdValue = detail.blockId.trim()
  if (!id || !graphIdValue || !documentIdValue || !blockIdValue) return
  const existing = currentPinnedWireBlockContexts.get(id)
  if (existing?.status === 'loading' || existing?.status === 'ready') return
  if (!store) {
    setPinnedWireBlockContextState(id, { status: 'error', message: 'Open a cell document to load context' })
    return
  }

  const requestId = ++latestPinnedWireBlockContextRequest
  pinnedWireBlockContextRequestIds.set(id, requestId)
  setPinnedWireBlockContextState(id, { status: 'loading' })

  const graphId = encodeURIComponent(graphIdValue)
  const documentId = encodeURIComponent(documentIdValue)
  const blockId = encodeURIComponent(blockIdValue)
  try {
    const response = await fetch(
      graphCellUrl(store.contract, graphIdValue, `/documents/${graphId}/${documentId}/block-context?block_id=${blockId}`),
      { headers: cellRequestHeaders(store.contract) },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    if (pinnedWireBlockContextRequestIds.get(id) !== requestId) return
    setPinnedWireBlockContextState(id, pinnedBlockContextStateFromData(normalizeWireContextEnvelope(json)))
  } catch (e) {
    if (pinnedWireBlockContextRequestIds.get(id) !== requestId) return
    setPinnedWireBlockContextState(id, {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function loadPinnedWireNodeContext(detail: WirePinnedWireContextRequestDetail | undefined): Promise<void> {
  if (!detail) return
  const id = detail.id.trim()
  const graphIdValue = detail.graphId.trim()
  const documentIdValue = detail.documentId.trim()
  const blockIdValue = detail.blockId.trim()
  if (!id || !graphIdValue || !documentIdValue || !blockIdValue) return
  const existing = currentPinnedWireNodeContexts.get(id)
  if (existing?.status === 'loading' || existing?.status === 'ready') return
  if (!store) {
    setPinnedWireNodeContextState(id, { status: 'error', message: 'Open a cell document to load context' })
    return
  }

  const requestId = ++latestPinnedWireNodeContextRequest
  pinnedWireNodeContextRequestIds.set(id, requestId)
  setPinnedWireNodeContextState(id, { status: 'loading' })

  const graphId = encodeURIComponent(graphIdValue)
  const documentId = encodeURIComponent(documentIdValue)
  const blockId = encodeURIComponent(blockIdValue)
  try {
    const response = await fetch(
      graphCellUrl(store.contract, graphIdValue, `/documents/${graphId}/${documentId}/block-context?block_id=${blockId}`),
      { headers: cellRequestHeaders(store.contract) },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    if (pinnedWireNodeContextRequestIds.get(id) !== requestId) return
    setPinnedWireNodeContextState(id, pinnedBlockContextStateFromData(normalizeWireContextEnvelope(json)))
  } catch (e) {
    if (pinnedWireNodeContextRequestIds.get(id) !== requestId) return
    setPinnedWireNodeContextState(id, {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function refreshPinnedWireBlock(detail: WirePinnedBlockRefreshDetail | undefined): Promise<void> {
  if (!detail) return
  if (!store) {
    err(`pinned block refresh ignored: no open cell store for ${detail.blockId}`)
    return
  }
  const graphId = encodeURIComponent(detail.graphId)
  const documentId = encodeURIComponent(detail.documentId)
  const blockId = encodeURIComponent(detail.blockId)
  try {
    const response = await fetch(
      graphCellUrl(store.contract, detail.graphId, `/documents/${graphId}/${documentId}/block-context?block_id=${blockId}`),
      { headers: cellRequestHeaders(store.contract) },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    const fallback = currentPinnedWireBlocks.find((block) => block.id === detail.id)?.text ?? ''
    const data = normalizeWireContextEnvelope(json)
    const text = pinnedBlockTextFromContext(data, fallback)
    currentPinnedWireBlocks = currentPinnedWireBlocks.map((block) =>
      block.id === detail.id ? { ...block, text } : block,
    )
    if (currentPinnedWireBlockContexts.has(detail.id)) {
      currentPinnedWireBlockContexts = new Map(currentPinnedWireBlockContexts)
      currentPinnedWireBlockContexts.set(detail.id, pinnedBlockContextStateFromData(data))
    }
    rerenderCurrentSource()
  } catch (e) {
    err(`pinned block refresh error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

async function loadWireContextFromPanel(detail: WireContextRequestDetail | undefined): Promise<void> {
  if (!detail) return
  const wireId = detail.wireId.trim()
  if (!wireId) return
  if (!store) {
    setWireContextState(wireId, { status: 'error', message: 'Open a cell document to load context' })
    return
  }

  const requestId = ++latestWireContextRequest
  wireContextRequestIds.set(wireId, requestId)
  setWireContextState(wireId, { status: 'loading' })

  const graphId = encodeURIComponent(detail.graphId)
  const documentId = encodeURIComponent(detail.documentId)
  const blockParam = detail.blockId ? `?block_id=${encodeURIComponent(detail.blockId)}` : ''
  try {
    const response = await fetch(
      graphCellUrl(store.contract, detail.graphId, `/documents/${graphId}/${documentId}/block-context${blockParam}`),
      { headers: cellRequestHeaders(store.contract) },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    if (wireContextRequestIds.get(wireId) !== requestId) return
    setWireContextState(wireId, {
      status: 'ready',
      data: normalizeWireContextEnvelope(json, detail.title),
    })
  } catch (e) {
    if (wireContextRequestIds.get(wireId) !== requestId) return
    setWireContextState(wireId, {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function loadWireRadialContext(detail: WireRadialContextRequestDetail | undefined): Promise<void> {
  if (!detail) return
  const nodeId = detail.nodeId.trim()
  const graphIdValue = detail.graphId.trim()
  const documentIdValue = detail.documentId.trim()
  if (!nodeId || !graphIdValue || !documentIdValue) return
  const existing = currentWireRadialContexts.get(nodeId)
  if (existing?.status === 'loading' || existing?.status === 'ready') return
  if (!store) {
    setWireRadialContextState(nodeId, { status: 'error', message: 'Open a cell document to load context' })
    return
  }

  const requestId = ++latestWireRadialContextRequest
  wireRadialContextRequestIds.set(nodeId, requestId)
  setWireRadialContextState(nodeId, { status: 'loading' })

  const graphId = encodeURIComponent(graphIdValue)
  const documentId = encodeURIComponent(documentIdValue)
  const blockParam = detail.blockId ? `?block_id=${encodeURIComponent(detail.blockId)}` : ''
  try {
    const response = await fetch(
      graphCellUrl(store.contract, graphIdValue, `/documents/${graphId}/${documentId}/block-context${blockParam}`),
      { headers: cellRequestHeaders(store.contract) },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    if (wireRadialContextRequestIds.get(nodeId) !== requestId) return
    setWireRadialContextState(nodeId, {
      status: 'ready',
      data: normalizeWireContextEnvelope(json),
    })
  } catch (e) {
    if (wireRadialContextRequestIds.get(nodeId) !== requestId) return
    setWireRadialContextState(nodeId, {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function refreshWireSnapshot(wireId: string): Promise<void> {
  if (!store) throw new Error('No open cell store')
  const graphId = currentGraphId
  const response = await fetch(
    graphCellUrl(
      store.contract,
      graphId,
      `/wires/${encodeURIComponent(graphId)}/${encodeURIComponent(wireId)}/refresh`,
    ),
    { method: 'POST', headers: cellRequestHeaders(store.contract) },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

async function refreshWireFromPanel(detail: WireRefreshRequestDetail | undefined): Promise<void> {
  const wireId = detail?.wireId?.trim()
  if (!wireId) return
  if (!store) {
    err(`wire refresh ignored: no open cell store for ${wireId}`)
    return
  }
  try {
    await refreshWireSnapshot(wireId)
    clearWireContextState(wireId)
    await refreshWireBundle()
  } catch (e) {
    err(`wire refresh error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

async function refreshAllWiresFromPanel(): Promise<void> {
  if (!store) {
    err('wire refresh ignored: no open cell store')
    return
  }
  const wires = [
    ...(currentWireBundle?.outgoingWires ?? []),
    ...(currentWireBundle?.incomingWires ?? []),
  ]
  const wireIds = Array.from(new Set(wires.map((wire) => wire.id).filter(Boolean)))
  try {
    for (const wireId of wireIds) {
      await refreshWireSnapshot(wireId)
    }
    currentWireContexts = new Map()
    currentWireRadialContexts = new Map()
    wireContextRequestIds.clear()
    wireRadialContextRequestIds.clear()
    await refreshWireBundle()
  } catch (e) {
    err(`wire refresh-all error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

async function deleteWireFromPanel(detail: WireDeleteRequestDetail | undefined): Promise<void> {
  const wireId = detail?.wireId
  if (!wireId) return
  if (!editorClaim) {
    err(`wire delete ignored: no open editor claim for ${wireId}`)
    return
  }
  try {
    await editorClaim.services.wire.delete(wireId)
    clearWireContextState(wireId)
    document.dispatchEvent(new CustomEvent('mn-wire-deleted', { detail: { wireId } }))
  } catch (e) {
    err(`wire delete error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Rate a block's shared human importance/valence from the gutter. The local
 * bundle updates immediately, then converges to the cell's authoritative
 * BlockScore. This route is intentionally online-only; failed or unauthorized
 * writes roll back so an unsaved rating is never presented as durable truth.
 */
async function rateSalienceBlock(detail: SalienceRateRequestDetail | undefined): Promise<void> {
  const blockId = detail?.blockId
  if (!blockId || !store || !openDocId) return
  const access = currentSalienceWriteAccess()
  if (!access.writable) {
    err(`salience rate ignored: ${access.reason}`)
    return
  }
  const graphId = currentGraphId
  const documentId = openDocId
  // Two independent staleness hazards, both real under rapid clicks or a slow
  // connection: (1) a second rate on the SAME block can have its PUT response
  // land before the first's, letting the older value win — guarded by
  // requestId below, mirroring wireContextRequestIds. (2) an in-flight
  // refreshSalienceBundle() GET (started by document-open, still pending) can
  // resolve AFTER this optimistic/confirmed write and clobber it — bumping
  // latestSalienceBundleRequest here retroactively marks that GET stale so its
  // own guard drops it instead of overwriting the newer rating.
  const requestId = ++latestSalienceRatingRequest
  salienceRatingRequestIds.set(blockId, requestId)
  latestSalienceBundleRequest++
  const checkpoint = captureSalienceScore(currentSalienceBundle, blockId)
  const existing = checkpoint.score
  const optimistic: BlockScore = existing
    ? { ...existing, userImportance: detail.importance, userValence: detail.valence }
    : {
        blockId,
        documentId,
        cumulativeImportance: 0,
        cumulativeValence: 0,
        rawImportanceSum: 0,
        rawValenceSum: 0,
        importanceCount: 0,
        valenceCount: 0,
        compositeScore: 0,
        blockWireCount: 0,
        docWireCount: 0,
        lastValuatedAt: null,
        userImportance: detail.importance,
        userValence: detail.valence,
      }
  currentSalienceBundle = withSalienceScore(currentSalienceBundle, optimistic)
  rerenderCurrentSource()
  try {
    const updated = await store.contract.salience.setUserValue(graphId, {
      documentId,
      blockId,
      importance: detail.importance,
      valence: detail.valence,
    })
    if (graphId !== currentGraphId || documentId !== openDocId) return
    if (salienceRatingRequestIds.get(blockId) !== requestId) return
    currentSalienceBundle = withSalienceScore(currentSalienceBundle, updated)
    rerenderCurrentSource()
  } catch (e) {
    if (salienceRatingRequestIds.get(blockId) !== requestId) return
    if (graphId !== currentGraphId || documentId !== openDocId) return
    currentSalienceBundle = rollbackSalienceScore(currentSalienceBundle, blockId, checkpoint)
    rerenderCurrentSource()
    err(`salience rate error:\n${e instanceof Error ? e.message : String(e)}`)
    // A rapid earlier write on this same block may still have reached the
    // cell. Re-read after the immediate block-local rollback so that, when a
    // read path remains available (notably a hosted Viewer-style 403 on PUT),
    // the UI converges to authority rather than an older optimistic snapshot.
    await refreshSalienceBundle()
  }
}

function homeDocumentsFromSidebar(): HomeDocumentSource[] {
  const documents: HomeDocumentSource[] = []
  const visit = (nodes: readonly SidebarNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'document') documents.push({
        id: node.id,
        title: node.label,
        readOnly: node.readOnly,
        createdAt: node.createdAt,
      })
      if (node.children?.length) visit(node.children)
    }
  }
  for (const section of currentSidebarSections) visit(section.nodes ?? [])
  return documents
}

function currentGraphTitle(): string {
  return hostedGraphs.find(graph => graph.graphId === currentGraphId)?.title || currentGraphId
}

interface SalienceWriteAccess {
  readonly writable: boolean
  readonly reason: string | null
}

/**
 * Human salience is currently a graph-shared, direct REST write. It is not a
 * typed source outbox operation, so we must neither offer it to hosted Viewers
 * nor imply that an offline mirror can queue it.
 */
function currentSalienceWriteAccess(): SalienceWriteAccess {
  if (sourceSelect.value !== 'CELL_LIVE' || !store || !openDocId) {
    return { writable: false, reason: 'Open a live cell document to rate salience.' }
  }
  if (currentSourceMirror?.fenced) {
    return { writable: false, reason: 'This graph lifetime has moved on; reload it before rating.' }
  }
  if (currentSourceMirror?.phase === 'error') {
    return { writable: false, reason: 'Ratings are online-only; reconnect to the cell before rating.' }
  }
  if (deploymentConfig.mode === 'hosted') {
    const role = hostedGraphs.find(graph => graph.graphId === currentGraphId)?.role
    if (role !== 'editor' && role !== 'owner') {
      return { writable: false, reason: 'Rating requires Editor access to this graph.' }
    }
  }
  return { writable: true, reason: null }
}

function salienceEditorDocumentAccess(): EditorDocumentAccess {
  const salience = currentSalienceWriteAccess()
  return {
    // Center panes did not previously receive the original-file controller's
    // content-access projection. Preserve that behavior here: salience write
    // authority is independent, and must not accidentally invent a second
    // document-read-only source that cannot observe Make Editable transitions.
    readOnly: false,
    salienceWritable: salience.writable,
    salienceWriteReason: salience.reason,
  }
}

function currentHomeOptions(): NonNullable<RenderWorkspaceOptions['home']> {
  const projection = homeActivityStore.project(currentGraphId, homeDocumentsFromSidebar())
  return {
    status: currentSidebarStatus === 'error'
      ? 'error'
      : currentSidebarStatus === 'ready'
        ? 'ready'
        : 'loading',
    error: currentSidebarError,
    graphId: currentGraphId,
    graphTitle: currentGraphTitle(),
    ...projection,
    onNewDocument: () => handleSidebarAction({ action: 'new-document' }),
    onOpenDocument: (document: WorkspaceHomeDocument) => {
      void openDocumentFromShell({ graphId: document.graphId, documentId: document.documentId })
    },
    onPinDocument: (document: WorkspaceHomeDocument, pinned: boolean) => {
      homeActivityStore.setPinned(document.graphId, document.documentId, pinned)
      rerenderCurrentSource()
    },
  }
}

function workspaceSummaries(): WorkspaceSummary[] {
  return hostedGraphs.map(graph => ({
    ...graph,
    ...(graph.role === 'viewer'
      ? {
          disabled: true,
          disabledReason: 'Viewer workspaces are visible but cannot be opened until the gateway exposes read-only MCP access.',
        }
      : {}),
  }))
}

function centerPaneEditorHostOptions(): ReadonlyMap<CenterPaneId, CenterPaneEditorHostOptions> {
  const hosts = new Map<CenterPaneId, CenterPaneEditorHostOptions>()
  for (const [paneId, claim] of editorClaims) {
    const active = paneId === centerPanesController.state.activePaneId
    hosts.set(paneId, {
      binding: claim.binding,
      kernelOptions: claim.kernelOptions,
      initialZoomBlockId: active ? currentZoomBlockId : null,
      focusRequest: active ? currentBlockFocusRequest : null,
      wireBundle: active ? currentWireBundle : null,
      wireRadialContexts: active ? currentWireRadialContexts : null,
      salienceBundle: active ? currentSalienceBundle : null,
      imageInserter: claim.imageInserter,
      documentAccess: salienceEditorDocumentAccess(),
    })
  }
  return hosts
}

// ── Semantic edge overlay, slice 1 — FacePort adapters + interpreter install ───
// The adapters wrap the REAL plug points the imperative handlers used to call
// directly. `normalize` is shared by a face's drivesSelection AND reveals edges
// (the interpreter reads `from.normalize` once per face), so it must produce a
// SelectedObject that BOTH the inspector reflect and the editor reveal can read.

/**
 * comments face normalizer. Mirrors the exact stamp handleCommentSelect used to
 * write: a `SelectedComment` only when a document is open (the `if (openDocId)`
 * guard), else null. carries `blockId` when the comment is block-anchored so the
 * reveal can disambiguate. When null, the drivesSelection publish is null (the
 * inspector reflects a cleared selection) — matching the guarded stamp for every
 * reachable state (a comment can only be picked while its document is open).
 */
function commentToSelected(raw: WorkspaceCommentDetail): SelectedObject | null {
  if (!openDocId) return null
  return {
    kind: 'comment',
    graphId: currentGraphId,
    documentId: openDocId,
    commentId: raw.id,
    ...(raw.comment.blockId ? { blockId: raw.comment.blockId } : {}),
  }
}

/**
 * graph face normalizer. Reads `node.blockId`/`node.kind` (NEVER `node.id`, a
 * local join-key): a portal or block-less node is unrevealable, so it returns
 * null — exactly the `if (!blockId || kind === 'portal') return` guard
 * handleGraphPanelNodeSelect kept. The `block` selection carries only `blockId`
 * (no `commentId`), so the editor reveal routes it to `focusGraphBlock`.
 */
function graphNodeToSelected(raw: GraphPanelNodeSelectDetail): SelectedObject | null {
  const node = raw.node
  if (!node.blockId || node.kind === 'portal') return null
  return {
    kind: 'block',
    graphId: node.graphId ?? currentGraphId,
    documentId: node.documentId ?? openDocId ?? '',
    blockId: node.blockId,
  }
}

// The five faces the slice-1/2 edges touch. Keys are face ids in the `face:<id>`
// id-space (DISTINCT from panel ids like `panel-comments`); they match the
// `from`/`to` of the GARDEN_DEFAULT edges verbatim. This key set is the runtime-
// authoritative face registry; nucleus's KNOWN_FACE_IDS is its commit-gate MIRROR
// (I8) and MUST stay in lockstep — adding a face here means adding it there too.
const EDGE_FACES: Record<string, FacePort> = {
  // Reflect sink — one ADDITIONAL writer of currentInspectorSelection. Writes the
  // published selection and triggers the SAME rerender the handlers used to run,
  // so the inspector updates identically. Never deletes the variable or its
  // other writers (behavior-preserving two-write-path).
  'face:inspector': {
    reflect: (sel) => {
      currentInspectorSelection = sel
      rerenderCurrentSource()
    },
  },
  // Tier-A push source: the comments panel's select event, replayed through a
  // real emitter, normalized to a SelectedComment.
  'face:comments': {
    onSelect: (cb) => commentSelectEmitter.subscribe(cb),
    normalize: (raw) => commentToSelected(raw as WorkspaceCommentDetail),
  },
  // Tier-A push source with TWO predicates off two events: node-SELECT →
  // SelectedBlock (reveals), and node-OPEN → NavResource (navigatesTo). The two
  // emitters are distinct at the panel, so a select never navigates and an open
  // never reveals. toResource returns null for an open that addresses no document
  // (mirrors handleGraphPanelNodeOpen's `&& node.documentId` guard), which the
  // interpreter treats as a no-op.
  'face:graph': {
    onSelect: (cb) => graphSelectEmitter.subscribe(cb),
    normalize: (raw) => graphNodeToSelected(raw as GraphPanelNodeSelectDetail),
    onOpen: (cb) => graphOpenEmitter.subscribe(cb),
    toResource: (raw) => {
      const node = (raw as GraphPanelNodeOpenDetail).node
      return node.documentId
        ? { graphId: node.graphId ?? currentGraphId, documentId: node.documentId }
        : null
    },
  },
  // Tier-B OPEN source: a sidebar doc-open (navigatesTo → editor). Its mere
  // presence as a key ALSO lets the sidebar folder drivesSelection edge resolve —
  // that edge publishes inline from the folder branch and needs no port here.
  'face:sidebar': {
    onOpen: (cb) => sidebarOpenEmitter.subscribe(cb),
    toResource: (raw) => ({ graphId: currentGraphId, documentId: (raw as { documentId: string }).documentId }),
  },
  // Imperative reveal target — no bus write. A comment anchor scrolls the live
  // editor to the comment (matching setActiveComment(id,{scroll:true})); a bare
  // block anchor focuses the block (matching focusGraphBlock). commentId is
  // checked first so a block-anchored comment still reveals as a comment, exactly
  // as the old comment handler did (it never called focusGraphBlock).
  'face:editor': {
    reveal: (anchor) => {
      if (anchor.commentId !== undefined) {
        currentLiveEditor()?.setActiveComment(anchor.commentId, { scroll: true })
      } else if (anchor.blockId !== undefined) {
        focusGraphBlock(anchor.blockId)
      }
    },
    // navigatesTo SINK (distinct from reveal): opens a resource as the active
    // surface via the shell's real open-document entry point. The graph node-open
    // and sidebar doc-open edges both route here; a NavResource is exactly an
    // OpenDocumentDetail (graphId/documentId + optional blockId).
    navigate: (resource: NavResource) => void openDocumentFromShell(resource),
  },
}

/**
 * (Re)install the edge-interpreter over the just-rendered config. Idempotent
 * across config reloads: the previous install's disposer runs first so the bus
 * and per-face emitter subscriptions never accumulate.
 */
function installSelectionEdges(config: WorkspaceConfig): void {
  disposeEdgeInterpreter?.()
  disposeEdgeInterpreter = installEdgeInterpreter(config, EDGE_FACES, selectionBus)
}

// ── Dev edge overlay — mn-relations as a LIVE diagram of `config.edges` ────────
// Opt-in via `?edgeOverlay=1`. It appends its OWN floating host to document.body
// (the same createElement + appendChild pattern the command menu / dialogs use),
// so it never touches the layout tree, the render host, or the mobile shell — the
// escape hatch the design spec calls for when a clean in-layout mount would be
// invasive. It renders the SAME `config.edges` the interpreter installs behavior
// from ("one model, two consumers": behavior vs diagram) and subscribes the bus so
// the last-fired selection tints the edge its source face drove. Read-only:
// routing a diagram click back into a selection is deferred (an MnRelation is a
// face pair, not a `SelectedObject` — no honest inverse exists in slice 1).
const edgeOverlayEnabled = new URLSearchParams(window.location.search).get('edgeOverlay') === '1'
let edgeOverlayRelationsEl: MnRelations | null = null
let edgeOverlayEdges: WorkspaceConfig['edges']

/** Lazily build the floating overlay host and wire its live bus subscription. */
function ensureEdgeOverlayHost(): MnRelations {
  if (edgeOverlayRelationsEl) return edgeOverlayRelationsEl
  const host = document.createElement('div')
  host.setAttribute('data-edge-overlay', '')
  host.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483000;max-width:320px;'
    + 'padding:10px 12px;border-radius:8px;background:var(--mn-color-surface-raised,#fff);'
    + 'border:1px solid var(--mn-color-border-default,#e5e7eb);box-shadow:0 4px 16px rgba(0,0,0,0.18);'
    + 'font:11px/1.4 system-ui,sans-serif'
  const title = document.createElement('div')
  title.textContent = 'config.edges'
  title.style.cssText = 'font-weight:600;margin-bottom:6px;opacity:0.7;text-transform:uppercase;letter-spacing:0.06em'
  const relationsEl = document.createElement('mn-relations') as MnRelations
  host.append(title, relationsEl)
  document.body.appendChild(host)
  // The last-fired selection re-projects the diagram with the driving edge tinted.
  // The bus is stable for the app lifetime and the host is built once, so this one
  // subscription never leaks or duplicates across config reloads.
  selectionBus.subscribe((sel) => {
    relationsEl.relations = configEdgesToRelations(edgeOverlayEdges, sel)
  })
  edgeOverlayRelationsEl = relationsEl
  return relationsEl
}

/** Refresh the dev edge overlay with the just-rendered config's edges (opt-in). */
function updateEdgeOverlay(config: WorkspaceConfig): void {
  if (!edgeOverlayEnabled) return
  edgeOverlayEdges = config.edges
  ensureEdgeOverlayHost().relations = configEdgesToRelations(config.edges, selectionBus.get())
}

let workspacePostRenderEpoch = 0

/**
 * The shell half of the config-declared FRAGMENT regions (Surface
 * unification): when the ACTIVE graph's parsed WorkspaceConfig marks a region
 * `sh-layout-dashboard`, this controller loads each region's `ux:layoutJson`
 * fragment over THIS session's Editor-eligible cell RestClient and persists
 * divider settle points back to the fragment's own surface literal. Config
 * without the marker (or no live cell session) contributes nothing — the
 * option is simply absent and the workspace renders as always.
 */
const workspaceFragments = new WorkspaceFragmentsController({
  requestRender: () => rerenderCurrentSource(),
  onPersistError: (error, declaration) => {
    // The optimistic in-memory layout is NOT reverted (durability, not the
    // swap, is what a failed write loses) — but the failure is never silent.
    console.error(
      `workspace fragment persist failed for <${declaration.surfaceIri}> (region ${declaration.regionId}):`,
      error,
    )
  },
})

/**
 * P3b — the freshness governor's hosted attachment (ruling 3: "staleness:
 * CONFESS"). Page-level chrome, gated on the SAME condition that makes a
 * workspace an Observatory at all (`configDeclaresDashboardCenter`) — see
 * `observatory-freshness-attachment.ts`'s own header for the bounded lookup
 * that chose `hostEl` as the mount point. `sync()` is called from the SAME
 * seam as `workspaceFragments.optionsFor` below, on every render pass.
 */
const observatoryFreshnessAttachment = createObservatoryFreshnessAttachment({
  hostEl,
  stampEl: document.documentElement,
})

/**
 * The session's object service (MO object-face integration spec, master §3
 * Slice 2), constructed ONCE per session from `contract.rawMcp` — NOT
 * `contract.mcp` (the authority path exists specifically to bypass the
 * mirror; the wrapped client would route straight back into it). Memoized by
 * contract identity, mirroring `surfaceQueryService`'s own per-session
 * rotation without re-deriving it per render pass.
 */
let objectServiceFor: { readonly contract: OrganismCellContract; readonly service: ReturnType<typeof createSourceObjectService> } | null = null

function currentObjectService(contract: OrganismCellContract): ReturnType<typeof createSourceObjectService> {
  if (objectServiceFor?.contract !== contract) {
    objectServiceFor = {
      contract,
      service: createSourceObjectService({ runtime: contract.sourceMirror, caller: contract.rawMcp }),
    }
  }
  return objectServiceFor.service
}

function currentFragmentOptions(config: WorkspaceConfig): WorkspaceFragmentsOptions | null {
  const activeStore = store
  const session = activeStore && sourceSelect.value === 'CELL_LIVE'
    ? {
        rest: activeStore.contract.rest,
        graphId: currentGraphId,
        // `nt` is already the authoritative complete named-graph read. Use
        // exact content identity (not a clock or lossy hash) so unchanged
        // polls are free while any graph-authored source/config triple causes
        // its fragment to be reloaded and revalidated.
        configRevision: activeStore.getState().read?.nt,
        queryService: activeStore.contract.sourceMirror.surfaceQueryService(currentGraphId),
        objectService: currentObjectService(activeStore.contract),
        ...(hostedEvidenceService ? { evidenceService: hostedEvidenceService } : {}),
      }
    : null
  // Unawaited, before the fragment load kicks off below — the confession
  // paints before the panes.
  observatoryFreshnessAttachment.sync(config, session)
  return workspaceFragments.optionsFor(config, session)
}

/**
 * The contested centre route's options (master §3 Slice 5, WS2 §6.2) — the
 * SAME `queryService`/`objectService` seam `currentFragmentOptions` builds
 * (`surfaceQueryService`/`currentObjectService`), because an ordinary
 * contested route has no `fragments` to fall back to (master §2.8).
 * `undefined` when the route is closed OR there is no live cell to resolve
 * it through — `renderConfig` below never sets `RenderWorkspaceOptions.
 * contested` in that case, so the assembler's `opts.contested` branch is
 * simply never taken (closed route ⇒ no centre-route override, not a
 * broken one).
 */
function currentContestedOptions(): WorkspaceContestedOptions | undefined {
  if (!currentContestedSurface || currentContestedSurface.graphId !== currentGraphId) return undefined
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') return undefined
  return {
    graphId: currentGraphId,
    queryId: SYNC_QUERY.conflictsOpen,
    queryService: activeStore.contract.sourceMirror.surfaceQueryService(currentGraphId),
    objectService: currentObjectService(activeStore.contract),
    selection: currentContestedSurface.selection,
    onSelect: (detail: SubjectRowActivateDetail) => {
      currentContestedSurface = {
        graphId: currentGraphId,
        selection: contestedSelectionFrom(detail, activeMirrorBundle(), currentGraphId),
      }
      rerenderCurrentSource()
    },
    onClose: () => {
      currentContestedSurface = null
      rerenderCurrentSource()
    },
  }
}

// ── the resolution flow (master §3 Slice 6, WS2 §6.6-6.7) ──────────────────
//
// `sh-object-intent` (§2.6) bubbles+composed from `<sh-object-card-view>`
// through every mount it can appear at — the contested split's own card
// leaf, and any future drill-down door (WS1 §8.2's `cardObjectDescriptor`).
// ONE listener on `hostEl` (the same `WIRE_*` pattern every other
// bubbling-custom-event seam in this file already uses) therefore reaches
// it regardless of which leaf raised it, with no per-mount wiring needed.

/** `objectKey`'s wire form is `vocabclassobjectId` (garden
 *  `source_sync.rs:758-760`) — split locally for a plain human label in
 *  dialogs/menus, the SAME separator `contested-surface.ts` and
 *  `source-mirror.ts`'s own `buildResolveCurrentOperation` use. Falls back
 *  to the raw key if malformed (never thrown — this is copy, not a guard). */
const OBJECT_KEY_SEPARATOR = String.fromCharCode(0x1f)

function objectKeyPartsForLabel(objectKey: string): { readonly className: string; readonly objectId: string } | null {
  const parts = objectKey.split(OBJECT_KEY_SEPARATOR)
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null
  return { className: parts[1], objectId: parts[2] }
}

function objectLabelFromKey(objectKey: string): string {
  const parts = objectKeyPartsForLabel(objectKey)
  return parts ? `${parts.className} ${parts.objectId}` : objectKey
}

function objectClassNameFromKey(objectKey: string): string {
  return objectKeyPartsForLabel(objectKey)?.className ?? objectKey
}

interface ActiveResolutionMenu {
  readonly objectKey: string
  readonly conflictId: string
  readonly className: string
  readonly proposals: readonly ResolutionMenuProposal[]
}

/** Set only while `commandMenuEl` is showing a RESOLUTION menu (as opposed
 *  to its usual shell-command menu) — checked first by the shared
 *  `mn-select` listener so the two menu vocabularies never cross. */
let activeResolutionMenu: ActiveResolutionMenu | null = null

function menuProposalsFrom(intent: Extract<ObjectCardIntent, { kind: 'resolve' }>): readonly ResolutionMenuProposal[] {
  return intent.proposals.map(proposal => ({
    operationId: proposal.operationId,
    sourceVersion: proposal.sourceVersion,
    observer: proposal.observer ?? null,
    isProjectedHead: proposal.isProjectedHead,
    record: proposal.record,
  }))
}

function handleObjectResolveIntent(intent: Extract<ObjectCardIntent, { kind: 'resolve' }>): void {
  const proposals = menuProposalsFrom(intent)
  const input: ResolutionMenuInput = {
    objectKey: intent.objectKey,
    conflictId: intent.conflictId,
    proposals,
    composeAvailable: true,
    pendingResolution: currentSourceMirror?.resolving.includes(intent.conflictId) ?? false,
  }
  activeResolutionMenu = {
    objectKey: intent.objectKey,
    conflictId: intent.conflictId,
    className: objectClassNameFromKey(intent.objectKey),
    proposals,
  }
  commandMenuContext = null
  commandMenuEl.items = resolutionMenuModel(input)
  commandMenuEl.show(intent.anchor, 'top-left')
}

function runResolutionIntent(intent: ResolveCurrentIntent): Promise<void> {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') {
    return Promise.reject(new Error('SourceMirror: no live cell to resolve through'))
  }
  return activeStore.contract.sourceMirror.resolveCurrent(currentGraphId, intent).then(() => undefined)
}

/** The card's own DIRECT "Keep this one" per proposal (WS1 §6.5) — no menu,
 *  no dialog; the affordance IS the confirmation. */
function handleObjectKeepCandidateIntent(intent: Extract<ObjectCardIntent, { kind: 'keep-candidate' }>): void {
  runResolutionIntent({
    kind: 'keep',
    objectKey: intent.objectKey,
    conflictId: intent.conflictId,
    chosenOperationId: intent.chosenOperationId,
  }).then(() => {
    ok(`resolution: kept ${shortOperationId(intent.chosenOperationId)} · ${objectLabelFromKey(intent.objectKey)}`)
  }).catch((error: unknown) => {
    err(`resolution error:\n${error instanceof Error ? error.message : String(error)}`)
  })
}

function shortOperationId(operationId: string): string {
  return operationId.length <= 12 ? operationId : `${operationId.slice(0, 12)}…`
}

/** The menu-driven path (WS2 §6.6): both `keep:{id}` and `compose` land
 *  here, sharing the SAME "choose" dialog — `defaultChosenOperationId` is
 *  what "Keep this one" commits to if the user does not pivot to compose. */
function beginResolution(
  objectKey: string,
  conflictId: string,
  defaultChosenOperationId: string,
  className: string,
  proposals: readonly ResolutionMenuProposal[],
): void {
  const chosen = proposals.find(proposal => proposal.operationId === defaultChosenOperationId)
  void pickResolution({
    dialog: confirmationDialogEl,
    objectLabel: objectLabelFromKey(objectKey),
    proposalLabel: chosen?.observer ?? shortOperationId(defaultChosenOperationId),
    onKeep: () => runResolutionIntent({
      kind: 'keep',
      objectKey,
      conflictId,
      chosenOperationId: defaultChosenOperationId,
    }),
    onCompose: async () => {
      const record = await pickComposedRecord({
        dialog: confirmationDialogEl,
        objectLabel: objectLabelFromKey(objectKey),
        className,
        proposals,
      })
      if (record === null) return false
      await runResolutionIntent({ kind: 'compose', objectKey, conflictId, record })
      return true
    },
  }).then((choice) => {
    if (choice) ok(`resolution: ${choice} · ${objectLabelFromKey(objectKey)}`)
  }).catch((error: unknown) => {
    err(`resolution error:\n${error instanceof Error ? error.message : String(error)}`)
  })
}

function handleResolutionMenuSelect(menu: ActiveResolutionMenu, id: string): void {
  if (id === 'copy-key') {
    void navigator.clipboard?.writeText(menu.objectKey).then(
      () => ok('copied the object key'),
      () => err('SourceMirror: could not copy the object key to the clipboard'),
    )
    return
  }
  if (id === 'compose') {
    const head = menu.proposals.find(proposal => proposal.isProjectedHead) ?? menu.proposals[0]
    if (!head) return
    beginResolution(menu.objectKey, menu.conflictId, head.operationId, menu.className, menu.proposals)
    return
  }
  if (id.startsWith('keep:')) {
    beginResolution(menu.objectKey, menu.conflictId, id.slice('keep:'.length), menu.className, menu.proposals)
  }
}

/** Conflict ids this session has already shown the lost-race dialog for.
 *  Never re-shown for the SAME conflict: the `rejected-permanent` row is
 *  retained forever for provenance and never re-flushed (master §2.3), so
 *  without this a stale row would re-raise the dialog on every unrelated
 *  re-render. */
const lostRaceShownFor = new Set<string>()

/** Detects a newly-landed targeted `rejected-permanent` +
 *  `stale_sync_conflict` row for a `resolveCurrent` this client authored
 *  and shows the lost-race dialog exactly once per conflict (WS2 §6.6.1). */
function checkForLostResolutionRaces(): void {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') return
  const outbox = activeStore.contract.sourceMirror.manager(currentGraphId).outboxRecords()
  for (const record of outbox) {
    if (record.operation.kind !== 'resolveCurrent') continue
    if (record.status !== 'rejected-permanent' || record.errorCode !== 'stale_sync_conflict') continue
    const conflictId = typeof record.operation.conflictId === 'string' ? record.operation.conflictId : null
    if (!conflictId || lostRaceShownFor.has(conflictId)) continue
    lostRaceShownFor.add(conflictId)
    const objectKey = typeof record.operation.objectKey === 'string' ? record.operation.objectKey : ''
    void showLostRaceDialog({
      dialog: confirmationDialogEl,
      objectLabel: objectLabelFromKey(objectKey),
      // Authored fallback (used only when the outbox row itself carries no
      // testimony) — §7.1's terminology law binds this text because it is
      // NOT a verbatim authority quotation; "conflict" is banned here the
      // same way slice 6's `buildResolveCurrentOperation` refusal was
      // reworded (build-log.md, Slice 6 Divergence 3).
      testimony: record.error ?? "this proposal is no longer the live one for this object",
      onLookAgain: () => {
        currentContestedSurface = { graphId: currentGraphId, selection: { objectKey, conflictId } }
        rerenderCurrentSource()
      },
    })
  }
}

hostEl.addEventListener(OBJECT_INTENT_EVENT, ((event: CustomEvent<ObjectIntentDetail>) => {
  const intent = event.detail.intent
  if (intent.kind === 'resolve') {
    handleObjectResolveIntent(intent)
    return
  }
  if (intent.kind === 'keep-candidate') {
    handleObjectKeepCandidateIntent(intent)
    return
  }
  // 'inspect-candidate' — the card's own primary effect (toggling the
  // proposal's record open inline) is unconditional and already complete by
  // the time this event fires (WS1 C-D21); no host action is required.
}) as EventListener)

/** Render a config into the host and return a one-line provenance summary. */
function renderConfig(config: WorkspaceConfig, app: string | undefined): string {
  const claim = ensureEditorClaim()
  const centerPanesVisible = editorClaims.size > 0 || centerPanesController.state.secondary !== null
  const paneEditorHosts = centerPaneEditorHostOptions()
  const chat = ensureChatClaim()
  const tagLens = currentTagLens
  const zoteroSource = currentZoteroSourceSurface
  const artifactSurface = currentArtifactSurface
  const docHistorySurface = currentDocHistorySurface
  const inspectorInput = currentInspectorInput()
  const dailyNotes = sourceSelect.value === 'CELL_LIVE' ? dailyNoteRenderState() : null
  const mobileHome = sourceSelect.value === 'CELL_LIVE' ? currentHomeOptions() : null
  const home = dailyNotes?.showHomeRow ? mobileHome : null
  const fragments = currentFragmentOptions(config)
  const contested = currentContestedOptions()
  const parkedWork = currentParkedWorkOptions()
  const shellContext = currentShellContext()
  const filePaneState = filePaneController.snapshot(currentGraphId)
  const filePaneLive = sourceSelect.value === 'CELL_LIVE' && store !== null
  const featureWorkspaceSnapshot = shellFeatureHost.workspaceSnapshot(shellContext, {
    app,
    ...(fragments ? { fragments } : {}),
    ...(contested ? { contested } : {}),
    ...(parkedWork ? { parkedWork } : {}),
    leftCollapsed: currentPanelLayout.leftCollapsed,
    rightCollapsed: currentPanelLayout.rightCollapsed || currentRightPanel === 'none',
    panelLayout: {
      leftWidth: currentPanelLayout.leftPanelWidth,
      rightWidth: currentPanelLayout.rightPanelWidth,
      leftExpanded: currentPanelLayout.leftExpanded,
      leftSnap: LEFT_PANEL_SNAP,
      rightSnap: RIGHT_PANEL_SNAP,
      snapThreshold: PANEL_SNAP_THRESHOLD_PX,
      onReposition: handlePanelReposition,
      onLeftExpandedChange: handleLeftExpandedChange,
      onLeftCollapsedChange: handleLeftCollapsedChange,
      onRightCollapsedChange: handleRightCollapsedChange,
    },
    chrome: {
      activeApp: app ?? 'garden',
      leftPanelMode: currentLeftPanelMode,
      rightPanel: currentRightPanel,
      isDark: currentTheme === 'dark',
      activeSkin: currentSkin,
      // The honest mirror state's bottom-bar projection (master §3 Slice 4).
      // Off CELL_LIVE there is no mirror at all — `null` keeps the legacy
      // inert slot rather than a fabricated "unknown" badge for a source
      // that was never going to have one.
      sourceStatus: sourceSelect.value === 'CELL_LIVE' ? sourceStatusModel(currentSourceMirror) : null,
      quickClip: {
        available: sourceSelect.value === 'CELL_LIVE' && store !== null,
        status: quickClipStatus,
        error: quickClipError,
        onRequest: detail => { void handleQuickClipRequest(detail) },
        onReset: () => resetQuickClip(),
        onOpenChange: (open: boolean) => handleQuickClipOpenChange(open),
      },
      ...(deploymentConfig.mode === 'hosted' ? {
        workspaces: workspaceSummaries(),
        workspaceStatus: hostedGraphsStatus,
        workspaceError: hostedGraphsError,
        activeWorkspaceId: currentGraphId,
        workspaceBusyId: hostedWorkspaceBusyId,
        onWorkspaceRefresh: () => { void refreshHostedGraphs() },
        onWorkspaceSelect: (workspace: WorkspaceSummary) => { void switchHostedWorkspace(workspace.graphId) },
        onWorkspaceCreate: () => { void createHostedWorkspace() },
        onWorkspaceDelete: (workspace: WorkspaceSummary) => { void deleteHostedWorkspace(workspace) },
      } : {}),
    },
    sidebar: {
      sections: currentSidebarSections,
      searchQuery: currentSidebarSearchQuery,
      activeId: openDocId,
      selectedId: currentSidebarSelectedId ?? openDocId,
      selectedIds: filePaneState.selectedIds.length > 0 ? filePaneState.selectedIds : null,
      presentation: currentPanelLayout.leftExpanded ? 'columns' : 'tree',
      sort: filePaneState.sort,
      grouping: filePaneState.grouping,
      columnPaths: filePaneState.columnPaths,
      status: sourceSelect.value === 'CELL_LIVE' ? currentSidebarStatus : 'ready',
      error: currentSidebarError,
      operation: currentMobileFileOperation?.graphId === currentGraphId
        ? currentMobileFileOperation
        : null,
      capabilities: {
        createDocument: filePaneLive,
        upload: filePaneLive,
        createFolder: filePaneLive,
        refresh: sourceSelect.value === 'CELL_LIVE',
        sort: true,
        group: true,
        multiSelect: true,
        dragDrop: filePaneLive,
        contextMenu: filePaneLive,
      },
      onSearchChange: ({ query }) => {
        currentSidebarSearchQuery = query
        rerenderCurrentSource()
      },
      onSelectionChange: (detail: FilePaneSelectionDetail) => {
        filePaneController.setSelection(currentGraphId, detail)
        currentSidebarSelectedId = detail.ids.at(-1) ?? null
        rerenderCurrentSource()
      },
      onSortChange: (detail: FilePaneSortChangeDetail) => {
        filePaneController.setSort(currentGraphId, detail.sort)
        rerenderCurrentSource()
      },
      onGroupingChange: (detail: FilePaneGroupingChangeDetail) => {
        filePaneController.setGrouping(currentGraphId, detail.grouping)
        rerenderCurrentSource()
      },
      onColumnPathChange: (detail: FilePaneColumnPathChangeDetail) => {
        filePaneController.setColumnPath(currentGraphId, detail)
        rerenderCurrentSource()
      },
      onNodeIntent: (detail: SidebarNodeDetail) => {
        if ((detail.node.kind ?? 'document') !== 'document') return
        prepareDocumentIntent(currentGraphId, detail.id, 'intent', 125)
      },
      onNodeIntentEnd: (detail: SidebarNodeDetail) => {
        if ((detail.node.kind ?? 'document') !== 'document') return
        cancelDocumentIntent(currentGraphId, detail.id)
      },
      onNodeOpen: handleSidebarNodeOpen,
      onNodeToggle: handleSidebarNodeToggle,
      onNodeDrop: handleSidebarNodeDrop,
      onAction: handleSidebarAction,
      onFileDrop: (files: FileList) => { void handleSidebarFileDrop(files) },
      onOperationRecovery: detail => { void recoverMobileFileOperation(detail) },
    },
    ...(dailyNotes ? { dailyNotes } : {}),
    ...(home ? { home } : {}),
    ...(mobileHome ? { mobileHome } : {}),
    comments: {
      comments: currentDocumentComments(),
      hoveredCommentId: currentHoveredCommentId,
      onSelect: handleCommentSelect,
      onHover: handleCommentHover,
      onEdit: handleCommentEdit,
      onResolve: handleCommentResolve,
      onDelete: handleCommentDelete,
    },
    inspector: {
      model: projectInspectorModel(inspectorInput),
      actions: projectInspectorActions(inspectorInput),
      onClose: () => setRightPanel('none', 'inspector close'),
      onAction: handleInspectorAction,
      onRelationOpen: handleInspectorRelationOpen,
    },
    graphPanel: currentGraphPanelOptions(),
    outlinePanel: currentOutlinePanelOptions(),
    ...(docHistorySurface
      ? {
          docHistory: {
            title: 'Version History',
            subtitle: docHistorySurface.totalCount === null
              ? `${docHistorySurface.graphId} / ${docHistorySurface.documentId}`
              : `${docHistorySurface.totalCount} captured snapshots for ${docHistorySurface.documentId}`,
            status: docHistorySurface.status,
            error: docHistorySurface.error ?? null,
            snapshots: docHistorySurface.snapshots,
            olderId: docHistorySurface.olderId,
            newerId: docHistorySurface.newerId,
            focusedSide: docHistorySurface.focusedSide,
            olderText: docHistorySurface.olderText,
            newerText: docHistorySurface.newerText,
            diffStatus: docHistorySurface.diffStatus,
            diffError: docHistorySurface.diffError ?? null,
            diffStyle: docHistorySurface.diffStyle,
            restoreDisabled: docHistorySurface.restoreBusy,
            onCursorChange: handleDocHistoryCursorChange,
            onSaveCurrent: handleDocHistorySaveCurrent,
            onBookmark: handleDocHistoryBookmark,
            onDelete: handleDocHistoryDelete,
            onRestore: handleDocHistoryRestore,
            onRefresh: handleDocHistoryRefresh,
            onClose: clearDocHistoryState,
            onDiffStyleChange: handleDocHistoryDiffStyleChange,
          },
        }
      : {}),
    wirePinnedDocs: currentPinnedWireDocs,
    wirePinnedNodes: currentPinnedWireNodes,
    wirePinnedBlocks: currentPinnedWireBlocks,
    wirePinnedBlockContexts: currentPinnedWireBlockContexts,
    wirePinnedNodeContexts: currentPinnedWireNodeContexts,
    ...(tagLens
      ? {
          tagLens: {
            tagName: tagLens.tagName,
            status: tagLens.status,
            blocks: tagLens.blocks,
            error: tagLens.error ?? null,
            onRefresh: ({ tagName }) => {
              void refreshTagLens(tagName)
            },
            onOpenBlock: handleTagLensOpenBlock,
          },
        }
      : {}),
    ...(zoteroSource
      ? {
          zoteroSource: {
            artifactId: zoteroSource.artifactId,
            zoteroKey: zoteroSource.zoteroKey,
            graphId: zoteroSource.graphId,
            item: zoteroSource.item,
            annotations: zoteroSource.annotations,
            incomingWires: zoteroSource.incomingWires,
            promotedAnnotationKeys: zoteroSource.promotedAnnotationKeys,
            loading: zoteroSource.status === 'loading',
            error: zoteroSource.error ?? null,
            onReload: (detail: ZoteroSourceBaseDetail) => {
              void refreshZoteroSource(detail)
            },
            onOpenZotero: handleZoteroSourceOpenZotero,
            onOpenTag: (detail: ZoteroSourceOpenTagDetail) => {
              void handleZoteroSourceOpenTag(detail)
            },
            onOpenDocument: handleZoteroSourceOpenDocument,
            onPromoteAnnotation: (detail: ZoteroSourcePromoteAnnotationDetail) => {
              void handleZoteroSourcePromote(detail)
            },
          },
        }
      : {}),
    ...(artifactSurface
      ? {
          artifact: {
            graphId: artifactSurface.graphId,
            artifactId: artifactSurface.artifactId,
            title: artifactSurface.title,
            mimeType: artifactSurface.mimeType,
            fileType: artifactSurface.fileType,
            artifactStatus: artifactSurface.artifactStatus,
            ingestedDocumentId: artifactSurface.ingestedDocumentId,
            previewUrl: artifactSurface.previewUrl,
            status: artifactSurface.status,
            error: artifactSurface.error ?? null,
            onRefresh: refreshArtifactPreview,
            onHistoryOpen: handleArtifactHistoryOpen,
            onEditOpen: handleArtifactEditOpen,
            onDownload: handleArtifactDownload,
            onOpenDocument: handleArtifactOpenDocument,
            editor: artifactSurface.editorOpen
              ? {
                  open: true,
                  srcUrl: artifactSurface.previewUrl,
                  mimeType: artifactSurface.mimeType,
                  prompt: artifactSurface.editorPrompt,
                  generationTarget: artifactSurface.editorGenerationTarget,
                  generating: artifactSurface.editorGenerating,
                  generationError: artifactSurface.editorGenerationError ?? null,
                  onCancel: handleArtifactEditorCancel,
                  onSave: (detail: ArtifactEditorSaveDetail) => {
                    void handleArtifactEditorSave(detail)
                  },
                  onGenerate: handleArtifactEditorGenerate,
                }
              : null,
            history: artifactSurface.historyOpen
              ? {
                  graphId: artifactSurface.graphId,
                  artifactId: artifactSurface.artifactId,
                  status: artifactSurface.historyStatus,
                  error: artifactSurface.historyError ?? null,
                  revisions: artifactSurface.historyRevisions,
                  restoringRevisionId: artifactSurface.historyRestoringRevisionId,
                  onClose: handleArtifactHistoryClose,
                  onRefresh: handleArtifactHistoryRefresh,
                  onRestore: (detail: ArtifactHistoryRevisionDetail) => {
                    void handleArtifactHistoryRestore(detail)
                  },
                }
              : null,
          },
        }
      : {}),
    // Pane layout/history is session-owned; each visible document gets one stable
    // provider claim while picker/comments/wire ownership follows only the active pane.
    ...(centerPanesVisible
      ? {
          centerPanes: {
            projection: centerPanesController.projection,
            editorHosts: paneEditorHosts,
            onOpen: handleCenterPaneOpen,
            onFocus: handleCenterPaneFocus,
            onClose: handleCenterPaneClose,
            onNavigate: handleCenterPaneNavigate,
            onResize: handleCenterPaneResize,
          },
        }
      : {}),
    ...(claim
      ? {
          editorWireBundle: currentWireBundle,
          editorSalienceBundle: currentSalienceBundle,
          wirePanelContexts: currentWireContexts,
          wirePanelLocalContext: {
            graphId: claim.graphId,
            documentId: claim.documentId,
            title: centerPaneById(claim.paneId)?.current.title ?? claim.documentId,
          },
        }
      : {}),
    ...(chat
      ? {
          chatHost: {
            service: chat.service,
            sessionId: chat.sessionId,
            presentation: chatPresentation,
            composerReferenceResolver: resolveChatWikiLinks,
            onSurfaceAction: handleChatSurfaceAction,
            onHeaderAction: handleChatHeaderAction,
          },
        }
      : {}),
  })
  const salienceAccess = currentSalienceWriteAccess()
  const coreWorkspaceSnapshot: RenderWorkspaceOptions = openDocId
    ? {
        ...featureWorkspaceSnapshot,
        editorDocumentAccess: {
          ...(featureWorkspaceSnapshot.editorDocumentAccess ?? { readOnly: false }),
          salienceWritable: salienceAccess.writable,
          salienceWriteReason: salienceAccess.reason,
        },
      }
    : featureWorkspaceSnapshot
  const workspaceSnapshot = mobileShellFeatureHost.workspaceSnapshot(
    shellContext,
    coreWorkspaceSnapshot,
  )
  // Lit intentionally preserves unmanaged siblings in its render container.
  // Retire the static pre-module boot shell before the first managed frame so
  // it cannot remain stacked above the live Surface workspace. Same for a
  // lingering error panel from a failed earlier load (same unmanaged-sibling
  // rule) — a successful render supersedes it.
  hostEl.querySelector(':scope > .boot-placeholder')?.remove()
  clearCellErrorPanel(hostEl)
  renderWorkspace(config, { container: hostEl, ...workspaceSnapshot, surface: true })
  // Install the config's selection edges over the real faces + bus, right after
  // the render host builds the panes. Idempotent on reload (disposer runs first).
  installSelectionEdges(config)
  // Mirror the SAME edges into the opt-in dev overlay (behavior vs diagram).
  updateEdgeOverlay(config)
  // A fresh render replaces the chrome — re-apply the controlled skin/theme
  // pressed-state props so the toggles reflect the live [data-skin]/[data-theme].
  reflectChromeState()
  const postRenderEpoch = ++workspacePostRenderEpoch
  void workspaceSurfaceReady(hostEl).then(() => {
    if (postRenderEpoch !== workspacePostRenderEpoch) return
    void syncCurrentExcalidrawRuntime()
    labelInertPlaceholders()
    reflectChromeState()
    shellFeatureHost.afterWorkspaceRender(shellContext, workspaceSnapshot)
    mobileShellFeatureHost.afterWorkspaceRender(shellContext, workspaceSnapshot)
    visualViewportFrameController.refresh()
  })
  schedulePendingZoteroPromotionDrain()
  const regionCount = Object.keys(config.regions).length
  const panelCount = Object.keys(config.panels).length
  const chrome = Array.from(hostEl.querySelectorAll('*'))
    .filter(el => el.tagName.includes('-') && customElements.get(el.tagName.toLowerCase()))
    .map(el => el.tagName.toLowerCase())
  return (
    `config "${config.id}" · regions: ${regionCount} · panels: ${panelCount} · app: ${app ?? '(default)'}\n` +
    `upgraded chrome: ${chrome.length ? [...new Set(chrome)].join(', ') : '(none)'}`
  )
}

// ── Mode A: textarea N-Triples → config → render host → DOM ───────────────────
function renderFromEditor(): void {
  const nt = editor.value
  const app = currentApp
  let config: WorkspaceConfig
  try {
    const triples = parseNT(nt)
    config = parseTriplesToConfig(triples)
  } catch (e) {
    err(`parse error (shell left as-is, no faked data):\n${e instanceof Error ? e.message : String(e)}`)
    return
  }
  try {
    const summary = renderConfig(config, app)
    ok(`parsed ${parseNT(nt).length} triples →\n${summary}`)
  } catch (e) {
    err(`render error:\n${e instanceof Error ? e.message : String(e)}`)
  }
}

function loadPreset(name: string): void {
  const make = PRESETS[name]
  if (!make) return
  editor.value = make()
  renderFromEditor()
}

function rerenderCurrentSource(): void {
  reflectWorkspaceLifetimeAndReapply()
  if (sourceSelect.value === 'CELL_LIVE') {
    if (store) renderCellState(store.getState(), configStore?.get())
  } else if (sourceSelect.value === 'EMPORIUM_LIVE') {
    if (emporium) renderEmporiumState(emporium.getState())
  } else {
    renderFromEditor()
  }
}

// ── Mode B: gardend cell (live) — read :ux:config through the contract ─────────
//
// Browser transport = the SAME-ORIGIN Vite proxy at /cell (see vite.config.ts).
// The proxy injects the bearer + targets the random loopback port SERVER-SIDE,
// so the token/port NEVER appear in browser JS. We pass NO token here.
let store: OrganismSessionStore | null = null
let configStore: ShrubberyStore<WorkspaceConfig> | null = null
let stopPoll: (() => void) | null = null
let stopStoreSubscription: (() => void) | null = null
let stopSourceMirrorSubscription: (() => void) | null = null

// ── the honest mirror state (master spec §2.1, §2.17, §3 Slice 3) ──────────
//
// The mirror publishes on every outbox write (source-mirror.ts's `publish`)
// plus every open/pull/flush — `applySourceMirrorState` is the ONE writer of
// this shell state and the throttling boundary: chrome re-renders (later
// slices) on any change, the sidebar re-queries only when a document-plane
// truth actually moved.
let currentSourceMirror: SourceMirrorState | null = null
/**
 * `${documentId}:${status}` per DOCUMENT-BEARING outbox row, sorted, joined
 * — captured and STORED at publish time (master §2.17's fix: the version
 * this replaces read the CURRENT live manager on both sides of the `!==`
 * comparison, comparing a value to itself, which can never be true). Reset
 * to `''` everywhere `currentSourceMirror` resets to `null` — otherwise the
 * first publish for a new graph could coincidentally match the previous
 * graph's signature and skip the refresh that populates the sidebar.
 */
let currentDocumentOutboxSignature = ''

/**
 * The contested centre route's OWN state (master §3 Slice 5, WS2 §6.2) —
 * `null` when the route is closed. Deferred by Slice 3 ("for Slice 5's own
 * agent to add that branch when it builds `currentContestedSurface`") and
 * built here.
 */
let currentContestedSurface: ContestedSurfaceState | null = null

/**
 * The parked-work face's own LOADED projection (master §3 Slice 8, WS3
 * §5.4) — refreshed independently of whether the route is currently open
 * (the sidebar's "Parked work" section reads it too). `null` off CELL_LIVE
 * or before the first load for this graph.
 */
let currentParkedWork: ParkedWorkModel | null = null

/**
 * The parked-work centre route's OWN open/closed state — mirrors the
 * `currentContestedSurface`/`currentContestedOptions()` split (master
 * §2.9): the MODEL (`currentParkedWork`) and whether the ROUTE is showing
 * it are independent axes. `null` when the route is closed.
 */
let currentParkedWorkRoute: { readonly graphId: string; readonly focusRecoveryKey: string | null } | null = null

/**
 * master §3 Slice 9. The reapply pipeline's own driver + its live view,
 * mirroring the `currentContestedSurface`/`currentParkedWork` split: the
 * CONTROLLER is per-graph (bound to one `runtime`/`activation`/`userId`/
 * `graphId` at construction) and rebuilt whenever the active graph
 * changes; the VIEW is what `<mn-restore-overlay>` renders, pushed by the
 * controller's own `onView`. `currentReapplyContestedHandoffs` is the
 * handoff to workstream 2 (03 §7.6) held just long enough for the
 * overlay's own primary dismiss action to open the contested surface —
 * `<mn-restore-overlay>` renders `.message` as plain text (RA-8's own
 * copy already NAMES the count; it is not itself a clickable HO-2 link).
 */
let currentReapplyController: ReapplyController | null = null
let currentReapplyControllerGraphId: string | null = null
let currentReapplyView: ReapplyView | null = null
let currentReapplyOutcome: ReapplyOutcome | null = null
let currentReapplyContestedHandoffs: readonly ContestedHandoff[] = []

/** (Re)builds the reapply controller for `graphId`, disposing any prior
 *  one bound to a DIFFERENT graph — `ReapplyController` binds its runtime/
 *  activation/userId/graphId once at construction (03 §7.2). `null` off
 *  CELL_LIVE, matching every other per-graph accessor in this file. */
function reapplyControllerFor(graphId: string): ReapplyController | null {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') return null
  if (currentReapplyController && currentReapplyControllerGraphId === graphId) return currentReapplyController
  currentReapplyController?.dispose()
  currentReapplyController = new ReapplyController({
    runtime: activeStore.contract.sourceMirror,
    activation: activeStore.contract.documentActivation,
    userId: activeStore.contract.auth.userId(),
    graphId,
    graphTitle: currentGraphTitle() || graphId,
    onView: (view) => {
      currentReapplyView = view
      rerenderCurrentSource()
    },
    onContested: (handoffs) => {
      currentReapplyContestedHandoffs = handoffs
    },
  })
  currentReapplyControllerGraphId = graphId
  return currentReapplyController
}

/**
 * RA-12/RA-13 (03 §9) — both `<mn-restore-overlay>` terminal events
 * converge here (`app-routes.ts`'s own `reapplyOverlayTemplate` binds
 * both `mn-restore-overlay-reload` and `-dismiss` to one `onPrimary`,
 * since the component already routes the correct SEMANTIC meaning
 * through which event it emits per `operationState`). On `succeeded`,
 * "Open {graphTitle}" leaves the parked-work route — landing directly on
 * the contested surface if the run produced any `ContestedHandoff`
 * (HO-1's own copy: "Open them to settle"), otherwise just closing it.
 * On `failed`/`rolled_back`, "Back to parked work" leaves the route open.
 */
function handleReapplyPrimary(): void {
  const succeeded = currentReapplyOutcome?.stage === 'succeeded'
  currentReapplyView = null
  if (succeeded) {
    const handoffs = currentReapplyContestedHandoffs
    currentReapplyContestedHandoffs = []
    currentParkedWorkRoute = null
    const first = handoffs[0]
    // A real `outcome:'conflict'` always names a `conflictId` (garden's own
    // `stable_outcome`, `source_sync.rs:1414-1420`); `null` is the
    // defensive branch of the TYPE, not an expected runtime case.
    if (first && first.conflictId !== null) {
      currentContestedSurface = {
        graphId: currentGraphId,
        selection: { objectKey: first.objectKey, conflictId: first.conflictId },
      }
    }
  }
  rerenderCurrentSource()
}

/** RA-12b — the secondary action on `succeeded` only ("Back to parked
 *  work" beside "Open {graphTitle}"): dismiss the overlay, stay put. */
function handleReapplySecondary(): void {
  currentReapplyView = null
  rerenderCurrentSource()
}

/** The reapply overlay's real props (master §3 Slice 9, WS3 §9's copy
 *  deck) — RA-12/RA-12b/RA-13 need the live `graphTitle`, which
 *  `app-routes.ts` does not otherwise carry. */
function currentReapplyOptions(): {
  readonly view: ReapplyView | null
  readonly primaryLabel: string
  readonly secondaryLabel: string
  readonly onPrimary: () => void
  readonly onSecondary: () => void
} {
  const stage = currentReapplyView?.stage
  const graphTitle = currentGraphTitle() || currentGraphId
  return {
    view: currentReapplyView,
    primaryLabel: stage === 'succeeded'
      ? `Open ${graphTitle}`
      : stage === 'failed' || stage === 'rolled_back'
        ? 'Back to parked work'
        : '',
    secondaryLabel: stage === 'succeeded' ? 'Back to parked work' : '',
    onPrimary: handleReapplyPrimary,
    onSecondary: handleReapplySecondary,
  }
}

/**
 * Mounts the ordinary per-graph workspace's OWN lifetime banner + reapply
 * overlay (bundle audit findings 2/3, 2026-07-31) — the same fix
 * `organismAppRouteOptions()` already applies for app-route frames, routed
 * through the identical `lifetimeBannerTemplate`/`reapplyOverlayTemplate`
 * (`app-routes.ts`), into the two shell-owned slots flanking `#host` in
 * `index.html`'s `.shell-pane`. `render-workspace.ts` itself stays
 * untouched — its own doc comment disclaims owning any banner/overlay
 * stack, so this is a shell-owned layer BOTH frames share, not a change to
 * that island's contract.
 *
 * Called from `rerenderCurrentSource()` — the one funnel every mirror-fence
 * publish (`applySourceMirrorState`) and every reapply-view push
 * (`reapplyControllerFor`'s `onView`) already routes through — so a fence
 * raised from CELL_LIVE and a reapply run started from the real
 * `parked-work` face's row action both reach these slots for real, with no
 * new trigger wiring of their own. Unconditional exactly like
 * `organismAppRouteOptions()`'s own `lifetime`/`reapply` reads: off
 * CELL_LIVE both compute to an inert state (`lifetimeBannerStateFor()`
 * returns `null` without a live `currentSourceMirror`), so the slots simply
 * render nothing outside a live graph, the same as before this fix.
 */
function reflectWorkspaceLifetimeAndReapply(): void {
  // While Settings owns the route frame, its mount is the single banner /
  // overlay owner. A background publish may still enter the normal rerender
  // funnel, so enforce the hand-off here too rather than relying only on the
  // transition's opening edge.
  if (settingsOverlayTransition.isOpen) {
    clearWorkspaceLifetimeAndReapply()
    return
  }
  litRender(
    lifetimeBannerTemplate({
      state: lifetimeBannerStateFor(),
      onAdopt: handleLifetimeAdopt,
      onViewParked: handleLifetimeViewParked,
    }),
    workspaceLifetimeBannerSlot,
  )
  litRender(reapplyOverlayTemplate(currentReapplyOptions()), workspaceReapplyOverlaySlot)
}

/** Remove the ordinary workspace's transient chrome while a route frame owns it. */
function clearWorkspaceLifetimeAndReapply(): void {
  litRender(null, workspaceLifetimeBannerSlot)
  litRender(null, workspaceReapplyOverlaySlot)
}

/** The current graph's resident bundle, or `undefined` off CELL_LIVE, before
 *  the first pull, or when the graph is fenced/unusable — the SAME rule
 *  `bundleFor` already applies (`source-mirror-runtime.ts`). Shared by
 *  `contestedSelectionFrom`'s join and `reconcileContestedSelection`'s
 *  per-epoch re-check — one accessor, not two independent reads. */
function activeMirrorBundle(): SourceBundle | undefined {
  return store?.contract.sourceMirror.bundleFor(currentGraphId)
}

/** The current graph's live outbox rows, or `[]` off CELL_LIVE or before the
 *  first pull. Shared by `documentOutboxSignature` and the sidebar's
 *  pending/parked decoration (master §3 Slice 4) — one accessor, not two
 *  independent reads of the same manager. */
function currentSourceOutboxRecords(): readonly SourceOutboxRecord[] {
  return store?.contract.sourceMirror.manager(currentGraphId).outboxRecords() ?? []
}

function documentOutboxSignature(): string {
  return currentSourceOutboxRecords()
    .flatMap((row) => {
      const id = documentIdOf(row.operation)
      return id === null ? [] : [`${id}:${row.status}`]
    })
    .sort()
    .join('|')
}

/** The ONLY writer of shell source-mirror state (master §4.2's seam). */
function applySourceMirrorState(state: SourceMirrorState): void {
  const previous = currentSourceMirror
  const previousSignature = currentDocumentOutboxSignature
  const signature = documentOutboxSignature()
  currentSourceMirror = state
  currentDocumentOutboxSignature = signature
  // A new epoch re-folds every conflict (Garden `fold_current_objects`). A
  // selection whose `conflictId` is gone must not keep the card wearing a
  // stance for a disagreement that no longer exists in this local copy.
  if (currentContestedSurface && state.epoch !== previous?.epoch) {
    currentContestedSurface = reconcileContestedSelection(currentContestedSurface, activeMirrorBundle())
  }
  // master §3 Slice 6, WS2 §6.6.1 — shown at most once per conflictId; a
  // cheap outbox scan on every publish, the same cost class as
  // `documentOutboxSignature()` above.
  checkForLostResolutionRaces()
  rerenderCurrentSource()
  if (sourceMirrorRefreshDecision(previous, previousSignature, state, signature)) {
    void refreshSidebarSections()
  }
  // master §3 Slice 8, WS3 §5.4 — "whenever state.fenced or state.parked
  // changes, and on activation" (the latter is `startCellMode`'s own call).
  // Strengthened beyond the literal text to include `nonDocumentParked`:
  // graph-scoped loose operations feed the SAME model's `looseOperations`,
  // and under-refreshing them would leave that list stale.
  if (
    previous === null
    || previous.fenced !== state.fenced
    || previous.parked !== state.parked
    || previous.nonDocumentParked !== state.nonDocumentParked
  ) {
    void refreshParkedWork(currentGraphId)
  }
}

function currentDocumentActivation(): {
  readonly manager: DocumentActivationManager
  readonly contract: OrganismCellContract
} | null {
  const contract = store?.contract ?? deploymentContract
  return contract ? { manager: contract.documentActivation, contract } : null
}

/**
 * Composes the parked-work model for the CURRENTLY ACTIVE graph (master §3
 * Slice 8, WS3 §5.4) — the only place that holds both the
 * `SourceMirrorRuntime` and the `DocumentActivationManager`.
 */
async function refreshParkedWork(graphId: string): Promise<void> {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') {
    if (currentParkedWork !== null) {
      currentParkedWork = null
      void refreshSidebarSections()
    }
    return
  }
  const model = await loadParkedWork({
    userId: activeStore.contract.auth.userId(),
    graphId,
    graphTitle: currentGraphTitle() || graphId,
    recoveries: userId => activeStore.contract.documentActivation.userRecoveries(userId),
    operations: () => activeStore.contract.sourceMirror.parkedOperations(graphId),
    mirror: activeStore.contract.sourceMirror.manager(graphId).get(),
    titleFor: documentId => sidebarNodeById(documentId)?.label ?? null,
    documentExists: documentId => sidebarNodeById(documentId) !== null,
  })
  if (store !== activeStore || currentGraphId !== graphId || sourceSelect.value !== 'CELL_LIVE') return
  currentParkedWork = model
  rerenderCurrentSource()
  void refreshSidebarSections()
}

/**
 * The parked-work centre route's options (master §3 Slice 8, WS3 §5.2) —
 * mirrors `currentContestedOptions()`'s split (master §2.9): `undefined`
 * when the route is closed for THIS graph OR the model has not loaded for
 * it yet, so the assembler's `opts.parkedWork` branch is simply never
 * taken rather than rendering a stale or mismatched graph's rows.
 */
function currentParkedWorkOptions(): ParkedWorkOptions | undefined {
  if (!currentParkedWorkRoute || currentParkedWorkRoute.graphId !== currentGraphId) return undefined
  if (!currentParkedWork || currentParkedWork.graphId !== currentGraphId) return undefined
  return {
    graphId: currentGraphId,
    model: currentParkedWork,
    focusRecoveryKey: currentParkedWorkRoute.focusRecoveryKey,
    onView: recoveryKey => {
      currentParkedWorkRoute = { graphId: currentGraphId, focusRecoveryKey: recoveryKey }
      rerenderCurrentSource()
    },
    onExport: recoveryKey => { void handleParkedWorkExport(recoveryKey) },
    onReapply: (recoveryKeys) => {
      const controller = reapplyControllerFor(currentGraphId)
      if (!controller) {
        err('SourceMirror: open a CELL_LIVE source first.')
        return
      }
      void controller.run(recoveryKeys).then((outcome) => {
        currentReapplyOutcome = outcome
        void refreshParkedWork(currentGraphId)
      })
    },
    onClose: () => {
      currentParkedWorkRoute = null
      rerenderCurrentSource()
    },
  }
}

/** Opens the parked-work centre route for `graphId`, closing the contested
 *  route if it happened to be open (master §2.9 — mutually exclusive). */
function openParkedWorkRoute(graphId: string, focusRecoveryKey: string | null): void {
  currentContestedSurface = null
  currentParkedWorkRoute = { graphId, focusRecoveryKey }
  rerenderCurrentSource()
}

/** Opens the contested centre route for `graphId` with no row focused yet —
 *  the mirror of `openParkedWorkRoute` above (master §2.9 — mutually
 *  exclusive), and the destination the bottom bar's contested badge now
 *  opens (build bundle review finding 4, 2026-07-31). `currentContestedOptions()`
 *  only takes effect off `store`/`CELL_LIVE`; off those, setting this state
 *  is inert until a live source is reopened, the same fail-quiet shape
 *  `openParkedWorkRoute`'s own `currentParkedWorkOptions()` already has. */
function openContestedRoute(graphId: string): void {
  currentParkedWorkRoute = null
  currentContestedSurface = { graphId, selection: null }
  rerenderCurrentSource()
}

/** master §3 Slice 8, WS3 §6.5. `recoveryKey: null` exports the whole
 *  graph's parked work (PW-19); the JSON round-trips through a real
 *  `Y.applyUpdate` (verified by `parked-work.test.ts`). */
async function handleParkedWorkExport(recoveryKey: string | null): Promise<void> {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') {
    err('SourceMirror: open a CELL_LIVE source first.')
    return
  }
  const graphId = currentGraphId
  try {
    const [documents, operations] = await Promise.all([
      activeStore.contract.documentActivation.userRecoveries(activeStore.contract.auth.userId())
        .then(records => records.filter(record => record.graphId === graphId)),
      Promise.resolve(activeStore.contract.sourceMirror.parkedOperations(graphId)),
    ])
    const mirror = activeStore.contract.sourceMirror.manager(graphId).get()
    const payload = await exportParkedWork(
      {
        userId: activeStore.contract.auth.userId(),
        graphId,
        graphTitle: currentGraphTitle() || graphId,
        previousGraphIncarnation: mirror.graphIncarnation ?? '',
        fenceTestimony: mirror.fenceTestimony,
        schemaVersion: documents[0]?.schemaVersion ?? 1,
      },
      documents,
      operations,
      recoveryKey,
      documentId => sidebarNodeById(documentId)?.label ?? null,
    )
    const previousLife8 = (mirror.graphIncarnation ?? '').slice(0, 8)
    const documentId = recoveryKey === null
      ? null
      : documents.find(record => record.key === recoveryKey)?.documentId ?? null
    const filename = parkedExportFilename(graphId, previousLife8, documentId)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    saveBlob(blob, filename)
    ok(`parked work exported: ${filename}`)
  } catch (error) {
    err(`parked work export error:\n${error instanceof Error ? error.message : String(error)}`)
  }
}

/** True while an `adoptNewLife()` call is in flight — both banner actions
 *  go inert (master §3 Slice 7). Read fresh by `lifetimeBannerStateFor()`
 *  on every `organismAppRouteOptions()` call, which is every route mount. */
let lifetimeAdoptionBusy = false

function activeSourceMirrorRuntime(): OrganismCellContract['sourceMirror'] | null {
  return (store?.contract ?? deploymentContract)?.sourceMirror ?? null
}

/**
 * Compose the fence banner's state for the CURRENTLY ACTIVE graph (master
 * §3 Slice 7, WS3 §5.1's mirror-phase trigger — `state.fenced` is the ONE
 * source of fence truth per master §2.1/C-D18). `currentSourceMirror` is
 * bound to `currentGraphId` by `applySourceMirrorState`'s own contract (the
 * subscription at `:7582-7587` filters on `changedGraphId === graphId`
 * before ever calling it), so reading both together here is safe.
 *
 * The graph-lifecycle-intent trigger (a local `create`/`delete` intent that
 * lost its own race — WS3 §5.1's second trigger, "graph-name-taken" /
 * "graph-already-gone") is DEFERRED: master §3's own Slice 7 "Content" text
 * names only `adoptNewLife()`, the banner element, the selector's lifetime
 * field, and the reversed list filter — it does not cite the lifecycle-
 * intent trigger, and this slice's own gate (G12's `graph-fence-parked-
 * browser.mts`) exercises only the out-of-band delete+recreate scenario
 * (`graph-recreated`). Flagged for whichever pass next reads
 * `GraphLifecycleManager.records()` from the shell, not silently assumed
 * built — the `MnLifetimeReason` union and the banner's own copy for the
 * other two reasons are already shipped and unit-tested.
 */
function lifetimeBannerStateFor(): MnLifetimeBannerState | null {
  const state = currentSourceMirror
  if (!state?.fenced || !currentGraphId) return null
  return {
    reason: 'graph-recreated',
    graphTitle: currentGraphTitle() || currentGraphId,
    previousLife: (state.graphIncarnation ?? '').slice(0, 8),
    // Slice 8's recovery-store enumeration IS resident here after all — the
    // SAME `currentParkedWork` `refreshParkedWork()` already loads for the
    // parked-work face itself (fixed 2026-07-31, build bundle review
    // finding 5: this was hardcoded `0` from Slice 7 through Slice 10, so
    // the banner's own document count was always wrong whenever earlier,
    // still-unresolved parked documents existed for this graph).
    parkedDocuments: parkedDocumentsCountFor(currentParkedWork, currentGraphId),
    parkedOperations: state.parked + state.nonDocumentParked,
    testimony: state.fenceTestimony ?? '',
    busy: lifetimeAdoptionBusy,
  }
}

/** The banner's primary action ("Reload this graph"). Local durability is
 *  never traded for liveness on the manager side (§2.1); this wrapper's
 *  only job is the busy flag and surfacing a failure in the machine's own
 *  voice — the caller (the banner, re-shown on the next navigation) may
 *  simply retry, which `adoptNewLife()` is specced to tolerate. */
function handleLifetimeAdopt(): void {
  if (lifetimeAdoptionBusy) return
  const runtime = activeSourceMirrorRuntime()
  const graphId = currentGraphId
  if (!runtime || !graphId) return
  lifetimeAdoptionBusy = true
  void runtime.adoptNewLife(graphId)
    .catch((error) => {
      err(`SourceMirror: could not adopt ${graphId}'s current life:\n${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      lifetimeAdoptionBusy = false
    })
}

/**
 * The banner's secondary action ("View parked work"). Wired-but-inert
 * through Slice 7 — the `garden.parked-work` route face now exists (master
 * §3 Slice 8), so this opens it for real.
 */
function handleLifetimeViewParked(): void {
  openParkedWorkRoute(currentGraphId, null)
}

function prepareDocumentIntent(
  graphId: string,
  documentId: string,
  reason: 'boot' | 'history' | 'intent' | 'recent',
  delayMs = 0,
): void {
  const active = currentDocumentActivation()
  const graph = graphId.trim()
  const document = documentId.trim()
  if (
    !active
    || sourceSelect.value !== 'CELL_LIVE'
    || graph !== currentGraphId
    || !document
    || document === openDocId
  ) return
  void active.manager.prepare({
    userId: active.contract.auth.userId(),
    graphId: graph,
    documentId: document,
    reason,
    delayMs,
  })
}

function cancelDocumentIntent(graphId: string, documentId: string): void {
  const active = currentDocumentActivation()
  const graph = graphId.trim()
  const document = documentId.trim()
  if (
    !active
    || !document
    || (graph === currentGraphId && document === openDocId)
  ) return
  active.manager.cancelPreparation({
    userId: active.contract.auth.userId(),
    graphId: graph,
    documentId: document,
  })
}

/** Prepare one strongest adjacent history candidate; the manager enforces max-one I/O. */
function prepareCenterPaneAdjacency(): void {
  const state = centerPanesController.state
  const activePane = state.activePaneId === state.primary.id ? state.primary : state.secondary
  const panes = [activePane, state.primary, state.secondary].filter(
    (pane, index, all) => pane !== null && all.indexOf(pane) === index,
  )
  const visible = new Set(
    [state.primary, state.secondary]
      .map(pane => pane?.current)
      .filter((location): location is Extract<CenterPaneLocation, { kind: 'document' }> =>
        location?.kind === 'document')
      .map(location => `${location.graphId}\u0000${location.documentId}`),
  )
  for (const pane of panes) {
    if (!pane) continue
    for (const location of [pane.back.at(-1), pane.forward.at(-1)]) {
      if (
        location?.kind !== 'document'
        || location.graphId !== currentGraphId
        || visible.has(`${location.graphId}\u0000${location.documentId}`)
      ) continue
      prepareDocumentIntent(location.graphId, location.documentId, 'history')
      return
    }
  }
}

function prepareBootDocument(contract: OrganismCellContract, graphId: string): void {
  const manager = contract.documentActivation
  const userId = contract.auth.userId()
  manager.setScope(userId, graphId)
  const hint = manager.readNavigation(userId)
  if (hint?.graphId === graphId && hint.documentId !== openDocId) {
    void manager.prepare({ ...hint, reason: 'boot' })
  } else {
    prepareCenterPaneAdjacency()
  }
}

function selectedSourceMode(): OrganismSourceMode {
  const source = sourceSelect.value
  if (
    source === 'GARDEN_DEFAULT'
    || source === 'GARDEN_VARIANT'
    || source === 'SEED_NT'
    || source === 'CELL_LIVE'
    || source === 'EMPORIUM_LIVE'
  ) {
    return source
  }
  return 'SEED_NT'
}

/** Fresh point-in-time context for every shell-feature lifecycle boundary. */
function currentShellContext(
  location: Pick<Location, 'href'> | URL = window.location,
): ShellContext<OrganismCellContract> {
  return createShellContext({
    host: hostEl,
    graphId: currentGraphId,
    documentId: openDocId,
    app: currentApp,
    source: selectedSourceMode(),
    deploymentMode: deploymentConfig.mode,
    contract: store?.contract ?? deploymentContract,
    location,
    rerender: rerenderCurrentSource,
  })
}

function buildCellStore(graphId: string): OrganismSessionStore {
  const contract: OrganismCellContract = deploymentContract ?? createLocalGardendContract()
  return createSessionStore({ contract, graphId })
}

function createLocalGardendContract(): OrganismCellContract {
  return createGardendContract({
    transport: {
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      // token deliberately omitted — the proxy injects it server-side.
    },
  })
}

/**
 * Build the host-side GROW port over the SAME contract the live render loop uses.
 * The chat driver closes over this port, so "give me a top bar" writes a real
 * additive :ux:config delta into the cell and the existing config store poll
 * re-renders it.
 */
function buildGrowCell(contract: OrganismCellContract): GrowCell {
  return makeGrowCell({
    readConfig: async (graphId) => {
      const read = await loadConfigFromCell(contract, graphId)
      // grow() computes an ADDITIVE delta vs the read config. Against the
      // in-memory fallback that delta would be orphaned triples in an
      // otherwise-empty :ux:config (no Workspace node lands with it), which
      // the next read would ignore entirely. Keep grow's pre-fallback
      // semantics: an unconfigured graph is not growable until a real config
      // is seeded by the existing authoring flows.
      if (read.defaulted) {
        throw new Error(
          'grow requires a persisted :ux:config — this graph has none yet '
          + '(the shell is showing the in-memory default workspace)',
        )
      }
      return read.config
    },
    loadDelta: async (graphId, nt, targetGraphIri) => {
      await contract.mcp.toolsCall('rdf_load', rdfLoadArgs(graphId, nt, targetGraphIri))
    },
  })
}

interface ChatClaim {
  key: string
  service: ChatService
  sessionId: string | null
}
let chatClaim: ChatClaim | null = null
let chatPresentation: ChatPresentation = 'rail'

let chatReferenceSearch: {
  readonly store: OrganismSessionStore
  readonly graphId: string
  readonly service: ReturnType<typeof makeWikiLinkSearchService>
} | null = null

/** Bind Hoja's pure reference request to the current gardend graph. The search
 * service caches the graph projection and locally re-filters as `[[query`
 * grows; selecting a chat reference deliberately creates no persistent wire. */
const resolveChatWikiLinks: HojaWikiLinkResolver = async (request, { signal }) => {
  const activeStore = store
  const graphId = currentGraphId
  if (!activeStore || !graphId || signal.aborted) return []
  if (chatReferenceSearch?.store !== activeStore || chatReferenceSearch.graphId !== graphId) {
    chatReferenceSearch = {
      store: activeStore,
      graphId,
      service: makeWikiLinkSearchService(activeStore.contract.rest, () => ({ graphId })),
    }
  }
  const activeSearch = chatReferenceSearch
  const matches = await activeSearch.service.suggest(request.query)
  if (
    signal.aborted
    || store !== activeStore
    || currentGraphId !== graphId
    || chatReferenceSearch !== activeSearch
  ) return []
  return matches.map(match => ({
    label: match.label,
    targetDocId: match.id,
    targetGraphId: graphId,
    blockPreview: match.type === 'artifact' ? 'Artifact' : 'Document',
  }))
}

function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function buildShellChatService(contract: OrganismCellContract): ChatService {
  if (deploymentConfig.mode === 'hosted') {
    if (!deploymentConfig.chatApiBaseUrl) {
      throw new Error('Hosted chat requires VITE_CHAT_API_BASE_URL.')
    }
    return assembleChatServices(contract, getScope, 'hosted', {
      // The conversation belongs to the workspace, not to the open document:
      // getScope().graphId is null in 'home' mode, and a session created with no
      // graph makes choreograph's spawner fall back to a graph that does not
      // exist on cloud-2 (tool discovery 404s, the agent exits, the turn is lost
      // in silence). currentGraphId is the workspace the shell is actually in.
      graphId: () => currentGraphId,
      hosted: {
        baseUrl: deploymentConfig.chatApiBaseUrl,
        storage: browserLocalStorage(),
      },
    })
  }
  const growCell = buildGrowCell(contract)
  return assembleChatServices(
    contract,
    getScope,
    'local',
    makeGrowTurnDriver(growCell, currentGraphId),
  )
}

function ensureChatClaim(): ChatClaim | null {
  if (!store) {
    teardownChatClaim()
    return null
  }
  // Chat is an optional hosted service. A graph-authored workspace (including
  // an agent notebook) must still render when no chat endpoint was deployed or
  // intentionally supplied to a local cloud-2 display session.
  if (deploymentConfig.mode === 'hosted' && !deploymentConfig.chatApiBaseUrl) {
    teardownChatClaim()
    return null
  }
  const key = `cell:${currentGraphId}`
  if (chatClaim?.key === key) return chatClaim

  teardownChatClaim()
  const contract = store.contract
  const service = buildShellChatService(contract)
  const claim: ChatClaim = { key, service, sessionId: null }
  chatClaim = claim
  void service.createSession({ title: 'organism-chat', graphId: currentGraphId }).then(
    (session) => {
      if (chatClaim !== claim) return
      claim.sessionId = session.id
      if (store) renderCellState(store.getState(), configStore?.get())
    },
    (e) => {
      if (chatClaim !== claim) return
      chatClaim = null
      err(`chat session create error:\n${e instanceof Error ? e.message : String(e)}`)
    },
  )
  return claim
}

function teardownChatClaim(): void {
  chatClaim = null
  chatPresentation = 'rail'
  chatReferenceSearch = null
}

function renderCellState(
  state: SessionStoreState,
  configState: StoreState<WorkspaceConfig> = configStore?.get() ?? { status: state.status, read: null, error: state.error },
): void {
  if (state.status === 'loading') {
    ok('reading :ux:config from the live gardend cell…')
    return
  }
  if (state.status === 'error') {
    // Surface the REAL error verbatim — no faked fallback config.
    err(
      `live-read error (NO fallback — the shell shows the real error):\n${state.error}\n\n` +
        `Is a cell running? Start one with:  pnpm gardend:dev`,
    )
    // Outside ?debug=1 the #status strip is display:none, so with no prior
    // read this used to paint NOTHING (boot placeholder over a blank page).
    // Paint the honest error panel instead — but never clobber a LIVE
    // workspace over a transient refresh failure (state.read present).
    if (!state.read) {
      defaultWorkspaceNotice.sync(false, currentGraphId)
      renderCellErrorPanel(hostEl, state.error ?? 'unknown error', {
        onRetry: () => void store?.refresh(),
      })
    }
    return
  }
  if (state.status === 'ready' && state.read) {
    if (configState.status !== 'ready' || !configState.read) {
      err(`live config store not ready (NO fallback):\nstatus=${configState.status}${configState.error ? `\n${configState.error}` : ''}`)
      return
    }
    const { read } = state
    // Mirror the live N-Triples into the editor (read-only reflection of the cell).
    editor.value = read.nt
    const app = currentApp
    try {
      const summary = renderConfig(configState.read, app)
      const when = new Date(read.readAt).toLocaleTimeString()
      const authority = read.activationSource === 'indexeddb'
        ? `OFFLINE cached workspace @ ${when}\ntransport: ${read.offlineError ?? 'unavailable'}`
        : `LIVE cell read @ ${when} · ${read.tripleCount} triples`
      const provenance = read.defaulted
        ? '\n(default workspace — this graph has no :ux:config yet; nothing persisted)'
        : ''
      ok(`${authority}\nfrom ${read.graphIri}\n${summary}${provenance}`)
      defaultWorkspaceNotice.sync(read.defaulted, currentGraphId)
    } catch (e) {
      err(`render error (live config):\n${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/**
 * startCellMode is BOTH "enter cell/dev mode" AND "switch the active cell
 * graph while already in cell mode" (every callsite below re-invokes it on a
 * graph/workspace change). The dev debug-controls strip (#cell-controls) must
 * show exactly once, at genuine mode ENTRY — never re-flash on an in-mode
 * graph switch. That decision does NOT live here: each callsite sets
 * `cellControls.hidden = false` itself, gated on whether it is a true entry
 * (see CONTINUITY PART ONE). Leaving it out of startCellMode's body is
 * deliberate — do not reintroduce an unconditional `cellControls.hidden =
 * false` here.
 */
function startCellMode(): void {
  const graphId = cellGraphId.value.trim() || 'organism-dev'
  const restoreMuxSession = store === null || centerPanesSessionGraphId !== graphId
  // Every call replaces the store, including manual refresh of the same
  // graph. Retire the old timer before constructing its successor.
  if (stopPoll) {
    stopPoll()
    stopPoll = null
  }
  store?.stopPoll()
  // A graph (re)build invalidates any open editor claim (different cell/graph).
  if (graphId !== currentGraphId) {
    store?.contract.documentActivation.cancelPreparation()
    resetQuickClip(true, false)
    openDocId = null
    currentZoomBlockId = null
    currentBlockFocusRequest = null
    currentPinnedWireDocs = []
    currentPinnedWireNodes = []
    currentPinnedWireBlocks = []
    currentPinnedWireBlockContexts = new Map()
    currentPinnedWireNodeContexts = new Map()
    teardownCommentsSource()
    currentInspectorSelection = null
    currentWireBundle = null
    currentWireContexts = new Map()
    currentWireRadialContexts = new Map()
    latestWireBundleRequest++
    currentSourceMirror = null
    currentDocumentOutboxSignature = ''
    currentSalienceBundle = null
    latestSalienceBundleRequest++
    salienceRatingRequestIds.clear()
    currentSidebarSections = []
    currentSidebarStatus = 'idle'
    currentSidebarError = ''
    currentSidebarSearchQuery = ''
    currentSidebarSelectedId = null
    currentSidebarExpandedFolders = new Set()
    latestSidebarRequest++
    currentDailyNotes = []
    currentDailyNotePopover = null
    latestDailyNotesRequest++
    clearTagLensState()
    clearZoteroSourceState()
    clearArtifactSurfaceState()
    clearDocHistoryState()
    clearGraphNodeHistory()
    wireContextRequestIds.clear()
    wireRadialContextRequestIds.clear()
    pinnedWireBlockContextRequestIds.clear()
    pinnedWireNodeContextRequestIds.clear()
    writeZoomBlockIdToUrl(null)
    teardownEditorClaim()
    documentSwitcherTargetPaneId = null
    documentSwitcherPlacement = 'active'
    teardownChatClaim()
  }
  currentGraphId = graphId
  if (restoreMuxSession) {
    activateCenterPanesSession(graphId)
    const muxState = centerPanesController.state
    const activePane = muxState.activePaneId === muxState.primary.id
      ? muxState.primary
      : muxState.secondary
    if (activePane?.current.kind === 'document') {
      openDocId = activePane.current.documentId
      cellDocId.value = activePane.current.documentId
    } else {
      openDocId = null
    }
  }
  stopStoreSubscription?.()
  stopStoreSubscription = null
  stopSourceMirrorSubscription?.()
  stopSourceMirrorSubscription = null
  const nextStore = buildCellStore(graphId)
  const nextConfigStore = workspaceConfigStore(nextStore)
  store = nextStore
  prepareBootDocument(nextStore.contract, graphId)
  configStore = nextConfigStore
  stopStoreSubscription = nextStore.subscribe((state) => {
    if (store !== nextStore) return
    renderCellState(state, nextConfigStore.get())
  })
  stopSourceMirrorSubscription = nextStore.contract.sourceMirror.subscribe(
    (changedGraphId, state) => {
      if (store !== nextStore || changedGraphId !== graphId) return
      applySourceMirrorState(state)
    },
  )
  // Cold durability is opened first, with no network dependency. The complete
  // mirror can therefore serve immediate reads while the source-aware
  // flush→pull reconciliation proceeds under background activation.
  void nextStore.contract.sourceMirror.open(graphId).finally(() => {
    if (store === nextStore) rerenderCurrentSource()
  })
  // The local cloud-2 display bridge authenticates as a graph-scoped service
  // principal. That principal can read/query the cell but deliberately cannot
  // invoke the user SourceMirror's source_pull/source_push tools. Keep this
  // proof on the RDF/layout surface it is authorized for; ordinary Cognito
  // sessions continue to activate SourceMirror exactly as before.
  if (!(deploymentConfig.mode === 'hosted' && deploymentConfig.devServiceProxySubject)) {
    nextStore.contract.sourceMirror.backgroundSync(graphId)
  }
  void nextStore.refresh().then(() => {
    if (store === nextStore) {
      if (cellPoll.checked) stopPoll = nextStore.startPoll(3000)
      void refreshSidebarSections()
      // master §3 Slice 8, WS3 §5.4 — "on activation", the second of the
      // two triggers named alongside `applySourceMirrorState`'s own
      // fenced/parked change check: `documentActivation.userRecoveries`
      // does not depend on the mirror publishing at all.
      void refreshParkedWork(graphId)
      void refreshDailyNotes()
      // A cold-boot session restore sets `openDocId` directly (above) rather than
      // through `activateDocumentSurface` — the only other place wire/salience
      // bundles get fetched. Without this, reloading straight into an already-open
      // document shows neither wires nor ratings until you navigate away and back.
      if (openDocId) {
        void refreshWireBundle()
        void refreshSalienceBundle()
      }
      // The cell just proved it's live (first successful refresh) — the
      // hosted workspace menu's cached cellState was captured at page load
      // and otherwise never updates, so a woken cell shows "Cell asleep"
      // forever even while it's actively being edited. rerender=false here
      // (a mid-edit "loading" flicker isn't worth it) — this then() chain
      // owns rerendering explicitly once the graph list actually lands,
      // rather than racing the sibling refreshes' renders above and
      // hoping one of them happens to fire after this one resolves.
      if (hostedGatewayContract && deploymentConfig.mode === 'hosted') {
        void refreshHostedGraphs(false)
          .then(() => {
            if (store === nextStore) rerenderCurrentSource()
          })
          .catch(() => {})
      }
    }
  })
}

interface CenterPaneOpenTarget {
  readonly paneId?: CenterPaneId
  readonly placement?: 'active' | 'split'
}

function centerPaneLocationForDocument(graphId: string, documentId: string): CenterPaneLocation {
  return {
    kind: 'document',
    graphId,
    documentId,
    title: sidebarNodeById(documentId)?.label ?? documentId,
  }
}

function activateCenterPanesSession(graphId: string): void {
  if (centerPanesSessionGraphId === graphId) return
  centerPanesSessionGraphId = graphId
  centerPanesController.replaceState(
    centerPanesSessionRepository.load(graphId) ?? createCenterPanesState({ graphId }),
  )
}

function centerPaneById(paneId: CenterPaneId) {
  const state = centerPanesController.state
  if (state.primary.id === paneId) return state.primary
  return state.secondary?.id === paneId ? state.secondary : null
}

function activateDocumentSurface(
  docId: string,
  focusRequest: EditorBlockFocusRequest | null,
  origin: string,
): void {
  if (!store) return
  const previousDocId = openDocId
  clearTagLensState()
  clearZoteroSourceState()
  clearArtifactSurfaceState()
  if (previousDocId && previousDocId !== docId) {
    clearDocHistoryState()
    clearGraphNodeHistory()
  }
  currentDailyNotePopover = null
  cellDocId.value = docId
  openDocId = docId
  homeActivityStore.markOpened(currentGraphId, docId)
  store.contract.documentActivation.rememberNavigation({
    userId: store.contract.auth.userId(),
    graphId: currentGraphId,
    documentId: docId,
  })
  currentSidebarSelectedId = null
  currentHoveredCommentId = null
  currentInspectorSelection = activeDocumentSelection(currentGraphId, docId)
  currentBlockFocusRequest = focusRequest
  currentWireBundle = null
  currentWireContexts = new Map()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  if (previousDocId && previousDocId !== docId) {
    currentZoomBlockId = null
    writeZoomBlockIdToUrl(null)
  } else {
    currentZoomBlockId = readZoomBlockIdFromUrl()
  }
  renderCellState(store.getState(), configStore?.get())
  void refreshSidebarSections()
  void refreshWireBundle()
  queueMicrotask(prepareCenterPaneAdjacency)
  void refreshSalienceBundle()
  ok(`${origin}: opened document "${docId}" in ${centerPanesController.state.activePaneId}`)
}

/**
 * Open a document for the live editor (CELL_LIVE mode): take the #cell-doc-id override,
 * else pick the FIRST doc the cell exposes (the same GRAPH-scoped doc-list SELECT the
 * wikiLinkSearch uses). Setting openDocId flips the scope to 'document' so the next
 * render mounts a live editor over the cell's doc-sync room; clearing it returns home.
 */
async function openCellDocument(
  targetDocId?: string,
  focusRequest: EditorBlockFocusRequest | null = null,
  target: CenterPaneOpenTarget = {},
): Promise<void> {
  if (!store) {
    err('open a CELL_LIVE source first (no cell store).')
    return
  }
  const override = (targetDocId ?? cellDocId.value).trim()
  let docId = override
  if (!docId) {
    // First-doc-from-cell pick via the doc-list SELECT (GRAPH-scoped, what the picker uses).
    try {
      const first = await firstDocumentId(store, currentGraphId)
      if (!first) {
        err('no documents in this graph yet — create one in the cell, or type a doc_id.')
        return
      }
      docId = first
      cellDocId.value = first // reflect the picked doc into the input
    } catch (e) {
      err(`doc-list read error:\n${e instanceof Error ? e.message : String(e)}`)
      return
    }
  }
  centerPanesController.dispatch({
    type: 'open',
    detail: {
      paneId: target.paneId ?? centerPanesController.state.activePaneId,
      placement: target.placement ?? 'active',
      location: centerPaneLocationForDocument(currentGraphId, docId),
      reason: target.placement === 'split' ? 'open-in-split' : 'choose-document',
      activate: true,
    },
  })
  activateDocumentSurface(docId, focusRequest, 'document navigation')
}

async function openDocumentFromShell(
  detail: OpenDocumentDetail,
  target: CenterPaneOpenTarget = {},
): Promise<void> {
  const documentId = detail.documentId.trim()
  const graphId = detail.graphId.trim() || currentGraphId
  if (!documentId) return

  if (documentId.startsWith('zot-')) {
    if (sourceSelect.value === 'EMPORIUM_LIVE') stopEmporiumMode()
    sourceSelect.value = 'CELL_LIVE'
    cellGraphId.value = graphId
    if (!store || graphId !== currentGraphId) {
      // A null store means we were NOT already in an active cell session
      // (e.g. arriving from EMPORIUM_LIVE above) — a genuine mode entry, so
      // show the strip. A non-null store here means graphId simply differs
      // from currentGraphId: an in-mode graph switch, which must NOT re-show it.
      if (!store) cellControls.hidden = false
      startCellMode()
    }
    openZoteroSourceFromArtifact(documentId, zoteroKeyFromArtifactId(documentId), 'surface action')
    return
  }

  const focusRequest = detail.blockId
    ? {
        blockId: detail.blockId,
        token: ++nextBlockFocusToken,
      } satisfies EditorBlockFocusRequest
    : null

  if (sourceSelect.value === 'EMPORIUM_LIVE') stopEmporiumMode()
  sourceSelect.value = 'CELL_LIVE'
  cellGraphId.value = graphId
  if (!store || graphId !== currentGraphId) {
    // Same reasoning as the zot- branch above: only a null store is a genuine
    // mode entry; an in-mode graph switch must not re-show the strip.
    if (!store) cellControls.hidden = false
    startCellMode()
  }
  await openCellDocument(documentId, focusRequest, target)
  if (detail.blockId) {
    ok(`opened document "${documentId}" from surface action; focusing block "${detail.blockId}"`)
  }
}

function activateCenterPaneLocation(paneId: CenterPaneId, origin: string): void {
  const pane = centerPaneById(paneId)
  if (!pane) return
  if (pane.current.kind === 'home') {
    installActiveEditorIntegration(null)
    rerenderCurrentSource()
    return
  }
  if (pane.current.graphId !== currentGraphId) {
    void openDocumentFromShell({
      graphId: pane.current.graphId,
      documentId: pane.current.documentId,
    }, { paneId, placement: 'active' })
    return
  }
  activateDocumentSurface(pane.current.documentId, null, origin)
  queueMicrotask(() => editorHostElementForPane(paneId)?.focusEditor())
}

function handleCenterPaneOpen(detail: CenterPaneOpenIntentDetail): void {
  const changed = dispatchCenterPaneIntentChange(centerPanesController, { type: 'open', detail })
  const targetPaneId = detail.placement === 'split'
    ? centerPanesController.state.activePaneId
    : detail.paneId
  if (detail.location?.kind === 'document' || detail.location?.kind === 'home') {
    if (!changed) return
    activateCenterPaneLocation(targetPaneId, 'center pane')
    return
  }
  rerenderCurrentSource()
  openDocumentSwitcher('all', '', { paneId: targetPaneId, placement: 'active' })
}

function handleCenterPaneFocus(detail: CenterPaneFocusIntentDetail): void {
  const changed = dispatchCenterPaneIntentChange(centerPanesController, { type: 'focus', detail })
  if (!changed) {
    if (detail.reason === 'programmatic') {
      queueMicrotask(() => editorHostElementForPane(detail.paneId)?.focusEditor())
    }
    return
  }
  activateCenterPaneLocation(detail.paneId, 'center pane focus')
}

function handleCenterPaneClose(detail: CenterPaneCloseIntentDetail): void {
  const changed = dispatchCenterPaneIntentChange(centerPanesController, { type: 'close', detail })
  if (!changed) return
  teardownPaneEditorClaim(detail.paneId)
  activateCenterPaneLocation(centerPanesController.state.activePaneId, 'center pane close')
}

function handleCenterPaneNavigate(detail: CenterPaneNavigateIntentDetail): void {
  const changed = dispatchCenterPaneIntentChange(centerPanesController, { type: 'navigate', detail })
  if (!changed) return
  activateCenterPaneLocation(detail.paneId, `center pane ${detail.direction}`)
}

function handleCenterPaneResize(detail: CenterPaneResizeIntentDetail): void {
  const changed = dispatchCenterPaneIntentChange(centerPanesController, { type: 'resize', detail })
  if (!changed) return
  rerenderCurrentSource()
}

function handleChatSurfaceAction(action: ChatSurfaceActionIntent): void {
  void openDocumentFromShell({
    graphId: currentGraphId,
    documentId: action.documentId,
    blockId: action.blockId ?? undefined,
  })
}

/** The compatibility `popout` intent now projects the one live conversation
 * full-screen. Its inverse returns that exact host/panel to the rail. */
function handleChatHeaderAction(detail: ChatHeaderActionDetail): void {
  if (detail.action === 'popout' && chatPresentation !== 'fullscreen') {
    chatPresentation = 'fullscreen'
    rerenderCurrentSource()
  } else if (detail.action === 'restore' && chatPresentation !== 'rail') {
    chatPresentation = 'rail'
    rerenderCurrentSource()
  }
}

function handleTagLensOpenBlock(detail: TagLensOpenBlockDetail): void {
  const documentId = detail.documentId.trim()
  if (!documentId) return
  void openDocumentFromShell({
    graphId: currentGraphId,
    documentId,
    ...(detail.blockId ? { blockId: detail.blockId } : {}),
  })
}

/** The bare id of the first TipTapDocument in the graph (the doc-list SELECT). */
async function firstDocumentId(s: OrganismSessionStore, graphId: string): Promise<string | null> {
  const ws = `urn:mnemosyne:local:graph:${graphId}:projection:workspace`
  const sparql = [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT ?doc',
    `WHERE { GRAPH <${ws}> { ?doc a doc:TipTapDocument } }`,
    'LIMIT 1',
  ].join('\n')
  const res = (await s.contract.rest.query(graphId, sparql)) as { rows?: Array<Record<string, string>> }
  const term = res.rows?.[0]?.doc
  if (!term) return null
  const iri = term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
  const prefix = 'urn:mnemosyne:local:document:'
  return iri.startsWith(prefix) ? iri.slice(prefix.length) : null
}

function stopCellMode(): void {
  resetQuickClip(true, false)
  cellControls.hidden = true
  if (stopPoll) {
    stopPoll()
    stopPoll = null
  }
  if (store) {
    store.stopPoll()
    store = null
  }
  stopStoreSubscription?.()
  stopStoreSubscription = null
  stopSourceMirrorSubscription?.()
  stopSourceMirrorSubscription = null
  currentSourceMirror = null
  currentDocumentOutboxSignature = ''
  configStore = null
  // Leaving cell mode closes any open document + its live editor claim (the live editor
  // only makes sense over a real cell).
  openDocId = null
  currentZoomBlockId = null
  currentBlockFocusRequest = null
  teardownCommentsSource()
  currentInspectorSelection = null
  currentPinnedWireDocs = []
  currentPinnedWireNodes = []
  currentPinnedWireBlocks = []
  currentPinnedWireBlockContexts = new Map()
  currentPinnedWireNodeContexts = new Map()
  currentWireBundle = null
  currentWireContexts = new Map()
  currentWireRadialContexts = new Map()
  latestWireBundleRequest++
  currentSalienceBundle = null
  latestSalienceBundleRequest++
  salienceRatingRequestIds.clear()
  currentSidebarSections = []
  currentSidebarStatus = 'idle'
  currentSidebarError = ''
  currentSidebarSearchQuery = ''
  currentSidebarSelectedId = null
  currentSidebarExpandedFolders = new Set()
  latestSidebarRequest++
  currentDailyNotes = []
  currentDailyNotePopover = null
  latestDailyNotesRequest++
  clearTagLensState()
  clearZoteroSourceState()
  clearArtifactSurfaceState()
  wireContextRequestIds.clear()
  wireRadialContextRequestIds.clear()
  pinnedWireBlockContextRequestIds.clear()
  pinnedWireNodeContextRequestIds.clear()
  writeZoomBlockIdToUrl(null)
  teardownEditorClaim()
  teardownChatClaim()
  cellPoll.checked = false
}

// ── Mode C: Emporium catalogue (live) — read /emporium through the /cell proxy ─
//
// The cell serves the vocab CATALOGUE globally (GET /emporium/vocabs +
// /emporium/vocab/{name}/latest). The shell reads it live (EmporiumClient) via
// the SAME same-origin Vite /cell proxy used for the config read — so the token
// never reaches browser JS. The catalogue list + a pack-detail drill-down are
// rendered with lit into the #host frame from the GENERALIZED components.
let emporium: EmporiumStore | null = null
let emporiumView: { kind: 'catalogue' } | { kind: 'pack'; name: string } = { kind: 'catalogue' }

function buildEmporiumStore(): EmporiumStore {
  // baseUrl '/cell' → the Vite proxy reaches the cell's REST routes incl.
  // /emporium; token deliberately omitted (the proxy injects it server-side).
  return createEmporiumStore({ transport: { baseUrl: '/cell' } })
}

function renderEmporiumState(state: EmporiumStoreState): void {
  if (state.status === 'loading') {
    ok('reading the live /emporium vocab catalogue from the cell…')
    return
  }
  if (state.status === 'error') {
    // Surface the REAL error verbatim — no faked catalogue.
    err(
      `live /emporium read error (NO fallback — the shell shows the real error):\n${state.error}\n\n` +
        `Is a current cell running? Start one with:  pnpm gardend:dev\n` +
        `(the release build serves /emporium; the debug build is stale.)`,
    )
    return
  }
  if (state.status === 'ready' && state.read) {
    const { read } = state
    let summary: string
    if (emporiumView.kind === 'pack') {
      const pack = read.packs[emporiumView.name]
      if (!pack) {
        err(`pack "${emporiumView.name}" not in the live catalogue (no faked data).`)
        return
      }
      litRender(
        renderVocabPack(pack, { onBack: () => showCatalogue() }),
        hostEl,
      )
      emporiumBackBtn.hidden = false
      summary = `pack "${pack.name}" v${pack.version} · ${pack.classes.length} classes`
    } else {
      litRender(
        renderVocabCatalogue(read.vocabs, {
          classCounts: read.classCounts,
          onOpen: (name) => showPack(name),
        }),
        hostEl,
      )
      emporiumBackBtn.hidden = true
      summary = `${read.vocabs.length} vocabularies: ${read.vocabs.map((v) => v.name).join(', ')}`
    }
    const when = new Date(read.readAt).toLocaleTimeString()
    ok(`LIVE /emporium read @ ${when}\n${summary}`)
  }
}

function showCatalogue(): void {
  emporiumView = { kind: 'catalogue' }
  if (emporium) renderEmporiumState(emporium.getState())
}

function showPack(name: string): void {
  emporiumView = { kind: 'pack', name }
  if (emporium) renderEmporiumState(emporium.getState())
}

function startEmporiumMode(): void {
  emporiumControls.hidden = false
  editor.value = '' // the emporium view is not a triples editor
  emporiumView = { kind: 'catalogue' }
  emporium = buildEmporiumStore()
  emporium.subscribe(renderEmporiumState)
  void emporium.refresh()
}

function stopEmporiumMode(): void {
  emporiumControls.hidden = true
  emporiumBackBtn.hidden = true
  emporium = null
}

// ── Source switching ──────────────────────────────────────────────────────────
function onSourceChange(): void {
  const src = sourceSelect.value
  if (src === 'CELL_LIVE') {
    // The <select> only fires 'change' on a genuine transition (never for
    // reselecting the already-active option), and every OTHER branch here
    // calls stopCellMode() — so this is always a true mode entry.
    stopEmporiumMode()
    cellControls.hidden = false
    startCellMode()
  } else if (src === 'EMPORIUM_LIVE') {
    stopCellMode()
    startEmporiumMode()
  } else {
    stopCellMode()
    stopEmporiumMode()
    loadPreset(src)
  }
}

// ── Wire up the controls ──────────────────────────────────────────────────────
sourceSelect.addEventListener('change', onSourceChange)
reparseBtn.addEventListener('click', () => {
  if (sourceSelect.value === 'CELL_LIVE') {
    void store?.refresh()
  } else if (sourceSelect.value === 'EMPORIUM_LIVE') {
    void emporium?.refresh()
  } else {
    renderFromEditor()
  }
})
emporiumRefreshBtn.addEventListener('click', () => {
  void emporium?.refresh()
})
emporiumBackBtn.addEventListener('click', () => {
  showCatalogue()
})
cellRefreshBtn.addEventListener('click', () => {
  // Rebuild the store if the graph_id changed, then refresh.
  startCellMode()
})
cellOpenDocBtn.addEventListener('click', () => {
  void openCellDocument()
})
cellPoll.addEventListener('change', () => {
  if (!store) return
  if (cellPoll.checked) {
    stopPoll = store.startPoll(3000)
  } else {
    store.stopPoll()
    stopPoll = null
  }
})

hostEl.addEventListener('mn-zoom-change', ((event: CustomEvent<{ blockId: string | null }>) => {
  currentZoomBlockId = event.detail?.blockId ?? null
  writeZoomBlockIdToUrl(currentZoomBlockId)
}) as EventListener)

hostEl.addEventListener('mn-editor-comment-inserted', ((event: CustomEvent<EditorCommentInsertedDetail>) => {
  handleEditorCommentInserted(event.detail)
}) as EventListener)

document.addEventListener('mn-editor-history-open', ((event: CustomEvent<{ documentId?: string | null }>) => {
  openDocHistory(event.detail?.documentId ?? openDocId, 'editor toolbar')
}) as EventListener)

window.addEventListener('popstate', () => {
  const location = new URL(window.location.href)
  if (
    (settingsOverlayTransition.isOpen || canOpenSettingsInPlace())
    && settingsOverlayTransition.handlePopState(location)
  ) return

  const nextPanel = readRightPanelFromUrl()
  const panelChanged = nextPanel !== currentRightPanel
  if (panelChanged) {
    transitionRightPanel(nextPanel, false)
    rerenderCurrentSource()
  }
  currentZoomBlockId = readZoomBlockIdFromUrl()
  applyZoomBlockIdToLiveHost(currentZoomBlockId)
})

window.addEventListener('online', () => {
  const activeStore = store
  if (!activeStore || sourceSelect.value !== 'CELL_LIVE') return
  // Connectivity is merely a delivery opportunity: local acceptance never
  // waits here. Kick both graph-lifecycle and graph-source outboxes
  // immediately; SourceMirrorRuntime retains bounded retries if the first
  // request races a waking or rotating cell.
  activeStore.contract.sourceMirror.backgroundFlushGraphLifecycle()
  activeStore.contract.sourceMirror.backgroundSync(currentGraphId)
})

window.addEventListener(OPEN_DOCUMENT_EVENT, ((event: CustomEvent<OpenDocumentDetail>) => {
  void openDocumentFromShell(event.detail)
}) as EventListener)

window.addEventListener('mn-open-daily-note', ((event: CustomEvent<DailyNoteOpenDetail>) => {
  void openDailyNoteByDate(event.detail?.dateKey ?? '')
}) as EventListener)

window.addEventListener('mn-open-zotero-source', ((event: CustomEvent<{ artifactId?: string; zoteroKey?: string }>) => {
  const key = event.detail?.zoteroKey?.trim() ?? ''
  const artifactId = event.detail?.artifactId?.trim() || artifactIdFromZoteroKey(key)
  if (!artifactId) return
  openZoteroSourceFromArtifact(artifactId, key || zoteroKeyFromArtifactId(artifactId), 'mn-open-zotero-source')
}) as EventListener)

document.addEventListener('mn-wire-created', () => {
  void refreshWireBundle()
})
document.addEventListener('mn-wire-deleted', () => {
  void refreshWireBundle()
})

hostEl.addEventListener('mn-wire-delete-request', ((event: CustomEvent<WireDeleteRequestDetail>) => {
  void deleteWireFromPanel(event.detail)
}) as EventListener)

hostEl.addEventListener(SALIENCE_RATE_REQUEST_EVENT, ((event: CustomEvent<SalienceRateRequestDetail>) => {
  void rateSalienceBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WireContextRequestDetail>) => {
  void loadWireContextFromPanel(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_RADIAL_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WireRadialContextRequestDetail>) => {
  void loadWireRadialContext(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PIN_DOCUMENT_REQUEST_EVENT, ((event: CustomEvent<WirePinDocumentRequestDetail>) => {
  pinWireDocument(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PIN_BLOCK_REQUEST_EVENT, ((event: CustomEvent<WirePinBlockRequestDetail>) => {
  pinWireBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PIN_WIRE_REQUEST_EVENT, ((event: CustomEvent<WirePinWireRequestDetail>) => {
  pinWireNode(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_BLOCK_OPEN_EVENT, ((event: CustomEvent<WirePinnedBlockOpenDetail>) => {
  openPinnedWireBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_BLOCK_CLOSE_EVENT, ((event: CustomEvent<WirePinnedBlockCloseDetail>) => {
  closePinnedWireBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedBlockContextRequestDetail>) => {
  void loadPinnedWireBlockContext(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_BLOCK_MOVE_EVENT, ((event: CustomEvent<WirePinnedBlockMoveDetail>) => {
  movePinnedWireBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_BLOCK_REFRESH_EVENT, ((event: CustomEvent<WirePinnedBlockRefreshDetail>) => {
  void refreshPinnedWireBlock(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_DOC_OPEN_EVENT, ((event: CustomEvent<WirePinnedDocOpenDetail>) => {
  openPinnedWireDocument(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_DOC_CLOSE_EVENT, ((event: CustomEvent<WirePinnedDocCloseDetail>) => {
  closePinnedWireDocument(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_DOC_MOVE_EVENT, ((event: CustomEvent<WirePinnedDocMoveDetail>) => {
  movePinnedWireDocument(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_WIRE_OPEN_EVENT, ((event: CustomEvent<WirePinnedWireOpenDetail>) => {
  openPinnedWireNode(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_WIRE_CLOSE_EVENT, ((event: CustomEvent<WirePinnedWireCloseDetail>) => {
  closePinnedWireNode(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT, ((event: CustomEvent<WirePinnedWireContextRequestDetail>) => {
  void loadPinnedWireNodeContext(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_WIRE_MOVE_EVENT, ((event: CustomEvent<WirePinnedWireMoveDetail>) => {
  movePinnedWireNode(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT, ((event: CustomEvent<WirePinnedWireUpdateRequestDetail>) => {
  void updatePinnedWireNode(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_REFRESH_REQUEST_EVENT, ((event: CustomEvent<WireRefreshRequestDetail>) => {
  void refreshWireFromPanel(event.detail)
}) as EventListener)

hostEl.addEventListener(WIRE_REFRESH_ALL_REQUEST_EVENT, () => {
  void refreshAllWiresFromPanel()
})

// Live re-render as the user edits the triples (only in textarea modes).
let editTimer: ReturnType<typeof setTimeout> | null = null
editor.addEventListener('input', () => {
  if (sourceSelect.value === 'CELL_LIVE') return // live mode reflects the cell, not edits
  if (editTimer) clearTimeout(editTimer)
  editTimer = setTimeout(renderFromEditor, 250)
})

// ── Skin / theme state — the organism is the host that owns the active pair ───
// The applier (@shrubbery/tokens) stamps [data-skin]/[data-theme] on <html>; the
// chrome re-skins live via the cascade with no re-render needed. We mirror the
// current pair onto the top-bar's pressed-state props after each render so its
// toggle buttons stay in sync (those props are CONTROLLED, never store-read).
function appearanceStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

const initialAppearance = readAppearancePreferences(appearanceStorage())

/**
 * The Observatory arrives wearing its own skin.
 *
 * `skin-observatory.css` is a whole identity — deep-field ink surfaces, lit
 * bezels, an instrument glow — written for this dashboard, and until now
 * nothing ever selected it, so `?graph=observatory` rendered in whatever skin
 * the visitor last chose (Garden by default). The dashboard is an instrument
 * panel; dressing it as the writing surface misrepresents what it is.
 *
 * `observatory` is a first-class `Skin` but deliberately NOT a
 * `VisualIdentitySkin` — the global chrome cycle is garden/emporium/98/glass,
 * and research/greenhouse sit outside it the same way. So this overrides the
 * APPLIED skin without touching `currentSkin`, which remains the picker's own
 * value: widening the cycle to force this would put Observatory in everyone's
 * skin toggle as a side effect of a routing decision.
 *
 * Starting state only. Nothing is written to storage, and picking a skin here
 * still wins for the session.
 */
const OBSERVATORY_SKIN_GRAPH_ID = 'observatory'
const observatorySkinRequested = (() => {
  const params = new URL(window.location.href).searchParams
  return (params.get('graph') ?? params.get('graph_id')) === OBSERVATORY_SKIN_GRAPH_ID
})()
/** The skin actually stamped on <html> — `currentSkin` unless the route overrides it. */
const appliedSkin = (): Skin => (observatorySkinRequested ? 'observatory' : currentSkin)

let currentSkin: VisualIdentitySkin = initialAppearance.skin
let currentTheme: Theme = resolveThemePreference(initialAppearance.theme)

/** Reflect the current pair onto the live <mn-top-bar> toggle props (if present). */
function reflectChromeState(): void {
  const bar = hostEl.querySelector('mn-top-bar') as
    | (HTMLElement & { isDark?: boolean; activeSkin?: Skin })
    | null
  if (!bar) return
  bar.isDark = currentTheme === 'dark'
  bar.activeSkin = currentSkin
}

/** Apply the current pair to <html> and reflect it onto the chrome. */
function applyCurrent(): void {
  const skin = appliedSkin()
  applySkinTheme({ skin, theme: currentTheme })
  applySkinTheme({ skin, theme: currentTheme, target: document.body })
  skinSelect.value = currentSkin
  themeSelect.value = currentTheme
  reflectChromeState()
}

skinSelect.addEventListener('change', () => {
  currentSkin = isVisualIdentitySkin(skinSelect.value) ? skinSelect.value : 'garden'
  persistAppearancePreferences(appearanceStorage(), { skin: currentSkin })
  applyCurrent()
})
themeSelect.addEventListener('change', () => {
  currentTheme = (themeSelect.value as Theme) || 'light'
  persistAppearancePreferences(appearanceStorage(), { theme: currentTheme })
  applyCurrent()
})

document.addEventListener(ORGANISM_APPEARANCE_CHANGE_EVENT, ((event: CustomEvent<OrganismAppearanceChangeDetail>) => {
  if (event.detail.skin) currentSkin = event.detail.skin
  if (event.detail.theme) currentTheme = event.detail.theme
  applyCurrent()
}) as EventListener)

// Chrome events bubble up here — the organism is the "shell". The theme/skin
// toggles in the chrome FLIP the real skin/theme (via the same applier the
// selects use); the rest are logged as shell-would-handle.
hostEl.addEventListener('mn-theme-toggle', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
  persistAppearancePreferences(appearanceStorage(), { theme: currentTheme })
  applyCurrent()
  ok(`chrome event: mn-theme-toggle → theme=${currentTheme} (applied via @shrubbery/tokens)`)
})
hostEl.addEventListener('mn-skin-toggle', () => {
  currentSkin = nextVisualIdentitySkin(currentSkin)
  persistAppearancePreferences(appearanceStorage(), { skin: currentSkin })
  applyCurrent()
  ok(`chrome event: mn-skin-toggle → skin=${currentSkin} (applied via @shrubbery/tokens)`)
})
hostEl.addEventListener('mn-app-change', ((event: CustomEvent<{ app?: unknown }>) => {
  const app = event.detail?.app
  // The switcher is config-derived (Slice 10) — it emits whatever tab id the
  // ACTIVE config declared, not a closed 'garden'|'choreograph' pair, so the
  // shell no longer validates against that hardcoded union.
  if (typeof app !== 'string' || app.length === 0) return
  currentApp = app
  rerenderCurrentSource()
  ok(`chrome event: mn-app-change → app=${app}`)
}) as EventListener)
hostEl.addEventListener('mn-left-mode-change', ((event: CustomEvent<{ mode?: unknown }>) => {
  const mode = event.detail?.mode
  if (!isLeftPanelMode(mode) || mode === currentLeftPanelMode) return
  if (mode === 'graph' && currentRightPanel === 'graph') {
    transitionRightPanel('none')
  }
  currentLeftPanelMode = mode
  rerenderCurrentSource()
  ok(`chrome event: mn-left-mode-change → leftPanelMode=${mode}`)
}) as EventListener)
hostEl.addEventListener('mn-panel-toggle', ((event: CustomEvent<{ panel?: unknown }>) => {
  const panel = event.detail?.panel
  if (!isPanelId(panel)) return
  void shellCommandRegistry.exec(
    `panel.toggle.${panel}`,
    buildCommandContext({ origin: 'chrome event: mn-panel-toggle' }),
  )
}) as EventListener)
hostEl.addEventListener('mn-document-export', () => {
  if (!openDocId) return
  openDocumentExport(openDocId, sidebarNodeById(openDocId)?.label ?? openDocId)
})
// The bottom-bar mirror badges' destination (build bundle review finding 4,
// 2026-07-31) — contested opens the contested centre route, parked opens
// the parked-work face. `mn-bottom-bar` stays controlled (props in, event
// out); this is the ONE place that decides what each kind means, the same
// division `mn-left-mode-change`/`mn-panel-toggle` above already establish.
hostEl.addEventListener('mn-source-badge-activate', ((event: CustomEvent<ChromeSourceBadgeActivateDetail>) => {
  const kind = event.detail?.kind
  if (kind === 'contested') {
    openContestedRoute(currentGraphId)
    ok(`chrome event: mn-source-badge-activate → opened the contested route for ${currentGraphId}`)
  } else if (kind === 'parked') {
    openParkedWorkRoute(currentGraphId, null)
    ok(`chrome event: mn-source-badge-activate → opened the parked-work route for ${currentGraphId}`)
  }
}) as EventListener)
hostEl.addEventListener('mn-breadcrumb-menu-open', ((event: CustomEvent<{ x?: unknown; y?: unknown }>) => {
  const x = typeof event.detail?.x === 'number' ? event.detail.x : 240
  const y = typeof event.detail?.y === 'number' ? event.detail.y : 96
  showBreadcrumbDocumentMenu(x, y)
}) as EventListener)
hostEl.addEventListener('mn-open-shortcuts', () => {
  showShortcutsDialog()
})
hostEl.addEventListener('mn-navigate-home', () => {
  if (openDocId) closeOpenDocumentSurface(openDocId)
  clearTagLensState()
  clearZoteroSourceState()
  clearArtifactSurfaceState()
  currentSidebarSelectedId = null
  currentInspectorSelection = {
    kind: 'graph',
    graphId: currentGraphId,
    label: currentGraphId,
  }
  rerenderCurrentSource()
  ok(`home: ${currentGraphId}`)
})
function settingsFocusReturn(event: Event): HTMLElement | null {
  return event.composedPath().find((candidate): candidate is HTMLElement => (
    candidate instanceof HTMLElement && candidate.isConnected
  )) ?? null
}

function canOpenSettingsInPlace(): boolean {
  const route = document.body.dataset.organismRoute
  return route === undefined || route === 'home'
}

function navigateToSettings(
  section: string | null = null,
  focusReturn: HTMLElement | null = null,
  graphId: string | null = sourceSelect.value === 'CELL_LIVE' ? currentGraphId : null,
): void {
  const target = settingsNavigationUrl(new URL(window.location.href), graphId)
  if (section) target.hash = section
  if (canOpenSettingsInPlace() && settingsOverlayTransition.open(target, { focusReturn })) return
  window.location.assign(`${target.pathname}${target.search}${target.hash}`)
}

hostEl.addEventListener('mn-settings-toggle', (event) => {
  navigateToSettings(null, settingsFocusReturn(event))
})

function bootPublicShellRoute(): boolean {
  const mount = mountPublicShellRoute(hostEl, {
    location: window.location,
    history: window.history,
    storage: window.sessionStorage,
    transport: { baseUrl: '/cell' },
    clipboard: navigator.clipboard,
  })
  if (!mount) return false

  document.body.dataset.organismMode = 'public'
  ok(`public route: resolving /public/${mount.route.segment}`)
  void mount.ready.then(() => {
    if (mount.element.status === 'ready') {
      ok(`public route: loaded /public/${mount.route.segment}`)
    }
  })
  return true
}

function hostedAuthActions(auth: CognitoAuthSession): OrganismAuthActions {
  return {
    async signIn(detail) {
      await auth.signIn(detail.identity, detail.password)
    },
    async signUp(detail) {
      const result = await auth.signUp({
        username: detail.username,
        email: detail.email,
        name: detail.name,
        password: detail.password,
      })
      return {
        identity: detail.username,
        confirmed: result.confirmed,
        deliveryDestination: result.delivery.destination,
        deliveryMedium: result.delivery.deliveryMedium,
      }
    },
    async verifyEmail(detail) {
      await auth.confirmSignUp(detail.identity, detail.code)
    },
    async resendVerification(detail) {
      const delivery = await auth.resendVerification(detail.identity)
      return {
        deliveryDestination: delivery.destination,
        deliveryMedium: delivery.deliveryMedium,
      }
    },
  }
}

function safeAuthReturnUrl(location: Pick<Location, 'href'> | URL): string {
  const url = location instanceof URL ? location : new URL(location.href)
  return settingsReturnPath(url)
}

function signInLocation(returnTo: string): URL {
  const url = new URL('/signin', window.location.origin)
  if (returnTo && returnTo !== '/') url.searchParams.set('returnTo', returnTo)
  return url
}

function makeOpsHealthService(contract: OrganismCellContract): OrganismOpsHealthService {
  return {
    async load() {
      const response = await fetch(
        graphCellUrl(contract, currentGraphId, '/internal/ops/health'),
        { headers: cellRequestHeaders(contract), cache: 'no-store' },
      )
      if (!response.ok) throw new Error(`Ops health failed: HTTP ${response.status}`)
      const payload = await response.json() as unknown
      if (!payload || typeof payload !== 'object') throw new Error('Ops health returned an invalid snapshot')
      const data = 'data' in payload && payload.data && typeof payload.data === 'object'
        ? payload.data
        : payload
      return data
    },
  }
}

const GARDEN_HOME_RECENCY_KEY = 'shrubbery.garden-home.recency.v1'

function gardenHomeRecency(): Readonly<Record<string, number>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GARDEN_HOME_RECENCY_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const recency: Record<string, number> = {}
    for (const [graphId, value] of Object.entries(parsed)) {
      if (graphId && typeof value === 'number' && Number.isFinite(value)) recency[graphId] = value
    }
    return recency
  } catch {
    return {}
  }
}

function markGardenGraphOpened(graphId: string): void {
  const id = graphId.trim()
  if (!id) return
  try {
    const recency = { ...gardenHomeRecency(), [id]: Date.now() }
    window.localStorage.setItem(GARDEN_HOME_RECENCY_KEY, JSON.stringify(recency))
  } catch { /* Recency is a convenience; catalog access must not depend on storage. */ }
}

function gardenHomeDisplayName(identity: string, userId: string): string {
  const source = identity.trim() || userId.trim()
  if (!source || source === 'local-organism') return 'Local Garden'
  const local = source.includes('@') ? source.split('@')[0]! : source
  const words = local.replace(/[._-]+/g, ' ').trim()
  if (!words) return source
  return words.replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase())
}

function gardenHomeAccount(contract: OrganismCellContract): MnGardenHomeAccount {
  const snapshot = hostedAuthSession?.snapshot()
  const userId = snapshot?.userId.trim() || contract.auth.userId().trim() || 'local-organism'
  const identity = snapshot?.identity.trim() || ''
  return {
    userId,
    displayName: gardenHomeDisplayName(identity, userId),
    ...(identity.includes('@') ? { email: identity } : {}),
  }
}

function hostedGardenHomeWorkspaces(
  graphs: readonly GatewayGraphInfo[],
  recency: Readonly<Record<string, number>>,
): readonly GardenHomeWorkspaceSummary[] {
  return graphs.map(graph => ({
    graphId: graph.graphId,
    title: graph.title,
    role: graph.role,
    cellState: graph.cellState,
    lastOpenedAt: recency[graph.graphId] ?? null,
    ...(graph.role === 'viewer'
      ? {
          disabled: true,
          disabledReason: 'This graph is viewer-only; the full Garden workspace still requires editor access.',
        }
      : {}),
  }))
}

function localGardenHomeWorkspaces(
  catalog: unknown,
  recency: Readonly<Record<string, number>>,
): readonly GardenHomeWorkspaceSummary[] {
  const envelope = catalog && typeof catalog === 'object' && !Array.isArray(catalog)
    ? catalog as Record<string, unknown>
    : null
  const rows = Array.isArray(envelope?.graphs)
    ? envelope.graphs
    : Array.isArray(catalog)
      ? catalog
      : null
  if (!rows) throw new Error('Local Garden returned an invalid graph catalog.')

  return rows.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Local Garden graph ${index + 1} is not a catalog record.`)
    }
    const row = value as Record<string, unknown>
    const graphId = typeof row.graph_id === 'string'
      ? row.graph_id.trim()
      : typeof row.graphId === 'string'
        ? row.graphId.trim()
        : ''
    if (!graphId) throw new Error(`Local Garden graph ${index + 1} has no graph id.`)
    const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : graphId
    const role = row.role === 'viewer' || row.role === 'editor' || row.role === 'owner'
      ? row.role
      : 'owner'
    return {
      graphId,
      title,
      role,
      cellState: 'running',
      lastOpenedAt: recency[graphId] ?? null,
    }
  })
}

function localGraphId(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'garden'
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8)
    ?? Date.now().toString(36)
  return `${slug}-${random}`
}

function lifecycleUuid(): string {
  const direct = globalThis.crypto?.randomUUID?.()
  if (direct) return direct
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function navigateToGardenGraph(graphId: string, access = false): void {
  markGardenGraphOpened(graphId)
  const path = gardenGraphPath(graphId)
  const params = new URLSearchParams()
  if (new URL(window.location.href).searchParams.get('source') === 'cell') params.set('source', 'cell')
  if (access) params.set('access', '1')
  const query = params.toString()
  window.location.assign(query ? `${path}?${query}` : path)
}

function createGardenHomeService(contract: OrganismCellContract): OrganismGardenHomeService {
  return {
    async load(): Promise<OrganismGardenHomeSnapshot> {
      const recency = gardenHomeRecency()
      let workspaces: readonly GardenHomeWorkspaceSummary[]
      if (deploymentConfig.mode === 'hosted' && hostedGatewayContract) {
        try {
          workspaces = hostedGardenHomeWorkspaces(await refreshHostedGraphs(false), recency)
        } catch {
          workspaces = localGardenHomeWorkspaces(await contract.rest.graphs(), recency)
        }
        const lifecycle = await hostedGatewayContract.sourceMirror.openGraphLifecycle()
        const hidden = new Set(
          lifecycle.records()
            .filter(intent => intent.kind === 'delete' && intent.status !== 'conflict')
            .map(intent => intent.graphId),
        )
        const merged = workspaces.filter(workspace => !hidden.has(workspace.graphId))
        for (const intent of lifecycle.records()) {
          if (intent.kind !== 'create' || intent.status === 'conflict'
            || merged.some(workspace => workspace.graphId === intent.graphId)) continue
          merged.push({
            graphId: intent.graphId,
            title: intent.title ?? intent.graphId,
            role: 'owner',
            cellState: 'running',
            lastOpenedAt: recency[intent.graphId] ?? null,
          })
        }
        workspaces = merged
        hostedGatewayContract.sourceMirror.backgroundFlushGraphLifecycle()
        for (const workspace of workspaces) {
          if (!workspace.disabled && workspace.role !== 'viewer') {
            hostedGatewayContract.sourceMirror.backgroundSync(workspace.graphId)
          }
        }
      } else {
        workspaces = localGardenHomeWorkspaces(await contract.rest.graphs(), recency)
      }
      return {
        account: gardenHomeAccount(contract),
        workspaces,
      }
    },
    openGraph(workspace) {
      navigateToGardenGraph(workspace.graphId)
    },
    manageAccess(workspace) {
      navigateToGardenGraph(workspace.graphId, true)
    },
    async create() {
      const title = await promptForText({
        title: 'New graph',
        message: 'Name the new graph.',
        placeholder: 'Graph name',
        confirmText: 'Create',
      })
      if (!title) return
      const graphId = localGraphId(title)
      if (deploymentConfig.mode === 'hosted' && hostedGatewayContract) {
        const graphIncarnation = lifecycleUuid()
        const operationId = `graph:create:${graphIncarnation}`
        const lifecycle = await hostedGatewayContract.sourceMirror.openGraphLifecycle()
        await lifecycle.enqueueCreate({
          graphId,
          graphIncarnation,
          operationId,
          title,
        })
        await hostedGatewayContract.sourceMirror.provisionGraph(graphId, graphIncarnation)
        hostedGatewayContract.sourceMirror.backgroundFlushGraphLifecycle()
        navigateToGardenGraph(graphId)
        return
      }
      if (deploymentConfig.mode !== 'hosted' || !hostedGatewayContract) {
        await contract.mcp.toolsCall('create_graph', { graph_id: graphId, title })
      }
      navigateToGardenGraph(graphId)
    },
    openAccount() {
      navigateToSettings('account', null, null)
    },
  }
}

type OrganismRouteLocation = Pick<Location, 'href' | 'pathname' | 'search' | 'hash'> | URL

function organismAppRouteOptions(
  location: OrganismRouteLocation,
  onClose?: (route: OrganismAppRoute) => void,
): MountOrganismAppRouteOptions {
  const detectedRoute = detectOrganismAppRoute(location)
  const contract = deploymentContract ?? (detectedRoute?.kind === 'home' ? createLocalGardendContract() : null)
  // Home is itself a route, but its real local contract must remain available
  // when Account Settings opens over it without rebooting the document.
  if (!deploymentContract && detectedRoute?.kind === 'home' && contract) deploymentContract = contract
  return shellFeatureHost.routeOptions(currentShellContext(location), {
    location,
    history: window.history,
    clipboard: navigator.clipboard,
    onChatSurfaceAction: handleChatSurfaceAction,
    ...(contract ? {
      chatService: () => buildShellChatService(contract),
      opsHealthService: makeOpsHealthService(contract),
      choreographStudioService: new ChoreographStudioService(contract),
      gardenHomeService: createGardenHomeService(contract),
    } : {}),
    ...(hostedAuthSession ? {
      authActions: hostedAuthActions(hostedAuthSession),
      onAuthSuccess: () => {
        window.location.replace(safeAuthReturnUrl(location))
      },
    } : {}),
    lifetime: {
      state: lifetimeBannerStateFor(),
      onAdopt: handleLifetimeAdopt,
      onViewParked: handleLifetimeViewParked,
    },
    reapply: currentReapplyOptions(),
    onClose: onClose ?? ((route) => window.location.assign(
      route.kind === 'settings'
        ? settingsReturnPath(location instanceof URL ? location : new URL(location.href))
        : '/',
    )),
  })
}

function bootOrganismAppRoute(location: OrganismRouteLocation = window.location): boolean {
  const routeOptions = organismAppRouteOptions(location)
  const mount = mountOrganismAppRoute(hostEl, routeOptions)
  if (!mount) return false

  // Lit preserves unmanaged siblings in its render container. Route boots
  // return before the workspace path's equivalent cleanup, so retire the
  // static placeholder here or it remains a real flex sibling above /chat.
  // (And any error panel from a failed cell load, for the same reason.)
  hostEl.querySelector(':scope > .boot-placeholder')?.remove()
  clearCellErrorPanel(hostEl)

  document.body.toggleAttribute(
    ORGANISM_ROUTE_VIEWPORT_FRAME_ATTRIBUTE,
    mount.route.kind === 'chat' || mount.route.kind === 'chat-debug',
  )
  visualViewportFrameController.refresh()

  document.body.dataset.organismMode = 'route'
  document.body.dataset.organismRoute = mount.route.kind
  ok(`route: loading ${mount.route.kind}`)
  void mount.ready.then(() => {
    ok(`route: loaded ${mount.route.kind}`)
  })
  return true
}

async function prepareHostedDeployment(config: HostedDeploymentConfig): Promise<void> {
  const auth = createCognitoAuthSession({
    config: config.cognito,
    ...(config.devServiceProxySubject
      ? { storage: createDevServiceProxyAuthStorage(config.devServiceProxySubject) }
      : {}),
  })
  await auth.whenReady()
  const contract = createHostedGatewayContract({
    gatewayBaseUrl: config.gatewayBaseUrl,
    auth,
  })
  hostedAuthSession = auth
  hostedEvidenceService = createHostedEvidenceService({
    gatewayBaseUrl: config.gatewayBaseUrl,
    graphBaseUrl: graphId => contract.gateway.graphBaseUrl(graphId),
    token: () => auth.token(),
  })
  hostedGatewayContract = contract
  deploymentContract = contract
  stopHostedAuthRefresh?.()
  stopHostedAuthRefresh = auth.startAutoRefresh({
    onError: error => err(`Cognito token refresh failed; retrying:\n${error instanceof Error ? error.message : String(error)}`),
  })
}

function storedHostedGraphId(): string {
  try { return window.sessionStorage.getItem('shrubbery.organism.active-graph')?.trim() ?? '' } catch { return '' }
}

function persistHostedGraphSelection(graphId: string): void {
  markGardenGraphOpened(graphId)
  try { window.sessionStorage.setItem('shrubbery.organism.active-graph', graphId) } catch { /* best effort */ }
  try {
    const url = new URL(window.location.href)
    const graphLocation = gardenGraphLocation(url)
    if (graphLocation) {
      url.pathname = gardenGraphPath(graphId)
      url.searchParams.delete('graph')
    } else {
      url.searchParams.set('graph', graphId)
    }
    url.searchParams.delete('graph_id')
    window.history.replaceState(window.history.state, '', url)
  } catch { /* the live selection remains authoritative */ }
}

/**
 * `SourceMirrorRuntime.rest.graphs()`'s offline fallback rides `Promise<unknown>`
 * (`RestClient.graphs()`'s own contract, `@shrubbery/nucleus`), so its
 * `lifetime` field arrives untyped here too — narrowed the same defensive
 * way `knownCandidateOperationIdsFor` and `contestFromWire` already narrow
 * this codebase's other untyped wire boundaries (master §3 Slice 7).
 */
function lifetimeFromOfflineGraphRow(row: Record<string, unknown>): MnWorkspaceLifetimeState | null {
  const lifetime = row.lifetime
  if (!lifetime || typeof lifetime !== 'object' || Array.isArray(lifetime)) return null
  const candidate = lifetime as Record<string, unknown>
  if (candidate.kind !== 'moved-on') return null
  return {
    kind: 'moved-on',
    previousIncarnation: typeof candidate.previousIncarnation === 'string' ? candidate.previousIncarnation : '',
    parkedDocuments: typeof candidate.parkedDocuments === 'number' ? candidate.parkedDocuments : 0,
    parkedOperations: typeof candidate.parkedOperations === 'number' ? candidate.parkedOperations : 0,
  }
}

async function refreshHostedGraphs(rerender = true): Promise<readonly GatewayGraphInfo[]> {
  if (!hostedGatewayContract) throw new Error('Hosted gateway contract is unavailable')
  hostedGraphsStatus = 'loading'
  hostedGraphsError = ''
  if (rerender && store) rerenderCurrentSource()
  try {
    hostedGraphs = await hostedGatewayContract.gateway.graphs()
    hostedGraphsStatus = 'ready'
    if (rerender && store) rerenderCurrentSource()
    return hostedGraphs
  } catch (error) {
    const offline = await hostedGatewayContract.sourceMirror.rest.graphs()
    const rows = Array.isArray(offline)
      ? offline
      : offline && typeof offline === 'object' && Array.isArray((offline as { graphs?: unknown }).graphs)
        ? (offline as { graphs: unknown[] }).graphs
        : []
    hostedGraphs = rows.flatMap((value): GatewayGraphInfo[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const row = value as Record<string, unknown>
      const graphId = typeof row.graphId === 'string'
        ? row.graphId
        : typeof row.graph_id === 'string'
          ? row.graph_id
          : ''
      if (!graphId) return []
      return [{
        graphId,
        title: typeof row.title === 'string' ? row.title : graphId,
        role: 'owner',
        cellState: 'running',
        lifetime: lifetimeFromOfflineGraphRow(row),
      }]
    })
    if (hostedGraphs.length === 0) {
      hostedGraphsStatus = 'error'
      hostedGraphsError = error instanceof Error ? error.message : String(error)
      if (rerender && store) rerenderCurrentSource()
      throw error
    }
    hostedGraphsStatus = 'ready'
    hostedGraphsError = 'Showing the complete offline source mirror while the gateway is unreachable.'
    if (rerender && store) rerenderCurrentSource()
    return hostedGraphs
  }
}

function initialHostedGraphId(graphs: readonly GatewayGraphInfo[]): string | null {
  const url = new URL(window.location.href)
  const graphLocation = gardenGraphLocation(url)
  if (graphLocation && graphs.some(graph => graph.graphId === graphLocation.graphId)) {
    return graphLocation.graphId
  }
  if (url.searchParams.has('graph') || url.searchParams.has('graph_id')) {
    return selectHostedGraphId(url, graphs)
  }
  const stored = storedHostedGraphId()
  if (stored && graphs.some(graph => graph.graphId === stored)) return stored
  return graphs.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')?.graphId
    ?? graphs.find(graph => graph.role !== 'viewer')?.graphId
    ?? selectHostedGraphId(url, graphs)
}

async function selectHostedGraph(): Promise<string> {
  const graphs = await refreshHostedGraphs(false)
  const graphId = initialHostedGraphId(graphs)
  if (!graphId) throw new Error('No Garden graphs are available to this account.')
  const graph = graphs.find(item => item.graphId === graphId)
  if (graph?.role === 'viewer') {
    throw new Error(
      `Graph "${graphId}" is viewer-only; the current gateway MCP route requires Editor for workspace reads.`,
    )
  }
  cellGraphId.value = graphId
  currentGraphId = graphId
  persistHostedGraphSelection(graphId)
  return graphId
}

async function switchHostedWorkspace(graphId: string): Promise<void> {
  if (!hostedGatewayContract || deploymentConfig.mode !== 'hosted') return
  const graph = hostedGraphs.find(item => item.graphId === graphId)
  if (!graph) {
    hostedGraphsError = `Workspace "${graphId}" is no longer available.`
    hostedGraphsStatus = 'error'
    rerenderCurrentSource()
    return
  }
  if (graph.role === 'viewer') {
    hostedGraphsError = `Workspace "${graphId}" is viewer-only; read-only gateway MCP access is not available yet.`
    hostedGraphsStatus = 'error'
    rerenderCurrentSource()
    return
  }
  if (graphId === currentGraphId && store) return

  hostedWorkspaceBusyId = graphId
  hostedGraphsError = ''
  rerenderCurrentSource()
  try {
    sourceSelect.value = 'CELL_LIVE'
    cellGraphId.value = graphId
    persistHostedGraphSelection(graphId)
    // In ordinary operation the hosted workspace picker is only reachable
    // once boot has already entered cell mode, so store is non-null here —
    // but the chrome that renders it is not itself gated on sourceSelect, so
    // defensively treat a null store (not currently in an active session) as
    // a genuine entry, same rule as every other callsite above.
    if (!store) cellControls.hidden = false
    startCellMode()
  } finally {
    hostedWorkspaceBusyId = ''
    if (store) rerenderCurrentSource()
  }
}

async function createHostedWorkspace(): Promise<void> {
  if (!hostedGatewayContract) return
  const title = await promptForText({
    title: 'New Workspace',
    message: 'Name the new Cloud-2 workspace.',
    placeholder: 'Workspace name',
    confirmText: 'Create',
  })
  if (!title) return
  hostedWorkspaceBusyId = '__create__'
  if (store) rerenderCurrentSource()
  try {
    const graphId = localGraphId(title)
    const graphIncarnation = lifecycleUuid()
    const operationId = `graph:create:${graphIncarnation}`
    const lifecycle = await hostedGatewayContract.sourceMirror.openGraphLifecycle()
    await lifecycle.enqueueCreate({ graphId, graphIncarnation, operationId, title })
    await hostedGatewayContract.sourceMirror.provisionGraph(graphId, graphIncarnation)
    hostedGatewayContract.sourceMirror.backgroundFlushGraphLifecycle()
    hostedGraphs = [
      ...hostedGraphs,
      { graphId, title, role: 'owner', cellState: 'running' },
    ]
    const graph = hostedGraphs.find(item => item.graphId === graphId)
    if (!graph) throw new Error(`Provisioned workspace "${graphId}" was absent from the local graph list.`)
    await switchHostedWorkspace(graph.graphId)
    ok(`created and selected workspace "${graph.title || graph.graphId}"; gateway reconciliation continues in the background`)
  } catch (error) {
    hostedGraphsStatus = 'error'
    hostedGraphsError = error instanceof Error ? error.message : String(error)
    err(`create workspace error:\n${hostedGraphsError}`)
  } finally {
    hostedWorkspaceBusyId = ''
    if (store) rerenderCurrentSource()
  }
}

async function deleteHostedWorkspace(workspace: WorkspaceSummary): Promise<void> {
  if (!hostedGatewayContract || workspace.role !== 'owner') return
  const replacement = hostedGraphs.find(graph => graph.graphId !== workspace.graphId && graph.role !== 'viewer')
  if (workspace.graphId === currentGraphId && !replacement) {
    hostedGraphsStatus = 'error'
    hostedGraphsError = 'Create another editable workspace before deleting the active workspace.'
    rerenderCurrentSource()
    return
  }
  const confirmed = await confirmAction({
    title: 'Delete Workspace',
    message: `Delete "${workspace.title || workspace.graphId}"? This permanently deletes its documents and artifacts.`,
    confirmText: 'Delete',
    variant: 'danger',
  })
  if (!confirmed) return
  hostedWorkspaceBusyId = workspace.graphId
  if (store) rerenderCurrentSource()
  try {
    const mirror = await hostedGatewayContract.sourceMirror.open(workspace.graphId)
    const graphIncarnation = mirror.get().graphIncarnation
    if (!graphIncarnation) {
      throw new Error(
        'This workspace has not completed its background offline activation; open it once before deleting it offline.',
      )
    }
    const operationId = `graph:delete:${lifecycleUuid()}`
    const lifecycle = await hostedGatewayContract.sourceMirror.openGraphLifecycle()
    await lifecycle.enqueueDelete({
      graphId: workspace.graphId,
      graphIncarnation,
      operationId,
    })
    const reconciled = await lifecycle.flush()
    const intent = reconciled.find(record => record.operationId === operationId)
    if (intent?.status === 'conflict') throw new Error(intent.error ?? 'Graph deletion conflicted.')
    homeActivityStore.removeGraph(workspace.graphId)
    const remaining = intent?.status === 'applied'
      ? await refreshHostedGraphs(false)
      : hostedGraphs.filter(graph => graph.graphId !== workspace.graphId)
    if (currentGraphId === workspace.graphId) {
      const replacement = remaining.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')
        ?? remaining.find(graph => graph.role !== 'viewer')
      if (!replacement) throw new Error('Workspace deleted, but no editable workspace remains. Create a new workspace to continue.')
      await switchHostedWorkspace(replacement.graphId)
    }
    ok(`deleted workspace "${workspace.title || workspace.graphId}"`)
  } catch (error) {
    hostedGraphsStatus = 'error'
    hostedGraphsError = error instanceof Error ? error.message : String(error)
    err(`delete workspace error:\n${hostedGraphsError}`)
  } finally {
    hostedWorkspaceBusyId = ''
    if (store) rerenderCurrentSource()
  }
}

async function bootOrganism(): Promise<void> {
  applyCurrent()

  // The packaged Garden desktop app consumes this Shrubbery bundle directly.
  // Tauri contributes only its loopback manifest; the normal CELL_LIVE path
  // remains the one production UI/runtime path after that small native seam.
  const localUrl = new URL(window.location.href)
  let storedNativeGraphId: string | null = null
  try {
    storedNativeGraphId = window.localStorage.getItem('shrubbery.garden-native.active-graph')
  } catch { /* storage can be disabled without disabling the native cell */ }
  const native = await bootstrapTauriLocalCell({
    requestedGraphId: gardenGraphLocation(localUrl)?.graphId
      ?? localUrl.searchParams.get('graph')
      ?? localUrl.searchParams.get('graph_id'),
    storedGraphId: storedNativeGraphId,
  })
  if (native) {
    deploymentContract = native.contract
    currentGraphId = native.graphId
    cellGraphId.value = native.graphId
    try {
      window.localStorage.setItem('shrubbery.garden-native.active-graph', native.graphId)
    } catch { /* best effort */ }
    document.title = 'Garden'

    const settingsGraphId = settingsCellGraph(localUrl)
    if (settingsGraphId) {
      currentGraphId = settingsGraphId
      cellGraphId.value = settingsGraphId
    }
    if (bootOrganismAppRoute()) return

    document.body.dataset.organismMode = 'local-cell'
    sourceSelect.value = 'CELL_LIVE'
    // Boot: the app has no prior mode, so this is always a genuine entry.
    cellControls.hidden = false
    startCellMode()
    ok(
      `Garden native: loading ${currentGraphId} through the Tauri cell` +
      (native.seededUxConfig ? ' (seeded Shrubbery UX config)' : ''),
    )
    return
  }

  if (bootPublicShellRoute()) return

  if (deploymentConfig.mode === 'hosted') {
    await prepareHostedDeployment(deploymentConfig)
    const auth = hostedAuthSession!
    const detectedRoute = detectOrganismAppRoute(window.location)
    const publicRoute = detectedRoute?.kind === 'landing' || detectedRoute?.kind === 'legal'
    const authRoute = detectedRoute?.kind === 'auth'

    if (!auth.isAuthenticated() && !publicRoute && !authRoute) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      bootOrganismAppRoute(signInLocation(returnTo))
      return
    }

    if (auth.isAuthenticated() && !publicRoute && !authRoute && detectedRoute?.kind !== 'home') {
      await selectHostedGraph()
    }
    if (bootOrganismAppRoute()) return

    document.body.dataset.organismMode = 'hosted'
    sourceSelect.value = 'CELL_LIVE'
    // Boot: the app has no prior mode, so this is always a genuine entry.
    cellControls.hidden = false
    startCellMode()
    ok(`hosted Garden: loading ${currentGraphId} through ${deploymentConfig.gatewayBaseUrl}`)
    return
  }

  const settingsGraphId = settingsCellGraph(localUrl)
  if (settingsGraphId) {
    currentGraphId = settingsGraphId
    cellGraphId.value = settingsGraphId
    // Settings needs the same authenticated loopback contract as the workspace,
    // but must not start the workspace render subscription behind the route.
    deploymentContract = createLocalGardendContract()
  }
  if (bootOrganismAppRoute()) return
  // Full-screen local-cell boot runs the real production entrypoint against a
  // headless gardend while the Vite proxy keeps loopback credentials server-side.
  const localRouteUrl = new URL(window.location.href)
  const localParams = localRouteUrl.searchParams
  const localGraphLocation = gardenGraphLocation(localRouteUrl)
  if (localParams.get('source') === 'cell' || localGraphLocation) {
    const graphId = localGraphLocation?.graphId ?? localParams.get('graph')?.trim()
    if (graphId) cellGraphId.value = graphId
    if (graphId) currentGraphId = graphId
    if (graphId) markGardenGraphOpened(graphId)
    document.body.dataset.organismMode = 'local-cell'
    sourceSelect.value = 'CELL_LIVE'
    // Boot: the app has no prior mode, so this is always a genuine entry.
    cellControls.hidden = false
    startCellMode()
    ok(`local Garden: loading ${cellGraphId.value.trim() || 'organism-dev'} through the authenticated /cell proxy`)
    return
  }
  // The local dev SEED_NT fall-through is the ONE mode where the debug
  // scaffolding (source/skin/cell controls, the 420px rail) makes sense. It is
  // now OPT-IN: stamp `playground` for behavior, but REVEAL the rail only when
  // the URL carries `?debug=1` (index.html keys the rail on
  // [data-organism-debug], not on the mode). HIDDEN stays the default — both
  // pre-module and on a plain playground load — so the rail never flashes and a
  // clean boot shows the app + loading placeholder rather than the dev controls.
  // Add `?debug=1` to bring the controls back.
  document.body.dataset.organismMode = 'playground'
  if (new URLSearchParams(window.location.search).has('debug')) {
    document.body.dataset.organismDebug = ''
  }
  sourceSelect.value = 'SEED_NT'
  loadPreset('SEED_NT')
}

// ── Boot: the hosted deployment selects real contracts; local stays a playground. ──
void bootOrganism().catch(error => {
  document.body.dataset.organismMode = 'error'
  err(`Organism boot failed:\n${error instanceof Error ? error.message : String(error)}`)
})
window.addEventListener('beforeunload', () => {
  settingsOverlayTransition.destroy()
  resetQuickClip(true, false)
  teardownExcalidrawRuntime()
  teardownEditorClaim()
  editorRoomPool?.destroyAll()
  editorRoomPool = null
  editorRoomPoolBackend = null
  mobileShellFeatureHost.destroy()
  visualViewportFrameController.destroy()
  shellFeatureHost.destroy()
  stopHostedAuthRefresh?.()
  hostedGatewayContract?.crdt.destroyAll()
  observatoryFreshnessAttachment.dispose()
})
