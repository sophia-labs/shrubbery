/**
 * render-workspace.ts — the REAL render host.
 *
 * `renderWorkspace(config, opts)` is the standalone, store-free Garden render
 * host. Its production path assembles one `LayoutDocument` for the whole main
 * pane (left rail, center pane headers/content, selected right panel) and mounts
 * code-owned face adapters through the recursive Surface interpreter. Top and
 * bottom chrome, graph anchors, and floating overlays remain shell-owned.
 *
 * The original Shoelace spine renderer remains available when `surface` is
 * false for compatibility consumers and focused legacy tests; Organism opts
 * into Surface explicitly.
 *
 * What was STRIPPED in the extraction (this is what makes the host an island):
 *   - app-shell / LitElement `this` — every body now resolves through nucleus
 *     `resolveSurfaceTag` + `stampPanelBody`, never a method.
 *   - the app's reactive state containers (session / filesystem / theme) — none
 *     are read. Collapse state is an explicit `opts` input, not transient state.
 *   - the persistent editor host singleton / center-slot anchor / positioning
 *     authority — there is no live editor node to float; the center region is
 *     stamped as the INERT editor tag like every other un-lifted component.
 *   - chrome runtime props (splitMode / history / chatPopped) — chrome surfaces
 *     are stamped zero-prop via `stampPanelBody`.
 *   - resize event handlers (@sl-reposition) — positions are still emitted from
 *     the plan, but the host has no store to write a new fraction back to.
 *   - presence / radial overlays / banners — out of scope; the host renders only
 *     the structural frame the plan describes plus explicit shell-owned overlays.
 *
 * Both paths read the same nucleus planning outputs. Unknown component bodies
 * stay honest inert `<tag></tag>` placeholders; lifted editor/chat/sidebar
 * seams carry the shell's real bindings and never synthesize content.
 *
 * Dependencies: @shrubbery/nucleus + lit + sibling host mount helpers ONLY — no
 * reactive state containers, no token supply, no native bridge, no concrete CRDT
 * transport, no injected backend seam. (grep-verified by
 * render-workspace-island.test.ts.)
 */

