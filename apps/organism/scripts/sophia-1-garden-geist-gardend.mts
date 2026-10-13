/**
 * Disposable real-gardend receipt for Sophia-1's Garden/Geist chronology.
 *
 * The test cell is deliberately not an Agent Session: setup creates the local
 * graph with a session-all loopback token, while the asserted Agent authority
 * is the compiled Agent Studio profile. A real wrong-graph/admin rejection
 * belongs to the Choreograph host-gate organism; Garden's local token cannot
 * honestly emulate it. This script proves that those operations are absent
 * from Sophia-1's authored toolbelt and never invokes them.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compileAgentStudioProfile,
  createSophiaClusterLeadProfile,
  SOPHIA_1_GARDEN_TOOL_POLICY,
} from '@shrubbery/domain-kit/agent-studio'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { type GardendCell, resolveGardendBin, spawnGardend } from '../src/cell/spawn-gardend.js'

type JsonObject = Record<string, unknown>

const GRAPH_ID = 'sophia-cluster'
const FOLDER_ID = 'sophia-1-proof-investigations'
const DOCUMENT_ID = 'sophia-1-geist-proof'
const RELATED_DOCUMENT_ID = 'sophia-1-geist-related-proof'
const INITIAL_TEXT = 'Sophia-1 records a bounded real-cell investigation.'
const EDIT_SUFFIX = ' Exact authored state survives reopening.'
const MEMORY_TEXT = 'Sophia-1 completed the disposable Garden/Geist chronology.'
const SONG_TEXT = 'The notebook remains a witnessed home after the body closes.'
const RUNTIME_DIGEST = `sha256:${'b'.repeat(64)}`
const OWNER = 'user:vera'
const TIMEOUT_MS = 30_000

const runRoot = mkdtempSync(join(tmpdir(), 'sophia-1-garden-geist.'))
const profileDir = join(runRoot, 'gardend-profile')

let cell: GardendCell | null = null
let runError: unknown = null
let cleanupError: unknown = null

try {
  const binary = resolveGardendBin()
  assert.equal(existsSync(binary), true, `real gardend binary does not exist: ${binary}`)

  // SETUP ONLY: this is the disposable test cell's lifecycle operation, not an
  // operation visible in the compiled Sophia-1 Agent toolbelt below.
  cell = await bounded('first gardend boot', spawnGardend({ bin: binary, profileDir, readyTimeoutMs: TIMEOUT_MS }))
  let mcp = mcpFor(cell)
  await call(mcp, 'create_graph', { graph_id: GRAPH_ID, title: 'Sophia-1 disposable Garden/Geist proof' })

  const profile = createSophiaClusterLeadProfile({ ownerPrincipal: OWNER, runtimeBundleDigest: RUNTIME_DIGEST })
  const publication = await compileAgentStudioProfile(profile, {
    promotedBy: OWNER,
    promotedAt: 1_800_000_000_000,
    promptDocument: { revision: 1, changeId: 'sophia-1-garden-geist-proof' },
  })
  assertSophiaGardenAuthority(profile, publication)

  // Direct MCP exercises Garden's real cell edge. The later Choreograph
  // organism binds these calls to the host-injected graph/observer identity.
  const orientation = await call(mcp, 'context_bundle', { graphId: GRAPH_ID, setHome: false, recallLimit: 8 })
  assert.equal(orientation.home_graph ?? orientation.homeGraph, GRAPH_ID, 'context bundle is graph-fenced')

  await call(mcp, 'create_folder', { graphId: GRAPH_ID, folderId: FOLDER_ID, name: 'Investigations', parentId: null })
  await call(mcp, 'create_document', {
    graphId: GRAPH_ID,
    documentId: DOCUMENT_ID,
    title: 'Garden Geist chronology proof',
    parentId: FOLDER_ID,
  })
  await call(mcp, 'write_document', {
    graphId: GRAPH_ID,
    documentId: DOCUMENT_ID,
    title: 'Garden Geist chronology proof',
    content: INITIAL_TEXT,
    awaitDurable: true,
  })
  const initial = await readDocument(mcp, DOCUMENT_ID)
  const initialBlockId = await firstBlockId(mcp, DOCUMENT_ID)

  await call(mcp, 'edit_block_text', {
    graphId: GRAPH_ID,
    documentId: DOCUMENT_ID,
    blockId: initialBlockId,
    operations: [{ type: 'insert', offset: INITIAL_TEXT.length, text: EDIT_SUFFIX }],
  })
  await flushAndReread(mcp, DOCUMENT_ID, `${INITIAL_TEXT}${EDIT_SUFFIX}`)
  await call(mcp, 'value', {
    graphId: GRAPH_ID,
    documentId: DOCUMENT_ID,
    blockId: initialBlockId,
    importance: 5,
    valence: 2,
    tags: ['sophia-1-proof'],
  })

  await call(mcp, 'create_document', {
    graphId: GRAPH_ID,
    documentId: RELATED_DOCUMENT_ID,
    title: 'Garden Geist related note',
    parentId: FOLDER_ID,
  })
  await call(mcp, 'write_document', {
    graphId: GRAPH_ID,
    documentId: RELATED_DOCUMENT_ID,
    title: 'Garden Geist related note',
    content: 'The related note anchors the first investigation.',
    awaitDurable: true,
  })
  await call(mcp, 'create_wires', {
    graphId: GRAPH_ID,
    sourceDocumentId: DOCUMENT_ID,
    targetGraphId: GRAPH_ID,
    targetDocumentId: RELATED_DOCUMENT_ID,
    predicate: 'supports',
  })
  const wires = await call(mcp, 'get_wires', { graphId: GRAPH_ID, documentId: DOCUMENT_ID, direction: 'outgoing' })
  assert.match(JSON.stringify(wires), new RegExp(RELATED_DOCUMENT_ID), 'wire connects the authored notes')

  await call(mcp, 'remember', {
    graphId: GRAPH_ID,
    content: MEMORY_TEXT,
    documentId: DOCUMENT_ID,
    blockIds: [initialBlockId],
  })
  const care = await call(mcp, 'care', { graphId: GRAPH_ID, numbers: [1] })
  assert.deepEqual(care.cared, [1], 'care updates the remembered entry')
  assert.equal(typeof care.timestamp, 'string', 'care returns its persisted timestamp')
  await call(mcp, 'sing', { graphId: GRAPH_ID, verse: SONG_TEXT, mode: 'coda' })
  const beforeRestartRecall = await call(mcp, 'recall', { graphId: GRAPH_ID, query: MEMORY_TEXT, limit: 8 })
  assert.match(JSON.stringify(beforeRestartRecall), new RegExp(MEMORY_TEXT), 'remember is visible before restart')

  assertPoisonFree(cell, [orientation, initial.value, wires, beforeRestartRecall])
  await cell.kill()
  cell = await bounded('second gardend boot', spawnGardend({ bin: binary, profileDir, readyTimeoutMs: TIMEOUT_MS }))
  mcp = mcpFor(cell)

  const reopenedOrientation = await call(mcp, 'context_bundle', { graphId: GRAPH_ID, setHome: false, recallLimit: 8 })
  const reopened = await readDocument(mcp, DOCUMENT_ID)
  const reopenedRecall = await call(mcp, 'recall', { graphId: GRAPH_ID, query: MEMORY_TEXT, limit: 8 })
  const reopenedCaredMemory = await call(mcp, 'recall', { graphId: GRAPH_ID, number: 1 })
  const reopenedWires = await call(mcp, 'get_wires', { graphId: GRAPH_ID, documentId: DOCUMENT_ID, direction: 'outgoing' })
  const reopenedSong = await call(mcp, 'music', { graphId: GRAPH_ID })
  const reopenedValues = await call(mcp, 'get_block_values', { graphId: GRAPH_ID, documentId: DOCUMENT_ID, blockId: initialBlockId })
  assert.equal(reopenedOrientation.home_graph ?? reopenedOrientation.homeGraph, GRAPH_ID, 'reopened orientation is graph-fenced')
  assert.match(reopened.content, new RegExp(`${INITIAL_TEXT}${EDIT_SUFFIX}`), 'exact authored document state survives reopen')
  assert.match(JSON.stringify(reopenedRecall), new RegExp(MEMORY_TEXT), 'remember survives reopen')
  assert.equal(memoryLastActive(reopenedCaredMemory), care.timestamp, 'care timestamp survives reopen')
  assert.match(JSON.stringify(reopenedWires), new RegExp(RELATED_DOCUMENT_ID), 'wire survives reopen')
  assert.match(JSON.stringify(reopenedSong), new RegExp(SONG_TEXT), 'Song coda survives reopen')
  assert.match(JSON.stringify(reopenedValues), new RegExp(initialBlockId), 'block valuation survives reopen')
  assert.match(JSON.stringify(reopenedValues), /"valuation_count":\s*[1-9]/, 'reopened valuation has a durable score')
  assertPoisonFree(cell, [reopenedOrientation, reopened.value, reopenedRecall, reopenedCaredMemory, reopenedWires, reopenedSong, reopenedValues])

  console.log(JSON.stringify({
    schema: 'sophia-1.garden-geist.real-cell-receipt.v1',
    graphId: GRAPH_ID,
    chronology: ['context_bundle', 'create_folder', 'create_document', 'write_document', 'edit_block_text', 'value', 'create_wires', 'remember', 'care', 'sing', 'reopen', 'recall', 'music', 'get_block_values'],
    crdtProof: 'native flush_crdt plus bounded fresh read_document reread',
    deletion: 'declared human-always; not invoked',
    unavailableInProfile: ['sparql_update', 'create_graph', 'delete_graph', 'duplicate_graph', 'manage_graph', 'workflow_run', 'source_push'],
    hostGateBoundary: 'real wrong-graph/admin denial is reserved for the Choreograph-integrated organism',
    poisonFree: true,
  }, null, 2))
} catch (error) {
  runError = error
} finally {
  try { await cell?.kill() } catch (error) { cleanupError ??= error }
  try { await rm(runRoot, { recursive: true, force: true }) } catch (error) { cleanupError ??= error }
}

if (runError) throw runError
if (cleanupError) throw cleanupError

function mcpFor(cellValue: GardendCell): LoopbackMcpClient {
  return new LoopbackMcpClient({
    mcpUrl: cellValue.mcpUrl,
    healthUrl: `${cellValue.apiUrl}/health`,
    token: cellValue.token,
    origin: 'http://127.0.0.1',
  })
}

async function call(mcp: LoopbackMcpClient, tool: string, args: JsonObject): Promise<JsonObject> {
  const value = await bounded(`${tool} MCP call`, mcp.callTool(tool, args))
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${tool} returned an object`)
  return value as JsonObject
}

async function readDocument(mcp: LoopbackMcpClient, documentId: string): Promise<{ readonly content: string; readonly value: JsonObject }> {
  const value = await call(mcp, 'read_document', { graphId: GRAPH_ID, documentId, format: 'markdown' })
  const content = value.content
  assert.equal(typeof content, 'string', `read_document ${documentId} returned content`)
  return { content: content as string, value }
}

async function flushAndReread(mcp: LoopbackMcpClient, documentId: string, expected: string): Promise<void> {
  await call(mcp, 'flush_crdt', { graphId: GRAPH_ID, documentId })
  const deadline = Date.now() + TIMEOUT_MS
  let latest = ''
  while (Date.now() < deadline) {
    latest = (await readDocument(mcp, documentId)).content
    if (latest.includes(expected)) return
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  throw new Error(`CRDT flush/re-read did not expose expected content; last=${latest}`)
}

async function firstBlockId(mcp: LoopbackMcpClient, documentId: string): Promise<string> {
  const blocks = await call(mcp, 'read_blocks', { graphId: GRAPH_ID, documentId, format: 'markdown' })
  const first = Array.isArray(blocks.blocks) ? blocks.blocks[0] : undefined
  assert.ok(first && typeof first === 'object' && !Array.isArray(first), 'read_blocks returned a first block')
  const blockId = (first as JsonObject).blockId ?? (first as JsonObject).block_id
  assert.equal(typeof blockId, 'string', 'first block has a stable block id')
  return blockId as string
}

function assertSophiaGardenAuthority(profile: ReturnType<typeof createSophiaClusterLeadProfile>, publication: Awaited<ReturnType<typeof compileAgentStudioProfile>>): void {
  const gardenNames = profile.tools.filter(tool => tool.capability === 'mnemosyne').map(tool => tool.name)
  assert.deepEqual(gardenNames, SOPHIA_1_GARDEN_TOOL_POLICY.map(([name]) => name), 'complete native Garden/Geist toolbelt')
  const gardenGrant = profile.grant.capabilities.find(capability => capability.capability === 'mnemosyne')
  assert.deepEqual(gardenGrant?.fence.graphIds, [GRAPH_ID], 'Garden grant allows exactly sophia-cluster')
  assert.deepEqual(gardenGrant?.operationPolicies, { delete_document: 'human-always', delete_blocks: 'human-always' })
  const manifest = JSON.parse(publication.homeDocuments[publication.activeDocumentIds.toolManifest]) as { tools: Array<{ name: string; approvalPolicy: { mode: string } }> }
  const manifestNames = manifest.tools.map(tool => tool.name)
  for (const forbidden of ['sparql_update', 'create_graph', 'delete_graph', 'duplicate_graph', 'manage_graph', 'workflow_run', 'source_push']) {
    assert.equal(manifestNames.includes(forbidden), false, `${forbidden} is unavailable in the published profile`)
  }
  for (const name of ['delete_document', 'delete_blocks']) {
    assert.equal(manifest.tools.find(tool => tool.name === name)?.approvalPolicy.mode, 'always', `${name} is approval-only`)
  }
}

function assertPoisonFree(cellValue: GardendCell, authoredState: readonly unknown[]): void {
  const disclosed = JSON.stringify(authoredState)
  for (const poison of [cellValue.token, cellValue.profileDir]) {
    assert.equal(disclosed.includes(poison), false, 'setup credential/profile path leaked into authored state')
  }
  assert.equal(disclosed.includes('observatory'), false, 'another graph identifier leaked into authored state')
}

function memoryLastActive(value: JsonObject): string {
  const memory = Array.isArray(value.memories) ? value.memories[0] : undefined
  assert.ok(memory && typeof memory === 'object' && !Array.isArray(memory), 'recall by number returns one memory')
  const lastActive = (memory as JsonObject).last_active ?? (memory as JsonObject).lastActive
  assert.equal(typeof lastActive, 'string', 'recalled memory carries last_active')
  return lastActive as string
}

async function bounded<T>(label: string, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
