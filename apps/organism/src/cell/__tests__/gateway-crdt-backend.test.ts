import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { AuthProvider } from '@shrubbery/nucleus'

const providerHarness = vi.hoisted(() => ({ instances: [] as Array<{
  serverUrl: string
  roomName: string
  doc: Y.Doc
  params: Record<string, string>
  WebSocketPolyfill: new (url: string | URL, protocols?: string | string[]) => unknown
  awareness: object
  synced: boolean
  disconnectCalls: number
  connectCalls: number
  destroyCalls: number
  syncCallback?: (synced: boolean) => void
  syncListener?: (synced: boolean) => void
  statusCallback?: (event: { status: string }) => void
  connectionCloseCallback?: () => void
  connectionErrorCallback?: () => void
  once(event: string, callback: (synced: boolean) => void): void
  on(event: string, callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void)): void
  off(event: string, callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void)): void
  disconnect(): void
  connect(): void
  destroy(): void
}> }))

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    awareness = {
      local: true,
      fields: new Map<string, unknown>(),
      setLocalStateField(field: string, value: unknown) { this.fields.set(field, value) },
      setLocalState(state: Record<string, unknown> | null) {
        this.fields.clear()
        this.fields.set('state', state)
      },
    }
    synced = false
    disconnectCalls = 0
    connectCalls = 0
    destroyCalls = 0
    syncCallback?: (synced: boolean) => void
    syncListener?: (synced: boolean) => void
    statusCallback?: (event: { status: string }) => void
    connectionCloseCallback?: () => void
    connectionErrorCallback?: () => void
    params: Record<string, string>
    WebSocketPolyfill: new (url: string | URL, protocols?: string | string[]) => unknown

    constructor(
      readonly serverUrl: string,
      readonly roomName: string,
      readonly doc: Y.Doc,
      options: {
        params: Record<string, string>
        WebSocketPolyfill: new (url: string | URL, protocols?: string | string[]) => unknown
      },
    ) {
      this.params = options.params
      this.WebSocketPolyfill = options.WebSocketPolyfill
      providerHarness.instances.push(this)
    }

    once(event: string, callback: (synced: boolean) => void): void {
      if (event === 'sync') this.syncCallback = callback
    }
    on(event: string, callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void)): void {
      if (event === 'status') this.statusCallback = callback as (event: { status: string }) => void
      if (event === 'sync') this.syncListener = callback as (synced: boolean) => void
      if (event === 'connection-close') this.connectionCloseCallback = callback as () => void
      if (event === 'connection-error') this.connectionErrorCallback = callback as () => void
    }
    off(event: string, callback: ((event: { status: string }) => void) | ((synced: boolean) => void) | (() => void)): void {
      if (event === 'status' && this.statusCallback === callback) this.statusCallback = undefined
      if (event === 'sync' && this.syncListener === callback) this.syncListener = undefined
      if (event === 'connection-close' && this.connectionCloseCallback === callback) this.connectionCloseCallback = undefined
      if (event === 'connection-error' && this.connectionErrorCallback === callback) this.connectionErrorCallback = undefined
    }
    disconnect(): void { this.disconnectCalls++ }
    connect(): void { this.connectCalls++ }
    destroy(): void { this.destroyCalls++ }
  },
}))

import {
  GatewayCrdtBackend,
  gatewayWsRoot,
  type GatewayWebSocketCtor,
} from '../gateway-crdt-backend.js'

class MutableAuth implements AuthProvider {
  private readonly listeners = new Set<() => void>()
  constructor(
    private currentToken: string | undefined = 'token-1',
    private currentUser = 'user-1',
  ) {}
  token(): string | undefined { return this.currentToken }
  userId(): string { return this.currentUser }
  isAuthenticated(): boolean { return Boolean(this.currentToken) }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  rotate(token: string | undefined, userId = this.currentUser): void {
    this.currentToken = token
    this.currentUser = userId
    for (const listener of this.listeners) listener()
  }
}

interface WebSocketCall {
  readonly url: string
  readonly protocols: string | string[] | undefined
}

