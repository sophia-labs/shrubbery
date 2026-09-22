/**
 * chat-service-store.ts — the host-side reactive store that WRAPS a ChatService.
 *
 * The chat analog of session-store.ts (getState/subscribe). It owns the
 * ProjectorState + lifecycle/continuity flags (streaming, conversationState,
 * sendState, error, readOnly) the panel binds — the ChatService stays the
 * imperative seam (startTurn/sessions/slots), the store is the asReactiveStore
 * projection. The projector scratch
 * (streamingMessageId/pendingUserMessageId) stays INSIDE this store's
 * ProjectorState, never on the ChatService interface and never in the kernel.
 *
 * PLACEMENT (C3): this lives in packages/runtime/src/chat-host/ (host-side,
 * island-quarantined like editor-services/ + collab/) — NOT the kernel. It
 * imports only @shrubbery/chat-kernel (pure types) + the sibling ChatService
 * seam, so it is island-legal as a runtime subdir module. It is the chat analog
 * of editor-host-binding's reactive seam wrapper, lifted out of apps/atelier so
 * <sh-chat-host> (the Class-B chat host) can own it internally + survive
 * interface-grow re-renders.
 *
 * SINGLE-OWNER INVARIANT (C3.0 FIX 2 — the divergence gate). The SERVICE is the
 * single source of truth for message identity + persistence; the store is a
 * projection. send() does NOT mint its own user ChatMessage — startTurn() appends
 * the canonical user message to the store-side persistence (one uuid authority),
 * and the store RE-SEEDS its fold base from svc.hydrateSession AFTER startTurn so
 * the live projector renders the SAME user bubble id that hydrateSession will
 * return. Pre-C3 BOTH the store (uuid A) and the service (uuid B) minted a user
 * message → the live projector and a session-switch-back diverged. Now they can't.
 *
 * THE ROUND-TRIP (send → render): send(text) sets streaming=true (instant
 * feedback), calls svc.startTurn (which persists the canonical user message),
 * re-seeds the fold base from svc.hydrateSession (now containing that user
 * message), then for await over h.events re-folds the ACCUMULATED ChatEvent[]
 * each tick via the REAL projectEvents (NOT projectEvents([e], state) — that
 * resets the per-gate FIFO call-id ctx and breaks tool_call↔tool_result
 * reconciliation), notifying subscribers each tick so the panel re-renders live;
 * then await h.done + finalize, streaming=false.
 *
 * SESSION SWITCH (C3.0 FIX 1 — hydration). setSession(id) optimistically clears
 * (shows immediately), then HYDRATES the prior conversation from
 * svc.hydrateSession so a session-switch re-shows the prior messages, not a blank
 * panel. The hydrate is IDLE-ONLY (never clobbers a live turn — the
 * refreshMessages-when-streaming invariant) and stale-guarded by a monotonic
 * token (a fast A→B→A switch only renders the last switch's messages). This is
 * the chat analog of editor-host gating first mount on provider.whenRenderable.
 *
 * This is the no-mock ORGANISM substrate: a real <sh-chat-panel> bound to
 * buildChatKernelOptions(store-as-source, () => store.getState()) renders the
 * conversation + updates it live as the real local ChatService streams.
 */

import {
  createProjectorState,
  finalize,
  projectEvents,
  type ChatConversationState,
  type ChatContinuityAction,
  type ChatEvent,
  type ProjectorState,
  type ChatSendState,
  type ChatSendRecovery,
} from '@shrubbery/chat-kernel'
import {
  asChatServiceFailure,
  type ChatService,
  type ChatServiceFailure,
} from '../chat-services/chat-service.js'
import type { ChatProjection, ChatProjectionSource } from '../chat-services/assemble.js'

/** The store's reactive state = the kernel render-data + lifecycle the panel binds. */
export interface ChatServiceStoreState extends ChatProjection {
  /** The session this store is bound to (the active slot's session). */
  sessionId: string | null
}

