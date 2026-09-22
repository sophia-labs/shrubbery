/**
 * Hosted gateway Yjs backend.
 *
 * Browser → gateway route shapes preserve the owner-scoped graph prefix:
 *   /o/{owner}/g/{graph}/hocuspocus/docs/{graph}/{doc}
 *   /o/{owner}/g/{graph}/hocuspocus/workspace/{graph}
 * The gateway strips the authoritative owner/graph prefix and swaps the caller
 * token for its cell-service token before bridging to gardend.
 *
 * Gateway auth deliberately uses the query carrier only. Garden's production
 * oracle suppresses `bearer.<token>` for gateway graph URLs: the ALB may strip the
 * offered subprotocol, and browsers then reject a 101 that does not echo it.
 * AuthProvider.onChange rewrites `?token=` and forces a reconnect, so Cognito
 * refresh never leaves y-websocket retrying forever with captured credentials.
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type {
  AuthProvider,
  CrdtBackend,
  CrdtDoc,
  CrdtRoom,
  ProviderHandle,
} from '@shrubbery/nucleus/contract'
import { normalizeGatewayBaseUrl } from './gateway-transport.js'
import {
  clearLocalPresence,
  installLocalPresence,
  PresenceIdentityController,
  presenceRoomLocation,
  type PresenceIdentityControllerOptions,
} from './crdt-presence.js'
import { createCrdtProviderLifecycle } from './crdt-provider-lifecycle.js'
import {
  DocumentActivationManager,
  type VisibleDocumentActivation,
} from './document-activation.js'

export type GatewayWebSocketCtor = new (
  url: string | URL,
  protocols?: string | string[],
) => unknown

export interface GatewayCrdtOptions {
  readonly gatewayBaseUrl: string
  /** Canonical HTTP graph base resolved from the authenticated graph catalog. */
  readonly graphBaseUrl?: (graphId: string) => string
  readonly auth: AuthProvider
  /** Required in Node; browser defaults to global WebSocket. */
  readonly WebSocketPolyfill?: GatewayWebSocketCtor
  /** Garden's production keepalive uses 20 seconds. */
  readonly resyncInterval?: number
  /** Optional deterministic device/tab identity for tests and embedded hosts. */
  readonly presenceIdentity?: PresenceIdentityControllerOptions
  readonly documentActivation?: DocumentActivationManager
  /** Identity-fenced workspace snapshot preflight used before every first open. */
  readonly fetchWorkspaceSnapshot?: (
    graphId: string,
  ) => Promise<{ readonly update: Uint8Array; readonly incarnation: string }>
}

