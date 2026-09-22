/**
 * boot-fields.ts — shared, PURE boot-config field validation (HIGH-1/HIGH-2).
 *
 * Strict enum validation at every boot input boundary: URL query params
 * (main.ts tier 1), the `/planter.config.json` body (main.ts tier 2),
 * `VITE_PLANTER_*` build-time env vars (main.ts tier 3, the browser), and
 * `PLANTER_*` process env vars (server-boot.ts, the Node server entry).
 * Every unrecognized field value REFUSES, naming the field and the
 * offending value — never a silent default, never an auth downgrade.
 *
 * Pure: no DOM, no network, no node builtins — safe for both `main.ts`
 * (browser) and `server-boot.ts`/`server.ts` (Node) to import without
 * pulling either environment's concerns into the other.
 */

import {
  BootConfigError,
  normalizeGatewayOwnerPrincipal,
  PLANTER_ADAPTERS,
  type PlanterAdapter,
  type PlanterAuth,
} from '@shrubbery/source'

const READ_PATHS = ['mcp', 'sparql'] as const
export type ReadPathValue = (typeof READ_PATHS)[number]

/** Validate an optional cloud-2 owner principal against the gateway's exact
 * PrincipalId grammar. An absent owner remains valid for non-hosted adapters;
 * sourceFromBoot requires it when the adapter is hosted-gateway. */
export function parseOwnerField(raw: unknown, source: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') {
    throw new BootConfigError(
      `${source}: invalid 'owner' value ${JSON.stringify(raw)} — expected a typed gateway principal.`,
    )
  }
  try {
    return normalizeGatewayOwnerPrincipal(raw)
  } catch {
    throw new BootConfigError(
      `${source}: invalid 'owner' value ${JSON.stringify(raw)} — expected ` +
        "'(user|agent|service|organization):<subject>'.",
    )
  }
}

/** Validate an optional code-reviewed SiteBundle registry id. The app-level
 * registry performs existence validation; this boundary pins a safe id shape. */
export function parseBundleField(raw: unknown, source: string): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string' || !/^[a-z][a-z0-9-]*$/.test(raw)) {
    throw new BootConfigError(
      `${source}: invalid 'bundle' value ${JSON.stringify(raw)} — expected a lowercase registry id.`,
    )
  }
  return raw
}

/**
 * Validate an `adapter` field read from an untrusted boundary. `undefined` /
 * `null` / `''` means "not supplied" (→ `undefined`, let inference run);
 * anything else — including a non-string JSON value — must be exactly one
 * of `PLANTER_ADAPTERS`, or this throws naming the field and the offending
 * value VERBATIM (never a silent drop, never an unchecked cast).
 */
export function parseAdapterField(raw: unknown, source: string): PlanterAdapter | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string' || !(PLANTER_ADAPTERS as readonly string[]).includes(raw)) {
    throw new BootConfigError(
      `${source}: unrecognized 'adapter' value ${JSON.stringify(raw)} — one of: ${PLANTER_ADAPTERS.join(', ')}.`,
    )
  }
  return raw as PlanterAdapter
}

/** Same discipline as `parseAdapterField`, for `readPath` ('mcp' | 'sparql'). */
export function parseReadPathField(raw: unknown, source: string): ReadPathValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw !== 'mcp' && raw !== 'sparql') {
    throw new BootConfigError(
      `${source}: unrecognized 'readPath' value ${JSON.stringify(raw)} — one of: mcp, sparql.`,
    )
  }
  return raw
}

/**
 * Build the `PlanterAuth` union from discrete string parts (URL params and
 * env vars are always flat strings). `mode === null` means "the field was
 * ABSENT" (→ `'none'`, the honest default for a truly unspecified boot); a
 * present-but-unrecognized mode string REFUSES rather than silently
 * defaulting to `'none'` — that fallback would be an AUTHENTICATION
 * DOWNGRADE, never acceptable per no-mocks-for-auth discipline. Callers
 * whose auth arrives as a structured (JSON) value must validate ITS shape
 * before reducing it to these flat parts — see `main.ts`'s
 * `bootConfigFromJson` (a malformed `auth` object must throw here, never
 * silently coerce to `mode: null`).
 */
export function authFromParts(
  mode: string | null,
  token: string | null,
  region: string | null,
  clientId: string | null,
  userPoolId: string | null,
  source: string,
): PlanterAuth {
  switch (mode) {
    case null:
    case 'none':
      return { mode: 'none' }
    case 'dev':
      if (!token) throw new BootConfigError(`${source}: auth mode 'dev' requires a 'token'`)
      return { mode: 'dev', token }
    case 'cognito':
      if (!region || !clientId) {
        throw new BootConfigError(`${source}: auth mode 'cognito' requires 'region' and 'clientId'`)
      }
      return { mode: 'cognito', region, clientId, ...(userPoolId ? { userPoolId } : {}) }
    default:
      throw new BootConfigError(
        `${source}: unrecognized auth mode '${mode}' — one of 'none' | 'dev' | 'cognito'`,
      )
  }
}
