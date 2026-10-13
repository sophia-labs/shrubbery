/**
 * av-rail.ts — `<av-rail>`: the left navigation rail.
 *
 * A CONTROLLED element in the house style: it owns no data and mutates no
 * inbound prop. `renderWorkspace` stamps it as a bare `<av-rail></av-rail>` (the
 * interpreter binds nothing to app-owned tags), the shell pushes `sections` /
 * `selectedId` / `status` onto it after the render, and it emits `av-navigate`
 * back. That is the same shape `@shrubbery/components` elements use, which is
 * why it composes with them without a single bespoke button style: every row is
 * an `mn-button`, every count an `mn-badge`, every group an `mn-panel-header`.
 *
 * Sections come from the graph (routes.ts's `railSections`), so a library with
 * no renders grows no Renders group — absence is absence.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@shrubbery/components'
import type { RailSection } from '../shell/routes.js'

export type RailStatus = 'loading' | 'ready' | 'error'

@customElement('av-rail')
export class AvRail extends LitElement {
  /** Graph-derived groups. Empty + status 'ready' is a real, labeled state. */
  @property({ attribute: false }) sections: readonly RailSection[] = []
  @property({ type: String }) selectedId = ''
  @property({ type: String }) status: RailStatus = 'loading'

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #fff));
      border-right: var(--mn-rule-line, 1px solid var(--mn-color-border-subtle, #e5e7eb));
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      /* --mn-label-display is the skin flag that hides CONTROL labels in the
         icon-only identities (98, emporium): a toolbar button keeps its glyph
         and drops its caption. A navigation list is not that — a rail of voice
         names with no names is an empty rail — so this region opts the flag
         back on. Scoped to :host, so it never leaks into the chrome. */
      --mn-label-display: inline;
    }
    .scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding-bottom: var(--mn-space-4, 1rem);
    }
    .group + .group {
      margin-top: var(--mn-space-3, 0.75rem);
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-0-5, 0.125rem);
      padding: var(--mn-space-1, 0.25rem) var(--mn-space-2, 0.5rem);
    }
    .row {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 0.5rem);
      width: 100%;
    }
    .row-label {
      flex: 1 1 auto;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-hint {
      flex: 0 0 auto;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #6b7280);
      font-variant-numeric: tabular-nums;
    }
    .state {
      padding: var(--mn-space-3, 0.75rem);
    }
  `

  private _navigate(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>('av-navigate', {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _renderItems(section: RailSection): TemplateResult {
    return html`<div class="items" role="list">
      ${section.items.map(
        (item) => html`<mn-button
          role="listitem"
          variant="ghost"
          size="sm"
          block
          .label=${null}
          .pressed=${item.id === this.selectedId}
          data-route=${item.id}
          @click=${() => this._navigate(item.id)}
        >
          <span class="row">
            <span class="row-label">${item.label}</span>
            ${item.hint === undefined ? nothing : html`<span class="row-hint">${item.hint}</span>`}
            ${item.count === undefined
              ? nothing
              : html`<mn-badge size="sm" .label=${String(item.count)}></mn-badge>`}
          </span>
        </mn-button>`,
      )}
    </div>`
  }

  render(): TemplateResult {
    if (this.status === 'loading') {
      return html`<div class="state"><mn-loading variant="dots" size="sm" text="reading the library graph…"></mn-loading></div>`
    }
    if (this.status === 'error') {
      // The rail stays INERT and labeled rather than showing a plausible tree.
      return html`<div class="state">
        <mn-empty-state
          icon="alert-triangle"
          mood="danger"
          variant="compact"
          title="Library unavailable"
          description="The read seam reported an error; see the transport strip."
        ></mn-empty-state>
      </div>`
    }
    if (this.sections.length === 0) {
      return html`<div class="state">
        <mn-empty-state
          icon="inbox"
          variant="compact"
          title="Empty library"
          description="The graph parsed, but declares no voices or material."
        ></mn-empty-state>
      </div>`
    }
    return html`<div class="scroll">
      ${this.sections.map(
        (section) => html`<div class="group">
          <mn-panel-header .title=${section.label} .count=${section.items.length}></mn-panel-header>
          ${this._renderItems(section)}
        </div>`,
      )}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'av-rail': AvRail
  }
}
