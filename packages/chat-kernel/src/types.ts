/**
 * Chat render-data vocabulary.
 *
 * PROVENANCE: relocated VERBATIM from garden-convergence
 * `frontend/src/types/chat.ts` MINUS the `ChatState` type.
 *
 * ChatState (activeSlot/slotSessions/sessionId/sessionToken/sessions/loading/
 * connecting/streaming/reconnecting/offline/reconnectAttempt/... ) is
 * LIFECYCLE/TRANSPORT state owned by garden's `chat-store.ts` — it is the C2
 * ChatService's shape, NOT render data. It stays HOST-side; the kernel binds
 * `messages[]`, `streaming`, and only the controlled conversation-load and
 * submission-recovery posture needed to explain loading/retry/reconcile states,
 * all host-injected via ChatKernelOptions. Everything below is the pure render-data vocabulary the
 * projector and the panel render — zero imports.
 */

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error'

export type TranscriptPartTone = 'voice' | 'data' | 'done' | 'terminal' | 'warning'

export type ToolCall = {
  id: string
  tool: string
  status: ToolCallStatus
  input?: Record<string, unknown> | null
  output?: string | null
  metadata?: Record<string, unknown> | null
}

export type SurfaceAction = {
  document_id: string
  title: string
  action: string
  block_id?: string | null
}

export type SurfacePayload = {
  type: 'surface'
  actions: SurfaceAction[]
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool'; toolCallId: string }
  | {
      type: 'transcript'
      title: string
      content: string
      tone?: TranscriptPartTone
      sourceLabel?: string | null
    }

export type TokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Where a voice mark's attribution comes from.
 *  - `live`            the model Choreograph reported it resolved for this conversation.
 *  - `source-recorded` a model id the old conversation's own record named. It is testimony
 *                      about a configuration, kept as found; never an author.
 *  - `unrecorded`      the source did not say.
 */
export type ChatVoiceBasis = 'live' | 'source-recorded' | 'unrecorded'

/** Which voice spoke an assistant message. A model id is a configuration
 * coordinate, not an author: the mark says what the record says, nothing more. */
export type ChatVoiceMark = {
  /** The recorded or resolved model id; null when nothing was recorded. */
  id: string | null
  /** The display name shown in the mark ("Kimi K2.6"). */
  label: string
  /** Maker or route label, when known ("Moonshot"). */
  provider?: string | null
  basis: ChatVoiceBasis
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  parts: MessagePart[]
  isStreaming: boolean
  toolCalls: ToolCall[]
  tokens?: TokenUsage
  createdAt: number
  error?: string
  /** Which voice spoke this message (assistant messages). Host-supplied. */
  voice?: ChatVoiceMark
  /** `window`: carried read-only from an earlier conversation, exactly as it was
   * sent. Absent: spoken in this conversation. */
  origin?: 'window'
  /** What the model calls behind this reply settled at, in micro-USD, as the host's
   * events reported it (see the `cost` event). The kernel only adds it up: whether and how
   * to show it is the host's (`formatModelAnnotation`). Absent: the host said nothing. */
  costMicroUsd?: number
}

/**
 * One entry of the Voice roster. Everything beyond `id` and `label` is optional
 * so a plain `{ id, label }` list (local mode, tests) still renders.
 */
export type ChatModelOption = {
  id: string
  label: string
  /** Maker label used for grouping ("Moonshot", "Google"). When absent it is
   * derived from the id ("moonshotai/kimi-k2.6") or the legacy name patterns. */
  provider?: string
  /** The House default: pinned first and named honestly. */
  house?: boolean
  /** One honest line under the name ("House default · via OpenRouter"). */
  note?: string
  /** USD per million input tokens, as the person pays it (the host's price, service fee included). `null` = the catalogue did not price it. */
  priceInPerMTok?: number | null
  /** USD per million output tokens, as the person pays it. */
  priceOutPerMTok?: number | null
  /** Context window in tokens. */
  contextLength?: number | null
  /** Tool-calling support as the catalogue reports it. */
  supportsTools?: boolean | null
  /** A listed voice the person cannot pick right now, with the reason. */
  disabled?: boolean
  disabledReason?: string
  /** What a short reply in this voice costs, as a multiple of the House default's
   * (the host works it out; House is the measure and never shows one). */
  multipleOfHouse?: number | null
  /** A voice dear enough that choosing it is confirmed once first. Host-decided. */
  premium?: boolean
  /** The one honest line the confirmation shows ("A short reply costs about $0.15,
   * roughly 86x House."). Host-worded. */
  premiumNote?: string
}

/**
 * The seam of a conversation that picked up an earlier one. The window is the
 * exact set of earlier messages that was sent (`ChatMessage.origin === 'window'`);
 * this carries what the seam and the two lines around it say.
 */
export type ChatSeam = {
  /** Earlier messages not in the window. 0 = the whole conversation is included. */
  omittedCount: number
  /** Title of the original conversation, for the "open the original" affordance. */
  originalTitle?: string | null
  /** ISO time the conversation was picked up (the seam date). */
  pickedUpAt: string
  /** The new voice's display name ("Kimi K2.6"). */
  voiceLabel: string
  /** One line naming where the window goes, e.g. "Continuing sends this
   * conversation to Moonshot through OpenRouter." Host-worded. */
  providerNotice?: string | null
}

export type ChatSeamAction = { type: 'open-original' }

/** A host-projected account line near the voice picker (for example the credit
 * balance). The kernel renders it and never computes it. */
export type ChatAccountNote = {
  /** May be empty when the value is a whole sentence ("$1.00 starter credit"). */
  label: string
  /** May be empty when the label says it all ("Out of credits"). */
  value: string
  /** Presentation only. The kernel never derives a tone or gates on one. */
  tone?: 'ok' | 'low' | 'out'
  hint?: string
  /** A button beside the line ("Add credits"). Rendered only where the host listens
   * (`onAccountAction`); the kernel does not know what it does. */
  action?: { id: string; label: string }
}

/**
 * What the chat may do in this workspace, said once above the composer in the host's words. The
 * host decides it from the person's role and what the backend says its chat can do; the kernel
 * renders it and gates nothing on it (the cell checks every write against the person's live role).
 *  - `write`: Sophia can read and change this workspace, as the person (owners and editors).
 *  - `read`:  Sophia can read it but not change it (viewers, a reader-only backend, an older chat).
 */
export type ChatAccessNote = {
  mode: 'write' | 'read'
  label: string
  /** A quieter second line (where changes are kept, or why this chat reads only). */
  detail?: string
}

/**
 * A host-projected notice above the composer: the billing refusals, the size-limit notice and
 * the heads-up that credits are starting. It gates nothing: sending is still governed only by
 * `sendDisabled`.
 */
export type ChatComposerNotice = {
  id: string
  tone: 'info' | 'warning' | 'blocked'
  title: string
  body?: string
  /** A quiet extra line (the balance). */
  detail?: string
  action?: { id: string; label: string }
  /**
   * A control that puts the notice away. Rendered only where the host listens
   * (`onComposerNoticeAction`), and reported by this `id` like `action`; the kernel does not
   * dismiss anything itself. A notice that must be answered (a refusal) carries none.
   */
  dismiss?: { id: string; label: string }
}

export type SessionSummary = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
}
