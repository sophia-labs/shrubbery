import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { createCenterPanesState, projectCenterPanes } from '../center-panes-model.js'
import {
  renderWorkspace,
  workspaceSurfaceReady,
  type WorkspaceCenterPanesOptions,
} from '../index.js'
import type { WorkspaceSurfaceElement } from '../layout/workspace-surface-element.js'

function centerOptions(dividerPercent: number): WorkspaceCenterPanesOptions {
  const state = createCenterPanesState({
    graphId: 'graph-a',
    secondaryLocation: { kind: 'home', graphId: 'graph-a', title: 'Second path' },
    dividerPercent,
  })
  return { projection: projectCenterPanes(state), editorHosts: new Map() }
}

describe('Garden workspace Surface resize bindings', () => {
  it('reuses face values for geometry-only builds and refreshes them for a new options model', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(50),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const initialModel = surface.model!

      const tall = initialModel.build(1_000, 800)
      const short = initialModel.build(1_000, 400)
      expect(short.bindings).toBe(tall.bindings)
      expect(tall.document.nodes['center-primary:frame']).toMatchObject({
        kind: 'split',
        startBasisPoints: 475,
      })
      expect(short.document.nodes['center-primary:frame']).toMatchObject({
        kind: 'split',
        startBasisPoints: 950,
      })

      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(65),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      const nextModel = surface.model!
      const changed = nextModel.build(1_000, 400)

      expect(nextModel).not.toBe(initialModel)
      expect(changed.bindings).not.toBe(short.bindings)
      expect(changed.document.nodes['center-root-split']).toMatchObject({
        kind: 'split',
        startBasisPoints: 6500,
      })
    } finally {
      container.remove()
    }
  })
})
