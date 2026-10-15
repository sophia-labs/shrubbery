/**
 * A file's page (the Files pane's default face of an opened file): what the file is, said plainly, in sections. Every file has the
 * standard ones (its contents, your notes, about this file, its connections); a kind adds its own (a datasheet: key values, what we
 * extracted, related documents, the source PDF folded away, about the reading). Which sections, in what order, folded or not, is data
 * (organism `files-kinds/registry.ts`, `InfoSectionRule`); how each is drawn is one face of a closed catalogue, here.
 *
 * Controlled and stateless, like the rest of the pane: the shell hands the page in and hears every press back.
 */
import { html, nothing, type TemplateResult } from 'lit'
import { live } from 'lit/directives/live.js'
import { repeat } from 'lit/directives/repeat.js'

/** A fact: a label and a text; a verb when it has an action (said back through `onPageAction`). */
export interface FilesPageFact {
  readonly label: string
  readonly text: string
  readonly title?: string
  readonly mono?: boolean
  readonly action?: string
}

/** A value that matters for what the file is ('Input voltage', '1.45–5.5 V', 'f = 1 kHz', p. 7). */
export interface FilesPageValue {
  /** The evidence id a page link goes to. */
  readonly id: string
  readonly label: string
  readonly symbol?: string
  readonly text: string
  /** What qualifies the number, said small after it ('typ', 'typ 30'). */
  readonly qualifier?: string
  /** Its conditions, short. */
  readonly when?: string
  readonly page: number | null
  /** Why it is disputed, when the readers disagreed about it; null otherwise. */
  readonly disputed?: string | null
}

export interface FilesPageRow {
  readonly id: string
  readonly label: string
  readonly symbol: string
  readonly when: string
  readonly min: string
  readonly typ: string
  readonly max: string
  readonly unit: string
  readonly page: number | null
  readonly disputed?: string | null
}

/** A table's own heading inside a group ('Audio performance'). */
export interface FilesPageSubheading { readonly heading: string }

export interface FilesPageTableGroup {
  readonly id: string
  readonly title: string
  /** The regime, when the title does not say it ('Absolute maximum'). */
  readonly tag?: string
  readonly rows: readonly (FilesPageRow | FilesPageSubheading)[]
}

export interface FilesPageRegister {
  readonly id: string
  readonly name: string
  readonly address: string
  readonly reset: string
  readonly fields: number
  readonly description: string
  readonly page: number | null
}

export interface FilesPageLink {
  readonly id: string
  readonly label: string
  readonly detail?: string
  /** A short word before the detail ('Same part', 'Errata'). */
  readonly tag?: string
  readonly action: string
}

/** Your notes: a Hoja editor on the notes document (made at the first keystroke; nothing generated writes here). */
export interface FilesPageNotes {
  readonly status: 'loading' | 'empty' | 'ready' | 'saving' | 'saved' | 'error'
  /** Changing it remounts the editor (another file, or the document read again). */
  readonly valueKey: string
  /** The document (TipTap JSON), or null for an empty one. */
  readonly document: unknown | null
  readonly readOnly: boolean
  /** Said beside the title ('Saved', 'Couldn’t save: …'). */
  readonly message?: string
  /** The verb that opens the notes as a document, once there is one. */
  readonly openAction?: string
}

export type FilesPageBody =
  | { readonly face: 'facts'; readonly rows: readonly FilesPageFact[] }
  | { readonly face: 'values'; readonly values: readonly FilesPageValue[] }
  | { readonly face: 'table'; readonly groups: readonly FilesPageTableGroup[]; readonly filter: string; readonly total: number; readonly shown: number
      readonly registers?: readonly FilesPageRegister[] }
  | { readonly face: 'links'; readonly links: readonly FilesPageLink[] }
  | { readonly face: 'notes'; readonly notes: FilesPageNotes }
  | { readonly face: 'source' }

export interface FilesPageSection {
  readonly id: string
  readonly title: string
  readonly face: FilesPageBody['face']
  /** A count beside the title. */
  readonly count?: string
  readonly open: boolean
  /** A sentence under the title (open or not): why it is empty, what it holds. */
  readonly note?: string | null
  /** Null while it is read, or when a folded section has not been asked for. */
  readonly body: FilesPageBody | null
  /** One verb in the section's head ('Open as a document'). */
  readonly verb?: { readonly label: string; readonly action: string } | null
}

