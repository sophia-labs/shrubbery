/**
 * contested-surface-gardend.mts — REAL-CELL proof for the two source-sync
 * named queries (`sync.conflicts-open`, `sync.conflict-candidates`) against
 * WS4's REAL, landed RDF vocabulary (MO object-face integration spec,
 * master §2.7, §3 Slice 5, gate G10).
 *
 * Node-only — no browser, no Vite. Spawns a real headless gardend cell,
 * seeds ONE real Law IV current-state contest (two attributed writers from
 * the same observed base), runs BOTH named queries directly through the
 * real `sparql_query` MCP tool (the same tool `observatory-dashboard-
 * gardend-browser.mts` already uses for a live sanity count), and asserts
 * the real RDF projection's shape:
 *
 *   - `sync.conflicts-open`: exactly one row, `?item` a URI naming the
 *     conflicts-graph subject, `?class`/`?object` equal the fold's own
 *     `object_key()` decomposition, `?proposals` equals the candidate
 *     count FROM `sync:candidateCount` (no sub-select, no aggregate);
 *   - `sync.conflict-candidates`: exactly two rows for that `?item`, each
 *     carrying a real `?operation`/`?version`, and — since this harness
 *     seeds BOTH candidates with explicit `clientId`/`causalOrder` — a
 *     real `?writer`/`?order` too;
 *   - the cartesian-hazard museum piece: a HAND-RUN legacy-shaped query
 *     (the flat-predicate shape WS4 D5 removed) demonstrates it can no
 *     longer even ASK the old cartesian-prone question — the predicates it
 *     names do not exist on the new per-candidate-node shape.
 *
 * NO MOCKS anywhere in this proof.
 */
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient, mcpText } from '../src/cell/loopback-mcp.js'
import { SYNC_QUERY, SOURCE_SYNC_NAMED_QUERIES } from '../src/harness/source-sync-query-catalog.js'

// NOT `NamedQueryRegistry` from `@shrubbery/runtime/layout`: a VALUE import
// of that barrel pulls in every `@customElement`-decorated view element,
// which calls `customElements.define` at module load time and crashes this
// plain-Node script (no DOM) — verified empirically ("Unsupported decorator
// location: field" from `stat-scalar-view-element.ts`). `source-sync-query-
// catalog.ts` itself stays import-safe (type-only) for exactly this reason;
// this script does the SAME `{{graphId}}` substitution `NamedQueryRegistry.
// resolve` performs, inline, rather than construct one.
function resolveNamedQuery(name: string, graphId: string): string {
  const definition = SOURCE_SYNC_NAMED_QUERIES.find((candidate) => candidate.name === name)
  if (!definition) throw new Error(`resolveNamedQuery: unknown name '${name}'`)
  return definition.text.replaceAll('{{graphId}}', graphId)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`contested-surface-gardend assertion failed: ${message}`)
}

const GRAPH_ID = 'contested-surface-gardend-proof'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'contested-surface-gardend-object'

interface SparqlRow {
  readonly [variable: string]: string | undefined
}

async function sparqlQuery(mcp: LoopbackMcpClient, graphId: string, query: string): Promise<readonly SparqlRow[]> {
  const result = await mcp.toolsCall('sparql_query', { graphId, query })
  const envelope = JSON.parse(mcpText(result)) as { rows?: readonly SparqlRow[] }
  assert(Array.isArray(envelope.rows), `sparql_query returned no rows array: ${mcpText(result)}`)
  return envelope.rows!
}

/** `<urn:...>` -> the bare IRI; `null` if the raw term is not a URI. */
function asUri(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const match = /^<([^>]*)>$/.exec(raw)
  return match ? match[1] : null
}

/** `"literal"(^^<datatype>|@lang)?` -> the bare literal text; `null` if not a plain/typed literal. */
function asLiteral(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const match = /^"((?:[^"\\]|\\.)*)"/.exec(raw)
  return match ? match[1].replace(/\\(.)/g, '$1') : null
}

let cell: GardendCell | null = null

