/**
 * @shrubbery/components — backend-free Lit components: CHROME bars + GENERAL,
 * skin-aware, token-driven PRIMITIVES.
 *
 * Importing this module REGISTERS every custom element as a side effect
 * (`@customElement(...)`). That is exactly the seam the render host
 * (@shrubbery/runtime) + the catalog rely on: a host stamps `<mn-top-bar>` /
 * `<mn-chip>` etc. and these definitions UPGRADE those stamped tags in place.
 * Un-lifted panel tags (e.g. mn-document-editor) have no
 * definition here, so they stay inert placeholders — never faked.
 *
 * TWO families ship here:
 *   - CHROME — the layout bars (mn-top-bar / mn-bottom-bar), lifted from garden's
 *     layout shells, made backend-free + skin-aware in earlier iterations.
 *   - GENERAL PRIMITIVES (iter-4a) — mn-chip / mn-badge / mn-sparkline /
 *     mn-ribbon / mn-card; plus mn-relations (iter-5a), a general directed
 *     FROM→pred→TO edge-list (socket-style class-link view) earned by the
 *     Emporium pack-detail RELATIONSHIPS section. The graph substrate has two
 *     honest renderers over the same MnGraphNode/MnGraphEdge contract:
 *     mn-graph is the deterministic SVG layered DAG, and mn-graph-three is the
 *     Garden-derived Three/WebGL flat network viewer. The first four are LIFTED +
 *     GENERALIZED from garden's
 *     PURE presentation primitives (emporium-port wf-primitives.ts: wf-chip,
 *     wf-integrity-badge, wf-sparkline, wf-phase-ribbon) — stripped of their
 *     workflow vocabulary, rebound to skin role tokens, props/slots-driven, and
 *     skin-aware so they work in BOTH skins. mn-card generalizes the catalogue
 *     card surface. NONE of garden's wf-* VIZ shells are ported (they are
 *     consumers of the wf: pack, not Emporium).
 *
 * Dependencies: @shrubbery/nucleus (contract TYPES only), lit, and pure visual
 * deps (lucide icons / three hero canvas / fabric artifact editor). NEVER
 * stores, auth, tauri, yjs, wf-model, or @shrubbery/runtime. (grep-verified by
 * the island test.)
 *
 * mn-vtuber (the WebGL/VRM avatar puppet) moved OUT to @shrubbery/atelier-vtuber
 * — it carries a much heavier dependency (@pixiv/three-vrm) than the rest of
 * this package, and the dependency direction runs one way: @shrubbery/atelier-
 * vtuber depends on @shrubbery/components (for SkinAware, exported below),
 * never the reverse. `mn-vtuber` remains a manifested, catalog-known tag
 * (see @shrubbery/nucleus known-components.ts / component-library.ts) — only
 * its registration + implementation live in the new package now.
 */

