import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import type {
  MnConfirmationDialog,
  MnFolderPickerDialog,
  MnFolderPickerOption,
  MnInputDialog,
  MnInputDialogConfirmDetail,
} from '@shrubbery/components'

import {
  applyEditorMaterial,
  applySkinTheme,
  nextVisualIdentitySkin,
  type Skin,
  type Theme,
} from '@shrubbery/tokens'
import {
  DEFAULT_RIGHT_PANEL,
  GARDEN_DEFAULT,
  NULL_EDITOR_SCOPE,
  selectRightPanel,
  type AppId,
  type EditorScope,
  type FilePaneOperationFeedback,
  type PanelId,
  type RightPanelMode,
  type ProviderHandle,
} from '@shrubbery/nucleus'
import {
  OPEN_DOCUMENT_EVENT,
  assembleChatServices,
  assembleEditorServices,
  buildKernelOptions,
  createLiveCollabEditor,
  installWikiLinkPickerGlue,
  makeWikiLinkSearchService,
  renderWorkspace,
  type ChatHeaderActionDetail,
  type ChatPresentation,
  type ChatService,
  type HojaWikiLinkResolver,
  type EditorHostBinding,
  type EditorHostState,
  type EditorServices,
  type RenderWorkspaceOptions,
  type SidebarActionDetail,
  type ShEditorHost,
  type SidebarNodeDetail,
  type SidebarSection,
  type WorkspaceSummary,
  type WorkspaceQuickClipKind,
  type WorkspaceQuickClipRequestDetail,
  type WorkspaceQuickClipStatus,
} from '@shrubbery/runtime'
import { loadSidebarSections } from '../cell/sidebar-documents.js'
import { OrganismTtsController } from '../cell/tts-controller.js'
import { OrganismOriginalFileController } from '../cell/original-file-controller.js'
import { HomeActivityStore } from '../cell/home-activity.js'
import { readEditorMaterialPreference } from '../cell/settings-service.js'
import { createShellContext } from '../cell/shell-context.js'
import { OrganismMobileShellController } from '../cell/mobile-shell-controller.js'
import { BROWSER_HARNESS_SECOND_SEED, BROWSER_HARNESS_SEED } from './fixture.js'
import {
  InMemoryCellContract,
  type InMemoryCellSeed,
  type InMemoryDocumentSeed,
} from './in-memory-cell-contract.js'

interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}

interface HarnessBridgeState {
  readonly ready: boolean
  readonly error: string | null
  readonly backend: 'in-memory-cell'
  readonly graphId: string
  readonly workspaceIds: readonly string[]
  readonly activeDocumentId: string | null
  readonly activeDocumentTitle: string | null
  readonly activeDocumentReadOnly: boolean
  readonly home: boolean
  readonly documentIds: readonly string[]
  readonly activeApp: AppId
  readonly theme: Theme
  readonly skin: Skin
  readonly rightPanel: RightPanelMode
  readonly editorText: string
  readonly chatSessionId: string | null
  readonly chatPresentation: ChatPresentation
  readonly queryCount: number
  readonly wireCount: number
  readonly ttsStatus: string
  readonly ttsBlockIndex: number
  readonly ttsBlockCount: number
  readonly mobile: boolean
  readonly mobileTab: string
  readonly mobileCenterMode: string
  readonly quickClipStatus: WorkspaceQuickClipStatus
  readonly quickClipKind: WorkspaceQuickClipKind | null
  readonly quickClipDocumentId: string | null
  readonly originalFetchCount: number
  readonly authenticatedOriginalFetchCount: number
  readonly makeEditableStatus: 'idle' | 'saving' | 'error'
  readonly continuitySyncState: HarnessChromeSyncState
  readonly continuitySidebarStatus: HarnessSidebarStatus
}

type HarnessChromeSyncState = NonNullable<NonNullable<RenderWorkspaceOptions['chrome']>['syncState']>
type HarnessSidebarStatus = NonNullable<NonNullable<RenderWorkspaceOptions['sidebar']>['status']>

interface HarnessContinuityInput {
  readonly syncState?: HarnessChromeSyncState
  readonly sidebarStatus?: HarnessSidebarStatus
  readonly sidebarError?: string
  readonly operation?: FilePaneOperationFeedback | null
}

