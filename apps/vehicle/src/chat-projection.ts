import type { ChatMessage, MessagePart, ToolCall, ToolCallStatus } from '@shrubbery/chat-kernel'

import type { JsonRecord, VehicleAgentSessionEvent, VehicleAgentWorldResponse } from './types.js'
import {
  asRecord,
  compactJson,
  conversationMessages,
  stringAt,
  valueAt,
} from './vehicle-service.js'

export interface VehicleChatProjectionOptions {
  readonly authorId?: string | null
  readonly now?: number
}

interface ProjectedChatMessage extends ChatMessage {
  readonly worldRole: string
  readonly worldAuthor: string
}

interface ToolGroup {
  readonly key: string
  readonly turnId: string | null
  readonly firstTs: number
  lastTs: number
  readonly calls: ToolCall[]
  readonly timeline: TurnTimelineItem[]
}

interface MutableToolGroup {
  key: string
  turnId: string | null
  firstTs: number
  lastTs: number
  calls: ToolCall[]
  timeline: TurnTimelineItem[]
}

type TranscriptMessagePart = Extract<MessagePart, { type: 'transcript' }>

type TurnTimelineItem =
  | {
      readonly kind: 'transcript'
      readonly seq: number
      readonly ts: number
      readonly label: string
      readonly text: string
    }
  | {
      readonly kind: 'tool'
      readonly seq: number
      readonly ts: number
      readonly toolCallId: string
    }

export function projectVehicleChatMessages(
  world: VehicleAgentWorldResponse | null,
  events: readonly VehicleAgentSessionEvent[],
  options: VehicleChatProjectionOptions = {},
): ChatMessage[] {
  const baseMessages = conversationMessages(world)
    .map((message, index) => projectWorldMessage(message, index, options))
    .sort((a, b) => a.createdAt - b.createdAt)
  const toolGroups = projectToolGroups(events)

  const projected = [...baseMessages]
  for (const group of toolGroups) {
    const anchorIndex = projected.findIndex(
      (message) =>
        message.createdAt >= group.firstTs &&
        message.role === 'assistant' &&
        (message.worldRole === 'agent' || message.worldRole === 'assistant'),
    )
    if (anchorIndex >= 0) {
      projected[anchorIndex] = attachToolGroup(projected[anchorIndex], group)
      continue
    }

    projected.push(projectSyntheticToolMessage(group))
  }

  return projected
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ worldRole: _worldRole, worldAuthor: _worldAuthor, ...message }) => message)
}

function projectWorldMessage(
  message: JsonRecord,
  index: number,
  options: VehicleChatProjectionOptions,
): ProjectedChatMessage {
  const worldRole = stringAt(message, ['role']) ?? 'agent'
  const worldAuthor = stringAt(message, ['authorId']) ?? stringAt(message, ['author']) ?? worldRole
  const text = stringAt(message, ['text']) ?? stringAt(message, ['content']) ?? compactJson(message, 500)
  const isUser = worldRole === 'user' || worldAuthor === (options.authorId ?? 'vera')
  const transcriptParts = isUser ? [] : transcriptPartsFromText(text)
  const body = isUser ? text : formatAgentTranscriptContent(text)
  const content = isUser ? body : `**${worldAuthor}** · ${worldRole}\n\n${body}`
  const createdAt = readTimestamp(
    valueAt(message, ['createdAt']) ?? valueAt(message, ['ts']) ?? valueAt(message, ['timestamp']),
    options.now ?? Date.now(),
  )
  const parts: MessagePart[] = isUser
    ? [{ type: 'text', content }]
    : transcriptParts.length > 0
      ? [{ type: 'text', content: `**${worldAuthor}** · ${worldRole}` }, ...transcriptParts]
      : [{ type: 'text', content }]

  return {
    id: stringAt(message, ['id']) ?? `world-message-${index}`,
    role: isUser ? 'user' : 'assistant',
    content,
    parts: content ? parts : [],
    isStreaming: false,
    toolCalls: [],
    createdAt,
    worldRole,
    worldAuthor,
  }
}

