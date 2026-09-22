/**
 * afl-pack — the pack composer: browse the reference web by kind, read its
 * relations, assemble an ordered role-labeled pack, and review the fully
 * composed call before anything spends.
 *
 * Rendered INSIDE afl-director's rail (section 05) — it is app furniture in
 * the director column, not a layout-stamped leaf, so the workspace fossil is
 * untouched. Controlled like every leaf: the orchestrator owns the pack, the
 * review, and all validation; every user intent leaves as a composed event —
 *   afl-pack-add     { id }              afl-pack-remove { index }
 *   afl-pack-move    { index, delta }    afl-pack-preset { preset }
 *   afl-pack-compose                     afl-pack-clear
 * The component performs NO fetches and decides NOTHING.
 *
 * Honesty rules it renders: pending entities (no reference study yet) are
 * visible with a "needs reference study" state and are not addable; embedded
 * riders (the hoodie) are addable but marked as taking no image slot; the
 * review surface shows the exact prompt and reference list dry_run returned.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { styleMap } from 'lit/directives/style-map.js'
import {
  KIND_ORDER,
  embeddedHostOf,
  isPendingEntity,
  type PackRole,
  type WebEntity,
} from '../catalog/reference-web-codec.js'

/** One ordered pack entry, exactly what the server's pack API takes. */
export interface PackDraft {
  readonly role: PackRole
  readonly id: string
}

export interface PackReviewReference {
  readonly role: string
  readonly id: string
  readonly filename: string
}

/** The dry_run result (or its readable failure) as the orchestrator stores it. */
export interface PackReview {
  readonly mode?: string
  readonly references?: readonly PackReviewReference[]
  readonly inputHash?: string
  readonly prompt?: string
  readonly error?: string
}

const RELATION_HINT: Record<string, (target: string) => string> = {
  wears: (target) => `wears ${target}`,
  holds: (target) => `holds ${target}`,
  contains: (target) => `contains ${target}`,
  'variant-of': (target) => `variant of ${target}`,
  'pairs-with': (target) => `pairs with ${target}`,
  'embedded-in': (target) => `rides in ${target}'s plate`,
}

