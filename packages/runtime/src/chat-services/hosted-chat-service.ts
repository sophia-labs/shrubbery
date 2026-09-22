/**
 * Hosted ChatService backed by Choreograph's durable session API.
 *
 * This is the remote sibling of makeLocalChatService. Choreograph owns session
 * and message durability in libSQL; the browser consumes its SandboxEvent SSE
 * stream directly because ChatEvent is intentionally congruent with that wire
 * taxonomy. No transport state enters chat-kernel.
 */

import {
  parseTokens,
  uuid,
  type ChatEvent,
  type ChatMessage,
  type ChatModelOption,
  type MessagePart,
  type SessionSummary,
  type ToolCall,
} from '@shrubbery/chat-kernel'
import {
  ChatServiceFailure,
  type ChatService,
  type ChatTurnOutcome,
  type ChatTurnHandle,
  type CreateSessionOpts,
  type HydratedSession,
} from './chat-service.js'

const DEFAULT_HOSTED_MODELS: ChatModelOption[] = [
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
  { id: 'thinkingmachines/inkling', label: 'Inkling' },
]

export interface HostedChatServiceOptions {
  /** Choreograph orchestrator origin, without a required trailing slash. */
  readonly baseUrl: string
  /** Read at call time so workspace switches route new sessions correctly. */
  readonly graphId: () => string | null | undefined
  /** Read at call time for storage namespacing and dev-service auth. */
  readonly userId: () => string
  /** Cognito ID token for the delegated-bearer production path. */
  readonly token?: () => string | undefined
  /** Explicit header seam for local/internal-service shells and tests. */
  readonly authHeaders?: () => Readonly<Record<string, string>>
  readonly models?: readonly ChatModelOption[]
  readonly defaultModelId?: string
  readonly fetchImpl?: typeof fetch
  /** Optional durable slot selection. The shell may pass localStorage. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  readonly storageKeyPrefix?: string
}

interface ChoreographSession {
  readonly session_id: string
  readonly title?: string | null
  readonly created_at?: string | number | null
  readonly updated_at?: string | number | null
}

interface ChoreographMessage {
  readonly message_id?: string
  readonly role?: string
  readonly content?: unknown
  readonly usage?: unknown
  readonly stop_reason?: string
  readonly timestamp?: number
}

interface BusEnvelope {
  readonly category?: string
  readonly type?: string
  readonly event?: unknown
  readonly state?: string
  readonly error_detail?: string
}

interface SseFrame {
  readonly event: string
  readonly data: unknown
}

/** Build the production remote ChatService over Choreograph REST + streaming SSE. */
export function makeHostedChatService(opts: HostedChatServiceOptions): ChatService {
  const baseUrl = opts.baseUrl.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Hosted ChatService requires a Choreograph baseUrl.')

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) throw new Error('Hosted ChatService requires fetch.')
  const models = [...(opts.models ?? DEFAULT_HOSTED_MODELS)]
  const defaultModelId = opts.defaultModelId ?? models[0]?.id
  let activeSlot: 0 | 1 | 2 = readActiveSlot(opts)
  const slots = readSlots(opts)

  function requestHeaders(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const explicit = opts.authHeaders?.() ?? {}
    const token = opts.token?.()
    return {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...explicit,
      ...extra,
    }
  }

