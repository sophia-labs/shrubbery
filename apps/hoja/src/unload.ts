/**
 * Unload-survivable saves. While the page is hidden or unloading, requests
 * small enough for the browser's keepalive budget (64 KiB across in-flight
 * keepalive requests) go out with `keepalive: true`, so a save flushed from
 * `pagehide`/`visibilitychange` is not cancelled by the navigation.
 */
const KEEPALIVE_BODY_LIMIT = 60 * 1024

let leaving = false

export function setPageLeaving(value: boolean): void {
  leaving = value
}

export function withUnloadKeepalive(init: RequestInit): RequestInit {
  if (!leaving || init.keepalive) return init
  const body = init.body
  const size = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : Number.POSITIVE_INFINITY
  return size <= KEEPALIVE_BODY_LIMIT ? { ...init, keepalive: true } : init
}

/** A fetch for GatewayTransport that applies withUnloadKeepalive. */
export function unloadAwareFetch(fetchImpl?: typeof fetch): typeof fetch {
  return (input, init) => {
    const next = init ? withUnloadKeepalive(init) : init
    return fetchImpl ? fetchImpl(input, next) : globalThis.fetch(input, next)
  }
}
