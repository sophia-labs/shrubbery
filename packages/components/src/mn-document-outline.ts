/**
 * mn-document-outline — controlled left-rail table-of-contents + structural
 * outliner controls for the currently open document.
 *
 * Pure projection: the shell computes `headings`/`activeHeadingId` from the
 * live editor's LiveEditorHandle.getHeadings()/getCurrentHeadingId() (plus
 * the mn-editor-heading-in-view-change event for live scroll-position
 * highlighting) and passes them in as controlled props — this component
 * owns no editor/document state itself. Clicking a heading emits
 * `mn-outline-navigate`; clicking one of the structural commands (collapse/
 * expand/zoom/move/select — relocated here from the editor toolbar's old
 * "Outliner" button group) emits `mn-outline-command`. No stores, no
 * backend calls.
 */

import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { iconStyles, type IconName } from './icons.js'
import './mn-empty-state.js'
import './mn-icon-button.js'

export interface MnDocumentOutlineHeading {
  readonly id: string
  readonly level: number
  readonly text: string
}

export type MnOutlineCommand =
  | 'toggleCollapse'
  | 'collapseAll'
  | 'expandAll'
  | 'moveUp'
  | 'moveDown'
  | 'selectParent'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'

export interface MnOutlineNavigateDetail {
  readonly blockId: string
}

export interface MnOutlineCommandDetail {
  readonly command: MnOutlineCommand
}

interface CommandSpec {
  readonly command: MnOutlineCommand
  readonly icon: IconName
  readonly label: string
  readonly shortcut?: string
}

/** Same commands, icons, labels, and shortcuts the editor toolbar's removed "Outliner" group used. */
const COMMANDS: readonly CommandSpec[] = [
  { command: 'toggleCollapse', icon: 'chevron-right', label: 'Toggle fold', shortcut: 'Mod+.' },
  { command: 'collapseAll', icon: 'panel-left', label: 'Collapse all' },
  { command: 'expandAll', icon: 'chevron-down', label: 'Expand all' },
  { command: 'moveUp', icon: 'arrow-up', label: 'Move block up', shortcut: 'Alt+Shift+Up' },
  { command: 'moveDown', icon: 'arrow-down', label: 'Move block down', shortcut: 'Alt+Shift+Down' },
  { command: 'selectParent', icon: 'corner-up-right', label: 'Select parent block' },
  { command: 'selectAll', icon: 'list', label: 'Select all blocks' },
  { command: 'zoomIn', icon: 'arrow-right', label: 'Zoom into block', shortcut: 'Mod+Shift+Right' },
  { command: 'zoomOut', icon: 'arrow-left', label: 'Zoom out', shortcut: 'Mod+Shift+Left' },
]

@customElement('mn-document-outline')
export class MnDocumentOutline extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      box-sizing: border-box;
    }

    .commands {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      flex: 0 0 auto;
    }

    .headings {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-2, 8px) 0;
    }

    .heading-entry {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: left;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #536159);
      font: inherit;
      padding-block: 4px;
      padding-inline-end: var(--mn-space-3, 12px);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .heading-entry:hover {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.04));
    }

    .heading-entry[aria-current='true'] {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-selected, rgba(77, 135, 104, 0.12));
      font-weight: 600;
    }

    .body {
      display: contents;
    }

    .empty-state {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
    }
  `

  @property({ attribute: false }) headings: readonly MnDocumentOutlineHeading[] = []
  @property({ attribute: false }) activeHeadingId: string | null = null
  @property({ type: Boolean, attribute: 'document-open' }) documentOpen = false

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }))
  }

  private _navigate(blockId: string): void {
    this._emit<MnOutlineNavigateDetail>('mn-outline-navigate', { blockId })
  }

  private _runCommand(command: MnOutlineCommand): void {
    this._emit<MnOutlineCommandDetail>('mn-outline-command', { command })
  }

  protected override render(): TemplateResult {
    return html`
      <div class="commands" role="toolbar" aria-label="Outliner commands">
        ${COMMANDS.map((spec) => html`
          <mn-icon-button
            data-outline-command=${spec.command}
            .icon=${spec.icon}
            .label=${spec.label}
            .shortcut=${spec.shortcut ?? null}
            .size=${'sm'}
            .disabled=${!this.documentOpen}
            .keepFocus=${true}
            @click=${() => this._runCommand(spec.command)}
          ></mn-icon-button>
        `)}
      </div>
      <div class="body">${this._renderBody()}</div>
    `
  }

  private _renderBody(): TemplateResult {
    if (!this.documentOpen) {
      return html`
        <div class="empty-state">
          <mn-empty-state
            icon="file-text"
            title="No document open"
            description="Open a document to see its outline."
          ></mn-empty-state>
        </div>
      `
    }
    if (this.headings.length === 0) {
      return html`
        <div class="empty-state">
          <mn-empty-state
            icon="list"
            title="No headings yet"
            description="Headings you add will show up here."
          ></mn-empty-state>
        </div>
      `
    }
    return html`
      <div class="headings" role="tree" aria-label="Document outline">
        ${this.headings.map((h) => html`
          <button
            type="button"
            class="heading-entry"
            style="padding-inline-start: calc(${h.level - 1} * 12px + var(--mn-space-3, 12px))"
            data-heading-id=${h.id}
            aria-current=${h.id === this.activeHeadingId ? 'true' : 'false'}
            title=${h.text}
            @click=${() => this._navigate(h.id)}
          >${h.text || 'Untitled'}</button>
        `)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-document-outline': MnDocumentOutline
  }
}