import { html, render, nothing, type TemplateResult } from 'lit'
import { ref } from 'lit/directives/ref.js'
import {
  DEFAULT_FILE_PANE_GROUPING,
  DEFAULT_FILE_PANE_SORT,
  KNOWN_COMPONENTS,
  deriveAppTabs,
  isAppDeclared,
  planFor,
  persistenceOf,
  rightPanelModeFromPanels,
  resolvePanelTag,
  resolveSurfaceTag,
  selectVtuberControlChannel,
  stampPanelBody,
  type AppId,
  type FilePaneAction,
  type FilePaneActionDetail,
  type FilePaneCapabilities,
  type FilePaneColumnPathChangeDetail,
  type FilePaneDropPosition,
  type FilePaneGrouping,
  type FilePaneGroupingChangeDetail,
  type FilePaneNode,
  type FilePaneNodeDetail,
  type FilePaneNodeDropDetail,
  type FilePaneNodeKind,
  type FilePaneOperationFeedback,
  type FilePanePresentation,
  type FilePaneSection,
  type FilePaneSelectionDetail,
  type FilePaneSort,
  type FilePaneSortChangeDetail,
  type FilePaneStatus,
  type FilePaneStorage,
  type PanelId,
  type RightPanelMode,
  type SplitNode,
  type SurfaceRegionRole,
  type VtuberControlChannel,
  type VtuberControlOverlay,
  type WorkspaceConfig,
  type WorkspaceSpinePlan,
} from '@shrubbery/nucleus'
import {
  applyOperation,
  type LayoutDocument,
  type LayoutLeafNode,
  type LayoutNode,
  type LayoutSplitNode,
  type ResourceLocator,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import type { EditorHostBinding } from './editor-host-binding.js'
import type {
  EditorBlockFocusRequest,
  EditorDocumentAccess,
  EditorImageInserter,
  LiveOutlinerCommand,
  WireRadialContextMap,
} from './editor-host.js'
import type { EditorKernelOptions } from './collab/live-editor.js'
import type { WireBundle } from './editor-services/wire-bundle-service.js'
import type { SalienceBundle } from './editor-services/salience-bundle-service.js'
import { isPersistentCenter, renderCenterSlotAnchor, mountEditorHost } from './mount.js'
import { mountGraphHost } from './graph-host.js'
import type { ChatService } from './chat-services/chat-service.js'
import { mountChatHost } from './chat-host/mount-chat-host.js'
import type {
  ChatHeaderActionDetail,
  ChatPresentation,
  HojaWikiLinkResolver,
} from './chat-host/chat-host.js'
import {
  type CenterPaneCloseIntentDetail,
  type CenterPaneFocusIntentDetail,
  type CenterPaneId,
  type CenterPaneProjection,
  type CenterPaneNavigateIntentDetail,
  type CenterPaneOpenIntentDetail,
  type CenterPaneResizeIntentDetail,
  type CenterPanesProjection,
} from './center-panes-contract.js'
import { homeLocation } from './center-panes-model.js'
import type { CenterPaneEditorHostOptions } from './center-panes-host.js'
import './center-panes-host.js'
import {
  mountWiresPanel,
  type WireContextMap,
  type WiresPanelMountOptions,
} from './wires-panel/wires-panel.js'
import {
  mountWirePinnedLayer,
  type PinnedWireBlock,
  type PinnedWireBlockContextMap,
  type PinnedWireDocument,
  type PinnedWireNode,
  type PinnedWireNodeContextMap,
} from './wire-pinned-layer/wire-pinned-layer.js'
import {
  defineWorkspaceSurfaceElement,
  type WorkspaceBoundFaceDefinition,
  type WorkspaceSurfaceBuild,
  type WorkspaceSurfaceElement,
  type WorkspaceSurfaceModel,
} from './layout/workspace-surface-element.js'
import {
  FRAGMENT_GRID_COLLECTION_ADAPTER_ID,
  createFragmentFaceRegistrations,
  createFragmentFaceRegistry,
  createFragmentResourceAdapters,
} from './layout/fragment-face-set.js'
import { NamedQueryRegistry, createQueryTextResolver } from './layout/named-query-registry.js'
import { fragmentNodeId, spliceFragmentDocument } from './layout/fragment-splice.js'
import type { FaceRegistry } from './layout/face-registry.js'
import type { QueryBlockService } from './editor-services/query-block-service.js'
import { objectLocator, contestedCardParams, type SourceObjectService } from './layout/source-object-service.js'
import { CARD_OBJECT_FACE_ID } from './layout/faces/card-object-face.js'
import { SPARQL_BINDINGS_TABLE_FACE_ID } from './layout/faces/sparql-bindings-table-face.js'
import type { FilmstripEvidenceService } from './layout/faces/filmstrip-face.js'
import type { SubjectRowActivateDetail } from './layout/faces/sparql-table-view-element.js'
import { setVegaThemeScopeOverrides } from './editor-services/query-block-vega.js'
import type {
  SurfaceActiveTabChange,
  SurfaceDividerPolicy,
  SurfaceRatioChange,
} from './layout/surface-host.js'
import { LAYOUT_DASHBOARD_COMPONENT } from './layout/layout-dashboard-host.js'

// Re-export the fragment-region marker alongside the other workspace option
// types so shells import everything from one place.
export { LAYOUT_DASHBOARD_COMPONENT }

/**
 * The four engine roles a spine region can play — the same taxonomy garden's
 * `engineRegionRole` assigns, but resolved purely from config (no `this`).
 *
 * An explicit graph-authored `sux:surfaceRole` wins. Older graphs retain the
 * component/dock-state inference below:
 *
 *   'center'  — the editor anchor cell (tag === 'mn-document-editor') OR the
 *               config-declared dashboard center (tag === LAYOUT_DASHBOARD_COMPONENT).
 *   'sidebar' — the left rail (tag === 'mn-sidebar-panel').
 *   'right'   — the right rail (region.dockState === 'stacked').
 *   'other'   — any other content region (zero-prop stamp).
 */
export type RegionRole = SurfaceRegionRole

/** Shell-owned navigation intent emitted by chat surface cards. Kept structural
 * here so the top-level render island stays free of chat-kernel imports. */
export interface ChatSurfaceActionIntent {
  readonly documentId: string
  readonly title: string
  readonly action: string
  readonly blockId?: string | null
}

export type SidebarNodeKind = FilePaneNodeKind
export type SidebarAction = FilePaneAction
export type SidebarNode = FilePaneNode
export type SidebarSection = FilePaneSection
export type SidebarNodeDetail = FilePaneNodeDetail
export type SidebarDropPosition = FilePaneDropPosition
export type SidebarNodeDropDetail = FilePaneNodeDropDetail
export type SidebarActionDetail = FilePaneActionDetail

export interface DailyNoteDoc {
  readonly id: string
  readonly updatedAt?: number
}

export interface DailyNoteOpenDetail {
  readonly dateKey: string
}

export interface DailyNoteCalendarAnchorDetail {
  readonly anchor: HTMLElement
}

export interface DailyNoteAdjacency {
  readonly before: number
  readonly after: number
}

export interface DailyNotePopoverState {
  readonly x: number
  readonly y: number
  readonly viewedKey: string
}

export type TagLensStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TagLensBlock {
  readonly id: string
  readonly documentId: string
  readonly documentTitle?: string | null
  readonly blockId?: string | null
  readonly text: string
  readonly type?: string | null
  readonly updatedAt?: string | null
}

export interface TagLensRefreshDetail {
  readonly tagName: string
}

export interface TagLensOpenBlockDetail {
  readonly tagName: string
  readonly documentId: string
  readonly blockId?: string | null
  readonly block: TagLensBlock
}

export interface TagLensOptions {
  readonly tagName: string
  readonly status: TagLensStatus
  readonly blocks?: readonly TagLensBlock[]
  readonly error?: string | null
  readonly onRefresh?: (detail: TagLensRefreshDetail) => void
  readonly onOpenBlock?: (detail: TagLensOpenBlockDetail) => void
}

export interface ZoteroSourceItem {
  readonly key?: string | null
  readonly title?: string | null
  readonly label?: string | null
  readonly itemType?: string | null
  readonly creatorSummary?: string | null
  readonly year?: string | null
  readonly abstractNote?: string | null
  readonly tags?: readonly string[]
}

export interface ZoteroSourceIncomingWire {
  readonly id: string
  readonly predicateLabel?: string | null
  readonly otherDocumentId?: string | null
  readonly otherBlockId?: string | null
  readonly otherTitle?: string | null
  readonly otherSnippet?: string | null
}

export interface ZoteroSourceAnnotation {
  readonly key: string
  readonly kind: string
  readonly text?: string | null
  readonly comment?: string | null
  readonly color?: string | null
  readonly page?: string | null
}

export interface ZoteroSourceBaseDetail {
  readonly artifactId: string
  readonly zoteroKey: string
  readonly graphId: string | null
}

export interface ZoteroSourceOpenZoteroDetail extends ZoteroSourceBaseDetail {
  readonly url: string
}

export interface ZoteroSourceOpenTagDetail extends ZoteroSourceBaseDetail {
  readonly tag: string
  readonly normalizedTag: string
}

export interface ZoteroSourceOpenDocumentDetail extends ZoteroSourceBaseDetail {
  readonly documentId: string
  readonly wire: ZoteroSourceIncomingWire
}

export interface ZoteroSourcePromoteAnnotationDetail extends ZoteroSourceBaseDetail {
  readonly annotation: ZoteroSourceAnnotation
  readonly annotationKey: string
  readonly citation: string
}

export interface ZoteroSourceOptions {
  readonly artifactId: string
  readonly zoteroKey?: string | null
  readonly graphId?: string | null
  readonly item?: ZoteroSourceItem | null
  readonly annotations?: readonly ZoteroSourceAnnotation[]
  readonly incomingWires?: readonly ZoteroSourceIncomingWire[]
  readonly promotedAnnotationKeys?: ReadonlySet<string> | readonly string[] | null
  readonly loading?: boolean
  readonly error?: string | null
  readonly onReload?: (detail: ZoteroSourceBaseDetail) => void
  readonly onOpenZotero?: (detail: ZoteroSourceOpenZoteroDetail) => void
  readonly onOpenTag?: (detail: ZoteroSourceOpenTagDetail) => void
  readonly onOpenDocument?: (detail: ZoteroSourceOpenDocumentDetail) => void
  readonly onPromoteAnnotation?: (detail: ZoteroSourcePromoteAnnotationDetail) => void
}

export type ArtifactViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ArtifactViewIntentDetail {
  readonly graphId: string
  readonly artifactId: string
}

export interface ArtifactViewOpenDocumentDetail extends ArtifactViewIntentDetail {
  readonly documentId: string
}

export type ArtifactHistoryStatus = ArtifactViewStatus

export interface ArtifactHistoryRevision {
  readonly revisionId: string
  readonly createdAt: number | string | Date
  readonly trigger?: string
  readonly label?: string | null
  readonly filename?: string | null
  readonly mimeType?: string | null
  readonly sizeBytes?: number | null
  readonly thumbnailUrl?: string | null
}

export interface ArtifactHistoryRevisionDetail extends ArtifactViewIntentDetail {
  readonly revisionId: string
}

export interface ArtifactEditorSaveDetail extends ArtifactViewIntentDetail {
  readonly dataUrl: string
  readonly mimeType: 'image/png' | 'image/jpeg'
}

export interface ArtifactEditorGenerateDetail extends ArtifactEditorSaveDetail {
  readonly prompt: string
  readonly target: 'version' | 'artifact'
}

export interface ArtifactHistoryOptions {
  readonly graphId: string
  readonly artifactId: string
  readonly status: ArtifactHistoryStatus
  readonly error?: string | null
  readonly revisions?: readonly ArtifactHistoryRevision[]
  readonly restoringRevisionId?: string | null
  readonly onClose?: (detail: ArtifactViewIntentDetail) => void
  readonly onRefresh?: (detail: ArtifactViewIntentDetail) => void
  readonly onRestore?: (detail: ArtifactHistoryRevisionDetail) => void
}

export interface ArtifactViewOptions {
  readonly graphId: string
  readonly artifactId: string
  readonly title?: string | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  readonly artifactStatus?: string | null
  readonly ingestedDocumentId?: string | null
  readonly previewUrl?: string | null
  readonly status: ArtifactViewStatus
  readonly error?: string | null
  readonly history?: ArtifactHistoryOptions | null
  readonly editor?: {
    readonly open: boolean
    readonly srcUrl?: string | null
    readonly mimeType?: string | null
    readonly prompt?: string | null
    readonly generationTarget?: 'version' | 'artifact'
    readonly generating?: boolean
    readonly generationError?: string | null
    readonly onCancel?: (detail: ArtifactViewIntentDetail) => void
    readonly onSave?: (detail: ArtifactEditorSaveDetail) => void
    readonly onGenerate?: (detail: ArtifactEditorGenerateDetail) => void
  } | null
  readonly onRefresh?: (detail: ArtifactViewIntentDetail) => void
  readonly onHistoryOpen?: (detail: ArtifactViewIntentDetail) => void
  readonly onEditOpen?: (detail: ArtifactViewIntentDetail) => void
  readonly onDownload?: (detail: ArtifactViewIntentDetail) => void
  readonly onOpenDocument?: (detail: ArtifactViewOpenDocumentDetail) => void
}

export type GraphPanelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type GraphPanelViewMode = 'workspace' | 'document'
export type GraphPanelNodeKind =
  | 'graph'
  | 'folder'
  | 'document'
  | 'read-only-document'
  | 'artifact'
  | 'tag'
  | 'portal'
  | 'heading'
  | 'paragraph'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'blockquote'
  | 'code'
  | 'footnote'
  | 'image'
  | 'math'
  | 'table'
  | 'query'
  | 'horizontal-rule'
  | 'unknown'

export interface GraphPanelNode {
  readonly id: string
  readonly label?: string
  readonly note?: string
  readonly kind?: GraphPanelNodeKind
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly artifactId?: string | null
  readonly folderId?: string | null
  readonly tagName?: string | null
  readonly section?: 'documents' | 'artifacts' | 'tags' | string | null
  readonly parentId?: string | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  readonly status?: string | null
  readonly ingestedDocumentId?: string | null
  readonly blockId?: string | null
  readonly order?: number | null
  readonly depth?: number | null
  readonly snippet?: string | null
  readonly readOnly?: boolean
  readonly checked?: boolean | null
}

export interface GraphPanelEdge {
  readonly id?: string
  readonly from: string
  readonly to: string
  readonly predicate: string
  readonly predicateLabel?: string
  readonly kind?: 'predicate' | 'wire'
  readonly note?: string
  readonly bidirectional?: boolean
  readonly category?: 'default' | 'quantity' | 'quality' | 'relation' | 'modality' | 'connective' | 'disjunctive' | 'conjunctive'
}

export interface GraphPanelRefreshDetail {
  readonly reason: 'manual'
}

export interface GraphPanelNodeOpenDetail {
  readonly id: string
  readonly node: GraphPanelNode
}

export interface GraphPanelNodeSelectDetail {
  readonly id: string
  readonly node: GraphPanelNode
}

export interface GraphPanelEdgeSelectDetail {
  readonly edge: GraphPanelEdge
}

export interface GraphPanelViewModeChangeDetail {
  readonly mode: GraphPanelViewMode
}

export interface GraphPanelOptions {
  readonly title?: string | null
  readonly subtitle?: string | null
  readonly status: GraphPanelStatus
  readonly error?: string | null
  readonly nodes?: readonly GraphPanelNode[]
  readonly edges?: readonly GraphPanelEdge[]
  readonly documentNodes?: readonly GraphPanelNode[]
  readonly documentEdges?: readonly GraphPanelEdge[]
  readonly viewMode?: GraphPanelViewMode
  readonly lockWorkspaceMode?: boolean
  readonly selectedNodeId?: string | null
  readonly canNavigateBack?: boolean
  readonly canNavigateForward?: boolean
  readonly onRefresh?: (detail: GraphPanelRefreshDetail) => void
  readonly onSelectNode?: (detail: GraphPanelNodeSelectDetail) => void
  readonly onOpenNode?: (detail: GraphPanelNodeOpenDetail) => void
  readonly onSelectEdge?: (detail: GraphPanelEdgeSelectDetail) => void
  readonly onViewModeChange?: (detail: GraphPanelViewModeChangeDetail) => void
  readonly onNavigateBack?: () => void
  readonly onNavigateForward?: () => void
}

export interface OutlinePanelHeading {
  readonly id: string
  readonly level: number
  readonly text: string
}

export interface OutlinePanelNavigateDetail {
  readonly blockId: string
}

export interface OutlinePanelCommandDetail {
  readonly command: LiveOutlinerCommand
}

export interface OutlinePanelOptions {
  readonly documentOpen: boolean
  readonly headings?: readonly OutlinePanelHeading[]
  readonly activeHeadingId?: string | null
  readonly onNavigate?: (detail: OutlinePanelNavigateDetail) => void
  readonly onCommand?: (detail: OutlinePanelCommandDetail) => void
}

export type DocHistoryCursorId = 'live' | string
export type DocHistoryFocusedSide = 'older' | 'newer'
export type DocHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'
export type DocHistoryDiffStyle = 'split' | 'unified'

export interface DocHistorySnapshot {
  readonly id: string
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly label?: string | null
  readonly createdAt: string | number | Date
  readonly tier?: string | null
  readonly isManual?: boolean
  readonly snapshotCount?: number | null
  readonly charsAdded?: number | null
  readonly charsRemoved?: number | null
  readonly blocksAdded?: number | null
  readonly blocksRemoved?: number | null
  readonly blocksModified?: number | null
}

export interface DocHistoryCursorDetail {
  readonly olderId: DocHistoryCursorId
  readonly newerId: DocHistoryCursorId
  readonly focusedSide: DocHistoryFocusedSide
}

export interface DocHistorySnapshotDetail {
  readonly snapshotId: string
}

export interface DocHistoryRestoreDetail {
  readonly snapshotId: string
}

export interface DocHistoryDiffStyleDetail {
  readonly diffStyle: DocHistoryDiffStyle
}

export interface DocHistoryOptions {
  readonly title?: string | null
  readonly subtitle?: string | null
  readonly status: DocHistoryStatus
  readonly error?: string | null
  readonly snapshots?: readonly DocHistorySnapshot[]
  readonly olderId?: DocHistoryCursorId | null
  readonly newerId?: DocHistoryCursorId | null
  readonly focusedSide?: DocHistoryFocusedSide | null
  readonly olderText?: string | null
  readonly newerText?: string | null
  readonly diffStatus?: DocHistoryStatus | null
  readonly diffError?: string | null
  readonly diffStyle?: DocHistoryDiffStyle | null
  readonly restoreDisabled?: boolean
  readonly onCursorChange?: (detail: DocHistoryCursorDetail) => void
  readonly onSaveCurrent?: () => void
  readonly onBookmark?: (detail: DocHistorySnapshotDetail) => void
  readonly onDelete?: (detail: DocHistorySnapshotDetail) => void
  readonly onRestore?: (detail: DocHistoryRestoreDetail) => void
  readonly onRefresh?: () => void
  readonly onClose?: () => void
  readonly onDiffStyleChange?: (detail: DocHistoryDiffStyleDetail) => void
}

export interface WorkspaceComment {
  readonly id: string
  readonly author: string
  readonly text: string
  readonly quotedText?: string | null
  readonly createdAt: number | Date
  readonly updatedAt?: number | Date | null
  readonly resolved?: boolean
  readonly documentPosition?: number | null
  readonly blockId?: string | null
}

export interface WorkspaceCommentDetail {
  readonly id: string
  readonly comment: WorkspaceComment
}

export interface WorkspaceCommentHoverDetail {
  readonly id: string | null
  readonly comment: WorkspaceComment | null
}

export interface WorkspaceCommentEditDetail extends WorkspaceCommentDetail {
  readonly text: string
}

export interface WorkspaceCommentResolveDetail extends WorkspaceCommentDetail {
  readonly resolved: boolean
}

export interface WorkspaceCommentsOptions {
  readonly comments?: readonly WorkspaceComment[]
  readonly hoveredCommentId?: string | null
  readonly emptyShortcut?: string | null
  readonly onSelect?: (detail: WorkspaceCommentDetail) => void
  readonly onHover?: (detail: WorkspaceCommentHoverDetail) => void
  readonly onEdit?: (detail: WorkspaceCommentEditDetail) => void
  readonly onResolve?: (detail: WorkspaceCommentResolveDetail) => void
  readonly onDelete?: (detail: WorkspaceCommentDetail) => void
}

export interface WorkspaceInspectorIdentityChip {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}

export interface WorkspaceInspectorIdentity {
  readonly kind: string
  readonly icon?: string
  readonly title: string
  readonly typeLabel: string
  readonly chips?: readonly WorkspaceInspectorIdentityChip[]
}

export type WorkspaceInspectorRelationsScope = 'active' | 'inactive' | 'none'

export interface WorkspaceInspectorRelationItem {
  readonly id: string
  readonly primary: string
  readonly secondary?: string
  readonly icon?: string
}

export interface WorkspaceInspectorRelationGroup {
  readonly key: string
  readonly label: string
  readonly icon?: string
  readonly items: readonly WorkspaceInspectorRelationItem[]
}

export interface WorkspaceInspectorRelations {
  readonly scope: WorkspaceInspectorRelationsScope
  readonly groups?: readonly WorkspaceInspectorRelationGroup[]
}

export interface WorkspaceInspectorModel {
  readonly identity: WorkspaceInspectorIdentity
  readonly relations?: WorkspaceInspectorRelations
}

export interface WorkspaceInspectorActionHeader {
  readonly type: 'header'
  readonly content: string
}

export interface WorkspaceInspectorActionDivider {
  readonly type: 'divider'
}

export interface WorkspaceInspectorActionItem {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly variant?: 'default' | 'danger'
}

export type WorkspaceInspectorAction =
  | WorkspaceInspectorActionHeader
  | WorkspaceInspectorActionDivider
  | WorkspaceInspectorActionItem

export interface WorkspaceInspectorModifiers {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

export interface WorkspaceInspectorActionDetail {
  readonly id: string
  readonly action: WorkspaceInspectorActionItem
  readonly modifiers: WorkspaceInspectorModifiers
}

export interface WorkspaceInspectorRelationOpenDetail {
  readonly groupKey: string
  readonly id: string
  readonly item: WorkspaceInspectorRelationItem
}

export interface WorkspaceInspectorOptions {
  readonly model?: WorkspaceInspectorModel | null
  readonly actions?: readonly WorkspaceInspectorAction[]
  readonly showClose?: boolean
  readonly onClose?: () => void
  readonly onAction?: (detail: WorkspaceInspectorActionDetail) => void
  readonly onRelationOpen?: (detail: WorkspaceInspectorRelationOpenDetail) => void
}

export interface WorkspaceChromeBreadcrumb {
  readonly id: string
  readonly label: string
  readonly kind?: 'graph' | 'document' | 'artifact' | 'view'
  readonly current?: boolean
  readonly disabled?: boolean
}

export interface WorkspaceChromeDocumentStats {
  readonly words: number
  readonly characters: number
  readonly selectedCharacters?: number
  readonly blockType?: string | null
  /** Whole minutes, ceil-rounded, same 200wpm baseline as the OG bottom bar. */
  readonly readingTimeMinutes?: number
}

export interface WorkspaceChromePresencePerson {
  readonly id: string
  readonly name: string
  readonly color: string
}

/**
 * The bottom-bar mirror badges (master §3 Slice 4; structural mirror of
 * `@shrubbery/components`' `ChromeSourceBadge` — this package stays free of
 * a components dependency, same pattern as `WorkspaceChromeDocumentStats`
 * above).
 */
export type WorkspaceChromeSourceBadgeKind = 'contested' | 'pending' | 'parked' | 'unknown' | 'needs-repair'

export interface WorkspaceChromeSourceBadge {
  readonly kind: WorkspaceChromeSourceBadgeKind
  readonly glyph: string
  readonly label: string
  readonly accessibleName: string
  readonly hint: string
}

export interface WorkspaceChromeSourceStatus {
  readonly badges: readonly WorkspaceChromeSourceBadge[]
}

export type WorkspaceQuickClipStatus = 'idle' | 'processing' | 'complete' | 'error'
export type WorkspaceQuickClipKind = 'web' | 'youtube'

export interface WorkspaceQuickClipRequestDetail {
  readonly url: string
  readonly kind: WorkspaceQuickClipKind
}

export interface WorkspaceQuickClipOptions {
  readonly available: boolean
  readonly status: WorkspaceQuickClipStatus
  readonly error?: string | null
  readonly onRequest?: (detail: WorkspaceQuickClipRequestDetail) => void
  readonly onReset?: () => void
  readonly onOpenChange?: (open: boolean) => void
}

export type WorkspaceAccessRole = 'viewer' | 'editor' | 'owner'
export type WorkspaceAccessCurrentRole = WorkspaceAccessRole | 'unknown'
export type WorkspaceAccessStatus = 'idle' | 'loading' | 'ready' | 'error'
export type WorkspaceAccessBusyAction = 'add' | 'role' | 'remove' | 'refresh'

export interface WorkspaceAccessGrant {
  readonly userId: string
  readonly role: WorkspaceAccessRole
  readonly grantedAt: string
  readonly grantedBy: string
  readonly email?: string
  readonly displayName?: string
}

export interface WorkspaceAccessAddDetail {
  readonly userId: string
  readonly role: Exclude<WorkspaceAccessRole, 'owner'>
  readonly email?: string
  readonly displayName?: string
}

export interface WorkspaceAccessRoleChangeDetail {
  readonly userId: string
  readonly role: Exclude<WorkspaceAccessRole, 'owner'>
}

export interface WorkspaceAccessRemoveDetail {
  readonly userId: string
}

/** Hosted member-grant projection. Public share links remain a separate absent capability. */
export interface WorkspaceAccessOptions {
  readonly graphId: string
  readonly graphTitle: string
  readonly currentRole: WorkspaceAccessCurrentRole
  readonly status: WorkspaceAccessStatus
  readonly grants: readonly WorkspaceAccessGrant[]
  readonly error?: string | null
  readonly notice?: string | null
  readonly busyUserId?: string | null
  readonly busyAction?: WorkspaceAccessBusyAction | null
  readonly onOpen?: () => void
  readonly onRefresh?: () => void
  readonly onAdd?: (detail: WorkspaceAccessAddDetail) => void
  readonly onRoleChange?: (detail: WorkspaceAccessRoleChangeDetail) => void
  readonly onRemove?: (detail: WorkspaceAccessRemoveDetail) => void
}

export type WorkspaceTtsStatus = 'idle' | 'loading' | 'playing' | 'paused'
export type WorkspaceTtsAction =
  | 'play'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'skip-back'
  | 'skip-forward'
  | 'speed'
  | 'tier'

export interface WorkspaceTtsActionDetail {
  readonly action: WorkspaceTtsAction
  readonly status: WorkspaceTtsStatus
  readonly speed?: number
  readonly tier?: string
}

export interface WorkspaceTtsToolbarDetail {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

/** Controlled playback projection. Speech/audio ownership remains in the shell. */
export interface WorkspaceTtsOptions {
  readonly available: boolean
  readonly status: WorkspaceTtsStatus
  readonly currentBlockIndex: number
  readonly totalBlocks: number
  readonly currentBlockText: string
  readonly tier: string
  readonly speed: number
  readonly speeds?: readonly number[]
  readonly tiers?: readonly { readonly value: string; readonly label: string }[]
  readonly onAction?: (detail: WorkspaceTtsActionDetail) => void
  readonly onToolbarToggle?: (detail: WorkspaceTtsToolbarDetail) => void
}

export type WorkspaceRole = 'viewer' | 'editor' | 'owner'
export type WorkspaceCellState = 'running' | 'stopped'

/**
 * My mirror's relation to this graph's LIFETIME (master §3 Slice 7).
 * Structurally identical to `@shrubbery/components`'
 * `MnWorkspaceLifetimeState` — declared locally rather than imported,
 * because `@shrubbery/runtime` does not (and should not) depend on
 * `@shrubbery/components`; `<mn-top-bar>`'s own `.workspaces=` property
 * binding is untyped at this lit-html boundary either way.
 */
export interface WorkspaceLifetimeSummary {
  readonly kind: 'moved-on'
  readonly previousIncarnation: string
  readonly parkedDocuments: number
  readonly parkedOperations: number
}

export interface WorkspaceSummary {
  readonly graphId: string
  readonly title: string
  readonly role: WorkspaceRole
  readonly cellState: WorkspaceCellState
  readonly disabled?: boolean
  readonly disabledReason?: string
  /** Present only when the shell's mirror holds work for a life this graph
   *  no longer has (WS3 §4.6's reversed graph-list filter). */
  readonly lifetime?: WorkspaceLifetimeSummary | null
}

export interface WorkspaceHomeDocument {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
  readonly timestamp?: number | null
  readonly readOnly?: boolean
}

export interface WorkspaceHomeOptions {
  readonly status?: 'loading' | 'ready' | 'error'
  readonly error?: string | null
  readonly graphId: string
  readonly graphTitle: string
  readonly resume?: WorkspaceHomeDocument | null
  readonly dreamJournal?: WorkspaceHomeDocument | null
  readonly pinned?: readonly WorkspaceHomeDocument[]
  readonly newlyCreated?: readonly WorkspaceHomeDocument[]
  readonly recent?: readonly WorkspaceHomeDocument[]
  readonly onNewDocument?: () => void
  readonly onOpenDocument?: (document: WorkspaceHomeDocument) => void
  readonly onPinDocument?: (document: WorkspaceHomeDocument, pinned: boolean) => void
}

export type WorkspacePanelSplitRole = 'left' | 'right'

export interface WorkspacePanelRepositionDetail {
  readonly role: WorkspacePanelSplitRole
  /** Physical width of the role's pane, after Garden-compatible clamping. */
  readonly width: number
  /** Shoelace's percentage for its primary pane. */
  readonly position: number
  readonly size: number
}

/**
 * Controlled per-tab desktop panel state. The shell owns persistence; runtime
 * only reflects widths/modes and forwards user intent. Pixel widths are used so
 * resizing the browser does not silently mutate a tab's chosen panel mode.
 */
export interface WorkspacePanelLayoutOptions {
  readonly leftWidth?: number
  readonly rightWidth?: number
  readonly leftExpanded?: boolean
  readonly leftSnap?: string
  readonly rightSnap?: string
  readonly snapThreshold?: number
  readonly onReposition?: (detail: WorkspacePanelRepositionDetail) => void
  readonly onLeftExpandedChange?: (expanded: boolean) => void
  readonly onLeftCollapsedChange?: (collapsed: boolean) => void
  readonly onRightCollapsedChange?: (collapsed: boolean) => void
}

/**
 * Controlled, shell-owned dual-document center. Runtime renders the stable pane
 * hosts and forwards typed intent; it never chooses a document or opens a CRDT
 * room. A shell may therefore keep one provider claim per visible pane without
 * leaking backend ownership into the layout interpreter.
 */
export interface WorkspaceCenterPanesOptions {
  readonly projection: CenterPanesProjection
  readonly editorHosts: ReadonlyMap<CenterPaneId, CenterPaneEditorHostOptions>
  readonly onOpen?: (detail: CenterPaneOpenIntentDetail) => void
  readonly onFocus?: (detail: CenterPaneFocusIntentDetail) => void
  readonly onClose?: (detail: CenterPaneCloseIntentDetail) => void
  readonly onNavigate?: (detail: CenterPaneNavigateIntentDetail) => void
  readonly onResize?: (detail: CenterPaneResizeIntentDetail) => void
}

/**
 * Transient, NOT-in-config render options. These map the per-tab UI state that
 * garden's app-shell holds in stores onto the general spine. They are inputs to
 * the host, never read from a store.
 */
export interface RenderWorkspaceOptions {
  /**
   * Route the whole main pane through one recursive LayoutDocument and the
   * production FaceRegistry/ResourceBroker interpreter. The legacy spine stays
   * available for embedders during migration; Organism enables Surface.
   */
  readonly surface?: boolean
  /** The 4th `app` dimension — selects the per-app region-set via planFor. */
  readonly app?: AppId
  /** Collapse the sidebar region (drops it from the present spine). */
  readonly leftCollapsed?: boolean
  /** Collapse the right rail (drops it from the present spine). */
  readonly rightCollapsed?: boolean
  /** Optional controlled divider widths, snap points, and discrete modes. */
  readonly panelLayout?: WorkspacePanelLayoutOptions
  /**
   * OPTIONAL live Class-B editor host binding (D4 ReactiveSource). When present,
   * a persistent-relocatable (Class B) center region is rendered as an EMPTY
   * position anchor in the arm, and ONE <sh-editor-host> live node is mounted
   * once as a keyed sibling of the spine inside `.main`. When ABSENT, the center
   * is the same inert stamp as before — byte-identical back-compat.
   */
  readonly editorHost?: EditorHostBinding
  /** Optional controlled dual-document center. Takes precedence over editorHost. */
  readonly centerPanes?: WorkspaceCenterPanesOptions | null
  /**
   * OPTIONAL assembled kernel-options (the navigation callbacks the shell builds
   * via assembleEditorServices(contract.rest, getScope) → buildKernelOptions(services,
   * scope)). A SIBLING of editorHost — forwarded to mountEditorHost as the kernel
   * slot for the live editor, never folded into the binding. Carried as the OPAQUE
   * EditorKernelOptions alias (re-exported through the sibling collab module) so the
   * island host never imports @shrubbery/editor-kernel. The shell builds it ONCE per
   * provider claim and passes a stable reference. Absent ⇒ the rung-3 bare collab
   * editor (no wikilink callbacks) — back-compat.
   */
  readonly editorKernelOptions?: EditorKernelOptions
  /**
   * Optional stable block id restored into the editor's outliner-zoom plugin
   * after the live body mounts. Shells typically source this from Garden's
   * `?b=` URL param; absent/null means unzoomed.
   */
  readonly editorInitialZoomBlockId?: string | null
  /** Transient block-focus request after wire/wiki/chat navigation. */
  readonly editorBlockFocusRequest?: EditorBlockFocusRequest | null
  /** Optional Garden wire read-side bundle for editor gutter indicators/menu. */
  readonly editorWireBundle?: WireBundle | null
  /** Optional shell-owned context previews for the editor radial wire overlay. */
  readonly editorWireRadialContexts?: WireRadialContextMap | null
  /** Optional per-document salience scores for the editor's value gutter. */
  readonly editorSalienceBundle?: SalienceBundle | null
  /** Optional shell-owned Garden-style image picker/uploader for the editor toolbar. */
  readonly editorImageInserter?: EditorImageInserter | null
  /** Authoritative access/source projection for the open document. */
  readonly editorDocumentAccess?: EditorDocumentAccess | null
  /** Browser/local TTS state and intents, owned by the surrounding shell. */
  readonly tts?: WorkspaceTtsOptions | null
  /** Optional shell-owned Garden document history overlay state. */
  readonly docHistory?: DocHistoryOptions | null
  /**
   * Controlled Garden Wires-panel projection and capabilities. Reads, writes,
   * confirmation policy, and panel persistence remain owned by the shell.
   */
  readonly wirePanel?: WiresPanelMountOptions | null
  /** Optional shell-owned context previews for the Wires panel. */
  readonly wirePanelContexts?: WireContextMap | null
  /** Optional shell-owned local document context for Wires panel actions. */
  readonly wirePanelLocalContext?: {
    readonly graphId?: string | null
    readonly documentId?: string | null
    readonly title?: string | null
  } | null
  /** Optional shell-owned pinned wire/document overlay state. */
  readonly wirePinnedDocs?: readonly PinnedWireDocument[] | null
  /** Optional shell-owned pinned wire/node overlay state. */
  readonly wirePinnedNodes?: readonly PinnedWireNode[] | null
  /** Optional shell-owned pinned wire/block overlay state. */
  readonly wirePinnedBlocks?: readonly PinnedWireBlock[] | null
  /** Optional shell-owned context previews for pinned wire/block cards. */
  readonly wirePinnedBlockContexts?: PinnedWireBlockContextMap | null
  /** Optional shell-owned context previews for pinned wire/node endpoint cards. */
  readonly wirePinnedNodeContexts?: PinnedWireNodeContextMap | null
  /**
   * OPTIONAL live Class-B chat host. When present, any region whose configured
   * surface resolves to Garden's legacy `mn-chat-panel` is lifted to the real
   * `<sh-chat-host>` + `<sh-chat-panel>` organism. When absent, the old inert
   * `<mn-chat-panel>` stamp remains byte-identical.
   */
  readonly chatHost?: {
    readonly service: ChatService | null
    readonly sessionId: string | null
    readonly presentation?: ChatPresentation
    readonly composerReferenceResolver?: HojaWikiLinkResolver
    readonly onSurfaceAction?: (action: ChatSurfaceActionIntent) => void
    readonly onHeaderAction?: (detail: ChatHeaderActionDetail) => void
  }
  /**
   * Controlled chrome state owned by the shell. This is Garden's per-tab/session
   * UI state as DATA: the renderer only reflects it into backend-free chrome
   * components and resolves right-rail panel tags from config.
   */
  readonly chrome?: {
    readonly activeApp?: AppId
    /**
     * OVERRIDE for the config-derived app-switcher tabs (Slice 10). Absent ⇒
     * `deriveAppTabs(config)` — every app the ACTIVE config declares via
     * `appRootRegions`, default app first (nucleus interpreter). A shell
     * supplies this only to test/override; the render host already computes
     * the honest default from the same config it renders, so no caller needs
     * to remember to keep this in sync by hand.
     */
    readonly apps?: readonly AppId[]
    readonly leftPanelMode?: 'files' | 'graph' | 'outline'
    /** Scalar Garden right-rail selection. `'none'` means closed. */
    readonly rightPanel?: RightPanelMode
    /** @deprecated Compatibility input; only the last entry is selected. */
    readonly rightPanels?: readonly PanelId[]
    readonly isDark?: boolean
    readonly activeSkin?: 'garden' | 'emporium' | '98' | 'glass' | 'research' | 'greenhouse' | 'observatory'
    readonly breadcrumbs?: readonly WorkspaceChromeBreadcrumb[]
    readonly itemCount?: number | null
    readonly documentStats?: WorkspaceChromeDocumentStats | null
    readonly documentExportAvailable?: boolean
    readonly presence?: readonly WorkspaceChromePresencePerson[]
    readonly syncState?:
      | 'idle'
      | 'connecting'
      | 'synced'
      | 'reconnecting'
      | 'disconnected'
      | 'error'
    readonly runtimeMode?: 'local' | 'hosted' | null
    /** The honest mirror state's bottom-bar projection (master §3 Slice 4).
     *  `undefined`/`null` = never bound, the legacy inert slot survives. */
    readonly sourceStatus?: WorkspaceChromeSourceStatus | null
    readonly quickClip?: WorkspaceQuickClipOptions | null
    readonly access?: WorkspaceAccessOptions | null
    readonly workspaces?: readonly WorkspaceSummary[] | null
    readonly workspaceStatus?: 'idle' | 'loading' | 'ready' | 'error'
    readonly workspaceError?: string | null
    readonly activeWorkspaceId?: string | null
    readonly workspaceBusyId?: string | null
    readonly onWorkspaceRefresh?: () => void
    readonly onWorkspaceSelect?: (workspace: WorkspaceSummary) => void
    readonly onWorkspaceCreate?: () => void
    readonly onWorkspaceDelete?: (workspace: WorkspaceSummary) => void
    readonly onBreadcrumbOpen?: (detail: { readonly breadcrumb: WorkspaceChromeBreadcrumb }) => void
    readonly onBreadcrumbMenuOpen?: (detail: { readonly breadcrumb: WorkspaceChromeBreadcrumb, readonly x: number, readonly y: number }) => void
  }
  /**
   * Optional controlled data for Garden's left rail. The renderer stays
   * component- and backend-agnostic: it only sets properties/events on the
   * configured `mn-sidebar-panel` tag.
   */
  readonly sidebar?: {
    readonly sections?: readonly SidebarSection[]
    readonly searchQuery?: string
    readonly selectedId?: string | null
    readonly selectedIds?: readonly string[] | null
    readonly activeId?: string | null
    readonly showHeaderActions?: boolean
    readonly searchPlaceholder?: string
    readonly presentation?: FilePanePresentation
    readonly sort?: FilePaneSort
    readonly grouping?: FilePaneGrouping
    readonly columnPaths?: Readonly<Record<string, readonly string[]>> | null
    readonly status?: FilePaneStatus
    readonly error?: string
    readonly storage?: FilePaneStorage | null
    /** Host-owned lifecycle for one file mutation. The client id correlates UI
     * feedback only; gardend remains the persistence authority. */
    readonly operation?: FilePaneOperationFeedback | null
    readonly capabilities?: FilePaneCapabilities | null
    readonly onSearchChange?: (detail: { readonly query: string }) => void
    readonly onAction?: (detail: SidebarActionDetail) => void
    readonly onSelectionChange?: (detail: FilePaneSelectionDetail) => void
    readonly onSortChange?: (detail: FilePaneSortChangeDetail) => void
    readonly onGroupingChange?: (detail: FilePaneGroupingChangeDetail) => void
    readonly onColumnPathChange?: (detail: FilePaneColumnPathChangeDetail) => void
    readonly onSectionToggle?: (detail: {
      readonly id: string
      readonly collapsed: boolean
      readonly section: SidebarSection
    }) => void
    readonly onNodeSelect?: (detail: SidebarNodeDetail) => void
    readonly onNodeIntent?: (detail: SidebarNodeDetail) => void
    readonly onNodeIntentEnd?: (detail: SidebarNodeDetail) => void
    readonly onNodeOpen?: (detail: SidebarNodeDetail) => void
    readonly onNodeToggle?: (detail: SidebarNodeDetail) => void
    readonly onNodeDrop?: (detail: SidebarNodeDropDetail) => void
    readonly onFileDrop?: (files: FileList) => void
    /** Retry a known-safe rejection or reconcile an indeterminate outcome by
     * reading current state. The renderer never chooses between those effects. */
    readonly onOperationRecovery?: (detail: {
      readonly operationId: string
      readonly action: 'retry' | 'reconcile'
    }) => void
  }
  /**
   * Optional controlled daily-note surfaces. The host only reflects plain data
   * into Garden daily-note tags and forwards intents; the shell owns live reads,
   * document creation, date resolution, and popover positioning.
   */
  readonly dailyNotes?: {
    readonly todayKey: string
    readonly todayDoc?: DailyNoteDoc | null
    readonly showHomeRow?: boolean
    readonly activeDateKey?: string | null
    readonly activeAdjacency?: DailyNoteAdjacency | null
    readonly datesWithNotes?: ReadonlySet<string> | null
    readonly popover?: DailyNotePopoverState | null
    readonly onOpenDate?: (detail: DailyNoteOpenDetail) => void
    readonly onCalendarAnchor?: (detail: DailyNoteCalendarAnchorDetail) => void
    readonly onClosePopover?: () => void
  }
  /** Rich controlled Garden home center. */
  readonly home?: WorkspaceHomeOptions | null
  /**
   * Rich controlled Garden home projection kept available to the responsive
   * shell while a document remains the active desktop center surface. This is
   * presentation data only; mobile navigation and all effects remain shell
   * owned. When omitted, responsive shells may fall back to `home`.
   */
  readonly mobileHome?: WorkspaceHomeOptions | null
  /**
   * Optional controlled read-only tag lens for the center surface. This is a
   * structural UI seam only: the shell owns reads, refresh policy, and document
   * navigation; the host forwards plain props/events to the custom element tag.
   */
  readonly tagLens?: TagLensOptions | null
  /**
   * Optional controlled Zotero-source workbench for the center surface. The host
   * only reflects shell-owned Zotero item/annotation/wire state and forwards
   * intents; source materialization, daily-note promotion queues, API reads, and
   * navigation stay in the shell.
   */
  readonly zoteroSource?: ZoteroSourceOptions | null
  /**
   * Optional controlled artifact view for the center surface. The host only
   * reflects shell-owned preview state into the tag and forwards user intents;
   * download/auth/object-URL lifetime stay outside the render island.
   */
  readonly artifact?: ArtifactViewOptions | null
  /**
   * Optional controlled comment metadata for Garden's right-rail comments panel.
   * The editor kernel stores only inline comment ids; shells own this metadata
   * and persistence, while the render host only reflects props/events.
   */
  readonly comments?: WorkspaceCommentsOptions | null
  /**
   * Optional controlled object-inspector state for Garden's right-rail inspector.
   * The host reflects plain model/action props and emits intents; shells own the
   * selected-object bus, command registry, and relation navigation.
   */
  readonly inspector?: WorkspaceInspectorOptions | null
  /**
   * Optional controlled workspace graph data for Garden's graph panel. The host
   * stamps the pure panel and forwards intents; shells own graph projection
   * reads, node navigation, and refresh policy.
   */
  readonly graphPanel?: GraphPanelOptions | null
  /**
   * Optional controlled heading data for Garden's left-rail document outline
   * panel. The host stamps the pure panel and forwards intents; shells own
   * reading the live editor's headings/scroll-position and running commands.
   */
  readonly outlinePanel?: OutlinePanelOptions | null
  /**
   * Optional semantic control overlay for mn-vtuber surfaces. The layout graph
   * still only chooses the component tag; this sibling overlay binds a
   * panel/region to a durable VTuber control channel and scalar state.
   */
  readonly vtuberControls?: VtuberControlOverlay | null
  /**
   * OPTIONAL shell-supplied graph-authored layout fragments (the Surface
   * unification seam — docs/design/surface-unification.md). When a config
   * region carries the `sh-layout-dashboard` marker, the shell loads that
   * region's `ux:layoutJson` fragment and passes it here; the Surface path
   * SPLICES it into the one workspace LayoutDocument. Carries the session's
   * live `QueryBlockService` for the engine faces and the settle-point
   * persistence seam. With the marker present but no fragment entry, the
   * region renders an honest status leaf, never a blank pane.
   */
  readonly fragments?: WorkspaceFragmentsOptions | null
  /**
   * OPTIONAL controlled contested-objects centre route (MO object-face
   * integration spec, master §2.9, §3 Slice 5, WS2 §6.2, V-6: a centre
   * route, dismissible via `onClose`, no history entry). MUTUALLY EXCLUSIVE
   * with `parkedWork` (§2.9) — both are explicit user navigations occupying
   * the SAME centre slot; the assembler asserts rather than silently
   * choosing.
   */
  readonly contested?: WorkspaceContestedOptions | null
  /**
   * OPTIONAL controlled parked-work centre route (MO object-face
   * integration spec, master §3 Slice 8, WS3 §5.2): durable records ABOUT A
   * PREVIOUS life of this graph. Client-local by construction — the shell
   * reads IndexedDB, this host only reflects and forwards intents. Never
   * authorable from a graph document, which is why it is a route face and
   * not a fragment. MUTUALLY EXCLUSIVE with `contested` (§2.9) — both are
   * explicit user navigations occupying the SAME centre slot; the assembler
   * asserts rather than silently choosing whichever branch happens to run
   * first.
   */
  readonly parkedWork?: ParkedWorkOptions | null
}

/**
 * `sparql.bindings-table`'s activated row, joined against the resident
 * `SourceBundle` (`contested-surface.ts`'s `contestedSelectionFrom`, WS2
 * §6.2) — the CONFLICT identity, not yet the OBJECT identity (the object is
 * resolved by that join, never rendered as a composite key).
 */
export interface WorkspaceContestedSelection {
  /** `vocabclassobjectId` — garden `source_sync.rs:758-760`. */
  readonly objectKey: string
  readonly conflictId: string
}

/**
 * The contested centre route's options (master §2.8, §2.9, WS2 §6.2).
 * `queryService`/`objectService` are REQUIRED, not optional-via-`fragments`:
 * an ordinary (non-fragment-marked) route has no `fragments` to fall back
 * to, so without these the table/card leaves throw "shell supplied no
 * fragments.queryService" on every render (`workspace-fragments.ts:115-133`
 * — `optionsFor` returns `null` for any config without a declared marker
 * region).
 */
export interface WorkspaceContestedOptions {
  readonly graphId: string
  /** Named ref only (`urn:sophia:query:sync.conflicts-open`) — a raw string here is a bug (LAY Decision 5). */
  readonly queryId: string
  readonly queryService: QueryBlockService
  readonly objectService: SourceObjectService
  readonly maxRows?: number
  readonly selection: WorkspaceContestedSelection | null
  /**
   * The raw row-activation detail, forwarded unchanged — `render-workspace.ts`
   * has no access to the resident `SourceBundle` a conflict→object join
   * needs, so the ORGANISM shell does the join (`contestedSelectionFrom`)
   * and re-renders with the result as the next `selection`.
   */
  readonly onSelect?: (detail: SubjectRowActivateDetail) => void
  readonly onClose?: () => void
}

/**
 * MO object-face integration spec, master §3 Slice 8 (WS3 §6.4). Declared
 * STRUCTURALLY, matching `apps/organism/src/cell/parked-work.ts`'s
 * `ParkedWorkModel`/`ParkedDocumentRow`/`ParkedOperationRow` field-for-
 * field — exactly as `WorkspaceContestedOptions` takes `QueryBlockService`
 * — because `@shrubbery/runtime` cannot import an app module. `kind`
 * strings are the only part of the app's `ParkedRepresentability` union
 * this face's own summary needs (PW-22/23 — "cannot be reapplied"), so it
 * is narrowed to that one discriminant rather than duplicating the union.
 */
export interface ParkedWorkOperationRow {
  readonly operationId: string
  readonly kind: string
  readonly graphIncarnation: string
  readonly createdAt: number
  readonly attempts: number
  readonly error: string | null
  /** `@shrubbery/source`'s `SourceFaultCode`, widened to `string` — this
   *  ISLAND may not import `@shrubbery/source` directly (`render-workspace-
   *  island.test.ts`). */
  readonly errorCode: string | null
  readonly representability: { readonly kind: string }
  readonly namesDocumentId: string | null
}

export interface ParkedWorkDocumentRow {
  readonly recoveryKey: string
  readonly documentId: string
  readonly title: string
  readonly reason: 'deleted' | 'replaced' | 'orphaned'
  readonly previousLife: string
  readonly recoveredAt: number
  readonly sizeBytes: number
  readonly operations: readonly ParkedWorkOperationRow[]
  readonly joinUnavailable: boolean
  readonly reappliedAt: number | null
  readonly canReapply: boolean
}

export interface ParkedWorkModel {
  readonly graphId: string
  readonly graphTitle: string
  readonly fenced: boolean
  readonly fenceTestimony: string | null
  readonly previousLife: string
  readonly documents: readonly ParkedWorkDocumentRow[]
  readonly looseOperations: readonly ParkedWorkOperationRow[]
  readonly totalOperations: number
}

/** The route face's OWN options — distinct from `LoadParkedWorkOptions`
 *  (the app-level loader's arguments). The face renders; it never loads. */
export interface ParkedWorkOptions {
  readonly graphId: string
  readonly model: ParkedWorkModel
  /** Row actions. Each is host-owned; the face raises, the shell performs. */
  readonly onView?: (recoveryKey: string) => void
  /** `null` ⇒ export all parked work (PW-19). */
  readonly onExport?: (recoveryKey: string | null) => void
  readonly onReapply?: (recoveryKeys: readonly string[]) => void
  readonly onClose?: () => void
  /** Focused row, e.g. when reached from a sidebar parked row (C-D26). */
  readonly focusRecoveryKey?: string | null
}

/** One region's shell-loaded fragment: which surface authors it, and where the load stands. */
export type WorkspaceFragmentState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: string }
  | { readonly status: 'ready'; readonly doc: LayoutDocument }

export interface WorkspaceFragmentRegion {
  /** The `ux:layoutJson` SUBJECT this region's fragment is keyed under (config `sux:fragmentSurface`, or the shell's default). */
  readonly surfaceIri: string
  readonly state: WorkspaceFragmentState
  /**
   * The region's OWN graph-authored `ux:vegaTheme` override (the sibling
   * literal the shell loaded alongside `ux:layoutJson`), or null/absent for
   * the pure house chart theme. Scoped here — per region, owned by the
   * session that loaded it — and registered per render pass against the
   * surface root (`setVegaThemeScopeOverrides`), so one region's theme can
   * never leak onto another region's charts, another session, or an editor
   * QueryBlock.
   */
  readonly vegaTheme?: Record<string, unknown> | null
}

/**
 * Emitted whenever an engine interaction mutates a fragment's OWN document —
 * `doc` is the FRAGMENT document in ORIGINAL node ids (never namespaced,
 * never containing a spine node): exactly what the shell persists back to
 * `ux:layoutJson` at a `commit` settle point.
 */
export interface WorkspaceFragmentChangeDetail {
  readonly regionId: string
  readonly surfaceIri: string
  readonly doc: LayoutDocument
  readonly phase: 'input' | 'commit'
  readonly source: 'pointer' | 'keyboard'
}

/** See `RenderWorkspaceOptions.fragments`. */
export interface WorkspaceFragmentsOptions {
  /**
   * The session's query service (`makeQueryBlockService(rest)` over the live
   * cell contract) — the ONE backend seam the engine faces resolve through.
   * Null when the session has no live cell: engine-face leaves then render
   * the interpreter's honest resource-unavailable error state.
   */
  readonly queryService: QueryBlockService | null
  /**
   * The session's object service (MO object-face integration spec, master
   * §2.5/§2.8/§6.10) — the seam `card.object` resolves through. Null when the
   * session has no live cell, exactly like `queryService`.
   */
  readonly objectService?: SourceObjectService | null
  /** Private fat-evidence resolver used by `obs.filmstrip`. */
  readonly evidenceService?: FilmstripEvidenceService | null
  /** Shell-loaded fragments keyed by REGION id (a region carrying the config marker). */
  readonly regions?: Readonly<Record<string, WorkspaceFragmentRegion>>
  /** Settle-point/persistence seam — see `WorkspaceFragmentChangeDetail`. */
  readonly onFragmentChange?: (detail: WorkspaceFragmentChangeDetail) => void
}

/**
 * The engine-service composite (§6.10, master §2.8). `WorkspaceSurfaceBuild.
 * engineService` is opaque (`unknown`, `workspace-surface-element.ts:66`),
 * stored by reference and compared by IDENTITY — an identity change bumps
 * `engineServiceEpoch` and clears every retained store. So the composite
 * MUST be memoized, or every render would nuke the resource cache.
 */
export interface SurfaceEngineServices {
  readonly query: QueryBlockService | null
  readonly objects: SourceObjectService | null
  readonly evidence: FilmstripEvidenceService | null
}

let engineServicesMemo: {
  readonly q: unknown
  readonly o: unknown
  readonly e: unknown
  readonly value: SurfaceEngineServices
} | null = null

function engineServicesFor(
  query: QueryBlockService | null,
  objects: SourceObjectService | null,
  evidence: FilmstripEvidenceService | null,
): SurfaceEngineServices {
  if (
    engineServicesMemo
    && engineServicesMemo.q === query
    && engineServicesMemo.o === objects
    && engineServicesMemo.e === evidence
  ) {
    return engineServicesMemo.value
  }
  const value: SurfaceEngineServices = Object.freeze({ query, objects, evidence })
  engineServicesMemo = { q: query, o: objects, e: evidence, value }
  return value
}

/**
 * Classify a spine region into its engine role — purely from config.
 *
 * Adapted from app-shell.ts:engineRegionRole (~2977). The garden original took
 * `this` only to reach the (pure) `resolveSurfaceTag`; here we call the nucleus
 * function directly, so the role is a pure function of (config, regionId).
 */
export function engineRegionRole(config: WorkspaceConfig, regionId: string): RegionRole {
  const region = config.regions[regionId]
  if (!region) return 'other'
  // Graph-authored semantic placement wins over legacy tag inference. This is
  // presentation metadata only; component admission and capabilities remain
  // code-owned at their existing gates.
  if (region.surfaceRole) return region.surfaceRole
  const tag = resolveSurfaceTag(config, regionId)
  if (tag === 'mn-document-editor') return 'center'
  // A config-declared dashboard center IS the main pane — same role the editor
  // anchor plays, so spine composition/landmarks/min-widths treat it as center.
  if (tag === LAYOUT_DASHBOARD_COMPONENT) return 'center'
  if (tag === 'mn-sidebar-panel') return 'sidebar'
  if (region.dockState === 'stacked') return 'right'
  return 'other'
}

/**
 * True when the graph, rather than shell navigation, owns a region's content.
 * This is presentation authority only: component admission and every backend
 * capability remain guarded by their existing code-owned boundaries.
 */
function configuredSurfaceOwnsRegion(config: WorkspaceConfig, regionId: string): boolean {
  return config.regions[regionId]?.surfaceMode === 'configured'
}

/** Per-role min-width — verbatim from app-shell.ts:renderSpineForPlan (~3047). */
function minWidthFor(role: RegionRole): number {
  return role === 'sidebar' ? 180 : role === 'center' ? 400 : role === 'right' ? 240 : 180
}

/** Garden's F6 cycle targets these three ARIA landmark roles in spine order. */
function landmarkRoleFor(role: RegionRole, liftedCenter: boolean): string | null {
  if (role === 'sidebar') return 'navigation'
  if (role === 'right') return 'complementary'
  // A lifted editor already owns Garden's canonical inner role="main" anchor.
  if (role === 'center' && !liftedCenter) return 'main'
  return null
}

function landmarkLabelFor(role: RegionRole): string | null {
  if (role === 'sidebar') return 'Workspace'
  if (role === 'right') return 'Secondary panels'
  return null
}

function customDetail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail
}

function renderSidebarPanel(sidebar: RenderWorkspaceOptions['sidebar']): TemplateResult {
  return html`<mn-sidebar-panel
    .sections=${sidebar?.sections ?? []}
    .searchQuery=${sidebar?.searchQuery ?? ''}
    .selectedId=${sidebar?.selectedId ?? null}
    .selectedIds=${sidebar?.selectedIds ?? null}
    .activeId=${sidebar?.activeId ?? null}
    .showHeaderActions=${sidebar?.showHeaderActions ?? true}
    .searchPlaceholder=${sidebar?.searchPlaceholder ?? 'Search'}
    .presentation=${sidebar?.presentation ?? 'tree'}
    .sort=${sidebar?.sort ?? DEFAULT_FILE_PANE_SORT}
    .grouping=${sidebar?.grouping ?? DEFAULT_FILE_PANE_GROUPING}
    .columnPaths=${sidebar?.columnPaths ?? null}
    .status=${sidebar?.status ?? 'ready'}
    .error=${sidebar?.error ?? ''}
    .storage=${sidebar?.storage ?? null}
    .capabilities=${sidebar?.capabilities ?? null}
    @mn-sidebar-search-change=${(event: Event) =>
      sidebar?.onSearchChange?.(customDetail<{ readonly query: string }>(event))}
    @mn-sidebar-action=${(event: Event) =>
      sidebar?.onAction?.(customDetail<SidebarActionDetail>(event))}
    @mn-sidebar-selection-change=${(event: Event) =>
      sidebar?.onSelectionChange?.(customDetail<FilePaneSelectionDetail>(event))}
    @mn-sidebar-sort-change=${(event: Event) =>
      sidebar?.onSortChange?.(customDetail<FilePaneSortChangeDetail>(event))}
    @mn-sidebar-grouping-change=${(event: Event) =>
      sidebar?.onGroupingChange?.(customDetail<FilePaneGroupingChangeDetail>(event))}
    @mn-sidebar-column-path-change=${(event: Event) =>
      sidebar?.onColumnPathChange?.(customDetail<FilePaneColumnPathChangeDetail>(event))}
    @mn-sidebar-section-toggle=${(event: Event) =>
      sidebar?.onSectionToggle?.(customDetail<{
        readonly id: string
        readonly collapsed: boolean
        readonly section: SidebarSection
      }>(event))}
    @mn-sidebar-node-select=${(event: Event) =>
      sidebar?.onNodeSelect?.(customDetail<SidebarNodeDetail>(event))}
    @mn-sidebar-node-intent=${(event: Event) =>
      sidebar?.onNodeIntent?.(customDetail<SidebarNodeDetail>(event))}
    @mn-sidebar-node-intent-end=${(event: Event) =>
      sidebar?.onNodeIntentEnd?.(customDetail<SidebarNodeDetail>(event))}
    @mn-sidebar-node-open=${(event: Event) =>
      sidebar?.onNodeOpen?.(customDetail<SidebarNodeDetail>(event))}
    @mn-sidebar-node-toggle=${(event: Event) =>
      sidebar?.onNodeToggle?.(customDetail<SidebarNodeDetail>(event))}
    @mn-sidebar-node-drop=${(event: Event) =>
      sidebar?.onNodeDrop?.(customDetail<SidebarNodeDropDetail>(event))}
    @mn-sidebar-file-drop=${(event: Event) =>
      sidebar?.onFileDrop?.(customDetail<FileList>(event))}
  ></mn-sidebar-panel>`
}

function renderOutlinePanel(outline: RenderWorkspaceOptions['outlinePanel']): TemplateResult {
  return html`<mn-document-outline
    .documentOpen=${outline?.documentOpen ?? false}
    .headings=${outline?.headings ?? []}
    .activeHeadingId=${outline?.activeHeadingId ?? null}
    @mn-outline-navigate=${(event: Event) =>
      outline?.onNavigate?.(customDetail<OutlinePanelNavigateDetail>(event))}
    @mn-outline-command=${(event: Event) =>
      outline?.onCommand?.(customDetail<OutlinePanelCommandDetail>(event))}
  ></mn-document-outline>`
}

function renderDailyNoteHeader(dailyNotes: RenderWorkspaceOptions['dailyNotes']): TemplateResult | typeof nothing {
  if (!dailyNotes?.activeDateKey) return nothing
  return html`<mn-daily-note-header
    date-key=${dailyNotes.activeDateKey}
    today-key=${dailyNotes.todayKey}
    .adjacency=${dailyNotes.activeAdjacency ?? null}
    @daily-note-open-request=${(event: Event) =>
      dailyNotes.onOpenDate?.(customDetail<DailyNoteOpenDetail>(event))}
    @daily-note-calendar-anchor-request=${(event: Event) =>
      dailyNotes.onCalendarAnchor?.(customDetail<DailyNoteCalendarAnchorDetail>(event))}
  ></mn-daily-note-header>`
}

function renderDailyNoteHome(dailyNotes: NonNullable<RenderWorkspaceOptions['dailyNotes']>): TemplateResult {
  return html`<div
    class="daily-note-home"
    data-daily-note-home
    style="display:flex;justify-content:center;padding:16px 12px;"
  >
    <mn-daily-note-row
      displayed-date=${dailyNotes.todayKey}
      today-key=${dailyNotes.todayKey}
      .doc=${dailyNotes.todayDoc ?? null}
      @daily-note-open-request=${(event: Event) =>
        dailyNotes.onOpenDate?.(customDetail<DailyNoteOpenDetail>(event))}
      @daily-note-calendar-anchor-request=${(event: Event) =>
        dailyNotes.onCalendarAnchor?.(customDetail<DailyNoteCalendarAnchorDetail>(event))}
    ></mn-daily-note-row>
  </div>`
}

function renderHome(
  home: WorkspaceHomeOptions,
  dailyNotes: RenderWorkspaceOptions['dailyNotes'],
): TemplateResult {
  return html`<mn-home-view
    .status=${home.status ?? 'ready'}
    .error=${home.error ?? ''}
    .graphId=${home.graphId}
    .graphTitle=${home.graphTitle}
    .todayKey=${dailyNotes?.todayKey ?? ''}
    .todayDoc=${dailyNotes?.todayDoc ?? null}
    .resume=${home.resume ?? null}
    .dreamJournal=${home.dreamJournal ?? null}
    .pinned=${home.pinned ?? []}
    .newlyCreated=${home.newlyCreated ?? []}
    .recent=${home.recent ?? []}
    @mn-home-new-document=${() => home.onNewDocument?.()}
    @mn-home-open-document=${(event: Event) =>
      home.onOpenDocument?.(customDetail<{ document: WorkspaceHomeDocument }>(event).document)}
    @mn-home-pin-document=${(event: Event) => {
      const detail = customDetail<{ document: WorkspaceHomeDocument; pinned: boolean }>(event)
      home.onPinDocument?.(detail.document, detail.pinned)
    }}
    @daily-note-open-request=${(event: Event) =>
      dailyNotes?.onOpenDate?.(customDetail<DailyNoteOpenDetail>(event))}
    @daily-note-calendar-anchor-request=${(event: Event) =>
      dailyNotes?.onCalendarAnchor?.(customDetail<DailyNoteCalendarAnchorDetail>(event))}
  ></mn-home-view>`
}

function renderDailyNotePopover(dailyNotes: RenderWorkspaceOptions['dailyNotes']): TemplateResult | typeof nothing {
  if (!dailyNotes?.popover) return nothing
  return html`<mn-month-popover
    x=${dailyNotes.popover.x}
    y=${dailyNotes.popover.y}
    today-key=${dailyNotes.todayKey}
    viewed-key=${dailyNotes.popover.viewedKey}
    .datesWithNotes=${new Set(dailyNotes.datesWithNotes ?? [])}
    @date-select=${(event: Event) =>
      dailyNotes.onOpenDate?.(customDetail<DailyNoteOpenDetail>(event))}
    @mn-close=${() => dailyNotes.onClosePopover?.()}
  ></mn-month-popover>`
}

function renderTagLens(tagLens: TagLensOptions): TemplateResult {
  return html`<mn-tag-view
    .tag=${tagLens.tagName}
    .status=${tagLens.status}
    .blocks=${tagLens.blocks ?? []}
    .error=${tagLens.error ?? ''}
    @mn-tag-view-refresh=${(event: Event) =>
      tagLens.onRefresh?.(customDetail<TagLensRefreshDetail>(event))}
    @mn-tag-view-open-block=${(event: Event) =>
      tagLens.onOpenBlock?.(customDetail<TagLensOpenBlockDetail>(event))}
  ></mn-tag-view>`
}

function renderZoteroSource(source: ZoteroSourceOptions): TemplateResult {
  return html`<mn-zotero-source-workbench
    .artifactId=${source.artifactId}
    .zoteroKey=${source.zoteroKey ?? ''}
    .graphId=${source.graphId ?? ''}
    .item=${source.item ?? null}
    .annotations=${source.annotations ?? []}
    .incomingWires=${source.incomingWires ?? []}
    .promotedAnnotationKeys=${source.promotedAnnotationKeys ?? []}
    .loading=${source.loading ?? false}
    .error=${source.error ?? ''}
    @mn-zotero-source-reload=${(event: Event) =>
      source.onReload?.(customDetail<ZoteroSourceBaseDetail>(event))}
    @mn-zotero-source-open-zotero=${(event: Event) =>
      source.onOpenZotero?.(customDetail<ZoteroSourceOpenZoteroDetail>(event))}
    @mn-zotero-source-open-tag=${(event: Event) =>
      source.onOpenTag?.(customDetail<ZoteroSourceOpenTagDetail>(event))}
    @mn-zotero-source-open-document=${(event: Event) =>
      source.onOpenDocument?.(customDetail<ZoteroSourceOpenDocumentDetail>(event))}
    @mn-zotero-source-promote-annotation=${(event: Event) =>
      source.onPromoteAnnotation?.(customDetail<ZoteroSourcePromoteAnnotationDetail>(event))}
  ></mn-zotero-source-workbench>`
}

function renderArtifactView(artifact: ArtifactViewOptions): TemplateResult {
  const intent: ArtifactViewIntentDetail = { graphId: artifact.graphId, artifactId: artifact.artifactId }
  if (artifact.editor?.open) {
    return html`<mn-artifact-editor
      .srcUrl=${artifact.editor.srcUrl ?? artifact.previewUrl ?? ''}
      .mimeType=${artifact.editor.mimeType ?? artifact.mimeType ?? 'image/png'}
      .prompt=${artifact.editor.prompt ?? ''}
      .generationTarget=${artifact.editor.generationTarget ?? 'version'}
      .generating=${artifact.editor.generating ?? false}
      .generationError=${artifact.editor.generationError ?? ''}
      @mn-artifact-editor-cancel=${() => artifact.editor?.onCancel?.(intent)}
      @mn-artifact-editor-save=${(event: Event) => {
        const detail = customDetail<{ dataUrl: string; mimeType: 'image/png' | 'image/jpeg' }>(event)
        artifact.editor?.onSave?.({ ...intent, ...detail })
      }}
      @mn-artifact-editor-generate=${(event: Event) => {
        const detail = customDetail<{
          dataUrl: string
          mimeType: 'image/png' | 'image/jpeg'
          prompt: string
          target: 'version' | 'artifact'
        }>(event)
        artifact.editor?.onGenerate?.({ ...intent, ...detail })
      }}
    ></mn-artifact-editor>`
  }

  const view = html`<mn-artifact-view
    .graphId=${artifact.graphId}
    .artifactId=${artifact.artifactId}
    .title=${artifact.title ?? ''}
    .mimeType=${artifact.mimeType ?? ''}
    .fileType=${artifact.fileType ?? ''}
    .artifactStatus=${artifact.artifactStatus ?? ''}
    .ingestedDocumentId=${artifact.ingestedDocumentId ?? ''}
    .previewUrl=${artifact.previewUrl ?? ''}
    .status=${artifact.status}
    .error=${artifact.error ?? ''}
    @mn-artifact-refresh=${(event: Event) =>
      artifact.onRefresh?.(customDetail<ArtifactViewIntentDetail>(event))}
    @mn-artifact-history-open=${(event: Event) =>
      artifact.onHistoryOpen?.(customDetail<ArtifactViewIntentDetail>(event))}
    @mn-artifact-edit-open=${(event: Event) =>
      artifact.onEditOpen?.(customDetail<ArtifactViewIntentDetail>(event))}
    @mn-artifact-download=${(event: Event) =>
      artifact.onDownload?.(customDetail<ArtifactViewIntentDetail>(event))}
    @mn-artifact-open-document=${(event: Event) =>
      artifact.onOpenDocument?.(customDetail<ArtifactViewOpenDocumentDetail>(event))}
  ></mn-artifact-view>`

  if (!artifact.history) return view

  return html`
    <div
      data-artifact-history-shell
      style="display:flex;width:100%;height:100%;min-height:0;min-width:0;overflow:hidden;"
    >
      <div style="flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;">${view}</div>
      <mn-artifact-history
        .graphId=${artifact.history.graphId}
        .artifactId=${artifact.history.artifactId}
        .status=${artifact.history.status}
        .error=${artifact.history.error ?? ''}
        .revisions=${artifact.history.revisions ?? []}
        .restoringRevisionId=${artifact.history.restoringRevisionId ?? ''}
        @mn-artifact-history-close=${(event: Event) =>
          artifact.history?.onClose?.(customDetail<ArtifactViewIntentDetail>(event))}
        @mn-artifact-history-refresh=${(event: Event) =>
          artifact.history?.onRefresh?.(customDetail<ArtifactViewIntentDetail>(event))}
        @mn-artifact-history-restore=${(event: Event) =>
          artifact.history?.onRestore?.(customDetail<ArtifactHistoryRevisionDetail>(event))}
      ></mn-artifact-history>
    </div>
  `
}

/** PW-4/5/6 — the reason chip's tone; 'orphaned' gets the muted/dashed
 *  treatment via `outline`-style borders, never a semantic status color of
 *  its own (it is a membership fact, not a danger). */
const PARKED_REASON_TONE: Readonly<Record<string, { readonly ink: string; readonly edge: string; readonly dashed?: boolean }>> = {
  replaced: { ink: 'var(--mn-color-warning)', edge: 'var(--mn-color-warning)' },
  deleted: { ink: 'var(--mn-color-danger)', edge: 'var(--mn-color-danger)' },
  orphaned: { ink: 'var(--mn-color-text-muted)', edge: 'var(--mn-color-border-default)', dashed: true },
}

const PARKED_REASON_LABEL: Readonly<Record<string, string>> = {
  replaced: 'Replaced',
  deleted: 'Deleted',
  orphaned: 'Orphaned',
}

const PARKED_REASON_HELP: Readonly<Record<string, string>> = {
  replaced: 'This document exists now, but as a different one.',
  deleted: 'This document is not in the graph any more.',
  orphaned: "This document left the graph's membership while you were away.",
}

function parkedRelativeTime(value: number): string {
  const diff = Math.max(0, Date.now() - value)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function parkedReasonChip(reason: string): TemplateResult {
  const tone = PARKED_REASON_TONE[reason] ?? PARKED_REASON_TONE['orphaned']!
  const style =
    `display:inline-flex;align-items:center;gap:var(--mn-space-1);`
    + `padding:0 var(--mn-space-2);border-radius:var(--mn-radius-pill);`
    + `font-size:var(--mn-text-xs);font-weight:var(--mn-font-weight-medium);`
    + `color:${tone.ink};border:1px ${tone.dashed ? 'dashed' : 'solid'} ${tone.edge};`
  return html`<span data-parked-reason-chip=${reason} style=${style} title=${PARKED_REASON_HELP[reason] ?? ''}>
    ${PARKED_REASON_LABEL[reason] ?? reason}
  </span>`
}

function parkedOperationSummary(operations: readonly ParkedWorkOperationRow[]): TemplateResult | typeof nothing {
  const unrepresentable = operations.filter(op => op.representability.kind === 'unrepresentable')
  if (unrepresentable.length === 0) return nothing
  const reasons = [...new Set(unrepresentable.map(op => op.representability.kind))].join(', ')
  return html`<p data-parked-unrepresentable-count=${unrepresentable.length}
    style="margin:var(--mn-space-1) 0 0 0;color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);">
    ${unrepresentable.length} change${unrepresentable.length === 1 ? '' : 's'} cannot be reapplied: ${reasons}. Export keeps them.
  </p>`
}

function renderParkedOperationRow(op: ParkedWorkOperationRow): TemplateResult {
  return html`<li
    data-parked-loose-operation
    data-parked-operation-id=${op.operationId}
    data-parked-operation-kind=${op.kind}
    style="padding:var(--mn-space-1) 0;font-size:var(--mn-text-sm);color:var(--mn-color-text-secondary);"
  >
    <code style="font-family:var(--mn-font-mono);font-size:var(--mn-text-xs);">${op.kind}</code>
    ${op.namesDocumentId
      ? html`<span style="color:var(--mn-color-text-muted);"> — about a block in ${op.namesDocumentId}</span>`
      : nothing}
  </li>`
}

function renderParkedDocumentRow(
  row: ParkedWorkDocumentRow,
  focused: boolean,
  options: ParkedWorkOptions,
): TemplateResult {
  const style =
    `padding:var(--mn-space-3);border:1px solid var(--mn-color-border-default);`
    + `border-radius:var(--mn-radius-default);margin-bottom:var(--mn-space-2);`
    + (focused ? `outline:2px solid var(--mn-color-accent);outline-offset:1px;` : '')
  return html`<li
    data-parked-document
    data-parked-document-id=${row.documentId}
    data-parked-recovery-key=${row.recoveryKey}
    data-parked-reason=${row.reason}
    style=${style}
  >
    <div style="display:flex;align-items:center;gap:var(--mn-space-2);">
      <strong style="font-size:var(--mn-text-sm);">${row.title}</strong>
      ${parkedReasonChip(row.reason)}
      ${row.reappliedAt !== null
        ? html`<span data-parked-reapplied style="color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);">
            Reapplied ${parkedRelativeTime(row.reappliedAt)} · kept for the record
          </span>`
        : nothing}
    </div>
    <p style="margin:var(--mn-space-1) 0 0 0;color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);">
      Previous life ${row.previousLife} · parked ${parkedRelativeTime(row.recoveredAt)}
    </p>
    <p style="margin:var(--mn-space-1) 0 0 0;color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);">
      ${Math.max(1, Math.round(row.sizeBytes / 1024))} KB of parked text
      ${row.operations.length > 0
        ? html` · ${row.operations.length} unsent change${row.operations.length === 1 ? '' : 's'} for this document`
        : nothing}
    </p>
    ${row.joinUnavailable
      ? html`<p style="margin:var(--mn-space-1) 0 0 0;color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);">
          Parked before this build could link changes to documents.
        </p>`
      : nothing}
    ${parkedOperationSummary(row.operations)}
    <div style="display:flex;gap:var(--mn-space-2);margin-top:var(--mn-space-2);">
      <button type="button" data-parked-action="view" @click=${() => options.onView?.(row.recoveryKey)}>View</button>
      <button type="button" data-parked-action="export" @click=${() => options.onExport?.(row.recoveryKey)}>Export</button>
      ${row.canReapply
        ? html`<button type="button" data-parked-action="reapply"
            @click=${() => options.onReapply?.([row.recoveryKey])}>Reapply</button>`
        : html`<span data-parked-reapply-unavailable style="color:var(--mn-color-text-muted);font-size:var(--mn-text-xs);align-self:center;">
            ${row.reason === 'deleted'
              ? 'Nothing to reapply this into — the document is gone.'
              : 'Reapply is only offered when a replacement exists.'}
          </span>`}
    </div>
  </li>`
}

/**
 * The parked-work route face (MO object-face integration spec, master §3
 * Slice 8, WS3 §5.2/§9). Records ABOUT a previous life of this graph — the
 * host reads IndexedDB, this face only reflects and forwards intents.
 */
function renderParkedWork(options: ParkedWorkOptions): TemplateResult {
  const { model } = options
  const empty = model.documents.length === 0 && model.looseOperations.length === 0
  return html`<div
    data-parked-work
    data-parked-work-graph=${model.graphId}
    role="region"
    aria-label="Parked work"
    style="padding:var(--mn-space-4);overflow:auto;height:100%;box-sizing:border-box;"
  >
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--mn-space-3);">
      <div>
        <h2 style="margin:0;font-size:var(--mn-text-lg);">Parked work</h2>
        <p style="margin:var(--mn-space-1) 0 0 0;color:var(--mn-color-text-muted);font-size:var(--mn-text-sm);">
          Work you did in a previous life of ${model.graphTitle}. It is safe here, and it is not in the graph.
        </p>
      </div>
      <div style="display:flex;gap:var(--mn-space-2);">
        ${!empty
          ? html`<button type="button" data-parked-action="export-all"
              @click=${() => options.onExport?.(null)}>Export all parked work</button>`
          : nothing}
        <button type="button" data-parked-action="close" @click=${() => options.onClose?.()}>Close</button>
      </div>
    </div>

    ${empty
      ? html`<div data-parked-work-empty style="margin-top:var(--mn-space-6);text-align:center;color:var(--mn-color-text-muted);">
          <p style="font-size:var(--mn-text-md);margin:0;">Nothing is parked</p>
          <p style="font-size:var(--mn-text-sm);margin:var(--mn-space-1) 0 0 0;">Every change you made has reached this graph.</p>
        </div>`
      : html`
        <ul data-parked-document-list style="list-style:none;margin:var(--mn-space-4) 0 0 0;padding:0;">
          ${model.documents.map(row =>
            renderParkedDocumentRow(row, row.recoveryKey === options.focusRecoveryKey, options))}
        </ul>
        ${model.looseOperations.length > 0
          ? html`
            <h3 style="margin:var(--mn-space-4) 0 0 0;font-size:var(--mn-text-sm);color:var(--mn-color-text-muted);">
              Unsent changes to the graph itself
            </h3>
            <p style="margin:0;font-size:var(--mn-text-xs);color:var(--mn-color-text-muted);">
              These were not about one document, so they are listed on their own.
            </p>
            <ul data-parked-loose-operation-list style="list-style:none;margin:var(--mn-space-2) 0 0 0;padding:0;">
              ${model.looseOperations.map(renderParkedOperationRow)}
            </ul>
            ${parkedOperationSummary(model.looseOperations)}
          `
          : nothing}
      `}
  </div>`
}

function renderGraphPanelAnchor(location: 'left' | 'right'): TemplateResult {
  return html`<div
    id="mn-graph-panel-anchor"
    data-graph-panel-anchor
    data-graph-panel-location=${location}
    aria-hidden="true"
    style="position:relative;width:100%;height:100%;min-width:0;min-height:0;"
  ></div>`
}

function renderVtuber(control: VtuberControlChannel | null | undefined): TemplateResult {
  return html`<mn-vtuber
    data-control-channel=${control?.id ?? ''}
    .controlChannel=${control?.id ?? ''}
    .modelUrl=${control?.modelUrl ?? ''}
    .label=${control?.label ?? 'VTuber avatar'}
    .expression=${control?.expression ?? 'focused'}
    .material=${control?.material ?? 'capture-safe'}
    .cameraFrame=${control?.cameraFrame ?? 'portrait'}
    .animated=${control?.animated ?? true}
    .fallback=${control?.fallback ?? true}
    .mouth=${control?.mouth ?? 0}
    .blink=${control?.blink ?? 0}
    .lookX=${control?.lookX ?? 0}
    .lookY=${control?.lookY ?? 0}
    .scale=${control?.scale ?? 1}
    .appearance=${control?.appearance}
  ></mn-vtuber>`
}

function renderDocHistoryOverlay(docHistory: DocHistoryOptions | null | undefined): TemplateResult | typeof nothing {
  if (!docHistory) return nothing
  return html`
    <div
      class="doc-history-overlay-host"
      data-doc-history-overlay
      style="position:fixed;inset:0;z-index:9000;display:flex;background:rgba(20,18,16,0.55);"
    >
      <mn-doc-history-panel
        .title=${docHistory.title ?? 'Version History'}
        .subtitle=${docHistory.subtitle ?? ''}
        .status=${docHistory.status}
        .error=${docHistory.error ?? ''}
        .snapshots=${docHistory.snapshots ?? []}
        .olderId=${docHistory.olderId ?? ''}
        .newerId=${docHistory.newerId ?? 'live'}
        .focusedSide=${docHistory.focusedSide ?? 'older'}
        .olderText=${docHistory.olderText ?? ''}
        .newerText=${docHistory.newerText ?? ''}
        .diffStatus=${docHistory.diffStatus ?? 'idle'}
        .diffError=${docHistory.diffError ?? ''}
        .diffStyle=${docHistory.diffStyle ?? 'split'}
        .restoreDisabled=${docHistory.restoreDisabled ?? false}
        .showClose=${true}
        @mn-doc-history-cursor-change=${(event: Event) =>
          docHistory.onCursorChange?.(customDetail<DocHistoryCursorDetail>(event))}
        @mn-doc-history-save-current=${() => docHistory.onSaveCurrent?.()}
        @mn-doc-history-bookmark=${(event: Event) =>
          docHistory.onBookmark?.(customDetail<DocHistorySnapshotDetail>(event))}
        @mn-doc-history-delete=${(event: Event) =>
          docHistory.onDelete?.(customDetail<DocHistorySnapshotDetail>(event))}
        @mn-doc-history-restore=${(event: Event) =>
          docHistory.onRestore?.(customDetail<DocHistoryRestoreDetail>(event))}
        @mn-doc-history-refresh=${() => docHistory.onRefresh?.()}
        @mn-doc-history-close=${() => docHistory.onClose?.()}
        @mn-doc-history-diff-style-change=${(event: Event) =>
          docHistory.onDiffStyleChange?.(customDetail<DocHistoryDiffStyleDetail>(event))}
      ></mn-doc-history-panel>
    </div>
  `
}

function renderCommentsPanel(comments: WorkspaceCommentsOptions | null | undefined): TemplateResult {
  return html`<mn-comments-panel
    .comments=${comments?.comments ?? []}
    .hoveredCommentId=${comments?.hoveredCommentId ?? null}
    .emptyShortcut=${comments?.emptyShortcut ?? null}
    @mn-comment-select=${(event: Event) =>
      comments?.onSelect?.(customDetail<WorkspaceCommentDetail>(event))}
    @mn-comment-hover=${(event: Event) =>
      comments?.onHover?.(customDetail<WorkspaceCommentHoverDetail>(event))}
    @mn-comment-edit=${(event: Event) =>
      comments?.onEdit?.(customDetail<WorkspaceCommentEditDetail>(event))}
    @mn-comment-resolve=${(event: Event) =>
      comments?.onResolve?.(customDetail<WorkspaceCommentResolveDetail>(event))}
    @mn-comment-delete=${(event: Event) =>
      comments?.onDelete?.(customDetail<WorkspaceCommentDetail>(event))}
  ></mn-comments-panel>`
}

function renderInspectorPanel(inspector: WorkspaceInspectorOptions | null | undefined): TemplateResult {
  return html`<mn-inspector
    .model=${inspector?.model ?? null}
    .actions=${inspector?.actions ?? []}
    .showClose=${inspector?.showClose ?? true}
    @mn-inspector-close=${() => inspector?.onClose?.()}
    @mn-inspector-action=${(event: Event) =>
      inspector?.onAction?.(customDetail<WorkspaceInspectorActionDetail>(event))}
    @mn-inspector-relation-open=${(event: Event) =>
      inspector?.onRelationOpen?.(customDetail<WorkspaceInspectorRelationOpenDetail>(event))}
  ></mn-inspector>`
}

function renderCenterPanes(centerPanes: WorkspaceCenterPanesOptions): TemplateResult {
  return html`<sh-center-panes
    .projection=${centerPanes.projection}
    .editorHosts=${centerPanes.editorHosts}
    @mn-center-pane-open=${(event: Event) =>
      centerPanes.onOpen?.(customDetail<CenterPaneOpenIntentDetail>(event))}
    @mn-center-pane-focus=${(event: Event) =>
      centerPanes.onFocus?.(customDetail<CenterPaneFocusIntentDetail>(event))}
    @mn-center-pane-close=${(event: Event) =>
      centerPanes.onClose?.(customDetail<CenterPaneCloseIntentDetail>(event))}
    @mn-center-pane-navigate=${(event: Event) =>
      centerPanes.onNavigate?.(customDetail<CenterPaneNavigateIntentDetail>(event))}
    @mn-center-pane-resize=${(event: Event) =>
      centerPanes.onResize?.(customDetail<CenterPaneResizeIntentDetail>(event))}
  ></sh-center-panes>`
}

/**
 * The body of a spine region. STORE-FREE adaptation of app-shell's bodyFor
 * (~3070): every role resolves to the region's surface tag and is stamped INERT
 * via nucleus `stampPanelBody` unless the shell supplied an explicit host lift.
 * The editor lift still emits only an empty anchor here; the live editor host is
 * mounted separately. The chat lift lives in the pane because the Garden chat
 * panel is ordinary right-rail content, not a floating center singleton.
 *
 * Pure: config in, TemplateResult out. No DOM side-effects.
 */
function bodyFor(
  config: WorkspaceConfig,
  regionId: string,
  role: RegionRole,
  liftCenter: boolean,
  centerPanes: WorkspaceCenterPanesOptions | null,
  chatHost: RenderWorkspaceOptions['chatHost'],
  sidebar: RenderWorkspaceOptions['sidebar'],
  leftPanelMode: 'files' | 'graph' | 'outline',
  dailyNotes: RenderWorkspaceOptions['dailyNotes'],
  home: WorkspaceHomeOptions | null,
  wireBundle: WireBundle | null | undefined,
  wirePanel: WiresPanelMountOptions,
  rightPanel: RightPanelMode | null,
  tagLens: TagLensOptions | null,
  zoteroSource: ZoteroSourceOptions | null,
  artifact: ArtifactViewOptions | null,
  graphPanel: RenderWorkspaceOptions['graphPanel'],
  outlinePanel: RenderWorkspaceOptions['outlinePanel'],
  vtuberControls: RenderWorkspaceOptions['vtuberControls'],
  comments: WorkspaceCommentsOptions | null | undefined,
  inspector: WorkspaceInspectorOptions | null | undefined,
  parkedWork: ParkedWorkOptions | null,
): unknown {
  const configuredSurface = configuredSurfaceOwnsRegion(config, regionId)
  // master §3 Slice 8, WS3 §5.2 — the legacy (non-Surface) render path's own
  // centre branch, mirroring the Surface path's ordering: precedes `home`
  // (a graph whose parked-work route was opened must not silently render
  // Home instead).
  if (!configuredSurface && role === 'center' && parkedWork) {
    return renderParkedWork(parkedWork)
  }
  if (!configuredSurface && role === 'center' && home) {
    return renderHome(home, dailyNotes)
  }
  if (!configuredSurface && role === 'center' && tagLens) {
    return renderTagLens(tagLens)
  }
  if (!configuredSurface && role === 'center' && zoteroSource) {
    return renderZoteroSource(zoteroSource)
  }
  if (!configuredSurface && role === 'center' && artifact) {
    return renderArtifactView(artifact)
  }
  if (!configuredSurface && role === 'center' && dailyNotes?.showHomeRow) {
    return renderDailyNoteHome(dailyNotes)
  }
  if (!configuredSurface && role === 'center' && centerPanes) {
    const panes = renderCenterPanes(centerPanes)
    const header = renderDailyNoteHeader(dailyNotes)
    return header === nothing
      ? panes
      : html`<div class="daily-note-editor-frame" data-daily-note-editor-frame>${header}${panes}</div>`
  }
  // When lifting and this region is a Class-B persistent center (the editor),
  // the arm emits an EMPTY position anchor instead of the inert <tag> stamp —
  // the live node is owned by the separate keyed host, never the layout arm.
  if (liftCenter && isPersistentCenter(config, regionId)) {
    const header = renderDailyNoteHeader(dailyNotes)
    const anchor = renderCenterSlotAnchor(regionId)
    return header === nothing
      ? anchor
      : html`<div class="daily-note-editor-frame" data-daily-note-editor-frame>${header}${anchor}</div>`
  }
  if (role === 'right' && rightPanel !== null) {
    return renderRightPanel(
      config,
      rightPanel,
      chatHost,
      wireBundle,
      wirePanel,
      graphPanel,
      vtuberControls,
      comments,
      inspector,
      leftPanelMode === 'graph',
    )
  }
  const tag = resolveSurfaceTag(config, regionId)
  if (tag === 'mn-chat-panel' && chatHost?.service) {
    return mountChatHost(chatHost.service, chatHost.sessionId, {
      presentation: chatHost.presentation,
      composerReferenceResolver: chatHost.composerReferenceResolver,
      onSurfaceAction: chatHost.onSurfaceAction,
      onHeaderAction: chatHost.onHeaderAction,
    })
  }
  if (tag === 'mn-sidebar-panel') {
    if (leftPanelMode === 'graph') return renderGraphPanelAnchor('left')
    if (leftPanelMode === 'outline') return renderOutlinePanel(outlinePanel)
    return renderSidebarPanel(sidebar)
  }
  if (tag === 'mn-wires-panel') {
    return mountWiresPanel(wireBundle, wirePanel)
  }
  if (tag === 'mn-vtuber') {
    const panelId = config.regions[regionId]?.docksPanel[0] ?? null
    return renderVtuber(selectVtuberControlChannel(vtuberControls, { panelId, regionId }))
  }
  return tag ? stampPanelBody(tag) : nothing
}

function renderPanelBody(
  tag: string,
  panel: PanelId,
  chatHost: RenderWorkspaceOptions['chatHost'],
  wireBundle: WireBundle | null | undefined,
  wirePanel: WiresPanelMountOptions,
  _graphPanel: RenderWorkspaceOptions['graphPanel'],
  vtuberControls: RenderWorkspaceOptions['vtuberControls'],
  comments: WorkspaceCommentsOptions | null | undefined,
  inspector: WorkspaceInspectorOptions | null | undefined,
): unknown {
  if (tag === 'mn-chat-panel' && chatHost?.service) {
    return mountChatHost(chatHost.service, chatHost.sessionId, {
      presentation: chatHost.presentation,
      composerReferenceResolver: chatHost.composerReferenceResolver,
      onSurfaceAction: chatHost.onSurfaceAction,
      onHeaderAction: chatHost.onHeaderAction,
    })
  }
  if (tag === 'mn-wires-panel') {
    return mountWiresPanel(wireBundle, wirePanel)
  }
  if (tag === 'mn-graph-panel') {
    return renderGraphPanelAnchor('right')
  }
  if (tag === 'mn-comments-panel') {
    return renderCommentsPanel(comments)
  }
  if (tag === 'mn-inspector') {
    return renderInspectorPanel(inspector)
  }
  if (tag === 'mn-vtuber') {
    return renderVtuber(selectVtuberControlChannel(vtuberControls, { panelId: panel }))
  }
  return stampPanelBody(tag)
}

function renderRightPanel(
  config: WorkspaceConfig,
  panel: RightPanelMode,
  chatHost: RenderWorkspaceOptions['chatHost'],
  wireBundle: WireBundle | null | undefined,
  wirePanel: WiresPanelMountOptions,
  graphPanel: RenderWorkspaceOptions['graphPanel'],
  vtuberControls: RenderWorkspaceOptions['vtuberControls'],
  comments: WorkspaceCommentsOptions | null | undefined,
  inspector: WorkspaceInspectorOptions | null | undefined,
  graphInLeft: boolean,
): TemplateResult | typeof nothing {
  if (panel === 'none') return nothing
  const tag = resolvePanelTag(config, panel)
  if (tag === null || (graphInLeft && tag === 'mn-graph-panel')) return nothing

  // Keep the live chat host in one stable Lit part while the selected right
  // surface changes. The host is hidden when another panel is selected rather
  // than destroyed, so a contextual switch preserves the conversation, draft,
  // and any in-flight turn while the user still sees exactly one panel.
  const hasLiveChat = chatHost?.service != null
  const panelBody = panel === 'chat' && hasLiveChat
    ? nothing
    : renderPanelBody(tag, panel, chatHost, wireBundle, wirePanel, graphPanel, vtuberControls, comments, inspector)
  const chatSlot = hasLiveChat
    ? mountChatHost(chatHost.service, chatHost.sessionId, {
        presentation: chatHost.presentation,
        composerReferenceResolver: chatHost.composerReferenceResolver,
        onSurfaceAction: chatHost.onSurfaceAction,
        onHeaderAction: chatHost.onHeaderAction,
      })
    : nothing

  return html`<section class="right-panel" data-panel=${panel}>
    <div class="right-panel-body" ?hidden=${panel === 'chat' && hasLiveChat}>${panelBody}</div>
    <div class="right-panel-chat-slot" ?hidden=${panel !== 'chat'} aria-hidden=${panel !== 'chat'}>${chatSlot}</div>
  </section>`
}

/**
 * Cosmetic id → app-switcher tab shape (Slice 10). `deriveAppTabs` (nucleus)
 * only knows ids — labels/icons are a presentation concern this render host
 * owns, not `mn-top-bar` (which renders whatever tab list it's given, no
 * hardcoded names) and not nucleus (which has no icon vocabulary). Title-
 * cased id IS the label for both known apps today ('garden' → 'Garden',
 * 'choreograph' → 'Choreograph') — no per-app special-casing needed; an
 * unrecognized id still gets an honest label and a generic icon rather than
 * being dropped.
 */
function chromeAppTab(id: AppId): { readonly id: AppId; readonly label: string; readonly icon: string } {
  return {
    id,
    label: id.length > 0 ? id.charAt(0).toUpperCase() + id.slice(1) : id,
    icon: id === 'garden' ? 'sprout' : 'layers',
  }
}

function rightPanelModeForChrome(
  chrome: NonNullable<RenderWorkspaceOptions['chrome']>,
): RightPanelMode | null {
  if (chrome.rightPanel !== undefined) return chrome.rightPanel
  if (chrome.rightPanels !== undefined) return rightPanelModeFromPanels(chrome.rightPanels)
  return null
}

function renderChromeSurface(
  tag: string,
  opts: {
    activeApp: AppId
    /** Config-derived app ids (`deriveAppTabs`), or the shell's override. */
    apps: readonly AppId[]
    leftCollapsed: boolean
    rightCollapsed: boolean
    chrome: NonNullable<RenderWorkspaceOptions['chrome']>
  },
): TemplateResult {
  if (tag === 'mn-top-bar') {
    return html`<mn-top-bar
      .activeApp=${opts.chrome.activeApp ?? opts.activeApp}
      .apps=${(opts.chrome.apps ?? opts.apps).map(chromeAppTab)}
      .isDark=${opts.chrome.isDark ?? false}
      .activeSkin=${opts.chrome.activeSkin ?? 'garden'}
      .breadcrumbs=${opts.chrome.breadcrumbs ?? []}
      .quickClipAvailable=${opts.chrome.quickClip?.available ?? false}
      .quickClipStatus=${opts.chrome.quickClip?.status ?? 'idle'}
      .quickClipError=${opts.chrome.quickClip?.error ?? ''}
      .access=${opts.chrome.access ?? null}
      .workspaces=${opts.chrome.workspaces ?? null}
      .workspaceStatus=${opts.chrome.workspaceStatus ?? 'idle'}
      .workspaceError=${opts.chrome.workspaceError ?? ''}
      .activeWorkspaceId=${opts.chrome.activeWorkspaceId ?? ''}
      .workspaceBusyId=${opts.chrome.workspaceBusyId ?? ''}
      @mn-breadcrumb-open=${(event: CustomEvent<{ breadcrumb: WorkspaceChromeBreadcrumb }>) =>
        opts.chrome.onBreadcrumbOpen?.(event.detail)}
      @mn-breadcrumb-menu-open=${(event: CustomEvent<{ breadcrumb: WorkspaceChromeBreadcrumb, x: number, y: number }>) =>
        opts.chrome.onBreadcrumbMenuOpen?.(event.detail)}
      @mn-quick-clip-request=${(event: Event) =>
        opts.chrome.quickClip?.onRequest?.(customDetail<WorkspaceQuickClipRequestDetail>(event))}
      @mn-quick-clip-reset=${() => opts.chrome.quickClip?.onReset?.()}
      @mn-quick-clip-open-change=${(event: Event) =>
        opts.chrome.quickClip?.onOpenChange?.(customDetail<{ open: boolean }>(event).open)}
      @mn-access-open=${() => opts.chrome.access?.onOpen?.()}
      @mn-access-refresh=${() => opts.chrome.access?.onRefresh?.()}
      @mn-access-add=${(event: Event) =>
        opts.chrome.access?.onAdd?.(customDetail<WorkspaceAccessAddDetail>(event))}
      @mn-access-role-change=${(event: Event) =>
        opts.chrome.access?.onRoleChange?.(customDetail<WorkspaceAccessRoleChangeDetail>(event))}
      @mn-access-remove=${(event: Event) =>
        opts.chrome.access?.onRemove?.(customDetail<WorkspaceAccessRemoveDetail>(event))}
      @mn-workspace-refresh=${() => opts.chrome.onWorkspaceRefresh?.()}
      @mn-workspace-select=${(event: Event) =>
        opts.chrome.onWorkspaceSelect?.(customDetail<{ workspace: WorkspaceSummary }>(event).workspace)}
      @mn-workspace-create=${() => opts.chrome.onWorkspaceCreate?.()}
      @mn-workspace-delete=${(event: Event) =>
        opts.chrome.onWorkspaceDelete?.(customDetail<{ workspace: WorkspaceSummary }>(event).workspace)}
    ></mn-top-bar>`
  }
  if (tag === 'mn-bottom-bar') {
    return html`<mn-bottom-bar
      .leftCollapsed=${opts.leftCollapsed}
      .rightCollapsed=${opts.rightCollapsed}
      .leftPanelMode=${opts.chrome.leftPanelMode ?? 'files'}
      .panel=${rightPanelModeForChrome(opts.chrome) ?? 'chat'}
      .itemCount=${opts.chrome.itemCount ?? null}
      .documentStats=${opts.chrome.documentStats ?? null}
      .documentExportAvailable=${opts.chrome.documentExportAvailable ?? false}
      .presence=${opts.chrome.presence ?? []}
      .syncState=${opts.chrome.syncState ?? 'idle'}
      .runtimeMode=${opts.chrome.runtimeMode ?? null}
      .sourceStatus=${opts.chrome.sourceStatus ?? null}
    ></mn-bottom-bar>`
  }
  return stampPanelBody(tag)
}

type SplitPanelElement = HTMLElement & {
  position?: number
  positionInPixels?: number
  size?: number
}

function finitePosition(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Number(value))) : fallback
}

