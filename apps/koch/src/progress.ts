import type { SelectResult, SourceTerm, TripleSource } from '@shrubbery/nucleus'
import {
  DEFAULT_SETTINGS,
  KOCH_SEQUENCE,
  clampLesson,
  nextLesson,
  type CopyScore,
  type PracticePrompt,
  type PracticeSettings,
} from './koch.js'
import type { KochActor } from './actor.js'
import type { KeyingScore } from './keying.js'
import {
  KOCH,
  KOCH_NS,
  KOCH_VOCAB,
  attemptLocalId,
  characterIri,
  copyAttemptIri,
  graphRootIri,
  informationModelRecords,
  keyingAttemptIri,
  learnerIri,
  learnerRecord,
  legacyProgressGraphIri,
  lessonIri,
  kochProjectionGraphIri,
  sessionIri,
  sessionLocalId,
  userRdfGraphIri,
  type KochLearnerState,
  type KochMoRecord,
} from './vocabulary.js'

const LEGACY_KOCH_NS = 'https://sophia-labs.com/ns/koch#'

export interface KochMutationClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

export interface SessionRecord {
  readonly id: string
  readonly activity: PracticeActivity
  readonly lesson: number
  readonly accuracy: number
  readonly correct: number
  readonly total: number
  readonly completedAt: string
  readonly performanceScore: number
  readonly timingScore: number | null
}

export type PracticeActivity = 'receive' | 'send'
export type PracticeScore = CopyScore | KeyingScore

export interface CharacterProgress {
  readonly character: string
  readonly seen: number
  readonly correct: number
  readonly accuracy: number
}

export interface ProgressTestimony {
  readonly graphIri: string
  readonly readAt: number
  readonly tripleCount: number
  readonly adapter: string
}

export interface ProgressSnapshot {
  readonly currentLesson: number
  readonly sessions: readonly SessionRecord[]
  readonly totalCopied: number
  readonly totalCorrect: number
  readonly overallAccuracy: number
  readonly bestAccuracy: number
  readonly characterStats: readonly CharacterProgress[]
  readonly sendSessions: number
  readonly bestSendAccuracy: number
  readonly bestTimingScore: number
  readonly testimony: ProgressTestimony | null
}

export const EMPTY_PROGRESS: ProgressSnapshot = Object.freeze({
  currentLesson: 2,
  sessions: [],
  totalCopied: 0,
  totalCorrect: 0,
  overallAccuracy: 0,
  bestAccuracy: 0,
  characterStats: [],
  sendSessions: 0,
  bestSendAccuracy: 0,
  bestTimingScore: 0,
  testimony: null,
})

export interface SaveSessionInput {
  readonly prompt: PracticePrompt
  readonly score: PracticeScore
  readonly settings: PracticeSettings
  readonly actor?: KochActor
  readonly id?: string
  readonly completedAt?: string
}

export interface ActivityStanding {
  readonly learnerId: string
  readonly displayName: string
  readonly activity: PracticeActivity
  readonly runs: number
  readonly averageScore: number
  readonly bestScore: number
  readonly highestLesson: number
  readonly correct: number
  readonly total: number
  readonly bestTimingScore: number | null
  readonly lastCompletedAt: string
}

export interface ParticipantPerformance {
  readonly learnerId: string
  readonly displayName: string
  readonly receive: ActivityStanding | null
  readonly send: ActivityStanding | null
}

export interface GraphPerformanceSnapshot {
  /** The Garden graph is the collaboration room and aggregation boundary. */
  readonly graphId: string
  /** One row for every koch:Learner in the graph, including learners with no filed run. */
  readonly participants: readonly ParticipantPerformance[]
  /** Ranked activity projections used for Receive/Send standings. */
  readonly standings: readonly ActivityStanding[]
  readonly readAt: number
}

export interface LearnerPreferences {
  readonly settings: PracticeSettings
  readonly showNotation: boolean
}

export const DEFAULT_PREFERENCES: LearnerPreferences = Object.freeze({
  settings: DEFAULT_SETTINGS,
  showNotation: false,
})

/** Back-compatible name; progress now belongs to Emporium's Koch projection. */
export function progressGraphIri(graphId: string): string {
  return kochProjectionGraphIri(graphId)
}

