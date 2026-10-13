/**
 * continuation.ts — "Continue with…": the window, the seed, the source's voice.
 *
 * An imported conversation can be picked up. Nothing resumes: the old runtime is
 * gone, and a model cannot inherit another assistant's memory. What can be done
 * honestly is to show a new assistant a bounded transcript of what was said, say
 * plainly that it was somebody else's, and let the person carry on from there.
 *
 * THE WINDOW is built in the signed-in browser from the archive pages the
 * person's own token can read (no agent, service or connector can read an
 * archive). It keeps the first user turn and the tail of the conversation, drops
 * the middle to fit a byte cap, and counts what it dropped. Only text parts of
 * user and assistant messages go in: reasoning, tool activity and attachments do
 * not, and the framing the host adds tells the new assistant it had tools it
 * does not have.
 *
 * THE SAME BYTES ARE SHOWN AND SENT. `WindowMessage` is both what the panel
 * renders under the seam and what `seedPayloadFor` serialises for the seed store,
 * so the person sees exactly what left the browser.
 *
 * THE CAP IS COUNTED ON THE WIRE. Every cost below is the size of the JSON that
 * `seedPayloadFor` produces, not of the raw text: quotes, backslashes and line
 * breaks are escaped on the way out and can double a message. `serializedBytes`
 * of any plan this module builds never exceeds `limits.maxBytes`.
 *
 * ORDER IS THE ARCHIVE'S. The first user turn is placed by its position, not
 * pinned to the front: a conversation that opens with an assistant greeting keeps
 * the greeting before it.
 *
 * PURE where it can be: window building reads pages through the archive's own
 * `messages()` and does no other I/O; nothing here touches storage or the network
 * on its own.
 */

import {
  type ChatMessage,
  type ChatModelOption,
  type ChatVoiceMark,
  unrecordedVoiceMark,
  voiceDisplayName,
  voiceMarkFor,
  voiceProviderLabel,
  modelIdTail,
} from '@shrubbery/chat-kernel'
import type { ContinueIntent } from './chat-service.js'
import {
  ArchiveRequestError,
  type ArchiveMessage,
  type ArchiveMessagePage,
  type ArchiveRevision,
  type ConversationArchive,
} from './conversation-archive.js'

/** Archive pages are fixed at 50 messages by the archive client. */
const ARCHIVE_PAGE = 50
/** How far past the first page to look for the first user turn before giving up. */
const ANCHOR_SCAN_PAGES = 3
/** The fixed JSON of the seed, `{"schema":"sophia.chat-seed.v1","messages":[]}`, rounded up. */
const ENVELOPE_OVERHEAD_BYTES = 64
/** A model id or a provider label from the archive is only trusted in this shape and length. */
const MAX_VOICE_ID_CHARS = 120
const MAX_VOICE_PROVIDER_CHARS = 60
const VOICE_ID = /^[A-Za-z0-9._:/~@+-]+$/
const VOICE_PROVIDER = /^[A-Za-z0-9._ -]+$/
/** The first user turn may take at most this share of the budget: the recent tail matters more. */
const ANCHOR_SHARE = 0.25
/** A cut shorter than this is not worth sending. */
const MIN_CUT_CHARS = 200

/**
 * The seed store takes at most this many messages (`chat-seed.ts`, `C-choreograph-return.md` 1.6), whatever they weigh:
 * a window of tiny messages is cut by count as well as by bytes. The registry does not advertise it.
 */
export const SEED_MAX_MESSAGES = 2_000

export interface WindowLimits {
  /** The seed store's byte cap: the whole serialised payload stays under it. */
  readonly maxBytes: number
  /** A single message longer than this is cut, with the cut said in its text. */
  readonly maxMessageChars: number
  /** The seed store's count cap (`SEED_MAX_MESSAGES` where absent): the first user turn and the tail stay within it. */
  readonly maxMessages?: number
}

/**
 * The live host's limits (Choreograph `e9a294898e8e`, `C-choreograph-return.md` R9), for a registry entry that says
 * none. The host shows the model at most 120,000 characters of an earlier conversation (and shortens any one message
 * over 16,000, keeping its head and tail), and a seed may be 524,288 bytes: a window that is to arrive whole, so that
 * what the panel shows is what the model is shown, stays under the smaller. 95% of 120,000 leaves room for the host's
 * own header above each message and the `> ` it puts before each line; a message is cut, with the cut said in its
 * text, a little under 16,000 so that the host never has to cut it again. Whatever the host still trims it counts
 * and says to the model itself; `windowLimitsFrom` reads the real numbers when the registry gives them.
 */