export interface ChatServiceStore extends ChatProjectionSource {
  getState(): ChatServiceStoreState
  subscribe(cb: (state: ChatServiceStoreState) => void): () => void
  /** Bind (or rebind) the session this store renders + sends to. Hydrates the
   * prior conversation (idle-only, stale-guarded) — never a blank panel. */
  setSession(sessionId: string | null): void
  /** The wrapped imperative seam (the shell uses it for sessions/slots). */
  readonly service: ChatService
}

/**
 * Build a reactive store over a ChatService. It folds turn events through the
 * REAL projectEvents/finalize and projects {messages,streaming,error,readOnly}.
 */
export function createChatServiceStore(service: ChatService): ChatServiceStore {
  let sessionId: string | null = null
  let projector: ProjectorState = createProjectorState()
  let streaming = false
  let conversationState: ChatConversationState = 'ready'
  let sendState: ChatSendState = 'ready'
  let sendRecovery: ChatSendRecovery = 'none'
  let sendError: string | null = null
  let pendingSendText: string | null = null
  let pendingBaselineUserCount = 0
  let error: string | null = null
  let readOnly = false
  const models = service.models()
  let currentModel = models[0]?.id ?? ''
  let sessionTitle: string | null = null
  // Monotonic guard for fast session switches: a hydrate only applies if its
  // token is still the latest (a newer setSession bumps it and wins).
  let hydrateToken = 0

  const subs = new Set<(s: ChatServiceStoreState) => void>()

  function snapshot(): ChatServiceStoreState {
    return {
      messages: projector.messages,
      streaming,
      conversationState,
      sendState,
      sendRecovery,
      sendError,
      retainedDraft:
        (sendState === 'error' || sendState === 'uncertain') ? pendingSendText : null,
      error,
      readOnly,
      models,
      currentModel,
      sessionTitle,
      activeSlot: service.activeSlot,
      slotSessions: service.slotSessions(),
      sessionId,
    }
  }

  function notify(): void {
    const s = snapshot()
    for (const cb of subs) cb(s)
  }

  function lastAssistantId(): string | null {
    for (let i = projector.messages.length - 1; i >= 0; i--) {
      if (projector.messages[i].role === 'assistant') return projector.messages[i].id
    }
    return null
  }

  function applySendFailure(failure: ChatServiceFailure): void {
    sendError = failure.message
    if (failure.recovery === 'reconcile') {
      sendState = 'uncertain'
      sendRecovery = 'reconcile'
      return
    }
    sendState = 'error'
    sendRecovery = failure.recovery === 'resubmit' ? 'resubmit' : 'none'
  }

  async function send(text: string): Promise<void> {
    if (!sessionId) {
      pendingSendText = text
      sendState = 'error'
      sendRecovery = 'none'
      sendError = 'No conversation is ready for this message.'
      notify()
      return
    }
    if (streaming) return // one in-flight turn at a time
    const turnSession = sessionId
    let accepted = false

    // (1) Instant feedback: flip streaming on BEFORE awaiting startTurn. The user
    //     bubble is NOT minted here (FIX 2 — the service is the single id authority);
    //     it appears once the base is re-seeded from the service below.
    streaming = true
    pendingSendText = text
    pendingBaselineUserCount = projector.messages.filter(message => message.role === 'user').length
    sendState = 'saving'
    sendRecovery = 'none'
    sendError = null
    error = null
    notify()

    try {
      // (2) Drive the turn. startTurn persists the canonical user message
      //     store-side (the one uuid authority), then streams the assistant turn.
      const h = await service.startTurn(turnSession, text)
      accepted = true
      sendState = 'ready'
      sendRecovery = 'none'
      sendError = null
      conversationState = 'ready'
      // (3) RE-SEED the fold base from the service so the live projector renders
      //     the SAME user-message id hydrateSession will return — no divergence.
      //     (The service appended the user message during startTurn; hydrate sees it.)
      const { messages: seeded } = await service.hydrateSession(turnSession)
      const base = createProjectorState(seeded)
      projector = base
      notify()
      // (4) Fold the accumulated array each tick from THAT base.
      const events: ChatEvent[] = []
      for await (const e of h.events) {
        events.push(e)
        projector = projectEvents(events, base).state
        notify()
      }
      const outcome = await h.done
      projector = finalize(projector, projector.streamingMessageId ?? lastAssistantId(), undefined)
      if (outcome.state === 'failed') {
        applySendFailure(outcome.failure)
      } else {
        pendingSendText = null
        pendingBaselineUserCount = 0
        sendState = 'ready'
        sendRecovery = 'none'
        sendError = null
      }
    } catch (e) {
      const failure = asChatServiceFailure(e, accepted
        ? { phase: 'stream', recovery: 'reconcile' }
        : { phase: 'submit', recovery: 'resubmit' })
      applySendFailure(failure)
      error = null
    } finally {
      streaming = false
      notify()
    }
  }

  function hydrate(
    id: string,
    options: { preserveProjection: boolean; reconcileSubmission?: boolean },
  ): void {
    const token = ++hydrateToken
    conversationState = 'loading'
    error = null
    if (!options.preserveProjection) projector = createProjectorState()
    notify()
    void service
      .hydrateSession(id)
      .then(({ session, messages }) => {
        if (token !== hydrateToken) return
        if (streaming) return
        sessionTitle = session.title
        projector = createProjectorState(messages)
        conversationState = 'ready'
        error = null
        if (options.reconcileSubmission && sendState === 'uncertain') {
          const submittedMessageAppears = pendingSendText != null
            && messages
              .filter(message => message.role === 'user')
              .slice(pendingBaselineUserCount)
              .some(message => message.content === pendingSendText)
          if (submittedMessageAppears) {
            pendingSendText = null
            pendingBaselineUserCount = 0
            sendState = 'ready'
            sendRecovery = 'none'
            sendError = null
          } else {
            sendError = 'Conversation refreshed. Message status is still uncertain; check again before sending.'
          }
        }
        notify()
      })
      .catch((e) => {
        if (token !== hydrateToken) return
        const failure = asChatServiceFailure(e, {
          phase: 'conversation-load',
          recovery: 'retry-load',
        })
        conversationState = 'error'
        error = failure.message
        notify()
      })
  }

  function continuityAction(action: ChatContinuityAction): void {
    if (action.type === 'retry-send') {
      if (sendRecovery === 'resubmit' && pendingSendText && !streaming) void send(pendingSendText)
      return
    }
    if (action.type === 'reconcile-turn') {
      if (sendRecovery === 'reconcile' && sessionId && !streaming) {
        hydrate(sessionId, { preserveProjection: true, reconcileSubmission: true })
      }
      return
    }
    if (
      (action.type === 'retry-load' || action.type === 'retry-connection')
      && sessionId
      && !streaming
    ) {
      hydrate(sessionId, { preserveProjection: true })
    }
  }

  return {
    getState: snapshot,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    setSession(id) {
      sessionId = id
      sessionTitle = null
      if (id != null) service.bindSlotSession(service.activeSlot, id)
      // Optimistic clear — shows immediately, then hydrate the prior conversation.
      projector = createProjectorState()
      streaming = false
      conversationState = id == null ? 'ready' : 'loading'
      sendState = 'ready'
      sendRecovery = 'none'
      sendError = null
      pendingSendText = null
      pendingBaselineUserCount = 0
      error = null
      notify()
      if (id == null) return
      // FIX 1: hydrate from the service so a session-switch re-shows the prior
      // messages (not a blank panel). Stale-guarded + IDLE-only.
      hydrate(id, { preserveProjection: false })
    },
    send(text) {
      void send(text)
    },
    continuityAction,
    setModel(modelId) {
      // The selector is presentation state until a turn exists; the pure panel
      // also locks at that boundary. A transport that persists per-session model
      // selection can consume the same intent without entering the kernel.
      if (projector.messages.length > 0 || !models.some(model => model.id === modelId)) return
      currentModel = modelId
      notify()
    },
    messageAction(_messageId, _action) {
      // copy/read/regenerate/save — host-owned; not exercised by the local organism.
    },
    service,
  }
}
