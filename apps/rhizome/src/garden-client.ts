/**
 * garden-client.ts — the SPARQL-over-/mcp client for a live gardend cell.
 *
 * RHIZOME is read-only. This client speaks the EXACT wire the bench harness uses
 * (choreograph/scripts/longmemeval/gardend.ts): a single JSON-RPC 2.0 POST to
 * /mcp, Bearer auth, the `sparql_query` tool. We DON'T invent endpoints.
 *
 * Transport is `node:http` (NOT global fetch): Node's undici drops the
 * Authorization header on loopback POSTs (verified live in apps/organism's
 * loopback-mcp.ts), so the proven recipe is node:http with the bearer attached.
 *
 * SPARQL SELECT rows come back as N-Triples-style term STRINGS, e.g.
 *   "<urn:…:record:3c37…>"  |  "\"active\""  |  "\"2\"^^<…#integer>".
 * `parseTerm` unwraps them to { type, value } so the data layer reads plain
 * values — the same shape nucleus's Term carries, but tolerant of the wire form.
 *
 * App/tooling level — the pure @shrubbery/render package never speaks HTTP.
 */

/** A parsed SPARQL term — either an IRI or a (optionally typed) literal. */
export interface SparqlTerm {
  readonly type: 'iri' | 'literal'
  readonly value: string
  readonly datatype?: string
}

/** One SELECT result row: var name → parsed term (absent vars omitted). */
export type SparqlRow = Record<string, SparqlTerm>

export interface GardenClientConfig {
  /** Cell host (default 127.0.0.1). */
  readonly host?: string
  /** Cell port (default 7090). */
  readonly port?: string | number
  /** Bearer token (default bench-token). */
  readonly token?: string
  /**
   * Transport. `node-http` (default) keeps the Authorization header undici drops
   * on loopback POSTs — the proven recipe for the Node smoke + the serve. `fetch`
   * is the browser path: the shell points `base` at a SAME-ORIGIN Vite `/cell`
   * proxy that injects the bearer server-side, so the browser never holds the
   * token (mirrors apps/organism's emporium-client environment split).
   */
  readonly transport?: 'node-http' | 'fetch'
  /**
   * Browser base URL (the same-origin proxy prefix, e.g. '/cell'). When set, the
   * fetch transport POSTs to `${base}/mcp`; the host/port/token are NOT used (the
   * proxy injects auth). Falls back to the host:port base otherwise.
   */
  readonly base?: string
}

/**
 * Unwrap a SPARQL row value (an N-Triples-style string) into a SparqlTerm.
 *   "<iri>"                 → { type:'iri', value:'iri' }
 *   "\"lex\"^^<dt>"         → { type:'literal', value:'lex', datatype:'dt' }
 *   "\"lex\""               → { type:'literal', value:'lex' }
 *   bare "lex"              → { type:'literal', value:'lex' }  (lenient)
 */
export function parseTerm(raw: string): SparqlTerm {
  const s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) {
    return { type: 'iri', value: s.slice(1, -1) }
  }
  if (s.startsWith('"')) {
    // find the closing unescaped quote
    let close = -1
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '\\') {
        i++
        continue
      }
      if (s[i] === '"') {
        close = i
        break
      }
    }
    if (close === -1) return { type: 'literal', value: s }
    const lex = s
      .slice(1, close)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
    const rest = s.slice(close + 1).trim()
    if (rest.startsWith('^^<') && rest.endsWith('>')) {
      return { type: 'literal', value: lex, datatype: rest.slice(3, -1) }
    }
    return { type: 'literal', value: lex }
  }
  // bare token (some cells return unquoted literals) — treat as a plain literal.
  return { type: 'literal', value: s }
}

/** The lexical value of a row var, or undefined if the var is absent. */
export function val(row: SparqlRow, name: string): string | undefined {
  return row[name]?.value
}

/** Read an env var without a hard `process` reference (browser bundles lack it). */
function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}

export class GardenClient {
  readonly base: string
  private readonly token: string
  private readonly transport: 'node-http' | 'fetch'
  private rpcId = 0

  constructor(cfg: GardenClientConfig = {}) {
    this.transport = cfg.transport ?? 'node-http'
    this.token = cfg.token ?? env('GARDEND_TOKEN') ?? 'bench-token'
    if (cfg.base) {
      // Browser path: a same-origin proxy prefix (e.g. '/cell'). No host:port.
      this.base = cfg.base.replace(/\/$/, '')
    } else {
      const host = cfg.host ?? env('GARDEND_HOST') ?? '127.0.0.1'
      const port = String(cfg.port ?? env('GARDEND_PORT') ?? '7090')
      this.base = `http://${host}:${port}`
    }
  }

  /** GET /health → true when the cell is up. */
  async health(): Promise<boolean> {
    try {
      const res = await this.request('GET', '/health', undefined)
      return res.status >= 200 && res.status < 300
    } catch {
      return false
    }
  }

  /** Poll /health until healthy or the deadline elapses. */
  async waitHealthy(timeoutMs = 30_000, intervalMs = 250): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.health()) return
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error(`gardend not healthy at ${this.base}/health within ${timeoutMs}ms`)
  }

  /** Low-level MCP tools/call → parsed `result` payload (structuredContent or content[0].text). */
  async mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: ++this.rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    const res = await this.request('POST', '/mcp', body)
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`gardend ${name}: HTTP ${res.status} — ${res.body.slice(0, 500)}`)
    }
    const d = JSON.parse(res.body) as {
      result?: { structuredContent?: unknown; content?: Array<{ text?: string }> }
      error?: unknown
    }
    if (d.error) throw new Error(`gardend ${name}: JSON-RPC error ${JSON.stringify(d.error)}`)
    const sc = d.result?.structuredContent
    if (sc !== undefined) return sc
    const text = d.result?.content?.[0]?.text
    return text ? JSON.parse(text) : undefined
  }

  /** Run a SPARQL SELECT; return parsed rows (var → SparqlTerm). */
  async select(graphId: string, query: string): Promise<SparqlRow[]> {
    const out = (await this.mcp('sparql_query', { graphId, query })) as
      | { rows?: Array<Record<string, string>> }
      | undefined
    const rows = out?.rows ?? []
    return rows.map((r) => {
      const parsed: SparqlRow = {}
      for (const [k, v] of Object.entries(r)) parsed[k] = parseTerm(v)
      return parsed
    })
  }

  // ── Transport (node:http for the smoke/serve; fetch through the proxy for the browser) ──

  private request(
    method: string,
    path: string,
    body: string | undefined,
  ): Promise<{ status: number; body: string }> {
    if (this.transport === 'fetch') return this.fetchRequest(method, path, body)
    return this.nodeRequest(method, path, body)
  }

  /** Browser path: fetch through the same-origin proxy (token injected server-side). */
  private async fetchRequest(
    method: string,
    path: string,
    body: string | undefined,
  ): Promise<{ status: number; body: string }> {
    const res = await fetch(this.base + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body,
    })
    return { status: res.status, body: await res.text() }
  }

  private nodeRequest(
    method: string,
    path: string,
    body: string | undefined,
  ): Promise<{ status: number; body: string }> {
    const u = new URL(this.base + path)
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(body))
    }
    return new Promise((resolve, reject) => {
      import('node:http')
        .then((http) => {
          const req = http.request(
            { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
            (res) => {
              let data = ''
              res.setEncoding('utf8')
              res.on('data', (c) => (data += c))
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
            },
          )
          req.on('error', reject)
          if (body !== undefined) req.write(body)
          req.end()
        })
        .catch(reject)
    })
  }
}
