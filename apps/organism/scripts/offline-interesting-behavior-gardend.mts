/**
 * Residual-capability audit for the unqualified phrase “fully offline”.
 *
 * The source-sync and browser harnesses prove the replicated authority they
 * exercise. This real-process audit looks for interesting durable behavior
 * outside that authority, and for legacy mutation entry points that can still
 * bypass it. A reproduced blocker is a successful audit result, not a harness
 * error.
 */

import {
  createHash,
} from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  OfflineSemanticSearchIndex,
  validateSourceBundle,
  type SourceBundle,
} from '@shrubbery/source'
import {
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import {
  LoopbackMcpClient,
  type McpToolDescriptor,
} from '../src/cell/loopback-mcp.js'

type JsonObject = Record<string, unknown>

const graphId = 'offline-interesting-behavior'
const graphIncarnation = '11111111-1111-4111-8111-111111111111'
const graphCreateOperationId = 'offline-interesting-create'
const documentId = 'offline-capability-document'
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-offline-capability.'))
const profileDir = join(runRoot, 'gardend-profile')
const uploadPath = join(runRoot, 'offline-original.txt')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`offline capability audit assertion failed: ${message}`)
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

const sleep = (ms: number): Promise<void> =>
  new Promise(resolveSleep => setTimeout(resolveSleep, ms))

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
  return object(await mcp.callTool(tool, args), `${tool} result`)
}

async function pull(
  mcp: LoopbackMcpClient,
  incarnation?: string,
): Promise<SourceBundle> {
  const bundle = await mcp.callTool('source_pull', {
    graphId,
    ...(incarnation ? { graphIncarnation: incarnation } : {}),
  }) as SourceBundle
  await validateSourceBundle(bundle, graphId, incarnation)
  return bundle
}

function toolByName(
  tools: readonly McpToolDescriptor[],
  name: string,
): McpToolDescriptor {
  const tool = tools.find(candidate => candidate.name === name)
  assert(tool, `tool ${name} is advertised`)
  return tool
}

function schemaHasAny(tool: McpToolDescriptor, names: readonly string[]): boolean {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined
  return names.some(name => Object.hasOwn(schema?.properties ?? {}, name))
}

