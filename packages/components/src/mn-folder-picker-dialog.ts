/**
 * mn-folder-picker-dialog — Garden's move-target picker, made backend-free.
 *
 * The component renders a folder tree for a single section and emits the chosen
 * folder id. Callers own move validation, persistence, and folder creation.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { hidePopover, showPopover } from './popover.js'

export interface MnFolderPickerOption {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly section: 'documents' | 'artifacts'
}

export interface MnFolderPickerSelectDetail {
  readonly folderId: string | null
}

interface FolderTreeNode extends MnFolderPickerOption {
  readonly depth: number
  readonly children: readonly FolderTreeNode[]
}

let folderPickerDialogInstance = 0

@customElement('mn-folder-picker-dialog')
export class MnFolderPickerDialog extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      margin: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      max-width: none;
      max-height: none;
      border: 0;
      background: transparent;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-4, 16px);
      box-sizing: border-box;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: flex;
    }

    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: inherit;
      background: var(--mn-color-overlay, rgba(15, 23, 42, 0.5));
      box-sizing: border-box;
    }

    .dialog {
      position: relative;
      display: flex;
      width: min(100%, 420px);
      max-height: min(620px, calc(100vh - 48px));
      max-height: min(620px, calc(100dvh - 48px));
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-xl, 0 24px 60px rgba(15, 23, 42, 0.22));
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .title {
      margin: 0;
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, var(--mn-font-chrome, system-ui, sans-serif));
      font-size: var(--mn-text-lg, 17px);
      font-weight: 650;
      line-height: 1.25;
    }

    .close-button,
    .folder-item,
    .footer button {
      font: inherit;
    }

    .close-button {
      display: inline-flex;
      width: 30px;
      height: 30px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
    }

    .close-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .close-button:focus-visible,
    .folder-item:focus-visible,
    .footer button:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px var(--mn-focus-ring-color, #2563eb));
    }

    .body {
      min-height: 220px;
      overflow: auto;
      padding: var(--mn-space-2, 8px);
    }

    .folder-tree {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .folder-item {
      display: flex;
      align-items: center;
      min-height: 32px;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      text-align: left;
      box-sizing: border-box;
    }

    .folder-item:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .folder-item.selected {
      background: var(--mn-color-surface-active, #eef2ff);
      border-color: var(--mn-color-border-accent, #2563eb);
    }

    .folder-item.current {
      border-style: dashed;
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-subtle, #f8fafc);
    }

    .folder-item:disabled {
      color: var(--mn-color-text-tertiary, #9ca3af);
      cursor: not-allowed;
    }

    .folder-item:disabled .folder-icon {
      opacity: 0.5;
    }

    .folder-icon {
      display: inline-flex;
      color: var(--mn-color-text-warning, #b45309);
      flex: 0 0 auto;
    }

    .root-option .folder-icon {
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .folder-name {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .status-badge {
      flex: 0 0 auto;
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
    }

    .current-badge {
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .unavailable-badge {
      color: var(--mn-color-text-tertiary, #9ca3af);
    }

    .empty {
      padding: var(--mn-space-5, 20px);
      color: var(--mn-color-text-tertiary, #9ca3af);
      text-align: center;
      font-size: var(--mn-text-sm, 13px);
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px) var(--mn-space-5, 20px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .footer button {
      min-height: var(--mn-control-height, 30px);
      padding: 0 var(--mn-space-3, 12px);
      border-radius: var(--mn-radius-control, 6px);
      cursor: pointer;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
    }

    .cancel-button {
      border: 1px solid transparent;
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .cancel-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .confirm-button {
      min-width: 92px;
      border: 1px solid var(--mn-color-primary-600, #2563eb);
      background: var(--mn-color-primary-600, #2563eb);
      color: var(--mn-color-on-primary, #fff);
    }

    .confirm-button:hover:not(:disabled) {
      background: var(--mn-color-primary-700, #1d4ed8);
      border-color: var(--mn-color-primary-700, #1d4ed8);
    }

    .confirm-button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    @media (max-width: 600px) {
      :host {
        align-items: flex-end;
        padding: 0;
      }

      .overlay {
        align-items: flex-end;
        justify-content: stretch;
        padding: max(var(--mn-space-4, 16px), env(safe-area-inset-top)) 0 0;
      }

      .dialog {
        width: 100%;
        max-height: min(88vh, calc(100vh - max(var(--mn-space-4, 16px), env(safe-area-inset-top))));
        max-height: min(88dvh, calc(100dvh - max(var(--mn-space-4, 16px), env(safe-area-inset-top))));
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: var(--mn-radius-xl, 12px) var(--mn-radius-xl, 12px) 0 0;
      }

      .header {
        min-height: 64px;
        padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px) var(--mn-space-2, 8px)
          var(--mn-space-5, 20px);
        box-sizing: border-box;
      }

      .title {
        font-size: var(--mn-text-xl, 19px);
      }

      .close-button {
        width: 48px;
        height: 48px;
      }

      .body {
        min-height: 0;
        overscroll-behavior: contain;
        padding: var(--mn-space-2, 8px);
        -webkit-overflow-scrolling: touch;
      }

      .folder-item {
        min-height: 48px;
        padding-top: var(--mn-space-2, 8px);
        padding-bottom: var(--mn-space-2, 8px);
      }

      .folder-name {
        font-size: var(--mn-text-base, 15px);
      }

      .footer {
        align-items: stretch;
        padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px)
          max(var(--mn-space-3, 12px), env(safe-area-inset-bottom));
      }

      .footer button {
        min-height: 48px;
      }

      .cancel-button {
        min-width: 84px;
      }

      .confirm-button {
        flex: 1 1 auto;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) title = 'Move to Folder'
  @property({ attribute: false }) folders: readonly MnFolderPickerOption[] = []
  @property({ type: String, attribute: 'current-parent-id' }) currentParentId: string | null = null
  @property({ attribute: false }) excludeIds: readonly string[] = []
  @property({ type: String }) section: 'documents' | 'artifacts' = 'documents'

  @state() private selectedFolderId: string | null = null

  private previousFocus: HTMLElement | null = null
  private modalAnnounced = false
  private readonly overlayId = `folder-picker-${++folderPickerDialogInstance}`

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('popover', 'manual')
    this.ownerDocument.addEventListener('keydown', this.handleKeyDown)
    if (this.open) this.announceModalState(true)
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('keydown', this.handleKeyDown)
    this.announceModalState(false)
    this.restoreFocus()
    // See mn-input-dialog's identical disconnectedCallback comment: the host
    // IS the popover, so hide() must run here to reconcile top-layer state.
    this.hide()
    super.disconnectedCallback()
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      if (this.open) {
        showPopover(this)
        this.rememberFocus()
        this.selectedFolderId = this.currentParentId
        this.announceModalState(true)
        void this.updateComplete.then(() => this.focusInitialDestination())
      } else {
        hidePopover(this)
        this.announceModalState(false)
        this.restoreFocus()
      }
    }
  }

  /**
   * Promotes into the native top layer — see mn-input-dialog.show()'s
   * identical doc comment for why (host-as-popover, no PopoverController).
   */
  show(): void {
    this.rememberFocus()
    this.open = true
    showPopover(this)
    this.announceModalState(true)
  }

  hide(): void {
    this.open = false
    hidePopover(this)
    this.announceModalState(false)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    } else if (event.key === 'Tab') {
      this.containFocus(event)
    }
  }

  private rememberFocus(): void {
    if (this.previousFocus) return
    const active = this.deepestActiveElement()
    if (active && active !== this) this.previousFocus = active
  }

  private deepestActiveElement(): HTMLElement | null {
    let active = this.ownerDocument.activeElement
    while (active instanceof HTMLElement) {
      const nested = active.shadowRoot?.activeElement
      if (!(nested instanceof HTMLElement)) return active
      active = nested
    }
    return null
  }

  private restoreFocus(): void {
    const target = this.previousFocus
    this.previousFocus = null
    if (target?.isConnected) target.focus()
  }

  private focusableElements(): readonly HTMLElement[] {
    return Array.from(this.shadowRoot?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
  }

  private focusInitialDestination(): void {
    if (!this.open) return
    const selected = this.shadowRoot?.querySelector<HTMLElement>('.folder-item.selected:not(:disabled)')
    const firstDestination = this.shadowRoot?.querySelector<HTMLElement>('.folder-item:not(:disabled)')
    ;(selected ?? firstDestination ?? this.focusableElements()[0])?.focus()
  }

  private containFocus(event: KeyboardEvent): void {
    const focusable = this.focusableElements()
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = this.shadowRoot?.activeElement
    const activeIndex = focusable.indexOf(active as HTMLElement)

    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
      event.preventDefault()
      first.focus()
    }
  }

  private announceModalState(open: boolean): void {
    if (this.modalAnnounced === open) return
    this.modalAnnounced = open
    const event = new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: this.overlayId, open, modality: 'modal' },
    })
    if (this.isConnected) this.dispatchEvent(event)
    else this.ownerDocument.dispatchEvent(event)
  }

  private buildFolderTree(): readonly FolderTreeNode[] {
    const byParent = new Map<string | null, MnFolderPickerOption[]>()
    for (const folder of this.folders) {
      if (folder.section !== this.section) continue
      const siblings = byParent.get(folder.parentId) ?? []
      siblings.push(folder)
      byParent.set(folder.parentId, siblings)
    }
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name))
    }

    const build = (parentId: string | null, depth: number): readonly FolderTreeNode[] =>
      (byParent.get(parentId) ?? []).map((folder) => ({
        ...folder,
        depth,
        children: build(folder.id, depth + 1),
      }))

    return build(null, 0)
  }

  private selectFolder(folderId: string | null): void {
    if (folderId && this.excludeIds.includes(folderId)) return
    this.selectedFolderId = folderId
  }

  private confirm(): void {
    this.dispatchEvent(
      new CustomEvent<MnFolderPickerSelectDetail>('mn-select', {
        detail: { folderId: this.selectedFolderId },
        bubbles: true,
        composed: true,
      }),
    )
    this.hide()
  }

  private cancel(): void {
    this.hide()
    this.dispatchEvent(new CustomEvent('mn-cancel', { bubbles: true, composed: true }))
  }

  private renderFolderNode(node: FolderTreeNode): unknown {
    const selected = this.selectedFolderId === node.id
    const current = this.currentParentId === node.id
    const disabled = this.excludeIds.includes(node.id)
    const status = [current ? 'current destination' : '', disabled ? 'unavailable' : ''].filter(Boolean).join(', ')
    return html`
      <button
        type="button"
        class=${classMap({ 'folder-item': true, selected, current })}
        style="padding-left: ${12 + node.depth * 20}px"
        role="option"
        aria-selected=${selected ? 'true' : 'false'}
        aria-disabled=${disabled ? 'true' : 'false'}
        aria-label=${status ? `${node.name}, ${status}` : node.name}
        ?disabled=${disabled}
        @click=${() => this.selectFolder(node.id)}
      >
        <span class="folder-icon" aria-hidden="true">${icon('folder', { size: 16 })}</span>
        <span class="folder-name">${node.name}</span>
        ${current ? html`<span class="status-badge current-badge">Current</span>` : nothing}
        ${disabled ? html`<span class="status-badge unavailable-badge">Unavailable</span>` : nothing}
      </button>
      ${node.children.length > 0
        ? repeat(node.children, (child) => child.id, (child) => this.renderFolderNode(child))
        : nothing}
    `
  }

  render(): unknown {
    const tree = this.buildFolderTree()
    const rootSelected = this.selectedFolderId === null
    const rootCurrent = this.currentParentId === null
    return html`
      <div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.cancel()}>
        <section
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mn-folder-picker-title"
          @click=${(event: Event) => event.stopPropagation()}
        >
          <header class="header">
            <h2 class="title" id="mn-folder-picker-title">${this.title}</h2>
            <button type="button" class="close-button" aria-label="Close" @click=${() => this.cancel()}>
              ${icon('x', { size: 17 })}
            </button>
          </header>
          <div class="body">
            <div class="folder-tree" role="listbox" aria-label="Select destination folder">
              <button
                type="button"
                class=${classMap({ 'folder-item': true, 'root-option': true, selected: rootSelected, current: rootCurrent })}
                role="option"
                aria-selected=${rootSelected ? 'true' : 'false'}
                aria-label=${rootCurrent
                  ? `${this.section === 'artifacts' ? 'Artifacts' : 'Documents'} root, current destination`
                  : `${this.section === 'artifacts' ? 'Artifacts' : 'Documents'} root`}
                @click=${() => this.selectFolder(null)}
              >
                <span class="folder-icon" aria-hidden="true">${icon('home', { size: 16 })}</span>
                <span class="folder-name">${this.section === 'artifacts' ? 'Artifacts root' : 'Documents root'}</span>
                ${rootCurrent ? html`<span class="status-badge current-badge">Current</span>` : nothing}
              </button>
              ${tree.length > 0
                ? repeat(tree, (node) => node.id, (node) => this.renderFolderNode(node))
                : html`<div class="empty">No folders available</div>`}
            </div>
          </div>
          <footer class="footer">
            <button type="button" class="cancel-button" @click=${() => this.cancel()}>Cancel</button>
            <button
              type="button"
              class="confirm-button"
              ?disabled=${this.selectedFolderId === this.currentParentId}
              @click=${() => this.confirm()}
            >
              Move Here
            </button>
          </footer>
        </section>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-folder-picker-dialog': MnFolderPickerDialog
  }
}
