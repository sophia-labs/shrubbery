import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import { GraphLifecycleManager, MemoryGraphLifecycleStorage } from '@shrubbery/source'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import {
  confirmHostedWorkspaceCreation,
  mergeHostedWorkspaceCreations,
  prepareHostedWorkspace,
  unconfirmedWorkspaceMessage,
} from '../hosted-workspace-creation.js'
import { mountGardenHomeRoute } from '../garden-home-route.js'

const request = {
  graphId: 'retained-work', title: 'Retained work',
  graphIncarnation: '11111111-1111-4111-8111-111111111111', operationId: 'graph:create:one',
}
function fixture(createGraph = vi.fn(async () => ({ ...request }))) {
  const storage = new MemoryGraphLifecycleStorage()
  const lifecycle = new GraphLifecycleManager({
    userId: 'owner', storage, transport: { createGraph, deleteGraph: vi.fn() },
  })
  const provisionGraph = vi.fn(async () => {
    // Local provision must follow the durable intent, even on network failure.
    expect(await storage.listGraphLifecycleIntents('owner')).toHaveLength(1)
  })
  const runtime = { openGraphLifecycle: async () => { await lifecycle.open(); return lifecycle }, provisionGraph }
  return { storage, lifecycle, runtime, createGraph, provisionGraph }
}
afterEach(() => document.body.replaceChildren())

