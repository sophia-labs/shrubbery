/**
 * <sh-chat-panel> — the pure chat render element.
 *
 * PROVENANCE: relocated + SCRUBBED from garden-convergence
 * `frontend/src/components/chat-panel.ts` (`mn-chat-panel`). The big cross-repo
 * relocation of C1's final rung (R5). Every backend coupling in the original was
 * SEVERED and replaced with a PURE callback on `ChatKernelOptions`; the
 * load-bearing element-only invariants were PRESERVED verbatim.
 *
 * WHAT WAS STRIPPED (host couplings — see DEFER.md for the seam each lands on):
 *   - chatStore / sessionStore / billingStore (`../stores/*`) — the C2
 *     ChatService transport+session state. Render data (messages/streaming/
 *     models/currentModel/error) is now host-INJECTED via props; transport
 *     lifecycle is projected through the small controlled continuity seam
 *     (`conversationState` / `sendState` / `sendRecovery`) without bringing a
 *     store into the face. `connectionState` remains compatibility-only.
 *   - MODEL_PRICING / getModelPricing / getModelPriceValue + the price column —
 *     pricing is a billing concern, not a render concern. The kernel has no
 *     notion of credits or $-cost.
 *   - billingStore credits banners + send-gating — billing send-gating is a HOST
 *     SEAM: the host passes `sendDisabled` / `error`; the kernel never computes
 *     credit state or parses error strings for "insufficient credits".
 *   - ttsService read-aloud — TTS read-state is a HOST SEAM surfaced through
 *     `onMessageAction(id, 'read')`; the kernel has no audio.
 *   - navigator.clipboard message/code copy — clipboard is a HOST SEAM surfaced
 *     through `onMessageAction(id, 'copy')` and `onCodeCopy(intent)`.
 *   - EventSource / SSE / reconnect+watchdog timers / lastSseEventAt — transport,
 *     DEFERRED to the ChatService seam.
 *   - cognito / auth-websocket / sessionToken — carried by the (deferred) stores.
 *   - ThemeController / themeStore — REPLACED by the `theme` @property which
 *     writes `data-theme` on the host (activating the adopted-stylesheet dark
 *     rules). `matchMedia` is an acceptable PURE platform read for 'auto'.
 *
 * WHAT WAS PRESERVED (element-only, non-negotiable):
 *   - createRenderRoot(){return this} — LIGHT DOM (styles reach the host tree;
 *     no shadow boundary). A free render fn CANNOT reproduce this.
 *   - adoptStyles() onto getRootNode().adoptedStyleSheets (created once, shared) —
 *     needs the host node + lifecycle, so it MUST be the custom element.
 *   - sanitize() at BOTH prose call sites (the no-sanitizer `marked.parse ->
 *     unsafeHTML` XSS hole in the original is CLOSED here); the ```code-fence```
 *     literal path stays Lit-text-escaped (NOT unsafeHTML'd).
 *   - tool-call status badges (pending / running / completed / error).
 *   - composer Enter-to-send (Shift+Enter newline) firing the onSend callback.
 *   - every `mn-chat-panel` CSS selector rewritten to `sh-chat-panel` (else the
 *     dark-mode adopted rules silently no-op against the renamed host).
 *
 * PURITY: imports lit + marked + the kernel's own pure modules ONLY. No store, no
 * EventSource, no fetcher, no cognito, no tauri, no MODEL_PRICING. Enforced by
 * the lockfile tripwire grep + compose.test.ts.
 */

import { LocaleController, localizeLabel, t } from '@shrubbery/nucleus'
import '@shrubbery/hoja'
import type {
  HojaComposerDetail,
  HojaEditor,
  HojaWikiLinkResolver,
} from '@shrubbery/hoja'
import { type CSSResult, css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { Marked } from 'marked'

import { sanitizeChatHtml } from './sanitize.js'
import type {
  ChatAccessNote,
  ChatAccountNote,
  ChatComposerNotice,
  ChatMessage,
  ChatModelOption,
  ChatSeam,
  ChatSeamAction,
  MessagePart,
  SurfacePayload,
  ToolCall,
} from './types.js'
import {
  type ChangeRemoval,
  type ChangeSubject,
  type ChangeVerb,
  type TurnChange,
  type TurnChanges,
  turnChangesOf,
} from './turn-changes.js'
import {
  filterVoices,
  formatContextLength,
  formatVoiceMultiple,
  groupVoices,
  type VoiceGroup,
  voiceDisplayName,
  voiceMarkText,
  voicePriceSummary,
  voiceToolsBadge,
} from './voice-roster.js'

// Shared stylesheet for light DOM (created once, adopted by the containing root).
// PRESERVED verbatim from the original: a single shared CSSStyleSheet keyed off
// module scope, so every <sh-chat-panel> instance adopts the SAME sheet.
let chatPanelStyleSheet: CSSStyleSheet | null = null
let chatPanelInstance = 0

// Configure marked. NOTE: marked is NOT a sanitizer — the original's "safe
// rendering" comment was misleading and shipped an XSS hole. Here every prose
// path runs through `this.sanitize()` BEFORE unsafeHTML (see renderContent).
const marked = new Marked({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
})

export type ChatEmptySuggestion = {
  id?: string
  icon?: string
  label: string
  prompt: string
}

export type ChatComposerControlOption = {
  id: string
  label: string
  description?: string | null
  disabled?: boolean
}

export type ChatComposerControl = {
  id: string
  label: string
  value: string
  options: readonly ChatComposerControlOption[]
  disabled?: boolean
}

export type ChatComposerControlChangeDetail = {
  controlId: string
  value: string
  control: ChatComposerControl
  option: ChatComposerControlOption
}

export type ChatPromptCardMode = 'compose' | 'collect'

export type ChatPromptOption = {
  id?: string
  label: string
  description?: string | null
  compose?: string | null
  preview?: string | null
  disabled?: boolean
}

export type ChatPromptCard = {
  id: string
  header?: string | null
  question: string
  options: readonly ChatPromptOption[]
  mode?: ChatPromptCardMode
  multi?: boolean
  freeformPlaceholder?: string | null
  submitLabel?: string | null
}

export type ChatPromptOptionUseDetail = {
  promptId: string
  prompt: ChatPromptCard
  option: ChatPromptOption
  value: string
}

export type ChatPromptSubmitDetail = {
  promptId: string
  prompt: ChatPromptCard
  answers: readonly string[]
  summary: string
}

const DEFAULT_EMPTY_STATE_SUGGESTIONS: ChatEmptySuggestion[] = [
  {
    id: 'write',
    icon: '✎',
    label: '...help you write',
    prompt: 'Help me develop and flesh out my ideas in this document.',
  },
  {
    id: 'connect',
    icon: '⌁',
    label: '...find what connects to this',
    prompt:
      "What else in my graph connects to what I'm currently reading? Explore the wires and look for related documents.",
  },
  {
    id: 'summarize',
    icon: '▤',
    label: '...summarize this document',
    prompt: 'Can you read this document and give me a summary of the key points?',
  },
  {
    id: 'map-workspace',
    icon: '◎',
    label: '...map your workspace',
    prompt:
      "Give me an overview of my graph — what's in it, how it's organized, and what connections exist. Explore the documents and wires thoroughly.",
  },
  {
    id: 'explain-garden',
    icon: '✦',
    label: '...explain how Garden works',
    prompt:
      "I'm new to Garden. Can you explain what this place is, what you can do, and how I should think about using it?",
  },
]

/** Voice roster grouping, search and labels live in ./voice-roster.ts (pure, tested
 * without a DOM). The picker below only renders what those helpers return. */
/** The roster gets a search box once it is longer than this: a five-entry local
 * roster stays as plain as it always was; a live catalogue is searchable. */
const VOICE_SEARCH_THRESHOLD = 8

/** Presentation-only grouping: names are hints, never an authority decision. */
type ToolActivityKind = 'bash' | 'garden' | 'kubernetes' | 'helm' | 'tool'

function toolActivityKind(tool: string): ToolActivityKind {
  const name = tool.trim().toLowerCase()
  if (/(^|[._:/-])(bash|shell|terminal)([._:/-]|$)/.test(name)) return 'bash'
  if (/(^|[._:/-])(kubernetes|k8s)([._:/-]|$)/.test(name)) return 'kubernetes'
  if (/(^|[._:/-])helm([._:/-]|$)/.test(name)) return 'helm'
  if (
    name.startsWith('mnemosyne')
    || name.startsWith('garden')
    || /(^|[._:/-])(document|blocks?|wires?|geist|recall|remember|music|sing|care|workspace)([._:/-]|$)/.test(name)
  ) return 'garden'
  return 'tool'
}

function toolActivityKindLabel(kind: ToolActivityKind): string {
  switch (kind) {
    case 'bash': return 'Bash'
    case 'garden': return 'Garden'
    case 'kubernetes': return 'Kubernetes'
    case 'helm': return 'Helm'
    default: return 'Tool'
  }
}

function asToolRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parsedToolValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return value
  try { return JSON.parse(trimmed) } catch { return value }
}

function hasDisclosedValue(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined || value === false) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value === 'number') return Number.isFinite(value)
  if (value === true) return true
  if (Array.isArray(value)) return value.some(item => hasDisclosedValue(item, depth + 1))
  const record = asToolRecord(value)
  return record !== null && Object.values(record).some(item => hasDisclosedValue(item, depth + 1))
}

/** Searches disclosed result/receipt data only; it never interprets a request as evidence. */
function toolValueHasDisclosure(value: unknown, names: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 6) return false
  if (Array.isArray(value)) return value.some(item => toolValueHasDisclosure(item, names, depth + 1))
  const record = asToolRecord(value)
  if (!record) return false
  return Object.entries(record).some(([key, nested]) => (
    (names.has(key.toLowerCase()) && hasDisclosedValue(nested))
    || toolValueHasDisclosure(nested, names, depth + 1)
  ))
}

function toolValueHasField(
  value: unknown,
  names: ReadonlySet<string>,
  predicate: (field: unknown) => boolean,
  depth = 0,
): boolean {
  if (depth > 6) return false
  if (Array.isArray(value)) return value.some(item => toolValueHasField(item, names, predicate, depth + 1))
  const record = asToolRecord(value)
  if (!record) return false
  return Object.entries(record).some(([key, nested]) => (
    (names.has(key.toLowerCase()) && predicate(nested))
    || toolValueHasField(nested, names, predicate, depth + 1)
  ))
}

function isTrue(value: unknown): boolean {
  return value === true
}

function isNonEmptyCollection(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function isPositiveCount(value: unknown): boolean {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0)
    || (typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) > 0)
}

function isNonEmptyContinuation(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim())
}

function toolTestimonyLabels(tool: ToolCall): string[] {
  const values = [parsedToolValue(tool.output), tool.metadata]
  const has = (keys: string[]) => values.some(value => toolValueHasDisclosure(value, new Set(keys)))
  const hasField = (keys: string[], predicate: (field: unknown) => boolean) => (
    values.some(value => toolValueHasField(value, new Set(keys), predicate))
  )
  const labels: string[] = []
  if (
    hasField(['redacted'], isTrue)
    || hasField(['redactions', 'withheld', 'withheldfields', 'redactedfields'], isNonEmptyCollection)
    || hasField(['redactioncount', 'withheldcount', 'redactedcount'], isPositiveCount)
  ) labels.push('redacted')
  if (
    hasField(['truncated', 'partial'], isTrue)
    || hasField(['nextcursor', 'continuation'], isNonEmptyContinuation)
  ) labels.push('truncated')
  if (has(['provenance', 'receipt', 'observedat', 'observationtime', 'resultdigest', 'digest', 'resourceversion', 'revision'])) labels.push('provenance')
  return labels
}

const VERB_LABELS: Readonly<Record<ChangeVerb, string>> = {
  created: 'created',
  edited: 'edited',
  'text-removed': 'text removed',
  commented: 'commented',
  'comment-removed': 'comment removed',
  moved: 'moved',
  renamed: 'renamed',
  linked: 'linked',
  valued: 'valued',
  restored: 'restored',
  deleted: 'deleted',
}

function verbLabel(verb: ChangeVerb): string {
  return VERB_LABELS[verb] ?? verb
}

/** What a change is called when nobody named it. */
function subjectNoun(subject: ChangeSubject): string {
  switch (subject) {
    case 'artifact': return 'an artifact'
    case 'folder': return 'a folder'
    case 'wire': return 'a wire'
    default: return 'a document'
  }
}

/**
 * The way back, or that there is none. Vera, 2026-10-06: deleting a whole document is a true delete, its
 * history goes with it (the chat's reply says so too); a wire is deleted as a person deletes it (no note).
 */
function removalNote(removal: ChangeRemoval): string | null {
  switch (removal) {
    case 'document': return 'Deleted with its history: it cannot be brought back from History.'
    case 'folder': return 'Deleted. A folder keeps no history.'
    case 'wire': return null
    case 'text': return 'The earlier text is in History.'
    case 'comment': return 'The earlier version is in History.'
  }
}

/** HTML is previewed live; so is an artifact whose type nobody said (the host reads it and can tell). */
function previewableMediaType(mediaType: string | null | undefined): boolean {
  if (!mediaType) return true
  return mediaType.split(';', 1)[0]!.trim().toLowerCase() === 'text/html'
}

/** A `light` | `dark` | `auto` theme. `auto` resolves via matchMedia at render
 * time (a pure platform read; NEVER a themeStore import). */
export type ChatTheme = 'light' | 'dark' | 'auto'

/** A message-level action the host handles (copy / read-aloud / regenerate /
 * save-to-garden / branch). The kernel emits the intent; the host owns the behavior
 * (clipboard, TTS, persistence, a new conversation) — all DEFERRED host seams.
 * `branch` ("Branch from here", on the person's own messages) is drawn only when the
 * host names it: a host that never heard of it draws exactly what it drew before. */
export type MessageActionKind = 'copy' | 'read' | 'regenerate' | 'save-garden' | 'branch'

/** Optional host result for message actions with visible local feedback. */
export type MessageActionResult = {
  defaultHandled?: boolean
  error?: string | null
}

/** The shell-controlled spatial posture of the one live conversation surface. */
export type ChatPresentation = 'rail' | 'fullscreen'

/** `popout` is retained as the compatibility intent for leaving the rail. The
 * controlled host projects that same node full-screen; `restore` reverses it. */
export type HeaderActionKind = 'save-garden' | 'refresh' | 'stop' | 'popout' | 'restore'

export type ChatSessionSlot = 0 | 1 | 2

export type ChatSessionAction =
  | { type: 'open-history' }
  | { type: 'new' }
  | { type: 'slot'; slot: ChatSessionSlot }

/** Host-projected transport posture. This is intentionally smaller than any
 * concrete ChatService store: the face only needs enough truth to explain
 * whether it can send and whether recovery is automatic or user-initiated. */
export type ChatConnectionState = 'ready' | 'loading' | 'offline' | 'reconnecting' | 'error'

/** Gen-2's real conversation-readiness projection. `offline`/`reconnecting`
 * remain on ChatConnectionState only as a compatibility face for older hosts. */
export type ChatConversationState = 'ready' | 'loading' | 'error'

/** Host-projected delivery posture for the most recent user send. Transcript
 * ownership stays with the host/projector; the face only renders continuity. */
export type ChatSendState = 'ready' | 'saving' | 'error' | 'uncertain'

/** Whether a failed/uncertain submission can be safely resubmitted, must be
 * reconciled against durable history, or has no automatic recovery. */
export type ChatSendRecovery = 'resubmit' | 'reconcile' | 'none'

/** Recovery intents emitted by the pure face. The host owns transport and the
 * pending payload, so neither retries nor message bodies are inferred here. */
export type ChatContinuityAction =
  | { type: 'retry-load' }
  | { type: 'retry-connection' }
  | { type: 'retry-send' }
  | { type: 'reconcile-turn' }

/** Why the controlled draft changed. The host uses this small distinction to
 * preserve a failed submitted draft without resurrecting one the user cleared. */
export type ChatDraftChangeReason = 'edit' | 'clear' | 'submit-clear'

/** Additive rich context beside Garden's canonical string transport. */
export interface ChatSendContext {
  readonly composer: HojaComposerDetail
}

/** A surface-card click (an agent-surfaced document/block to open). The kernel
 * emits the navigation intent; the host owns routing. */
export type SurfaceActionIntent = {
  documentId: string
  title: string
  action: string
  blockId?: string | null
}

/**
 * A link in the "Changed in this turn" strip was chosen. The kernel emits it; the host routes it,
 * always in the chat's own graph (the chat's writes never leave it). There is deliberately no undo
 * intent: History is the way back (Vera, 2026-10-05: history only, no pretend-atomic undo).
 */
export type ChatChangeIntent =
  | { type: 'open-document'; documentId: string; blockId?: string }
  /** `before`: when the turn began (ms), so History can stand at the version before it. */
  | { type: 'open-history'; documentId: string; before?: number }
  | { type: 'open-artifact'; artifactId: string; revisions?: true }

/** What the host is asked to preview live under a reply: an artifact the reply was the last to change. */
export type ChatArtifactPreviewRequest = {
  artifactId: string
  messageId: string
  /** What the conversation said its media type is; null when no call said (the host reads it and knows). */
  mediaType: string | null
  title: string | null
}

/** A code-block copy request. The kernel renders the control + transient copied
 * state; the host owns the clipboard write. */
export type CodeCopyIntent = {
  messageId: string
  codeBlockId: string
  code: string
  lang?: string | null
}

/**
 * The PURE seam the host wires. Everything the original computed from a store is
 * now either an injected prop (render data) or a callback (intent out). No
 * member here touches a backend, a store, EventSource, or billing.
 */
export interface ChatKernelOptions {
  /** Projected messages (the projector's output). Host-injected render data. */
  messages?: ChatMessage[]
  /** Response generation lifecycle — drives the typing indicator. */
  streaming?: boolean
  /**
   * The host can take a message while a reply is under way (it steers the reply). When true the
   * composer stays open during streaming and Send fires onSend; absent or false, sending waits for
   * the reply to finish, as always.
   */
  steerWhileStreaming?: boolean
  /** Minimal host-projected transport posture. Defaults to ready for backward
   * compatibility; the kernel never probes a transport or starts a timer. */
  connectionState?: ChatConnectionState
  /** Gen-2 conversation hydration posture. When supplied, this takes precedence
   * over the legacy connectionState compatibility property. */
  conversationState?: ChatConversationState
  /** Delivery posture for the most recent send. Uses the shared continuity
   * vocabulary: ready, saving, error, or uncertain. Defaults to ready. */
  sendState?: ChatSendState
  /** Host-owned recovery truth for a failed or ambiguous submission. */
  sendRecovery?: ChatSendRecovery
  /** Optional focused copy for a failed send. Conversation-load failures continue to
   * use `error`, preserving the existing host error seam. */
  sendError?: string | null
  /** Host-surfaced error string (e.g. read-only / insufficient-credits). The
   * kernel RENDERS it but NEVER parses it — neither for credit logic NOR for the
   * read-only decision (that is now the host-surfaced `readOnly` boolean below). */
  error?: string | null
  /** Which message-level buttons the host can honour. A half-wired button is a
   * bug, so the host names the ones that work and the panel draws only those.
   * Absent means every button the panel has always drawn. */
  messageActions?: readonly MessageActionKind[]
  /** Which header buttons the host can honour; the same rule. Absent means all. */
  headerActions?: readonly HeaderActionKind[]
  /** A finished conversation shown alone: no chrome, no composer, no per-message
   * clock (the host annotates each message with what it actually knows), no
   * scroll-to-the-end, and no control that reaches outside the transcript. */
  transcriptOnly?: boolean
  /** Available models for the selector. */
  models?: ChatModelOption[]
  /** Currently-selected model id. */
  currentModel?: string
  /** Host-projected current chat/session title for the Garden-style superbar. */
  sessionTitle?: string | null
  /** Host-projected assistant/brand label for the sidebar chat superbar. */
  assistantLabel?: string
  /** Host-projected active session slot. */
  activeSlot?: ChatSessionSlot
  /** Host-projected session ids bound to the three Garden slots. */
  slotSessions?: readonly (string | null)[]
  /** Host-projected composer draft text. Persistence, if any, is host policy. */
  draft?: string
  /** Optional rich sidecar for marks and resolved reference identity. */
  draftDetail?: HojaComposerDetail | null
  /** Stable chat/session identity. Hoja uses it to keep undo history local. */
  draftIdentity?: string | null
  /** Host-owned graph-scoped reference lookup. Hoja never imports Garden. */
  composerReferenceResolver?: HojaWikiLinkResolver
  /** Host-projected composer placeholder for specialized sidebar chats. */
  composerPlaceholder?: string
  /** Host-projected empty-state copy + prompt starters. */
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  emptySuggestions?: readonly ChatEmptySuggestion[]
  /** Host-projected composer option groups (mode/depth/reach/etc.), controlled. */
  composerControls?: readonly ChatComposerControl[]
  /** Host-projected clarification/question cards rendered above the composer. */
  promptCards?: readonly ChatPromptCard[]
  /** Billing/transport send-gating decided by the HOST. When true the composer
   * send is disabled regardless of draft/streaming. The kernel does NOT compute
   * this (no credits notion). */
  sendDisabled?: boolean
  /** Host-decided read-only (e.g. expired/invalid session). The host (the
   * ChatService store) decides it — the kernel stops inferring it from the error
   * string. Exactly like sendDisabled: a host-surfaced boolean, never parsed. */
  readOnly?: boolean
  /** Theme. `auto` resolves via matchMedia. */
  theme?: ChatTheme
  /** Shell-controlled spatial posture. This changes presentation, never the
   * panel/session identity. */
  presentation?: ChatPresentation
  /** A host-provided HTML sanitizer override; defaults to the kernel's DOMPurify
   * pass. The kernel NEVER ships an unsanitized prose path. */
  sanitize?: (html: string) => string
  /** Format a per-message annotation (e.g. token/model line) — a pure string
   * formatter the host supplies; the kernel never computes cost. */
  formatModelAnnotation?: (msg: ChatMessage) => string | null
  /** Host policy: render tool-call detail blocks open on first paint. Debugging
   * cockpits can show their work; ordinary sidebar chats can stay compact. */
  toolsExpandedByDefault?: boolean
  /** Intent: the user submitted a message. The kernel clears its draft and calls
   * this; the host (ChatService) actually sends. */
  onSend?: (text: string, context?: ChatSendContext) => void
  /** Intent: the composer draft changed. The host may persist it per session. */
  onDraftChange?: (
    draft: string,
    detail?: HojaComposerDetail | null,
    reason?: ChatDraftChangeReason,
  ) => void
  /** Intent: a prompt starter was chosen. The kernel also moves its prompt into the draft. */
  onSuggestionUse?: (suggestion: ChatEmptySuggestion) => void
  /** Intent: a controlled composer option was chosen. The host updates composerControls. */
  onComposerControlChange?: (detail: ChatComposerControlChangeDetail) => void
  /** Intent: a prompt-card option was chosen in compose mode. */
  onPromptOptionUse?: (detail: ChatPromptOptionUseDetail) => void
  /** Intent: a prompt-card answer set was submitted. The host owns prompt removal. */
  onPromptSubmit?: (detail: ChatPromptSubmitDetail) => void
  /** Intent: a surface-card action was clicked. */
  onSurfaceAction?: (action: SurfaceActionIntent) => void
  /** Intent: a message-level action (copy/read/regenerate/save). */
  onMessageAction?: (
    messageId: string,
    action: MessageActionKind,
  ) => void | MessageActionResult | Promise<void | MessageActionResult>
  /** Intent: copy a rendered code block. */
  onCodeCopy?: (intent: CodeCopyIntent) => void | Promise<void>
  /** Intent: a header toolbar action (save, refresh, stop, expand, restore). */
  onHeaderAction?: (action: HeaderActionKind) => void | Promise<void>
  /** Intent: a session superbar action (open history or switch/create a slot). */
  onSessionAction?: (action: ChatSessionAction) => void | Promise<void>
  /** Intent: retry a connection or the host-owned most recent send. */
  onContinuityAction?: (action: ChatContinuityAction) => void | Promise<void>
  /** Intent: the user picked a different model. */
  onModelChange?: (modelId: string) => void
  /** Host-projected account line near the voice picker (the credit balance, for
   * example). The kernel renders it and never computes, formats or gates on it. */
  accountNote?: ChatAccountNote | null
  /** Host-projected notice above the composer (a refusal for credit, the size limit).
   * It gates nothing: sending is governed only by `sendDisabled`. */
  composerNotice?: ChatComposerNotice | null
  /** Intent: the composer notice's action was chosen. */
  onComposerNoticeAction?: (id: string) => void
  /** Intent: the balance line's action was chosen ("Add credits"). The button appears
   * only when this is set: the kernel does not know what the action does. */
  onAccountAction?: (id: string) => void
  /** Host-worded line at the foot of the voice picker saying what its prices are and how
   * they are charged. Absent: the bare caption ("US dollars per million tokens"). */
  voiceFootnote?: string | null
  /** Present when this conversation picked up an earlier one: the messages flagged
   * `origin: 'window'` are exactly what was sent, and this words the lines around
   * them (the count above, the seam below). */
  seam?: ChatSeam | null
  /** Intent: something on the seam was chosen (opening the original). */
  onSeamAction?: (action: ChatSeamAction) => void
  /** What the chat may do here (change, or only read), in the host's words. Absent: nothing said. */
  accessNote?: ChatAccessNote | null
  /** Intent: a link in a reply's "Changed in this turn" strip. Links are drawn only where the host listens. */
  onChangeAction?: (intent: ChatChangeIntent) => void
  /**
   * The host's live preview of an artifact a reply changed (an `<mn-artifact-view>`, scripts off). Called
   * for HTML artifacts (or ones whose type no call said) under the reply that last changed each. Absent:
   * the artifact is listed in the strip, and nothing is framed.
   */
  renderArtifactPreview?: (request: ChatArtifactPreviewRequest) => unknown
  /** A name for a changed thing the turn did not name (the host knows its documents' titles). */
  changeTitle?: (subject: ChangeSubject, id: string) => string | null
}

@customElement('sh-chat-panel')
export class ShChatPanel extends LitElement {
  protected readonly _locale = new LocaleController(this)

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC SEAM (ChatKernelOptions, flattened to reactive properties)
  // ─────────────────────────────────────────────────────────────────────────

