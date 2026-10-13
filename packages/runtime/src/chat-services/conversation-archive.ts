/** Account-scoped, read-only access to imported Sophia conversations. */
export interface ArchiveModel { id: string; provider: string | null }
/**
 * The model the source recorded for one assistant turn, as the gateway reports
 * it. Every field is testimony from a derived sidecar, never a claim of the
 * reader: a message with no `voice` key simply has none recorded.
 */
export interface ArchiveVoice { modelId: string | null; provider: string | null; label: string | null; basis: string | null }
export interface ArchiveRevision { revisionId: string; title: string; messageCount: number; partCount: number; attributionBasis?: string }
export interface ArchivedConversation {
  conversationId: string
  graphId: string
  revision: ArchiveRevision
  revisionCount: number
  /** ISO times of the first and last message the source recorded. Absent when the gateway has none. */
  firstOccurredAt?: string
  lastOccurredAt?: string
  /** A sub-agent conversation names the conversation that started it. */
  parentConversationId?: string
  models?: ArchiveModel[]
  attributionBasis?: string
}
export interface ArchiveMessage {
  messageId: string
  role: string
  occurredAt: string | null
  state: string
  parts: { partId: string; kind: string; mediaType: string; content: unknown }[]
  voice?: ArchiveVoice
}
export interface ArchiveMessagePage { messages: ArchiveMessage[]; nextCursor: number | null; totalMessages: number; completeness: { status: string; reason: string } }
/** `recent` = newest first with an opaque cursor; `stored` = the older gateway's hash order. */
export type ArchiveListOrder = 'recent' | 'stored'
export interface ArchiveListPage { items: ArchivedConversation[]; nextCursor: string | null; order?: ArchiveListOrder }
export interface ConversationArchive {
  list(after?: string): Promise<ArchiveListPage>
  revisions(id: string): Promise<ArchiveRevision[]>
  messages(id: string, revision: string, cursor?: number): Promise<ArchiveMessagePage>
}

/**
 * A request the archive refused or could not make. `status` is the HTTP status
 * (0 when the gateway could not be reached) and `code` the gateway's own reason
 * when it sent one, so the drawer can tell a lapsed session from an erased
 * archive without reading error strings.
 */
export class ArchiveRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ArchiveRequestError'
    this.status = status
    this.code = code
  }
}

const CID = /^urn:sophia:conversation-archive:conversation:[a-f0-9]{64}$/
const HASH = /^[a-f0-9]{64}$/
/** An opaque cursor is whatever printable text the gateway minted; it travels only as an encoded query value. */
const OPAQUE_CURSOR = /^[\x21-\x7e]{1,2048}$/
const FAILURE_CODE = /^[A-Za-z0-9_.-]{1,80}$/
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid archived conversation response.')
  return v as Record<string, unknown>
}
function text(v: unknown): string { if (typeof v !== 'string') throw new Error('Invalid archive text.'); return v }
function count(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0) throw new Error('Invalid archive count.'); return Number(v) }

