/** Real Happy DOM contract for the controlled Class-C graph panel face. */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import '../mn-graph-panel.js'
import type {
  MnGraphPanel,
  MnGraphPanelNodeOpenDetail,
  MnGraphPanelNodeSelectDetail,
  MnGraphPanelRefreshDetail,
  MnGraphPanelViewModeChangeDetail,
} from '../mn-graph-panel.js'

async function mount(setup?: (el: MnGraphPanel) => void): Promise<MnGraphPanel> {
  const el = document.createElement('mn-graph-panel') as MnGraphPanel
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnGraphPanel) => el.shadowRoot!

afterEach(() => { document.body.innerHTML = '' })

describe('mn-graph-panel - controlled Garden scene', () => {
  beforeAll(() => {
    expect(customElements.get('mn-graph-panel')).toBeDefined()
  })

  it('renders loading, error, workspace-empty, and document-empty honestly', async () => {
    const el = await mount((node) => { node.status = 'loading' })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()

    el.status = 'error'
    el.error = 'projection failed'
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('Could not load graph')

    el.status = 'ready'
    el.error = ''
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('Your space awaits')

    el.viewMode = 'document'
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No document open')
  })

  it('renders the Three.js child from the active controlled projection', async () => {
    const workspaceNodes = [
      { id: 'graph:g', label: 'g', kind: 'graph' as const },
      { id: 'doc:a', label: 'A', kind: 'document' as const, documentId: 'a' },
    ]
    const workspaceEdges = [{ from: 'graph:g', to: 'doc:a', predicate: 'contains' }]
    const documentNodes = [{ id: 'b1', label: 'Heading', kind: 'heading' as const, blockId: 'b1' }]
    const el = await mount((node) => {
      node.title = 'Knowledge Space'
      node.status = 'ready'
      node.nodes = workspaceNodes
      node.edges = workspaceEdges
      node.documentNodes = documentNodes
      node.selectedNodeId = 'doc:a'
    })

    const graph = sr(el).querySelector('mn-graph-three') as unknown as HTMLElement & Record<string, unknown>
    expect(graph).not.toBeNull()
    expect(graph.nodes).toBe(workspaceNodes)
    expect(graph.edges).toBe(workspaceEdges)
    expect(graph.interactive).toBe(true)
    expect(graph.dimension).toBe('3d')
    expect(graph.selectedNodeId).toBe('doc:a')
    expect(sr(el).querySelector('.count')?.textContent).toBe('2')

    el.viewMode = 'document'
    await el.updateComplete
    expect(graph.nodes).toBe(documentNodes)
    expect(graph.viewMode).toBe('document')
  })

  it('separates select, activate, refresh, and controlled mode-change intents', async () => {
    const node = { id: 'doc:a', label: 'A', kind: 'document' as const, documentId: 'a' }
    const el = await mount((target) => {
      target.status = 'ready'
      target.nodes = [node]
      target.documentNodes = [{ id: 'b1', kind: 'paragraph', blockId: 'b1' }]
    })
    const refreshes: MnGraphPanelRefreshDetail[] = []
    const selects: MnGraphPanelNodeSelectDetail[] = []
    const opens: MnGraphPanelNodeOpenDetail[] = []
    const modes: MnGraphPanelViewModeChangeDetail[] = []
    el.addEventListener('mn-graph-panel-refresh', (event) => refreshes.push((event as CustomEvent<MnGraphPanelRefreshDetail>).detail))
    el.addEventListener('mn-graph-panel-node-select', (event) => selects.push((event as CustomEvent<MnGraphPanelNodeSelectDetail>).detail))
    el.addEventListener('mn-graph-panel-node-open', (event) => opens.push((event as CustomEvent<MnGraphPanelNodeOpenDetail>).detail))
    el.addEventListener('mn-graph-panel-view-mode-change', (event) => modes.push((event as CustomEvent<MnGraphPanelViewModeChangeDetail>).detail))

    ;(sr(el).querySelector('[aria-label="Refresh graph"]') as HTMLButtonElement).click()
    const graph = sr(el).querySelector('mn-graph-three') as HTMLElement
    graph.dispatchEvent(new CustomEvent('mn-graph-node-select', { bubbles: true, composed: true, detail: node }))
    graph.dispatchEvent(new CustomEvent('mn-graph-node-activate', { bubbles: true, composed: true, detail: node }))
    ;(sr(el).querySelector('[aria-label="Show this document"]') as HTMLButtonElement).click()

    expect(refreshes).toEqual([{ reason: 'manual' }])
    expect(selects).toEqual([{ id: 'doc:a', node }])
    expect(opens).toEqual([{ id: 'doc:a', node }])
    expect(modes).toEqual([{ mode: 'document' }])
    expect(el.viewMode).toBe('workspace')
  })

  it('gates back/forward navigation buttons on controlled canNavigateBack/canNavigateForward props and emits intents', async () => {
    const el = await mount((target) => {
      target.status = 'ready'
      target.canNavigateBack = false
      target.canNavigateForward = true
    })
    const back = sr(el).querySelector('[aria-label="Back to previous node"]') as HTMLButtonElement
    const forward = sr(el).querySelector('[aria-label="Forward to next node"]') as HTMLButtonElement
    expect(back).not.toBeNull()
    expect(forward).not.toBeNull()
    expect(back.disabled).toBe(true)
    expect(forward.disabled).toBe(false)

    const backEvents: unknown[] = []
    const forwardEvents: unknown[] = []
    el.addEventListener('mn-graph-panel-navigate-back', () => backEvents.push(true))
    el.addEventListener('mn-graph-panel-navigate-forward', () => forwardEvents.push(true))

    back.click()
    expect(backEvents).toHaveLength(0) // disabled button: no navigate-back intent

    forward.click()
    expect(forwardEvents).toHaveLength(1)

    el.canNavigateBack = true
    await el.updateComplete
    back.click()
    expect(backEvents).toHaveLength(1)
  })
})
