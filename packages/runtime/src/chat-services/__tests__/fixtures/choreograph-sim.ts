/**
 * A scripted Choreograph behind the gateway's graph routes, as a REAL HTTP server
 * (NO MOCKS: every request the hosted chat makes crosses a real socket).
 *
 * WHAT IT SPEAKS, read from the live probe of 2026-09-28 (F-step-zero) and the
 * deployed source, not invented:
 *
 *   GET  /g/{graph}/workflows                      the registry
 *   POST /g/{graph}/invocations                    404 domain_agent_not_provisioned, or 202 + runId
 *   GET  /g/{graph}/workflows/runs/{run}/agents    the headed pilot session, with the resolved `model`
 *   POST /g/{graph}/agent-sessions/{id}/driver     claim
 *   POST /g/{graph}/agent-sessions/{id}/commands   follow_up / abort
 *   GET  /g/{graph}/agent-sessions/{id}/commands   the command ledger
 *   GET  /g/{graph}/agent-sessions/{id}            session + transcript + events
 *   GET  /g/{graph}/agent-sessions/{id}/events     SSE, or the JSON face
 *
 * DETERMINISTIC RACES. A turn is a list of STAGES. Stage 0 is visible the moment
 * the turn starts. Every request to `/events` (SSE or JSON) answers with what is
 * durable NOW and, after its answer, releases the next stage: the live host's SSE
 * connections closed after tens of milliseconds, and what happened between two
 * reads is exactly what this reproduces. The last stage's release completes the
 * turn: command ledger, transcript and session status.
 *
 * WHAT THE TRANSCRIPT LOOKS LIKE, as the live session's did: items carry NO `ts`;
 * a follow-up is `command:<id>:input` (user) and `command:<id>:result` (assistant,
 * kind `command-result`); the first answer is `result:<session>:generation:0`
 * (kind `node-result`); and, with `echo`, a trailing `result:aca_<hash>` node-result
 * repeats the last command's text (the live session did exactly this).
 *
 * Times are the sim's own clock (`sim.clock`, advanced a second per event), so a
 * test can assert a message's time exactly and tell it from the wall clock.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const DOMAIN_WORKFLOW = {
  name: 'domain-agent-activity-loop-v1',
  workflowUri: 'urn:sophia:wf:domain-agent-activity-loop-v1',
  definitionDigest: 'a'.repeat(64),
  inputs: { type: 'object', required: ['definitionDocumentId', 'trigger', 'contextRefs'] },
  outputs: { type: 'object' },
}

/** What the registry's `host` block says of the host's limits (`C-choreograph-return.md` 1.8, R9). */
export interface HostLimits {
  readonly triggerTextMaxChars: number
  readonly titleMaxChars: number
  readonly seedMaxBytes: number
  readonly seedTtlSeconds: number
  readonly seedRenderMaxChars: number
}

/** The limits of Choreograph `e9a294898e8e`, as the boot smoke read them (R9). */
export const LIVE_HOST_LIMITS: HostLimits = Object.freeze({
  triggerTextMaxChars: 32_000,
  titleMaxChars: 200,
  seedMaxBytes: 524_288,
  seedTtlSeconds: 3_600,
  seedRenderMaxChars: 120_000,
})

export interface WorkspaceRegistryOptions {
  /** Advertise `inputs.properties.inference`. */
  readonly inference?: boolean
  /** Advertise `inputs.properties.seed` (and `title`, which the host declares with it). */
  readonly seed?: boolean
  /** The entry's definition digest (default `b`×64, a digest no release served). */
  readonly definitionDigest?: string
  /** The registry entry's `host` block, as the voices release serves it. Absent: an older host's entry. */
  readonly host?: {
    readonly limits?: Partial<HostLimits>
    /**
     * What each role's chat may do (the empowered-chat release's advert, `RETURN-spa-chat.md` §5):
     * `{ owner: 'write', editor: 'write', viewer: 'read' }`. Absent: a reader-only host.
     */
    readonly access?: Readonly<Record<string, string>>
  }
}

