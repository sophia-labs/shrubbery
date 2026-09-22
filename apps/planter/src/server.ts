/**
 * server.ts — the PLANTER conneg HTTP server (the generic curl-able host).
 *
 * Modeled on apps/rhizome/src/server.ts WHOLESALE (design §3.1): `negotiate`
 * (hoisted, `@shrubbery/render`) → resolve the resource LIVE PER-REQUEST from
 * ONE bound `TripleSource` → `linksFor` once → render face. No snapshots
 * anywhere: static bytes enter only via the `static-nt` fossil ADAPTER
 * (declared, with capture provenance) — never an app-local JSON cache.
 *
 * Routes (all with `.md/.ttl/.json/.jsonld/.html` pins + Accept negotiation,
 * bare curl → markdown):
 *   GET /  and  /site   — the site: the EXISTING `workspace` Resource kind
 *                         (zero new render kinds, zero packages/render touches).
 *   GET /source          — app-level self-description (JSON capability card +
 *                         htmlShell markdown/html faces; source-page.ts).
 *   GET /health           — 200 + JSON of the last read status. Never fakes
 *                         upstream health.
 *   ?asof                 — RESERVED: an explicit "not available" testimony
 *                         line (design §3.1) rather than a silently-ignored
 *                         query param. A dated lens is a named later slice.
 *
 * Testimony (the six X-Shrubbery-* headers + Last-Modified) is computed ONCE
 * per request (testimony.ts) from whichever read the route needed, and is
 * IDENTICAL across all four faces of the SAME resource (face-invariant by
 * construction). The empty/error/malformed taxonomy (read-status.ts) is
 * shared with the SPA (U11).
 *
 * HIGH-2: the `pnpm serve` entry in `server-entry.ts` boots through the SAME
 * validated `PlanterBootConfig` resolution the SPA uses (`server-boot.ts`'s
 * `bootConfigFromProcessEnv` → `sourceFromBoot`, `@shrubbery/source`'s ONE
 * adapter factory) — no hardcoded `adapter: 'gardend-local'`, no guessed
 * endpoint/graph fallback. Any of the four adapters is selectable:
 *
 *   # direct to a local gardend (dev/bench):
 *   PLANTER_GRAPH=g1 PLANTER_ENDPOINT=http://127.0.0.1:7090 \
 *     PLANTER_ADAPTER=gardend-local PLANTER_AUTH_MODE=dev PLANTER_AUTH_TOKEN=bench-token \
 *     pnpm -C apps/planter serve
 *
 *   # a static-nt fossil, no credentials, no live process:
 *   PLANTER_GRAPH=g1 PLANTER_ENDPOINT=static:/path/to/g1.nt PLANTER_ADAPTER=static-nt \
 *     pnpm -C apps/planter serve
 *
 *   # behind platform-next's gateway (readPath defaults 'sparql'):
 *   PLANTER_OWNER=agent:phanes PLANTER_GRAPH=g1 PLANTER_ENDPOINT=https://api.canary.sophia-labs.com \
 *     PLANTER_ADAPTER=hosted-gateway PLANTER_AUTH_MODE=dev PLANTER_AUTH_TOKEN=<editor-token> \
 *     pnpm -C apps/planter serve
 *
 * `PLANTER_ENDPOINT`/`PLANTER_GRAPH` are both required. `PLANTER_OWNER` is
 * additionally required for hosted-gateway so an ambiguous slug can never
 * fall back to the legacy ownerless route; see `server-boot.ts`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { type TripleSource, type TripleSourceDescription, uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  type AltLink,
  CONTENT_TYPE,
  faceUrl,
  linksFor,
  negotiate,
  type RenderCtx,
  type RenderTarget,
  renderHypertext,
  renderJson,
  renderTurtle,
  toLinkHeader,
  triplesToTurtle,
  type WorkspaceResource,
} from '@shrubbery/render'
import type { SiteBundle } from '@shrubbery/site'
import { htmlShell } from './html-shell.js'
import {
  classifyRead,
  type FailedStatus,
  httpStatusFor,
  type MalformedStatus,
  type ReadStatus,
  readSucceeded,
} from './read-status.js'
import { contentSourceTurtle, sourceCapabilityCard, sourcePageMarkdown } from './source-page.js'
import {
  asofNotAvailableLine,
  staleCaptureJson,
  staleCaptureMarkdown,
  staleCaptureTurtleComment,
  type Testimony,
  testimonyCaptureComment,
  testimonyFooter,
  testimonyFor,
  testimonyHeaders,
} from './testimony.js'

// ── Boot options ─────────────────────────────────────────────────────────────

export interface PlanterServerOptions {
  /** The bound TripleSource — any adapter the boot factory wires (gardend-local,
   *  hosted-gateway, sparql, static-nt). The server never knows which. */
  readonly source: TripleSource
  readonly graphId: string
  /** Override for non-Mnemosyne stores; default `uxConfigGraphIri(graphId)`. */
  readonly configGraphIri?: string
  /** Threaded through to /source's `site:ContentSource` `site:authMode`
   *  predicate — a bare TripleSource carries no auth-mode testimony of its
   *  own; omitted (never guessed) when the caller doesn't supply it. */
  readonly authMode?: string
  /** Optional code-reviewed product bundle. Its routes alias the same live
   * workspace resource; face rendering remains the generic Planter pipeline. */
  readonly bundle?: SiteBundle
}

