import { DEFAULT_SETTINGS, KOCH_SEQUENCE, MORSE, type KochCharacter } from './koch.js'
import { actorKey, normalizeActorId, type KochActor } from './actor.js'

export const KOCH_NS = 'http://mnemosyne.dev/koch#'
export const KOCH_VOCAB = 'koch-morse'

export const RDF = Object.freeze({
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  property: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
})

export const RDFS = Object.freeze({
  class: 'http://www.w3.org/2000/01/rdf-schema#Class',
  label: 'http://www.w3.org/2000/01/rdf-schema#label',
  comment: 'http://www.w3.org/2000/01/rdf-schema#comment',
  domain: 'http://www.w3.org/2000/01/rdf-schema#domain',
  range: 'http://www.w3.org/2000/01/rdf-schema#range',
})

export const XSD = Object.freeze({
  boolean: 'http://www.w3.org/2001/XMLSchema#boolean',
  dateTime: 'http://www.w3.org/2001/XMLSchema#dateTime',
  decimal: 'http://www.w3.org/2001/XMLSchema#decimal',
  integer: 'http://www.w3.org/2001/XMLSchema#integer',
  string: 'http://www.w3.org/2001/XMLSchema#string',
})

export const PROV = Object.freeze({
  endedAtTime: 'http://www.w3.org/ns/prov#endedAtTime',
  used: 'http://www.w3.org/ns/prov#used',
  wasAssociatedWith: 'http://www.w3.org/ns/prov#wasAssociatedWith',
})

export const KOCH = Object.freeze({
  KochCourse: `${KOCH_NS}KochCourse`,
  Learner: `${KOCH_NS}Learner`,
  Lesson: `${KOCH_NS}Lesson`,
  MorseCharacter: `${KOCH_NS}MorseCharacter`,
  PracticeSession: `${KOCH_NS}PracticeSession`,
  CopyAttempt: `${KOCH_NS}CopyAttempt`,
  KeyingAttempt: `${KOCH_NS}KeyingAttempt`,
  Receiving: `${KOCH_NS}Receiving`,
  Sending: `${KOCH_NS}Sending`,
  completedSession: `${KOCH_NS}completedSession`,
  courseId: `${KOCH_NS}courseId`,
  sequenceVersion: `${KOCH_NS}sequenceVersion`,
  hasLesson: `${KOCH_NS}hasLesson`,
  hasAttempt: `${KOCH_NS}hasAttempt`,
  introducesCharacter: `${KOCH_NS}introducesCharacter`,
  availableCharacter: `${KOCH_NS}availableCharacter`,
  inCourse: `${KOCH_NS}inCourse`,
  studiesCourse: `${KOCH_NS}studiesCourse`,
  learnerId: `${KOCH_NS}learnerId`,
  symbol: `${KOCH_NS}symbol`,
  inSession: `${KOCH_NS}inSession`,
  legacySubject: `${KOCH_NS}legacySubject`,
  lesson: `${KOCH_NS}lesson`,
  lessonNumber: `${KOCH_NS}lessonNumber`,
  sequenceIndex: `${KOCH_NS}sequenceIndex`,
  morseCode: `${KOCH_NS}morseCode`,
  accuracy: `${KOCH_NS}accuracy`,
  correctCount: `${KOCH_NS}correctCount`,
  characterCount: `${KOCH_NS}characterCount`,
  expectedCopy: `${KOCH_NS}expectedCopy`,
  submittedCopy: `${KOCH_NS}submittedCopy`,
  characterWpm: `${KOCH_NS}characterWpm`,
  effectiveWpm: `${KOCH_NS}effectiveWpm`,
  toneHz: `${KOCH_NS}toneHz`,
  position: `${KOCH_NS}position`,
  expectedCharacter: `${KOCH_NS}expectedCharacter`,
  enteredCharacter: `${KOCH_NS}enteredCharacter`,
  isCorrect: `${KOCH_NS}isCorrect`,
  preferredRunLength: `${KOCH_NS}preferredRunLength`,
  showNotation: `${KOCH_NS}showNotation`,
  activity: `${KOCH_NS}activity`,
  performanceScore: `${KOCH_NS}performanceScore`,
  timingScore: `${KOCH_NS}timingScore`,
  durationScore: `${KOCH_NS}durationScore`,
  spacingScore: `${KOCH_NS}spacingScore`,
  consistencyScore: `${KOCH_NS}consistencyScore`,
  expectedPattern: `${KOCH_NS}expectedPattern`,
  enteredPattern: `${KOCH_NS}enteredPattern`,
  keyingTrace: `${KOCH_NS}keyingTrace`,
})

export function assertGraphId(graphId: string): void {
  if (!/^[a-z0-9-]{1,40}$/.test(graphId)) {
    throw new Error(
      `Koch graph id ${JSON.stringify(graphId)} is outside Garden's canonical grammar ([a-z0-9-]{1,40}).`,
    )
  }
}

export function graphRootIri(graphId: string): string {
  assertGraphId(graphId)
  return `urn:mnemosyne:local:graph:${graphId}`
}

/** The pre-Emporium direct-RDF graph, retained only as a migration source. */
export function userRdfGraphIri(graphId: string): string {
  return `${graphRootIri(graphId)}:user:rdf`
}

/** Emporium's authoritative projection for the Koch Meaningful Objects. */
export function kochProjectionGraphIri(graphId: string): string {
  return `${graphRootIri(graphId)}:projection:koch-morse`
}