function requireSelect(source: TripleSource): NonNullable<TripleSource['select']> {
  if (!source.select || !source.description.sparql) {
    throw new Error(`The ${source.description.kind} source cannot run the Koch SELECT queries.`)
  }
  return source.select.bind(source)
}

function termValue(row: Readonly<Record<string, SourceTerm>>, name: string): string | undefined {
  return row[name]?.value
}

function numberValue(row: Readonly<Record<string, SourceTerm>>, name: string): number {
  const value = Number(termValue(row, name) ?? 0)
  return Number.isFinite(value) ? value : 0
}

function booleanValue(row: Readonly<Record<string, SourceTerm>>, name: string): boolean {
  const value = termValue(row, name)
  return value === 'true' || value === '1'
}

export function sessionMoRecords(graphId: string, input: SaveSessionInput): {
  readonly records: readonly KochMoRecord[]
  readonly record: SessionRecord
} {
  const id = input.id ?? crypto.randomUUID()
  const completedAt = input.completedAt ?? new Date().toISOString()
  const actor = input.actor ?? { id: 'local', displayName: 'Local learner' }
  const learner = learnerIri(graphId, actor.id)
  const session = sessionIri(graphId, id)
  const score = input.score
  const lesson = clampLesson(input.prompt.lesson)
  const lessonResource = lessonIri(graphId, lesson)
  const record: SessionRecord = {
    id: session,
    activity: score.activity,
    lesson,
    accuracy: score.accuracy,
    correct: score.correct,
    total: score.total,
    completedAt,
    performanceScore: score.performanceScore,
    timingScore: score.activity === 'send' ? score.timingScore : null,
  }
  const attemptIris = score.attempts.map((attempt) => score.activity === 'send'
    ? keyingAttemptIri(graphId, id, attempt.position)
    : copyAttemptIri(graphId, id, attempt.position))
  const sessionRecord: KochMoRecord = {
    kind: 'PracticeSession',
    localId: sessionLocalId(id),
    label: `Koch ${score.activity} lesson ${lesson} · ${score.correct}/${score.total}`,
    activity: score.activity,
    performanceScore: score.performanceScore,
    lesson: lessonResource,
    lessonNumber: lesson,
    accuracy: score.accuracy,
    correctCount: score.correct,
    characterCount: score.total,
    expectedCopy: score.expected,
    submittedCopy: score.entered,
    characterWpm: input.settings.characterWpm,
    effectiveWpm: input.settings.effectiveWpm,
    toneHz: input.settings.toneHz,
    hasAttempt: attemptIris,
    used: lessonResource,
    wasAssociatedWith: learner,
    endedAtTime: completedAt,
    ...(score.activity === 'send'
      ? {
          timingScore: score.timingScore,
          durationScore: score.durationScore,
          spacingScore: score.spacingScore,
          consistencyScore: score.consistencyScore,
          keyingTrace: JSON.stringify(score.trace),
        }
      : {}),
  }
  const attempts: KochMoRecord[] = score.activity === 'send'
    ? score.attempts.map((attempt) => ({
        kind: 'KeyingAttempt',
        localId: attemptLocalId(id, attempt.position),
        inSession: session,
        position: attempt.position + 1,
        expectedCharacter: characterIri(graphId, attempt.expected),
        enteredCharacter: attempt.entered,
        isCorrect: attempt.correct,
        expectedPattern: attempt.expectedPattern,
        enteredPattern: attempt.enteredPattern,
      }))
    : score.attempts.map((attempt) => ({
        kind: 'CopyAttempt',
        localId: attemptLocalId(id, attempt.position),
        inSession: session,
        position: attempt.position + 1,
        expectedCharacter: characterIri(graphId, attempt.expected),
        enteredCharacter: attempt.entered,
        isCorrect: attempt.correct,
      }))
  return { record, records: [sessionRecord, ...attempts] }
}

async function writeKochMos(
  client: KochMutationClient,
  graphId: string,
  records: readonly KochMoRecord[],
): Promise<void> {
  if (records.length === 0) return
  const response = await client.callTool('emporium_write', {
    graphId,
    vocab: KOCH_VOCAB,
    records,
  })
  if (!response || typeof response !== 'object' || (response as { ok?: unknown }).ok !== true) {
    throw new Error(`Emporium did not accept the Koch Meaningful Objects: ${JSON.stringify(response)}`)
  }
}

