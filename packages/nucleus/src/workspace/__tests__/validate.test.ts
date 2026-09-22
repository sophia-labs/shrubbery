/**
 * validateConfig unit tests — the COMMIT GATE invariants.
 *
 * Covers the four required cases (cyclic rejected, two-resizable-root rejected,
 * dangling rejected, GARDEN_DEFAULT passes) plus I5/I6 and the GARDEN_VARIANT
 * generality fixture.
 *
 * Pure: no DOM, no stores, no planFor. The I2 cycle check MUST NOT call planFor
 * — a cyclic config would stack-overflow there. These tests build a cyclic
 * config and assert validateConfig rejects it WITHOUT throwing (proving the
 * raw-edge walk is the brick-stopper).
 */

import { describe, it, expect } from 'vitest'
import { validateConfig } from '../validate.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import { GARDEN_VARIANT } from '../garden-variant.js'
import type { RegionConfig, WorkspaceConfig } from '../types.js'

/** Clone GARDEN_DEFAULT into a mutable (unfrozen) plain object for surgery. */
function mutableClone(): {
  config: WorkspaceConfig
  regions: Record<string, RegionConfig>
} {
  const regions: Record<string, RegionConfig> = {}
  for (const id of Object.keys(GARDEN_DEFAULT.regions)) {
    regions[id] = { ...GARDEN_DEFAULT.regions[id] }
  }
  const config = {
    ...GARDEN_DEFAULT,
    regions,
    rootRegions: [...GARDEN_DEFAULT.rootRegions],
  } as WorkspaceConfig
  return { config, regions }
}

describe('validateConfig — GARDEN_DEFAULT / GARDEN_VARIANT pass', () => {
  it('GARDEN_DEFAULT passes', () => {
    expect(validateConfig(GARDEN_DEFAULT)).toEqual({ ok: true })
  })

  it('GARDEN_VARIANT passes (the divergence fixture is a valid config)', () => {
    expect(validateConfig(GARDEN_VARIANT)).toEqual({ ok: true })
  })
})

describe('validateConfig — I2 acyclic (the brick-stopper)', () => {
  it('rejects a cyclic childRegion spine WITHOUT throwing', () => {
    const { config, regions } = mutableClone()
    // Introduce a cycle: right-rail (currently a leaf) points back at left-rail.
    regions['region-right-rail'] = {
      ...regions['region-right-rail'],
      childRegion: 'region-left-rail',
    }
    // The walk must reject, not stack-overflow.
    let result: ReturnType<typeof validateConfig>
    expect(() => {
      result = validateConfig(config)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (!result!.ok) expect(result!.error).toMatch(/I2/)
  })

  it('rejects a 2-cycle (two regions pointing at each other)', () => {
    const regions: Record<string, RegionConfig> = {
      a: { ...GARDEN_DEFAULT.regions['region-left-rail'], id: 'a', childRegion: 'b' },
      b: { ...GARDEN_DEFAULT.regions['region-center'], id: 'b', childRegion: 'a' },
    }
    const config = {
      ...GARDEN_DEFAULT,
      regions,
      rootRegions: ['a'],
    } as WorkspaceConfig
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I2/)
  })
})

describe('validateConfig — I1 exactly one resizable root', () => {
  it('rejects two resizable roots', () => {
    const { config, regions } = mutableClone()
    // Make bottom-bar a second resizable root and a root in the set.
    regions['region-bottom-bar'] = {
      ...regions['region-bottom-bar'],
      resizable: true,
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I1/)
  })

  it('rejects zero resizable roots', () => {
    const { config, regions } = mutableClone()
    regions['region-left-rail'] = {
      ...regions['region-left-rail'],
      resizable: false,
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I1/)
  })
})

describe('validateConfig — I3 no dangling refs', () => {
  it('rejects a dangling childRegion target', () => {
    const { config, regions } = mutableClone()
    regions['region-left-rail'] = {
      ...regions['region-left-rail'],
      childRegion: 'region-does-not-exist',
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I3/)
  })

  it('rejects a dangling docksPanel id', () => {
    const { config, regions } = mutableClone()
    regions['region-left-rail'] = {
      ...regions['region-left-rail'],
      docksPanel: ['panel-does-not-exist'],
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I3/)
  })

  it('rejects a dangling rootRegion id', () => {
    const { config } = mutableClone()
    ;(config as unknown as { rootRegions: string[] }).rootRegions = [
      ...GARDEN_DEFAULT.rootRegions,
      'region-ghost',
    ]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I3/)
  })
})

