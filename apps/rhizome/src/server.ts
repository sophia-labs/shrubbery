/**
 * server.ts — the RHIZOME conneg HTTP server (the curl-able memory observatory).
 *
 * Serves a live gardend cell's :projection:memory as curl-able resources:
 *   GET /plot                      → the index of subject-beds (markdown default)
 *   GET /plot?asof=2023-05-25      → the index, heads RECOMPUTED as-of that date
 *   GET /plot/{rootId}             → one bed (current head + superseded predecessors)
 *   GET /plot/{rootId}?asof=…      → that bed as-of T (the temporal lens)
 *   …with .ttl / .json / .md / .html extensions + Accept negotiation (bare curl
 *      → markdown). Every face carries the SAME FAIR Link set (RFC 8288 + Navigate
 *      block), built by @shrubbery/render.
 *
 * Resources are built LIVE per-request from the cell (NO MOCKS, NO snapshot) so
 * `?asof` is honored on every read. The pure render package never speaks SPARQL;
 * this host hands it a Resource + a RenderCtx.
 *
 * Run: GARDEND_PORT=7090 GARDEND_TOKEN=bench-token RHIZOME_GRAPH=6a1eabeb-agentic \
 *      pnpm -C apps/rhizome serve   (PORT=8791 by default)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import {
  linksFor,
  negotiate,
  renderResource,
  toLinkHeader,
  type RenderCtx,
  type RenderTarget,
  type Resource,
} from '@shrubbery/render'
import { GardenClient } from './garden-client.js'
import { MemoryWorld } from './memory-world.js'
import { GreenhouseWorld } from './greenhouse-world.js'
import { TraceWorld } from './trace-world.js'
import {
  renderBouquetHtml,
  renderGreenhouseHtml,
  renderKnobHtml,
  renderPlotHtml,
  renderSubjectHtml,
  renderWalkIndexHtml,
  renderWalkRunHtml,
} from './dom-server.js'

const GRAPH_ID = process.env.RHIZOME_GRAPH ?? '6a1eabeb-agentic'

/** The data worlds the conneg server fronts: the cell (Plot/Greenhouse) + files (Walk). */
export interface Worlds {
  readonly memory: MemoryWorld
  readonly greenhouse: GreenhouseWorld
  readonly trace: TraceWorld
}