  @property({ attribute: false }) messages: ChatMessage[] = []
  @property({ type: Boolean }) streaming = false
  /** See {@link ChatKernelOptions.steerWhileStreaming}. */
  @property({ type: Boolean }) steerWhileStreaming = false
  @property({ type: String }) connectionState: ChatConnectionState = 'ready'
  @property({ attribute: false }) conversationState: ChatConversationState | null = null
  @property({ type: String }) sendState: ChatSendState = 'ready'
  @property({ type: String }) sendRecovery: ChatSendRecovery = 'none'
  @property({ attribute: false }) sendError: string | null = null
  @property({ attribute: false }) error: string | null = null
  @property({ attribute: false }) models: ChatModelOption[] = []
  @property({ type: String }) currentModel = ''
  @property({ type: String }) sessionTitle: string | null = null
  @property({ type: String }) assistantLabel = 'Sophia'
  @property({ type: Number }) activeSlot: ChatSessionSlot = 0
  @property({ attribute: false }) slotSessions: readonly (string | null)[] = [null, null, null]
  @property({ attribute: false }) draft = ''
  @property({ attribute: false }) draftDetail: HojaComposerDetail | null = null
  @property({ type: String }) draftIdentity: string | null = null
  @property({ attribute: false }) composerReferenceResolver?: HojaWikiLinkResolver
  @property({ type: String }) composerPlaceholder = 'Press Enter to send'
  @property({ type: String }) emptyIcon = '✦'
  @property({ type: String }) emptyTitle = 'What are you thinking about?'
  @property({ type: String }) emptyDescription = 'I can...'
  @property({ attribute: false }) emptySuggestions: readonly ChatEmptySuggestion[] = DEFAULT_EMPTY_STATE_SUGGESTIONS
  @property({ attribute: false }) composerControls: readonly ChatComposerControl[] = []
  @property({ attribute: false }) promptCards: readonly ChatPromptCard[] = []
  @property({ type: Boolean }) sendDisabled = false
  @property({ type: Boolean }) readOnly = false
  @property({ attribute: false }) messageActions?: readonly MessageActionKind[]
  @property({ attribute: false }) headerActions?: readonly HeaderActionKind[]
  @property({ type: Boolean }) transcriptOnly = false
  @property({ type: String }) theme: ChatTheme = 'auto'
  @property({ type: String, reflect: true }) presentation: ChatPresentation = 'rail'

  @property({ attribute: false }) sanitize: (html: string) => string = sanitizeChatHtml
  @property({ attribute: false }) formatModelAnnotation?: (msg: ChatMessage) => string | null
  @property({ type: Boolean }) toolsExpandedByDefault = false
  @property({ attribute: false }) onSend?: (text: string, context?: ChatSendContext) => void
  @property({ attribute: false }) onDraftChange?: (
    draft: string,
    detail?: HojaComposerDetail | null,
    reason?: ChatDraftChangeReason,
  ) => void
  @property({ attribute: false }) onSuggestionUse?: (suggestion: ChatEmptySuggestion) => void
  @property({ attribute: false }) onComposerControlChange?: (detail: ChatComposerControlChangeDetail) => void
  @property({ attribute: false }) onPromptOptionUse?: (detail: ChatPromptOptionUseDetail) => void
  @property({ attribute: false }) onPromptSubmit?: (detail: ChatPromptSubmitDetail) => void
  @property({ attribute: false }) onSurfaceAction?: (action: SurfaceActionIntent) => void
  @property({ attribute: false }) onMessageAction?: (
    messageId: string,
    action: MessageActionKind,
  ) => void | MessageActionResult | Promise<void | MessageActionResult>
  @property({ attribute: false }) onCodeCopy?: (intent: CodeCopyIntent) => void | Promise<void>
  @property({ attribute: false }) onHeaderAction?: (action: HeaderActionKind) => void | Promise<void>
  @property({ attribute: false }) onSessionAction?: (action: ChatSessionAction) => void | Promise<void>
  @property({ attribute: false }) onContinuityAction?: (action: ChatContinuityAction) => void | Promise<void>
  @property({ attribute: false }) onModelChange?: (modelId: string) => void
  @property({ attribute: false }) accountNote: ChatAccountNote | null = null
  @property({ attribute: false }) composerNotice: ChatComposerNotice | null = null
  @property({ attribute: false }) onComposerNoticeAction?: (id: string) => void
  @property({ attribute: false }) onAccountAction?: (id: string) => void
  @property({ attribute: false }) voiceFootnote: string | null = null
  @property({ attribute: false }) seam: ChatSeam | null = null
  @property({ attribute: false }) onSeamAction?: (action: ChatSeamAction) => void
  @property({ attribute: false }) accessNote: ChatAccessNote | null = null
  @property({ attribute: false }) onChangeAction?: (intent: ChatChangeIntent) => void
  @property({ attribute: false }) renderArtifactPreview?: (request: ChatArtifactPreviewRequest) => unknown
  @property({ attribute: false }) changeTitle?: (subject: ChangeSubject, id: string) => string | null

  /** What each reply changed, read once per tool-call list (a new list is a new reading). */
  private readonly turnChangesCache = new WeakMap<readonly ToolCall[], TurnChanges>()
  /** Which reply last changed each artifact, and the media type the conversation gave it. */
  private artifactIndex: {
    readonly messages: ChatMessage[]
    readonly owner: ReadonlyMap<string, string>
    readonly mediaType: ReadonlyMap<string, string>
  } | null = null

  // ─────────────────────────────────────────────────────────────────────────
  // PURE LOCAL UI STATE (expansion toggles etc. — no store, no persistence)
  // ─────────────────────────────────────────────────────────────────────────

  @property({ attribute: false }) private expandedToolIds = new Set<string>()
  @property({ attribute: false }) private collapsedToolIds = new Set<string>()
  @property({ attribute: false }) private expandedReasoningIds = new Set<string>()
  @property({ attribute: false }) private copiedCodeBlockId: string | null = null
  @property({ attribute: false }) private copiedMessageId: string | null = null
  @property({ attribute: false }) private modelPickerOpen = false
  @property({ attribute: false }) private headerMenuOpen = false
  @property({ attribute: false }) private hoveredProvider: string | null = null
  @property({ attribute: false }) private voiceQuery = ''
  /** A premium voice the person has picked and not yet confirmed. */
  @property({ attribute: false }) private pendingPremium: string | null = null
  @property({ attribute: false }) private autoScroll = true
  @property({ attribute: false }) private hasNewMessages = false
  @property({ attribute: false }) private streamingElapsed = 0
  @property({ attribute: false }) private contextMenu:
    | { messageId: string; x: number; y: number }
    | null = null
  @property({ attribute: false }) private promptSelections = new Map<string, Set<string>>()
  @property({ attribute: false }) private promptDrafts = new Map<string, string>()

  private codeCopyResetTimer: ReturnType<typeof setTimeout> | null = null
  private messageCopyResetTimer: ReturnType<typeof setTimeout> | null = null
  private streamingTimerId: ReturnType<typeof setInterval> | null = null
  private streamingStartTime: number | null = null
  private lastObservedScrollTop = 0
  /** The pin we just made moved the scroll position; the scroll event that is coming is ours, not the person's. */
  private expectingOwnScroll = false
  private skinObserver: MutationObserver | null = null
  private readonly modelOverlayId = `chat-model-${++chatPanelInstance}`
  private modelOverlayAnnounced = false
  private readonly documentPointerDown = (event: PointerEvent): void => {
    const path = event.composedPath()
    const withinModelPicker = path.some(target =>
      target instanceof HTMLElement && target.classList.contains('model-dropdown'),
    )
    const withinMessageMenu = path.some(target =>
      target instanceof HTMLElement && target.classList.contains('chat-message-menu'),
    )
    const withinHeaderMenu = path.some(target =>
      target instanceof HTMLElement && target.classList.contains('compact-header-actions'),
    )
    if (this.modelPickerOpen && !withinModelPicker) this.closeModelPicker()
    if (this.contextMenu && !withinMessageMenu) this.closeContextMenu()
    if (this.headerMenuOpen && !withinHeaderMenu) this.closeHeaderMenu()
  }
  private readonly documentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    let handled = false
    if (this.modelPickerOpen) {
      // A question left open is answered first: Escape says no to it, and only then to the picker.
      if (!this.declinePremium()) this.closeModelPicker(true)
      handled = true
    }
    if (this.contextMenu) {
      this.closeContextMenu()
      handled = true
    }
    if (this.headerMenuOpen) {
      this.closeHeaderMenu(true)
      handled = true
    }
    if (handled) event.preventDefault()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIGHT DOM + ADOPTED STYLES (PRESERVED — element-only)
  // ─────────────────────────────────────────────────────────────────────────

  /** Disable Shadow DOM — render in LIGHT DOM so the adopted stylesheet (and any
   * host tokens) reach the rendered tree. PRESERVED verbatim. */
  createRenderRoot(): this {
    return this
  }

  override disconnectedCallback(): void {
    if (this.modelOverlayAnnounced) this.announceModelModal(false)
    this.ownerDocument.removeEventListener('pointerdown', this.documentPointerDown)
    this.ownerDocument.removeEventListener('keydown', this.documentKeyDown)
    this.skinObserver?.disconnect()
    this.skinObserver = null
    if (this.codeCopyResetTimer) {
      clearTimeout(this.codeCopyResetTimer)
      this.codeCopyResetTimer = null
    }
    if (this.messageCopyResetTimer) {
      clearTimeout(this.messageCopyResetTimer)
      this.messageCopyResetTimer = null
    }
    this.stopStreamingTimer()
    super.disconnectedCallback()
  }