function splitPanelSize(panel: SplitPanelElement): number {
  if (Number.isFinite(panel.size) && Number(panel.size) > 0) return Number(panel.size)
  return panel.getBoundingClientRect().width
}

function panelWidthBounds(role: WorkspacePanelSplitRole, size: number): { min: number; max: number } {
  const min = role === 'left' ? 180 : 240
  return { min, max: Math.max(min, Math.min(500, size - 400)) }
}

function clampPanelWidth(role: WorkspacePanelSplitRole, width: number, size: number): number {
  const bounds = panelWidthBounds(role, size)
  return Math.min(bounds.max, Math.max(bounds.min, width))
}

/** Shoelace's reposition event carries state on currentTarget, not detail. */
function forwardSplitReposition(
  role: WorkspacePanelSplitRole,
  event: Event,
  panelLayout: WorkspacePanelLayoutOptions,
): void {
  // The inner split's composed event bubbles through the outer split unless it
  // is stopped, which would overwrite the left width with the right position.
  if (role === 'right') event.stopPropagation()
  const panel = event.currentTarget as SplitPanelElement | null
  if (!panel) return
  const size = splitPanelSize(panel)
  const position = finitePosition(panel.position, 0)
  // positionInPixels can lag after an ancestor/nested split resize. Garden's
  // resize handlers use the live percentage × live size, which is canonical.
  const rawWidth = size > 0
    ? (position / 100) * size
    : Number.isFinite(panel.positionInPixels)
      ? Number(panel.positionInPixels)
      : 0
  const width = role === 'left' && panelLayout.leftExpanded
    ? rawWidth
    : size > 0
      ? clampPanelWidth(role, rawWidth, size)
      : rawWidth

  if (size > 0 && Math.abs(width - rawWidth) > 0.5) {
    panel.position = (width / size) * 100
  }
  const canonicalPosition = size > 0 ? (width / size) * 100 : position
  panel.closest<HTMLElement>('.app-container')?.style.setProperty(
    role === 'left' ? '--mn-left-panel-width' : '--mn-right-panel-width',
    `${Math.round(width)}px`,
  )
  panelLayout.onReposition?.({ role, width: Math.round(width), position: canonicalPosition, size })
}

