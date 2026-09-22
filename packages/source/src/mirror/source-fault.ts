/**
 * source-fault.ts — the closed, machine-readable source-authority fault
 * taxonomy and the client's code-first, regex-fallback detection ladder
 * (master spec §2.2, §3 Slice 3; WS4 `04-garden-gateway-contract.md` §4.2.7;
 * WS2 `02-shell-wayfinding-resolution.md` §4.2b/§6.5; WS3
 * `03-fence-parked-reapply.md` §4.2).
 *
 * ONE classifier, ONE alphabet, three sections that used to disagree:
 *   - WS2's `classifyPushRejection` (7 kebab-case codes) survives only as a
 *     thin adapter over this module, adding targeted-operation-id extraction
 *     (built in `source-mirror.ts`, not here — master §2.2).
 *   - WS3's `packages/source/src/mirror/source-errors.ts` (6 kebab-case
 *     codes) is NOT BUILT. Its two exported names survive as thin helpers
 *     here: `classifySourceError(error) ≡ classifySourceFault(error).code`
 *     is not itself re-exported (nothing in this program's slices consumes
 *     it by that name — WS3's own callers are told to call
 *     `classifySourceFault(error).code` directly, master §2.2), and
 *     `sourceErrorTestimony(error)` IS exported below.
 *   - This module wins outright: it owns the Rust side (snake_case is
 *     inherited from `app_error_codes.rs`/`fault_codes.rs`, not invented),
 *     it is the only one with a three-way cross-repo parity instrument
 *     (`../../tests/fault-code-parity.test.ts`), and it is the only one that
 *     classifies retry disposition, which is what every caller actually
 *     needs.
 *
 * Wire-compat is additive: an authority older than this taxonomy carries no
 * `code` field anywhere, rung 1/2 miss, rung 3's legacy regexes (verbatim
 * copies of the three sites this module replaces) still fire, and
 * `origin: 'regex'` is the census signal for when rung 3 can retire.
 */

/** The cell/gateway fault taxonomy, mirrored exactly. Parity-tested against
 *  Garden's `app_error_codes::ALL` AND the gateway's own `fault_codes::ALL`
 *  (`../../tests/fault-code-parity.test.ts` — three-way, not two-way). */
export const SOURCE_FAULT_CODES = [
  'stale_graph_incarnation',
  'stale_document_incarnation',
  'document_exists',
  'document_tombstoned',
  'recreate_boundary_mismatch',
  'stale_sync_conflict',
  'causal_cycle',
  'operation_id_reused',
  'event_identity_reused',
  'ledger_integrity',
  'object_not_found',
  'graph_exists',
  'graph_lifecycle_identity_mismatch',
  'graph_incarnation_unconfirmable',
  'quota_exceeded',
  'rate_limited',
  'at_capacity',
] as const

export type SourceFaultCode = (typeof SOURCE_FAULT_CODES)[number]

const SOURCE_FAULT_CODE_SET: ReadonlySet<string> = new Set(SOURCE_FAULT_CODES)

/** Codes that mean "this lifetime moved on without you" — the Law VI fence.
 *  `stale_sync_conflict` is deliberately NOT here (it is a Law IV object
 *  contest, not a fence); `document_exists` is deliberately NOT here either —
 *  it is permanent but not a fence. */
export const FENCE_CODES: readonly SourceFaultCode[] = [
  'stale_graph_incarnation',
  'graph_lifecycle_identity_mismatch',
  'graph_incarnation_unconfirmable',
  // Document-lifetime identity fences, parallel in kind to the graph-level
  // three above. Without these, a document update/delete/recreate identity
  // fence would leave its outbox rows `pending` forever instead of
  // `rejected-stale`, and the parked-work face (later slices) would never
  // see them.
  'stale_document_incarnation',
  'document_tombstoned',
  'recreate_boundary_mismatch',
]

/** Permanent, non-fence faults: retrying the identical operation can never
 *  succeed. Distinct from a fence — nothing "moved on without you"; the
 *  operation itself cannot be accepted as authored. Distinct from a
 *  transient fault (network errors), which stays `pending` and is retried
 *  unchanged. */
export const PERMANENT_CODES: readonly SourceFaultCode[] = [
  'document_exists',
  'operation_id_reused',
  'event_identity_reused',
  'causal_cycle',
  'ledger_integrity',
  // `conflict_id` digests the candidate set (garden `source_sync.rs:849-859`),
  // so resubmitting THIS identical operation against a dead conflictId can
  // only fail again, forever. A fresh resolution is a NEW row with a NEW
  // operationId, not a retry of this one — leaving it transient is the exact
  // livelock this taxonomy exists to prevent.
  'stale_sync_conflict',
]

/** Permanent codes whose authority message names the ONE operation at
 *  fault, so `flush()`'s catch (`source-mirror.ts`) can terminate that row
 *  alone and leave its innocent batch-mates `pending`. `stale_sync_conflict`
 *  is the only member today: its message `"sync conflict '{id}' is not
 *  current for object '{key}'"` yields a conflictId that `classifyPushRejection`
 *  matches against the batch's own `resolveCurrent` rows. */
export const TARGETED_PERMANENT_CODES: readonly SourceFaultCode[] = ['stale_sync_conflict']

/** A code's retry disposition. Used by `flush()`'s catch and by
 *  `graph-lifecycle.ts`'s push-retry loop. */
export function retryable(code: SourceFaultCode | null): boolean {
  if (code === null) return true // unclassified: assume transient, the safe default
  return !FENCE_CODES.includes(code) && !PERMANENT_CODES.includes(code)
}

export type SourceFaultOrigin = 'code' | 'regex' | 'none'

