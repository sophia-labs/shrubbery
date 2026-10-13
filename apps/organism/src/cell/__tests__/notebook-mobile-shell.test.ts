import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { RenderWorkspaceOptions } from '@shrubbery/runtime'
import { fragmentNodeId } from '@shrubbery/runtime/layout'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { createShellContext } from '../shell-context.js'
import { OrganismMobileShellController } from '../mobile-shell-controller.js'

const surface = 'urn:sophia:ux:surface:agent-notebook:fixture'
const queryService = { async run(): Promise<never> { throw new Error('No reads in this projection-only test') } }
const doc: LayoutDocument = {
  schemaVersion: 1, layoutId: 'notebook-fixture', graphId: 'fixture', scope: 'session', rootNodeId: 'split',
  createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
  nodes: {
    split: { kind: 'split', id: 'split', axis: 'horizontal', startBasisPoints: 6500, startNodeId: 'cells', endNodeId: 'family' },
    cells: { kind: 'grid', id: 'cells', gridRevision: 0, flow: 'stack', minCellWidth: 640, children: { kind: 'fixed', cells: [] } },
    family: { kind: 'leaf', id: 'family', descriptorRevision: 0, descriptor: { schemaVersion: 1, faceId: 'agent.session-family', resource: { kind: 'graph', graphId: 'fixture' } } },
  },
}

class Media extends EventTarget {
  matches = true
  set(value: boolean) { this.matches = value; this.dispatchEvent(new Event('change')) }
}
const controllers: OrganismMobileShellController[] = []
function fixture() {
  const host = document.createElement('main')
  host.innerHTML = `<div class="app-container"><div class="main"><sh-workspace-surface>
    <div data-layout-node-id="${fragmentNodeId('region-center', 'split')}" data-layout-node-kind="split" style="left:20px;top:0px;width:355px;height:600px"></div>
    <div data-layout-node-id="${fragmentNodeId('region-center', 'cells')}" data-layout-node-kind="grid" style="left:20px;top:0px;width:230px;height:600px"><div id="cell-identity"></div></div>
    <div data-layout-node-id="${fragmentNodeId('region-center', 'family')}" data-layout-node-kind="leaf" style="left:254px;top:0px;width:121px;height:600px"></div>
    <div data-layout-node-id="unrelated" data-layout-node-kind="leaf"></div>
    <div data-layout-node-id="${fragmentNodeId('region-right', 'family')}" data-layout-node-kind="leaf"></div>
  </sh-workspace-surface></div><sh-editor-host id="mn-editor-host"></sh-editor-host></div>`
  document.body.append(host)
  const media = new Media()
  const controller = new OrganismMobileShellController({ matchMedia: () => media as unknown as MediaQueryList, visualViewport: null, innerWidth: () => 375, innerHeight: () => 720, requestAnimationFrame: callback => { callback(0); return 1 }, vibrate: () => true })
  controllers.push(controller)
  const context = (documentId: string | null = null, graphId = 'fixture') => createShellContext({ host, graphId, documentId, app: 'garden', source: 'CELL_LIVE', deploymentMode: 'hosted', contract: null, location: new URL('http://localhost/'), rerender() {} })
  const snapshot = (surfaceIri = surface): RenderWorkspaceOptions => ({
    fragments: { queryService, regions: { 'region-center': { surfaceIri, state: { status: 'ready', doc } } } },
    chrome: { workspaceStatus: 'ready' },
    sidebar: { sections: [{ id: 'documents', label: 'Documents', nodes: [{ id: 'note', kind: 'document', label: 'Note' }] }], status: 'ready' },
  })
  const select = (tab: 'home' | 'browse') => document.querySelector('mn-mobile-tabs')!.dispatchEvent(new CustomEvent('navigation-change', { detail: { tab } }))
  return { host, media, controller, context, snapshot, select }
}

afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); document.querySelectorAll('main').forEach(el => el.remove()) })

