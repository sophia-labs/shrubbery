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
import type { ChatMessage, TokenUsage } from './types.js'

/** The terminal event the fold observed (drives the host's streaming lifecycle).
 * `null` means the stream ended without an explicit terminal event. */
export type TerminalType = 'done' | 'truncated' | 'error' | null

/** Adapter-local synthesis context. Holds the per-gate FIFO + counters and the
 * current streaming assistant message id. NONE of this leaks into the seam or
 * ProjectorState — it is pure book-keeping for call-id synthesis. */
interface FoldCtx {
  /** Resolved streaming assistant message id for the current turn(s). */
  msgId: string | null
  /** In-flight (opened-but-unresolved) synthesized call ids per gate, FIFO. */
  openByGate: Map<string, string[]>
  /** Monotonic per-gate counter — PERSISTS across turns within a spawn. */
  seqByGate: Map<string, number>
}

function createCtx(): FoldCtx {
  return { msgId: null, openByGate: new Map(), seqByGate: new Map() }
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
  return { state, terminalType }
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
      // canonical full text used ONLY as a reconciliation fallback when content
      // is empty (e.g. a turn that produced only tool calls).
      const id = ctx.msgId
      if (!id) return { state, terminal: 'done' }
      const patch: Partial<ChatMessage> = { isStreaming: false }
      const msg = state.messages.find((m) => m.id === id)
      if (msg && !msg.content && ev.output) patch.content = ev.output
      let next = mergeMessage(state, id, patch)
      next = { ...next, streamingMessageId: null }
      return { state: next, terminal: 'done' }
    }
    case 'truncated': {
      // Treat as terminal (same as done). The `turns` count is host telemetry,
      // not render data; `output` reconciles empty content.
      const id = ctx.msgId
      if (!id) return { state, terminal: 'truncated' }
      const patch: Partial<ChatMessage> = { isStreaming: false }
      const msg = state.messages.find((m) => m.id === id)
      if (msg && !msg.content && ev.output) patch.content = ev.output
      let next = mergeMessage(state, id, patch)
      next = { ...next, streamingMessageId: null }
      return { state: next, terminal: 'truncated' }
    }
    case 'error': {
      const id = ctx.msgId
      if (!id) return { state, terminal: 'error' }
      let next = mergeMessage(state, id, { isStreaming: false, error: ev.message })
      next = { ...next, streamingMessageId: null }
      return { state: next, terminal: 'error' }
    }
  }
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
