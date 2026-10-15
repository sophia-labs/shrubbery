/**
 * A self-host's gardend in front of its local Choreograph, as a REAL HTTP server (NO MOCKS: every request
 * the chat makes crosses this socket, and every one this forwards crosses the sim's).
 *
 * WHAT IT SPEAKS, read from garden `origin/main` (`loopback_service_routes.rs`, `local_service_host.rs`,
 * `loopback_http.rs`; the proxy gardend 0.1.3 ships), not invented:
 *
 *   GET  /api/choreograph/status        scope `services.read` (members have it): `{ serviceId, state, pid,
 *                                       startedAt, healthPath, proxyMount, profileId, configured, lastError }`
 *   ANY  /services/choreograph/{*path}  scope `services.proxy` (a write scope members lack today): the mount
 *                                       stripped, `Authorization` and any caller-sent `x-internal-service` /
 *                                       `x-user-id` dropped, `X-Internal-Service: <the child's secret>` and
 *                                       `X-User-ID: default` (the profile id) added, the answer buffered.
 *
 * An `Accept: text/event-stream` request is answered 501 before anything is forwarded:
 * `{"ok":false,"error":"local service proxy currently supports JSON polling; use Accept: application/json
 * for workflow events"}`. With `streams` on (what the later garden slice brings) it is forwarded like any
 * other request; the sim ends each stream at once, so passing it through and buffering it read the same.
 *
 * Keys: `key` is the owner's (every scope); `memberKey` reads status but may not proxy, as a member's
 * grant does today. Any other bearer is 401.
 */

import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ChoreographSim } from './choreograph-sim.js'

/** What gardend asserts to its Choreograph for every caller (`runtime_config::PROFILE_ID`). */
export const GARDEND_PROFILE_ID = 'default'
export const GARDEND_SSE_REFUSAL =
  'local service proxy currently supports JSON polling; use Accept: application/json for workflow events'
const MOUNT = '/services/choreograph'
const DROPPED_REQUEST_HEADERS = new Set([
  'authorization', 'connection', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailer', 'transfer-encoding', 'upgrade', 'x-internal-service', 'x-user-id', 'content-length',
])

export interface ProxyReceived {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly accept: string
  readonly authorization: string | undefined
  /** What gardend answered. */
  status: number
}

export class GardendProxy {
  server!: Server
  base = ''
  readonly received: ProxyReceived[] = []
  /** The owner's key: every scope. */
  readonly key = 'self-host-key'
  /** A member's key: reads (`services.read`), not `services.proxy`. */
  readonly memberKey = 'member-key'
  /** Whether the proxy passes an event stream through (false: gardend 0.1.3's 501). */
  streams = false
  /** What `GET /api/choreograph/status` says of the service. */
  state: 'unconfigured' | 'stopped' | 'running' | 'error' = 'running'
  /** False: a gardend older than the route (404). */
  statusRoute = true
  /**
   * Cloudflare Access in front: a request with no bearer came through the edge with its pass, and is the
   * owner's. (The edge adds a header the page cannot; here, its absence of a bearer stands for it.)
   */
  behindAccess = false

  constructor(private readonly sim: ChoreographSim) {}

  /** The chat's base URL: the mount, then Choreograph's own `/api`. */
  get chatBase(): string {
    return `${this.base}${MOUNT}/api`
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

  forwarded(): ProxyReceived[] {
    return this.received.filter(item => item.path.startsWith(`${MOUNT}/`))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks)
    const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
    const received: ProxyReceived = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      accept: String(req.headers.accept ?? ''),
      authorization,
      status: 0,
    }
    this.received.push(received)
    const answer = (status: number, body: unknown, type = 'application/json'): void => {
      received.status = status
      res.writeHead(status, { 'content-type': type })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    const grant = authorization === `Bearer ${this.key}` || (this.behindAccess && authorization === undefined)
      ? 'owner'
      : authorization === `Bearer ${this.memberKey}` ? 'member' : null
    if (!grant) {
      answer(401, { ok: false, error: 'loopback token required' })
      return
    }

    if (url.pathname === '/api/choreograph/status' && req.method === 'GET' && this.statusRoute) {
      const configured = this.state !== 'unconfigured'
      answer(200, {
        serviceId: 'choreograph',
        state: this.state,
        pid: this.state === 'running' ? 4242 : null,
        startedAt: this.state === 'running' ? '2026-10-13T19:00:00Z' : null,
        healthPath: '/health',
        proxyMount: MOUNT,
        profileId: GARDEND_PROFILE_ID,
        configured,
        lastError: null,
      })
      return
    }

    if (url.pathname !== MOUNT && !url.pathname.startsWith(`${MOUNT}/`)) {
      answer(404, { ok: false, error: 'not found' })
      return
    }
    if (grant !== 'owner') {
      answer(403, { ok: false, error: 'loopback token missing required scope services.proxy' })
      return
    }
    if (!this.streams && received.accept.split(',').some(part => part.trim() === 'text/event-stream')) {
      answer(501, { ok: false, error: GARDEND_SSE_REFUSAL })
      return
    }
    if (this.state !== 'running') {
      answer(503, { ok: false, error: 'local service is not running' })
      return
    }

    const headers: OutgoingHttpHeaders = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (DROPPED_REQUEST_HEADERS.has(name) || value === undefined) continue
      headers[name] = value
    }
    headers['x-internal-service'] = this.sim.internalSecret
    headers['x-user-id'] = GARDEND_PROFILE_ID
    if (raw.length > 0) headers['content-length'] = String(raw.length)
    const upstreamPath = url.pathname.slice(MOUNT.length) || '/'
    try {
      // Server to server, as gardend's reqwest client is: no browser, no CORS, the answer read whole.
      const upstream = await forward(`${this.sim.base}${upstreamPath}${url.search}`, req.method ?? 'GET', headers, raw)
      received.status = upstream.status
      res.writeHead(upstream.status, { 'content-type': upstream.contentType ?? 'application/json' })
      res.end(upstream.body)
    } catch (error) {
      answer(502, { ok: false, error: `local service proxy failed: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
}

function forward(
  target: string,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer,
): Promise<{ readonly status: number; readonly contentType: string | undefined; readonly body: Buffer }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(target, { method, headers }, incoming => {
      const chunks: Buffer[] = []
      incoming.on('data', chunk => chunks.push(chunk as Buffer))
      incoming.on('end', () => resolve({
        status: incoming.statusCode ?? 502,
        contentType: typeof incoming.headers['content-type'] === 'string' ? incoming.headers['content-type'] : undefined,
        body: Buffer.concat(chunks),
      }))
      incoming.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end(body.length > 0 ? body : undefined)
  })
}