export const DEFAULT_WINDOW_LIMITS: WindowLimits = Object.freeze({
  maxBytes: 114_000,
  maxMessageChars: 15_900,
  maxMessages: SEED_MAX_MESSAGES,
})

/** One message of the window: exactly what is shown and exactly what is sent. */
export interface WindowMessage {
  /** The archive message id (stable across reads). */
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** Milliseconds since the epoch; 0 when the source recorded no time. */
  readonly at: number
  /** The voice the source recorded for an assistant message. */
  readonly voice?: ChatVoiceMark
}

export interface ContinuationWindow {
  readonly messages: readonly WindowMessage[]
  /** Messages in the archive revision, text or not. */
  readonly total: number
  /** `total` minus what the window carries, for whatever reason it is not carried. */
  readonly omitted: number
}

/** A model the source recorded. The id is as the source wrote it. */
export interface SourceVoice {
  readonly id: string
  readonly provider: string | null
}

export interface ContinuationPlan {
  readonly intent: ContinueIntent
  readonly window: ContinuationWindow
  /** Models the source recorded across the messages read, most recent last. */
  readonly sourceVoices: readonly SourceVoice[]
  readonly firstAt: string | null
  readonly lastAt: string | null
}

export interface ContinuationChoice {
  /**
   * The catalogue id of the voice that will answer. Blank only where there is no catalogue to choose from (the host takes a
   * voice but its catalogue is stale or would not load): the workspace's own voice, the House default, picks the chat up.
   */
  readonly modelId: string
}

export type ContinuationErrorCode =
  | 'archive-unavailable'
  | 'archive-page-short'
  | 'empty-window'
  | 'unsupported'
  | 'voice-unavailable'
  | 'seed-rejected'

export class ContinuationError extends Error {
  readonly code: ContinuationErrorCode

  constructor(code: ContinuationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ContinuationError'
    this.code = code
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function encodedBytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The size of a value once JSON has escaped it. */
function jsonBytes(value: unknown): number {
  return encodedBytes(JSON.stringify(value))
}

/** The message as the seed carries it: the keys the store reads, and no others. */
export interface SeedMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
  /** ISO time the source recorded, or null when it recorded none. */
  readonly occurredAt: string | null
  /** The model the source recorded for an assistant message; absent when it recorded none. */
  readonly voice?: { readonly model: string }
}

function seedMessageOf(message: WindowMessage): SeedMessage {
  return {
    role: message.role,
    text: message.text,
    occurredAt: message.at > 0 ? new Date(message.at).toISOString() : null,
    // Only a model the source itself recorded is named: a mark for "not recorded" says nothing, and the id is the
    // source's own (`moonshotai/kimi-k2.5`), never the catalogue's name for it.
    ...(message.role === 'assistant' && message.voice?.basis === 'source-recorded' && message.voice.id
      ? { voice: { model: message.voice.id } }
      : {}),
  }
}

/** What one message adds to the payload: its exact JSON, and the comma after it. */
function messageCost(message: WindowMessage): number {
  return jsonBytes(seedMessageOf(message)) + 1
}

/** The text a message carries: its text parts, joined. A deleted message carries none. */
function textOf(message: ArchiveMessage): string {
  if (message.state !== 'present') return ''
  return message.parts
    .filter(part => part.kind === 'text' && typeof part.content === 'string')
    .map(part => (part.content as string).trim())
    .filter(Boolean)
    .join('\n\n')
}

function roleOf(message: ArchiveMessage): 'user' | 'assistant' | null {
  return message.role === 'user' || message.role === 'assistant' ? message.role : null
}

function timeOf(message: ArchiveMessage): number {
  if (!message.occurredAt) return 0
  const value = Date.parse(message.occurredAt)
  return Number.isFinite(value) ? value : 0
}

/**
 * The model the source recorded for an assistant message, when the gateway's
 * additive `voice` field is present. The archive client may or may not pass the
 * field through yet, so it is read structurally and validated here: an id that
 * is not shaped like a model id (or is over 120 characters) is treated as not
 * recorded, so nothing odd from an archive rides into the seed or the seam.
 * ASSUMED shape (confirm against the gateway return): `{ id | model | modelId, provider | providerId }`.
 */
export function recordedVoiceOf(message: unknown): SourceVoice | null {
  const voice = asRecord(asRecord(message).voice)
  const id = (string(voice.id) || string(voice.model) || string(voice.modelId)).trim()
  if (!id || id.length > MAX_VOICE_ID_CHARS || !VOICE_ID.test(id)) return null
  const raw = (string(voice.provider) || string(voice.providerId)).trim()
  const provider = raw && raw.length <= MAX_VOICE_PROVIDER_CHARS && VOICE_PROVIDER.test(raw) ? raw : null
  return { id, provider }
}

/** The note that closes a cut message. */
function cutNote(omittedChars: number): string {
  return `\n\n[… ${omittedChars.toLocaleString('en-US')} more characters of this message are not included]`
}

/** The first `maxChars` characters of `text` and a note saying how many were not
 * kept. Never splits a character that takes two code units. */
function cutMessage(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  let kept = text.slice(0, maxChars)
  const last = kept.charCodeAt(kept.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1)
  return `${kept}${cutNote(text.length - kept.length)}`
}

/** The message cut so that it adds at most `budgetBytes` to the payload; null when
 * what would be left is too little to be worth sending. */
function cutToBudget(message: WindowMessage, budgetBytes: number): WindowMessage | null {
  if (messageCost(message) <= budgetBytes) return message
  let low = 0
  let high = message.text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (messageCost({ ...message, text: cutMessage(message.text, middle) }) <= budgetBytes) low = middle
    else high = middle - 1
  }
  if (low < MIN_CUT_CHARS) return null
  return { ...message, text: cutMessage(message.text, low) }
}

