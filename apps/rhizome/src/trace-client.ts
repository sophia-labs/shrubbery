/**
 * trace-client.ts — the BROWSER-side reader for the WALK surface.
 *
 * The browser SPA can't read files; the WALK's trace files are served same-origin
 * by the vite `/traces` dev middleware (see vite.config.ts), which reads the runs
 * dir SERVER-SIDE with the SAME TraceWorld the conneg server uses. This client is
 * the thin fetch wrapper the app shell drives — it returns the EXACT pure
 * @shrubbery/render WALK resource shapes (WalkIndexResource / WalkResource) the
 * middleware emits, so the browser code path matches the server's render input.
 *
 * NO MOCK: an unreachable middleware / a missing run is surfaced honestly (a
 * thrown error / a null), never a faked resource. Mirrors the GardenClient split:
 * the data layer reads live, the views render whatever resource they are handed.
 */

import type { WalkIndexResource, WalkResource } from '@shrubbery/render'

/** The same-origin base for the trace middleware (default '/traces'). */
export class TraceClient {
  constructor(private readonly base = '/traces') {}

  /** GET /traces → the WALK INDEX (the list of runs). */
  async walk(): Promise<WalkIndexResource> {
    const res = await fetch(this.base)
    if (!res.ok) throw new Error(`trace index: HTTP ${res.status}`)
    return (await res.json()) as WalkIndexResource
  }

  /** GET /traces/{runId} (+ ?turn=N) → ONE run's WALK, or null when absent (404). */
  async trace(runId: string, turn: number | null = null): Promise<WalkResource | null> {
    const q = turn === null ? '' : `?turn=${encodeURIComponent(String(turn))}`
    const res = await fetch(`${this.base}/${encodeURIComponent(runId)}${q}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`trace ${runId}: HTTP ${res.status}`)
    return (await res.json()) as WalkResource
  }
}
