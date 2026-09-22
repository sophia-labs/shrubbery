/**
 * doc-history-face.test.ts — the FAST, network-free proof: a real
 * `EditorRoomPool` over a real in-process Y.Doc-backed CRDT backend (no
 * `vi.mock`), a real `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter`,
 * and a real in-memory `DocumentSnapshotService` implementation (no network —
 * the real-network proof against a real gardend cell is
 * `apps/organism/scripts/layout-workbench-gardend-browser.mts`'s doc-history
 * section). `<mn-doc-history-panel>` is not registered in this package
 * (`@shrubbery/runtime` cannot depend on `@shrubbery/components` — this
 * file's own `doc-history-face.ts` header) so these tests drive the mounted
 * element's REAL property/event contract directly via `dispatchEvent` with
 * the SAME event names/detail shapes the real component fires — proving the
 * FACE's controller wiring, resource sharing, and live-text/restore plumbing.
 * The real component's own rendering is proven by the Chromium browser
 * script, not here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { EditorRoomPool } from '../../../collab/editor-room-pool.js'
import { InProcessCrdtBackend } from '../../../harness/in-process-crdt-backend.js'
import { createHojaDocumentFace, createHojaDocumentResourceAdapter, HOJA_DOCUMENT_FACE_ID } from '../hoja-document-face.js'
import {
  createDocHistoryFace,
  createDocHistoryResourceAdapter,
  DOC_HISTORY_FACE_ID,
  DOC_HISTORY_RESOURCE_ADAPTER_ID,
} from '../doc-history-face.js'
import type { DocumentSnapshotService } from '../../../editor-services/document-snapshot-service.js'
import type { DocHistoryCursorDetail, DocHistorySnapshot } from '../../../render-workspace.js'

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** A real, always-resolving confirm — `confirmDialog` is now REQUIRED (wave1 review r1 WRONG fix); used by every test that isn't itself exercising the confirm gate. */
async function alwaysConfirm(): Promise<boolean> {
  return true
}

/** A REAL, working, in-memory `DocumentSnapshotService` — not a mock of the interface, a genuine implementation of it (no network backing it, exactly like `InProcessCrdtBackend` is a genuine CrdtBackend with no network hop). */
function inMemorySnapshotService(): DocumentSnapshotService & { seed: readonly DocHistorySnapshot[] } {
  const store = new Map<string, { snapshot: DocHistorySnapshot; text: string; html: string }>()
  let seq = 0
  const service = {
    seed: [] as readonly DocHistorySnapshot[],
    async list(graphId: string, documentId: string) {
      const snapshots = Array.from(store.values())
        .filter((e) => e.snapshot.graphId === graphId && e.snapshot.documentId === documentId)
        .map((e) => e.snapshot)
      return { snapshots, totalCount: snapshots.length }
    },
    async readText(_graphId: string, _documentId: string, snapshotId: string) {
      const entry = store.get(snapshotId)
      if (!entry) throw new Error(`no such snapshot: ${snapshotId}`)
      return entry.text
    },
    async readHtml(_graphId: string, _documentId: string, snapshotId: string) {
      const entry = store.get(snapshotId)
      if (!entry) throw new Error(`no such snapshot: ${snapshotId}`)
      return entry.html
    },
    async save(graphId: string, documentId: string) {
      const id = `snap-${++seq}`
      store.set(id, {
        snapshot: { id, graphId, documentId, label: null, createdAt: new Date().toISOString(), tier: 'manual', isManual: true },
        text: `saved-text-${id}`,
        html: `<p>saved-html-${id}</p>`,
      })
      return id
    },
    async bookmark() {},
    async remove(_graphId: string, _documentId: string, snapshotId: string) {
      store.delete(snapshotId)
    },
  }
  return service
}

function documentLeaf(id: string, faceId: string, documentId: string, graphId = 'g1') {
  return {
    kind: 'leaf' as const,
    id,
    descriptor: { schemaVersion: 1 as const, faceId, resource: { kind: 'document' as const, graphId, documentId } },
    descriptorRevision: 0,
  }
}

