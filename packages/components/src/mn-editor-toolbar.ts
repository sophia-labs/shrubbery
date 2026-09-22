/**
 * mn-editor-toolbar — controlled Garden editor toolbar shell.
 *
 * This is UI only: it owns no editor state and runs no editor commands. The
 * runtime host passes state in, listens for `mn-editor-*` events, and remains the
 * sole owner of the live editor/search behavior.
 */

import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import type { MenuEntry } from '@shrubbery/nucleus'
import type { MnDropdownSelectDetail } from './mn-dropdown-button.js'
import './mn-button.js'
import './mn-icon-button.js'
import './mn-toolbar.js'
import './mn-dropdown-button.js'

export type MnEditorInlineCommand = 'bold' | 'italic' | 'strike' | 'code' | 'highlight'
export type MnEditorHistoryCommand = 'undo' | 'redo'
export type MnEditorTextAlign = 'left' | 'center' | 'right'
export type MnEditorBlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'

const BLOCK_TYPE_OPTIONS: ReadonlyArray<readonly [MnEditorBlockType, string]> = [
  ['paragraph', 'Paragraph'],
  ['heading1', 'Heading 1'],
  ['heading2', 'Heading 2'],
  ['heading3', 'Heading 3'],
  ['bulletList', 'Bullet list'],
  ['orderedList', 'Numbered list'],
  ['taskList', 'Checklist'],
  ['blockquote', 'Quote'],
  ['codeBlock', 'Code block'],
]

export interface MnEditorToolbarFormatState {
  readonly bold: boolean
  readonly italic: boolean
  readonly strike: boolean
  readonly code: boolean
  readonly highlight: boolean
}

export interface MnEditorFontFamily {
  readonly label: string
  readonly value: string
  readonly category: 'sans' | 'serif' | 'mono'
}

export interface MnEditorFontSize {
  readonly label: string
  readonly value: string
}

export interface MnEditorFormatDetail {
  readonly command: MnEditorInlineCommand
}

export interface MnEditorHistoryDetail {
  readonly command: MnEditorHistoryCommand
}

export interface MnEditorBlockTypeDetail {
  readonly blockType: MnEditorBlockType
}

export interface MnEditorAlignDetail {
  readonly alignment: MnEditorTextAlign
}

export interface MnEditorTextChangeDetail {
  readonly value: string
}

export interface MnEditorTextStyleDetail {
  readonly value: string
}

