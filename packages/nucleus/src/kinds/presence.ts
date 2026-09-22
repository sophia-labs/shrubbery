import { firstNonBlankString } from './json.js'

/**
 * The closed agent-lifecycle set the projection now serves as a self-describing
 * schema block (`sophia.agent-lifecycle.v0`, statusSource `worldDoc.status.lifecycle`).
 * Greenhouse consumes it verbatim: every value maps to exactly one presence tone,
 * and any value NOT in this set is honestly rendered as `unknown` rather than
 * collapsed into `dormant`.
 */
export const AGENT_LIFECYCLE_VALUES = [
  'dormant',
  'reviving',
  'resident',
  'paused',
  'completed',
  'restartable',
  'retired',
  'error',
] as const

export type AgentLifecycle = (typeof AGENT_LIFECYCLE_VALUES)[number]

/**
 * Four dot tones, drawn on Folio 01: `live` (green, present), `held` (amber,
 * attention), `dormant` (hollow, honest rest), `unknown` (dashed, not attested
 * or unrecognized). No fifth tone may be added without amending the sheet.
 */
export type AgentPresenceTone = 'live' | 'held' | 'dormant' | 'unknown'

export interface AgentPresenceReference {
  readonly label: string
  readonly value: string
}

export interface AgentPresenceModel {
  readonly value: string
  readonly observedAt?: number
  readonly observer?: string
  /**
   * Phosphor honesty: true when this model value is a hardcoded fallback (the
   * agent's graph read failed) rather than testimony read from the graph — mirrors
   * `AgentCardCharter.seeded`. Absent (not just false) when the source did not serve
   * the flag at all, so a served-false and an unserved read the same: no chip.
   */
  readonly seeded?: boolean
}

/**
 * Model provenance, served directly by the projection at
 * `status.attribution.model` — no longer mined from the event stream client-side.
 * Absent (null) when nothing has witnessed a model change.
 */
export interface AgentPresenceModelAttribution {
  readonly value?: string
  readonly actorId?: string
  readonly at?: number
}

export interface AgentPresenceViewModel {
  readonly identity: {
    readonly name: string
    readonly kindLine: string
  }
  readonly state: {
    readonly lifecycle: string
    readonly tone: AgentPresenceTone
  }
  readonly model: AgentPresenceModel
  readonly references: readonly AgentPresenceReference[]
  readonly meta: readonly AgentPresenceReference[]
}

export interface AgentPresenceInput {
  readonly name: string
  /** The real one-line kind, served by the registry through the world doc. Never composed client-side. */
  readonly kindLine?: string | null
  readonly lifecycle?: string | null
  readonly model: string
  /** Model attribution testimony from `status.attribution.model`; absent when unwitnessed. */
  readonly attribution?: AgentPresenceModelAttribution | null
  readonly driver?: string | null
  readonly graph?: string | null
  readonly runId?: string | null
  readonly sessionId?: string | null
  readonly updatedAt?: string | null
  /** The prompt artifact's `compatibilitySeeded` flag — see `AgentPresenceModel.seeded`. */
  readonly seeded?: boolean | null
}

function isKnownLifecycle(value: string): value is AgentLifecycle {
  return (AGENT_LIFECYCLE_VALUES as readonly string[]).includes(value)
}

/**
 * The one place the lifecycle string is normalized: absent, blank, or the
 * placeholder dash all collapse to the honest sentinel `unknown` — never to
 * `dormant`. Shared by the presence sentence (the room) and the strip (the bay)
 * so a resident reads the same word in both places.
 */
export function normalizePresenceLifecycle(lifecycle: string | null | undefined): string {
  const attested = lifecycle?.trim()
  return attested && attested !== '-' ? attested : 'unknown'
}

/**
 * The single lifecycle→tone map, exhaustive over the closed set with the honest
 * `unknown` dashed dot for anything the projection has not attested. Shared by
 * `buildAgentPresence` and `buildBayStrip` so the dot never diverges between the
 * room and the bay.
 */
export function presenceToneForLifecycle(lifecycle: string | null | undefined): AgentPresenceTone {
  const value = normalizePresenceLifecycle(lifecycle)
  return isKnownLifecycle(value) ? toneForLifecycle(value) : 'unknown'
}

/**
 * Compile-time exhaustive over the closed lifecycle set. Rulings recorded in the
 * slice log: `error` earns the `held` (attention) tone — it must be visually
 * distinct from both nominal `live` and honest-rest `dormant`, and the dot has no
 * danger tone (danger ink is reserved for named anomaly badges). `completed`,
 * `restartable`, and `retired` are honest rest → `dormant`. `reviving` is a live
 * awakening → `live`.
 */
function toneForLifecycle(lifecycle: AgentLifecycle): AgentPresenceTone {
  switch (lifecycle) {
    case 'resident':
    case 'reviving':
      return 'live'
    case 'paused':
    case 'error':
      return 'held'
    case 'dormant':
    case 'completed':
    case 'restartable':
    case 'retired':
      return 'dormant'
  }
}

function presenceReference(label: string, value: string | null | undefined): AgentPresenceReference | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '-') return null
  return { label, value: trimmed }
}

export function buildAgentPresence(input: AgentPresenceInput): AgentPresenceViewModel {
  const lifecycle = normalizePresenceLifecycle(input.lifecycle)
  const tone: AgentPresenceTone = presenceToneForLifecycle(input.lifecycle)

  const attribution = input.attribution
  // Attribution must name its referent: a served value that matches the current
  // model. `{actorId, at}` without a model value is testimony about nothing —
  // rendering it would fabricate provenance for whatever the client displays.
  const attributionMatches = !!attribution?.value?.trim() && attribution.value === input.model
  const observer = attributionMatches ? attribution?.actorId?.trim() || undefined : undefined
  const observedAt =
    attributionMatches && typeof attribution?.at === 'number' && Number.isFinite(attribution.at)
      ? attribution.at
      : undefined

  const references = [
    presenceReference('driver', input.driver),
    presenceReference('graph', input.graph),
  ].filter((item): item is AgentPresenceReference => !!item)
  const meta = [
    presenceReference('run', input.runId),
    presenceReference('session', input.sessionId),
    presenceReference('updated', input.updatedAt),
  ].filter((item): item is AgentPresenceReference => !!item)

  return {
    identity: {
      name: input.name,
      kindLine: firstNonBlankString(input.kindLine) ?? '',
    },
    state: {
      lifecycle,
      tone,
    },
    model: {
      value: input.model,
      ...(observedAt !== undefined ? { observedAt } : {}),
      ...(observer ? { observer } : {}),
      ...(input.seeded === true ? { seeded: true } : {}),
    },
    references,
    meta,
  }
}
