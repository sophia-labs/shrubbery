import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import {
  GARDEN_DEFAULT,
  type FilePaneCapabilities,
  type FilePaneColumnPathChangeDetail,
  type FilePaneGrouping,
  type FilePaneSection,
  type FilePaneSelectionDetail,
  type FilePaneSort,
  type FilePaneStatus,
} from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { applySkinTheme } from '@shrubbery/tokens'

const SECTIONS: readonly FilePaneSection[] = Object.freeze([
  {
    id: 'documents',
    label: 'Documents',
    icon: 'file-text',
    nodes: [
      {
        id: 'folder-research',
        label: 'Research',
        kind: 'folder',
        order: 0,
        expanded: true,
        section: 'documents',
        children: [
          { id: 'doc-zeta', label: 'Zeta field notes', kind: 'document', order: 0, connectivity: 2, section: 'documents' },
          { id: 'doc-alpha', label: 'Alpha parity plan', kind: 'document', order: 1, connectivity: 9, section: 'documents' },
        ],
      },
      { id: 'doc-root', label: 'Root daily note', kind: 'document', order: 1, connectivity: 4, section: 'documents' },
    ],
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: 'diamond',
    nodes: [
      { id: 'artifact-map', label: 'System map', kind: 'artifact', order: 0, badge: 'svg', section: 'artifacts' },
    ],
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: 'hash',
    nodes: [{ id: 'tag-parity', label: 'parity', kind: 'tag', count: 3 }],
  },
])

const DEFAULT_CAPABILITIES: FilePaneCapabilities = Object.freeze({
  createDocument: true,
  upload: true,
  createFolder: true,
  refresh: true,
  sort: true,
  group: true,
  multiSelect: true,
  dragDrop: true,
  contextMenu: true,
})

interface HarnessState {
  readonly ready: boolean
  readonly error: string | null
  readonly leftExpanded: boolean
  readonly searchQuery: string
  readonly sort: FilePaneSort
  readonly grouping: FilePaneGrouping
  readonly selectedIds: readonly string[]
  readonly columnPaths: Readonly<Record<string, readonly string[]>>
  readonly status: FilePaneStatus
  readonly refreshCount: number
  readonly openedIds: readonly string[]
}

interface HarnessBridge {
  readonly state: HarnessState
  setStatus(status: FilePaneStatus): void
  setCapabilities(capabilities: FilePaneCapabilities): void
}

declare global {
  interface Window { readonly __filePaneHarness?: HarnessBridge }
}

const root = document.querySelector<HTMLElement>('#file-pane-harness-root')!
let ready = false
let error: string | null = null
let leftExpanded = false
let searchQuery = ''
let sort: FilePaneSort = { criterion: 'manual', direction: 'asc', foldersFirst: true }
let grouping: FilePaneGrouping = { separateArtifacts: true, showFolders: true }
let selectedIds: string[] = []
let columnPaths: Record<string, readonly string[]> = {}
let status: FilePaneStatus = 'ready'
let capabilities: FilePaneCapabilities = DEFAULT_CAPABILITIES
let refreshCount = 0
let openedIds: string[] = []

function snapshot(): HarnessState {
  return Object.freeze({
    ready,
    error,
    leftExpanded,
    searchQuery,
    sort: Object.freeze({ ...sort }),
    grouping: Object.freeze({ ...grouping }),
    selectedIds: Object.freeze([...selectedIds]),
    columnPaths: Object.freeze(Object.fromEntries(
      Object.entries(columnPaths).map(([key, value]) => [key, Object.freeze([...value])]),
    )),
    status,
    refreshCount,
    openedIds: Object.freeze([...openedIds]),
  })
}

function renderFixture(): void {
  renderWorkspace(GARDEN_DEFAULT, {
    container: root,
    app: 'garden',
    rightCollapsed: true,
    panelLayout: {
      leftWidth: 290,
      leftExpanded,
      leftSnap: '180px 290px 500px 70%',
      onLeftExpandedChange: expanded => {
        leftExpanded = expanded
        renderFixture()
      },
    },
    chrome: {
      activeApp: 'garden',
      activeSkin: 'garden',
      leftPanelMode: 'files',
      rightPanel: 'none',
      itemCount: 5,
      syncState: status === 'reconnecting' ? 'connecting' : status === 'error' ? 'error' : 'synced',
      runtimeMode: 'local',
    },
    sidebar: {
      sections: SECTIONS,
      searchQuery,
      selectedIds,
      presentation: leftExpanded ? 'columns' : 'tree',
      sort,
      grouping,
      columnPaths,
      status,
      error: status === 'error' ? 'Projection unavailable.' : '',
      storage: { usedBytes: 3 * 1024 ** 2, limitBytes: 8 * 1024 ** 2, label: 'Cell storage' },
      capabilities,
      onSearchChange: ({ query }) => {
        searchQuery = query
        renderFixture()
      },
      onSelectionChange: (detail: FilePaneSelectionDetail) => {
        selectedIds = [...detail.ids]
        renderFixture()
      },
      onSortChange: detail => {
        sort = detail.sort
        renderFixture()
      },
      onGroupingChange: detail => {
        grouping = detail.grouping
        renderFixture()
      },
      onColumnPathChange: (detail: FilePaneColumnPathChangeDetail) => {
        columnPaths = { ...columnPaths, [detail.sectionId]: [...detail.folderIds] }
        renderFixture()
      },
      onNodeOpen: detail => {
        openedIds = [...openedIds, detail.id]
        renderFixture()
      },
      onAction: detail => {
        if (detail.action === 'refresh') refreshCount += 1
        renderFixture()
      },
    },
  })
}

const bridge = {} as HarnessBridge
Object.defineProperties(bridge, {
  state: { enumerable: true, get: snapshot },
  setStatus: {
    enumerable: true,
    value: (next: FilePaneStatus) => { status = next; renderFixture() },
  },
  setCapabilities: {
    enumerable: true,
    value: (next: FilePaneCapabilities) => { capabilities = Object.freeze({ ...next }); renderFixture() },
  },
})
Object.freeze(bridge)
Object.defineProperty(window, '__filePaneHarness', { configurable: false, value: bridge })

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })
  renderFixture()
  await customElements.whenDefined('mn-sidebar-panel')
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  ready = true
  renderFixture()
}

void boot().catch((cause: unknown) => {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  renderFixture()
})