interface HarnessBridge {
  readonly version: 1
  readonly whenReady: Promise<void>
  readonly state: HarnessBridgeState
  setContinuity(input: HarnessContinuityInput): void
}

interface HarnessWorkspace {
  readonly seed: InMemoryCellSeed
  readonly contract: InMemoryCellContract
  readonly role: 'owner' | 'editor' | 'viewer'
  readonly cellState: 'running' | 'stopped'
}

declare global {
  interface Window {
    readonly __organism?: HarnessBridge
  }
}

const TODAY_KEY = '2026-07-10'

function makeBinding(initial: EditorHostState): SettableBinding {
  let value = initial
  const subscribers = new Set<(state: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    set(next) {
      value = next
      for (const callback of subscribers) callback(next)
    },
  }
}

function harnessDocument(id: string, title: string, body: string): InMemoryDocumentSeed {
  return {
    id,
    title,
    order: Date.now(),
    blocks: [
      { id: `${id}-title`, type: 'heading', level: 1, text: title },
      { id: `${id}-body`, text: body },
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, indent: 0, collapsed: false, 'data-block-id': `${id}-title` },
          content: [{ type: 'text', text: title }],
        },
        {
          type: 'paragraph',
          attrs: { indent: 0, collapsed: false, 'data-block-id': `${id}-body` },
          content: [{ type: 'text', text: body }],
        },
      ],
    },
  }
}

function makeWorkspace(
  seed: InMemoryCellSeed,
  role: HarnessWorkspace['role'] = 'owner',
  cellState: HarnessWorkspace['cellState'] = 'running',
): HarnessWorkspace {
  return { seed, contract: new InMemoryCellContract(seed), role, cellState }
}

const root = document.querySelector<HTMLElement>('#harness-root')!
const failure = document.querySelector<HTMLElement>('#harness-failure')!
const harnessInputDialog = document.createElement('mn-input-dialog') as MnInputDialog
const harnessConfirmationDialog = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
const harnessFolderPicker = document.createElement('mn-folder-picker-dialog') as MnFolderPickerDialog
document.body.append(harnessInputDialog, harnessConfirmationDialog, harnessFolderPicker)
applyEditorMaterial({ material: readEditorMaterialPreference(window.localStorage) })
const workspaces = new Map<string, HarnessWorkspace>([
  [BROWSER_HARNESS_SEED.graphId, makeWorkspace(BROWSER_HARNESS_SEED)],
  [BROWSER_HARNESS_SECOND_SEED.graphId, makeWorkspace(BROWSER_HARNESS_SECOND_SEED)],
])
let graphId = BROWSER_HARNESS_SEED.graphId
let workspace = workspaces.get(graphId)!
let contract = workspace.contract

let chatReferenceSearch: {
  readonly contract: InMemoryCellContract
  readonly graphId: string
  readonly service: ReturnType<typeof makeWikiLinkSearchService>
} | null = null

const resolveChatWikiLinks: HojaWikiLinkResolver = async (request, { signal }) => {
  const requestContract = contract
  const requestGraphId = graphId
  if (signal.aborted) return []
  if (
    chatReferenceSearch?.contract !== requestContract
    || chatReferenceSearch.graphId !== requestGraphId
  ) {
    chatReferenceSearch = {
      contract: requestContract,
      graphId: requestGraphId,
      service: makeWikiLinkSearchService(requestContract.rest, () => ({ graphId: requestGraphId })),
    }
  }
  const activeSearch = chatReferenceSearch
  const matches = await activeSearch.service.suggest(request.query)
  if (
    signal.aborted
    || contract !== requestContract
    || graphId !== requestGraphId
    || chatReferenceSearch !== activeSearch
  ) return []
  return matches.map(match => ({
    label: match.label,
    targetDocId: match.id,
    targetGraphId: requestGraphId,
    blockPreview: match.type === 'artifact' ? 'Artifact' : 'Document',
  }))
}