describe('validateConfig — I5 every region resolvable to a component', () => {
  it('rejects a content region with no renderedByComponent and no docksPanel', () => {
    const { config, regions } = mutableClone()
    // region-center resolves via docksPanel[0]=panel-editor; strip both.
    regions['region-center'] = {
      ...regions['region-center'],
      renderedByComponent: null,
      docksPanel: [],
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I5/)
  })
})

describe('validateConfig — I6 sizeFraction in (0,1) for spine regions', () => {
  it('rejects a spine region with sizeFraction = 0', () => {
    const { config, regions } = mutableClone()
    regions['region-center'] = { ...regions['region-center'], sizeFraction: 0 }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I6/)
  })

  it('rejects a spine region with sizeFraction = 1', () => {
    const { config, regions } = mutableClone()
    regions['region-left-rail'] = { ...regions['region-left-rail'], sizeFraction: 1 }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I6/)
  })

  it('rejects a spine region with null sizeFraction', () => {
    const { config, regions } = mutableClone()
    regions['region-center'] = { ...regions['region-center'], sizeFraction: null }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I6/)
  })

  it('does NOT gate chrome-root sizeFraction (top-bar 0.04 is fine on a passing config)', () => {
    // top-bar/bottom-bar have small fractions; they are chrome roots, not spine
    // regions, so I6 ignores them. GARDEN_DEFAULT passing already proves this,
    // but assert directly that nudging a chrome fraction doesn't trip I6.
    const { config, regions } = mutableClone()
    regions['region-top-bar'] = { ...regions['region-top-bar'], sizeFraction: 0.99 }
    expect(validateConfig(config)).toEqual({ ok: true })
  })
})

describe('validateConfig — I8 every selection-edge endpoint resolves to a face', () => {
  it("GARDEN_DEFAULT's shipped edges all reference registered faces (I8 no-op)", () => {
    // The 3 shipped Tier-A edges use only face:comments/inspector/graph/editor —
    // all in KNOWN_FACE_IDS — so I8 does not bite the default. (Covered by the
    // GARDEN_DEFAULT-passes test too; asserted here against the edge list directly.)
    expect(validateConfig(GARDEN_DEFAULT)).toEqual({ ok: true })
  })

  it('accepts a Tier-B edge among registered faces (face:sidebar → face:inspector)', () => {
    const { config } = mutableClone()
    ;(config as unknown as { edges: unknown }).edges = [
      ...(GARDEN_DEFAULT.edges ?? []),
      { from: 'face:sidebar', to: 'face:inspector', predicate: 'drivesSelection' },
      { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
    ]
    expect(validateConfig(config)).toEqual({ ok: true })
  })

  it('rejects an edge whose TO face is not registered', () => {
    const { config } = mutableClone()
    ;(config as unknown as { edges: unknown }).edges = [
      { from: 'face:comments', to: 'face:nowhere', predicate: 'drivesSelection' },
    ]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/I8/)
      expect(result.error).toContain('face:nowhere')
    }
  })

  it('rejects an edge whose FROM face is not registered', () => {
    const { config } = mutableClone()
    ;(config as unknown as { edges: unknown }).edges = [
      { from: 'face:bogus', to: 'face:inspector', predicate: 'reflects' },
    ]
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/I8/)
      expect(result.error).toContain('face:bogus')
    }
  })

  it('does NOT gate the predicate (an unknown predicate between known faces passes)', () => {
    // The interpreter tolerates unknown predicates by design, so I8 must accept a
    // forward-declared predicate as long as both endpoints resolve.
    const { config } = mutableClone()
    ;(config as unknown as { edges: unknown }).edges = [
      { from: 'face:graph', to: 'face:editor', predicate: 'someFuturePredicate' },
    ]
    expect(validateConfig(config)).toEqual({ ok: true })
  })
})

describe('validateConfig — graph-authored Surface semantics', () => {
  it('rejects an unknown sux:surfaceRole value', () => {
    const { config, regions } = mutableClone()
    regions['region-center'] = {
      ...regions['region-center'],
      surfaceRole: 'somewhere-else' as never,
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I9 invalid surfaceRole/)
  })

  it('rejects an unknown sux:surfaceMode value', () => {
    const { config, regions } = mutableClone()
    regions['region-center'] = {
      ...regions['region-center'],
      surfaceMode: 'surprise-me' as never,
    }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I10 invalid surfaceMode/)
  })
})
