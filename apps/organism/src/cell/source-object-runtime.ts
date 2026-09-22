/**
 * source-object-runtime.ts — the ONE module where `@shrubbery/source` types
 * and the `SourceObjectService` seam meet (WS1 §6.2.3/§6.2.4, master spec §3
 * Slice 2). `@shrubbery/runtime` never imports `@shrubbery/source` (D-4); this
 * file is the organism-side implementation over a real `SourceMirrorRuntime`.
 *
 * Two read paths (§6.2):
 *   1. the MIRROR (offline-complete, primary) — `bundle.currentState` +
 *      `bundle.conflicts` + `bundle.sourceRegistry`, all already resident.
 *   2. the AUTHORITY (online, no complete mirror) — `emporium_read` over the
 *      RAW (unwrapped) MCP caller, structurally degraded and says so.
 *
 * No third path. If neither is available, the service rejects with the
 * underlying error verbatim (errors doctrine: "errors surface verbatim,
 * never a silent fallback").
 */
// The `-internal` subpath, NOT the full `@shrubbery/runtime/layout` barrel:
// this module is imported from Node-only real-cell scripts (master §3
// Slice 5, `source-sync-distributed-truth-gardend.mts`), and the full
// barrel's `@customElement`-decorated view elements crash outside a DOM.
// See `source-object-service.ts`'s own header for the verified failure.
import {
  objectKeyOf,
  type ObjectKeyParts,
  type SourceObjectCandidate,
  type SourceObjectClassInfo,
  type SourceObjectContest,
  type SourceObjectRead,
  type SourceObjectService,
  type SourceObjectUnavailable,
} from '@shrubbery/runtime/layout/source-object-service-internal'
import type { SourceConflict, SourceCurrentObject } from '@shrubbery/source'
import type { SourceMirrorRuntime } from './source-mirror-runtime.js'

// ── N-Triples term decode (§6.2.3) ──────────────────────────────────────────

const XSD_NUMERIC_DATATYPE = /^http:\/\/www\.w3\.org\/2001\/XMLSchema#(?:integer|decimal|double|float)$/
const XSD_BOOLEAN_DATATYPE = 'http://www.w3.org/2001/XMLSchema#boolean'

// `Term::to_string()`'s three literal forms: `"lit"`, `"lit"^^<datatype>`,
// `"lit"@lang` — the literal body may contain escaped `\"` / `\\`.
const LITERAL_TERM = /^"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]*)>|@[\w-]+)?$/

function unescapeNTriplesString(value: string): string {
  return value.replace(/\\(.)/g, (_match, escaped: string) => {
    switch (escaped) {
      case 'n':
        return '\n'
      case 't':
        return '\t'
      case 'r':
        return '\r'
      case '"':
        return '"'
      case '\\':
        return '\\'
      default:
        return escaped
    }
  })
}

/**
 * One `Term::to_string()` N-Triples term -> a native JS scalar. Pure, never
 * throws: an unparseable term decodes to its raw N-Triples text, which the
 * generic renderer still shows (as a `state` string) rather than silently
 * dropping the field. Only the two datatype families the generic renderer
 * (`selectObjectCardFields`/`inferFieldKind`) already distinguishes get a
 * typed decode; everything else — including `<iri>`, plain/`@lang` string
 * literals, blank nodes, and any other `^^<datatype>` — decodes to its
 * unescaped string value.
 */
export function decodeAuthorityTerm(ntriples: string): unknown {
  const text = ntriples.trim()
  if (text.startsWith('<') && text.endsWith('>')) {
    return unescapeNTriplesString(text.slice(1, -1))
  }
  const literalMatch = text.match(LITERAL_TERM)
  if (literalMatch) {
    const [, rawLiteral, datatype] = literalMatch
    const literal = unescapeNTriplesString(rawLiteral)
    if (datatype && XSD_NUMERIC_DATATYPE.test(datatype)) {
      const numeric = Number(literal)
      return Number.isFinite(numeric) ? numeric : literal
    }
    if (datatype === XSD_BOOLEAN_DATATYPE) {
      if (literal === 'true') return true
      if (literal === 'false') return false
      return literal
    }
    return literal
  }
  // `_:blank` or anything else unparseable — raw text, never a throw.
  return text
}

/**
 * `{predicateIri: string[]}` -> `record`. A predicate's values collapse to a
 * bare scalar when the array has exactly one entry, else stay an array
 * (rendered `nested` by `inferFieldKind`). `emporium_read`'s response carries
 * no per-predicate `multi` flag, so "one value in the array" is read as "this
 * predicate had one value here" — a display heuristic, never wrong about
 * what was written, only occasionally conservative about a `multi`
 * predicate that happens to carry one value in this particular record.
 */
