/**
 * seele-compile-route.ts — W7.1 (the host-side compile seam) + W7.2a (the
 * route contract and its process supervisor) + W7.2b (the Vite dev-server
 * plugin mount), per plans/hoja-seele-workbench-suite-20260803.md §W7 and
 * the 2026-08-03 ratification (D17: v1 = a local Vite app shelling to a
 * local `nature` binary — no server survives `vite build`, by design).
 *
 * `POST /seele/compile` — body `{source: string}` — writes `source` to a
 * temp file and runs `nature seele compile <path> --json` (D14 field names:
 * `canonicalNTriples`, `compilerVersion`, `producer`, `declaredObjects`; see
 * nature/src/main.rs:34-90). The report is relayed **verbatim** — this
 * route parses it only to confirm it IS the JSON contract, never to reshape
 * it — with:
 *
 *   200 — the compiler ran to completion and emitted a report, CLEAN OR
 *         REFUSED alike. A refusal is a normal compiler outcome carried in
 *         the D14 envelope itself (`clean: false` + `diagnostics`), never in
 *         the status code — "refusal is not a transport error" (suite W7.2a,
 *         plans/hoja-seele-workbench-suite-20260803.md ~line 1572)
 *   413 — request body over the cap, rejected before any subprocess spawns
 *   500 — the compiler could not be run to completion at all: spawn failure
 *         (e.g. NATURE_BIN doesn't exist), timeout+kill, or output that
 *         wasn't the JSON contract — always a typed body, never a bare 500
 *
 * NO MOCKS: the handler always shells out to a real `nature` binary
 * (env NATURE_BIN, default the sibling nature/ checkout's debug build).
 * Nothing here fakes a compile result.
 */

import { randomUUID } from 'node:crypto'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const NATURE_BIN_ENV = 'NATURE_BIN'
export const DEFAULT_NATURE_BIN = '/Users/vera/dev/sophia/nature/target/debug/nature'
export const MAX_COMPILE_BODY_BYTES = 256 * 1024
export const DEFAULT_COMPILE_TIMEOUT_MS = 15_000
export const COMPILE_MOUNT_PATH = '/seele/compile'

export type SeeleCompileErrorCode =
  | 'invalid_request'
  | 'body_too_large'
  | 'compile_spawn_failed'
  | 'compile_timeout'
  | 'compile_output_invalid'

export interface SeeleCompileErrorBody {
  readonly error: SeeleCompileErrorCode
  readonly message: string
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

export interface SeeleCompileRouteOptions {
  /** Path to the `nature` binary. Defaults to `NATURE_BIN` env, else `DEFAULT_NATURE_BIN`. */
  readonly natureBin?: string
  /** Bound on the request body, in bytes. Defaults to 256KB (`MAX_COMPILE_BODY_BYTES`). */
  readonly maxBodyBytes?: number
  /** Bound on the child process wall time before SIGKILL. Defaults to 15s. */
  readonly timeoutMs?: number
}

interface ResolvedOptions {
  readonly natureBin: string
  readonly maxBodyBytes: number
  readonly timeoutMs: number
}

function resolveOptions(options: SeeleCompileRouteOptions): ResolvedOptions {
  return {
    natureBin: options.natureBin ?? process.env[NATURE_BIN_ENV] ?? DEFAULT_NATURE_BIN,
    maxBodyBytes: options.maxBodyBytes ?? MAX_COMPILE_BODY_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS,
  }
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://vite.invalid').pathname
  } catch {
    return '/'
  }
}

function sendJson(response: ServerResponse, status: number, text: string): void {
  if (response.writableEnded || response.destroyed) return
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(text))
  response.setHeader('Cache-Control', 'no-store')
  response.end(text)
}

function sendError(response: ServerResponse, status: number, body: SeeleCompileErrorBody): void {
  if (response.writableEnded || response.destroyed) return
  sendJson(response, status, JSON.stringify(body))
}

type BodyResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'too_large' | 'aborted' }

/**
 * Reads the request body up to `maxBytes`, rejecting the instant the cap is
 * crossed — before the rest of the request is drained — rather than buffering
 * an unbounded stream and rejecting only at the end.
 */
