import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { createHostedGatewayContract } from '../hosted-gateway-contract.js'
import {
  MemoryDocumentActivationStorage,
  documentActivationKey,
} from '../document-activation.js'

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

describe('hosted document snapshot preparation and live attachment', () => {
  const key = { userId: 'user-1', graphId: 'graph-a', documentId: 'doc-a' }

  function memoryWebStorage() {
    const values = new Map<string, string>()
    return {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value) },
      removeItem: (name: string) => { values.delete(name) },
    }
  }

  function updateWithText(text: string): Uint8Array {
    const doc = new Y.Doc()
    doc.getText('body').insert(0, text)
    const update = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return update
  }

  beforeEach(() => {
    // This fixture uses only fresh in-memory stores, never a browser profile.
    vi.stubGlobal('indexedDB', undefined)
    vi.stubGlobal('localStorage', memoryWebStorage())
    vi.stubGlobal('sessionStorage', memoryWebStorage())
  })

  afterEach(() => { vi.unstubAllGlobals() })

  async function fixture(
    incarnation: string | null,
    holdFirstSnapshot = false,
    blob = updateWithText('snapshot-only'),
  ) {
    const storage = new MemoryDocumentActivationStorage()
    let releaseSnapshot!: () => void
    const firstSnapshot = new Promise<void>(resolve => { releaseSnapshot = resolve })
    let snapshotReads = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async input => {
      const url = String(input)
      if (url === 'https://gateway.test/graphs') {
        return new Response(JSON.stringify([{
          owner: 'user:owner-1', graphId: key.graphId, title: 'Fixture',
          lifecycleState: 'active', role: 'owner',
        }]), { headers: { 'content-type': 'application/json' } })
      }
      expect(url).toBe(
        'https://gateway.test/o/user%3Aowner-1/g/graph-a/documents/graph-a/doc-a/blob',
      )
      snapshotReads += 1
      if (holdFirstSnapshot && snapshotReads === 1) await firstSnapshot
      // These are the headers visible to fetch, not a simulation of browser CORS.
      return new Response(blob.slice(), {
        headers: incarnation === null ? {} : { 'x-document-incarnation': incarnation },
      })
    })
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch,
      WebSocketPolyfill: WS,
      documentActivationStorage: storage,
    })
    await contract.gateway.graphs()
    return { contract, storage, releaseSnapshot, snapshotReads: () => snapshotReads }
  }

  it.each([
    { preparation: 'completed', incarnation: null },
    { preparation: 'completed', incarnation: '   ' },
    { preparation: 'matching in-flight', incarnation: null },
    { preparation: 'matching in-flight', incarnation: '   ' },
    { preparation: 'none', incarnation: null },
    { preparation: 'none', incarnation: '   ' },
  ])('starts an empty live room with $preparation preparation and visible fence "$incarnation"', async ({ preparation, incarnation }) => {
    const test = await fixture(incarnation, preparation === 'matching in-flight')
    const target = new Y.Doc()
    const preparing = preparation === 'none'
      ? null
      : test.contract.documentActivation.prepare({ ...key, reason: 'intent' })
    if (preparation === 'completed') await preparing
    if (preparation === 'matching in-flight') {
      await vi.waitFor(() => { expect(test.snapshotReads()).toBe(1) })
    }
    const handle = test.contract.crdt.open(
      { kind: 'doc', graphId: key.graphId, docId: key.documentId }, target,
    )
    const provider = providerHarness.instances[0]
    try {
      if (preparation === 'matching in-flight') {
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(test.snapshotReads()).toBe(1)
        expect(provider.connectCalls).toBe(0)
      }
      test.releaseSnapshot()
      // Exercise the actual factory -> transport -> activation -> socket gate.
      // An unfenced prefetch must not turn a fresh open into a cached conflict.
      await vi.waitFor(() => { expect(provider.connectCalls).toBe(1) }, { timeout: 1_000 })
      expect(provider.params.document_incarnation).toBeUndefined()
      expect(target.getText('body').toString()).toBe('')
      expect(await test.storage.get(documentActivationKey(key))).toBeUndefined()
      if (preparing) await expect(preparing).resolves.toEqual({ status: 'miss' })

      // Only authoritative room sync supplies renderable text; blob-only text
      // must never have crossed into this unfenced connection's Y.Doc.
      Y.applyUpdate(target, updateWithText('room-authority'))
      provider.statusCallback?.({ status: 'connected' })
      provider.syncListener?.(true)
      provider.syncCallback?.(true)
      await handle.whenRenderable
      await expect(handle.renderSource).resolves.toBe('live')
      expect(target.getText('body').toString()).toBe('room-authority')
      expect(handle.activation?.get()).toMatchObject({ phase: 'live', conflict: null })
    } finally {
      test.releaseSnapshot()
      handle.destroy()
      target.destroy()
    }
  })

  it('keeps fenced preparation renderable and attaches with the exact returned incarnation', async () => {
    const test = await fixture('document-incarnation-a')
    const target = new Y.Doc()
    await expect(test.contract.documentActivation.prepare({ ...key, reason: 'intent' }))
      .resolves.toMatchObject({ status: 'prepared' })
    const handle = test.contract.crdt.open(
      { kind: 'doc', graphId: key.graphId, docId: key.documentId }, target,
    )
    try {
      await handle.whenRenderable
      await expect(handle.renderSource).resolves.toBe('snapshot')
      await vi.waitFor(() => { expect(providerHarness.instances[0].connectCalls).toBe(1) })
      expect(providerHarness.instances[0].params.document_incarnation).toBe('document-incarnation-a')
      expect(target.getText('body').toString()).toBe('snapshot-only')
      expect((await test.storage.get(documentActivationKey(key)))?.incarnation)
        .toBe('document-incarnation-a')
    } finally {
      handle.destroy()
      target.destroy()
    }
  })

  it.each([null, 'document-incarnation-a'])(
    'does not disguise corrupt prepared bytes as a miss when the visible fence is %s',
    async incarnation => {
      const test = await fixture(incarnation, false, new Uint8Array([255]))
      const result = await test.contract.documentActivation.prepare({ ...key, reason: 'intent' })
      expect(result).toMatchObject({ status: 'error', error: expect.any(Error) })
      expect(await test.storage.get(documentActivationKey(key))).toBeUndefined()
      expect(providerHarness.instances).toHaveLength(0)
    },
  )

  it.each([null, 'document-incarnation-a'])(
    'still quarantines preexisting unfenced work when the current visible fence is %s',
    async incarnation => {
      const test = await fixture(incarnation)
      await test.storage.put({
        ...key,
        key: documentActivationKey(key),
        schemaVersion: 1,
        update: updateWithText('existing-offline-work'),
        savedAt: 10,
        authority: 'offline',
        incarnation: null,
      })
      await expect(test.contract.documentActivation.prepare({ ...key, reason: 'intent' }))
        .resolves.toEqual({ status: 'cached' })
      const target = new Y.Doc()
      const handle = test.contract.crdt.open(
        { kind: 'doc', graphId: key.graphId, docId: key.documentId }, target,
      )
      try {
        await vi.waitFor(() => {
          expect(handle.activation?.get()).toMatchObject({ phase: 'conflict', conflict: 'unfenced' })
        })
        expect(providerHarness.instances[0].connectCalls).toBe(0)
        expect(handle.lifecycle.get().shouldConnect).toBe(false)
        expect(target.getText('body').toString()).toBe('existing-offline-work')
        const recoveries = await test.storage.listRecoveries(key)
        expect(recoveries).toHaveLength(1)
        expect(recoveries[0]).toMatchObject({ reason: 'orphaned', incarnation: null })
        const recovered = new Y.Doc()
        try {
          Y.applyUpdate(recovered, recoveries[0].update)
          expect(recovered.getText('body').toString()).toBe('existing-offline-work')
        } finally {
          recovered.destroy()
        }
      } finally {
        handle.destroy()
        target.destroy()
      }
    },
  )
})