let activeDocumentId: string | null = null
let activeApp: AppId = 'garden'
let theme: Theme = 'light'
let skin: Skin = 'garden'
let rightPanel: RightPanelMode = DEFAULT_RIGHT_PANEL
let leftPanelMode: 'files' | 'graph' = 'files'
let sidebarSearchQuery = ''
let sidebarSections: SidebarSection[] = []
let provider: ProviderHandle | null = null
let binding: SettableBinding | null = null
let services: EditorServices = assembleEditorServices(contract.rest, contract.wire, currentScope)
let chat: ChatService | null = null
let chatSessionId: string | null = null
let chatPresentation: ChatPresentation = 'rail'
let pickerCleanup: (() => void) | null = null
let ready = false
let bootError: string | null = null
let documentSequence = 0
let workspaceSequence = 0
let quickClipStatus: WorkspaceQuickClipStatus = 'idle'
let quickClipError = ''
let quickClipKind: WorkspaceQuickClipKind | null = null
let quickClipDocumentId: string | null = null
let makeEditableStatus: 'idle' | 'saving' | 'error' = 'idle'
let makeEditableError = ''
let continuitySyncState: HarnessChromeSyncState = 'synced'
let continuitySidebarStatus: HarnessSidebarStatus = 'ready'
let continuitySidebarError = ''
let continuityOperation: FilePaneOperationFeedback | null = null
const tts = new OrganismTtsController({ requestRender: () => renderApp() })
const mobileShell = new OrganismMobileShellController<InMemoryCellContract>()
const homeActivity = new HomeActivityStore(window.localStorage, 'shrubbery.browser-harness.home.v1')
let originalRenderQueued = false
const originalFile = new OrganismOriginalFileController({
  requestRender: () => {
    if (originalRenderQueued) return
    originalRenderQueued = true
    queueMicrotask(() => {
      originalRenderQueued = false
      renderApp()
    })
  },
  fetch: (input, init) => contract.fetch(input, init),
})

// A real, graph-scoped activity fixture: every projected row resolves against
// a document that actually exists in Workspace A.
homeActivity.markCreated(graphId, 'delivery-plan', Date.now() - 180_000)
homeActivity.markOpened(graphId, 'research-notes', Date.now() - 60_000)
homeActivity.setPinned(graphId, 'architecture', true)

let resolveReady: () => void = () => undefined
const whenReady = new Promise<void>((resolve) => { resolveReady = resolve })

function editorHost(): ShEditorHost | null {
  return root.querySelector('#mn-editor-host') as ShEditorHost | null
}

function currentScope(): EditorScope {
  if (!activeDocumentId) return { ...NULL_EDITOR_SCOPE, app: activeApp }
  return { app: activeApp, centerMode: 'document', graphId, documentId: activeDocumentId }
}

function bridgeState(): HarnessBridgeState {
  const cell = contract.snapshot()
  const activeDocument = activeDocumentId ? contract.documentSeed(activeDocumentId) : null
  return Object.freeze({
    ready,
    error: bootError,
    backend: 'in-memory-cell' as const,
    graphId,
    workspaceIds: Object.freeze([...workspaces.keys()]),
    activeDocumentId,
    activeDocumentTitle: activeDocument?.title ?? null,
    activeDocumentReadOnly: activeDocument?.readOnly ?? false,
    home: activeDocumentId === null,
    documentIds: cell.documentIds,
    activeApp,
    theme,
    skin,
    rightPanel,
    editorText: editorHost()?.liveEditor?.getText() ?? '',
    chatSessionId,
    chatPresentation,
    queryCount: cell.queryCount,
    wireCount: cell.wires.length,
    ttsStatus: tts.snapshot().status,
    ttsBlockIndex: tts.snapshot().currentBlockIndex,
    ttsBlockCount: tts.snapshot().totalBlocks,
    mobile: mobileShell.state.mobile,
    mobileTab: mobileShell.state.activeTab,
    mobileCenterMode: mobileShell.state.centerMode,
    quickClipStatus,
    quickClipKind,
    quickClipDocumentId,
    originalFetchCount: cell.originalFetchCount,
    authenticatedOriginalFetchCount: cell.authenticatedOriginalFetchCount,
    makeEditableStatus,
    continuitySyncState,
    continuitySidebarStatus,
  })
}

const bridge = {} as HarnessBridge
Object.defineProperties(bridge, {
  version: { enumerable: true, value: 1 },
  whenReady: { enumerable: true, value: whenReady },
  state: { enumerable: true, get: bridgeState },
  setContinuity: {
    enumerable: true,
    value: (input: HarnessContinuityInput) => {
      if (input.syncState !== undefined) continuitySyncState = input.syncState
      if (input.sidebarStatus !== undefined) {
        continuitySidebarStatus = input.sidebarStatus
        if (input.sidebarStatus !== 'error') continuitySidebarError = ''
      }
      if (input.sidebarError !== undefined) continuitySidebarError = input.sidebarError
      if (input.operation !== undefined) continuityOperation = input.operation
      renderApp()
    },
  },
})
Object.freeze(bridge)
Object.defineProperty(window, '__organism', {
  configurable: false,
  enumerable: false,
  value: bridge,
  writable: false,
})