export async function saveSession(
  client: KochMutationClient,
  graphId: string,
  input: SaveSessionInput,
): Promise<SessionRecord> {
  const { records, record } = sessionMoRecords(graphId, input)
  await writeKochMos(client, graphId, records)
  return record
}

function decodeToken(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function legacyActor(graphId: string, subject: string, displayName: string): KochActor {
  const prefix = `${graphRootIri(graphId)}:koch:learner:`
  const id = subject.startsWith(prefix) ? decodeToken(subject.slice(prefix.length)) : subject
  return { id: id || 'local', displayName: displayName || 'Local learner' }
}

function migratedSessionId(graphId: string, subject: string): string {
  const prefix = `${graphRootIri(graphId)}:koch:session:`
  return subject.startsWith(prefix)
    ? decodeToken(subject.slice(prefix.length))
    : `legacy-${subject}`
}

function learnerStateFrom(row: Readonly<Record<string, SourceTerm>>): KochLearnerState {
  return {
    characterWpm: numberValue(row, 'characterWpm') || DEFAULT_SETTINGS.characterWpm,
    effectiveWpm: numberValue(row, 'effectiveWpm') || DEFAULT_SETTINGS.effectiveWpm,
    toneHz: numberValue(row, 'toneHz') || DEFAULT_SETTINGS.toneHz,
    preferredRunLength: numberValue(row, 'runLength') || DEFAULT_SETTINGS.characterCount,
    showNotation: booleanValue(row, 'showNotation'),
  }
}

export function legacyLearnerSelectQuery(graphId: string): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?learner ?name ?characterWpm ?effectiveWpm ?toneHz ?runLength ?showNotation WHERE {
  GRAPH <${userRdfGraphIri(graphId)}> {
    ?learner a koch:Learner .
    OPTIONAL { ?learner rdfs:label ?name . }
    OPTIONAL { ?learner koch:characterWpm ?characterWpm . }
    OPTIONAL { ?learner koch:effectiveWpm ?effectiveWpm . }
    OPTIONAL { ?learner koch:toneHz ?toneHz . }
    OPTIONAL { ?learner koch:preferredRunLength ?runLength . }
    OPTIONAL { ?learner koch:showNotation ?showNotation . }
  }
}`
}

export function legacySessionSelectQuery(graphId: string): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?session ?label ?activity ?lesson ?accuracy ?correct ?total ?target ?copy
  ?characterWpm ?effectiveWpm ?toneHz ?performance ?timing ?duration ?spacing
  ?consistency ?trace ?learner ?completedAt WHERE {
  GRAPH <${userRdfGraphIri(graphId)}> {
    ?session a koch:PracticeSession ;
      koch:lessonNumber ?lesson ; koch:accuracy ?accuracy ;
      koch:correctCount ?correct ; koch:characterCount ?total ;
      koch:expectedCopy ?target ; koch:submittedCopy ?copy ;
      koch:characterWpm ?characterWpm ; koch:effectiveWpm ?effectiveWpm ;
      prov:wasAssociatedWith ?learner ; prov:endedAtTime ?completedAt .
    OPTIONAL { ?session rdfs:label ?label . }
    OPTIONAL { ?session koch:activity ?activity . }
    OPTIONAL { ?session koch:toneHz ?toneHz . }
    OPTIONAL { ?session koch:performanceScore ?performance . }
    OPTIONAL { ?session koch:timingScore ?timing . }
    OPTIONAL { ?session koch:durationScore ?duration . }
    OPTIONAL { ?session koch:spacingScore ?spacing . }
    OPTIONAL { ?session koch:consistencyScore ?consistency . }
    OPTIONAL { ?session koch:keyingTrace ?trace . }
  }
}`
}

export function legacyAttemptSelectQuery(graphId: string): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?session ?attempt ?attemptType ?position ?expected ?entered ?correct ?expectedPattern ?enteredPattern WHERE {
  GRAPH <${userRdfGraphIri(graphId)}> {
    ?session koch:hasAttempt ?attempt .
    ?attempt a ?attemptType ; koch:position ?position ;
      koch:expectedCharacter ?characterResource ;
      koch:enteredCharacter ?entered ; koch:isCorrect ?correct .
    ?characterResource rdfs:label ?expected .
    OPTIONAL { ?attempt koch:expectedPattern ?expectedPattern . }
    OPTIONAL { ?attempt koch:enteredPattern ?enteredPattern . }
    FILTER(?attemptType IN (koch:CopyAttempt, koch:KeyingAttempt))
  }
}`
}

export function prototypeSessionSelectQuery(graphId: string): string {
  return `PREFIX old: <${LEGACY_KOCH_NS}>
