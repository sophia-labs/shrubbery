import type { ChatEvent } from '@shrubbery/chat-kernel'
import { describe, expect, it } from 'vitest'
import { ChatServiceFailure } from '../chat-service.js'
import { makeHostedChatService } from '../hosted-chat-service.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

interface Call {
  readonly url: URL
  readonly method: string
  readonly headers: Headers
  readonly body: unknown
}

const WORKFLOW = {
  name: 'domain-agent-activity-loop-v1',
  workflowUri: 'urn:sophia:wf:domain-agent-activity-loop-v1',
  definitionDigest: 'a'.repeat(64),
  inputs: {
    type: 'object',
    required: ['definitionDocumentId', 'trigger', 'contextRefs'],
  },
  outputs: { type: 'object' },
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sse(events: unknown[]): Response {
  const payload = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function event(seq: number, type: string, value: Record<string, unknown> = {}): unknown {
  return {
    sessionId: 'ags-chat-1',
    seq,
    ts: 1_000 + seq,
    type,
    payload: {
      schema: 'sophia.agent-session-semantic-event.v1',
      sourceType: type,
      value,
      meaningfulObjects: {},
    },
  }
}

function sessionFaultedEvent(seq: number, error: string): unknown {
  return {
    sessionId: 'ags-chat-1',
    seq,
    ts: 1_000 + seq,
    type: 'session.faulted',
    payload: {
      schema: 'choreograph.agent-session-lifecycle.v1',
      sessionId: 'ags-chat-1',
      state: 'faulted',
      cause: 'execution_admission_failed',
      materialization: 'not_materialized',
      error,
    },
  }
}

function snapshot(
  assistantText = 'Hello from Sophia.',
  events: unknown[] = [event(1, 'turn.started', { turn: 0 }), event(4, 'message.completed', { output: assistantText })],
): unknown {
  return {
    session: {
      sessionId: 'ags-chat-1',
      runId: 'run-1',
      graphId: 'sophia-cluster',
      label: 'pilot-headed',
      agentId: 'agent-123',
      status: 'restartable',
    },
    document: {
      transcript: {
        order: ['assistant-1'],
        items: {
          'assistant-1': { role: 'agent', authorId: 'sophia-1', text: assistantText, ts: 2_000 },
        },
      },
    },
    events,
  }
}

function serviceOptions(storage: MemoryStorage, fetchImpl: typeof fetch) {
  return {
    graphBaseUrl: (graphId: string) => `https://api.canary.test/g/${graphId}`,
    graphId: () => 'sophia-cluster',
    userId: () => 'vera',
    token: () => 'jwt',
    storage,
    fetchImpl,
    resolveAttempts: 2,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  }
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof makeHostedChatService>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

function seedDescriptor(storage: MemoryStorage, options: {
  readonly id?: string
  readonly runId?: string
  readonly agentSessionId?: string
  readonly pendingState?: string
} = {}) {
  const id = options.id ?? 'c2chat-seeded'
  const root = 'shrubbery:c2chat:v1:vera:sophia-cluster'
  const pendingCommand = options.pendingState == null ? undefined : {
    commandId: 'c2cmd:seeded',
    name: 'follow_up',
    text: 'Same words',
    submittedAt: 3_000,
  }
  storage.setItem(`${root}:descriptor-index`, JSON.stringify([id]))
  storage.setItem(`${root}:descriptor:${id}`, JSON.stringify({
    schema: 'shrubbery.cloud2-chat-descriptor.v1',
    virtualId: id,
    graphId: 'sophia-cluster',
    title: null,
    modelId: 'sophia-1/profile',
    clientId: 'c2chat-client-seeded',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    cursor: 0,
    initialUserText: 'Same words',
    initialUserMessageId: `${id}:initial-user`,
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.agentSessionId ? { agentSessionId: options.agentSessionId } : {}),
    ...(pendingCommand ? { pendingCommand } : {}),
  }))
  storage.setItem(`${root}:slots`, JSON.stringify([id, null, null]))
  return { id, pendingCommand }
}

describe('Cloud-2 hosted ChatService', () => {
  it('mints a local c2chat descriptor at pane boot with zero network mutation', async () => {
    const storage = new MemoryStorage()
    let calls = 0
    const service = makeHostedChatService(serviceOptions(storage, (async () => {
      calls += 1
      return json({ error: 'unexpected' }, 500)
    }) as typeof fetch))

    const created = await service.createSession({ title: null })
    expect(created.id).toMatch(/^c2chat-/)
    expect(calls).toBe(0)
    expect((await service.hydrateSession(created.id)).messages).toEqual([])
    expect(calls).toBe(0)
  })

  it('launches the exact graph workflow, streams the Agent Session, reconnects, and follows up durably', async () => {
    const storage = new MemoryStorage()
    const calls: Call[] = []
    let eventStream = 0
    let followUpCommandId = ''
    let followUpState = 'delivered'
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method: init.method ?? 'GET', headers, body })
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW, { name: 'other' }] })
      if (url.pathname.endsWith('/invocations')) {
        return json({ runId: 'run-1', invocationId: body.invocationId, status: 'running' }, 202)
      }
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) {
        return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed', agentId: 'agent-123' }] })
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1/driver')) return json({ applied: true })
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1/commands') && init.method === 'POST') {
        followUpCommandId = body.commandId
        return json({ command: { command_id: body.commandId, state: 'queued' }, duplicate: false }, 202)
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1/events') && headers.get('accept') === 'text/event-stream') {
        eventStream += 1
        if (eventStream === 1) return sse([
            event(1, 'turn.started', { turn: 0 }),
            event(2, 'message.delta', { delta: 'Hello ' }),
            event(3, 'tool.started', { tool: 'search', args: { q: 'x' } }),
            event(4, 'tool.completed', { tool: 'search', result: 'found', isError: false }),
            event(5, 'message.completed', { output: 'Hello from Sophia.' }),
          ])
        if (eventStream === 2) return sse([
            event(6, 'input.follow_up', { text: 'And now?' }),
            event(7, 'turn.started', { turn: 1 }),
            event(8, 'message.delta', { delta: 'Still here.' }),
            event(9, 'message.completed', { output: 'Still here.' }),
          ])
        followUpState = 'completed'
        return sse([{
          sessionId: 'ags-chat-1', seq: 10, ts: 1_010,
          type: 'command.completed', payload: { commandId: followUpCommandId },
        }])
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) {
        return followUpState !== 'completed'
          ? json(snapshot())
          : json({
            ...(snapshot('Still here.', [event(9, 'message.completed', { output: 'Still here.' })]) as object),
            document: {
              transcript: {
                order: ['assistant-1', `command:${followUpCommandId}:input`, 'assistant-2'],
                items: {
                  'assistant-1': { role: 'agent', text: 'Hello from Sophia.', ts: 2_000 },
                  [`command:${followUpCommandId}:input`]: { role: 'user', text: 'And now?', ts: 3_000 },
                  'assistant-2': { role: 'agent', text: 'Still here.', ts: 4_000 },
                },
              },
            },
          })
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1/commands')) return json({
        commands: followUpCommandId ? [{ command_id: followUpCommandId, state: followUpState }] : [],
      })
      return json({ error: `unhandled ${url.pathname}` }, 404)
    }) as typeof fetch

    const firstService = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await firstService.createSession()
    firstService.bindSlotSession(0, created.id)
    const first = await collect(await firstService.startTurn(created.id, 'Hello Sophia'))
    expect(first.outcome).toEqual({ state: 'completed' })
    expect(first.events).toContainEqual({ type: 'tool_call', gate: 'search', args: { q: 'x' } })
    expect(first.events.at(-1)).toEqual({ type: 'done', output: 'Hello from Sophia.' })

    const invocation = calls.find(call => call.url.pathname.endsWith('/invocations'))!
    expect(invocation.url.origin).toBe('https://api.canary.test')
    expect(invocation.headers.get('prefer')).toBe('respond-async')
    expect(invocation.body).toMatchObject({
      schema: 'choreograph.invocation-envelope.v1',
      target: {
        workflowName: WORKFLOW.name,
        workflowUri: WORKFLOW.workflowUri,
        definitionDigest: WORKFLOW.definitionDigest,
      },
      input: {
        definitionDocumentId: 'domain-agent-definition',
        trigger: {
          kind: 'sophia-cluster.message',
          eventId: expect.stringMatching(/^c2chat\.event\./),
          resource: `graph:sophia-cluster:chat:${created.id}`,
          text: 'Hello Sophia',
        },
        contextRefs: [],
        interactionMode: 'headed',
      },
      cause: {
        kind: 'trigger',
        ref: `graph:sophia-cluster:chat:${created.id}`,
      },
    })
    expect((invocation.body as Record<string, any>).input.inference).toBeUndefined()
    // The retired "Sophia-1 · profile-managed" entry omitted the model. A host that
    // does not advertise a voice offers none, so no picker is shown at all.
    expect(firstService.models()).toEqual([])
    expect(calls.every(call => !call.url.pathname.startsWith('/api/sessions'))).toBe(true)
    expect(calls.every(call => call.url.origin !== 'https://choreograph.sophia-labs.com')).toBe(true)

    const reconnected = makeHostedChatService(serviceOptions(storage, fetchImpl))
    expect(reconnected.slotSessions()[0]).toBe(created.id)
    const hydrated = await reconnected.hydrateSession(created.id)
    expect(hydrated.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Hello Sophia'],
      ['assistant', 'Hello from Sophia.'],
    ])
    const second = await collect(await reconnected.startTurn(created.id, 'And now?'))
    expect(second.outcome).toEqual({ state: 'completed' })
    expect(second.events.at(-1)).toEqual({ type: 'done', output: 'Still here.' })
    const command = calls.find(call => call.method === 'POST' && call.url.pathname.endsWith('/commands'))!
    expect(command.body).toMatchObject({
      clientId: expect.stringMatching(/^c2chat-client-/),
      name: 'follow_up',
      payload: { text: 'And now?' },
    })
    expect(calls.some(call => call.url.pathname.endsWith('/steer'))).toBe(false)
  })

  it('never retries an initial invocation whose 202 response was lost', async () => {
    const storage = new MemoryStorage()
    let invocationPosts = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) {
        invocationPosts += 1
        throw new TypeError('connection dropped after commit')
      }
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()

    const first = await service.startTurn(created.id, 'possibly committed').catch(error => error)
    expect(first).toBeInstanceOf(ChatServiceFailure)
    expect(first).toMatchObject({ phase: 'submit', recovery: 'reconcile' })
    const second = await service.startTurn(created.id, 'possibly committed').catch(error => error)
    expect(second).toBeInstanceOf(ChatServiceFailure)
    expect(invocationPosts).toBe(1)
  })

  it('resumes a persisted run id through Agent Session resolution without a second Invocation', async () => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, { runId: 'run-crash' })
    let invocationPosts = 0
    let agentReads = 0
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/invocations') && init.method === 'POST') {
        invocationPosts += 1
        return json({}, 500)
      }
      if (url.pathname.endsWith('/workflows/runs/run-crash/agents')) {
        agentReads += 1
        return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(snapshot())
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const hydrated = await service.hydrateSession(id)
    expect(hydrated.messages.map(message => message.content)).toEqual([
      'Same words', 'Hello from Sophia.',
    ])
    expect(agentReads).toBe(1)
    expect(invocationPosts).toBe(0)
  })

  it('persists a 202 run through resolution timeout and reload never relaunches it', async () => {
    const storage = new MemoryStorage()
    let invocationPosts = 0
    let resolve = false
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) {
        invocationPosts += 1
        return json({ runId: 'run-timeout', invocationId: body.invocationId }, 202)
      }
      if (url.pathname.endsWith('/workflows/runs/run-timeout/agents')) return json({
        agents: resolve ? [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] : [],
      })
      if (url.pathname.endsWith('/events')) return sse([event(1, 'message.completed', { output: 'ready' })])
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(snapshot('ready'))
      return json({}, 404)
    }) as typeof fetch
    const opts = { ...serviceOptions(storage, fetchImpl), resolveAttempts: 1 }
    const first = makeHostedChatService(opts)
    const created = await first.createSession()
    await expect(first.startTurn(created.id, 'hello')).rejects.toMatchObject({ recovery: 'reconcile' })
    resolve = true
    const reloaded = makeHostedChatService(opts)
    const turn = await collect(await reloaded.startTurn(created.id, 'hello'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(invocationPosts).toBe(1)
  })

  it.each(['accepted', 'queued', 'delivered'])('keeps a %s command resumable and projects its pending user bubble', async (state) => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, { runId: 'run-1', agentSessionId: 'ags-chat-1', pendingState: state })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: 'c2cmd:seeded', state }],
      })
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(snapshot())
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const hydrated = await service.hydrateSession(id)
    expect(hydrated.messages.map(message => [message.id, message.role, message.content])).toContainEqual([
      'command:c2cmd:seeded:input', 'user', 'Same words',
    ])
  })

  it('reconciles completed command transcript without dropping a repeated-text user turn or duplicating the pending bubble', async () => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, {
      runId: 'run-1', agentSessionId: 'ags-chat-1', pendingState: 'completed',
    })
    const canonical = {
      ...(snapshot('Second answer') as object),
      document: { transcript: {
        order: ['assistant-1', 'command:c2cmd:seeded:input', 'assistant-2'],
        items: {
          'assistant-1': { role: 'agent', text: 'First answer', ts: 2_000 },
          'command:c2cmd:seeded:input': { role: 'user', text: 'Same words', ts: 3_000 },
          'assistant-2': { role: 'agent', text: 'Second answer', ts: 4_000 },
        },
      } },
    }
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: 'c2cmd:seeded', state: 'completed' }],
      })
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(canonical)
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const hydrated = await service.hydrateSession(id)
    expect(hydrated.messages.filter(message => message.role === 'user').map(message => message.content))
      .toEqual(['Same words', 'Same words'])
    expect(hydrated.messages.filter(message => message.id === 'command:c2cmd:seeded:input')).toHaveLength(1)
  })

  it.each(['failed', 'cancelled', 'rejected'])('clears and surfaces a terminal %s command on reload', async (state) => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, { runId: 'run-1', agentSessionId: 'ags-chat-1', pendingState: state })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: 'c2cmd:seeded', state, error: 'terminal proof' }],
      })
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(snapshot())
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    await expect(service.hydrateSession(id)).rejects.toMatchObject({
      name: 'ChatServiceFailure', recovery: 'none',
    })
    const persisted = [...storage.values.values()].find(value => value.includes('c2chat-seeded') && value.includes('clientId'))!
    expect(JSON.parse(persisted).pendingCommand).toBeUndefined()
  })

  it('waits beyond message.completed for the durable command terminal and canonical transcript', async () => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, {
      runId: 'run-1', agentSessionId: 'ags-chat-1', pendingState: 'delivered',
    })
    let state = 'delivered'
    let streams = 0
    let releaseSleep!: () => void
    let markSleeping!: () => void
    const sleeping = new Promise<void>(resolve => { markSleeping = resolve })
    const sleepGate = new Promise<void>(resolve => { releaseSleep = resolve })
    const canonical = () => state === 'completed'
      ? {
          ...(snapshot('Second answer') as object),
          document: { transcript: {
            order: ['assistant-1', 'command:c2cmd:seeded:input', 'assistant-2'],
            items: {
              'assistant-1': { role: 'agent', text: 'First answer', ts: 2_000 },
              'command:c2cmd:seeded:input': { role: 'user', text: 'Same words', ts: 3_000 },
              'assistant-2': { role: 'agent', text: 'Second answer', ts: 4_000 },
            },
          } },
        }
      : snapshot('First answer')
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = new Headers(init.headers)
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: 'c2cmd:seeded', state }],
      })
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(canonical())
      if (url.pathname.endsWith('/events') && headers.get('accept') === 'text/event-stream') {
        streams += 1
        if (streams === 1) return sse([event(5, 'message.completed', { output: 'Second answer' })])
        state = 'completed'
        return sse([{
          sessionId: 'ags-chat-1', seq: 6, ts: 1_006,
          type: 'command.completed', payload: { commandId: 'c2cmd:seeded' },
        }])
      }
      if (url.pathname.endsWith('/events')) return json({ events: [] })
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService({
      ...serviceOptions(storage, fetchImpl),
      sleep: async () => { markSleeping(); await sleepGate },
    })
    const handle = await service.startTurn(id, 'Same words')
    let settled = false
    void handle.done.then(() => { settled = true })
    await sleeping
    expect(settled).toBe(false)
    const pending = await service.hydrateSession(id)
    expect(pending.messages).toContainEqual(expect.objectContaining({
      id: 'command:c2cmd:seeded:input', role: 'user', content: 'Same words',
    }))
    await expect(service.startTurn(id, 'A newer message')).rejects.toMatchObject({
      recovery: 'reconcile',
    })
    releaseSleep()
    await expect(handle.done).resolves.toEqual({ state: 'completed' })
    const final = await service.hydrateSession(id)
    expect(final.messages.filter(message => message.id === 'command:c2cmd:seeded:input')).toHaveLength(1)
  })

  it('rechecks a persisted command at startTurn and accepts new text once it is completed', async () => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, {
      runId: 'run-1', agentSessionId: 'ags-chat-1', pendingState: 'completed',
    })
    const submitted: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/commands') && init.method === 'POST') {
        submitted.push(body.payload.text)
        return json({ command: { command_id: body.commandId, state: 'queued' } }, 202)
      }
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: 'c2cmd:seeded', state: 'completed' }],
      })
      if (url.pathname.endsWith('/driver')) return json({ applied: true })
      if (url.pathname.endsWith('/events') && headers.get('accept') === 'text/event-stream') {
        return sse([event(9, 'turn.failed', { message: 'stop after submit proof' })])
      }
      return json(snapshot())
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const result = await collect(await service.startTurn(id, 'A newer message'))
    expect(submitted).toEqual(['A newer message'])
    expect(result.outcome.state).toBe('failed')
  })

  it('treats turn.failed as failed and cancels the SSE reader', async () => {
    const storage = new MemoryStorage()
    let readerCancelled = false
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) return json({ runId: 'run-1', invocationId: body.invocationId }, 202)
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      if (url.pathname.endsWith('/events')) {
        const payload = `data: ${JSON.stringify(event(1, 'turn.failed', { message: 'worker broke' }))}\n\n`
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode(payload)) },
          cancel() { readerCancelled = true },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()
    const result = await collect(await service.startTurn(created.id, 'fail please'))
    expect(result.outcome).toMatchObject({ state: 'failed' })
    expect(result.events).toContainEqual({ type: 'error', message: 'worker broke' })
    expect(readerCancelled).toBe(true)
  })

  it('terminalizes session.faulted before any assistant body and does not wait for Session GET', async () => {
    const storage = new MemoryStorage()
    let invocationPosts = 0
    let sessionReads = 0
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) {
        invocationPosts += 1
        return json({ runId: 'run-1', invocationId: body.invocationId }, 202)
      }
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) {
        return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      }
      if (url.pathname.endsWith('/events')) {
        return sse([sessionFaultedEvent(1, 'immutable source admission denied')])
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) {
        sessionReads += 1
        return json({}, 500)
      }
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()
    const result = await collect(await service.startTurn(created.id, 'fail before body'))

    expect(result.events).toEqual([{ type: 'error', message: 'immutable source admission denied' }])
    expect(result.outcome).toMatchObject({
      state: 'failed',
      failure: { message: 'immutable source admission denied', recovery: 'none' },
    })
    expect(sessionReads).toBe(0)
    expect(invocationPosts).toBe(1)
  })

  it('recognizes a failed and faulted Session GET after SSE closes without a terminal event', async () => {
    const storage = new MemoryStorage()
    let invocationPosts = 0
    let sessionReads = 0
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) {
        invocationPosts += 1
        return json({ runId: 'run-1', invocationId: body.invocationId }, 202)
      }
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) {
        return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      }
      if (url.pathname.endsWith('/events') && headers.get('accept') === 'text/event-stream') {
        return sse([])
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) {
        sessionReads += 1
        return json({
          ...(snapshot('', []) as object),
          session: {
            sessionId: 'ags-chat-1',
            runId: 'run-1',
            status: 'failed',
            lifecycleState: 'faulted',
            error: 'admission failed after stream close',
          },
          document: { transcript: { order: [], items: {} } },
        })
      }
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()
    const result = await collect(await service.startTurn(created.id, 'close first'))

    expect(result.events).toEqual([{ type: 'error', message: 'admission failed after stream close' }])
    expect(result.outcome).toMatchObject({
      state: 'failed',
      failure: { message: 'admission failed after stream close', recovery: 'none' },
    })
    expect(sessionReads).toBe(1)
    expect(invocationPosts).toBe(1)
  })

  it('reloads one stable non-speech failure presentation without transcript duplication or reinvocation', async () => {
    const storage = new MemoryStorage()
    const { id } = seedDescriptor(storage, { runId: 'run-1', agentSessionId: 'ags-chat-1' })
    let invocationPosts = 0
    const canonical = {
      session: {
        sessionId: 'ags-chat-1',
        runId: 'run-1',
        status: 'failed',
        lifecycleState: 'faulted',
        error: 'workspace digest admission failed',
        completedAt: 4_000,
      },
      document: { transcript: {
        order: [`${id}:initial-user`, 'assistant-1'],
        items: {
          [`${id}:initial-user`]: { role: 'user', text: 'Same words', ts: 1_000 },
          'assistant-1': { role: 'agent', text: 'Earlier canonical speech', ts: 2_000 },
        },
      } },
      events: [sessionFaultedEvent(9, 'workspace digest admission failed')],
    }
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/invocations') && init.method === 'POST') {
        invocationPosts += 1
        return json({}, 500)
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(canonical)
      return json({}, 404)
    }) as typeof fetch
    const opts = serviceOptions(storage, fetchImpl)
    const first = makeHostedChatService(opts)
    const firstHydrate = await first.hydrateSession(id)
    const repeatedHydrate = await first.hydrateSession(id)
    const reloaded = makeHostedChatService(opts)
    const reloadHydrate = await reloaded.hydrateSession(id)

    for (const hydrated of [firstHydrate, repeatedHydrate, reloadHydrate]) {
      expect(hydrated.messages.filter(message => message.role === 'user')).toHaveLength(1)
      expect(hydrated.messages.filter(message => message.content === 'Earlier canonical speech')).toHaveLength(1)
      const failures = hydrated.messages.filter(message => message.error)
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({
        id: `${id}:agent-session-failure`,
        content: '',
        parts: [{ type: 'text', content: '' }],
        error: 'workspace digest admission failed',
      })
    }
    const persisted = JSON.parse(storage.getItem(
      `shrubbery:c2chat:v1:vera:sophia-cluster:descriptor:${id}`,
    )!)
    expect(persisted).toMatchObject({ virtualId: id, runId: 'run-1', agentSessionId: 'ags-chat-1' })
    expect(invocationPosts).toBe(0)
  })

  it('reconciles a dropped idempotent follow-up response through the command ledger', async () => {
    const storage = new MemoryStorage()
    let loseCommand = false
    let submittedCommandId = ''
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) return json({ runId: 'run-1', invocationId: body.invocationId }, 202)
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      if (url.pathname.endsWith('/driver')) return json({ applied: true })
      if (url.pathname.endsWith('/commands') && init.method === 'POST') {
        submittedCommandId = body.commandId
        if (loseCommand) throw new TypeError('lost response')
        return json({ command: { command_id: body.commandId, state: 'queued' } }, 202)
      }
      if (url.pathname.endsWith('/commands')) return json({
        commands: [{ command_id: submittedCommandId, state: loseCommand ? 'completed' : 'queued' }],
      })
      if (url.pathname.endsWith('/events') && headers.get('accept') === 'text/event-stream') {
        return loseCommand
          ? sse([
            event(2, 'message.completed', { output: 'reconciled' }),
            { sessionId: 'ags-chat-1', seq: 3, ts: 1_003, type: 'command.completed', payload: { commandId: submittedCommandId } },
          ])
          : sse([event(1, 'message.completed', { output: 'first' })])
      }
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) {
        if (!loseCommand) return json(snapshot('first'))
        return json({
          ...(snapshot('reconciled') as object),
          document: { transcript: {
            order: ['assistant-1', `command:${submittedCommandId}:input`, 'assistant-2'],
            items: {
              'assistant-1': { role: 'agent', text: 'first', ts: 2_000 },
              [`command:${submittedCommandId}:input`]: { role: 'user', text: 'second', ts: 3_000 },
              'assistant-2': { role: 'agent', text: 'reconciled', ts: 4_000 },
            },
          } },
        })
      }
      return json({}, 404)
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()
    await collect(await service.startTurn(created.id, 'first'))
    loseCommand = true
    const result = await collect(await service.startTurn(created.id, 'second'))
    expect(result.outcome).toEqual({ state: 'completed' })
  })

  it('submits a durable abort command and never uses steer', async () => {
    const storage = new MemoryStorage()
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
      if (url.pathname.endsWith('/workflows')) return json({ workflows: [WORKFLOW] })
      if (url.pathname.endsWith('/invocations')) return json({ runId: 'run-1', invocationId: body.invocationId }, 202)
      if (url.pathname.endsWith('/workflows/runs/run-1/agents')) return json({ agents: [{ sessionId: 'ags-chat-1', label: 'pilot-headed' }] })
      if (url.pathname.endsWith('/events')) return sse([event(1, 'message.completed', { output: 'ready' })])
      if (url.pathname.endsWith('/agent-sessions/ags-chat-1')) return json(snapshot('ready'))
      if (init.method === 'POST') {
        posts.push({ path: url.pathname, body })
        return url.pathname.endsWith('/driver') ? json({ applied: true }) : json({ command: { state: 'queued' } }, 202)
      }
      return json({ commands: [] })
    }) as typeof fetch
    const service = makeHostedChatService(serviceOptions(storage, fetchImpl))
    const created = await service.createSession()
    await collect(await service.startTurn(created.id, 'hello'))
    await service.abort(created.id)
    expect(posts.some(post => post.path.endsWith('/commands') && post.body.name === 'abort')).toBe(true)
    expect(posts.some(post => post.path.endsWith('/steer'))).toBe(false)
  })

  it('ignores legacy ses_* storage and rejects binding it into a Cloud-2 slot', async () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery:chat:vera:sophia-cluster:slots', JSON.stringify(['ses_old', null, null]))
    const service = makeHostedChatService(serviceOptions(storage, (async () => json({})) as typeof fetch))
    expect(service.slotSessions()).toEqual([null, null, null])
    expect(() => service.bindSlotSession(0, 'ses_old')).toThrow('c2chat-*')
  })
})
