import { arrayAt, firstNonBlankString, numberAt, stringAt, valueAt } from './json.js'
import { buildTurnAccount, type TurnAccount } from './turn-account.js'

export interface RoomAuthor {
  readonly id: string
  readonly role: string
  readonly isSelf: boolean
}

export interface RoomMessage {
  readonly id: string
  readonly author: RoomAuthor
  readonly text: string
  readonly at: number
  readonly turnAccount?: TurnAccount
}

export type TurnActivityState = 'idle' | 'queued' | 'started' | 'running'

export interface TurnActivity {
  readonly state: TurnActivityState
  readonly since?: number
}

export interface RoomSpeechEvent {
  readonly seq?: number
  readonly ts: number
  readonly type: string
  readonly payload?: unknown
}

export interface RoomSpeechInput {
  readonly world?: unknown
  readonly messages?: readonly unknown[]
  readonly events?: readonly RoomSpeechEvent[]
  readonly selfAuthorId: string
}

export interface RoomSpeechViewModel {
  readonly messages: readonly RoomMessage[]
  readonly turnActivity: TurnActivity
}

interface NormalizedMessage {
  readonly message: Omit<RoomMessage, 'turnAccount'>
  readonly refs?: unknown
}

function normalizeMessage(value: unknown, selfAuthorId: string, fallbackAt?: number): NormalizedMessage | null {
  const id = firstNonBlankString(stringAt(value, ['id']), stringAt(value, ['messageId']))
  const authorId = firstNonBlankString(stringAt(value, ['authorId']), stringAt(value, ['author', 'id']))
  const role = firstNonBlankString(stringAt(value, ['role']), stringAt(value, ['author', 'role']))
  const text = stringAt(value, ['text'])
  const at =
    numberAt(value, ['createdAt']) ?? numberAt(value, ['at']) ?? numberAt(value, ['ts']) ?? numberAt(value, ['timestamp']) ?? fallbackAt
  const self = selfAuthorId.trim()

  if (!id || !authorId || !role || typeof text !== 'string' || !text.trim() || at === undefined) return null

  return {
    message: {
      id,
      author: {
        id: authorId,
        role,
        isSelf: !!self && authorId.trim() === self,
      },
      text,
      at,
    },
    refs: valueAt(value, ['refs']),
  }
}

function messageInputs(input: RoomSpeechInput): readonly { readonly value: unknown; readonly fallbackAt?: number }[] {
  const worldMessages = arrayAt(input.world, ['worldDoc', 'conversation', 'messages'])
  const directWorldMessages = arrayAt(input.world, ['conversation', 'messages'])
  const attestedMessages = input.messages ?? []
  const eventMessages = (input.events ?? [])
    .filter((event) => event.type === 'conversation.message.created')
    .map((event) => ({ value: valueAt(event.payload, ['message']), fallbackAt: event.ts }))

  return [
    ...worldMessages.map((value) => ({ value })),
    ...directWorldMessages.map((value) => ({ value })),
    ...attestedMessages.map((value) => ({ value })),
    ...eventMessages,
  ]
}

export function buildRoomMessages(input: RoomSpeechInput): readonly RoomMessage[] {
  const byId = new Map<string, NormalizedMessage>()

  for (const item of messageInputs(input)) {
    const normalized = normalizeMessage(item.value, input.selfAuthorId, item.fallbackAt)
    if (normalized) byId.set(normalized.message.id, normalized)
  }

  return [...byId.values()]
    .map((normalized) => accountForMessage(normalized, input.events ?? []))
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
}

function eventOrder(left: RoomSpeechEvent, right: RoomSpeechEvent): number {
  return left.ts - right.ts || Number(left.seq ?? 0) - Number(right.seq ?? 0)
}

function turnIdFromEvent(event: RoomSpeechEvent): string | null {
  return firstNonBlankString(stringAt(event.payload, ['turnId']), stringAt(event.payload, ['turn_id']))
}