class RecordingWebSocket {
  static calls: WebSocketCall[] = []
  constructor(url: string | URL, protocols?: string | string[]) {
    RecordingWebSocket.calls.push({ url: String(url), protocols })
  }
}

const WS = RecordingWebSocket as unknown as GatewayWebSocketCtor

beforeEach(() => {
  providerHarness.instances.length = 0
  RecordingWebSocket.calls.length = 0
})

describe('GatewayCrdtBackend', () => {
  it('derives gateway doc/workspace routes with graph scoping on both sides of the prefix', () => {
    const auth = new MutableAuth()
    const backend = new GatewayCrdtBackend({
      gatewayBaseUrl: 'https://gateway.test/root/',
      auth,
      WebSocketPolyfill: WS,
      presenceIdentity: { deviceId: 'device-a', clientId: 'tab-a', clientStorage: null, now: () => 10 },
    })

    const doc = new Y.Doc()
    const docHandle = backend.open({ kind: 'doc', graphId: 'g one', docId: 'doc/one' }, doc)
    const workspaceHandle = backend.open({ kind: 'workspace', graphId: 'g one' }, new Y.Doc())
    const docProvider = providerHarness.instances[0]
    const workspaceProvider = providerHarness.instances[1]

    expect(gatewayWsRoot('https://gateway.test/root/')).toBe('wss://gateway.test/root')
    expect(docProvider.serverUrl).toBe('wss://gateway.test/root/g/g%20one/hocuspocus/docs/g%20one')
    expect(docProvider.roomName).toBe('doc%2Fone')
    expect(workspaceProvider.serverUrl).toBe('wss://gateway.test/root/g/g%20one/hocuspocus/workspace')
    expect(workspaceProvider.roomName).toBe('g%20one')
    expect(docProvider.params).toEqual({ token: 'token-1', user_id: 'user-1' })
    expect(docHandle.doc).toBe(doc)
    expect(docHandle.awareness).toBe(docProvider.awareness)
    expect((docProvider.awareness as { fields: Map<string, unknown> }).fields.get('user')).toMatchObject({
      name: 'user-1',
    })
    expect((docProvider.awareness as { fields: Map<string, unknown> }).fields.get('presence')).toEqual({
      schemaVersion: 1,
      humanId: 'user-1',
      deviceId: 'device-a',
      clientId: 'tab-a',
      connectionEpoch: 1,
      room: { graphId: 'g one', kind: 'document', documentId: 'doc/one' },
      publishedAt: 10,
    })
    docProvider.statusCallback?.({ status: 'connected' })
    expect((docProvider.awareness as { fields: Map<string, unknown> }).fields.get('presence')).toMatchObject({
      connectionEpoch: 3,
    })

    docHandle.destroy()
    workspaceHandle.destroy()
  })

  it('uses the catalog-bound owner route for hosted graph sockets', () => {
    const backend = new GatewayCrdtBackend({
      gatewayBaseUrl: 'https://gateway.test/root/',
      graphBaseUrl: graphId => (
        `https://gateway.test/root/o/user%3Aowner-1/g/${encodeURIComponent(graphId)}`
      ),
      auth: new MutableAuth(),
      WebSocketPolyfill: WS,
    })

    const handle = backend.open({ kind: 'workspace', graphId: 'g one' }, new Y.Doc())
    expect(providerHarness.instances[0].serverUrl).toBe(
      'wss://gateway.test/root/o/user%3Aowner-1/g/g%20one/hocuspocus/workspace',
    )
    handle.destroy()
  })

  it('uses query-only gateway auth, rotates it on Cognito refresh, and disconnects on sign-out', () => {
    const auth = new MutableAuth()
    const backend = new GatewayCrdtBackend({
      gatewayBaseUrl: 'http://127.0.0.1:9999',
      auth,
      WebSocketPolyfill: WS,
    })
    const handle = backend.open({ kind: 'workspace', graphId: 'graph' }, new Y.Doc())
    const provider = providerHarness.instances[0]
    provider.statusCallback?.({ status: 'connected' })
    provider.syncListener?.(true)
    expect(handle.lifecycle.get()).toEqual({
      connection: 'connected', synchronized: true, shouldConnect: true,
    })

    new provider.WebSocketPolyfill('ws://127.0.0.1/socket')
    expect(RecordingWebSocket.calls[0].protocols).toBeUndefined()

    auth.rotate('token-2', 'user-2')
    expect(provider.params).toEqual({ token: 'token-2', user_id: 'user-2' })
    expect(provider.disconnectCalls).toBe(1)
    expect(provider.connectCalls).toBe(2)
    expect(handle.lifecycle.get()).toEqual({
      connection: 'connecting', synchronized: false, shouldConnect: true,
    })
    expect((provider.awareness as { fields: Map<string, unknown> }).fields.get('user')).toMatchObject({
      name: 'user-2',
    })
    new provider.WebSocketPolyfill('ws://127.0.0.1/socket')
    expect(RecordingWebSocket.calls[1].protocols).toBeUndefined()

    auth.rotate(undefined)
    expect(provider.params.token).toBeUndefined()
    expect(provider.disconnectCalls).toBe(2)
    expect(provider.connectCalls).toBe(2)
    expect(handle.lifecycle.get()).toEqual({
      connection: 'disconnected', synchronized: false, shouldConnect: false,
    })

    auth.rotate('token-3')
    expect(provider.connectCalls).toBe(3)
    expect(handle.lifecycle.get()).toEqual({
      connection: 'connecting', synchronized: false, shouldConnect: true,
    })

    handle.destroy()
    auth.rotate('token-4')
    expect(provider.disconnectCalls).toBe(3)
    expect(provider.destroyCalls).toBe(1)
  })

  it('reports current connect, room-sync, disconnect, and reconnect facts without durability claims', async () => {
    const backend = new GatewayCrdtBackend({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      WebSocketPolyfill: WS,
    })
    const handle = backend.open({ kind: 'doc', graphId: 'g', docId: 'doc' }, new Y.Doc())
    const provider = providerHarness.instances[0]
    const seen = [handle.lifecycle.get()]
    const unsubscribe = handle.lifecycle.subscribe(value => seen.push(value))

    provider.statusCallback?.({ status: 'connected' })
    provider.syncListener?.(true)
    provider.syncCallback?.(true)
    await expect(handle.whenSynced).resolves.toBeUndefined()
    provider.syncListener?.(false)
    provider.connectionCloseCallback?.()
    provider.statusCallback?.({ status: 'connecting' })
    provider.statusCallback?.({ status: 'connected' })
    provider.syncListener?.(true)

    expect(seen).toEqual([
      { connection: 'connecting', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: true, shouldConnect: true },
      { connection: 'connected', synchronized: false, shouldConnect: true },
      { connection: 'disconnected', synchronized: false, shouldConnect: true },
      { connection: 'connecting', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: false, shouldConnect: true },
      { connection: 'connected', synchronized: true, shouldConnect: true },
    ])

    unsubscribe()
    handle.destroy()
  })

  it('resolves whenSynced, validates auth/doc IDs, and tears down every live provider', async () => {
    const auth = new MutableAuth()
    const backend = new GatewayCrdtBackend({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      WebSocketPolyfill: WS,
    })
    const handle = backend.open({ kind: 'doc', graphId: 'g', docId: 'doc' }, new Y.Doc())
    const provider = providerHarness.instances[0]
    provider.syncCallback?.(true)
    await expect(handle.whenSynced).resolves.toBeUndefined()
    expect(backend.schemaVersion()).toBe(1)

    backend.open({ kind: 'workspace', graphId: 'g' }, new Y.Doc())
    backend.destroyAll()
    expect(providerHarness.instances.map(instance => instance.destroyCalls)).toEqual([1, 1])

    expect(() => backend.open({ kind: 'doc', graphId: 'g' }, new Y.Doc())).toThrow('requires a docId')
    const anonymous = new GatewayCrdtBackend({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(''),
      WebSocketPolyfill: WS,
    })
    expect(() => anonymous.open({ kind: 'workspace', graphId: 'g' }, new Y.Doc())).toThrow(
      'await auth.whenReady()',
    )
  })
})
