/**
 * The MUS engine's Worker: `mus-wasm` instantiated here from the bytes the main thread fetched (`@shrubbery/runtime/wasm`),
 * answering check and render requests (`mus-wasm-host.ts`). A module worker, own-origin, no imports into the wasm.
 */
import { createMusHost } from './mus-wasm-host.js'

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}
const host = createMusHost((message, transfer) => scope.postMessage(message, transfer ?? []))
scope.addEventListener('message', event => { void host.handle(event.data) })
