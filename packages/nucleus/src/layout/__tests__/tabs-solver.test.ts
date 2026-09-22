import { describe, expect, it } from 'vitest'
import { solveLayout, TABS_STRIP_HEIGHT } from '../solver.js'
import { singleTabsDoc, TEST_VALIDATE_OPTIONS } from './fixtures.js'

describe('tabs solver', () => {
  it('tiles the strip and active content without planning the inactive tab', () => {
    const result = solveLayout(singleTabsDoc(), {}, 800, 600, TEST_VALIDATE_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root.kind).toBe('tabs')
    if (result.plan.root.kind !== 'tabs') return
    expect(result.plan.root.stripAllocation.height).toBe(TABS_STRIP_HEIGHT)
    expect(result.plan.root.active.id).toBe('t-a')
    expect(result.plan.root.active.allocation.y).toBe(TABS_STRIP_HEIGHT)
    expect(result.plan.root.active.allocation.height + result.plan.root.stripAllocation.height).toBe(600)
  })
})
