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
  modelIdTail,
  projectEvents,
  voiceMarkFor,
  type ChatComposerNotice,
  type ChatConversationState,
  type ChatContinuityAction,
  type ChatEvent,
  type ChatMessage,
  type ChatModelOption,
  type ChatVoiceMark,
  type ProjectorState,
  type ChatSendState,
  type ChatSendRecovery,
} from '@shrubbery/chat-kernel'
import {
  asChatServiceFailure,
  ChatBillingFailure,
  type ChatBillingDetail,
  type ChatService,
  type ChatServiceFailure,
  NO_CAPABILITIES,
} from '../chat-services/chat-service.js'
import {
  accountNoteFor,
  billingNotice,
  budgetNotice,
  minAdmitMicroUsd,
  priceFootnote,
  type BalanceReading,
} from '../chat-services/chat-billing.js'
import type { ChatProjection, ChatProjectionSource } from '../chat-services/assemble.js'
import { accessNoteFor } from '../chat-services/chat-access.js'
import type { CreditsFacts } from '../chat-services/credits-facts.js'

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
  /**
   * What the person needs to know to add credits, in micro-USD: their balance and what
   * one message needs at the least. From the refusal on screen when there is one (the
   * platform's own numbers), else from the balance line and the voice in use. Null where
   * nothing is known.
   */
  creditsNeed(): { readonly balanceMicroUsd: number | null; readonly requiredMicroUsd: number | null }
  /**
   * What the backend said of the credits regime (the fee, the gate's mode, the day credits start) on the
   * last read of the balance: null before a read, after a read that failed with none before it, and for
   * good from an older backend that says none of it.
   */
  creditsFacts(): CreditsFacts | null
  /** Stop listening to the service. The host calls it when it replaces this store. */
  dispose(): void
}

export interface ChatServiceStoreOptions {
  /**
   * Whether the shell can take the person to add credits (it answers `sh-chat-add-credits`). Asked
   * each time the balance line or a refusal banner is projected; absent means no. Where it cannot,
   * no button is offered, and a balance that is only low is not called "out": the next message
   * still goes through.
   */
  readonly canAddCredits?: () => boolean
  /**
   * Whether the balance line is shown. Absent means shown; the host decides (its default hides it
   * in the voices release). A refusal the gateway announces is shown either way.
   */
  readonly showBalance?: () => boolean
  /**
   * The heads-up that credits are starting, already projected for the slot (see `creditsNoticeFor`),
   * or null when there is none. It is handed the facts of the last balance read (null before one, and
   * from an older backend): the date and the fee are the backend's. Read afresh each time the state is
   * read, so a dismissal, new words or a new read show at once. It takes the one notice slot only when
   * nothing more urgent has it: a refusal and the size limit are about the message being sent, this is
   * about the future. A source that throws says nothing.
   */
  readonly creditsNotice?: (facts: CreditsFacts | null) => ChatComposerNotice | null
  /** How long to wait before asking the host again what it can do, when the first read failed (default 3 s, growing). */
  readonly probeRetryMs?: number
  /**
   * A turn's debit is delivered a moment after the turn settles, so the balance read at
   * the turn's end can be one debit behind. When a turn settled at a cost and the balance
   * has not moved, it is read again after this long (default 2.5 s), and twice more, each
   * time twice as late, until it does.
   */
  readonly balanceSettleMs?: number
}

/** How many times a failed first read of the host's capabilities is repeated. */
const MAX_PROBE_RETRIES = 4

/** How many times a debit that has not landed is looked for again. */
const MAX_DEBIT_LOOKS = 3

/** A reply that never came: an assistant message with nothing in it, no tool call and no error. */
function isEmptyReply(message: ChatMessage): boolean {
  return message.role === 'assistant'
    && !message.content
    && !message.error
    && message.toolCalls.length === 0
    && message.parts.every(part => part.type === 'text' && !part.content)
}

/** The conversation without a trailing reply that never came (a turn refused before it said a word). */
function withoutEmptyReply(state: ProjectorState): ProjectorState {
  const last = state.messages.at(-1)
  if (!last || !isEmptyReply(last)) return state
  return { ...state, messages: state.messages.slice(0, -1), streamingMessageId: null }
}

