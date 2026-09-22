/**
 * observatory-layout-source.test.ts — real, no-mock coverage for the
 * ux:layoutJson loader (`observatory-layout-source.ts`): parse/validate/
 * fallback, per this module's own header contract.
 *
 * `MemoryRestClient` mirrors the established real-`RestClient`-test-double
 * convention already in this monorepo (`packages/runtime/src/editor-
 * services/__tests__/query-block-service.test.ts`'s own `MemoryRestClient`)
 * — a plain class implementing the real `@shrubbery/nucleus` `RestClient`
 * interface, no `vi.fn()`/mocking library. Every OTHER piece exercised here
 * — `makeQueryBlockService`, the real `FaceRegistry` + `sophia.home` face,
 * `createValidatedLayoutDocument`, and the loader itself — is the actual
 * production implementation.
 *
 * Grid-laneb hosted-dashboard review (commit 5e34694) WRONG findings 1/2/3/
 * 4/5 each get dedicated regression coverage below — see the comment on each
 * `it()`.
 */
import { describe, expect, it } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { makeQueryBlockService } from '@shrubbery/runtime'
import { FaceRegistry, createSophiaHomeFace } from '@shrubbery/runtime/layout'
import { createSophiaHomeDescriptor, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  OBSERVATORY_UX_SURFACE_IRI,
  ObservatoryLayoutSourceError,
  loadObservatoryLayoutDocument,
  loadObservatoryVegaTheme,
  observatoryLayoutJsonQuery,
  observatoryVegaThemeQuery,
  type LoadObservatoryLayoutDocumentOptions,
} from './observatory-layout-source.js'
import { buildObservatorySurfaceDocument } from './observatory-surface-document.js'

const GRAPH_ID = 'observatory-layout-source-test'

/** A real `RestClient` — records every call, answers a caller-supplied payload. No mocking library. */
class MemoryRestClient implements RestClient {
  readonly queries: Array<{ graphId: string; sparql: string }> = []
  constructor(private readonly payload: unknown) {}
  async graphs(): Promise<unknown> {
    throw new Error('not used')
  }
  async query(graphId: string, sparql: string): Promise<unknown> {
    this.queries.push({ graphId, sparql })
    return this.payload
  }
  async update(): Promise<void> {
    throw new Error('not used')
  }
}

