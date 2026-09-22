// @vitest-environment node
//
// Node env (not happy-dom): this test spawns a REAL gardend cell, execFiles
// the REAL scripts/seed.mts CLI as a child process, and drives a REAL
// http.Server against it — the apps/rhizome/conneg precedent, extended to
// exercise a CLI as an actual subprocess (no in-process shortcut: the CLI's
// own argv parsing, manifest discovery, and exit code all run for real).

/**
 * seed-cli.integration.test.ts — U12 acceptance: the seed CLI drives a fresh
 * spawned gardend graph from EMPTY faces to the rendered site on all four
 * faces after the real create_graph + rdf_load path (server observes
 * empty -> ready).
 *
 * The graph is pre-created EMPTY via a plain `create_graph` MCP call (NOT
 * through the CLI) so the BEFORE state is a genuine, server-observable EMPTY
 * (200, Triple-Count 0) — not merely "graph doesn't exist yet" (a different,
 * `not-found`-shaped condition, proven separately below). The CLI is then
 * invoked with `--no-create` (seedGraphFromNtFile: rdf_load only, the graph
 * already exists) as a REAL child process against the cell's
 * manifest-discovered loopback — proving the actual
 * `pnpm --dir apps/planter seed -- --profile-dir ...` path a human would run,
 * not a re-import of its internals.
 *
 * A second test below proves the OTHER seed mode over a genuinely fresh
 * graph_id — the CLI invoked WITHOUT `--no-create`, exercising
 * `createGraphAndSeedUxConfig` (the real `create_graph` THEN `rdf_load`
 * pair) end to end, BEFORE/AFTER across the same four faces.
 *
 * Live-read acceptance claims are gated on FID-004 (U5, green — commit
 * 1de9062, gardend binary sha256 59cb506c…, 2026-07-11).
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GARDEN_DEFAULT, parseNT, parseTriplesToConfig, uxConfigGraphIri, type WorkspaceConfig } from '@shrubbery/nucleus'
import { parseTurtle } from '@shrubbery/render'
import { createGardendLocalSource, McpClient } from '@shrubbery/source'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { createPlanterServer } from '../src/server.js'

const execFileAsync = promisify(execFile)
const require_ = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const TSX_BIN = resolve(APP_DIR, 'node_modules/.bin/tsx')
const SEED_SCRIPT = resolve(APP_DIR, 'scripts/seed.mts')
const SEED_TRIPLE_COUNT = parseNT(
  readFileSync(require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'), 'utf8'),
).length

async function listenServer(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

const FACE_PATHS = ['/site.md', '/site.ttl', '/site.json', '/site.html'] as const

const GARDEN_BIN = resolveGardendBin()

// This suite is U12's ONLY acceptance proof for the live seed CLI path —
// there is no static-fixture fallback to fall back on (unlike U9's
// planter-faces suite, which proves the fossil-source face contract
// unconditionally in PART 1 before ever touching a live cell). Skipping this
// describe block when the binary is absent would convert the required
// acceptance into a silent pass. Per the FID-004 gate precedent
// (packages/source/tests/fid004-convergence.probe.test.ts): FAIL LOUDLY
// instead — a real `describe`, with a hard beforeAll throw.
describe('seed.mts CLI — real create_graph + rdf_load drives EMPTY -> ready across all four faces', () => {
  const GRAPH_ID = 'planter-seed-cli-it'
  const GRAPH_IRI = uxConfigGraphIri(GRAPH_ID)

  let cell: GardendCell

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(
        `seed-cli acceptance: gardend binary not found at ${GARDEN_BIN} (set GARDEN_BIN to override). ` +
          'This gate cannot pass silently — no live seed-CLI claim ships unproven.',
      )
    }
    if (!existsSync(TSX_BIN)) {
      throw new Error(`tsx binary not found at ${TSX_BIN} — run pnpm install in apps/planter first.`)
    }
    cell = await spawnGardend()
    // Pre-create the graph EMPTY via a plain MCP call — NOT through the CLI —
    // so the BEFORE observation is a genuine classified EMPTY, not not-found.
    const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Seed CLI IT' })
  }, 120_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it(
    'EMPTY before seeding; the real seed.mts CLI (--no-create) drives it to ready on every face',
    async () => {
      const source = createGardendLocalSource({
        mcpUrl: cell.mcpUrl,
        token: cell.token,
        origin: 'http://127.0.0.1',
        graphId: GRAPH_ID,
      })
      const server = createPlanterServer({ source, graphId: GRAPH_ID })
      const base = await listenServer(server)
      try {
        // ── BEFORE: every face is explicit 200 EMPTY, Triple-Count 0. ────────
        for (const path of FACE_PATHS) {
          const res = await fetch(`${base}${path}`)
          expect(res.status, `${path} pre-seed`).toBe(200)
          expect(res.headers.get('x-shrubbery-triple-count'), `${path} pre-seed`).toBe('0')
        }

        // ── Run the REAL seed CLI as a child process (no mock, no in-process
        //    shortcut): manifest discovery against this cell's own profile. ──
        const { stdout } = await execFileAsync(
          TSX_BIN,
          [SEED_SCRIPT, '--graph', GRAPH_ID, '--profile-dir', cell.profileDir, '--no-create'],
          { cwd: APP_DIR, env: process.env },
        )
        expect(stdout).toContain(GRAPH_IRI)
        expect(stdout).toContain(String(SEED_TRIPLE_COUNT))

        // ── AFTER: all four faces render the real site, parsing to
        //    GARDEN_DEFAULT — the server observed empty -> ready live. ───────
        for (const path of FACE_PATHS) {
          const res = await fetch(`${base}${path}`)
          expect(res.status, `${path} post-seed`).toBe(200)
          expect(res.headers.get('x-shrubbery-triple-count'), `${path} post-seed`).toBe(String(SEED_TRIPLE_COUNT))
        }

        // ── /site.ttl: the RDF face round-trips to the exact seeded config. ──
        const ttl = await (await fetch(`${base}/site.ttl`)).text()
        expect(ttl).toContain('read live from')
        expect(ttl).toContain(`${SEED_TRIPLE_COUNT} triples in <${GRAPH_IRI}>`)
        const config: WorkspaceConfig = parseTriplesToConfig(parseTurtle(ttl))
        expect(config).toEqual(GARDEN_DEFAULT)

        // ── /site.md: the rendered workspace title + testimony footer, not
        //    merely the headers/count. ────────────────────────────────────
        const md = await (await fetch(`${base}/site.md`)).text()
        expect(md).toContain(`# Workspace — ${GARDEN_DEFAULT.label}`)
        expect(md).toContain('read live from')
        expect(md).toContain(`${SEED_TRIPLE_COUNT} triples in <${GRAPH_IRI}>`)

        // ── /site.json: compacted JSON-LD body — the actual seeded config
        //    surfaces under its real term names (in `@graph`, since a
        //    workspace compacts to many root subjects), not just a count. ──
        const json = (await (await fetch(`${base}/site.json`)).json()) as {
          '@context': unknown
          '@graph': ReadonlyArray<Record<string, unknown>>
          _links: unknown
        }
        expect(json['@context']).toBeDefined()
        expect(Array.isArray(json._links)).toBe(true)
        const workspaceNode = json['@graph'].find((n) => n['@type'] === 'sux:Workspace')
        expect(workspaceNode).toBeDefined()
        expect(workspaceNode?.label).toBe(GARDEN_DEFAULT.label)

        // ── /site.html: the dom-face floor — real doctype/shell, a
        //    describedby <link>, and the SAME rendered markdown inlined. ──
        const html = await (await fetch(`${base}/site.html`)).text()
        expect(html).toContain('<!doctype html>')
        expect(html).toContain(`<title>Workspace — ${GARDEN_DEFAULT.label}</title>`)
        expect(html).toContain('<link rel="describedby"')
        expect(html).toContain('read live from')
        // The footer is inlined inside an escaped <pre> (html-shell.ts esc()),
        // so '<'/'>' around the graph IRI come through as &lt;/&gt;.
        expect(html).toContain(`${SEED_TRIPLE_COUNT} triples in &lt;${GRAPH_IRI}&gt;`)
      } finally {
        await new Promise<void>((r) => server.close(() => r()))
        await source.close()
      }
    },
    120_000,
  )

  it(
    'a genuinely fresh graph (never create_graph-d) is driven by the real ' +
      'createGraphAndSeedUxConfig path — the CLI WITHOUT --no-create',
    async () => {
      // A graph_id this suite has never called create_graph on — distinct
      // from GRAPH_ID (pre-created EMPTY above). Same live cell, same gate.
      const FRESH_GRAPH_ID = 'planter-seed-cli-fresh-create'
      const FRESH_GRAPH_IRI = uxConfigGraphIri(FRESH_GRAPH_ID)

      const source = createGardendLocalSource({
        mcpUrl: cell.mcpUrl,
        token: cell.token,
        origin: 'http://127.0.0.1',
        graphId: FRESH_GRAPH_ID,
      })
      const server = createPlanterServer({ source, graphId: FRESH_GRAPH_ID })
      const base = await listenServer(server)
      try {
        // ── BEFORE: the graph_id has never been create_graph-d. gardend's
        //    rdf_dump answers a JSON-RPC tool error ("graph not found: …"),
        //    not an HTTP 404 — this adapter classifies that 'protocol' ->
        //    'unavailable' (503), a REAL, server-observable non-200 that is
        //    honestly distinct from the 200/EMPTY proven in the test above.
        //    The store's own verbatim message rides through to the body. ──
        const before = await fetch(`${base}/site.md`)
        expect(before.status, 'pre-create').toBe(503)
        const beforeBody = await before.text()
        expect(beforeBody).toContain('graph not found')

        // ── Run the REAL seed CLI, as an actual child process, WITHOUT
        //    --no-create: this exercises createGraphAndSeedUxConfig
        //    (create_graph THEN rdf_load) — the branch the acceptance test
        //    above never touches. ──────────────────────────────────────────
        const { stdout } = await execFileAsync(
          TSX_BIN,
          [SEED_SCRIPT, '--graph', FRESH_GRAPH_ID, '--profile-dir', cell.profileDir],
          { cwd: APP_DIR, env: process.env },
        )
        expect(stdout).toContain('created graph')
        expect(stdout).toContain(FRESH_GRAPH_IRI)

        // ── AFTER: the server observes not-found -> ready live, on every
        //    face, seeded via the real create_graph + rdf_load pair. ───────
        for (const path of FACE_PATHS) {
          const res = await fetch(`${base}${path}`)
          expect(res.status, `${path} post-create-seed`).toBe(200)
          expect(res.headers.get('x-shrubbery-triple-count'), `${path} post-create-seed`).toBe(String(SEED_TRIPLE_COUNT))
        }

        const ttl = await (await fetch(`${base}/site.ttl`)).text()
        const config: WorkspaceConfig = parseTriplesToConfig(parseTurtle(ttl))
        expect(config).toEqual(GARDEN_DEFAULT)
      } finally {
        await new Promise<void>((r) => server.close(() => r()))
        await source.close()
      }
    },
    120_000,
  )

  it('the CLI refuses (non-zero exit, named error) when neither --profile-dir nor --endpoint resolves', async () => {
    const env = { ...process.env }
    delete env.GARDEN_PROFILE_DIR
    await expect(
      execFileAsync(TSX_BIN, [SEED_SCRIPT, '--graph', 'whatever'], { cwd: APP_DIR, env }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('no target resolvable'),
    })
  })

  it('HIGH-3: the CLI refuses AMBIGUITY (non-zero exit, naming BOTH flags) when --endpoint AND --profile-dir are both given', async () => {
    await expect(
      execFileAsync(
        TSX_BIN,
        [
          SEED_SCRIPT,
          '--graph',
          'whatever',
          '--endpoint',
          'http://127.0.0.1:7090',
          '--auth-mode',
          'dev',
          '--token',
          'tok',
          '--profile-dir',
          cell.profileDir,
        ],
        { cwd: APP_DIR, env: process.env },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/--endpoint.*--profile-dir|--profile-dir.*--endpoint/s),
    })
  })
})
