/**
 * Adaptive compact/medium projection for an Organism surface.
 *
 * Garden's mobile shell keeps its editor, chat, and file surfaces mounted while
 * changing which one is visible.  Organism already has the stronger version of
 * that invariant: renderWorkspace owns one keyed editor host and one keyed chat
 * host.  This controller therefore never clones those organisms.  It projects
 * RenderWorkspaceOptions into controlled mobile file/home/tab surfaces and
 * applies a responsive layout to the existing center/right panes.
 *
 * Home, Browse, and Sophia are stable surface roots. A document is a pushed
 * detail inside Home or Browse; changing posture never creates another editor,
 * chat host, store, or provider.
 */

import type {
  MnContinuityState,
  MnContinuityStatus,
  MnHomeOpenDocumentDetail,
  MnHomePinDetail,
  MnHomeView,
  MnMobileDocumentOpenDetail,
  MnMobileFileActionDetail,
  MnMobileFileList,
  MnMobileFileNode,
  MnMobileFileNodeDetail,
  MnMobileFileRetryDetail,
  MnMobileFileSearchDetail,
  MnMobileFileStatus,
  MnMobileTab,
  MnMobileTabDetail,
  MnMobileTabs,
  MnMobileWorkspaceDetail,
} from '@shrubbery/components'
import type {
  RenderWorkspaceOptions,
  SidebarNode,
  SidebarNodeDetail,
} from '@shrubbery/runtime'
import type { ShellContext } from './shell-context.js'
import type { ShellFeature } from './shell-feature-host.js'

const ADAPTIVE_BREAKPOINT = '(max-width: 1024px)'
const COMPACT_BREAKPOINT = '(max-width: 600px)'
const KEYBOARD_THRESHOLD_PX = 150
const STYLE_ID = 'organism-mobile-shell-styles'

export type MobileCenterMode = 'document' | 'home'
export type MobilePosture = 'compact' | 'medium' | 'expanded'
export type MobileView = 'root' | 'document'

type DocumentRoot = Extract<MnMobileTab, 'home' | 'browse'>

interface MobileDocumentRoute {
  readonly documentId: string
  readonly title: string
  readonly homeDocument?: MnHomeOpenDocumentDetail['document']
}

interface VisualViewportLike extends EventTarget {
  readonly height: number
  readonly width: number
}

export interface MobileShellEnvironment {
  readonly matchMedia?: (query: string) => MediaQueryList
  readonly visualViewport?: VisualViewportLike | null
  readonly innerHeight?: () => number
  readonly innerWidth?: () => number
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number
  readonly vibrate?: (pattern: number | number[]) => boolean
}

export interface MobileShellState {
  readonly mobile: boolean
  readonly posture: MobilePosture
  readonly activeRoot: MnMobileTab
  readonly view: MobileView
  /** @deprecated Use activeRoot. */
  readonly activeTab: MnMobileTab
  /** @deprecated Use view. */
  readonly centerMode: MobileCenterMode
  readonly keyboardOpen: boolean
  readonly modalOpen: boolean
  readonly documentId: string | null
}

interface OverlayStateDetail {
  readonly id: string
  readonly open: boolean
  readonly modality?: string
}

type MobileContinuityAction = 'none' | 'refresh-documents' | 'back'

interface MobileContinuityPresentation {
  readonly visible: boolean
  readonly state: MnContinuityState
  readonly label: string
  readonly detail: string
  readonly actionLabel: string
  readonly action: MobileContinuityAction
  readonly retainHomeContent: boolean
}

interface MobileFileContinuityPresentation {
  readonly status: MnMobileFileStatus
  readonly label: string
  readonly detail: string
}

function activeEditorState(snapshot: Readonly<RenderWorkspaceOptions>) {
  if (snapshot.editorHost) return snapshot.editorHost.get()
  const center = snapshot.centerPanes
  if (!center) return null
  return center.editorHosts.get(center.projection.activePaneId)?.binding.get() ?? null
}

function hasHomeContent(home: RenderWorkspaceOptions['mobileHome']): boolean {
  if (!home) return false
  return Boolean(
    home.resume
    || home.dreamJournal
    || home.pinned?.length
    || home.newlyCreated?.length
    || home.recent?.length,
  )
}

function quietContinuity(retainHomeContent = false): MobileContinuityPresentation {
  return {
    visible: false,
    state: 'ready',
    label: '',
    detail: '',
    actionLabel: '',
    action: 'none',
    retainHomeContent,
  }
}

function projectMobileFileContinuity(
  snapshot: Readonly<RenderWorkspaceOptions>,
): MobileFileContinuityPresentation {
  const source = snapshot.sidebar?.status ?? 'ready'
  const retained = (snapshot.sidebar?.sections ?? [])
    .some(section => Boolean(section.nodes?.length))
  if (source === 'idle' || source === 'loading') {
    return {
      status: 'loading',
      label: retained ? 'Refreshing documents' : '',
      detail: retained ? 'The current list remains available.' : '',
    }
  }
  if (source === 'reconnecting') {
    return {
      status: 'reconnecting',
      label: 'Reconnecting',
      detail: retained ? 'The current list remains available.' : '',
    }
  }
  if (source === 'disconnected') {
    return {
      status: 'offline',
      label: retained ? 'Showing offline documents' : 'Documents are offline',
      detail: retained ? 'The last loaded list remains available.' : '',
    }
  }
  if (source === 'error') {
    return {
      status: 'error',
      label: retained ? 'Showing last loaded documents' : 'Documents are unavailable',
      detail: retained
        ? 'Refresh failed. The last loaded list remains available.'
        : snapshot.sidebar?.error || '',
    }
  }
  return { status: 'ready', label: '', detail: '' }
}