  function url(path: string): string {
    return `${baseUrl}${path}`
  }

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(url(path), {
      ...init,
      headers: requestHeaders(init.headers as Readonly<Record<string, string>> | undefined),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `${init.method ?? 'GET'} ${path} → ${response.status}${body ? ` ${body}` : ''}`,
      )
    }
    if (response.status === 204) return undefined as T
    const body = await response.text()
    return (body ? JSON.parse(body) : undefined) as T
  }

  function summary(row: ChoreographSession): SessionSummary {
    return {
      id: row.session_id,
      title: row.title ?? null,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    }
  }

  return {
    get activeSlot() {
      return activeSlot
    },

    async createSession(input: CreateSessionOpts = {}): Promise<SessionSummary> {
      const body = await json<{ session: ChoreographSession }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title: input.title ?? null,
          model: input.modelId ?? defaultModelId,
          graph_id: input.graphId ?? opts.graphId() ?? null,
        }),
      })
      return summary(body.session)
    },

    async listSessions(): Promise<SessionSummary[]> {
      const body = await json<{ sessions?: ChoreographSession[] }>('/api/sessions')
      return (body.sessions ?? []).map(summary)
    },

    async hydrateSession(id: string): Promise<HydratedSession> {
      const encoded = encodeURIComponent(id)
      const [detail, history] = await Promise.all([
        json<{ session: ChoreographSession }>(`/api/sessions/${encoded}`),
        json<{ messages?: ChoreographMessage[] }>(`/api/sessions/${encoded}/messages`),
      ])
      return {
        session: summary(detail.session),
        messages: projectChoreographMessages(history.messages ?? []),
      }
    },

    async renameSession(id: string, title: string): Promise<SessionSummary> {
      const body = await json<{ session: ChoreographSession }>(
        `/api/sessions/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ title }) },
      )
      return summary(body.session)
    },

    async deleteSession(id: string): Promise<void> {
      await json(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index] === id) slots[index] = null
      }
      persistSlots(opts, activeSlot, slots)
    },

    async startTurn(id: string, userText: string): Promise<ChatTurnHandle> {
      const controller = new AbortController()
      const encoded = encodeURIComponent(id)
      let response: Response
      try {
        response = await fetchImpl(url(`/api/sessions/${encoded}/message`), {
          method: 'POST',
          headers: requestHeaders({ accept: 'text/event-stream' }),
          body: JSON.stringify({ content: userText }),
          signal: controller.signal,
        })
      } catch (error) {
        throw new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
          phase: 'submit',
          // The request may have committed before the response was lost. Without
          // a server idempotency key, resubmission is never automatically safe.
          recovery: 'reconcile',
          cause: error,
        })
      }
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '')
        throw new ChatServiceFailure(
          `POST /api/sessions/${encoded}/message → ${response.status}${body ? ` ${body}` : ''}`,
          { phase: 'submit', recovery: 'reconcile' },
        )
      }

      const queue: ChatEvent[] = []
      let ended = false
      let terminalSeen = false
      let wake: (() => void) | null = null
      const reader = response.body.getReader()

      const push = (event: ChatEvent): void => {
        queue.push(event)
        const pending = wake
        wake = null
        pending?.()
      }

      const finish = (): void => {
        ended = true
        const pending = wake
        wake = null
        pending?.()
      }

      const done = (async (): Promise<ChatTurnOutcome> => {
        let outcome: ChatTurnOutcome = { state: 'completed' }
        try {
          for await (const frame of parseSse(reader)) {
            const envelope = asRecord(frame.data) as BusEnvelope
            if (envelope.category === 'agent' && isChatEvent(envelope.event)) {
              if (isTerminal(envelope.event)) terminalSeen = true
              push(envelope.event)
              continue
            }
            if (envelope.category === 'lifecycle' && envelope.type === 'terminal') {
              const agentTerminalSeen = terminalSeen
              terminalSeen = true
              if (!agentTerminalSeen) {
                if (envelope.state === 'error') {
                  push({ type: 'error', message: envelope.error_detail || 'Choreograph turn failed.' })
                } else {
                  push({ type: 'done', output: '' })
                }
              }
              break
            }
          }
          if (controller.signal.aborted) {
            outcome = { state: 'aborted' }
          } else if (!terminalSeen) {
            const failure = new ChatServiceFailure(
              'Choreograph stream ended before a terminal event. Message status is uncertain.',
              { phase: 'stream', recovery: 'reconcile' },
            )
            push({ type: 'error', message: failure.message })
            outcome = { state: 'failed', failure }
          }
        } catch (error) {
          if (controller.signal.aborted) {
            outcome = { state: 'aborted' }
          } else if (!terminalSeen) {
            const failure = new ChatServiceFailure(
              error instanceof Error ? error.message : String(error),
              { phase: 'stream', recovery: 'reconcile', cause: error },
            )
            push({ type: 'error', message: failure.message })
            outcome = { state: 'failed', failure }
          }
        } finally {
          finish()
          try {
            await reader.cancel()
          } catch {
            // The body may already be closed by the server.
          }
        }
        return outcome
      })()

      const events: AsyncIterable<ChatEvent> = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<ChatEvent>> {
              while (queue.length === 0 && !ended) {
                await new Promise<void>((resolve) => {
                  wake = resolve
                })
              }
              const event = queue.shift()
              return event
                ? { value: event, done: false }
                : { value: undefined, done: true }
            },
          }
        },
      }

      return {
        events,
        done,
        abort(): void {
          controller.abort()
          void json(`/api/sessions/${encoded}/abort`, { method: 'POST' }).catch(() => {})
          finish()
        },
      }
    },

    async abort(id: string): Promise<void> {
      await json(`/api/sessions/${encodeURIComponent(id)}/abort`, { method: 'POST' }).catch(
        () => {},
      )
    },

    models(): ChatModelOption[] {
      return [...models]
    },

    slotSessions(): (string | null)[] {
      return [...slots]
    },

    setActiveSlot(slot: 0 | 1 | 2): void {
      activeSlot = slot
      persistSlots(opts, activeSlot, slots)
    },

    bindSlotSession(slot: 0 | 1 | 2, id: string | null): void {
      slots[slot] = id
      persistSlots(opts, activeSlot, slots)
    },
  }
}

function projectChoreographMessages(rows: readonly ChoreographMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const ownerByToolCall = new Map<string, ChatMessage>()

  for (const row of rows) {
    if (row.role === 'user') {
      const content = renderContentText(row.content)
      messages.push({
        id: row.message_id ?? uuid(),
        role: 'user',
        content,
        parts: [{ type: 'text', content }],
        isStreaming: false,
        toolCalls: [],
        createdAt: row.timestamp ?? Date.now(),
      })
      continue
    }

    if (row.role === 'assistant') {
      const parts: MessagePart[] = []
      const toolCalls: ToolCall[] = []
      let content = ''
      for (const block of contentBlocks(row.content)) {
        const type = typeof block.type === 'string' ? block.type : ''
        if (type === 'text') {
          const text = typeof block.text === 'string' ? block.text : ''
          parts.push({ type: 'text', content: text })
          content += text
        } else if (type === 'thinking') {
          parts.push({
            type: 'reasoning',
            content: typeof block.thinking === 'string' ? block.thinking : '',
          })
        } else if (type === 'toolCall') {
          const id = typeof block.id === 'string' && block.id ? block.id : uuid()
          const tool = typeof block.name === 'string' && block.name ? block.name : 'tool'
          parts.push({ type: 'tool', toolCallId: id })
          toolCalls.push({
            id,
            tool,
            status: 'running',
            input: isRecord(block.arguments) ? block.arguments : null,
            output: null,
            metadata: null,
          })
        }
      }
      const message: ChatMessage = {
        id: row.message_id ?? uuid(),
        role: 'assistant',
        content,
        parts,
        isStreaming: false,
        toolCalls,
        tokens: row.usage == null ? undefined : parseTokens(normalizeUsage(row.usage)),
        createdAt: row.timestamp ?? Date.now(),
        error: row.stop_reason === 'error' ? 'The model turn ended with an error.' : undefined,
      }
      for (const call of toolCalls) ownerByToolCall.set(call.id, message)
      messages.push(message)
      continue
    }

    if (row.role === 'toolResult' && isRecord(row.content)) {
      const callId = typeof row.content.toolCallId === 'string' ? row.content.toolCallId : ''
      const owner = ownerByToolCall.get(callId)
      const call = owner?.toolCalls.find((candidate) => candidate.id === callId)
      if (call && owner) {
        call.status = row.content.isError === true ? 'error' : 'completed'
        call.output = renderContentText(row.content.content)
      }
    }
  }
  return messages
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter(isRecord)
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return []
}

function renderContentText(content: unknown): string {
  if (typeof content === 'string') return content
  return contentBlocks(content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text))
    .join('\n')
}

function normalizeUsage(usage: unknown): Record<string, unknown> {
  const row = asRecord(usage)
  const cache = asRecord(row.cache)
  return {
    ...row,
    cache: {
      read: cache.read ?? row.cacheRead ?? row.cache_read,
      write: cache.write ?? row.cacheWrite ?? row.cache_write,
    },
  }
}

function isTerminal(event: ChatEvent): boolean {
  return event.type === 'done' || event.type === 'truncated' || event.type === 'error'
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  return [
    'turn_start',
    'text',
    'thinking',
    'tool_call',
    'tool_result',
    'turn_end',
    'done',
    'truncated',
    'error',
  ].includes(value.type)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toIso(value: string | number | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'number') return new Date(value).toISOString()
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString()
}

function storageKey(opts: HostedChatServiceOptions, suffix: string): string {
  const prefix = opts.storageKeyPrefix ?? 'shrubbery:chat'
  return `${prefix}:${encodeURIComponent(opts.userId())}:${encodeURIComponent(opts.graphId() ?? 'default')}:${suffix}`
}

function readActiveSlot(opts: HostedChatServiceOptions): 0 | 1 | 2 {
  try {
    const value = Number(opts.storage?.getItem(storageKey(opts, 'active-slot')))
    return value === 1 || value === 2 ? value : 0
  } catch {
    return 0
  }
}

function readSlots(opts: HostedChatServiceOptions): [string | null, string | null, string | null] {
  try {
    const raw = opts.storage?.getItem(storageKey(opts, 'slots'))
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return [null, null, null]
    return [0, 1, 2].map((index) =>
      typeof parsed[index] === 'string' && parsed[index] ? parsed[index] : null,
    ) as [string | null, string | null, string | null]
  } catch {
    return [null, null, null]
  }
}

function persistSlots(
  opts: HostedChatServiceOptions,
  activeSlot: 0 | 1 | 2,
  slots: readonly (string | null)[],
): void {
  const storage = opts.storage
  if (!storage) return
  try {
    storage.setItem(storageKey(opts, 'active-slot'), String(activeSlot))
    storage.setItem(storageKey(opts, 'slots'), JSON.stringify(slots))
  } catch {
    // Browser storage is best effort; Choreograph remains the message/session SoR.
  }
}

/** Parse JSON SSE frames, accepting both LF and CRLF framing and multi-line data. */
export async function* parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder()
  let buffer = ''

  const parseFrame = (raw: string): SseFrame | null => {
    let event = 'message'
    const data: string[] = []
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (data.length === 0) return null
    try {
      return { event, data: JSON.parse(data.join('\n')) }
    } catch {
      return null
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      const frame = parseFrame(buffer.slice(0, separator))
      buffer = buffer.slice(separator + 2)
      if (frame) yield frame
      separator = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n')
  const finalFrame = parseFrame(buffer.trim())
  if (finalFrame) yield finalFrame
}
