/**
 * conversation-export.ts — a conversation, live or imported, leaving the app as
 * one Markdown file (Download) or one Garden document (Save to Garden).
 *
 * Both kinds are first read into the same NormalizedTurn shape (archive-projection),
 * so both leave through one path and read the same way in the file: a heading per
 * turn, the real time of the turn, and for an import the voice the source recorded
 * (or the plain words "voice not recorded"). An import is read to the end first,
 * page by page; if a cap stops it short, the file says so in its own note.
 */

import type { ChatMessage } from '@shrubbery/chat-kernel'
import {
  conversationToMarkdown,
  markdownFilename,
  normalizeArchiveMessage,
  normalizeChatMessage,
  type NormalizedTurn,
} from './archive-projection.js'
import { displayTitle, formatDateRange, parseIso } from './conversation-home.js'
import type { ImportedReader } from './imported-reader.js'

export interface ExportContext {
  readonly signal: AbortSignal
  onProgress(loaded: number, total: number): void
}

export interface CollectedConversation {
  readonly title: string
  readonly kind: 'live' | 'imported'
  /** 'Imported from the old garden · basis' for an import; null for a live chat. */
  readonly provenance: string | null
  /** The span of real dates in words, or null when none can be stated. */
  readonly range: string | null
  readonly note: string | null
  readonly turns: readonly NormalizedTurn[]
  /** False when the copy stops short of the whole conversation. */
  readonly complete: boolean
}

export interface ConversationExportSource {
  readonly kind: 'live' | 'imported'
  readonly title: string
  collect(context: ExportContext): Promise<CollectedConversation>
}

export interface MarkdownFile {
  readonly filename: string
  readonly mimeType: string
  readonly text: string
}

export const MARKDOWN_MIME_TYPE = 'text/markdown;charset=utf-8'

/** The span between the first and last real time among these turns, in words; null when none has one. */
function rangeOfTurns(turns: readonly NormalizedTurn[]): string | null {
  let first: number | null = null
  let last: number | null = null
  for (const turn of turns) {
    const time = parseIso(turn.occurredAt)
    if (time === null) continue
    if (first === null || time < first) first = time
    if (last === null || time > last) last = time
  }
  return first === null || last === null ? null : formatDateRange(new Date(first).toISOString(), new Date(last).toISOString())
}

/**
 * A live conversation: what was said in it, as the panel holds it at the moment the person asks.
 *
 * A conversation that picked up an imported one holds, above its seam, the window it was given. That is the old
 * conversation's text, read-only and carried over so the new voice could be shown it: it is not copied here. The person
 * chose the audience of THIS conversation; copying the window would widen the old one's without their saying so, and pass
 * its turns off as this conversation's (no seam, no "Earlier assistant"). The note says what was left out and where it
 * is: the original is saved on its own.
 */
export function liveExportSource(input: {
  readonly title: string | null
  readonly messages: readonly ChatMessage[]
  /** The title of the imported conversation this one picked up, when it did. */
  readonly continues?: string | null
}): ConversationExportSource {
  const title = displayTitle(input.title, 'live')
  return {
    kind: 'live',
    title,
    async collect(): Promise<CollectedConversation> {
      const carried = input.messages.filter(message => message.origin === 'window').length
      const turns = input.messages.filter(message => message.origin !== 'window').map(normalizeChatMessage)
      const original = (input.continues ?? '').replace(/\s+/g, ' ').trim() || 'an imported conversation'
      const note = carried === 0
        ? null
        : `This conversation continued ${original === 'an imported conversation' ? original : `\u201c${original}\u201d`}, imported from the old garden. `
          + `The ${carried} earlier message${carried === 1 ? ' it was' : 's it was'} given ${carried === 1 ? 'is' : 'are'} not copied here; save the original on its own.`
      return { title, kind: 'live', provenance: null, range: rangeOfTurns(turns), note, turns, complete: true }
    },
  }
}

/** An imported conversation: read to the end first (up to a cap), then written with its provenance and voice marks. */
export function importedExportSource(reader: ImportedReader, options: { readonly maxMessages?: number } = {}): ConversationExportSource {
  return {
    kind: 'imported',
    get title() {
      return reader.header().title
    },
    async collect(context: ExportContext): Promise<CollectedConversation> {
      const all = await reader.loadAll({ signal: context.signal, onProgress: context.onProgress, maxMessages: options.maxMessages })
      const header = reader.header()
      const turns = all.messages.map(normalizeArchiveMessage)
      const cut = all.complete ? null : `Only the first ${turns.length} of ${reader.getState().totalMessages} messages are included.`
      const note = [header.note, cut].filter((part): part is string => part !== null).join(' ') || null
      return { title: header.title, kind: 'imported', provenance: header.provenance, range: header.range, note, turns, complete: all.complete }
    },
  }
}

/** The file for a collected conversation, named after its title and the day it was made. */
export function buildMarkdownFile(collected: CollectedConversation, nowMs: number): MarkdownFile {
  const exportedAt = new Date(nowMs).toISOString()
  const text = conversationToMarkdown({
    title: collected.title,
    kind: collected.kind,
    provenance: collected.provenance,
    range: collected.range,
    exportedAt,
    note: collected.note,
    turns: collected.turns,
  })
  return { filename: markdownFilename(collected.title, exportedAt), mimeType: MARKDOWN_MIME_TYPE, text }
}