export interface FilesPanePage {
  /** The shell's key of the file (`artifact:{id}`). */
  readonly key: string
  /** The file's own name (the Back row says it). */
  readonly name: string
  /** The file-type caption for the glyph ('PDF'). */
  readonly caption: string
  /** The headline: the part, the paper's title, else the file's name. */
  readonly title: string
  /** The family a sheet covers, the headline among them. */
  readonly chips: readonly { readonly text: string; readonly current?: boolean; readonly title?: string }[]
  /** The lines under the headline: maker · document type · revision · pages. */
  readonly lines: readonly { readonly text: string; readonly title?: string }[]
  /** A condition said once under the head (reading, couldn't read). */
  readonly note?: string | null
  readonly sections: readonly FilesPageSection[]
}

/** What the page says back. */
export interface FilesPageHandlers {
  readonly onSection: (id: string, open: boolean) => void
  /** A page link was pressed: open the source at that value. */
  readonly onGoto: (evidenceId: string, page: number | null) => void
  readonly onAction: (action: string) => void
  readonly onFilter: (text: string) => void
  readonly onNotes: (detail: { readonly json: unknown; readonly value: string; readonly isEmpty: boolean }) => void
  /** The source section's body (the shell's viewer). */
  readonly source: () => TemplateResult | typeof nothing
}

