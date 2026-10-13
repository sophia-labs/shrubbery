/**
 * chat-service.ts — the ChatService SEAM (the chat analog of EditorServices).
 *
 * ChatService is the host-side imperative seam the pure <sh-chat-panel> kernel
 * talks through (via its ChatKernelOptions callbacks). It is the C2 strangle of
 * garden's chat-store mode:'local'|'hosted' fork: the local* path (already
 * contract-shaped, driven through garden's ChatBackend/TurnHandle) LIFTS into a
 * real local ChatService; the ~600 lines of hosted EventSource/reconnect/watchdog
 * DISSOLVE into the backend (C4) — never the kernel, never the local impl.
 *
 * TYPED ENTIRELY IN THE KERNEL'S PURE VOCABULARY (ChatEvent / ChatMessage /
 * SessionSummary / ChatModelOption from @shrubbery/chat-kernel) — NEVER garden's
 * ChatBackend / AgentMessage / Pi types (those carry @mariozechner/pi-* and would
 * breach the kernel's purity). The local impl re-derives token aggregates over
 * ChatMessage.tokens (TokenUsage) rather than reusing garden's computeAggregates,
 * which reads Pi usage.
 *
 * THE TURN ROUND-TRIP (the local impl proves it): startTurn returns a
 * ChatTurnHandle whose `.events` is the kernel's normalized ChatEvent taxonomy
 * (NOT Pi TurnEvent). The host folds it via the REAL projectEvents/finalize:
 *
 *     const h = await svc.startTurn(sessionId, text)
 *     const events: ChatEvent[] = []
 *     for await (const e of h.events) {
 *       events.push(e)
 *       state = projectEvents(events, base).state   // re-fold the WHOLE array
 *     }
 *     const outcome = await h.done
 *     state = finalize(state, msgId, usage)
 *
 * NOTE the fold re-folds the ACCUMULATED array each tick (NOT projectEvents([e],
 * state) per event). projectEvents creates a FRESH ctx (the per-gate FIFO call-id
 * queue + monotonic counters) on every call, so a single-event fold would reset
 * that book-keeping each tick and break tool_call↔tool_result reconciliation
 * (re-minting colliding gate#0 ids). Re-folding from the turn's base sees the
 * whole sequence each tick → the FIFO is correct. (This is NOT garden's loop
 * verbatim — garden threads ONE persistent ctx across the whole turn; shrubbery's
 * projectEvents exposes no ctx-threading, so re-fold-from-base is the honest
 * shrubbery-API analogue with the same correctness.)
 *
 * LIFECYCLE/TRANSPORT FLAGS are NOT methods on this interface — they live in a host-side reactive
 * ChatServiceStore (createChatServiceStore) that WRAPS the ChatService and owns
 * the projected {messages, streaming, conversationState, sendState, error,
 * readOnly} the panel binds. The
 * projector scratch (streamingMessageId/pendingUserMessageId) stays INSIDE that
 * store's ProjectorState, never on this interface. Transport recovery is exposed
 * as typed failure/outcome data; the host never derives it from error strings.
 */

import type {
  ChatEvent,
  ChatMessage,
  ChatModelOption,
  ChatSeam,
  ChatVoiceMark,
  SessionSummary,
} from '@shrubbery/chat-kernel'
import type { ConversationArchive } from './conversation-archive.js'
import type { ContinuationChoice, ContinuationPlan } from './continuation.js'
import type { CreditsFacts } from './credits-facts.js'

/** A live turn — the kernel's normalized event stream + the settle promise + a
 * cooperative cancel. Mirrors garden's TurnHandle SHAPE, but `.events` carries
 * the kernel's ChatEvent (not Pi TurnEvent). */
export interface ChatTurnHandle {
  /** The live turn stream — the kernel's normalized taxonomy, NOT Pi TurnEvent. */
  readonly events: AsyncIterable<ChatEvent>
  /** Resolves with an explicit outcome when the turn settles. A transport ending
   * without an authoritative terminal event is `failed`, never silent success. */
  readonly done: Promise<ChatTurnOutcome>
  /** Cooperative cancel of the in-flight turn. */
  abort(): void
}