/**
 * Project the shell's existing controlled snapshot into continuity feedback.
 * This never guesses from a Tauri/browser transport and never owns retry state:
 * it reads the active resource binding and emits only intents the shell already
 * exposes (refresh the document projection or return to the preserved root).
 */
export function projectMobileContinuity(
  snapshot: Readonly<RenderWorkspaceOptions>,
  root: MnMobileTab,
  view: MobileView,
  title: string,
): MobileContinuityPresentation {
  if (root === 'sophia') return quietContinuity()

  if (view === 'document') {
    const editor = activeEditorState(snapshot)
    if (editor?.status === 'error') {
      return {
        visible: true,
        state: 'error',
        label: `Couldn’t open ${title}`,
        detail: editor.error || 'The document is still in your workspace.',
        actionLabel: 'Back',
        action: 'back',
        retainHomeContent: false,
      }
    }
    if (editor?.status === 'loading' || editor?.status === 'idle') {
      return {
        visible: true,
        state: 'loading',
        label: `Opening ${title}`,
        detail: 'Keeping your place while the document becomes ready.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: false,
      }
    }

    const sync = snapshot.chrome?.syncState ?? 'idle'
    if (sync === 'error') {
      return {
        visible: true,
        state: 'error',
        label: 'Sync unavailable',
        detail: 'The document remains open, but Garden could not confirm synchronization.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: false,
      }
    }
    if (sync === 'disconnected') {
      return {
        visible: true,
        state: 'offline',
        label: 'Garden is disconnected',
        detail: 'The document remains open, but this room is no longer trying to connect.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: false,
      }
    }
    if (sync === 'reconnecting') {
      return {
        visible: true,
        state: 'reconnecting',
        label: 'Reconnecting to Garden',
        detail: 'Your document stays in place while Garden reconnects.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: false,
      }
    }
    if (sync === 'connecting') {
      return {
        visible: true,
        state: 'loading',
        label: 'Connecting to Garden',
        detail: 'Keeping your place while the document room opens.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: false,
      }
    }
    return quietContinuity()
  }

  if (root === 'home') {
    const home = snapshot.mobileHome ?? snapshot.home ?? null
    const retained = hasHomeContent(home)
    if (home?.status === 'error') {
      return {
        visible: true,
        state: 'error',
        label: retained ? 'Showing last loaded Home items' : 'Home is unavailable',
        detail: retained
          ? 'Garden couldn’t refresh them. Your existing documents remain available.'
          : home.error || 'Garden couldn’t load this workspace.',
        actionLabel: 'Try again',
        action: 'refresh-documents',
        retainHomeContent: retained,
      }
    }
    if (home?.status === 'loading' && retained) {
      return {
        visible: true,
        state: 'loading',
        label: 'Refreshing Home',
        detail: 'Your existing documents remain available.',
        actionLabel: '',
        action: 'none',
        retainHomeContent: true,
      }
    }
    return quietContinuity(retained)
  }

  // Browse owns a component-local continuity surface so status remains adjacent
  // to the list it qualifies. The shell still controls every prop and intent.
  return quietContinuity()
}

function mobileNode(node: SidebarNode): MnMobileFileNode | null {
  if (node.kind !== 'folder' && node.kind !== 'document') return null
  return {
    id: node.id,
    label: node.label,
    type: node.kind,
    readOnly: node.readOnly,
    children: (node.children ?? [])
      .map(mobileNode)
      .filter((entry): entry is MnMobileFileNode => entry !== null),
  }
}

function flattenNodes(nodes: readonly SidebarNode[]): SidebarNode[] {
  const result: SidebarNode[] = []
  for (const node of nodes) {
    result.push(node)
    result.push(...flattenNodes(node.children ?? []))
  }
  return result
}

function graphTitle(context: ShellContext<unknown>, snapshot: Readonly<RenderWorkspaceOptions>): string {
  return snapshot.chrome?.breadcrumbs?.find((crumb) => crumb.kind === 'graph')?.label
    ?? context.graphId
}

function documentTitle(
  context: ShellContext<unknown>,
  snapshot: Readonly<RenderWorkspaceOptions>,
): string {
  if (!context.documentId) return 'Garden'
  return snapshot.chrome?.breadcrumbs?.find((crumb) => crumb.kind === 'document')?.label
    ?? flattenNodes(snapshot.sidebar?.sections?.flatMap((section) => section.nodes ?? []) ?? [])
      .find((node) => node.id === context.documentId)?.label
    ?? context.documentId
}

function createButton(doc: Document, className: string, label: string, text: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.textContent = text
  return button
}

