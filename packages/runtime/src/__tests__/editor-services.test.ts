/**
 * editor-services.test.ts — the EditorServices ontology exercised against REAL infra.
 *
 *  - READS (WikiLinkSearchService): REAL GRAPH-scoped SELECT through a RestClient backed by
 *    a REAL Oxigraph engine seeded into …:projection:workspace (the L2a harness). Because
 *    the harness has NO union-default-graph, a wrong GRAPH clause returns nothing — so the
 *    greens MEAN the clause is right. Pure projection reads are cell-faithful (they pass the
 *    real cell's authority gate), so this stays the truest harness for reads.
 *
 *  - WIRE WRITES (WireService): RESEATED onto the contract's WireWriter seam (L2c). The OLD
 *    raw-projection-SPARQL door is RETIRED — a real cell REJECTS it (rdf_authority.rs). The
 *    proof is now two-sided: (1) a NEGATIVE proof that wireInsertSparql/wireDeleteSparql
 *    emit byte-for-byte the GRAPH <…:projection:workspace> form the gate rejects (the one
 *    executable witness the old door is wrong), and (2) a SEAM-ENVELOPE proof that
 *    WireService.create/delete emit the EXACT create_wires / delete{type:'wires'} envelope
 *    the cell accepts (asserted against a real capture WireWriter, not a stub that fakes
 *    acceptance). The executed real-cell materialization round-trip is OUT OF SCOPE on this
 *    POC branch (no live gardend cell / LoopbackTransport harness here) — verified by
 *    reading the cell's Rust schema, not executed.
 *
 * navigation + buildKernelOptions are exercised over REAL CustomEvents on a REAL
 * EventTarget (the default eventNavigationService) — the deferred piece is only the
 * shell-side LISTENER, which stays labelled, never faked.
 */

import { describe, it, expect } from 'vitest'
import type { BlockScore, EditorScope, SalienceService, WireWriter, WireCreateRequest } from '@shrubbery/nucleus'
import {
  makeOxigraphRestClient,
  seedWorkspaceStore,
  queryStore,
  workspaceProjectionGraphIri,
} from './named-graph-store.js'
import {
  assembleEditorServices,
  buildKernelOptions,
  docListSparql,
  eventNavigationService,
  OPEN_DOCUMENT_EVENT,
  OPEN_ZOTERO_SOURCE_EVENT,
  fuzzyFilterDocuments,
  makeWikiLinkSearchService,
  makeScopedWireBundleLoader,
  wikilinkBlockListSparql,
  wikilinkBlockRowsToItems,
  tagSuggestionListSparql,
  tagSuggestionsFromRows,
  makeWireBundleService,
  wireBundleSparql,
  wireInsertSparql,
  wireDeleteSparql,
  makeSalienceBundleService,
  makeScopedSalienceBundleLoader,
  captureSalienceScore,
  withSalienceScore,
  rollbackSalienceScore,
  signalLevel,
  signalIcon,
  nextImportance,
  nextValence,
  importanceIcon,
  isVeryImportant,
  hasUserImportance,
  valenceIcon,
  importanceLabel,
  valenceLabel,
  combinedImportance,
  combinedValence,
  type WikiLinkSuggestionItem,
} from '../editor-services/index.js'

/**
 * A REAL capture WireWriter — records the exact envelope each call would send. NOT a stub
 * that fakes acceptance: it asserts the shape the cell's create_wires / delete schema
 * actually requires (source/target_document_id present, caller wire_id honored, type:wires).
 * This is the "faithful loopback" the seam-envelope proof drives.
 */
interface CapturedCreate {
  readonly graphId: string
  readonly params: WireCreateRequest
}
interface CapturedDelete {
  readonly graphId: string
  readonly wireId: string
}
function captureWireWriter(): {
  writer: WireWriter
  creates: CapturedCreate[]
  deletes: CapturedDelete[]
} {
  const creates: CapturedCreate[] = []
  const deletes: CapturedDelete[] = []
  const writer: WireWriter = {
    async create(graphId, params) {
      creates.push({ graphId, params })
      return { wireId: params.wireId ?? '' }
    },
    async delete(graphId, wireId) {
      deletes.push({ graphId, wireId })
    },
  }
  return { writer, creates, deletes }
}

const GRAPH_ID = 'graph-a'
const WS = workspaceProjectionGraphIri(GRAPH_ID)

const DOCS = [
  { id: 'doc-architecture', title: 'Architecture' },
  { id: 'doc-arch-notes', title: 'Arch Notes' },
  { id: 'doc-billing', title: 'Billing' },
  { id: 'doc-untitled' }, // no dcterms:title → COALESCE 'Untitled'
]

