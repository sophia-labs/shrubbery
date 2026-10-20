/**
 * `<sh-object-view>` in each slot and `<sh-injerto>`'s five laws, over models built from the D5-shaped fixtures in a
 * real Oxigraph store (happy-dom for the DOM).
 */

import {
  classCatalogFrom,
  findClassEntry,
  type ObjectModel,
  objectTriplesQuery,
  sparqlRows,
  triplesFromRows,
  typedObjectModel,
  typesOf,
} from '@shrubbery/nucleus/object-faces'
import { afterEach, describe, expect, it } from 'vitest'
import { ShInjerto } from '../injerto-element.js'
import { OBJECT_VIEW_INTENT_EVENT, type ObjectViewIntent, type ShObjectView } from '../object-view-element.js'
import { DREAM_REPORT, loadFixtures, queryRows, TYPED_ITEM, UNFIT_ITEM, vocabFixture } from './typed-fixture-store.js'

const store = loadFixtures()
const catalog = classCatalogFrom(vocabFixture())

function modelOf(iri: string, withContract = true): ObjectModel {
  const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(iri))))
  return typedObjectModel({ iri, types: typesOf(iri, triples), triples, contract: withContract ? findClassEntry(catalog, DREAM_REPORT) : null, catalog })
}

const typed = modelOf(TYPED_ITEM)
const unfit = modelOf(UNFIT_ITEM)

async function mountView(model: ObjectModel, slot: string, extra: Partial<ShObjectView> = {}) {
  const el = document.createElement('sh-object-view') as ShObjectView
  el.setAttribute('slot', slot)
  el.model = model
  el.graphId = 'freud-dreams'
  Object.assign(el, extra)
  const intents: ObjectViewIntent[] = []
  el.addEventListener(OBJECT_VIEW_INTENT_EVENT, (e) => intents.push((e as CustomEvent<{ intent: ObjectViewIntent }>).detail.intent))
  document.body.append(el)
  await el.updateComplete
  const root = el.shadowRoot!
  return { el, root, intents, text: () => root.textContent!.replace(/\s+/g, ' ').trim() }
}

const buttonNamed = (root: ShadowRoot, words: string): HTMLButtonElement => {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim().startsWith(words))
  if (!button) throw new Error(`no button "${words}"`)
  return button as HTMLButtonElement
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('<sh-object-view slot="inline">', () => {
  it('is a chip: the class and the title; a click opens the object', async () => {
    const { root, intents, text } = await mountView(typed, 'inline')
    expect(root.querySelectorAll('.chip')).toHaveLength(1)
    expect(text()).toBe('Dream report Meier')
    expect(root.querySelector('dl')).toBeNull()
    root.querySelector<HTMLButtonElement>('.chip')!.click()
    expect(intents).toEqual([{ kind: 'open-object', iri: TYPED_ITEM, graphId: 'freud-dreams' }])
  })
})

