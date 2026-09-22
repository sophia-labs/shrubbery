/**
 * @shrubbery/chat-kernel — the pure chat render kernel.
 *
 * This is the chat analog of @shrubbery/editor-kernel: the SAME strangle move for
 * chat. The kernel takes a chat snapshot (ChatMessage[]) — or raw ChatEvent[]
 * folded by the pure projector — in, and emits intents out via PURE callbacks
 * (ChatKernelOptions, a later rung). It imports NONE of garden's chat-store /
 * EventSource / SSE / persistence / cognito / billing.
 *
 * PURITY INVARIANT (enforced by the lockfile tripwire grep + in-test assertions):
 * the dependency closure is `lit` + `marked` + `dompurify` plus the pure Hoja
 * authoring surface — no store, EventSource, yjs/y-*, fetcher, cognito/auth,
 * tauri, or MODEL_PRICING. Host-specific behavior is wired through
 * ChatKernelOptions callbacks — NEVER a backend import.
 *
 * RUNG C1a (SCAFFOLD): re-exported the relocated render-data types + ChatEvent union.
 * RUNG C1b (PROJECTOR + SANITIZE): re-exports the pure message-projector primitives
 * (relocated VERBATIM with its green test) and the DOMPurify sanitize util (closing
 * the marked->unsafeHTML XSS hole). The sandbox-adapter (projectEvents/foldEvent/
 * finalize) and the <sh-chat-panel> custom element land in subsequent rungs.
 */

// The ChatEvent union (= choreograph's SandboxEvent, COPIED not imported) — the
// kernel's normalized streaming taxonomy. Backend produces it; kernel renders it.
export type { ChatEvent, SandboxEvent } from './chat-events'

// The pure message projector (the kernel's heart) — relocated VERBATIM from
// garden-convergence with its real no-mock test kept green. State in, state out:
// no store/EventSource/Pi/timers.
export {
  createProjectorState,
  uuid,
  parseTokens,
  mergeMessage,
  appendDelta,
  appendReasoningDelta,
  updateToolCall,
  adoptMessageId,
} from './message-projector'
export type { ProjectorState } from './message-projector'

// The default HTML sanitizer (a real DOMPurify pass) — the kernel owns
// sanitization because it is the thing that renders untrusted agent content.
export { sanitizeHtml } from './sanitize'

// The sandbox adapter — folds a ChatEvent[] stream onto the pure projector
// (synthesizing per-gate FIFO ${gate}#${n} call ids INSIDE the adapter) and
// applies token usage on a SEPARATE channel via finalize(). The fold never reads
// usage off an event; the ChatEvent union has no call_id (transport ids never
// enter the seam).
export { projectEvents, finalize } from './sandbox-adapter'
export type { TerminalType, ProjectResult } from './sandbox-adapter'

// The <sh-chat-panel> custom element — the pure chat render element (relocated +
// SCRUBBED from garden-convergence's mn-chat-panel: stores/EventSource/billing/
// cognito/themeStore stripped, replaced with ChatKernelOptions PURE callbacks).
// Light DOM + adoptStyles preserved; sanitize() at both prose sites; dark via the
// theme prop emitting data-theme. Importing this module registers the element.
export { ShChatPanel } from './chat-panel'
export type {
  ChatKernelOptions,
  ChatComposerControl,
  ChatComposerControlChangeDetail,
  ChatComposerControlOption,
  ChatConnectionState,
  ChatConversationState,
  ChatContinuityAction,
  ChatDraftChangeReason,
  ChatEmptySuggestion,
  ChatPresentation,
  ChatPromptCard,
  ChatPromptCardMode,
  ChatPromptOption,
  ChatPromptOptionUseDetail,
  ChatPromptSubmitDetail,
  ChatSessionAction,
  ChatSessionSlot,
  ChatSendState,
  ChatSendRecovery,
  ChatSendContext,
  ChatTheme,
  CodeCopyIntent,
  HeaderActionKind,
  MessageActionKind,
  MessageActionResult,
  SurfaceActionIntent,
} from './chat-panel'

// Additive rich composer vocabulary. Re-exporting it keeps runtime/app hosts on
// the chat seam instead of coupling them directly to Hoja's package boundary.
export type {
  HojaComposerDetail,
  HojaJSONContent,
  HojaWikiLinkReference,
  HojaWikiLinkRequestDetail,
  HojaWikiLinkResolver,
  HojaWikiLinkSuggestion,
} from '@shrubbery/hoja'

// The render-data vocabulary the projector and panel operate over (ChatState —
// lifecycle/transport — deliberately stays host-side; see types.ts).
export type {
  ToolCallStatus,
  ToolCall,
  SurfaceAction,
  SurfacePayload,
  MessagePart,
  TokenUsage,
  ChatMessage,
  ChatModelOption,
  SessionSummary,
} from './types'
