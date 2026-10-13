/**
 * The Sobremesa routes of a scripted Choreograph and gateway (NO MOCKS: served by the
 * same real HTTP server as `choreograph-sim.ts`).
 *
 * The paths and response shapes below are the ones `sobremesa-contract.ts` reads. The
 * voice catalogue is `C-choreograph-return.md` 1.7's, spelled as it spells it
 * (`choreograph.chat-models.v1`, at the gateway root, billed prices). The SEED STORE is
 * the live one's (Choreograph `e9a294898e8e`, `chat-seed.ts` and `workflow/workspace-chat.ts`):
 * it takes `sophia.chat-seed.v1` `{ schema, messages: [{ role, text, occurredAt?, voice?: { model } }] }`
 * and, stricter than the host, REFUSES any other key (so a client that adds one, or spells a
 * key another way, fails here and not silently in production); it answers 201 the first time
 * these bytes are stored and 200 after, `{ digest, bytes, expiresAt }` with `expiresAt` in epoch
 * milliseconds; the digest is over the exact bytes posted. A launch's `seed` and `title` are
 * admitted the way the host admits them (unknown keys, the digest, the byte count, the window),
 * and what the host would TELL THE MODEL about the earlier conversation (its dates and the models
 * the record names) is derived exactly as the host derives it (`seedBriefing`), so a test can
 * assert what the continuing assistant is told, not only what the browser sent. The session-list
 * row is ASSUMED with `sobremesa-contract.ts`. `GET /billing/balance` is not assumed:
 * it is the live gateway's own, as F-step-zero read it.
 *
 * Every route can be switched off (answers 404, as an older host or gateway would) or
 * made to refuse, so the tests can hold the failure paths as firmly as the good ones.
 */

import { createHash } from 'node:crypto'
import {
  BALANCE_PATH,
  CHAT_SEEDS_PATH,
  CHAT_SESSIONS_PATH,
  VOICE_CATALOGUE_PATH,
  VOICE_CATALOGUE_SCHEMA,
} from '../../sobremesa-paths.js'
import type { Answer, ChoreographSim, Received } from './choreograph-sim.js'

/**
 * A voice as a test writes it. Prices are what the PERSON PAYS, per million tokens, the
 * service fee already in them (that is what the catalogue lists: `C-choreograph-return.md`
 * 1.7). `chatModelsBody` puts it on the wire the way Choreograph spells it.
 */
export interface CatalogueRow {
  readonly id: string
  /** The voice's name without its maker ("Kimi K2.6"); the wire says "Moonshot: Kimi K2.6". */
  readonly label: string
  readonly house?: boolean
  readonly priceInPerMTok: number | null
  readonly priceOutPerMTok: number | null
  readonly contextLength?: number
  readonly supportsTools?: boolean
  /** The price rises above a prompt size. */
  readonly tiered?: boolean
}

function row(
  id: string,
  label: string,
  priceIn: number | null,
  priceOut: number | null,
  extra: Partial<CatalogueRow> = {},
): CatalogueRow {
  return { id, label, priceInPerMTok: priceIn, priceOutPerMTok: priceOut, contextLength: 262_144, supportsTools: true, ...extra }
}

/** The makers' names as OpenRouter writes them before the colon of a model's name. */
const MAKER_NAMES: Readonly<Record<string, string>> = {
  google: 'Google',
  moonshotai: 'MoonshotAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  perplexity: 'Perplexity',
}

/** One row as Choreograph puts it on the wire (`C-choreograph-return.md` 1.7). */
export function wireRow(voice: CatalogueRow): Record<string, unknown> {
  const vendor = voice.id.replace(/^~/, '').split('/')[0]
  return {
    id: voice.id,
    name: `${MAKER_NAMES[vendor] ?? vendor}: ${voice.label}`,
    provider: 'openrouter',
    vendor,
    contextLength: voice.contextLength ?? 262_144,
    maxCompletionTokens: 65_535,
    ...(voice.priceInPerMTok !== null ? { promptPerMillionUsd: voice.priceInPerMTok } : {}),
    ...(voice.priceOutPerMTok !== null ? { completionPerMillionUsd: voice.priceOutPerMTok } : {}),
    tools: voice.supportsTools ?? true,
    reasoning: false,
    inputModalities: ['text'],
    houseDefault: voice.house === true,
    tiered: voice.tiered === true,
  }
}

