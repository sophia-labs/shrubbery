/**
 * assemble.ts — the ChatService FACTORY + the boundary adapter to the pure kernel.
 *
 * Mirrors assembleEditorServices EXACTLY: assembleChatServices(contract, getScope,
 * mode) → ChatService is the host-side factory; buildChatKernelOptions(service,
 * projection) → Pick<ChatKernelOptions, …> is the boundary adapter that projects
 * the stateful service + a host store into the kernel's PURE props/callbacks.
 *
 * THE TWO BRANCHES:
 *   - 'local' = makeLocalChatService (in-process store + injected driver).
 *   - 'hosted' = makeHostedChatService (gateway-bound Agent workflows/Sessions).
 *
 * MODE NOTE (load-bearing): this 'hosted' is the C2/C4 ChatService hosted seam —
 * it is NOT garden chat-store's 'hosted' mode. Garden's 'hosted' = LEGACY OpenCode
 * REST+SSE (dissolves entirely); the gen-2 hosted path is a graph-gateway Agent
 * workflow backed by durable Agent Sessions. Lifecycle and transport remain
 * outside the kernel.
 *
 * The boundary adapter — like buildKernelOptions — never smuggles a transport
 * implementation through the callback boundary. It projects only render data,
 * coarse continuity posture, and typed intents. Timers, sockets, retry payloads,
 * and lifecycle ownership stay in the ChatService/store.
 */

import type { ShrubberyContract, EditorScope } from '@shrubbery/nucleus'
import type {
  ChatAccessNote,
  ChatAccountNote,
  ChatComposerNotice,
  ChatConnectionState,
  ChatConversationState,
  ChatContinuityAction,
  ChatKernelOptions,
  ChatMessage,
  ChatModelOption,
  ChatSeam,
  ChatSeamAction,
  ChatSendState,
  ChatSendRecovery,
  ChatSessionSlot,
} from '@shrubbery/chat-kernel'
import type { ChatService } from './chat-service.js'
import { makeLocalChatService, type TurnDriver } from './local-chat-service.js'
import {
  makeHostedChatService,
  type HostedChatServiceOptions,
} from './hosted-chat-service.js'

/** The runtime mode for the chat seam. See the file header on what each means. */
export type ChatServiceMode = 'local' | 'hosted'

/**
 * Derive the model selector from the live scope, read AT CALL TIME (the
 * stateless-bundle move — same as editor-services reading getScope().graphId at
 * call time). This makes getScope LOAD-BEARING on the local path (it is no longer
 * dead `void getScope` ceremony) and keeps the signature parallel to
 * assembleEditorServices for the C4 hosted branch, which WILL read scope.graphId
 * for choreograph session routing.
 *
 * The local echo model is graph-scoped so the selector reflects the active graph
 * — a trivial-but-real scope derivation (the C4 hosted branch replaces this with
 * the real per-graph model roster off the contract/auth).
 */
export function defaultModels(getScope: () => EditorScope): ChatModelOption[] {
  const graphId = getScope().graphId
  return [{ id: 'local-echo', label: graphId ? `Local Echo (${graphId})` : 'Local Echo' }]
}

/**
 * Assemble a ChatService over the contract + a scope getter (read AT CALL TIME,
 * the stateless-bundle move, same as editor-services). The local impl uses the
 * contract lightly (or not at all for the in-memory store) — it is threaded so a
 * future driver can read models/auth/runtime off it without an interface change.
 *
 *   - 'local'  → makeLocalChatService (default models via the scope).
 *   - 'hosted' → makeHostedChatService when explicit connection options exist.
 *
 * TURN DRIVER (N0a): the optional `turnDriver` is the injectable seam this file's
 * header anticipates ("a future driver can read models/auth/runtime off [the
 * contract] without an interface change"). The shell builds a GrowCell port over
 * the SAME contract + graphId and passes makeGrowTurnDriver(port, graphId) here —
 * the deterministic LOCAL-N0 grow-driver — replacing the default ECHO driver. When
 * omitted, the local impl keeps its default ECHO driver. Hosted Choreograph is
 * configured through AssembleChatServicesOptions.hosted.
 */
/**
 * Where the hosted ChatService reaches Choreograph, and as whom, when that is not the contract's gateway.
 * A self-host's gardend proxies its own Choreograph at `${origin}/services/choreograph/api` (the same
 * paths as the gateway's graph route, below a base that names no graph), takes the self-host key (or
 * nothing, under Cloudflare Access), and asserts its own user to Choreograph, which the chat must speak as.
 */
