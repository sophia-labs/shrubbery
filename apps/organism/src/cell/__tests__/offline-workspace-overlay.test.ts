import { Store, type Term } from 'oxigraph'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import {
  createProvisionalSourceBundle,
  type SourceOperation,
  type SourceOutboxRecord,
} from '@shrubbery/source'
import {
  sidebarDocumentListSparql,
  sidebarFolderListSparql,
} from '../sidebar-documents.js'
import {
  applyOfflineWorkspaceOverlay,
  offlineWorkspaceOverlay,
} from '../offline-workspace-overlay.js'

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function outbox(
  operation: SourceOperation,
  createdAt: number,
  status: SourceOutboxRecord['status'] = 'pending',
): SourceOutboxRecord {
  return {
    key: `mirror\u001f${operation.operationId}`,
    mirrorKey: 'mirror',
    graphIncarnation: '11111111-1111-4111-8111-111111111111',
    operation,
    status,
    createdAt,
    updatedAt: createdAt,
    attempts: 0,
  }
}

function rows(store: Store, sparql: string): Array<Record<string, string>> {
  const result = store.query(sparql)
  if (!Array.isArray(result) || result.some(row => !(row instanceof Map))) {
    throw new Error('expected SPARQL solutions')
  }
  return (result as Array<Map<string, Term>>).map(solution =>
    Object.fromEntries([...solution].map(([variable, term]) => [variable, term.toString()])),
  )
}

describe('offline workspace source overlay', () => {
  it('cold-projects queued create, rename, folder, and wire commands over a mirrored Y.Doc', async () => {
    const ydoc = new Y.Doc()
    const documents = ydoc.getMap<Y.Map<unknown>>('documents')
    const existing = new Y.Map<unknown>()
    existing.set('title', 'Before')
    existing.set('section', 'documents')
    existing.set('order', 1)
    existing.set('readOnly', false)
    documents.set('doc-existing', existing)
    const bundle = await createProvisionalSourceBundle({
      graphId: 'graph-a',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      workspaceUpdateBase64: base64(Y.encodeStateAsUpdate(ydoc)),
      now: 1,
    })
    const records = [
      outbox({
        kind: 'crdtCommand',
        operationId: 'rename-1',
        commandKind: 'workspace.updateDocument',
        documentId: 'doc-existing',
        payload: { documentId: 'doc-existing', title: 'After' },
      }, 10),
      outbox({
        kind: 'documentLifecycle',
        operationId: 'create-1',
        action: 'create',
        documentId: 'doc-new',
        title: 'Offline new',
        newDocumentIncarnation: '22222222-2222-4222-8222-222222222222',
      }, 20),
      outbox({
        kind: 'crdtCommand',
        operationId: 'folder-1',
        commandKind: 'workspace.createFolder',
        payload: { folderId: 'folder-a', name: 'Offline folder' },
      }, 30),
      outbox({
        kind: 'crdtCommand',
        operationId: 'wire-1',
        commandKind: 'workspace.createWire',
        documentId: 'doc-existing',
        payload: {
          wireId: 'wire-a',
          sourceDocumentId: 'doc-existing',
          targetDocumentId: 'doc-new',
          predicate: 'supports',
        },
      }, 40),
    ]

    const overlay = offlineWorkspaceOverlay(bundle, records)
    expect(overlay.documents.get('doc-existing')?.title).toBe('After')
    expect(overlay.documents.get('doc-new')?.title).toBe('Offline new')
    expect(overlay.folders.get('folder-a')?.name).toBe('Offline folder')
    expect(overlay.wires.get('wire-a')?.targetDocumentId).toBe('doc-new')

    const store = new Store()
    applyOfflineWorkspaceOverlay(store, 'graph-a', overlay)
    const documentRows = rows(store, sidebarDocumentListSparql('graph-a'))
    expect(documentRows.map(row => row.label)).toEqual(['"After"', '"Offline new"'])
    expect(rows(store, sidebarFolderListSparql('graph-a'))[0]?.label).toBe('"Offline folder"')
  })

  it('retires optimistic operations once the pulled epoch witnesses their receipts', async () => {
    const ydoc = new Y.Doc()
    const bundle = await createProvisionalSourceBundle({
      graphId: 'graph-a',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      workspaceUpdateBase64: base64(Y.encodeStateAsUpdate(ydoc)),
    })
    const operation = {
      kind: 'documentLifecycle',
      operationId: 'create-witnessed',
      action: 'create',
      documentId: 'doc-new',
      title: 'No longer optimistic',
      newDocumentIncarnation: '22222222-2222-4222-8222-222222222222',
    }
    const witnessed = {
      ...bundle,
      receipts: [{
        operationId: operation.operationId,
        digest: 'd',
        acceptedRevision: 1,
        status: 'applied' as const,
        duplicate: false,
        outcome: {},
      }],
    }
    expect(offlineWorkspaceOverlay(witnessed, [outbox(operation, 1, 'applied')]).documents.size).toBe(0)
  })
})
