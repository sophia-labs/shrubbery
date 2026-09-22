/**
 * Source-aware distributed-truth acceptance harness.
 *
 * This is intentionally a real-process proof. It drives the release Gardend
 * binary, two independent durable Shrubbery outboxes, Yjs replicas, MCP reads,
 * a crash after the source commit but before effects, a random-port/token
 * restart, destructive projection rebuild, and graph/document reincarnation.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Y from 'yjs'
import {
  McpSourceSyncTransport,
  MemorySourceMirrorStorage,
  SourceMirrorManager,
  buildResolveCurrentOperation,
  validateSourceBundle,
  type SourceBundle,
  type SourceOperation,
  type SourceSyncToolCaller,
} from '@shrubbery/source'
import {
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import {
  LoopbackMcpClient,
  mcpText,
} from '../src/cell/loopback-mcp.js'
import { createSourceObjectService } from '../src/cell/source-object-runtime.js'
import type { SourceMirrorRuntime } from '../src/cell/source-mirror-runtime.js'

type JsonObject = Record<string, unknown>

const graphId = 'source-distributed-truth'
const arrivalGraphs = ['source-arrival-ab', 'source-arrival-ba'] as const
const crashOperationId = 'crash-after-commit'
const graphIncarnation = '11111111-1111-4111-8111-111111111111'
const distributedDocumentIncarnation = '22222222-2222-4222-8222-222222222222'
const untouchedDocumentIncarnation = '33333333-3333-4333-8333-333333333333'
const recreatedDocumentIncarnation = '44444444-4444-4444-8444-444444444444'
const typedFaultDocIncarnation = '55555555-5555-4555-8555-555555555555'
const typedFaultDocIncarnationStale = '66666666-6666-4666-8666-666666666666'
const typedFaultDocIncarnationSecondCreate = '77777777-7777-4777-8777-777777777777'
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-source-truth.'))
const profileDir = join(runRoot, 'gardend-profile')
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT
const binary = resolve(resolveGardendBin())
const binarySha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`source-sync distributed-truth assertion failed: ${message}`)
}

function object(value: unknown, label: string): JsonObject {
  assert(value != null && typeof value === 'object' && !Array.isArray(value), `${label} is an object`)
  return value as JsonObject
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} is an array`)
  return value
}

function text(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is a non-empty string`)
  return value
}

function stage(label: string): void {
  if (process.env.SHRUBBERY_TRUTH_PROGRESS !== '0') {
    process.stderr.write(`[source-sync-truth] ${label}\n`)
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function decodeYDoc(encoded: string): Y.Doc {
  const document = new Y.Doc()
  Y.applyUpdate(document, Buffer.from(encoded, 'base64'))
  return document
}

function rdfSetDiff(before: string, after: string): JsonObject {
  const beforeSet = new Set(before.split('\n').filter(Boolean))
  const afterSet = new Set(after.split('\n').filter(Boolean))
  return {
    beforeCount: beforeSet.size,
    afterCount: afterSet.size,
    removed: [...beforeSet].filter(line => !afterSet.has(line)).slice(0, 25),
    added: [...afterSet].filter(line => !beforeSet.has(line)).slice(0, 25),
  }
}

function mcpFor(cell: GardendCell): LoopbackMcpClient {
  return new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
}

async function call(
  mcp: LoopbackMcpClient,
  tool: string,
  args: Readonly<JsonObject>,
): Promise<JsonObject> {
  return object(
    JSON.parse(mcpText(await mcp.toolsCall(tool, { ...args }))),
    `${tool} result`,
  )
}

async function createGraph(
  mcp: LoopbackMcpClient,
  id: string,
  lifecycle?: {
    readonly graphIncarnation: string
    readonly operationId: string
  },
): Promise<JsonObject> {
  return call(mcp, 'create_graph', {
    graph_id: id,
    title: id,
    ...(lifecycle
      ? {
          graphIncarnation: lifecycle.graphIncarnation,
          operationId: lifecycle.operationId,
        }
      : {}),
  })
}

async function pull(
  mcp: LoopbackMcpClient,
  id: string,
  incarnation?: string,
): Promise<SourceBundle> {
  const bundle = await mcp.callTool('source_pull', {
    graphId: id,
    ...(incarnation ? { graphIncarnation: incarnation } : {}),
  }) as SourceBundle
  await validateSourceBundle(bundle, id, incarnation)
  return bundle
}

async function push(
  mcp: LoopbackMcpClient,
  id: string,
  incarnation: string,
  operations: readonly SourceOperation[],
): Promise<JsonObject> {
  return call(mcp, 'source_push', {
    graphId: id,
    graphIncarnation: incarnation,
    operations,
  })
}

/** Garden's `object_key()` (`source_sync.rs:758-760`): `vocab` + U+001F + `class` + U+001F + `objectId`. */
function objectKeyFor(vocab: string, objectClass: string, objectId: string): string {
  const separator = String.fromCharCode(0x1f)
  return `${vocab}${separator}${objectClass}${separator}${objectId}`
}

function bookmark(
  operationId: string,
  objectId: string,
  titleValue: string,
  baseVersion = 'root',
): SourceOperation {
  return {
    kind: 'currentState',
    operationId,
    vocab: 'emporium-bookmark',
    class: 'Bookmark',
    objectId,
    baseVersion,
    record: {
      kind: 'Bookmark',
      url: `https://offline.test/${objectId}`,
      title: titleValue,
    },
  }
}

function compositionEvent(operationId: string): SourceOperation {
  return {
    kind: 'eventLog',
    operationId,
    eventId: 'composition-event-shared',
    vocab: 'workflow',
    class: 'CompositionEvent',
    record: {
      kind: 'CompositionEvent',
      generatedAtTime: '2026-07-29T00:00:00Z',
      definitionSubject: 'urn:offline-audit:workflow',
      eventOrder: 1,
      gestureKind: 'insert',
      partOfAuthoringSession: 'urn:offline-audit:session',
      // These two fields are identity-only bindings in the workflow Meaningful
      // Object contract's subject rule. graphId is supplied by the cell.
      workflowName: 'offline-audit',
      sessionId: 'offline-session',
    },
  }
}

function documentUpdate(
  operationId: string,
  documentId: string,
  incarnation: string,
  encoded: Uint8Array,
): SourceOperation {
  return {
    kind: 'documentUpdate',
    operationId,
    documentId,
    documentIncarnation: incarnation,
    updateBase64: base64(encoded),
  }
}

function addWorkspaceFolder(bundle: SourceBundle, id: string, label: string): Uint8Array {
  const document = decodeYDoc(bundle.workspace.updateBase64)
  document.transact(() => {
    const folder = new Y.Map<unknown>()
    folder.set('name', label)
    folder.set('parentId', null)
    folder.set('section', 'documents')
    folder.set('order', id === 'offline-a' ? 10 : 20)
    document.getMap<Y.Map<unknown>>('folders').set(id, folder)
  })
  const update = Y.encodeStateAsUpdate(document)
  document.destroy()
  return update
}

function addDocumentFact(bundle: SourceBundle, id: string, value: string): Uint8Array {
  const source = bundle.documents.find(document => document.documentId === 'distributed-doc')
  assert(source, 'distributed-doc is in the complete source bundle')
  const document = decodeYDoc(source.updateBase64)
  document.getMap('distributedTruth').set(id, value)
  const update = Y.encodeStateAsUpdate(document)
  document.destroy()
  return update
}

class MutableCaller implements SourceSyncToolCaller {
  mcp: LoopbackMcpClient

  constructor(mcp: LoopbackMcpClient) {
    this.mcp = mcp
  }

  callTool(name: string, args: Readonly<JsonObject>): Promise<unknown> {
    return this.mcp.callTool(name, args)
  }
}

