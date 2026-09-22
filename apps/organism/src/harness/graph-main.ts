import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import {
  GARDEN_DEFAULT,
  selectRightPanel,
  type PanelId,
  type RightPanelMode,
} from '@shrubbery/nucleus'
import {
  renderWorkspace,
  type GraphPanelEdge,
  type GraphPanelNode,
  type GraphPanelViewMode,
} from '@shrubbery/runtime'
import { applySkinTheme } from '@shrubbery/tokens'

const WORKSPACE_NODES: readonly GraphPanelNode[] = Object.freeze([
  { id: 'workspace-root', label: 'Proof Garden', kind: 'graph', graphId: 'graph-proof' },
  { id: 'folder-theory', label: 'Theory', kind: 'folder', parentId: 'workspace-root', folderId: 'theory' },
  { id: 'doc-alpha', label: 'Cybernetic Notes', kind: 'document', parentId: 'folder-theory', documentId: 'alpha' },
  { id: 'doc-beta', label: 'Machine Ontology', kind: 'document', parentId: 'folder-theory', documentId: 'beta' },
  { id: 'doc-archive', label: 'Imported Archive', kind: 'read-only-document', parentId: 'workspace-root', documentId: 'archive', readOnly: true },
  { id: 'artifact-sketch', label: 'Cloud Diagram', kind: 'artifact', parentId: 'workspace-root', artifactId: 'cloud-diagram', fileType: 'svg' },
  { id: 'tag-cybernetics', label: '#cybernetics', kind: 'tag', parentId: 'workspace-root', tagName: 'cybernetics' },
])

const WORKSPACE_EDGES: readonly GraphPanelEdge[] = Object.freeze([
  { id: 'root-theory', from: 'workspace-root', to: 'folder-theory', predicate: 'contains' },
  { id: 'theory-alpha', from: 'folder-theory', to: 'doc-alpha', predicate: 'contains' },
  { id: 'theory-beta', from: 'folder-theory', to: 'doc-beta', predicate: 'contains' },
  { id: 'root-archive', from: 'workspace-root', to: 'doc-archive', predicate: 'contains' },
  { id: 'root-artifact', from: 'workspace-root', to: 'artifact-sketch', predicate: 'contains' },
  { id: 'root-tag', from: 'workspace-root', to: 'tag-cybernetics', predicate: 'contains' },
  { id: 'alpha-beta', from: 'doc-alpha', to: 'doc-beta', predicate: 'supports', predicateLabel: 'supports', kind: 'wire', category: 'quality' },
  { id: 'beta-tag', from: 'doc-beta', to: 'tag-cybernetics', predicate: 'relatedTo', predicateLabel: 'related to', kind: 'wire', category: 'relation', bidirectional: true },
])

const MUTATED_WORKSPACE_NODE: GraphPanelNode = Object.freeze({
  id: 'doc-gamma',
  label: 'Added Projection',
  kind: 'document',
  parentId: 'folder-theory',
  documentId: 'gamma',
})

const MUTATED_WORKSPACE_EDGES: readonly GraphPanelEdge[] = Object.freeze([
  { id: 'theory-gamma', from: 'folder-theory', to: 'doc-gamma', predicate: 'contains' },
  { id: 'gamma-alpha', from: 'doc-gamma', to: 'doc-alpha', predicate: 'requires', predicateLabel: 'requires', kind: 'wire', category: 'modality' },
])

const DOCUMENT_NODES: readonly GraphPanelNode[] = Object.freeze([
  { id: 'block-title', label: 'A Machine Is a Relation', kind: 'heading', blockId: 'title', order: 0, depth: 0 },
  { id: 'block-thesis', label: 'The machine transforms a flow.', kind: 'paragraph', blockId: 'thesis', order: 1, depth: 0 },
  { id: 'block-bullet', label: 'Inputs remain situated', kind: 'bullet', blockId: 'bullet', order: 2, depth: 1, parentId: 'block-thesis' },
  { id: 'block-task', label: 'Verify semantic behavior', kind: 'task', blockId: 'task', order: 3, depth: 1, parentId: 'block-thesis', checked: false },
  { id: 'block-code', label: 'transduce(input)', kind: 'code', blockId: 'code', order: 4, depth: 0, snippet: 'fn transduce(input: Flow) -> Relation' },
  { id: 'block-footnote', label: 'Operational closure', kind: 'footnote', blockId: 'footnote', order: 5, depth: 1, parentId: 'block-thesis' },
  { id: 'portal-neighbor', label: 'Neighboring Document', kind: 'portal', graphId: 'graph-proof', documentId: 'beta', parentId: 'block-task', snippet: 'Cross-document wires remain outside the helix.' },
])