/** The whole body of `GET /chat/models?view=chat`, as `C-choreograph-return.md` 1.7 spells it. */
export function chatModelsBody(
  voices: readonly CatalogueRow[],
  options: { stale?: boolean; markupPercent?: number; houseAdmissible?: boolean } = {},
): Record<string, unknown> {
  const house = voices.find(voice => voice.house)
  const markupPercent = options.markupPercent ?? 20
  return {
    schema: VOICE_CATALOGUE_SCHEMA,
    provider: 'openrouter',
    fetchedAt: '2026-09-29T20:00:00.000Z',
    catalogDigest: 'c'.repeat(64),
    stale: options.stale ?? false,
    houseDefault: { provider: 'openrouter', model: house?.id ?? 'google/gemini-2.5-flash', admissible: options.houseAdmissible ?? true },
    pricing: {
      currency: 'USD',
      unit: 'per-million-tokens',
      source: 'openrouter-live-catalogue',
      markupPercent,
      markupBps: markupPercent * 100,
    },
    count: voices.length,
    models: voices.map(wireRow),
  }
}

/**
 * The House default and a handful of the voices the round's Kimi report read live. Prices
 * are what the person pays (the provider's price plus the 20% fee, rounded up to a
 * micro-dollar), USD per million tokens: House 0.30 / 2.50 raw is 0.36 / 3 billed.
 */
export function voiceCatalogue(): CatalogueRow[] {
  return [
    row('google/gemini-2.5-flash', 'Gemini 2.5 Flash', 0.36, 3, { house: true, contextLength: 1_048_576 }),
    row('moonshotai/kimi-k2.5', 'Kimi K2.5', 0.54, 2.7),
    row('moonshotai/kimi-k2.6', 'Kimi K2.6', 0.78, 4.092),
    row('moonshotai/kimi-k3', 'Kimi K3', 3.6, 18),
    row('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5', 3.6, 18, { contextLength: 200_000, tiered: true }),
    row('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 0.66, 2.628, { contextLength: 131_072 }),
  ]
}

/**
 * A premium voice: `openai/gpt-5.4-pro` at $36 in / $216 out per million tokens as billed
 * ($30 / $180 and the 20% fee), the row the billing report priced its top band from (a short
 * turn of about $0.15). Added by the tests that need one; the default catalogue has none.
 */
export function premiumVoiceRow(): CatalogueRow {
  return row('openai/gpt-5.4-pro', 'GPT-5.4 Pro', 36, 216, { contextLength: 400_000 })
}

export interface ReceivedSeed {
  readonly graph: string | null
  readonly body: unknown
  readonly digest: string
  readonly bytes: number
}

// ── the seed store, as the live host runs it (Choreograph e9a2948, chat-seed.ts) ──

export const SEED_SCHEMA = 'sophia.chat-seed.v1'
export const SEED_MAX_BYTES = 524_288
export const SEED_MAX_MESSAGES = 2_000
/** An unclaimed seed is served for an hour. */
export const SEED_UNCLAIMED_TTL_MS = 3_600_000
const SEED_DIGEST = /^sha256:[0-9a-f]{64}$/
const MODEL_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/

/** One message of a stored seed, as the host reads it. */
export interface SeedMessageRead {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly occurredAt: string | null
  readonly voiceModel: string | null
}

export class SeedFault extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort()
  if (unknown.length > 0) throw new SeedFault('seed_invalid', 400, `${label} has fields the contract does not name: ${unknown.join(', ')}`)
}

/**
 * Validate posted bytes the way `prepareChatSeed` and `parseChatSeedContent` do (size, UTF-8, JSON, schema,
 * 1 to 2,000 messages, role, text, `occurredAt`, `voice.model` only on an assistant), and stricter: a key the
 * contract does not name is refused. Never quotes the text.
 */