const WIRES = [
  {
    id: 'wire-out',
    sourceDocumentId: 'doc-architecture',
    sourceBlockId: 'block-a',
    targetDocumentId: 'doc-billing',
    targetBlockId: 'block-b',
    targetGraphId: 'graph-b',
    predicate: 'supports',
    targetTitle: 'Billing Override',
    sourceSnippet: 'local architecture text',
    targetSnippet: 'remote billing text',
    snapshotAt: '2026-06-22T12:00:00Z',
  },
  {
    id: 'wire-in',
    sourceDocumentId: 'doc-billing',
    sourceBlockId: 'block-source',
    targetDocumentId: 'doc-architecture',
    targetBlockId: 'block-c',
    predicate: 'relatedTo',
  },
  {
    id: 'wire-bi',
    sourceDocumentId: 'doc-architecture',
    sourceBlockId: 'block-bi-local',
    targetDocumentId: 'doc-billing',
    targetBlockId: 'block-bi-remote',
    predicate: 'partOf',
    bidirectional: true,
  },
  {
    id: 'wire-bi-inv',
    sourceDocumentId: 'doc-billing',
    sourceBlockId: 'block-bi-remote',
    targetDocumentId: 'doc-architecture',
    targetBlockId: 'block-bi-local',
    predicate: 'partOf',
    bidirectional: true,
  },
]

function blockScore(overrides: Partial<BlockScore> = {}): BlockScore {
  return {
    blockId: 'block-a',
    documentId: 'doc-architecture',
    cumulativeImportance: 0,
    cumulativeValence: 0,
    rawImportanceSum: 0,
    rawValenceSum: 0,
    importanceCount: 0,
    valenceCount: 0,
    compositeScore: 0,
    blockWireCount: 0,
    docWireCount: 0,
    lastValuatedAt: null,
    userImportance: null,
    userValence: null,
    ...overrides,
  }
}

function documentScope(): () => EditorScope {
  return () => ({ centerMode: 'document', graphId: GRAPH_ID, documentId: 'doc-architecture' })
}
function homeScope(): () => EditorScope {
  return () => ({ centerMode: 'home', graphId: null, documentId: null })
}

describe('WikiLinkSearchService — GRAPH-scoped SELECT against the real store', () => {
  it('fetches the doc list (GRAPH-scoped) and fuzzy-filters host-side', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const rest = makeOxigraphRestClient(store)
    const services = assembleEditorServices(rest, captureWireWriter().writer, documentScope())

    const results = await services.wikiLinkSearch.suggest('arch')
    const labels = results.map((r) => r.label)
    // 'Architecture' (startsWith) + 'Arch Notes' (startsWith) match; 'Billing' does not.
    expect(labels).toContain('Architecture')
    expect(labels).toContain('Arch Notes')
    expect(labels).not.toContain('Billing')
    // ids are the bare document ids (parsed back from the urn).
    expect(results.find((r) => r.label === 'Architecture')?.id).toBe('doc-architecture')
  })

  it('REGRESSION PROOF: the adapter FINDS docs, but the GRAPH-less variant finds NOTHING', () => {
    // The CRITICAL paired assertion (the L2a bug the harness exists to catch): the
    // adapter's REAL GRAPH-scoped doc-list SELECT returns the seeded docs, while the SAME
    // query with its GRAPH wrapper stripped returns ZERO — proving the green is owed to a
    // correct GRAPH clause, not to a union-default-graph store that would pass either way.
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const scoped = queryStore(store, docListSparql(GRAPH_ID))
    expect(scoped.rows.length).toBe(DOCS.length) // FINDS them, GRAPH-scoped

    // Strip the `GRAPH <…> { … }` wrapper (keep the inner pattern) → DEFAULT graph → empty.
    const ws = workspaceProjectionGraphIri(GRAPH_ID)
    const noGraph = docListSparql(GRAPH_ID)
      .replace(`GRAPH <${ws}> {`, '')
      .replace(/}\s*}$/, '}')
    expect(queryStore(store, noGraph).rows).toEqual([]) // GRAPH-less ⇒ NOTHING
  })

  it('falls back to doc:title when dcterms:title is absent (COALESCE over both)', async () => {
    // A doc with ONLY doc:title (no dcterms:title) — the picker must surface it via the
    // COALESCE fallback, not as "Untitled".
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-legacy', docTitle: 'Legacy Title' },
    ])
    const services = assembleEditorServices(makeOxigraphRestClient(store), captureWireWriter().writer, documentScope())
    const all = await services.wikiLinkSearch.suggest('')
    expect(all.find((r) => r.id === 'doc-legacy')?.label).toBe('Legacy Title')
  })

  it('empty query returns the full list incl. the untitled doc as "Untitled"', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const services = assembleEditorServices(makeOxigraphRestClient(store), captureWireWriter().writer, documentScope())
    const all = await services.wikiLinkSearch.suggest('')
    expect(all.map((r) => r.label).sort()).toEqual(
      ['Arch Notes', 'Architecture', 'Billing', 'Untitled'].sort(),
    )
  })

  it('home scope returns [] WITHOUT issuing a query', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    let queried = false
    const rest = makeOxigraphRestClient(store)
    const spyRest = {
      ...rest,
      query: (g: string, s: string) => {
        queried = true
        return rest.query(g, s)
      },
    }
    const services = assembleEditorServices(spyRest, captureWireWriter().writer, homeScope())
    expect(await services.wikiLinkSearch.suggest('arch')).toEqual([])
    expect(queried).toBe(false)
  })

  it('loads once per graph and locally re-filters successive composer queries', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const rest = makeOxigraphRestClient(store)
    let queryCount = 0
    const service = makeWikiLinkSearchService({
      ...rest,
      query: (graphId: string, sparql: string) => {
        queryCount += 1
        return rest.query(graphId, sparql)
      },
    }, () => ({ graphId: GRAPH_ID }))

    expect((await service.suggest('a')).length).toBeGreaterThan(0)
    expect((await service.suggest('arch')).map(item => item.label)).toContain('Architecture')
    expect(await service.suggest('billing')).toEqual([
      expect.objectContaining({ id: 'doc-billing', label: 'Billing' }),
    ])
    expect(queryCount).toBe(1)
  })
})

