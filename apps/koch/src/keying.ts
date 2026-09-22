import { MORSE, normalizeCopy, type CharacterResult, type KochCharacter } from './koch.js'

export type KeyingSymbol = '.' | '-'

export interface KeyingTransition {
  readonly kind: 'down' | 'up'
  /** Milliseconds from the start of the run, from a monotonic browser clock. */
  readonly atMs: number
}

export interface KeyingElement {
  readonly symbol: KeyingSymbol
  readonly durationMs: number
  readonly gapBeforeMs: number | null
}

export interface KeyingCharacter {
  readonly pattern: string
  readonly decoded: string
  readonly elements: readonly KeyingElement[]
  readonly startedAtMs: number
  readonly endedAtMs: number
  readonly gapBeforeMs: number | null
}

export interface KeyingTrace {
  readonly schemaVersion: 1
  readonly targetDitMs: number
  readonly transitions: readonly KeyingTransition[]
  readonly characters: readonly KeyingCharacter[]
}

export interface KeyingAttempt extends CharacterResult {
  readonly expectedPattern: string
  readonly enteredPattern: string
  readonly decoded: string
}

export interface KeyingScore {
  readonly activity: 'send'
  readonly expected: string
  readonly entered: string
  readonly correct: number
  readonly total: number
  readonly accuracy: number
  readonly timingScore: number
  readonly durationScore: number
  readonly spacingScore: number
  readonly consistencyScore: number
  readonly performanceScore: number
  readonly attempts: readonly KeyingAttempt[]
  readonly trace: KeyingTrace
}

const REVERSE_MORSE = new Map<string, string>(
  Object.entries(MORSE).map(([character, pattern]) => [pattern, character]),
)

export function targetDitMs(characterWpm: number): number {
  return 1_200 / Math.max(5, characterWpm)
}

export function classifyKeyingElement(durationMs: number, ditMs: number): KeyingSymbol {
  return durationMs < ditMs * 2 ? '.' : '-'
}

function closeness(actual: number, target: number): number {
  if (!(actual > 0) || !(target > 0)) return 0
  return Math.exp(-Math.abs(Math.log(actual / target)))
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function consistency(values: readonly number[]): number {
  if (values.length < 2) return values.length === 1 ? 1 : 0
  const average = mean(values)
  if (!(average > 0)) return 0
  const variance = mean(values.map((value) => (value - average) ** 2))
  return Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / average))
}

export class StraightKeyCapture {
  private readonly startedAtMs: number
  private readonly transitions: KeyingTransition[] = []
  private readonly characters: KeyingCharacter[] = []
  private currentDownAtMs: number | null = null
  private currentElements: KeyingElement[] = []
  private currentStartedAtMs: number | null = null
  private previousUpAtMs: number | null = null
  private previousCharacterEndedAtMs: number | null = null

  constructor(
    readonly ditMs: number,
    startedAtMs = performance.now(),
  ) {
    this.startedAtMs = startedAtMs
  }

  get isDown(): boolean {
    return this.currentDownAtMs !== null
  }

  get livePattern(): string {
    return this.currentElements.map((element) => element.symbol).join('')
  }

  get characterCount(): number {
    return this.characters.length
  }

  keyDown(atMs = performance.now()): boolean {
    if (this.currentDownAtMs !== null) return false
    if (this.currentStartedAtMs === null) this.currentStartedAtMs = atMs
    this.currentDownAtMs = atMs
    this.transitions.push({ kind: 'down', atMs: atMs - this.startedAtMs })
    return true
  }

  keyUp(atMs = performance.now()): KeyingElement | null {
    if (this.currentDownAtMs === null) return null
    const durationMs = Math.max(1, atMs - this.currentDownAtMs)
    const element: KeyingElement = {
      symbol: classifyKeyingElement(durationMs, this.ditMs),
      durationMs,
      gapBeforeMs: this.previousUpAtMs === null ? null : Math.max(0, this.currentDownAtMs - this.previousUpAtMs),
    }
    this.currentElements.push(element)
    this.currentDownAtMs = null
    this.previousUpAtMs = atMs
    this.transitions.push({ kind: 'up', atMs: atMs - this.startedAtMs })
    return element
  }

  closeCharacter(atMs = performance.now()): KeyingCharacter | null {
    if (this.currentDownAtMs !== null || this.currentElements.length === 0 || this.currentStartedAtMs === null) return null
    const pattern = this.livePattern
    const character: KeyingCharacter = {
      pattern,
      decoded: REVERSE_MORSE.get(pattern) ?? '·',
      elements: this.currentElements,
      startedAtMs: this.currentStartedAtMs - this.startedAtMs,
      endedAtMs: (this.previousUpAtMs ?? atMs) - this.startedAtMs,
      gapBeforeMs: this.previousCharacterEndedAtMs === null
        ? null
        : Math.max(0, this.currentStartedAtMs - this.previousCharacterEndedAtMs),
    }
    this.characters.push(character)
    this.previousCharacterEndedAtMs = this.previousUpAtMs
    this.currentElements = []
    this.currentStartedAtMs = null
    this.previousUpAtMs = null
    return character
  }

  snapshot(): KeyingTrace {
    return {
      schemaVersion: 1,
      targetDitMs: this.ditMs,
      transitions: [...this.transitions],
      characters: [...this.characters],
    }
  }
}

export function scoreKeying(expectedValue: string, trace: KeyingTrace): KeyingScore {
  const expected = normalizeCopy(expectedValue)
  const attempts = Array.from({ length: expected.length }, (_, position): KeyingAttempt => {
    const wanted = expected[position]
    const keyed = trace.characters[position]
    const decoded = keyed?.decoded === '·' ? '' : keyed?.decoded ?? ''
    return {
      position,
      expected: wanted,
      entered: decoded,
      decoded,
      expectedPattern: MORSE[wanted as KochCharacter] ?? '',
      enteredPattern: keyed?.pattern ?? '',
      correct: wanted === decoded,
    }
  })
  const correct = attempts.filter((attempt) => attempt.correct).length
  const durationScores: number[] = []
  const spacingScores: number[] = []
  const normalizedDurations: number[] = []
  for (const character of trace.characters) {
    for (const element of character.elements) {
      const units = element.symbol === '-' ? 3 : 1
      durationScores.push(closeness(element.durationMs, trace.targetDitMs * units))
      normalizedDurations.push(element.durationMs / units)
      if (element.gapBeforeMs !== null) spacingScores.push(closeness(element.gapBeforeMs, trace.targetDitMs))
    }
    if (character.gapBeforeMs !== null) spacingScores.push(closeness(character.gapBeforeMs, trace.targetDitMs * 3))
  }
  const durationScore = mean(durationScores)
  const spacingScore = spacingScores.length ? mean(spacingScores) : durationScore
  const consistencyScore = consistency(normalizedDurations)
  const timingScore = 0.5 * durationScore + 0.3 * spacingScore + 0.2 * consistencyScore
  const accuracy = expected.length === 0 ? 0 : correct / expected.length
  return {
    activity: 'send',
    expected,
    entered: trace.characters.map((character) => character.decoded).join(''),
    correct,
    total: expected.length,
    accuracy,
    timingScore,
    durationScore,
    spacingScore,
    consistencyScore,
    performanceScore: 0.7 * accuracy + 0.3 * timingScore,
    attempts,
    trace,
  }
}
