/**
 * The cast on the workflow's surfaces (world-UX slice A): the focus page of a post is its being's page, the inspector
 * and the canvas wear the being's mark, the Cast lists the workflow's beings, and a typed object's "The being" is
 * someone (mark, name, a door to the post), never a raw IRI. The ids are the real beings of the run recorded in
 * Sophia.app on 2026-10-20 (two clerk sittings of one being, two quote-checker sittings of another).
 */

import { agentMark } from '@shrubbery/nucleus/kinds'
import { beingFaces, classCatalogFrom, findClassEntry, objectTriplesQuery, sparqlRows, triplesFromRows, typedObjectModel, typesOf } from '@shrubbery/nucleus/object-faces'
import { afterEach, describe, expect, it } from 'vitest'
import { beingDirectory } from '../being/being-directory.js'
import type { ShObjectView } from '../object-view/object-view-element.js'
import { OBJECT_VIEW_INTENT_EVENT, type ObjectViewIntent } from '../object-view/object-view-element.js'
import { AGENT, DREAM_REPORT, loadFixtures, queryRows, TYPED_ITEM, vocabFixture } from '../object-view/__tests__/typed-fixture-store.js'
import type { WorkflowAgentRunView, WorkflowFocus, WorkflowPlanOptions, WorkflowPlanStepView } from '../render-workspace.js'
import '../workflow-focus.js'
import '../workflow-inspector.js'

const CLERK = 'agent-62517a586738e5e9'
const CHECKER = 'agent-8e5db2cdd0f70794'
const step = (s: Partial<WorkflowPlanStepView> & Pick<WorkflowPlanStepView, 'id' | 'label'>): WorkflowPlanStepView => ({ job: 'agent', mode: 'once', instructions: '…', ...s })
const sitting = (label: string, stepLabel: string, n: number, agentId: string, agentType: string, extra: Partial<WorkflowAgentRunView> = {}): WorkflowAgentRunView => ({
  label, step: stepLabel, n, state: 'done', attempts: 1, queuedAt: 1_000, startedAt: 1_400, endedAt: 5_500, model: 'google/gemini-2.5-flash', turns: 2, tokens: 100,
  tools: [], output: null, error: null, agentId, agentType, sessionId: `ags_${n}`, nodeKey: `2:${label}`, ...extra,
})
const AGENTS: WorkflowAgentRunView[] = [
  sitting('Experiment Clerk #2', 'Experiment Clerk', 2, CLERK, 'extractor'),
  sitting('Experiment Clerk #3', 'Experiment Clerk', 3, CLERK, 'extractor', { state: 'failed', error: 'Connection error.' }),
  sitting('Quote Checker #1', 'Quote Checker', 1, CHECKER, 'quote checker', { output: { ok: true } }),
]
const STEPS = [
  step({ id: 'clerk', label: 'Experiment Clerk', mode: 'perItem', over: 'passages', produces: 'candidates' }),
  step({ id: 'checker', label: 'Quote Checker', mode: 'perItem', checks: 'candidates', produces: 'verified' }),
]
const CAST = beingFaces({ posts: STEPS, sittings: AGENTS })

function plan(focus: WorkflowFocus | null, calls: (WorkflowFocus | null)[], selected: string | null = null): WorkflowPlanOptions {
  return {
    title: 'Sleepers', definition: 'urn:sophia:wf:doc-sleepers:draft', status: 'ready', steps: STEPS,
    stacks: [{ id: 'candidates', producer: 'clerk', fields: ['quote'], items: [] }],
    agents: AGENTS, cast: CAST, focus, selected, onFocus: (f) => calls.push(f), onSelect: () => undefined,
  }
}

async function mount(tag: 'sh-workflow-focus' | 'sh-workflow-inspector', focus: WorkflowFocus | null, selected: string | null = null) {
  const calls: (WorkflowFocus | null)[] = []
  const el = document.createElement(tag) as HTMLElement & { plan: WorkflowPlanOptions; updateComplete: Promise<boolean> }
  el.plan = plan(focus, calls, selected)
  document.body.append(el)
  await el.updateComplete
  const root = el.shadowRoot!
  return { el, root, calls, text: () => root.textContent!.replace(/\s+/g, ' ') }
}

