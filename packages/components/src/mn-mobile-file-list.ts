/**
 * Mobile file list lifted from Garden and severed from stores/controllers.
 *
 * The Garden original owned filesystem/session/API/native side effects. This
 * port keeps the mobile folders/recents/workspace UI but makes data controlled
 * and emits host intents for every side effect.
 */
import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type {
  FilePaneAction,
  FilePaneOperationAction,
  FilePaneOperationFeedback,
  FilePaneOperationState,
} from '@shrubbery/nucleus'
import { icon, iconStyles } from './icons.js'
import './mn-continuity-status.js'
import type { MnContinuityActionDetail, MnContinuityState } from './mn-continuity-status.js'

export type MnMobileFileView = 'folders' | 'recents'
export type MnMobileFileNodeType = 'document' | 'folder'
export type MnMobileFileAction = Extract<FilePaneAction, 'rename' | 'move' | 'delete'>
export type MnMobileFileStatus = Exclude<MnContinuityState, 'saving'>
export type MnMobileFileOperationAction = FilePaneOperationAction
export type MnMobileFileOperationState = FilePaneOperationState

export interface MnMobileFileNode {
  readonly id: string
  readonly label: string
  readonly type: MnMobileFileNodeType
  readonly readOnly?: boolean
  readonly children?: readonly MnMobileFileNode[]
}

export interface MnMobileRecentDocument {
  readonly docId: string
  readonly title: string
  readonly timestamp?: number | string | Date
  readonly readOnly?: boolean
  readonly graphId?: string
}

export interface MnMobileWorkspace {
  readonly graphId: string
  readonly title?: string
  readonly disabled?: boolean
  readonly disabledReason?: string
}

export interface MnMobileDocumentOpenDetail {
  readonly documentId: string
  readonly readOnly: boolean
}

export interface MnMobileWorkspaceDetail {
  readonly graphId: string
}

export interface MnMobileFileViewDetail {
  readonly view: MnMobileFileView
}

export interface MnMobileFileSearchDetail {
  readonly query: string
}

export interface MnMobileFileNodeDetail {
  readonly nodeId: string
  readonly nodeType: MnMobileFileNodeType
}

export interface MnMobileFileActionDetail extends MnMobileFileNodeDetail {
  readonly action: MnMobileFileAction
  /** Present when Browse collected a validated inline rename. */
  readonly proposedLabel?: string
}

/**
 * Host-controlled feedback for one operation. Keeping the affected row in the
 * projection while it is pending prevents destructive actions from appearing
 * to succeed before the host has actually committed them.
 */
export type MnMobileFileOperationFeedback = FilePaneOperationFeedback

export type MnMobileFileRetryDetail =
  | { readonly target: 'content' }
  | { readonly target: 'workspaces' }
  | { readonly target: 'operation'; readonly operationId: string }
  | { readonly target: 'reconcile'; readonly operationId: string }

type EmptyDetail = Readonly<Record<string, never>>

/** Exact intent boundary consumed by the shell adapter. */
export interface MnMobileFileIntentDetailMap {
  readonly 'document-open': MnMobileDocumentOpenDetail
  readonly 'mn-mobile-folder-toggle': MnMobileFileNodeDetail
  readonly 'mn-mobile-file-action': MnMobileFileActionDetail
  readonly 'mn-mobile-file-reconnect': EmptyDetail
  readonly 'mn-mobile-file-retry': MnMobileFileRetryDetail
  readonly 'mn-mobile-file-search-change': MnMobileFileSearchDetail
  readonly 'mn-mobile-file-view-change': MnMobileFileViewDetail
  readonly 'mn-mobile-workspace-create': EmptyDetail
  readonly 'mn-mobile-workspace-open': EmptyDetail
  readonly 'mn-mobile-workspace-select': MnMobileWorkspaceDetail
}

export type MnMobileFileIntentName = keyof MnMobileFileIntentDetailMap

interface ContextMenuState extends MnMobileFileNodeDetail {
  readonly label: string
}

interface RenameState extends ContextMenuState {
  readonly restoreFocus: 'row' | 'actions'
}

const LONG_PRESS_MS = 500
let mobileFileListInstance = 0

