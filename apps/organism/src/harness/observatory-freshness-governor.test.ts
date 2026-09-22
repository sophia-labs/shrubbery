/**
 * observatory-freshness-governor.test.ts — real, no-mock coverage for the
 * freshness governor's DOM controller. `FakeQueryBlockService` is a plain
 * class implementing the REAL `@shrubbery/runtime` `QueryBlockService`
 * interface (no mocking-library primitives) — the SAME test-double
 * convention as `observatory-freshness.test.ts`'s own `MemoryRestClient`,
 * one layer lower (this file drives the governor directly, so there is no
 * SPARQL-JSON wire format to round-trip through).
 *
 * `now`/`visibility` are injected functions throughout — never a monkeypatch
 * of `Date` or `document.visibilityState` (P3a contract step 7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueryBlockResult, QueryBlockRow, QueryBlockService } from '@shrubbery/runtime'
import {
  OBSERVATORY_FRESHNESS_STYLE_ID,
  createObservatoryFreshnessGovernor,
} from './observatory-freshness-governor.js'
import { FRESHNESS_STALE_AFTER_MS, FRESHNESS_WARNING_AFTER_MS } from './observatory-freshness.js'

const GRAPH_ID = 'observatory-freshness-governor-test'

const RUN_VARS = [
  'run',
  'evaluatedAt',
  'asOf',
  'projectedThrough',
  'cursorHighWaterMark',
  'outcome',
  'computationStatus',
  'environment',
  'engineName',
  'engineVersion',
] as const

/** A real `QueryBlockService` — no mocking library. `respond` is called fresh on every `run()`. */
class FakeQueryBlockService implements QueryBlockService {
  calls = 0
  constructor(private readonly respond: () => QueryBlockResult | Promise<QueryBlockResult>) {}
  async run(): Promise<QueryBlockResult> {
    this.calls += 1
    return this.respond()
  }
}

function runRow(overrides: Partial<Record<(typeof RUN_VARS)[number], string | null>> = {}): QueryBlockRow {
  const defaults: Record<string, string | null> = {
    run: 'urn:sophia:observatory:run:governor-test',
    evaluatedAt: '2026-07-15T12:00:00.000Z',
    asOf: null,
    projectedThrough: '2026-07-15T12:00:00.000Z',
    cursorHighWaterMark: null,
    outcome: 'ok',
    computationStatus: 'ok',
    environment: null,
    engineName: null,
    engineVersion: null,
  }
  const merged = { ...defaults, ...overrides }
  const row: QueryBlockRow = {}
  for (const key of RUN_VARS) {
    const value = merged[key]
    if (value == null) continue
    row[key] = key === 'run' ? { type: 'uri', value } : { type: 'literal', value }
  }
  return row
}

function bindingsResult(rows: readonly QueryBlockRow[]): QueryBlockResult {
  return {
    queryKind: 'select',
    resultKind: 'bindings',
    columns: [...RUN_VARS],
    rows,
    durationMs: 0,
    raw: null,
  }
}

const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
  document.getElementById(OBSERVATORY_FRESHNESS_STYLE_ID)?.remove()
})

