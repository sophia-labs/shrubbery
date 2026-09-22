/**
 * Seeded, model-based source-sync chaos against a real release Gardend.
 *
 * For each seed, two independent graph authorities receive the same offline
 * operation set through different client schedules. Faulty transports inject
 * failures before acceptance, lost acknowledgements after acceptance, partial
 * receipt sets, and bad receipt digests. Managers are cold-reopened over their
 * durable stores, Gardend is SIGKILLed between deliveries, all operations are
 * replayed in shuffled duplicate batches, and both authorities are
 * destructively rebuilt. The oracle compares logical source truth rather than
 * arrival history or graph-specific projection IRIs.
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
  validateSourceBundle,
  type SourceBundle,
  type SourceOperation,
  type SourcePushResult,
  type SourceSyncToolCaller,
  type SourceSyncTransport,
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

type JsonObject = Record<string, unknown>
type FaultMode = 'none' | 'before' | 'after' | 'partial' | 'bad-digest'

const defaultSeeds = [11, 29, 47]
const seeds = (process.env.SHRUBBERY_CHAOS_SEEDS
  ? process.env.SHRUBBERY_CHAOS_SEEDS.split(',').map(value => Number(value.trim()))
  : defaultSeeds)
  .filter(value => Number.isSafeInteger(value) && value >= 0)
const clientCount = Number(process.env.SHRUBBERY_CHAOS_CLIENTS ?? 5)
const graphPrefix = process.env.SHRUBBERY_CHAOS_GRAPH_PREFIX ?? 'source-chaos'
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-source-chaos.'))
const profileDir = join(runRoot, 'gardend-profile')
const binary = resolve(resolveGardendBin())
const binarySha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')

if (seeds.length === 0) throw new Error('source-sync chaos requires at least one numeric seed')
if (!Number.isSafeInteger(clientCount) || clientCount < 3 || clientCount > 12) {
  throw new Error('SHRUBBERY_CHAOS_CLIENTS must be an integer between 3 and 12')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`source-sync chaos assertion failed: ${message}`)
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
    process.stderr.write(`[source-sync-chaos] ${label}\n`)
  }
}

function rngFor(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target]!, result[index]!]
  }
  return result
}

function uuid(seed: number, lane: number, kind: number): string {
  const tail = (
    (BigInt(seed) << 16n)
    | (BigInt(lane & 0xff) << 8n)
    | BigInt(kind & 0xff)
  ).toString(16).padStart(12, '0').slice(-12)
  return `10000000-0000-4000-8000-${tail}`
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function yMapUpdate(
  mapName: string,
  key: string,
  value: string,
  clientId: number,
): string {
  const document = new Y.Doc()
  document.clientID = clientId
  document.getMap(mapName).set(key, value)
  const update = base64(Y.encodeStateAsUpdate(document))
  document.destroy()
  return update
}

function decodeMap(updateBase64: string, mapName: string): Record<string, unknown> {
  const document = new Y.Doc()
  Y.applyUpdate(document, Buffer.from(updateBase64, 'base64'))
  const result = Object.fromEntries(
    [...document.getMap(mapName).entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
  document.destroy()
  return result
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

async function pull(
  mcp: LoopbackMcpClient,
  graphId: string,
  graphIncarnation?: string,
): Promise<SourceBundle> {
  const bundle = await mcp.callTool('source_pull', {
    graphId,
    ...(graphIncarnation ? { graphIncarnation } : {}),
  }) as SourceBundle
  await validateSourceBundle(bundle, graphId, graphIncarnation)
  return bundle
}

async function push(
  mcp: LoopbackMcpClient,
  graphId: string,
  graphIncarnation: string,
  operations: readonly SourceOperation[],
): Promise<SourcePushResult> {
  return await mcp.callTool('source_push', {
    graphId,
    graphIncarnation,
    operations,
  }) as SourcePushResult
}

class MutableCaller implements SourceSyncToolCaller {
  constructor(public mcp: LoopbackMcpClient) {}

  callTool(name: string, args: Readonly<JsonObject>): Promise<unknown> {
    return this.mcp.callTool(name, args)
  }
}

class FaultTransport implements SourceSyncTransport {
  private readonly delegate: McpSourceSyncTransport
  private faultUsed = false

  constructor(
    caller: SourceSyncToolCaller,
    readonly mode: FaultMode,
  ) {
    this.delegate = new McpSourceSyncTransport(caller)
  }

  pull(graphId: string, graphIncarnation?: string): Promise<SourceBundle> {
    return this.delegate.pull(graphId, graphIncarnation)
  }

  async push(
    graphId: string,
    graphIncarnation: string,
    operations: readonly SourceOperation[],
  ): Promise<SourcePushResult> {
    const fault = this.faultUsed ? 'none' : this.mode
    this.faultUsed = true
    if (fault === 'before') throw new Error('injected 503 before source acceptance')
    const result = await this.delegate.push(graphId, graphIncarnation, operations)
    if (fault === 'after') throw new Error('injected lost acknowledgement after source acceptance')
    if (fault === 'partial') {
      return { ...result, receipts: result.receipts.slice(1) }
    }
    if (fault === 'bad-digest') {
      return {
        ...result,
        receipts: result.receipts.map((receipt, index) => index === 0
          ? { ...receipt, digest: '0'.repeat(64) }
          : receipt),
      }
    }
    return result
  }
}

function bookmark(
  operationId: string,
  objectId: string,
  title: string,
): SourceOperation {
  return {
    kind: 'currentState',
    operationId,
    vocab: 'emporium-bookmark',
    class: 'Bookmark',
    objectId,
    baseVersion: 'root',
    record: {
      kind: 'Bookmark',
      url: `https://chaos.invalid/${objectId}`,
      title,
    },
  }
}

function compositionEvent(
  operationId: string,
  eventGroup: number,
): SourceOperation {
  return {
    kind: 'eventLog',
    operationId,
    eventId: `chaos-composition-${eventGroup}`,
    vocab: 'workflow',
    class: 'CompositionEvent',
    record: {
      kind: 'CompositionEvent',
      generatedAtTime: `2026-07-${String(eventGroup + 1).padStart(2, '0')}T00:00:00Z`,
      definitionSubject: `urn:chaos:workflow:${eventGroup}`,
      eventOrder: eventGroup,
      gestureKind: 'insert',
      partOfAuthoringSession: `urn:chaos:session:${eventGroup}`,
      workflowName: `chaos-${eventGroup}`,
      sessionId: `chaos-session-${eventGroup}`,
    },
  }
}

interface ClientPlan {
  readonly index: number
  readonly operations: readonly SourceOperation[]
}

function clientPlans(seed: number, documentIncarnation: string): ClientPlan[] {
  return Array.from({ length: clientCount }, (_, index) => {
    const prefix = `s${seed}.c${index}`
    const eventGroup = index % 2
    // Exercise the accepted clock range at both extremes: Unix epoch and a
    // far-future (but still exactly representable) client clock.
    const atMs = eventGroup === 0 ? 0 : 4_000_000_000_000
    const operations: SourceOperation[] = [
      bookmark(`${prefix}.unique`, `${prefix}.unique`, `unique-${seed}-${index}`),
      bookmark(`${prefix}.shared`, `s${seed}.shared`, `candidate-${index}`),
      compositionEvent(`${prefix}.event`, eventGroup),
      {
        kind: 'memory',
        operationId: `${prefix}.memory`,
        observer: `chaos-agent-${index}`,
        publish: false,
        atMs,
        records: [{
          clientRef: `${prefix}.memory`,
          scope: 'agent',
          kind: 'ClaimMemory',
          contentOrientation: 'knowledge',
          visibility: 'private',
          status: 'active',
          content: `offline testimony ${seed}/${index}`,
          sourceRefs: [{
            sourceKind: 'DocumentBlock',
            blockId: 'chaos-block',
            documentId: 'chaos-document',
          }],
          isCurrent: true,
          validFrom: atMs,
          observerAgentId: `chaos-agent-${index}`,
        }],
      },
      {
        kind: 'valuation',
        operationId: `${prefix}.valuation`,
        valuationEventId: `s${seed}.valuation-${eventGroup}`,
        observer: 'chaos-observer',
        documentId: 'chaos-document',
        blockId: 'chaos-block',
        importance: eventGroup + 2,
        valence: eventGroup === 0 ? -2 : 3,
        tags: [`group-${eventGroup}`],
        atMs,
      },
      {
        kind: 'workspaceUpdate',
        operationId: `${prefix}.workspace`,
        updateBase64: yMapUpdate(
          'chaosTruth',
          `${prefix}.workspace`,
          `workspace-${index}`,
          10_000 + seed * 100 + index,
        ),
      },
      {
        kind: 'documentUpdate',
        operationId: `${prefix}.document`,
        documentId: 'chaos-document',
        documentIncarnation,
        updateBase64: yMapUpdate(
          'chaosTruth',
          `${prefix}.document`,
          `document-${index}`,
          20_000 + seed * 100 + index,
        ),
      },
    ]
    return { index, operations }
  })
}

function logicalTruth(bundle: SourceBundle): JsonObject {
  const document = bundle.documents.find(candidate => candidate.documentId === 'chaos-document')
  assert(document, 'chaos document exists in complete bundle')
  const sourceOperationIds = bundle.receipts
    .map(receipt => receipt.operationId)
    .filter(operationId => !operationId.endsWith('.setup-document'))
    .sort()
  const current = bundle.currentState
    .filter(value => typeof value.objectId === 'string' && String(value.objectId).includes('.'))
    .map(value => ({
      objectKey: value.objectKey,
      objectId: value.objectId,
      sourceVersion: value.sourceVersion,
      record: value.record,
      conflictId: value.conflictId ?? null,
    }))
    .sort((left, right) => String(left.objectKey).localeCompare(String(right.objectKey)))
  const conflicts = bundle.conflicts
    .map(value => ({
      conflictId: value.conflictId,
      objectKey: value.objectKey,
      reason: value.reason,
      projectedOperationId: value.projectedOperationId,
      candidates: Array.isArray(value.candidates)
        ? [...value.candidates].sort((left, right) =>
          String((left as JsonObject).operationId).localeCompare(
            String((right as JsonObject).operationId),
          ))
        : value.candidates,
    }))
    .sort((left, right) => String(left.objectKey).localeCompare(String(right.objectKey)))
  return {
    revision: bundle.revision,
    current,
    conflicts,
    eventIds: bundle.events.map(value => String(value.eventId)).sort(),
    memoryOperationIds: bundle.memory.map(value => String(value.operationId)).sort(),
    valuationOperationIds: bundle.valuations.map(value => String(value.operationId)).sort(),
    workspaceTruth: decodeMap(bundle.workspace.updateBase64, 'chaosTruth'),
    documentTruth: decodeMap(document.updateBase64, 'chaosTruth'),
    sourceOperationIds,
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as JsonObject
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

async function hardKill(cell: GardendCell): Promise<void> {
  try {
    process.kill(cell.pid, 'SIGKILL')
  } catch {
    // Process may already be exiting.
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

interface ManagedClient {
  readonly index: number
  readonly storage: MemorySourceMirrorStorage
  readonly transport: FaultTransport
  manager: SourceMirrorManager
}

function newManager(
  graphId: string,
  client: ManagedClient,
): SourceMirrorManager {
  return new SourceMirrorManager({
    identity: { userId: `chaos-client-${client.index}`, graphId },
    storage: client.storage,
    transport: client.transport,
  })
}

async function deliverWithColdRetry(
  graphId: string,
  client: ManagedClient,
): Promise<number> {
  let observedFaults = 0
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await client.manager.flush()
    } catch {
      observedFaults += 1
      client.manager = newManager(graphId, client)
      await client.manager.open()
      continue
    }
    if (client.manager.get().pending === 0) return observedFaults
  }
  throw new Error(
    `client ${client.index} did not settle after bounded cold retries: `
    + JSON.stringify({
      state: client.manager.get(),
      outbox: client.manager.outboxRecords().map(record => ({
        operationId: record.operation.operationId,
        kind: record.operation.kind,
        status: record.status,
        attempts: record.attempts,
        error: record.error,
      })),
    }),
  )
}

async function createChaosGraph(
  mcp: LoopbackMcpClient,
  graphId: string,
  graphIncarnation: string,
  documentIncarnation: string,
  setupOperationId: string,
): Promise<SourceBundle> {
  await call(mcp, 'create_graph', {
    graph_id: graphId,
    title: graphId,
    graphIncarnation,
    operationId: `${setupOperationId}.graph`,
  })
  const initial = await pull(mcp, graphId, graphIncarnation)
  const created = await push(mcp, graphId, graphIncarnation, [{
    kind: 'documentLifecycle',
    operationId: `${setupOperationId}.setup-document`,
    action: 'create',
    documentId: 'chaos-document',
    title: 'Chaos document',
    newDocumentIncarnation: documentIncarnation,
  }])
  assert(created.ok === true, `setup document applies for ${graphId}`)
  const bundle = await pull(mcp, graphId, graphIncarnation)
  assert(bundle.revision === initial.revision + 1, 'setup advances source revision once')
  return bundle
}

async function invalidBatchAtomicity(
  mcp: LoopbackMcpClient,
  seed: number,
): Promise<JsonObject> {
  const graphId = `${graphPrefix}-${seed}-atomic`
  const graphIncarnation = uuid(seed, 9, 1)
  await call(mcp, 'create_graph', {
    graph_id: graphId,
    title: graphId,
    graphIncarnation,
    operationId: `s${seed}.atomic.graph`,
  })
  const before = await pull(mcp, graphId, graphIncarnation)
  let collisionRejected = false
  try {
    await push(mcp, graphId, graphIncarnation, [
      bookmark(`s${seed}.atomic.valid`, `s${seed}.atomic.valid`, 'must roll back'),
      bookmark(`s${seed}.atomic.collision`, `s${seed}.atomic.collision`, 'first'),
      bookmark(`s${seed}.atomic.collision`, `s${seed}.atomic.collision`, 'different'),
    ])
  } catch (error) {
    collisionRejected = /operationId .*different content|already accepted with different content/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(collisionRejected, 'mixed batch rejects operation identity collision')
  const afterCollision = await pull(mcp, graphId, graphIncarnation)
  assert(afterCollision.revision === before.revision, 'invalid mixed batch commits no prefix')
  assert(
    !afterCollision.currentState.some(value => value.objectId === `s${seed}.atomic.valid`),
    'valid prefix of invalid batch is absent',
  )

  const oversize = Array.from({ length: 1_001 }, (_, index): SourceOperation => ({
    kind: 'graphMetadata',
    operationId: `s${seed}.oversize.${index}`,
    title: `oversize-${index}`,
  }))
  let oversizeRejected = false
  try {
    await push(mcp, graphId, graphIncarnation, oversize)
  } catch (error) {
    oversizeRejected = /requires 1\\.\\.=1000 operations|requires 1..=1000 operations/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(oversizeRejected, 'oversize source batch is rejected')
  const afterOversize = await pull(mcp, graphId, graphIncarnation)
  assert(afterOversize.revision === before.revision, 'oversize rejection leaves revision unchanged')
  return {
    collisionRejected,
    prefixAtomic: afterCollision.revision === before.revision,
    oversizeRejected,
    oversizeAtomic: afterOversize.revision === before.revision,
  }
}

interface GraphRunResult {
  readonly graphId: string
  readonly graphIncarnation: string
  readonly bundle: SourceBundle
  readonly logical: JsonObject
  readonly injectedFaultsObserved: number
  readonly duplicateBatches: number
  readonly rebuild: JsonObject
}

async function runGraph(
  caller: MutableCaller,
  seed: number,
  lane: number,
  plans: readonly ClientPlan[],
  schedule: readonly number[],
  concurrent: boolean,
  restartHalfway: () => Promise<void>,
): Promise<GraphRunResult> {
  const graphId = `${graphPrefix}-${seed}-${lane === 0 ? 'a' : 'b'}`
  const graphIncarnation = uuid(seed, lane, 1)
  const documentIncarnation = uuid(seed, lane, 2)
  const setupOperationId = `s${seed}.lane${lane}`
  const baseline = await createChaosGraph(
    caller.mcp,
    graphId,
    graphIncarnation,
    documentIncarnation,
    setupOperationId,
  )
  const modes: FaultMode[] = ['before', 'after', 'partial', 'bad-digest', 'none']
  const clients: ManagedClient[] = plans.map(plan => {
    const transport = new FaultTransport(caller, modes[(plan.index + lane) % modes.length]!)
    const storage = new MemorySourceMirrorStorage()
    const holder = {
      index: plan.index,
      storage,
      transport,
      manager: undefined as unknown as SourceMirrorManager,
    }
    holder.manager = newManager(graphId, holder)
    return holder
  })
  await Promise.all(clients.map(async (client, index) => {
    await client.manager.pull()
    for (const operation of plans[index]!.operations) await client.manager.enqueue(operation)
  }))

  let injectedFaultsObserved = 0
  if (concurrent) {
    const settled = await Promise.all(schedule.map(index =>
      deliverWithColdRetry(graphId, clients[index]!)))
    injectedFaultsObserved += settled.reduce((sum, value) => sum + value, 0)
  } else {
    const split = Math.max(1, Math.floor(schedule.length / 2))
    for (const [position, index] of schedule.entries()) {
      injectedFaultsObserved += await deliverWithColdRetry(graphId, clients[index]!)
      if (position + 1 === split) await restartHalfway()
    }
  }
  assert(
    clients.every(client => client.manager.get().pending === 0),
    `${graphId} drains every durable outbox`,
  )

  const allOperations = plans.flatMap(plan => [...plan.operations])
  const revisionBeforeDuplicates = (await pull(caller.mcp, graphId, graphIncarnation)).revision
  const random = rngFor(seed * 101 + lane)
  const duplicates = shuffled(allOperations, random)
  let duplicateBatches = 0
  for (let offset = 0; offset < duplicates.length;) {
    const size = 1 + Math.floor(random() * 7)
    const batch = duplicates.slice(offset, offset + size)
    const result = await push(caller.mcp, graphId, graphIncarnation, batch)
    assert(
      result.receipts.every(receipt => receipt.duplicate === true),
      `${graphId} shuffled replay is recognized as duplicate`,
    )
    duplicateBatches += 1
    offset += size
  }
  const bundle = await pull(caller.mcp, graphId, graphIncarnation)
  const expectedRevision = baseline.revision + allOperations.length
  assert(bundle.revision === expectedRevision, `${graphId} has exactly one revision per unique intent`)
  assert(bundle.revision === revisionBeforeDuplicates, `${graphId} duplicate replay is revision-stable`)
  assert(
    bundle.epoch === `${bundle.graphIncarnation}:${bundle.revision}:${bundle.manifest.sourceManifestHash}`,
    `${graphId} epoch is bound to graph lifetime, revision, and complete manifest`,
  )
  assert(bundle.events.length === 2, `${graphId} event identity folds by set union`)
  assert(bundle.conflicts.length === 1, `${graphId} exposes one shared-current conflict`)
  const conflict = object(bundle.conflicts[0], `${graphId} conflict`)
  assert(
    array(conflict.candidates, `${graphId} conflict candidates`).length === clientCount,
    `${graphId} retains every concurrent current-state candidate`,
  )
  const logical = logicalTruth(bundle)
  assert(
    Object.keys(object(logical.workspaceTruth, 'workspace truth')).length === clientCount,
    `${graphId} workspace Y.Doc contains every offline client`,
  )
  assert(
    Object.keys(object(logical.documentTruth, 'document truth')).length === clientCount,
    `${graphId} document Y.Doc contains every offline client`,
  )
  const values = await call(caller.mcp, 'get_block_values', {
    graphId,
    documentId: 'chaos-document',
    observerAgentId: 'chaos-observer',
  })
  const valuedBlock = object(array(values.blocks, `${graphId} valued blocks`)[0], 'valued block')
  assert(valuedBlock.valuationCount === 4, `${graphId} deduplicates two semantic valuation events`)
  assert(valuedBlock.rawImportanceSum === 5, `${graphId} valuation importance is set-union stable`)
  assert(valuedBlock.rawValenceSum === 1, `${graphId} valuation valence is set-union stable`)
  const rebuild = await call(caller.mcp, 'source_rebuild', {
    graphId,
    graphIncarnation,
  })
  assert(rebuild.ok === true, `${graphId} remains destructively rebuildable`)
  assert(rebuild.sourceSetEqual === true, `${graphId} source fold survives rebuild`)
  assert(rebuild.projectionSetEqual === true, `${graphId} projection replay is set-equal`)
  return {
    graphId,
    graphIncarnation,
    bundle,
    logical,
    injectedFaultsObserved,
    duplicateBatches,
    rebuild,
  }
}

let cell: GardendCell | null = null
let report: JsonObject | null = null

try {
  stage(`booting release authority (${seeds.length} seeds, ${clientCount} clients)`)
  cell = await spawnGardend({
    bin: binary,
    profileDir,
    readyTimeoutMs: 45_000,
  })
  const caller = new MutableCaller(mcpFor(cell))
  const restart = async (): Promise<void> => {
    assert(cell, 'cell exists before restart')
    await hardKill(cell)
    cell = await spawnGardend({
      bin: binary,
      profileDir,
      readyTimeoutMs: 45_000,
    })
    caller.mcp = mcpFor(cell)
  }

  const campaigns: JsonObject[] = []
  const coldWitnesses: Array<{
    graphId: string
    graphIncarnation: string
    revision: number
    manifestHash: string
    epoch: string
  }> = []
  for (const seed of seeds) {
    stage(`seed ${seed}: invalid-batch atomicity`)
    const batchAtomicity = await invalidBatchAtomicity(caller.mcp, seed)
    const documentIncarnation = uuid(seed, 0, 2)
    const plans = clientPlans(seed, documentIncarnation)
    // Document incarnations are graph-lifetime identities. Lane B needs the
    // same logical operations with its own incarnation value.
    const plansB = clientPlans(seed, uuid(seed, 1, 2))
    const random = rngFor(seed)
    const scheduleA = shuffled(
      Array.from({ length: clientCount }, (_, index) => index),
      random,
    )
    const scheduleB = [...scheduleA].reverse()
    stage(`seed ${seed}: sequential partition/restart schedule ${scheduleA.join(',')}`)
    const left = await runGraph(
      caller,
      seed,
      0,
      plans,
      scheduleA,
      false,
      restart,
    )
    stage(`seed ${seed}: concurrent schedule ${scheduleB.join(',')}`)
    const right = await runGraph(
      caller,
      seed,
      1,
      plansB,
      scheduleB,
      true,
      restart,
    )
    assert(
      canonical(left.logical) === canonical(right.logical),
      `seed ${seed} converges to identical logical truth across arrival schedules`,
    )
    for (const result of [left, right]) {
      coldWitnesses.push({
        graphId: result.graphId,
        graphIncarnation: result.graphIncarnation,
        revision: result.bundle.revision,
        manifestHash: result.bundle.manifest.sourceManifestHash,
        epoch: result.bundle.epoch,
      })
    }
    campaigns.push({
      seed,
      clients: clientCount,
      operations: plans.reduce((sum, plan) => sum + plan.operations.length, 0),
      schedules: { sequential: scheduleA, concurrent: scheduleB },
      batchAtomicity,
      injectedFaultsObserved:
        left.injectedFaultsObserved + right.injectedFaultsObserved,
      duplicateBatches: left.duplicateBatches + right.duplicateBatches,
      logicalConvergence: true,
      revisions: {
        left: left.bundle.revision,
        right: right.bundle.revision,
      },
      rebuild: {
        left: left.rebuild.ok,
        right: right.rebuild.ok,
      },
    })
  }

  stage('final SIGKILL and cold disk-hydration audit')
  await restart()
  for (const witness of coldWitnesses) {
    const hydrated = await pull(caller.mcp, witness.graphId, witness.graphIncarnation)
    assert(hydrated.revision === witness.revision, `${witness.graphId} revision survives final SIGKILL`)
    assert(
      hydrated.manifest.sourceManifestHash === witness.manifestHash,
      `${witness.graphId} complete manifest survives final SIGKILL`,
    )
    assert(hydrated.epoch === witness.epoch, `${witness.graphId} epoch survives final SIGKILL`)
  }
  assert(
    createHash('sha256').update(readFileSync(binary)).digest('hex') === binarySha256,
    'Gardend binary did not change during the chaos campaign',
  )

  report = {
    ok: true,
    verdict: 'GO',
    scope: 'seeded real-cell multi-client source-sync chaos',
    provenance: {
      gardend: {
        path: binary,
        sha256: binarySha256,
      },
    },
    configuration: {
      seeds,
      clients: clientCount,
      faultModes: ['before', 'after', 'partial', 'bad-digest', 'none'],
    },
    campaigns,
    invariants: {
      invalidBatchPrefixAtomicity: true,
      oversizeBatchAtomicity: true,
      durableColdOutboxRetry: true,
      receiptContentBinding: true,
      arrivalOrderConvergence: true,
      duplicateReplayIdempotence: true,
      crdtMergeCompleteness: true,
      semanticEventSetUnion: true,
      semanticValuationSetUnion: true,
      explicitCurrentStateConflict: true,
      manifestBoundEpoch: true,
      destructiveRebuild: true,
      sigkillHydration: true,
    },
    coldHydrationWitnesses: coldWitnesses.length,
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
    process.stderr.write(`[source-sync-chaos] kept ${runRoot}\n`)
  } else {
    rmSync(runRoot, { recursive: true, force: true })
  }
}