function toWindowMessage(
  message: ArchiveMessage,
  limits: WindowLimits,
  markFor: (source: SourceVoice) => ChatVoiceMark,
): WindowMessage | null {
  const role = roleOf(message)
  if (!role) return null
  const text = textOf(message)
  if (!text) return null
  const base = { id: message.messageId, role, text: cutMessage(text, limits.maxMessageChars), at: timeOf(message) }
  if (role === 'user') return base
  const recorded = recordedVoiceOf(message)
  return { ...base, voice: recorded ? markFor(recorded) : unrecordedVoiceMark() }
}

/** A mark for a voice the source recorded: named from the roster when the roster
 * knows the model, by the source's own id when it does not. */
export function sourceVoiceMark(source: SourceVoice, roster: readonly ChatModelOption[]): ChatVoiceMark {
  const match = matchSourceVoice(source, roster)
  if (match.kind === 'exact') {
    return { ...voiceMarkFor(match.model, 'source-recorded'), id: source.id }
  }
  return {
    id: source.id,
    label: modelIdTail(source.id),
    provider: source.provider,
    basis: 'source-recorded',
  }
}

async function pageAt(
  archive: Pick<ConversationArchive, 'messages'>,
  intent: ContinueIntent,
  cursor: number,
): Promise<ArchiveMessagePage> {
  try {
    return await archive.messages(intent.conversationId, intent.revisionId, cursor)
  } catch (error) {
    throw new ContinuationError(
      'archive-unavailable',
      error instanceof Error ? error.message : 'The conversation could not be read.',
      { cause: error },
    )
  }
}

function expectedPageLength(total: number, start: number): number {
  return Math.min(ARCHIVE_PAGE, Math.max(0, total - start))
}

function requireFullPage(page: ArchiveMessagePage, total: number, start: number): void {
  if (page.messages.length !== expectedPageLength(total, start)) {
    throw new ContinuationError(
      'archive-page-short',
      'The archive returned an incomplete page of this conversation.',
    )
  }
}

/**
 * A conversation is picked up only if it is the signed-in account's own, and the version asked for is one of its
 * versions. The archive's revision list says whose it is (`audience: owner-only`, the principal named) and the client
 * refuses another's or nobody's; nothing of the conversation is read before this answers. An intent can come from a
 * shell or a stale tab as easily as from the reader that read the conversation.
 */
