// @vitest-environment node
//
// Node env (not happy-dom): this test spawns a REAL gardend cell, execFiles
// the REAL scripts/dump.mts CLI as a child process against it, and drives two
// REAL http.Server instances (a live-source planter server + a fossil-source
// planter server) — the same no-mock discipline as seed-cli.integration.test.ts,
// extended to the anti-W-1a parity claim.

/**
 * static-live-parity.integration.test.ts — U12 acceptance: dump a live seeded
 * graph -> fossil carries the v1 provenance header -> serving the planter
 * server from that fossil yields each face's body bytes EQUAL to the live
 * server's bytes for the same triples, except the capture block (whose
 * content is testimony ABOUT the read — source label, liveness, capture
 * timestamp — not the triples themselves); and a header-stripped fossil is
 * refused with a named error (no timestamp fabrication).
 *
 * Two servers necessarily listen on two different ephemeral ports (there is
 * no way to run both a live-source server and a fossil-source server on one
 * port at the same time), so "byte-equal ... except the capture block" is
 * asserted after substituting each server's own literal base URL for a
 * placeholder — the port is a test-harness artifact, not part of "the same
 * triples" claim the parity test makes. Everything else — title, workspace
 * body, RFC 8288 rel/type link structure, JSON-LD @graph — must match
 * VERBATIM.
 *
 * Live-read acceptance claims are gated on FID-004 (U5, green — commit
 * 1de9062, gardend binary sha256 59cb506c…, 2026-07-11).
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GARDEN_DEFAULT, parseNT, parseTriplesToConfig, uxConfigGraphIri, type WorkspaceConfig } from '@shrubbery/nucleus'
import { parseTurtle } from '@shrubbery/render'
import { createGardendLocalSource, staticNtSource, FossilCodecError } from '@shrubbery/source'
import {
  createGraphAndSeedUxConfig,
  loopbackSeedTarget,
  readFossil,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '@shrubbery/source/node'
import { createPlanterServer } from '../src/server.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const TSX_BIN = resolve(APP_DIR, 'node_modules/.bin/tsx')
const DUMP_SCRIPT = resolve(APP_DIR, 'scripts/dump.mts')
const SEED_BODY: string = readFileSync(require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'), 'utf8')
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

async function listenServer(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

const FACE_PATHS = ['/site.md', '/site.ttl', '/site.json', '/site.html'] as const

/** Replace every literal occurrence of this server's own base URL with a
 *  fixed placeholder — the ephemeral port is a test-harness artifact, never
 *  part of the "same triples" parity claim (both self and alternate/
 *  describedby hrefs, and the html <link> tags built off them, embed it). */
function stripBase(text: string, base: string): string {
  return text.split(base).join('{{BASE}}')
}

/** Strip the dynamic testimony-about-the-read block (capture comment / footer)
 *  out of a rendered face body, leaving everything else (title, workspace
 *  content, link structure) intact for a verbatim comparison. The capture
 *  block differs between the live and fossil servers by construction — source
 *  kind ('gardend-local' vs 'static-nt'), liveness ('poll' vs 'static'), and
 *  the capture timestamp itself — none of which is "the triples". */
function stripCaptureBlock(body: string, target: 'md' | 'ttl' | 'html'): string {
  if (target === 'ttl') {
    // testimonyCaptureComment is exactly two '#' lines, then a blank line,
    // then the turtle body: `${captureComment}\n\n${ttlBody}`.
    const sep = body.indexOf('\n\n')
    return sep === -1 ? body : body.slice(sep + 2)
  }
  // md / html: withFooter appends `\n\n---\n\n${testimonyFooter}\n`. For md
  // that footer runs to the end of the body; for html it is escaped and
  // inlined inside `<pre>...</pre>`, so it ends right before the literal
  // (unescaped, added after esc()) closing `</pre>` tag.
  const marker = '\n\n---\n\n'
  const idx = body.indexOf(marker)
  if (idx === -1) return body
  if (target === 'md') return body.slice(0, idx)
  const endIdx = body.indexOf('</pre>', idx)
  return endIdx === -1 ? body.slice(0, idx) : body.slice(0, idx) + body.slice(endIdx)
}