// ── Shared link-set helper for routes with NO Resource object ───────────────
//
// `/source`, `/health`, and the empty/error/malformed site pages describe
// something OTHER than a render-package `Resource` (a capability card, a
// health snapshot, an unparseable graph) — `linksFor` needs a `Resource`, so
// these routes build the same self+alternates+describedby shape directly off
// `faceUrl` (the exact set `linksFor`'s `alternateFaces` produces for a
// resource with no `up`/`item`/`collection` edges — i.e. every kind this host
// serves outside the workspace root).

const FACE_TITLES: Readonly<Record<RenderTarget, string>> = {
  hypertext: 'Markdown',
  turtle: 'RDF/Turtle',
  json: 'JSON-LD',
  dom: 'HTML',
}

function basicAltLinks(ctx: RenderCtx, selfTarget: RenderTarget): AltLink[] {
  const links: AltLink[] = [
    { rel: 'self', href: faceUrl(ctx, ctx.selfPath), type: CONTENT_TYPE[selfTarget], title: FACE_TITLES[selfTarget] },
  ]
  for (const t of ['hypertext', 'turtle', 'json', 'dom'] as const) {
    links.push({
      rel: t === 'turtle' ? 'describedby' : 'alternate',
      href: faceUrl(ctx, ctx.selfPath, t),
      type: CONTENT_TYPE[t],
      title: FACE_TITLES[t],
    })
  }
  return links
}

function linksAsPlain(links: readonly AltLink[]): ReadonlyArray<Record<string, string>> {
  return links.map((l) => ({ rel: l.rel, href: l.href, type: l.type, ...(l.title ? { title: l.title } : {}) }))
}

function ctxFor(baseUrl: string, selfPath: string): RenderCtx {
  return { baseUrl, selfPath, upPath: null }
}

/** The result of rendering one face, before it is written to the response. */
interface FaceResult {
  readonly status: number
  readonly body: string
  readonly contentType: string
  readonly headers: Record<string, string>
}

/** Apply the reserved `?asof` note (design §3.1) to a text/turtle/json body. */
function withAsofNote(body: string, target: RenderTarget, note: string | null): string {
  if (note === null) return body
  if (target === 'json') {
    const obj = JSON.parse(body) as Record<string, unknown>
    return JSON.stringify({ ...obj, asof: note }, null, 2)
  }
  if (target === 'turtle') return `# asof: ${note}\n${body}`
  return `${body}\n\n> **?asof**: ${note}\n`
}

// ── / and /site — the workspace Resource ────────────────────────────────────

function withFooter(markdown: string, t: Testimony): string {
  return `${markdown}\n\n---\n\n${testimonyFooter(t)}\n`
}

