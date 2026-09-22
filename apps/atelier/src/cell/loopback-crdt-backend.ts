/**
 * loopback-crdt-backend.ts — a REAL CrdtBackend that connects a Y.Doc to a spawned
 * gardend cell's doc-sync WebSocket. SHELL-SIDE (apps/organism), NOT the shrubbery
 * library — the library only ever sees the structural CrdtBackend interface.
 *
 * THIS REPLACES NotWiredCrdtBackend ON THE LIVE PATH. The headless gardend cell the
 * organism already spawns serves a REAL standard y-websocket doc-sync endpoint:
 *   GET /hocuspocus/docs/{graph_id}/{doc_id}     (loopback_hocuspocus_routes.rs)
 *   GET /hocuspocus/workspace/{graph_id}
 * merged at the loopback ROOT (loopback_router.rs), whose serve_room speaks canonical
 * yjs sync (SyncStep1/2/Update + Awareness, encode_v1 — crdt_engine/rooms.rs). So a
 * stock y-websocket WebsocketProvider interoperates with NO server changes.
 *
 * AUTH: the route accepts Authorization: Bearer <token> (Node) OR a
 * `Sec-WebSocket-Protocol: bearer.<token>` subprotocol (browser/proxy-safe). We use the
 * SUBPROTOCOL form uniformly — it works for both the Node global WebSocket and a browser
 * WebSocket, and avoids the header-injection problem (the browser WebSocket API cannot
 * set Authorization; Node's undici-backed global WebSocket likewise). The cell echoes
 * the matched subprotocol on accept. When no token is held (the browser path where the
 * Vite proxy would inject it server-side) we connect with no subprotocol — that path is
 * the labelled L5 residual edge and is not exercised here.
 *
 * URL: WebsocketProvider builds its URL as serverUrl + '/' + roomName, so we split:
 *   doc room       → serverUrl = ws://host/hocuspocus/docs/{graphId}, roomName = docId
 *   workspace room → serverUrl = ws://host/hocuspocus/workspace,      roomName = graphId
 * matching workspace-coordinator.getServerUrl exactly (don't double the path segment).
 *
 * The opaque CrdtDoc cast (`as Y.Doc`) the contract sanctions lives in the host's collab
 * plane; here we MINT the Y.Doc (the shell owns provider lifecycle), pass it through
 * untouched as the contract's CrdtDoc, and the host's collab module resolves it.
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type {
  CrdtBackend,
  CrdtDoc,
  CrdtProviderLifecycle,
  CrdtRoom,
  ProviderHandle,
  ReactiveSource,
} from '@shrubbery/nucleus/contract'

/** The minimal WebSocket constructor shape y-websocket's WebSocketPolyfill needs. */
type WebSocketCtor = new (url: string | URL, protocols?: string | string[]) => unknown

function lifecycleValue(initial: CrdtProviderLifecycle): {
  readonly source: ReactiveSource<CrdtProviderLifecycle>
  set(value: CrdtProviderLifecycle): void
  clear(): void
} {
  let value = Object.freeze({ ...initial })
  const listeners = new Set<(next: CrdtProviderLifecycle) => void>()
  return {
    source: {
      get: () => value,
      subscribe(callback) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    },
    set(next) {
      if (
        next.connection === value.connection
        && next.synchronized === value.synchronized
        && next.shouldConnect === value.shouldConnect
      ) return
      value = Object.freeze({ ...next })
      for (const listener of listeners) listener(value)
    },
    clear: () => listeners.clear(),
  }
}

/**
 * Wrap a base WebSocket constructor so it injects the `bearer.<token>` subprotocol on
 * construct. The cell's authorize_ws() accepts a `bearer.<token>` entry in
 * Sec-WebSocket-Protocol; a WebSocket constructor's 2nd arg is exactly the protocol list.
 * y-websocket calls `new WebSocketPolyfill(url)` with NO protocols, so we supply ours.
 * Same scheme as garden's createAuthWebSocketClass (lib/auth-websocket.ts).
 *
 * The BASE ctor is resolved at construct time:
 *   - browser: the global WebSocket (correct there);
 *   - Node tests / app: an injected polyfill (the `ws` package — Node's global WebSocket
 *     is shadowed under happy-dom, so the Node path passes WebSocketPolyfill explicitly).
 */
function makeAuthWebSocket(base: WebSocketCtor, token: string): WebSocketCtor {
  const proto = `bearer.${token}`
  return function AuthWebSocket(url: string | URL, _protocols?: string | string[]): unknown {
    return new base(url, proto)
  } as unknown as WebSocketCtor
}

/** How the backend reaches the cell's loopback WS endpoint. */
export interface LoopbackCrdtOptions {
  /**
   * The cell's MCP URL (e.g. http://127.0.0.1:PORT/mcp). The WS base is derived by
   * dropping the trailing /mcp and swapping http→ws / https→wss.
   */
  readonly mcpUrl: string
  /** The loopback bearer token. Node path holds it; browser omits it (proxy-injected). */
  readonly token?: string
  /**
   * The base WebSocket constructor to build on. Omit in the browser (the global
   * WebSocket is used). The Node path MUST pass one (the `ws` package) because Node's
   * global WebSocket is shadowed to undefined under happy-dom.
   */
  readonly WebSocketPolyfill?: WebSocketCtor
}