describe('static-live-parity — dump a live seeded graph, serve the fossil, compare face bytes', () => {
  const GRAPH_ID = 'planter-static-live-parity-it'
  const GRAPH_IRI = uxConfigGraphIri(GRAPH_ID)

  const GARDEN_BIN = resolveGardendBin()

  let cell: GardendCell
  let fossilDir: string
  let fossilPath: string

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(
        `static-live-parity acceptance: gardend binary not found at ${GARDEN_BIN} (set GARDEN_BIN to override). ` +
          'This gate cannot pass silently — no fossil/live parity claim ships unproven.',
      )
    }
    if (!existsSync(TSX_BIN)) {
      throw new Error(`tsx binary not found at ${TSX_BIN} — run pnpm install in apps/planter first.`)
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(loopbackSeedTarget(cell), GRAPH_ID, SEED_BODY, 'Static/Live Parity IT')
    fossilDir = await mkdtemp(join(tmpdir(), 'planter-fossil-'))
    fossilPath = join(fossilDir, 'g1.nt')
  }, 120_000)

  afterAll(async () => {
    if (cell) await cell.kill()
    if (fossilDir) await rm(fossilDir, { recursive: true, force: true })
  })

  it(
    'fossil (dumped by the real dump.mts CLI) serves byte-parity faces vs. the live server, modulo the capture block',
    async () => {
      // ── LIVE server: read the seeded graph LIVE, per request. ────────────
      const liveSource = createGardendLocalSource({
        mcpUrl: cell.mcpUrl,
        token: cell.token,
        origin: 'http://127.0.0.1',
        graphId: GRAPH_ID,
      })
      const liveServer = createPlanterServer({ source: liveSource, graphId: GRAPH_ID })
      const liveBase = await listenServer(liveServer)

      const liveBodies: Record<(typeof FACE_PATHS)[number], string> = {} as never
      let liveReadAt: string | null = null
      try {
        for (const path of FACE_PATHS) {
          const res = await fetch(`${liveBase}${path}`)
          expect(res.status, `live ${path}`).toBe(200)
          expect(res.headers.get('x-shrubbery-triple-count'), `live ${path}`).toBe(String(SEED_TRIPLE_COUNT))
          liveReadAt = res.headers.get('x-shrubbery-read-at')
          liveBodies[path] = await res.text()
        }
      } finally {
        await new Promise<void>((r) => liveServer.close(() => r()))
        await liveSource.close()
      }
      expect(liveReadAt).toBeTruthy()

      // ── DUMP: the REAL dump.mts CLI as a child process (no in-process
      //    shortcut) — the boot-config shape a human would actually run.
      //    endpoint = the loopback base (boot.ts's gardend-local case appends
      //    '/mcp' itself), matching cell.apiUrl. ──────────────────────────
      const { stdout } = await execFileAsync(
        TSX_BIN,
        [
          DUMP_SCRIPT,
          '--graph',
          GRAPH_ID,
          '--endpoint',
          cell.apiUrl,
          '--adapter',
          'gardend-local',
          '--auth-mode',
          'dev',
          '--token',
          cell.token,
          '--out',
          fossilPath,
        ],
        { cwd: APP_DIR, env: process.env },
      )
      expect(stdout).toContain(GRAPH_IRI)
      expect(stdout).toContain(String(SEED_TRIPLE_COUNT))

      // ── The fossil carries the v1 provenance header, and its capturedAt is
      //    a real read.readAt from dump.mts's own source.read() call — never
      //    fabricated at write time (it need not equal the live server's
      //    OWN later read.readAt above; each is a distinct read of the SAME
      //    unchanging graph content, potentially even mid-way through the
      //    faces loop above). ────────────────────────────────────────────
      const fossilFile = await readFossil(fossilPath)
      expect(fossilFile.header.graphIri).toBe(GRAPH_IRI)
      expect(Number.isFinite(fossilFile.header.capturedAt)).toBe(true)
      expect(fossilFile.header.source).toContain('gardend-local')

      // ── FOSSIL server: static-nt source built straight off the dumped
      //    file (its OWN v1 header — no explicit provenance override). ────
      const fossilSource = staticNtSource(fossilFile.text)
      const fossilServer = createPlanterServer({ source: fossilSource, graphId: GRAPH_ID, configGraphIri: GRAPH_IRI })
      const fossilBase = await listenServer(fossilServer)

      const fossilBodies: Record<(typeof FACE_PATHS)[number], string> = {} as never
      let fossilReadAt: string | null = null
      try {
        for (const path of FACE_PATHS) {
          const res = await fetch(`${fossilBase}${path}`)
          expect(res.status, `fossil ${path}`).toBe(200)
          expect(res.headers.get('x-shrubbery-source'), `fossil ${path}`).toBe('static-nt')
          expect(res.headers.get('x-shrubbery-triple-count'), `fossil ${path}`).toBe(String(SEED_TRIPLE_COUNT))
          fossilReadAt = res.headers.get('x-shrubbery-read-at')
          fossilBodies[path] = await res.text()
        }
      } finally {
        await new Promise<void>((r) => fossilServer.close(() => r()))
        await fossilSource.close()
      }

      // ── The fossil-served face's readAt testimony equals the fossil's OWN
      //    capturedAt, EXACTLY — the "no timestamp fabrication" assertion:
      //    a static-nt source's readAt is always capture time, never load
      //    time (nucleus invariant 7 / fossil-source.ts's own contract). ──
      expect(fossilReadAt).toBe(String(fossilFile.header.capturedAt))

      // ── Byte parity: each face's body, once each server's own base URL is
      //    normalized and the dynamic capture block is stripped, is IDENTICAL
      //    between the live-served and fossil-served face for the SAME
      //    triples. ──────────────────────────────────────────────────────
      const normalize = (body: string, base: string, target: 'md' | 'ttl' | 'html'): string =>
        stripCaptureBlock(stripBase(body, base), target)

      const mdLive = normalize(liveBodies['/site.md'], liveBase, 'md')
      const mdFossil = normalize(fossilBodies['/site.md'], fossilBase, 'md')
      expect(mdFossil).toBe(mdLive)
      expect(mdLive).toContain(`# Workspace — ${GARDEN_DEFAULT.label}`)

      const ttlLive = normalize(liveBodies['/site.ttl'], liveBase, 'ttl')
      const ttlFossil = normalize(fossilBodies['/site.ttl'], fossilBase, 'ttl')
      expect(ttlFossil).toBe(ttlLive)
      // and the stripped turtle body still round-trips to the exact seeded config
      expect(parseTriplesToConfig(parseTurtle(ttlLive))).toEqual(GARDEN_DEFAULT)
      const config: WorkspaceConfig = parseTriplesToConfig(parseTurtle(ttlFossil))
      expect(config).toEqual(GARDEN_DEFAULT)

      const jsonLive = stripBase(liveBodies['/site.json'], liveBase)
      const jsonFossil = stripBase(fossilBodies['/site.json'], fossilBase)
      expect(jsonFossil).toBe(jsonLive)
      const parsedJson = JSON.parse(jsonFossil) as { '@graph': ReadonlyArray<Record<string, unknown>> }
      const workspaceNode = parsedJson['@graph'].find((n) => n['@type'] === 'sux:Workspace')
      expect(workspaceNode?.label).toBe(GARDEN_DEFAULT.label)

      const htmlLive = normalize(liveBodies['/site.html'], liveBase, 'html')
      const htmlFossil = normalize(fossilBodies['/site.html'], fossilBase, 'html')
      expect(htmlFossil).toBe(htmlLive)
      expect(htmlLive).toContain(`<title>Workspace — ${GARDEN_DEFAULT.label}</title>`)
    },
    120_000,
  )

  it('a header-stripped fossil is refused with a named error (no timestamp fabrication)', async () => {
    const fossilFile = await readFossil(fossilPath)
    // Strip every leading '#' line (the v1 magic + provenance header),
    // leaving a plain, valid .nt body with NO capture provenance at all.
    const strippedBody = fossilFile.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .replace(/^\n+/, '')
    expect(strippedBody).not.toContain('shrubbery fossil')

    const strippedPath = join(fossilDir, 'g1.header-stripped.nt')
    await writeFile(strippedPath, strippedBody, 'utf8')

    // readFossil refuses a header-stripped file outright (FossilCodecError).
    await expect(readFossil(strippedPath)).rejects.toThrow(FossilCodecError)
    await expect(readFossil(strippedPath)).rejects.toThrow(/carries no/)

    // staticNtSource likewise refuses construction from the stripped body
    // directly (no fossil v1 header, no explicit provenance) rather than
    // fabricating a capturedAt from load time.
    expect(() => staticNtSource(strippedBody)).toThrow(/refusing construction without capture provenance/)

    // dump.mts writes THROUGH writeFossil, which stamps the read's own
    // readAt as capturedAt — it structurally cannot produce a fossil
    // lacking provenance; the read path stays honest by construction. This
    // is asserted here as documentation of *why* readFossil's refusal above
    // is the only way a header-stripped body can arise (hand-editing /
    // truncating a fossil file after the fact), never dump.mts's own output.
    const legitimate = await readFossil(fossilPath)
    expect(legitimate.header.graphIri).toBe(GRAPH_IRI)
  })
})