const DOCUMENT_EDGES: readonly GraphPanelEdge[] = Object.freeze([
  { id: 'flow-0', from: 'block-title', to: 'block-thesis', predicate: 'precedes', predicateLabel: 'precedes' },
  { id: 'flow-1', from: 'block-thesis', to: 'block-bullet', predicate: 'precedes', predicateLabel: 'precedes' },
  { id: 'flow-2', from: 'block-bullet', to: 'block-task', predicate: 'precedes', predicateLabel: 'precedes' },
  { id: 'flow-3', from: 'block-task', to: 'block-code', predicate: 'precedes', predicateLabel: 'precedes' },
  { id: 'flow-4', from: 'block-code', to: 'block-footnote', predicate: 'precedes', predicateLabel: 'precedes' },
  { id: 'internal-wire', from: 'block-thesis', to: 'block-code', predicate: 'supports', predicateLabel: 'supports', kind: 'wire', category: 'quality' },
  { id: 'portal-wire', from: 'block-task', to: 'portal-neighbor', predicate: 'relatedTo', predicateLabel: 'related to', kind: 'wire', category: 'relation' },
])

interface GraphHarnessState {
  readonly ready: boolean
  readonly error: string | null
  readonly viewMode: GraphPanelViewMode
  readonly leftPanelMode: 'files' | 'graph'
  readonly leftCollapsed: boolean
  readonly rightPanel: RightPanelMode
  readonly rightCollapsed: boolean
  readonly selectedNodeId: string | null
  readonly selectedNodeIds: readonly string[]
  readonly activatedNodeIds: readonly string[]
  readonly refreshCount: number
  readonly projectionRevision: number
}

interface GraphHarnessBridge {
  readonly version: 1
  readonly state: GraphHarnessState
  setPanel(panel: RightPanelMode): void
  setCollapsed(collapsed: boolean): void
  mutateProjection(): void
}

declare global {
  interface Window {
    readonly __graphHarness?: GraphHarnessBridge
  }
}

const root = document.querySelector<HTMLElement>('#graph-harness-root')!
const status = document.querySelector<HTMLOutputElement>('#proof-status')!
const failure = document.querySelector<HTMLElement>('#graph-harness-failure')!

let ready = false
let bootError: string | null = null
let viewMode: GraphPanelViewMode = 'workspace'
let leftPanelMode: 'files' | 'graph' = 'files'
let leftCollapsed = false
let rightPanel: RightPanelMode = 'graph'
let rightCollapsed = false
let selectedNodeId: string | null = null
let selectedNodeIds: string[] = []
let activatedNodeIds: string[] = []
let refreshCount = 0
let projectionRevision = 0

function bridgeState(): GraphHarnessState {
  return Object.freeze({
    ready,
    error: bootError,
    viewMode,
    leftPanelMode,
    leftCollapsed,
    rightPanel,
    rightCollapsed,
    selectedNodeId,
    selectedNodeIds: Object.freeze([...selectedNodeIds]),
    activatedNodeIds: Object.freeze([...activatedNodeIds]),
    refreshCount,
    projectionRevision,
  })
}

