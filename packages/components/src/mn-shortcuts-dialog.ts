/**
 * mn-shortcuts-dialog — Garden keyboard-shortcuts help, made shell-neutral.
 *
 * Garden's original dialog reads the singleton command registry and executes
 * commands itself. In Shrubbery, the pure component receives shortcut rows as
 * data and emits an execute intent; the shell/runtime owns the registry/context.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-search-input.js'
import type { MnSearchInput, MnSearchInputDetail } from './mn-search-input.js'

export type MnShortcutPlatform = 'auto' | 'mac' | 'windows' | 'linux' | 'other'

export interface MnShortcutCommand {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly shortcut: string
  readonly keywords?: readonly string[]
  readonly disabled?: boolean
}

export interface MnShortcutRunDetail {
  readonly id: string
  readonly command: MnShortcutCommand
  readonly modifiers: {
    readonly shiftKey: boolean
    readonly altKey: boolean
    readonly ctrlKey: boolean
    readonly metaKey: boolean
  }
}

function currentPlatform(): Exclude<MnShortcutPlatform, 'auto'> {
  if (typeof navigator === 'undefined') return 'other'
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform
    ?? ''
  const text = platform.toLowerCase()
  if (text.includes('mac') || text.includes('iphone') || text.includes('ipad')) return 'mac'
  if (text.includes('win')) return 'windows'
  if (text.includes('linux')) return 'linux'
  return 'other'
}

export function formatShortcutLabel(
  shortcut: string,
  platform: MnShortcutPlatform = 'auto',
): string {
  const actualPlatform = platform === 'auto' ? currentPlatform() : platform
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  if (actualPlatform === 'mac') {
    return parts
      .map((part) => {
        const key = part.toLowerCase()
        if (key === 'mod' || key === 'cmd' || key === 'meta') return '⌘'
        if (key === 'shift') return '⇧'
        if (key === 'alt' || key === 'option') return '⌥'
        if (key === 'ctrl' || key === 'control') return '⌃'
        if (key === 'enter' || key === 'return') return '↵'
        if (key === 'arrowup') return '↑'
        if (key === 'arrowdown') return '↓'
        if (key === 'arrowleft') return '←'
        if (key === 'arrowright') return '→'
        return part.length === 1 ? part.toUpperCase() : part
      })
      .join('')
  }

  return parts
    .map((part) => {
      const key = part.toLowerCase()
      if (key === 'mod' || key === 'cmd' || key === 'meta') return 'Ctrl'
      if (key === 'ctrl' || key === 'control') return 'Ctrl'
      if (key === 'alt' || key === 'option') return 'Alt'
      if (key === 'shift') return 'Shift'
      return part
    })
    .join('+')
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function eventModifiers(event: MouseEvent | KeyboardEvent): MnShortcutRunDetail['modifiers'] {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  }
}

@customElement('mn-shortcuts-dialog')
export class MnShortcutsDialog extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: flex;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.48));
    }

    .dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(680px, calc(100vw - var(--mn-space-8, 32px)));
      max-height: min(720px, calc(100dvh - var(--mn-space-8, 32px)));
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, rgba(15, 23, 42, 0.16));
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-modal, 0 24px 60px rgba(15, 23, 42, 0.22));
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-5, 20px) var(--mn-space-6, 24px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
    }

    .title {
      min-width: 0;
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-type-heading-size, 1rem);
      font-weight: 650;
      line-height: 1.2;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-tertiary, #6b7280);
      cursor: pointer;
      outline: none;
    }

    .close-btn:hover,
    .close-btn:focus-visible {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
      color: var(--mn-color-text-primary, #111827);
    }

    .search {
      flex: 0 0 auto;
      padding: var(--mn-space-3, 12px) var(--mn-space-6, 24px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.08));
    }

    .body {
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-2, 8px);
    }

    .category {
      margin: 0;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px) var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.04em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 38px;
      gap: var(--mn-space-3, 12px);
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .row:hover,
    .row.selected {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
    }

    .row:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: -2px;
    }

    .row:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }

    .label {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-sm, 13px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .keys {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      flex: 0 0 auto;
      gap: var(--mn-space-1, 4px);
    }

    kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 22px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: 0 1px 0 var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1;
      white-space: nowrap;
    }

    .empty {
      padding: var(--mn-space-8, 32px) var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-sm, 13px);
      text-align: center;
    }

    @media (max-width: 640px) {
      :host {
        align-items: flex-end;
        padding: 0;
      }

      .dialog {
        width: 100%;
        max-height: 88dvh;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: var(--mn-radius-lg, 8px) var(--mn-radius-lg, 8px) 0 0;
      }

      .header,
      .search {
        padding-right: var(--mn-space-4, 16px);
        padding-left: var(--mn-space-4, 16px);
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ attribute: false }) commands: readonly MnShortcutCommand[] = []
  @property({ type: String }) dialogTitle = 'Keyboard Shortcuts'
  @property({ type: String }) searchPlaceholder = 'Search shortcuts'
  @property({ type: String }) platform: MnShortcutPlatform = 'auto'

  @state() private query = ''
  @state() private selectedIndex = 0

  @query('mn-search-input') private searchInput?: MnSearchInput

  override connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this.handleDocumentKeydown)
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleDocumentKeydown)
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) {
      this.selectedIndex = 0
      window.setTimeout(() => this.searchInput?.focus(), 0)
    }
    if (changed.has('commands') || changed.has('open')) {
      this.clampSelectedIndex()
    }
  }

  show(): void {
    this.open = true
  }

  hide(): void {
    this.close()
  }

  private filteredRows(): readonly MnShortcutCommand[] {
    const rows = this.commands.filter(command => command.shortcut.trim().length > 0)
    const q = normalize(this.query)
    if (!q) return rows
    return rows.filter((command) => {
      if (normalize(command.label).includes(q)) return true
      if (normalize(command.category).includes(q)) return true
      if (normalize(command.shortcut).includes(q)) return true
      return command.keywords?.some(keyword => normalize(keyword).includes(q)) ?? false
    })
  }

  private groupedRows(rows: readonly MnShortcutCommand[]): ReadonlyArray<readonly [string, MnShortcutCommand[]]> {
    const groups = new Map<string, MnShortcutCommand[]>()
    for (const command of rows) {
      const category = command.category || 'Commands'
      const group = groups.get(category) ?? []
      group.push(command)
      groups.set(category, group)
    }
    return Array.from(groups.entries())
  }

  private clampSelectedIndex(): void {
    const rows = this.filteredRows()
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, rows.length - 1)))
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.query = ''
    this.selectedIndex = 0
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private handleSearch(event: CustomEvent<MnSearchInputDetail>): void {
    this.query = event.detail.value
    this.selectedIndex = 0
  }

  private handleBackdropClick(): void {
    this.close()
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return
    const rows = this.filteredRows()
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, rows.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      this.selectedIndex = 0
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      this.selectedIndex = Math.max(0, rows.length - 1)
      return
    }
    if (event.key === 'Enter') {
      const command = rows[this.selectedIndex]
      if (!command) return
      event.preventDefault()
      this.run(command, event)
    }
  }

  private run(command: MnShortcutCommand, event: MouseEvent | KeyboardEvent): void {
    if (command.disabled) return
    this.open = false
    this.query = ''
    this.selectedIndex = 0
    this.dispatchEvent(
      new CustomEvent<MnShortcutRunDetail>('mn-shortcut-run', {
        detail: {
          id: command.id,
          command,
          modifiers: eventModifiers(event),
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private renderRow(
    command: MnShortcutCommand,
    index: number,
  ) {
    const selected = index === this.selectedIndex
    return html`
      <button
        type="button"
        class=${selected ? 'row selected' : 'row'}
        ?disabled=${Boolean(command.disabled)}
        aria-keyshortcuts=${command.shortcut}
        aria-current=${selected ? 'true' : 'false'}
        @click=${(event: MouseEvent) => this.run(command, event)}
        @mouseenter=${() => { this.selectedIndex = index }}
      >
        <span class="label">${command.label}</span>
        <span class="keys"><kbd>${formatShortcutLabel(command.shortcut, this.platform)}</kbd></span>
      </button>
    `
  }

  override render() {
    const rows = this.filteredRows()
    const grouped = this.groupedRows(rows)
    let index = 0
    const rowParts: TemplateResult[] = []
    for (const [category, commands] of grouped) {
      rowParts.push(html`<h3 class="category">${category}</h3>`)
      for (const command of commands) {
        rowParts.push(this.renderRow(command, index++))
      }
    }
    return html`
      <div class="backdrop" @click=${() => this.handleBackdropClick()}></div>
      <section
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label=${this.dialogTitle}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <header class="header">
          <h2 class="title">${this.dialogTitle}</h2>
          <button type="button" class="close-btn" aria-label="Close" @click=${() => this.close()}>
            ${icon('x', { size: 16 })}
          </button>
        </header>
        <div class="search">
          <mn-search-input
            .value=${this.query}
            .placeholder=${this.searchPlaceholder}
            label=${this.searchPlaceholder}
            @mn-input=${(event: CustomEvent<MnSearchInputDetail>) => this.handleSearch(event)}
          ></mn-search-input>
        </div>
        <div class="body">
          ${rows.length === 0
            ? html`<div class="empty">No shortcuts match${this.query ? html` "${this.query}"` : nothing}</div>`
            : rowParts}
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-shortcuts-dialog': MnShortcutsDialog
  }
}
