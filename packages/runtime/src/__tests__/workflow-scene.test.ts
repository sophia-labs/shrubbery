import { loadDefaultEngine, moveCards, type Rect } from '@shrubbery/nucleus/files-canvas'
import { describe, expect, it } from 'vitest'
import type { WorkflowPlanOptions, WorkflowPlanStepView } from '../render-workspace.js'
import { humanName, placeNode, stepRunState, workflowCanvasModel } from '../workflow-scene.js'

// The Freud plan as the pane derives it (2026-10-19): it reads chapter I of the imported book, the Cutter cuts it into
// passages, a Clerk works through each, the Censor checks each candidate, and the verified entries go to the book's
// margin. Mid-run: the Cutter done, the Clerks half way, nothing checked yet.
const step = (s: Partial<WorkflowPlanStepView> & Pick<WorkflowPlanStepView, 'id' | 'label'>): WorkflowPlanStepView => ({
  job: 'agent',
  mode: 'once',
  instructions: '…',
  ...s,
})

const PLAN: WorkflowPlanOptions = {
  title: 'Sleepers, catalogued',
  definition: 'urn:sophia:wf:doc-sleepers:draft',
  status: 'ready',
  sources: [{ id: 'book', label: 'Chapter I, section C', documentId: 'doc-freud', documentTitle: 'The Interpretation of Dreams', fromBlock: 'block-be1fe535' }],
  steps: [
    step({ id: 'cutter', label: 'Passage Cutter', reads: ['book'], produces: 'passages', progress: { started: 1, done: 1, failed: 0 } }),
    step({ id: 'clerk', label: 'Experiment Clerk', mode: 'perItem', over: 'passages', produces: 'candidates', progress: { started: 26, done: 12, failed: 1 } }),
    step({ id: 'censor', label: 'Quote Censor', mode: 'perItem', over: 'candidates', checks: 'candidates', produces: 'verified' }),
  ],
  stacks: [
    { id: 'passages', producer: 'cutter', fields: ['text', 'blockId'] },
    { id: 'candidates', producer: 'clerk', fields: ['who', 'quote'] },
    { id: 'verified', producer: 'censor', fields: ['who', 'quote', 'note'] },
  ],
  destinations: [{ id: 'margin', label: "The book's margin", kind: 'margin', receives: 'verified', documentId: 'doc-freud' }],
}

const onEdge = (p: { x: number; y: number }, r: Rect): boolean =>
  (Math.abs(p.x - r.x) < 1 || Math.abs(p.x - (r.x + r.w)) < 1 || Math.abs(p.y - r.y) < 1 || Math.abs(p.y - (r.y + r.h)) < 1) &&
  p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1

