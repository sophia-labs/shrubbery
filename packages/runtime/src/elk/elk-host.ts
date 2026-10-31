/**
 * The ELK host: one engine for every canvas in this page (plans/2026-10-30-elk-layout/DESIGN.md). elkjs 0.12.0, the
 * same build gardend runs under QuickJS, so a person's layout and Sophia's agree.
 *
 * - In a browser it runs in a module Worker (`elk.worker.ts`, elkjs's own worker script) behind elkjs's `elk-api`,
 *   spawned on first use and shared. A layout past its deadline terminates the Worker; the next layout spawns a fresh one.
 * - Where there is no Worker (Node, happy-dom), or one cannot be made (a CSP that refuses workers), it runs the bundled
 *   elkjs in-thread. In-thread ELK is synchronous, so the deadline there only reports late; it cannot stop the run.
 *
 * Results come back without GWT's `$H` hash ids (the only part of ELK's output that differs between runs).
 */
import { BOARD_LAYOUT_LIMITS, countElkGraph, type ElkNodeJson } from '@shrubbery/nucleus/board-layout'

export interface ElkLayoutOptions {
  /** Stop a layout that runs longer (ms). Default: the presets' `deadlineMs`. */
  readonly deadlineMs?: number
}

export interface ElkHost {
  /** Lay `graph` out. Rejects with an `ElkLayoutError` on a limit, a deadline or an ELK failure. */
  layout(graph: ElkNodeJson, options?: ElkLayoutOptions): Promise<ElkNodeJson>
  /** 'worker' or 'in-thread' once an engine exists, else null. */
  readonly mode: 'worker' | 'in-thread' | null
  /** Stop the engine (a Worker is terminated); the next layout starts a new one. */
  dispose(): void
}

export type ElkLayoutErrorKind = 'limit' | 'deadline' | 'engine'

export class ElkLayoutError extends Error {
  constructor(readonly kind: ElkLayoutErrorKind, message: string) {
    super(message)
    this.name = 'ElkLayoutError'
  }
}

interface ElkEngine {
  layout(graph: unknown): Promise<unknown>
  terminateWorker?(): void
}

type ElkConstructor = new (args?: { workerFactory?: (url?: string) => Worker }) => ElkEngine

/** Remove GWT's `$H` identity hashes from an ELK result, at every depth. */
export function stripElkHashes<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripElkHashes(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) if (key !== '$H') out[key] = stripElkHashes(v)
    return out as T
  }
  return value
}

function moduleDefault<T>(mod: unknown): T {
  const m = mod as { default?: unknown }
  return (m && typeof m === 'object' && 'default' in m ? m.default : mod) as T
}

async function inThreadEngine(): Promise<ElkEngine> {
  const Elk = moduleDefault<ElkConstructor>(await import('elkjs/lib/elk.bundled.js'))
  return new Elk()
}

async function workerEngine(): Promise<ElkEngine | null> {
  if (typeof Worker === 'undefined') return null
  const Elk = moduleDefault<ElkConstructor>(await import('elkjs/lib/elk-api.js'))
  try {
    // The literal `new Worker(new URL(...), ...)` is what Vite rewrites into the built worker chunk.
    return new Elk({ workerFactory: () => new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module', name: 'elk' }) })
  } catch {
    return null
  }
}

export interface ElkHostOptions {
  /** Force the in-thread engine (tests, or a page that must not start workers). */
  readonly inThread?: boolean
}

export function createElkHost(hostOptions: ElkHostOptions = {}): ElkHost {
  let engine: Promise<{ elk: ElkEngine; mode: 'worker' | 'in-thread' }> | null = null
  let mode: 'worker' | 'in-thread' | null = null

  const start = (): Promise<{ elk: ElkEngine; mode: 'worker' | 'in-thread' }> => {
    engine ??= (async () => {
      const worker = hostOptions.inThread ? null : await workerEngine()
      const made = worker ? { elk: worker, mode: 'worker' as const } : { elk: await inThreadEngine(), mode: 'in-thread' as const }
      mode = made.mode
      return made
    })()
    engine.catch(() => { engine = null; mode = null })
    return engine
  }

  const dispose = (): void => {
    const current = engine
    engine = null
    mode = null
    void current?.then(({ elk }) => { try { elk.terminateWorker?.() } catch { /* already gone */ } }, () => {})
  }

  return {
    get mode() { return mode },
    dispose,
    async layout(graph, options = {}) {
      const { nodes, edges } = countElkGraph(graph)
      if (nodes > BOARD_LAYOUT_LIMITS.nodes) throw new ElkLayoutError('limit', `too many shapes to lay out: ${nodes} nodes (the limit is ${BOARD_LAYOUT_LIMITS.nodes})`)
      if (edges > BOARD_LAYOUT_LIMITS.edges) throw new ElkLayoutError('limit', `too many arrows to lay out: ${edges} edges (the limit is ${BOARD_LAYOUT_LIMITS.edges})`)
      const deadlineMs = options.deadlineMs ?? BOARD_LAYOUT_LIMITS.deadlineMs
      let current: { elk: ElkEngine; mode: 'worker' | 'in-thread' }
      try {
        current = await start()
      } catch (error) {
        throw new ElkLayoutError('engine', `the layout engine could not start: ${error instanceof Error ? error.message : String(error)}`)
      }
      // ELK mutates the graph it is given; it gets its own copy.
      const run = current.elk.layout(structuredClone(graph))
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ElkLayoutError('deadline', `the layout took too long (over ${Math.round(deadlineMs / 1000)} s)`)), deadlineMs)
      })
      try {
        const result = await Promise.race([run, late])
        return stripElkHashes(result) as ElkNodeJson
      } catch (error) {
        if (error instanceof ElkLayoutError) {
          // A Worker still computing is stopped; the next layout starts a fresh one.
          if (current.mode === 'worker') dispose()
          throw error
        }
        throw new ElkLayoutError('engine', `the layout failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        run.catch(() => { /* a run abandoned at its deadline settles unobserved */ })
      }
    },
  }
}

let shared: ElkHost | null = null

/** The page's one ELK host. */
export function elkHost(): ElkHost {
  shared ??= createElkHost()
  return shared
}
