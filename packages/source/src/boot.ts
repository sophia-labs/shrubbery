/**
 * boot.ts — PlanterBootConfig (R8) + sourceFromBoot, the one adapter factory.
 *
 * REFUSAL SEMANTICS (Design 3, grafted by J2+J3; the D2 URI-scheme grammar is
 * vetoed): the explicit `adapter` field ALWAYS wins; exactly TWO inference
 * rules exist —
 *
 *   1. `endpoint` starting 'static:'      → 'static-nt'
 *   2. `auth.mode === 'cognito'`          → 'hosted-gateway'
 *
 * — and ANY other adapter-less config is refused with a config error naming
 * the `adapter` field. A wrong guess against real infrastructure is a lie;
 * `auth.mode:'none'` against a gateway produces an honest 401 →
 * 'unauthorized', never a silent downgrade.
 *
 * Adapter modules land across build units (gardend-local → U4, sparql → U6,
 * hosted-gateway → U7 — ALL FOUR now in the tree; the switch below is fully
 * wired, no not-wired throws remain).
 */

import { type TripleSource, uxConfigGraphIri } from '@shrubbery/nucleus'
import { createAuthProvider } from './auth.js'
import { staticNtSource } from './fossil/fossil-source.js'
import { createGardendLocalSource } from './gardend/gardend-source.js'
import { createHostedGatewaySource } from './gateway/gateway-source.js'
import { sparqlSource } from './sparql/sparql-source.js'
import { isNodeRuntime } from './transport/mcp-client.js'

// ── The R8 boot triple + auth union ──────────────────────────────────────────

export type PlanterAuth =
  | { readonly mode: 'dev'; readonly token: string }
  | {
      readonly mode: 'cognito'
      readonly region: string
      readonly clientId: string
      readonly userPoolId?: string
    }
  | { readonly mode: 'none' }

export const PLANTER_ADAPTERS = ['gardend-local', 'hosted-gateway', 'sparql', 'static-nt'] as const
export type PlanterAdapter = (typeof PLANTER_ADAPTERS)[number]

export interface PlanterBootConfig {
  /** gateway base | loopback base or '/cell' | SPARQL URL | 'static:<path-or-url>'. */
  readonly endpoint: string
  readonly graph: string
  /** Exact typed cloud-2 owner (`user:…`, `agent:…`, `service:…`, or
   * `organization:…`). Required when adapter resolves to hosted-gateway. */
  readonly owner?: string
  readonly auth: PlanterAuth
  /** Explicit adapter — ALWAYS wins over inference. */
  readonly adapter?: PlanterAdapter
  /** hosted only; DEFAULT 'sparql' (least-privilege Viewer path, design §2.7). */
  readonly readPath?: 'mcp' | 'sparql'
  /** Override for non-Mnemosyne stores; default uxConfigGraphIri(graph). */
  readonly configGraphIri?: string
  /** Default: the adapter's suggestedPollMs; 'static' ignores it. */
  readonly pollMs?: number
  /** Optional code-reviewed SiteBundle id consumed by the generic host. The
   * source factory deliberately carries but does not interpret this field. */
  readonly bundle?: string
}

/** A boot config the factory refuses to act on (honest, names the field). */
export class BootConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BootConfigError'
  }
}

/** The named graph a planter host reads for this boot config. */
export function bootGraphIri(config: PlanterBootConfig): string {
  return config.configGraphIri ?? uxConfigGraphIri(config.graph)
}

// ── Adapter resolution: explicit wins; exactly two inference rules ───────────

export function resolveAdapter(config: PlanterBootConfig): PlanterAdapter {
  if (config.adapter !== undefined) {
    // BOUNDARY VALIDATION (HIGH-1): `config.adapter`'s TYPE says PlanterAdapter,
    // but any caller that built this config from an untrusted string (a URL
    // param, a JSON body field, an env var) may have bypassed the type system
    // with a cast — this is the runtime boundary that catches it. Never trust
    // an explicit adapter value unchecked; a wrong guess against real
    // infrastructure is a lie.
    if (!(PLANTER_ADAPTERS as readonly string[]).includes(config.adapter)) {
      throw new BootConfigError(
        `sourceFromBoot: unrecognized 'adapter' value '${String(config.adapter)}' — ` +
          `one of: ${PLANTER_ADAPTERS.join(', ')}.`,
      )
    }
    return config.adapter
  }
  if (config.endpoint.startsWith('static:')) return 'static-nt'
  if (config.auth.mode === 'cognito') return 'hosted-gateway'
  throw new BootConfigError(
    `sourceFromBoot: cannot infer an adapter for endpoint '${config.endpoint}' with ` +
      `auth.mode '${config.auth.mode}' — set the 'adapter' field explicitly ` +
      `(one of: ${PLANTER_ADAPTERS.join(', ')}). Only two inference rules exist: ` +
      "an endpoint starting 'static:' infers 'static-nt', and auth.mode 'cognito' " +
      "infers 'hosted-gateway'. A wrong guess against real infrastructure is a lie.",
  )
}

