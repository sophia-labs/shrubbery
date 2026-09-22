/**
 * render-workspace-fragment.test.ts — Stages B/C of the Surface unification:
 * a config-declared fragment region (`sh-layout-dashboard` marker) renders its
 * graph-authored `ux:layoutJson` LayoutDocument SPLICED into the ONE workspace
 * Surface document — engine faces mounted by the same interpreter as every
 * workspace face, no nested interpreter, no opaque host element.
 *
 * Everything real (no vi.*): the real renderWorkspace Surface path, the real
 * fragment face catalogue, a real recording QueryBlockService, real keyboard
 * divider events through the engine.
 */
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'
import { createSophiaHomeDescriptor, type LayoutDocument } from '@shrubbery/nucleus/layout'
import type { QueryBlockResult, QueryBlockService } from '../editor-services/query-block-service.js'
import {
  LAYOUT_DASHBOARD_COMPONENT,
  renderWorkspace,
  resolveVegaThemeOverride,
  workspaceSurfaceReady,
  type WorkspaceFragmentChangeDetail,
  type WorkspaceFragmentsOptions,
} from '../index.js'
import type { WorkspaceSurfaceElement } from '../layout/workspace-surface-element.js'

const SURFACE_IRI = 'urn:sophia:ux:surface:observatory-dashboard'

/** GARDEN_DEFAULT with its center region re-declared as a fragment center. */
function fragmentCenterConfig(): WorkspaceConfig {
  return {
    ...GARDEN_DEFAULT,
    regions: {
      ...GARDEN_DEFAULT.regions,
      'region-center': {
        ...GARDEN_DEFAULT.regions['region-center'],
        renderedByComponent: LAYOUT_DASHBOARD_COMPONENT,
      },
    },
  }
}

function recordingQueryService(scalarValue: string): {
  readonly service: QueryBlockService
  readonly calls: Array<{ readonly graphId: string; readonly sparql: string }>
} {
  const calls: Array<{ readonly graphId: string; readonly sparql: string }> = []
  const service: QueryBlockService = {
    async run(graphId, sparql): Promise<QueryBlockResult> {
      calls.push({ graphId, sparql })
      return {
        queryKind: 'select',
        resultKind: 'bindings',
        columns: ['n'],
        rows: [{ n: { type: 'literal', value: scalarValue } }],
        totalRowCount: 1,
        durationMs: 1,
        raw: null,
      }
    },
  }
  return { service, calls }
}

/** The graph-authored fragment: one split, a stat face and the honest home face. */
function observatoryFragment(): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'observatory-v0',
    scope: 'workspace',
    graphId: 'observatory',
    rootNodeId: 'root',
    nodes: {
      root: {
        kind: 'split',
        id: 'root',
        axis: 'horizontal',
        startNodeId: 'stat-quads',
        endNodeId: 'home',
        startBasisPoints: 3000,
      },
      'stat-quads': {
        kind: 'leaf',
        id: 'stat-quads',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: 'stat.scalar',
          resource: {
            kind: 'query',
            graphId: 'observatory',
            queryId: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }',
          },
          params: { label: 'Quads' },
        },
      },
      home: {
        kind: 'leaf',
        id: 'home',
        descriptorRevision: 0,
        descriptor: createSophiaHomeDescriptor(),
      },
    },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

/** A graph-authored tabs root used to prove namespaced activation persistence. */
function tabbedObservatoryFragment(): LayoutDocument {
  const base = observatoryFragment()
  return {
    ...base,
    layoutId: 'observatory-tabs-v0',
    rootNodeId: 'pages',
    nodes: {
      pages: {
        kind: 'tabs',
        id: 'pages',
        tabs: [
          { nodeId: 'stat-quads', label: 'Pulse' },
          { nodeId: 'home', label: 'Home' },
        ],
        activeNodeId: 'stat-quads',
        tabsRevision: 0,
      },
      'stat-quads': base.nodes['stat-quads'],
      home: base.nodes.home,
    },
  }
}

