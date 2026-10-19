import type { ReaderAskDetail } from './mn-reader.js'

/** The words the chat's composer gets for "Ask Sophia" in the Reader: the passage quoted, and where it is from. */
export function readerAskText(detail: ReaderAskDetail): string {
  const title = detail.title.replace(/[\][]/g, '').trim() || 'this document'
  const quote = detail.quote.trim().replace(/\s+/g, ' ').slice(0, 1200)
  if (detail.scope === 'passage' && quote) return `From "${title}", ${detail.where}:\n\n> ${quote}\n\n`
  return `About ${detail.scope === 'chapter' ? 'the chapter ' : ''}${detail.where} of "${title}": `
}