SELECT ?session ?lesson ?accuracy ?correct ?total ?target ?copy ?characterWpm ?effectiveWpm
  ?completedAt ?attempt ?position ?expected ?entered ?attemptCorrect WHERE {
  GRAPH <${legacyProgressGraphIri(graphId)}> {
    ?session a old:PracticeSession ; old:lesson ?lesson ; old:accuracy ?accuracy ;
      old:correct ?correct ; old:total ?total ; old:target ?target ; old:copy ?copy ;
      old:characterWpm ?characterWpm ; old:effectiveWpm ?effectiveWpm ;
      old:completedAt ?completedAt .
    OPTIONAL {
      ?session old:hasAttempt ?attempt .
      ?attempt old:position ?position ; old:expected ?expected ;
        old:entered ?entered ; old:isCorrect ?attemptCorrect .
    }
  }
}`
}

export function projectionLearnerSelectQuery(graphId: string): string {
  return `PREFIX koch: <${KOCH_NS}>
SELECT ?learner WHERE {
  GRAPH <${kochProjectionGraphIri(graphId)}> {
    ?learner a koch:Learner .
  }
}`
}

/** Read old direct-RDF testimony and express it as idempotent Emporium records. */
export async function legacyInformationModelRecords(
  source: TripleSource,
  graphId: string,
  fallbackActor: KochActor = { id: 'local', displayName: 'Local learner' },
): Promise<readonly KochMoRecord[]> {
  const select = requireSelect(source)
  const [learners, sessions, attempts, prototype, projectedLearners] = await Promise.all([
    select(legacyLearnerSelectQuery(graphId)),
    select(legacySessionSelectQuery(graphId)),
    select(legacyAttemptSelectQuery(graphId)),
    select(prototypeSessionSelectQuery(graphId)),
    select(projectionLearnerSelectQuery(graphId)),
  ])
  const records: KochMoRecord[] = []
  const existingLearners = new Set(
    projectedLearners.rows.flatMap((row) => {
      const learner = termValue(row, 'learner')
      return learner ? [learner] : []
    }),
  )
  const learnerSubjects = new Map<string, string>()
  for (const row of learners.rows) {
    const oldSubject = termValue(row, 'learner') ?? ''
    if (!oldSubject) continue
    const actor = legacyActor(graphId, oldSubject, termValue(row, 'name') ?? '')
    const projectedSubject = learnerIri(graphId, actor.id)
    if (!existingLearners.has(projectedSubject)) {
      records.push(learnerRecord(graphId, actor, learnerStateFrom(row)))
    }
    learnerSubjects.set(oldSubject, projectedSubject)
  }

  const attemptRecords = new Map<string, KochMoRecord[]>()
  const attemptIris = new Map<string, string[]>()
  for (const row of attempts.rows) {
    const oldSession = termValue(row, 'session') ?? ''
    const expected = termValue(row, 'expected') ?? ''
    if (!oldSession || !expected) continue
    const id = migratedSessionId(graphId, oldSession)
    const position = Math.max(0, numberValue(row, 'position') - 1)
    const keying = termValue(row, 'attemptType') === KOCH.KeyingAttempt
    const iri = keying
      ? keyingAttemptIri(graphId, id, position)
      : copyAttemptIri(graphId, id, position)
    const migrated: KochMoRecord = {
      kind: keying ? 'KeyingAttempt' : 'CopyAttempt',
      localId: attemptLocalId(id, position),
      inSession: sessionIri(graphId, id),
      position: position + 1,
      expectedCharacter: characterIri(graphId, expected),
      enteredCharacter: termValue(row, 'entered') ?? '',
      isCorrect: booleanValue(row, 'correct'),
      ...(keying
        ? {
            expectedPattern: termValue(row, 'expectedPattern') ?? '',
            enteredPattern: termValue(row, 'enteredPattern') ?? '',
          }
        : {}),
    }
    attemptRecords.set(oldSession, [...(attemptRecords.get(oldSession) ?? []), migrated])
    attemptIris.set(oldSession, [...(attemptIris.get(oldSession) ?? []), iri])
  }

  for (const row of sessions.rows) {
    const oldSession = termValue(row, 'session') ?? ''
    if (!oldSession) continue
    const id = migratedSessionId(graphId, oldSession)
    const lesson = clampLesson(numberValue(row, 'lesson'))
    const accuracy = numberValue(row, 'accuracy')
    const activity = termValue(row, 'activity') === KOCH.Sending ? 'send' : 'receive'
    const oldLearner = termValue(row, 'learner') ?? ''
    const associated = learnerSubjects.get(oldLearner) ?? learnerIri(graphId, fallbackActor.id)
    const correct = numberValue(row, 'correct')
    const total = numberValue(row, 'total')
    records.push({
      kind: 'PracticeSession',
      localId: sessionLocalId(id),
      label: termValue(row, 'label') ?? `Koch ${activity} lesson ${lesson} · ${correct}/${total}`,
      activity,
      lesson: lessonIri(graphId, lesson),
      lessonNumber: lesson,
      accuracy,
      correctCount: correct,
      characterCount: total,
      expectedCopy: termValue(row, 'target') ?? '',
      submittedCopy: termValue(row, 'copy') ?? '',
      characterWpm: numberValue(row, 'characterWpm') || DEFAULT_SETTINGS.characterWpm,
      effectiveWpm: numberValue(row, 'effectiveWpm') || DEFAULT_SETTINGS.effectiveWpm,
      toneHz: numberValue(row, 'toneHz') || DEFAULT_SETTINGS.toneHz,
      performanceScore: termValue(row, 'performance') === undefined ? accuracy : numberValue(row, 'performance'),
      ...(termValue(row, 'timing') === undefined ? {} : { timingScore: numberValue(row, 'timing') }),
      ...(termValue(row, 'duration') === undefined ? {} : { durationScore: numberValue(row, 'duration') }),
      ...(termValue(row, 'spacing') === undefined ? {} : { spacingScore: numberValue(row, 'spacing') }),
      ...(termValue(row, 'consistency') === undefined ? {} : { consistencyScore: numberValue(row, 'consistency') }),
      ...(termValue(row, 'trace') === undefined ? {} : { keyingTrace: termValue(row, 'trace') }),
      ...(attemptIris.get(oldSession)?.length ? { hasAttempt: attemptIris.get(oldSession) } : {}),
      used: lessonIri(graphId, lesson),
      wasAssociatedWith: associated,
      endedAtTime: termValue(row, 'completedAt') ?? new Date(0).toISOString(),
      legacySubject: oldSession,
    })
    records.push(...(attemptRecords.get(oldSession) ?? []))
  }

  const prototypeGroups = new Map<string, Readonly<Record<string, SourceTerm>>[]>()
  for (const row of prototype.rows) {
    const subject = termValue(row, 'session') ?? ''
    if (subject) prototypeGroups.set(subject, [...(prototypeGroups.get(subject) ?? []), row])
  }
  for (const [oldSession, rows] of prototypeGroups) {
    const first = rows[0]!
    const id = migratedSessionId(graphId, oldSession)
    const lesson = clampLesson(numberValue(first, 'lesson'))
    const migratedAttempts = rows.flatMap((row): KochMoRecord[] => {
      if (!termValue(row, 'attempt')) return []
      const position = Math.max(0, numberValue(row, 'position') - 1)
      return [{
        kind: 'CopyAttempt',
        localId: attemptLocalId(id, position),
        inSession: sessionIri(graphId, id),
        position: position + 1,
        expectedCharacter: characterIri(graphId, termValue(row, 'expected') ?? ''),
        enteredCharacter: termValue(row, 'entered') ?? '',
        isCorrect: booleanValue(row, 'attemptCorrect'),
      }]
    })
    const accuracy = numberValue(first, 'accuracy')
    const correct = numberValue(first, 'correct')
    const total = numberValue(first, 'total')
    records.push({
      kind: 'PracticeSession',
      localId: sessionLocalId(id),
      label: `Koch receive lesson ${lesson} · ${correct}/${total}`,
      activity: 'receive',
      lesson: lessonIri(graphId, lesson),
      lessonNumber: lesson,
      accuracy,
      correctCount: correct,
      characterCount: total,
      expectedCopy: termValue(first, 'target') ?? '',
      submittedCopy: termValue(first, 'copy') ?? '',
      characterWpm: numberValue(first, 'characterWpm') || DEFAULT_SETTINGS.characterWpm,
      effectiveWpm: numberValue(first, 'effectiveWpm') || DEFAULT_SETTINGS.effectiveWpm,
      toneHz: DEFAULT_SETTINGS.toneHz,
      performanceScore: accuracy,
      ...(migratedAttempts.length
        ? { hasAttempt: migratedAttempts.map((attempt) => copyAttemptIri(graphId, id, Number(attempt.position) - 1)) }
        : {}),
      used: lessonIri(graphId, lesson),
      wasAssociatedWith: learnerIri(graphId, fallbackActor.id),
      endedAtTime: termValue(first, 'completedAt') ?? new Date(0).toISOString(),
      legacySubject: oldSession,
    }, ...migratedAttempts)
  }

  const unique = new Map(records.map((record) => [`${record.kind}:${record.localId}`, record]))
  return [...unique.values()]
}

export async function ensureKochInformationModel(
  client: KochMutationClient,
  source: TripleSource,
  graphId: string,
  actor: KochActor = { id: 'local', displayName: 'Local learner' },
): Promise<void> {
  await writeKochMos(client, graphId, await legacyInformationModelRecords(source, graphId, actor))
  const preferences = await loadPreferences(source, graphId, actor.id)
  await writeKochMos(client, graphId, informationModelRecords(graphId, actor, {
    characterWpm: preferences.settings.characterWpm,
    effectiveWpm: preferences.settings.effectiveWpm,
    toneHz: preferences.settings.toneHz,
    preferredRunLength: preferences.settings.characterCount,
    showNotation: preferences.showNotation,
  }))
}

export function progressSelectQuery(graphId: string, actorId = 'local'): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT ?session ?lesson ?accuracy ?correct ?total ?completedAt ?activity ?performance ?timing WHERE {
  GRAPH <${kochProjectionGraphIri(graphId)}> {
    ?session a koch:PracticeSession ;
      koch:lessonNumber ?lesson ;
      koch:accuracy ?accuracy ;
      koch:correctCount ?correct ;
      koch:characterCount ?total ;
      prov:wasAssociatedWith <${learnerIri(graphId, actorId)}> ;
      prov:endedAtTime ?completedAt .
    OPTIONAL { ?session koch:activity ?activity . }
    OPTIONAL { ?session koch:performanceScore ?performance . }
    OPTIONAL { ?session koch:timingScore ?timing . }
  }
}
ORDER BY DESC(?completedAt)
`
}

