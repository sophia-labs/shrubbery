/**
 * workbench-controller.ts — the SEELe workbench's document→source→compile→
 * report loop (W14, v1 slice).
 *
 * It is the ONE thing that talks to both the editor host and the compile
 * route. Faces subscribe to its handle; they never reach past it. Concretely
 * it joins three already-built pieces and adds only the policy between them:
 *
 *   W14.1  `HojaDocumentContentPort` — the leaf-level lossless read + a
 *          content-coalesced change subscription on `<sh-editor-host>`.
 *   W14.2  `projectSeeleSource` — the pure D16 projection: exactly one
 *          `seele`-tagged fence, loud on zero and on two-or-more.
 *   W7     the compile route — a real `nature` binary behind `POST
 *          /seele/compile`, reached through `SeeleCompiler`.
 *
 * WHY THE CONTROLLER DEBOUNCES EVEN THOUGH THE PORT ALREADY DOES.
 * `onDocumentContentChanged` is itself trailing-debounced, so the obvious
 * wiring — subscribe with `{debounceMs: 400}` and compile on every callback —
 * would work, and would LIE for those 400ms: the pane shows new bytes while
 * the chip still reads `sealed` for the old ones. So this controller
 * subscribes with `debounceMs: 0` (near-immediate, still content-coalesced —
 * an idempotent edit produces nothing at all) and applies its OWN trailing
 * window before asking the compiler. The visible consequence is the point:
 * the first keystroke flips the chip to `typing` immediately, the window
 * expires, the chip reads `compiling…`, and only then does a verdict land.
 *
 * NEWEST-WINS, AND STALE REPORTS ARE DISCARDED, NOT RENDERED (W7.3/W14.5).
 * Every compile carries a sequence number and an `AbortSignal`; a newer source
 * aborts the older request, and a report that arrives for bytes that are no
 * longer on screen is dropped rather than applied. `compiledSource` is stored
 * beside the report precisely so "is this verdict about what I am looking at"
 * is answerable by comparison rather than by hope.
 *
 * WHAT THIS v1 SLICE DELIBERATELY DOES NOT DO: no single-flight join across
 * duplicate digests, no bounded work queue, no client-side timeout (the route
 * already enforces a 15s wall clock and answers with a typed 500), no
 * persistence acknowledgment (D18 (iii) — there is none to have), no apply
 * port (W14.8/D19). Those are named workstreams, not oversights.
 */

import type { HojaDocumentContentPort } from '../layout/faces/hoja-document-face.js'
import type { LiveDocumentJSON } from '../collab/live-editor.js'
import { projectSeeleSource, type SourceRegion } from './source-projection.js'
import { SeeleCompileTransportError, type SeeleCompileReport, type SeeleCompiler } from './compile-seam.js'
import { deriveDriftState, type DriftState } from './drift-state.js'

/** Everything the pane needs, in one immutable value. */
export interface SeeleWorkbenchSnapshot {
  /** Monotonic; every published snapshot has a strictly greater revision than the last. */
  readonly revision: number
  /** The projected source, or null when the document holds no single `seele` fence. */
  readonly source: string | null
  /** Where that fence lives, for diagnostics anchoring (W3/W2.3 use the same block id). */
  readonly region: SourceRegion | null
  /** Why projection failed — the `NoSeeleSource`/`MultipleSeeleSources` message — or null. */
  readonly sourceError: string | null
  /** The last APPLIED report. Never one whose bytes are stale. */
  readonly report: SeeleCompileReport | null
  /** The exact source `report` was compiled from — the drift oracle. */
  readonly compiledSource: string | null
  /** A transport-level failure of the last attempt. A REFUSAL is not one of these. */
  readonly compileError: string | null
  /** The wax seal, or null when there is nothing to seal (see `drift-state.ts`). */
  readonly seal: DriftState | null
}

const EMPTY_SNAPSHOT: SeeleWorkbenchSnapshot = Object.freeze({
  revision: 0,
  source: null,
  region: null,
  sourceError: null,
  report: null,
  compiledSource: null,
  compileError: null,
  seal: null,
})

