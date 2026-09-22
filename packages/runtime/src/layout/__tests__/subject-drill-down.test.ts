/**
 * subject-drill-down.test.ts — proves `planSubjectDrillDown` against the
 * REAL reducer (`applyOperation`) and a REAL `LayoutDocument` (no mocks —
 * scripts/validate-no-mocks.mjs forbids them; every document here is built
 * through `freshDocument`/`leafNode`, the SAME fixtures
 * `layout-edge-interpreter.test.ts` uses), and `installSubjectDrillDown`
 * against a real DOM (happy-dom) event dispatch — no interpreter, no
 * network, matching this whole test family's "mount the real thing" style.
 */
import { describe, expect, it } from 'vitest'
import {
  createSophiaHomeDescriptor,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutLeafNode,
  type ValidateOptions,
} from '@shrubbery/nucleus/layout'
import { CARD_SUBJECT_FACE_ID } from '../faces/card-subject-face.js'
import { EVIDENCE_CHAIN_FACE_ID } from '../faces/evidence-chain-face.js'
import { SUBJECT_ROW_ACTIVATE_EVENT, type SubjectRowActivateDetail } from '../faces/sparql-table-view-element.js'
import {
  DEFAULT_SUBJECT_DRILL_DOWN_IDS,
  installSubjectDrillDown,
  planSubjectDrillDown,
  type SubjectDrillDownConfig,
} from '../subject-drill-down.js'
import { freshDocument, leafNode, splitNode } from './fixtures.js'

const KNOWN_FACE_IDS = new Set(['sophia.home', CARD_SUBJECT_FACE_ID, EVIDENCE_CHAIN_FACE_ID])

const knownFacesValidate: ValidateOptions = {
  isFaceRegistered: (descriptor) => KNOWN_FACE_IDS.has(descriptor.faceId),
}

function tableDoc(): LayoutDocument {
  return freshDocument('table', { table: leafNode('table', createSophiaHomeDescriptor()) })
}

function baseConfig(): SubjectDrillDownConfig {
  return {
    graphId: 'observatory',
    cardTitleField: 'http://mnemosyne.dev/observatory#kind',
    validate: knownFacesValidate,
  }
}

const ids = DEFAULT_SUBJECT_DRILL_DOWN_IDS