describe('hosted creation acknowledgement and the real catalog consumers', () => {
  it('does not treat starting delivery as an acknowledgement', async () => {
    let accept!: (value: typeof request) => void
    const pending = new Promise<typeof request>(resolve => { accept = resolve })
    const f = fixture(vi.fn(() => pending))
    let settled = false
    const creating = prepareHostedWorkspace(f.runtime, request).then(intent => { settled = true; return intent })
    await vi.waitFor(() => expect(f.createGraph).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    expect(f.lifecycle.records()[0]?.status).toBe('pending')
    accept(request)
    expect((await creating).status).toBe('applied')
    expect(f.provisionGraph).toHaveBeenCalledTimes(1)
  })

  it('retains a refused creation but never presents it as a running hosted Owner row', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('Gateway POST /graphs failed: HTTP 403') }))
    const result = await prepareHostedWorkspace(f.runtime, request)
    expect(result.status).toBe('pending') // An untyped 403 is not a fabricated permanent fault.
    expect(result.error).toContain('403')
    expect(unconfirmedWorkspaceMessage(result)).toContain('saved locally')
    expect(unconfirmedWorkspaceMessage(result)).not.toContain('can be opened')
    expect(unconfirmedWorkspaceMessage(result)).toContain('Retry cloud confirmation')
    expect(await f.storage.listGraphLifecycleIntents('owner')).toHaveLength(1)
    const workspaces = mergeHostedWorkspaceCreations([], f.lifecycle.records())
    const host = renderWorkspace(GARDEN_DEFAULT, { chrome: {
      workspaces, workspaceStatus: 'ready', activeWorkspaceId: 'existing', workspaceBusyId: null,
    } })
    document.body.append(host)
    const topBar = host.querySelector('mn-top-bar')!
    await topBar.updateComplete
    const selector = topBar.shadowRoot!.querySelector('mn-workspace-selector')!
    await selector.updateComplete
    ;(selector.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click()
    await selector.updateComplete
    const row = selector.shadowRoot!.querySelector('[data-graph-id="retained-work"]')!
    expect(row.textContent).toContain('Saved locally · cloud unconfirmed')
    expect(row.textContent).not.toContain('Cell asleep')
    expect(row.querySelector('.select')?.getAttribute('aria-label')).not.toContain('Owner')
    expect(row.querySelector('.more')).toBeNull()
    expect((row.querySelector('.select') as HTMLButtonElement).disabled).toBe(true)
    expect(selector.busyGraphId).toBe('')
  })

  it('prefers canonical catalog testimony and retires the provisional label only when present', async () => {
    const f = fixture()
    await prepareHostedWorkspace(f.runtime, request)
    expect(mergeHostedWorkspaceCreations([], f.lifecycle.records())[0]?.localCreation).toBeDefined()
    const canonical = { owner: 'user:owner', graphId: request.graphId, title: request.title, role: 'owner' as const, cellState: 'stopped' as const }
    expect(mergeHostedWorkspaceCreations([canonical], f.lifecycle.records())).toEqual([canonical])
    // A graph someone else shares with the same id is another graph: it neither hides nor stands for ours.
    const sharedCollision = { ...canonical, owner: 'user:someone-else', role: 'viewer' as const }
    const merged = mergeHostedWorkspaceCreations([sharedCollision], f.lifecycle.records())
    expect(merged.map(graph => [graph.owner ?? null, graph.graphId, Boolean(graph.localCreation)]))
      .toEqual([['user:someone-else', request.graphId, false], [null, request.graphId, true]])
  })

  it('waits for a directory reply before permitting either creation caller to navigate', async () => {
    const f = fixture()
    const intent = await prepareHostedWorkspace(f.runtime, request)
    const canonical = { owner: 'user:owner', graphId: request.graphId, title: request.title, role: 'owner' as const, cellState: 'stopped' as const }
    let reply!: (rows: typeof canonical[]) => void
    const navigate = vi.fn()
    const confirming = confirmHostedWorkspaceCreation(intent, () => new Promise(resolve => { reply = resolve }))
      .then(navigate)
    await Promise.resolve()
    expect(navigate).not.toHaveBeenCalled()
    reply([canonical])
    await confirming
    expect(navigate).toHaveBeenCalledExactlyOnceWith(canonical)
  })

  it('refuses absent, provisional, shared-collision, unowned and ambiguous directory rows after acceptance', async () => {
    const f = fixture()
    const intent = await prepareHostedWorkspace(f.runtime, request)
    const canonical = { owner: 'user:owner', graphId: request.graphId, title: request.title, role: 'owner' as const, cellState: 'stopped' as const }
    for (const rows of [
      [], mergeHostedWorkspaceCreations([], f.lifecycle.records()),
      [{ ...canonical, owner: 'user:other', role: 'editor' as const }],
      [{ ...canonical, owner: 'user:another-account' }],
      [{ ...canonical, owner: undefined }], [canonical, canonical],
    ]) {
      const navigate = vi.fn()
      await expect(confirmHostedWorkspaceCreation(intent, async () => rows).then(navigate))
        .rejects.toThrow('directory has not confirmed')
      expect(navigate).not.toHaveBeenCalled()
    }
    expect(await f.storage.listGraphLifecycleIntents('owner')).toHaveLength(1)
  })

  it('does not replace a failed creation with an unrelated successful directory read', async () => {
    const f = fixture(vi.fn(async () => { throw new TypeError('Network unavailable') }))
    const intent = await prepareHostedWorkspace(f.runtime, request)
    const directory = vi.fn(async () => [])
    await expect(confirmHostedWorkspaceCreation(intent, directory)).rejects.toThrow('saved locally')
    expect(directory).not.toHaveBeenCalled()
  })

  it('refreshes Home after unconfirmed creation and exposes retained work without Share', async () => {
    const f = fixture(vi.fn(async () => { throw new TypeError('Network unavailable') }))
    const host = document.createElement('div')
    document.body.append(host)
    const load = vi.fn(async () => ({ account: { userId: 'owner', displayName: 'Owner' }, workspaces: mergeHostedWorkspaceCreations([], f.lifecycle.records()) }))
    const route = mountGardenHomeRoute(host, {
      load, openGraph: vi.fn(), manageAccess: vi.fn(),
      create: async () => { throw new Error(unconfirmedWorkspaceMessage(await prepareHostedWorkspace(f.runtime, request))) },
    })
    await route.ready
    const home = host.querySelector('mn-garden-home')!
    home.dispatchEvent(new CustomEvent('mn-garden-home-create', { bubbles: true, composed: true }))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(home.createStatus).toBe('error'))
    await home.updateComplete
    expect(home.createError).toContain('saved locally')
    const card = home.shadowRoot!.querySelector('[data-graph-id="retained-work"]')!
    expect(card.textContent).toContain('Cloud creation is not yet confirmed')
    expect(card.querySelector('mn-badge')?.label).toBe('Saved locally')
    expect((card.querySelector('.access') as HTMLButtonElement).disabled).toBe(true)
    expect((card.querySelector('.open-graph') as HTMLButtonElement).disabled).toBe(true)
    route.destroy()
  })
})
