/**
 * The watermark and the brief — the Returning Observer's two instruments.
 *
 * This module is data-only: no DOM, stores, network, Lit, or backend imports
 * (the kinds purity fence also forbids the browser storage API here — the app owns
 * the side-effecting persistence; this file owns only the pure model + the advance).
 *
 * The WATERMARK is the client-side memory of where a reader left a conversation:
 * a per-(user, agent) mark of the last event seq read, the wall-clock instant it
 * was set, the memory high-water number, the tokens counted in the last brief, and
 * the model known at leave. It is persisted by the app in the browser's local
 * store; the pure helpers here derive its key and its advance.
 *
 * The BRIEF is what changed while you were away, composed from the events since
 * your cursor plus the world diff (the memory region against the watermark's
 * baseline). Its grammar is LAW (Folio 01, sheet 03):
 *
 *   anomalies      — failed turns and unanswered permissions, INDIVIDUALLY NAMED,
 *                    never counted, each carrying its affordance; the only danger.
 *   constitution   — model changes as chains A→C (intermediates kept only when the
 *                    chain returned home — that is itself the news), attribution carried.
 *   activity       — turns counted (the latest reply hands off "below"); the wheel's
 *                    moves; memory writes as a count plus the latest snippet.
 *   whisper        — token metrics with the Vincennes trend (never a past rendered naked).
 *
 * Tier order is fixed: anomaly → constitution → activity → whisper. Within a tier,
 * newest last. THE UNCHANGED IS UNWRITTEN: a tier with nothing to say emits no line,
 * and a brief with no lines is not eventful — the render layer draws no brief block
 * at all, only the watermark rule saying "quiet since".
 */

import { firstNonBlankString, numberAt, stringAt } from './json.js'

// ————————————————————————————————— the watermark —————————————————————————————————

export interface AgentWatermark {
  /** The activeSessionId when you left — a change on return means a new conversation began. */
  readonly sessionId: string | null
  /** The highest event seq you had read. Events with a greater seq are the brief's matter. */
  readonly cursor: number
  /** Wall-clock ms the mark was last set — the "you left here · HH:MM" instant. */
  readonly readAt: number
  /** The highest memory number written when you left; memories numbered above it are new. */
  readonly memoryHigh: number | null
  /** Tokens counted in the last brief — the baseline the next whisper's trend reads against. */
  readonly tokens: number | null
  /** The model known at leave — the chain baseline, so a change reads A→C, not a bare C. */
  readonly model: string | null
}

/** The storage key: one mark per user per agent (the NavHint pattern). */
export function watermarkStorageKey(userId: string, agentId: string): string {
  return `gh-watermark:${userId.trim() || 'anon'}:${agentId.trim()}`
}

export interface WatermarkAdvance {
  readonly cursor: number
  readonly readAt: number
  readonly sessionId?: string | null
  readonly memoryHigh?: number | null
  readonly tokens?: number | null
  readonly model?: string | null
}

/**
 * Advance a watermark as the observer reads. The cursor and memory high-water only
 * ever move FORWARD (a poll that arrives out of order never rewinds your place);
 * the session id, tokens baseline, and model snapshot take the fresh reading.
 */
export function advanceWatermark(previous: AgentWatermark | null, next: WatermarkAdvance): AgentWatermark {
  return {
    sessionId: next.sessionId ?? previous?.sessionId ?? null,
    cursor: Math.max(previous?.cursor ?? -1, next.cursor),
    readAt: next.readAt,
    memoryHigh: highWater(previous?.memoryHigh ?? null, next.memoryHigh ?? null),
    tokens: next.tokens ?? previous?.tokens ?? null,
    model: firstNonBlankString(next.model, previous?.model),
  }
}

function highWater(previous: number | null, next: number | null): number | null {
  if (previous === null) return next
  if (next === null) return previous
  return Math.max(previous, next)
}

// ————————————————————————————————— the brief —————————————————————————————————

export type TurnoverTier = 'anomaly' | 'constitution' | 'activity' | 'whisper'
export type TurnoverTrend = 'up' | 'down' | 'flat'

