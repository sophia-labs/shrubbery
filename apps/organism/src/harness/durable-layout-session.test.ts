/**
 * durable-layout-session.test.ts — real, no-mock proof that
 * `createDurableLayoutSession` closes the PERSIST-ON-MUTATION loop: a
 * data-declared `LayoutEdge`'s structural change, fired over the session's own
 * intent source, AUTO-PERSISTS through the sink and is observed by a SECOND,
 * FRESH `loadObservatoryLayoutDocument` from the same store — with no explicit
 * persist call by the test.
 *
 * Everything is REAL (scripts/validate-no-mocks.mjs forbids vi.mock/vi.fn/etc.):
 * a real store-backed in-memory `RestClient` (`InMemoryLayoutConfigStore`,
 * mirrored from observatory-layout-sink.test.ts — an actual per-subject list of
 * literals so a uniqueness violation would genuinely surface), the real
 * `makeQueryBlockService`, real `FaceRegistry` + `sophia.home`, the real
 * `loadObservatoryLayoutDocument` loader, the real `installLayoutEdges`
 * interpreter over the session's real internal source, the real `applyOperation`
 * reducer, and the real `persistLayoutDocument` sink. No spies, no fakes.
 */
import { describe, expect, it } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { makeQueryBlockService } from '@shrubbery/runtime'
import { FaceRegistry, createSophiaHomeFace } from '@shrubbery/runtime/layout'
import {
  createSophiaHomeDescriptor,
  deepFreeze,
  validateLayoutDocument,
  type LayoutDocument,
  type LayoutEdge,
} from '@shrubbery/nucleus/layout'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  OBSERVATORY_UX_SURFACE_IRI,
  loadObservatoryLayoutDocument,
  type LoadObservatoryLayoutDocumentOptions,
} from './observatory-layout-source.js'
import { persistLayoutDocument } from './observatory-layout-sink.js'
import { createDurableLayoutSession } from './durable-layout-session.js'

const GRAPH_ID = 'durable-layout-session-test'

/**
 * A REAL, store-backed in-memory `RestClient` implementing BOTH sides: `query()`
 * answers the reader's `SELECT ?layoutJson` shape from the store, `update()`
 * applies the sink's `DELETE WHERE ; INSERT DATA`. It holds a LIST of literal
 * values per (graph, subject) so an additive insert would leave TWO rows and the
 * reader would (correctly) throw — the sink keeps it at one only because it
 * genuinely DELETEs first. Pattern-recognizes exactly the two SPARQL shapes this
 * pair emits, then mutates a plain `Map`. Mirrored from
 * observatory-layout-sink.test.ts (kept local — no shared test-double export).
 */
class InMemoryLayoutConfigStore implements RestClient {
  private readonly triples = new Map<string, string[]>()
  updateCount = 0

  private key(graphIri: string, subject: string): string {
    return `${graphIri} ${subject}`
  }

  rowCount(graphIri: string, subject: string): number {
    return (this.triples.get(this.key(graphIri, subject)) ?? []).length
  }

  async graphs(): Promise<unknown> {
    throw new Error('not used')
  }

  async query(_graphId: string, sparql: string): Promise<unknown> {
    const graphIri = firstGraphIri(sparql)
    const subject = firstSubject(sparql)
    const values = this.triples.get(this.key(graphIri, subject)) ?? []
    return { rows: values.map((value) => ({ layoutJson: { type: 'literal', value } })) }
  }

  async update(_graphId: string, sparql: string): Promise<void> {
    this.updateCount += 1
    const deleteIdx = sparql.indexOf('DELETE WHERE')
    const insertIdx = sparql.indexOf('INSERT DATA')

    if (deleteIdx >= 0) {
      const region = sparql.slice(deleteIdx, insertIdx >= 0 ? insertIdx : undefined)
      this.triples.delete(this.key(firstGraphIri(region), firstSubject(region)))
    }
    if (insertIdx >= 0) {
      const region = sparql.slice(insertIdx)
      const marker = `ux:layoutJson "`
      const markerIdx = region.indexOf(marker)
      if (markerIdx < 0) throw new Error('store: INSERT DATA missing ux:layoutJson literal')
      const value = scanSparqlLiteral(region, markerIdx + marker.length - 1)
      const key = this.key(firstGraphIri(region), firstSubject(region))
      this.triples.set(key, [...(this.triples.get(key) ?? []), value])
    }
  }
}

/**
 * A store whose `update()` REJECTS — everything else identical. Proves a durable
 * persist FAILURE surfaces (onPersistError + rejected whenPersisted) rather than
 * being swallowed. `query()` still works so `start()` can seed.
 */
class RejectingUpdateStore extends InMemoryLayoutConfigStore {
  override async update(): Promise<void> {
    throw new Error('store: update rejected (simulated durable-write failure)')
  }
}

function firstGraphIri(sparql: string): string {
  const match = /GRAPH\s+<([^>]+)>/.exec(sparql)
  if (!match) throw new Error('store: no GRAPH <iri> in SPARQL')
  return match[1]
}

