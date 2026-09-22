import {
  createKernelEditor,
  type Editor,
  type OpenWikiLinkPickerDetail,
} from '@shrubbery/editor-kernel'
import {
  LitElement,
  css,
  html,
  nothing,
  type CSSResult,
  type PropertyValues,
  type TemplateResult,
} from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

import {
  collectWikiLinkReferences,
  parseComposerMarkdown,
  serializeComposerMarkdown,
} from './composer-markdown.js'
import { HOJA_EVENTS } from './types.js'
import type {
  HojaChangeHandler,
  HojaComposerDetail,
  HojaJSONContent,
  HojaPosture,
  HojaSubmitHandler,
  HojaWikiLinkReference,
  HojaWikiLinkRequestDetail,
  HojaWikiLinkResolver,
  HojaWikiLinkSuggestion,
  HojaWikiLinkSuggestionsDetail,
} from './types.js'

let hojaStyleSheet: CSSStyleSheet | null = null
let hojaInstance = 0
let hojaWikiLinkRequest = 0

type ComposerFormat = 'bold' | 'italic' | 'code'
type WikiLinkTrayState = 'closed' | 'loading' | 'ready' | 'empty' | 'error'

function referencesEqual(
  left: readonly HojaWikiLinkReference[],
  right: readonly HojaWikiLinkReference[],
): boolean {
  const normalize = (references: readonly HojaWikiLinkReference[]) => references.map(reference => ({
    label: reference.label,
    targetDocId: reference.targetDocId ?? null,
    targetGraphId: reference.targetGraphId ?? null,
    targetBlockId: reference.targetBlockId ?? null,
    blockPreview: reference.blockPreview ?? null,
  }))
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

/**
 * `<hoja-editor>` — the backend-free, postured authoring surface.
 *
 * Phase one intentionally mounts the existing editor kernel as-is. Hoja owns
 * the Web Component lifecycle, controlled composer text, local interaction
 * intents, and token presentation. It owns no provider, graph lookup, Y.Doc,
 * authentication, storage, or send lifecycle.
 */
@customElement('hoja-editor')
export class HojaEditor extends LitElement {
  @property({ type: String, reflect: true }) posture: HojaPosture = 'composer'
  /** Host session/draft identity. Changing it replaces only the inner editor. */
  @property({ type: String, attribute: 'value-key' }) valueKey = ''
  @property({ type: String }) value = ''
  @property({ attribute: false }) referenceBindings: readonly HojaWikiLinkReference[] = []
  @property({ type: String }) placeholder = 'Write a message…'
  @property({ type: String }) label = 'Message'
  @property({ type: Boolean, reflect: true }) disabled = false
  @property({ type: Boolean, reflect: true, attribute: 'readonly' }) readOnly = false

  /** Controlled callbacks. They report intent; Hoja never sends or persists. */
  @property({ attribute: false }) onChange?: HojaChangeHandler
  @property({ attribute: false }) onSubmit?: HojaSubmitHandler

  /** Optional host lookup seam. No lookup implementation lives in Hoja. */
  @property({ attribute: false }) resolveWikiLinks?: HojaWikiLinkResolver
  @property({ attribute: false }) onWikiLinkRequest?: (
    detail: HojaWikiLinkRequestDetail,
  ) => void
  @property({ attribute: false }) onWikiLinkSuggestions?: (
    detail: HojaWikiLinkSuggestionsDetail,
  ) => void
  @property({ attribute: false }) onWikiLinkClose?: (
    detail: HojaWikiLinkRequestDetail,
  ) => void

  @state() private formattingExpanded = false
  @state() private wikiLinkTrayState: WikiLinkTrayState = 'closed'
  @state() private wikiLinkSuggestions: readonly HojaWikiLinkSuggestion[] = []
  @state() private activeWikiLinkSuggestion = 0

  private editor: Editor | null = null
  private mountedValueKey: string | null = null
  private applyingControlledValue = false
  private composing = false
  private activeWikiLinkRequest: HojaWikiLinkRequestDetail | null = null
  private wikiLinkResolverAbort: AbortController | null = null
  private readonly toolbarId = `hoja-formatting-${++hojaInstance}`
  private readonly wikiLinkListboxId = `${this.toolbarId}-wikilinks`

  static styles = css`
    hoja-editor {
      --hoja-composer-min-block-size: 3.25rem;
      --hoja-composer-max-block-size: min(34dvh, 18rem);
      --hoja-composer-padding-inline: var(--mn-space-3, 0.75rem);
      --hoja-composer-padding-block: var(--mn-space-2-5, 0.625rem);
      display: block;
      min-width: 0;
      color: var(--mn-color-text-primary, #222a25);
      font-family: var(--mn-font-ui, system-ui, sans-serif);
    }

    hoja-editor .hoja-editor__frame {
      display: flex;
      min-width: 0;
      overflow: clip;
      border: 1px solid var(--mn-color-border-default, #c9d2cc);
      border-radius: var(--mn-radius-control, 0.75rem);
      background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff));
      box-shadow: var(--mn-shadow-xs, 0 1px 2px rgba(26, 45, 35, 0.08));
      transition:
        border-color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease);
    }

    hoja-editor[posture='composer'] .hoja-editor__frame {
      flex-direction: column;
    }

    hoja-editor .hoja-editor__frame:focus-within {
      border-color: var(--mn-color-border-focus, var(--mn-color-accent, #39765a));
      box-shadow: 0 0 0 3px var(--mn-focus-ring-color-soft, rgba(57, 118, 90, 0.16));
    }

    hoja-editor[disabled] .hoja-editor__frame {
      background: var(--mn-color-surface-sunken, #f1f3f1);
      color: var(--mn-color-text-disabled, #87908a);
      box-shadow: none;
      opacity: 0.72;
    }

    hoja-editor .hoja-editor__content {
      position: relative;
      min-width: 0;
      flex: 1 1 auto;
    }

    hoja-editor .hoja-editor__mount {
      max-block-size: var(--hoja-composer-max-block-size);
      min-block-size: var(--hoja-composer-min-block-size);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }

    hoja-editor .hoja-editor__mount .ProseMirror {
      min-block-size: var(--hoja-composer-min-block-size);
      box-sizing: border-box;
      padding: var(--hoja-composer-padding-block) var(--hoja-composer-padding-inline);
      outline: none;
      color: inherit;
      caret-color: var(--mn-color-accent, #39765a);
      font: var(--mn-text-base, 1rem) / var(--mn-leading-prose, 1.5)
        var(--mn-font-prose, ui-serif, Georgia, serif);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      -webkit-user-select: text;
      user-select: text;
    }

    hoja-editor .hoja-editor__mount .ProseMirror > * {
      margin-block: 0;
    }

    hoja-editor .hoja-editor__mount .ProseMirror > * + * {
      margin-block-start: 0.7em;
    }

    hoja-editor .hoja-editor__mount .ProseMirror code {
      border: 1px solid var(--mn-color-border-subtle, rgba(50, 70, 58, 0.14));
      border-radius: var(--mn-radius-xs, 0.25rem);
      background: var(--mn-color-surface-sunken, rgba(50, 70, 58, 0.08));
      padding: 0.08em 0.28em;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.9em;
    }

    hoja-editor .hoja-editor__mount .wikilink {
      border-radius: var(--mn-radius-xs, 0.25rem);
      background: var(--mn-color-surface-accent-subtle, rgba(57, 118, 90, 0.1));
      color: var(--mn-color-text-accent, #2e6a4f);
      padding-inline: 0.14em;
      text-decoration: underline dotted;
      text-underline-offset: 0.16em;
      cursor: pointer;
      white-space: nowrap;
    }

    hoja-editor .hoja-editor__mount .wikilink:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #39765a);
      outline-offset: 2px;
    }

    hoja-editor .hoja-editor__placeholder {
      position: absolute;
      inset: 0;
      display: none;
      box-sizing: border-box;
      padding: var(--hoja-composer-padding-block) var(--hoja-composer-padding-inline);
      color: var(--mn-color-text-muted, #768079);
      font: var(--mn-text-base, 1rem) / var(--mn-leading-prose, 1.5)
        var(--mn-font-prose, ui-serif, Georgia, serif);
      pointer-events: none;
    }

    hoja-editor[data-empty] .hoja-editor__placeholder {
      display: block;
    }

    hoja-editor .hoja-editor__footer {
      display: flex;
      min-height: 2.75rem;
      align-items: center;
      gap: var(--mn-space-1, 0.25rem);
      border-top: 1px solid var(--mn-color-border-subtle, rgba(50, 70, 58, 0.12));
      /* Hoja can be embedded in sticky rails, sheets, and full pages. The
         presentation owner—not the editor primitive—owns device insets, so a
         chat shell cannot accidentally pay the bottom safe area twice. */
      padding: var(--mn-space-1, 0.25rem) var(--mn-space-1-5, 0.375rem);
      background: var(--mn-color-surface-subtle, rgba(248, 250, 248, 0.76));
    }

    hoja-editor .hoja-editor__wikilink-tray {
      border-top: 1px solid var(--mn-color-border-subtle, rgba(50, 70, 58, 0.12));
      background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff));
    }

    hoja-editor .hoja-editor__wikilink-heading {
      display: flex;
      min-height: 2.25rem;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      padding-inline: var(--mn-space-3, 0.75rem);
      color: var(--mn-color-text-muted, #768079);
      font: 600 var(--mn-text-xs, 0.75rem) / 1.2 var(--mn-font-ui, system-ui, sans-serif);
      letter-spacing: 0.02em;
    }

    hoja-editor .hoja-editor__wikilink-query {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #4d5952);
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    hoja-editor .hoja-editor__wikilink-results {
      display: flex;
      max-height: min(38dvh, 16rem);
      flex-direction: column;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 var(--mn-space-1, 0.25rem) var(--mn-space-1, 0.25rem);
    }

    hoja-editor .hoja-editor__wikilink-option,
    hoja-editor .hoja-editor__wikilink-status {
      min-height: 3rem;
      box-sizing: border-box;
      border-radius: var(--mn-radius-control, 0.6rem);
      padding: var(--mn-space-2, 0.5rem) var(--mn-space-3, 0.75rem);
    }

    hoja-editor .hoja-editor__wikilink-option {
      display: flex;
      width: 100%;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      border: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #222a25);
      text-align: start;
      touch-action: manipulation;
      cursor: pointer;
    }

    hoja-editor .hoja-editor__wikilink-option[aria-selected='true'] {
      background: var(--mn-color-surface-accent-subtle, rgba(57, 118, 90, 0.1));
      color: var(--mn-color-text-accent, #2e6a4f);
    }

    hoja-editor .hoja-editor__wikilink-option:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #39765a);
      outline-offset: -2px;
    }

    hoja-editor .hoja-editor__wikilink-mark {
      flex: 0 0 auto;
      color: var(--mn-color-text-accent, #2e6a4f);
      font: 700 0.8rem/1 var(--mn-font-mono, ui-monospace, monospace);
    }

    hoja-editor .hoja-editor__wikilink-copy {
      display: grid;
      min-width: 0;
      gap: 0.16rem;
      flex: 1 1 auto;
    }

    hoja-editor .hoja-editor__wikilink-label,
    hoja-editor .hoja-editor__wikilink-context {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    hoja-editor .hoja-editor__wikilink-label {
      font: 600 var(--mn-text-sm, 0.875rem) / 1.2 var(--mn-font-ui, system-ui, sans-serif);
    }

    hoja-editor .hoja-editor__wikilink-context {
      color: var(--mn-color-text-muted, #768079);
      font: var(--mn-text-xs, 0.75rem) / 1.2 var(--mn-font-ui, system-ui, sans-serif);
    }

    hoja-editor .hoja-editor__wikilink-status {
      display: flex;
      align-items: center;
      color: var(--mn-color-text-muted, #768079);
      font: var(--mn-text-sm, 0.875rem) / 1.35 var(--mn-font-ui, system-ui, sans-serif);
    }

    hoja-editor .hoja-editor__wikilink-status[data-state='error'] {
      color: var(--mn-color-text-danger, #9f3535);
    }

    hoja-editor:not([posture='composer']) .hoja-editor__footer,
    hoja-editor[readonly] .hoja-editor__footer,
    hoja-editor[disabled] .hoja-editor__footer {
      display: none;
    }

    hoja-editor .hoja-editor__format-toggle,
    hoja-editor .hoja-editor__format-button,
    hoja-editor .hoja-editor__wikilink-toggle {
      display: inline-grid;
      box-sizing: border-box;
      min-width: 2.75rem;
      min-height: 2.75rem;
      flex: 0 0 auto;
      place-items: center;
      border: 0;
      border-radius: var(--mn-radius-control, 0.6rem);
      background: transparent;
      color: var(--mn-color-text-secondary, #4d5952);
      padding: 0;
      font: 600 0.875rem/1 var(--mn-font-ui, system-ui, sans-serif);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }

    hoja-editor .hoja-editor__format-toggle:hover,
    hoja-editor .hoja-editor__format-button:hover,
    hoja-editor .hoja-editor__format-button[aria-pressed='true'],
    hoja-editor .hoja-editor__wikilink-toggle:hover,
    hoja-editor .hoja-editor__wikilink-toggle[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, rgba(57, 118, 90, 0.09));
      color: var(--mn-color-text-accent, #2e6a4f);
    }

    hoja-editor .hoja-editor__format-toggle:focus-visible,
    hoja-editor .hoja-editor__format-button:focus-visible,
    hoja-editor .hoja-editor__wikilink-toggle:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #39765a);
      outline-offset: 1px;
    }

    hoja-editor .hoja-editor__format-toggle {
      font-family: var(--mn-font-prose, ui-serif, Georgia, serif);
      letter-spacing: -0.04em;
    }

    hoja-editor .hoja-editor__wikilink-toggle {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      letter-spacing: -0.14em;
    }

    hoja-editor .hoja-editor__format-tray {
      display: flex;
      align-items: center;
      gap: var(--mn-space-0-5, 0.125rem);
      flex: 0 0 auto;
    }

    hoja-editor .hoja-editor__format-button--italic {
      font-family: var(--mn-font-prose, ui-serif, Georgia, serif);
      font-style: italic;
    }

    hoja-editor .hoja-editor__format-button--code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }

    hoja-editor .hoja-editor__key-hint {
      min-width: 0;
      margin-inline-start: auto;
      padding-inline: var(--mn-space-2, 0.5rem);
      color: var(--mn-color-text-muted, #768079);
      font: var(--mn-text-xs, 0.75rem) / 1.2 var(--mn-font-ui, system-ui, sans-serif);
      white-space: nowrap;
    }

    hoja-editor[posture='embedded'] {
      block-size: 100%;
      min-block-size: 12rem;
    }

    hoja-editor[posture='embedded'] .hoja-editor__frame,
    hoja-editor[posture='page'] .hoja-editor__frame,
    hoja-editor[posture='embedded'] .hoja-editor__content,
    hoja-editor[posture='page'] .hoja-editor__content,
    hoja-editor[posture='embedded'] .hoja-editor__mount,
    hoja-editor[posture='page'] .hoja-editor__mount {
      block-size: 100%;
      max-block-size: none;
    }

    hoja-editor[posture='page'] .hoja-editor__frame {
      min-block-size: 100%;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    hoja-editor[posture='page'] .hoja-editor__mount .ProseMirror {
      width: min(100%, var(--mn-editor-sheet-width, 52rem));
      margin-inline: auto;
      padding: var(--mn-editor-sheet-padding, 3rem clamp(1rem, 5vw, 3rem) 5rem);
    }

    @media (max-width: 640px) {
      hoja-editor {
        --hoja-composer-min-block-size: 3.5rem;
        --hoja-composer-max-block-size: min(40dvh, 20rem);
      }

      hoja-editor .hoja-editor__footer {
        min-height: 3rem;
      }

      hoja-editor .hoja-editor__format-toggle,
      hoja-editor .hoja-editor__format-button,
      hoja-editor .hoja-editor__wikilink-toggle {
        min-width: 3rem;
        min-height: 3rem;
      }

      hoja-editor .hoja-editor__mount .ProseMirror,
      hoja-editor .hoja-editor__placeholder {
        /* Avoid iOS input zoom while preserving host typography elsewhere. */
        font-size: max(1rem, var(--mn-font-size-base, 1rem));
      }

      hoja-editor .hoja-editor__key-hint {
        overflow: hidden;
        max-width: 11rem;
        text-overflow: ellipsis;
      }
    }

    @media (max-width: 380px) {
      hoja-editor .hoja-editor__key-hint {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      hoja-editor .hoja-editor__frame {
        transition: none;
      }
    }
  `

  /** Light DOM is load-bearing for ProseMirror selection and host tokens. */
  createRenderRoot(): this {
    return this
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.adoptStyles()
    void this.updateComplete.then(() => this.mountEditor())
  }

  override disconnectedCallback(): void {
    this.destroyEditor()
    super.disconnectedCallback()
  }

  protected override firstUpdated(): void {
    this.mountEditor()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!this.editor) return
    if (changed.has('valueKey') && this.mountedValueKey !== this.valueKey) {
      this.recreateEditorForValueKey()
      return
    }
    if (changed.has('disabled') || changed.has('readOnly')) {
      this.syncInteractivity()
      if ((this.disabled || this.readOnly) && this.activeWikiLinkRequest) {
        this.closeWikiLinkRequest()
      }
    }
    if (
      changed.has('label') ||
      changed.has('disabled') ||
      changed.has('readOnly') ||
      changed.has('posture')
    ) this.syncAria()

    if (changed.has('value')) {
      const current = serializeComposerMarkdown(this.editor.getJSON() as HojaJSONContent)
      if (current !== this.value) this.applyValue(this.value, this.referenceBindings)
    } else if (changed.has('referenceBindings')) {
      const current = collectWikiLinkReferences(this.editor.getJSON() as HojaJSONContent)
      if (!referencesEqual(current, this.referenceBindings)) {
        this.applyValue(this.value, this.referenceBindings)
      }
    }
  }

  /** Focus the actual ProseMirror surface; disabled Hoja surfaces stay inert. */
  override focus(options?: FocusOptions): void {
    if (this.disabled) return
    const dom = this.editor?.view.dom
    if (dom) dom.focus(options)
    else void this.updateComplete.then(() => this.editor?.view.dom.focus(options))
  }

  /** Current editor JSON, returned as a fresh TipTap snapshot. */
  getJSON(): HojaJSONContent {
    return (this.editor?.getJSON() as HojaJSONContent | undefined) ?? parseComposerMarkdown(this.value, this.referenceBindings)
  }

  /**
   * Resolve the active `[[query` request with host-owned graph truth.
   * Returns false for stale requests, disabled/read-only state, or no request.
   */
  acceptWikiLink(suggestion: HojaWikiLinkSuggestion, requestId?: number): boolean {
    const request = this.activeWikiLinkRequest
    if (
      !this.editor ||
      !request ||
      this.disabled ||
      this.readOnly ||
      (requestId !== undefined && requestId !== request.requestId)
    ) return false

    const applied = this.editor
      .chain()
      .focus()
      .deleteRange(request.range)
      .insertWikiLink({
        targetDocId: suggestion.targetDocId,
        targetGraphId: suggestion.targetGraphId ?? null,
        targetBlockId: suggestion.targetBlockId ?? null,
        blockPreview: suggestion.blockPreview ?? null,
        label: suggestion.label,
      })
      .run()
    if (applied) this.closeWikiLinkRequest()
    return applied
  }

  /** Cancel only this Hoja instance's active resolver request. */
  cancelWikiLinkRequest(requestId?: number): void {
    if (
      this.activeWikiLinkRequest &&
      (requestId === undefined || requestId === this.activeWikiLinkRequest.requestId)
    ) this.closeWikiLinkRequest()
  }

  /**
   * Event-driven alternative to `resolveWikiLinks`: a host that handles
   * `hoja-wikilink-request` can provide its own results here.
   */
  provideWikiLinkSuggestions(
    requestId: number,
    suggestions: readonly HojaWikiLinkSuggestion[],
  ): boolean {
    const request = this.activeWikiLinkRequest
    if (!request || request.requestId !== requestId) return false
    this.wikiLinkSuggestions = suggestions
    this.activeWikiLinkSuggestion = 0
    this.wikiLinkTrayState = suggestions.length ? 'ready' : 'empty'
    const detail: HojaWikiLinkSuggestionsDetail = { request, suggestions }
    this.onWikiLinkSuggestions?.(detail)
    this.dispatchEvent(
      new CustomEvent<HojaWikiLinkSuggestionsDetail>(HOJA_EVENTS.wikiLinkSuggestions, {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
    this.syncAria()
    return true
  }

  /** Mark the active event-driven request as failed without inventing results. */
  failWikiLinkRequest(requestId: number, error?: unknown): boolean {
    const request = this.activeWikiLinkRequest
    if (!request || request.requestId !== requestId) return false
    this.wikiLinkSuggestions = []
    this.wikiLinkTrayState = 'error'
    this.dispatchEvent(new CustomEvent(HOJA_EVENTS.wikiLinkResolveError, {
      detail: { request, error },
      bubbles: true,
      composed: true,
    }))
    this.syncAria()
    return true
  }

  private adoptStyles(): void {
    if (
      typeof CSSStyleSheet === 'undefined' ||
      typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync !== 'function'
    ) return
    if (!hojaStyleSheet) {
      hojaStyleSheet = new CSSStyleSheet()
      hojaStyleSheet.replaceSync((HojaEditor.styles as CSSResult).cssText)
    }
    const root = this.getRootNode() as Document | ShadowRoot
    if (root.adoptedStyleSheets && !root.adoptedStyleSheets.includes(hojaStyleSheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, hojaStyleSheet]
    }
  }

  private mountEditor(): void {
    if (this.editor || !this.isConnected) return
    const mount = this.querySelector<HTMLElement>('.hoja-editor__mount')
    if (!mount) return

    this.editor = createKernelEditor(mount, {
      // Composer gets the kernel's safe paragraph/inline roster. This keeps
      // document-only slash/tag/citation/wire intents out of chat entirely.
      profile: this.posture === 'composer' ? 'composer' : 'document',
      onWikiLinkPickerOpen: this.handleKernelWikiLinkPickerOpen,
      onWikiLinkAutocompleteOpen: this.handleKernelWikiLinkAutocompleteOpen,
      onWikiLinkAutocompleteClose: this.handleKernelWikiLinkAutocompleteClose,
    })
    this.mountedValueKey = this.valueKey
    this.editor.on('update', this.handleEditorUpdate)
    this.editor.on('transaction', this.handleEditorTransaction)
    mount.addEventListener('keydown', this.handleKeyDown, true)
    mount.addEventListener('compositionstart', this.handleCompositionStart, true)
    mount.addEventListener('compositionend', this.handleCompositionEnd, true)
    this.applyValue(this.value, this.referenceBindings)
    this.syncInteractivity()
    this.syncAria()
  }

  private destroyEditor(): void {
    if (!this.editor) return
    const mount = this.querySelector<HTMLElement>('.hoja-editor__mount')
    mount?.removeEventListener('keydown', this.handleKeyDown, true)
    mount?.removeEventListener('compositionstart', this.handleCompositionStart, true)
    mount?.removeEventListener('compositionend', this.handleCompositionEnd, true)
    this.editor.off('update', this.handleEditorUpdate)
    this.editor.off('transaction', this.handleEditorTransaction)
    this.editor.destroy()
    this.editor = null
    this.mountedValueKey = null
    this.wikiLinkResolverAbort?.abort()
    this.wikiLinkResolverAbort = null
    this.activeWikiLinkRequest = null
    this.wikiLinkSuggestions = []
    this.wikiLinkTrayState = 'closed'
  }

  private recreateEditorForValueKey(): void {
    const restoreFocus = this.editor?.isFocused ?? false
    if (this.activeWikiLinkRequest) this.closeWikiLinkRequest()
    this.destroyEditor()
    this.mountEditor()
    if (restoreFocus) this.focus()
  }

  private applyValue(
    value: string,
    referenceBindings: readonly HojaWikiLinkReference[],
  ): void {
    if (!this.editor) return
    this.applyingControlledValue = true
    try {
      this.editor.commands.setContent(parseComposerMarkdown(value, referenceBindings), {
        emitUpdate: false,
      })
    } finally {
      this.applyingControlledValue = false
    }
    this.syncEmptyState()
  }

  private syncInteractivity(): void {
    this.editor?.setEditable(!this.disabled && !this.readOnly)
  }

  private syncAria(): void {
    const dom = this.editor?.view.dom
    if (!dom) return
    dom.setAttribute('role', 'textbox')
    dom.setAttribute('aria-multiline', 'true')
    dom.setAttribute('aria-label', this.label)
    dom.setAttribute('aria-readonly', String(this.readOnly))
    dom.setAttribute('aria-disabled', String(this.disabled))
    if (this.posture === 'composer') dom.setAttribute('aria-keyshortcuts', 'Enter')
    else dom.removeAttribute('aria-keyshortcuts')
    if (this.activeWikiLinkRequest) {
      dom.setAttribute('aria-controls', this.wikiLinkListboxId)
      dom.setAttribute('aria-expanded', 'true')
      dom.setAttribute('aria-autocomplete', 'list')
      if (this.wikiLinkTrayState === 'ready' && this.wikiLinkSuggestions.length) {
        dom.setAttribute(
          'aria-activedescendant',
          this.wikiLinkOptionId(this.activeWikiLinkSuggestion),
        )
      } else {
        dom.removeAttribute('aria-activedescendant')
      }
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-expanded')
      dom.removeAttribute('aria-autocomplete')
      dom.removeAttribute('aria-activedescendant')
    }
  }

  private makeDetail(): HojaComposerDetail {
    const json = this.getJSON()
    const references = collectWikiLinkReferences(json)
    const plainText = this.editor?.getText() ?? ''
    return {
      value: serializeComposerMarkdown(json),
      plainText,
      json,
      references,
      isEmpty: plainText.trim().length === 0 && references.length === 0,
    }
  }

  private syncEmptyState(): void {
    const detail = this.makeDetail()
    this.toggleAttribute('data-empty', detail.isEmpty)
  }

  private readonly handleEditorUpdate = (): void => {
    if (this.applyingControlledValue) return
    const detail = this.makeDetail()
    this.toggleAttribute('data-empty', detail.isEmpty)
    // TipTap may emit a late create/update transaction after a light-DOM host
    // has already projected the same controlled value. That is an echo, not a
    // user edit: suppress it just as applyValue suppresses setContent updates.
    if (
      detail.value === this.value
      && referencesEqual(detail.references, this.referenceBindings)
    ) {
      return
    }
    this.onChange?.(detail)
    this.dispatchEvent(new CustomEvent<HojaComposerDetail>(HOJA_EVENTS.change, {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private readonly handleEditorTransaction = (): void => {
    if (!this.applyingControlledValue) this.requestUpdate()
  }

  private readonly handleCompositionStart = (): void => {
    this.composing = true
  }

  private readonly handleCompositionEnd = (): void => {
    this.composing = false
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.activeWikiLinkRequest) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.closeWikiLinkRequest()
        return
      }
      if (
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        this.wikiLinkTrayState === 'ready' &&
        this.wikiLinkSuggestions.length
      ) {
        event.preventDefault()
        event.stopPropagation()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        this.activeWikiLinkSuggestion = (
          this.activeWikiLinkSuggestion + direction + this.wikiLinkSuggestions.length
        ) % this.wikiLinkSuggestions.length
        this.syncAria()
        return
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        !this.composing &&
        event.keyCode !== 229
      ) {
        // An open combobox owns plain Enter. Ready chooses the active result;
        // loading/empty/error intentionally do nothing instead of accidentally
        // sending the unresolved `[[query` as a chat message.
        event.preventDefault()
        event.stopPropagation()
        const suggestion = this.wikiLinkTrayState === 'ready'
          ? this.wikiLinkSuggestions[this.activeWikiLinkSuggestion]
          : undefined
        if (suggestion) {
          this.acceptWikiLink(suggestion, this.activeWikiLinkRequest.requestId)
        }
        return
      }
    }

    if (
      this.posture !== 'composer' ||
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.isComposing ||
      this.composing ||
      event.keyCode === 229 ||
      this.disabled ||
      this.readOnly
    ) return

    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    const detail = this.makeDetail()
    if (detail.isEmpty) return
    this.onSubmit?.(detail)
    this.dispatchEvent(new CustomEvent<HojaComposerDetail>(HOJA_EVENTS.submit, {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private readonly handleKernelWikiLinkPickerOpen = (): void => {
    if (!this.editor?.isFocused || this.disabled || this.readOnly) return
    const selection = this.editor.state.selection
    this.openWikiLinkRequest({
      requestId: ++hojaWikiLinkRequest,
      query: '',
      matchedText: '',
      range: { from: selection.from, to: selection.to },
    })
  }

  private readonly handleKernelWikiLinkAutocompleteOpen = (
    detail: OpenWikiLinkPickerDetail,
  ): void => {
    if (!this.editor?.isFocused || this.disabled || this.readOnly) return
    this.openWikiLinkRequest({
      requestId: ++hojaWikiLinkRequest,
      query: detail.query,
      matchedText: detail.matchedText,
      range: detail.range,
    })
  }

  private openWikiLinkRequest(request: HojaWikiLinkRequestDetail): void {
    // Formatting and reference lookup are sibling elaborations of one compact
    // surface. Keep only the current task open instead of squeezing both trays.
    this.formattingExpanded = false
    this.wikiLinkResolverAbort?.abort()
    this.wikiLinkResolverAbort = new AbortController()
    this.activeWikiLinkRequest = request
    this.wikiLinkSuggestions = []
    this.activeWikiLinkSuggestion = 0
    this.wikiLinkTrayState = 'loading'
    this.syncAria()
    this.onWikiLinkRequest?.(request)
    this.dispatchEvent(new CustomEvent<HojaWikiLinkRequestDetail>(HOJA_EVENTS.wikiLinkRequest, {
      detail: request,
      bubbles: true,
      composed: true,
    }))
    void this.resolveWikiLinkRequest(request)
  }

  private readonly handleKernelWikiLinkAutocompleteClose = (): void => {
    if (!this.editor?.isFocused || !this.activeWikiLinkRequest) return
    this.closeWikiLinkRequest()
  }

  private async resolveWikiLinkRequest(request: HojaWikiLinkRequestDetail): Promise<void> {
    const resolver = this.resolveWikiLinks
    if (!resolver) return
    const controller = this.wikiLinkResolverAbort
    if (!controller) return
    try {
      const suggestions = await resolver(request, { signal: controller.signal })
      if (controller.signal.aborted) return
      this.provideWikiLinkSuggestions(request.requestId, suggestions)
    } catch (error) {
      if (controller.signal.aborted) return
      this.failWikiLinkRequest(request.requestId, error)
    }
  }

  private closeWikiLinkRequest(): void {
    const request = this.activeWikiLinkRequest
    if (!request) return
    this.wikiLinkResolverAbort?.abort()
    this.wikiLinkResolverAbort = null
    this.activeWikiLinkRequest = null
    this.wikiLinkSuggestions = []
    this.activeWikiLinkSuggestion = 0
    this.wikiLinkTrayState = 'closed'
    this.syncAria()
    this.onWikiLinkClose?.(request)
    this.dispatchEvent(new CustomEvent<HojaWikiLinkRequestDetail>(HOJA_EVENTS.wikiLinkClose, {
      detail: request,
      bubbles: true,
      composed: true,
    }))
  }

  private requestWikiLinkFromToolbar(): void {
    if (!this.editor || this.disabled || this.readOnly) return
    this.editor.commands.focus()
    const { from, to } = this.editor.state.selection
    const query = from === to ? '' : this.editor.state.doc.textBetween(from, to, ' ')
    this.openWikiLinkRequest({
      requestId: ++hojaWikiLinkRequest,
      query,
      matchedText: query,
      range: { from, to },
    })
  }

  private wikiLinkOptionId(index: number): string {
    return `${this.wikiLinkListboxId}-option-${index}`
  }

  private chooseWikiLinkFromPointer(
    event: PointerEvent,
    suggestion: HojaWikiLinkSuggestion,
  ): void {
    event.preventDefault()
    this.acceptWikiLink(suggestion, this.activeWikiLinkRequest?.requestId)
  }

  private toggleFormatting(): void {
    const opening = !this.formattingExpanded
    if (opening && this.activeWikiLinkRequest) this.closeWikiLinkRequest()
    this.formattingExpanded = opening
  }

  private keepSelection(event: MouseEvent): void {
    event.preventDefault()
  }

  private runFormat(format: ComposerFormat): void {
    if (!this.editor || this.disabled || this.readOnly) return
    const chain = this.editor.chain().focus()
    if (format === 'bold') chain.toggleBold().run()
    else if (format === 'italic') chain.toggleItalic().run()
    else chain.toggleCode().run()
  }

  private renderFormatButton(
    format: ComposerFormat,
    label: string,
    glyph: string,
  ): TemplateResult {
    return html`
      <button
        class="hoja-editor__format-button hoja-editor__format-button--${format}"
        type="button"
        aria-label=${label}
        aria-pressed=${String(this.editor?.isActive(format) ?? false)}
        title=${label}
        @mousedown=${this.keepSelection}
        @click=${() => this.runFormat(format)}
      >${glyph}</button>
    `
  }

  private renderWikiLinkTray(): TemplateResult | typeof nothing {
    const request = this.activeWikiLinkRequest
    if (!request) return nothing
    const query = request.query.trim()
    return html`
      <section class="hoja-editor__wikilink-tray" aria-label="Document references">
        <div class="hoja-editor__wikilink-heading">
          <span>Link a document</span>
          ${query ? html`<span class="hoja-editor__wikilink-query">“${query}”</span>` : nothing}
        </div>
        <div
          class="hoja-editor__wikilink-results"
          id=${this.wikiLinkListboxId}
          role="listbox"
          aria-label="Matching documents"
          aria-busy=${String(this.wikiLinkTrayState === 'loading')}
        >
          ${this.wikiLinkTrayState === 'loading' ? html`
            <div class="hoja-editor__wikilink-status" role="status" data-state="loading">
              Searching references…
            </div>
          ` : nothing}
          ${this.wikiLinkTrayState === 'empty' ? html`
            <div class="hoja-editor__wikilink-status" role="status" data-state="empty">
              No matching documents
            </div>
          ` : nothing}
          ${this.wikiLinkTrayState === 'error' ? html`
            <div class="hoja-editor__wikilink-status" role="status" data-state="error">
              Couldn’t load references
            </div>
          ` : nothing}
          ${this.wikiLinkTrayState === 'ready' ? this.wikiLinkSuggestions.map((suggestion, index) => html`
            <button
              class="hoja-editor__wikilink-option"
              id=${this.wikiLinkOptionId(index)}
              type="button"
              role="option"
              tabindex="-1"
              aria-selected=${String(index === this.activeWikiLinkSuggestion)}
              @mouseenter=${() => {
                this.activeWikiLinkSuggestion = index
                this.syncAria()
              }}
              @pointerdown=${(event: PointerEvent) => this.chooseWikiLinkFromPointer(event, suggestion)}
            >
              <span class="hoja-editor__wikilink-mark" aria-hidden="true">[[ ]]</span>
              <span class="hoja-editor__wikilink-copy">
                <span class="hoja-editor__wikilink-label">${suggestion.label}</span>
                ${suggestion.blockPreview || suggestion.targetGraphId ? html`
                  <span class="hoja-editor__wikilink-context">
                    ${suggestion.blockPreview ?? suggestion.targetGraphId}
                  </span>
                ` : nothing}
              </span>
            </button>
          `) : nothing}
        </div>
      </section>
    `
  }

  protected override render(): TemplateResult {
    return html`
      <div class="hoja-editor__frame">
        <div class="hoja-editor__content">
          <div class="hoja-editor__mount"></div>
          <div class="hoja-editor__placeholder" aria-hidden="true">${this.placeholder}</div>
        </div>
        ${this.renderWikiLinkTray()}
        <div class="hoja-editor__footer">
          <button
            class="hoja-editor__format-toggle"
            type="button"
            aria-label="Show formatting"
            aria-expanded=${String(this.formattingExpanded)}
            aria-controls=${this.toolbarId}
            title="Formatting"
            @click=${this.toggleFormatting}
          >Aa</button>
          <button
            class="hoja-editor__wikilink-toggle"
            type="button"
            aria-label="Link a document"
            aria-expanded=${String(Boolean(this.activeWikiLinkRequest))}
            aria-controls=${this.wikiLinkListboxId}
            title="Link a document"
            @mousedown=${this.keepSelection}
            @click=${this.requestWikiLinkFromToolbar}
          >[[ ]]</button>
          ${this.formattingExpanded ? html`
            <div
              class="hoja-editor__format-tray"
              id=${this.toolbarId}
              role="toolbar"
              aria-label="Message formatting"
            >
              ${this.renderFormatButton('bold', 'Bold', 'B')}
              ${this.renderFormatButton('italic', 'Italic', 'I')}
              ${this.renderFormatButton('code', 'Inline code', '</>')}
            </div>
          ` : nothing}
          <span class="hoja-editor__key-hint">Enter to send · Shift+Enter for a new line</span>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hoja-editor': HojaEditor
  }
}
