/**
 * diagnostics.ts — structured, CONTENT-FREE layout diagnostics.
 *
 * A `Diagnostic` names WHAT structural rule failed and WHICH node/id triggered
 * it. It NEVER carries resource content: no document text, query rows, chat
 * messages, auth tokens, or provider objects (design §3.3 item 10). Every field
 * here is an id-shaped TOKEN, a code, a count, or a short fixed template string
 * — the same discipline `ResourceLocator` already enforces by only ever
 * carrying identifiers (types.ts).
 *
 * `makeDiagnostic` ENFORCES this policy STRUCTURALLY, not just by caller
 * discipline. Three rounds of hardening live here:
 *
 * r1 (design §9.2 Phase 1 diff-review r1): "diagnostics.ts accepts arbitrary
 * caller-provided messages/details without enforcing the policy" — every
 * string that flows through here is length-bounded, and the returned
 * diagnostic (including `details`) is deep-frozen.
 *
 * r2 (design §9.2 Phase 1 diff-review r2): r1's bounding was necessary but not
 * sufficient — a probe found a short secret surviving intact in THREE places
 * simultaneously: (a) `message`, because several call sites built their
 * message by interpolating an UNTRUSTED VALUE directly into the text via a
 * template literal; (b) `nodeId`, which was never bounded at all; (c) an
 * unbounded/unwhitelisted `details` key. r2's fix: every producer passes a
 * FIXED, code-controlled `message` LITERAL at each call site, `nodeId` is
 * bounded exactly like `message`/`details`, and `details` keys are filtered
 * through a per-`DiagnosticCode` ALLOWLIST.
 *
 * r3 (this hardening pass — Builder P1 hardening, finding 3): r2's discipline
 * was still only DISCIPLINE — `makeDiagnostic`'s public shape still accepted
 * an arbitrary `message: string` argument (nothing stopped a future call site
 * from interpolating untrusted content into it again), and BOUNDING a short
 * secret (via 200-char truncation) does not stop it from surviving VERBATIM —
 * truncation only helps once a payload exceeds the bound. r3 makes the
 * guarantee STRUCTURAL instead of relying on caller discipline or truncation:
 *
 *   - `message` is no longer a parameter at all. Every `DiagnosticCode` maps
 *     to exactly ONE private, fixed template string (`DIAGNOSTIC_MESSAGES`,
 *     `satisfies`-checked so the compiler forces every code in the union to
 *     declare one) — it is now IMPOSSIBLE for any call site, present or
 *     future, to pass free text through into a diagnostic's message. Where a
 *     single code previously carried several different hand-written messages
 *     (disambiguated by a `details` key, e.g. `reason`/`field`), the fixed
 *     template is the generic description; the structured detail still
 *     carries the specific reason.
 *   - `nodeId`, and the three detail keys that are themselves caller-chosen
 *     document identifiers rather than code-controlled enum/count values
 *     (`faceId`, `childId`, `embeddedId` — see `TOKENIZED_DETAIL_KEYS`), are
 *     TOKENIZED via `tokenizeId`: a small deterministic non-cryptographic
 *     hash, never the raw string. A caller who smuggles secret-shaped content
 *     into a node id (or a descriptor's `faceId`) can no longer read it back
 *     out of a diagnostic, verbatim or truncated — the token is a fixed
 *     8-hex-digit digest with no recoverable relationship to the input. This
 *     is DEFENSE IN DEPTH: the diagnostic's job was already to never carry
 *     resource CONTENT (`params`, `resource.iri`/`documentId`, etc. are never
 *     surfaced at all, see below) — this closes the residual channel where a
 *     STRUCTURAL identifier field happened to be attacker-chosen content.
 *     Every OTHER detail value (`reason`, `actualType`, `field`,
 *     `expectedKind`/`actualKind`, `legalValues`, `discriminantType`,
 *     `underlyingCode`, `axis`, and every numeric geometry value) is drawn
 *     from a small, code-controlled, closed enum/number set — never
 *     influenced by arbitrary caller string content — so tokenizing those
 *     would only destroy legitimate structural information for no security
 *     benefit; they stay as plain (bounded) values.
 *   - `sanitizeOperationDiscriminant` (operations.ts) no longer echoes ANY
 *     part of a forged/unknown operation discriminant — it returns only a
 *     coarse `typeof` token.
 *
 * Diagnostics are produced by validate.ts (document-level invariant failures),
 * operations.ts (operation preconditions/postconditions), and solver.ts
 * (geometry infeasibility, design §6.2). LAY-011 requires the SAME input to
 * yield byte-stable diagnostics — `sortDiagnostics` gives every producer one
 * shared, deterministic ordering so `JSON.stringify` output never depends on
 * object/Map iteration order. r3 (finding 6) ALSO widens `sortDiagnostics`'s
 * ordering key to a canonical `details` comparison as the final tie-break —
 * previously two diagnostics sharing the same code/nodeId/message but
 * differing ONLY in `details` kept whatever order their PRODUCER happened to
 * push them in (`Object.entries`/traversal order), which is not guaranteed
 * stable across runs — see `detailsSortKey`.
 */

