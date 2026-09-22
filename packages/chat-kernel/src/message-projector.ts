/**
 * Shared message projector.
 *
 * PROVENANCE: relocated VERBATIM from garden-convergence
 * `frontend/src/chat/message-projector.ts`. The ONLY edit is the relative import
 * path (`../types/chat.js` -> `./types.js`) since the render-data types are flat
 * in this package's `src/`. Nothing in the reducer body was severed — it was
 * ALREADY pure (a single type-only import; no store/EventSource/Pi/timers).
 *
 * A pure, source-agnostic reducer over a `ChatMessage[]` list. This is the
 * single source of truth for how streaming events fold into the chat state the
 * UI (`chat-panel.ts`) renders. Two thin adapters drive it:
 *
 *   - `sse-adapter.ts`  — hosted mode: maps backend SSE events (text.delta,
 *     tool.*, step.*, session.*) to these reducers.
 *   - `pi-adapter.ts`   — local mode: maps Pi `TurnEvent`s (message_update,
 *     tool_execution_*, …) to the SAME reducers.
 *
 * The functions here were lifted verbatim from the private methods that used to
 * live on `ChatStore` (mergeMessage/appendDelta/appendReasoningDelta/
 * updateToolCall/adoptMessageId/parseTokens), with `this.state.messages` and
 * `this.streamingMessageId` lifted into an explicit `ProjectorState` arg and
 * `this.setState` removed — the caller applies the returned state. No timers,
 * no EventSource, no Pi handles: just state in, state out.
 */

import type { ChatMessage, ToolCall, TokenUsage } from './types.js'

/** The slice of chat state the projector owns. The streaming/loading/error
 * flags on `ChatState` stay with `ChatStore` — they're lifecycle, not
 * projection. */
export interface ProjectorState {
  messages: ChatMessage[]
  streamingMessageId: string | null
  /** Set by the SSE adapter to suppress the backend echoing the user's own
   * message back as an assistant delta. Pi never echoes, so the Pi adapter
   * leaves these null. */
  pendingUserMessageId: string | null
  pendingUserMessageContent: string | null
}

export function createProjectorState(messages: ChatMessage[] = []): ProjectorState {
  return {
    messages,
    streamingMessageId: null,
    pendingUserMessageId: null,
    pendingUserMessageContent: null,
  }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID(): string }).randomUUID()
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

/** Tolerant token parser: accepts both `{input, output, cache:{read,write}}`
 * and the snake_case `{input_tokens, output_tokens, cache_read, cache_write}`
 * shapes, clamping to non-negative. */
export function parseTokens(raw: unknown): TokenUsage {
  const r = (raw ?? {}) as Record<string, unknown>
  const cache = (r.cache ?? {}) as Record<string, unknown>
  const toNumber = (value: unknown) => {
    const num = Number(value || 0)
    return Number.isFinite(num) ? num : 0
  }
  const clamp = (value: unknown) => Math.max(0, toNumber(value))
  return {
    input: clamp(r.input ?? r.input_tokens),
    output: clamp(r.output ?? r.output_tokens),
    cacheRead: clamp(cache.read ?? r.cache_read),
    cacheWrite: clamp(cache.write ?? r.cache_write),
  }
}

export function mergeMessage(
  state: ProjectorState,
  messageId: string,
  patch: Partial<ChatMessage>,
): ProjectorState {
  let found = false
  const messages = state.messages.map((msg) => {
    if (msg.id === messageId) {
      found = true
      return { ...msg, ...patch }
    }
    return msg
  })

  if (!found) {
    messages.push({
      id: messageId,
      role: 'assistant',
      content: patch.content ?? '',
      parts: patch.parts ?? (patch.content ? [{ type: 'text', content: patch.content }] : []),
      isStreaming: patch.isStreaming ?? true,
      toolCalls: patch.toolCalls ?? [],
      tokens: patch.tokens,
      createdAt: Date.now(),
      error: patch.error,
    })
  }

  return { ...state, messages }
}

export function appendDelta(
  state: ProjectorState,
  messageId: string,
  delta: string,
): ProjectorState {
  if (!delta) return state

  let found = false
  const messages = state.messages.map((msg) => {
    if (msg.id === messageId) {
      found = true
      const parts = [...msg.parts]
      const lastPart = parts[parts.length - 1]

      if (lastPart && lastPart.type === 'text') {
        parts[parts.length - 1] = { ...lastPart, content: lastPart.content + delta }
      } else {
        parts.push({ type: 'text', content: delta })
      }

      return {
        ...msg,
        content: `${msg.content}${delta}`,
        parts,
        isStreaming: true,
      }
    }
    return msg
  })

  if (!found) {
    messages.push({
      id: messageId,
      role: 'assistant',
      content: delta,
      parts: [{ type: 'text', content: delta }],
      isStreaming: true,
      toolCalls: [],
      createdAt: Date.now(),
    })
  }

  return { ...state, messages }
}