export function attemptSelectQuery(graphId: string, actorId = 'local'): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?character ?correct WHERE {
  GRAPH <${kochProjectionGraphIri(graphId)}> {
    ?session a koch:PracticeSession ;
      prov:wasAssociatedWith <${learnerIri(graphId, actorId)}> ;
      koch:hasAttempt ?attempt .
    ?attempt a koch:CopyAttempt ;
      koch:expectedCharacter ?characterResource ;
      koch:isCorrect ?correct .
    ?characterResource rdfs:label ?character .
  }
}
`
}

function sessionsFrom(result: SelectResult): SessionRecord[] {
  return result.rows.map((row): SessionRecord => {
    const activity = termValue(row, 'activity') === 'send' ? 'send' : 'receive'
    const accuracy = numberValue(row, 'accuracy')
    const timing = termValue(row, 'timing')
    return {
      id: termValue(row, 'session') ?? '',
      activity,
      lesson: clampLesson(numberValue(row, 'lesson')),
      accuracy,
      correct: numberValue(row, 'correct'),
      total: numberValue(row, 'total'),
      completedAt: termValue(row, 'completedAt') ?? '',
      performanceScore: termValue(row, 'performance') === undefined ? accuracy : numberValue(row, 'performance'),
      timingScore: timing === undefined ? null : numberValue(row, 'timing'),
    }
  })
}

export async function loadProgress(
  source: TripleSource,
  graphId: string,
  actorId = 'local',
): Promise<ProgressSnapshot> {
  const select = requireSelect(source)
  const graphIri = kochProjectionGraphIri(graphId)
  const [sessionResult, attemptResult, graphRead] = await Promise.all([
    select(progressSelectQuery(graphId, actorId)),
    select(attemptSelectQuery(graphId, actorId)),
    source.read(graphIri),
  ])
  const testimony: ProgressTestimony = {
    graphIri,
    readAt: Math.max(sessionResult.readAt, attemptResult.readAt, graphRead.readAt),
    tripleCount: graphRead.tripleCount,
    adapter: source.description.kind,
  }
  const sessions = sessionsFrom(sessionResult)
  const receiveSessions = sessions.filter((session) => session.activity === 'receive')
  const sendSessions = sessions.filter((session) => session.activity === 'send')

  const characterCounts = new Map<string, { seen: number; correct: number }>()
  for (const row of attemptResult.rows) {
    const character = termValue(row, 'character')
    if (!character) continue
    const counts = characterCounts.get(character) ?? { seen: 0, correct: 0 }
    counts.seen += 1
    if (booleanValue(row, 'correct')) counts.correct += 1
    characterCounts.set(character, counts)
  }
  const characterStats = [...characterCounts.entries()]
    .map(([character, counts]): CharacterProgress => ({
      character,
      seen: counts.seen,
      correct: counts.correct,
      accuracy: counts.seen === 0 ? 0 : counts.correct / counts.seen,
    }))
    .sort((left, right) => left.accuracy - right.accuracy || right.seen - left.seen || left.character.localeCompare(right.character))

  const totalCopied = receiveSessions.reduce((sum, session) => sum + session.total, 0)
  const totalCorrect = receiveSessions.reduce((sum, session) => sum + session.correct, 0)
  const currentLesson = Math.max(
    2,
    ...receiveSessions.map((session) => nextLesson(session.lesson, session.accuracy)),
  )
  return {
    currentLesson: Math.min(KOCH_SEQUENCE.length, currentLesson),
    sessions,
    totalCopied,
    totalCorrect,
    overallAccuracy: totalCopied === 0 ? 0 : totalCorrect / totalCopied,
    bestAccuracy: receiveSessions.length === 0 ? 0 : Math.max(...receiveSessions.map((session) => session.accuracy)),
    characterStats,
    sendSessions: sendSessions.length,
    bestSendAccuracy: sendSessions.length === 0 ? 0 : Math.max(...sendSessions.map((session) => session.accuracy)),
    bestTimingScore: sendSessions.length === 0 ? 0 : Math.max(...sendSessions.map((session) => session.timingScore ?? 0)),
    testimony,
  }
}

export function graphPerformanceSelectQuery(graphId: string): string {
  return `PREFIX koch: <${KOCH_NS}>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?learner ?name ?activity
  (COUNT(?session) AS ?runs)
  (AVG(?performance) AS ?average)
  (MAX(?performance) AS ?best)
  (MAX(?lesson) AS ?highestLesson)
  (SUM(?correct) AS ?correctTotal)
  (SUM(?total) AS ?characterTotal)
  (MAX(?timing) AS ?bestTiming)
  (MAX(?completedAt) AS ?last)