/** Every assistant message of this conversation carries the voice that spoke; nothing else changes. */
function withVoice(messages: ChatMessage[], voice: ChatVoiceMark | null): ChatMessage[] {
  if (!voice) return messages
  const missing = messages.some(message => message.role === 'assistant' && !message.voice && message.origin !== 'window')
  if (!missing) return messages
  return messages.map(message =>
    message.role === 'assistant' && !message.voice && message.origin !== 'window' ? { ...message, voice } : message)
}

/**
 * A mark worded by its id's tail (the catalogue had not answered when the message was read back) is named
 * by the catalogue once the catalogue knows the id; nothing else about it changes (D-B, 2026-10-01: after a
 * reload the replies read "voice: kimi-k2.6" beside a chip that read "Kimi K2.6"). A mark the catalogue does
 * not know keeps its tail: a name is never invented.
 */
function namedByRoster(messages: ChatMessage[], roster: readonly ChatModelOption[]): ChatMessage[] {
  if (roster.length === 0) return messages
  let changed = false
  const named = messages.map(message => {
    const mark = message.voice
    if (!mark?.id || mark.label !== modelIdTail(mark.id)) return message
    const known = roster.find(model => model.id === mark.id)
    if (!known) return message
    changed = true
    return { ...message, voice: voiceMarkFor(known, mark.basis) }
  })
  return changed ? named : messages
}

/**
 * Build a reactive store over a ChatService. It folds turn events through the
 * REAL projectEvents/finalize and projects {messages,streaming,error,readOnly}.
 */
