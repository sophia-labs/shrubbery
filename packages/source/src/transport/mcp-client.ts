/**
 * mcp-client.ts — THE unified MCP JSON-RPC client for a gardend cell.
 *
 * HOISTED from apps/organism/src/cell/loopback-mcp.ts @ b2f408e — organism's
 * copy is frozen under active swarm ownership; @shrubbery/source is the sole
 * external adapter-consumption convention. Organism's migration is a named
 * follow-up slice.
 *
 * Folded contributions:
 *   - rhizome's structuredContent-first result handling
 *     (apps/rhizome/src/garden-client.ts:145-165 @ b2f408e) → `callTool()`.
 *   - one transport config (`McpTransportConfig`) unifying organism's
 *     LoopbackTransport, organism's EmporiumTransport, and rhizome's
 *     GardenClientConfig: { mcpUrl, token?, origin?, fetch?, transport? }.
 *
 * Transport is environment-split (the organism-proven recipe, preserved
 * VERBATIM):
 *   - BROWSER: base path "/cell" → the Vite dev proxy forwards same-origin
 *     /cell/* to the loopback and injects the bearer server-side. We use the
 *     browser `fetch` and ship NO token in JS.
 *   - NODE (tests / dev scripts / servers): we DON'T use Node's global
 *     `fetch` — Node 25's undici drops the `Authorization` header on loopback
 *     POSTs (verified: node:http with the same bearer returns 200, undici
 *     fetch returns 401 "missing bearer token"). So the Node path uses
 *     `node:http` directly, with the bearer attached, which the gardend
 *     loopback accepts. node:http is loaded via a guarded dynamic import so
 *     it never enters the browser bundle.
 *
 * Proven recipe source: apps/organism/scripts/probe-gardend-liveread.sh and
 * /Users/vera/dev/sophia/neem-rs/src/backend/local.rs.
 */

/** The ONE transport config: how an MCP client reaches a cell's /mcp route. */
export interface McpTransportConfig {
  /** Absolute URL of the MCP endpoint, e.g. http://127.0.0.1:<port>/mcp (Node)
   *  or "/cell/mcp" (browser, same-origin via the Vite proxy). */
  readonly mcpUrl: string
  /** Bearer token to attach server-side. Omit in the browser (the proxy injects
   *  it) — NEVER ship the loopback token into browser JS. */
  readonly token?: string
  /** Origin header to send (Node callers may mirror neem-rs with
   *  http://127.0.0.1; server-side callers without Origin also pass origin_ok). */
  readonly origin?: string
  /** Injected fetch (the browser path). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch
  /** Force the transport: 'fetch' (browser) or 'node-http'. 'auto' (or omitted)
   *  detects: absolute http(s) URL + Node runtime ⇒ node-http; else fetch. */
  readonly transport?: 'auto' | 'fetch' | 'node-http'
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

/** The `result` payload of a tools/call: an MCP content array, optionally with
 *  the structured envelope newer gardend builds emit. */
export interface ToolsCallResult {
  content?: Array<{ type?: string; text?: string }>
  structuredContent?: unknown
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
export const isNodeRuntime =
  typeof process !== 'undefined' &&
  typeof (process as { versions?: { node?: string } }).versions?.node === 'string'

/**
 * A thin MCP-over-HTTP client for a gardend cell. One instance per cell.
 */
export class McpClient {
  private readonly mode: 'fetch' | 'node-http'
  private readonly fetchImpl: typeof fetch | undefined

  constructor(private readonly t: McpTransportConfig) {
    // Decide the transport. Absolute loopback URL under Node ⇒ node:http (undici
    // strips Authorization on loopback POSTs). Otherwise the browser fetch path.
    const looksAbsolute = /^https?:\/\//.test(t.mcpUrl)
    const forced = t.transport === 'auto' ? undefined : t.transport
    this.mode = forced ?? (isNodeRuntime && looksAbsolute ? 'node-http' : 'fetch')
    if (this.mode === 'fetch') {
      // Bind the default fetch to globalThis: an unbound/aliased fetch throws
      // "Failed to execute 'fetch' on 'Window': Illegal invocation" when invoked
      // detached (this.fetchImpl(...)). Caught live in the organism — the
      // node:http-path integration test never exercised the browser fetch path.
      const g = globalThis as typeof globalThis & { fetch?: typeof fetch }
      const f = t.fetch ?? (typeof g.fetch === 'function' ? g.fetch.bind(g) : undefined)
      if (!f) throw new Error('McpClient: no fetch available (pass transport.fetch)')
      this.fetchImpl = f
    }
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
   * tools/call → the tool's payload, structuredContent-first (the rhizome
   * upgrade): newer gardend builds return `result.structuredContent`; older
   * ones return a single text content item whose body is a JSON envelope.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.toolsCall(name, args)
    if (result.structuredContent !== undefined) return result.structuredContent
    const text = mcpText(result)
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  // ── transport primitives ────────────────────────────────────────────────────

  private async post(url: string, body: string): Promise<HttpResponse> {
    if (this.mode === 'node-http') return this.nodeRequest('POST', url, body, true)
    const res = await this.fetchImpl!(url, { method: 'POST', headers: this.fetchHeaders(true), body })
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
