import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady } from '../render-workspace.js'

const configured: WorkspaceConfig = {
  ...GARDEN_DEFAULT,
  regions: {
    ...GARDEN_DEFAULT.regions,
    'region-right-rail': {
      ...GARDEN_DEFAULT.regions['region-right-rail'],
      surfaceMode: 'configured',
      renderedByComponent: 'mn-card',
      docksPanel: [],
    },
  },
}

describe.each([false, true])('configured right-region authority (Surface %s)', surface => {
  it.each(['chat', 'wires', 'none'] as const)('retains configured content over remembered %s chrome', async rightPanel => {
    const container = renderWorkspace(configured, { surface, chrome: { rightPanel } })
    await workspaceSurfaceReady(container)
    expect(container.querySelector('mn-card')).not.toBeNull()
    expect(container.querySelector('mn-chat-panel')).toBeNull()
    expect(container.querySelector('sh-wires-panel')).toBeNull()
  })
  it('still routes an ordinary right rail through the requested panel', async () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { surface, chrome: { rightPanel: 'wires' } })
    await workspaceSurfaceReady(container)
    expect(container.querySelector('sh-wires-panel')).not.toBeNull()
    expect(container.querySelector('mn-card')).toBeNull()
  })
})
