/**
 * sobremesa-contract.ts — everything the SPA assumes about the Sobremesa surface of
 * Choreograph and the gateway, in ONE module.
 *
 * WHY ONE MODULE. The Choreograph half of this release was written by another body
 * and read here only through its return file (`C-choreograph-return.md`). Where that
 * file has fixed a fact, the constant below says where it was read; where it had not
 * when this code was written, the item is marked ASSUMED, and reconciling it is a
 * change to this file and to nothing else. The hosted service, the store and the
 * panel never see a route path, a JSON key of the host or an error code: they see
 * the types this module returns.
 *
 * FAILING SAFE. Every ASSUMED item degrades to "the feature is not offered", never to
 * a wrong request the host would silently misread: a registry that does not advertise
 * an input hides the picker or the Continue action (an older Choreograph drops keys it
 * does not know), a catalogue that will not load leaves the roster empty, a seed the
 * store refuses stops the conversation before any message is sent.
 *
 * Observed live (F-step-zero, 2026-09-28) and therefore not assumed: the shape of
 * `GET /billing/balance`.
 */

import { type ChatModelOption, modelIdTail } from '@shrubbery/chat-kernel'
import { ContinuationError, DEFAULT_WINDOW_LIMITS, type SeedReceipt, type WindowLimits } from './continuation.js'
import { type CreditsFacts, parseCreditsFacts } from './credits-facts.js'
import {
  BALANCE_PATH,
  CHAT_SEEDS_PATH,
  CHAT_SESSIONS_PATH,
  VOICE_CATALOGUE_PATH,
  VOICE_CATALOGUE_SCHEMA,
} from './sobremesa-paths.js'

export { BALANCE_PATH, CHAT_SEEDS_PATH, CHAT_SESSIONS_PATH, VOICE_CATALOGUE_PATH, VOICE_CATALOGUE_SCHEMA }

// ── routes ──






// ── what the registry advertises ──

/** The `workspace-chat-v1` input that names the voice. Advertised by `inputs.properties`. */
export const INFERENCE_INPUT = 'inference'
/** The `workspace-chat-v1` input that carries a claimed seed. Advertised by `inputs.properties`. */
export const SEED_INPUT = 'seed'

export function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The input names a registry entry declares (its `inputs.properties` keys). */
export function advertisedInputs(workflow: unknown): ReadonlySet<string> {
  return new Set(Object.keys(asRecord(asRecord(asRecord(workflow).inputs).properties)))
}

// ── the voice catalogue ──

/** Shown on the House default: named honestly, as what it is and by whom it is run. */
const HOUSE_NOTE = 'House default · via OpenRouter'
/** Shown on a voice whose price rises above a prompt size (the listed price is the base price). */
const TIERED_NOTE = 'Price rises for long prompts'
/** The longest model id a launch accepts (`MAX_MODEL_ID_CHARS`, `C-choreograph-return.md` 2). */
const MAX_MODEL_ID_CHARS = 200

/** The voices on offer, and the fee their prices already carry. */
export interface ChatCatalogue {
  readonly voices: ChatModelOption[]
  /** The service fee included in every price, in percent, when the catalogue says (`pricing.markupPercent`). */
  readonly feePercent: number | null
}

/** A price as listed: what the person pays, USD per million tokens. Not a price if it is not a number, or below zero. */
function billedPrice(value: unknown): number | null {
  const price = finite(value)
  return price !== null && price >= 0 ? price : null
}

/**
 * The name shown for a voice. OpenRouter names a model "Maker: Model" ("Google: Gemini 2.5
 * Flash") and the picker already groups by maker, so the maker is not said twice. A name with
 * nothing after the colon is kept whole; a missing name falls back to the id's own tail.
 */
function voiceName(name: unknown, id: string): string {
  const full = text(name).trim()
  if (!full) return modelIdTail(id)
  const stripped = full.replace(/^[^:]{1,40}:\s+/, '').trim()
  return stripped || full
}

/**
 * The catalogue as a roster: `choreograph.chat-models.v1` (`C-choreograph-return.md` 1.7), or
 * null. Anything else is not one: the gateway's old projection answers at this route today,
 * lists every model OpenRouter has (batch routes, free models) at float prices, and must never
 * be offered as a picker. A stale catalogue is not offered either.
 *
 * Every listed model is one a launch would admit, and each price is what the person pays
 * (the provider's price and the service fee, in USD per million tokens, rounded up to a
 * micro-dollar): nothing here adds the fee again. A row missing either price, or that cannot
 * use tools, is still listed but disabled with its reason, so it can be seen and never picked.
 * The route of a model (`provider: "openrouter"`) is not its maker: the maker is read off the
 * id by the picker. `houseDefault` marks the House voice; where the catalogue says the House
 * default would itself be refused (`houseDefault.admissible: false`) no voice is marked, and the
 * person is asked to choose.
 */
