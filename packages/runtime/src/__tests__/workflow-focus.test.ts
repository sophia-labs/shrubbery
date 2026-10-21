import { describe, expect, it } from 'vitest'
import type { WorkflowAgentRunView, WorkflowFocus, WorkflowPlanOptions, WorkflowPlanStepView } from '../render-workspace.js'
import { spanWords, verdictOf } from '../workflow-focus.js'
import '../workflow-focus.js'

// The Freud workflow after a run (2026-10-20, as Sophia.app ran it): the Cutter cut chapter I into passages, a Clerk
// worked each passage, the Censor checked each candidate. Two clerks and two checks are shown, one check refused.
const step = (s: Partial<WorkflowPlanStepView> & Pick<WorkflowPlanStepView, 'id' | 'label'>): WorkflowPlanStepView => ({
  job: 'agent', mode: 'once', instructions: '…', ...s,
})
const passages = [{ text: 'I. The External Sensory Stimuli.' }, { text: 'There are a great many stimuli of such nature.' }, { text: 'When one of our blankets slips off at night…' }]
const blanket = { who: 'dreamer', quote: 'When one of our blankets slips off at night we may dream that we are walking about naked.', documentId: 'doc-freud', blockId: 'block-c01fe85b' }
const thunder = { who: 'Jessen', quote: 'the rolling of thunder takes us into the thick of battle', documentId: 'doc-freud' }
const agent = (a: Partial<WorkflowAgentRunView> & Pick<WorkflowAgentRunView, 'label' | 'step'>): WorkflowAgentRunView => ({
  n: null, state: 'done', attempts: 1, queuedAt: 1_000, startedAt: 1_400, endedAt: 5_500, model: 'google/gemini-2.5-flash',
  turns: 2, tokens: 3544, tools: [], output: null, error: null, ...a,
})
const AGENTS: WorkflowAgentRunView[] = [
  agent({ label: 'Experiment Clerk #2', step: 'Experiment Clerk', n: 2, state: 'failed', error: 'Connection error.', tokens: 0 }),
  agent({
    label: 'Experiment Clerk #3', step: 'Experiment Clerk', n: 3, output: { items: [blanket] },
    tools: [{ gate: 'read_blocks', args: { documentId: 'doc-freud', blockId: 'block-c01fe85b' }, at: 2_000 }, { gate: 'submit', args: {}, at: 5_000 }],
  }),
  agent({ label: 'Quote Censor #1', step: 'Quote Censor', n: 1, output: { ok: true } }),
  agent({ label: 'Quote Censor #2', step: 'Quote Censor', n: 2, output: { ok: false, reason: 'Not in the text.', nearest: 'the rolling of thunder' }, attempts: 2 }),
]

function plan(focus: WorkflowFocus | null, calls: (WorkflowFocus | null)[]): WorkflowPlanOptions {
  return {
    title: 'Sleepers, from the app',
    definition: 'urn:sophia:wf:doc-sleepers:draft',
    status: 'ready',
    sources: [{ id: 'book', label: 'Chapter I', documentId: 'doc-freud', documentTitle: 'The Interpretation of Dreams' }],
    steps: [
      step({ id: 'cutter', label: 'Passage Cutter', reads: ['book'], produces: 'passages' }),
      step({ id: 'clerk', label: 'Experiment Clerk', mode: 'perItem', over: 'passages', produces: 'candidates', instructions: 'Find each sleep experiment in the passage.' }),
      step({ id: 'censor', label: 'Quote Censor', mode: 'perItem', checks: 'candidates', produces: 'verified' }),
    ],
    stacks: [
      { id: 'passages', producer: 'cutter', fields: ['text'], items: passages },
      { id: 'candidates', producer: 'clerk', fields: ['who', 'quote'], items: [blanket, thunder] },
      { id: 'verified', producer: 'censor', fields: ['who', 'quote'], items: [blanket] },
    ],
    refused: [{ step: 'censor', item: thunder, why: 'Not in the text. Nearest: the rolling of thunder' }],
    documentTitles: { 'doc-freud': 'The Interpretation of Dreams' },
    agents: AGENTS,
    focus,
    onFocus: (f) => calls.push(f),
  }
}

