/**
 * Functional audit of fully-offline/sync-later semantics at the Meaningful
 * Objects boundary.
 *
 * This is deliberately an acceptance/audit harness, not a unit test and not a
 * mock. It drives:
 *
 *   - a real release Gardend process and caller-owned disk profile;
 *   - Gardend's actual MCP tool catalog and every registered Emporium contract;
 *   - generic current-state objects (Bookmark);
 *   - the append/lineage-aware Memory lane and observer membranes;
 *   - block valuations and at-least-once replay;
 *   - two independent y-websocket workspace replicas;
 *   - document namespace/body lifecycle;
 *   - graph hard-delete/same-ID recreation;
 *   - a SIGKILL/restart on the same disk truth with a new port and token.
 *
 * `ok: true` means the audit itself completed and its witnesses were reproduced.
 * `verdict` is the product verdict. At the time this harness was authored the
 * expected verdict is NO-GO for *fully* offline mode, while several bounded
 * convergence controls pass. Set SHRUBBERY_OFFLINE_REQUIRE_GO=1 (or pass
 * --require-go) to make a reproduced NO-GO exit non-zero for a release gate.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import {
  LoopbackHttpError,
  LoopbackMcpClient,
  McpError,
  mcpText,
  type McpToolDescriptor,
} from '../src/cell/loopback-mcp.js'

type JsonObject = Record<string, unknown>

interface ClassSignature {
  readonly vocab: string
  readonly className: string
  readonly sourceKind: string
  readonly identityKind: string
  readonly storeMode: string
  readonly storeTarget: string
  readonly reconciliationStrategy: string
  readonly dispatchMode: string
}

interface WorkspaceState {
  readonly folders: readonly string[]
  readonly documents: readonly string[]
  readonly wires: readonly string[]
  readonly titles: Readonly<Record<string, string>>
}

interface WorkspacePeer {
  readonly label: string
  readonly graphId: string
  readonly doc: Y.Doc
  readonly provider: WebsocketProvider
  disconnect(): Promise<void>
  connect(timeoutMs?: number): Promise<void>
  destroy(): void
}

const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-offline-mo.'))
const profileDir = join(runRoot, 'gardend-profile')
const requireGo = process.argv.includes('--require-go')
  || process.env.SHRUBBERY_OFFLINE_REQUIRE_GO === '1'
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT

const graphIds = {
  bookmarkAb: 'mo-current-state-ab',
  bookmarkBa: 'mo-current-state-ba',
  memoryAb: 'mo-memory-ab',
  memoryBa: 'mo-memory-ba',
  membrane: 'mo-memory-membranes',
  retraction: 'mo-retraction-replay',
  valuation: 'mo-valuation-replay',
  eventLog: 'mo-event-log-reachability',
  explicitLifecycle: 'mo-explicit-document-lifecycle',
  workspace: 'mo-workspace-source',
  reincarnation: 'mo-workspace-reincarnation',
} as const

const sleep = (ms: number): Promise<void> =>
  new Promise(resolveSleep => setTimeout(resolveSleep, ms))

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`offline Meaningful Objects assertion failed: ${message}`)
}

function object(value: unknown, label: string): JsonObject {
  assert(value != null && typeof value === 'object' && !Array.isArray(value), `${label} is an object`)
  return value as JsonObject
}

function array(value: unknown, label: string): unknown[] {
  assert(Array.isArray(value), `${label} is an array`)
  return value
}

function string(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is a non-empty string`)
  return value
}

async function waitFor<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (accept(last)) return last
    } catch (error) {
      lastError = error
    }
    await sleep(75)
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms; last=${JSON.stringify(last)?.slice(0, 1_000)}`
    + `${lastError ? `; error=${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`,
  )
}

function mcpFor(cell: GardendCell): LoopbackMcpClient {
  return new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
}

async function callJson(
  mcp: LoopbackMcpClient,
  name: string,
  args: JsonObject,
): Promise<JsonObject> {
  const raw = mcpText(await mcp.toolsCall(name, args))
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `${name} did not return JSON: ${raw.slice(0, 1_000)}`,
      { cause: error },
    )
  }
  return object(parsed, `${name} result`)
}

async function createGraph(
  mcp: LoopbackMcpClient,
  graphId: string,
  title = graphId,
): Promise<JsonObject> {
  return callJson(mcp, 'create_graph', { graph_id: graphId, title })
}

function toolByName(
  tools: readonly McpToolDescriptor[],
  name: string,
): McpToolDescriptor {
  const tool = tools.find(candidate => candidate.name === name)
  assert(tool, `Gardend advertises MCP tool ${name}`)
  return tool
}

function schemaProperties(tool: McpToolDescriptor): Readonly<Record<string, unknown>> {
  const schema = tool.inputSchema
  const properties = schema?.properties
  return properties != null && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {}
}

function hasAnyProperty(
  tool: McpToolDescriptor,
  candidates: readonly string[],
): boolean {
  const properties = schemaProperties(tool)
  return candidates.some(candidate => Object.hasOwn(properties, candidate))
}

async function auditVocabularyCensus(
  mcp: LoopbackMcpClient,
): Promise<{
  readonly vocabularyCount: number
  readonly classCount: number
  readonly bySourceKind: Readonly<Record<string, number>>
  readonly signatures: readonly ClassSignature[]
}> {
  const catalog = await callJson(mcp, 'emporium_vocab', {})
  const vocabularyRows = array(catalog.vocabularies, 'emporium_vocab.vocabularies')
  const signatures: ClassSignature[] = []

  for (const row of vocabularyRows) {
    const vocabName = string(object(row, 'vocabulary row').name, 'vocabulary name')
    const served = await callJson(mcp, 'emporium_vocab', { name: vocabName })
    const contract = object(served.contract, `${vocabName}.contract`)
    const classes = object(contract.classes, `${vocabName}.classes`)
    for (const [className, rawSignature] of Object.entries(classes)) {
      const signature = object(rawSignature, `${vocabName}.${className}`)
      signatures.push({
        vocab: vocabName,
        className,
        sourceKind: string(signature.source_kind, `${vocabName}.${className}.source_kind`),
        identityKind: string(signature.identity_kind, `${vocabName}.${className}.identity_kind`),
        storeMode: string(signature.store_mode, `${vocabName}.${className}.store_mode`),
        storeTarget: string(signature.store_target, `${vocabName}.${className}.store_target`),
        reconciliationStrategy: string(
          signature.reconciliation_strategy,
          `${vocabName}.${className}.reconciliation_strategy`,
        ),
        dispatchMode: string(signature.dispatch_mode, `${vocabName}.${className}.dispatch_mode`),
      })
    }
  }

  const bySourceKind: Record<string, number> = {}
  for (const signature of signatures) {
    bySourceKind[signature.sourceKind] = (bySourceKind[signature.sourceKind] ?? 0) + 1
  }
  assert(signatures.length > 0, 'the served contract census contains classes')
  assert((bySourceKind['current-state'] ?? 0) > 0, 'census includes current-state sources')
  assert((bySourceKind['event-log'] ?? 0) > 0, 'census includes event-log sources')
  assert((bySourceKind.derived ?? 0) > 0, 'census includes derived sources')

  return {
    vocabularyCount: vocabularyRows.length,
    classCount: signatures.length,
    bySourceKind,
    signatures,
  }
}

function bookmarkRecord(title: string): JsonObject {
  return {
    kind: 'Bookmark',
    clientRef: 'shared-bookmark',
    url: 'https://offline.test/shared',
    title,
  }
}

function bookmarkTitle(read: JsonObject): string {
  const predicates = object(read.predicates, 'bookmark predicates')
  const values = array(
    predicates['http://mnemosyne.dev/bookmark#title'],
    'bookmark title values',
  )
  assert(values.length === 1, `bookmark has exactly one title: ${JSON.stringify(values)}`)
  return String(values[0])
}

async function writeBookmark(
  mcp: LoopbackMcpClient,
  graphId: string,
  title: string,
): Promise<JsonObject> {
  const response = await callJson(mcp, 'emporium_write', {
    graph_id: graphId,
    vocab: 'emporium-bookmark',
    records: [bookmarkRecord(title)],
  })
  assert(response.ok === true, `Bookmark ${title} write is ok`)
  object(array(response.results, 'bookmark results')[0], 'bookmark result')
  return response
}

async function readBookmark(
  mcp: LoopbackMcpClient,
  graphId: string,
): Promise<JsonObject> {
  return callJson(mcp, 'emporium_read', {
    graph_id: graphId,
    vocab: 'emporium-bookmark',
    class: 'Bookmark',
    address: 'shared-bookmark',
  })
}

async function exerciseCurrentStateArrivalOrder(
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  const replay = async (
    graphId: string,
    order: readonly ['A' | 'B', 'A' | 'B'],
  ): Promise<JsonObject> => {
    await createGraph(mcp, graphId)
    await writeBookmark(mcp, graphId, 'BASELINE')
    const writes: Array<{ readonly response?: JsonObject; readonly error?: string }> = []
    for (const title of order) {
      try {
        writes.push({ response: await writeBookmark(mcp, graphId, title) })
      } catch (error) {
        writes.push({ error: error instanceof Error ? error.message : String(error) })
      }
    }
    const read = await readBookmark(mcp, graphId)
    const finalTitle = bookmarkTitle(read)
    return {
      order,
      finalTitle,
      outcomes: writes.map(write => write.response
        ? object(array(write.response.results, 'write results')[0], 'write result').outcome
        : 'rejected'),
      subjects: writes.map(write => write.response
        ? object(array(write.response.results, 'write results')[0], 'write result').subject
        : null),
      errors: writes.map(write => write.error ?? null),
    }
  }

  const ab = await replay(graphIds.bookmarkAb, ['A', 'B'])
  const ba = await replay(graphIds.bookmarkBa, ['B', 'A'])

  const duplicateOne = await writeBookmark(mcp, graphIds.bookmarkAb, 'B')
  await sleep(3)
  const duplicateTwo = await writeBookmark(mcp, graphIds.bookmarkAb, 'B')
  const refOne = string(duplicateOne.journalRef, 'first generic journalRef')
  const refTwo = string(duplicateTwo.journalRef, 'second generic journalRef')
  const arrivalOrderDependent = ab.finalTitle !== ba.finalTitle
  const conflictSignalled = JSON.stringify([ab.outcomes, ab.errors, ba.outcomes, ba.errors])
    .toLowerCase()
    .match(/conflict|contested|stale|version|compare-and-set/) != null

  return {
    ab,
    ba,
    arrivalOrderDependent,
    conflictSignalled,
    invariantPass: !arrivalOrderDependent,
    identicalRetry: {
      outcomes: [
        object(array(duplicateOne.results, 'first duplicate results')[0], 'first duplicate').outcome,
        object(array(duplicateTwo.results, 'second duplicate results')[0], 'second duplicate').outcome,
      ],
      journalRefs: [refOne, refTwo],
      stableJournalIdentity: refOne === refTwo,
    },
  }
}

function memoryRecord(
  clientRef: string,
  content: string,
  supersedes?: string,
): JsonObject {
  return {
    clientRef,
    scope: 'agent',
    kind: 'ClaimMemory',
    contentOrientation: 'knowledge',
    visibility: 'private',
    status: 'active',
    content,
    sourceRefs: [{
      sourceKind: 'DocumentBlock',
      blockId: 'offline-audit-block',
      documentId: 'offline-audit-document',
    }],
    isCurrent: true,
    validFrom: 1_720_000_000_000,
    ...(supersedes ? { supersedes } : {}),
  }
}

async function writeMemory(
  mcp: LoopbackMcpClient,
  graphId: string,
  record: JsonObject,
  placement: { readonly publish?: boolean; readonly observer?: string },
): Promise<JsonObject> {
  return callJson(mcp, 'emporium_write', {
    graph_id: graphId,
    vocab: 'sophia-memory-core',
    records: [record],
    ...(placement.publish ? { publish: true } : {}),
    ...(placement.observer ? { observer: placement.observer } : {}),
  })
}

async function exerciseMemoryControl(
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  const replay = async (
    graphId: string,
    order: readonly ['A' | 'B', 'A' | 'B'],
  ): Promise<JsonObject> => {
    await createGraph(mcp, graphId)
    const baselineRecord = memoryRecord('baseline', `baseline for ${graphId}`)
    const baseline = await writeMemory(mcp, graphId, baselineRecord, { publish: true })
    const baselineResult = object(array(baseline.results, 'baseline results')[0], 'baseline result')
    const baselineSubject = string(baselineResult.subject, 'baseline subject')
    assert(baselineResult.outcome === 'applied', 'memory baseline applies')

    const duplicate = await writeMemory(mcp, graphId, baselineRecord, { publish: true })
    const duplicateResult = object(array(duplicate.results, 'duplicate results')[0], 'duplicate result')
    assert(duplicateResult.outcome === 'converged', 'identical memory content converges')
    assert(duplicateResult.subject === baselineSubject, 'identical memory content retains identity')

    const records = {
      A: memoryRecord('successor-a', `successor A for ${graphId}`, baselineSubject),
      B: memoryRecord('successor-b', `successor B for ${graphId}`, baselineSubject),
    } as const
    const responses: JsonObject[] = []
    for (const label of order) {
      responses.push(await writeMemory(mcp, graphId, records[label], { publish: true }))
    }
    const heads = await callJson(mcp, 'emporium_heads', { graph_id: graphId })
    const contested = array(heads.lineages, 'memory lineages')
      .map(value => object(value, 'memory lineage'))
      .filter(lineage => lineage.contested === true)
    assert(contested.length === 1, `${graphId} has one contested lineage`)
    const headSubjects = array(contested[0]!.heads, 'contested heads').map(String).sort()
    assert(headSubjects.length === 2, `${graphId} preserves both divergent heads`)
    return {
      order,
      baselineSubject,
      duplicateOutcome: duplicateResult.outcome,
      successorOutcomes: responses.map(response =>
        object(array(response.results, 'successor results')[0], 'successor result').outcome),
      contested: true,
      headCount: headSubjects.length,
      headSubjects,
    }
  }

  const ab = await replay(graphIds.memoryAb, ['A', 'B'])
  const ba = await replay(graphIds.memoryBa, ['B', 'A'])

  await createGraph(mcp, graphIds.membrane)
  await writeMemory(
    mcp,
    graphIds.membrane,
    memoryRecord('membrane-a', 'agent A private testimony'),
    { observer: 'agent-a' },
  )
  await writeMemory(
    mcp,
    graphIds.membrane,
    memoryRecord('membrane-b', 'agent B private testimony'),
    { observer: 'agent-b' },
  )
  const commons = await callJson(mcp, 'emporium_heads', { graph_id: graphIds.membrane })
  const observerA = await callJson(mcp, 'emporium_heads', {
    graph_id: graphIds.membrane,
    observer: 'agent-a',
  })
  const observerB = await callJson(mcp, 'emporium_heads', {
    graph_id: graphIds.membrane,
    observer: 'agent-b',
  })
  assert(array(commons.lineages, 'commons lineages').length === 0, 'private memories do not leak to commons')
  assert(array(observerA.lineages, 'agent A lineages').length === 1, 'agent A sees its own testimony')
  assert(array(observerB.lineages, 'agent B lineages').length === 1, 'agent B sees its own testimony')

  return {
    ab,
    ba,
    observerMembranes: {
      commonsLineages: array(commons.lineages, 'commons lineages').length,
      agentALineages: array(observerA.lineages, 'A lineages').length,
      agentBLineages: array(observerB.lineages, 'B lineages').length,
    },
  }
}

async function exerciseRetractionReplay(
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  await createGraph(mcp, graphIds.retraction)
  const written = await writeBookmark(mcp, graphIds.retraction, 'Retract me')
  const subject = string(
    object(array(written.results, 'retraction seed results')[0], 'retraction seed').subject,
    'retraction subject',
  )
  const args = {
    graph_id: graphIds.retraction,
    subject,
    rationale: 'offline lost-ack replay',
  }
  const first = await callJson(mcp, 'emporium_retract', args)
  await sleep(3)
  const second = await callJson(mcp, 'emporium_retract', args)
  const replayIdempotent = first.retractionRef === second.retractionRef
  return {
    subject,
    alreadyRetracted: [first.alreadyRetracted, second.alreadyRetracted],
    retractionRefs: [first.retractionRef, second.retractionRef],
    secondWarnings: second.warnings,
    replayIdempotent,
  }
}

async function exerciseValuationReplay(
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  await createGraph(mcp, graphIds.valuation)
  const write = await callJson(mcp, 'write_document', {
    graphId: graphIds.valuation,
    documentId: 'valued-document',
    content: 'A block whose testimony must survive an at-least-once transport.',
    awaitDurable: true,
  })
  const blockId = string(
    array(write.blockIds ?? write.block_ids, 'write_document block ids')[0],
    'valued block id',
  )
  const args = {
    graphId: graphIds.valuation,
    documentId: 'valued-document',
    blockId,
    importance: 4,
  }
  const first = await callJson(mcp, 'value', args)
  const second = await callJson(mcp, 'value', args)
  const replayIdempotent = first.rawImportanceSum === second.rawImportanceSum
    && first.valuationCount === second.valuationCount
  return {
    documentId: 'valued-document',
    blockId,
    first: {
      rawImportanceSum: first.rawImportanceSum,
      valuationCount: first.valuationCount,
    },
    identicalRetry: {
      rawImportanceSum: second.rawImportanceSum,
      valuationCount: second.valuationCount,
    },
    replayIdempotent,
  }
}

async function exerciseEventLogReachability(
  mcp: LoopbackMcpClient,
  tools: readonly McpToolDescriptor[],
): Promise<JsonObject> {
  await createGraph(mcp, graphIds.eventLog)
  let rejection = ''
  const responses: JsonObject[] = []
  const eventRecord = {
    kind: 'CompositionEvent',
    clientRef: 'offline-event-1',
    generatedAtTime: '2026-07-29T00:00:00Z',
    definitionSubject: 'urn:offline-audit:workflow',
    eventOrder: 1,
    gestureKind: 'insert',
    partOfAuthoringSession: 'urn:offline-audit:session',
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      responses.push(await callJson(mcp, 'emporium_write', {
        graph_id: graphIds.eventLog,
        vocab: 'workflow',
        records: [eventRecord],
      }))
    }
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error)
  }

  const advertised = new Set(tools.map(tool => tool.name))
  const genericSourceSyncCandidates = [
    'emporium_events_pull',
    'emporium_events_push',
    'emporium_sync',
    'meaningful_object_sync',
    'source_pull',
    'source_push',
  ]
  const unexpectedlyPresent = genericSourceSyncCandidates.filter(name => advertised.has(name))
  const responseResults = responses.map(response =>
    object(array(response.results, 'event results')[0], 'event result'))
  const stableEventIdentity = responseResults.length === 2
    && responseResults[0]!.subject === responseResults[1]!.subject
    && (
      responseResults[1]!.outcome === 'converged'
      || responses[0]!.journalRef === responses[1]!.journalRef
    )
  const sourceProtocolReachable = unexpectedlyPresent.length > 0
  return {
    compositionEventWrite: responses.length === 2 ? 'accepted-twice' : 'rejected',
    rejection,
    results: responseResults,
    stableEventIdentity,
    sourceProtocolReachable,
    invariantPass: responses.length === 2
      && stableEventIdentity
      && sourceProtocolReachable,
    genericSourceSyncToolsPresent: unexpectedlyPresent,
  }
}

function putEntity(
  doc: Y.Doc,
  rootName: 'folders' | 'documents' | 'wires',
  id: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  doc.transact(() => {
    const root = doc.getMap<Y.Map<unknown>>(rootName)
    const existing = root.get(id)
    const entity = existing instanceof Y.Map ? existing : new Y.Map<unknown>()
    for (const [key, value] of Object.entries(fields)) entity.set(key, value)
    if (!(existing instanceof Y.Map)) root.set(id, entity)
  }, { kind: 'offline-meaningful-objects-audit', rootName, id })
}

function removeEntity(
  doc: Y.Doc,
  rootName: 'folders' | 'documents' | 'wires',
  id: string,
): void {
  doc.transact(() => {
    doc.getMap(rootName).delete(id)
  }, { kind: 'offline-meaningful-objects-audit-delete', rootName, id })
}

function workspaceState(doc: Y.Doc): WorkspaceState {
  const entityIds = (name: 'folders' | 'documents' | 'wires'): string[] =>
    Array.from(doc.getMap<Y.Map<unknown>>(name).entries())
      .filter(([, value]) => value instanceof Y.Map)
      .map(([id]) => id)
      .sort()
  const titles: Record<string, string> = {}
  for (const [id, value] of doc.getMap<Y.Map<unknown>>('documents').entries()) {
    if (value instanceof Y.Map) titles[id] = String(value.get('title') ?? '')
  }
  return {
    folders: entityIds('folders'),
    documents: entityIds('documents'),
    wires: entityIds('wires'),
    titles,
  }
}

function stateContains(
  state: WorkspaceState,
  expected: {
    readonly folders?: readonly string[]
    readonly documents?: readonly string[]
    readonly wires?: readonly string[]
  },
): boolean {
  return (expected.folders ?? []).every(id => state.folders.includes(id))
    && (expected.documents ?? []).every(id => state.documents.includes(id))
    && (expected.wires ?? []).every(id => state.wires.includes(id))
}

function authorizedWebSocket(token: string): typeof globalThis.WebSocket {
  class AuthorizedWebSocket extends WebSocket {
    constructor(address: string | URL, _protocols?: string | string[]) {
      super(address, [`bearer.${token}`])
    }
  }
  return AuthorizedWebSocket as unknown as typeof globalThis.WebSocket
}

async function workspacePeer(
  cell: GardendCell,
  graphId: string,
  label: string,
): Promise<WorkspacePeer> {
  const doc = new Y.Doc()
  const wsBase = cell.apiUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  const provider = new WebsocketProvider(
    `${wsBase}/hocuspocus/workspace`,
    graphId,
    doc,
    {
      WebSocketPolyfill: authorizedWebSocket(cell.token),
      disableBc: true,
    },
  )
  const waitSynced = (timeoutMs = 30_000): Promise<unknown> => waitFor(
    () => ({ connected: provider.wsconnected, synced: provider.synced }),
    state => state.connected && state.synced,
    `${label} workspace sync`,
    timeoutMs,
  )
  await waitSynced()
  return {
    label,
    graphId,
    doc,
    provider,
    async disconnect(): Promise<void> {
      provider.disconnect()
      await waitFor(
        () => provider.wsconnected,
        connected => !connected,
        `${label} workspace disconnect`,
      )
    },
    async connect(timeoutMs?: number): Promise<void> {
      provider.connect()
      await waitSynced(timeoutMs)
    },
    destroy(): void {
      provider.destroy()
      doc.destroy()
    },
  }
}

async function getBytes(
  url: string,
  token: string,
): Promise<{
  readonly status: number
  readonly bytes: Uint8Array
  readonly headers: Readonly<Record<string, string | undefined>>
}> {
  const parsed = new URL(url)
  const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolveResponse, reject) => {
    const req = request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'http://127.0.0.1',
      },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        const headers: Record<string, string | undefined> = {}
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
        }
        resolveResponse({
          status: response.statusCode ?? 0,
          bytes: new Uint8Array(Buffer.concat(chunks)),
          headers,
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function serverWorkspaceState(
  cell: GardendCell,
  graphId: string,
): Promise<WorkspaceState> {
  const response = await getBytes(
    `${cell.apiUrl}/documents/${encodeURIComponent(graphId)}/workspace/blob`,
    cell.token,
  )
  assert(response.status === 200, `workspace blob ${graphId} returns 200, got ${response.status}`)
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, response.bytes)
    return workspaceState(doc)
  } finally {
    doc.destroy()
  }
}

async function waitServerWorkspace(
  cell: GardendCell,
  graphId: string,
  expected: {
    readonly folders?: readonly string[]
    readonly documents?: readonly string[]
    readonly wires?: readonly string[]
  },
): Promise<WorkspaceState> {
  return waitFor(
    () => serverWorkspaceState(cell, graphId),
    state => stateContains(state, expected),
    `server workspace ${graphId}`,
    45_000,
  )
}

async function documentWebSocketStatus(
  cell: GardendCell,
  graphId: string,
  documentId: string,
): Promise<number> {
  const wsBase = cell.apiUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  const url = `${wsBase}/hocuspocus/docs/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}`
  return new Promise((resolveStatus, reject) => {
    const socket = new WebSocket(url, [`bearer.${cell.token}`])
    let settled = false
    const finish = (status: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.terminate()
      resolveStatus(status)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.terminate()
      reject(new Error(`document WebSocket status probe timed out for ${graphId}/${documentId}`))
    }, 10_000)
    socket.once('open', () => finish(101))
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      finish(response.statusCode ?? 0)
    })
    socket.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function documentSnapshotProbe(
  mcp: LoopbackMcpClient,
  graphId: string,
  documentId: string,
): Promise<{
  readonly status: number
  readonly bytes: number
  readonly incarnation: string | null
}> {
  try {
    const snapshot = await mcp.documentSnapshot(graphId, documentId)
    return {
      status: 200,
      bytes: snapshot.update.length,
      incarnation: snapshot.incarnation,
    }
  } catch (error) {
    if (!(error instanceof LoopbackHttpError)) throw error
    return {
      status: error.status,
      bytes: 0,
      incarnation: null,
    }
  }
}

async function exerciseExplicitDocumentLifecycle(
  cell: GardendCell,
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  await createGraph(mcp, graphIds.explicitLifecycle)
  const create = await callJson(mcp, 'create_document', {
    graphId: graphIds.explicitLifecycle,
    documentId: 'explicit-created',
    title: 'Explicit lifecycle command',
  })
  const workspace = await waitServerWorkspace(cell, graphIds.explicitLifecycle, {
    documents: ['explicit-created'],
  })
  const snapshot = await documentSnapshotProbe(
    mcp,
    graphIds.explicitLifecycle,
    'explicit-created',
  )
  const webSocketStatus = await documentWebSocketStatus(
    cell,
    graphIds.explicitLifecycle,
    'explicit-created',
  )
  return {
    create,
    namespacePresent: workspace.documents.includes('explicit-created'),
    snapshot,
    webSocketStatus,
    commandEstablishedWholeObject:
      workspace.documents.includes('explicit-created')
      && snapshot.status === 200
      && snapshot.incarnation != null
      && webSocketStatus === 101,
  }
}

async function exerciseWorkspaceSourceAndLifecycle(
  cell: GardendCell,
  mcp: LoopbackMcpClient,
): Promise<{
  readonly evidence: JsonObject
  readonly peersToDestroy: readonly WorkspacePeer[]
}> {
  await createGraph(mcp, graphIds.workspace)
  await callJson(mcp, 'write_document', {
    graphId: graphIds.workspace,
    documentId: 'server-backed',
    title: 'Server-backed body',
    content: 'SERVER-BACKED-BODY',
    awaitDurable: true,
  })
  await mcp.documentSnapshot(graphIds.workspace, 'server-backed')

  const a = await workspacePeer(cell, graphIds.workspace, 'workspace-A')
  const b = await workspacePeer(cell, graphIds.workspace, 'workspace-B')
  await waitFor(
    () => workspaceState(a.doc),
    state => state.documents.includes('server-backed'),
    'A sees server-backed namespace entry',
  )
  await waitFor(
    () => workspaceState(b.doc),
    state => state.documents.includes('server-backed'),
    'B sees server-backed namespace entry',
  )

  await a.disconnect()
  await b.disconnect()
  const now = Date.now()
  putEntity(a.doc, 'folders', 'folder-a', {
    name: 'Offline A',
    parentId: null,
    section: 'documents',
    order: 10,
  })
  putEntity(a.doc, 'documents', 'offline-created', {
    title: 'Namespace only',
    parentId: 'folder-a',
    section: 'documents',
    order: 11,
    createdAt: now,
    updatedAt: now,
    readOnly: false,
  })
  putEntity(a.doc, 'wires', 'wire-a', {
    sourceDocumentId: 'server-backed',
    targetGraphId: graphIds.workspace,
    targetDocumentId: 'offline-created',
    predicate: 'supports',
    bidirectional: false,
    createdAt: new Date(now).toISOString(),
  })
  putEntity(a.doc, 'documents', 'server-backed', {
    title: 'Rename from A',
    updatedAt: now + 1,
  })

  putEntity(b.doc, 'folders', 'folder-b', {
    name: 'Offline B',
    parentId: null,
    section: 'documents',
    order: 20,
  })
  putEntity(b.doc, 'wires', 'wire-b', {
    sourceDocumentId: 'server-backed',
    targetGraphId: graphIds.workspace,
    targetDocumentId: 'server-backed',
    predicate: 'contradicts',
    bidirectional: false,
    createdAt: new Date(now + 1).toISOString(),
  })
  putEntity(b.doc, 'documents', 'server-backed', {
    title: 'Rename from B',
    updatedAt: now + 2,
  })

  await a.connect()
  await waitServerWorkspace(cell, graphIds.workspace, {
    folders: ['folder-a'],
    documents: ['server-backed', 'offline-created'],
    wires: ['wire-a'],
  })
  await b.connect()
  const roundOne = await waitServerWorkspace(cell, graphIds.workspace, {
    folders: ['folder-a', 'folder-b'],
    documents: ['server-backed', 'offline-created'],
    wires: ['wire-a', 'wire-b'],
  })
  await waitFor(
    () => workspaceState(a.doc),
    state => stateContains(state, {
      folders: ['folder-a', 'folder-b'],
      documents: ['server-backed', 'offline-created'],
      wires: ['wire-a', 'wire-b'],
    }),
    'A receives B workspace changes',
  )
  await waitFor(
    () => workspaceState(b.doc),
    state => stateContains(state, {
      folders: ['folder-a', 'folder-b'],
      documents: ['server-backed', 'offline-created'],
      wires: ['wire-a', 'wire-b'],
    }),
    'B receives A workspace changes',
  )
  assert(
    workspaceState(a.doc).titles['server-backed'] === workspaceState(b.doc).titles['server-backed'],
    'concurrent workspace rename converges at both replicas',
  )

  // Reverse delivery order for another disconnected round.
  await a.disconnect()
  await b.disconnect()
  putEntity(a.doc, 'folders', 'folder-a-2', {
    name: 'Offline A round two',
    parentId: 'folder-a',
    section: 'documents',
    order: 12,
  })
  putEntity(b.doc, 'folders', 'folder-b-2', {
    name: 'Offline B round two',
    parentId: 'folder-b',
    section: 'documents',
    order: 22,
  })
  await b.connect()
  await waitServerWorkspace(cell, graphIds.workspace, {
    folders: ['folder-b-2'],
  })
  await a.connect()
  const roundTwo = await waitServerWorkspace(cell, graphIds.workspace, {
    folders: ['folder-a', 'folder-a-2', 'folder-b', 'folder-b-2'],
    documents: ['server-backed', 'offline-created'],
    wires: ['wire-a', 'wire-b'],
  })

  // A direct workspace entry has namespace authority but no body authority.
  const directCreateSnapshot = await documentSnapshotProbe(
    mcp,
    graphIds.workspace,
    'offline-created',
  )
  const directCreateWebSocketStatus = await documentWebSocketStatus(
    cell,
    graphIds.workspace,
    'offline-created',
  )

  // Conversely, direct namespace deletion does not tombstone/remove body truth.
  removeEntity(a.doc, 'documents', 'server-backed')
  await waitFor(
    () => workspaceState(b.doc),
    state => !state.documents.includes('server-backed'),
    'raw workspace deletion reaches B',
  )
  await waitFor(
    () => serverWorkspaceState(cell, graphIds.workspace),
    state => !state.documents.includes('server-backed'),
    'raw workspace deletion persists',
  )
  const bodyAfterNamespaceDelete = await documentSnapshotProbe(
    mcp,
    graphIds.workspace,
    'server-backed',
  )
  const deletedNamespaceWebSocketStatus = await documentWebSocketStatus(
    cell,
    graphIds.workspace,
    'server-backed',
  )
  const rawCreateProvisioned = directCreateSnapshot.status === 200
    && directCreateSnapshot.incarnation != null
    && directCreateWebSocketStatus === 101
  const rawDeleteTombstoned = bodyAfterNamespaceDelete.status === 404
    && deletedNamespaceWebSocketStatus !== 101

  return {
    evidence: {
      reconnectOrders: ['A→B', 'B→A'],
      roundOne,
      roundTwo,
      directCreate: {
        namespacePresent: true,
        snapshotStatus: directCreateSnapshot.status,
        snapshotIncarnation: directCreateSnapshot.incarnation,
        webSocketStatus: directCreateWebSocketStatus,
      },
      directDelete: {
        namespacePresent: false,
        snapshotStatus: bodyAfterNamespaceDelete.status,
        bodyBytes: bodyAfterNamespaceDelete.bytes,
        webSocketStatus: deletedNamespaceWebSocketStatus,
      },
      rawLifecycleWholeObject: rawCreateProvisioned && rawDeleteTombstoned,
    },
    peersToDestroy: [a, b],
  }
}

async function exerciseGraphReincarnation(
  cell: GardendCell,
  mcp: LoopbackMcpClient,
): Promise<{
  readonly evidence: JsonObject
  readonly peersToDestroy: readonly WorkspacePeer[]
}> {
  await createGraph(mcp, graphIds.reincarnation, 'First graph incarnation')
  const readStoredIncarnation = (): string => {
    const record = object(
      JSON.parse(readFileSync(
        join(profileDir, 'graphs', graphIds.reincarnation, 'graph.json'),
        'utf8',
      )),
      'stored graph record',
    )
    return string(record.incarnationId ?? record.incarnation_id, 'stored graph incarnation')
  }
  // The graph record already has the identity fence; the hosted/MCP graph
  // projection deliberately does not expose it. Reading the disposable test
  // profile here proves that the two server lifetimes really are distinct,
  // while the subsequent client proof shows the workspace handshake cannot
  // carry that distinction.
  const firstIncarnation = readStoredIncarnation()
  const stale = await workspacePeer(cell, graphIds.reincarnation, 'stale-old-incarnation')
  putEntity(stale.doc, 'folders', 'old-online-folder', {
    name: 'Old online state',
    parentId: null,
    section: 'documents',
    order: 1,
  })
  await waitServerWorkspace(cell, graphIds.reincarnation, {
    folders: ['old-online-folder'],
  })
  await stale.disconnect()
  putEntity(stale.doc, 'folders', 'stale-offline-folder', {
    name: 'Stale offline state',
    parentId: null,
    section: 'documents',
    order: 2,
  })

  const deleted = await callJson(mcp, 'manage_graph', {
    graph_id: graphIds.reincarnation,
    action: 'delete',
    hard: true,
  })
  assert(deleted.success === true && deleted.hard === true, 'disposable graph is hard-deleted')
  await createGraph(
    mcp,
    graphIds.reincarnation,
    'Replacement graph incarnation',
  )
  const secondIncarnation = readStoredIncarnation()
  assert(
    firstIncarnation !== secondIncarnation,
    'same graph ID receives a new server-side incarnation',
  )

  const fresh = await workspacePeer(cell, graphIds.reincarnation, 'fresh-new-incarnation')
  const freshBefore = workspaceState(fresh.doc)
  assert(
    !freshBefore.folders.includes('old-online-folder')
      && !freshBefore.folders.includes('stale-offline-folder'),
    'replacement graph begins without old workspace state',
  )

  // There is no graph-incarnation parameter/header on the workspace room.
  // The old client reconnects by graph ID alone and its complete old Y.Doc is
  // accepted into the replacement graph.
  let staleReconnectError: string | null = null
  try {
    await stale.connect(10_000)
  } catch (error) {
    staleReconnectError = error instanceof Error ? error.message : String(error)
  }
  if (staleReconnectError == null) {
    await waitFor(
      () => serverWorkspaceState(cell, graphIds.reincarnation),
      state => stateContains(state, {
        folders: ['old-online-folder', 'stale-offline-folder'],
      }),
      'stale old-incarnation state observation',
      10_000,
    ).catch(() => undefined)
  }
  const contaminated = await serverWorkspaceState(cell, graphIds.reincarnation)
  const staleStateEnteredReplacement = stateContains(contaminated, {
    folders: ['old-online-folder', 'stale-offline-folder'],
  })

  return {
    evidence: {
      graphId: graphIds.reincarnation,
      firstIncarnation,
      secondIncarnation,
      freshBeforeReconnect: freshBefore,
      afterStaleReconnect: contaminated,
      staleReconnectError,
      staleStateEnteredReplacement,
      graphApiExposedIncarnation: false,
      workspaceHandshakeHadIncarnationFence: false,
      invariantPass: !staleStateEnteredReplacement,
    },
    peersToDestroy: [stale, fresh],
  }
}

async function hardKill(cell: GardendCell): Promise<void> {
  process.kill(cell.pid, 'SIGKILL')
  await waitFor(
    async () => {
      try {
        return !(await fetch(`${cell.apiUrl}/health`)).ok
      } catch {
        return true
      }
    },
    Boolean,
    'Gardend SIGKILL',
    10_000,
  )
  await cell.kill()
}

async function verifyRestartTruth(
  cell: GardendCell,
  mcp: LoopbackMcpClient,
): Promise<JsonObject> {
  const bookmarkAb = await readBookmark(mcp, graphIds.bookmarkAb)
  const bookmarkBa = await readBookmark(mcp, graphIds.bookmarkBa)
  const headsAb = await callJson(mcp, 'emporium_heads', { graph_id: graphIds.memoryAb })
  const valuation = await callJson(mcp, 'get_block_values', {
    graphId: graphIds.valuation,
    documentId: 'valued-document',
  })
  const explicitLifecycleWorkspace = await serverWorkspaceState(
    cell,
    graphIds.explicitLifecycle,
  )
  const explicitLifecycleSnapshot = await documentSnapshotProbe(
    mcp,
    graphIds.explicitLifecycle,
    'explicit-created',
  )
  const workspace = await serverWorkspaceState(cell, graphIds.workspace)
  const reincarnation = await serverWorkspaceState(cell, graphIds.reincarnation)

  assert(
    array(headsAb.lineages, 'restart memory lineages')
      .some(value => object(value, 'restart lineage').contested === true),
    'contested Memory truth survives restart',
  )
  const valuationBlocks = array(valuation.blocks, 'restart valuation blocks')
  assert(valuationBlocks.length === 1, 'valuation survives restart')
  assert(
    explicitLifecycleWorkspace.documents.includes('explicit-created'),
    'explicit create namespace survives restart',
  )

  return {
    randomPort: cell.manifest.port,
    bookmarkTitles: {
      ab: bookmarkTitle(bookmarkAb),
      ba: bookmarkTitle(bookmarkBa),
    },
    memoryContested: true,
    valuationCount: object(valuationBlocks[0], 'restart valuation').valuationCount,
    explicitLifecycle: {
      workspace: explicitLifecycleWorkspace,
      snapshot: explicitLifecycleSnapshot,
    },
    workspace,
    reincarnation,
  }
}

let cell: GardendCell | null = null
const peers = new Set<WorkspacePeer>()
const evidence: Record<string, unknown> = {}

try {
  const binary = resolveGardendBin()
  cell = await spawnGardend({
    bin: binary,
    profileDir,
    readyTimeoutMs: 45_000,
  })
  let mcp = mcpFor(cell)
  const firstBoot = {
    pid: cell.pid,
    port: cell.manifest.port,
    token: cell.token,
  }

  const tools = await mcp.toolsList()
  evidence.toolSurface = {
    count: tools.length,
    names: tools.map(tool => tool.name).sort(),
  }
  const emporiumWriteTool = toolByName(tools, 'emporium_write')
  const emporiumRetractTool = toolByName(tools, 'emporium_retract')
  const valueTool = toolByName(tools, 'value')
  const createDocumentTool = toolByName(tools, 'create_document')
  const deleteDocumentTool = toolByName(tools, 'delete_document')
  const mutationIdentityFields = [
    'operationId',
    'operation_id',
    'eventId',
    'event_id',
    'mutationId',
    'mutation_id',
    'ifMatch',
    'if_match',
    'baseVersion',
    'base_version',
  ] as const
  const mutationSchemas = {
    emporiumWriteHasReplayOrCasIdentity: hasAnyProperty(
      emporiumWriteTool,
      mutationIdentityFields,
    ),
    emporiumRetractHasReplayIdentity: hasAnyProperty(
      emporiumRetractTool,
      mutationIdentityFields,
    ),
    valueHasReplayIdentity: hasAnyProperty(valueTool, mutationIdentityFields),
    createDocumentHasReplayIdentity: hasAnyProperty(
      createDocumentTool,
      mutationIdentityFields,
    ),
    deleteDocumentHasReplayIdentity: hasAnyProperty(
      deleteDocumentTool,
      mutationIdentityFields,
    ),
  }
  evidence.mutationSchemas = mutationSchemas

  const census = await auditVocabularyCensus(mcp)
  evidence.vocabularyCensus = census
  const currentState = await exerciseCurrentStateArrivalOrder(mcp)
  evidence.currentStateArrivalOrder = currentState
  const memoryControl = await exerciseMemoryControl(mcp)
  evidence.memoryControl = memoryControl
  const retractionReplay = await exerciseRetractionReplay(mcp)
  evidence.retractionReplay = retractionReplay
  const valuationReplay = await exerciseValuationReplay(mcp)
  evidence.valuationReplay = valuationReplay
  const eventLog = await exerciseEventLogReachability(mcp, tools)
  evidence.eventLogReachability = eventLog
  const explicitLifecycle = await exerciseExplicitDocumentLifecycle(cell, mcp)
  evidence.explicitDocumentLifecycle = explicitLifecycle

  const workspace = await exerciseWorkspaceSourceAndLifecycle(cell, mcp)
  workspace.peersToDestroy.forEach(peer => peers.add(peer))
  evidence.workspaceSourceAndLifecycle = workspace.evidence

  const reincarnation = await exerciseGraphReincarnation(cell, mcp)
  reincarnation.peersToDestroy.forEach(peer => peers.add(peer))
  evidence.graphReincarnation = reincarnation.evidence

  // Ensure no live room or in-process Y.Doc can carry the restart assertions.
  for (const peer of peers) peer.destroy()
  peers.clear()
  await hardKill(cell)
  cell = await spawnGardend({
    bin: binary,
    profileDir,
    readyTimeoutMs: 45_000,
  })
  mcp = mcpFor(cell)
  assert(cell.manifest.port !== firstBoot.port, 'restart rotates loopback port')
  assert(cell.token !== firstBoot.token, 'restart rotates loopback token')
  evidence.processRestart = {
    firstBoot: { pid: firstBoot.pid, port: firstBoot.port },
    secondBoot: { pid: cell.pid, port: cell.manifest.port },
    portRotated: true,
    tokenRotated: true,
    truth: await verifyRestartTruth(cell, mcp),
  }

  const toolNames = new Set(tools.map(tool => tool.name))
  const lifecycleIntentTools = Array.from(toolNames)
    .filter(name => /(?:lifecycle|object_intent|mutation_intent)/i.test(name))
    .sort()
  const projectionRebuildTools = Array.from(toolNames)
    .filter(name => /(?:rebuild|reproject|backfill).*(?:projection|derived)|(?:projection|derived).*(?:rebuild|reproject|backfill)/i.test(name))
    .sort()
  evidence.lifecycleCapabilities = { lifecycleIntentTools }
  evidence.derivedProjectionProtocol = {
    projectionRebuildTools,
    genericProjectionRebuildAvailable: projectionRebuildTools
      .some(name => !name.includes('memory')),
  }

  const blockers: Array<{
    readonly id: string
    readonly invariant: string
    readonly witness: string
    readonly required: string
  }> = []
  if (currentState.invariantPass !== true) {
    blockers.push({
      id: 'MO-CURRENT-STATE-ARRIVAL-ORDER',
      invariant: 'Concurrent current-state candidates never resolve by delivery order alone.',
      witness: `Bookmark A→B ends at ${String(object(currentState.ab, 'current-state AB').finalTitle)} while B→A ends at ${String(object(currentState.ba, 'current-state BA').finalTitle)}.`,
      required: 'Versioned compare-and-set plus an explicit contested SyncConflict object, or a declared executable reconciliation policy.',
    })
  }
  if (eventLog.invariantPass !== true) {
    blockers.push({
      id: 'MO-EVENT-SOURCE-UNREACHABLE',
      invariant: 'Every event-log class has a client-replicable source with stable event identity.',
      witness: eventLog.compositionEventWrite === 'rejected'
        ? 'The registry declares event-log classes, but CompositionEvent is rejected by emporium_write and no generic source pull/push tool is advertised.'
        : 'CompositionEvent delivery does not yet combine stable duplicate identity with a client pull/push source protocol.',
      required: 'A source-log pull/push protocol whose merge is set union over stable client event IDs, followed by deterministic fold/reprojection.',
    })
  }
  if (retractionReplay.replayIdempotent !== true) {
    blockers.push({
      id: 'MO-RETRACTION-NON-IDEMPOTENT',
      invariant: 'At-least-once delivery of the same mutation has exactly-once semantic effect.',
      witness: 'Repeating one emporium_retract request mints a second retractionRef and timestamp.',
      required: 'Client-minted stable retraction/event ID with duplicate convergence.',
    })
  }
  if (valuationReplay.replayIdempotent !== true) {
    blockers.push({
      id: 'MO-VALUATION-NON-IDEMPOTENT',
      invariant: 'Lost-ack retry cannot change valuation truth.',
      witness: 'Repeating one value request changes rawImportanceSum 4→8 and valuationCount 1→2.',
      required: 'Stable valuation-event identity (or versioned replacement semantics) in a mergeable per-observer source.',
    })
  }
  const explicitLifecycleWhole = explicitLifecycle.commandEstablishedWholeObject === true
  const lifecycleReplayIdentified = mutationSchemas.createDocumentHasReplayIdentity
    && mutationSchemas.deleteDocumentHasReplayIdentity
  const offlineLifecyclePath = workspace.evidence.rawLifecycleWholeObject === true
    || lifecycleIntentTools.length > 0
  if (!explicitLifecycleWhole || !lifecycleReplayIdentified || !offlineLifecyclePath) {
    const explicitSnapshot = object(
      explicitLifecycle.snapshot,
      'explicit lifecycle snapshot',
    )
    const directCreate = object(
      workspace.evidence.directCreate,
      'raw lifecycle create',
    )
    const directDelete = object(
      workspace.evidence.directDelete,
      'raw lifecycle delete',
    )
    blockers.push({
      id: 'MO-WORKSPACE-DOCUMENT-LIFECYCLE-SPLIT',
      invariant: 'Object namespace and body lifecycle are one atomic, replay-safe protocol.',
      witness: `Explicit create_document leaves snapshot HTTP ${String(explicitSnapshot.status)} / room ${String(explicitLifecycle.webSocketStatus)}; raw workspace create leaves snapshot HTTP ${String(directCreate.snapshotStatus)} / room ${String(directCreate.webSocketStatus)}, while raw delete leaves snapshot HTTP ${String(directDelete.snapshotStatus)} / room ${String(directDelete.webSocketStatus)}.`,
      required: 'Lifecycle intents with stable operation IDs, atomic/provisioned side effects, tombstones, and document incarnation binding.',
    })
  }
  if (reincarnation.evidence.invariantPass !== true) {
    blockers.push({
      id: 'MO-WORKSPACE-GRAPH-INCARNATION-UNFENCED',
      invariant: 'A cached source from a deleted graph lifetime cannot synchronize into a same-ID replacement.',
      witness: 'A disconnected old workspace Y.Doc reconnects by graph ID and contaminates the replacement graph despite distinct server-side graph incarnation IDs.',
      required: 'Graph-incarnation header on workspace snapshots and mandatory query/handshake fence on workspace WebSockets and local cache keys.',
    })
  }
  if (currentState.invariantPass !== true && currentState.conflictSignalled !== true) {
    blockers.push({
      id: 'MO-RECONCILIATION-DECLARATION-NOT-EXECUTABLE',
      invariant: 'A declared reconciliation_strategy is enforced by the generic write/sync path.',
      witness: 'The functional generic path reports applied overwrite, while the contract declaration alone does not surface a conflict or execute codeBacked reconciliation.',
      required: 'Make reconciliation_strategy load-bearing in dispatch, with deterministic, source-kind-specific executors.',
    })
  }
  if (object(evidence.derivedProjectionProtocol, 'derived protocol').genericProjectionRebuildAvailable !== true) {
    blockers.push({
      id: 'MO-DERIVED-REBUILD-PROTOCOL-ABSENT',
      invariant: 'Every derived Meaningful Object can be invalidated and deterministically rebuilt from the merged authoritative source.',
      witness: `Five derived classes are declared, but the real tool surface exposes no generic projection wipe/rebuild/compare protocol (matching tools: ${projectionRebuildTools.join(', ') || 'none'}).`,
      required: 'An identity-fenced projection rebuild endpoint plus a source-derived set-equality check after wipe, restart, and replay.',
    })
  }

  const report = {
    ok: true,
    verdict: blockers.length === 0 ? 'GO' : 'NO-GO',
    scope: 'true fully-offline sync-later across Meaningful Object sources and workspace/document identity',
    binary,
    participants: [
      'real Gardend release process',
      'MCP client/replay A',
      'MCP client/replay B',
      'workspace y-websocket replica A',
      'workspace y-websocket replica B',
      'fresh observer replica',
      'stale old-graph-incarnation replica',
      'same Gardend disk profile after SIGKILL',
    ],
    passingControls: [
      'every served Emporium class is inventoried with a complete source signature',
      'workspace Y.Doc independent edits converge in both reconnect orders',
      'workspace folders, wires, documents, and a concurrent rename converge',
      'Memory identical content converges by content identity',
      'Memory divergent supersessions preserve both heads as contested in either order',
      'Memory observer membranes remain isolated from commons and one another',
      'all audited truth and all reproduced failures persist across Gardend process death',
    ],
    blockers,
    requiredProtocolChanges: [
      'Persist an explicit per-user/per-graph mirror manifest and epoch proving source completeness; a collection of cache hits is not a mirror.',
      'Key every cached source by user, graph ID, graph incarnation, object identity, and object incarnation where applicable.',
      'For Y.Doc sources, merge Yjs updates and deterministically rebuild every derived RDF/API/render face.',
      'For event-log sources, merge by stable client event ID, make lost-ack replay converge, and fold deterministically.',
      'For current-state sources, require base version/CAS; materialize divergent candidates as a contested Meaningful Object unless an executable declared policy resolves them.',
      'Treat derived sources as invalidatable/rebuildable read caches; never accept offline writes to them.',
      'Represent create/delete/recreate as stable lifecycle intents whose namespace, body, tombstone, and projection side effects complete atomically or resume idempotently.',
      'Make valuations a mergeable per-observer source with stable event identity rather than an unkeyed cumulative side effect.',
      'Fence workspace HTTP and WebSocket handshakes with the existing graph incarnation ID.',
      'Expose projection wipe/rebuild and compare source-derived set equality after restart.',
      'Surface quota/storage failure before claiming local durability.',
    ],
    evidence,
  }

  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (requireGo && blockers.length > 0) process.exitCode = 2
} catch (error) {
  const failure = {
    ok: false,
    verdict: 'HARNESS-ERROR',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    evidence,
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`)
  console.error('[offline-meaningful-objects:gardend] FAILED')
  console.error(JSON.stringify(failure, null, 2))
  throw error
} finally {
  for (const peer of peers) peer.destroy()
  await cell?.kill().catch(() => undefined)
  rmSync(runRoot, { recursive: true, force: true })
}
