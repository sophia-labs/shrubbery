/**
 * W14.1 — the LEAF-LEVEL half of lossless content exposure: `hoja.document`'s
 * `FaceView.content` port, reached the way a workbench controller outside the
 * face will actually reach it (`LayoutInterpreter.mountedView(leafId)` →
 * `hojaDocumentContentPort(view)`).
 *
 * NO MOCKS: real `FaceRegistry` / `LayoutResourceBroker` / `LayoutInterpreter`,
 * a real `EditorRoomPool` over a real `Y.Doc`-backed in-process CRDT backend,
 * and a real mounted TipTap editor inside each leaf's real `<sh-editor-host>`
 * — the same harness `hoja-document-face.test.ts` already uses.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSophiaHomeDescriptor, deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { EditorRoomPool } from '../../../collab/editor-room-pool.js'
import { InProcessCrdtBackend } from '../../../harness/in-process-crdt-backend.js'
import type { EditorContentChange, ShEditorHost } from '../../../editor-host.js'
import {
  createHojaDocumentFace,
  createHojaDocumentResourceAdapter,
  hojaDocumentContentPort,
  HOJA_DOCUMENT_FACE_ID,
} from '../hoja-document-face.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from '../sophia-home-face.js'

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function documentLeaf(id: string, documentId: string, graphId = 'g1') {
  return {
    kind: 'leaf' as const,
    id,
    descriptor: {
      schemaVersion: 1 as const,
      faceId: HOJA_DOCUMENT_FACE_ID,
      resource: { kind: 'document' as const, graphId, documentId },
    },
    descriptorRevision: 0,
  }
}

function oneLeafDoc(documentId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'seele-workbench-probe',
    scope: 'session',
    graphId: null,
    rootNodeId: 'a',
    nodes: { a: documentLeaf('a', documentId) },
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  })
}

function twoLeafSameDocumentDoc(documentId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'seele-workbench-probe-split',
    scope: 'session',
    graphId: null,
    rootNodeId: 'split',
    nodes: {
      split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'a', endNodeId: 'b', startBasisPoints: 5000 },
      a: documentLeaf('a', documentId),
      b: documentLeaf('b', documentId),
    },
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  })
}

function sophiaHomeDoc(): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'home-only',
    scope: 'session',
    graphId: null,
    rootNodeId: 'a',
    nodes: {
      a: {
        kind: 'leaf',
        id: 'a',
        descriptor: createSophiaHomeDescriptor(),
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function buildInterpreter(pool: EditorRoomPool): LayoutInterpreter {
  const registry = new FaceRegistry()
  registry.register(createHojaDocumentFace())
  registry.register(createSophiaHomeFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
  broker.registerAdapter(createSophiaHomeResourceAdapter())
  return new LayoutInterpreter(root, { registry, broker })
}

/** The leaf's real `<sh-editor-host>`, once its real editor body is live. */
async function liveLeafHost(interpreter: LayoutInterpreter, leafId: string): Promise<ShEditorHost> {
  const host = interpreter.leafWrapperElement(leafId)!.querySelector('sh-editor-host') as ShEditorHost
  await waitFor(() => host.liveEditor != null)
  return host
}

/** The REAL command surface of the leaf's REAL editor (no mock). */
function commands(host: ShEditorHost): { insertContent(value: unknown): boolean } {
  return (host as unknown as { _editor: { commands: { insertContent(v: unknown): boolean } } })._editor.commands
}

const FENCE_TEXT = 'circle: 1\nnote: _underscores_ and [[brackets]]\n\ntrailing: true'