export interface ChatEndpoint {
  readonly graphBaseUrl: (graphId: string) => string
  readonly token: () => string | undefined
  readonly userId: () => string
  /**
   * The graph's owner as the invocation must name it (`graph.ownerPrincipal`), where no gateway forces it in.
   * Absent: none is named.
   */
  readonly graphOwner?: () => string
}

export interface AssembleChatServicesOptions {
  readonly turnDriver?: TurnDriver
  readonly hosted?: Omit<
    HostedChatServiceOptions,
    'graphBaseUrl' | 'graphId' | 'userId' | 'token' | 'graphOwnerPrincipal'
  >
  /** Absent: the contract's graph route, token and user (the gateway), as always. */
  readonly endpoint?: ChatEndpoint
  /**
   * The conversation's graph. Chat is GRAPH-scoped, not document-scoped: a
   * conversation belongs to the workspace, not to whichever document happens to
   * be open. `getScope().graphId` is the OPEN DOCUMENT's graph and is honestly
   * null in 'home' mode (EditorScope's own contract), so deriving the chat's
   * graph from it creates sessions with no graph whenever nothing is open — the
   * standalone chat route always, the main shell until a document is clicked.
   * Choreograph's spawner then falls back to a hardcoded default graph
   * (`spawner.ts` `default_graph_id`), which on cloud-2 does not exist: MCP tool
   * discovery 404s, the agent sandbox exits 1, and the turn dies with no reply.
   * A shell that knows its workspace MUST pass it here.
   */
  readonly graphId?: () => string | null
}

export function assembleChatServices(
  contract: ShrubberyContract,
  getScope: () => EditorScope,
  mode: ChatServiceMode,
  driverOrOptions?: TurnDriver | AssembleChatServicesOptions,
): ChatService {
  if (mode === 'hosted') {
    const connection =
      typeof driverOrOptions === 'function' ? undefined : driverOrOptions?.hosted
    if (!connection) {
      throw new Error(
        'hosted ChatService requires hosted connection options.',
      )
    }
    const options = typeof driverOrOptions === 'function' ? undefined : driverOrOptions
    const graphId = options?.graphId ?? ((): string | null => getScope().graphId)
    const endpoint = options?.endpoint
    return makeHostedChatService({
      ...connection,
      graphBaseUrl: endpoint ? endpoint.graphBaseUrl : (id: string) => contract.runtime.graphBaseUrl(id),
      graphId,
      userId: endpoint ? endpoint.userId : () => contract.auth.userId(),
      token: endpoint ? endpoint.token : () => contract.auth.token(),
      ...(endpoint?.graphOwner ? { graphOwnerPrincipal: endpoint.graphOwner } : {}),
    })
  }
  // 'local' — REAL now. getScope is LOAD-BEARING: defaultModels(getScope) derives
  // the model selector from the live scope at call time (the editor-services
  // parallel — no dead `void getScope`). The contract is accepted to match the
  // editor-services signature; the in-process round-trip needs it only for a
  // future Pi/LLM driver that would read auth/runtime off it here.
  void contract
  const turnDriver =
    typeof driverOrOptions === 'function' ? driverOrOptions : driverOrOptions?.turnDriver
  return makeLocalChatService({ models: defaultModels(getScope), turnDriver })
}

/** The pure render-data + lifecycle the host store projects for the kernel. */
export interface ChatProjection {
  messages: ChatMessage[]
  streaming: boolean
  /** The service takes a message while a reply is under way (it steers it). */
  steerWhileStreaming?: boolean
  conversationState?: ChatConversationState
  /** Compatibility input for hosts not yet projecting conversationState. Gen-2
   * runtime stores do not emit offline/reconnecting. */
  connectionState?: ChatConnectionState
  sendState?: ChatSendState
  sendRecovery?: ChatSendRecovery
  sendError?: string | null
  /** Host-only draft recovery; buildChatKernelOptions deliberately does not map
   * this because sh-chat-host owns draft persistence. */
  retainedDraft?: string | null
  error: string | null
  readOnly: boolean
  models: ChatModelOption[]
  currentModel: string
  sessionTitle: string | null
  activeSlot: ChatSessionSlot
  slotSessions: readonly (string | null)[]
  /** The host's account line beside the picker (the credit balance). Rendered, never computed, by the kernel. */
  accountNote?: ChatAccountNote | null
  /** The notice above the composer: a refusal for credit, the size limit. Rendered, never computed, by the kernel. */
  composerNotice?: ChatComposerNotice | null
  /** What the picker's prices are and how they are charged, in the host's words. */
  voiceFootnote?: string | null
  /** Present when this conversation picked up an earlier one. */
  seam?: ChatSeam | null
  /** What the chat may do here (change, or only read), in the host's words. */
  accessNote?: ChatAccessNote | null
}

