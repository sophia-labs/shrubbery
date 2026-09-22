import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GardendContract } from '../gardend-contract.js'
import {
  artifactIdFromZoteroKey,
  createZoteroGroundingWire,
  loadZoteroSource,
  materializeZoteroSource,
  materializedSourceArtifactId,
  normalizeIncomingWire,
  normalizeCitationSearchItem,
  normalizeZoteroAnnotation,
  normalizeZoteroItem,
  searchZoteroItems,
  zoteroKeyFromArtifactId,
} from '../zotero-source.js'

function contract(): GardendContract {
  return {
    auth: {
      userId: () => 'local-user',
      token: () => undefined,
      isAuthenticated: () => true,
      whenReady: () => Promise.resolve(),
      onChange: () => () => {},
    },
    runtime: {
      mode: () => 'local',
      isGateway: () => false,
      graphBaseUrl: () => '/cell',
    },
  } as unknown as GardendContract
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('zotero source cell adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives deterministic artifact and Zotero keys', () => {
    expect(zoteroKeyFromArtifactId('zot-A1')).toBe('A1')
    expect(zoteroKeyFromArtifactId('A1')).toBe('A1')
    expect(artifactIdFromZoteroKey('A1')).toBe('zot-A1')
    expect(artifactIdFromZoteroKey('zot-A1')).toBe('zot-A1')
  })

  it('normalizes Garden Zotero item, annotation, and incoming wire shapes', () => {
    expect(normalizeZoteroItem({
      data: {
        key: 'A1',
        title: 'Situated Cognition',
        itemType: 'journalArticle',
        date: '1989-01-01',
        abstractNote: 'Learning is situated.',
        tags: [{ tag: 'Cognition' }, { tag: 'cognition' }, { tag: 'Practice' }],
      },
      meta: { creatorSummary: 'Brown et al.', parsedDate: '1989-02-01' },
    }, 'fallback')).toEqual({
      key: 'A1',
      title: 'Situated Cognition',
      label: null,
      itemType: 'journalArticle',
      creatorSummary: 'Brown et al.',
      year: '1989',
      abstractNote: 'Learning is situated.',
      tags: ['Cognition', 'Practice'],
    })
    expect(normalizeZoteroAnnotation({
      key: 'ann-1',
      kind: 'highlight',
      text: 'Knowledge is situated.',
      comment: 'Core claim',
      color: '#facc15',
      page: '42',
    })).toEqual({
      key: 'ann-1',
      kind: 'highlight',
      text: 'Knowledge is situated.',
      comment: 'Core claim',
      color: '#facc15',
      page: '42',
    })
    expect(normalizeIncomingWire({
      wire_id: 'wire-1',
      predicate_label: 'quotes from',
      other_document_id: 'doc-a',
      other_block_id: 'block-a',
      other_title: 'Reading Notes',
      other_snippet: 'Grounded claim.',
    })).toEqual({
      id: 'wire-1',
      predicateLabel: 'quotes from',
      otherDocumentId: 'doc-a',
      otherBlockId: 'block-a',
      otherTitle: 'Reading Notes',
      otherSnippet: 'Grounded claim.',
    })
  })

  it('loads source item, incoming wires, and annotations from the cell routes', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const path = String(url)
      calls.push(path)
      if (path.endsWith('/zotero/items/A1')) {
        return jsonResponse({ data: { key: 'A1', title: 'Situated Cognition' }, meta: { creatorSummary: 'Brown et al.' } })
      }
      if (path.endsWith('/wires/graph-a/artifact/zot-A1/incoming')) {
        return jsonResponse([{ id: 'wire-1', predicateLabel: 'quotes from', otherDocumentId: 'doc-a' }])
      }
      if (path.endsWith('/zotero/graph-a/sources/A1/annotations')) {
        return jsonResponse([{ key: 'ann-1', kind: 'highlight', text: 'Knowledge is situated.' }])
      }
      return jsonResponse({ detail: 'not found' }, 404)
    }))

    const read = await loadZoteroSource(contract(), 'graph-a', 'zot-A1')

    expect(calls).toEqual([
      '/cell/zotero/items/A1',
      '/cell/wires/graph-a/artifact/zot-A1/incoming',
      '/cell/zotero/graph-a/sources/A1/annotations',
    ])
    expect(read.error).toBeNull()
    expect(read.item).toMatchObject({ key: 'A1', title: 'Situated Cognition', creatorSummary: 'Brown et al.' })
    expect(read.incomingWires).toEqual([{
      id: 'wire-1',
      predicateLabel: 'quotes from',
      otherDocumentId: 'doc-a',
      otherBlockId: null,
      otherTitle: null,
      otherSnippet: null,
    }])
    expect(read.annotations).toEqual([{ key: 'ann-1', kind: 'highlight', text: 'Knowledge is situated.', comment: null, color: null, page: null }])
  })

  it('materializes a source through the idempotent Zotero source route', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ artifactId: 'zot-A1' }))
    vi.stubGlobal('fetch', fetchSpy)

    await materializeZoteroSource(contract(), 'graph-a', 'A1')

    expect(fetchSpy).toHaveBeenCalledWith('/cell/zotero/graph-a/sources', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ key: 'A1' }),
    }))
    expect(materializedSourceArtifactId({ artifactId: 'zot-A1' }, 'A1')).toBe('zot-A1')
  })

  it('searches Zotero citation rows through the /cite route', async () => {
    expect(normalizeCitationSearchItem({
      key: 'A1',
      title: 'Situated Cognition',
      citation: 'Brown et al. (1989)',
      item_type: 'journalArticle',
      creator_summary: 'Brown et al.',
      year: '1989',
    })).toEqual({
      key: 'A1',
      title: 'Situated Cognition',
      citation: 'Brown et al. (1989)',
      itemType: 'journalArticle',
      creatorSummary: 'Brown et al.',
      year: '1989',
    })
    const fetchSpy = vi.fn(async () => jsonResponse([{ key: 'A1', title: 'Situated Cognition' }]))
    vi.stubGlobal('fetch', fetchSpy)

    const items = await searchZoteroItems(contract(), 'graph-a', 'situated', 7)

    expect(fetchSpy).toHaveBeenCalledWith('/cell/zotero/graph-a/search?q=situated&limit=7', expect.objectContaining({
      cache: 'no-store',
    }))
    expect(items).toEqual([{ key: 'A1', title: 'Situated Cognition', citation: null, itemType: null, creatorSummary: null, year: null }])
  })

  it('creates an artifact-target grounding wire through the cell wire route', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ id: 'wire-1' }))
    vi.stubGlobal('fetch', fetchSpy)

    await createZoteroGroundingWire(contract(), 'graph-a', {
      sourceDocumentId: 'daily-note-2026-06-23',
      sourceBlockId: 'block-a',
      targetArtifactId: 'zot-A1',
    })

    expect(fetchSpy).toHaveBeenCalledWith('/cell/wires/graph-a/document/daily-note-2026-06-23', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        source_block_id: 'block-a',
        target_kind: 'artifact',
        target_graph_id: 'graph-a',
        target_artifact_id: 'zot-A1',
        predicate: 'http://mnemosyne.ai/vocab#citesEvidence',
        bidirectional: false,
      }),
    }))
  })
})