export async function assertOwnConversation(
  archive: Pick<ConversationArchive, 'revisions'>,
  intent: Pick<ContinueIntent, 'conversationId' | 'revisionId'>,
): Promise<void> {
  let revisions: readonly ArchiveRevision[]
  try {
    revisions = await archive.revisions(intent.conversationId)
  } catch (error) {
    const foreign = !(error instanceof ArchiveRequestError) && error instanceof Error && /ownership/i.test(error.message)
    throw new ContinuationError(
      'archive-unavailable',
      foreign
        ? 'That conversation is not this account’s, so it cannot be continued here.'
        : error instanceof Error ? error.message : 'The conversation could not be read.',
      { cause: error },
    )
  }
  if (!revisions.some(revision => revision.revisionId === intent.revisionId)) {
    throw new ContinuationError('archive-unavailable', 'That version of the conversation is no longer in your archive.')
  }
}

export interface ReadPlanOptions {
  readonly limits?: WindowLimits
  /** The voice roster, only to name the models the source recorded. */
  readonly roster?: readonly ChatModelOption[]
}

/** An archive message and its position in the revision. */
interface Positioned {
  readonly index: number
  readonly message: ArchiveMessage
  /** What it would carry into the window; null when it carries nothing. */
  readonly carried: WindowMessage | null
}

/**
 * Read the archive with the person's own token and build the window: the first
 * user turn plus the tail, within the byte cap, counting what was left out.
 * Sends nothing anywhere.
 */
export async function readContinuationPlan(
  archive: Pick<ConversationArchive, 'messages'>,
  intent: ContinueIntent,
  options: ReadPlanOptions = {},
): Promise<ContinuationPlan> {
  const limits = options.limits ?? DEFAULT_WINDOW_LIMITS
  const maxMessages = Math.max(1, limits.maxMessages ?? SEED_MAX_MESSAGES)
  const roster = options.roster ?? []
  // A conversation names the same few models over and over: match each once.
  const marks = new Map<string, ChatVoiceMark>()
  const markFor = (source: SourceVoice): ChatVoiceMark => {
    const key = `${source.id}\u0000${source.provider ?? ''}`
    let mark = marks.get(key)
    if (!mark) {
      mark = sourceVoiceMark(source, roster)
      marks.set(key, mark)
    }
    return mark
  }
  const position = (index: number, message: ArchiveMessage): Positioned =>
    ({ index, message, carried: toWindowMessage(message, limits, markFor) })

  const head = await pageAt(archive, intent, 0)
  const total = head.totalMessages
  requireFullPage(head, total, 0)

  // The first user turn: usually on the first page; look a little further if not.
  const scanned: Positioned[] = head.messages.map((message, offset) => position(offset, message))
  let anchor = scanned.find(item => roleOf(item.message) === 'user' && item.carried) ?? null
  for (let scan = 1; !anchor && scan <= ANCHOR_SCAN_PAGES && scan * ARCHIVE_PAGE < total; scan += 1) {
    const start = scan * ARCHIVE_PAGE
    const page = await pageAt(archive, intent, start)
    requireFullPage(page, total, start)
    const more = page.messages.map((message, offset) => position(start + offset, message))
    scanned.push(...more)
    anchor = more.find(item => roleOf(item.message) === 'user' && item.carried) ?? null
  }

  const budget = limits.maxBytes - ENVELOPE_OVERHEAD_BYTES

  // The first user turn is always carried, but never more than its share.
  const anchorMessage = anchor?.carried
    ? cutToBudget(anchor.carried, Math.floor(budget * ANCHOR_SHARE))
    : null
  const tailBudget = budget - (anchorMessage ? messageCost(anchorMessage) : 0)

  // The tail: pages taken from the end backwards until they hold more than the budget.
  const tail: Positioned[] = []
  let cursor = total
  let spent = 0
  let carriedInTail = 0
  while (cursor > 0 && spent < tailBudget && carriedInTail < maxMessages) {
    const start = Math.max(0, cursor - ARCHIVE_PAGE)
    let page = head
    if (start !== 0) {
      page = await pageAt(archive, intent, start)
      requireFullPage(page, total, start)
    }
    const slice = page.messages
      .slice(0, cursor - start)
      .map((message, offset) => position(start + offset, message))
    tail.unshift(...slice)
    for (const item of slice) {
      if (!item.carried) continue
      spent += messageCost(item.carried)
      carriedInTail += 1
    }
    cursor = start
  }

  const carried = fitWindow(
    anchor && anchorMessage ? { index: anchor.index, message: anchorMessage } : null,
    tail,
    tailBudget,
    maxMessages,
  )
  if (carried.length === 0) {
    throw new ContinuationError(
      'empty-window',
      'There is nothing to carry over: this conversation has no text messages.',
    )
  }

  // Everything read, once each, in archive order.
  const seen = new Map<number, Positioned>()
  for (const item of [...scanned, ...tail]) seen.set(item.index, item)
  const ordered = [...seen.values()].sort((left, right) => left.index - right.index)
  return {
    intent,
    window: { messages: carried, total, omitted: Math.max(0, total - carried.length) },
    sourceVoices: distinctSourceVoices(ordered.map(item => item.message)),
    firstAt: firstRecordedTime(head.messages),
    lastAt: lastRecordedTime(tail.length > 0 ? tail.map(item => item.message) : head.messages),
  }
}