function renderPanelEdgeControls(
  role: RegionRole,
  panelLayout: WorkspacePanelLayoutOptions | null,
): TemplateResult | typeof nothing {
  if (!panelLayout) return nothing
  if (role === 'sidebar' && (panelLayout.onLeftExpandedChange || panelLayout.onLeftCollapsedChange)) {
    const expanded = panelLayout.leftExpanded ?? false
    return html`<div class="panel-edge-btns" data-panel-controls="left">
      ${panelLayout.onLeftExpandedChange ? html`<button
        type="button"
        data-panel-mode=${expanded ? 'normal' : 'expanded'}
        aria-label=${expanded ? 'Return to normal width' : 'Expand sidebar'}
        aria-expanded=${expanded ? 'true' : 'false'}
        title=${expanded ? 'Return to normal width' : 'Expand sidebar'}
        @click=${() => panelLayout.onLeftExpandedChange?.(!expanded)}
      ><span aria-hidden="true">${expanded ? '‹' : '›'}</span></button>` : nothing}
      ${panelLayout.onLeftCollapsedChange ? html`<button
        type="button"
        data-panel-mode="collapsed"
        aria-label="Collapse sidebar"
        aria-expanded="true"
        title="Collapse sidebar"
        @click=${() => panelLayout.onLeftCollapsedChange?.(true)}
      ><span aria-hidden="true">«</span></button>` : nothing}
    </div>`
  }
  if (role === 'right' && panelLayout.onRightCollapsedChange) {
    return html`<button
      type="button"
      class="panel-edge-btn"
      data-panel-controls="right"
      data-panel-mode="collapsed"
      aria-label="Close right panel"
      aria-expanded="true"
      title="Close panel"
      @click=${() => panelLayout.onRightCollapsedChange?.(true)}
    ><span aria-hidden="true">»</span></button>`
  }
  return nothing
}