/** A minimal, single-leaf, `sophia.home`-backed `LayoutDocument` — trivially valid + registered. */
function homeOnlyDocument(graphId: string): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'observatory-graph-authored-v1',
    scope: 'session',
    graphId,
    rootNodeId: 'Root',
    nodes: {
      Root: { kind: 'leaf', id: 'Root', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

/** A single-cell FIXED grid document — the only node shape validate.ts runs `isFaceGridEligible` against for a concrete descriptor. */
function fixedGridDocument(graphId: string): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'observatory-graph-authored-grid-v1',
    scope: 'session',
    graphId,
    rootNodeId: 'Grid',
    nodes: {
      Grid: {
        kind: 'grid',
        id: 'Grid',
        flow: 'reflow',
        minCellWidth: 200,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [{ id: 'cell-1', descriptor: createSophiaHomeDescriptor() }],
        },
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

/** A single collection-bound grid document naming `itemFaceId` — collection rows never enter `nodes`, so this is well-formed pre-render regardless of whether `itemFaceId` is registered. */
function collectionGridDocument(graphId: string, itemFaceId: string): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'observatory-graph-authored-collection-v1',
    scope: 'session',
    graphId,
    rootNodeId: 'Grid',
    nodes: {
      Grid: {
        kind: 'grid',
        id: 'Grid',
        flow: 'reflow',
        minCellWidth: 200,
        gridRevision: 0,
        children: {
          kind: 'collection',
          collection: { kind: 'query', graphId, queryId: 'SELECT ?item WHERE { ?item a <urn:test:Thing> }' },
          itemFaceId,
          maxItems: 10,
        },
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

/** The SAME registry/predicate bundle the live mount (`cell/layout-dashboard-mount.ts`) derives from its own sealed `FaceRegistry` at boot (sophia.home is enough for these fixtures). */
function realLoaderOptions(): Pick<
  LoadObservatoryLayoutDocumentOptions,
  'isFaceRegistered' | 'isFaceGridEligible' | 'hasRegisteredFace'
> {
  const registry = new FaceRegistry()
  registry.register(createSophiaHomeFace())
  registry.seal()
  return {
    isFaceRegistered: registry.toFaceRegistrationPredicate(),
    isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
    hasRegisteredFace: (faceId) => registry.has(faceId),
  }
}

function bindingsRow(layoutJsonValue: string): unknown {
  return { rows: [{ layoutJson: { type: 'literal', value: layoutJsonValue } }] }
}

describe('observatoryLayoutJsonQuery', () => {
  it('scopes to ux:config named graph + the well-known surface subject, LIMIT 2', () => {
    const sparql = observatoryLayoutJsonQuery(GRAPH_ID)
    expect(sparql).toContain('PREFIX ux: <http://mnemosyne.dev/ux#>')
    expect(sparql).toContain(`GRAPH <${uxConfigGraphIri(GRAPH_ID)}>`)
    expect(sparql).toContain(`<${OBSERVATORY_UX_SURFACE_IRI}> ux:layoutJson ?layoutJson`)
    expect(sparql.trim().startsWith('PREFIX ux:')).toBe(true)
    // WRONG finding 3: LIMIT 2 (not 1) — enough to detect a uniqueness violation.
    expect(sparql.trim().endsWith('LIMIT 2')).toBe(true)
  })

  it('rejects a graph id that cannot be embedded in a SPARQL IRI token (WRONG finding 4)', () => {
    expect(() => observatoryLayoutJsonQuery('has a space')).toThrow(ObservatoryLayoutSourceError)
    expect(() => observatoryLayoutJsonQuery('has>angle')).toThrow(ObservatoryLayoutSourceError)
  })
})

describe('loadObservatoryLayoutDocument', () => {
  it("source 'graph': loads + validates a real ux:layoutJson literal via the real QueryBlockService", async () => {
    const doc = homeOnlyDocument(GRAPH_ID)
    const rest = new MemoryRestClient(bindingsRow(JSON.stringify(doc)))
    const queryService = makeQueryBlockService(rest)

    const result = await loadObservatoryLayoutDocument({
      queryService,
      graphId: GRAPH_ID,
      ...realLoaderOptions(),
    })

    expect(result.source).toBe('graph')
    expect(result.doc.layoutId).toBe('observatory-graph-authored-v1')
    expect(result.doc.rootNodeId).toBe('Root')
    expect(result.doc.nodes.Root).toMatchObject({ kind: 'leaf', descriptor: { faceId: 'sophia.home' } })
    // The real query ran against the real RestClient exactly once, scoped to graphId.
    expect(rest.queries).toHaveLength(1)
    expect(rest.queries[0]?.graphId).toBe(GRAPH_ID)
    expect(rest.queries[0]?.sparql).toBe(observatoryLayoutJsonQuery(GRAPH_ID))
    // createValidatedLayoutDocument deep-freezes: the returned doc is immutable.
    expect(Object.isFrozen(result.doc)).toBe(true)
  })

  it("source 'fallback': zero rows -> the tabs-composed v1 surface document PARAMETERIZED BY THE REQUESTED graphId, never an error (WRONG finding 1; P7 graduates this fallback from the canned v0 dashboard)", async () => {
    const rest = new MemoryRestClient({ rows: [] })
    const queryService = makeQueryBlockService(rest)

    const result = await loadObservatoryLayoutDocument({
      queryService,
      graphId: GRAPH_ID,
      ...realLoaderOptions(),
    })

    expect(result.source).toBe('fallback')
    // The fallback must target the SAME graph the caller requested — not a
    // hard-coded 'observatory' — so every locator/named-graph the canned
    // document embeds actually matches what the page chrome claims.
    expect(result.doc).toEqual(buildObservatorySurfaceDocument(GRAPH_ID))
    expect(result.doc.graphId).toBe(GRAPH_ID)
    expect(result.doc.layoutId).toBe('observatory-surface-v1')
    const gridNode = result.doc.nodes.ObsPulseGaps
    if (gridNode?.kind !== 'grid' || gridNode.children.kind !== 'collection') {
      throw new Error('expected ObsPulseGaps to be a collection grid')
    }
    expect(gridNode.children.collection).toMatchObject({ graphId: GRAPH_ID })
    expect(gridNode.children.itemParams?.graphIri).toBe(GRAPH_ID)
  })

  it('throws ObservatoryLayoutSourceError when ux:layoutJson is not valid JSON (never silently falls back)', async () => {
    const rest = new MemoryRestClient(bindingsRow('{not valid json'))
    const queryService = makeQueryBlockService(rest)

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('is not valid JSON'),
    })
  })

  it('throws ObservatoryLayoutSourceError when ux:layoutJson names an unregistered face (never silently falls back)', async () => {
    const doc = homeOnlyDocument(GRAPH_ID)
    const unregisteredDoc: LayoutDocument = {
      ...doc,
      nodes: { Root: { ...doc.nodes.Root, descriptor: { schemaVersion: 1, faceId: 'not.a.registered.face', resource: { kind: 'iri', iri: 'urn:test:x' } } } },
    } as LayoutDocument
    const rest = new MemoryRestClient(bindingsRow(JSON.stringify(unregisteredDoc)))
    const queryService = makeQueryBlockService(rest)

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('failed LayoutDocument validation'),
    })
  })

  it('throws ObservatoryLayoutSourceError when the underlying query itself fails', async () => {
    class FailingRestClient implements RestClient {
      async graphs(): Promise<unknown> {
        throw new Error('not used')
      }
      async query(): Promise<unknown> {
        throw new Error('boom: gateway unreachable')
      }
      async update(): Promise<void> {
        throw new Error('not used')
      }
    }
    const queryService = makeQueryBlockService(new FailingRestClient())

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('querying ux:layoutJson'),
    })
  })

  it.each([
    ['null', null],
    ['empty object', {}],
    ['error envelope', { error: 'internal error' }],
  ])(
    'throws ObservatoryLayoutSourceError on a malformed 2xx SELECT response (%s) instead of silently falling back (WRONG finding 2)',
    async (_label, payload) => {
      const rest = new MemoryRestClient(payload)
      const queryService = makeQueryBlockService(rest)

      await expect(
        loadObservatoryLayoutDocument({
          queryService,
          graphId: GRAPH_ID,
          ...realLoaderOptions(),
        }),
      ).rejects.toMatchObject({
        constructor: ObservatoryLayoutSourceError,
        message: expect.stringContaining('querying ux:layoutJson'),
      })
    },
  )

  it('throws ObservatoryLayoutSourceError when more than one ux:layoutJson triple exists (WRONG finding 3)', async () => {
    const doc = homeOnlyDocument(GRAPH_ID)
    const payload = {
      rows: [
        { layoutJson: { type: 'literal', value: JSON.stringify(doc) } },
        { layoutJson: { type: 'literal', value: JSON.stringify({ ...doc, layoutId: 'other' }) } },
      ],
    }
    const rest = new MemoryRestClient(payload)
    const queryService = makeQueryBlockService(rest)

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('more than one ux:layoutJson triple'),
    })
  })

  it('throws ObservatoryLayoutSourceError when the ux:layoutJson binding is not a literal term (WRONG finding 3)', async () => {
    const rest = new MemoryRestClient({ rows: [{ layoutJson: { type: 'uri', value: 'urn:not:a:literal' } }] })
    const queryService = makeQueryBlockService(rest)

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('is not a literal term'),
    })
  })

  it('wires isFaceGridEligible through to validation — a grid-ineligible fixed-cell face is rejected, not silently accepted under the permissive default (WRONG finding 5)', async () => {
    const doc = fixedGridDocument(GRAPH_ID)
    const rest = new MemoryRestClient(bindingsRow(JSON.stringify(doc)))
    const queryService = makeQueryBlockService(rest)
    const base = realLoaderOptions()

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        isFaceRegistered: base.isFaceRegistered,
        // Deliberately ineligible regardless of face — proves this predicate
        // is actually threaded into createValidatedLayoutDocument (before
        // the fix, this option did not exist and validation silently used
        // validate.ts's permissive `() => true` default instead).
        isFaceGridEligible: () => false,
        hasRegisteredFace: base.hasRegisteredFace,
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('failed LayoutDocument validation'),
    })
  })

  it('accepts a collection grid naming a REGISTERED itemFaceId', async () => {
    const doc = collectionGridDocument(GRAPH_ID, 'sophia.home')
    const rest = new MemoryRestClient(bindingsRow(JSON.stringify(doc)))
    const queryService = makeQueryBlockService(rest)

    const result = await loadObservatoryLayoutDocument({
      queryService,
      graphId: GRAPH_ID,
      ...realLoaderOptions(),
    })
    expect(result.source).toBe('graph')
  })

  it('throws ObservatoryLayoutSourceError when a collection grid names an UNREGISTERED itemFaceId — validate.ts defers this to render time, this loader closes the gap up front (WRONG finding 5)', async () => {
    const doc = collectionGridDocument(GRAPH_ID, 'not.a.registered.face')
    const rest = new MemoryRestClient(bindingsRow(JSON.stringify(doc)))
    const queryService = makeQueryBlockService(rest)

    await expect(
      loadObservatoryLayoutDocument({
        queryService,
        graphId: GRAPH_ID,
        ...realLoaderOptions(),
      }),
    ).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('unregistered collection itemFaceId'),
    })
  })
})