function docHistoryBesideEditorDoc(documentId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'doc-history-beside-editor',
    scope: 'session',
    graphId: null,
    rootNodeId: 'split',
    nodes: {
      split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'editor', endNodeId: 'history', startBasisPoints: 5000 },
      editor: documentLeaf('editor', HOJA_DOCUMENT_FACE_ID, documentId),
      history: documentLeaf('history', DOC_HISTORY_FACE_ID, documentId),
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
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

describe('doc.history — resource adapter', () => {
  it('accepts only document locators; resourceKey mirrors hoja.document\'s tuple shape', () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const adapter = createDocHistoryResourceAdapter(pool, inMemorySnapshotService())
    expect(adapter.shape).toBe('durable')
    expect(adapter.adapterId).toBe(DOC_HISTORY_RESOURCE_ADAPTER_ID)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(true)
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'q' })).toBe(false)
    expect(adapter.resourceKey({ kind: 'document', graphId: 'g1', documentId: 'doc-a' })).toBe(
      JSON.stringify(['document', 'g1', 'doc-a']),
    )
  })

  it('load()/dispose() acquire and release a REAL EditorRoomPool attachment, namespaced separately from hoja.document\'s own adapter', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const hojaAdapter = createHojaDocumentResourceAdapter(pool)
    const historyAdapter = createDocHistoryResourceAdapter(pool, inMemorySnapshotService())
    const locator = { kind: 'document' as const, graphId: 'g1', documentId: 'doc-a' }

    const hojaLease = await hojaAdapter.load(locator)
    const historyLease = await historyAdapter.load(locator)
    // Two DIFFERENT pool attachments (different attachment ids)...
    expect(hojaLease.attachmentId).not.toBe(historyLease.roomLease.attachmentId)
    // ...but the SAME real room/provider underneath (one Y.Doc per document key).
    expect(hojaLease.provider.doc).toBe(historyLease.roomLease.provider.doc)
    expect(pool.snapshot().roomCount).toBe(1)
    expect(pool.snapshot().rooms[0]!.refCount).toBe(2)

    hojaAdapter.dispose(hojaLease, 'hoja-key')
    expect(pool.snapshot().rooms[0]!.refCount).toBe(1) // history's own attachment keeps the room alive
    historyAdapter.dispose(historyLease, 'history-key')
    expect(pool.snapshot().roomCount).toBe(0)
  })
})

