/**
 * A real, in-memory implementation of the real `ConversationArchive` interface,
 * for the tests of "Continue with...". It is not a stub: it pages exactly the way
 * the gateway's archive does (fifty messages a page, a cursor that is a message
 * count, `totalMessages`, a `nextCursor` that is null on the last page), so the
 * window builder is exercised over the same page arithmetic it meets in production.
 *
 * `voice` rides on a message as an extra structural field, spelled as loosely as a
 * gateway might spell it (`{ id | model | modelId, provider | providerId }`): the
 * continuation reader (`recordedVoiceOf`) must cope with whatever arrives, and these
 * tests pin that. The archive CLIENT (`conversation-archive.ts`) normalises the field
 * to `{ modelId, provider, label, basis }` before anything else sees it; this fake
 * stands in for the gateway's wire, not for the client, so it hands messages out as
 * `ArchiveMessage` through one cast, here, rather than in every test.
 */

import type {
  ArchiveMessage,
  ArchiveMessagePage,
  ArchiveRevision,
  ArchivedConversation,
  ConversationArchive,
} from '../../conversation-archive.js'

export const CONVERSATION_ID = `urn:sophia:conversation-archive:conversation:${'a'.repeat(64)}`
export const REVISION_ID = 'b'.repeat(64)
export const GRAPH_ID = 'cloud1-import'

/** A voice as a gateway might spell it on the wire, before the client normalises it. */
export interface WireVoice {
  readonly id?: string
  readonly model?: string
  readonly modelId?: string
  readonly provider?: string
  readonly providerId?: string
}

export type FixtureMessage = Omit<ArchiveMessage, 'voice'> & { voice?: WireVoice }

export interface TurnOptions {
  /** Epoch milliseconds. Absent: the source recorded no time. */
  readonly at?: number
  readonly voice?: WireVoice
  /** Extra (non-text) parts, e.g. reasoning or a tool call. */
  readonly extraParts?: readonly { kind: string; content: unknown }[]
  readonly state?: string
  /** Role override, for a system or tool message. */
  readonly role?: string
}

/** One archive message: its text is a single `text` part. */
export function turn(
  index: number,
  role: 'user' | 'assistant',
  text: string,
  options: TurnOptions = {},
): FixtureMessage {
  const parts = [
    ...(text ? [{ partId: `p${index}.0`, kind: 'text', mediaType: 'text/markdown', content: text }] : []),
    ...(options.extraParts ?? []).map((part, position) => ({
      partId: `p${index}.${position + 1}`,
      kind: part.kind,
      mediaType: 'application/json',
      content: part.content,
    })),
  ]
  return {
    messageId: `msg-${String(index).padStart(4, '0')}`,
    role: options.role ?? role,
    occurredAt: options.at === undefined ? null : new Date(options.at).toISOString(),
    state: options.state ?? 'present',
    parts,
    ...(options.voice ? { voice: options.voice } : {}),
  }
}

/** A conversation of `count` alternating turns (user first), each text `size` characters. */
export function alternating(count: number, size = 200, startAt = Date.UTC(2026, 0, 5, 12, 0)): FixtureMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    const head = `${role} ${index}: `
    return turn(index, role, head + 'x'.repeat(Math.max(0, size - head.length)), {
      at: startAt + index * 60_000,
    })
  })
}

export interface MemoryArchiveOptions {
  readonly title?: string
  readonly conversationId?: string
  readonly revisionId?: string
  /** Throw when this cursor is read (an archive that fails mid-read). */
  readonly failAtCursor?: number
  /** Answer this cursor with one message too few (an incomplete page). */
  readonly shortAtCursor?: number
}

const PAGE = 50

export class MemoryArchive implements ConversationArchive {
  /** Every cursor read, in order. */
  readonly reads: number[] = []
  readonly conversationId: string
  readonly revisionId: string
  readonly title: string

  constructor(
    readonly all: readonly FixtureMessage[],
    private readonly options: MemoryArchiveOptions = {},
  ) {
    this.conversationId = options.conversationId ?? CONVERSATION_ID
    this.revisionId = options.revisionId ?? REVISION_ID
    this.title = options.title ?? 'Monads, again'
  }

  private revision(): ArchiveRevision {
    return {
      revisionId: this.revisionId,
      title: this.title,
      messageCount: this.all.length,
      partCount: this.all.reduce((sum, message) => sum + message.parts.length, 0),
    }
  }

  async list(): Promise<{ items: ArchivedConversation[]; nextCursor: string | null }> {
    return {
      items: [{
        conversationId: this.conversationId,
        graphId: GRAPH_ID,
        revision: this.revision(),
        revisionCount: 1,
      }],
      nextCursor: null,
    }
  }

  async revisions(id: string): Promise<ArchiveRevision[]> {
    if (id !== this.conversationId) throw new Error('Invalid archive ownership.')
    return [this.revision()]
  }

  async messages(id: string, revision: string, cursor = 0): Promise<ArchiveMessagePage> {
    if (id !== this.conversationId || revision !== this.revisionId) throw new Error('Invalid archived messages.')
    this.reads.push(cursor)
    if (this.options.failAtCursor === cursor) throw new Error('Imported chats could not be loaded (503).')
    const total = this.all.length
    let slice = this.all.slice(cursor, cursor + PAGE)
    const nextCursor = cursor + slice.length < total ? cursor + slice.length : null
    if (this.options.shortAtCursor === cursor && slice.length > 1) slice = slice.slice(0, -1)
    return {
      messages: slice.map(message => ({ ...message }) as ArchiveMessage),
      nextCursor,
      totalMessages: total,
      completeness: { status: 'complete', reason: 'all-parts-present' },
    }
  }
}