export type DiagnosticCode =
  // document-level schema shape (pre-tree; design §2.2's runtime schema)
  | 'LAY000_INVALID_DOCUMENT_SHAPE'
  | 'LAY000_UNKNOWN_TOP_LEVEL_FIELD'
  | 'LAY000_INVALID_SCHEMA_VERSION'
  | 'LAY000_INVALID_LAYOUT_ID'
  | 'LAY000_INVALID_SCOPE'
  | 'LAY000_INVALID_GRAPH_ID'
  | 'LAY000_INVALID_TIMESTAMP'
  | 'LAY000_INVALID_NODES_MAP'
  // LAY-001 — tree structure
  | 'LAY001_NO_ROOT'
  | 'LAY001_DANGLING_CHILD'
  | 'LAY001_DEGENERATE_SPLIT'
  | 'LAY001_CYCLE'
  | 'LAY001_MULTIPLE_PARENTS'
  | 'LAY001_ORPHAN_NODE'
  | 'LAY001_INVALID_AXIS'
  | 'LAY001_INVALID_RATIO_RANGE'
  | 'LAY001_UNKNOWN_NODE_KIND'
  | 'LAY001_INVALID_NODE_SHAPE'
  | 'LAY001_INVALID_TABS_SHAPE'
  | 'LAY001_DEGENERATE_TABS'
  // LAY-002 — stable identity (single-document self-consistency)
  | 'LAY002_ID_MISMATCH'
  | 'LAY002_INVALID_DESCRIPTOR_REVISION'
  // LAY-003 — typed leaf / face registration
  | 'LAY003_INVALID_DESCRIPTOR'
  | 'LAY003_UNREGISTERED_FACE'
  | 'LAY003_CELL_FACE_NOT_GRID_ELIGIBLE'
  // LAY-010 — last leaf
  | 'LAY010_NO_LEAVES'
  // grid/collection node (design plans/surface-wave2-laneb-slice-20260716.md §2)
  | 'LAY001_INVALID_GRID_FLOW'
  | 'LAY001_INVALID_MIN_CELL_WIDTH'
  | 'LAY001_INVALID_GRID_CHILDREN_SHAPE'
  | 'LAY002_INVALID_GRID_REVISION'
  | 'LAY002_INVALID_TABS_REVISION'
  // operation preconditions (operations.ts)
  | 'LAYOP_NODE_NOT_FOUND'
  | 'LAYOP_NODE_KIND_MISMATCH'
  | 'LAYOP_ID_COLLISION'
  | 'LAYOP_INVALID_RATIO_INPUT'
  | 'LAYOP_INVALID_ENUM'
  | 'LAYOP_TARGET_IN_SUBTREE'
  | 'LAYOP_CANNOT_MOVE_ROOT'
  | 'LAYOP_UNKNOWN_OPERATION'
  | 'LAYOP_MALFORMED_OPERATION'
  | 'LAYOP_POSTCONDITION_INVALID'
  | 'LAYOP_STALE_PARENT'
  | 'LAYOP_STALE_DESCRIPTOR_REVISION'
  | 'LAYOP_STALE_GRID_REVISION'
  | 'LAYOP_STALE_TABS_REVISION'
  | 'LAYOP_TAB_CHILD_NOT_RELOCATABLE'
  // solver.ts geometry
  | 'LAYGEO_LEAF_CONSTRAINED'
  | 'LAYGEO_LEAF_EXCEEDS_MAX'
  | 'LAYGEO_LEAF_ASPECT_MISMATCH'
  | 'LAYGEO_INVALID_CONTAINER'
  | 'LAYGEO_INVALID_CONSTRAINTS'
  | 'LAYGEO_NON_FINITE_GEOMETRY'
  | 'LAYGEO_GRID_CONSTRAINED'
  | 'LAYGEO_TABS_CONSTRAINED'