async function mount(focus: WorkflowFocus | null) {
  const calls: (WorkflowFocus | null)[] = []
  const el = document.createElement('sh-workflow-focus') as HTMLElement & { plan: WorkflowPlanOptions; updateComplete: Promise<boolean> }
  el.plan = plan(focus, calls)
  document.body.append(el)
  await el.updateComplete
  const root = el.shadowRoot!
  const key = (k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }))
  return { el, root, calls, key, text: () => root.textContent!.replace(/\s+/g, ' ') }
}

describe('a part of a workflow, full size', () => {
  it('shows a person: the way back, their brief, and one row per agent with what it was given and what it handed on', async () => {
    const { root, text } = await mount({ key: 'step:clerk' })
    expect([...root.querySelectorAll('.crumbs button, .crumbs .here')].map((n) => n.textContent!.trim())).toEqual(['Sleepers, from the app', 'Experiment Clerk'])
    expect(text()).toContain('Find each sleep experiment in the passage.')
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.trim()))
    expect(rows).toEqual([
      ['', '2', 'There are a great many stimuli of such nature.', 'Failed: Connection error.', '4.1 s', ''],
      ['', '3', 'When one of our blankets slips off at night…', '1 candidate', '4.1 s', '3,544'],
    ])
  })

  it('goes down to an agent on a click, and climbs back with Esc, one level at a time', async () => {
    const person = await mount({ key: 'step:clerk' })
    ;(person.root.querySelectorAll('tbody tr')[1] as HTMLElement).click()
    person.key('Escape')
    expect(person.calls).toEqual([{ key: 'step:clerk', item: 3 }, null])

    const one = await mount({ key: 'step:clerk', item: 3 })
    expect(one.text()).toContain('read_blocks')
    expect(one.text()).toContain('block-c01fe85b in The Interpretation of Dreams')
    expect(one.text()).toContain('naked')
    one.key('ArrowLeft')
    one.key('Escape')
    expect(one.calls).toEqual([{ key: 'step:clerk', item: 2 }, { key: 'step:clerk' }])
  })

  it('shows a check’s verdict, refused with its reason, and that it was asked twice', async () => {
    const { text } = await mount({ key: 'step:censor', item: 2 })
    expect(text()).toContain('Refused')
    expect(text()).toContain('Not in the text. Nearest: the rolling of thunder')
    expect(text()).toContain('asked 2 times')
  })

  it('shows a stack as a table to filter, and an item with its path: who made it, who checked it', async () => {
    const stack = await mount({ key: 'stack:candidates' })
    expect(stack.root.querySelectorAll('tbody tr')).toHaveLength(2)
    const input = stack.root.querySelector('input[type=search]') as HTMLInputElement
    input.value = 'thunder'
    input.dispatchEvent(new Event('input'))
    await stack.el.updateComplete
    expect(stack.root.querySelectorAll('tbody tr')).toHaveLength(1)

    const item = await mount({ key: 'stack:candidates', item: 1 })
    const path = [...item.root.querySelectorAll('.lineage .row')].map((row) => row.textContent!.replace(/\s+/g, ' ').trim())
    expect(path).toEqual(['Made by Experiment Clerk #3', 'Checked by Quote Censor #1'])
  })

  it('says spans and verdicts as a person reads them', () => {
    expect([spanWords(840), spanWords(4100), spanWords(125_000), spanWords(null)]).toEqual(['840 ms', '4.1 s', '2 min 5 s', ''])
    expect(verdictOf({ ok: false, reason: 'Not in the text.' })).toEqual({ passed: false, why: 'Not in the text.' })
    expect(verdictOf({ items: [] })).toBeNull()
  })
})