afterEach(() => {
  document.body.replaceChildren()
  beingDirectory.clear()
})

describe('the focus page of a post is its being’s page', () => {
  it('wears the being’s mark and name, its kind and model, and says sittings where it said agents', async () => {
    const { root, text } = await mount('sh-workflow-focus', { key: 'step:clerk' })
    const mark = root.querySelector('.hero sh-being-mark')!
    expect(mark.getAttribute('agent-id')).toBe(CLERK)
    const face = root.querySelector('sh-being-face') as HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<boolean> }
    await face.updateComplete
    const faceText = face.shadowRoot.textContent!.replace(/\s+/g, ' ')
    expect(faceText).toContain('Experiment Clerk')
    expect(faceText).toContain('extractor')
    expect(faceText).toContain('google/gemini-2.5-flash')
    expect(faceText).toContain('2 sittings')
    expect(faceText).toContain('1 failed')
    expect(root.querySelector('.stats')!.textContent!.replace(/\s+/g, ' ')).toContain('Experiment Clerk, 2 sittings')
    expect(text()).not.toMatch(/\bagents?\b/i)
  })

  it('opens each sitting as before, and the sitting page keeps the being’s mark', async () => {
    const person = await mount('sh-workflow-focus', { key: 'step:clerk' })
    ;(person.root.querySelectorAll('tbody tr')[1] as HTMLElement).click()
    expect(person.calls).toEqual([{ key: 'step:clerk', item: 3 }])
    const one = await mount('sh-workflow-focus', { key: 'step:clerk', item: 3 })
    expect(one.root.querySelector('.hero sh-being-mark')!.getAttribute('agent-id')).toBe(CLERK)
    expect(one.text()).toContain('a sitting of Experiment Clerk')
  })

  it('a check’s page is its being’s page too', async () => {
    const { root } = await mount('sh-workflow-focus', { key: 'step:checker' })
    expect(root.querySelector('.hero sh-being-mark')!.getAttribute('agent-id')).toBe(CHECKER)
  })

  it('a post nobody has sat at yet keeps its glyph and invents no being', async () => {
    const el = document.createElement('sh-workflow-focus') as HTMLElement & { plan: WorkflowPlanOptions; updateComplete: Promise<boolean> }
    el.plan = { ...plan({ key: 'step:clerk' }, []), cast: [], agents: [] }
    document.body.append(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('sh-being-mark')).toBeNull()
    expect(el.shadowRoot!.querySelector('.hero .badge')).not.toBeNull()
  })
})

// (The canvas node's mark is checked in a real browser against a live run: happy-dom cannot draw the scene's keyed list.)
describe('the inspector', () => {
  it('the inspector shows the face of the selected post', async () => {
    const { root } = await mount('sh-workflow-inspector', null, 'step:clerk')
    expect(root.querySelector('sh-being-face')).not.toBeNull()
  })

  it('lists the workflow’s beings under Cast, each opening its page', async () => {
    const { root, calls } = await mount('sh-workflow-inspector', { key: 'step:clerk' })
    const rows = [...root.querySelectorAll('.cast-row')] as HTMLButtonElement[]
    expect(rows).toHaveLength(2)
    const heading = [...root.querySelectorAll('h2')].map((h) => h.textContent)
    expect(heading).toContain('Cast')
    rows[1]!.click()
    expect(calls).toEqual([{ key: 'step:checker' }])
    const first = rows[0]!.querySelector('sh-being-face') as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot }
    await first.updateComplete
    expect(first.shadowRoot.textContent!.replace(/\s+/g, ' ')).toContain('Experiment Clerk')
    expect(first.shadowRoot.textContent!.replace(/\s+/g, ' ')).toContain('2 sittings')
  })
})