export function parseCatalogue(body: unknown): ChatCatalogue | null {
  const root = asRecord(body)
  if (root.schema !== VOICE_CATALOGUE_SCHEMA || root.stale === true || !Array.isArray(root.models)) return null
  const houseAdmissible = asRecord(root.houseDefault).admissible !== false
  const seen = new Set<string>()
  const voices: ChatModelOption[] = []
  for (const raw of root.models) {
    const row = asRecord(raw)
    const id = text(row.id).trim()
    if (!id || id.length > MAX_MODEL_ID_CHARS || seen.has(id)) continue
    seen.add(id)
    const priceIn = billedPrice(row.promptPerMillionUsd)
    const priceOut = billedPrice(row.completionPerMillionUsd)
    const tools = typeof row.tools === 'boolean' ? row.tools : null
    const house = row.houseDefault === true && houseAdmissible
    const unpriced = priceIn === null || priceOut === null
    const note = [house ? HOUSE_NOTE : '', row.tiered === true ? TIERED_NOTE : ''].filter(Boolean).join(' · ')
    voices.push({
      id,
      label: voiceName(row.name, id),
      ...(house ? { house: true } : {}),
      ...(note ? { note } : {}),
      priceInPerMTok: priceIn,
      priceOutPerMTok: priceOut,
      contextLength: finite(row.contextLength),
      supportsTools: tools,
      ...(unpriced || tools === false
        ? {
          disabled: true,
          disabledReason: unpriced
            ? 'No price is listed for this voice, so it cannot be offered.'
            : 'This voice cannot use tools.',
        }
        : {}),
    })
  }
  return { voices, feePercent: finite(asRecord(root.pricing).markupPercent) }
}

// ── the launch inputs ──

/** The voice, as `workspace-chat-v1` takes it (`inference {provider: 'openrouter', model}`). */
export function inferenceInput(modelId: string): { readonly provider: 'openrouter'; readonly model: string } {
  return { provider: 'openrouter', model: modelId }
}

export interface SeedLineage {
  readonly archiveConversationUrn: string
  readonly revisionId: string
}

/** The window a launch states, as counts: `kept` messages are in the seed, `omitted` were not carried, `total` were in the conversation. */
export interface SeedWindowCounts {
  readonly kept: number
  readonly omitted: number
  readonly total: number
}

/**
 * The claimed seed, as `workspace-chat-v1` takes it (`C-choreograph-return.md` 1.2 and R9; the host refuses an
 * unknown key rather than drop it): the invocation carries only the digest, the byte count, where the conversation
 * came from, the window as counts and the title, never a body. The host checks that the seed it holds for this person
 * is that many bytes and holds exactly `kept` messages. A window the host would refuse (none kept, or a total that is
 * not kept plus omitted) is refused here first, with nothing sent.
 */
export function seedInput(
  receipt: SeedReceipt,
  lineage: SeedLineage,
  window: SeedWindowCounts,
  title: string | null,
): Record<string, unknown> {
  const counts = [window.kept, window.omitted, window.total]
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0) || window.kept < 1 || window.total !== window.kept + window.omitted) {
    throw new ContinuationError('seed-rejected', 'The window of that conversation does not add up. Nothing was sent.')
  }
  return {
    seedDigest: receipt.digest,
    bytes: receipt.bytes,
    continuesConversation: {
      archiveConversationUrn: lineage.archiveConversationUrn,
      revisionId: lineage.revisionId,
    },
    window: { kept: window.kept, omitted: window.omitted, total: window.total },
    ...(title ? { title } : {}),
  }
}

const SEED_DIGEST = /^sha256:[0-9a-f]{64}$/

/**
 * The seed store's answer to a POST (`C-choreograph-return.md` 1.6): `{ digest, bytes, expiresAt }`, the digest being
 * `sha256:` and the lower-case hex of exactly the bytes sent, and `expiresAt` epoch milliseconds. A body that is not that
 * is not a receipt: what the launch names must be an address the host can look up.
 */
export function parseSeedReceipt(body: unknown): SeedReceipt | null {
  const source = asRecord(body)
  const digest = typeof source.digest === 'string' ? source.digest : ''
  const bytes = finite(source.bytes)
  if (!SEED_DIGEST.test(digest) || bytes === null || !Number.isSafeInteger(bytes) || bytes < 1) return null
  const expires = finite(source.expiresAt)
  return { digest, bytes, expiresAt: expires !== null && expires > 0 ? expires : null }
}

