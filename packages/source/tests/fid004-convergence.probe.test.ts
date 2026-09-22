/**
 * fid004-convergence.probe.test.ts — THE WF-D LIVE-READ GATE (FID-004, R10).
 *
 * TEMPLATE: commit 2ce2357 ("test(organism): prove cold projection across
 * restart", apps/organism/scripts/fid004-cold-projection-browser.mts) — this
 * probe is that script's convergence core re-expressed as the planter gate:
 * the retained-profile restart mechanics (SIGTERM without profile removal,
 * token-matched manifest wait on respawn) are taken from it verbatim in
 * spirit; the browser/Vite tiers stay in the organism where they live.
 *
 * THE GATE (design §3.4, D11): no live-read claim in any doc, face, census
 * note, or test name ships before this probe is green in this environment.
 * Both host units (U9 planter-server, U11 planter SPA) carry a structural
 * depends_on edge to this file. If it is red: escalate as a garden-side memo;
 * host acceptance re-scopes to the fossil adapter, honestly labeled.
 *
 * WHAT IT PROVES, against the REAL current gardend binary (NO MOCKS):
 *   1. spawn gardend on a PERSISTENT temp profile (managed here — never the
 *      auto-disposed spawnGardend profile);
 *   2. write :ux:config triples through one authority via BOTH real write
 *      variants: rdf_load (the seed path) AND sparql_update INSERT DATA with
 *      a literal GRAPH target (the admitted grow form — never variable
 *      GRAPH, never CLEAR/DROP);
 *   3. read back COLD — a fresh McpClient/TripleSource per read, never the
 *      writer's connection — via BOTH read paths: sparql_query (select) AND
 *      rdf_dump (read), asserting count parity AND term-for-term
 *      parse-equality with the written body;
 *   4. SIGTERM the cell WITHOUT removing the profile → respawn on the SAME
 *      profile (fresh token proves it is a real second process) → re-read
 *      both variants via both paths → the same count + term-for-term parity.
 *
 * Term-for-term = canonical N-Triples lines (sorted by compareTriples,
 * rendered by termToNT) of the parsed read equal those of the written
 * triples — parse-equal, not byte-equal, so store-side reordering is
 * admitted and term drift is not.
 *
 * This suite REQUIRES the real binary (no-mock rule): if gardend cannot be
 * found it FAILS LOUDLY rather than faking a cell — a silently-skipped gate
 * would let live-read claims ship unproven.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  I,
  L,
  Lint,
  compareTriples,
  parseNT,
  termToNT,
  triplesToNT,
  uxConfigGraphIri,
  type SourceTerm,
  type Term,
  type Triple,
  type TripleSource,
} from '@shrubbery/nucleus'
import { McpClient, createGardendLocalSource } from '../src/index.js'
import {
  createGraphAndSeedUxConfig,
  loopbackSeedTarget,
  readLoopbackManifest,
  resolveGardendBin,
  type LoopbackManifest,
} from '../src/node/index.js'

const GARDEN_BIN = resolveGardendBin()

// ── The two write variants, each on its own graph of the same cell ──────────

const LOAD_GRAPH = 'fid004-load'
const UPDATE_GRAPH = 'fid004-update'
const LOAD_IRI = uxConfigGraphIri(LOAD_GRAPH)
const UPDATE_IRI = uxConfigGraphIri(UPDATE_GRAPH)

/** The written body: one IRI object, one plain literal, one typed integer,
 *  one literal exercising the escape path (quote + newline) — the term
 *  shapes this codebase's N-Triples subset emits. */
function probeTriples(graphIri: string, variant: string, answer: number): Triple[] {
  const s = `${graphIri}:probe`
  return [
    { s, p: 'urn:mnemosyne:vocab:sux:kind', o: I(`${graphIri}:probe:target`) },
    { s, p: 'urn:mnemosyne:vocab:sux:label', o: L(`fid004 ${variant} plain literal`) },
    { s, p: 'urn:mnemosyne:vocab:sux:answer', o: Lint(answer) },
    { s, p: 'urn:mnemosyne:vocab:sux:note', o: L(`she said "convergence"\nacross restart`) },
  ]
}

const LOAD_TRIPLES = probeTriples(LOAD_IRI, 'rdf_load', 42)
const UPDATE_TRIPLES = probeTriples(UPDATE_IRI, 'sparql_update', 7)

/** Canonical N-Triples lines: sorted, rendered — the parse-equality key. */
function canonicalLines(triples: readonly Triple[]): string[] {
  return [...triples]
    .sort(compareTriples)
    .map(t => `<${t.s}> <${t.p}> ${termToNT(t.o)} .`)
}

const LOAD_CANON = canonicalLines(LOAD_TRIPLES)
const UPDATE_CANON = canonicalLines(UPDATE_TRIPLES)

/** A SELECT binding term back to a nucleus Term (bnodes would be a store
 *  surprise — none are written, none may come back). */
