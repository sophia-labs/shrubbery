/**
 * The seam of the PDF reader (`<mn-pdf-reader>`): the data it takes and the events it says. Types only, so a host can import them
 * without loading the reader (pdf.js is lazy and loads with the element).
 */
export type AssertionStatus = 'read' | 'check' | 'checked' | 'corrected' | 'contested'

/** One thing the reader read from the PDF (a datasheet's claim): the viewer boxes it on its page and lists it. */
export interface PdfAssertion {
  /** Stable id; `assertion-select` says it back, `showAssertion(id)` takes it (the claim id of `#evidence=<id>`). */
  readonly id: string
  /** The page the reader says it is on (1-based), or null. */
  readonly page: number | null
  readonly label: string
  /** The symbol as printed ('VIN'), or ''. */
  readonly symbol: string
  /** '4.5–28 V'; '' when no value was read. */
  readonly value: string
  /** The table it came from, in words. */
  readonly group: string
  readonly conditions: readonly string[]
  /** Each separate reading and the page it was read on. */
  readonly readings: readonly { readonly text: string; readonly page: number | null }[]
  /** Diagnostics and checks, in plain words. */
  readonly notes: readonly string[]
  /** '●●○' and what it means ('one clean source'). */
  readonly mark: string
  readonly agreement: string
  readonly status: AssertionStatus
  /** The numbers the claim states: what the viewer looks for on the page to box the row. */
  readonly numbers: readonly number[]
  /** Other pages its readings were read on, tried when its own page does not print it. */
  readonly readingPages: readonly number[]
  readonly key: boolean
  /** A box the import gave: PDF user space, points, origin bottom-left (`viewport.convertToViewportRectangle([l, b, r, t])`). Drawn solid. */
  readonly box?: { readonly page: number; readonly l: number; readonly b: number; readonly r: number; readonly t: number }
  /** How exact the box is ('cell' | 'row' | 'block' | 'page') and which method made it ('docling-cell', 'pymupdf-block', ...): said on hover. */
  readonly precision?: string
  readonly method?: string
  /** Verbs a row offers (the seam for Check and Correct); `assertion-action` says one back. None while the viewer is read-only. */
  readonly actions?: readonly { readonly id: string; readonly label: string }[]
}

/** The header of the list: what the document is and what was said about the reading as a whole. */
export interface PdfReadingInfo {
  readonly heading: string
  readonly title: string
  readonly facts: readonly { readonly label: string; readonly text: string; readonly hint?: string }[]
  readonly notes: readonly string[]
  /** Said, plainly, when nothing was read ('Text only: no tables were read.'). */
  readonly empty: string | null
  readonly truncated: string | null
}

export interface PdfPageChangeDetail { readonly page: number; readonly pageCount: number }
export interface PdfLoadDetail { readonly pageCount: number; readonly hasText: boolean; readonly hasOutline: boolean }
export interface AssertionSelectDetail { readonly id: string | null; readonly page: number | null }
export interface AssertionOverlayDetail { readonly on: boolean }
export interface PdfLocationReport { readonly located: number; readonly notLocated: number; readonly total: number }