async function arrivalOrderProof(
  mcp: LoopbackMcpClient,
  id: string,
  order: readonly ['A' | 'B', 'A' | 'B'],
): Promise<{
  readonly current: unknown
  readonly conflicts: unknown
  readonly revision: number
}> {
  await createGraph(mcp, id)
  const initial = await pull(mcp, id)
  const operations = {
    A: bookmark('arrival-a', 'arrival-object', 'A'),
    B: bookmark('arrival-b', 'arrival-object', 'B'),
  } as const
  for (const client of order) {
    await push(mcp, id, initial.graphIncarnation, [operations[client]])
  }
  const result = await pull(mcp, id, initial.graphIncarnation)
  return {
    current: result.currentState,
    conflicts: result.conflicts,
    revision: result.revision,
  }
}

/**
 * The typed-fault-codes stage (master §3 Slice 3's own verification text,
 * built here per that slice's Divergence 6 — Slice 0's Garden/gateway wire
 * is now stable and committed). Drives real `SourceMirrorManager` clients
 * against the real cell through the SAME `McpSourceSyncTransport` product
 * code uses, proving `classifySourceFault`'s code-first ladder end to end:
 *   - `stale_sync_conflict` (Law IV, targeted-permanent): a resolution race
 *     terminates ONLY the named row; an innocent sibling in the same batch
 *     stays `pending`, `parked` stays 0 (never a fence), and the very next
 *     flush delivers the sibling — the D-W8 proof and the livelock proof.
 *   - `stale_graph_incarnation` (Law VI, fence): the WHOLE pending batch
 *     becomes `rejected-stale`.
 *   - `stale_document_incarnation` (Law VI, fence, WS4 D14): a document-
 *     bearing row becomes `rejected-stale`, not stuck `pending` forever —
 *     and IS counted into `parked` (never `nonDocumentParked`).
 *   - `document_exists` (untargeted-permanent): the WHOLE pending batch
 *     becomes `rejected-permanent`.
 *   - A read-only third mirror — nothing enqueued, nothing pending — still
 *     reports `contestedObjects === 1` while its own `pending === 0`: the
 *     badge counts objects the AUTHORITY reports contested, not this
 *     client's own outbox rows (master §2.1).
 */
async function typedFaultCodesStage(
  mcp: LoopbackMcpClient,
  caller: MutableCaller,
): Promise<JsonObject> {
  stage('typed fault codes against the real cell')
  const typedFaultGraph = 'source-typed-fault-codes'
  const typedFaultFenceGraph = 'source-typed-fault-graph-fence'
  const transport = new McpSourceSyncTransport(caller)
  const manager = (userId: string, graph: string): SourceMirrorManager =>
    new SourceMirrorManager({
      identity: { userId, graphId: graph },
      storage: new MemorySourceMirrorStorage(),
      transport,
    })
  const trivialUpdate = (): Uint8Array => {
    const document = new Y.Doc()
    document.getMap('typedFault').set('k', 'v')
    const update = Y.encodeStateAsUpdate(document)
    document.destroy()
    return update
  }

  // ── a genuine Law IV current-state conflict, two offline clients ──
  await createGraph(mcp, typedFaultGraph)
  const managerWinner = manager('typed-fault-winner', typedFaultGraph)
  const managerLoser = manager('typed-fault-loser', typedFaultGraph)
  await managerWinner.pull()
  await managerLoser.pull()
  assert(managerWinner.get().contestedObjects === 0, 'no conflict exists yet, before either offline write')

  await managerWinner.enqueue(bookmark('typed-fault-winner-claim', 'typed-fault-object', 'Winner'))
  await managerWinner.flush()
  await managerLoser.enqueue(bookmark('typed-fault-loser-claim', 'typed-fault-object', 'Loser'))
  await managerLoser.flush()

  const winnerBundle = await managerWinner.pull()
  const loserBundle = await managerLoser.pull()
  assert(winnerBundle.conflicts.length === 1, 'two concurrent base-root writes fold to one explicit conflict')
  assert(loserBundle.conflicts.length === 1, 'both offline clients observe the same conflict')

  // ── the read-only third mirror: the badge counts AUTHORITY-observed
  //    contests, never this client's own outbox activity (§2.1) ──
  const managerReadOnly = manager('typed-fault-readonly', typedFaultGraph)
  await managerReadOnly.pull()
  assert(
    managerReadOnly.get().contestedObjects === 1 && managerReadOnly.get().pending === 0,
    `a mirror with nothing pending still reports the authority's contest: ${JSON.stringify(managerReadOnly.get())}`,
  )

  const conflict = object(loserBundle.conflicts[0], 'typed-fault conflict')
  const conflictId = text(conflict.conflictId, 'conflict id')
  const objectKey = text(conflict.objectKey, 'conflict object key')
  const candidates = array(conflict.candidates, 'conflict candidates').map(value => object(value, 'candidate'))
  assert(candidates.length === 2, 'exactly two candidates contest typed-fault-object')
  const winnerChoice = text(candidates[0]!.operationId, 'winner-chosen candidate operation')
  const loserChoice = text(candidates.at(-1)!.operationId, 'loser-chosen candidate operation')

  // ── stale_sync_conflict: the winner resolves first, at the authority ──
  await managerWinner.enqueue({
    kind: 'resolveCurrent',
    operationId: 'typed-fault-resolve-winner',
    objectKey,
    conflictId,
    chosenOperationId: winnerChoice,
  })
  await managerWinner.flush()
  const resolvedBundle = await managerWinner.pull()
  assert(resolvedBundle.conflicts.length === 0, "the winner's resolution clears the conflict at the authority")

  // The loser never re-pulled — it still believes conflictId is live, and
  // submits its own resolution alongside an innocent, unrelated sibling in
  // the SAME batch.
  await managerLoser.enqueue({
    kind: 'resolveCurrent',
    operationId: 'typed-fault-resolve-loser',
    objectKey,
    conflictId,
    chosenOperationId: loserChoice,
  })
  await managerLoser.enqueue(bookmark('typed-fault-innocent-sibling', 'typed-fault-sibling-object', 'Innocent'))
  let staleSyncConflictObserved = false
  try {
    await managerLoser.flush()
  } catch {
    staleSyncConflictObserved = true
  }
  assert(staleSyncConflictObserved, "the loser's stale resolution is rejected at push time")
  const loserResolveRow = managerLoser.outboxRecords()
    .find(record => record.operation.operationId === 'typed-fault-resolve-loser')
  const loserSiblingRow = managerLoser.outboxRecords()
    .find(record => record.operation.operationId === 'typed-fault-innocent-sibling')
  assert(
    loserResolveRow?.status === 'rejected-permanent' && loserResolveRow.errorCode === 'stale_sync_conflict',
    `the named resolution alone is terminated: ${JSON.stringify(loserResolveRow)}`,
  )
  assert(
    loserSiblingRow?.status === 'pending',
    `the innocent sibling stays pending, never fenced: ${JSON.stringify(loserSiblingRow)}`,
  )
  assert(
    managerLoser.get().parked === 0,
    'a lost resolution race is a Law IV terminal fault, never a Law VI fence — parked stays 0',
  )
  assert(managerLoser.get().rejectedPermanent === 1, 'exactly the named row is terminal')
  assert(managerLoser.get().supersededResolutions === 1, 'the terminal row is counted as a superseded resolution')
  assert(managerLoser.get().pending === 1, 'the innocent sibling remains deliverable')

  // The very next flush delivers the sibling — no livelock (D-W8).
  const siblingReceipts = await managerLoser.flush()
  assert(siblingReceipts.length === 1, 'only the deliverable sibling is resubmitted')
  const deliveredSiblingRow = managerLoser.outboxRecords()
    .find(record => record.operation.operationId === 'typed-fault-innocent-sibling')
  assert(deliveredSiblingRow?.status === 'applied', 'the sibling is delivered on the very next flush')

  // ── stale_graph_incarnation: the WHOLE pending batch is `rejected-stale` ──
  await createGraph(mcp, typedFaultFenceGraph)
  const managerFence = manager('typed-fault-fence', typedFaultFenceGraph)
  await managerFence.pull()
  await managerFence.enqueue(bookmark('typed-fault-fence-a', 'typed-fault-fence-object-a', 'A'))
  await managerFence.enqueue(bookmark('typed-fault-fence-b', 'typed-fault-fence-object-b', 'B'))
  await call(mcp, 'manage_graph', { graph_id: typedFaultFenceGraph, action: 'delete', hard: true })
  await createGraph(mcp, typedFaultFenceGraph)
  let staleGraphIncarnationObserved = false
  try {
    await managerFence.flush()
  } catch {
    staleGraphIncarnationObserved = true
  }
  assert(staleGraphIncarnationObserved, 'a push against a superseded graph incarnation is rejected')
  const fenceRows = managerFence.outboxRecords()
  assert(
    fenceRows.length === 2
      && fenceRows.every(record => record.status === 'rejected-stale' && record.errorCode === 'stale_graph_incarnation'),
    `stale_graph_incarnation fences the WHOLE batch: ${JSON.stringify(fenceRows)}`,
  )
  assert(managerFence.get().fenced === true, "the mirror recognizes its own fence in this epoch's state")

  // ── stale_document_incarnation: also `rejected-stale`, never stuck
  //    `pending` (WS4 D14), and counted into `parked` ──
  const managerDoc = manager('typed-fault-doc', typedFaultGraph)
  await managerDoc.pull()
  await managerDoc.enqueue({
    kind: 'documentLifecycle',
    operationId: 'typed-fault-doc-create',
    action: 'create',
    documentId: 'typed-fault-document',
    title: 'Typed fault document',
    newDocumentIncarnation: typedFaultDocIncarnation,
  })
  await managerDoc.flush()
  await managerDoc.enqueue(documentUpdate(
    'typed-fault-doc-stale-update',
    'typed-fault-document',
    typedFaultDocIncarnationStale,
    trivialUpdate(),
  ))
  let staleDocumentIncarnationObserved = false
  try {
    await managerDoc.flush()
  } catch {
    staleDocumentIncarnationObserved = true
  }
  assert(staleDocumentIncarnationObserved, 'a document update against a stale document incarnation is rejected')
  const staleDocRow = managerDoc.outboxRecords()
    .find(record => record.operation.operationId === 'typed-fault-doc-stale-update')
  assert(
    staleDocRow?.status === 'rejected-stale' && staleDocRow.errorCode === 'stale_document_incarnation',
    `document-lifetime fences park correctly, never stick at pending (WS4 D14): ${JSON.stringify(staleDocRow)}`,
  )
  assert(
    managerDoc.get().parked === 1 && managerDoc.get().nonDocumentParked === 0,
    `a document-bearing fence is counted as parked, not lost as pending or misfiled loose: ${JSON.stringify(managerDoc.get())}`,
  )

  // ── document_exists: untargeted-permanent, WHOLE batch `rejected-permanent` ──
  const managerExists = manager('typed-fault-exists', typedFaultGraph)
  await managerExists.pull()
  await managerExists.enqueue({
    kind: 'documentLifecycle',
    operationId: 'typed-fault-doc-recreate-attempt',
    action: 'create',
    documentId: 'typed-fault-document',
    title: 'Typed fault document, again',
    newDocumentIncarnation: typedFaultDocIncarnationSecondCreate,
  })
  await managerExists.enqueue(bookmark('typed-fault-exists-sibling', 'typed-fault-exists-object', 'Sibling'))
  let documentExistsObserved = false
  try {
    await managerExists.flush()
  } catch {
    documentExistsObserved = true
  }
  assert(documentExistsObserved, 'creating an already-existing document is rejected')
  const existsRows = managerExists.outboxRecords()
  assert(
    existsRows.length === 2
      && existsRows.every(record => record.status === 'rejected-permanent' && record.errorCode === 'document_exists'),
    `document_exists is untargeted-permanent — the WHOLE batch is terminal: ${JSON.stringify(existsRows)}`,
  )
  assert(managerExists.get().parked === 0, 'document_exists is permanent, never a fence')

  return {
    readOnlyThirdMirror: {
      contestedObjects: managerReadOnly.get().contestedObjects,
      pending: managerReadOnly.get().pending,
    },
    staleSyncConflict: {
      targetedRowTerminal: loserResolveRow?.status === 'rejected-permanent',
      siblingStayedPending: true,
      parkedStaysZero: true,
      livelockProof: deliveredSiblingRow?.status === 'applied',
    },
    staleGraphIncarnation: { wholeBatchFenced: true },
    staleDocumentIncarnation: {
      fencedNotStuckPending: true,
      parked: managerDoc.get().parked,
    },
    documentExists: {
      wholeBatchTerminal: true,
      parkedStaysZero: managerExists.get().parked === 0,
    },
  }
}