/** The `workspace-chat-v1` registry entry, with the optional inputs it may advertise. */
export function workspaceWorkflow(options: WorkspaceRegistryOptions = {}) {
  return {
    name: 'workspace-chat-v1',
    workflowUri: 'urn:sophia:wf:workspace-chat-v1',
    definitionDigest: options.definitionDigest ?? 'b'.repeat(64),
    inputs: {
      type: 'object',
      required: ['trigger'],
      additionalProperties: false,
      properties: {
        trigger: { type: 'object' },
        contextRefs: { type: 'array' },
        interactionMode: { type: 'string' },
        ...(options.inference
          ? {
            inference: {
              type: 'object',
              additionalProperties: false,
              required: ['provider', 'model'],
              properties: { provider: { enum: ['openrouter'] }, model: { type: 'string', minLength: 1, maxLength: 200 } },
            },
          }
          : {}),
        ...(options.seed
          ? {
            title: { type: 'string', maxLength: 200 },
            seed: {
              type: 'object',
              additionalProperties: false,
              required: ['seedDigest', 'bytes', 'continuesConversation', 'window'],
              properties: {
                seedDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
                bytes: { type: 'integer', minimum: 1, maximum: LIVE_HOST_LIMITS.seedMaxBytes },
                continuesConversation: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['archiveConversationUrn', 'revisionId'],
                  properties: { archiveConversationUrn: { type: 'string', minLength: 1 }, revisionId: { type: 'string', minLength: 1 } },
                },
                window: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kept', 'omitted', 'total'],
                  properties: {
                    kept: { type: 'integer', minimum: 1 },
                    omitted: { type: 'integer', minimum: 0 },
                    total: { type: 'integer', minimum: 1 },
                  },
                },
                title: { type: 'string', maxLength: 200 },
              },
            },
          }
          : {}),
      },
    },
    outputs: { type: 'object' },
    ...(options.host
      ? {
        host: {
          defaults: { inference: { provider: 'openrouter', model: 'google/gemini-2.5-flash' } },
          pricing: { currency: 'USD', markupPercent: 15, markupBps: 1500 },
          limits: { ...LIVE_HOST_LIMITS, ...(options.host.limits ?? {}) },
          ...(options.host.access ? { access: options.host.access } : {}),
        },
      }
      : {}),
  }
}

export const DEFAULT_MODEL = 'google/gemini-2.5-flash'

/** One event of a turn, before the sim gives it a sequence number and a time. */
export interface TurnEvent {
  readonly type: string
  readonly value?: Record<string, unknown>
  /** Fields the host puts on the payload itself, beside `value` (a ledger event's `kind`, `spentDelta`). */
  readonly extra?: Record<string, unknown>
}

/** Shorthands for the events a reply is made of. */
export const delta = (text: string): TurnEvent => ({ type: 'message.delta', value: { delta: text } })
export const started = (turn = 0): TurnEvent => ({ type: 'turn.started', value: { turn } })
export const turnDone = (turn = 0): TurnEvent => ({ type: 'turn.completed', value: { turn } })
export const completed = (output: string): TurnEvent => ({ type: 'message.completed', value: { output } })
export const toolStarted = (tool: string, args: Record<string, unknown> = {}): TurnEvent =>
  ({ type: 'tool.started', value: { tool, args } })
export const toolCompleted = (tool: string, result: string): TurnEvent =>
  ({ type: 'tool.completed', value: { tool, result, isError: false } })
export const turnFailed = (message: string): TurnEvent => ({ type: 'turn.failed', value: { message } })

/**
 * A tool call as the DURABLE session record keeps it (Choreograph's `session-event-mirror.ts`): the
 * tool's name and outcome, no arguments, no result. `targets` is the id-only receipt the empowered-chat
 * release asks the mirror to add (`RETURN-spa-chat.md` §5); absent, the record is as it is today.
 */
export const durableToolStarted = (tool: string, targets?: readonly Record<string, unknown>[]): TurnEvent =>
  ({ type: 'tool.started', value: { tool, ...(targets ? { targets } : {}) } })
export const durableToolCompleted = (tool: string, targets?: readonly Record<string, unknown>[], isError = false): TurnEvent =>
  ({ type: isError ? 'tool.failed' : 'tool.completed', value: { tool, isError, ...(targets ? { targets } : {}) } })

/**
 * The session budget ledger's events as the live host wrote them (F-step-zero, turn 2 of
 * the probe): the fields ride the PAYLOAD, not `payload.value`. A model call is reserved
 * at its worst case and settled at what it cost; only the settle is a cost.
 */