async function waitJob(
  mcp: LoopbackMcpClient,
  jobId: string,
  timeoutMs = 45_000,
): Promise<JsonObject> {
  const deadline = Date.now() + timeoutMs
  let last: JsonObject | null = null
  while (Date.now() < deadline) {
    last = await call(mcp, 'get_job_status', { jobId })
    const status = String(last.status ?? '')
    if (status === 'succeeded') return call(mcp, 'get_job_result', { jobId })
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`artifact job ${jobId} ended ${status}: ${JSON.stringify(last)}`)
    }
    await sleep(100)
  }
  throw new Error(`artifact job ${jobId} timed out; last=${JSON.stringify(last)}`)
}

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...filesBelow(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function legacyBookmarkPresent(
  mcp: LoopbackMcpClient,
): Promise<{ readonly present: boolean; readonly value?: JsonObject; readonly error?: string }> {
  try {
    const value = await call(mcp, 'emporium_read', {
      graph_id: graphId,
      vocab: 'emporium-bookmark',
      class: 'Bookmark',
      address: 'legacy-only',
    })
    return { present: true, value }
  } catch (error) {
    return {
      present: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

let cell: GardendCell | null = null

try {
  const binary = resolve(resolveGardendBin())
  assert(existsSync(binary), `Gardend binary exists at ${binary}`)
  const binarySha256 = sha256(readFileSync(binary))
  cell = await spawnGardend({ bin: binary, profileDir, readyTimeoutMs: 45_000 })
  const mcp = mcpFor(cell)
  const tools = await mcp.toolsList()

  await call(mcp, 'create_graph', {
    graph_id: graphId,
    title: 'Offline capability audit',
    graphIncarnation,
    operationId: graphCreateOperationId,
  })
  await call(mcp, 'create_graph', {
    graph_id: graphId,
    title: 'Offline capability audit',
    graphIncarnation,
    operationId: graphCreateOperationId,
  })
  let mismatchedGraphCreateRejected = false
  try {
    await call(mcp, 'create_graph', {
      graph_id: graphId,
      title: 'Different lifetime',
      graphIncarnation: '99999999-9999-4999-8999-999999999999',
      operationId: 'offline-interesting-create-different',
    })
  } catch (error) {
    mismatchedGraphCreateRejected = /different lifecycle identity|already exists|conflict/i.test(
      error instanceof Error ? error.message : String(error),
    )
  }
  assert(mismatchedGraphCreateRejected, 'different graph lifecycle identity is rejected')
  const firstWrite = await call(mcp, 'write_document', {
    graphId,
    documentId,
    content: 'First durable document version.',
    awaitDurable: true,
  })
  const blockId = text(
    array(firstWrite.blockIds ?? firstWrite.block_ids, 'first write block ids')[0],
    'first block id',
  )
  await call(mcp, 'write_document', {
    graphId,
    documentId,
    content: 'Second durable document version.',
    awaitDurable: true,
  })

  // Establish the immutable source migration floor before exercising legacy
  // mutation entry points. Anything authored afterwards must itself become a
  // replayable source or a destructive rebuild will expose the bypass.
  let bundle = await pull(mcp)
  const incarnation = bundle.graphIncarnation
  assert(incarnation === graphIncarnation, 'client-minted graph incarnation is authoritative')

  await call(mcp, 'emporium_write', {
    graph_id: graphId,
    vocab: 'emporium-bookmark',
    records: [{
      kind: 'Bookmark',
      clientRef: 'legacy-only',
      url: 'https://offline.test/legacy-only',
      title: 'Legacy mutation after checkpoint',
    }],
  })
  const bookmarkBeforeRebuild = await legacyBookmarkPresent(mcp)
  assert(bookmarkBeforeRebuild.present, 'legacy bookmark exists before source rebuild')

  await call(mcp, 'value', {
    graphId,
    documentId,
    blockId,
    importance: 4,
  })
  const valuesBeforeRebuild = await call(mcp, 'get_block_values', {
    graphId,
    documentId,
  })

  const rebuild = await call(mcp, 'source_rebuild', {
    graphId,
    graphIncarnation: incarnation,
  })
  const bookmarkAfterRebuild = await legacyBookmarkPresent(mcp)
  const valuesAfterRebuild = await call(mcp, 'get_block_values', {
    graphId,
    documentId,
  })

  const history = await call(mcp, 'get_document_history', {
    graphId,
    documentId,
    limit: 200,
  })
  const historyEntries = Array.isArray(history.entries)
    ? history.entries
    : Array.isArray(history.snapshots)
      ? history.snapshots
      : Array.isArray(history.history)
        ? history.history
        : []

  const originalBytes = Buffer.from(
    'ORIGINAL-BYTE-AUTHORITY\nThis exact source file must survive a complete offline mirror.\n',
    'utf8',
  )
  writeFileSync(uploadPath, originalBytes)
  const upload = await call(mcp, 'upload_artifact', {
    graphId,
    filePath: uploadPath,
    label: 'Offline original source',
  })
  const jobId = text(upload.jobId ?? upload.job_id, 'artifact upload job id')
  const uploadResult = await waitJob(mcp, jobId)
  const uploadedDocumentId = text(
    uploadResult.documentId
      ?? uploadResult.document_id
      ?? uploadResult.artifactId
      ?? uploadResult.artifact_id
      ?? upload.documentId
      ?? upload.document_id,
    'uploaded document id',
  )

  bundle = await pull(mcp, incarnation)
  const manifestMembers = bundle.manifest.members
  const memberIds = manifestMembers.map(member => member.objectId)
  const originalFiles = filesBelow(profileDir).filter(path =>
    basename(path) === basename(uploadPath)
    && statSync(path).size === originalBytes.length
    && sha256(readFileSync(path)) === sha256(originalBytes))
  assert(originalFiles.length > 0, 'uploaded original bytes are durable in the Gardend profile')
  const originalDigest = sha256(originalBytes)
  const originalIsManifestMember = manifestMembers.some(member =>
    member.localDigest === originalDigest
    || /original|artifact.*payload|blob:/i.test(member.objectId))
  const historyIsManifestMember = memberIds.some(id =>
    /document-history:|history-snapshot:|document-revision:/i.test(id))
    || Object.hasOwn(bundle, 'documentHistory')
    || Object.hasOwn(bundle, 'history')
  const semanticIndexIsManifestMember = memberIds.some(id => /semantic|embedding|vector|index:/i.test(id))
  const offlineSemanticHits = new OfflineSemanticSearchIndex(bundle.semanticCorpus ?? [])
    .search('Second durable document version', 20)
  const semanticOfflineFunctional = offlineSemanticHits.some(hit =>
    hit.documentId === documentId
    && /Second durable document version/i.test(hit.content))

  const sourcePush = toolByName(tools, 'source_push')
  const sourceKinds = (
    sourcePush.inputSchema as {
      properties?: {
        operations?: {
          items?: {
            properties?: {
              kind?: { enum?: unknown[] }
            }
          }
        }
      }
    }
  ).properties?.operations?.items?.properties?.kind?.enum ?? []
  const replaySchema = {
    emporiumWrite: schemaHasAny(toolByName(tools, 'emporium_write'), [
      'operationId',
      'operation_id',
      'baseVersion',
      'base_version',
    ]),
    emporiumRetract: schemaHasAny(toolByName(tools, 'emporium_retract'), [
      'operationId',
      'operation_id',
      'retractionEventId',
      'retraction_event_id',
    ]),
    value: schemaHasAny(toolByName(tools, 'value'), [
      'operationId',
      'operation_id',
      'valuationEventId',
      'valuation_event_id',
    ]),
  }

  const blockers = [
    ...(!bookmarkAfterRebuild.present || JSON.stringify(valuesBeforeRebuild) !== JSON.stringify(valuesAfterRebuild)
      ? [{
          id: 'LEGACY-MUTATION-AUTHORITY-BYPASS',
          invariant: 'Every accepted durable mutation after source activation is replayable from the source ledger.',
          witness: {
            bookmarkBeforeRebuild,
            bookmarkAfterRebuild,
            valuesBeforeRebuild,
            valuesAfterRebuild,
          },
          required: 'Route or atomically import legacy Emporium, valuation, retraction, and raw RDF authoring into stable source intents; otherwise reject those writes once source authority is active.',
        }]
      : []),
    ...(!originalIsManifestMember
      ? [{
          id: 'ORIGINAL-BYTES-OMITTED',
          invariant: 'A complete mirror includes the byte authority behind every mirrored artifact/document source-file reference.',
          witness: {
            uploadedDocumentId,
            originalDigest,
            durableProfileFiles: originalFiles.length,
            manifestMembers: memberIds,
          },
          required: 'Add a content-addressed, chunked resource manifest and durable browser blob store; a monolithic JSON source bundle is not sufficient for large originals.',
        }]
      : []),
    ...(historyEntries.length > 0 && !historyIsManifestMember
      ? [{
          id: 'DOCUMENT-HISTORY-OMITTED',
          invariant: 'Cold offline history/restore behavior has every durable snapshot authority, not only the current Y.Doc.',
          witness: {
            serverHistoryEntries: historyEntries.length,
            historyManifestMembers: memberIds.filter(id =>
              /document-history:|history-snapshot:|document-revision:/i.test(id)),
          },
          required: 'Enumerate content-addressed history snapshots and restore metadata in the mirror protocol.',
        }]
      : []),
    ...(!semanticIndexIsManifestMember || !semanticOfflineFunctional
      ? [{
          id: 'SEMANTIC-DERIVED-PLANE-UNAVAILABLE',
          invariant: 'Interesting derived behavior can be rebuilt or executed locally from mirrored sources.',
          witness: {
            semanticSearchAdvertised: tools.some(tool => tool.name === 'semantic_search'),
            semanticManifestMembers: memberIds.filter(id => /semantic|embedding|vector|index:/i.test(id)),
            offlineSemanticHits,
          },
          required: 'Ship a browser-capable embedding/search implementation or an epoch-bound local semantic-index artifact with deterministic invalidation.',
        }]
      : []),
    ...(!mismatchedGraphCreateRejected || incarnation !== graphIncarnation
      ? [{
          id: 'GRAPH-CONTROL-PLANE-NOT-OFFLINE',
          invariant: 'Offline graph creation/deletion has a durable identity and later reconciliation contract.',
          witness: {
            createGraphAdvertised: tools.some(tool => tool.name === 'create_graph'),
            graphIncarnation: incarnation,
            requestedGraphIncarnation: graphIncarnation,
            mismatchedGraphCreateRejected,
          },
          required: 'Persist client-minted graph lifecycle identity above the graph ledger and fence every retry/delete against it.',
        }]
      : []),
  ]
  const nonLocalBoundaries = [
    {
      id: 'CONCURRENT-AUTHORIZATION-CANNOT-BE-OBSERVED-OFFLINE',
      invariant: 'A partitioned client cannot both continue autonomously and know a concurrent grant/revocation decision made at the gateway.',
      witness: {
        localGraphIncarnationIsFenced: incarnation === graphIncarnation,
        authorizationAuthority: 'gateway ACL, outside the graph source bundle',
        offlineBehavior: 'authoring intents remain recoverable and may later be accepted or rejected; permission changes are not locally authoritative',
      },
      required: 'Choose an explicit policy: fail closed, or issue bounded signed offline capabilities and reconcile/recover work after revocation. Neither can provide instantaneous revocation knowledge during a partition.',
      fundamental: true,
    },
    {
      id: 'EXTERNAL-EFFECTS-CANNOT-EXECUTE-WITHOUT-THEIR-RESOURCES',
      invariant: 'A local mirror cannot execute provider-backed inference, remote parser/OCR jobs, connectors, or observe resources that were never mirrored.',
      witness: {
        mirroredSemanticSearchExecutesLocally: semanticOfflineFunctional,
        distinction: 'source-derived behavior is local; network/model/provider effects can only be replaced locally or queued',
      },
      required: 'Bundle a local implementation and its model/resource for each effect, or represent the request as a durable intent whose execution is explicitly deferred until reconnection.',
      fundamental: true,
    },
  ]
  assert(
    sha256(readFileSync(binary)) === binarySha256,
    'Gardend binary did not change during the residual-capability audit',
  )

  const report = {
    ok: true,
    verdict: blockers.length === 0 && nonLocalBoundaries.length === 0 ? 'GO' : 'NO-GO',
    replicatedDataPlaneVerdict: blockers.length === 0 ? 'GO' : 'NO-GO',
    scope: 'unqualified fully-offline behavior beyond the replicated graph-source core',
    provenance: {
      gardend: {
        path: binary,
        sha256: binarySha256,
      },
    },
    evidence: {
      toolCount: tools.length,
      sourceOperationKinds: sourceKinds,
      legacyReplaySchema: replaySchema,
      rebuild,
      artifact: {
        uploadedDocumentId,
        originalDigest,
        originalProfileFiles: originalFiles.length,
        originalIsManifestMember,
      },
      history: {
        serverEntries: historyEntries.length,
        historyIsManifestMember,
      },
      semantic: {
        toolAdvertised: tools.some(tool => tool.name === 'semantic_search'),
        semanticIndexIsManifestMember,
        semanticOfflineFunctional,
        hits: offlineSemanticHits,
      },
      graphLifecycle: {
        requestedGraphIncarnation: graphIncarnation,
        authoritativeGraphIncarnation: incarnation,
        exactCreateRetry: true,
        mismatchedGraphCreateRejected,
      },
    },
    blockers: [...blockers, ...nonLocalBoundaries],
    replicatedDataPlaneBlockers: blockers,
    nonLocalBoundaries,
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  const failure = {
    ok: false,
    verdict: 'HARNESS-ERROR',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`)
  console.error('[offline-interesting-behavior:gardend] FAILED')
  console.error(JSON.stringify(failure, null, 2))
  throw error
} finally {
  await cell?.kill().catch(() => undefined)
  rmSync(runRoot, { recursive: true, force: true })
}
