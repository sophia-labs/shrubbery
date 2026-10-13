/**
 * The account's conversation archive as the GATEWAY serves it, on the same real socket as the scripted
 * Choreograph (NO MOCKS): `GET /me/conversations`, `GET /me/conversations/{id}` and
 * `GET /me/conversations/{id}/revisions/{rev}/messages`, spelled as `G-gateway-return.md` 1.1 to 1.4 spells
 * them for the gateway that carries the conversation sidecar.
 *
 * WHY THIS EXISTS BESIDE `archive-fixtures.ts` AND `memory-archive.ts`. Those two are in-memory implementations
 * of the archive CLIENT's interface: they hand the host messages already normalised, so they cannot say whether the
 * client reads the gateway's real answer. This one answers on the wire, so the whole path is real: the gateway's
 * JSON, the archive client that reads it, the reader and the continuation that stand on the client.
 *
 * What the gateway's answer looks like, and which the fixture keeps to:
 *  - a list item: `conversationId`, `graphId`, `revision { revisionId, title, messageCount, partCount }`,
 *    `revisionCount`, and ONLY WHEN a summary exists for that head (the sidecar): `firstOccurredAt`,
 *    `lastOccurredAt`, `parentConversationId`, `models`, `counts`, `attributionBasis`;
 *  - `order=recent` (the first page; an opaque `r1.` cursor after it) is served only by a gateway that has the
 *    sidecar; the deployed gateway answers a 400 to a parameter it does not know;
 *  - a message page carries the archive's messages byte for byte, and, beside them, a PAGE-LEVEL `voice`:
 *    `{ derivedBy, byMessage: { "<message id>": { modelId, providerId, basis: "source-recorded" } } }`, or `null`
 *    when no voice was derived for exactly this revision. A message itself carries NO `voice` key.
 */

import { createHash } from 'node:crypto'
import type { Answer, ChoreographSim, Received } from './choreograph-sim.js'

export const conversationUrn = (n: number): string => `urn:sophia:conversation-archive:conversation:${n.toString(16).padStart(64, '0')}`
export const revisionIdOf = (n: number): string => (n + 0x1000).toString(16).padStart(64, '0')
const messageUrn = (conversation: number, index: number): string =>
  `urn:sophia:conversation-archive:message:${createHash('sha256').update(`${conversation}:${index}`).digest('hex')}`

export interface WireTurn {
  readonly role: 'user' | 'assistant' | 'system' | 'tool'
  readonly text: string
  /** Epoch milliseconds; absent: the source recorded no time. */
  readonly at?: number
  /** The model the sidecar recovered for this assistant message. */
  readonly model?: { readonly id: string; readonly provider?: string | null }
  /** Parts beyond the text (reasoning, a tool call). */
  readonly extraParts?: readonly { kind: string; content: unknown }[]
}

export interface ImportedConversation {
  readonly number: number
  readonly title: string
  readonly turns: readonly WireTurn[]
  /** Another account's, or nobody's: the revision list says so and the client refuses it. */
  readonly owner?: string
  /** The sidecar has a summary for this head (dates, models, basis on the list item). Default true. */
  readonly summarised?: boolean
  /** The sidecar recovered voices for this revision (the page-level `voice`). Default: true when summarised. */
  readonly voices?: boolean
  readonly attributionBasis?: string
  readonly parent?: number
}

interface WireMessage {
  readonly messageId: string
  readonly role: string
  readonly occurredAt: string | null
  readonly state: string
  readonly parts: readonly { partId: string; kind: string; mediaType: string; content: unknown }[]
}

const iso = (epoch: number): string => new Date(epoch).toISOString()

