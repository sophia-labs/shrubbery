/**
 * The workflow's full views and inspector on TYPED items (typed objects D8.1): the stack table in the class's columns
 * and called by its plural, unfit items marked with their violations, the item page as the object's pane with a door
 * to the object page, a sitting that handed back nothing that fit, and untyped stacks unchanged. The items are the
 * D5-shaped fixtures in a real Oxigraph store, modelled with the same code the app runs.
 */

import {
  classCatalogFrom,
  findClassEntry,
  type ObjectModel,
  objectTriplesQuery,
  parseNTriplesTerm,
  sparqlRows,
  triplesFromRows,
  typedObjectModel,
  typesOf,
} from '@shrubbery/nucleus/object-faces'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShObjectView } from '../object-view/object-view-element.js'
import { DREAM_REPORT, loadFixtures, queryRows, TYPED_ITEM, UNFIT_ITEM, vocabFixture } from '../object-view/__tests__/typed-fixture-store.js'
import type { WorkflowAgentRunView, WorkflowFocus, WorkflowPlanOptions, WorkflowPlanStepView, WorkflowStackClassView } from '../render-workspace.js'
import '../workflow-focus.js'
import '../workflow-inspector.js'

const store = loadFixtures()
const catalog = classCatalogFrom(vocabFixture())
const contract = findClassEntry(catalog, DREAM_REPORT)!

function model(iri: string): ObjectModel {
  const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(iri))))
  return typedObjectModel({ iri, types: typesOf(iri, triples), triples, contract, catalog })
}

/** What the run graph keeps as the item's JSON (`wf:json`): exactly what its agent handed back. */
function handedJson(iri: string): Record<string, unknown> {
  const row = queryRows(store, `SELECT ?j WHERE { GRAPH ?g { <${iri}> <http://mnemosyne.dev/workflow#json> ?j } }`).rows[0]!
  return JSON.parse(parseNTriplesTerm(row.j!).value) as Record<string, unknown>
}

const typed = model(TYPED_ITEM)
const unfit = model(UNFIT_ITEM)
const typedJson = handedJson(TYPED_ITEM)
const unfitJson = handedJson(UNFIT_ITEM)

const dreamReports: WorkflowStackClassView = {
  iri: DREAM_REPORT,
  label: contract.label!,
  plural: contract.plural!,
  columns: typed.fields.map((f) => ({ key: f.key, label: f.label })),
}

const step = (s: Partial<WorkflowPlanStepView> & Pick<WorkflowPlanStepView, 'id' | 'label'>): WorkflowPlanStepView => ({
  job: 'agent', mode: 'once', instructions: '…', ...s,
})
const agent = (a: Partial<WorkflowAgentRunView> & Pick<WorkflowAgentRunView, 'label' | 'step'>): WorkflowAgentRunView => ({
  n: null, state: 'done', attempts: 1, queuedAt: 1_000, startedAt: 1_400, endedAt: 5_500, model: 'google/gemini-2.5-flash',
  turns: 2, tokens: 3544, tools: [], output: null, error: null, ...a,
})

interface Calls {
  focus: (WorkflowFocus | null)[]
  objects: string[]
  embeds: string[]
  documents: string[]
}

