// @vitest-environment node
/**
 * Credit history: what came in (top-ups, the starter credit, carried-over balance)
 * and what was adjusted (goodwill, refunds), from `GET /billing/credits/history`.
 *
 * PARTLY ASSUMED CONTRACT. The gateway half is documented (`GB-gateway-billing-return.md`
 * 2.1): the owner rides at the top level as `userId` or `user_id` and an answer without
 * it is refused; items are a flat `items` list with an optional per-item owner; the
 * cursor is `after`; 404, 502 and 503 mean "no history to show". Choreograph's item
 * fields (`CB-billing-return.md`, sub-task 4) were not yet written down, so the reader
 * accepts the shapes `E-billing-enforce.md` 4.4.4 ("grants and adjustments,
 * owner-scoped") can plausibly take, refuses anything it cannot read, and never shows
 * an id. Two envelopes are pinned: one flat list, and grants beside adjustments;
 * camelCase and snake_case field names both.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HostedCreditHistory, parseCreditHistory } from '../credit-history.js'
import { BillingGateway } from './support/billing-gateway.js'

const TOPUP_AT = Date.parse('2026-09-30T18:00:00.000Z')
const GIFT_AT = Date.parse('2026-10-01T09:30:00.000Z')
const REFUND_AT = Date.parse('2026-10-02T00:00:00.000Z')

describe('reading one flat list', () => {
  const flat = {
    userId: 'alice',
    items: [
      { id: 'grant:pi_3Qabc', kind: 'grant', source: 'stripe', amountMicroUsd: 10_000_000, createdAt: '2026-09-30T18:00:00.000Z' },
      { id: 'adj:1', kind: 'adjustment', reason: 'credits start', amountMicroUsd: 850_000, createdAt: GIFT_AT },
      { id: 'adj:2', kind: 'adjustment', reason: 'refund of a top-up', amountMicroUsd: -5_000_000, createdAt: '2026-10-02T00:00:00Z' },
    ],
    nextCursor: null,
  }

  it('reads grants and adjustments, signed, newest first, with words for a person', () => {
    expect(parseCreditHistory(flat)).toEqual({
      entries: [
        { id: 'adj:2', kind: 'adjustment', amountMicroUsd: -5_000_000, at: REFUND_AT, label: 'Refund of a top-up' },
        { id: 'adj:1', kind: 'adjustment', amountMicroUsd: 850_000, at: GIFT_AT, label: 'Credits start' },
        { id: 'grant:pi_3Qabc', kind: 'grant', amountMicroUsd: 10_000_000, at: TOPUP_AT, label: 'Top-up' },
      ],
      nextCursor: null,
    })
  })

  it('reads the other names for the same list', () => {
    for (const key of ['entries', 'history', 'credits', 'events']) {
      expect(parseCreditHistory({ [key]: flat.items }).entries).toHaveLength(3)
    }
  })

  it('carries a cursor when there is more', () => {
    expect(parseCreditHistory({ ...flat, nextCursor: 'abc_DEF-123' }).nextCursor).toBe('abc_DEF-123')
    expect(parseCreditHistory({ ...flat, next_cursor: 'zz9' }).nextCursor).toBe('zz9')
    expect(parseCreditHistory({ items: [] }).nextCursor).toBeNull()
  })
})

describe('reading grants beside adjustments', () => {
  const split = {
    userId: 'alice',
    grants: [
      { grantId: 'pi:3Qxyz', source: 'payment_intent', amountMicroUsd: 25_000_000, createdAt: 1_790_000_000 },
      { grantId: 'seed:alice', source: 'starter', amountMicroUsd: 1_000_000, createdAt: 1_780_000_000_000 },
      { grantId: 'in:legacy', source: 'cloud-1 import', amountMicroUsd: 3_250_000, createdAt: 1_770_000_000_000 },
    ],
    adjustments: [
      { adjustmentId: 'adj_9', reason: 'goodwill correction', amountMicroUsd: -500_000, createdAt: '2026-10-05T12:00:00Z' },
    ],
  }

  it('says what each grant was without showing its id', () => {
    const page = parseCreditHistory(split)
    expect(page.entries.map(entry => entry.label)).toEqual([
      'Goodwill correction', 'Top-up', 'Starter credit', 'Balance carried over from the earlier service',
    ])
    expect(page.entries.map(entry => entry.kind)).toEqual(['adjustment', 'grant', 'grant', 'grant'])
    expect(JSON.stringify(page.entries.map(entry => entry.label))).not.toMatch(/pi:|seed:|in:|adj_/)
  })

  it('reads epoch seconds as well as milliseconds', () => {
    const page = parseCreditHistory(split)
    const topUp = page.entries.find(entry => entry.label === 'Top-up')!
    expect(topUp.at).toBe(1_790_000_000_000)
  })

  it('reads snake_case names', () => {
    const page = parseCreditHistory({
      items: [{ id: 'g1', type: 'grant', source: 'topup', amount_micro_usd: 5_000_000, created_at: '2026-09-30T18:00:00.000Z' }],
    })
    expect(page.entries).toEqual([{ id: 'g1', kind: 'grant', amountMicroUsd: 5_000_000, at: TOPUP_AT, label: 'Top-up' }])
  })
})

describe('the answer Choreograph writes (sophia.credit-history.v1)', () => {
  // The item contract is Choreograph's `readCreditHistory` (CB `billing-read.ts`, 4ca58b3): an opaque id,
  // a kind (top-up | monthly-deposit | adjustment), `ts` in epoch milliseconds, signed micro-dollars, a
  // label written for the person and, on an adjustment, the reason it was recorded. Newest first.
  const DAY = 86_400_000
  const written = {
    schema: 'sophia.credit-history.v1',
    userId: 'alice',
    items: [
      { id: 'h_5e1d8a90c2b7f4e61a03', kind: 'adjustment', ts: REFUND_AT, amountMicroUsd: -10_000_000, label: 'Refund', reason: 'Refunded at the person’s request' },
      { id: 'h_77aa10d3e9c24b58f6e1', kind: 'adjustment', ts: GIFT_AT, amountMicroUsd: 850_000, label: 'Credits added by Sophia', reason: 'credits start' },
      { id: 'h_20c4be7183d9a05f4c62', kind: 'top-up', ts: TOPUP_AT, amountMicroUsd: 10_000_000, label: 'Credits added', reason: null },
      { id: 'h_9b02f1e45c78d3a60b19', kind: 'monthly-deposit', ts: TOPUP_AT - DAY, amountMicroUsd: 5_000_000, label: 'Monthly credit deposit', reason: null },
    ],
    nextCursor: 'WzE3OTAwMDAwMDAwMDAsImFiYyJd',
  }

  it('reads every kind Choreograph writes, in the reader’s own words for a person (a grant is named by its kind, never by Choreograph’s free text), signed, newest first', () => {
    expect(parseCreditHistory(written)).toEqual({
      entries: [
        { id: 'h_5e1d8a90c2b7f4e61a03', kind: 'adjustment', amountMicroUsd: -10_000_000, at: REFUND_AT, label: 'Refund' },
        { id: 'h_77aa10d3e9c24b58f6e1', kind: 'adjustment', amountMicroUsd: 850_000, at: GIFT_AT, label: 'Credits added by Sophia' },
        { id: 'h_20c4be7183d9a05f4c62', kind: 'grant', amountMicroUsd: 10_000_000, at: TOPUP_AT, label: 'Top-up' },
        { id: 'h_9b02f1e45c78d3a60b19', kind: 'grant', amountMicroUsd: 5_000_000, at: TOPUP_AT - DAY, label: 'Plan credits' },
      ],
      nextCursor: 'WzE3OTAwMDAwMDAwMDAsImFiYyJd',
    })
  })

  it('is not told to show an operator’s reason where Choreograph wrote the person a label', () => {
    const shown = parseCreditHistory(written).entries.map(entry => entry.label).join(' | ')
    expect(shown).not.toContain('credits start')
    expect(shown).not.toContain('at the person’s request')
  })

  it('reads the two adjustment labels that are not a gift or a refund', () => {
    const page = parseCreditHistory({
      userId: 'alice',
      items: [
        { id: 'h_a', kind: 'adjustment', ts: REFUND_AT, amountMicroUsd: -2_000_000, label: 'Payment dispute', reason: null },
        { id: 'h_b', kind: 'adjustment', ts: GIFT_AT, amountMicroUsd: -150_000, label: 'Balance correction', reason: 'a debit that was posted twice' },
      ],
      nextCursor: null,
    })
    expect(page.entries.map(entry => [entry.kind, entry.label])).toEqual([
      ['adjustment', 'Payment dispute'],
      ['adjustment', 'Balance correction'],
    ])
  })
})

describe('labels never leak or run on', () => {
  it('falls back to plain words when the row says nothing', () => {
    const page = parseCreditHistory({
      items: [
        { id: 'a', kind: 'grant', amountMicroUsd: 1 },
        { id: 'b', kind: 'adjustment', amountMicroUsd: -1 },
        { id: 'c', kind: 'adjustment', amountMicroUsd: 1 },
        { id: 'd', amountMicroUsd: 1 },
      ],
    })
    expect(page.entries.map(entry => entry.label).sort()).toEqual(
      ['Adjustment', 'Credit activity', 'Credits added', 'Credits added by Sophia'].sort(),
    )
  })

  it('keeps an operator’s reason on one short line and never shows a grant’s free text', () => {
    const long = `refund ${'x'.repeat(400)}`
    const page = parseCreditHistory({
      items: [
        { id: 'a', kind: 'adjustment', reason: `  line one\nline two ${long}`, amountMicroUsd: -1 },
        { id: 'b', kind: 'grant', source: 'stripe', description: 'Stripe pi_3QSECRET', amountMicroUsd: 1 },
      ],
    })
    const adjustment = page.entries.find(entry => entry.id === 'a')!
    expect(adjustment.label.includes('\n')).toBe(false)
    expect(adjustment.label.length).toBeLessThanOrEqual(141)
    expect(adjustment.label.startsWith('Line one line two refund')).toBe(true)
    expect(page.entries.find(entry => entry.id === 'b')!.label).toBe('Top-up')
  })

  it('prefers a row’s own label to an operator’s reason, which may be for the operator', () => {
    const page = parseCreditHistory({
      items: [
        { id: 'a', kind: 'adjustment', label: 'Goodwill credit', reason: 'ticket 4471 approved by the on-call', amountMicroUsd: 500_000 },
        { id: 'b', kind: 'adjustment', title: 'Refund', description: 'refund of order 1234', reason: 'ops: dispute lost', amountMicroUsd: -500_000 },
      ],
    })
    expect(page.entries.map(entry => entry.label).sort()).toEqual(['Goodwill credit', 'Refund'])
  })

  it('leaves the date unknown rather than inventing one', () => {
    const page = parseCreditHistory({ items: [{ id: 'a', kind: 'grant', amountMicroUsd: 1, createdAt: 'sometime' }, { id: 'b', kind: 'grant', amountMicroUsd: 2 }] })
    expect(page.entries.every(entry => entry.at === null)).toBe(true)
  })

  it('leaves out a row that changed nothing', () => {
    const page = parseCreditHistory({ items: [{ id: 'a', kind: 'adjustment', amountMicroUsd: 0 }, { id: 'b', kind: 'grant', source: 'stripe', amountMicroUsd: 5_000_000 }] })
    expect(page.entries.map(entry => entry.id)).toEqual(['b'])
  })

  it('puts dated entries before undated ones', () => {
    const page = parseCreditHistory({ items: [{ id: 'a', kind: 'grant', amountMicroUsd: 1 }, { id: 'b', kind: 'grant', amountMicroUsd: 2, createdAt: TOPUP_AT }] })
    expect(page.entries.map(entry => entry.id)).toEqual(['b', 'a'])
  })
})

describe('refusing what it cannot read', () => {
  it.each([
    ['not an object', 'items'],
    ['an array', []],
    ['null', null],
    ['no list at all', { userId: 'alice' }],
    ['a list that is not a list', { items: { id: 'a' } }],
    ['a row that is not an object', { items: ['a'] }],
    ['a row without an id', { items: [{ kind: 'grant', amountMicroUsd: 1 }] }],
    ['an amount that is not a number', { items: [{ id: 'a', kind: 'grant', amountMicroUsd: '10' }] }],
    ['a fractional amount', { items: [{ id: 'a', kind: 'grant', amountMicroUsd: 1.5 }] }],
    ['an unsafe amount', { items: [{ id: 'a', kind: 'grant', amountMicroUsd: Number.MAX_SAFE_INTEGER + 1 }] }],
    ['a cursor with odd characters', { items: [], nextCursor: 'a b<script>' }],
    ['a cursor that is not text', { items: [], nextCursor: 12 }],
  ])('throws for %s', (_name, value) => {
    expect(() => parseCreditHistory(value)).toThrow('Invalid credit history response.')
  })
})

const gateway = new BillingGateway()
beforeAll(async () => { await gateway.start() })
afterAll(async () => { await gateway.stop() })
beforeEach(() => { gateway.reset() })

function reader(base: string = gateway.base, subject: () => string = () => 'alice') {
  return new HostedCreditHistory({ userId: subject, token: () => 'id-token' }, base)
}
const okBody = { userId: 'alice', items: [{ id: 'g1', kind: 'grant', source: 'stripe', amountMicroUsd: 5_000_000, createdAt: TOPUP_AT }], nextCursor: 'more_1' }

describe('the reader against a real server', () => {
  it('asks for the history with the bearer and reads what comes back', async () => {
    gateway.history = () => ({ status: 200, body: okBody })
    const page = await reader().page()
    expect(gateway.requests).toHaveLength(1)
    const request = gateway.requests[0]!
    expect(request.method).toBe('GET')
    expect(request.path).toBe('/billing/credits/history')
    expect(request.authorization).toBe('Bearer id-token')
    expect([...request.query.keys()]).toEqual([])
    expect(page?.entries).toEqual([{ id: 'g1', kind: 'grant', amountMicroUsd: 5_000_000, at: TOPUP_AT, label: 'Top-up' }])
    expect(page?.nextCursor).toBe('more_1')
  })

  it('continues from a cursor', async () => {
    gateway.history = () => ({ status: 200, body: { userId: 'alice', items: [] } })
    await reader().page('more_1')
    expect(gateway.requests[0]!.query.get('after')).toBe('more_1')
  })

  it.each([404, 405, 501, 502, 503])('answers null, not an error, when there is no history to show (%i)', async status => {
    gateway.history = () => ({ status, body: { error: { code: 'not_found' } } })
    expect(await reader().page()).toBeNull()
  })

  it('answers null when the gateway has no such route at all', async () => {
    // The loopback gateway answers 404 for an unknown path by default.
    expect(await reader().page()).toBeNull()
  })

  it.each([
    [401, 'Your session expired. Sign in again.'],
    [403, 'Billing requires an authorized signed-in account.'],
    [500, 'Credit history could not be loaded (500).'],
    [504, 'Credit history could not be loaded (504).'],
  ])('says so in plain words for %i, never echoing the upstream text', async (status, line) => {
    gateway.history = () => ({ status, text: 'private upstream diagnostic' })
    const error = await reader().page().then(() => null, (thrown: unknown) => thrown as Error)
    expect(error?.message).toBe(line)
    expect(error?.message).not.toContain('private upstream')
  })

  it('refuses another person’s history', async () => {
    gateway.history = () => ({ status: 200, body: { ...okBody, userId: 'bob' } })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
  })

  it('refuses an answer that does not say whose it is, as the gateway does', async () => {
    const { userId: _owner, ...unowned } = okBody
    gateway.history = () => ({ status: 200, body: unowned })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
  })

  it('reads the owner under either name the gateway admits', async () => {
    const { userId: _owner, ...unowned } = okBody
    gateway.history = () => ({ status: 200, body: { ...unowned, user_id: 'alice' } })
    expect((await reader().page())?.entries).toHaveLength(1)
  })

  it('refuses an item that names another owner, whatever the top level says', async () => {
    gateway.history = () => ({ status: 200, body: { ...okBody, items: [{ ...okBody.items[0], userId: 'bob' }] } })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
    gateway.history = () => ({ status: 200, body: { ...okBody, items: [{ ...okBody.items[0], user_id: 'bob' }] } })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
    gateway.history = () => ({ status: 200, body: { ...okBody, items: [{ ...okBody.items[0], userId: 'alice' }] } })
    expect((await reader().page())?.entries).toHaveLength(1)
  })

  it('refuses an answer it cannot read', async () => {
    gateway.history = () => ({ status: 200, text: 'not json' })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
    gateway.history = () => ({ status: 200, body: { userId: 'alice', items: [{ id: 'g', kind: 'grant', amountMicroUsd: 'ten' }] } })
    await expect(reader().page()).rejects.toThrow('Invalid credit history response.')
  })

  it('discards an answer for a session that has since changed', async () => {
    let subject = 'alice'
    gateway.history = () => {
      subject = 'bob'
      return { status: 200, body: okBody }
    }
    await expect(reader(gateway.base, () => subject).page()).rejects.toThrow('Your account session changed. Refresh credit history.')
  })

  it('needs a signed-in account', async () => {
    const signedOut = new HostedCreditHistory({ userId: () => '', token: () => undefined }, gateway.base)
    await expect(signedOut.page()).rejects.toThrow('Sign in to view credit history.')
    expect(gateway.requests).toHaveLength(0)
  })

  it('says so when it cannot be reached', async () => {
    await expect(reader('http://127.0.0.1:1').page()).rejects.toThrow('Credit history could not be reached. Try again.')
  })

  it('refuses a gateway address with credentials or a query in it', () => {
    expect(() => new HostedCreditHistory({ userId: () => 'alice', token: () => 't' }, 'https://user:pass@gateway.example')).toThrow('Invalid credit history gateway.')
    expect(() => new HostedCreditHistory({ userId: () => 'alice', token: () => 't' }, 'https://gateway.example/?x=1')).toThrow('Invalid credit history gateway.')
    expect(() => new HostedCreditHistory({ userId: () => 'alice', token: () => 't' }, 'ftp://gateway.example')).toThrow('Invalid credit history gateway.')
  })
})