export class ArchiveRoutes {
  /** The account's conversations, as the gateway holds them. */
  conversations: ImportedConversation[] = []
  /** The deployed gateway (c29fef5 and the voices gateway) knows no `order` parameter and answers 400; the sidecar gateway serves it. */
  supportsRecent = true
  /**
   * The sidecar gateway, its backfill NOT yet run (the state of the live gateway until it is): no derived row exists for any
   * conversation, so `order=recent` is answered in hash order with `ordering: "hash"` and `orderingFallback:
   * "summaries-unavailable"`, a recency request carrying a conversation-id cursor is served in hash order with
   * `orderingFallback: "hash-cursor"`, no item carries a summary field, and every message page says `voice: null`
   * (`README.conversation-archive.md`: "A rowless account is served exactly as before, plus `ordering: "hash"`").
   */
  summaries = true
  /**
   * Set by `expireNextRecencyCursor`: the next request that carries a recency cursor finds that recency no longer exists
   * (the derived rows changed under a list being read, or the gateway was rolled back) and is answered
   * `409 conversation_archive_cursor_expired`, "start again from the first page" (`G-gateway-return.md` 1.1); recency
   * is gone from then on, as it is when the rows are.
   */
  private cursorExpiryArmed = false
  /** When set, every archive route answers this (a lapsed session, an erased archive, a busy store). */
  refuse: { status: number; code: string } | null = null
  /** Every request any archive route took. */
  readonly requests: Received[] = []

  constructor(sim: ChoreographSim, private readonly options: { readonly userId: string }) {
    sim.extraRoutes.push(request => this.answer(request))
  }

  /** The next recency cursor presented is answered 409 (and every list after it is served without recency). */
  expireNextRecencyCursor(): void {
    this.cursorExpiryArmed = true
  }

  get messageRequests(): Received[] {
    return this.requests.filter(request => /\/messages$/.test(request.route))
  }

  private wireMessages(conversation: ImportedConversation): WireMessage[] {
    return conversation.turns.map((turn, index) => ({
      messageId: messageUrn(conversation.number, index),
      role: turn.role,
      occurredAt: turn.at === undefined ? null : iso(turn.at),
      state: 'present',
      parts: [
        ...(turn.text
          ? [{ partId: `p${conversation.number}.${index}.0`, kind: 'text', mediaType: 'text/markdown', content: turn.text }]
          : []),
        ...(turn.extraParts ?? []).map((part, position) => ({
          partId: `p${conversation.number}.${index}.${position + 1}`,
          kind: part.kind,
          mediaType: 'application/json',
          content: part.content,
        })),
      ],
    }))
  }

  private item(conversation: ImportedConversation): Record<string, unknown> {
    const wire = this.wireMessages(conversation)
    const base = {
      conversationId: conversationUrn(conversation.number),
      graphId: 'cloud1-opencode-archive',
      revision: {
        revisionId: revisionIdOf(conversation.number),
        title: conversation.title,
        messageCount: wire.length,
        partCount: wire.reduce((sum, message) => sum + message.parts.length, 0),
      },
      revisionCount: 1,
    }
    if (conversation.summarised === false || !this.supportsRecent || !this.summaries) return base
    const times = conversation.turns.flatMap(turn => (turn.at === undefined ? [] : [turn.at]))
    const models = new Map<string, { id: string; provider: string | null; assistantMessages: number }>()
    for (const turn of conversation.turns) {
      if (!turn.model) continue
      const known = models.get(turn.model.id)
      if (known) known.assistantMessages += 1
      else models.set(turn.model.id, { id: turn.model.id, provider: turn.model.provider ?? null, assistantMessages: 1 })
    }
    return {
      ...base,
      ...(times.length > 0 ? { firstOccurredAt: iso(Math.min(...times)), lastOccurredAt: iso(Math.max(...times)) } : {}),
      parentConversationId: conversation.parent === undefined ? null : conversationUrn(conversation.parent),
      ...(models.size > 0 ? { models: [...models.values()] } : {}),
      counts: { messages: wire.length, parts: base.revision.partCount },
      attributionBasis: conversation.attributionBasis ?? null,
    }
  }

  private order(): ImportedConversation[] {
    const lastAt = (conversation: ImportedConversation): number =>
      Math.max(0, ...conversation.turns.flatMap(turn => (turn.at === undefined ? [] : [turn.at])))
    return [...this.conversations].sort((a, b) => lastAt(b) - lastAt(a) || b.number - a.number)
  }