/**
 * The procedure an alert arrives with. Modelled in full so the contract is captured
 * and tested even where the target surface is a later slice; the render layer emits
 * the button only for intents whose surface exists today (the ink clause on chrome).
 */
export interface TurnoverAffordance {
  readonly label: string
  readonly intent: 'reply' | 'trace' | 'ledger' | 'permission'
  readonly ref?: string
}

export type TurnoverLine =
  | {
      readonly tier: 'anomaly'
      readonly variant: 'permission'
      readonly id: string
      readonly lead: string
      readonly detail: string
      readonly affordance: TurnoverAffordance
      readonly at: number
    }
  | {
      readonly tier: 'anomaly'
      readonly variant: 'failedTurn'
      readonly id: string
      readonly lead: string
      readonly detail: string
      readonly affordance: TurnoverAffordance
      readonly at: number
    }
  | {
      readonly tier: 'constitution'
      readonly variant: 'modelChain'
      readonly id: string
      readonly chain: readonly string[]
      readonly attribution: string | null
      readonly at: number
    }
  | {
      readonly tier: 'activity'
      readonly variant: 'newConversation'
      readonly id: string
      readonly text: string
      readonly at: number
    }
  | {
      readonly tier: 'activity'
      readonly variant: 'turns'
      readonly id: string
      readonly count: number
      readonly handoff: string
      readonly affordance: TurnoverAffordance | null
      readonly at: number
    }
  | {
      readonly tier: 'activity'
      readonly variant: 'floor'
      readonly id: string
      readonly text: string
      readonly at: number
    }
  | {
      readonly tier: 'activity'
      readonly variant: 'memory'
      readonly id: string
      readonly count: number
      readonly latestSnippet: string | null
      readonly affordance: TurnoverAffordance
      readonly at: number
    }
  | {
      readonly tier: 'whisper'
      readonly variant: 'tokens'
      readonly id: string
      readonly tokens: number
      readonly trend: TurnoverTrend | null
      readonly previous: number | null
    }

export interface TurnoverBrief {
  readonly leftAt: number
  readonly until: number
  /** True when the active conversation changed while you were away. */
  readonly sessionBoundary: boolean
  readonly lines: readonly TurnoverLine[]
  /** lines.length > 0 — the render layer draws no brief block when this is false. */
  readonly eventful: boolean
}

export interface TurnoverEvent {
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload?: unknown
}

export interface TurnoverMemoryEntry {
  readonly number: number
  readonly content: string
}

export interface TurnoverBriefInput {
  /** The events with seq strictly greater than the watermark cursor (the app slices them). */
  readonly events: readonly TurnoverEvent[]
  /** The reader's own client id — so the wheel line names others, not you. */
  readonly selfClientId: string
  /** "you left here" — the watermark's readAt (or entry time on a first visit). */
  readonly leftAt: number
  readonly now: number
  /** The world's memory region against the watermark baseline (the world diff). */
  readonly memory?: {
    readonly remembered: readonly TurnoverMemoryEntry[]
    readonly baselineHigh: number | null
  }
  /** Tokens counted in the last brief — the whisper's trend baseline. */
  readonly previousWatchTokens?: number | null
  /** The activeSessionId at leave (from the watermark). */
  readonly watermarkSessionId?: string | null
  /** The activeSessionId now (from the world/events envelope). */
  readonly activeSessionId?: string | null
  /** The model known at leave — the chain baseline. */
  readonly modelBaseline?: string | null
  /** Present-tense unanswered permissions/pauses in the world control region. */
  readonly pendingApprovals?: number
  /**
   * Named details for present-tense pending permissions (from
   * `control.permissionRequests`, outcome-less entries). When present, each is
   * briefed individually; the bare count renders only when no name exists.
   */
  readonly pendingApprovalDetails?: readonly {
    readonly callId: string
    readonly tool?: string | null
    readonly sinceTs?: number | null
  }[]
}

