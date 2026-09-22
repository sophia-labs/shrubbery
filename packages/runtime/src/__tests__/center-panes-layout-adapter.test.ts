/**
 * center-panes-layout-adapter.test.ts — `CenterPanesState` maps onto a
 * genuinely VALID, SOLVABLE Phase-1 `LayoutDocument` — proven by round-
 * tripping through the REAL `validateLayoutDocument`/`solveLayout`
 * (`@shrubbery/nucleus/layout`), never a hand-rolled shape assertion that
 * could drift from what Phase 1 actually accepts.
 */
import { describe, expect, it } from 'vitest'
import {
  createFaceAllowListPredicate,
  noParamsAllowed,
  solveLayout,
  validateLayoutDocument,
  type FaceParamsValidator,
} from '@shrubbery/nucleus/layout'
import {
  createCenterPanesState,
  homeLocation,
  openCenterPane,
  resizeCenterPanes,
} from '../center-panes-model.js'
import {
  CENTER_ROOT_SPLIT_ID,
  centerPanesStateToLayoutDocument,
  dividerPercentToBasisPoints,
} from '../center-panes-layout-adapter.js'

/** The real v1 face catalog's ids, closed-params-validated exactly like the
 * production registry would (design's own closed-catalog discipline) — this
 * suite never touches a fake/permissive predicate. */
const isFaceRegistered = createFaceAllowListPredicate([
  { faceId: 'hoja.document', validateParams: noParamsAllowed as FaceParamsValidator },
  { faceId: 'sophia.home', validateParams: noParamsAllowed as FaceParamsValidator },
])

describe('centerPanesStateToLayoutDocument — single (unsplit) pane', () => {
  it('produces a one-leaf document whose root IS the primary pane id, home descriptor', () => {
    const state = createCenterPanesState({ graphId: 'g1' })
    const doc = centerPanesStateToLayoutDocument(state)

    expect(doc.rootNodeId).toBe(state.primary.id)
    expect(Object.keys(doc.nodes)).toEqual([state.primary.id])
    const leaf = doc.nodes[state.primary.id]
    expect(leaf.kind).toBe('leaf')
    if (leaf.kind !== 'leaf') throw new Error('unreachable')
    expect(leaf.descriptor.faceId).toBe('sophia.home')

    const verdict = validateLayoutDocument(doc, { isFaceRegistered })
    expect(verdict.ok).toBe(true)
  })

  it('a document location maps to a real hoja.document descriptor', () => {
    const state = openCenterPane(createCenterPanesState({ graphId: 'g1' }), {
      paneId: 'center-primary',
      placement: 'active',
      location: { kind: 'document', graphId: 'g1', documentId: 'doc-a', title: 'Doc A' },
    })
    const doc = centerPanesStateToLayoutDocument(state)
    const leaf = doc.nodes[state.primary.id]
    if (leaf.kind !== 'leaf') throw new Error('unreachable')
    expect(leaf.descriptor).toEqual({
      schemaVersion: 1,
      faceId: 'hoja.document',
      resource: { kind: 'document', graphId: 'g1', documentId: 'doc-a' },
    })
    expect(validateLayoutDocument(doc, { isFaceRegistered }).ok).toBe(true)
  })

  it('solves through the REAL Phase-1 solver — the single leaf fills the whole container', () => {
    const state = createCenterPanesState({ graphId: 'g1' })
    const doc = centerPanesStateToLayoutDocument(state)
    const solved = solveLayout(doc, {}, 1000, 600, { isFaceRegistered })
    expect(solved.ok).toBe(true)
    if (!solved.ok) throw new Error('unreachable')
    expect(solved.plan.root).toMatchObject({ kind: 'leaf', allocation: { x: 0, y: 0, width: 1000, height: 600 } })
  })

  it('is byte-stable across repeated calls over an UNCHANGED state (LAY-011) when timestamps are pinned', () => {
    const state = createCenterPanesState({ graphId: 'g1' })
    const a = centerPanesStateToLayoutDocument(state, { at: '2026-07-16T00:00:00.000Z' })
    const b = centerPanesStateToLayoutDocument(state, { at: '2026-07-16T00:00:00.000Z' })
    expect(a).toEqual(b)
  })
})

