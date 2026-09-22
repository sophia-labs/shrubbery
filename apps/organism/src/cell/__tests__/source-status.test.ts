/**
 * source-status.test.ts — the bottom-bar mirror badges' pure view model,
 * and the sidebar's per-document decoration (master spec §3 Slice 4).
 * Fast, no-mocks unit coverage over PURE functions; the real-cell/real-
 * browser proof is `bottom-bar-mirror-badges-browser.mts` (gate G9).
 */
import { describe, expect, it } from 'vitest'
import type { SourceMirrorState, SourceOperation, SourceOutboxRecord } from '@shrubbery/source'
import type { SidebarSection } from '@shrubbery/runtime'
import {
  decorateSidebarSectionsWithSourceState,
  documentSourceStates,
  sourceMirrorRefreshDecision,
  sourceStatusModel,
} from '../source-status.js'

function state(overrides: Partial<SourceMirrorState> = {}): SourceMirrorState {
  return {
    phase: 'complete',
    complete: true,
    epoch: 'epoch-1',
    graphIncarnation: 'graph-1',
    pending: 0,
    parked: 0,
    nonDocumentParked: 0,
    rejectedPermanent: 0,
    supersededResolutions: 0,
    resolving: [],
    awaitingEpoch: [],
    contestedObjects: 0,
    repairNeeded: false,
    fenced: false,
    fenceTestimony: null,
    error: null,
    errorCode: null,
    ...overrides,
  }
}

function outboxRow(overrides: Partial<SourceOutboxRecord> & { operation: SourceOperation }): SourceOutboxRecord {
  return {
    key: `k:${overrides.operation.operationId}`,
    mirrorKey: 'mirror-1',
    graphIncarnation: 'graph-1',
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    attempts: 0,
    ...overrides,
  }
}

describe('sourceStatusModel — the bottom-bar mirror badges (copy deck §7.2)', () => {
  it('null state (never opened) shows the unknown badge ALONE', () => {
    expect(sourceStatusModel(null)).toEqual({ badges: [expect.objectContaining({ kind: 'unknown' })] })
  })

  it('an incomplete epoch shows unknown, not an empty region that reads as all-clear', () => {
    const result = sourceStatusModel(state({ complete: false }))
    expect(result.badges).toHaveLength(1)
    expect(result.badges[0]).toMatchObject({
      kind: 'unknown',
      glyph: '—',
      label: 'local copy unknown',
      accessibleName: 'This device has no verified copy of this graph yet.',
    })
  })

  it('a genuinely all-clear complete mirror publishes EMPTY badges — no "0 contested" badge', () => {
    expect(sourceStatusModel(state())).toEqual({ badges: [] })
  })

  it('contested — singular copy at count 1, matching §7.2 exactly', () => {
    const result = sourceStatusModel(state({ contestedObjects: 1 }))
    expect(result.badges).toEqual([{
      kind: 'contested',
      glyph: '◆',
      label: '1 contested',
      accessibleName: '1 object is contested. Open the contested list.',
      hint: 'Two writers proposed different values from the same starting point.',
    }])
  })

  it('contested — plural copy at count 3, byte-identical to the copy deck’s own example', () => {
    const result = sourceStatusModel(state({ contestedObjects: 3 }))
    expect(result.badges[0]).toEqual({
      kind: 'contested',
      glyph: '◆',
      label: '3 contested',
      accessibleName: '3 objects are contested. Open the contested list.',
      hint: 'Two writers proposed different values from the same starting point.',
    })
  })

  it('pending — plural copy at count 2, byte-identical to the copy deck’s own example', () => {
    const result = sourceStatusModel(state({ pending: 2 }))
    expect(result.badges[0]).toEqual({
      kind: 'pending',
      glyph: '↑',
      label: '2 pending',
      accessibleName: '2 changes are saved here and have not reached the cell yet.',
      hint: 'Saved on this device. Not yet acknowledged.',
    })
  })

  it('parked — singular copy at count 1, byte-identical to the copy deck’s own example', () => {
    const result = sourceStatusModel(state({ parked: 1 }))
    expect(result.badges[0]).toEqual({
      kind: 'parked',
      glyph: '⏸',
      label: '1 parked',
      accessibleName: '1 piece of work is parked from a previous life of this graph.',
      hint: 'Kept safe. Nothing was merged.',
    })
  })

  it('contested + pending + parked can co-occur, in that order', () => {
    const result = sourceStatusModel(state({ contestedObjects: 3, pending: 2, parked: 1 }))
    expect(result.badges.map((b) => b.kind)).toEqual(['contested', 'pending', 'parked'])
  })

  it('repairNeeded suppresses ONLY the contested badge — pending/parked are unaffected (§2.1)', () => {
    const result = sourceStatusModel(state({ contestedObjects: 5, pending: 1, parked: 1, repairNeeded: true }))
    expect(result.badges.map((b) => b.kind)).toEqual(['needs-repair', 'pending', 'parked'])
    expect(result.badges[0]).toMatchObject({
      kind: 'needs-repair',
      glyph: '⚠',
      accessibleName:
        'The last update to this local copy did not finish. Some contested objects may not be showing yet.',
    })
  })
})

// ── sidebar per-document decoration ─────────────────────────────────────

function documentUpdateOp(operationId: string, documentId: string): SourceOperation {
  return {
    kind: 'documentUpdate',
    operationId,
    documentId,
    documentIncarnation: 'doc-inc-1',
    updateBase64: '',
  }
}

function valuationOp(operationId: string, documentId: string): SourceOperation {
  return {
    kind: 'valuation',
    operationId,
    valuationEventId: `event-${operationId}`,
    documentId,
    blockId: 'block-1',
    atMs: 1,
  }
}

