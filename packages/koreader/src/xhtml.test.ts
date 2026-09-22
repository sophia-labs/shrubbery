import { describe, expect, it } from 'vitest'
import { renderKoreaderFeed } from './feed.js'
import type { ReaderDocument, ReaderLibrary } from './model.js'
import { renderKoreaderXhtml } from './xhtml.js'

const document: ReaderDocument = {
  id: 'doc/a',
  graphId: 'graph-a',
  title: 'A <document>',
  revision: 4,
  updatedAt: '2026-07-31T12:00:00Z',
  readOnly: false,
  blocks: [
    {
      id: 'h 1',
      type: 'heading',
      text: 'Heading',
      order: 0,
      level: 2,
      marks: [],
    },
    {
      id: 'p',
      type: 'paragraph',
      text: 'Bold link text',
      order: 1,
      marks: [
        { type: 'bold', start: 0, end: 4 },
        { type: 'wikilink', start: 5, end: 9, targetDocumentId: 'doc-b' },
      ],
    },
    {
      id: 'b1',
      type: 'bullet',
      text: 'One',
      order: 2,
      level: 1,
      marks: [],
    },
    {
      id: 'b2',
      type: 'bullet',
      text: 'Two',
      order: 3,
      level: 2,
      marks: [],
    },
  ],
}

describe('renderKoreaderXhtml', () => {
  it('emits semantic, escaped XHTML with stable Sophia anchors', () => {
    const xhtml = renderKoreaderXhtml(document)
    expect(xhtml).toContain('<title>A &lt;document&gt;</title>')
    expect(xhtml).toContain('Sophia / Reader · graph-a')
    expect(xhtml).toContain('updated 2026-07-31')
    expect(xhtml).toContain('id="sophia-block-h~20~1"')
    expect(xhtml).toContain('<strong>Bold</strong>')
    expect(xhtml).toContain('<a href="./doc-b.xhtml">link</a>')
    expect(xhtml).toContain('<ul><li')
    expect(xhtml.match(/<ul>/g)).toHaveLength(1)
    expect(xhtml).not.toContain('<script')
  })

  it('gives empty Garden pages an intentional reader state without losing block identity', () => {
    const xhtml = renderKoreaderXhtml({
      ...document,
      blocks: [{ id: 'empty', type: 'paragraph', text: '', order: 0, marks: [] }],
    }, { libraryTitle: 'My Garden' })
    expect(xhtml).toContain('<p class="sophia-workspace">My Garden</p>')
    expect(xhtml).toContain('id="sophia-block-empty"')
    expect(xhtml).toContain('This page is still gathering.')
  })

  it('does not print a canonical title heading twice', () => {
    const xhtml = renderKoreaderXhtml({
      ...document,
      title: 'A Message from Sophia',
      blocks: [
        {
          id: 'canonical-title',
          type: 'heading',
          text: '  A Message FROM Sophia ',
          order: 0,
          level: 1,
          marks: [],
        },
        {
          id: 'body',
          type: 'paragraph',
          text: 'Dear curious human,',
          order: 1,
          marks: [],
        },
      ],
    })
    expect(xhtml).toContain('<h1 class="sophia-document-title">A Message from Sophia</h1>')
    expect(xhtml).not.toContain('sophia-block-canonical-title')
    expect(xhtml).toContain('sophia-block-body')
  })

  it('neutralizes executable and traversal hrefs', () => {
    const xhtml = renderKoreaderXhtml({
      ...document,
      blocks: [
        {
          id: 'unsafe',
          type: 'paragraph',
          text: 'one two',
          order: 0,
          marks: [
            { type: 'link', start: 0, end: 3, href: 'javascript:alert(1)' },
            { type: 'link', start: 4, end: 7, href: './../../etc/passwd' },
          ],
        },
      ],
    })
    expect(xhtml).toContain('<a href="#">one</a>')
    expect(xhtml).toContain('<a href="#">two</a>')
    expect(xhtml).not.toContain('javascript:')
    expect(xhtml).not.toContain('../..')
  })
})

describe('renderKoreaderFeed', () => {
  it('renders a deterministic multi-file artifact rather than an HTTP face', () => {
    const library: ReaderLibrary = {
      id: 'library-a',
      graphId: 'graph-a',
      title: 'Sophia',
      folders: [{
        id: 'folder-a',
        graphId: 'graph-a',
        label: 'Essays',
        order: 1,
        section: 'documents',
      }],
      documents: [document],
    }
    const artifact = renderKoreaderFeed(library, {
      generatedAt: '2026-07-31T00:00:00.000Z',
    })
    expect(artifact.target).toBe('koreader')
    expect(artifact.files.map((file) => file.path)).toEqual([
      'manifest.json',
      'index.xhtml',
      'documents/doc~2f~a.xhtml',
      'models/doc~2f~a.json',
    ])
    expect(artifact.manifest.documents[0].fileName).toBe('doc~2f~a.xhtml')
    expect(artifact.manifest.documents[0].graphId).toBe('graph-a')
    expect(artifact.manifest.navigation.folders[0].label).toBe('Essays')
    expect(artifact.manifest.workspaceCataloguePath).toBe('workspaces.json')
    expect(artifact.manifest.projectionVersion).toBe(6)
    expect(artifact.manifest.capabilities.remoteWrites).toBe(false)
  })

  it('refuses normalized libraries with out-of-bounds mark offsets', () => {
    const library: ReaderLibrary = {
      id: 'library-a',
      graphId: 'graph-a',
      title: 'Sophia',
      documents: [{
        ...document,
        blocks: [{
          id: 'p',
          type: 'paragraph',
          text: 'text',
          order: 0,
          marks: [{ type: 'bold', start: 0, end: 5 }],
        }],
      }],
    }
    expect(() => renderKoreaderFeed(library)).toThrow('invalid mark range')
  })

  it('gives every cached manuscript distinct library and adjacent-document navigation', () => {
    const secondDocument: ReaderDocument = {
      ...document,
      id: 'doc-b',
      title: 'B document',
      blocks: [{ id: 'body-b', type: 'paragraph', text: 'Second body', order: 0, marks: [] }],
    }
    const artifact = renderKoreaderFeed({
      id: 'library-a',
      graphId: 'graph-a',
      title: 'Sophia',
      documents: [secondDocument, document],
    })
    const first = artifact.files.find((file) => file.path === 'documents/doc~2f~a.xhtml')?.body
    const second = artifact.files.find((file) => file.path === 'documents/doc-b.xhtml')?.body

    expect(first).toContain('href="../index.xhtml">Library</a>')
    expect(first).toContain('href="./doc-b.xhtml" title="B document">Next')
    expect(first).toContain('>1 / 2</span>')
    expect(second).toContain('href="./doc~2f~a.xhtml" title="A &lt;document&gt;">&#8249; Previous')
    expect(second).toContain('>2 / 2</span>')
  })
})
