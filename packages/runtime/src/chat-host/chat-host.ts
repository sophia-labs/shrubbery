/**
 * chat-host.ts — <sh-chat-host>, the live Class-B CHAT HOST (C3).
 *
 * The chat analog of <sh-editor-host>. It mounts ONCE and SURVIVES the surrounding
 * spine re-rendering — and for chat this is MORE load-bearing than for the editor:
 * the chat host's whole RAISON D'ÊTRE is to stay live while grow_interface (W2)
 * mutates the surrounding interface around it. A remount would blank the
 * conversation + drop an in-flight stream + lose the composer draft.
 *
 * THE MOVE (mirrors editor-host EXACTLY):
 *   - the host receives the assembled `ChatService` (the imperative seam) as a
 *     PROP (`.service`) — the SHELL assembles it (assembleChatServices), the host
 *     never mints it (the editor analog: the host receives the binding the shell
 *     opened, it does not open the provider);
 *   - the host builds the `ChatServiceStore` ITSELF in connectedCallback (the
 *     editor analog builds nothing extra, but the principle is the same: the host
 *     owns the reactive wrapper internally);
 *   - the host holds <sh-chat-panel> as a child it creates ONCE (in firstUpdated,
 *     appended to a STABLE mount <div> in its shadow — mirror editor-host's
 *     `.editor-mount` stable target). The panel element is NEVER re-created across
 *     host re-renders — it lives OUTSIDE Lit's template churn, mounted
 *     imperatively, exactly like editor-host holds the live EditorView in `_editor`.
 *   - on every store tick the host does `Object.assign(panel,
 *     buildChatKernelOptions(store, () => store.getState()))` — the lifted
 *     bind-on-tick loop from atelier's mountChat();
 *   - the session is SHELL POLICY: it arrives via the `.sessionId` prop (the shell
 *     created it via svc.createSession), and the host calls store.setSession on
 *     first connect + whenever the prop changes (the editor analog: provider
 *     identity arrives via the binding, never minted by the host).
 *
 * ISLAND DISCIPLINE: this file lives in the chat-host/ SUBDIR (not top-level →
 * not island-scanned), so it may legally side-effect-import @shrubbery/chat-kernel
 * (which registers <sh-chat-panel> + carries lit/the kernel) and the sibling
 * chat-services seam. The runtime TOP-LEVEL island scan never reaches here — the
 * kernel stays pure (its own src never imports the host/store).
 *
 * MOUNT-ONCE (mount placement): the shell mounts <sh-chat-host> through
 * mountChatHost() (the chat analog of mountEditorHost) — a LITERAL-CONSTANT
 * keyed() ChildPart at a FIXED FINAL template slot, so an interface-grow that
 * changes the surrounding array length never shifts the keyed index. The service +
 * sessionId flow as PROPS; a value change re-renders but never re-creates the node.
 *
 * HONEST CAVEAT: happy-dom has no layout engine; pixel/positioning concerns are
 * Playwright territory, DEFERRED. The survival/identity/hydration/streaming
 * SEMANTICS are all provable structurally in happy-dom over the real organism.
 */

