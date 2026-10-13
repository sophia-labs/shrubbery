import { describe, expect, it, vi } from 'vitest'
import { createOrganismShellFeatureHost } from '../shell-features.js'
import { createShellContext } from '../shell-context.js'

describe('hosted sharing composition with local creation testimony', () => {
  it('does not expose top-bar access management for an unconfirmed local workspace', () => {
    const gateway = { access: vi.fn(async () => []), putAccess: vi.fn(), deleteAccess: vi.fn() }
    const context = createShellContext({
      host: document.createElement('div'), graphId: 'local-work', documentId: null,
      app: 'garden', source: 'CELL_LIVE', deploymentMode: 'hosted',
      contract: { gateway, auth: { token: () => 'synthetic', userId: () => 'user:owner', whenReady: async () => undefined }, ui: { confirm: vi.fn(async () => true) } },
      location: new URL('https://app.test/'), rerender: vi.fn(),
    })
    const features = createOrganismShellFeatureHost()
    const canonical = { graphId: 'local-work', title: 'Local work', role: 'owner' as const, cellState: 'stopped' as const }
    try {
      const before = features.workspaceSnapshot(context, { chrome: { workspaces: [canonical] } })
      expect(before.chrome?.access).not.toBeNull()
      const pending = features.workspaceSnapshot(context, { chrome: { workspaces: [{ ...canonical, localCreation: { status: 'pending' } }] } })
      expect(pending.chrome?.access).toBeNull()
      expect(gateway.access).not.toHaveBeenCalled()
    } finally { features.destroy() }
  })
})