/** The page's stylesheet (light DOM, house tokens), rendered once inside the pane beside its own. */
export const FILES_PAGE_STYLE = html`<style>
  .mn-files-pane .fpage { flex: 1 1 auto; min-height: 0; overflow: auto; container-type: inline-size; background: var(--mn-color-surface-base); }
  .mn-files-pane .fp-inner { box-sizing: border-box; width: 100%; max-width: 64rem; margin: 0 auto; padding: var(--mn-space-5, 24px) var(--mn-space-5, 24px) var(--mn-space-6, 40px);
    display: flex; flex-direction: column; gap: var(--mn-space-4, 16px); }
  .mn-files-pane .fp-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--mn-space-3, 12px); align-items: start; }
  .mn-files-pane .fp-head h1 { margin: 0; font-size: var(--mn-text-2xl, 26px); line-height: 1.15; font-weight: 650; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .mn-files-pane .fp-head .fp-lines { margin: var(--mn-space-1, 4px) 0 0; color: var(--mn-color-text-secondary); font-size: var(--mn-text-sm, 13px); display: flex; flex-wrap: wrap; gap: 0 var(--mn-space-2, 8px); }
  .mn-files-pane .fp-head .fp-lines span + span::before { content: '·'; margin-inline-end: var(--mn-space-2, 8px); color: var(--mn-color-text-muted, var(--mn-color-text-secondary)); }
  .mn-files-pane .fp-head .fp-chips { display: flex; flex-wrap: wrap; gap: var(--mn-space-1, 4px); margin-top: var(--mn-space-2, 8px); padding: 0; list-style: none; }
  .mn-files-pane .fp-head .fp-chips li { font-size: var(--mn-text-xs, 11px); font-family: var(--mn-font-mono, ui-monospace, monospace); padding: 1px 6px;
    border: 1px solid var(--mn-color-border-subtle); border-radius: 999px; color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-head .fp-chips li[data-current] { color: var(--mn-color-text-primary); border-color: var(--mn-color-border-default); font-weight: 600; }
  .mn-files-pane .fp-note { margin: 0; color: var(--mn-color-text-secondary); font-size: var(--mn-text-sm, 13px); }
  .mn-files-pane .fp-sec { border-top: 1px solid var(--mn-color-border-subtle); padding-top: var(--mn-space-2, 8px); }
  .mn-files-pane .fp-sec > header { display: flex; align-items: center; gap: var(--mn-space-2, 8px); min-height: 32px; }
  .mn-files-pane .fp-sec > header h2 { margin: 0; flex: 1 1 auto; min-width: 0; font-size: var(--mn-text-md, 14px); font-weight: 650; }
  .mn-files-pane .fp-sec > header h2 button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: var(--mn-space-2, 8px); cursor: pointer;
    padding: 2px 4px; margin: -2px -4px; border-radius: var(--mn-radius-control, 6px); max-width: 100%; }
  .mn-files-pane .fp-sec > header h2 button:hover { background: var(--mn-color-interactive-hover); }
  .mn-files-pane .fp-sec > header h2 button:focus-visible { box-shadow: var(--mn-focus-ring); }
  .mn-files-pane .fp-sec .chev { display: inline-block; width: 1em; color: var(--mn-color-text-secondary); transition: transform 120ms ease; }
  .mn-files-pane .fp-sec[data-open] .chev { transform: rotate(90deg); }
  .mn-files-pane .fp-sec .count { color: var(--mn-color-text-secondary); font-weight: 500; font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .fp-sec .fp-snote { margin: 0 0 var(--mn-space-2, 8px); color: var(--mn-color-text-secondary); font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .fp-sec .verb { font: inherit; font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-accent); background: transparent; border: 0; cursor: pointer; padding: 2px 4px; }
  .mn-files-pane .fp-sec .verb:hover { text-decoration: underline; }
  .mn-files-pane .fp-sec .body { padding: var(--mn-space-1, 4px) 0 var(--mn-space-2, 8px); }
  .mn-files-pane .fp-plink { font: inherit; font-size: var(--mn-text-xs, 11px); color: var(--mn-color-text-accent); background: transparent; border: 0; padding: 0 2px; cursor: pointer;
    white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mn-files-pane .fp-plink:hover { text-decoration: underline; }
  .mn-files-pane .fp-plink:focus-visible { outline: none; box-shadow: var(--mn-focus-ring); border-radius: 4px; }
  .mn-files-pane .fp-disputed { color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; white-space: nowrap; }
  .mn-files-pane .fp-values { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: var(--mn-space-2, 8px) var(--mn-space-4, 16px); margin: 0; padding: 0; list-style: none; }
  .mn-files-pane .fp-values li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 var(--mn-space-2, 8px); align-items: baseline; padding: var(--mn-space-1, 4px) 0;
    border-bottom: 1px dotted var(--mn-color-border-subtle); }
  .mn-files-pane .fp-values .vl { color: var(--mn-color-text-secondary); font-size: var(--mn-text-sm, 12px); grid-column: 1 / -1; }
  .mn-files-pane .fp-values .vl .sym { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-xs, 11px); margin-inline-start: var(--mn-space-1, 4px); }
  .mn-files-pane .fp-values .vv { font-size: var(--mn-text-md, 15px); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .mn-files-pane .fp-values .vq { font-size: var(--mn-text-xs, 11px); font-weight: 400; color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-values .vw { grid-column: 1 / -1; color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane .fp-facts { display: grid; grid-template-columns: minmax(6rem, 11rem) minmax(0, 1fr); gap: var(--mn-space-1, 4px) var(--mn-space-3, 12px); margin: 0; font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .fp-facts dt { color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .mn-files-pane .fp-facts dd.mono { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-xs, 11px); }
  .mn-files-pane .fp-facts dd button, .mn-files-pane .fp-links button { font: inherit; color: var(--mn-color-text-accent); background: transparent; border: 0; padding: 0; cursor: pointer; text-align: left; }
  .mn-files-pane .fp-facts dd button:hover, .mn-files-pane .fp-links button:hover .ll { text-decoration: underline; }
  .mn-files-pane .fp-links { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; font-size: var(--mn-text-sm, 13px); }
  .mn-files-pane .fp-links li button { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--mn-space-2, 8px); width: 100%; padding: 4px; margin: 0 -4px; border-radius: var(--mn-radius-control, 6px); }
  .mn-files-pane .fp-links li button:hover { background: var(--mn-color-interactive-hover); }
  .mn-files-pane .fp-links .ll { color: var(--mn-color-text-primary); font-weight: 600; }
  .mn-files-pane .fp-links .lt { color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); }
  .mn-files-pane .fp-links .ld { color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); min-width: 0; overflow-wrap: anywhere; }
  .mn-files-pane .fp-filter { display: flex; align-items: center; gap: var(--mn-space-2, 8px); margin-bottom: var(--mn-space-2, 8px); font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-filter input { font: inherit; flex: 0 1 18rem; min-width: 0; color: var(--mn-color-text-primary); background: var(--mn-color-surface-raised);
    border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); min-height: var(--mn-control-height, 28px); padding: 0 var(--mn-space-2, 8px); }
  .mn-files-pane .fp-spec { font-size: var(--mn-text-sm, 12px); font-variant-numeric: tabular-nums; }
  .mn-files-pane .fp-spec .r { display: grid; grid-template-columns: minmax(9rem, 34fr) minmax(3.5rem, 6fr) minmax(7rem, 30fr) 4.25rem 4.25rem 4.25rem minmax(3rem, 5fr) 2.75rem;
    gap: 0 var(--mn-space-2, 8px); align-items: baseline; padding: 3px 0; border-bottom: 1px solid var(--mn-color-border-subtle); }
  .mn-files-pane .fp-spec.regs .r { grid-template-columns: minmax(8rem, 2fr) 6rem 6rem 3.5rem minmax(8rem, 4fr) 2.75rem; }
  .mn-files-pane .fp-spec .r > span { min-width: 0; overflow-wrap: anywhere; }
  .mn-files-pane .fp-spec .hdr { position: sticky; top: 0; z-index: 1; background: var(--mn-color-surface-base); color: var(--mn-color-text-secondary); font-weight: 600;
    font-size: var(--mn-text-xs, 11px); }
  .mn-files-pane .fp-spec .n { text-align: right; white-space: nowrap; overflow-wrap: normal; }
  .mn-files-pane .fp-spec .sym { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-xs, 11px); }
  .mn-files-pane .fp-spec .w { color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); }
  .mn-files-pane .fp-spec .u { color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-spec .all { display: none; }
  .mn-files-pane .fp-spec .group { padding-top: var(--mn-space-3, 12px); padding-bottom: 3px; font-size: var(--mn-text-sm, 12px); font-weight: 650; border-bottom: 1px solid var(--mn-color-border-default); }
  .mn-files-pane .fp-spec .group .tag { font-weight: 400; color: var(--mn-color-text-secondary); margin-inline-start: var(--mn-space-2, 8px); }
  .mn-files-pane .fp-spec .sub { color: var(--mn-color-text-secondary); font-weight: 600; font-size: var(--mn-text-xs, 11px); padding-top: var(--mn-space-2, 8px); }
  .mn-files-pane .fp-spec .r[data-empty] > span:not(.p) { color: var(--mn-color-text-secondary); }
  .mn-files-pane .fp-regs { margin-top: var(--mn-space-3, 12px); }
  .mn-files-pane .fp-regs h3 { margin: 0 0 var(--mn-space-1, 4px); font-size: var(--mn-text-sm, 12px); font-weight: 650; }
  .mn-files-pane .fp-notes { border: 1px solid var(--mn-color-border-subtle); border-radius: var(--mn-radius-lg, 8px); background: var(--mn-color-surface-raised); overflow: hidden; }
  .mn-files-pane .fp-notes hoja-editor { display: block; min-height: 5.5rem; }
  .mn-files-pane .fp-notes hoja-editor[posture='page'] .hoja-editor__content { min-block-size: 5rem; }
  .mn-files-pane .fp-notes hoja-editor[posture='page'] .hoja-editor__footer { min-height: 34px; }
  .mn-files-pane .fp-notes-status { color: var(--mn-color-text-secondary); font-size: var(--mn-text-xs, 11px); font-weight: 400; }
  .mn-files-pane .fp-notes-status[data-status='error'] { color: var(--mn-color-text-danger); }
  .mn-files-pane .fp-source { height: clamp(22rem, 78vh, 70rem); min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--mn-color-border-subtle);
    border-radius: var(--mn-radius-lg, 8px); overflow: hidden; }
  .mn-files-pane .fp-source[data-flow] { height: auto; max-height: 78vh; }
  .mn-files-pane .fp-source > .opened { flex: 1 1 auto; min-height: 0; }
  @container (max-width: 640px) {
    .mn-files-pane .fp-inner { padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px) var(--mn-space-5, 24px); gap: var(--mn-space-3, 12px); }
    .mn-files-pane .fp-head h1 { font-size: var(--mn-text-xl, 22px); }
    .mn-files-pane .fp-facts { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .mn-files-pane .fp-facts dd { margin-bottom: var(--mn-space-1, 4px); }
    .mn-files-pane .fp-spec .hdr { display: none; }
    .mn-files-pane .fp-spec .r { grid-template-columns: minmax(0, 1fr) auto auto; padding: 4px 0; }
    .mn-files-pane .fp-spec .r > .sym, .mn-files-pane .fp-spec .r > .mn, .mn-files-pane .fp-spec .r > .ty, .mn-files-pane .fp-spec .r > .mx, .mn-files-pane .fp-spec .r > .u { display: none; }
    .mn-files-pane .fp-spec .r > .l { grid-row: 1; grid-column: 1; }
    .mn-files-pane .fp-spec .r > .all { display: block; grid-row: 1; grid-column: 2; }
    .mn-files-pane .fp-spec .r > .p { grid-row: 1; grid-column: 3; }
    .mn-files-pane .fp-spec .r > .w { grid-row: 2; grid-column: 1 / -1; }
    .mn-files-pane .fp-spec .r > .w:empty { display: none; }
    .mn-files-pane .fp-spec.regs .r > .sym { display: block; grid-row: 2; grid-column: 1; }
    .mn-files-pane .fp-source { height: 70vh; }
  }
</style>`

