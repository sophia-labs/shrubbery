/**
 * mn-card — a GENERAL, skin-aware, token-driven catalogue surface (a framed card
 * with header / body / footer slots).
 *
 * NOT lifted from a single garden primitive — it GENERALIZES the card markup the
 * Shrubbery catalog grid was hand-rolling inline (apps/storybook/stories/
 * catalog.stories.ts: every catalog entry was a hand-built <article> with the
 * same border / radius / surface / footer-rule treatment repeated per call). That
 * is exactly the "generalize a component that helps a catalogue (cards/rows)"
 * brief: a catalogue row/card surface that any catalogue can reuse instead of
 * re-typing the chrome. It is the container the lifted primitives (mn-chip /
 * mn-badge / mn-sparkline / mn-ribbon) sit inside in the catalog.
 *
 * Pure presentation: a bordered surface with the skin's radius, an optional
 * `interactive` affordance (hover lift + a `mn-card-activate` event + keyboard
 * Enter/Space), and three slots (header / default body / footer). No content is
 * faked — an empty slot is genuinely empty.
 *
 * SKIN-AWARE via the SkinAware mixin: square shoulders + stronger frame rule
 * under Emporium (the sophia figure-ground), rounded + soft border under Garden.
 * Colors flow through inherited --mn-* tokens — no per-skin color code.
 *
 * Dependencies: lit ONLY. No stores, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

@customElement('mn-card')
export class MnCard extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
    }
    .card {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-surface, 6px);
      background: var(--mn-color-surface-base, #fff);
      overflow: hidden;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #111);
      box-shadow: var(--mn-shadow-card, none);
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }
    .card.interactive {
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    }
    .card.interactive:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .card.interactive:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 2px;
    }

    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #eee);
      font-weight: 600;
      font-size: var(--mn-text-sm, 13px);
      letter-spacing: var(--mn-tracking-label, 0);
    }
    /* The header rule collapses when nothing is slotted into it. */
    .header.empty {
      display: none;
    }
    .body {
      padding: 12px;
      flex: 1;
    }
    .footer {
      padding: 8px 12px;
      border-top: 1px solid var(--mn-color-border-default, #e5e7eb);
    }
    .footer.empty {
      display: none;
    }

    /* ── EMPORIUM skin: square + stronger frame rule (sophia figure-ground) ──── */
    :host([data-skin='emporium']) .card {
      border-radius: var(--mn-radius-surface, 4px);
      border: var(--mn-rule-frame, 1px solid var(--mn-color-border-strong, #ccc));
    }
    :host([data-skin='emporium']) .header {
      border-bottom: var(--mn-rule-line, 1px solid var(--mn-color-border-default));
      text-transform: uppercase;
    }
    :host([data-skin='emporium']) .footer {
      border-top: var(--mn-rule-line, 1px solid var(--mn-color-border-default));
    }
    :host([data-skin='98']) .card {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .header,
    :host([data-skin='98']) .footer {
      border-color: var(--mn-98-shadow);
    }
    :host([data-skin='glass']) .card {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-raised);
      box-shadow: var(--mn-shadow-card);
    }
  `

  /** Make the whole card a clickable/keyboard-activatable surface. */
  @property({ type: Boolean }) interactive = false
  /** Accessible label for the interactive card. */
  @property({ type: String }) label = ''

  /** Track whether the header / footer slots have assigned content. */
  private _hasHeader = false
  private _hasFooter = false

  /** Does a slot have any non-whitespace assigned content? */
  private _slotHasContent(slot: HTMLSlotElement | null): boolean {
    if (!slot) return false
    return slot.assignedNodes({ flatten: true }).some((n) => {
      if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').trim().length > 0
      return true
    })
  }

  /**
   * Re-read the header/footer slot assignment and re-render if it changed. Driven
   * by BOTH the `slotchange` event (the standard path) AND firstUpdated — because
   * happy-dom (this package's test engine) does not reliably fire `slotchange`
   * for declaratively-parsed slots, while `assignedNodes()` works synchronously.
   */
  private _syncSlots(): void {
    const root = this.shadowRoot
    if (!root) return
    const h = this._slotHasContent(root.querySelector('slot[name="header"]'))
    const f = this._slotHasContent(root.querySelector('slot[name="footer"]'))
    if (h !== this._hasHeader || f !== this._hasFooter) {
      this._hasHeader = h
      this._hasFooter = f
      this.requestUpdate()
    }
  }

  firstUpdated(): void {
    this._syncSlots()
  }

  private _onSlotChange(): void {
    this._syncSlots()
  }

  private _activate(e?: KeyboardEvent): void {
    if (!this.interactive) return
    if (e && e.key !== 'Enter' && e.key !== ' ') return
    if (e) e.preventDefault()
    this.dispatchEvent(new CustomEvent('mn-card-activate', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <div
        class="card ${this.interactive ? 'interactive' : ''}"
        part="card"
        role=${this.interactive ? 'button' : nothing}
        tabindex=${this.interactive ? '0' : nothing}
        aria-label=${this.interactive && this.label ? this.label : nothing}
        @click=${() => this._activate()}
        @keydown=${(e: KeyboardEvent) => this._activate(e)}
      >
        <div class="header ${this._hasHeader ? '' : 'empty'}" part="header">
          <slot name="header" @slotchange=${() => this._onSlotChange()}></slot>
        </div>
        <div class="body" part="body"><slot></slot></div>
        <div class="footer ${this._hasFooter ? '' : 'empty'}" part="footer">
          <slot name="footer" @slotchange=${() => this._onSlotChange()}></slot>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-card': MnCard
  }
}
