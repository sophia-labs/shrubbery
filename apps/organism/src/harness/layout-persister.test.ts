/**
 * layout-persister.test.ts — real, no-mock proof that `createLayoutPersister`
 * closes the durable persist loop the hosted observatory wires onto its layout
 * mutations: `persist(doc)` -> `whenSettled()` -> a SECOND, FRESH
 * `loadObservatoryLayoutDocument` from the same store observes the mutation
 * (`source:'graph'`); two rapid persists serialize to the final doc (one
 * triple); and a rejecting store surfaces via `onError` AND a rejecting
 * `whenSettled()` — never swallowed.
 *
 * Everything is REAL (scripts/validate-no-mocks.mjs forbids vi.mock/vi.fn/etc.):
 * a real store-backed in-memory `RestClient` (`InMemoryLayoutConfigStore`,
 * mirrored from observatory-layout-sink.test.ts — an actual per-subject list of
 * literals so a uniqueness violation would genuinely surface), the real
 * `makeQueryBlockService`, real `FaceRegistry` + `sophia.home`, the real
 * `loadObservatoryLayoutDocument` loader, and the real `persistLayoutDocument`
 * sink underneath the persister. No spies, no fakes.
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
} from '@shrubbery/nucleus/layout'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  OBSERVATORY_UX_SURFACE_IRI,
  loadObservatoryLayoutDocument,
  type LoadObservatoryLayoutDocumentOptions,
} from './observatory-layout-source.js'
import { createLayoutPersister } from './layout-persister.js'

const GRAPH_ID = 'layout-persister-test'

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
 * persist FAILURE surfaces (onError + rejected whenSettled) rather than being
 * swallowed. `query()` still works so a load can seed.
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

/** A FRESH load straight from the store — the reload the durability proof observes. */
function load(store: RestClient) {
  return loadObservatoryLayoutDocument({
    queryService: makeQueryBlockService(store),
    graphId: GRAPH_ID,
    ...realLoaderOptions(),
  })
}

/**
 * A horizontal split over two `sophia.home` leaves. `startBasisPoints` stands in
 * for a divider ratio — the exact structural payload a `set_ratio` op in the
 * observatory mutates and this persister durably writes.
 */
