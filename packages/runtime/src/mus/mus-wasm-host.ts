/**
 * The MUS engine's side of the Worker: it instantiates Ovillo's `mus-wasm` from the bytes the main thread hands it and
 * answers check and render requests over messages. Pure message-in/message-out, so the same host runs in a Worker
 * (`mus-worker.ts`) and in process (`createInProcessMusPort`, for tests and for Node), with the real engine either way.
 *
 * Protocol (after the loader's `{op: 'wasm', bytes}` / `{op: 'ready', info}` handshake):
 *   {op: 'check', id, source}                → {op: 'checked', id, report}
 *   {op: 'render', id, source, stepSamples?} → {op: 'progress', id, done, total, elapsedSeconds}…
 *                                              then {op: 'rendered', id, receipt, energy, sampleRate, frames, left, right, wav}
 *                                              (the three buffers transferred), or {op: 'refused', id, report},
 *                                              or {op: 'failed', id, error}, or {op: 'cancelled', id}
 *   {op: 'cancel', id}                       → the render stops at its next step
 * The render yields between steps, so a check (or a cancel) asked for meanwhile is answered between them.
 */

/** The C ABI `mus-wasm` exports (see its crate doc). */
export interface MusWasmExports {
  readonly memory: WebAssembly.Memory
  mus_input_ptr(len: number): number
  mus_text_ptr(): number
  mus_text_len(): number
  mus_info(): number
  mus_check(len: number): number
  mus_render_begin(len: number): number
  mus_render_total(): number
  mus_render_done(): number
  mus_render_step(samples: number): number
  mus_render_finish(wallSeconds: number): number
  mus_render_frames(): number
  mus_render_samples_ptr(): number
  mus_render_wav_ptr(): number
  mus_render_wav_len(): number
  mus_render_energy(): number
  mus_render_reset(): void
}

export const DEFAULT_STEP_SAMPLES = 12_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const now = (): number => (globalThis.performance?.now ? globalThis.performance.now() : Date.now())
const yieldToMessages = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** A thin, typed face over the exports. Every view is taken after the call that may have grown memory. */
export class MusWasm {
  constructor(readonly x: MusWasmExports) {}

  static async instantiate(bytes: ArrayBuffer | Uint8Array): Promise<MusWasm> {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {})
    const x = instance.exports as unknown as MusWasmExports
    for (const name of ['mus_check', 'mus_render_begin', 'mus_render_step', 'mus_text_len'] as const) {
      if (typeof x[name] !== 'function') throw new Error(`this module is not mus-wasm (no ${name} export)`)
    }
    return new MusWasm(x)
  }

  text(): string {
    return decoder.decode(new Uint8Array(this.x.memory.buffer, this.x.mus_text_ptr(), this.x.mus_text_len()))
  }

  json<T = unknown>(): T {
    return JSON.parse(this.text()) as T
  }

  put(source: string): number {
    const bytes = encoder.encode(source)
    const ptr = this.x.mus_input_ptr(bytes.length)
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes)
    return bytes.length
  }

  info(): unknown {
    this.x.mus_info()
    return this.json()
  }

  check(source: string): unknown {
    this.x.mus_check(this.put(source))
    return this.json()
  }
}

type Post = (message: Record<string, unknown>, transfer?: Transferable[]) => void

export interface MusHost {
  handle(message: unknown): Promise<void>
}

export function createMusHost(post: Post): MusHost {
  let wasm: MusWasm | null = null
  let rendering: number | null = null
  const cancelled = new Set<number>()

  async function render(id: number, source: string, stepSamples: number): Promise<void> {
    if (!wasm) return post({ op: 'failed', id, error: 'the engine is not loaded' })
    if (rendering !== null) return post({ op: 'failed', id, error: 'a render is already running' })
    const x = wasm.x
    rendering = id
    const started = now()
    try {
      const rc = x.mus_render_begin(wasm.put(source))
      if (rc === 1) return post({ op: 'refused', id, report: wasm.json() })
      if (rc !== 0) return post({ op: 'failed', id, error: (wasm.json<{ error?: string }>().error) ?? `render_begin returned ${rc}` })
      const total = x.mus_render_total()
      post({ op: 'progress', id, done: 0, total, elapsedSeconds: 0 })
      let state = 0
      while (state === 0) {
        await yieldToMessages()
        if (cancelled.has(id)) {
          x.mus_render_reset()
          return post({ op: 'cancelled', id })
        }
        state = x.mus_render_step(stepSamples)
        post({ op: 'progress', id, done: x.mus_render_done(), total, elapsedSeconds: (now() - started) / 1000 })
      }
      if (state !== 1) return post({ op: 'failed', id, error: wasm.json<{ error?: string }>().error ?? 'the render failed' })
      if (x.mus_render_finish((now() - started) / 1000) !== 0) {
        return post({ op: 'failed', id, error: wasm.json<{ error?: string }>().error ?? 'the render could not finish' })
      }
      const receipt = wasm.json()
      const frames = x.mus_render_frames()
      const left = new Float32Array(frames)
      const right = new Float32Array(frames)
      const interleaved = new Float32Array(x.memory.buffer, x.mus_render_samples_ptr(), frames * 2)
      for (let i = 0, j = 0; i < frames; i++, j += 2) {
        left[i] = interleaved[j]!
        right[i] = interleaved[j + 1]!
      }
      const wav = new Uint8Array(x.memory.buffer, x.mus_render_wav_ptr(), x.mus_render_wav_len()).slice()
      x.mus_render_energy()
      const energy = wasm.json()
      x.mus_render_reset()
      post({ op: 'rendered', id, receipt, energy, sampleRate: 48_000, frames, left, right, wav }, [left.buffer, right.buffer, wav.buffer])
    } catch (error) {
      try { x.mus_render_reset() } catch { /* the instance may be gone */ }
      post({ op: 'failed', id, error: error instanceof Error ? error.message : String(error) })
    } finally {
      rendering = null
      cancelled.delete(id)
    }
  }

  return {
    async handle(raw) {
      const m = (raw ?? {}) as { op?: string; id?: number; bytes?: ArrayBuffer; source?: string; stepSamples?: number }
      switch (m.op) {
        case 'wasm':
          try {
            wasm = await MusWasm.instantiate(m.bytes!)
            post({ op: 'ready', info: wasm.info() })
          } catch (error) {
            post({ op: 'error', message: error instanceof Error ? error.message : String(error) })
          }
          return
        case 'check':
          if (!wasm) return post({ op: 'failed', id: m.id, error: 'the engine is not loaded' })
          try {
            post({ op: 'checked', id: m.id, report: wasm.check(m.source ?? '') })
          } catch (error) {
            post({ op: 'failed', id: m.id, error: error instanceof Error ? error.message : String(error) })
          }
          return
        case 'render':
          return render(m.id!, m.source ?? '', Math.max(128, Math.floor(m.stepSamples ?? DEFAULT_STEP_SAMPLES)))
        case 'cancel':
          if (typeof m.id === 'number' && rendering === m.id) cancelled.add(m.id)
          return
        default:
          return
      }
    },
  }
}