async function renderSiteOk(
  target: RenderTarget,
  resource: WorkspaceResource,
  ctx: RenderCtx,
  t: Testimony,
): Promise<{ body: string; contentType: string; linkHeader: string }> {
  if (target === 'dom') {
    const hyper = renderHypertext(resource, ctx)
    const markdown = withFooter(hyper.body, t)
    const links = linksFor(resource, 'dom', ctx)
    const linkHeader = toLinkHeader(links)
    return {
      body: htmlShell(`Workspace — ${resource.config.label}`, markdown, linkHeader),
      contentType: CONTENT_TYPE.dom,
      linkHeader,
    }
  }
  if (target === 'hypertext') {
    const hyper = renderHypertext(resource, ctx)
    return { body: withFooter(hyper.body, t), contentType: CONTENT_TYPE.hypertext, linkHeader: toLinkHeader(hyper.links) }
  }
  if (target === 'turtle') {
    const ttl = renderTurtle(resource, ctx)
    return {
      body: `${testimonyCaptureComment(t)}\n\n${ttl.body}`,
      contentType: CONTENT_TYPE.turtle,
      linkHeader: toLinkHeader(ttl.links),
    }
  }
  // json — pure config this slice; testimony carried by headers only (design §3.1).
  const json = await renderJson(resource, ctx)
  return { body: json.body, contentType: CONTENT_TYPE.json, linkHeader: toLinkHeader(json.links) }
}

function emptyMarkdown(t: Testimony): string {
  return [
    '# Workspace — empty',
    '',
    `No triples in <${t.graphIri}> yet.`,
    '',
    '0 triples — seed with `pnpm --dir apps/planter seed …` (a documentation affordance, never an automatic write).',
    '',
    testimonyFooter(t),
  ].join('\n')
}

function emptyTurtle(t: Testimony): string {
  return [testimonyCaptureComment(t), '# EMPTY — no triples in this graph yet.'].join('\n')
}

function emptyJson(t: Testimony): Record<string, unknown> {
  return {
    empty: true,
    graphIri: t.graphIri,
    readAt: t.readAt,
    readAtIso: t.readAtIso,
    tripleCount: 0,
    hint: 'seed with `pnpm --dir apps/planter seed …`',
  }
}

function malformedMarkdown(status: MalformedStatus, t: Testimony): string {
  return [
    '# Error — malformed config (500)',
    '',
    `${status.triples.length} triples read from <${t.graphIri}>, but they do not parse as a workspace config:`,
    '',
    '```',
    status.error.message,
    '```',
    '',
    'The raw triples ARE inspectable: see `/site.ttl`.',
    '',
    testimonyFooter(t),
  ].join('\n')
}

function malformedTurtle(status: MalformedStatus, t: Testimony): string {
  return [
    testimonyCaptureComment(t),
    `# ERROR malformed: ${status.error.message}`,
    '# the raw triples below ARE inspectable, even though they do not parse as a workspace config',
    '',
    triplesToTurtle(status.triples),
  ].join('\n')
}

function malformedJson(status: MalformedStatus, t: Testimony): Record<string, unknown> {
  return {
    error: 'malformed',
    message: status.error.message,
    graphIri: t.graphIri,
    tripleCount: status.triples.length,
    hint: 'the raw triples are inspectable at /site.ttl',
  }
}

/** For 'unavailable' specifically, the design requires the body to NAME the
 *  endpoint (not merely repeat whatever the upstream error string happened to
 *  mention) — the other failed kinds carry the verbatim upstream message only. */
function endpointNote(status: FailedStatus, description: TripleSourceDescription): string | null {
  if (status.kind !== 'unavailable') return null
  return description.endpoint ? `endpoint: ${description.endpoint}` : null
}

function errorMarkdown(status: FailedStatus, description: TripleSourceDescription, lastGood?: Testimony): string {
  const endpoint = endpointNote(status, description)
  return [
    `# Error — ${status.kind} (${status.error.status ?? httpStatusFor(status)})`,
    '',
    ...(endpoint ? [endpoint, ''] : []),
    status.error.message,
    ...(status.error.detail ? ['', '```', status.error.detail, '```'] : []),
    ...(lastGood ? ['', staleCaptureMarkdown(lastGood)] : []),
  ].join('\n')
}