describe('WikiLinkBlockSearchService — target-document blocks from the projection graph', () => {
  it('fetches ordered blocks for a selected document and filters host-side', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      {
        id: 'doc-billing',
        title: 'Billing',
        blocks: [
          { id: 'block-title', type: 'heading', level: 2, text: 'Billing model', order: 0 },
          { id: 'block-price', type: 'paragraph', text: 'Pricing plans and invoices', order: 1 },
          { id: 'block-code', type: 'codeBlock', text: 'const amount = 42', order: 2 },
        ],
      },
    ])
    const services = assembleEditorServices(makeOxigraphRestClient(store), captureWireWriter().writer, documentScope())

    expect(await services.wikiLinkBlocks.suggest('doc-billing', '')).toEqual([
      {
        id: 'block-title',
        type: 'heading',
        level: 2,
        text: 'Billing model',
        preview: 'Billing model',
      },
      {
        id: 'block-price',
        type: 'paragraph',
        text: 'Pricing plans and invoices',
        preview: 'Pricing plans and invoices',
      },
      {
        id: 'block-code',
        type: 'codeBlock',
        text: 'const amount = 42',
        preview: 'const amount = 42',
      },
    ])
    expect(await services.wikiLinkBlocks.suggest('doc-billing', 'invoice')).toEqual([
      {
        id: 'block-price',
        type: 'paragraph',
        text: 'Pricing plans and invoices',
        preview: 'Pricing plans and invoices',
      },
    ])
  })

  it('REGRESSION PROOF: block query is GRAPH-scoped, while the GRAPH-less variant is empty', () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      {
        id: 'doc-billing',
        title: 'Billing',
        blocks: [{ id: 'block-title', type: 'heading', level: 1, text: 'Billing', order: 0 }],
      },
    ])
    const scoped = queryStore(store, wikilinkBlockListSparql(GRAPH_ID, 'doc-billing'))
    expect(wikilinkBlockRowsToItems(scoped.rows)).toEqual([
      { id: 'block-title', type: 'heading', level: 1, text: 'Billing', preview: 'Billing' },
    ])

    const ws = workspaceProjectionGraphIri(GRAPH_ID)
    const noGraph = wikilinkBlockListSparql(GRAPH_ID, 'doc-billing')
      .replace(`GRAPH <${ws}> {`, '')
      .replace(/}\s*}\s*ORDER BY/, '} ORDER BY')
    expect(queryStore(store, noGraph).rows).toEqual([])
  })

  it('home scope returns [] without issuing a block query', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      {
        id: 'doc-billing',
        title: 'Billing',
        blocks: [{ id: 'block-title', type: 'heading', level: 1, text: 'Billing', order: 0 }],
      },
    ])
    let queried = false
    const rest = makeOxigraphRestClient(store)
    const spyRest = {
      ...rest,
      query: (g: string, s: string) => {
        queried = true
        return rest.query(g, s)
      },
    }
    const services = assembleEditorServices(spyRest, captureWireWriter().writer, homeScope())
    expect(await services.wikiLinkBlocks.suggest('doc-billing', '')).toEqual([])
    expect(queried).toBe(false)
  })
})