export function gatewayWsRoot(gatewayBaseUrl: string): string {
  return normalizeGatewayBaseUrl(gatewayBaseUrl).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

function segment(value: string, label: string): string {
  if (!value.trim()) throw new Error(`GatewayCrdtBackend: ${label} must not be empty`)
  return encodeURIComponent(value)
}

export class GatewayCrdtBackend implements CrdtBackend {
  private readonly wsRoot: string
  private readonly baseWebSocket: GatewayWebSocketCtor | undefined
  private readonly presenceIdentity: PresenceIdentityController
  private readonly destroyers = new Set<() => void>()

  constructor(private readonly options: GatewayCrdtOptions) {
    this.wsRoot = gatewayWsRoot(options.gatewayBaseUrl)
    this.presenceIdentity = new PresenceIdentityController(options.presenceIdentity)
    this.baseWebSocket = options.WebSocketPolyfill ?? (
      typeof globalThis.WebSocket === 'function'
        ? globalThis.WebSocket as unknown as GatewayWebSocketCtor
        : undefined
    )
  }

  open(room: CrdtRoom, doc: CrdtDoc): ProviderHandle {
    const initialToken = this.options.auth.token()
    if (!initialToken) {
      throw new Error(
        'GatewayCrdtBackend.open(): authentication token is unavailable; await auth.whenReady() before opening a room',
      )
    }
    if (!this.baseWebSocket) {
      throw new Error('GatewayCrdtBackend.open(): no WebSocket constructor is available')
    }

    const yDoc = (doc as Y.Doc | undefined) ?? new Y.Doc()
    const endpoint = this.endpointFor(room)
    const params: Record<string, string> = {
      token: initialToken,
      user_id: this.options.auth.userId(),
    }
    const provider = new WebsocketProvider(endpoint.serverUrl, endpoint.roomName, yDoc, {
      connect: false,
      params,
      resyncInterval: this.options.resyncInterval ?? 20_000,
      // Do not wrap this with a bearer subprotocol in gateway mode. The query
      // token survives the ALB and the gateway swaps it for cell service auth.
      WebSocketPolyfill: this.baseWebSocket as unknown as typeof WebSocket,
    })
    let shouldConnect = true
    const lifecycle = createCrdtProviderLifecycle({
      connection: 'connecting',
      synchronized: provider.synced,
      shouldConnect,
    })
    const publishPresence = (): void => {
      installLocalPresence(
        provider.awareness,
        this.presenceIdentity.next(
          this.options.auth.userId(),
          presenceRoomLocation(room),
        ),
      )
    }
    publishPresence()
    const onStatus = ({ status }: { status: string }): void => {
      if (status === 'connected') publishPresence()
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

    const whenSynced = new Promise<void>(resolve => {
      if (provider.synced) {
        resolve()
      } else {
        provider.once('sync', (isSynced: boolean) => {
          if (isSynced) resolve()
        })
      }
    })
    const activation: VisibleDocumentActivation | null =
      room.kind === 'doc' && room.docId && this.options.documentActivation
        ? this.options.documentActivation.activateVisible(
            {
              userId: this.options.auth.userId(),
              graphId: room.graphId,
              documentId: room.docId,
            },
            yDoc,
            whenSynced,
            lifecycle.source,
          )
        : null
    const whenRenderable = activation?.whenRenderable ?? whenSynced
    const whenEditable = activation?.whenEditable ?? whenSynced
    const renderSource = activation?.renderSource ?? whenSynced.then(() => 'live' as const)
    const activationState = activation?.state
    let connectionPermitted =
      activation === null
      && !(room.kind === 'workspace' && this.options.fetchWorkspaceSnapshot)
    const activationStateUnsubscribe = activationState?.subscribe(state => {
      if (state.phase !== 'conflict' || !shouldConnect) return
      shouldConnect = false
      provider.disconnect()
      clearLocalPresence(provider.awareness)
      lifecycle.set({
        connection: 'disconnected',
        synchronized: false,
        shouldConnect,
      })
    }) ?? null
    if (activation) {
      void activation.connectionPermit.then(permit => {
        if (destroyed || permit.status !== 'allowed') {
          if (permit.status === 'conflict') {
            shouldConnect = false
            lifecycle.set({
              connection: 'disconnected',
              synchronized: false,
              shouldConnect,
            })
          }
          return
        }
        connectionPermitted = true
        if (permit.incarnation) {
          provider.params.document_incarnation = permit.incarnation
        }
        if (this.options.auth.token()) provider.connect()
      })
    } else if (room.kind === 'workspace' && this.options.fetchWorkspaceSnapshot) {
      void this.options.fetchWorkspaceSnapshot(room.graphId).then(snapshot => {
        if (destroyed) return
        Y.applyUpdate(yDoc, snapshot.update, 'workspace-snapshot-preflight')
        provider.params.graph_incarnation = snapshot.incarnation
        connectionPermitted = true
        if (this.options.auth.token()) provider.connect()
      }).catch(() => {
        if (destroyed) return
        shouldConnect = false
        lifecycle.set({
          connection: 'disconnected',
          synchronized: false,
          shouldConnect,
        })
      })
    } else {
      provider.connect()
    }

    let destroyed = false
    const unsubscribeAuth = this.options.auth.onChange(() => {
      if (destroyed) return
      const nextToken = this.options.auth.token()
      const nextUserId = this.options.auth.userId()
      const tokenChanged = provider.params.token !== nextToken
      const userChanged = provider.params.user_id !== nextUserId
      if (!tokenChanged && !userChanged) return

      // Stop the socket carrying old credentials. connect() causes both the URL
      // getter and dynamic WebSocket constructor to consume the new values.
      if (userChanged && activation) {
        // A document Y.Doc activated in one user's cache namespace must never
        // be reconnected under a different human identity. The session layer
        // clears/quarantines the old user's activation and opens a fresh room.
        shouldConnect = false
        lifecycle.set({
          connection: 'disconnected',
          synchronized: false,
          shouldConnect,
        })
        provider.disconnect()
        clearLocalPresence(provider.awareness)
        return
      }
      shouldConnect = Boolean(nextToken)
      lifecycle.set({
        connection: shouldConnect ? 'connecting' : 'disconnected',
        synchronized: false,
        shouldConnect,
      })
      provider.disconnect()
      if (nextToken) provider.params.token = nextToken
      else delete provider.params.token
      provider.params.user_id = nextUserId
      if (nextToken && connectionPermitted) {
        publishPresence()
        provider.connect()
      } else {
        clearLocalPresence(provider.awareness)
      }
    })

    const destroy = (): void => {
      if (destroyed) return
      destroyed = true
      shouldConnect = false
      lifecycle.set({ connection: 'disconnected', synchronized: false, shouldConnect })
      unsubscribeAuth()
      clearLocalPresence(provider.awareness)
      activation?.dispose()
      activationStateUnsubscribe?.()
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
      whenRenderable,
      whenEditable,
      whenSynced,
      renderSource,
      activation: activationState,
      destroy,
    }
  }

  schemaVersion(): number {
    return 1
  }

  destroyAll(): void {
    for (const destroy of [...this.destroyers]) destroy()
  }

  private endpointFor(room: CrdtRoom): { serverUrl: string; roomName: string } {
    const graph = segment(room.graphId, 'graphId')
    const graphBase = this.options.graphBaseUrl
      ? gatewayWsRoot(this.options.graphBaseUrl(room.graphId))
      : `${this.wsRoot}/g/${graph}`
    if (room.kind === 'doc') {
      if (!room.docId) throw new Error('GatewayCrdtBackend: doc room requires a docId')
      return {
        serverUrl: `${graphBase}/hocuspocus/docs/${graph}`,
        roomName: segment(room.docId, 'docId'),
      }
    }
    return {
      serverUrl: `${graphBase}/hocuspocus/workspace`,
      roomName: graph,
    }
  }
}
