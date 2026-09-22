/**
 * Controlled, backend-free workspace catalog and switcher used by mn-top-bar.
 *
 * `embedded` (Wave 1, north star §2.2/§3: "the workspaces themselves are
 * faceable; the top-bar dropdown remains chrome") is an ADDITIVE, opt-in mode
 * — default `false`, so `mn-top-bar`'s existing trigger+popover usage is
 * byte-for-byte unchanged. When `true`, this SAME real element renders its
 * catalog content (`renderMenuBody()` — status/loading/error/ready-list/
 * create-footer, unchanged) inline, filling its host at 100%/100%, with the
 * `.trigger` button and popover promotion mechanics omitted entirely — the
 * change is only WHICH delivery form wraps the real content (a leaf has no
 * "closed" state to trigger open from), never a reimplementation of the
 * catalog projection/rendering logic itself.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { PopoverController } from './popover.js'
import {
  projectWorkspaceCatalog,
  workspaceActionCapability,
  workspaceDisplayPath,
  workspaceLifecycleLabel,
  workspaceLifetimeLabel,
} from './mn-workspace-selector-model.js'
import type {
  MnWorkspaceActionCapability,
  MnWorkspaceDetail,
  MnWorkspaceIntentDetailMap,
  MnWorkspaceIntentName,
  MnWorkspaceManagementAction,
  MnWorkspaceRole,
  MnWorkspaceSelectorStatus,
  MnWorkspaceSummary,
} from './mn-workspace-selector-model.js'

export {
  projectWorkspaceCatalog,
  workspaceActionCapability,
  workspaceDisplayPath,
  workspaceLifecycleLabel,
  workspaceLifetimeLabel,
} from './mn-workspace-selector-model.js'
export type {
  MnWorkspaceActionCapability,
  MnWorkspaceCapabilities,
  MnWorkspaceCatalogGroup,
  MnWorkspaceCatalogProjection,
  MnWorkspaceCellState,
  MnWorkspaceDetail,
  MnWorkspaceGroupKind,
  MnWorkspaceIntentDetailMap,
  MnWorkspaceIntentName,
  MnWorkspaceLifetimeState,
  MnWorkspaceManagementAction,
  MnWorkspaceRole,
  MnWorkspaceSelectorStatus,
  MnWorkspaceSummary,
} from './mn-workspace-selector-model.js'

const ENABLED_CREATE: MnWorkspaceActionCapability = Object.freeze({ available: true })

function titleFor(workspace: MnWorkspaceSummary): string {
  return workspace.title.trim() || workspace.graphId
}

function roleLabel(role: MnWorkspaceRole): string {
  return role[0]!.toUpperCase() + role.slice(1)
}

function actionLabel(action: MnWorkspaceManagementAction): string {
  switch (action) {
    case 'rename': return 'Rename'
    case 'delete': return 'Delete'
    case 'leave': return 'Leave workspace'
  }
}

function actionIcon(action: MnWorkspaceManagementAction): string {
  switch (action) {
    case 'rename': return 'pencil'
    case 'delete': return 'trash-2'
    case 'leave': return 'arrow-left'
  }
}

@customElement('mn-workspace-selector')
export class MnWorkspaceSelector extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: relative;
      display: inline-flex;
      min-width: 0;
      font-family: var(--mn-font-chrome, Georgia, serif);
    }

    *, *::before, *::after { box-sizing: border-box; }
    button { font: inherit; }

    .trigger {
      max-width: min(30ch, 34vw);
      min-height: 28px;
      display: flex;
      align-items: center;
      gap: 6px;
      border: 0;
      border-radius: var(--mn-radius-control, 7px);
      padding: 4px 7px;
      background: transparent;
      color: var(--mn-top-bar-text, #29483a);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, rgba(56, 91, 72, 0.08));
    }

    .trigger-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .trigger-progress { color: var(--mn-color-text-accent, #2d6a4f); }
    .menu-anchor { display: contents; }

    .backdrop {
      display: none;
      position: fixed;
      z-index: 999;
      inset: 0;
      background: rgba(17, 24, 20, 0.22);
    }

    [popover] {
      position: fixed;
      inset: unset;
      margin: 0;
      z-index: var(--mn-z-dropdown, 1000);
    }

    [popover]:not([popover-open]):not(:popover-open) {
      display: none;
    }

    .menu {
      width: min(324px, calc(100vw - 24px));
      max-height: min(440px, calc(100dvh - 72px));
      overflow: auto;
      overscroll-behavior: contain;
      padding: 7px;
      border: 1px solid var(--mn-color-border-default, #d6dfd8);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffef9);
      color: var(--mn-color-text-primary, #18211b);
      box-shadow: var(--mn-shadow-raised, 0 14px 34px rgba(25, 40, 31, 0.16));
    }

    .sheet-header { display: none; }

    .group + .group { margin-top: 7px; }

    .group-heading {
      padding: 7px 9px 4px;
      color: var(--mn-color-text-muted, #6a756e);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.075em;
      text-transform: uppercase;
    }

    .state {
      padding: 20px 12px;
      color: var(--mn-color-text-muted, #66736a);
      text-align: center;
      font-size: 12px;
      line-height: 1.45;
    }

    .state.error { color: var(--mn-color-text-danger, #9d2b2b); }

    .retry {
      margin-top: 9px;
      border: 1px solid currentColor;
      border-radius: var(--mn-radius-control, 6px);
      padding: 5px 10px;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    .progress {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 2px 3px 6px;
      padding: 7px 9px;
      border-radius: var(--mn-radius-control, 7px);
      background: var(--mn-color-surface-accent, #eef6ef);
      color: var(--mn-color-text-accent, #2d6a4f);
      font-size: 11px;
    }

    .spin { animation: workspace-spin 0.9s linear infinite; }
    @keyframes workspace-spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .spin { animation: none; }
    }

    .row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: stretch;
      min-width: 0;
      border-radius: var(--mn-radius-control, 7px);
    }

    .row:hover,
    .row:focus-within {
      background: var(--mn-color-surface-hover, #f1f5f2);
    }

    .select {
      min-width: 0;
      display: grid;
      grid-template-columns: 17px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      border: 0;
      padding: 8px 7px 8px 9px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }

    .select[aria-selected='true'] { color: var(--mn-color-text-accent, #2d6a4f); }
    .select:disabled { cursor: not-allowed; opacity: 0.58; }

    .row-icon {
      width: 17px;
      display: inline-grid;
      place-items: center;
      align-self: start;
      margin-top: 1px;
      color: var(--mn-color-text-muted, #647168);
    }

    .select[aria-selected='true'] .row-icon { color: currentColor; }

    .copy { min-width: 0; display: block; }

    .name,
    .path-line,
    .disabled-reason {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .name { font-size: 12px; font-weight: 650; line-height: 1.3; }

    .path-line {
      margin-top: 2px;
      color: var(--mn-color-text-muted, #6b776f);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      font-size: 9.5px;
      line-height: 1.35;
    }

    .metadata {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      margin-top: 3px;
      color: var(--mn-color-text-muted, #6b776f);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      font-size: 9.5px;
      line-height: 1.3;
    }

    .role { color: var(--mn-color-text-accent, #376c52); }
    .lifecycle[data-tone='error'] { color: var(--mn-color-text-danger, #9d2b2b); }
    .lifecycle[data-tone='stopped'] { color: var(--mn-color-text-warning, #805800); }
    .lifetime[data-tone='moved-on'] { color: var(--mn-color-text-warning, #805800); }

    .disabled-reason {
      margin-top: 3px;
      color: var(--mn-color-text-warning, #805800);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      font-size: 9.5px;
      line-height: 1.3;
    }

    .more {
      width: 30px;
      min-height: 30px;
      align-self: center;
      display: grid;
      place-items: center;
      margin-right: 3px;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #66736a);
      cursor: pointer;
      opacity: 0;
    }

    .row:hover .more,
    .row:focus-within .more,
    .more[aria-expanded='true'] { opacity: 1; }

    .more:hover { background: var(--mn-color-surface-accent, #edf6ef); color: var(--mn-color-text-accent, #2d6a4f); }

    .action-menu {
      position: absolute;
      z-index: 3;
      top: calc(100% - 2px);
      right: 3px;
      min-width: 150px;
      padding: 4px;
      border: 1px solid var(--mn-color-border-default, #d6dfd8);
      border-radius: var(--mn-radius-control, 7px);
      background: var(--mn-color-surface-raised, #fffef9);
      box-shadow: var(--mn-shadow-raised, 0 10px 24px rgba(25, 40, 31, 0.17));
    }

    .action-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 0;
      border-radius: calc(var(--mn-radius-control, 6px) - 1px);
      padding: 7px 8px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
      font-size: 11px;
    }

    .action-item:hover:not(:disabled),
    .action-item:focus-visible:not(:disabled) { background: var(--mn-color-surface-hover, #f1f5f2); }
    .action-item[data-action='delete']:hover:not(:disabled) { background: var(--mn-color-danger-surface, #fae8e8); color: var(--mn-color-text-danger, #a12a2a); }
    .action-item:disabled { cursor: not-allowed; opacity: 0.48; }

    .footer {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--mn-color-border-subtle, #e4e9e5);
    }

    .create {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 0;
      border-radius: var(--mn-radius-control, 7px);
      padding: 8px 9px;
      background: transparent;
      color: var(--mn-color-text-accent, #2d6a4f);
      cursor: pointer;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
    }

    .create:hover:not(:disabled) { background: var(--mn-color-surface-hover, #f1f5f2); }
    .create:disabled { cursor: not-allowed; opacity: 0.5; }

    button:focus-visible {
      outline: 2px solid var(--mn-color-focus, #2d6a4f);
      outline-offset: 1px;
    }

    :host([data-skin='emporium']) .menu {
      border-radius: var(--mn-radius-control, 3px);
      background: var(--mn-color-surface-raised, #fff);
    }

    :host([data-skin='emporium']) .row,
    :host([data-skin='emporium']) .create,
    :host([data-skin='emporium']) .progress { border-radius: var(--mn-radius-control, 3px); }

    :host([data-skin='98']) .trigger {
      min-height: 24px;
      border-radius: 0;
      padding: 3px 7px;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised, inset -1px -1px #000, inset 1px 1px #fff);
    }

    :host([data-skin='98']) .trigger:active,
    :host([data-skin='98']) .trigger[aria-expanded='true'] { box-shadow: var(--mn-98-sunken, inset 1px 1px #000); }

    :host([data-skin='98']) .menu,
    :host([data-skin='98']) .action-menu {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-shadow-popover, 2px 2px 0 #000, inset 1px 1px #fff);
    }

    :host([data-skin='98']) :is(.row, .create, .more, .action-item, .retry, .progress) { border-radius: 0; }
    :host([data-skin='98']) .row:hover,
    :host([data-skin='98']) .row:focus-within,
    :host([data-skin='98']) .create:hover:not(:disabled),
    :host([data-skin='98']) .action-item:hover:not(:disabled) {
      background: var(--mn-98-selection, #000080);
      color: #fff;
    }

    :host([data-skin='glass']) .menu,
    :host([data-skin='glass']) .action-menu {
      border: var(--mn-control-border, 1px solid rgba(255, 255, 255, 0.7));
      background: var(--mn-color-surface-elevated, rgba(242, 251, 255, 0.86));
      box-shadow: var(--mn-shadow-popover, 0 18px 42px rgba(23, 63, 82, 0.23));
      backdrop-filter: var(--mn-window-backdrop-filter, blur(18px) saturate(1.25));
    }

    :host([data-skin='glass']) :is(.row:hover, .row:focus-within, .create:hover:not(:disabled), .action-item:hover:not(:disabled), .progress) {
      background: var(--mn-control-background-hover, rgba(255, 255, 255, 0.55));
    }

    :host([embedded]) {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
    }

    .embedded-menu {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      overflow: auto;
      padding: 7px;
    }

    @media (max-width: 640px) {
      :host { position: static; }
      .trigger { max-width: min(40vw, 19ch); }
      .backdrop { display: block; }
      .menu {
        position: fixed;
        z-index: var(--mn-z-dropdown, 1000);
        inset: auto 0 0;
        width: 100%;
        max-height: min(74dvh, 620px);
        padding: 7px max(9px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(9px, env(safe-area-inset-left));
        border-width: 1px 0 0;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -14px 38px rgba(17, 33, 24, 0.2);
      }

      .sheet-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 3px 7px 9px;
        font-size: 13px;
        font-weight: 700;
      }

      .sheet-header::before {
        content: '';
        position: absolute;
        top: 5px;
        left: 50%;
        width: 34px;
        height: 3px;
        border-radius: 999px;
        background: var(--mn-color-border-strong, #b8c4bc);
        transform: translateX(-50%);
      }

      .sheet-title { padding-top: 8px; }
      .close {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: var(--mn-radius-control, 7px);
        background: transparent;
        color: var(--mn-color-text-muted, #66736a);
        cursor: pointer;
      }

      .select { min-height: 48px; padding-block: 9px; }
      .more { width: 40px; min-height: 40px; opacity: 1; }
      .create { min-height: 46px; }
      .action-menu { position: fixed; z-index: 1002; right: 10px; bottom: max(10px, env(safe-area-inset-bottom)); top: auto; left: 10px; }

      :host([data-skin='98']) .menu { border-radius: 0; border: 0; }
      :host([data-skin='glass']) .menu { border-radius: 17px 17px 0 0; }
    }
  `

  /** Controlled catalog projection. The component never fetches it. */
  @property({ attribute: false }) workspaces: readonly MnWorkspaceSummary[] = []
  @property({ type: String }) status: MnWorkspaceSelectorStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: String, attribute: 'active-graph-id' }) activeGraphId = ''
  /** Host-owned operation marker; `__create__` denotes catalog creation. */
  @property({ type: String, attribute: 'busy-graph-id' }) busyGraphId = ''
  /** Real host capability. `available: false` removes the create affordance. */
  @property({ attribute: false }) createCapability: MnWorkspaceActionCapability = ENABLED_CREATE
  /** Wave-1 leaf mode (this file's own header) — default false; unset by every existing (chrome) consumer. */
  @property({ type: Boolean, reflect: true }) embedded = false

  @state() private open = false
  @state() private actionGraphId = ''
  @state() private pendingGraphId = ''

  /**
   * Promotes `.menu` to the native top layer (Popover API) so it escapes
   * whatever stacking context its host (e.g. mn-top-bar's z-index island)
   * happens to form — see the layer-contract campaign diagnosis. Mobile ALSO
   * promotes: shouldPosition() returns false under the 640px breakpoint, so
   * the controller skips JS positioning and clears inline left/top, letting
   * the CSS `inset: auto 0 0` bottom-sheet rule win.
   */
  private readonly menuPopover = new PopoverController(this, {
    anchor: () => this.shadowRoot?.querySelector('.trigger'),
    popover: () => this.shadowRoot?.querySelector('.menu'),
    placement: 'bottom-start',
    gap: 7,
    shouldPosition: () => !window.matchMedia('(max-width: 640px)').matches,
  })

  private readonly documentPointerDown = (event: PointerEvent): void => {
    if (!this.open || event.composedPath().includes(this)) return
    this.setOpen(false)
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('pointerdown', this.documentPointerDown, true)
    // Embedded content has no trigger click to hang the popover-mode
    // `setOpen(true)` refresh-on-open behavior off of — a leaf is always
    // "open" — so request the host's first load directly, same condition
    // `setOpen` already gates on (idle or a previous error).
    if (this.embedded && (this.status === 'idle' || this.status === 'error')) {
      this.emit('mn-workspace-refresh', {})
    }
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('pointerdown', this.documentPointerDown, true)
    // Reconcile `open` before the controller's own hostDisconnected() (fired
    // by super.disconnectedCallback() below) hides the top-layer surface —
    // a disconnected-while-open selector must not silently stay "open" for
    // aria-expanded/render purposes, and reinsertion must never resurrect a
    // stale menu outside the normal trigger-click flow.
    this.setOpen(false)
    super.disconnectedCallback()
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (this.pendingGraphId && this.activeGraphId === this.pendingGraphId) {
      this.pendingGraphId = ''
      this.open = false
      this.actionGraphId = ''
      return
    }
    if (this.pendingGraphId && changed.has('status') && this.status === 'error') {
      this.pendingGraphId = ''
    }
    if (this.pendingGraphId && changed.has('workspaces') && !this.workspaces.some(workspace => workspace.graphId === this.pendingGraphId)) {
      this.pendingGraphId = ''
    }
  }

  // `open` is private @state (unlike the public `open` on the other
  // migrated components), so `PropertyValues<this>` excludes it from
  // `keyof this` — match the `Map<string, unknown>` shape mn-toolbar.ts
  // already uses for the same reason.
  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return
    if (this.open) this.menuPopover.show()
    else this.menuPopover.hide()
  }

  private emit<Name extends MnWorkspaceIntentName>(
    name: Name,
    detail: MnWorkspaceIntentDetailMap[Name],
  ): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private active(): MnWorkspaceSummary | undefined {
    return this.workspaces.find(workspace => workspace.graphId === this.activeGraphId)
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    if (!open) this.actionGraphId = ''
    if (open && (this.status === 'idle' || this.status === 'error')) {
      this.emit('mn-workspace-refresh', {})
    }
    if (open) {
      void this.updateComplete.then(() => {
        this.shadowRoot?.querySelector<HTMLButtonElement>('.select:not(:disabled), .create:not(:disabled), .retry')?.focus()
      })
    }
  }

  private closeAndRestoreFocus(): void {
    this.setOpen(false)
    void this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLButtonElement>('.trigger')?.focus())
  }

  private triggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.setOpen(true)
  }

  private menuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (this.actionGraphId) {
        const graphId = this.actionGraphId
        this.actionGraphId = ''
        void this.updateComplete.then(() => {
          const button = Array.from(this.shadowRoot?.querySelectorAll<HTMLButtonElement>('.more') ?? [])
            .find(candidate => candidate.dataset.graphId === graphId)
          button?.focus()
        })
      } else {
        this.closeAndRestoreFocus()
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const targets = Array.from(this.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      '.select:not(:disabled), .more:not(:disabled), .action-item:not(:disabled), .create:not(:disabled), .retry, .close',
    ) ?? [])
    if (targets.length === 0) return
    event.preventDefault()
    const activeIndex = targets.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement)
    const index = activeIndex < 0 ? 0 : activeIndex
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? targets.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % targets.length
          : (index - 1 + targets.length) % targets.length
    targets[next]?.focus()
  }

  private select(workspace: MnWorkspaceSummary): void {
    if (workspace.disabled) return
    if (workspace.graphId === this.activeGraphId) {
      this.closeAndRestoreFocus()
      return
    }
    if (this.busyGraphId || this.pendingGraphId) return
    this.pendingGraphId = workspace.graphId
    this.emit('mn-workspace-select', { workspace } satisfies MnWorkspaceDetail)
  }

  private managementActions(workspace: MnWorkspaceSummary): readonly MnWorkspaceManagementAction[] {
    const legal: readonly MnWorkspaceManagementAction[] = workspace.role === 'owner'
      ? ['rename', 'delete']
      : ['leave']
    return legal.filter(action => workspaceActionCapability(workspace, action).available)
  }

  private toggleActions(event: Event, workspace: MnWorkspaceSummary): void {
    event.stopPropagation()
    this.actionGraphId = this.actionGraphId === workspace.graphId ? '' : workspace.graphId
    if (!this.actionGraphId) return
    void this.updateComplete.then(() => {
      const menu = Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>('.action-menu') ?? [])
        .find(candidate => candidate.dataset.graphId === workspace.graphId)
      menu?.querySelector<HTMLButtonElement>('.action-item:not(:disabled)')?.focus()
    })
  }

  private invokeAction(workspace: MnWorkspaceSummary, action: MnWorkspaceManagementAction): void {
    const capability = workspaceActionCapability(workspace, action)
    if (!capability.available || capability.disabledReason || this.busyGraphId) return
    const eventName = `mn-workspace-${action}` as const
    this.emit(eventName, { workspace })
    this.setOpen(false)
  }

  private create(): void {
    if (!this.createCapability.available || this.createCapability.disabledReason || this.busyGraphId) return
    this.emit('mn-workspace-create', {})
    this.setOpen(false)
  }

  private renderPath(workspace: MnWorkspaceSummary) {
    const segments = workspaceDisplayPath(workspace)
    if (segments.length === 0) return nothing
    const path = segments.join(' / ')
    return html`<span class="path-line" title=${path}>${path}</span>`
  }

  private renderMetadata(workspace: MnWorkspaceSummary) {
    const lifecycle = workspaceLifecycleLabel(workspace.cellState)
    const lifetime = workspaceLifetimeLabel(workspace.lifetime)
    if (workspace.role === 'owner' && !lifecycle && !lifetime) return nothing
    return html`<span class="metadata">
      ${workspace.role !== 'owner' ? html`<span class="role">${roleLabel(workspace.role)}</span>` : nothing}
      ${lifecycle ? html`<span class="lifecycle" data-tone=${workspace.cellState}>${lifecycle}</span>` : nothing}
      ${lifetime ? html`<span class="lifetime" data-tone="moved-on">${lifetime}</span>` : nothing}
    </span>`
  }

  private renderCatalogItem(workspace: MnWorkspaceSummary, disabledIndex: number) {
    const title = titleFor(workspace)
    const active = workspace.graphId === this.activeGraphId
    const pending = workspace.graphId === this.pendingGraphId
    const operationBusy = Boolean(this.busyGraphId || this.pendingGraphId)
    const disabled = Boolean(workspace.disabled) || (operationBusy && !active)
    const actions = this.managementActions(workspace)
    const reasonId = workspace.disabledReason ? `workspace-disabled-${disabledIndex}` : ''
    const lifetimeLabel = workspaceLifetimeLabel(workspace.lifetime)
    const ariaParts = [title, roleLabel(workspace.role), workspace.cellState]
    if (lifetimeLabel) ariaParts.push(lifetimeLabel)
    if (workspace.disabledReason) ariaParts.push(workspace.disabledReason)

    return html`<div
      class="row"
      data-graph-id=${workspace.graphId}
      data-role=${workspace.role}
      data-pending=${String(pending)}
      data-lifetime=${workspace.lifetime?.kind ?? nothing}
    >
      <button
        class="select"
        type="button"
        role="option"
        aria-selected=${active ? 'true' : 'false'}
        aria-label=${ariaParts.join(', ')}
        aria-describedby=${reasonId || nothing}
        title=${workspace.disabled ? workspace.disabledReason || 'This workspace is unavailable' : ''}
        ?disabled=${disabled}
        @click=${() => this.select(workspace)}
      >
        <span class="row-icon" aria-hidden="true">${active ? icon('check', { size: 14 }) : pending ? icon('loader-circle', { size: 14, class: 'spin' }) : icon('layers', { size: 14 })}</span>
        <span class="copy">
          <span class="name">${title}</span>
          ${this.renderPath(workspace)}
          ${this.renderMetadata(workspace)}
          ${workspace.disabledReason ? html`<span class="disabled-reason" id=${reasonId}>${workspace.disabledReason}</span>` : nothing}
        </span>
      </button>
      ${actions.length > 0 ? html`<button
        class="more"
        type="button"
        data-graph-id=${workspace.graphId}
        aria-label=${`More actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded=${this.actionGraphId === workspace.graphId ? 'true' : 'false'}
        ?disabled=${Boolean(this.busyGraphId)}
        @click=${(event: Event) => this.toggleActions(event, workspace)}
      >${icon('more-horizontal', { size: 15 })}</button>` : nothing}
      ${this.actionGraphId === workspace.graphId ? html`<div class="action-menu" role="menu" data-graph-id=${workspace.graphId} aria-label=${`Actions for ${title}`}>
        ${actions.map(action => {
          const capability = workspaceActionCapability(workspace, action)
          const disabledReason = capability.disabledReason || (this.busyGraphId ? 'Another workspace operation is in progress.' : '')
          return html`<button
            class="action-item"
            type="button"
            role="menuitem"
            data-action=${action}
            aria-label=${`${actionLabel(action)} ${title}`}
            title=${disabledReason}
            ?disabled=${Boolean(disabledReason)}
            @click=${() => this.invokeAction(workspace, action)}
          >${icon(actionIcon(action), { size: 14 })}<span>${actionLabel(action)}</span></button>`
        })}
      </div>` : nothing}
    </div>`
  }

  private renderProgress() {
    if (this.pendingGraphId) {
      const target = this.workspaces.find(workspace => workspace.graphId === this.pendingGraphId)
      return html`<div class="progress" role="status" aria-live="polite">${icon('loader-circle', { size: 13, class: 'spin' })}<span>Switching to ${target ? titleFor(target) : this.pendingGraphId}…</span></div>`
    }
    if (this.busyGraphId === '__create__') {
      return html`<div class="progress" role="status" aria-live="polite">${icon('loader-circle', { size: 13, class: 'spin' })}<span>Creating workspace…</span></div>`
    }
    if (this.busyGraphId) {
      const target = this.workspaces.find(workspace => workspace.graphId === this.busyGraphId)
      return html`<div class="progress" role="status" aria-live="polite">${icon('loader-circle', { size: 13, class: 'spin' })}<span>Updating ${target ? titleFor(target) : 'workspace'}…</span></div>`
    }
    return nothing
  }

  private renderReadyCatalog() {
    if (this.workspaces.length === 0) return html`<div class="state">No workspaces found</div>`
    const catalog = projectWorkspaceCatalog(this.workspaces)
    let disabledIndex = 0
    return html`<div role="listbox" aria-label="Available workspaces" aria-busy=${this.busyGraphId || this.pendingGraphId ? 'true' : 'false'}>
      ${this.renderProgress()}
      ${catalog.groups.map(group => {
        const headingId = `workspace-group-${group.kind}`
        return html`<section class="group" data-group=${group.kind} role="group" aria-labelledby=${headingId}>
          <div class="group-heading" id=${headingId}>${group.label}</div>
          ${group.workspaces.map(workspace => this.renderCatalogItem(workspace, disabledIndex++))}
        </section>`
      })}
    </div>`
  }

  /**
   * The real catalog content — status/loading/error/ready-list/create-footer,
   * unchanged — shared verbatim by the popover-mode `.menu` and the Wave-1
   * `embedded` mode; only the wrapper around this differs (this file's own
   * header). Wrapped in a real static `<div class="menu-body">` rather than
   * two bare top-level expressions: a nested `TemplateResult` whose ENTIRE
   * content is dynamic (no static element anchoring it) silently rendered
   * NOTHING when embedded one level deeper than its original inline call
   * site — empirically confirmed against this exact lit-html/happy-dom combo
   * before this wrapper was added. `.menu-body` carries no styling of its
   * own (no CSS rule below targets it) — every existing `.state`/`.footer`/
   * etc. selector still matches regardless of this one extra ancestor.
   */
  private renderMenuBody() {
    return html`<div class="menu-body">
      ${this.status === 'loading' || this.status === 'idle'
        ? html`<div class="state" role="status" aria-busy="true">Loading workspaces…</div>`
        : this.status === 'error'
          ? html`<div class="state error" role="alert">${this.error || 'Workspaces are unavailable.'}<br><button class="retry" type="button" @click=${() => this.emit('mn-workspace-refresh', {})}>Retry</button></div>`
          : this.renderReadyCatalog()}
      ${this.createCapability.available ? html`<div class="footer"><button
        class="create"
        type="button"
        title=${this.createCapability.disabledReason ?? ''}
        ?disabled=${Boolean(this.createCapability.disabledReason) || Boolean(this.busyGraphId || this.pendingGraphId)}
        @click=${this.create}
      >${icon('plus', { size: 14 })} New Workspace</button></div>` : nothing}
    </div>`
  }

  private renderEmbedded() {
    return html`<div
      class="embedded-menu"
      role="listbox-group"
      aria-label="Workspaces"
      aria-busy=${this.status === 'loading' || this.status === 'idle' || Boolean(this.busyGraphId) ? 'true' : 'false'}
      @keydown=${this.menuKeydown}
    >${this.renderMenuBody()}</div>`
  }

  render() {
    if (this.embedded) return this.renderEmbedded()
    const active = this.active()
    const label = active ? titleFor(active) : 'Select Workspace'
    const switching = Boolean(this.pendingGraphId)
    return html`
      <button
        class="trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-label=${`Workspace: ${label}`}
        @click=${() => this.setOpen(!this.open)}
        @keydown=${this.triggerKeydown}
      >
        ${switching ? html`<span class="trigger-progress">${icon('loader-circle', { size: 14, class: 'spin' })}</span>` : icon('layers', { size: 14 })}
        <span class="trigger-label">${label}</span>
        ${icon('chevron-down', { size: 12 })}
      </button>
      <span class="menu-anchor">${this.open ? html`
        <div class="backdrop" aria-hidden="true" @pointerdown=${() => this.closeAndRestoreFocus()}></div>
        <div
          class="menu"
          popover="manual"
          role="dialog"
          aria-label="Switch workspace"
          aria-busy=${this.status === 'loading' || this.status === 'idle' || Boolean(this.busyGraphId) ? 'true' : 'false'}
          @keydown=${this.menuKeydown}
        >
          <div class="sheet-header"><span class="sheet-title">Choose a workspace</span><button class="close" type="button" aria-label="Close workspace selector" @click=${this.closeAndRestoreFocus}>${icon('x', { size: 17 })}</button></div>
          ${this.renderMenuBody()}
        </div>
      ` : nothing}</span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-workspace-selector': MnWorkspaceSelector
  }
}