describe('TagSearchService — core tags plus GRAPH-scoped observed tags', () => {
  it('home scope returns core tags WITHOUT issuing a query', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const rest = makeOxigraphRestClient(store)
    let queried = false
    const spyRest = {
      ...rest,
      query: (g: string, s: string) => {
        queried = true
        return rest.query(g, s)
      },
    }
    const services = assembleEditorServices(spyRest, captureWireWriter().writer, homeScope())

    expect(await services.tagSearch.suggest('to')).toEqual([
      { name: 'todo', description: 'An action item.', isCore: true },
    ])
    expect(queried).toBe(false)
  })

  it('merges core and observed doc:hasTag values from the named projection graph', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture', tags: ['Shrubbery', 'Pragma'] },
      { id: 'doc-billing', title: 'Billing', tags: ['roadmap'] },
    ])
    const services = assembleEditorServices(
      makeOxigraphRestClient(store),
      captureWireWriter().writer,
      documentScope(),
    )

    expect(await services.tagSearch.suggest('shr')).toEqual([
      { name: 'shrubbery', isCore: false },
    ])
    expect(await services.tagSearch.suggest('pr')).toEqual([
      { name: 'pragma', description: 'Operational knowledge: deploy, debug, configure.', isCore: true },
    ])
  })

  it('REGRESSION PROOF: the observed-tag query is GRAPH-scoped', () => {
    const store = seedWorkspaceStore(GRAPH_ID, [
      { id: 'doc-architecture', title: 'Architecture', tags: ['shrubbery'] },
    ])
    const scoped = queryStore(store, tagSuggestionListSparql(GRAPH_ID))
    expect(tagSuggestionsFromRows(scoped.rows)).toEqual([{ name: 'shrubbery', isCore: false }])

    const noGraph = tagSuggestionListSparql(GRAPH_ID)
      .replace(`GRAPH <${WS}> {`, '')
      .replace(/}\s*}\s*ORDER BY/, '}\nORDER BY')
    expect(queryStore(store, noGraph).rows).toEqual([])
  })
})

describe('WireService — RESEATED onto the cell-faithful WireWriter seam (L2c)', () => {
  it('create() emits the create_wires envelope shape the cell accepts (host-minted wire_id honored)', async () => {
    const { writer, creates } = captureWireWriter()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      writer,
      documentScope(),
    )

    const { wireId } = await services.wire.create({
      sourceDocumentId: 'doc-architecture',
      sourceBlockId: 'b1',
      targetDocumentId: 'doc-billing',
      predicate: 'relatedTo',
    })
    expect(wireId).toMatch(/^wire-/)

    // EXACTLY ONE create on the seam, carrying the schema the cell's create_wires REQUIRES:
    // source/target_document_id present, the caller-minted wire_id, bidirectional false, the
    // wikilink predicate passed explicitly, and the wire scoped to the open graph.
    expect(creates).toHaveLength(1)
    const { graphId, params } = creates[0]
    expect(graphId).toBe(GRAPH_ID)
    expect(params.sourceDocumentId).toBe('doc-architecture')
    expect(params.targetDocumentId).toBe('doc-billing')
    expect(params.sourceBlockId).toBe('b1')
    expect(params.predicate).toBe('relatedTo')
    expect(params.bidirectional).toBe(false)
    expect(params.wireId).toBe(wireId) // host mints it; the cell honors a caller-supplied id
  })

  it('create() defaults the wikilink predicate so the materialized wire matches the legacy shape', async () => {
    const { writer, creates } = captureWireWriter()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      writer,
      documentScope(),
    )
    await services.wire.create({ sourceDocumentId: 'doc-architecture', targetDocumentId: 'doc-billing' })
    // No predicate supplied ⇒ DEFAULT_WIKILINK_PREDICATE ('relatedTo'), NOT the cell's own
    // create_wires default ('isWiredTo'). The seam passes it explicitly.
    expect(creates[0].params.predicate).toBe('relatedTo')
    expect(creates[0].params.bidirectional).toBe(false)
  })

  it('delete() emits the generic delete{type:wires} envelope (no delete_wires tool exists)', async () => {
    const { writer, deletes } = captureWireWriter()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      writer,
      documentScope(),
    )
    await services.wire.delete('wire-xyz')
    expect(deletes).toEqual([{ graphId: GRAPH_ID, wireId: 'wire-xyz' }])
  })

  it('create() in home scope throws (no graph to live in)', async () => {
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      captureWireWriter().writer,
      homeScope(),
    )
    await expect(
      services.wire.create({ sourceDocumentId: 'a', targetDocumentId: 'b' }),
    ).rejects.toThrow(/no open graph/)
  })
})

