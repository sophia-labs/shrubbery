/**
 * The shell's WebAssembly loader for Workers and AudioWorklets.
 *
 * One pattern, three users (the MUS engine in a Worker, Ovillo's bench and its vocal tract in AudioWorklets): the MAIN
 * THREAD fetches the module's bytes (same-origin, one request, the bytes checked to be WebAssembly and, when the host
 * pins one, checked against a SHA-256), then hands them to the Worker or the worklet, which instantiates them itself
 * (`WebAssembly.instantiate(bytes, {})`, no bindgen glue, no imports). So the page never needs `'unsafe-eval'`: the
 * CSP is own-origin scripts, `'wasm-unsafe-eval'` for the instantiation, and `worker-src 'self' blob:`.
 *
 * The handshake every module speaks (the bench's worklet protocol): the host posts `{op: 'wasm', bytes, ...init}`;
 * the module answers `{op: 'ready', info}` or `{op: 'error', message}`. Everything after that is the module's own
 * protocol over the same port; `createWasmRpc` gives request/response by `id` for modules that answer that way.
 */

export class WasmLoadError extends Error {
  constructor(message: string, readonly url?: string) {
    super(message)
    this.name = 'WasmLoadError'
  }
}

export interface FetchWasmOptions {
  readonly signal?: AbortSignal
  /** Hex SHA-256 the bytes must hash to (a pinned build). */
  readonly sha256?: string
  /** The fetch to use (default `globalThis.fetch`). */
  readonly fetch?: typeof fetch
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d]

async function hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Fetch a module's bytes on the main thread; refuse anything that is not WebAssembly (or not the pinned build). */
export async function fetchWasmBytes(url: string | URL, options: FetchWasmOptions = {}): Promise<ArrayBuffer> {
  const href = String(url)
  const doFetch = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await doFetch(href, { signal: options.signal, credentials: 'same-origin' })
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error
    throw new WasmLoadError(`could not fetch ${href}: ${(error as Error)?.message ?? error}`, href)
  }
  if (!response.ok) throw new WasmLoadError(`${href} answered ${response.status} ${response.statusText}`.trim(), href)
  const bytes = await response.arrayBuffer()
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))
  if (head.length < 4 || MAGIC.some((b, i) => head[i] !== b)) {
    throw new WasmLoadError(`${href} is not a WebAssembly module (${bytes.byteLength} bytes, no \\0asm header)`, href)
  }
  if (options.sha256) {
    const got = await hex(bytes)
    if (got !== options.sha256.toLowerCase().replace(/^sha256:/, '')) {
      throw new WasmLoadError(`${href} hashes to sha256:${got}, not the pinned ${options.sha256}`, href)
    }
  }
  return bytes
}

/** What a Worker, a worklet's port, or an in-process stand-in exposes: messages both ways. */
export interface WasmPort {
  postMessage(message: unknown, transfer?: Transferable[]): void
  /** Workers expose `error` too; ports do not. */
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent | Event) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent | Event) => void): void
  start?(): void
}

export interface WasmReady<Info = unknown> {
  readonly info: Info
}

/**
 * Hand `bytes` to a module on `port` and wait for it to say it is ready. The bytes are transferred (the main thread's
 * copy is detached) unless `copy` is set.
 */
