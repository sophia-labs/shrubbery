import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import type { ViewportAllocation } from '@shrubbery/nucleus/layout'
import { solveCenterPaneSplit, type CenterPaneSplitResult } from './layout/split-tree-renderer.js'
import {
  CENTER_PANE_CLOSE_EVENT,
  CENTER_PANE_FOCUS_EVENT,
  CENTER_PANE_NAVIGATE_EVENT,
  CENTER_PANE_OPEN_EVENT,
  CENTER_PANE_RESIZE_EVENT,
  type CenterPaneCloseIntentDetail,
  type CenterPaneFocusIntentDetail,
  type CenterPaneId,
  type CenterPaneLocation,
  type CenterPaneNavigateIntentDetail,
  type CenterPaneOpenIntentDetail,
  type CenterPaneProjection,
  type CenterPaneResizeIntentDetail,
  type CenterPanesProjection,
} from './center-panes-contract.js'
import { createCenterPanesState, homeLocation, projectCenterPanes } from './center-panes-model.js'
import type { EditorHostBinding } from './editor-host-binding.js'
import {
  EDITOR_STRUCTURE_CHANGE_EVENT,
  type EditorBlockFocusRequest,
  type EditorCommentInserter,
  type EditorDocumentAccess,
  type EditorFootnoteInserter,
  type EditorImageInserter,
  type EditorOriginalFileView,
  type ShEditorHost,
  type WireRadialContextMap,
} from './editor-host.js'
import type { EditorKernelOptions } from './collab/live-editor.js'
import type { WireBundle } from './editor-services/wire-bundle-service.js'
import type { SalienceBundle } from './editor-services/salience-bundle-service.js'
import './editor-host.js'

export interface CenterPaneEditorHostOptions {
  readonly binding: EditorHostBinding
  readonly kernelOptions?: EditorKernelOptions | null
  readonly initialZoomBlockId?: string | null
  readonly focusRequest?: EditorBlockFocusRequest | null
  readonly wireBundle?: WireBundle | null
  readonly wireRadialContexts?: WireRadialContextMap | null
  readonly salienceBundle?: SalienceBundle | null
  readonly imageInserter?: EditorImageInserter | null
  readonly footnoteInserter?: EditorFootnoteInserter | null
  readonly commentInserter?: EditorCommentInserter | null
  readonly originalFileView?: EditorOriginalFileView | null
  readonly documentAccess?: EditorDocumentAccess | null
  readonly ttsStatus?: 'idle' | 'loading' | 'playing' | 'paused'
  readonly ttsAvailable?: boolean
}

const EMPTY_PROJECTION = projectCenterPanes(createCenterPanesState())

function eventTitle(disabledReason: string | undefined, fallback: string): string {
  return disabledReason ? `${fallback} — ${disabledReason}` : fallback
}

/** Lucide's "list" glyph — the same icon the OG frontend's mini-TOC button used. */
function tocIcon(): TemplateResult {
  return html`<svg
    class="toc-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  ><path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" /></svg>`
}

function domToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

/**
 * Backend-free dual-document center. Canonical state and effects live outside;
 * this element owns only pointer-drag bookkeeping and focus presentation.
 */
