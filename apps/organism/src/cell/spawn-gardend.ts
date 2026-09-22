/**
 * spawn-gardend.ts — NODE-ONLY helper that stands up a REAL headless gardend
 * cell with a fresh temp profile and tears it down cleanly.
 *
 * This is SHELL-SIDE infrastructure (apps/organism), used by:
 *   - the real integration test (apps/organism/tests/*.integration.test.ts)
 *   - the `gardend:dev` script (spawns + seeds a cell for the live organism)
 *
 * It is NOT imported by any browser bundle (it uses node:child_process / node:fs)
 * and NOT part of the shrubbery library. It encodes the PROVEN recipe verbatim
 * (see apps/organism/scripts/probe-gardend-liveread.sh): env-only config, fresh
 * mktemp profile per run, read loopback.json (camelCase apiUrl/mcpUrl/token/port),
 * poll /health, create_graph (snake_case), seed via rdf_load(targetGraphIri).
 *
 * NO MOCKS: this spawns the real binary. If the binary is missing, callers get a
 * clear error (the test/script must skip-or-fail honestly, never fake the cell).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { uxConfigGraphIri } from '@shrubbery/nucleus'

// The CURRENT (Jun-19) release build serves the /emporium vocab-catalogue routes;
// the debug build is STALE (Jun-12, predates them). Per Vera's iter-4a directive,
// ALL cells (gardend:dev + integration tests) spawn the release example binary.
// GARDEN_BIN env var still overrides.
//
// Default discovery walks a small list of well-known candidates so contributors
// don't have to set GARDEN_BIN: first the sibling-repo checkout (the standard
// GitHub layout where shrubbery/ and garden/ live side-by-side), then Vera's
// local sophia dev tree, kept for her own machine. The first existing
// candidate wins; if none exist, the first candidate is returned so the error
// message points at the most-likely-correct location for a fresh contributor.
const HERE = dirname(fileURLToPath(import.meta.url))

const DEFAULT_BIN_CANDIDATES: readonly string[] = [
  // Sibling-repo checkout: shrubbery/apps/organism/src/cell/ → ../../../../../garden/...
  resolve(HERE, '../../../../../garden/src-tauri/target/release/examples/gardend'),
  // Vera's local sophia dev tree
  '/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend',
]

function findDefaultBin(): string {
  for (const candidate of DEFAULT_BIN_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return DEFAULT_BIN_CANDIDATES[0]
}

/** loopback.json manifest gardend writes into its profile dir (camelCase keys). */
export interface LoopbackManifest {
  port: number
  apiUrl: string
  mcpUrl: string
  token: string
  [k: string]: unknown
}

/** A spawned cell handle. */
export interface GardendCell {
  readonly pid: number
  readonly profileDir: string
  readonly manifest: LoopbackManifest
  /** apiUrl/mcpUrl/token, ready for a LoopbackTransport (Node, origin=127.0.0.1). */
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
  /** SIGTERM the cell and remove the temp profile. Idempotent. */
  kill(): Promise<void>
}

export interface SpawnOptions {
  /** Override the gardend binary; default = GARDEN_BIN env or the proven debug build. */
  bin?: string
  /** Max ms to wait for loopback.json + /health (default 20000). */
  readyTimeoutMs?: number
  /**
   * Extra env vars for the spawned process, merged in AFTER the fixed
   * loopback/profile overrides below (so a caller-supplied key wins over
   * this function's own defaults, but never silently loses the fresh
   * per-run profile/token/port wiring). Used by callers that need a
   * cell-specific activation gate — e.g. the observatory boot-hook's
   * `GARDEN_CELL_GRAPH_ID`/`GARDEN_OBSERVATORY_BUNDLE_DIR`/
   * `GARDEN_SELF_HEAL_GRAPHS` (see `observatory-dashboard-gardend-browser.mts`) —
   * without every other `spawnGardend` caller needing to know those names.
   */
  env?: Readonly<Record<string, string>>
  /**
   * Reuse an existing profile directory instead of a fresh `mkdtemp`one —
   * for a caller that needs a SECOND boot of the SAME on-disk graph state
   * (e.g. create a graph for real via one boot's normal MCP `create_graph`
   * path, then reboot pointed at the same profile so a later boot-hook's
   * `existing_graph_dir` finds it — see
   * `observatory-dashboard-gardend-browser.mts`'s own two-phase spawn for
   * why self-heal alone cannot always be assumed). The directory is created
   * if missing; any STALE `loopback.json` already inside it (a prior boot's
   * manifest) is removed before spawn so the readiness wait below cannot
   * read a dead process's coordinates. Unlike the default fresh-mkdtemp
   * profile, a caller-supplied `profileDir` is NEVER deleted by `kill()` —
   * the caller owns its lifecycle.
   */
  profileDir?: string
}