function plan(focus: WorkflowFocus | null, calls: Calls, selected: string | null = null): WorkflowPlanOptions {
  return {
    title: 'Sleepers, typed',
    definition: 'urn:sophia:wf:doc-sleepers:draft',
    status: 'ready',
    graphId: 'freud-dreams',
    steps: [
      step({ id: 'clerk', label: 'Experiment clerk', mode: 'perItem', over: 'passages', produces: 'candidates' }),
      step({ id: 'censor', label: 'Quote censor', mode: 'perItem', checks: 'candidates', produces: 'verified' }),
    ],
    stacks: [
      { id: 'passages', producer: null, fields: ['text'], items: [{ text: 'I. The External Sensory Stimuli.' }, { text: 'Meier once dreamed…' }, { text: 'Jessen observed…' }] },
      { id: 'candidates', producer: 'clerk', fields: [], items: [typedJson, unfitJson], itemClass: dreamReports, objects: [typed, unfit] },
      { id: 'verified', producer: 'censor', fields: [], items: [typedJson], itemClass: dreamReports, objects: [typed] },
    ],
    agents: [
      agent({ label: 'Experiment clerk #2', step: 'Experiment clerk', n: 2, output: { items: [typedJson] } }),
      agent({ label: 'Experiment clerk #3', step: 'Experiment clerk', n: 3, output: { items: [] } }),
      agent({ label: 'Experiment clerk #5', step: 'Experiment clerk', n: 5, output: { items: [unfitJson] } }),
    ],
    unfitSittings: [{ step: 'clerk', sitting: 'Experiment clerk #3', violations: ['the answer was not a list of dream reports'] }],
    beings: { clerk: 'urn:sophia:agent:agent-62517a586738e5e9' },
    documentTitles: { 'doc-freud': 'The Interpretation of Dreams' },
    focus,
    selected,
    onFocus: (f) => calls.focus.push(f),
    onOpenObject: ({ iri }) => calls.objects.push(iri),
    onEmbedObject: ({ iri }) => calls.embeds.push(iri),
    onOpenDocument: ({ documentId }) => calls.documents.push(documentId),
  }
}

async function mount(tag: 'sh-workflow-focus' | 'sh-workflow-inspector', focus: WorkflowFocus | null, selected: string | null = null) {
  const calls: Calls = { focus: [], objects: [], embeds: [], documents: [] }
  const el = document.createElement(tag) as HTMLElement & { plan: WorkflowPlanOptions; updateComplete: Promise<boolean> }
  el.plan = plan(focus, calls, selected)
  document.body.append(el)
  await el.updateComplete
  const views = [...el.shadowRoot!.querySelectorAll('sh-object-view')] as ShObjectView[]
  for (const view of views) await view.updateComplete
  const root = el.shadowRoot!
  return { el, root, calls, views, text: () => root.textContent!.replace(/\s+/g, ' ') }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('a typed stack, full size', () => {
  it('is called by its class plural, and its table has the class columns in order', async () => {
    const { root } = await mount('sh-workflow-focus', { key: 'stack:candidates' })
    expect(root.querySelector('.hero h1')!.textContent).toBe('Dream reports')
    expect(root.querySelector('.hero .sub')!.textContent!.replace(/\s+/g, ' ')).toContain('2 dream reports, 1 unfit')
    const heads = [...root.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(['#', 'Who', 'Procedure', 'Dream', 'Stimulus', 'Quote', 'Page', 'Witnesses', 'Why'])
  })

  it('draws each typed cell from its field, a nested value by its title, an absent one as a dash', async () => {
    const { root } = await mount('sh-workflow-focus', { key: 'stack:candidates' })
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim()))
    expect(rows[0]!.slice(1, 5)).toEqual(['Meier', 'seized by some persons, laid on his back, a stake driven between his big and second toes', 'He was being tortured, staked to the ground.', 'a straw between the toes'])
    expect(rows[1]![1]).toBe('—')
  })

  it('marks the unfit item as unfit, with its violations', async () => {
    const { root } = await mount('sh-workflow-focus', { key: 'stack:candidates' })
    const rows = [...root.querySelectorAll('tbody tr')]
    expect(rows.map((tr) => tr.getAttribute('data-stance'))).toEqual(['read', 'unfit'])
    expect(rows[1]!.querySelector('.unfit-tag')!.textContent).toBe('unfit')
    expect(rows[1]!.querySelector('td.why')!.textContent).toContain('who: a value is required and none was given')
    expect(rows[0]!.querySelector('td.why')!.textContent!.trim()).toBe('')
  })
})