function slotted(host: Element | null, slot: string, text: string): HTMLElement | null {
  if (!host) return null
  let element = host.querySelector<HTMLElement>(`[slot="${slot}"][data-harness-status]`)
  if (!element) {
    element = document.createElement('span')
    element.slot = slot
    element.dataset.harnessStatus = slot
    host.append(element)
  }
  element.textContent = text
  return element
}

function bindLiveChrome(): void {
  const activeDocument = activeDocumentId ? contract.documentSeed(activeDocumentId) : null
  const bottom = root.querySelector('mn-bottom-bar')
  const words = (activeDocument?.blocks ?? [])
    .flatMap(block => block.text.trim().split(/\s+/))
    .filter(Boolean).length
  slotted(bottom, 'left-status', `${contract.snapshot().documentIds.length} documents`)
  slotted(bottom, 'center-status', activeDocument ? `${words} fixture words` : 'Workspace home')
  slotted(bottom, 'right-status', 'local CRDT · synced')
}

function workspaceSummaries(): WorkspaceSummary[] {
  return [...workspaces.entries()].map(([id, entry]) => ({
    graphId: id,
    title: entry.seed.title,
    role: entry.role,
    cellState: entry.cellState,
    ...(entry.role === 'viewer' ? { disabled: true, disabledReason: 'Harness viewer route is read-only.' } : {}),
  }))
}

const HARNESS_MOVE_DESTINATIONS: readonly MnFolderPickerOption[] = Object.freeze([
  { id: 'harness-research', name: 'Research', parentId: null, section: 'documents' },
  { id: 'harness-archive', name: 'Archive', parentId: null, section: 'documents' },
  { id: 'harness-drafts', name: 'Drafts', parentId: 'harness-research', section: 'documents' },
])

function showHarnessNewDocumentDialog(): void {
  harnessInputDialog.title = 'New Document'
  harnessInputDialog.message = `Name the document to create in ${workspace.seed.title}.`
  harnessInputDialog.placeholder = 'Untitled document'
  harnessInputDialog.confirmText = 'Create'
  harnessInputDialog.value = ''
  const listeners = new AbortController()
  harnessInputDialog.addEventListener('mn-confirm', (event) => {
    const title = (event as CustomEvent<MnInputDialogConfirmDetail>).detail.value.trim()
    if (!title) return
    listeners.abort()
    harnessInputDialog.hide()
    void createHarnessDocument(title)
  }, { signal: listeners.signal })
  harnessInputDialog.addEventListener('mn-cancel', () => listeners.abort(), {
    signal: listeners.signal,
  })
  harnessInputDialog.show()
}

function showHarnessMoveDialog(detail: SidebarActionDetail): void {
  const label = detail.node?.label || detail.nodeId || 'item'
  harnessFolderPicker.title = `Move “${label}”`
  harnessFolderPicker.currentParentId = detail.node?.parentId ?? null
  harnessFolderPicker.section = 'documents'
  harnessFolderPicker.excludeIds = detail.node?.kind === 'folder' && detail.nodeId
    ? [detail.nodeId]
    : []
  harnessFolderPicker.folders = HARNESS_MOVE_DESTINATIONS
  const listeners = new AbortController()
  const finish = () => listeners.abort()
  harnessFolderPicker.addEventListener('mn-select', finish, { signal: listeners.signal })
  harnessFolderPicker.addEventListener('mn-cancel', finish, { signal: listeners.signal })
  harnessFolderPicker.show()
}

function showHarnessDeleteDialog(detail: SidebarActionDetail): void {
  const kind = detail.node?.kind === 'folder' ? 'Folder' : 'Document'
  const label = detail.node?.label || detail.nodeId || kind.toLowerCase()
  harnessConfirmationDialog.title = `Delete ${kind}`
  harnessConfirmationDialog.message = kind === 'Folder'
    ? `Delete “${label}”? Garden refuses this while the folder contains items.`
    : `Delete “${label}” from this graph? This cannot be undone here.`
  harnessConfirmationDialog.confirmText = 'Delete'
  harnessConfirmationDialog.cancelText = 'Keep it'
  harnessConfirmationDialog.variant = 'danger'
  const listeners = new AbortController()
  const finish = () => {
    listeners.abort()
    harnessConfirmationDialog.hide()
  }
  harnessConfirmationDialog.addEventListener('mn-confirm', finish, { signal: listeners.signal })
  harnessConfirmationDialog.addEventListener('mn-cancel', () => listeners.abort(), {
    signal: listeners.signal,
  })
  harnessConfirmationDialog.show()
}

