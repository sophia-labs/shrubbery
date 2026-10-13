/**
 * Sandbox adapter — folds a `ChatEvent[]` stream onto the pure message
 * projector, then applies token usage on a SEPARATE channel via `finalize`.
 *
 * This is the ONLY place in the kernel that knows about `ChatEvent`. The
 * relocated `message-projector` stays event-agnostic (state in, state out); this
 * adapter translates the 9 `ChatEvent` variants into projector ops.
 *
 * CALL-ID SYNTHESIS (load-bearing): the `ChatEvent` union has NO `call_id` — a
 * `tool_call` / `tool_result` pair is keyed only by `gate: string`. Keying a
 * result to its call by gate-name alone would COLLIDE concurrent same-gate calls
 * (both resolving to a single ToolCall). So we synthesize a stable `${gate}#${n}`
 * id INSIDE this adapter via a per-gate FIFO queue held in adapter-local `ctx`
 * (NOT in ProjectorState, NOT in the seam — transport ids never enter the seam).
 *
 *   - On `tool_call`: mint `gate#n` (monotonic per-gate counter), PUSH it onto
 *     the gate's in-flight FIFO queue, open the ToolCall as `running`.
 *   - On `tool_result`: SHIFT the OLDEST open id for that gate off the queue and
 *     close it `completed`/`error`. This FIFO pop is exactly what gives a
 *     concurrent same-gate call/result pair DISTINCT ids: call->#0, call->#1,
 *     then result->#0, result->#1.
 *
 * Gate counters PERSIST across turns within a spawn (never reset on
 * turn_start/turn_end) — else a second-turn same-gate call re-mints `#0` and
 * clobbers the first turn's completed call via updateToolCall's findIndex.
 *
 * TOKEN USAGE is OUT-OF-BAND: no `ChatEvent` carries usage. Token totals ride a
 * separate result channel (choreograph `SpawnResult.tokens` / `ProxyUsage`),
 * arriving alongside the terminal event, not inside the fold. So `projectEvents`
 * NEVER reads usage off an event; `finalize` is a SECOND call that applies usage.
 */

import type { ChatEvent } from './chat-events.js'
import type { ProjectorState } from './message-projector.js'
import {
  createProjectorState,
  adoptMessageId,
  appendDelta,
  appendReasoningDelta,
  updateToolCall,
  mergeMessage,
  parseTokens,
} from './message-projector.js'
import type { ChatMessage, TokenUsage, ToolCall } from './types.js'

/** The terminal event the fold observed (drives the host's streaming lifecycle).
 * `null` means the stream ended without an explicit terminal event. */
export type TerminalType = 'done' | 'truncated' | 'error' | null

/** Adapter-local synthesis context. Holds the per-gate FIFO + counters and the
 * current streaming assistant message id. NONE of this leaks into the seam or
 * ProjectorState — it is pure book-keeping for call-id synthesis. */
interface FoldCtx {
  /** Resolved streaming assistant message id for the current turn(s). */
  msgId: string | null
  /** What the model calls seen so far in this fold settled at, in micro-USD. */
  costMicroUsd: number
  /** In-flight (opened-but-unresolved) synthesized call ids per gate, FIFO. */
  openByGate: Map<string, string[]>
  /** Monotonic per-gate counter — PERSISTS across turns within a spawn. */
  seqByGate: Map<string, number>
}

function createCtx(): FoldCtx {
  return { msgId: null, costMicroUsd: 0, openByGate: new Map(), seqByGate: new Map() }
}

/** Mint the next `${gate}#${n}` id for a gate and bump its counter. */
function nextCallId(ctx: FoldCtx, gate: string): string {
  const n = ctx.seqByGate.get(gate) ?? 0
  ctx.seqByGate.set(gate, n + 1)
  return `${gate}#${n}`
}

/** Result of folding a `ChatEvent[]` stream. `state` carries the projected
 * messages; `terminalType` tells the host which lifecycle end (if any) the stream
 * reached. Usage is NOT here — it rides `finalize`'s separate channel. */
export interface ProjectResult {
  state: ProjectorState
  terminalType: TerminalType
}

/**
 * Fold a `ChatEvent[]` stream onto the projector, synthesizing per-gate FIFO call
 * ids. Threads a `ProjectorState` through a per-event `foldEvent`. Returns the
 * projected state + the terminal type. Token usage is applied separately (see
 * `finalize`) — the fold NEVER reads usage off an event.
 *
 * @param events  the ChatEvent stream (e.g. one spawn's SandboxEvent[])
 * @param base    optional starting state (defaults to a fresh empty state)
 */
export function projectEvents(
  events: ChatEvent[],
  base?: ProjectorState,
): ProjectResult {
  let state = base ?? createProjectorState()
  const ctx = createCtx()
  // Resolve the streaming assistant id we'll write deltas/tool-calls to.
  ctx.msgId = state.streamingMessageId

  let terminalType: TerminalType = null
  for (const ev of events) {
    const r = foldEvent(state, ev, ctx)
    state = r.state
    if (r.terminal) terminalType = r.terminal
  }
  // What the calls behind the reply cost, put on the reply once the whole stream has been
  // read: a call settled before the reply had a single word (it asked for a tool) is not
  // lost, and folding the same events again never counts a call twice.
  if (ctx.costMicroUsd > 0 && ctx.msgId) state = withCost(state, ctx.msgId, ctx.costMicroUsd)
  return { state, terminalType }
}

