/**
 * local-chat-service.ts — the REAL local in-process ChatService impl.
 *
 * makeLocalChatService({ models?, turnDriver? }) → ChatService. Backed by a REAL
 * InProcessChatStore (option a — see in-process-chat-store.ts for the rationale).
 * It proves the C2 send round-trip with NO LLM and NO SSE (those are C4/Linux-
 * gated): startTurn appends the user ChatMessage, then drives an injectable
 * `turnDriver` that produces a REAL AsyncIterable<ChatEvent>.
 *
 * THE DEFAULT DRIVER = a deterministic in-process ECHO agent (NOT a mock — no
 * vi.fn): it emits a real ChatEvent sequence
 *   turn_start → text deltas (an echo reply) → a tool_call/tool_result demo pair
 *   → done
 * exercising the real projectEvents fold, the real per-gate FIFO call-id
 * synthesis, and the real finalize host-side. The injectable seam is exactly
 * where a Pi/real-LLM driver slots later WITHOUT touching ChatService — the same
 * way garden swaps LocalChatBackend vs ChoreographChatBackend behind one
 * interface.
 *
 * TURN PERSISTENCE: startTurn returns a ChatTurnHandle. The host folds .events
 * via the REAL projectEvents/finalize (re-folding the accumulated array each
 * tick) and, on the terminal event, the host persists the projected assistant
 * ChatMessage back via store.upsertMessages — mirroring garden's LocalChatBackend
 * persisting onTurnEnd. To keep the round-trip self-contained AND let the host
 * own the fold, this impl ALSO folds internally (a private mirror) so the store
 * is durable even if a host only consumes .events for render — but the canonical
 * persistence is the same projectEvents path the panel uses (see the C2.2 test +
 * the C2.4 store, which both fold the SAME .events stream).
 *
 * INVARIANT (survey correctness): during a live turn the projector state is
 * authoritative; hydrateSession only re-reads the store when IDLE. The store is
 * not written with the assistant message until the terminal event — reproducing
 * garden's refreshMessages early-return-when-streaming.
 */

import {
  createProjectorState,
  finalize,
  projectEvents,
  uuid,
  type ChatEvent,
  type ChatMessage,
  type ChatModelOption,
  type ProjectorState,
  type SessionSummary,
} from '@shrubbery/chat-kernel'
import {
  ChatServiceFailure,
  type ChatService,
  type ChatTurnOutcome,
  type ChatTurnHandle,
  type CreateSessionOpts,
  type HydratedSession,
} from './chat-service.js'
import { InProcessChatStore } from './in-process-chat-store.js'

/** A turn driver: given the user text, produce a REAL ChatEvent stream. The
 * default is the ECHO agent; a Pi/LLM driver slots here later (C4) unchanged. */
export type TurnDriver = (userText: string) => AsyncIterable<ChatEvent>

export interface LocalChatServiceOptions {
  /** Models for the selector. Defaults to a single local-echo model. */
  models?: ChatModelOption[]
  /** The turn driver (default = the deterministic ECHO agent). */
  turnDriver?: TurnDriver
}

const DEFAULT_MODELS: ChatModelOption[] = [{ id: 'local-echo', label: 'Local Echo' }]

/**
 * The default ECHO turn driver — a REAL ChatEvent producer (no mock). Emits:
 *   turn_start → two text deltas echoing the user text → a tool_call/tool_result
 *   demo pair (gate 'echo.inspect') → done(full echo text).
 * Deterministic + synchronous-ish (yields via an already-resolved microtask).
 */
async function* echoTurnDriver(userText: string): AsyncIterable<ChatEvent> {
  const reply = `You said: ${userText}`
  yield { type: 'turn_start', turn: 0 }
  // Split the reply into two deltas so the fold exercises appendDelta twice.
  const mid = Math.ceil(reply.length / 2)
  yield { type: 'text', content: reply.slice(0, mid) }
  yield { type: 'text', content: reply.slice(mid) }
  // A real tool_call/tool_result demo pair — exercises updateToolCall (running →
  // completed) + the per-gate FIFO call-id synthesis through the real fold.
  yield { type: 'tool_call', gate: 'echo.inspect', args: { text: userText } }
  yield { type: 'tool_result', gate: 'echo.inspect', result: `len=${userText.length}`, is_error: false }
  yield { type: 'done', output: reply }
}

