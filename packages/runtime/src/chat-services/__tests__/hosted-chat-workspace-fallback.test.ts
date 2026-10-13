/**
 * The hosted chat against a real HTTP server that speaks the gateway's graph
 * routes the way Choreograph answers them: coded error envelopes before a run
 * exists, 202 + runId on success, the headed pilot session, its transcript and
 * its SSE event stream. No fetch stub: every request crosses a real socket.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatServiceFailure } from '../chat-service.js'
import { makeHostedChatService } from '../hosted-chat-service.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const DOMAIN = {
  name: 'domain-agent-activity-loop-v1',
  workflowUri: 'urn:sophia:wf:domain-agent-activity-loop-v1',
  definitionDigest: 'a'.repeat(64),
  inputs: { type: 'object', required: ['definitionDocumentId', 'trigger', 'contextRefs'] },
  outputs: { type: 'object' },
}
const WORKSPACE = {
  name: 'workspace-chat-v1',
  workflowUri: 'urn:sophia:wf:workspace-chat-v1',
  definitionDigest: 'b'.repeat(64),
  inputs: { type: 'object', required: ['trigger'] },
  outputs: { type: 'object' },
}

interface Received {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly body: any
}

type Handler = (request: Received) => { status: number; body?: unknown; sse?: unknown[] } | undefined

/** A graph route surface: `/g/{graph}/…` with stateful, programmable answers. */
class GraphRoutes {
  server!: Server
  base = ''
  readonly received: Received[] = []
  /** Per-graph Choreograph behaviour for POST /invocations. */
  invocation: Handler = () => undefined
  runs: Record<string, unknown>[] = []
  provisioned = new Set<string>()
  private runSeq = 0

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Like the gateway: the SPA is cross-origin, so answer CORS and preflights.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', this.base)
    let raw = ''
    for await (const chunk of req) raw += chunk
    const received: Received = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: raw ? JSON.parse(raw) : undefined,
    }
    this.received.push(received)
    const answer = this.route(received)
    if (answer.sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(answer.sse.map(item => `data: ${JSON.stringify(item)}\n\n`).join(''))
      return
    }
    res.writeHead(answer.status, { 'content-type': 'application/json' })
    res.end(answer.body === undefined ? '' : JSON.stringify(answer.body))
  }

  private route(request: Received): { status: number; body?: unknown; sse?: unknown[] } {
    const match = /^\/g\/([^/]+)(\/.*)$/.exec(request.path)
    if (!match) return { status: 404, body: { error: 'no route' } }
    const [, graphId, rest] = match
    if (rest === '/workflows') return { status: 200, body: { workflows: [DOMAIN, WORKSPACE] } }
    if (rest === '/workflows/runs') return { status: 200, body: { runs: this.runs, count: this.runs.length } }
    if (rest === '/invocations' && request.method === 'POST') {
      const programmed = this.invocation(request)
      if (programmed) return programmed
      const target = request.body.target.workflowName
      if (target === DOMAIN.name && !this.provisioned.has(graphId)) {
        return {
          status: 404,
          body: { error: { code: 'domain_agent_not_provisioned', message: `graph '${graphId}' has no Domain Agent definition` } },
        }
      }
      const runId = `wfr-${++this.runSeq}`
      this.runs.push({ runId, workflowName: target, graphId, status: 'running', startedAt: Date.now() })
      return { status: 202, body: { runId, invocationId: request.body.invocationId, status: 'running', workflowId: target } }
    }
    const agents = /^\/workflows\/runs\/([^/]+)\/agents$/.exec(rest)
    if (agents) {
      return { status: 200, body: { agents: [{ sessionId: `ags-${agents[1]}`, label: 'pilot-headed', agentId: 'agent-1' }] } }
    }
    const session = /^\/agent-sessions\/([^/]+)(\/events)?$/.exec(rest)
    if (session) {
      const [, sessionId, events] = session
      const reply = `Reply in ${graphId}.`
      if (events) {
        return {
          status: 200,
          sse: [
            { sessionId, seq: 1, ts: 1, type: 'turn.started', payload: { value: { turn: 0 } } },
            { sessionId, seq: 2, ts: 2, type: 'message.completed', payload: { value: { output: reply } } },
          ],
        }
      }
      return {
        status: 200,
        body: {
          session: { sessionId, graphId, label: 'pilot-headed', status: 'restartable' },
          document: { transcript: { order: ['a1'], items: { a1: { role: 'agent', text: reply, ts: 2 } } } },
          events: [],
        },
      }
    }
    return { status: 404, body: { error: `unhandled ${rest}` } }
  }

  invocations(): Received[] {
    return this.received.filter(item => item.path.endsWith('/invocations'))
  }
}

