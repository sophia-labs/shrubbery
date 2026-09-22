import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { ChatServiceFailure } from '../chat-service.js'
import { makeHostedChatService, parseSse } from '../hosted-chat-service.js'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sse(frames: readonly unknown[]): Response {
  const body = frames.map((frame) => `event: bus\ndata: ${JSON.stringify(frame)}\n\n`).join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('makeHostedChatService', () => {
  it('drives the durable Choreograph session CRUD, hydration, and SandboxEvent stream', async () => {
    const calls: Array<{ url: URL; method: string; headers: Headers; body: unknown }> = []
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const requestUrl = new URL(String(input))
      const method = init.method ?? 'GET'
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url: requestUrl, method, headers, body })

      if (method === 'POST' && requestUrl.pathname === '/api/sessions') {
        return json({
          session: {
            session_id: 'session-1',
            title: null,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
          },
        }, 201)
      }
      if (method === 'GET' && requestUrl.pathname === '/api/sessions') {
        return json({ sessions: [{ session_id: 'session-1', title: 'First' }] })
      }
      if (method === 'GET' && requestUrl.pathname === '/api/sessions/session-1') {
        return json({ session: { session_id: 'session-1', title: 'First' } })
      }
      if (method === 'GET' && requestUrl.pathname === '/api/sessions/session-1/messages') {
        return json({
          messages: [
            {
              message_id: 'user-1',
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
              timestamp: 10,
            },
            {
              message_id: 'assistant-1',
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'checking' },
                { type: 'toolCall', id: 'lookup-1', name: 'lookup', arguments: { q: 'x' } },
                { type: 'text', text: 'world' },
              ],
              usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 1 },
              timestamp: 11,
            },
            {
              message_id: 'tool-1',
              role: 'toolResult',
              content: {
                toolCallId: 'lookup-1',
                isError: false,
                content: [{ type: 'text', text: 'found' }],
              },
              timestamp: 12,
            },
          ],
        })
      }
      if (method === 'PATCH' && requestUrl.pathname === '/api/sessions/session-1') {
        return json({ session: { session_id: 'session-1', title: body.title } })
      }
      if (method === 'POST' && requestUrl.pathname === '/api/sessions/session-1/message') {
        return sse([
          { category: 'agent', type: 'event', event: { type: 'turn_start', turn: 0 } },
          { category: 'agent', type: 'event', event: { type: 'text', content: 'hello ' } },
          { category: 'agent', type: 'event', event: { type: 'text', content: 'world' } },
          {
            category: 'agent',
            type: 'event',
            event: { type: 'done', output: 'hello world' },
          },
          { category: 'lifecycle', type: 'terminal', state: 'completed' },
        ])
      }
      if (method === 'DELETE' && requestUrl.pathname === '/api/sessions/session-1') {
        return json({ deleted: true })
      }
      if (method === 'POST' && requestUrl.pathname === '/api/sessions/session-1/abort') {
        return json({ sandbox: { state: 'killed' } })
      }
      return json({ error: 'not found' }, 404)
    }

    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test/',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      token: () => 'token-a',
      fetchImpl,
    })

    const created = await service.createSession({ title: null })
    expect(created.id).toBe('session-1')
    expect(calls[0].body).toMatchObject({
      graph_id: 'graph-a',
      model: 'moonshotai/kimi-k2.5',
    })
    expect(calls[0].headers.get('authorization')).toBe('Bearer token-a')
    expect((await service.listSessions())[0].title).toBe('First')

    const hydrated = await service.hydrateSession('session-1')
    expect(hydrated.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(hydrated.messages[1]).toMatchObject({
      content: 'world',
      tokens: { input: 3, output: 4, cacheRead: 2, cacheWrite: 1 },
    })
    expect(hydrated.messages[1].toolCalls[0]).toMatchObject({
      id: 'lookup-1',
      status: 'completed',
      output: 'found',
    })

    expect((await service.renameSession('session-1', 'Renamed')).title).toBe('Renamed')
    const handle = await service.startTurn('session-1', 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)
    const outcome = await handle.done
    expect(outcome).toEqual({ state: 'completed' })
    expect(events).toEqual([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'hello ' },
      { type: 'text', content: 'world' },
      { type: 'done', output: 'hello world' },
    ])
    const sendCall = calls.find((call) => call.url.pathname.endsWith('/message'))
    expect(sendCall?.headers.get('accept')).toBe('text/event-stream')
    expect(sendCall?.body).toEqual({ content: 'go' })

    await service.abort('session-1')
    await service.deleteSession('session-1')
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })

  it('persists slot selection without persisting auth material', () => {
    const storage = new MemoryStorage()
    const options = {
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      token: () => 'secret-token',
      storage,
      fetchImpl: (async () => json({})) as typeof fetch,
    }
    const first = makeHostedChatService(options)
    first.bindSlotSession(2, 'session-2')
    first.setActiveSlot(2)

    const second = makeHostedChatService(options)
    expect(second.activeSlot).toBe(2)
    expect(second.slotSessions()).toEqual([null, null, 'session-2'])
    expect([...storage.values.values()].join(' ')).not.toContain('secret-token')
  })

  it('turns a lifecycle error without an agent terminal event into a visible ChatEvent error', async () => {
    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      fetchImpl: (async () =>
        sse([
          {
            category: 'lifecycle',
            type: 'terminal',
            state: 'error',
            error_detail: 'sandbox failed',
          },
        ])) as typeof fetch,
    })
    const handle = await service.startTurn('session-1', 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)
    expect(events).toEqual([{ type: 'error', message: 'sandbox failed' }])
    expect(await handle.done).toEqual({ state: 'completed' })
  })

  it('classifies a lost POST response as ambiguous and never claims it is safe to resubmit', async () => {
    const networkError = new TypeError('fetch failed')
    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      fetchImpl: (async () => { throw networkError }) as typeof fetch,
    })

    const failure = await service.startTurn('session-1', 'possibly saved').catch(error => error)
    expect(failure).toBeInstanceOf(ChatServiceFailure)
    expect(failure).toMatchObject({
      phase: 'submit',
      recovery: 'reconcile',
      cause: networkError,
    })
  })

  it('keeps a hosted HTTP submit failure conservative until durable history is checked', async () => {
    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      fetchImpl: (async () => json({ error: 'gateway timeout' }, 504)) as typeof fetch,
    })

    const failure = await service.startTurn('session-1', 'possibly saved').catch(error => error)
    expect(failure).toBeInstanceOf(ChatServiceFailure)
    expect(failure).toMatchObject({ phase: 'submit', recovery: 'reconcile' })
  })

  it('makes a premature hosted EOF an explicit ambiguous outcome', async () => {
    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      fetchImpl: (async () => sse([
        { category: 'agent', type: 'event', event: { type: 'turn_start', turn: 0 } },
        { category: 'agent', type: 'event', event: { type: 'text', content: 'partial' } },
      ])) as typeof fetch,
    })

    const handle = await service.startTurn('session-1', 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)
    expect(events).toEqual([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'partial' },
      {
        type: 'error',
        message: 'Choreograph stream ended before a terminal event. Message status is uncertain.',
      },
    ])
    const outcome = await handle.done
    expect(outcome.state).toBe('failed')
    if (outcome.state !== 'failed') throw new Error('expected failed outcome')
    expect(outcome.failure).toMatchObject({ phase: 'stream', recovery: 'reconcile' })
  })

  it('makes a hosted stream read failure explicit and ambiguous', async () => {
    const streamError = new Error('socket disappeared')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(streamError)
      },
    })
    const service = makeHostedChatService({
      baseUrl: 'https://choreograph.example.test',
      graphId: () => 'graph-a',
      userId: () => 'user-a',
      fetchImpl: (async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
    })

    const handle = await service.startTurn('session-1', 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)
    expect(events).toEqual([{ type: 'error', message: 'socket disappeared' }])
    const outcome = await handle.done
    expect(outcome.state).toBe('failed')
    if (outcome.state !== 'failed') throw new Error('expected failed outcome')
    expect(outcome.failure).toMatchObject({
      phase: 'stream',
      recovery: 'reconcile',
      cause: streamError,
    })
  })
})

describe('parseSse', () => {
  it('accepts split CRLF frames and ignores keepalive comments', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(':ok\r\nevent: bus\r\ndata: {"a":'))
        controller.enqueue(encoder.encode('1}\r\n\r\n'))
        controller.close()
      },
    })
    const frames = []
    for await (const frame of parseSse(stream.getReader())) frames.push(frame)
    expect(frames).toEqual([{ event: 'bus', data: { a: 1 } }])
  })
})
