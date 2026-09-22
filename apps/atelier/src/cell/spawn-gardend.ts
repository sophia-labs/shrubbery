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
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
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
// GitHub layout — shrubbery/ and garden/ side-by-side), then Vera's local
// sophia dev tree, kept for her own machine. The first existing candidate wins;
// if none exist, the first candidate is used so the error message points at the
// expected location.
const HERE = dirname(fileURLToPath(import.meta.url))

const DEFAULT_BIN_CANDIDATES: readonly string[] = [
  // Sibling-repo checkout: shrubbery/apps/atelier/src/cell/ → ../../../../../garden/...
  resolve(HERE, '../../../../../garden/src-tauri/target/release/examples/gardend'),
  // Vera's local sophia dev tree
  '/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend',
]

function findDefaultBin(): string {
  for (const candidate of DEFAULT_BIN_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  // No candidate exists. Return the first (sibling-repo) so error messages
  // point at the most-likely-correct location for a fresh contributor.
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

  // FRESH temp profile per run (stale rocksdb lock ⇒ spawn fails).
  const profileDir = mkdtempSync(join(tmpdir(), 'gardend-atelier.'))
  const token = `atelier-${randomUUID().replace(/-/g, '')}`

  // gardend takes NO CLI args — configured purely by env vars.
  const child: ChildProcess = spawn(bin, [], {
    env: {
      ...process.env,
      GARDEN_PROFILE_DIR: profileDir,
      GARDEN_LOOPBACK_HOST: '127.0.0.1',
      GARDEN_LOOPBACK_PORT: '0', // OS-assigned random port
      GARDEN_LOOPBACK_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  // A mutable holder so TS keeps the union type after the exit callback mutates
  // it (a bare `let exited = null` gets narrowed to `never` inside sync loops).
  const exitState: { info: { code: number | null; signal: NodeJS.Signals | null } | null } = { info: null }
  child.on('exit', (code, signal) => {
    exitState.info = { code, signal }
  })

  const cleanupProfile = (): void => {
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
  title = 'Shrubbery Atelier Cell',
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