function projectToolGroups(events: readonly VehicleAgentSessionEvent[]): ToolGroup[] {
  const groups = new Map<string, MutableToolGroup>()

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = asRecord(event.payload)
    if (!isTurnTimelineEvent(event.type, payload)) continue
    const turnId = stringAt(payload, ['turnId']) ?? stringAt(payload, ['turn_id'])
    const groupKey = turnId ? `turn:${turnId}` : `session:${event.sessionId}:tool-window`
    const ts = readTimestamp(event.ts, Date.now())
    const group =
      groups.get(groupKey) ??
      {
        key: groupKey,
        turnId,
        firstTs: ts,
        lastTs: ts,
        calls: [],
        timeline: [],
      }
    group.lastTs = Math.max(group.lastTs, ts)
    if (isToolEvent(event.type)) {
      mergeToolEvent(group, event, payload)
    } else {
      mergeTranscriptEvent(group, event, payload, ts)
    }
    groups.set(groupKey, group)
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, timeline: [...group.timeline].sort((a, b) => a.seq - b.seq) }))
    .sort((a, b) => a.firstTs - b.firstTs)
}

function isToolEvent(type: string): boolean {
  return (
    type === 'conversation.turn.tool.started' ||
    type === 'conversation.turn.tool.completed' ||
    type === 'conversation.turn.tool.failed'
  )
}

function isTurnTimelineEvent(type: string, payload: JsonRecord): boolean {
  if (isToolEvent(type)) return true
  if (!stringAt(payload, ['turnId']) && !stringAt(payload, ['turn_id'])) return false
  return (
    type === 'conversation.turn.stream' ||
    type === 'conversation.turn.agent.done' ||
    type === 'conversation.turn.agent.truncated' ||
    type === 'conversation.turn.sandbox.terminal'
  )
}

function mergeToolEvent(group: MutableToolGroup, event: VehicleAgentSessionEvent, payload: JsonRecord): void {
  const toolName = stringAt(payload, ['toolName']) ?? stringAt(payload, ['gate']) ?? 'tool'
  const explicitId = stringAt(payload, ['toolCallId']) ?? stringAt(payload, ['tool_call_id'])
  const existing = findExistingToolCall(group, explicitId, toolName)
  const id =
    existing?.id ??
    explicitId ??
    `${group.key}:${slug(toolName)}:${group.calls.length + 1}`
  const status = statusForEvent(event.type)
  const input = toolInput(payload) ?? existing?.input ?? null
  const output = toolOutput(payload) ?? existing?.output ?? null
  const metadata = {
    ...(existing?.metadata ?? {}),
    turnId: group.turnId,
    seq: event.seq,
    eventType: event.type,
    ts: event.ts,
    manifestId: stringAt(payload, ['manifestId']) ?? undefined,
    capability: stringAt(payload, ['capability']) ?? undefined,
  }

  const next: ToolCall = {
    id,
    tool: toolName,
    status,
    input,
    output,
    metadata,
  }

  if (existing) {
    const index = group.calls.findIndex((call) => call.id === existing.id)
    group.calls[index] = next
  } else {
    group.calls.push(next)
  }

  if (!group.timeline.some((item) => item.kind === 'tool' && item.toolCallId === id)) {
    group.timeline.push({ kind: 'tool', seq: event.seq, ts: readTimestamp(event.ts, group.lastTs), toolCallId: id })
  }
}

function mergeTranscriptEvent(
  group: MutableToolGroup,
  event: VehicleAgentSessionEvent,
  payload: JsonRecord,
  ts: number,
): void {
  if (event.type === 'conversation.turn.stream') {
    const text = stringAt(payload, ['text']) ?? stringAt(payload, ['preview'])
    if (!text) return
    const stream = stringAt(payload, ['stream']) ?? 'text'
    const label = stream === 'text' ? 'stream text' : `${stream} stream`
    group.timeline.push({ kind: 'transcript', seq: event.seq, ts, label, text })
    return
  }

  if (event.type === 'conversation.turn.agent.done') {
    const text = stringAt(payload, ['output']) ?? stringAt(payload, ['preview'])
    if (text) group.timeline.push({ kind: 'transcript', seq: event.seq, ts, label: 'done output', text })
    return
  }

  if (event.type === 'conversation.turn.agent.truncated') {
    const text = stringAt(payload, ['preview']) ?? stringAt(payload, ['output']) ?? 'Turn output was truncated.'
    group.timeline.push({ kind: 'transcript', seq: event.seq, ts, label: 'truncated output', text })
    return
  }

  if (event.type === 'conversation.turn.sandbox.terminal') {
    const state = stringAt(payload, ['state']) ?? 'terminal'
    if (state === 'done') return
    const text = stringAt(payload, ['result', 'output']) ?? state
    group.timeline.push({ kind: 'transcript', seq: event.seq, ts, label: 'terminal output', text })
  }
}

