import { describe, expect, it } from 'vitest'

import { buildBayStrip, buildConversationRow, buildConversationRows, stripAge } from '@shrubbery/nucleus'

const NOW = 1783285300000

describe('buildBayStrip', () => {
  it('composes a live resident strip with model testimony, as-of, and the count metric', () => {
    expect(
      buildBayStrip({
        id: 'agent-132c2f7244ec645b',
        name: 'learner-1',
        lifecycle: 'resident',
        model: 'deepseek-v4-pro',
        asOf: NOW - 9_000,
        sessionCount: 23,
        now: NOW,
      }),
    ).toEqual({
      id: 'agent-132c2f7244ec645b',
      identity: 'learner-1',
      lifecycle: 'resident',
      tone: 'live',
      stateSentence: 'resident',
      model: { value: 'deepseek-v4-pro' },
      age: 'fresh',
      asOf: NOW - 9_000,
      sessionCount: 23,
    })
  })

  it('carries model attribution as testimony only when the roster witnessed it', () => {
    expect(
      buildBayStrip({ id: 'a', name: 'a', lifecycle: 'resident', model: 'gpt-5', modelObserver: 'vera', modelObservedAt: NOW, now: NOW })
        .model,
    ).toEqual({ value: 'gpt-5', observer: 'vera', observedAt: NOW })
    // No model attested → null, never a placeholder.
    expect(buildBayStrip({ id: 'a', name: 'a', lifecycle: 'resident', model: '  ', now: NOW }).model).toBeNull()
    expect(buildBayStrip({ id: 'a', name: 'a', lifecycle: 'resident', now: NOW }).model).toBeNull()
  })

  it('never earns a count badge for zero or absent sessions', () => {
    expect(buildBayStrip({ id: 'a', name: 'a', lifecycle: 'dormant', sessionCount: 0, now: NOW }).sessionCount).toBeNull()
    expect(buildBayStrip({ id: 'a', name: 'a', lifecycle: 'dormant', now: NOW }).sessionCount).toBeNull()
    expect(buildBayStrip({ id: 'a', name: 'a', lifecycle: 'dormant', sessionCount: 7, now: NOW }).sessionCount).toBe(7)
  })

  it('draws an unattested lifecycle as unknown — dashed, stale, and named, never collapsed into dormant', () => {
    const strip = buildBayStrip({ id: 'a', name: 'shrubbery-2', lifecycle: null, asOf: NOW - 9_000, now: NOW })
    expect(strip.tone).toBe('unknown')
    expect(strip.lifecycle).toBe('unknown')
    expect(strip.stateSentence).toBe('unknown — no lifecycle attested')
    // Even a fresh as-of yields stale age for the unknown tone — the amber threshold.
    expect(strip.age).toBe('stale')

    const unrecognized = buildBayStrip({ id: 'a', name: 'a', lifecycle: 'thinking', now: NOW })
    expect(unrecognized.tone).toBe('unknown')
    expect(unrecognized.stateSentence).toBe('unknown — no lifecycle attested')
  })

  it('decays testimony by age but keeps identity full ink at every step', () => {
    expect(stripAge(NOW - 9_000, 'live', NOW)).toBe('fresh')
    expect(stripAge(NOW - 30 * 60_000, 'held', NOW)).toBe('dim1')
    expect(stripAge(NOW - 3 * 60 * 60_000, 'dormant', NOW)).toBe('dim2')
    // A known lifecycle with no as-of dims to rest, not to the amber alarm.
    expect(stripAge(null, 'dormant', NOW)).toBe('dim2')
    // Unknown is always the amber threshold regardless of freshness.
    expect(stripAge(NOW, 'unknown', NOW)).toBe('stale')
    // Identity never decays — the sentence carries the full name at the stalest age.
    expect(buildBayStrip({ id: 'a', name: 'emporium-1', lifecycle: 'dormant', asOf: NOW - 5 * 24 * 60 * 60_000, now: NOW }).identity).toBe(
      'emporium-1',
    )
  })
})

describe('buildConversationRow', () => {
  it('titles a row from its objective and counts messages when present', () => {
    expect(
      buildConversationRow({
        sessionId: 'ags_ee789010ad9ea0792111',
        objective: 'greenhouse smoke turn 1783285239',
        messageCount: 2,
        lastMessageAt: NOW,
        activeSessionId: 'ags_ee789010ad9ea0792111',
      }),
    ).toEqual({
      sessionId: 'ags_ee789010ad9ea0792111',
      title: 'greenhouse smoke turn 1783285239',
      messageCount: 2,
      lastMessageAt: NOW,
      isActive: true,
    })
  })

  it('renders silence for a null objective and never a "0 messages" badge', () => {
    const row = buildConversationRow({ sessionId: 'ags_86df518eca8b145e7eb5', objective: null, messageCount: 0, lastMessageAt: null })
    expect(row.title).toBeNull()
    expect(row.messageCount).toBeNull()
    expect(row.lastMessageAt).toBeNull()
    expect(row.isActive).toBe(false)
  })

  it('marks exactly the session that matches the active id as live', () => {
    const rows = buildConversationRows(
      [
        { sessionId: 'ags_a', objective: 'a' },
        { sessionId: 'ags_b', objective: 'b' },
      ],
      'ags_b',
    )
    expect(rows.map((row) => row.isActive)).toEqual([false, true])
  })
})
