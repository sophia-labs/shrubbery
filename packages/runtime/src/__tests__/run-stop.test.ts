/**
 * Stop (2026-10-21): while a run is in hand, the Run pill and the inspector offer Stop, which asks Choreograph to end
 * the run's sittings (POST /api/workflows/runs/:runId/stop); until it says `stopped`, both say Stopping and offer
 * nothing more. A finished run offers no Stop. (Vera's first real typed run sat in `running` for fifteen minutes with
 * no way to end it.)
 */

import { render } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWorkflowPlan, type WorkflowPlanOptions, type WorkflowPlanStepView } from '../render-workspace.js'
import '../workflow-inspector.js'

const STEPS: WorkflowPlanStepView[] = [
  { id: 'clerk', label: 'the Clerk', job: 'extractor', mode: 'perItem', over: 'paragraphs', produces: 'reports', instructions: '…',
    progress: { started: 26, done: 21, failed: 1 } },
]

function plan(status: string, stops: string[]): WorkflowPlanOptions {
  return {
    title: 'Sleepers, as Dream reports', definition: 'urn:sophia:wf:doc-sleepers:draft', status: 'ready', digest: 'sha256:0123456789abcdef0123',
    steps: STEPS, run: { id: 'wfr-test', status }, onRun: () => stops.push('run'), onStop: () => stops.push('stop'),
  }
}

function pill(status: string, stops: string[]): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  render(renderWorkflowPlan(plan(status, stops)), host)
  return host.querySelector('.wfp-pill') as HTMLElement
}

async function inspector(status: string, stops: string[]): Promise<ShadowRoot> {
  const el = document.createElement('sh-workflow-inspector') as HTMLElement & { plan: WorkflowPlanOptions; updateComplete: Promise<boolean> }
  el.plan = plan(status, stops)
  document.body.append(el)
  await el.updateComplete
  return el.shadowRoot!
}

const buttons = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => ({ el: b, words: b.textContent!.trim(), disabled: b.disabled }))

afterEach(() => document.body.replaceChildren())

describe('the Run pill', () => {
  it('offers Stop while the run is in hand, and Stop asks to stop it', () => {
    const stops: string[] = []
    const root = pill('running', stops)
    const stop = buttons(root).find((b) => b.words === 'Stop')
    expect(stop, root.textContent!).toBeDefined()
    expect(stop!.disabled).toBe(false)
    stop!.el.click()
    expect(stops).toEqual(['stop'])
    expect(buttons(root).find((b) => b.words === 'Running')?.disabled).toBe(true)
  })

  it('says Stopping and offers nothing more until the run has stopped', () => {
    const root = pill('stopping', [])
    expect(root.querySelector('.words')!.textContent).toBe('Stopping…')
    expect(buttons(root).find((b) => b.words === 'Stopping…')?.disabled).toBe(true)
    expect(buttons(root).find((b) => b.words === 'Running')?.disabled).toBe(true)
  })

  it('offers no Stop once the run has stopped, and says so', () => {
    const root = pill('stopped', [])
    expect(buttons(root).map((b) => b.words)).not.toContain('Stop')
    expect(root.querySelector('.words')!.textContent).toBe('Stopped')
    expect(buttons(root).find((b) => b.words === 'Run again')?.disabled).toBe(false)
  })
})

describe('the inspector', () => {
  it('offers Stop this run while the run is in hand', async () => {
    const stops: string[] = []
    const root = await inspector('running', stops)
    const stop = buttons(root).find((b) => b.words === 'Stop this run')
    expect(stop, root.textContent!).toBeDefined()
    stop!.el.click()
    expect(stops).toEqual(['stop'])
  })

  it('says Stopping now while Choreograph ends the sittings, and It stopped after', async () => {
    const stopping = await inspector('stopping', [])
    expect(stopping.textContent!.replace(/\s+/g, ' ')).toContain('Stopping now.')
    expect(buttons(stopping).find((b) => b.words === 'Stopping…')?.disabled).toBe(true)
    document.body.replaceChildren()
    const stopped = await inspector('stopped', [])
    expect(stopped.textContent!.replace(/\s+/g, ' ')).toContain('It stopped.')
    expect(buttons(stopped).map((b) => b.words)).not.toContain('Stop this run')
  })
})