const MOBILE_CSS = `
  body[data-organism-mobile-shell-active] {
    --organism-safe-area-top: env(safe-area-inset-top, 0px);
    --organism-safe-area-bottom: env(safe-area-inset-bottom, 0px);
    --organism-mobile-header-height: 56px;
    --organism-mobile-navigation-height: 64px;
    --organism-mobile-content-top: calc(
      var(--organism-safe-area-top) + var(--organism-mobile-header-height)
    );
    --organism-mobile-content-bottom: calc(
      var(--organism-safe-area-bottom) + var(--organism-mobile-navigation-height)
    );
    /* Keep the document in stable layout-viewport coordinates. WebKit owns the
       visual origin while the fixed shell roots below consume only the settled
       visual width/height; shrinking or fixing the whole body makes Safari's
       native caret-reveal pan move the entire application plane. */
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    overscroll-behavior: none;
  }
  body[data-organism-mobile-shell-active] > .editor-pane,
  body[data-organism-mobile-shell-active] > .shell-pane > .label-strip {
    display: none !important;
  }
  body[data-organism-mobile-shell-active] > .shell-pane {
    position: fixed !important;
    inset: 0 auto auto 0 !important;
    width: var(--organism-vvw, 100vw) !important;
    height: var(--organism-vvh, 100dvh) !important;
  }
  [data-organism-mobile-shell='true'] {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    background: var(--mn-color-surface-canvas, var(--mn-color-surface-base, #fff));
  }
  [data-organism-mobile-shell='true'] > .app-container {
    position: absolute !important;
    inset: var(--organism-mobile-content-top) 0 var(--organism-mobile-content-bottom) !important;
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-continuity='true'] > .app-container {
    top: calc(
      var(--organism-mobile-content-top) + var(--organism-mobile-continuity-height, 72px)
    ) !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-keyboard='true'] > .app-container {
    bottom: 0 !important;
  }
  /* The frame controller's html-level keyboard flag is the single writer for
     IME posture; honor it even if this controller's own detector lost the
     race, or the tab-bar clearance floats as a dead band above the keyboard. */
  html[data-organism-viewport-keyboard] [data-organism-mobile-shell='true'] > .app-container {
    bottom: 0 !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-root='sophia'] > .app-container {
    top: 0 !important;
  }
  [data-organism-mobile-shell='true'] > .app-container > header,
  [data-organism-mobile-shell='true'] > .app-container > footer {
    display: none !important;
  }
  [data-organism-mobile-shell='true'] .main {
    position: relative !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }
  [data-organism-mobile-shell='true'] .main sl-split-panel {
    display: contents !important;
    --divider-width: 0px !important;
  }
  [data-organism-mobile-shell='true'] .main sl-split-panel::part(divider),
  [data-organism-mobile-shell='true'] .main sh-workspace-surface [data-layout-surface-dividers],
  [data-organism-mobile-shell='true'] .main > .collapse-rail,
  [data-organism-mobile-shell='true'] .main .panel-edge-btn,
  [data-organism-mobile-shell='true'] .main .panel-edge-btns {
    display: none !important;
  }
  [data-organism-mobile-shell='true'] .main .split-pane {
    display: none !important;
  }
  [data-organism-mobile-shell='true'] .main sh-workspace-surface [data-layout-node-kind='leaf'] {
    display: none !important;
  }
  [data-organism-mobile-shell='true'] .main sh-workspace-surface {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-view='document']
    .main sh-workspace-surface [data-surface-part='center-content'][data-active='true'] {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-root='sophia']
    .main sh-workspace-surface [data-surface-part='right-panel'] {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-root='sophia']
    .main sh-workspace-surface [data-surface-part='right-panel'] > .right-panel {
    display: flex !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    border: 0 !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-view='document']
    .main .split-pane[data-role='center']:not([data-layout-node-kind]) {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-root='sophia']
    .main .split-pane[data-role='right']:not([data-layout-node-kind]) {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-root='sophia']
    .main .right-panel {
    display: flex !important;
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    border: 0 !important;
  }
  [data-organism-mobile-shell='true'] #mn-editor-host {
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-organism-mobile-shell='true'][data-mobile-view='document'] #mn-editor-host {
    visibility: visible !important;
    pointer-events: auto !important;
  }
  .organism-mobile-shell {
    position: fixed;
    inset: 0 auto auto 0;
    /* A delivery form, not a modal: host dialogs and sheets must remain above it. */
    z-index: var(--mn-z-delivery-shell, 700);
    display: none;
    width: var(--organism-vvw, 100vw);
    height: var(--organism-vvh, 100dvh);
    overflow: hidden;
    pointer-events: none;
    color: var(--mn-color-text-primary, #1f2933);
    font-family: var(--mn-font-utility, system-ui, sans-serif);
  }
  .organism-mobile-shell[data-active='true'] { display: block; }
  .organism-mobile-shell[data-root='sophia'] .organism-mobile-top-bar {
    display: none;
  }
  .organism-mobile-top-bar {
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    align-items: center;
    height: var(--organism-mobile-content-top);
    padding: var(--organism-safe-area-top) 4px 0;
    border-bottom: 1px solid var(--mn-top-bar-border, var(--mn-color-rule, var(--mn-color-border-default, #ddd)));
    background: var(--mn-top-bar-bg, var(--mn-color-surface-chrome, var(--mn-color-surface-base, #fff)));
    box-shadow: var(--mn-shadow-chrome, none);
    color: var(--mn-top-bar-text, var(--mn-color-text-primary, #1f2933));
    pointer-events: auto;
  }
  .organism-mobile-back,
  .organism-mobile-search {
    display: flex;
    flex: 0 0 48px;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--mn-top-bar-text-muted, currentColor);
    font: inherit;
    font-size: 24px;
    touch-action: manipulation;
    transition:
      color var(--mn-transition-fast, 110ms ease),
      background var(--mn-transition-fast, 110ms ease);
  }
  .organism-mobile-back:active,
  .organism-mobile-search:active {
    background: var(--mn-color-interactive-active, rgba(34, 68, 53, 0.1));
    color: var(--mn-top-bar-text, currentColor);
  }
  .organism-mobile-back:focus-visible,
  .organism-mobile-search:focus-visible {
    outline: var(--mn-focus-ring-width, 2px) solid var(--mn-focus-ring-color, currentColor);
    outline-offset: -4px;
  }
  .organism-mobile-back[hidden],
  .organism-mobile-search[hidden] { visibility: hidden; display: flex; }
  .organism-mobile-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0 4px;
    font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
    font-size: var(--mn-type-heading-size, 18px);
    font-weight: var(--mn-font-weight-semibold, 600);
    letter-spacing: -0.018em;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .organism-mobile-continuity {
    position: absolute;
    inset: var(--organism-mobile-content-top) 0 auto;
    z-index: 3;
    display: none;
    min-height: var(--organism-mobile-continuity-height, 72px);
    pointer-events: auto;
  }
  .organism-mobile-continuity[data-visible='true'] { display: block; }
  .organism-mobile-continuity > mn-continuity-status {
    min-height: var(--organism-mobile-continuity-height, 72px);
  }
  .organism-mobile-files,
  .organism-mobile-home {
    position: absolute;
    inset: var(--organism-mobile-content-top) 0 var(--organism-mobile-content-bottom);
    display: none;
    min-height: 0;
    overflow: hidden;
    background-color: var(--mn-color-surface-canvas, var(--mn-color-surface-base, #fff));
    background-image: var(--mn-atmosphere, none);
    pointer-events: auto;
  }
  .organism-mobile-shell[data-keyboard='true'] .organism-mobile-files,
  .organism-mobile-shell[data-keyboard='true'] .organism-mobile-home {
    bottom: 0;
  }
  .organism-mobile-files[data-visible='true'],
  .organism-mobile-home[data-visible='true'] { display: flex; }
  .organism-mobile-shell[data-continuity='true'] .organism-mobile-files,
  .organism-mobile-shell[data-continuity='true'] .organism-mobile-home {
    top: calc(
      var(--organism-mobile-content-top) + var(--organism-mobile-continuity-height, 72px)
    );
  }
  .organism-mobile-files > mn-mobile-file-list,
  .organism-mobile-home > mn-home-view {
    flex: 1;
    width: 100%;
    min-height: 0;
  }
  .organism-mobile-shell[data-posture='medium'] .organism-mobile-files > mn-mobile-file-list,
  .organism-mobile-shell[data-posture='medium'] .organism-mobile-home > mn-home-view {
    max-width: 760px;
    margin-inline: auto;
    border-inline: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, transparent));
    background: var(--mn-color-surface-base, #fff);
    box-shadow: var(--mn-shadow-xs, none);
  }
  .organism-mobile-shell > mn-mobile-tabs {
    position: absolute;
    inset: auto 0 0;
    display: block;
    pointer-events: auto;
  }
  .organism-mobile-shell[data-keyboard='true'] > mn-mobile-tabs { display: none; }
  .organism-mobile-shell[data-modal='true'] > mn-mobile-tabs { display: none; }
  @media (min-width: 601px) {
    body[data-organism-mobile-shell-active],
    .organism-mobile-shell {
      --organism-mobile-continuity-height: 48px;
    }
  }
`

