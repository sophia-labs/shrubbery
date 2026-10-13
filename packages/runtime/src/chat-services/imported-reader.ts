/**
 * imported-reader.ts — one imported conversation, opened for reading.
 *
 * The reader holds what the gateway has served of one archived conversation so far
 * (a revision, a page of messages at a time), and derives from it everything the
 * drawer shows: the transcript in the kernel's vocabulary, the provenance line,
 * the real date range, the voices, the plain-language completeness note, and the
 * "Continue with…" intent. It touches no DOM and starts no request the person did
 * not cause (opening, reading on, choosing another revision, exporting).
 *
 * Doctrine carried here:
 *   - An import is testimony from another system. The reader shows it and never
 *     acts on it: nothing in a message can start a request.
 *   - A date is one the source recorded. A range the gateway did not send is
 *     derived from loaded messages only when every message is loaded; otherwise it
 *     is left out rather than guessed from the first page.
 *   - A late answer for a request that was superseded (another revision, another
 *     open) is discarded, never applied.
 */

import type { ChatMessage } from '@shrubbery/chat-kernel'
import type { ArchiveMessage, ArchiveRevision, ArchivedConversation, ConversationArchive } from './conversation-archive.js'
import { completenessNote, messageCountLine, projectArchiveMessages, type ProjectedTranscript } from './archive-projection.js'
import {
  describeArchiveFailure,
  displayTitle,
  formatDateRange,
  importedProvenanceText,
  modelDisplayName,
  parseIso,
  type ArchiveFailure,
} from './conversation-home.js'

/** What "Continue with…" asks of whatever can continue a conversation. */
export interface ContinueConversationIntent {
  readonly conversationId: string
  readonly revisionId: string
  readonly title: string
  /** How many messages the reader holds right now (the continuation may read more from the archive). */
  readonly messagesLoaded: number
}

export interface ImportedReaderState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly failure: ArchiveFailure | null
  readonly revisions: readonly ArchiveRevision[]
  readonly revisionId: string
  readonly messages: readonly ArchiveMessage[]
  readonly nextCursor: number | null
  readonly totalMessages: number
  readonly completeness: { status: string; reason: string } | null
  readonly loadingMore: boolean
  /** A later page failed; what was read stays, and this says why the rest is not here. */
  readonly moreFailure: ArchiveFailure | null
}

export interface ImportedReaderHeader {
  readonly title: string
  /** 'Imported from the old garden', plus the basis when the gateway recorded one. */
  readonly provenance: string
  /** The span of real dates, in words, or null when it cannot be stated honestly. */
  readonly range: string | null
  /** The voices the source recorded for the conversation, 'Kimi K2.5, GPT 4o'; null when none was recorded. */
  readonly voices: string | null
  readonly countLine: string
  readonly note: string | null
}

export interface LoadAllOptions {
  /** Stops reading once at least this many messages are held (may pass it by less than a page). */
  readonly maxMessages?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (loaded: number, total: number) => void
}

export interface LoadAllResult {
  readonly messages: readonly ArchiveMessage[]
  /** False when the copy stops short: the cap was reached or the person cancelled. */
  readonly complete: boolean
}

export interface ImportedReader {
  readonly conversation: ArchivedConversation
  getState(): ImportedReaderState
  subscribe(listener: () => void): () => void
  open(): Promise<void>
  loadMore(): Promise<void>
  switchRevision(revisionId: string): Promise<void>
  /** Reads every remaining page, in order. Rejects with the archive's own error if a page fails. */
  loadAll(options?: LoadAllOptions): Promise<LoadAllResult>
  /** The same object until a message is added. */
  transcript(): ProjectedTranscript
  /** A stable formatter for the panel's per-message line: the date and the recorded voice. */
  annotate(message: ChatMessage): string | null
  header(): ImportedReaderHeader
  continueIntent(): ContinueConversationIntent
  dispose(): void
}

/** Enough for any conversation in the archive today (the largest holds about 1,400 messages). */
export const DEFAULT_MAX_EXPORT_MESSAGES = 5000