/**
 * The subscribable the `seele.context.compile` resource adapter returns.
 *
 * It returns the HANDLE, never a snapshot: `DerivedResourceAdapter.compute()`
 * runs once per `acquire()` and the broker never re-runs it, so an adapter
 * that returned a snapshot would produce a pane frozen at mount time (C17).
 * The precedent for a caller-re-evaluated handle is
 * `GridCollectionQueryHandle.run()`.
 */
export interface SeeleWorkbenchReportHandle {
  current(): SeeleWorkbenchSnapshot
  subscribe(listener: (snapshot: SeeleWorkbenchSnapshot) => void): () => void
  /** Broker bookkeeping: one `retain()` per `acquire()`, one `release()` per dispose. Idempotent per call pair. */
  retain(): void
  release(): void
  /** Introspection for tests/diagnostics — never a control surface. */
  readonly subscriberCount: number
  readonly refCount: number
}

export interface SeeleWorkbenchControllerOptions {
  /** The real compile seam. Required — there is no default and no fallback that fabricates a report. */
  readonly compile: SeeleCompiler
  /** Trailing window between the last edit and asking the compiler. Default 400ms. */
  readonly debounceMs?: number
}

export interface SeeleWorkbenchController {
  readonly reportHandle: SeeleWorkbenchReportHandle
  /**
   * Watch one mounted `hoja.document` leaf. Reads its current content
   * immediately (so a document that is already loaded compiles without waiting
   * for a keystroke) and then follows it. Returns a detach function; attaching
   * a second port detaches the first.
   */
  attach(port: HojaDocumentContentPort): () => void
  /** Compile right now, ignoring the debounce window — the explicit-gesture path. */
  compileNow(): Promise<void>
  dispose(): void
}

