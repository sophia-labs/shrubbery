/**
 * REAL component test - wf-studio-shell controlled Choreograph app shell.
 *
 * The shell is a pure screen router. It coordinates child surfaces and emits
 * navigation intents, but it does not read session stores or workflow clients.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../wf-studio-shell.js'
import type { WfChoreographView, WfRunDetail } from '../wf-choreograph-view.js'
import type {
  WfGateChangeDetail,
  WfRunCompareDetail,
  WfStudioScreenChangeDetail,
  WfStudioShell,
  WfWorkflowLaunchDetail,
  WfWorkflowRequestDetail,
} from '../wf-studio-shell.js'

async function mount(setup?: (el: WfStudioShell) => void): Promise<WfStudioShell> {
  const el = document.createElement('wf-studio-shell') as WfStudioShell
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: WfStudioShell) => el.shadowRoot!

describe('wf-studio-shell - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('wf-studio-shell')).toBeDefined()
  })

  it('renders the history child for home/runs with controlled props', async () => {
    const runs = [{ runId: 'run-a', workflowName: 'Draft review', status: 'finished' }]
    const el = await mount((node) => {
      node.screen = 'home'
      node.graphId = 'graph-a'
      node.historyStatus = 'ready'
      node.historyRuns = runs
    })

    const view = sr(el).querySelector('wf-choreograph-view') as WfChoreographView
    expect(view).not.toBeNull()
    expect(view.mode).toBe('history')
    expect(view.graphId).toBe('graph-a')
    expect(view.history).toBe(runs)
  })

  it('opens selected runs locally and emits a screen-change intent', async () => {
    const el = await mount((node) => {
      node.screen = 'runs'
      node.graphId = 'graph-a'
      node.historyStatus = 'ready'
      node.historyRuns = [{ runId: 'run-a' }]
    })
    const changes: WfStudioScreenChangeDetail[] = []
    el.addEventListener('choreo-screen-change', (event) => {
      changes.push((event as CustomEvent<WfStudioScreenChangeDetail>).detail)
    })

    const child = sr(el).querySelector('wf-choreograph-view') as WfChoreographView
    child.dispatchEvent(new CustomEvent<WfRunDetail>('choreo-run-select', {
      bubbles: true,
      composed: true,
      detail: { runId: 'run-a' },
    }))
    await el.updateComplete

    const monitor = sr(el).querySelector('wf-choreograph-view') as WfChoreographView
    expect(changes).toEqual([{ screen: 'run', graphId: 'graph-a', runId: 'run-a' }])
    expect(monitor.mode).toBe('monitor')
    expect(monitor.runId).toBe('run-a')
  })

  it('validates and emits an exact workflow launch intent from the real form', async () => {
    const el = await mount((node) => {
      node.screen = 'launch'
      node.graphId = 'research-graph'
      node.workflowStatus = 'ready'
      node.workflows = [{
        name: 'survey-synthesize',
        description: 'Survey graph documents and synthesize an answer.',
        phases: [{ title: 'map' }, { title: 'synthesize' }],
      }]
    })
    const launches: WfWorkflowLaunchDetail[] = []
    el.addEventListener('choreo-workflow-launch', (event) => {
      launches.push((event as CustomEvent<WfWorkflowLaunchDetail>).detail)
    })

    const textarea = sr(el).querySelector('textarea[name="inputs"]') as HTMLTextAreaElement
    textarea.value = '{broken'
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    ;(sr(el).querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelector('[role="alert"]')?.textContent).toContain('valid JSON')
    expect(launches).toEqual([])

    textarea.value = '{"question":"What changed?","k":4}'
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    ;(sr(el).querySelector('button[type="submit"]') as HTMLButtonElement).click()
    await el.updateComplete

    expect(launches).toEqual([{
      graphId: 'research-graph',
      workflowName: 'survey-synthesize',
      inputs: { question: 'What changed?', k: 4 },
    }])
    expect(sr(el).textContent).toContain('map → synthesize')
  })

  it('renders phase/node anatomy and requests a new definition from workflow selection', async () => {
    const el = await mount((node) => {
      node.screen = 'anatomy'
      node.graphId = 'graph-a'
      node.workflows = [{ name: 'survey-synthesize' }, { name: 'browser-audit' }]
      node.anatomyStatus = 'ready'
      node.anatomy = {
        name: 'survey-synthesize',
        description: 'Parallel map, then a synthesis barrier.',
        phases: [
          {
            index: 1,
            title: 'map',
            detail: 'Survey in parallel.',
            nodes: [{
              id: 'map-doc',
              label: 'map:<doc>',
              agentType: 'graph-surveyor',
              model: 'mistralai/mistral-nemo',
              toolMode: 'curated',
              maxTurns: 4,
              gateIds: ['mnemosyne'],
            }],
          },
          { index: 2, title: 'synthesize', nodes: [] },
        ],
      }
    })
    const requests: WfWorkflowRequestDetail[] = []
    el.addEventListener('choreo-anatomy-request', (event) => {
      requests.push((event as CustomEvent<WfWorkflowRequestDetail>).detail)
    })

    expect(sr(el).querySelectorAll('.phase-card')).toHaveLength(2)
    expect(sr(el).querySelector('[data-node-id="map-doc"]')?.textContent).toContain('graph-surveyor')
    expect(sr(el).querySelector('[data-node-id="map-doc"]')?.textContent).toContain('mnemosyne')
    expect(sr(el).textContent).toContain('does not expose agent-node detail')

    const picker = sr(el).querySelector('select[aria-label="Workflow anatomy"]') as HTMLSelectElement
    picker.value = 'browser-audit'
    picker.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    await el.updateComplete
    expect(requests).toEqual([{ graphId: 'graph-a', workflowName: 'browser-audit' }])
  })

  it('filters real gate rows and emits controlled enable/disable intents', async () => {
    const el = await mount((node) => {
      node.screen = 'gates'
      node.graphId = 'graph-a'
      node.selectedWorkflowName = 'browser-audit'
      node.workflows = [{ name: 'browser-audit' }]
      node.gatesStatus = 'ready'
      node.gates = [
        {
          id: 'subject',
          name: 'Subject browser',
          kind: 'capability',
          binding: 'subject.web',
          access: 'rw',
          enabled: true,
        },
        {
          id: 'done',
          name: 'Submit answer',
          kind: 'tool',
          binding: 'done',
          enabled: true,
          required: true,
        },
      ]
    })
    const changes: WfGateChangeDetail[] = []
    el.addEventListener('choreo-gate-change', (event) => {
      changes.push((event as CustomEvent<WfGateChangeDetail>).detail)
    })

    const subjectToggle = sr(el).querySelector('[data-gate-id="subject"] .gate-toggle') as HTMLInputElement
    subjectToggle.click()
    expect(changes).toEqual([{
      graphId: 'graph-a',
      workflowName: 'browser-audit',
      gateId: 'subject',
      enabled: false,
    }])

    const filter = sr(el).querySelector('select[aria-label="Gate kind"]') as HTMLSelectElement
    filter.value = 'tool'
    filter.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    await el.updateComplete
    expect(sr(el).querySelector('[data-gate-id="subject"]')).toBeNull()
    expect(sr(el).querySelector('[data-gate-id="done"]')?.textContent).toContain('required')
    expect((sr(el).querySelector('[data-gate-id="done"] .gate-toggle') as HTMLInputElement).disabled).toBe(true)
  })

  it('submits a run pair and renders a host-projected comparison table', async () => {
    const el = await mount((node) => {
      node.screen = 'compare'
      node.graphId = 'graph-a'
      node.historyRuns = [
        { runId: 'run-old', workflowName: 'survey-synthesize' },
        { runId: 'run-new', workflowName: 'survey-synthesize' },
      ]
      node.compareStatus = 'idle'
    })
    const comparisons: WfRunCompareDetail[] = []
    el.addEventListener('choreo-run-compare', (event) => {
      comparisons.push((event as CustomEvent<WfRunCompareDetail>).detail)
    })

    ;(sr(el).querySelector('button[type="submit"]') as HTMLButtonElement).click()
    expect(comparisons).toEqual([{
      graphId: 'graph-a',
      leftRunId: 'run-old',
      rightRunId: 'run-new',
    }])

    el.compareStatus = 'ready'
    el.comparison = {
      leftRunId: 'run-old',
      rightRunId: 'run-new',
      fields: [
        { label: 'Duration', left: '18s', right: '12s', delta: '-6s', verdict: 'better' },
        { label: 'Tokens', left: 4200, right: 5100, delta: '+900', verdict: 'worse' },
      ],
    }
    await el.updateComplete
    expect(sr(el).querySelectorAll('.compare-table tbody tr')).toHaveLength(2)
    expect(sr(el).querySelector('[data-field="Duration"]')?.textContent).toContain('-6s')
    expect(sr(el).querySelector('[data-field="Tokens"] .verdict')?.getAttribute('data-verdict')).toBe('worse')
  })

  it('exposes honest loading, error, and empty states instead of placeholder screens', async () => {
    const el = await mount((node) => {
      node.screen = 'launch'
      node.workflowStatus = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')?.getAttribute('text')).toBe('Loading workflow registry')

    el.screen = 'anatomy'
    el.anatomyStatus = 'error'
    el.anatomyError = 'Definition read failed'
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('Could not load anatomy')
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('description')).toBe('Definition read failed')

    el.screen = 'gates'
    el.gatesStatus = 'empty'
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No declared gates')

    el.screen = 'compare'
    el.compareStatus = 'idle'
    await el.updateComplete
    expect(sr(el).querySelector('form[aria-label="Compare workflow runs"]')).not.toBeNull()
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No comparison loaded')

    expect(sr(el).querySelector('wf-choreograph-view')).toBeNull()
  })
})
