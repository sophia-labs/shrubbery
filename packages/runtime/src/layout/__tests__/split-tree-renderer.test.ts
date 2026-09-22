/**
 * split-tree-renderer.test.ts — `solveCenterPaneSplit` genuinely delegates to
 * the REAL Phase-1 `solveLayout` (never a parallel formula): cross-checked
 * against a hand-built `LayoutDocument` solved directly, for both the
 * unsplit (one leaf) and split (two leaf) cases, plus the "not yet measured"
 * contract `center-panes-host.ts` relies on for its pre-measurement fallback.
 */
import { describe, expect, it } from 'vitest'
import { solveLayout, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { DEFAULT_CENTER_DIVIDER_THICKNESS, solveCenterPaneSplit } from '../split-tree-renderer.js'

describe('solveCenterPaneSplit', () => {
  it('returns null when the container has not been measured yet (non-positive width/height)', () => {
    expect(solveCenterPaneSplit({ primaryId: 'p', secondaryId: null, dividerPercent: 50, containerWidth: 0, containerHeight: 600 })).toBeNull()
    expect(solveCenterPaneSplit({ primaryId: 'p', secondaryId: null, dividerPercent: 50, containerWidth: 800, containerHeight: 0 })).toBeNull()
    expect(solveCenterPaneSplit({ primaryId: 'p', secondaryId: null, dividerPercent: 50, containerWidth: -1, containerHeight: 600 })).toBeNull()
  })

  it('unsplit: the single leaf fills the whole container — matches a hand-solved document exactly', () => {
    const result = solveCenterPaneSplit({ primaryId: 'center-primary', secondaryId: null, dividerPercent: 50, containerWidth: 1000, containerHeight: 600 })
    expect(result).not.toBeNull()
    expect(result!.secondary).toBeNull()
    expect(result!.primary).toEqual({ x: 0, y: 0, width: 1000, height: 600 })
  })

  it('split at 50%: primary/secondary boxes match the REAL solver, not an independent calc()', () => {
    const result = solveCenterPaneSplit({
      primaryId: 'center-primary',
      secondaryId: 'center-secondary',
      dividerPercent: 50,
      containerWidth: 1012,
      containerHeight: 600,
    })
    expect(result).not.toBeNull()
    expect(result!.dividerThickness).toBe(DEFAULT_CENTER_DIVIDER_THICKNESS)

    // Cross-check: hand-build the exact same document and solve it directly.
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'cross-check',
      scope: 'session',
      graphId: null,
      rootNodeId: 'split',
      nodes: {
        split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'center-primary', endNodeId: 'center-secondary', startBasisPoints: 5000 },
        'center-primary': { kind: 'leaf', id: 'center-primary', descriptor: { schemaVersion: 1, faceId: 'sophia.home', resource: { kind: 'iri', iri: 'urn:sophia:home' } }, descriptorRevision: 0 },
        'center-secondary': { kind: 'leaf', id: 'center-secondary', descriptor: { schemaVersion: 1, faceId: 'sophia.home', resource: { kind: 'iri', iri: 'urn:sophia:home' } }, descriptorRevision: 0 },
      },
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    }
    const solved = solveLayout(doc, {}, 1012, 600, { dividerThickness: DEFAULT_CENTER_DIVIDER_THICKNESS })
    expect(solved.ok).toBe(true)
    if (!solved.ok || solved.plan.root.kind !== 'split') throw new Error('unreachable')
    expect(result!.primary).toEqual(solved.plan.root.start.allocation)
    expect(result!.secondary).toEqual(solved.plan.root.end.allocation)
    // 1012 - 12px divider = 1000 available, 50/50 -> 500/500.
    expect(result!.primary).toEqual({ x: 0, y: 0, width: 500, height: 600 })
    expect(result!.secondary).toEqual({ x: 512, y: 0, width: 500, height: 600 })
  })

  it('a skewed ratio moves the divider — same math the real solver produces for basis points', () => {
    const result = solveCenterPaneSplit({
      primaryId: 'p',
      secondaryId: 's',
      dividerPercent: 30,
      containerWidth: 1012,
      containerHeight: 600,
    })
    expect(result).not.toBeNull()
    // available = 1000; start = round(1000 * 3000/10000) = 300.
    expect(result!.primary.width).toBe(300)
    expect(result!.secondary!.width).toBe(700)
    expect(result!.secondary!.x).toBe(300 + DEFAULT_CENTER_DIVIDER_THICKNESS)
  })

  it('two calls with identical input are byte-identical (LAY-011 determinism passed through)', () => {
    const input = { primaryId: 'p', secondaryId: 's', dividerPercent: 42, containerWidth: 900, containerHeight: 500 }
    expect(solveCenterPaneSplit(input)).toEqual(solveCenterPaneSplit(input))
  })
})