export interface SourceFault {
  readonly code: SourceFaultCode | null
  /** How the code was recovered. 'code' — rung 1 or 2 matched. 'regex' — an
   *  authority older than the taxonomy, rung 3 matched; used only for the
   *  retirement census, never for behaviour. 'none' — rung 4: nothing
   *  matched, `code` is null. */
  readonly origin: SourceFaultOrigin
  /** The error's message as this client observed it. On rung 2 (HTTP body)
   *  and rung 3 (regex) this genuinely is the authority's own string. On
   *  rung 1 (MCP) it is **not** byte-identical to the authority's testimony
   *  — `McpError`/`GatewayMcpError` build `.message` as a locally-prefixed
   *  wrapper ("MCP error for {tool}: {authority message}") and retain no
   *  separate raw field. Never rewritten *by this function*, never
   *  summarised, but not a guarantee of verbatim recovery (see
   *  `sourceErrorTestimony` below). */
  readonly message: string
}

/** Rung 3 — authorities older than the taxonomy. Every alternative here is a
 *  QUALIFIED phrase from a real authority message. An unqualified status
 *  number is never a classification: `409` alone, `HTTP 409` alone, and the
 *  bare word `conflict` all fall through to rung 4 (`{code: null, origin:
 *  'none'}`), where `retryable(null) === true` keeps the safe direction.
 *  Ordered; first match wins. */
const LEGACY_PATTERNS: readonly (readonly [RegExp, SourceFaultCode])[] = [
  [/stale graph incarnation|graph incarnation changed/i, 'stale_graph_incarnation'],
  [/different lifecycle identity|lifecycle identity/i, 'graph_lifecycle_identity_mismatch'],
  [/cannot confirm graph incarnation/i, 'graph_incarnation_unconfirmable'],
  [/graph .*already exists/i, 'graph_exists'],
  [/stale document incarnation/i, 'stale_document_incarnation'],
  [/is tombstoned/i, 'document_tombstoned'],
  [
    /deletion boundary|neither live nor tombstoned|deleted outside the source ledger/i,
    'recreate_boundary_mismatch',
  ],
  [/document .* already exists/i, 'document_exists'],
  [/sync conflict '.*' is not current/i, 'stale_sync_conflict'],
  [/causal cycle/i, 'causal_cycle'],
  [/was reused with different content/i, 'operation_id_reused'],
  [/was already accepted with different content/i, 'event_identity_reused'],
  [/\bquota\b/i, 'quota_exceeded'],
]

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function codeFromValue(value: unknown): SourceFaultCode | null {
  if (!isObject(value)) return null
  const code = value.code
  return typeof code === 'string' && SOURCE_FAULT_CODE_SET.has(code) ? (code as SourceFaultCode) : null
}

function codeFromJsonText(text: unknown): SourceFaultCode | null {
  if (typeof text !== 'string' || text.length === 0) return null
  try {
    return codeFromValue(JSON.parse(text))
  } catch {
    return null // non-JSON body — not this rung's problem, fall through
  }
}

/**
 * Code-first, regex-fallback.
 *   Rung 1 — JSON-RPC tool error: `.data.code` (`McpError.data`,
 *            `GatewayMcpError.data` — both already plumb `data` end to end,
 *            no transport change needed for the code).
 *   Rung 2 — HTTP error body `{code}`: `GatewayHttpError.responseBody`
 *            parsed as JSON, OR a loopback-shaped error object carrying its
 *            own top-level string `.code` directly (the REST loopback
 *            `{ok:false,error,code}` shape) — `McpError`/`GatewayMcpError`'s
 *            OWN `.code` is the numeric JSON-RPC code and never collides
 *            (`typeof code === 'string'` excludes it structurally).
 *   Rung 3 — the legacy message regexes, in exactly one copy.
 *   Rung 4 — `{code: null, origin: 'none'}`.
 */
export function classifySourceFault(error: unknown): SourceFault {
  const message = messageOf(error)
  if (isObject(error)) {
    const rung1 = codeFromValue(error.data)
    if (rung1 !== null) return { code: rung1, origin: 'code', message }
    const rung2a = codeFromJsonText(error.responseBody)
    if (rung2a !== null) return { code: rung2a, origin: 'code', message }
    const rung2b = codeFromValue(error)
    if (rung2b !== null) return { code: rung2b, origin: 'code', message }
  }
  for (const [pattern, code] of LEGACY_PATTERNS) {
    if (pattern.test(message)) return { code, origin: 'regex', message }
  }
  return { code: null, origin: 'none', message }
}

/** `FENCE_CODES` for a 'code'/'regex'-origin fault; false for 'none'
 *  (`code === null`, structurally excluded from every taxonomy set). */
export function isFenceFault(fault: SourceFault): boolean {
  return fault.code !== null && FENCE_CODES.includes(fault.code)
}

/**
 * The authority's own words, never rewritten or truncated by this function.
 * A thin wrapper over `classifySourceFault(error).message` — kept as its own
 * export because WS3's fence-banner disclosure and reapply failure path name
 * it directly (master §2.2's "survives as a named helper").
 *
 * CAVEAT (WS4 §4.2.7's own correction, carried here verbatim): byte-verbatim
 * only on the REST/loopback path. On the MCP path — the majority path, every
 * `source_push`/`source_pull` call — `.message` is a locally-prefixed
 * wrapper ("MCP error for {tool}: {authority message}"), so this string
 * *contains* the authority's words as a substring rather than being
 * byte-identical to them. Callers must not describe it as verbatim on that
 * path.
 */
export function sourceErrorTestimony(error: unknown): string {
  return classifySourceFault(error).message
}