/** The title a launch may carry, in characters the host keeps (`titleMaxChars`). */
const TITLE_MAX_CHARS = 200
const CONTINUED_SUFFIX = ' \u00b7 continued'

/** A title in the characters the host keeps: whitespace collapsed, and a longer one cut on a whole character with an ellipsis. */
export function capTitle(title: string, maxChars: number = TITLE_MAX_CHARS): string {
  const name = title.replace(/\s+/g, ' ').trim()
  const points = Array.from(name)
  return points.length <= maxChars ? name : `${points.slice(0, Math.max(0, maxChars - 1)).join('').trimEnd()}\u2026`
}

/**
 * "{old title} · continued": the title of a conversation that picks up another, never derived from the seed or from what
 * is said in it. Whitespace is collapsed; an old title too long for the host's 200 characters is cut (on a whole character,
 * with an ellipsis) so that the suffix still says what this is.
 */
export function continuedTitle(original: string, maxChars: number = TITLE_MAX_CHARS): string {
  const name = original.replace(/\s+/g, ' ').trim() || 'Untitled conversation'
  const points = Array.from(name)
  const room = maxChars - Array.from(CONTINUED_SUFFIX).length
  if (points.length <= room) return `${name}${CONTINUED_SUFFIX}`
  return `${points.slice(0, Math.max(0, room - 1)).join('').trimEnd()}\u2026${CONTINUED_SUFFIX}`
}

/** What a window is built under, from the registry entry's `host.limits` (`C-choreograph-return.md` 1.8); the live defaults where it has none. */
const LIVE_SEED_MAX_BYTES = 524_288
const LIVE_SEED_RENDER_MAX_CHARS = 120_000
/** The least a window may be given, however small the host says its budget is: a first turn and a reply. */
const MIN_WINDOW_BYTES = 2_000

function positiveInteger(value: unknown): number | null {
  const number = finite(value)
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null
}

/**
 * The limits a window is built under. The seed store takes `seedMaxBytes`; the model is shown `seedRenderMaxChars`
 * characters of it, and the host cuts what is over (the middle, counted and said to the model). A window is built to the
 * smaller so that the host has nothing left to cut and the panel shows what the model is shown: 95% of the render budget
 * (the host's header and quote marks take the rest), never above what the store takes. A registry entry with no
 * `host.limits`, or numbers that are not numbers, is an older host: the live defaults stand.
 */
export function windowLimitsFrom(workflow: unknown): WindowLimits {
  const limits = asRecord(asRecord(asRecord(workflow).host).limits)
  const store = positiveInteger(limits.seedMaxBytes)
  const render = positiveInteger(limits.seedRenderMaxChars)
  if (store === null && render === null) return DEFAULT_WINDOW_LIMITS
  const maxBytes = Math.max(
    MIN_WINDOW_BYTES,
    Math.min(store ?? LIVE_SEED_MAX_BYTES, Math.floor((render ?? LIVE_SEED_RENDER_MAX_CHARS) * 0.95)),
  )
  return Object.freeze({ maxBytes, maxMessageChars: DEFAULT_WINDOW_LIMITS.maxMessageChars, maxMessages: DEFAULT_WINDOW_LIMITS.maxMessages })
}

/** A coded error envelope, `{ error: { code, message } }`, whichever way the body is spelled. */
export function codedError(body: unknown): { readonly code: string; readonly message: string } | null {
  const error = asRecord(asRecord(body).error)
  const code = text(error.code)
  return /^[a-z][a-z0-9_]{1,63}$/.test(code) ? { code, message: text(error.message) } : null
}

/** What the person is told wherever the host cannot pick up an earlier conversation. Nothing was sent. */
export const CANNOT_CONTINUE = 'This workspace cannot pick up an earlier conversation yet. Nothing was sent.'

/**
 * What the seed store's refusal means for the person. ASSUMED codes (the Choreograph
 * return lists the real ones): unknown codes fall back to the status. A missing route
 * (an older gateway) is `unsupported`, not a failure of the seed.
 */
