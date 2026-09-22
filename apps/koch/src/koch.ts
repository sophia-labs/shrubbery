export const KOCH_SEQUENCE = [
  'K', 'M', 'U', 'R', 'E', 'S', 'N', 'A', 'P', 'T',
  'L', 'W', 'I', '.', 'J', 'Z', '=', 'F', 'O', 'Y',
  ',', 'V', 'G', '5', '/', 'Q', '9', '2', 'H', '3',
  '8', 'B', '?', '4', '7', 'C', '1', 'D', '6', '0', 'X',
] as const

export type KochCharacter = (typeof KOCH_SEQUENCE)[number]

export const MORSE: Readonly<Record<KochCharacter, string>> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
}

export interface PracticeSettings {
  readonly characterWpm: number
  readonly effectiveWpm: number
  readonly toneHz: number
  readonly characterCount: number
  readonly groupSize: number
}

export const DEFAULT_SETTINGS: PracticeSettings = {
  characterWpm: 20,
  effectiveWpm: 12,
  toneHz: 650,
  characterCount: 25,
  groupSize: 5,
}

export interface PracticePrompt {
  readonly lesson: number
  readonly characters: readonly KochCharacter[]
  readonly plain: string
  readonly grouped: string
}

export interface CharacterResult {
  readonly position: number
  readonly expected: string
  readonly entered: string
  readonly correct: boolean
}

export interface CopyScore {
  readonly activity: 'receive'
  readonly expected: string
  readonly entered: string
  readonly correct: number
  readonly total: number
  readonly accuracy: number
  readonly performanceScore: number
  readonly attempts: readonly CharacterResult[]
}

export function clampLesson(lesson: number): number {
  return Math.max(2, Math.min(KOCH_SEQUENCE.length, Math.trunc(lesson)))
}

export function lessonCharacters(lesson: number): readonly KochCharacter[] {
  return KOCH_SEQUENCE.slice(0, clampLesson(lesson))
}

/**
 * Generate five-character copy groups from the current Koch alphabet. The
 * newest character is guaranteed to occur enough to be useful in a short run;
 * the remaining positions are uniform over the full learned set.
 */
export function generatePrompt(
  lesson: number,
  settings: Pick<PracticeSettings, 'characterCount' | 'groupSize'> = DEFAULT_SETTINGS,
  random: () => number = Math.random,
): PracticePrompt {
  const characters = lessonCharacters(lesson)
  const count = Math.max(settings.groupSize, Math.trunc(settings.characterCount))
  const newest = characters.at(-1)!
  const minimumNewest = Math.min(count, Math.max(3, Math.round(count * 0.16)))
  const values: KochCharacter[] = Array.from({ length: count }, (_, index) => {
    if (index < minimumNewest) return newest
    const chosen = Math.min(characters.length - 1, Math.floor(random() * characters.length))
    return characters[chosen]
  })

  // Fisher–Yates keeps the guaranteed new-character practice from bunching at
  // the beginning while remaining injectable/deterministic in tests.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    ;[values[i], values[j]] = [values[j], values[i]]
  }

  const plain = values.join('')
  const groups: string[] = []
  for (let i = 0; i < plain.length; i += settings.groupSize) {
    groups.push(plain.slice(i, i + settings.groupSize))
  }
  return { lesson: clampLesson(lesson), characters, plain, grouped: groups.join(' ') }
}

export function normalizeCopy(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((char) => Object.hasOwn(MORSE, char))
    .join('')
}

export function scoreCopy(expectedValue: string, enteredValue: string): CopyScore {
  const expected = normalizeCopy(expectedValue)
  const entered = normalizeCopy(enteredValue)
  const attempts = Array.from({ length: expected.length }, (_, position): CharacterResult => {
    const wanted = expected[position]
    const got = entered[position] ?? ''
    return { position, expected: wanted, entered: got, correct: wanted === got }
  })
  const correct = attempts.filter((attempt) => attempt.correct).length
  return {
    activity: 'receive',
    expected,
    entered,
    correct,
    total: expected.length,
    accuracy: expected.length === 0 ? 0 : correct / expected.length,
    performanceScore: expected.length === 0 ? 0 : correct / expected.length,
    attempts,
  }
}

export function nextLesson(currentLesson: number, accuracy: number): number {
  return accuracy >= 0.9
    ? Math.min(KOCH_SEQUENCE.length, clampLesson(currentLesson) + 1)
    : clampLesson(currentLesson)
}