export function createChatServiceStore(
  service: ChatService,
  options: ChatServiceStoreOptions = {},
): ChatServiceStore {
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
  // A choice a service cannot carry itself (the local echo): held here, as it always was.
  let localModel: string | null = null
  // The account's credit balance as the service last read it: null until a read has been
  // tried, `unavailable` once one has failed with nothing good to show instead.
  let balance: BalanceReading = null
  let balanceLoop: Promise<void> | null = null
  let balanceAgain = false
  // What the platform refused the last message for (credit, pricing, the provider), until the
  // next message or a change of voice; and the words that message was kept for, until the next.
  let refusal: ChatBillingDetail | null = null
  let draftKept = false
  // This conversation has reached its size limit.
  let budgetLimit = false
  // Bumped whenever a new message starts or the conversation changes: what follows a
  // turn (looking for its debit) stops when it moves on.
  let serial = 0
  let debitTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let probeRetries = 0
  let probeTimer: ReturnType<typeof setTimeout> | null = null
  let sessionTitle: string | null = null
  // Monotonic guard for fast session switches: a hydrate only applies if its
  // token is still the latest (a newer setSession bumps it and wins).
  let hydrateToken = 0

  const subs = new Set<(s: ChatServiceStoreState) => void>()

  /** The balance line is shown unless the host says otherwise. */
  function showBalance(): boolean {
    if (!options.showBalance) return true
    try {
      return options.showBalance() === true
    } catch {
      return false
    }
  }

  /** The shell can take the person to add credits only where it says so. */
  function canAddCredits(): boolean {
    try {
      return options.canAddCredits?.() === true
    } catch {
      return false
    }
  }

  /** The voices on offer: whatever the service says now (it may say nothing until the host has been asked). */
  function voices(): ChatModelOption[] {
    return service.models()
  }

  /**
   * The voice shown as current: what the host resolved, else what was chosen, else the House
   * default. A service that keeps the choice itself and has none to show (no voice chosen, and
   * the host says House would be refused) shows none: "Choose a voice", never the first row of the
   * list dressed up as the default.
   */
  function currentVoiceId(roster: readonly ChatModelOption[]): string {
    if (sessionId && service.sessionModelId) return service.sessionModelId(sessionId) ?? ''
    return localModel ?? roster.find(model => model.house)?.id ?? roster[0]?.id ?? ''
  }

  /** Has anything been said in THIS conversation? (An earlier conversation's window does not count.) */
  function begun(): boolean {
    return projector.messages.some(message => message.origin !== 'window')
  }

  function currentVoiceOption(roster: readonly ChatModelOption[]): ChatModelOption | null {
    const id = currentVoiceId(roster)
    return roster.find(model => model.id === id) ?? null
  }

  /** The balance as a number, when there is one to speak of. */
  function balanceMicro(): number | null {
    return balance !== null && balance !== 'unavailable' ? balance.balanceMicroUsd : null
  }

  /** What the backend said of the credits regime on the last read, as a number would be: only when there is a read to speak of. */
  function facts(): CreditsFacts | null {
    return balance !== null && balance !== 'unavailable' ? balance.facts ?? null : null
  }

  /** The heads-up that credits are starting, when the shell has one; never a reason to lose the chat. */
  function headsUp(): ChatComposerNotice | null {
    try {
      return options.creditsNotice?.(facts()) ?? null
    } catch {
      return null
    }
  }

  /**
   * The one notice above the composer: a refusal from the platform, else the size limit, else the
   * heads-up that credits are starting, else nothing.
   */
  function noticeFor(roster: readonly ChatModelOption[]): ChatComposerNotice | null {
    if (refusal) {
      return billingNotice(refusal, {
        balanceMicroUsd: balanceMicro(),
        voice: currentVoiceOption(roster),
        house: roster.find(model => model.house) ?? null,
        addCredits: canAddCredits(),
      })
    }
    if (budgetLimit) return budgetNotice()
    return headsUp()
  }

  function snapshot(): ChatServiceStoreState {
    const models = voices()
    return {
      messages: namedByRoster(withVoice(projector.messages, sessionId ? service.sessionVoice?.(sessionId) ?? null : null), models),
      streaming,
      conversationState,
      sendState,
      sendRecovery,
      sendError,
      retainedDraft:
        (sendState === 'error' || sendState === 'uncertain' || draftKept) ? pendingSendText : null,
      error,
      readOnly,
      models,
      currentModel: currentVoiceId(models),
      accountNote: accountNoteFor(balance, currentVoiceOption(models), { canAddCredits: canAddCredits(), showBalance: showBalance() }),
      // What the platform refused the last message for, said once, in the billing report's
      // words. Nothing is gated on it: a message still goes, and the platform decides.
      composerNotice: noticeFor(models),
      voiceFootnote: service.voiceFootnote ? service.voiceFootnote() : priceFootnote(models),
      // Present when this conversation picked up an earlier one (the window is in `messages`).
      seam: sessionId ? service.sessionSeam?.(sessionId) ?? null : null,
      // What the chat may do here (change, or only read), as the service knows it now.
      accessNote: accessNoteFor(service.access?.(sessionId) ?? null),
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
    if (failure instanceof ChatBillingFailure) {
      // Not a message that failed to send but one the platform declined, for a reason the
      // person can act on: one banner, no error line, no "check status", and their words
      // kept for them.
      refusal = failure.billing
      draftKept = true
      sendState = 'ready'
      sendRecovery = 'none'
      sendError = null
      return
    }
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
    // A new message: whatever the last one was refused for is over, and so is any look for its debit.
    serial += 1
    const thisTurn = serial
    refusal = null
    draftKept = false
    budgetLimit = false
    const balanceBefore = balanceMicro()
    let settledMicroUsd = 0
    let sawSizeLimit = false

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
      const { session: seededSession, messages: seeded } = await service.hydrateSession(turnSession)
      // The conversation is named by what was said in it, once it is said: the header follows.
      if (turnSession === sessionId) sessionTitle = seededSession.title
      const base = createProjectorState(seeded)
      projector = base
      notify()
      // (4) Fold the accumulated array each tick from THAT base.
      const events: ChatEvent[] = []
      for await (const e of h.events) {
        events.push(e)
        if (e.type === 'cost') settledMicroUsd += e.microUsd
        if (e.type === 'truncated') sawSizeLimit = true
        projector = projectEvents(events, base).state
        notify()
      }
      const outcome = await h.done
      projector = finalize(projector, projector.streamingMessageId ?? lastAssistantId(), undefined)
      if (outcome.state === 'failed') {
        applySendFailure(outcome.failure)
        // A call refused before it said a word leaves no reply: not an empty bubble that reads "Thinking…".
        if (outcome.failure instanceof ChatBillingFailure) projector = withoutEmptyReply(projector)
      } else {
        // The chat reached its size limit: the reply may be cut short, and this one is over.
        if (sawSizeLimit) budgetLimit = true
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
      // A turn is debited when it completes: read the balance again, and, if the turn
      // settled at a cost the balance has not yet shown, look for the debit a few more times.
      void refreshBalance().then(() => {
        if (settledMicroUsd > 0 && balanceBefore !== null) followDebit(balanceBefore, thisTurn)
      })
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

  // The service says when its roster or capabilities change (the host is asked once,
  // after the store exists): the panel is told, so the picker appears when it can.
  const stopService = service.subscribe?.(() => notify())

  function probeService(): void {
    if (!service.probeCapabilities || disposed) return
    void service.probeCapabilities().then(() => {
      notify()
      // A first read that failed (no session token yet) leaves what the host can do
      // unknown, not "nothing": ask again a few times, a little later each time. So does a host
      // that says it takes a voice while its catalogue would not load: no picker yet, not "no picker".
      const undecided = service.capabilities === NO_CAPABILITIES
        || (service.capabilities?.voice === true && service.models().length === 0)
      if (undecided && probeRetries < MAX_PROBE_RETRIES && !disposed) {
        probeRetries += 1
        probeTimer = setTimeout(probeService, (options.probeRetryMs ?? 3_000) * probeRetries)
      }
    }, () => undefined)
  }

  /** Take what one read of the balance said. A read that failed leaves a balance already known alone, and says "unavailable" if there was none. */
  function applyBalance(read: BalanceReading): void {
    if (read !== null) balance = read
    else if (balance === null) balance = 'unavailable'
    notify()
  }

  /**
   * Read the balance. One read at a time; a request that arrives while one is on its way
   * (which may predate the turn that asked) is answered by one more read after it.
   */
  function refreshBalance(): Promise<void> {
    if (!service.balance || disposed) return Promise.resolve()
    if (balanceLoop) {
      balanceAgain = true
      return balanceLoop
    }
    const loop: Promise<void> = (async () => {
      do {
        balanceAgain = false
        try {
          applyBalance(await service.balance!())
        } catch {
          applyBalance(null)
        }
      } while (balanceAgain && !disposed)
    })().finally(() => {
      if (balanceLoop === loop) balanceLoop = null
    })
    balanceLoop = loop
    return loop
  }

  /**
   * A turn settled at a cost, but the balance read at its end is the one it started with:
   * the debit is delivered a moment after the settle. Look again a few times, later each
   * time, until the balance has moved; stop when it has, when the conversation moves on, or
   * when the tries run out. It never reads more than it must.
   */
  function followDebit(before: number, turnSerial: number, attempt = 0): void {
    if (disposed || turnSerial !== serial || attempt >= MAX_DEBIT_LOOKS) return
    if (balanceMicro() !== before) return
    debitTimer = setTimeout(() => {
      debitTimer = null
      if (disposed || turnSerial !== serial) return
      void refreshBalance().then(() => followDebit(before, turnSerial, attempt + 1))
    }, (options.balanceSettleMs ?? 2_500) * 2 ** attempt)
  }

  probeService()
  void refreshBalance()

  return {
    getState: snapshot,
    dispose() {
      disposed = true
      if (probeTimer) clearTimeout(probeTimer)
      probeTimer = null
      if (debitTimer) clearTimeout(debitTimer)
      debitTimer = null
      stopService?.()
    },
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    setSession(id) {
      sessionId = id
      sessionTitle = null
      // A different conversation: nothing that was said of the last one is said of this.
      serial += 1
      refusal = null
      draftKept = false
      budgetLimit = false
      if (debitTimer) clearTimeout(debitTimer)
      debitTimer = null
      if (id != null) service.bindSlotSession(service.activeSlot, id)
      probeService() // cached per graph: free unless the graph moved
      void refreshBalance()
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
      // A voice is chosen before a conversation begins and fixed once it has (the pure
      // panel locks at the same boundary). The choice must reach the service: the
      // launch carries it. A service with nothing to carry it keeps the choice here.
      if (!sessionId || begun()) return
      const offered = voices().find(model => model.id === modelId)
      if (!offered || offered.disabled) return
      if (service.setSessionModel) {
        try {
          service.setSessionModel(sessionId, modelId)
        } catch {
          return // the service refused: nothing changes
        }
      } else {
        localModel = modelId
      }
      // Another voice: what the last one was refused for is not said of this one. The
      // person's words stay where they are.
      refusal = null
      notify()
    },
    creditsFacts() {
      return facts()
    },
    creditsNeed() {
      const voice = currentVoiceOption(voices())
      return {
        balanceMicroUsd: refusal?.balanceMicroUsd ?? balanceMicro(),
        requiredMicroUsd: refusal?.requiredMicroUsd ?? minAdmitMicroUsd(voice),
      }
    },
    messageAction(_messageId, _action) {
      // copy/read/regenerate/save — host-owned; not exercised by the local organism.
    },
    service,
  }
}