export interface Diagnostic {
  readonly code: DiagnosticCode
  readonly message: string
  /** The node id most directly implicated, when there is one — TOKENIZED, see this file's header. */
  readonly nodeId?: string
  /** Content-free structured detail: tokens, counts, kinds — never resource content. */
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

/**
 * The CLOSED, private, per-code fixed message table (r3 — see this file's
 * header). `satisfies` forces this object to cover EVERY `DiagnosticCode` —
 * adding a new code without giving it a message is a compile error. This is
 * the ONLY place a `Diagnostic.message` string is ever written; `makeDiagnostic`
 * has no `message` parameter, so no call site — present or future — can pass
 * free text (interpolated or otherwise) through into a diagnostic.
 */
const DIAGNOSTIC_MESSAGES = {
  LAY000_INVALID_DOCUMENT_SHAPE: 'document does not match the required top-level shape',
  LAY000_UNKNOWN_TOP_LEVEL_FIELD: 'document has an unrecognized top-level field',
  LAY000_INVALID_SCHEMA_VERSION: 'schemaVersion must equal 1',
  LAY000_INVALID_LAYOUT_ID: 'layoutId must be a non-empty string',
  LAY000_INVALID_SCOPE: 'scope must be one of session|user|workspace',
  LAY000_INVALID_GRAPH_ID: 'graphId must be a string or null',
  LAY000_INVALID_TIMESTAMP: 'timestamp must be a valid ISO timestamp string',
  LAY000_INVALID_NODES_MAP: 'nodes must be a plain own-property object',
  LAY001_NO_ROOT: 'rootNodeId does not resolve to a node in nodes',
  LAY001_DANGLING_CHILD: 'split child does not exist',
  LAY001_DEGENERATE_SPLIT: 'split start/end children must be distinct, non-empty ids',
  LAY001_CYCLE: 'node is its own ancestor',
  LAY001_MULTIPLE_PARENTS: 'node is reachable via more than one parent edge',
  LAY001_ORPHAN_NODE: 'node is not reachable from root',
  LAY001_INVALID_AXIS: 'split has an invalid axis',
  LAY001_INVALID_RATIO_RANGE: 'split startBasisPoints is out of the legal [1,9999] integer range',
  LAY001_UNKNOWN_NODE_KIND: 'node has an unrecognized kind',
  LAY001_INVALID_NODE_SHAPE: 'node does not match its declared kind\'s shape',
  LAY001_INVALID_TABS_SHAPE: 'tabs node tab list does not match its declared shape',
  LAY001_DEGENERATE_TABS: 'tabs node must carry at least one tab, unique tab node ids, and an activeNodeId among them',
  LAY002_ID_MISMATCH: 'node id does not match its map key',
  LAY002_INVALID_DESCRIPTOR_REVISION: 'leaf descriptorRevision must be a non-negative integer',
  LAY003_INVALID_DESCRIPTOR: 'descriptor is not a well-shaped ViewDescriptor',
  LAY003_UNREGISTERED_FACE: 'faceId is not registered',
  LAY003_CELL_FACE_NOT_GRID_ELIGIBLE: 'faceId is not eligible for use inside a grid cell',
  LAY010_NO_LEAVES: 'document has zero reachable leaves or grids',
  LAY001_INVALID_GRID_FLOW: 'grid flow must be one of the legal GridFlow members',
  LAY001_INVALID_MIN_CELL_WIDTH: 'grid minCellWidth must be a positive integer',
  LAY001_INVALID_GRID_CHILDREN_SHAPE: 'grid children source does not match its declared kind\'s shape',
  LAY002_INVALID_GRID_REVISION: 'grid gridRevision must be a non-negative integer',
  LAY002_INVALID_TABS_REVISION: 'tabs tabsRevision must be a non-negative integer',
  LAYOP_NODE_NOT_FOUND: 'referenced node does not exist',
  LAYOP_NODE_KIND_MISMATCH: 'referenced node has the wrong kind',
  LAYOP_ID_COLLISION: 'operation id is not usable as given',
  LAYOP_INVALID_RATIO_INPUT: 'startBasisPoints must be a finite number',
  LAYOP_INVALID_ENUM: 'field value is not one of the legal enum members',
  LAYOP_TARGET_IN_SUBTREE: 'target is inside the operand\'s own subtree',
  LAYOP_CANNOT_MOVE_ROOT: 'the document root cannot be moved',
  LAYOP_UNKNOWN_OPERATION: 'unrecognized operation discriminant',
  LAYOP_MALFORMED_OPERATION: 'operation payload does not match its declared shape',
  LAYOP_POSTCONDITION_INVALID: 'operation would produce an invalid document',
  LAYOP_STALE_PARENT: 'precondition no longer matches the current document',
  LAYOP_STALE_DESCRIPTOR_REVISION: 'descriptorRevision changed since the caller last observed it',
  LAYOP_STALE_GRID_REVISION: 'gridRevision changed since the caller last observed it',
  LAYOP_STALE_TABS_REVISION: 'tabsRevision changed since the caller last observed it',
  LAYOP_TAB_CHILD_NOT_RELOCATABLE: 'a direct tab child is managed only by tabs_* operations',
  LAYGEO_LEAF_CONSTRAINED: 'leaf allocated below its declared minimum',
  LAYGEO_LEAF_EXCEEDS_MAX: 'leaf allocated above its soft max preference',
  LAYGEO_LEAF_ASPECT_MISMATCH: 'leaf allocated aspect ratio misses its soft preference',
  LAYGEO_INVALID_CONTAINER: 'container dimension must be a finite non-negative number',
  LAYGEO_INVALID_CONSTRAINTS: 'leafConstraints entry does not satisfy its schema',
  LAYGEO_NON_FINITE_GEOMETRY: 'computed geometry overflowed to a non-finite value; rejected as infeasible',
  LAYGEO_GRID_CONSTRAINED: 'grid allocated below its minimum (minCellWidth / floor height)',
  LAYGEO_TABS_CONSTRAINED: 'tabs allocated below its minimum (active tab minimum plus strip height)',
} as const satisfies Readonly<Record<DiagnosticCode, string>>

/**
 * Defensive bound on any free-text string threaded through a diagnostic
 * (a non-tokenized string-valued `details` entry). Every value that reaches
 * this point is already code-controlled (see `TOKENIZED_DETAIL_KEYS` below for
 * the caller-chosen identifiers, which never reach `boundString` at all) — this
 * bound is a defensive backstop against that discipline slipping, not a
 * normal-path limit.
 */
const MAX_DIAGNOSTIC_STRING_LENGTH = 200

function boundString(value: string): string {
  return value.length > MAX_DIAGNOSTIC_STRING_LENGTH
    ? `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}…`
    : value
}

/**
 * A small, deterministic, non-cryptographic hash (FNV-1a, 32-bit) used ONLY to
 * build a bounded, non-reversible correlation TOKEN for an untrusted,
 * caller-chosen identifier — never as a security primitive in its own right
 * (this module's actual job is to never carry resource CONTENT in the first
 * place; tokenizing ids is defense in depth against a caller smuggling
 * secret-shaped content through an id-shaped field — see this file's header,
 * r3). A 32-bit digest can theoretically collide between two distinct inputs;
 * that is acceptable here because a diagnostic's id is a COARSE correlator
 * ("which node"), not a proof of identity — a legitimate caller that needs
 * the exact id back always already has it, because it supplied that id as
 * part of the very operation/document whose rejection produced this
 * diagnostic.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const ID_TOKEN_PREFIX = 'id_'

/**
 * Tokenize an untrusted, caller-chosen identifier for safe inclusion in a
 * diagnostic. Exported for tests. Typed `string` (every call site in this
 * module family now guarantees that by construction — operations.ts's
 * decoder, Builder P1 hardening finding 1/r4), but the body still coerces
 * defensively via `String()` rather than trusting that statically: `String()`
 * never throws for ANY JavaScript value (unlike the `.length` access this
 * function used to do directly on `id`, which threw for `null`) — this is
 * DELIBERATE defense in depth, the same "make the guarantee STRUCTURAL, not
 * caller-discipline" philosophy this file's r3 hardening already applies to
 * `message`/`details` (see this file's header): if a future call site ever
 * forgets to fully decode its input before reaching here, this function
 * still cannot be the thing that turns a malformed-but-JSON-shaped document
 * into a crash.
 */
export function tokenizeId(id: string): string {
  const safe = typeof id === 'string' ? id : String(id)
  return `${ID_TOKEN_PREFIX}${fnv1a32(safe).toString(16).padStart(8, '0')}`
}

/**
 * The detail keys whose VALUE is itself a caller-chosen document identifier
 * (a node id or a descriptor's faceId) rather than a code-controlled
 * enum/count — these are TOKENIZED, never surfaced verbatim (r3, this file's
 * header). Every other detail key's value is drawn from a small,
 * code-controlled set (a fixed label, a `typeof` result, a `DiagnosticCode`,
 * a count, a bounded enum) and is left as-is.
 */
const TOKENIZED_DETAIL_KEYS: ReadonlySet<string> = new Set(['faceId', 'childId', 'embeddedId'])

/**
 * The CLOSED per-code detail schema (design §9.2 Phase 1 diff-review r2's
 * "whitelisted detail schemas"). `satisfies` forces this object to cover
 * EVERY `DiagnosticCode` — adding a new code without declaring its allowed
 * detail keys here is a compile error, not a silent gap. An empty array means
 * "this code never carries structured detail" — `makeDiagnostic` drops any
 * `details` entry whose key is not in the code's list, so a call site cannot
 * smuggle a new, unreviewed key through by accident.
 */
const ALLOWED_DETAIL_KEYS = {
  LAY000_INVALID_DOCUMENT_SHAPE: ['reason'],
  LAY000_UNKNOWN_TOP_LEVEL_FIELD: ['field'],
  LAY000_INVALID_SCHEMA_VERSION: ['actualType'],
  LAY000_INVALID_LAYOUT_ID: [],
  LAY000_INVALID_SCOPE: ['actualType'],
  LAY000_INVALID_GRAPH_ID: ['actualType'],
  LAY000_INVALID_TIMESTAMP: ['field'],
  LAY000_INVALID_NODES_MAP: [],
  LAY001_NO_ROOT: [],
  LAY001_DANGLING_CHILD: ['childId', 'childField'],
  LAY001_DEGENERATE_SPLIT: [],
  LAY001_CYCLE: [],
  LAY001_MULTIPLE_PARENTS: [],
  LAY001_ORPHAN_NODE: [],
  LAY001_INVALID_AXIS: [],
  LAY001_INVALID_RATIO_RANGE: ['actualType'],
  LAY001_UNKNOWN_NODE_KIND: [],
  LAY001_INVALID_NODE_SHAPE: ['reason'],
  LAY001_INVALID_TABS_SHAPE: ['reason'],
  LAY001_DEGENERATE_TABS: ['reason'],
  LAY002_ID_MISMATCH: ['embeddedId'],
  LAY002_INVALID_DESCRIPTOR_REVISION: ['actualType'],
  LAY003_INVALID_DESCRIPTOR: [],
  LAY003_UNREGISTERED_FACE: ['faceId'],
  LAY003_CELL_FACE_NOT_GRID_ELIGIBLE: ['faceId'],
  LAY010_NO_LEAVES: [],
  LAY001_INVALID_GRID_FLOW: [],
  LAY001_INVALID_MIN_CELL_WIDTH: ['actualType'],
  LAY001_INVALID_GRID_CHILDREN_SHAPE: [],
  LAY002_INVALID_GRID_REVISION: ['actualType'],
  LAY002_INVALID_TABS_REVISION: ['actualType'],
  LAYOP_NODE_NOT_FOUND: ['field'],
  LAYOP_NODE_KIND_MISMATCH: ['field', 'expectedKind', 'actualKind'],
  LAYOP_ID_COLLISION: ['field'],
  LAYOP_INVALID_RATIO_INPUT: ['actualType'],
  LAYOP_INVALID_ENUM: ['field', 'legalValues'],
  LAYOP_TARGET_IN_SUBTREE: [],
  LAYOP_CANNOT_MOVE_ROOT: [],
  LAYOP_UNKNOWN_OPERATION: ['discriminantType'],
  LAYOP_MALFORMED_OPERATION: ['field'],
  LAYOP_POSTCONDITION_INVALID: ['underlyingCode'],
  LAYOP_STALE_PARENT: ['field'],
  LAYOP_STALE_DESCRIPTOR_REVISION: ['expected', 'actual'],
  LAYOP_STALE_GRID_REVISION: ['expected', 'actual'],
  LAYOP_STALE_TABS_REVISION: ['expected', 'actual'],
  LAYOP_TAB_CHILD_NOT_RELOCATABLE: ['field'],
  LAYGEO_LEAF_CONSTRAINED: ['minWidth', 'minHeight', 'allocatedWidth', 'allocatedHeight'],
  LAYGEO_LEAF_EXCEEDS_MAX: ['axis', 'maxWidth', 'maxHeight', 'allocatedWidth', 'allocatedHeight'],
  LAYGEO_LEAF_ASPECT_MISMATCH: ['preferredAspectRatio', 'actualAspectRatio'],
  LAYGEO_INVALID_CONTAINER: ['field'],
  LAYGEO_INVALID_CONSTRAINTS: ['field'],
  LAYGEO_NON_FINITE_GEOMETRY: ['field'],
  LAYGEO_GRID_CONSTRAINED: ['minWidth', 'minHeight', 'allocatedWidth', 'allocatedHeight'],
  LAYGEO_TABS_CONSTRAINED: ['minWidth', 'minHeight', 'allocatedWidth', 'allocatedHeight'],
} as const satisfies Readonly<Record<DiagnosticCode, readonly string[]>>

/**
 * (code, key) pairs whose value is untrusted, caller-chosen DOCUMENT CONTENT
 * despite sharing a key name (`field`) that is safe everywhere else it
 * appears (Builder P1 hardening finding 2, r4). Every OTHER `field`-keyed
 * detail value is one of a small, code-controlled label set (`'leafId'`,
 * `'axis'`, `'createdAt'`, …  — see the call sites in
 * validate.ts/operations.ts/solver.ts) — but
 * `LAY000_UNKNOWN_TOP_LEVEL_FIELD`'s `field` is the literal, attacker-chosen
 * KEY NAME copied straight off the untrusted document (an agent can name an
 * unknown top-level property anything at all, including a secret-shaped
 * string such as `sk-...`), so it needs the SAME tokenization
 * `TOKENIZED_DETAIL_KEYS` already gives id-shaped values — just scoped to
 * this one (code, key) pair rather than the key name `field` globally, since
 * tokenizing `field` everywhere else would destroy legitimate,
 * code-controlled structural information for no security benefit.
 * `boundString`'s 200-char truncation alone does NOT close this: a SHORT
 * secret-shaped field name never reaches the truncation bound and survives
 * verbatim.
 */
const CODE_SCOPED_TOKENIZED_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'LAY000_UNKNOWN_TOP_LEVEL_FIELD:field',
])