describe('the mark is the same one the dossier draws', () => {
  it('is deterministic from the agent id', async () => {
    const el = document.createElement('sh-being-mark') as HTMLElement & { updateComplete: Promise<boolean> }
    el.setAttribute('agent-id', CLERK)
    el.setAttribute('name', 'Experiment Clerk')
    document.body.append(el)
    await el.updateComplete
    const span = el.shadowRoot!.querySelector('.mark') as HTMLElement
    expect(span.getAttribute('style')).toContain(agentMark(CLERK).color)
    expect(span.textContent).toBe('E')
  })
})

describe('typed objects: "The being" is someone (D9)', () => {
  const store = loadFixtures()
  const catalog = classCatalogFrom(vocabFixture())
  const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(TYPED_ITEM))))
  // The same item with its maker unlabelled, as a real run leaves it (nothing writes an agent label).
  const unlabelled = triples.filter((t) => !(t.s === AGENT && t.p === 'http://www.w3.org/2000/01/rdf-schema#label'))
  const model = typedObjectModel({ iri: TYPED_ITEM, types: typesOf(TYPED_ITEM, unlabelled), triples: unlabelled, contract: findClassEntry(catalog, DREAM_REPORT), catalog })

  async function view(slot: string) {
    const el = document.createElement('sh-object-view') as ShObjectView
    el.setAttribute('slot', slot)
    el.model = model
    el.graphId = 'freud-dreams'
    const intents: ObjectViewIntent[] = []
    el.addEventListener(OBJECT_VIEW_INTENT_EVENT, (e) => intents.push((e as CustomEvent<{ intent: ObjectViewIntent }>).detail.intent))
    document.body.append(el)
    await el.updateComplete
    return { el, root: el.shadowRoot!, intents }
  }

  it('has no label to show in the item itself', () => {
    expect(model.testimony.by).toEqual({ agentIri: AGENT })
  })

  it('shows the mark and the post’s name once the shell knows it, and keeps the IRI as the tooltip, not as text', async () => {
    beingDirectory.set({ iri: AGENT, name: 'Experiment clerk', documentId: 'doc-sleepers', stepId: 'clerk' })
    const { root, intents } = await view('pane')
    const row = [...root.querySelectorAll('.row')].find((r) => r.textContent!.includes('The being'))!
    expect(row.textContent!.replace(/\s+/g, ' ')).toContain('Experiment clerk')
    expect(row.querySelector('sh-being-mark')!.getAttribute('agent-id')).toBe(CLERK)
    expect(row.querySelector('button')!.getAttribute('title')).toBe(AGENT)
    expect(row.textContent).not.toContain('urn:sophia:agent')
    row.querySelector('button')!.click()
    expect(intents).toEqual([{ kind: 'open-being', iri: AGENT, graphId: 'freud-dreams' }])
  })

  it('draws again when the shell learns the name after the first paint', async () => {
    const { el, root } = await view('pane')
    const before = [...root.querySelectorAll('.row')].find((r) => r.textContent!.includes('The being'))!.textContent!
    beingDirectory.set({ iri: AGENT, name: 'Experiment clerk', documentId: 'doc-sleepers', stepId: 'clerk' })
    await el.updateComplete
    const after = [...root.querySelectorAll('.row')].find((r) => r.textContent!.includes('The being'))!.textContent!
    expect(before).not.toContain('Experiment clerk')
    expect(after).toContain('Experiment clerk')
  })

  it('the card’s testimony line leads with the being: its mark, a door, the title is the IRI', async () => {
    beingDirectory.set({ iri: AGENT, name: 'Experiment clerk', documentId: 'doc-sleepers', stepId: 'clerk' })
    const { root, intents } = await view('card')
    const line = root.querySelector('.testimony')!
    expect(line.getAttribute('title')).toBe(AGENT)
    expect(line.querySelector('sh-being-mark')).not.toBeNull()
    expect(line.textContent!.replace(/\s+/g, ' ')).toMatch(/^by Experiment clerk #3 · run mh3x9a1 · /)
    line.querySelector('button')!.click()
    expect(intents[0]).toMatchObject({ kind: 'open-being', iri: AGENT })
  })
})
