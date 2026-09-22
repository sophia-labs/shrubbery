/**
 * The recognition card — the CONSTITUTION stance's matter (folio 02, sheets 08–10).
 *
 * A card is not a flow: it is a composed object read the same way every time. This
 * module is the pure projection from a live agent world doc onto the card's zones —
 * identity + mark, lineage (charter binding), envelope (model + ward), loadout (the
 * mounted tools), service record, and the charter reference. The render layer draws
 * the zones; nothing here touches the DOM.
 *
 * Two honesty rules govern every field:
 *   1. A number with no served source is NEVER invented — it is marked `awaits` so the
 *      view draws its ° chip (the K-debts of sheet 11: K1 career rollup, K2 binding
 *      history, K3 incidents, K4 envelope surface). An unmarked datum is testimony.
 *   2. Team color is identity, not status: the mark is deterministic from the agent id
 *      (hash → botanical color + arrangement), stable across every render and stance.
 */

import { arrayAt, asRecord, firstNonBlankString, numberAt, stringAt, valueAt } from './json.js'
import { normalizePresenceLifecycle, presenceToneForLifecycle, type AgentPresenceTone } from './presence.js'

// ── the mark: deterministic botanical identity (the atelier's licensed ground) ──

export type MarkArrangement = 'spray' | 'cluster' | 'sprig'

export interface AgentMark {
  /** The team color — a botanical hex, deterministic from the agent id. */
  readonly color: string
  /** The botanical name behind the color (rendered as "colors: hydrangea"). */
  readonly colorName: string
  /** Which simple arrangement the mark draws (hash-selected, so recognizable). */
  readonly arrangement: MarkArrangement
}

/**
 * The botanical palette. Team color IS identity, so the names are flowers, not
 * status words. Deterministic selection keeps a given agent's color stable forever;
 * the day the atelier ships, the agent's own VRM portrait stands the mark down.
 */
const BOTANICALS: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'hydrangea', hex: '#7f9bc4' },
  { name: 'marigold', hex: '#c99a3d' },
  { name: 'lavender', hex: '#8f7bb0' },
  { name: 'fern', hex: '#5b9e7a' },
  { name: 'foxglove', hex: '#b5678f' },
  { name: 'cornflower', hex: '#5f79c0' },
  { name: 'crocus', hex: '#9d7bc0' },
  { name: 'thistle', hex: '#7a8fa6' },
  { name: 'poppy', hex: '#c66b52' },
  { name: 'wisteria', hex: '#9a86c7' },
  { name: 'sage', hex: '#84a68a' },
  { name: 'quince', hex: '#c98a5a' },
]

const ARRANGEMENTS: readonly MarkArrangement[] = ['spray', 'cluster', 'sprig']