export function seedFailure(status: number, body: unknown): ContinuationError {
  const coded = codedError(body)
  const code = coded?.code ?? ''
  if (status === 404 || status === 405 || status === 501) {
    return new ContinuationError('unsupported', CANNOT_CONTINUE)
  }
  if (status === 413 || code.includes('too_large')) {
    return new ContinuationError(
      'seed-rejected',
      'That conversation is too large to carry over. Nothing was sent.',
    )
  }
  if (status === 401) {
    return new ContinuationError('seed-rejected', 'Your session has expired. Sign in again to continue this conversation.')
  }
  if (status === 403 || code.endsWith('_denied')) {
    return new ContinuationError('seed-rejected', 'You do not have access to continue a conversation in this workspace.')
  }
  if (status === 429 || status >= 500 || code.endsWith('_unavailable')) {
    return new ContinuationError('seed-rejected', 'The workspace is not ready yet. Try again in a moment. Nothing was sent.')
  }
  return new ContinuationError(
    'seed-rejected',
    coded ? `The conversation could not be carried over (${coded.code}). Nothing was sent.` : 'The conversation could not be carried over. Nothing was sent.',
  )
}

// ── the session list ──

/** One chat session as Choreograph lists it, normalised. */
export interface SessionRow {
  /** The Agent Session id (`ags_…`). */
  readonly sessionId: string
  readonly runId: string | null
  readonly graphId: string | null
  readonly title: string | null
  /** The model the session resolved. */
  readonly model: string | null
  readonly provider: string | null
  /** Epoch milliseconds. */
  readonly createdAt: number | null
  readonly updatedAt: number | null
  /** Where an imported conversation was picked up from, when the host records it. */
  readonly continuesConversation: SeedLineage | null
}

function epoch(value: unknown): number | null {
  const direct = finite(value)
  if (direct !== null) return direct > 0 ? direct : null
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The session list. ASSUMED response: a list, bare or under `sessions` / `items` /
 * `runs`, each row carrying the Agent Session id as `sessionId` (or `agentSessionId`,
 * `id`) and, when it has them, `title`, `model`, `provider`, `createdAt`,
 * `lastActivityAt | updatedAt`, `graphId`, `runId`, `continuesConversation`. A row
 * without a session id is dropped: there is nothing to open.
 */
export function parseSessionList(body: unknown): SessionRow[] {
  const root = asRecord(body)
  const rows = Array.isArray(body)
    ? body
    : [root.sessions, root.items, root.runs].find(Array.isArray) as unknown[] | undefined ?? []
  const parsed: SessionRow[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    const sessionId = (text(row.sessionId) || text(row.agentSessionId) || text(row.id)).trim()
    if (!sessionId) continue
    const seed = asRecord(row.continuesConversation)
    const urn = text(seed.archiveConversationUrn)
    const revision = text(seed.revisionId)
    parsed.push({
      sessionId,
      runId: text(row.runId).trim() || null,
      graphId: text(row.graphId).trim() || null,
      title: text(row.title).trim() || null,
      model: text(row.model).trim() || null,
      provider: text(row.provider).trim() || null,
      createdAt: epoch(row.createdAt),
      updatedAt: epoch(row.lastActivityAt) ?? epoch(row.updatedAt),
      continuesConversation: urn && revision ? { archiveConversationUrn: urn, revisionId: revision } : null,
    })
  }
  return parsed
}

/**
 * The person's first message, as the session document keeps it: `document.source.prompt`
 * (confirmed by `C-choreograph-return.md`, read at 17:48, 2026-09-29). Used only for a
 * conversation this browser did not start, whose first message it never saw.
 */
export function firstPromptOf(response: unknown): string {
  return text(asRecord(asRecord(asRecord(response).document).source).prompt).trim()
}

// ── the balance (observed live) ──

/** The account's credit balance as `GET /billing/balance` reports it. */
export interface BalanceRead {
  readonly initialized: boolean
  readonly balanceMicroUsd: number
  /** Whether the gateway would take a request now. Absent on older gateways. */
  readonly canMakeRequests: boolean | null
  /**
   * What the backend says of the credits regime beside the balance (the fee, the gate's mode, the day
   * credits start). Absent, not empty, from an older backend that says none of it.
   */
  readonly facts?: CreditsFacts
}

/**
 * Validate the balance the way Settings does: the response must be for this very
 * user, and its integers must be integers. Anything else is "no balance to show".
 */
export function parseBalance(body: unknown, userId: string): BalanceRead | null {
  const row = asRecord(body)
  const balance = row.balanceMicroUsd
  if (row.userId !== userId) return null
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance)) return null
  if (typeof row.initialized !== 'boolean') return null
  const facts = parseCreditsFacts(row)
  return {
    initialized: row.initialized,
    balanceMicroUsd: balance,
    canMakeRequests: typeof row.can_make_requests === 'boolean' ? row.can_make_requests : null,
    ...(facts ? { facts } : {}),
  }
}
