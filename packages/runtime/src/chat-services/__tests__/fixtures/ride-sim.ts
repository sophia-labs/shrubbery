/**
 * The agent core as a self-hosted gardend serves it, as two REAL HTTP servers (NO MOCKS: every request the
 * chat makes crosses both sockets).
 *
 * `RideSim` speaks the ride protocol v2 the way `vehicle-host` does (vehicle `d0dd24f`, and `112e66f` for
 * rename, delete, takeover and the transcript's times; `protocol/ride-v2.md`): sessions owned by `x-user-id`,
 * bound to `x-graph-id`, the driver lease per `x-vehicle-client-id` (taken over only by the same principal,
 * `lease.revoked` on the old holder's watch), durable events with a cursor (long-poll and SSE, text deltas
 * ephemeral on SSE), commands `prompt` / `steer` / `abort`, `PATCH` (rename) and `DELETE` (to `trash`, refused
 * while a run is under way, `session.deleted` ending every watch; the answer names the conversation's mirror
 * document once it had a turn, as vehicle `8fda20e` does), `fork` / `clone` (vehicle `1e3fbc0`: no lease needed, a
 * new session with the history before a user entry, or all of it, its summary naming its `parent`; a fork answers
 * the entry's words without pi-sophia's note as `selectedText`; a clone is "Copy of" its source), and the inspect
 * frame's transcript with each entry's time. A run is scripted: each step is a function of the run, and `hold()` keeps a run open between
 * steps so a test can act mid-reply. `now` is the clock the record's times are written with.
 *
 * `GardendFront` stands in front as gardend (garden main `10f1f5b`, `loopback_service_routes.rs`): it
 * takes the self-host key, drops what a caller could pass off as identity, mints `x-internal-service`,
 * `x-user-id`, `x-sophia-caller-role` and, for `/services/vehicle/g/<graph>/<rest>`, `x-graph-id` and
 * `x-sophia-graph-role`, strips the mount and the graph, and streams the answer through (gardend streams
 * since `939e4fb`). `streams = false` answers an event-stream request 501, as gardend 0.1.3 did. It also serves
 * gardend's own document Trash route (`DELETE /navigation/<graph>/documents/<id>`, `loopback_files_routes.rs`):
 * the owner's key may (`workspace.delete.crdt`), a member's may not (403), and `trashed` records what went.
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const PROTOCOL = 'sophia.vehicle-ride.v2'
const SECRET = 'ride-sim-secret-0123456789'

export interface SimEvent {
  seq: number
  ts: string
  type: string
  payload: Record<string, unknown>
}

interface SimCommand {
  commandId: string
  op: string
  text?: string
  status: string
  acceptedSeq: number
  acceptedAt: string
  client: { principal: string; clientId: string }
  contextRefs?: string[]
}

export interface SimSession {
  sessionId: string
  graphId: string
  owner: string
  access: 'read' | 'write'
  createdAt: string
  title?: string
  lease: { clientId: string; principal: string; claimedAt: string; expiresAt: number } | null
  events: SimEvent[]
  commands: SimCommand[]
  transcript: Record<string, unknown>[]
  running: { runId: string; steers: string[]; aborted: boolean } | null
  listeners: Set<(event: SimEvent | { delta: string }) => void>
  parent?: { sessionId: string; kind: 'fork' | 'clone'; entryId?: string }
}

/** One step of a scripted run: what the agent does next. */
export type RunStep =
  | { readonly kind: 'say'; readonly text: string; readonly costUsd?: number }
  | { readonly kind: 'tool'; readonly name: string; readonly args: Record<string, unknown>; readonly result: string; readonly isError?: boolean }
  | { readonly kind: 'hold' }

export interface Received {
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: Record<string, unknown>
}