export class OrganismMobileShellController<TContract = unknown> {
  private readonly environment: Required<Pick<MobileShellEnvironment,
    'matchMedia' | 'innerHeight' | 'innerWidth' | 'requestAnimationFrame'>> & MobileShellEnvironment
  private adaptiveMedia: MediaQueryList | null = null
  private compactMedia: MediaQueryList | null = null
  private viewport: VisualViewportLike | null = null
  private host: HTMLElement | null = null
  private portal: HTMLDivElement | null = null
  private fileList: MnMobileFileList | null = null
  private tabs: MnMobileTabs | null = null
  private title: HTMLSpanElement | null = null
  private backButton: HTMLButtonElement | null = null
  private searchButton: HTMLButtonElement | null = null
  private continuityPanel: HTMLDivElement | null = null
  private continuityStatus: MnContinuityStatus | null = null
  private continuityAction: MobileContinuityAction = 'none'
  private filesPanel: HTMLDivElement | null = null
  private homePanel: HTMLDivElement | null = null
  private homeView: MnHomeView | null = null
  private snapshot: Readonly<RenderWorkspaceOptions> = {}
  private context: ShellContext<TContract> | null = null
  private activeRoot: MnMobileTab = 'home'
  private rootDocuments: Record<DocumentRoot, MobileDocumentRoute | null> = {
    home: null,
    browse: null,
  }
  private keyboardOpen = false
  private lastDocumentId: string | null = null
  private lastDocumentTitle = ''
  private lastGraphId: string | null = null
  private observedDocumentId: string | null = null
  private expandedFolders = new Set<string>()
  private readonly activeModalOverlays = new Set<string>()
  private viewportUpdateScheduled = false
  private destroyed = false

  constructor(environment: MobileShellEnvironment = {}) {
    const win = globalThis.window
    this.environment = {
      ...environment,
      matchMedia: environment.matchMedia ?? ((query) => win.matchMedia(query)),
      innerHeight: environment.innerHeight ?? (() => win.innerHeight),
      innerWidth: environment.innerWidth ?? (() => win.innerWidth),
      requestAnimationFrame: environment.requestAnimationFrame
        ?? ((callback) => win.requestAnimationFrame(callback)),
      visualViewport: environment.visualViewport === undefined
        ? (win.visualViewport as VisualViewportLike | null)
        : environment.visualViewport,
      vibrate: environment.vibrate ?? ((pattern) => win.navigator.vibrate?.(pattern) ?? false),
    }
  }

  get state(): MobileShellState {
    const view = this.currentView()
    return Object.freeze({
      mobile: this.adaptiveMedia?.matches ?? false,
      posture: this.posture(),
      activeRoot: this.activeRoot,
      view,
      activeTab: this.activeRoot,
      centerMode: view === 'document' ? 'document' : 'home',
      keyboardOpen: this.keyboardOpen,
      modalOpen: this.activeModalOverlays.size > 0,
      documentId: this.context?.documentId ?? null,
    })
  }

  private posture(): MobilePosture {
    if (!(this.adaptiveMedia?.matches ?? false)) return 'expanded'
    return this.compactMedia?.matches ?? false ? 'compact' : 'medium'
  }

  private currentView(): MobileView {
    if (this.activeRoot === 'sophia') return 'root'
    return this.rootDocuments[this.activeRoot] ? 'document' : 'root'
  }

  private activeDocumentRoute(): MobileDocumentRoute | null {
    if (this.activeRoot === 'sophia') return null
    return this.rootDocuments[this.activeRoot]
  }

