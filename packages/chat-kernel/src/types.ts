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
}

export type ChatModelOption = {
  id: string
  label: string
}

export type SessionSummary = {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
}
