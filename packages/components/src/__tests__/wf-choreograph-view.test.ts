/**
 * REAL component test - wf-choreograph-view controlled Choreograph surface.
 *
 * The element renders caller-owned history/provenance/telemetry snapshots and
 * emits composed intents. It does not fetch run lists, subscribe to stores, or
 * connect to telemetry by itself.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../wf-choreograph-view.js'
import type {
  WfChoreographView,
  WfMissionControl,
  WfGraphIntentDetail,
  WfNodeToggleDetail,
  WfRunConnectDetail,
  WfRunDetail,
} from '../wf-choreograph-view.js'

async function mount(setup?: (el: WfChoreographView) => void): Promise<WfChoreographView> {
  const el = document.createElement('wf-choreograph-view') as WfChoreographView
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: WfChoreographView) => el.shadowRoot!

describe('wf-choreograph-view - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('wf-choreograph-view')).toBeDefined()
    expect(customElements.get('wf-mission-control')).toBeDefined()
  })

  it('registers wf-mission-control as the Garden compatibility alias', async () => {
    const el = document.createElement('wf-mission-control') as WfMissionControl
    el.mode = 'history'
    el.status = 'empty'
    document.body.appendChild(el)
    await el.updateComplete

    const empty = sr(el).querySelector('mn-empty-state')
    expect(empty?.getAttribute('title')).toBe('No runs yet')
  })

  it('renders controlled run history and emits run selection', async () => {
    const el = await mount((node) => {
      node.mode = 'history'
      node.status = 'ready'
      node.history = [
        { runId: 'run-a', workflowName: 'Draft review', status: 'finished', startedAt: '2026-06-23T14:00:00Z', durationMs: 1200 },
        { runId: 'run-b', workflowName: 'Gate check', status: 'failed', startedAt: '2026-06-23T14:10:00Z', durationMs: 2500 },
      ]
    })
    const selections: WfRunDetail[] = []
    el.addEventListener('choreo-run-select', (event) => {
      selections.push((event as CustomEvent<WfRunDetail>).detail)
    })

    const rows = Array.from(sr(el).querySelectorAll('.history-row'))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('run-a')
    ;(rows[0] as HTMLElement).click()

    expect(selections).toEqual([{ runId: 'run-a' }])
  })

  it('emits refresh with the controlled graph id', async () => {
    const el = await mount((node) => {
      node.mode = 'history'
      node.graphId = 'graph-a'
      node.status = 'empty'
    })
    const refreshes: WfGraphIntentDetail[] = []
    el.addEventListener('choreo-refresh', (event) => {
      refreshes.push((event as CustomEvent<WfGraphIntentDetail>).detail)
    })

    ;(sr(el).querySelector('[aria-label="Refresh workflow runs"]') as HTMLButtonElement).click()

    expect(refreshes).toEqual([{ graphId: 'graph-a' }])
    expect(sr(el).querySelector('.subtitle')?.textContent).toContain('graph-a')
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('description')).toContain('graph-a')
  })

  it('emits manual run-connect without owning lookup work', async () => {
    const el = await mount((node) => {
      node.mode = 'monitor'
      node.graphId = 'graph-a'
    })
    const connects: WfRunConnectDetail[] = []
    el.addEventListener('choreo-run-connect', (event) => {
      connects.push((event as CustomEvent<WfRunConnectDetail>).detail)
    })

    const input = sr(el).querySelector('.run-input') as HTMLInputElement
    input.value = 'run-manual'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete
    ;(sr(el).querySelector('.run-picker button') as HTMLButtonElement).click()

    expect(connects).toEqual([{ graphId: 'graph-a', runId: 'run-manual' }])
  })

  it('renders provenance and telemetry and emits replay/node-toggle intents', async () => {
    const el = await mount((node) => {
      node.mode = 'monitor'
      node.runId = 'run-a'
      node.status = 'ready'
      node.provenance = {
        runId: 'run-a',
        workflowName: 'Draft review',
        status: 'running',
        agentRuns: [{ id: 'agent-1', label: 'Reviewer', status: 'finished', durationMs: 900, resultRef: 'doc:review' }],
      }
      node.telemetry = {
        runId: 'run-a',
        workflowName: 'Draft review',
        status: 'running',
        phases: [
          {
            phaseIndex: 0,
            label: 'Review',
            status: 'active',
            nodes: [{ id: 'node-1', label: 'Reviewer', status: 'running', outputFragment: 'Checking evidence.' }],
          },
        ],
      }
    })
    const replays: WfRunDetail[] = []
    const toggles: WfNodeToggleDetail[] = []
    el.addEventListener('choreo-replay', (event) => {
      replays.push((event as CustomEvent<WfRunDetail>).detail)
    })
    el.addEventListener('choreo-node-toggle', (event) => {
      toggles.push((event as CustomEvent<WfNodeToggleDetail>).detail)
    })

    const replay = Array.from(sr(el).querySelectorAll('button')).find((button) => button.textContent?.includes('Replay')) as HTMLButtonElement
    replay.click()
    ;(sr(el).querySelector('.node-summary') as HTMLButtonElement).click()
    await el.updateComplete

    expect(replays).toEqual([{ runId: 'run-a' }])
    expect(toggles).toEqual([{ runId: 'run-a', phaseIndex: 0, nodeId: 'node-1', expanded: true }])
    expect(sr(el).querySelector('.node-summary')?.getAttribute('aria-expanded')).toBe('true')
    expect(sr(el).querySelector('.pre')?.textContent).toContain('Checking evidence.')
  })
})
