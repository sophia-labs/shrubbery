/**
 * `dataTable` — Hoja's tabular node: one atom in the document, a virtualized grid in the view.
 *
 * A data file (a CSV of 200,000 rows, a workbook) cannot be ProseMirror table cells: the document would be millions of
 * nodes. So the node is small — a reference (`ref`) into a side store, or a little inline `data` for a document that
 * embeds a few rows — and the NodeView draws only the rows in sight:
 *
 * - a sticky header row, a sticky row-number gutter and a sticky first column;
 * - column widths measured from the content, each resizable by dragging its edge;
 * - click a header to sort (ascending, descending, back to the file's order); numbers right-aligned, detected per column;
 * - a cell cursor (arrows, Home/End, Ctrl+Home/End, PgUp/PgDn), Shift extends a selection, Mod+C copies it as TSV;
 * - sheet tabs above the grid when the model has more than one sheet; the row count in a footer.
 *
 * Read-only by construction: nothing in a cell is ever parsed as markup (cells are text nodes). House tokens only.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { adoptEditorStylesWhenConnected } from '../editor-styles'
import type { ClipboardWriter } from './copyable-code-block'

export interface DataTableSheet {
  readonly name: string
  /** Header labels. A missing or empty label is shown as the column's letter. */
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  /** Said in the footer after the counts (for example "first 1,000,000 rows of the sheet"). */
  readonly note?: string
}

export interface DataTableModel {
  readonly sheets: readonly DataTableSheet[]
}

const store = new Map<string, DataTableModel>()
let refSequence = 0

/** Put a model in the side store; the node carries only the returned reference. */
export function registerDataTable(model: DataTableModel): string {
  const ref = `data-table-${++refSequence}-${Date.now().toString(36)}`
  store.set(ref, model)
  return ref
}

/** Let go of a model (the viewer that registered it has closed). */
export function releaseDataTable(ref: string): void {
  store.delete(ref)
}

export function dataTableModel(ref: string | null | undefined): DataTableModel | null {
  return ref ? store.get(ref) ?? null : null
}

export interface DataTableOptions {
  writeClipboard?: ClipboardWriter
}