try {
  const bin = resolveGardendBin()
  console.log(`[contested-surface-gardend] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[contested-surface-gardend] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'contested-surface-gardend proof' })
  let graphIncarnation = (
    (await mcp.callTool('source_pull', { graphId: GRAPH_ID })) as { graphIncarnation: string }
  ).graphIncarnation

  // ── seed ONE real Law IV contest: two ATTRIBUTED writers from the SAME
  //    observed base ("root"). `Bookmark` declares `codeBacked` — never
  //    auto-resolves, so it stays genuinely, permanently contested. ────────
  const bookmarkOp = (operationId: string, title: string, clientId: string, causalOrder: number): Record<string, unknown> => ({
    kind: 'currentState',
    operationId,
    vocab: VOCAB,
    class: CLASS,
    objectId: OBJECT_ID,
    baseVersion: 'root',
    record: { kind: CLASS, url: `https://shrubbery.test/${OBJECT_ID}`, title },
    clientId,
    causalOrder,
  })
  const pushA = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('contested-surface-claim-a', 'Claim A', 'device-a', 1)],
  }) as { ok?: boolean }
  assert(pushA.ok === true, `first contested claim accepted: ${JSON.stringify(pushA)}`)
  const pushB = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('contested-surface-claim-b', 'Claim B', 'device-b', 2)],
  }) as { ok?: boolean }
  assert(pushB.ok === true, `second contested claim accepted: ${JSON.stringify(pushB)}`)
  const afterContest = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as {
    conflicts?: ReadonlyArray<{ readonly conflictId?: string; readonly objectKey?: string }>
  }
  assert((afterContest.conflicts?.length ?? 0) === 1, `authority reports exactly one real conflict: ${JSON.stringify(afterContest.conflicts)}`)
  const seededConflictId = afterContest.conflicts![0]!.conflictId!
  const seededObjectKey = afterContest.conflicts![0]!.objectKey!
  console.log(`[contested-surface-gardend] real Law IV contest seeded: conflictId=${seededConflictId} objectKey=${seededObjectKey}`)

  // ── (1) sync.conflicts-open: exactly one row, the real shape ────────────
  const conflictsQuery = resolveNamedQuery(SYNC_QUERY.conflictsOpen, GRAPH_ID)
  const conflictRows = await sparqlQuery(mcp, GRAPH_ID, conflictsQuery)
  assert(conflictRows.length === 1, `sync.conflicts-open: exactly one row for one real contest: ${JSON.stringify(conflictRows)}`)
  const row = conflictRows[0]!
  const itemUri = asUri(row.item)
  assert(itemUri !== null, `?item is a real URI: ${JSON.stringify(row)}`)
  assert(itemUri === `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:sync-conflicts:${seededConflictId}`, `?item names the real conflict subject: ${itemUri}`)
  const objectKeyParts = seededObjectKey.split(String.fromCharCode(0x1f))
  assert(objectKeyParts.length === 3, `real objectKey decomposes to 3 parts: ${JSON.stringify(objectKeyParts)}`)
  const [expectedVocab, expectedClass, expectedObjectId] = objectKeyParts
  assert(asLiteral(row.class) === expectedClass, `?class equals the fold's own object_key() decomposition: ${row.class} vs ${expectedClass}`)
  assert(asLiteral(row.object) === expectedObjectId, `?object equals the fold's own object_key() decomposition: ${row.object} vs ${expectedObjectId}`)
  assert(expectedVocab === VOCAB, `sanity: the vocab segment is real: ${expectedVocab}`)
  assert(asLiteral(row.proposals) === '2', `?proposals equals sync:candidateCount, no sub-select, no aggregate: ${row.proposals}`)
  assert(typeof row.strategy === 'string' && row.strategy.length > 0, `?strategy is bound: ${JSON.stringify(row)}`)
  assert(typeof row.observedBase === 'string' && row.observedBase.length > 0, `?observedBase is bound: ${JSON.stringify(row)}`)
  console.log('[contested-surface-gardend] (1) sync.conflicts-open: one real row, real object_key() decomposition, real candidateCount')

  // ── (2) sync.conflict-candidates: exactly two rows for this ?item, real
  //    attribution (both candidates were seeded with clientId/causalOrder) ─
  const candidatesQuery = resolveNamedQuery(SYNC_QUERY.conflictCandidates, GRAPH_ID)
  const candidateRows = await sparqlQuery(mcp, GRAPH_ID, candidatesQuery)
  const thisItemCandidates = candidateRows.filter((candidate) => asUri(candidate.item) === itemUri)
  assert(thisItemCandidates.length === 2, `sync.conflict-candidates: exactly two rows for the one real contest: ${JSON.stringify(candidateRows)}`)
  const writers = thisItemCandidates.map((candidate) => asLiteral(candidate.writer)).sort()
  assert(JSON.stringify(writers) === JSON.stringify(['device-a', 'device-b']), `real ?writer values survive the round trip: ${JSON.stringify(writers)}`)
  const orders = thisItemCandidates.map((candidate) => asLiteral(candidate.order)).sort()
  assert(JSON.stringify(orders) === JSON.stringify(['1', '2']), `real ?order values survive the round trip, never a date: ${JSON.stringify(orders)}`)
  for (const candidate of thisItemCandidates) {
    assert(asUri(candidate.operation) === null && typeof candidate.operation === 'string' && asLiteral(candidate.operation) !== null, `?operation is bound: ${JSON.stringify(candidate)}`)
    assert(asLiteral(candidate.version) !== null && (asLiteral(candidate.version)?.length ?? 0) > 0, `?version is bound: ${JSON.stringify(candidate)}`)
  }
  console.log('[contested-surface-gardend] (2) sync.conflict-candidates: two real rows, real writer/order attribution')

  // ── (3) the cartesian-hazard museum piece: the OLD shape had per-candidate
  //    facts (operationId, version, …) as FLAT REPEATED PREDICATES directly
  //    on the CONFLICT subject itself — `?conflict sync:candidateOperationId
  //    ?opA, ?opB ; sync:candidateVersion ?vA, ?vB`, which a `SELECT
  //    ?operationId ?version WHERE {…}` over ONE subject correlates as a
  //    CARTESIAN PRODUCT (SPARQL has no notion of "these two values came
  //    from the same original candidate"). WS4 D5 moved every per-candidate
  //    fact onto its OWN disjoint `sync:SyncConflictCandidate` node, so the
  //    hazard is not merely avoided by this query's SHAPE — the OLD
  //    question cannot even be asked anymore: the CONFLICT subject itself
  //    (anchored here by `a sync:SyncConflict`) carries NEITHER predicate
  //    directly. Demonstrated, not merely asserted. ─────────────────────
  const legacyShapedQuery = `PREFIX sync: <http://mnemosyne.dev/sync#>
SELECT ?item ?operationId ?version WHERE {
  GRAPH <urn:mnemosyne:local:graph:${GRAPH_ID}:projection:sync-conflicts> {
    ?item a sync:SyncConflict ;
          sync:candidateOperationId ?operationId ;
          sync:candidateVersion ?version .
  }
}`
  const legacyRows = await sparqlQuery(mcp, GRAPH_ID, legacyShapedQuery)
  assert(legacyRows.length === 0, `the legacy flat-predicate shape (WS4 D5 removed) is structurally gone from the CONFLICT subject itself — no cartesian product to even form: ${JSON.stringify(legacyRows)}`)
  // Corroborate the POSITIVE side of the same claim: the per-candidate facts
  // DO exist, just on their OWN disjoint nodes, one candidate per node —
  // never two values of the same predicate on one subject (the structural
  // absence of a cartesian BGP, demonstrated rather than merely inferred
  // from an empty result above).
  const perCandidateNodeQuery = `PREFIX sync: <http://mnemosyne.dev/sync#>
SELECT ?candidate ?operationId ?version WHERE {
  GRAPH <urn:mnemosyne:local:graph:${GRAPH_ID}:projection:sync-conflicts> {
    ?candidate a sync:SyncConflictCandidate ;
               sync:conflict <${itemUri}> ;
               sync:candidateOperationId ?operationId ;
               sync:candidateVersion ?version .
  }
}`
  const perCandidateRows = await sparqlQuery(mcp, GRAPH_ID, perCandidateNodeQuery)
  assert(perCandidateRows.length === 2, `the two candidates' facts live on two DISJOINT nodes, one operationId+version pair each: ${JSON.stringify(perCandidateRows)}`)
  const distinctCandidateSubjects = new Set(perCandidateRows.map((candidateRow) => candidateRow.candidate))
  assert(distinctCandidateSubjects.size === 2, `two genuinely distinct candidate subjects, not one subject with repeated predicates: ${JSON.stringify([...distinctCandidateSubjects])}`)
  console.log('[contested-surface-gardend] (3) the cartesian-hazard museum piece: the legacy flat-predicate shape is gone from the conflict subject; two disjoint candidate nodes carry the real facts instead')

  console.log('[contested-surface-gardend] ALL PROOFS GREEN')
} finally {
  if (cell) await cell.kill()
}
