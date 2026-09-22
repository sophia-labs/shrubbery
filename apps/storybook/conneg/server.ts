/**
 * server.ts — the LOCAL content-negotiating dev server (the curl-able organism).
 *
 * This MIMICS the production CloudFront viewer-request function + S3 serving so
 * the rendered resources are curl-able LOCALLY — without touching prod infra
 * (HARD RULE: no wormnews terraform, no CloudFront edits, no S3 deploy). It:
 *   - negotiates Accept→target (default markdown, explicit `.ext` wins),
 *   - renders the REAL resource (catalog/component/workspace) via the pure
 *     @shrubbery/render package,
 *   - emits FAIR Signposting `Link` headers (the SAME link set the in-body
 *     Navigate block carries) + Content-Type + Vary: Accept.
 *
 * The server itself is the probe-able organism: `curl localhost:8787/catalog`
 * returns beautiful markdown with a Navigate block of more curls.
 *
 * `handle()` + `createConnegServer()` are exported so the conneg test drives the
 * REAL request path in-process (no mock). It only auto-listens when run directly.
 *
 * Run: pnpm --dir apps/storybook conneg   (PORT=8787 by default)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { negotiate, renderResource, toLinkHeader, type RenderTarget } from '@shrubbery/render'
import { htmlShell } from './html-shell.js'
import { routeTable } from './resources.js'

/** Handle one request — the REAL serving path (negotiate → render → headers). */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const baseUrl = `http://${req.headers.host ?? 'localhost'}`
  const { path, target } = negotiate(req.url ?? '/', req.headers.accept)

  if (path === '/' || path === '') {
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
    res.end(rootIndex(baseUrl))
    return
  }

  const route = routeTable()[path]
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 — no resource at ${path}\nTry: /catalog  /workspace\n`)
    return
  }

  const ctx = route.ctx(baseUrl)

  // dom/html → shell built around the markdown face (so html is still navigable).
  if (target === 'dom') {
    const md = await renderResource(route.resource, 'hypertext', ctx)
    const html = htmlShell(path, md.body, toLinkHeader(md.links))
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      vary: 'Accept',
      link: toLinkHeader(md.links),
    })
    res.end(html)
    return
  }

  const out = await renderResource(route.resource, target as Exclude<RenderTarget, 'dom'>, ctx)
  res.writeHead(200, {
    'content-type': out.contentType,
    vary: 'Accept',
    link: toLinkHeader(out.links),
  })
  res.end(out.body)
}

/** A tiny root index so `curl localhost:8787/` is itself navigable. */
function rootIndex(baseUrl: string): string {
  return `# Shrubbery — curl-able resources

A local content-negotiating server (mimics CloudFront Accept→ext + S3). Bare curl → markdown.

## Navigate

\`\`\`
curl ${baseUrl}/catalog                              # the component catalog (markdown)
curl ${baseUrl}/emporium                             # the VOCAB catalogue (the pack IS the catalog)
curl ${baseUrl}/emporium/workflow                    # one golden-contract vocab pack
curl ${baseUrl}/workspace                            # the GARDEN_DEFAULT workspace
curl -H "Accept: text/turtle" ${baseUrl}/catalog     # the catalog as RDF/Turtle
curl -H "Accept: application/ld+json" ${baseUrl}/emporium  # the vocab catalogue as JSON-LD
curl ${baseUrl}/catalog/mn-top-bar                   # one component page
\`\`\`
`
}

/** Build (but do not start) the conneg HTTP server — wraps `handle` with a 500 guard. */
export function createConnegServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`500 — ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })
}

// Auto-listen only when run directly (`tsx conneg/server.ts`), not when imported
// by the test.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const PORT = Number(process.env.PORT ?? 8787)
  createConnegServer().listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`shrubbery conneg server → http://localhost:${PORT}  (curl /catalog)`)
  })
}
