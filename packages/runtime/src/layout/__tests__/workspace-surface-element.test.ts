import { html } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import {
  defineWorkspaceSurfaceElement,
  type WorkspaceBoundFaceDefinition,
  type WorkspaceSurfaceElement,
  type WorkspaceSurfaceModel,
} from '../workspace-surface-element.js'

const FACE_ID = 'test.persistent-editor-face'
let tagSequence = 0
const mountedSurfaces: WorkspaceSurfaceElement[] = []

function testTag(): string {
  tagSequence += 1
  return `test-workspace-surface-${tagSequence}`
}

function layoutDocument(): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'test-workspace-surface',
    scope: 'session',
    graphId: null,
    rootNodeId: 'editor',
    nodes: {
      editor: {
        kind: 'leaf',
        id: 'editor',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: FACE_ID,
          resource: { kind: 'iri', iri: 'urn:test:persistent-editor' },
          params: { bindingId: 'editor' },
        },
      },
    },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

function tabsLayoutDocument(layoutId = 'test-workspace-tabs-surface'): LayoutDocument {
  const leaf = (id: string): LayoutDocument['nodes'][string] => ({
    kind: 'leaf',
    id,
    descriptorRevision: 0,
    descriptor: {
      schemaVersion: 1,
      faceId: FACE_ID,
      resource: { kind: 'iri', iri: 'urn:test:persistent-editor' },
      params: { bindingId: id },
    },
  })
  return {
    schemaVersion: 1,
    layoutId,
    scope: 'session',
    graphId: 'test-tabs-graph',
    rootNodeId: 'tabs',
    nodes: {
      tabs: {
        kind: 'tabs',
        id: 'tabs',
        tabs: [
          { nodeId: 'pulse', label: 'Pulse' },
          { nodeId: 'fleet', label: 'Fleet' },
        ],
        activeNodeId: 'pulse',
        tabsRevision: 0,
      },
      pulse: leaf('pulse'),
      fleet: leaf('fleet'),
    },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}

interface SurfaceControllerAccess {
  readonly controller: {
    setSize(width: number, height: number): void
    dispose(): Promise<void>
  } | null
}

function controllerFor(surface: WorkspaceSurfaceElement): NonNullable<SurfaceControllerAccess['controller']> {
  const controller = (surface as unknown as SurfaceControllerAccess).controller
  if (!controller) throw new Error('workspace Surface controller was not created')
  return controller
}

function defineTestSurface(paints: string[]): string {
  const tag = testTag()
  const editorFace: WorkspaceBoundFaceDefinition = {
    faceId: FACE_ID,
    persistence: 'persistent-relocatable',
    accepts: locator => locator.kind === 'iri' && locator.iri === 'urn:test:persistent-editor',
    constraints: () => ({ minWidth: 1, minHeight: 1, overflow: 'clip' }),
    render: (_target, raw) => {
      const value = raw as { readonly text: string }
      paints.push(value.text)
      return html`<div data-test-editor contenteditable="true" tabindex="0">${value.text}</div>`
    },
  }
  defineWorkspaceSurfaceElement(tag, [editorFace])
  return tag
}

afterEach(async () => {
  for (const surface of mountedSurfaces.splice(0)) {
    const controller = (surface as unknown as SurfaceControllerAccess).controller
    surface.remove()
    await controller?.dispose()
  }
})

describe('Workspace Surface binding stability', () => {
  it('remeasures a model configured while detached when the Surface connects', async () => {
    const paints: string[] = []
    const tag = defineTestSurface(paints)
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    mountedSurfaces.push(surface)
    let connected = false
    surface.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: connected ? 1440 : 0,
      bottom: connected ? 1030 : 0,
      width: connected ? 1440 : 0,
      height: connected ? 1030 : 0,
      toJSON: () => ({}),
    })
    surface.model = {
      build: () => ({
        document: layoutDocument(),
        bindings: new Map<string, unknown>([['editor', { text: 'connected' }]]),
        metadata: null,
      }),
    }

    connected = true
    document.body.appendChild(surface)
    await surface.whenReady()

    const wrapper = surface.querySelector<HTMLElement>('[data-layout-node-id="editor"]')!
    expect(wrapper.style.width).toBe('1440px')
    expect(wrapper.style.height).toBe('1030px')
    expect(wrapper.hasAttribute('data-layout-constrained')).toBe(false)
  })

  it('retains an active tab across pure model and geometry rebuilds, then resets for a different layout', async () => {
    const paints: string[] = []
    const tag = defineTestSurface(paints)
    const bindings = new Map<string, unknown>([
      ['pulse', { text: 'pulse' }],
      ['fleet', { text: 'fleet' }],
    ])
    const model: WorkspaceSurfaceModel = {
      build: () => ({ document: tabsLayoutDocument(), bindings, metadata: null }),
    }
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    document.body.appendChild(surface)
    mountedSurfaces.push(surface)
    surface.model = model
    controllerFor(surface).setSize(800, 600)
    await surface.whenReady()

    const fleetTab = surface.querySelector<HTMLButtonElement>('[data-layout-tab-node-id="fleet"]')!
    fleetTab.click()
    await surface.whenReady()
    // Reconciliation intentionally replaces tab-strip buttons so their event
    // closures always capture the newest tabsRevision; inspect the current
    // button, not the pre-click DOM node.
    expect(surface.querySelector('[data-layout-tab-node-id="fleet"]')?.getAttribute('aria-selected')).toBe('true')
    expect(surface.surfaceDocument()?.nodes.tabs).toMatchObject({
      kind: 'tabs',
      activeNodeId: 'fleet',
      tabsRevision: 1,
    })

    // A geometry pass calls the pure builder again with its seed default
    // (`pulse`, revision 0). The user's newer choice must survive it.
    controllerFor(surface).setSize(640, 480)
    await surface.whenReady()
    expect(surface.querySelector('[data-layout-tab-node-id="fleet"]')?.getAttribute('aria-selected')).toBe('true')
    expect(surface.surfaceDocument()?.nodes.tabs).toMatchObject({
      kind: 'tabs',
      activeNodeId: 'fleet',
      tabsRevision: 1,
    })

    // State never leaks into another authored surface identity.
    surface.model = {
      build: () => ({ document: tabsLayoutDocument('different-layout'), bindings, metadata: null }),
    }
    await surface.whenReady()
    expect(surface.querySelector('[data-layout-tab-node-id="pulse"]')?.getAttribute('aria-selected')).toBe('true')
    expect(surface.surfaceDocument()?.nodes.tabs).toMatchObject({
      kind: 'tabs',
      activeNodeId: 'pulse',
      tabsRevision: 0,
    })
  })

  it('updates geometry without repainting or remounting a focused persistent editor face', async () => {
    const paints: string[] = []
    const tag = defineTestSurface(paints)
    const documentModel = layoutDocument()
    const stableBindings = new Map<string, unknown>([['editor', { text: 'draft' }]])
    const model: WorkspaceSurfaceModel = {
      build: () => ({ document: documentModel, bindings: stableBindings, metadata: null }),
    }
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    document.body.appendChild(surface)
    mountedSurfaces.push(surface)
    surface.model = model
    await surface.whenReady()

    const wrapperBefore = surface.querySelector<HTMLElement>('[data-layout-node-id="editor"]')!
    const editorBefore = surface.querySelector<HTMLElement>('[data-test-editor]')!
    editorBefore.focus()
    expect(document.activeElement).toBe(editorBefore)
    expect(paints).toEqual(['draft'])

    controllerFor(surface).setSize(844, 640)
    await surface.whenReady()
    controllerFor(surface).setSize(390, 500)
    await surface.whenReady()

    const wrapperAfter = surface.querySelector<HTMLElement>('[data-layout-node-id="editor"]')!
    const editorAfter = surface.querySelector<HTMLElement>('[data-test-editor]')!
    expect(wrapperAfter).toBe(wrapperBefore)
    expect(editorAfter).toBe(editorBefore)
    expect(document.activeElement).toBe(editorBefore)
    expect(wrapperAfter.style.width).toBe('390px')
    expect(wrapperAfter.style.height).toBe('500px')
    expect(paints).toEqual(['draft'])

    // A fresh map is an explicit semantic refresh even when its entries happen
    // to be equal, so generic models retain their existing repaint semantics.
    const refreshedBindings = new Map<string, unknown>([['editor', stableBindings.get('editor')]])
    surface.model = {
      build: () => ({ document: documentModel, bindings: refreshedBindings, metadata: null }),
    }
    await surface.whenReady()
    expect(paints).toEqual(['draft', 'draft'])
    expect(surface.querySelector('[data-test-editor]')).toBe(editorBefore)

    const changedBindings = new Map<string, unknown>([['editor', { text: 'published' }]])
    surface.model = {
      build: () => ({ document: documentModel, bindings: changedBindings, metadata: null }),
    }
    await surface.whenReady()

    expect(surface.querySelector('[data-layout-node-id="editor"]')).toBe(wrapperBefore)
    expect(surface.querySelector('[data-test-editor]')).toBe(editorBefore)
    expect(editorBefore.textContent).toBe('published')
    expect(paints).toEqual(['draft', 'draft', 'published'])
  })

  it('still repaints a generic model that returns new, geometry-dependent bindings', async () => {
    const paints: string[] = []
    const tag = defineTestSurface(paints)
    const documentModel = layoutDocument()
    const model: WorkspaceSurfaceModel = {
      build: (width, height) => ({
        document: documentModel,
        bindings: new Map<string, unknown>([['editor', { text: `${width}x${height}` }]]),
        metadata: null,
      }),
    }
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    document.body.appendChild(surface)
    mountedSurfaces.push(surface)
    surface.model = model
    await surface.whenReady()
    const paintCountBeforeResize = paints.length

    controllerFor(surface).setSize(390, 500)
    await surface.whenReady()

    expect(paints).toHaveLength(paintCountBeforeResize + 1)
    expect(paints.at(-1)).toBe('390x500')
    expect(surface.querySelector('[data-test-editor]')?.textContent).toBe('390x500')
  })

  it('binds code-owned values to descriptors in a fixed reflow grid', async () => {
    const paints: string[] = []
    const tag = defineTestSurface(paints)
    const gridDocument: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'test-workspace-grid-surface',
      scope: 'session',
      graphId: null,
      rootNodeId: 'grid',
      nodes: {
        grid: {
          kind: 'grid',
          id: 'grid',
          flow: 'reflow',
          minCellWidth: 180,
          gridRevision: 0,
          children: {
            kind: 'fixed',
            cells: [{
              id: 'editor-cell',
              descriptor: {
                schemaVersion: 1,
                faceId: FACE_ID,
                resource: { kind: 'iri', iri: 'urn:test:persistent-editor' },
                params: { bindingId: 'editor' },
              },
            }],
          },
        },
      },
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    const surface = document.createElement(tag) as WorkspaceSurfaceElement
    document.body.appendChild(surface)
    mountedSurfaces.push(surface)
    surface.model = {
      build: () => ({
        document: gridDocument,
        bindings: new Map<string, unknown>([['editor', { text: 'grid-bound' }]]),
        metadata: null,
      }),
    }
    controllerFor(surface).setSize(640, 420)
    await surface.whenReady()

    expect(surface.querySelector('[data-layout-grid-cell-id="editor-cell"]')).not.toBeNull()
    expect(surface.querySelector('[data-test-editor]')?.textContent).toBe('grid-bound')
    expect(paints).toEqual(['grid-bound'])
  })
})