  /**
   * Inject the shared stylesheet onto the host's root. Created once, shared
   * across instances, guarded by `includes()`. This CANNOT be a free render
   * function — it needs `this.getRootNode()` + the connect lifecycle.
   */
  private adoptStyles(): void {
    // Constructable Stylesheets are absent in some DOM substrates (jsdom; older
    // SSR shims). Styling is non-functional there but render/sanitize are not —
    // so degrade gracefully rather than throw out of connectedCallback.
    if (typeof CSSStyleSheet === 'undefined' || typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync !== 'function') {
      return
    }
    if (!chatPanelStyleSheet) {
      chatPanelStyleSheet = new CSSStyleSheet()
      chatPanelStyleSheet.replaceSync((ShChatPanel.styles as CSSResult).cssText)
    }
    const root = this.getRootNode() as Document | ShadowRoot
    if (!root.adoptedStyleSheets || !root.adoptedStyleSheets.includes(chatPanelStyleSheet)) {
      if (root.adoptedStyleSheets) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, chatPanelStyleSheet]
      }
    }
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('pointerdown', this.documentPointerDown)
    this.ownerDocument.addEventListener('keydown', this.documentKeyDown)
    this.adoptStyles()
    this.applyTheme()
    this.applyAmbientSkin()
    const root = this.ownerDocument?.documentElement
    if (root && typeof MutationObserver !== 'undefined') {
      this.skinObserver = new MutationObserver(() => this.applyAmbientSkin())
      this.skinObserver.observe(root, {
        attributes: true,
        attributeFilter: ['data-skin', 'data-design'],
      })
    }
    if (!this.hasAttribute('role')) this.setAttribute('role', 'complementary')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Sophia assistant')
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('theme')) this.applyTheme()
    // The list can change under an open question (a fresh catalogue, a voice the host has since
    // marked unavailable). A question about a voice that is gone, cannot be picked, or is no
    // longer premium is let go: nothing dead is left on screen, and the next Escape closes the
    // picker instead of answering a question nobody can see.
    if (this.pendingPremium !== null && (changed.has('models') || changed.has('pendingPremium'))) {
      const raised = this.models.find((model) => model.id === this.pendingPremium)
      if (!raised || raised.disabled === true || raised.premium !== true) this.pendingPremium = null
    }
  }

  override updated(changed: PropertyValues<this>): void {
    // A finished conversation reads from the top: nothing scrolls it to the end,
    // and there is no new message to announce.
    if (this.transcriptOnly) return
    if (changed.has('messages')) {
      // A streaming assistant edits the final message in place semantically: the
      // array identity changes, but its length does not. Treat every post-mount
      // message projection as new transcript material while the user is paused,
      // rather than only noticing appended message rows.
      if (changed.get('messages') !== undefined && !this.autoScroll) {
        this.hasNewMessages = true
      }
      if (this.autoScroll) {
        this.scrollToBottom()
        this.hasNewMessages = false
        this.pinAgainAfterLayout()
      }
    }

    if (changed.has('streaming')) {
      if (this.streaming) {
        this.startStreamingTimer()
      } else {
        this.stopStreamingTimer()
      }
    }
  }

  /**
   * Drive `data-theme` on the host from the `theme` property — the ONLY theming
   * path. For 'auto' we read matchMedia (a pure platform query, not a store);
   * a host may instead pass an already-resolved 'light'|'dark'. The resolved
   * attribute activates the `sh-chat-panel[data-theme="dark"]` adopted rules.
   */
  private applyTheme(): void {
    const resolved =
      this.theme === 'auto'
        ? typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : this.theme
    this.dataset.theme = resolved
  }

  /** Mirror the ambient material identity onto the light-DOM panel. The panel
   * can live inside the host's shadow root, so walk across shadow hosts before
   * falling back to the document root. This is presentation-only DOM state. */
  private applyAmbientSkin(): void {
    let current: Element | null = this.parentElement
    let root: Node = this.getRootNode()
    while (true) {
      while (current) {
        const value = current.getAttribute('data-skin') || current.getAttribute('data-design')
        if (value) {
          this.dataset.skin = value
          return
        }
        current = current.parentElement
      }
      if (!(root instanceof ShadowRoot)) break
      const host = root.host
      const value = host.getAttribute('data-skin') || host.getAttribute('data-design')
      if (value) {
        this.dataset.skin = value
        return
      }
      current = host.parentElement
      root = host.getRootNode()
    }
    const documentRoot = this.ownerDocument?.documentElement
    const value = documentRoot?.getAttribute('data-skin') || documentRoot?.getAttribute('data-design')
    if (value) this.dataset.skin = value
    else delete this.dataset.skin
  }

  private startStreamingTimer(): void {
    if (this.streamingTimerId) return
    this.streamingStartTime = Date.now()
    this.streamingElapsed = 0
    this.streamingTimerId = setInterval(() => {
      if (this.streamingStartTime) {
        this.streamingElapsed = Math.floor((Date.now() - this.streamingStartTime) / 1000)
      }
    }, 1000)
  }

  private stopStreamingTimer(): void {
    if (this.streamingTimerId) {
      clearInterval(this.streamingTimerId)
      this.streamingTimerId = null
    }
    this.streamingStartTime = null
    this.streamingElapsed = 0
  }

  private thinkingLabel(): string {
    return this.streamingElapsed >= 3 ? t('chat.thinkingSeconds', { seconds: this.streamingElapsed }) : 'Thinking...'
  }

  /**
   * The reply's words are all here and only the end of the turn is awaited: the last
   * thing on screen is this conversation's own assistant message, finished, and no
   * message is being sent. (While a message is being sent the last thing on screen
   * is still the previous answer, and that is not this turn's reply.)
   */
  private replyIsIn(): boolean {
    if (this.sendState === 'saving') return false
    const last = this.messages[this.messages.length - 1]
    return last?.role === 'assistant'
      && last.origin !== 'window'
      && !last.isStreaming
      && last.content.trim().length > 0
  }

  private streamingHint(): string {
    const streamingMsg = [...this.messages].reverse().find((msg) => msg.role === 'assistant' && msg.isStreaming)
    // Once the reply text is complete, "Thinking... (4s)" would be a lie: the model
    // has finished; what is awaited is the close of the turn.
    if (!streamingMsg) return this.replyIsIn() ? t('Finishing...') : this.thinkingLabel()

    const runningTool = streamingMsg.toolCalls.find((tool) => tool.status === 'pending' || tool.status === 'running')
    if (runningTool) return t('chat.runningTool', { name: runningTool.tool })
    if (streamingMsg.content) return t('Responding...')
    return this.thinkingLabel()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PURE LOCAL UI HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  private toggleTool(id: string): void {
    if (this.toolsExpandedByDefault) {
      const next = new Set(this.collapsedToolIds)
      next.has(id) ? next.delete(id) : next.add(id)
      this.collapsedToolIds = next
      return
    }
    const next = new Set(this.expandedToolIds)
    next.has(id) ? next.delete(id) : next.add(id)
    this.expandedToolIds = next
  }

  private isToolExpanded(id: string): boolean {
    return this.toolsExpandedByDefault ? !this.collapsedToolIds.has(id) : this.expandedToolIds.has(id)
  }

  private toggleReasoning(id: string): void {
    const next = new Set(this.expandedReasoningIds)
    next.has(id) ? next.delete(id) : next.add(id)
    this.expandedReasoningIds = next
  }

  /** A role="button" that is not a native button answers Enter and Space as a button does. */
  private pressOnKey(event: KeyboardEvent, activate: () => void): void {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    activate()
  }

  /** Whether the host named this message button among the ones it can honour. */
  private messageActionAllowed(action: MessageActionKind): boolean {
    return this.messageActions === undefined || this.messageActions.includes(action)
  }

  /** Whether the host named this header button among the ones it can honour. */
  private headerActionAllowed(action: HeaderActionKind): boolean {
    return this.headerActions === undefined || this.headerActions.includes(action)
  }

  private setDraft(
    text: string,
    detail: HojaComposerDetail | null = null,
    reason: ChatDraftChangeReason = 'edit',
  ): void {
    if (this.draft === text && this.draftDetail === detail) return
    this.draft = text
    this.draftDetail = detail
    this.onDraftChange?.(text, detail, reason)
  }

  /** Submit the draft via the onSend seam. The kernel clears the pure draft prop;
   * the host (ChatService) performs the actual send — no store call here. */
  private send(composer: HojaComposerDetail | null = this.draftDetail): void {
    const text = (composer?.value ?? this.draft).trim()
    if (
      !text
      || composer?.isEmpty === true
      || this.sendDisabled
      || this.readOnly
      || (this.streaming && !this.steerWhileStreaming)
      || this.connectionBlocksSend()
      || this.sendState === 'saving'
      || this.sendState === 'uncertain'
    ) return
    const context = composer ? { composer } satisfies ChatSendContext : undefined
    this.setDraft('', null, 'submit-clear')
    this.scrollToBottom(true)
    this.onSend?.(text, context)
  }

  private clearDraft(): void {
    this.setDraft('', null, 'clear')
    void this.updateComplete.then(() => this.composerElement()?.focus())
  }

  private useSuggestion(suggestion: ChatEmptySuggestion): void {
    this.setDraft(suggestion.prompt, null, 'edit')
    this.onSuggestionUse?.(suggestion)
    void this.updateComplete.then(() => {
      this.composerElement()?.focus()
    })
  }

  private composerElement(): HojaEditor | null {
    return this.querySelector<HojaEditor>('hoja-editor[posture="composer"]')
  }

  private handleComposerChange(detail: HojaComposerDetail): void {
    this.setDraft(detail.value, detail, 'edit')
  }

  private async copyCodeBlock(intent: CodeCopyIntent): Promise<void> {
    if (!this.onCodeCopy) return
    try {
      await this.onCodeCopy(intent)
      this.copiedCodeBlockId = intent.codeBlockId
      if (this.codeCopyResetTimer) clearTimeout(this.codeCopyResetTimer)
      this.codeCopyResetTimer = setTimeout(() => {
        if (this.copiedCodeBlockId === intent.codeBlockId) {
          this.copiedCodeBlockId = null
        }
      }, 2000)
    } catch {
      // Host owns failure reporting; the pure panel simply withholds copied state.
    }
  }

  private async handleMessageAction(messageId: string, action: MessageActionKind): Promise<void> {
    if (!this.onMessageAction) return
    try {
      const result = await this.onMessageAction(messageId, action)
      if (action !== 'copy') return
      if (!result?.defaultHandled || result.error) return
      this.copiedMessageId = messageId
      if (this.messageCopyResetTimer) clearTimeout(this.messageCopyResetTimer)
      this.messageCopyResetTimer = setTimeout(() => {
        if (this.copiedMessageId === messageId) {
          this.copiedMessageId = null
        }
      }, 2000)
    } catch {
      // Host owns failure reporting; the pure panel simply withholds copied state.
    }
  }

  private openMessageContextMenu(e: MouseEvent, msg: ChatMessage): void {
    const selection = this.ownerDocument.getSelection?.()
    if (selection && selection.toString().length > 0) return
    const choices = this.contextMenuChoices(msg)
    // Nothing the host can honour means no menu, and the browser's own stays.
    if (!choices.copy && !choices.code && !choices.save && !choices.regenerate) return
    e.preventDefault()
    e.stopPropagation()
    this.contextMenu = { messageId: msg.id, x: e.clientX, y: e.clientY }
  }

  /** Which groups of the right-click menu exist for this message: what the host can
   * honour, and what the message itself offers. */
  private contextMenuChoices(msg: ChatMessage): { copy: boolean; code: boolean; save: boolean; regenerate: boolean } {
    const hasMessageAction = Boolean(this.onMessageAction)
    return {
      copy: hasMessageAction && this.messageActionAllowed('copy'),
      code: Boolean(this.onCodeCopy) && this.firstCodeBlock(msg.content) !== null,
      save: hasMessageAction && this.messageActionAllowed('save-garden'),
      // A message carried read-only in the continuation window is never regenerated.
      regenerate:
        hasMessageAction &&
        msg.role === 'assistant' &&
        !this.isWindowMessage(msg) &&
        this.messageActionAllowed('regenerate'),
    }
  }

  private closeContextMenu(): void {
    this.contextMenu = null
  }

  private messagesContainer(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.messages-container')
  }

  private isNearBottom(el: HTMLElement, threshold = 50): boolean {
    return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold
  }

  private isAtBottom(el: HTMLElement, threshold = 1): boolean {
    return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold
  }

  /** Wheel fires before the browser's deferred scroll event. Pause eagerly on
   * upward intent so a fast streaming tick cannot win the race and snap the
   * transcript back to the bottom before handleMessagesScroll observes it. */
  private handleMessagesWheel(event: WheelEvent): void {
    if (event.deltaY >= 0 || !this.autoScroll) return
    const area = this.messagesContainer()
    if (area) this.lastObservedScrollTop = area.scrollTop
    this.autoScroll = false
  }

  /**
   * The pin made in `updated()` measures the room as it is at that instant, and the room changes again before it settles:
   * a composer that grows once its editor is up, a row of chrome that comes and goes (a continued conversation opened on a
   * phone was left 57 px short of its end, the line under the seam out of sight). Pin once more when the layout has settled;
   * a person who has scrolled away in the meantime is not followed.
   */
  private pinAgainAfterLayout(): void {
    if (typeof requestAnimationFrame === 'undefined') return
    requestAnimationFrame(() => {
      if (this.isConnected && this.autoScroll) this.scrollToBottom()
    })
  }

  private scrollToBottom(force = false, smooth = false): void {
    if (this.transcriptOnly) return
    const area = this.messagesContainer()
    if (!area) return
    const atBottom = this.isNearBottom(area)
    if (!force && !this.autoScroll && !atBottom) return

    if (smooth && typeof area.scrollTo === 'function') {
      area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' })
    } else {
      const before = area.scrollTop
      area.scrollTop = area.scrollHeight
      // The browser tells us of a scroll we made in a scroll event; that event is not the person's doing.
      if (area.scrollTop !== before) this.expectingOwnScroll = true
    }
    this.lastObservedScrollTop = area.scrollTop
    if (force) {
      this.autoScroll = true
      this.hasNewMessages = false
    }
  }

  private handleMessagesScroll(): void {
    const area = this.messagesContainer()
    if (!area) return
    const scrollTop = area.scrollTop
    if (this.expectingOwnScroll) {
      // Our own pin, announced after the room changed under it: reading "not at the bottom" off it would
      // unpin a conversation the person never left.
      this.expectingOwnScroll = false
      this.lastObservedScrollTop = scrollTop
      return
    }
    const movedUp = scrollTop < this.lastObservedScrollTop - 0.5
    const atBottom = this.isNearBottom(area)
    // The 50px threshold is useful when a user scrolls back DOWN: it avoids a
    // fussy last-pixel requirement before pinning resumes. It must not swallow
    // an upward gesture, though. Any real upward movement away from the exact
    // bottom pauses, even if it remains inside that near-bottom band.
    const nextAutoScroll = movedUp && !this.isAtBottom(area) ? false : atBottom
    this.lastObservedScrollTop = scrollTop
    if (this.autoScroll === nextAutoScroll) return
    this.autoScroll = nextAutoScroll
    if (atBottom) this.hasNewMessages = false
  }

  private scrollToBottomClick(): void {
    this.scrollToBottom(true, true)
  }

  private firstCodeBlock(content: string): { code: string; lang: string | null } | null {
    const match = content.match(/```(\w*)\n?([\s\S]*?)```/)
    if (!match) return null
    return {
      lang: match[1] || null,
      code: match[2].trim(),
    }
  }

  private async selectContextMenuItem(
    msg: ChatMessage,
    item: 'copy' | 'copy-markdown' | 'copy-code' | 'save-garden' | 'regenerate',
  ): Promise<void> {
    this.closeContextMenu()
    if (item === 'copy' || item === 'copy-markdown') {
      await this.handleMessageAction(msg.id, 'copy')
      return
    }
    if (item === 'save-garden') {
      await this.handleMessageAction(msg.id, 'save-garden')
      return
    }
    if (item === 'regenerate') {
      await this.handleMessageAction(msg.id, 'regenerate')
      return
    }
    const code = this.firstCodeBlock(msg.content)
    if (!code || !this.onCodeCopy) return
    await this.copyCodeBlock({
      messageId: msg.id,
      codeBlockId: `${msg.id}-menu-code-0`,
      code: code.code,
      lang: code.lang,
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROSE RENDERING (sanitize at BOTH prose sites; code-fence stays escaped)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Render markdown content, splitting out ```code fences``` so they get a
   * Lit-text-escaped <pre><code> (NOT unsafeHTML) while prose runs through
   * marked -> sanitize -> unsafeHTML. The sanitize() call at BOTH prose sites is
   * the XSS-hole closure (the original did marked.parse -> unsafeHTML with NO
   * sanitizer at both sites).
   */
  private renderContent(content: string, messageId: string, scope = 'body'): TemplateResult | TemplateResult[] {
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
    const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string; codeBlockId?: string }> = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let blockIndex = 0

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) })
      }
      parts.push({
        type: 'code',
        lang: match[1] || undefined,
        content: match[2].trim(),
        codeBlockId: `${messageId}-${scope}-code-${blockIndex++}`,
      })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) })
    }

    // No code fences — render whole content as markdown (PROSE SITE A: sanitized).
    if (parts.length === 0) {
      const htmlContent = this.sanitize(marked.parse(content) as string)
      return html`<div class="markdown-content">${unsafeHTML(htmlContent)}</div>`
    }

    return parts.map((part) => {
      if (part.type === 'text') {
        // PROSE SITE B (the per-part loop path): sanitized too. Missing this is
        // the easy XSS regression — any message with a code fence forces this
        // branch.
        const htmlContent = this.sanitize(marked.parse(part.content) as string)
        return html`<div class="markdown-content">${unsafeHTML(htmlContent)}</div>`
      }

      // Code-fence literal path — ALREADY Lit-text-escaped via the ${} binding.
      // Do NOT sanitize/unsafeHTML it (that would double-process / re-open it).
      const codeBlockId = part.codeBlockId!
      const isCopied = this.copiedCodeBlockId === codeBlockId
      return html`
        <div class="code-block">
          <div class="code-block-header">
            <span class="code-lang-badge">${part.lang ?? 'code'}</span>
            <button
              class="code-copy-btn ${isCopied ? 'copied' : ''}"
              @click=${() => {
                void this.copyCodeBlock({
                  messageId,
                  codeBlockId,
                  code: part.content,
                  lang: part.lang ?? null,
                })
              }}
              aria-label="${isCopied ? 'Copied' : 'Copy code'}"
              title="${isCopied ? 'Copied!' : 'Copy code'}"
            >
              ${isCopied ? '✓ Copied' : '⧉ Copy'}
            </button>
          </div>
          <pre><code>${part.content}</code></pre>
        </div>
      `
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL-CALL RENDERING (status badges: pending / running / completed / error)
  // ─────────────────────────────────────────────────────────────────────────

  private renderToolDataBlock(label: string, value: unknown): TemplateResult | typeof nothing {
    if (value === null || value === undefined || value === '') return nothing
    const parsed = typeof value === 'string' ? this.parseJsonMaybe(value) : value
    const isStructured = parsed !== value || (typeof parsed === 'object' && parsed !== null)
    const rendered = isStructured ? JSON.stringify(parsed, null, 2) : String(value)
    return html`
      <div class="tool-data-block">
        <div class="tool-data-label">${label}</div>
        <pre class=${isStructured ? 'tool-json' : 'tool-output-text'}><code>${rendered}</code></pre>
      </div>
    `
  }

  private parseJsonMaybe(value: string): unknown {
    const trimmed = value.trim()
    if (!this.looksLikeJson(trimmed)) return value
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }

  private looksLikeJson(value: string): boolean {
    return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
  }

  private renderToolCall(tool: ToolCall): TemplateResult | typeof nothing {
    if (
      !this.transcriptOnly &&
      (tool.tool === 'surface' || tool.tool === 'mnemosyne_surface') &&
      tool.status === 'completed' &&
      tool.output
    ) {
      return this.renderSurfaceCard(tool)
    }

    const isExpanded = this.isToolExpanded(tool.id)
    const isError = tool.status === 'error'
    const kind = toolActivityKind(tool.tool)
    const testimony = toolTestimonyLabels(tool)

    return html`
      <div class="tool-call ${isExpanded ? 'expanded' : ''} ${isError ? 'error' : ''}" data-activity-kind=${kind}>
        <div
          class="tool-call-header"
          role="button"
          tabindex="0"
          aria-expanded=${isExpanded ? 'true' : 'false'}
          @click=${() => this.toggleTool(tool.id)}
          @keydown=${(event: KeyboardEvent) => this.pressOnKey(event, () => this.toggleTool(tool.id))}
          title="${isExpanded ? 'Collapse' : t('Expand')} details"
        >
          <div class="tool-info">
            <span class="tool-toggle">▸</span>
            <span class="tool-kind">${toolActivityKindLabel(kind)}</span>
            <span class="tool-call-name">${tool.tool}</span>
          </div>
          ${this.renderToolBadge(tool.status)}
        </div>
        ${testimony.length
          ? html`<div class="tool-testimony" aria-label=${t('Tool result testimony')}>
              ${testimony.map((label) => html`<span class="tool-testimony-label" data-testimony=${label}>${label}</span>`)}
            </div>`
          : nothing}
        ${isError && tool.output
          ? html`<div class="tool-call-error">${tool.output}</div>`
          : nothing}
        ${isExpanded
          ? html`
              <div class="tool-call-details">
                ${this.renderToolDataBlock('Input', tool.input)}
                ${this.renderToolDataBlock(isError ? t('Error') : 'Output', tool.output)}
                ${this.renderOutputNotRetained(tool)}
                ${this.renderToolDataBlock(t('Testimony'), tool.metadata)}
              </div>
            `
          : nothing}
      </div>
    `
  }

  /** A finished conversation says so when a call kept no output. A live call that
   * has not returned yet has no output either, and that is not "not retained". */
  private renderOutputNotRetained(tool: ToolCall): TemplateResult | typeof nothing {
    if (!this.transcriptOnly) return nothing
    if (tool.output !== null && tool.output !== undefined) return nothing
    if (tool.status !== 'completed' && tool.status !== 'error') return nothing
    return html`<div class="tool-data-block"><p class="tool-output-missing">${t('Output not retained.')}</p></div>`
  }

  /** The status badge — the 4 states the R5 real-DOM test asserts. */
  private renderToolBadge(status: ToolCall['status']): TemplateResult {
    switch (status) {
      case 'running':
        return html`<span class="tool-status-icon tool-spinner" data-status="running" title=${t('Running')}>⟳</span>`
      case 'completed':
        return html`<span class="tool-status-icon success" data-status="completed" title=${t('Completed')}>✓</span>`
      case 'error':
        return html`<span class="tool-status-icon error" data-status="error" title=${t('Error')}>✕</span>`
      case 'pending':
      default:
        return html`<span class="tool-status-icon pending" data-status="pending" title=${t('Pending')}>◷</span>`
    }
  }

  private renderSurfaceCard(tool: ToolCall): TemplateResult | typeof nothing {
    let payload: SurfacePayload
    try {
      payload = JSON.parse(tool.output!) as SurfacePayload
      if (payload.type !== 'surface' || !Array.isArray(payload.actions)) {
        return this.renderGenericToolCall(tool)
      }
    } catch {
      return this.renderGenericToolCall(tool)
    }

    if (payload.actions.length === 0) return nothing

    return html`
      <div class="surface-card">
        ${payload.actions.map(
          (action) => html`
            <button
              class="surface-action"
              @click=${() =>
                this.onSurfaceAction?.({
                  documentId: action.document_id,
                  title: action.title,
                  action: action.action,
                  blockId: action.block_id,
                })}
              title="Open ${action.title}"
            >
              <span class="surface-action-title">${action.title}</span>
              <span class="surface-action-desc">${action.action}</span>
              <span class="surface-action-arrow">→</span>
            </button>
          `,
        )}
      </div>
    `
  }

  private renderGenericToolCall(tool: ToolCall): TemplateResult {
    const isExpanded = this.isToolExpanded(tool.id)
    return html`
      <div class="tool-call ${isExpanded ? 'expanded' : ''}">
        <div
          class="tool-call-header"
          role="button"
          tabindex="0"
          aria-expanded=${isExpanded ? 'true' : 'false'}
          @click=${() => this.toggleTool(tool.id)}
          @keydown=${(event: KeyboardEvent) => this.pressOnKey(event, () => this.toggleTool(tool.id))}
        >
          <div class="tool-info">
            <span class="tool-toggle">▸</span>
            <span class="tool-call-name">${tool.tool}</span>
          </div>
          ${this.renderToolBadge('completed')}
        </div>
        ${isExpanded
          ? html`<div class="tool-call-details">${this.renderToolDataBlock('Output', tool.output)}</div>`
          : nothing}
      </div>
    `
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MESSAGE RENDERING
  // ─────────────────────────────────────────────────────────────────────────

  private renderTypingIndicator(): TemplateResult {
    return html`
      <div class="typing-indicator" aria-label=${t('Assistant is typing')}>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `
  }

  private formatTime(ts: number): string {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  private renderTranscriptPart(
    msg: ChatMessage,
    part: Extract<MessagePart, { type: 'transcript' }>,
    partIndex: number,
  ): TemplateResult {
    const tone = part.tone ?? 'voice'
    return html`
      <section class="transcript-part ${tone}" aria-label="${part.sourceLabel ?? part.title}">
        <div class="transcript-divider">
          <span class="transcript-knot" aria-hidden="true"></span>
          <span class="transcript-title">${part.title}</span>
          <span class="transcript-line" aria-hidden="true"></span>
        </div>
        <div class="transcript-body">
          ${this.renderTranscriptContent(part.content, msg.id, `transcript-${partIndex}`)}
        </div>
      </section>
    `
  }

  private renderTranscriptContent(
    content: string,
    messageId: string,
    scope: string,
  ): TemplateResult | TemplateResult[] {
    const parsed = this.parseJsonMaybe(content)
    if (parsed !== content && typeof parsed === 'object' && parsed !== null) {
      return html`<pre class="transcript-json"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`
    }
    return this.renderContent(content, messageId, scope)
  }

  private renderPart(msg: ChatMessage, part: MessagePart, partIndex: number): TemplateResult | typeof nothing {
    if (part.type === 'text') {
      return html`<div class="message-content">${this.renderContent(part.content, msg.id, `part-${partIndex}`)}</div>`
    }
    if (part.type === 'transcript') {
      return this.renderTranscriptPart(msg, part, partIndex)
    }
    if (part.type === 'reasoning') {
      const isExpanded = msg.isStreaming || this.expandedReasoningIds.has(msg.id)
      return html`
        <div class="message-reasoning ${isExpanded ? 'expanded' : ''}">
          <div
            class="reasoning-header"
            role="button"
            tabindex="0"
            aria-expanded=${isExpanded ? 'true' : 'false'}
            @click=${() => this.toggleReasoning(msg.id)}
            @keydown=${(event: KeyboardEvent) => this.pressOnKey(event, () => this.toggleReasoning(msg.id))}
            title="${isExpanded ? 'Collapse' : t('Expand')} thinking"
          >
            <span class="reasoning-toggle">▸</span>
            <span>${t('Thinking')}</span>
          </div>
          ${isExpanded
            ? html`<div class="reasoning-content">
                ${this.renderContent(part.content, msg.id, `reasoning-${partIndex}`)}
              </div>`
            : nothing}
        </div>
      `
    }
    // tool part
    const tool = msg.toolCalls.find((t) => t.id === part.toolCallId)
    return tool ? html`<div class="tool-calls" role="list">${this.renderToolCall(tool)}</div>` : nothing
  }

  /** A message from an earlier conversation, carried read-only in the window. */
  private isWindowMessage(msg: ChatMessage): boolean {
    return msg.origin === 'window'
  }

  private formatWindowTime(ts: number): string {
    if (!(ts > 0)) return ''
    try {
      return new Date(ts).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }

  private renderMessage(msg: ChatMessage): TemplateResult {
    const showTyping = msg.isStreaming && !msg.content
    const bubbleClasses = `message-bubble ${msg.isStreaming ? 'streaming' : ''}`
    const annotation = this.formatModelAnnotation?.(msg) ?? null
    const isWindow = this.isWindowMessage(msg)
    // Nobody pretends to be anybody: an earlier assistant is named as such, and
    // the voice mark beside it says only what the record says.
    const author = msg.role === 'user'
      ? 'You'
      : isWindow
        ? 'Earlier assistant'
        : this.assistantLabel
    const time = isWindow ? this.formatWindowTime(msg.createdAt) : this.formatTime(msg.createdAt)

    // NOTE: return the parts array DIRECTLY (not wrapped in a bare html`${array}`
    // template) — a template whose sole content is a single array binding
    // desyncs happy-dom's parser into a `<?>` node. A direct array binding is
    // handled correctly.
    const body: TemplateResult | TemplateResult[] | typeof nothing =
      msg.parts && msg.parts.length > 0
        ? msg.parts.map((part, index) => this.renderPart(msg, part, index)).filter((p): p is TemplateResult => p !== nothing)
        : html`
            <div class="message-content">
              ${showTyping
                ? this.renderTypingIndicator()
                : msg.content
                  ? this.renderContent(msg.content, msg.id)
                  : html`<span class="placeholder">${t('Thinking…')}</span>`}
            </div>
            ${msg.toolCalls.length > 0
              ? html`<div class="tool-calls" role="list" aria-label=${t('Tool calls')}>
                  ${msg.toolCalls.map((t) => this.renderToolCall(t))}
                </div>`
              : nothing}
          `

    return html`
      <article
        class="message ${msg.role} ${isWindow ? 'window' : ''}"
        data-message-id=${msg.id}
        data-origin=${isWindow ? 'window' : nothing}
        aria-label="${msg.role === 'user' ? t('Your message') : isWindow ? t('Earlier assistant message') : `${this.assistantLabel} message`}"
        @contextmenu=${(e: MouseEvent) => this.openMessageContextMenu(e, msg)}
      >
        <div class="message-byline" aria-hidden="true">
          <span class="message-author">${author}</span>
          <span class="message-byline-rule"></span>
        </div>
        <div class="${bubbleClasses}">
          ${body}
          ${msg.parts && msg.parts.length > 0 && showTyping
            ? html`<div class="message-content">${this.renderTypingIndicator()}</div>`
            : nothing}
          ${msg.error ? html`<div class="message-error" role="alert">${msg.error}</div>` : nothing}
        </div>
        ${this.renderTurnChanges(msg, isWindow)}
        ${this.renderTurnPreviews(msg, isWindow)}
        <div class="message-meta">
          ${this.transcriptOnly || !time ? nothing : html`<span class="message-time">${time}</span>`}
          ${msg.role === 'assistant' && msg.voice
            ? html`<span
                class="message-voice"
                data-voice-basis=${msg.voice.basis}
                title=${msg.voice.id ?? t('The source did not record which model answered.')}
              >${voiceMarkText(msg.voice)}</span>`
            : nothing}
          ${annotation ? html`<span class="message-annotation">${annotation}</span>` : nothing}
          ${this.renderMessageActions(msg, isWindow)}
        </div>
      </article>
    `
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHANGED IN THIS TURN (the empowered workspace chat, design §10)
  // ─────────────────────────────────────────────────────────────────────────

  private turnChanges(msg: ChatMessage): TurnChanges {
    const known = this.turnChangesCache.get(msg.toolCalls)
    if (known) return known
    const read = turnChangesOf(msg.toolCalls)
    this.turnChangesCache.set(msg.toolCalls, read)
    return read
  }

  /** Which reply last changed each artifact (only it carries the live preview) and each one's media type. */
  private artifactsOfConversation(): NonNullable<ShChatPanel['artifactIndex']> {
    if (this.artifactIndex?.messages === this.messages) return this.artifactIndex
    const owner = new Map<string, string>()
    const mediaType = new Map<string, string>()
    for (const message of this.messages) {
      if (message.role !== 'assistant' || this.isWindowMessage(message) || message.toolCalls.length === 0) continue
      for (const change of this.turnChanges(message).changes) {
        if (change.subject !== 'artifact' || !change.id) continue
        owner.set(change.id, message.id)
        if (change.mediaType && !mediaType.has(change.id)) mediaType.set(change.id, change.mediaType)
      }
    }
    this.artifactIndex = { messages: this.messages, owner, mediaType }
    return this.artifactIndex
  }

  /** When the turn behind a reply began: the person's message before it. */
  private turnStartedAt(msg: ChatMessage): number | null {
    const index = this.messages.indexOf(msg)
    for (let back = index - 1; back >= 0; back -= 1) {
      const earlier = this.messages[back]
      if (earlier.role === 'user') return earlier.createdAt > 0 ? earlier.createdAt : null
    }
    return null
  }

  /**
   * The strip under a reply that wrote: one row per thing changed, with the way back (History, or an
   * artifact's revisions) and no undo button. A whole-document delete, a folder and a wire are shown
   * apart, as gone. The live preview of an HTML artifact follows, from the host, under the reply that
   * last changed it. Not drawn for a finished conversation shown alone or a carried window.
   */
  private renderTurnChanges(msg: ChatMessage, isWindow: boolean): TemplateResult | typeof nothing {
    if (this.transcriptOnly || isWindow || msg.role !== 'assistant' || msg.toolCalls.length === 0) return nothing
    const { changes, refused } = this.turnChanges(msg)
    if (changes.length === 0 && refused === 0) return nothing
    const before = this.turnStartedAt(msg)
    return html`
      <section
        class="turn-changes"
        aria-label=${changes.length > 0 ? 'Changed in this turn' : 'Nothing changed in this turn'}
        data-pending=${changes.some(change => change.pending) ? 'true' : 'false'}
      >
        <div class="turn-changes-title">${changes.length > 0 ? 'Changed in this turn' : 'Nothing changed in this turn'}</div>
        ${changes.length > 0
          ? html`<ul class="turn-change-list">${changes.map(change => this.renderTurnChange(change, before))}</ul>`
          : nothing}
        ${refused > 0
          ? html`<p class="turn-changes-refused" role="note">${refused === 1
            ? '1 change was refused, so it changed nothing.'
            : `${refused} changes were refused, so they changed nothing.`}</p>`
          : nothing}
      </section>
    `
  }

  /** The live previews under a reply: each HTML artifact it was the last to change, from the host. */
  private renderTurnPreviews(msg: ChatMessage, isWindow: boolean): TemplateResult | typeof nothing {
    const render = this.renderArtifactPreview
    if (!render || this.transcriptOnly || isWindow || msg.role !== 'assistant' || msg.toolCalls.length === 0) return nothing
    const artifacts = this.artifactsOfConversation()
    const previews = this.turnChanges(msg).changes.filter(change => change.subject === 'artifact' && change.id
      && !change.removal
      && artifacts.owner.get(change.id) === msg.id
      && previewableMediaType(artifacts.mediaType.get(change.id) ?? change.mediaType))
    if (previews.length === 0) return nothing
    return html`<div class="turn-artifact-previews">${previews.map(change => this.renderArtifactPreviewFrame(render, {
      artifactId: change.id!,
      messageId: msg.id,
      mediaType: artifacts.mediaType.get(change.id!) ?? change.mediaType,
      title: change.title,
    }))}</div>`
  }

  /** One live preview: the host's element, in a frame of the chat's own. A host that throws frames nothing. */
  private renderArtifactPreviewFrame(
    render: (request: ChatArtifactPreviewRequest) => unknown,
    request: ChatArtifactPreviewRequest,
  ): TemplateResult | typeof nothing {
    let preview: unknown
    try {
      preview = render(request)
    } catch {
      return nothing
    }
    if (preview === null || preview === undefined || preview === nothing) return nothing
    return html`<div class="turn-artifact-preview" data-artifact-id=${request.artifactId}>${preview}</div>`
  }

  private renderTurnChange(change: TurnChange, before: number | null): TemplateResult {
    const named = change.title
      ?? (change.id ? this.safeChangeTitle(change.subject, change.id) : null)
      ?? change.id
    const name = named ?? subjectNoun(change.subject)
    // Shown apart: what is gone with no History to bring it back. A wire is deleted as a person deletes it
    // (Vera, 2026-10-06): an ordinary row, listed by its id.
    const gone = change.removal === 'document' || change.removal === 'folder'
    const listening = this.onChangeAction !== undefined
    const opens = listening && change.id !== null && !gone && (change.subject === 'document' || change.subject === 'artifact')
    const id = change.id
    return html`
      <li
        class="turn-change ${gone ? 'removed' : ''}"
        data-change-subject=${change.subject}
        data-change-id=${id ?? nothing}
        data-removal=${change.removal ?? nothing}
        data-pending=${change.pending ? 'true' : 'false'}
      >
        <span class="turn-change-verbs">${change.verbs.map(verb => verbLabel(verb)).join(' · ')}</span>
        ${opens
          ? html`<button
              class="turn-change-open"
              type="button"
              title=${`Open ${name}`}
              @click=${() => this.changeAction(change.subject === 'artifact'
                ? { type: 'open-artifact', artifactId: id! }
                : { type: 'open-document', documentId: id!, ...(change.blockId ? { blockId: change.blockId } : {}) })}
            >${name}</button>`
          : html`<span class="turn-change-name">${name}</span>`}
        ${change.pending ? html`<span class="turn-change-pending" aria-label=${t('still changing')}>…</span>` : nothing}
        ${opens
          ? html`<button
              class="turn-change-history"
              type="button"
              title=${change.subject === 'artifact' ? 'Open this artifact\'s revisions' : 'Open this document\'s History, at the version before this turn'}
              @click=${() => this.changeAction(change.subject === 'artifact'
                ? { type: 'open-artifact', artifactId: id!, revisions: true }
                : { type: 'open-history', documentId: id!, ...(before !== null ? { before } : {}) })}
            >${change.subject === 'artifact' ? 'Revisions' : t('History')}</button>`
          : nothing}
        ${change.removal && removalNote(change.removal)
          ? html`<span class="turn-change-note">${removalNote(change.removal)}</span>`
          : nothing}
      </li>
    `
  }

  private safeChangeTitle(subject: ChangeSubject, id: string): string | null {
    try {
      const title = this.changeTitle?.(subject, id)
      return typeof title === 'string' && title.trim() ? title.trim() : null
    } catch {
      return null
    }
  }

  private changeAction(intent: ChatChangeIntent): void {
    this.onChangeAction?.(intent)
  }

  /** What the chat may do here, in the host's words, above the composer. */
  private renderAccessNote(): TemplateResult | typeof nothing {
    const note = this.accessNote
    if (!note || !note.label) return nothing
    return html`
      <div class="chat-access" data-access=${note.mode} role="note">
        <span class="chat-access-label">${note.label}</span>
        ${note.detail ? html`<span class="chat-access-detail">${note.detail}</span>` : nothing}
      </div>
    `
  }

  /** The strip under an assistant turn. Only the buttons the host can honour are drawn;
   * with none allowed there is no strip at all. A message carried read-only in the
   * continuation window keeps Copy and loses the two actions that would act on it. */
  private renderMessageActions(msg: ChatMessage, readOnlyWindow: boolean): TemplateResult | typeof nothing {
    if (msg.role === 'user') return this.renderBranchAction(msg, readOnlyWindow)
    if (msg.role !== 'assistant' || !msg.content) return nothing
    const read = !readOnlyWindow && this.messageActionAllowed('read')
    const copy = this.messageActionAllowed('copy')
    const regenerate = !readOnlyWindow && this.messageActionAllowed('regenerate')
    if (!read && !copy && !regenerate) return nothing
    return html`
      <div class="message-actions">
        ${read
          ? html`
              <button
                class="message-action-btn"
                @click=${() => {
                  void this.handleMessageAction(msg.id, 'read')
                }}
                aria-label=${t('Read aloud')}
                title=${t('Read aloud')}
              >
                🔊
              </button>
            `
          : nothing}
        ${copy
          ? html`
              <button
                class="message-action-btn ${this.copiedMessageId === msg.id ? 'copied' : ''}"
                @click=${() => {
                  void this.handleMessageAction(msg.id, 'copy')
                }}
                aria-label="${this.copiedMessageId === msg.id ? 'Copied' : t('Copy message')}"
                title="${this.copiedMessageId === msg.id ? 'Copied!' : t('Copy message')}"
              >
                ${this.copiedMessageId === msg.id
                  ? html`✓<span class="copy-toast">${t('Copied to clipboard')}</span>`
                  : '⧉'}
              </button>
            `
          : nothing}
        ${regenerate
          ? html`
              <button
                class="message-action-btn"
                @click=${() => {
                  void this.handleMessageAction(msg.id, 'regenerate')
                }}
                aria-label=${t('Regenerate')}
                title=${t('Regenerate')}
              >
                ↻
              </button>
            `
          : nothing}
      </div>
    `
  }

  /** "Branch from here" under one of the person's messages: only where the host named it, never while a
   * reply is streaming, never in a transcript shown alone or a continuation window. */
  private renderBranchAction(msg: ChatMessage, readOnlyWindow: boolean): TemplateResult | typeof nothing {
    if (!this.messageActions?.includes('branch') || !this.onMessageAction) return nothing
    if (readOnlyWindow || this.transcriptOnly || this.streaming || msg.isStreaming || !msg.content) return nothing
    return html`
      <div class="message-actions">
        <button
          class="message-action-btn message-action-branch"
          data-message-branch
          @click=${() => {
            void this.handleMessageAction(msg.id, 'branch')
          }}
          aria-label=${t('Branch from here')}
          title=${t('A new conversation from before this message, with it in the box to edit and send')}
        >${t('Branch from here')}</button>
      </div>
    `
  }

  private renderMessageContextMenu(): TemplateResult | typeof nothing {
    const context = this.contextMenu
    if (!context) return nothing
    const msg = this.messages.find((m) => m.id === context.messageId)
    if (!msg) return nothing
    const choices = this.contextMenuChoices(msg)
    // A divider only ever separates two groups that both exist.
    const divider = html`<div class="chat-menu-divider" role="separator"></div>`

    return html`
      <div
        class="chat-message-menu"
        role="menu"
        style="left:${context.x}px;top:${context.y}px"
        @click=${(e: Event) => e.stopPropagation()}
      >
        ${choices.copy
          ? html`
              <button class="chat-menu-item" role="menuitem" @click=${() => this.selectContextMenuItem(msg, 'copy')}>
                <span class="chat-menu-icon">⧉</span>
                <span>${t('Copy message')}</span>
              </button>
              <button
                class="chat-menu-item"
                role="menuitem"
                @click=${() => this.selectContextMenuItem(msg, 'copy-markdown')}
              >
                <span class="chat-menu-icon">▤</span>
                <span>${t('Copy as Markdown')}</span>
              </button>
            `
          : nothing}
        ${choices.code
          ? html`
              <button
                class="chat-menu-item"
                role="menuitem"
                @click=${() => this.selectContextMenuItem(msg, 'copy-code')}
              >
                <span class="chat-menu-icon">&lt;/&gt;</span>
                <span>${t('Copy code block')}</span>
              </button>
            `
          : nothing}
        ${choices.save && (choices.copy || choices.code) ? divider : nothing}
        ${choices.save
          ? html`
              <button
                class="chat-menu-item"
                role="menuitem"
                @click=${() => this.selectContextMenuItem(msg, 'save-garden')}
              >
                <span class="chat-menu-icon">✦</span>
                <span>${t('Save to Garden')}</span>
              </button>
            `
          : nothing}
        ${choices.regenerate && (choices.copy || choices.code || choices.save) ? divider : nothing}
        ${choices.regenerate
          ? html`
              <button
                class="chat-menu-item"
                role="menuitem"
                @click=${() => this.selectContextMenuItem(msg, 'regenerate')}
              >
                <span class="chat-menu-icon">↻</span>
                <span>${t('Regenerate response')}</span>
              </button>
            `
          : nothing}
      </div>
    `
  }

  private displaySessionTitle(): string {
    const title = this.sessionTitle?.trim()
    if (!title || title === 'New chat' || title.startsWith('New session - ')) return t('New chat')
    // The label the shell gave a first chat before chats were titled. It names nothing.
    if (title.toLowerCase() === 'organism-chat') return t('Untitled chat')
    return title
  }

  private sessionAction(action: ChatSessionAction): void {
    void this.onSessionAction?.(action)
  }

  private renderSessionSlot(slot: ChatSessionSlot): TemplateResult {
    const isFilled = this.slotSessions[slot] != null
    const isActive = slot === this.activeSlot
    return html`
      <button
        class="slot-indicator ${isActive ? 'active' : isFilled ? 'filled' : ''}"
        @click=${() => this.sessionAction(isActive ? { type: 'open-history' } : { type: 'slot', slot })}
        title="${isActive
          ? t('Open chat history')
          : isFilled
            ? `Switch to slot ${slot + 1}`
            : `New chat in slot ${slot + 1}`}"
        aria-label="${isActive ? t('Current') : isFilled ? 'Filled' : 'Empty'} session slot ${slot + 1}"
        aria-pressed="${isActive ? 'true' : 'false'}"
      >
        ${slot + 1}
      </button>
    `
  }

  private renderSuperBarSlots(): TemplateResult[] {
    return ([0, 1, 2] as const).map((slot) => this.renderSessionSlot(slot))
  }

  private isModelLocked(): boolean {
    // A voice is chosen before a conversation begins. It is fixed once anything
    // has been said in THIS conversation (window messages were said elsewhere and
    // do not count), and for a conversation that picked up an earlier one, whose
    // voice was chosen at the seam.
    return this.seam != null || this.messages.some((message) => message.origin !== 'window')
  }

  private modelLabel(model: ChatModelOption | undefined): string {
    if (!model) return this.currentModel || 'Choose a voice'
    return voiceDisplayName(model)
  }

  private currentModelLabel(): string {
    return this.modelLabel(this.models.find((model) => model.id === this.currentModel))
  }

  /** A live catalogue is searchable; a short local roster stays plain. */
  private searchableVoices(): boolean {
    return this.models.length > VOICE_SEARCH_THRESHOLD
  }

  /** The active search query, or '' when the roster is too short to search. */
  private activeVoiceQuery(): string {
    return this.searchableVoices() ? this.voiceQuery.trim() : ''
  }

  /** House entries are pinned above the browse columns, not repeated inside them. */
  private pinnedVoices(query: string): ChatModelOption[] {
    const pinned = this.models.filter((model) => model.house)
    return query ? filterVoices(pinned, query) : pinned
  }

  private modelGroups(): VoiceGroup[] {
    return groupVoices(this.models.filter((model) => !model.house))
  }

  private voiceSearchGroups(query: string): VoiceGroup[] {
    return groupVoices(filterVoices(this.models.filter((model) => !model.house), query))
  }

  private isCompactViewport(): boolean {
    return (this.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY) <= 600
  }

  private announceModelModal(open: boolean): void {
    this.modelOverlayAnnounced = open
    const event = new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: this.modelOverlayId, open, modality: 'modal' },
    })
    if (this.isConnected) this.dispatchEvent(event)
    else this.ownerDocument.dispatchEvent(event)
  }

  private activeModelProvider(groups = this.modelGroups()): string | null {
    if (this.hoveredProvider && groups.some((group) => group.provider === this.hoveredProvider)) {
      return this.hoveredProvider
    }
    const current = groups.find((group) => group.models.some((model) => model.id === this.currentModel))
    return current?.provider ?? groups[0]?.provider ?? null
  }

  private openModelPicker(): void {
    if (this.isModelLocked()) return
    if (this.modelPickerOpen) {
      this.closeModelPicker()
      return
    }
    const groups = this.modelGroups()
    this.hoveredProvider = this.activeModelProvider(groups)
    this.voiceQuery = ''
    this.pendingPremium = null
    this.modelPickerOpen = true
    if (this.isCompactViewport()) this.announceModelModal(true)
    void this.updateComplete.then(() => {
      // A long roster is for typing; on a phone the keyboard would cover the sheet,
      // so there focus stays on the provider list.
      if (this.searchableVoices() && !this.isCompactViewport()) {
        const search = this.querySelector<HTMLInputElement>('.model-picker-search-input')
        if (search) {
          search.focus()
          return
        }
      }
      const currentProvider = this.activeModelProvider()
      const provider = Array.from(this.querySelectorAll<HTMLButtonElement>('[data-model-provider]'))
        .find(button => button.dataset.modelProvider === currentProvider)
      const first = provider ?? this.querySelector<HTMLButtonElement>('[data-model-id]:not(:disabled)')
      first?.focus()
    })
  }

  private closeModelPicker(returnFocus = false): void {
    if (!this.modelPickerOpen) return
    this.modelPickerOpen = false
    this.voiceQuery = ''
    this.pendingPremium = null
    if (this.modelOverlayAnnounced) this.announceModelModal(false)
    if (returnFocus) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>('.model-selector-trigger')?.focus()
      })
    }
  }

  private modelPickerKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!this.declinePremium()) this.closeModelPicker(true)
      return
    }
    if (!this.modelPickerOpen) {
      if (event.key === 'ArrowDown' && target.classList.contains('model-selector-trigger')) {
        event.preventDefault()
        this.openModelPicker()
      }
      return
    }

    if (event.key === 'Tab' && this.isCompactViewport()) {
      const focusable = Array.from(
        this.querySelectorAll<HTMLElement>(
          '.model-picker button:not(:disabled), .model-picker input:not(:disabled)',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && target === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && target === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }

    const providers = Array.from(this.querySelectorAll<HTMLButtonElement>('[data-model-provider]'))
    const models = Array.from(this.querySelectorAll<HTMLButtonElement>('[data-model-id]:not(:disabled)'))

    // In the search box, ArrowDown steps into the results; everything else types.
    if (target.classList.contains('model-picker-search-input')) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        models[0]?.focus()
      }
      return
    }

    const inProviders = providers.includes(target as HTMLButtonElement)
    const group = inProviders ? providers : models
    const index = group.indexOf(target as HTMLButtonElement)

    if (event.key === 'ArrowRight' && inProviders) {
      event.preventDefault()
      const model = models.find(button => button.dataset.modelId === this.currentModel) ?? models[0]
      model?.focus()
      return
    }
    if (event.key === 'ArrowLeft' && !inProviders && index >= 0) {
      const provider = providers.find(button => button.dataset.modelProvider === this.activeModelProvider())
      if (provider) {
        event.preventDefault()
        provider.focus()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    if (group.length === 0 || index < 0) return
    if (event.key === 'ArrowUp' && !inProviders && index === 0) {
      const search = this.querySelector<HTMLInputElement>('.model-picker-search-input')
      if (search) {
        event.preventDefault()
        search.focus()
        return
      }
    }
    event.preventDefault()
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? group.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + group.length) % group.length
    group[next]?.focus()
  }

  private selectModel(modelId: string): void {
    if (this.isModelLocked()) return
    const model = this.models.find((candidate) => candidate.id === modelId)
    if (model?.disabled === true) return
    // A premium voice costs noticeably more than House: ask once, in words, before the
    // choice is made. The voice already in use is not asked about again. Only the
    // question's own button answers it: a second click on the row asks again.
    if (model?.premium === true && modelId !== this.currentModel) {
      this.pendingPremium = modelId
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>('[data-voice-confirm-accept]')?.focus()
      })
      return
    }
    this.chooseModel(modelId)
  }

  /** The choice itself, made: the host is told, and the picker closes. */
  private chooseModel(modelId: string): void {
    if (this.isModelLocked()) return
    if (this.models.find((candidate) => candidate.id === modelId)?.disabled === true) return
    this.pendingPremium = null
    this.onModelChange?.(modelId)
    this.closeModelPicker(true)
  }

  /**
   * Say no to the open premium question. True when there was one to say no to. Focus goes back
   * to the row that raised it (where the person was), and only failing that, when that row is not
   * on screen any more, to the voice in use, then to the first row.
   */
  private declinePremium(): boolean {
    const raised = this.pendingPremium
    if (raised === null) return false
    this.pendingPremium = null
    void this.updateComplete.then(() => {
      const rows = Array.from(this.querySelectorAll<HTMLButtonElement>('.model-picker [data-model-id]'))
      const row = rows.find((candidate) => candidate.dataset.modelId === raised && !candidate.disabled)
        ?? this.querySelector<HTMLButtonElement>('.model-picker-model.selected')
        ?? this.querySelector<HTMLButtonElement>('.model-picker-model')
      row?.focus()
    })
    return true
  }

  /** The one question before a premium voice: what it costs, in the host's words. */
  private renderPremiumConfirm(): TemplateResult | typeof nothing {
    const id = this.pendingPremium
    const model = id === null ? undefined : this.models.find((candidate) => candidate.id === id)
    // A voice that cannot be picked has no question: an answer that does nothing is not offered.
    if (!model || model.disabled === true) return nothing
    const name = this.modelLabel(model)
    // Focus lands on the answer, and Enter is the whole gesture: so the price is what BOTH answers
    // are described by, and a screen reader says it before the person can accept it.
    const noteId = `${this.modelOverlayId}-confirm-note`
    return html`
      <div class="model-picker-confirm" data-voice-confirm role="group" aria-label=${t('chat.confirmVoice', { name })}>
        <span class="model-picker-confirm-copy">
          <strong>${name}</strong>
          <span id=${noteId} data-voice-confirm-note>${model.premiumNote ?? t('A short reply in this voice costs noticeably more than House.')}</span>
        </span>
        <span class="model-picker-confirm-actions">
          <button
            class="model-picker-confirm-accept"
            type="button"
            data-voice-confirm-accept
            aria-describedby=${noteId}
            @click=${() => this.chooseModel(model.id)}
          >${t('chat.useVoice', { name })}</button>
          <button
            class="model-picker-confirm-cancel"
            type="button"
            data-voice-confirm-cancel
            aria-describedby=${noteId}
            @click=${() => { this.declinePremium() }}
          >${t('Cancel')}</button>
        </span>
      </div>
    `
  }

  /** One voice: its name, an honest note, and the facts a person weighs: price per
   * million tokens in and out, context length, and whether it can use tools. A
   * legacy `{ id, label }` entry renders as just its name. */
  private renderVoiceOption(model: ChatModelOption): TemplateResult {
    const selected = model.id === this.currentModel
    const price = voicePriceSummary(model)
    const context = formatContextLength(model.contextLength)
    const tools = voiceToolsBadge(model)
    // House is the measure: it never says how many times itself it costs.
    const multiple = model.house ? null : formatVoiceMultiple(model.multipleOfHouse)
    return html`
      <button
        class="model-picker-model ${selected ? 'selected' : ''} ${model.house ? 'house' : ''}"
        data-model-id=${model.id}
        role="option"
        aria-selected="${selected ? 'true' : 'false'}"
        ?disabled=${model.disabled === true}
        title=${model.disabledReason ?? nothing}
        @click=${() => this.selectModel(model.id)}
      >
        <span class="model-picker-model-name">${this.modelLabel(model)}</span>
        ${model.note ? html`<span class="model-picker-model-note">${model.note}</span>` : nothing}
        ${price || context || tools || multiple || model.premium
          ? html`<span class="model-picker-model-meta">
              ${price ? html`<span class="voice-price" title=${price.label}>${price.text}</span>` : nothing}
              ${multiple ? html`<span class="voice-multiple" title=${t('What a short reply costs, compared with the House default')}>${multiple}</span>` : nothing}
              ${context ? html`<span class="voice-context" title=${t('chat.contextTokens', { count: context })}>${context} ctx</span>` : nothing}
              ${tools ? html`<span class="voice-badge ${tools === 'tools' ? 'tools' : 'no-tools'}">${tools}</span>` : nothing}
              ${model.premium ? html`<span class="voice-badge premium" title=${t('A premium voice: it is confirmed once before it is chosen')}>${t('premium')}</span>` : nothing}
            </span>`
          : nothing}
      </button>
    `
  }

  private renderVoiceSearch(): TemplateResult | typeof nothing {
    if (!this.searchableVoices()) return nothing
    return html`
      <div class="model-picker-search">
        <input
          class="model-picker-search-input"
          type="search"
          placeholder=${t('chat.searchVoices', { count: this.models.length })}
          aria-label=${t('Search voices')}
          autocomplete="off"
          spellcheck="false"
          .value=${this.voiceQuery}
          @input=${(event: Event) => {
            this.voiceQuery = (event.target as HTMLInputElement).value
          }}
        />
      </div>
    `
  }

  private renderPinnedVoices(pinned: readonly ChatModelOption[]): TemplateResult | typeof nothing {
    if (pinned.length === 0) return nothing
    return html`
      <div class="model-picker-pinned" role="listbox" aria-label=${t('House default')}>
        <span class="model-picker-group-label" role="presentation">${t('House default')}</span>
        ${pinned.map((model) => this.renderVoiceOption(model))}
      </div>
    `
  }

  private renderVoiceFoot(): TemplateResult | typeof nothing {
    const priced = this.models.some(
      (model) => model.priceInPerMTok !== undefined || model.priceOutPerMTok !== undefined,
    )
    const note = this.accountNote
    if (!priced && !note) return nothing
    return html`
      <div class="model-picker-foot">
        ${priced ? html`<span class="model-picker-foot-caption">${this.voiceFootnote || t('US dollars per million tokens')}</span>` : nothing}
        ${note
          ? html`<span class="model-picker-foot-account" title=${note.hint ?? nothing}>${[note.label, note.value].filter(Boolean).join(' ')}</span>`
          : nothing}
      </div>
    `
  }

  private renderVoiceBrowse(groups: readonly VoiceGroup[], activeProvider: string | null): TemplateResult {
    const activeModels = groups.find((group) => group.provider === activeProvider)?.models ?? []
    return html`
      <div class="model-picker-body">
        <div class="model-picker-providers" role="group" aria-label=${t('Model providers')}>
          ${groups.map((group) => {
            const hasSelection = group.models.some((model) => model.id === this.currentModel)
            const isActive = group.provider === activeProvider
            return html`
              <button
                class="model-picker-provider ${isActive ? 'active' : ''} ${hasSelection ? 'has-selection' : ''}"
                data-model-provider=${group.provider}
                data-count=${String(group.models.length)}
                aria-label="${group.provider} models${hasSelection ? ' (current)' : ''}"
                aria-pressed="${isActive ? 'true' : 'false'}"
                @mouseenter=${() => {
                  this.hoveredProvider = group.provider
                }}
                @focus=${() => {
                  this.hoveredProvider = group.provider
                }}
                @click=${() => {
                  this.hoveredProvider = group.provider
                }}
              >
                ${group.provider}
              </button>
            `
          })}
        </div>
        <div class="model-picker-models" role="listbox" aria-label=${t('Models')}>
          ${activeModels.map((model) => this.renderVoiceOption(model))}
        </div>
      </div>
    `
  }

  /** Search results are one list, grouped by maker, across the whole catalogue. */
  private renderVoiceResults(
    query: string,
    groups: readonly VoiceGroup[],
    pinnedCount: number,
  ): TemplateResult | typeof nothing {
    if (groups.length === 0) {
      // A House match is already showing above; only a true miss says so.
      return pinnedCount > 0
        ? nothing
        : html`
            <div class="model-picker-body search">
              <div class="model-picker-empty" role="status">${t('chat.noVoices', { query })}</div>
            </div>
          `
    }
    return html`
      <div class="model-picker-body search">
        <div class="model-picker-models" role="listbox" aria-label=${t('Matching voices')}>
          ${groups.map((group) => html`
            <div class="model-picker-result-group" role="group" aria-label=${group.provider}>
              <span class="model-picker-group-label" role="presentation">${group.provider}</span>
              ${group.models.map((model) => this.renderVoiceOption(model))}
            </div>
          `)}
        </div>
      </div>
    `
  }

  private renderModelSelector(): TemplateResult | typeof nothing {
    if (this.models.length === 0) return nothing
    const locked = this.isModelLocked()
    const query = this.activeVoiceQuery()
    const pinned = this.pinnedVoices(query)
    return html`
      <div
        class="model-dropdown model-selector ${this.modelPickerOpen ? 'open' : ''}"
        @keydown=${(event: KeyboardEvent) => this.modelPickerKeyDown(event)}
      >
        <button
          class="model-selector-trigger ${locked ? 'locked' : ''}"
          @click=${() => this.openModelPicker()}
          aria-label=${t('chat.voice', { name: this.currentModelLabel() })}
          aria-haspopup="dialog"
          aria-expanded="${this.modelPickerOpen ? 'true' : 'false'}"
          ?disabled=${locked}
          title="${locked ? t('The voice is fixed once a conversation begins') : t('Choose a voice')}"
        >
          <span class="model-name">${this.currentModelLabel()}</span>
          ${locked
            ? html`<span class="model-lock" aria-hidden="true">▣</span>`
            : html`<span class="chevron" aria-hidden="true">v</span>`}
        </button>
        ${this.modelPickerOpen && !locked
          ? html`
              <div
                class="model-picker-backdrop"
                aria-hidden="true"
                @click=${() => this.closeModelPicker(true)}
              ></div>
              <div
                class="model-picker model-picker-sheet"
                role="dialog"
                aria-modal=${this.isCompactViewport() ? 'true' : 'false'}
                aria-label=${t('Choose a voice')}
              >
                <div class="model-picker-head">
                  <strong>${t('Choose a voice')}</strong>
                  <button
                    class="model-picker-close"
                    type="button"
                    aria-label=${t('Close voice picker')}
                    @click=${() => this.closeModelPicker(true)}
                  >
                    ×
                  </button>
                </div>
                ${this.renderPremiumConfirm()}
                ${this.renderVoiceSearch()}
                ${this.renderPinnedVoices(pinned)}
                ${query
                  ? this.renderVoiceResults(query, this.voiceSearchGroups(query), pinned.length)
                  : this.renderVoiceBrowse(this.modelGroups(), this.activeModelProvider())}
                ${this.renderVoiceFoot()}
              </div>
            `
          : nothing}
      </div>
    `
  }

  /** The host's account line (the credit balance) beside the picker. */
  private renderAccountNote(): TemplateResult | typeof nothing {
    const note = this.accountNote
    if (!note) return nothing
    const action = note.action
    return html`
      <span
        class="account-note ${note.tone ?? ''}"
        data-account-note
        title=${note.hint ?? nothing}
      >
        ${note.label ? html`<span class="account-note-label">${note.label}</span>` : nothing}
        ${note.value ? html`<span class="account-note-value">${note.value}</span>` : nothing}
        ${action && this.onAccountAction
          ? html`<button
              class="account-note-action"
              type="button"
              data-account-action=${action.id}
              @click=${() => this.onAccountAction?.(action.id)}
            >${action.label}</button>`
          : nothing}
      </span>
    `
  }

  private headerAction(action: HeaderActionKind): void {
    if (this.headerMenuOpen) this.closeHeaderMenu(true)
    void this.onHeaderAction?.(action)
  }

  private toggleHeaderMenu(): void {
    this.headerMenuOpen = !this.headerMenuOpen
    if (this.headerMenuOpen) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>('.header-actions-menu button:not(:disabled)')?.focus()
      })
    }
  }

  private closeHeaderMenu(returnFocus = false): void {
    this.headerMenuOpen = false
    if (returnFocus) {
      void this.updateComplete.then(() => {
        this.querySelector<HTMLButtonElement>('.compact-actions-trigger')?.focus()
      })
    }
  }

  private renderHeaderActionButton(
    action: HeaderActionKind,
    label: string,
    symbol: string,
    options: { compact?: boolean; disabled?: boolean; danger?: boolean } = {},
  ): TemplateResult {
    const compact = options.compact === true
    return html`
      <button
        class="${compact ? 'header-action-menu-item' : 'icon-button'} ${options.danger ? 'danger' : ''}"
        data-header-action=${action}
        role=${compact ? 'menuitem' : nothing}
        @click=${() => this.headerAction(action)}
        title=${localizeLabel(label)}
        aria-label=${localizeLabel(label)}
        ?disabled=${options.disabled}
      >
        <span class="header-action-symbol" aria-hidden="true">${symbol}</span>
        ${compact ? html`<span>${localizeLabel(label)}</span>` : nothing}
      </button>
    `
  }

  private renderHeaderActions(): TemplateResult | typeof nothing {
    if (!this.onHeaderAction) return nothing
    const presentationAction: HeaderActionKind = this.presentation === 'fullscreen' ? 'restore' : 'popout'
    const presentationLabel = this.presentation === 'fullscreen'
      ? 'Return conversation to sidebar'
      : 'Expand conversation'
    const presentationSymbol = this.presentation === 'fullscreen' ? '↙' : '⇱'
    // The buttons the host can honour, in their fixed order. The wide row and the
    // compact menu draw the same list, so neither can offer what the other hides.
    const entries: Array<{
      action: HeaderActionKind
      label: string
      symbol: string
      options: { disabled?: boolean; danger?: boolean }
    }> = []
    if (this.headerActionAllowed('save-garden')) {
      entries.push({ action: 'save-garden', get label() { return t('Save chat to Garden') }, symbol: '▣', options: { disabled: this.messages.length === 0 } })
    }
    if (this.headerActionAllowed('refresh')) {
      entries.push({ action: 'refresh', get label() { return t('Refresh messages') }, symbol: '↻', options: {} })
    }
    if (this.streaming && this.headerActionAllowed('stop')) {
      entries.push({ action: 'stop', get label() { return t('Stop generating') }, symbol: '■', options: { danger: true } })
    }
    if (this.headerActionAllowed(presentationAction)) {
      entries.push({ action: presentationAction, label: presentationLabel, symbol: presentationSymbol, options: {} })
    }
    if (entries.length === 0) return nothing
    return html`
      <div class="header-right">
        <div class="header-actions-wide">
          ${entries.map(entry => this.renderHeaderActionButton(entry.action, entry.label, entry.symbol, entry.options))}
        </div>
        <div class="compact-header-actions">
          <button
            class="compact-actions-trigger"
            type="button"
            aria-label=${t('More chat actions')}
            aria-haspopup="menu"
            aria-expanded=${this.headerMenuOpen ? 'true' : 'false'}
            @click=${() => this.toggleHeaderMenu()}
          >
            <span aria-hidden="true">•••</span>
          </button>
          ${this.headerMenuOpen
            ? html`
                <div class="header-actions-menu" role="menu" aria-label=${t('Chat actions')}>
                  ${entries.map(entry => this.renderHeaderActionButton(entry.action, entry.label, entry.symbol, { ...entry.options, compact: true }))}
                </div>
              `
            : nothing}
        </div>
      </div>
    `
  }

  private selectComposerControl(control: ChatComposerControl, option: ChatComposerControlOption): void {
    if (control.disabled || option.disabled || option.id === control.value) return
    this.onComposerControlChange?.({
      controlId: control.id,
      value: option.id,
      control,
      option,
    })
  }

  private renderComposerControls(): TemplateResult | typeof nothing {
    if (this.composerControls.length === 0) return nothing
    return html`
      <div class="composer-controls" aria-label=${t('Chat controls')}>
        ${this.composerControls.map((control) => html`
          <div
            class="composer-control-group ${control.disabled ? 'disabled' : ''}"
            role="group"
            aria-label=${control.label}
            data-control-id=${control.id}
          >
            <span class="composer-control-label">${control.label}</span>
            <div class="composer-control-options">
              ${control.options.map((option) => {
                const selected = option.id === control.value
                const disabled = control.disabled || option.disabled === true
                return html`
                  <button
                    class="composer-control-option ${selected ? 'selected' : ''}"
                    type="button"
                    data-control-option=${option.id}
                    aria-pressed=${selected ? 'true' : 'false'}
                    title=${option.description ?? option.label}
                    ?disabled=${disabled}
                    @click=${() => this.selectComposerControl(control, option)}
                  >
                    ${option.label}
                  </button>
                `
              })}
            </div>
          </div>
        `)}
      </div>
    `
  }

  private promptOptionKey(option: ChatPromptOption, index: number): string {
    return option.id ?? `${index}:${option.label}`
  }

  private promptOptionValue(option: ChatPromptOption): string {
    return (option.compose ?? option.label).trim()
  }

  private promptSelection(promptId: string): Set<string> {
    return this.promptSelections.get(promptId) ?? new Set<string>()
  }

  private setPromptSelection(promptId: string, next: Set<string>): void {
    const selections = new Map(this.promptSelections)
    selections.set(promptId, next)
    this.promptSelections = selections
  }

  private promptDraft(promptId: string): string {
    return this.promptDrafts.get(promptId) ?? ''
  }

  private setPromptDraft(promptId: string, value: string): void {
    const drafts = new Map(this.promptDrafts)
    if (value.trim()) drafts.set(promptId, value)
    else drafts.delete(promptId)
    this.promptDrafts = drafts
  }

  private usePromptOption(prompt: ChatPromptCard, option: ChatPromptOption, index: number): void {
    if (option.disabled) return
    const mode = prompt.mode ?? 'compose'
    const value = this.promptOptionValue(option)
    if (mode === 'collect') {
      const key = this.promptOptionKey(option, index)
      if (prompt.multi) {
        const next = new Set(this.promptSelection(prompt.id))
        next.has(key) ? next.delete(key) : next.add(key)
        this.setPromptSelection(prompt.id, next)
      } else {
        this.setPromptSelection(prompt.id, new Set([key]))
      }
      return
    }

    this.setDraft(value, null, 'edit')
    this.onPromptOptionUse?.({ promptId: prompt.id, prompt, option, value })
    void this.updateComplete.then(() => {
      this.composerElement()?.focus()
    })
  }

  private promptAnswers(prompt: ChatPromptCard): string[] {
    const selected = this.promptSelection(prompt.id)
    const answers = prompt.options
      .map((option, index) => ({ option, key: this.promptOptionKey(option, index) }))
      .filter(({ key }) => selected.has(key))
      .map(({ option }) => this.promptOptionValue(option))
      .filter(Boolean)
    const draft = this.promptDraft(prompt.id).trim()
    if (draft) answers.push(draft)
    return answers
  }

  private submitPrompt(prompt: ChatPromptCard): void {
    const answers = this.promptAnswers(prompt)
    if (answers.length === 0) return
    this.onPromptSubmit?.({
      promptId: prompt.id,
      prompt,
      answers,
      summary: answers.join(' '),
    })
  }

  private renderPromptCard(prompt: ChatPromptCard): TemplateResult {
    const mode = prompt.mode ?? 'compose'
    const selected = this.promptSelection(prompt.id)
    const hasPreview = prompt.options.some((option) => option.preview)
    const answers = this.promptAnswers(prompt)
    return html`
      <section class="prompt-card" data-prompt-id=${prompt.id}>
        <div class="prompt-card-head">
          ${prompt.header ? html`<span class="prompt-card-kicker">${prompt.header}</span>` : nothing}
          ${prompt.options.length > 1
            ? html`<span class="prompt-card-count">${prompt.multi ? 'multiple' : 'choose one'}</span>`
            : nothing}
        </div>
        <div class="prompt-card-question">${prompt.question}</div>
        <div class="prompt-card-options ${hasPreview ? 'has-preview' : ''}">
          ${prompt.options.map((option, index) => {
            const key = this.promptOptionKey(option, index)
            const isSelected = selected.has(key)
            return html`
              <button
                class="prompt-option ${isSelected ? 'selected' : ''}"
                type="button"
                data-prompt-option=${key}
                aria-pressed=${isSelected ? 'true' : 'false'}
                ?disabled=${option.disabled}
                @click=${() => this.usePromptOption(prompt, option, index)}
              >
                <span class="prompt-option-copy">
                  <span class="prompt-option-label">${option.label}</span>
                  ${option.description
                    ? html`<span class="prompt-option-description">${option.description}</span>`
                    : nothing}
                </span>
                ${option.preview ? html`<pre class="prompt-option-preview">${option.preview}</pre>` : nothing}
              </button>
            `
          })}
        </div>
        ${mode === 'collect'
          ? html`
              <div class="prompt-freeform">
                <textarea
                  class="prompt-freeform-input"
                  rows="1"
                  placeholder=${prompt.freeformPlaceholder ?? t('Answer in your own words...')}
                  .value=${this.promptDraft(prompt.id)}
                  @input=${(event: Event) => {
                    this.setPromptDraft(prompt.id, (event.target as HTMLTextAreaElement).value)
                  }}
                ></textarea>
                <button
                  class="prompt-submit"
                  type="button"
                  ?disabled=${answers.length === 0}
                  @click=${() => this.submitPrompt(prompt)}
                >
                  ${prompt.submitLabel ?? 'Use answer'}
                </button>
              </div>
            `
          : nothing}
      </section>
    `
  }

  private renderPromptCards(): TemplateResult | typeof nothing {
    if (this.promptCards.length === 0) return nothing
    return html`
      <div class="prompt-card-stack" aria-label=${t('Assistant questions')}>
        ${this.promptCards.map((prompt) => this.renderPromptCard(prompt))}
      </div>
    `
  }

  private renderEmptyState(): TemplateResult {
    const suggestions = this.emptySuggestions
    return html`
      <div class="empty-state">
        <div class="empty-icon">${this.emptyIcon}</div>
        <p class="empty-eyebrow">${t('chat.conversationWith', { name: this.assistantLabel })}</p>
        <h3 class="empty-title">${localizeLabel(this.emptyTitle)}</h3>
        <p class="empty-description">${localizeLabel(this.emptyDescription)}</p>
        ${suggestions.length > 0
          ? html`<div class="empty-suggestions">
          ${suggestions.map(
            (suggestion) => html`
              <button
                class="suggestion-btn"
                data-suggestion-id=${suggestion.id ?? suggestion.label}
                ?disabled=${this.effectiveConversationState() !== 'ready' || this.readOnly}
                @click=${() => this.useSuggestion(suggestion)}
              >
                <span class="suggestion-icon" aria-hidden="true">${suggestion.icon ?? '•'}</span>
                <span>${suggestion.label}</span>
              </button>
            `,
          )}
        </div>`
          : nothing}
      </div>
    `
  }

  private effectiveConversationState(): ChatConnectionState {
    return this.conversationState ?? this.connectionState
  }

  private connectionBlocksSend(): boolean {
    return this.effectiveConversationState() !== 'ready'
  }

  private composerPlaceholderText(): string {
    if (this.readOnly) return t('This chat is read-only.')
    if (this.sendState === 'saving') return 'Sending your message…'
    if (this.sendState === 'uncertain') return 'Check message status before sending again.'
    switch (this.effectiveConversationState()) {
      case 'loading':
        return t('Loading conversation…')
      case 'reconnecting':
        return 'Reconnecting to Sophia…'
      case 'offline':
        return 'Reconnect to send a message.'
      case 'error':
        return 'Retry loading the conversation to send.'
      case 'ready':
      default:
        return this.composerPlaceholder
    }
  }

  private composerGuidanceText(): string {
    if (this.readOnly) return 'Read-only conversation'
    if (this.sendState === 'saving') return 'Sending…'
    if (this.sendState === 'uncertain') return 'Check status before sending again'
    if (this.effectiveConversationState() !== 'ready') return 'Available when the conversation is ready'
    if (this.sendDisabled) return 'Sending is unavailable'
    if (this.streaming && this.steerWhileStreaming) return `Enter steers ${this.assistantLabel} while it is responding`
    if (this.streaming) return `${this.assistantLabel} is responding`
    return 'Enter sends · Shift+Enter adds a line'
  }

  private continuityAction(action: ChatContinuityAction): void {
    void this.onContinuityAction?.(action)
  }

  /** Render one honest conversation-readiness surface. The host supplies state and copy;
   * this face only maps it to the shared continuity vocabulary and retry intent. */
  private renderConnectionContinuity(): TemplateResult | typeof nothing {
    if (this.readOnly) {
      return html`
        <div class="connection-banner readonly" role="status">
          <span>${this.error ?? t('This chat is read-only.')}</span>
          ${this.onSessionAction
            ? html`
                <button class="banner-action" type="button" @click=${() => this.sessionAction({ type: 'new' })}>
                  ${t('New chat')}
                </button>
              `
            : nothing}
        </div>
      `
    }

    const state = this.effectiveConversationState()
    if (state === 'ready') {
      return this.error
        ? html`<div class="connection-banner error" data-state="error" role="alert"><span>${this.error}</span></div>`
        : nothing
    }

    const copy = state === 'loading'
      ? { get label() { return t('Loading conversation…') }, detail: 'Opening your saved messages.' }
      : state === 'reconnecting'
        ? { get label() { return t('Reconnecting…') }, detail: 'Your conversation is still here.' }
        : state === 'offline'
          ? { get label() { return t('You’re offline.') }, detail: 'Your conversation is still here.' }
          : { label: this.error ?? 'Conversation couldn’t load.', detail: 'Your current view is still here.' }
    const recoveryAction: ChatContinuityAction | null = state === 'error'
      ? { type: 'retry-load' }
      : state === 'offline'
        ? { type: 'retry-connection' }
        : null

    return html`
      <div
        class="connection-banner continuity ${state}"
        data-state=${state}
        data-progress=${state === 'loading' || state === 'reconnecting' ? 'true' : 'false'}
        role=${state === 'error' ? 'alert' : 'status'}
        aria-live=${state === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy=${state === 'loading' || state === 'reconnecting' ? 'true' : 'false'}
      >
        <span class="continuity-indicator" aria-hidden="true"></span>
        <span class="continuity-copy">
          <strong>${copy.label}</strong>
          <span>${copy.detail}</span>
        </span>
        ${recoveryAction && this.onContinuityAction
          ? html`
              <button
                class="banner-action"
                type="button"
                @click=${() => this.continuityAction(recoveryAction)}
              >
                ${state === 'error' ? 'Retry load' : t('Retry')}
              </button>
            `
          : nothing}
      </div>
    `
  }

  /** The slot above the composer (a refusal for credit, the size limit, the heads-up that
   * credits are starting). It renders what the host projects and gates nothing itself. A
   * control is drawn only where the host listens: a button that goes nowhere is dead UI. */
  private renderComposerNotice(): TemplateResult | typeof nothing {
    const notice = this.composerNotice
    if (!notice) return nothing
    const listening = this.onComposerNoticeAction !== undefined
    const action = listening ? notice.action : undefined
    const dismiss = listening ? notice.dismiss : undefined
    return html`
      <div
        class="composer-notice ${notice.tone}"
        data-notice-id=${notice.id}
        role=${notice.tone === 'blocked' ? 'alert' : 'status'}
      >
        <span class="composer-notice-copy">
          <strong>${notice.title}</strong>
          ${notice.body ? html`<span>${notice.body}</span>` : nothing}
          ${notice.detail ? html`<span class="composer-notice-detail">${notice.detail}</span>` : nothing}
        </span>
        ${action || dismiss
          ? html`<span class="composer-notice-actions">
              ${action
                ? html`<button
                    class="banner-action"
                    type="button"
                    @click=${() => this.onComposerNoticeAction?.(action.id)}
                  >${action.label}</button>`
                : nothing}
              ${dismiss
                ? html`<button
                    class="banner-action banner-dismiss"
                    type="button"
                    data-notice-dismiss
                    aria-label=${`${dismiss.label}: ${notice.title}`}
                    @click=${() => this.onComposerNoticeAction?.(dismiss.id)}
                  >${dismiss.label}</button>`
                : nothing}
            </span>`
          : nothing}
      </div>
    `
  }

  private renderSendContinuity(): TemplateResult | typeof nothing {
    if (this.sendState === 'ready') return nothing
    const unsettled = this.sendState === 'error' || this.sendState === 'uncertain'
    const canResubmit = this.sendState === 'error' && this.sendRecovery === 'resubmit'
    const canReconcile = this.sendState === 'uncertain' && this.sendRecovery === 'reconcile'
    return html`
      <div
        class="send-continuity ${this.sendState}"
        data-state=${this.sendState}
        data-progress=${this.sendState === 'saving' ? 'true' : 'false'}
        role=${unsettled ? 'alert' : 'status'}
        aria-live=${unsettled ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy=${this.sendState === 'saving' ? 'true' : 'false'}
      >
        <span class="continuity-indicator" aria-hidden="true"></span>
        <span>${this.sendState === 'saving'
          ? 'Sending message…'
          : this.sendState === 'uncertain'
            ? (this.sendError ?? 'Message status is uncertain.')
            : (this.sendError ?? 'Message wasn’t sent.')}</span>
        ${(canResubmit || canReconcile) && this.onContinuityAction
          ? html`
              <button
                class="send-retry"
                type="button"
                @click=${() => this.continuityAction(
                  canReconcile ? { type: 'reconcile-turn' } : { type: 'retry-send' },
                )}
              >
                ${canReconcile ? 'Check status' : 'Retry send'}
              </button>
            `
          : nothing}
        ${unsettled && this.onSessionAction
          ? html`
              <button
                class="send-retry send-new-chat"
                type="button"
                title=${t('Leave this conversation and start a fresh one')}
                @click=${() => this.sessionAction({ type: 'new' })}
              >
                ${t('New chat')}
              </button>
            `
          : nothing}
      </div>
    `
  }

  private formatSeamDate(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    try {
      return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return ''
    }
  }

  /** "{n} earlier messages not included · open the original": what the window
   * left out, said once, above the window. */
  private renderWindowNote(seam: ChatSeam): TemplateResult {
    const omitted = Math.max(0, Math.trunc(seam.omittedCount))
    const said = omitted === 0
      ? 'The whole conversation is included'
      : omitted === 1
        ? '1 earlier message not included'
        : `${omitted.toLocaleString()} earlier messages not included`
    return html`
      <div class="window-note" role="note" data-window-omitted=${String(omitted)}>
        <span>${said}</span>
        ${this.onSeamAction
          ? html`<span aria-hidden="true">·</span>
            <button
              class="window-open-original"
              type="button"
              @click=${() => this.onSeamAction?.({ type: 'open-original' })}
            >${t('open the original')}</button>`
          : nothing}
      </div>
    `
  }

  /** The seam: where the earlier conversation ends and this one begins, dated and
   * naming the voice that picked it up, with the one line about where it went. */
  private renderSeam(seam: ChatSeam): TemplateResult {
    const date = this.formatSeamDate(seam.pickedUpAt)
    const line = `— ${date ? `${date} · ` : ''}picked up with ${seam.voiceLabel} —`
    return html`
      <div class="seam" data-seam>
        <span class="seam-line">${line}</span>
        ${seam.providerNotice
          ? html`<span class="seam-notice" role="note">${seam.providerNotice}</span>`
          : nothing}
      </div>
    `
  }

  private renderSeamedConversation(seam: ChatSeam): TemplateResult[] {
    const carried = this.messages.filter((message) => this.isWindowMessage(message))
    const spoken = this.messages.filter((message) => !this.isWindowMessage(message))
    return [
      this.renderWindowNote(seam),
      ...carried.map((message) => this.renderMessage(message)),
      this.renderSeam(seam),
      ...spoken.map((message) => this.renderMessage(message)),
    ]
  }

  private renderConversationBody(): TemplateResult | TemplateResult[] {
    if (this.messages.length === 0 && this.effectiveConversationState() === 'loading') {
      return html`
        <div class="conversation-loading" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      `
    }
    if (this.seam) return this.renderSeamedConversation(this.seam)
    return this.messages.length === 0
      ? this.renderEmptyState()
      : this.messages.map((msg) => this.renderMessage(msg))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROOT RENDER
  // ─────────────────────────────────────────────────────────────────────────

  /** A finished conversation shown alone (see `transcriptOnly`): the transcript and
   * nothing else. No chrome, no composer, no banner, no scroll-to-the-end. */
  private renderTranscriptOnly(): TemplateResult {
    return html`
      <div class="messages-wrapper" data-chat-viewport data-transcript-only @click=${() => this.closeContextMenu()}>
        <div class="messages-container" data-chat-transcript role="region" tabindex="0" aria-label=${t('Conversation')}>
          ${this.messages.length === 0
            ? html`<p class="transcript-empty">${t('This conversation has no messages to show.')}</p>`
            : this.messages.map((msg) => this.renderMessage(msg))}
        </div>
        ${this.renderMessageContextMenu()}
      </div>
    `
  }

  render(): TemplateResult {
    if (this.transcriptOnly) return this.renderTranscriptOnly()
    const isReadOnly = this.readOnly
    // Send-gating: the kernel only knows draft-empty + streaming + the HOST's
    // sendDisabled + explicit continuity postures. It NEVER computes credit,
    // billing, or transport state itself.
    const composerDisabled = this.sendDisabled
      || isReadOnly
      || this.connectionBlocksSend()
      || this.sendState === 'saving'
      || this.sendState === 'uncertain'
    const draftEmpty = this.draftDetail?.isEmpty ?? !this.draft.trim()
    const sendBtnDisabled = draftEmpty || (this.streaming && !this.steerWhileStreaming) || composerDisabled

    return html`
      <div class="chat-chrome">
        <div class="super-bar">
          <button
            class="super-bar-identity"
            @click=${() => this.sessionAction({ type: 'open-history' })}
            title=${t('Chat history')}
            aria-label=${t('Open chat history')}
          >
            <span class="super-bar-icon" aria-hidden="true">☰</span>
            <span class="super-bar-sophia">${this.assistantLabel}</span>
            <span class="super-bar-sep">—</span>
            <span class="super-bar-chat-title">${this.displaySessionTitle()}</span>
          </button>
          <div class="super-bar-slots" aria-label=${t('Chat sessions')}>${this.renderSuperBarSlots()}</div>
        </div>

        <div class="header">
          <div class="header-left">${this.renderModelSelector()}${this.renderAccountNote()}</div>
          <div class="header-status" role="status">
            ${this.streaming ? html`<span class="status-streaming">${this.streamingHint()}</span>` : nothing}
          </div>
          ${this.renderHeaderActions()}
        </div>
      </div>

      <div class="connection-banner-slot">
        ${this.renderConnectionContinuity()}
      </div>

      <div
        class="messages-wrapper"
        data-chat-viewport
        @click=${() => this.closeContextMenu()}
      >
        <div
          class="messages-container"
          data-chat-transcript
          role="log"
          aria-live="polite"
          aria-busy="${this.streaming || this.sendState === 'saving' ? 'true' : 'false'}"
          aria-label=${t('Chat messages')}
          @wheel=${(event: WheelEvent) => this.handleMessagesWheel(event)}
          @scroll=${() => this.handleMessagesScroll()}
        >
          ${this.renderConversationBody()}
        </div>
        ${this.renderMessageContextMenu()}
        ${!this.autoScroll && this.messages.length > 0
          ? html`
              <button
                class="scroll-to-bottom ${this.hasNewMessages ? 'has-new' : ''}"
                @click=${() => this.scrollToBottomClick()}
                aria-label="${this.hasNewMessages ? t('New messages - scroll to bottom') : t('Scroll to bottom')}"
                title="${this.hasNewMessages ? t('New messages') : t('Scroll to bottom')}"
              >
                <span aria-hidden="true">↓</span>
              </button>
            `
          : nothing}
      </div>

      <div class="composer" data-chat-footer role="group" aria-label=${t('Chat composer')}>
        ${this.renderComposerNotice()}
        ${this.renderPromptCards()}
        ${this.renderComposerControls()}
        ${this.renderSendContinuity()}
        ${this.renderAccessNote()}
        <div class="composer-heading">
          <span class="composer-label">${t('chat.writeTo', { name: this.assistantLabel })}</span>
          <span class="composer-hint">${this.composerGuidanceText()}</span>
        </div>
        <div class="composer-input-wrapper">
          <hoja-editor
            posture="composer"
            .value=${this.draft}
            .valueKey=${this.draftIdentity}
            .referenceBindings=${this.draftDetail?.references ?? []}
            .placeholder=${this.composerPlaceholderText()}
            .label=${t('chat.messageTo', { name: this.assistantLabel })}
            .disabled=${composerDisabled}
            .readOnly=${isReadOnly}
            .resolveWikiLinks=${this.composerReferenceResolver}
            .onChange=${(detail: HojaComposerDetail) => this.handleComposerChange(detail)}
            .onSubmit=${(detail: HojaComposerDetail) => this.send(detail)}
          ></hoja-editor>
          ${this.draftDetail?.isEmpty === false || this.draft.trim()
            ? html`<button
                class="clear-button"
                @click=${() => this.clearDraft()}
                title=${t('Clear message')}
                aria-label=${t('Clear message')}
              >
                ×
              </button>`
            : nothing}
          <button
            class="send-button"
            ?disabled=${sendBtnDisabled}
            @click=${() => this.send(this.draftDetail)}
            title=${this.sendState === 'saving' ? t('Sending message') : t('Send message')}
            aria-label=${this.sendState === 'saving' ? t('Sending message') : t('Send message')}
            aria-busy=${this.sendState === 'saving' ? 'true' : 'false'}
          >
            ${this.sendState === 'saving' ? '…' : '➤'}
          </button>
        </div>
      </div>

    `
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STYLES (relocated + SCRUBBED: EVERY `mn-chat-panel` selector -> `sh-chat-panel`)
  // ─────────────────────────────────────────────────────────────────────────

  static styles = css`
    /* HOST & LAYOUT */
    sh-chat-panel {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      max-height: 100%;
      min-height: 0;
      min-width: 0;
      font-family: var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #ffffff));
      color: var(--mn-color-text-primary, #1a1a1a);
      overflow: hidden;
      overscroll-behavior: none;
      position: relative;
    }

    /* A single panel adopts a roomier reading measure when its shell projects it
       full-screen. No transcript/composer subtree is cloned or reparented. */
    sh-chat-panel[presentation='fullscreen'] .messages-container > * {
      width: min(100%, 54rem);
      margin-inline: auto;
      box-sizing: border-box;
    }

    sh-chat-panel[presentation='fullscreen'] .composer > * {
      width: min(100%, 54rem);
      margin-inline: auto;
      box-sizing: border-box;
    }

    sh-chat-panel[presentation='fullscreen'] .connection-banner-slot > * {
      width: min(100%, 54rem);
      margin-inline: auto;
      box-sizing: border-box;
    }

    sh-chat-panel[presentation='fullscreen'] .scroll-to-bottom {
      right: max(20px, calc((100% - 54rem) / 2 + 20px));
    }

    /* Desktop keeps the established two-row chrome. Compact posture turns this
       same DOM into one adaptive header surface below; no parallel chat face. */
    sh-chat-panel .chat-chrome {
      display: contents;
    }

    /* SUPERBAR */
    sh-chat-panel .super-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      height: 40px;
      flex: 0 0 40px;
      padding: 0 12px;
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 52%, transparent);
      box-sizing: border-box;
      overflow: hidden;
    }

    sh-chat-panel .super-bar-identity {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
      padding: 4px 8px;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }

    sh-chat-panel .super-bar-identity:hover {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.04));
    }

    sh-chat-panel .super-bar-icon {
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-size: 12px;
      flex: 0 0 auto;
    }

    sh-chat-panel .super-bar-sophia {
      flex: 0 0 auto;
      color: var(--mn-color-text-primary, #1a1a1a);
      font-size: 13px;
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-weight: 650;
      letter-spacing: 0.045em;
      text-transform: uppercase;
    }

    sh-chat-panel .super-bar-sep {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-size: 12px;
    }

    sh-chat-panel .super-bar-chat-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 13px;
      font-style: italic;
    }

    sh-chat-panel .super-bar-slots {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
    }

    sh-chat-panel .slot-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 5px;
      background: transparent;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      cursor: pointer;
      font: 11px/1 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .slot-indicator.filled {
      color: var(--mn-color-text-secondary, #6b6b6b);
    }

    sh-chat-panel .slot-indicator.active {
      color: var(--mn-color-text-primary, #1a1a1a);
      border-color: var(--mn-color-border-strong, #cfcfcf);
      background: var(--mn-color-surface-raised, #f5f5f5);
      font-weight: 700;
    }

    sh-chat-panel .slot-indicator:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
      background: color-mix(in srgb, var(--mn-color-surface-panel, #fff) 82%, transparent);
      flex: 0 0 auto;
    }

    sh-chat-panel .header-status {
      font-size: 12px;
      color: var(--mn-color-text-secondary, #6b6b6b);
    }

    sh-chat-panel .header-right {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }

    sh-chat-panel .header-actions-wide {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    sh-chat-panel .compact-header-actions {
      display: none;
      position: relative;
    }

    sh-chat-panel .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--mn-color-text-secondary, #6b6b6b);
      cursor: pointer;
      font: 14px/1 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .icon-button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .icon-button:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-color-accent, #2563eb));
    }

    sh-chat-panel .icon-button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    sh-chat-panel .icon-button.danger {
      color: var(--mn-color-danger, #dc2626);
    }

    sh-chat-panel .header-action-symbol {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1em;
    }

    sh-chat-panel .model-dropdown {
      position: relative;
      display: inline-block;
      max-width: 220px;
    }

    sh-chat-panel .model-selector-trigger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 220px;
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 6px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #6b6b6b);
      cursor: pointer;
      font: 12px/1.2 var(--mn-font-sans, system-ui, sans-serif);
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    sh-chat-panel .model-selector-trigger:hover:not(:disabled) {
      color: var(--mn-color-text-primary, #1a1a1a);
      background: rgba(0, 0, 0, 0.04);
      border-color: var(--mn-color-border-strong, #cfcfcf);
    }

    sh-chat-panel .model-selector-trigger:focus-visible,
    sh-chat-panel .model-picker-provider:focus-visible,
    sh-chat-panel .model-picker-model:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: -2px;
    }

    sh-chat-panel .model-selector-trigger.locked {
      cursor: default;
      opacity: 0.7;
    }

    sh-chat-panel .model-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }

    sh-chat-panel .chevron {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-size: 10px;
      transition: transform 0.16s ease;
    }

    sh-chat-panel .model-dropdown.open .chevron {
      transform: rotate(180deg);
    }

    sh-chat-panel .model-picker {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      min-width: 360px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 8px;
      background: var(--mn-color-surface-raised, #f5f5f5);
      box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.14));
    }

    sh-chat-panel .model-picker-backdrop,
    sh-chat-panel .model-picker-head {
      display: none;
    }

    sh-chat-panel .model-picker-body {
      display: grid;
      grid-template-columns: 132px minmax(180px, 1fr);
      grid-template-rows: minmax(0, 340px);
      min-height: 0;
    }

    sh-chat-panel .model-picker-body.search {
      grid-template-columns: minmax(0, 1fr);
    }

    sh-chat-panel .model-picker-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: 24px/1 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .model-picker-providers {
      overflow-y: auto;
      padding: 6px 0;
      border-right: 1px solid var(--mn-color-border, #e5e5e5);
      background: transparent;
    }

    sh-chat-panel .model-picker-provider {
      display: block;
      width: 100%;
      padding: 10px 14px;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #6b6b6b);
      cursor: pointer;
      font: 12px/1.2 var(--mn-font-sans, system-ui, sans-serif);
      text-align: left;
      transition: background 0.1s ease, color 0.1s ease;
    }

    sh-chat-panel .model-picker-provider:hover,
    sh-chat-panel .model-picker-provider.active {
      background: rgba(0, 0, 0, 0.06);
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .model-picker-provider.has-selection {
      color: var(--mn-color-accent, #2563eb);
      font-weight: 600;
    }

    sh-chat-panel .model-picker-models {
      overflow-y: auto;
      padding: 6px 0;
      background: var(--mn-color-surface-base, #fff);
    }

    sh-chat-panel .model-picker-model {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 2px;
      width: 100%;
      min-height: 34px;
      padding: 8px 14px;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #1a1a1a);
      cursor: pointer;
      font: 13px/1.2 var(--mn-font-sans, system-ui, sans-serif);
      text-align: left;
      transition: background 0.1s ease;
    }

    sh-chat-panel .model-picker-model:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    sh-chat-panel .model-picker-model.selected {
      background: rgba(37, 99, 235, 0.1);
      color: var(--mn-color-accent, #2563eb);
      font-weight: 600;
    }

    sh-chat-panel .model-picker-model-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* MESSAGES */
    sh-chat-panel .messages-wrapper {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      isolation: isolate;
    }

    sh-chat-panel .messages-container {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 20px var(--mn-space-4, 16px) 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--mn-color-accent, #587a69) 2.5%, transparent),
          transparent 180px
        ),
        var(--mn-color-surface-base, #fbfaf7);
    }

    sh-chat-panel .scroll-to-bottom {
      position: absolute;
      right: 20px;
      bottom: 20px;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--mn-color-surface-raised, #f5f5f5);
      color: var(--mn-color-text-secondary, #6b6b6b);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      font: 16px/1 var(--mn-font-sans, system-ui, sans-serif);
      transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
      /* It appears the instant you scroll away from the foot of the
         transcript; without an entrance it reads as a rendering glitch. */
      animation: shChatFabIn var(--mn-transition-normal, 180ms ease) both;
    }

    @keyframes shChatFabIn {
      from {
        opacity: 0;
        transform: translateY(6px) scale(0.92);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    sh-chat-panel .scroll-to-bottom:hover {
      background: var(--mn-color-surface-hover, #ececec);
      color: var(--mn-color-text-primary, #1a1a1a);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transform: scale(1.05);
    }

    sh-chat-panel .scroll-to-bottom:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 2px;
    }

    sh-chat-panel .scroll-to-bottom.has-new {
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
      animation: shChatFabIn var(--mn-transition-normal, 180ms ease) both,
        chatFabPulse 2s ease-in-out infinite;
    }

    sh-chat-panel .scroll-to-bottom.has-new:hover {
      background: var(--mn-color-accent-hover, #1d4ed8);
    }

    @keyframes chatFabPulse {
      0%,
      100% {
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
      }
      50% {
        box-shadow: 0 2px 16px rgba(37, 99, 235, 0.5);
      }
    }

    sh-chat-panel .message {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 100%;
      /* A turn should arrive, not blink into place. Only newly appended
         <article> nodes run this — Lit updates existing rows in place — so a
         streaming edit never re-animates the message it is editing. */
      animation: shChatMessageIn var(--mn-transition-normal, 180ms var(--mn-ease-standard, ease)) both;
    }

    @keyframes shChatMessageIn {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    sh-chat-panel .message.user {
      align-items: flex-end;
    }

    sh-chat-panel .message.assistant {
      align-self: stretch;
    }

    sh-chat-panel .message-byline {
      display: flex;
      width: min(100%, 42rem);
      align-items: center;
      gap: 8px;
      color: var(--mn-color-text-tertiary, #7e7a72);
      font: 650 10px/1.2 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    sh-chat-panel .message.user .message-byline {
      width: min(88%, 36rem);
      justify-content: flex-end;
    }

    sh-chat-panel .message-author {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    sh-chat-panel .message.assistant .message-author::before {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--mn-color-accent, #587a69);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-accent, #587a69) 12%, transparent);
      content: '';
    }

    sh-chat-panel .message-byline-rule {
      width: min(56px, 12vw);
      height: 1px;
      background: color-mix(in srgb, currentColor 24%, transparent);
    }

    sh-chat-panel .message.user .message-byline-rule {
      order: -1;
    }

    sh-chat-panel .message-bubble {
      line-height: 1.65;
      word-break: break-word;
      transition: border-color var(--mn-transition-normal, 180ms ease);
    }

    /* The bubble carried a "streaming" class that no rule ever answered, so a
       live turn looked identical to a finished one. In this layout the
       assistant's identity is its margin rule — so that is what brightens
       while the turn is still arriving, and settles when it lands. */
    sh-chat-panel .message.assistant .message-bubble.streaming {
      border-left-color: var(--mn-color-accent, #587a69);
    }

    sh-chat-panel .message.user .message-bubble.streaming {
      box-shadow: var(--mn-shadow-sm, 0 2px 8px rgba(38, 58, 48, 0.08)),
        0 0 0 2px color-mix(in srgb, var(--mn-color-accent, #587a69) 22%, transparent);
    }

    sh-chat-panel .message.assistant .message-bubble {
      width: min(100%, 42rem);
      padding: 2px 4px 4px 14px;
      border: 0;
      border-left: 2px solid color-mix(in srgb, var(--mn-color-accent, #587a69) 32%, transparent);
      border-radius: 0;
      background: transparent;
      box-sizing: border-box;
    }

    sh-chat-panel .message.user .message-bubble {
      max-width: min(88%, 36rem);
      padding: 10px 15px;
      border-radius: var(--mn-radius-surface, 16px) var(--mn-radius-surface, 16px) 5px var(--mn-radius-surface, 16px);
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
      box-shadow: var(--mn-shadow-sm, 0 2px 8px rgba(38, 58, 48, 0.08));
    }

    sh-chat-panel .message-content {
      font-family: var(--mn-font-prose, Georgia, 'Times New Roman', serif);
      font-size: var(--mn-text-base, 0.9375rem);
      line-height: var(--mn-leading-prose, 1.72);
    }

    sh-chat-panel .message-content .markdown-content > :first-child {
      margin-top: 0;
    }

    sh-chat-panel .message-content .markdown-content > :last-child {
      margin-bottom: 0;
    }

    sh-chat-panel .message-content .markdown-content p {
      margin: 0 0 0.9em;
    }

    sh-chat-panel .message-content .markdown-content :is(h1, h2, h3, h4) {
      margin: 1.25em 0 0.45em;
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-weight: var(--mn-font-weight-semibold, 600);
      letter-spacing: var(--mn-tracking-tight, -0.025em);
      line-height: var(--mn-leading-tight, 1.2);
    }

    /* Assistant prose is the reading surface of the whole panel: give the
       heading run a real scale rather than the browser's h1=2em default, which
       inside a 15px column shouts. */
    sh-chat-panel .message-content .markdown-content h1 { font-size: 1.28em; }
    sh-chat-panel .message-content .markdown-content h2 { font-size: 1.16em; }
    sh-chat-panel .message-content .markdown-content h3 { font-size: 1.06em; }
    sh-chat-panel .message-content .markdown-content h4 { font-size: 1em; }

    /* ── PROSE MARKS ───────────────────────────────────────────────────────
       Scoped to the .markdown-content wrapper that renderContent() emits, so
       one set of rules covers every place the panel renders prose — message
       body, collapsed reasoning, and transcript parts — instead of only the
       message body. The .code-block well is a SIBLING of .markdown-content,
       never a descendant, so it keeps its own chrome below. */

    /* Links were inheriting body colour — indistinguishable from prose, and
       inside the accent-filled user bubble the UA blue was near-illegible. */
    sh-chat-panel .markdown-content a {
      color: var(--mn-color-text-link, #3730a3);
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 0.16em;
      transition: color var(--mn-transition-fast, 110ms ease);
    }

    sh-chat-panel .markdown-content a:hover {
      color: var(--mn-color-text-link-hover, #1e1b4b);
    }

    sh-chat-panel .markdown-content a:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #587a69));
      outline-offset: 2px;
      border-radius: var(--mn-radius-sm, 2px);
    }

    sh-chat-panel .markdown-content strong {
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .markdown-content em {
      font-style: italic;
    }

    /* Browser default is a 40px indent that fights the 14px rule gutter of the
       assistant column. Pull lists onto the same rhythm as the prose. */
    sh-chat-panel .markdown-content :is(ul, ol) {
      margin: var(--mn-space-3, 12px) 0;
      padding-left: var(--mn-space-5, 20px);
    }

    sh-chat-panel .markdown-content li {
      margin-bottom: var(--mn-space-1, 4px);
    }

    sh-chat-panel .markdown-content li > :is(ul, ol) {
      margin: var(--mn-space-1, 4px) 0;
    }

    sh-chat-panel .markdown-content blockquote {
      margin: var(--mn-space-3, 12px) 0;
      padding-left: var(--mn-space-4, 16px);
      border-left: 2px solid var(--mn-color-border-accent, var(--mn-color-accent, #587a69));
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-style: italic;
    }

    sh-chat-panel .markdown-content hr {
      margin: var(--mn-space-4, 16px) 0;
      border: 0;
      border-top: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #e5e5e5));
    }

    /* GFM tables are on; without this they render as unaligned bare text. */
    sh-chat-panel .markdown-content table {
      display: block;
      max-width: 100%;
      margin: var(--mn-space-3, 12px) 0;
      overflow-x: auto;
      border-collapse: collapse;
      font-size: var(--mn-text-sm, 0.8125rem);
    }

    sh-chat-panel .markdown-content :is(th, td) {
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #e5e5e5));
      text-align: left;
    }

    sh-chat-panel .markdown-content th {
      background: var(--mn-color-surface-subtle, #f7f5f0);
      font-family: var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .message-content pre,
    sh-chat-panel .markdown-content pre {
      overflow-x: auto;
      background: var(--mn-color-surface-sunken, #f1efe9);
      padding: var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-lg, 8px);
    }

    /* Inline code was font-only — a monospace run with no chip, so it read as
       a font accident rather than a marked token. */
    sh-chat-panel .markdown-content code {
      padding: 0.1em 0.32em;
      border-radius: var(--mn-radius-sm, 2px);
      background: var(--mn-color-surface-sunken, #f1efe9);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.9em;
    }

    sh-chat-panel .message-content code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.9em;
    }

    /* …but a fenced block must not wear the chip inside its own well. */
    sh-chat-panel .markdown-content pre code {
      padding: 0;
      border-radius: 0;
      background: none;
      color: inherit;
    }

    /* The user bubble is an accent field: prose marks must invert against it
       instead of falling back to the light-surface roles. */
    sh-chat-panel .message.user .message-content a {
      color: var(--mn-color-text-on-accent, #fff);
      text-decoration-color: color-mix(in srgb, var(--mn-color-text-on-accent, #fff) 55%, transparent);
    }

    sh-chat-panel .message.user .message-content a:hover {
      color: var(--mn-color-text-on-accent, #fff);
      text-decoration-color: var(--mn-color-text-on-accent, #fff);
    }

    sh-chat-panel .message.user .message-content :is(code, pre) {
      background: color-mix(in srgb, var(--mn-color-text-on-accent, #fff) 18%, transparent);
      color: inherit;
    }

    sh-chat-panel .message.user .message-content blockquote {
      border-left-color: color-mix(in srgb, var(--mn-color-text-on-accent, #fff) 45%, transparent);
      color: inherit;
    }

    sh-chat-panel .message.user .message-content :is(th, td) {
      border-color: color-mix(in srgb, var(--mn-color-text-on-accent, #fff) 32%, transparent);
    }

    sh-chat-panel .message.user .message-content th {
      background: color-mix(in srgb, var(--mn-color-text-on-accent, #fff) 14%, transparent);
    }

    sh-chat-panel .transcript-part {
      --transcript-accent: var(--mn-color-accent, #2563eb);
      margin: 10px 0;
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .transcript-part.data {
      --transcript-accent: #0f766e;
    }

    sh-chat-panel .transcript-part.done {
      --transcript-accent: #7c5800;
    }

    sh-chat-panel .transcript-part.terminal {
      --transcript-accent: #475569;
    }

    sh-chat-panel .transcript-part.warning {
      --transcript-accent: #b45309;
    }

    sh-chat-panel .transcript-divider {
      display: grid;
      grid-template-columns: auto auto minmax(16px, 1fr);
      align-items: center;
      gap: 7px;
      margin: 4px 0 5px;
    }

    sh-chat-panel .transcript-knot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--transcript-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--transcript-accent) 14%, transparent);
    }

    sh-chat-panel .transcript-title {
      color: var(--transcript-accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: lowercase;
      white-space: nowrap;
    }

    sh-chat-panel .transcript-line {
      height: 1px;
      background: color-mix(in srgb, var(--transcript-accent) 24%, transparent);
    }

    sh-chat-panel .transcript-body {
      margin-left: 3px;
      padding-left: 14px;
      border-left: 1px solid color-mix(in srgb, var(--transcript-accent) 24%, transparent);
    }

    sh-chat-panel .transcript-body .markdown-content > :first-child {
      margin-top: 0;
    }

    sh-chat-panel .transcript-body .markdown-content > :last-child {
      margin-bottom: 0;
    }

    sh-chat-panel .transcript-json {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      padding: 9px;
      border: 1px solid color-mix(in srgb, var(--transcript-accent) 26%, var(--mn-color-border, #e5e5e5));
      border-radius: 6px;
      background: color-mix(in srgb, var(--transcript-accent) 5%, var(--mn-color-surface-subtle, #f8f8f8));
      color: var(--mn-color-text-primary, #1a1a1a);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    /* Metadata is not prose. Left in the inherited serif reading face, the
       timestamp read as part of the message; the utility face plus tabular
       figures makes it recede and stop jittering as the minute ticks over. */
    sh-chat-panel .message-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: 8px;
      row-gap: 2px;
      width: min(100%, 42rem);
      padding-left: 16px;
      font-family: var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      box-sizing: border-box;
    }

    /* The line wraps between its pieces, never inside one ("11:10 PM" over two lines reads as two things). */
    sh-chat-panel .message-meta > :is(.message-time, .message-voice, .message-annotation) {
      white-space: nowrap;
    }

    sh-chat-panel .message.user .message-meta {
      width: min(88%, 36rem);
      justify-content: flex-end;
      padding-right: 2px;
      padding-left: 0;
    }

    sh-chat-panel .message-actions {
      display: flex;
      gap: 4px;
    }

    /* Three glyphs under every assistant turn is a lot of furniture in a long
       transcript. Where there is a real pointer, hold them back until the turn
       is hovered or something inside it takes focus; where there is no hover
       (touch) they stay put, because there is no way to summon them. Kept out
       of the DOM-visibility path deliberately — the buttons remain focusable
       and announced, they are only visually quiet. */
    @media (hover: hover) and (pointer: fine) {
      sh-chat-panel .message-actions {
        opacity: 0;
        transition: opacity var(--mn-transition-fast, 110ms ease);
      }

      sh-chat-panel .message:hover .message-actions,
      sh-chat-panel .message:focus-within .message-actions {
        opacity: 1;
      }
    }

    sh-chat-panel .message-action-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: inherit;
      padding: 2px 4px;
      border-radius: var(--mn-radius-default, 4px);
      transition: background var(--mn-transition-fast, 110ms ease), color var(--mn-transition-fast, 110ms ease);
    }

    sh-chat-panel .message-action-btn:hover {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .message-action-btn.message-action-branch {
      font-size: 0.75rem;
    }

    sh-chat-panel .message-action-btn.copied {
      color: var(--mn-color-success, #16a34a);
      background: var(--mn-color-success-surface, color-mix(in srgb, var(--mn-color-success, #16a34a) 8%, transparent));
    }

    /* A failed turn is an event in the transcript, not a red word floating in
       the prose column: give it a bounded, tinted field so it reads as a
       distinct object the eye can skip past or stop on. */
    sh-chat-panel .message-error {
      margin-top: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-danger-border, color-mix(in srgb, var(--mn-color-danger, #dc2626) 30%, transparent));
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #dc2626) 7%, transparent));
      color: var(--mn-color-text-danger, var(--mn-color-danger, #dc2626));
      font-family: var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-size: var(--mn-text-sm, 0.8125rem);
      line-height: var(--mn-leading-ui, 1.4);
    }

    sh-chat-panel .placeholder {
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-style: italic;
    }

    /* CODE BLOCKS */
    sh-chat-panel .code-block {
      margin: var(--mn-space-3, 12px) 0;
      border-radius: var(--mn-radius-lg, 8px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      background: var(--mn-color-surface-sunken, #f1efe9);
    }

    sh-chat-panel .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #e5e5e5));
      background: var(--mn-color-surface-subtle, #f7f5f0);
    }

    /* The fenced block already owns a bordered, rounded, filled well. Without
       this reset the inner <pre> inherits .message-content pre's own fill +
       radius + padding and draws a second rounded box inside the first — a
       visible seam and doubled inset on every code block. */
    sh-chat-panel .code-block pre {
      margin: 0;
      padding: var(--mn-space-3, 12px);
      border-radius: 0;
      background: transparent;
      overflow-x: auto;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: var(--mn-leading-ui, 1.4);
    }

    /* A language tag is a label, not prose: set it as one so it reads as
       metadata at a glance and stops competing with the code itself. */
    sh-chat-panel .code-lang-badge {
      color: var(--mn-color-text-tertiary, #6f6a62);
      font-family: var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: var(--mn-font-weight-semibold, 600);
      letter-spacing: var(--mn-tracking-label, 0.05em);
      text-transform: uppercase;
    }

    sh-chat-panel .code-copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-default, 4px);
      padding: 2px 6px;
      background: transparent;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: inherit;
      font-size: var(--mn-text-xs, 0.75rem);
      cursor: pointer;
      transition: background var(--mn-transition-fast, 110ms ease), color var(--mn-transition-fast, 110ms ease);
    }

    sh-chat-panel .code-copy-btn:hover {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .code-copy-btn:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #587a69));
      outline-offset: 1px;
    }

    sh-chat-panel .code-copy-btn.copied {
      color: var(--mn-color-success, #16a34a);
      border-color: var(--mn-color-success-border, color-mix(in srgb, var(--mn-color-success, #16a34a) 25%, transparent));
      background: var(--mn-color-success-surface, color-mix(in srgb, var(--mn-color-success, #16a34a) 8%, transparent));
    }

    /* REASONING */
    sh-chat-panel .reasoning-header {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--mn-color-text-secondary, #6b6b6b);
    }

    sh-chat-panel .reasoning-header:hover {
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .reasoning-content {
      margin-top: 4px;
      font-size: 13px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      border-left: 2px solid var(--mn-color-border, #e5e5e5);
      padding-left: 8px;
    }

    /* TOOL CALLS */
    sh-chat-panel .tool-calls {
      margin: 8px 0;
    }

    sh-chat-panel .tool-call {
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 8px;
      margin: 4px 0;
      background: var(--mn-color-surface-base, #fff);
    }

    sh-chat-panel .tool-call:hover {
      border-color: var(--mn-color-border-strong, #cfcfcf);
    }

    sh-chat-panel .tool-call-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      cursor: pointer;
    }

    sh-chat-panel .tool-call-header:hover {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.03));
    }

    sh-chat-panel .tool-info {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    sh-chat-panel .tool-toggle {
      transition: transform 0.15s ease, color 0.15s ease;
      display: inline-block;
      color: var(--mn-color-text-tertiary, #9b9b9b);
    }

    sh-chat-panel .tool-call.expanded .tool-toggle {
      transform: rotate(90deg);
      color: var(--mn-color-text-secondary, #6b6b6b);
    }

    sh-chat-panel .tool-call-name {
      overflow: hidden;
      font-size: 13px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    sh-chat-panel .tool-kind,
    sh-chat-panel .tool-testimony-label {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .02em;
      white-space: nowrap;
    }

    sh-chat-panel .tool-kind {
      color: var(--mn-color-text-secondary, #6b6b6b);
      background: var(--mn-color-surface-subtle, #f8f8f8);
    }

    sh-chat-panel .tool-call[data-activity-kind='bash'] .tool-kind {
      color: #7c3f00;
      background: #fff4dd;
    }

    sh-chat-panel .tool-call[data-activity-kind='garden'] .tool-kind {
      color: #166534;
      background: #eaf8ef;
    }

    sh-chat-panel .tool-call[data-activity-kind='kubernetes'] .tool-kind {
      color: #1d4ed8;
      background: #eff6ff;
    }

    sh-chat-panel .tool-call[data-activity-kind='helm'] .tool-kind {
      color: #7e22ce;
      background: #faf5ff;
    }

    sh-chat-panel .tool-status-icon {
      font-size: 13px;
    }

    sh-chat-panel .tool-status-icon.success {
      color: var(--mn-color-success, #16a34a);
    }

    sh-chat-panel .tool-status-icon.error {
      color: var(--mn-color-danger, #dc2626);
    }

    sh-chat-panel .tool-status-icon.pending {
      color: var(--mn-color-text-tertiary, #9b9b9b);
    }

    sh-chat-panel .tool-spinner {
      color: var(--mn-color-accent, #2563eb);
      animation: sh-spin 1s linear infinite;
      display: inline-block;
    }

    @keyframes sh-spin {
      to {
        transform: rotate(360deg);
      }
    }

    sh-chat-panel .tool-call-body {
      padding: 6px 10px;
      font-size: 12px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      white-space: pre-wrap;
      border-top: 1px solid var(--mn-color-border, #e5e5e5);
    }

    sh-chat-panel .tool-testimony {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      padding: 0 10px 7px 32px;
    }

    sh-chat-panel .tool-testimony-label {
      border: 1px solid var(--mn-color-border, #e5e5e5);
      color: var(--mn-color-text-secondary, #6b6b6b);
      background: var(--mn-color-surface-subtle, #f8f8f8);
    }

    sh-chat-panel .tool-testimony-label[data-testimony='redacted'] {
      color: #9a3412;
      border-color: #fed7aa;
      background: #fff7ed;
    }

    sh-chat-panel .tool-testimony-label[data-testimony='truncated'] {
      color: #92400e;
      border-color: #fde68a;
      background: #fffbeb;
    }

    sh-chat-panel .tool-testimony-label[data-testimony='provenance'] {
      color: #1d4ed8;
      border-color: #bfdbfe;
      background: #eff6ff;
    }

    sh-chat-panel .tool-document-link {
      margin-left: auto;
      padding: 0;
      border: 0;
      color: var(--mn-color-accent, #2563eb);
      background: transparent;
      cursor: pointer;
      font: 650 11px/1.4 var(--mn-font-chrome, system-ui, sans-serif);
    }

    sh-chat-panel .tool-document-link:hover {
      text-decoration: underline;
    }

    sh-chat-panel .tool-data-block {
      border-top: 1px solid var(--mn-color-border, #e5e5e5);
      padding: 8px 10px;
    }

    sh-chat-panel .tool-data-label {
      margin-bottom: 5px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    sh-chat-panel .tool-json,
    sh-chat-panel .tool-output-text {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      padding: 8px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 6px;
      background: var(--mn-color-surface-subtle, #f8f8f8);
      color: var(--mn-color-text-primary, #1a1a1a);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    /* A finished conversation that kept no output for a call says so, quietly. */
    sh-chat-panel .tool-output-missing {
      margin: 0;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 11px;
      font-style: italic;
    }

    sh-chat-panel .transcript-empty {
      margin: 24px auto;
      max-width: 28rem;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 0.9rem;
      line-height: 1.5;
      text-align: center;
    }

    /* The transcript scrolls, so a keyboard has to be able to reach it. */
    sh-chat-panel [data-transcript-only] .messages-container:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #376d57);
      outline-offset: -2px;
    }

    sh-chat-panel .tool-call.error {
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #dc2626));
    }

    /* A red border alone puts the whole card at alarm pitch while saying
       nothing about which part failed. Tint the failure text instead, so the
       card stays a card and the error reads as its own region. */
    sh-chat-panel .tool-call-error {
      padding: 6px 10px;
      border-top: 1px solid var(--mn-color-danger-border, color-mix(in srgb, var(--mn-color-danger, #dc2626) 24%, transparent));
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #dc2626) 6%, transparent));
      color: var(--mn-color-text-danger, var(--mn-color-danger, #dc2626));
      font-size: var(--mn-text-xs, 0.75rem);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* SURFACE CARD */
    sh-chat-panel .surface-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 8px 0;
    }

    sh-chat-panel .surface-action {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 8px;
      background: var(--mn-color-surface-base, #fff);
      cursor: pointer;
      text-align: left;
      color: inherit;
    }

    sh-chat-panel .surface-action:hover {
      background: var(--mn-color-surface-raised, #f5f5f5);
    }

    sh-chat-panel .surface-action-title {
      font-weight: 600;
      font-size: 13px;
    }

    sh-chat-panel .surface-action-desc {
      font-size: 12px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      flex: 1;
    }

    /* MESSAGE CONTEXT MENU */
    sh-chat-panel .chat-message-menu {
      position: fixed;
      z-index: var(--mn-z-dropdown, 1000);
      min-width: 190px;
      padding: 4px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 8px;
      background: var(--mn-color-surface-base, #fff);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.16);
    }

    sh-chat-panel .chat-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 30px;
      padding: 5px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--mn-color-text-primary, #1a1a1a);
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }

    sh-chat-panel .chat-menu-item:hover,
    sh-chat-panel .chat-menu-item:focus-visible {
      outline: none;
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
    }

    sh-chat-panel .chat-menu-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      flex: 0 0 18px;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-size: 12px;
    }

    sh-chat-panel .chat-menu-divider {
      height: 1px;
      margin: 4px;
      background: var(--mn-color-border, #e5e5e5);
    }

    /* TYPING INDICATOR */
    sh-chat-panel .typing-indicator {
      display: inline-flex;
      gap: 4px;
      padding: 4px 0;
    }

    sh-chat-panel .typing-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--mn-color-text-tertiary, #9b9b9b);
      animation: sh-typing 1.2s infinite ease-in-out;
    }

    sh-chat-panel .typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    sh-chat-panel .typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    /* Opacity alone reads as a flicker; a touch of scale makes the three dots
       breathe, which is what makes "waiting" feel alive rather than stalled. */
    @keyframes sh-typing {
      0%,
      60%,
      100% {
        opacity: 0.3;
        transform: scale(0.88);
      }
      30% {
        opacity: 1;
        transform: scale(1);
      }
    }

    /* EMPTY STATE */
    sh-chat-panel .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      /* Top-anchored (not vertically centered) on purpose: the composer grows as
         you type (autosize + the clear button appearing), which shrinks the
         messages area it shares the column with. A vertically-CENTERED empty
         state re-centers into that smaller area on the first keystroke — the
         "slides up, leaves white space" jump. Anchoring the welcome to the top
         keeps it put while the composer expands below it. (The mobile media
         query already uses flex-start; this brings desktop in line.) */
      justify-content: flex-start;
      gap: 8px;
      padding: clamp(44px, 12vh, 96px) 18px 28px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      text-align: center;
    }

    sh-chat-panel .empty-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      font-size: 28px;
      color: var(--mn-color-accent, #2563eb);
      opacity: 0.85;
    }

    sh-chat-panel .empty-eyebrow {
      margin: 2px 0 4px;
      color: var(--mn-color-accent, #587a69);
      font: 700 10px/1.2 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }

    sh-chat-panel .empty-title {
      margin: 0;
      color: var(--mn-color-text-primary, #1a1a1a);
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-size: var(--mn-text-lg, 18px);
      font-weight: 650;
      line-height: 1.3;
    }

    sh-chat-panel .empty-description {
      margin: 0;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-family: var(--mn-font-prose, Georgia, 'Times New Roman', serif);
      font-size: 15px;
      line-height: 1.6;
    }

    sh-chat-panel .empty-suggestions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      max-width: 290px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--mn-color-border, #e5e5e5);
    }

    sh-chat-panel .suggestion-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: 14px/1.35 var(--mn-font-prose, Georgia, 'Times New Roman', serif);
      cursor: pointer;
    }

    sh-chat-panel .suggestion-btn:hover {
      color: var(--mn-color-text-primary, #1a1a1a);
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.04));
    }

    sh-chat-panel .suggestion-btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    sh-chat-panel .suggestion-btn:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 2px;
    }

    sh-chat-panel .suggestion-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      color: var(--mn-color-text-tertiary, #9b9b9b);
    }

    /* CONTINUITY SURFACES — same controlled vocabulary as
       <mn-continuity-status>, rendered locally to keep chat-kernel pure. */
    sh-chat-panel .connection-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      font-size: 13px;
    }

    sh-chat-panel .connection-banner.continuity {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      min-height: 44px;
      border-bottom: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #e5e7eb));
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #4b5563);
      box-sizing: border-box;
    }

    sh-chat-panel .connection-banner:is(.offline, .reconnecting) {
      border-color: color-mix(in srgb, currentColor 18%, transparent);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
    }

    sh-chat-panel .connection-banner.continuity.error {
      border-color: color-mix(in srgb, currentColor 18%, transparent);
      background: var(--mn-color-danger-surface, #fff1f2);
      color: var(--mn-color-danger, #b91c1c);
    }

    sh-chat-panel .continuity-indicator {
      display: inline-grid;
      width: 18px;
      height: 18px;
      place-items: center;
    }

    sh-chat-panel .continuity-indicator::after {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
      content: '';
    }

    sh-chat-panel [data-progress='true'] .continuity-indicator::after {
      width: 12px;
      height: 12px;
      border: 2px solid color-mix(in srgb, currentColor 26%, transparent);
      border-top-color: currentColor;
      background: transparent;
      animation: sh-chat-continuity-spin 0.8s linear infinite;
      box-sizing: border-box;
    }

    sh-chat-panel .continuity-copy {
      display: flex;
      min-width: 0;
      gap: 4px;
      line-height: 1.35;
    }

    sh-chat-panel .continuity-copy strong {
      color: currentColor;
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .continuity-copy span {
      color: var(--mn-color-text-secondary, #4b5563);
    }

    sh-chat-panel .connection-banner.error {
      background: rgba(220, 38, 38, 0.08);
      color: var(--mn-color-danger, #dc2626);
    }

    sh-chat-panel .connection-banner.readonly {
      border-bottom: 1px solid color-mix(in srgb, var(--mn-color-warning, #b45309) 24%, transparent);
      background: color-mix(in srgb, var(--mn-color-warning, #b45309) 9%, transparent);
      color: var(--mn-color-warning-text, #92400e);
    }

    sh-chat-panel .banner-action {
      flex: 0 0 auto;
      min-height: 26px;
      padding: 3px 9px;
      border: 1px solid currentColor;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
    }

    sh-chat-panel .banner-action:hover {
      background: color-mix(in srgb, currentColor 9%, transparent);
    }

    sh-chat-panel .send-continuity {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      margin: 0 0 8px;
      padding: 4px 8px;
      border: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #e5e7eb));
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 13px;
      box-sizing: border-box;
    }

    sh-chat-panel .send-continuity.error {
      border-color: color-mix(in srgb, currentColor 18%, transparent);
      background: var(--mn-color-danger-surface, #fff1f2);
      color: var(--mn-color-danger, #b91c1c);
    }

    sh-chat-panel .send-retry {
      min-height: 32px;
      padding: 3px 9px;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .send-retry:hover {
      background: color-mix(in srgb, currentColor 9%, transparent);
    }

    sh-chat-panel .conversation-loading {
      display: flex;
      width: min(100%, 520px);
      margin: auto;
      padding: 24px;
      flex-direction: column;
      gap: 14px;
      box-sizing: border-box;
    }

    sh-chat-panel .conversation-loading span {
      display: block;
      height: 14px;
      border-radius: 999px;
      background: var(--mn-color-surface-sunken, #eef1f4);
      animation: sh-chat-loading-pulse 1.4s ease-in-out infinite alternate;
    }

    sh-chat-panel .conversation-loading span:nth-child(1) { width: 76%; }
    sh-chat-panel .conversation-loading span:nth-child(2) { width: 92%; }
    sh-chat-panel .conversation-loading span:nth-child(3) { width: 58%; }

    @keyframes sh-chat-continuity-spin {
      to { transform: rotate(360deg); }
    }

    @keyframes sh-chat-loading-pulse {
      to { opacity: 0.42; }
    }

    /* The continuity surfaces already honoured this; the transcript's own
       motion (message entrance, typing dots, tool spinner, FAB) did not. */
    @media (prefers-reduced-motion: reduce) {
      sh-chat-panel [data-progress='true'] .continuity-indicator::after,
      sh-chat-panel .conversation-loading span,
      sh-chat-panel .message,
      sh-chat-panel .typing-dot,
      sh-chat-panel .tool-spinner,
      sh-chat-panel .scroll-to-bottom,
      sh-chat-panel .scroll-to-bottom.has-new {
        animation: none;
      }

      sh-chat-panel .scroll-to-bottom:hover {
        transform: none;
      }
    }

    sh-chat-panel .copy-toast {
      position: fixed;
      left: 50%;
      bottom: 100px;
      transform: translateX(-50%);
      z-index: var(--mn-z-toast, 1600);
      padding: 6px 12px;
      border-radius: 6px;
      background: var(--mn-color-text-primary, #1a1a1a);
      color: var(--mn-color-surface-base, #fff);
      font-size: 13px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      pointer-events: none;
    }

    /* COMPOSER */
    sh-chat-panel .composer {
      position: relative;
      z-index: 1;
      box-sizing: border-box;
      flex: 0 0 auto;
      min-width: 0;
      padding: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      background: color-mix(in srgb, var(--mn-color-surface-chrome, #eeeae2) 36%, var(--mn-color-surface-panel, #fbfaf7));
    }

    sh-chat-panel .composer-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin: 0 2px 7px;
    }

    sh-chat-panel .composer-label {
      color: var(--mn-color-text-primary, #282622);
      font-family: var(--mn-font-display, var(--mn-font-prose, Georgia, serif));
      font-size: 13px;
      font-weight: 650;
      letter-spacing: 0.01em;
    }

    sh-chat-panel .composer-hint {
      color: var(--mn-color-text-tertiary, #817d75);
      font: 11px/1.3 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      white-space: nowrap;
    }

    sh-chat-panel .prompt-card-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    }

    sh-chat-panel .prompt-card {
      padding: 10px;
      border: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.03));
    }

    sh-chat-panel .prompt-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    sh-chat-panel .prompt-card-kicker,
    sh-chat-panel .prompt-card-count {
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1;
      text-transform: uppercase;
    }

    sh-chat-panel .prompt-card-kicker {
      color: var(--mn-color-accent, #2563eb);
    }

    sh-chat-panel .prompt-card-question {
      margin-bottom: 8px;
      color: var(--mn-color-text-primary, #1a1a1a);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
    }

    sh-chat-panel .prompt-card-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 6px;
    }

    sh-chat-panel .prompt-card-options.has-preview {
      grid-template-columns: 1fr;
    }

    sh-chat-panel .prompt-option {
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      padding: 8px;
      border: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #1a1a1a);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    sh-chat-panel .prompt-option:hover:not(:disabled),
    sh-chat-panel .prompt-option:focus-visible:not(:disabled) {
      border-color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-surface-hover, rgba(37, 99, 235, 0.05));
      outline: none;
    }

    sh-chat-panel .prompt-option.selected {
      border-color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-interactive-selected, rgba(37, 99, 235, 0.1));
    }

    sh-chat-panel .prompt-option:disabled {
      cursor: default;
      opacity: 0.5;
    }

    sh-chat-panel .prompt-option-copy {
      display: flex;
      min-width: 0;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
    }

    sh-chat-panel .prompt-option-label {
      font-size: 13px;
      font-weight: 650;
      line-height: 1.25;
    }

    sh-chat-panel .prompt-option-description {
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 12px;
      line-height: 1.35;
    }

    sh-chat-panel .prompt-option-preview {
      flex: 0 1 180px;
      min-width: 120px;
      max-height: 86px;
      margin: 0;
      overflow: auto;
      padding: 7px;
      border: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f5f5f5);
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
    }

    sh-chat-panel .prompt-freeform {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
    }

    sh-chat-panel .prompt-freeform-input {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 28px;
      max-height: 96px;
      padding: 6px 8px;
      resize: vertical;
      border: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
      font: inherit;
      font-size: 13px;
      line-height: 1.4;
    }

    sh-chat-panel .prompt-freeform-input:focus {
      border-color: var(--mn-color-accent, #2563eb);
      outline: none;
    }

    sh-chat-panel .prompt-submit {
      min-height: 30px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }

    sh-chat-panel .prompt-submit:disabled {
      cursor: default;
      opacity: 0.45;
    }

    sh-chat-panel .composer-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    sh-chat-panel .composer-control-group {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      gap: 6px;
      padding: 3px;
      border: 1px solid var(--mn-color-border-default, var(--mn-color-border, #e5e5e5));
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #f7f7f7);
      box-shadow: var(--mn-shadow-sm, none);
    }

    sh-chat-panel .composer-control-group.disabled {
      opacity: 0.56;
    }

    sh-chat-panel .composer-control-label {
      padding: 0 5px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 11px;
      font-weight: 650;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }

    sh-chat-panel .composer-control-options {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
    }

    sh-chat-panel .composer-control-option {
      min-height: 24px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #6b6b6b);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      line-height: 1;
      white-space: nowrap;
    }

    sh-chat-panel .composer-control-option:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.05));
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .composer-control-option:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 1px;
    }

    sh-chat-panel .composer-control-option.selected {
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    sh-chat-panel .composer-control-option:disabled {
      cursor: default;
      opacity: 0.5;
    }

    sh-chat-panel .composer-input-wrapper {
      position: relative;
      display: block;
      min-width: 0;
    }

    sh-chat-panel hoja-editor[posture='composer'] {
      width: 100%;
      min-width: 0;
      --hoja-composer-min-block-size: 3.625rem;
      --hoja-composer-max-block-size: min(32dvh, 11.25rem);
    }

    /* The chat panel owns send/clear. Hoja owns text, formatting, references,
       and focus; reserve footer space without overlaying its rich controls. */
    sh-chat-panel hoja-editor[posture='composer'] .hoja-editor__footer {
      padding-inline-end: 6rem;
    }

    sh-chat-panel hoja-editor[posture='composer'] .hoja-editor__key-hint {
      display: none;
    }

    sh-chat-panel .clear-button {
      position: absolute;
      right: 48px;
      bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: var(--mn-color-surface-raised, #f5f5f5);
      color: var(--mn-color-text-secondary, #6b6b6b);
      cursor: pointer;
      font: 18px/1 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .clear-button:hover {
      background: var(--mn-color-surface-hover, #ececec);
      color: var(--mn-color-text-primary, #1a1a1a);
    }

    sh-chat-panel .send-button {
      position: absolute;
      right: 4px;
      bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 999px;
      border: none;
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      transition: background var(--mn-transition-fast, 110ms ease), box-shadow var(--mn-transition-fast, 110ms ease);
    }

    /* Send is the primary act of the whole surface and had no pressed or hover
       feedback at all — the click landed with no acknowledgement from the
       control itself. */
    sh-chat-panel .send-button:hover:not(:disabled) {
      background: var(--mn-color-accent-hover, #1d4ed8);
      box-shadow: var(--mn-shadow-sm, 0 1px 3px rgba(30, 27, 22, 0.18));
    }

    sh-chat-panel .send-button:active:not(:disabled) {
      background: var(--mn-color-accent-active, #1e40af);
      box-shadow: none;
    }

    sh-chat-panel .send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    sh-chat-panel .clear-button:active {
      background: var(--mn-color-surface-active, var(--mn-color-surface-hover, #ececec));
    }

    /* ── FOCUS RING COVERAGE ───────────────────────────────────────────────
       Everything reachable by keyboard shows where the keyboard is. The two
       role="button" tabindex="0" disclosure headers were the worst offenders:
       focusable by contract, with no visible focus state whatsoever. */
    sh-chat-panel .message-action-btn:focus-visible,
    sh-chat-panel .tool-call-header:focus-visible,
    sh-chat-panel .reasoning-header:focus-visible,
    sh-chat-panel .surface-action:focus-visible,
    sh-chat-panel .banner-action:focus-visible,
    sh-chat-panel .send-retry:focus-visible,
    sh-chat-panel .prompt-submit:focus-visible,
    sh-chat-panel .send-button:focus-visible,
    sh-chat-panel .clear-button:focus-visible,
    sh-chat-panel .super-bar-identity:focus-visible,
    sh-chat-panel .slot-indicator:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #587a69));
      outline-offset: 2px;
    }

    /* Inside the fenced/tinted wells an outset ring is clipped by overflow:
       hidden — inset it so it stays visible. */
    sh-chat-panel .tool-call-header:focus-visible,
    sh-chat-panel .surface-action:focus-visible {
      outline-offset: -2px;
    }

    /* ═══════════════════════ DARK MODE ═══════════════════════
       EVERY selector here is sh-chat-panel[data-theme="dark"] — the rename is
       load-bearing: against the OLD mn-chat-panel host these would silently
       no-op. Activated by applyTheme() writing data-theme on the host. */
    sh-chat-panel[data-theme='dark'] {
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #1a1a1a));
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .header {
      border-bottom-color: var(--mn-color-rule, var(--mn-color-border, #333));
    }

    sh-chat-panel[data-theme='dark'] .super-bar {
      border-bottom-color: var(--mn-color-rule, #333);
    }

    sh-chat-panel[data-theme='dark'] .super-bar-identity:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.06));
    }

    sh-chat-panel[data-theme='dark'] .super-bar-sophia {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .super-bar-chat-title {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .slot-indicator {
      border-color: var(--mn-color-border-default, #333);
      color: var(--mn-color-text-muted, #777);
    }

    sh-chat-panel[data-theme='dark'] .slot-indicator.filled {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .slot-indicator.active {
      color: var(--mn-color-text-primary, #e8e8e8);
      border-color: var(--mn-color-border-strong, #555);
      background: var(--mn-color-surface-raised, #242424);
    }

    sh-chat-panel[data-theme='dark'] .slot-indicator:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.06));
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .icon-button {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .icon-button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.08));
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .icon-button.danger {
      color: #f87171;
    }

    sh-chat-panel[data-theme='dark'] .model-selector-trigger {
      background: var(--mn-color-surface-raised, #242424);
      border-color: var(--mn-color-border-default, #333);
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .model-selector-trigger:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.08));
      border-color: var(--mn-color-border-strong, #444);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .model-picker {
      background: var(--mn-color-surface-elevated, #242424);
      border-color: var(--mn-color-border-default, #333);
      box-shadow: var(--mn-shadow-popover, 0 14px 34px rgba(0, 0, 0, 0.45));
    }

    sh-chat-panel[data-theme='dark'] .model-picker-providers {
      border-right-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-models {
      background: var(--mn-color-surface-overlay, #1f1f1f);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-provider {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-provider:hover,
    sh-chat-panel[data-theme='dark'] .model-picker-provider.active,
    sh-chat-panel[data-theme='dark'] .model-picker-model:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.08));
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-model {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-model.selected {
      background: var(--mn-color-surface-accent-strong, rgba(96, 165, 250, 0.16));
      color: var(--mn-color-text-accent-strong, #93c5fd);
    }

    sh-chat-panel[data-theme='dark'] .scroll-to-bottom {
      background: var(--mn-color-surface-raised, #242424);
      color: var(--mn-color-text-secondary, #aaa);
      box-shadow: var(--mn-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.32));
    }

    sh-chat-panel[data-theme='dark'] .scroll-to-bottom:hover {
      background: var(--mn-color-surface-hover, #333);
      color: var(--mn-color-text-primary, #e8e8e8);
      box-shadow: var(--mn-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.4));
    }

    sh-chat-panel[data-theme='dark'] .scroll-to-bottom.has-new {
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    sh-chat-panel[data-theme='dark'] .message.assistant .message-bubble {
      border-left-color: color-mix(in srgb, var(--mn-color-accent, #7fa995) 42%, transparent);
      background: transparent;
    }

    sh-chat-panel[data-theme='dark'] .message.user .message-bubble {
      background: var(--mn-color-accent, #2563eb);
    }

    sh-chat-panel[data-theme='dark'] .message-content pre {
      background: var(--mn-color-surface-sunken, rgba(255, 255, 255, 0.06));
    }

    sh-chat-panel[data-theme='dark'] .message-content code {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .transcript-json {
      background: color-mix(in srgb, var(--transcript-accent) 10%, #1e1e1e);
      color: #e8e8e8;
      border-color: color-mix(in srgb, var(--transcript-accent) 35%, #333);
    }

    sh-chat-panel[data-theme='dark'] .message-action-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    sh-chat-panel[data-theme='dark'] .message-action-btn.copied {
      color: #4ade80;
      background: rgba(74, 222, 128, 0.12);
    }

    sh-chat-panel[data-theme='dark'] .tool-call {
      background: var(--mn-color-surface-subtle, #1e1e1e);
      border-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .tool-call:hover {
      border-color: var(--mn-color-border-strong, #444);
    }

    sh-chat-panel[data-theme='dark'] .tool-call-header:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.04));
    }

    sh-chat-panel[data-theme='dark'] .tool-call-body {
      border-top-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .tool-call.error {
      border-color: var(--mn-color-danger, #ef4444);
    }

    sh-chat-panel[data-theme='dark'] .tool-call-error {
      color: var(--mn-color-danger, #ef4444);
    }

    sh-chat-panel[data-theme='dark'] .surface-card .surface-action {
      background: var(--mn-color-surface-subtle, #1e1e1e);
      border-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .surface-action:hover {
      background: var(--mn-color-surface-hover, #2a2a2a);
    }

    sh-chat-panel[data-theme='dark'] .chat-message-menu {
      background: var(--mn-color-surface-elevated, #242424);
      border-color: var(--mn-color-border-default, #333);
      box-shadow: var(--mn-shadow-popover, 0 14px 34px rgba(0, 0, 0, 0.45));
    }

    sh-chat-panel[data-theme='dark'] .header-actions-menu {
      background: var(--mn-color-surface-elevated, #242424);
      border-color: var(--mn-color-border-default, #333);
      box-shadow: var(--mn-shadow-popover, 0 14px 34px rgba(0, 0, 0, 0.45));
    }

    sh-chat-panel[data-theme='dark'] .header-action-menu-item {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .chat-menu-item {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .chat-menu-item:hover,
    sh-chat-panel[data-theme='dark'] .chat-menu-item:focus-visible {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.08));
    }

    sh-chat-panel[data-theme='dark'] .chat-menu-divider {
      background: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .chat-menu-icon {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .reasoning-header {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .reasoning-header:hover {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .reasoning-content {
      color: var(--mn-color-text-secondary, #aaa);
      border-left-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .empty-icon {
      color: var(--mn-color-accent, #60a5fa);
    }

    sh-chat-panel[data-theme='dark'] .empty-eyebrow {
      color: var(--mn-color-accent, #86b49e);
    }

    sh-chat-panel[data-theme='dark'] .empty-title {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .empty-description {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .empty-suggestions {
      border-top-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .suggestion-btn {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .suggestion-btn:hover {
      color: var(--mn-color-text-primary, #e8e8e8);
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.06));
    }

    sh-chat-panel[data-theme='dark'] .suggestion-icon {
      color: var(--mn-color-text-muted, #777);
    }

    sh-chat-panel[data-theme='dark'] .typing-dot {
      background: var(--mn-color-text-muted, #777);
    }

    sh-chat-panel[data-theme='dark'] .composer {
      border-top-color: var(--mn-color-rule, #333);
    }

    sh-chat-panel[data-theme='dark'] .composer-label {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .composer-hint {
      color: var(--mn-color-text-muted, #8c8c8c);
    }

    sh-chat-panel[data-theme='dark'] .prompt-card {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #202020);
      box-shadow: var(--mn-shadow-card, none);
    }

    sh-chat-panel[data-theme='dark'] .prompt-card-question {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .prompt-card-kicker {
      color: var(--mn-color-accent, #60a5fa);
    }

    sh-chat-panel[data-theme='dark'] .prompt-card-count,
    sh-chat-panel[data-theme='dark'] .prompt-option-description {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .prompt-option {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #242424);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .prompt-option:hover:not(:disabled),
    sh-chat-panel[data-theme='dark'] .prompt-option:focus-visible:not(:disabled) {
      background: var(--mn-color-surface-accent, rgba(96, 165, 250, 0.12));
      border-color: var(--mn-color-accent, #60a5fa);
    }

    sh-chat-panel[data-theme='dark'] .prompt-option.selected {
      background: var(--mn-color-surface-accent-strong, rgba(96, 165, 250, 0.18));
      border-color: var(--mn-color-accent, #60a5fa);
    }

    sh-chat-panel[data-theme='dark'] .prompt-option-preview {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-sunken, #1a1a1a);
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .prompt-freeform {
      border-top-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .prompt-freeform-input {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #242424);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .prompt-freeform-input:focus {
      border-color: var(--mn-color-accent, #60a5fa);
    }

    sh-chat-panel[data-theme='dark'] .composer-control-group {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #202020);
    }

    sh-chat-panel[data-theme='dark'] .composer-control-label {
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .composer-control-option {
      color: var(--mn-color-text-secondary, #b8b8b8);
    }

    sh-chat-panel[data-theme='dark'] .composer-control-option:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.08));
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .composer-control-option.selected {
      background: var(--mn-color-accent, #60a5fa);
      color: var(--mn-color-text-on-accent, #fff);
    }

    sh-chat-panel[data-theme='dark'] hoja-editor[posture='composer'] .hoja-editor__frame {
      background: var(--mn-color-surface-elevated, #242424);
      border-color: var(--mn-color-border-default, #333);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] hoja-editor[posture='composer'] .hoja-editor__frame:focus-within {
      border-color: var(--mn-color-accent, #2563eb);
    }

    sh-chat-panel[data-theme='dark'] .clear-button {
      background: var(--mn-color-surface-sunken, #333);
      color: var(--mn-color-text-secondary, #aaa);
    }

    sh-chat-panel[data-theme='dark'] .clear-button:hover {
      background: var(--mn-color-surface-hover, #444);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .send-button:disabled {
      opacity: 0.4;
    }

    sh-chat-panel[data-theme='dark'] .connection-banner.error {
      background: rgba(239, 68, 68, 0.12);
      color: var(--mn-color-danger, #ef4444);
    }

    /* Garden conversation starters are compact actions in the desktop pane. */
    @media (min-width: 601px) {
    sh-chat-panel:is(:not([data-skin]), [data-skin='garden']) .empty-state {
      gap: 8px;
      padding-top: clamp(36px, 9vh, 76px);
    }
    sh-chat-panel:is(:not([data-skin]), [data-skin='garden']) .empty-icon {
      width: 56px;
      height: 56px;
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #d8ded9));
      border-radius: 18px;
      background: var(--mn-color-surface-accent, #edf6ef);
      color: var(--mn-color-text-accent, #376d57);
      opacity: 1;
    }
    sh-chat-panel:is(:not([data-skin]), [data-skin='garden']) .empty-suggestions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      max-width: 400px;
      margin-top: 16px;
      padding-top: 0;
      border-top: 0;
    }
    sh-chat-panel:is(:not([data-skin]), [data-skin='garden']) .suggestion-btn {
      min-height: 62px;
      justify-content: flex-start;
      padding: 9px 12px;
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #d8ded9));
      border-radius: 13px;
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-garden-card-shadow, none);
      color: var(--mn-color-text-secondary, #58665c);
      font: 13px/1.35 var(--mn-font-sans, system-ui, sans-serif);
      text-align: left;
    }
    sh-chat-panel:is(:not([data-skin]), [data-skin='garden']) .suggestion-icon {
      color: var(--mn-color-text-accent, #376d57);
    }
    }

    /* Medium remains touch-capable even while it keeps the desktop chrome. */
    @media (max-width: 1024px) {
      sh-chat-panel :is(.connection-banner.continuity .banner-action, .send-retry) {
        min-height: var(--mn-touch-target-size, 48px);
        padding-inline: 12px;
        touch-action: manipulation;
      }
    }

    /* COMPACT PHONE POSTURE
       The controlled kernel stays singular. At phone width, its existing
       resources and intents are delivered through one coherent chrome surface,
       reachable targets, a viewport-safe model sheet, and an IME-safe composer. */
    @media (max-width: 600px) {
      sh-chat-panel {
        --sh-chat-compact-target: var(--mn-touch-target-size, 48px);
      }

      sh-chat-panel .chat-chrome {
        position: relative;
        z-index: 30;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        grid-template-areas:
          'identity status actions'
          'model slots slots';
        gap: 4px 8px;
        flex: 0 0 auto;
        padding: max(4px, env(safe-area-inset-top)) 8px 8px;
        border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
        background: var(--mn-chat-header-bg, var(--mn-color-surface-panel, #fff));
        box-shadow: var(--mn-shadow-chrome, 0 1px 0 rgba(0, 0, 0, 0.02));
        box-sizing: border-box;
      }

      sh-chat-panel .super-bar,
      sh-chat-panel .header {
        display: contents;
      }

      sh-chat-panel .super-bar-identity {
        grid-area: identity;
        min-width: 0;
        min-height: var(--sh-chat-compact-target);
        padding: 0 8px;
      }

      sh-chat-panel .super-bar-sophia {
        font-size: 14px;
      }

      sh-chat-panel .super-bar-chat-title {
        font-size: 14px;
        font-style: normal;
      }

      sh-chat-panel .super-bar-slots {
        grid-area: slots;
        gap: 4px;
      }

      sh-chat-panel .slot-indicator {
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
        border-radius: var(--mn-radius-control, 8px);
        font-size: 13px;
      }

      sh-chat-panel .header-left {
        grid-area: model;
        min-width: 0;
      }

      sh-chat-panel .header-status {
        grid-area: status;
        max-width: 104px;
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      sh-chat-panel .header-right {
        grid-area: actions;
        margin-left: 0;
      }

      sh-chat-panel .header-actions-wide {
        display: none;
      }

      sh-chat-panel .compact-header-actions {
        display: block;
      }

      sh-chat-panel .compact-actions-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
        padding: 0;
        border: 0;
        border-radius: var(--mn-radius-control, 8px);
        background: transparent;
        color: var(--mn-color-text-secondary, #6b6b6b);
        cursor: pointer;
        font: 16px/1 var(--mn-font-sans, system-ui, sans-serif);
        letter-spacing: 0.08em;
      }

      sh-chat-panel .compact-actions-trigger:hover,
      sh-chat-panel .compact-actions-trigger:focus-visible {
        outline: none;
        background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
        box-shadow: var(--mn-focus-ring, none);
      }

      sh-chat-panel .header-actions-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 80;
        display: flex;
        width: min(248px, calc(100vw - 16px));
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        border: 1px solid var(--mn-color-border, #e5e5e5);
        border-radius: var(--mn-radius-surface, 12px);
        background: var(--mn-color-surface-elevated, var(--mn-color-surface-base, #fff));
        box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.16));
      }

      sh-chat-panel .header-action-menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: var(--sh-chat-compact-target);
        padding: 0 12px;
        border: 0;
        border-radius: var(--mn-radius-control, 8px);
        background: transparent;
        color: var(--mn-color-text-primary, #1a1a1a);
        cursor: pointer;
        font: 14px/1.2 var(--mn-font-sans, system-ui, sans-serif);
        text-align: left;
      }

      sh-chat-panel .header-action-menu-item:hover:not(:disabled),
      sh-chat-panel .header-action-menu-item:focus-visible {
        outline: none;
        background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
      }

      sh-chat-panel .header-action-menu-item:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      sh-chat-panel .header-action-menu-item.danger {
        color: var(--mn-color-danger, #dc2626);
      }

      sh-chat-panel .model-dropdown,
      sh-chat-panel .model-selector,
      sh-chat-panel .model-selector-trigger {
        width: 100%;
        max-width: none;
      }

      sh-chat-panel .model-selector-trigger {
        min-height: var(--sh-chat-compact-target);
        padding: 0 12px;
        border-radius: var(--mn-radius-control, 8px);
        font-size: 13px;
      }

      sh-chat-panel .model-picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: var(--mn-z-dropdown-backdrop, 900);
        display: block;
        background: rgba(0, 0, 0, 0.34);
      }

      sh-chat-panel .model-picker {
        position: fixed;
        inset: auto 8px max(8px, var(--mn-viewport-inset-bottom, env(safe-area-inset-bottom))) 8px;
        z-index: var(--mn-z-dropdown, 1000);
        width: auto;
        min-width: 0;
        max-height: min(72dvh, 560px);
        border-radius: var(--mn-radius-surface, 16px);
      }

      sh-chat-panel .model-picker-head {
        display: flex;
        min-height: var(--sh-chat-compact-target);
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 8px 6px 16px;
        border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
        font-size: 16px;
      }

      sh-chat-panel .model-picker-close {
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
        flex: 0 0 var(--sh-chat-compact-target);
        border-radius: var(--mn-radius-control, 8px);
      }

      sh-chat-panel .model-picker-body {
        display: flex;
        min-height: 0;
        flex: 1 1 auto;
        flex-direction: column;
      }

      sh-chat-panel .model-picker-providers {
        display: flex;
        flex: 0 0 auto;
        gap: 4px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 6px;
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
        scrollbar-width: none;
      }

      sh-chat-panel .model-picker-providers::-webkit-scrollbar {
        display: none;
      }

      sh-chat-panel .model-picker-provider {
        width: auto;
        min-width: max-content;
        min-height: var(--sh-chat-compact-target);
        padding: 0 16px;
        border-radius: var(--mn-radius-control, 8px);
        font-size: 14px;
      }

      sh-chat-panel .model-picker-models {
        min-height: 0;
        flex: 1 1 auto;
        padding: 6px;
      }

      sh-chat-panel .model-picker-model {
        min-height: var(--sh-chat-compact-target);
        padding: 0 12px;
        border-radius: var(--mn-radius-control, 8px);
        font-size: 15px;
      }

      sh-chat-panel .connection-banner {
        min-height: var(--sh-chat-compact-target);
        padding: 8px 12px;
        line-height: 1.4;
      }

      sh-chat-panel .continuity-copy {
        display: grid;
        gap: 0;
      }

      sh-chat-panel .continuity-copy span {
        font-size: 12px;
      }

      sh-chat-panel .send-continuity {
        min-height: var(--sh-chat-compact-target);
      }

      sh-chat-panel .send-retry {
        min-height: var(--sh-chat-compact-target);
        padding-inline: 12px;
      }

      sh-chat-panel .messages-container {
        gap: 20px;
        padding: 20px 14px 24px;
        scroll-padding-block: 16px 24px;
        font-size: 15px;
        line-height: 1.6;
        overscroll-behavior: contain;
      }

      sh-chat-panel .message {
        gap: 6px;
      }

      sh-chat-panel .message-bubble {
        padding: 12px 14px;
        border-radius: var(--mn-radius-surface, 14px);
        line-height: 1.6;
      }

      sh-chat-panel .message.assistant .message-bubble {
        width: 100%;
        padding: 2px 4px 4px 14px;
        border-radius: 0;
        box-sizing: border-box;
      }

      sh-chat-panel .message.user .message-bubble {
        max-width: 90%;
        padding: 11px 15px;
        border-radius: var(--mn-radius-surface, 16px) var(--mn-radius-surface, 16px) 5px var(--mn-radius-surface, 16px);
      }

      sh-chat-panel .message-byline,
      sh-chat-panel .message-meta {
        width: 100%;
      }

      sh-chat-panel .message.user .message-byline,
      sh-chat-panel .message.user .message-meta {
        width: 90%;
      }

      sh-chat-panel .message-content {
        font-size: 16px;
        line-height: 1.72;
      }

      sh-chat-panel .message-actions {
        margin-left: auto;
      }

      sh-chat-panel :is(
        button,
        [role='button'],
        textarea,
        input,
        select
      ) {
        min-height: var(--sh-chat-compact-target);
        touch-action: manipulation;
      }

      sh-chat-panel :is(
        .icon-button,
        .message-action-btn,
        .code-copy-btn,
        .scroll-to-bottom,
        .clear-button,
        .send-button
      ) {
        min-width: var(--sh-chat-compact-target);
        min-height: var(--sh-chat-compact-target);
      }

      sh-chat-panel .tool-call-header,
      sh-chat-panel .reasoning-header,
      sh-chat-panel .surface-action,
      sh-chat-panel .suggestion-btn,
      sh-chat-panel .prompt-option,
      sh-chat-panel .chat-menu-item,
      sh-chat-panel .banner-action,
      sh-chat-panel .prompt-submit {
        min-height: var(--sh-chat-compact-target);
      }

      sh-chat-panel .chat-message-menu {
        inset: auto 8px max(8px, var(--mn-viewport-inset-bottom, env(safe-area-inset-bottom))) 8px !important;
        min-width: 0;
        padding: 6px;
        border-radius: var(--mn-radius-surface, 14px);
      }

      sh-chat-panel .chat-menu-item {
        padding: 0 12px;
        font-size: 14px;
      }

      sh-chat-panel .empty-state {
        justify-content: flex-start;
        padding: clamp(32px, 10vh, 72px) 12px 28px;
      }

      sh-chat-panel .empty-suggestions {
        max-width: 100%;
      }

      sh-chat-panel .suggestion-btn {
        justify-content: flex-start;
        padding: 0 12px;
        text-align: left;
      }

      sh-chat-panel .composer {
        z-index: 25;
        padding: 10px 10px calc(10px + var(--mn-viewport-inset-bottom, env(safe-area-inset-bottom)));
        background: color-mix(in srgb, var(--mn-color-surface-chrome, #eeeae2) 38%, var(--mn-color-surface-panel, #fbfaf7));
      }

      sh-chat-panel .composer-heading {
        margin: 0 4px 7px;
      }

      sh-chat-panel .composer-label {
        font-size: 14px;
      }

      sh-chat-panel .composer-hint {
        font-size: 10px;
      }

      sh-chat-panel .prompt-card {
        padding: 12px;
      }

      sh-chat-panel .prompt-card-options {
        grid-template-columns: 1fr;
        gap: 8px;
      }

      sh-chat-panel .prompt-option {
        padding: 10px 12px;
      }

      sh-chat-panel .prompt-freeform {
        align-items: stretch;
        flex-direction: column;
      }

      sh-chat-panel .prompt-submit {
        padding: 0 16px;
      }

      sh-chat-panel .composer-controls {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        max-height: min(32dvh, 240px);
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      sh-chat-panel .composer-control-group {
        display: grid;
        grid-template-columns: minmax(64px, auto) minmax(0, 1fr);
        gap: 6px;
        padding: 4px;
      }

      sh-chat-panel .composer-control-label {
        display: flex;
        align-items: center;
        padding: 0 8px;
        font-size: 11px;
      }

      sh-chat-panel .composer-control-options {
        display: grid;
        grid-auto-columns: minmax(76px, 1fr);
        grid-auto-flow: column;
        gap: 4px;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
      }

      sh-chat-panel .composer-control-option {
        min-height: var(--sh-chat-compact-target);
        padding: 0 12px;
        font-size: 13px;
      }

      sh-chat-panel hoja-editor[posture='composer'] {
        --hoja-composer-min-block-size: 3.625rem;
        --hoja-composer-max-block-size: min(32dvh, 11.25rem);
      }

      sh-chat-panel hoja-editor[posture='composer'] .hoja-editor__footer {
        min-height: var(--sh-chat-compact-target);
        padding-inline-end: 7rem;
      }

      /* Compact chat already names both key behaviors in .composer-heading.
         Repeating the same sentence inside Hoja competes with formatting and
         reference targets, and can collapse to a meaningless single glyph. */
      sh-chat-panel hoja-editor[posture='composer'] .hoja-editor__key-hint {
        display: none;
      }

      sh-chat-panel .clear-button {
        right: 58px;
        bottom: 5px;
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
        font-size: 20px;
      }

      sh-chat-panel .send-button {
        right: 5px;
        bottom: 5px;
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
      }

      sh-chat-panel .scroll-to-bottom {
        right: 12px;
        bottom: 12px;
        width: var(--sh-chat-compact-target);
        height: var(--sh-chat-compact-target);
      }

      /* Compact conversation: one calm identity row, then session controls. */
      sh-chat-panel .chat-chrome {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'identity actions'
          'model slots';
        gap: 3px 8px;
        padding: max(8px, env(safe-area-inset-top)) 12px 9px;
        background: var(--mn-color-surface-chrome, #f5f3ed);
      }
      sh-chat-panel .super-bar-identity {
        min-height: 42px;
        padding-inline: 4px;
      }
      sh-chat-panel .super-bar-icon { font-size: 17px; color: var(--mn-color-text-accent, #376d57); }
      sh-chat-panel .super-bar-sophia { font-size: 17px; letter-spacing: -0.025em; text-transform: none; }
      sh-chat-panel .super-bar-sep { display: none; }
      sh-chat-panel .super-bar-chat-title {
        padding-left: 8px;
        border-left: 1px solid var(--mn-color-border-subtle, #d8ded9);
        font-size: 12px;
      }
      sh-chat-panel .header-status { display: none; }
      sh-chat-panel .model-selector-trigger {
        min-height: 36px;
        border-radius: 12px;
        background: var(--mn-color-surface-raised, #fff);
      }
      sh-chat-panel .slot-indicator {
        width: 36px;
        height: 36px;
        border-radius: 11px;
      }
      sh-chat-panel .messages-container { padding: 18px 16px 24px; }
      sh-chat-panel .empty-state {
        gap: 7px;
        padding: clamp(16px, 4vh, 32px) 4px 14px;
      }
      sh-chat-panel .empty-icon {
        width: 56px;
        height: 56px;
        margin-bottom: 5px;
        border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #d8ded9));
        border-radius: 18px;
        background: var(--mn-color-surface-accent, #edf6ef);
        opacity: 1;
      }
      sh-chat-panel .empty-eyebrow { font-size: 10px; }
      sh-chat-panel .empty-title { font-size: clamp(25px, 7vw, 31px); letter-spacing: -0.04em; }
      sh-chat-panel .empty-description { max-width: 31ch; font-size: 14px; line-height: 1.45; }
      sh-chat-panel .empty-suggestions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        max-width: 100%;
        margin-top: 15px;
        padding-top: 0;
        border-top: 0;
      }
      sh-chat-panel .suggestion-btn {
        min-height: 64px;
        align-items: flex-start;
        padding: 9px 14px;
        border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #d8ded9));
        border-radius: 14px;
        background: var(--mn-color-surface-raised, #fff);
        box-shadow: var(--mn-garden-card-shadow, none);
        font: 13px/1.35 var(--mn-font-sans, system-ui, sans-serif);
      }
      sh-chat-panel .suggestion-icon { color: var(--mn-color-text-accent, #376d57); }
      sh-chat-panel .composer {
        padding: 11px 12px calc(11px + var(--mn-viewport-inset-bottom, env(safe-area-inset-bottom)));
        border-top-color: var(--mn-color-border-subtle, #d8ded9);
        background: var(--mn-color-surface-chrome, #f5f3ed);
      }
      sh-chat-panel .composer-heading { margin-bottom: 8px; }
      sh-chat-panel .composer-label { font-size: 14px; }
      sh-chat-panel .composer-hint { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      sh-chat-panel *,
      sh-chat-panel *::before,
      sh-chat-panel *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0ms !important;
      }
    }

    /* Skin material roles. These live after the light/dark rules so the 98 and
       Glass token sets can carry every small chat corner through one inherited
       seam, even when this panel is mounted inside <sh-chat-host>'s shadow root. */
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) {
      scrollbar-color: var(--mn-scrollbar-thumb-solid, auto) var(--mn-scrollbar-track, transparent);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .super-bar {
      background: var(--mn-chat-superbar-bg, color-mix(in srgb, var(--mn-color-surface-chrome, #f3f4f6) 52%, transparent));
      color: var(--mn-chat-superbar-text, var(--mn-color-text-primary));
      box-shadow: var(--mn-shadow-chrome, none);
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .super-bar-sophia {
      color: var(--mn-chat-superbar-text, var(--mn-color-text-primary));
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .super-bar-icon,
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .super-bar-sep,
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .super-bar-chat-title {
      color: var(--mn-chat-superbar-text-muted, var(--mn-color-text-secondary));
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .header {
      background: var(--mn-chat-header-bg, color-mix(in srgb, var(--mn-color-surface-panel, #fff) 82%, transparent));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .messages-container {
      background: var(--mn-chat-transcript-bg, var(--mn-color-surface-base, #fff));
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .message.assistant .message-bubble {
      background: var(--mn-chat-assistant-bg, var(--mn-color-surface-subtle, #f5f5f5));
      box-shadow: var(--mn-shadow-card, none);
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .message.user .message-bubble {
      background: var(--mn-chat-user-bg, var(--mn-color-accent, #2563eb));
      box-shadow: var(--mn-shadow-primary, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(
      .slot-indicator,
      .icon-button,
      .model-selector-trigger,
      .scroll-to-bottom,
      .message-action-btn,
      .code-copy-btn,
      .composer-control-option,
      .banner-action,
      .clear-button,
      .send-button,
      .prompt-submit
    ) {
      border: var(--mn-chat-control-border, revert-layer);
      border-radius: var(--mn-radius-control, 6px);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(
      .slot-indicator,
      .icon-button,
      .model-selector-trigger,
      .scroll-to-bottom,
      .message-action-btn,
      .code-copy-btn,
      .composer-control-option,
      .banner-action,
      .clear-button
    ) {
      background: var(--mn-chat-control-bg, revert-layer);
      box-shadow: var(--mn-chat-control-shadow, revert-layer);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(
      .slot-indicator,
      .icon-button,
      .model-selector-trigger,
      .scroll-to-bottom,
      .message-action-btn,
      .code-copy-btn,
      .composer-control-option,
      .banner-action,
      .clear-button
    ):active {
      background: var(--mn-control-background-active, revert-layer);
      box-shadow: var(--mn-control-shadow-active, revert-layer);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(
      .model-picker,
      .chat-message-menu,
      .prompt-card,
      .tool-call,
      .surface-action,
      .composer-control-group
    ) {
      border-radius: var(--mn-radius-surface, 8px);
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.model-picker, .chat-message-menu) {
      background: var(--mn-color-surface-elevated);
      box-shadow: var(--mn-shadow-popover);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.prompt-card, .tool-call, .surface-action, .composer-control-group) {
      background: var(--mn-color-surface-raised);
      box-shadow: var(--mn-shadow-card, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .composer {
      background: var(--mn-chat-header-bg, var(--mn-color-surface-panel));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) hoja-editor[posture='composer'] .hoja-editor__frame,
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .prompt-freeform-input,
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .prompt-option-preview,
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) .transcript-json {
      box-shadow: var(--mn-control-shadow-active, none);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.messages-container, .model-picker-providers, .model-picker-models, .history-list)::-webkit-scrollbar {
      width: 13px;
      height: 13px;
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.messages-container, .model-picker-providers, .model-picker-models, .history-list)::-webkit-scrollbar-track {
      background: var(--mn-scrollbar-track, transparent);
    }
    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.messages-container, .model-picker-providers, .model-picker-models, .history-list)::-webkit-scrollbar-thumb {
      border: 2px solid transparent;
      border-radius: var(--mn-radius-control, 8px);
      background: var(--mn-scrollbar-thumb, var(--mn-color-border-strong));
      background-clip: padding-box;
      box-shadow: var(--mn-control-shadow, none);
    }

    /* VOICE PICKER — a searchable catalogue with the House default pinned and the
       facts a person weighs (price, context, tools) on every entry. */
    sh-chat-panel .header-left {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      min-width: 0;
    }

    sh-chat-panel .model-picker-search {
      flex: 0 0 auto;
      padding: 8px 10px;
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
    }

    sh-chat-panel .model-picker-search-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #1a1a1a);
      font: 13px/1.3 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .model-picker-search-input:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: -1px;
    }

    sh-chat-panel .model-picker-pinned {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      padding: 4px 0 6px;
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
      background: color-mix(in srgb, var(--mn-color-accent, #587a69) 7%, var(--mn-color-surface-raised, #f5f5f5));
    }

    sh-chat-panel .model-picker-group-label {
      display: block;
      padding: 8px 14px 2px;
      color: var(--mn-color-text-tertiary, #7e7a72);
      font: 650 10px/1.2 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    sh-chat-panel .model-picker-model-note {
      color: var(--mn-color-text-secondary, #6b6b6b);
      font-size: 11px;
      font-weight: 400;
    }

    sh-chat-panel .model-picker-model-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 8px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: 400 11px/1.4 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-variant-numeric: tabular-nums;
    }

    sh-chat-panel .model-picker-model.selected .model-picker-model-meta,
    sh-chat-panel .model-picker-model.selected .model-picker-model-note {
      color: inherit;
      opacity: 0.85;
    }

    sh-chat-panel .voice-badge {
      padding: 0 6px;
      border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
      border-radius: 999px;
      font-size: 10px;
      line-height: 16px;
      letter-spacing: 0.02em;
    }

    sh-chat-panel .voice-badge.no-tools {
      color: var(--mn-color-text-tertiary, #9b9b9b);
    }

    sh-chat-panel .voice-badge.premium {
      color: var(--mn-color-warning-text, #92400e);
    }

    /* The multiple of House: a quiet fact beside the price, not a verdict. */
    sh-chat-panel .voice-multiple {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* The one question before a premium voice. It sits above the list, where a scroll
       cannot hide it. */
    sh-chat-panel .model-picker-confirm {
      display: flex;
      flex: 0 0 auto;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
      font: 12px/1.4 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .model-picker-confirm-copy {
      display: flex;
      min-width: 0;
      flex: 1 1 180px;
      flex-direction: column;
      gap: 1px;
    }

    sh-chat-panel .model-picker-confirm-copy strong {
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .model-picker-confirm-actions {
      display: inline-flex;
      gap: 6px;
    }

    sh-chat-panel .model-picker-confirm-actions button {
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }

    sh-chat-panel .model-picker-confirm-actions .model-picker-confirm-accept {
      background: color-mix(in srgb, currentColor 12%, transparent);
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .model-picker-confirm-actions button:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 1px;
    }

    sh-chat-panel .model-picker-model:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    /* The count rides in CSS so a provider button's text stays just its name. */
    sh-chat-panel .model-picker-provider::after {
      margin-left: 6px;
      color: var(--mn-color-text-tertiary, #9b9b9b);
      content: attr(data-count);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    sh-chat-panel .model-picker-empty {
      padding: 16px 14px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: 13px/1.4 var(--mn-font-sans, system-ui, sans-serif);
    }

    sh-chat-panel .model-picker-foot {
      display: flex;
      flex: 0 0 auto;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      border-top: 1px solid var(--mn-color-border, #e5e5e5);
      color: var(--mn-color-text-tertiary, #7e7a72);
      font: 11px/1.3 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
    }

    sh-chat-panel .account-note {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: baseline;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: 11px/1.3 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    sh-chat-panel .account-note.low {
      color: var(--mn-color-warning-text, #92400e);
      border-color: color-mix(in srgb, currentColor 40%, transparent);
    }

    sh-chat-panel .account-note.out {
      color: var(--mn-color-danger, #b91c1c);
      border-color: color-mix(in srgb, currentColor 40%, transparent);
    }

    sh-chat-panel .account-note-value {
      color: var(--mn-color-text-primary, #1a1a1a);
      font-weight: 650;
    }

    sh-chat-panel .account-note-action {
      padding: 0 2px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    sh-chat-panel .account-note-action:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 2px;
    }

    /* The line beside a reply (its cost): quiet, so it is read only by the person who looks. */
    sh-chat-panel .message-annotation {
      color: var(--mn-color-text-tertiary, #9b9b9b);
      font-variant-numeric: tabular-nums;
    }

    /* VOICE MARKS + THE SEAM — the window is what was sent, read-only, in the
       voice the record names; the seam is where this conversation begins. */
    sh-chat-panel .message-voice {
      color: var(--mn-color-text-tertiary, #9b9b9b);
    }

    sh-chat-panel .message-voice[data-voice-basis='unrecorded'] {
      font-style: italic;
    }

    sh-chat-panel .window-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 4px 8px;
      color: var(--mn-color-text-tertiary, #7e7a72);
      font: 12px/1.4 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
    }

    sh-chat-panel .window-open-original {
      min-height: 24px;
      padding: 2px 4px;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2563eb));
      cursor: pointer;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    sh-chat-panel .window-open-original:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2563eb);
      outline-offset: 2px;
    }

    sh-chat-panel .seam {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin: 4px 0 2px;
      padding: 10px 0;
      border-top: 1px solid var(--mn-color-border, #e5e5e5);
      border-bottom: 1px solid var(--mn-color-border, #e5e5e5);
      color: var(--mn-color-text-secondary, #6b6b6b);
      font: 12px/1.4 var(--mn-font-utility, var(--mn-font-sans, system-ui, sans-serif));
      text-align: center;
    }

    sh-chat-panel .seam-line {
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
    }

    sh-chat-panel .seam-notice {
      max-width: 34rem;
      color: var(--mn-color-text-tertiary, #7e7a72);
      font-size: 11px;
    }

    /* Window messages are quiet: no accent dot, no filled bubble. */
    sh-chat-panel .message.assistant.window .message-author::before {
      display: none;
    }

    sh-chat-panel .message.assistant.window .message-bubble {
      border-left-color: var(--mn-color-border-strong, #cfcfcf);
    }

    sh-chat-panel .message.user.window .message-bubble {
      border: 1px solid var(--mn-color-border, #e5e5e5);
      background: var(--mn-color-surface-raised, #f5f5f5);
      color: var(--mn-color-text-primary, #1a1a1a);
      box-shadow: none;
    }

    /* THE COMPOSER NOTICE (a refusal for credit, the size limit). */
    sh-chat-panel .composer-notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      padding: 8px 12px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 13px;
    }

    sh-chat-panel .composer-notice.warning {
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
    }

    sh-chat-panel .composer-notice.blocked {
      background: var(--mn-color-danger-surface, #fff1f2);
      color: var(--mn-color-danger, #b91c1c);
    }

    sh-chat-panel .composer-notice-copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    sh-chat-panel .composer-notice-copy strong {
      color: currentColor;
      font-weight: var(--mn-font-weight-semibold, 600);
    }

    sh-chat-panel .composer-notice-detail {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
    }

    /* The notice's controls: its action, and the one that puts it away. */
    sh-chat-panel .composer-notice-actions {
      display: flex;
      flex: 0 0 auto;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    sh-chat-panel[data-theme='dark'] .model-picker-search-input {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-overlay, #1f1f1f);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .model-picker-pinned {
      background: color-mix(in srgb, var(--mn-color-accent, #7fa995) 10%, var(--mn-color-surface-elevated, #242424));
    }

    sh-chat-panel[data-theme='dark'] :is(.model-picker-search, .model-picker-pinned, .model-picker-foot, .account-note, .seam) {
      border-color: var(--mn-color-border-default, #333);
    }

    sh-chat-panel[data-theme='dark'] .account-note-value {
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .message.user.window .message-bubble {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #242424);
      color: var(--mn-color-text-primary, #e8e8e8);
    }

    sh-chat-panel[data-theme='dark'] .composer-notice {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #242424);
    }

    /* Phone: the search box and the account chip are touch-sized, the notice
       stacks, and the account chip yields width to the picker. */
    @media (max-width: 600px) {
      sh-chat-panel .header-left {
        gap: 6px;
      }

      sh-chat-panel .header-left .model-dropdown {
        flex: 1 1 0;
        width: auto;
        min-width: 0;
      }

      sh-chat-panel .model-picker-search {
        padding: 8px;
      }

      sh-chat-panel .model-picker-search-input {
        min-height: var(--sh-chat-compact-target);
        font-size: 16px;
      }

      sh-chat-panel .model-picker-pinned {
        flex: 0 0 auto;
      }

      sh-chat-panel .model-picker-body.search {
        display: flex;
        flex-direction: column;
      }

      sh-chat-panel .model-picker-group-label {
        padding: 10px 12px 2px;
      }

      sh-chat-panel .model-picker-model-meta {
        font-size: 12px;
      }

      sh-chat-panel .account-note {
        min-height: 32px;
        align-items: center;
      }

      /* The balance line's button is a touch target, but the chip it sits in keeps its height:
         the hit area reaches past the chip's edge instead of making the chip a slab. */
      sh-chat-panel .account-note-action {
        min-height: var(--sh-chat-compact-target);
        margin-block: calc((32px - var(--sh-chat-compact-target)) / 2);
        padding-inline: 6px;
      }

      /* The premium question's two answers: the same target, side by side or stacked. */
      sh-chat-panel .model-picker-confirm-actions button {
        min-height: var(--sh-chat-compact-target);
        padding-inline: 14px;
      }

      sh-chat-panel .composer-notice {
        flex-direction: column;
        align-items: stretch;
      }

      sh-chat-panel .window-open-original {
        min-height: var(--sh-chat-compact-target);
        padding-inline: 8px;
      }

      sh-chat-panel :is(.turn-change-open, .turn-change-history) {
        min-height: var(--sh-chat-compact-target);
      }

      /* The composer's room is the phone's scarcest: the access line keeps its one sentence. */
      sh-chat-panel .chat-access-detail {
        display: none;
      }
    }

    /* WHAT THE CHAT MAY DO HERE: one quiet line above the composer, in the host's words. */
    sh-chat-panel .chat-access {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
      margin: 0 2px 7px;
      color: var(--mn-color-text-secondary, #5f5b54);
      font: 12px/1.4 var(--mn-font-chrome, system-ui, sans-serif);
    }

    sh-chat-panel .chat-access::before {
      content: '';
      flex: 0 0 auto;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      align-self: center;
      background: var(--mn-color-accent, #2d6a4f);
    }

    sh-chat-panel .chat-access[data-access='read']::before {
      background: transparent;
      box-shadow: inset 0 0 0 1.5px var(--mn-color-text-tertiary, #817d75);
    }

    sh-chat-panel .chat-access-label {
      color: var(--mn-color-text-primary, #282622);
      font-weight: 600;
    }

    sh-chat-panel .chat-access-detail {
      color: var(--mn-color-text-tertiary, #817d75);
    }

    /* CHANGED IN THIS TURN: what a reply changed, and the way back (History), never an undo button. */
    sh-chat-panel .turn-changes {
      box-sizing: border-box;
      max-width: 100%;
      margin: 6px 0 2px;
      padding: 8px 10px;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-subtle, #f8f7f4);
      font: 12px/1.45 var(--mn-font-chrome, system-ui, sans-serif);
    }

    sh-chat-panel .turn-changes-title {
      margin-bottom: 4px;
      color: var(--mn-color-text-tertiary, #817d75);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    sh-chat-panel .turn-change-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    sh-chat-panel .turn-change {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
      min-width: 0;
    }

    sh-chat-panel .turn-change-verbs {
      flex: 0 0 auto;
      color: var(--mn-color-text-secondary, #5f5b54);
    }

    sh-chat-panel :is(.turn-change-name, .turn-change-open) {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #282622);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    sh-chat-panel :is(.turn-change-open, .turn-change-history) {
      max-width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    sh-chat-panel .turn-change-open {
      flex: 0 1 auto;
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
      text-underline-offset: 2px;
    }

    sh-chat-panel .turn-change-history {
      flex: 0 0 auto;
      color: var(--mn-color-accent, #2d6a4f);
      font-weight: 600;
    }

    sh-chat-panel :is(.turn-change-open, .turn-change-history):hover {
      text-decoration-color: currentColor;
    }

    sh-chat-panel :is(.turn-change-open, .turn-change-history):focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #376d57);
      outline-offset: 2px;
      border-radius: 3px;
    }

    sh-chat-panel .turn-change-note {
      flex: 1 1 100%;
      color: var(--mn-color-text-tertiary, #817d75);
    }

    /* Gone for good (a whole document with its history, a folder, a wire): shown apart. */
    sh-chat-panel .turn-change.removed :is(.turn-change-verbs, .turn-change-note) {
      color: var(--mn-color-text-danger, var(--mn-color-danger, #9f3535));
    }

    sh-chat-panel .turn-change.removed .turn-change-name {
      color: var(--mn-color-text-secondary, #5f5b54);
      text-decoration: line-through;
    }

    sh-chat-panel .turn-change-pending {
      color: var(--mn-color-text-tertiary, #817d75);
    }

    sh-chat-panel .turn-changes-refused {
      margin: 4px 0 0;
      color: var(--mn-color-text-secondary, #5f5b54);
    }

    /* A written HTML artifact, live (scripts off): the host's <mn-artifact-view>, framed under the reply. */
    sh-chat-panel .turn-artifact-preview {
      box-sizing: border-box;
      height: clamp(220px, 42vh, 380px);
      max-width: 100%;
      margin: 6px 0 2px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border, #e5e5e5);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-base, #fff);
    }

    sh-chat-panel[data-theme='dark'] .turn-changes {
      border-color: var(--mn-color-border-default, #333);
      background: var(--mn-color-surface-raised, #242424);
    }

    sh-chat-panel:is([data-skin='98'], [data-skin='glass'], [data-skin='hotdog-stand']) :is(.turn-changes, .turn-artifact-preview) {
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised);
      box-shadow: var(--mn-shadow-card, none);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-chat-panel': ShChatPanel
  }
}