describe('notebook-aware mobile projection', () => {
  it('projects only the actual center notebook nodes into the available rectangle, without moving hosts', () => {
    const f = fixture(), cell = f.host.querySelector('#cell-identity'), editor = f.host.querySelector('#mn-editor-host')
    f.controller.update(f.context(), f.snapshot())
    expect(f.host.dataset.mobileNotebook).toBe('true')
    expect(document.querySelector<HTMLElement>('.organism-mobile-home')!.dataset.visible).toBe('false')
    expect([...f.host.querySelectorAll<HTMLElement>('[data-mobile-notebook-node]')].map(el => el.dataset.layoutNodeId)).toEqual(['split', 'cells', 'family'].map(id => fragmentNodeId('region-center', id)))
    expect(f.host.querySelector<HTMLElement>('[data-layout-node-kind="grid"]')!.style.getPropertyValue('--mobile-notebook-left')).toBe('0%')
    expect(f.host.querySelector('#cell-identity')).toBe(cell)
    expect(f.host.querySelector('#mn-editor-host')).toBe(editor)
  })

  it.each(['loading', 'error'] as const)('retains the renderer’s honest %s status instead of empty generic Home', status => {
    const f = fixture()
    f.host.querySelector('sh-workspace-surface')!.innerHTML = '<div data-layout-node-id="workspace-fragment-status:region-center" data-layout-node-kind="leaf" style="left:20px;top:0px;width:355px;height:600px"><div data-layout-fragment-status="' + status + '" data-fragment-region="region-center" role="status">Real renderer status</div></div><div data-layout-node-id="unrelated" data-layout-node-kind="leaf"></div>'
    f.controller.update(f.context(), { ...f.snapshot(), fragments: { queryService, regions: { 'region-center': { surfaceIri: surface, state: status === 'loading' ? { status } : { status, error: 'Synthetic read unavailable' } } } } })
    expect(f.host.querySelector('[data-layout-fragment-status]')!.closest('[data-mobile-notebook-node]')).not.toBeNull()
    expect(f.host.querySelector('[data-layout-node-id="unrelated"]')!.hasAttribute('data-mobile-notebook-node')).toBe(false)
    expect(document.querySelector<HTMLElement>('.organism-mobile-home')!.dataset.visible).toBe('false')
  })

  it('uses existing Browse/document/Home intents and forgets notebook authority on a graph change', () => {
    const f = fixture()
    let homes = 0
    f.host.addEventListener('mn-navigate-home', () => { homes++; f.controller.update(f.context(), f.snapshot()) })
    const base = f.snapshot()
    const snapshot: RenderWorkspaceOptions = { ...base, sidebar: { ...base.sidebar,
      onNodeOpen: () => f.controller.update(f.context('note'), { ...base, fragments: null }) } }
    f.controller.update(f.context(), snapshot)
    f.select('browse')
    expect(document.querySelector<HTMLElement>('.organism-mobile-files')!.dataset.visible).toBe('true')
    expect(f.host.dataset.mobileNotebook).toBe('false')
    document.querySelector('mn-mobile-file-list')!.dispatchEvent(new CustomEvent('document-open', { detail: { documentId: 'note' } }))
    expect(f.controller.state.view).toBe('document')
    expect(f.host.dataset.mobileNotebook).toBe('false')
    f.select('home')
    expect(homes).toBe(1)
    expect(f.controller.state.view).toBe('root')
    expect(f.host.dataset.mobileNotebook).toBe('true')
    f.controller.update(f.context('note', 'ordinary'), { sidebar: snapshot.sidebar })
    f.select('browse'); f.select('home')
    expect(homes).toBe(1)
  })

  it('keeps ordinary/custom mobile Home and explicit document routing unchanged', () => {
    const f = fixture()
    f.controller.update(f.context(), f.snapshot('urn:sophia:ux:surface:custom:other'))
    expect(f.host.dataset.mobileNotebook).toBe('false')
    expect(f.host.querySelectorAll('[data-mobile-notebook-node]')).toHaveLength(0)
    expect(document.querySelector<HTMLElement>('.organism-mobile-home')!.dataset.visible).toBe('true')
    f.controller.update(f.context('note'), f.snapshot())
    expect(f.controller.state.view).toBe('document')
    expect(f.host.dataset.mobileNotebook).toBe('false')
  })

  it('does not reveal an inactive notebook tab or an unreferenced leaf merely sharing the region namespace', () => {
    const f = fixture()
    const qualified = fragmentNodeId('region-center', 'unused')
    const unused = document.createElement('div')
    unused.dataset.layoutNodeKind = 'leaf'; unused.dataset.layoutNodeId = qualified
    unused.style.cssText = 'left:20px;top:0px;width:355px;height:600px'
    f.host.querySelector('sh-workspace-surface')!.append(unused)
    const family = doc.nodes.family
    const tabDoc: LayoutDocument = { ...doc, nodes: { ...doc.nodes,
      split: { kind: 'split', id: 'split', axis: 'horizontal', startBasisPoints: 6500, startNodeId: 'cells', endNodeId: 'tabs' },
      tabs: { kind: 'tabs', id: 'tabs', tabsRevision: 0, activeNodeId: 'family', tabs: [{ nodeId: 'family', label: 'Family' }, { nodeId: 'unused', label: 'Hidden' }] },
      unused: { ...family, id: 'unused' },
    } }
    f.controller.update(f.context(), { ...f.snapshot(), fragments: { queryService, regions: { 'region-center': { surfaceIri: surface, state: { status: 'ready', doc: tabDoc } } } } })
    expect(unused.hasAttribute('data-mobile-notebook-node')).toBe(false)
    expect(f.host.querySelector(`[data-layout-node-id="${fragmentNodeId('region-center', 'family')}"]`)!.hasAttribute('data-mobile-notebook-node')).toBe(true)
  })

  it('updates after asynchronous geometry/viewport changes, and removes owned projection on destroy', async () => {
    const f = fixture(), cell = f.host.querySelector('#cell-identity')
    f.controller.update(f.context(), f.snapshot())
    const grid = f.host.querySelector<HTMLElement>('[data-layout-node-kind="grid"]')!
    grid.style.width = '177.5px'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(grid.style.getPropertyValue('--mobile-notebook-width')).toBe('50%')
    f.media.set(false)
    expect(f.host.querySelectorAll('[data-mobile-notebook-node]')).toHaveLength(0)
    f.media.set(true)
    expect(f.host.dataset.mobileNotebook).toBe('true')
    expect(f.host.querySelector('#cell-identity')).toBe(cell)
    f.controller.destroy()
    expect(f.host.hasAttribute('data-mobile-notebook')).toBe(false)
    expect(f.host.querySelectorAll('[data-mobile-notebook-node]')).toHaveLength(0)
    expect(grid.style.getPropertyValue('--mobile-notebook-width')).toBe('')
    grid.style.width = '230px'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(grid.hasAttribute('data-mobile-notebook-node')).toBe(false)
    expect(document.querySelector('.organism-mobile-shell')).toBeNull()
  })
})