export function decodeAuthorityRecord(
  predicates: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, unknown>> {
  const record: Record<string, unknown> = {}
  for (const [predicate, values] of Object.entries(predicates)) {
    const decoded = values.map(decodeAuthorityTerm)
    record[predicate] = decoded.length === 1 ? decoded[0] : decoded
  }
  return record
}

/**
 * Matches ONLY the two NotFound shapes that mean "this object does not
 * exist" (`read_object`'s empty span; `assert_subject_is_class`'s
 * class-mismatch/retracted case) — both contain "no object <…> …".
 * Deliberately does NOT match "vocab '…': …" or "class '…' is not declared
 * …", which are also `ObjectError::NotFound` but mean "this class or vocab
 * is misconfigured" — collapsing those to a quiet `null` would hide a real
 * setup error behind an empty-state card. A message that does not match is
 * treated as a loud rejection, never guessed into `null`. Retired the moment
 * Ask B's `code` field ships (WS1 §6.2.3/§8.1).
 *
 * REPAIR (verified against a real cell, master spec §3 Slice 2): WS1's own
 * regex anchored on `^`, assuming the client sees the server's message
 * verbatim. It does not: `LoopbackMcpClient.toolsCall` wraps every JSON-RPC
 * error as `` `MCP error for ${name}: ${json.error.message}` `` before it
 * ever reaches this classifier (`loopback-mcp.ts`'s `McpError` — no
 * unwrapped-message field survives the wrap), so the real thrown message is
 * `"MCP error for emporium_read: no object <…> …"`, never a bare `^no
 * object`. Unanchored so it matches regardless of which transport's own
 * prefix wraps the server text.
 */
export const AUTHORITY_OBJECT_NOT_FOUND = /no object <.+> (?:in|of the requested class in) /

interface RawMcpCaller {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

export interface CreateSourceObjectServiceOptions {
  readonly runtime: SourceMirrorRuntime
  /**
   * Live MCP caller for the authority path; omit for a mirror-only session.
   * Deliberately `callTool`-shaped, never the raw JSON-RPC-envelope-shaped
   * `toolsCall` — see `GardendContract.rawMcp`'s own doc comment.
   */
  readonly caller?: RawMcpCaller
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: object, key: string): string | undefined {
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The narrow shape `readFromMirror` reads off a resident `SourceBundle`.
 * Ask A's validated wire types flow through unchanged; this module still
 * narrows individual fields before adapting them to the runtime seam, so it
 * does not accidentally broaden the trust boundary again.
 */
interface MirrorBundleView {
  readonly currentState: readonly SourceCurrentObject[]
  readonly conflicts: readonly SourceConflict[]
  readonly sourceRegistry: readonly Record<string, unknown>[]
  readonly epoch: string
}

function candidateFromWire(value: unknown): SourceObjectCandidate | null {
  if (!isRecord(value)) return null
  const operationId = stringField(value, 'operationId')
  const sourceVersion = stringField(value, 'sourceVersion')
  const baseVersion = stringField(value, 'baseVersion')
  const record = isRecord(value.record) ? value.record : undefined
  if (!operationId || !sourceVersion || !baseVersion || !record) return null
  const clientId = stringField(value, 'clientId')
  const causalOrder = typeof value.causalOrder === 'number' ? value.causalOrder : undefined
  return {
    operationId,
    sourceVersion,
    baseVersion,
    record,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(causalOrder !== undefined ? { causalOrder } : {}),
  }
}

function contestFromWire(value: unknown): SourceObjectContest | null {
  if (!isRecord(value)) return null
  const conflictId = stringField(value, 'conflictId')
  const baseVersion = stringField(value, 'baseVersion')
  const reason = stringField(value, 'reason')
  const projectedOperationId = stringField(value, 'projectedOperationId')
  const rawCandidates = Array.isArray(value.candidates) ? value.candidates : null
  if (!conflictId || !baseVersion || !reason || !projectedOperationId || !rawCandidates) return null
  const candidates = rawCandidates.map(candidateFromWire)
  if (candidates.some((candidate) => candidate === null)) return null
  return {
    conflictId,
    baseVersion,
    reason,
    projectedOperationId,
    candidates: candidates as SourceObjectCandidate[],
  }
}

function classInfoFromWire(value: unknown): SourceObjectClassInfo | undefined {
  if (!isRecord(value)) return undefined
  const identityKind = stringField(value, 'identityKind')
  const storeTarget = stringField(value, 'storeTarget')
  const storeMode = stringField(value, 'storeMode')
  const dispatchMode = stringField(value, 'dispatchMode')
  if (!identityKind && !storeTarget && !storeMode && !dispatchMode) return undefined
  return {
    ...(identityKind !== undefined ? { identityKind } : {}),
    ...(storeTarget !== undefined ? { storeTarget } : {}),
    ...(storeMode !== undefined ? { storeMode } : {}),
    ...(dispatchMode !== undefined ? { dispatchMode } : {}),
  }
}

/**
 * Path 1 — the mirror (§6.2.2). `null` when the object is not present in
 * `bundle.currentState` (EMPTY, not an error) or the bundle itself is
 * unusable (caller has already checked `runtime.bundleFor` before calling).
 */
function readFromMirror(
  bundle: MirrorBundleView,
  graphId: string,
  key: ObjectKeyParts,
): SourceObjectRead | null {
  const objectKey = objectKeyOf(key)
  const face = bundle.currentState.find((candidate) => candidate.objectKey === objectKey)
  if (!face || !isRecord(face.record)) return null

  const vocab = stringField(face, 'vocab') ?? key.vocab
  const objectClass = stringField(face, 'class') ?? key.class
  const objectId = stringField(face, 'objectId') ?? key.objectId
  const sourceVersion = stringField(face, 'sourceVersion')
  const reconciliationStrategy = stringField(face, 'reconciliationStrategy')
  const conflictId = stringField(face, 'conflictId')

  let contest: SourceObjectContest | undefined
  const unavailable: SourceObjectUnavailable[] = []
  if (conflictId !== undefined) {
    const conflictWire = bundle.conflicts.find((candidate) => candidate.conflictId === conflictId)
    const parsed = conflictWire ? contestFromWire(conflictWire) : null
    if (parsed) contest = parsed
    else unavailable.push('contest')
  }

  // Ask A (WS4, master §2.11 — landed on the real Slice-0 wire this slice
  // targets): `CurrentObjectFace.operationId` is REQUIRED on a current-Ask-A
  // cell — it names the operation that minted the head, which is how a
  // reader learns the head was CHOSEN (a `ResolveCurrent` id) rather than
  // merely projected. `clientId` stays optional even then: `None` for a
  // resolved head (permanently — `ResolveCurrent` synthesises its head with
  // attribution explicitly nulled) and for pre-attribution ledger rows. A
  // PRE-Ask-A cell omits `operationId` entirely — that, and only that, is
  // when this read genuinely has no writer fact to confess.
  const lastWriterOperationId = stringField(face, 'operationId')
  const lastWriterClientId = stringField(face, 'clientId')
  const lastWriter = lastWriterOperationId !== undefined
    ? { operationId: lastWriterOperationId, ...(lastWriterClientId !== undefined ? { clientId: lastWriterClientId } : {}) }
    : undefined
  if (lastWriter === undefined) unavailable.push('lastWriter')

  const registryEntry = bundle.sourceRegistry.find(
    (candidate) => candidate.vocab === vocab && candidate.class === objectClass,
  )
  const classInfo = classInfoFromWire(registryEntry)

  return {
    provenance: 'mirror',
    graphId,
    objectKey,
    vocab,
    class: objectClass,
    objectId,
    record: face.record,
    ...(sourceVersion !== undefined ? { sourceVersion } : {}),
    ...(reconciliationStrategy !== undefined ? { reconciliationStrategy } : {}),
    ...(conflictId !== undefined ? { conflictId } : {}),
    ...(contest !== undefined ? { contest } : {}),
    ...(lastWriter !== undefined ? { lastWriter } : {}),
    ...(classInfo !== undefined ? { classInfo } : {}),
    unavailable,
    epoch: bundle.epoch,
  }
}

// ── Path 2 — the authority (§6.2.3) ─────────────────────────────────────────

const AUTHORITY_UNAVAILABLE: readonly SourceObjectUnavailable[] = [
  'sourceVersion',
  'reconciliationStrategy',
  'contest',
  'lastWriter',
]

async function readFromAuthority(
  caller: RawMcpCaller,
  graphId: string,
  key: ObjectKeyParts,
): Promise<SourceObjectRead | null> {
  let response: unknown
  try {
    response = await caller.callTool('emporium_read', {
      graphId,
      vocab: key.vocab,
      class: key.class,
      address: key.objectId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (AUTHORITY_OBJECT_NOT_FOUND.test(message)) return null
    throw error
  }
  if (!isRecord(response) || !isRecord(response.predicates)) {
    throw new Error('card.object: authority read returned an unexpected shape')
  }
  const predicates = response.predicates as Record<string, unknown>
  const narrowedPredicates: Record<string, readonly string[]> = {}
  for (const [predicate, values] of Object.entries(predicates)) {
    if (!Array.isArray(values)) continue
    narrowedPredicates[predicate] = values.filter((value): value is string => typeof value === 'string')
  }
  const record = decodeAuthorityRecord(narrowedPredicates)
  return {
    provenance: 'authority-projection',
    graphId,
    objectKey: objectKeyOf(key),
    vocab: key.vocab,
    class: key.class,
    objectId: key.objectId,
    record,
    unavailable: AUTHORITY_UNAVAILABLE,
  }
}

/**
 * The organism implementation of `SourceObjectService` (§6.2.4). This is the
 * ONE module where `@shrubbery/source` types and the seam meet — it owns all
 * the narrowing of the untyped `Record<string, unknown>[]` arrays; the
 * `@shrubbery/runtime` package never sees them.
 */
export function createSourceObjectService(options: CreateSourceObjectServiceOptions): SourceObjectService {
  const { runtime, caller } = options
  return {
    async read(graphId, key) {
      const bundle = runtime.bundleFor(graphId)
      if (bundle) {
        return readFromMirror(bundle, graphId, key)
      }
      if (!caller) {
        throw new Error(
          `card.object: no usable local mirror for graph '${graphId}' and no live caller was supplied for the authority fallback`,
        )
      }
      return readFromAuthority(caller, graphId, key)
    },
  }
}