/** A short, printable identifier or label; anything else is treated as absent. */
function cleanText(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}
function isoDate(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v)) ? v : undefined
}
function modelList(v: unknown): ArchiveModel[] | undefined {
  if (!Array.isArray(v)) return undefined
  const seen = new Set<string>()
  const models: ArchiveModel[] = []
  for (const entry of v.slice(0, 16)) {
    let id: string | null = null
    let provider: string | null = null
    if (typeof entry === 'string') id = cleanText(entry)
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>
      id = cleanText(e.id ?? e.modelId ?? e.model)
      provider = cleanText(e.provider ?? e.providerId)
    }
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, provider })
  }
  return models.length ? models : undefined
}
function voiceOf(v: unknown): ArchiveVoice | undefined {
  if (typeof v === 'string') {
    const modelId = cleanText(v)
    return modelId ? { modelId, provider: null, label: null, basis: null } : undefined
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const voice: ArchiveVoice = {
    modelId: cleanText(o.modelId ?? o.model ?? o.id),
    provider: cleanText(o.provider ?? o.providerId),
    label: cleanText(o.label ?? o.displayName ?? o.name),
    basis: cleanText(o.basis ?? o.attributionBasis ?? o.evidence),
  }
  return voice.modelId || voice.label ? voice : undefined
}
/**
 * The voices of one message page. The gateway serves them beside the messages, not inside them
 * (`G-gateway-return.md` 1.3): `voice: { derivedBy, byMessage: { "<message id>": { modelId, providerId, basis } } }`,
 * or `null` when none was derived for exactly this revision. Only a map is read; anything else is no voice.
 */
function voicesByMessage(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const map = (v as Record<string, unknown>).byMessage
  return map && typeof map === 'object' && !Array.isArray(map) ? map as Record<string, unknown> : {}
}
function revision(v: unknown): ArchiveRevision {
  const r = record(v), id = text(r.revisionId)
  if (!HASH.test(id)) throw new Error('Invalid archive revision.')
  const parsed: ArchiveRevision = { revisionId: id, title: typeof r.title === 'string' ? r.title : 'Untitled conversation', messageCount: count(r.messageCount), partCount: count(r.partCount) }
  const basis = cleanText(r.attributionBasis)
  if (basis) parsed.attributionBasis = basis
  return parsed
}
/** One catalogue item. The additive fields are read from the item or its revision and dropped, not thrown, when malformed. */
function conversation(r: Record<string, unknown>, id: string): ArchivedConversation {
  const inner = record(r.revision)
  const item: ArchivedConversation = { conversationId: id, graphId: text(r.graphId), revision: revision(r.revision), revisionCount: count(r.revisionCount) }
  const first = isoDate(r.firstOccurredAt ?? inner.firstOccurredAt)
  if (first) item.firstOccurredAt = first
  const last = isoDate(r.lastOccurredAt ?? inner.lastOccurredAt)
  if (last) item.lastOccurredAt = last
  const parent = r.parentConversationId ?? inner.parentConversationId
  if (typeof parent === 'string' && CID.test(parent)) item.parentConversationId = parent
  const models = modelList(r.models ?? inner.models)
  if (models) item.models = models
  const basis = cleanText(r.attributionBasis ?? inner.attributionBasis)
  if (basis) item.attributionBasis = basis
  return item
}
async function failureCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined
    return typeof code === 'string' && FAILURE_CODE.test(code) ? code : null
  } catch {
    return null
  }
}