/** Put a reply's settled cost on it, beside any cost it already carried into the fold. */
function withCost(state: ProjectorState, id: string, microUsd: number): ProjectorState {
  const msg = state.messages.find((m) => m.id === id)
  if (!msg) return state
  return mergeMessage(state, id, { costMicroUsd: (msg.costMicroUsd ?? 0) + microUsd })
}

/** Fold a single `ChatEvent` onto the projector. Pure w.r.t. `state`; mutates
 * only the adapter-local `ctx` (call-id book-keeping). */
function foldEvent(
  state: ProjectorState,
  ev: ChatEvent,
  ctx: FoldCtx,
): { state: ProjectorState; terminal?: TerminalType } {
  switch (ev.type) {
    case 'turn_start': {
      // Turn boundary — open/resolve the streaming assistant msgId. No content
      // write. Gate counters PERSIST (do NOT reset) so a later-turn same-gate
      // call gets a fresh #n and never clobbers an earlier turn's call.
      const r = adoptMessageId(state, null, true)
      ctx.msgId = r.messageId
      return { state: r.state }
    }
    case 'text': {
      if (!ctx.msgId) {
        const r = adoptMessageId(state, null, true)
        ctx.msgId = r.messageId
        state = r.state
      }
      return { state: appendDelta(state, ctx.msgId!, ev.content) }
    }
    case 'thinking': {
      if (!ctx.msgId) {
        const r = adoptMessageId(state, null, true)
        ctx.msgId = r.messageId
        state = r.state
      }
      return { state: appendReasoningDelta(state, ctx.msgId!, ev.content) }
    }
    case 'tool_call': {
      if (!ctx.msgId) {
        const r = adoptMessageId(state, null, true)
        ctx.msgId = r.messageId
        state = r.state
      }
      const callId = nextCallId(ctx, ev.gate)
      const queue = ctx.openByGate.get(ev.gate) ?? []
      queue.push(callId)
      ctx.openByGate.set(ev.gate, queue)
      return {
        state: updateToolCall(state, ctx.msgId!, callId, {
          tool: ev.gate,
          status: 'running',
          input: ev.args,
          ...receiptPatch(state, ctx.msgId!, callId, ev.metadata),
        }),
      }
    }
    case 'tool_result': {
      if (!ctx.msgId) {
        const r = adoptMessageId(state, null, true)
        ctx.msgId = r.messageId
        state = r.state
      }
      const queue = ctx.openByGate.get(ev.gate)
      // FIFO-pop the OLDEST open call for this gate. Orphan result (empty queue)
      // -> mint a fresh id so the fold stays total.
      const callId = (queue && queue.length > 0 ? queue.shift()! : nextCallId(ctx, ev.gate))
      return {
        state: updateToolCall(state, ctx.msgId!, callId, {
          tool: ev.gate,
          status: ev.is_error ? 'error' : 'completed',
          output: ev.result,
          ...receiptPatch(state, ctx.msgId!, callId, ev.metadata),
        }),
      }
    }
    case 'turn_end': {
      // Turn boundary only — do NOT clear streaming (a multi-turn spawn keeps
      // streaming until done/truncated/error).
      return { state }
    }
    case 'done': {
      // Terminal. Text deltas already built the content; `output` is the
      // canonical full text, used only to RECONCILE: it fills an empty message
      // (a turn that produced only tool calls) and completes a message the
      // stream left short. See `settleWithOutput`. A reply that came with no
      // stream at all is opened from it (see `openUnstreamedReply`).
      const opened = ctx.msgId ? null : openUnstreamedReply(state, ev.output)
      if (opened) { state = opened.state; ctx.msgId = opened.messageId }
      const id = ctx.msgId
      if (!id) return { state, terminal: 'done' }
      return { state: settleWithOutput(state, id, ev.output), terminal: 'done' }
    }
    case 'truncated': {
      // Treat as terminal (same as done). The `turns` count is host telemetry,
      // not render data; `output` reconciles the content the same way.
      const opened = ctx.msgId ? null : openUnstreamedReply(state, ev.output)
      if (opened) { state = opened.state; ctx.msgId = opened.messageId }
      const id = ctx.msgId
      if (!id) return { state, terminal: 'truncated' }
      return { state: settleWithOutput(state, id, ev.output), terminal: 'truncated' }
    }
    case 'error': {
      const id = ctx.msgId
      if (!id) return { state, terminal: 'error' }
      let next = mergeMessage(state, id, { isStreaming: false, error: ev.message })
      next = { ...next, streamingMessageId: null }
      return { state: next, terminal: 'error' }
    }
    case 'cost': {
      // Not a terminal, and not a write: the amounts are added up and put on the reply
      // when the fold ends. Anything that is not a positive number is nothing.
      if (Number.isFinite(ev.microUsd) && ev.microUsd > 0) ctx.costMicroUsd += ev.microUsd
      return { state }
    }
  }
}