describe('WireBundleService — GRAPH-scoped read bundle against the real store', () => {
  it('maps outgoing/incoming wires and derives wired block ids', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS, WIRES)
    const bundle = await makeWireBundleService(makeOxigraphRestClient(store)).loadBundle(
      GRAPH_ID,
      'doc-architecture',
    )

    expect(bundle.outgoingWires.map((wire) => wire.id)).toEqual(['wire-bi', 'wire-out'])
    expect(bundle.incomingWires.map((wire) => wire.id)).toEqual(['wire-in'])
    expect(bundle.wiredBlockIds).toEqual(['block-a', 'block-bi-local', 'block-c'])

    const outgoing = bundle.outgoingWires.find((wire) => wire.id === 'wire-out')
    expect(outgoing).toMatchObject({
      predicate: 'http://mnemosyne.ai/vocab#supports',
      predicateLabel: 'supports',
      otherDocumentId: 'doc-billing',
      otherGraphId: 'graph-b',
      otherBlockId: 'block-b',
      localBlockId: 'block-a',
      otherTitle: 'Billing Override',
      otherSnippet: 'remote billing text',
      localSnippet: 'local architecture text',
      bidirectional: false,
      snapshotAt: '2026-06-22T12:00:00Z',
    })

    const incoming = bundle.incomingWires[0]
    expect(incoming).toMatchObject({
      id: 'wire-in',
      otherDocumentId: 'doc-billing',
      otherGraphId: GRAPH_ID,
      otherBlockId: 'block-source',
      localBlockId: 'block-c',
      otherTitle: 'Billing',
    })
  })

  it('REGRESSION PROOF: the wire bundle query is GRAPH-scoped', () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS, WIRES)
    const scoped = queryStore(store, wireBundleSparql(GRAPH_ID, 'doc-architecture'))
    expect(scoped.rows.length).toBeGreaterThan(0)

    const noGraph = wireBundleSparql(GRAPH_ID, 'doc-architecture')
      .replace(`GRAPH <${WS}> {`, '')
      .replace(/}\s*}\s*ORDER BY/, '}\nORDER BY')
    expect(queryStore(store, noGraph).rows).toEqual([])
  })

  it('marks both local endpoints for same-document wires', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS, [
      {
        id: 'wire-self',
        sourceDocumentId: 'doc-architecture',
        sourceBlockId: 'block-source',
        targetDocumentId: 'doc-architecture',
        targetBlockId: 'block-target',
      },
    ])

    const bundle = await makeWireBundleService(makeOxigraphRestClient(store)).loadBundle(
      GRAPH_ID,
      'doc-architecture',
    )

    expect(bundle.wiredBlockIds).toEqual(['block-source', 'block-target'])
  })

  it('scoped loader returns an empty bundle without querying when no document is open', async () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS, WIRES)
    const rest = makeOxigraphRestClient(store)
    let queried = false
    const loader = makeScopedWireBundleLoader(
      {
        ...rest,
        query(graphId: string, sparql: string) {
          queried = true
          return rest.query(graphId, sparql)
        },
      },
      homeScope(),
    )

    await expect(loader()).resolves.toEqual({
      outgoingWires: [],
      incomingWires: [],
      wiredBlockIds: [],
    })
    expect(queried).toBe(false)
  })
})

