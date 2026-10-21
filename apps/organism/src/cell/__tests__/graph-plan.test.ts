import { describe, expect, it } from 'vitest'
import { agentRuns, compileGraphPlan, composedNote, findingCommentId, GraphPlanError, graphPlanDigest, publishableFindings, sketchGraphPlan, stepTallies, type Triple, triplesFromSparqlResult, WF } from '../graph-plan.js'
import fixture from './fixtures/graph-plan-freud-ch1.sparql.json'
import appRunEvents from './fixtures/graph-plan-run-events-20261020.json'
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

  it('reaches Choreograph\'s digest for a plan that names its source and its destination (2026-10-19)', async () => {
    const plan = compileGraphPlan([...triplesFromSparqlResult(FIXTURE), ...extra])
    expect(plan.sources?.map((s) => s.id)).toEqual(['book'])
    expect(plan.destinations?.map((d) => [d.id, d.receives])).toEqual([['margin', `${W}#verified`]])
    expect(await graphPlanDigest(plan)).toBe('sha256:e0f63e28e36771e32eb181a178e8b8b96021dd20b84cbce7c5440c38df83546a')
  })

  // Typed items (2026-10-20, plans/2026-10-20-typed-objects §4): the same plan with its clerk bound to a class, as
  // workflow_plan_compose writes it. Choreograph's own test pins this digest too (choreograph src/test/graph-plan.test.ts).
  const DREAM_REPORT = 'urn:sophia:type:freud-dreams:workspace#DreamReport'
  const classBound: Triple[] = [
    { s: `${W}#clerk`, p: `${WF}itemClass`, o: iri(DREAM_REPORT) },
    { s: `${W}#clerk`, p: `${WF}itemVocab`, o: text('workspace@1') },
  ]

  it('reaches Choreograph\'s digest for a plan with a class-bound step, and carries the class only where it is named', async () => {
    const plan = compileGraphPlan([...triplesFromSparqlResult(FIXTURE), ...extra, ...classBound])
    const steps = plan.phases.flatMap((p) => p.steps)
    expect(steps.map((s) => [s.id, s.itemClass, s.itemVocab])).toEqual([
      ['reader', undefined, undefined],
      ['clerk', DREAM_REPORT, 'workspace@1'],
      ['censor', undefined, undefined],
    ])
    expect(steps.filter((s) => 'itemClass' in s || 'itemVocab' in s).map((s) => s.id)).toEqual(['clerk'])
    expect(await graphPlanDigest(plan)).toBe('sha256:0f3d4c27f1df880a97607426131228ca4c3335869a4ba8bc0a6f2d9bc89a69eb')
  })

  it('refuses a half-named class in the words Choreograph uses', () => {
    let problems: readonly string[] = []
    try {
      compileGraphPlan([
        ...triplesFromSparqlResult(FIXTURE),
        { s: `${W}#clerk`, p: `${WF}itemClass`, o: text('DreamReport') },
        { s: `${W}#clerk`, p: `${WF}itemVocab`, o: text('workspace') },
        { s: `${W}#reader`, p: `${WF}itemClass`, o: iri(DREAM_REPORT) },
      ])
    } catch (error) {
      if (!(error instanceof GraphPlanError)) throw error
      problems = error.problems
    }
    expect(problems).toEqual(expect.arrayContaining([
      'clerk\'s wf:itemClass must be an IRI, not "DreamReport"',
      'clerk\'s wf:itemVocab is "workspace"; write it as <vocab>@<version>',
      'reader names a class (wf:itemClass) but not the vocabulary version that pins it (wf:itemVocab)',
    ]))
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
      { s: `${W}#clerk`, p: `${WF}itemClass`, o: iri('urn:sophia:type:doc-sleepers:workspace#DreamReport') },
      { s: `${W}#clerk`, p: `${WF}itemVocab`, o: text('workspace@2') },
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
    expect([sketch.steps[0]!.itemClass, sketch.steps[0]!.itemVocab]).toEqual(['urn:sophia:type:doc-sleepers:workspace#DreamReport', 'workspace@2'])
    const untyped = sketchGraphPlan(triples.filter((t) => t.p !== `${WF}itemClass` && t.p !== `${WF}itemVocab`))
    expect([untyped.steps[0]!.itemClass, untyped.steps[0]!.itemVocab]).toEqual([null, null])
    expect(sketch.destinations.map((d) => [d.id, d.kind, d.receives])).toEqual([['margin', 'margin', `${W}#verified`]])
  })
})

// A real run in Sophia.app (2026-10-20): the cutter, two clerks, and two checks, one of which lost its model call and
// passed when it was asked again.
describe('each agent of a run, for the full view of a person', () => {
  const agents = agentRuns(appRunEvents)
  const byLabel = new Map(agents.map((agent) => [agent.label, agent]))

  it('is one agent per item, and an agent asked again is the same agent', () => {
    expect(agents.map((a) => a.label)).toEqual(['Passage cutter', 'Experiment clerk #2', 'Experiment clerk #3', 'Exact-quote checker #1', 'Exact-quote checker #5'])
    expect(agents.map((a) => [a.step, a.n])).toEqual([
      ['Passage cutter', null], ['Experiment clerk', 2], ['Experiment clerk', 3], ['Exact-quote checker', 1], ['Exact-quote checker', 5],
    ])
  })

  it('says what each did: its model, its tools in order, its time, what it handed back', () => {
    const cutter = byLabel.get('Passage cutter')!
    expect(cutter.state).toBe('done')
    expect(cutter.model).toBe('google/gemini-2.5-flash')
    expect(cutter.tools.map((t) => t.gate)).toEqual(['read_blocks', 'read_blocks', 'submit'])
    expect(cutter.endedAt! - cutter.startedAt!).toBeGreaterThan(0)
    expect((cutter.output as { items: unknown[] }).items.length).toBeGreaterThan(20)
    const clerk = byLabel.get('Experiment clerk #3')!
    expect((clerk.output as { items: { quote: string }[] }).items[0]!.quote).toMatch(/blankets slips off at night/)
  })

  it('keeps the last word of an agent that failed and was asked again, and its first failure stays readable', () => {
    const retried = byLabel.get('Exact-quote checker #5')!
    expect(retried).toMatchObject({ state: 'done', attempts: 2, error: null, output: { ok: true } })
    expect(retried.tools.map((t) => t.gate)).toEqual(['read_blocks', 'submit'])
    const failed = agentRuns(appRunEvents.filter((e) => !String(e.label).endsWith('#5 again')))
    expect(failed.find((a) => a.label === 'Exact-quote checker #5')).toMatchObject({ state: 'failed', attempts: 1, error: 'Connection error.' })
  })
})