describe('documentSourceStates — the kind allowlist, never a documentId presence test (R23)', () => {
  it('a pending documentUpdate row marks its document pending', () => {
    const outbox = [outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'pending' })]
    expect(documentSourceStates(outbox)).toEqual(new Map([['doc-a', 'pending']]))
  })

  it('a rejected-stale row marks its document parked', () => {
    const outbox = [outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'rejected-stale' })]
    expect(documentSourceStates(outbox)).toEqual(new Map([['doc-a', 'parked']]))
  })

  it('worst status wins: a parked row beats an unrelated pending row for the SAME document', () => {
    const outbox = [
      outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'rejected-stale' }),
      outboxRow({ operation: documentUpdateOp('op-2', 'doc-a'), status: 'pending' }),
    ]
    expect(documentSourceStates(outbox).get('doc-a')).toBe('parked')
  })

  it('order independence: a LATER pending row never downgrades an earlier parked one', () => {
    const outbox = [
      outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'pending' }),
      outboxRow({ operation: documentUpdateOp('op-2', 'doc-a'), status: 'rejected-stale' }),
      outboxRow({ operation: documentUpdateOp('op-3', 'doc-a'), status: 'pending' }),
    ]
    expect(documentSourceStates(outbox).get('doc-a')).toBe('parked')
  })

  it('a valuation naming a real documentId is NOT a document-plane state (R23 — kind allowlist, not presence)', () => {
    const outbox = [outboxRow({ operation: valuationOp('op-1', 'doc-a'), status: 'pending' })]
    expect(documentSourceStates(outbox).size).toBe(0)
  })

  it('applied/rejected-permanent rows carry no live state', () => {
    const outbox = [
      outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'applied' }),
      outboxRow({ operation: documentUpdateOp('op-2', 'doc-b'), status: 'rejected-permanent' }),
    ]
    expect(documentSourceStates(outbox).size).toBe(0)
  })
})

describe('decorateSidebarSectionsWithSourceState — document-plane truths ONLY', () => {
  const sections: readonly SidebarSection[] = [
    {
      id: 'documents',
      label: 'Documents',
      nodes: [
        {
          id: 'folder-1',
          label: 'Projects',
          kind: 'folder',
          children: [
            { id: 'doc-a', label: 'Draft', kind: 'document' },
            { id: 'doc-b', label: 'Untouched', kind: 'document' },
          ],
        },
        { id: 'artifact-1', label: 'Some artifact', kind: 'artifact' },
      ],
    },
  ]

  it('decorates only the matching document node, leaving siblings and non-document kinds untouched', () => {
    const outbox = [outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'pending' })]
    const decorated = decorateSidebarSectionsWithSourceState(sections, outbox)
    const folder = decorated[0]!.nodes![0]!
    const [docA, docB] = folder.children!
    expect(docA).toMatchObject({ id: 'doc-a', sourceState: 'pending', badgeTone: 'active', badge: 'Pending' })
    expect(docB).toEqual(sections[0]!.nodes![0]!.children![1])
    expect(decorated[0]!.nodes![1]).toEqual(sections[0]!.nodes![1]) // the artifact, untouched
  })

  it('parked documents get the warning tone and "Parked" label', () => {
    const outbox = [outboxRow({ operation: documentUpdateOp('op-1', 'doc-a'), status: 'rejected-stale' })]
    const decorated = decorateSidebarSectionsWithSourceState(sections, outbox)
    expect(decorated[0]!.nodes![0]!.children![0]).toMatchObject({
      sourceState: 'parked',
      badgeTone: 'warning',
      badge: 'Parked',
    })
  })

  it('an empty outbox returns the SAME sections reference (no needless re-render)', () => {
    expect(decorateSidebarSectionsWithSourceState(sections, [])).toBe(sections)
  })
})

describe('sourceMirrorRefreshDecision — the same-total document swap regression (R17, master §2.17)', () => {
  it('a genuine same-total document swap (epoch/complete unchanged, signature differs) requires a refresh', () => {
    // doc-a leaves pending, doc-b arrives pending in the SAME publish — the
    // total pending count never moves, but the composition did. The bug
    // this pins compared a live signature to ITSELF, which can never
    // differ, so this exact case silently refreshed the sidebar zero times.
    const decision = sourceMirrorRefreshDecision(
      state({ epoch: 'epoch-1', complete: true }),
      'doc-a:pending',
      state({ epoch: 'epoch-1', complete: true }),
      'doc-b:pending',
    )
    expect(decision).toBe(true)
  })

  it('genuinely nothing changed (same epoch, same complete, same signature) never forces a refresh', () => {
    const decision = sourceMirrorRefreshDecision(
      state({ epoch: 'epoch-1', complete: true }),
      'doc-a:pending',
      state({ epoch: 'epoch-1', complete: true }),
      'doc-a:pending',
    )
    expect(decision).toBe(false)
  })

  it('the first publish (previous === null) always refreshes', () => {
    expect(sourceMirrorRefreshDecision(null, '', state(), '')).toBe(true)
  })

  it('an epoch rollover refreshes even when the signature happens to match', () => {
    const decision = sourceMirrorRefreshDecision(
      state({ epoch: 'epoch-1', complete: true }),
      'doc-a:pending',
      state({ epoch: 'epoch-2', complete: true }),
      'doc-a:pending',
    )
    expect(decision).toBe(true)
  })

  it('completion flipping from incomplete to complete refreshes even when the signature matches', () => {
    const decision = sourceMirrorRefreshDecision(
      state({ epoch: 'epoch-1', complete: false }),
      'doc-a:pending',
      state({ epoch: 'epoch-1', complete: true }),
      'doc-a:pending',
    )
    expect(decision).toBe(true)
  })
})