function sourceTermToTerm(t: SourceTerm, at: string): Term {
  if (t.type === 'bnode') throw new Error(`unexpected bnode in ${at}: _:${t.value}`)
  return t
}

// ── Persistent-profile spawn/stop (template 2ce2357 mechanics) ───────────────

interface ProbeCell {
  readonly child: ChildProcess
  readonly pid: number
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
  /** SIGTERM and wait for exit. NEVER removes the profile — that persistence
   *  is the entire point of the probe. */
  stop(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Start gardend generation N on the RETAINED profile. The profile still holds
 * the previous generation's loopback.json, so readiness waits for the
 * manifest carrying THIS generation's token (the template's rotation guard)
 * plus a 2xx /health.
 */
async function startGardendOnProfile(profileDir: string, generation: number): Promise<ProbeCell> {
  const token = `fid004-gen${generation}-${randomUUID().replace(/-/g, '')}`
  const child = spawn(GARDEN_BIN, [], {
    // cwd inside the profile: fastembed's .fastembed_cache lands in the
    // disposable profile, never the source tree (the U4 spawn-gardend fix).
    cwd: profileDir,
    env: {
      ...process.env,
      GARDEN_PROFILE_DIR: profileDir,
      GARDEN_LOOPBACK_HOST: '127.0.0.1',
      GARDEN_LOOPBACK_PORT: '0',
      GARDEN_LOOPBACK_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  const exitState: { info: { code: number | null; signal: NodeJS.Signals | null } | null } = {
    info: null,
  }
  child.on('exit', (code, signal) => {
    exitState.info = { code, signal }
  })

  const manifestPath = join(profileDir, 'loopback.json')
  const deadline = Date.now() + 30_000
  let manifest: LoopbackManifest | null = null
  while (Date.now() < deadline) {
    if (exitState.info) {
      throw new Error(
        `gardend generation ${generation} exited before readiness ` +
          `(code=${exitState.info.code} signal=${exitState.info.signal}). stderr:\n${stderr.slice(-2000)}`,
      )
    }
    if (existsSync(manifestPath)) {
      try {
        const candidate = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoopbackManifest
        // Only THIS generation's manifest counts — the retained profile still
        // holds the previous generation's file until the new cell rewrites it.
        if (candidate.token === token && candidate.apiUrl && candidate.mcpUrl) {
          const healthy = await fetch(
            `${candidate.apiUrl.replace(/\/$/, '')}/health`,
          ).catch(() => null)
          if (healthy?.ok) {
            manifest = candidate
            break
          }
        }
      } catch {
        // manifest mid-write — tolerate a partially observed file and re-poll
      }
    }
    await sleep(150)
  }
  if (!manifest) {
    child.kill('SIGKILL')
    throw new Error(
      `gardend generation ${generation} did not become healthy within 30s on retained profile ` +
        `${profileDir}. stderr:\n${stderr.slice(-2000)}`,
    )
  }

  return {
    child,
    pid: child.pid!,
    apiUrl: manifest.apiUrl.replace(/\/$/, ''),
    mcpUrl: manifest.mcpUrl,
    token: manifest.token,
    async stop(): Promise<void> {
      if (exitState.info) return
      child.kill('SIGTERM')
      const stopDeadline = Date.now() + 10_000
      while (!exitState.info && Date.now() < stopDeadline) await sleep(100)
      if (!exitState.info) {
        child.kill('SIGKILL')
        throw new Error(`gardend generation ${generation} (pid ${child.pid}) ignored SIGTERM`)
      }
    },
  }
}

// ── The both-paths read assertion (one authority in, two faces out) ─────────

/** COLD read: a FRESH TripleSource per call — never the writer's client. */
function coldSource(cell: ProbeCell, graphId: string): TripleSource {
  return createGardendLocalSource({
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    origin: 'http://127.0.0.1',
    graphId,
  })
}

/**
 * Assert one graph serves the written triples on BOTH read paths:
 *   rdf_dump (source.read)     — count + canonical parse-equality, on both
 *                                the native nt body and the parsed carrier;
 *   sparql_query (source.select) — row-reconstructed triples canonically
 *                                equal, plus the COUNT(*) cross-check.
 */
async function expectBothPathsServe(
  cell: ProbeCell,
  graphId: string,
  graphIri: string,
  expectedCanon: readonly string[],
): Promise<void> {
  const source = coldSource(cell, graphId)
  try {
    // Path 1: rdf_dump.
    const read = await source.read(graphIri)
    expect(read.graphIri).toBe(graphIri)
    expect(read.tripleCount).toBe(expectedCanon.length)
    expect(canonicalLines(read.triples!)).toEqual(expectedCanon)
    // The native nt carrier agrees term-for-term too.
    expect(canonicalLines(parseNT(read.nt!))).toEqual(expectedCanon)

    // Path 2: sparql_query — the triples face.
    const sel = await source.select!(
      `SELECT ?s ?p ?o WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
    )
    expect(sel.rows.length).toBe(expectedCanon.length)
    const fromRows: Triple[] = sel.rows.map((row, i) => {
      const s = sourceTermToTerm(row.s, `row ${i} ?s`)
      const p = sourceTermToTerm(row.p, `row ${i} ?p`)
      if (s.type !== 'iri' || p.type !== 'iri') {
        throw new Error(`row ${i}: non-IRI subject/predicate from <${graphIri}>`)
      }
      return { s: s.value, p: p.value, o: sourceTermToTerm(row.o, `row ${i} ?o`) }
    })
    expect(canonicalLines(fromRows)).toEqual(expectedCanon)

    // Path 2b: sparql_query COUNT cross-check (never an envelope counter).
    const count = await source.select!(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
    )
    const n = count.rows[0]?.n
    expect(n).toBeDefined()
    expect(Number(/(\d+)/.exec(n!.value)?.[1])).toBe(expectedCanon.length)
  } finally {
    await source.close()
  }
}

// ── The probe ────────────────────────────────────────────────────────────────

let profileDir: string
let gen1: ProbeCell | undefined
let gen2: ProbeCell | undefined

beforeAll(() => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `FID-004 gate: gardend binary not found at ${GARDEN_BIN} (set GARDEN_BIN to override). ` +
        'The gate cannot pass silently — no live-read claim ships unproven.',
    )
  }
  // PERSISTENT profile, owned by this suite (not spawnGardend's auto-disposed
  // one): it must survive the SIGTERM so generation 2 can hydrate from it.
  profileDir = mkdtempSync(join(tmpdir(), 'fid004-planter.'))
})

afterAll(async () => {
  // Best-effort teardown of whichever generations are still alive, THEN the
  // retained profile (only now may it die).
  for (const cell of [gen1, gen2]) {
    if (!cell) continue
    try {
      await cell.stop()
    } catch {
      /* already exited or SIGKILLed by stop() */
    }
  }
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
}, 30_000)

describe('FID-004 convergence probe — the WF-D live-read gate (template 2ce2357)', () => {
  it(
    'generation 1: rdf_load AND sparql_update writes to :ux:config are served COLD, term-for-term, via BOTH read paths',
    async () => {
      gen1 = await startGardendOnProfile(profileDir, 1)

      // ── WRITE VARIANT A: rdf_load (the seed path, U4's helper as-is). ──────
      await createGraphAndSeedUxConfig(
        loopbackSeedTarget(gen1),
        LOAD_GRAPH,
        triplesToNT(LOAD_TRIPLES) + '\n',
        'FID-004 rdf_load variant',
      )

      // ── WRITE VARIANT B: sparql_update INSERT DATA with a LITERAL GRAPH ────
      // target (the admitted grow form — rdf_authority rejects variable
      // GRAPH/WITH and :projection:* targets; :ux:config is user-writable).
      const writer = new McpClient({
        mcpUrl: gen1.mcpUrl,
        token: gen1.token,
        origin: 'http://127.0.0.1',
      })
      await writer.toolsCall('create_graph', {
        graph_id: UPDATE_GRAPH,
        title: 'FID-004 sparql_update variant',
      })
      await writer.toolsCall('sparql_update', {
        graphId: UPDATE_GRAPH,
        update: `INSERT DATA { GRAPH <${UPDATE_IRI}> {\n${triplesToNT(UPDATE_TRIPLES)}\n} }`,
      })

      // ── COLD READS: fresh sources (never the writer's client), both paths.──
      await expectBothPathsServe(gen1, LOAD_GRAPH, LOAD_IRI, LOAD_CANON)
      await expectBothPathsServe(gen1, UPDATE_GRAPH, UPDATE_IRI, UPDATE_CANON)
    },
    180_000,
  )

  it(
    'generation 2: SIGTERM → respawn on the SAME profile → both variants still served term-for-term via BOTH paths',
    async () => {
      expect(gen1).toBeDefined() // structural: phase 2 is meaningless without phase 1

      // SIGTERM without profile removal — the retained manifest proves the
      // profile survived the process.
      await gen1!.stop()
      const retained = readLoopbackManifest(profileDir)
      expect(retained.token).toBe(gen1!.token)

      gen2 = await startGardendOnProfile(profileDir, 2)
      // A real second process, not a lingering first one.
      expect(gen2.token).not.toBe(gen1!.token)
      expect(gen2.pid).not.toBe(gen1!.pid)

      // ── THE CONVERGENCE CLAIM: the writes hydrate from the profile and are
      //    served by a process that never saw them written. ──────────────────
      await expectBothPathsServe(gen2, LOAD_GRAPH, LOAD_IRI, LOAD_CANON)
      await expectBothPathsServe(gen2, UPDATE_GRAPH, UPDATE_IRI, UPDATE_CANON)

      await gen2.stop()
    },
    180_000,
  )
})
