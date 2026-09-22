/**
 * loopback-mcp.ts — SHELL-SIDE low-level MCP JSON-RPC client for a gardend cell.
 *
 * This lives in apps/organism (the SHELL), NOT in the shrubbery library. The
 * library (@shrubbery/nucleus / runtime / components) never speaks HTTP, MCP, or
 * auth — it only ever sees the structural ShrubberyContract interface. All of
 * the gardend-loopback knowledge (JSON-RPC framing, the rdf_dump / sparql_query
 * tool names, the named-graph IRI, the misleading quadCount field) is confined
 * here, behind the contract.
 *
 * Transport is environment-split:
 *   - BROWSER (organism `pnpm dev`): base path "/cell" → the Vite dev proxy
 *     forwards same-origin /cell/* to the loopback and injects the bearer
 *     server-side. We use the browser `fetch` and ship NO token in JS.
 *   - NODE (tests / dev scripts): we DON'T use Node's global `fetch` — Node 25's
 *     undici drops the `Authorization` header on loopback POSTs (verified:
 *     node:http with the same bearer returns 200, undici fetch returns 401
 *     "missing bearer token"). So the Node path uses `node:http` directly, with
 *     the bearer attached, which the gardend loopback accepts. node:http is
 *     loaded via a guarded dynamic import so it never enters the browser bundle.
 *
 * Proven recipe source: apps/organism/scripts/probe-gardend-liveread.sh and
 * /Users/vera/dev/sophia/neem-rs/src/backend/local.rs.
 */

/** How the MCP client reaches the cell's /mcp + /health routes. */
export interface LoopbackTransport {
  /** Absolute URL of the MCP endpoint, e.g. http://127.0.0.1:<port>/mcp (Node)
   *  or "/cell/mcp" (browser, same-origin via the Vite proxy). */
  readonly mcpUrl: string
  /** Absolute URL of the health route (unauthenticated). */
  readonly healthUrl: string
  /** Bearer token to attach server-side. Omit in the browser (the proxy injects
   *  it) — NEVER ship the loopback token into browser JS. */
  readonly token?: string
  /** Origin header to send (Node callers may mirror neem-rs with
   *  http://127.0.0.1; server-side callers without Origin also pass origin_ok). */
  readonly origin?: string
  /** Injected fetch (the browser path). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch
  /** Force the transport: 'fetch' (browser) or 'node-http'. Auto-detected when
   *  omitted: absolute http(s) URL + Node runtime ⇒ node-http; else fetch. */
  readonly transport?: 'fetch' | 'node-http'
}

/** A tools/call MCP error surfaced verbatim (no faked fallback). */
export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/** The `result` payload of a tools/call: an MCP content array. */
interface ToolsCallResult {
  content?: Array<{ type?: string; text?: string }>
  [k: string]: unknown
}

interface HttpResponse {
  status: number
  ok: boolean
  text(): Promise<string>
}

let nextId = 1

/**
 * Are we in a Node runtime (vs. a browser)? We test `process.versions.node`
 * ONLY — NOT `typeof window === 'undefined'`, because the happy-dom test env
 * defines `window` while still being Node (where undici drops the bearer). The
 * browser Vite build does not define `process.versions.node`, so this is false
 * there and the same-origin fetch path is used. The detection is also overridable
 * per-transport via `transport: 'fetch' | 'node-http'`.
 */
const isNode =
  typeof process !== 'undefined' &&
  typeof (process as { versions?: { node?: string } }).versions?.node === 'string'

/**
 * A thin MCP-over-HTTP client for the gardend loopback. One instance per cell.
 */
export class LoopbackMcpClient {
  private readonly mode: 'fetch' | 'node-http'
  private readonly fetchImpl: typeof fetch | undefined

  constructor(private readonly t: LoopbackTransport) {
    // Decide the transport. Absolute loopback URL under Node ⇒ node:http (undici
    // strips Authorization on loopback POSTs). Otherwise the browser fetch path.
    const looksAbsolute = /^https?:\/\//.test(t.mcpUrl)
    this.mode = t.transport ?? (isNode && looksAbsolute ? 'node-http' : 'fetch')
    if (this.mode === 'fetch') {
      // Bind the default fetch to globalThis: an unbound/aliased fetch throws
      // "Failed to execute 'fetch' on 'Window': Illegal invocation" when invoked
      // detached (this.fetchImpl(...)). Caught live in the organism — the
      // node:http-path integration test never exercised the browser fetch path.
      const g = globalThis as typeof globalThis & { fetch?: typeof fetch }
      const f = t.fetch ?? (typeof g.fetch === 'function' ? g.fetch.bind(g) : undefined)
      if (!f) throw new Error('LoopbackMcpClient: no fetch available (pass transport.fetch)')
      this.fetchImpl = f
    }
  }

  /** GET /health — unauthenticated; 2xx ⇒ cell ready. */
  async health(): Promise<boolean> {
    const res = await this.get(this.t.healthUrl)
    return res.ok
  }

