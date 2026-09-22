/**
 * wait-healthy.ts — poll a cell's unauthenticated /health route until it is up.
 *
 * HOISTED from apps/rhizome/src/garden-client.ts:124-142 @ b2f408e — rhizome's
 * copy stays app-local; @shrubbery/source is the sole external
 * adapter-consumption convention.
 *
 * /health is unauthenticated, so the plain global fetch is safe here in BOTH
 * environments (the Node-25 undici defect drops the Authorization header on
 * loopback POSTs — /health carries no Authorization and is a GET).
 */

export interface WaitHealthyOptions {
  /** Give-up deadline (default 30 s). */
  readonly timeoutMs?: number
  /** Poll interval (default 250 ms). */
  readonly intervalMs?: number
}

/** Poll `${baseUrl}/health` until 2xx or the deadline elapses (then throws). */
export async function waitHealthy(baseUrl: string, opts: WaitHealthyOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const intervalMs = opts.intervalMs ?? 250
  const base = baseUrl.replace(/\/$/, '')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.status >= 200 && res.status < 300) return
    } catch {
      // not up yet — keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`gardend not healthy at ${base}/health within ${timeoutMs}ms`)
}
