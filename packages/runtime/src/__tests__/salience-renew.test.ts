import { describe, expect, it } from 'vitest'
import type { BlockScore } from '@shrubbery/nucleus'
import {
  canRenewFreshness,
  lastValuedAtMs,
  lastValuedLabel,
  renewLabel,
} from '../editor-services/salience-bundle-service.js'

function score(overrides: Partial<BlockScore> = {}): BlockScore {
  return {
    blockId: 'block-a',
    documentId: 'doc',
    cumulativeImportance: 0,
    cumulativeValence: 0,
    rawImportanceSum: 0,
    rawValenceSum: 0,
    importanceCount: 0,
    valenceCount: 0,
    compositeScore: 0,
    blockWireCount: 0,
    docWireCount: 0,
    lastValuatedAt: null,
    userImportance: null,
    userValence: null,
    ...overrides,
  }
}

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 29, 12)

describe('renewing freshness, as the cell rules it', () => {
  it('needs a value: an agent valuation or a rating by the reader', () => {
    expect(canRenewFreshness(undefined)).toBe(false)
    expect(canRenewFreshness(score())).toBe(false)
    expect(canRenewFreshness(score({ importanceCount: 1, rawImportanceSum: 3 }))).toBe(true)
    expect(canRenewFreshness(score({ userImportance: 3 }))).toBe(true)
    expect(canRenewFreshness(score({ userValence: -4 }))).toBe(true)
  })

  it('refuses a block the reader let go (rated 0), even if agents valued it', () => {
    expect(canRenewFreshness(score({ userImportance: 0, importanceCount: 2, rawImportanceSum: 8 }))).toBe(false)
    expect(renewLabel(score({ userImportance: 0 }))).toMatch(/let go/)
  })

  it('reads the cell clock in epoch ms or ISO', () => {
    expect(lastValuedAtMs(score({ lastValuatedAt: String(NOW) }))).toBe(NOW)
    expect(lastValuedAtMs(score({ lastValuatedAt: new Date(NOW).toISOString() }))).toBe(NOW)
    expect(lastValuedAtMs(score({ lastValuatedAt: '' }))).toBeNull()
  })

  it('says when the block was last valued', () => {
    const at = (ms: number) => score({ userImportance: 3, lastValuatedAt: String(ms) })
    expect(lastValuedLabel(at(NOW - 1000), NOW)).toBe('today')
    expect(lastValuedLabel(at(NOW - DAY - 1000), NOW)).toBe('yesterday')
    expect(lastValuedLabel(at(NOW - 12 * DAY), NOW)).toBe('12 days ago')
    expect(renewLabel(at(NOW - 12 * DAY), NOW)).toBe('Renew — still matters (last valued 12 days ago)')
    expect(renewLabel(score(), NOW)).toMatch(/rate this block first/i)
  })
})
