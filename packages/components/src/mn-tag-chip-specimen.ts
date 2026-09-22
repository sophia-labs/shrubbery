/**
 * mn-tag-chip-specimen -- visual specimen for Garden inline tag-chip atoms.
 *
 * This is deliberately UI-only. The editor kernel owns the TipTap atom and
 * runtime owns navigation/side effects; this component renders the same inline
 * chip visual Garden uses for node views and catalog previews.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

export interface MnTagChipSpecimenAttrs {
  /** Lowercase tag name without leading "#". */
  name: string
  /** Optional ISO calendar date YYYY-MM-DD. Null = no date. */
  date: string | null
}

export function defaultTagChipSpecimenAttrs(): MnTagChipSpecimenAttrs {
  return { name: '', date: null }
}

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

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

@customElement('mn-tag-chip-specimen')
export class MnTagChipSpecimen extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline;
      vertical-align: baseline;
      font-family: var(--mn-font-editor, var(--mn-font-sans, system-ui, sans-serif));
    }

    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 0.15em;
      margin: 0 0.1em;
      padding: 0.05em 0.4em;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-secondary, #374151);
      font-size: 0.85em;
      line-height: 1.4;
      white-space: nowrap;
      user-select: none;
    }

    .chip.selected {
      box-shadow: 0 0 0 2px var(--mn-color-border-accent, var(--mn-color-accent, #6366f1));
    }

    .chip.core-event {
      border-color: var(--mn-color-border-accent, #c7d2fe);
      background: var(--mn-color-surface-accent, #eef2ff);
      color: var(--mn-color-text-accent-strong, #4338ca);
    }

    .chip.core-todo {
      border-color: var(--mn-color-warning-border, #fde68a);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
    }

    .chip.core-decision {
      border-color: var(--mn-color-success-border, #a7f3d0);
      background: var(--mn-color-success-surface, #ecfdf5);
      color: var(--mn-color-success-strong, #065f46);
    }

    .chip.core-tension {
      border-color: var(--mn-color-danger-border, #fecaca);
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger-strong, #b91c1c);
    }

    .chip.core-pragma {
      border-color: var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-base, #f9fafb);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    :host([data-skin='emporium']) .chip {
      border-radius: var(--mn-radius-surface, 4px);
    }

    .name {
      font-weight: 500;
    }

    .date {
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
      opacity: 0.65;
    }
  `

  @property({ attribute: false }) attrs: MnTagChipSpecimenAttrs = defaultTagChipSpecimenAttrs()
  @property({ type: String }) name = ''
  @property({ type: String }) date: string | null = null
  @property({ type: Boolean, reflect: true }) selected = false

  override render() {
    const name = normalizeName(this.attrs.name || this.name)
    const date = normalizeDate(this.attrs.date ?? this.date)
    const coreClass = CORE_TAG_CLASSES[name]
    const classes: Record<string, boolean> = {
      chip: true,
      selected: this.selected,
    }
    if (coreClass) classes[coreClass] = true

    return html`
      <span class=${classMap(classes)} part="chip">
        <span class="name" part="name">#${name}</span>
        ${date ? html`<span class="date" part="date">${date}</span>` : nothing}
      </span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-tag-chip-specimen': MnTagChipSpecimen
  }
}