export interface MnEditorModifierDetail {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

export interface MnEditorKeyboardDetail {
  readonly keyboardEvent: KeyboardEvent
}

export type MnEditorTtsStatus = 'idle' | 'loading' | 'playing' | 'paused'

const DEFAULT_FONT_FAMILIES: readonly MnEditorFontFamily[] = Object.freeze([
  { label: 'Source Sans', value: "'Source Sans 3 Variable', 'Source Sans 3', sans-serif", category: 'sans' },
  { label: 'DM Sans', value: "'DM Sans', sans-serif", category: 'sans' },
  { label: 'Jakarta', value: "'Plus Jakarta Sans', sans-serif", category: 'sans' },
  { label: 'Inter', value: "'Inter Variable', 'Inter', sans-serif", category: 'sans' },
  { label: 'Public Sans', value: "'Public Sans Variable', 'Public Sans', sans-serif", category: 'sans' },
  { label: 'Comic Neue', value: "'Comic Neue', sans-serif", category: 'sans' },
  { label: 'Literata', value: "'Literata Variable', 'Literata', serif", category: 'serif' },
  { label: 'Lora', value: "'Lora', serif", category: 'serif' },
  { label: 'Crimson', value: "'Crimson Pro', serif", category: 'serif' },
  { label: 'Source Serif', value: "'Source Serif 4', serif", category: 'serif' },
  { label: 'Domitian', value: "'Domitian', serif", category: 'serif' },
  { label: 'JetBrains Mono', value: "'JetBrains Mono Variable', 'JetBrains Mono', monospace", category: 'mono' },
])

const DEFAULT_FONT_SIZES: readonly MnEditorFontSize[] = Object.freeze([
  { label: 'XS', value: '12px' },
  { label: 'S', value: '14px' },
  { label: 'M', value: '16px' },
  { label: 'L', value: '20px' },
  { label: 'XL', value: '24px' },
])

let editorToolbarInstance = 0

@customElement('mn-editor-toolbar')
export class MnEditorToolbar extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      box-sizing: border-box;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #394150);
      font: 0.78rem/1.2 var(--mn-font-sans, system-ui, sans-serif);
      /* Toolbar group captions ("Type", "Block formatting", etc.) are redundant with
         each button's own tooltip/aria-label and just eat width — hide them
         here regardless of skin. Uses the narrower
         --mn-toolbar-group-label-display, NOT the shared --mn-label-display:
         the latter also drives mn-button's own .label (Document View, Make
         Editable, View Original, Table are all mn-button inside this
         toolbar) and other chrome elsewhere — overriding it here would
         silently make those controls icon-only and unlabeled too. */
      --mn-toolbar-group-label-display: none;
    }

    mn-toolbar {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 0.2rem;
      min-height: 2.25rem;
      padding: 0.3rem 0.5rem;
      overflow-x: auto;
      --mn-toolbar-gap: 0.2rem;
    }

    .toolbar-scroll-shell {
      position: relative;
      min-width: 0;
      background: inherit;
    }

    .toolbar-scroll-shell > mn-toolbar {
      width: 100%;
      min-width: 0;
      scrollbar-color: var(--mn-color-border-strong, #b8c0b9) transparent;
      scrollbar-width: thin;
      scroll-padding-inline: 2.25rem;
    }

    .toolbar-scroll-shell > mn-toolbar::-webkit-scrollbar {
      height: 4px;
    }

    .toolbar-scroll-shell > mn-toolbar::-webkit-scrollbar-track {
      background: transparent;
    }

    .toolbar-scroll-shell > mn-toolbar::-webkit-scrollbar-thumb {
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-border-strong, #b8c0b9);
    }

    /* Overlay fade buttons that float above the scrollable toolbar content
       rather than reserving their own flanking columns — the toolbar keeps
       its full width and the controls read as an affordance on top of it,
       not a separate panel bolted to the side. */
    .toolbar-scroll-control {
      display: none;
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 1;
      align-items: center;
      width: 2.25rem;
      border: none;
      color: var(--mn-color-text-secondary, #394150);
      /* The control IS an <mn-icon-button>, whose clickable <button> lives in
         shadow DOM and inherits the host's pointer-events. Keep the host
         interactive so the scroll button genuinely receives clicks; the
         decorative fade rides a separate non-interactive ::before layer below,
         so the toolbar content it overlays stays click-through. */
      pointer-events: auto;
      opacity: 0;
      transition: opacity var(--mn-transition-fast, 120ms ease);
    }

    /* Hidden until the toolbar is actually being interacted with — a scroll
       affordance you only need while your pointer/focus is there, not a
       permanent extra layer of chrome on top of the toolbar. The boundary
       rule below (data-at-start/data-at-end) still wins on specificity, so
       hovering never reveals an arrow that has nowhere left to scroll. */
    .toolbar-scroll-shell:hover > .toolbar-scroll-control,
    .toolbar-scroll-shell:focus-within > .toolbar-scroll-control {
      opacity: 1;
    }

    /* Fade/gradient lives here, not on the interactive host, so it can be
       click-through (pointer-events: none) without disabling the button. */
    .toolbar-scroll-control::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
    }

    .toolbar-scroll-shell[data-overflow='true'] > .toolbar-scroll-control {
      display: flex;
    }

    .toolbar-scroll-control.start {
      left: 0;
      justify-content: flex-start;
      padding-inline-start: 0.15rem;
    }

    .toolbar-scroll-control.start::before {
      background: linear-gradient(
        to right,
        var(--mn-color-surface-chrome, #edf2ed) 55%,
        color-mix(in srgb, var(--mn-color-surface-chrome, #edf2ed) 0%, transparent)
      );
    }

    .toolbar-scroll-control.end {
      right: 0;
      justify-content: flex-end;
      padding-inline-end: 0.15rem;
    }

    .toolbar-scroll-control.end::before {
      background: linear-gradient(
        to left,
        var(--mn-color-surface-chrome, #edf2ed) 55%,
        color-mix(in srgb, var(--mn-color-surface-chrome, #edf2ed) 0%, transparent)
      );
    }

    .toolbar-scroll-control[hidden],
    .toolbar-scroll-shell[data-at-start='true'] > .toolbar-scroll-control.start,
    .toolbar-scroll-shell[data-at-end='true'] > .toolbar-scroll-control.end {
      opacity: 0;
      pointer-events: none;
    }

    mn-toolbar-group {
      flex: 0 0 auto;
    }

    .toolbar-spacer {
      flex: 1 1 auto;
      min-width: 0.5rem;
    }

    .compact-primary-toolbar,
    .compact-sheet-backdrop,
    .compact-sheet-header {
      display: none;
    }

    .toolbar-disclosure {
      display: contents;
    }

    .toolbar-adaptive-root {
      display: contents;
    }

    .toolbar-adaptive-root[data-compact-capable='false'] .compact-primary-toolbar {
      display: none;
    }

    .original-view-note {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-read-only-badge],
    [data-document-sync-badge] {
      display: inline-flex;
      align-items: center;
      min-height: 1.75rem;
      padding: 0 0.55rem;
      border-radius: 999px;
      background: var(--mn-color-surface-subtle, #eef2f0);
      color: var(--mn-color-text-secondary, #394150);
      font-weight: 650;
    }

    :host([data-skin='98']) {
      border-bottom: 2px groove var(--mn-98-face);
      background: var(--mn-98-face);
      box-shadow: inset 0 1px 0 var(--mn-98-highlight);
    }
    :host([data-skin='98']) [data-read-only-badge],
    :host([data-skin='98']) [data-document-sync-badge] {
      border-radius: 0;
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='glass']) {
      border-bottom: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-chrome);
      box-shadow: var(--mn-shadow-chrome);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .toolbar-scroll-control,
    :host([data-skin='glass']) [data-read-only-badge],
    :host([data-skin='glass']) [data-document-sync-badge] {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }

    [data-make-editable-error] {
      margin: 0;
      padding: 0.35rem 0.65rem;
      border-top: 1px solid var(--mn-color-border-danger, #efb3b3);
      background: var(--mn-color-surface-danger-subtle, #fff1f1);
      color: var(--mn-color-text-danger, #9b1c1c);
      font-size: var(--mn-text-xs, 0.75rem);
    }

    input:focus-visible {
      outline: 2px solid var(--mn-color-border-accent, #3d7f5f);
      outline-offset: 1px;
    }

    .search-anchor {
      position: relative;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
    }

    .find-bar {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: var(--mn-z-popover, 1100);
      box-sizing: border-box;
      display: flex;
      width: min(28rem, calc(100vw - 2rem));
      min-width: 18rem;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.55rem;
      border: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-raised, 0 8px 24px rgba(15, 23, 42, 0.16));
    }

    .find-row,
    .replace-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
    }

    input {
      min-width: 0;
      flex: 1 1 auto;
      box-sizing: border-box;
      height: 1.85rem;
      padding: 0.35rem 0.45rem;
      border: 1px solid var(--mn-color-border-default, #d0d7de);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #17202a);
      font: inherit;
    }

    .find-count {
      flex: 0 0 auto;
      min-width: 3.25rem;
      color: var(--mn-color-text-muted, #697386);
      text-align: center;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .find-nav,
    .replace-actions {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 0.2rem;
    }

    @media (max-width: 719px) {
      :host {
        border-bottom-color: var(--mn-color-border-subtle, #e6e8eb);
      }

      .compact-primary-toolbar {
        box-sizing: border-box;
        display: flex;
        min-height: 3.5rem;
        align-items: center;
        justify-content: space-evenly;
        gap: 0.15rem;
        padding: 0.25rem max(0.35rem, env(safe-area-inset-left)) 0.25rem max(0.35rem, env(safe-area-inset-right));
        background: var(--mn-color-surface-base, #fff);
      }

      mn-icon-button {
        --mn-icon-button-hit-size: var(--mn-touch-target-size, 48px);
      }

      mn-button {
        --mn-button-hit-size: var(--mn-touch-target-size, 48px);
      }

      .toolbar-scroll-shell[data-overflow='true'] {
        grid-template-columns: var(--mn-touch-target-size, 48px) minmax(0, 1fr) var(--mn-touch-target-size, 48px);
      }

      .toolbar-disclosure[data-compact-capable='true'] {
        display: none;
      }

      .toolbar-disclosure[data-compact-capable='true'][data-compact-open='true'] {
        position: fixed;
        inset: auto max(0.5rem, env(safe-area-inset-right)) max(0.5rem, env(safe-area-inset-bottom)) max(0.5rem, env(safe-area-inset-left));
        z-index: var(--mn-z-modal, 1150);
        box-sizing: border-box;
        display: flex;
        max-height: min(72dvh, 38rem);
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--mn-color-border-default, #d0d7de);
        border-radius: var(--mn-radius-lg, 14px);
        background: var(--mn-color-surface-base, #fff);
        box-shadow: var(--mn-shadow-modal, 0 20px 50px rgba(15, 23, 42, 0.28));
      }

      .compact-sheet-backdrop[data-open='true'] {
        position: fixed;
        inset: 0;
        z-index: calc(var(--mn-z-modal, 1150) - 1);
        display: block;
        background: color-mix(in srgb, var(--mn-color-text-primary, #17202a) 34%, transparent);
      }

      .compact-sheet-header {
        box-sizing: border-box;
        display: flex;
        min-height: 3.5rem;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.35rem 0.45rem 0.35rem 1rem;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      }

      .compact-sheet-title {
        color: var(--mn-color-text-primary, #17202a);
        font-size: var(--mn-text-base, 0.95rem);
        font-weight: 700;
      }

      .compact-sheet-done {
        min-width: 4.5rem;
        min-height: var(--mn-touch-target-size, 48px);
        padding: 0 0.85rem;
        border: 0;
        border-radius: var(--mn-radius-control, 8px);
        background: transparent;
        color: var(--mn-color-text-accent, #2563eb);
        font: inherit;
        font-size: var(--mn-text-sm, 0.85rem);
        font-weight: 700;
      }

      .compact-sheet-done:focus-visible {
        outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
        outline-offset: -2px;
      }

      .toolbar-disclosure[data-compact-open='true'] .toolbar-scroll-shell {
        display: block;
        min-height: 0;
        overflow: auto;
      }

      .toolbar-disclosure[data-compact-open='true'] .toolbar-scroll-control {
        display: none;
      }

      .toolbar-disclosure[data-compact-open='true'] mn-toolbar {
        box-sizing: border-box;
        display: flex;
        min-height: 0;
        max-height: none;
        flex-wrap: wrap;
        align-content: flex-start;
        align-items: flex-start;
        gap: 0.55rem 0.35rem;
        overflow: visible;
        padding: 0.65rem;
      }

      .toolbar-disclosure[data-compact-open='true'] mn-toolbar-group {
        min-height: var(--mn-touch-target-size, 48px);
        width: 100%;
        margin-inline-end: 0;
        padding-inline-end: 0;
        border-inline-end: 0;
        --mn-toolbar-group-width: 100%;
        --mn-toolbar-group-wrap: wrap;
        --mn-toolbar-group-label-width: 6.25rem;
        --mn-toolbar-group-rule: none;
      }

      .toolbar-disclosure[data-compact-open='true'] .toolbar-spacer {
        display: none;
      }

      .find-bar {
        position: fixed;
        inset: auto max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
        width: auto;
        min-width: 0;
      }

      .find-row,
      .replace-row {
        min-height: var(--mn-touch-target-size, 48px);
        flex-wrap: wrap;
      }

      input {
        min-height: var(--mn-touch-target-size, 48px);
      }
    }
  `

  @property({ attribute: false }) formatState: MnEditorToolbarFormatState = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    highlight: false,
  }

  @property({ attribute: false }) fontFamilies: readonly MnEditorFontFamily[] = DEFAULT_FONT_FAMILIES
  @property({ attribute: false }) fontSizes: readonly MnEditorFontSize[] = DEFAULT_FONT_SIZES
  @property({ type: String }) fontFamily = ''
  @property({ type: String }) fontSize = ''
  @property({ type: String }) blockType: MnEditorBlockType = 'paragraph'
  @property({ type: String }) textAlign: MnEditorTextAlign = 'left'
  @property({ type: Boolean }) inTable = false
  @property({ type: Boolean }) searchOpen = false
  @property({ type: String }) searchQuery = ''
  @property({ type: String }) replaceQuery = ''
  @property({ type: Number }) searchResultCount = 0
  @property({ type: Number }) searchCurrentIndex = 0
  @property({ type: String }) ttsStatus: MnEditorTtsStatus = 'idle'
  @property({ type: Boolean }) ttsAvailable = false
  @property({ type: Boolean }) originalViewAvailable = false
  @property({ type: Boolean }) originalViewActive = false
  @property({ type: Boolean }) readOnly = false
  /** Read-only because a trustworthy cached copy is still joining its live room. */
  @property({ type: Boolean }) activationPending = false
  @property({ type: String })
  activationState: 'loading' | 'offline-clean' | 'offline-dirty' | 'live' | 'conflict' = 'live'
  @property({ type: String }) activationDurability: 'none' | 'pending' | 'durable' | 'failed' = 'durable'
  @property({ type: String }) activationConflict: 'deleted' | 'replaced' | 'unfenced' | '' = ''
  @property({ type: String }) makeEditableStatus: 'idle' | 'saving' | 'error' = 'idle'
  @property({ type: String }) makeEditableError = ''

  @state() private toolbarOverflows = false
  @state() private toolbarAtStart = true
  @state() private toolbarAtEnd = true
  @state() private compactToolsOpen = false

  private toolbarResizeObserver?: ResizeObserver
  private observedToolbar?: HTMLElement
  private toolbarMeasureFrame = 0
  private compactMedia?: MediaQueryList
  private readonly compactOverlayId = `editor-formatting-${++editorToolbarInstance}`

  private readonly onCompactMediaChange = (event: MediaQueryListEvent): void => {
    if (!event.matches) this.closeCompactTools(false)
  }

  protected override firstUpdated(changed: PropertyValues<this>): void {
    super.firstUpdated(changed)
    this.compactMedia = this.ownerDocument.defaultView?.matchMedia?.('(max-width: 719px)')
    this.compactMedia?.addEventListener('change', this.onCompactMediaChange)
    if (typeof ResizeObserver !== 'undefined') {
      this.toolbarResizeObserver = new ResizeObserver(() => this.scheduleToolbarMeasure())
      this.toolbarResizeObserver.observe(this)
      this.observeCurrentToolbar()
    }
    this.scheduleToolbarMeasure()
    void this.ownerDocument.fonts?.ready.then(() => this.scheduleToolbarMeasure())
  }

  override disconnectedCallback(): void {
    if (this.compactToolsOpen) this.announceModalState(false)
    this.compactMedia?.removeEventListener('change', this.onCompactMediaChange)
    this.compactMedia = undefined
    this.toolbarResizeObserver?.disconnect()
    this.toolbarResizeObserver = undefined
    this.observedToolbar = undefined
    if (this.toolbarMeasureFrame) cancelAnimationFrame(this.toolbarMeasureFrame)
    this.toolbarMeasureFrame = 0
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    const reactiveChanges = changed as Map<PropertyKey, unknown>
    if (reactiveChanges.has('compactToolsOpen') && this.compactToolsOpen) {
      queueMicrotask(() => this.focusCompactToolsDialog())
    }
    if (
      this.compactToolsOpen
      && ((changed.has('originalViewActive') && this.originalViewActive)
        || (changed.has('readOnly') && this.readOnly))
    ) {
      this.closeCompactTools(false)
    }
    if (changed.has('searchOpen') && this.searchOpen) {
      queueMicrotask(() => this.focusSearchInput())
    }
    this.observeCurrentToolbar()
    this.scheduleToolbarMeasure()
  }

  private scrollableToolbar(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
  }

  private observeCurrentToolbar(): void {
    const toolbar = this.scrollableToolbar() ?? undefined
    if (toolbar === this.observedToolbar) return
    if (this.observedToolbar) this.toolbarResizeObserver?.unobserve(this.observedToolbar)
    this.observedToolbar = toolbar
    if (toolbar) this.toolbarResizeObserver?.observe(toolbar)
  }

  private scheduleToolbarMeasure(): void {
    if (this.toolbarMeasureFrame) cancelAnimationFrame(this.toolbarMeasureFrame)
    this.toolbarMeasureFrame = requestAnimationFrame(() => {
      this.toolbarMeasureFrame = 0
      this.syncToolbarOverflow()
    })
  }

  private syncToolbarOverflow(): void {
    const toolbar = this.scrollableToolbar()
    if (!toolbar) {
      this.toolbarOverflows = false
      this.toolbarAtStart = true
      this.toolbarAtEnd = true
      return
    }
    const maxScroll = Math.max(0, toolbar.scrollWidth - toolbar.clientWidth)
    const overflows = maxScroll > 1
    const atStart = !overflows || toolbar.scrollLeft <= 1
    const atEnd = !overflows || toolbar.scrollLeft >= maxScroll - 1
    if (this.toolbarOverflows !== overflows) this.toolbarOverflows = overflows
    if (this.toolbarAtStart !== atStart) this.toolbarAtStart = atStart
    if (this.toolbarAtEnd !== atEnd) this.toolbarAtEnd = atEnd
  }

  private onToolbarScroll(): void {
    this.syncToolbarOverflow()
  }

  private onToolbarWheel(event: WheelEvent): void {
    if (!this.toolbarOverflows) return
    // Only take over a vertical-dominant wheel gesture (mouse wheel); let
    // native horizontal trackpad scrolling (deltaX-dominant) pass through.
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    const toolbar = this.scrollableToolbar()
    if (!toolbar) return
    const maxScroll = Math.max(0, toolbar.scrollWidth - toolbar.clientWidth)
    // Only claim the gesture when it can actually move the toolbar —
    // otherwise, at the start/end of the scroll range, preventDefault would
    // trap ordinary vertical page scrolling the moment the pointer rests
    // over the toolbar instead of just letting it bubble.
    if (event.deltaY > 0 && toolbar.scrollLeft >= maxScroll - 1) return
    if (event.deltaY < 0 && toolbar.scrollLeft <= 1) return
    event.preventDefault()
    toolbar.scrollLeft = Math.max(0, Math.min(maxScroll, toolbar.scrollLeft + event.deltaY))
  }

  private scrollToolbar(direction: -1 | 1): void {
    const toolbar = this.scrollableToolbar()
    if (!toolbar) return
    const distance = Math.max(240, Math.round(toolbar.clientWidth * 0.62)) * direction
    const reducedMotion = this.ownerDocument.documentElement.hasAttribute('data-reduced-motion')
      || this.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    toolbar.scrollBy({ left: distance, behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  focusSearchInput(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('[data-search-input]')
    input?.focus()
    input?.select()
  }

  private fontFamilyEntries(): MenuEntry[] {
    const entries: MenuEntry[] = [{ id: '', label: 'Default', checked: this.fontFamily === '' }]
    for (const category of ['sans', 'serif', 'mono'] as const) {
      const families = this.fontFamilies.filter((family) => family.category === category)
      if (families.length === 0) continue
      entries.push({ type: 'header', content: category === 'sans' ? 'Sans' : category === 'serif' ? 'Serif' : 'Mono' })
      for (const family of families) {
        entries.push({ id: family.value, label: family.label, checked: this.fontFamily === family.value })
      }
    }
    return entries
  }

  private fontFamilyLabel(): string {
    if (!this.fontFamily) return 'Font'
    return this.fontFamilies.find((family) => family.value === this.fontFamily)?.label ?? 'Font'
  }

  private fontSizeEntries(): MenuEntry[] {
    return [
      { id: '', label: 'Default', checked: this.fontSize === '' },
      ...this.fontSizes.map((size) => ({ id: size.value, label: size.label, checked: this.fontSize === size.value })),
    ]
  }

  private fontSizeLabel(): string {
    if (!this.fontSize) return 'Size'
    return this.fontSizes.find((size) => size.value === this.fontSize)?.label ?? 'Size'
  }

  private blockTypeEntries(): MenuEntry[] {
    return BLOCK_TYPE_OPTIONS.map(([id, label]) => ({ id, label, checked: this.blockType === id }))
  }

  private blockTypeLabel(): string {
    return BLOCK_TYPE_OPTIONS.find(([id]) => id === this.blockType)?.[1] ?? 'Paragraph'
  }

  private emitDetail<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { bubbles: true, composed: true, detail }))
  }

  private emitEmpty(type: string): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }))
  }

  private focusCompactToolsTrigger(): void {
    const control = this.renderRoot.querySelector<HTMLElement>('[data-compact-tools-toggle]')
    const button = control?.shadowRoot?.querySelector<HTMLButtonElement>('button')
    ;(button ?? control)?.focus()
  }

  private announceModalState(open: boolean): void {
    const event = new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: this.compactOverlayId, open, modality: 'modal' },
    })
    if (this.isConnected) this.dispatchEvent(event)
    else this.ownerDocument.dispatchEvent(event)
  }

  private focusCompactToolsDialog(): void {
    this.renderRoot.querySelector<HTMLButtonElement>('.compact-sheet-done')?.focus()
  }

  private compactToolsFocusTargets(): HTMLElement[] {
    const dialog = this.renderRoot.querySelector<HTMLElement>('#mn-editor-more-tools')
    if (!dialog) return []
    const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], mn-button, mn-icon-button',
    ))
    return elements.flatMap((element) => {
      if (element.classList.contains('toolbar-scroll-control')) return []
      if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return []
      if ('disabled' in element && (element as HTMLButtonElement).disabled) return []
      if (element.localName === 'mn-button' || element.localName === 'mn-icon-button') {
        const button = element.shadowRoot?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        return button ? [button] : []
      }
      return [element]
    })
  }

  private openCompactTools(): void {
    if (this.compactToolsOpen) return
    this.compactToolsOpen = true
    this.announceModalState(true)
  }

  private closeCompactTools(restoreFocus = true): void {
    if (!this.compactToolsOpen) return
    this.compactToolsOpen = false
    this.announceModalState(false)
    if (restoreFocus) queueMicrotask(() => this.focusCompactToolsTrigger())
  }

  private onCompactToolsKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeCompactTools()
      return
    }
    if (event.key !== 'Tab') return

    const targets = this.compactToolsFocusTargets()
    if (targets.length === 0) {
      event.preventDefault()
      return
    }
    const path = event.composedPath()
    const activeIndex = targets.findIndex(target => path.includes(target))
    const nextIndex = event.shiftKey ? activeIndex - 1 : activeIndex + 1
    if (activeIndex >= 0 && nextIndex >= 0 && nextIndex < targets.length) return

    event.preventDefault()
    const target = event.shiftKey ? targets.at(-1) : targets[0]
    target?.focus()
  }

  private onToolbarMouseDown(event: MouseEvent): void {
    if (event.composedPath().some((node) => node instanceof HTMLButtonElement)) {
      event.preventDefault()
    }
  }

  private onBlockTypeSelect(event: CustomEvent<MnDropdownSelectDetail>): void {
    this.emitDetail<MnEditorBlockTypeDetail>('mn-editor-block-type', { blockType: event.detail.id as MnEditorBlockType })
  }

  private onFontFamilySelect(event: CustomEvent<MnDropdownSelectDetail>): void {
    this.emitDetail<MnEditorTextStyleDetail>('mn-editor-font-family', { value: event.detail.id })
  }

  private onFontSizeSelect(event: CustomEvent<MnDropdownSelectDetail>): void {
    this.emitDetail<MnEditorTextStyleDetail>('mn-editor-font-size', { value: event.detail.id })
  }

  private onSearchInput(event: Event): void {
    this.emitDetail<MnEditorTextChangeDetail>('mn-editor-search-input', {
      value: (event.target as HTMLInputElement).value,
    })
  }

  private onReplaceInput(event: Event): void {
    this.emitDetail<MnEditorTextChangeDetail>('mn-editor-replace-input', {
      value: (event.target as HTMLInputElement).value,
    })
  }

  private onSearchKeyDown(event: KeyboardEvent): void {
    this.emitDetail<MnEditorKeyboardDetail>('mn-editor-search-keydown', { keyboardEvent: event })
  }

  private onReplaceKeyDown(event: KeyboardEvent): void {
    this.emitDetail<MnEditorKeyboardDetail>('mn-editor-replace-keydown', { keyboardEvent: event })
  }

  private emitModifierIntent(type: string, event: MouseEvent): void {
    this.emitDetail<MnEditorModifierDetail>(type, {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    })
  }

  private resultLabel(): string {
    if (!this.searchOpen) return ''
    const current = this.searchResultCount > 0 ? this.searchCurrentIndex + 1 : 0
    return `${current} / ${this.searchResultCount}`
  }

  private renderCompactPrimaryToolbar() {
    const fs = this.formatState
    return html`
      <div class="compact-primary-toolbar" role="toolbar" aria-label="Common editor actions">
        <mn-icon-button
          data-compact-history-command="undo"
          .icon=${'undo-2'}
          .label=${'Undo'}
          .size=${'lg'}
          .keepFocus=${true}
          @click=${() => this.emitDetail<MnEditorHistoryDetail>('mn-editor-history', { command: 'undo' })}
        ></mn-icon-button>
        <mn-icon-button
          data-compact-history-command="redo"
          .icon=${'redo-2'}
          .label=${'Redo'}
          .size=${'lg'}
          .keepFocus=${true}
          @click=${() => this.emitDetail<MnEditorHistoryDetail>('mn-editor-history', { command: 'redo' })}
        ></mn-icon-button>
        <mn-icon-button
          data-compact-format-command="bold"
          .icon=${'bold'}
          .label=${'Bold'}
          .size=${'lg'}
          .pressed=${fs.bold}
          .keepFocus=${true}
          @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'bold' })}
        ></mn-icon-button>
        <mn-icon-button
          data-compact-format-command="italic"
          .icon=${'italic'}
          .label=${'Italic'}
          .size=${'lg'}
          .pressed=${fs.italic}
          .keepFocus=${true}
          @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'italic' })}
        ></mn-icon-button>
        <mn-icon-button
          data-compact-tools-toggle
          .icon=${'sliders-horizontal'}
          .label=${'More formatting tools'}
          .size=${'lg'}
          .expanded=${this.compactToolsOpen}
          .controls=${'mn-editor-more-tools'}
          .keepFocus=${true}
          @click=${this.openCompactTools}
        ></mn-icon-button>
      </div>
    `
  }

  private renderScrollableToolbar(compactCapable: boolean, toolbar: unknown) {
    return html`
      <div class="toolbar-adaptive-root" data-compact-capable=${String(compactCapable)}>
        <div data-compact-capable=${String(compactCapable)}>${this.renderCompactPrimaryToolbar()}</div>
        <div
          class="compact-sheet-backdrop"
          data-open=${String(compactCapable && this.compactToolsOpen)}
          aria-hidden="true"
          @click=${this.closeCompactTools}
        ></div>
        <section
          id="mn-editor-more-tools"
          class="toolbar-disclosure"
          data-compact-capable=${String(compactCapable)}
          data-compact-open=${String(compactCapable && this.compactToolsOpen)}
          role=${compactCapable && this.compactToolsOpen ? 'dialog' : nothing}
          aria-modal=${compactCapable && this.compactToolsOpen ? 'true' : nothing}
          aria-label=${compactCapable && this.compactToolsOpen ? 'Formatting tools' : nothing}
          @keydown=${this.onCompactToolsKeyDown}
        >
          <div class="compact-sheet-header">
            <span class="compact-sheet-title">Formatting tools</span>
            <button class="compact-sheet-done" type="button" @click=${this.closeCompactTools}>Done</button>
          </div>
          <div
            class="toolbar-scroll-shell"
            data-overflow=${String(this.toolbarOverflows)}
            data-at-start=${String(this.toolbarAtStart)}
            data-at-end=${String(this.toolbarAtEnd)}
            @wheel=${this.onToolbarWheel}
          >
            <mn-icon-button
              class="toolbar-scroll-control start"
              data-toolbar-scroll="start"
              .icon=${'chevron-left'}
              .label=${'Scroll toolbar left'}
              .size=${'sm'}
              .disabled=${this.toolbarAtStart}
              .keepFocus=${true}
              @click=${() => this.scrollToolbar(-1)}
            ></mn-icon-button>
            ${toolbar}
            <mn-icon-button
              class="toolbar-scroll-control end"
              data-toolbar-scroll="end"
              .icon=${'chevron-right'}
              .label=${'Scroll toolbar right'}
              .size=${'sm'}
              .disabled=${this.toolbarAtEnd}
              .keepFocus=${true}
              @click=${() => this.scrollToolbar(1)}
            ></mn-icon-button>
          </div>
        </section>
      </div>
    `
  }

  private renderOriginalViewToolbar() {
    return this.renderScrollableToolbar(false, html`
      <mn-toolbar
        class="toolbar"
        label="Original file tools"
        variant="compact"
        @mousedown=${this.onToolbarMouseDown}
        @scroll=${this.onToolbarScroll}
      >
        <mn-toolbar-group label="Reader">
          <mn-button
            data-original-view-toggle
            variant="secondary"
            size="sm"
            .icon=${'file-text'}
            .label=${'Document View'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-original-view-toggle')}
          ></mn-button>
        </mn-toolbar-group>
        <span
          class="original-view-note"
          data-original-annotation-unavailable
          role="status"
        >Original-file highlights and comments are unavailable; return to Document View to annotate.</span>
        <span class="toolbar-spacer" aria-hidden="true"></span>
        <mn-toolbar-group label="Annotations">
          <mn-icon-button
            data-original-highlight-unavailable
            .icon=${'highlighter'}
            .label=${'Highlight unavailable in original-file view'}
            .size=${'sm'}
            .disabled=${true}
          ></mn-icon-button>
          <mn-icon-button
            data-original-comment-unavailable
            .icon=${'message-square'}
            .label=${'Comment unavailable in original-file view'}
            .size=${'sm'}
            .disabled=${true}
          ></mn-icon-button>
        </mn-toolbar-group>
      </mn-toolbar>
    `)
  }

  private renderReadOnlyToolbar() {
    const saving = this.makeEditableStatus === 'saving'
    const activationConflict = this.activationState === 'conflict'
    const activationLabel = this.activationDurability === 'failed'
      ? 'Local save failed · Reconnect before closing'
      : activationConflict
      ? this.activationConflict === 'deleted'
        ? 'Deleted remotely · Local recovery saved'
        : this.activationConflict === 'replaced'
          ? 'Document replaced · Local recovery saved'
          : 'Offline cache cannot be safely fenced'
      : this.activationPending
        ? 'Waiting for document authority…'
        : 'View Only'
    return html`
      <div
        class="toolbar-scroll-shell"
        data-overflow=${String(this.toolbarOverflows)}
        data-at-start=${String(this.toolbarAtStart)}
        data-at-end=${String(this.toolbarAtEnd)}
        @wheel=${this.onToolbarWheel}
      >
        <mn-icon-button
          class="toolbar-scroll-control start"
          data-toolbar-scroll="start"
          .icon=${'chevron-left'}
          .label=${'Scroll toolbar left'}
          .size=${'sm'}
          .disabled=${this.toolbarAtStart}
          .keepFocus=${true}
          @click=${() => this.scrollToolbar(-1)}
        ></mn-icon-button>
        <mn-toolbar
          class="toolbar"
          label="Read-only document tools"
          variant="compact"
          data-make-editable-status=${this.makeEditableStatus}
          data-make-editable-error=${this.makeEditableError || nothing}
          @mousedown=${this.onToolbarMouseDown}
          @scroll=${this.onToolbarScroll}
        >
          <mn-toolbar-group label=${activationConflict || this.activationPending ? 'Document synchronization' : 'Imported document'}>
            <span
              data-read-only-badge
              data-activation-pending=${String(this.activationPending)}
              role="status"
            >${activationLabel}</span>
            ${this.activationPending || activationConflict
              ? nothing
              : html`<mn-button
                  data-make-editable
                  variant="secondary"
                  size="sm"
                  .icon=${'unlock'}
                  .label=${saving ? 'Making editable…' : 'Make Editable'}
                  .disabled=${saving}
                  .keepFocus=${true}
                  @click=${() => this.emitEmpty('mn-editor-make-editable')}
                ></mn-button>`}
            ${!this.activationPending && this.originalViewAvailable
              ? html`<mn-button
                  data-original-view-toggle
                  variant="secondary"
                  size="sm"
                  .icon=${'eye'}
                  .label=${'View Original'}
                  .keepFocus=${true}
                  @click=${() => this.emitEmpty('mn-editor-original-view-toggle')}
                ></mn-button>`
              : nothing}
          </mn-toolbar-group>
          <span class="toolbar-spacer" aria-hidden="true"></span>
          <mn-toolbar-group label="Playback">
            <mn-icon-button
              data-tts-command
              .icon=${this.ttsStatus === 'idle' ? 'volume-2' : 'stop'}
              .label=${!this.ttsAvailable
                ? 'Read aloud unavailable in this browser'
                : this.ttsStatus === 'idle'
                  ? 'Read aloud from cursor · Shift+click for beginning'
                  : 'Stop reading'}
              .size=${'sm'}
              .pressed=${this.ttsStatus !== 'idle'}
              .disabled=${!this.ttsAvailable}
              .keepFocus=${true}
              @click=${(event: MouseEvent) => this.emitModifierIntent('mn-editor-tts-toggle', event)}
            ></mn-icon-button>
          </mn-toolbar-group>
        </mn-toolbar>
        <mn-icon-button
          class="toolbar-scroll-control end"
          data-toolbar-scroll="end"
          .icon=${'chevron-right'}
          .label=${'Scroll toolbar right'}
          .size=${'sm'}
          .disabled=${this.toolbarAtEnd}
          .keepFocus=${true}
          @click=${() => this.scrollToolbar(1)}
        ></mn-icon-button>
      </div>
      <p
        data-make-editable-error
        role="alert"
        ?hidden=${this.makeEditableStatus !== 'error' || !this.makeEditableError}
      >${this.makeEditableError}</p>
    `
  }

  override render() {
    if (this.originalViewActive) return this.renderOriginalViewToolbar()
    if (this.readOnly) return this.renderReadOnlyToolbar()
    const fs = this.formatState
    const hasResults = this.searchResultCount > 0

    return this.renderScrollableToolbar(true, html`
      <mn-toolbar
        class="toolbar"
        label="Editor formatting"
        variant="compact"
        @mousedown=${this.onToolbarMouseDown}
        @scroll=${this.onToolbarScroll}
        >
        <mn-toolbar-group label="Type" divider>
          <mn-dropdown-button
            data-font-family-select
            .label=${this.fontFamilyLabel()}
            .entries=${this.fontFamilyEntries()}
            .selectedId=${this.fontFamily}
            size="sm"
            variant="toolbar"
            @mn-select=${(event: CustomEvent<MnDropdownSelectDetail>) => this.onFontFamilySelect(event)}
          ></mn-dropdown-button>
          <mn-dropdown-button
            data-font-size-select
            .label=${this.fontSizeLabel()}
            .entries=${this.fontSizeEntries()}
            .selectedId=${this.fontSize}
            size="sm"
            variant="toolbar"
            @mn-select=${(event: CustomEvent<MnDropdownSelectDetail>) => this.onFontSizeSelect(event)}
          ></mn-dropdown-button>
        </mn-toolbar-group>

        <mn-toolbar-group label="Inline formatting" divider>
          <mn-icon-button
            data-format-command="bold"
            .icon=${'bold'}
            .label=${'Bold'}
            .size=${'sm'}
            .pressed=${fs.bold}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'bold' })}
          ></mn-icon-button>
          <mn-icon-button
            data-format-command="italic"
            .icon=${'italic'}
            .label=${'Italic'}
            .size=${'sm'}
            .pressed=${fs.italic}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'italic' })}
          ></mn-icon-button>
          <mn-icon-button
            data-format-command="strike"
            .icon=${'strikethrough'}
            .label=${'Strikethrough'}
            .size=${'sm'}
            .pressed=${fs.strike}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'strike' })}
          ></mn-icon-button>
          <mn-icon-button
            data-format-command="code"
            .icon=${'code'}
            .label=${'Inline code'}
            .size=${'sm'}
            .pressed=${fs.code}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'code' })}
          ></mn-icon-button>
          <mn-icon-button
            data-format-command="highlight"
            .icon=${'highlight'}
            .label=${'Highlight'}
            .size=${'sm'}
            .pressed=${fs.highlight}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorFormatDetail>('mn-editor-format', { command: 'highlight' })}
          ></mn-icon-button>
          <mn-icon-button
            data-footnote-command
            .icon=${'footnote'}
            .label=${'Footnote'}
            .size=${'sm'}
            .shortcut=${'Mod+Shift+F'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-footnote-insert')}
          ></mn-icon-button>
          <mn-icon-button
            data-citation-command
            .icon=${'quote'}
            .label=${'Citation'}
            .size=${'sm'}
            .shortcut=${'Mod+Shift+C'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-citation-open')}
          ></mn-icon-button>
          <mn-icon-button
            data-comment-command
            .icon=${'message-square'}
            .label=${'Add comment'}
            .size=${'sm'}
            .shortcut=${'Mod+Shift+.'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-comment-insert')}
          ></mn-icon-button>
          <mn-icon-button
            data-wikilink-command
            .icon=${'link'}
            .label=${'Wiki link'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-wikilink-open')}
          ></mn-icon-button>
          <mn-icon-button
            data-document-wire-command
            .icon=${'git-merge'}
            .label=${'Wire document'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${(event: MouseEvent) => this.emitModifierIntent('mn-editor-document-wire-request', event)}
          ></mn-icon-button>
        </mn-toolbar-group>

        <mn-toolbar-group label="Block formatting" divider>
          <mn-icon-button
            data-clear-formatting-command
            .icon=${'plain-text'}
            .label=${'Clear formatting'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-clear-formatting')}
          ></mn-icon-button>
          <mn-dropdown-button
            data-block-select
            title="Block type"
            .label=${this.blockTypeLabel()}
            .entries=${this.blockTypeEntries()}
            .selectedId=${this.blockType}
            size="sm"
            variant="toolbar"
            @mn-select=${(event: CustomEvent<MnDropdownSelectDetail>) => this.onBlockTypeSelect(event)}
          ></mn-dropdown-button>
          <mn-button
            data-table-command
            aria-label="Insert or remove table"
            variant="toolbar"
            size="xs"
            .icon=${'table'}
            .label=${'Table'}
            .pressed=${this.inTable}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-table-toggle')}
          ></mn-button>
          <mn-icon-button
            data-image-command
            .icon=${'image-plus'}
            .label=${'Insert image'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-image-insert')}
          ></mn-icon-button>
        </mn-toolbar-group>

        <mn-toolbar-group label="Text alignment" divider>
          <mn-icon-button
            data-align-command="left"
            .icon=${'align-left'}
            .label=${'Align left'}
            .size=${'sm'}
            .pressed=${this.textAlign === 'left'}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorAlignDetail>('mn-editor-align', { alignment: 'left' })}
          ></mn-icon-button>
          <mn-icon-button
            data-align-command="center"
            .icon=${'align-center'}
            .label=${'Align center'}
            .size=${'sm'}
            .pressed=${this.textAlign === 'center'}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorAlignDetail>('mn-editor-align', { alignment: 'center' })}
          ></mn-icon-button>
          <mn-icon-button
            data-align-command="right"
            .icon=${'align-right'}
            .label=${'Align right'}
            .size=${'sm'}
            .pressed=${this.textAlign === 'right'}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorAlignDetail>('mn-editor-align', { alignment: 'right' })}
          ></mn-icon-button>
        </mn-toolbar-group>

        <mn-toolbar-group label="Edit history" divider>
          <mn-icon-button
            data-version-history-open
            .icon=${'clock'}
            .label=${'Version history'}
            .shortcut=${'Mod+Shift+H'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-history-open')}
          ></mn-icon-button>
          <mn-icon-button
            data-history-command="undo"
            .icon=${'undo-2'}
            .label=${'Undo'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorHistoryDetail>('mn-editor-history', { command: 'undo' })}
          ></mn-icon-button>
          <mn-icon-button
            data-history-command="redo"
            .icon=${'redo-2'}
            .label=${'Redo'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitDetail<MnEditorHistoryDetail>('mn-editor-history', { command: 'redo' })}
          ></mn-icon-button>
        </mn-toolbar-group>

        <span class="toolbar-spacer" aria-hidden="true"></span>

        ${this.activationState === 'offline-clean' || this.activationState === 'offline-dirty'
          ? html`<span
              data-document-sync-badge
              data-activation-state=${this.activationState}
              data-activation-durability=${this.activationDurability}
              role="status"
            >${this.activationDurability === 'failed'
              ? 'Offline · Local save failed'
              : this.activationDurability === 'pending'
              ? 'Saving locally…'
              : this.activationState === 'offline-dirty'
                ? 'Offline · Saved locally'
                : 'Offline · Ready'}</span>`
          : nothing}

        <div class="search-anchor">
          ${this.originalViewAvailable
            ? html`<mn-icon-button
                data-original-view-toggle
                .icon=${'eye'}
                .label=${'View Original'}
                .size=${'sm'}
                .keepFocus=${true}
                @click=${() => this.emitEmpty('mn-editor-original-view-toggle')}
              ></mn-icon-button>`
            : nothing}
          <mn-icon-button
            data-tts-command
            .icon=${this.ttsStatus === 'idle' ? 'volume-2' : 'stop'}
            .label=${!this.ttsAvailable
              ? 'Read aloud unavailable in this browser'
              : this.ttsStatus === 'idle'
                ? 'Read aloud from cursor · Shift+click for beginning'
                : 'Stop reading'}
            .shortcut=${this.ttsStatus === 'idle' ? 'Mod+L' : 'Mod+Alt+L'}
            .size=${'sm'}
            .pressed=${this.ttsStatus !== 'idle'}
            .disabled=${!this.ttsAvailable}
            .keepFocus=${true}
            @click=${(event: MouseEvent) => this.emitModifierIntent('mn-editor-tts-toggle', event)}
          ></mn-icon-button>
          <mn-icon-button
            data-shortcuts-open
            .icon=${'help-circle'}
            .label=${'Keyboard shortcuts'}
            .shortcut=${'Mod+/'}
            .size=${'sm'}
            .keepFocus=${true}
            @click=${() => this.emitEmpty('mn-editor-shortcuts-open')}
          ></mn-icon-button>
          <mn-icon-button
            data-search-open
            .icon=${'search'}
            .label=${this.searchOpen ? 'Close find' : 'Find in document'}
            .size=${'sm'}
            .pressed=${this.searchOpen}
            .keepFocus=${true}
            @click=${() => this.emitEmpty(this.searchOpen ? 'mn-editor-search-close' : 'mn-editor-search-open')}
          ></mn-icon-button>
          ${this.searchOpen
            ? html`
                <div class="find-bar" data-open="true">
                  <div class="find-row">
                    <input
                      data-search-input
                      type="search"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder="Find"
                      .value=${this.searchQuery}
                      @input=${this.onSearchInput}
                      @keydown=${this.onSearchKeyDown}
                    />
                    <span class="find-count" data-search-count>${this.resultLabel()}</span>
                    <span class="find-nav">
                      <mn-icon-button
                        data-search-prev
                        .icon=${'chevron-left'}
                        .label=${'Previous match'}
                        .size=${'sm'}
                        .disabled=${!hasResults}
                        @click=${() => this.emitEmpty('mn-editor-search-prev')}
                      ></mn-icon-button>
                      <mn-icon-button
                        data-search-next
                        .icon=${'chevron-right'}
                        .label=${'Next match'}
                        .size=${'sm'}
                        .disabled=${!hasResults}
                        @click=${() => this.emitEmpty('mn-editor-search-next')}
                      ></mn-icon-button>
                      <mn-icon-button
                        data-search-close
                        .icon=${'close'}
                        .label=${'Close find'}
                        .size=${'sm'}
                        @click=${() => this.emitEmpty('mn-editor-search-close')}
                      ></mn-icon-button>
                    </span>
                  </div>
                  <div class="replace-row">
                    <input
                      data-replace-input
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder="Replace"
                      .value=${this.replaceQuery}
                      @input=${this.onReplaceInput}
                      @keydown=${this.onReplaceKeyDown}
                    />
                    <span class="replace-actions">
                      <mn-button
                        data-replace-current
                        variant="secondary"
                        size="xs"
                        .label=${'Replace'}
                        .disabled=${!hasResults}
                        @click=${() => this.emitEmpty('mn-editor-replace-current')}
                      ></mn-button>
                      <mn-button
                        data-replace-all
                        variant="secondary"
                        size="xs"
                        .label=${'All'}
                        .disabled=${!hasResults}
                        @click=${() => this.emitEmpty('mn-editor-replace-all')}
                      ></mn-button>
                    </span>
                  </div>
                </div>
              `
            : nothing}
        </div>
        </mn-toolbar>
    `)
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-editor-toolbar': MnEditorToolbar
  }
}