/** What the host store must expose so the boundary adapter can drive a turn. */
export interface ChatProjectionSource {
  /** Drive a send: append the user bubble, fold svc.startTurn(...).events via the
   * REAL projectEvents into the host store, then finalize. Owns the lifecycle. */
  send(text: string): void
  /** Pick a different model (host-owned). */
  setModel?(modelId: string): void
  /** A message-level action intent (copy/read/regenerate/save) — host-owned. */
  messageAction?(messageId: string, action: 'copy' | 'read' | 'regenerate' | 'save-garden' | 'branch'): void
  /** Retry an operation whose payload/lifecycle remains owned by the host. */
  continuityAction?(action: ChatContinuityAction): void
  /** The action of the composer notice was chosen. */
  composerNoticeAction?(id: string): void
  /** The action beside the balance line was chosen. */
  accountAction?(id: string): void
  /** Something on the seam was chosen (opening the original). */
  seamAction?(action: ChatSeamAction): void
}

/**
 * The BOUNDARY ADAPTER (mirrors buildKernelOptions): project the stateful
 * service+store into the kernel's PURE props/callbacks. Returns only render data,
 * a small controlled continuity vocabulary, and intents — never a transport or
 * retry implementation (those stay in the store).
 *
 *   - render data: messages / streaming / continuity / error / readOnly come
 *     from `projection()`.
 *   - onSend(text): drives source.send(text) (which folds the turn host-side).
 *   - onModelChange / onMessageAction: host-owned intents.
 *
 * onSurfaceAction is intentionally NOT projected here (surface routing is a shell
 * concern the host wires separately, like editor navigation) — buildKernelOptions
 * likewise scopes itself to the seam it owns.
 */
export function buildChatKernelOptions(
  source: ChatProjectionSource,
  projection: () => ChatProjection,
): Pick<
  ChatKernelOptions,
  'messages' | 'streaming' | 'steerWhileStreaming' | 'error' | 'readOnly' | 'models' | 'currentModel'
  | 'conversationState' | 'sendState' | 'sendRecovery' | 'sendError' | 'onContinuityAction'
  | 'onSend' | 'onModelChange' | 'onMessageAction'
  | 'sessionTitle'
  | 'activeSlot'
  | 'slotSessions'
  | 'accountNote' | 'composerNotice' | 'onComposerNoticeAction'
  | 'onAccountAction' | 'voiceFootnote'
  | 'seam' | 'onSeamAction'
  | 'accessNote'
> {
  const p = projection()
  return {
    messages: p.messages,
    streaming: p.streaming,
    steerWhileStreaming: p.steerWhileStreaming === true,
    conversationState: p.conversationState
      ?? (p.connectionState === 'loading' || p.connectionState === 'error' ? p.connectionState : 'ready'),
    sendState: p.sendState ?? 'ready',
    sendRecovery: p.sendRecovery ?? 'none',
    sendError: p.sendError ?? null,
    error: p.error,
    readOnly: p.readOnly,
    models: p.models,
    currentModel: p.currentModel,
    sessionTitle: p.sessionTitle,
    activeSlot: p.activeSlot,
    slotSessions: p.slotSessions,
    accountNote: p.accountNote ?? null,
    composerNotice: p.composerNotice ?? null,
    voiceFootnote: p.voiceFootnote ?? null,
    seam: p.seam ?? null,
    accessNote: p.accessNote ?? null,
    onSend: (text: string): void => source.send(text),
    onModelChange: (modelId: string): void => source.setModel?.(modelId),
    onMessageAction: (messageId, action): void => source.messageAction?.(messageId, action),
    onContinuityAction: (action): void => source.continuityAction?.(action),
    onComposerNoticeAction: (id): void => source.composerNoticeAction?.(id),
    onAccountAction: (id): void => source.accountAction?.(id),
    onSeamAction: (action): void => source.seamAction?.(action),
  }
}