export function createImportedReader(archive: ConversationArchive, conversation: ArchivedConversation): ImportedReader {
  let disposed = false
  let generation = 0
  let inflight: Promise<void> | null = null
  let state: ImportedReaderState = {
    status: 'loading',
    failure: null,
    revisions: [],
    revisionId: conversation.revision.revisionId,
    messages: [],
    nextCursor: null,
    totalMessages: 0,
    completeness: null,
    loadingMore: false,
    moreFailure: null,
  }
  const listeners = new Set<() => void>()

  function commit(next: Partial<ImportedReaderState>): void {
    if (disposed) return
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }

  const blank: Partial<ImportedReaderState> = {
    status: 'loading', failure: null, messages: [], nextCursor: null, totalMessages: 0, completeness: null, loadingMore: false, moreFailure: null,
  }

  async function open(): Promise<void> {
    const mine = ++generation
    inflight = null
    commit(blank)
    try {
      const [revisions, page] = await Promise.all([
        archive.revisions(conversation.conversationId),
        archive.messages(conversation.conversationId, state.revisionId, 0),
      ])
      if (disposed || mine !== generation) return
      commit({ status: 'ready', revisions, messages: page.messages, nextCursor: page.nextCursor, totalMessages: page.totalMessages, completeness: page.completeness })
    } catch (error) {
      if (disposed || mine !== generation) return
      commit({ status: 'error', failure: describeArchiveFailure(error) })
    }
  }

  async function switchRevision(revisionId: string): Promise<void> {
    const mine = ++generation
    inflight = null
    commit({ ...blank, revisionId })
    try {
      const page = await archive.messages(conversation.conversationId, revisionId, 0)
      if (disposed || mine !== generation) return
      commit({ status: 'ready', messages: page.messages, nextCursor: page.nextCursor, totalMessages: page.totalMessages, completeness: page.completeness })
    } catch (error) {
      if (disposed || mine !== generation) return
      commit({ status: 'error', failure: describeArchiveFailure(error) })
    }
  }

  async function fetchPage(cursor: number, revisionId: string, mine: number): Promise<void> {
    try {
      const page = await archive.messages(conversation.conversationId, revisionId, cursor)
      if (disposed || mine !== generation) return
      commit({
        messages: [...state.messages, ...page.messages],
        nextCursor: page.nextCursor,
        totalMessages: page.totalMessages,
        completeness: page.completeness,
        loadingMore: false,
      })
    } catch (error) {
      if (!disposed && mine === generation) commit({ loadingMore: false, moreFailure: describeArchiveFailure(error) })
      throw error
    }
  }

  /** One page at a time: a second ask joins the first. Rejects with the archive's own error. */
  function fetchNext(): Promise<void> {
    if (inflight) return inflight
    const cursor = state.nextCursor
    if (cursor === null || state.status !== 'ready') return Promise.resolve()
    commit({ loadingMore: true, moreFailure: null })
    const run = fetchPage(cursor, state.revisionId, generation)
    inflight = run
    const clear = (): void => { if (inflight === run) inflight = null }
    void run.then(clear, clear)
    return run
  }

  async function loadMore(): Promise<void> {
    try {
      await fetchNext()
    } catch {
      // Recorded as `moreFailure`; what was read stays.
    }
  }

  async function loadAll(options: LoadAllOptions = {}): Promise<LoadAllResult> {
    if (state.status !== 'ready') throw new Error('Open the conversation before reading all of it.')
    const max = options.maxMessages ?? DEFAULT_MAX_EXPORT_MESSAGES
    options.onProgress?.(state.messages.length, state.totalMessages)
    while (state.status === 'ready' && state.nextCursor !== null && state.messages.length < max) {
      if (options.signal?.aborted) break
      await fetchNext()
      options.onProgress?.(state.messages.length, state.totalMessages)
    }
    return { messages: state.messages, complete: state.status === 'ready' && state.nextCursor === null }
  }

  let projected: { readonly source: readonly ArchiveMessage[]; readonly transcript: ProjectedTranscript } | null = null
  function transcript(): ProjectedTranscript {
    if (!projected || projected.source !== state.messages) {
      projected = { source: state.messages, transcript: projectArchiveMessages(state.messages) }
    }
    return projected.transcript
  }
  const annotate = (message: ChatMessage): string | null => transcript().annotations.get(message.id) ?? null

  /** The first and last real time among the loaded messages, as a range in words. */
  function derivedRange(): string | null {
    let first: number | null = null
    let last: number | null = null
    for (const message of state.messages) {
      const time = parseIso(message.occurredAt)
      if (time === null) continue
      if (first === null || time < first) first = time
      if (last === null || time > last) last = time
    }
    return first === null || last === null ? null : formatDateRange(new Date(first).toISOString(), new Date(last).toISOString())
  }

  function currentTitle(): string {
    const revision = state.revisions.find(candidate => candidate.revisionId === state.revisionId)
    return displayTitle(revision?.title ?? conversation.revision.title, 'imported')
  }

  function header(): ImportedReaderHeader {
    const basis = conversation.attributionBasis ?? conversation.revision.attributionBasis ?? null
    const voiceNames = (conversation.models ?? []).map(model => modelDisplayName(model.id)).filter(name => name !== '')
    const stated = formatDateRange(conversation.firstOccurredAt, conversation.lastOccurredAt)
    // Only a fully loaded conversation can state its own range from its messages.
    const range = stated ?? (state.status === 'ready' && state.nextCursor === null ? derivedRange() : null)
    return {
      title: currentTitle(),
      provenance: importedProvenanceText(basis),
      range,
      voices: voiceNames.length > 0 ? voiceNames.join(', ') : null,
      countLine: messageCountLine(state.messages.length, state.totalMessages || conversation.revision.messageCount),
      note: completenessNote(state.completeness),
    }
  }

  return {
    conversation,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open,
    loadMore,
    switchRevision,
    loadAll,
    transcript,
    annotate,
    header,
    continueIntent: () => ({
      conversationId: conversation.conversationId,
      revisionId: state.revisionId,
      title: currentTitle(),
      messagesLoaded: state.messages.length,
    }),
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
