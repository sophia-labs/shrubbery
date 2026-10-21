/**
 * The MUS engine for a page: Ovillo's `mus-wasm` (the browser build of `mus check` and `mus render`, Ariadne Worlds
 * only) in a Worker, behind Hoja's `MusEngine` seam.
 *
 *   const engine = await createMusWasmEngine({ wasm: '/wasm/mus_wasm.wasm' })
 *   const report = await engine.check(score)            // MusCheckReport: diagnostics with spans
 *   const take = await engine.render(score, { onProgress }) // MusTake: audio, WAV, receipt, energy trace
 *
 * The bytes are fetched on the main thread and instantiated in the Worker (`@shrubbery/runtime/wasm`), so the page's CSP
 * needs only `'wasm-unsafe-eval'` and `worker-src 'self' blob:`. A render the checker would refuse (a track that is not
 * an Ariadne World, a fret that disagrees with its pitch) rejects with `MusRenderRefusedError` carrying the report.
 */
import { MusRenderRefusedError, type MusCheckReport, type MusEngine, type MusEnergyTrace, type MusRenderProgress, type MusRenderReceipt, type MusTake } from '@shrubbery/hoja/mus'
import { createWasmRpc, fetchWasmBytes, handOverWasm, startWasmWorker, type WasmPort, type WasmRpc } from '../wasm/loader.js'
import { createMusHost, DEFAULT_STEP_SAMPLES } from './mus-wasm-host.js'

export interface MusEngineInfo {
  readonly engineVersion: string
  readonly sampleRate: number
  readonly anatomies: readonly string[]
  readonly ariadneOnly: boolean
}

export interface MusWasmEngine extends MusEngine {
  readonly info: MusEngineInfo
  dispose(): void
}

export interface MusWasmEngineOptions {
  /** The module: a same-origin URL (fetched on the main thread) or its bytes. */
  readonly wasm: string | URL | ArrayBuffer
  /** Pin the build: the bytes must hash to this SHA-256. */
  readonly sha256?: string
  /** Make the Worker (default: this package's `mus-worker.ts`, emitted by the bundler as an own-origin module worker). */
  readonly worker?: () => Worker
  /** Run the engine on this port instead of a Worker (`createInProcessMusPort()` in tests and Node). */
  readonly port?: WasmPort
  /** World samples per step (default 12 000, a quarter second): how often progress arrives and a cancel is heard. */
  readonly stepSamples?: number
  readonly signal?: AbortSignal
}

export function defaultMusWorker(): Worker {
  return new Worker(new URL('./mus-worker.ts', import.meta.url), { type: 'module', name: 'mus-wasm' })
}

/**
 * A port that runs the engine host in this thread: the same messages a Worker gets, the real engine, no thread. For
 * tests and Node; a page should use the Worker so a render does not hold the main thread.
 */
export function createInProcessMusPort(): WasmPort & { terminate(): void } {
  const listeners = new Set<(event: MessageEvent) => void>()
  let closed = false
  const deliver = (data: unknown): void => {
    if (closed) return
    const event = { data } as MessageEvent
    setTimeout(() => { for (const l of [...listeners]) l(event) }, 0)
  }
  const host = createMusHost(message => deliver(message))
  return {
    postMessage(message) { if (!closed) setTimeout(() => { void host.handle(message) }, 0) },
    addEventListener(type: 'message' | 'error', listener: (event: never) => void) { if (type === 'message') listeners.add(listener as (event: MessageEvent) => void) },
    removeEventListener(type: 'message' | 'error', listener: (event: never) => void) { if (type === 'message') listeners.delete(listener as (event: MessageEvent) => void) },
    terminate() { closed = true; listeners.clear() },
  } as WasmPort & { terminate(): void }
}

interface Reply {
  readonly op: string
  readonly id: number
  readonly [key: string]: unknown
}

export async function createMusWasmEngine(options: MusWasmEngineOptions): Promise<MusWasmEngine> {
  const bytes = options.wasm instanceof ArrayBuffer
    ? options.wasm.slice(0)
    : await fetchWasmBytes(options.wasm, { sha256: options.sha256, signal: options.signal })
  let terminate: () => void
  let port: WasmPort
  let info: MusEngineInfo
  if (options.port) {
    port = options.port
    info = (await handOverWasm<MusEngineInfo>(port, bytes, { signal: options.signal })).info
    terminate = () => (port as { terminate?: () => void }).terminate?.()
  } else {
    const started = await startWasmWorker<MusEngineInfo>(options.worker ?? defaultMusWorker, bytes, { signal: options.signal })
    port = started.worker as unknown as WasmPort
    info = started.info
    terminate = () => started.worker.terminate()
  }
  const rpc: WasmRpc = createWasmRpc(port)
  const stepSamples = options.stepSamples ?? DEFAULT_STEP_SAMPLES
  let disposed = false

  const abortError = (): DOMException => new DOMException('aborted', 'AbortError')

  return {
    info,
    async check(source, opts = {}) {
      if (disposed) throw new Error('the MUS engine is disposed')
      if (opts.signal?.aborted) throw abortError()
      const reply = await rpc.request<Reply>({ op: 'check', source })
      if (opts.signal?.aborted) throw abortError()
      if (reply.op !== 'checked') throw new Error(String(reply.error ?? 'the check failed'))
      return reply.report as MusCheckReport
    },
    async render(source, opts = {}) {
      if (disposed) throw new Error('the MUS engine is disposed')
      if (opts.signal?.aborted) throw abortError()
      let id = 0
      const onAbort = (): void => rpc.post({ op: 'cancel', id })
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const reply = await rpc.request<Reply>({ op: 'render', source, stepSamples }, {
          onId: value => { id = value },
          final: m => m.op !== 'progress',
          onEvent: m => {
            const done = Number(m.done) || 0
            const total = Number(m.total) || 0
            const progress: MusRenderProgress = { done, total, fraction: total > 0 ? done / total : 0, elapsedSeconds: Number(m.elapsedSeconds) || 0 }
            opts.onProgress?.(progress)
          },
        })
        switch (reply.op) {
          case 'rendered':
            return {
              source,
              sampleRate: Number(reply.sampleRate),
              frames: Number(reply.frames),
              left: reply.left as Float32Array,
              right: reply.right as Float32Array,
              wav: reply.wav as Uint8Array,
              receipt: reply.receipt as MusRenderReceipt,
              energy: reply.energy as MusEnergyTrace,
            } satisfies MusTake
          case 'refused':
            throw new MusRenderRefusedError(reply.report as MusCheckReport)
          case 'cancelled':
            throw abortError()
          default:
            throw new Error(String(reply.error ?? 'the render failed'))
        }
      } finally {
        opts.signal?.removeEventListener('abort', onAbort)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      rpc.dispose()
      terminate()
    },
  }
}