@customElement('mn-mobile-file-list')
export class MnMobileFileList extends LitElement {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      --mn-mobile-touch-target: var(--mn-touch-target-size, 48px);
      --mn-mobile-row-height: var(--mn-mobile-list-row-height, 56px);
      background: var(--mn-color-surface-base);
      overflow: hidden;
      font-family: var(--mn-font-chrome);
    }

    .mobile-shell {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      height: 100%;
    }

    mn-continuity-status {
      flex-shrink: 0;
    }

    .workspace-btn {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      width: 100%;
      min-height: var(--mn-mobile-row-height);
      padding: 0 var(--mn-space-4, 16px);
      border: none;
      background: var(--mn-color-surface-base);
      border-bottom: 1px solid var(--mn-color-border-default);
      cursor: pointer;
      color: var(--mn-color-text-primary);
      font-size: var(--mn-text-base);
      font-weight: var(--mn-font-weight-medium);
      font-family: var(--mn-font-chrome);
      text-align: left;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      flex-shrink: 0;
    }

    .workspace-btn:active {
      background: var(--mn-color-surface-hover);
    }

    button:focus-visible,
    .search-input:focus-visible,
    .rename-input:focus-visible {
      outline: none;
      box-shadow: inset var(--mn-focus-ring, 0 0 0 2px var(--mn-color-border-accent));
    }

    .workspace-btn-icon {
      color: var(--mn-color-text-accent);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .workspace-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .workspace-chevron {
      color: var(--mn-color-text-muted);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .view-toggle {
      display: flex;
      flex-shrink: 0;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px) 0;
      gap: 0;
      border-bottom: 1px solid var(--mn-color-border-default);
    }

    .toggle-btn {
      flex: 1;
      min-height: var(--mn-mobile-touch-target);
      border: none;
      background: transparent;
      font-size: var(--mn-type-ui-md-size);
      font-weight: var(--mn-font-weight-medium);
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-muted);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      margin-bottom: -1px;
    }

    .toggle-btn[data-active='true'] {
      color: var(--mn-color-text-accent);
      border-bottom-color: var(--mn-color-border-accent);
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: var(--mn-mobile-row-height);
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px) var(--mn-space-1, 4px) var(--mn-space-4, 16px);
      flex-shrink: 0;
      border-bottom: 1px solid var(--mn-color-border-default);
    }

    .search-icon {
      color: var(--mn-color-text-muted);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .search-input {
      flex: 1;
      min-width: 0;
      min-height: var(--mn-mobile-touch-target);
      border: none;
      background: transparent;
      font-size: var(--mn-text-base);
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-primary);
      outline: none;
    }

    .search-input::placeholder {
      color: var(--mn-color-text-muted);
    }

    .search-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--mn-mobile-touch-target);
      height: var(--mn-mobile-touch-target);
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--mn-color-text-muted);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .search-clear-slot {
      display: flex;
      flex: 0 0 var(--mn-mobile-touch-target);
      align-items: center;
      justify-content: center;
    }

    .list {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }

    .row {
      display: flex;
      align-items: center;
      min-height: var(--mn-mobile-row-height);
      border-bottom: 1px solid var(--mn-color-border-subtle);
      background: transparent;
      width: 100%;
      box-sizing: border-box;
    }

    .row-primary {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      align-self: stretch;
      min-width: 0;
      min-height: var(--mn-mobile-row-height);
      padding: 0 var(--mn-space-2, 8px) 0 var(--mn-space-4, 16px);
      gap: var(--mn-space-3, 12px);
      border: none;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      box-sizing: border-box;
    }

    .row-primary:active,
    .row-more:active {
      background: var(--mn-color-surface-hover);
    }

    .row-primary:disabled,
    .row-more:disabled {
      cursor: wait;
      opacity: 0.62;
    }

    .row[data-active='true'] {
      background: var(--mn-color-surface-accent);
    }

    .row[data-renaming='true'] {
      align-items: stretch;
      background: var(--mn-color-surface-accent);
    }

    .row-primary[data-depth='1'] { padding-left: 32px; }
    .row-primary[data-depth='2'] { padding-left: 48px; }
    .row-primary[data-depth='3'] { padding-left: 64px; }
    .row-primary[data-depth='4'] { padding-left: 80px; }

    .rename-editor {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      gap: var(--mn-space-2, 8px);
    }

    .rename-main {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: var(--mn-space-3, 12px);
    }

    .rename-main[data-depth='1'] { padding-left: 16px; }
    .rename-main[data-depth='2'] { padding-left: 32px; }
    .rename-main[data-depth='3'] { padding-left: 48px; }
    .rename-main[data-depth='4'] { padding-left: 64px; }

    .rename-field {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }

    .rename-input {
      width: 100%;
      min-width: 0;
      min-height: var(--mn-mobile-touch-target);
      box-sizing: border-box;
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-accent);
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: inherit;
      font-size: var(--mn-text-base);
    }

    .rename-input[aria-invalid='true'] {
      border-color: var(--mn-color-border-danger, var(--mn-color-text-danger));
    }

    .rename-guidance {
      min-height: 1.25em;
      color: var(--mn-color-text-muted);
      font-size: var(--mn-type-ui-sm-size);
      line-height: 1.25;
    }

    .rename-guidance[data-error='true'] {
      color: var(--mn-color-text-danger);
    }

    .rename-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
    }

    .rename-action {
      min-width: 76px;
      min-height: var(--mn-mobile-touch-target);
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: inherit;
      font-weight: var(--mn-font-weight-medium);
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }

    .rename-save {
      border-color: var(--mn-color-border-accent);
      background: var(--mn-color-surface-accent);
      color: var(--mn-color-text-accent);
    }

    .row-more {
      display: inline-flex;
      flex: 0 0 var(--mn-mobile-touch-target);
      align-items: center;
      justify-content: center;
      width: var(--mn-mobile-touch-target);
      height: var(--mn-mobile-touch-target);
      margin-right: var(--mn-space-2, 8px);
      padding: 0;
      border: none;
      border-radius: var(--mn-radius-control, 8px);
      background: transparent;
      color: var(--mn-color-text-muted);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .row-icon {
      color: var(--mn-color-text-muted);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }

    .row-icon[data-type='folder'] {
      color: var(--mn-color-text-accent);
    }

    .row-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .row-title {
      font-size: var(--mn-text-base);
      color: var(--mn-color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .row-meta {
      font-size: var(--mn-type-ui-sm-size);
      color: var(--mn-color-text-muted);
      margin-top: 1px;
    }

    .row-pending {
      color: var(--mn-color-text-accent);
    }

    .row-chevron {
      color: var(--mn-color-text-muted);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      transition: transform 0.15s ease;
    }

    .row-chevron[data-expanded='true'] {
      transform: rotate(90deg);
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      gap: 8px;
      color: var(--mn-color-text-muted);
      font-size: var(--mn-type-ui-md-size);
      text-align: center;
      padding: 24px;
      box-sizing: border-box;
    }

    .empty-title {
      color: var(--mn-color-text-primary);
      font-weight: var(--mn-font-weight-semibold);
    }

    .empty-detail {
      max-width: 28ch;
      line-height: 1.45;
    }

    .skeleton-list {
      flex: 1;
      overflow: hidden;
    }

    .skeleton-row {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) var(--mn-mobile-touch-target);
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: var(--mn-mobile-row-height);
      padding-left: var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle);
      box-sizing: border-box;
    }

    .skeleton-icon,
    .skeleton-line,
    .skeleton-more {
      background: var(--mn-color-surface-hover);
      animation: mn-mobile-file-pulse 1.4s ease-in-out infinite;
    }

    .skeleton-icon {
      width: 20px;
      height: 20px;
      border-radius: var(--mn-radius-sm, 4px);
    }

    .skeleton-line {
      width: min(72%, 240px);
      height: 10px;
      border-radius: 999px;
    }

    .skeleton-more {
      width: 20px;
      height: 6px;
      border-radius: 999px;
      justify-self: center;
    }

    @keyframes mn-mobile-file-pulse {
      0%, 100% { opacity: 0.42; }
      50% { opacity: 0.9; }
    }

    .ws-backdrop,
    .ctx-backdrop {
      position: fixed;
      inset: 0;
      background: var(--mn-color-surface-overlay);
    }

    .ws-backdrop {
      z-index: 600;
    }

    .ctx-backdrop {
      z-index: 620;
    }

    .ws-sheet,
    .ctx-sheet {
      position: fixed;
      left: 50%;
      bottom: 0;
      width: min(100%, 480px);
      transform: translateX(-50%);
      background: var(--mn-color-surface-base);
      border-top-left-radius: var(--mn-radius-xl, 16px);
      border-top-right-radius: var(--mn-radius-xl, 16px);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      max-height: min(72dvh, 620px);
      overflow-y: auto;
      box-shadow: var(--mn-shadow-modal);
      outline: none;
      box-sizing: border-box;
    }

    .ws-sheet {
      z-index: 601;
    }

    .ctx-sheet {
      z-index: 621;
    }

    .sheet-handle {
      width: 36px;
      height: 4px;
      margin: var(--mn-space-2, 8px) auto 0;
      border-radius: 999px;
      background: var(--mn-color-border-default);
    }

    .ws-sheet-header {
      display: flex;
      align-items: center;
      min-height: var(--mn-mobile-row-height);
      padding: 0 var(--mn-space-2, 8px) 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-default);
      color: var(--mn-color-text-primary);
      flex-shrink: 0;
    }

    .sheet-title {
      flex: 1;
      min-width: 0;
      margin: 0;
      font-size: var(--mn-type-heading-size);
      font-weight: var(--mn-font-weight-semibold);
      line-height: 1.3;
    }

    .ws-sheet-close {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 var(--mn-mobile-touch-target);
      width: var(--mn-mobile-touch-target);
      height: var(--mn-mobile-touch-target);
      border: none;
      background: transparent;
      color: var(--mn-color-text-muted);
      border-radius: 50%;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .ws-item {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      width: 100%;
      min-height: var(--mn-mobile-row-height);
      padding: 0 var(--mn-space-4, 16px);
      border: none;
      border-bottom: 1px solid var(--mn-color-border-subtle);
      background: transparent;
      font-size: var(--mn-text-base);
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-primary);
      text-align: left;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .ws-item:active {
      background: var(--mn-color-surface-hover);
    }

    .ws-item.active {
      color: var(--mn-color-text-accent);
      background: var(--mn-color-surface-accent);
    }

    .ws-item:disabled {
      cursor: not-allowed;
      color: var(--mn-color-text-muted);
      opacity: 0.58;
    }

    .ws-item-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ws-new {
      color: var(--mn-color-text-accent);
    }

    .ws-empty {
      padding: var(--mn-space-6, 24px) var(--mn-space-4, 16px);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-type-ui-md-size);
      text-align: center;
    }

    .ws-divider {
      height: 1px;
      background: var(--mn-color-border-default);
      margin: var(--mn-space-1, 4px) 0;
    }

    .ctx-sheet-header {
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px) var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-default);
    }

    .ctx-eyebrow {
      margin: 0 0 var(--mn-space-1, 4px);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-type-ui-sm-size);
      font-weight: var(--mn-font-weight-medium);
    }

    .ctx-title {
      margin: 0;
      color: var(--mn-color-text-primary);
      font-size: var(--mn-text-base);
      font-weight: var(--mn-font-weight-semibold);
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ctx-item {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: var(--mn-mobile-row-height);
      padding: 0 var(--mn-space-4, 16px);
      font-size: var(--mn-text-base);
      font-family: var(--mn-font-chrome);
      color: var(--mn-color-text-primary);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
    }

    .ctx-item-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .ctx-item-label {
      color: inherit;
      font-weight: var(--mn-font-weight-medium);
      line-height: 1.25;
    }

    .ctx-item-detail {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-type-ui-sm-size);
      line-height: 1.35;
    }

    .ctx-item[data-destructive='true'] .ctx-item-detail {
      color: var(--mn-color-text-danger);
      opacity: 0.82;
    }

    .ctx-item:active {
      background: var(--mn-color-surface-hover);
    }

    .ctx-item[data-destructive='true'] {
      color: var(--mn-color-text-danger);
    }

    .ctx-separator {
      height: 1px;
      background: var(--mn-color-border-default);
      margin: 0;
    }

    .ctx-cancel {
      justify-content: center;
      min-height: var(--mn-mobile-touch-target);
      margin-top: var(--mn-space-2, 8px);
      border-top: 1px solid var(--mn-color-border-default);
      font-weight: var(--mn-font-weight-medium);
    }

    @media (min-width: 600px) {
      .ws-sheet,
      .ctx-sheet {
        bottom: var(--mn-space-4, 16px);
        border-radius: var(--mn-radius-xl, 16px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .skeleton-icon,
      .skeleton-line,
      .skeleton-more { animation: none; }
    }
  `

  @property({ type: String })
  view: MnMobileFileView = 'folders'

  @property({ type: String })
  searchQuery = ''

  @property({ type: Boolean })
  /** @deprecated Set `status="loading"` instead. Retained for host compatibility. */
  synced = true

  @property({ type: String, reflect: true })
  status: MnMobileFileStatus = 'ready'

  @property({ type: String, attribute: 'status-label' })
  statusLabel = ''

  @property({ type: String, attribute: 'status-detail' })
  statusDetail = ''

  @property({ attribute: false })
  operation: MnMobileFileOperationFeedback | null = null

  @property({ type: String })
  currentGraphTitle = 'No Workspace'

  @property({ type: String })
  activeGraphId = ''

  @property({ type: String })
  activeDocumentId = ''

  @property({ type: Boolean })
  workspaceLoading = false

  @property({ type: String, attribute: 'workspace-error' })
  workspaceError = ''

  @property({ type: Boolean })
  allowNewWorkspace = true

  @property({ type: Boolean })
  contextMenu = true

  @property({ attribute: false })
  nodes: readonly MnMobileFileNode[] = []

  @property({ attribute: false })
  recents: readonly MnMobileRecentDocument[] = []

  @property({ attribute: false })
  workspaces: readonly MnMobileWorkspace[] = []

  @property({ attribute: false })
  expandedFolderIds: readonly string[] = []

  private localExpandedFolders = new Set<string>()
  private expandedFolderIdsSource: readonly string[] | null = null
  private readonly instanceId = ++mobileFileListInstance
  @state() private workspaceSwitcherOpen = false
  @state() private ctxMenu: ContextMenuState | null = null
  @state() private renameState: RenameState | null = null
  @state() private renameDraft = ''
  @state() private renameError = ''

  private longPressTimer: ReturnType<typeof setTimeout> | null = null
  private suppressRowActivationUntil = 0
  private workspaceTrigger: HTMLElement | null = null
  private actionTrigger: HTMLElement | null = null

  private announceModalState(id: 'workspace' | 'actions', open: boolean) {
    const event = new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: {
        id: `mobile-file-${this.instanceId}-${id}`,
        open,
        modality: 'modal',
      },
    })
    if (this.isConnected) this.dispatchEvent(event)
    else this.ownerDocument.dispatchEvent(event)
  }

  override connectedCallback() {
    super.connectedCallback()
    this.ownerDocument.addEventListener('keydown', this.handleDocumentKeyDown)
  }

  willUpdate() {
    if (this.expandedFolderIdsSource !== this.expandedFolderIds) {
      this.localExpandedFolders = new Set(this.expandedFolderIds)
      this.expandedFolderIdsSource = this.expandedFolderIds
    }
  }

  override disconnectedCallback() {
    this.cancelLongPress()
    if (this.workspaceSwitcherOpen) this.announceModalState('workspace', false)
    if (this.ctxMenu) this.announceModalState('actions', false)
    this.ownerDocument.removeEventListener('keydown', this.handleDocumentKeyDown)
    super.disconnectedCallback()
  }

  private emit<K extends MnMobileFileIntentName>(name: K, detail: MnMobileFileIntentDetailMap[K]) {
    this.dispatchEvent(new CustomEvent<MnMobileFileIntentDetailMap[K]>(name, {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private setView(view: MnMobileFileView) {
    if (this.view === view) return
    this.view = view
    this.emit('mn-mobile-file-view-change', { view })
  }

  private setSearch(query: string) {
    this.searchQuery = query
    this.emit('mn-mobile-file-search-change', { query })
  }

  private openWorkspaceSwitcher(trigger: HTMLElement) {
    this.workspaceTrigger = trigger
    this.workspaceSwitcherOpen = true
    this.announceModalState('workspace', true)
    this.emit('mn-mobile-workspace-open', {})
    void this.updateComplete.then(() => {
      const preferred = this.renderRoot.querySelector<HTMLElement>('.ws-item.active:not(:disabled)')
        ?? this.renderRoot.querySelector<HTMLElement>('.ws-item:not(:disabled)')
        ?? this.renderRoot.querySelector<HTMLElement>('.ws-sheet-close')
      preferred?.focus()
    })
  }

  private closeWorkspaceSwitcher(restoreFocus = true) {
    if (!this.workspaceSwitcherOpen) return
    this.workspaceSwitcherOpen = false
    this.announceModalState('workspace', false)
    const trigger = this.workspaceTrigger
    this.workspaceTrigger = null
    if (restoreFocus) this.restoreFocusAfterUpdate(trigger)
  }

  private selectGraph(graphId: string) {
    const workspace = this.workspaces.find(candidate => candidate.graphId === graphId)
    if (workspace?.disabled) return
    this.closeWorkspaceSwitcher()
    this.emit('mn-mobile-workspace-select', { graphId })
  }

  private createWorkspace() {
    this.closeWorkspaceSwitcher()
    this.emit('mn-mobile-workspace-create', {})
  }

  private openDocument(documentId: string, readOnly: boolean) {
    const detail: MnMobileDocumentOpenDetail = { documentId, readOnly }
    this.emit('document-open', detail)
  }

  private toggleFolder(folderId: string) {
    const next = new Set(this.localExpandedFolders)
    if (next.has(folderId)) next.delete(folderId)
    else next.add(folderId)
    this.localExpandedFolders = next
    this.requestUpdate()
    this.emit('mn-mobile-folder-toggle', {
      nodeId: folderId,
      nodeType: 'folder',
    })
  }

  private startLongPress(
    nodeId: string,
    nodeType: MnMobileFileNodeType,
    label: string,
    trigger: HTMLElement,
    e: TouchEvent,
  ) {
    if (!this.contextMenu) return
    this.cancelLongPress()
    if (!e.touches[0]) return
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null
      // Mobile browsers may synthesize a click after touchend. Keep the
      // long-press accelerator from also opening/toggling its row.
      this.suppressRowActivationUntil = Date.now() + 750
      this.openActionSheet(nodeId, nodeType, label, trigger)
    }, LONG_PRESS_MS)
  }

  private cancelLongPress() {
    if (this.longPressTimer === null) return
    clearTimeout(this.longPressTimer)
    this.longPressTimer = null
  }

  private openCtxMenu(
    nodeId: string,
    nodeType: MnMobileFileNodeType,
    label: string,
    trigger: HTMLElement,
    e: MouseEvent,
  ) {
    if (!this.contextMenu) return
    e.preventDefault()
    e.stopPropagation()
    this.openActionSheet(nodeId, nodeType, label, trigger)
  }

  private openActionSheet(
    nodeId: string,
    nodeType: MnMobileFileNodeType,
    label: string,
    trigger: HTMLElement,
  ) {
    if (!this.contextMenu) return
    this.actionTrigger = trigger
    this.ctxMenu = { nodeId, nodeType, label }
    this.announceModalState('actions', true)
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('.ctx-item')?.focus()
    })
  }

  private beginRename(menu: ContextMenuState) {
    const restoreFocus = this.actionTrigger?.classList.contains('row-more') ? 'actions' : 'row'
    this.closeCtxMenu(false)
    this.renameState = { ...menu, restoreFocus }
    this.renameDraft = menu.label
    this.renameError = ''
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>('.rename-input')
      input?.focus()
      input?.select()
    })
  }

  private updateRenameDraft(event: InputEvent) {
    this.renameDraft = (event.currentTarget as HTMLInputElement).value
    if (this.renameError) this.renameError = ''
  }

  private submitRename() {
    const rename = this.renameState
    if (!rename) return
    const proposedLabel = this.renameDraft.trim()
    if (!proposedLabel) {
      this.renameError = 'Name can’t be empty.'
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('.rename-input')?.focus())
      return
    }
    if (proposedLabel === rename.label) {
      this.cancelRename()
      return
    }
    this.renameState = null
    this.renameDraft = ''
    this.renameError = ''
    this.emit('mn-mobile-file-action', {
      action: 'rename',
      nodeId: rename.nodeId,
      nodeType: rename.nodeType,
      proposedLabel,
    })
    this.restoreRenameFocus(rename)
  }

  private cancelRename() {
    const rename = this.renameState
    if (!rename) return
    this.renameState = null
    this.renameDraft = ''
    this.renameError = ''
    this.restoreRenameFocus(rename)
  }

  private handleRenameKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      this.submitRename()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.cancelRename()
    }
  }

  private restoreRenameFocus(rename: RenameState) {
    void this.updateComplete.then(() => {
      const selector = rename.restoreFocus === 'actions' ? '[data-action-for]' : '[data-node-id]'
      const target = Array.from(this.renderRoot.querySelectorAll<HTMLElement>(selector))
        .find(candidate => candidate.getAttribute(
          rename.restoreFocus === 'actions' ? 'data-action-for' : 'data-node-id',
        ) === rename.nodeId)
      if (target && !target.hasAttribute('disabled')) target.focus()
    })
  }

  private activateFolder(folderId: string) {
    if (this.consumeSuppressedRowActivation()) return
    this.toggleFolder(folderId)
  }

  private activateDocument(documentId: string, readOnly: boolean) {
    if (this.consumeSuppressedRowActivation()) return
    this.openDocument(documentId, readOnly)
  }

  private consumeSuppressedRowActivation(): boolean {
    if (this.suppressRowActivationUntil === 0 || Date.now() > this.suppressRowActivationUntil) return false
    this.suppressRowActivationUntil = 0
    return true
  }

  private closeCtxMenu(restoreFocus = true) {
    if (!this.ctxMenu) return
    this.ctxMenu = null
    this.announceModalState('actions', false)
    const trigger = this.actionTrigger
    this.actionTrigger = null
    if (restoreFocus) this.restoreFocusAfterUpdate(trigger)
  }

  private action(action: Exclude<MnMobileFileAction, 'rename'>, menu: ContextMenuState) {
    const trigger = this.actionTrigger
    this.closeCtxMenu(false)
    void this.updateComplete.then(() => {
      // Give a host-owned modal an exact, live invocation target to remember.
      // The trigger lives in this shadow root, so it must hold focus before the
      // controlled action crosses into the document-level dialog layer.
      if (trigger?.isConnected) trigger.focus()
      this.emit('mn-mobile-file-action', {
        action,
        nodeId: menu.nodeId,
        nodeType: menu.nodeType,
      })
    })
  }

  private restoreFocusAfterUpdate(trigger: HTMLElement | null) {
    if (!trigger) return
    void this.updateComplete.then(() => {
      if (trigger.isConnected) trigger.focus()
    })
  }

  private readonly handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (this.renameState) {
      event.preventDefault()
      event.stopPropagation()
      this.cancelRename()
      return
    }
    if (this.ctxMenu) {
      event.preventDefault()
      event.stopPropagation()
      this.closeCtxMenu()
      return
    }
    if (this.workspaceSwitcherOpen) {
      event.preventDefault()
      event.stopPropagation()
      this.closeWorkspaceSwitcher()
    }
  }

  private trapDialogFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget as HTMLElement
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"]), mn-continuity-status',
    )).flatMap(candidate => candidate.tagName === 'MN-CONTINUITY-STATUS'
      ? Array.from(candidate.shadowRoot?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      : [candidate])
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    let active = this.shadowRoot?.activeElement as HTMLElement | null
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeInside = active ? focusable.includes(active) : false
    if (event.shiftKey && (active === first || !activeInside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  private branchId(nodeId: string): string {
    const safeNodeId = Array.from(nodeId)
      .map(character => /[a-zA-Z0-9_-]/.test(character) ? character : `-${character.codePointAt(0)?.toString(16) ?? 'x'}-`)
      .join('')
    return `mn-mobile-file-${this.instanceId}-branch-${safeNodeId}`
  }

  private filterTree(nodes: readonly MnMobileFileNode[]): MnMobileFileNode[] {
    const query = this.searchQuery.toLowerCase().trim()
    if (!query) return [...nodes]

    const filterNode = (node: MnMobileFileNode): MnMobileFileNode | null => {
      if (node.type === 'folder') {
        const children = (node.children ?? [])
          .map(filterNode)
          .filter((child): child is MnMobileFileNode => child !== null)
        if (node.label.toLowerCase().includes(query) || children.length > 0) {
          return { ...node, children }
        }
        return null
      }
      return node.label.toLowerCase().includes(query) ? node : null
    }

    return nodes
      .map(filterNode)
      .filter((node): node is MnMobileFileNode => node !== null)
  }

  private recentRows(): MnMobileRecentDocument[] {
    const query = this.searchQuery.toLowerCase().trim()
    return this.recents
      .filter((recent) => !this.activeGraphId || !recent.graphId || recent.graphId === this.activeGraphId)
      .filter((recent) => !query || recent.title.toLowerCase().includes(query))
      .slice(0, 30)
  }

  private effectiveStatus(): MnMobileFileStatus {
    // Preserve the old `synced=false` loading contract without letting it hide
    // a newer, more informative host-controlled state.
    return !this.synced && this.status === 'ready' ? 'loading' : this.status
  }

  private hasAvailableContent(): boolean {
    if (this.view === 'folders') return this.nodes.length > 0
    return this.recents.some(recent => !this.activeGraphId || !recent.graphId || recent.graphId === this.activeGraphId)
  }

  private isNodePending(nodeId: string): boolean {
    return this.operation?.state === 'pending' && this.operation.nodeId === nodeId
  }

  private isGraphPending(graphId: string): boolean {
    return this.operation?.state === 'pending' && this.operation.graphId === graphId
  }

  private operationCopy(operation: MnMobileFileOperationFeedback): { label: string; detail: string } {
    const subject = operation.label?.trim()
    const pendingVerb: Record<MnMobileFileOperationAction, string> = {
      'open-document': 'Opening',
      'switch-workspace': 'Switching to',
      'create-workspace': 'Creating',
      'create-document': 'Creating',
      'create-folder': 'Creating',
      rename: 'Renaming',
      delete: 'Deleting',
      move: 'Moving',
      refresh: 'Refreshing',
    }
    const errorVerb: Record<MnMobileFileOperationAction, string> = {
      'open-document': 'Couldn\u2019t open',
      'switch-workspace': 'Couldn\u2019t switch to',
      'create-workspace': 'Couldn\u2019t create',
      'create-document': 'Couldn\u2019t create',
      'create-folder': 'Couldn\u2019t create',
      rename: 'Couldn\u2019t rename',
      delete: 'Couldn\u2019t delete',
      move: 'Couldn\u2019t move',
      refresh: 'Couldn\u2019t refresh',
    }
    const successVerb: Record<MnMobileFileOperationAction, string> = {
      'open-document': 'Opened',
      'switch-workspace': 'Switched to',
      'create-workspace': 'Created',
      'create-document': 'Created',
      'create-folder': 'Created',
      rename: 'Renamed',
      delete: 'Deleted',
      move: 'Moved',
      refresh: 'Refreshed',
    }
    const fallbackSubject: Record<MnMobileFileOperationAction, string> = {
      'open-document': 'document',
      'switch-workspace': 'workspace',
      'create-workspace': 'workspace',
      'create-document': 'document',
      'create-folder': 'folder',
      rename: 'item',
      delete: 'item',
      move: 'item',
      refresh: 'documents',
    }
    if (operation.reconciling) {
      return {
        label: `Checking ${subject || fallbackSubject[operation.action]}\u2026`,
        detail: operation.message?.trim() || 'Reading the current files without repeating the operation.',
      }
    }
    const verb = operation.state === 'pending'
      ? pendingVerb[operation.action]
      : operation.state === 'success'
        ? successVerb[operation.action]
        : operation.state === 'indeterminate'
          ? 'Status not confirmed for'
          : errorVerb[operation.action]
    const label = `${verb} ${subject || fallbackSubject[operation.action]}${operation.state === 'pending' ? '\u2026' : ''}`
    const detail = operation.message?.trim()
      || (operation.state === 'pending'
        ? 'Keep this view open while the operation finishes.'
        : operation.state === 'success'
          ? 'The current file list reflects this change.'
          : operation.state === 'indeterminate'
            ? 'Garden may still finish this operation. Check the current files before trying again.'
            : 'Garden rejected this change. Review it before trying again.')
    return { label, detail }
  }

  private operationContinuityState(operation: MnMobileFileOperationFeedback): MnContinuityState {
    if (operation.reconciling) return 'loading'
    if (operation.state === 'success') return 'ready'
    if (operation.state === 'terminal-error' || operation.state === 'indeterminate') return 'error'
    return operation.action === 'rename'
      || operation.action === 'delete'
      || operation.action === 'move'
      || operation.action === 'create-document'
      || operation.action === 'create-folder'
      || operation.action === 'create-workspace'
      ? 'saving'
      : 'loading'
  }

  private operationActionLabel(operation: MnMobileFileOperationFeedback): string {
    if (operation.reconciling) return ''
    if (operation.state === 'terminal-error' && operation.retryable) return 'Retry'
    if (operation.state === 'indeterminate') return 'Check files'
    return ''
  }

  private statusCopy(status: MnMobileFileStatus): { label: string; detail: string; actionLabel: string } {
    const hasContent = this.hasAvailableContent()
    const defaults: Record<MnMobileFileStatus, { label: string; detail: string; actionLabel: string }> = {
      ready: { label: '', detail: '', actionLabel: '' },
      loading: {
        label: hasContent ? 'Refreshing documents\u2026' : 'Loading documents\u2026',
        detail: hasContent ? 'The last available list remains here.' : 'Reading this workspace.',
        actionLabel: '',
      },
      offline: {
        label: 'Offline',
        detail: hasContent ? 'Showing the last available documents.' : 'No saved documents are available.',
        actionLabel: 'Reconnect',
      },
      reconnecting: {
        label: 'Reconnecting\u2026',
        detail: hasContent ? 'The last available documents remain here.' : 'Restoring this workspace.',
        actionLabel: '',
      },
      error: {
        label: hasContent ? 'Couldn\u2019t refresh documents' : 'Documents unavailable',
        detail: hasContent ? 'Showing the last available list.' : 'Try loading this workspace again.',
        actionLabel: 'Retry',
      },
    }
    const copy = defaults[status]
    return {
      label: this.statusLabel.trim() || copy.label,
      detail: this.statusDetail.trim() || copy.detail,
      actionLabel: copy.actionLabel,
    }
  }

  private handleContinuityAction(event: CustomEvent<MnContinuityActionDetail>): void {
    event.stopPropagation()
    if (this.operation?.state === 'terminal-error' && this.operation.retryable) {
      this.emit('mn-mobile-file-retry', { target: 'operation', operationId: this.operation.id })
      return
    }
    if (this.operation?.state === 'indeterminate' && !this.operation.reconciling) {
      this.emit('mn-mobile-file-retry', { target: 'reconcile', operationId: this.operation.id })
      return
    }
    const status = this.effectiveStatus()
    if (status === 'offline') this.emit('mn-mobile-file-reconnect', {})
    else if (status === 'error') this.emit('mn-mobile-file-retry', { target: 'content' })
  }

  private handleWorkspaceContinuityAction(event: CustomEvent<MnContinuityActionDetail>): void {
    event.stopPropagation()
    this.emit('mn-mobile-file-retry', { target: 'workspaces' })
  }

  private renderContinuity() {
    if (this.operation) {
      const copy = this.operationCopy(this.operation)
      return html`
        <mn-continuity-status
          data-scope="operation"
          state=${this.operationContinuityState(this.operation)}
          .label=${copy.label}
          .detail=${copy.detail}
          .actionLabel=${this.operationActionLabel(this.operation)}
          @continuity-action=${this.handleContinuityAction}
        ></mn-continuity-status>
      `
    }
    const status = this.effectiveStatus()
    const copy = this.statusCopy(status)
    return html`
      <mn-continuity-status
        data-scope="content"
        state=${status}
        .label=${copy.label}
        .detail=${copy.detail}
        .actionLabel=${copy.actionLabel}
        @continuity-action=${this.handleContinuityAction}
      ></mn-continuity-status>
    `
  }

  private renderSkeleton() {
    return html`
      <div class="skeleton-list" aria-hidden="true" data-mobile-file-state="loading">
        ${Array.from({ length: 5 }, () => html`
          <div class="skeleton-row">
            <span class="skeleton-icon"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-more"></span>
          </div>
        `)}
      </div>
    `
  }

  private renderUnavailableContent(status: MnMobileFileStatus) {
    if ((status === 'loading' || status === 'reconnecting') && !this.hasAvailableContent()) {
      return this.renderSkeleton()
    }
    if (status === 'offline' && !this.hasAvailableContent()) {
      return html`<div class="empty" data-mobile-file-state="offline">
        <span class="empty-title">Nothing available offline</span>
        <span class="empty-detail">Reconnect to load this workspace\u2019s documents.</span>
      </div>`
    }
    if (status === 'error' && !this.hasAvailableContent()) {
      return html`<div class="empty" data-mobile-file-state="error">
        <span class="empty-title">Couldn\u2019t load documents</span>
        <span class="empty-detail">Your workspace is unchanged. Use Retry above when you\u2019re ready.</span>
      </div>`
    }
    return this.view === 'folders' ? this.renderFolderView() : this.renderRecentsView()
  }

  private renderRenameRow(
    nodeId: string,
    nodeType: MnMobileFileNodeType,
    label: string,
    depth: number,
    readOnly = false,
  ) {
    if (this.renameState?.nodeId !== nodeId) return nothing
    const guidanceId = `${this.branchId(nodeId)}-rename-guidance`
    return html`
      <div class="row" data-renaming="true">
        <form
          class="rename-editor"
          data-rename-for=${nodeId}
          aria-label=${`Rename ${nodeType} “${label}”`}
          @submit=${(event: SubmitEvent) => {
            event.preventDefault()
            this.submitRename()
          }}
        >
          <div class="rename-main" data-depth=${Math.min(depth, 4)}>
            <span class="row-icon" data-type=${nodeType} aria-hidden="true">
              ${icon(nodeType === 'folder' ? 'folder' : readOnly ? 'book-open' : 'file-text', { size: 20 })}
            </span>
            <span class="rename-field">
              <input
                class="rename-input"
                type="text"
                aria-label=${`New name for ${label}`}
                aria-describedby=${guidanceId}
                aria-invalid=${this.renameError ? 'true' : 'false'}
                autocomplete="off"
                enterkeyhint="done"
                .value=${this.renameDraft}
                @input=${this.updateRenameDraft}
                @keydown=${this.handleRenameKeyDown}
              >
              <span
                class="rename-guidance"
                id=${guidanceId}
                data-error=${this.renameError ? 'true' : 'false'}
                role=${this.renameError ? 'alert' : nothing}
              >${this.renameError || 'Enter saves · Escape cancels'}</span>
            </span>
          </div>
          <div class="rename-actions">
            <button type="button" class="rename-action rename-cancel" @click=${() => this.cancelRename()}>Cancel</button>
            <button type="submit" class="rename-action rename-save">Save</button>
          </div>
        </form>
      </div>
    `
  }

  private renderNode(node: MnMobileFileNode, depth = 0): unknown {
    const query = this.searchQuery.toLowerCase().trim()
    const pending = this.isNodePending(node.id)
    if (node.type === 'folder') {
      const shouldExpand = query ? true : this.localExpandedFolders.has(node.id)
      const children = node.children ?? []
      const label = node.label || 'Untitled folder'
      const branchId = this.branchId(node.id)

      return html`
        <div class="tree-branch" data-branch-id=${node.id}>
          ${this.renameState?.nodeId === node.id
            ? this.renderRenameRow(node.id, 'folder', label, depth)
            : html`<div class="row">
            <button
              type="button"
              class="row-primary"
              tabindex="0"
              data-node-id=${node.id}
              data-node-type="folder"
              data-depth=${Math.min(depth, 4)}
              ?disabled=${pending}
              aria-busy=${pending ? 'true' : nothing}
              aria-expanded=${shouldExpand ? 'true' : 'false'}
              aria-controls=${branchId}
              @touchstart=${(event: TouchEvent) => this.startLongPress(
                node.id,
                'folder',
                label,
                event.currentTarget as HTMLElement,
                event,
              )}
              @touchend=${() => this.cancelLongPress()}
              @touchmove=${() => this.cancelLongPress()}
              @touchcancel=${() => this.cancelLongPress()}
              @contextmenu=${(event: MouseEvent) => this.openCtxMenu(
                node.id,
                'folder',
                label,
                event.currentTarget as HTMLElement,
                event,
              )}
              @click=${() => this.activateFolder(node.id)}
            >
              <span class="row-icon" data-type="folder" aria-hidden="true">
                ${icon('folder', { size: 20 })}
              </span>
              <span class="row-body">
                <span class="row-title">${label}</span>
                ${pending ? html`<span class="row-meta row-pending">Working\u2026</span>` : nothing}
              </span>
              <span class="row-chevron" data-expanded=${shouldExpand} aria-hidden="true">
                ${icon('chevron-right', { size: 16 })}
              </span>
            </button>
            ${this.renderMoreButton(node.id, 'folder', label)}
          </div>`}
          <div id=${branchId} role="group" ?hidden=${!shouldExpand}>
            ${shouldExpand ? children.map((child) => this.renderNode(child, depth + 1)) : nothing}
          </div>
        </div>
      `
    }

    if (query && !node.label.toLowerCase().includes(query)) return nothing
    const active = node.id === this.activeDocumentId
    const label = node.label || 'Untitled'
    if (this.renameState?.nodeId === node.id) {
      return this.renderRenameRow(node.id, 'document', label, depth, !!node.readOnly)
    }
    return html`
      <div class="row" data-active=${active}>
        <button
          type="button"
          class="row-primary"
          tabindex="0"
          data-node-id=${node.id}
          data-node-type="document"
          data-depth=${Math.min(depth, 4)}
          data-active=${active}
          ?disabled=${pending}
          aria-busy=${pending ? 'true' : nothing}
          aria-current=${active ? 'page' : nothing}
          @touchstart=${(event: TouchEvent) => this.startLongPress(
            node.id,
            'document',
            label,
            event.currentTarget as HTMLElement,
            event,
          )}
          @touchend=${() => this.cancelLongPress()}
          @touchmove=${() => this.cancelLongPress()}
          @touchcancel=${() => this.cancelLongPress()}
          @contextmenu=${(event: MouseEvent) => this.openCtxMenu(
            node.id,
            'document',
            label,
            event.currentTarget as HTMLElement,
            event,
          )}
          @click=${() => this.activateDocument(node.id, !!node.readOnly)}
        >
          <span class="row-icon" aria-hidden="true">
            ${icon(node.readOnly ? 'book-open' : 'file-text', { size: 20 })}
          </span>
          <span class="row-body">
            <span class="row-title">${label}</span>
            ${pending ? html`<span class="row-meta row-pending">Working\u2026</span>` : nothing}
          </span>
        </button>
        ${this.renderMoreButton(node.id, 'document', label)}
      </div>
    `
  }

  private renderMoreButton(nodeId: string, nodeType: MnMobileFileNodeType, label: string) {
    if (!this.contextMenu) return nothing
    const pending = this.isNodePending(nodeId)
    return html`
      <button
        type="button"
        class="row-more"
        data-action-for=${nodeId}
        aria-label=${`More actions for ${label}`}
        aria-haspopup="dialog"
        ?disabled=${pending}
        @click=${(event: MouseEvent) => {
          event.stopPropagation()
          this.openActionSheet(nodeId, nodeType, label, event.currentTarget as HTMLElement)
        }}
      >
        ${icon('more-horizontal', { size: 20 })}
      </button>
    `
  }

  private renderFolderView() {
    const tree = this.filterTree(this.nodes)
    if (tree.length === 0) {
      return this.searchQuery.trim()
        ? html`<div class="empty" data-mobile-file-state="no-results">
            <span class="empty-title">No matches</span>
            <span class="empty-detail">Try another search term or clear the search.</span>
          </div>`
        : html`<div class="empty" data-mobile-file-state="empty">
            <span class="empty-title">No documents yet</span>
            <span class="empty-detail">Documents created in this workspace will appear here.</span>
          </div>`
    }
    const busy = this.effectiveStatus() === 'loading' || this.effectiveStatus() === 'reconnecting'
    return html`<div class="list" aria-label="Documents" aria-busy=${busy ? 'true' : 'false'}>${tree.map((node) => this.renderNode(node, 0))}</div>`
  }

  private renderRecentsView() {
    const recents = this.recentRows()
    if (recents.length === 0) {
      return this.searchQuery.trim()
        ? html`<div class="empty" data-mobile-file-state="no-results">
            <span class="empty-title">No matches</span>
            <span class="empty-detail">Try another search term or clear the search.</span>
          </div>`
        : html`<div class="empty" data-mobile-file-state="empty">
            <span class="empty-title">No recent documents</span>
            <span class="empty-detail">Documents you open will appear here for quick return.</span>
          </div>`
    }

    const busy = this.effectiveStatus() === 'loading' || this.effectiveStatus() === 'reconnecting'
    return html`
      <div class="list" role="list" aria-label="Recently opened documents" aria-busy=${busy ? 'true' : 'false'}>
        ${recents.map((recent) => {
          const pending = this.isNodePending(recent.docId)
          const label = recent.title || 'Untitled'
          if (this.renameState?.nodeId === recent.docId) {
            return this.renderRenameRow(recent.docId, 'document', label, 0, !!recent.readOnly)
          }
          return html`
          <div class="row" role="listitem" data-active=${recent.docId === this.activeDocumentId}>
            <button
              type="button"
              class="row-primary"
              tabindex="0"
              data-node-id=${recent.docId}
              data-node-type="document"
              data-depth="0"
              data-active=${recent.docId === this.activeDocumentId}
              ?disabled=${pending}
              aria-busy=${pending ? 'true' : nothing}
              aria-current=${recent.docId === this.activeDocumentId ? 'page' : nothing}
              @touchstart=${(event: TouchEvent) => this.startLongPress(
                recent.docId,
                'document',
                label,
                event.currentTarget as HTMLElement,
                event,
              )}
              @touchend=${() => this.cancelLongPress()}
              @touchmove=${() => this.cancelLongPress()}
              @touchcancel=${() => this.cancelLongPress()}
              @contextmenu=${(event: MouseEvent) => this.openCtxMenu(
                recent.docId,
                'document',
                label,
                event.currentTarget as HTMLElement,
                event,
              )}
              @click=${() => this.activateDocument(recent.docId, !!recent.readOnly)}
            >
              <span class="row-icon" aria-hidden="true">
                ${icon(recent.readOnly ? 'book-open' : 'file-text', { size: 20 })}
              </span>
              <span class="row-body">
                <span class="row-title">${label}</span>
                ${pending ? html`<span class="row-meta row-pending">Working\u2026</span>` : nothing}
                ${recent.timestamp ? html`<span class="row-meta">${relativeTime(recent.timestamp)}</span>` : nothing}
              </span>
            </button>
            ${this.renderMoreButton(recent.docId, 'document', label)}
          </div>
        `})}
      </div>
    `
  }

  private renderWsSwitcher() {
    if (!this.workspaceSwitcherOpen) return nothing
    const titleId = `mn-mobile-file-${this.instanceId}-workspace-title`
    const workspaceOperation = this.operation
      && (this.operation.action === 'switch-workspace' || this.operation.action === 'create-workspace')
      ? this.operation
      : null
    const workspaceBusy = this.workspaceLoading || workspaceOperation?.state === 'pending'
    const operationCopy = workspaceOperation ? this.operationCopy(workspaceOperation) : null
    return html`
      <div class="ws-backdrop" aria-hidden="true" @click=${() => this.closeWorkspaceSwitcher()}></div>
      <section
        class="ws-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby=${titleId}
        aria-busy=${workspaceBusy ? 'true' : 'false'}
        tabindex="-1"
        @keydown=${(event: KeyboardEvent) => this.trapDialogFocus(event)}
      >
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="ws-sheet-header">
          <h2 class="sheet-title" id=${titleId}>Workspaces</h2>
          <button
            type="button"
            class="ws-sheet-close"
            aria-label="Close workspace chooser"
            @click=${() => this.closeWorkspaceSwitcher()}
          >
            ${icon('x', { size: 18 })}
          </button>
        </div>
        ${workspaceOperation && operationCopy
          ? html`<mn-continuity-status
              variant="inline"
              data-scope="workspace-operation"
              state=${this.operationContinuityState(workspaceOperation)}
              .label=${operationCopy.label}
              .detail=${operationCopy.detail}
              .actionLabel=${this.operationActionLabel(workspaceOperation)}
              @continuity-action=${this.handleContinuityAction}
            ></mn-continuity-status>`
          : this.workspaceError
            ? html`<mn-continuity-status
                variant="inline"
                data-scope="workspaces"
                state="error"
                label="Workspaces unavailable"
                .detail=${this.workspaceError}
                action-label="Retry"
                @continuity-action=${this.handleWorkspaceContinuityAction}
              ></mn-continuity-status>`
            : this.workspaceLoading
              ? html`<mn-continuity-status
                  variant="inline"
                  data-scope="workspaces"
                  state="loading"
                  label="Loading workspaces\u2026"
                ></mn-continuity-status>`
              : nothing}
        ${this.workspaces.length === 0
          ? !workspaceBusy && !this.workspaceError
            ? html`<div class="ws-empty">No workspaces found</div>`
            : nothing
          : this.workspaces.map((workspace) => {
              const pending = this.isGraphPending(workspace.graphId)
              return html`
                <button
                  type="button"
                  class="ws-item ${workspace.graphId === this.activeGraphId ? 'active' : ''}"
                  data-graph-id=${workspace.graphId}
                  ?disabled=${Boolean(workspace.disabled || workspaceBusy)}
                  aria-busy=${pending ? 'true' : nothing}
                  aria-current=${workspace.graphId === this.activeGraphId ? 'true' : nothing}
                  title=${workspace.disabledReason ?? ''}
                  @click=${() => this.selectGraph(workspace.graphId)}
                >
                  <span aria-hidden="true">${icon('folder', { size: 18 })}</span>
                  <span class="ws-item-name">${workspace.title || workspace.graphId}</span>
                  ${pending
                    ? html`<span class="row-meta row-pending">Working\u2026</span>`
                    : workspace.graphId === this.activeGraphId
                    ? html`<span aria-hidden="true">${icon('check', { size: 16 })}</span>`
                    : nothing}
                </button>
              `})}
        ${this.allowNewWorkspace ? html`
          <div class="ws-divider"></div>
          <button type="button" class="ws-item ws-new" ?disabled=${workspaceBusy} @click=${() => this.createWorkspace()}>
            <span aria-hidden="true">${icon('plus', { size: 18 })}</span>
            <span class="ws-item-name">${workspaceOperation?.action === 'create-workspace' && workspaceOperation.state === 'pending' ? 'Creating workspace\u2026' : 'New Workspace'}</span>
          </button>
        ` : nothing}
      </section>
    `
  }

  private renderCtxMenu() {
    if (!this.ctxMenu) return nothing
    const menu = this.ctxMenu
    const titleId = `mn-mobile-file-${this.instanceId}-action-title`
    return html`
      <div class="ctx-backdrop" aria-hidden="true" @click=${() => this.closeCtxMenu()}></div>
      <section
        class="ctx-sheet ctx-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby=${titleId}
        tabindex="-1"
        @keydown=${(event: KeyboardEvent) => this.trapDialogFocus(event)}
      >
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="ctx-sheet-header">
          <p class="ctx-eyebrow">${menu.nodeType === 'folder' ? 'Folder actions' : 'Document actions'}</p>
          <h2 class="ctx-title" id=${titleId}>${menu.label}</h2>
        </header>
        <button type="button" class="ctx-item" @click=${() => this.beginRename(menu)}>
          <span aria-hidden="true">${icon('pencil', { size: 18 })}</span>
          <span class="ctx-item-copy">
            <span class="ctx-item-label">Rename here</span>
            <span class="ctx-item-detail">Edit “${menu.label}” without leaving Browse.</span>
          </span>
        </button>
        <button type="button" class="ctx-item" @click=${() => this.action('move', menu)}>
          <span aria-hidden="true">${icon('folder', { size: 18 })}</span>
          <span class="ctx-item-copy">
            <span class="ctx-item-label">Move to folder…</span>
            <span class="ctx-item-detail">Choose a new location for “${menu.label}”.</span>
          </span>
        </button>
        <div class="ctx-separator"></div>
        <button
          type="button"
          class="ctx-item"
          data-destructive="true"
          @click=${() => this.action('delete', menu)}
        >
          <span aria-hidden="true">${icon('trash-2', { size: 18 })}</span>
          <span class="ctx-item-copy">
            <span class="ctx-item-label">Delete ${menu.nodeType}</span>
            <span class="ctx-item-detail">${menu.nodeType === 'folder'
              ? `Deletes “${menu.label}” only. Garden will refuse while it contains items.`
              : `Removes “${menu.label}” from this graph. This cannot be undone here.`}</span>
          </span>
        </button>
        <button type="button" class="ctx-item ctx-cancel" @click=${() => this.closeCtxMenu()}>Cancel</button>
      </section>
    `
  }

  private renderSearchRow() {
    return html`
      <div class="search-row" role="search" aria-label="Search documents">
        <span class="search-icon" aria-hidden="true">${icon('folder-search', { size: 18 })}</span>
        <input
          class="search-input"
          type="search"
          aria-label="Search folders and documents"
          placeholder="Search"
          .value=${this.searchQuery}
          @input=${(e: InputEvent) => this.setSearch((e.target as HTMLInputElement).value)}
        >
        <span class="search-clear-slot">
          ${this.searchQuery ? html`
            <button
              type="button"
              class="search-clear"
              aria-label="Clear search"
              @click=${() => this.setSearch('')}
            >
              ${icon('x', { size: 16 })}
            </button>
          ` : nothing}
        </span>
      </div>
    `
  }

  private renderViewToggle() {
    return html`
      <div class="view-toggle" role="group" aria-label="Browse view">
        <button
          type="button"
          class="toggle-btn"
          data-active=${this.view === 'folders'}
          aria-pressed=${this.view === 'folders' ? 'true' : 'false'}
          @click=${() => this.setView('folders')}
        >Folders</button>
        <button
          type="button"
          class="toggle-btn"
          data-active=${this.view === 'recents'}
          aria-pressed=${this.view === 'recents' ? 'true' : 'false'}
          @click=${() => this.setView('recents')}
        >Recents</button>
      </div>
    `
  }

  private renderWorkspaceButton() {
    const pending = this.operation?.state === 'pending'
      && (this.operation.action === 'switch-workspace' || this.operation.action === 'create-workspace')
    return html`
      <button
        type="button"
        class="workspace-btn"
        aria-haspopup="dialog"
        aria-expanded=${this.workspaceSwitcherOpen ? 'true' : 'false'}
        aria-busy=${pending ? 'true' : nothing}
        @click=${(event: MouseEvent) => this.openWorkspaceSwitcher(event.currentTarget as HTMLElement)}
      >
        <span class="workspace-btn-icon" aria-hidden="true">${icon('layers', { size: 18 })}</span>
        <span class="workspace-name">${this.currentGraphTitle || 'No Workspace'}</span>
        <span class="workspace-chevron" aria-hidden="true">${icon('chevron-down', { size: 14 })}</span>
      </button>
    `
  }

  render() {
    const status = this.effectiveStatus()
    return html`
      <div class="mobile-shell">
        ${this.renderWorkspaceButton()}
        ${this.renderViewToggle()}
        ${this.renderSearchRow()}
        ${this.renderContinuity()}
        ${this.renderUnavailableContent(status)}
        ${this.renderCtxMenu()}
        ${this.renderWsSwitcher()}
      </div>
    `
  }
}

function relativeTime(input: number | string | Date): string {
  const timestamp = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input)
  if (!Number.isFinite(timestamp)) return ''
  const delta = Date.now() - timestamp
  const seconds = Math.max(0, Math.floor(delta / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-mobile-file-list': MnMobileFileList
  }
}