/**
 * Render the split-tree (the `.main` content) by recursively walking plan.spine.
 *
 * Direct adaptation of app-shell.ts:renderSpineForPlan (~3031–3126). The walker
 * follows the plan's spine region order, so it expresses an ARBITRARY spine
 * shape (it is NOT hardcoded to left→center→right). Per spine region it stamps
 * the start-slot body by role and composes the present (non-collapsed) regions
 * into nested <sl-split-panel>s.
 *
 * Differences from garden (the island cut):
 *   - bodies are all inert `stampPanelBody` (no renderCenterSlotAnchor /
 *     renderLeftPanel / renderRightRail methods, no store reads).
 *   - @sl-reposition is enabled only through an optional controlled seam.
 *   - collapse is the explicit `opts` input, not transient store state.
 *
 * Split chrome is keyed off the START region's role, matching garden exactly:
 *   start=center → right-split: class="right-split", position=innerPosition
 *   otherwise    → outer split: no class,           position=outerPosition
 */
function renderSpine(
  config: WorkspaceConfig,
  plan: WorkspaceSpinePlan,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  liftCenter: boolean,
  centerPanes: WorkspaceCenterPanesOptions | null,
  chatHost: RenderWorkspaceOptions['chatHost'],
  sidebar: RenderWorkspaceOptions['sidebar'],
  leftPanelMode: 'files' | 'graph' | 'outline',
  dailyNotes: RenderWorkspaceOptions['dailyNotes'],
  home: WorkspaceHomeOptions | null,
  wireBundle: WireBundle | null | undefined,
  wirePanel: WiresPanelMountOptions,
  rightPanel: RightPanelMode | null,
  tagLens: TagLensOptions | null,
  zoteroSource: ZoteroSourceOptions | null,
  artifact: ArtifactViewOptions | null,
  graphPanel: RenderWorkspaceOptions['graphPanel'],
  outlinePanel: RenderWorkspaceOptions['outlinePanel'],
  vtuberControls: RenderWorkspaceOptions['vtuberControls'],
  comments: WorkspaceCommentsOptions | null | undefined,
  inspector: WorkspaceInspectorOptions | null | undefined,
  panelLayout: WorkspacePanelLayoutOptions | null,
  parkedWork: ParkedWorkOptions | null,
): TemplateResult | typeof nothing {
  // ── Plan-derived positions (same 20/75 for GARDEN_DEFAULT, divergent for variants) ──
  const outerSplit = plan.spine.kind === 'split' ? (plan.spine as SplitNode) : null
  const outerPlanPosition = outerSplit?.position ?? 20
  const outerPosition = panelLayout?.leftExpanded ? 70 : outerPlanPosition
  const innerSplit = outerSplit?.child.kind === 'split' ? (outerSplit.child as SplitNode) : null
  const innerPosition = innerSplit?.position ?? 75

  // ── Flatten the plan's spine into ordered { regionId, role } entries ──
  const entries: Array<{ regionId: string; role: RegionRole }> = []
  {
    let node: WorkspaceSpinePlan['spine'] | null = plan.spine
    while (node) {
      entries.push({ regionId: node.regionId, role: engineRegionRole(config, node.regionId) })
      node = node.kind === 'split' ? (node as SplitNode).child : null
    }
  }

  // ── Map transient collapse onto the spine: drop collapsed regions ──
  // (sidebar when leftCollapsed; right rail when rightCollapsed). Center and any
  // 'other' content region are never collapsed.
  const present = entries.filter(e => {
    if (e.role === 'sidebar' && leftCollapsed) return false
    if (e.role === 'right' && rightCollapsed) return false
    return true
  })

  // ── Recursive split-tree emitter over the present entries ──
  // `nested` => this subtree is the end-slot of a parent split (needs slot="end").
  const emit = (
    list: Array<{ regionId: string; role: RegionRole }>,
    nested: boolean,
  ): TemplateResult | typeof nothing => {
    if (list.length === 0) return nothing
    const [head, ...rest] = list
    if (rest.length === 0) {
      // Leaf. As the sole present region it is rendered BARE (the both-collapsed
      // shape); as a parent split's end-slot it is wrapped in <div slot="end">.
      const body = bodyFor(
        config,
        head.regionId,
        head.role,
        liftCenter,
        centerPanes,
        chatHost,
        sidebar,
        leftPanelMode,
        dailyNotes,
        home,
        wireBundle,
        wirePanel,
        rightPanel,
        tagLens,
        zoteroSource,
        artifact,
        graphPanel,
        outlinePanel,
        vtuberControls,
        comments,
        inspector,
        parkedWork,
      )
      const controls = renderPanelEdgeControls(head.role, panelLayout)
      const landmarkRole = landmarkRoleFor(head.role, liftCenter)
      const landmarkLabel = landmarkLabelFor(head.role)
      if (!nested) return html`<div class="split-pane" data-region=${head.regionId} data-role=${head.role} role=${landmarkRole ?? nothing} aria-label=${landmarkLabel ?? nothing} style="min-width: ${minWidthFor(head.role)}px;">${body}${controls}</div>`
      return html`<div slot="end" class="split-pane" data-region=${head.regionId} data-role=${head.role} role=${landmarkRole ?? nothing} aria-label=${landmarkLabel ?? nothing} style="min-width: ${minWidthFor(head.role)}px;">${body}${controls}</div>`
    }
    // Split: chrome keyed off the START region's role.
    const isRightSplit = head.role === 'center'
    const splitRole: WorkspacePanelSplitRole = isRightSplit ? 'right' : 'left'
    // A controlled right split makes its END pane primary, so position and snap
    // points directly describe right-rail width. Uncontrolled markup preserves
    // the config's traditional start-pane percentage.
    const position = isRightSplit && panelLayout
      ? 100 - innerPosition
      : isRightSplit
        ? innerPosition
        : outerPosition
    const snap = panelLayout
      ? isRightSplit
        ? panelLayout.rightSnap ?? null
        : panelLayout.leftSnap ?? null
      : null
    const startBody = bodyFor(
      config,
      head.regionId,
      head.role,
      liftCenter,
      centerPanes,
      chatHost,
      sidebar,
      leftPanelMode,
      dailyNotes,
      home,
      wireBundle,
      wirePanel,
      rightPanel,
      tagLens,
      zoteroSource,
      artifact,
      graphPanel,
      outlinePanel,
      vtuberControls,
      comments,
      inspector,
      parkedWork,
    )
    const startControls = renderPanelEdgeControls(head.role, panelLayout)
    const landmarkRole = landmarkRoleFor(head.role, liftCenter)
    const landmarkLabel = landmarkLabelFor(head.role)
    return html`
      <sl-split-panel
        class=${isRightSplit ? 'right-split' : nothing}
        slot=${nested ? 'end' : nothing}
        data-split-role=${splitRole}
        primary=${panelLayout ? isRightSplit ? 'end' : panelLayout.leftExpanded ? nothing : 'start' : nothing}
        position=${position}
        snap=${snap ?? nothing}
        snap-threshold=${panelLayout ? panelLayout.snapThreshold ?? 12 : nothing}
        @sl-reposition=${panelLayout
          ? (event: Event) => forwardSplitReposition(splitRole, event, panelLayout)
          : null}
      >
        <div slot="start" class="split-pane" data-region=${head.regionId} data-role=${head.role} role=${landmarkRole ?? nothing} aria-label=${landmarkLabel ?? nothing} style="min-width: ${minWidthFor(head.role)}px;">${startBody}${startControls}</div>
        ${emit(rest, true)}
      </sl-split-panel>
    `
  }

  return emit(present, false)
}

// ── Production Surface adapter ────────────────────────────────────────────────

const WORKSPACE_SURFACE_TAG = 'sh-workspace-surface'
const SURFACE_EPOCH = new Date(0).toISOString()

const SURFACE_FACE = Object.freeze({
  home: 'garden.home',
  tagLens: 'garden.tag-lens',
  zoteroSource: 'garden.zotero-source',
  artifact: 'garden.artifact',
  dailyHome: 'garden.daily-note-home',
  dailyHeader: 'garden.daily-note-header',
  paneHeader: 'garden.pane-header',
  paneEditor: 'garden.pane-editor',
  editorAnchor: 'garden.editor-anchor',
  fragmentStatus: 'layout.fragment-status',
  /** master §3 Slice 8, WS3 §5.2. Records ABOUT a previous life of this
   *  graph — client-local by construction, never authorable from a graph
   *  document, which is why it is a route face and not a fragment. */
  parkedWork: 'garden.parked-work',
})

type WorkspaceSurfaceFaceState =
  | {
      readonly kind: 'component'
      readonly tag: string
      readonly role: RegionRole | 'rail'
      readonly regionId: string
      readonly panelId?: PanelId
      readonly panelIndex?: number
      readonly opts: RenderWorkspaceOptions
      readonly wirePanel: WiresPanelMountOptions
    }
  | { readonly kind: 'home'; readonly home: WorkspaceHomeOptions; readonly dailyNotes: RenderWorkspaceOptions['dailyNotes'] }
  | { readonly kind: 'tag-lens'; readonly value: TagLensOptions }
  | { readonly kind: 'zotero-source'; readonly value: ZoteroSourceOptions }
  | { readonly kind: 'artifact'; readonly value: ArtifactViewOptions }
  | { readonly kind: 'daily-home'; readonly value: NonNullable<RenderWorkspaceOptions['dailyNotes']> }
  | { readonly kind: 'daily-header'; readonly value: NonNullable<RenderWorkspaceOptions['dailyNotes']> }
  | {
      readonly kind: 'pane-header'
      readonly pane: CenterPaneProjection
      readonly group: WorkspaceCenterPanesOptions
    }
  | {
      readonly kind: 'pane-editor'
      readonly pane: CenterPaneProjection
      readonly group: WorkspaceCenterPanesOptions
      readonly editor: CenterPaneEditorHostOptions | null
    }
  | { readonly kind: 'editor-anchor'; readonly regionId: string }
  | {
      readonly kind: 'fragment-status'
      readonly regionId: string
      readonly value: WorkspaceFragmentStatusValue
    }
  | { readonly kind: 'parked-work'; readonly value: ParkedWorkOptions }

/** The honest non-content states a fragment region can render (never a blank pane). */
interface WorkspaceFragmentStatusValue {
  readonly kind: 'missing' | 'loading' | 'error' | 'invalid'
  readonly surfaceIri: string | null
  readonly detail?: string
}

type WorkspaceSurfaceSplitMetadata =
  | { readonly kind: 'left-panel' }
  | { readonly kind: 'right-panel' }
  | { readonly kind: 'center-panes'; readonly group: WorkspaceCenterPanesOptions }
  | { readonly kind: 'fixed-chrome' }
  | { readonly kind: 'config' }
  | {
      /** A split INSIDE a spliced graph-authored fragment (Stage B/C unification). */
      readonly kind: 'fragment'
      readonly regionId: string
      readonly surfaceIri: string
      /** The split's ORIGINAL fragment node id — the ratio-persist target. */
      readonly fragmentSplitId: string
    }

interface WorkspaceSurfaceTabsMetadata {
  /** A tabs node INSIDE a spliced graph-authored fragment. */
  readonly kind: 'fragment'
  readonly regionId: string
  readonly surfaceIri: string
  /** The tabs node's ORIGINAL fragment node id — the active-tab persist target. */
  readonly fragmentTabsId: string
}

interface WorkspaceSurfaceMetadata {
  readonly splits: ReadonlyMap<string, WorkspaceSurfaceSplitMetadata>
  readonly tabs: ReadonlyMap<string, WorkspaceSurfaceTabsMetadata>
  readonly opts: RenderWorkspaceOptions
}

interface WorkspaceSurfaceAssembly {
  readonly document: LayoutDocument
  readonly bindings: ReadonlyMap<string, WorkspaceSurfaceFaceState>
  readonly metadata: WorkspaceSurfaceMetadata
}

function componentFaceId(tag: string): string {
  return `component.${tag}`
}

function surfaceResource(id: string): ResourceLocator {
  return { kind: 'iri', iri: `urn:shrubbery:surface:${id}` }
}

function acceptsSurfaceIri(locator: ResourceLocator, ...prefixes: readonly string[]): boolean {
  if (locator.kind !== 'iri') return false
  return prefixes.some(prefix => locator.iri.startsWith(`urn:shrubbery:surface:${prefix}`))
}

function acceptsComponentSurfaceResource(tag: string, locator: ResourceLocator): boolean {
  if (acceptsSurfaceIri(locator, `${tag}:`)) return true
  if (tag === 'mn-chat-panel') return locator.kind === 'chat'
  if (tag === 'mn-graph-panel') return locator.kind === 'graph'
  return false
}

function decorateSurfaceTarget(
  target: HTMLElement,
  state: {
    readonly role: RegionRole | 'rail'
    readonly regionId?: string
    readonly panelId?: PanelId
    readonly paneId?: CenterPaneId
    readonly active?: boolean
    readonly surfacePart?: string
  },
): void {
  target.className = 'split-pane surface-leaf'
  target.dataset.role = state.role
  if (state.regionId) target.dataset.region = state.regionId
  else delete target.dataset.region
  if (state.panelId) target.dataset.panel = state.panelId
  else delete target.dataset.panel
  if (state.paneId) target.dataset.paneId = state.paneId
  else delete target.dataset.paneId
  if (state.active !== undefined) target.dataset.active = String(state.active)
  else delete target.dataset.active
  if (state.surfacePart) target.dataset.surfacePart = state.surfacePart
  else delete target.dataset.surfacePart
  if (state.role === 'sidebar') {
    target.setAttribute('role', 'navigation')
    target.setAttribute('aria-label', 'Workspace')
  } else if (state.role === 'right') {
    target.setAttribute('role', 'complementary')
    target.setAttribute('aria-label', state.panelId ? `Secondary panel: ${state.panelId}` : 'Secondary panels')
  } else if (state.role === 'center' && (state.surfacePart === 'configured-region' || state.surfacePart === 'center-route')) {
    target.setAttribute('role', 'main')
    target.removeAttribute('aria-label')
  } else {
    target.removeAttribute('role')
    target.removeAttribute('aria-label')
  }
}

function resolvedWirePanelForSurface(opts: RenderWorkspaceOptions): WiresPanelMountOptions {
  return {
    wireContexts: opts.wirePanelContexts ?? null,
    localGraphId: opts.wirePanelLocalContext?.graphId ?? null,
    localDocumentId: opts.wirePanelLocalContext?.documentId ?? null,
    localDocumentTitle: opts.wirePanelLocalContext?.title ?? null,
    ...(opts.wirePanel ?? {}),
  }
}

function surfaceEventTitle(disabledReason: string | undefined, fallback: string): string {
  return disabledReason ? `${fallback} — ${disabledReason}` : fallback
}

function renderSurfaceComponent(
  target: HTMLElement,
  state: Extract<WorkspaceSurfaceFaceState, { readonly kind: 'component' }>,
): unknown {
  decorateSurfaceTarget(target, {
    role: state.role,
    regionId: state.regionId,
    panelId: state.panelId,
    surfacePart: state.panelId ? 'right-panel' : state.role === 'sidebar' ? 'sidebar' : 'configured-region',
  })
  target.dataset.surfaceTag = state.tag
  const opts = state.opts
  const leftMode = opts.chrome?.leftPanelMode ?? 'files'
  let body: unknown
  if (state.panelId) {
    body = renderPanelBody(
      state.tag,
      state.panelId,
      opts.chatHost,
      opts.editorWireBundle,
      state.wirePanel,
      opts.graphPanel,
      opts.vtuberControls,
      opts.comments,
      opts.inspector,
    )
  } else if (state.tag === 'mn-sidebar-panel') {
    body = leftMode === 'graph' ? renderGraphPanelAnchor('left') : renderSidebarPanel(opts.sidebar)
  } else if (state.tag === 'mn-chat-panel' && opts.chatHost?.service) {
    body = mountChatHost(opts.chatHost.service, opts.chatHost.sessionId, {
      presentation: opts.chatHost.presentation,
      composerReferenceResolver: opts.chatHost.composerReferenceResolver,
      onSurfaceAction: opts.chatHost.onSurfaceAction,
      onHeaderAction: opts.chatHost.onHeaderAction,
    })
  } else if (state.tag === 'mn-wires-panel') {
    body = mountWiresPanel(opts.editorWireBundle, state.wirePanel)
  } else if (state.tag === 'mn-graph-panel') {
    body = renderGraphPanelAnchor(state.role === 'sidebar' ? 'left' : 'right')
  } else if (state.tag === 'mn-comments-panel') {
    body = renderCommentsPanel(opts.comments)
  } else if (state.tag === 'mn-inspector') {
    body = renderInspectorPanel(opts.inspector)
  } else if (state.tag === 'mn-vtuber') {
    body = renderVtuber(selectVtuberControlChannel(opts.vtuberControls, { regionId: state.regionId }))
  } else {
    body = stampPanelBody(state.tag)
  }

  const liveChat = state.role === 'right' && opts.chatHost?.service != null
  if (liveChat && state.panelId === 'chat') body = nothing
  const chatBody = liveChat
    ? mountChatHost(opts.chatHost!.service, opts.chatHost!.sessionId, {
        presentation: opts.chatHost!.presentation,
        composerReferenceResolver: opts.chatHost!.composerReferenceResolver,
        onSurfaceAction: opts.chatHost!.onSurfaceAction,
        onHeaderAction: opts.chatHost!.onHeaderAction,
      })
    : nothing
  const rightBody = state.role === 'right' && liveChat
    ? html`
        <div class="right-panel-body" ?hidden=${state.panelId === 'chat'}>
          ${body}
        </div>
        <div
          class="right-panel-chat-slot"
          ?hidden=${state.panelId !== 'chat'}
          aria-hidden=${state.panelId !== 'chat'}
        >${chatBody}</div>`
    : body
  const controls = state.role === 'sidebar' || (state.role === 'right' && (state.panelIndex ?? 0) === 0)
    ? renderPanelEdgeControls(state.role, opts.panelLayout ?? null)
    : nothing
  return state.panelId
    ? html`<section class="right-panel" data-panel=${state.panelId}>${rightBody}${controls}</section>`
    : [body, controls]
}

function requestSurfacePaneFocus(
  pane: CenterPaneProjection,
  group: WorkspaceCenterPanesOptions,
  reason: CenterPaneFocusIntentDetail['reason'],
): void {
  // Match sh-center-panes' controlled focus contract: pointer/focus events
  // inside the pane that is already active are observations, not navigation.
  // Re-emitting them makes the shell perform a full document activation render
  // while the browser is still completing the original focus gesture.
  if (pane.active && reason !== 'programmatic') return
  group.onFocus?.({ paneId: pane.id, reason })
}

function requestSurfacePaneFocusFromEvent(
  event: Event,
  pane: CenterPaneProjection,
  group: WorkspaceCenterPanesOptions,
  reason: 'pointer' | 'focus',
): void {
  // Pane commands own complete intents of their own. Preserve the legacy
  // host's header-path filter and explicitly cover the empty-pane open action
  // (whose open intent already requests activation), so pointerdown/focusin
  // cannot synchronously rebuild the pane before the click is delivered.
  const path = event.composedPath()
  const separator = path.some(target =>
    target instanceof Element && target.matches('[role="separator"]'),
  )
  const emptyOpen = path.some(target =>
    target instanceof Element && target.matches('.surface-pane-empty .empty-open'),
  )
  const paneHeaderIndex = path.findIndex(target =>
    target instanceof Element && target.matches('.surface-pane-header'),
  )
  const buttonIndex = path.findIndex(target =>
    target instanceof Element && target.matches('button, [role="button"]'),
  )
  const command = separator
    || emptyOpen
    || (paneHeaderIndex >= 0 && buttonIndex >= 0 && buttonIndex < paneHeaderIndex)
  if (!command) requestSurfacePaneFocus(pane, group, reason)
}