describe('doc.history — mounted beside hoja.document over the SAME document (the wave\'s own proof shape, at the in-process layer)', () => {
  function buildVehicle(
    pool: EditorRoomPool,
    snapshots: DocumentSnapshotService,
    confirmDialog: (options: import('../doc-history-face.js').DocHistoryConfirmOptions) => Promise<boolean> = alwaysConfirm,
  ) {
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    registry.register(createDocHistoryFace(confirmDialog))
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createDocHistoryResourceAdapter(pool, snapshots))
    return new LayoutInterpreter(root, { registry, broker })
  }

  it('both leaves mount simultaneously; doc.history\'s hidden companion host shares the editor\'s exact provider', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildVehicle(pool, inMemorySnapshotService())
    const result = await interpreter.reconcile(docHistoryBesideEditorDoc('doc-a'), { width: 1200, height: 600 })
    expect(result.ok).toBe(true)

    const editorWrapper = interpreter.leafWrapperElement('editor')!
    const historyWrapper = interpreter.leafWrapperElement('history')!
    const editorHost = editorWrapper.querySelector('sh-editor-host') as HTMLElement & { binding: { get(): { provider: unknown } } }
    // doc.history's leaf mounts a <mn-doc-history-panel> (real tag) PLUS its own hidden <sh-editor-host>.
    const panel = historyWrapper.querySelector('mn-doc-history-panel')
    const hiddenHosts = historyWrapper.querySelectorAll('sh-editor-host')
    expect(panel).not.toBeNull()
    expect(hiddenHosts).toHaveLength(1)
    const hiddenHost = hiddenHosts[0] as HTMLElement & { binding: { get(): { provider: unknown } } }
    expect(hiddenHost.binding.get().provider).toBe(editorHost.binding.get().provider)

    await interpreter.dispose()
  })

  // Real ProseMirror content transactions (typing, `restoreHtml`) schedule a
  // deferred `@tiptap/y-tiptap` awareness/cursor-meta update
  // (`Timeout.updateMetas`) that reads `ShadowRoot.activeElement` when it
  // fires — happy-dom's implementation of that getter throws once the host
  // has since been disconnected (`interpreter.dispose()`/`root.remove()`).
  // `hoja-document-face.test.ts` itself never drives a real transaction for
  // exactly this reason, deferring all real typing/restore proofs to real
  // Chromium (`apps/organism/scripts/layout-workbench-gardend-browser.mts`,
  // this wave's own doc-history section) — this suite follows the same,
  // already-established boundary. What IS proven here at the fast in-process
  // layer, with no content mutation: doc.history's hidden host reads the
  // live document's CURRENT text (initially empty, a real read of the real
  // shared Y.Doc, not a stub), and a real save/list/cursor-select round trip
  // against the real (in-memory) `DocumentSnapshotService`.
  it('doc.history\'s hidden host reads the live document\'s real (initially empty) text — no parallel text extraction', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildVehicle(pool, inMemorySnapshotService())
    await interpreter.reconcile(docHistoryBesideEditorDoc('doc-b'), { width: 1200, height: 600 })

    const editorHost = interpreter.leafWrapperElement('editor')!.querySelector('sh-editor-host') as HTMLElement & { liveEditor?: { getText(): string } | null }
    const hiddenHost = interpreter.leafWrapperElement('history')!.querySelector('sh-editor-host') as HTMLElement & { liveEditor?: { getText(): string } | null }
    await waitFor(() => editorHost.liveEditor != null && hiddenHost.liveEditor != null)
    // Same shared Y.Doc, same (empty) real text on both sides — read through
    // the SAME `LiveEditorHandle.getText()` mechanism hoja.document itself uses.
    expect(hiddenHost.liveEditor!.getText()).toBe(editorHost.liveEditor!.getText())

    await interpreter.dispose()
  })

  it('save/list/cursor-select round-trip through the real (in-memory) DocumentSnapshotService, driven by real dispatched panel events', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const snapshots = inMemorySnapshotService()
    const interpreter = buildVehicle(pool, snapshots)
    await interpreter.reconcile(docHistoryBesideEditorDoc('doc-c'), { width: 1200, height: 600 })

    const panel = interpreter.leafWrapperElement('history')!.querySelector('mn-doc-history-panel') as HTMLElement & {
      snapshots: readonly DocHistorySnapshot[]
      status: string
    }
    await waitFor(() => panel.status === 'ready')
    expect(panel.snapshots).toHaveLength(0)

    panel.dispatchEvent(new CustomEvent('mn-doc-history-save-current', { bubbles: true }))
    await waitFor(() => panel.snapshots.length === 1)
    const savedId = panel.snapshots[0]!.id

    // Select the saved snapshot as "older" — a real cursor-change event, the
    // real event name/detail shape `mn-doc-history-panel` fires.
    panel.dispatchEvent(new CustomEvent<DocHistoryCursorDetail>('mn-doc-history-cursor-change', {
      bubbles: true,
      detail: { olderId: savedId, newerId: 'live', focusedSide: 'older' },
    }))
    await waitFor(() => (panel as unknown as { diffStatus: string }).diffStatus === 'ready')
    expect((panel as unknown as { olderText: string }).olderText).toBe(`saved-text-${savedId}`)

    // Delete it back out — another real round trip through the same service.
    panel.dispatchEvent(new CustomEvent('mn-doc-history-delete', { bubbles: true, detail: { snapshotId: savedId } }))
    await waitFor(() => panel.snapshots.length === 0)

    await interpreter.dispose()
  })

  it('mn-doc-history-delete is gated behind a REQUIRED confirm — declining it leaves the snapshot untouched (wave1 review r1 WRONG fix)', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const snapshots = inMemorySnapshotService()
    let confirmCalls = 0
    let lastConfirmOptions: import('../doc-history-face.js').DocHistoryConfirmOptions | null = null
    const interpreter = buildVehicle(pool, snapshots, async (options) => {
      confirmCalls += 1
      lastConfirmOptions = options
      return false
    })
    await interpreter.reconcile(docHistoryBesideEditorDoc('doc-delete-confirm'), { width: 1200, height: 600 })
    const panel = interpreter.leafWrapperElement('history')!.querySelector('mn-doc-history-panel') as HTMLElement & { snapshots: readonly DocHistorySnapshot[]; status: string }
    await waitFor(() => panel.status === 'ready')
    panel.dispatchEvent(new CustomEvent('mn-doc-history-save-current', { bubbles: true }))
    await waitFor(() => panel.snapshots.length === 1)
    const savedId = panel.snapshots[0]!.id

    panel.dispatchEvent(new CustomEvent('mn-doc-history-delete', { bubbles: true, detail: { snapshotId: savedId } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(1)
    expect(lastConfirmOptions).toMatchObject({ variant: 'danger', confirmLabel: 'Delete' })
    // Declined — the real service still has the snapshot (no REST call was made).
    expect(await snapshots.list('g1', 'doc-delete-confirm')).toMatchObject({ snapshots: [{ id: savedId }] })
    expect(panel.snapshots).toHaveLength(1)

    await interpreter.dispose()
  })

  it('mn-doc-history-restore is gated behind a REQUIRED confirm — declining it never touches the live document (wave1 review r1 WRONG fix)', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const snapshots = inMemorySnapshotService()
    let confirmCalls = 0
    let lastConfirmOptions: import('../doc-history-face.js').DocHistoryConfirmOptions | null = null
    const interpreter = buildVehicle(pool, snapshots, async (options) => {
      confirmCalls += 1
      lastConfirmOptions = options
      return false
    })
    await interpreter.reconcile(docHistoryBesideEditorDoc('doc-restore-confirm'), { width: 1200, height: 600 })
    const panel = interpreter.leafWrapperElement('history')!.querySelector('mn-doc-history-panel') as HTMLElement & {
      snapshots: readonly DocHistorySnapshot[]
      status: string
    }
    const editorHost = interpreter.leafWrapperElement('editor')!.querySelector('sh-editor-host') as HTMLElement & { liveEditor?: { getText(): string } | null }
    await waitFor(() => panel.status === 'ready' && editorHost.liveEditor != null)
    panel.dispatchEvent(new CustomEvent('mn-doc-history-save-current', { bubbles: true }))
    await waitFor(() => panel.snapshots.length === 1)
    const savedId = panel.snapshots[0]!.id
    const textBeforeDeclinedRestore = editorHost.liveEditor!.getText()

    panel.dispatchEvent(new CustomEvent('mn-doc-history-restore', { bubbles: true, detail: { snapshotId: savedId } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(1)
    expect(lastConfirmOptions).toMatchObject({ variant: 'warning', confirmLabel: 'Restore' })
    // Declined — the real snapshot's HTML (`saved-html-{id}`) was never
    // handed to `restoreHtml`, so the live document's real text is unchanged.
    expect(editorHost.liveEditor!.getText()).toBe(textBeforeDeclinedRestore)
    expect(editorHost.liveEditor!.getText()).not.toContain('saved-html')

    await interpreter.dispose()
  })

  it('closing doc.history\'s leaf disposes its own pool attachment but leaves the editor leaf\'s room alive', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    registry.register(createDocHistoryFace(alwaysConfirm))
    const { createSophiaHomeFace, createSophiaHomeResourceAdapter } = await import('../sophia-home-face.js')
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createDocHistoryResourceAdapter(pool, inMemorySnapshotService()))
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const { applyOperation, locateParent } = await import('@shrubbery/nucleus/layout')
    const doc0 = docHistoryBesideEditorDoc('doc-d')
    await interpreter.reconcile(doc0, { width: 1200, height: 600 })
    expect(pool.snapshot().rooms[0]!.refCount).toBe(2)

    const closeHistory = applyOperation(doc0, { op: 'close_leaf', leafId: 'history', expectedParent: locateParent(doc0, 'history')! }, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
    })
    if (!closeHistory.ok) throw new Error(`close_leaf failed: ${closeHistory.diagnostic.code}`)
    await interpreter.reconcile(closeHistory.doc, { width: 1200, height: 600 })

    expect(pool.snapshot().roomCount).toBe(1) // editor leaf still holds the room
    expect(pool.snapshot().rooms[0]!.refCount).toBe(1)

    await interpreter.dispose()
    expect(pool.snapshot().roomCount).toBe(0)
  })
})
