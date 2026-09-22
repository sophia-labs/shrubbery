/**
 * loopback-crdt-backend.ts — TEST-ONLY, minimal REAL `CrdtBackend` over a
 * spawned gardend cell's real doc-sync WebSocket
 * (`/hocuspocus/docs/{graphId}/{docId}`, real `y-websocket` sync protocol).
 *
 * Deliberately NOT a copy of `EditorRoomPool`'s refcount logic (a different
 * concern entirely — WS transport, not pool bookkeeping) and deliberately
 * NOT the full production `apps/organism/src/cell/loopback-crdt-backend.ts`
 * (which additionally layers presence/awareness identity — irrelevant to
 * `hoja-document-face.integration.test.ts`'s proof, which only needs REAL
 * sync + a REAL shared provider). Auth uses the `Sec-WebSocket-Protocol:
 * bearer.<token>` subprotocol form, the same one the production backend uses
 * (garden's loopback_hocuspocus_routes.rs `authorize_ws`).
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import {
  synchronizedCrdtProviderLifecycle,
  type CrdtBackend,
  type CrdtDoc,
  type CrdtRoom,
  type ProviderHandle,
} from '@shrubbery/nucleus'

type WebSocketCtor = new (url: string | URL, protocols?: string | string[]) => unknown

function withBearerSubprotocol(base: WebSocketCtor, token: string): WebSocketCtor {
  const proto = `bearer.${token}`
  return function AuthWebSocket(url: string | URL): unknown {
    return new base(url, proto)
  } as unknown as WebSocketCtor
}

/** `http://127.0.0.1:PORT/mcp` → `ws://127.0.0.1:PORT` (mirrors the production `deriveWsBase`). */
function deriveWsBase(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp$/, '').replace(/^http/i, 'ws')
}

export interface TestLoopbackCrdtOptions {
  readonly mcpUrl: string
  readonly token: string
  /** Node's global WebSocket is shadowed under happy-dom — always inject the `ws` package here. */
  readonly WebSocketPolyfill: WebSocketCtor
}

export class TestLoopbackCrdtBackend implements CrdtBackend {
  private readonly wsBase: string
  private readonly ws: WebSocketCtor
  private readonly destroyers = new Set<() => void>()

  constructor(opts: TestLoopbackCrdtOptions) {
    this.wsBase = deriveWsBase(opts.mcpUrl)
    this.ws = withBearerSubprotocol(opts.WebSocketPolyfill, opts.token)
  }

  open(room: CrdtRoom, doc: CrdtDoc): ProviderHandle {
    if (room.kind !== 'doc' || !room.docId) throw new Error('TestLoopbackCrdtBackend: doc room requires a docId')
    const yDoc = (doc as Y.Doc | undefined) ?? new Y.Doc()
    const serverUrl = `${this.wsBase}/hocuspocus/docs/${room.graphId}`
    const provider = new WebsocketProvider(serverUrl, room.docId, yDoc, {
      connect: true,
      WebSocketPolyfill: this.ws as unknown as typeof WebSocket,
    })
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
      provider.destroy()
      this.destroyers.delete(destroy)
    }
    this.destroyers.add(destroy)
    return {
      doc: yDoc,
      awareness: provider.awareness,
      lifecycle: synchronizedCrdtProviderLifecycle(),
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

  destroyAll(): void {
    for (const destroy of [...this.destroyers]) destroy()
  }
}