export const reserved = (worstCaseMicroUsd = 97_441): TurnEvent => ({
  type: 'budget.ledger_updated',
  extra: {
    kind: 'inference_reserved',
    reservedDelta: { turns: 1, wallTimeMs: 0, tokens: 47_775, costUsdMicros: worstCaseMicroUsd, artifactBytes: 0 },
    spentDelta: { turns: 0, wallTimeMs: 0, tokens: 0, costUsdMicros: 0, artifactBytes: 0 },
  },
})
export const settled = (costUsdMicros: number): TurnEvent => ({
  type: 'budget.ledger_updated',
  extra: {
    kind: 'inference_settled',
    reservedDelta: { turns: -1, wallTimeMs: 0, tokens: -47_775, costUsdMicros: -97_441, artifactBytes: 0 },
    spentDelta: { turns: 1, wallTimeMs: 784, tokens: 2_287, costUsdMicros, artifactBytes: 0 },
  },
})

export interface TurnScript {
  /** The durable assistant text once the turn completes. */
  readonly answer: string
  /** Events revealed one stage per `/events` request. Stage 0 is visible at once. */
  readonly stages: readonly (readonly TurnEvent[])[]
  /** After a follow-up, also write the run-level `node-result` repeating the answer. */
  readonly echo?: boolean
  /** Model the session resolved (default: the sim's own). */
  readonly model?: string
  /** The turn ends in failure: no answer is written, and the command is `failed`. */
  readonly fails?: boolean
}

/** A whole, ordinary reply: a start, the words in one delta, an end, all in stage 0. */
export function plainTurn(answer: string, options: { echo?: boolean; model?: string } = {}): TurnScript {
  return {
    answer,
    stages: [[started(), delta(answer), turnDone(), completed(answer)]],
    ...(options.echo ? { echo: true } : {}),
    ...(options.model ? { model: options.model } : {}),
  }
}

/** An ordinary reply that says what it cost: reserved at a worst case, settled at `microUsd`. */
export function costedTurn(answer: string, microUsd: number, options: { echo?: boolean; model?: string } = {}): TurnScript {
  return {
    answer,
    stages: [[started(), reserved(), delta(answer), settled(microUsd), turnDone(), completed(answer)]],
    ...(options.echo ? { echo: true } : {}),
    ...(options.model ? { model: options.model } : {}),
  }
}

/** A turn the host ends with `turn.failed`, the way it ends a call the balance cannot cover. */
export function failingTurn(message: string): TurnScript {
  return { answer: '', stages: [[started(), reserved(), turnFailed(message)]], fails: true }
}

export interface SimEvent {
  readonly sessionId: string
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload: Record<string, unknown>
}

export interface SimItem {
  readonly role: string
  readonly kind: string
  readonly text: string
  readonly state: string
  readonly model?: string
  /** The live host's transcript items carry none; a test may add one. */
  readonly ts?: number
}

export interface SimCommand {
  command_id: string
  name: string
  state: 'queued' | 'delivered' | 'completed' | 'failed'
  submitted_at: number
  delivered_at: number | null
  completed_at: number | null
  payload: unknown
}

export interface Received {
  readonly method: string
  /** Full request path. */
  readonly path: string
  /** Path below `/g/{graph}`, or the full path for a route outside a graph. */
  readonly route: string
  readonly graph: string | null
  readonly query: URLSearchParams
  readonly headers: IncomingHttpHeaders
  // biome-ignore lint/suspicious/noExplicitAny: the scripted host reads whatever JSON the client sent
  readonly body: any
  /** The body exactly as it arrived (a content-addressed store hashes bytes, not a re-serialisation). */
  readonly rawBody: string
}

/** What a route answers: JSON with a status, or an event stream. */
export type Answer =
  | { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }
  | { readonly sse: readonly unknown[]; readonly after?: () => void }
  /** The host takes the request and never answers it (a wedged proxy): the socket stays open until `stop()`. */
  | { readonly hang: true }

export class SimSession {
  /** The person's first message: the host keeps it on the session document (`document.source.prompt`). */
  prompt = ''
  readonly events: SimEvent[] = []
  readonly order: string[] = []
  readonly items: Record<string, SimItem> = {}
  readonly commands: SimCommand[] = []
  status = 'queued'
  /** The built-in mode the host bound this session to (`agentOntologyBinding.mode.iri`); absent: not said. */
  mode: string | null = null
  /** What the session's document records of its graph access (`document.source.graphAccess`); absent: not said. */
  graphAccess: 'read' | 'write' | null = null
  updatedAt: number
  completedAt: number | null = null
  private seq = 0
  private stages: (readonly TurnEvent[])[] = []
  private finish: (() => void) | null = null

  constructor(
    private readonly sim: ChoreographSim,
    readonly id: string,
    readonly runId: string,
    readonly graphId: string,
    readonly model: string,
    readonly createdAt: number,
  ) {
    this.updatedAt = createdAt
  }

