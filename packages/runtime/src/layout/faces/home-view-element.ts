/**
 * home-view-element.ts — `<sh-home-view>`, the honest empty-pane body for the
 * `sophia.home` face (Builder-2 task brief item (c)).
 *
 * Deliberately says nothing false: no fake document, no borrowed content from
 * a neighboring leaf, no spinner pretending something is loading. Just a
 * plain, real, content-free landmark a leaf can honestly show when nothing is
 * open — LAY-010's replacement descriptor target, and the interpreter's
 * NEVER-blank/NEVER-wrong-pane fallback (LAY-012 spirit) once this face is
 * registered.
 *
 * Aesthetic-overhaul pass (builder B3): the label wears the SAME small-caps
 * muted eyebrow treatment as `stat.scalar`'s `.label` and `card.subject`'s
 * `dt` — one typographic hierarchy across the whole face set, even for the
 * quietest of the five.
 */
import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'

@customElement('sh-home-view')
export class ShHomeView extends LitElement {
  static styles = css`
    :host {
      display: grid;
      width: 100%;
      height: 100%;
      place-content: center;
      place-items: center;
      gap: var(--mn-space-2, 8px);
      overflow: hidden;
      background: var(--mn-color-surface-sunken, var(--mn-color-surface-base));
      color: var(--mn-color-text-tertiary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
      text-align: center;
    }
    :host(:focus-visible) {
      outline: 2px solid var(--mn-focus-ring-color);
      outline-offset: -2px;
    }
    .mark {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--mn-color-border-strong);
    }
    .label {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
    }
  `

  render(): TemplateResult {
    return html`
      <div class="mark" aria-hidden="true"></div>
      <div class="label" role="status">Nothing is open here</div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-home-view': ShHomeView
  }
}