function renderSurfacePaneHeader(
  target: HTMLElement,
  state: Extract<WorkspaceSurfaceFaceState, { readonly kind: 'pane-header' }>,
): unknown {
  const { pane, group } = state
  decorateSurfaceTarget(target, {
    role: 'center',
    paneId: pane.id,
    active: pane.active,
    surfacePart: 'pane-header',
  })
  const splitCommand = group.projection.splitCommand
  const requestSplit = (): void => {
    if (splitCommand.disabled) return
    if (splitCommand.action === 'close') {
      const secondary = group.projection.panes.find(candidate => candidate.position === 'secondary')
      if (secondary) group.onClose?.({ paneId: secondary.id, reason: 'split-command' })
      return
    }
    group.onOpen?.({
      paneId: pane.id,
      placement: 'split',
      reason: 'split-command',
      location: homeLocation(pane.current.graphId),
      activate: true,
    })
  }
  return html`<div
    class="surface-pane-header"
    role="toolbar"
    aria-label=${`${pane.title} navigation`}
    @pointerdown=${(event: PointerEvent) =>
      requestSurfacePaneFocusFromEvent(event, pane, group, 'pointer')}
    @focusin=${(event: FocusEvent) =>
      requestSurfacePaneFocusFromEvent(event, pane, group, 'focus')}
  >
    <span class="pane-position" aria-hidden="true"></span>
    <button
      class="pane-command"
      data-pane-back=${pane.id}
      aria-label=${`Go back in ${pane.title}`}
      title=${surfaceEventTitle(pane.capabilities.navigateDisabledReason, 'Go back')}
      ?disabled=${!pane.canGoBack}
      @click=${() => group.onNavigate?.({ paneId: pane.id, direction: 'back' })}
    >←</button>
    <button
      class="pane-command"
      data-pane-forward=${pane.id}
      aria-label=${`Go forward in ${pane.title}`}
      title=${surfaceEventTitle(pane.capabilities.navigateDisabledReason, 'Go forward')}
      ?disabled=${!pane.canGoForward}
      @click=${() => group.onNavigate?.({ paneId: pane.id, direction: 'forward' })}
    >→</button>
    <button
      class="pane-title"
      type="button"
      title=${pane.title}
      @click=${() => requestSurfacePaneFocus(pane, group, 'pointer')}
    >${pane.title}</button>
    <button
      class="pane-command"
      data-pane-open=${pane.id}
      aria-label=${`Open a document in ${pane.title}`}
      title=${surfaceEventTitle(pane.capabilities.openDisabledReason, 'Open a document in this pane')}
      ?disabled=${!pane.capabilities.openDocument}
      @click=${() => group.onOpen?.({ paneId: pane.id, placement: 'active', reason: 'choose-document', activate: true })}
    >⌘O</button>
    ${pane.active ? html`<button
      class="split-command"
      data-split-command
      aria-pressed=${splitCommand.pressed ? 'true' : 'false'}
      aria-label=${splitCommand.label}
      title=${surfaceEventTitle(splitCommand.disabledReason, splitCommand.label)}
      ?disabled=${splitCommand.disabled}
      @click=${requestSplit}
    >${splitCommand.label}</button>` : nothing}
    ${pane.position === 'secondary' ? html`<button
      class="pane-command"
      data-pane-close=${pane.id}
      aria-label="Close secondary pane"
      title=${surfaceEventTitle(pane.capabilities.closeDisabledReason, 'Close secondary pane')}
      ?disabled=${!pane.capabilities.close}
      @click=${() => group.onClose?.({ paneId: pane.id, reason: 'pane-command' })}
    >×</button>` : nothing}
  </div>`
}

function renderSurfacePaneEditor(
  target: HTMLElement,
  state: Extract<WorkspaceSurfaceFaceState, { readonly kind: 'pane-editor' }>,
): unknown {
  const { pane, group, editor } = state
  decorateSurfaceTarget(target, {
    role: 'center',
    paneId: pane.id,
    active: pane.active,
    surfacePart: 'center-content',
  })
  const token = pane.id.replace(/[^a-zA-Z0-9_-]/g, '-')
  return html`<div
    class="surface-pane-stage"
    data-pane-stage=${pane.id}
    @pointerdown=${(event: PointerEvent) =>
      requestSurfacePaneFocusFromEvent(event, pane, group, 'pointer')}
    @focusin=${(event: FocusEvent) =>
      requestSurfacePaneFocusFromEvent(event, pane, group, 'focus')}
  >
    <sh-editor-host
      id=${pane.position === 'primary' ? 'mn-editor-host' : `center-editor-host-${token}`}
      data-center-pane-host=${token}
      layout-mode="contained"
      .paneActive=${pane.active}
      .binding=${editor?.binding ?? null}
      .kernelOptions=${editor?.kernelOptions ?? null}
      .initialZoomBlockId=${editor?.initialZoomBlockId ?? null}
      .focusRequest=${editor?.focusRequest ?? null}
      .wireBundle=${editor?.wireBundle ?? null}
      .wireRadialContexts=${editor?.wireRadialContexts ?? null}
      .salienceBundle=${editor?.salienceBundle ?? null}
      .imageInserter=${editor?.imageInserter ?? null}
      .footnoteInserter=${editor?.footnoteInserter ?? null}
      .commentInserter=${editor?.commentInserter ?? null}
      .originalFileView=${editor?.originalFileView ?? null}
      .documentAccess=${editor?.documentAccess ?? null}
      .ttsStatus=${editor?.ttsStatus ?? 'idle'}
      .ttsAvailable=${editor?.ttsAvailable ?? false}
    ></sh-editor-host>
    ${pane.current.kind === 'home' ? html`<div class="surface-pane-empty" data-pane-home=${pane.id}>
      <span>${pane.position === 'primary' ? 'Choose a document to begin.' : 'A second path through the garden.'}</span>
      <button
        class="empty-open"
        ?disabled=${!pane.capabilities.openDocument}
        @click=${() => group.onOpen?.({ paneId: pane.id, placement: 'active', reason: 'choose-document', activate: true })}
      >Open a document</button>
    </div>` : nothing}
  </div>`
}

function renderWorkspaceSurfaceFace(target: HTMLElement, raw: unknown): unknown {
  const state = raw as WorkspaceSurfaceFaceState | undefined
  if (!state) return nothing
  switch (state.kind) {
    case 'component': return renderSurfaceComponent(target, state)
    case 'home':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderHome(state.home, state.dailyNotes)
    case 'tag-lens':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderTagLens(state.value)
    case 'zotero-source':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderZoteroSource(state.value)
    case 'artifact':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderArtifactView(state.value)
    case 'daily-home':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderDailyNoteHome(state.value)
    case 'daily-header':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'daily-note-header' })
      return renderDailyNoteHeader(state.value)
    case 'pane-header': return renderSurfacePaneHeader(target, state)
    case 'pane-editor': return renderSurfacePaneEditor(target, state)
    case 'editor-anchor':
      decorateSurfaceTarget(target, { role: 'center', regionId: state.regionId, surfacePart: 'center-content' })
      return renderCenterSlotAnchor(state.regionId)
    case 'fragment-status':
      return renderFragmentStatus(target, state)
    case 'parked-work':
      decorateSurfaceTarget(target, { role: 'center', surfacePart: 'center-route' })
      return renderParkedWork(state.value)
  }
}

const FRAGMENT_STATUS_HEADLINE: Record<WorkspaceFragmentStatusValue['kind'], string> = {
  missing:
    'This region declares a graph-authored layout fragment ' +
    `(${LAYOUT_DASHBOARD_COMPONENT}), but the shell supplied no fragment for it.`,
  loading: 'Loading the graph-authored layout fragment…',
  error: 'The graph-authored layout fragment failed to load.',
  invalid: 'The graph-authored layout fragment is invalid and was not spliced.',
}

/**
 * Status color is RESERVED and never carries meaning alone: each kind pairs
 * its tone with BOTH a text glyph and the (always-present) headline label.
 * 'missing' is a configuration gap, not an alarm, so it stays neutral.
 */
type FragmentStatusTone = 'neutral' | 'info' | 'warning' | 'danger'

const FRAGMENT_STATUS_TONE: Record<WorkspaceFragmentStatusValue['kind'], FragmentStatusTone> = {
  missing: 'neutral',
  loading: 'info',
  error: 'danger',
  invalid: 'warning',
}

const FRAGMENT_STATUS_GLYPH: Record<WorkspaceFragmentStatusValue['kind'], string> = {
  missing: '◇',
  loading: '○',
  error: '✕',
  invalid: '△',
}

/** Every color here is a --mn-* semantic token — zero raw hex in this module. */
const FRAGMENT_STATUS_TONE_VARS: Record<FragmentStatusTone, { readonly ink: string; readonly edge: string; readonly wash: string }> = {
  neutral: { ink: 'var(--mn-color-text-muted)', edge: 'var(--mn-color-border-default)', wash: 'var(--mn-color-surface-sunken)' },
  info: { ink: 'var(--mn-color-info)', edge: 'var(--mn-color-info)', wash: 'var(--mn-color-info-surface)' },
  warning: { ink: 'var(--mn-color-warning)', edge: 'var(--mn-color-warning)', wash: 'var(--mn-color-warning-surface)' },
  danger: { ink: 'var(--mn-color-danger)', edge: 'var(--mn-color-danger)', wash: 'var(--mn-color-danger-surface)' },
}

/** Honest fragment non-content states — a visible message, never a blank pane. */
function renderFragmentStatus(
  target: HTMLElement,
  state: Extract<WorkspaceSurfaceFaceState, { readonly kind: 'fragment-status' }>,
): unknown {
  decorateSurfaceTarget(target, { role: 'center', regionId: state.regionId, surfacePart: 'center-route' })
  const { value } = state
  const vars = FRAGMENT_STATUS_TONE_VARS[FRAGMENT_STATUS_TONE[value.kind]]
  const containerStyle =
    `margin:var(--mn-space-4);padding:var(--mn-space-3) var(--mn-space-4);` +
    `font-family:var(--mn-font-sans);font-size:var(--mn-text-sm);color:var(--mn-color-text-secondary);` +
    `background:${vars.wash};border-left:3px solid ${vars.edge};border-radius:var(--mn-radius-default);`
  const headlineStyle =
    `margin:0 0 var(--mn-space-1) 0;color:${vars.ink};font-weight:var(--mn-font-weight-medium);`
  return html`<div
    data-layout-fragment-status=${value.kind}
    data-fragment-region=${state.regionId}
    role="status"
    style=${containerStyle}
  >
    <p style=${headlineStyle}>
      <span aria-hidden="true">${FRAGMENT_STATUS_GLYPH[value.kind]}</span> ${FRAGMENT_STATUS_HEADLINE[value.kind]}
    </p>
    ${value.surfaceIri
      ? html`<p style="margin:0 0 var(--mn-space-1) 0;color:var(--mn-color-text-muted);">
          surface: <code style="font-family:var(--mn-font-mono);">${value.surfaceIri}</code>
        </p>`
      : nothing}
    ${value.detail
      ? html`<p data-fragment-status-detail style="margin:0;color:var(--mn-color-text-muted);">${value.detail}</p>`
      : nothing}
  </div>`
}

let workspaceSurfaceDefined = false

/**
 * The named queries the workspace surface can resolve, injected by the APP
 * layer before the first render.
 *
 * WHY INJECTED RATHER THAN IMPORTED (2026-07-28). This module builds the
 * surface for ANY graph, so it cannot import a specific graph's catalogue —
 * the catalogues live in `apps/*`, and runtime importing an app inverts the
 * dependency. Until this seam existed the resolver was constructed around an
 * EMPTY sealed registry, which made the failure exactly as invisible as it
 * sounds: `rawTextPolicy: 'allow-raw'` means a layout whose queries carry
 * inline SPARQL keeps working, so nothing looked wrong, while a layout whose
 * queries are `urn:sophia:query:*` refs resolves NOTHING and every face on
 * every pane reports `resource-unavailable`. Observed live on canary against
 * the Observatory tabs surface, whose 19 queries are all refs.
 *
 * Left unset, the behaviour is unchanged from before this seam: an empty
 * sealed registry, raw text still allowed.
 */
let workspaceNamedQueryRegistry: NamedQueryRegistry | null = null

/**
 * Supply the named-query registry for the workspace surface. MUST be called
 * before the first render — the surface is defined once and its resolver
 * closes over the registry, so a later call would silently not apply. That is
 * why this throws rather than warning.
 */
export function setWorkspaceNamedQueryRegistry(registry: NamedQueryRegistry): void {
  if (workspaceSurfaceDefined) {
    throw new Error(
      'setWorkspaceNamedQueryRegistry: the workspace surface is already defined — ' +
        'the registry must be injected before the first render or it would have no effect',
    )
  }
  workspaceNamedQueryRegistry = registry
}

function ensureWorkspaceSurfaceDefined(): void {
  if (workspaceSurfaceDefined) return
  workspaceSurfaceDefined = true
  const clip = (minWidth: number, minHeight: number) => () => ({
    minWidth,
    minHeight,
    overflow: 'clip' as const,
  })
  const catalogue: WorkspaceBoundFaceDefinition[] = []
  let rawQueryCount = 0
  const fragmentQueryResolver = createQueryTextResolver({
    registry:
      workspaceNamedQueryRegistry ??
      (() => {
        const registry = new NamedQueryRegistry()
        registry.seal()
        return registry
      })(),
    rawTextPolicy: 'allow-raw',
    onRawText(locator) {
      rawQueryCount += 1
      document.body.dataset.observatoryRawQueries = String(rawQueryCount)
      console.warn(`workspace surface: raw query text resolved for ${locator.graphId}`)
    },
  })
  for (const tag of KNOWN_COMPONENTS) {
    catalogue.push({
      faceId: componentFaceId(tag),
      persistence: persistenceOf(tag),
      accepts: locator => acceptsComponentSurfaceResource(tag, locator),
      constraints: clip(
        tag === 'mn-sidebar-panel' ? 180 : tag === 'mn-document-editor' ? 240 : 120,
        80,
      ),
      render: (target, value) => renderWorkspaceSurfaceFace(target, value),
    })
  }
  const routeDefinitions: ReadonlyArray<{
    readonly faceId: string
    readonly persistence: WorkspaceBoundFaceDefinition['persistence']
    readonly minWidth: number
    readonly minHeight: number
    readonly accepts: (locator: ResourceLocator) => boolean
  }> = [
    {
      faceId: SURFACE_FACE.home, persistence: 'stamp', minWidth: 280, minHeight: 180,
      accepts: locator => acceptsSurfaceIri(locator, 'home:'),
    },
    {
      faceId: SURFACE_FACE.tagLens, persistence: 'stamp', minWidth: 280, minHeight: 180,
      accepts: locator => acceptsSurfaceIri(locator, 'tag:'),
    },
    {
      faceId: SURFACE_FACE.zoteroSource, persistence: 'stamp', minWidth: 320, minHeight: 180,
      accepts: locator => acceptsSurfaceIri(locator, 'zotero:'),
    },
    {
      faceId: SURFACE_FACE.artifact, persistence: 'stamp', minWidth: 280, minHeight: 180,
      accepts: locator => acceptsSurfaceIri(locator, 'artifact:'),
    },
    {
      faceId: SURFACE_FACE.dailyHome, persistence: 'stamp', minWidth: 280, minHeight: 160,
      accepts: locator => acceptsSurfaceIri(locator, 'daily:'),
    },
    {
      faceId: SURFACE_FACE.dailyHeader, persistence: 'stamp', minWidth: 180, minHeight: 32,
      accepts: locator => acceptsSurfaceIri(locator, 'daily-note-header'),
    },
    {
      faceId: SURFACE_FACE.paneHeader, persistence: 'stamp', minWidth: 180, minHeight: 32,
      accepts: locator => acceptsSurfaceIri(locator, 'center-pane:'),
    },
    {
      faceId: SURFACE_FACE.paneEditor, persistence: 'persistent-relocatable', minWidth: 240, minHeight: 128,
      accepts: locator => acceptsSurfaceIri(locator, 'center-pane:', 'center-empty'),
    },
    {
      faceId: SURFACE_FACE.editorAnchor, persistence: 'persistent-relocatable', minWidth: 240, minHeight: 128,
      accepts: locator => acceptsSurfaceIri(locator, 'editor-anchor:', 'center-empty-anchor'),
    },
    {
      // Honest fragment non-content states (missing/loading/error/invalid) —
      // a cheap stamped message, replaced by the spliced subtree when ready.
      faceId: SURFACE_FACE.fragmentStatus, persistence: 'stamp', minWidth: 240, minHeight: 120,
      accepts: locator => acceptsSurfaceIri(locator, 'fragment-status:'),
    },
    {
      // Records ABOUT a previous life. Stamped, never persistent: the
      // projection is rebuilt from IndexedDB on every pass, and no lease is
      // worth preserving (master §3 Slice 8).
      faceId: SURFACE_FACE.parkedWork, persistence: 'stamp', minWidth: 320, minHeight: 200,
      accepts: locator => acceptsSurfaceIri(locator, 'parked-work:'),
    },
  ]
  for (const definition of routeDefinitions) {
    catalogue.push({
      faceId: definition.faceId,
      persistence: definition.persistence,
      accepts: definition.accepts,
      constraints: clip(definition.minWidth, definition.minHeight),
      render: (target, value) => renderWorkspaceSurfaceFace(target, value),
    })
  }
  defineWorkspaceSurfaceElement(WORKSPACE_SURFACE_TAG, catalogue, {
    // Stage A of the Surface unification: the query-backed fragment faces
    // (stat.scalar, chart.vega-lite, card.subject, sparql.bindings-table,
    // sophia.home) — PLUS, from the MO object-face integration spec,
    // card.object — are ORDINARY citizens of this same sealed registry —
    // mounted by the same interpreter as every bound face, resolved through
    // the broker over the session's live engine services. The services
    // arrive per build (`WorkspaceSurfaceBuild.engineService`, the memoized
    // `SurfaceEngineServices` composite — §6.10 — supplied from
    // `opts.fragments.queryService`/`.objectService`); these two delegators
    // are the one seam between the closed catalogue and the changing session.
    faces: createFragmentFaceRegistrations(),
    createAdapters: (resolveService) => {
      const delegating: QueryBlockService = {
        run(graphId, sparql, maxRows) {
          const service = (resolveService() as SurfaceEngineServices | null)?.query ?? null
          if (!service) {
            return Promise.reject(new Error(
              'workspace surface: an engine face needs a query service, but the shell supplied no fragments.queryService for this session',
            ))
          }
          return service.run(graphId, sparql, maxRows)
        },
      }
      const delegatingObjects: SourceObjectService = {
        read(graphId, key) {
          const objects = (resolveService() as SurfaceEngineServices | null)?.objects ?? null
          if (!objects) {
            return Promise.reject(new Error(
              'workspace surface: card.object needs an object service, but the shell supplied no fragments.objectService for this session',
            ))
          }
          return objects.read(graphId, key)
        },
      }
      const delegatingEvidence: FilmstripEvidenceService = {
        read(graphId, runId, ref) {
          const evidence = (resolveService() as SurfaceEngineServices | null)?.evidence ?? null
          if (!evidence) {
            return Promise.reject(new Error(
              'workspace surface: obs.filmstrip needs an evidence service, but the shell supplied no fragments.evidenceService for this session',
            ))
          }
          return evidence.read(graphId, runId, ref)
        },
      }
      return createFragmentResourceAdapters(
        delegating,
        fragmentQueryResolver,
        delegatingObjects,
        delegatingEvidence,
      )
    },
    gridCollectionResourceAdapterId: FRAGMENT_GRID_COLLECTION_ADAPTER_ID,
  })
}

/**
 * The sealed VALIDATION registry for graph-authored fragment documents —
 * exactly the engine face set registered on the Surface element. Lazy
 * singleton: never mounts anything, only backs
 * `createValidatedLayoutDocument`/`applyOperation` predicates at splice and
 * ratio time.
 */
let fragmentValidationRegistryMemo: FaceRegistry | null = null
function fragmentValidationRegistry(): FaceRegistry {
  if (!fragmentValidationRegistryMemo) fragmentValidationRegistryMemo = createFragmentFaceRegistry()
  return fragmentValidationRegistryMemo
}

function basisPoints(fraction: number, fallback = 5000): number {
  if (!Number.isFinite(fraction)) return fallback
  return Math.min(9999, Math.max(1, Math.round(fraction * 10000)))
}

function graphIdForSurface(opts: RenderWorkspaceOptions): string | null {
  const paneGraph = opts.centerPanes?.projection.panes
    .map(pane => pane.current.graphId)
    .find((graphId): graphId is string => typeof graphId === 'string' && graphId.length > 0)
  if (paneGraph) return paneGraph
  if (opts.home?.graphId) return opts.home.graphId
  const state = opts.editorHost?.get()
  return state?.graphId ?? null
}

function componentResourceForSurface(
  tag: string,
  id: string,
  opts: RenderWorkspaceOptions,
  graphId: string | null,
): ResourceLocator {
  if (tag === 'mn-chat-panel' && graphId && opts.chatHost?.sessionId) {
    return { kind: 'chat', graphId, sessionId: opts.chatHost.sessionId }
  }
  if (tag === 'mn-graph-panel' && graphId) return { kind: 'graph', graphId }
  return surfaceResource(`${tag}:${id}`)
}