/**
 * The first user turn, then as much of the tail as fits, newest first; the result
 * in archive order. The anchor's own cost was taken from the budget already, so it
 * is skipped where it sits in the tail and put back by its position.
 */
function fitWindow(
  anchor: { readonly index: number; readonly message: WindowMessage } | null,
  tail: readonly Positioned[],
  budgetBytes: number,
  maxMessages: number,
): WindowMessage[] {
  let budget = budgetBytes
  // The anchor takes one of the places the store allows; the tail gets the rest, newest first.
  const room = Math.max(0, maxMessages - (anchor ? 1 : 0))
  const kept: Array<{ index: number; message: WindowMessage }> = []
  for (let at = tail.length - 1; at >= 0; at -= 1) {
    const item = tail[at]
    if (!item.carried || (anchor && item.index === anchor.index)) continue
    if (kept.length >= room) break
    const cost = messageCost(item.carried)
    if (cost > budget) {
      // A last message too long for the whole budget is kept, cut, rather than
      // leaving the conversation without its most recent turn.
      if (kept.length === 0) {
        const cut = cutToBudget(item.carried, budget)
        if (cut) kept.unshift({ index: item.index, message: cut })
      }
      break
    }
    kept.unshift({ index: item.index, message: item.carried })
    budget -= cost
  }
  if (anchor) kept.push({ index: anchor.index, message: anchor.message })
  return kept.sort((left, right) => left.index - right.index).map(item => item.message)
}

function firstRecordedTime(messages: readonly ArchiveMessage[]): string | null {
  for (const message of messages) if (timeOf(message) > 0) return new Date(timeOf(message)).toISOString()
  return null
}

function lastRecordedTime(messages: readonly ArchiveMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (timeOf(messages[index]) > 0) return new Date(timeOf(messages[index])).toISOString()
  }
  return null
}

function distinctSourceVoices(messages: readonly ArchiveMessage[]): SourceVoice[] {
  const order: SourceVoice[] = []
  for (const message of messages) {
    if (roleOf(message) !== 'assistant') continue
    const voice = recordedVoiceOf(message)
    if (!voice) continue
    const existing = order.findIndex(candidate => candidate.id === voice.id)
    if (existing >= 0) order.splice(existing, 1)
    order.push(voice)
  }
  return order
}

/** The window as the panel renders it: read-only messages carrying their voice marks. */
export function windowToChatMessages(messages: readonly WindowMessage[]): ChatMessage[] {
  return messages.map(message => ({
    id: `window:${message.id}`,
    role: message.role,
    content: message.text,
    parts: [{ type: 'text' as const, content: message.text }],
    isStreaming: false,
    toolCalls: [],
    createdAt: message.at,
    origin: 'window' as const,
    ...(message.voice ? { voice: message.voice } : {}),
  }))
}

/**
 * What goes to the seed store: `sophia.chat-seed.v1`, the document the host's `parseChatSeedContent` reads (Choreograph
 * `e9a294898e8e`, `C-choreograph-return.md` 1.6), and nothing else. The store is content-addressed over these exact
 * bytes. Where the conversation came from and how much of it there was travel on the launch, not in the body; a key the
 * store does not read is a key a client believes it has said something with (a date spelled `at` is a conversation held
 * "at an unrecorded time", told so to the model).
 */
export interface SeedPayload {
  readonly schema: 'sophia.chat-seed.v1'
  readonly messages: readonly SeedMessage[]
}

