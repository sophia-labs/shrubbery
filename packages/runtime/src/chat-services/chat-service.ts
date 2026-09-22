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
  SessionSummary,
} from '@shrubbery/chat-kernel'

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

/** Authoritative settlement of an accepted turn. Agent terminal errors remain
 * completed transcript events; `failed` is reserved for transport/protocol loss. */
export type ChatTurnOutcome =
  | { readonly state: 'completed' }
  | { readonly state: 'aborted' }
  | { readonly state: 'failed'; readonly failure: ChatServiceFailure }

/** Options to mint a new session. graphId/title nullable (a home/untitled session). */
export interface CreateSessionOpts {
  graphId?: string | null
  modelId?: string
  title?: string | null
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
  models(): ChatModelOption[]

  // ── slots (MINIMAL — a 3-slot UI multiplexer over sessionIds) ──
  readonly activeSlot: 0 | 1 | 2
  slotSessions(): (string | null)[]
  setActiveSlot(slot: 0 | 1 | 2): void
  bindSlotSession(slot: 0 | 1 | 2, sessionId: string | null): void
}
