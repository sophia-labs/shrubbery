/**
 * Production cloud-2 ShrubberyContract.
 *
 * Control-plane reads go to the gateway root. Every graph operation goes
 * through `/o/{owner}/g/{graphId}/mcp`; no browser code learns a cell address
 * or service token. Owner binding comes from the authenticated graph catalog,
 * and the supplied Cognito AuthProvider remains the single auth authority for
 * HTTP and WebSocket construction.
 */

import type {
  AuthProvider,
  RestClient,
  RuntimeModeProvider,
  ShrubberyContract,
  WireCreateRequest,
  WireWriter,
  BlockScore,
  SalienceUserValueRequest,
  SalienceService,
} from '@shrubbery/nucleus/contract'
import {
  createWireModeController,
  uxConfigGraphIri,
  uxControlGraphIri,
} from '@shrubbery/nucleus'
import {
  GardenUiServices,
  parseBlockScore,
  type ConfirmPresenter,
  type RdfDumpEnvelope,
  type SparqlQueryEnvelope,
} from './gardend-contract.js'
import {
  GatewayTransport,
  gatewayMcpText,
  type GatewayGraphInfo,
  type GatewayMcpResult,
  type GatewayTransportOptions,
} from './gateway-transport.js'
import {
  GatewayCrdtBackend,
  type GatewayWebSocketCtor,
} from './gateway-crdt-backend.js'
import { GatewayProviderSecretStore } from './gateway-provider-secret-store.js'
import type { ProviderSecretStore } from './provider-secret-store.js'
import {
  DocumentActivationManager,
  type DocumentActivationStorage,
} from './document-activation.js'
import { SourceMirrorRuntime } from './source-mirror-runtime.js'

class HostedGatewayRuntimeModeProvider implements RuntimeModeProvider {
  constructor(private readonly gateway: GatewayTransport) {}

  mode(): 'local' | 'hosted' {
    return 'hosted'
  }

  isGateway(): boolean {
    return true
  }

  graphBaseUrl(graphId: string): string {
    return this.gateway.graphBaseUrl(graphId)
  }
}

