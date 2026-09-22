/**
 * seele-compile-route.integration.test.ts — W7.1/W7.2a/W7.2b's rejection
 * criterion. Follows the same shape as vite-cell-proxy.integration.test.ts:
 * a REAL Vite dev server, mounting the plugin under test, driven by real
 * HTTP requests over a real socket.
 *
 * NO MOCKS. The clean/broken/oversized cases run the real `nature` binary at
 * `nature/target/debug/nature` (skipped, not faked, if that sibling checkout
 * hasn't been built — see `natureBinAvailable` below). The spawn-failure and
 * timeout cases point `NATURE_BIN` at other real, but deliberately
 * uncooperative, processes (a nonexistent path; a real shell script that
 * sleeps past the bound) — that exercises the supervisor's own bounds
 * without needing nature to misbehave, and is still "real code, real
 * processes," never a stub of child_process or of the HTTP layer.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  COMPILE_MOUNT_PATH,
  DEFAULT_NATURE_BIN,
  MAX_COMPILE_BODY_BYTES,
  seeleCompileRoute,
} from '../scripts/seele-compile-route.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// DEFAULT_NATURE_BIN is `<natureRepoRoot>/target/debug/nature` — this is a
// SIBLING repo (/Users/vera/dev/sophia/nature), not reachable by any fixed
// relative path from this worktree, so derive its root from the binary path
// itself rather than assume a checkout layout.
const natureRepoRoot = resolve(dirname(DEFAULT_NATURE_BIN), '../..')
const cleanFixture = resolve(natureRepoRoot, 'examples/circle-1.seele.yaml')
const natureBinAvailable = existsSync(DEFAULT_NATURE_BIN) && existsSync(cleanFixture)

interface HttpResult {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly text: string
}

async function post(
  url: string,
  body: string,
  options?: { readonly headers?: Record<string, string>; readonly timeoutMs?: number },
): Promise<HttpResult> {
  return await new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...options?.headers,
        },
      },
      response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.once('end', () => {
          resolveResponse({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    request.setTimeout(options?.timeoutMs ?? 20_000, () => request.destroy(new Error(`POST ${url} timed out`)))
    request.once('error', reject)
    request.end(body)
  })
}

/** Sends a body larger than `over` bytes without materializing it as one string. */
async function postOversized(url: string, totalBytes: number): Promise<HttpResult> {
  return await new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.once('end', () => {
          resolveResponse({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    request.setTimeout(20_000, () => request.destroy(new Error('oversized POST timed out')))
    request.once('error', error => {
      // A destroyed connection after a 413 also surfaces as a client-side
      // ECONNRESET on the still-writing socket — that's the server correctly
      // cutting off an oversized upload, not a real transport failure.
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') return
      reject(error)
    })
    request.write(JSON.stringify({ source: '' }).slice(0, -2)) // open the JSON, unterminated
    const chunk = 'x'.repeat(64 * 1024)
    let written = 0
    const pump = (): void => {
      while (written < totalBytes) {
        written += chunk.length
        if (!request.write(chunk)) {
          request.once('drain', pump)
          return
        }
      }
      request.end('"}')
    }
    pump()
  })
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not reserve Vite port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => (error ? reject(error) : resolveClose()))
  })
  return port
}

async function withCompileServer<T>(
  routeOptions: Parameters<typeof seeleCompileRoute>[0],
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const vitePort = await freePort()
  const vite: ViteDevServer = await createViteServer({
    root: appDir,
    configFile: false,
    plugins: [seeleCompileRoute(routeOptions)],
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    logLevel: 'silent',
  })
  try {
    await vite.listen()
    return await run(`http://127.0.0.1:${vitePort}`)
  } finally {
    await vite.close()
  }
}

