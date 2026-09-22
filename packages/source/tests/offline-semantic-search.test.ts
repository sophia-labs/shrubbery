import { describe, expect, it } from 'vitest'
import {
  OfflineSemanticSearchIndex,
  searchOfflineSemanticCorpus,
  type SourceSemanticCorpusEntry,
} from '../src/index.js'

function entry(
  documentId: string,
  blockId: string,
  title: string,
  content: string,
  order = 1,
): SourceSemanticCorpusEntry {
  return {
    semanticId: `urn:test:${documentId}#${blockId}`,
    kind: 'block',
    graphId: 'graph-a',
    documentId,
    documentTitle: title,
    blockId,
    blockType: 'paragraph',
    content,
    contentHash: `${documentId}:${blockId}`,
    order,
  }
}

describe('offline semantic search', () => {
  const corpus = [
    entry('doc-garden', 'b-1', 'Garden architecture', 'Surface activation hydrates a durable source mirror in the background.'),
    entry('doc-finance', 'b-2', 'Invoices', 'Quarterly billing reconciliation and invoice approvals.'),
    entry('doc-botany', 'b-3', 'Shrubs', 'Evergreen hedges and flowering shrub varieties.'),
  ]

  it('ranks the source-derived block and tolerates morphology and spelling drift', () => {
    const index = new OfflineSemanticSearchIndex(corpus)
    expect(index.search('activating mirrored surfaces')[0]).toMatchObject({
      documentId: 'doc-garden',
      blockId: 'b-1',
      matchSource: 'offline-hybrid',
    })
    expect(index.search('invoce approval')[0]?.documentId).toBe('doc-finance')
  })

  it('is deterministic, bounded, and has no result for an empty query', () => {
    const first = searchOfflineSemanticCorpus(corpus, 'flowering shrub', 2)
    const second = searchOfflineSemanticCorpus(corpus, 'flowering shrub', 2)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThanOrEqual(2)
    expect(first[0]?.documentId).toBe('doc-botany')
    expect(searchOfflineSemanticCorpus(corpus, '   ')).toEqual([])
    expect(searchOfflineSemanticCorpus(corpus, 'shrub', 0)).toEqual([])
  })
})
