/**
 * The MUS check loop: the score as projected from Hoja → the engine's check → one verdict, the newest.
 *
 * The Seele workbench controller's policy (`seele/workbench-controller.ts`), for MUS: a trailing window after the last
 * edit, then a check; every check carries a sequence number, and a verdict that arrives for text that is no longer on
 * screen is DROPPED, never shown (`checkedSource` beside `report` makes "is this about what I'm looking at" a comparison).
 * A projection failure (no ```mus fence, or two) is said as `sourceError`, never checked as empty input. A check that
 * could not run at all (the engine failed to load) is `checkError`; a score with errors is a normal verdict.
 */
import type { MusCheckReport, MusEngine } from '@shrubbery/hoja/mus'

export interface MusCheckSnapshot {
  /** Strictly increasing per published snapshot. */
  readonly revision: number
  readonly source: string | null
  readonly sourceError: string | null
  /** The newest verdict that is about `checkedSource`. */
  readonly report: MusCheckReport | null
  readonly checkedSource: string | null
  /** True when `report` is about the text on screen. */
  readonly current: boolean
  /** An edit is waiting for the window to close. */
  readonly pending: boolean
  readonly checking: boolean
  readonly checkError: string | null
}

export interface MusCheckController {
  /** The score as it stands now (null with `error` when the page holds no single fence). */
  update(source: string | null, error?: string | null): void
  checkNow(): Promise<void>
  current(): MusCheckSnapshot
  subscribe(listener: (snapshot: MusCheckSnapshot) => void): () => void
  dispose(): void
}

export interface MusCheckControllerOptions {
  /** The engine, or a promise of it (checks wait for it; its failure is `checkError`). */
  readonly engine: MusEngine | Promise<MusEngine>
  /** Trailing window between the last edit and the check. Default 250 ms. */
  readonly debounceMs?: number
}

export function createMusCheckController(options: MusCheckControllerOptions): MusCheckController {
  const debounceMs = Math.max(0, options.debounceMs ?? 250)
  const engine = Promise.resolve(options.engine)
  const listeners = new Set<(s: MusCheckSnapshot) => void>()
  let revision = 0
  let source: string | null = null
  let sourceError: string | null = null
  let report: MusCheckReport | null = null
  let checkedSource: string | null = null
  let pending = false
  let checking = false
  let checkError: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0
  let disposed = false
  let snapshot: MusCheckSnapshot = make()

  function make(): MusCheckSnapshot {
    return Object.freeze({
      revision,
      source,
      sourceError,
      report,
      checkedSource,
      current: report !== null && source !== null && checkedSource === source,
      pending,
      checking,
      checkError,
    })
  }

  function publish(): void {
    revision++
    snapshot = make()
    for (const l of [...listeners]) {
      try { l(snapshot) } catch (error) { console.error('mus check controller: a subscriber threw', error) }
    }
  }

  async function run(): Promise<void> {
    if (disposed) return
    if (timer) { clearTimeout(timer); timer = null }
    pending = false
    const text = source
    if (text === null) { publish(); return }
    const mine = ++seq
    checking = true
    publish()
    try {
      const verdict = await (await engine).check(text)
      if (disposed || mine !== seq) return
      report = verdict
      checkedSource = text
      checkError = null
    } catch (error) {
      if (disposed || mine !== seq) return
      checkError = error instanceof Error ? error.message : String(error)
    } finally {
      if (!disposed && mine === seq) {
        checking = false
        publish()
      }
    }
  }

  return {
    update(next, error = null) {
      if (disposed) return
      if (next === source && error === sourceError) return
      source = next
      sourceError = next === null ? error ?? 'no score' : null
      if (timer) clearTimeout(timer)
      if (next === null) {
        pending = false
        publish()
        return
      }
      pending = true
      publish()
      timer = setTimeout(() => { void run() }, debounceMs)
    },
    checkNow: run,
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot)
      return () => listeners.delete(listener)
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      listeners.clear()
    },
  }
}