const isHeading = (r: FilesPageRow | FilesPageSubheading): r is FilesPageSubheading => 'heading' in r

/** A row's slots in one phrase, for a narrow page: '−40 to 125 °C', '≤ 36 V', '4.5–28 V (typ 12)', '8 MHz typ'. */
export function compact(r: Pick<FilesPageRow, 'min' | 'typ' | 'max' | 'unit'>): string {
  const unit = r.unit ? ` ${r.unit}` : ''
  const signed = r.min.startsWith('−') || r.max.startsWith('−') || r.min.startsWith('-') || r.max.startsWith('-')
  const range = r.min && r.max ? (r.min === r.max ? r.min : signed ? `${r.min} to ${r.max}` : `${r.min}–${r.max}`) : r.max ? `≤ ${r.max}` : r.min ? `≥ ${r.min}` : ''
  if (range) return `${range}${unit}${r.typ ? ` (typ ${r.typ})` : ''}`
  return r.typ ? `${r.typ}${unit} typ` : ''
}

function pageLink(h: FilesPageHandlers, id: string, page: number | null, label: string): TemplateResult | typeof nothing {
  if (page === null) return nothing
  return html`<button type="button" class="fp-plink" data-goto=${id} data-page=${page} title=${`Show ${label} on page ${page} of the source`}
    aria-label=${`${label}: show on page ${page}`} @click=${() => h.onGoto(id, page)}>p.&nbsp;${page}</button>`
}

