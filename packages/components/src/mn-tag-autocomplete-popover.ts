/**
 * mn-tag-autocomplete-popover -- pure visual list for tag autocomplete.
 *
 * Receives already-filtered suggestions and a controlled selected index. It owns
 * no lookup, insertion, editor range, or scheduling logic.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

export interface MnTagSuggestion {
  readonly name: string
  readonly description?: string
  readonly isCore?: boolean
}

export interface MnTagAutocompleteSelectDetail {
  readonly index: number
  readonly item: MnTagSuggestion
}

export type MnTagAutocompleteHoverDetail = MnTagAutocompleteSelectDetail

const CORE_TAG_CLASSES: Record<string, string> = {
  event: 'core-event',
  todo: 'core-todo',
  decision: 'core-decision',
  tension: 'core-tension',
  pragma: 'core-pragma',
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^#/, '').toLowerCase() : ''
}

@customElement('mn-tag-autocomplete-popover')
export class MnTagAutocompletePopover extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      min-width: var(--mn-tag-autocomplete-min-width, 220px);
      max-width: var(--mn-tag-autocomplete-max-width, 320px);
      max-height: var(--mn-tag-autocomplete-max-height, 280px);
      overflow-y: auto;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.4;
    }

    :host([data-skin='emporium']) {
      border-radius: var(--mn-radius-surface, 4px);
    }

    .empty {
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-style: italic;
    }

    .items {
      display: block;
    }

    .item {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      padding: 6px var(--mn-space-2, 10px);
      border-left: 2px solid transparent;
      cursor: pointer;
      user-select: none;
    }

    .item:hover {
      background: var(--mn-color-surface-hover, #f9fafb);
    }

    .item.selected {
      border-left-color: var(--mn-color-border-accent, var(--mn-color-accent, #6366f1));
      background: var(--mn-color-surface-accent, #eef2ff);
    }

    .item.core-event {
      border-left-color: var(--mn-color-border-accent, #a5b4fc);
    }
    .item.core-todo {
      border-left-color: var(--mn-color-warning-border, #fcd34d);
    }
    .item.core-decision {
      border-left-color: var(--mn-color-success-border, #6ee7b7);
    }
    .item.core-tension {
      border-left-color: var(--mn-color-danger-border, #fca5a5);
    }
    .item.core-pragma {
      border-left-color: var(--mn-color-border-subtle, #d1d5db);
    }

    .name {
      flex: 0 0 auto;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 500;
    }

    .name::before {
      content: '#';
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-weight: 400;
    }

    .description {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hint {
      display: flex;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 10px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-size: var(--mn-text-2xs, 11px);
    }

    .hint kbd {
      padding: 1px 4px;
      border-radius: var(--mn-radius-sm, 3px);
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 10px;
    }
  `

  @property({ attribute: false }) items: readonly MnTagSuggestion[] = []
  @property({ type: Number }) selectedIndex = 0

  private emitItem(
    type: 'mn-tag-autocomplete-select' | 'mn-tag-autocomplete-hover',
    index: number,
    item: MnTagSuggestion,
  ): void {
    this.dispatchEvent(
      new CustomEvent<MnTagAutocompleteSelectDetail>(type, {
        detail: { index, item },
        bubbles: true,
        composed: true,
      }),
    )
  }

  override render() {
    if (this.items.length === 0) {
      return html`<div class="empty">No matching tags</div>`
    }
    return html`
      <div class="items" role="listbox">
        ${this.items.map(
          (item, index) => {
            const name = normalizeName(item.name)
            const coreClass = CORE_TAG_CLASSES[name]
            const classes: Record<string, boolean> = {
              item: true,
              selected: index === this.selectedIndex,
            }
            if (coreClass) classes[coreClass] = true
            return html`
              <div
                class=${classMap(classes)}
                role="option"
                aria-selected=${String(index === this.selectedIndex)}
                data-tag-candidate
                data-tag-name=${name}
                @mousedown=${(event: MouseEvent) => {
                  event.preventDefault()
                  this.emitItem('mn-tag-autocomplete-select', index, item)
                }}
                @mouseenter=${() => this.emitItem('mn-tag-autocomplete-hover', index, item)}
              >
                <span class="name">${name}</span>
                ${item.description ? html`<span class="description">${item.description}</span>` : nothing}
              </div>
            `
          },
        )}
      </div>
      <div class="hint" aria-hidden="true">
        <span><kbd>Enter</kbd> insert</span>
        <span><kbd>Tab</kbd> insert + date</span>
        <span><kbd>Esc</kbd> dismiss</span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-tag-autocomplete-popover': MnTagAutocompletePopover
  }
}
