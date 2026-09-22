/**
 * sparql-protocol-server.ts — a REAL SPARQL 1.1 Protocol query endpoint over
 * the REAL oxigraph WASM engine (devDependency: deterministic post-install,
 * no external daemon, no mocks). This is the generic 'sparql-http' adapter's
 * conformance target and the third-party reference server (design §2.8): a
 * genuine non-gardend engine behind genuine HTTP is the only way "generic"
 * is PROVEN rather than asserted.
 *
 * Protocol surface (query operation only — this reference is a read target;
 * tests seed the engine in-process via `server.store.load(...)`):
 *   GET  <path>?query=…                                    → results
 *   POST <path>  application/sparql-query        (body)    → results
 *   POST <path>  application/x-www-form-urlencoded (query=) → results
 *
 * Responses are application/sparql-results+json SERIALIZED BY THE ENGINE
 * ITSELF (Store.query's results_format) — SELECT and ASK. A malformed or
 * non-SELECT/ASK query → 400 carrying the engine's message VERBATIM. Any
 * other path → 404; other methods → 405; other POST bodies → 415.
 *
 * Node-only (node:http) and deliberately NOT reachable from the '.' barrel:
 * it lives beside the conformance kit, and tests/browser-safety.test.ts
 * proves the browser-safe import graph never touches this directory.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Store } from 'oxigraph'

const RESULTS_JSON = 'application/sparql-results+json'

export interface SparqlProtocolServerOptions {
  /** URL path of the query endpoint. Default '/sparql'. */
  readonly path?: string
}

export interface SparqlProtocolServer {
  /** Absolute URL of the query endpoint (http://127.0.0.1:<port><path>). */
  readonly url: string
  /** The REAL backing engine — seed it via store.load / store.update. */
  readonly store: Store
  /** Stop listening and drop open connections. Idempotent. */
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Start the reference server on an ephemeral loopback port. */
export async function startSparqlProtocolServer(
  opts: SparqlProtocolServerOptions = {},
): Promise<SparqlProtocolServer> {
  const path = opts.path ?? '/sparql'
  const store = new Store()

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== path) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end(`no SPARQL endpoint at ${url.pathname} (the query endpoint is ${path})`)
        return
      }

      let query: string | null = null
      if (req.method === 'GET') {
        query = url.searchParams.get('query')
        if (query === null) {
          res.writeHead(400, { 'content-type': 'text/plain' })
          res.end("SPARQL 1.1 Protocol: GET requires a 'query' parameter")
          return
        }
      } else if (req.method === 'POST') {
        const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
        const body = await readBody(req)
        if (contentType === 'application/sparql-query') {
          query = body
        } else if (contentType === 'application/x-www-form-urlencoded') {
          query = new URLSearchParams(body).get('query')
          if (query === null) {
            res.writeHead(400, { 'content-type': 'text/plain' })
            res.end("SPARQL 1.1 Protocol: form-encoded POST requires a 'query' parameter")
            return
          }
        } else {
          res.writeHead(415, { 'content-type': 'text/plain' })
          res.end(
            `unsupported media type '${contentType}' — use application/sparql-query or application/x-www-form-urlencoded`,
          )
          return
        }
      } else {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' })
        res.end('SPARQL 1.1 Protocol: use GET or POST')
        return
      }

      // Evaluate on the REAL engine; serialization is the ENGINE'S OWN
      // sparql-results+json writer. Engine refusals surface verbatim.
      let result: unknown
      try {
        result = store.query(query, { results_format: RESULTS_JSON })
      } catch (e) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end(e instanceof Error ? e.message : String(e))
        return
      }
      if (typeof result !== 'string') {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end(`only SELECT/ASK serialize to ${RESULTS_JSON}; send a SELECT or ASK query`)
        return
      }
      res.writeHead(200, { 'content-type': RESULTS_JSON })
      res.end(result)
    })().catch((e: unknown) => {
      // Last-resort guard: surface the real failure, never hang the socket.
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(e instanceof Error ? e.message : String(e))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address !== 'object') {
    throw new Error('sparql-protocol-server: could not determine the listening port')
  }

  let closed = false
  return {
    url: `http://127.0.0.1:${address.port}${path}`,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          resolve()
          return
        }
        closed = true
        server.closeAllConnections()
        server.close(err => (err ? reject(err) : resolve()))
      }),
  }
}