function boundDetailValue(
  code: DiagnosticCode,
  key: string,
  value: string | number | boolean,
): string | number | boolean {
  if (typeof value !== 'string') return value
  const mustTokenize =
    TOKENIZED_DETAIL_KEYS.has(key) || CODE_SCOPED_TOKENIZED_DETAIL_KEYS.has(`${code}:${key}`)
  return mustTokenize ? tokenizeId(value) : boundString(value)
}

function boundDetails(
  code: DiagnosticCode,
  details: Readonly<Record<string, string | number | boolean>>,
  allowedKeys: readonly string[],
): Readonly<Record<string, string | number | boolean>> | undefined {
  const bounded: Record<string, string | number | boolean> = {}
  let count = 0
  for (const [key, value] of Object.entries(details)) {
    if (!allowedKeys.includes(key)) continue
    bounded[key] = boundDetailValue(code, key, value)
    count += 1
  }
  return count > 0 ? Object.freeze(bounded) : undefined
}

/**
 * Build one content-free `Diagnostic`. `message` is derived SOLELY from
 * `code` via the private `DIAGNOSTIC_MESSAGES` table (r3 — see this file's
 * header): there is no way for a caller to influence it. `nodeId`, when
 * given, is TOKENIZED (never the raw id); `details` is filtered through
 * `code`'s allowlist and any id-shaped value is tokenized the same way.
 */