export function createConversationArchive(options: {
  gatewayBaseUrl: string; userId(): string; token?(): string | undefined; fetchImpl?: typeof fetch
}): ConversationArchive {
  const base = new URL(options.gatewayBaseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid archive gateway.')
  const fetchImpl = (options.fetchImpl ?? globalThis.fetch).bind(globalThis) as typeof fetch
  /** null = not yet known; true = the gateway answered order=recent; false = it refused the parameter. */
  let recentOrder: boolean | null = null
  async function get(path: string): Promise<Record<string, unknown>> {
    const user = options.userId(), token = options.token?.()
    if (!user || !token) throw new ArchiveRequestError(401, 'signed_out', 'Sign in to read your imported chats.')
    let response: Response
    try {
      response = await fetchImpl(new URL('/me/conversations' + path, base), {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(35_000),
      })
    } catch (error) {
      throw new ArchiveRequestError(0, 'unreachable', 'Imported chats could not be reached.', error)
    }
    if (!response.ok) {
      throw new ArchiveRequestError(
        response.status,
        await failureCode(response),
        response.status === 401 ? 'Your session expired. Sign in again.' : `Imported chats could not be loaded (${response.status}).`,
      )
    }
    let value: unknown
    try {
      value = await response.json()
    } catch (error) {
      throw new ArchiveRequestError(response.status, 'unreadable', 'Imported chats returned an unreadable response.', error)
    }
    if (options.userId() !== user || options.token?.() !== token) throw new Error('Your account session changed. Open history again.')
    return record(value)
  }
  function path(id: string): string { if (!CID.test(id)) throw new Error('Invalid conversation ID.'); return '/' + encodeURIComponent(id) }
  async function list(after?: string): Promise<ArchiveListPage> {
    const cursor = after || undefined
    if (cursor && !(recentOrder === true ? OPAQUE_CURSOR : CID).test(cursor)) throw new Error('Invalid archive cursor.')
    // A cursor that is a conversation id belongs to stored order: until the gateway has shown it speaks
    // recency order, only a first page (no cursor) asks for it.
    const wantRecent = recentOrder === true || (recentOrder === null && !cursor)
    const query = new URLSearchParams({ limit: '50', ...(wantRecent ? { order: 'recent' } : {}), ...(cursor ? { after: cursor } : {}) })
    let v: Record<string, unknown>
    try {
      v = await get('?' + query)
    } catch (error) {
      // The deployed route refuses a query parameter it does not know with a 400.
      // That refusal, on the very first page, is how an older gateway announces
      // itself: ask again in stored order and remember not to ask twice.
      if (wantRecent && recentOrder === null && !cursor && error instanceof ArchiveRequestError && error.status === 400) {
        recentOrder = false
        return list(after)
      }
      throw error
    }
    if (wantRecent) recentOrder = true
    const stored = recentOrder !== true
    if (v.schema !== 'sophia.private-conversation-catalogue.v1' || !Array.isArray(v.items) || v.items.length > 50) throw new Error('Invalid conversation catalogue.')
    const items = v.items.map(value => {
      const r = record(value), id = text(r.conversationId)
      if (!CID.test(id) || (stored && cursor && id <= cursor)) throw new Error('Invalid conversation catalogue order.')
      return conversation(r, id)
    })
    const nextCursor = v.nextCursor === null ? null : text(v.nextCursor)
    const badCursor = nextCursor !== null && nextCursor !== '' && (stored ? nextCursor !== items.at(-1)?.conversationId : !OPAQUE_CURSOR.test(nextCursor))
    if (new Set(items.map(r => r.conversationId)).size !== items.length || badCursor) throw new Error('Invalid archive cursor.')
    return { items, nextCursor: nextCursor || null, order: stored ? 'stored' : 'recent' }
  }
  return {
    list,
    async revisions(id) {
      const v = await get(path(id)), audience = record(v.audience)
      if (v.conversationId !== id || audience.kind !== 'owner-only' || audience.ownerPrincipal !== 'user:' + options.userId() || !Array.isArray(v.revisions)) throw new Error('Invalid archive ownership.')
      return v.revisions.map(revision)
    },
    async messages(id, revisionId, cursor = 0) {
      if (!HASH.test(revisionId)) throw new Error('Invalid archive revision.')
      count(cursor)
      const v = await get(`${path(id)}/revisions/${revisionId}/messages?cursor=${cursor}&limit=50`)
      if (v.conversationId !== id || v.revisionId !== revisionId || v.cursor !== cursor || !Array.isArray(v.messages) || v.messages.length > 50) throw new Error('Invalid archived messages.')
      const byMessage = voicesByMessage(v.voice)
      const messages = v.messages.map((value): ArchiveMessage => {
        const r = record(value)
        if (!Array.isArray(r.parts)) throw new Error('Invalid archived message parts.')
        const parsed: ArchiveMessage = { messageId: text(r.messageId), role: text(r.role), state: text(r.state), occurredAt: r.occurredAt === null ? null : text(r.occurredAt), parts: r.parts.map(value => {
          const p = record(value)
          return { partId: text(p.partId), kind: text(p.kind), mediaType: text(p.mediaType), content: p.content }
        }) }
        // A voice the message itself carries stands; otherwise the page's map speaks for it, by message id.
        const voice = voiceOf(r.voice) ?? (Object.hasOwn(byMessage, parsed.messageId) ? voiceOf(byMessage[parsed.messageId]) : undefined)
        if (voice) parsed.voice = voice
        return parsed
      })
      const totalMessages = count(v.totalMessages), nextCursor = v.nextCursor === null ? null : count(v.nextCursor)
      if (cursor + messages.length > totalMessages || (nextCursor !== null && (nextCursor !== cursor + messages.length || nextCursor <= cursor || nextCursor >= totalMessages)) || (nextCursor === null && cursor + messages.length !== totalMessages)) throw new Error('Invalid message pagination.')
      const c = record(v.completeness)
      return { messages, nextCursor, totalMessages, completeness: { status: text(c.status), reason: text(c.reason) } }
    },
  }
}