export function readSeedAsHost(raw: string): SeedMessageRead[] {
  if (Buffer.byteLength(raw) > SEED_MAX_BYTES) throw new SeedFault('seed_too_large', 413, `a seed is at most ${SEED_MAX_BYTES} bytes`)
  if (raw.length === 0) throw new SeedFault('seed_invalid', 400, 'a seed must not be empty')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SeedFault('seed_invalid', 400, 'a seed must be a JSON document')
  }
  if (!isRecord(parsed) || parsed.schema !== SEED_SCHEMA) throw new SeedFault('seed_invalid', 400, `a seed must declare schema ${SEED_SCHEMA}`)
  onlyKeys(parsed, ['schema', 'messages'], 'the seed')
  const messages = parsed.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > SEED_MAX_MESSAGES) {
    throw new SeedFault('seed_invalid', 400, `a seed must hold between 1 and ${SEED_MAX_MESSAGES} messages`)
  }
  return messages.map((entry, index): SeedMessageRead => {
    const position = index + 1
    if (!isRecord(entry)) throw new SeedFault('seed_invalid', 400, `message ${position} must be an object`)
    onlyKeys(entry, ['role', 'text', 'occurredAt', 'voice'], `message ${position}`)
    const role = entry.role
    if (role !== 'user' && role !== 'assistant') throw new SeedFault('seed_invalid', 400, `message ${position} has a role that is not user or assistant`)
    if (typeof entry.text !== 'string') throw new SeedFault('seed_invalid', 400, `message ${position} must carry its text as a string`)
    const occurredAt = entry.occurredAt ?? null
    if (occurredAt !== null && (typeof occurredAt !== 'string' || occurredAt.length > 64 || Number.isNaN(Date.parse(occurredAt)))) {
      throw new SeedFault('seed_invalid', 400, `message ${position} has a date that is not a date`)
    }
    const voice = entry.voice ?? null
    let voiceModel: string | null = null
    if (voice !== null) {
      if (role === 'user') throw new SeedFault('seed_invalid', 400, `message ${position} is a person's and cannot carry a model voice`)
      if (!isRecord(voice) || typeof voice.model !== 'string' || voice.model.trim() === '') {
        throw new SeedFault('seed_invalid', 400, `message ${position} has a voice without a recorded model`)
      }
      onlyKeys(voice, ['model'], `message ${position}'s voice`)
      if (voice.model.length > 200) throw new SeedFault('seed_invalid', 400, `message ${position} has an overlong voice model`)
      voiceModel = voice.model.trim()
    }
    return { role, text: entry.text, occurredAt, voiceModel }
  })
}

const formatDay = (iso: string): string => new Date(Date.parse(iso)).toISOString().slice(0, 10)
const modelLabel = (model: string): string => (MODEL_LABEL.test(model) ? model : 'an unrecognized model id')

/** What the host tells the model of the earlier conversation, as `renderChatSeed` derives it (dates, models, the count omitted). */
export interface SeedBriefing {
  /** The framing paragraph, the release spec's (section 3.2) with only its placeholders filled. */
  readonly framing: string
  /** The header the host writes above each message: its number, role, date and the voice the record names. */
  readonly headers: readonly string[]
}

/**
 * Derived exactly as Choreograph `renderChatSeedFraming`, `dateRangeOf`, `distinctModels` and
 * `renderMessageBlock` derive them (copied, with their spec wording, from `chat-seed.ts` at `e9a2948`): a
 * client that sends a date or a model under a key the host does not read gets "an unrecorded time" and
 * "Its model was not recorded" here, as it would from the real host.
 */
