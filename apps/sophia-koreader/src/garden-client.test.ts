import { describe, expect, it } from 'vitest'
import { loadGardenLibrary, loadGardenWorkspaceCatalogue } from './garden-client.js'

describe('loadGardenLibrary', () => {
  it('reads the existing hosted-shaped index and document routes', async () => {
    const requested: string[] = []
    const fetchStub: typeof fetch = async (input) => {
      const url = input.toString()
      requested.push(url)
      if (url.endsWith('/documents/g')) {
        return Response.json([{ id: 'a' }, { id: 'b' }])
      }
      if (url.endsWith('/navigation/g')) {
        return Response.json({
          folders: [{ id: 'folder-a', label: 'Reading', order: 1 }],
          documents: [{ id: 'a', parentId: 'folder-a' }, { id: 'b', parentId: null }],
        })
      }
      const id = url.endsWith('/a') ? 'a' : 'b'
      return Response.json({
        id,
        graphId: 'g',
        title: id.toUpperCase(),
        revision: 1,
        blocks: [],
      })
    }
    const library = await loadGardenLibrary({
      baseUrl: 'https://example.invalid/cell',
      graphId: 'g',
      fetch: fetchStub,
    })
    expect(library.documents.map((document) => document.id)).toEqual(['a', 'b'])
    expect(library.folders).toEqual([{
      id: 'folder-a',
      graphId: 'g',
      label: 'Reading',
      order: 1,
      section: 'documents',
    }])
    expect(library.documents[0].parentId).toBe('folder-a')
    expect(library.documents[1].parentId).toBeUndefined()
    expect(requested[0]).toBe('https://example.invalid/cell/documents/g')
  })

  it('replaces flattened hosted blocks with the canonical TipTap XML projection', async () => {
    const requested: string[] = []
    const fetchStub: typeof fetch = async (input) => {
      const url = input.toString()
      requested.push(url)
      if (url.endsWith('/documents/g')) return Response.json([{ id: 'actual' }])
      if (url.endsWith('/navigation/g')) {
        return Response.json({ folders: [], documents: [{ id: 'actual', parentId: null }] })
      }
      if (url.endsWith('/documents/g/actual')) {
        return Response.json({
          id: 'actual',
          graphId: 'g',
          title: 'Actual document',
          revision: 4,
          blocks: [{ id: 'flattened', type: 'paragraph', content: '' }],
        })
      }
      if (url.endsWith('/documents/g/actual/export?format=xml')) {
        return new Response(
          '<heading data-block-id="real-heading" level="2">From XML</heading>'
            + '<paragraph data-block-id="real-body">Substantial <bold>content</bold>.</paragraph>',
          { headers: { 'content-type': 'application/xml' } },
        )
      }
      return new Response('not found', { status: 404 })
    }
    const library = await loadGardenLibrary({
      baseUrl: 'https://example.invalid/cell',
      graphId: 'g',
      documentSource: 'tiptap-xml',
      fetch: fetchStub,
    })
    expect(library.documents[0].blocks).toEqual([
      {
        id: 'real-heading',
        type: 'heading',
        text: 'From XML',
        order: 0,
        marks: [],
        level: 2,
      },
      {
        id: 'real-body',
        type: 'paragraph',
        text: 'Substantial content.',
        order: 1,
        marks: [{ type: 'bold', start: 12, end: 19 }],
      },
    ])
    expect(requested.at(-1)).toBe(
      'https://example.invalid/cell/documents/g/actual/export?format=xml',
    )
  })

  it('can omit records that do not contain enough readable content', async () => {
    const fetchStub: typeof fetch = async (input) => {
      const url = input.toString()
      if (url.endsWith('/documents/g')) return Response.json([{ id: 'short' }, { id: 'long' }])
      if (url.endsWith('/navigation/g')) {
        return Response.json({
          folders: [],
          documents: [{ id: 'short' }, { id: 'long' }],
        })
      }
      const id = url.endsWith('/short') ? 'short' : 'long'
      return Response.json({
        id,
        graphId: 'g',
        title: id,
        revision: 1,
        blocks: [{
          id: `${id}-body`,
          type: 'paragraph',
          content: id === 'short' ? 'diagram' : 'A substantive document worth reading.',
          order: 0,
          marks: [],
        }],
      })
    }
    const library = await loadGardenLibrary({
      baseUrl: 'https://example.invalid/cell',
      graphId: 'g',
      minimumContentCharacters: 20,
      fetch: fetchStub,
    })
    expect(library.documents.map((document) => document.id)).toEqual(['long'])
  })
})

describe('loadGardenWorkspaceCatalogue', () => {
  it('normalizes Garden graph catalogue records for the native workspace picker', async () => {
    const catalogue = await loadGardenWorkspaceCatalogue({
      baseUrl: 'https://example.invalid/cell',
      fetch: async () => Response.json([
        { graph_id: 'graph-a', title: 'First garden', status: 'active' },
        { graphId: 'graph-b', title: null, status: 'active' },
      ]),
    })
    expect(catalogue).toEqual([
      { graphId: 'graph-a', title: 'First garden', status: 'active' },
      { graphId: 'graph-b', title: 'graph-b', status: 'active' },
    ])
  })
})