/** Resolve the gardend binary path: explicit > GARDEN_BIN env > discovered default. */
export function resolveGardendBin(opts?: SpawnOptions): string {
  return opts?.bin ?? process.env.GARDEN_BIN ?? findDefaultBin()
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Spawn a real gardend with a fresh temp profile and wait until it is ready
 * (loopback.json exists AND /health is 2xx). Throws on missing binary, early
 * exit, or timeout — never returns a half-ready cell.
 */
export async function spawnGardend(opts?: SpawnOptions): Promise<GardendCell> {
  const bin = resolveGardendBin(opts)
  if (!existsSync(bin)) {
    throw new Error(`spawnGardend: gardend binary not found at ${bin} (set GARDEN_BIN to override)`)
  }
  const readyTimeoutMs = opts?.readyTimeoutMs ?? 20000

  // FRESH temp profile per run by default (stale rocksdb lock ⇒ spawn
  // fails) — unless the caller explicitly wants to reuse one (see
  // `SpawnOptions.profileDir`'s own doc).
  const reusedProfileDir = opts?.profileDir != null
  const profileDir = opts?.profileDir ?? mkdtempSync(join(tmpdir(), 'gardend-organism.'))
  if (reusedProfileDir) {
    mkdirSync(profileDir, { recursive: true })
    // A prior boot's manifest, if any — remove it so the readiness wait
    // below cannot observe a dead process's stale apiUrl/mcpUrl/token.
    try {
      rmSync(join(profileDir, 'loopback.json'), { force: true })
    } catch {
      /* best effort */
    }
  }
  const token = `organism-${randomUUID().replace(/-/g, '')}`

  // gardend takes NO CLI args — configured purely by env vars.
  // Keep its process-relative caches and any other incidental files inside the
  // disposable profile as well. In particular, fastembed defaults to a
  // `.fastembed_cache` directory under the child cwd; inheriting the package
  // cwd would dirty the source tree even though Garden's graph state is fresh.
  const child: ChildProcess = spawn(bin, [], {
    cwd: profileDir,
    env: {
      ...process.env,
      GARDEN_PROFILE_DIR: profileDir,
      GARDEN_LOOPBACK_HOST: '127.0.0.1',
      GARDEN_LOOPBACK_PORT: '0', // OS-assigned random port
      GARDEN_LOOPBACK_TOKEN: token,
      ...(opts?.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
    if (process.env.SHRUBBERY_GARDEND_LOGS === '1') process.stderr.write(d)
  })
  child.stdout?.on('data', (d: Buffer) => {
    if (process.env.SHRUBBERY_GARDEND_LOGS === '1') process.stdout.write(d)
  })
  // A mutable holder so TS keeps the union type after the exit callback mutates
  // it (a bare `let exited = null` gets narrowed to `never` inside sync loops).
  const exitState: { info: { code: number | null; signal: NodeJS.Signals | null } | null } = { info: null }
  child.on('exit', (code, signal) => {
    exitState.info = { code, signal }
    if (process.env.SHRUBBERY_GARDEND_LOGS === '1') {
      process.stderr.write(`[spawn-gardend] exited code=${String(code)} signal=${String(signal)}\n`)
    }
  })

  const cleanupProfile = (): void => {
    if (reusedProfileDir) return // caller owns a supplied profileDir's lifecycle — see SpawnOptions.profileDir's own doc.
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  const kill = async (): Promise<void> => {
    if (child.pid && !exitState.info) {
      child.kill('SIGTERM')
      const deadline = Date.now() + 4000
      while (!exitState.info && Date.now() < deadline) await sleep(100)
      if (!exitState.info) child.kill('SIGKILL')
    }
    cleanupProfile()
  }

  try {
    const manifestPath = join(profileDir, 'loopback.json')
    const deadline = Date.now() + readyTimeoutMs

    // 1) wait for loopback.json (may land a beat before /health is serving).
    while (!existsSync(manifestPath)) {
      if (exitState.info)
        throw new Error(
          `gardend exited early (code=${exitState.info.code} signal=${exitState.info.signal}). stderr:\n${stderr.slice(-1500)}`,
        )
      if (Date.now() > deadline) throw new Error(`gardend: no loopback.json after ${readyTimeoutMs}ms. stderr:\n${stderr.slice(-1500)}`)
      await sleep(150)
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoopbackManifest
    const apiUrl = manifest.apiUrl.replace(/\/$/, '')
    const mcpUrl = manifest.mcpUrl

    // 2) wait for /health (unauthenticated) 2xx.
    let healthy = false
    while (!healthy) {
      if (exitState.info)
        throw new Error(`gardend exited before /health (code=${exitState.info.code}). stderr:\n${stderr.slice(-1500)}`)
      if (Date.now() > deadline) throw new Error(`gardend: /health never 2xx after ${readyTimeoutMs}ms. stderr:\n${stderr.slice(-1500)}`)
      try {
        const res = await fetch(`${apiUrl}/health`, { method: 'GET' })
        healthy = res.ok
      } catch {
        healthy = false
      }
      if (!healthy) await sleep(150)
    }

    return {
      pid: child.pid!,
      profileDir,
      manifest,
      apiUrl,
      mcpUrl,
      token: manifest.token,
      kill,
    }
  } catch (e) {
    await kill()
    throw e
  }
}

/**
 * Create the graph dir (RDF ops require an existing graph) and seed the real
 * N-Triples body into the cell's :ux:config NAMED graph. Uses the cell's MCP
 * over a one-off LoopbackMcpClient. Returns the named-graph IRI seeded.
 */
export async function createGraphAndSeedUxConfig(
  cell: GardendCell,
  graphId: string,
  ntBody: string,
  title = 'Shrubbery Organism Cell',
): Promise<string> {
  const { LoopbackMcpClient } = await import('./loopback-mcp.js')
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  // create_graph uses snake_case args.
  await mcp.toolsCall('create_graph', { graph_id: graphId, title })
  // rdf_load uses camelCase + targetGraphIri; seed into the :ux:config graph.
  const targetGraphIri = uxConfigGraphIri(graphId)
  await mcp.toolsCall('rdf_load', {
    graphId,
    data: ntBody,
    format: 'application/n-triples',
    targetGraphIri,
  })
  return targetGraphIri
}