@customElement('afl-pack')
export class AflPack extends LitElement {
  /** The whole web, ready and pending alike. */
  @property({ attribute: false }) entities: readonly WebEntity[] = []
  /** The ordered pack under assembly. */
  @property({ attribute: false }) pack: readonly PackDraft[] = []
  /** The last dry_run composition (null = nothing reviewed for this pack). */
  @property({ attribute: false }) review: PackReview | null = null
  /** Whether a dry_run composition is in flight. */
  @property({ type: Boolean }) composeBusy = false

  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #e8e9f0);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
    }

    .kind-group {
      margin-bottom: var(--mn-space-3, 12px);
    }
    .kind-label {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .kind-label i {
      flex: 1;
      height: 1px;
      background: var(--mn-color-border-subtle, #23242c);
    }

    .entity-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: var(--mn-space-2, 8px);
    }
    .entity-wrap {
      position: relative;
      display: grid;
      min-width: 0;
    }
    .entity-inspect {
      position: absolute;
      top: 5px;
      right: 5px;
      z-index: 1;
      padding: 1px 6px;
      cursor: pointer;
      font: inherit;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.06em;
      color: var(--mn-color-text-tertiary, #6f7280);
      background: var(--mn-color-surface-sunken, #0e0f13);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .entity-inspect:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #7fb1e8));
    }
    .entity-card {
      position: relative;
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: var(--mn-space-2, 8px);
      align-items: start;
      min-width: 0;
      padding: var(--mn-space-2, 8px);
      text-align: left;
      cursor: pointer;
      font: inherit;
      color: inherit;
      background: var(--mn-color-surface-raised, rgba(255, 255, 255, 0.02));
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
      transition: border-color 120ms, background 120ms;
    }
    .entity-card:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.05));
    }
    .entity-card:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #7fb1e8));
      outline-offset: 2px;
    }
    .entity-card:disabled {
      cursor: default;
    }
    .entity-card.is-pending {
      opacity: 0.72;
      border-style: dashed;
    }
    .entity-card.is-in-pack {
      border-color: var(--entity-accent);
      background: color-mix(in srgb, var(--entity-accent) 9%, transparent);
    }
    .entity-card img,
    .entity-card .swatch {
      display: block;
      width: 36px;
      height: 36px;
      object-fit: cover;
      border-radius: var(--mn-radius-sm, 3px);
    }
    .entity-card .swatch {
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--entity-accent) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--entity-accent) 45%, transparent);
      color: var(--entity-accent);
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.06em;
    }
    .entity-card strong {
      display: block;
      margin-bottom: 2px;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
    }
    .entity-card small {
      display: block;
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.35;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .hints {
      margin-top: 3px;
      font-style: italic;
      color: var(--mn-color-text-tertiary, #6f7280);
    }
    .badge {
      display: inline-block;
      margin-top: 4px;
      padding: 1px 6px;
      font-size: var(--mn-text-2xs, 10px);
      font-style: normal;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mn-color-warning, #d98d3a);
      border: 1px solid color-mix(in srgb, var(--mn-color-warning, #d98d3a) 55%, transparent);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .badge.rider {
      color: var(--mn-color-text-muted, #8b8e9c);
      border-color: var(--mn-color-border-strong, #4a4d5a);
    }

    .tray {
      margin: var(--mn-space-3, 12px) 0;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }
    .tray-empty {
      padding: var(--mn-space-3, 12px);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .tray ol {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tray li {
      display: grid;
      grid-template-columns: auto auto 1fr auto;
      gap: var(--mn-space-2, 8px);
      align-items: center;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #23242c);
      font-size: var(--mn-text-xs, 12px);
    }
    .tray li:last-child {
      border-bottom: 0;
    }
    .tray .slot {
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .tray .role {
      padding: 1px 6px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--entity-accent, var(--mn-color-text-secondary, #b9bcc8));
      border: 1px solid color-mix(in srgb, var(--entity-accent, #8b8e9c) 55%, transparent);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .tray .who {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tray .who em {
      font-style: normal;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #6f7280);
    }
    .tray .controls {
      display: flex;
      gap: 4px;
    }
    .tray .controls button {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      padding: 0;
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-secondary, #b9bcc8);
      background: transparent;
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .tray .controls button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.05));
    }
    .tray .controls button:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .actions {
      display: flex;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
    }
    .actions mn-button:first-child {
      flex: 1;
    }

    .review {
      padding: var(--mn-space-3, 12px);
      background: var(--mn-color-surface-sunken, #0e0f13);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
    }
    .review-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    .review-head code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      text-transform: none;
      letter-spacing: 0;
      color: var(--mn-color-text-tertiary, #9a9daa);
    }
    .review ol {
      margin: 0 0 var(--mn-space-2, 8px);
      padding-left: var(--mn-space-4, 16px);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.6;
      color: var(--mn-color-text-secondary, #b9bcc8);
    }
    .review pre {
      max-height: 300px;
      margin: 0;
      padding: var(--mn-space-2, 8px);
      overflow: auto;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.55;
      white-space: pre-wrap;
      color: var(--mn-color-text-secondary, #b9bcc8);
      background: var(--mn-color-surface-canvas, #101014);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-sm, 3px);
    }
    .review .spend-note {
      margin: var(--mn-space-2, 8px) 0 0;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-success, #52a37c);
    }
    .review .error {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-danger, #d97b7b);
    }
  `

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private entityById(id: string): WebEntity | undefined {
    return this.entities.find((entity) => entity.id === id)
  }

  private hintsFor(entity: WebEntity): string {
    return entity.relations
      .map((relation) => {
        const target = this.entityById(relation.target)
        return RELATION_HINT[relation.kind]?.(target?.name ?? relation.target)
      })
      .filter((hint): hint is string => hint !== undefined)
      .join(' · ')
  }

  private entityCard(entity: WebEntity): TemplateResult {
    const pending = isPendingEntity(entity)
    const inPack = this.pack.some((entry) => entry.id === entity.id)
    const rider = embeddedHostOf(entity) !== undefined
    const hints = this.hintsFor(entity)
    return html`<div class="entity-wrap">
      <button
        type="button"
        class=${classMap({ 'entity-card': true, 'is-pending': pending, 'is-in-pack': inPack })}
        data-entity-id=${entity.id}
        style=${styleMap({ '--entity-accent': entity.accent })}
        ?disabled=${pending || inPack}
        title=${pending ? `${entity.name} needs a reference study before it can join a pack` : entity.name}
        @click=${() => this.emit('afl-pack-add', { id: entity.id })}
      >
        ${entity.thumbnail
          ? html`<img src=${entity.thumbnail} alt=${entity.name} />`
          : html`<span class="swatch" aria-hidden="true">${entity.kind.slice(0, 3)}</span>`}
        <span>
          <strong>${entity.name}</strong>
          <small>${entity.description}</small>
          ${hints ? html`<small class="hints">${hints}</small>` : nothing}
          ${pending
            ? html`<span class="badge">needs reference study</span>`
            : rider
              ? html`<span class="badge rider">rider · no image slot</span>`
              : nothing}
        </span>
      </button>
      <button
        type="button"
        class="entity-inspect"
        data-entity-id=${entity.id}
        title=${`Inspect ${entity.name} — study, language, and the runs that used it`}
        aria-label=${`Inspect ${entity.name}`}
        @click=${(event: Event) => {
          event.stopPropagation()
          this.emit('afl-entity-inspect', { id: entity.id })
        }}
      >
        study
      </button>
    </div>`
  }

  private trayRow(entry: PackDraft, index: number): TemplateResult {
    const entity = this.entityById(entry.id)
    const rider = entity !== undefined && embeddedHostOf(entity) !== undefined
    return html`<li data-pack-index=${index} style=${styleMap({ '--entity-accent': entity?.accent ?? '' })}>
      <span class="slot">${String(index + 1).padStart(2, '0')}</span>
      <span class="role">${entry.role}</span>
      <span class="who">
        ${entity?.name ?? entry.id}
        ${rider ? html` <em>· rider — no image slot</em>` : nothing}
      </span>
      <span class="controls">
        <button
          type="button"
          aria-label="Move up"
          ?disabled=${index === 0}
          @click=${() => this.emit('afl-pack-move', { index, delta: -1 })}
        >↑</button>
        <button
          type="button"
          aria-label="Move down"
          ?disabled=${index === this.pack.length - 1}
          @click=${() => this.emit('afl-pack-move', { index, delta: 1 })}
        >↓</button>
        <button
          type="button"
          aria-label="Remove"
          @click=${() => this.emit('afl-pack-remove', { index })}
        >×</button>
      </span>
    </li>`
  }

  render(): TemplateResult {
    const kinds = KIND_ORDER.filter((kind) => this.entities.some((entity) => entity.kind === kind))
    const review = this.review
    return html`
      <div class="presets">
        <mn-button
          id="preset-cactus"
          variant="secondary"
          size="xs"
          label="cactus story"
          @click=${() => this.emit('afl-pack-preset', { preset: 'cactus' })}
        ></mn-button>
        <mn-button
          id="preset-moon"
          variant="secondary"
          size="xs"
          label="moon story"
          @click=${() => this.emit('afl-pack-preset', { preset: 'moon' })}
        ></mn-button>
        ${this.pack.length > 0
          ? html`<mn-button
              id="pack-clear"
              variant="ghost"
              size="xs"
              label="clear pack"
              @click=${() => this.emit('afl-pack-clear')}
            ></mn-button>`
          : nothing}
      </div>

      ${kinds.map(
        (kind) => html`<div class="kind-group" data-kind=${kind}>
          <div class="kind-label">
            <span>${kind}</span>
            <i></i>
            <span>${this.entities.filter((entity) => entity.kind === kind).length}</span>
          </div>
          <div class="entity-grid">
            ${this.entities.filter((entity) => entity.kind === kind).map((entity) => this.entityCard(entity))}
          </div>
        </div>`,
      )}

      <div class="tray" id="pack-tray">
        ${this.pack.length === 0
          ? html`<p class="tray-empty">
              The pack is empty — the legacy three-reference flow is in effect. Add entities or
              take a preset to compose a richer call.
            </p>`
          : html`<ol>
              ${this.pack.map((entry, index) => this.trayRow(entry, index))}
            </ol>`}
      </div>

      <div class="actions">
        <mn-button
          id="pack-compose"
          variant="secondary"
          size="md"
          .label=${this.composeBusy ? 'Composing…' : 'Compose (review before spend)'}
          ?disabled=${this.pack.length === 0 || this.composeBusy}
          ?loading=${this.composeBusy}
          @click=${() => this.emit('afl-pack-compose')}
        ></mn-button>
      </div>

      ${review
        ? html`<div class="review" id="pack-review">
            ${review.error
              ? html`<p class="error" id="pack-review-error">${review.error}</p>`
              : html`
                  <div class="review-head">
                    <span>composed call · ${review.mode}</span>
                    <code>input:${review.inputHash}</code>
                  </div>
                  <ol id="pack-review-references">
                    ${(review.references ?? []).map(
                      (reference) => html`<li>${reference.role} · ${reference.id} · ${reference.filename}</li>`,
                    )}
                  </ol>
                  <pre id="pack-review-prompt">${review.prompt}</pre>
                  <p class="spend-note">
                    Reviewed — “Direct this story” now spends on exactly this call.
                  </p>
                `}
          </div>`
        : nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'afl-pack': AflPack
  }
}