describe('centerPanesStateToLayoutDocument — split (primary + secondary)', () => {
  function splitState(dividerPercent = 50) {
    let state = createCenterPanesState({ graphId: 'g1' })
    state = openCenterPane(state, {
      paneId: 'center-primary',
      placement: 'active',
      location: { kind: 'document', graphId: 'g1', documentId: 'doc-a', title: 'Doc A' },
    })
    state = openCenterPane(state, {
      paneId: 'center-secondary',
      placement: 'split',
      location: { kind: 'document', graphId: 'g1', documentId: 'doc-b', title: 'Doc B' },
    })
    return resizeCenterPanes(state, dividerPercent, 1, 99) // wide clamp so the test can pick any percent
  }

  it('produces the exact design §9.2 Phase-4 shape: center-root-split, horizontal, primary=start/secondary=end', () => {
    const state = splitState(50)
    const doc = centerPanesStateToLayoutDocument(state)

    expect(doc.rootNodeId).toBe(CENTER_ROOT_SPLIT_ID)
    const split = doc.nodes[CENTER_ROOT_SPLIT_ID]
    expect(split.kind).toBe('split')
    if (split.kind !== 'split') throw new Error('unreachable')
    expect(split.axis).toBe('horizontal')
    expect(split.startNodeId).toBe(state.primary.id)
    expect(split.endNodeId).toBe(state.secondary!.id)
    expect(split.startBasisPoints).toBe(5000)

    expect(validateLayoutDocument(doc, { isFaceRegistered }).ok).toBe(true)
  })

  it('dividerPercent * 100 -> basis points, both directions of the split ratio', () => {
    expect(dividerPercentToBasisPoints(50)).toBe(5000)
    expect(dividerPercentToBasisPoints(30)).toBe(3000)
    expect(dividerPercentToBasisPoints(72.5)).toBe(7250)

    const doc = centerPanesStateToLayoutDocument(splitState(30))
    const split = doc.nodes[CENTER_ROOT_SPLIT_ID]
    if (split.kind !== 'split') throw new Error('unreachable')
    expect(split.startBasisPoints).toBe(3000)
  })

  it('solves through the REAL Phase-1 solver into a real horizontal two-leaf plan', () => {
    const doc = centerPanesStateToLayoutDocument(splitState(50))
    const solved = solveLayout(doc, {}, 1001, 600, { isFaceRegistered })
    expect(solved.ok).toBe(true)
    if (!solved.ok) throw new Error('unreachable')
    expect(solved.plan.root.kind).toBe('split')
    if (solved.plan.root.kind !== 'split') throw new Error('unreachable')
    expect(solved.plan.root.axis).toBe('horizontal')
    expect(solved.plan.root.start.allocation.width).toBe(500)
    expect(solved.plan.root.end.allocation.width).toBe(500)
  })

  it('a secondary home location maps to the real sophia.home descriptor too', () => {
    let state = createCenterPanesState({ graphId: 'g1' })
    state = openCenterPane(state, { paneId: 'center-primary', placement: 'active', location: { kind: 'document', graphId: 'g1', documentId: 'doc-a', title: 'Doc A' } })
    state = openCenterPane(state, { paneId: 'center-secondary', placement: 'split', location: homeLocation('g1') })
    const doc = centerPanesStateToLayoutDocument(state)
    const secondaryLeaf = doc.nodes[state.secondary!.id]
    if (secondaryLeaf.kind !== 'leaf') throw new Error('unreachable')
    expect(secondaryLeaf.descriptor.faceId).toBe('sophia.home')
    expect(validateLayoutDocument(doc, { isFaceRegistered }).ok).toBe(true)
  })
})
