/**
 * vite-bench-cell.ts — the dev-proxy's bench-cell fallback (MED-6), split out
 * of `vite.config.ts` so it is unit-testable without loading Vite itself.
 *
 * `benchCell()` is a FALLBACK for `dynamicCellProxy`, not a second set of
 * defaults: it only resolves an endpoint when the caller EXPLICITLY set
 * `GARDEND_PORT` and `GARDEND_TOKEN`. When the loopback manifest is
 * missing/invalid AND neither env var is set, `dynamicCellProxy` itself
 * surfaces its honest structured 503 (`loopback_manifest_missing` /
 * `loopback_manifest_invalid`) — this function must never guess
 * `127.0.0.1:7090` + `bench-token` and mask that refusal with a fabricated
 * endpoint.
 */
import type { CellProxyEndpoint } from '../../scripts/vite-cell-proxy.js'

/** `undefined` means "this fallback has nothing to say" — the same
 *  absent-not-guessed contract the boot-config tiers use. */
export function benchCell(env: Readonly<Record<string, string | undefined>> = process.env): CellProxyEndpoint | undefined {
  const port = env.GARDEND_PORT
  const token = env.GARDEND_TOKEN
  if (!port || !token) return undefined
  const host = env.GARDEND_HOST ?? '127.0.0.1'
  return { apiUrl: `http://${host}:${port}`, token }
}
