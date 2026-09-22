import { describe, it, expect } from 'vitest'
import {
  loadTagLensBlocks,
  tagLensBlockFromRow,
  tagLensBlocksSparql,
  type TagLensRest,
} from '../tag-lens.js'

describe('tag lens projection', () => {
  it('builds a GRAPH-scoped tag-block query', () => {
    const sparql = tagLensBlocksSparql('graph-a', 'pragma')

    expect(sparql).toContain('GRAPH <urn:mnemosyne:local:graph:graph-a:projection:workspace>')
    expect(sparql).toContain('?block doc:hasTag "pragma"')
    expect(sparql).toContain('BIND(COALESCE(?flatBlockId, ?nodeBlockId, ?fragmentBlockId) AS ?blockId)')
    expect(sparql).toContain('ORDER BY DESC(?docUpdated) ?docUri ?order ?siblingOrder ?blockId')
  })

  it('parses local tree-materialized tag rows into tag lens blocks', () => {
    expect(
      tagLensBlockFromRow({
        block: '<urn:mnemosyne:local:document:doc-a#block-block-a>',
        docUri: '<urn:mnemosyne:local:document:doc-a>',
        blockId: '"block-a"',
        docTitle: '"Garden plan"',
        text: '"Tagged\\ntext"',
        type: '<http://mnemosyne.dev/doc#paragraph>',
        docUpdated: '"2026-06-23T00:00:00Z"',
      }),
    ).toEqual({
      id: 'doc-a:block-a',
      documentId: 'doc-a',
      documentTitle: 'Garden plan',
      blockId: 'block-a',
      text: 'Tagged\ntext',
      type: 'paragraph',
      updatedAt: '2026-06-23T00:00:00Z',
    })
  })

  it('parses platform-style document URIs and fragment-derived block ids', () => {
    expect(
      tagLensBlockFromRow({
        block: '<urn:mnemosyne:user:u1:graph:g1:doc:doc-b#block-block-b>',
        docUri: '<urn:mnemosyne:user:u1:graph:g1:doc:doc-b>',
        docTitle: '"Platform doc"',
        text: '"Flat block"',
      }),
    ).toMatchObject({
      id: 'doc-b:block-b',
      documentId: 'doc-b',
      documentTitle: 'Platform doc',
      blockId: 'block-b',
      text: 'Flat block',
    })
  })

  it('loads, maps, and deduplicates row results from the live rest seam', async () => {
    const calls: Array<{ graphId: string; sparql: string }> = []
    const rest: TagLensRest = {
      async query(graphId, sparql) {
        calls.push({ graphId, sparql })
        return {
          rows: [
            {
              block: '<urn:mnemosyne:local:document:doc-a#block-block-a>',
              docUri: '<urn:mnemosyne:local:document:doc-a>',
              blockId: '"block-a"',
              docTitle: '"A"',
              text: '"Tagged"',
            },
            {
              block: '<urn:mnemosyne:local:document:doc-a#block-block-a>',
              docUri: '<urn:mnemosyne:local:document:doc-a>',
              blockId: '"block-a"',
              docTitle: '"A"',
              text: '"Tagged"',
            },
          ],
        }
      },
    }

    const blocks = await loadTagLensBlocks(rest, 'graph-a', 'pragma')

    expect(calls).toEqual([
      { graphId: 'graph-a', sparql: tagLensBlocksSparql('graph-a', 'pragma') },
    ])
    expect(blocks).toEqual([
      {
        id: 'doc-a:block-a',
        documentId: 'doc-a',
        documentTitle: 'A',
        blockId: 'block-a',
        text: 'Tagged',
        type: null,
        updatedAt: null,
      },
    ])
  })
})