  private readonly onMediaChange = (): void => this.applyResponsiveState()
  private readonly onOverlayStateChange = (event: Event): void => {
    const detail = (event as CustomEvent<OverlayStateDetail>).detail
    if (!detail || detail.modality !== 'modal' || typeof detail.id !== 'string') return
    if (detail.open) this.activeModalOverlays.add(detail.id)
    else this.activeModalOverlays.delete(detail.id)
    this.applyProjection()
  }
  private applyViewportRect(): void {
    if (!this.viewport) return
    const innerHeight = this.environment.innerHeight()
    const keyboardOpen = this.viewport.height < innerHeight - KEYBOARD_THRESHOLD_PX
    const keyboardPostureChanged = keyboardOpen !== this.keyboardOpen
    this.keyboardOpen = keyboardOpen

    // While the keyboard is open the settled visual size is authoritative.
    // Once it closes, DROP the pixel override entirely: the 100dvh/100vw
    // fallbacks track Safari's toolbar animation in the compositor (also
    // clearing any stale short visualViewport left after dismissal), while a
    // sampled pixel height would lag it and drag the bottom chrome on scroll.
    const style = this.host?.ownerDocument.documentElement.style
    if (this.keyboardOpen) {
      style?.setProperty('--organism-vvh', `${this.viewport.height}px`)
      style?.setProperty('--organism-vvw', `${this.viewport.width}px`)
    } else {
      style?.removeProperty('--organism-vvh')
      style?.removeProperty('--organism-vvw')
    }
    // Geometry-only keyboard animation frames are handled by CSS and the
    // Surface ResizeObserver. Reprojecting the whole mobile portal here would
    // also force an editor update for every visualViewport scroll/resize step.
    if (keyboardPostureChanged) this.applyProjection()
  }
  private readonly onViewportChange = (): void => {
    if (this.viewportUpdateScheduled || this.destroyed) return
    this.viewportUpdateScheduled = true
    this.environment.requestAnimationFrame(() => {
      if (this.destroyed) {
        this.viewportUpdateScheduled = false
        return
      }
      // WebKit can dispatch the first visualViewport event before its geometry
      // has caught up with the keyboard. Sample after a second paint so a
      // transient stale height cannot project a blank band.
      this.environment.requestAnimationFrame(() => {
        this.viewportUpdateScheduled = false
        if (this.destroyed) return
        this.applyViewportRect()
      })
    })
  }

  private ensureLifecycle(context: ShellContext<TContract>): void {
    if (this.adaptiveMedia || this.destroyed) return
    this.host = context.host
    this.adaptiveMedia = this.environment.matchMedia(ADAPTIVE_BREAKPOINT)
    this.compactMedia = this.environment.matchMedia(COMPACT_BREAKPOINT)
    this.adaptiveMedia.addEventListener('change', this.onMediaChange)
    this.compactMedia.addEventListener('change', this.onMediaChange)
    context.host.ownerDocument.addEventListener(
      'mn-overlay-state-change',
      this.onOverlayStateChange,
    )
    this.viewport = this.environment.visualViewport ?? null
    this.viewport?.addEventListener('resize', this.onViewportChange)
    this.viewport?.addEventListener('scroll', this.onViewportChange)
    if (this.viewport) this.applyViewportRect()
  }

  private ensurePortal(): void {
    if (this.portal || !this.host) return
    const doc = this.host.ownerDocument
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = MOBILE_CSS
      doc.head.append(style)
    }

    const portal = doc.createElement('div')
    portal.className = 'organism-mobile-shell'
    portal.dataset.active = 'false'
    portal.setAttribute('aria-label', 'Mobile workspace')

    const top = doc.createElement('header')
    top.className = 'organism-mobile-top-bar'
    const back = createButton(doc, 'organism-mobile-back', 'Back', '‹')
    const title = doc.createElement('span')
    title.className = 'organism-mobile-title'
    const search = createButton(doc, 'organism-mobile-search', 'Search documents', '⌕')
    top.append(back, title, search)

    const continuityPanel = doc.createElement('div')
    continuityPanel.className = 'organism-mobile-continuity'
    const continuityStatus = doc.createElement('mn-continuity-status') as MnContinuityStatus
    continuityPanel.append(continuityStatus)

    const files = doc.createElement('div')
    files.className = 'organism-mobile-files'
    const fileList = doc.createElement('mn-mobile-file-list') as MnMobileFileList
    files.append(fileList)

    const home = doc.createElement('div')
    home.className = 'organism-mobile-home'
    const homeView = doc.createElement('mn-home-view') as MnHomeView
    home.append(homeView)

    const tabs = doc.createElement('mn-mobile-tabs') as MnMobileTabs
    portal.append(top, continuityPanel, files, home, tabs)
    doc.body.append(portal)