function handleHarnessSidebarAction(detail: SidebarActionDetail): void {
  if (detail.action === 'move') showHarnessMoveDialog(detail)
  else if (detail.action === 'delete') showHarnessDeleteDialog(detail)
}

function handleHarnessChatHeaderAction(detail: ChatHeaderActionDetail): void {
  if (detail.action === 'popout' && chatPresentation !== 'fullscreen') {
    chatPresentation = 'fullscreen'
    renderApp()
  } else if (detail.action === 'restore' && chatPresentation !== 'rail') {
    chatPresentation = 'rail'
    renderApp()
  }
}

function renderApp(): void {
  const activeDocument = activeDocumentId ? contract.documentSeed(activeDocumentId) : null
  originalFile.setScope(
    contract,
    graphId,
    activeDocumentId,
    activeDocument?.original
      ? {
          storageKey: `local://documents/${activeDocument.id}/original/${activeDocument.original.filename}`,
          originalFilename: activeDocument.original.filename,
          mimeType: activeDocument.original.mimeType,
          fileType: activeDocument.original.filename.split('.').pop() ?? '',
        }
      : null,
  )
  tts.setScope(graphId, activeDocumentId)
  tts.setEditorHost(editorHost())
  root.dataset.activeDocumentId = activeDocumentId ?? ''
  root.dataset.activeApp = activeApp
  root.dataset.theme = theme
  root.dataset.graphId = graphId

  const homeProjection = homeActivity.project(
    graphId,
    contract.documentSeeds().map(document => ({ id: document.id, title: document.title })),
    { dreamingEnabled: graphId === BROWSER_HARNESS_SEED.graphId },
  )
  const homeOptions = {
    status: 'ready' as const,
    graphId,
    graphTitle: workspace.seed.title,
    ...homeProjection,
    onNewDocument: showHarnessNewDocumentDialog,
    onOpenDocument: (document: { readonly documentId: string }) => {
      void openDocument(document.documentId)
    },
    onPinDocument: (document: { readonly graphId: string; readonly documentId: string }, pinned: boolean) => {
      homeActivity.setPinned(document.graphId, document.documentId, pinned)
      renderApp()
    },
  }
  const workspaceOptions: RenderWorkspaceOptions = {
    app: activeApp,
    rightCollapsed: rightPanel === 'none',
    ...(binding && activeDocumentId ? {
      editorHost: binding,
      editorKernelOptions: buildKernelOptions(services, currentScope()),
      editorDocumentAccess: {
        readOnly: activeDocument?.readOnly ?? false,
        makeEditableStatus,
        makeEditableError,
      },
    } : {}),
    ...(!activeDocumentId ? {
      home: homeOptions,
    } : {}),
    mobileHome: homeOptions,
    dailyNotes: {
      todayKey: TODAY_KEY,
      todayDoc: contract.snapshot().documentIds.includes(`daily-note-${TODAY_KEY}`)
        ? { id: `daily-note-${TODAY_KEY}` }
        : null,
      onOpenDate: ({ dateKey }) => { void openHarnessDailyNote(dateKey) },
    },
    chrome: {
      activeApp,
      leftPanelMode,
      rightPanel,
      isDark: theme === 'dark',
      activeSkin: skin,
      breadcrumbs: [
        { id: graphId, label: workspace.seed.title, kind: 'graph' },
        ...(activeDocumentId
          ? [{ id: activeDocumentId, label: contract.documentSeed(activeDocumentId).title, kind: 'document' as const, current: true }]
          : []),
      ],
      workspaces: workspaceSummaries(),
      workspaceStatus: 'ready',
      syncState: continuitySyncState,
      activeWorkspaceId: graphId,
      quickClip: {
        available: true,
        status: quickClipStatus,
        error: quickClipError,
        onRequest: detail => { void createHarnessQuickClip(detail) },
        onReset: () => {
          quickClipStatus = 'idle'
          quickClipError = ''
          renderApp()
        },
      },
      onWorkspaceSelect: selected => { void switchWorkspace(selected.graphId) },
      onWorkspaceCreate: () => { void createHarnessWorkspace() },
      onWorkspaceDelete: selected => { void deleteHarnessWorkspace(selected.graphId) },
    },
    sidebar: {
      sections: sidebarSections,
      status: continuitySidebarStatus,
      error: continuitySidebarError,
      operation: continuityOperation,
      searchQuery: sidebarSearchQuery,
      activeId: activeDocumentId,
      selectedId: activeDocumentId,
      searchPlaceholder: 'Search fixture documents',
      onSearchChange: ({ query }) => { sidebarSearchQuery = query; renderApp() },
      onNodeOpen: detail => { void openSidebarNode(detail) },
      onAction: handleHarnessSidebarAction,
      onOperationRecovery: detail => {
        if (!continuityOperation || continuityOperation.id !== detail.operationId) return
        continuityOperation = detail.action === 'reconcile'
          ? {
              ...continuityOperation,
              reconciling: true,
              message: 'Checking the current files without repeating the operation.',
            }
          : { ...continuityOperation, state: 'pending' }
        renderApp()
      },
    },
    chatHost: {
      service: chat,
      sessionId: chatSessionId,
      presentation: chatPresentation,
      composerReferenceResolver: resolveChatWikiLinks,
      onHeaderAction: handleHarnessChatHeaderAction,
    },
    ...(activeDocumentId ? {
      wirePanelLocalContext: {
        graphId,
        documentId: activeDocumentId,
        title: contract.documentSeed(activeDocumentId).title,
      },
    } : {}),
    tts: tts.snapshot(),
  }
  renderWorkspace(GARDEN_DEFAULT, { container: root, ...workspaceOptions })
  const liveHost = editorHost()
  if (liveHost) liveHost.originalFileView = originalFile.snapshot()
  tts.setEditorHost(editorHost())
  bindLiveChrome()
  mobileShell.update(createShellContext({
    host: root,
    graphId,
    documentId: activeDocumentId,
    app: activeApp,
    source: 'CELL_LIVE',
    deploymentMode: 'playground',
    contract,
    location: window.location,
    rerender: renderApp,
  }), workspaceOptions)
}

