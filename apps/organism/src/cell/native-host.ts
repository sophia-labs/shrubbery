/**
 * Is this page the Garden desktop app's own local cell?
 *
 * Tauri puts `__TAURI_INTERNALS__` into every page its webview loads, including a hosted place opened in a Tauri
 * window (the Sophia shell). So the marker alone is not enough: the page must also be served by the app itself
 * (`tauri://localhost`, or `http(s)://tauri.localhost` on Windows and Linux) or by a dev server on the loopback.
 * A hosted page in a native window is a hosted page.
 */

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

interface NativeRoot {
  readonly __TAURI_INTERNALS__?: { readonly invoke?: TauriInvoke }
  readonly location?: { readonly protocol?: string; readonly hostname?: string }
}

const LOCAL_HOSTS = new Set(['tauri.localhost', 'localhost', '127.0.0.1', '[::1]', '::1'])

export function isTauriHost(root: object = globalThis): boolean {
  if (!('__TAURI_INTERNALS__' in root)) return false
  const location = (root as NativeRoot).location
  if (!location) return true
  return location.protocol === 'tauri:' || LOCAL_HOSTS.has(location.hostname ?? '')
}

/** The desktop app's command bridge, only on the desktop app's own pages. */
export function nativeInvoke(root: object = globalThis): TauriInvoke | undefined {
  return isTauriHost(root) ? (root as NativeRoot).__TAURI_INTERNALS__?.invoke : undefined
}
