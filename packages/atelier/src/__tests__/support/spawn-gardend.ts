/**
 * spawn-gardend.ts — NODE-ONLY test-support helper that stands up a REAL
 * headless gardend cell with a fresh temp profile and tears it down cleanly.
 *
 * This is a trimmed copy of the proven recipe in
 * apps/atelier/src/cell/spawn-gardend.ts (env-only config, fresh mktemp
 * profile per run, read loopback.json, poll /health) — duplicated here
 * rather than imported so @shrubbery/atelier-vtuber (a package) doesn't take
 * a dependency on @shrubbery/atelier (an app); packages depend on apps
 * nowhere else in this monorepo. This copy drops the `createGraphAndSeedUxConfig`
 * helper (which needs @shrubbery/nucleus) — this package's tests create graphs
 * via a plain `create_graph` tools/call through mirror-artifact.ts's own
 * createLoopbackCellCaller instead.
 *
 * NO MOCKS: this spawns the real binary. If it's missing, callers get a clear
 * error — the test must skip-or-fail honestly, never fake the cell.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Same current-release-build rationale as apps/atelier/src/cell/spawn-gardend.ts:
// the release example binary serves the routes this test needs; GARDEN_BIN overrides.
const DEFAULT_BIN = '/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend'

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
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
  /** SIGTERM the cell and remove the temp profile. Idempotent. */
  kill(): Promise<void>
}

export interface SpawnOptions {
  /** Override the gardend binary; default = GARDEN_BIN env or the proven default. */
  bin?: string
  /** Max ms to wait for loopback.json + /health (default 20000). */
  readyTimeoutMs?: number
}

/** Resolve the gardend binary path: explicit > GARDEN_BIN env > proven default. */
export function resolveGardendBin(opts?: SpawnOptions): string {
  return opts?.bin ?? process.env.GARDEN_BIN ?? DEFAULT_BIN
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

  const profileDir = mkdtempSync(join(tmpdir(), 'gardend-atelier-vtuber.'))
  const token = `atelier-${randomUUID().replace(/-/g, '')}`

  const child: ChildProcess = spawn(bin, [], {
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

    let healthy = false
    while (!healthy) {
      if (exitState.info) throw new Error(`gardend exited before /health (code=${exitState.info.code}). stderr:\n${stderr.slice(-1500)}`)
      if (Date.now() > deadline) throw new Error(`gardend: /health never 2xx after ${readyTimeoutMs}ms. stderr:\n${stderr.slice(-1500)}`)
      try {
        const res = await fetch(`${apiUrl}/health`, { method: 'GET' })
        healthy = res.ok
      } catch {
        healthy = false
      }
      if (!healthy) await sleep(150)
    }

    return { pid: child.pid!, profileDir, manifest, apiUrl, mcpUrl, token: manifest.token, kill }
  } catch (e) {
    await kill()
    throw e
  }
}