function firstSubject(sparql: string): string {
  const match = /<([^>]+)>\s+ux:layoutJson/.exec(sparql)
  if (!match) throw new Error('store: no <subject> ux:layoutJson in SPARQL')
  return match[1]
}

function scanSparqlLiteral(text: string, openQuoteIdx: number): string {
  let out = ''
  let i = openQuoteIdx + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next
      i += 2
      continue
    }
    if (ch === '"') return out
    out += ch
    i += 1
  }
  throw new Error('store: unterminated SPARQL string literal')
}

/** The SAME registry/predicate bundle the loader is built against — sophia.home is enough for every fixture. */
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

/** A FRESH load straight from the store — the reload the loop proof observes (independent of any session). */
function load(store: RestClient) {
  return loadObservatoryLayoutDocument({
    queryService: makeQueryBlockService(store),
    graphId: GRAPH_ID,
    ...realLoaderOptions(),
  })
}

/** Two `sophia.home` leaves under one horizontal split (`LeafA` start, `LeafB` end). */
function multiLeafDocument(graphId: string, layoutId = 'durable-session-multi-v1'): LayoutDocument {
  const doc: LayoutDocument = {
    schemaVersion: 1,
    layoutId,
    scope: 'session',
    graphId,
    rootNodeId: 'Split',
    nodes: {
      Split: {
        kind: 'split',
        id: 'Split',
        axis: 'horizontal',
        startNodeId: 'LeafA',
        endNodeId: 'LeafB',
        startBasisPoints: 5000,
      },
      LeafA: { kind: 'leaf', id: 'LeafA', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
      LeafB: { kind: 'leaf', id: 'LeafB', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
    },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
  return deepFreeze(doc)
}

/**
 * Three `sophia.home` leaves nested `Split1(LeafA, Split2(LeafB, LeafC))` — lets
 * TWO successive `closesLeaf` fires each land on a still-present leaf (close
 * LeafA promotes Split2 to root; then close LeafB promotes LeafC to root).
 */
function threeLeafDocument(graphId: string): LayoutDocument {
  const doc: LayoutDocument = {
    schemaVersion: 1,
    layoutId: 'durable-session-three-v1',
    scope: 'session',
    graphId,
    rootNodeId: 'Split1',
    nodes: {
      Split1: {
        kind: 'split',
        id: 'Split1',
        axis: 'horizontal',
        startNodeId: 'LeafA',
        endNodeId: 'Split2',
        startBasisPoints: 5000,
      },
      Split2: {
        kind: 'split',
        id: 'Split2',
        axis: 'vertical',
        startNodeId: 'LeafB',
        endNodeId: 'LeafC',
        startBasisPoints: 5000,
      },
      LeafA: { kind: 'leaf', id: 'LeafA', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
      LeafB: { kind: 'leaf', id: 'LeafB', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
      LeafC: { kind: 'leaf', id: 'LeafC', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
    },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
  return deepFreeze(doc)
}

const CLOSER_EDGE: LayoutEdge[] = [{ from: 'closer', predicate: 'closesLeaf' }]

describe('createDurableLayoutSession — start() seeds from the right place', () => {
  it('(a) EMPTY store -> session begins from fallbackDoc (source:fallback)', async () => {
    const store = new InMemoryLayoutConfigStore()
    const fallbackDoc = multiLeafDocument(GRAPH_ID, 'durable-session-fallback-seed-v1')
    const session = createDurableLayoutSession({
      rest: store,
      graphId: GRAPH_ID,
      edges: CLOSER_EDGE,
      fallbackDoc,
    })

    const started = await session.start()
    expect(started.source).toBe('fallback')
    expect(started.doc).toEqual(fallbackDoc)
    expect(session.getDoc()).toEqual(fallbackDoc)
    session.dispose()
  })

  it('(a) PRE-SEEDED store -> session begins from THAT persisted doc (source:graph)', async () => {
    const store = new InMemoryLayoutConfigStore()
    // Durably seed the store first, then start a session with a DIFFERENT fallback.
    const seeded = multiLeafDocument(GRAPH_ID, 'durable-session-preseeded-v1')
    await persistLayoutDocument(store, { graphId: GRAPH_ID }, seeded)

    const otherFallback = multiLeafDocument(GRAPH_ID, 'durable-session-unused-fallback-v1')
    const session = createDurableLayoutSession({
      rest: store,
      graphId: GRAPH_ID,
      edges: CLOSER_EDGE,
      fallbackDoc: otherFallback,
    })

    const started = await session.start()
    expect(started.source).toBe('graph')
    expect(started.doc.layoutId).toBe('durable-session-preseeded-v1')
    expect(started.doc).toEqual(seeded)
    session.dispose()
  })
})

describe('createDurableLayoutSession — THE LOOP: edge mutation auto-persists', () => {
  it('(b) fire closesLeaf -> auto-persist -> a FRESH reload sees the mutation (no explicit persist by the test)', async () => {
    const store = new InMemoryLayoutConfigStore()
    const graphIri = uxConfigGraphIri(GRAPH_ID)
    const fallbackDoc = multiLeafDocument(GRAPH_ID, 'durable-session-loop-v1')

    const session = createDurableLayoutSession({
      rest: store,
      graphId: GRAPH_ID,
      edges: CLOSER_EDGE,
      fallbackDoc,
    })
    const started = await session.start()
    expect(started.source).toBe('fallback')
    // No layout literal exists yet — the session hasn't mutated anything.
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(0)

    // Fire the edge intent. The test NEVER calls persistLayoutDocument — the
    // closesLeaf EDGE drives applyOperation and the session's commit persists.
    session.fire({ from: 'closer', leafId: 'LeafA' })
    await session.whenPersisted()

    // In-memory: LeafA (and the now-degenerate Split) gone, LeafB promoted.
    expect(session.getDoc().nodes.LeafA).toBeUndefined()
    expect(session.getDoc().rootNodeId).toBe('LeafB')

    // EXACTLY one durable write, EXACTLY one triple (no duplication).
    expect(store.updateCount).toBe(1)
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(1)

    // THE PROOF: a SECOND, FRESH load from the SAME store sees the mutation.
    const reloaded = await load(store)
    expect(reloaded.source).toBe('graph')
    expect(reloaded.doc.nodes.LeafA).toBeUndefined()
    expect(reloaded.doc.nodes.Split).toBeUndefined()
    expect(reloaded.doc.rootNodeId).toBe('LeafB')
    expect(Object.isFrozen(reloaded.doc)).toBe(true)
    expect(validateLayoutDocument(reloaded.doc).ok).toBe(true)

    session.dispose()
  })

  it('(c) two rapid fires persist IN ORDER — store lands on the final doc, still exactly one triple', async () => {
    const store = new InMemoryLayoutConfigStore()
    const graphIri = uxConfigGraphIri(GRAPH_ID)
    const fallbackDoc = threeLeafDocument(GRAPH_ID)

    const session = createDurableLayoutSession({
      rest: store,
      graphId: GRAPH_ID,
      edges: CLOSER_EDGE,
      fallbackDoc,
    })
    await session.start()

    // Two rapid, synchronous fires — two commits, two persists enqueued on the
    // serialized chain before any settles.
    session.fire({ from: 'closer', leafId: 'LeafA' }) // -> Split2 promoted to root
    session.fire({ from: 'closer', leafId: 'LeafB' }) // -> LeafC promoted to root
    await session.whenPersisted()

    // Serialization held: both writes ran, in order; the store REPLACED (never
    // appended) each time, so exactly one triple remains.
    expect(store.updateCount).toBe(2)
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(1)

    // The store landed on the FINAL doc — the second fire's result, not the first.
    const reloaded = await load(store)
    expect(reloaded.source).toBe('graph')
    expect(reloaded.doc.rootNodeId).toBe('LeafC')
    expect(reloaded.doc.nodes.LeafA).toBeUndefined()
    expect(reloaded.doc.nodes.LeafB).toBeUndefined()
    expect(reloaded.doc.nodes.Split1).toBeUndefined()
    expect(reloaded.doc.nodes.Split2).toBeUndefined()
    expect(reloaded.doc.nodes.LeafC).toBeDefined()
    expect(validateLayoutDocument(reloaded.doc).ok).toBe(true)

    session.dispose()
  })
})

describe('createDurableLayoutSession — a persist FAILURE is surfaced, never swallowed', () => {
  it('(d) a rejecting store update() surfaces via onPersistError AND a rejected whenPersisted()', async () => {
    const store = new RejectingUpdateStore()
    const fallbackDoc = multiLeafDocument(GRAPH_ID, 'durable-session-failure-v1')

    let seenError: unknown
    let seenDoc: LayoutDocument | undefined
    const session = createDurableLayoutSession({
      rest: store,
      graphId: GRAPH_ID,
      edges: CLOSER_EDGE,
      fallbackDoc,
      onPersistError: (error, doc) => {
        seenError = error
        seenDoc = doc
      },
    })
    // start() only reads (query works) — the empty store seeds from fallback.
    const started = await session.start()
    expect(started.source).toBe('fallback')

    // The mutation applies in-memory (the reducer validated it) …
    session.fire({ from: 'closer', leafId: 'LeafA' })
    expect(session.getDoc().nodes.LeafA).toBeUndefined()

    // … but its durable write REJECTS — surfaced, not swallowed.
    await expect(session.whenPersisted()).rejects.toThrow('update rejected')

    // onPersistError was notified with the SAME failure and the mutated doc.
    expect(seenError).toBeInstanceOf(Error)
    expect((seenError as Error).message).toContain('update rejected')
    expect(seenDoc?.nodes.LeafA).toBeUndefined()
    expect(seenDoc?.rootNodeId).toBe('LeafB')

    session.dispose()
  })
})