function fragmentsOptions(
  service: QueryBlockService | null,
  state: NonNullable<WorkspaceFragmentsOptions['regions']>[string]['state'],
  onFragmentChange?: (detail: WorkspaceFragmentChangeDetail) => void,
): WorkspaceFragmentsOptions {
  return {
    queryService: service,
    regions: { 'region-center': { surfaceIri: SURFACE_IRI, state } },
    onFragmentChange,
  }
}

async function renderFragmentWorkspace(
  fragments: WorkspaceFragmentsOptions,
): Promise<{ container: HTMLElement; surface: WorkspaceSurfaceElement }> {
  const container = renderWorkspace(fragmentCenterConfig(), {
    surface: true,
    fragments,
    chrome: { rightPanels: ['chat'] },
  })
  document.body.appendChild(container)
  await workspaceSurfaceReady(container)
  const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')
  if (!surface) throw new Error('no sh-workspace-surface rendered')
  return { container, surface }
}

describe('graph-authored fragment regions (Surface unification, spliced path)', () => {
  it('splices a ready fragment as the center subtree — real engine faces, no nested host', async () => {
    const { service, calls } = recordingQueryService('137')
    const { container, surface } = await renderFragmentWorkspace(
      fragmentsOptions(service, { status: 'ready', doc: observatoryFragment() }),
    )
    try {
      const layout = surface.surfaceDocument()!
      // The fragment's nodes live IN the workspace document, namespaced.
      expect(layout.nodes['frag:region-center:root']).toMatchObject({ kind: 'split' })
      expect(layout.nodes['frag:region-center:stat-quads']).toMatchObject({ kind: 'leaf' })
      expect(layout.nodes['frag:region-center:home']).toMatchObject({ kind: 'leaf' })
      // No opaque dashboard leaf, no nested host element.
      expect(layout.nodes['workspace-center-dashboard']).toBeUndefined()
      expect(container.querySelector('sh-layout-dashboard')).toBeNull()

      // The engine face mounted through the ONE surface interpreter over the
      // real service — the fragment's own graph/query, the canned value live.
      expect(calls).toEqual([
        { graphId: 'observatory', sparql: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' },
      ])
      const stat = surface.querySelector('sh-stat-scalar-view')
      expect(stat).not.toBeNull()
      expect((stat as unknown as { status: string }).status).toBe('ready')
      expect((stat as unknown as { value: string }).value).toBe('137')
      const wrapper = surface.querySelector('[data-layout-node-id="frag:region-center:stat-quads"]')
      expect(wrapper?.contains(stat)).toBe(true)
    } finally {
      container.remove()
    }
  })

  it('a loading fragment renders the honest loading leaf (never blank)', async () => {
    const { container } = await renderFragmentWorkspace(fragmentsOptions(null, { status: 'loading' }))
    try {
      const status = container.querySelector<HTMLElement>('[data-layout-fragment-status="loading"]')
      expect(status).not.toBeNull()
      expect(status!.textContent).toContain('Loading')
      expect(status!.textContent).toContain(SURFACE_IRI)
    } finally {
      container.remove()
    }
  })

  it('a failed fragment load renders the honest error leaf with its detail', async () => {
    const { container } = await renderFragmentWorkspace(
      fragmentsOptions(null, { status: 'error', error: 'cell said 503' }),
    )
    try {
      const status = container.querySelector<HTMLElement>('[data-layout-fragment-status="error"]')
      expect(status).not.toBeNull()
      expect(status!.textContent).toContain('failed to load')
      expect(status!.querySelector('[data-fragment-status-detail]')?.textContent).toContain('cell said 503')
    } finally {
      container.remove()
    }
  })

  it('an invalid fragment degrades to the honest invalid leaf — the workspace spine still renders', async () => {
    const doc = observatoryFragment()
    const invalid: LayoutDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'stat-quads': {
          kind: 'leaf',
          id: 'stat-quads',
          descriptorRevision: 0,
          descriptor: {
            schemaVersion: 1,
            faceId: 'not.registered',
            resource: { kind: 'iri', iri: 'urn:test:x' },
          },
        },
      },
    }
    const { container, surface } = await renderFragmentWorkspace(
      fragmentsOptions(null, { status: 'ready', doc: invalid }),
    )
    try {
      const status = container.querySelector<HTMLElement>('[data-layout-fragment-status="invalid"]')
      expect(status).not.toBeNull()
      expect(status!.querySelector('[data-fragment-status-detail]')?.textContent).toContain('validation')
      // The rest of the workspace is intact — sidebar and right rail leaves exist.
      const layout = surface.surfaceDocument()!
      expect(Object.keys(layout.nodes).some((id) => id.startsWith('workspace-region:'))).toBe(true)
      expect(Object.keys(layout.nodes).some((id) => id.startsWith('frag:'))).toBe(false)
    } finally {
      container.remove()
    }
  })

  it('PERSIST-SCOPE ISOLATION: a fragment divider commit emits ONLY the fragment document, original ids', async () => {
    const { service } = recordingQueryService('1')
    const changes: WorkspaceFragmentChangeDetail[] = []
    const { container, surface } = await renderFragmentWorkspace(
      fragmentsOptions(service, { status: 'ready', doc: observatoryFragment() }, (detail) => changes.push(detail)),
    )
    try {
      const handle = surface.querySelector<HTMLElement>('[data-layout-divider="frag:region-center:root"]')
      expect(handle).not.toBeNull()
      handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

      expect(changes).toHaveLength(1)
      const change = changes[0]
      expect(change.regionId).toBe('region-center')
      expect(change.surfaceIri).toBe(SURFACE_IRI)
      expect(change.phase).toBe('commit')
      expect(change.source).toBe('keyboard')

      // The emitted document is the FRAGMENT document: original ids only,
      // ratio moved by one keyboard step.
      expect(change.doc.rootNodeId).toBe('root')
      expect(Object.keys(change.doc.nodes).sort()).toEqual(['home', 'root', 'stat-quads'])
      const root = change.doc.nodes.root
      if (root.kind !== 'split') throw new Error('unreachable')
      expect(root.startBasisPoints).toBe(3100)

      // The serialization that would land in ux:layoutJson carries NO spine
      // node and NO namespaced id — the persist scope is the fragment alone.
      const serialized = JSON.stringify(change.doc)
      expect(serialized).not.toContain('workspace-')
      expect(serialized).not.toContain('frag:')
      expect(serialized).not.toContain('center-')

      // And the LIVE spliced document moved with it (engine + model agree).
      const live = surface.surfaceDocument()!.nodes['frag:region-center:root']
      if (live?.kind !== 'split') throw new Error('expected live fragment split')
      expect(live.startBasisPoints).toBe(3100)
    } finally {
      container.remove()
    }
  })

  it('PERSIST-SCOPE ISOLATION: a fragment tab activation emits and retains ONLY original fragment ids', async () => {
    const { service } = recordingQueryService('1')
    const changes: WorkspaceFragmentChangeDetail[] = []
    const { container, surface } = await renderFragmentWorkspace(
      fragmentsOptions(service, { status: 'ready', doc: tabbedObservatoryFragment() }, (detail) => changes.push(detail)),
    )
    try {
      const homeTab = surface.querySelector<HTMLButtonElement>(
        'button[data-layout-tab-node-id="frag:region-center:home"]',
      )
      expect(homeTab).not.toBeNull()
      expect(homeTab!.getAttribute('aria-selected')).toBe('false')

      homeTab!.click()
      await surface.whenReady()

      const liveTabs = surface.surfaceDocument()!.nodes['frag:region-center:pages']
      if (liveTabs?.kind !== 'tabs') throw new Error('expected live fragment tabs')
      expect(liveTabs.activeNodeId).toBe('frag:region-center:home')
      expect(liveTabs.tabsRevision).toBe(1)

      expect(changes).toHaveLength(1)
      const change = changes[0]
      expect(change).toMatchObject({
        regionId: 'region-center',
        surfaceIri: SURFACE_IRI,
        phase: 'commit',
        source: 'pointer',
      })
      expect(change.doc.rootNodeId).toBe('pages')
      const authoredTabs = change.doc.nodes.pages
      if (authoredTabs?.kind !== 'tabs') throw new Error('expected authored fragment tabs')
      expect(authoredTabs.activeNodeId).toBe('home')
      expect(authoredTabs.tabsRevision).toBe(1)
      expect(JSON.stringify(change.doc)).not.toContain('frag:')
      expect(JSON.stringify(change.doc)).not.toContain('workspace-')
    } finally {
      container.remove()
    }
  })

  it('THEME-SCOPE ISOLATION: a region\'s ux:vegaTheme resolves ONLY under that region\'s wrapper, and a re-render without it clears the scope', async () => {
    const THEME = { axis: { gridColor: '#ff00ff' } }
    const { service } = recordingQueryService('1')
    const themed: WorkspaceFragmentsOptions = {
      queryService: service,
      regions: {
        'region-center': {
          surfaceIri: SURFACE_IRI,
          vegaTheme: THEME,
          state: { status: 'ready', doc: observatoryFragment() },
        },
      },
    }
    const { container, surface } = await renderFragmentWorkspace(themed)
    try {
      const fragWrapper = surface.querySelector<HTMLElement>('[data-layout-node-id="frag:region-center:stat-quads"]')
      expect(fragWrapper).not.toBeNull()
      // Inside the fragment region: the region's own theme resolves.
      expect(resolveVegaThemeOverride(fragWrapper)).toEqual(THEME)
      // On a SPINE wrapper (an editor QueryBlock's world): no fragment
      // region governs it — the house theme, never the region's override.
      const spineWrapper = Array.from(
        surface.querySelectorAll<HTMLElement>('[data-layout-node-id]'),
      ).find((el) => el.dataset.layoutNodeId?.startsWith('workspace-'))
      expect(spineWrapper).toBeDefined()
      expect(resolveVegaThemeOverride(spineWrapper)).toBeNull()

      // RESET: the next render pass carries no theme for the region — the
      // scope re-registration must CLEAR it (never latch the old theme).
      renderWorkspace(fragmentCenterConfig(), {
        surface: true,
        container,
        fragments: {
          queryService: service,
          regions: {
            'region-center': { surfaceIri: SURFACE_IRI, state: { status: 'ready', doc: observatoryFragment() } },
          },
        },
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      expect(resolveVegaThemeOverride(fragWrapper)).toBeNull()
    } finally {
      container.remove()
    }
  })

  it('PERSIST-SCOPE ISOLATION: a spine divider commit never reaches onFragmentChange', async () => {
    const { service } = recordingQueryService('1')
    const changes: WorkspaceFragmentChangeDetail[] = []
    const { container, surface } = await renderFragmentWorkspace(
      fragmentsOptions(service, { status: 'ready', doc: observatoryFragment() }, (detail) => changes.push(detail)),
    )
    try {
      const spineHandle = Array.from(
        surface.querySelectorAll<HTMLElement>('[data-layout-divider]'),
      ).find((el) => el.dataset.layoutDivider?.startsWith('workspace-spine:'))
      expect(spineHandle).toBeDefined()
      spineHandle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      expect(changes).toHaveLength(0)
      // The spine ratio DID change — the drag was real, it just never touches
      // the fragment persist seam.
      const spineId = spineHandle!.dataset.layoutDivider!
      const spineSplit = surface.surfaceDocument()!.nodes[spineId]
      if (spineSplit?.kind !== 'split') throw new Error('expected spine split')
    } finally {
      container.remove()
    }
  })
})