WHERE {
  GRAPH <${kochProjectionGraphIri(graphId)}> {
    ?learner a koch:Learner .
    OPTIONAL { ?learner rdfs:label ?name . }
    OPTIONAL {
      ?session a koch:PracticeSession ;
        koch:activity ?activity ;
        koch:performanceScore ?performance ;
        koch:lessonNumber ?lesson ;
        koch:correctCount ?correct ;
        koch:characterCount ?total ;
        prov:wasAssociatedWith ?learner ;
        prov:endedAtTime ?completedAt .
      OPTIONAL { ?session koch:timingScore ?timing . }
    }
  }
}
GROUP BY ?learner ?name ?activity
ORDER BY DESC(?best) DESC(?average) DESC(?runs)`
}

export async function loadGraphPerformance(
  source: TripleSource,
  graphId: string,
): Promise<GraphPerformanceSnapshot> {
  const result = await requireSelect(source)(graphPerformanceSelectQuery(graphId))
  const participants = new Map<string, ParticipantPerformance>()
  const standings: ActivityStanding[] = []
  for (const row of result.rows) {
    const learnerId = termValue(row, 'learner') ?? ''
    if (!learnerId) continue
    const displayName = termValue(row, 'name') ?? learnerId.split(':').at(-1) ?? 'Learner'
    const current = participants.get(learnerId) ?? {
      learnerId,
      displayName,
      receive: null,
      send: null,
    }
    const activityValue = termValue(row, 'activity')
    const activity: PracticeActivity | null = activityValue === 'send' || activityValue === 'receive'
      ? activityValue
      : null
    const runs = numberValue(row, 'runs')
    if (!activity || runs === 0) {
      participants.set(learnerId, current)
      continue
    }
    const standing: ActivityStanding = {
      learnerId,
      displayName,
      activity,
      runs: numberValue(row, 'runs'),
      averageScore: numberValue(row, 'average'),
      bestScore: numberValue(row, 'best'),
      highestLesson: numberValue(row, 'highestLesson'),
      correct: numberValue(row, 'correctTotal'),
      total: numberValue(row, 'characterTotal'),
      bestTimingScore: termValue(row, 'bestTiming') === undefined ? null : numberValue(row, 'bestTiming'),
      lastCompletedAt: termValue(row, 'last') ?? '',
    }
    standings.push(standing)
    participants.set(learnerId, { ...current, [activity]: standing })
  }
  const participantRows = [...participants.values()].sort((left, right) => {
    const leftBest = Math.max(left.receive?.bestScore ?? -1, left.send?.bestScore ?? -1)
    const rightBest = Math.max(right.receive?.bestScore ?? -1, right.send?.bestScore ?? -1)
    return rightBest - leftBest || left.displayName.localeCompare(right.displayName)
  })
  return { graphId, participants: participantRows, standings, readAt: result.readAt }
}

export function preferencesSelectQuery(graphId: string, actorId = 'local'): string {
  return `PREFIX koch: <${KOCH_NS}>
