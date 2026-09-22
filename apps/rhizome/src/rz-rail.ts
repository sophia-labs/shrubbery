/**
 * rz-rail — the RHIZOME left-rail surface nav (a controlled, островная element).
 *
 * The website-as-RDF frame stamps `<rz-rail>` into the config's left-rail region
 * (region-rail → panel-rail). This module upgrades that inert tag in place (the
 * upgrade seam). It is PURE presentation: it lists the observatory's SURFACES
 * (Plot, Bouquet, Walk, Greenhouse live; Ledger shown disabled = 'soon'), marks the
 * ACTIVE one, and emits a single intent the shell fulfils:
 *   - `rz-surface` detail:{ surface } — a live surface row was selected.
 *   - `rz-graph`   detail:{ graph }   — a different graph was chosen (combobox).
 *
 * Controlled: the shell sets `surface` (the active surface) + `graph`/`graphs` (the
 * loaded graph + the known list); the rail re-renders. The rail owns NO data path —
 * no fetch, no router, no SPARQL (main.ts builds the graph list + does the reload).
 * Icons are the ported @shrubbery/components lucide `icon()` (inline SVG, never an
 * emoji); iconStyles is folded into static styles so the SVG inherits currentColor
 * in Shadow DOM.
 */

import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { icon, iconStyles } from '@shrubbery/components'
import type { Surface } from './router.js'

/** One rail entry — a surface, its icon, and whether it is live yet. */
interface RailEntry {
  readonly surface: Surface | string
  readonly label: string
  readonly glyph: string
  /** A live surface routes; a `false` (soon) entry is disabled. */
  readonly live: boolean
}

/** The surfaces the observatory exposes (live first, then the roadmap). */
const ENTRIES: readonly RailEntry[] = [
  { surface: 'plot', label: 'Plot', glyph: 'sprout', live: true },
  { surface: 'bouquet', label: 'Bouquet', glyph: 'leaf', live: true },
  { surface: 'walk', label: 'Walk', glyph: 'network', live: true },
  { surface: 'greenhouse', label: 'Greenhouse', glyph: 'thermometer', live: true },
  { surface: 'ledger', label: 'Ledger', glyph: 'layers', live: false },
]

@customElement('rz-rail')
export class RzRail extends LitElement {
  /** The active surface (the highlighted row). Controlled by the shell. */
  @property({ type: String }) surface: Surface = 'plot'

  /** The currently-loaded graph id (the combobox value). Controlled by main.ts. */
  @property({ type: String }) graph = ''

  /** The known graph ids (combobox datalist) — cell list ∪ visited recents. */
  @property({ attribute: false }) graphs: readonly string[] = []

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #111);
      background: var(--mn-color-surface-raised, #f9fafb);
      border-right: 1px solid var(--mn-color-border-subtle, #eee);
    }
    .rail {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 8px;
    }
    .rail-head {
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
      color: var(--mn-color-text-muted, #9ca3af);
      padding: 4px 8px 8px;
    }
    .rail-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      font-size: var(--mn-text-sm, 13px);
      text-align: left;
      cursor: pointer;
    }
    .rail-row:hover:not([disabled]) {
      border-color: var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
    }
    .rail-row[aria-current='true'] {
      background: var(--mn-color-surface-accent, #eef2ff);
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-weight: 600;
    }
    .rail-row[disabled] {
      cursor: default;
      opacity: 0.5;
    }
    .rail-label {
      flex: 1;
    }
    .rail-soon {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mn-color-text-muted, #9ca3af);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      border-radius: 999px;
      padding: 1px 6px;
    }
    .rail-graph {
      margin-top: 14px;
      padding: 8px 10px 4px;
      border-top: 1px solid var(--mn-color-border-subtle, #eee);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .graph-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .graph-input {
      flex: 1;
      min-width: 0;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 11px;
      padding: 5px 8px;
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
    }
    .graph-input:focus {
      outline: none;
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .graph-hint {
      font-size: 10px;
      color: var(--mn-color-text-muted, #9ca3af);
    }
    ${unsafeCSS(iconStyles)}
  `

  private _select(entry: RailEntry): void {
    if (!entry.live) return
    this.dispatchEvent(
      new CustomEvent('rz-surface', {
        detail: { surface: entry.surface },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /** A graph was typed/picked in the combobox → ask the shell to load it. */
  private _onGraphChange(e: Event): void {
    const next = (e.target as HTMLInputElement).value.trim()
    if (!next || next === this.graph) return
    this.dispatchEvent(
      new CustomEvent('rz-graph', { detail: { graph: next }, bubbles: true, composed: true }),
    )
  }

  private row(entry: RailEntry): TemplateResult {
    const active = entry.live && entry.surface === this.surface
    return html`
      <button
        class="rail-row"
        data-surface=${entry.surface}
        aria-current=${active ? 'true' : 'false'}
        ?disabled=${!entry.live}
        @click=${() => this._select(entry)}
      >
        <span class="rail-icon">${icon(entry.glyph, { size: 16 })}</span>
        <span class="rail-label">${entry.label}</span>
        ${entry.live ? '' : html`<span class="rail-soon">soon</span>`}
      </button>
    `
  }

  render(): TemplateResult {
    return html`
      <nav class="rail" aria-label="Observatory surfaces">
        <div class="rail-head">Surfaces</div>
        ${ENTRIES.map((e) => html`<div class="rail-row-host">${this.row(e)}</div>`)}
        <div class="rail-graph">
          <label class="rail-head" for="rz-graph-input">Graph</label>
          <div class="graph-row">
            <span class="rail-icon">${icon('graph', { size: 14 })}</span>
            <input
              id="rz-graph-input"
              class="graph-input"
              list="rz-graph-list"
              .value=${this.graph}
              placeholder="graph id…"
              aria-label="loaded graph"
              @change=${(e: Event) => this._onGraphChange(e)}
            />
          </div>
          <datalist id="rz-graph-list">
            ${this.graphs.map((g) => html`<option value=${g}></option>`)}
          </datalist>
          <span class="graph-hint">type or pick — reloads the observatory</span>
        </div>
      </nav>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rz-rail': RzRail
  }
}
