/**
 * reapply-controller.test.ts — MO object-face integration spec, master §3
 * Slice 9 (03 §7, §10.1). [supplementary], scope narrowed per the repair
 * note at 03 §10.1's own row: fast, no-mocks unit coverage over the PURE
 * plan-building functions (`resolveTargets`, `buildPlan`) — id generation
 * and the repaired representability taxonomy (C-D24/C-D25/refutation-03
 * #6). Everything about what the AUTHORITY does with a reapplied
 * operation — contested receipts, `ContestedHandoff` contents, mid-run
 * failure/collateral semantics, drain-refusal, cancel-before-start — is a
 * real-runtime claim and is proven for real at G13 against a real
 * `gardend`, not faked here (an in-process authority would be a fake
 * authority; OQ-C5).
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { SourceOperation, SourceOutboxRecord } from '@shrubbery/source'
import type { DocumentRecoveryRecord } from '../document-activation.js'
import { buildPlan, deliveredReapplyIds, resolveTargets } from '../reapply-controller.js'

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
    reason: 'replaced',
    incarnation: 'doc-incarnation-a',
    relatedOperationIds: [],
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

describe('resolveTargets', () => {
  const replaced = recovery({ documentId: 'doc-1', reason: 'replaced' })
  const deleted = recovery({ documentId: 'doc-2', reason: 'deleted' })
  const orphaned = recovery({ documentId: 'doc-3', reason: 'orphaned' })
  const otherGraph = recovery({ documentId: 'doc-4', graphId: 'graph-b', key: 'recovery:doc-4', reason: 'replaced' })
  const all = [replaced, deleted, orphaned, otherGraph]

  it('includes only requested, same-graph, reason:"replaced" recoveries', () => {
    const result = resolveTargets(
      all,
      [replaced.key, deleted.key, orphaned.key, otherGraph.key, 'recovery:unknown'],
      'graph-a',
    )
    expect(result).toEqual([replaced])
  })

  it("excludes 'deleted' — there is no destination document (master §10.9)", () => {
    expect(resolveTargets(all, [deleted.key], 'graph-a')).toEqual([])
  })

  it("excludes 'orphaned' — there is no fence (master §10.9)", () => {
    expect(resolveTargets(all, [orphaned.key], 'graph-a')).toEqual([])
  })

  it('excludes a same-key recovery from a different graph', () => {
    expect(resolveTargets(all, [otherGraph.key], 'graph-a')).toEqual([])
  })
})

describe('buildPlan — the repaired representability taxonomy (03 §7.5)', () => {
  const documentExistsTrue = (): boolean => true
  const documentExistsFalse = (): boolean => false
  const incarnationOf = (): string | null => 'new-life-incarnation'
  let counter = 0
  const freshId = (): string => `reapply:fresh-${(counter += 1)}`

  it('workspaceUpdate/graphMetadata/eventLog/memory/valuation/retraction: fresh id only, otherwise verbatim', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-workspace'] })
    const operation: SourceOperation = { kind: 'workspaceUpdate', operationId: 'op-workspace', updateBase64: 'AAAA' }
    const { planned, dropped } = buildPlan(
      [document],
      [document],
      [outbox(operation)],
      documentExistsTrue,
      incarnationOf,
      freshId,
    )
    expect(dropped.filter(row => row.parkedOperationId === 'op-workspace')).toEqual([])
    const row = planned.find(entry => entry.parkedOperationId === 'op-workspace')
    expect(row).toBeDefined()
    expect(row!.operation.operationId).not.toBe('op-workspace')
    expect(row!.operation.operationId.startsWith('reapply:')).toBe(true)
    expect(row!.operation.updateBase64).toBe('AAAA') // every other field verbatim
  })

  it('currentState: baseVersion is left UNCHANGED (C-D25, R21) — rebasing would let the fold silently overwrite instead of contest', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-current'] })
    const operation: SourceOperation = {
      kind: 'currentState',
      operationId: 'op-current',
      vocab: 'koch-morse',
      class: 'Learner',
      objectId: 'learner-1',
      baseVersion: 'the-previous-lifes-observed-head',
      record: { characterWpm: 20 },
    }
    const { planned } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    const row = planned.find(entry => entry.parkedOperationId === 'op-current')
    expect(row).toBeDefined()
    expect(row!.operation.baseVersion).toBe('the-previous-lifes-observed-head')
    expect(row!.operation.operationId).not.toBe('op-current')
  })

  it("documentLifecycle 'recreate': unrepresentable — dropped and reported, never replayed (refutation-03 #6)", () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-recreate'] })
    const operation: SourceOperation = {
      kind: 'documentLifecycle', operationId: 'op-recreate', action: 'recreate', documentId: 'doc-1',
    }
    const { planned, dropped } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-recreate')).toBe(false)
    const row = dropped.find(entry => entry.parkedOperationId === 'op-recreate')
    expect(row?.representability).toEqual({ kind: 'unrepresentable', why: 'previous-life-recreate' })
  })

  it("documentLifecycle 'delete' of a document that EXISTS in the new life: cross-lifetime-delete, dropped (the most dangerous row, refutation-03 #6)", () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-delete'] })
    const operation: SourceOperation = {
      kind: 'documentLifecycle', operationId: 'op-delete', action: 'delete', documentId: 'doc-1',
      expectedDocumentIncarnation: 'the-previous-lifes-incarnation',
    }
    const { planned, dropped } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-delete')).toBe(false)
    const row = dropped.find(entry => entry.parkedOperationId === 'op-delete')
    expect(row?.representability).toEqual({ kind: 'unrepresentable', why: 'cross-lifetime-delete' })
  })

  it('crdtCommand: NOT re-stamped — fresh id only, same as a bare representable kind (refutation-03 #6)', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-cmd'] })
    const operation: SourceOperation = {
      kind: 'crdtCommand', operationId: 'op-cmd', commandKind: 'workspace.createFolder', documentId: 'doc-1',
      payload: { name: 'A folder' },
    }
    const { planned } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    const row = planned.find(entry => entry.parkedOperationId === 'op-cmd')
    expect(row).toBeDefined()
    expect(row!.operation.payload).toEqual({ name: 'A folder' })
    expect('newDocumentIncarnation' in row!.operation).toBe(false)
    expect('documentIncarnation' in row!.operation).toBe(false)
  })

  it('crdtCommand naming a document absent from the new life: dropped (document-absent)', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-cmd-gone'] })
    const operation: SourceOperation = {
      kind: 'crdtCommand', operationId: 'op-cmd-gone', commandKind: 'workspace.createFolder', documentId: 'doc-1',
    }
    const { planned, dropped } = buildPlan([document], [document], [outbox(operation)], documentExistsFalse, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-cmd-gone')).toBe(false)
    expect(dropped.find(entry => entry.parkedOperationId === 'op-cmd-gone')?.representability)
      .toEqual({ kind: 'unrepresentable', why: 'document-absent' })
  })

  it('resolveCurrent: unrepresentable — its conflictId hashes the previous life\'s ledger', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: [] })
    const operation: SourceOperation = {
      kind: 'resolveCurrent', operationId: 'op-resolve', objectKey: 'vco', conflictId: 'conflict-xyz',
    }
    const { planned, dropped } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-resolve')).toBe(false)
    expect(dropped.find(entry => entry.parkedOperationId === 'op-resolve')?.representability)
      .toEqual({ kind: 'unrepresentable', why: 'previous-life-resolution' })
  })

  it('the SYNTHESIZED snapshot documentUpdate always appears once per reapplied recovery whose document exists — even with an EMPTY relatedOperationIds (C-D24, R20)', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: [] })
    const { planned, dropped } = buildPlan([document], [document], [], documentExistsTrue, incarnationOf, freshId)
    expect(dropped).toEqual([])
    const snapshotRows = planned.filter(entry => entry.parkedOperationId === `snapshot:${document.key}`)
    expect(snapshotRows).toHaveLength(1)
    const [snapshot] = snapshotRows
    expect(snapshot!.operation.kind).toBe('documentUpdate')
    expect(snapshot!.operation.documentId).toBe('doc-1')
    expect(snapshot!.operation.documentIncarnation).toBe('new-life-incarnation')
    // The exact bytes IndexedDB holds, base64 — round-trips through a real Y.applyUpdate.
    const restored = new Y.Doc()
    Y.applyUpdate(restored, Buffer.from(snapshot!.operation.updateBase64 as string, 'base64'))
    expect(restored.getText('body').toString()).toBe('parked text for doc-1')
    restored.destroy()
  })

  it('the synthesized snapshot is dropped (document-absent), not fabricated, when the document does not exist in the new life', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: [] })
    const { planned, dropped } = buildPlan([document], [document], [], documentExistsFalse, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === `snapshot:${document.key}`)).toBe(false)
    expect(dropped.find(entry => entry.parkedOperationId === `snapshot:${document.key}`)?.representability)
      .toEqual({ kind: 'unrepresentable', why: 'document-absent' })
  })

  it("documentUpdate: re-stamped to the new life's documentIncarnation", () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-doc-update'] })
    const operation: SourceOperation = {
      kind: 'documentUpdate', operationId: 'op-doc-update', documentId: 'doc-1',
      documentIncarnation: 'the-previous-lifes-incarnation', updateBase64: 'QUJD',
    }
    const { planned } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    const row = planned.find(entry => entry.parkedOperationId === 'op-doc-update')
    expect(row?.operation.documentIncarnation).toBe('new-life-incarnation')
    expect(row?.operation.updateBase64).toBe('QUJD')
  })

  it("documentLifecycle 'create' of an ABSENT document: representable with a fresh newDocumentIncarnation", () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-create'] })
    const operation: SourceOperation = {
      kind: 'documentLifecycle', operationId: 'op-create', action: 'create', documentId: 'doc-1', title: 'A title',
    }
    const { planned } = buildPlan([document], [document], [outbox(operation)], documentExistsFalse, incarnationOf, freshId)
    const row = planned.find(entry => entry.parkedOperationId === 'op-create')
    expect(row).toBeDefined()
    expect(typeof row!.operation.newDocumentIncarnation).toBe('string')
    expect((row!.operation.newDocumentIncarnation as string).length).toBeGreaterThan(0)
  })

  it("documentLifecycle 'create' of a document that already EXISTS: already-satisfied, dropped — the snapshot carries the content instead", () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-create-exists'] })
    const operation: SourceOperation = {
      kind: 'documentLifecycle', operationId: 'op-create-exists', action: 'create', documentId: 'doc-1',
    }
    const { planned, dropped } = buildPlan([document], [document], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-create-exists')).toBe(false)
    expect(dropped.find(entry => entry.parkedOperationId === 'op-create-exists')?.representability)
      .toEqual({ kind: 'already-satisfied', why: 'document-exists' })
  })

  it('fresh ids never collide with parked ids, and every planned row carries its own parkedOperationId (the reapplyOf source)', () => {
    const document = recovery({ documentId: 'doc-1', relatedOperationIds: ['op-a', 'op-b'] })
    const opA: SourceOperation = { kind: 'workspaceUpdate', operationId: 'op-a', updateBase64: 'AAAA' }
    const opB: SourceOperation = { kind: 'workspaceUpdate', operationId: 'op-b', updateBase64: 'BBBB' }
    const { planned } = buildPlan([document], [document], [outbox(opA), outbox(opB)], documentExistsTrue, incarnationOf, freshId)
    const ids = planned.map(entry => entry.operation.operationId)
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    expect(ids.some(id => id === 'op-a' || id === 'op-b')).toBe(false) // never reuse a parked id
    for (const entry of planned) {
      expect(['op-a', 'op-b', `snapshot:${document.key}`]).toContain(entry.parkedOperationId)
    }
  })

  it('a graph-scoped loose operation (D3) rides along unconditionally, even with no target document selected', () => {
    const otherDocument = recovery({ documentId: 'doc-not-selected', relatedOperationIds: [] })
    const looseOperation: SourceOperation = { kind: 'graphMetadata', operationId: 'op-loose', title: 'New title' }
    const { planned } = buildPlan([], [otherDocument], [outbox(looseOperation)], documentExistsTrue, incarnationOf, freshId)
    const row = planned.find(entry => entry.parkedOperationId === 'op-loose')
    expect(row).toBeDefined()
    expect(row!.recoveryKey).toBeNull()
  })

  it("an operation claimed by a NON-selected document's relatedOperationIds is never swept in as loose", () => {
    const selected = recovery({ documentId: 'doc-selected', relatedOperationIds: [] })
    const notSelected = recovery({ documentId: 'doc-not-selected', key: 'recovery:doc-not-selected', relatedOperationIds: ['op-claimed'] })
    const operation: SourceOperation = { kind: 'documentUpdate', operationId: 'op-claimed', documentId: 'doc-not-selected', documentIncarnation: 'x', updateBase64: 'AAAA' }
    const { planned } = buildPlan([selected], [selected, notSelected], [outbox(operation)], documentExistsTrue, incarnationOf, freshId)
    expect(planned.some(entry => entry.parkedOperationId === 'op-claimed')).toBe(false)
  })
})

// fix(slice-9) — refutation finding #2 (adversarial review of Slice 9,
// 2026-07-31): a FAILED reapply attempt must remain reappliable, and must
// never be counted as already-delivered work.
describe('deliveredReapplyIds — only a DELIVERED reapply attempt excludes a retry', () => {
  it('accepted/applied/conflict rows count as delivered', () => {
    const accepted = outbox({ kind: 'crdtCommand', operationId: 'reapply:1', command: 'noop' } as unknown as SourceOperation, {
      status: 'accepted',
      reapplyOf: 'parked-op-a',
    })
    const applied = outbox({ kind: 'crdtCommand', operationId: 'reapply:2', command: 'noop' } as unknown as SourceOperation, {
      status: 'applied',
      reapplyOf: 'parked-op-b',
    })
    const conflict = outbox({ kind: 'crdtCommand', operationId: 'reapply:3', command: 'noop' } as unknown as SourceOperation, {
      status: 'conflict',
      reapplyOf: 'parked-op-c',
    })
    const ids = deliveredReapplyIds([accepted, applied, conflict])
    expect(ids).toEqual(new Set(['parked-op-a', 'parked-op-b', 'parked-op-c']))
  })

  it('a REJECTED (stale or permanent) reapply row does NOT count as delivered — the original stays reappliable', () => {
    const rejectedStale = outbox({ kind: 'crdtCommand', operationId: 'reapply:1', command: 'noop' } as unknown as SourceOperation, {
      status: 'rejected-stale',
      reapplyOf: 'parked-op-a',
    })
    const rejectedPermanent = outbox({ kind: 'crdtCommand', operationId: 'reapply:2', command: 'noop' } as unknown as SourceOperation, {
      status: 'rejected-permanent',
      reapplyOf: 'parked-op-b',
    })
    expect(deliveredReapplyIds([rejectedStale, rejectedPermanent])).toEqual(new Set())
  })

  it('a still-PENDING reapply row does not (yet) count as delivered either', () => {
    const pending = outbox({ kind: 'crdtCommand', operationId: 'reapply:1', command: 'noop' } as unknown as SourceOperation, {
      status: 'pending',
      reapplyOf: 'parked-op-a',
    })
    expect(deliveredReapplyIds([pending])).toEqual(new Set())
  })

  it('a rejected reapply row is excluded from alreadyReapplied, so buildPlan replans the original operation on retry', () => {
    const documentExistsTrue = (): boolean => true
    const incarnationOf = (): string | null => 'new-life-incarnation'
    let counter = 0
    const freshId = (): string => `reapply:fresh-${(counter += 1)}`
    const document = recovery({ documentId: 'doc-a', relatedOperationIds: ['parked-op-a'] })
    const originalOperation: SourceOperation = {
      kind: 'documentUpdate',
      operationId: 'parked-op-a',
      documentId: 'doc-a',
      documentIncarnation: 'doc-incarnation-a',
      updateBase64: 'AAAA',
    }
    const failedReapplyAttempt = outbox(
      { kind: 'crdtCommand', operationId: 'reapply:previous-attempt', command: 'noop' } as unknown as SourceOperation,
      { status: 'rejected-stale', reapplyOf: 'parked-op-a' },
    )
    // The buggy construction (`new Set(records.flatMap(r => r.reapplyOf ? [r.reapplyOf] : []))`,
    // with NO status filter) would put 'parked-op-a' in alreadyReapplied here —
    // buildPlan would then DROP the original and the retry would replan nothing.
    const alreadyReapplied = deliveredReapplyIds([failedReapplyAttempt])
    const { planned } = buildPlan(
      [document],
      [document],
      [outbox(originalOperation)],
      documentExistsTrue,
      incarnationOf,
      freshId,
      alreadyReapplied,
    )
    expect(planned.some(entry => entry.parkedOperationId === 'parked-op-a')).toBe(true)
  })
})
