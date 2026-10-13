/**
 * download-file.ts — hand a Markdown file to the person: a Blob behind a temporary
 * link, clicked once and cleaned up. Host-side only (it needs a document).
 */

import type { MarkdownFile } from '../chat-services/conversation-export.js'

export function downloadMarkdownFile(file: MarkdownFile, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }))
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.rel = 'noopener'
  anchor.hidden = true
  doc.body.append(anchor)
  anchor.click()
  anchor.remove()
  // The browser has taken the bytes by now; release the object a little later, never sooner.
  doc.defaultView?.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