/** The first prototype's app-owned graph, read only by the migration bridge. */
export function legacyProgressGraphIri(graphId: string): string {
  assertGraphId(graphId)
  return `urn:mnemosyne:graph:${encodeURIComponent(graphId)}:koch-progress`
}

export function learnerIri(graphId: string, actorId = 'local'): string {
  return `${kochProjectionGraphIri(graphId)}:learner:${actorKey(actorId)}`
}

export function kochSurfaceIri(graphId: string, actorId = 'local'): string {
  normalizeActorId(actorId)
  // Preserve the existing local subject so current single-user layouts migrate
  // in place; authenticated hosted people receive independent surface subjects.
  return actorId === 'local'
    ? `${graphRootIri(graphId)}:surface:koch-practice`
    : `${graphRootIri(graphId)}:surface:koch-practice:user:${actorKey(actorId)}`
}

export function courseIri(graphId: string): string {
  return `${kochProjectionGraphIri(graphId)}:course:standard`
}

export function lessonLocalId(lesson: number): string {
  return `lesson-${Math.max(1, Math.round(lesson))}`
}

export function lessonIri(graphId: string, lesson: number): string {
  return `${kochProjectionGraphIri(graphId)}:lesson:${lessonLocalId(lesson)}`
}

export function characterLocalId(character: string): string {
  const index = KOCH_SEQUENCE.indexOf(character as KochCharacter)
  return index >= 0 ? `character-${index + 1}` : `character-${encodeURIComponent(character)}`
}

export function characterIri(graphId: string, character: string): string {
  return `${kochProjectionGraphIri(graphId)}:character:${characterLocalId(character)}`
}

export function sessionLocalId(id: string): string {
  return encodeURIComponent(id.trim())
}

export function sessionIri(graphId: string, id: string): string {
  return `${kochProjectionGraphIri(graphId)}:session:${sessionLocalId(id)}`
}

export function attemptLocalId(sessionId: string, position: number): string {
  return `${sessionLocalId(sessionId)}-${Math.max(1, Math.round(position + 1))}`
}

export function copyAttemptIri(graphId: string, sessionId: string, position: number): string {
  return `${kochProjectionGraphIri(graphId)}:copy-attempt:${attemptLocalId(sessionId, position)}`
}

export function keyingAttemptIri(graphId: string, sessionId: string, position: number): string {
  return `${kochProjectionGraphIri(graphId)}:keying-attempt:${attemptLocalId(sessionId, position)}`
}

export function literal(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`
}

export function typedLiteral(value: string, datatype: string): string {
  return `${literal(value)}^^<${datatype}>`
}

export type KochMoRecord = Readonly<{ kind: string; localId: string } & Record<string, unknown>>

export interface KochLearnerState {
  readonly characterWpm: number
  readonly effectiveWpm: number
  readonly toneHz: number
  readonly preferredRunLength: number
  readonly showNotation: boolean
}

export const DEFAULT_KOCH_LEARNER_STATE: KochLearnerState = Object.freeze({
  characterWpm: DEFAULT_SETTINGS.characterWpm,
  effectiveWpm: DEFAULT_SETTINGS.effectiveWpm,
  toneHz: DEFAULT_SETTINGS.toneHz,
  preferredRunLength: DEFAULT_SETTINGS.characterCount,
  showNotation: false,
})

export function learnerRecord(
  graphId: string,
  actor: KochActor,
  state: KochLearnerState = DEFAULT_KOCH_LEARNER_STATE,
): KochMoRecord {
  return {
    kind: 'Learner',
    localId: actorKey(actor.id),
    learnerId: actor.id,
    label: actor.displayName,
    studiesCourse: courseIri(graphId),
    characterWpm: state.characterWpm,
    effectiveWpm: state.effectiveWpm,
    toneHz: state.toneHz,
    preferredRunLength: state.preferredRunLength,
    showNotation: state.showNotation,
  }
}

/** The standard LCWO order as a graph-local Course → Lesson → Character MO set. */
export function curriculumRecords(graphId: string): readonly KochMoRecord[] {
  const course = courseIri(graphId)
  const characters = KOCH_SEQUENCE.map((character, index): KochMoRecord => ({
    kind: 'MorseCharacter',
    localId: characterLocalId(character),
    label: character,
    symbol: character,
    morseCode: MORSE[character],
    sequenceIndex: index + 1,
    inCourse: course,
  }))
  const lessons = KOCH_SEQUENCE.map((character, index): KochMoRecord => ({
    kind: 'Lesson',
    localId: lessonLocalId(index + 1),
    label: `Koch lesson ${index + 1}`,
    lessonNumber: index + 1,
    introducesCharacter: characterIri(graphId, character),
    availableCharacter: KOCH_SEQUENCE.slice(0, index + 1).map((value) => characterIri(graphId, value)),
    inCourse: course,
  }))
  return [
    {
      kind: 'KochCourse',
      localId: 'standard',
      courseId: 'lcwo-standard',
      label: 'Koch Morse course',
      sequenceVersion: 'LCWO 2026',
      hasLesson: KOCH_SEQUENCE.map((_, index) => lessonIri(graphId, index + 1)),
    },
    ...characters,
    ...lessons,
  ]
}

export function informationModelRecords(
  graphId: string,
  actor: KochActor = { id: 'local', displayName: 'Local learner' },
  state: KochLearnerState = DEFAULT_KOCH_LEARNER_STATE,
): readonly KochMoRecord[] {
  return [...curriculumRecords(graphId), learnerRecord(graphId, actor, state)]
}