/** Derive the ws(s) base from an http(s) mcpUrl (drop /mcp, flip scheme). */
export function deriveWsBase(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp$/, '').replace(/^http/, 'ws')
}

/**
 * A real CrdtBackend over the spawned cell's loopback doc-sync WebSocket. open(room, doc)
 * builds a WebsocketProvider against /hocuspocus/docs/{graph}/{doc} (or /workspace/{graph})
 * and returns a ProviderHandle whose whenSynced resolves on the provider's 'sync' event.
 */
export class LoopbackCrdtBackend implements CrdtBackend {
  private readonly wsBase: string
  private readonly WS: WebSocketCtor | undefined
  private readonly destroyers = new Set<() => void>()

  constructor(private readonly opts: LoopbackCrdtOptions) {
    this.wsBase = deriveWsBase(opts.mcpUrl)
    // Resolve the base WebSocket ctor: an injected polyfill (Node — the `ws` package),
    // else the browser global WebSocket. When we hold a token, wrap it to inject the
    // bearer.<token> subprotocol. When we have neither token nor polyfill (the browser
    // proxy path — the labelled L5 residual edge), leave WS undefined so y-websocket uses
    // the global WebSocket as-is.
    const base: WebSocketCtor | undefined =
      opts.WebSocketPolyfill ??
      (typeof globalThis.WebSocket === 'function'
        ? (globalThis.WebSocket as unknown as WebSocketCtor)
        : undefined)
    this.WS = base && opts.token ? makeAuthWebSocket(base, opts.token) : base
  }

  open(room: CrdtRoom, doc: CrdtDoc): ProviderHandle {
    const yDoc = (doc as Y.Doc | undefined) ?? new Y.Doc()
    const { serverUrl, roomName } = this.endpointFor(room)
    const provider = new WebsocketProvider(serverUrl, roomName, yDoc, {
      connect: true,
      ...(this.WS ? { WebSocketPolyfill: this.WS as unknown as typeof WebSocket } : {}),
    })
    let shouldConnect = true
    const lifecycle = lifecycleValue({
      connection: 'connecting',
      synchronized: provider.synced,
      shouldConnect,
    })
    const onStatus = ({ status }: { status: string }): void => {
      if (status !== 'connecting' && status !== 'connected' && status !== 'disconnected') return
      const current = lifecycle.source.get()
      lifecycle.set({
        connection: status,
        synchronized: status === 'connected' ? current.synchronized : false,
        shouldConnect,
      })
    }
    const onSync = (synchronized: boolean): void => {
      lifecycle.set({ ...lifecycle.source.get(), synchronized })
    }
    const onConnectionEnd = (): void => {
      lifecycle.set({ connection: 'disconnected', synchronized: false, shouldConnect })
    }
    provider.on('status', onStatus)
    provider.on('sync', onSync)
    provider.on('connection-close', onConnectionEnd)
    provider.on('connection-error', onConnectionEnd)
    const whenSynced = new Promise<void>((resolve) => {
      if (provider.synced) {
        resolve()
        return
      }
      provider.once('sync', (isSynced: boolean) => {
        if (isSynced) resolve()
      })
    })
    let destroyed = false
    const destroy = (): void => {
      if (destroyed) return
      destroyed = true
      shouldConnect = false
      lifecycle.set({ connection: 'disconnected', synchronized: false, shouldConnect })
      provider.off('status', onStatus)
      provider.off('sync', onSync)
      provider.off('connection-close', onConnectionEnd)
      provider.off('connection-error', onConnectionEnd)
      provider.destroy()
      lifecycle.clear()
      this.destroyers.delete(destroy)
    }
    this.destroyers.add(destroy)
    return {
      doc: yDoc,
      awareness: provider.awareness,
      lifecycle: lifecycle.source,
      whenRenderable: whenSynced,
      whenEditable: whenSynced,
      whenSynced,
      renderSource: whenSynced.then(() => 'live' as const),
      destroy,
    }
  }

  schemaVersion(): number {
    return 1
  }

  /** Split a room into (serverUrl, roomName) so WebsocketProvider lands on the route. */
  private endpointFor(room: CrdtRoom): { serverUrl: string; roomName: string } {
    if (room.kind === 'doc') {
      if (!room.docId) throw new Error('LoopbackCrdtBackend: doc room requires a docId')
      return {
        serverUrl: `${this.wsBase}/hocuspocus/docs/${room.graphId}`,
        roomName: room.docId,
      }
    }
    return {
      serverUrl: `${this.wsBase}/hocuspocus/workspace`,
      roomName: room.graphId,
    }
  }

  /** Tear down every provider this backend opened (shell/test cleanup). */
  destroyAll(): void {
    for (const destroy of [...this.destroyers]) destroy()
  }
}