describe('SalienceBundleService — read side over the contract seam (not RestClient)', () => {
  it('loads scores from SalienceService.getScores and keys them by blockId', async () => {
    const scores = [
      blockScore({ blockId: 'block-a', compositeScore: 0.5 }),
      blockScore({ blockId: 'block-b', compositeScore: 0.1 }),
    ]
    const salience: SalienceService = {
      getScores: async (graphId, documentId) => {
        expect(graphId).toBe(GRAPH_ID)
        expect(documentId).toBe('doc-architecture')
        return scores
      },
      setUserValue: async () => blockScore(),
    }
    const bundle = await makeSalienceBundleService(salience).loadBundle(GRAPH_ID, 'doc-architecture')
    expect(bundle.scores.size).toBe(2)
    expect(bundle.scores.get('block-a')?.compositeScore).toBe(0.5)
    expect(bundle.scores.get('block-b')?.compositeScore).toBe(0.1)
  })

  it('scoped loader returns an empty bundle without calling the seam when no document is open', async () => {
    let called = false
    const salience: SalienceService = {
      getScores: async () => { called = true; return [] },
      setUserValue: async () => blockScore(),
    }
    const loader = makeScopedSalienceBundleLoader(salience, homeScope())
    await expect(loader()).resolves.toEqual({ scores: new Map() })
    expect(called).toBe(false)
  })

  it('rolls back only the failed optimistic block and preserves unrelated newer ratings', () => {
    const originalA = blockScore({ blockId: 'block-a', userImportance: 3 })
    const originalB = blockScore({ blockId: 'block-b', userValence: null })
    const initial = { scores: new Map([
      ['block-a', originalA],
      ['block-b', originalB],
    ]) }
    const checkpoint = captureSalienceScore(initial, 'block-a')
    const optimisticA = withSalienceScore(initial, blockScore({
      blockId: 'block-a', userImportance: 5,
    }))
    const concurrentB = withSalienceScore(optimisticA, blockScore({
      blockId: 'block-b', userValence: 4,
    }))

    const rolledBack = rollbackSalienceScore(concurrentB, 'block-a', checkpoint)
    expect(rolledBack?.scores.get('block-a')).toBe(originalA)
    expect(rolledBack?.scores.get('block-b')?.userValence).toBe(4)

    const absent = captureSalienceScore(null, 'block-c')
    expect(rollbackSalienceScore(
      withSalienceScore(null, blockScore({ blockId: 'block-c', userImportance: 3 })),
      'block-c',
      absent,
    )).toBeNull()
  })
})

describe('SalienceBundleService — pure display/cycling helpers (ported from the OG ValuationController)', () => {
  it('buckets composite score into 5 signal levels at the calibrated thresholds', () => {
    expect(signalLevel(undefined)).toBeNull()
    expect(signalLevel(blockScore({ compositeScore: 0.29 }))).toBe(0)
    expect(signalLevel(blockScore({ compositeScore: 0.3 }))).toBe(1)
    expect(signalLevel(blockScore({ compositeScore: 0.44 }))).toBe(2)
    expect(signalLevel(blockScore({ compositeScore: 0.52 }))).toBe(3)
    expect(signalLevel(blockScore({ compositeScore: 0.565 }))).toBe(4)
    expect(signalIcon(undefined)).toBe('signal-zero')
    expect(signalIcon(blockScore({ compositeScore: 0.9 }))).toBe('signal')
  })

  it('cycles importance null → 3 → 5 → 0 → null, and valence null → 4 → -4 → null', () => {
    expect(nextImportance(undefined)).toBe(3)
    expect(nextImportance(blockScore({ userImportance: 3 }))).toBe(5)
    expect(nextImportance(blockScore({ userImportance: 5 }))).toBe(0)
    expect(nextImportance(blockScore({ userImportance: 0 }))).toBeNull()

    expect(nextValence(undefined)).toBe(4)
    expect(nextValence(blockScore({ userValence: 4 }))).toBe(-4)
    expect(nextValence(blockScore({ userValence: -4 }))).toBeNull()
  })

  it('distinguishes "actively forgetting" (0) from "unrated" (null) for importance only', () => {
    expect(hasUserImportance(blockScore({ userImportance: null }))).toBe(false)
    expect(hasUserImportance(blockScore({ userImportance: 0 }))).toBe(true)
    expect(importanceIcon(blockScore({ userImportance: null }))).toBe('flag-off')
    expect(importanceIcon(blockScore({ userImportance: 0 }))).toBe('circle-slash')
    expect(importanceIcon(blockScore({ userImportance: 3 }))).toBe('flag')
    expect(importanceIcon(blockScore({ userImportance: 5 }))).toBe('flag')
    expect(isVeryImportant(blockScore({ userImportance: 5 }))).toBe(true)
    expect(isVeryImportant(blockScore({ userImportance: 3 }))).toBe(false)
    expect(importanceLabel(blockScore({ userImportance: 0 }))).toBe('Actively forgetting')
    expect(importanceLabel(blockScore({ userImportance: null }))).toBe('Unrated')
  })

  it('valence icon/label read neutral for both null and (collapsed) 0', () => {
    expect(valenceIcon(blockScore({ userValence: 4 }))).toBe('sunrise')
    expect(valenceIcon(blockScore({ userValence: -4 }))).toBe('eclipse')
    expect(valenceIcon(blockScore({ userValence: null }))).toBe('sun-moon')
    expect(valenceLabel(blockScore({ userValence: 4 }))).toBe('Breakthrough')
    expect(valenceLabel(blockScore({ userValence: -4 }))).toBe('Tension')
  })

  it('combinedImportance vetoes to 0 when the user actively-forgot, else log-compresses agent+user raw sums', () => {
    expect(combinedImportance(undefined)).toBe(0)
    expect(combinedImportance(blockScore({ rawImportanceSum: 5, userImportance: 0 }))).toBe(0)
    expect(combinedImportance(blockScore({ rawImportanceSum: 3, userImportance: null }))).toBeCloseTo(Math.log2(4))
    expect(combinedImportance(blockScore({ rawImportanceSum: 3, userImportance: 5 }))).toBeCloseTo(Math.log2(9))
    // No raw contribution at all ⇒ falls back to the stored cumulative value.
    expect(combinedImportance(blockScore({ rawImportanceSum: 0, userImportance: null, cumulativeImportance: 1.585 }))).toBe(1.585)
  })

  it('combinedValence signed-log-compresses agent+user raw sums', () => {
    expect(combinedValence(undefined)).toBe(0)
    expect(combinedValence(blockScore({ rawValenceSum: 3, userValence: 4 }))).toBeCloseTo(Math.log2(8))
    expect(combinedValence(blockScore({ rawValenceSum: -2, userValence: -4 }))).toBeCloseTo(-Math.log2(7))
    expect(combinedValence(blockScore({ rawValenceSum: 0, userValence: null, cumulativeValence: -0.5 }))).toBe(-0.5)
  })
})

