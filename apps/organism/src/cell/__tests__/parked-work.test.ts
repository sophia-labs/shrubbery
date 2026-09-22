/**
 * parked-work.test.ts — the join between Document Activation's recovery
 * store and the source mirror's undeliverable outbox rows, plus export (MO
 * object-face integration spec, master §3 Slice 8, WS3 §4.4-4.6, §6.4-6.5,
 * §10.1). Fast, no-mocks unit coverage over PURE functions; the real-cell/
 * real-browser proof is `graph-fence-parked-browser.mts` (gate G12).
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { SourceMirrorState, SourceOperation, SourceOutboxRecord } from '@shrubbery/source'
import type { DocumentRecoveryRecord } from '../document-activation.js'
import {
  PARKED_REASON_LABEL,
  exportParkedWork,
  loadParkedWork,
  parkedDocumentsCountFor,
  parkedExportFilename,
  parkedRecoveryKeyOf,
  parkedSidebarSection,
  representabilityOf,
  type ParkedWorkModel,
} from '../parked-work.js'

function updateWithText(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, text)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

function recovery(overrides: Partial<DocumentRecoveryRecord> & { documentId: string }): DocumentRecoveryRecord {
  return {
    userId: 'user-a',
    graphId: 'graph-a',
    key: `recovery:${overrides.documentId}`,
    documentKey: `doc-key:${overrides.documentId}`,
    schemaVersion: 1,
    update: updateWithText(`parked text for ${overrides.documentId}`),
    recoveredAt: 100,
    reason: 'deleted',
    incarnation: 'doc-incarnation-a',
    ...overrides,
  }
}

function outbox(operation: SourceOperation, overrides: Partial<SourceOutboxRecord> = {}): SourceOutboxRecord {
  return {
    key: `outbox:${operation.operationId}`,
    mirrorKey: 'mirror-1',
    graphIncarnation: 'graph-incarnation-a',
    operation,
    status: 'rejected-stale',
    createdAt: 10,
    updatedAt: 10,
    attempts: 1,
    errorCode: 'stale_graph_incarnation',
    error: 'stale graph incarnation for graph-a',
    ...overrides,
  }
}

function mirrorState(overrides: Partial<SourceMirrorState> = {}): SourceMirrorState {
  return {
    phase: 'conflict',
    complete: true,
    epoch: 'epoch-2',
    graphIncarnation: 'graph-incarnation-b12345',
    pending: 0,
    parked: 1,
    nonDocumentParked: 1,
    rejectedPermanent: 0,
    supersededResolutions: 0,
    resolving: [],
    awaitingEpoch: [],
    contestedObjects: 0,
    repairNeeded: false,
    fenced: true,
    fenceTestimony: 'stale graph incarnation: expected a, actual b',
    error: null,
    errorCode: 'stale_graph_incarnation',
    ...overrides,
  }
}

describe('loadParkedWork — the join (WS3 §4.5)', () => {
  it('joins a document to the outbox rows its relatedOperationIds names, and orders documents newest-recoveredAt-first', async () => {
    const older = recovery({
      documentId: 'doc-a',
      recoveredAt: 100,
      relatedOperationIds: ['op-a1'],
    })
    const newer = recovery({
      documentId: 'doc-b',
      recoveredAt: 200,
      reason: 'replaced',
      relatedOperationIds: ['op-b1', 'op-b2'],
    })
    const opA1 = outbox({ kind: 'documentUpdate', operationId: 'op-a1', documentId: 'doc-a', documentIncarnation: 'x' })
    const opB1 = outbox({ kind: 'documentUpdate', operationId: 'op-b1', documentId: 'doc-b', documentIncarnation: 'x' }, { createdAt: 20 })
    const opB2 = outbox({ kind: 'documentUpdate', operationId: 'op-b2', documentId: 'doc-b', documentIncarnation: 'x' }, { createdAt: 10 })

    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [older, newer],
      operations: () => [opA1, opB1, opB2],
      mirror: mirrorState(),
    })

    expect(model.documents.map(row => row.documentId)).toEqual(['doc-b', 'doc-a'])
    expect(model.documents[0]).toMatchObject({
      documentId: 'doc-b',
      canReapply: true,
      joinUnavailable: false,
    })
    // Operations resolve oldest-createdAt-first (delivery order).
    expect(model.documents[0]!.operations.map(op => op.operationId)).toEqual(['op-b2', 'op-b1'])
    expect(model.documents[1]).toMatchObject({ documentId: 'doc-a', canReapply: false })
    expect(model.looseOperations).toHaveLength(0)
    expect(model.totalOperations).toBe(3)
  })

  it('an operation not named by any relatedOperationIds is a LOOSE operation (D3)', async () => {
    const rec = recovery({ documentId: 'doc-a', relatedOperationIds: [] })
    const loose = outbox({ kind: 'workspaceUpdate', operationId: 'op-loose', updateBase64: 'AA==' })

    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [rec],
      operations: () => [loose],
      mirror: mirrorState(),
    })

    expect(model.looseOperations.map(op => op.operationId)).toEqual(['op-loose'])
    expect(model.looseOperations[0]!.namesDocumentId).toBeNull()
  })

  it('R23-adjacent (C-D19): a valuation row is a LOOSE operation that still names a document, via namesDocumentId', async () => {
    const valuation = outbox({
      kind: 'valuation',
      operationId: 'op-val',
      valuationEventId: 'val-1',
      documentId: 'doc-a',
      blockId: 'block-1',
      atMs: 5,
    })

    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [],
      operations: () => [valuation],
      mirror: mirrorState(),
    })

    expect(model.looseOperations).toHaveLength(1)
    expect(model.looseOperations[0]).toMatchObject({ operationId: 'op-val', namesDocumentId: 'doc-a' })
  })

  it('joinUnavailable is true EXACTLY for records with no relatedOperationIds field — never for a field that resolved to genuinely zero', async () => {
    const predatesField = recovery({ documentId: 'doc-old', relatedOperationIds: undefined })
    const resolvedEmpty = recovery({ documentId: 'doc-new', relatedOperationIds: [] })

    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [predatesField, resolvedEmpty],
      operations: () => [],
      mirror: mirrorState(),
    })

    const byId = new Map(model.documents.map(row => [row.documentId, row]))
    expect(byId.get('doc-old')).toMatchObject({ joinUnavailable: true })
    expect(byId.get('doc-new')).toMatchObject({ joinUnavailable: false })
  })

  it('filters recoveries to the requested graph and reads fenced/fenceTestimony/previousLife from the mirror', async () => {
    const mine = recovery({ documentId: 'doc-a', graphId: 'graph-a' })
    const otherGraph = recovery({ documentId: 'doc-b', graphId: 'graph-other' })

    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [mine, otherGraph],
      operations: () => [],
      mirror: mirrorState({ fenced: true, fenceTestimony: 'stale graph incarnation', graphIncarnation: '01234567-full' }),
    })

    expect(model.documents.map(row => row.documentId)).toEqual(['doc-a'])
    expect(model.fenced).toBe(true)
    expect(model.fenceTestimony).toBe('stale graph incarnation')
    expect(model.previousLife).toBe('01234567')
  })

  it('titleFor/documentExists are consulted per document; absent defaults to the documentId / conservatively false', async () => {
    const rec = recovery({ documentId: 'doc-a' })
    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [rec],
      operations: () => [],
      mirror: mirrorState(),
      titleFor: documentId => (documentId === 'doc-a' ? 'A Real Title' : null),
    })
    expect(model.documents[0]!.title).toBe('A Real Title')

    const untitled = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [rec],
      operations: () => [],
      mirror: mirrorState(),
    })
    expect(untitled.documents[0]!.title).toBe('doc-a')
  })
})

describe('parkedDocumentsCountFor — the lifetime banner\'s real count (build bundle review finding 5)', () => {
  it('reports the real document count from a real ParkedWorkModel — not the old hardcoded 0', async () => {
    const first = recovery({ documentId: 'doc-a', recoveredAt: 100 })
    const second = recovery({ documentId: 'doc-b', recoveredAt: 200 })
    const model = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-a',
      graphTitle: 'My Graph',
      recoveries: async () => [first, second],
      operations: () => [],
      mirror: mirrorState({ fenced: true }),
    })
    expect(model.documents).toHaveLength(2)
    expect(parkedDocumentsCountFor(model, 'graph-a')).toBe(2)
  })

  it('reports 0 when the model has not loaded yet (null) — never a guess', () => {
    expect(parkedDocumentsCountFor(null, 'graph-a')).toBe(0)
  })

  it('reports 0 for a stale model left over from a DIFFERENT graph — never the wrong graph\'s count', async () => {
    const rec = recovery({ documentId: 'doc-a', graphId: 'graph-old' })
    const staleModel = await loadParkedWork({
      userId: 'user-a',
      graphId: 'graph-old',
      graphTitle: 'Old Graph',
      recoveries: async () => [rec],
      operations: () => [],
      mirror: mirrorState(),
    })
    expect(parkedDocumentsCountFor(staleModel, 'graph-a')).toBe(0)
  })
})

describe('representabilityOf — WS3 §7.5\'s taxonomy', () => {
  const exists = (id: string): boolean => id === 'present-doc'

  it('the six always-representable kinds', () => {
    for (const kind of ['workspaceUpdate', 'graphMetadata', 'eventLog', 'memory', 'valuation', 'retraction']) {
      expect(representabilityOf({ kind, operationId: 'x' }, exists)).toEqual({ kind: 'representable' })
    }
  })

  it('documentUpdate re-stamps documentIncarnation', () => {
    expect(representabilityOf({ kind: 'documentUpdate', operationId: 'x', documentId: 'd' }, exists))
      .toEqual({ kind: 're-stamped', field: 'documentIncarnation' })
  })

  it('documentLifecycle create: re-stamped when absent, already-satisfied when it exists', () => {
    expect(representabilityOf({ kind: 'documentLifecycle', operationId: 'x', action: 'create', documentId: 'absent-doc' }, exists))
      .toEqual({ kind: 're-stamped', field: 'newDocumentIncarnation' })
    expect(representabilityOf({ kind: 'documentLifecycle', operationId: 'x', action: 'create', documentId: 'present-doc' }, exists))
      .toEqual({ kind: 'already-satisfied', why: 'document-exists' })
  })

  it('documentLifecycle delete: already-satisfied when absent, unrepresentable cross-lifetime-delete when it exists', () => {
    expect(representabilityOf({ kind: 'documentLifecycle', operationId: 'x', action: 'delete', documentId: 'absent-doc' }, exists))
      .toEqual({ kind: 'already-satisfied', why: 'document-absent' })
    expect(representabilityOf({ kind: 'documentLifecycle', operationId: 'x', action: 'delete', documentId: 'present-doc' }, exists))
      .toEqual({ kind: 'unrepresentable', why: 'cross-lifetime-delete' })
  })

  it('documentLifecycle recreate is ALWAYS unrepresentable — no re-stamp rotates a replacement it must not touch (refutation-03 #6)', () => {
    expect(representabilityOf({ kind: 'documentLifecycle', operationId: 'x', action: 'recreate', documentId: 'present-doc' }, exists))
      .toEqual({ kind: 'unrepresentable', why: 'previous-life-recreate' })
  })

  it('crdtCommand: representable, dropped when it names an absent document', () => {
    expect(representabilityOf({ kind: 'crdtCommand', operationId: 'x', commandKind: 'workspace.updateDocument', documentId: 'present-doc' }, exists))
      .toEqual({ kind: 'representable' })
    expect(representabilityOf({ kind: 'crdtCommand', operationId: 'x', commandKind: 'workspace.updateDocument', documentId: 'absent-doc' }, exists))
      .toEqual({ kind: 'unrepresentable', why: 'document-absent' })
  })

  it('currentState may-contest — never re-stamps baseVersion (C-D25)', () => {
    expect(representabilityOf({ kind: 'currentState', operationId: 'x', vocab: 'v', class: 'c', objectId: 'o', baseVersion: 'b', record: {} }, exists))
      .toEqual({ kind: 'may-contest' })
  })

  it('resolveCurrent is always unrepresentable — its conflictId hashes the previous life\'s ledger', () => {
    expect(representabilityOf({ kind: 'resolveCurrent', operationId: 'x', objectKey: 'k', conflictId: 'c' }, exists))
      .toEqual({ kind: 'unrepresentable', why: 'previous-life-resolution' })
  })
})

describe('parkedSidebarSection — the sidebar section (WS3 §5.3)', () => {
  it('null (not an empty section) when nothing is parked', () => {
    expect(parkedSidebarSection(null)).toBeNull()
    const empty: ParkedWorkModel = {
      graphId: 'graph-a',
      graphTitle: 'g',
      fenced: false,
      fenceTestimony: null,
      previousLife: '',
      documents: [],
      looseOperations: [],
      totalOperations: 0,
    }
    expect(parkedSidebarSection(empty)).toBeNull()
  })

  it('rows are kind:document, section:parked, readOnly:true, badged with the reason label — never opened as a real document', () => {
    const model: ParkedWorkModel = {
      graphId: 'graph-a',
      graphTitle: 'g',
      fenced: false,
      fenceTestimony: null,
      previousLife: '',
      documents: [{
        recoveryKey: 'recovery-1',
        documentId: 'doc-a',
        title: 'A Doc',
        reason: 'replaced',
        previousLife: 'abcd1234',
        recoveredAt: 100,
        sizeBytes: 42,
        operations: [],
        joinUnavailable: false,
        reappliedAt: null,
        canReapply: true,
      }],
      looseOperations: [],
      totalOperations: 0,
    }
    const section = parkedSidebarSection(model)
    expect(section).toMatchObject({ id: 'parked', label: 'Parked work', count: 1 })
    expect(section!.nodes).toHaveLength(1)
    expect(section!.nodes![0]).toMatchObject({
      id: 'parked:recovery-1',
      label: 'A Doc',
      kind: 'document',
      section: 'parked',
      readOnly: true,
      badge: PARKED_REASON_LABEL['replaced'],
    })
    expect(parkedRecoveryKeyOf(section!.nodes![0]!.id)).toBe('recovery-1')
  })
})

describe('exportParkedWork — WS3 §6.5', () => {
  it('round-trips a single document through a real Y.applyUpdate, and filters operations to that document alone', async () => {
    const text = 'exported offline text'
    const doc = new Y.Doc()
    doc.getText('body').insert(0, text)
    const update = Y.encodeStateAsUpdate(doc)
    doc.destroy()

    const rec = recovery({
      documentId: 'doc-a',
      key: 'recovery-a',
      update,
      relatedOperationIds: ['op-a1'],
    })
    const other = recovery({ documentId: 'doc-b', key: 'recovery-b', relatedOperationIds: ['op-b1'] })
    const opA1 = outbox({ kind: 'documentUpdate', operationId: 'op-a1', documentId: 'doc-a', documentIncarnation: 'x' })
    const opB1 = outbox({ kind: 'documentUpdate', operationId: 'op-b1', documentId: 'doc-b', documentIncarnation: 'x' })

    const payload = await exportParkedWork(
      {
        userId: 'user-a',
        graphId: 'graph-a',
        graphTitle: 'My Graph',
        previousGraphIncarnation: 'graph-incarnation-a',
        fenceTestimony: 'stale graph incarnation',
        schemaVersion: 1,
      },
      [rec, other],
      [opA1, opB1],
      'recovery-a',
    )

    expect(payload.format).toBe('shrubbery.parked-work/v1')
    expect(payload.documents).toHaveLength(1)
    expect(payload.documents[0]!.documentId).toBe('doc-a')
    expect(payload.operations.map(op => op.operationId)).toEqual(['op-a1'])

    // Real round trip: the base64 update applies into a FRESH Y.Doc and
    // yields the original offline text.
    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload
    const bytes = Uint8Array.from(atob(parsed.documents[0]!.updateBase64), c => c.charCodeAt(0))
    const restored = new Y.Doc()
    Y.applyUpdate(restored, bytes)
    expect(restored.getText('body').toString()).toBe(text)
    restored.destroy()
  })

  it('recoveryKey: null exports the whole graph — every document and every operation', async () => {
    const recA = recovery({ documentId: 'doc-a', key: 'recovery-a', relatedOperationIds: ['op-a1'] })
    const recB = recovery({ documentId: 'doc-b', key: 'recovery-b', relatedOperationIds: [] })
    const loose = outbox({ kind: 'workspaceUpdate', operationId: 'op-loose', updateBase64: 'AA==' })
    const opA1 = outbox({ kind: 'documentUpdate', operationId: 'op-a1', documentId: 'doc-a', documentIncarnation: 'x' })

    const payload = await exportParkedWork(
      {
        userId: 'user-a',
        graphId: 'graph-a',
        graphTitle: 'My Graph',
        previousGraphIncarnation: 'graph-incarnation-a',
        fenceTestimony: null,
        schemaVersion: 1,
      },
      [recA, recB],
      [opA1, loose],
      null,
    )

    expect(payload.documents.map(d => d.documentId).sort()).toEqual(['doc-a', 'doc-b'])
    expect(payload.operations.map(op => op.operationId).sort()).toEqual(['op-a1', 'op-loose'])
  })
})

describe('parkedExportFilename — WS3 §6.5 naming', () => {
  it('names a single-document export vs a whole-graph export distinctly, both ending in the fixed extension', () => {
    const now = (): number => Date.parse('2026-07-30T00:00:00Z')
    const whole = parkedExportFilename('graph-a', 'abcd1234', null, now)
    const one = parkedExportFilename('graph-a', 'abcd1234', 'doc-a', now)
    expect(whole).toBe('parked-graph-a-abcd1234-20260730.shrubbery-parked.json')
    expect(one).toBe('parked-graph-a-doc-a-abcd1234-20260730.shrubbery-parked.json')
  })
})