/** Parse an integer turn cursor (`?turn=N`), or null when absent/invalid. */
function turnCursor(query: URLSearchParams): number | null {
  const raw = query.get('turn')
  if (raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Build the (live) resource for a path + lens (asof / turn), or null for a 404. */
async function resolveResource(
  worlds: Worlds,
  path: string,
  asof: string | null,
  turn: number | null,
): Promise<Resource | null> {
  // THE PLOT (live cell) — the index + one subject-bed.
  if (path === '/plot') return worlds.memory.plot(asof)
  const pm = /^\/plot\/([^/]+)$/.exec(path)
  if (pm) return worlds.memory.subject(decodeURIComponent(pm[1]), asof)
  // THE BOUQUET (live cell) — the index of readable beliefs (reusing the Plot row
  // list, served under /bouquet so its item links bloom) + one bed's constellation.
  if (path === '/bouquet') return worlds.memory.plot(asof)
  const bm = /^\/bouquet\/([^/]+)$/.exec(path)
  if (bm) return worlds.memory.bouquet(decodeURIComponent(bm[1]), asof)
  // THE WALK (trace files) — the index + one run's ribbon of turns.
  if (path === '/walk') return worlds.trace.walk()
  const wm = /^\/walk\/([^/]+)$/.exec(path)
  if (wm) return worlds.trace.trace(decodeURIComponent(wm[1]), turn)
  // THE GREENHOUSE (live cell) — the knob index + one knob (the tn:ConfigDimension).
  // `?asof` reads the knob-history (the dial's past value + its meter then).
  if (path === '/tune') return worlds.greenhouse.greenhouse(asof)
  const km = /^\/tune\/([^/]+)$/.exec(path)
  if (km) return worlds.greenhouse.knob(decodeURIComponent(km[1]), asof)
  return null
}

/**
 * Build the REVERSE cross-link map (Plot bed rootId → minting run id) from the Walk
 * index — each run advertises the bed rootIds it minted. Newest run wins on a tie
 * (the index is newest-first). Best-effort: an unreadable runs dir yields an empty
 * map (the bed simply omits its "minted by run" link). Mirrors main.ts loadMintedBy.
 */
async function mintedByMap(worlds: Worlds): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  try {
    const index = await worlds.trace.walk()
    for (const run of index.runs) {
      for (const rootId of run.supersededRoots) {
        if (!m.has(rootId)) m.set(rootId, run.id)
      }
    }
  } catch {
    /* runs dir unreadable → empty map, no fake links */
  }
  return m
}

/**
 * The RenderCtx for a path. `up` = the collection (the Plot index for a bed, the
 * Walk index for a run). `plotPath` is supplied for a WALK run so it can mint
 * rel=related links straight to the Plot beds it wrote (the cross-surface join);
 * `walkRunPath` is the REVERSE — supplied for a Plot bed that a run minted, so the
 * bed advertises rel=related back to that run (face parity with the in-shell
 * "open the Walk" affordance). `minted` is the bed→run map the host pre-computed.
 */
function ctxFor(baseUrl: string, path: string, minted: ReadonlyMap<string, string>): RenderCtx {
  const subjectM = /^\/plot\/([^/]+)$/.exec(path)
  if (subjectM) {
    const rootId = decodeURIComponent(subjectM[1])
    const runId = minted.get(rootId)
    return {
      baseUrl,
      selfPath: path,
      upPath: '/plot',
      walkRunPath: runId ? `/walk/${runId}` : null,
      // The DEEP-LINK twin: a Plot bed (structural lineage) → its Bouquet (the bloom).
      bouquetPath: `/bouquet/${rootId}`,
    }
  }
  // THE BOUQUET — one bed's constellation. Links back to its Plot bed (the structural
  // lineage) + the minting Walk run; up = the Bouquet index.
  const bouquetM = /^\/bouquet\/([^/]+)$/.exec(path)
  if (bouquetM) {
    const rootId = decodeURIComponent(bouquetM[1])
    const runId = minted.get(rootId)
    return {
      baseUrl,
      selfPath: path,
      upPath: '/bouquet',
      plotPath: '/plot',
      walkRunPath: runId ? `/walk/${runId}` : null,
    }
  }
  if (/^\/walk\/[^/]+$/.test(path)) {
    return { baseUrl, selfPath: path, upPath: '/walk', plotPath: '/plot' }
  }
  // THE GREENHOUSE — a knob links back to its index (up) + the Plot bed it governs +
  // the bench:Run that justifies it (the §6 cross-surface joins).
  if (/^\/tune\/[^/]+$/.test(path)) {
    return { baseUrl, selfPath: path, upPath: '/tune', tunePlotPath: '/plot', benchRunPath: '/ledger' }
  }
  return { baseUrl, selfPath: path, upPath: null }
}

export async function handle(req: IncomingMessage, res: ServerResponse, worlds: Worlds): Promise<void> {
  const baseUrl = `http://${req.headers.host ?? 'localhost'}`
  const { path, target, query } = negotiate(req.url ?? '/', req.headers.accept)
  const asof = query.get('asof')
  const turn = turnCursor(query)

  if (path === '/' || path === '') {
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
    res.end(rootIndex(baseUrl))
    return
  }

  const resource = await resolveResource(worlds, path, asof, turn)
  if (!resource) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 — no resource at ${path}\nTry: /plot  /plot/{rootId}  /bouquet  /bouquet/{rootId}  /walk  /walk/{runId}  /tune  /tune/{knob}\n`)
    return
  }

  // The reverse cross-link map (bed → minting run) is needed for any Plot route: a
  // bed advertises rel=related → its run; the Plot index DOM face shows the "minted
  // by run" affordance per bed. Compute it lazily so a /walk read does no extra FS work.
  const minted =
    path === '/plot' ||
    /^\/plot\/[^/]+$/.test(path) ||
    path === '/bouquet' ||
    /^\/bouquet\/[^/]+$/.test(path)
      ? await mintedByMap(worlds)
      : new Map<string, string>()
  const ctx = ctxFor(baseUrl, path, minted)

  // The FAIR Link set is FACE-INVARIANT (the parity invariant): same set for every
  // face. Compute it once from the resource model so the DOM face carries the same
  // RFC 8288 Link header (and Signposting rels) as the curl/turtle/json faces.
  const links = linksFor(resource, target, ctx)
  const linkHeader = toLinkHeader(links)

  // The agent-native heart: ONE resource, two faces, negotiated by Accept.
  //   Accept: text/html (a browser) → the REAL DOM observatory (renderWorkspace +
  //     the lifted <rz-observatory>, Declarative Shadow DOM) — same render path the
  //     browser shell + the smoke use.
  //   everything else (a bare curl, .ttl, .json) → @shrubbery/render's curl faces.
  if (target === 'dom') {
    let html: string | null
    const subjectM = /^\/plot\/([^/]+)$/.exec(path)
    // The Bouquet DOM face IS the rich CONSTELLATION READER (rz-bouquet over the
    // assembled BouquetResource) — the SAME bloom the in-shell drill-down shows, with
    // the full ergonomics. The /plot/{id} bed stays the flat structural twin.
    const bouquetM = /^\/bouquet\/([^/]+)$/.exec(path)
    const runM = /^\/walk\/([^/]+)$/.exec(path)
    const knobM = /^\/tune\/([^/]+)$/.exec(path)
    if (subjectM) html = await renderSubjectHtml(worlds.memory, decodeURIComponent(subjectM[1]), asof)
    else if (bouquetM) html = await renderBouquetHtml(worlds.memory, decodeURIComponent(bouquetM[1]), asof)
    else if (path === '/walk') html = await renderWalkIndexHtml(worlds.trace)
    else if (runM) html = await renderWalkRunHtml(worlds.trace, decodeURIComponent(runM[1]), turn)
    else if (path === '/tune') html = await renderGreenhouseHtml(worlds.greenhouse, asof)
    else if (knobM) html = await renderKnobHtml(worlds.greenhouse, decodeURIComponent(knobM[1]), asof)
    // THE PLOT — pass the graph id so the SSR face detects + plants the merge-ghost
    // banner (the entity-resolution affordance), matching the browser shell's Plot.
    else html = await renderPlotHtml(worlds.memory, asof, minted, worlds.greenhouse.graphId)
    if (html === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`404 — no resource at ${path}\n`)
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', vary: 'Accept', link: linkHeader })
    res.end(html)
    return
  }

  const out = await renderResource(resource, target as Exclude<RenderTarget, 'dom'>, ctx)
  res.writeHead(200, { 'content-type': out.contentType, vary: 'Accept', link: linkHeader })
  res.end(out.body)
}

function rootIndex(baseUrl: string): string {
  return `# Rhizome — the memory observatory (read-only)

A content-negotiating server. THE PLOT is a live gardend cell's \`:projection:memory\`
(the structural lineage; add \`?asof=YYYY-MM-DD\` for the temporal lens). THE BOUQUET is
the READ-side constellation reader — opening a belief blooms its stars (the answer +
why + resolved conflicts + dispositions + entity links + evidence). THE WALK is the
agentic-run traces (JSONL files; add \`?turn=N\` for the turn lens). Bare curl → markdown.

## Navigate

\`\`\`
curl ${baseUrl}/plot                              # the index of subject-beds (now)
curl '${baseUrl}/plot?asof=2023-05-25'            # the index as-of a date (heads recomputed)
curl ${baseUrl}/plot/{rootId}                     # one subject-bed (head + superseded)
curl ${baseUrl}/bouquet                           # the index of readable beliefs (the blooms)
curl ${baseUrl}/bouquet/{rootId}                  # one belief's constellation (the bloom)
curl '${baseUrl}/bouquet/{rootId}?asof=2023-05-25' # the bloom as-of a date (head recomputed)
curl ${baseUrl}/walk                              # the index of agentic-run traces
curl ${baseUrl}/walk/{runId}                      # one run's turn-by-turn walk
curl '${baseUrl}/walk/{runId}?turn=4'             # one run positioned at a turn (the lens)
curl ${baseUrl}/tune                              # THE GREENHOUSE — the cultivation knobs + their live-effect meters
curl ${baseUrl}/tune/supersession-conservatism    # one knob (value + miss-meter + provenance); markdown = the docs
curl '${baseUrl}/tune/supersession-conservatism?asof=2023-05-25'  # the dial as-of a date (the knob-history lens)
curl -H "Accept: text/turtle" ${baseUrl}/bouquet/{rootId}  # the bloom as RDF/Turtle (bq: + mem:)
curl -H "Accept: application/ld+json" ${baseUrl}/bouquet/{rootId}  # the bloom as JSON-LD
curl -H "Accept: text/html" ${baseUrl}/bouquet/{rootId}    # the DOM bloom (the human face)
\`\`\`
`
}

/** Build (but do not start) the server, bound to the live + file worlds. */
export function createRhizomeServer(worlds: Worlds): Server {
  return createServer((req, res) => {
    handle(req, res, worlds).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[rhizome] 500 on ${req.url}:`, err instanceof Error ? err.stack : err)
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`500 — ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })
}

// Auto-listen only when run directly.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const PORT = Number(process.env.PORT ?? 8791)
  const client = new GardenClient()
  const worlds: Worlds = {
    memory: new MemoryWorld(client, GRAPH_ID),
    greenhouse: new GreenhouseWorld(client, GRAPH_ID),
    trace: new TraceWorld(),
  }
  client
    .waitHealthy(15_000)
    .then(() => {
      createRhizomeServer(worlds).listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`rhizome → http://localhost:${PORT}/plot  ·  /walk  (graph ${GRAPH_ID})`)
      })
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`rhizome: cell not reachable — ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    })
}