function parsedMcpEnvelope<T>(tool: string, text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(
      `HostedGatewayRestClient.${tool}(): cell returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export class HostedGatewayRestClient implements RestClient {
  constructor(private readonly gateway: GatewayTransport) {}

  graphs(): Promise<readonly GatewayGraphInfo[]> {
    return this.gateway.graphs()
  }

  async query(graphId: string, sparql: string): Promise<SparqlQueryEnvelope> {
    const result = await this.gateway.toolsCall(graphId, 'sparql_query', {
      graphId,
      query: sparql,
    })
    return parsedMcpEnvelope<SparqlQueryEnvelope>('query', gatewayMcpText(result))
  }

  async update(graphId: string, sparql: string): Promise<void> {
    await this.gateway.toolsCall(graphId, 'sparql_update', { graphId, update: sparql })
  }

  documentUpdate(
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Uint8Array> {
    return this.gateway.documentUpdate(graphId, documentId, options)
  }

  documentSnapshot(
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly update: Uint8Array; readonly incarnation: string | null }> {
    return this.gateway.documentSnapshot(graphId, documentId, options)
  }

  /** Generic named-graph dump used by config/control and future shell stores. */
  async dump(
    graphId: string,
    sourceGraphIri: string,
    format = 'application/n-triples',
  ): Promise<RdfDumpEnvelope> {
    const result = await this.gateway.toolsCall(graphId, 'rdf_dump', {
      graphId,
      format,
      sourceGraphIri,
    })
    return parsedMcpEnvelope<RdfDumpEnvelope>('dump', gatewayMcpText(result))
  }

  dumpUxConfig(graphId: string): Promise<RdfDumpEnvelope> {
    return this.dump(graphId, uxConfigGraphIri(graphId))
  }

  dumpUxControl(graphId: string): Promise<RdfDumpEnvelope> {
    return this.dump(graphId, uxControlGraphIri(graphId))
  }
}

function stringAt(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const object = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof object[key] === 'string' && object[key]) return object[key] as string
  }
  return undefined
}

function createdWireId(text: string): string | undefined {
  const envelope = parsedMcpEnvelope<Record<string, unknown>>('wire.create', text)
  const direct = stringAt(envelope, ['wireId', 'wire_id', 'id'])
  if (direct) return direct
  const wires = Array.isArray(envelope.wires) ? envelope.wires : []
  return stringAt(wires[0], ['wireId', 'wire_id', 'id'])
}

export class HostedGatewayWireWriter implements WireWriter {
  constructor(private readonly mcp: HostedGatewayMcpClient) {}

  async create(graphId: string, params: WireCreateRequest): Promise<{ wireId: string }> {
    const wire: Record<string, unknown> = {
      sourceDocumentId: params.sourceDocumentId,
      targetDocumentId: params.targetDocumentId,
      targetGraphId: params.targetGraphId ?? graphId,
      bidirectional: params.bidirectional ?? false,
    }
    if (params.wireId !== undefined) wire.wireId = params.wireId
    if (params.sourceBlockId !== undefined) wire.sourceBlockId = params.sourceBlockId
    if (params.targetBlockId !== undefined) wire.targetBlockId = params.targetBlockId
    if (params.predicate !== undefined) wire.predicate = params.predicate

    const result = await this.mcp.toolsCall('create_wires', {
      graphId,
      wires: [wire],
    })
    const wireId = params.wireId ?? createdWireId(gatewayMcpText(result))
    if (!wireId) throw new Error('HostedGatewayWireWriter.create(): cell did not return a wire id')
    return { wireId }
  }

  async delete(graphId: string, wireId: string): Promise<void> {
    await this.mcp.toolsCall('delete', { graphId, type: 'wires', wireId })
  }
}

/**
 * The salience read (computed score view) + restricted user-value write, same
 * shape as LoopbackSalienceService (gardend-contract.ts) — compositeScore/
 * wireCounts are computed server-side and no MCP tool wraps either the read
 * or the restricted write, so this calls the gateway's graph-scoped REST
 * proxy directly. The gateway strips only `/g/{graphId}` before forwarding,
 * while Garden's cell route still requires its own graph-id segment. Thus the
 * externally visible path intentionally contains the graph twice:
 * `/g/{graphId}/salience/{graphId}/...`.
 */
export class HostedGatewaySalienceService implements SalienceService {
  constructor(private readonly gateway: GatewayTransport) {}

  async getScores(graphId: string, documentId: string): Promise<readonly BlockScore[]> {
    const raw = await this.gateway.getJson<{ blocks?: unknown[] }>(
      graphId,
      `/salience/${encodeURIComponent(graphId)}/blocks/values?document_id=${encodeURIComponent(documentId)}&limit=1000`,
    )
    const blocks = Array.isArray(raw.blocks) ? raw.blocks : []
    return blocks.map((block) => parseBlockScore(block as Record<string, unknown>))
  }

  async setUserValue(graphId: string, params: SalienceUserValueRequest): Promise<BlockScore> {
    const raw = await this.gateway.putJson<Record<string, unknown>>(
      graphId,
      `/salience/${encodeURIComponent(graphId)}/blocks/user-value`,
      {
        documentId: params.documentId,
        blockId: params.blockId,
        importance: params.importance,
        valence: params.valence,
      },
    )
    return parseBlockScore(raw)
  }
}

/** Structural MCP client used by the shell's existing mutation adapters. */
export class HostedGatewayMcpClient {
  constructor(private readonly gateway: GatewayTransport) {}

  async toolsCall(name: string, args: Record<string, unknown>): Promise<GatewayMcpResult> {
    const graphId = typeof args.graphId === 'string' ? args.graphId.trim() : ''
    if (!graphId) {
      throw new Error(`HostedGatewayMcpClient.${name}(): graphId is required`)
    }
    return this.gateway.toolsCall(graphId, name, args)
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const result = await this.toolsCall(name, { ...args })
    if (result.structuredContent !== undefined) return result.structuredContent
    const text = gatewayMcpText(result)
    return text ? JSON.parse(text) as unknown : undefined
  }
}

export interface HostedGatewayContractOptions {
  readonly gatewayBaseUrl: string
  /** The production CognitoAuthSession satisfies this interface. */
  readonly auth: AuthProvider
  readonly fetch?: GatewayTransportOptions['fetch']
  readonly WebSocketPolyfill?: GatewayWebSocketCtor
  readonly crdtResyncInterval?: number
  readonly confirmPresenter?: ConfirmPresenter
  readonly documentActivationStorage?: DocumentActivationStorage
}

export interface HostedGatewayContract extends ShrubberyContract {
  readonly restConcrete: HostedGatewayRestClient
  readonly gateway: GatewayTransport
  readonly crdt: GatewayCrdtBackend
  readonly mcp: HostedGatewayMcpClient
  /**
   * The UNWRAPPED MCP caller — bypasses `SourceMirrorRuntime.wrapMcpClient`'s
   * mirror routing (MO object-face integration spec, WS1 §6.2.4), mirroring
   * `GardendContract.rawMcp`'s own doc comment.
   */
  readonly rawMcp: { callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> }
  readonly providerSecrets: ProviderSecretStore
  readonly documentActivation: DocumentActivationManager
  readonly sourceMirror: SourceMirrorRuntime
}

export function createHostedGatewayContract(
  options: HostedGatewayContractOptions,
): HostedGatewayContract {
  const gateway = new GatewayTransport({
    gatewayBaseUrl: options.gatewayBaseUrl,
    auth: options.auth,
    fetch: options.fetch,
  })
  const liveRest = new HostedGatewayRestClient(gateway)
  const rawMcp = new HostedGatewayMcpClient(gateway)
  let sourceMirror: SourceMirrorRuntime | null = null
  const documentActivation = new DocumentActivationManager({
    storage: options.documentActivationStorage,
    fetchSnapshot: async (graphId, documentId, request) =>
      sourceMirror?.documentSnapshot(graphId, documentId)
      ?? await liveRest.documentSnapshot(graphId, documentId, request),
    fetchUpdate: async (graphId, documentId, request) =>
      sourceMirror?.documentSnapshot(graphId, documentId)?.update
      ?? await liveRest.documentUpdate(graphId, documentId, request),
    // master §3 Slice 8 (WS3 §4.5) — the same `let sourceMirror` late-
    // binding pattern as `fetchSnapshot`/`fetchUpdate` above: this manager
    // is constructed before `SourceMirrorRuntime` exists.
    relatedOperations: (key, documentIncarnation) =>
      sourceMirror?.parkedOperationIdsFor(key, documentIncarnation) ?? [],
  })
  sourceMirror = new SourceMirrorRuntime({
    liveRest,
    caller: rawMcp,
    auth: options.auth,
    documentActivation,
    graphLifecycleTransport: gateway,
  })
  sourceMirror.backgroundFlushGraphLifecycle()
  const mcp = sourceMirror.wrapMcpClient(rawMcp)
  let activationUserId = options.auth.userId()
  options.auth.onChange(() => {
    const nextUserId = options.auth.userId()
    if (!options.auth.isAuthenticated() || nextUserId !== activationUserId) {
      const previousUserId = activationUserId
      activationUserId = nextUserId
      // master §3 Slice 8 (WS3 §8.1, D7 RATIFIED — flip to keep, per-user
      // scoped). Parked work is not session state; logging out must not be
      // the thing that destroys a user's only copy of it.
      // An anonymous session has no user-scoped cache. Passing its empty id to
      // clearUser violates the activation key contract and turns a first
      // Cognito sign-in into an unhandled rejection before the graph boots.
      if (previousUserId.trim()) {
        void documentActivation.clearUser(previousUserId, { retainRecoveries: true })
      }
    }
  })
  const wire = new HostedGatewayWireWriter(mcp)
  const salience = new HostedGatewaySalienceService(gateway)
  return {
    auth: options.auth,
    crdt: new GatewayCrdtBackend({
      gatewayBaseUrl: gateway.gatewayBaseUrl,
      graphBaseUrl: graphId => gateway.graphBaseUrl(graphId),
      auth: options.auth,
      WebSocketPolyfill: options.WebSocketPolyfill,
      resyncInterval: options.crdtResyncInterval,
      documentActivation,
      fetchWorkspaceSnapshot: graphId => gateway.workspaceSnapshot(graphId),
    }),
    runtime: new HostedGatewayRuntimeModeProvider(gateway),
    ui: new GardenUiServices(options.confirmPresenter),
    rest: sourceMirror.rest,
    wire,
    wireMode: createWireModeController({ wire }),
    salience,
    restConcrete: liveRest,
    rawMcp,
    gateway,
    mcp,
    providerSecrets: new GatewayProviderSecretStore(gateway),
    documentActivation,
    sourceMirror,
  }
}
