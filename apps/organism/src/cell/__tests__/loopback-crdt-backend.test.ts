import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const providerHarness = vi.hoisted(() => ({ instances: [] as Array<{
  serverUrl: string
  roomName: string
  awareness: object
  synced: boolean
  params: Record<string, string>
  connectCalls: number
  destroyCalls: number
  syncCallback?: (synced: boolean) => void
  syncListener?: (synced: boolean) => void
  statusCallback?: (event: { status: string }) => void
  connectionCloseCallback?: () => void
  connectionErrorCallback?: () => void
}> }))

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    awareness = {
      fields: new Map<string, unknown>(),
      setLocalStateField(field: string, value: unknown) { this.fields.set(field, value) },
      setLocalState(state: Record<string, unknown> | null) {
        this.fields.clear()
        this.fields.set('state', state)
      },
    }
    synced = false
    params: Record<string, string> = {}
    connectCalls = 0
    destroyCalls = 0
    syncCallback?: (synced: boolean) => void
    syncListener?: (synced: boolean) => void
    statusCallback?: (event: { status: string }) => void
    connectionCloseCallback?: () => void
    connectionErrorCallback?: () => void

    constructor(
      readonly serverUrl: string,
      readonly roomName: string,
      readonly doc: Y.Doc,
    ) {
      providerHarness.instances.push(this)
    }

    once(event: string, callback: (synced: boolean) => void): void {
      if (event === 'sync') this.syncCallback = callback
    }
    on(
      event: string,
      callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void),
    ): void {
      if (event === 'status') this.statusCallback = callback as (event: { status: string }) => void
      if (event === 'sync') this.syncListener = callback as (synced: boolean) => void
      if (event === 'connection-close') this.connectionCloseCallback = callback as () => void
      if (event === 'connection-error') this.connectionErrorCallback = callback as () => void
    }
    off(
      event: string,
      callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void),
    ): void {
      if (event === 'status' && this.statusCallback === callback) this.statusCallback = undefined
      if (event === 'sync' && this.syncListener === callback) this.syncListener = undefined
      if (event === 'connection-close' && this.connectionCloseCallback === callback) this.connectionCloseCallback = undefined
      if (event === 'connection-error' && this.connectionErrorCallback === callback) this.connectionErrorCallback = undefined
    }
    connect(): void { this.connectCalls++ }
    destroy(): void { this.destroyCalls++ }
  },
}))

import { deriveWsBase, LoopbackCrdtBackend } from '../loopback-crdt-backend.js'
import {
  DocumentActivationManager,
  MemoryDocumentActivationStorage,
} from '../document-activation.js'

class RecordingWebSocket {
  constructor(_url: string | URL, _protocols?: string | string[]) {}
}

beforeEach(() => {
  providerHarness.instances.length = 0
})

describe('deriveWsBase', () => {
  it('converts absolute loopback MCP URLs to WebSocket bases', () => {
    expect(deriveWsBase('http://127.0.0.1:7090/mcp')).toBe('ws://127.0.0.1:7090')
    expect(deriveWsBase('https://garden.example/g/graph-a/mcp')).toBe('wss://garden.example/g/graph-a')
  })

  it('resolves the browser proxy path against the page origin', () => {
    const expected = new URL('/cell', window.location.href)
    expected.protocol = expected.protocol === 'https:' ? 'wss:' : 'ws:'
    expect(deriveWsBase('/cell/mcp')).toBe(expected.href.replace(/\/$/, ''))
  })
})

describe('LoopbackCrdtBackend lifecycle', () => {
  it('prefetches with zero providers, then renders that snapshot before room sync', async () => {
    const snapshot = new Y.Doc()
    snapshot.getText('body').insert(0, 'prepared')
    const manager = new DocumentActivationManager({
      storage: new MemoryDocumentActivationStorage(),
      fetchSnapshot: async () => ({
        update: Y.encodeStateAsUpdate(snapshot),
        incarnation: 'incarnation-notes',
      }),
    })
    await expect(manager.prepare({
      userId: 'local-organism',
      graphId: 'garden',
      documentId: 'notes',
      reason: 'intent',
    })).resolves.toMatchObject({ status: 'prepared' })
    expect(providerHarness.instances).toHaveLength(0)

    const backend = new LoopbackCrdtBackend({
      mcpUrl: 'http://127.0.0.1:7090/mcp',
      WebSocketPolyfill: RecordingWebSocket,
      documentActivation: manager,
    })
    const handle = backend.open({ kind: 'doc', graphId: 'garden', docId: 'notes' }, new Y.Doc())
    const provider = providerHarness.instances[0]

    await expect(handle.whenRenderable).resolves.toBeUndefined()
    await expect(handle.renderSource).resolves.toBe('snapshot')
    await Promise.resolve()
    expect((handle.doc as Y.Doc).getText('body').toString()).toBe('prepared')
    expect(handle.lifecycle.get().synchronized).toBe(false)
    expect(provider.connectCalls).toBe(1)
    expect(provider.params.document_incarnation).toBe('incarnation-notes')

    provider.syncListener?.(true)
    provider.syncCallback?.(true)
    await handle.whenSynced
    handle.destroy()
    snapshot.destroy()
  })

  it('reports connect, room sync, disconnect, and retry as live transport facts', async () => {
    const backend = new LoopbackCrdtBackend({
      mcpUrl: 'http://127.0.0.1:7090/mcp',
      WebSocketPolyfill: RecordingWebSocket,
    })
    const handle = backend.open({ kind: 'doc', graphId: 'garden', docId: 'notes' }, new Y.Doc())
    const provider = providerHarness.instances[0]
    expect(provider.connectCalls).toBe(1)
    const seen = [handle.lifecycle.get()]
    const unsubscribe = handle.lifecycle.subscribe(value => seen.push(value))

    provider.statusCallback?.({ status: 'connected' })
    provider.syncListener?.(true)
    provider.syncCallback?.(true)
    await expect(handle.whenSynced).resolves.toBeUndefined()
    provider.connectionErrorCallback?.()
    provider.statusCallback?.({ status: 'connecting' })
    provider.statusCallback?.({ status: 'connected' })
    provider.syncListener?.(true)

    expect(seen).toEqual([
      { connection: 'connecting', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: true, shouldConnect: true },
      { connection: 'disconnected', synchronized: false, shouldConnect: true },
      { connection: 'connecting', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: true, shouldConnect: true },
    ])

    unsubscribe()
    handle.destroy()
    expect(provider.destroyCalls).toBe(1)
  })
})