/**
 * The host's receipt for a tool call, merged over whatever the call already carried. No receipt, no
 * key: a call the host said nothing about keeps the metadata it had (null for a new one).
 */
function receiptPatch(
  state: ProjectorState,
  messageId: string,
  callId: string,
  metadata: Record<string, unknown> | undefined,
): Partial<Pick<ToolCall, 'metadata'>> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const existing = state.messages.find((m) => m.id === messageId)?.toolCalls.find((t) => t.id === callId)?.metadata
  return { metadata: { ...(existing ?? {}), ...metadata } }
}

/**
 * Open the reply for a terminal `output` that arrived with no stream at all, or nothing.
 *
 * Seen live (2026-10-01, D-A): a follow-up the host delivers to a still-warm Session is
 * answered and billed, but its event log carries no `turn.started`, `message.delta` or
 * `message.completed`; the service ends the turn with `done` carrying the durable answer.
 * Without this the answer was dropped until the next message or a reload.
 *
 * Nothing is opened for an empty output, nor when the reply to the person's last message is
 * already on screen (the store seeds the fold from a read that may already hold it): a reply
 * is never shown twice. The new message is built as a streamed one would be (one text part),
 * so `settleWithOutput` then closes it the same way.
 */
function openUnstreamedReply(state: ProjectorState, output: string): { state: ProjectorState; messageId: string } | null {
  if (!output) return null
  const last = state.messages[state.messages.length - 1]
  if (last && last.role === 'assistant') return null
  const r = adoptMessageId(state, null, true)
  if (!r.messageId) return null
  return { state: appendDelta(r.state, r.messageId, output), messageId: r.messageId }
}

/**
 * End a turn's message and reconcile its text with the authoritative `output`.
 *
 * `output` may only EXTEND what was streamed: when the streamed text is a strict
 * prefix of it, the missing tail is appended (so `content` and the last text part
 * agree). It never rewrites text the person has already read, never shortens it,
 * and never swaps a multi-step reply (text, tools, more text) for its last step:
 * an output that is not an extension of the streamed text changes nothing. An
 * empty message takes the output whole.
 *
 * Why it exists: a host whose event stream closes early can hand the client the
 * first words of a reply and then only the durable answer. The service ends such
 * a turn with a `done` carrying that answer; without this the bubble stayed at
 * "Read" for "Read and search workspace."
 */
function settleWithOutput(state: ProjectorState, id: string, output: string): ProjectorState {
  const msg = state.messages.find((m) => m.id === id)
  let next = state
  if (msg && output) {
    if (!msg.content) {
      next = mergeMessage(next, id, { content: output })
    } else if (output.length > msg.content.length && output.startsWith(msg.content)) {
      next = appendDelta(next, id, output.slice(msg.content.length))
    }
  }
  next = mergeMessage(next, id, { isStreaming: false })
  return { ...next, streamingMessageId: null }
}

/**
 * Apply OUT-OF-BAND token usage to the terminal assistant message — the SECOND
 * channel. `usage` arrives alongside the terminal event (choreograph
 * `SpawnResult.tokens` / `ProxyUsage`), NOT inside the fold.
 *
 * Normalizes the camelCase `ProxyUsage` ({input,output,cacheRead,cacheWrite})
 * into the `{cache:{read,write}}` shape the relocated `parseTokens` understands,
 * so the verbatim projector is left untouched. Already-`TokenUsage` and the
 * snake_case `{input_tokens,...,cache:{read,write}}` shapes flow through too.
 *
 * @param state  projected state (from `projectEvents`)
 * @param msgId  the terminal assistant message id to stamp
 * @param usage  out-of-band usage (ProxyUsage / TokenUsage / raw); omit for none
 */
export function finalize(
  state: ProjectorState,
  msgId: string | null,
  usage?: unknown,
): ProjectorState {
  if (!msgId) return state
  const patch: Partial<ChatMessage> = { isStreaming: false }
  if (usage != null) {
    patch.tokens = parseTokens(normalizeUsage(usage))
  }
  return mergeMessage(state, msgId, patch)
}

/** Map the camelCase `ProxyUsage` cache fields into the `cache:{read,write}`
 * shape `parseTokens` reads, while passing through `input`/`output` and any
 * snake_case fields unchanged. Pure remap — no rounding/clamping (parseTokens
 * clamps non-negative). */
function normalizeUsage(usage: unknown): Record<string, unknown> {
  const u = (usage ?? {}) as Record<string, unknown>
  const existingCache = (u.cache ?? {}) as Record<string, unknown>
  return {
    ...u,
    cache: {
      read: existingCache.read ?? u.cacheRead ?? u.cache_read,
      write: existingCache.write ?? u.cacheWrite ?? u.cache_write,
    },
  }
}

export type { TokenUsage }