  /** POST a JSON-RPC tools/call and return the parsed `result` (throws on error). */
  async toolsCall(name: string, args: Record<string, unknown>): Promise<ToolsCallResult> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    const res = await this.post(this.t.mcpUrl, body)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new McpError(`MCP HTTP ${res.status} for ${name}: ${text.slice(0, 500)}`, res.status)
    }
    const json = JSON.parse(await res.text()) as {
      result?: ToolsCallResult
      error?: { code?: number; message?: string; data?: unknown }
    }
    if (json.error) {
      throw new McpError(`MCP error for ${name}: ${json.error.message ?? 'unknown'}`, json.error.code, json.error.data)
    }
    return json.result ?? {}
  }

  /**
   * GET a loopback path OUTSIDE the MCP JSON-RPC envelope — for the cell's own
   * dedicated REST routes that have no MCP tool wrapping them (e.g. salience
   * scores: compositeScore/wireCounts are computed at query time, never
   * materialized as RDF, so no sparql_query can reach them). `path` is
   * resolved the same way as `putJson` below.
   */
  async getJson<T>(path: string): Promise<T> {
    const base = this.t.mcpUrl.replace(/\/mcp\/?$/, '')
    const res = await this.get(`${base}${path}`)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new McpError(`Loopback HTTP ${res.status} for GET ${path}: ${text.slice(0, 500)}`, res.status)
    }
    return JSON.parse(await res.text()) as T
  }

  /**
   * PUT arbitrary JSON to a loopback path OUTSIDE the MCP JSON-RPC envelope —
   * for the cell's own dedicated REST routes that have no MCP tool wrapping
   * them (e.g. the restricted salience user-value write; the agent-range
   * `value` MCP tool is a different write path with different semantics).
   * `path` is resolved relative to the cell's own base (same origin as
   * `mcpUrl`, with the trailing `/mcp` stripped) so this works unchanged
   * across the Node-absolute and browser same-origin `/cell` transports.
   */
  async putJson<T>(path: string, body: unknown): Promise<T> {
    const base = this.t.mcpUrl.replace(/\/mcp\/?$/, '')
    const res = await this.put(`${base}${path}`, JSON.stringify(body))
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new McpError(`Loopback HTTP ${res.status} for PUT ${path}: ${text.slice(0, 500)}`, res.status)
    }
    return JSON.parse(await res.text()) as T
  }

  // ── transport primitives ────────────────────────────────────────────────────

  private async get(url: string): Promise<HttpResponse> {
    if (this.mode === 'node-http') return this.nodeRequest('GET', url, undefined, false)
    const res = await this.fetchImpl!(url, { method: 'GET', headers: this.fetchHeaders(false) })
    return { status: res.status, ok: res.ok, text: () => res.text() }
  }

  private async post(url: string, body: string): Promise<HttpResponse> {
    if (this.mode === 'node-http') return this.nodeRequest('POST', url, body, true)
    const res = await this.fetchImpl!(url, { method: 'POST', headers: this.fetchHeaders(true), body })
    return { status: res.status, ok: res.ok, text: () => res.text() }
  }

  private async put(url: string, body: string): Promise<HttpResponse> {
    if (this.mode === 'node-http') return this.nodeRequest('PUT', url, body, true)
    const res = await this.fetchImpl!(url, { method: 'PUT', headers: this.fetchHeaders(true), body })
    return { status: res.status, ok: res.ok, text: () => res.text() }
  }

  /** Headers for the browser fetch path (no Origin — fetch forbids setting it). */
  private fetchHeaders(json: boolean): Record<string, string> {
    const h: Record<string, string> = {}
    if (json) h['Content-Type'] = 'application/json'
    if (this.t.token) h['Authorization'] = `Bearer ${this.t.token}`
    return h
  }

  /** Node path: node:http(s) keeps the Authorization header (undici drops it). */
  private async nodeRequest(method: string, url: string, body: string | undefined, json: boolean): Promise<HttpResponse> {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? await import('node:https') : await import('node:http')
    const headers: Record<string, string> = {}
    if (json && body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }
    if (this.t.token) headers['Authorization'] = `Bearer ${this.t.token}`
    if (this.t.origin) headers['Origin'] = this.t.origin
    return new Promise<HttpResponse>((resolve, reject) => {
      const req = lib.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
        res => {
          let data = ''
          res.setEncoding('utf8')
          res.on('data', c => (data += c))
          res.on('end', () => {
            const status = res.statusCode ?? 0
            resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(data) })
          })
        },
      )
      req.on('error', reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
  }
}

/**
 * Extract the concatenated `text` body from an MCP tools/call content array.
 * (Both rdf_dump and sparql_query return a single text content item whose body
 * is a JSON envelope.)
 */
export function mcpText(result: ToolsCallResult): string {
  const content = result.content
  if (Array.isArray(content)) {
    return content
      .filter(c => c?.type === 'text' && typeof c.text === 'string')
      .map(c => c.text as string)
      .join('')
  }
  return JSON.stringify(result)
}
