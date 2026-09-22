/**
 * render-workspace-fragment-marker.test.ts — the CONFIG AUTHORITY of the
 * fragment-region marker (`sh-layout-dashboard`), successor to the retired
 * nested-mount dashboard test: the marker decides what the center IS; the
 * `fragments` option only supplies content. Everything real (no vi.*).
 *
 * The spliced CONTENT path itself (engine faces, honest states, persist-scope
 * isolation) is proven in render-workspace-fragment.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'
import {
  LAYOUT_DASHBOARD_COMPONENT,
  engineRegionRole,
  renderWorkspace,
  workspaceSurfaceReady,
  type WorkspaceFragmentsOptions,
} from '../index.js'
import type { WorkspaceSurfaceElement } from '../layout/workspace-surface-element.js'

/** GARDEN_DEFAULT with its center region re-declared as a fragment region. */
function markerConfig(): WorkspaceConfig {
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

const LOADING_FRAGMENTS: WorkspaceFragmentsOptions = {
  queryService: null,
  regions: {
    'region-center': {
      surfaceIri: 'urn:sophia:ux:surface:observatory-dashboard',
      state: { status: 'loading' },
    },
  },
}

describe('the fragment-region marker (sh-layout-dashboard) as config authority', () => {
  it('classifies the marker region as the CENTER role', () => {
    expect(engineRegionRole(markerConfig(), 'region-center')).toBe('center')
    // The unmarked default still classifies via its docked editor panel.
    expect(engineRegionRole(GARDEN_DEFAULT, 'region-center')).toBe('center')
  })

  it('the marker takes the center even when route-level home options are also present', async () => {
    const container = renderWorkspace(markerConfig(), {
      surface: true,
      fragments: LOADING_FRAGMENTS,
      home: { graphId: 'graph-a', graphTitle: 'Graph A' },
      chrome: { rightPanels: ['chat'] },
    })
    document.body.appendChild(container)
    try {
      await workspaceSurfaceReady(container)
      const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const layout = surface.surfaceDocument()!
      expect(layout.nodes['workspace-fragment-status:region-center']).toBeDefined()
      expect(layout.nodes['workspace-center-home']).toBeUndefined()
    } finally {
      container.remove()
    }
  })

  it('a config WITHOUT the marker ignores the fragments option entirely', async () => {
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      fragments: LOADING_FRAGMENTS,
      chrome: { rightPanels: ['chat'] },
    })
    document.body.appendChild(container)
    try {
      await workspaceSurfaceReady(container)
      const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const layout = surface.surfaceDocument()!
      expect(Object.keys(layout.nodes).some((id) => id.startsWith('frag:'))).toBe(false)
      expect(Object.keys(layout.nodes).some((id) => id.startsWith('workspace-fragment-status:'))).toBe(false)
      expect(container.querySelector('[data-layout-fragment-status]')).toBeNull()
    } finally {
      container.remove()
    }
  })

  it('the marker with NO fragments option renders the honest missing state (never a blank pane)', async () => {
    const container = renderWorkspace(markerConfig(), {
      surface: true,
      chrome: { rightPanels: ['chat'] },
    })
    document.body.appendChild(container)
    try {
      await workspaceSurfaceReady(container)
      const status = container.querySelector<HTMLElement>('[data-layout-fragment-status="missing"]')
      expect(status).not.toBeNull()
      expect(status!.textContent).toContain(LAYOUT_DASHBOARD_COMPONENT)
      expect(status!.textContent).toContain('no fragment')
    } finally {
      container.remove()
    }
  })
})
