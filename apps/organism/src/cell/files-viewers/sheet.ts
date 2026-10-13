/**
 * A workbook's sheets (XLSX, XLS, ODS) as data-table sheets, by SheetJS (its own lazy chunk). Cells are their formatted
 * text (what the spreadsheet shows); the first row is the header. Nothing in a workbook runs: formulas are read as their
 * cached values.
 */
import { read, utils } from 'xlsx'
import type { DataTableSheet } from '@shrubbery/hoja/reader'

export async function workbookSheets(bytes: Uint8Array): Promise<DataTableSheet[]> {
  const book = read(bytes, { type: 'array', dense: true, cellFormula: false, cellHTML: false, cellStyles: false })
  const sheets: DataTableSheet[] = []
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]
    if (!sheet) continue
    const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false })
      .map(row => row.map(cell => (cell === null || cell === undefined ? '' : String(cell))))
    const columns = rows.shift() ?? []
    sheets.push({ name, columns, rows })
    // Yield between sheets: a large workbook should not freeze the page.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return sheets
}
