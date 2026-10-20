/**
 * object-card-face.test.ts — `object.card` (typed objects D7 "Layout leaves"): a layout leaf that places one typed
 * object by IRI, read through the typed-object seam over the D5 fixtures in a real Oxigraph store.
 */
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import { describe, expect, it } from 'vitest'
import { createFragmentFaceRegistry } from '../../fragment-face-set.js'
import type { FaceMountContext } from '../../types.js'
import { createObjectCardFace, createObjectCardResourceAdapter, isObjectCardLocator, OBJECT_CARD_FACE_ID } from '../object-card-face.js'
import type { ShObjectView } from '../../../object-view/object-view-element.js'
import { fixtureTypedObjectService, loadFixtures, TYPED_ITEM } from '../../../object-view/__tests__/typed-fixture-store.js'

const store = loadFixtures()

async function mount(locator: ResourceLocator, params?: Record<string, unknown>) {
  const adapter = createObjectCardResourceAdapter(fixtureTypedObjectService(store))
  const handle = await adapter.compute(locator, undefined as never)
  const target = document.createElement('div')
  document.body.append(target)
  const context: FaceMountContext = {
    target,
    descriptor: { schemaVersion: 1, faceId: OBJECT_CARD_FACE_ID, resource: locator, ...(params ? { params } : {}) },
    lease: { key: adapter.resourceKey(locator), shape: 'derived', value: handle, released: false, release() {} },
    constraints: { minWidth: 0, minHeight: 0, overflow: 'scroll' },
  }
  const view = await createObjectCardFace().mount(context)
  const element = target.querySelector('sh-object-view') as ShObjectView | null
  if (element) await element.updateComplete
  return { target, view, element }
}

describe('object.card — the locator', () => {
  it('accepts any absolute IRI of a typed resource, by graph or bare; refuses the source register URNs and non-IRIs', () => {
    expect(isObjectCardLocator({ kind: 'graph', graphId: 'freud-dreams', subjectIri: TYPED_ITEM })).toBe(true)
    expect(isObjectCardLocator({ kind: 'iri', iri: TYPED_ITEM })).toBe(true)
    expect(isObjectCardLocator({ kind: 'graph', graphId: 'g', subjectIri: 'urn:sophia:object:koch-morse:Bookmark:abc' })).toBe(false)
    expect(isObjectCardLocator({ kind: 'graph', graphId: 'g' })).toBe(false)
    expect(isObjectCardLocator({ kind: 'graph', graphId: 'g', subjectIri: 'not an iri' })).toBe(false)
    expect(isObjectCardLocator({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
  })

  it('is in the closed fragment catalogue: a graph-authored layout may place it with closed params only', () => {
    const registry = createFragmentFaceRegistry()
    const resource = { kind: 'graph' as const, graphId: 'freud-dreams', subjectIri: TYPED_ITEM }
    expect(registry.validate({ schemaVersion: 1, faceId: 'object.card', resource, params: { slot: 'pane' } }).ok).toBe(true)
    expect(registry.validate({ schemaVersion: 1, faceId: 'object.card', resource, params: { slot: 'poster' } }).ok).toBe(false)
    expect(registry.validate({ schemaVersion: 1, faceId: 'object.card', resource, params: { renderer: 'mine.js' } }).ok).toBe(false)
  })
})

describe('object.card — mounted', () => {
  it('reads the object and draws it in the slot the params name', async () => {
    const { element, view } = await mount({ kind: 'graph', graphId: 'freud-dreams', subjectIri: TYPED_ITEM }, { slot: 'pane' })
    expect(element).not.toBeNull()
    expect(element!.getAttribute('slot')).toBeNull()
    expect(element!.faceSlot).toBe('pane')
    expect(element!.model?.title).toBe('Meier')
    expect(element!.shadowRoot!.querySelector('h1.title')!.textContent).toBe('Meier')
    view.dispose('closed')
  })

  it('says "Not in this graph" for an IRI the graph holds nothing about, never a blank', async () => {
    const { target } = await mount({ kind: 'graph', graphId: 'freud-dreams', subjectIri: 'urn:sophia:wf:doc-sleepers:run:mh3x9a1#item-404' })
    expect(target.textContent).toContain('Not in this graph')
  })

  it('a bare IRI with no graph param says what it needs', async () => {
    const { target } = await mount({ kind: 'iri', iri: TYPED_ITEM })
    expect(target.textContent).toContain('no graph to read')
  })
})