  append(type: string, value?: Record<string, unknown>, extra: Record<string, unknown> = {}): SimEvent {
    const ts = this.sim.tick()
    const event: SimEvent = {
      sessionId: this.id,
      seq: ++this.seq,
      ts,
      type,
      payload: {
        schema: 'sophia.agent-session-semantic-event.v1',
        sourceType: type,
        ...(value ? { value } : {}),
        ...extra,
      },
    }
    this.events.push(event)
    this.updatedAt = ts
    return event
  }

  item(id: string, item: SimItem): void {
    if (!(id in this.items)) this.order.push(id)
    this.items[id] = item
  }

  /** Begin a turn: reveal stage 0 now and hold the rest until `/events` is read. */
  begin(script: TurnScript, finish: () => void): void {
    this.stages = script.stages.map(stage => stage)
    this.finish = finish
    this.status = 'running'
    this.release()
  }

  /** Reveal the next stage; the last one completes the turn. */
  release(): void {
    const stage = this.stages.shift()
    if (!stage) return
    for (const event of stage) this.append(event.type, event.value, event.extra)
    if (this.stages.length === 0) {
      const finish = this.finish
      this.finish = null
      finish?.()
    }
  }

  /** Every stage at once (a turn that finished before anyone looked). */
  releaseAll(): void {
    while (this.stages.length > 0) this.release()
  }

  snapshot(): unknown {
    return {
      session: {
        sessionId: this.id,
        runId: this.runId,
        graphId: this.graphId,
        label: 'pilot-headed',
        agentId: 'agent-sim',
        model: this.model,
        status: this.status,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        ...(this.completedAt ? { completedAt: this.completedAt } : {}),
        ...(this.mode ? { agentOntologyBinding: { mode: { iri: this.mode, digest: 'c'.repeat(64) } } } : {}),
      },
      document: {
        ...((this.sim.recordsPrompt && this.prompt) || this.graphAccess
          ? {
            source: {
              ...(this.sim.recordsPrompt && this.prompt ? { prompt: this.prompt } : {}),
              ...(this.graphAccess ? { graphAccess: this.graphAccess } : {}),
            },
          }
          : {}),
        transcript: {
          order: [...this.order],
          items: Object.fromEntries(this.order.map(id => [id, this.items[id]])),
        },
      },
      events: this.events,
    }
  }
}

function matchRoute(pattern: RegExp, path: string): RegExpExecArray | null {
  return pattern.exec(path)
}

export class ChoreographSim {
  server!: Server
  base = ''
  readonly received: Received[] = []
  readonly sessions = new Map<string, SimSession>()
  /** The registry each graph is served. */
  workflows: unknown[] = [DOMAIN_WORKFLOW, workspaceWorkflow()]
  /** Graphs with a Domain Agent definition. */
  readonly provisioned = new Set<string>()
  /** The model a session resolves when the invocation names none. */
  model = DEFAULT_MODEL
  /** Models an invocation's `inference` may name; null accepts any. */
  allowedModels: Set<string> | null = null
  /** Extra routes a test (or a later feature's fixture) adds; return undefined to pass. */
  readonly extraRoutes: Array<(request: Received) => Answer | undefined> = []
  /**
   * What the real host checks before any run exists, in order, ahead of `invocation` (a fixture adds one;
   * a test's programmed `invocation` still sees only what every admission let through). Return an answer to
   * refuse; undefined to let the request on.
   */
  readonly admissions: Array<(request: Received) => Answer | undefined> = []
  /** Programmed answers for POST /invocations; return undefined to fall through. */
  invocation: (request: Received) => Answer | undefined = () => undefined
  /** Whether sessions keep the first prompt on their document (the release's host does). */
  recordsPrompt = true
  /** The built-in mode every new session is bound to (its `agentOntologyBinding.mode.iri`); null: not said. */
  sessionMode: string | null = null
  /** What every new session's document records of its graph access (`source.graphAccess`); null: not said. */
  sessionGraphAccess: 'read' | 'write' | null = null
  /** The sim clock, in epoch milliseconds. */
  clock = Date.UTC(2026, 8, 28, 22, 40, 0)
  private runSeq = 0
  private sessionSeq = 0
  private readonly turns: TurnScript[] = []
  private readonly runs: Record<string, unknown>[] = []

  tick(by = 1_000): number {
    this.clock += by
    return this.clock
  }