describe('a workflow as a canvas of what it is made of', () => {
  it('draws the source, the people, the stacks between them, the check and the destination, in the order of the flow', () => {
    const model = workflowCanvasModel(PLAN)
    const left = (key: string) => model.snapshot.byKey.get(key)!.rect.x
    const order = ['source:book', 'step:cutter', 'stack:passages', 'step:clerk', 'stack:candidates', 'step:censor', 'stack:verified', 'destination:margin']
    expect([...model.nodes.keys()].sort()).toEqual([...order].sort())
    for (let i = 1; i < order.length; i += 1) expect(left(order[i]!), `${order[i]} after ${order[i - 1]}`).toBeGreaterThan(left(order[i - 1]!))
    expect(model.nodes.get('step:censor')!.kind).toBe('check')
    expect(model.snapshot.connectors.map((c) => [c.id, c.label])).toEqual([
      ['source:book->step:cutter', ''],
      ['step:cutter->stack:passages', ''],
      ['stack:passages->step:clerk', 'each'],
      ['step:clerk->stack:candidates', ''],
      ['stack:candidates->step:censor', 'each'],
      ['step:censor->stack:verified', ''],
      ['stack:verified->destination:margin', ''],
    ])
    expect([...model.gates]).toEqual(['stack:candidates->step:censor'])
  })

  it('carries a flow too wide for the pane on to a new line, as text does', () => {
    const one = workflowCanvasModel(PLAN)
    const wrapped = workflowCanvasModel(PLAN, {}, 800)
    const at = (model: typeof one, key: string) => model.snapshot.byKey.get(key)!.rect
    const right = Math.max(...wrapped.snapshot.cards.map((card) => card.rect.x + card.rect.w))
    expect(right).toBeLessThanOrEqual(800)
    expect(Math.max(...one.snapshot.cards.map((card) => card.rect.x + card.rect.w))).toBeGreaterThan(800)
    // The flow reads on: a later line starts back at the left, and the destination sits below the source.
    expect(at(wrapped, 'destination:margin').y).toBeGreaterThan(at(wrapped, 'source:book').y + at(wrapped, 'source:book').h)
    expect(at(wrapped, 'step:clerk').x).toBe(0)
    expect(at(wrapped, 'destination:margin').x).toBeGreaterThan(at(wrapped, 'stack:verified').x)
  })

  it('draws a stack even when nobody makes it yet, and a tray for what a check refused once it has refused something', () => {
    const unfinished: WorkflowPlanOptions = { ...PLAN, steps: [PLAN.steps[1]!], stacks: [], sources: [], destinations: [] }
    expect([...workflowCanvasModel(unfinished).nodes.keys()]).toEqual(['step:clerk', 'stack:passages', 'stack:candidates'])

    const afterRun: WorkflowPlanOptions = {
      ...PLAN,
      steps: PLAN.steps.map((s) => (s.id === 'censor' ? { ...s, verdicts: { passed: 31, refused: 2 } } : s)),
    }
    const model = workflowCanvasModel(afterRun)
    const tray = model.snapshot.byKey.get('refused:censor')!.rect
    const censor = model.snapshot.byKey.get('step:censor')!.rect
    expect(tray.y).toBeGreaterThan(censor.y + censor.h)
    expect([...model.refusals]).toEqual(['step:censor->refused:censor'])
  })

  it('reads each person’s run state from their tally', () => {
    expect(PLAN.steps.map(stepRunState)).toEqual(['done', 'running', 'idle'])
    expect(stepRunState(step({ id: 'x', label: 'x', progress: { started: 3, done: 2, failed: 1 } }))).toBe('done')
    expect(stepRunState(step({ id: 'x', label: 'x', progress: { started: 1, done: 0, failed: 1 } }))).toBe('failed')
    expect(humanName('verified_entries')).toBe('verified entries')
  })

  it('routes every wire with Excalidraw’s engine, headless, from node edge to node edge', async () => {
    const { engine, kind } = await loadDefaultEngine()
    expect(kind).toBe('excalidraw')
    const { snapshot } = workflowCanvasModel(PLAN)
    const routes = engine.route(snapshot, { pad: 4 })
    for (const c of snapshot.connectors) {
      const route = routes.get(c.id)
      expect(route, c.id).toBeDefined()
      expect(onEdge(route!.start.at, snapshot.byKey.get(c.from)!.rect), `${c.id} starts on ${c.from}`).toBe(true)
      expect(onEdge(route!.end.at, snapshot.byKey.get(c.to)!.rect), `${c.id} ends on ${c.to}`).toBe(true)
    }
    engine.dispose?.()
  })

  it('keeps the wires on a dragged node, and keeps only real moves in the layout', async () => {
    const { engine } = await loadDefaultEngine()
    const model = workflowCanvasModel(PLAN)
    const base = engine.route(model.snapshot, { pad: 4 })
    const moved = moveCards(model.snapshot, ['step:censor'], { x: 0, y: 160 })
    const routes = engine.reroute(moved, new Set(['step:censor']), base, { pad: 4 })
    const censor = moved.byKey.get('step:censor')!.rect
    expect(onEdge(routes.get('stack:candidates->step:censor')!.end.at, censor)).toBe(true)
    expect(onEdge(routes.get('step:censor->stack:verified')!.start.at, censor)).toBe(true)
    engine.dispose?.()

    const layout = placeNode({}, model, 'step:censor', { x: censor.x, y: censor.y })
    expect(Object.keys(layout)).toEqual(['step:censor'])
    expect(workflowCanvasModel(PLAN, layout).snapshot.byKey.get('step:censor')!.rect.y).toBe(censor.y)
    const home = model.derived.get('step:censor')!
    expect(placeNode(layout, model, 'step:censor', home)).toEqual({})
  })
})
