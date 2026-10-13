/**
 * ChatEvent — the kernel's normalized streaming-event taxonomy.
 *
 * PROVENANCE: COPIED VERBATIM (not imported) from choreograph's `SandboxEvent`
 * union at /Users/vera/dev/sophia/choreograph/src/wire-protocol.ts:73-82 (an
 * identical second copy lives at choreograph/src/agent-worker/types.ts:157-166).
 *
 * WHY COPIED, NOT IMPORTED: choreograph is node/EC2 runtime code that is OFF-LIMITS
 * to this package, and importing across repos would breach the kernel's purity /
 * lockfile invariant. The kernel normalizes over this taxonomy and needs ZERO
 * choreograph knowledge — the chat analog of editor-kernel's `@tiptap`-only
 * purity. The backend (C2/C4 ChatService) PRODUCES ChatEvent[]; the kernel
 * RENDERS them.
 *
 * The 9 variants map cleanly onto the projector reducers (a later rung's
 * sandbox-adapter folds them; `cost` is a host addition, not part of the copied
 * union: it adds up what the calls behind a reply cost and touches nothing else):
 *   text       -> appendDelta
 *   thinking   -> appendReasoningDelta
 *   tool_call  -> updateToolCall (pending/running)
 *   tool_result-> updateToolCall (completed/error)
 *   turn_end / done / truncated -> finalize (mergeMessage isStreaming:false)
 *   turn_start -> turn boundary
 *   error      -> message error
 *
 * NOTE on token usage: SandboxEvent carries NO per-event usage. Token TOTALS ride
 * a separate result channel (choreograph SpawnResult.tokens / ProxyUsage) and
 * arrive at finalize — the kernel's adapter applies usage separately from the
 * fold (see finalize, a later rung).
 *
 * The `ChatEvent` alias is the kernel's public name; `SandboxEvent` is kept as a
 * congruent alias so the provenance is unambiguous at the type level.
 */

export type ChatEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  /** `metadata` is a host addition (like `cost`): the host's id-only receipt of what the call touched
   * (`targets`), when its record keeps one. The fold puts it on `ToolCall.metadata`. */
  | { type: 'tool_call'; gate: string; args: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { type: 'tool_result'; gate: string; result: string; is_error: boolean; metadata?: Record<string, unknown> }
  | { type: 'turn_end'; turn: number }
  | { type: 'done'; output: string }
  | { type: 'truncated'; output: string; turns: number }
  | { type: 'error'; message: string }
  /** The settled cost of ONE model call behind the current reply, in micro-USD. The host
   * reads it off the session's ledger; the fold adds the calls of a reply up. */
  | { type: 'cost'; microUsd: number }

/** Congruent provenance alias — the choreograph wire name for the same union. */
export type SandboxEvent = ChatEvent