/** The operation boundary at which a service failure became observable. */
export type ChatFailurePhase = 'conversation-load' | 'submit' | 'stream'

/** Recovery is service-owned truth, not something the host infers from copy. */
export type ChatFailureRecovery = 'retry-load' | 'resubmit' | 'reconcile' | 'none'

/** A typed failure that crosses the ChatService boundary. */
export class ChatServiceFailure extends Error {
  readonly phase: ChatFailurePhase
  readonly recovery: ChatFailureRecovery

  constructor(
    message: string,
    options: {
      phase: ChatFailurePhase
      recovery: ChatFailureRecovery
      cause?: unknown
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ChatServiceFailure'
    this.phase = options.phase
    this.recovery = options.recovery
  }
}

/** Preserve an existing typed service failure or classify an implementation
 * error at the boundary where its phase/recovery are actually known. */
export function asChatServiceFailure(
  error: unknown,
  fallback: { phase: ChatFailurePhase; recovery: ChatFailureRecovery },
): ChatServiceFailure {
  if (error instanceof ChatServiceFailure) return error
  return new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
    ...fallback,
    cause: error,
  })
}

/**
 * The ways credits (and their pricing) can stop a turn, each with its own honest words:
 *  - `insufficient_credit`  the balance cannot pay for the call. The only kind that may
 *                           borrow the out-of-credits banner.
 *  - `model_unpriced`       the voice has no price the platform will run it at.
 *  - `provider_unavailable` the model provider is down. Nothing to do with the balance.
 *  - `budget_exhausted`     the conversation reached its size limit.
 */
export type ChatBillingKind =
  | 'insufficient_credit'
  | 'model_unpriced'
  | 'provider_unavailable'
  | 'budget_exhausted'

/** What a refusal knows. The numbers are the platform's own, in micro-USD, or null when it named none. */
export interface ChatBillingDetail {
  readonly kind: ChatBillingKind
  /** The balance the platform saw when it refused. */
  readonly balanceMicroUsd: number | null
  /** What the refused call needed at the least. */
  readonly requiredMicroUsd: number | null
}

/**
 * A turn the platform refused for a reason about credits or pricing. A typed
 * {@link ChatServiceFailure}, so anything that only knows failures still shows a plain
 * line (`message` is that line), while the store, which knows this class, shows the
 * one banner and keeps the person's words. Nothing was accepted, so there is nothing to
 * reconcile: `recovery` is never `reconcile`.
 */
export class ChatBillingFailure extends ChatServiceFailure {
  readonly billing: ChatBillingDetail

  constructor(
    message: string,
    options: {
      billing: ChatBillingDetail
      phase: ChatFailurePhase
      recovery: ChatFailureRecovery
      cause?: unknown
    },
  ) {
    super(message, options)
    this.name = 'ChatBillingFailure'
    this.billing = options.billing
  }
}

/** Authoritative settlement of an accepted turn. Agent terminal errors remain
 * completed transcript events; `failed` is reserved for transport/protocol loss. */
export type ChatTurnOutcome =
  | { readonly state: 'completed' }
  | { readonly state: 'aborted' }
  | { readonly state: 'failed'; readonly failure: ChatServiceFailure }

/** Options to mint a new session. graphId/title nullable (a home/untitled session).
 * `modelId` is the voice chosen before the conversation begins; absent means the
 * House default (whatever the runtime answers with when it is not told). */
export interface CreateSessionOpts {
  graphId?: string | null
  modelId?: string
  title?: string | null
}

/**
 * What the runtime behind this chat says it can do, read from its workflow
 * registry (`GET /workflows`). Everything is false until the registry has been
 * read, and a capability the registry does not advertise is never assumed: an
 * older Choreograph drops keys it does not know, so a new client that offered the
 * feature anyway would silently start a plain chat.
 */
