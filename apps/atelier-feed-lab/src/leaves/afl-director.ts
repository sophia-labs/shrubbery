/**
 * afl-director — the sequence-director leaf: performer, prop, scenery, the
 * reference-web pack composer (afl-pack, section 04), story impulse, and the
 * direct affordance.
 *
 * Stamped by the workspace frame from layout DATA (panel-director →
 * renderedByComponent 'afl-director'). Controlled: the orchestrator sets
 * selection/impulse/take/busy plus the web/pack/review props it passes
 * through to afl-pack; every user intent leaves as a composed event —
 *   afl-select-prop  { assetId }   afl-select-scene { assetId }
 *   afl-direction    { value }     afl-direct       (button or ⌘/Ctrl+Enter)
 *   afl-pack-*       (composed up from afl-pack, unhandled here)
 * The component owns NO pipeline state and performs NO fetches. When a pack
 * is assembled, the direct affordance gates on a fresh dry_run review —
 * review-before-spend is structural, not advisory.
 *
 * Composes @shrubbery/components primitives (mn-card, mn-chip, mn-textarea,
 * mn-button) over the token vocabulary; the asset accent is the one per-asset
 * color, carried as a CSS custom property exactly like the original.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { styleMap } from 'lit/directives/style-map.js'
import type { WebEntity } from '../catalog/reference-web-codec.js'
import './afl-pack.js'
import type { PackDraft, PackReview } from './afl-pack.js'

@customElement('afl-director')
export class AflDirector extends LitElement {
  /** The fixed performer reference. */
  @property({ attribute: false }) character: WebEntity | null = null
  /** The prop choices (image 2). */
  @property({ attribute: false }) propAssets: readonly WebEntity[] = []
  /** The scenery choices (image 3). */
  @property({ attribute: false }) sceneAssets: readonly WebEntity[] = []
  @property({ type: String }) selectedPropId = ''
  @property({ type: String }) selectedSceneId = ''
  /** The story impulse (natural language). */
  @property({ type: String }) direction = ''
  /** The 1-based take counter. */
  @property({ type: Number }) take = 1
  /** Whether a story is currently generating (disables the direct affordance). */
  @property({ type: Boolean }) busy = false

  // ── Pass-through props for the pack composer (afl-pack owns none of them) ──
  /** The full reference web, ready and pending entities alike. */
  @property({ attribute: false }) webEntities: readonly WebEntity[] = []
  /** The ordered pack under assembly (empty = legacy three-reference flow). */
  @property({ attribute: false }) pack: readonly PackDraft[] = []
  /** The latest dry_run review for the current pack (null = not reviewed). */
  @property({ attribute: false }) packReview: PackReview | null = null
  /** Whether a dry_run composition is in flight. */
  @property({ type: Boolean }) composeBusy = false

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow-y: auto;
      box-sizing: border-box;
      padding: var(--mn-space-5, 20px) var(--mn-space-5, 20px) var(--mn-space-6, 24px);
      background: var(--mn-color-surface-panel, #16171d);
      border-left: 1px solid var(--mn-color-border-subtle, #23242c);
      color: var(--mn-color-text-primary, #e8e9f0);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      margin-bottom: var(--mn-space-5, 20px);
    }
    .eyebrow {
      display: block;
      margin-bottom: var(--mn-space-2, 8px);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    h1 {
      margin: 0;
      font-family: var(--mn-font-display, Georgia, serif);
      font-weight: 420;
      font-size: clamp(24px, 2vw, 32px);
      line-height: 1.05;
      color: var(--mn-color-text-title, inherit);
    }

    section {
      padding: var(--mn-space-4, 16px) 0;
      border-top: 1px solid var(--mn-color-border-subtle, #23242c);
    }
    .section-label {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
    }
    .section-label span {
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .section-label h2 {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .section-label em {
      margin-left: auto;
      font-size: var(--mn-text-2xs, 10px);
      font-style: normal;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #8b8e9c);
    }

    .performer {
      display: grid;
      grid-template-columns: 72px 1fr;
      gap: var(--mn-space-3, 12px);
      align-items: center;
    }
    .seal {
      position: relative;
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-accent, var(--mn-color-accent, #7fb1e8));
      border-radius: var(--mn-radius-control, 4px);
      background: repeating-linear-gradient(
        135deg,
        var(--mn-color-surface-raised, #22242d) 0 8px,
        var(--mn-color-surface-sunken, #14151a) 8px 16px
      );
      color: var(--mn-color-text-secondary, #b9bcc8);
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 11px);
      letter-spacing: 0.14em;
    }
    .seal::before {
      content: '';
      position: absolute;
      inset: 10px;
      border: 1px solid var(--mn-color-border-default, #2a2c36);
      border-radius: 50%;
    }
    .performer-name {
      font-family: var(--mn-font-display, Georgia, serif);
      font-size: var(--mn-text-md, 17px);
      font-weight: 460;
    }
    .performer-desc {
      margin: 3px 0 6px;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .performer code,
    .privacy {
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #6f7280);
    }
    .performer code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .privacy {
      margin: var(--mn-space-2, 8px) 2px 0;
      line-height: 1.45;
    }

    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--mn-space-2, 8px);
    }
    .asset-card {
      position: relative;
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: var(--mn-space-2, 8px);
      align-items: center;
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
    .asset-card:hover {
      background: var(--mn-color-surface-hover, rgba(255, 255, 255, 0.05));
    }
    .asset-card:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #7fb1e8));
      outline-offset: 2px;
    }
    .asset-card.is-selected {
      border-color: var(--asset-accent);
      background: color-mix(in srgb, var(--asset-accent) 9%, transparent);
    }
    .asset-card img {
      display: block;
      width: 44px;
      height: 44px;
      object-fit: cover;
      border-radius: var(--mn-radius-sm, 3px);
    }
    .asset-card strong {
      display: block;
      margin-bottom: 2px;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
    }
    .asset-card small {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.35;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .asset-card i {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 7px;
      height: 7px;
      border: 1px solid var(--mn-color-border-strong, #4a4d5a);
      border-radius: 50%;
    }
    .asset-card.is-selected i {
      border-color: var(--asset-accent);
      background: var(--asset-accent);
      box-shadow: 0 0 8px var(--asset-accent);
    }

    .impulse mn-textarea {
      display: block;
      margin-bottom: var(--mn-space-3, 12px);
    }
    .impulse mn-button {
      width: 100%;
    }
    .spend-gate {
      margin: var(--mn-space-2, 8px) 2px 0;
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.45;
      color: var(--mn-color-warning, #d98d3a);
    }
  `

  /** True while an assembled pack lacks a fresh dry_run review — the direct
   *  affordance stays closed until the call has been read. */
  private get packAwaitsReview(): boolean {
    return this.pack.length > 0 && (this.packReview === null || this.packReview.error !== undefined)
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private onDirectionKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') this.emit('afl-direct')
  }

  private optionsFor(
    assets: readonly WebEntity[],
    selectedId: string,
    intent: 'afl-select-prop' | 'afl-select-scene',
  ): TemplateResult {
    return html`<div class="options">
      ${assets.map(
        (asset) => html`<button
          type="button"
          class=${classMap({ 'asset-card': true, 'is-selected': asset.id === selectedId })}
          data-asset-id=${asset.id}
          style=${styleMap({ '--asset-accent': asset.accent })}
          @click=${() => this.emit(intent, { assetId: asset.id })}
        >
          <img src=${asset.thumbnail ?? ''} alt=${asset.name} />
          <span>
            <strong>${asset.name}</strong>
            <small>${asset.description}</small>
          </span>
          <i></i>
        </button>`,
      )}
    </div>`
  }

  render(): TemplateResult {
    const take = `take ${String(this.take).padStart(2, '0')}`
    return html`
      <div class="heading">
        <div>
          <span class="eyebrow">sequence director</span>
          <h1>Direct a<br />small story.</h1>
        </div>
        <mn-chip id="request-count" tone="muted">${take}</mn-chip>
      </div>

      <section>
        <div class="section-label"><span>01</span><h2>Performer</h2><em>fixed reference</em></div>
        <div class="performer">
          <div class="seal" aria-hidden="true"><span>VRM</span></div>
          <div>
            <div class="performer-name">${this.character?.name ?? ''}</div>
            <p class="performer-desc">${this.character?.description ?? ''}</p>
            <code>${this.character?.id ?? ''}</code>
          </div>
        </div>
        <p class="privacy">
          Source pixels stay behind the local server. Seedance receives only the artistic frame
          generated from them.
        </p>
      </section>

      <section>
        <div class="section-label"><span>02</span><h2>Prop</h2><em>image 2</em></div>
        ${this.optionsFor(this.propAssets, this.selectedPropId, 'afl-select-prop')}
      </section>

      <section>
        <div class="section-label"><span>03</span><h2>Scenery</h2><em>image 3</em></div>
        ${this.optionsFor(this.sceneAssets, this.selectedSceneId, 'afl-select-scene')}
      </section>

      <section>
        <div class="section-label"><span>04</span><h2>Reference web</h2><em>pack composer</em></div>
        <afl-pack
          .entities=${this.webEntities}
          .pack=${this.pack}
          .review=${this.packReview}
          ?composeBusy=${this.composeBusy}
        ></afl-pack>
      </section>

      <section class="impulse">
        <div class="section-label"><span>05</span><h2>Story impulse</h2><em>natural language</em></div>
        <mn-textarea
          id="direction"
          rows="5"
          .value=${this.direction}
          @mn-input=${(event: CustomEvent<{ value: string }>) =>
            this.emit('afl-direction', { value: event.detail.value })}
          @keydown=${this.onDirectionKeydown}
        ></mn-textarea>
        <mn-button
          id="direct-shot"
          variant="primary"
          size="lg"
          block
          .label=${this.busy
            ? 'Generating…'
            : this.pack.length > 0
              ? `Direct this story · pack of ${this.pack.length}`
              : 'Direct this story'}
          shortcut="⌘ ↵"
          ?disabled=${this.busy || this.packAwaitsReview}
          ?loading=${this.busy}
          @click=${() => this.emit('afl-direct')}
        ></mn-button>
        ${this.packAwaitsReview
          ? html`<p class="spend-gate" id="spend-gate">
              A pack is assembled — compose it to review the full call before anything spends.
            </p>`
          : nothing}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'afl-director': AflDirector
  }
}