// ── Construction ─────────────────────────────────────────────────────────────

/** Load the body a 'static:<path-or-url>' endpoint points at.
 *  http(s) URL → fetch (both environments); anything else is a file path in
 *  Node (guarded dynamic node:fs import — the organism-proven pattern that
 *  keeps node builtins out of the browser bundle) or a same-origin URL path
 *  in the browser. */
async function loadStaticBody(ref: string): Promise<string> {
  if (/^https?:\/\//i.test(ref)) {
    const res = await fetch(ref)
    if (!res.ok) {
      throw new BootConfigError(`static fossil fetch failed: HTTP ${res.status} for ${ref}`)
    }
    return res.text()
  }
  if (isNodeRuntime) {
    const fs = await import('node:fs/promises')
    return fs.readFile(ref, 'utf8')
  }
  // Browser: treat as a same-origin URL path (e.g. '/fossils/site.nt').
  const res = await fetch(ref)
  if (!res.ok) {
    throw new BootConfigError(`static fossil fetch failed: HTTP ${res.status} for ${ref}`)
  }
  return res.text()
}

/**
 * Build the TripleSource a boot config describes. Every adapter branch is
 * fully wired: the static-nt branch's fossil provenance comes from the v1
 * header (construction without capture provenance is refused by
 * staticNtSource itself).
 */
export async function sourceFromBoot(config: PlanterBootConfig): Promise<TripleSource> {
  const adapter = resolveAdapter(config)
  switch (adapter) {
    case 'static-nt': {
      const ref = config.endpoint.startsWith('static:')
        ? config.endpoint.slice('static:'.length)
        : config.endpoint
      const body = await loadStaticBody(ref)
      return staticNtSource(body)
    }
    case 'gardend-local': {
      // Landed by U4 (§2.5). endpoint = loopback base (http://127.0.0.1:<port>)
      // or the browser's same-origin '/cell'; the MCP route is `${base}/mcp`.
      // Token only in 'dev' mode — the browser /cell proxy injects the bearer
      // server-side; 'none' against a token-guarded loopback yields an honest
      // 401 → 'unauthorized', never a silent downgrade.
      const base = config.endpoint.replace(/\/$/, '')
      return createGardendLocalSource({
        mcpUrl: `${base}/mcp`,
        ...(config.auth.mode === 'dev' ? { token: config.auth.token } : {}),
        graphId: config.graph,
        ...(config.pollMs !== undefined ? { suggestedPollMs: config.pollMs } : {}),
      })
    }
    case 'sparql':
      // Landed by U6 (§2.8). endpoint = the SPARQL 1.1 Protocol query URL.
      // 'dev' rides as a plain bearer header; 'none' sends nothing — an
      // auth-guarded endpoint answers honestly (401 → 'unauthorized').
      // 'cognito' credential machinery is hosted-gateway's (U7): with an
      // explicit 'sparql' adapter no header is fabricated from it.
      return sparqlSource({
        endpoint: config.endpoint,
        graphIri: bootGraphIri(config),
        ...(config.auth.mode === 'dev'
          ? { headers: { authorization: `Bearer ${config.auth.token}` } }
          : {}),
        ...(config.pollMs !== undefined ? { suggestedPollMs: config.pollMs } : {}),
      })
    case 'hosted-gateway':
      // Landed by U7 (§2.7). endpoint = the gateway root. readPath defaults
      // 'sparql' (Viewer-eligible POST /api/sparql/query); 'mcp' is an
      // explicit opt-in that costs Editor today. The auth union's 'cognito'
      // arm names a user pool, not a signed-in identity — a signed-out
      // CognitoAuthSession sends no token and the gateway answers honestly
      // (401 → 'unauthorized').
      if (!config.owner) {
        throw new BootConfigError(
          "sourceFromBoot: hosted-gateway requires the exact 'owner' field; " +
            "an ownerless graph slug would fall back to the ambiguous legacy '/g/{graph}' route",
        )
      }
      return createHostedGatewaySource({
        endpoint: config.endpoint,
        graph: config.graph,
        owner: config.owner,
        auth: createAuthProvider(config.auth),
        readPath: config.readPath ?? 'sparql',
        ...(config.pollMs !== undefined ? { suggestedPollMs: config.pollMs } : {}),
      })
    default: {
      // Defense in depth (HIGH-1): resolveAdapter already validates against
      // PLANTER_ADAPTERS above, so this is unreachable through this module's
      // own API — but sourceFromBoot is a public @shrubbery/source export,
      // and a caller who bypasses resolveAdapter (or the type system, via a
      // cast) must still hit a named refusal here, never fall through and
      // resolve `undefined`.
      throw new BootConfigError(
        `sourceFromBoot: unrecognized adapter '${String(adapter)}' — one of: ` +
          `${PLANTER_ADAPTERS.join(', ')}.`,
      )
    }
  }
}