export interface ChatCapabilities {
  /** `workspace-chat-v1` advertises `inputs.properties.inference`: a voice can be chosen. */
  readonly voice: boolean
  /** `workspace-chat-v1` advertises `inputs.properties.seed`: a conversation can pick up an earlier one. */
  readonly continuation: boolean
  /**
   * `workspace-chat-v1` advertises `host.access`: what each role's chat may do (the empowered-chat
   * release: `{ owner: 'write', editor: 'write', viewer: 'read' }`). Absent or null: a reader-only chat.
   */
  readonly access?: ChatAccessAdvert | null
}

export const NO_CAPABILITIES: ChatCapabilities = Object.freeze({ voice: false, continuation: false })

/** The person's role on a workspace, as the gateway's graph list reports it. */
export type ChatWorkspaceRole = 'owner' | 'editor' | 'viewer'

/** What a host says each role's chat may do. */
export type ChatAccessAdvert = Readonly<Partial<Record<ChatWorkspaceRole, 'write' | 'read'>>>

/**
 * What Sophia may do in a conversation: change the workspace (as the person), or only read it.
 * The cell checks every write against the person's live role whatever this says; it is what the panel
 * tells the person, not an authority.
 */
export interface ChatAccess {
  readonly mode: 'write' | 'read'
  /**
   * Why:
   *  - `role`: the person's role, and what the host gives that role;
   *  - `backend`: the host's chat only reads (an older Choreograph);
   *  - `conversation`: this conversation's own record (the mode it was bound to when it began; an older
   *    chat keeps the powers it began with, no more).
   */
  readonly basis: 'role' | 'backend' | 'conversation'
  readonly role: ChatWorkspaceRole | null
}

/** The archive conversation a live conversation picked up. */
export interface ConversationLineage {
  readonly archiveConversationUrn: string
  readonly revisionId: string
  readonly title?: string | null
}

/**
 * One row of the one conversation home. `live` is a Choreograph-backed chat (from
 * the server's session list when it advertises one, else this browser's local
 * descriptors); `imported` is an archived conversation from the old garden.
 */
export interface ConversationSummary {
  readonly id: string
  readonly kind: 'live' | 'imported'
  readonly title: string
  readonly graphId?: string
  /** ISO time. */
  readonly updatedAt: string
  readonly createdAt?: string
  /** The models that spoke in it: `provider` is the route or source recorded it under. */
  readonly models?: readonly { readonly id: string; readonly provider: string }[]
  readonly continuesConversation?: ConversationLineage
}

/** The "Continue with..." intent an imported conversation's reader emits. */
export interface ContinueIntent {
  /** The archive conversation URN (`urn:sophia:conversation-archive:conversation:<sha256>`). */
  readonly conversationId: string
  readonly revisionId: string
  readonly title: string
  /** How many messages the reader had loaded; a hint, never used as the window. */
  readonly messagesLoaded: number
}

/** The account's credit balance as the gateway reports it. Reading it changes nothing. */
export interface ChatBalance {
  readonly initialized: boolean
  readonly balanceMicroUsd: number
  /** Whether the gateway itself says a request would be taken now; null when it does not say. */
  readonly canMakeRequests: boolean | null
  /** What the backend says of the credits regime beside the balance; absent from an older backend. */
  readonly facts?: CreditsFacts
}

/** A hydrated session: its summary + the full ordered message history. */
export interface HydratedSession {
  session: SessionSummary
  messages: ChatMessage[]
}

/**
 * The host-side imperative chat seam. The kernel never imports this — the host
 * (the ChatServiceStore + buildChatKernelOptions) projects it into pure callbacks.
 */
export interface ChatService {
  /** Imported account history; reading it never changes the active session. */
  readonly archive?: ConversationArchive
  // ── send / turn (the round-trip the local impl proves) ──
  /**
   * Start a turn on a session; returns a handle whose `.events` is folded
   * host-side via the REAL projectEvents/finalize (re-folding the accumulated
   * ChatEvent[] each tick — see the file header on why per-event folding is
   * wrong). The terminal-event consumer persists the assistant ChatMessage back.
   */
  startTurn(sessionId: string, userText: string): Promise<ChatTurnHandle>
  /** Cooperatively abort the session's in-flight turn (no-op if idle). */
  abort(sessionId: string): Promise<void>