function renderFixture(): void {
  renderWorkspace(GARDEN_DEFAULT, {
    container: root,
    app: 'garden',
    leftCollapsed,
    rightCollapsed,
    panelLayout: { rightWidth: 610 },
    chrome: {
      activeApp: 'garden',
      activeSkin: 'garden',
      leftPanelMode,
      rightPanel,
      breadcrumbs: [{ id: 'graph-proof', label: 'Proof Garden', kind: 'graph', current: true }],
      itemCount: WORKSPACE_NODES.length + (projectionRevision > 0 ? 1 : 0),
      syncState: 'synced',
      runtimeMode: 'local',
    },
    graphPanel: {
      title: 'Proof Garden',
      subtitle: 'Controlled Garden scene · browser proof',
      status: 'ready',
      nodes: projectionRevision > 0 ? [...WORKSPACE_NODES, MUTATED_WORKSPACE_NODE] : WORKSPACE_NODES,
      edges: projectionRevision > 0 ? [...WORKSPACE_EDGES, ...MUTATED_WORKSPACE_EDGES] : WORKSPACE_EDGES,
      documentNodes: DOCUMENT_NODES,
      documentEdges: DOCUMENT_EDGES,
      viewMode,
      selectedNodeId,
      onRefresh: () => {
        refreshCount += 1
        renderFixture()
      },
      onSelectNode: ({ id }) => {
        selectedNodeId = id
        selectedNodeIds = [...selectedNodeIds, id]
        renderFixture()
      },
      onOpenNode: ({ id }) => {
        activatedNodeIds = [...activatedNodeIds, id]
        renderFixture()
      },
      onViewModeChange: ({ mode }) => {
        viewMode = mode
        selectedNodeId = null
        renderFixture()
      },
    },
  })
  root.dataset.ready = String(ready)
  root.dataset.viewMode = viewMode
  root.dataset.leftPanelMode = leftPanelMode
  root.dataset.leftCollapsed = String(leftCollapsed)
  root.dataset.rightCollapsed = String(rightCollapsed)
  status.value = `${viewMode} · ${rightPanel === 'none' ? 'no panel' : rightPanel} · ${rightCollapsed ? 'collapsed' : 'expanded'}${selectedNodeId ? ` · selected ${selectedNodeId}` : ''}`
}

function setPanel(panel: RightPanelMode): void {
  rightPanel = panel
  rightCollapsed = panel === 'none'
  renderFixture()
}

function setCollapsed(collapsed: boolean): void {
  rightCollapsed = collapsed
  renderFixture()
}

function mutateProjection(): void {
  projectionRevision += 1
  renderFixture()
}

const bridge = {} as GraphHarnessBridge
Object.defineProperties(bridge, {
  version: { enumerable: true, value: 1 },
  state: { enumerable: true, get: bridgeState },
  setPanel: { enumerable: true, value: setPanel },
  setCollapsed: { enumerable: true, value: setCollapsed },
  mutateProjection: { enumerable: true, value: mutateProjection },
})
Object.freeze(bridge)
Object.defineProperty(window, '__graphHarness', {
  configurable: false,
  enumerable: false,
  value: bridge,
  writable: false,
})

document.querySelector('#proof-controls')?.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-proof-action]')?.dataset.proofAction
  if (action === 'graph-only') {
    setPanel('graph')
  } else if (action === 'comments') {
    setPanel('comments')
  } else if (action === 'graph') {
    setPanel('graph')
  } else if (action === 'mutate-projection') {
    mutateProjection()
  } else if (action === 'collapse') {
    setCollapsed(true)
  } else if (action === 'expand') {
    setCollapsed(false)
  }
})

root.addEventListener('mn-left-mode-change', ((event: CustomEvent<{ mode?: unknown }>) => {
  const mode = event.detail?.mode
  if (mode !== 'files' && mode !== 'graph') return
  leftPanelMode = mode
  leftCollapsed = false
  if (mode === 'graph') {
    if (rightPanel === 'graph') rightPanel = 'none'
    rightCollapsed = rightPanel === 'none'
  }
  renderFixture()
}) as EventListener)

root.addEventListener('mn-panel-toggle', ((event: CustomEvent<{ panel?: unknown }>) => {
  const panel = event.detail?.panel
  if (panel !== 'chat' && panel !== 'comments' && panel !== 'wires' && panel !== 'graph') return
  if (panel === 'graph' && leftPanelMode === 'graph') leftPanelMode = 'files'
  rightPanel = selectRightPanel(rightPanel, panel)
  rightCollapsed = rightPanel === 'none'
  renderFixture()
}) as EventListener)

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })
  renderFixture()
  await Promise.all([
    customElements.whenDefined('sh-graph-host'),
    customElements.whenDefined('mn-graph-panel'),
    customElements.whenDefined('mn-graph-three'),
  ])
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  ready = true
  renderFixture()
}

void boot().catch((error: unknown) => {
  bootError = error instanceof Error ? error.stack ?? error.message : String(error)
  failure.textContent = bootError
  failure.dataset.visible = ''
  root.dataset.error = 'true'
  renderFixture()
})