  private answer(request: Received): Answer | undefined {
    if (request.graph !== null || !request.route.startsWith('/me/conversations')) return undefined
    this.requests.push(request)
    if (request.method !== 'GET') return { status: 405, body: { ok: false, code: 'method_not_allowed' } }
    if (this.refuse) return { status: this.refuse.status, body: { ok: false, code: this.refuse.code } }

    if (request.route === '/me/conversations') {
      const known = this.supportsRecent ? ['limit', 'after', 'order', 'include'] : ['limit', 'after']
      for (const key of request.query.keys()) {
        // The deployed route is `deny_unknown_fields`.
        if (!known.includes(key)) return { status: 400, body: { ok: false, code: 'conversation_archive_invalid_request' } }
      }
      const limit = Math.min(50, Number(request.query.get('limit') ?? '50'))
      const after = request.query.get('after')
      if (this.cursorExpiryArmed && after?.startsWith('r1.') === true) {
        this.cursorExpiryArmed = false
        this.summaries = false
        return { status: 409, body: { ok: false, code: 'conversation_archive_cursor_expired' } }
      }
      const asked = this.supportsRecent && request.query.get('order') === 'recent'
      const hashCursor = after?.startsWith('urn:') === true
      // Recency is served only where summaries exist and the list has not already started in hash order.
      const recent = asked && this.summaries && !hashCursor
      const opaque = this.summaries && after?.startsWith('r1.') === true
      const fallback = asked && !recent && !opaque ? (hashCursor ? 'hash-cursor' : 'summaries-unavailable') : null
      const ordered = recent || opaque ? this.order() : [...this.conversations].sort((a, b) => a.number - b.number)
      const offset = opaque ? Number(after!.slice(3)) : !recent && after ? Math.max(0, ordered.findIndex(c => conversationUrn(c.number) === after) + 1) : 0
      const slice = ordered.slice(offset, offset + limit)
      const more = offset + slice.length < ordered.length
      const nextCursor = !more ? null : recent || opaque ? `r1.${offset + slice.length}` : conversationUrn(slice.at(-1)!.number)
      return {
        status: 200,
        body: {
          schema: 'sophia.private-conversation-catalogue.v1',
          ...(this.supportsRecent ? { ordering: recent || opaque ? 'recent' : 'hash' } : {}),
          ...(fallback ? { orderingFallback: fallback } : {}),
          nextCursor,
          items: slice.map(conversation => this.item(conversation)),
        },
      }
    }

    const revisions = /^\/me\/conversations\/([^/]+)$/.exec(request.route)
    const page = /^\/me\/conversations\/([^/]+)\/revisions\/([^/]+)\/messages$/.exec(request.route)
    const id = decodeURIComponent((revisions ?? page)?.[1] ?? '')
    const conversation = this.conversations.find(candidate => conversationUrn(candidate.number) === id)
    if (!conversation) return { status: 404, body: { ok: false, code: 'conversation_archive_not_found' } }

    if (revisions) {
      return {
        status: 200,
        body: {
          conversationId: id,
          audience: { kind: 'owner-only', ownerPrincipal: `user:${conversation.owner ?? this.options.userId}` },
          revisions: [this.item(conversation).revision],
        },
      }
    }
    if (page) {
      if (page[2] !== revisionIdOf(conversation.number)) return { status: 404, body: { ok: false, code: 'conversation_archive_not_found' } }
      const cursor = Number(request.query.get('cursor') ?? '0')
      const limit = Math.min(50, Number(request.query.get('limit') ?? '50'))
      const wire = this.wireMessages(conversation)
      const slice = wire.slice(cursor, cursor + limit)
      const next = cursor + slice.length < wire.length ? cursor + slice.length : null
      const withVoices = (conversation.voices ?? conversation.summarised !== false) && this.supportsRecent && this.summaries
      const byMessage: Record<string, unknown> = {}
      slice.forEach((message, offset) => {
        const model = conversation.turns[cursor + offset]?.model
        if (model) byMessage[message.messageId] = { modelId: model.id, providerId: model.provider ?? null, basis: 'source-recorded' }
      })
      return {
        status: 200,
        body: {
          conversationId: id,
          revisionId: page[2],
          order: 'retained-source-array-order',
          cursor,
          nextCursor: next,
          totalMessages: wire.length,
          messages: slice,
          completeness: { status: 'complete', reason: 'all-parts-present' },
          // The sidecar gateway always says; `null` is "no voice was derived for exactly this revision".
          ...(this.supportsRecent
            ? { voice: withVoices && Object.keys(byMessage).length > 0 ? { derivedBy: { job: 'conversation-sidecar-backfill', version: '1', at: '2026-10-01T00:00:00.000Z' }, byMessage } : null }
            : {}),
        },
      }
    }
    return { status: 404, body: { ok: false, code: 'conversation_archive_not_found' } }
  }
}