SELECT ?characterWpm ?effectiveWpm ?toneHz ?runLength ?showNotation WHERE {
  GRAPH <${kochProjectionGraphIri(graphId)}> {
    <${learnerIri(graphId, actorId)}> koch:characterWpm ?characterWpm ;
      koch:effectiveWpm ?effectiveWpm ;
      koch:toneHz ?toneHz ;
      koch:preferredRunLength ?runLength ;
      koch:showNotation ?showNotation .
  }
}
LIMIT 1`
}

export async function loadPreferences(
  source: TripleSource,
  graphId: string,
  actorId = 'local',
): Promise<LearnerPreferences> {
  const result = await requireSelect(source)(preferencesSelectQuery(graphId, actorId))
  const row = result.rows[0]
  if (!row) return DEFAULT_PREFERENCES
  const characterWpm = Math.min(60, Math.max(5, numberValue(row, 'characterWpm') || DEFAULT_SETTINGS.characterWpm))
  const effectiveWpm = Math.min(
    characterWpm,
    Math.max(3, numberValue(row, 'effectiveWpm') || DEFAULT_SETTINGS.effectiveWpm),
  )
  const toneHz = Math.min(1200, Math.max(250, numberValue(row, 'toneHz') || DEFAULT_SETTINGS.toneHz))
  const characterCount = Math.min(200, Math.max(5, numberValue(row, 'runLength') || DEFAULT_SETTINGS.characterCount))
  return {
    settings: { characterWpm, effectiveWpm, toneHz, characterCount, groupSize: DEFAULT_SETTINGS.groupSize },
    showNotation: booleanValue(row, 'showNotation'),
  }
}

export function preferencesMoRecord(
  graphId: string,
  preferences: LearnerPreferences,
  actor: KochActor = { id: 'local', displayName: 'Local learner' },
): KochMoRecord {
  const settings = preferences.settings
  return learnerRecord(graphId, actor, {
    characterWpm: settings.characterWpm,
    effectiveWpm: settings.effectiveWpm,
    toneHz: settings.toneHz,
    preferredRunLength: settings.characterCount,
    showNotation: preferences.showNotation,
  })
}

export async function savePreferences(
  client: KochMutationClient,
  graphId: string,
  preferences: LearnerPreferences,
  actor: KochActor = { id: 'local', displayName: 'Local learner' },
): Promise<void> {
  await writeKochMos(client, graphId, [preferencesMoRecord(graphId, preferences, actor)])
}
