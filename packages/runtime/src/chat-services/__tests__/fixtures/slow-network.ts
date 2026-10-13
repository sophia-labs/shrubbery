/**
 * Two ways the network misbehaves, as a `fetch` the service under test is given (NO MOCKS:
 * both run the REAL `fetch` over the real socket against the real scripted host; only what
 * the caller is told, and when, is changed).
 *
 *   - `holdingResponse`: the host gets the request and acts on it at once, and the
 *     answer is held back until the test lets it go. A slow network, made exact: what
 *     happens at the host between the request and its answer is what a test is about.
 *   - `losingResponse`: the host gets the request and acts on it, and the caller is told the
 *     connection dropped. A launch whose answer was lost.
 *
 * `match` decides which requests are touched; every other request passes untouched.
 */

export interface SentRequest {
  readonly url: URL
  readonly method: string
}

export type RequestMatcher = (request: SentRequest) => boolean

function describe(input: RequestInfo | URL, init?: RequestInit): SentRequest {
  const request = input instanceof Request ? input : undefined
  return {
    url: new URL(request ? request.url : String(input)),
    method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
  }
}

export interface HoldingResponse {
  readonly fetchImpl: typeof fetch
  /** Hold the answers of matching requests from now on (until {@link release}). */
  arm(): void
  /** Resolves once a held request has reached the host and its answer is being held. */
  readonly reached: Promise<void>
  /** Let every held answer through, and hold none after. */
  release(): void
}

export function holdingResponse(match: RequestMatcher, options: { armed?: boolean } = {}): HoldingResponse {
  let armed = options.armed ?? false
  let open!: () => void
  const released = new Promise<void>(resolve => { open = resolve })
  let reach!: () => void
  const reached = new Promise<void>(resolve => { reach = resolve })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await globalThis.fetch(input, init)
    if (armed && match(describe(input, init))) {
      reach()
      await released
    }
    return response
  }) as typeof fetch
  return {
    fetchImpl,
    arm: () => { armed = true },
    reached,
    release: () => { armed = false; open() },
  }
}

/** The host takes the request; the caller is told the connection dropped. */
export function losingResponse(match: RequestMatcher): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await globalThis.fetch(input, init)
    if (!match(describe(input, init))) return response
    await response.body?.cancel().catch(() => undefined)
    throw new TypeError('network connection lost')
  }) as typeof fetch
}