// Side-effect registrations (define the custom elements):
import './mn-top-bar.js'
import './mn-quick-clip.js'
import './mn-workspace-selector.js'
import './mn-app-bar.js'
import './mn-bottom-bar.js'
import './mn-presence-inspector.js'
import './mn-chip.js'
import './mn-badge.js'
import './mn-sparkline.js'
import './mn-ribbon.js'
import './mn-card.js'
import './mn-relations.js'
import './mn-graph.js'
import './mn-graph-three.js'
import './mn-graph-panel.js'
import './mn-button.js'
import './mn-icon-button.js'
import './mn-input.js'
import './mn-textarea.js'
import './mn-search-input.js'
import './mn-tooltip.js'
import './mn-avatar.js'
import './mn-panel-header.js'
import './mn-dropdown-button.js'
import './mn-inline-edit.js'
import './mn-toast.js'
import './mn-modal.js'
import './mn-dialog.js'
import './mn-toolbar.js'
import './mn-tag-chip-specimen.js'
import './mn-tag-autocomplete-popover.js'
import './mn-calendar-event-specimen.js'
import './mn-daily-note-header.js'
import './mn-daily-note-row.js'
import './mn-home-view.js'
import './mn-garden-home.js'
import './mn-month-popover.js'
import './mn-editor-toolbar.js'
import './mn-spinner.js'
import './mn-loading.js'
import './mn-empty-state.js'
import './mn-continuity-status.js'
import './mn-sidebar-panel.js'
import './mn-document-outline.js'
import './mn-tag-view.js'
import './mn-artifact-view.js'
import './mn-artifact-editor.js'
import './mn-excalidraw-canvas.js'
import './mn-artifact-history.js'
import './mn-doc-history-panel.js'
import './mn-original-viewer.js'
import './wf-choreograph-view.js'
import './wf-studio-shell.js'
import './mn-snapshot-diff.js'
import './mn-timeline-rail.js'
import './mn-restore-overlay.js'
import './mn-comments-panel.js'
import './mn-comment-popover.js'
import './mn-inspector.js'
import './mn-document-switcher.js'
import './mn-settings-page.js'
import './mn-ops-health-page.js'
import './mn-consent-banner.js'
import './mn-upgrade-banner.js'
import './mn-storage-banner.js'
import './mn-lifetime-banner.js'
import './mn-cloud-mode-pill.js'
import './mn-cloud-mode-panel.js'
import './mn-tts-player.js'
import './mn-feedback-form.js'
import './mn-export-dialog.js'
import './mn-mobile-tabs.js'
import './mn-mobile-file-list.js'
import './mn-error-boundary.js'
import './mn-context-menu.js'
import './mn-input-dialog.js'
import './mn-confirmation-dialog.js'
import './mn-folder-picker-dialog.js'
import './mn-shortcuts-dialog.js'
import './mn-advanced-wire-menu.js'
import './mn-wire-menu-dropdown.js'
import './mn-wire-picker.js'
import './mn-wikilink-picker.js'
import './mn-node-link-picker.js'
import './mn-citation-picker.js'
import './mn-zotero-library-panel.js'
import './mn-zotero-source-workbench.js'
import './mn-wire-radial-overlay.js'
import './mn-research-source-chip.js'
import './mn-research-source-card.js'
import './mn-research-run-trace.js'
import './mn-research-workspace.js'
import './mn-public-shell.js'
import './mn-auth-page.js'
import './garden-hero-canvas.js'
import './sophia-hero-canvas.js'
import './garden-landing.js'
import './sophia-labs-landing.js'

// Re-export the classes + their controlled-prop types for shells that want to
// construct / type them directly.
export {
  MnTopBar,
  type ChromeAppId,
  type ChromeSkinId,
  type ChromeBreadcrumb,
  type ChromeBreadcrumbOpenDetail,
} from './mn-top-bar.js'
export {
  MnQuickClip,
  type MnQuickClipKind,
  type MnQuickClipRequestDetail,
  type MnQuickClipStatus,
} from './mn-quick-clip.js'
export {
  MnWorkspaceSelector,
  type MnWorkspaceCellState,
  type MnWorkspaceDetail,
  type MnWorkspaceLifetimeState,
  type MnWorkspaceRole,
  type MnWorkspaceSelectorStatus,
  type MnWorkspaceSummary,
} from './mn-workspace-selector.js'
export {
  MnHomeView,
  type MnHomeDocument,
  type MnHomeOpenDocumentDetail,
  type MnHomePinDetail,
  type MnHomeStatus,
} from './mn-home-view.js'
export {
  MnGardenHome,
  type MnGardenHomeAccount,
  type MnGardenHomeAccountDetail,
  type MnGardenHomeCreateDetail,
  type MnGardenHomeCreateStatus,
  type MnGardenHomeIntentDetailMap,
  type MnGardenHomeStatus,
  type MnGardenHomeWorkspaceDetail,
} from './mn-garden-home.js'
// The richer, general PRODUCT bar (masthead + search/filter + breadcrumb trail +
// nav/actions) — lifts MORE of garden's real top-bar structure than the chrome
// bar, generalized + controlled. Drives the dedicated app shells (apps/emporium).
export { MnAppBar, type MnCrumb } from './mn-app-bar.js'
export {
  MnBottomBar,
  type ChromeLeftPanelMode,
  type ChromePanelId,
  type ChromeDocumentStats,
  type ChromePresenceFollowDetail,
  type ChromePresenceOpenDetail,
  type ChromePresencePerson,
  type ChromePresenceSelfUpdateDetail,
  type ChromePresenceSession,
  type ChromeSyncState,
  type ChromeRuntimeMode,
  type ChromeSourceBadgeKind,
  type ChromeSourceBadgeActivatableKind,
  type ChromeSourceBadgeActivateDetail,
  type ChromeSourceBadge,
  type ChromeSourceStatus,
} from './mn-bottom-bar.js'
export { MnPresenceInspector } from './mn-presence-inspector.js'