function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise(resolvePromise => {
    const chunks: Buffer[] = []
    let received = 0
    let settled = false

    const finish = (result: BodyResult): void => {
      if (settled) return
      settled = true
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('aborted', onAborted)
      request.removeListener('error', onError)
      resolvePromise(result)
    }
    const onData = (chunk: Buffer): void => {
      received += chunk.length
      if (received > maxBytes) {
        // Stop accumulating and let the caller send 413 — but do NOT destroy
        // the request here: IncomingMessage.destroy() tears down the shared
        // socket, which would take the not-yet-sent response down with it.
        // The caller closes the connection only after the response finishes.
        finish({ ok: false, reason: 'too_large' })
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') })
    const onAborted = (): void => finish({ ok: false, reason: 'aborted' })
    const onError = (): void => finish({ ok: false, reason: 'aborted' })

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('aborted', onAborted)
    request.on('error', onError)
  })
}

interface CompileRun {
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly spawnError: Error | null
}

/** Runs the real `nature` binary against `sourcePath`, bounded by `timeoutMs`. */
function runNatureCompile(natureBin: string, sourcePath: string, timeoutMs: number): Promise<CompileRun> {
  return new Promise(resolvePromise => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: Error | null = null
    let settled = false

    let child: ChildProcess
    try {
      child = spawn(natureBin, ['seele', 'compile', sourcePath, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolvePromise({ stdout: '', stderr: '', timedOut: false, spawnError: error as Error })
      return
    }

    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ stdout, stderr, timedOut, spawnError })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    // The child's own EventEmitter typing is loose enough across Node
    // versions that TS wants a cast for stdout/stderr — both are always
    // present given stdio: ['ignore','pipe','pipe'].
    ;(child.stdout as unknown as EventEmitter).on('data', (chunk: Buffer) => { stdout += chunk })
    ;(child.stderr as unknown as EventEmitter).on('data', (chunk: Buffer) => { stderr += chunk })
    child.once('error', error => {
      spawnError = error as Error
      finish()
    })
    child.once('close', () => finish())
  })
}

async function handleCompileRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedOptions,
): Promise<void> {
  const bodyResult = await readBoundedBody(request, options.maxBodyBytes)
  if (!bodyResult.ok) {
    if (bodyResult.reason === 'too_large') {
      // The client may still be mid-upload (we stopped reading, we didn't
      // stop it from sending). Answer, then close the connection rather than
      // leave it keep-alive — the unread remainder would otherwise desync
      // the next request on a reused socket. Closing only after 'finish'
      // keeps this response's own bytes from racing the teardown.
      response.setHeader('Connection', 'close')
      sendError(response, 413, {
        error: 'body_too_large',
        message: `request body exceeds the ${options.maxBodyBytes}-byte cap`,
        maxBytes: options.maxBodyBytes,
      })
      response.once('finish', () => request.destroy())
    }
    // 'aborted': the client is already gone — nothing to send.
    return
  }

  let source: string
  try {
    const parsed: unknown = JSON.parse(bodyResult.text)
    const candidate = (parsed as { source?: unknown } | null)?.source
    if (typeof candidate !== 'string') throw new Error('missing "source" string field')
    source = candidate
  } catch (error) {
    sendError(response, 400, {
      error: 'invalid_request',
      message: `request body must be JSON {"source": string}: ${(error as Error).message}`,
    })
    return
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'seele-compile-'))
  const sourcePath = join(tempDir, `${randomUUID()}.seele.yaml`)
  try {
    writeFileSync(sourcePath, source, 'utf8')
    const run = await runNatureCompile(options.natureBin, sourcePath, options.timeoutMs)

    if (run.timedOut) {
      sendError(response, 500, {
        error: 'compile_timeout',
        message: `nature did not complete within ${options.timeoutMs}ms and was killed`,
        timeoutMs: options.timeoutMs,
      })
      return
    }
    if (run.spawnError) {
      sendError(response, 500, {
        error: 'compile_spawn_failed',
        message: run.spawnError.message,
      })
      return
    }

    try {
      JSON.parse(run.stdout)
    } catch (error) {
      sendError(response, 500, {
        error: 'compile_output_invalid',
        message: `nature did not emit the JSON compile-report contract: ${(error as Error).message}. stderr: ${run.stderr.slice(0, 2000)}`,
      })
      return
    }

    // Relay VERBATIM with HTTP 200, clean or refused: nature's own stdout
    // text, not a re-serialization. The parse above exists only to prove the
    // output IS the JSON contract; a refusal travels in the report envelope
    // (`clean: false`), never in the status code (suite W7.2a ~line 1572).
    sendJson(response, 200, run.stdout)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

interface ConnectMiddlewareStack {
  use(middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void
}
interface ViteDevServerLike {
  readonly middlewares: ConnectMiddlewareStack
}
export interface SeeleCompileRoutePlugin {
  readonly name: string
  readonly apply: 'serve'
  configureServer(server: ViteDevServerLike): void
}

/**
 * The W7.2b mount: `seeleCompileRoute()` beside `dynamicCellProxy` in a
 * Vite dev-server's `plugins`. Per D17 / F11 this is dev-only by design —
 * `vite build` discards the plugin along with the server it configures.
 */
export function seeleCompileRoute(options: SeeleCompileRouteOptions = {}): SeeleCompileRoutePlugin {
  const resolved = resolveOptions(options)
  return {
    name: 'shrubbery-seele-compile-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'POST' || requestPath(request) !== COMPILE_MOUNT_PATH) {
          next()
          return
        }
        handleCompileRequest(request, response, resolved).catch(error => {
          if (response.headersSent) {
            response.destroy()
            return
          }
          sendError(response, 500, {
            error: 'compile_spawn_failed',
            message: (error as Error).message,
          })
        })
      })
    },
  }
}