export class RideSim {
  server!: Server
  base = ''
  readonly sessions = new Map<string, SimSession>()
  /** Deleted sessions, moved whole (vehicle-host's `trash/`). */
  readonly trash = new Map<string, SimSession>()
  readonly received: Received[] = []
  /** The clock the record's times are written with (a test may move it). */
  now: () => number = () => Date.now()
  /** Whether runs are mirrored (`mirror.written` after `run.settled`), as vehicle-host does with a gardend. */
  mirror = true
  /** The next run's steps; each prompt takes the next script. */
  scripts: RunStep[][] = []
  private release: (() => void) | null = null
  private counter = 0

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ protocol: PROTOCOL, type: 'error', code: 'internal_error', message: String(error) }))
    }))
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  /** Let a held run go on. */
  go(): void {
    const release = this.release
    this.release = null
    release?.()
  }

  /** Resolves once a run is held. */
  async held(): Promise<void> {
    for (let i = 0; i < 400 && !this.release; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    if (!this.release) throw new Error('no run was held')
  }

  commandsOf(op: string): Received[] {
    return this.received.filter(item => item.path.endsWith('/commands') && item.body.op === op)
  }

  private iso(): string {
    return new Date(this.now()).toISOString()
  }

  private lease(clientId: string, principal: string): NonNullable<SimSession['lease']> {
    const now = this.now()
    return { clientId, principal, claimedAt: new Date(now).toISOString(), expiresAt: now + 30 * 60_000 }
  }

  private append(session: SimSession, type: string, payload: Record<string, unknown> = {}): SimEvent {
    const event: SimEvent = { seq: session.events.length + 1, ts: this.iso(), type, payload }
    session.events.push(event)
    for (const listener of session.listeners) listener(event)
    return event
  }

  private delta(session: SimSession, text: string): void {
    for (const listener of session.listeners) listener({ delta: text })
  }

  private summary(session: SimSession): Record<string, unknown> {
    const first = session.commands.find(command => command.text) ?? session.transcript.find(item => item.role === 'user')
    const last = [...session.events].reverse().find(event => /^(command|message|run)\./.test(event.type))
    return {
      sessionId: session.sessionId,
      graphId: session.graphId,
      profile: 'chat',
      access: session.access,
      model: 'openrouter/google/gemini-2.5-flash',
      createdAt: session.createdAt,
      updatedAt: last?.ts ?? session.createdAt,
      ...(session.title ? { title: session.title } : {}),
      ...(first?.text ? { preview: String(first.text).slice(0, 160) } : {}),
      status: session.running ? 'running' : 'idle',
      cursor: session.events.length,
      lease: session.lease
        ? { clientId: session.lease.clientId, claimedAt: session.lease.claimedAt, expiresAt: new Date(session.lease.expiresAt).toISOString() }
        : null,
      ...(session.parent ? { parent: session.parent } : {}),
    }
  }

  /** vehicle-host's fork and clone: a new session from the source's record, the caller's client holding its lease. */
  private branch(source: SimSession, op: 'fork' | 'clone', entryId: unknown, principal: string, clientId: string): { session: SimSession; selectedText?: string } | string {
    let history = source.transcript
    let selectedText: string | undefined
    if (op === 'fork') {
      const at = source.transcript.findIndex(item => item.entryId === entryId && item.role === 'user')
      if (at < 0) return 'fork needs the entryId of a user message on this session'
      history = source.transcript.slice(0, at)
      selectedText = String(source.transcript[at]?.text ?? '').replace(/\n\n\(Open in the person's view, by id: [^\n]*\)$/, '')
    }
    const name = source.title ?? (source.commands.find(command => command.text)?.text ?? source.transcript.find(item => item.role === 'user')?.text) as string | undefined
    const session: SimSession = {
      sessionId: `s-${this.counter++}`,
      graphId: source.graphId,
      owner: source.owner,
      access: source.access,
      createdAt: this.iso(),
      ...(op === 'clone' && name ? { title: `Copy of ${name}` } : {}),
      lease: this.lease(clientId, principal),
      events: [],
      commands: [],
      transcript: history.map(item => ({ ...item })),
      running: null,
      listeners: new Set(),
      parent: { sessionId: source.sessionId, kind: op, ...(op === 'fork' ? { entryId: String(entryId) } : {}) },
    }
    this.sessions.set(session.sessionId, session)
    this.append(session, 'session.created', { sessionId: session.sessionId, graphId: session.graphId, parent: session.parent })
    this.append(session, 'lease.claimed', { ...session.lease })
    this.append(source, op === 'fork' ? 'session.forked' : 'session.cloned', { into: session.sessionId })
    return { session, ...(selectedText !== undefined ? { selectedText } : {}) }
  }

  private async run(session: SimSession, command: SimCommand): Promise<void> {
    const runId = String(session.events.length + 1)
    session.running = { runId, steers: [], aborted: false }
    command.status = 'delivered'
    this.append(session, 'run.started', { runId, tools: ['mcp__sophia__search_documents', 'mcp__sophia__read_document'] })
    this.append(session, 'command.delivered', { commandId: command.commandId, op: command.op, runId })
    // pi keeps what the model was given: with open documents, pi-sophia's note about them after the words.
    const refs = command.contextRefs ?? []
    const said = refs.length > 0 ? `${command.text}\n\n(Open in the person's view, by id: ${refs.map(ref => `\`${ref}\``).join(', ')}. "This document" means the first.)` : command.text
    session.transcript.push({ entryId: `e-${this.counter++}`, timestamp: this.iso(), role: 'user', text: said })
    this.append(session, 'message.completed', { role: 'user', text: said })
    const steps = this.scripts.shift() ?? [{ kind: 'say', text: 'Hello.' }]
    for (const step of steps) {
      const running = session.running
      if (running.aborted) break
      if (step.kind === 'hold') {
        // The model call is held open; what is steered meanwhile is taken before the next one.
        await new Promise<void>(resolve => {
          this.release = resolve
        })
      } else if (step.kind === 'say') {
        for (const piece of step.text.match(/.{1,6}/gs) ?? []) {
          this.delta(session, piece)
          await new Promise(resolve => setTimeout(resolve, 1))
        }
        session.transcript.push({ entryId: `e-${this.counter++}`, timestamp: this.iso(), role: 'assistant', text: step.text })
        this.append(session, 'message.completed', {
          role: 'assistant', text: step.text, stopReason: 'stop', model: 'google/gemini-2.5-flash',
          usage: { input: 10, output: 5, totalTokens: 15, costUsd: step.costUsd ?? 0.0005 },
        })
      } else {
        const call = { id: `call-${this.counter++}`, name: `mcp__sophia__${step.name}`, args: step.args }
        session.transcript.push({ entryId: `e-${this.counter++}`, timestamp: this.iso(), role: 'assistant', text: '', toolCalls: [{ name: call.name, args: call.args }] })
        this.append(session, 'message.completed', { role: 'assistant', text: '', toolCalls: [call], stopReason: 'toolUse', usage: { costUsd: 0.0002 } })
        this.append(session, 'tool.started', { toolCallId: call.id, toolName: call.name, args: call.args })
        session.transcript.push({ entryId: `e-${this.counter++}`, timestamp: this.iso(), role: 'toolResult', text: step.result, toolName: call.name, isError: step.isError === true })
        this.append(session, 'tool.result', { toolCallId: call.id, toolName: call.name, isError: step.isError === true, text: step.result })
      }
      // pi's steer: delivered after the step, before the next model call.
      for (const steer of running.steers.splice(0)) {
        const record = session.commands.find(candidate => candidate.commandId === steer) as SimCommand
        record.status = 'delivered'
        this.append(session, 'command.delivered', { commandId: steer, op: 'steer', runId })
        session.transcript.push({ entryId: `e-${this.counter++}`, timestamp: this.iso(), role: 'user', text: record.text })
        this.append(session, 'message.completed', { role: 'user', text: record.text })
      }
    }
    const aborted = session.running.aborted
    for (const record of session.commands) {
      if (record.status === 'delivered') {
        record.status = aborted ? 'aborted' : 'completed'
        this.append(session, `command.${record.status}`, { commandId: record.commandId, op: record.op })
      }
    }
    session.running = null
    this.append(session, 'run.settled', { runId, aborted, stopReason: aborted ? 'aborted' : 'stop' })
    // vehicle-host's mirror, a moment after the run: the conversation's document in the workspace.
    if (this.mirror) setTimeout(() => this.append(session, 'mirror.written', { documentId: `sophia-conversation-${session.sessionId}`, created: false }), 10)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
    this.received.push({ method: req.method ?? 'GET', path: url.pathname, headers: { ...req.headers }, body })
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const fail = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
      send(status, { protocol: PROTOCOL, type: 'error', code, message, ...(details ? { details } : {}) })
    const held = (lease: NonNullable<SimSession['lease']>, principal: string) =>
      fail(409, 'lease_held', 'another client holds the driver lease', {
        holder: { clientId: lease.clientId, claimedAt: lease.claimedAt, expiresAt: new Date(lease.expiresAt).toISOString() },
        canTakeOver: lease.principal === principal,
      })
    const frame = (type: string, value: unknown, requestId?: unknown) => ({ protocol: PROTOCOL, type, ...(requestId ? { requestId } : {}), value })
    if (url.pathname === '/health') return send(200, { protocol: PROTOCOL, ok: true })
    if (req.headers['x-internal-service'] !== SECRET) return fail(401, 'unauthorized', 'the service secret is missing or wrong')
    const principal = String(req.headers['x-user-id'] ?? '')
    const graphId = typeof req.headers['x-graph-id'] === 'string' ? req.headers['x-graph-id'] : undefined
    const role = String((graphId ? req.headers['x-sophia-graph-role'] : req.headers['x-sophia-caller-role']) ?? '')
    const clientId = String(req.headers['x-vehicle-client-id'] ?? principal)
    if (!principal) return fail(401, 'identity_required', 'x-user-id is required')

    if (url.pathname === '/sessions') {
      if (req.method === 'POST') {
        if (!graphId) return fail(400, 'graph_required', 'create sessions on a graph-scoped path')
        if (body.graphId !== undefined && body.graphId !== graphId) return fail(400, 'graph_mismatch', 'the body may not name another graph')
        const session: SimSession = {
          sessionId: `s-${this.counter++}`,
          graphId,
          owner: principal,
          access: role === 'viewer' ? 'read' : 'write',
          createdAt: this.iso(),
          ...(typeof body.title === 'string' ? { title: body.title } : {}),
          lease: body.claim === false ? null : this.lease(clientId, principal),
          events: [],
          commands: [],
          transcript: [],
          running: null,
          listeners: new Set(),
        }
        this.sessions.set(session.sessionId, session)
        this.append(session, 'session.created', { sessionId: session.sessionId, graphId })
        if (session.lease) this.append(session, 'lease.claimed', { ...session.lease })
        return send(201, frame('session.created', { session: this.summary(session) }, body.requestId))
      }
      const rows = [...this.sessions.values()].filter(session => session.owner === principal && (!graphId || session.graphId === graphId))
      return send(200, frame('session.list', { sessions: rows.map(session => this.summary(session)).reverse() }))
    }
    const match = /^\/sessions\/([^/]+)(?:\/(claim|commands|events))?$/.exec(url.pathname)
    const session = match ? this.sessions.get(match[1] as string) : undefined
    if (!match || !session || session.owner !== principal || (graphId && session.graphId !== graphId)) return fail(404, 'not_found', 'no such session')
    const action = match[2]
    if (!action && req.method === 'GET') {
      return send(200, frame('session.snapshot', { cursor: session.events.length, session: this.summary(session), commands: session.commands, transcript: session.transcript }))
    }
    if (!action && req.method === 'PATCH') {
      if (!('title' in body)) return fail(400, 'invalid_request', 'title is required (null clears it)')
      const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : ''
      if (title.length > 200) return fail(400, 'invalid_request', 'title must be at most 200 characters')
      if (title) session.title = title
      else delete session.title
      this.append(session, 'session.renamed', { title: title || null, by: clientId })
      return send(200, frame('session.renamed', { session: this.summary(session) }, body.requestId))
    }
    if (!action && req.method === 'DELETE') {
      const open = session.commands.filter(command => ['accepted', 'queued', 'delivered'].includes(command.status)).map(command => command.commandId)
      if (session.running || open.length > 0) {
        return send(409, { protocol: PROTOCOL, type: 'error', code: 'session_running', message: 'Sophia is still working in this conversation: abort the run, then delete it', details: { open } })
      }
      this.sessions.delete(session.sessionId)
      this.trash.set(session.sessionId, session)
      this.append(session, 'session.deleted', { by: clientId, trashedAs: session.sessionId })
      // Mirrored after its first turn: the client puts the document in the workspace's Trash.
      const mirror = session.transcript.length > 0 ? { documentId: `sophia-conversation-${session.sessionId}`, graphId: session.graphId } : undefined
      return send(200, frame('session.deleted', { sessionId: session.sessionId, trashedAs: session.sessionId, ...(mirror ? { mirror } : {}) }))
    }
    if (action === 'claim') {
      if (session.lease && session.lease.expiresAt <= this.now()) session.lease = null
      const holder = session.lease
      if (holder && holder.clientId !== clientId) {
        if (body.takeover !== true || holder.principal !== principal) return held(holder, principal)
        session.lease = null
        this.append(session, 'lease.revoked', { clientId: holder.clientId, by: clientId, reason: 'takeover' })
      }
      session.lease = this.lease(clientId, principal)
      this.append(session, 'lease.claimed', { ...session.lease })
      const lease = this.summary(session).lease
      return send(200, frame('driver.claimed', { lease, ...(holder && holder.clientId !== clientId ? { tookOverFrom: { clientId: holder.clientId, claimedAt: holder.claimedAt } } : {}) }, body.requestId))
    }
    if (action === 'commands' && (body.op === 'fork' || body.op === 'clone')) {
      // The owner's, from any of their clients: no lease.
      const made = this.branch(session, body.op, body.entryId, principal, clientId)
      if (typeof made === 'string') return fail(400, 'invalid_request', made)
      const value = { session: this.summary(made.session), ...(made.selectedText !== undefined ? { selectedText: made.selectedText } : {}) }
      return send(200, frame(body.op === 'fork' ? 'session.forked' : 'session.cloned', value, body.requestId))
    }
    if (action === 'commands') {
      if (!session.lease) return fail(409, 'lease_required', 'claim the driver lease before sending commands')
      if (session.lease.clientId !== clientId) return held(session.lease, principal)
      const op = String(body.op)
      if (op === 'abort') {
        const accepted = this.append(session, 'command.accepted', { commandId: String(body.requestId), op })
        const running = session.running
        if (running) {
          running.aborted = true
          this.go()
        }
        return send(200, frame('command.accepted', { command: { commandId: body.requestId, op, status: 'completed', acceptedSeq: accepted.seq, result: { abortedRun: Boolean(running) } } }, body.requestId))
      }
      const command: SimCommand = {
        commandId: String(body.requestId),
        op,
        text: String(body.text),
        status: 'accepted',
        acceptedSeq: 0,
        acceptedAt: this.iso(),
        client: { principal, clientId },
        ...(Array.isArray(body.contextRefs) ? { contextRefs: body.contextRefs.map(String) } : {}),
      }
      command.acceptedSeq = this.append(session, 'command.accepted', { commandId: command.commandId, op, chars: command.text?.length }).seq
      session.commands.push(command)
      if (op === 'steer' && session.running) {
        command.status = 'queued'
        session.running.steers.push(command.commandId)
      } else {
        setTimeout(() => void this.run(session, command), 5)
      }
      const view = { commandId: command.commandId, op, status: command.status, acceptedSeq: command.acceptedSeq, disposition: op === 'steer' ? 'queued' : 'started' }
      return send(200, frame('command.accepted', { command: view, session: this.summary(session) }, body.requestId))
    }
    if (action === 'events') {
      const since = Number(url.searchParams.get('since') ?? '0')
      if (String(req.headers.accept ?? '').includes('text/event-stream')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        res.flushHeaders()
        let cursor = since
        const write = (event: SimEvent | { delta: string }) => {
          if ('delta' in event) {
            res.write(`event: message.delta\ndata: ${JSON.stringify({ protocol: PROTOCOL, type: 'event', ephemeral: true, event: { type: 'message.delta', payload: { delta: event.delta } } })}\n\n`)
            return
          }
          if (event.seq <= cursor) return
          cursor = event.seq
          res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ protocol: PROTOCOL, type: 'event', cursor: event.seq, event })}\n\n`)
          // A deleted session says so last: the stream ends with it.
          if (event.type === 'session.deleted') {
            session.listeners.delete(write)
            res.end()
          }
        }
        session.listeners.add(write)
        for (const event of session.events) write(event)
        req.on('close', () => session.listeners.delete(write))
        return
      }
      const waitMs = Number(url.searchParams.get('waitMs') ?? '0')
      const ready = () => session.events.filter(event => event.seq > since)
      if (ready().length === 0 && waitMs > 0) {
        await new Promise<void>(resolve => {
          const listener = (event: SimEvent | { delta: string }) => {
            if ('delta' in event) return
            session.listeners.delete(listener)
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(() => {
            session.listeners.delete(listener)
            resolve()
          }, waitMs)
          session.listeners.add(listener)
        })
      }
      const events = ready()
      return send(200, frame('watch.completed', { events, cursor: events.at(-1)?.seq ?? since, count: events.length, more: false }))
    }
    return fail(405, 'method_not_allowed', 'method not allowed here')
  }
}