describe('createObservatoryFreshnessGovernor', () => {
  it('start() publishes data-freshness + data-stale on the stamp element, and a later fresh verdict removes both — reversible, not a one-way latch', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    let currentRow = runRow({ evaluatedAt: '2026-06-01T00:00:00.000Z', projectedThrough: '2026-06-01T00:00:00.000Z' })
    const service = new FakeQueryBlockService(() => bindingsResult([currentRow]))
    const nowMs = Date.parse('2026-07-15T12:00:00.000Z')
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      now: () => nowMs,
      refreshSeconds: 0,
    })

    governor.start()
    await governor.refreshNow()
    expect(stampEl.dataset.freshness).toBe('stale')
    expect(stampEl.dataset.stale).toBe('true')

    currentRow = runRow({ evaluatedAt: '2026-07-15T11:59:00.000Z', projectedThrough: '2026-07-15T11:59:00.000Z' })
    await governor.refreshNow()
    expect(stampEl.dataset.freshness).toBe('fresh')
    expect(stampEl.dataset.stale).toBeUndefined()
  })

  it('THE CONFESSION INVARIANT: across a fresh→stale transition, a sibling content element is byte-identical and only the named attribute names appear', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    const registerEl = document.createElement('div')
    const sibling = document.createElement('div')
    sibling.textContent = 'real rendered content'
    sibling.style.cssText = 'color: rgb(1, 2, 3);'
    registerEl.appendChild(sibling)
    hostEl.appendChild(registerEl)

    let nowMs = Date.parse('2026-07-15T13:01:00.000Z')
    const evaluatedAt = '2026-07-15T13:00:00.000Z'
    const service = new FakeQueryBlockService(() => bindingsResult([runRow({ evaluatedAt, projectedThrough: evaluatedAt })]))
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      registerEls: [registerEl],
      now: () => nowMs,
      refreshSeconds: 0,
    })

    const beforeStampAttrs = new Set(stampEl.getAttributeNames())
    const beforeRegisterAttrs = new Set(registerEl.getAttributeNames())
    const beforeSiblingText = sibling.textContent
    const beforeSiblingStyle = sibling.style.cssText
    const beforeSiblingInert = sibling.inert
    const beforeSiblingHidden = sibling.hidden

    governor.start()
    await governor.refreshNow()
    expect(stampEl.dataset.freshness).toBe('fresh')

    nowMs = Date.parse('2026-07-23T13:01:00.000Z') // 8 days later
    await governor.refreshNow()
    expect(stampEl.dataset.freshness).toBe('stale')

    // Real page content is never touched — corrected BESIDE, never over.
    expect(sibling.textContent).toBe(beforeSiblingText)
    expect(sibling.style.cssText).toBe(beforeSiblingStyle)
    expect(sibling.inert).toBe(beforeSiblingInert)
    expect(sibling.hidden).toBe(beforeSiblingHidden)

    const newStampAttrs = [...stampEl.getAttributeNames()].filter((name) => !beforeStampAttrs.has(name))
    const newRegisterAttrs = [...registerEl.getAttributeNames()].filter((name) => !beforeRegisterAttrs.has(name))
    expect(new Set(newStampAttrs)).toEqual(new Set(['data-freshness', 'data-stale', 'style']))
    expect(new Set(newRegisterAttrs)).toEqual(new Set(['class']))
  })

  it('age advances on the wall clock WITHOUT a re-query — tone walks fresh→warning→stale on tick alone, exactly one query total', async () => {
    vi.useFakeTimers()
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    const evaluatedAtMs = Date.parse('2026-07-15T12:00:00.000Z')
    const evaluatedAt = new Date(evaluatedAtMs).toISOString()
    let nowMs = evaluatedAtMs
    const service = new FakeQueryBlockService(() => bindingsResult([runRow({ evaluatedAt, projectedThrough: evaluatedAt })]))
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      now: () => nowMs,
      tickMs: 1_000,
      refreshSeconds: 999_999, // far larger than the 24h+ jump below — no auto re-query should fire
    })

    governor.start()
    await governor.refreshNow()
    expect(stampEl.dataset.freshness).toBe('fresh')
    expect(service.calls).toBe(1)

    nowMs = evaluatedAtMs + FRESHNESS_WARNING_AFTER_MS + 1
    await vi.advanceTimersByTimeAsync(1_000)
    expect(stampEl.dataset.freshness).toBe('warning')
    expect(service.calls).toBe(1)

    nowMs = evaluatedAtMs + FRESHNESS_STALE_AFTER_MS + 1
    await vi.advanceTimersByTimeAsync(1_000)
    expect(stampEl.dataset.freshness).toBe('stale')
    expect(service.calls).toBe(1)

    governor.dispose()
  })

  it('polling is suppressed while hidden and resumes immediately on becoming visible', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    let visible = true
    let nowMs = Date.parse('2026-07-15T12:00:00.000Z')
    const evaluatedAt = '2026-07-15T12:00:00.000Z'
    const service = new FakeQueryBlockService(() => bindingsResult([runRow({ evaluatedAt, projectedThrough: evaluatedAt })]))
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      now: () => nowMs,
      tickMs: 5_000_000, // effectively irrelevant — this test drives visibilitychange directly
      refreshSeconds: 1,
      visibility: () => (visible ? 'visible' : 'hidden'),
    })

    governor.start()
    await governor.refreshNow()
    expect(service.calls).toBe(1)

    nowMs += 5_000 // cadence (1s) is now due
    visible = false
    document.dispatchEvent(new Event('visibilitychange'))
    await flushAsync()
    expect(service.calls).toBe(1) // suppressed while hidden

    visible = true
    document.dispatchEvent(new Event('visibilitychange'))
    await flushAsync()
    expect(service.calls).toBe(2) // resumes immediately on becoming visible

    governor.dispose()
  })

  it('dispose() clears the timer/listener, removes the strip, and removes every published attribute/class/custom-property — the injected <style> is left in place', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    const registerEl = document.createElement('div')
    let visible = true
    let nowMs = Date.parse('2026-07-15T12:00:00.000Z')
    const service = new FakeQueryBlockService(() =>
      bindingsResult([runRow({ evaluatedAt: '2026-06-01T00:00:00.000Z', projectedThrough: '2026-06-01T00:00:00.000Z' })]),
    )
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      registerEls: [registerEl],
      now: () => nowMs,
      tickMs: 1_000,
      refreshSeconds: 1,
      visibility: () => (visible ? 'visible' : 'hidden'),
    })

    governor.start()
    await governor.refreshNow()
    expect(hostEl.children).toHaveLength(1)
    expect(stampEl.dataset.stale).toBe('true')
    expect(registerEl.classList.contains('obs-stale')).toBe(true)
    expect(document.getElementById(OBSERVATORY_FRESHNESS_STYLE_ID)).not.toBeNull()

    const callsBeforeDispose = service.calls
    governor.dispose()

    expect(hostEl.children).toHaveLength(0)
    expect(stampEl.getAttributeNames()).toEqual([])
    expect(registerEl.getAttributeNames()).toEqual([])
    // The injected <style> is deliberately left in place.
    expect(document.getElementById(OBSERVATORY_FRESHNESS_STYLE_ID)).not.toBeNull()

    // No further queries: neither a wall-clock jump nor a visibility flip revives it.
    nowMs += 10_000
    visible = false
    document.dispatchEvent(new Event('visibilitychange'))
    visible = true
    document.dispatchEvent(new Event('visibilitychange'))
    await flushAsync()
    expect(service.calls).toBe(callsBeforeDispose)
  })

  it('re-check is single-flight — concurrent calls trigger exactly one query, and the button is disabled meanwhile', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    // A plain function-typed (never-null) variable — a `T | null` here trips
    // TypeScript's control-flow narrowing into `never` at the call site below,
    // since the only reassignment happens inside the Promise executor closure.
    let resolveRead: (result: QueryBlockResult) => void = () => {
      throw new Error('resolveRead was never captured — FakeQueryBlockService.run() was not called')
    }
    const service = new FakeQueryBlockService(
      () =>
        new Promise<QueryBlockResult>((resolve) => {
          resolveRead = resolve
        }),
    )
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      now: () => Date.parse('2026-07-15T12:00:00.000Z'),
      refreshSeconds: 0,
    })

    governor.start() // fires the first (in-flight, unresolved) read internally
    const recheckButton = hostEl.querySelector('[data-obs-freshness-recheck]') as HTMLButtonElement
    expect(recheckButton.disabled).toBe(true)

    const p1 = governor.refreshNow()
    const p2 = governor.refreshNow()
    const p3 = governor.refreshNow()
    expect(service.calls).toBe(1) // still just the one from start()

    resolveRead(bindingsResult([runRow({ evaluatedAt: '2026-07-15T12:00:00.000Z', projectedThrough: '2026-07-15T12:00:00.000Z' })]))
    await Promise.all([p1, p2, p3])

    expect(service.calls).toBe(1)
    expect(recheckButton.disabled).toBe(false)
  })

  it('the strip is one aria-live region carrying watermark, run time, computation status, and outcome', async () => {
    const stampEl = document.createElement('div')
    const hostEl = document.createElement('div')
    const service = new FakeQueryBlockService(() =>
      bindingsResult([
        runRow({
          evaluatedAt: '2026-07-15T12:00:00.000Z',
          projectedThrough: '2026-07-15T09:00:00.018Z',
          computationStatus: 'ok',
          outcome: 'ok',
        }),
      ]),
    )
    const governor = createObservatoryFreshnessGovernor({
      queryService: service,
      graphId: GRAPH_ID,
      hostEl,
      stampEl,
      now: () => Date.parse('2026-07-15T12:05:00.000Z'),
    })

    governor.start()
    await governor.refreshNow()

    const strips = hostEl.querySelectorAll('.obs-freshness')
    expect(strips).toHaveLength(1)
    const strip = strips[0] as HTMLElement
    expect(strip.getAttribute('role')).toBe('status')
    expect(strip.getAttribute('aria-live')).toBe('polite')
    expect(strip.getAttribute('aria-atomic')).toBe('true')
    expect(strip.textContent).toContain('2026-07-15T09:00:00.018Z') // watermark, quoted raw
    expect(strip.textContent).toContain('2026-07-15T12:00:00.000Z') // run time, quoted raw
    expect(strip.textContent).toContain('status ok')
    expect(strip.textContent).toContain('outcome ok')

    governor.dispose()
  })
})