function assembleWorkspaceSurface(
  config: WorkspaceConfig,
  opts: RenderWorkspaceOptions,
  width: number,
  height: number,
): WorkspaceSurfaceAssembly {
  const plan = planFor(config, opts.app)
  const nodes: Record<string, LayoutNode> = {}
  const bindings = new Map<string, WorkspaceSurfaceFaceState>()
  const splits = new Map<string, WorkspaceSurfaceSplitMetadata>()
  const tabs = new Map<string, WorkspaceSurfaceTabsMetadata>()
  const graphId = graphIdForSurface(opts)
  const wirePanel = resolvedWirePanelForSurface(opts)

  const addLeaf = (
    id: string,
    faceId: string,
    resource: ResourceLocator,
    state: WorkspaceSurfaceFaceState,
  ): string => {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId,
      resource,
      params: { bindingId: id },
    }
    const leaf: LayoutLeafNode = { kind: 'leaf', id, descriptor, descriptorRevision: 0 }
    nodes[id] = leaf
    bindings.set(id, state)
    return id
  }

  /**
   * Same as `addLeaf`, minus the `bindings` entry and minus the
   * `params:{bindingId:id}` injection (master §3 Slice 5): for a REAL
   * `FaceRegistration` — one whose `mount()` resolves through the sealed
   * `FaceRegistry`/`ResourceBroker`, not this assembler's own
   * `WorkspaceSurfaceFaceState` switch — an injected `bindingId` would trip
   * that face's own CLOSED `paramsSchema` (`sparql.bindings-table`'s and
   * `card.object`'s both reject unknown keys), and no `WorkspaceSurfaceFaceState`
   * variant exists for either, so there is nothing to bind.
   */
  const addFaceLeaf = (
    id: string,
    faceId: string,
    resource: ResourceLocator,
    params: Record<string, unknown> | undefined,
  ): string => {
    const descriptor: ViewDescriptor = { schemaVersion: 1, faceId, resource, params }
    const leaf: LayoutLeafNode = { kind: 'leaf', id, descriptor, descriptorRevision: 0 }
    nodes[id] = leaf
    return id
  }

  const addSplit = (
    id: string,
    axis: LayoutSplitNode['axis'],
    startNodeId: string,
    endNodeId: string,
    startBasisPoints: number,
    metadata: WorkspaceSurfaceSplitMetadata,
  ): string => {
    nodes[id] = { kind: 'split', id, axis, startNodeId, endNodeId, startBasisPoints }
    splits.set(id, metadata)
    return id
  }

  const componentLeaf = (
    id: string,
    tag: string,
    role: RegionRole | 'rail',
    regionId: string,
    panelId?: PanelId,
    panelIndex?: number,
  ): string => addLeaf(
    id,
    componentFaceId(tag),
    componentResourceForSurface(tag, id, opts, graphId),
    { kind: 'component', tag, role, regionId, panelId, panelIndex, opts, wirePanel },
  )

  const wrapDailyHeader = (contentId: string): string => {
    if (!opts.dailyNotes?.activeDateKey) return contentId
    const headerId = 'workspace-daily-note-header'
    addLeaf(headerId, SURFACE_FACE.dailyHeader, surfaceResource('daily-note-header'), {
      kind: 'daily-header',
      value: opts.dailyNotes,
    })
    return addSplit(
      'workspace-daily-note-frame',
      'vertical',
      headerId,
      contentId,
      basisPoints(42 / Math.max(1, height)),
      { kind: 'fixed-chrome' },
    )
  }

  const centerPaneFrame = (pane: CenterPaneProjection, group: WorkspaceCenterPanesOptions): string => {
    const headerId = `${pane.id}:header`
    const contentId = pane.id
    // The pane slot, not its current document, is the persistent Class-B
    // identity. Document navigation updates the code-owned binding on the
    // same face so the exact <sh-editor-host> survives alpha → beta → back.
    const resource = surfaceResource(`center-pane:${pane.id}`)
    addLeaf(headerId, SURFACE_FACE.paneHeader, resource, { kind: 'pane-header', pane, group })
    addLeaf(contentId, SURFACE_FACE.paneEditor, resource, {
      kind: 'pane-editor',
      pane,
      group,
      editor: group.editorHosts.get(pane.id) ?? null,
    })
    return addSplit(
      `${pane.id}:frame`,
      'vertical',
      headerId,
      contentId,
      basisPoints(38 / Math.max(1, height)),
      { kind: 'fixed-chrome' },
    )
  }

  const fragmentStatusLeaf = (regionId: string, value: WorkspaceFragmentStatusValue): string =>
    addLeaf(
      `workspace-fragment-status:${regionId}`,
      SURFACE_FACE.fragmentStatus,
      surfaceResource(`fragment-status:${regionId}`),
      { kind: 'fragment-status', regionId, value },
    )

  /**
   * A region whose config marker declares a graph-authored fragment. When the
   * shell supplied a fragment entry for it, the fragment document is SPLICED
   * into this workspace document as the region's own subtree — same engine,
   * same interpreter, no nested mount. Non-content states (loading/error/
   * invalid/missing) degrade to an honest status leaf, never a blank pane.
   */
  const fragmentRegionNode = (regionId: string): string => {
    const region = opts.fragments?.regions?.[regionId]
    if (!region) {
      return fragmentStatusLeaf(regionId, { kind: 'missing', surfaceIri: null })
    }
    const state = region.state
    if (state.status === 'loading') {
      return fragmentStatusLeaf(regionId, { kind: 'loading', surfaceIri: region.surfaceIri })
    }
    if (state.status === 'error') {
      return fragmentStatusLeaf(regionId, { kind: 'error', surfaceIri: region.surfaceIri, detail: state.error })
    }
    const spliced = spliceFragmentDocument(state.doc, regionId, fragmentValidationRegistry())
    if (!spliced.ok) {
      return fragmentStatusLeaf(regionId, { kind: 'invalid', surfaceIri: region.surfaceIri, detail: spliced.reason })
    }
    for (const [nodeId, node] of Object.entries(spliced.nodes)) nodes[nodeId] = node
    for (const [splitId, fragmentSplitId] of spliced.splitIds) {
      splits.set(splitId, { kind: 'fragment', regionId, surfaceIri: region.surfaceIri, fragmentSplitId })
    }
    for (const [tabsId, fragmentTabsId] of spliced.tabsIds) {
      tabs.set(tabsId, { kind: 'fragment', regionId, surfaceIri: region.surfaceIri, fragmentTabsId })
    }
    return spliced.rootNodeId
  }

  const centerNode = (regionId: string): string => {
    // A config-declared fragment center OWNS the center pane. The CONFIG is
    // the authority for what the main pane IS, so this branch deliberately
    // precedes every route-level option (home/tagLens/…): a workspace whose
    // center region names LAYOUT_DASHBOARD_COMPONENT renders the graph-
    // authored fragment regardless of which route options the shell also
    // computed.
    if (resolveSurfaceTag(config, regionId) === LAYOUT_DASHBOARD_COMPONENT) {
      return fragmentRegionNode(regionId)
    }
    // Placement and content authority are independent graph facts. A region
    // may be the semantic center while still declaring that its admitted
    // component — not Garden's current home/document route — owns the leaf.
    // Resolve it before all shell route options, exactly as fragment centers
    // already do. An invalid/missing tag remains the validator's concern.
    if (configuredSurfaceOwnsRegion(config, regionId)) {
      const tag = resolveSurfaceTag(config, regionId)
      if (tag) return componentLeaf(`workspace-region:${regionId}`, tag, 'center', regionId)
    }
    // MO object-face integration spec, master §2.9, §3 Slice 5, WS2 §6.2 —
    // an explicit user navigation, so it deliberately precedes `opts.home`
    // (a graph whose contested route was opened must not silently render
    // Home instead). The split exists from the FIRST render, including
    // before anything is selected (D-W4): `objectLocator`'s `null`
    // objectKey mints the honest empty-selection `card.object` locator, and
    // `contestedCardParams(null)` returns `undefined`, satisfying the
    // card's closed params schema either way.
    //
    // master §2.9 (E13) — `opts.contested` and `opts.parkedWork` are BOTH
    // explicit user navigations occupying this same slot, and neither
    // section that specced them defines precedence on its own. Resolution:
    // they are mutually exclusive by shell invariant — the shell clears one
    // when it sets the other — and the assembler ASSERTS it rather than
    // silently choosing whichever branch happens to run first. A throw here
    // is not a doctrine violation: these are code-owned shell options, not
    // graph-authored data (LAY-012 governs descriptors, not this).
    if (opts.contested && opts.parkedWork) {
      throw new Error('renderWorkspace: contested and parkedWork are mutually exclusive centre routes')
    }
    // master §3 Slice 8, WS3 §5.2 — precedes `opts.contested`/`opts.home`
    // for the same reason contested precedes home: a graph whose parked-
    // work route was opened must not silently render something else.
    if (opts.parkedWork) {
      return addLeaf(
        'workspace-center-parked-work',
        SURFACE_FACE.parkedWork,
        surfaceResource(`parked-work:${opts.parkedWork.graphId}`),
        { kind: 'parked-work', value: opts.parkedWork },
      )
    }
    // MO object-face integration spec, master §2.9, §3 Slice 5, WS2 §6.2 —
    // an explicit user navigation, so it deliberately precedes `opts.home`
    // (a graph whose contested route was opened must not silently render
    // Home instead). The split exists from the FIRST render, including
    // before anything is selected (D-W4): `objectLocator`'s `null`
    // objectKey mints the honest empty-selection `card.object` locator, and
    // `contestedCardParams(null)` returns `undefined`, satisfying the
    // card's closed params schema either way.
    if (opts.contested) {
      const tableId = 'workspace-center-contested-table'
      const cardId = 'workspace-center-contested-object'
      addFaceLeaf(
        tableId,
        SPARQL_BINDINGS_TABLE_FACE_ID,
        { kind: 'query', graphId: opts.contested.graphId, queryId: opts.contested.queryId },
        { subjectField: 'item', maxRows: opts.contested.maxRows ?? 200 },
      )
      addFaceLeaf(
        cardId,
        CARD_OBJECT_FACE_ID,
        objectLocator(opts.contested.graphId, opts.contested.selection?.objectKey ?? null),
        // `CardObjectParams` is a closed, named interface — TS requires an
        // explicit widening (not a runtime transform) to pass it where a
        // generic params bag is expected; `card.object`'s own
        // `closedParamsSchema` is the real, runtime-enforced check.
        contestedCardParams(opts.contested.selection) as Readonly<Record<string, unknown>> | undefined,
      )
      return addSplit(
        'workspace-center-contested-split', 'horizontal', tableId, cardId,
        6000, { kind: 'fixed-chrome' },
      )
    }
    if (opts.home) {
      return addLeaf('workspace-center-home', SURFACE_FACE.home, surfaceResource(`home:${opts.home.graphId}`), {
        kind: 'home',
        home: opts.home,
        dailyNotes: opts.dailyNotes,
      })
    }
    if (opts.tagLens) {
      return addLeaf('workspace-center-tag-lens', SURFACE_FACE.tagLens, surfaceResource(`tag:${opts.tagLens.tagName}`), {
        kind: 'tag-lens', value: opts.tagLens,
      })
    }
    if (opts.zoteroSource) {
      return addLeaf('workspace-center-zotero', SURFACE_FACE.zoteroSource, surfaceResource(`zotero:${opts.zoteroSource.artifactId}`), {
        kind: 'zotero-source', value: opts.zoteroSource,
      })
    }
    if (opts.artifact) {
      return addLeaf('workspace-center-artifact', SURFACE_FACE.artifact, surfaceResource(`artifact:${opts.artifact.graphId}:${opts.artifact.artifactId}`), {
        kind: 'artifact', value: opts.artifact,
      })
    }
    if (opts.dailyNotes?.showHomeRow) {
      return addLeaf('workspace-center-daily-home', SURFACE_FACE.dailyHome, surfaceResource(`daily:${opts.dailyNotes.todayKey}`), {
        kind: 'daily-home', value: opts.dailyNotes,
      })
    }
    if (opts.centerPanes) {
      const panes = opts.centerPanes.projection.panes
      const primary = panes.find(pane => pane.position === 'primary') ?? panes[0]
      if (!primary) {
        return addLeaf('workspace-center-empty', SURFACE_FACE.paneEditor, surfaceResource('center-empty'), {
          kind: 'pane-editor',
          pane: {
            id: 'center-primary', position: 'primary', current: homeLocation(graphId), back: [], forward: [],
            active: true, title: 'Home', canGoBack: false, canGoForward: false,
            capabilities: { openDocument: false, navigate: false, close: false },
          },
          group: opts.centerPanes,
          editor: null,
        })
      }
      const primaryFrame = centerPaneFrame(primary, opts.centerPanes)
      const secondary = panes.find(pane => pane.position === 'secondary')
      const content = secondary
        ? addSplit(
            'center-root-split',
            'horizontal',
            primaryFrame,
            centerPaneFrame(secondary, opts.centerPanes),
            basisPoints(opts.centerPanes.projection.dividerPercent / 100),
            { kind: 'center-panes', group: opts.centerPanes },
          )
        : primaryFrame
      return wrapDailyHeader(content)
    }
    if (opts.editorHost) {
      const content = addLeaf('workspace-center-editor', SURFACE_FACE.editorAnchor, surfaceResource(`editor-anchor:${regionId}`), {
        kind: 'editor-anchor', regionId,
      })
      return wrapDailyHeader(content)
    }
    const tag = resolveSurfaceTag(config, regionId)
    return tag
      ? componentLeaf(`workspace-region:${regionId}`, tag, 'center', regionId)
      : addLeaf('workspace-center-empty', SURFACE_FACE.editorAnchor, surfaceResource('center-empty-anchor'), {
          kind: 'editor-anchor', regionId,
        })
  }

  const rightNode = (regionId: string): string => {
    const requested = opts.chrome ? rightPanelModeForChrome(opts.chrome) : null
    if (!requested) {
      const tag = resolveSurfaceTag(config, regionId)
      return tag
        ? componentLeaf(`workspace-region:${regionId}`, tag, 'right', regionId)
        : componentLeaf(`workspace-region:${regionId}`, 'mn-chat-panel', 'right', regionId)
    }
    if (requested === 'none') {
      return componentLeaf('workspace-right-empty', 'mn-empty-state', 'right', regionId)
    }
    const tag = resolvePanelTag(config, requested)
    if (tag === null || (opts.chrome?.leftPanelMode === 'graph' && tag === 'mn-graph-panel')) {
      return componentLeaf('workspace-right-empty', 'mn-empty-state', 'right', regionId)
    }
    // Keep one stable surface leaf across panel selection so the live chat host
    // can remain mounted in a hidden sibling while another panel is shown.
    return componentLeaf('workspace-panel:right', tag, 'right', regionId, requested, 0)
  }

  const regionNode = (regionId: string, role: RegionRole): string => {
    if (role === 'center') return centerNode(regionId)
    if (role === 'right') return rightNode(regionId)
    const tag = resolveSurfaceTag(config, regionId)
    return tag
      ? componentLeaf(`workspace-region:${regionId}`, tag, role, regionId)
      : componentLeaf(`workspace-region:${regionId}`, 'mn-card', role, regionId)
  }

  const entries: Array<{ readonly regionId: string; readonly role: RegionRole; readonly position: number }> = []
  let cursor: WorkspaceSpinePlan['spine'] | null = plan.spine
  while (cursor) {
    entries.push({
      regionId: cursor.regionId,
      role: engineRegionRole(config, cursor.regionId),
      position: cursor.kind === 'split' ? cursor.position : 50,
    })
    cursor = cursor.kind === 'split' ? cursor.child : null
  }
  const present = entries.filter(entry =>
    !(entry.role === 'sidebar' && opts.leftCollapsed) &&
    !(entry.role === 'right' && opts.rightCollapsed),
  )

  const composeSpine = (
    remaining: readonly (typeof present)[number][],
    availableWidth: number,
  ): string => {
    const head = remaining[0]
    const headNode = regionNode(head.regionId, head.role)
    if (remaining.length === 1) return headNode
    const panelLayout = opts.panelLayout
    let fraction = head.position / 100
    let metadata: WorkspaceSurfaceSplitMetadata = { kind: 'config' }
    if (head.role === 'sidebar' && panelLayout?.leftExpanded) {
      fraction = 0.7
      metadata = { kind: 'left-panel' }
    } else if (head.role === 'sidebar' && Number.isFinite(panelLayout?.leftWidth) && availableWidth > 0) {
      fraction = Number(panelLayout?.leftWidth) / availableWidth
      metadata = { kind: 'left-panel' }
    } else if (
      head.role === 'center' &&
      remaining.length === 2 &&
      remaining[1].role === 'right' &&
      Number.isFinite(panelLayout?.rightWidth) &&
      availableWidth > 0
    ) {
      fraction = 1 - Number(panelLayout?.rightWidth) / availableWidth
      metadata = { kind: 'right-panel' }
    }
    const clampedFraction = Math.min(0.99, Math.max(0.01, fraction))
    const endWidth = Math.max(1, availableWidth * (1 - clampedFraction))
    return addSplit(
      `workspace-spine:${head.regionId}`,
      'horizontal',
      headNode,
      composeSpine(remaining.slice(1), endWidth),
      basisPoints(clampedFraction),
      metadata,
    )
  }

  let rootNodeId = composeSpine(present, Math.max(1, width))
  const railIds = plan.topChrome.filter(id => id !== 'region-top-bar')
  for (let index = railIds.length - 1; index >= 0; index -= 1) {
    const regionId = railIds[index]
    const tag = resolveSurfaceTag(config, regionId)
    if (!tag) continue
    const rail = componentLeaf(`workspace-rail:${regionId}`, tag, 'rail', regionId)
    rootNodeId = addSplit(
      `workspace-rail-split:${regionId}`,
      'horizontal',
      rail,
      rootNodeId,
      basisPoints(56 / Math.max(1, width)),
      { kind: 'fixed-chrome' },
    )
  }

  const document: LayoutDocument = {
    schemaVersion: 1,
    layoutId: `workspace-surface:${opts.app ?? 'garden'}`,
    scope: 'session',
    graphId,
    rootNodeId,
    nodes,
    createdAt: SURFACE_EPOCH,
    updatedAt: SURFACE_EPOCH,
  }
  return { document, bindings, metadata: { splits, tabs, opts } }
}

function surfaceDividerPolicy(
  split: LayoutSplitNode,
  box: SurfaceRatioChange['splitBox'],
  metadata: WorkspaceSurfaceMetadata,
): SurfaceDividerPolicy {
  const kind = metadata.splits.get(split.id)
  if (!kind || kind.kind === 'fixed-chrome') return { enabled: false }
  if (kind.kind === 'fragment') {
    // A fragment split is an ORDINARY engine split: draggable within the
    // engine's own default bounds; its settle points persist to the
    // fragment's ux:layoutJson (see the model's fragment ratio handler).
    return { enabled: true, label: 'Resize layout fragment', minBasisPoints: 100, maxBasisPoints: 9900 }
  }
  if (kind.kind === 'center-panes') {
    return {
      enabled: kind.group.projection.capabilities.resize,
      label: 'Resize document panes',
      minBasisPoints: Math.round(kind.group.projection.dividerMinPercent * 100),
      maxBasisPoints: Math.round(kind.group.projection.dividerMaxPercent * 100),
    }
  }
  if (kind.kind === 'left-panel') {
    const size = Math.max(1, box.width)
    const min = 180
    const max = Math.max(min, Math.min(500, size - 400))
    return {
      enabled: true,
      label: 'Resize sidebar',
      minBasisPoints: basisPoints(min / size),
      maxBasisPoints: basisPoints(max / size),
    }
  }
  if (kind.kind === 'right-panel') {
    const size = Math.max(1, box.width)
    const min = 240
    const max = Math.max(min, Math.min(500, size - 400))
    return {
      enabled: true,
      label: 'Resize right panel',
      minBasisPoints: basisPoints(1 - max / size),
      maxBasisPoints: basisPoints(1 - min / size),
    }
  }
  return { enabled: true, minBasisPoints: 100, maxBasisPoints: 9900 }
}

function handleSurfaceRatioChange(
  change: SurfaceRatioChange,
  metadata: WorkspaceSurfaceMetadata,
): WorkspacePanelRepositionDetail | null {
  const kind = metadata.splits.get(change.split.id)
  if (!kind) return null
  if (kind.kind === 'center-panes') {
    kind.group.onResize?.({
      dividerPercent: change.operation.startBasisPoints / 100,
      source: change.source,
    })
    return null
  }
  const panelLayout = metadata.opts.panelLayout
  if (!panelLayout || (kind.kind !== 'left-panel' && kind.kind !== 'right-panel')) return null
  const size = change.splitBox.width
  const ratio = change.operation.startBasisPoints / 10000
  const role: WorkspacePanelSplitRole = kind.kind === 'left-panel' ? 'left' : 'right'
  const rawWidth = role === 'left' ? size * ratio : size * (1 - ratio)
  const width = role === 'left' && panelLayout.leftExpanded
    ? rawWidth
    : clampPanelWidth(role, rawWidth, size)
  change.splitBox.width > 0 && change.host.closest<HTMLElement>('.app-container')?.style.setProperty(
    role === 'left' ? '--mn-left-panel-width' : '--mn-right-panel-width',
    `${Math.round(width)}px`,
  )
  const detail: WorkspacePanelRepositionDetail = {
    role,
    width: Math.round(width),
    position: (width / Math.max(1, size)) * 100,
    size,
  }
  panelLayout.onReposition?.(detail)
  return detail
}

function workspaceSurfaceModel(
  config: WorkspaceConfig,
  opts: RenderWorkspaceOptions,
): WorkspaceSurfaceModel<WorkspaceSurfaceMetadata> {
  // A divider callback persists its canonical pixel width in the shell, but a
  // ResizeObserver can rebuild this same model before the shell performs a
  // fresh render. Mirror only those emitted widths locally so that interim
  // geometry rebuilds cannot snap back to the options snapshot captured when
  // this model was created. The caller-owned options remain immutable.
  let livePanelLayout = opts.panelLayout
  // Same mirroring discipline for fragment documents: an engine drag inside a
  // spliced fragment updates the FRAGMENT doc here (original node ids) so an
  // interim ResizeObserver rebuild re-splices the dragged geometry instead of
  // snapping back to the options snapshot. The shell hears every change via
  // onFragmentChange and holds its own durable copy for the NEXT render.
  let liveFragments = opts.fragments
  let projectedOptions = opts
  const liveOptions = (): RenderWorkspaceOptions => {
    if (projectedOptions.panelLayout === livePanelLayout && projectedOptions.fragments === liveFragments) {
      return projectedOptions
    }
    projectedOptions = { ...opts, panelLayout: livePanelLayout, fragments: liveFragments }
    return projectedOptions
  }
  /**
   * PERSIST-SCOPE ISOLATION (the Stage C invariant): a ratio change on a
   * fragment split is applied — with the ORIGINAL fragment split id — to the
   * fragment's OWN document through `applyOperation`'s full invariants, and
   * ONLY that fragment document is handed to the shell for persistence. Spine
   * nodes can never enter it (it never contained any); fragment nodes never
   * reach the panel-layout path below (this branch returns first).
   */
  const applyFragmentRatio = (
    change: SurfaceRatioChange,
    meta: Extract<WorkspaceSurfaceSplitMetadata, { readonly kind: 'fragment' }>,
  ): void => {
    const entry = liveFragments?.regions?.[meta.regionId]
    if (!liveFragments || !entry || entry.state.status !== 'ready') return
    const registry = fragmentValidationRegistry()
    const outcome = applyOperation(
      entry.state.doc,
      { op: 'set_ratio', splitId: meta.fragmentSplitId, startBasisPoints: change.operation.startBasisPoints },
      {
        isFaceRegistered: registry.toFaceRegistrationPredicate(),
        isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
      },
    )
    if (!outcome.ok) return
    const nextEntry: WorkspaceFragmentRegion = { ...entry, state: { status: 'ready', doc: outcome.doc } }
    liveFragments = {
      ...liveFragments,
      regions: { ...liveFragments.regions, [meta.regionId]: nextEntry },
    }
    liveFragments.onFragmentChange?.({
      regionId: meta.regionId,
      surfaceIri: meta.surfaceIri,
      doc: outcome.doc,
      phase: change.phase,
      source: change.source,
    })
  }
  /**
   * Tab activation is a settle point, so mirror it into the fragment's OWN
   * document immediately. The Surface controller operates on namespaced ids;
   * persistence must receive the original tabs/child ids and no spine nodes.
   */
  const applyFragmentActiveTab = (
    change: SurfaceActiveTabChange,
    meta: WorkspaceSurfaceTabsMetadata,
  ): void => {
    const entry = liveFragments?.regions?.[meta.regionId]
    if (!liveFragments || !entry || entry.state.status !== 'ready') return
    const originalTabs = entry.state.doc.nodes[meta.fragmentTabsId]
    if (!originalTabs || originalTabs.kind !== 'tabs') return
    const originalActiveNodeId = originalTabs.tabs.find(
      (tab) => fragmentNodeId(meta.regionId, tab.nodeId) === change.operation.activeNodeId,
    )?.nodeId
    if (!originalActiveNodeId) return
    const registry = fragmentValidationRegistry()
    const outcome = applyOperation(
      entry.state.doc,
      {
        op: 'tabs_set_active',
        tabsId: meta.fragmentTabsId,
        activeNodeId: originalActiveNodeId,
        expectedTabsRevision: originalTabs.tabsRevision,
      },
      {
        isFaceRegistered: registry.toFaceRegistrationPredicate(),
        isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
      },
    )
    if (!outcome.ok) return
    const nextEntry: WorkspaceFragmentRegion = { ...entry, state: { status: 'ready', doc: outcome.doc } }
    liveFragments = {
      ...liveFragments,
      regions: { ...liveFragments.regions, [meta.regionId]: nextEntry },
    }
    liveFragments.onFragmentChange?.({
      regionId: meta.regionId,
      surfaceIri: meta.surfaceIri,
      doc: outcome.doc,
      phase: 'commit',
      source: change.source,
    })
  }
  // Face bindings contain only config/options state; width and height affect
  // the LayoutDocument's split ratios and metadata, not those values. Reuse
  // the exact map while this model's projected options are unchanged so the
  // generic Surface host can reconcile new geometry without repainting every
  // live face (notably a focused contenteditable editor).
  let bindingOptions: RenderWorkspaceOptions | null = null
  let stableBindings: ReadonlyMap<string, WorkspaceSurfaceFaceState> | null = null
  const persistNestedRightWidth = (
    change: SurfaceRatioChange,
    metadata: WorkspaceSurfaceMetadata,
  ): void => {
    if (change.phase !== 'commit' || !livePanelLayout) return
    // The right panel split is nested under the left split. Moving the left
    // divider changes that descendant's physical width even though its own
    // ratio is untouched. Shoelace used to emit a second reposition event in
    // this case; Surface must do the equivalent or an expand/collapse rebuild
    // restores the stale pre-drag right width.
    const rightSplitId = Array.from(metadata.splits.entries())
      .find(([, split]) => split.kind === 'right-panel')?.[0]
    if (!rightSplitId) return
    queueMicrotask(() => {
      void (async () => {
        const surface = change.host as WorkspaceSurfaceElement
        await surface.whenReady?.()
        const rightLeaf = surface.querySelector<HTMLElement>(
          '[data-layout-node-kind="leaf"][data-role="right"]',
        )
        const rightSplit = surface.querySelector<HTMLElement>(
          `[data-layout-node-kind="split"][data-layout-node-id="${CSS.escape(rightSplitId)}"]`,
        )
        if (!rightLeaf || !rightSplit || !livePanelLayout) return
        const width = rightLeaf.getBoundingClientRect().width || Number.parseFloat(rightLeaf.style.width)
        const size = rightSplit.getBoundingClientRect().width || Number.parseFloat(rightSplit.style.width)
        if (!(width > 0) || !(size > 0)) return
        const detail: WorkspacePanelRepositionDetail = {
          role: 'right',
          width: Math.round(width),
          position: (width / size) * 100,
          size,
        }
        livePanelLayout = { ...livePanelLayout, rightWidth: detail.width }
        livePanelLayout.onReposition?.(detail)
      })()
    })
  }
  return {
    build(width, height): WorkspaceSurfaceBuild<WorkspaceSurfaceMetadata> {
      const currentOptions = liveOptions()
      const raw = assembleWorkspaceSurface(config, currentOptions, width, height)
      // MO object-face integration spec, master §2.8: an ordinary contested
      // route carries no `fragments` (that seam is Observatory-only,
      // `workspace-fragments.ts:115-133`), so its OWN `queryService`/
      // `objectService` must win first — the contested table's and card's
      // engine seam is the SAME merged composite `fragments` uses.
      const engineService = engineServicesFor(
        currentOptions.contested?.queryService ?? currentOptions.fragments?.queryService ?? null,
        currentOptions.contested?.objectService ?? currentOptions.fragments?.objectService ?? null,
        currentOptions.fragments?.evidenceService ?? null,
      )
      const built = { ...raw, engineService }
      if (bindingOptions === currentOptions && stableBindings) {
        return { ...built, bindings: stableBindings }
      }
      bindingOptions = currentOptions
      stableBindings = built.bindings
      return built
    },
    dividerPolicy: surfaceDividerPolicy,
    onRatioChange(change, metadata) {
      const splitMeta = metadata.splits.get(change.split.id)
      if (splitMeta?.kind === 'fragment') {
        applyFragmentRatio(change, splitMeta)
        return
      }
      const detail = handleSurfaceRatioChange(change, metadata)
      if (!detail || !livePanelLayout) return
      if (detail.role === 'left') {
        // Expanded mode is a discrete 70% projection; its drag callback is not
        // persisted by Garden and must not replace the remembered normal width.
        if (!livePanelLayout.leftExpanded) {
          livePanelLayout = { ...livePanelLayout, leftWidth: detail.width }
        }
        persistNestedRightWidth(change, metadata)
      } else {
        livePanelLayout = { ...livePanelLayout, rightWidth: detail.width }
      }
    },
    onActiveTabChange(change, metadata) {
      const tabsMeta = metadata.tabs.get(change.tabs.id)
      if (tabsMeta?.kind === 'fragment') applyFragmentActiveTab(change, tabsMeta)
    },
  }
}