function findExistingToolCall(
  group: MutableToolGroup,
  explicitId: string | null,
  toolName: string,
): ToolCall | null {
  if (explicitId) return group.calls.find((call) => call.id === explicitId) ?? null
  const open = [...group.calls].reverse().find((call) => {
    return call.tool === toolName && (call.status === 'pending' || call.status === 'running')
  })
  return open ?? null
}

function statusForEvent(type: string): ToolCallStatus {
  if (type === 'conversation.turn.tool.failed') return 'error'
  if (type === 'conversation.turn.tool.completed') return 'completed'
  return 'running'
}

function toolInput(payload: JsonRecord): Record<string, unknown> | null {
  const args = valueAt(payload, ['args'])
  if (args === undefined || args === null) return null
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>
  return { value: args }
}

function toolOutput(payload: JsonRecord): string | null {
  const result = valueAt(payload, ['result'])
  if (result !== undefined && result !== null) {
    return typeof result === 'string' ? result : compactJson(result, 12000)
  }
  return (
    stringAt(payload, ['output']) ??
    stringAt(payload, ['error']) ??
    stringAt(payload, ['resultPreview'])
  )
}

function formatAgentTranscriptContent(text: string): string {
  const fragments = parseTranscriptFragments(text).filter((fragment) => !isTranscriptScaffoldFragment(fragment))
  if (fragments.length === 0) return text
  return fragments
    .map((fragment, index) => {
      const body = formatMaybeJsonBlock(fragment.body)
      return `### ${transcriptTitle(fragment.label, fragment.body, index)}\n\n${body}`
    })
    .join('\n\n')
}

function transcriptPartsFromText(text: string): TranscriptMessagePart[] {
  return parseTranscriptFragments(text)
    .filter((fragment) => !isTranscriptScaffoldFragment(fragment))
    .map((fragment, index) => transcriptPartFromFragment(fragment.label, fragment.body, index))
}

function parseTranscriptFragments(text: string): Array<{ label: string; index: string; body: string }> {
  const pattern = /^\[((?:stream|assistant) text|done output|truncated output|terminal output) #(\d+)\]\n/gm
  const fragments: Array<{ label: string; index: string; body: string }> = []
  const matches = Array.from(text.matchAll(pattern))

  for (const [matchIndex, match] of matches.entries()) {
    const next = matches[matchIndex + 1]
    const bodyStart = match.index + match[0].length
    const bodyEnd = next?.index ?? text.length
    fragments.push({
      label: match[1]?.trim() ?? 'stream text',
      index: match[2] ?? `${fragments.length + 1}`,
      body: text.slice(bodyStart, bodyEnd).trim(),
    })
  }
  return fragments
}

function formatMaybeJsonBlock(text: string): string {
  const trimmed = text.trim()
  if (!looksLikeJson(trimmed)) return text
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(trimmed), null, 2)}\n\`\`\``
  } catch {
    return text
  }
}

function looksLikeJson(value: string): boolean {
  return (value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))
}

function transcriptPartFromFragment(label: string, body: string, index: number): TranscriptMessagePart {
  return {
    type: 'transcript',
    title: transcriptTitle(label, body, index),
    content: body,
    tone: transcriptTone(label, body),
    sourceLabel: `${label} #${index + 1}`,
  }
}

function transcriptTitle(label: string, body: string, index: number): string {
  const number = String(index + 1).padStart(2, '0')
  if (isDoneTranscriptLabel(label)) return `done ribbon ${number}`
  if (label === 'terminal output') return `terminal slip ${number}`
  if (label === 'truncated output') return `trimmed leaf ${number}`
  if (looksLikeJson(body.trim())) return `data leaf ${number}`
  return `voice leaf ${number}`
}

function transcriptTone(label: string, body: string): TranscriptMessagePart['tone'] {
  if (isDoneTranscriptLabel(label)) return 'done'
  if (label === 'terminal output') return 'terminal'
  if (label === 'truncated output') return 'warning'
  if (looksLikeJson(body.trim())) return 'data'
  return 'voice'
}

function isDoneTranscriptLabel(label: string): boolean {
  return label === 'done output'
}

