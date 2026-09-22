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

// Importing the kernel registers <sh-chat-panel> (the upgrade seam). This
// side-effect import is in the RUNTIME subdir, NOT the kernel, so the kernel
// purity gate is unaffected (the kernel never imports the host/store).
import '@shrubbery/chat-kernel'
import { LitElement, html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type {
  ChatDraftChangeReason,
  ChatMessage,
  ChatPresentation,
  ChatSendContext,
  ChatSessionAction,
  ChatSessionSlot,
  CodeCopyIntent,
  HeaderActionKind,
  HojaComposerDetail,
  HojaWikiLinkResolver,
  MessageActionKind,
  SessionSummary,
  ShChatPanel,
  SurfaceActionIntent,
} from '@shrubbery/chat-kernel'
import type { ChatService } from '../chat-services/chat-service.js'
import { buildChatKernelOptions } from '../chat-services/assemble.js'
import { createChatServiceStore, type ChatServiceStore } from './chat-service-store.js'

/** Generic shell seam for every message-level action the pure kernel emits. */
export const CHAT_MESSAGE_ACTION_EVENT = 'mn-chat-message-action'
export const CHAT_CODE_COPY_EVENT = 'mn-chat-code-copy'
export const CHAT_HEADER_ACTION_EVENT = 'mn-chat-header-action'
export const CHAT_SESSION_ACTION_EVENT = 'mn-chat-session-action'

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
      z-index: 2147483000;
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
    .history-layer {
      display: contents;
    }
    .history-backdrop {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: flex;
      justify-content: flex-end;
      background: var(--mn-color-backdrop, rgba(15, 23, 42, 0.18));
    }
    .history-drawer {
      width: min(24rem, 100%);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--mn-color-border-default, #d0d7de);
      background: var(--mn-color-surface-elevated, var(--mn-color-surface-base, #fff));
      box-shadow: var(--mn-shadow-modal, -12px 0 32px rgba(15, 23, 42, 0.18));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
      color: var(--mn-color-text-primary, #1f2933);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
    }
    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--mn-color-border-default, #d0d7de);
    }
    .history-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 650;
    }
    .history-actions {
      display: inline-flex;
      gap: 0.375rem;
      align-items: center;
    }
    .history-button {
      border: var(--mn-control-border, 1px solid var(--mn-color-border-default, #d0d7de));
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-control-background, var(--mn-color-surface-subtle, #f8fafc));
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: 0.8rem;
      line-height: 1;
      padding: 0.45rem 0.55rem;
      box-shadow: var(--mn-control-shadow, none);
    }
    .history-button:hover {
      background: var(--mn-color-surface-hover, #eef2f7);
    }
    .history-button.icon {
      width: 2rem;
      height: 2rem;
      padding: 0;
      font-size: 1rem;
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
      overflow: auto;
      padding: 0.5rem;
    }
    .history-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 0.375rem;
      align-items: center;
      width: 100%;
      box-sizing: border-box;
      padding: 0.375rem;
      border-radius: var(--mn-radius-surface, 8px);
    }
    .history-row[data-active] {
      background: var(--mn-color-surface-accent, #e9f5ef);
    }
    .history-select {
      min-width: 0;
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
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .history-meta {
      display: block;
      margin-top: 0.125rem;
      color: var(--mn-color-text-tertiary, #697386);
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

  @state()
  private historySessions: SessionSummary[] = []

  @state()
  private historyLoading = false

  @state()
  private historyError: string | null = null

  @state()
  private editingSessionId: string | null = null

  @state()
  private editingTitle = ''

  private historyReturnFocus: HTMLElement | null = null

  /** Whether showPopover() successfully promoted this host into the top layer. */
  private _usingTopLayer = false

  /** Defer the restore decision until inner light-DOM listeners have had their
   * chance to consume Escape (model picker, menus, and the Hoja suggestion UI). */
  private readonly _documentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat || this.presentation !== 'fullscreen') return
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

  override connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('keydown', this._documentKeyDown)
    this._observeAmbientTheme()
    this._reconcileStore()
  }

  override disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this._documentKeyDown)
    this._leaveTopLayer()
    this._unsub?.()
    this._unsub = null
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
    this._store = null
    this._storeService = null
    this._boundSession = null
    if (!this.service) {
      this._applyToPanel()
      return
    }
    const store = createChatServiceStore(this.service)
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
    })
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
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
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
    this.editingSessionId = null
    this.editingTitle = ''
    this.requestUpdate()
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>('[data-chat-history-drawer]')?.focus()
    await this._loadHistorySessions()
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
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hasAttribute('hidden'))
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
    const service = this._store?.service
    if (!service) {
      this.historySessions = []
      this.historyError = 'No chat service bound.'
      return
    }
    this.historyLoading = true
    this.historyError = null
    try {
      this.historySessions = await service.listSessions()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    } finally {
      this.historyLoading = false
    }
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
    this.historyLoading = true
    this.historyError = null
    try {
      const session = await store.service.createSession({ title: null })
      this._bindSessionToActiveSlot(session.id)
      await this._loadHistorySessions()
      this._closeHistoryDrawer()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    } finally {
      this.historyLoading = false
    }
  }

  private _startRenameSession(session: SessionSummary): void {
    this.editingSessionId = session.id
    this.editingTitle = this._sessionTitle(session)
  }

  private async _commitRenameSession(sessionId: string): Promise<void> {
    const store = this._store
    if (!store) {
      this.historyError = 'No chat store bound.'
      return
    }
    const title = this.editingTitle.trim() || 'New chat'
    this.historyLoading = true
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
    } finally {
      this.historyLoading = false
    }
  }

  private async _deleteHistorySession(sessionId: string): Promise<void> {
    const store = this._store
    if (!store) {
      this.historyError = 'No chat store bound.'
      return
    }
    this.historyLoading = true
    this.historyError = null
    try {
      const slots = store.service.slotSessions()
      slots.forEach((id, index) => {
        if (id === sessionId) store.service.bindSlotSession(index as ChatSessionSlot, null)
      })
      await store.service.deleteSession(sessionId)
      if (store.getState().sessionId === sessionId) {
        const replacement = await store.service.createSession({ title: null })
        this._bindSessionToActiveSlot(replacement.id)
      }
      await this._loadHistorySessions()
    } catch (e) {
      this.historyError = e instanceof Error ? e.message : String(e)
    } finally {
      this.historyLoading = false
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

  private _sessionTitle(session: SessionSummary): string {
    const title = session.title?.trim()
    if (!title || title.startsWith('New session - ')) return 'New chat'
    return title
  }

  private _sessionTime(session: SessionSummary): string {
    const value = session.updated_at ?? session.created_at
    if (!value) return ''
    try {
      return new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return value
    }
  }

  private _renderHistoryRow(session: SessionSummary): TemplateResult {
    const active = this._store?.getState().sessionId === session.id
    const editing = this.editingSessionId === session.id
    if (editing) {
      return html`
        <div class="history-row" data-chat-history-row=${session.id} ?data-active=${active}>
          <div class="history-inline">
            <input
              class="history-input"
              data-chat-history-rename-input
              .value=${this.editingTitle}
              @input=${(event: Event) => {
                this.editingTitle = (event.target as HTMLInputElement).value
              }}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void this._commitRenameSession(session.id)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  this.editingSessionId = null
                  this.editingTitle = ''
                }
              }}
              aria-label="Session title"
            />
            <button
              class="history-button"
              data-chat-history-rename-save
              @click=${() => void this._commitRenameSession(session.id)}
            >Save</button>
            <button
              class="history-button"
              data-chat-history-rename-cancel
              @click=${() => {
                this.editingSessionId = null
                this.editingTitle = ''
              }}
            >Cancel</button>
          </div>
        </div>
      `
    }
    return html`
      <div class="history-row" data-chat-history-row=${session.id} ?data-active=${active}>
        <button
          class="history-select"
          data-chat-history-select=${session.id}
          @click=${() => void this._selectHistorySession(session.id)}
        >
          <span class="history-name">${this._sessionTitle(session)}</span>
          <span class="history-meta">${this._sessionTime(session)}</span>
        </button>
        <button
          class="history-button"
          data-chat-history-rename=${session.id}
          title="Rename chat"
          aria-label="Rename ${this._sessionTitle(session)}"
          @click=${() => this._startRenameSession(session)}
        >Rename</button>
        <button
          class="history-button"
          data-chat-history-delete=${session.id}
          title="Delete chat"
          aria-label="Delete ${this._sessionTitle(session)}"
          @click=${() => void this._deleteHistorySession(session.id)}
        >Delete</button>
      </div>
    `
  }

  private _renderHistoryDrawer(): TemplateResult | typeof nothing {
    if (!this.historyOpen) return nothing
    return html`
      <div
        class="history-backdrop"
        data-chat-history-backdrop
        @click=${() => this._closeHistoryDrawer()}
      >
        <section
          class="history-drawer"
          data-chat-history-drawer
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-history-title"
          tabindex="-1"
          @keydown=${(event: KeyboardEvent) => this._historyKeyDown(event)}
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="history-header">
            <h2 class="history-title" id="chat-history-title">Chat history</h2>
            <div class="history-actions">
              <button
                class="history-button"
                data-chat-history-new
                @click=${() => void this._createHistorySession()}
              >New</button>
              <button
                class="history-button icon"
                data-chat-history-close
                aria-label="Close chat history"
                @click=${() => this._closeHistoryDrawer()}
              >×</button>
            </div>
          </header>
          ${this.historyError
            ? html`<div class="history-status error" role="alert">${this.historyError}</div>`
            : nothing}
          ${this.historyLoading
            ? html`<div class="history-status">Loading...</div>`
            : this.historySessions.length === 0
              ? html`<div class="history-status">No chats yet.</div>`
              : html`
                  <div class="history-list" role="list">
                    ${this.historySessions.map((session) => this._renderHistoryRow(session))}
                  </div>
                `}
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
    return html`<div class="chat-mount"></div><div class="history-layer">${this._renderHistoryDrawer()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-chat-host': ShChatHost
  }
}
