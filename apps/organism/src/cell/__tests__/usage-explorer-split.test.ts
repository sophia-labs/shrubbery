/**
 * The Usage page stops contradicting the ledger. The balance is debited by the
 * platform-funded rows, so the page says which rows those are: deducted from
 * credits, paid with the person's own key, or imported history that was never
 * deducted here. Real events, a real reader object, a real element.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { splitUsageTotals, type UsageCoverage, type UsageEvent, type UsageReader } from '../usage-explorer.js'
import '../usage-explorer-view.js'
import type { UsageExplorerView } from '../usage-explorer-view.js'

function event(overrides: Partial<UsageEvent> & Pick<UsageEvent, 'id'>): UsageEvent {
  return {
    source: 'sirin', ts: 200, recordedAt: '1970-01-01T00:00:00.200Z', timezone: 'utc',
    provider: 'openrouter', model: 'google/gemini-2.5-flash', status: 'stop', surface: 'agent',
    graphId: null, sessionId: null, fundingSource: 'platform',
    inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 12,
    costMicroUsd: 100, providerCostMicroUsd: 80, providerReportedCostMicroUsd: null, markupMicroUsd: 20,
    ...overrides,
  }
}

const rows: UsageEvent[] = [
  event({ id: 'sirin:a', costMicroUsd: 848 }),
  event({ id: 'sirin:b', costMicroUsd: 800 }),
  event({ id: 'sirin:c', fundingSource: 'user', costMicroUsd: 500 }),
  event({ id: 'cloud-1:d', source: 'cloud-1', fundingSource: null, costMicroUsd: 1_000_000, provider: 'zen', model: 'old-model' }),
]
const coverage: UsageCoverage[] = [
  { source: 'sirin', eventCount: 3, firstTs: 200, lastTs: 200, state: 'recorded-events', capturedAt: null },
  { source: 'cloud-1', eventCount: 1, firstTs: 100, lastTs: 100, state: 'imported-snapshot', capturedAt: '2026-09-21T00:00:00Z' },
]

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function mount(items: UsageEvent[]): Promise<UsageExplorerView> {
  const reader: UsageReader = { page: async () => ({ items, nextCursor: null, coverage }) }
  const element = document.createElement('mn-usage-explorer') as UsageExplorerView
  element.reader = reader
  document.body.append(element)
  await until(() => element.shadowRoot!.querySelectorAll('tbody tr').length === items.length)
  await element.updateComplete
  return element
}

const label = (element: UsageExplorerView, key: string): string =>
  element.shadowRoot!.querySelector(`[data-usage-split="${key}"] .muted`)!.textContent!.trim()
const amount = (element: UsageExplorerView, key: string): string =>
  element.shadowRoot!.querySelector(`[data-usage-split="${key}"] strong`)!.textContent!.trim()

afterEach(() => document.body.replaceChildren())

describe('splitting recorded usage by who paid', () => {
  it('separates what was deducted, what ran on the person’s own key, and what was imported', () => {
    expect(splitUsageTotals(rows)).toEqual({
      deducted: { costMicroUsd: 1648, events: 2 },
      ownKey: { costMicroUsd: 500, events: 1 },
      imported: { costMicroUsd: 1_000_000, events: 1 },
    })
  })

  it('never loses or invents a micro-dollar', () => {
    const split = splitUsageTotals(rows)
    const whole = rows.reduce((sum, row) => sum + row.costMicroUsd, 0)
    expect(split.deducted.costMicroUsd + split.ownKey.costMicroUsd + split.imported.costMicroUsd).toBe(whole)
    expect(split.deducted.events + split.ownKey.events + split.imported.events).toBe(rows.length)
  })

  it('reads a row with no funding source as imported, wherever it came from', () => {
    const split = splitUsageTotals([event({ id: 'sirin:z', fundingSource: null, costMicroUsd: 7 })])
    expect(split.imported).toEqual({ costMicroUsd: 7, events: 1 })
    expect(split.deducted).toEqual({ costMicroUsd: 0, events: 0 })
  })

  it('never calls earlier-service history deducted here, whatever funding it carries', () => {
    const split = splitUsageTotals([
      event({ id: 'cloud-1:p', source: 'cloud-1', fundingSource: 'platform', costMicroUsd: 9 }),
      event({ id: 'cloud-1:u', source: 'cloud-1', fundingSource: 'user', costMicroUsd: 4 }),
    ])
    expect(split.imported).toEqual({ costMicroUsd: 9, events: 1 })
    expect(split.ownKey).toEqual({ costMicroUsd: 4, events: 1 })
    expect(split.deducted).toEqual({ costMicroUsd: 0, events: 0 })
  })

  it('is all zeros for nothing', () => {
    const zero = { costMicroUsd: 0, events: 0 }
    expect(splitUsageTotals([])).toEqual({ deducted: zero, ownKey: zero, imported: zero })
  })
})

describe('the Usage page', () => {
  it('shows the three totals under their plain names', async () => {
    const element = await mount(rows)
    expect(label(element, 'deducted')).toBe('Deducted from credits')
    expect(amount(element, 'deducted')).toBe('$0.001648')
    expect(label(element, 'ownKey')).toBe('Paid with your own key')
    expect(amount(element, 'ownKey')).toBe('$0.0005')
    expect(label(element, 'imported')).toBe('Imported, not deducted here')
    expect(amount(element, 'imported')).toBe('$1.00')
  })

  it('splits what the filters leave, not the whole history', async () => {
    const element = await mount(rows)
    const search = element.shadowRoot!.querySelector('input[type=search]') as HTMLInputElement
    search.value = 'cloud-1'
    search.dispatchEvent(new Event('input'))
    await element.updateComplete
    expect(element.shadowRoot!.querySelectorAll('tbody tr').length).toBe(1)
    expect(amount(element, 'deducted')).toBe('$0.00')
    expect(amount(element, 'ownKey')).toBe('$0.00')
    expect(amount(element, 'imported')).toBe('$1.00')
  })

  it('says the deduction and the service fee in one honest paragraph, with the fee the backend charges', async () => {
    const element = await mount(rows)
    element.feePercent = 20
    await element.updateComplete
    const note = element.shadowRoot!.querySelector('[data-usage-note]')!.textContent!.trim()
    expect(note).toBe(
      "Calls Sophia paid for are deducted from your credits at the cost shown: the model's price plus a 20% service fee. Calls that ran on your own provider key are not deducted. History imported from the earlier service is shown for reference and was not deducted from this balance.",
    )
    element.feePercent = 15
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('[data-usage-note]')!.textContent).toContain('plus a 15% service fee')
  })

  it('says the deduction without a fee where the backend names none: no number is guessed', async () => {
    const element = await mount(rows)
    const note = element.shadowRoot!.querySelector('[data-usage-note]')!.textContent!.trim()
    expect(note).toBe(
      'Calls Sophia paid for are deducted from your credits at the cost shown. Calls that ran on your own provider key are not deducted. History imported from the earlier service is shown for reference and was not deducted from this balance.',
    )
    expect(note).not.toMatch(/service fee|\d+%/)
  })

  it('no longer says usage is not a credit deduction', async () => {
    const element = await mount(rows)
    const text = element.shadowRoot!.textContent ?? ''
    expect(text).not.toContain('not payment totals or credit deductions')
    expect(text).not.toContain('Provider-key usage may be included')
  })

  it('shows dashes, not zeros, before anything has loaded', async () => {
    const element = document.createElement('mn-usage-explorer') as UsageExplorerView
    document.body.append(element)
    await element.updateComplete
    expect(amount(element, 'deducted')).toBe('—')
    expect(amount(element, 'ownKey')).toBe('—')
    expect(amount(element, 'imported')).toBe('—')
  })
})
