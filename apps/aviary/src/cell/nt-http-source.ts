/**
 * nt-http-source.ts — SHELL-SIDE: an `nt-http` TripleSource.
 *
 * THE READ SEAM, implemented for this shell. `@shrubbery/source` ships adapters
 * for gardend, the hosted gateway, a SPARQL endpoint, and a static fossil; none
 * of them fits AVIARY, whose store is a live projection of a directory on disk
 * served over same-origin HTTP. So the shell brings its own adapter — which is
 * exactly the arrangement triple-source.ts's header describes ("a stranger with
 * a plain Oxigraph/Fuseki endpoint can implement this contract"). The library
 * above it never learns that the triples came from a `.nt` response, and this
 * file is the ONLY place in the browser bundle that performs a network call.
 *
 * Contract invariants honored (triple-source.ts):
 *   1. Every read testifies: readAt / graphIri / tripleCount.
 *   2. Both carriers are returned and agree; tripleCount is the PARSED count.
 *   3. EMPTY resolves successfully — an empty projection is a real store state.
 *   4. Capabilities agree with `description`: no SPARQL, no push, so `select`
 *      and `subscribe` are honestly ABSENT rather than throwing stubs.
 *   5. Every failure is a TripleSourceError from the closed taxonomy, carrying
 *      the upstream message verbatim in `detail`.
 *   6. `close()` is idempotent and aborts anything in flight.
 *   7. Liveness is testimony: the projection is regenerated per request, so
 *      liveness is 'poll' and readAt is READ-COMPLETION time (not a fossil's
 *      capture time — this source is not a fossil and must not claim to be).
 */

import { TripleSourceError, parseNT } from '@shrubbery/nucleus'
import type { TripleRead, TripleSource, TripleSourceDescription } from '@shrubbery/nucleus'

export interface NtHttpSourceOptions {
  /**
   * Named-graph IRI → the same-origin path that serves its N-Triples. An
   * EXPLICIT binding, not a URL-mangling convention: the adapter is bound at
   * construction to exactly the graphs it can answer for, and asking for any
   * other graph is a 'not-found', never a speculative request.
   */
  readonly graphs: Readonly<Record<string, string>>
  /** Display-only provenance for the testimony strip. Never a secret. */
  readonly endpoint?: string
  /** The adapter's recommended re-read interval for 'poll' liveness. */
  readonly suggestedPollMs?: number
  /** Injected so tests can drive a real server without a browser global. */
  readonly fetchImpl?: typeof fetch
}

export function ntHttpSource(options: NtHttpSourceOptions): TripleSource {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    throw new TypeError('ntHttpSource: no fetch implementation available')
  }

  const description: TripleSourceDescription = {
    kind: 'nt-http',
    liveness: 'poll',
    sparql: false,
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    ...(options.suggestedPollMs !== undefined ? { suggestedPollMs: options.suggestedPollMs } : {}),
  }

  let controller: AbortController | null = new AbortController()

  async function read(graphIri: string): Promise<TripleRead> {
    const path = options.graphs[graphIri]
    if (path === undefined) {
      throw new TripleSourceError(
        'not-found',
        `nt-http source is bound to [${Object.keys(options.graphs).join(', ')}]; asked to read <${graphIri}>`,
      )
    }
    if (controller === null) {
      throw new TripleSourceError('unavailable', 'nt-http source is closed')
    }

    let response: Response
    try {
      response = await doFetch(path, {
        headers: { Accept: 'application/n-triples' },
        signal: controller.signal,
      })
    } catch (cause) {
      // Network-level failure (offline, DNS, abort). The upstream message is
      // carried verbatim — never rewritten into something reassuring.
      throw new TripleSourceError('unavailable', `nt-http GET ${path} failed`, {
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      })
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new TripleSourceError(codeForStatus(response.status), `nt-http GET ${path} → ${response.status}`, {
        status: response.status,
        detail: body.trim() || response.statusText,
      })
    }

    const nt = await response.text()
    let triples: ReturnType<typeof parseNT>
    try {
      triples = parseNT(nt)
    } catch (cause) {
      // The store answered, but not in the contracted shape.
      throw new TripleSourceError('protocol', `nt-http GET ${path} returned unparsable N-Triples`, {
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      })
    }

    return {
      graphIri,
      readAt: Date.now(), // invariant 7: read-completion time for a live source
      tripleCount: triples.length, // invariant 2: the PARSED count, never a header's claim
      triples,
      nt,
    }
  }

  return {
    description,
    read,
    // select / subscribe: honestly absent (sparql === false, liveness !== 'push')
    close: async () => {
      controller?.abort()
      controller = null
    },
  }
}

function codeForStatus(status: number): 'unauthorized' | 'forbidden' | 'not-found' | 'unavailable' | 'protocol' {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status >= 500) return 'unavailable'
  return 'protocol'
}