const NUMBER = /^[-+]?(?:[$€£¥]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/
const DIGIT = /\d/

/** Whether a cell reads as a number ("1,234.5", "-3e4", "12%", "$40"). */
export function looksNumeric(value: string): boolean {
  const v = value.trim()
  return v.length > 0 && v.length < 40 && DIGIT.test(v) && NUMBER.test(v)
}

/** The number a numeric cell says, or NaN. */
export function numericValue(value: string): number {
  const v = value.trim().replace(/[$€£¥,\s%]/g, '')
  return v ? Number(v) : Number.NaN
}

/** A column is numeric when at least 95% of its first 1,000 non-empty cells are. */
export function detectNumericColumns(sheet: DataTableSheet, columnCount: number): boolean[] {
  const out: boolean[] = []
  for (let c = 0; c < columnCount; c++) {
    let seen = 0
    let numeric = 0
    for (let r = 0; r < sheet.rows.length && seen < 1000; r++) {
      const v = sheet.rows[r]?.[c]
      if (v === undefined || v.trim() === '') continue
      seen++
      if (looksNumeric(v)) numeric++
    }
    out.push(seen > 0 && numeric / seen >= 0.95)
  }
  return out
}

/** Spreadsheet letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** The order of the rows when sorted by `column` (stable; empty cells last either way). */
export function sortOrder(sheet: DataTableSheet, column: number, direction: 'asc' | 'desc', numeric: boolean): Uint32Array {
  const n = sheet.rows.length
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  const sign = direction === 'asc' ? 1 : -1
  const indices = Array.from(order)
  if (numeric) {
    const keys = new Float64Array(n)
    for (let i = 0; i < n; i++) keys[i] = numericValue(sheet.rows[i]?.[column] ?? '')
    indices.sort((a, b) => {
      const x = keys[a]!, y = keys[b]!
      const xn = Number.isNaN(x), yn = Number.isNaN(y)
      if (xn || yn) return xn && yn ? a - b : xn ? 1 : -1
      return x === y ? a - b : (x < y ? -1 : 1) * sign
    })
  } else {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    indices.sort((a, b) => {
      const x = sheet.rows[a]?.[column] ?? '', y = sheet.rows[b]?.[column] ?? ''
      if (!x || !y) return !x && !y ? a - b : !x ? 1 : -1
      return collator.compare(x, y) * sign || a - b
    })
  }
  order.set(indices)
  return order
}

const MAX_SCROLL_HEIGHT = 8_000_000
const OVERSCAN = 6
const MIN_COLUMN = 44
const MAX_AUTO_COLUMN = 360

export const DATA_TABLE_CSS = `
.hoja-data-table {
  --hoja-dt-row: 26px;
  display: flex;
  flex-direction: column;
  height: var(--hoja-data-table-height, 420px);
  min-height: 160px;
  border: 1px solid var(--mn-color-border-default, #c9d2cc);
  border-radius: var(--mn-radius-control, 6px);
  background: var(--mn-color-surface-base, #fff);
  color: var(--mn-color-text-primary, #222a25);
  font: var(--mn-text-sm, 13px) / 1.2 var(--mn-font-sans, system-ui, sans-serif);
  overflow: hidden;
  white-space: normal;
}
.hoja-data-table .dt-tabs { display: flex; gap: 2px; padding: 4px 6px 0; overflow-x: auto; flex: 0 0 auto;
  border-bottom: 1px solid var(--mn-color-border-subtle, #e1e7e3); background: var(--mn-color-surface-subtle, #f4f6f4); }
.hoja-data-table .dt-tabs[hidden] { display: none; }
.hoja-data-table .dt-tabs button { font: inherit; color: var(--mn-color-text-secondary, #4d5952); background: transparent; cursor: pointer;
  border: 1px solid transparent; border-bottom: 0; border-radius: var(--mn-radius-control, 6px) var(--mn-radius-control, 6px) 0 0;
  padding: 4px 10px; white-space: nowrap; }
.hoja-data-table .dt-tabs button[aria-selected='true'] { color: var(--mn-color-text-primary, #222a25); background: var(--mn-color-surface-base, #fff);
  border-color: var(--mn-color-border-subtle, #e1e7e3); margin-bottom: -1px; font-weight: 600; }
.hoja-data-table .dt-tabs button:focus-visible, .hoja-data-table .dt-viewport:focus-visible { outline: none; box-shadow: var(--mn-focus-ring, 0 0 0 2px #39765a); }
.hoja-data-table .dt-viewport { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; outline: none; overscroll-behavior: contain; }
.hoja-data-table .dt-head, .hoja-data-table .dt-row { display: grid; grid-template-columns: var(--dt-cols); width: var(--dt-width); }
.hoja-data-table .dt-head { position: sticky; top: 0; z-index: 3; background: var(--mn-color-surface-subtle, #f4f6f4);
  border-bottom: 1px solid var(--mn-color-border-default, #c9d2cc); font-weight: 600; }
.hoja-data-table .dt-body { position: relative; width: var(--dt-width); }
.hoja-data-table .dt-row { position: absolute; left: 0; top: 0; height: var(--hoja-dt-row); will-change: transform; }
.hoja-data-table .dt-cell { box-sizing: border-box; height: var(--hoja-dt-row); line-height: calc(var(--hoja-dt-row) - 1px); padding: 0 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-right: 1px solid var(--mn-color-border-subtle, #e1e7e3);
  border-bottom: 1px solid var(--mn-color-border-subtle, #e1e7e3); background: var(--mn-color-surface-base, #fff); cursor: cell; user-select: none; }
.hoja-data-table .dt-head .dt-cell { position: relative; display: flex; align-items: center; gap: 4px; padding-right: 10px;
  background: var(--mn-color-surface-subtle, #f4f6f4); cursor: pointer; }
.hoja-data-table .dt-head .dt-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hoja-data-table .dt-head .dt-sort { flex: 0 0 auto; color: var(--mn-color-text-accent, #2e6a4f); font-size: 0.85em; }
.hoja-data-table .dt-head .dt-cell.num { flex-direction: row-reverse; }
.hoja-data-table .dt-cell.num { text-align: right; font-variant-numeric: tabular-nums; }
.hoja-data-table .dt-gutter { position: sticky; left: 0; z-index: 1; color: var(--mn-color-text-muted, #768079); text-align: right;
  background: var(--mn-color-surface-subtle, #f4f6f4); font-variant-numeric: tabular-nums; cursor: default; }
.hoja-data-table .dt-first { position: sticky; z-index: 1; left: var(--dt-gutter); box-shadow: 1px 0 0 var(--mn-color-border-default, #c9d2cc); }
.hoja-data-table .dt-head .dt-gutter, .hoja-data-table .dt-head .dt-first { position: sticky; z-index: 4; }
.hoja-data-table .dt-row:hover .dt-cell { background: var(--mn-color-interactive-hover, var(--mn-color-surface-hover, #eef2ef)); }
.hoja-data-table .dt-cell.selected { background: var(--mn-color-interactive-selected, var(--mn-color-surface-accent-subtle, #e3efe8)); }
.hoja-data-table .dt-cell.cursor { box-shadow: inset 0 0 0 2px var(--mn-color-border-focus, var(--mn-color-accent, #39765a)); }
.hoja-data-table .dt-viewport:not(:focus) .dt-cell.cursor { box-shadow: inset 0 0 0 1px var(--mn-color-border-default, #c9d2cc); }
.hoja-data-table .dt-resize { position: absolute; top: 0; right: 0; width: 8px; height: 100%; cursor: col-resize; z-index: 5; touch-action: none; }
.hoja-data-table .dt-resize:hover, .hoja-data-table .dt-resize.dragging { background: var(--mn-color-border-focus, var(--mn-color-accent, #39765a)); opacity: 0.5; }
.hoja-data-table .dt-foot { display: flex; gap: 12px; flex: 0 0 auto; align-items: center; min-height: 26px; padding: 0 8px;
  border-top: 1px solid var(--mn-color-border-subtle, #e1e7e3); color: var(--mn-color-text-secondary, #4d5952);
  background: var(--mn-color-surface-subtle, #f4f6f4); font-size: var(--mn-text-xs, 12px); }
.hoja-data-table .dt-foot .dt-where { margin-left: auto; font-variant-numeric: tabular-nums; }
.hoja-data-table .dt-empty { padding: 16px; color: var(--mn-color-text-muted, #768079); }
`

interface Sort { readonly column: number; readonly direction: 'asc' | 'desc' }
interface Cell { readonly row: number; readonly col: number }

let gridSequence = 0

/** The grid itself, independent of ProseMirror (the NodeView is a thin shell around it). */
export class DataTableGrid {
  readonly dom: HTMLElement
  private readonly tabs: HTMLElement
  private readonly viewport: HTMLElement
  private readonly head: HTMLElement
  private readonly body: HTMLElement
  private readonly foot: HTMLElement
  private readonly id = `hoja-dt-${++gridSequence}`
  private model: DataTableModel
  private sheetIndex = 0
  private columnCount = 0
  private widths: number[] = []
  private gutterWidth = 48
  private numeric: boolean[] = []
  private order: Uint32Array | null = null
  private sort: Sort | null = null
  private cursor: Cell = { row: 0, col: 0 }
  private anchor: Cell = { row: 0, col: 0 }
  private rowHeight = 26
  private pool: HTMLElement[] = []
  private frame = 0
  /** Whether the widths were measured in the live font (the grid is built before it is attached). */
  private measuredLive = false
  private readonly resizeObserver: ResizeObserver | null
  private readonly listeners: (() => void)[] = []

  constructor(model: DataTableModel, private readonly options: DataTableOptions = {}, caption = '') {
    this.model = model
    const doc = document
    this.dom = doc.createElement('div')
    this.dom.className = 'hoja-data-table'
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.dataset.dataTable = ''
    this.tabs = doc.createElement('div')
    this.tabs.className = 'dt-tabs'
    this.tabs.setAttribute('role', 'tablist')
    this.tabs.setAttribute('aria-label', 'Sheets')
    this.viewport = doc.createElement('div')
    this.viewport.className = 'dt-viewport'
    this.viewport.tabIndex = 0
    this.viewport.setAttribute('role', 'grid')
    this.viewport.setAttribute('aria-readonly', 'true')
    if (caption) this.viewport.setAttribute('aria-label', caption)
    this.head = doc.createElement('div')
    this.head.className = 'dt-head'
    this.head.setAttribute('role', 'row')
    this.head.setAttribute('aria-rowindex', '1')
    this.body = doc.createElement('div')
    this.body.className = 'dt-body'
    this.body.setAttribute('role', 'rowgroup')
    this.foot = doc.createElement('div')
    this.foot.className = 'dt-foot'
    this.viewport.append(this.head, this.body)
    this.dom.append(this.tabs, this.viewport, this.foot)
    adoptEditorStylesWhenConnected(this.dom, 'hoja-data-table', DATA_TABLE_CSS)

    this.on(this.viewport, 'scroll', () => this.schedule())
    this.on(this.viewport, 'keydown', e => this.keydown(e as KeyboardEvent))
    this.on(this.viewport, 'mousedown', e => this.mousedown(e as MouseEvent))
    this.on(this.viewport, 'copy', e => this.copyEvent(e as ClipboardEvent))
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.schedule()) : null
    this.resizeObserver?.observe(this.viewport)
    this.showSheet(0)
  }

  private on(target: EventTarget, type: string, handler: (e: Event) => void): void {
    target.addEventListener(type, handler)
    this.listeners.push(() => target.removeEventListener(type, handler))
  }

  private get sheet(): DataTableSheet {
    return this.model.sheets[this.sheetIndex] ?? { name: '', columns: [], rows: [] }
  }

  private get rowCount(): number { return this.sheet.rows.length }

  /** Replace the model (the node's attrs changed). */
  setModel(model: DataTableModel): void {
    this.model = model
    this.showSheet(Math.min(this.sheetIndex, Math.max(0, model.sheets.length - 1)))
  }

  /** Switch to another sheet: its own columns, widths and number detection; sort and cursor start over. */
  showSheet(index: number): void {
    this.sheetIndex = index
    const sheet = this.sheet
    this.columnCount = sheet.columns.length
    for (let r = 0; r < Math.min(sheet.rows.length, 2000); r++) this.columnCount = Math.max(this.columnCount, sheet.rows[r]!.length)
    this.numeric = detectNumericColumns(sheet, this.columnCount)
    this.order = null
    this.sort = null
    this.cursor = { row: 0, col: 0 }
    this.anchor = this.cursor
    this.viewport.scrollTop = 0
    this.viewport.scrollLeft = 0
    this.viewport.setAttribute('aria-rowcount', String(sheet.rows.length + 1))
    this.viewport.setAttribute('aria-colcount', String(this.columnCount + 1))
    this.renderTabs()
    this.measure()
    this.renderHead()
    for (const row of this.pool) row.remove()
    this.pool = []
    this.renderFoot()
    this.render()
  }

  private renderTabs(): void {
    const sheets = this.model.sheets
    this.tabs.hidden = sheets.length < 2
    this.tabs.replaceChildren(...sheets.map((sheet, index) => {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', index === this.sheetIndex ? 'true' : 'false')
      tab.tabIndex = index === this.sheetIndex ? 0 : -1
      tab.textContent = sheet.name || `Sheet ${index + 1}`
      tab.dataset.sheet = String(index)
      tab.addEventListener('click', () => { if (index !== this.sheetIndex) this.showSheet(index) })
      tab.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        e.preventDefault()
        const next = (this.sheetIndex + (e.key === 'ArrowRight' ? 1 : -1) + sheets.length) % sheets.length
        this.showSheet(next)
        ;(this.tabs.children[next] as HTMLElement | undefined)?.focus()
      })
      return tab
    }))
  }

  private label(col: number): string {
    const name = this.sheet.columns[col]
    return name && name.trim() ? name : columnLetter(col)
  }

  /** Column widths from the header and a sample of rows, measured in the grid's own font. */
  private measure(): void {
    const style = typeof getComputedStyle === 'function' && this.dom.isConnected ? getComputedStyle(this.dom) : null
    const rowVar = style ? Number.parseFloat(style.getPropertyValue('--hoja-dt-row')) : Number.NaN
    this.rowHeight = Number.isFinite(rowVar) && rowVar > 12 ? rowVar : 26
    const canvas = document.createElement('canvas')
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
    const font = style ? `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` : '13px system-ui, sans-serif'
    const width = (text: string, bold = false): number => {
      if (!ctx) return text.length * 7.2
      ctx.font = bold ? `600 ${font.replace(/^\S+\s/, '')}` : font
      return ctx.measureText(text).width
    }
    const rows = this.sheet.rows
    const sample: number[] = []
    for (let i = 0; i < Math.min(rows.length, 150); i++) sample.push(i)
    if (rows.length > 150) for (let i = 0; i < 100; i++) sample.push(Math.floor((i / 100) * rows.length))
    this.widths = []
    for (let c = 0; c < this.columnCount; c++) {
      let w = width(this.label(c), true) + 30
      for (const r of sample) {
        const v = rows[r]?.[c]
        // Padding, the border and tabular digits (wider than the font's proportional ones) on top of the text.
        if (v) w = Math.max(w, Math.min(MAX_AUTO_COLUMN, width(v.length > 80 ? v.slice(0, 80) : v) * (this.numeric[c] ? 1.12 : 1) + 26))
      }
      this.widths.push(Math.max(MIN_COLUMN, Math.min(MAX_AUTO_COLUMN, Math.ceil(w))))
    }
    this.gutterWidth = Math.max(40, Math.ceil(width(rows.length.toLocaleString()) * 1.12 + 24))
    this.measuredLive = style !== null
    this.applyColumns()
  }

  private applyColumns(): void {
    const total = this.gutterWidth + this.widths.reduce((a, b) => a + b, 0)
    this.viewport.style.setProperty('--dt-cols', [this.gutterWidth, ...this.widths].map(w => `${w}px`).join(' '))
    this.viewport.style.setProperty('--dt-width', `${total}px`)
    this.viewport.style.setProperty('--dt-gutter', `${this.gutterWidth}px`)
  }

  private renderHead(): void {
    const cells: HTMLElement[] = []
    const corner = document.createElement('div')
    corner.className = 'dt-cell dt-gutter'
    corner.setAttribute('role', 'columnheader')
    corner.setAttribute('aria-label', 'Row')
    cells.push(corner)
    for (let c = 0; c < this.columnCount; c++) {
      const cell = document.createElement('div')
      cell.className = `dt-cell${c === 0 ? ' dt-first' : ''}${this.numeric[c] ? ' num' : ''}`
      cell.setAttribute('role', 'columnheader')
      cell.dataset.col = String(c)
      const sorted = this.sort?.column === c ? this.sort.direction : null
      cell.setAttribute('aria-sort', sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none')
      cell.title = `${this.label(c)} — click to sort`
      const label = document.createElement('span')
      label.className = 'dt-label'
      label.textContent = this.label(c)
      const mark = document.createElement('span')
      mark.className = 'dt-sort'
      mark.setAttribute('aria-hidden', 'true')
      mark.textContent = sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''
      const grip = document.createElement('span')
      grip.className = 'dt-resize'
      grip.setAttribute('aria-hidden', 'true')
      grip.addEventListener('pointerdown', e => this.startResize(e, c, grip))
      grip.addEventListener('click', e => e.stopPropagation())
      cell.append(label, mark, grip)
      cell.addEventListener('click', () => this.toggleSort(c))
      cells.push(cell)
    }
    this.head.replaceChildren(...cells)
  }

  private startResize(event: PointerEvent, col: number, grip: HTMLElement): void {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const start = this.widths[col] ?? MIN_COLUMN
    grip.classList.add('dragging')
    try { grip.setPointerCapture(event.pointerId) } catch { /* synthetic events have no capture */ }
    const move = (e: PointerEvent) => {
      this.widths[col] = Math.max(MIN_COLUMN, Math.round(start + e.clientX - startX))
      this.applyColumns()
    }
    const up = () => {
      grip.classList.remove('dragging')
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }

  /** Header click: ascending, then descending, then the file's own order. */
  toggleSort(col: number): void {
    const now = this.sort?.column === col ? this.sort.direction : null
    const next: Sort | null = now === null ? { column: col, direction: 'asc' } : now === 'asc' ? { column: col, direction: 'desc' } : null
    this.sort = next
    this.order = next ? sortOrder(this.sheet, next.column, next.direction, this.numeric[col] ?? false) : null
    this.renderHead()
    this.renderFoot()
    for (const row of this.pool) row.dataset.index = ''
    this.render()
  }

  private dataRow(viewRow: number): readonly string[] {
    const index = this.order ? this.order[viewRow]! : viewRow
    return this.sheet.rows[index] ?? []
  }

  private headHeight(): number {
    return this.head.offsetHeight || this.rowHeight
  }

  /** Scroll geometry: a very tall table is scaled into MAX_SCROLL_HEIGHT and rows are placed relative to the scroll. */
  private geometry(): { first: number; last: number; offset: number; scale: number } {
    const n = this.rowCount
    const view = Math.max(this.rowHeight, this.viewport.clientHeight - this.headHeight())
    const total = n * this.rowHeight
    const height = Math.min(total, MAX_SCROLL_HEIGHT)
    const top = this.viewport.scrollTop
    const scale = total > height && height > view ? (total - view) / (height - view) : 1
    const offset = top * scale - top
    const firstExact = (top * scale) / this.rowHeight
    const first = Math.max(0, Math.floor(firstExact) - OVERSCAN)
    const last = Math.min(n - 1, Math.ceil(firstExact + view / this.rowHeight) + OVERSCAN)
    return { first, last, offset, scale }
  }

  private schedule(): void {
    if (this.frame) return
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number
    this.frame = raf(() => { this.frame = 0; this.render() })
  }

  /** Draw the rows in sight (and a few more), reusing row elements. */
  render(): void {
    if (!this.measuredLive && this.dom.isConnected) this.measure()
    const n = this.rowCount
    this.body.style.height = `${Math.min(n * this.rowHeight, MAX_SCROLL_HEIGHT)}px`
    if (n === 0) {
      for (const row of this.pool) row.remove()
      this.pool = []
      return
    }
    const { first, last, offset } = this.geometry()
    const count = Math.max(0, last - first + 1)
    while (this.pool.length < count) {
      const row = document.createElement('div')
      row.className = 'dt-row'
      row.setAttribute('role', 'row')
      for (let c = 0; c <= this.columnCount; c++) {
        const cell = document.createElement('div')
        cell.className = c === 0 ? 'dt-cell dt-gutter' : `dt-cell${c === 1 ? ' dt-first' : ''}${this.numeric[c - 1] ? ' num' : ''}`
        cell.setAttribute('role', c === 0 ? 'rowheader' : 'gridcell')
        if (c > 0) cell.dataset.col = String(c - 1)
        row.appendChild(cell)
      }
      this.body.appendChild(row)
      this.pool.push(row)
    }
    while (this.pool.length > count) this.pool.pop()!.remove()
    const lo = Math.min(this.cursor.row, this.anchor.row), hi = Math.max(this.cursor.row, this.anchor.row)
    const left = Math.min(this.cursor.col, this.anchor.col), right = Math.max(this.cursor.col, this.anchor.col)
    const ranged = lo !== hi || left !== right
    let active = ''
    for (let k = 0; k < count; k++) {
      const viewRow = first + k
      const row = this.pool[k]!
      row.style.transform = `translateY(${viewRow * this.rowHeight - offset}px)`
      const cells = row.children
      if (row.dataset.index !== String(viewRow)) {
        row.dataset.index = String(viewRow)
        row.setAttribute('aria-rowindex', String(viewRow + 2))
        const data = this.dataRow(viewRow)
        ;(cells[0] as HTMLElement).textContent = (viewRow + 1).toLocaleString()
        for (let c = 0; c < this.columnCount; c++) {
          const cell = cells[c + 1] as HTMLElement
          const value = data[c] ?? ''
          if (cell.textContent !== value) cell.textContent = value
        }
      }
      for (let c = 0; c < this.columnCount; c++) {
        const cell = cells[c + 1] as HTMLElement
        const isCursor = viewRow === this.cursor.row && c === this.cursor.col
        const inRange = ranged && viewRow >= lo && viewRow <= hi && c >= left && c <= right
        cell.classList.toggle('cursor', isCursor)
        cell.classList.toggle('selected', inRange)
        if (isCursor) {
          cell.id = `${this.id}-cursor`
          cell.setAttribute('aria-selected', 'true')
          active = cell.id
        } else if (cell.id) {
          cell.removeAttribute('id')
          cell.removeAttribute('aria-selected')
        }
      }
    }
    if (active) this.viewport.setAttribute('aria-activedescendant', active)
    else this.viewport.removeAttribute('aria-activedescendant')
  }

  private renderFoot(): void {
    const sheet = this.sheet
    const rows = sheet.rows.length
    const parts = [`${rows.toLocaleString()} ${rows === 1 ? 'row' : 'rows'}`, `${this.columnCount.toLocaleString()} ${this.columnCount === 1 ? 'column' : 'columns'}`]
    if (this.sort) parts.push(`sorted by ${this.label(this.sort.column)} ${this.sort.direction === 'asc' ? '▲' : '▼'}`)
    if (sheet.note) parts.push(sheet.note)
    const counts = document.createElement('span')
    counts.className = 'dt-counts'
    counts.textContent = parts.join(' · ')
    const where = document.createElement('span')
    where.className = 'dt-where'
    where.setAttribute('aria-live', 'polite')
    this.foot.replaceChildren(counts, where)
    this.renderWhere()
  }

  private renderWhere(): void {
    const where = this.foot.querySelector('.dt-where')
    if (!where || this.rowCount === 0) return
    const rows = Math.abs(this.cursor.row - this.anchor.row) + 1, cols = Math.abs(this.cursor.col - this.anchor.col) + 1
    where.textContent = rows * cols > 1 ? `${rows} × ${cols} selected` : `${columnLetter(this.cursor.col)}${(this.cursor.row + 1).toLocaleString()}`
  }

  private cellAt(target: EventTarget | null): Cell | null {
    const el = target instanceof Element ? target.closest('.dt-row .dt-cell[data-col]') as HTMLElement | null : null
    const row = el?.parentElement?.dataset.index
    if (!el || row === undefined || row === '') return null
    return { row: Number(row), col: Number(el.dataset.col) }
  }

  private mousedown(event: MouseEvent): void {
    const cell = this.cellAt(event.target)
    if (!cell) return
    event.preventDefault()
    this.viewport.focus({ preventScroll: true })
    this.moveTo(cell, event.shiftKey)
  }

  private moveTo(cell: Cell, extend: boolean): void {
    const row = Math.max(0, Math.min(this.rowCount - 1, cell.row))
    const col = Math.max(0, Math.min(this.columnCount - 1, cell.col))
    this.cursor = { row, col }
    if (!extend) this.anchor = this.cursor
    this.reveal()
    this.renderWhere()
    this.render()
  }

  /** Scroll so the cursor is in sight (under the sticky header, right of the sticky columns). */
  private reveal(): void {
    const { scale } = this.geometry()
    const view = this.viewport.clientHeight - this.headHeight()
    const top = this.cursor.row * this.rowHeight
    const shown = this.viewport.scrollTop * scale
    if (top < shown) this.viewport.scrollTop = top / scale
    else if (top + this.rowHeight > shown + view) this.viewport.scrollTop = (top + this.rowHeight - view) / scale
    if (this.cursor.col > 0) {
      let x = this.gutterWidth
      for (let c = 0; c < this.cursor.col; c++) x += this.widths[c] ?? 0
      const w = this.widths[this.cursor.col] ?? 0
      const pinned = this.gutterWidth + (this.widths[0] ?? 0)
      if (x - pinned < this.viewport.scrollLeft) this.viewport.scrollLeft = x - pinned
      else if (x + w > this.viewport.scrollLeft + this.viewport.clientWidth) this.viewport.scrollLeft = x + w - this.viewport.clientWidth
    } else this.viewport.scrollLeft = 0
  }

  private keydown(event: KeyboardEvent): void {
    if (event.target !== this.viewport) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && (event.key === 'c' || event.key === 'C')) {
      const text = this.selectionText()
      const writer = this.options.writeClipboard ?? (navigator.clipboard?.writeText ? (t: string) => navigator.clipboard.writeText(t) : null)
      if (writer) {
        event.preventDefault()
        void Promise.resolve(writer(text)).catch(() => undefined)
      }
      return
    }
    if (mod && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      this.anchor = { row: 0, col: 0 }
      this.cursor = { row: this.rowCount - 1, col: this.columnCount - 1 }
      this.renderWhere()
      this.render()
      return
    }
    const page = Math.max(1, Math.floor((this.viewport.clientHeight - this.headHeight()) / this.rowHeight) - 1)
    const { row, col } = this.cursor
    let next: Cell | null = null
    switch (event.key) {
      case 'ArrowDown': next = { row: mod ? this.rowCount - 1 : row + 1, col }; break
      case 'ArrowUp': next = { row: mod ? 0 : row - 1, col }; break
      case 'ArrowRight': next = { row, col: mod ? this.columnCount - 1 : col + 1 }; break
      case 'ArrowLeft': next = { row, col: mod ? 0 : col - 1 }; break
      case 'Home': next = mod ? { row: 0, col: 0 } : { row, col: 0 }; break
      case 'End': next = mod ? { row: this.rowCount - 1, col: this.columnCount - 1 } : { row, col: this.columnCount - 1 }; break
      case 'PageDown': next = { row: row + page, col }; break
      case 'PageUp': next = { row: row - page, col }; break
      default: return
    }
    event.preventDefault()
    this.moveTo(next, event.shiftKey)
  }

  /** The selection (or the cursor's cell) as tab-separated text, in the order shown. */
  selectionText(): string {
    const lo = Math.min(this.cursor.row, this.anchor.row), hi = Math.max(this.cursor.row, this.anchor.row)
    const left = Math.min(this.cursor.col, this.anchor.col), right = Math.max(this.cursor.col, this.anchor.col)
    const lines: string[] = []
    for (let r = lo; r <= hi && r < this.rowCount; r++) {
      const data = this.dataRow(r)
      const cells: string[] = []
      for (let c = left; c <= right; c++) {
        const v = data[c] ?? ''
        cells.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
      }
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }

  private copyEvent(event: ClipboardEvent): void {
    if (!event.clipboardData || this.rowCount === 0) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', this.selectionText())
  }

  destroy(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    for (const off of this.listeners) off()
  }
}

function modelOf(node: ProseMirrorNode): DataTableModel {
  const inline = node.attrs.data as DataTableModel | DataTableSheet | null
  const stored = dataTableModel(node.attrs.ref as string | null)
  if (stored) return stored
  if (inline && 'sheets' in inline && Array.isArray(inline.sheets)) return inline
  if (inline && 'rows' in inline && Array.isArray(inline.rows)) return { sheets: [inline] }
  return { sheets: [] }
}

export const DataTable = Node.create<DataTableOptions>({
  name: 'dataTable',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { writeClipboard: undefined }
  },

  addAttributes() {
    return {
      ref: { default: null, renderHTML: attrs => (attrs.ref ? { 'data-ref': attrs.ref } : {}), parseHTML: () => null },
      data: { default: null, rendered: false },
      caption: { default: null, renderHTML: attrs => (attrs.caption ? { 'aria-label': attrs.caption } : {}), parseHTML: () => null },
    }
  },

  // Created programmatically only: a data table never comes out of pasted or file-borne HTML.
  parseHTML() {
    return []
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'data-table' }, HTMLAttributes)]
  },

  addNodeView() {
    return ({ node }) => {
      let current = node
      const grid = new DataTableGrid(modelOf(node), this.options, (node.attrs.caption as string | null) ?? '')
      const view: NodeView = {
        dom: grid.dom,
        update(next) {
          if (next.type !== current.type) return false
          if (next.attrs.ref !== current.attrs.ref || next.attrs.data !== current.attrs.data) grid.setModel(modelOf(next))
          current = next
          return true
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => grid.destroy(),
      }
      return view
    }
  },
})