function disputedMark(why: string | null | undefined): TemplateResult | typeof nothing {
  return why ? html`<span class="fp-disputed" data-disputed title=${why}>disputed</span>` : nothing
}

function renderFacts(rows: readonly FilesPageFact[], h: FilesPageHandlers): TemplateResult {
  return html`<dl class="fp-facts">${rows.map(r => html`<dt>${r.label}</dt><dd class=${r.mono ? 'mono' : ''} title=${r.title ?? nothing}>${r.action
    ? html`<button type="button" data-action=${r.action} @click=${() => h.onAction(r.action!)}>${r.text}</button>` : r.text}</dd>`)}</dl>`
}

function renderValues(values: readonly FilesPageValue[], h: FilesPageHandlers): TemplateResult {
  return html`<ul class="fp-values">${repeat(values, v => v.id, v => html`<li data-value=${v.id}>
    <span class="vl">${v.label}${v.symbol ? html`<span class="sym">${v.symbol}</span>` : nothing}</span>
    <span class="vv">${v.text}${v.qualifier ? html` <span class="vq">${v.qualifier}</span>` : nothing} ${disputedMark(v.disputed)}</span>
    ${pageLink(h, v.id, v.page, v.label)}
    ${v.when ? html`<span class="vw" title=${v.when}>${v.when}</span>` : nothing}
  </li>`)}</ul>`
}