export function seedPayloadFor(plan: { readonly window: ContinuationWindow }): SeedPayload {
  return {
    schema: 'sophia.chat-seed.v1',
    messages: plan.window.messages.map(seedMessageOf),
  }
}

export function serializedBytes(payload: SeedPayload): number {
  return encodedBytes(JSON.stringify(payload))
}

/** The seed store's answer: the content address of what it accepted, and when an unclaimed seed lapses (epoch ms). */
export interface SeedReceipt {
  readonly digest: string
  readonly bytes: number
  readonly expiresAt: number | null
}

// ── the source's voice, matched against the catalogue ──

export type SourceVoiceMatch =
  | { readonly kind: 'exact'; readonly source: SourceVoice; readonly model: ChatModelOption }
  | { readonly kind: 'closest'; readonly source: SourceVoice; readonly model: ChatModelOption }
  | { readonly kind: 'none'; readonly source: SourceVoice | null }

/** The model part of an id, lower-cased: `moonshotai/kimi-k2.5` and `kimi-k2.5` are both `kimi-k2.5`. */
function tailOf(id: string): string {
  return modelIdTail(id).toLowerCase()
}

/**
 * The family a model belongs to: the name up to its first version digit.
 * `kimi-k2.5` and `kimi-k3` are `kimi-k`; `claude-sonnet-4-5` is `claude-sonnet`;
 * `qwen3-coder` is `qwen`. A family shorter than three characters is not a family.
 */
export function familyOf(id: string): string {
  const parts: string[] = []
  for (const token of tailOf(id).split(/[-_. ]+/)) {
    if (!token) continue
    const alpha = token.replace(/[0-9].*$/, '')
    if (alpha) parts.push(alpha)
    if (alpha !== token) break
  }
  const family = parts.join('-')
  return family.length >= 3 ? family : ''
}

/**
 * A version's hyphen read as the dot it stands for, for RANKING neighbours only: the old garden wrote
 * `claude-sonnet-4-5` where the catalogue writes `anthropic/claude-sonnet-4.5`. An exact match still needs the same text,
 * so such a pair is "closest", but the closest is the one with the same version, not the newest with the same prefix.
 */
function versionDots(tail: string): string {
  return tail.replace(/(\d)-(?=\d)/g, '$1.')
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}

/**
 * Where the source's model is on offer today. `exact`: the catalogue carries it
 * (the same model part, whichever maker's slug it wears). `closest`: it does not,
 * but the same family does: the nearest name, newest first among equals. `none`:
 * nothing to offer, and the caller omits the entry rather than inventing one.
 * A voice the person cannot pick (disabled) is never offered.
 */
export function matchSourceVoice(
  source: SourceVoice | null,
  roster: readonly ChatModelOption[],
): SourceVoiceMatch {
  if (!source) return { kind: 'none', source: null }
  const wanted = tailOf(source.id)
  if (!wanted) return { kind: 'none', source }
  const offered = roster.filter(model => !model.disabled)
  const exact = offered.find(model => model.id.toLowerCase() === source.id.trim().toLowerCase())
    ?? offered.find(model => tailOf(model.id) === wanted)
  if (exact) return { kind: 'exact', source, model: exact }
  const family = familyOf(source.id)
  if (!family) return { kind: 'none', source }
  const candidates = offered.filter(model => familyOf(model.id) === family)
  if (candidates.length === 0) return { kind: 'none', source }
  const wantedNamed = versionDots(wanted)
  candidates.sort((left, right) =>
    commonPrefixLength(versionDots(tailOf(right.id)), wantedNamed) - commonPrefixLength(versionDots(tailOf(left.id)), wantedNamed)
    || tailOf(right.id).localeCompare(tailOf(left.id)))
  return { kind: 'closest', source, model: candidates[0] }
}

/** The one line naming where the window goes: the model's maker, through OpenRouter. */
export function providerNoticeFor(model: ChatModelOption | null): string {
  if (!model) {
    return 'Continuing sends this conversation to OpenRouter and the model provider behind it.'
  }
  return `Continuing sends this conversation to ${voiceProviderLabel(model)} through OpenRouter.`
}

/** The seam's name for the chosen voice. */
export function seamVoiceLabel(model: ChatModelOption | null, fallbackId: string): string {
  return model ? voiceDisplayName(model) : modelIdTail(fallbackId)
}
