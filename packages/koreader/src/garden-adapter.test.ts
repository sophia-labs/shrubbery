import { describe, expect, it } from 'vitest'
import { readerDocumentFromHostedEnvelope } from './garden-adapter.js'

describe('readerDocumentFromHostedEnvelope', () => {
  it('normalizes Garden hosted blocks and snake-case wikilink targets', () => {
    const document = readerDocumentFromHostedEnvelope({
      entityType: 'document',
      id: 'doc-a',
      graphId: 'graph-a',
      title: 'Document A',
      revision: 7,
      updatedAt: '2026-07-31T12:00:00Z',
      readOnly: true,
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: 'See Document B',
          order: 2,
          marks: [
            {
              id: 'm',
              type: 'wikilink',
              start: 4,
              end: 14,
              target_doc_id: 'doc-b',
            },
          ],
        },
        {
          id: 'h',
          type: 'heading',
          content: 'Start',
          order: 1,
          level: 2,
          marks: [],
        },
      ],
    })

    expect(document.blocks.map((block) => block.id)).toEqual(['h', 'p'])
    expect(document.blocks[1].marks[0].targetDocumentId).toBe('doc-b')
    expect(document.readOnly).toBe(true)
  })

  it('refuses malformed envelopes instead of fabricating a document', () => {
    expect(() => readerDocumentFromHostedEnvelope({ id: 'x' })).toThrow(
      'document.graphId must be a non-empty string',
    )
  })

  it('refuses reversed mark ranges', () => {
    expect(() => readerDocumentFromHostedEnvelope({
      id: 'x',
      graphId: 'g',
      title: 'X',
      revision: 1,
      blocks: [{
        id: 'p',
        type: 'paragraph',
        content: 'text',
        marks: [{ type: 'bold', start: 3, end: 2 }],
      }],
    })).toThrow('end must be greater than or equal to start')
  })

  it('refuses mark ranges beyond Garden block text', () => {
    expect(() => readerDocumentFromHostedEnvelope({
      id: 'x',
      graphId: 'g',
      title: 'X',
      revision: 1,
      blocks: [{
        id: 'p',
        type: 'paragraph',
        content: 'text',
        marks: [{ type: 'bold', start: 0, end: 5 }],
      }],
    })).toThrow("end exceeds the block's UTF-16 text length")
  })
})