    back.addEventListener('click', () => this.navigateBack())
    search.addEventListener('click', () => {
      doc.dispatchEvent(new CustomEvent('open-document-switcher', { bubbles: true, composed: true }))
    })
    tabs.addEventListener('navigation-change', (event) => {
      this.changeRoot((event as CustomEvent<MnMobileTabDetail>).detail.tab)
    })
    fileList.addEventListener('document-open', (event) => {
      this.openDocument((event as CustomEvent<MnMobileDocumentOpenDetail>).detail)
    })
    fileList.addEventListener('mn-mobile-file-search-change', (event) => {
      this.snapshot.sidebar?.onSearchChange?.(
        (event as CustomEvent<MnMobileFileSearchDetail>).detail,
      )
    })
    fileList.addEventListener('mn-mobile-folder-toggle', (event) => {
      this.toggleFolder((event as CustomEvent<MnMobileFileNodeDetail>).detail.nodeId)
    })
    fileList.addEventListener('mn-mobile-file-action', (event) => {
      this.handleFileAction((event as CustomEvent<MnMobileFileActionDetail>).detail)
    })
    fileList.addEventListener('mn-mobile-file-reconnect', () => {
      this.refreshDocumentProjection()
    })
    fileList.addEventListener('mn-mobile-file-retry', (event) => {
      const detail = (event as CustomEvent<MnMobileFileRetryDetail>).detail
      if (detail.target === 'content') this.refreshDocumentProjection()
      else if (detail.target === 'workspaces') this.snapshot.chrome?.onWorkspaceRefresh?.()
      else {
        this.snapshot.sidebar?.onOperationRecovery?.({
          operationId: detail.operationId,
          action: detail.target === 'reconcile' ? 'reconcile' : 'retry',
        })
      }
    })
    fileList.addEventListener('mn-mobile-workspace-open', () => {
      if (this.snapshot.chrome?.workspaceStatus !== 'loading') {
        this.snapshot.chrome?.onWorkspaceRefresh?.()
      }
    })
    fileList.addEventListener('mn-mobile-workspace-select', (event) => {
      this.selectWorkspace((event as CustomEvent<MnMobileWorkspaceDetail>).detail.graphId)
    })
    fileList.addEventListener('mn-mobile-workspace-create', () => {
      this.snapshot.chrome?.onWorkspaceCreate?.()
    })
    homeView.addEventListener('mn-home-new-document', () => {
      this.mobileHome()?.onNewDocument?.()
    })
    homeView.addEventListener('mn-home-open-document', (event) => {
      this.openHomeDocument((event as CustomEvent<MnHomeOpenDocumentDetail>).detail)
    })
    homeView.addEventListener('mn-home-pin-document', (event) => {
      const detail = (event as CustomEvent<MnHomePinDetail>).detail
      this.mobileHome()?.onPinDocument?.(detail.document, detail.pinned)
    })
    homeView.addEventListener('daily-note-open-request', (event) => {
      this.snapshot.dailyNotes?.onOpenDate?.(
        (event as CustomEvent<{ readonly dateKey: string }>).detail,
      )
    })
    homeView.addEventListener('daily-note-calendar-anchor-request', (event) => {
      this.snapshot.dailyNotes?.onCalendarAnchor?.(
        (event as CustomEvent<{ readonly anchor: HTMLElement }>).detail,
      )
    })
    continuityStatus.addEventListener('continuity-action', () => this.handleContinuityAction())