function errorTurtle(status: FailedStatus, description: TripleSourceDescription, lastGood?: Testimony): string {
  return [
    `# ERROR ${status.kind}: ${status.error.message}`,
    endpointNote(status, description) ? `# ${endpointNote(status, description)}` : '',
    status.error.detail ? `# detail: ${status.error.detail}` : '',
    ...(lastGood ? [staleCaptureTurtleComment(lastGood)] : []),
  ]
    .filter(Boolean)
    .join('\n')
}

function errorJson(
  status: FailedStatus,
  description: TripleSourceDescription,
  lastGood?: Testimony,
): Record<string, unknown> {
  return {
    error: status.kind,
    message: status.error.message,
    detail: status.error.detail,
    status: status.error.status,
    ...(status.kind === 'unavailable' && description.endpoint ? { endpoint: description.endpoint } : {}),
    ...(lastGood ? { lastGood: staleCaptureJson(lastGood) } : {}),
  }
}

async function handleSite(
  target: RenderTarget,
  ctx: RenderCtx,
  status: ReadStatus,
  description: TripleSourceDescription,
  asofNote: string | null,
  lastGood?: Testimony,
): Promise<FaceResult> {
  const httpStatus = httpStatusFor(status)

  if (status.kind === 'ok') {
    const t = testimonyFor(status.read, description)
    const resource: WorkspaceResource = { kind: 'workspace', config: status.config }
    const rendered = await renderSiteOk(target, resource, ctx, t)
    return {
      status: 200,
      body: withAsofNote(rendered.body, target, asofNote),
      contentType: rendered.contentType,
      headers: { ...testimonyHeaders(t), link: rendered.linkHeader },
    }
  }

  const links = basicAltLinks(ctx, target)
  const linkHeader = toLinkHeader(links)

  if (status.kind === 'empty') {
    const t = testimonyFor(status.read, description)
    let body: string
    let contentType: string
    if (target === 'json') {
      body = JSON.stringify({ ...emptyJson(t), _links: linksAsPlain(links) }, null, 2)
      contentType = CONTENT_TYPE.json
    } else if (target === 'turtle') {
      body = emptyTurtle(t)
      contentType = CONTENT_TYPE.turtle
    } else if (target === 'dom') {
      body = htmlShell('Workspace — empty', emptyMarkdown(t), linkHeader)
      contentType = CONTENT_TYPE.dom
    } else {
      body = emptyMarkdown(t)
      contentType = CONTENT_TYPE.hypertext
    }
    return { status: 200, body: withAsofNote(body, target, asofNote), contentType, headers: { ...testimonyHeaders(t), link: linkHeader } }
  }

  if (status.kind === 'malformed') {
    const t = testimonyFor(status.read, description)
    let body: string
    let contentType: string
    if (target === 'json') {
      body = JSON.stringify({ ...malformedJson(status, t), _links: linksAsPlain(links) }, null, 2)
      contentType = CONTENT_TYPE.json
    } else if (target === 'turtle') {
      body = malformedTurtle(status, t)
      contentType = CONTENT_TYPE.turtle
    } else if (target === 'dom') {
      body = htmlShell('Workspace — malformed (500)', malformedMarkdown(status, t), linkHeader)
      contentType = CONTENT_TYPE.dom
    } else {
      body = malformedMarkdown(status, t)
      contentType = CONTENT_TYPE.hypertext
    }
    return {
      status: 500,
      body: withAsofNote(body, target, asofNote),
      contentType,
      headers: { ...testimonyHeaders(t), link: linkHeader },
    }
  }

  // unauthorized / forbidden / not-found / unavailable — passthrough verbatim,
  // plus the last-good testimony (headers + a clearly-labeled stale capture
  // block), when this bound source has ever completed a read (design §3.1).
  let body: string
  let contentType: string
  if (target === 'json') {
    body = JSON.stringify(
      { ...errorJson(status, description, lastGood), _links: linksAsPlain(links) },
      null,
      2,
    )
    contentType = CONTENT_TYPE.json
  } else if (target === 'turtle') {
    body = errorTurtle(status, description, lastGood)
    contentType = CONTENT_TYPE.turtle
  } else if (target === 'dom') {
    body = htmlShell(`Error — ${status.kind}`, errorMarkdown(status, description, lastGood), linkHeader)
    contentType = CONTENT_TYPE.dom
  } else {
    body = errorMarkdown(status, description, lastGood)
    contentType = CONTENT_TYPE.hypertext
  }
  const headers: Record<string, string> = { link: linkHeader }
  if (status.kind === 'unavailable') headers['retry-after'] = '2'
  if (lastGood) Object.assign(headers, testimonyHeaders(lastGood))
  return { status: httpStatus, body: withAsofNote(body, target, asofNote), contentType, headers }
}

