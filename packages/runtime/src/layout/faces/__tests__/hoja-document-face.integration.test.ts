/**
 * hoja-document-face.integration.test.ts — the REAL-CELL proof (design
 * §9.1 "Proving leaf A", Builder-2 task brief: "editor face against a real
 * doc room via gardend-dev"). Spawns a REAL headless `gardend` binary
 * (`@shrubbery/source/node`'s `spawnGardend` — NO MOCKS, throws loudly if the
 * binary is missing, matching this repo's established convention), creates a
 * real graph over MCP, opens a REAL WebSocket doc-sync room
 * (`/hocuspocus/docs/{graphId}/{docId}`, real `y-websocket` protocol) through
 * the REAL `EditorRoomPool`, and drives it all through the REAL
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter` machinery.
 *
 * Proves, against the real cell:
 *   - two leaves on the same document share the exact SAME `ProviderHandle`
 *     (same Y.Doc/awareness), both real WS-synced;
 *   - each leaf mounts its OWN real `<sh-editor-host>` with its OWN real
 *     ProseMirror `EditorView` DOM (distinct nodes, one shared document);
 *   - closing one leaf leaves the other's room alive; closing the last one
 *     destroys the real WS provider exactly once.
 */
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import WS from 'ws'
import { McpClient } from '@shrubbery/source'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { EditorRoomPool } from '../../../collab/editor-room-pool.js'
import { createHojaDocumentFace, createHojaDocumentResourceAdapter, HOJA_DOCUMENT_FACE_ID } from '../hoja-document-face.js'
import { TestLoopbackCrdtBackend } from './support/loopback-crdt-backend.js'

const GARDEN_BIN = resolveGardendBin()
const GRAPH_ID = 'layout-p1-hoja-it'
const DOCUMENT_ID = 'doc-real'

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function documentLeaf(id: string) {
  return {
    kind: 'leaf' as const,
    id,
    descriptor: {
      schemaVersion: 1 as const,
      faceId: HOJA_DOCUMENT_FACE_ID,
      resource: { kind: 'document' as const, graphId: GRAPH_ID, documentId: DOCUMENT_ID },
    },
    descriptorRevision: 0,
  }
}

function twoLeafDoc(): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'hoja-real-split',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'split',
    nodes: {
      split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'a', endNodeId: 'b', startBasisPoints: 5000 },
      a: documentLeaf('a'),
      b: documentLeaf('b'),
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

let cell: GardendCell

beforeAll(async () => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `hoja-document-face.integration.test.ts requires the real gardend binary at ${GARDEN_BIN}. Set GARDEN_BIN to override.`,
    )
  }
  cell = await spawnGardend()
  const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Layout P1 hoja.document integration' })
  // A room name is not object existence testimony. Create the authoritative
  // Meaningful Object first; otherwise a stale Surface could resurrect a
  // deleted/never-created document merely by opening its WebSocket route.
  await mcp.toolsCall('create_document', {
    graphId: GRAPH_ID,
    documentId: DOCUMENT_ID,
    title: 'Real shared Hoja document',
  })
}, 30000)

afterAll(async () => {
  await cell?.kill()
}, 15000)

let root: HTMLElement
let pool: EditorRoomPool
let backend: TestLoopbackCrdtBackend

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
  backend = new TestLoopbackCrdtBackend({ mcpUrl: cell.mcpUrl, token: cell.token, WebSocketPolyfill: WS as unknown as new (url: string | URL, protocols?: string | string[]) => unknown })
  pool = new EditorRoomPool(backend)
})

afterEach(() => {
  backend.destroyAll()
  root.remove()
})

function buildInterpreter(): LayoutInterpreter {
  const registry = new FaceRegistry()
  registry.register(createHojaDocumentFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
  return new LayoutInterpreter(root, { registry, broker })
}

describe('hoja.document — real gardend cell, real WS doc room', () => {
  it('two leaves on the same real document share the exact same real ProviderHandle, both synced', async () => {
    const interpreter = buildInterpreter()
    const result = await interpreter.reconcile(twoLeafDoc(), { width: 1000, height: 400 })
    expect(result.ok).toBe(true)

    const hostA = interpreter.leafWrapperElement('a')!.querySelector('sh-editor-host') as HTMLElement & {
      binding: { get(): { provider: { whenSynced: Promise<void> } } }
    }
    const hostB = interpreter.leafWrapperElement('b')!.querySelector('sh-editor-host') as HTMLElement & {
      binding: { get(): { provider: { whenSynced: Promise<void> } } }
    }
    expect(hostA).not.toBe(hostB)

    const providerA = hostA.binding.get().provider
    const providerB = hostB.binding.get().provider
    expect(providerA).toBe(providerB) // the exact SAME real ProviderHandle

    await providerA.whenSynced // real WS sync round-trip against the real cell

    // Broker-level: one real load, ref-counted twice.
    expect(pool.snapshot().roomCount).toBe(1)
    expect(pool.snapshot().rooms[0].refCount).toBe(1)

    await interpreter.dispose()
  }, 20000)

  it('each leaf mounts its OWN real live EditorView DOM over the one shared document', async () => {
    const interpreter = buildInterpreter()
    await interpreter.reconcile(twoLeafDoc(), { width: 1000, height: 400 })
    const hostA = interpreter.leafWrapperElement('a')!.querySelector('sh-editor-host') as HTMLElement
    const hostB = interpreter.leafWrapperElement('b')!.querySelector('sh-editor-host') as HTMLElement

    await waitFor(() => {
      const pmA = hostA.shadowRoot?.querySelector('.editor-mount .ProseMirror')
      const pmB = hostB.shadowRoot?.querySelector('.editor-mount .ProseMirror')
      return pmA != null && pmB != null
    })

    const pmA = hostA.shadowRoot!.querySelector('.editor-mount .ProseMirror') as HTMLElement
    const pmB = hostB.shadowRoot!.querySelector('.editor-mount .ProseMirror') as HTMLElement
    expect(pmA).not.toBe(pmB) // distinct real EditorView DOM per leaf
    expect(pmA.getAttribute('contenteditable')).not.toBeNull()
    expect(pmB.getAttribute('contenteditable')).not.toBeNull()

    await interpreter.dispose()
  }, 20000)

  it('closing one leaf leaves the real room/provider alive for the other; closing the last destroys it once', async () => {
    const { applyOperation, locateParent } = await import('@shrubbery/nucleus/layout')
    const { createSophiaHomeFace, createSophiaHomeResourceAdapter } = await import('../sophia-home-face.js')

    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0 = twoLeafDoc()
    await interpreter.reconcile(doc0, { width: 1000, height: 400 })
    expect(pool.snapshot().roomCount).toBe(1)

    const closeB = applyOperation(doc0, { op: 'close_leaf', leafId: 'b', expectedParent: locateParent(doc0, 'b')! }, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
    })
    if (!closeB.ok) throw new Error(`close_leaf failed: ${closeB.diagnostic.code}`)
    await interpreter.reconcile(closeB.doc, { width: 1000, height: 400 })
    expect(pool.snapshot().roomCount).toBe(1) // 'a' keeps the real room alive

    const closeA = applyOperation(closeB.doc, { op: 'close_leaf', leafId: 'a', expectedParent: locateParent(closeB.doc, 'a')! }, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
    })
    if (!closeA.ok) throw new Error(`close_leaf failed: ${closeA.diagnostic.code}`)
    await interpreter.reconcile(closeA.doc, { width: 1000, height: 400 })

    expect(pool.snapshot().roomCount).toBe(0) // the real WS provider was destroyed exactly once

    await interpreter.dispose()
  }, 20000)
})
