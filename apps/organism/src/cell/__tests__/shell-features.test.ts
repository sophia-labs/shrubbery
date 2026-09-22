import { describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import type { ProviderHandle } from '@shrubbery/nucleus'
import type { MnBottomBar } from '@shrubbery/components'
import {
  createOrganismShellFeatureHost,
  ORGANISM_APPEARANCE_CHANGE_EVENT,
} from '../shell-features.js'
import { createShellContext } from '../shell-context.js'

function context(
  host: HTMLElement,
  rerender = vi.fn(),
  options: {
    graphId?: string
    documentId?: string | null
    toolsCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  } = {},
) {
  return createShellContext({
    host,
    graphId: options.graphId ?? 'graph-a',
    documentId: options.documentId === undefined ? 'doc-a' : options.documentId,
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'playground',
    contract: {
      auth: {
        token: () => 'local-token',
        userId: () => 'local-user',
        whenReady: () => Promise.resolve(),
      },
      runtime: { graphBaseUrl: () => 'http://127.0.0.1:7777' },
      ...(options.toolsCall ? { mcp: { toolsCall: options.toolsCall } } : {}),
    },
    location: new URL('http://localhost/'),
    rerender,
  })
}

class Awareness {
  clientID?: number
  readonly states = new Map<number, unknown>([
    [2, { user: { name: 'Vera', color: '#2563eb' } }],
  ])
  readonly listeners = new Set<() => void>()
  private localState: Record<string, unknown> | null = null
  getStates(): Map<number, unknown> { return this.states }
  getLocalState(): Record<string, unknown> | null { return this.localState }
  setLocalState(state: Record<string, unknown> | null): void {
    this.localState = state
    if (this.clientID !== undefined) {
      if (state) this.states.set(this.clientID, state)
      else this.states.delete(this.clientID)
    }
    for (const callback of this.listeners) callback()
  }
  setLocalStateField(field: string, value: unknown): void {
    this.setLocalState({ ...(this.localState ?? {}), [field]: value })
  }
  on(_event: 'change', callback: () => void): void { this.listeners.add(callback) }
  off(_event: 'change', callback: () => void): void { this.listeners.delete(callback) }
}

describe('createOrganismShellFeatureHost', () => {
  it('persists and reapplies the classic Word editor preference through the shell seam', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    document.documentElement.removeAttribute('data-editor-material')
    const root = document.createElement('div')
    const shellContext = context(root)
    const firstHost = createOrganismShellFeatureHost()
    try {
      const service = firstHost.routeOptions(shellContext, {}).settingsService!
      await service.select({
        sectionId: 'appearance',
        settingId: 'editorMaterial',
        value: 'classic-word',
      })
      expect(document.documentElement.dataset.editorMaterial).toBe('classic-word')

      document.documentElement.removeAttribute('data-editor-material')
      const restoredHost = createOrganismShellFeatureHost()
      restoredHost.workspaceSnapshot(shellContext, {})
      expect(document.documentElement.dataset.editorMaterial).toBe('classic-word')
      restoredHost.destroy()

      await service.select({
        sectionId: 'appearance',
        settingId: 'editorMaterial',
        value: 'continuous',
      })
      expect(document.documentElement.hasAttribute('data-editor-material')).toBe(false)
    } finally {
      firstHost.destroy()
      vi.unstubAllGlobals()
      document.documentElement.removeAttribute('data-editor-material')
    }
  })

  it('applies 98 through the same persisted Settings/chrome appearance seam', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    const changes: unknown[] = []
    const listener = (event: Event) => changes.push((event as CustomEvent).detail)
    document.addEventListener(ORGANISM_APPEARANCE_CHANGE_EVENT, listener)
    const host = createOrganismShellFeatureHost()
    try {
      const service = host.routeOptions(context(document.createElement('div')), {}).settingsService!
      await service.select({ sectionId: 'appearance', settingId: 'skin', value: '98' })
      await service.select({ sectionId: 'appearance', settingId: 'theme', value: 'dark' })
      expect(document.documentElement.dataset.skin).toBe('98')
      expect(document.body.dataset.skin).toBe('98')
      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(changes).toEqual([{ skin: '98' }, { theme: 'dark' }])

      document.documentElement.removeAttribute('data-skin')
      document.documentElement.dataset.theme = 'light'
      host.workspaceSnapshot(context(document.createElement('div')), {})
      expect(document.documentElement.dataset.skin).toBe('98')
      expect(document.documentElement.dataset.theme).toBe('dark')
    } finally {
      host.destroy()
      document.removeEventListener(ORGANISM_APPEARANCE_CHANGE_EVENT, listener)
      vi.unstubAllGlobals()
      document.documentElement.removeAttribute('data-skin')
      document.body.removeAttribute('data-skin')
      document.documentElement.dataset.theme = 'light'
      document.body.dataset.theme = 'light'
    }
  })

  it('contributes a capability-scoped controlled settings service without a main.ts adapter', async () => {
    const host = createOrganismShellFeatureHost()
    const root = document.createElement('div')
    const options = host.routeOptions(context(root), {})
    const snapshot = await options.settingsService!.load()
    expect(snapshot.userName).toBe('local-user')
    expect(snapshot.sections.map(section => section.id)).toEqual([
      'account', 'appearance', 'interface', 'api-mcp',
    ])
    expect(snapshot.sections.map(section => section.id)).not.toContain('local-ai')
    expect(snapshot.sections.find(section => section.id === 'api-mcp')?.metrics).toEqual([
      { id: 'api-base', label: 'API base', value: 'http://127.0.0.1:7777' },
      { id: 'mcp-url', label: 'MCP endpoint', value: 'http://127.0.0.1:7777/mcp' },
    ])
    host.destroy()
  })

  it('activates authenticated gardend Settings operations through the production feature seam', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return new Response(JSON.stringify({ restorePoints: [], nextCursor: null, totalCount: 0 }), {
        headers: { 'content-type': 'application/json' },
      })
    }))
    try {
      const root = document.createElement('div')
      const shellContext = createShellContext({
        host: root,
        graphId: 'graph-a',
        documentId: 'doc-a',
        app: 'garden',
        source: 'CELL_LIVE',
        deploymentMode: 'playground',
        contract: {
          auth: {
            token: () => 'local-token',
            userId: () => 'local-user',
            isAuthenticated: () => true,
            whenReady: () => Promise.resolve(),
            onChange: () => () => undefined,
          },
          runtime: {
            mode: () => 'local' as const,
            isGateway: () => false,
            graphBaseUrl: () => 'http://127.0.0.1:7777',
          },
          ui: {
            confirm: async () => true,
            icon: () => ({}) as never,
            presenceColors: [],
          },
        },
        location: new URL('http://localhost/settings'),
        rerender: vi.fn(),
      })
      const host = createOrganismShellFeatureHost()
      const service = host.routeOptions(shellContext, {}).settingsService!
      const snapshot = await service.load()

      expect(requests.map(request => request.url)).toEqual(expect.arrayContaining([
        'http://127.0.0.1:7777/v1/time-travel/graph-a/restore-points?limit=50',
        'http://127.0.0.1:7777/api/semantic/model/status',
        'http://127.0.0.1:7777/api/semantic/models',
        'http://127.0.0.1:7777/api/semantic/index/status/graph-a',
        'http://127.0.0.1:7777/api/artifacts/ingestion/approaches',
        'http://127.0.0.1:7777/api/artifacts/ingestion/docling/status',
        'http://127.0.0.1:7777/api/artifacts/ingestion/pdf/pipeline',
      ]))
      expect(requests.every(request => request.authorization === 'Bearer local-token')).toBe(true)
      expect(snapshot.sections.find(section => section.id === 'imports')?.actions?.every(action => action.disabled === false)).toBe(true)
      expect(snapshot.sections.find(section => section.id === 'graph-ops')?.actions?.filter(action => !action.disabled).map(action => action.id)).toEqual([
        'duplicate-graph', 'export-graph', 'import-graph',
      ])
      expect(snapshot.sections.find(section => section.id === 'local-ai')).toBeDefined()
      expect(service.subscribe).toBeTypeOf('function')
      host.destroy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('projects live editor/sidebar/provider state and subscribes through the provider hook', async () => {
    const root = document.createElement('div')
    const editor = document.createElement('div') as unknown as HTMLElement & {
      liveEditor: { getText(): string }
    }
    editor.id = 'mn-editor-host'
    editor.liveEditor = { getText: () => 'One two three' }
    root.appendChild(editor)
    const rerender = vi.fn()
    const shellContext = context(root, rerender)
    const awareness = new Awareness()
    const provider: ProviderHandle = {
      doc: {},
      awareness,
      lifecycle: synchronizedCrdtProviderLifecycle(),
      whenRenderable: Promise.resolve(),
      whenEditable: Promise.resolve(),
      whenSynced: Promise.resolve(),
      renderSource: Promise.resolve('live'),
      destroy() {},
    }
    const host = createOrganismShellFeatureHost()
    const unbind = host.bindProvider(provider, shellContext)
    const snapshot = host.workspaceSnapshot(shellContext, {
      chrome: { activeApp: 'garden' },
      sidebar: {
        sections: [{ id: 'docs', label: 'Docs', nodes: [
          { id: 'doc-a', label: 'Living Map', kind: 'document' },
          { id: 'artifact-a', label: 'Diagram', kind: 'artifact' },
        ] }],
      },
    })

    expect(snapshot.chrome).toMatchObject({
      activeApp: 'garden',
      itemCount: 2,
      documentStats: { words: 3, characters: 13 },
      presence: [{ id: '2', name: 'Vera', color: '#2563eb' }],
      runtimeMode: 'local',
    })
    expect(snapshot.chrome?.breadcrumbs?.[1]).toMatchObject({
      id: 'doc-a',
      label: 'Living Map',
      current: true,
    })
    await Promise.resolve()
    expect(rerender).toHaveBeenCalled()
    unbind()
    expect(awareness.listeners.size).toBe(0)
    host.destroy()
  })

  it('wires controlled presence inspect, exact-tab follow, and real self awareness updates', async () => {
    const root = document.createElement('div')
    const bar = document.createElement('mn-bottom-bar') as MnBottomBar
    root.append(bar)
    const editorHost = document.createElement('div')
    editorHost.id = 'mn-editor-host'
    const editorShadow = editorHost.attachShadow({ mode: 'open' })
    const remoteCursor = document.createElement('span')
    remoteCursor.className = 'ProseMirror-yjs-cursor'
    remoteCursor.dataset.presenceClientId = 'ada-tab'
    remoteCursor.scrollIntoView = vi.fn()
    editorShadow.append(remoteCursor)
    root.append(editorHost)

    const awareness = new Awareness()
    awareness.clientID = 1
    awareness.setLocalState({
      user: {
        userId: 'vera', name: 'Vera', color: '#2563eb', type: 'human',
        clientId: 'vera-tab', deviceId: 'vera-device',
      },
      presence: {
        humanId: 'vera', deviceId: 'vera-device', clientId: 'vera-tab',
        connectionEpoch: 1, publishedAt: 1,
      },
    })
    awareness.states.set(2, {
      user: {
        userId: 'ada', name: 'Ada', color: '#16a34a', type: 'human',
        clientId: 'ada-tab', deviceId: 'ada-device',
      },
      cursor: { anchor: {}, head: {} },
      presence: {
        humanId: 'ada', deviceId: 'ada-device', clientId: 'ada-tab',
        connectionEpoch: 1, publishedAt: 2,
      },
    })
    const provider: ProviderHandle = {
      doc: {},
      awareness,
      lifecycle: synchronizedCrdtProviderLifecycle(),
      whenRenderable: Promise.resolve(),
      whenEditable: Promise.resolve(),
      whenSynced: Promise.resolve(),
      renderSource: Promise.resolve('live'),
      destroy() {},
    }
    const rerender = vi.fn()
    const shellContext = context(root, rerender)
    const host = createOrganismShellFeatureHost()
    host.bindProvider(provider, shellContext)

    const project = () => host.workspaceSnapshot(shellContext, { chrome: {} })
    let snapshot = project()
    bar.presence = snapshot.chrome?.presence ?? []
    host.afterWorkspaceRender(shellContext, snapshot)
    const ada = bar.presence.find(person => person.id === 'human:ada')!
    const vera = bar.presence.find(person => person.id === 'human:vera')!

    bar.dispatchEvent(new CustomEvent('mn-presence-open', {
      detail: { person: ada }, bubbles: true, composed: true,
    }))
    snapshot = project()
    bar.presence = snapshot.chrome?.presence ?? []
    host.afterWorkspaceRender(shellContext, snapshot)
    expect(bar.openPresenceId).toBe('human:ada')

    bar.dispatchEvent(new CustomEvent('mn-presence-follow', {
      detail: { person: ada, session: ada.sessions![0], following: true },
      bubbles: true, composed: true,
    }))
    snapshot = project()
    host.afterWorkspaceRender(shellContext, snapshot)
    expect(bar.followedPresenceClientId).toBe('ada-tab')
    expect(remoteCursor.dataset.presenceFollowed).toBe('true')
    expect(remoteCursor.scrollIntoView).toHaveBeenCalled()

    bar.dispatchEvent(new CustomEvent('mn-presence-self-update', {
      detail: { person: vera, name: 'Vera Prime', color: '#7c3aed' },
      bubbles: true, composed: true,
    }))
    expect(awareness.getLocalState()?.user).toMatchObject({
      userId: 'vera', name: 'Vera Prime', color: '#7c3aed', type: 'human',
    })
    host.destroy()
  })

  it('derives reader availability from source metadata and persists Make Editable through MCP', async () => {
    const root = document.createElement('div')
    const editor = document.createElement('div') as HTMLElement & {
      originalFileView?: { available?: boolean; filename?: string }
    }
    editor.id = 'mn-editor-host'
    root.appendChild(editor)
    const rerender = vi.fn()
    const toolsCall = vi.fn(async () => ({ success: true, readOnly: false }))
    const shellContext = context(root, rerender, { toolsCall })
    const host = createOrganismShellFeatureHost()
    const base = {
      sidebar: {
        sections: [{ id: 'documents', label: 'Documents', nodes: [{
          id: 'doc-a',
          label: 'Imported Paper',
          kind: 'document' as const,
          readOnly: true,
          sourceFile: {
            storageKey: 'local://artifacts/paper/original/paper.pdf',
            originalFilename: 'paper.pdf',
            mimeType: 'application/pdf',
            fileType: 'pdf',
          },
        }] }],
      },
    }

    const first = host.workspaceSnapshot(shellContext, base)
    host.afterWorkspaceRender(shellContext, first)
    expect(first.editorDocumentAccess).toMatchObject({ readOnly: true, makeEditableStatus: 'idle' })
    expect(editor.originalFileView).toMatchObject({ available: true, filename: 'paper.pdf' })

    root.dispatchEvent(new CustomEvent('mn-editor-make-editable', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(toolsCall).toHaveBeenCalledWith('make_document_editable', {
      graphId: 'graph-a',
      documentId: 'doc-a',
    })
    const after = host.workspaceSnapshot(shellContext, base)
    expect(after.editorDocumentAccess).toMatchObject({ readOnly: false, makeEditableStatus: 'idle' })

    const otherGraph = context(root, rerender, { graphId: 'graph-b', toolsCall })
    const isolated = host.workspaceSnapshot(otherGraph, {
      sidebar: { sections: [{ id: 'documents', label: 'Documents', nodes: [{
        id: 'doc-a', label: 'Same ID, no source', kind: 'document', readOnly: true,
      }] }] },
    })
    host.afterWorkspaceRender(otherGraph, isolated)
    expect(isolated.editorDocumentAccess).toMatchObject({ readOnly: true })
    expect(editor.originalFileView).toMatchObject({ available: false })
    host.destroy()
  })
})