  // ── sessions ──
  createSession(opts?: CreateSessionOpts): Promise<SessionSummary>
  listSessions(): Promise<SessionSummary[]>
  hydrateSession(id: string): Promise<HydratedSession>
  /**
   * Rename a session. rename is NOT on garden's ChatBackend (it bypasses to
   * ChatStore.patchSession, chat-store.ts:687) — so ChatService surfaces it
   * EXPLICITLY rather than leaving the sessions list un-renameable.
   */
  renameSession(id: string, title: string): Promise<SessionSummary>
  deleteSession(id: string): Promise<void>

  // ── models ──
  /** The voices on offer. Empty (so no picker is shown) until the runtime has
   * advertised `inference` and the catalogue has answered; never a placeholder. */
  models(): ChatModelOption[]

  // ── voice (all optional: absent on services with nothing to choose) ──
  /** How the picker's prices are charged, in the host's words (which fee, if it says). Null when nothing on the picker is priced. */
  voiceFootnote?(): string | null
  /** What the runtime advertises for the current graph. */
  readonly capabilities?: ChatCapabilities
  /** Read the registry (idempotent, cached per graph) and, when a voice can be
   * chosen, the catalogue. Resolves once both have answered or failed. */
  probeCapabilities?(): Promise<ChatCapabilities>
  /** Choose the voice of a conversation that has not begun. Throws a typed
   * failure for a conversation that has begun, or a voice that is not offered. */
  setSessionModel?(sessionId: string, modelId: string): void
  /** The voice id the picker should show: the model the runtime resolved, else
   * the one chosen, else null (the House default, unnamed). */
  sessionModelId?(sessionId: string): string | null
  /** The mark for this conversation's assistant messages: the model the runtime
   * reported it resolved. Null until it has said. */
  sessionVoice?(sessionId: string): ChatVoiceMark | null
  /** The seam of a conversation that picked up an earlier one, else null. */
  sessionSeam?(sessionId: string): ChatSeam | null
  /** The archive conversation this one picked up, else null (what "open the original" means). */
  sessionLineage?(sessionId: string): ConversationLineage | null
  /**
   * What Sophia may do here: for a conversation under way, by the mode its own record says it was
   * bound to; for one not yet begun (null), by the person's role and what the host advertises. Null
   * while it cannot be said (the host not yet asked, the role unknown, a Domain Agent's conversation).
   */
  access?(sessionId: string | null): ChatAccess | null
  /** The account's credit balance, when the gateway can say; null otherwise. */
  balance?(): Promise<ChatBalance | null>
  /** Something the store projects (roster, capabilities) changed. */
  subscribe?(listener: () => void): () => void

  // ── one conversation home ──
  /** Live conversations across the person's graphs (the server's session list
   * when advertised, else this browser's descriptors), newest first. */
  listConversations?(): Promise<ConversationSummary[]>

  // ── continuation ──
  /** Read the archive with the person's own token and build the window that would
   * be sent. Sends nothing anywhere. */
  prepareContinuation?(intent: ContinueIntent): Promise<ContinuationPlan>
  /** Open a new conversation that picks up the plan's, in the chosen voice. Nothing
   * leaves the browser until the person sends their first message. */
  continueConversation?(plan: ContinuationPlan, choice: ContinuationChoice): Promise<SessionSummary>

  // ── slots (MINIMAL — a 3-slot UI multiplexer over sessionIds) ──
  readonly activeSlot: 0 | 1 | 2
  slotSessions(): (string | null)[]
  setActiveSlot(slot: 0 | 1 | 2): void
  bindSlotSession(slot: 0 | 1 | 2, sessionId: string | null): void
}