/** Per-REGION `ux:vegaTheme` overrides of this pass's fragment regions (`WorkspaceFragmentRegion.vegaTheme`), or null when none carries one. */
function fragmentVegaThemesOf(
  fragments: WorkspaceFragmentsOptions | null | undefined,
): ReadonlyMap<string, Record<string, unknown>> | null {
  const regions = fragments?.regions
  if (!regions) return null
  const themes = new Map<string, Record<string, unknown>>()
  for (const [regionId, region] of Object.entries(regions)) {
    if (region.vegaTheme) themes.set(regionId, region.vegaTheme)
  }
  return themes.size > 0 ? themes : null
}

function renderWorkspaceSurfaceFrame(
  config: WorkspaceConfig,
  opts: RenderWorkspaceOptions,
): TemplateResult {
  ensureWorkspaceSurfaceDefined()
  const app = opts.app
  const leftCollapsed = opts.leftCollapsed ?? false
  const rightCollapsed = opts.rightCollapsed ?? false
  const chrome = opts.chrome ?? {}
  const plan = planFor(config, app)
  const appTabs = deriveAppTabs(config)
  const topBarTag = resolveSurfaceTag(config, 'region-top-bar')
  const bottomBarTag = resolveSurfaceTag(config, 'region-bottom-bar')
  const hasTopBar = plan.topChrome.includes('region-top-bar') && topBarTag !== null
  const hasBottomBar = plan.bottomChrome.includes('region-bottom-bar') && bottomBarTag !== null

  const model = workspaceSurfaceModel(config, opts)
  // The per-REGION graph-authored chart themes for THIS render pass — always
  // re-registered on the surface root (empty map clears), so a session reset
  // or a dropped region clears its theme with the pass that dropped it, and
  // one surface's themes can never reach another surface's charts.
  const fragmentVegaThemes = fragmentVegaThemesOf(opts.fragments)
  const hostSlot = opts.centerPanes == null && opts.home == null && opts.tagLens == null &&
    opts.zoteroSource == null && opts.artifact == null && opts.parkedWork == null
    ? mountEditorHost(opts.editorHost, opts.editorKernelOptions, {
        initialZoomBlockId: opts.editorInitialZoomBlockId ?? null,
        focusRequest: opts.editorBlockFocusRequest ?? null,
        wireBundle: opts.editorWireBundle ?? null,
        wireRadialContexts: opts.editorWireRadialContexts ?? null,
        salienceBundle: opts.editorSalienceBundle ?? null,
        imageInserter: opts.editorImageInserter ?? null,
        documentAccess: opts.editorDocumentAccess ?? null,
        ttsStatus: opts.tts?.status ?? 'idle',
        ttsAvailable: opts.tts?.available ?? false,
      })
    : nothing
  const graphHostSlot = mountGraphHost(opts.graphPanel)
  const pinnedLayer = (opts.wirePinnedNodes && opts.wirePinnedNodes.length > 0) ||
    (opts.wirePinnedDocs && opts.wirePinnedDocs.length > 0) ||
    (opts.wirePinnedBlocks && opts.wirePinnedBlocks.length > 0)
    ? mountWirePinnedLayer({
        nodes: opts.wirePinnedNodes,
        docs: opts.wirePinnedDocs,
        blocks: opts.wirePinnedBlocks,
        blockContexts: opts.wirePinnedBlockContexts,
        nodeContexts: opts.wirePinnedNodeContexts,
      })
    : nothing
  const ttsPlayer = opts.tts
    ? html`<mn-tts-player
        .status=${opts.tts.status}
        .currentBlockIndex=${opts.tts.currentBlockIndex}
        .totalBlocks=${opts.tts.totalBlocks}
        .currentBlockText=${opts.tts.currentBlockText}
        .tier=${opts.tts.tier}
        .speed=${opts.tts.speed}
        .speeds=${opts.tts.speeds ?? [0.75, 1, 1.25, 1.5, 2]}
        .tiers=${opts.tts.tiers ?? [{ value: 'local', label: 'Browser voice' }]}
        @mn-tts-action=${(event: Event) => opts.tts?.onAction?.(customDetail<WorkspaceTtsActionDetail>(event))}
      ></mn-tts-player>`
    : nothing
  const leftCollapseRail = leftCollapsed && opts.panelLayout?.onLeftCollapsedChange
    ? html`<button
        type="button"
        class="collapse-rail"
        data-panel-restore="left"
        aria-label="Expand sidebar"
        aria-expanded="false"
        @click=${() => opts.panelLayout?.onLeftCollapsedChange?.(false)}
      ><span aria-hidden="true">»</span></button>`
    : nothing
  const rightCollapseRail = rightCollapsed && opts.panelLayout?.onRightCollapsedChange
    ? html`<button
        type="button"
        class="collapse-rail right-rail"
        data-panel-restore="right"
        aria-label="Open right panel"
        aria-expanded="false"
        @click=${() => opts.panelLayout?.onRightCollapsedChange?.(false)}
      ><span aria-hidden="true">«</span></button>`
    : nothing

  return html`
    <div
      class="app-container"
      data-workspace-renderer="surface"
      @mn-editor-tts-toggle=${(event: Event) =>
        opts.tts?.onToolbarToggle?.(customDetail<WorkspaceTtsToolbarDetail>(event))}
    >
      ${hasTopBar
        ? html`<header role="banner" data-region="region-top-bar">${renderChromeSurface(topBarTag!, {
            activeApp: app ?? 'garden',
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</header>`
        : nothing}
      <div class="main" data-surface-main>
        ${leftCollapseRail}
        <sh-workspace-surface
          ${ref((el) => { if (el) setVegaThemeScopeOverrides(el, fragmentVegaThemes) })}
          .model=${model}
          @sh-row-activate=${(event: Event) =>
            opts.contested?.onSelect?.(customDetail<SubjectRowActivateDetail>(event))}
        ></sh-workspace-surface>
        ${rightCollapseRail}
        ${hostSlot}
        ${graphHostSlot}
      </div>
      ${hasBottomBar
        ? html`<footer role="contentinfo" data-region="region-bottom-bar">${renderChromeSurface(bottomBarTag!, {
            activeApp: app ?? 'garden',
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</footer>`
        : nothing}
      ${pinnedLayer}
      ${renderDailyNotePopover(opts.dailyNotes)}
      ${renderDocHistoryOverlay(opts.docHistory)}
      ${ttsPlayer}
    </div>
  `
}

/**
 * Slice 10 — the confess-absence frame (06-observatory-app-dimension-defect.md
 * D2b). Renders when `renderWorkspaceTemplate` was asked for an `app` the
 * active config does not declare. Chrome (top/bottom bar) uses the DEFAULT
 * app's plan ONLY to find where the bars belong — `planFor(config)` with no
 * app never depends on the requested one and is always declared (every
 * config has at least the default app, `deriveAppTabs`), so the switcher
 * stays real and usable and the user is never stranded with dead chrome. The
 * center is an honest `mn-empty-state` naming the missing app — never the
 * default spine (no sidebar, no editor, no panels): that silent substitution
 * is exactly the bug this frame exists to not repeat.
 */
function renderAppAbsentFrame(
  config: WorkspaceConfig,
  app: AppId,
  chrome: NonNullable<RenderWorkspaceOptions['chrome']>,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
): TemplateResult {
  const plan = planFor(config) // default spine's chrome ONLY — never the requested (undeclared) app
  const appTabs = deriveAppTabs(config)
  const topBarTag = resolveSurfaceTag(config, 'region-top-bar')
  const bottomBarTag = resolveSurfaceTag(config, 'region-bottom-bar')
  const hasTopBar = plan.topChrome.includes('region-top-bar') && topBarTag !== null
  const hasBottomBar = plan.bottomChrome.includes('region-bottom-bar') && bottomBarTag !== null
  return html`
    <div class="app-container" data-workspace-renderer="app-absent" data-missing-app=${app}>
      ${hasTopBar
        ? html`<header role="banner" data-region="region-top-bar">${renderChromeSurface(topBarTag!, {
            activeApp: app,
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</header>`
        : nothing}
      <div class="main" data-surface-main>
        <mn-empty-state
          icon="layers"
          title="No “${app}” surface here"
          description="This workspace declares no “${app}” app — nothing was substituted for it. Use the switcher above to reach one it does declare."
        ></mn-empty-state>
      </div>
      ${hasBottomBar
        ? html`<footer role="contentinfo" data-region="region-bottom-bar">${renderChromeSurface(bottomBarTag!, {
            activeApp: app,
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</footer>`
        : nothing}
    </div>
  `
}

/**
 * Compute the WorkspaceSpinePlan + render the full workspace frame as a Lit template.
 *
 * This is the headline host function: WorkspaceConfig → planFor → Lit template.
 * Mirrors app-shell.ts render()'s flag-on `.app-container` composition (~4075):
 * top chrome (gated on plan.topChrome), `.main` spine split-tree, bottom chrome
 * (gated on plan.bottomChrome). Chrome surfaces are resolved BY CONFIG via
 * `resolveSurfaceTag` and stamped INERT.
 *
 * Pure: config + opts in, TemplateResult out. No DOM side-effects, no stores.
 * Use `renderWorkspace` to render into a container.
 */
export function renderWorkspaceTemplate(
  config: WorkspaceConfig,
  opts: RenderWorkspaceOptions = {},
): TemplateResult {
  const {
    surface = false,
    app,
    leftCollapsed = false,
    rightCollapsed = false,
    panelLayout = null,
    editorHost,
    centerPanes = null,
    editorKernelOptions,
    editorInitialZoomBlockId,
    editorBlockFocusRequest,
    editorWireBundle,
    editorWireRadialContexts,
    editorSalienceBundle,
    editorImageInserter,
    editorDocumentAccess,
    tts = null,
    docHistory,
    wirePanel,
    wirePanelContexts,
    wirePanelLocalContext,
    wirePinnedDocs,
    wirePinnedNodes,
    wirePinnedBlocks,
    wirePinnedBlockContexts,
    wirePinnedNodeContexts,
    chatHost,
    chrome = {},
    sidebar,
    dailyNotes,
    home = null,
    tagLens = null,
    zoteroSource = null,
    artifact = null,
    parkedWork = null,
    graphPanel = null,
    outlinePanel = null,
    vtuberControls = null,
    comments = null,
    inspector = null,
  } = opts

  // Slice 10 — confess-absence (06-observatory-app-dimension-defect.md D2b).
  // An `app` the ACTIVE config does not declare (a stale shell app-select
  // value, a hand-typed URL/app query, a config that lost a branch a caller
  // still names) must never silently render the default spine.
  // `resolveRootRegions`/`planFor`'s own fallback is EXACTLY that silent
  // substitution — deliberately pinned elsewhere (WP2.1's own regression
  // tests) for callers that WANT tolerance — so this guard runs BEFORE
  // `planFor` is ever called with the requested app, and takes an entirely
  // different path rather than reaching for that fallback.
  if (app !== undefined && !isAppDeclared(config, app)) {
    return renderAppAbsentFrame(config, app, chrome, leftCollapsed, rightCollapsed)
  }

  const plan = planFor(config, app)
  const appTabs = deriveAppTabs(config)
  // Lift the center to a live Class-B host ONLY when a binding is provided.
  const liftCenter = (centerPanes != null || editorHost != null) &&
    home == null && tagLens == null && zoteroSource == null && artifact == null && parkedWork == null

  // Chrome surface tags resolved from config (existence / position / tag → config).
  const topBarTag = resolveSurfaceTag(config, 'region-top-bar')
  const bottomBarTag = resolveSurfaceTag(config, 'region-bottom-bar')
  const hasTopBar = plan.topChrome.includes('region-top-bar') && topBarTag !== null
  const hasBottomBar = plan.bottomChrome.includes('region-bottom-bar') && bottomBarTag !== null

  if (surface) {
    return renderWorkspaceSurfaceFrame(config, {
      ...opts,
      surface: true,
      app,
      leftCollapsed,
      rightCollapsed,
      panelLayout: panelLayout ?? undefined,
      centerPanes,
      chrome,
    })
  }

  // ── Left-rail chrome (additive) ────────────────────────────────────────────
  // A NON-resizable chrome root that is NOT the top bar but sits in topChrome (its
  // order is below the spine head) is a vertical RAIL: render it as a sibling pane
  // INSIDE `.main`, to the LEFT of the spine split-tree. This keeps the spine head
  // the single resizable root (I1) while still surfacing a fixed-width left rail.
  // GardenDefault is BYTE-IDENTICAL through this branch: its only topChrome root is
  // region-top-bar (its left rail is a resizable SPINE member, never chrome), so
  // `railIds` is empty and nothing changes.
  const railIds = plan.topChrome.filter((id) => id !== 'region-top-bar')
  const rails = railIds
    .map((id) => ({ id, tag: resolveSurfaceTag(config, id) }))
    .filter((r): r is { id: string; tag: string } => r.tag !== null)

  const rightPanel = rightPanelModeForChrome(chrome)
  const resolvedWirePanel: WiresPanelMountOptions = {
    wireContexts: wirePanelContexts ?? null,
    localGraphId: wirePanelLocalContext?.graphId ?? null,
    localDocumentId: wirePanelLocalContext?.documentId ?? null,
    localDocumentTitle: wirePanelLocalContext?.title ?? null,
    ...(wirePanel ?? {}),
  }
  const spine = renderSpine(
    config,
    plan,
    leftCollapsed,
    rightCollapsed,
    liftCenter,
    centerPanes,
    chatHost,
    sidebar,
    chrome.leftPanelMode ?? 'files',
    dailyNotes,
    home,
    editorWireBundle,
    resolvedWirePanel,
    rightPanel,
    tagLens,
    zoteroSource,
    artifact,
    graphPanel,
    outlinePanel,
    vtuberControls,
    comments,
    inspector,
    panelLayout,
    parkedWork,
  )

  // `.main` body: with NO rails it is the bare spine (GardenDefault path —
  // byte-identical). With rails it is each rail pane FOLLOWED by the spine wrapped
  // in `.spine-pane`. Each piece is its OWN element child of `.main` (never a
  // trailing bare nested-template binding — the happy-dom child-binding gotcha),
  // so we build an ARRAY of TemplateResults rather than a nested fragment template.
  const mainBody: Array<TemplateResult | typeof nothing> =
    rails.length === 0
      ? [spine]
      : [
          ...rails.map(
            (r) =>
              html`<div class="rail-pane" data-region=${r.id} data-role="rail">${stampPanelBody(r.tag)}</div>`,
          ),
          html`<div class="spine-pane">${spine}</div>`,
        ]

  // ── The live Class-B editor host ────────────────────────────────────────────
  // Placed at a FIXED, STABLE template-slot position inside `.main` — the LAST
  // binding, AFTER the variable-length `mainBody`. This is load-bearing for
  // mount-once: the keyed() ChildPart inside mountEditorHost reuses the SAME DOM
  // node ONLY while it sits at a stable position. If it were a trailing element
  // of the variable-length `mainBody` array, a rails 0→1 change would shift its
  // array index and LOSE node identity. As its own final ${} binding it survives
  // ANY mainBody-length change. `mountEditorHost` returns `nothing` when no
  // editorHost is provided, so the absent-binding path is byte-identical to today.
  const hostSlot = centerPanes == null &&
    home == null && tagLens == null && zoteroSource == null && artifact == null && parkedWork == null
    ? mountEditorHost(editorHost, editorKernelOptions, {
        initialZoomBlockId: editorInitialZoomBlockId ?? null,
        focusRequest: editorBlockFocusRequest ?? null,
        wireBundle: editorWireBundle ?? null,
        wireRadialContexts: editorWireRadialContexts ?? null,
        salienceBundle: editorSalienceBundle ?? null,
        imageInserter: editorImageInserter ?? null,
        documentAccess: editorDocumentAccess ?? null,
        ttsStatus: tts?.status ?? 'idle',
        ttsAvailable: tts?.available ?? false,
      })
    : nothing
  // Class C: the graph's WebGL node lives at one stable final slot and follows
  // the right-panel anchor by measurement. It is never stamped/re-parented by
  // the selected right-panel anchor, so camera/context state survives panel movement.
  const graphHostSlot = mountGraphHost(graphPanel)
  const pinnedLayer = (wirePinnedNodes && wirePinnedNodes.length > 0) ||
    (wirePinnedDocs && wirePinnedDocs.length > 0) ||
    (wirePinnedBlocks && wirePinnedBlocks.length > 0)
    ? mountWirePinnedLayer({
        nodes: wirePinnedNodes,
        docs: wirePinnedDocs,
        blocks: wirePinnedBlocks,
        blockContexts: wirePinnedBlockContexts,
        nodeContexts: wirePinnedNodeContexts,
      })
    : nothing
  const dailyNotePopover = renderDailyNotePopover(dailyNotes)
  const docHistoryOverlay = renderDocHistoryOverlay(docHistory)
  const ttsPlayer = tts
    ? html`<mn-tts-player
        .status=${tts.status}
        .currentBlockIndex=${tts.currentBlockIndex}
        .totalBlocks=${tts.totalBlocks}
        .currentBlockText=${tts.currentBlockText}
        .tier=${tts.tier}
        .speed=${tts.speed}
        .speeds=${tts.speeds ?? [0.75, 1, 1.25, 1.5, 2]}
        .tiers=${tts.tiers ?? [{ value: 'local', label: 'Browser voice' }]}
        @mn-tts-action=${(event: Event) => tts.onAction?.(customDetail<WorkspaceTtsActionDetail>(event))}
      ></mn-tts-player>`
    : nothing
  const leftCollapseRail = leftCollapsed && panelLayout?.onLeftCollapsedChange
    ? html`<button
        type="button"
        class="collapse-rail"
        data-panel-restore="left"
        aria-label="Expand sidebar"
        aria-expanded="false"
        @click=${() => panelLayout.onLeftCollapsedChange?.(false)}
      ><span aria-hidden="true">»</span></button>`
    : nothing
  const rightCollapseRail = rightCollapsed && panelLayout?.onRightCollapsedChange
    ? html`<button
        type="button"
        class="collapse-rail right-rail"
        data-panel-restore="right"
        aria-label="Open right panel"
        aria-expanded="false"
        @click=${() => panelLayout.onRightCollapsedChange?.(false)}
      ><span aria-hidden="true">«</span></button>`
    : nothing

  return html`
    <div
      class="app-container"
      @mn-editor-tts-toggle=${(event: Event) =>
        tts?.onToolbarToggle?.(customDetail<WorkspaceTtsToolbarDetail>(event))}
    >
      ${hasTopBar
        ? html`<header role="banner" data-region="region-top-bar">${renderChromeSurface(topBarTag!, {
            activeApp: app ?? 'garden',
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</header>`
        : nothing}
      <div class="main">${leftCollapseRail}${mainBody}${rightCollapseRail}${hostSlot}${graphHostSlot}</div>
      ${hasBottomBar
        ? html`<footer role="contentinfo" data-region="region-bottom-bar">${renderChromeSurface(bottomBarTag!, {
            activeApp: app ?? 'garden',
            apps: appTabs,
            leftCollapsed,
            rightCollapsed,
            chrome,
          })}</footer>`
        : nothing}
      ${pinnedLayer}
      ${dailyNotePopover}
      ${docHistoryOverlay}
      ${ttsPlayer}
    </div>
  `
}

function synchronizePanelWidths(
  container: HTMLElement,
  opts: Pick<RenderWorkspaceOptions, 'leftCollapsed' | 'rightCollapsed' | 'panelLayout'>,
): boolean {
  const panelLayout = opts.panelLayout
  if (!panelLayout) return true
  const appContainer = container.querySelector<HTMLElement>('.app-container')
  if (appContainer?.dataset.workspaceRenderer === 'surface') {
    const mainWidth = container.querySelector<HTMLElement>('.main')?.getBoundingClientRect().width ?? 0
    const leftWidth = panelLayout.leftExpanded && mainWidth > 0
      ? mainWidth * 0.7
      : panelLayout.leftWidth
    if (opts.leftCollapsed) appContainer.style.setProperty('--mn-left-panel-width', '0px')
    else if (Number.isFinite(leftWidth)) appContainer.style.setProperty('--mn-left-panel-width', `${Math.round(Number(leftWidth))}px`)
    if (opts.rightCollapsed) appContainer.style.setProperty('--mn-right-panel-width', '0px')
    else if (Number.isFinite(panelLayout.rightWidth)) appContainer.style.setProperty('--mn-right-panel-width', `${Math.round(Number(panelLayout.rightWidth))}px`)
    return true
  }
  let complete = true
  const widths: Partial<Record<WorkspacePanelSplitRole, number>> = {}
  for (const role of ['left', 'right'] as const) {
    const panel = container.querySelector<SplitPanelElement>(`sl-split-panel[data-split-role="${role}"]`)
    if (!panel) continue
    const size = splitPanelSize(panel)
    if (!(size > 0)) {
      complete = false
      continue
    }
    const requested = role === 'left'
      ? panelLayout.leftExpanded
        ? size * 0.7
        : panelLayout.leftWidth
      : panelLayout.rightWidth
    // A shell may control just one divider. In that case the other bottom-bar
    // track still has to follow the split plan's live position; writing 0px
    // makes its visible controls overflow under the center grid cell.
    const positionWidth = (finitePosition(panel.position, role === 'left' ? 20 : 25) / 100) * size
    const width = Number.isFinite(requested)
      ? role === 'left' && panelLayout.leftExpanded
        ? Number(requested)
        : clampPanelWidth(role, Number(requested), size)
      : clampPanelWidth(role, positionWidth, size)
    widths[role] = width
    const position = (width / size) * 100
    if (Number.isFinite(requested) && Math.abs(finitePosition(panel.position, -1) - position) > 0.1) {
      panel.position = position
    }
  }
  if (opts.leftCollapsed) {
    appContainer?.style.setProperty('--mn-left-panel-width', '0px')
  } else if (widths.left != null) {
    appContainer?.style.setProperty('--mn-left-panel-width', `${Math.round(widths.left)}px`)
  } else {
    appContainer?.style.removeProperty('--mn-left-panel-width')
  }
  if (opts.rightCollapsed) {
    appContainer?.style.setProperty('--mn-right-panel-width', '0px')
  } else if (widths.right != null) {
    appContainer?.style.setProperty('--mn-right-panel-width', `${Math.round(widths.right)}px`)
  } else {
    appContainer?.style.removeProperty('--mn-right-panel-width')
  }
  return complete
}

/**
 * Render a WorkspaceConfig into a DOM container (or a fresh detached <div>).
 *
 * Computes the plan via nucleus `planFor` and renders the Lit frame into
 * `opts.container`, returning the container. When no container is given a fresh
 * detached `<div>` is created — convenient for tests and for a shell that wants
 * to mount the result itself.
 *
 * This is the imperative twin of `renderWorkspaceTemplate`: same template, but
 * it actually drives Lit's `render()` into a real container.
 */
export function renderWorkspace(
  config: WorkspaceConfig,
  opts: RenderWorkspaceOptions & { container?: HTMLElement } = {},
): HTMLElement {
  const { container: given, ...rest } = opts
  const container = given ?? document.createElement('div')
  render(renderWorkspaceTemplate(config, rest), container)
  if (!synchronizePanelWidths(container, rest) && container.isConnected && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => synchronizePanelWidths(container, rest))
  }
  return container
}

/**
 * Await the recursive Surface's latest asynchronous face reconciliation. The
 * legacy renderer resolves immediately, so shell post-render hooks can use one
 * path while the migration flag is rolled out.
 */
export function workspaceSurfaceReady(container: ParentNode): Promise<void> {
  const surface = container.querySelector(WORKSPACE_SURFACE_TAG) as WorkspaceSurfaceElement | null
  return surface?.whenReady() ?? Promise.resolve()
}