// ── /source — the app-level self-description route ─────────────────────────

async function handleSource(
  target: RenderTarget,
  ctx: RenderCtx,
  graphId: string,
  graphIri: string,
  description: TripleSourceDescription,
  status: ReadStatus,
  authMode: string | undefined,
  asofNote: string | null,
): Promise<FaceResult> {
  const opts = { graphId, graphIri, description, readStatus: status, ...(authMode !== undefined ? { authMode } : {}) }
  const links = basicAltLinks(ctx, target)
  const linkHeader = toLinkHeader(links)

  let body: string
  let contentType: string
  if (target === 'turtle') {
    body = contentSourceTurtle(opts)
    contentType = CONTENT_TYPE.turtle
  } else if (target === 'json') {
    body = JSON.stringify({ ...sourceCapabilityCard(opts), _links: linksAsPlain(links) }, null, 2)
    contentType = CONTENT_TYPE.json
  } else if (target === 'dom') {
    body = htmlShell('Planter — source', sourcePageMarkdown(opts), linkHeader)
    contentType = CONTENT_TYPE.dom
  } else {
    body = sourcePageMarkdown(opts)
    contentType = CONTENT_TYPE.hypertext
  }

  const headers: Record<string, string> = { link: linkHeader }
  if (status.kind === 'ok' || status.kind === 'empty' || status.kind === 'malformed') {
    Object.assign(headers, testimonyHeaders(testimonyFor(status.read, description)))
  }
  return { status: 200, body: withAsofNote(body, target, asofNote), contentType, headers }
}

// ── /health ──────────────────────────────────────────────────────────────────

function healthPayload(status: ReadStatus, description: TripleSourceDescription): Record<string, unknown> {
  const ok = readSucceeded(status)
  const base: Record<string, unknown> = { ok, source: description.kind, liveness: description.liveness }
  if (status.kind === 'ok' || status.kind === 'empty' || status.kind === 'malformed') {
    return {
      ...base,
      status: status.kind,
      readAt: status.read.readAt,
      readAtIso: new Date(status.read.readAt).toISOString(),
      graphIri: status.read.graphIri,
      tripleCount: status.kind === 'empty' ? 0 : status.read.tripleCount,
    }
  }
  return { ...base, status: status.kind, message: status.error.message, detail: status.error.detail }
}

