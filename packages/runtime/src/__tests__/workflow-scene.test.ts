import { loadDefaultEngine, moveCards, type Rect } from '@shrubbery/nucleus/files-canvas'
import { describe, expect, it } from 'vitest'
import type { WorkflowPlanOptions, WorkflowPlanStepView } from '../render-workspace.js'
import { placeCard, stepRunState, workflowSceneModel } from '../workflow-scene.js'

// The four-phase Freud plan as the pane derived it on 2026-10-18 (the chapter I definition plus the Cataloguer an agent
// wrote into the draft), mid-run: the Reader done, the Clerks half way, nothing checked yet.
const step = (s: Partial<WorkflowPlanStepView> & Pick<WorkflowPlanStepView, 'id' | 'label'>): WorkflowPlanStepView => ({
  job: 'agent',
  mode: 'once',
  instructions: '…',
  ...s,
})

const PLAN: WorkflowPlanOptions = {
  title: 'Things done to sleepers, chapter I',
  definition: 'urn:sophia:wf:freud-ch1:draft',
  status: 'ready',
  phases: [
    { title: 'Day residue', steps: [step({ id: 'reader', label: 'the Reader', produces: 'passages', progress: { started: 1, done: 1, failed: 0 } })] },
    {
      title: 'Dream-work',
      steps: [step({ id: 'clerk', label: "the Experimenter's Clerk", mode: 'perItem', over: 'passages', produces: 'candidates', progress: { started: 11, done: 6, failed: 0 } })],
    },
    { title: 'The Censor', steps: [step({ id: 'censor', label: 'the Censor', mode: 'perItem', over: 'candidates', checks: 'candidates', produces: 'verified' })] },
    { title: 'Secondary revision', steps: [step({ id: 'cataloguer', label: 'the Cataloguer', consumes: ['verified'], produces: 'catalogue', changed: true })] },
  ],
}

const onEdge = (p: { x: number; y: number }, r: Rect): boolean =>
  (Math.abs(p.x - r.x) < 1 || Math.abs(p.x - (r.x + r.w)) < 1 || Math.abs(p.y - r.y) < 1 || Math.abs(p.y - (r.y + r.h)) < 1) &&
  p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1

describe('the workflow plan as a card plane', () => {
  it('derives a lane per phase, a card per step and a wire per collection read, the gate marked', () => {
    const model = workflowSceneModel(PLAN)
    expect(model.lanes.map((lane) => lane.title)).toEqual(['1 · Day residue', '2 · Dream-work', '3 · The Censor', '4 · Secondary revision'])
    expect(model.snapshot.cards.map((card) => card.key)).toEqual(['reader', 'clerk', 'censor', 'cataloguer'])
    expect(model.snapshot.connectors.map((c) => c.id)).toEqual(['reader->clerk:passages', 'clerk->censor:candidates', 'censor->cataloguer:verified'])
    expect([...model.gates]).toEqual(['clerk->censor:candidates'])
  })

  it('reads each step’s run state from its tally', () => {
    const states = PLAN.phases.flatMap((phase) => phase.steps.map(stepRunState))
    expect(states).toEqual(['done', 'running', 'idle', 'idle'])
    expect(stepRunState(step({ id: 'x', label: 'x', progress: { started: 3, done: 2, failed: 1 } }))).toBe('failed')
  })

  it('routes every wire with Excalidraw’s engine, headless, from card edge to card edge', async () => {
    const { engine, kind } = await loadDefaultEngine()
    expect(kind).toBe('excalidraw')
    const { snapshot } = workflowSceneModel(PLAN)
    const routes = engine.route(snapshot, { pad: 4 })
    for (const c of snapshot.connectors) {
      const route = routes.get(c.id)
      expect(route, c.id).toBeDefined()
      expect(onEdge(route!.start.at, snapshot.byKey.get(c.from)!.rect), `${c.id} starts on its producer`).toBe(true)
      expect(onEdge(route!.end.at, snapshot.byKey.get(c.to)!.rect), `${c.id} ends on its reader`).toBe(true)
    }
    engine.dispose?.()
  })

  it('keeps the wires on a dragged card, and keeps only real moves in the layout', async () => {
    const { engine } = await loadDefaultEngine()
    const model = workflowSceneModel(PLAN)
    const base = engine.route(model.snapshot, { pad: 4 })
    const moved = moveCards(model.snapshot, ['censor'], { x: 0, y: 160 })
    const routes = engine.reroute(moved, new Set(['censor']), base, { pad: 4 })
    const censor = moved.byKey.get('censor')!.rect
    expect(onEdge(routes.get('clerk->censor:candidates')!.end.at, censor)).toBe(true)
    expect(onEdge(routes.get('censor->cataloguer:verified')!.start.at, censor)).toBe(true)
    engine.dispose?.()

    const layout = placeCard({}, model, 'censor', { x: censor.x, y: censor.y })
    expect(Object.keys(layout)).toEqual(['censor'])
    expect(workflowSceneModel(PLAN, layout).snapshot.byKey.get('censor')!.rect.y).toBe(censor.y)
    const home = model.derived.get('censor')!
    expect(placeCard(layout, model, 'censor', home)).toEqual({})
  })
})
