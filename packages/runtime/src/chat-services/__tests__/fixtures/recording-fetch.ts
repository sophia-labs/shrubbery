/**
 * A `fetch` that writes down what the service under test BUILT, and then hands the
 * request to the real one (NO MOCKS: nothing here answers, decides or changes a request;
 * the real `fetch` still runs, over a real socket, against the real scripted host).
 *
 * WHY IT EXISTS. happy-dom's `fetch` is not a browser's: it drops `Authorization` from a
 * cross-origin request before the request reaches the socket, so a scripted server can
 * never tell a test that a request carried the person's token, whatever the service did.
 * (Nor does the fix belong in the service: `credentials: 'include'` would send the
 * person's cookies to a gateway that has no use for them.) What the service built is what a
 * test can hold it to, and this is where it is read: the headers it gave `fetch`, and the
 * credentials mode and cache policy it asked for.
 */

export interface RecordedRequest {
  readonly url: URL
  readonly method: string
  /** The headers exactly as the service gave them to `fetch`, names lower-cased. */
  readonly headers: Headers
  readonly credentials: RequestCredentials | undefined
  readonly cache: RequestCache | undefined
}

export interface RecordingFetch {
  /** Hand this to the service as `fetchImpl`. */
  readonly fetchImpl: typeof fetch
  /** Every request the service made through it, in order. */
  readonly requests: RecordedRequest[]
  /** The requests to one path (the path alone: no origin, no query). */
  to(pathname: string, method?: string): RecordedRequest[]
}

/** Wrap the real `fetch` (the environment's, looked up when a request is made, not now). */
export function recordingFetch(): RecordingFetch {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined
    requests.push({
      url: new URL(request ? request.url : String(input)),
      method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers ?? request?.headers),
      credentials: init?.credentials ?? request?.credentials,
      cache: init?.cache ?? request?.cache,
    })
    return globalThis.fetch(input, init)
  }) as typeof fetch
  return {
    fetchImpl,
    requests,
    to: (pathname, method) =>
      requests.filter(item => item.url.pathname === pathname && (method === undefined || item.method === method.toUpperCase())),
  }
}