function healthMarkdown(payload: Record<string, unknown>): string {
  const lines = ['# Health', '']
  for (const [k, v] of Object.entries(payload)) {
    lines.push(`- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  return lines.join('\n')
}

function handleHealth(
  target: RenderTarget,
  ctx: RenderCtx,
  status: ReadStatus,
  description: TripleSourceDescription,
  asofNote: string | null,
): FaceResult {
  const payload = healthPayload(status, description)
  const links = basicAltLinks(ctx, target)
  const linkHeader = toLinkHeader(links)

  let body: string
  let contentType: string
  if (target === 'json') {
    body = JSON.stringify({ ...payload, _links: linksAsPlain(links) }, null, 2)
    contentType = CONTENT_TYPE.json
  } else if (target === 'turtle') {
    body = Object.entries(payload)
      .map(([k, v]) => `# ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n')
    contentType = CONTENT_TYPE.turtle
  } else if (target === 'dom') {
    body = htmlShell('Planter — health', healthMarkdown(payload), linkHeader)
    contentType = CONTENT_TYPE.dom
  } else {
    body = healthMarkdown(payload)
    contentType = CONTENT_TYPE.hypertext
  }
  // /health is 200 always — "never fakes upstream health" means the BODY tells
  // the truth about the upstream, not that this endpoint mirrors its status.
  return { status: 200, body: withAsofNote(body, target, asofNote), contentType, headers: { link: linkHeader } }
}

// ── The dispatcher ───────────────────────────────────────────────────────────

/** Per-server mutable state: the last testimony from a read that actually
 *  succeeded (ok or empty — mirrors `SourceState.read`'s "set for ready AND
 *  empty; retained through later errors" retention rule in
 *  packages/source/src/store/source-store.ts). NOT updated on 'malformed' —
 *  a malformed read already carries its OWN current testimony (it needs no
 *  stand-in), and is a config-shape failure, not the "read never happened at
 *  all" gap this cache exists to soften. One instance per bound TripleSource
 *  (created in `createPlanterServer`, shared across every request the server
 *  handles), so it survives across requests but never across servers/sources. */
export interface PlanterServerState {
  lastGood?: Testimony
}

function noteIfSucceeded(status: ReadStatus, description: TripleSourceDescription, state: PlanterServerState): void {
  if (status.kind === 'ok' || status.kind === 'empty') {
    state.lastGood = testimonyFor(status.read, description)
  }
}

export async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: PlanterServerOptions,
  state: PlanterServerState = {},
): Promise<void> {
  const baseUrl = `http://${req.headers.host ?? 'localhost'}`
  const { path, target, query } = negotiate(req.url ?? '/', req.headers.accept)
  const graphIri = opts.configGraphIri ?? uxConfigGraphIri(opts.graphId)
  const description = opts.source.description
  const asofNote = query.has('asof') ? asofNotAvailableLine(description.liveness) : null

  let result: FaceResult
  const bundleRoute = opts.bundle?.routes.find((route) => route.path === path)
  if (path === '/' || path === '/site' || bundleRoute) {
    const selfPath = bundleRoute?.path === '/'
      ? opts.bundle?.routes.find((route) => route.surface === bundleRoute.surface && route.path !== '/')?.path ?? '/site'
      : bundleRoute?.path ?? '/site'
    const ctx = ctxFor(baseUrl, selfPath)
    const status = await classifyRead(opts.source, graphIri)
    noteIfSucceeded(status, description, state)
    const lastGood = status.kind === 'ok' || status.kind === 'empty' ? undefined : state.lastGood
    result = await handleSite(target, ctx, status, description, asofNote, lastGood)
  } else if (path === '/source') {
    const ctx = ctxFor(baseUrl, '/source')
    const status = await classifyRead(opts.source, graphIri)
    noteIfSucceeded(status, description, state)
    result = await handleSource(target, ctx, opts.graphId, graphIri, description, status, opts.authMode, asofNote)
  } else if (path === '/health') {
    const ctx = ctxFor(baseUrl, '/health')
    const status = await classifyRead(opts.source, graphIri)
    noteIfSucceeded(status, description, state)
    result = handleHealth(target, ctx, status, description, asofNote)
  } else {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    const bundlePaths = opts.bundle?.routes.map((route) => route.path).join('  ') ?? ''
    res.end(`404 — no resource at ${path}\nTry: /  /site  /source  /health${bundlePaths ? `  ${bundlePaths}` : ''}\n`)
    return
  }

  const bundleHeader = opts.bundle ? { 'x-shrubbery-bundle': opts.bundle.id } : {}
  res.writeHead(result.status, { 'content-type': result.contentType, vary: 'Accept', ...bundleHeader, ...result.headers })
  res.end(result.body)
}

/** Build (but do not start) the server, bound to a single TripleSource. One
 *  `PlanterServerState` per server instance — shared across every request so
 *  a later failed read can still show the last-good testimony (design §3.1). */
export function createPlanterServer(opts: PlanterServerOptions): Server {
  const state: PlanterServerState = {}
  return createServer((req, res) => {
    handle(req, res, opts, state).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[planter] 500 on ${req.url}:`, err instanceof Error ? err.stack : err)
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`500 — ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })
}
