import { describe, expect, it } from 'vitest'
import { compileGraphPlan, findingCommentId, graphPlanDigest, publishableFindings, stepTallies, triplesFromSparqlResult } from '../graph-plan.js'
import fixture from './fixtures/graph-plan-freud-ch1.sparql.json'
import runEvents from './fixtures/graph-plan-run-events-freud-20261018.json'

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

describe('publishing a run\'s findings to a margin', () => {
  // Shaped like the verified entries of the 2026-10-18 runs: Meier's stake between the toes, read from the imported book.
  const meier = {
    who: 'Meier',
    done: 'a blade of straw was sticking between his toes',
    dreamt: 'he was assaulted and a stake was driven into the ground between his big and second toes',
    quote: 'he suddenly awoke and felt a blade of straw sticking between his toes',
    documentId: 'doc-5ca098bcf9024343952d2789d060f543',
    blockId: 'block-17207150',
    note: 'Meier: straw between the toes, dreamt of a stake driven between them.',
  }

  it('keeps the findings that name a document, a quote and a note', () => {
    const found = publishableFindings([
      meier,
      { ...meier, documentId: 'urn:not-an-id' },
      { ...meier, quote: '  ' },
      { who: 'Gregory', quote: 'a hot-water bottle' },
      'not an object',
    ])
    expect(found).toEqual([{ documentId: meier.documentId, quote: meier.quote, note: meier.note, blockId: meier.blockId }])
  })

  it('gives each finding a stable comment id, so publishing twice updates rather than doubles', () => {
    expect(findingCommentId('wfr-mveof144-76kkim', 0)).toBe('wf-wfr-mveof144-76kkim-1')
    expect(findingCommentId('run/with:odd chars', 13)).toBe('wf-run_with_odd_chars-14')
  })
})

describe('how a run stands, step by step', () => {
  // The events of run wfr-mvetf168-zca079 (2026-10-18), read from Choreograph's journal: 26 clerks, three of whom
  // answered without submit().
  const events = runEvents as { type: string; label: string }[]

  it('counts each item once, by its last word', () => {
    const tallies = stepTallies(events)
    expect(tallies.get('Passage Cutter')).toEqual({ started: 1, done: 1, failed: 0 })
    expect(tallies.get('Experiment Clerk')).toEqual({ started: 26, done: 23, failed: 3 })
    expect(tallies.get('Quote Censor')).toEqual({ started: 25, done: 25, failed: 0 })
  })

  it('lets a retry that submits turn its item from failed to done', () => {
    const retried = [
      ...events,
      { type: 'node_started', label: 'Experiment Clerk #4 again' },
      { type: 'node_done', label: 'Experiment Clerk #4 again' },
      { type: 'node_started', label: 'Experiment Clerk #5 again' },
    ]
    expect(stepTallies(retried).get('Experiment Clerk')).toEqual({ started: 26, done: 24, failed: 1 })
  })
})