describe('WireService — NEGATIVE PROOF: the OLD raw-projection-SPARQL door is the wrong one', () => {
  // The one EXECUTABLE witness on this branch that the retired path is wrong: the raw
  // builders emit byte-for-byte a GRAPH <…:projection:workspace> INSERT/DELETE — exactly the
  // form garden's authority gate (rdf_authority.rs:61-73) rejects ("SPARQL update targets a
  // reserved local RDF authority graph"). This is why the live write path is the WireWriter
  // seam (workspace-CRDT-materialized), NOT rest.update. The executed real-cell
  // materialization round-trip is OUT OF SCOPE here (no live gardend cell on the POC branch);
  // the cell's ACCEPTANCE of the new envelope is verified by reading its Rust schema.
  it('wireInsertSparql targets the reserved projection graph the cell rejects', () => {
    const sparql = wireInsertSparql(GRAPH_ID, 'wire-1', {
      sourceDocumentId: 'doc-architecture',
      targetDocumentId: 'doc-billing',
    })
    // The rejected signature: an INSERT DATA whose GRAPH target is …:projection:workspace.
    expect(sparql).toContain(`GRAPH <${WS}>`)
    expect(WS).toMatch(/:projection:workspace$/)
    expect(sparql.startsWith('INSERT DATA { GRAPH <')).toBe(true)
  })

  it('wireDeleteSparql targets the same reserved projection graph', () => {
    const sparql = wireDeleteSparql(GRAPH_ID, 'wire-1')
    expect(sparql).toContain(`GRAPH <${WS}>`)
    expect(sparql.startsWith('DELETE WHERE { GRAPH <')).toBe(true)
  })
})

