/**
 * Titles the cell makes a document with. gardend refuses to create a document whose title is over 96 characters
 * (Unicode scalar values, counted after trimming: `ids::normalize_title`, garden a901a16), so a title made from something
 * Cuts are made in whole grapheme clusters, so an accent or a family emoji is never split, and are marked with an
 * ellipsis. Only the title is cut: the file keeps its name, and a title that fits is sent exactly as it was.
 */
import { displayLabel, ELLIPSIS, graphemes } from '@shrubbery/nucleus/files-canvas'

/** The longest title gardend creates a document with, in Unicode scalar values. */
export const DOCUMENT_TITLE_MAX = 96

/** The cell counts Unicode scalar values (Rust `chars()`), not UTF-16 units and not graphemes. */
const scalars = (value: string): number => Array.from(value).length

/** `title` as it is when the cell accepts it; otherwise its head, cut in whole graphemes, and an ellipsis. */
export function documentTitle(title: string, max = DOCUMENT_TITLE_MAX): string {
  const trimmed = title.trim()
  if (scalars(trimmed) <= max) return title
  let head = ''
  let count = 0
  for (const grapheme of graphemes(trimmed)) {
    const size = scalars(grapheme)
    if (count + size + 1 > max) break // one scalar is the ellipsis's
    head += grapheme
    count += size
  }
  return `${head.trimEnd()}${ELLIPSIS}`
}

/**
 * `prefix` and a file's name. When the whole is too long the name is cut in its middle, as a file's card shows a long
 * name: its head, an ellipsis, and its last word with the extension ("Notes on Thermal test report – batch 7 – fi…review.pdf").
 */
export function fileDocumentTitle(prefix: string, name: string, max = DOCUMENT_TITLE_MAX): string {
  const whole = `${prefix}${name}`
  if (scalars(whole.trim()) <= max) return whole
  // `displayLabel` budgets graphemes; one grapheme may hold several scalar values, so narrow until the cell's count fits.
  for (let budget = max - scalars(prefix); budget > 2; budget--) {
    const title = `${prefix}${displayLabel(name, budget)}`
    if (scalars(title.trim()) <= max) return title
  }
  return documentTitle(whole, max)
}
