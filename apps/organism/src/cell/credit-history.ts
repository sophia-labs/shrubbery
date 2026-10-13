/**
 * Credit history: what came in (top-ups, the starter credit, a balance carried
 * over from the earlier service) and what was adjusted (goodwill, refunds), read
 * from `GET /billing/credits/history`.
 *
 * PARTLY ASSUMED CONTRACT.
 *
 * Documented (`GB-gateway-billing-return.md` 2.1, 8.6): the owner rides at the top
 * level as `userId` or `user_id` and an answer without it is refused; an item that
 * names an owner must name the caller; the cursor is `after` and `nextCursor`; and
 * 404 (no route), 502 `billing_authority_unavailable` (a Choreograph without the
 * route, or a failing one) and 503 `billing_not_configured` all mean "no history to
 * show", so the list is hidden rather than apologised for.
 *
 * Written down since (Choreograph `readCreditHistory`, schema `sophia.credit-history.v1`): one flat
 * `items` list of `{ id, kind: top-up | monthly-deposit | adjustment, ts (epoch ms), amountMicroUsd,
 * label, reason|null }` and a `nextCursor`; the tests pin it. Before that was written, the reader
 * accepted the shapes `E-billing-enforce.md` 4.4.4
 * ("grants and adjustments, owner-scoped") can plausibly take, and still does: one flat list
 * (`items`, `entries`, `history`, `credits` or `events`) and/or `grants` beside
 * `adjustments`; camelCase or snake_case; times as ISO text, epoch seconds or epoch
 * milliseconds. It refuses what it cannot read and never shows an id. The day the
 * item contract is written down, this file is the one place to tighten.
 */

export type CreditEntryKind = 'grant' | 'adjustment' | 'other'

export interface CreditHistoryEntry {
  readonly id: string
  readonly kind: CreditEntryKind
  /** Signed micro-dollars: a grant adds, a negative adjustment takes back. Never zero. */
  readonly amountMicroUsd: number
  /** Epoch milliseconds, or null when the row carries no readable time. */
  readonly at: number | null
  /** Words for a person: never an id, never a grant's free text. */
  readonly label: string
}

export interface CreditHistoryPage {
  readonly entries: readonly CreditHistoryEntry[]
  readonly nextCursor: string | null
}

export interface CreditHistoryReader {
  /**
   * One page of credit history, newest first, or null when this deployment has no
   * such route (there is then nothing to show and nothing to apologise for).
   */
  page(after?: string): Promise<CreditHistoryPage | null>
}

const invalid = (): Error => new Error('Invalid credit history response.')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const FLAT_LISTS = ['items', 'entries', 'history', 'credits', 'events'] as const
const ID_KEYS = ['id', 'grantId', 'grant_id', 'adjustmentId', 'adjustment_id', 'eventId', 'event_id'] as const
const TIME_KEYS = ['createdAt', 'created_at', 'recordedAt', 'recorded_at', 'ts', 'at', 'timestamp', 'time'] as const
const CURSOR = /^[A-Za-z0-9_\-=.]{1,2048}$/
const LABEL_MAX = 140
/** The largest time a Date can hold; anything beyond is not a time. */
const MAX_TIME_MS = 8.64e15
/** Below this a number is epoch SECONDS (1e11 ms is 1973; seconds today are about 1.8e9). */
const SECONDS_BELOW = 1e11

function textOf(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function idOf(row: Record<string, unknown>): string {
  for (const key of ID_KEYS) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  }
  return ''
}

function amountOf(row: Record<string, unknown>): number | null {
  const value = row.amountMicroUsd ?? row.amount_micro_usd
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function timeOf(row: Record<string, unknown>): number | null {
  for (const key of TIME_KEYS) {
    const value = row[key]
    let ms: number | null = null
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      ms = value < SECONDS_BELOW ? value * 1000 : value
    } else if (typeof value === 'string' && value.trim()) {
      const text = value.trim()
      if (/^\d+$/.test(text)) {
        const whole = Number(text)
        ms = whole < SECONDS_BELOW ? whole * 1000 : whole
      } else {
        const parsed = Date.parse(text)
        ms = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      }
    }
    if (ms !== null && Number.isFinite(ms) && ms > 0 && ms <= MAX_TIME_MS) return Math.round(ms)
  }
  return null
}

function kindOf(row: Record<string, unknown>, declared: CreditEntryKind | null): CreditEntryKind {
  if (declared) return declared
  const said = textOf(row, ['kind', 'type', 'entryType', 'entry_type']).toLowerCase()
  if (said.includes('adjust')) return 'adjustment'
  if (/grant|top-?up|purchase|payment|deposit/.test(said)) return 'grant'
  if ('adjustmentId' in row || 'adjustment_id' in row) return 'adjustment'
  if ('grantId' in row || 'grant_id' in row) return 'grant'
  return 'other'
}

/** What a grant was, from where it came: never the row's free text, which may carry a provider's ids. */
function grantLabel(row: Record<string, unknown>): string {
  // Where it came from: a row's `source`, else its `kind` (Choreograph names a monthly deposit by its kind alone).
  const source = (textOf(row, ['source', 'origin', 'method']) || textOf(row, ['kind', 'type', 'entryType', 'entry_type'])).toLowerCase()
  if (/subscription|invoice|renewal|plan|deposit/.test(source)) return 'Plan credits'
  if (/top-?up|payment|purchase|stripe|checkout/.test(source)) return 'Top-up'
  if (/seed|starter|welcome|initial|sign-?up/.test(source)) return 'Starter credit'
  if (/import|migrat|cloud|carried|legacy/.test(source)) return 'Balance carried over from the earlier service'
  return 'Credits added'
}

