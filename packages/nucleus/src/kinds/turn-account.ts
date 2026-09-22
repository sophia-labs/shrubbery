import { firstNonBlankString, numberAt, stringAt } from './json.js'

export interface ConductStep {
  readonly verb: string
  readonly detail: string
  readonly outcome?: string
  readonly observer?: string
  readonly observedAt?: number
}

export interface TurnUsage {
  readonly tokens?: number
  readonly durationMs?: number
  readonly toolCalls?: number
}

export interface TurnAccount {
  readonly reply: string
  readonly conduct: readonly ConductStep[]
  readonly usage?: TurnUsage
}

export interface TurnAccountEvent {
  readonly seq?: number
  readonly ts?: number
  readonly type: string
  readonly payload?: unknown
}

interface TranscriptFragment {
  readonly label: string
  readonly index: string
  readonly body: string
}

const TRANSCRIPT_MARKER_PATTERN = /^\[((?:stream|assistant) text|done output|truncated output|terminal output) #(\d+)\]\r?\n/gm

export function buildTurnAccount(messageText: string, turnEvents: readonly TurnAccountEvent[] = []): TurnAccount {
  const fragments = parseTranscriptFragments(messageText)
  const eventSteps = conductStepsFromEvents(turnEvents)
  const usage = usageFromEvents(turnEvents)

  if (!fragments.length) {
    return withOptionalUsage({ reply: messageText, conduct: eventSteps }, usage)
  }

  const replyParts = [...unmarkedTextParts(messageText, fragments), ...fragments.filter(isDoneFragment).map((fragment) => fragment.body)]
  const sectionSteps = fragments.filter((fragment) => !isDoneFragment(fragment)).map(conductStepFromFragment)

  return withOptionalUsage(
    {
      reply: replyParts.join('\n\n'),
      conduct: [...sectionSteps, ...eventSteps],
    },
    usage,
  )
}

export function parseTranscriptFragments(text: string): readonly TranscriptFragment[] {
  const matches = Array.from(text.matchAll(TRANSCRIPT_MARKER_PATTERN))
  const fragments: TranscriptFragment[] = []

  for (const [matchIndex, match] of matches.entries()) {
    const next = matches[matchIndex + 1]
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = next?.index ?? text.length
    fragments.push({
      label: match[1]?.trim() ?? 'stream text',
      index: match[2] ?? `${fragments.length + 1}`,
      body: text.slice(bodyStart, bodyEnd).trim(),
    })
  }

  return fragments
}

function isDoneFragment(fragment: TranscriptFragment): boolean {
  return fragment.label === 'done output'
}

function unmarkedTextParts(text: string, fragments: readonly TranscriptFragment[]): readonly string[] {
  const parts: string[] = []
  const matches = Array.from(text.matchAll(TRANSCRIPT_MARKER_PATTERN))

  for (const [matchIndex, match] of matches.entries()) {
    const previous = matches[matchIndex - 1]
    const start = previous ? (previous.index ?? 0) + previous[0].length + fragments[matchIndex - 1].body.length : 0
    const end = match.index ?? 0
    const part = text.slice(start, end).trim()
    if (part) parts.push(part)
  }

  const lastMatch = matches.at(-1)
  const lastFragment = fragments.at(-1)
  if (lastMatch && lastFragment) {
    const tailStart = (lastMatch.index ?? 0) + lastMatch[0].length + lastFragment.body.length
    const tail = text.slice(tailStart).trim()
    if (tail) parts.push(tail)
  }

  return parts
}

function conductStepFromFragment(fragment: TranscriptFragment): ConductStep {
  return {
    verb: fragment.label,
    detail: fragment.body,
  }
}

function conductStepsFromEvents(events: readonly TurnAccountEvent[]): readonly ConductStep[] {
  return [...events].sort(eventOrder).flatMap(conductStepFromEvent)
}

function conductStepFromEvent(event: TurnAccountEvent): readonly ConductStep[] {
  const type = event.type
  const payload = event.payload
  const observedAt = typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : undefined
  const observer = firstNonBlankString(stringAt(payload, ['observer']), stringAt(payload, ['authorId']))

  if (type === 'conversation.turn.tool.started') {
    return [
      withAttribution(
        {
          verb: 'tool started',
          detail: detailFromFields([
            ['toolName', stringAt(payload, ['toolName'])],
            ['capability', stringAt(payload, ['capability'])],
            ['argsPreview', stringAt(payload, ['argsPreview'])],
          ]),
        },
        observer,
        observedAt,
      ),
    ]
  }

  if (type === 'conversation.turn.tool.completed' || type === 'conversation.turn.tool.failed') {
    return [
      withAttribution(
        {
          verb: type === 'conversation.turn.tool.failed' ? 'tool failed' : 'tool completed',
          detail: detailFromFields([
            ['toolName', stringAt(payload, ['toolName'])],
            ['toolCallId', stringAt(payload, ['toolCallId'])],
          ]),
          outcome: firstNonBlankString(
            stringAt(payload, ['resultPreview']),
            stringAt(payload, ['error']),
            stringAt(payload, ['result']),
          ) ?? undefined,
        },
        observer,
        observedAt,
      ),
    ]
  }

  if (type === 'conversation.turn.queued') {
    return [
      withAttribution(
        {
          verb: 'turn queued',
          detail: detailFromFields([
            ['turnId', stringAt(payload, ['turnId'])],
            ['triggerMessageId', stringAt(payload, ['triggerMessageId'])],
          ]),
        },
        observer,
        observedAt,
      ),
    ]
  }

  if (type === 'conversation.turn.started' || type === 'conversation.turn.running') {
    return [
      withAttribution(
        {
          verb: type === 'conversation.turn.started' ? 'turn started' : 'turn running',
          detail: detailFromFields([['turnId', stringAt(payload, ['turnId'])]]),
        },
        observer,
        observedAt,
      ),
    ]
  }

  if (type === 'conversation.turn.completed') {
    return [
      withAttribution(
        {
          verb: 'turn completed',
          detail: detailFromFields([
            ['state', stringAt(payload, ['state'])],
            ['model', stringAt(payload, ['model'])],
            ['provider', stringAt(payload, ['provider'])],
          ]),
          outcome: firstNonBlankString(stringAt(payload, ['responseSource']), stringAt(payload, ['responseMessageId'])) ?? undefined,
        },
        observer,
        observedAt,
      ),
    ]
  }

  if (type === 'conversation.turn.sandbox.terminal') {
    return [
      withAttribution(
        {
          verb: 'sandbox terminal',
          detail: detailFromFields([
            ['state', stringAt(payload, ['state'])],
            ['exitCode', stringAt(payload, ['exitCode'])],
            ['status', stringAt(payload, ['result', 'status'])],
          ]),
          outcome: firstNonBlankString(stringAt(payload, ['result', 'output']), stringAt(payload, ['output'])) ?? undefined,
        },
        observer,
        observedAt,
      ),
    ]
  }

  return []
}

function usageFromEvents(events: readonly TurnAccountEvent[]): TurnUsage | undefined {
  const ordered = [...events].sort(eventOrder)
  const completed = lastMatchingEvent(ordered, 'conversation.turn.completed')
  const terminal = lastMatchingEvent(ordered, 'conversation.turn.sandbox.terminal')
  const tokens = numberAt(completed?.payload, ['tokens']) ?? numberAt(terminal?.payload, ['result', 'tokens'])
  const toolCalls = numberAt(completed?.payload, ['toolCalls']) ?? numberAt(terminal?.payload, ['result', 'toolCalls'])

  if (tokens === null && toolCalls === null) return undefined
  return {
    ...(tokens !== null ? { tokens } : {}),
    ...(toolCalls !== null ? { toolCalls } : {}),
  }
}

function lastMatchingEvent(events: readonly TurnAccountEvent[], type: string): TurnAccountEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index]
  }
  return undefined
}

function withOptionalUsage(account: Omit<TurnAccount, 'usage'>, usage: TurnUsage | undefined): TurnAccount {
  return usage ? { ...account, usage } : account
}

function eventOrder(left: TurnAccountEvent, right: TurnAccountEvent): number {
  return Number(left.ts ?? 0) - Number(right.ts ?? 0) || Number(left.seq ?? 0) - Number(right.seq ?? 0)
}

function detailFromFields(fields: readonly (readonly [string, string | null])[]): string {
  return fields
    .flatMap(([label, value]) => {
      const trimmed = value?.trim()
      return trimmed ? [`${label}: ${trimmed}`] : []
    })
    .join('; ')
}

function withAttribution(step: ConductStep, observer: string | null, observedAt: number | undefined): ConductStep {
  return {
    ...step,
    ...(observer ? { observer } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
  }
}