describe('planSubjectDrillDown — first activation', () => {
  it('adds exactly four nodes (two splits, two leaves) with the contract ids; the table leaf is byte-identical', () => {
    const initial = tableDoc()
    const result = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const addedIds = Object.keys(result.doc.nodes).filter((id) => !Object.hasOwn(initial.nodes, id))
    expect(new Set(addedIds)).toEqual(new Set([ids.cardSplitId, ids.cardLeafId, ids.evidenceSplitId, ids.evidenceLeafId]))
    expect(Object.keys(result.doc.nodes)).toHaveLength(Object.keys(initial.nodes).length + 4)

    // LAY-007: the table leaf's OWN map entry is untouched — same object
    // reference, not merely deep-equal — split_leaf never rewrites its
    // target's own entry, only the target's parent edge.
    expect(result.doc.nodes.table).toBe(initial.nodes.table)

    expect(validateLayoutDocument(result.doc, knownFacesValidate).ok).toBe(true)
  })

  it('the two splits nest as documented: cardSplit{table, evidenceSplit{card, evidence}}', () => {
    const initial = tableDoc()
    const result = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { doc } = result

    expect(doc.rootNodeId).toBe(ids.cardSplitId)
    const cardSplit = doc.nodes[ids.cardSplitId]
    expect(cardSplit?.kind).toBe('split')
    if (cardSplit?.kind !== 'split') return
    expect(cardSplit.startNodeId).toBe('table')
    expect(cardSplit.endNodeId).toBe(ids.evidenceSplitId)
    expect(cardSplit.axis).toBe('horizontal')
    expect(cardSplit.startBasisPoints).toBe(6000)

    const evidenceSplit = doc.nodes[ids.evidenceSplitId]
    expect(evidenceSplit?.kind).toBe('split')
    if (evidenceSplit?.kind !== 'split') return
    expect(evidenceSplit.startNodeId).toBe(ids.cardLeafId)
    expect(evidenceSplit.endNodeId).toBe(ids.evidenceLeafId)
    expect(evidenceSplit.axis).toBe('vertical')
    expect(evidenceSplit.startBasisPoints).toBe(5000)
  })

  it('minted descriptors carry graph locators, never SPARQL text — ruling 4 through the RUNTIME path, not just the seed', () => {
    const initial = tableDoc()
    const result = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const card = result.doc.nodes[ids.cardLeafId] as LayoutLeafNode
    const evidence = result.doc.nodes[ids.evidenceLeafId] as LayoutLeafNode
    expect(card.descriptor.faceId).toBe(CARD_SUBJECT_FACE_ID)
    expect(card.descriptor.resource).toEqual({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' })
    expect(evidence.descriptor.faceId).toBe(EVIDENCE_CHAIN_FACE_ID)
    expect(evidence.descriptor.resource).toEqual({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' })
    // Never a `query` locator, never raw SPARQL text anywhere in the descriptor.
    expect(JSON.stringify(card.descriptor)).not.toMatch(/SELECT|WHERE/i)
    expect(JSON.stringify(evidence.descriptor)).not.toMatch(/SELECT|WHERE/i)
  })

  it('a rejection on the source leaf leaves the caller with an honest diagnostic (no doc field)', () => {
    const initial = tableDoc()
    const result = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'does-not-exist', subjectIri: 'urn:x:run-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_NODE_NOT_FOUND')
    expect('doc' in result).toBe(false)
  })

  it('a rejection on the SECOND step (id collision) leaves the ORIGINAL doc\'s own node set entirely unobserved/unmutated', () => {
    // Pre-seed a node under evidenceSplitId's own contract id so step 2's
    // split_leaf collides on `requireFreshId` — step 1 (splitting `table`
    // into cardSplitId/cardLeafId) succeeds on its own, but the two-step
    // operation as a whole must still report failure and never mutate the
    // caller's `doc`.
    const initial = freshDocument('table', {
      table: leafNode('table', createSophiaHomeDescriptor()),
      [ids.evidenceSplitId]: leafNode(ids.evidenceSplitId, createSophiaHomeDescriptor()),
    })
    const nodeCountBefore = Object.keys(initial.nodes).length

    const result = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    expect(result.ok).toBe(false)

    // The passed-in `doc` itself (a frozen object — deepFreeze in fixtures.ts)
    // was never mutated: same key count, same object references throughout.
    expect(Object.keys(initial.nodes)).toHaveLength(nodeCountBefore)
    expect(initial.nodes[ids.cardSplitId]).toBeUndefined()
    expect(initial.nodes[ids.cardLeafId]).toBeUndefined()
    expect(initial.rootNodeId).toBe('table')
  })
})

describe('planSubjectDrillDown — subsequent activation', () => {
  it('replaces both descriptors without restructuring: same node count, no new split, both revisions +1', () => {
    const initial = tableDoc()
    const first = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = planSubjectDrillDown(first.doc, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-2' })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(Object.keys(second.doc.nodes)).toHaveLength(Object.keys(first.doc.nodes).length)
    // No new split: the two splits are the SAME object references.
    expect(second.doc.nodes[ids.cardSplitId]).toBe(first.doc.nodes[ids.cardSplitId])
    expect(second.doc.nodes[ids.evidenceSplitId]).toBe(first.doc.nodes[ids.evidenceSplitId])
    // The table itself, untouched across BOTH activations.
    expect(second.doc.nodes.table).toBe(first.doc.nodes.table)

    const cardBefore = first.doc.nodes[ids.cardLeafId] as LayoutLeafNode
    const cardAfter = second.doc.nodes[ids.cardLeafId] as LayoutLeafNode
    expect(cardAfter.descriptorRevision).toBe(cardBefore.descriptorRevision + 1)
    expect((cardAfter.descriptor.resource as { readonly subjectIri?: string }).subjectIri).toBe('urn:x:run-2')

    const evidenceBefore = first.doc.nodes[ids.evidenceLeafId] as LayoutLeafNode
    const evidenceAfter = second.doc.nodes[ids.evidenceLeafId] as LayoutLeafNode
    expect(evidenceAfter.descriptorRevision).toBe(evidenceBefore.descriptorRevision + 1)
    expect((evidenceAfter.descriptor.resource as { readonly subjectIri?: string }).subjectIri).toBe('urn:x:run-2')

    expect(validateLayoutDocument(second.doc, knownFacesValidate).ok).toBe(true)
  })

  it('a THIRD activation bumps revisions again — replace_descriptor, not a one-shot', () => {
    const initial = tableDoc()
    const first = planSubjectDrillDown(initial, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-1' })
    if (!first.ok) throw new Error('unreachable')
    const second = planSubjectDrillDown(first.doc, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-2' })
    if (!second.ok) throw new Error('unreachable')
    const third = planSubjectDrillDown(second.doc, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-3' })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    const card = third.doc.nodes[ids.cardLeafId] as LayoutLeafNode
    expect(card.descriptorRevision).toBe(2)
    expect((card.descriptor.resource as { readonly subjectIri?: string }).subjectIri).toBe('urn:x:run-3')
  })

  it('subsequent activation fails atomically when the evidence leaf is missing (data inconsistency) — the passed-in doc is untouched', () => {
    // cardLeafId present, evidenceLeafId deliberately absent — the first
    // replace_descriptor (on cardLeafId) would succeed on its own; the
    // WHOLE two-step call must still report failure and never leak that
    // intermediate state back to the caller.
    const cardOnlyDoc = freshDocument(ids.cardSplitId, {
      [ids.cardSplitId]: splitNode(ids.cardSplitId, 'horizontal', 'table', ids.cardLeafId, 6000),
      table: leafNode('table', createSophiaHomeDescriptor()),
      [ids.cardLeafId]: leafNode(ids.cardLeafId, {
        schemaVersion: 1,
        faceId: CARD_SUBJECT_FACE_ID,
        resource: { kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' },
        params: { titleField: 'http://mnemosyne.dev/observatory#kind' },
      }),
    })
    const nodeCountBefore = Object.keys(cardOnlyDoc.nodes).length

    const result = planSubjectDrillDown(cardOnlyDoc, { ...baseConfig(), sourceLeafId: 'table', subjectIri: 'urn:x:run-2' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostic.code).toBe('LAYOP_NODE_NOT_FOUND')

    // The caller's own doc: unchanged key count, cardLeafId's own
    // descriptor/revision untouched by the reducer call that DID succeed
    // internally but was never surfaced.
    expect(Object.keys(cardOnlyDoc.nodes)).toHaveLength(nodeCountBefore)
    expect((cardOnlyDoc.nodes[ids.cardLeafId] as LayoutLeafNode).descriptorRevision).toBe(0)
  })
})

describe('planSubjectDrillDown — an ids override supports more than one drill-down door on the same page', () => {
  it('uses the caller-supplied ids instead of the default contract ids', () => {
    const initial = tableDoc()
    const customIds = {
      cardSplitId: 'other.split-card',
      cardLeafId: 'other.card',
      evidenceSplitId: 'other.split-evidence',
      evidenceLeafId: 'other.evidence',
    }
    const result = planSubjectDrillDown(initial, {
      ...baseConfig(),
      ids: customIds,
      sourceLeafId: 'table',
      subjectIri: 'urn:x:run-1',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.nodes[customIds.cardLeafId]).toBeDefined()
    expect(result.doc.nodes[ids.cardLeafId]).toBeUndefined() // the DEFAULT id never appears
  })
})

// ── installSubjectDrillDown — the DOM half ──────────────────────────────────

function dispatchRowActivate(from: HTMLElement, subjectIri: string): void {
  from.dispatchEvent(
    new CustomEvent<SubjectRowActivateDetail>(SUBJECT_ROW_ACTIVATE_EVENT, {
      // `row` widened onto the detail at master §3 Slice 5 — a real (if
      // minimal) row consistent with `subjectIri`, never an empty stand-in,
      // so this harness stays a faithful shape of the real dispatch site.
      detail: { subjectIri, row: { item: { type: 'uri', value: subjectIri } } },
      bubbles: true,
      composed: true,
    }),
  )
}

function leafWrapper(nodeId: string): { readonly root: HTMLElement; readonly wrapper: HTMLElement; readonly inner: HTMLElement } {
  const root = document.createElement('div')
  const wrapper = document.createElement('div')
  wrapper.dataset.layoutNodeId = nodeId
  const inner = document.createElement('div') // stands in for <sh-sparql-table-view>'s host
  wrapper.appendChild(inner)
  root.appendChild(wrapper)
  document.body.appendChild(root)
  return { root, wrapper, inner }
}

describe('installSubjectDrillDown', () => {
  it('resolves the source leaf via the nearest [data-layout-node-id] ancestor and commits the planned doc', () => {
    const { root, inner } = leafWrapper('table')
    let doc = tableDoc()
    const committed: LayoutDocument[] = []
    const dispose = installSubjectDrillDown(root, () => doc, (next) => {
      doc = next
      committed.push(next)
    }, { ...baseConfig() })

    dispatchRowActivate(inner, 'urn:x:run-1')

    expect(committed).toHaveLength(1)
    expect(committed[0]!.nodes[ids.cardLeafId]).toBeDefined()
    dispose()
    root.remove()
  })

  it('ignores an event with no [data-layout-node-id] ancestor', () => {
    const root = document.createElement('div')
    const orphan = document.createElement('div') // no data-layout-node-id anywhere above it
    root.appendChild(orphan)
    document.body.appendChild(root)

    let doc = tableDoc()
    const committed: LayoutDocument[] = []
    const dispose = installSubjectDrillDown(root, () => doc, (next) => {
      doc = next
      committed.push(next)
    }, { ...baseConfig() })

    dispatchRowActivate(orphan, 'urn:x:run-1')
    expect(committed).toHaveLength(0)
    dispose()
    root.remove()
  })

  it('ignores an event with an empty/missing subjectIri', () => {
    const { root, inner } = leafWrapper('table')
    let doc = tableDoc()
    const committed: LayoutDocument[] = []
    const dispose = installSubjectDrillDown(root, () => doc, (next) => {
      doc = next
      committed.push(next)
    }, { ...baseConfig() })

    dispatchRowActivate(inner, '')
    expect(committed).toHaveLength(0)
    dispose()
    root.remove()
  })

  it('surfaces a reducer rejection through onReject and never commits', () => {
    const { root, inner } = leafWrapper('does-not-exist')
    const doc = tableDoc()
    const committed: LayoutDocument[] = []
    const rejections: string[] = []
    const dispose = installSubjectDrillDown(
      root,
      () => doc,
      (next) => committed.push(next),
      { ...baseConfig(), onReject: (d) => rejections.push(d.code) },
    )

    dispatchRowActivate(inner, 'urn:x:run-1')
    expect(committed).toHaveLength(0)
    expect(rejections).toEqual(['LAYOP_NODE_NOT_FOUND'])
    dispose()
    root.remove()
  })

  it('the disposer is idempotent; a post-dispose fire is inert', () => {
    const { root, inner } = leafWrapper('table')
    let doc = tableDoc()
    const committed: LayoutDocument[] = []
    const dispose = installSubjectDrillDown(root, () => doc, (next) => {
      doc = next
      committed.push(next)
    }, { ...baseConfig() })

    dispose()
    dispose() // idempotent — no throw
    dispatchRowActivate(inner, 'urn:x:run-1')
    expect(committed).toHaveLength(0)
    root.remove()
  })

  it('a second activation via the SAME install call replaces descriptors, not restructures', () => {
    const { root, inner } = leafWrapper('table')
    let doc = tableDoc()
    const committed: LayoutDocument[] = []
    const dispose = installSubjectDrillDown(root, () => doc, (next) => {
      doc = next
      committed.push(next)
    }, { ...baseConfig() })

    dispatchRowActivate(inner, 'urn:x:run-1')
    dispatchRowActivate(inner, 'urn:x:run-2')

    expect(committed).toHaveLength(2)
    expect(Object.keys(committed[1]!.nodes)).toHaveLength(Object.keys(committed[0]!.nodes).length)
    const card = committed[1]!.nodes[ids.cardLeafId] as LayoutLeafNode
    expect((card.descriptor.resource as { readonly subjectIri?: string }).subjectIri).toBe('urn:x:run-2')
    dispose()
    root.remove()
  })
})
