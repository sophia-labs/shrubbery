/**
 * server-boot.ts — the `pnpm serve` Node entry's `PLANTER_*` env-var boot
 * resolution (HIGH-2).
 *
 * The design's own boot-priority table names `PLANTER_ENDPOINT` /
 * `PLANTER_GRAPH` / `PLANTER_OWNER` / `PLANTER_AUTH_MODE` / … "for the server" (§3, tier 3) —
 * the SAME validated-field discipline `main.ts`'s `bootConfigFromEnv` gives
 * the browser's `VITE_PLANTER_*` tier, just Node's `PLANTER_*` names, so
 * `apps/planter/src/server.ts`'s shipped entry point can select ANY of the
 * four adapters (gardend-local / hosted-gateway / sparql / static-nt),
 * never a hardcoded `adapter: 'gardend-local'` fallback baked into the
 * process. Required fields absent → refuses, naming them — no hardcoded
 * fallback endpoint/graph anywhere.
 *
 * Pure (boot-fields.ts is pure); the only Node-specific thing here is which
 * env-var prefix it reads.
 */

import { BootConfigError, type PlanterBootConfig } from '@shrubbery/source'
import {
  authFromParts,
  parseAdapterField,
  parseBundleField,
  parseOwnerField,
  parseReadPathField,
} from './boot-fields.js'

export function bootConfigFromProcessEnv(env: Readonly<Record<string, string | undefined>>): PlanterBootConfig {
  const endpoint = env.PLANTER_ENDPOINT
  const graph = env.PLANTER_GRAPH
  if (!endpoint || !graph) {
    throw new BootConfigError(
      "server boot: 'PLANTER_ENDPOINT' and 'PLANTER_GRAPH' are both required (no hardcoded " +
        `fallback) — got PLANTER_ENDPOINT=${endpoint ? 'set' : 'MISSING'}, ` +
        `PLANTER_GRAPH=${graph ? 'set' : 'MISSING'}.`,
    )
  }
  const auth = authFromParts(
    env.PLANTER_AUTH_MODE ?? null,
    env.PLANTER_AUTH_TOKEN ?? null,
    env.PLANTER_AUTH_REGION ?? null,
    env.PLANTER_AUTH_CLIENT_ID ?? null,
    env.PLANTER_AUTH_USER_POOL_ID ?? null,
    'server env vars',
  )
  const adapter = parseAdapterField(env.PLANTER_ADAPTER, 'server env vars')
  const readPath = parseReadPathField(env.PLANTER_READ_PATH, 'server env vars')
  const bundle = parseBundleField(env.PLANTER_BUNDLE, 'server env vars')
  const owner = parseOwnerField(env.PLANTER_OWNER, 'server env vars')
  const pollMsRaw = env.PLANTER_POLL_MS
  return {
    endpoint,
    graph,
    ...(owner !== undefined ? { owner } : {}),
    auth,
    ...(adapter !== undefined ? { adapter } : {}),
    ...(pollMsRaw ? { pollMs: Number(pollMsRaw) } : {}),
    ...(env.PLANTER_CONFIG_GRAPH_IRI ? { configGraphIri: env.PLANTER_CONFIG_GRAPH_IRI } : {}),
    ...(readPath !== undefined ? { readPath } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  }
}
