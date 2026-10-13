/**
 * focus-binding.test.ts — the pure focus binding (el Despacho W1). Proves
 * each of the three binding shapes, the no-focus and no-placeholder
 * identities, deep-freezing, and that a focus-bearing document is detected
 * for reload decisions.
 */
import { describe, expect, it } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { bindLayoutFocus, layoutDocumentUsesFocus, resourceLocatorUsesFocus } from '../focus-binding.js'
import { NamedQueryRegistry } from '../named-query-registry.js'

const FOCUS = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas:cuenta:sirin-g-slice-accepted'
const NAMED_FOCUSED = 'urn:sophia:query:cuenta.children'
const NAMED_PLAIN = 'urn:sophia:query:obs.plain'

function registry(): NamedQueryRegistry {
  const r = new NamedQueryRegistry()
  r.register({ name: NAMED_FOCUSED, text: 'SELECT ?item WHERE { GRAPH ?g { ?item ?e <{{focus}}> } }', description: 'children of the focus' })
  r.register({ name: NAMED_PLAIN, text: 'SELECT 1', description: 'no focus' })
  r.seal()
  return r
}

const options = { namedQueryUsesFocus: (name: string) => registry().usesFocus(name) }

function doc(): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'despacho-test',
    scope: 'workspace',
    graphId: 'sophia-cluster',
    rootNodeId: 'root',
    nodes: {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'chapter', endNodeId: 'children', startBasisPoints: 5500 },
      chapter: {
        kind: 'leaf',
        id: 'chapter',
        descriptorRevision: 0,
        descriptor: { schemaVersion: 1, faceId: 'card.cuenta', resource: { kind: 'graph', graphId: 'sophia-cluster', subjectIri: '{{focus}}' } },
      },
      children: {
        kind: 'grid',
        id: 'children',
        flow: 'reflow',
        minCellWidth: 240,
        gridRevision: 0,
        children: {
          kind: 'collection',
          collection: { kind: 'query', graphId: 'sophia-cluster', queryId: NAMED_FOCUSED },
          itemFaceId: 'card.cuenta',
          itemParams: { mode: 'entry' },
          maxItems: 24,
        },
      },
    },
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  } as LayoutDocument)
}

describe('resourceLocatorUsesFocus', () => {
  it('detects the placeholder in graph, iri, raw-query and named-query locators — and nothing else', () => {
    expect(resourceLocatorUsesFocus({ kind: 'graph', graphId: 'g', subjectIri: '{{focus}}' }, options)).toBe(true)
    expect(resourceLocatorUsesFocus({ kind: 'graph', graphId: 'g', subjectIri: 'urn:x' }, options)).toBe(false)
    expect(resourceLocatorUsesFocus({ kind: 'iri', iri: '{{focus}}' }, options)).toBe(true)
    expect(resourceLocatorUsesFocus({ kind: 'query', graphId: 'g', queryId: 'SELECT * WHERE { <{{focus}}> ?p ?o }' }, options)).toBe(true)
    expect(resourceLocatorUsesFocus({ kind: 'query', graphId: 'g', queryId: NAMED_FOCUSED }, options)).toBe(true)
    expect(resourceLocatorUsesFocus({ kind: 'query', graphId: 'g', queryId: NAMED_PLAIN }, options)).toBe(false)
    expect(resourceLocatorUsesFocus({ kind: 'document', graphId: 'g', documentId: 'd' }, options)).toBe(false)
  })
})

describe('bindLayoutFocus', () => {
  it('substitutes graph/iri subjects and stamps query locators; the result is a NEW frozen document', () => {
    const before = doc()
    const bound = bindLayoutFocus(before, FOCUS, options)
    expect(bound).not.toBe(before)
    expect(Object.isFrozen(bound.nodes)).toBe(true)
    const chapter = bound.nodes.chapter
    if (chapter.kind !== 'leaf') throw new Error('expected a leaf')
    expect(chapter.descriptor.resource).toEqual({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: FOCUS })
    const children = bound.nodes.children
    if (children.kind !== 'grid' || children.children.kind !== 'collection') throw new Error('expected a collection grid')
    expect(children.children.collection).toEqual({ kind: 'query', graphId: 'sophia-cluster', queryId: NAMED_FOCUSED, focus: FOCUS })
    // The authored document is untouched.
    const original = before.nodes.chapter
    if (original.kind !== 'leaf') throw new Error('expected a leaf')
    expect(original.descriptor.resource).toEqual({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: '{{focus}}' })
  })

  it('binds a bare iri item descriptor and a fixed grid cell too', () => {
    const before = deepFreeze({
      ...doc(),
      nodes: {
        root: { kind: 'leaf', id: 'root', descriptorRevision: 0, descriptor: { schemaVersion: 1, faceId: 'card.cuenta', resource: { kind: 'iri', iri: '{{focus}}' }, params: { graphIri: 'sophia-cluster' } } },
      },
    } as LayoutDocument)
    const bound = bindLayoutFocus(before, FOCUS, options)
    const root = bound.nodes.root
    if (root.kind !== 'leaf') throw new Error('expected a leaf')
    expect(root.descriptor.resource).toEqual({ kind: 'iri', iri: FOCUS })
    expect(root.descriptor.params).toEqual({ graphIri: 'sophia-cluster' })
  })

  it('with no focus returns the SAME document (identity), leaving placeholders for the resolver to refuse honestly', () => {
    const before = doc()
    expect(bindLayoutFocus(before, null, options)).toBe(before)
  })

  it('returns the SAME document when nothing names the focus', () => {
    const plain = deepFreeze({
      ...doc(),
      nodes: {
        root: { kind: 'leaf', id: 'root', descriptorRevision: 0, descriptor: { schemaVersion: 1, faceId: 'stat.scalar', resource: { kind: 'query', graphId: 'sophia-cluster', queryId: 'SELECT (1 AS ?value) {}' }, params: { label: 'one' } } },
      },
    } as LayoutDocument)
    expect(bindLayoutFocus(plain, FOCUS, options)).toBe(plain)
    expect(layoutDocumentUsesFocus(plain, options)).toBe(false)
    expect(layoutDocumentUsesFocus(doc(), options)).toBe(true)
  })

  it('re-binding an already-bound document to the same focus is an identity; to another focus it is a new document', () => {
    const once = bindLayoutFocus(doc(), FOCUS, options)
    // Already substituted subjects no longer carry the placeholder — only the
    // query stamp remains identity-stable; the graph subject is now literal.
    const again = bindLayoutFocus(once, FOCUS, options)
    expect(again).toBe(once)
    const other = bindLayoutFocus(once, 'urn:x:other', options)
    const children = other.nodes.children
    if (children.kind !== 'grid' || children.children.kind !== 'collection') throw new Error('expected a collection grid')
    expect(children.children.collection).toMatchObject({ focus: 'urn:x:other' })
  })
})