  /** The next turn (initial or follow-up) plays this script. */
  queueTurn(script: TurnScript): void {
    this.turns.push(script)
  }

  private nextTurn(fallback: string): TurnScript {
    return this.turns.shift() ?? plainTurn(fallback)
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  /** The graph base URL a service under test is given. */
  graphBase(graph: string): string {
    return `${this.base}/g/${graph}`
  }

  calls(routeSuffix: string, method?: string): Received[] {
    return this.received.filter(item =>
      item.route.endsWith(routeSuffix) && (method === undefined || item.method === method))
  }

  invocations(): Received[] {
    return this.calls('/invocations', 'POST')
  }

  session(id?: string): SimSession {
    const found = id ? this.sessions.get(id) : [...this.sessions.values()].at(-1)
    if (!found) throw new Error('No session has been started in the sim.')
    return found
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The SPA is cross-origin to the gateway: answer CORS and preflights.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'authorization, content-type, accept, prefer, x-graph-id, *')
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', this.base)
    let raw = ''
    for await (const chunk of req) raw += chunk
    const graphMatch = /^\/g\/([^/]+)(\/.*)$/.exec(url.pathname)
    const received: Received = {
      method: req.method ?? 'GET',
      path: url.pathname,
      route: graphMatch ? graphMatch[2] : url.pathname,
      graph: graphMatch ? graphMatch[1] : null,
      query: url.searchParams,
      headers: req.headers,
      body: raw ? safeJson(raw) : undefined,
      rawBody: raw,
    }
    this.received.push(received)
    let answer: Answer | undefined
    for (const extra of this.extraRoutes) {
      answer = extra(received)
      if (answer) break
    }
    answer ??= this.route(received, req.headers.accept ?? '')
    if ('hang' in answer) return
    if ('sse' in answer) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(answer.sse.map(item => `data: ${JSON.stringify(item)}\n\n`).join(''))
      // Released in the same tick as the end of the answer: whatever the client asks
      // next, it asks after this has happened.
      answer.after?.()
      return
    }
    res.writeHead(answer.status, { 'content-type': 'application/json', ...(answer.headers ?? {}) })
    res.end(answer.body === undefined ? '' : JSON.stringify(answer.body))
  }

  private route(request: Received, accept: string): Answer {
    if (!request.graph) return { status: 404, body: { error: `no route ${request.path}` } }
    const { graph, route: rest } = request
    if (rest === '/workflows') return { status: 200, body: { workflows: this.workflows } }
    if (rest === '/workflows/runs') return { status: 200, body: { runs: this.runs, count: this.runs.length } }
    if (rest === '/invocations' && request.method === 'POST') return this.invoke(request, graph)

    const agents = matchRoute(/^\/workflows\/runs\/([^/]+)\/agents$/, rest)
    if (agents) {
      const session = [...this.sessions.values()].find(candidate => candidate.runId === agents[1])
      if (!session) return { status: 200, body: { agents: [] } }
      return {
        status: 200,
        body: {
          agents: [{
            sessionId: session.id,
            label: 'pilot-headed',
            agentId: 'agent-sim',
            model: session.model,
            status: session.status,
          }],
        },
      }
    }

    const driver = matchRoute(/^\/agent-sessions\/([^/]+)\/driver$/, rest)
    if (driver && request.method === 'POST') return { status: 200, body: { applied: true } }

    const commands = matchRoute(/^\/agent-sessions\/([^/]+)\/commands$/, rest)
    if (commands) {
      const session = this.sessions.get(commands[1])
      if (!session) return { status: 404, body: { error: { code: 'session_not_found', message: 'no such session' } } }
      if (request.method === 'POST') return this.command(session, request)
      return { status: 200, body: { commands: session.commands } }
    }

    const events = matchRoute(/^\/agent-sessions\/([^/]+)\/events$/, rest)
    if (events) {
      const session = this.sessions.get(events[1])
      if (!session) return { status: 404, body: { error: { code: 'session_not_found', message: 'no such session' } } }
      const since = Number(request.query.get('since') ?? '0')
      const visible = session.events.filter(event => event.seq > since)
      const after = () => session.release()
      if (accept.includes('text/event-stream')) return { sse: visible, after }
      // The JSON face is a read like any other: it releases the next stage afterwards.
      const answer: Answer = { status: 200, body: { events: visible } }
      queueMicrotask(after)
      return answer
    }

    const one = matchRoute(/^\/agent-sessions\/([^/]+)$/, rest)
    if (one) {
      const session = this.sessions.get(one[1])
      if (!session) return { status: 404, body: { error: { code: 'session_not_found', message: 'no such session' } } }
      return { status: 200, body: session.snapshot() }
    }
    return { status: 404, body: { error: `unhandled ${rest} (${graph})` } }
  }

  private invoke(request: Received, graph: string): Answer {
    for (const admission of this.admissions) {
      const refusal = admission(request)
      if (refusal) return refusal
    }
    const programmed = this.invocation(request)
    if (programmed) return programmed
    const target = request.body?.target?.workflowName
    if (target === DOMAIN_WORKFLOW.name && !this.provisioned.has(graph)) {
      return {
        status: 404,
        body: { error: { code: 'domain_agent_not_provisioned', message: `graph '${graph}' has no Domain Agent definition` } },
      }
    }
    const runId = `wfr-sim-${++this.runSeq}`
    const sessionId = `ags_${String(++this.sessionSeq).padStart(4, '0')}sim`
    const inferred = request.body?.input?.inference?.model
    const resolved = typeof inferred === 'string' && (this.allowedModels === null || this.allowedModels.has(inferred))
      ? inferred
      : this.model
    const script = this.nextTurn(`Reply in ${graph}.`)
    const session = new SimSession(this, sessionId, runId, graph, script.model ?? resolved, this.tick())
    session.prompt = String(request.body?.input?.trigger?.text ?? '')
    session.mode = this.sessionMode
    session.graphAccess = this.sessionGraphAccess
    this.sessions.set(sessionId, session)
    this.runs.push({ runId, workflowName: target, graphId: graph, status: 'running', startedAt: session.createdAt })
    session.append('budget.ledger_updated', undefined, { kind: 'account_opened' })
    session.append('runtime.bound', undefined, { generation: 0 })
    session.begin(script, () => {
      if (script.fails) {
        session.status = 'restartable'
        session.completedAt = this.clock
        return
      }
      session.item(`result:${session.id}:generation:0`, {
        role: 'assistant',
        kind: 'node-result',
        state: 'done',
        text: script.answer,
        model: session.model,
      })
      session.status = 'completed'
      session.completedAt = this.clock
    })
    return {
      status: 202,
      body: { runId, invocationId: request.body?.invocationId, status: 'running', workflowId: target },
    }
  }

  private command(session: SimSession, request: Received): Answer {
    const body = request.body ?? {}
    const commandId = String(body.commandId ?? `c2cmd:sim-${session.commands.length + 1}`)
    const existing = session.commands.find(command => command.command_id === commandId)
    if (existing) return { status: 202, body: { command: existing, duplicate: true } }
    // As live: the ledger's submitted_at is the accepted event's own time.
    const accepted = session.append('command.accepted', undefined, { commandId })
    const command: SimCommand = {
      command_id: commandId,
      name: String(body.name ?? 'follow_up'),
      state: 'queued',
      submitted_at: accepted.ts,
      delivered_at: null,
      completed_at: null,
      payload: body.payload,
    }
    session.commands.push(command)
    if (command.name !== 'follow_up') {
      command.state = 'completed'
      command.completed_at = this.tick()
      session.append('command.completed', undefined, { commandId })
      return { status: 202, body: { command, duplicate: false } }
    }
    const text = String((body.payload as { text?: unknown } | undefined)?.text ?? '')
    session.item(`command:${commandId}:input`, { role: 'user', kind: 'follow_up', text, state: 'done' })
    const script = this.nextTurn(`Reply to: ${text}`)
    command.state = 'delivered'
    command.delivered_at = this.tick()
    session.status = 'running'
    session.begin(script, () => {
      if (script.fails) {
        command.state = 'failed'
        command.completed_at = this.tick()
        session.append('command.failed', undefined, { commandId })
        session.status = 'restartable'
        session.completedAt = this.clock
        return
      }
      command.state = 'completed'
      command.completed_at = this.tick()
      session.item(`command:${commandId}:result`, {
        role: 'assistant',
        kind: 'command-result',
        state: 'completed',
        text: script.answer,
      })
      if (script.echo) {
        session.item(`result:aca_${commandId.replace(/[^a-z0-9]/gi, '').padEnd(16, '0')}`, {
          role: 'assistant',
          kind: 'node-result',
          state: 'done',
          text: script.answer,
          model: session.model,
        })
      }
      session.append('command.completed', undefined, { commandId })
      session.status = 'restartable'
      session.completedAt = this.clock
    })
    return { status: 202, body: { command, duplicate: false } }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
