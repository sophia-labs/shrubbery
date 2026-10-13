/**
 * conversation-home.ts — the pure model behind ONE conversation home.
 *
 * The Chat history drawer lists every conversation the person has, live and
 * imported, in one list ordered by the date each one really has. Nothing here
 * touches the DOM or the network: it turns what the two sources hand back
 * (the ChatService's live conversations, the gateway's imported catalogue) into
 * rows, and says in words what a date, a model or a refusal means.
 *
 * Doctrine carried in this file:
 *   - A date is what the source recorded (`updatedAt`, `lastOccurredAt`). It is
 *     never decoded from an id, never guessed. Without one a row says so.
 *   - A model on a row is testimony the source recorded, shown as a name, never
 *     as the identity of whoever is speaking now.
 *   - The internal label of the archive (`cloud1-opencode-archive`) is never a
 *     title, a workspace or a search key.
 */

import type { SessionSummary } from '@shrubbery/chat-kernel'
import { ArchiveRequestError, type ArchivedConversation } from './conversation-archive.js'
import type { ChatService } from './chat-service.js'

/** What a person reads under an imported conversation's title. */
export const IMPORTED_PROVENANCE = 'Imported from the old garden'
/** A quiet sine wave beside a model name: "this voice". Decorative; the words carry the meaning. */
export const VOICE_GLYPH = '∿'

export type ConversationKind = 'live' | 'imported'
export interface ConversationModelRef { id: string; provider?: string | null }
export interface ConversationContinuation { archiveConversationUrn: string; revisionId: string }

/**
 * One conversation as a source lists it. The live source is the service's
 * `listConversations()`; until it exists the service's `listSessions()` is
 * adapted to this shape. `updatedAt` is an ISO time, or '' when unknown.
 */
export interface ConversationSummary {
  id: string
  kind: ConversationKind
  title: string | null
  graphId?: string | null
  updatedAt: string
  createdAt?: string | null
  models?: readonly ConversationModelRef[]
  continuesConversation?: ConversationContinuation | null
}

// ── dates ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseIso(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function validIso(value: string | null | undefined): string | null {
  return parseIso(value) === null ? null : (value as string)
}

