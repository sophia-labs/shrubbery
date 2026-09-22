/**
 * sparql-table-view-element.ts — `<sh-sparql-table-view>`, the real bindings
 * table body for the `sparql.bindings-table` face (design §7.4/§9.1 "Proving
 * leaf B": "render the existing column/row table behavior... removing
 * TipTap node-specific toolbar concerns from the leaf").
 *
 * Deliberately NOT the full `makeQueryBlockRenderer` toolbar (that renderer
 * owns a TipTap-node-specific comment/collapse/Vega-builder/JSON-editor UI —
 * design §9.1: "Extract the bindings-table DOM from the real QueryBlock path
 * while retaining its real service... removing TipTap node-specific toolbar
 * concerns"). This element renders ONLY the table: typed URI/bnode/literal
 * terms formatted through the REAL, reused `formatQueryBlockTerm`
 * (`@shrubbery/runtime`'s `query-block-service.ts` — the exact function the
 * production QueryBlock table body uses), no CRDT, no provider, no toolbar.
 *
 * Aesthetic-overhaul pass (builder B3): `buildBindingsTableElement` is a
 * SHARED primitive (also used by the production QueryBlock host) — it is not
 * forked here. Its own doc comment invites callers to decorate the returned
 * bare `<table>` with "a CSS class for their own stylesheet"; this element
 * does exactly that — it classifies columns as numeric from the REAL terms'
 * DATATYPES (`isNumericQueryBlockTerm` — a term-typed rule, never a parse of
 * lexical or display text) and stamps a `data-numeric` attribute on that
 * column's cells after the shared builder returns, so the stylesheet below
 * can right-align and apply tabular figures to genuinely numeric columns
 * only. Color tokens carry no raw-hex fallbacks — tokens.css is always
 * loaded in-product (harness pages import it too).
 */