describe('hoja.document — W14.1 content port on the FaceView', () => {
  it('a controller reaches the port through LayoutInterpreter.mountedView(leafId)', async () => {
    const interpreter = buildInterpreter(new EditorRoomPool(new InProcessCrdtBackend()))
    await interpreter.reconcile(oneLeafDoc('doc-port'), { width: 800, height: 400 })

    const port = hojaDocumentContentPort(interpreter.mountedView('a'))
    expect(port).not.toBeNull()

    const host = await liveLeafHost(interpreter, 'a')
    commands(host).insertContent({
      type: 'codeBlock',
      attrs: { language: 'yaml' },
      content: [{ type: 'text', text: FENCE_TEXT }],
    })

    const json = port!.getJSON()
    expect(json).not.toBeNull()
    const fence = (json!.content ?? []).find((n) => n.type === 'codeBlock')
    expect(fence).toBeDefined()
    expect(fence!.content![0]!.text).toBe(FENCE_TEXT)
    expect(fence!.attrs!.language).toBe('yaml')

    await interpreter.dispose()
  })

  it('the port notifies on an edit made in that leaf', async () => {
    const interpreter = buildInterpreter(new EditorRoomPool(new InProcessCrdtBackend()))
    await interpreter.reconcile(oneLeafDoc('doc-notify'), { width: 800, height: 400 })
    const port = hojaDocumentContentPort(interpreter.mountedView('a'))!
    const host = await liveLeafHost(interpreter, 'a')

    const seen: EditorContentChange[] = []
    const unsubscribe = port.onChanged((c) => seen.push(c), { debounceMs: 10 })

    commands(host).insertContent('la constitución')
    await waitFor(() => seen.length > 0)
    expect(JSON.stringify(seen[0]!.json)).toContain('la constitución')
    expect(seen[0]!.json).toEqual(port.getJSON())

    unsubscribe()
    await interpreter.dispose()
  })

  it('two leaves on ONE document: an edit in either is seen through BOTH ports', async () => {
    const interpreter = buildInterpreter(new EditorRoomPool(new InProcessCrdtBackend()))
    await interpreter.reconcile(twoLeafSameDocumentDoc('doc-split'), { width: 1000, height: 400 })
    const portA = hojaDocumentContentPort(interpreter.mountedView('a'))!
    const portB = hojaDocumentContentPort(interpreter.mountedView('b'))!
    expect(portA).not.toBe(portB) // per-leaf, as the pane grain requires

    const hostA = await liveLeafHost(interpreter, 'a')
    await liveLeafHost(interpreter, 'b')

    const seenB: EditorContentChange[] = []
    const unsubscribe = portB.onChanged((c) => seenB.push(c), { debounceMs: 10 })

    commands(hostA).insertContent('una sola sustancia')
    await waitFor(() => seenB.length > 0)
    expect(JSON.stringify(portB.getJSON())).toContain('una sola sustancia')
    expect(portB.getJSON()).toEqual(portA.getJSON())

    unsubscribe()
    await interpreter.dispose()
  })

  it('disposing the leaf stops delivery — no controller keeps hearing from a closed pane', async () => {
    const interpreter = buildInterpreter(new EditorRoomPool(new InProcessCrdtBackend()))
    await interpreter.reconcile(oneLeafDoc('doc-dispose'), { width: 800, height: 400 })
    const port = hojaDocumentContentPort(interpreter.mountedView('a'))!
    const host = await liveLeafHost(interpreter, 'a')

    const seen: EditorContentChange[] = []
    port.onChanged((c) => seen.push(c), { debounceMs: 20 })

    commands(host).insertContent('efímero')
    await interpreter.dispose()
    await sleep(80)

    expect(seen).toHaveLength(0)
    // And a late subscribe on the disposed view is inert, not a throw.
    expect(typeof port.onChanged(() => {}, { debounceMs: 5 })).toBe('function')
    expect(port.getJSON()).toBeNull()
  })

  it('a non-hoja leaf has no content port (the narrowing is structural, not a cast)', async () => {
    const interpreter = buildInterpreter(new EditorRoomPool(new InProcessCrdtBackend()))
    await interpreter.reconcile(sophiaHomeDoc(), { width: 800, height: 400 })

    expect(interpreter.mountedView('a')).not.toBeNull()
    expect(hojaDocumentContentPort(interpreter.mountedView('a'))).toBeNull()
    expect(hojaDocumentContentPort(null)).toBeNull()
    expect(hojaDocumentContentPort(undefined)).toBeNull()

    await interpreter.dispose()
  })
})