/** An adjustment carries words for a person (a label) or an operator's reason: keep them on one short line, sentence case. */
function adjustmentLabel(row: Record<string, unknown>, amountMicroUsd: number): string {
  // A row's own label or title is written for the person; a reason may be written for the operator.
  const reason = textOf(row, ['label', 'title', 'description', 'reason', 'note']).replace(/\s+/g, ' ').trim()
  if (!reason) return amountMicroUsd < 0 ? 'Adjustment' : 'Credits added by Sophia'
  const clipped = reason.length > LABEL_MAX ? `${reason.slice(0, LABEL_MAX)}…` : reason
  return clipped.charAt(0).toUpperCase() + clipped.slice(1)
}

function entryFrom(row: unknown, declared: CreditEntryKind | null): CreditHistoryEntry | null {
  if (!isRecord(row)) throw invalid()
  const id = idOf(row)
  const amountMicroUsd = amountOf(row)
  if (!id || amountMicroUsd === null) throw invalid()
  // A row that changed nothing is noise to a person, and no reason to lose the list.
  if (amountMicroUsd === 0) return null
  const kind = kindOf(row, declared)
  return {
    id,
    kind,
    amountMicroUsd,
    at: timeOf(row),
    label: kind === 'grant' ? grantLabel(row) : kind === 'adjustment' ? adjustmentLabel(row, amountMicroUsd) : 'Credit activity',
  }
}

/** Read a credit-history answer, or throw `Invalid credit history response.` */
export function parseCreditHistory(value: unknown): CreditHistoryPage {
  if (!isRecord(value)) throw invalid()
  const found: Array<{ readonly row: unknown; readonly declared: CreditEntryKind | null }> = []
  let listed = false
  for (const key of FLAT_LISTS) {
    const list = value[key]
    if (!Array.isArray(list)) continue
    listed = true
    for (const row of list) found.push({ row, declared: null })
    break
  }
  for (const [key, declared] of [['grants', 'grant'], ['adjustments', 'adjustment']] as const) {
    const list = value[key]
    if (!Array.isArray(list)) continue
    listed = true
    for (const row of list) found.push({ row, declared })
  }
  if (!listed) throw invalid()
  const entries = found
    .map(({ row, declared }) => entryFrom(row, declared))
    .filter((entry): entry is CreditHistoryEntry => entry !== null)
  const rank = (entry: CreditHistoryEntry): number => entry.at ?? Number.NEGATIVE_INFINITY
  entries.sort((a, b) => {
    const left = rank(a)
    const right = rank(b)
    return left === right ? 0 : right > left ? 1 : -1
  })
  const cursor = value.nextCursor ?? value.next_cursor ?? value.cursor ?? null
  if (cursor !== null && cursor !== '' && (typeof cursor !== 'string' || !CURSOR.test(cursor))) throw invalid()
  return { entries, nextCursor: typeof cursor === 'string' && cursor !== '' ? cursor : null }
}

/** The statuses that mean there is no history to show, not that something the person must read went wrong. */
const NO_HISTORY_STATUSES: readonly number[] = [404, 405, 501, 502, 503]

/**
 * The gateway refuses an answer that does not say whose it is, and so does this: the owner
 * at the top level (`userId` or `user_id`) must be the caller, and so must any owner an item names.
 */
function assertOwnedBy(subject: string, value: unknown): void {
  if (!isRecord(value)) throw invalid()
  const owner = value.userId ?? value.user_id
  if (typeof owner !== 'string' || owner !== subject) throw invalid()
  const lists = [...FLAT_LISTS, 'grants', 'adjustments'].map(key => value[key])
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (!isRecord(row)) continue
      for (const key of ['userId', 'user_id']) {
        if (key in row && row[key] !== subject) throw invalid()
      }
    }
  }
}

interface HistoryAuth {
  userId(): string
  token(): string | null | undefined
  whenReady?(): Promise<void>
}

/** Account-only, bearer-only, like the usage explorer: never a graph or cell endpoint. */
export class HostedCreditHistory implements CreditHistoryReader {
  private readonly base: URL
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly auth: HistoryAuth,
    gatewayBaseUrl: string,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.base = new URL(gatewayBaseUrl)
    if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw new Error('Invalid credit history gateway.')
    }
    // Native browser fetch requires the Window receiver, not this reader.
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }

  async page(after?: string): Promise<CreditHistoryPage | null> {
    try { await this.auth.whenReady?.() } catch { /* an absent session is reported just below */ }
    const subject = this.auth.userId()
    const token = this.auth.token()
    if (!subject || !token) throw new Error('Sign in to view credit history.')
    const query = after ? `?${new URLSearchParams({ after })}` : ''
    let response: Response
    try {
      response = await this.fetchImpl(new URL(`/billing/credits/history${query}`, this.base).href, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error('Credit history could not be reached. Try again.')
    }
    if (subject !== this.auth.userId() || token !== this.auth.token()) {
      throw new Error('Your account session changed. Refresh credit history.')
    }
    // No route here, no route behind the gateway, or billing not configured: nothing to show and
    // nothing to apologise for.
    if (NO_HISTORY_STATUSES.includes(response.status)) return null
    if (response.status === 401) throw new Error('Your session expired. Sign in again.')
    if (response.status === 403) throw new Error('Billing requires an authorized signed-in account.')
    if (!response.ok) throw new Error(`Credit history could not be loaded (${response.status}).`)
    let value: unknown
    try { value = await response.json() } catch { throw invalid() }
    assertOwnedBy(subject, value)
    return parseCreditHistory(value)
  }
}