function isTranscriptScaffoldFragment(fragment: { label: string; body: string }): boolean {
  if (!/^(stream|assistant) text$/.test(fragment.label)) return false
  const compact = fragment.body.trim().replace(/\s+/g, '')
  if (!compact) return true
  if (/^[{}\[\],:"]+$/.test(compact)) return true
  if (compact.length < 32 && compact.startsWith('{') && !compact.endsWith('}')) return true
  return compact.length < 32 && compact.startsWith('[') && !compact.endsWith(']')
}

function attachToolGroup(message: ProjectedChatMessage, group: ToolGroup): ProjectedChatMessage {
  const existingIds = new Set(message.toolCalls.map((call) => call.id))
  const newCalls = group.calls.filter((call) => !existingIds.has(call.id))
  const toolParts: MessagePart[] = newCalls.map((call) => ({ type: 'tool', toolCallId: call.id }))
  const timelineParts = timelinePartsForMessage(message, group)
  return {
    ...message,
    parts: timelineParts ?? [...message.parts, ...toolParts],
    toolCalls: [...message.toolCalls, ...newCalls],
    isStreaming: message.isStreaming || newCalls.some((call) => call.status === 'pending' || call.status === 'running'),
  }
}

function timelinePartsForMessage(message: ProjectedChatMessage, group: ToolGroup): MessagePart[] | null {
  const timelineHasTranscript = group.timeline.some((item) => item.kind === 'transcript')
  if (!timelineHasTranscript) return null

  const baseTranscriptChars = message.parts
    .filter((part): part is TranscriptMessagePart => part.type === 'transcript')
    .reduce((sum, part) => sum + part.content.length, 0)
  const timelineTranscriptChars = group.timeline
    .filter((item): item is Extract<TurnTimelineItem, { kind: 'transcript' }> => item.kind === 'transcript')
    .filter((item) => !isTranscriptScaffoldFragment({ label: item.label, body: item.text }))
    .reduce((sum, item) => sum + item.text.length, 0)
  if (baseTranscriptChars > 0 && timelineTranscriptChars < baseTranscriptChars * 0.8) return null

  const parts = timelinePartsFromGroup(group)
  if (parts.length === 0) return null
  return [...leadingMessageParts(message), ...parts]
}

function timelinePartsFromGroup(group: ToolGroup): MessagePart[] {
  const callsById = new Map(group.calls.map((call) => [call.id, call]))
  const seenTools = new Set<string>()
  let transcriptIndex = 0
  const parts: MessagePart[] = []

  for (const item of group.timeline) {
    if (item.kind === 'transcript') {
      if (isTranscriptScaffoldFragment({ label: item.label, body: item.text })) continue
      parts.push(transcriptPartFromFragment(item.label, item.text, transcriptIndex++))
      continue
    }

    if (seenTools.has(item.toolCallId) || !callsById.has(item.toolCallId)) continue
    seenTools.add(item.toolCallId)
    parts.push({ type: 'tool', toolCallId: item.toolCallId })
  }

  for (const call of group.calls) {
    if (seenTools.has(call.id)) continue
    seenTools.add(call.id)
    parts.push({ type: 'tool', toolCallId: call.id })
  }

  return parts
}

function leadingMessageParts(message: ProjectedChatMessage): MessagePart[] {
  const first = message.parts[0]
  if (first?.type === 'text' && first.content.trim().startsWith('**')) return [first]
  return []
}

function projectSyntheticToolMessage(group: ToolGroup): ProjectedChatMessage {
  const timelineParts = timelinePartsFromGroup(group)
  const content = formatTimelineContent(group)
  return {
    id: `vehicle-tools-${slug(group.turnId ?? group.key)}`,
    role: 'assistant',
    content,
    parts: timelineParts.length > 0
      ? timelineParts
      : group.calls.map((call) => ({ type: 'tool' as const, toolCallId: call.id })),
    isStreaming: group.calls.some((call) => call.status === 'pending' || call.status === 'running'),
    toolCalls: group.calls,
    createdAt: group.firstTs,
    worldRole: 'agent',
    worldAuthor: 'vehicle-tools',
  }
}

function formatTimelineContent(group: ToolGroup): string {
  const transcriptItems = group.timeline.filter(
    (item): item is Extract<TurnTimelineItem, { kind: 'transcript' }> => item.kind === 'transcript',
  )
  if (transcriptItems.length === 0) return ''
  return transcriptItems
    .filter((item) => !isTranscriptScaffoldFragment({ label: item.label, body: item.text }))
    .map((item, index) => `### ${transcriptTitle(item.label, item.text, index)}\n\n${formatMaybeJsonBlock(item.text)}`)
    .join('\n\n')
}

function readTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'tool'
}