function renderTable(body: Extract<FilesPageBody, { face: 'table' }>, h: FilesPageHandlers): TemplateResult {
  // Rows as an ARIA table of grid rows: one template per row, no <tr> outside a table (some parsers drop it: happy-dom).
  const cells = (r: FilesPageRow) => {
    const empty = !r.min && !r.typ && !r.max
    return html`<div class="r" role="row" data-row=${r.id} ?data-empty=${empty}><span role="cell" class="l">${r.label} ${disputedMark(r.disputed)}</span><span role="cell" class="sym">${r.symbol}</span><span role="cell" class="w">${r.when}</span><span role="cell" class="n mn">${r.min}</span><span role="cell" class="n ty">${r.typ}</span><span role="cell" class="n mx">${r.max}</span><span role="cell" class="u">${r.unit}</span><span role="cell" class="n all">${empty ? 'not read' : compact(r)}</span><span role="cell" class="n p">${pageLink(h, r.id, r.page, r.label)}</span></div>`
  }
  // The input is its own template: a binding after a void element is mis-parsed by some DOM implementations (happy-dom).
  const input = html`<input type="search" aria-label="Filter what we extracted" placeholder=${`Filter ${body.total} values`}
      .value=${live(body.filter)} @input=${(e: Event) => h.onFilter((e.currentTarget as HTMLInputElement).value)} />`
  const head = html`<div class="r hdr" role="row"><span role="columnheader" class="l">Parameter</span><span role="columnheader" class="sym">Symbol</span><span role="columnheader" class="w">Conditions</span><span role="columnheader" class="n mn">Min</span><span role="columnheader" class="n ty">Typ</span><span role="columnheader" class="n mx">Max</span><span role="columnheader" class="u">Unit</span><span role="columnheader" class="n p"><span class="visually-hidden">Page</span></span></div>`
  // One element around the whole face: a binding at a template's top level after an element is drawn as text by happy-dom.
  return html`<div class="fp-table"><div class="fp-filter">${input}<span class="fp-shown" role="status">${body.filter ? `${body.shown} of ${body.total}` : ''}</span></div>
    ${body.groups.length ? html`<div class="fp-spec" role="table" aria-label="What we extracted">${head}${body.groups.map(g => html`<div role="rowgroup" data-group=${g.id}>
      <div class="group" role="row"><span role="rowheader">${g.title}${g.tag ? html`<span class="tag">${g.tag}</span>` : nothing}</span></div>
      ${g.rows.map(r => isHeading(r) ? html`<div class="sub" role="row"><span role="rowheader">${r.heading}</span></div>` : cells(r))}
    </div>`)}</div>`
      : html`<p class="fp-snote">Nothing matches “${body.filter}”.</p>`}
    ${body.registers?.length ? html`<div class="fp-regs"><h3>Registers</h3><div class="fp-spec regs" role="table" aria-label="Registers">
      <div class="r hdr" role="row"><span role="columnheader" class="l">Register</span><span role="columnheader" class="sym">Address</span><span role="columnheader" class="sym">Reset</span><span role="columnheader" class="n">Fields</span><span role="columnheader" class="w">Description</span><span role="columnheader" class="n p"><span class="visually-hidden">Page</span></span></div>
      ${body.registers.map(r => html`<div class="r" role="row" data-register=${r.id}><span role="cell" class="l">${r.name}</span><span role="cell" class="sym">${r.address}</span><span role="cell" class="sym">${r.reset}</span><span role="cell" class="n">${r.fields || ''}</span><span role="cell" class="w">${r.description}</span><span role="cell" class="n p">${r.page !== null ? html`<button type="button" class="fp-plink"
        @click=${() => h.onGoto(`page:${r.page}`, r.page)}>p.&nbsp;${r.page}</button>` : nothing}</span></div>`)}
    </div></div>` : nothing}</div>`
}