function service(routes: GraphRoutes, storage: MemoryStorage, graphId = 'angels') {
  return makeHostedChatService({
    graphBaseUrl: (graph: string) => `${routes.base}/g/${graph}`,
    graphId: () => graphId,
    userId: () => 'vera',
    token: () => 'jwt',
    storage,
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof makeHostedChatService>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

/** The descriptor the `angels` panel was left with: a 500 marked "may have committed". */
function seedStuck(storage: MemoryStorage, ageMs: number, graphId = 'angels'): string {
  const id = 'c2chat-stuck'
  const root = `shrubbery:c2chat:v1:vera:${graphId}`
  const at = new Date(Date.now() - ageMs).toISOString()
  storage.setItem(`${root}:descriptor-index`, JSON.stringify([id]))
  storage.setItem(`${root}:descriptor:${id}`, JSON.stringify({
    schema: 'shrubbery.cloud2-chat-descriptor.v1',
    virtualId: id,
    graphId,
    title: null,
    modelId: 'sophia-1/profile',
    clientId: 'c2chat-client-stuck',
    createdAt: at,
    updatedAt: at,
    cursor: 0,
    invocationId: 'c2chat.inv.stuck',
    invocationPending: true,
    initialUserText: 'hola',
    initialUserMessageId: `${id}:initial-user`,
  }))
  storage.setItem(`${root}:slots`, JSON.stringify([id, null, null]))
  return id
}

describe('hosted chat: built-in workspace fallback and honest launch failures', () => {
  let routes: GraphRoutes
  beforeEach(async () => {
    routes = new GraphRoutes()
    await routes.start()
  })
  afterEach(async () => routes.stop())

  it('falls back to workspace-chat-v1 when the graph has no Domain Agent, and answers', async () => {
    const storage = new MemoryStorage()
    const chat = service(routes, storage)
    const created = await chat.createSession()
    const turn = await collect(await chat.startTurn(created.id, 'What is here?'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(turn.events.at(-1)).toEqual({ type: 'done', output: 'Reply in angels.' })

    const [domain, workspace] = routes.invocations()
    expect(domain.body.target.workflowName).toBe(DOMAIN.name)
    expect(workspace.body).toMatchObject({
      target: { workflowName: WORKSPACE.name, workflowUri: WORKSPACE.workflowUri, definitionDigest: WORKSPACE.definitionDigest },
      input: { trigger: { kind: 'sophia-cluster.message', text: 'What is here?' }, contextRefs: [], interactionMode: 'headed' },
      graph: { graphId: 'angels' },
    })
    expect(workspace.body.input.definitionDocumentId).toBeUndefined()
    expect(workspace.body.invocationId).not.toBe(domain.body.invocationId)

    // A second conversation in the same graph goes straight to the built-in path.
    const next = await chat.createSession()
    await collect(await chat.startTurn(next.id, 'Again'))
    expect(routes.invocations().slice(2).map(item => item.body.target.workflowName)).toEqual([WORKSPACE.name])
  })

  it('keeps the Domain Agent where one is provisioned', async () => {
    routes.provisioned.add('sophia-cluster')
    const chat = service(routes, new MemoryStorage(), 'sophia-cluster')
    const created = await chat.createSession()
    const turn = await collect(await chat.startTurn(created.id, 'Hi'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(routes.invocations().map(item => item.body.target.workflowName)).toEqual([DOMAIN.name])
  })

  it('treats a coded 500 as definite: nothing pending, and the next message launches', async () => {
    let first = true
    routes.invocation = () => {
      if (!first) return undefined
      first = false
      return { status: 500, body: { error: { code: 'input_build_failed', message: 'boom' } } }
    }
    routes.provisioned.add('angels')
    const storage = new MemoryStorage()
    const chat = service(routes, storage)
    const created = await chat.createSession()
    const failure = await chat.startTurn(created.id, 'one').catch(error => error)
    expect(failure).toBeInstanceOf(ChatServiceFailure)
    expect(failure).toMatchObject({ phase: 'submit', recovery: 'resubmit' })
    expect((failure as Error).message).toMatch(/input_build_failed/)
    expect((await chat.hydrateSession(created.id)).messages).toEqual([])
    const turn = await collect(await chat.startTurn(created.id, 'two, different words'))
    expect(turn.outcome).toEqual({ state: 'completed' })
  })

  it('reports a denial as a definite, non-retryable failure', async () => {
    routes.invocation = () => ({ status: 403, body: { error: { code: 'interaction_mode_denied', message: 'no' } } })
    const chat = service(routes, new MemoryStorage())
    const created = await chat.createSession()
    const failure = await chat.startTurn(created.id, 'hi').catch(error => error)
    expect(failure).toMatchObject({ recovery: 'none', message: 'You do not have access to chat in this workspace.' })
  })

  it('leaves an uncoded gateway 502 uncertain (the run may exist)', async () => {
    routes.invocation = () => ({ status: 502, body: { error: 'upstream reset' } })
    const chat = service(routes, new MemoryStorage())
    const created = await chat.createSession()
    const failure = await chat.startTurn(created.id, 'hi').catch(error => error)
    expect(failure).toMatchObject({ recovery: 'reconcile' })
  })

  it('clears the stuck angels conversation on load when no run was started', async () => {
    const storage = new MemoryStorage()
    const id = seedStuck(storage, 60 * 60_000)
    const chat = service(routes, storage)
    const hydrated = await chat.hydrateSession(id)
    expect(hydrated.messages).toEqual([])
    const runsQuery = routes.received.find(item => item.path === '/g/angels/workflows/runs')
    expect(runsQuery?.query.get('graph_id')).toBe('angels')
    const stored = JSON.parse(storage.getItem(`shrubbery:c2chat:v1:vera:angels:descriptor:${id}`)!)
    expect(stored.invocationPending).toBe(false)
    expect(stored.initialUserText).toBeUndefined()
    // …and the conversation works again, through the built-in assistant.
    const turn = await collect(await chat.startTurn(id, 'hola otra vez'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(routes.invocations().at(-1)?.body.target.workflowName).toBe(WORKSPACE.name)
  })

  it('adopts the one run a lost launch did start, and sends new text as a follow-up', async () => {
    const storage = new MemoryStorage()
    const id = seedStuck(storage, 60 * 60_000)
    routes.runs.push({ runId: 'wfr-lost', workflowName: WORKSPACE.name, graphId: 'angels', status: 'running', startedAt: Date.now() - 59 * 60_000 })
    const chat = service(routes, storage)
    await chat.hydrateSession(id)
    const stored = JSON.parse(storage.getItem(`shrubbery:c2chat:v1:vera:angels:descriptor:${id}`)!)
    expect(stored.runId).toBe('wfr-lost')
    expect(stored.invocationPending).toBe(false)
    expect(routes.invocations()).toEqual([])
  })

  it('does not second-guess a launch still inside its grace period', async () => {
    const storage = new MemoryStorage()
    const id = seedStuck(storage, 5_000)
    const chat = service(routes, storage)
    const failure = await chat.startTurn(id, 'hola').catch(error => error)
    expect(failure).toMatchObject({ recovery: 'reconcile' })
    expect(routes.invocations()).toEqual([])
  })
})
