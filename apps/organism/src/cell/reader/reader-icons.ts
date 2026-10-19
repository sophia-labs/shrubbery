/** The Reader's line icons (24-grid, stroked in `currentColor`), shared by the Reader and its bar. */
import { html, type TemplateResult } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'

export const READER_ICONS: Readonly<Record<string, string>> = {
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  margin: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 9h1M17.5 12h1"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  type: '<path d="M4 19 9 5l5 14M5.8 14h6.4"/><path d="M15 19l3-8 3 8M15.9 16.6h4.2"/>',
}
export const icon = (name: string): TemplateResult => html`<svg viewBox="0 0 24 24" aria-hidden="true">${unsafeSVG(READER_ICONS[name] ?? '')}</svg>`