export function seedBriefing(messages: readonly SeedMessageRead[], window: { omitted: number; total: number }): SeedBriefing {
  const times = messages
    .map(message => (message.occurredAt === null ? Number.NaN : Date.parse(message.occurredAt)))
    .filter(time => Number.isFinite(time))
  const first = times.length === 0 ? null : formatDay(new Date(Math.min(...times)).toISOString())
  const last = times.length === 0 ? null : formatDay(new Date(Math.max(...times)).toISOString())
  const models: string[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.voiceModel !== null) {
      const label = modelLabel(message.voiceModel)
      if (!models.includes(label)) models.push(label)
    }
  }
  const held = first !== null && last !== null ? `${first}\u2013${last}` : 'at an unrecorded time'
  const model = models.length > 0 ? `Its model was recorded at the source as ${models.join(', ')}.` : 'Its model was not recorded.'
  const framing = [
    `What follows is a transcript of an earlier conversation between the person you are speaking with and a different assistant, held ${held} in the old Garden and imported read-only.`,
    model,
    'You were not part of it.',
    'Do not speak as that assistant, continue its sentences, or claim its memories, commitments or tools as yours; it had tools you do not have.',
    'Treat the transcript as something the person has shown you.',
    `${window.omitted} of ${window.total} messages were omitted from the middle to fit.`,
    'The next message is addressed to you.',
  ].join(' ')
  const headers = messages.map((message, index) => {
    const date = message.occurredAt === null ? 'undated' : formatDay(message.occurredAt)
    const voice = message.role === 'assistant'
      ? message.voiceModel === null ? ' \u00b7 voice: not recorded' : ` \u00b7 voice: ${modelLabel(message.voiceModel)} (recorded at the source)`
      : ''
    return `[message ${index + 1} of ${messages.length} \u00b7 ${message.role} \u00b7 ${date}${voice}]`
  })
  return { framing, headers }
}

const LINE_BREAKS = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/

/**
 * How many characters of the model's budget the host spends on these messages: `renderMessageBlock`'s block (its header,
 * then every physical line of the text prefixed with `> `) and the two characters of separation after it, summed, as
 * `renderChatSeed` sums them before it decides what to keep (copied from `chat-seed.ts` at `e9a2948`; the hiding
 * characters it strips and the per-message cap are not modelled: a window is built under both already).
 */
export function renderedChars(messages: readonly SeedMessageRead[], headers: readonly string[]): number {
  return messages.reduce((sum, message, index) => {
    const lines = message.text.split(LINE_BREAKS)
    const block = `${headers[index]}\n${lines.map(line => `> ${line}`).join('\n')}`
    return sum + block.length + 2
  }, 0)
}

/** What the host stored of a seed. */
export interface StoredSeed {
  readonly digest: string
  readonly bytes: number
  readonly messages: readonly SeedMessageRead[]
}

/** A launch the host admitted with a seed, and what the continuing assistant would be told. */
export interface AdmittedSeed {
  readonly graph: string
  readonly invocationId: string
  readonly digest: string
  readonly continuesConversation: { archiveConversationUrn: string; revisionId: string }
  readonly window: { kept: number; omitted: number; total: number }
  /** `input.title` as sent (the host takes its own whitespace-collapsed, 200-character form). */
  readonly title: string | null
  /** `input.seed.title` as sent. */
  readonly seedTitle: string | null
  readonly briefing: SeedBriefing
  /** What the host spends of the model's budget on the window it was sent (see `renderedChars`). */
  readonly renderedChars: number
}

const fault = (code: string, status: number, message: string): Answer => ({ status, body: { error: { code, message } } })
const badInput = (message: string): Answer => fault('workspace_chat_input_invalid', 400, message)

export interface SessionRowFixture {
  readonly sessionId: string
  readonly title?: string
  readonly model?: string
  readonly provider?: string
  readonly createdAt?: number
  readonly lastActivityAt?: number
  readonly graphId?: string
  readonly runId?: string
  readonly continuesConversation?: { archiveConversationUrn: string; revisionId: string }
}

export class SobremesaRoutes {
  /** The voices served at `/chat/models?view=chat` (on the wire as Choreograph spells them); null answers 404 (an older gateway). */
  catalogue: { readonly models: readonly CatalogueRow[] } | null = { models: voiceCatalogue() }
  /** When set, served verbatim instead (the gateway's old projection, a stale body, a malformed one). */
  rawCatalogue: { status?: number; body: unknown } | undefined
  /** `stale`, the fee and whether House is admissible, for the body served from `catalogue`. */
  catalogueOptions: { stale?: boolean; markupPercent?: number; houseAdmissible?: boolean } = {}
  /** Every seed POSTed and accepted, in order (a second POST of the same bytes is listed again). */
  readonly seeds: ReceivedSeed[] = []
  /** What the store holds, by digest. */
  readonly stored = new Map<string, StoredSeed>()
  /** Every launch admitted with a seed, in order. */
  readonly admitted: AdmittedSeed[] = []
  /** When set, the seed POST is refused with this. */
  seedRefusal: { status: number; body?: unknown } | null = null
  /** When false, the seed route does not exist (an older gateway): 404. */
  seedRoute = true
  /** Served at the session-list path; null answers 404 (an older host). */
  sessions: SessionRowFixture[] | null = null
  /** Served at `/billing/balance`; null answers 404. */
  balance: { status: number; body?: unknown } | null = null
  /** The requests each route saw, for asserting what was and was not asked. */
  readonly asked = { catalogue: 0, sessions: 0, balance: 0 }
  /** Every request the catalogue route took, whole. */
  readonly catalogueRequests: Received[] = []