describe('observatoryVegaThemeQuery', () => {
  it('mirrors observatoryLayoutJsonQuery exactly — same named graph, same subject, sibling predicate, LIMIT 2', () => {
    const sparql = observatoryVegaThemeQuery(GRAPH_ID)
    expect(sparql).toContain('PREFIX ux: <http://mnemosyne.dev/ux#>')
    expect(sparql).toContain(`GRAPH <${uxConfigGraphIri(GRAPH_ID)}>`)
    expect(sparql).toContain(`<${OBSERVATORY_UX_SURFACE_IRI}> ux:vegaTheme ?vegaTheme`)
    expect(sparql.trim().endsWith('LIMIT 2')).toBe(true)
  })

  it('rejects an unembeddable graph id — same guard as observatoryLayoutJsonQuery', () => {
    expect(() => observatoryVegaThemeQuery('has a space')).toThrow(ObservatoryLayoutSourceError)
  })
})

describe('loadObservatoryVegaTheme', () => {
  function vegaThemeRow(value: string): unknown {
    return { rows: [{ vegaTheme: { type: 'literal', value } }] }
  }

  it("source 'graph': loads + structurally validates a real ux:vegaTheme literal", async () => {
    const rest = new MemoryRestClient(vegaThemeRow(JSON.stringify({ axis: { gridColor: '#ff00ff' } })))
    const queryService = makeQueryBlockService(rest)

    const result = await loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })

    expect(result.source).toBe('graph')
    expect(result.theme).toEqual({ axis: { gridColor: '#ff00ff' } })
    expect(rest.queries).toHaveLength(1)
    expect(rest.queries[0]?.sparql).toBe(observatoryVegaThemeQuery(GRAPH_ID))
  })

  it("source 'fallback': zero rows -> theme: null, for ANY surface — never an error (a theme is always optional, unlike the layout)", async () => {
    const rest = new MemoryRestClient({ rows: [] })
    const queryService = makeQueryBlockService(rest)

    const result = await loadObservatoryVegaTheme({
      queryService,
      graphId: GRAPH_ID,
      surfaceIri: 'urn:sophia:ux:surface:some-other-surface',
    })

    expect(result).toEqual({ theme: null, source: 'fallback' })
  })

  it('throws ObservatoryLayoutSourceError when ux:vegaTheme is not valid JSON', async () => {
    const rest = new MemoryRestClient(vegaThemeRow('{not valid json'))
    const queryService = makeQueryBlockService(rest)

    await expect(loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('is not valid JSON'),
    })
  })

  it('throws ObservatoryLayoutSourceError when ux:vegaTheme is valid JSON but not a valid theme override (unknown top-level key)', async () => {
    const rest = new MemoryRestClient(vegaThemeRow(JSON.stringify({ notARealThemeKey: true })))
    const queryService = makeQueryBlockService(rest)

    await expect(loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('not a valid theme override'),
    })
  })

  it('throws ObservatoryLayoutSourceError when ux:vegaTheme is a JSON array (not a plain object)', async () => {
    const rest = new MemoryRestClient(vegaThemeRow(JSON.stringify(['axis'])))
    const queryService = makeQueryBlockService(rest)

    await expect(loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('not a valid theme override'),
    })
  })

  it('throws ObservatoryLayoutSourceError when more than one ux:vegaTheme triple exists', async () => {
    const payload = {
      rows: [
        { vegaTheme: { type: 'literal', value: JSON.stringify({ axis: {} }) } },
        { vegaTheme: { type: 'literal', value: JSON.stringify({ legend: {} }) } },
      ],
    }
    const rest = new MemoryRestClient(payload)
    const queryService = makeQueryBlockService(rest)

    await expect(loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('more than one ux:vegaTheme triple'),
    })
  })

  it('throws ObservatoryLayoutSourceError when the ux:vegaTheme binding is not a literal term', async () => {
    const rest = new MemoryRestClient({ rows: [{ vegaTheme: { type: 'uri', value: 'urn:not:a:literal' } }] })
    const queryService = makeQueryBlockService(rest)

    await expect(loadObservatoryVegaTheme({ queryService, graphId: GRAPH_ID })).rejects.toMatchObject({
      constructor: ObservatoryLayoutSourceError,
      message: expect.stringContaining('is not a literal term'),
    })
  })
})
