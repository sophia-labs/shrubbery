/**
 * The object page (typed objects D8.2): ONE generic main-pane surface for any typed object, `{graphId, iri}`, through
 * the real seed config and `renderWorkspace` — the pane slot, where it is used, and a breadcrumb with its way back.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import {
  classCatalogFrom,
  findClassEntry,
  objectTriplesQuery,
  sparqlRows,
  triplesFromRows,
  typedObjectModel,
  typesOf,
} from '@shrubbery/nucleus/object-faces'
import { parseNT, parseTriplesToConfig } from '@shrubbery/nucleus'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShObjectView } from '../object-view/object-view-element.js'
import { DREAM_REPORT, loadFixtures, queryRows, TYPED_ITEM, vocabFixture } from '../object-view/__tests__/typed-fixture-store.js'
import { renderWorkspace } from '../render-workspace.js'

const require = createRequire(import.meta.url)
const SEED = resolve(dirname(require.resolve('@shrubbery/nucleus')), 'workspace/__generated__/garden-default.ux.nt')
const config = parseTriplesToConfig(parseNT(readFileSync(SEED, 'utf8')))

const store = loadFixtures()
const catalog = classCatalogFrom(vocabFixture())
const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(TYPED_ITEM))))
const model = typedObjectModel({ iri: TYPED_ITEM, types: typesOf(TYPED_ITEM, triples), triples, contract: findClassEntry(catalog, DREAM_REPORT), catalog })

afterEach(() => {
  document.body.replaceChildren()
})

describe('the object page in the main pane', () => {
  it('draws the object as its pane, with where it is used, and a breadcrumb that goes back', async () => {
    const backs: string[] = []
    const c = renderWorkspace(config, {
      objectPage: {
        graphId: 'freud-dreams',
        iri: TYPED_ITEM,
        status: 'ready',
        model,
        usedIn: [{ documentId: 'doc-notes', title: 'My notes on chapter I' }],
        documentTitles: { 'doc-freud': 'The Interpretation of Dreams' },
        back: { label: 'Sleepers, typed', onBack: () => backs.push('back') },
      },
    })
    document.body.append(c)
    const center = c.querySelector('.split-pane[data-region="region-center"]')!
    const page = center.querySelector('[data-surface="object-page"]')!
    expect(page).not.toBeNull()
    expect([...page.querySelectorAll('.objp-crumbs > *')].map((e) => e.textContent)).toEqual(['Sleepers, typed', '/', 'Dream report', '/', 'Meier'])
    const view = page.querySelector('sh-object-view') as ShObjectView
    expect(view.getAttribute('slot')).toBe('pane')
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('section.used-in li')!.textContent!.trim()).toBe('My notes on chapter I')
    page.querySelector<HTMLButtonElement>('.objp-bar .up')!.click()
    expect(backs).toEqual(['back'])
  })

  it('an IRI the graph holds nothing about says so, never a blank', () => {
    const c = renderWorkspace(config, { objectPage: { graphId: 'freud-dreams', iri: `${TYPED_ITEM}-gone`, status: 'absent' } })
    const page = c.querySelector('[data-surface="object-page"]')!
    expect(page.textContent).toContain('Not in this graph.')
    expect(page.querySelector('.objp-bar .up')).toBeNull()
  })
})
