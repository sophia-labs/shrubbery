import fixture from './fixtures/graph-plan-freud-ch1.sparql.json'
import { describe, expect, it } from 'vitest'
import { compileGraphPlan, graphPlanDigest, triplesFromSparqlResult } from '../graph-plan.js'

// The same live gardend answer Choreograph's own test reads (choreograph src/test/graph-plan.test.ts). Both must reach
// the digest the 2026-10-18 run approved: the pane shows a person exactly the plan Choreograph will run.
const FIXTURE: unknown = fixture
const PINNED = 'sha256:3d3efe3add6543d7d800941ee10559f4729e29b6d69c8416ce5c00d37dcc0b33'

describe('graph plan in the browser', () => {
  it('computes the digest Choreograph pinned', async () => {
    const plan = compileGraphPlan(triplesFromSparqlResult(FIXTURE))
    expect(plan.phases.map((p) => p.title)).toEqual(['Day residue', 'Dream-work', 'The Censor'])
    expect(await graphPlanDigest(plan)).toBe(PINNED)
  })
})
