/**
 * spawn-gardend.ts — NODE-ONLY helper that stands up a REAL headless gardend
 * cell with a fresh temp profile and tears it down cleanly, plus loopback.json
 * manifest discovery for already-running cells.
 *
 * HOISTED from apps/organism/src/cell/spawn-gardend.ts @ b2f408e (the newer
 * organism copy, KEEPING the cwd:profileDir fastembed fix) — organism's copy
 * is frozen under active swarm ownership; @shrubbery/source/node is the sole
 * external adapter-consumption convention. Organism's migration is a named
 * follow-up slice. The seed helpers are split out into ./seed.ts (design
 * §2.1); manifest discovery (readLoopbackManifest) is new here.
 *
 * It encodes the PROVEN recipe verbatim (apps/organism/scripts/
 * probe-gardend-liveread.sh): env-only config, fresh mktemp profile per run,
 * read loopback.json (camelCase apiUrl/mcpUrl/token/port), poll /health.
 *
 * NO MOCKS: this spawns the real binary. If the binary is missing, callers
 * get a clear error (the test/script must skip-or-fail honestly, never fake
 * the cell).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

// The CURRENT release build serves the /emporium vocab-catalogue routes; the
// debug build is STALE (predates them). Per Vera's iter-4a directive, ALL
// cells spawn the release example binary. GARDEN_BIN env var still overrides.
//
// Default discovery walks a small list of well-known candidates so
// contributors don't have to set GARDEN_BIN: first the sibling-repo checkout
// (the standard GitHub layout where shrubbery/ and garden/ live side-by-side),
// then Vera's local sophia dev tree, kept for her own machine. The first
// existing candidate wins; if none exist, the first candidate is returned so
// the error message points at the most-likely-correct location for a fresh
// contributor.
const HERE = dirname(fileURLToPath(import.meta.url))

const DEFAULT_BIN_CANDIDATES: readonly string[] = [
  // Sibling-repo checkout: shrubbery/packages/source/src/node/ → ../../../../../garden/...
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

/**
 * Discover the loopback manifest of an ALREADY-RUNNING cell: read and
 * validate loopback.json. Accepts either the manifest file itself or the
 * profile directory that contains it. Throws (honestly, naming the path) on
 * a missing file or a manifest without the camelCase apiUrl/mcpUrl/token.
 */
export function readLoopbackManifest(pathOrProfileDir: string): LoopbackManifest {
  const path =
    existsSync(pathOrProfileDir) && statSync(pathOrProfileDir).isDirectory()
      ? join(pathOrProfileDir, 'loopback.json')
      : pathOrProfileDir
  if (!existsSync(path)) {
    throw new Error(
      `readLoopbackManifest: no loopback.json at ${path} — is the cell running with GARDEN_PROFILE_DIR set there?`,
    )
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`readLoopbackManifest: ${path} is not a JSON object`)
  }
  const m = parsed as Record<string, unknown>
  for (const key of ['apiUrl', 'mcpUrl', 'token'] as const) {
    if (typeof m[key] !== 'string' || (m[key] as string).length === 0) {
      throw new Error(
        `readLoopbackManifest: ${path} is missing the camelCase '${key}' field — not a gardend loopback manifest`,
      )
    }
  }
  return parsed as LoopbackManifest
}

/** A spawned cell handle. */
export interface GardendCell {
  readonly pid: number
  readonly profileDir: string
  readonly manifest: LoopbackManifest
  /** apiUrl/mcpUrl/token, ready for an McpClient (Node, origin=127.0.0.1). */
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
  /** SIGTERM the cell and remove the temp profile. Idempotent. */
  kill(): Promise<void>
}

export interface SpawnOptions {
  /** Override the gardend binary; default = GARDEN_BIN env or the discovered default. */
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
  const profileDir = mkdtempSync(join(tmpdir(), 'gardend-planter.'))
  const token = `planter-${randomUUID().replace(/-/g, '')}`

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  // A mutable holder so TS keeps the union type after the exit callback mutates
  // it (a bare `let exited = null` gets narrowed to `never` inside sync loops).
  const exitState: { info: { code: number | null; signal: NodeJS.Signals | null } | null } = {
    info: null,
  }
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
      if (Date.now() > deadline)
        throw new Error(
          `gardend: no loopback.json after ${readyTimeoutMs}ms. stderr:\n${stderr.slice(-1500)}`,
        )
      await sleep(150)
    }
    const manifest = readLoopbackManifest(manifestPath)
    const apiUrl = manifest.apiUrl.replace(/\/$/, '')
    const mcpUrl = manifest.mcpUrl

    // 2) wait for /health (unauthenticated) 2xx.
    let healthy = false
    while (!healthy) {
      if (exitState.info)
        throw new Error(
          `gardend exited before /health (code=${exitState.info.code}). stderr:\n${stderr.slice(-1500)}`,
        )
      if (Date.now() > deadline)
        throw new Error(
          `gardend: /health never 2xx after ${readyTimeoutMs}ms. stderr:\n${stderr.slice(-1500)}`,
        )
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
