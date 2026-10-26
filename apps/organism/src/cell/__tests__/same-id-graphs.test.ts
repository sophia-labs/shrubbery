/**
 * Graph ids are unique only per owner. Vera owns `onboarding`; idle shares her own `onboarding` with Vera. Both
 * must list, both must open, and nothing of one may ever be read, written or opened as the other.
 *
 * Real contracts, real transports, real source-mirror runtimes, real room pools; only the network is a recorded
 * fetch and a recording WebSocket (the browser APIs these tests cannot reach).
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { AuthProvider } from '@shrubbery/nucleus'
import { EditorRoomPool } from '@shrubbery/runtime'
import {
  MemoryGraphLifecycleStorage,
  MemorySourceMirrorStorage,
  sourceMirrorKey,
  type GraphLifecycleStorage,
  type SourceMirrorStorage,
} from '@shrubbery/source'
import { localGraphKey } from '@shrubbery/source/graph-ref'
import { createHostedGatewayContract } from '../hosted-gateway-contract.js'
import { GatewayTransport } from '../gateway-transport.js'
import { resolveHostedEntry } from '../hosted-entry-route.js'
import { createSessionStore, MemoryCellConfigReadStorage } from '../session-store.js'
import { mergeHostedWorkspaceCreations, confirmHostedWorkspaceCreation } from '../hosted-workspace-creation.js'
import { RoomMirror, MemoryRoomMirrorStorage } from '../room-mirror.js'

const GATEWAY = 'https://gateway.test'
const VERA_SUB = 'a989b9be-0000-4000-8000-00000000vera'
const VERA = `user:${VERA_SUB}`
const IDLE = 'user:a989b9be-4001-709d-193c-b71fcf9ff45f'
const INC_VERA = '11111111-1111-4111-8111-111111111111'
const INC_IDLE = '22222222-2222-4222-8222-222222222222'

class Auth implements AuthProvider {
  token(): string { return 'vera-token' }
  userId(): string { return VERA_SUB }
  isAuthenticated(): boolean { return true }
  async whenReady(): Promise<void> {}
  onChange(): () => void { return () => {} }
}

const DIRECTORY = [
  { owner: VERA, graphId: 'onboarding', title: 'Onboarding', lifecycleState: 'active', role: 'owner' },
  { owner: IDLE, ownerName: 'idle', graphId: 'onboarding', title: 'Onboarding', lifecycleState: 'active', role: 'editor' },
]

interface Call { readonly url: string; readonly body: unknown }

/** The gateway as these tests need it: the directory, MCP calls answered per owner, workspace snapshots. */
function gateway() {
  const calls: Call[] = []
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    calls.push({ url, body })
    if (url === `${GATEWAY}/graphs`) return Response.json(DIRECTORY)
    const owner = /\/o\/([^/]+)\/g\//.exec(url)?.[1]
    if (url.endsWith('/workspace/blob')) {
      return new Response(Y.encodeStateAsUpdate(new Y.Doc()) as Uint8Array<ArrayBuffer>, {
        headers: { 'x-graph-incarnation': decodeURIComponent(owner ?? '') === IDLE ? INC_IDLE : INC_VERA },
      })
    }
    if (url.endsWith('/mcp')) {
      const request = body as { id: number }
      const who = decodeURIComponent(owner ?? '')
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ resultType: 'solutions', variables: ['who'], rows: [{ who: `"${who}"` }] }) }] },
      })
    }
    return new Response('unexpected', { status: 404 })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

/** Records every socket the rooms open; never connects. */
class RecordingSocket {
  static urls: string[] = []
  binaryType = 'arraybuffer'
  readyState = 0
  onmessage: unknown = null
  onerror: unknown = null
  onclose: unknown = null
  onopen: unknown = null
  readonly url: string
  constructor(url: string | URL) { this.url = String(url); RecordingSocket.urls.push(this.url) }
  close(): void {}
  send(): void {}
}

function sharedMirrorStorage(): SourceMirrorStorage & GraphLifecycleStorage & { readonly mirrors: MemorySourceMirrorStorage } {
  const mirrors = new MemorySourceMirrorStorage()
  const lifecycle = new MemoryGraphLifecycleStorage()
  return {
    mirrors,
    readMirror: key => mirrors.readMirror(key),
    commitMirror: record => mirrors.commitMirror(record),
    putOutbox: record => mirrors.putOutbox(record),
    listOutbox: key => mirrors.listOutbox(key),
    discardMirror: key => mirrors.discardMirror(key),
    putGraphLifecycleIntent: intent => lifecycle.putGraphLifecycleIntent(intent),
    listGraphLifecycleIntents: userId => lifecycle.listGraphLifecycleIntents(userId),
  }
}

