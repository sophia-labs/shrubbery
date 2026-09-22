/**
 * sparql-table-view-element.test.ts — real `<sh-sparql-table-view>` custom
 * element mounted directly (no interpreter, no network — a query result is
 * plain data; `formatQueryBlockTerm`/`plainQueryBlockTermValue`/
 * `buildBindingsTableElement` are the SAME real functions the production
 * QueryBlock host and this element both call, never a test double).
 *
 * Proves the aesthetic-overhaul pass's real, term-typed numeric-column
 * classification (never a guess from lexical or rendered text): a column is
 * stamped `data-numeric` on every cell — header included — iff EVERY row
 * binding it carries an XSD-numeric DATATYPE (`isNumericQueryBlockTerm`),
 * and the shared `buildBindingsTableElement` primitive is decorated, never
 * forked (the table's own textContent for each cell is untouched, still
 * `formatQueryBlockTerm`'s output).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../sparql-table-view-element.js'
import { SUBJECT_ROW_ACTIVATE_EVENT, type ShSparqlTableView, type SubjectRowActivateDetail } from '../sparql-table-view-element.js'
import type { QueryBlockRow } from '../../../editor-services/query-block-service.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function mountReady(columns: readonly string[], rows: readonly QueryBlockRow[]): ShSparqlTableView {
  const view = document.createElement('sh-sparql-table-view') as ShSparqlTableView
  view.status = 'ready'
  view.queryKind = 'select'
  view.durationMs = 3
  view.columns = columns
  view.rows = rows
  root.appendChild(view)
  return view
}

describe('sh-sparql-table-view — real term-typed numeric-column classification', () => {
  it('stamps data-numeric on a column whose every row binds a numeric literal — header and every cell', async () => {
    const columns = ['s', 'count'] as const
    const rows: QueryBlockRow[] = [
      { s: { type: 'uri', value: 'urn:x:a' }, count: { type: 'literal', value: '3', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
      { s: { type: 'uri', value: 'urn:x:b' }, count: { type: 'literal', value: '17', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
    ]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    const [headerRow, ...bodyRows] = Array.from(table.rows)
    expect(headerRow.cells[0].hasAttribute('data-numeric')).toBe(false) // 's' — URIs, never numeric
    expect(headerRow.cells[1].hasAttribute('data-numeric')).toBe(true) // 'count' — every row numeric

    for (const row of bodyRows) {
      expect(row.cells[0].hasAttribute('data-numeric')).toBe(false)
      expect(row.cells[1].hasAttribute('data-numeric')).toBe(true)
    }
  })

  it('a column with even ONE non-numeric binding is NOT classified numeric — no false right-alignment', async () => {
    const columns = ['label'] as const
    const rows: QueryBlockRow[] = [
      { label: { type: 'literal', value: '42' } },
      { label: { type: 'literal', value: 'not a number' } },
    ]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    expect(table.rows[0]!.cells[0].hasAttribute('data-numeric')).toBe(false)
  })

  it('a column no row binds is not classified numeric — nothing to align', async () => {
    const columns = ['maybeBound'] as const
    const rows: QueryBlockRow[] = [{}]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    expect(table.rows[0]!.cells[0].hasAttribute('data-numeric')).toBe(false)
  })

  it('the shared builder is decorated, not forked — cell text is still the real formatQueryBlockTerm output', async () => {
    const columns = ['count'] as const
    const rows: QueryBlockRow[] = [
      { count: { type: 'literal', value: '9', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
    ]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    const cell = table.rows[1]!.cells[0] // rows[0] is the header row
    expect(cell.hasAttribute('data-numeric')).toBe(true)
    // formatQueryBlockTerm's real Turtle-shorthand decoration — the
    // inspection-tool display text is untouched by the numeric classification.
    expect(cell.textContent).toBe('"9"^^http://www.w3.org/2001/XMLSchema#integer')
  })

  it('an UNTYPED/xsd:string literal that merely looks numeric ("00123") is NOT numeric — the datatype is the rule, never a lexical parse', async () => {
    const columns = ['id', 'code'] as const
    const rows: QueryBlockRow[] = [
      {
        id: { type: 'literal', value: '00123' },
        code: { type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
      },
    ]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    expect(table.rows[0]!.cells[0].hasAttribute('data-numeric')).toBe(false) // untyped
    expect(table.rows[0]!.cells[1].hasAttribute('data-numeric')).toBe(false) // xsd:string
  })

  it('a typed numeric whose lexical form does not Number()-parse (xsd:double "INF") IS numeric — the type wins', async () => {
    const columns = ['extreme'] as const
    const rows: QueryBlockRow[] = [
      { extreme: { type: 'literal', value: 'INF', datatype: 'http://www.w3.org/2001/XMLSchema#double' } },
      { extreme: { type: 'literal', value: '1.5', datatype: 'http://www.w3.org/2001/XMLSchema#double' } },
    ]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    expect(table.rows[0]!.cells[0].hasAttribute('data-numeric')).toBe(true)
    expect(table.rows[1]!.cells[0].hasAttribute('data-numeric')).toBe(true)
  })

  it('a bnode column is never classified numeric', async () => {
    const columns = ['b'] as const
    const rows: QueryBlockRow[] = [{ b: { type: 'bnode', value: 'n1' } }]
    const view = mountReady(columns, rows)
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    expect(table.rows[0]!.cells[0].hasAttribute('data-numeric')).toBe(false)
  })
})

/**
 * P6's row-activation door (plans/observatory-ux-implementation-spec-
 * 20260728.md §3 P6's "Table (2)" tests). NOT in the spec's own MODIFY list
 * for this file — a listing gap, flagged in the P6 packet's own report —
 * but this is the correct, uncontested home for element-level `subjectColumn`
 * behaviour (same pattern the numeric-column suite above already
 * establishes: mount the real element, inspect its real shadow DOM).
 */