export function handOverWasm<Info = unknown>(
  port: WasmPort,
  bytes: ArrayBuffer,
  options: { readonly init?: Record<string, unknown>; readonly copy?: boolean; readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<WasmReady<Info>> {
  return new Promise((resolve, reject) => {
    const payload = options.copy ? bytes.slice(0) : bytes
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = (): void => {
      port.removeEventListener('message', onMessage)
      port.removeEventListener('error', onError)
      options.signal?.removeEventListener('abort', onAbort)
      if (timer) clearTimeout(timer)
    }
    const onMessage = (event: MessageEvent): void => {
      const m = event.data as { op?: string; info?: Info; message?: string } | null
      if (m?.op === 'ready') { done(); resolve({ info: m.info as Info }) }
      else if (m?.op === 'error') { done(); reject(new WasmLoadError(m.message ?? 'the module failed to start')) }
    }
    const onError = (event: ErrorEvent | Event): void => {
      done()
      reject(new WasmLoadError(`the module's script failed: ${(event as ErrorEvent).message ?? 'error'}`))
    }
    const onAbort = (): void => { done(); reject(new DOMException('aborted', 'AbortError')) }
    port.addEventListener('message', onMessage)
    port.addEventListener('error', onError)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.timeoutMs) timer = setTimeout(() => { done(); reject(new WasmLoadError(`the module did not start in ${options.timeoutMs} ms`)) }, options.timeoutMs)
    port.start?.()
    port.postMessage({ ...(options.init ?? {}), op: 'wasm', bytes: payload }, [payload])
  })
}

/**
 * Start a Worker and hand it its module. `create` makes the Worker (an own-origin module script, e.g.
 * `() => new Worker(new URL('./my-worker.ts', import.meta.url), {type: 'module'})`, so the bundler emits it).
 */
export async function startWasmWorker<Info = unknown>(
  create: () => Worker,
  bytes: ArrayBuffer,
  options: { readonly init?: Record<string, unknown>; readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<{ readonly worker: Worker; readonly info: Info }> {
  const worker = create()
  try {
    const { info } = await handOverWasm<Info>(worker as unknown as WasmPort, bytes, options)
    return { worker, info }
  } catch (error) {
    worker.terminate()
    throw error
  }
}

/**
 * Add an AudioWorklet module, make its node, and hand it the bytes (the bench's and the tract's pattern). `moduleUrl`
 * is the worklet's own-origin script.
 */
export async function addWasmWorklet<Info = unknown>(
  context: BaseAudioContext,
  moduleUrl: string | URL,
  processorName: string,
  bytes: ArrayBuffer,
  options: { readonly node?: AudioWorkletNodeOptions; readonly init?: Record<string, unknown>; readonly timeoutMs?: number } = {},
): Promise<{ readonly node: AudioWorkletNode; readonly info: Info }> {
  await context.audioWorklet.addModule(String(moduleUrl))
  const node = new AudioWorkletNode(context, processorName, options.node)
  const port = node.port as unknown as WasmPort
  const { info } = await handOverWasm<Info>(port, bytes, { init: options.init, timeoutMs: options.timeoutMs })
  return { node, info }
}

/** Request/response by `id` over a port whose module answers `{id, ...}`; anything else goes to `onEvent`. */
export interface WasmRpc {
  request<T = unknown>(message: Record<string, unknown>, options?: {
    transfer?: Transferable[]
    /** Every reply for this id that is not final (progress, say). */
    onEvent?: (event: Record<string, unknown>) => void
    /** Which reply ends the request (default: the first). */
    final?: (reply: Record<string, unknown>) => boolean
    /** The id the request goes out with (to cancel it). */
    onId?: (id: number) => void
  }): Promise<T>
  /** Post a message that expects no reply. */
  post(message: Record<string, unknown>): void
  dispose(): void
}

export function createWasmRpc(port: WasmPort): WasmRpc {
  let next = 0
  const waiting = new Map<number, { resolve: (v: unknown) => void; onEvent?: (e: Record<string, unknown>) => void; final: (r: Record<string, unknown>) => boolean }>()
  const onMessage = (event: MessageEvent): void => {
    const m = event.data as Record<string, unknown> | null
    const id = typeof m?.id === 'number' ? m.id : null
    if (id === null) return
    const entry = waiting.get(id)
    if (!entry) return
    if (entry.final(m!)) {
      waiting.delete(id)
      entry.resolve(m)
    } else {
      entry.onEvent?.(m!)
    }
  }
  port.addEventListener('message', onMessage)
  port.start?.()
  return {
    request(message, options = {}) {
      const id = ++next
      options.onId?.(id)
      return new Promise(resolve => {
        waiting.set(id, { resolve: resolve as (v: unknown) => void, onEvent: options.onEvent, final: options.final ?? (() => true) })
        port.postMessage({ ...message, id }, options.transfer ?? [])
      })
    },
    post(message) {
      port.postMessage(message)
    },
    dispose() {
      port.removeEventListener('message', onMessage)
      waiting.clear()
    },
  }
}