/** Who a bearer is, as gardend's grant would make it. */
type Grant = { readonly userId: string; readonly role: 'owner' | 'editor' | 'viewer' }

export class GardendFront {
  server!: Server
  base = ''
  readonly key = 'self-host-key'
  readonly memberKey = 'member-key'
  /** gardend streams an answer through (since `939e4fb`); false: 0.1.3's 501 on an event stream. */
  streams = true
  readonly forwarded: { path: string; headers: Record<string, string | string[] | undefined> }[] = []
  /** Documents put in the workspace's Trash through gardend's own route, and by whom. */
  readonly trashed: { graphId: string; documentId: string; by: string }[] = []

  constructor(private readonly sim: RideSim) {}

  get vehicleBase(): string {
    return `${this.base}/services/vehicle`
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res))
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private grant(authorization: string | undefined): Grant | null {
    if (authorization === `Bearer ${this.key}`) return { userId: 'owner', role: 'owner' }
    if (authorization === `Bearer ${this.memberKey}`) return { userId: 'token:member', role: 'editor' }
    return null
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.base)
    const refuse = (status: number, error: string) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error }))
    }
    const grant = this.grant(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined)
    if (!grant) {
      refuse(401, 'missing bearer token')
      return
    }
    const trash = /^\/navigation\/([^/]+)\/documents\/([^/]+)$/.exec(url.pathname)
    if (trash && req.method === 'DELETE') {
      if (grant.role !== 'owner') {
        refuse(403, 'loopback token missing required scope workspace.delete.crdt')
        return
      }
      const [, graphId = '', documentId = ''] = trash
      this.trashed.push({ graphId, documentId, by: grant.userId })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ kind: 'document', id: documentId, documentId, graphId, status: 'trashed', trashed: true, trashedAt: new Date().toISOString(), alreadyTrashed: false }))
      return
    }
    const mount = '/services/vehicle'
    if (!url.pathname.startsWith(`${mount}/`)) {
      refuse(404, 'not found')
      return
    }
    if (!this.streams && String(req.headers.accept ?? '').includes('text/event-stream')) {
      refuse(501, 'local service proxy currently supports JSON polling')
      return
    }
    let rest = url.pathname.slice(mount.length)
    let graphId: string | null = null
    const scoped = /^\/g\/([^/]*)(\/.*)?$/.exec(rest)
    if (scoped) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(scoped[1] as string)) {
        refuse(400, 'a /g/ path must name a graph')
        return
      }
      graphId = scoped[1] as string
      rest = scoped[2] ?? '/'
    }
    const headers: Record<string, string | string[] | undefined> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (/^(x-graph-|x-sophia-|x-internal-|x-user-|x-pn-|cf-access-)/.test(name)) continue
      if (['authorization', 'cookie', 'host', 'connection', 'content-length'].includes(name)) continue
      headers[name] = value
    }
    headers['x-internal-service'] = SECRET
    headers['x-user-id'] = grant.userId
    headers['x-sophia-caller-role'] = grant.role
    if (graphId) {
      headers['x-graph-id'] = graphId
      headers['x-graph-owner'] = 'user:owner'
      headers['x-sophia-graph-role'] = grant.role
    }
    this.forwarded.push({ path: rest, headers })
    const upstream = httpRequest(`${this.sim.base}${rest}${url.search}`, { method: req.method, headers }, incoming => {
      res.writeHead(incoming.statusCode ?? 502, { 'content-type': String(incoming.headers['content-type'] ?? 'application/json') })
      res.flushHeaders()
      incoming.pipe(res)
    })
    upstream.on('error', error => {
      if (res.headersSent) res.destroy()
      else refuse(502, `local service proxy failed: ${error.message}`)
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
}