import { LocaleController, t } from '@shrubbery/nucleus'
// Importing the kernel registers <sh-chat-panel> (the upgrade seam). This
// side-effect import is in the RUNTIME subdir, NOT the kernel, so the kernel
// purity gate is unaffected (the kernel never imports the host/store).
import '@shrubbery/chat-kernel'
import './continue-chooser.js'
import './chat-artifact-preview.js'
import { LitElement, html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type {
  ChangeSubject,
  ChatArtifactPreviewRequest,
  ChatChangeIntent,
  ChatDraftChangeReason,
  ChatMessage,
  ChatPresentation,
  ChatSeamAction,
  ChatSendContext,
  ChatSessionAction,
  ChatSessionSlot,
  CodeCopyIntent,
  HeaderActionKind,
  HojaComposerDetail,
  HojaWikiLinkResolver,
  MessageActionKind,
  MessageActionResult,
  ShChatPanel,
  SurfaceActionIntent,
} from '@shrubbery/chat-kernel'
import type { ChatService, ContinueIntent, ConversationLineage } from '../chat-services/chat-service.js'
import type { ArchivedConversation } from '../chat-services/conversation-archive.js'
import type { ContinuationPlan } from '../chat-services/continuation.js'
import type { CreditsFacts } from '../chat-services/credits-facts.js'
import { buildChatKernelOptions } from '../chat-services/assemble.js'
import {
  ADD_CREDITS_ACTION,
  CREDITS_NOTICE_DETAILS_ACTION,
  CREDITS_NOTICE_DISMISS_ACTION,
  NEW_CHAT_ACTION,
  costAnnotation,
  creditsNoticeFor,
  type ChatCreditsNoticeSource,
} from '../chat-services/chat-billing.js'
import { CANNOT_CONTINUE } from '../chat-services/sobremesa-contract.js'
import { liveExportSource, importedExportSource, type ConversationExportSource, type MarkdownFile } from '../chat-services/conversation-export.js'
import { createConversationHomeController, type ConversationHomeController } from '../chat-services/conversation-home-controller.js'
import { isPlaceholderTitle } from '../chat-services/conversation-home.js'
import { createImportedReader, type ContinueConversationIntent, type ImportedReader } from '../chat-services/imported-reader.js'
import { createSaveFlow, type SaveFlow } from '../chat-services/save-flow.js'
import { createChatServiceStore, type ChatServiceStore } from './chat-service-store.js'
import type { ContinueConfirmDetail, ContinuePhase } from './continue-chooser.js'
import { conversationHomeStyles, renderConversationHome, renderImportedReader, renderSaveDialog } from './conversation-archive-view.js'
import { CHAT_CONTINUE_EVENT, type ConversationHomePorts } from './conversation-home-ports.js'
import { downloadMarkdownFile } from './download-file.js'
import type { ChatArtifactPreviewPort } from './chat-artifact-preview.js'

/** Generic shell seam for every message-level action the pure kernel emits. */
export const CHAT_MESSAGE_ACTION_EVENT = 'mn-chat-message-action'
export const CHAT_CODE_COPY_EVENT = 'mn-chat-code-copy'
/**
 * The shell asks the chat to put words in the composer (a passage quoted from the Reader, say): a `detail` of
 * `{ text, handled? }` on the document. The text is added to the draft of the conversation shown, never sent; the host
 * sets `handled` when it was here to take it.
 */
export const CHAT_COMPOSE_EVENT = 'mn-chat-compose'
export const CHAT_HEADER_ACTION_EVENT = 'mn-chat-header-action'
export const CHAT_SESSION_ACTION_EVENT = 'mn-chat-session-action'
/**
 * "Continue with…": a shell raises this on the host (bubbling, composed, `detail` a
 * {@link ContinueIntent}) and the host runs the flow behind it. The host's
 * `continueWith(intent)` does the same, and is what the conversation reader's own
 * `onContinue` callback should call: the reader draws "Continue with…" only when the shell
 * gives it one (`onContinue: intent => host.continueWith(intent)`). Named apart from the
 * reader's own event (`mn-chat-continue-conversation`) on purpose: two things of one name
 * would collide the day the two branches meet.
 */
export const CHAT_CONTINUE_WITH_EVENT = 'sh-chat-continue'
/**
 * "…open the original": a continued conversation's seam asks the shell to open the
 * imported conversation it picked up. `detail` is its lineage
 * (`{ archiveConversationUrn, revisionId, title }`); how the shell opens it is the shell's.
 */
export const CHAT_OPEN_ORIGINAL_EVENT = 'sh-chat-open-original'
/**
 * "Add credits": the person chose to add credits, from the refusal banner or from the
 * balance line's own button. The chat does not sell credits and does not know how they are
 * bought: it raises this (bubbling, composed) and whatever owns Settings, Billing takes it
 * from there. `detail` says what the person needs to know: {@link ChatAddCreditsDetail}.
 */
export const CHAT_ADD_CREDITS_EVENT = 'sh-chat-add-credits'

/** What the chat knows when the person asks to add credits. Amounts are micro-USD; null where nothing is known. */
export interface ChatAddCreditsDetail {
  /**
   * Where the person asked: the refusal banner, the balance line, or "Details" on the heads-up that
   * credits are starting. The last is a request to open Billing, not to buy: it names no shortfall.
   */
  readonly source: 'refusal' | 'balance-line' | 'notice'
  /** Their balance: what the platform said when it refused, else what the balance line last read. */
  readonly balanceMicroUsd: number | null
  /** What one message needs at the least: what the platform said when it refused, else the smallest call the voice in use takes. */
  readonly requiredMicroUsd: number | null
}

/**
 * What the shell lets the chat do about credits. Every field is the shell's to grant. A shell that
 * grants none gets the voices release's chat: each reply shows what it cost, there is no balance line
 * and no "Add credits", so a workspace that cannot sell credits (a local one) never shows a button that
 * goes nowhere. The credits release grants both, for a hosted account only.
 */
export interface ChatHostCredits {
  /** Show the credit balance line beside the voice picker (`showBalance` on the host). */
  readonly showBalance?: boolean
  /** The shell answers {@link CHAT_ADD_CREDITS_EVENT}, so "Add credits" is offered (`canAddCredits` on the host). */
  readonly canAddCredits?: boolean
  /**
   * The heads-up that credits are starting (`creditsNotice` on the host): a source the chat reads, listens
   * to and reports Dismiss to. The shell owns the words and who has put it away; the day and the fee are
   * the BACKEND's (Vera, 2026-10-03), so the chat hands the source what the backend said on its last
   * balance read (`current(facts)`, `dismiss(facts)`) and a source answers null until a day is named.
   */
  readonly notice?: ChatCreditsNoticeSource
}

/**
 * A "Changed in this turn" link was chosen (open a document, its History, an artifact or its revisions).
 * Raised (bubbling, composed) beside the shell's `workspace.onChangeAction`; `detail` is the intent.
 */
export const CHAT_CHANGE_ACTION_EVENT = 'sh-chat-change-action'

/**
 * What the shell lets the workspace chat do with what a turn changed (the empowered-chat release). Every
 * field is the shell's to grant; a shell that grants none gets the strip without links and no preview.
 */
export interface ChatHostWorkspace {
  /** Route a change link, always in the chat's own graph: the document, its History, the artifact, its revisions. */
  readonly onChangeAction?: (intent: ChatChangeIntent) => void
  /** A name the shell knows for a document or artifact a turn did not name. */
  readonly changeTitle?: (subject: ChangeSubject, id: string) => string | null
  /** Read and watch an artifact the chat previews live (scripts off). Absent: no preview. */
  readonly artifactPreview?: ChatArtifactPreviewPort
}

/** What a shell must send for the host to act on it: the shape of an archive conversation, not any object. */
function isContinueIntent(value: unknown): value is ContinueIntent {
  if (value == null || typeof value !== 'object') return false
  const intent = value as Record<string, unknown>
  return typeof intent.conversationId === 'string'
    && /^urn:sophia:conversation-archive:conversation:[a-f0-9]{64}$/.test(intent.conversationId)
    && typeof intent.revisionId === 'string'
    && /^[a-f0-9]{64}$/.test(intent.revisionId)
    && typeof intent.title === 'string'
    && typeof intent.messagesLoaded === 'number'
}

/** Where the chooser is: reading the old conversation, choosing a voice, starting, or refused with words. */
type ContinueState =
  | { readonly phase: 'reading'; readonly intent: ContinueIntent }
  | { readonly phase: 'choosing' | 'starting'; readonly intent: ContinueIntent; readonly plan: ContinuationPlan }
  | { readonly phase: 'refused'; readonly intent: ContinueIntent; readonly message: string }

/**
 * The message buttons a LIVE chat can honour. Copy works. Read aloud and Regenerate
 * have no handler behind them anywhere, so they are not drawn; a message-level
 * "Save to Garden" would be ambiguous beside the conversation-level one in the
 * header, so it is not drawn either.
 */
const LIVE_MESSAGE_ACTIONS: readonly MessageActionKind[] = ['copy']
/** A chat that can branch (the self-host ride chat): "Branch from here" under the person's messages too. */
const LIVE_BRANCHING_MESSAGE_ACTIONS: readonly MessageActionKind[] = ['copy', 'branch']
/** An imported conversation can be copied from, message by message, and nothing else. */
const READER_MESSAGE_ACTIONS: readonly MessageActionKind[] = ['copy']
const PREPARING_DOWNLOAD = 'Preparing the download…'
const FOCUSABLE_IN_DRAWER =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export interface ChatMessageActionDetail {
  readonly messageId: string
  readonly action: MessageActionKind
  readonly message: ChatMessage | null
  readonly defaultHandled: boolean
  readonly error: string | null
}

export interface ChatMessageExportDetail {
  readonly message: ChatMessage
}

export interface ChatMessageRegenerateDetail {
  readonly messageId: string
  readonly message: ChatMessage | null
}

export interface ChatCodeCopyDetail extends CodeCopyIntent {
  readonly defaultHandled: boolean
  readonly error: string | null
}

export interface ChatHeaderActionDetail {
  readonly action: HeaderActionKind
  readonly sessionId: string | null
  readonly messages: readonly ChatMessage[]
  readonly defaultHandled: boolean
  readonly error: string | null
}

export interface ChatSessionActionDetail {
  readonly action: ChatSessionAction
  readonly sessionId: string | null
  readonly sessionTitle: string | null
  readonly activeSlot: ChatSessionSlot
  readonly slotSessions: readonly (string | null)[]
  readonly defaultHandled: boolean
  readonly error: string | null
}

export type {
  ChatPresentation,
  HojaComposerDetail,
  HojaWikiLinkResolver,
  HojaWikiLinkSuggestion,
} from '@shrubbery/chat-kernel'

/**
 * <sh-chat-host> — the one live chat panel node. Receives the assembled
 * ChatService + the shell-minted sessionId as props, owns the ChatServiceStore
 * internally, and drives an imperatively-held <sh-chat-panel> via the bind-on-tick
 * loop. Survives interface-grow re-renders because the panel lives outside Lit's
 * template churn (mounted into a stable shadow div).
 */
@customElement('sh-chat-host')
export class ShChatHost extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static styles = css`
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
    /* Full-screen is a projection of this exact custom element. Browsers with
       Popover API support place it in the top layer; this fixed posture is also
       the non-destructive fallback for older webviews. */
    :host([presentation='fullscreen']) {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-overlay, 1500);
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 0;
      background: var(--mn-color-surface-base, #fff);
      box-shadow: none;
    }
    /* The stable panel mount target — fills the host box. The imperatively-created
       <sh-chat-panel> is appended HERE once and never re-created. */
    .chat-mount {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      display: flex;
    }
    .chat-mount > sh-chat-panel {
      flex: 1 1 auto;
      min-height: 0;
    }
    .history-layer, .history-current, .continue-layer {
      display: contents;
    }
    .history-backdrop {
      position: absolute;
      inset: 0;
      z-index: 60;
      display: flex;
      justify-content: flex-end;
      background: var(--mn-color-backdrop, rgb(18 32 23 / 0.24));
    }
    .history-drawer {
      width: min(26rem, 100%);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-left: 1px solid var(--mn-color-border-subtle, #d8ded9);
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #fff));
      box-shadow: var(--mn-shadow-modal, -12px 0 32px rgb(15 30 20 / 0.17));
      color: var(--mn-color-text-primary, #18211b);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    .history-drawer[data-imported] { width: min(48rem, 100%); }
    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.625rem;
      min-height: 68px;
      box-sizing: border-box;
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
    }
    .history-title {
      margin: 0;
      font: 650 1.15rem/1.15 var(--mn-font-display, Georgia, serif);
      letter-spacing: -0.025em;
    }
    .history-actions {
      display: inline-flex;
      gap: 0.375rem;
      align-items: center;
    }
    .history-button {
      min-height: 36px;
      border: 1px solid var(--mn-garden-control-edge, var(--mn-color-border-subtle, #d8ded9));
      border-radius: 10px;
      background: var(--mn-garden-control-bg, var(--mn-color-surface-raised, #fff));
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 0.75rem;
      line-height: 1;
      padding: 0.45rem 0.7rem;
    }
    .history-button:hover {
      background: var(--mn-color-surface-hover, #eef2f7);
    }
    .history-button.icon {
      width: 36px;
      height: 36px;
      padding: 0;
      font-size: 1.15rem;
    }
    .history-button:focus-visible, .history-select:focus-visible, .history-input:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #376d57);
      outline-offset: 2px;
    }
    .history-button[data-chat-history-new] {
      border-color: var(--mn-color-text-accent-strong, #2d6a4f);
      background: var(--mn-color-text-accent-strong, #2d6a4f);
      color: var(--mn-color-surface-raised, #fff);
      font-weight: 650;
    }
    .history-status {
      padding: 1rem;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.85rem;
    }
    .history-status.error {
      color: var(--mn-color-danger-text, #b42318);
    }
    .history-list {
      min-height: 0;
      flex: 1 1 auto;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.75rem;
    }
    .history-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 0.25rem;
      align-items: center;
      width: 100%;
      box-sizing: border-box;
      min-height: 92px;
      margin-bottom: 0.5rem;
      padding: 0.375rem;
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: 13px;
      background: var(--mn-color-surface-raised, #fff);
    }
    .history-row[data-active] {
      border-color: var(--mn-garden-card-edge, #c2d7c8);
      background: var(--mn-color-surface-accent, #e9f5ef);
    }
    .history-select {
      min-width: 0;
      align-self: stretch;
      grid-column: 1 / -1;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 0.45rem 0.5rem;
      text-align: left;
    }
    .history-select:hover {
      background: var(--mn-color-surface-hover, #eef2f7);
      border-radius: var(--mn-radius-control, 6px);
    }
    .history-name {
      display: block;
      overflow: hidden;
      font-size: 0.875rem;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .history-meta {
      display: block;
      margin-top: 0.125rem;
      color: var(--mn-color-text-muted, #66736a);
      font-size: 0.72rem;
    }
    .history-inline {
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-column: 1 / -1;
      gap: 0.375rem;
      align-items: center;
    }
    .history-input {
      min-width: 0;
      border: var(--mn-control-border, 1px solid var(--mn-color-border-default, #d0d7de));
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #fff);
      color: var(--mn-color-text-primary, #1f2933);
      box-shadow: var(--mn-control-shadow-active, none);
      font: inherit;
      font-size: 0.875rem;
      padding: 0.45rem 0.5rem;
    }
    .history-row > .history-button {
      min-height: 32px;
      padding-inline: 0.5rem;
      border-color: transparent;
      background: transparent;
      color: var(--mn-color-text-secondary, #58665c);
    }
    .history-row > [data-chat-history-rename] { grid-column: 2; }
    .history-row > [data-chat-history-delete] { grid-column: 3; }
    .history-row > .history-button:hover { background: var(--mn-color-surface-hover, #edf6ef); }
    .history-row > [data-chat-history-delete] { color: var(--mn-color-text-danger, #9f3535); }
    @media (max-width: 600px) {
      .history-drawer { width: 100%; border-left: 0; }
      .history-header {
        min-height: calc(68px + env(safe-area-inset-top, 0px));
        padding-top: calc(0.875rem + env(safe-area-inset-top, 0px));
      }
      .history-button { min-height: 44px; }
      .history-button.icon { width: 44px; height: 44px; }
      .history-row { min-height: 96px; }
      .history-row > .history-button { min-height: 44px; }
    }
    ${conversationHomeStyles}
  `

  /**
   * The assembled imperative chat seam (the SHELL builds it via
   * assembleChatServices). The host wraps it in a ChatServiceStore internally and
   * never mints it — the editor analog of the injected binding.
   *
   * LOAD-BEARING: this is the survival anchor. The store + panel are rebuilt ONLY
   * when the service identity changes (a genuinely different backend). A re-render
   * that re-emits the SAME service keeps the live store + panel + conversation.
   */
  @property({ attribute: false })
  service: ChatService | null = null

  /**
   * The active session id — SHELL POLICY (which session/title). The shell created
   * it via svc.createSession; the host only binds it. A prop change rebinds the
   * store (which hydrates the prior conversation). null ⇒ no session bound yet.
   */
  @property({ type: String })
  sessionId: string | null = null

  /** Shell-controlled spatial posture. Switching it never rebuilds the host,
   * store, panel, transcript, stream, or composer. */
  @property({ type: String, reflect: true })
  presentation: ChatPresentation = 'rail'

  /** Shell-injected, graph-scoped lookup for Hoja references. The host only
   * forwards this pure seam; neither the panel nor Hoja knows Garden REST. */
  @property({ attribute: false })
  composerReferenceResolver?: HojaWikiLinkResolver

  /**
   * Shell-owned routing for agent-surfaced document/block actions. The chat
   * service/store owns turns and messages; opening a document is app-shell policy.
   */
  @property({ attribute: false })
  onSurfaceAction?: (action: SurfaceActionIntent) => void

  /**
   * Shell-owned routing for message-level actions after the host has run any
   * local default it owns (clipboard copy, Garden-compatible event bridging).
   */
  @property({ attribute: false })
  onMessageAction?: (detail: ChatMessageActionDetail) => void

  /** Shell-owned observer for code-block copy after the host clipboard default. */
  @property({ attribute: false })
  onCodeCopy?: (detail: ChatCodeCopyDetail) => void

  /** Shell-owned observer for header toolbar actions. */
  @property({ attribute: false })
  onHeaderAction?: (detail: ChatHeaderActionDetail) => void

  /** Shell-owned observer for session superbar actions. */
  @property({ attribute: false })
  onSessionAction?: (detail: ChatSessionActionDetail) => void

  /**
   * What only the shell can do for the history drawer and the imported reader:
   * where a copy may be saved, how to continue an imported conversation, how to
   * hand over a file, and the clock. Every port is optional; a missing one removes
   * the control that would have used it.
   */
  @property({ attribute: false })
  conversationHome?: ConversationHomePorts

  /**
   * What the shell lets the workspace chat do with what a turn changed: route its links, name what it
   * changed, preview an HTML artifact live. Written to the panel on every render, so a render that no
   * longer grants one takes it back.
   */
  @property({ attribute: false })
  workspace?: ChatHostWorkspace

  /** The store built over the current service (rebuilt only on service change). */
  private _store: ChatServiceStore | null = null

  /** The service the current _store was built for — identity-compared to decide
   * rebuild-vs-keep, exactly like editor-host's _editorProvider. */
  private _storeService: ChatService | null = null

  /** The imperatively-held live panel (created once, never re-created in render). */
  private _panel: ShChatPanel | null = null

  /** The store subscription teardown. */
  private _unsub: (() => void) | null = null

  /** The sessionId currently bound into the store (to detect prop changes). */
  private _boundSession: string | null = null

  /** Fallback cache for draft persistence when sessionStorage is unavailable. */
  private _draftFallback = new Map<string, string>()

  /** Optional rich sidecars retain marks and resolved ids beside legacy text. */
  private _richDraftFallback = new Map<string, HojaComposerDetail>()

  /** An explicit user clear must win over retained failed-send recovery. */
  private _explicitDraftClears = new Set<string>()

  /** Rich context captured across optimistic clear until delivery settles. */
  private _pendingRichDrafts = new Map<string, HojaComposerDetail>()

  private _themeObserver: MutationObserver | null = null

  @state()
  private historyOpen = false
  /** The "Continue with…" chooser, while there is one. */
  @state()
  private continuing: ContinueState | null = null

  /** Which continuation is the current one: a read or a start that belongs to an earlier one is let go. */
  private _continueRun = 0

  /**
   * The shell says it can take the person to add credits: it answers {@link CHAT_ADD_CREDITS_EVENT}
   * (the organism shell opens Settings, Billing through its Settings overlay: `connectChatCredits`).
   * Default false, and a shell grants it through `chatHost.credits`. Until it is set the chat offers no
   * "Add credits" anywhere (a button that goes nowhere is dead UI) and does not call an account "out of
   * credits" that is only low.
   */
  @property({ type: Boolean, attribute: false })
  canAddCredits = false

  /**
   * Whether the chat shows the credit balance line. Default false: the voices release (Vera,
   * 2026-09-30) shows what each reply cost but no balance until the credits release adds a way to
   * add credits. A refusal the gateway announces is shown either way.
   */
  @property({ type: Boolean, attribute: false })
  showBalance = false

  /**
   * The shell's heads-up that credits are starting (the credits release). A source the chat reads each
   * time it projects, listens to (a dismissal or new words show at once), and reports Dismiss to; the
   * shell owns the words, the date and who put it away. Absent: no heads-up. It shows only in the one
   * notice slot, after a refusal or the size limit, and its "Details" is offered only where
   * {@link canAddCredits} says the shell can take the person to Billing.
   */
  @property({ attribute: false })
  creditsNotice?: ChatCreditsNoticeSource

  /** The listening to {@link creditsNotice}, so a dismissal or new words are shown at once. */
  private _noticeUnsub: (() => void) | null = null

  /** A failed select, create, rename or delete in the list. */
  @state()
  private historyError: string | null = null

  @state()
  private editingSessionId: string | null = null

  @state()
  private editingTitle = ''

  /** A failed Continue or download in the imported reader. */
  @state()
  private readerActionError: string | null = null

  /** A line for the reader while something is in progress or just done. */
  @state()
  private readerNote: string | null = null

  private historyReturnFocus: HTMLElement | null = null

  /** The data behind the one conversation home; lives as long as the service it was made for. */
  private _home: ConversationHomeController | null = null
  private _homeService: ChatService | null = null
  private _homeUnsub: (() => void) | null = null

  /** The imported conversation being read, and the list row that opened it (for focus on the way back). */
  private _reader: ImportedReader | null = null
  private _readerUnsub: (() => void) | null = null
  private _readerOpener: string | null = null

  /** The Save to Garden / Download dialog, while it is open, and where focus returns when it closes. */
  private _save: SaveFlow | null = null
  private _saveUnsub: (() => void) | null = null
  private _saveReturnFocus: HTMLElement | null = null

  /** Whether showPopover() successfully promoted this host into the top layer. */
  private _usingTopLayer = false

  /** Defer the restore decision until inner light-DOM listeners have had their
   * chance to consume Escape (model picker, menus, and the Hoja suggestion UI). */
  private readonly _documentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat || this.presentation !== 'fullscreen') return
    if (this._save) {
      event.preventDefault()
      this._closeSaveDialog(true)
      return
    }
    if (this.historyOpen) {
      event.preventDefault()
      this._closeHistoryDrawer()
      return
    }
    queueMicrotask(() => {
      if (event.defaultPrevented || this.presentation !== 'fullscreen') return
      void this._handleHeaderAction('restore')
    })
  }

  private readonly _onContinueEvent = (event: Event): void => {
    const intent = (event as CustomEvent<unknown>).detail
    if (isContinueIntent(intent)) void this.continueWith(intent)
  }

  private readonly _onComposeEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ text?: unknown; handled?: boolean }>).detail
    if (!detail || typeof detail.text !== 'string' || !detail.text.trim()) return
    const sessionId = this._store?.getState().sessionId ?? this.sessionId
    const existing = this._readDraft(sessionId)?.trimEnd() ?? ''
    this._writeDraft(sessionId, existing ? `${existing}\n\n${detail.text}` : detail.text, null, 'edit')
    this._applyToPanel()
    detail.handled = true
    void this.updateComplete.then(async () => {
      const composer = this._panel?.querySelector<HTMLElement & { updateComplete?: Promise<unknown>; focusEnd?: () => void }>('hoja-editor[posture="composer"]')
      await composer?.updateComplete
      // The caret waits after the offered words, where the question goes.
      if (composer?.focusEnd) composer.focusEnd()
      else composer?.focus()
    })
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(CHAT_CONTINUE_WITH_EVENT, this._onContinueEvent)
    this.ownerDocument.addEventListener(CHAT_COMPOSE_EVENT, this._onComposeEvent)
    this.ownerDocument.addEventListener('keydown', this._documentKeyDown)
    this._observeAmbientTheme()
    this._reconcileStore()
    this._bindCreditsNotice()
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHAT_CONTINUE_WITH_EVENT, this._onContinueEvent)
    this.ownerDocument.removeEventListener(CHAT_COMPOSE_EVENT, this._onComposeEvent)
    this.ownerDocument.removeEventListener('keydown', this._documentKeyDown)
    this._leaveTopLayer()
    this._unsub?.()
    this._unsub = null
    this._releaseCreditsNotice()
    this._themeObserver?.disconnect()
    this._themeObserver = null
    super.disconnectedCallback()
  }

  override firstUpdated(): void {
    // Create the live <sh-chat-panel> ONCE and append it to the STABLE mount div
    // (mirror editor-host mounting the live EditorView into .editor-mount). It is
    // never re-created across host re-renders — it lives outside Lit's template.
    const mount = this.renderRoot?.querySelector('.chat-mount') as HTMLElement | null
    if (mount && !this._panel) {
      this._panel = this.ownerDocument.createElement('sh-chat-panel') as ShChatPanel
      mount.appendChild(this._panel)
      this._applyToPanel()
    }
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('service')) this._reconcileStore()
    if (changed.has('sessionId')) this._reconcileSession()
    if (changed.has('presentation')) {
      this._syncPresentation()
      this._applyToPanel()
    }
    if (changed.has('composerReferenceResolver')) this._applyToPanel()
    if (changed.has('onSurfaceAction')) this._applyToPanel()
    if (changed.has('onMessageAction')) this._applyToPanel()
    if (changed.has('onCodeCopy')) this._applyToPanel()
    if (changed.has('onHeaderAction')) this._applyToPanel()
    if (changed.has('onSessionAction')) this._applyToPanel()
    if (changed.has('workspace')) this._applyToPanel()
    if (changed.has('canAddCredits')) this._applyToPanel()
    if (changed.has('showBalance')) this._applyToPanel()
    if (changed.has('creditsNotice')) {
      this._bindCreditsNotice()
      this._applyToPanel()
    }
  }

  /** Listen to the shell's notice source (only that one, only while connected), and show what it says now. */
  private _bindCreditsNotice(): void {
    this._releaseCreditsNotice()
    const source = this.creditsNotice
    if (!source || !this.isConnected) return
    this._noticeUnsub = source.subscribe(() => this._applyToPanel())
  }

  private _releaseCreditsNotice(): void {
    this._noticeUnsub?.()
    this._noticeUnsub = null
  }

  /**
   * The heads-up as the slot takes it: the source's words now, given what the backend said on the last
   * read of the balance, or none. Never throws into a render.
   */
  private _creditsNoticeProjection(facts: CreditsFacts | null) {
    try {
      const view = this.creditsNotice?.current(facts) ?? null
      return view ? creditsNoticeFor(view, { details: this.canAddCredits }) : null
    } catch {
      return null
    }
  }

  /**
   * Rebuild the store ONLY when the service identity changes (mirror editor-host's
   * _reconcileEditor keying on provider identity). Same service ⇒ keep the live
   * store + subscription + conversation. Different service ⇒ tear down + rebuild.
   */
  private _reconcileStore(): void {
    if (this._storeService === this.service && this._store) {
      // Same service — keep the live store. Just (re)bind the session if needed.
      this._reconcileSession()
      return
    }
    this._unsub?.()
    this._unsub = null
    this._store?.dispose()
    this._store = null
    this._storeService = null
    this._boundSession = null
    // What the drawer knows belongs to the service it read it from.
    this._disposeHome()
    if (!this.service) {
      this._applyToPanel()
      return
    }
    const store = createChatServiceStore(this.service, {
      canAddCredits: () => this.canAddCredits,
      showBalance: () => this.showBalance,
      creditsNotice: facts => this._creditsNoticeProjection(facts),
    })
    this._store = store
    this._storeService = this.service
    // The bind-on-tick loop (lifted from atelier mountChat): on every store tick,
    // project the store into the kernel's pure props onto the live panel.
    this._unsub = store.subscribe(() => this._applyToPanel())
    this._reconcileSession()
    this._applyToPanel()
  }

  /** Bind the shell-minted sessionId into the store when it changes (hydrates the
   * prior conversation via the store's setSession). */
  private _reconcileSession(): void {
    const store = this._store
    if (!store) return
    if (this._boundSession === this.sessionId) return
    this._boundSession = this.sessionId
    store.setSession(this.sessionId)
  }

  private _draftKey(sessionId: string | null): string {
    return `garden:chat:draft:${sessionId || 'new'}`
  }

  private _richDraftKey(sessionId: string | null): string {
    return `garden:chat:draft:hoja:v1:${sessionId || 'new'}`
  }

  /** Keep the pure chat kernel on the same explicit theme as the surrounding
   * workspace. The panel lives in light DOM under this shadow root, so relying on
   * a distant [data-theme] selector leaves its auto theme stale after toggles. */
  private _observeAmbientTheme(): void {
    this._themeObserver?.disconnect()
    this._themeObserver = null
    const root = this.ownerDocument.documentElement
    const Observer = this.ownerDocument.defaultView?.MutationObserver
    if (!root || !Observer) return
    this._themeObserver = new Observer(() => this._applyToPanel())
    this._themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  }

  private _ambientTheme(): 'light' | 'dark' | 'auto' {
    const theme = this.ownerDocument.documentElement?.dataset.theme
    if (theme === 'light' || theme === 'dark') return theme
    return 'auto'
  }

  /** Promote the already-connected host into the browser top layer when
   * available. Failure leaves the fixed-position CSS fallback active. */
  private _syncPresentation(): void {
    if (this.presentation !== 'fullscreen') {
      this._leaveTopLayer()
      return
    }
    if (this._usingTopLayer) return
    const element = this as HTMLElement & { showPopover?: () => void }
    if (typeof element.showPopover !== 'function') return
    this.setAttribute('popover', 'manual')
    try {
      element.showPopover()
      this._usingTopLayer = true
    } catch {
      // A partially-supported or disconnected webview still gets the fixed
      // fallback. Removing [popover] avoids the UA's closed-popover display:none.
      this.removeAttribute('popover')
      this._usingTopLayer = false
    }
  }

  private _leaveTopLayer(): void {
    if (this._usingTopLayer) {
      const element = this as HTMLElement & { hidePopover?: () => void }
      try {
        element.hidePopover?.()
      } catch {
        // It may already have left the top layer during document teardown.
      }
    }
    this._usingTopLayer = false
    this.removeAttribute('popover')
  }

  private _draftStorage(): Storage | null {
    try {
      return this.ownerDocument.defaultView?.sessionStorage ?? null
    } catch {
      return null
    }
  }

  private _readDraft(sessionId: string | null): string | null {
    const key = this._draftKey(sessionId)
    const fallbackDraft = this._draftFallback.get(key)
    if (fallbackDraft != null) return fallbackDraft
    const storage = this._draftStorage()
    if (!storage) return null
    try {
      return storage.getItem(key)
    } catch {
      return null
    }
  }

  private _readRichDraft(
    sessionId: string | null,
    canonicalDraft: string,
  ): HojaComposerDetail | null {
    const key = this._richDraftKey(sessionId)
    const fallback = this._richDraftFallback.get(key)
    if (fallback?.value === canonicalDraft) return fallback
    const storage = this._draftStorage()
    if (!storage) return null
    try {
      const raw = storage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<HojaComposerDetail>
      if (
        parsed.value !== canonicalDraft
        || typeof parsed.plainText !== 'string'
        || typeof parsed.isEmpty !== 'boolean'
        || !parsed.json
        || !Array.isArray(parsed.references)
      ) return null
      return parsed as HojaComposerDetail
    } catch {
      return null
    }
  }

  private _writeRichDraft(sessionId: string | null, detail: HojaComposerDetail | null): void {
    const key = this._richDraftKey(sessionId)
    if (detail) this._richDraftFallback.set(key, detail)
    else this._richDraftFallback.delete(key)
    const storage = this._draftStorage()
    if (!storage) return
    try {
      if (detail) storage.setItem(key, JSON.stringify(detail))
      else storage.removeItem(key)
    } catch {
      // The canonical string remains authoritative if the optional sidecar fails.
    }
  }

  private _writeDraft(
    sessionId: string | null,
    draft: string,
    detail: HojaComposerDetail | null,
    reason: ChatDraftChangeReason,
  ): void {
    const key = this._draftKey(sessionId)
    if (draft) {
      this._draftFallback.set(key, draft)
      this._explicitDraftClears.delete(key)
      this._pendingRichDrafts.delete(key)
    } else {
      this._draftFallback.delete(key)
      if (reason === 'submit-clear') this._explicitDraftClears.delete(key)
      else {
        this._explicitDraftClears.add(key)
        this._pendingRichDrafts.delete(key)
      }
    }
    this._writeRichDraft(sessionId, draft && detail?.value === draft ? detail : null)

    const storage = this._draftStorage()
    if (!storage) return
    try {
      if (draft) {
        storage.setItem(key, draft)
      } else {
        storage.removeItem(key)
      }
    } catch {
      // Keep the in-memory fallback above; browser persistence is best-effort.
    }
  }

  /** Project the current store state onto the live panel (the bind-on-tick body).
   * No-op until the panel + store exist. buildChatKernelOptions is pure + cheap. */
  private _applyToPanel(): void {
    const panel = this._panel
    if (!panel) return
    panel.theme = this._ambientTheme()
    panel.presentation = this.presentation
    const store = this._store
    if (!store) return
    const state = store.getState()
    const sessionId = state.sessionId ?? this.sessionId
    const draftKey = this._draftKey(sessionId)
    if (!state.streaming && state.sendState === 'ready' && state.retainedDraft == null) {
      this._pendingRichDrafts.delete(draftKey)
    }
    const persistedDraft = this._readDraft(sessionId)
    const draft = persistedDraft != null
      ? persistedDraft
      : this._explicitDraftClears.has(draftKey)
        ? ''
        : state.retainedDraft ?? ''
    const pendingRich = this._pendingRichDrafts.get(draftKey) ?? null
    const draftDetail = draft
      ? this._readRichDraft(sessionId, draft)
        ?? (pendingRich?.value === draft ? pendingRich : null)
      : null
    const kernelOptions = buildChatKernelOptions(store, () => state)
    const send = kernelOptions.onSend
    Object.assign(panel, {
      ...kernelOptions,
      // A failed or ambiguous submission is restored after the kernel's normal
      // optimistic clear. Presence—not truthiness—makes a user clear authoritative.
      draft,
      draftDetail,
      draftIdentity: sessionId,
      messageActions: store.service.branchSession ? LIVE_BRANCHING_MESSAGE_ACTIONS : LIVE_MESSAGE_ACTIONS,
      composerReferenceResolver: this.composerReferenceResolver,
      onDraftChange: (
        nextDraft: string,
        detail: HojaComposerDetail | null = null,
        reason: ChatDraftChangeReason = 'edit',
      ) => this._writeDraft(sessionId, nextDraft, detail, reason),
      onSend: (text: string, context?: ChatSendContext) => {
        if (context?.composer) this._pendingRichDrafts.set(draftKey, context.composer)
        send?.(text)
      },
      onSurfaceAction: (action: SurfaceActionIntent) => this._handleSurfaceAction(action),
      onMessageAction: (messageId: string, action: MessageActionKind) => {
        return this._handleMessageAction(messageId, action)
      },
      onCodeCopy: (intent: CodeCopyIntent) => this._handleCodeCopy(intent),
      onHeaderAction: (action: HeaderActionKind) => {
        void this._handleHeaderAction(action)
      },
      onSessionAction: (action: ChatSessionAction) => this._handleSessionAction(action),
      onSeamAction: (action: ChatSeamAction) => this._handleSeamAction(action),
      // Money is the platform's and the shell's: the panel renders the cost of a reply and
      // the buttons of the banner, and these are where their intents go.
      formatModelAnnotation: costAnnotation,
      onComposerNoticeAction: (id: string) => this._handleNoticeAction(id),
      onAccountAction: (id: string) => this._handleAccountAction(id),
      // What a turn changed: links only where the shell routes them, names it knows, a live preview through its port.
      onChangeAction: this.workspace?.onChangeAction ? this._handleChangeAction : undefined,
      changeTitle: this.workspace?.changeTitle,
      renderArtifactPreview: this.workspace?.artifactPreview ? this._renderArtifactPreview : undefined,
    })
  }

  /** A change link: raised for whoever listens, and handed to the shell. */
  private readonly _handleChangeAction = (intent: ChatChangeIntent): void => {
    this.dispatchEvent(new CustomEvent<ChatChangeIntent>(CHAT_CHANGE_ACTION_EVENT, {
      detail: intent,
      bubbles: true,
      composed: true,
    }))
    this.workspace?.onChangeAction?.(intent)
  }

  /** The preview's history button: the artifact's revisions, as a change link. */
  private readonly _openRevisions = (artifactId: string): void => {
    this._handleChangeAction({ type: 'open-artifact', artifactId, revisions: true })
  }

  /** The live preview the panel asks for: the shell's port behind an <mn-artifact-view> with scripts off. */
  private readonly _renderArtifactPreview = (request: ChatArtifactPreviewRequest): unknown => {
    const port = this.workspace?.artifactPreview
    if (!port) return nothing
    return html`<sh-chat-artifact-preview
      .artifactId=${request.artifactId}
      .title=${request.title ?? ''}
      .port=${port}
      .onOpenRevisions=${this._openRevisions}
    ></sh-chat-artifact-preview>`
  }

  /**
   * The banner's button: add credits (the shell's), or leave a chat that is over (ours); the heads-up's two: details (the shell's), or put it
   * away (its source's). Anything else is the store's own (continue a conversation here, from another tab).
   */
  private _handleNoticeAction(id: string): void {
    if (id === ADD_CREDITS_ACTION) this._raiseAddCredits('refusal')
    else if (id === NEW_CHAT_ACTION) void this._handleSessionAction({ type: 'new' })
    else if (id === CREDITS_NOTICE_DETAILS_ACTION) this._raiseAddCredits('notice')
    else if (id === CREDITS_NOTICE_DISMISS_ACTION) this.creditsNotice?.dismiss(this._store?.creditsFacts() ?? null)
    else this._store?.composerNoticeAction?.(id)
  }

  /** The balance line's button. */
  private _handleAccountAction(id: string): void {
    if (id === ADD_CREDITS_ACTION) this._raiseAddCredits('balance-line')
  }

  private _raiseAddCredits(source: ChatAddCreditsDetail['source']): void {
    const need = this._store?.creditsNeed() ?? { balanceMicroUsd: null, requiredMicroUsd: null }
    this.dispatchEvent(
      new CustomEvent<ChatAddCreditsDetail>(CHAT_ADD_CREDITS_EVENT, {
        detail: { source, balanceMicroUsd: need.balanceMicroUsd, requiredMicroUsd: need.requiredMicroUsd },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * "…open the original": say which conversation that means. A shell that opens it itself says so by cancelling the event;
   * otherwise it opens here, in the history drawer's reader, so the line is never a button that goes nowhere.
   */
  private _handleSeamAction(action: ChatSeamAction): void {
    if (action.type !== 'open-original') return
    const sessionId = this._store?.getState().sessionId
    const lineage = sessionId ? this._store?.service.sessionLineage?.(sessionId) ?? null : null
    if (!lineage) return
    const shellOpened = !this.dispatchEvent(
      new CustomEvent(CHAT_OPEN_ORIGINAL_EVENT, {
        detail: { ...lineage },
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    )
    if (shellOpened) return
    void this._openOriginal(lineage)
  }

  /** The conversation a continued chat picked up, in the reader of the history drawer. */
  private async _openOriginal(lineage: ConversationLineage): Promise<void> {
    await this._openHistoryDrawer()
    const known = this._home?.itemById(lineage.archiveConversationUrn) ?? null
    // Not among the pages loaded so far: the reader needs only what the continuation recorded.
    const item: ArchivedConversation = known ?? {
      conversationId: lineage.archiveConversationUrn,
      graphId: '',
      revision: {
        revisionId: lineage.revisionId,
        title: lineage.title?.trim() || 'Imported conversation',
        messageCount: 0,
        partCount: 0,
      },
      revisionCount: 1,
    }
    this._openImported(lineage.archiveConversationUrn, item)
  }

  /**
   * "Continue with…": read the old conversation, let the person choose the voice that
   * will pick it up, open the continued conversation on the active slot. Nothing is
   * sent anywhere until they send their first message there. Wherever it cannot be
   * done the chooser says so in words, and nothing is made.
   */
  async continueWith(intent: ContinueIntent): Promise<void> {
    if (this.continuing && this.continuing.phase !== 'refused') return
    const service = this._store?.service
    if (!service) return
    // What is read for this one is let go if the person cancels before it arrives: a read that finishes after
    // Cancel must not open the sheet again over someone who has gone back to what they were doing.
    const run = ++this._continueRun
    this.continuing = { phase: 'reading', intent }
    try {
      await service.probeCapabilities?.()
      if (run !== this._continueRun) return
      if (!service.prepareContinuation || !service.continueConversation || !service.capabilities?.continuation) {
        this.continuing = { phase: 'refused', intent, message: CANNOT_CONTINUE }
        return
      }
      const plan = await service.prepareContinuation(intent)
      if (run !== this._continueRun) return
      this.continuing = { phase: 'choosing', intent, plan }
    } catch (error) {
      if (run !== this._continueRun) return
      this.continuing = { phase: 'refused', intent, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async _confirmContinue(detail: ContinueConfirmDetail): Promise<void> {
    const state = this.continuing
    const service = this._store?.service
    if (state?.phase !== 'choosing' || !service?.continueConversation) return
    this.continuing = { phase: 'starting', intent: state.intent, plan: state.plan }
    try {
      const session = await service.continueConversation(state.plan, { modelId: detail.modelId })
      this._bindSessionToActiveSlot(session.id)
      this.continuing = null
      // The person is in the new chat: the old conversation's reader is left (the drawer opens on the list next time).
      this._leaveReader(false)
      this._closeHistoryDrawer()
    } catch (error) {
      this.continuing = {
        phase: 'refused',
        intent: state.intent,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private _cancelContinue(): void {
    // Starting takes a moment and cannot be taken back half way: the sheet says "Starting…" and its Cancel is disabled.
    if (this.continuing?.phase === 'starting') return
    this._continueRun += 1
    this.continuing = null
    // Back to what was being read, if that is where it began.
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[data-chat-reader-continue]')?.focus()
    })
  }

  private _renderContinue(): TemplateResult | typeof nothing {
    const state = this.continuing
    if (!state) return nothing
    const phase: ContinuePhase = state.phase
    return html`<sh-continue-chooser
      .phase=${phase}
      .conversationTitle=${state.intent.title}
      .plan=${state.phase === 'choosing' || state.phase === 'starting' ? state.plan : null}
      .roster=${this._store?.service.models() ?? []}
      .message=${state.phase === 'refused' ? state.message : ''}
      @sh-continue-confirm=${(event: CustomEvent<ContinueConfirmDetail>) => void this._confirmContinue(event.detail)}
      @sh-continue-cancel=${() => this._cancelContinue()}
    ></sh-continue-chooser>`
  }

  private _handleSurfaceAction(action: SurfaceActionIntent): void {
    this.dispatchEvent(
      new CustomEvent<SurfaceActionIntent>('mn-chat-surface-action', {
        detail: action,
        bubbles: true,
        composed: true,
      }),
    )
    this.onSurfaceAction?.(action)
  }

  private async _handleMessageAction(messageId: string, action: MessageActionKind): Promise<ChatMessageActionDetail> {
    const message = this._findMessage(messageId)
    let defaultHandled = false
    let error: string | null = null

    try {
      if (action === 'copy') {
        if (!message) throw new Error('Message not found.')
        await this._writeClipboard(message.content)
        defaultHandled = true
      } else if (action === 'regenerate') {
        this._dispatchRegenerateMessage(messageId, message)
        defaultHandled = true
      } else if (action === 'save-garden') {
        if (!message) throw new Error('Message not found.')
        this._dispatchExportMessage(message)
        defaultHandled = true
      } else if (action === 'branch') {
        if (!message) throw new Error('Message not found.')
        await this._branchFrom(message)
        defaultHandled = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      // Said where conversations are listed: a branch is a new one.
      if (action === 'branch') this.historyError = `This conversation could not be branched: ${error}`
    }

    const detail: ChatMessageActionDetail = {
      messageId,
      action,
      message,
      defaultHandled,
      error,
    }
    this.dispatchEvent(
      new CustomEvent<ChatMessageActionDetail>(CHAT_MESSAGE_ACTION_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
    this.onMessageAction?.(detail)
    return detail
  }

  private async _handleCodeCopy(intent: CodeCopyIntent): Promise<void> {
    let defaultHandled = false
    let error: string | null = null

    try {
      await this._writeClipboard(intent.code)
      defaultHandled = true
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    const detail: ChatCodeCopyDetail = {
      ...intent,
      defaultHandled,
      error,
    }
    this.dispatchEvent(
      new CustomEvent<ChatCodeCopyDetail>(CHAT_CODE_COPY_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
    this.onCodeCopy?.(detail)
    if (error) throw new Error(error)
  }

  private async _handleHeaderAction(action: HeaderActionKind): Promise<void> {
    const store = this._store
    const state = store?.getState() ?? null
    let defaultHandled = false
    let error: string | null = null

    try {
      if (action === 'refresh') {
        store?.setSession(state?.sessionId ?? null)
        defaultHandled = Boolean(store)
      } else if (action === 'stop') {
        if (!store || !state?.sessionId) throw new Error('No session bound.')
        await store.service.abort(state.sessionId)
        defaultHandled = true
      } else if (action === 'save-garden') {
        this._openLiveSaveDialog()
        defaultHandled = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    const detail: ChatHeaderActionDetail = {
      action,
      sessionId: state?.sessionId ?? null,
      messages: state?.messages ?? [],
      defaultHandled,
      error,
    }
    this.dispatchEvent(
      new CustomEvent<ChatHeaderActionDetail>(CHAT_HEADER_ACTION_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
    this.onHeaderAction?.(detail)
  }

  private async _openHistoryDrawer(): Promise<void> {
    const active = this.renderRoot instanceof ShadowRoot
      ? this.renderRoot.activeElement
      : this.ownerDocument.activeElement
    this.historyReturnFocus = active instanceof HTMLElement ? active : null
    this.historyOpen = true
    this.historyError = null
    this.editingSessionId = null
    this.editingTitle = ''
    // Start reading before the first paint, so the drawer opens on "Loading" and not on a blank body.
    const opening = this._ensureHome()?.open() ?? Promise.resolve()
    // What the registry says the host can do (cached per graph) decides whether a conversation can be continued.
    void this._store?.service.probeCapabilities?.().then(() => this.requestUpdate(), () => undefined)
    this.requestUpdate()
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>('[data-chat-history-drawer]')?.focus()
    await opening
  }

  private _closeHistoryDrawer(): void {
    this.historyOpen = false
    this.editingSessionId = null
    this.editingTitle = ''
    this.historyError = null
    this.requestUpdate()
    const target = this.historyReturnFocus
    this.historyReturnFocus = null
    void this.updateComplete.then(() => target?.focus())
  }

  private _historyKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this._closeHistoryDrawer()
      return
    }
    if (event.key !== 'Tab') return
    const drawer = this.renderRoot.querySelector<HTMLElement>('[data-chat-history-drawer]')
    if (!drawer) return
    // Everything in the drawer is in this shadow tree (the list, the reader and its
    // transcript alike), so one query reaches every control the trap must hold.
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_IN_DRAWER))
      .filter(element => !element.hasAttribute('hidden'))
    if (focusable.length === 0) {
      event.preventDefault()
      drawer.focus()
      return
    }
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
    if (event.shiftKey && (active === focusable[0] || active === drawer)) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && active === focusable.at(-1)) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  }

  private async _loadHistorySessions(): Promise<void> {
    await this._ensureHome()?.refreshLive()
  }

  private _bindSessionToActiveSlot(sessionId: string): void {
    const store = this._store
    if (!store) throw new Error('No chat store bound.')
    const slot = store.service.activeSlot
    store.service.bindSlotSession(slot, sessionId)
    this._boundSession = sessionId
    store.setSession(sessionId)
  }

  private async _selectHistorySession(sessionId: string): Promise<void> {
    try {
      this._bindSessionToActiveSlot(sessionId)
      this._leaveReader(false)
      this._closeHistoryDrawer()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    }
  }

  private async _createHistorySession(): Promise<void> {
    const store = this._store
    if (!store) {
      this.historyError = 'No chat store bound.'
      return
    }
    this.historyError = null
    try {
      const session = await store.service.createSession({ title: null })
      this._bindSessionToActiveSlot(session.id)
      await this._loadHistorySessions()
      this._leaveReader(false)
      this._closeHistoryDrawer()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    }
  }

  /** A chat still named by the shell's old label starts from an empty box, not from "Untitled chat". */
  private _startRename(id: string, rawTitle: string | null): void {
    this.editingSessionId = id
    this.editingTitle = isPlaceholderTitle(rawTitle) ? '' : (rawTitle as string).trim()
  }

  private async _commitRenameSession(sessionId: string): Promise<void> {
    const store = this._store
    if (!store) {
      this.historyError = 'No chat store bound.'
      return
    }
    const title = this.editingTitle.trim() || 'New chat'
    this.historyError = null
    try {
      await store.service.renameSession(sessionId, title)
      this.editingSessionId = null
      this.editingTitle = ''
      if (store.getState().sessionId === sessionId) {
        store.setSession(sessionId)
      }
      await this._loadHistorySessions()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    }
  }

  private async _deleteHistorySession(sessionId: string): Promise<void> {
    const store = this._store
    if (!store) {
      this.historyError = 'No chat store bound.'
      return
    }
    this.historyError = null
    try {
      // Deleted first, then let go of: a conversation the service would not delete (a reply still under way)
      // keeps its slot.
      await store.service.deleteSession(sessionId)
      const slots = store.service.slotSessions()
      slots.forEach((id, index) => {
        if (id === sessionId) store.service.bindSlotSession(index as ChatSessionSlot, null)
      })
      if (store.getState().sessionId === sessionId) {
        const replacement = await store.service.createSession({ title: null })
        this._bindSessionToActiveSlot(replacement.id)
      }
      await this._loadHistorySessions()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    }
  }

  /**
   * Branch from one of the person's messages: a new conversation with the history before it, open here, with
   * that message's words in the composer to edit and send. The old conversation stays as it was.
   */
  private async _branchFrom(message: ChatMessage): Promise<void> {
    const store = this._store
    const sessionId = store?.getState().sessionId ?? null
    if (!store?.service.branchSession || !sessionId) throw new Error('This chat cannot branch.')
    const userIndex = store.getState().messages.filter(candidate => candidate.role === 'user').findIndex(candidate => candidate.id === message.id)
    const branch = await store.service.branchSession(sessionId, { id: message.id, content: message.content, userIndex })
    this._writeDraft(branch.session.id, branch.text, null, 'edit')
    this._bindSessionToActiveSlot(branch.session.id)
    this._applyToPanel()
    await this._loadHistorySessions()
  }

  /** Duplicate a conversation from the drawer: the copy opens here. */
  private async _duplicateHistorySession(sessionId: string): Promise<void> {
    const store = this._store
    if (!store?.service.duplicateSession) return
    this.historyError = null
    try {
      const copy = await store.service.duplicateSession(sessionId)
      this._bindSessionToActiveSlot(copy.id)
      await this._loadHistorySessions()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    }
  }

  private async _handleSessionAction(action: ChatSessionAction): Promise<void> {
    const store = this._store
    let defaultHandled = false
    let error: string | null = null

    try {
      if (action.type === 'open-history') {
        if (!store) throw new Error('No chat store bound.')
        await this._openHistoryDrawer()
        defaultHandled = true
      } else if (action.type === 'new') {
        if (!store) throw new Error('No chat store bound.')
        const session = await store.service.createSession({ title: null })
        this._bindSessionToActiveSlot(session.id)
        this._closeHistoryDrawer()
        defaultHandled = true
      } else if (action.type === 'slot') {
        if (!store) throw new Error('No chat store bound.')
        let nextSessionId = store.service.slotSessions()[action.slot]
        if (!nextSessionId) {
          const session = await store.service.createSession({ title: null })
          nextSessionId = session.id
          store.service.bindSlotSession(action.slot, nextSessionId)
        }
        store.service.setActiveSlot(action.slot)
        this._boundSession = nextSessionId
        store.setSession(nextSessionId)
        this._closeHistoryDrawer()
        defaultHandled = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    const state = store?.getState() ?? null
    const detail: ChatSessionActionDetail = {
      action,
      sessionId: state?.sessionId ?? null,
      sessionTitle: state?.sessionTitle ?? null,
      activeSlot: state?.activeSlot ?? 0,
      slotSessions: state?.slotSessions ?? [null, null, null],
      defaultHandled,
      error,
    }
    this.dispatchEvent(
      new CustomEvent<ChatSessionActionDetail>(CHAT_SESSION_ACTION_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
    this.onSessionAction?.(detail)
  }

  private _findMessage(messageId: string): ChatMessage | null {
    return this._store?.getState().messages.find((msg) => msg.id === messageId) ?? null
  }

  private async _writeClipboard(text: string): Promise<void> {
    const clipboard =
      this.ownerDocument.defaultView?.navigator.clipboard ??
      (typeof navigator === 'undefined' ? undefined : navigator.clipboard)
    if (!clipboard?.writeText) throw new Error('Clipboard API is unavailable.')
    await clipboard.writeText(text)
  }

  private _dispatchRegenerateMessage(messageId: string, message: ChatMessage | null): void {
    this.dispatchEvent(
      new CustomEvent<ChatMessageRegenerateDetail>('mn-regenerate-message', {
        detail: { messageId, message },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _dispatchExportMessage(message: ChatMessage): void {
    this.dispatchEvent(
      new CustomEvent<ChatMessageExportDetail>('mn-export-message', {
        detail: { message },
        bubbles: true,
        composed: true,
      }),
    )
  }

  // ── the one conversation home ────────────────────────────────────────────

  private _now(): number {
    return this.conversationHome?.now?.() ?? Date.now()
  }

  private _downloader(): (file: MarkdownFile) => void {
    return this.conversationHome?.download ?? (file => downloadMarkdownFile(file, this.ownerDocument))
  }

  /** The controller for the current service: made on first use, rebuilt if the service changes. */
  private _ensureHome(): ConversationHomeController | null {
    const service = this._store?.service ?? null
    if (!service) return null
    if (this._homeService !== service) {
      this._disposeHome()
      this._homeService = service
      this._home = createConversationHomeController(service)
      this._homeUnsub = this._home.subscribe(() => this.requestUpdate())
    }
    return this._home
  }

  private _disposeHome(): void {
    this._closeSaveDialog(false)
    this._leaveReader(false)
    this._homeUnsub?.()
    this._homeUnsub = null
    this._home?.dispose()
    this._home = null
    this._homeService = null
  }

  /** Read an imported conversation. Moving within a family keeps the list row the person first came from. */
  private _openImported(conversationId: string, known: ArchivedConversation | null = null): void {
    const archive = this._store?.service.archive
    const item = known ?? this._home?.itemById(conversationId) ?? null
    if (!archive || !item) return
    const opener = this._reader ? this._readerOpener : conversationId
    this._leaveReader(false)
    this._readerOpener = opener
    const reader = createImportedReader(archive, item)
    this._reader = reader
    this._readerUnsub = reader.subscribe(() => this.requestUpdate())
    void reader.open()
    this.requestUpdate()
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[data-chat-reader-back]')?.focus()
    })
  }

  private _leaveReader(refocus: boolean): void {
    const opener = this._readerOpener
    this._readerUnsub?.()
    this._readerUnsub = null
    this._reader?.dispose()
    this._reader = null
    this._readerOpener = null
    this.readerActionError = null
    this.readerNote = null
    this.requestUpdate()
    if (!refocus) return
    void this.updateComplete.then(() => {
      const rows = Array.from(this.renderRoot.querySelectorAll<HTMLElement>('[data-chat-history-open]'))
      const target = rows.find(row => row.getAttribute('data-chat-history-open') === opener)
        ?? this.renderRoot.querySelector<HTMLElement>('[data-chat-history-drawer]')
      target?.focus()
    })
  }

  /**
   * Whether this chat can pick up an imported conversation: a shell that does it itself (`conversationHome.onContinue`),
   * or a service whose host advertises `seed` in its registry. A host that does not would drop the window and start a
   * plain chat while the person believed the old one had been carried over, so nothing is offered there.
   */
  private _continueOffered(): boolean {
    if (this.conversationHome?.onContinue) return true
    const service = this._store?.service
    return Boolean(service?.prepareContinuation && service.continueConversation && service.capabilities?.continuation)
  }

  /**
   * "Continue with…": say what is being continued; whatever can continue it does the rest. Where the shell gave a handler
   * it is the shell's (a refusal is shown and the drawer stays; success closes it). Otherwise the host's own flow: the
   * chooser opens above this drawer, which stays under it, and the drawer closes when the conversation has been picked up.
   */
  private async _continueImported(): Promise<void> {
    const reader = this._reader
    if (!reader || reader.getState().status !== 'ready') return
    const intent = reader.continueIntent()
    this.readerActionError = null
    this.dispatchEvent(new CustomEvent<ContinueConversationIntent>(CHAT_CONTINUE_EVENT, { detail: intent, bubbles: true, composed: true }))
    const onContinue = this.conversationHome?.onContinue
    if (!onContinue) {
      await this.continueWith(intent)
      return
    }
    try {
      await onContinue(intent)
      this._leaveReader(false)
      this._closeHistoryDrawer()
    } catch (error) {
      this.readerActionError = error instanceof Error ? error.message : String(error)
    }
  }

  /** Download straight from the reader: read every page, then hand over the file. */
  private async _downloadImported(reader: ImportedReader): Promise<void> {
    // One download at a time: a second press while pages are still being read does nothing.
    if (this.readerNote === PREPARING_DOWNLOAD) return
    this.readerActionError = null
    this.readerNote = PREPARING_DOWNLOAD
    const flow = createSaveFlow({ source: importedExportSource(reader), port: null, download: this._downloader(), now: () => this._now() })
    await flow.downloadMarkdown()
    const state = flow.getState()
    flow.dispose()
    if (this._reader !== reader) return
    this.readerNote = state.downloaded ? `Downloaded ${state.downloaded}.` : null
    if (state.phase === 'error' && state.error) this.readerActionError = state.error
  }

  /** Stable identities: a new function on every render would make the transcript draw itself again each time. */
  private readonly _onReaderMessageAction = (messageId: string, action: MessageActionKind): Promise<MessageActionResult> =>
    this._readerMessageAction(messageId, action)

  private readonly _onReaderCodeCopy = (intent: CodeCopyIntent): Promise<void> => this._writeClipboard(intent.code)

  private async _readerMessageAction(messageId: string, action: MessageActionKind): Promise<MessageActionResult> {
    if (action !== 'copy') return { defaultHandled: false, error: null }
    const message = this._reader?.transcript().messages.find(candidate => candidate.id === messageId)
    if (!message) return { defaultHandled: false, error: 'Message not found.' }
    try {
      await this._writeClipboard(message.content)
      return { defaultHandled: true, error: null }
    } catch (error) {
      return { defaultHandled: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── Save to Garden and Download as Markdown ──────────────────────────────

  /** The header's "Save chat to Garden": this live conversation, as it is at the moment of asking. */
  private _openLiveSaveDialog(): void {
    const state = this._store?.getState()
    if (!state) throw new Error('No chat store bound.')
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
    const invoker = active instanceof HTMLElement
      ? active
      : this._panel?.querySelector<HTMLElement>('.icon-button[data-header-action="save-garden"]') ?? null
    this._openSaveDialog(
      liveExportSource({ title: state.sessionTitle, messages: state.messages, continues: state.seam?.originalTitle ?? null }),
      invoker,
    )
  }

  private _openSaveDialog(source: ConversationExportSource, invoker: HTMLElement | null): void {
    this._closeSaveDialog(false)
    const flow = createSaveFlow({
      source,
      port: this.conversationHome?.saveToGarden ?? null,
      download: this._downloader(),
      now: () => this._now(),
    })
    this._save = flow
    this._saveReturnFocus = invoker
    this._saveUnsub = flow.subscribe(() => this.requestUpdate())
    void flow.loadTargets()
    this.requestUpdate()
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[data-chat-save-dialog]')?.focus()
    })
  }

  private _closeSaveDialog(refocus: boolean): void {
    this._saveUnsub?.()
    this._saveUnsub = null
    this._save?.dispose()
    this._save = null
    const target = this._saveReturnFocus
    this._saveReturnFocus = null
    this.requestUpdate()
    if (refocus && target) void this.updateComplete.then(() => target.focus())
  }

  private _saveKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Escape closes the dialog and nothing behind it.
      event.preventDefault()
      event.stopPropagation()
      this._closeSaveDialog(true)
      return
    }
    if (event.key !== 'Tab') return
    const dialog = this.renderRoot.querySelector<HTMLElement>('[data-chat-save-dialog]')
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_IN_DRAWER))
      .filter(element => !element.hasAttribute('hidden'))
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const active = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null
    if (event.shiftKey && (active === focusable[0] || active === dialog)) {
      event.preventDefault()
      focusable.at(-1)?.focus()
    } else if (!event.shiftKey && active === focusable.at(-1)) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  }

  private _openSaved(flow: SaveFlow): void {
    const result = flow.getState().result
    const documentId = result?.documentIds[0]
    if (!result || !documentId) return
    this.conversationHome?.saveToGarden?.open?.({ workspaceId: result.workspaceId, documentId })
    this._closeSaveDialog(false)
    this._closeHistoryDrawer()
  }

  private _renderSaveDialog(): TemplateResult | typeof nothing {
    const flow = this._save
    if (!flow) return nothing
    const port = this.conversationHome?.saveToGarden
    return renderSaveDialog({
      state: flow.getState(),
      hasPort: Boolean(port),
      canOpen: Boolean(port?.open),
      actions: {
        select: graphId => flow.select(graphId),
        confirm: () => { void flow.save() },
        download: () => { void flow.downloadMarkdown() },
        cancelReading: () => flow.cancel(),
        retryTargets: () => { void flow.loadTargets() },
        open: () => this._openSaved(flow),
        close: () => this._closeSaveDialog(true),
        keydown: event => this._saveKeyDown(event),
      },
    })
  }

  // ── the drawer ───────────────────────────────────────────────────────────

  private _renderHome(): TemplateResult {
    const home = this._home
    if (!home) {
      return html`<div class="history-status error" role="alert">${this.historyError ?? t('No chat service bound.')}</div>`
    }
    const state = home.getState()
    return renderConversationHome({
      view: home.view(),
      query: state.query,
      filter: state.filter,
      expanded: state.expanded,
      now: this._now(),
      activeSessionId: this._store?.getState().sessionId ?? null,
      editingId: this.editingSessionId,
      editingTitle: this.editingTitle,
      actionError: this.historyError,
      actions: {
        search: query => home.setQuery(query),
        filter: filter => home.setFilter(filter),
        toggleChildren: conversationId => home.toggleExpanded(conversationId),
        selectLive: id => { void this._selectHistorySession(id) },
        openImported: conversationId => this._openImported(conversationId),
        startRename: (id, rawTitle) => this._startRename(id, rawTitle),
        editTitle: value => { this.editingTitle = value },
        commitRename: id => { void this._commitRenameSession(id) },
        cancelRename: () => {
          this.editingSessionId = null
          this.editingTitle = ''
        },
        deleteLive: id => { void this._deleteHistorySession(id) },
        ...(this._store?.service.duplicateSession ? { duplicateLive: (id: string) => { void this._duplicateHistorySession(id) } } : {}),
        retryLive: () => { void home.refreshLive() },
        retryImported: () => { void home.retryImported() },
        dismissNotice: () => home.dismissNotice(),
        loadMore: () => { void home.loadMoreImported() },
      },
    })
  }

  private _renderReader(reader: ImportedReader): TemplateResult {
    const family = this._home?.familyOf(reader.conversation.conversationId) ?? { parent: null, children: [] }
    return renderImportedReader({
      state: reader.getState(),
      header: reader.header(),
      transcript: reader.transcript(),
      annotate: reader.annotate,
      family,
      startedByUnloaded: Boolean(reader.conversation.parentConversationId) && family.parent === null,
      now: this._now(),
      // Only a conversation that has been read can be picked up, and only where something can pick it up.
      continueAvailable: reader.getState().status === 'ready' && this._continueOffered(),
      actionError: this.readerActionError,
      actionNote: this.readerNote,
      messageActions: READER_MESSAGE_ACTIONS,
      onMessageAction: this._onReaderMessageAction,
      onCodeCopy: this._onReaderCodeCopy,
      actions: {
        back: () => this._leaveReader(true),
        retry: () => { void reader.open() },
        loadMore: () => { void reader.loadMore() },
        switchRevision: revisionId => { void reader.switchRevision(revisionId) },
        open: conversationId => this._openImported(conversationId),
        continueConversation: () => { void this._continueImported() },
        save: invoker => this._openSaveDialog(importedExportSource(reader), invoker),
        download: () => { void this._downloadImported(reader) },
      },
    })
  }

  private _renderHistoryDrawer(): TemplateResult | typeof nothing {
    if (!this.historyOpen) return nothing
    const reader = this._reader
    return html`
      <div
        class="history-backdrop"
        data-chat-history-backdrop
        @click=${() => this._closeHistoryDrawer()}
      >
        <section
          class="history-drawer"
          ?data-imported=${reader !== null}
          data-chat-history-drawer
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-history-title"
          tabindex="-1"
          ?inert=${this.continuing !== null}
          @keydown=${(event: KeyboardEvent) => this._historyKeyDown(event)}
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="history-header">
            <h2 class="history-title" id="chat-history-title">${t('Chat history')}</h2>
            <div class="history-actions">
              <button
                class="history-button"
                data-chat-history-new
                @click=${() => void this._createHistorySession()}
              >${t('New')}</button>
              <button
                class="history-button icon"
                data-chat-history-close
                aria-label=${t('Close chat history')}
                @click=${() => this._closeHistoryDrawer()}
              >×</button>
            </div>
          </header>
          ${reader ? this._renderReader(reader) : this._renderHome()}
        </section>
      </div>
    `
  }

  /** The host's SHIPPED public store handle (null until a service is bound). The
   * survival tests read identity + state through this (the chat analog of
   * editor-host's `liveEditor`). */
  get store(): ChatServiceStore | null {
    return this._store
  }

  /** The host's SHIPPED live panel handle (null until firstUpdated mounts it). */
  get panel(): ShChatPanel | null {
    return this._panel
  }

  override render(): TemplateResult {
    // ONLY the stable mount target — the live panel is mounted into it
    // imperatively (firstUpdated) and never stamped in the template, so an
    // interface-grow re-render that re-runs render() cannot re-create the panel.
    // Every child part sits inside an element: a template that ENDS in a bare child binding is parsed
    // by happy-dom into a stray `<?>` text node (the chooser never appears under test), and a wrapper
    // that is `display: contents` costs the browser nothing.
    return html`<div class="chat-mount"></div><div class="history-layer">${this._renderHistoryDrawer()}${this._renderSaveDialog()}</div><div class="continue-layer">${this._renderContinue()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-chat-host': ShChatHost
  }
}