    this.portal = portal
    this.fileList = fileList
    this.tabs = tabs
    this.title = title
    this.backButton = back
    this.searchButton = search
    this.continuityPanel = continuityPanel
    this.continuityStatus = continuityStatus
    this.filesPanel = files
    this.homePanel = home
    this.homeView = homeView
  }

  private nodes(): readonly SidebarNode[] {
    return this.snapshot.sidebar?.sections?.flatMap((section) => section.nodes ?? []) ?? []
  }

  private mobileHome() {
    return this.snapshot.mobileHome ?? this.snapshot.home ?? null
  }

  private openHomeDocument(detail: MnHomeOpenDocumentDetail): void {
    const { document } = detail
    this.lastDocumentId = document.documentId
    this.lastDocumentTitle = document.title
    this.activeRoot = 'home'
    this.rootDocuments.home = {
      documentId: document.documentId,
      title: document.title,
      homeDocument: document,
    }
    this.applyProjection()
    const home = this.mobileHome()
    if (home?.onOpenDocument) {
      home.onOpenDocument(document)
      return
    }
    const node = flattenNodes(this.nodes()).find(candidate => candidate.id === document.documentId)
    if (node) this.snapshot.sidebar?.onNodeOpen?.({ id: node.id, node })
  }

  private handleFileAction(detail: MnMobileFileActionDetail): void {
    const node = flattenNodes(this.nodes()).find(candidate => candidate.id === detail.nodeId)
    if (!node || (node.kind !== 'folder' && node.kind !== 'document')) return
    if (node.disabled) return
    this.environment.vibrate?.(30)
    this.snapshot.sidebar?.onAction?.({
      action: detail.action,
      nodeId: node.id,
      node,
      ...(detail.proposedLabel === undefined ? {} : { proposedLabel: detail.proposedLabel }),
    })
  }

  private handleContinuityAction(): void {
    if (this.continuityAction === 'back') {
      this.navigateBack()
      return
    }
    if (this.continuityAction !== 'refresh-documents') return
    this.refreshDocumentProjection()
  }

  private refreshDocumentProjection(): void {
    if (this.snapshot.sidebar?.onAction) {
      this.snapshot.sidebar.onAction({ action: 'refresh' })
      return
    }
    this.snapshot.chrome?.onWorkspaceRefresh?.()
  }

  private selectWorkspace(graphId: string): void {
    const workspace = this.snapshot.chrome?.workspaces
      ?.find(candidate => candidate.graphId === graphId)
    if (!workspace || workspace.disabled) return
    this.snapshot.chrome?.onWorkspaceSelect?.(workspace)
  }

  private changeRoot(root: MnMobileTab): void {
    if (root === this.activeRoot) return
    this.activeRoot = root
    this.environment.vibrate?.(8)
    this.applyProjection()
    this.restoreActiveRootResource()
  }

  private restoreActiveRootResource(): void {
    const route = this.activeDocumentRoute()
    if (!route || route.documentId === this.context?.documentId) return
    if (this.activeRoot === 'home' && route.homeDocument) {
      const home = this.mobileHome()
      if (home?.onOpenDocument) {
        home.onOpenDocument(route.homeDocument)
        return
      }
    }
    const node = flattenNodes(this.nodes()).find(candidate => candidate.id === route.documentId)
    if (node) this.snapshot.sidebar?.onNodeOpen?.({ id: node.id, node })
  }

  private navigateBack(): void {
    if (this.activeRoot === 'sophia' || !this.rootDocuments[this.activeRoot]) return
    this.rootDocuments[this.activeRoot] = null
    this.applyProjection()
  }

  private openDocument(detail: MnMobileDocumentOpenDetail): void {
    const node = flattenNodes(this.nodes()).find((candidate) => candidate.id === detail.documentId)
    if (!node) return
    this.lastDocumentId = detail.documentId
    this.lastDocumentTitle = node.label
    this.activeRoot = 'browse'
    this.rootDocuments.browse = {
      documentId: detail.documentId,
      title: node.label,
    }
    this.applyProjection()
    this.snapshot.sidebar?.onNodeOpen?.({ id: node.id, node } as SidebarNodeDetail)
  }

  private toggleFolder(nodeId: string): void {
    const node = flattenNodes(this.nodes()).find((candidate) => candidate.id === nodeId)
    if (!node || node.kind !== 'folder') return
    if (this.expandedFolders.has(nodeId)) this.expandedFolders.delete(nodeId)
    else this.expandedFolders.add(nodeId)
    this.snapshot.sidebar?.onNodeToggle?.({ id: node.id, node })
  }

  private applyResponsiveState(): void {
    const active = this.adaptiveMedia?.matches ?? false
    if (this.host) {
      this.host.dataset.organismMobileShell = String(active)
      if (!active) {
        delete this.host.dataset.mobileRoot
        delete this.host.dataset.mobileView
        delete this.host.dataset.mobilePosture
        delete this.host.dataset.mobileKeyboard
        delete this.host.dataset.mobileContinuity
      }
      this.host.ownerDocument.body.toggleAttribute('data-organism-mobile-shell-active', active)
    }
    if (this.portal) {
      this.portal.dataset.active = String(active)
      this.portal.dataset.posture = this.posture()
    }
    this.applyProjection()
  }

  private applyProjection(): void {
    if (!this.host || !this.portal || !this.context) return
    const active = this.adaptiveMedia?.matches ?? false
    const posture = this.posture()
    const view = this.currentView()
    const route = this.activeDocumentRoute()
    const home = this.mobileHome()
    const title = route
      ? route.title
      : this.activeRoot === 'sophia'
        ? 'Sophia'
        : this.activeRoot === 'browse'
          ? 'Browse'
          : graphTitle(this.context as ShellContext<unknown>, this.snapshot)
    const sync = this.snapshot.chrome?.syncState ?? 'idle'
    const fileContinuity = projectMobileFileContinuity(this.snapshot)
    const continuity = projectMobileContinuity(
      this.snapshot,
      this.activeRoot,
      view,
      title,
    )

    this.host.dataset.organismMobileShell = String(active)
    this.host.dataset.mobileRoot = this.activeRoot
    this.host.dataset.mobileView = view
    this.host.dataset.mobilePosture = posture
    this.host.dataset.mobileKeyboard = String(this.keyboardOpen)
    this.host.dataset.mobileContinuity = String(continuity.visible)
    this.portal.dataset.active = String(active)
    this.portal.dataset.keyboard = String(this.keyboardOpen)
    this.portal.dataset.modal = String(this.activeModalOverlays.size > 0)
    this.portal.dataset.root = this.activeRoot
    this.portal.dataset.view = view
    this.portal.dataset.posture = posture
    this.portal.dataset.continuity = String(continuity.visible)
    this.title!.textContent = title
    this.backButton!.hidden = route === null
    this.backButton!.setAttribute(
      'aria-label',
      `Back to ${this.activeRoot === 'browse' ? 'Browse' : 'Home'}`,
    )
    this.searchButton!.hidden = this.activeRoot === 'sophia'
      || (this.activeRoot === 'browse' && view === 'root')
    this.searchButton!.setAttribute(
      'aria-label',
      view === 'document' ? 'Find or switch documents' : 'Search documents',
    )
    this.continuityPanel!.dataset.visible = String(continuity.visible)
    this.continuityStatus!.state = continuity.state
    this.continuityStatus!.label = continuity.label
    this.continuityStatus!.detail = continuity.detail
    this.continuityStatus!.actionLabel = continuity.actionLabel
    this.continuityAction = continuity.action
    this.filesPanel!.dataset.visible = String(
      this.activeRoot === 'browse' && view === 'root',
    )
    this.homePanel!.dataset.visible = String(
      this.activeRoot === 'home' && view === 'root',
    )

    this.homeView!.status = continuity.retainHomeContent
      && (home?.status === 'loading' || home?.status === 'error')
      ? 'ready'
      : home?.status ?? 'ready'
    this.homeView!.error = home?.error ?? ''
    this.homeView!.graphId = home?.graphId ?? this.context.graphId
    this.homeView!.graphTitle = home?.graphTitle
      ?? graphTitle(this.context as ShellContext<unknown>, this.snapshot)
    this.homeView!.todayKey = this.snapshot.dailyNotes?.todayKey ?? ''
    this.homeView!.todayDoc = this.snapshot.dailyNotes?.todayDoc ?? null
    this.homeView!.resume = home?.resume ?? (this.lastDocumentId
      ? {
          graphId: this.context.graphId,
          documentId: this.lastDocumentId,
          title: this.lastDocumentTitle || this.lastDocumentId,
        }
      : null)
    this.homeView!.dreamJournal = home?.dreamJournal ?? null
    this.homeView!.pinned = home?.pinned ?? []
    this.homeView!.newlyCreated = home?.newlyCreated ?? []
    this.homeView!.recent = home?.recent ?? []

    this.tabs!.activeTab = this.activeRoot
    this.tabs!.centerMode = view === 'document' ? 'document' : 'home'

    const mobileNodes = this.nodes()
      .map(mobileNode)
      .filter((node): node is MnMobileFileNode => node !== null)
    for (const node of flattenNodes(this.nodes())) {
      if (node.kind === 'folder' && node.expanded) this.expandedFolders.add(node.id)
    }
    this.fileList!.nodes = mobileNodes
    this.fileList!.expandedFolderIds = [...this.expandedFolders]
    this.fileList!.activeGraphId = this.context.graphId
    this.fileList!.currentGraphTitle = graphTitle(
      this.context as ShellContext<unknown>,
      this.snapshot,
    )
    this.fileList!.activeDocumentId = this.context.documentId ?? ''
    this.fileList!.searchQuery = this.snapshot.sidebar?.searchQuery ?? ''
    this.fileList!.status = fileContinuity.status
    this.fileList!.statusLabel = fileContinuity.label
    this.fileList!.statusDetail = fileContinuity.detail
    this.fileList!.operation = this.snapshot.sidebar?.operation ?? null
    this.fileList!.recents = (home?.recent ?? []).map(document => ({
      docId: document.documentId,
      title: document.title,
      timestamp: document.timestamp ?? undefined,
      readOnly: document.readOnly,
      graphId: document.graphId,
    }))
    // The shell's sidebar projection is already an offline-capable snapshot.
    // Keep it usable while the live provider reconnects; `synced=false` is only
    // the honest initial-hydration state where no projected nodes exist yet.
    this.fileList!.synced = mobileNodes.length > 0 || sync === 'synced' || sync === 'idle'
    this.fileList!.workspaces = (this.snapshot.chrome?.workspaces ?? [{
      graphId: this.context.graphId,
      title: graphTitle(this.context as ShellContext<unknown>, this.snapshot),
      role: 'owner',
      cellState: 'running',
    }]).map(workspace => ({
      graphId: workspace.graphId,
      title: workspace.title,
      disabled: workspace.disabled,
      disabledReason: workspace.disabledReason,
    }))
    this.fileList!.workspaceLoading = this.snapshot.chrome?.workspaceStatus === 'loading'
    this.fileList!.workspaceError = this.snapshot.chrome?.workspaceError ?? ''
    this.fileList!.allowNewWorkspace = Boolean(this.snapshot.chrome?.onWorkspaceCreate)

    if (active && view === 'document') {
      this.environment.requestAnimationFrame(() => {
        const editor = this.host?.querySelector('#mn-editor-host') as {
          requestUpdate?: () => void
        } | null
        editor?.requestUpdate?.()
      })
    }
  }

  update(
    context: ShellContext<TContract>,
    snapshot: Readonly<RenderWorkspaceOptions>,
  ): void {
    if (this.destroyed) return
    if (context.graphId !== this.lastGraphId) {
      this.lastGraphId = context.graphId
      this.lastDocumentId = null
      this.lastDocumentTitle = ''
      this.observedDocumentId = null
      this.rootDocuments = { home: null, browse: null }
      this.expandedFolders = new Set()
    }
    const documentChanged = context.documentId !== this.observedDocumentId
    this.observedDocumentId = context.documentId
    this.context = context
    this.snapshot = snapshot
    this.ensureLifecycle(context)
    this.ensurePortal()
    const routeRoot: DocumentRoot = this.activeRoot === 'sophia'
      ? 'home'
      : this.activeRoot
    const projectedRoute = this.rootDocuments[routeRoot]
    if (
      context.documentId
      && documentChanged
    ) {
      this.lastDocumentId = context.documentId
      this.lastDocumentTitle = documentTitle(
        context as ShellContext<unknown>,
        snapshot,
      )
      const existingRoute = projectedRoute
      this.rootDocuments[routeRoot] = {
        documentId: context.documentId,
        title: this.lastDocumentTitle,
        homeDocument: existingRoute?.documentId === context.documentId
          ? existingRoute.homeDocument
          : undefined,
      }
      if (this.activeRoot === 'sophia' && this.adaptiveMedia?.matches) {
        this.activeRoot = 'home'
      }
    } else if (!context.documentId) {
      if (this.activeRoot !== 'sophia') this.rootDocuments[this.activeRoot] = null
    }
    this.applyResponsiveState()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.adaptiveMedia?.removeEventListener('change', this.onMediaChange)
    this.compactMedia?.removeEventListener('change', this.onMediaChange)
    this.host?.ownerDocument.removeEventListener(
      'mn-overlay-state-change',
      this.onOverlayStateChange,
    )
    this.viewport?.removeEventListener('resize', this.onViewportChange)
    this.viewport?.removeEventListener('scroll', this.onViewportChange)
    this.host?.removeAttribute('data-organism-mobile-shell')
    this.host?.removeAttribute('data-mobile-root')
    this.host?.removeAttribute('data-mobile-view')
    this.host?.removeAttribute('data-mobile-posture')
    this.host?.removeAttribute('data-mobile-keyboard')
    this.host?.removeAttribute('data-mobile-continuity')
    this.host?.ownerDocument.body.removeAttribute('data-organism-mobile-shell-active')
    const documentStyle = this.host?.ownerDocument.documentElement.style
    documentStyle?.removeProperty('--organism-vvh')
    documentStyle?.removeProperty('--organism-vvw')
    this.portal?.remove()
    this.portal = null
    this.fileList = null
    this.tabs = null
    this.homeView = null
    this.title = null
    this.backButton = null
    this.searchButton = null
    this.continuityPanel = null
    this.continuityStatus = null
    this.continuityAction = 'none'
    this.filesPanel = null
    this.homePanel = null
    this.adaptiveMedia = null
    this.compactMedia = null
    this.viewport = null
    this.host = null
    this.context = null
    this.activeModalOverlays.clear()
  }
}

export function createOrganismMobileShellFeature<TContract = unknown>(
  controller = new OrganismMobileShellController<TContract>(),
): ShellFeature<TContract> {
  return {
    id: 'responsive-mobile-shell',
    afterWorkspaceRender(context, snapshot) {
      controller.update(context, snapshot)
    },
    destroy() {
      controller.destroy()
    },
  }
}
