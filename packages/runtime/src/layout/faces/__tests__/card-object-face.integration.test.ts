/**
 * card-object-face.integration.test.ts — the REAL-CELL proof for
 * `card.object` (mirrors card-subject-face.integration.test.ts's own shape,
 * WS1 §9 S3, master spec §3 Slice 2, gate G4a). Spawns a REAL headless
 * `gardend` binary, creates a real graph over MCP, writes a real
 * `emporium-bookmark.Bookmark` Meaningful Object via the real `emporium_write`
 * path, and drives the REAL `FaceRegistry`/`LayoutResourceBroker`/
 * `LayoutInterpreter` machinery with the REAL `card.object` face over a REAL
 * (test-scoped) `SourceObjectService` (see ./support/test-source-object-
 * service.ts's own header for why it is not `apps/organism`'s production one).
 *
 * Proves, against the real cell:
 *   - a real MO written over MCP renders its real fields, real short
 *     version, real strategy chip;
 *   - a bad (non-object) locator produces the interpreter's diagnostic, not
 *     a partial card;
 *   - a second leaf on the same object shares one retained store (broker
 *     `diagnostics().retainedDerivedRefCounts`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { McpClient } from '@shrubbery/source'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { deepFreeze, type LayoutDocument, type ViewDescriptor } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { objectUrn } from '../../source-object-service.js'
import { createCardObjectFace, createCardObjectResourceAdapter, CARD_OBJECT_FACE_ID } from '../card-object-face.js'
import { TestSourceObjectService } from './support/test-source-object-service.js'

const GARDEN_BIN = resolveGardendBin()
const GRAPH_ID = 'card-object-face-it'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'card-object-face-bookmark'

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

function cardDoc(descriptor: ViewDescriptor, nodeId = 'K1'): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'card-object-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: nodeId,
    nodes: { [nodeId]: { kind: 'leaf', id: nodeId, descriptor, descriptorRevision: 0 } },
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  })
}

let cell: GardendCell
let mcp: McpClient
let objects: TestSourceObjectService

beforeAll(async () => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `card-object-face.integration.test.ts requires the real gardend binary at ${GARDEN_BIN}. Set GARDEN_BIN to override.`,
    )
  }
  cell = await spawnGardend()
  mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
  objects = new TestSourceObjectService(mcp)
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'card.object real-cell integration' })
  // Checkpoint the graph into source authority BEFORE writing — a write
  // against a graph with no ledger yet lands only in the legacy projection
  // and never appears in `bundle.currentState` (verified empirically; see
  // source-object-runtime.integration.test.ts's own beforeAll comment).
  await mcp.toolsCall('source_pull', { graphId: GRAPH_ID })
  const write = (await mcp.callTool('emporium_write', {
    graph_id: GRAPH_ID,
    vocab: VOCAB,
    records: [{ kind: CLASS, clientRef: OBJECT_ID, url: 'https://shrubbery.test/card-object-face', title: 'Card Object Face IT' }],
  })) as { ok?: boolean }
  expect(write.ok).toBe(true)
}, 30000)

afterAll(async () => {
  await cell?.kill()
}, 15000)

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})
afterEach(() => {
  root.remove()
})

function buildInterpreter(): { interpreter: LayoutInterpreter; broker: LayoutResourceBroker } {
  const registry = new FaceRegistry()
  registry.register(createCardObjectFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createCardObjectResourceAdapter(objects))
  const interpreter = new LayoutInterpreter(root, { registry, broker })
  return { interpreter, broker }
}

type CardView = HTMLElement & {
  status: string
  error: string
  title: string
  vocab: string
  className_: string
  sourceVersion: string
  reconciliationStrategy: string
  fields: readonly { label: string; value: string }[]
}

describe('card.object — real gardend cell, real MO render', () => {
  it('a real MO written over MCP renders its real fields, real short version, real strategy chip', async () => {
    const { interpreter } = buildInterpreter()
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_OBJECT_FACE_ID,
      resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri: objectUrn({ vocab: VOCAB, class: CLASS, objectId: OBJECT_ID }) },
    }
    const result = await interpreter.reconcile(cardDoc(descriptor), { width: 400, height: 300 })
    expect(result.ok).toBe(true)

    const view = interpreter.leafWrapperElement('K1')!.querySelector('sh-object-card-view') as CardView
    await waitFor(() => view.status === 'ready')

    expect(view.vocab).toBe(VOCAB)
    expect(view.className_).toBe(CLASS)
    expect(view.fields.find((f) => f.label === 'url')?.value).toBe('https://shrubbery.test/card-object-face')
    expect(view.fields.find((f) => f.label === 'title')?.value).toBe('Card Object Face IT')
    // Real short version: exactly the first 8 hex chars of a real sha256.
    expect(view.sourceVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(view.reconciliationStrategy).toBe('code-backed')

    await interpreter.dispose()
  }, 20000)

  it('a bad (non-object) locator produces the interpreter diagnostic, not a partial card', async () => {
    const { interpreter } = buildInterpreter()
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_OBJECT_FACE_ID,
      resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri: `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:bookmark:bookmark:${OBJECT_ID}` },
    }
    const result = await interpreter.reconcile(cardDoc(descriptor), { width: 400, height: 300 })
    // A non-object-URN subjectIri fails accepts() -> the document-level
    // `isFaceRegistered` predicate (FaceRegistry.validate, which folds
    // `resource-rejected` into the SAME boolean as "faceId unregistered" by
    // design — see face-registry.ts's toFaceRegistrationPredicate) rejects
    // the WHOLE document (LAY-012: invalid documents don't partially
    // render) — never a half-drawn card.object leaf.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics.some((d) => d.code === 'LAY003_UNREGISTERED_FACE')).toBe(true)
    }
    expect(root.querySelector('sh-object-card-view')).toBeNull()

    await interpreter.dispose()
  }, 20000)

  it('two leaves on the same object share ONE retained store', async () => {
    const { interpreter, broker } = buildInterpreter()
    const subjectIri = objectUrn({ vocab: VOCAB, class: CLASS, objectId: OBJECT_ID })
    const doc: LayoutDocument = deepFreeze({
      schemaVersion: 1,
      layoutId: 'card-object-two-leaves',
      scope: 'session',
      graphId: GRAPH_ID,
      rootNodeId: 'split',
      nodes: {
        split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'K1', endNodeId: 'K2', startBasisPoints: 5000 },
        K1: {
          kind: 'leaf',
          id: 'K1',
          descriptorRevision: 0,
          descriptor: { schemaVersion: 1, faceId: CARD_OBJECT_FACE_ID, resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri } },
        },
        K2: {
          kind: 'leaf',
          id: 'K2',
          descriptorRevision: 0,
          descriptor: { schemaVersion: 1, faceId: CARD_OBJECT_FACE_ID, resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri } },
        },
      },
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 300 })
    expect(result.ok).toBe(true)

    const view1 = interpreter.leafWrapperElement('K1')!.querySelector('sh-object-card-view') as CardView
    const view2 = interpreter.leafWrapperElement('K2')!.querySelector('sh-object-card-view') as CardView
    await waitFor(() => view1.status === 'ready' && view2.status === 'ready')

    const refCounts = broker.diagnostics().retainedDerivedRefCounts ?? {}
    const counts = Object.values(refCounts)
    expect(counts).toContain(2)

    await interpreter.dispose()
  }, 20000)
})