  constructor(private readonly sim: ChoreographSim) {
    sim.extraRoutes.push(request => this.answer(request))
    sim.admissions.push(request => this.admit(request))
  }

  /** A balance the way the live gateway spells it. */
  static balanceBody(
    userId: string,
    balanceMicroUsd: number,
    options: {
      initialized?: boolean
      canMakeRequests?: boolean
      /** What the backend says of the credits regime (Vera, 2026-10-03); each is absent unless given, as on an older backend. */
      gateMode?: 'observe' | 'enforce'
      feeBps?: number
      creditsStartDate?: string | number
    } = {},
  ) {
    return {
      balanceMicroUsd,
      balance_micro_usd: balanceMicroUsd,
      balance_usd: balanceMicroUsd / 1_000_000,
      can_make_requests: options.canMakeRequests ?? true,
      floorMicroUsd: -500_000,
      initialized: options.initialized ?? true,
      lifetimeUsageMicroUsd: 1_000_000 - balanceMicroUsd,
      userId,
      user_id: userId,
      ...(options.gateMode === undefined ? {} : { gateMode: options.gateMode, gate_mode: options.gateMode }),
      ...(options.feeBps === undefined ? {} : { feeBps: options.feeBps, fee_bps: options.feeBps }),
      ...(options.creditsStartDate === undefined ? {} : { creditsStartDate: options.creditsStartDate, credits_start_date: options.creditsStartDate }),
    }
  }

  private answer(request: Received): Answer | undefined {
    if (request.route === BALANCE_PATH && request.method === 'GET') {
      this.asked.balance += 1
      return this.balance ? { status: this.balance.status, body: this.balance.body } : { status: 404, body: { error: 'no route' } }
    }
    if (request.graph === null && request.route === VOICE_CATALOGUE_PATH.split('?')[0] && request.method === 'GET') {
      this.asked.catalogue += 1
      this.catalogueRequests.push(request)
      if (this.rawCatalogue) return { status: this.rawCatalogue.status ?? 200, body: this.rawCatalogue.body }
      return this.catalogue === null
        ? { status: 404, body: { error: 'no route' } }
        : { status: 200, body: chatModelsBody(this.catalogue.models, this.catalogueOptions) }
    }
    if (request.graph === null) return undefined
    if (request.route === CHAT_SEEDS_PATH && request.method === 'POST') {
      if (!this.seedRoute) return { status: 404, body: { error: 'no route' } }
      if (this.seedRefusal) return { status: this.seedRefusal.status, body: this.seedRefusal.body }
      let messages: SeedMessageRead[]
      try {
        messages = readSeedAsHost(request.rawBody)
      } catch (error) {
        if (error instanceof SeedFault) return fault(error.code, error.status, error.message)
        throw error
      }
      const digest = `sha256:${createHash('sha256').update(request.rawBody).digest('hex')}`
      const bytes = Buffer.byteLength(request.rawBody)
      const known = this.stored.has(digest)
      this.stored.set(digest, { digest, bytes, messages })
      this.seeds.push({ graph: request.graph, body: request.body, digest, bytes })
      // 201 the first time these bytes are stored, 200 after; `expiresAt` is epoch milliseconds.
      return { status: known ? 200 : 201, body: { digest, bytes, expiresAt: this.sim.clock + SEED_UNCLAIMED_TTL_MS } }
    }
    if (
      request.route === CHAT_SESSIONS_PATH.split('?')[0]
      && request.query.get('view') === 'chat-sessions'
      && request.method === 'GET'
    ) {
      this.asked.sessions += 1
      return this.sessions === null
        ? { status: 404, body: { error: 'no route' } }
        : { status: 200, body: { sessions: this.sessions.map(item => ({ graphId: request.graph, ...item })) } }
    }
    return undefined
  }