@customElement('sh-center-panes')
export class ShCenterPanes extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      color: var(--mn-color-text-primary, #28332d);
      background: var(--mn-color-surface-editor, #fffdf8);
    }

    .center-panes {
      /* Recursive-split-tree geometry (the same shape the Phase-1 layout
         solver produces for a two-leaf horizontal split — design plans/
         shrubbery-layout-as-data-design-20260716.md §6.1), expressed here as
         plain absolute positioning + calc() rather than CSS Grid. CSS Grid's
         sparse auto-placement was the root cause of the historical
         half-height regression: the divider (grid-column: 2) rendered AFTER
         the secondary pane (grid-column: 3) in DOM order, so auto-placement
         advanced it into a phantom SECOND row and align-content split the
         surface ~50/50. Absolute positioning has no row/column track system
         at all — there is no auto-placement cursor that could ever invent a
         second row, so that entire bug class is impossible BY CONSTRUCTION,
         not merely patched. Every child (.pane, .divider) is positioned
         directly from --center-divider with NO implicit layout step. */
      position: relative;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #f8f6f0);
    }

    /* PRE-MEASUREMENT FALLBACK ONLY (see the _geometry()/renderPane()
       comments below): once a real ResizeObserver measurement lands, each
       .pane/.divider gets an inline style computed by the REAL Phase-1
       recursive solver (split-tree-renderer.ts's solveCenterPaneSplit),
       which overrides these calc() rules by specificity. This CSS remains
       only so the very first paint (and any environment with no real layout
       engine, e.g. a happy-dom test) still renders a sane split before the
       first measurement arrives — it is not a second authoritative geometry
       formula. */
    .pane {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: 38px minmax(0, 1fr);
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-editor, #fffdf8);
      box-shadow: inset 0 0 0 1px transparent;
      transition: box-shadow 120ms ease, background-color 120ms ease;
    }

    /* Split geometry: primary spans [0, divider-6px], the 12px divider sits
       centered on the divider percentage, secondary spans the remainder —
       the exact track math the old minmax(0,var(--center-divider)) 12px
       minmax(0,1fr) grid-template-columns expressed as three independent
       absolutely-positioned boxes on ONE surface, never a second row. */
    .center-panes[data-split='true'] .pane[data-position='primary'] {
      inset: 0 auto 0 0;
      width: calc(var(--center-divider, 50%) - 6px);
    }
    .center-panes[data-split='true'] .pane[data-position='secondary'] {
      inset: 0 0 0 auto;
      width: calc(100% - var(--center-divider, 50%) - 6px);
    }

    .pane[data-active='true'] {
      box-shadow: inset 0 0 0 1px var(--mn-color-border-focus, #4d8768);
    }

    .pane-header {
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      padding: 0 7px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #ddd8ce);
      background: var(--mn-color-surface-chrome, rgba(248, 246, 240, 0.96));
      font: 500 12px/1 var(--mn-font-ui, system-ui, sans-serif);
    }

    .pane[data-active='true'] .pane-header {
      background: var(--mn-color-surface-raised, #fffdf8);
    }

    .pane-position {
      width: 6px;
      height: 6px;
      margin-inline: 2px 5px;
      border-radius: 999px;
      background: var(--mn-color-border-strong, #a49e92);
      flex: none;
    }

    .pane[data-active='true'] .pane-position {
      background: var(--mn-color-accent, #4d8768);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-accent, #4d8768) 15%, transparent);
    }

    .pane-title {
      min-width: 0;
      margin-inline: 2px auto;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #536159);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pane[data-active='true'] .pane-title {
      color: var(--mn-color-text-primary, #28332d);
    }

    /* Mini table-of-contents — the empty middle gap between the title (whose
       own margin-inline-end:auto already pushes everything after it right)
       and the ⌘O/split/close cluster. Giving .toc-wrap the SAME auto margin
       splits that remaining space evenly on both sides, roughly centering it. */
    .toc-wrap {
      position: relative;
      margin-inline-end: auto;
    }

    .toc-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 5px;
      color: var(--mn-color-text-tertiary, #7a8580);
      cursor: pointer;
      font: inherit;
      max-width: 220px;
      overflow: hidden;
    }

    .toc-btn:hover {
      background: var(--mn-color-surface-hover, rgba(65, 91, 75, 0.08));
      color: var(--mn-color-text-secondary, #536159);
    }

    .toc-btn-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 160px;
    }

    .toc-icon {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }

    .toc-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      min-width: 180px;
      max-width: 300px;
      max-height: 300px;
      overflow-y: auto;
      background: var(--mn-color-surface-base, #fffdf8);
      border: 1px solid var(--mn-color-border-subtle, #ddd8ce);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 20;
      padding: 4px;
    }

    .toc-item {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: left;
      border: 0;
      background: none;
      padding: 5px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      color: var(--mn-color-text-secondary, #536159);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .toc-item:hover {
      background: var(--mn-color-surface-hover, rgba(65, 91, 75, 0.08));
      color: var(--mn-color-text-primary, #28332d);
    }

    button {
      box-sizing: border-box;
      border: 0;
      color: inherit;
      background: transparent;
      font: inherit;
    }

    .pane-command,
    .split-command {
      display: inline-grid;
      place-items: center;
      min-width: 27px;
      height: 27px;
      padding: 0 6px;
      border-radius: 5px;
      color: var(--mn-color-text-secondary, #627068);
      cursor: pointer;
    }

    .pane-command:hover:not(:disabled),
    .split-command:hover:not(:disabled) {
      color: var(--mn-color-text-primary, #28332d);
      background: var(--mn-color-surface-hover, rgba(65, 91, 75, 0.08));
    }

    .pane-command:focus-visible,
    .split-command:focus-visible,
    .divider:focus-visible,
    .empty-open:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, #4d8768);
      outline-offset: -1px;
    }

    .pane-command:disabled,
    .split-command:disabled {
      opacity: 0.34;
      cursor: not-allowed;
    }

    .split-command {
      min-width: auto;
      padding-inline: 8px;
      border: 1px solid var(--mn-color-border-subtle, #d9d4c9);
      font-size: 11px;
      letter-spacing: 0.01em;
    }

    .split-command[aria-pressed='true'] {
      border-color: color-mix(in srgb, var(--mn-color-accent, #4d8768) 45%, transparent);
      color: var(--mn-color-accent-strong, #2f684b);
      background: color-mix(in srgb, var(--mn-color-accent, #4d8768) 9%, transparent);
    }

    .pane-stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .pane-stage sh-editor-host {
      z-index: 1;
    }

    .empty-pane {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 10px;
      padding: 24px;
      color: var(--mn-color-text-secondary, #65716a);
      background:
        radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--mn-color-accent, #4d8768) 8%, transparent), transparent 42%),
        var(--mn-color-surface-editor, #fffdf8);
      font: 13px/1.45 var(--mn-font-ui, system-ui, sans-serif);
      text-align: center;
    }

    .empty-open {
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--mn-color-border-default, #c8c2b7);
      border-radius: 6px;
      color: var(--mn-color-accent-strong, #2f684b);
      background: var(--mn-color-surface-raised, #fff);
      cursor: pointer;
    }

    .divider {
      position: absolute;
      z-index: 5;
      left: calc(var(--center-divider, 50%) - 6px);
      top: 0;
      width: 12px;
      min-width: 12px;
      height: 100%;
      padding: 0;
      cursor: col-resize;
      touch-action: none;
    }

    .divider::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 5px;
      width: 1px;
      background: var(--mn-color-border-default, #cbc5ba);
      transition: width 100ms ease, left 100ms ease, background-color 100ms ease;
    }

    .divider:hover::before,
    .divider[data-dragging='true']::before {
      left: 4px;
      width: 3px;
      background: var(--mn-color-accent, #4d8768);
    }

    :host([data-skin='98']) .pane-header {
      border-bottom-color: #808080;
      background: #c0c0c0;
      font-family: Tahoma, sans-serif;
    }

    :host([data-skin='98']) :is(.pane-command, .split-command, .empty-open) {
      border: 2px outset #dfdfdf;
      border-radius: 0;
      background: #c0c0c0;
    }

    @media (max-width: 760px) {
      .pane {
        grid-template-rows: 42px minmax(0, 1fr);
      }
      .pane-header {
        padding-inline: 5px;
      }
      .split-command {
        max-width: 34px;
        overflow: hidden;
        color: transparent;
      }
      .split-command::before {
        content: 'Ⅱ';
        color: var(--mn-color-text-primary, #28332d);
      }
    }
  `

  @property({ attribute: false })
  projection: CenterPanesProjection = EMPTY_PROJECTION

  @property({ attribute: false })
  editorHosts: ReadonlyMap<CenterPaneId, CenterPaneEditorHostOptions> = new Map()

  @property({ type: Boolean, attribute: 'show-split-command' })
  showSplitCommand = true

  private draggingPointerId: number | null = null

  // ── real recursive-solver geometry (design plans/shrubbery-layout-as-data-
  // design-20260716.md §6.3, §9.2 Phase 3; diff-review r2 WRONG "flat-grid-
  // remains") — `split-tree-renderer.ts`'s `solveCenterPaneSplit` computes
  // ACTUAL pixel boxes through the shared Phase-1 `solveLayout`, applied as
  // inline styles that override the CSS `calc()` rules below. Those CSS rules
  // remain as the PRE-MEASUREMENT fallback only (first paint, or a test/
  // happy-dom environment with no real layout engine — `getBoundingClientRect`
  // reports an empty box there, `solveCenterPaneSplit` returns `null`, and the
  // component falls back to the exact same CSS this class shipped before this
  // primitive existed) — never a second authoritative geometry formula.
  @state() private _measuredWidth = 0
  @state() private _measuredHeight = 0
  private _resizeObserver: ResizeObserver | null = null
  private readonly _scheduleMeasure = (): void => {
    const rect = this.getBoundingClientRect()
    if (rect.width === this._measuredWidth && rect.height === this._measuredHeight) return
    this._measuredWidth = rect.width
    this._measuredHeight = rect.height
  }

  // Mini table-of-contents — per-pane, since split view opens two independent
  // documents. Tracks at most one open popup (paneId), not a per-pane boolean
  // set, matching how _tocOpenPaneId reads as "which pane, if any."
  @state() private _tocOpenPaneId: CenterPaneId | null = null
  private readonly _onDocumentPointerDown = (event: PointerEvent): void => {
    if (this._tocOpenPaneId === null) return
    const insideToc = event.composedPath().some(
      (node) => node instanceof Element && node.hasAttribute('data-toc-wrap'),
    )
    if (insideToc) return
    this._tocOpenPaneId = null
  }
  private readonly _onStructureChange = (): void => {
    // Headings are read fresh from the live editor handle on every render —
    // this just makes Lit re-render on doc changes, since heading-set/text
    // changes don't touch any @state/@property here. Needed both for the
    // trigger button's visibility (appears once a document has headings)
    // and for the open dropdown's list staying live.
    this.requestUpdate()
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._scheduleMeasure)
      this._resizeObserver.observe(this)
    }
    this._scheduleMeasure()
    document.addEventListener('pointerdown', this._onDocumentPointerDown, { capture: true })
    document.addEventListener(EDITOR_STRUCTURE_CHANGE_EVENT, this._onStructureChange)
  }

  disconnectedCallback(): void {
    this._resizeObserver?.disconnect()
    this._resizeObserver = null
    document.removeEventListener('pointerdown', this._onDocumentPointerDown, { capture: true })
    document.removeEventListener(EDITOR_STRUCTURE_CHANGE_EVENT, this._onStructureChange)
    super.disconnectedCallback()
  }

  private _geometry(): CenterPaneSplitResult | null {
    const secondary = this.projection.panes.find((pane) => pane.position === 'secondary')
    return solveCenterPaneSplit({
      primaryId: this.projection.panes.find((pane) => pane.position === 'primary')?.id ?? this.projection.panes[0]?.id ?? 'primary',
      secondaryId: this.projection.split ? secondary?.id ?? null : null,
      dividerPercent: this.projection.dividerPercent,
      containerWidth: this._measuredWidth,
      containerHeight: this._measuredHeight,
    })
  }

  focusPane(paneId: CenterPaneId): boolean {
    const token = domToken(paneId)
    const host = this.renderRoot.querySelector(
      `sh-editor-host[data-center-pane-host='${token}']`,
    ) as ShEditorHost | null
    return host?.focusEditor() ?? false
  }

  private emitIntent<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { bubbles: true, composed: true, detail }))
  }

  private requestFocus(
    paneId: CenterPaneId,
    reason: CenterPaneFocusIntentDetail['reason'],
  ): void {
    if (this.projection.activePaneId === paneId && reason !== 'programmatic') return
    this.emitIntent<CenterPaneFocusIntentDetail>(CENTER_PANE_FOCUS_EVENT, { paneId, reason })
  }

  private requestPaneFocusFromEvent(
    event: Event,
    paneId: CenterPaneId,
    reason: 'pointer' | 'focus',
  ): void {
    // Pane commands emit their own complete intent. Focusing the pane
    // synchronously on pointerdown/focusin can rerender the active-toolbar
    // shape between pointerdown and click, causing the click to disappear.
    const path = event.composedPath()
    const separator = path.some(target =>
      target instanceof Element && target.matches('[role="separator"]'),
    )
    const paneHeaderIndex = path.findIndex(target =>
      target instanceof Element && target.matches('.pane-header'),
    )
    const buttonIndex = path.findIndex(target =>
      target instanceof Element && target.matches('button, [role="button"]'),
    )
    const command = separator || (paneHeaderIndex >= 0 && buttonIndex >= 0 && buttonIndex < paneHeaderIndex)
    if (!command) this.requestFocus(paneId, reason)
  }

  private requestOpen(
    paneId: CenterPaneId,
    placement: CenterPaneOpenIntentDetail['placement'],
    reason: CenterPaneOpenIntentDetail['reason'],
    location?: CenterPaneLocation,
  ): void {
    this.emitIntent<CenterPaneOpenIntentDetail>(CENTER_PANE_OPEN_EVENT, {
      paneId,
      placement,
      reason,
      ...(location ? { location } : {}),
      activate: true,
    })
  }

  private requestNavigate(paneId: CenterPaneId, direction: 'back' | 'forward'): void {
    this.emitIntent<CenterPaneNavigateIntentDetail>(CENTER_PANE_NAVIGATE_EVENT, {
      paneId,
      direction,
    })
  }

  private requestClose(paneId: CenterPaneId, reason: CenterPaneCloseIntentDetail['reason']): void {
    this.emitIntent<CenterPaneCloseIntentDetail>(CENTER_PANE_CLOSE_EVENT, { paneId, reason })
  }

  private requestSplitCommand(): void {
    const command = this.projection.splitCommand
    if (command.disabled) return
    if (command.action === 'close') {
      const secondary = this.projection.panes.find((pane) => pane.position === 'secondary')
      if (secondary) this.requestClose(secondary.id, 'split-command')
      return
    }
    const active = this.projection.panes.find((pane) => pane.id === this.projection.activePaneId)
      ?? this.projection.panes[0]
    if (!active) return
    this.requestOpen(
      active.id,
      'split',
      'split-command',
      homeLocation(active.current.graphId),
    )
  }

  private emitResize(dividerPercent: number, source: CenterPaneResizeIntentDetail['source']): void {
    const clamped = Math.min(
      this.projection.dividerMaxPercent,
      Math.max(this.projection.dividerMinPercent, dividerPercent),
    )
    this.emitIntent<CenterPaneResizeIntentDetail>(CENTER_PANE_RESIZE_EVENT, {
      dividerPercent: Math.round(clamped * 100) / 100,
      source,
    })
  }

  private resizeFromPointer(event: PointerEvent): void {
    const surface = this.renderRoot.querySelector('.center-panes') as HTMLElement | null
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    if (rect.width <= 0) return
    this.emitResize(((event.clientX - rect.left) / rect.width) * 100, 'pointer')
  }

  private onDividerPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !this.projection.capabilities.resize) return
    event.preventDefault()
    this.draggingPointerId = event.pointerId
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    this.resizeFromPointer(event)
    this.requestFocus(this.projection.activePaneId, 'pointer')
    this.requestUpdate()
  }

  private onDividerPointerMove(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId) return
    event.preventDefault()
    this.resizeFromPointer(event)
  }

  private onDividerPointerEnd(event: PointerEvent): void {
    if (this.draggingPointerId !== event.pointerId) return
    this.resizeFromPointer(event)
    this.draggingPointerId = null
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
    this.requestUpdate()
  }

  private onDividerKeyDown(event: KeyboardEvent): void {
    if (!this.projection.capabilities.resize) return
    const step = event.shiftKey ? 5 : 1
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = this.projection.dividerPercent - step
    if (event.key === 'ArrowRight') next = this.projection.dividerPercent + step
    if (event.key === 'Home') next = this.projection.dividerMinPercent
    if (event.key === 'End') next = this.projection.dividerMaxPercent
    if (next == null) return
    event.preventDefault()
    this.emitResize(next, 'keyboard')
  }

  private _paneEditorHandle(pane: CenterPaneProjection): ShEditorHost['liveEditor'] {
    const host = this.renderRoot.querySelector(
      `[data-center-pane-host="${domToken(pane.id)}"]`,
    ) as ShEditorHost | null
    return host?.liveEditor ?? null
  }

  private _toggleToc(paneId: CenterPaneId): void {
    this._tocOpenPaneId = this._tocOpenPaneId === paneId ? null : paneId
  }

  private _navigateToc(pane: CenterPaneProjection, blockId: string): void {
    this._paneEditorHandle(pane)?.focusBlock(blockId)
    this._tocOpenPaneId = null
  }

  private renderToc(pane: CenterPaneProjection): TemplateResult | typeof nothing {
    const headings = this._paneEditorHandle(pane)?.getHeadings() ?? []
    if (headings.length === 0) return nothing
    const open = this._tocOpenPaneId === pane.id
    const label = headings.find((h) => h.level === 1)?.text ?? headings[0]!.text
    return html`<div class="toc-wrap" data-toc-wrap>
      <button
        class="toc-btn"
        aria-label="Table of contents"
        aria-expanded=${open ? 'true' : 'false'}
        title="Table of contents"
        @click=${() => this._toggleToc(pane.id)}
      >${tocIcon()}<span class="toc-btn-label">${label || 'Untitled'}</span><span aria-hidden="true">▾</span></button>
      ${open ? html`<div class="toc-dropdown" role="menu">
        ${headings.map((h) => html`
          <button
            type="button"
            class="toc-item"
            role="menuitem"
            style="padding-inline-start: calc(${h.level - 1} * 12px + 10px)"
            title=${h.text}
            @click=${() => this._navigateToc(pane, h.id)}
          >${h.text || 'Untitled'}</button>
        `)}
      </div>` : nothing}
    </div>`
  }

  private renderPane(pane: CenterPaneProjection, box: ViewportAllocation | null): TemplateResult {
    const config = this.editorHosts.get(pane.id)
    const token = domToken(pane.id)
    const stageId = `center-pane-stage-${token}`
    // `box` is `null` exactly when `_geometry()` has not yet measured a real
    // container (pre-first-ResizeObserver-callback, or no `ResizeObserver` in
    // this environment) — the CSS rules below (`.center-panes[data-split]
    // .pane[data-position]`) are the fallback for that case ONLY. Once a real
    // box exists, these inline styles are the actual solved geometry from the
    // shared Phase-1 solver and win over the CSS by specificity.
    const geometryStyle = box
      ? `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;right:auto;bottom:auto;`
      : nothing
    return html`<section
      class="pane"
      data-pane-id=${pane.id}
      data-position=${pane.position}
      ?data-active=${pane.active}
      aria-label=${`${pane.position === 'primary' ? 'Primary' : 'Secondary'} document pane: ${pane.title}`}
      style=${geometryStyle}
      @pointerdown=${(event: PointerEvent) => this.requestPaneFocusFromEvent(event, pane.id, 'pointer')}
      @focusin=${(event: FocusEvent) => this.requestPaneFocusFromEvent(event, pane.id, 'focus')}
    >
      <div class="pane-header" role="toolbar" aria-label=${`${pane.title} navigation`}>
        <span class="pane-position" aria-hidden="true"></span>
        <button
          class="pane-command"
          data-pane-back=${pane.id}
          aria-label=${`Go back in ${pane.title}`}
          title=${eventTitle(pane.capabilities.navigateDisabledReason, 'Go back')}
          ?disabled=${!pane.canGoBack}
          @click=${() => this.requestNavigate(pane.id, 'back')}
        >←</button>
        <button
          class="pane-command"
          data-pane-forward=${pane.id}
          aria-label=${`Go forward in ${pane.title}`}
          title=${eventTitle(pane.capabilities.navigateDisabledReason, 'Go forward')}
          ?disabled=${!pane.canGoForward}
          @click=${() => this.requestNavigate(pane.id, 'forward')}
        >→</button>
        <span class="pane-title" title=${pane.title}>${pane.title}</span>
        ${this.renderToc(pane)}
        <button
          class="pane-command"
          data-pane-open=${pane.id}
          aria-label=${`Open a document in ${pane.title}`}
          title=${eventTitle(pane.capabilities.openDisabledReason, 'Open a document in this pane')}
          ?disabled=${!pane.capabilities.openDocument}
          @click=${() => this.requestOpen(pane.id, 'active', 'choose-document')}
        >⌘O</button>
        ${this.showSplitCommand && pane.active ? html`<button
          class="split-command"
          data-split-command
          aria-pressed=${this.projection.splitCommand.pressed ? 'true' : 'false'}
          aria-label=${this.projection.splitCommand.label}
          title=${eventTitle(
            this.projection.splitCommand.disabledReason,
            this.projection.splitCommand.label,
          )}
          ?disabled=${this.projection.splitCommand.disabled}
          @click=${() => this.requestSplitCommand()}
        >${this.projection.splitCommand.label}</button>` : nothing}
        ${pane.position === 'secondary' ? html`<button
          class="pane-command"
          data-pane-close=${pane.id}
          aria-label="Close secondary pane"
          title=${eventTitle(pane.capabilities.closeDisabledReason, 'Close secondary pane')}
          ?disabled=${!pane.capabilities.close}
          @click=${() => this.requestClose(pane.id, 'pane-command')}
        >×</button>` : nothing}
      </div>
      <div class="pane-stage" id=${stageId} data-pane-stage=${pane.id}>
        <sh-editor-host
          id=${pane.position === 'primary' ? 'mn-editor-host' : `center-editor-host-${token}`}
          data-center-pane-host=${token}
          layout-mode="contained"
          .paneActive=${pane.active}
          aria-owns=${stageId}
          .binding=${config?.binding ?? null}
          .kernelOptions=${config?.kernelOptions ?? null}
          .initialZoomBlockId=${config?.initialZoomBlockId ?? null}
          .focusRequest=${config?.focusRequest ?? null}
          .wireBundle=${config?.wireBundle ?? null}
          .wireRadialContexts=${config?.wireRadialContexts ?? null}
          .salienceBundle=${config?.salienceBundle ?? null}
          .imageInserter=${config?.imageInserter ?? null}
          .footnoteInserter=${config?.footnoteInserter ?? null}
          .commentInserter=${config?.commentInserter ?? null}
          .originalFileView=${config?.originalFileView ?? null}
          .documentAccess=${config?.documentAccess ?? null}
          .ttsStatus=${config?.ttsStatus ?? 'idle'}
          .ttsAvailable=${config?.ttsAvailable ?? false}
        ></sh-editor-host>
        ${pane.current.kind === 'home' ? html`<div class="empty-pane" data-pane-home=${pane.id}>
          <span>${pane.position === 'primary' ? 'Choose a document to begin.' : 'A second path through the garden.'}</span>
          <button
            class="empty-open"
            ?disabled=${!pane.capabilities.openDocument}
            @click=${() => this.requestOpen(pane.id, 'active', 'choose-document')}
          >Open a document</button>
        </div>` : nothing}
      </div>
    </section>`
  }

  protected render(): TemplateResult {
    const style = `--center-divider: ${this.projection.dividerPercent}%;`
    const geometry = this._geometry()
    const dividerStyle = geometry
      ? `position:absolute;left:${geometry.primary.x + geometry.primary.width}px;top:${geometry.primary.y}px;width:${geometry.dividerThickness}px;height:${geometry.primary.height}px;right:auto;bottom:auto;`
      : nothing
    return html`<div
      class="center-panes"
      data-split=${this.projection.split ? 'true' : 'false'}
      data-active-pane=${this.projection.activePaneId}
      data-posture=${this.projection.posture}
      style=${style}
    >
      ${repeat(
        this.projection.panes,
        (pane) => pane.id,
        (pane) => this.renderPane(pane, (pane.position === 'primary' ? geometry?.primary : geometry?.secondary) ?? null),
      )}
      ${this.projection.split ? html`<div
        class="divider"
        data-center-divider
        ?data-dragging=${this.draggingPointerId !== null}
        role="separator"
        tabindex=${this.projection.capabilities.resize ? '0' : '-1'}
        aria-label="Resize document panes"
        aria-orientation="vertical"
        aria-valuemin=${String(this.projection.dividerMinPercent)}
        aria-valuemax=${String(this.projection.dividerMaxPercent)}
        aria-valuenow=${String(this.projection.dividerPercent)}
        title=${eventTitle(this.projection.capabilities.resizeDisabledReason, 'Resize document panes')}
        style=${dividerStyle}
        @pointerdown=${this.onDividerPointerDown}
        @pointermove=${this.onDividerPointerMove}
        @pointerup=${this.onDividerPointerEnd}
        @pointercancel=${this.onDividerPointerEnd}
        @keydown=${this.onDividerKeyDown}
      ></div>` : nothing}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-center-panes': ShCenterPanes
  }
}
