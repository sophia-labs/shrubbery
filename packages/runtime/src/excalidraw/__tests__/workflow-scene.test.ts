import { describe, expect, it } from 'vitest'
import type { WorkflowPlanOptions, WorkflowPlanStepView } from '../../render-workspace.js'
import { routeArrows, type WorkflowSceneSkeleton, workflowPlanScene } from '../workflow-scene.js'

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

const byId = (scene: readonly WorkflowSceneSkeleton[]) => new Map(scene.map((el) => [el.id, el as Record<string, unknown>]))

describe('the workflow plan as an Excalidraw scene', () => {
  it('draws a lane per phase and a card per step, with ids stable per step', () => {
    const scene = byId(workflowPlanScene(PLAN))
    expect([...scene.keys()].filter((id) => id.startsWith('wf-lane-') && !id.includes('title'))).toEqual(['wf-lane-0', 'wf-lane-1', 'wf-lane-2', 'wf-lane-3'])
    expect([...scene.keys()].filter((id) => id.startsWith('wf-step-'))).toEqual(['wf-step-reader', 'wf-step-clerk', 'wf-step-censor', 'wf-step-cataloguer'])
    expect(scene.get('wf-lane-title-3')?.text).toBe('4 · Secondary revision')
  })

  it('colours each card by its run state and rings what an agent just changed', () => {
    const scene = byId(workflowPlanScene(PLAN))
    expect(scene.get('wf-step-reader')?.backgroundColor).toBe('#d3f9d8')
    expect(scene.get('wf-step-clerk')?.backgroundColor).toBe('#fff3bf')
    expect((scene.get('wf-step-clerk')?.label as { text: string } | undefined)?.text).toContain('6 done · 5 running')
    expect(scene.get('wf-step-censor')?.backgroundColor).toBe('#ffffff')
    expect(scene.get('wf-step-cataloguer')?.strokeWidth).toBe(3)
  })

  it('draws one arrow per collection a step reads, the gate dashed', () => {
    const arrows = workflowPlanScene(PLAN).filter((el) => el.type === 'arrow') as Record<string, unknown>[]
    expect(arrows.map((a) => a.id)).toEqual([
      'wf-edge-reader-clerk-passages',
      'wf-edge-clerk-censor-candidates',
      'wf-edge-censor-cataloguer-verified',
    ])
    expect(arrows.map((a) => a.strokeStyle)).toEqual(['solid', 'dashed', 'solid'])
  })

  it('routes each arrow between the cards as placed, so a moved card keeps its arrows', () => {
    const scene = workflowPlanScene(PLAN)
    const moved = scene.map((el) => (el.id === 'wf-step-censor' ? { ...el, y: 400 } : el))
    const edge = byId(routeArrows(moved)).get('wf-edge-clerk-censor-candidates') as { x: number; y: number; points: number[][] }
    const clerk = byId(moved).get('wf-step-clerk') as { x: number; y: number; width: number; height: number }
    const censor = byId(moved).get('wf-step-censor') as { x: number; y: number; height: number }
    expect([edge.x, edge.y]).toEqual([clerk.x + clerk.width, clerk.y + clerk.height / 2])
    expect(edge.points[1]).toEqual([censor.x - edge.x, censor.y + censor.height / 2 - edge.y])
  })
})
