/**
 * compile-seam.ts — W7.1's host-side compile seam, as a browser-consumable
 * type + one real HTTP implementation.
 *
 * Stage 4 built the PRODUCER (`apps/organism/scripts/seele-compile-route.ts`,
 * a Vite dev-server plugin that shells to the real `nature` binary and relays
 * its `--json` compile report VERBATIM). That module is Node-only — it imports
 * `node:http`/`node:child_process` — so a browser-side consumer cannot name its
 * response type without dragging Node's types into the bundle. This module is
 * the CONSUMER half of the same seam: the report shape, restated once,
 * host-side, plus `createHttpSeeleCompiler` — a plain `fetch` against the
 * route. Nothing here is a second implementation of the compiler; the only
 * producer of a `SeeleCompileReport` anywhere in this repo is the real
 * `nature` binary.
 *
 * The field names below are nature's own (D14): `canonicalNTriples`,
 * `compilerVersion`, `producer`, `declaredObjects` — verified field-for-field
 * against `nature seele compile examples/circle-1.seele.yaml --json`, not
 * transcribed from prose.
 *
 * THE ONE CONTRACT SUBTLETY WORTH STATING LOUD: **a refusal is not an error.**
 * `clean: false` is a normal, well-formed compiler outcome that the route
 * relays with HTTP 200 exactly like a clean one — the refusal travels in the
 * D14 report envelope itself, never in the status code ("a malformed source
 * returns diagnostics with HTTP 200 (refusal is not a transport error)",
 * suite W7.2a, plans/hoja-seele-workbench-suite-20260803.md ~line 1572).
 * `compile()` therefore RESOLVES with the report whenever the route relayed
 * one, and REJECTS only when the compiler could not be run to completion at
 * all (spawn failure, timeout, malformed output, network). A consumer that
 * treated a refusal as a throw would render "compiler unavailable" where the
 * honest answer is "your constitution has three errors."
 */

/** One diagnostic from a compile. `severity` is `'error'` — nature never constructs a warning tier (W9.3/C5). */
export interface SeeleDiagnostic {
  readonly severity: string
  readonly code: string
  readonly message: string
  readonly anchor: string
}

/** One subject the compile declared — `{id, iri, type}`, exactly as nature emits it. */
export interface SeeleDeclaredObject {
  readonly id: string
  readonly iri: string
  readonly type: string
}

/**
 * nature's compile report, relayed verbatim by the route. Every field is
 * present on both a clean and a refused compile; the nullable ones are null on
 * a refusal (`canonicalNTriples`, `contractHash`, `compilationReceiptDigest`).
 */
export interface SeeleCompileReport {
  readonly schema: string
  readonly clean: boolean
  readonly producer: string
  readonly compilerVersion: string
  readonly compilerSemanticsId: string
  readonly sourceDigest: string
  readonly vocabDigest: string
  readonly vocabSemanticsDigest: string
  readonly contractHash: string | null
  readonly compilationReceiptDigest: string | null
  readonly canonicalNTriples: string | null
  readonly tripleCount: number
  readonly declaredObjects: readonly SeeleDeclaredObject[]
  readonly diagnostics: readonly SeeleDiagnostic[]
}

/** How many `severity: 'error'` diagnostics a report carries. */
export function countCompileErrors(report: SeeleCompileReport): number {
  return report.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
}

/**
 * The seam itself. `signal` lets a newer source abort an older in-flight
 * compile (newest-wins, W14.5) — the controller owns that policy, not this
 * function.
 */
export interface SeeleCompileRequest {
  readonly source: string
  readonly signal?: AbortSignal
}

export type SeeleCompiler = (request: SeeleCompileRequest) => Promise<SeeleCompileReport>

/**
 * Thrown when the compiler could not be run to completion — NEVER for a
 * refusal. `body` carries the route's typed error body when it sent one
 * (`{error, message, ...}`), so a pane can say *why* rather than "something
 * went wrong".
 */
export class SeeleCompileTransportError extends Error {
  readonly status: number | null
  readonly body: unknown
  constructor(message: string, status: number | null, body?: unknown) {
    super(message)
    this.name = 'SeeleCompileTransportError'
    this.status = status
    this.body = body
  }
}

/** Shape check on the relayed body — a 200 that isn't a report is a transport failure, not a silent render. */
function isCompileReport(value: unknown): value is SeeleCompileReport {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.clean === 'boolean' &&
    typeof candidate.sourceDigest === 'string' &&
    typeof candidate.compilerVersion === 'string' &&
    Array.isArray(candidate.diagnostics) &&
    Array.isArray(candidate.declaredObjects)
  )
}

export interface HttpSeeleCompilerOptions {
  /** Where the route is mounted. Defaults to the stage-4 mount path. */
  readonly url?: string
  /** Injected for tests that drive a real server without a global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

/** The stage-4 route's mount path (`seele-compile-route.ts`'s `COMPILE_MOUNT_PATH`). */
export const DEFAULT_COMPILE_URL = '/seele/compile'

/**
 * A real `fetch` client for the stage-4 route. Same-origin by construction —
 * the Vite dev server that serves the app is the same one that mounts the
 * route, so no cross-origin story and no token ever reaches this module.
 */
export function createHttpSeeleCompiler(options: HttpSeeleCompilerOptions = {}): SeeleCompiler {
  const url = options.url ?? DEFAULT_COMPILE_URL
  const doFetch = options.fetchImpl ?? globalThis.fetch
  return async ({ source, signal }) => {
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
        signal,
      })
    } catch (error) {
      // An aborted request must stay an AbortError so the controller can tell
      // "superseded" from "the route is down" — see the controller's own
      // newest-wins handling.
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new SeeleCompileTransportError(
        `seele compile: request to ${url} failed — ${error instanceof Error ? error.message : String(error)}`,
        null,
      )
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new SeeleCompileTransportError(
        `seele compile: ${url} returned HTTP ${response.status} with a non-JSON body`,
        response.status,
        text,
      )
    }

    // HTTP 200 carries the report, clean OR refused — a refusal lives in the
    // envelope (`clean: false`), never in the status code (suite W7.2a).
    if (response.status === 200) {
      if (!isCompileReport(parsed)) {
        throw new SeeleCompileTransportError(
          `seele compile: ${url} returned HTTP ${response.status} with a body that is not a compile report`,
          response.status,
          parsed,
        )
      }
      return parsed
    }

    const message =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as { message?: unknown }).message === 'string'
        ? (parsed as { message: string }).message
        : `HTTP ${response.status}`
    throw new SeeleCompileTransportError(`seele compile: ${message}`, response.status, parsed)
  }
}
