/**
 * A Word document as HTML, by mammoth's browser build (its own lazy chunk). The HTML is not trusted: it goes through the
 * reader schema like any file-borne HTML. Mammoth's warnings (unsupported styles, …) are not the reader's business; an
 * error is.
 */
// The prebuilt browser bundle (UMD): mammoth's own `browser` field maps node-only modules, this file has them mapped.
import mammoth from 'mammoth/mammoth.browser.min.js'

export async function docxHtml(bytes: Uint8Array): Promise<{ readonly html: string; readonly note: string | null }> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const result = await mammoth.convertToHtml({ arrayBuffer }, { externalFileAccess: false })
  const html = result.value.trim()
  return { html: html || '<p></p>', note: html ? null : 'This document has no text.' }
}