import { LitElement, css, html, type TemplateResult, type nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import {
  buildBindingsTableElement,
  formatQueryBlockTerm,
  isNumericQueryBlockTerm,
  type QueryBlockRow,
} from '../../editor-services/query-block-service.js'

export type SparqlTableViewStatus = 'loading' | 'ready' | 'error'

/**
 * The row-activation door (P6, plans/observatory-ux-implementation-spec-
 * 20260728.md §3 P6: "table-row -> subject-card -> evidence-chain"). Fired
 * from the activated `<tr>` itself, `composed: true` so it crosses this
 * element's shadow boundary and keeps bubbling through the light DOM up to
 * whatever leaf wrapper (`layout-interpreter.ts`'s `data-layout-node-id`)
 * hosts this view — `subject-drill-down.ts`'s `installSubjectDrillDown` is
 * the one production listener.
 */
export const SUBJECT_ROW_ACTIVATE_EVENT = 'sh-row-activate'

export interface SubjectRowActivateDetail {
  readonly subjectIri: string
  /**
   * MO object-face integration spec, master §3 Slice 5, §2.9's assembler
   * branch and `contested-surface.ts`'s `contestedSelectionFrom`: the
   * activated row's OWN bound values, so a listener that needs a second
   * column (e.g. the contested table's `?item`-adjacent `?objectKey`-derived
   * columns) does not have to re-run the query to read it.
   */
  readonly row: QueryBlockRow
}

@customElement('sh-sparql-table-view')
export class ShSparqlTableView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: auto;
    }
    /* Layout-invisible wrapper — see the comment in _body(). */
    .result {
      display: contents;
    }
    .meta {
      flex: 0 0 auto;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary);
      border-bottom: 1px solid var(--mn-color-rule);
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    /* Row rhythm: an 8px grammar top/bottom plus a 1rem line-height sums to
       a clean 32px (4 x 8px) row height, so every row lands on the same
       vertical beat regardless of column content. */
    th,
    td {
      text-align: left;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      line-height: 1rem;
      /* Recessive rule, not a heavy border — the same hairline "--mn-color-
         rule" token the marks-and-anatomy grammar calls for on chart axes. */
      border-bottom: 1px solid var(--mn-color-rule);
      white-space: pre;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    th {
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-weight: 600;
      color: var(--mn-color-text-muted);
      /* Muted small-caps header — the same eyebrow treatment as stat.scalar's
         label and card.subject's field labels (shared typographic hierarchy). */
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      border-bottom: 1px solid var(--mn-color-rule-strong);
      position: sticky;
      top: 0;
      background: var(--mn-color-surface-base);
    }
    /* Numeric columns (term-typed via the datatype, never guessed from
       lexical or display text): right-aligned with tabular figures so digits
       stack cleanly. */
    td[data-numeric],
    th[data-numeric] {
      text-align: right;
      font-variant-numeric: tabular-nums lining-nums;
    }
    .state {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-tertiary);
      text-align: center;
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-danger-strong);
    }
  `

  @property({ type: String }) status: SparqlTableViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: Array }) columns: readonly string[] = []
  @property({ type: Array }) rows: readonly QueryBlockRow[] = []
  @property({ type: Number }) durationMs = 0
  @property({ type: String }) queryKind = ''
  /**
   * The column whose row values are subject IRIs a row-activate door should
   * fire on. `''` (the default) means "not drillable" — BYTE-IDENTICAL
   * behaviour to before this property existed (P6's own additivity
   * requirement: every shipped `sparql.bindings-table` leaf that never sets
   * this renders exactly as it always has). Only takes effect when the named
   * column is actually PRESENT in `this.columns` — an unknown/stale column
   * name is silently inert, not an error.
   */
  @property({ type: String }) subjectColumn = ''

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  /**
   * A column is "numeric" when EVERY row that binds it does so with a term
   * whose DATATYPE is an XSD numeric type (`isNumericQueryBlockTerm` — the
   * real term shape). Deliberately NEVER a lexical parse: an untyped or
   * xsd:string literal that happens to look like a number (an id such as
   * "00123") stays left-aligned text, while a typed numeric whose lexical
   * form doesn't parse cleanly (xsd:double "INF") still aligns as the number
   * it is. A column no row binds is not numeric (nothing to align).
   */
  private _numericColumns(): ReadonlySet<string> {
    const numeric = new Set<string>()
    for (const column of this.columns) {
      let seenAny = false
      let allNumeric = true
      for (const row of this.rows) {
        const term = row[column]
        if (!term) continue
        seenAny = true
        if (!isNumericQueryBlockTerm(term)) {
          allNumeric = false
          break
        }
      }
      if (seenAny && allNumeric) numeric.add(column)
    }
    return numeric
  }

  /**
   * P6's row-activation door. A no-op unless `subjectColumn` is set AND
   * present in `this.columns` (mirrors `_body()`'s own `subjectColumnActive`
   * gate — kept here too so this method stays independently correct/callable).
   * Rows are built in input order by the shared `buildBindingsTableElement`
   * primitive, so `table.querySelectorAll('tbody tr')[i]` corresponds to
   * `this.rows[i]` — the same index correspondence the numeric-column
   * decoration above relies on for `table.rows`.
   *
   * Only a row whose subject term is a genuine URI earns `tabIndex`/`role`/
   * the listeners — a row with no bound value, or one bound to a literal/
   * bnode, is not activatable (there is no subject IRI to drill into).
   */
  private _wireSubjectRows(table: HTMLTableElement): void {
    if (this.subjectColumn === '' || !this.columns.includes(this.subjectColumn)) return
    const subjectColumn = this.subjectColumn
    const bodyRows = table.querySelectorAll('tbody tr')
    this.rows.forEach((row, index) => {
      const tr = bodyRows[index]
      if (!tr) return
      const term = row[subjectColumn]
      const subjectIri = term && term.type === 'uri' ? term.value : ''
      if (subjectIri === '') return
      const rowEl = tr as HTMLTableRowElement
      rowEl.tabIndex = 0
      rowEl.setAttribute('role', 'button')
      rowEl.dataset.subjectIri = subjectIri
      const activate = (): void => {
        rowEl.dispatchEvent(
          new CustomEvent<SubjectRowActivateDetail>(SUBJECT_ROW_ACTIVATE_EVENT, {
            detail: { subjectIri, row },
            bubbles: true,
            composed: true,
          }),
        )
      }
      rowEl.addEventListener('click', activate)
      rowEl.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        event.preventDefault()
        activate()
      })
    })
  }

  private _body(): TemplateResult | typeof nothing {
    if (this.status === 'loading') return this._state('Running…')
    if (this.status === 'error') return this._state(this.error || 'This query could not be run.', 'danger')
    if (this.rows.length === 0) {
      // Wrapped in a `display:contents` element rather than left as bare
      // sibling parts — see the comment on the table branch below.
      return html`
        <div class="result">
          <div class="meta">${this.queryKind.toUpperCase()} · ${this.durationMs}ms · 0 rows</div>
          ${this._state('No rows.')}
        </div>
      `
    }
    // Shared bindings-table DOM primitive (diff-review r2 SUSPECT: "the
    // table body was recreated in a new Lit element ... parallel
    // presentation logic, not an extracted shared leaf") — the SAME
    // query-block-service.ts function the production QueryBlock host table
    // uses, given already-formatted cell strings. lit-html accepts a real
    // DOM Node as a child expression value, so this stays pure shadow-DOM
    // Lit: the table lives inside THIS element's own shadow root, styled by
    // this element's own `table`/`th`/`td` rules above, never a light-DOM
    // reach-across.
    // P6: a non-empty `subjectColumn` PRESENT in `this.columns` is filtered
    // out of the rendered table entirely (header AND cells) — it is a row
    // identity, not display content. `displayColumns === this.columns` (the
    // SAME array reference) in every other case, so the additivity guarantee
    // ("every shipped leaf renders identically") holds by construction, not
    // by a parallel code path.
    const subjectColumnActive = this.subjectColumn !== '' && this.columns.includes(this.subjectColumn)
    const displayColumns = subjectColumnActive
      ? this.columns.filter((column) => column !== this.subjectColumn)
      : this.columns
    const formattedRows = this.rows.map((row) =>
      Object.fromEntries(displayColumns.map((column) => [column, formatQueryBlockTerm(row[column])])),
    )
    const table = buildBindingsTableElement(displayColumns, formattedRows)
    // Decorate the SHARED builder's bare output with our own presentation
    // hook (its own doc comment: "callers own their own wrapping chrome... a
    // CSS class for their own stylesheet") — never fork the builder itself.
    const numericColumns = this._numericColumns()
    if (numericColumns.size > 0) {
      // `table.rows` (the spec `HTMLTableElement.rows` collection, header +
      // body rows in document order) rather than `.tHead`/`.tBodies` — the
      // shared builder always emits exactly one header row first, and the
      // top-level `.rows` collection is the most reliably implemented of the
      // three across DOM implementations.
      const [headerRow, ...bodyRows] = Array.from(table.rows)
      // Indexed against `displayColumns` (not `this.columns`) — once the
      // subject column is filtered out of the table, its index space is
      // `displayColumns`'s, not the full result's.
      displayColumns.forEach((column, index) => {
        if (!numericColumns.has(column)) return
        headerRow?.cells[index]?.setAttribute('data-numeric', '')
        for (const row of bodyRows) {
          row.cells[index]?.setAttribute('data-numeric', '')
        }
      })
    }
    this._wireSubjectRows(table)
    // Wrapped in a `display:contents` element rather than left as bare
    // sibling parts (`.meta` + the raw table Node) — this `_body()` result
    // is itself nested as `render()`'s own child part, and some DOM
    // implementations mis-render a child part that sits as a bare top-level
    // sibling next to another dynamic/static part in a template used that
    // way. `display:contents` keeps the wrapper invisible to layout so
    // `.stage`'s own flex/overflow rules apply exactly as before.
    return html`
      <div class="result">
        <div class="meta">${this.queryKind.toUpperCase()} · ${this.durationMs}ms · ${this.rows.length} row${this.rows.length === 1 ? '' : 's'}</div>
        ${table}
      </div>
    `
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" aria-label="SPARQL bindings table">${this._body()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-sparql-table-view': ShSparqlTableView
  }
}
