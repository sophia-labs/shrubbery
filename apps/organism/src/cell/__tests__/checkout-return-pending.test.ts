// @vitest-environment node
/**
 * The marker Add credits leaves in this tab before it hands the browser to
 * Stripe, and the return reads back. It carries the balance from BEFORE the
 * payment: Stripe's webhook can land before the browser is back, in which case
 * a poll that baselines on the first read after the return would wait for a
 * rise that already happened.
 */
import { describe, expect, it } from 'vitest'
import {
  PENDING_CHECKOUT_KEY,
  PENDING_CHECKOUT_MAX_AGE_MS,
  defaultCheckoutStorage,
  rememberPendingCheckout,
  takePendingCheckout,
  type PendingCheckout,
  type PendingCheckoutStorage,
} from '../checkout-return.js'

class MemoryStorage implements PendingCheckoutStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

/** A storage that refuses everything, as private windows and blocked site data do. */
class RefusingStorage implements PendingCheckoutStorage {
  getItem(): string | null { throw new DOMException('denied', 'SecurityError') }
  setItem(): void { throw new DOMException('denied', 'QuotaExceededError') }
  removeItem(): void { throw new DOMException('denied', 'SecurityError') }
}

const NOW = 1_800_000_000_000
const topup: PendingCheckout = { kind: 'topup', amountUsd: 25, baselineMicroUsd: 3_760, at: NOW }

describe('the pending checkout marker', () => {
  it('round-trips a top-up and a plan checkout', () => {
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, topup)
    expect(takePendingCheckout(storage, NOW + 1_000)).toEqual(topup)

    const plan: PendingCheckout = { kind: 'plan', amountUsd: null, baselineMicroUsd: null, at: NOW }
    rememberPendingCheckout(storage, plan)
    expect(takePendingCheckout(storage, NOW + 1_000)).toEqual(plan)
  })

  it('is consumed by reading it, so a reload cannot replay a return', () => {
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, topup)
    expect(takePendingCheckout(storage, NOW)).toEqual(topup)
    expect(storage.values.has(PENDING_CHECKOUT_KEY)).toBe(false)
    expect(takePendingCheckout(storage, NOW)).toBeNull()
  })

  it('keeps only the newest checkout', () => {
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, topup)
    rememberPendingCheckout(storage, { ...topup, amountUsd: 50, baselineMicroUsd: 9, at: NOW + 5 })
    expect(takePendingCheckout(storage, NOW + 10)).toEqual({ ...topup, amountUsd: 50, baselineMicroUsd: 9, at: NOW + 5 })
  })

  it('forgets a checkout older than half an hour and reads as absent', () => {
    expect(PENDING_CHECKOUT_MAX_AGE_MS).toBe(30 * 60 * 1000)
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, topup)
    expect(takePendingCheckout(storage, NOW + PENDING_CHECKOUT_MAX_AGE_MS + 1)).toBeNull()
    expect(storage.values.has(PENDING_CHECKOUT_KEY)).toBe(false)

    rememberPendingCheckout(storage, topup)
    expect(takePendingCheckout(storage, NOW + PENDING_CHECKOUT_MAX_AGE_MS)).toEqual(topup)
  })

  it('does not believe a marker from the future', () => {
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, { ...topup, at: NOW + 60 * 60 * 1000 })
    expect(takePendingCheckout(storage, NOW)).toBeNull()
  })

  it.each([
    ['not JSON', '{not json'],
    ['not an object', '"topup"'],
    ['an array', '[]'],
    ['an unknown kind', JSON.stringify({ ...topup, kind: 'gift' })],
    ['a fractional amount', JSON.stringify({ ...topup, amountUsd: 12.5 })],
    ['a string amount', JSON.stringify({ ...topup, amountUsd: '25' })],
    ['a fractional baseline', JSON.stringify({ ...topup, baselineMicroUsd: 1.5 })],
    ['a string baseline', JSON.stringify({ ...topup, baselineMicroUsd: '3760' })],
    ['a missing time', JSON.stringify({ kind: 'topup', amountUsd: 25, baselineMicroUsd: 1 })],
    ['a non-numeric time', JSON.stringify({ ...topup, at: 'yesterday' })],
  ])('treats %s as no marker at all', (_name, raw) => {
    const storage = new MemoryStorage()
    storage.values.set(PENDING_CHECKOUT_KEY, raw)
    expect(takePendingCheckout(storage, NOW)).toBeNull()
    expect(storage.values.has(PENDING_CHECKOUT_KEY)).toBe(false)
  })

  it('never throws when storage refuses, and reads as absent', () => {
    const storage = new RefusingStorage()
    expect(() => rememberPendingCheckout(storage, topup)).not.toThrow()
    expect(takePendingCheckout(storage, NOW)).toBeNull()
  })

  it('is a no-op without a storage', () => {
    expect(() => rememberPendingCheckout(null, topup)).not.toThrow()
    expect(() => rememberPendingCheckout(undefined, topup)).not.toThrow()
    expect(takePendingCheckout(null, NOW)).toBeNull()
    expect(takePendingCheckout(undefined, NOW)).toBeNull()
  })

  it('finds this tab’s session storage without ever throwing', () => {
    // Whether one exists depends on the runtime (a browser has it, older node
    // does not); what must hold everywhere is that asking is safe.
    const storage = defaultCheckoutStorage()
    if (storage === null) return
    expect(typeof storage.getItem).toBe('function')
    expect(typeof storage.setItem).toBe('function')
    expect(typeof storage.removeItem).toBe('function')
  })
})
