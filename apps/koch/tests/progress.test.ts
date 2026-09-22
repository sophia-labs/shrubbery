import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, KOCH_SEQUENCE, generatePrompt, scoreCopy } from '../src/koch.js'
import { scoreKeying, type KeyingTrace } from '../src/keying.js'
import {
  attemptSelectQuery,
  graphPerformanceSelectQuery,
  legacyAttemptSelectQuery,
  legacyLearnerSelectQuery,
  legacySessionSelectQuery,
  preferencesMoRecord,
  progressGraphIri,
  progressSelectQuery,
  projectionLearnerSelectQuery,
  prototypeSessionSelectQuery,
  sessionMoRecords,
} from '../src/progress.js'
import {
  courseIri,
  informationModelRecords,
  kochProjectionGraphIri,
  learnerIri,
  legacyProgressGraphIri,
  userRdfGraphIri,
} from '../src/vocabulary.js'

describe('Garden-native Koch Meaningful Objects', () => {
  it('expresses a receive run as one session MO plus positional attempt MOs', () => {
    const prompt = generatePrompt(2, { ...DEFAULT_SETTINGS, characterCount: 5 }, () => 0)
    const score = scoreCopy(prompt.plain, prompt.plain)
    const { records, record } = sessionMoRecords('koch-test', {
      prompt,
      score,
      settings: { ...DEFAULT_SETTINGS, characterCount: 5 },
      id: 'session-1',
      completedAt: '2026-07-20T12:00:00.000Z',
      actor: { id: 'user-1', displayName: 'Vera' },
    })

    expect(record).toMatchObject({ activity: 'receive', accuracy: 1 })
    expect(progressGraphIri('koch-test')).toBe(kochProjectionGraphIri('koch-test'))
    expect(records).toHaveLength(6)
    expect(records[0]).toMatchObject({
      kind: 'PracticeSession',
      activity: 'receive',
      wasAssociatedWith: learnerIri('koch-test', 'user-1'),
      hasAttempt: expect.arrayContaining([
        `${kochProjectionGraphIri('koch-test')}:copy-attempt:session-1-1`,
      ]),
    })
    expect(records.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CopyAttempt', position: 1, isCorrect: true }),
    ]))
    expect(JSON.stringify(records)).not.toContain(':user:rdf')
  })

  it('reads current testimony only from Emporium’s Koch projection', () => {
    const query = progressSelectQuery('koch-test', 'user-1')
    expect(query).toContain(kochProjectionGraphIri('koch-test'))
    expect(query).toContain('ORDER BY DESC(?completedAt)')
    expect(query).not.toContain('LIMIT')
    expect(query).toContain(learnerIri('koch-test', 'user-1'))
    expect(attemptSelectQuery('koch-test', 'user-1')).toContain('?characterResource rdfs:label ?character')
    expect(projectionLearnerSelectQuery('koch-test')).toContain(kochProjectionGraphIri('koch-test'))
  })

  it('publishes one Course, the cumulative Lesson/Character set, and a Learner through Emporium', () => {
    const records = informationModelRecords('koch-test', { id: 'user-1', displayName: 'Vera' })
    expect(records).toHaveLength(2 + (KOCH_SEQUENCE.length * 2))
    expect(records[0]).toMatchObject({
      kind: 'KochCourse',
      localId: 'standard',
      hasLesson: expect.arrayContaining([
        `${kochProjectionGraphIri('koch-test')}:lesson:lesson-1`,
      ]),
    })
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'MorseCharacter', label: 'M', morseCode: '--' }),
      expect.objectContaining({ kind: 'Lesson', label: 'Koch lesson 2' }),
      expect.objectContaining({
        kind: 'Learner',
        label: 'Vera',
        studiesCourse: courseIri('koch-test'),
      }),
    ]))
  })

  it('keeps both old direct-RDF stores as read-only migration sources', () => {
    expect(legacyLearnerSelectQuery('koch-test')).toContain(userRdfGraphIri('koch-test'))
    expect(legacySessionSelectQuery('koch-test')).toContain(userRdfGraphIri('koch-test'))
    expect(legacyAttemptSelectQuery('koch-test')).toContain(userRdfGraphIri('koch-test'))
    expect(prototypeSessionSelectQuery('koch-test')).toContain(legacyProgressGraphIri('koch-test'))
    for (const query of [
      legacyLearnerSelectQuery('koch-test'),
      legacySessionSelectQuery('koch-test'),
      legacyAttemptSelectQuery('koch-test'),
      prototypeSessionSelectQuery('koch-test'),
    ]) {
      expect(query).toMatch(/^PREFIX/)
      expect(query).not.toMatch(/\b(?:INSERT|DELETE)\b/)
    }
  })

  it('expresses receiver preferences as a complete Learner MO upsert', () => {
    expect(preferencesMoRecord('koch-test', {
      settings: { ...DEFAULT_SETTINGS, characterCount: 50, toneHz: 700 },
      showNotation: true,
    }, { id: 'user-1', displayName: 'Vera' })).toMatchObject({
      kind: 'Learner',
      localId: 'user-1',
      learnerId: 'user-1',
      label: 'Vera',
      preferredRunLength: 50,
      toneHz: 700,
      showNotation: true,
    })
  })

  it('records re-scorable straight-key evidence and separate timing measures', () => {
    const trace: KeyingTrace = {
      schemaVersion: 1,
      targetDitMs: 60,
      transitions: [
        { kind: 'down', atMs: 0 }, { kind: 'up', atMs: 180 },
        { kind: 'down', atMs: 240 }, { kind: 'up', atMs: 300 },
        { kind: 'down', atMs: 360 }, { kind: 'up', atMs: 540 },
      ],
      characters: [{
        pattern: '-.-', decoded: 'K', startedAtMs: 0, endedAtMs: 540, gapBeforeMs: null,
        elements: [
          { symbol: '-', durationMs: 180, gapBeforeMs: null },
          { symbol: '.', durationMs: 60, gapBeforeMs: 60 },
          { symbol: '-', durationMs: 180, gapBeforeMs: 60 },
        ],
      }],
    }
    const score = scoreKeying('K', trace)
    const prompt = { lesson: 2, characters: ['K', 'M'] as const, plain: 'K', grouped: 'K' }
    const { records, record } = sessionMoRecords('koch-test', {
      prompt,
      score,
      settings: DEFAULT_SETTINGS,
      actor: { id: 'sender', displayName: 'Sender' },
      id: 'send-1',
    })
    expect(record).toMatchObject({ activity: 'send', accuracy: 1, timingScore: 1 })
    expect(records[0]).toMatchObject({
      kind: 'PracticeSession',
      activity: 'send',
      timingScore: 1,
      keyingTrace: expect.stringContaining('schemaVersion'),
    })
    expect(records[1]).toMatchObject({
      kind: 'KeyingAttempt',
      expectedPattern: '-.-',
      enteredPattern: '-.-',
    })
  })

  it('queries every Learner MO’s graph-contained performance without a nested room', () => {
    const query = graphPerformanceSelectQuery('koch-test')
    expect(query).toContain(kochProjectionGraphIri('koch-test'))
    expect(query).toContain('?learner a koch:Learner')
    expect(query).toContain('AVG(?performance)')
    expect(query).toContain('MAX(?performance)')
    expect(query).toContain('prov:wasAssociatedWith ?learner')
    expect(query).not.toContain('koch:room')
  })

  it('rejects graph ids outside Garden local graph grammar', () => {
    expect(() => progressGraphIri('garden one')).toThrow(/canonical grammar/)
  })
})