function accountForMessage(normalized: NormalizedMessage, events: readonly RoomSpeechEvent[]): RoomMessage {
  const message = normalized.message
  if (message.author.role !== 'agent') return message
  return {
    ...message,
    turnAccount: buildTurnAccount(message.text, eventsForMessage(normalized, events)),
  }
}

function eventsForMessage(normalized: NormalizedMessage, events: readonly RoomSpeechEvent[]): readonly RoomSpeechEvent[] {
  const turnIds = turnIdsForMessage(normalized, events)
  if (!turnIds.size) return []

  return events.filter((event) => {
    const turnId = turnIdFromEvent(event)
    if (turnId && turnIds.has(turnId)) return true
    return stringAt(event.payload, ['responseMessageId']) === normalized.message.id
  })
}

function turnIdsForMessage(normalized: NormalizedMessage, events: readonly RoomSpeechEvent[]): ReadonlySet<string> {
  const turnIds = new Set<string>()

  for (const event of events) {
    if (event.type !== 'conversation.turn.completed') continue
    if (stringAt(event.payload, ['responseMessageId']) !== normalized.message.id) continue
    const turnId = turnIdFromEvent(event)
    if (turnId) turnIds.add(turnId)
  }

  const refs = stringSetFromRefs(normalized.refs)
  if (refs.size) {
    for (const event of events) {
      const turnId = turnIdFromEvent(event)
      if (turnId && refs.has(turnId)) turnIds.add(turnId)
    }
  }

  return turnIds
}

function stringSetFromRefs(value: unknown, seen = new Set<unknown>()): ReadonlySet<string> {
  const strings = new Set<string>()
  collectStrings(value, strings, seen)
  return strings
}

function collectStrings(value: unknown, strings: Set<string>, seen: Set<unknown>): void {
  if (typeof value === 'string') {
    if (value.trim()) strings.add(value.trim())
    return
  }

  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings, seen)
    return
  }

  for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, strings, seen)
}

function isTerminalTurnEvent(event: RoomSpeechEvent): boolean {
  if (event.type === 'conversation.turn.completed') return true
  if (event.type === 'conversation.turn.agent.error' || event.type === 'conversation.turn.agent.truncated') return true
  if (event.type !== 'conversation.turn.sandbox.terminal') return false
  const state = firstNonBlankString(stringAt(event.payload, ['state']))
  return !state || ['completed', 'complete', 'done', 'failed', 'error', 'cancelled', 'canceled', 'terminal'].includes(state)
}

export function buildTurnActivity(events: readonly RoomSpeechEvent[] = []): TurnActivity {
  const turns = new Map<string, TurnActivity>()

  for (const event of [...events].sort(eventOrder)) {
    const turnId = turnIdFromEvent(event)
    if (!turnId) continue

    if (event.type === 'conversation.turn.queued') {
      turns.set(turnId, { state: 'queued', since: event.ts })
      continue
    }

    if (event.type === 'conversation.turn.started') {
      const previous = turns.get(turnId)
      turns.set(turnId, { state: 'started', since: previous?.since ?? numberAt(event.payload, ['queuedAt']) ?? event.ts })
      continue
    }

    if (event.type === 'conversation.turn.running') {
      const previous = turns.get(turnId)
      turns.set(turnId, { state: 'running', since: previous?.since ?? numberAt(event.payload, ['queuedAt']) ?? event.ts })
      continue
    }

    if (isTerminalTurnEvent(event)) turns.delete(turnId)
  }

  const active = [...turns.values()].sort((left, right) => (left.since ?? 0) - (right.since ?? 0)).at(-1)
  return active ?? { state: 'idle' }
}

export function buildRoomSpeech(input: RoomSpeechInput): RoomSpeechViewModel {
  return {
    messages: buildRoomMessages(input),
    turnActivity: buildTurnActivity(input.events),
  }
}