// General primitives (iter-4a) — lifted + generalized from garden's pure wf-*
// presentation primitives + a generalized catalogue card.
export { MnChip, type MnTone } from './mn-chip.js'
export {
  MnBadge,
  type BadgeSize,
  type BadgeVariant,
  type FiletypeKey,
  type MnBadgeFiletype,
  type MnBadgeSize,
  type MnBadgeState,
  type MnBadgeVariant,
} from './mn-badge.js'
export { MnSparkline, type MnSparklineTone } from './mn-sparkline.js'
export { MnRibbon, type MnRibbonSegment } from './mn-ribbon.js'
export { MnCard } from './mn-card.js'
export { MnRelations, type MnRelation } from './mn-relations.js'
// The general graph substrate. mn-graph is the deterministic SVG layered DAG;
// mn-graph-three is the controlled Garden paper-craft workspace/document scene.
export { MnGraph, type MnGraphNode, type MnGraphEdge } from './mn-graph.js'
export {
  MnGraphThree,
  layoutGardenDocument,
  layoutGardenWorkspace,
  wireCategoryForPredicate,
  type MnGraphThreeDimension,
  type MnGraphThreeEdge,
  type MnGraphThreeNode,
  type MnGraphThreeNodeKind,
  type MnGraphThreePoint,
  type MnGraphThreeViewMode,
  type WireCategory,
} from './mn-graph-three.js'
export {
  MnGraphPanel,
  type MnGraphPanelEdge,
  type MnGraphPanelEdgeSelectDetail,
  type MnGraphPanelNode,
  type MnGraphPanelNodeKind,
  type MnGraphPanelNodeOpenDetail,
  type MnGraphPanelNodeSelectDetail,
  type MnGraphPanelRefreshDetail,
  type MnGraphPanelStatus,
  type MnGraphPanelViewModeChangeDetail,
} from './mn-graph-panel.js'
export { MnButton, type MnButtonSize, type MnButtonVariant } from './mn-button.js'
export { MnIconButton, type MnIconButtonSize } from './mn-icon-button.js'
export {
  MnInput,
  type MnInputSize,
  type MnInputType,
  type MnInputValueDetail,
} from './mn-input.js'
export {
  MnTextarea,
  type MnTextareaResize,
  type MnTextareaValueDetail,
} from './mn-textarea.js'
export {
  MnSearchInput,
  type MnSearchInputDetail,
} from './mn-search-input.js'
export { MnTooltip } from './mn-tooltip.js'
export {
  MnAvatar,
  type MnAvatarPresence,
  type MnAvatarSize,
} from './mn-avatar.js'
// The skin/theme-mirroring mixin — public so @shrubbery/atelier-vtuber's
// mn-vtuber (which lives OUTSIDE this package now) can still be a skin-aware
// chrome element. See the file header note on the dependency direction.
export { SkinAware, type SkinAwareHost } from './skin-aware.js'
export { MnPanelHeader } from './mn-panel-header.js'
export {
  MnDropdownButton,
  type MnDropdownEntry,
  type MnDropdownItem,
  type MnDropdownPlacement,
  type MnDropdownSelectDetail,
  type MnDropdownSize,
  type MnDropdownVariant,
} from './mn-dropdown-button.js'
export { MnInlineEdit, type MnInlineEditSaveDetail } from './mn-inline-edit.js'
export {
  MnToast,
  type MnToastPosition,
  type MnToastType,
} from './mn-toast.js'
export { MnModal, type MnModalSize } from './mn-modal.js'
export {
  MnDialog,
  type MnDialogCloseDetail,
  type MnDialogConfirmOptions,
  type MnDialogPromptOptions,
  type MnDialogSize,
} from './mn-dialog.js'
export {
  MnToolbar,
  MnToolbarGroup,
  MnToolbarOverflow,
  type MnToolbarOverflowSelectDetail,
  type MnToolbarOrientation,
  type MnToolbarVariant,
} from './mn-toolbar.js'
export {
  MnTagChipSpecimen,
  defaultTagChipSpecimenAttrs,
  type MnTagChipSpecimenAttrs,
} from './mn-tag-chip-specimen.js'
export {
  MnTagAutocompletePopover,
  type MnTagAutocompleteHoverDetail,
  type MnTagAutocompleteSelectDetail,
  type MnTagSuggestion,
} from './mn-tag-autocomplete-popover.js'
export {
  MnCalendarEventSpecimen,
  defaultCalendarEventSpecimenAttrs,
  type MnCalendarEventSpecimenAttrs,
  type MnCalendarEventSpecimenChangeDetail,
} from './mn-calendar-event-specimen.js'
export {
  MnDailyNoteHeader,
  type MnDailyNoteCalendarAnchorRequestDetail,
  type MnDailyNoteHeaderAdjacency,
  type MnDailyNoteOpenRequestDetail,
} from './mn-daily-note-header.js'
export {
  MnDailyNoteRow,
  type MnDailyNoteRowDoc,
} from './mn-daily-note-row.js'
export {
  MnMonthPopover,
  type MnMonthPopoverDateSelectDetail,
} from './mn-month-popover.js'
export {
  MnEditorToolbar,
  type MnEditorAlignDetail,
  type MnEditorBlockType,
  type MnEditorBlockTypeDetail,
  type MnEditorFontFamily,
  type MnEditorFontSize,
  type MnEditorFormatDetail,
  type MnEditorHistoryCommand,
  type MnEditorHistoryDetail,
  type MnEditorInlineCommand,
  type MnEditorKeyboardDetail,
  type MnEditorModifierDetail,
  type MnEditorTextAlign,
  type MnEditorTextChangeDetail,
  type MnEditorTextStyleDetail,
  type MnEditorToolbarFormatState,
  type MnEditorTtsStatus,
} from './mn-editor-toolbar.js'
export { MnSpinner, type MnSpinnerSize } from './mn-spinner.js'
export { MnLoading, type MnLoadingVariant, type MnLoadingSize } from './mn-loading.js'
export {
  MnEmptyState,
  type MnEmptyStateVariant,
  type MnEmptyStateMood,
} from './mn-empty-state.js'
export {
  MnContinuityStatus,
  type MnContinuityActionDetail,
  type MnContinuityState,
  type MnContinuityVariant,
} from './mn-continuity-status.js'
export {
  MnSidebarPanel,
  type MnSidebarAction,
  type MnSidebarActionDetail,
  type MnSidebarCapabilities,
  type MnSidebarColumnPathChangeDetail,
  type MnSidebarGrouping,
  type MnSidebarGroupingChangeDetail,
  type MnSidebarNode,
  type MnSidebarNodeDetail,
  type MnSidebarNodeDropDetail,
  type MnSidebarNodeKind,
  type MnSidebarDropPosition,
  type MnSidebarPresentation,
  type MnSidebarResolvedPresentation,
  type MnSidebarSection,
  type MnSidebarSelectionDetail,
  type MnSidebarSort,
  type MnSidebarSortChangeDetail,
  type MnSidebarSortCriterion,
  type MnSidebarStatus,
  type MnSidebarStorage,
} from './mn-sidebar-panel.js'

