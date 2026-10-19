/**
 * `<mn-reader-contents>` — the Contents panel of a read-only document's Text view: the document's headings, in order,
 * in the same panel the Reader has beside the original (tabs over a scrolling list; the heading in view is marked).
 *
 * Controlled: the editor host passes the headings and the one in view, and scrolls the editor when one is chosen.
 * Events (bubble, composed): `rd-contents-navigate` { id }
 */
import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { READER_SIDE_STYLES, READER_TOKENS } from './reader-styles.js'

export interface ReaderContentsHeading { readonly id: string; readonly level: number; readonly text: string }

@customElement('mn-reader-contents')
export class MnReaderContents extends LitElement {
  static override styles = [READER_TOKENS, READER_SIDE_STYLES, css`
    :host { display: block; }
    .side { height: 100%; box-sizing: border-box; }
    button { font: inherit; color: inherit; }
    .empty { color: var(--rd-quiet); padding: 8px; line-height: 1.5; }
    .toc button { overflow-wrap: anywhere; }
    @media (pointer: coarse) { .tabs button, .toc button { min-height: 40px; } }
  `]

  @property({ attribute: false }) headings: readonly ReaderContentsHeading[] = []
  /** The heading the reader is at (its block id). */
  @property({ type: String, attribute: 'active-id' }) activeId = ''

  protected override render(): TemplateResult {
    const top = this.headings.reduce((least, h) => Math.min(least, h.level), 6)
    return html`<aside class="side" aria-label="Contents">
      <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true">Contents</button></div>
      <div class="side-scroll">${this.headings.length
        ? html`<nav class="toc"><ul>${this.headings.map(h => html`<li style=${`padding-left:${Math.max(0, h.level - top) * 12}px`}>
            <button type="button" aria-current=${h.id === this.activeId ? 'true' : 'false'}
              @click=${() => this.dispatchEvent(new CustomEvent('rd-contents-navigate', { bubbles: true, composed: true, detail: { id: h.id } }))}>${h.text || '(untitled)'}</button></li>`)}</ul></nav>`
        : html`<p class="empty">This document has no headings.</p>`}</div>
    </aside>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'mn-reader-contents': MnReaderContents }
}