describe('a typed item, full size', () => {
  it("is the object's pane (which carries its title), named by its class and place, with a door to the object page", async () => {
    const { root, views, calls } = await mount('sh-workflow-focus', { key: 'stack:candidates', item: 1 })
    expect(root.querySelector('.hero h1')!.textContent).toBe('Dream report 1')
    expect(root.querySelector('.hero .sub')!.textContent).toBe('One of 2 dream reports')
    expect(views).toHaveLength(1)
    expect(views[0]!.getAttribute('slot')).toBe('pane')
    expect(views[0]!.model).toBe(typed)
    const door = [...root.querySelectorAll('button.link')].find((b) => b.textContent === 'Open as an object') as HTMLButtonElement
    door.click()
    expect(calls.objects).toEqual([TYPED_ITEM])
  })

  it("names its maker by the sitting it testifies (wf:sitting), not by matching JSON", async () => {
    const { root } = await mount('sh-workflow-focus', { key: 'stack:candidates', item: 1 })
    const madeBy = [...root.querySelectorAll('.lineage .row')].find((r) => r.textContent!.includes('Made by'))!
    expect(madeBy.querySelector('button.link')!.textContent).toBe('Experiment clerk #3')
  })

  it("the pane's own gestures go to the workflow's host: its document, and embedding it", async () => {
    const { views, calls } = await mount('sh-workflow-focus', { key: 'stack:candidates', item: 1 })
    let escaped = 0
    const count = (): void => { escaped += 1 }
    document.addEventListener('sh-object-view-intent', count)
    const pane = views[0]!.shadowRoot!
    ;[...pane.querySelectorAll('button')].find((b) => b.textContent!.startsWith('Show in The Interpretation of Dreams'))!.click()
    ;[...pane.querySelectorAll('button')].find((b) => b.textContent!.startsWith('Embed in a document'))!.click()
    document.removeEventListener('sh-object-view-intent', count)
    expect(calls.documents).toEqual(['doc-freud'])
    expect(calls.embeds).toEqual([TYPED_ITEM])
    expect(escaped).toBe(0)
  })
})

describe("a person's sittings", () => {
  it('the person page says which sitting handed back nothing that fit, and why', async () => {
    const { root, text } = await mount('sh-workflow-focus', { key: 'step:clerk' })
    expect(text()).toContain('Handed back nothing that fit')
    expect(root.querySelector('.unfit-list li')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Experiment clerk #3 handed back nothing that fit: the answer was not a list of dream reports',
    )
    expect(text()).toContain('Each dream report they hand on has')
    const handed = [...root.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[3]!.textContent!.trim())
    expect(handed).toEqual(['1 dream report', 'Nothing that fit: the answer was not a list of dream reports', '1 dream report, 1 unfit'])
  })

  it("that sitting's own page says so, in place of what it handed on", async () => {
    const { text } = await mount('sh-workflow-focus', { key: 'step:clerk', item: 3 })
    expect(text()).toContain('It handed back nothing that fit a dream report: the answer was not a list of dream reports')
  })

  it("another sitting's page draws what it handed on as typed cards", async () => {
    const { views } = await mount('sh-workflow-focus', { key: 'step:clerk', item: 5 })
    const handedOn = views.filter((v) => v.getAttribute('slot') === 'card')
    expect(handedOn.map((v) => v.model?.stance)).toEqual(['unfit'])
  })
})

describe('untyped stacks keep their record cards', () => {
  it('the passages stack has no class, so its table and items are as before', async () => {
    const { root, views } = await mount('sh-workflow-focus', { key: 'stack:passages' })
    expect(root.querySelector('.hero h1')!.textContent).toBe('passages')
    expect([...root.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['#', 'text'])
    expect(views).toHaveLength(0)
    const item = await mount('sh-workflow-focus', { key: 'stack:passages', item: 1 })
    expect(item.root.querySelector('.item')).not.toBeNull()
    expect(item.views).toHaveLength(0)
  })
})

describe('the inspector on a typed stack', () => {
  it('names it by its class, lists the class fields, and draws each item as the class card', async () => {
    const { root, views, text } = await mount('sh-workflow-inspector', null, 'stack:candidates')
    expect(root.querySelector('h1')!.textContent).toBe('Dream reports')
    expect(text()).toContain('2 dream reports after the last run, 1 unfit')
    expect(text()).toContain('Each dream report has')
    expect(views.map((v) => [v.getAttribute('slot'), v.model?.title, v.model?.stance])).toEqual([
      ['card', 'Meier', 'read'],
      ['card', 'the rolling of thunder', 'unfit'],
    ])
  })
})