export function makeDiagnostic(
  code: DiagnosticCode,
  nodeId?: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): Diagnostic {
  const filteredDetails = details === undefined ? undefined : boundDetails(code, details, ALLOWED_DETAIL_KEYS[code])
  const diagnostic: Diagnostic = {
    code,
    message: DIAGNOSTIC_MESSAGES[code],
    ...(nodeId !== undefined ? { nodeId: tokenizeId(nodeId) } : {}),
    ...(filteredDetails !== undefined ? { details: filteredDetails } : {}),
  }
  return Object.freeze(diagnostic)
}

/**
 * A canonical, order-independent string representation of a diagnostic's
 * `details` — sorted by key, so two `details` objects with the same
 * key/value pairs built in a different order (`Object.entries` iteration is
 * insertion-order, not sorted) still produce the SAME sort key (r3, finding
 * 6). `undefined` details sorts as the empty string, before any non-empty
 * details.
 *
 * r4 (Builder P1 hardening finding 4): the PREVIOUS encoding concatenated
 * `${key}=${value}` pairs with a NUL (\0) separator — not INJECTIVE, since a
 * string VALUE could itself contain a NUL byte followed by text shaped like
 * `key=value`, letting two structurally DIFFERENT `details` objects
 * concatenate to the IDENTICAL sort key (one entry's value bleeding into
 * what reads back as a second, different entry). `JSON.stringify` of the
 * sorted `[key, value]` tuple array is injective over this shape instead:
 * every string is quoted and escaped (including any embedded NUL/delimiter
 * characters), distinct primitive TYPES serialize to distinct token shapes
 * (the number `5` becomes `5`, the string `'5'` becomes `"5"`), and the
 * array/tuple structure itself is unambiguous JSON syntax — so two different
 * `details` objects can never collide onto the same sort key, and
 * `sortDiagnostics`'s ordering is genuinely a function of `details`' actual
 * key/value pairs, never of producer/traversal order.
 */
function detailsSortKey(details: Diagnostic['details']): string {
  if (!details) return ''
  const tuples: ReadonlyArray<readonly [string, string | number | boolean]> = Object.keys(details)
    .sort()
    .map((key) => [key, details[key]] as const)
  return JSON.stringify(tuples)
}

/**
 * Deterministic total order over diagnostics: code asc, then nodeId asc
 * ('' sorts first), then a canonical `details` comparison as the FINAL
 * tie-break (r3, finding 6 — see `detailsSortKey`). Every producer in this
 * module family sorts through this before returning a list, so repeated
 * calls on the same input are byte-identical regardless of internal
 * traversal or Object.keys order (LAY-011) — including when two diagnostics
 * share the same code and nodeId (and therefore, since r3, the same fixed
 * message) but differ only in `details`, which previously fell through to
 * whatever order their PRODUCER happened to push them in.
 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    const an = a.nodeId ?? ''
    const bn = b.nodeId ?? ''
    if (an !== bn) return an < bn ? -1 : 1
    const ad = detailsSortKey(a.details)
    const bd = detailsSortKey(b.details)
    if (ad !== bd) return ad < bd ? -1 : 1
    return 0
  })
}