describe('<sh-object-view slot="card">', () => {
  it('shows the class, the title and subtitle, two to six fields, the quote and the testimony line', async () => {
    const { root, text } = await mountView(typed, 'card')
    expect(root.querySelector('.class-line')!.textContent!.trim()).toBe('Dream report')
    expect(root.querySelector('.title')!.textContent).toBe('Meier')
    expect(root.querySelector('.subtitle')!.textContent).toContain('a stake driven between his big and second toes')
    expect(root.querySelector('blockquote.quote')!.textContent).toBe('he awoke and felt a straw sticking between his toes')
    const labels = [...root.querySelectorAll('dl.record > dt')].map((dt) => dt.textContent)
    expect(labels).toEqual(['Dream', 'Stimulus', 'Page', 'Witnesses'])
    expect(labels.length).toBeGreaterThanOrEqual(2)
    expect(labels.length).toBeLessThanOrEqual(6)
    expect(root.querySelector('.testimony')!.textContent).toMatch(/^by Experiment clerk #3 · run mh3x9a1 · /)
    expect(text()).not.toContain('doc-freud')
  })

  it('summarizes a nested value to its title, without the sub-card', async () => {
    const { root } = await mountView(typed, 'card')
    const dd = [...root.querySelectorAll('dl.record > dt')].find((dt) => dt.textContent === 'Stimulus')!.nextElementSibling!
    expect(dd.textContent!.trim()).toBe('a straw between the toes')
    expect(root.querySelector('.sub')).toBeNull()
  })

  it('is a door and a way to embed, both intents the host carries; it writes nothing', async () => {
    const { root, intents } = await mountView(typed, 'card')
    buttonNamed(root, 'Open').click()
    buttonNamed(root, 'Embed in a document').click()
    expect(intents).toEqual([
      { kind: 'open-object', iri: TYPED_ITEM, graphId: 'freud-dreams' },
      { kind: 'embed', iri: TYPED_ITEM, graphId: 'freud-dreams', label: 'Meier', classLabel: 'Dream report' },
    ])
  })

  it('an unfit item wears the unfit stance and says why, in the card', async () => {
    const { root } = await mountView(unfit, 'card')
    expect(root.querySelector('.view')!.getAttribute('data-stance')).toBe('unfit')
    expect(root.querySelector('.stance')!.textContent).toBe('Unfit')
    expect([...root.querySelectorAll('.violations li')].map((li) => li.textContent)).toEqual([
      'page: "thirty-three" is not an integer',
      'who: a value is required and none was given',
    ])
  })

  it('a host may override the stance (one display, a stance on it)', async () => {
    const { root } = await mountView(typed, 'card', { stance: 'retracted' })
    expect(root.querySelector('.view')!.getAttribute('data-stance')).toBe('retracted')
    expect(root.querySelector('.stance')!.textContent).toBe('Retracted')
  })

  it('the generic model renders too, never a blank', async () => {
    const { root } = await mountView(modelOf(TYPED_ITEM, false), 'card')
    expect(root.querySelector('.title')!.textContent).toBe('Meier')
    expect(root.querySelectorAll('dl.record > dt').length).toBeGreaterThanOrEqual(2)
  })
})

describe('<sh-object-view slot="pane">', () => {
  it('shows every field, the nested value as a sub-card in full, the quote with its door, the testimony and where it is used', async () => {
    const { root, intents, text } = await mountView(typed, 'pane', {
      documentTitles: { 'doc-freud': 'The Interpretation of Dreams' },
      usedIn: [{ documentId: 'doc-notes', title: 'My notes on chapter I', blockId: 'b1' }],
    })
    expect(root.querySelector('h1.title')!.textContent).toBe('Meier')
    expect(text()).toContain('run testimony')
    const labels = [...root.querySelectorAll('section > dl.record > dt')].map((dt) => dt.textContent)
    expect(labels).toEqual(['Procedure', 'Dream', 'Stimulus', 'Document', 'Block', 'Page', 'Witnesses'])
    const subs = [...root.querySelectorAll('.sub')]
    expect(subs.map((s) => s.querySelector('.sub-title')!.textContent)).toEqual([
      'a straw between the toes',
      "Meier's own account (1758)",
      'cited by Freud from Strümpell',
    ])
    expect(subs[0]!.querySelector('dl.record')!.textContent!.replace(/\s+/g, ' ')).toContain('Sense touch')
    expect(text()).toContain('Handed back by Experiment clerk #3')
    expect(text()).toContain('The being Experiment clerk')
    buttonNamed(root, 'Show in The Interpretation of Dreams').click()
    buttonNamed(root, 'My notes on chapter I').click()
    expect(intents).toEqual([
      { kind: 'open-document', documentId: 'doc-freud', blockId: 'block-c01fe85b', graphId: 'freud-dreams' },
      { kind: 'open-document', documentId: 'doc-notes', blockId: 'b1', graphId: 'freud-dreams' },
    ])
  })

  it('says honestly when nothing embeds it yet, and while it is looking', async () => {
    const looking = await mountView(typed, 'pane')
    expect(looking.root.querySelector('section.used-in p')!.textContent).toBe('Looking…')
    looking.el.remove()
    const none = await mountView(typed, 'pane', { usedIn: [] })
    expect(none.root.querySelector('section.used-in p')!.textContent).toBe('No document embeds it yet.')
  })
})

describe('<sh-injerto>: the five laws', () => {
  async function mountInjerto(props: Partial<ShInjerto>) {
    const el = document.createElement('sh-injerto') as ShInjerto
    Object.assign(el, { iri: TYPED_ITEM, graphId: 'freud-dreams', label: 'Meier', classLabel: 'Dream report', ...props })
    const intents: ObjectViewIntent[] = []
    el.addEventListener(OBJECT_VIEW_INTENT_EVENT, (e) => intents.push((e as CustomEvent<{ intent: ObjectViewIntent }>).detail.intent))
    document.body.append(el)
    await el.updateComplete
    const view = el.shadowRoot!.querySelector('sh-object-view') as ShObjectView | null
    if (view) await view.updateComplete
    return { el, root: el.shadowRoot!, view, intents }
  }

  it('1. framed and flagged: a mono chip names the class and the register', async () => {
    const { root } = await mountInjerto({ status: 'ready', model: typed })
    expect(root.querySelector('figure.frame')).not.toBeNull()
    expect(root.querySelector('.flag')!.textContent).toBe('Dream report · run testimony')
    expect((ShInjerto.styles as { cssText: string }).cssText).toMatch(/\.flag\s*\{[^}]*var\(--mn-font-mono/)
  })

  it('2. subject-bound, never a survey: exactly one object, as a card', async () => {
    const { root, view } = await mountInjerto({ status: 'ready', model: typed })
    expect(root.querySelectorAll('sh-object-view')).toHaveLength(1)
    expect(view!.getAttribute('slot')).toBe('card')
    expect('items' in ShInjerto.properties || 'models' in ShInjerto.properties).toBe(false)
  })

  it('3. bounded, with its own scroll', async () => {
    const { root } = await mountInjerto({ status: 'ready', model: typed })
    expect(root.querySelector('.window > sh-object-view')).not.toBeNull()
    const css = (ShInjerto.styles as { cssText: string }).cssText
    expect(css).toMatch(/\.window\s*\{[^}]*max-height:\s*var\(--sh-injerto-max-height,\s*320px\)/)
    expect(css).toMatch(/\.window\s*\{[^}]*overflow:\s*auto/)
  })

  it('4. the testimony and the stance travel with the matter, outside the scroll, always visible', async () => {
    const ok = await mountInjerto({ status: 'ready', model: typed })
    const foot = ok.root.querySelector('.foot')!
    expect(foot.closest('.window')).toBeNull()
    expect(foot.textContent).toMatch(/by Experiment clerk #3 · run mh3x9a1/)
    // The card inside does not draw it a second time.
    expect(ok.view!.shadowRoot!.querySelector('.testimony')).toBeNull()
    ok.el.remove()
    const bad = await mountInjerto({ status: 'ready', model: unfit })
    expect(bad.root.querySelector('.foot .stance')!.textContent).toBe('unfit')
    expect(bad.root.querySelector('.frame')!.getAttribute('data-stance')).toBe('unfit')
  })

  it('5. a door to the full surface: "Open" opens the object page', async () => {
    const { root, intents } = await mountInjerto({ status: 'ready', model: typed })
    root.querySelector<HTMLButtonElement>('.door')!.click()
    expect(intents).toEqual([{ kind: 'open-object', iri: TYPED_ITEM, graphId: 'freud-dreams' }])
  })

  it('5. honestly absent: "Not in this graph", the snapshot label, and no door', async () => {
    const { root, view } = await mountInjerto({ status: 'absent', model: null })
    expect(view).toBeNull()
    expect(root.querySelector('.door')).toBeNull()
    const text = root.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('Not in this graph')
    expect(text).toContain('Meier, a dream report, as it was when it was embedded.')
    expect(root.querySelector('.flag')!.textContent).toBe('Dream report · not resolved')
  })
})