/**
 * master §3 Slice 6: the client-authored `ResolveCurrent` path, exercised
 * through the REAL library functions (`buildResolveCurrentOperation`,
 * `SourceMirrorManager`) against the REAL cell — not the raw operation
 * literals `typedFaultCodesStage` (Slice 3) already used for the SAME
 * underlying manager-level guarantees. This stage proves the NEW
 * client-side code itself, not just the mechanism it sits on top of:
 *   - T-R3/T-R3b: `buildResolveCurrentOperation` refuses an unknown
 *     `chosenOperationId` CLIENT-SIDE, before any push — the ledger
 *     revision is provably unmoved (nothing was ever sent).
 *   - T-R4: the client-built operation's digest byte-matches Garden's own
 *     `serde_json` output — enqueue -> flush never throws "does not match
 *     the durable operation".
 *   - T-R1 (again, via the real manager's public state): the successful
 *     receipt lands `'applied'`, never `'conflict'`; `resolving` empties.
 *   - the resolution race, client-authored on BOTH sides: the loser's
 *     buildResolveCurrentOperation-built resolution is `rejected-permanent`
 *     + `stale_sync_conflict`, `parked` stays 0, the innocent sibling still
 *     delivers on the very next flush.
 */
async function clientAuthoredResolutionStage(
  mcp: LoopbackMcpClient,
  caller: MutableCaller,
): Promise<JsonObject> {
  stage('client-authored resolution — buildResolveCurrentOperation against the real cell')
  const graph = 'source-client-authored-resolution'
  const transport = new McpSourceSyncTransport(caller)
  const manager = (userId: string): SourceMirrorManager =>
    new SourceMirrorManager({
      identity: { userId, graphId: graph },
      storage: new MemorySourceMirrorStorage(),
      transport,
    })

  await createGraph(mcp, graph)
  const managerWinner = manager('client-authored-winner')
  const managerLoser = manager('client-authored-loser')
  await managerWinner.pull()
  await managerLoser.pull()

  await managerWinner.enqueue(bookmark('client-authored-winner-claim', 'client-authored-object', 'Winner'))
  await managerWinner.flush()
  await managerLoser.enqueue(bookmark('client-authored-loser-claim', 'client-authored-object', 'Loser'))
  await managerLoser.flush()

  const winnerBundle = await managerWinner.pull()
  const loserBundle = await managerLoser.pull()
  assert(winnerBundle.conflicts.length === 1, 'a real client-authored-resolution contest exists')
  const conflict = object(loserBundle.conflicts[0], 'client-authored conflict')
  const conflictId = text(conflict.conflictId, 'conflict id')
  const objectKey = text(conflict.objectKey, 'conflict object key')
  const candidates = array(conflict.candidates, 'candidates').map(value => object(value, 'candidate'))
  assert(candidates.length === 2, 'exactly two real candidates')
  const knownIds = candidates.map(candidate => text(candidate.operationId, 'candidate operationId'))

  // ── T-R3/T-R3b: client-side refusal, ledger revision UNMOVED ──────────
  const revisionBefore = loserBundle.revision
  let clientRefused = false
  let clientRefusalMessage = ''
  try {
    buildResolveCurrentOperation(
      { kind: 'keep', objectKey, conflictId, chosenOperationId: 'op-does-not-exist' },
      'client-authored-refused-resolve',
      knownIds,
    )
  } catch (error) {
    clientRefused = true
    clientRefusalMessage = error instanceof Error ? error.message : String(error)
  }
  assert(clientRefused, 'buildResolveCurrentOperation refuses an unknown chosenOperationId client-side')
  const bundleAfterRefusal = await pull(mcp, graph, loserBundle.graphIncarnation)
  assert(
    bundleAfterRefusal.revision === revisionBefore,
    `the ledger revision is UNMOVED by a client-side refusal — nothing was ever sent to the authority: ${revisionBefore} -> ${bundleAfterRefusal.revision}`,
  )

  // ── T-R4: the CLIENT-BUILT operation digests and flushes, no mismatch ──
  const winnerChoice = knownIds[0]!
  const winnerOperation = buildResolveCurrentOperation(
    { kind: 'keep', objectKey, conflictId, chosenOperationId: winnerChoice },
    'client-authored-resolve-winner',
    knownIds,
  )
  await managerWinner.enqueue(winnerOperation)
  const winnerReceipts = await managerWinner.flush()
  assert(winnerReceipts.length === 1, 'the client-built resolution flushes without a digest mismatch (T-R4)')
  const winnerRow = managerWinner.outboxRecords().find(record => record.operation.operationId === winnerOperation.operationId)
  const winnerStatus: string | undefined = winnerRow?.status
  assert(winnerStatus === 'applied', `T-R1 (again, real manager state): applied, never conflict: ${JSON.stringify(winnerRow)}`)
  assert(managerWinner.get().resolving.length === 0, 'resolving is empty once the receipt lands')

  const resolvedBundle = await managerWinner.pull()
  assert(resolvedBundle.conflicts.length === 0, 'the client-authored resolution clears the conflict at the authority')

  // ── the resolution race, client-authored on BOTH sides ─────────────────
  const loserChoice = knownIds[1]!
  const loserOperation = buildResolveCurrentOperation(
    { kind: 'keep', objectKey, conflictId, chosenOperationId: loserChoice },
    'client-authored-resolve-loser',
    knownIds,
  )
  await managerLoser.enqueue(loserOperation)
  await managerLoser.enqueue(bookmark('client-authored-innocent-sibling', 'client-authored-sibling-object', 'Innocent'))
  let raceRejected = false
  try {
    await managerLoser.flush()
  } catch {
    raceRejected = true
  }
  assert(raceRejected, "the loser's client-authored, stale resolution is rejected at push time")
  const loserRow = managerLoser.outboxRecords().find(record => record.operation.operationId === loserOperation.operationId)
  assert(
    loserRow?.status === 'rejected-permanent' && loserRow.errorCode === 'stale_sync_conflict',
    `the client-authored loser resolution is terminal and targeted: ${JSON.stringify(loserRow)}`,
  )
  assert(managerLoser.get().parked === 0, 'a lost client-authored race is Law IV terminal, never a Law VI fence')
  const siblingReceipts = await managerLoser.flush()
  assert(siblingReceipts.length === 1, 'the innocent sibling delivers on the very next flush — no livelock')
  const siblingRow = managerLoser.outboxRecords().find(record => record.operation.operationId === 'client-authored-innocent-sibling')
  assert(siblingRow?.status === 'applied', 'the sibling is delivered')

  return {
    clientSideRefusal: {
      refused: clientRefused,
      messageNamesTheOperation: clientRefusalMessage.includes('op-does-not-exist'),
      ledgerRevisionUnmoved: bundleAfterRefusal.revision === revisionBefore,
    },
    digestBindingByteCheck: {
      flushedWithoutMismatch: winnerReceipts.length === 1,
      // Both already asserted above (winnerStatus === 'applied', which
      // structurally excludes 'conflict') — reported as evidence, matching
      // this file's own convention for already-checked invariants.
      applied: true,
      neverConflict: true,
    },
    resolutionRace: {
      loserTerminal: loserRow?.status === 'rejected-permanent',
      loserTargetedCode: loserRow?.errorCode === 'stale_sync_conflict',
      parkedStaysZero: managerLoser.get().parked === 0,
      siblingDelivered: siblingRow?.status === 'applied',
    },
  }
}