function ratioDocument(startBasisPoints: number, layoutId = 'layout-persister-ratio-v1'): LayoutDocument {
  const doc: LayoutDocument = {
    schemaVersion: 1,
    layoutId,
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'Split',
    nodes: {
      Split: {
        kind: 'split',
        id: 'Split',
        axis: 'horizontal',
        startNodeId: 'LeafA',
        endNodeId: 'LeafB',
        startBasisPoints,
      },
      LeafA: { kind: 'leaf', id: 'LeafA', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
      LeafB: { kind: 'leaf', id: 'LeafB', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
    },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
  return deepFreeze(doc)
}

describe('createLayoutPersister — a persisted mutation survives a reload', () => {
  it('(a) empty store -> fallback; persist(doc) -> whenSettled -> FRESH load sees it (source:graph, one triple)', async () => {
    const store = new InMemoryLayoutConfigStore()
    const graphIri = uxConfigGraphIri(GRAPH_ID)

    // Nothing persisted yet — a fresh load falls back.
    const before = await load(store)
    expect(before.source).toBe('fallback')
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(0)

    const persister = createLayoutPersister({ rest: store, graphId: GRAPH_ID })
    const mutated = ratioDocument(3300, 'layout-persister-resized-v1')
    persister.persist(mutated)
    await persister.whenSettled()

    // Exactly one durable write, exactly one triple (replace, never append).
    expect(store.updateCount).toBe(1)
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(1)

    // THE PROOF: a SECOND, FRESH load observes the mutated doc.
    const reloaded = await load(store)
    expect(reloaded.source).toBe('graph')
    expect(reloaded.doc).toEqual(mutated)
    expect((reloaded.doc.nodes.Split as { startBasisPoints: number }).startBasisPoints).toBe(3300)
    expect(Object.isFrozen(reloaded.doc)).toBe(true)
    expect(validateLayoutDocument(reloaded.doc).ok).toBe(true)
  })

  it('(b) two rapid persists serialize IN ORDER — store lands on the final doc, still exactly one triple', async () => {
    const store = new InMemoryLayoutConfigStore()
    const graphIri = uxConfigGraphIri(GRAPH_ID)
    const persister = createLayoutPersister({ rest: store, graphId: GRAPH_ID })

    // Two rapid, synchronous persists (a drag emitting successive set_ratio ops):
    // both enqueue on the serialized chain before either settles.
    persister.persist(ratioDocument(2000, 'layout-persister-first-v1'))
    persister.persist(ratioDocument(8000, 'layout-persister-final-v2'))
    await persister.whenSettled()

    // Serialization held: both writes ran, in order; each REPLACED, so one triple.
    expect(store.updateCount).toBe(2)
    expect(store.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(1)

    // The store landed on the SECOND (final) doc, not the first.
    const reloaded = await load(store)
    expect(reloaded.source).toBe('graph')
    expect(reloaded.doc.layoutId).toBe('layout-persister-final-v2')
    expect((reloaded.doc.nodes.Split as { startBasisPoints: number }).startBasisPoints).toBe(8000)
    expect(validateLayoutDocument(reloaded.doc).ok).toBe(true)
  })

  it('(c) a rejecting store update() surfaces via onError AND a rejected whenSettled() — never swallowed', async () => {
    const store = new RejectingUpdateStore()

    let seenError: unknown
    let seenDoc: LayoutDocument | undefined
    const persister = createLayoutPersister({
      rest: store,
      graphId: GRAPH_ID,
      onError: (error, doc) => {
        seenError = error
        seenDoc = doc
      },
    })

    const doc = ratioDocument(4200, 'layout-persister-failure-v1')
    persister.persist(doc)

    // The durable write REJECTS — surfaced through whenSettled(), not swallowed.
    await expect(persister.whenSettled()).rejects.toThrow('update rejected')

    // onError was notified with the SAME failure and the doc whose persist failed.
    expect(seenError).toBeInstanceOf(Error)
    expect((seenError as Error).message).toContain('update rejected')
    expect(seenDoc).toBe(doc)
  })

  it('(c) a failed persist does NOT stall the chain — a later good persist still lands', async () => {
    // Proves the serialization gate stays alive across a failing write so
    // subsequent writes are not lost (the durable session relies on this too).
    const graphIri = uxConfigGraphIri(GRAPH_ID)

    let errorCount = 0
    let rejectNext = true
    // A store that rejects only its FIRST update, then behaves normally.
    class FlakyFirstStore extends InMemoryLayoutConfigStore {
      override async update(graphId: string, sparql: string): Promise<void> {
        if (rejectNext) {
          rejectNext = false
          throw new Error('store: transient first-write failure')
        }
        return super.update(graphId, sparql)
      }
    }
    const flaky = new FlakyFirstStore()

    const persister = createLayoutPersister({
      rest: flaky,
      graphId: GRAPH_ID,
      onError: () => {
        errorCount += 1
      },
    })

    persister.persist(ratioDocument(1500, 'layout-persister-flaky-1'))
    // First settle rejects.
    await expect(persister.whenSettled()).rejects.toThrow('transient first-write failure')

    persister.persist(ratioDocument(6600, 'layout-persister-flaky-2'))
    await persister.whenSettled()

    expect(errorCount).toBe(1)
    // The second (good) write landed despite the first failing — chain not stalled.
    expect(flaky.rowCount(graphIri, OBSERVATORY_UX_SURFACE_IRI)).toBe(1)
    const reloaded = await load(flaky)
    expect(reloaded.source).toBe('graph')
    expect(reloaded.doc.layoutId).toBe('layout-persister-flaky-2')
  })
})
