/**
 * features.ts — the one place Shrubbery decides who sees an unreleased surface.
 *
 * A feature is released to an AUDIENCE, and the audience is decided from the
 * signed-in identity, never from the graph and never from a build flag alone:
 *
 *   hosted (Cognito session)  → an 'everyone' feature is open to every hosted
 *                               session (the surface still asks an anonymous
 *                               visitor to sign in). An 'operator' feature is
 *                               identity only: the operator allowlist below is
 *                               the entire audience; no env var can widen it,
 *                               so a mis-set build flag cannot leak a surface
 *                               to every hosted user.
 *   local (desktop / loopback / playground — no Cognito) → whatever the
 *                               audience, a local build may not ship the
 *                               surface at all (the desktop app has no /hoja/
 *                               route). So local is OFF unless the build opts
 *                               in with `VITE_SHRUBBERY_FEATURES=hoja-v2[,other]`.
 *
 * Hoja (`hoja-v2`) opened to everyone on 2026-09-23 (Vera); its picker entry
 * carries the `experimental` stage (sophia-suite.ts).
 *
 * Migration: when the gateway grows an audience claim on the session
 * (plans/2026-09-22-sophia-standard-layout-slots.md — `audience: 'operator'`
 * in the `sophia-standard` app declarations), `FeatureSession.audience`
 * carries it and `OPERATOR_SUBJECTS` retires. Callers do not change.
 */

/** Every gated surface, by stable id. */
export type FeatureId =
  /** The standalone Hoja notes app (b25a14d) and its Garden app-picker entry. */
  | 'hoja-v2'
  /**
   * Choreograph as a SUITE app: its entry in every Sophia top bar (Garden,
   * Hoja, the /choreograph route). A workspace config that itself declares a
   * Choreograph app keeps its in-graph tab regardless — that is the graph's
   * own layout, not this gate.
   */
  | 'choreograph'

export type FeatureAudience = 'operator' | 'everyone'

/** Release table: which audience each feature is open to today. */
export const FEATURE_AUDIENCE: Readonly<Record<FeatureId, FeatureAudience>> = Object.freeze({
  'hoja-v2': 'everyone',
  'choreograph': 'operator',
})

/**
 * Hosted operator allowlist — Cognito `sub` values (pool us-west-1_BlPVDVQJx).
 * Vera's real sub. Stand-in for the gateway's audience claim; see header.
 */
export const OPERATOR_SUBJECTS: readonly string[] = Object.freeze([
  'e9e949fe-0091-7015-0ab8-10bf259084ab',
])

/**
 * Per-feature QA accounts: dedicated test identities (never a real user) that
 * may see one gated feature so automated testers can exercise it without
 * holding an operator's session. Remove an entry when its test run is done.
 */
export const FEATURE_TEST_SUBJECTS: Readonly<Record<FeatureId, readonly string[]>> = Object.freeze({
  // The Hoja probe account's 2026-09-23 QA entry retired when hoja-v2 opened to everyone.
  'hoja-v2': Object.freeze([]),
  'choreograph': Object.freeze([]),
})

export interface FeatureSession {
  /** 'hosted' = a Cognito-backed deployment; 'local' = no Cognito at all. */
  readonly mode: 'hosted' | 'local'
  /** Cognito `sub` of the signed-in user; empty/null when anonymous. */
  readonly userId?: string | null
  /** Future: the gateway-issued audience; wins over the allowlist when present. */
  readonly audience?: FeatureAudience | null
  /** Local builds only: features the build opted into (see localFeatureOptIns). */
  readonly localOptIns?: readonly string[]
}

export function isOperatorSubject(userId: string | null | undefined): boolean {
  const subject = userId?.trim() ?? ''
  return subject !== '' && OPERATOR_SUBJECTS.includes(subject)
}

/** Is `feature` visible to this session? Pure; safe to call on every render. */
export function isEnabled(feature: FeatureId, session: FeatureSession): boolean {
  const released = FEATURE_AUDIENCE[feature]
  if (released === undefined) return false
  if (session.mode === 'local') return session.localOptIns?.includes(feature) ?? false
  if (released === 'everyone') return true
  if (session.audience != null) return session.audience === 'operator'
  const subject = session.userId?.trim() ?? ''
  return isOperatorSubject(subject) || (subject !== '' && (FEATURE_TEST_SUBJECTS[feature] ?? []).includes(subject))
}

/** Parse `VITE_SHRUBBERY_FEATURES` ("hoja-v2, other") from a Vite env record. */
export function localFeatureOptIns(env: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const raw = env?.VITE_SHRUBBERY_FEATURES
  if (typeof raw !== 'string') return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}