describe('NavigationService + buildKernelOptions — boundary adapter (real events)', () => {
  it('eventNavigationService dispatches a REAL shrubbery:open-document CustomEvent', () => {
    const bus = new EventTarget()
    const nav = eventNavigationService(bus)
    let detail: unknown = null
    bus.addEventListener(OPEN_DOCUMENT_EVENT, (e) => {
      detail = (e as CustomEvent).detail
    })
    nav.openDocument('graph-a', 'doc-x', 'block-7')
    expect(detail).toEqual({ graphId: 'graph-a', documentId: 'doc-x', blockId: 'block-7' })
  })

  it('eventNavigationService dispatches a REAL mn-open-zotero-source CustomEvent', () => {
    const bus = new EventTarget()
    const nav = eventNavigationService(bus)
    let detail: unknown = null
    bus.addEventListener(OPEN_ZOTERO_SOURCE_EVENT, (e) => {
      detail = (e as CustomEvent).detail
    })
    nav.openZoteroSource('zot-A1', 'A1')
    expect(detail).toEqual({ artifactId: 'zot-A1', zoteroKey: 'A1' })
  })

  it('buildKernelOptions.onWikiLinkClick navigates via the navigation service', () => {
    const bus = new EventTarget()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      captureWireWriter().writer,
      documentScope(),
      eventNavigationService(bus),
    )
    const opts = buildKernelOptions(services, {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
    })
    let detail: { graphId: string; documentId: string } | null = null
    bus.addEventListener(OPEN_DOCUMENT_EVENT, (e) => {
      detail = (e as CustomEvent).detail
    })
    // No targetGraphId on the attrs ⇒ falls back to the scope's graphId.
    opts.onWikiLinkClick?.({ targetDocId: 'doc-billing', label: 'Billing' })
    expect(detail).toEqual({ graphId: GRAPH_ID, documentId: 'doc-billing', blockId: undefined })
  })

  it('buildKernelOptions.onCitationClick opens a Zotero source through navigation', () => {
    const bus = new EventTarget()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      captureWireWriter().writer,
      documentScope(),
      eventNavigationService(bus),
    )
    const opts = buildKernelOptions(services, {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
    })
    let detail: { artifactId: string; zoteroKey: string } | null = null
    bus.addEventListener(OPEN_ZOTERO_SOURCE_EVENT, (e) => {
      detail = (e as CustomEvent).detail
    })
    opts.onCitationClick?.({ artifactId: 'zot-A1', zoteroKey: 'A1', citation: 'Brown et al. (1989)' })
    expect(detail).toEqual({ artifactId: 'zot-A1', zoteroKey: 'A1' })
  })

  it('buildKernelOptions.onWikiLinkDelete deletes the recorded wire via the cell-faithful seam', async () => {
    const { writer, creates, deletes } = captureWireWriter()
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      writer,
      documentScope(),
    )
    const { wireId } = await services.wire.create({
      sourceDocumentId: 'doc-architecture',
      targetDocumentId: 'doc-billing',
    })
    expect(creates).toHaveLength(1)
    const opts = buildKernelOptions(services, {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
    })
    opts.onWikiLinkDelete?.({ targetDocId: 'doc-billing', label: 'Billing', wireId })
    // The delete is fire-and-forget (sync kernel callback); let the microtask settle.
    await Promise.resolve()
    await Promise.resolve()
    // The cleanup hit the cell-faithful seam (workspace.deleteWire), keyed on the wire id.
    expect(deletes).toEqual([{ graphId: GRAPH_ID, wireId }])
  })

  it('buildKernelOptions returns editor callbacks/render seams (never collaborative)', () => {
    const services = assembleEditorServices(
      makeOxigraphRestClient(seedWorkspaceStore(GRAPH_ID, DOCS)),
      captureWireWriter().writer,
      documentScope(),
    )
    const opts = buildKernelOptions(services, {
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: 'doc-architecture',
    })
    expect(Object.keys(opts).sort()).toEqual([
      'getGraphId',
      'mermaid',
      'onCitationClick',
      'onMarginGlossOpen',
      'onWikiLinkClick',
      'onWikiLinkDelete',
      'renderQueryBlock',
    ])
    expect(opts.mermaid?.render).toBeTypeOf('function')
    expect(opts.mermaid?.subscribe).toBeTypeOf('function')
    expect('collaborative' in opts).toBe(false)
  })
})

describe('fuzzyFilterDocuments — the verbatim 5-rung scorer (pure)', () => {
  const items: WikiLinkSuggestionItem[] = [
    { id: '1', label: 'Architecture', type: 'document' },
    { id: '2', label: 'arch', type: 'document' },
    { id: '3', label: 'Search Index', type: 'document' },
    { id: '4', label: 'Billing', type: 'document' },
  ]

  it('exact > startsWith > includes ordering holds', () => {
    const ranked = fuzzyFilterDocuments(items, 'arch')
    // 'arch' exact (100) ranks above 'Architecture' startsWith (80); 'Search' includes (60) below.
    expect(ranked.map((r) => r.label)).toEqual(['arch', 'Architecture', 'Search Index'])
    expect(ranked.map((r) => r.label)).not.toContain('Billing')
  })

  it('subsequence match scores and non-match drops to zero', () => {
    // 'blg' is a subsequence of 'Billing' (b…l…g) and of nothing else here.
    const ranked = fuzzyFilterDocuments(items, 'blg')
    expect(ranked.map((r) => r.label)).toEqual(['Billing'])
  })
})