  /**
   * What the host checks of a workspace-chat launch before any run exists: its `title`, and its `seed` (unknown
   * keys refused, never dropped; the digest, the byte count and the window must match what the store holds).
   * A registry that does not advertise `seed` is an older host, which drops the key and starts a plain chat.
   */
  private admit(request: Received): Answer | undefined {
    if (request.method !== 'POST' || request.route !== '/invocations' || request.graph === null) return undefined
    if (request.body?.target?.workflowName !== 'workspace-chat-v1') return undefined
    const input = request.body?.input
    if (!isRecord(input)) return undefined
    const entry = this.sim.workflows.find(workflow => (workflow as { name?: string }).name === 'workspace-chat-v1') as
      | { inputs?: { properties?: Record<string, unknown> } }
      | undefined
    const advertised = entry?.inputs?.properties ?? {}
    if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') return badInput('title must be text')
    const seed = input.seed
    if (seed === undefined || seed === null || !('seed' in advertised)) return undefined
    if (!isRecord(seed)) return badInput('seed must be an object')
    const unknown = Object.keys(seed).filter(key => !['seedDigest', 'bytes', 'continuesConversation', 'window', 'title'].includes(key)).sort()
    if (unknown.length > 0) return badInput(`seed has unknown fields: ${unknown.join(', ')}`)
    if (typeof seed.seedDigest !== 'string' || !SEED_DIGEST.test(seed.seedDigest)) {
      return badInput('seed.seedDigest must be a sha256 digest (sha256:<64 lower-case hex>)')
    }
    const bytes = seed.bytes
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > SEED_MAX_BYTES) {
      return badInput(`seed.bytes must be an integer from 1 to ${SEED_MAX_BYTES}`)
    }
    const continues = seed.continuesConversation
    if (
      !isRecord(continues)
      || Object.keys(continues).some(key => key !== 'archiveConversationUrn' && key !== 'revisionId')
      || typeof continues.archiveConversationUrn !== 'string' || continues.archiveConversationUrn === '' || continues.archiveConversationUrn.length > 500
      || typeof continues.revisionId !== 'string' || continues.revisionId === '' || continues.revisionId.length > 200
    ) {
      return badInput('seed.continuesConversation must be { archiveConversationUrn, revisionId }, non-empty text')
    }
    const window = seed.window
    if (!isRecord(window) || Object.keys(window).some(key => key !== 'kept' && key !== 'omitted' && key !== 'total')) {
      return badInput('seed.window must be { kept, omitted, total }')
    }
    const { kept, omitted, total } = window
    for (const count of [kept, omitted, total]) {
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return badInput('seed.window counts must be non-negative integers')
    }
    if ((kept as number) < 1 || (total as number) !== (kept as number) + (omitted as number)) {
      return badInput('seed.window must keep at least one message, and total must be kept plus omitted')
    }
    for (const title of [seed.title, input.title]) {
      if (title !== undefined && title !== null && typeof title !== 'string') return badInput('a title must be text')
    }
    const stored = this.stored.get(seed.seedDigest)
    if (!stored) return fault('seed_not_found', 404, 'no such seed for this person, or it has expired')
    if (stored.bytes !== bytes) return fault('seed_bytes_mismatch', 409, "the seed's size is not the size the invocation named")
    if (stored.messages.length !== kept) return fault('seed_window_mismatch', 400, 'the seed does not hold the number of messages its window says')
    const counts = { kept: kept as number, omitted: omitted as number, total: total as number }
    const briefing = seedBriefing(stored.messages, counts)
    this.admitted.push({
      graph: request.graph,
      invocationId: String(request.body?.invocationId ?? ''),
      digest: seed.seedDigest,
      continuesConversation: { archiveConversationUrn: continues.archiveConversationUrn, revisionId: continues.revisionId },
      window: counts,
      title: typeof input.title === 'string' ? input.title : null,
      seedTitle: typeof seed.title === 'string' ? seed.title : null,
      briefing,
      renderedChars: renderedChars(stored.messages, briefing.headers),
    })
    return undefined
  }
}
