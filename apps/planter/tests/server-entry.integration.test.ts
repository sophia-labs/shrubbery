// @vitest-environment node
//
// Node env: spawns the REAL `apps/planter/src/server-entry.ts` entry point as an
// actual child process (tsx, the same real-child-process discipline as
// seed-cli.integration.test.ts) — its own argv-independent env-var boot,
// exit codes, and real `http.Server` all run for real. NO MOCKS.

/**
 * server-entry.integration.test.ts — HIGH-2 acceptance: the shipped
 * `pnpm serve` entry point boots through the SAME validated
 * `PlanterBootConfig` resolution the SPA uses (`server-boot.ts`'s
 * `bootConfigFromProcessEnv` → `sourceFromBoot`), never a hardcoded
 * `adapter: 'gardend-local'` fallback baked into the process.
 *
 * Proves:
 *   - the server entry REFUSES (non-zero exit, named fields) when
 *     PLANTER_ENDPOINT/PLANTER_GRAPH are absent — no hardcoded fallback;
 *   - an explicit PLANTER_ADAPTER=static-nt selection boots end-to-end and
 *     actually serves that adapter's kind — the cheap adapter to prove the
 *     "any adapter is selectable" claim without a live gardend.
 */

import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parseNT, uxConfigGraphIri } from '@shrubbery/nucleus'
import { serializeFossil } from '@shrubbery/source'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const require_ = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(HERE, '..')
const TSX_BIN = resolve(APP_DIR, 'node_modules/.bin/tsx')
const SERVER_SCRIPT = resolve(APP_DIR, 'src/server-entry.ts')
const SEED_BODY: string = require_('node:fs').readFileSync(
  require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

async function getFreePort(): Promise<number> {
  return new Promise((res, reject) => {
    const srv = createHttpServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port
      srv.close(() => res(port))
    })
    srv.on('error', reject)
  })
}

function writeRealFossil(graphId: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'planter-server-entry-fossil-'))
  const path = join(dir, `${graphId}.nt`)
  writeFileSync(
    path,
    serializeFossil(
      { graphIri: uxConfigGraphIri(graphId), capturedAt: Date.UTC(2026, 6, 1, 12, 0, 0), source: 'server-entry-it' },
      SEED_BODY,
    ),
    'utf8',
  )
  return path
}

describe('server-entry.ts — HIGH-2: validated PLANTER_* boot, no hardcoded fallback', () => {
  it('refuses (non-zero exit, naming the missing fields) when PLANTER_ENDPOINT and PLANTER_GRAPH are absent', async () => {
    const env = { ...process.env }
    delete env.PLANTER_ENDPOINT
    delete env.PLANTER_GRAPH
    await expect(
      execFileAsync(TSX_BIN, [SERVER_SCRIPT], { cwd: APP_DIR, env, timeout: 10_000 }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/PLANTER_ENDPOINT/),
    })
    await expect(
      execFileAsync(TSX_BIN, [SERVER_SCRIPT], { cwd: APP_DIR, env, timeout: 10_000 }),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/PLANTER_GRAPH/),
    })
  }, 20_000)

  it('refuses when only PLANTER_ENDPOINT is given (half-specified, never a guessed graph)', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PLANTER_ENDPOINT: 'http://127.0.0.1:7090' }
    delete env.PLANTER_GRAPH
    await expect(
      execFileAsync(TSX_BIN, [SERVER_SCRIPT], { cwd: APP_DIR, env, timeout: 10_000 }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/PLANTER_GRAPH/) })
  })

  let child: ReturnType<typeof spawn> | undefined

  afterEach(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM')
      await new Promise<void>((r) => {
        child!.once('exit', () => r())
        setTimeout(r, 2000)
      })
    }
    child = undefined
  })

  it(
    'PLANTER_ADAPTER=static-nt boots end-to-end (no gardend involved) and serves that exact adapter — proving any adapter is selectable, not just the old hardcoded gardend-local',
    async () => {
      const GRAPH_ID = 'server-entry-static-it'
      const fossilPath = writeRealFossil(GRAPH_ID)
      const port = await getFreePort()

      child = spawn(
        TSX_BIN,
        [SERVER_SCRIPT],
        {
          cwd: APP_DIR,
          env: {
            ...process.env,
            PORT: String(port),
            PLANTER_GRAPH: GRAPH_ID,
            PLANTER_ENDPOINT: `static:${fossilPath}`,
            PLANTER_ADAPTER: 'static-nt',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      let exited: { code: number | null } | undefined
      child.on('exit', (code) => {
        exited = { code }
      })

      const base = `http://127.0.0.1:${port}`
      const deadline = Date.now() + 15_000
      let healthy = false
      while (!healthy && Date.now() < deadline) {
        if (exited) throw new Error(`server exited early (code=${exited.code}). stderr:\n${stderr}`)
        try {
          const res = await fetch(`${base}/health`)
          healthy = res.status === 200
        } catch {
          await new Promise((r) => setTimeout(r, 150))
        }
      }
      expect(healthy, `server never became healthy. stderr:\n${stderr}`).toBe(true)

      const res = await fetch(`${base}/site.json`)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-shrubbery-source')).toBe('static-nt')
      expect(res.headers.get('x-shrubbery-liveness')).toBe('static')
      expect(res.headers.get('x-shrubbery-triple-count')).toBe(String(SEED_TRIPLE_COUNT))
    },
    30_000,
  )
})