const DONE_STATES = new Set(['done', 'completed', 'complete', 'ok', 'success'])
const FAILED_TURN_TYPES = new Set(['conversation.turn.agent.error', 'conversation.turn.agent.truncated'])
const TREND_BAND = 0.1

const TIER_RANK: Record<TurnoverTier, number> = { anomaly: 0, constitution: 1, activity: 2, whisper: 3 }

function shortTurn(turnId: string | null): string {
  if (!turnId) return 'a turn'
  const tail = turnId.split(/[:_-]/).pop() ?? turnId
  return `turn ${tail.slice(0, 6)}`
}

function isPermissionEvent(type: string): boolean {
  return type.startsWith('control.permission.')
}

function permissionKey(payload: unknown): string | null {
  return firstNonBlankString(
    stringAt(payload, ['callId']),
    stringAt(payload, ['requestId']),
    stringAt(payload, ['toolCallId']),
    stringAt(payload, ['id']),
  )
}

function isPermissionResolution(type: string): boolean {
  return /\.(resolved|answered|granted|denied|approved|rejected|responded)$/.test(type)
}

function formatDuration(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60_000)
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h`
}

function anomalyLines(input: TurnoverBriefInput): TurnoverLine[] {
  const lines: TurnoverLine[] = []

  // Unanswered permissions — a request with no matching resolution while you were away.
  const requests = new Map<string, TurnoverEvent>()
  const resolved = new Set<string>()
  for (const event of input.events) {
    if (!isPermissionEvent(event.type)) continue
    const key = permissionKey(event.payload)
    if (!key) continue
    if (isPermissionResolution(event.type)) resolved.add(key)
    else requests.set(key, event)
  }
  for (const [key, event] of requests) {
    if (resolved.has(key)) continue
    const call = firstNonBlankString(
      stringAt(event.payload, ['tool']),
      stringAt(event.payload, ['toolName']),
      stringAt(event.payload, ['capability']),
      stringAt(event.payload, ['call']),
    )
    const target = firstNonBlankString(stringAt(event.payload, ['graphId']), stringAt(event.payload, ['target']))
    const detail = `${[call, target].filter(Boolean).join(' → ') || 'a call'}, asked while you were away`
    lines.push({
      tier: 'anomaly',
      variant: 'permission',
      id: `perm:${key}`,
      lead: `permission unanswered for ${formatDuration(input.now - event.ts)}:`,
      detail,
      affordance: { label: 'answer now', intent: 'permission', ref: key },
      at: event.ts,
    })
  }

  // Failed turns — named one by one, never rolled into a count.
  for (const event of input.events) {
    const failed =
      FAILED_TURN_TYPES.has(event.type) ||
      (event.type === 'conversation.turn.completed' && !DONE_STATES.has(stringAt(event.payload, ['state'])?.trim() ?? 'done'))
    if (!failed) continue
    const turnId = firstNonBlankString(stringAt(event.payload, ['turnId']))
    const reason = firstNonBlankString(
      stringAt(event.payload, ['error']),
      stringAt(event.payload, ['reason']),
      stringAt(event.payload, ['state']),
    )
    lines.push({
      tier: 'anomaly',
      variant: 'failedTurn',
      id: `fail:${turnId ?? event.seq}`,
      lead: '1 turn failed:',
      detail: `${reason ?? 'the turn did not complete'} (${shortTurn(turnId)})`,
      affordance: { label: 'open the trace', intent: 'trace', ref: turnId ?? undefined },
      at: event.ts,
    })
  }

  // Present-tense pending permissions the event span didn't name. Anomalies are
  // named one by one whenever a name exists (control.permissionRequests carries
  // callId/tool since W1); the bare count is the last resort, not the default.
  const named = new Set(
    lines.filter((line) => line.tier === 'anomaly' && line.variant === 'permission').map((line) => line.id),
  )
  const details = (input.pendingApprovalDetails ?? []).filter((entry) => !named.has(`perm:${entry.callId}`))
  for (const entry of details) {
    lines.push({
      tier: 'anomaly',
      variant: 'permission',
      id: `perm:${entry.callId}`,
      lead:
        typeof entry.sinceTs === 'number'
          ? `permission unanswered for ${formatDuration(input.now - entry.sinceTs)}:`
          : 'permission unanswered:',
      detail: `${entry.tool?.trim() || 'a gated call'}, waiting on your word`,
      affordance: { label: 'answer now', intent: 'permission', ref: entry.callId },
      at: entry.sinceTs ?? input.leftAt,
    })
  }
  const namedCount = lines.filter((line) => line.tier === 'anomaly' && line.variant === 'permission').length
  const unnamed = Math.max(0, (input.pendingApprovals ?? 0) - namedCount)
  if (unnamed > 0) {
    lines.push({
      tier: 'anomaly',
      variant: 'permission',
      id: 'perm:pending',
      lead: `${unnamed} unanswered permission${unnamed === 1 ? '' : 's'} waiting:`,
      detail: 'a call is held, waiting on your word',
      affordance: { label: 'answer now', intent: 'permission' },
      at: input.leftAt,
    })
  }

  return lines
}

function dedupeConsecutive(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) if (out[out.length - 1] !== value) out.push(value)
  return out
}

function constitutionLines(input: TurnoverBriefInput): TurnoverLine[] {
  const changes = input.events
    .filter((event) => event.type === 'agent.model.changed')
    .sort((left, right) => left.seq - right.seq)
  if (!changes.length) return []

  const changed = changes
    .map((event) => firstNonBlankString(stringAt(event.payload, ['model']), stringAt(event.payload, ['value']), stringAt(event.payload, ['to'])))
    .filter((value): value is string => !!value)
  if (!changed.length) return []

  const baseline = firstNonBlankString(input.modelBaseline)
  const nodes = dedupeConsecutive([...(baseline ? [baseline] : []), ...changed])
  if (nodes.length < 2 && !baseline) {
    // A single change with no baseline: show it as a one-step chain into the new model.
    nodes.unshift('…')
  }
  if (nodes.length < 2) return []

  const returnedHome = nodes[0] === nodes[nodes.length - 1]
  const chain = returnedHome ? nodes : [nodes[0], nodes[nodes.length - 1]]

  const actors = dedupeConsecutive(
    changes
      .map((event) => firstNonBlankString(stringAt(event.payload, ['actorId']), stringAt(event.payload, ['authorId'])))
      .filter((value): value is string => !!value),
  )
  const attribution = actors.length ? `by ${actors.length > 1 ? actors.slice(0, -1).join(', ') + ', then ' + actors[actors.length - 1] : actors[0]}` : null

  return [
    {
      tier: 'constitution',
      variant: 'modelChain',
      id: 'model-chain',
      chain,
      attribution,
      at: changes[changes.length - 1].ts,
    },
  ]
}

function floorLine(input: TurnoverBriefInput): TurnoverLine | null {
  const moves = input.events
    .filter((event) => event.type === 'control.driver-claimed' || event.type === 'control.driver-released')
    .sort((left, right) => left.seq - right.seq)
  if (!moves.length) return null

  const claim = moves.find((event) => event.type === 'control.driver-claimed')
  const who = claim
    ? firstNonBlankString(
        stringAt(claim.payload, ['observer']),
        stringAt(claim.payload, ['authorId']),
        stringAt(claim.payload, ['driverLease', 'clientId']),
        stringAt(claim.payload, ['clientId']),
      ) ?? 'someone'
    : 'someone'
  const last = moves[moves.length - 1]
  const nowOpen = last.type === 'control.driver-released'
  const text = nowOpen
    ? `the wheel: ${who} took it, then released — the floor is open`
    : `the wheel: ${who} has the controls`
  return { tier: 'activity', variant: 'floor', id: 'floor', text, at: last.ts }
}

function activityLines(input: TurnoverBriefInput): TurnoverLine[] {
  const lines: TurnoverLine[] = []

  if (
    input.watermarkSessionId &&
    input.activeSessionId &&
    input.watermarkSessionId !== input.activeSessionId
  ) {
    lines.push({
      tier: 'activity',
      variant: 'newConversation',
      id: 'new-conversation',
      text: 'a new conversation began while you were away',
      at: input.leftAt,
    })
  }

  const completed = input.events.filter(
    (event) => event.type === 'conversation.turn.completed' && DONE_STATES.has(stringAt(event.payload, ['state'])?.trim() ?? 'done'),
  )
  if (completed.length) {
    const latest = completed.reduce((a, b) => (a.seq >= b.seq ? a : b))
    const replyId = firstNonBlankString(stringAt(latest.payload, ['responseMessageId']))
    lines.push({
      tier: 'activity',
      variant: 'turns',
      id: 'turns',
      count: completed.length,
      handoff: completed.length === 1 ? '— its reply is the next thing below' : '— latest reply waits below',
      affordance: replyId ? { label: 'read it', intent: 'reply', ref: replyId } : null,
      at: latest.ts,
    })
  }

  const floor = floorLine(input)
  if (floor) lines.push(floor)

  const memory = memoryLine(input)
  if (memory) lines.push(memory)

  return lines
}

function memoryLine(input: TurnoverBriefInput): TurnoverLine | null {
  const memory = input.memory
  if (!memory) return null
  // A first visit has no baseline — we did not witness a "before", so we claim nothing.
  if (memory.baselineHigh === null) return null
  const fresh = memory.remembered
    .filter((entry) => Number.isFinite(entry.number) && entry.number > (memory.baselineHigh as number))
    .sort((a, b) => a.number - b.number)
  if (!fresh.length) return null
  const latest = fresh[fresh.length - 1]
  const snippet = latest.content.trim()
  return {
    tier: 'activity',
    variant: 'memory',
    id: 'memory',
    count: fresh.length,
    latestSnippet: snippet ? snippet.slice(0, 120) : null,
    affordance: { label: 'open the ledger', intent: 'ledger' },
    at: input.now,
  }
}

function whisperLine(input: TurnoverBriefInput): TurnoverLine | null {
  const tokens = input.events
    .filter((event) => event.type === 'conversation.turn.completed')
    .reduce((sum, event) => sum + (numberAt(event.payload, ['tokens']) ?? 0), 0)
  if (tokens <= 0) return null
  const previous = typeof input.previousWatchTokens === 'number' && input.previousWatchTokens > 0 ? input.previousWatchTokens : null
  // Vincennes rule: a number with a past never renders naked — and on the first
  // watch there is no past, so the whisper stays unwritten until a baseline exists.
  if (previous === null) return null
  const delta = (tokens - previous) / previous
  const trend: TurnoverTrend = delta > TREND_BAND ? 'up' : delta < -TREND_BAND ? 'down' : 'flat'
  return { tier: 'whisper', variant: 'tokens', id: 'tokens', tokens, trend, previous }
}

export function buildTurnoverBrief(input: TurnoverBriefInput): TurnoverBrief {
  const lines = [...anomalyLines(input), ...constitutionLines(input), ...activityLines(input)]
  const whisper = whisperLine(input)
  if (whisper) lines.push(whisper)

  // Tier order is fixed; within a tier, newest last. A stable sort keeps the
  // per-tier build order for equal timestamps.
  const ordered = lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const tier = TIER_RANK[a.line.tier] - TIER_RANK[b.line.tier]
      if (tier !== 0) return tier
      const at = ('at' in a.line ? a.line.at : Number.MAX_SAFE_INTEGER) - ('at' in b.line ? b.line.at : Number.MAX_SAFE_INTEGER)
      if (at !== 0) return at
      return a.index - b.index
    })
    .map((entry) => entry.line)

  const until = input.events.reduce((max, event) => Math.max(max, event.ts), input.leftAt)

  return {
    leftAt: input.leftAt,
    until,
    sessionBoundary: !!input.watermarkSessionId && !!input.activeSessionId && input.watermarkSessionId !== input.activeSessionId,
    lines: ordered,
    eventful: ordered.length > 0,
  }
}