export {
  MnDocumentOutline,
  type MnDocumentOutlineHeading,
  type MnOutlineCommand,
  type MnOutlineCommandDetail,
  type MnOutlineNavigateDetail,
} from './mn-document-outline.js'
export {
  MnTagView,
  type MnTagViewBlock,
  type MnTagViewOpenBlockDetail,
  type MnTagViewRefreshDetail,
  type MnTagViewStatus,
} from './mn-tag-view.js'
export {
  MnArtifactView,
  artifactKindFromMime,
  type MnArtifactIntentDetail,
  type MnArtifactOpenDocumentDetail,
  type MnArtifactViewKind,
  type MnArtifactViewStatus,
} from './mn-artifact-view.js'
export {
  MnArtifactEditor,
  type MnArtifactEditorGenerateDetail,
  type MnArtifactEditorGenerateTarget,
  type MnArtifactEditorSaveDetail,
  type MnArtifactEditorTool,
} from './mn-artifact-editor.js'
export {
  MnExcalidrawCanvas,
  type MnExcalidrawCanvasStatus,
  type MnSceneCanvasIntentDetail,
  type MnSceneDiagnostic,
  type MnSceneDiagnosticSeverity,
  type MnSceneElementIntentDetail,
  type MnSceneNodeLinkPickDetail,
  type MnSceneOperationStatus,
  type MnScenePredicateChangeDetail,
  type MnScenePredicateOption,
  type MnSceneProjectionSummary,
  type MnSceneSaveStatus,
  type MnSceneSelectedElement,
  type MnSceneWireSummary,
} from './mn-excalidraw-canvas.js'
export {
  MnArtifactHistory,
  type MnArtifactHistoryIntentDetail,
  type MnArtifactHistoryRevisionDetail,
  type MnArtifactHistoryStatus,
  type MnArtifactRevision,
  type MnArtifactRevisionTrigger,
} from './mn-artifact-history.js'
export {
  MnDocHistoryPanel,
  diffHistoryLines,
  type MnDocHistoryCursorDetail,
  type MnDocHistoryCursorId,
  type MnDocHistoryDiffLine,
  type MnDocHistoryDiffStyle,
  type MnDocHistoryFocusedSide,
  type MnDocHistoryRestoreDetail,
  type MnDocHistorySnapshot,
  type MnDocHistorySnapshotDetail,
  type MnDocHistoryStatus,
} from './mn-doc-history-panel.js'
export {
  MnOriginalViewer,
  type MnOriginalViewerAnnotation,
  type MnOriginalViewerAnnotationDetail,
  type MnOriginalViewerChapter,
  type MnOriginalViewerChapterDetail,
  type MnOriginalViewerIntentDetail,
  type MnOriginalViewerKind,
  type MnOriginalViewerPage,
  type MnOriginalViewerStatus,
} from './mn-original-viewer.js'
export {
  WfChoreographView,
  WfMissionControl,
  type WfAgentRun,
  type WfChoreographMode,
  type WfChoreographStatus,
  type WfGraphIntentDetail,
  type WfNodeStatus,
  type WfNodeToggleDetail,
  type WfPhaseStatus,
  type WfRunConnectDetail,
  type WfRunDetail,
  type WfRunListItem,
  type WfRunProvenance,
  type WfRunStatus,
  type WfTelemetryNode,
  type WfTelemetryPhase,
  type WfTelemetryRun,
} from './wf-choreograph-view.js'
export {
  WfStudioShell,
  type WfComparisonVerdict,
  type WfGateChangeDetail,
  type WfGateKind,
  type WfRunCompareDetail,
  type WfRunComparison,
  type WfRunComparisonField,
  type WfStudioDataStatus,
  type WfStudioGraphDetail,
  type WfStudioScreen,
  type WfStudioScreenChangeDetail,
  type WfWorkflowAnatomy,
  type WfWorkflowDefinition,
  type WfWorkflowGate,
  type WfWorkflowLaunchDetail,
  type WfWorkflowNodeDefinition,
  type WfWorkflowPhaseDefinition,
  type WfWorkflowPhaseSummary,
  type WfWorkflowRequestDetail,
} from './wf-studio-shell.js'
export {
  MnSnapshotDiff,
  diffSnapshotLines,
  type MnSnapshotDiffAnnotation,
  type MnSnapshotDiffLine,
  type MnSnapshotDiffLineKind,
  type MnSnapshotDiffStyle,
  type MnSnapshotLineDiffType,
} from './mn-snapshot-diff.js'
export {
  MnTimelineRail,
  type MnTimelineCursorDetail,
  type MnTimelineCursorId,
  type MnTimelineFocusedSide,
  type MnTimelineSnapshot,
  type MnTimelineSnapshotDetail,
} from './mn-timeline-rail.js'
export {
  MnRestoreOverlay,
  type MnRestoreOperationState,
} from './mn-restore-overlay.js'
export {
  MnCommentsPanel,
  type MnComment,
  type MnCommentDetail,
  type MnCommentEditDetail,
  type MnCommentHoverDetail,
  type MnCommentResolveDetail,
} from './mn-comments-panel.js'
export {
  MnCommentPopover,
  type MnCommentPopoverComment,
  type MnCommentPopoverDetail,
  type MnCommentPopoverMode,
  type MnCommentPopoverMoveDetail,
  type MnCommentPopoverSaveDetail,
} from './mn-comment-popover.js'
export {
  MnInspector,
  type MnInspectorAction,
  type MnInspectorActionDetail,
  type MnInspectorActionDivider,
  type MnInspectorActionHeader,
  type MnInspectorActionItem,
  type MnInspectorIdentity,
  type MnInspectorIdentityChip,
  type MnInspectorModel,
  type MnInspectorRelationGroup,
  type MnInspectorRelationItem,
  type MnInspectorRelationOpenDetail,
  type MnInspectorRelations,
  type MnInspectorRelationsScope,
} from './mn-inspector.js'
export {
  MnDocumentSwitcher,
  type MnDocumentSwitcherAction,
  type MnDocumentSwitcherActionDetail,
  type MnDocumentSwitcherBlockItem,
  type MnDocumentSwitcherDocumentItem,
  type MnDocumentSwitcherItem,
  type MnDocumentSwitcherIntentDetail,
  type MnDocumentSwitcherMatchSource,
  type MnDocumentSwitcherOpenBlockDetail,
  type MnDocumentSwitcherOpenDocumentDetail,
  type MnDocumentSwitcherQueryDetail,
  type MnDocumentSwitcherScope,
  type MnDocumentSwitcherScopeDetail,
  type MnDocumentSwitcherSort,
  type MnDocumentSwitcherSortDetail,
  type MnDocumentSwitcherStatus,
  type MnDocumentSwitcherWireTargetDetail,
} from './mn-document-switcher.js'
export {
  MnSettingsPage,
  type MnSettingsAction,
  type MnSettingsActionDetail,
  type MnSettingsJob,
  type MnSettingsJobActionDetail,
  type MnSettingsJobStatus,
  type MnSettingsMetric,
  type MnSettingsNavGroup,
  type MnSettingsNavItem,
  type MnSettingsOption,
  type MnSettingsSection,
  type MnSettingsSectionChangeDetail,
  type MnSettingsSectionId,
  type MnSettingsSecret,
  type MnSettingsSecretActionDetail,
  type MnSettingsSelect,
  type MnSettingsSelectChangeDetail,
  type MnSettingsStatus,
  type MnSettingsToggle,
  type MnSettingsToggleChangeDetail,
  type MnSettingsTone,
} from './mn-settings-page.js'
export {
  MnAccessManager,
  type MnAccessAddDetail,
  type MnAccessBusyAction,
  type MnAccessCurrentRole,
  type MnAccessGrant,
  type MnAccessManagerModel,
  type MnAccessRemoveDetail,
  type MnAccessRole,
  type MnAccessRoleChangeDetail,
  type MnAccessStatus,
} from './mn-access-manager.js'
export {
  MnOpsHealthPage,
  type MnOpsHealthAlert,
  type MnOpsHealthController,
  type MnOpsHealthCopyJsonDetail,
  type MnOpsHealthQueue,
  type MnOpsHealthQueueBucket,
  type MnOpsHealthService,
  type MnOpsHealthSnapshot,
  type MnOpsHealthStatus,
  type MnOpsHealthWorkerPressure,
  type MnOpsHealthWorkload,
} from './mn-ops-health-page.js'
export {
  MnConsentBanner,
  type MnConsentChoice,
  type MnConsentChoiceDetail,
  type MnConsentState,
} from './mn-consent-banner.js'
export {
  MnUpgradeBanner,
  type MnUpgradeBannerDetail,
} from './mn-upgrade-banner.js'
export {
  MnStorageBanner,
  type MnStorageBannerConfig,
  type MnStorageBannerDetail,
  type MnStorageBannerTone,
  type MnStorageThreshold,
} from './mn-storage-banner.js'
export {
  MnLifetimeBanner,
  type MnLifetimeBannerDetail,
  type MnLifetimeBannerState,
  type MnLifetimeReason,
} from './mn-lifetime-banner.js'
export {
  MnCloudModePill,
  type MnCloudMode,
  type MnCloudModePillOpenDetail,
  type MnCloudModeStatus,
} from './mn-cloud-mode-pill.js'
export {
  MnCloudModePanel,
  type MnCloudModeAction,
  type MnCloudModeActionDetail,
  type MnCloudOs,
  type MnCloudSignInState,
} from './mn-cloud-mode-panel.js'
export {
  MnTtsPlayer,
  type MnTtsAction,
  type MnTtsActionDetail,
  type MnTtsStatus,
  type MnTtsTier,
  type MnTtsTierOption,
} from './mn-tts-player.js'
export {
  MnFeedbackForm,
  type MnFeedbackCloseDetail,
  type MnFeedbackSubmitDetail,
  type MnFeedbackType,
} from './mn-feedback-form.js'
export {
  MnExportDialog,
  defaultExportThemes,
  type MnExportAction,
  type MnExportActionDetail,
  type MnExportCopyStatus,
  type MnExportTheme,
} from './mn-export-dialog.js'
export {
  MnMobileTabs,
  type MnMobileCenterMode,
  type MnMobileTab,
  type MnMobileTabDetail,
} from './mn-mobile-tabs.js'
export {
  MnMobileFileList,
  type MnMobileDocumentOpenDetail,
  type MnMobileFileAction,
  type MnMobileFileActionDetail,
  type MnMobileFileIntentDetailMap,
  type MnMobileFileIntentName,
  type MnMobileFileNode,
  type MnMobileFileNodeDetail,
  type MnMobileFileNodeType,
  type MnMobileFileOperationAction,
  type MnMobileFileOperationFeedback,
  type MnMobileFileOperationState,
  type MnMobileFileRetryDetail,
  type MnMobileFileSearchDetail,
  type MnMobileFileStatus,
  type MnMobileFileView,
  type MnMobileFileViewDetail,
  type MnMobileRecentDocument,
  type MnMobileWorkspace,
  type MnMobileWorkspaceDetail,
} from './mn-mobile-file-list.js'
export {
  MnErrorBoundary,
  type MnErrorBoundaryVariant,
} from './mn-error-boundary.js'
export {
  MnContextMenu,
  type MnContextMenuAnchor,
  type MnContextMenuEntry,
  type MnContextMenuItem,
  type MnContextMenuModifiers,
  type MnContextMenuSelectDetail,
} from './mn-context-menu.js'
export {
  MnInputDialog,
  type MnInputDialogConfirmDetail,
} from './mn-input-dialog.js'
export {
  MnConfirmationDialog,
  type MnConfirmationVariant,
} from './mn-confirmation-dialog.js'
export {
  MnFolderPickerDialog,
  type MnFolderPickerOption,
  type MnFolderPickerSelectDetail,
} from './mn-folder-picker-dialog.js'
export {
  MnShortcutsDialog,
  formatShortcutLabel,
  type MnShortcutCommand,
  type MnShortcutPlatform,
  type MnShortcutRunDetail,
} from './mn-shortcuts-dialog.js'
export {
  MnAdvancedWireMenu,
  type MnAdvancedWireMenuConfirmDetail,
  type MnWireDirection,
  type MnWirePredicateGroup,
} from './mn-advanced-wire-menu.js'
export {
  MnWireMenuDropdown,
  type MnWireMenuActionDetail,
  type MnWireMenuAddDetail,
  type MnWireMenuDirection,
  type MnWireMenuType,
  type MnWireMenuWire,
} from './mn-wire-menu-dropdown.js'
export {
  MnWirePicker,
  type MnWirePickerBlockItem,
  type MnWirePickerDirection,
  type MnWirePickerDocumentItem,
  type MnWirePickerGranularity,
  type MnWirePickerOptionChangeDetail,
  type MnWirePickerOptionsField,
  type MnWirePickerPhase,
  type MnWirePickerPhaseRequestDetail,
  type MnWirePickerPredicateItem,
  type MnWirePickerQueryDetail,
  type MnWirePickerSelectDetail,
  type MnWirePickerSource,
} from './mn-wire-picker.js'
export {
  MnWikiLinkPicker,
  type MnWikiLinkBlockItem,
  type MnWikiLinkDocumentItem,
  type MnWikiLinkPickerPhase,
  type MnWikiLinkPickerPhaseRequestDetail,
  type MnWikiLinkPickerQueryDetail,
  type MnWikiLinkPickerSelectDetail,
  type MnWikiLinkPredicateItem,
} from './mn-wikilink-picker.js'
export {
  MnNodeLinkPicker,
  type MnNodeLinkCandidate,
  type MnNodeLinkKind,
  type MnNodeLinkPickDetail,
} from './mn-node-link-picker.js'
export {
  MnCitationPicker,
  type MnCitationItem,
  type MnCitationPickDetail,
  type MnCitationSearchDetail,
} from './mn-citation-picker.js'
export {
  MnZoteroLibraryPanel,
  type MnZoteroCollection,
  type MnZoteroLibraryItem,
  type MnZoteroLibraryOpenSourceDetail,
  type MnZoteroLibraryOpenSourceOrigin,
  type MnZoteroLibrarySearchDetail,
  type MnZoteroLibraryToggleCollectionDetail,
} from './mn-zotero-library-panel.js'
export {
  MnZoteroSourceWorkbench,
  type MnZoteroSourceAnnotation,
  type MnZoteroSourceBaseDetail,
  type MnZoteroSourceIncomingWire,
  type MnZoteroSourceItem,
  type MnZoteroSourceOpenDocumentDetail,
  type MnZoteroSourceOpenTagDetail,
  type MnZoteroSourceOpenZoteroDetail,
  type MnZoteroSourcePromoteAnnotationDetail,
} from './mn-zotero-source-workbench.js'
export {
  MnWireRadialOverlay,
  type MnWireRadialContextBlock,
  type MnWireRadialContextData,
  type MnWireRadialContextMap,
  type MnWireRadialContextRequestDetail,
  type MnWireRadialContextState,
  type MnWireRadialNavigateDetail,
  type MnWireRadialPinDetail,
  type MnWireRadialSuggestion,
  type MnWireRadialSuggestionDetail,
  type MnWireRadialWire,
} from './mn-wire-radial-overlay.js'
export {
  MnResearchSourceChip,
  type MnResearchSourceChipDetail,
  type MnResearchSourceKind,
  type MnResearchSourceStatus,
} from './mn-research-source-chip.js'
export {
  MnResearchSourceCard,
  type MnResearchSource,
  type MnResearchSourceCardDetail,
} from './mn-research-source-card.js'
export {
  MnResearchRunTrace,
  type MnResearchRunStep,
  type MnResearchRunStepDetail,
  type MnResearchRunStepStatus,
} from './mn-research-run-trace.js'
export {
  MnResearchWorkspace,
  type MnResearchWorkspaceMode,
  type MnResearchWorkspaceModeDetail,
} from './mn-research-workspace.js'
export {
  MnPublicShell,
  projectPublicShellGraph,
  type MnPublicBlock,
  type MnPublicBlockType,
  type MnPublicDocument,
  type MnPublicDocumentSummary,
  type MnPublicFolder,
  type MnPublicInlineMark,
  type MnPublicMarkType,
  type MnPublicNav,
  type MnPublicGraphProjection,
  type MnPublicShellCopyCodeDetail,
  type MnPublicShellOpenDocumentDetail,
  type MnPublicShellStatus,
  type MnPublicShellView,
  type MnPublicShellViewDetail,
  type MnPublicTableCell,
  type MnPublicTableRow,
  type MnPublicWire,
  type MnPublicWires,
} from './mn-public-shell.js'
export {
  MnAuthPage,
  MnSignInForm,
  MnSignUpForm,
  MnVerifyEmailForm,
  type MnAuthFieldChangeDetail,
  type MnAuthMode,
  type MnAuthModeChangeDetail,
  type MnAuthResendVerificationDetail,
  type MnAuthSignInDetail,
  type MnAuthSignUpDetail,
  type MnAuthStatus,
  type MnAuthVerifyEmailDetail,
} from './mn-auth-page.js'
export { GardenHeroCanvas } from './garden-hero-canvas.js'
export { SophiaHeroCanvas } from './sophia-hero-canvas.js'
export {
  GardenLanding,
  type MnLandingActionDetail,
  type MnLandingName,
} from './garden-landing.js'
export { SophiaLabsLanding } from './sophia-labs-landing.js'

// The ported lucide icon system — inline-SVG icons for shells that compose their
// OWN designed surfaces (e.g. the rhizome left rail). `icon(name, opts)` returns a
// Lit child value (an inline-<svg> unsafeHTML directive, or a placeholder template);
// `iconStyles` is the CSS rule each consuming component must add to its `static
// styles` so the SVG inherits currentColor in Shadow DOM.
export {
  icon,
  iconStyles,
  getAvailableIcons,
  hasIcon,
  type IconName,
  type IconOptions,
  type IconResult,
} from './icons.js'

// The layer-contract campaign's top-layer helper — promotes floating UI
// (dropdowns/menus/popovers) to the native top layer via the Popover API, so
// components stop competing on local z-index inside whatever stacking
// context their host happens to form. Non-element: a flat module of pure
// primitives plus a Lit ReactiveController adoption surface.
export {
  showPopover,
  hidePopover,
  isPopoverOpen,
  positionPopover,
  PopoverController,
  type PopoverPlacement,
  type PositionOptions,
  type PopoverControllerOptions,
} from './popover.js'
