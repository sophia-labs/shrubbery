import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildAgentFloor,
  buildAgentPresence,
  buildRoomSpeech,
  epochMsToIso,
  formatAge,
  formatTimestamp,
  toEpochMs,
  type AgentPresenceModel,
  type Attributed,
  type DisplayKind,
  MODEL_LABELS,
} from '../kinds/index.js'

describe('display kinds — pure kernel vocabulary', () => {
  it('defines the closed display kind discriminator set', () => {
    const kinds: DisplayKind[] = ['identity', 'state', 'metric', 'prose', 'reference', 'testimony', 'affordance']
    expect(kinds).toEqual(['identity', 'state', 'metric', 'prose', 'reference', 'testimony', 'affordance'])
  })

  it('keeps model attribution structurally assignable to the Attributed carrier', () => {
    const model: AgentPresenceModel = { value: 'gpt-5', observedAt: 1783177200000, observer: 'vera' }
    const attributed: Attributed<string> = model
    expect(attributed).toEqual({ value: 'gpt-5', observedAt: 1783177200000, observer: 'vera' })
  })

  it('exports the shared model label catalogue', () => {
    expect(MODEL_LABELS).toMatchObject({
      'deepseek-v4-pro': 'DeepSeek V4 Pro',
      'deepseek-v4-flash': 'DeepSeek V4 Flash',
      'gpt-5': 'GPT-5',
      'claude-sonnet': 'Claude Sonnet',
    })
  })

  it('preserves the Greenhouse floor, presence, and speech builder behavior', () => {
    const events = [
      {
        seq: 1,
        ts: 1783177200000,
        type: 'agent.model.changed',
        payload: { model: 'gpt-5', authorId: 'vera' },
      },
      {
        seq: 2,
        ts: 1783177201000,
        type: 'conversation.turn.queued',
        payload: { turnId: 'turn-1' },
      },
    ]

    expect(
      buildAgentPresence({
        name: 'learner-1',
        lifecycle: 'resident',
        model: 'gpt-5',
        graph: 'sophia-code-lab',
        attribution: { value: 'gpt-5', actorId: 'vera', at: 1783177200000 },
      }).model,
    ).toEqual({ value: 'gpt-5', observedAt: 1783177200000, observer: 'vera' })

    expect(
      buildAgentFloor({
        world: { worldDoc: { control: { driverLease: null, steeringQueue: [] } } },
        clientId: 'greenhouse-v1',
      }).floor,
    ).toEqual({ state: 'open' })

    expect(
      buildRoomSpeech({
        selfAuthorId: 'vera',
        world: {
          worldDoc: {
            conversation: {
              messages: [{ id: 'm1', authorId: 'vera', role: 'user', text: 'hello', createdAt: 1783177200000 }],
            },
          },
        },
        events,
      }),
    ).toEqual({
      messages: [
        {
          id: 'm1',
          author: { id: 'vera', role: 'user', isSelf: true },
          text: 'hello',
          at: 1783177200000,
        },
      ],
      turnActivity: { state: 'queued', since: 1783177201000 },
    })
  })
})

describe('display kinds — the ONE timestamp register + formatter (R4c)', () => {
  const T = 1783177200000 // 2026-07-04T15:00:00.000Z

  it('toEpochMs accepts epoch-ms (number or all-digit string) and zoned ISO-8601', () => {
    expect(toEpochMs(T)).toBe(T)
    expect(toEpochMs(`${T}`)).toBe(T)
    expect(toEpochMs('2026-07-04T15:00:00Z')).toBe(T)
    expect(toEpochMs('2026-07-04T15:00:00.000Z')).toBe(T)
    expect(toEpochMs('2026-07-04T17:00:00+02:00')).toBe(T)
    expect(toEpochMs('2026-07-04')).toBe(Date.parse('2026-07-04T00:00:00Z'))
  })

  it('toEpochMs is honest on garbage — null, never a guess', () => {
    expect(toEpochMs('')).toBeNull()
    expect(toEpochMs('   ')).toBeNull()
    expect(toEpochMs('-')).toBeNull()
    expect(toEpochMs('yesterday')).toBeNull()
    expect(toEpochMs('7/4/2026, 3:00:00 PM')).toBeNull() // a preformatted locale string is garbage, not testimony
    expect(toEpochMs('2026-07-04T15:00:00')).toBeNull() // zone-naive date-time = a timezone guess → rejected
    expect(toEpochMs(Number.NaN)).toBeNull()
    expect(toEpochMs(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('toEpochMs (LOW-1) rejects calendar-invalid dates — never Date.parse\'s silent overflow normalization', () => {
    // Date.parse('2026-02-30') NORMALIZES to 2026-03-02 (verified against
    // this repo's Node) — round-trip validation against the WRITTEN calendar
    // fields must catch this, never hand back March's epoch as if Feb 30 read.
    expect(Date.parse('2026-02-30')).toBe(Date.parse('2026-03-02'))
    expect(toEpochMs('2026-02-30')).toBeNull()
    expect(toEpochMs('2026-02-30T10:00:00Z')).toBeNull()
    // 2026 is not a leap year — Feb 29 is also calendar-invalid.
    expect(toEpochMs('2026-02-29')).toBeNull()
    // A genuine leap year's Feb 29 remains valid.
    expect(toEpochMs('2024-02-29')).toBe(Date.parse('2024-02-29T00:00:00Z'))
    // Sanity: month/day overflow in other forms is caught too.
    expect(toEpochMs('2026-13-01')).toBeNull()
    expect(toEpochMs('2026-04-31')).toBeNull()
  })

  it('epochMsToIso derives the xsd:dateTime wire string', () => {
    expect(epochMsToIso(T)).toBe('2026-07-04T15:00:00.000Z')
  })

  it('formatTimestamp is deterministic UTC — locale-free, face-stable', () => {
    expect(formatTimestamp(T)).toBe('2026-07-04 15:00 UTC')
    // same-UTC-day now → date elided
    expect(formatTimestamp(T, { now: T + 3 * 60 * 60 * 1000 })).toBe('15:00 UTC')
    // different day → full stamp
    expect(formatTimestamp(T, { now: T + 26 * 60 * 60 * 1000 })).toBe('2026-07-04 15:00 UTC')
  })

  it('formatAge yields the capture-age chip strings', () => {
    expect(formatAge(T, T + 10_000)).toBe('just now')
    expect(formatAge(T, T + 3 * 60_000)).toBe('3m ago')
    expect(formatAge(T, T + 5 * 60 * 60_000)).toBe('5h ago')
    expect(formatAge(T, T + 3 * 24 * 60 * 60_000)).toBe('3d ago')
    expect(formatAge(T + 60_000, T)).toBe('in the future')
  })
})

describe('display kinds — purity fence', () => {
  const kindsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../kinds')
  const files = ['index.ts', 'card.ts', 'floor.ts', 'format.ts', 'json.ts', 'logbook.ts', 'presence.ts', 'speech.ts', 'turn-account.ts', 'turnover.ts']

  it('does not import Lit, stores, network, DOM, or package dependencies', () => {
    const forbidden = /\b(from\s+['"](?:lit|@shrubbery\/|node:|https?:|.*(?:store|service|backend|yjs|y\.js))|document|window|fetch|XMLHttpRequest|localStorage)\b/
    for (const file of files) {
      const source = readFileSync(resolve(kindsDir, file), 'utf8')
      expect(source, file).not.toMatch(forbidden)
    }
  })
})