function contracts() {
  const network = gateway()
  const storage = sharedMirrorStorage()
  const auth = new Auth()
  const common = {
    gatewayBaseUrl: GATEWAY,
    auth,
    fetch: network.fetch,
    sourceMirrorStorage: storage,
    WebSocketPolyfill: RecordingSocket,
  }
  const own = createHostedGatewayContract(common)
  const theirs = createHostedGatewayContract({ ...common, routeOwner: IDLE })
  return { network, storage, own, theirs }
}

describe('two graphs with one id, from two owners', () => {
  it('both list, and an id alone routes to the account\'s own graph, never refusing it as ambiguous', async () => {
    const network = gateway()
    const transport = new GatewayTransport({ gatewayBaseUrl: GATEWAY, auth: new Auth(), fetch: network.fetch })
    const listed = await transport.graphs()
    expect(listed.map(graph => [graph.owner, graph.graphId])).toEqual([[VERA, 'onboarding'], [IDLE, 'onboarding']])
    expect(transport.graphBaseUrl('onboarding')).toBe(`${GATEWAY}/o/${encodeURIComponent(VERA)}/g/onboarding`)
    expect(transport.forOwner(IDLE).graphBaseUrl('onboarding')).toBe(`${GATEWAY}/o/${encodeURIComponent(IDLE)}/g/onboarding`)
    expect(transport.forOwner(IDLE).ownerOf('anything')).toBe(IDLE)
    // Another owner's transport never creates or deletes: DELETE /graphs/{id} would name the account's own graph.
    await expect(transport.forOwner(IDLE).deleteGraph('onboarding')).rejects.toThrow('Only the owner')
    await expect(transport.forOwner(IDLE).createGraph({ graphId: 'onboarding' })).rejects.toThrow('account\'s own')
    expect(network.calls.filter(call => call.url.includes('/graphs/'))).toEqual([])
  })

  it('opens each through its own owner: real ids on the wire, the right owner in every base URL', async () => {
    const { network, own, theirs } = contracts()
    own.gateway.adoptGraphDirectory(await own.gateway.graphs())
    await own.restConcrete.query('onboarding', 'SELECT ?who WHERE { ?s ?p ?who }')
    await theirs.restConcrete.query('onboarding', 'SELECT ?who WHERE { ?s ?p ?who }')
    const mcp = network.calls.filter(call => call.url.endsWith('/mcp'))
    expect(mcp.map(call => call.url)).toEqual([
      `${GATEWAY}/o/${encodeURIComponent(VERA)}/g/onboarding/mcp`,
      `${GATEWAY}/o/${encodeURIComponent(IDLE)}/g/onboarding/mcp`,
    ])
    // The graph id in the tool arguments is the real id, for both: no local key ever reaches a cell.
    for (const call of mcp) {
      expect((call.body as { params: { arguments: { graphId: string } } }).params.arguments.graphId).toBe('onboarding')
      expect(JSON.stringify(call.body)).not.toContain('\u001f')
    }
    expect(own.routeOwner).toBeNull()
    expect(theirs.routeOwner).toBe(IDLE)
  })

  it('keeps the account\'s own keys byte-identical and gives the other owner\'s graph its own', () => {
    const { own, theirs } = contracts()
    expect(own.graphKey('onboarding')).toBe('onboarding')
    expect(theirs.graphKey('onboarding')).toBe(localGraphKey({ owner: IDLE, graphId: 'onboarding' }, VERA_SUB))
    expect(theirs.graphKey('onboarding')).not.toBe('onboarding')
  })

  it('files the two offline mirrors apart in one store, and never reuses an unqualified copy for the other', async () => {
    const { storage, own, theirs } = contracts()
    // Vera's own copy, filed exactly where every earlier release filed it.
    await own.sourceMirror.provisionGraph('onboarding', INC_VERA)
    const ownKey = sourceMirrorKey({ userId: VERA_SUB, graphId: 'onboarding' })
    expect(ownKey).toBe(`${VERA_SUB}\u001fonboarding`)
    expect([...storage.mirrors.mirrors.keys()]).toEqual([ownKey])

    // idle's graph does not find Vera's copy under the bare id: it is absent until its own arrives.
    const before = await theirs.sourceMirror.open('onboarding')
    expect(before.get()).toMatchObject({ complete: false, graphIncarnation: null })
    await theirs.sourceMirror.provisionGraph('onboarding', INC_IDLE)
    expect(storage.mirrors.mirrors.size).toBe(2)
    expect(storage.mirrors.mirrors.get(ownKey)?.graphIncarnation).toBe(INC_VERA)
    const theirKey = [...storage.mirrors.mirrors.keys()].find(key => key !== ownKey)!
    expect(storage.mirrors.mirrors.get(theirKey)).toMatchObject({ graphId: 'onboarding', graphIncarnation: INC_IDLE })

    // Cold starts over the same store: each reads back only its own graph.
    const { own: coldOwn, theirs: coldTheirs } = { own: createHostedGatewayContract({ gatewayBaseUrl: GATEWAY, auth: new Auth(), fetch: gateway().fetch, sourceMirrorStorage: storage }), theirs: createHostedGatewayContract({ gatewayBaseUrl: GATEWAY, auth: new Auth(), fetch: gateway().fetch, sourceMirrorStorage: storage, routeOwner: IDLE }) }
    expect((await coldOwn.sourceMirror.open('onboarding')).get().graphIncarnation).toBe(INC_VERA)
    expect((await coldTheirs.sourceMirror.open('onboarding')).get().graphIncarnation).toBe(INC_IDLE)
  })

  it('opens their rooms in separate pools, each socket and snapshot naming its own owner', async () => {
    RecordingSocket.urls = []
    const { network, own, theirs } = contracts()
    own.gateway.adoptGraphDirectory(await own.gateway.graphs())
    const ownPool = new EditorRoomPool(own.crdt)
    const theirPool = new EditorRoomPool(theirs.crdt)
    const mine = ownPool.acquire({ kind: 'workspace', graphId: 'onboarding' }, 'pane-a')
    const idles = theirPool.acquire({ kind: 'workspace', graphId: 'onboarding' }, 'pane-a')
    // The same room key in each pool, never the same room.
    expect(mine.roomKey).toBe(idles.roomKey)
    expect(mine.provider).not.toBe(idles.provider)
    expect(mine.provider.doc).not.toBe(idles.provider.doc)
    await expect.poll(() => RecordingSocket.urls.length).toBe(2)
    const snapshots = network.calls.filter(call => call.url.endsWith('/workspace/blob')).map(call => call.url)
    expect(snapshots).toEqual([
      `${GATEWAY}/o/${encodeURIComponent(VERA)}/g/onboarding/documents/onboarding/workspace/blob`,
      `${GATEWAY}/o/${encodeURIComponent(IDLE)}/g/onboarding/documents/onboarding/workspace/blob`,
    ])
    expect(RecordingSocket.urls.map(url => url.split('?')[0])).toEqual([
      `wss://gateway.test/o/${encodeURIComponent(VERA)}/g/onboarding/hocuspocus/workspace/onboarding`,
      `wss://gateway.test/o/${encodeURIComponent(IDLE)}/g/onboarding/hocuspocus/workspace/onboarding`,
    ])
    mine.release()
    idles.release()
    ownPool.destroyAll()
    theirPool.destroyAll()
  })

  it('files the room mirror, the config cache and the navigation hint under each graph\'s own key', async () => {
    const { own, theirs } = contracts()
    const roomStorage = new MemoryRoomMirrorStorage()
    const dumps: string[] = []
    const mirrorFor = (contract: typeof own) => new RoomMirror({
      dumper: { dump: async (graphId: string, graphIri: string) => { dumps.push(`${contract.routeOwner ?? 'own'} ${graphId}`); return { data: `<urn:s> <urn:p> "${contract.routeOwner ?? 'own'} ${graphIri}" .\n` } } },
      liveRest: contract.rest,
      userId: () => VERA_SUB,
      graphKey: contract.graphKey,
      storage: roomStorage,
      pollMs: 0,
      graphIrisFor: () => ['urn:graph:room'],
    })
    const ownMirror = mirrorFor(own)
    const theirMirror = mirrorFor(theirs)
    await ownMirror.ensureOpen('onboarding')
    await theirMirror.ensureOpen('onboarding')
    expect(dumps).toEqual(['own onboarding', `${IDLE} onboarding`])
    expect((await roomStorage.read(VERA_SUB, 'onboarding', 'urn:graph:room'))?.nt).toContain('own')
    expect((await roomStorage.read(VERA_SUB, theirs.graphKey('onboarding'), 'urn:graph:room'))?.nt).toContain(IDLE)
    // Their read services are two resources, never one (the shell rotates on identity).
    expect(ownMirror.queryService('onboarding')).not.toBe(theirMirror.queryService('onboarding'))
    ownMirror.closeAll()
    theirMirror.closeAll()

    // The workspace config's offline copy: offline, each session store looks for it under its contract's key.
    const asked: string[] = []
    class RecordingCache extends MemoryCellConfigReadStorage {
      override async get(userId: string, graphId: string) { asked.push(graphId); return super.get(userId, graphId) }
    }
    const cache = new RecordingCache()
    const offline = (async () => { throw new TypeError('Failed to fetch') }) as typeof globalThis.fetch
    const offlineOwn = createHostedGatewayContract({ gatewayBaseUrl: GATEWAY, auth: new Auth(), fetch: offline, sourceMirrorStorage: sharedMirrorStorage() })
    const offlineTheirs = createHostedGatewayContract({ gatewayBaseUrl: GATEWAY, auth: new Auth(), fetch: offline, sourceMirrorStorage: sharedMirrorStorage(), routeOwner: IDLE })
    const ownStore = createSessionStore({ contract: offlineOwn, graphId: 'onboarding', offlineStorage: cache })
    const theirStore = createSessionStore({ contract: offlineTheirs, graphId: 'onboarding', offlineStorage: cache })
    await ownStore.refresh()
    await theirStore.refresh()
    expect(asked).toEqual(['onboarding', theirs.graphKey('onboarding')])

    // The navigation hint: another owner's contract writes beside the account's, never over it.
    localStorage.clear()
    own.documentActivation.rememberNavigation({ userId: VERA_SUB, graphId: 'onboarding', documentId: 'mine' })
    theirs.documentActivation.rememberNavigation({ userId: VERA_SUB, graphId: 'onboarding', documentId: 'theirs' })
    expect(own.documentActivation.readNavigation(VERA_SUB)?.documentId).toBe('mine')
    expect(theirs.documentActivation.readNavigation(VERA_SUB)?.documentId).toBe('theirs')
    expect(localStorage.length).toBe(2)
  })

  it('enters either one by address: the bare id is the account\'s own, `owner=` names the other', async () => {
    const loadGraphs = async () => DIRECTORY.map(row => ({ ...row, role: row.role as 'owner' | 'editor', cellState: 'running' as const }))
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/g/onboarding'), self: VERA_SUB, loadGraphs }))
      .resolves.toEqual({ kind: 'graph', graphId: 'onboarding' })
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/?graph=onboarding'), self: VERA_SUB, loadGraphs }))
      .resolves.toEqual({ kind: 'graph', graphId: 'onboarding' })
    await expect(resolveHostedEntry({ location: new URL(`https://garden.test/g/onboarding?owner=${encodeURIComponent(IDLE)}`), self: VERA_SUB, loadGraphs }))
      .resolves.toEqual({ kind: 'graph', graphId: 'onboarding', owner: IDLE })
    // A stored selection is a graph key: the other owner's is remembered as theirs.
    await expect(resolveHostedEntry({
      location: new URL('https://garden.test/x'), self: VERA_SUB, loadGraphs,
      storedGraphId: localGraphKey({ owner: IDLE, graphId: 'onboarding' }, VERA_SUB),
    })).resolves.toEqual({ kind: 'graph', graphId: 'onboarding', owner: IDLE })
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/g/onboarding?owner=user%3Anobody'), self: VERA_SUB, loadGraphs }))
      .rejects.toThrow('not available')
    // Two other owners and none is the account: an id alone cannot choose.
    const twoOthers = async () => [
      { owner: IDLE, graphId: 'notes', title: 'A', role: 'viewer' as const, cellState: 'running' as const },
      { owner: 'user:lucy', graphId: 'notes', title: 'B', role: 'viewer' as const, cellState: 'running' as const },
    ]
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/g/notes'), self: VERA_SUB, loadGraphs: twoOthers }))
      .rejects.toThrow('More than one person')
  })

  it('never lets a shared same-id graph hide or confirm the account\'s own local creation', async () => {
    const intent = {
      key: 'k', userId: VERA_SUB, kind: 'create' as const, graphId: 'onboarding', graphIncarnation: INC_VERA,
      operationId: 'graph:create:x', title: 'Onboarding', status: 'pending' as const, createdAt: 1, updatedAt: 1, attempts: 1,
    }
    const shared = [{ owner: IDLE, graphId: 'onboarding', title: 'Onboarding', role: 'editor' as const, cellState: 'running' as const }]
    const merged = mergeHostedWorkspaceCreations(shared, [intent])
    expect(merged.map(graph => [graph.owner ?? null, Boolean(graph.localCreation)])).toEqual([[IDLE, false], [null, true]])
    await expect(confirmHostedWorkspaceCreation({ ...intent, status: 'applied' }, async () => shared)).rejects.toThrow('has not confirmed')
    const both = [...shared, { owner: VERA, graphId: 'onboarding', title: 'Onboarding', role: 'owner' as const, cellState: 'running' as const }]
    await expect(confirmHostedWorkspaceCreation({ ...intent, status: 'applied' }, async () => both)).resolves.toMatchObject({ owner: VERA })
  })
})