/** A whole-calendar-day number in local time; UTC arithmetic keeps it exact across daylight-saving changes. */
function dayNumber(ms: number): number {
  const date = new Date(ms)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

/** 'Mar 3, 2026', or 'Mar 3, 2026, 2:05 PM' with the time. Local time; null when unreadable. */
export function formatAbsoluteDate(iso: string | null | undefined, withTime = false): string | null {
  const time = parseIso(iso)
  if (time === null) return null
  const date = new Date(time)
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
  if (!withTime) return day
  const hour = date.getHours() % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${day}, ${hour}:${minute} ${date.getHours() < 12 ? 'AM' : 'PM'}`
}

/** 'Just now', '5 min ago', '6 hr ago', 'Yesterday', '3 days ago', 'Mar 3', 'Dec 31, 2025'. */
export function formatRelativeDate(iso: string | null | undefined, now: number): string | null {
  const time = parseIso(iso)
  if (time === null) return null
  const diff = now - time
  // A time ahead of the clock is clock skew, not the future: show the date, never "in 3 hours".
  if (diff < -60_000) return formatAbsoluteDate(iso)
  const minutes = Math.floor(Math.max(diff, 0) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const days = dayNumber(now) - dayNumber(time)
  if (days <= 0) return `${Math.floor(minutes / 60)} hr ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const date = new Date(time)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? '' : `, ${date.getFullYear()}`}`
}

/** The span a conversation covers, from whichever ends the source recorded. */
export function formatDateRange(first: string | null | undefined, last: string | null | undefined): string | null {
  const from = formatAbsoluteDate(first)
  const to = formatAbsoluteDate(last)
  if (from && to) return from === to ? from : `${from} – ${to}`
  return from ?? to
}

// ── models and provenance ─────────────────────────────────────────────────

const ACRONYMS = new Set(['gpt', 'glm', 'llm', 'ai', 'vl', 'xl'])

/** 'moonshotai/kimi-k2.5' becomes 'Kimi K2.5'. Only the shape of the id is read; nothing is looked up. */
export function modelDisplayName(modelId: string): string {
  const raw = modelId.trim()
  if (!raw) return ''
  const slash = raw.lastIndexOf('/')
  const base = (slash >= 0 ? raw.slice(slash + 1) : raw).split(':')[0] ?? ''
  const merged: string[] = []
  for (const token of base.split(/[-_\s]+/).filter(Boolean)) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && /^\d+$/.test(previous) && /^\d+$/.test(token)) merged[merged.length - 1] = `${previous}.${token}`
    else merged.push(token)
  }
  return merged
    .map(token => (ACRONYMS.has(token.toLowerCase()) ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(' ')
}

/** The first model's name, and how many more were used. Null when none was recorded. */
export function modelVoiceLabel(models: readonly ConversationModelRef[] | undefined): string | null {
  const first = models?.[0]
  if (!first) return null
  const name = modelDisplayName(first.id)
  if (!name) return null
  return models!.length > 1 ? `${name} +${models!.length - 1}` : name
}

/** An identifier-shaped basis ('legacy-owner-header') reads as words; a phrase is left as it is. */
export function humanizeBasis(basis: string): string {
  const trimmed = basis.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  return /^[a-z0-9._-]+$/i.test(trimmed) && /[-_.]/.test(trimmed) ? trimmed.replace(/[-_.]+/g, ' ').toLowerCase() : trimmed
}

export function importedProvenanceText(basis: string | null | undefined): string {
  const words = basis ? humanizeBasis(basis) : ''
  return words ? `${IMPORTED_PROVENANCE} · ${words}` : IMPORTED_PROVENANCE
}

export const UNTITLED_LIVE = 'Untitled chat'
export const UNTITLED_IMPORTED = 'Untitled conversation'

/** Titles the app minted for itself before a conversation was named. They say nothing about it. */
const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set(['organism-chat', 'new chat'])

/**
 * True for a title that names nothing: empty, an OpenCode default ("New session - …"),
 * the label the shell gave every first chat ("organism-chat"), or "New chat". Only the
 * whole label counts, so a real name that mentions one of them is kept.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const lowered = title?.trim().toLowerCase() ?? ''
  return !lowered || lowered.startsWith('new session - ') || PLACEHOLDER_TITLES.has(lowered)
}

/** What to call a conversation whose title is empty or a machine placeholder. */
export function displayTitle(title: string | null | undefined, kind: ConversationKind): string {
  if (isPlaceholderTitle(title)) return kind === 'live' ? UNTITLED_LIVE : UNTITLED_IMPORTED
  return (title as string).trim()
}

// ── the live source ───────────────────────────────────────────────────────

type ConversationLister = { listConversations?: () => Promise<readonly ConversationSummary[]> }

export function sessionToSummary(session: SessionSummary): ConversationSummary {
  return {
    id: session.id,
    kind: 'live',
    title: session.title,
    updatedAt: session.updated_at ?? session.created_at ?? '',
    createdAt: session.created_at,
  }
}

/**
 * The person's live conversations. The service's own `listConversations()` is
 * used when it has one (it merges across the person's graphs); otherwise
 * today's `listSessions()` is adapted behind the same shape. A failing source
 * fails here, so the drawer can say so.
 */
export async function listLiveConversations(service: ChatService): Promise<ConversationSummary[]> {
  const lister = service as ChatService & ConversationLister
  if (typeof lister.listConversations === 'function') {
    const listed = await lister.listConversations()
    return listed.filter(item => item.kind === 'live')
  }
  return (await service.listSessions()).map(sessionToSummary)
}

// ── rows ──────────────────────────────────────────────────────────────────

export interface ConversationRow {
  readonly key: string
  readonly kind: ConversationKind
  /** The live session id, or the archive conversation URN. */
  readonly id: string
  readonly title: string
  /** The real date used to order this row; null when the source recorded none. */
  readonly dateIso: string | null
  readonly graphId: string | null
  readonly models: readonly ConversationModelRef[]
  readonly parentId: string | null
  readonly messageCount: number | null
  readonly attributionBasis: string | null
  readonly live: ConversationSummary | null
  readonly imported: ArchivedConversation | null
  readonly children: readonly ConversationRow[]
}

export function toLiveRow(summary: ConversationSummary): ConversationRow {
  return {
    key: `live:${summary.id}`,
    kind: 'live',
    id: summary.id,
    title: displayTitle(summary.title, 'live'),
    dateIso: validIso(summary.updatedAt) ?? validIso(summary.createdAt),
    graphId: summary.graphId ?? null,
    models: summary.models ?? [],
    parentId: null,
    messageCount: null,
    attributionBasis: null,
    live: summary,
    imported: null,
    children: [],
  }
}

export function toImportedRow(item: ArchivedConversation): ConversationRow {
  return {
    key: `imported:${item.conversationId}`,
    kind: 'imported',
    id: item.conversationId,
    title: displayTitle(item.revision.title, 'imported'),
    dateIso: validIso(item.lastOccurredAt) ?? validIso(item.firstOccurredAt),
    // The archive's graph id is a provenance label, never a workspace.
    graphId: null,
    models: item.models ?? [],
    parentId: item.parentConversationId ?? null,
    messageCount: item.revision.messageCount,
    attributionBasis: item.attributionBasis ?? item.revision.attributionBasis ?? null,
    live: null,
    imported: item,
    children: [],
  }
}

/** Newest first; a row with no date follows every dated row, in the order it arrived. */
export function sortByRecency(rows: readonly ConversationRow[]): ConversationRow[] {
  return rows
    .map((row, index) => ({ row, index, time: parseIso(row.dateIso) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index
      if (a.time === null) return 1
      if (b.time === null) return -1
      return b.time - a.time || a.index - b.index
    })
    .map(entry => entry.row)
}

export function mergeConversationRows(
  live: readonly ConversationSummary[],
  imported: readonly ArchivedConversation[],
): ConversationRow[] {
  return sortByRecency([...live.map(toLiveRow), ...imported.map(toImportedRow)])
}

export function importedDatesAvailable(imported: readonly ArchivedConversation[]): boolean {
  return imported.some(item => validIso(item.lastOccurredAt) !== null || validIso(item.firstOccurredAt) !== null)
}

/**
 * The root a sub-agent row hangs under, or null when the row is itself a root:
 * its parent is not loaded, it has none, or the chain loops back on itself.
 */
function rootOf(row: ConversationRow, byId: ReadonlyMap<string, ConversationRow>): ConversationRow | null {
  const seen = new Set<string>([row.id])
  let current = row
  for (;;) {
    const parent = current.parentId ? byId.get(current.parentId) : undefined
    if (!parent) return current === row ? null : current
    if (seen.has(parent.id)) return null
    seen.add(parent.id)
    current = parent
  }
}

/**
 * Group sub-agent conversations under the conversation that started them.
 * Roots keep their incoming order; every descendant (children and their own
 * children) sits under its root, oldest first. A child whose parent is not
 * loaded, and every member of a parent cycle, stays a root.
 */
export function nestSubAgents(rows: readonly ConversationRow[]): ConversationRow[] {
  const byId = new Map<string, ConversationRow>()
  for (const row of rows) if (row.kind === 'imported') byId.set(row.id, row)
  const descendants = new Map<string, ConversationRow[]>()
  const roots: ConversationRow[] = []
  for (const row of rows) {
    const root = row.kind === 'imported' ? rootOf(row, byId) : null
    if (!root) {
      roots.push(row)
      continue
    }
    const list = descendants.get(root.id) ?? []
    list.push(row)
    descendants.set(root.id, list)
  }
  return roots.map(root => {
    const children = descendants.get(root.id)
    if (!children) return root
    const newestFirst = sortByRecency(children)
    const dated = newestFirst.filter(child => child.dateIso !== null).reverse()
    const undated = newestFirst.filter(child => child.dateIso === null)
    return { ...root, children: [...dated, ...undated] }
  })
}

// ── search and the visible list ───────────────────────────────────────────

/** Fold case and accents and collapse space, so 'configuracion' finds 'Configuración'. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

/** Titles only. Every word must appear, in any order. */
export function searchRows(rows: readonly ConversationRow[], query: string): ConversationRow[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter(row => {
    const title = normalizeSearch(row.title)
    return words.every(word => title.includes(word))
  })
}

export type HomeFilter = 'all' | 'live' | 'imported'
export interface HomeListInput {
  readonly live: readonly ConversationSummary[]
  readonly imported: readonly ArchivedConversation[]
  readonly query: string
  readonly filter: HomeFilter
}
export interface HomeList {
  readonly rows: ConversationRow[]
  /** Every conversation that matches, sub-agent conversations included. */
  readonly total: number
  readonly searching: boolean
}

/** Browsing nests sub-agent conversations under their parent; searching lists every match on its own. */
export function buildHomeList(input: HomeListInput): HomeList {
  const kinds = (row: ConversationRow): boolean => input.filter === 'all' || row.kind === input.filter
  const all = mergeConversationRows(input.live, input.imported).filter(kinds)
  const searching = normalizeSearch(input.query) !== ''
  if (searching) {
    const matches = searchRows(all, input.query)
    return { rows: matches, total: matches.length, searching }
  }
  return { rows: nestSubAgents(all), total: all.length, searching }
}

// ── what the archive said ─────────────────────────────────────────────────

export type ArchiveFailureKind = 'unauthorized' | 'forbidden' | 'erased' | 'missing' | 'unavailable' | 'unreachable' | 'unknown'
export interface ArchiveFailure {
  readonly kind: ArchiveFailureKind
  readonly status: number | null
  readonly code: string | null
  readonly title: string
  readonly detail: string
  /** Whether asking again can help without the person doing something else first. */
  readonly retryable: boolean
}

const UNAFFECTED = 'Your live chats are not affected.'

/** Every refusal gets its own words; none is folded into a generic "could not be loaded (N)". */
export function describeArchiveFailure(error: unknown): ArchiveFailure {
  const status = error instanceof ArchiveRequestError ? error.status : null
  const code = error instanceof ArchiveRequestError ? error.code : null
  const make = (kind: ArchiveFailureKind, title: string, detail: string, retryable: boolean): ArchiveFailure =>
    ({ kind, status, code, title, detail, retryable })
  if (status === 401) {
    return make('unauthorized', 'Your session expired', `Sign in again to see your imported chats. ${UNAFFECTED}`, true)
  }
  if (status === 403) {
    return make('forbidden', 'Imported chats are not open to this sign-in',
      `Imported chats can only be opened by the person who owns them, signed in directly. ${UNAFFECTED}`, false)
  }
  if (status === 410) {
    return make('erased', 'Imported chats were erased',
      `The imported chats for this account were erased and cannot be recovered. ${UNAFFECTED}`, false)
  }
  if (status === 404) {
    return make('missing', 'This conversation is not in the archive',
      `It may have been removed. Go back to the list to see what is there. ${UNAFFECTED}`, false)
  }
  if (status === 0) {
    return make('unreachable', 'Imported chats could not be reached', `Check your connection and try again. ${UNAFFECTED}`, true)
  }
  if (status !== null && status >= 500) {
    return make('unavailable', 'Imported chats are unavailable right now', `The archive did not answer. Try again in a moment. ${UNAFFECTED}`, true)
  }
  return make('unknown', 'Imported chats could not be loaded',
    `The archive answered in a way this app could not read. Try again in a moment. ${UNAFFECTED}`, true)
}
