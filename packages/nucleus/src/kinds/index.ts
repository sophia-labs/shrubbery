/**
 * Pure display-kind carriers and builders.
 *
 * This module is data-only: no DOM, stores, network, Lit, or backend imports.
 */

export type DisplayKind = 'identity' | 'state' | 'metric' | 'prose' | 'reference' | 'testimony' | 'affordance'

/**
 * The RUNTIME kind register — the canonical value list of `DisplayKind` (R4a).
 * `satisfies` rejects any value outside the union; `_DisplayKindsExhaustive`
 * rejects any union member missing from the list. Tokens' `KIND_APPLICATIONS`
 * and `kind.css`'s `[data-kind=…]` selectors are the two mirror registers —
 * the kind-register-parity test asserts three-way set equality.
 */
export const DISPLAY_KINDS = [
  'identity',
  'state',
  'metric',
  'prose',
  'reference',
  'testimony',
  'affordance',
] as const satisfies readonly DisplayKind[]

type AssertNeverKind<T extends never> = T
/** Compile-time exhaustiveness: every DisplayKind appears in DISPLAY_KINDS. */
export type _DisplayKindsExhaustive = AssertNeverKind<
  Exclude<DisplayKind, (typeof DISPLAY_KINDS)[number]>
>

/**
 * The orthogonal posture/register axis. `room` | `bench` | `constitution` |
 * `dispatch` are whole-ROOM postures; `contested` is the fifth member — a
 * per-VALUE Law IV posture on one Meaningful Object, never a room posture
 * (see `RoomPostureStance` below).
 */
export type Stance = 'room' | 'bench' | 'constitution' | 'dispatch' | 'contested'

/**
 * The RUNTIME stance register — the canonical value list of `Stance`, mirroring
 * `DISPLAY_KINDS` (:16-30) exactly. Tokens' `STANCE_APPLICATIONS` keys and
 * `stance.css`'s `[data-stance=…]` selectors are the two mirror registers —
 * the stance-register-parity test asserts three-way set equality.
 */
export const STANCES = ['room', 'bench', 'constitution', 'dispatch', 'contested'] as const satisfies readonly Stance[]

type AssertNeverStance<T extends never> = T
/** Compile-time exhaustiveness: every Stance appears in STANCES. */
export type _StancesExhaustive = AssertNeverStance<Exclude<Stance, (typeof STANCES)[number]>>

/**
 * The four ROOM POSTURES. `contested` is a per-VALUE stance only: it says
 * something about one object, never about the whole room. `applyStance`
 * (`@shrubbery/tokens`) accepts only these four, so "stamp contested on
 * `<html>`" does not compile.
 */
export const ROOM_POSTURE_STANCES = ['room', 'bench', 'constitution', 'dispatch'] as const satisfies readonly Stance[]
export type RoomPostureStance = (typeof ROOM_POSTURE_STANCES)[number]

export interface Attributed<T> {
  readonly value: T
  readonly observer?: string
  readonly observedAt?: number
}

export interface Recency<T> {
  readonly current: T
  readonly capturedAt: number
  readonly previous?: {
    readonly value: T
    readonly capturedAt: number
  }
}

export interface RecencySource<T> {
  readonly read: T | null
  readonly capturedAt: number | null
  readonly previous?: {
    readonly read: T
    readonly capturedAt: number
  }
}

export function recencyFromStoreState<T>(state: RecencySource<T>): Recency<T> | null {
  if (state.read === null || state.capturedAt === null) return null
  const recency: Recency<T> = {
    current: state.read,
    capturedAt: state.capturedAt,
  }
  return state.previous
    ? {
        ...recency,
        previous: {
          value: state.previous.read,
          capturedAt: state.previous.capturedAt,
        },
      }
    : recency
}

export const MODEL_LABELS: Record<string, string> = {
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'gpt-5': 'GPT-5',
  'claude-sonnet': 'Claude Sonnet',
}

export * from './card.js'
export * from './floor.js'
export * from './format.js'
export * from './json.js'
export * from './logbook.js'
export * from './presence.js'
export * from './speech.js'
export * from './turn-account.js'
export * from './turnover.js'