async function waitForEditor(expectedText?: string): Promise<void> {
  for (let frame = 0; frame < 180; frame += 1) {
    const editor = editorHost()?.liveEditor
    if (editor && (!expectedText || editor.getText().includes(expectedText))) return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  throw new Error(`browser harness editor did not settle${expectedText ? ` with ${expectedText}` : ''}`)
}

async function seedDocumentRoom(target: HarnessWorkspace, documentSeed: InMemoryDocumentSeed): Promise<void> {
  const scratch = document.createElement('div')
  scratch.setAttribute('aria-hidden', 'true')
  scratch.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;'
  document.body.append(scratch)
  try {
    const handle = target.contract.crdt.open({ kind: 'doc', graphId: target.seed.graphId, docId: documentSeed.id }, undefined)
    const editor = createLiveCollabEditor({ element: scratch, doc: handle.doc })
    const applied = editor.commands.setContent(documentSeed.content)
    if (!applied) throw new Error(`failed to seed CRDT room for ${documentSeed.id}`)
    await Promise.resolve()
    editor.destroy()
    handle.destroy()
  } finally {
    scratch.remove()
  }
}

async function seedCrdtRooms(): Promise<void> {
  for (const target of workspaces.values()) {
    for (const documentSeed of target.contract.documentSeeds()) {
      await seedDocumentRoom(target, documentSeed)
    }
  }
}

function installPicker(): void {
  pickerCleanup?.()
  pickerCleanup = installWikiLinkPickerGlue({
    getEditor: () => editorHost()?.liveEditor ?? null,
    services,
    getScope: currentScope,
  })
}

async function prepareWorkspaceServices(): Promise<void> {
  services = assembleEditorServices(contract.rest, contract.wire, currentScope)
  chat = assembleChatServices(contract, currentScope, 'local')
  const session = await chat.createSession({ title: `Browser Harness · ${graphId}`, graphId })
  chatSessionId = session.id
  installPicker()
}

async function openDocument(documentId: string): Promise<void> {
  if (documentId === activeDocumentId && editorHost()?.liveEditor) return
  const documentSeed = contract.documentSeed(documentId)
  const previous = provider
  makeEditableStatus = 'idle'
  makeEditableError = ''
  activeDocumentId = documentId
  homeActivity.markOpened(graphId, documentId)
  provider = contract.crdt.open({ kind: 'doc', graphId, docId: documentId }, undefined)
  const nextState: EditorHostState = {
    centerMode: 'document', graphId, documentId, status: 'ready', error: null, provider,
  }
  if (binding) binding.set(nextState)
  else binding = makeBinding(nextState)
  sidebarSections = await loadSidebarSections(contract.rest, graphId, documentId)
  renderApp()
  await waitForEditor(documentSeed.title)
  previous?.destroy()
}

async function goHome(): Promise<void> {
  activeDocumentId = null
  tts.setScope(graphId, null)
  const previous = provider
  provider = null
  binding = null
  sidebarSections = await loadSidebarSections(contract.rest, graphId, null)
  renderApp()
  previous?.destroy()
}

async function openSidebarNode(detail: SidebarNodeDetail): Promise<void> {
  if (detail.node.kind !== 'document') return
  await openDocument(detail.id)
}

async function createHarnessDocument(title: string): Promise<string> {
  const id = `browser-created-${++documentSequence}`
  const documentSeed = harnessDocument(id, title, `Created inside ${workspace.seed.title}.`)
  contract.addDocument(documentSeed)
  await seedDocumentRoom(workspace, documentSeed)
  homeActivity.markCreated(graphId, id)
  sidebarSections = await loadSidebarSections(contract.rest, graphId, null)
  await openDocument(id)
  return id
}

async function openHarnessDailyNote(dateKey: string): Promise<void> {
  const id = `daily-note-${dateKey}`
  if (!contract.snapshot().documentIds.includes(id)) {
    const documentSeed = harnessDocument(id, `Daily Note · ${dateKey}`, `Daily note created in ${workspace.seed.title}.`)
    contract.addDocument(documentSeed)
    await seedDocumentRoom(workspace, documentSeed)
    homeActivity.markCreated(graphId, id)
  }
  await openDocument(id)
}

async function createHarnessQuickClip(detail: WorkspaceQuickClipRequestDetail): Promise<void> {
  if (quickClipStatus === 'processing') return
  quickClipStatus = 'processing'
  quickClipError = ''
  quickClipKind = detail.kind
  quickClipDocumentId = null
  renderApp()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const id = `quick-clip-${++documentSequence}`
  const title = detail.kind === 'youtube' ? 'YouTube Transcript' : 'Clipped Web Page'
  const documentSeed = harnessDocument(id, title, `Clipped from ${detail.url}`)
  contract.addDocument(documentSeed)
  await seedDocumentRoom(workspace, documentSeed)
  homeActivity.markCreated(graphId, id)
  sidebarSections = await loadSidebarSections(contract.rest, graphId, activeDocumentId)
  quickClipStatus = 'complete'
  quickClipDocumentId = id
  renderApp()
}

async function switchWorkspace(nextGraphId: string): Promise<void> {
  if (nextGraphId === graphId) return
  const next = workspaces.get(nextGraphId)
  if (!next || next.role === 'viewer') return
  tts.setScope(graphId, null)
  const previousProvider = provider
  provider = null
  binding = null
  pickerCleanup?.()
  pickerCleanup = null
  activeDocumentId = null
  quickClipStatus = 'idle'
  quickClipError = ''
  quickClipKind = null
  quickClipDocumentId = null
  makeEditableStatus = 'idle'
  makeEditableError = ''
  graphId = nextGraphId
  workspace = next
  contract = next.contract
  sidebarSearchQuery = ''
  sidebarSections = await loadSidebarSections(contract.rest, graphId, null)
  await prepareWorkspaceServices()
  const url = new URL(window.location.href)
  url.searchParams.set('graph', graphId)
  window.history.replaceState(window.history.state, '', url)
  renderApp()
  previousProvider?.destroy()
}

async function createHarnessWorkspace(): Promise<void> {
  const id = `browser-created-workspace-${++workspaceSequence}`
  const seed: InMemoryCellSeed = {
    graphId: id,
    title: `Created Workspace ${workspaceSequence}`,
    documents: [], folders: [], artifacts: [],
  }
  workspaces.set(id, makeWorkspace(seed))
  await switchWorkspace(id)
}

async function deleteHarnessWorkspace(targetGraphId: string): Promise<void> {
  const target = workspaces.get(targetGraphId)
  if (!target || target.role !== 'owner' || workspaces.size <= 1) return
  workspaces.delete(targetGraphId)
  homeActivity.removeGraph(targetGraphId)
  if (targetGraphId === graphId) {
    const fallback = [...workspaces.values()].find(candidate => candidate.role !== 'viewer')
    if (!fallback) throw new Error('browser harness deleted its final editable workspace')
    await switchWorkspace(fallback.seed.graphId)
  } else {
    renderApp()
  }
  target.contract.destroy()
}

function installShellEvents(): void {
  root.addEventListener('mn-theme-toggle', () => {
    theme = theme === 'light' ? 'dark' : 'light'
    applySkinTheme({ skin, theme })
    renderApp()
  })
  root.addEventListener('mn-skin-toggle', () => {
    skin = nextVisualIdentitySkin(skin)
    applySkinTheme({ skin, theme })
    renderApp()
  })
  root.addEventListener('mn-app-change', event => {
    const next = (event as CustomEvent<{ app?: AppId }>).detail?.app
    if (!next) return
    activeApp = next
    renderApp()
  })
  root.addEventListener('mn-left-mode-change', event => {
    const next = (event as CustomEvent<{ mode?: 'files' | 'graph' }>).detail?.mode
    if (!next) return
    leftPanelMode = next
    renderApp()
  })
  root.addEventListener('mn-panel-toggle', event => {
    const panel = (event as CustomEvent<{ panel?: PanelId }>).detail?.panel
    if (!panel) return
    rightPanel = selectRightPanel(rightPanel, panel)
    renderApp()
  })
  root.addEventListener('mn-navigate-home', () => { void goHome() })
  root.addEventListener('mn-editor-original-view-toggle', () => { void originalFile.toggle() })
  root.addEventListener('mn-editor-make-editable', () => {
    const documentId = activeDocumentId
    if (!documentId || makeEditableStatus === 'saving') return
    makeEditableStatus = 'saving'
    makeEditableError = ''
    renderApp()
    queueMicrotask(() => {
      try {
        contract.makeDocumentEditable(documentId)
        makeEditableStatus = 'idle'
        void loadSidebarSections(contract.rest, graphId, documentId).then((sections) => {
          sidebarSections = sections
          renderApp()
        })
      } catch (error) {
        makeEditableStatus = 'error'
        makeEditableError = error instanceof Error ? error.message : String(error)
        renderApp()
      }
    })
  })
  root.addEventListener('mn-original-viewer-reload', () => { void originalFile.reload() })
  root.addEventListener('mn-original-viewer-download', () => originalFile.download())
  root.addEventListener('mn-original-viewer-open-external', () => originalFile.openExternal())
  root.addEventListener('mn-original-viewer-chapter-select', event => {
    const chapterId = (event as CustomEvent<{ chapterId?: string }>).detail?.chapterId?.trim()
    if (chapterId) originalFile.selectChapter(chapterId)
  })
  document.addEventListener(OPEN_DOCUMENT_EVENT, event => {
    const detail = (event as CustomEvent<{ graphId?: string; documentId?: string }>).detail
    if (detail?.graphId === graphId && detail.documentId) void openDocument(detail.documentId)
  })
}

async function boot(): Promise<void> {
  applySkinTheme({ skin, theme })
  installShellEvents()
  await Promise.all([...workspaces.values()].map(entry => entry.contract.auth.whenReady()))
  await seedCrdtRooms()
  sidebarSections = await loadSidebarSections(contract.rest, graphId, null)
  await prepareWorkspaceServices()
  renderApp()
  ready = true
  root.dataset.ready = 'true'
  resolveReady()
}

window.addEventListener('beforeunload', () => {
  originalFile.destroy()
  tts.destroy()
  mobileShell.destroy()
  pickerCleanup?.()
  provider?.destroy()
  for (const entry of workspaces.values()) entry.contract.destroy()
})

void boot().catch((error: unknown) => {
  bootError = error instanceof Error ? error.stack ?? error.message : String(error)
  failure.textContent = bootError
  failure.dataset.visible = ''
  root.dataset.error = 'true'
  resolveReady()
})
