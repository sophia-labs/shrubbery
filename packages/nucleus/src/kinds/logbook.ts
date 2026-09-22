/**
 * The bay's pure view-models — the logbook's strip and its unfolded
 * conversation rows.
 *
 * (This file is named `logbook.ts` — sheet 02's name for the bay — rather than
 * `bay.ts` so the substring does not trip the kinds purity fence's `y.js` guard.)
 *
 * This module is data-only: no DOM, stores, network, Lit, or backend imports.
 * It composes the roster (the agents list) into strips a returning observer can
 * read in the hallway, and each agent's sessions into the conversation rows that
 * unfold beneath a hooked strip. Every rule the folio binds lives here as a pure
 * function so the render layer only spends the view-model, never re-decides it.
 */

import { firstNonBlankString } from './json.js'
import { normalizePresenceLifecycle, presenceToneForLifecycle, type AgentPresenceTone } from './presence.js'

/**
 * The phosphor decay steps drawn on Folio 01. `fresh` is full ink; `dim1`/`dim2`
 * are the two dimming steps applied to TESTIMONY spans only (never identity, never
 * the dot); `stale` is the amber threshold — the only place a strip's as-of earns
 * warning ink, reserved for testimony the projection has not attested (`unknown`).
 */
export type StripAge = 'fresh' | 'dim1' | 'dim2' | 'stale'

export interface BayStripModel {
  readonly value: string
  readonly observer?: string
  readonly observedAt?: number
}

export interface BayStrip {
  readonly id: string
  readonly identity: string
  readonly lifecycle: string
  readonly tone: AgentPresenceTone
  readonly stateSentence: string
  /** The model testimony, or null when the roster attested no model (no placeholder). */
  readonly model: BayStripModel | null
  readonly age: StripAge
  /** The as-of instant (ms epoch) the testimony was last touched, or null when unwitnessed. */
  readonly asOf: number | null
  /** The conversation count metric, or null when zero/absent — a badge zone with nothing to say shows nothing. */
  readonly sessionCount: number | null
}

export interface BayStripInput {
  readonly id: string
  readonly name: string
  readonly lifecycle?: string | null
  readonly model?: string | null
  readonly modelObserver?: string | null
  readonly modelObservedAt?: number | null
  /** The roster's updatedAt (ms epoch) — the strip's as-of testimony. */
  readonly asOf?: number | null
  readonly sessionCount?: number | null
  /** Reference instant for decay; defaults to Date.now() at call time. */
  readonly now?: number
}

const FRESH_MS = 5 * 60_000
const DIM1_MS = 2 * 60 * 60_000

/**
 * The decay ramp. `unknown` testimony is always `stale` (amber, pulsing) — the
 * projection has not attested a lifecycle, and that unverifiedness is the news.
 * A known-lifecycle agent with no as-of dims to `dim2` (honest rest, not alarm);
 * with an as-of it decays by age. Known lifecycles never reach `stale` on age
 * alone: an honestly-dormant agent is dim, not amber.
 */
export function stripAge(asOf: number | null, tone: AgentPresenceTone, now: number): StripAge {
  if (tone === 'unknown') return 'stale'
  if (asOf === null) return 'dim2'
  const dt = Math.max(0, now - asOf)
  if (dt < FRESH_MS) return 'fresh'
  if (dt < DIM1_MS) return 'dim1'
  return 'dim2'
}

function stripStateSentence(lifecycle: string, tone: AgentPresenceTone): string {
  if (tone === 'unknown') return 'unknown — no lifecycle attested'
  return lifecycle
}

export function buildBayStrip(input: BayStripInput): BayStrip {
  const now = input.now ?? Date.now()
  const lifecycle = normalizePresenceLifecycle(input.lifecycle)
  const tone = presenceToneForLifecycle(input.lifecycle)
  const asOf = typeof input.asOf === 'number' && Number.isFinite(input.asOf) ? input.asOf : null

  const modelValue = firstNonBlankString(input.model)
  const observer = firstNonBlankString(input.modelObserver) ?? undefined
  const observedAt =
    typeof input.modelObservedAt === 'number' && Number.isFinite(input.modelObservedAt) ? input.modelObservedAt : undefined

  const sessionCount =
    typeof input.sessionCount === 'number' && Number.isFinite(input.sessionCount) && input.sessionCount > 0
      ? Math.floor(input.sessionCount)
      : null

  return {
    id: input.id,
    identity: input.name,
    lifecycle,
    tone,
    stateSentence: stripStateSentence(lifecycle, tone),
    model: modelValue
      ? {
          value: modelValue,
          ...(observer ? { observer } : {}),
          ...(observedAt !== undefined ? { observedAt } : {}),
        }
      : null,
    age: stripAge(asOf, tone, now),
    asOf,
    sessionCount,
  }
}

export interface ConversationRow {
  readonly sessionId: string
  /**
   * The session objective as the row's title, or null when none was recorded.
   * A null title renders as silence (the ink clause): the render layer falls back
   * to the sessionId in mono as the honest identity, never a placeholder dash.
   */
  readonly title: string | null
  /** The message count, or null when zero/absent — silence, not "0 messages". */
  readonly messageCount: number | null
  readonly lastMessageAt: number | null
  /** True when this is the agent's live conversation — entering it opens the room, not the log. */
  readonly isActive: boolean
}

export interface ConversationRowInput {
  readonly sessionId: string
  readonly objective?: string | null
  readonly messageCount?: number | null
  readonly lastMessageAt?: number | null
  /** The agent's activeSessionId (from the roster or the world envelope); matches → live. */
  readonly activeSessionId?: string | null
}

export function buildConversationRow(input: ConversationRowInput): ConversationRow {
  const title = firstNonBlankString(input.objective)
  const messageCount =
    typeof input.messageCount === 'number' && Number.isFinite(input.messageCount) && input.messageCount > 0
      ? Math.floor(input.messageCount)
      : null
  const lastMessageAt =
    typeof input.lastMessageAt === 'number' && Number.isFinite(input.lastMessageAt) ? input.lastMessageAt : null
  const active = firstNonBlankString(input.activeSessionId)
  return {
    sessionId: input.sessionId,
    title: title ?? null,
    messageCount,
    lastMessageAt,
    isActive: !!active && input.sessionId === active,
  }
}

export function buildConversationRows(
  sessions: readonly ConversationRowInput[],
  activeSessionId?: string | null,
): readonly ConversationRow[] {
  return sessions.map((session) =>
    buildConversationRow({ ...session, activeSessionId: session.activeSessionId ?? activeSessionId }),
  )
}
