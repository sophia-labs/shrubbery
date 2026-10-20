import { describe, expect, it } from 'vitest'
import { compileGraphPlan, composedNote, findingCommentId, GraphPlanError, graphPlanDigest, publishableFindings, sketchGraphPlan, stepTallies, type Triple, triplesFromSparqlResult, WF } from '../graph-plan.js'
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

  it('reaches Choreograph\'s digest for a plan that names its source and its destination (2026-10-19)', async () => {
    const W = 'urn:sophia:wf:freud-ch1'
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
    const iri = (value: string) => ({ kind: 'iri' as const, value })
    const text = (value: string) => ({ kind: 'literal' as const, value })
    const extra: Triple[] = [
      { s: `${W}#book`, p: RDF_TYPE, o: iri(`${WF}Source`) },
      { s: `${W}#book`, p: `${WF}label`, o: text('The Interpretation of Dreams, I.C') },
      { s: `${W}#book`, p: `${WF}documentId`, o: text('freud-dreams-1') },
      { s: `${W}#book`, p: `${WF}fromBlock`, o: text('block-be1fe535') },
      { s: `${W}#book`, p: `${WF}toBlock`, o: text('block-0c1d2e3f') },
      { s: `${W}#reader`, p: `${WF}reads`, o: iri(`${W}#book`) },
      { s: `${W}#margin`, p: RDF_TYPE, o: iri(`${WF}Destination`) },
      { s: `${W}#margin`, p: `${WF}label`, o: text("The book's margin") },
      { s: `${W}#margin`, p: `${WF}kind`, o: text('margin') },
      { s: `${W}#margin`, p: `${WF}receives`, o: iri(`${W}#verified`) },
      { s: `${W}#margin`, p: `${WF}documentId`, o: text('freud-dreams-1') },
    ]
    const plan = compileGraphPlan([...triplesFromSparqlResult(FIXTURE), ...extra])
    expect(plan.sources?.map((s) => s.id)).toEqual(['book'])
    expect(plan.destinations?.map((d) => [d.id, d.receives])).toEqual([['margin', `${W}#verified`]])
    expect(await graphPlanDigest(plan)).toBe('sha256:e0f63e28e36771e32eb181a178e8b8b96021dd20b84cbce7c5440c38df83546a')
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

  it('writes a finding without a note as its other fields, as gardend publishes it', () => {
    const entry = { who: 'Meier', whatDone: 'straw between toes', blank: '  ', dream: 'a stake', quote: meier.quote, documentId: meier.documentId, blockId: meier.blockId }
    expect(composedNote(entry)).toBe('who: Meier; what done: straw between toes; dream: a stake')
    expect(publishableFindings([entry])).toEqual([{ documentId: meier.documentId, quote: meier.quote, note: 'who: Meier; what done: straw between toes; dream: a stake', blockId: meier.blockId }])
    expect(publishableFindings([{ quote: meier.quote, documentId: meier.documentId }])).toEqual([])
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

describe('an unfinished plan, as the canvas draws it', () => {
  it('keeps every part the graph names, though the compiler refuses the plan', () => {
    const W = 'urn:sophia:wf:doc-sleepers'
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
    const iri = (value: string) => ({ kind: 'iri' as const, value })
    const text = (value: string) => ({ kind: 'literal' as const, value })
    // Sophia mid-composition: a source, a Clerk who reads passages no one cuts yet, and a margin for what is verified.
    const triples: Triple[] = [
      { s: W, p: RDF_TYPE, o: iri(`${WF}Workflow`) },
      { s: W, p: `${WF}name`, o: text('doc-sleepers') },
      { s: W, p: 'http://purl.org/dc/terms/title', o: text('Sleepers, catalogued') },
      { s: `${W}#book`, p: RDF_TYPE, o: iri(`${WF}Source`) },
      { s: `${W}#book`, p: `${WF}label`, o: text('Chapter I, section C') },
      { s: `${W}#book`, p: `${WF}documentId`, o: text('doc-freud') },
      { s: `${W}#clerk`, p: RDF_TYPE, o: iri(`${WF}AgentNode`) },
      { s: `${W}#clerk`, p: `${WF}label`, o: text('Experiment Clerk') },
      { s: `${W}#clerk`, p: `${WF}mode`, o: text('perItem') },
      { s: `${W}#clerk`, p: `${WF}over`, o: iri(`${W}#passages`) },
      { s: `${W}#clerk`, p: `${WF}reads`, o: iri(`${W}#book`) },
      { s: `${W}#clerk`, p: `${WF}produces`, o: iri(`${W}#verified`) },
      { s: `${W}#clerk`, p: `${WF}itemSchema`, o: text('{"type":"object","required":["who"],"properties":{"quote":{"type":"string"},"who":{"type":"string"}}}') },
      { s: `${W}#margin`, p: RDF_TYPE, o: iri(`${WF}Destination`) },
      { s: `${W}#margin`, p: `${WF}label`, o: text("The book's margin") },
      { s: `${W}#margin`, p: `${WF}kind`, o: text('margin') },
      { s: `${W}#margin`, p: `${WF}receives`, o: iri(`${W}#verified`) },
    ]
    expect(() => compileGraphPlan(triples)).toThrow(GraphPlanError)
    const sketch = sketchGraphPlan(triples)
    expect(sketch.title).toBe('Sleepers, catalogued')
    expect(sketch.sources.map((s) => [s.id, s.documentId])).toEqual([['book', 'doc-freud']])
    expect(sketch.steps.map((s) => [s.id, s.mode, s.over, s.reads, s.produces])).toEqual([
      ['clerk', 'perItem', `${W}#passages`, [`${W}#book`], `${W}#verified`],
    ])
    expect(sketch.steps[0]!.itemSchema?.required).toEqual(['who'])
    expect(sketch.destinations.map((d) => [d.id, d.kind, d.receives])).toEqual([['margin', 'margin', `${W}#verified`]])
  })
})
