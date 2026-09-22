/**
 * fragment-splice.test.ts — Stage B of the Surface unification: the pure
 * splice that turns a graph-authored fragment LayoutDocument into namespaced
 * workspace-Surface nodes. Real validation registry (the closed fragment face
 * catalogue), real `createValidatedLayoutDocument` underneath — no vi.*.
 */
import { describe, expect, it } from 'vitest'
import { createSophiaHomeDescriptor, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { createFragmentFaceRegistry } from '../fragment-face-set.js'
import {
  FRAGMENT_NODE_ID_PREFIX,
  fragmentNodeId,
  fragmentRegionIdOf,
  spliceFragmentDocument,
} from '../fragment-splice.js'

const registry = createFragmentFaceRegistry()

function fragmentDoc(overrides?: Partial<LayoutDocument>): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'observatory-v0',
    scope: 'workspace',
    graphId: 'observatory',
    rootNodeId: 'root',
    nodes: {
      root: {
        kind: 'split',
        id: 'root',
        axis: 'horizontal',
        startNodeId: 'stat-quads',
        endNodeId: 'home',
        startBasisPoints: 3000,
      },
      'stat-quads': {
        kind: 'leaf',
        id: 'stat-quads',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: 'stat.scalar',
          resource: { kind: 'query', graphId: 'observatory', queryId: 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }' },
          params: { label: 'Quads' },
        },
      },
      home: {
        kind: 'leaf',
        id: 'home',
        descriptorRevision: 0,
        descriptor: createSophiaHomeDescriptor(),
      },
    },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('spliceFragmentDocument', () => {
  it('namespaces every node id collision-proof and remaps split children', () => {
    const result = spliceFragmentDocument(fragmentDoc(), 'region-center', registry)
    if (!result.ok) throw new Error(`expected splice ok, got: ${result.reason}`)

    expect(result.rootNodeId).toBe('frag:region-center:root')
    expect(Object.keys(result.nodes).sort()).toEqual([
      'frag:region-center:home',
      'frag:region-center:root',
      'frag:region-center:stat-quads',
    ])
    const split = result.nodes['frag:region-center:root']
    expect(split.kind).toBe('split')
    if (split.kind !== 'split') throw new Error('unreachable')
    expect(split.startNodeId).toBe('frag:region-center:stat-quads')
    expect(split.endNodeId).toBe('frag:region-center:home')
    // Ratio and leaf descriptors survive verbatim.
    expect(split.startBasisPoints).toBe(3000)
    const leaf = result.nodes['frag:region-center:stat-quads']
    if (leaf.kind !== 'leaf') throw new Error('unreachable')
    expect(leaf.descriptor.faceId).toBe('stat.scalar')

    // Provenance: every namespaced split maps back to its ORIGINAL id, and the
    // namespacing is a strict prefix bijection.
    expect(Array.from(result.splitIds.entries())).toEqual([['frag:region-center:root', 'root']])
    for (const id of Object.keys(result.nodes)) {
      expect(id.startsWith(FRAGMENT_NODE_ID_PREFIX)).toBe(true)
      expect(fragmentNodeId('region-center', id.slice('frag:region-center:'.length))).toBe(id)
    }
  })

  it('namespaces every tabs child and activeNodeId and records tabs provenance', () => {
    const doc = fragmentDoc({
      rootNodeId: 'tabs',
      nodes: {
        tabs: { kind: 'tabs', id: 'tabs', tabs: [{ nodeId: 'stat-quads', label: 'Quads' }, { nodeId: 'home', label: 'Home' }], activeNodeId: 'stat-quads', tabsRevision: 0 },
        'stat-quads': fragmentDoc().nodes['stat-quads'],
        home: fragmentDoc().nodes.home,
      },
    })
    const result = spliceFragmentDocument(doc, 'region-center', registry)
    if (!result.ok) throw new Error(`expected splice ok, got: ${result.reason}`)
    const tabs = result.nodes['frag:region-center:tabs']
    expect(tabs.kind).toBe('tabs')
    if (tabs.kind !== 'tabs') throw new Error('unreachable')
    expect(tabs.tabs.map((tab) => tab.nodeId)).toEqual(['frag:region-center:stat-quads', 'frag:region-center:home'])
    expect(tabs.activeNodeId).toBe('frag:region-center:stat-quads')
    expect(Array.from(result.tabsIds.entries())).toEqual([['frag:region-center:tabs', 'tabs']])
  })

  it('region ids containing colons stay unambiguous — percent-encoded composite, one decoder', () => {
    // The historical grammar is byte-identical…
    expect(fragmentNodeId('region-center', 'root')).toBe('frag:region-center:root')
    // …and a colon-bearing region id encodes injectively.
    expect(fragmentNodeId('a:b', 'root')).toBe('frag:a%3Ab:root')
    expect(fragmentNodeId('a', 'b:root')).toBe('frag:a:b:root')
    expect(fragmentNodeId('a:b', 'root')).not.toBe(fragmentNodeId('a', 'b:root'))
    // The one decoder returns the RAW region id in every case.
    expect(fragmentRegionIdOf(fragmentNodeId('a:b', 'root'))).toBe('a:b')
    expect(fragmentRegionIdOf(fragmentNodeId('a', 'b:root'))).toBe('a')
    expect(fragmentRegionIdOf('workspace-center-home')).toBeNull()
  })

  it('an unpaired-surrogate region id fails honestly instead of throwing URIError', () => {
    const result = spliceFragmentDocument(fragmentDoc(), '\ud83d', registry)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('surrogate')
  })

  it('two regions produce disjoint namespaces from the SAME fragment', () => {
    const a = spliceFragmentDocument(fragmentDoc(), 'region-center', registry)
    const b = spliceFragmentDocument(fragmentDoc(), 'region-side', registry)
    if (!a.ok || !b.ok) throw new Error('expected both splices ok')
    const overlap = Object.keys(a.nodes).filter((id) => id in b.nodes)
    expect(overlap).toEqual([])
  })

  it('refuses a fragment naming an unregistered face — honest reason, never a splice', () => {
    const doc = fragmentDoc()
    const bad: LayoutDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'stat-quads': {
          kind: 'leaf',
          id: 'stat-quads',
          descriptorRevision: 0,
          descriptor: {
            schemaVersion: 1,
            faceId: 'not.a-registered-face',
            resource: { kind: 'iri', iri: 'urn:test:x' },
          },
        },
      },
    }
    const result = spliceFragmentDocument(bad, 'region-center', registry)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('validation')
  })

  it('refuses a structurally broken fragment (dangling split child)', () => {
    const doc = fragmentDoc()
    const broken: LayoutDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'stat-quads', endNodeId: 'nope', startBasisPoints: 3000 },
      },
    }
    const result = spliceFragmentDocument(broken, 'region-center', registry)
    expect(result.ok).toBe(false)
  })

  it('refuses a grid whose collection itemFaceId is unregistered (the deferred validate.ts gap)', () => {
    const doc = fragmentDoc({
      rootNodeId: 'grid',
      nodes: {
        grid: {
          kind: 'grid',
          id: 'grid',
          flow: 'reflow',
          minCellWidth: 200,
          gridRevision: 0,
          children: {
            kind: 'collection',
            collection: { kind: 'query', graphId: 'observatory', queryId: 'SELECT ?item WHERE { }' },
            itemFaceId: 'not.a-face',
            maxItems: 10,
          },
        },
      },
    })
    const result = spliceFragmentDocument(doc, 'region-center', registry)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain("unregistered collection itemFaceId 'not.a-face'")
  })

  it('SUPERSEDED refusal: a colon-bearing region id now splices cleanly — the encoding made it unambiguous', () => {
    // Until re-judge round 2 this was a refusal test ('embeddable grammar'):
    // colon region ids broke the frag:{regionId}:{nodeId} composite. The
    // region segment is now percent-encoded, so the same input is simply a
    // valid region — proven end-to-end.
    const result = spliceFragmentDocument(fragmentDoc(), 'region:evil', registry)
    if (!result.ok) throw new Error(`expected splice ok, got: ${result.reason}`)
    for (const id of Object.keys(result.nodes)) {
      expect(fragmentRegionIdOf(id)).toBe('region:evil')
    }
  })
})
