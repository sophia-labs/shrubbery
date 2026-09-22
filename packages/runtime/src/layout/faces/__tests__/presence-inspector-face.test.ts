/**
 * presence-inspector-face.test.ts — the FAST, network-free proof: a real
 * `EditorRoomPool` over a real in-process Y.Doc-backed CRDT backend (real
 * `y-protocols/awareness`, no `vi.mock`), a real `FaceRegistry`/
 * `LayoutResourceBroker`/`LayoutInterpreter`. `<mn-presence-inspector>` is
 * not registered in this package (`@shrubbery/runtime` cannot depend on
 * `@shrubbery/components` — this file's own header) so these tests drive
 * the mounted element's REAL property surface directly and dispatch the
 * SAME event names/detail shapes the real component fires — proving the
 * FACE's controller wiring, resource sharing across `hoja.document`, and
 * the REAL `projectPresence`/`updateLocalPresenceProfile` round trip against
 * a real Awareness. The real component's own rendering is proven by
 * `mn-presence-inspector.test.ts` (component suite) and the Chromium browser
 * script (mirrors doc-history-face.test.ts's own established boundary).
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
  createPresenceInspectorFace,
  createPresenceInspectorResourceAdapter,
  PRESENCE_INSPECTOR_FACE_ID,
} from '../presence-inspector-face.js'
import type { PresencePerson, PresenceSession } from '../../../presence-projection.js'

function documentLeaf(
  id: string,
  faceId: string,
  documentId: string,
  params?: Readonly<Record<string, unknown>>,
  graphId = 'g1',
) {
  return {
    kind: 'leaf' as const,
    id,
    descriptor: {
      schemaVersion: 1 as const,
      faceId,
      resource: { kind: 'document' as const, graphId, documentId },
      ...(params ? { params } : {}),
    },
    descriptorRevision: 0,
  }
}

function presenceBesideEditorDoc(documentId: string, personId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'presence-beside-editor',
    scope: 'session',
    graphId: null,
    rootNodeId: 'split',
    nodes: {
      split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'editor', endNodeId: 'presence', startBasisPoints: 5000 },
      editor: documentLeaf('editor', HOJA_DOCUMENT_FACE_ID, documentId),
      presence: documentLeaf('presence', PRESENCE_INSPECTOR_FACE_ID, documentId, { personId }),
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
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

describe('presence.inspector — resource adapter', () => {
  it('accepts only document locators; resourceKey mirrors hoja.document\'s tuple shape', () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const adapter = createPresenceInspectorResourceAdapter(pool)
    expect(adapter.shape).toBe('durable')
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(true)
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'q' })).toBe(false)
  })

  it('load()/dispose() share the SAME real ProviderHandle/awareness as hoja.document, under a separately namespaced pool attachment', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const hojaAdapter = createHojaDocumentResourceAdapter(pool)
    const presenceAdapter = createPresenceInspectorResourceAdapter(pool)
    const locator = { kind: 'document' as const, graphId: 'g1', documentId: 'doc-a' }

    const hojaLease = await hojaAdapter.load(locator)
    const presenceLease = await presenceAdapter.load(locator)
    expect(hojaLease.attachmentId).not.toBe(presenceLease.roomLease.attachmentId)
    expect(hojaLease.provider.awareness).toBe(presenceLease.roomLease.provider.awareness)
    expect(pool.snapshot().roomCount).toBe(1)
    expect(pool.snapshot().rooms[0]!.refCount).toBe(2)

    hojaAdapter.dispose(hojaLease, 'hoja-key')
    expect(pool.snapshot().rooms[0]!.refCount).toBe(1)
    presenceAdapter.dispose(presenceLease, 'presence-key')
    expect(pool.snapshot().roomCount).toBe(0)
  })
})

describe('presence.inspector — mounted beside hoja.document over the SAME document, against real awareness', () => {
  function buildVehicle(pool: EditorRoomPool) {
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    registry.register(createPresenceInspectorFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createPresenceInspectorResourceAdapter(pool))
    return new LayoutInterpreter(root, { registry, broker })
  }

  function panelOf(interpreter: LayoutInterpreter) {
    return interpreter.leafWrapperElement('presence')!.querySelector('mn-presence-inspector') as HTMLElement & {
      person: PresencePerson | null
      followedPresenceClientId: string | null
      selfPresenceEditable: boolean
      showClose: boolean
    }
  }

  it('mounts the real element by tag; the local user is projected as isSelf from the SAME real awareness hoja.document uses', async () => {
    const backend = new InProcessCrdtBackend({ userId: 'vera', presenceColor: '#2563eb' })
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    // InProcessCrdtBackend sets a legacy-shape local state (`user: {name, color}`,
    // no `presence` metadata) — projectPresence's own real "legacy" branch
    // resolves its `id` to the raw awareness clientID. Discover that ID via
    // the editor leaf's own shared provider before minting the presence
    // leaf's personId param (a real caller would read it off a prior
    // projectPresence() call the same way).
    const provider = backend.open({ kind: 'doc', graphId: 'g1', docId: 'doc-a' })
    const legacyId = String((provider.awareness as { clientID: number }).clientID)
    provider.destroy()

    const result = await interpreter.reconcile(presenceBesideEditorDoc('doc-a', legacyId), { width: 1200, height: 600 })
    expect(result.ok).toBe(true)

    const panel = panelOf(interpreter)
    expect(panel).not.toBeNull()
    expect(panel.person).not.toBeNull()
    expect(panel.person!.id).toBe(legacyId)
    expect(panel.person!.isSelf).toBe(true)
    expect(panel.showClose).toBe(false)

    await interpreter.dispose()
  })

  it('shows an honest "not found" (null person) when personId does not match anyone present', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    await interpreter.reconcile(presenceBesideEditorDoc('doc-b', 'nobody-here'), { width: 1200, height: 600 })
    const panel = panelOf(interpreter)
    expect(panel.person).toBeNull()
    await interpreter.dispose()
  })

  it('re-projects on a REAL awareness change event (no polling, no second aggregation path)', async () => {
    const backend = new InProcessCrdtBackend({ userId: 'vera' })
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    // Acquire through the SAME pool (a second attachment on the SAME cached
    // room) to reach the EXACT ProviderHandle/Awareness object the mounted
    // face's own lease shares — `backend.open()` directly would mint a
    // DIFFERENT (unsynced) Awareness instance bound to the same Y.Doc.
    const observer = pool.acquire({ kind: 'doc', graphId: 'g1', docId: 'doc-c' }, 'test-observer-c')
    const localId = String((observer.provider.awareness as { clientID: number }).clientID)

    await interpreter.reconcile(presenceBesideEditorDoc('doc-c', localId), { width: 1200, height: 600 })
    const panel = panelOf(interpreter)
    expect(panel.person!.name).toBe('vera')

    // A real awareness mutation on the SAME shared provider — not a second,
    // simulated update path.
    ;(observer.provider.awareness as { setLocalStateField(field: string, value: unknown): void })
      .setLocalStateField('user', { name: 'vera-renamed', color: '#2563eb' })

    expect(panel.person!.name).toBe('vera-renamed')
    observer.release()
    await interpreter.dispose()
  })

  it('follow toggles LOCAL highlight state only (no cross-shell reveal) via a real dispatched follow event', async () => {
    const backend = new InProcessCrdtBackend({ userId: 'agent-op' })
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    const provider = backend.open({ kind: 'doc', graphId: 'g1', docId: 'doc-d' })
    const localId = String((provider.awareness as { clientID: number }).clientID)
    provider.destroy()

    await interpreter.reconcile(presenceBesideEditorDoc('doc-d', localId), { width: 1200, height: 600 })
    const panel = panelOf(interpreter)
    expect(panel.followedPresenceClientId).toBeNull()

    const session: PresenceSession = { awarenessClientId: localId, clientId: 'tab-x', deviceId: null, connectionEpoch: 0, hasCursor: true, isLocal: true }
    panel.dispatchEvent(new CustomEvent('mn-presence-follow', { bubbles: true, detail: { person: panel.person, session, following: true } }))
    expect(panel.followedPresenceClientId).toBe('tab-x')

    panel.dispatchEvent(new CustomEvent('mn-presence-follow', { bubbles: true, detail: { person: panel.person, session, following: false } }))
    expect(panel.followedPresenceClientId).toBeNull()

    await interpreter.dispose()
  })

  it('self-update writes through the REAL awareness (updateLocalPresenceProfile), which the change-listener then re-projects', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    // Acquire through the SAME pool (see the previous test's own comment) to
    // reach the EXACT Awareness object the mounted face's lease shares.
    const observer = pool.acquire({ kind: 'doc', graphId: 'g1', docId: 'doc-e' }, 'test-observer-e')
    const localId = String((observer.provider.awareness as { clientID: number }).clientID)
    // Give the local state the RICH shape self-update requires (`user.userId`
    // + a valid current color) — InProcessCrdtBackend's own default state has
    // neither, matching the real `updateLocalPresenceProfile`'s own "missing
    // fields -> refuse" guard proven in presence-projection.test.ts.
    ;(observer.provider.awareness as { setLocalState(state: Record<string, unknown>): void }).setLocalState({
      user: { name: 'Vera', color: '#2563eb', type: 'human', userId: 'vera' },
    })

    await interpreter.reconcile(presenceBesideEditorDoc('doc-e', localId), { width: 1200, height: 600 })
    const panel = panelOf(interpreter)
    expect(panel.person!.name).toBe('Vera')
    expect(panel.selfPresenceEditable).toBe(true)

    panel.dispatchEvent(new CustomEvent('mn-presence-self-update', { bubbles: true, detail: { person: panel.person, name: 'Vera Prime' } }))
    expect(panel.person!.name).toBe('Vera Prime')

    observer.release()
    await interpreter.dispose()
  })

  it('closing the presence leaf disposes its own pool attachment but leaves the editor leaf\'s room alive', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const interpreter = buildVehicle(pool)
    const doc0 = presenceBesideEditorDoc('doc-f', 'whoever')
    await interpreter.reconcile(doc0, { width: 1200, height: 600 })
    expect(pool.snapshot().rooms[0]!.refCount).toBe(2)

    const { applyOperation, locateParent } = await import('@shrubbery/nucleus/layout')
    const closePresence = applyOperation(doc0, { op: 'close_leaf', leafId: 'presence', expectedParent: locateParent(doc0, 'presence')! }, {
      isFaceRegistered: () => true,
    })
    if (!closePresence.ok) throw new Error(`close_leaf failed: ${closePresence.diagnostic.code}`)
    await interpreter.reconcile(closePresence.doc, { width: 1200, height: 600 })

    expect(pool.snapshot().roomCount).toBe(1)
    expect(pool.snapshot().rooms[0]!.refCount).toBe(1)

    await interpreter.dispose()
    expect(pool.snapshot().roomCount).toBe(0)
  })
})