export function appendReasoningDelta(
  state: ProjectorState,
  messageId: string,
  delta: string,
): ProjectorState {
  if (!delta) return state

  let found = false
  const messages = state.messages.map((msg) => {
    if (msg.id === messageId) {
      found = true
      const parts = [...msg.parts]
      const lastPart = parts[parts.length - 1]

      if (lastPart && lastPart.type === 'reasoning') {
        parts[parts.length - 1] = { ...lastPart, content: lastPart.content + delta }
      } else {
        parts.push({ type: 'reasoning', content: delta })
      }

      return { ...msg, parts, isStreaming: true }
    }
    return msg
  })

  if (!found) {
    messages.push({
      id: messageId,
      role: 'assistant',
      content: '',
      parts: [{ type: 'reasoning', content: delta }],
      isStreaming: true,
      toolCalls: [],
      createdAt: Date.now(),
    })
  }

  return { ...state, messages }
}

export function updateToolCall(
  state: ProjectorState,
  messageId: string,
  callId: string | undefined,
  patch: Partial<ToolCall>,
): ProjectorState {
  const safeCallId = callId || patch.id || uuid()

  let updatedMessage = false
  const messages = state.messages.map((msg) => {
    if (msg.id !== messageId) return msg
    updatedMessage = true
    const toolCalls = [...msg.toolCalls]
    const parts = [...msg.parts]

    const idx = toolCalls.findIndex((tool) => tool.id === safeCallId)
    const status = patch.status
    const isStreaming = msg.isStreaming || status === 'pending' || status === 'running'

    if (idx >= 0) {
      toolCalls[idx] = {
        ...toolCalls[idx],
        ...patch,
        id: safeCallId,
        tool: patch.tool || toolCalls[idx].tool,
      }
    } else {
      toolCalls.push({
        id: safeCallId,
        tool: patch.tool || 'tool',
        status: patch.status || 'pending',
        input: patch.input ?? null,
        output: patch.output ?? null,
        metadata: patch.metadata ?? null,
      })
      parts.push({ type: 'tool', toolCallId: safeCallId })
    }
    return { ...msg, toolCalls, parts, isStreaming }
  })

  if (!updatedMessage) {
    messages.push({
      id: messageId,
      role: 'assistant',
      content: '',
      parts: [{ type: 'tool', toolCallId: safeCallId }],
      isStreaming: true,
      toolCalls: [
        {
          id: safeCallId,
          tool: patch.tool || 'tool',
          status: patch.status || 'pending',
          input: patch.input ?? null,
          output: patch.output ?? null,
          metadata: patch.metadata ?? null,
        },
      ],
      createdAt: Date.now(),
    })
  }

  return { ...state, messages }
}

/**
 * Adopt an incoming streaming message id, returning the id to write to (or null
 * if the event should be ignored, e.g. an echo of the user's own message).
 * Mirrors the old `ChatStore.adoptMessageId` — the `streaming` gate is passed
 * explicitly (`isStreaming`) so the projector stays pure.
 *
 * Returns the (possibly mutated — a streaming-id remap rewrites a message id)
 * next state plus the resolved `messageId`.
 */
export function adoptMessageId(
  state: ProjectorState,
  incomingId: string | null | undefined,
  isStreaming: boolean,
): { state: ProjectorState; messageId: string | null } {
  // Discard late-arriving events after streaming has ended, else delayed events
  // create ghost assistant messages.
  if (!isStreaming && !state.streamingMessageId) {
    return { state, messageId: null }
  }

  if (!incomingId) {
    const fallback = state.streamingMessageId || uuid()
    return { state: { ...state, streamingMessageId: fallback }, messageId: fallback }
  }

  // Echo of our pending user message — ignore.
  if (state.pendingUserMessageId === incomingId) {
    return { state, messageId: null }
  }

  const existingMsg = state.messages.find((m) => m.id === incomingId)
  if (existingMsg && existingMsg.role === 'user') {
    return { state, messageId: null }
  }

  if (existingMsg && existingMsg.role === 'assistant') {
    return { state: { ...state, streamingMessageId: incomingId }, messageId: incomingId }
  }

  // Remap our current streaming placeholder to the new id.
  if (state.streamingMessageId && state.streamingMessageId !== incomingId) {
    const streamingMsg = state.messages.find((m) => m.id === state.streamingMessageId)
    if (streamingMsg && streamingMsg.role === 'assistant') {
      const messages = state.messages.map((msg) =>
        msg.id === state.streamingMessageId ? { ...msg, id: incomingId } : msg,
      )
      return { state: { ...state, messages, streamingMessageId: incomingId }, messageId: incomingId }
    }
  }

  return { state: { ...state, streamingMessageId: incomingId }, messageId: incomingId }
}