describe('POST /seele/compile', () => {
  beforeAll(() => {
    if (!natureBinAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        `[seele-compile-route] skipping real-nature cases: ${DEFAULT_NATURE_BIN} or ${cleanFixture} not present. ` +
          'Build nature (cargo build) in the sibling nature/ checkout to exercise them.',
      )
    }
  })

  it.skipIf(!natureBinAvailable)(
    'returns 200 with a sealed report for clean source, including contractHash and 14 declaredObjects',
    async () => {
      const source = readFileSync(cleanFixture, 'utf8')
      await withCompileServer({}, async baseUrl => {
        const result = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, JSON.stringify({ source }))
        expect(result.status).toBe(200)
        expect(result.headers['content-type']).toContain('application/json')
        const report = JSON.parse(result.text) as {
          clean: boolean
          contractHash: string | null
          declaredObjects: unknown[]
          canonicalNTriples: string | null
          compilerVersion: string
          producer: string
        }
        expect(report.clean).toBe(true)
        expect(report.contractHash).toEqual(expect.any(String))
        expect(report.contractHash).not.toBeNull()
        expect(report.declaredObjects).toHaveLength(14)
        expect(report.canonicalNTriples).toEqual(expect.any(String))
        expect(report.compilerVersion).toEqual(expect.any(String))
        expect(report.producer).toBe('nature')
      })
    },
    30_000,
  )

  it.skipIf(!natureBinAvailable)(
    'returns HTTP 200 for a source the compiler refuses — the refusal travels in the report envelope (clean:false), never the status code',
    async () => {
      await withCompileServer({}, async baseUrl => {
        const result = await post(
          `${baseUrl}${COMPILE_MOUNT_PATH}`,
          JSON.stringify({ source: 'not: valid: yaml: [\n' }),
        )
        // Suite W7.2a (~line 1572): "a malformed source returns diagnostics
        // with HTTP 200 (refusal is not a transport error)".
        expect(result.status).toBe(200)
        expect(result.headers['content-type']).toContain('application/json')
        const report = JSON.parse(result.text) as {
          clean: boolean
          contractHash: string | null
          diagnostics: ReadonlyArray<{ severity: string; message: string }>
        }
        expect(report.clean).toBe(false)
        expect(report.contractHash).toBeNull()
        expect(report.diagnostics.length).toBeGreaterThan(0)
        expect(report.diagnostics[0].severity).toBe('error')
      })
    },
    30_000,
  )

  it('returns 413 for a request body over the 256KB cap, before spawning nature', async () => {
    await withCompileServer({}, async baseUrl => {
      const result = await postOversized(`${baseUrl}${COMPILE_MOUNT_PATH}`, MAX_COMPILE_BODY_BYTES + 4096)
      expect(result.status).toBe(413)
      const body = JSON.parse(result.text) as { error: string; maxBytes: number }
      expect(body.error).toBe('body_too_large')
      expect(body.maxBytes).toBe(MAX_COMPILE_BODY_BYTES)
    })
  }, 30_000)

  it('accepts a body right at the cap and rejects one byte over it', async () => {
    await withCompileServer({ natureBin: slowEchoScript(0) }, async baseUrl => {
      // Pad so the whole JSON body (including the `{"source":"..."}` envelope)
      // lands exactly at the cap.
      const envelopeOverhead = JSON.stringify({ source: '' }).length
      const atCap = JSON.stringify({ source: 'x'.repeat(MAX_COMPILE_BODY_BYTES - envelopeOverhead) })
      expect(Buffer.byteLength(atCap)).toBe(MAX_COMPILE_BODY_BYTES)
      const okResult = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, atCap)
      expect(okResult.status).not.toBe(413)

      const overCap = JSON.stringify({ source: 'x'.repeat(MAX_COMPILE_BODY_BYTES - envelopeOverhead + 1) })
      const rejected = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, overCap)
      expect(rejected.status).toBe(413)
    })
  }, 30_000)

  it('returns a typed 500 when the nature binary cannot be spawned', async () => {
    const missingBin = resolve(mkdtempSync(join(tmpdir(), 'seele-missing-')), 'no-such-nature-binary')
    await withCompileServer({ natureBin: missingBin }, async baseUrl => {
      const result = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, JSON.stringify({ source: 'irrelevant' }))
      expect(result.status).toBe(500)
      const body = JSON.parse(result.text) as { error: string; message: string }
      expect(body.error).toBe('compile_spawn_failed')
      expect(body.message).toEqual(expect.any(String))
    })
  }, 30_000)

  it('kills a hung child at the timeout, returns a typed 500, and cleans up the temp file', async () => {
    const before = readdirSync(tmpdir()).filter(name => name.startsWith('seele-compile-'))
    await withCompileServer(
      { natureBin: slowEchoScript(5_000), timeoutMs: 300 },
      async baseUrl => {
        const started = Date.now()
        const result = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, JSON.stringify({ source: 'irrelevant' }), {
          timeoutMs: 10_000,
        })
        expect(Date.now() - started).toBeLessThan(4_000)
        expect(result.status).toBe(500)
        const body = JSON.parse(result.text) as { error: string; timeoutMs: number }
        expect(body.error).toBe('compile_timeout')
        expect(body.timeoutMs).toBe(300)
      },
    )
    // The route's own mkdtemp'd directory is removed in its `finally`, whether
    // or not the child honored SIGKILL promptly.
    const after = readdirSync(tmpdir()).filter(name => name.startsWith('seele-compile-'))
    expect(after.length).toBeLessThanOrEqual(before.length)
  }, 30_000)

  it('returns 400 for a body that is not {"source": string}', async () => {
    await withCompileServer({}, async baseUrl => {
      const result = await post(`${baseUrl}${COMPILE_MOUNT_PATH}`, JSON.stringify({ nope: true }))
      expect(result.status).toBe(400)
      const body = JSON.parse(result.text) as { error: string }
      expect(body.error).toBe('invalid_request')
    })
  }, 30_000)

  it('leaves other routes alone (next() on method/path mismatch)', async () => {
    await withCompileServer({}, async baseUrl => {
      const wrongMethod = await new Promise<HttpResult>((resolveResponse, reject) => {
        const request = httpRequest(`${baseUrl}${COMPILE_MOUNT_PATH}`, { method: 'GET' }, response => {
          const chunks: Buffer[] = []
          response.on('data', chunk => chunks.push(Buffer.from(chunk)))
          response.once('end', () =>
            resolveResponse({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }),
          )
        })
        request.once('error', reject)
        request.end()
      })
      // Vite's own middleware stack takes over past our `next()` — a GET on
      // this path falls through to Vite's SPA index.html fallback (200,
      // text/html), never our JSON contract.
      expect(wrongMethod.headers['content-type']).toContain('text/html')

      const wrongPath = await post(`${baseUrl}/not-the-compile-route`, JSON.stringify({ source: 'x' }))
      expect(wrongPath.status).toBe(404)
    })
  }, 30_000)

  // Every case above mounts `seeleCompileRoute()` directly so the plugin's
  // own contract is under test in isolation from the rest of the app's dev
  // config. This one instead loads the REAL `apps/organism/vite.config.ts`
  // (W7.2b's actual touch) to guard against the plugin being wired in but
  // then silently dropped from the array in a future edit.
  it.skipIf(!natureBinAvailable)(
    'is mounted by the real apps/organism/vite.config.ts',
    async () => {
      const source = readFileSync(cleanFixture, 'utf8')
      const vitePort = await freePort()
      const vite: ViteDevServer = await createViteServer({
        root: appDir,
        configFile: resolve(appDir, 'vite.config.ts'),
        server: { host: '127.0.0.1', port: vitePort, strictPort: true },
        logLevel: 'silent',
      })
      try {
        await vite.listen()
        const result = await post(
          `http://127.0.0.1:${vitePort}${COMPILE_MOUNT_PATH}`,
          JSON.stringify({ source }),
        )
        expect(result.status).toBe(200)
        expect((JSON.parse(result.text) as { clean: boolean }).clean).toBe(true)
      } finally {
        await vite.close()
      }
    },
    30_000,
  )
})

const scratchScripts: string[] = []
afterEach(() => {
  while (scratchScripts.length > 0) {
    const dir = scratchScripts.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A REAL executable (a shell script, not a stub of child_process) standing
 * in for `nature` to exercise the supervisor's own timeout/kill path without
 * needing the real compiler to hang. Emits a well-formed clean report after
 * `delayMs`, so a `delayMs` under the route's `timeoutMs` is a legitimate
 * "slow but real" compile and a `delayMs` over it is the hang case.
 */
function slowEchoScript(delayMs: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'seele-slow-nature-'))
  scratchScripts.push(dir)
  const scriptPath = resolve(dir, 'nature')
  const report = JSON.stringify({
    schema: 'nature.seele.compile-report.v1',
    producer: 'nature',
    compilerVersion: 'test-stub',
    clean: true,
    sourceDigest: 'stub',
    vocabDigest: 'stub',
    contractHash: 'stub',
    canonicalNTriples: '',
    tripleCount: 0,
    declaredObjects: [],
    diagnostics: [],
  })
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nsleep ${(delayMs / 1000).toFixed(3)}\ncat <<'EOF'\n${report}\nEOF\n`,
    { mode: 0o755 },
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}