/** Build the REAL local ChatService over an in-process store + an injectable driver. */
export function makeLocalChatService(opts: LocalChatServiceOptions = {}): ChatService {
  const store = new InProcessChatStore()
  const models = opts.models ?? DEFAULT_MODELS
  const drive = opts.turnDriver ?? echoTurnDriver

  // 3-slot multiplexer state (minimal, per the prompt).
  let activeSlot: 0 | 1 | 2 = 0
  const slots: (string | null)[] = [null, null, null]

  // Per-session in-flight abort flags (cooperative cancel).
  const aborted = new Map<string, boolean>()

  function makeUserMessage(text: string): ChatMessage {
    return {
      id: uuid(),
      role: 'user',
      content: text,
      parts: [{ type: 'text', content: text }],
      isStreaming: false,
      toolCalls: [],
      createdAt: Date.now(),
    }
  }

  return {
    get activeSlot() {
      return activeSlot
    },

    async startTurn(sessionId: string, userText: string): Promise<ChatTurnHandle> {
      // Construct the driver before accepting/persisting the message. A
      // synchronous construction failure is therefore a true pre-accept
      // failure and the host may safely offer Retry send.
      const source = drive(userText)

      // (1) Append the user message to the store immediately (mirrors garden:
      //     the user message persists before the turn streams).
      const { messages: existing } = store.getSession(sessionId)
      const userMsg = makeUserMessage(userText)
      store.appendMessages(sessionId, [userMsg])
      aborted.set(sessionId, false)

      // (2) The base projector state = the persisted history (incl. the user
      //     message) so the host re-fold sees prior turns + the new user bubble.
      const baseMessages = [...existing, userMsg]

      // Settle promise — resolves when the driver stream is fully consumed (or
      // aborted). The host's `for await` consumes .events; we observe terminal
      // via a tee'd internal fold so the store is durable post-turn.
      let resolveDone: (outcome: ChatTurnOutcome) => void = () => {}
      const done = new Promise<ChatTurnOutcome>((res) => {
        resolveDone = res
      })

      // The .events the host folds — a generator that re-yields the driver's
      // events, persisting the assistant ChatMessage on the terminal event (the
      // CANONICAL persistence is this same projectEvents path; the host folds the
      // identical stream for render). Cooperative abort via the aborted flag.
      async function* events(): AsyncIterable<ChatEvent> {
        const collected: ChatEvent[] = []
        let terminalSeen = false
        let outcome: ChatTurnOutcome = { state: 'completed' }
        try {
          try {
            for await (const ev of source) {
              if (aborted.get(sessionId)) {
                outcome = { state: 'aborted' }
                break
              }
              collected.push(ev)
              yield ev
              if (ev.type === 'done' || ev.type === 'truncated' || ev.type === 'error') {
                terminalSeen = true
                break
              }
            }
          } catch (error) {
            const failure = new ChatServiceFailure(
              error instanceof Error ? error.message : String(error),
              { phase: 'stream', recovery: 'reconcile', cause: error },
            )
            outcome = { state: 'failed', failure }
            const terminal: ChatEvent = { type: 'error', message: failure.message }
            collected.push(terminal)
            yield terminal
            terminalSeen = true
          }

          if (!terminalSeen && outcome.state === 'completed') {
            const failure = new ChatServiceFailure('Local turn ended before a terminal event.', {
              phase: 'stream',
              recovery: 'reconcile',
            })
            outcome = { state: 'failed', failure }
            const terminal: ChatEvent = { type: 'error', message: failure.message }
            collected.push(terminal)
            yield terminal
          }
        } finally {
          // Persist the assistant turn: fold the collected stream through the
          // REAL projectEvents/finalize over the user-inclusive base, then write
          // the NEW assistant messages back (only on the terminal event — the
          // store stays unwritten mid-turn, the refreshMessages invariant).
          const terminal = collected[collected.length - 1]
          if (terminal && (terminal.type === 'done' || terminal.type === 'truncated' || terminal.type === 'error')) {
            const { state } = projectEvents(collected, baseProjectorState(baseMessages))
            const finalState = finalize(state, state.streamingMessageId ?? lastAssistantId(state.messages), undefined)
            // The assistant message(s) are everything past the persisted base.
            const assistant = finalState.messages.slice(baseMessages.length)
            if (assistant.length > 0) {
              store.upsertMessages(sessionId, baseMessages.length, assistant)
            }
          }
          aborted.delete(sessionId)
          resolveDone(outcome)
        }
      }

      return {
        events: events(),
        done,
        abort(): void {
          aborted.set(sessionId, true)
        },
      }
    },

    async abort(sessionId: string): Promise<void> {
      aborted.set(sessionId, true)
    },

    async createSession(opts: CreateSessionOpts = {}): Promise<SessionSummary> {
      return store.createSession({ title: opts.title ?? null })
    },

    async listSessions(): Promise<SessionSummary[]> {
      return store.listSessions()
    },

    async hydrateSession(id: string): Promise<HydratedSession> {
      const { session, messages } = store.getSession(id)
      return { session, messages }
    },

    async renameSession(id: string, title: string): Promise<SessionSummary> {
      return store.patchSession(id, title)
    },

    async deleteSession(id: string): Promise<void> {
      store.deleteSession(id)
    },

    models(): ChatModelOption[] {
      return models
    },

    slotSessions(): (string | null)[] {
      return [...slots]
    },

    setActiveSlot(slot: 0 | 1 | 2): void {
      activeSlot = slot
    },

    bindSlotSession(slot: 0 | 1 | 2, sessionId: string | null): void {
      slots[slot] = sessionId
    },
  }
}

// ── fold helpers (kept local; the host uses projectEvents directly) ────────────

/** A projector base seeded with the already-persisted messages (incl. the user
 * bubble). The fold appends the assistant turn after these. */
function baseProjectorState(messages: ChatMessage[]): ProjectorState {
  return createProjectorState([...messages])
}

/** Resolve the terminal assistant message id for finalize when the fold already
 * cleared streamingMessageId on the `done` event (the last assistant message). */
function lastAssistantId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].id
  }
  return null
}