describe('sh-sparql-table-view — P6 row-activation door (subjectColumn)', () => {
  function runRows(count: number): QueryBlockRow[] {
    return Array.from({ length: count }, (_, i) => ({
      run: { type: 'uri' as const, value: `urn:x:run-${i + 1}` },
      label: { type: 'literal' as const, value: `label-${i + 1}` },
    }))
  }

  it('absent subjectField preserves every column and emits no event — strict additivity for every shipped leaf', async () => {
    const columns = ['run', 'label'] as const
    const view = mountReady(columns, runRows(2))
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    const headerCells = Array.from(table.rows[0]!.cells).map((cell) => cell.textContent)
    expect(headerCells).toEqual(['run', 'label'])

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    expect(bodyRows).toHaveLength(2)
    for (const tr of bodyRows) {
      expect(tr.hasAttribute('tabindex')).toBe(false)
      expect(tr.hasAttribute('role')).toBe(false)
    }

    let fired = false
    view.addEventListener(SUBJECT_ROW_ACTIVATE_EVENT, () => {
      fired = true
    })
    bodyRows[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(fired).toBe(false)
  })

  it('subjectField hides its column and both a click and an Enter keydown on the third <tr> dispatch the event with that row\'s IRI', async () => {
    const columns = ['run', 'label'] as const
    const view = mountReady(columns, runRows(4))
    view.subjectColumn = 'run'
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    const headerCells = Array.from(table.rows[0]!.cells).map((cell) => cell.textContent)
    expect(headerCells).toEqual(['label']) // 'run' filtered out of the <th> set entirely

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    expect(bodyRows).toHaveLength(4)
    const thirdRow = bodyRows[2] as HTMLElement
    expect(thirdRow.getAttribute('tabindex')).toBe('0')
    expect(thirdRow.getAttribute('role')).toBe('button')
    expect(thirdRow.dataset.subjectIri).toBe('urn:x:run-3')

    const detailsSeen: string[] = []
    view.addEventListener(SUBJECT_ROW_ACTIVATE_EVENT, (event) => {
      detailsSeen.push((event as CustomEvent<SubjectRowActivateDetail>).detail.subjectIri)
    })

    thirdRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    thirdRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(detailsSeen).toEqual(['urn:x:run-3', 'urn:x:run-3'])
  })

  it('a Space keydown also activates; a non-activating key does not', async () => {
    const columns = ['run', 'label'] as const
    const view = mountReady(columns, runRows(1))
    view.subjectColumn = 'run'
    await view.updateComplete

    const row = view.shadowRoot!.querySelector('table')!.querySelector('tbody tr')! as HTMLElement
    const detailsSeen: string[] = []
    view.addEventListener(SUBJECT_ROW_ACTIVATE_EVENT, (event) => {
      detailsSeen.push((event as CustomEvent<SubjectRowActivateDetail>).detail.subjectIri)
    })

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(detailsSeen).toHaveLength(0)
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(detailsSeen).toEqual(['urn:x:run-1'])
  })

  it('a row whose subjectColumn value is not a URI (or is unbound) is never activatable', async () => {
    const columns = ['run', 'label'] as const
    const rows: QueryBlockRow[] = [
      { run: { type: 'literal', value: 'not-an-iri' }, label: { type: 'literal', value: 'a' } },
      { label: { type: 'literal', value: 'b' } }, // 'run' entirely unbound
    ]
    const view = mountReady(columns, rows)
    view.subjectColumn = 'run'
    await view.updateComplete

    const bodyRows = Array.from(view.shadowRoot!.querySelector('table')!.querySelectorAll('tbody tr'))
    for (const tr of bodyRows) {
      expect(tr.hasAttribute('tabindex')).toBe(false)
      expect(tr.hasAttribute('role')).toBe(false)
    }
  })

  it('a subjectField naming a column absent from the result is inert — same as no subjectField at all', async () => {
    const columns = ['run', 'label'] as const
    const view = mountReady(columns, runRows(2))
    view.subjectColumn = 'not-a-real-column'
    await view.updateComplete

    const table = view.shadowRoot!.querySelector('table')!
    const headerCells = Array.from(table.rows[0]!.cells).map((cell) => cell.textContent)
    expect(headerCells).toEqual(['run', 'label']) // nothing filtered
    for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
      expect(tr.hasAttribute('tabindex')).toBe(false)
    }
  })
})