export function createSeeleWorkbenchController(
  options: SeeleWorkbenchControllerOptions,
): SeeleWorkbenchController {
  const debounceMs = Math.max(0, options.debounceMs ?? 400)
  const compile = options.compile

  const listeners = new Set<(snapshot: SeeleWorkbenchSnapshot) => void>()
  let snapshot: SeeleWorkbenchSnapshot = EMPTY_SNAPSHOT
  let refCount = 0
  let disposed = false

  let detachPort: (() => void) | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let inFlight = false
  let inFlightAbort: AbortController | null = null
  let compileSeq = 0

  // The most recent PROJECTION result, which is what a compile is queued for.
  let currentSource: string | null = null
  let currentRegion: SourceRegion | null = null
  let currentSourceError: string | null = null
  // The last APPLIED verdict.
  let report: SeeleCompileReport | null = null
  let compiledSource: string | null = null
  let compileError: string | null = null

  function publish(): void {
    const next: SeeleWorkbenchSnapshot = Object.freeze({
      revision: snapshot.revision + 1,
      source: currentSource,
      region: currentRegion,
      sourceError: currentSourceError,
      report,
      compiledSource,
      compileError,
      seal: deriveDriftState({ source: currentSource, pending, inFlight, report, compiledSource }),
    })
    snapshot = next
    for (const listener of [...listeners]) {
      try {
        listener(next)
      } catch (error) {
        // A throwing pane must not stop the other panes, and must not wedge
        // the controller's own loop.
        console.error('seele workbench controller: subscriber threw', error)
      }
    }
  }

  function readDocument(json: LiveDocumentJSON | null): void {
    if (disposed) return
    if (json === null) {
      // The pane lost its body (teardown / not live yet). That is not a
      // projection failure and not a compile input — say nothing new about the
      // source, but stop claiming there is one.
      if (currentSource === null && currentSourceError === null) return
      currentSource = null
      currentRegion = null
      currentSourceError = null
      publish()
      return
    }

    let nextSource: string | null = null
    let nextRegion: SourceRegion | null = null
    let nextError: string | null = null
    try {
      const projection = projectSeeleSource(json)
      nextSource = projection.source
      nextRegion = projection.region
    } catch (error) {
      nextError = error instanceof Error ? error.message : String(error)
    }

    const unchanged = nextSource === currentSource && nextError === currentSourceError
    currentSource = nextSource
    currentRegion = nextRegion
    currentSourceError = nextError
    if (unchanged) return

    // A new source (or a newly-broken projection) supersedes any in-flight
    // compile: whatever it answers is about bytes nobody is looking at.
    abortInFlight()
    if (nextSource === null) {
      pending = false
      clearDebounce()
      publish()
      return
    }
    pending = true
    publish()
    scheduleCompile()
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function abortInFlight(): void {
    if (inFlightAbort) {
      inFlightAbort.abort()
      inFlightAbort = null
    }
    // Bump the sequence UNCONDITIONALLY (tranche-1 finding B): a compile whose
    // promise resolved before this abort landed is still queued on the
    // microtask queue holding its old `seq`, and without the bump it would
    // pass the `seq !== compileSeq` guard and be applied as fresh. Aborting
    // means "whatever answers now is about bytes nobody is looking at" —
    // the sequence is how that sentence is enforced, not just the signal.
    compileSeq += 1
    inFlight = false
  }

  function scheduleCompile(): void {
    clearDebounce()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runCompile()
    }, debounceMs)
  }

  async function runCompile(): Promise<void> {
    if (disposed) return
    const source = currentSource
    if (source === null) {
      pending = false
      publish()
      return
    }
    const seq = ++compileSeq
    const abort = new AbortController()
    inFlightAbort = abort
    pending = false
    inFlight = true
    compileError = null
    publish()

    try {
      const result = await compile({ source, signal: abort.signal })
      if (disposed || seq !== compileSeq) return // superseded — discard, never render
      report = result
      compiledSource = source
      compileError = null
    } catch (error) {
      if (disposed || seq !== compileSeq) return
      if (error instanceof Error && error.name === 'AbortError') return
      compileError =
        error instanceof SeeleCompileTransportError
          ? error.message
          : `seele compile failed — ${error instanceof Error ? error.message : String(error)}`
      // The previous report stays as-is; it is still an honest statement about
      // the bytes it was compiled from, and the seal will read `drifted` if
      // those are no longer the bytes on screen.
    } finally {
      if (!disposed && seq === compileSeq) {
        inFlight = false
        inFlightAbort = null
        publish()
      }
    }
  }

  const reportHandle: SeeleWorkbenchReportHandle = {
    current: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retain() {
      refCount += 1
    },
    release() {
      if (refCount > 0) refCount -= 1
      // v1 stub: the CONTROLLER outlives its leases — the app that built it
      // owns its lifetime, and the constitution leaf next door keeps feeding
      // it whether or not a context pane is currently mounted. W14.6's
      // "release the last lease and the handle is disposed" is that
      // workstream's own acceptance, not this slice's; recording the count
      // honestly here is what makes it testable when it lands.
    },
    get subscriberCount() {
      return listeners.size
    },
    get refCount() {
      return refCount
    },
  }

  return {
    reportHandle,
    attach(port) {
      detachPort?.()
      // debounceMs: 0 — the controller owns the trailing window, so the chip
      // can say `typing` the instant a keystroke lands. See this file's header.
      const unsubscribe = port.onChanged(change => readDocument(change.json), { debounceMs: 0 })
      const detach = (): void => {
        unsubscribe()
        if (detachPort === detach) detachPort = null
      }
      detachPort = detach
      // Immediate first read: a document that is already loaded should compile
      // without waiting for someone to type into it.
      readDocument(port.getJSON())
      return detach
    },
    async compileNow() {
      clearDebounce()
      await runCompile()
    },
    dispose() {
      if (disposed) return
      disposed = true
      detachPort?.()
      detachPort = null
      clearDebounce()
      abortInFlight()
      listeners.clear()
    },
  }
}