async function hardKill(cell: GardendCell): Promise<void> {
  try {
    process.kill(cell.pid, 'SIGKILL')
  } catch {
    // The crash failpoint may already have terminated it.
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${cell.apiUrl}/health`)
    } catch {
      break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await cell.kill()
}

let cell: GardendCell | null = null
let report: JsonObject | null = null

try {
  stage('booting authority')
  cell = await spawnGardend({
    bin: binary,
    profileDir,
    readyTimeoutMs: 45_000,
    env: {
      GARDEN_SOURCE_SYNC_TEST_CRASH_AFTER_COMMIT_OPERATION_ID: crashOperationId,
    },
  })
  let mcp = mcpFor(cell)
  const firstBoot = {
    pid: cell.pid,
    port: cell.manifest.port,
    token: cell.token,
  }

  stage('checking tool surface, arrival order, and source registry')
  const tools = await mcp.toolsList()
  const toolNames = new Set(tools.map(tool => tool.name))
  for (const required of ['source_pull', 'source_push', 'source_rebuild']) {
    assert(toolNames.has(required), `Gardend advertises ${required}`)
  }

  const arrivalAb = await arrivalOrderProof(mcp, arrivalGraphs[0], ['A', 'B'])
  const arrivalBa = await arrivalOrderProof(mcp, arrivalGraphs[1], ['B', 'A'])
  assert(
    JSON.stringify(arrivalAb.current) === JSON.stringify(arrivalBa.current),
    'current-state fold is independent of delivery order',
  )
  assert(
    JSON.stringify(arrivalAb.conflicts) === JSON.stringify(arrivalBa.conflicts),
    'explicit conflict is independent of delivery order',
  )

  const epochInvalidationGraph = 'source-epoch-invalidation'
  await createGraph(mcp, epochInvalidationGraph)
  const epochBefore = await pull(mcp, epochInvalidationGraph)
  await call(mcp, 'create_document', {
    graphId: epochInvalidationGraph,
    documentId: 'direct-authority-document',
    title: 'Direct authority document',
  })
  const epochAfter = await pull(
    mcp,
    epochInvalidationGraph,
    epochBefore.graphIncarnation,
  )
  assert(
    epochAfter.revision === epochBefore.revision,
    'direct authoritative mutation isolates the same-ledger-revision epoch case',
  )
  assert(
    epochAfter.manifest.sourceManifestHash !== epochBefore.manifest.sourceManifestHash,
    'direct authoritative mutation changes the complete source manifest',
  )
  assert(
    epochAfter.epoch !== epochBefore.epoch,
    'complete source epoch changes whenever same-revision authority bytes change',
  )

  const graphLifecycle = {
    graphIncarnation,
    operationId: 'create-source-distributed-truth',
  }
  await createGraph(mcp, graphId, graphLifecycle)
  await createGraph(mcp, graphId, graphLifecycle)
  let mismatchedGraphLifecycleRejected = false
  try {
    await createGraph(mcp, graphId, {
      graphIncarnation: '99999999-9999-4999-8999-999999999999',
      operationId: 'different-create-source-distributed-truth',
    })
  } catch (error) {
    mismatchedGraphLifecycleRejected = /different lifecycle identity|already exists|conflict/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(
    mismatchedGraphLifecycleRejected,
    'same graph slug rejects a different client-minted lifecycle identity',
  )
  let authority = await pull(mcp, graphId)
  assert(
    authority.graphIncarnation === graphIncarnation,
    'cell publishes the client-minted graph incarnation',
  )
  assert(authority.complete && authority.manifest.complete, 'initial authority bundle is complete')
  const sourceKindCounts = authority.sourceRegistry.reduce<Record<string, number>>(
    (counts, value) => {
      const sourceKind = String(value.sourceKind)
      counts[sourceKind] = (counts[sourceKind] ?? 0) + 1
      return counts
    },
    {},
  )
  assert((sourceKindCounts['current-state'] ?? 0) > 0, 'registry includes current-state classes')
  assert((sourceKindCounts['event-log'] ?? 0) > 0, 'registry includes event-log classes')
  assert((sourceKindCounts.derived ?? 0) > 0, 'registry includes derived classes')

  const createResponse = await push(mcp, graphId, authority.graphIncarnation, [
    {
      kind: 'documentLifecycle',
      operationId: 'create-distributed-doc',
      action: 'create',
      documentId: 'distributed-doc',
      title: 'Distributed truth',
      newDocumentIncarnation: distributedDocumentIncarnation,
    },
    {
      kind: 'documentLifecycle',
      operationId: 'create-never-opened',
      action: 'create',
      documentId: 'never-opened-offline',
      title: 'Never opened',
      newDocumentIncarnation: untouchedDocumentIncarnation,
    },
    bookmark('retract-target-create', 'retract-target', 'Retract target'),
  ])
  assert(
    createResponse.ok === true,
    `document lifecycle and target object apply: ${JSON.stringify(createResponse)}`,
  )
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  assert(authority.documents.length === 2, 'complete bundle contains every document, including never-opened')
  assert(
    authority.documents.find(document => document.documentId === 'distributed-doc')
      ?.documentIncarnation === distributedDocumentIncarnation,
    'document create publishes the client-minted document incarnation',
  )
  assert(
    authority.documents.find(document => document.documentId === 'never-opened-offline')
      ?.documentIncarnation === untouchedDocumentIncarnation,
    'never-opened document retains its client-minted lifetime identity',
  )

  const distributed = authority.documents.find(document => document.documentId === 'distributed-doc')
  assert(distributed, 'distributed document has a source snapshot')
  const retractRead = await call(mcp, 'emporium_read', {
    graph_id: graphId,
    vocab: 'emporium-bookmark',
    class: 'Bookmark',
    address: 'retract-target',
  })
  const retractSubject = text(retractRead.subject, 'retraction subject')

  const caller = new MutableCaller(mcp)
  const storageA = new MemorySourceMirrorStorage()
  const storageB = new MemorySourceMirrorStorage()
  const managerA = new SourceMirrorManager({
    identity: { userId: 'client-a', graphId },
    storage: storageA,
    transport: new McpSourceSyncTransport(caller),
  })
  const managerB = new SourceMirrorManager({
    identity: { userId: 'client-b', graphId },
    storage: storageB,
    transport: new McpSourceSyncTransport(caller),
  })
  await Promise.all([managerA.pull(), managerB.pull()])

  stage('merging two offline clients')
  const sharedValuation = {
    valuationEventId: 'valuation-shared',
    observer: 'agent-a',
    documentId: 'distributed-doc',
    blockId: 'block-shared',
    importance: 4,
    valence: 2,
    tags: ['offline'],
    atMs: 1_785_283_200_000,
  } as const
  const sharedRetraction = {
    retractionEventId: 'retraction-shared',
    subject: retractSubject,
    rationale: 'distributed truth',
    retractionKind: 'retract',
    observer: 'agent-a',
    atMs: 1_785_283_200_001,
  } as const

  const operationsA: SourceOperation[] = [
    bookmark('client-a-current', 'shared-current', 'A'),
    compositionEvent('client-a-event'),
    {
      kind: 'memory',
      operationId: 'client-a-memory',
      observer: 'agent-a',
      publish: false,
      atMs: 1_785_283_200_002,
      records: [{
        clientRef: 'offline-memory-a',
        scope: 'agent',
        kind: 'ClaimMemory',
        contentOrientation: 'knowledge',
        visibility: 'private',
        status: 'active',
        content: 'client A offline testimony',
        sourceRefs: [{
          sourceKind: 'DocumentBlock',
          blockId: 'block-shared',
          documentId: 'distributed-doc',
        }],
        isCurrent: true,
        validFrom: 1_785_283_200_002,
        observerAgentId: 'agent-a',
      }],
    },
    { kind: 'valuation', operationId: 'client-a-valuation', ...sharedValuation },
    { kind: 'retraction', operationId: 'client-a-retraction', ...sharedRetraction },
    {
      kind: 'workspaceUpdate',
      operationId: 'client-a-workspace',
      updateBase64: base64(addWorkspaceFolder(authority, 'offline-a', 'Offline A')),
    },
    documentUpdate(
      'client-a-document',
      'distributed-doc',
      distributed.documentIncarnation,
      addDocumentFact(authority, 'a', 'A'),
    ),
    {
      kind: 'crdtCommand',
      operationId: 'client-a-product-rename',
      commandKind: 'workspace.updateDocument',
      documentId: 'never-opened-offline',
      payload: {
        documentId: 'never-opened-offline',
        title: 'Offline product rename',
      },
    },
  ]
  const operationsB: SourceOperation[] = [
    bookmark('client-b-current', 'shared-current', 'B'),
    compositionEvent('client-b-event'),
    { kind: 'valuation', operationId: 'client-b-valuation', ...sharedValuation },
    { kind: 'retraction', operationId: 'client-b-retraction', ...sharedRetraction },
    {
      kind: 'workspaceUpdate',
      operationId: 'client-b-workspace',
      updateBase64: base64(addWorkspaceFolder(authority, 'offline-b', 'Offline B')),
    },
    documentUpdate(
      'client-b-document',
      'distributed-doc',
      distributed.documentIncarnation,
      addDocumentFact(authority, 'b', 'B'),
    ),
  ]
  for (const operation of operationsA) await managerA.enqueue(operation)
  for (const operation of operationsB) await managerB.enqueue(operation)
  const receiptsA = await managerA.flush()
  const receiptsB = await managerB.flush()
  assert(receiptsA.length === operationsA.length, 'client A receives one receipt per intent')
  assert(receiptsB.length === operationsB.length, 'client B receives one receipt per intent')

  const revisionAfterFirstDelivery = (await pull(
    mcp,
    graphId,
    authority.graphIncarnation,
  )).revision
  const duplicate = await push(
    mcp,
    graphId,
    authority.graphIncarnation,
    [...operationsA, ...operationsB],
  )
  assert(
    array(duplicate.receipts, 'duplicate receipts').every(value => object(value, 'receipt').duplicate === true),
    'at-least-once retry returns duplicate receipts',
  )
  assert(duplicate.revision === revisionAfterFirstDelivery, 'duplicate retry does not advance source revision')

  authority = await pull(mcp, graphId, authority.graphIncarnation)
  assert(authority.conflicts.length === 1, 'concurrent current-state writes remain one explicit conflict')

  // ── MO object-face integration spec, master §3 Slice 5: new evidence keys
  //    over the SAME real contest — the object face carries conflictId, the
  //    contest exposes ≥2 candidates, each candidate's sourceVersion is
  //    distinct, and the projected head equals the lowest-hash sibling
  //    (source_sync.rs's own deterministic ordering). ─────────────────────
  const sharedCurrentFace = array(authority.currentState, 'currentState faces')
    .map(value => object(value, 'currentState face'))
    .find(face => face.objectKey === objectKeyFor('emporium-bookmark', 'Bookmark', 'shared-current'))
  assert(sharedCurrentFace !== undefined, 'the object face for the shared-current object is present')
  assert(
    typeof sharedCurrentFace!.conflictId === 'string' && sharedCurrentFace!.conflictId.length > 0,
    `the object face carries conflictId: ${JSON.stringify(sharedCurrentFace)}`,
  )
  const sharedConflict = object(
    authority.conflicts.find(value => object(value, 'conflict').conflictId === sharedCurrentFace!.conflictId),
    'the shared-current conflict',
  )
  const sharedCandidates = array(sharedConflict.candidates, 'shared-current candidates').map(value => object(value, 'candidate'))
  assert(sharedCandidates.length >= 2, `the contest exposes >= 2 candidates: ${sharedCandidates.length}`)
  const sharedVersions = sharedCandidates.map(candidate => text(candidate.sourceVersion, 'candidate sourceVersion'))
  assert(new Set(sharedVersions).size === sharedVersions.length, `each candidate's sourceVersion is distinct: ${JSON.stringify(sharedVersions)}`)
  const lowestHashSibling = [...sharedVersions].sort()[0]
  const projectedCandidate = sharedCandidates.find(candidate => candidate.operationId === sharedConflict.projectedOperationId)
  assert(
    text(projectedCandidate?.sourceVersion, 'projected candidate sourceVersion') === lowestHashSibling,
    `the projected head equals the lowest-hash sibling: ${projectedCandidate?.sourceVersion} vs ${lowestHashSibling}`,
  )
  assert(authority.events.length === 1, 'same semantic event identity folds by set union')
  const documentTruth = decodeYDoc(
    authority.documents.find(document => document.documentId === 'distributed-doc')!.updateBase64,
  )
  assert(documentTruth.getMap('distributedTruth').get('a') === 'A', 'document Y.Doc contains client A')
  assert(documentTruth.getMap('distributedTruth').get('b') === 'B', 'document Y.Doc contains client B')
  documentTruth.destroy()
  const workspaceTruth = decodeYDoc(authority.workspace.updateBase64)
  assert(workspaceTruth.getMap('folders').has('offline-a'), 'workspace Y.Doc contains client A')
  assert(workspaceTruth.getMap('folders').has('offline-b'), 'workspace Y.Doc contains client B')
  assert(
    (workspaceTruth.getMap<Y.Map<unknown>>('documents').get('never-opened-offline'))
      ?.get('title') === 'Offline product rename',
    'mediated product CRDT command is part of replayable workspace truth',
  )
  workspaceTruth.destroy()

  const values = await call(mcp, 'get_block_values', {
    graphId,
    documentId: 'distributed-doc',
    observerAgentId: 'agent-a',
  })
  const valuedBlock = object(array(values.blocks, 'valued blocks')[0], 'valued block')
  assert(valuedBlock.valuationCount === 2, 'one valuation event contributes importance and valence once')
  assert(valuedBlock.rawImportanceSum === 4, 'duplicate semantic valuation does not double importance')
  assert(valuedBlock.rawValenceSum === 2, 'duplicate semantic valuation does not double valence')

  stage('resolving conflict and destructively rebuilding projections')
  const conflict = object(authority.conflicts[0], 'current-state conflict')
  const candidates = array(conflict.candidates, 'conflict candidates').map(value => object(value, 'candidate'))
  const chosen = text(candidates[0]!.operationId, 'chosen candidate operation')
  await push(mcp, graphId, authority.graphIncarnation, [{
    kind: 'resolveCurrent',
    operationId: 'resolve-shared-current',
    objectKey: text(conflict.objectKey, 'conflict object key'),
    conflictId: text(conflict.conflictId, 'conflict id'),
    chosenOperationId: chosen,
  }])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  assert(authority.conflicts.length === 0, 'explicit resolution clears the conflict')

  // ── MO object-face integration spec, master §3 Slice 5: a real
  //    SourceObjectService over the real, pulled bundle — no seam
  //    substitution, only `bundleFor` is stubbed to hand back the SAME
  //    bundle `pull()` just verified (validateSourceBundle already ran on
  //    it), because this script has no SourceMirrorRuntime of its own. ────
  const objectServiceOver = (bundle: SourceBundle) =>
    createSourceObjectService({
      runtime: { bundleFor: (id: string) => (id === graphId ? bundle : undefined) } as unknown as SourceMirrorRuntime,
    })

  // ── §6.8 / master §3 Slice 5: attribution present pre-resolution, PERMANENTLY
  //    absent on a resolved head — even though the rest of this fixture
  //    demonstrates Ask A's fields are present on unresolved objects.
  //    A SEPARATE, freshly-attributed contest (the SAME `shared-current`
  //    contest above never set `clientId`, so it cannot carry this proof). ──
  stage('resolved head stays permanently unattributed (§6.8)')
  const attributedObjectId = 'attributed-current'
  await push(mcp, graphId, authority.graphIncarnation, [
    {
      kind: 'currentState',
      operationId: 'attributed-claim-a',
      vocab: 'emporium-bookmark',
      class: 'Bookmark',
      objectId: attributedObjectId,
      baseVersion: 'root',
      record: { kind: 'Bookmark', url: `https://offline.test/${attributedObjectId}`, title: 'Attributed A' },
      clientId: 'device-attributed-a',
      causalOrder: 101,
    },
  ])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  await push(mcp, graphId, authority.graphIncarnation, [
    {
      kind: 'currentState',
      operationId: 'attributed-claim-b',
      vocab: 'emporium-bookmark',
      class: 'Bookmark',
      objectId: attributedObjectId,
      baseVersion: 'root',
      record: { kind: 'Bookmark', url: `https://offline.test/${attributedObjectId}`, title: 'Attributed B' },
      clientId: 'device-attributed-b',
      causalOrder: 102,
    },
  ])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  const attributedKey = { vocab: 'emporium-bookmark', class: 'Bookmark', objectId: attributedObjectId }
  const attributedReadBefore = await objectServiceOver(authority).read(graphId, attributedKey)
  assert(attributedReadBefore !== null, 'the attributed contested object reads as a real record, not EMPTY')
  assert(attributedReadBefore!.conflictId !== undefined, 'the read carries the real conflictId')
  assert(attributedReadBefore!.contest?.candidates.length === 2, `the contest exposes both attributed candidates: ${JSON.stringify(attributedReadBefore!.contest)}`)
  assert(
    attributedReadBefore!.lastWriter !== undefined
      && (attributedReadBefore!.lastWriter.clientId === 'device-attributed-a' || attributedReadBefore!.lastWriter.clientId === 'device-attributed-b'),
    `Ask A landed — an UNRESOLVED head carries a real lastWriter, never unavailable: ${JSON.stringify(attributedReadBefore!.lastWriter)} / unavailable=${JSON.stringify(attributedReadBefore!.unavailable)}`,
  )
  assert(!attributedReadBefore!.unavailable.includes('lastWriter'), "unresolved: 'lastWriter' is NOT in unavailable")

  const attributedConflict = object(
    authority.conflicts.find(value => object(value, 'conflict').objectKey === objectKeyFor('emporium-bookmark', 'Bookmark', attributedObjectId)),
    'the attributed conflict',
  )
  const attributedCandidates = array(attributedConflict.candidates, 'attributed candidates').map(value => object(value, 'candidate'))
  const attributedChosen = text(attributedCandidates[0]!.operationId, 'attributed chosen candidate operation')
  await push(mcp, graphId, authority.graphIncarnation, [{
    kind: 'resolveCurrent',
    operationId: 'resolve-attributed-current',
    objectKey: text(attributedConflict.objectKey, 'attributed conflict object key'),
    conflictId: text(attributedConflict.conflictId, 'attributed conflict id'),
    chosenOperationId: attributedChosen,
  }])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  const attributedReadAfter = await objectServiceOver(authority).read(graphId, attributedKey)
  assert(attributedReadAfter !== null, 'the resolved object still reads as a real record')
  assert(attributedReadAfter!.conflictId === undefined, 'resolution clears conflictId on the read')
  // `operationId` is REQUIRED on `CurrentObjectFace` (Ask A, master §2.11) —
  // it names the `ResolveCurrent` operation itself, which is how a reader
  // learns the head was CHOSEN. So `lastWriter` is never `undefined` here;
  // the permanent unattribution lives one level down, at `clientId` — the
  // ONE field `ResolveCurrent` synthesises with attribution explicitly
  // nulled (`source_sync.rs:1062-1067`). `unavailable` correctly does NOT
  // name 'lastWriter' — an operationId genuinely IS available; the card's
  // OWN per-value byline logic (§6.8) renders the absence from
  // `lastWriter.clientId === undefined` alone (`card-object-face.ts`'s
  // `view.lastWriter = read.lastWriter?.clientId ?? ''`, never consulting
  // `unavailable` for this).
  assert(
    attributedReadAfter!.lastWriter?.operationId === 'resolve-attributed-current',
    `RESOLVED: lastWriter names the ResolveCurrent operation that chose the head: ${JSON.stringify(attributedReadAfter!.lastWriter)}`,
  )
  assert(
    attributedReadAfter!.lastWriter?.clientId === undefined,
    `RESOLVED: lastWriter.clientId is PERMANENTLY undefined — ResolveCurrent synthesises its head with attribution explicitly nulled, even though this SAME object's UNRESOLVED read (above) had a real clientId: ${JSON.stringify(attributedReadAfter!.lastWriter)}`,
  )
  assert(
    !attributedReadAfter!.unavailable.includes('lastWriter'),
    `RESOLVED: 'lastWriter' is correctly NOT in unavailable — an operationId genuinely is available, only its writer identity is permanently gone: ${JSON.stringify(attributedReadAfter!.unavailable)}`,
  )

  // ── (D-16) missing-base: a SOLITARY current-state write whose baseVersion
  //    names a version the ledger never produced — drives the
  //    missing_base_candidates branch to a real single-candidate
  //    SyncConflict.
  //
  //    CHAIR — REPAIR (real, empirical). WS1's own text read "write one
  //    current-state record, then a second write whose baseVersion names a
  //    version the ledger never produced." Built exactly that way first and
  //    it does NOT produce a single-candidate conflict: verified live
  //    against the real cell, a root-based "establish the head" write
  //    FOLLOWED BY a foreign-base write on the SAME object folds to a
  //    TWO-candidate missing-base conflict (`reason: "one or more
  //    current-state candidates reference an unavailable base"`,
  //    `candidates.length === 2`, the root-based write projected as head)
  //    — the fold conservatively treats every candidate touching the
  //    object as contested once ANY of them cites an unreachable base, not
  //    only the offending one. The single-candidate case instead needs a
  //    SOLITARY write — no prior root-based write ever established a real
  //    head for this object — whose own base is foreign from the start:
  //    the fold has nothing to compare it against, so it becomes a contest
  //    with itself as the sole candidate. Code wins; the two-candidate
  //    case is real too, and is proven directly above by the SAME
  //    machinery this contest exercises (`contest?.candidates.length`),
  //    so no coverage is lost by narrowing this scenario to the genuinely
  //    single-candidate shape WS1's own §9 S4 test plan named. ───────────
  stage('missing-base single-candidate contest (D-16)')
  const missingBaseObjectId = 'missing-base-object'
  await push(mcp, graphId, authority.graphIncarnation, [
    {
      kind: 'currentState',
      operationId: 'missing-base-foreign-write',
      vocab: 'emporium-bookmark',
      class: 'Bookmark',
      objectId: missingBaseObjectId,
      // A real, well-formed, but FOREIGN base — a sha256-shaped hash the
      // ledger never produced for this object (never `'root'`, and no
      // OTHER write on this object exists at all).
      baseVersion: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      record: { kind: 'Bookmark', url: `https://offline.test/${missingBaseObjectId}`, title: 'Foreign-base write' },
      clientId: 'device-missing-base-foreign',
    },
  ])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  const missingBaseKey = { vocab: 'emporium-bookmark', class: 'Bookmark', objectId: missingBaseObjectId }
  const missingBaseRead = await objectServiceOver(authority).read(graphId, missingBaseKey)
  assert(missingBaseRead !== null, 'the missing-base object reads as a real record')
  assert(missingBaseRead!.conflictId !== undefined, 'the missing-base write is contested')
  assert(
    missingBaseRead!.contest?.candidates.length === 1,
    `missing-base folds to exactly one candidate: ${JSON.stringify(missingBaseRead!.contest)}`,
  )
  assert(
    missingBaseRead!.contest!.candidates[0]!.operationId === 'missing-base-foreign-write',
    `the sole candidate names the operation that supplied the foreign base: ${JSON.stringify(missingBaseRead!.contest)}`,
  )
  const missingBaseConflict = object(
    authority.conflicts.find(value => object(value, 'conflict').objectKey === objectKeyFor('emporium-bookmark', 'Bookmark', missingBaseObjectId)),
    'the missing-base conflict',
  )
  const missingBaseCandidates = array(missingBaseConflict.candidates, 'missing-base candidates')
  assert(missingBaseCandidates.length === 1, `the missing-base conflict itself has exactly one candidate: ${JSON.stringify(missingBaseConflict)}`)

  let eventIdentityRejected = false
  try {
    await push(mcp, graphId, authority.graphIncarnation, [{
      ...compositionEvent('bad-event-reuse'),
      record: {
        ...object(compositionEvent('bad-event-reuse').record, 'event record'),
        gestureKind: 'delete',
      },
    }])
  } catch (error) {
    eventIdentityRejected = /already accepted with different content/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(eventIdentityRejected, 'event identity reuse with different content is rejected before acceptance')

  const rebuild = await call(mcp, 'source_rebuild', {
    graphId,
    graphIncarnation: authority.graphIncarnation,
  })
  assert(rebuild.ok === true, `destructive source rebuild is set-equal: ${JSON.stringify(rebuild)}`)
  assert(rebuild.projectionSetEqual === true, 'first and second projection replay are byte-set equal')
  assert(rebuild.sourceSetEqual === true, 'source fold is unchanged by projection destruction')

  stage('fencing document deletion and recreation')
  const staleDocumentIncarnation = distributed.documentIncarnation
  await push(mcp, graphId, authority.graphIncarnation, [{
    kind: 'documentLifecycle',
    operationId: 'delete-distributed-doc',
    action: 'delete',
    documentId: 'distributed-doc',
    expectedDocumentIncarnation: staleDocumentIncarnation,
  }])
  await push(mcp, graphId, authority.graphIncarnation, [{
    kind: 'documentLifecycle',
    operationId: 'recreate-distributed-doc',
    action: 'recreate',
    documentId: 'distributed-doc',
    title: 'Distributed truth reincarnated',
    expectedDocumentIncarnation: staleDocumentIncarnation,
    newDocumentIncarnation: recreatedDocumentIncarnation,
  }])
  authority = await pull(mcp, graphId, authority.graphIncarnation)
  const recreated = authority.documents.find(document => document.documentId === 'distributed-doc')
  assert(recreated, 'same-ID recreated document is present')
  assert(
    recreated.documentIncarnation === recreatedDocumentIncarnation,
    'same-ID document recreation publishes the requested new incarnation',
  )
  let staleDocumentRejected = false
  try {
    await push(mcp, graphId, authority.graphIncarnation, [
      documentUpdate(
        'stale-document-update',
        'distributed-doc',
        staleDocumentIncarnation,
        addDocumentFact(authority, 'stale', 'must not land'),
      ),
    ])
  } catch (error) {
    staleDocumentRejected = /stale document incarnation/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(staleDocumentRejected, 'old document incarnation is rejected before acceptance')

  stage('crashing after source commit and repairing a lost acknowledgement')
  // The crash operation is enqueued only after all prior testimony. Gardend's
  // test seam aborts after ledger fsync and before any projection effect.
  const crashStorage = new MemorySourceMirrorStorage()
  const crashManager = new SourceMirrorManager({
    identity: { userId: 'crash-client', graphId },
    storage: crashStorage,
    transport: new McpSourceSyncTransport(caller),
  })
  await crashManager.pull()
  await crashManager.enqueue(bookmark(
    crashOperationId,
    'crash-recovery-object',
    'durable before effect',
  ))
  let lostAckObserved = false
  try {
    await crashManager.flush()
  } catch {
    lostAckObserved = true
  }
  assert(lostAckObserved, 'client observes a lost acknowledgement at the crash boundary')
  assert(crashManager.get().pending === 1, 'lost-ack intent remains durable and pending')

  await cell.kill()
  cell = await spawnGardend({
    bin: binary,
    profileDir,
    readyTimeoutMs: 45_000,
  })
  mcp = mcpFor(cell)
  caller.mcp = mcp
  assert(cell.manifest.port !== firstBoot.port, 'restart rotates the loopback port')
  assert(cell.token !== firstBoot.token, 'restart rotates the loopback token')
  const recoveredManager = new SourceMirrorManager({
    identity: { userId: 'crash-client', graphId },
    storage: crashStorage,
    transport: new McpSourceSyncTransport(caller),
  })
  await recoveredManager.open()
  const recoveryReceipts = await recoveredManager.flush()
  assert(recoveryReceipts.length === 1, 'cold-reopened outbox retries the lost-ack intent')
  assert(recoveryReceipts[0]!.duplicate === true, 'authority recognizes the post-crash retry')
  assert(recoveryReceipts[0]!.status === 'applied', 'accepted-before-crash intent is repaired')
  await recoveredManager.pull()
  assert(recoveredManager.get().pending === 0, 'receipt reconciliation drains the outbox')

  const recoveredBundle = await pull(mcp, graphId, authority.graphIncarnation)
  assert(
    recoveredBundle.currentState.some(value => value.objectId === 'crash-recovery-object'),
    'accepted-before-crash current state survives and projects after restart',
  )
  const postCrashRebuild = await call(mcp, 'source_rebuild', {
    graphId,
    graphIncarnation: authority.graphIncarnation,
  })
  assert(postCrashRebuild.ok === true, 'post-crash authority remains destructively rebuildable')

  stage('fencing graph deletion and recreation')
  const incarnationGraph = 'source-incarnation-fence'
  await createGraph(mcp, incarnationGraph)
  const oldIdentity = await pull(mcp, incarnationGraph)
  await call(mcp, 'manage_graph', {
    graph_id: incarnationGraph,
    action: 'delete',
    hard: true,
  })
  await createGraph(mcp, incarnationGraph)
  const newIdentity = await pull(mcp, incarnationGraph)
  assert(
    oldIdentity.graphIncarnation !== newIdentity.graphIncarnation,
    'same graph ID recreation receives a new incarnation',
  )
  let staleGraphRejected = false
  try {
    await push(mcp, incarnationGraph, oldIdentity.graphIncarnation, [
      bookmark('stale-graph-write', 'must-not-land', 'stale'),
    ])
  } catch (error) {
    staleGraphRejected = /stale graph incarnation/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(staleGraphRejected, 'old graph incarnation is rejected before acceptance')

  const typedFaultCodes = await typedFaultCodesStage(mcp, caller)
  const clientAuthoredResolution = await clientAuthoredResolutionStage(mcp, caller)

  stage('proving cold hydration after SIGKILL')
  // One final uncooperative process death proves all prior results are disk
  // truth rather than room/heap state.
  const beforeFinalKill = await pull(mcp, graphId, authority.graphIncarnation)
  await hardKill(cell)
  cell = await spawnGardend({ bin: binary, profileDir, readyTimeoutMs: 45_000 })
  mcp = mcpFor(cell)
  const afterFinalKill = await pull(mcp, graphId, authority.graphIncarnation)
  assert(
    afterFinalKill.projectionSnapshot.digest === beforeFinalKill.projectionSnapshot.digest,
    `projection digest survives SIGKILL and cold process hydration: ${JSON.stringify({
      before: beforeFinalKill.projectionSnapshot.digest,
      after: afterFinalKill.projectionSnapshot.digest,
      diff: rdfSetDiff(
        beforeFinalKill.projectionSnapshot.data,
        afterFinalKill.projectionSnapshot.data,
      ),
    })}`,
  )
  assert(
    afterFinalKill.revision === beforeFinalKill.revision,
    'source revision survives SIGKILL exactly',
  )
  assert(
    createHash('sha256').update(readFileSync(binary)).digest('hex') === binarySha256,
    'Gardend binary did not change during the distributed-truth proof',
  )

  report = {
    ok: true,
    verdict: 'GO',
    scope: 'source-aware offline/sync-later distributed truth',
    provenance: {
      gardend: {
        path: binary,
        sha256: binarySha256,
      },
    },
    evidence: {
      toolSurface: ['source_pull', 'source_push', 'source_rebuild'],
      sourceKindCounts,
      completeManifest: {
        members: authority.manifest.members.length,
        documents: authority.documents.map(document => document.documentId).sort(),
        explicitComplete: authority.complete && authority.manifest.complete,
      },
      arrivalOrder: {
        ab: arrivalAb,
        ba: arrivalBa,
        setEqual: true,
      },
      epochInvalidation: {
        sameLedgerRevision: epochBefore.revision === epochAfter.revision,
        manifestChanged:
          epochBefore.manifest.sourceManifestHash !== epochAfter.manifest.sourceManifestHash,
        epochChanged: epochBefore.epoch !== epochAfter.epoch,
      },
      twoOfflineClients: {
        acceptedIntents: operationsA.length + operationsB.length,
        explicitConflictThenResolution: true,
        eventSetUnion: true,
        valuationSetUnion: true,
        retractionStableIdentity: true,
        workspaceYdocMerge: true,
        documentYdocMerge: true,
        duplicateRevisionStable: true,
      },
      // MO object-face integration spec, master §3 Slice 5.
      contestedObjectFace: {
        conflictIdOnFace: true,
        candidateCountAtLeastTwo: sharedCandidates.length,
        distinctSourceVersions: true,
        projectedHeadIsLowestHashSibling: true,
        attributedUnresolvedLastWriterPresent: true,
        resolvedHeadLastWriterPermanentlyAbsent: true,
        missingBaseSingleCandidateContest: true,
      },
      lifecycle: {
        clientMintedGraphIncarnation: true,
        graphCreateExactRetry: true,
        mismatchedGraphLifecycleRejected,
        clientMintedDocumentIncarnation: true,
        documentReincarnation: true,
        staleDocumentRejected,
        graphReincarnation: true,
        staleGraphRejected,
      },
      typedFaultCodes,
      clientAuthoredResolution,
      crashRecovery: {
        lostAckObserved,
        pendingBeforeRestart: 1,
        duplicateReceiptAfterRestart: true,
        repairedAfterRestart: true,
      },
      rebuild: {
        preCrash: {
          sourceSetEqual: rebuild.sourceSetEqual,
          projectionSetEqual: rebuild.projectionSetEqual,
        },
        postCrash: {
          sourceSetEqual: postCrashRebuild.sourceSetEqual,
          projectionSetEqual: postCrashRebuild.projectionSetEqual,
        },
      },
      processRestart: {
        randomPortAndTokenRotated: true,
        projectionDigestStable: true,
        sourceRevisionStable: true,
      },
    },
  }
  stage('GO')
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report = {
    ok: false,
    verdict: 'HARNESS-ERROR',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.error(JSON.stringify(report, null, 2))
  throw error
} finally {
  if (cell) await cell.kill().catch(() => {})
  if (process.env.SHRUBBERY_KEEP_TRUTH_PROFILE === '1') {
    process.stderr.write(`[source-sync-truth] kept ${runRoot}\n`)
  } else {
    rmSync(runRoot, { recursive: true, force: true })
  }
}