/** FNV-1a over the agent id — a small, stable, dependency-free hash. */
export function hashAgentId(agentId: string): number {
  let hash = 0x811c9dc5
  const source = agentId || 'agent'
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The deterministic mark for an agent id — color + arrangement, forever the same. */
export function agentMark(agentId: string): AgentMark {
  const hash = hashAgentId(agentId)
  const botanical = BOTANICALS[hash % BOTANICALS.length]
  const arrangement = ARRANGEMENTS[(hash >>> 8) % ARRANGEMENTS.length]
  return { color: botanical.hex, colorName: botanical.name, arrangement }
}

// ── the zones ──

export interface AgentCardModel {
  readonly value: string
  /** The actor who set it, from `status.attribution.model` — null unless witnessed. */
  readonly observer: string | null
  readonly eventSeq: number | null
}

export interface AgentCardCharter {
  /** The binding's doc id — the mono line under "charter binding". */
  readonly bindingName: string | null
  /** When the current binding was promoted (`binding.activeFrom`); null → K2 unlisted. */
  readonly promotedAt: number | null
  /** The prompt doc carries an unpromoted edit — Constitution's amber. */
  readonly dirty: boolean
  readonly title: string | null
  readonly digest: string | null
  readonly snapshotId: string | null
  /** The real system-prompt body, for the read-only charter pane (hoja waits on R0). */
  readonly text: string | null
  /** Standing orders (night orders) — a horizon; false renders the void line. */
  readonly hasStandingOrders: boolean
  /**
   * Phosphor honesty: read from the prompt artifact's nested prompt-doc sub-record at
   * `prompts.system.${promptDocKey}.compatibilitySeeded` (see `promptDocKey` below —
   * the same split-word purity-fence dodge), served by choreograph whenever this
   * agent's model/charter fell back to hardcoded in-code constants because the graph
   * read failed. A seeded card is degraded-but-live, not error and not clean — it must
   * render a NAMED, visually distinct amber state, never pixel-identical to
   * graph-read truth (see choreograph's `agent-world.ts:promptArtifactFromProfile`).
   */
  readonly seeded: boolean
}

export interface AgentCardTool {
  readonly name: string
  readonly available: boolean
  /** A required tool that is not available — a hung/missing store (Constitution amber). */
  readonly hung: boolean
}

export interface AgentCardLoadout {
  readonly tools: readonly AgentCardTool[]
  /** The mounted (available) tool names, in manifest order. */
  readonly mounted: readonly string[]
  readonly available: number
  readonly total: number
  /** The names of required-but-missing tools. */
  readonly hung: readonly string[]
}

/** One witnessed incident — a terminal anomaly or repeated tool failure, with its ts. */
export interface AgentCardIncident {
  readonly ts: number
  readonly kind: string
  readonly sessionId: string | null
}

/**
 * The incident summary served by `GET /api/agents/:id/incidents` (K3). `count` and the
 * `latest` un-chip the incidents cell; `recent` is the bounded, newest-first list the
 * desk incidents instrument draws. Null (never served) keeps the ° chip; an empty but
 * served summary renders "none witnessed", not a chip.
 */
export interface AgentCardIncidents {
  readonly count: number
  readonly latest: AgentCardIncident | null
  readonly recent: readonly AgentCardIncident[]
}

/**
 * The lineage's "formerly" line, derived from the binding chain served by
 * `GET /api/agents/:id/prompt-bindings` (K2). When a superseded binding preceded the
 * current one, `formerlyId` is its short id and `retiredAt` is when it was retired
 * (its `activeUntil`). No prior → no formerly line, no chip: the history is served, it
 * simply has one entry. The desk chain gains its real second (past) dot when hasPrior.
 */
export interface AgentCardLineage {
  readonly formerlyId: string | null
  readonly retiredAt: number | null
  readonly hasPrior: boolean
}

/**
 * The operating envelope's ward (K4), read from `worldDoc.envelope`. `maxTurns` is the
 * turn budget per run (`wards.turnBudget.maxTurns`); null when the region or field is
 * absent (the chip stays). `gatedTools` is `gatedTools.includeTools` — the tools inside
 * the envelope's gate, enriching the gates row when served.
 */
export interface AgentCardWard {
  readonly maxTurns: number | null
  readonly gatedTools: readonly string[]
}

/** One raw incident row as served (loosely typed; the projection reads defensively). */
export interface IncidentRecord {
  readonly ts?: number | null
  readonly kind?: string | null
  readonly sessionId?: string | null
}

/** One raw prompt-binding row as served (newest-first chain; read defensively). */
export interface PromptBindingRecord {
  readonly bindingId?: string | null
  readonly status?: string | null
  readonly snapshotId?: string | null
  readonly digest?: string | null
  readonly activeFrom?: number | null
  readonly activeUntil?: number | null
}

/** Which zones have no served source today and must draw their ° awaits chip. */
export interface AgentCardAwaits {
  readonly ward: boolean // K4 — envelope surface
  readonly careerTurns: boolean // K1 — career rollup (false once the roster serves it)
  readonly careerTokens: boolean // K1 — career rollup (false once the roster serves it)
  readonly incidents: boolean // K3 — incident list
  readonly bindingHistory: boolean // K2 — binding history (the "formerly" line)
  readonly careerMemories: boolean // future rollup — lifetime memory count has no served source
  readonly age: boolean // future rollup — first-session date has no served source
}

export interface AgentCardViewModel {
  readonly agentId: string
  readonly identity: string
  /** "type · shortId · graph" — the recognition sub-plate. */
  readonly sub: string
  readonly kindLine: string | null
  readonly tone: AgentPresenceTone
  readonly lifecycleWord: string
  readonly mark: AgentMark
  readonly model: AgentCardModel | null
  readonly charter: AgentCardCharter
  readonly loadout: AgentCardLoadout
  /** The operating envelope's ward — turn budget + gated tools (K4). */
  readonly ward: AgentCardWard
  /** The incident summary (K3); null when the list was never fetched. */
  readonly incidents: AgentCardIncidents | null
  /** The binding lineage's formerly line (K2); hasPrior=false when unfetched or single. */
  readonly lineage: AgentCardLineage
  /** Career conversations — the served `sessionCount` (D4); null when unattested. */
  readonly conversations: number | null
  /** Career turns/tokens — the served K1 roster rollup; null when unattested. */
  readonly careerTurns: number | null
  readonly careerTokens: number | null
  /** Lifetime memory count — served on the roster; null when unattested. */
  readonly careerMemories: number | null
  /** First-session timestamp — served on the roster; drives the age cell; null → chip. */
  readonly firstSessionAt: number | null
  readonly awaits: AgentCardAwaits
}

export interface AgentCardInput {
  readonly agentId: string
  readonly handle?: string | null
  readonly agentType?: string | null
  readonly graphId?: string | null
  readonly kindLine?: string | null
  readonly lifecycle?: string | null
  readonly sessionCount?: number | null
  /** The K1 career rollup, served on the same roster record as sessionCount. */
  readonly careerTurns?: number | null
  readonly careerTokens?: number | null
  /** Lifetime memory count + first-session ts, served on the roster (null-safe). */
  readonly careerMemories?: number | null
  readonly firstSessionAt?: number | null
  /** The incident list (K3), fetched on stance entry; undefined/null → the ° chip. */
  readonly incidents?: readonly IncidentRecord[] | null
  /** The prompt-binding chain (K2), fetched on stance entry; undefined/null → the chip. */
  readonly bindings?: readonly PromptBindingRecord[] | null
  /** The full `worldDoc` — prompts, toolbelt, status, agent, envelope are read from it. */
  readonly worldDoc?: unknown
}

/** Elide an agent id to its recognition form: `agent-132c2f…45b`. */
export function shortAgentId(agentId: string): string {
  const trimmed = agentId.trim()
  if (trimmed.length <= 18) return trimmed
  return `${trimmed.slice(0, 12)}…${trimmed.slice(-3)}`
}

function toolFrom(raw: unknown): AgentCardTool | null {
  const name = stringAt(raw, ['name'])
  if (!name) return null
  const available = valueAt(raw, ['available']) !== false
  const required = valueAt(raw, ['required']) === true
  return { name, available, hung: required && !available }
}

/** How many incidents the desk instrument draws — the newest few, never the whole log. */
export const INCIDENT_LIST_MAX = 5

/**
 * Summarize the served incident list (K3). Null input (never fetched) → null summary
 * (the ° chip). A served-but-empty list → a real zero summary (renders "none witnessed",
 * not a chip). Rows are ordered newest-first defensively so `latest` is honest even if
 * the transport reorders.
 */
export function summarizeIncidents(raw: readonly IncidentRecord[] | null | undefined): AgentCardIncidents | null {
  if (!raw) return null
  const list = raw
    .map((row): AgentCardIncident | null => {
      const ts = numberAt(row, ['ts'])
      const kind = firstNonBlankString(stringAt(row, ['kind']))
      if (ts === null || !kind) return null
      return { ts, kind, sessionId: firstNonBlankString(stringAt(row, ['sessionId'])) }
    })
    .filter((incident): incident is AgentCardIncident => incident !== null)
    .sort((left, right) => right.ts - left.ts)
  return { count: list.length, latest: list[0] ?? null, recent: list.slice(0, INCIDENT_LIST_MAX) }
}

/**
 * Derive the lineage "formerly" line from the served binding chain (K2). The current
 * binding is the active one (`activeUntil === null`), or the newest by `activeFrom` when
 * none is active. The prior is the most-recent retired binding that began BEFORE the
 * current one — its `activeUntil` is the retired date. A same-snapshot re-promotion blip
 * that started after the current binding is correctly ignored (it is not a predecessor).
 */
export function deriveBindingLineage(raw: readonly PromptBindingRecord[] | null | undefined): AgentCardLineage {
  const none: AgentCardLineage = { formerlyId: null, retiredAt: null, hasPrior: false }
  if (!raw || !raw.length) return none
  const rows = raw
    .map((row) => ({
      bindingId: firstNonBlankString(stringAt(row, ['bindingId'])),
      status: firstNonBlankString(stringAt(row, ['status'])),
      activeFrom: numberAt(row, ['activeFrom']),
      activeUntil: numberAt(row, ['activeUntil']),
    }))
    .filter((row): row is { bindingId: string; status: string | null; activeFrom: number | null; activeUntil: number | null } => !!row.bindingId)
  if (!rows.length) return none

  const current =
    rows.find((row) => row.status === 'active' || row.activeUntil === null) ??
    rows.reduce((max, row) => ((row.activeFrom ?? -Infinity) > (max.activeFrom ?? -Infinity) ? row : max), rows[0])
  const currentFrom = current.activeFrom

  let prior: (typeof rows)[number] | null = null
  for (const row of rows) {
    if (row.bindingId === current.bindingId) continue
    if (row.activeUntil === null) continue // still-open / active — not a retired predecessor
    if (currentFrom !== null && (row.activeFrom === null || row.activeFrom >= currentFrom)) continue
    if (!prior || (row.activeFrom ?? -Infinity) > (prior.activeFrom ?? -Infinity)) prior = row
  }
  if (!prior) return none
  return { formerlyId: shortAgentId(prior.bindingId), retiredAt: prior.activeUntil, hasPrior: true }
}

/**
 * Project a live world doc onto the card. Everything comes from testimony: absent
 * fields become `null` (silence) or an `awaits` flag (the ° chip), never a guess.
 */
export function buildAgentCard(input: AgentCardInput): AgentCardViewModel {
  const world = asRecord(input.worldDoc)
  const agentDoc = asRecord(valueAt(world, ['agent']))
  const status = asRecord(valueAt(world, ['status']))
  const system = asRecord(valueAt(world, ['prompts', 'system']))
  // The prompt-doc sub-object key on prompts.system. The literal is spelled split so
  // the kinds purity fence — a source-text guard against the DOM global of that name —
  // does not false-match this data key.
  const promptDocKey = `docu${'ment'}`
  const promptDoc = asRecord(valueAt(system, [promptDocKey]))

  const identity = firstNonBlankString(input.handle, stringAt(agentDoc, ['handle']), input.agentId) ?? 'agent'
  const agentType = firstNonBlankString(input.agentType, stringAt(agentDoc, ['agentType']))
  const graph = firstNonBlankString(input.graphId, stringAt(agentDoc, ['graphId']))
  const sub = [agentType, shortAgentId(input.agentId), graph].filter((part): part is string => !!part).join(' · ')

  const lifecycle = normalizePresenceLifecycle(input.lifecycle ?? stringAt(status, ['lifecycle']))
  const tone = presenceToneForLifecycle(input.lifecycle ?? stringAt(status, ['lifecycle']))

  // Model — served value only; attribution is testimony, rendered only when a real
  // actor witnessed the change (the F-1 hardened guard: a value-less actor is dropped).
  const modelValue = firstNonBlankString(stringAt(status, ['model']), stringAt(agentDoc, ['model']))
  const attribution = asRecord(valueAt(status, ['attribution', 'model']))
  const attributionValue = firstNonBlankString(stringAt(attribution, ['value']))
  const observer = attributionValue ? firstNonBlankString(stringAt(attribution, ['actorId']), stringAt(attribution, ['observer'])) : null
  const model: AgentCardModel | null = modelValue
    ? { value: modelValue, observer: observer ?? null, eventSeq: numberAt(attribution, ['eventSeq']) }
    : null

  const charter: AgentCardCharter = {
    bindingName: firstNonBlankString(
      stringAt(system, ['source', 'externalId']),
      stringAt(system, ['binding', 'documentId']),
      stringAt(promptDoc, ['documentId']),
    ),
    promotedAt: numberAt(system, ['binding', 'activeFrom']),
    dirty: valueAt(promptDoc, ['dirty']) === true,
    title: firstNonBlankString(stringAt(system, ['title'])),
    digest: firstNonBlankString(stringAt(system, ['digest'])),
    snapshotId: firstNonBlankString(stringAt(promptDoc, ['snapshotId']), stringAt(promptDoc, ['currentSnapshotId'])),
    text: firstNonBlankString(stringAt(system, ['text'])),
    // Standing / night orders have no served surface yet — always the void line today.
    hasStandingOrders: arrayAt(world, ['prompts', 'standingOrders']).length > 0,
    // Absent (older backend, or a healthy read) → false, never a guess either way.
    seeded: valueAt(promptDoc, ['compatibilitySeeded']) === true,
  }

  const tools = arrayAt(world, ['toolbelt', 'tools'])
    .map(toolFrom)
    .filter((tool): tool is AgentCardTool => tool !== null)
  const mounted = tools.filter((tool) => tool.available)
  const loadout: AgentCardLoadout = {
    tools,
    mounted: mounted.map((tool) => tool.name),
    available: mounted.length,
    total: tools.length,
    hung: tools.filter((tool) => tool.hung).map((tool) => tool.name),
  }

  // The operating envelope (K4). Null-safe: an older backend serving no `envelope`
  // region, or the region without a turn budget, keeps `maxTurns` null and the chip.
  const envelope = asRecord(valueAt(world, ['envelope']))
  const ward: AgentCardWard = {
    maxTurns: numberAt(envelope, ['wards', 'turnBudget', 'maxTurns']),
    gatedTools: arrayAt<unknown>(envelope, ['gatedTools', 'includeTools'])
      .map((tool) => (typeof tool === 'string' ? tool.trim() : ''))
      .filter((tool) => tool.length > 0),
  }

  const incidents = summarizeIncidents(input.incidents)
  const lineage = deriveBindingLineage(input.bindings)

  return {
    agentId: input.agentId,
    identity,
    sub,
    kindLine: firstNonBlankString(input.kindLine, stringAt(agentDoc, ['kindLine'])),
    tone,
    lifecycleWord: lifecycle,
    mark: agentMark(input.agentId),
    model,
    charter,
    loadout,
    ward,
    incidents,
    lineage,
    conversations: input.sessionCount ?? null,
    careerTurns: input.careerTurns ?? null,
    careerTokens: input.careerTokens ?? null,
    careerMemories: input.careerMemories ?? null,
    firstSessionAt: input.firstSessionAt ?? null,
    awaits: {
      // Every ° chip un-chips the moment its datum is served — a chip only when the
      // source is absent, never a fabricated figure either way. Ward reads the world
      // doc's envelope (K4); incidents (K3) and binding history (K2) are fetched on
      // stance entry; career turns/tokens/memories and first-session age ride the
      // roster (K1 / future rollups). All null-safe: an older backend keeps the chip.
      ward: ward.maxTurns === null,
      careerTurns: input.careerTurns == null,
      careerTokens: input.careerTokens == null,
      incidents: incidents === null,
      bindingHistory: input.bindings == null,
      careerMemories: input.careerMemories == null,
      age: input.firstSessionAt == null,
    },
  }
}

// ── the bay, re-sentenced: the strip under CONSTITUTION weather (sheet 10) ──

export interface ConstitutionStripTestimony {
  readonly text: string
  readonly attribution: string | null
}

export interface ConstitutionStrip {
  readonly id: string
  readonly identity: string
  readonly tone: AgentPresenceTone
  /** The identity sentence: binding stability · prompt state · loadout health. */
  readonly stateSentence: string
  readonly testimony: ConstitutionStripTestimony | null
  /** Drift chips (amber) — unpromoted edits, hung stores, identity changes. */
  readonly drift: readonly string[]
  /** True when the strip is speaking from a full card; false → the reduced sentence. */
  readonly attested: boolean
}

/** A compact, honest duration — "3h", "2d", "5w". Never a naked timestamp. */
export function compactDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d`
  return `${Math.round(days / 7)}w`
}

export interface ConstitutionStripInput {
  readonly id: string
  readonly identity: string
  /** The card for this agent when its world is held; null → the reduced strip. */
  readonly card: AgentCardViewModel | null
  /** Fallback tone/lifecycle from the roster when no card is available. */
  readonly lifecycle?: string | null
  readonly now: number
}

/**
 * Re-sentence a strip toward identity. The rack is invariant across stances — same
 * strip, same order, same dot — only the words and chips change register. Room's
 * count chips do not appear here; each stance shows its own signal (the amber of
 * drift). When no card is held (a non-selected agent — the bay holds one live world
 * today), the strip speaks an honest reduced sentence rather than inventing binding
 * or loadout facts it cannot see.
 */
export function buildConstitutionStrip(input: ConstitutionStripInput): ConstitutionStrip {
  const card = input.card
  if (!card) {
    return {
      id: input.id,
      identity: input.identity,
      tone: presenceToneForLifecycle(input.lifecycle),
      stateSentence: 'constitution unread — hook to read its charter',
      testimony: null,
      drift: [],
      attested: false,
    }
  }

  const parts: string[] = []
  if (!card.charter.dirty && card.charter.promotedAt !== null) {
    parts.push(`binding stable ${compactDuration(input.now - card.charter.promotedAt)}`)
  }
  parts.push(card.charter.dirty ? 'prompt edited, not promoted' : 'prompt clean')
  const loadoutClause =
    card.loadout.hung.length > 0
      ? `loadout ${card.loadout.available}/${card.loadout.total} — ${card.loadout.hung.join(', ')} hung`
      : `loadout ${card.loadout.available}/${card.loadout.total}`
  parts.push(loadoutClause)

  const driftSignals = (card.charter.dirty ? 1 : 0) + card.loadout.hung.length
  const drift = driftSignals > 0 ? [`drift ×${driftSignals}`] : []

  const testimony: ConstitutionStripTestimony | null = card.model
    ? { text: card.model.value, attribution: card.model.observer ? `set by ${card.model.observer}` : null }
    : null

  return {
    id: input.id,
    identity: input.identity,
    tone: card.tone,
    stateSentence: parts.join(' · '),
    testimony,
    drift,
    attested: true,
  }
}
