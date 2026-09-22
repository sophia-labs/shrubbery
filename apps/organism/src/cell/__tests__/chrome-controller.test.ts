import { describe, expect, it, vi } from 'vitest'
import type {
  CrdtProviderLifecycle,
  ProviderHandle,
  ReactiveSource,
} from '@shrubbery/nucleus'
import {
  OrganismChromeController,
  projectDocumentStats,
  projectPresence,
  revealFollowedPresenceCursor,
  sidebarItemCount,
} from '../chrome-controller.js'

class TestAwareness {
  clientID?: number
  readonly states = new Map<number, unknown>()
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
    this.emit()
  }
  setLocalStateField(field: string, value: unknown): void {
    this.setLocalState({ ...(this.localState ?? {}), [field]: value })
  }
  on(_event: 'change', callback: () => void): void { this.listeners.add(callback) }
  off(_event: 'change', callback: () => void): void { this.listeners.delete(callback) }
  emit(): void { for (const callback of this.listeners) callback() }
}

class TestLifecycle implements ReactiveSource<CrdtProviderLifecycle> {
  private readonly listeners = new Set<(value: CrdtProviderLifecycle) => void>()
  constructor(private value: CrdtProviderLifecycle = {
    connection: 'connecting', synchronized: false, shouldConnect: true,
  }) {}
  get(): CrdtProviderLifecycle { return this.value }
  subscribe(callback: (value: CrdtProviderLifecycle) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  set(value: CrdtProviderLifecycle): void {
    this.value = value
    for (const listener of this.listeners) listener(value)
  }
}

function provider(awareness: TestAwareness, lifecycle = new TestLifecycle()): ProviderHandle {
  return {
    doc: {},
    awareness,
    lifecycle,
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy() {},
  }
}

describe('OrganismChromeController', () => {
  it('projects recursive sidebar counts and Unicode-aware document statistics', () => {
    expect(sidebarItemCount([{ id: 'docs', label: 'Docs', nodes: [
      { id: 'folder', label: 'Folder', kind: 'folder', children: [
        { id: 'doc', label: 'Doc', kind: 'document' },
        { id: 'artifact', label: 'Image', kind: 'artifact' },
      ] },
      { id: 'tag', label: 'todo', kind: 'tag' },
    ] }])).toBe(2)
    expect(projectDocumentStats('Hello 🌿 Garden', 3, 'Paragraph')).toEqual({
      words: 3,
      characters: 14,
      selectedCharacters: 3,
      blockType: 'Paragraph',
      readingTimeMinutes: 1,
    })
  })

  it('computes reading time on the same 200wpm/ceil baseline as the OG bottom bar, zero for empty text', () => {
    expect(projectDocumentStats('word '.repeat(199))?.readingTimeMinutes).toBe(1)
    expect(projectDocumentStats('word '.repeat(201))?.readingTimeMinutes).toBe(2)
    expect(projectDocumentStats('')?.readingTimeMinutes).toBe(0)
    expect(projectDocumentStats(null)).toBeNull()
  })

  it('projects only valid awareness users in stable name order', () => {
    const awareness = new TestAwareness()
    awareness.states.set(9, { user: { name: 'Zed', color: '#16a34a' } })
    awareness.states.set(2, { user: { name: 'Ada', color: '#2563eb' } })
    awareness.states.set(3, { user: { name: '', color: 'red' } })
    expect(projectPresence(awareness)).toEqual([
      {
        id: '2', name: 'Ada', color: '#2563eb', humanId: null,
        sessionCount: 1, deviceCount: 1, isSelf: false, clientIds: ['2'],
        type: 'human',
        sessions: [{
          awarenessClientId: '2', clientId: '2', deviceId: null,
          connectionEpoch: 0, hasCursor: false, isLocal: false,
        }],
      },
      {
        id: '9', name: 'Zed', color: '#16a34a', humanId: null,
        sessionCount: 1, deviceCount: 1, isSelf: false, clientIds: ['9'],
        type: 'human',
        sessions: [{
          awarenessClientId: '9', clientId: '9', deviceId: null,
          connectionEpoch: 0, hasCursor: false, isLocal: false,
        }],
      },
    ])
  })

  it('groups legitimate same-human tabs but supersedes only an older epoch of one tab', () => {
    const awareness = new TestAwareness()
    awareness.clientID = 30
    const state = (
      humanId: string,
      deviceId: string,
      clientId: string,
      connectionEpoch: number,
      publishedAt: number,
    ) => ({
      user: { userId: humanId, name: humanId === 'vera' ? 'Vera' : 'Ada', color: '#2563eb', type: 'human' },
      presence: {
        schemaVersion: 1,
        humanId,
        deviceId,
        clientId,
        connectionEpoch,
        room: { graphId: 'graph', kind: 'document', documentId: 'doc' },
        publishedAt,
      },
    })
    // Same logical tab before/after reconnect: only epoch 4 is current.
    awareness.states.set(10, state('vera', 'device-a', 'tab-a', 3, 30))
    awareness.states.set(30, state('vera', 'device-a', 'tab-a', 4, 40))
    // A second Vera tab is legitimate and contributes to the grouped count.
    awareness.states.set(40, state('vera', 'device-a', 'tab-b', 1, 10))
    awareness.states.set(50, state('ada', 'device-b', 'tab-c', 1, 20))

    expect(projectPresence(awareness)).toEqual([
      {
        id: 'human:vera',
        name: 'Vera',
        color: '#2563eb',
        humanId: 'vera',
        sessionCount: 2,
        deviceCount: 1,
        isSelf: true,
        clientIds: ['tab-a', 'tab-b'],
        type: 'human',
        sessions: [
          {
            awarenessClientId: '30', clientId: 'tab-a', deviceId: 'device-a',
            connectionEpoch: 4, hasCursor: false, isLocal: true,
          },
          {
            awarenessClientId: '40', clientId: 'tab-b', deviceId: 'device-a',
            connectionEpoch: 1, hasCursor: false, isLocal: false,
          },
        ],
      },
      {
        id: 'human:ada',
        name: 'Ada',
        color: '#2563eb',
        humanId: 'ada',
        sessionCount: 1,
        deviceCount: 1,
        isSelf: false,
        clientIds: ['tab-c'],
        type: 'human',
        sessions: [{
          awarenessClientId: '50', clientId: 'tab-c', deviceId: 'device-b',
          connectionEpoch: 1, hasCursor: false, isLocal: false,
        }],
      },
    ])
  })

  it('never falls back to renderer-only name deduplication', () => {
    const awareness = new TestAwareness()
    awareness.states.set(1, { user: { name: 'Same Name', color: '#2563eb' } })
    awareness.states.set(2, { user: { name: 'Same Name', color: '#2563eb' } })
    expect(projectPresence(awareness)).toHaveLength(2)
  })

  it('preserves human-v-agent truth and marks cursor-bearing sessions', () => {
    const awareness = new TestAwareness()
    awareness.states.set(5, {
      user: { name: 'Sophia', color: '#7c3aed', type: 'agent' },
      cursor: { anchor: {}, head: {} },
      presence: {
        humanId: 'sophia', deviceId: 'choreograph', clientId: 'agent-run-1',
        connectionEpoch: 1, publishedAt: 1,
      },
    })
    expect(projectPresence(awareness)).toMatchObject([{
      id: 'agent:sophia',
      type: 'agent',
      isSelf: false,
      sessions: [{ clientId: 'agent-run-1', hasCursor: true }],
    }])
  })

  it('tracks live provider reconnect/sign-out facts and ignores a replaced provider source', async () => {
    const requestRender = vi.fn()
    const controller = new OrganismChromeController({ runtimeMode: 'hosted', requestRender })
    const firstLifecycle = new TestLifecycle()
    const secondLifecycle = new TestLifecycle()
    const firstAwareness = new TestAwareness()
    const secondAwareness = new TestAwareness()
    firstAwareness.states.set(1, { user: { name: 'First', color: '#111111' } })
    secondAwareness.states.set(2, { user: { name: 'Second', color: '#222222' } })

    controller.bindProvider(provider(firstAwareness, firstLifecycle))
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('connecting')
    controller.bindProvider(provider(secondAwareness, secondLifecycle))
    firstLifecycle.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('connecting')
    expect(firstAwareness.listeners.size).toBe(0)

    secondLifecycle.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect(controller.snapshot({ graphId: 'graph', documentId: 'doc' })).toMatchObject({
      runtimeMode: 'hosted',
      syncState: 'synced',
      presence: [{
        id: '2', name: 'Second', color: '#222222', humanId: null,
        sessionCount: 1, deviceCount: 1, isSelf: false, clientIds: ['2'],
      }],
      breadcrumbs: [
        { id: 'graph', label: 'graph', kind: 'graph', current: false },
        { id: 'doc', label: 'doc', kind: 'document', current: true },
      ],
    })

    secondLifecycle.set({ connection: 'disconnected', synchronized: false, shouldConnect: true })
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('reconnecting')
    secondLifecycle.set({ connection: 'connecting', synchronized: false, shouldConnect: true })
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('reconnecting')
    secondLifecycle.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('synced')
    secondLifecycle.set({ connection: 'disconnected', synchronized: false, shouldConnect: false })
    expect(controller.snapshot({ graphId: 'graph' }).syncState).toBe('disconnected')

    const calls = requestRender.mock.calls.length
    secondAwareness.emit()
    await Promise.resolve()
    expect(requestRender).toHaveBeenCalledTimes(calls + 1)
    controller.destroy()
    expect(secondAwareness.listeners.size).toBe(0)
  })

  it('controls inspector/follow state and only updates the real local human profile', async () => {
    const requestRender = vi.fn()
    const awareness = new TestAwareness()
    awareness.clientID = 7
    awareness.setLocalState({
      user: {
        userId: 'vera', name: 'Vera', color: '#2563eb', type: 'human',
        clientId: 'tab-a', deviceId: 'device-a',
      },
      presence: {
        humanId: 'vera', deviceId: 'device-a', clientId: 'tab-a',
        connectionEpoch: 1, publishedAt: 1,
      },
    })
    const controller = new OrganismChromeController({ runtimeMode: 'local', requestRender })
    controller.bindProvider(provider(awareness))
    controller.openPresence('human:vera')
    controller.setFollowedPresenceClient('tab-a', true)
    expect(controller.interactionState()).toMatchObject({
      openPresenceId: 'human:vera',
      followedPresenceClientId: 'tab-a',
      selfPresenceEditable: true,
    })
    expect(controller.updateSelfPresence('human:vera', { name: 'Vera Prime', color: '#16a34a' })).toBe(true)
    expect(awareness.getLocalState()?.user).toMatchObject({
      userId: 'vera', name: 'Vera Prime', color: '#16a34a', type: 'human',
    })
    controller.setPresenceOverflowOpen(true)
    expect(controller.interactionState()).toMatchObject({
      openPresenceId: null,
      presenceOverflowOpen: true,
    })
    controller.destroy()
  })

  it('reveals one exact logical-tab cursor through nested shadow roots', () => {
    const host = document.createElement('div')
    const editorHost = document.createElement('div')
    host.append(editorHost)
    const shadow = editorHost.attachShadow({ mode: 'open' })
    const first = document.createElement('span')
    first.className = 'ProseMirror-yjs-cursor'
    first.dataset.presenceClientId = 'tab-a'
    const second = document.createElement('span')
    second.className = 'ProseMirror-yjs-cursor'
    second.dataset.presenceClientId = 'tab-b'
    second.scrollIntoView = vi.fn()
    shadow.append(first, second)

    expect(revealFollowedPresenceCursor(host, 'tab-b')).toBe(second)
    expect(second.dataset.presenceFollowed).toBe('true')
    expect(second.scrollIntoView).toHaveBeenCalledWith({
      block: 'center', inline: 'nearest', behavior: 'smooth',
    })
    revealFollowedPresenceCursor(host, null)
    expect(second.hasAttribute('data-presence-followed')).toBe(false)
  })
})