function renderLinks(links: readonly FilesPageLink[], h: FilesPageHandlers): TemplateResult {
  return html`<ul class="fp-links">${repeat(links, l => l.id, l => html`<li><button type="button" data-action=${l.action} @click=${() => h.onAction(l.action)}>
    <span class="ll">${l.label}</span>${l.tag ? html`<span class="lt">${l.tag}</span>` : nothing}${l.detail ? html`<span class="ld">${l.detail}</span>` : nothing}
  </button></li>`)}</ul>`
}

function renderNotes(notes: FilesPageNotes, h: FilesPageHandlers): TemplateResult {
  if (notes.status === 'loading') return html`<p class="fp-snote">Reading your notes…</p>`
  return html`<div class="fp-notes"><hoja-editor posture="page" label="Your notes" .valueKey=${notes.valueKey}
    placeholder=${notes.readOnly ? 'No notes yet.' : 'Write a note about this file: what you used it for, what to watch out for…'}
    .pageDocument=${notes.document ?? null} .value=${''} .readOnly=${notes.readOnly}
    @hoja-change=${(e: CustomEvent<{ json: unknown; value: string; isEmpty: boolean }>) => h.onNotes({ json: e.detail.json, value: e.detail.value, isEmpty: e.detail.isEmpty })}
  ></hoja-editor></div>`
}

function renderBody(section: FilesPageSection, h: FilesPageHandlers): TemplateResult | typeof nothing {
  const body = section.body
  if (section.face === 'source') return h.source()
  if (!body) return section.note ? nothing : html`<p class="fp-snote">Reading…</p>`
  switch (body.face) {
    case 'facts': return renderFacts(body.rows, h)
    case 'values': return renderValues(body.values, h)
    case 'table': return renderTable(body, h)
    case 'links': return renderLinks(body.links, h)
    case 'notes': return renderNotes(body.notes, h)
    default: return nothing
  }
}

function renderSection(section: FilesPageSection, h: FilesPageHandlers): TemplateResult {
  const bodyId = `psec-${section.id}`
  const notes = section.body?.face === 'notes' ? section.body.notes : null
  return html`<section class="fp-sec" data-section=${section.id} ?data-open=${section.open} aria-labelledby=${`${bodyId}-h`}>
    <header>
      <h2 id=${`${bodyId}-h`}><button type="button" aria-expanded=${section.open ? 'true' : 'false'} aria-controls=${bodyId}
        @click=${() => h.onSection(section.id, !section.open)}><span class="chev" aria-hidden="true">›</span>${section.title}${section.count
          ? html` <span class="count">${section.count}</span>` : nothing}${notes?.message
          ? html` <span class="fp-notes-status" role="status" data-status=${notes.status}>${notes.message}</span>` : nothing}</button></h2>
      ${section.verb ? html`<button type="button" class="verb" data-action=${section.verb.action} @click=${() => h.onAction(section.verb!.action)}>${section.verb.label}</button>` : nothing}
    </header>
    ${section.note ? html`<p class="fp-snote">${section.note}</p>` : nothing}
    ${section.open ? html`<div class="body" id=${bodyId}>${renderBody(section, h)}</div>` : nothing}
  </section>`
}

/** The page: the file's head, then its sections (each folded or open). */
export function renderFilesPage(page: FilesPanePage, h: FilesPageHandlers): TemplateResult {
  return html`<article class="fpage" aria-label=${`About ${page.name}`} data-page=${page.key}>
    <div class="fp-inner">
      <header class="fp-head">
        <mn-file-glyph kind="file" type=${page.caption} size="40"></mn-file-glyph>
        <div>
          <h1>${page.title}</h1>
          ${page.lines.length ? html`<p class="fp-lines">${page.lines.map(l => html`<span title=${l.title ?? nothing}>${l.text}</span>`)}</p>` : nothing}
          ${page.chips.length ? html`<ul class="fp-chips" aria-label="Parts this document covers">${page.chips.map(c => html`<li ?data-current=${c.current === true}
            title=${c.title ?? nothing}>${c.text}</li>`)}</ul>` : nothing}
        </div>
      </header>
      ${page.note ? html`<p class="fp-note" role="note">${page.note}</p>` : nothing}
      ${repeat(page.sections, s => s.id, s => renderSection(s, h))}
    </div>
  </article>`
}
