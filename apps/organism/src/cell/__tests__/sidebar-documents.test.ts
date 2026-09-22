import { describe, expect, it } from 'vitest'
import {
  loadSidebarSections,
  sidebarArtifactFromRow,
  sidebarArtifactListSparql,
  sidebarArtifactTree,
  sidebarDocumentFromRow,
  sidebarDocumentListSparql,
  sidebarDocumentTree,
  sidebarFolderMoveExcludeIds,
  sidebarFolderOptionsFromSections,
  sidebarFolderFromRow,
  sidebarFolderListSparql,
  sidebarSectionsFromDocuments,
  sidebarTagFromRow,
  tagListSparql,
  type SidebarDocumentRest,
} from '../sidebar-documents.js'

describe('sidebar document projection', () => {
  it('parses workspace projection rows into document labels and placement', () => {
    expect(
      sidebarDocumentFromRow({
        doc: '<urn:mnemosyne:local:document:doc-a>',
        label: '"Garden plan"',
        parent: '<urn:mnemosyne:local:graph:graph-a:folder:folder-a>',
        order: '"2.5"^^<http://www.w3.org/2001/XMLSchema#double>',
      }),
    ).toEqual({ id: 'doc-a', label: 'Garden plan', parentId: 'folder-a', order: 2.5, readOnly: false, sourceFile: null })

    expect(
      sidebarDocumentFromRow({
        doc: '<urn:mnemosyne:local:document:doc-b>',
        label: '"Line\\nBreak"',
      }),
    ).toEqual({ id: 'doc-b', label: 'Line\nBreak', parentId: null, order: 0, readOnly: false, sourceFile: null })

    expect(sidebarDocumentFromRow({ doc: '<urn:other:doc>' })).toBeNull()
  })

  it('projects ISO or numeric createdAt and falls back only to epoch-valued order', () => {
    expect(sidebarDocumentFromRow({
      doc: '<urn:mnemosyne:local:document:iso-doc>',
      createdAt: '"2026-07-10T12:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
      order: '"2"^^<http://www.w3.org/2001/XMLSchema#double>',
    })?.createdAt).toBe(Date.parse('2026-07-10T12:00:00.000Z'))
    expect(sidebarDocumentFromRow({
      doc: '<urn:mnemosyne:local:document:numeric-doc>',
      createdAt: '"1783684800000"^^<http://www.w3.org/2001/XMLSchema#long>',
    })?.createdAt).toBe(1_783_684_800_000)
    expect(sidebarDocumentFromRow({
      doc: '<urn:mnemosyne:local:document:order-doc>',
      order: '"1783684800001"^^<http://www.w3.org/2001/XMLSchema#double>',
    })?.createdAt).toBe(1_783_684_800_001)
    expect(sidebarDocumentFromRow({
      doc: '<urn:mnemosyne:local:document:manual-order>',
      order: '"3"^^<http://www.w3.org/2001/XMLSchema#double>',
    })?.createdAt).toBeUndefined()
    expect(sidebarDocumentListSparql('graph-a')).toContain('doc:createdAt')
  })

  it('projects authoritative imported-document access and source metadata', () => {
    expect(sidebarDocumentFromRow({
      doc: '<urn:mnemosyne:local:document:imported-pdf>',
      label: '"Imported PDF"',
      readOnly: '"true"^^<http://www.w3.org/2001/XMLSchema#boolean>',
      sourceStorageKey: '"local://artifacts/a/original/paper.pdf"',
      sourceOriginalFilename: '"paper.pdf"',
      sourceMimeType: '"application/pdf"',
      sourceContentSize: '"321"^^<http://www.w3.org/2001/XMLSchema#integer>',
      sourceFileType: '"pdf"',
    })).toEqual({
      id: 'imported-pdf',
      label: 'Imported PDF',
      parentId: null,
      order: 0,
      readOnly: true,
      sourceFile: {
        storageKey: 'local://artifacts/a/original/paper.pdf',
        originalFilename: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 321,
        fileType: 'pdf',
      },
    })
    expect(sidebarDocumentListSparql('graph-a')).toContain('doc:sourceOriginalFilename')
  })

  it('parses workspace projection rows into folder metadata', () => {
    expect(
      sidebarFolderFromRow({
        folder: '<urn:mnemosyne:local:graph:graph-a:folder:folder-a>',
        label: '"Research"',
        parent: '<urn:mnemosyne:local:graph:graph-a:folder:folder-root>',
        order: '"3"^^<http://www.w3.org/2001/XMLSchema#integer>',
        section: '"documents"',
      }),
    ).toEqual({
      id: 'folder-a',
      label: 'Research',
      parentId: 'folder-root',
      order: 3,
      section: 'documents',
    })

    expect(
      sidebarFolderFromRow({
        folder: '<urn:mnemosyne:local:graph:graph-a:folder:folder-imports>',
        section: '"artifacts"',
      }),
    ).toEqual({
      id: 'folder-imports',
      label: 'Untitled Folder',
      parentId: null,
      order: 0,
      section: 'artifacts',
    })
  })

  it('parses workspace projection rows into artifact metadata', () => {
    expect(
      sidebarArtifactFromRow({
        artifact: '<urn:mnemosyne:local:graph:graph-a:artifact:artifact-a>',
        label: '"Sketch.excalidraw"',
        parent: '<urn:mnemosyne:local:graph:graph-a:folder:folder-artifacts>',
        order: '"4"^^<http://www.w3.org/2001/XMLSchema#integer>',
        mimeType: '"application/vnd.excalidraw+json"',
        status: '"ready"',
        fileType: '"excalidraw"',
      }),
    ).toEqual({
      id: 'artifact-a',
      label: 'Sketch.excalidraw',
      parentId: 'folder-artifacts',
      order: 4,
      mimeType: 'application/vnd.excalidraw+json',
      status: 'ready',
      fileType: 'excalidraw',
      ingestedDocumentId: null,
    })

    expect(
      sidebarArtifactFromRow({
        artifact: '<urn:mnemosyne:local:graph:graph-a:artifact:artifact-b>',
        ingestedDoc: '<urn:mnemosyne:local:document:doc-b>',
      }),
    ).toMatchObject({
      id: 'artifact-b',
      label: 'Untitled Artifact',
      parentId: null,
      mimeType: 'application/octet-stream',
      status: 'ready',
      ingestedDocumentId: 'doc-b',
    })
  })

  it('parses workspace projection tag aggregate rows', () => {
    expect(
      sidebarTagFromRow({
        tag: '"Pragma"',
        count: '"3"^^<http://www.w3.org/2001/XMLSchema#integer>',
      }),
    ).toEqual({ name: 'pragma', count: 3 })

    expect(sidebarTagFromRow({ tag: '"bad tag"', count: '"1"' })).toBeNull()
  })

  it('projects folders, documents, and tags to controlled sidebar sections', () => {
    const sections = sidebarSectionsFromDocuments(
      [
        { id: 'doc-a', label: 'A', parentId: 'folder-child', order: 1, readOnly: true, sourceFile: { originalFilename: 'a.pdf' } },
        { id: 'doc-b', label: 'B', parentId: null, order: 2, readOnly: false, sourceFile: null },
      ],
      'doc-a',
      [
        { name: 'pragma', count: 4 },
        { name: 'shrubbery', count: 2 },
      ],
      [
        { id: 'folder-root', label: 'Root', parentId: null, order: 1, section: 'documents' },
        { id: 'folder-child', label: 'Child', parentId: 'folder-root', order: 1, section: 'documents' },
        { id: 'folder-artifacts', label: 'Artifacts', parentId: null, order: 1, section: 'artifacts' },
      ],
      new Set(['folder-root']),
      [
        {
          id: 'artifact-a',
          label: 'Sketch',
          parentId: 'folder-artifacts',
          order: 1,
          mimeType: 'image/png',
          status: 'ready',
          fileType: 'png',
        },
        {
          id: 'artifact-ingested',
          label: 'Imported PDF',
          parentId: null,
          order: 2,
          mimeType: 'application/pdf',
          status: 'ready',
          fileType: 'pdf',
          ingestedDocumentId: 'doc-pdf',
        },
      ],
    )

    expect(sections.map((section) => section.id)).toEqual(['documents', 'artifacts', 'tags'])
    expect(sections[0].count).toBe(2)
    expect(sections[0].nodes?.map((node) => [node.id, node.kind, node.expanded])).toEqual([
      ['folder-root', 'folder', true],
      ['doc-b', 'document', undefined],
    ])
    const root = sections[0].nodes?.[0]
    expect(root?.children?.[0]).toMatchObject({ id: 'folder-child', kind: 'folder', expanded: true })
    expect(root?.children?.[0].children?.[0]).toMatchObject({
      id: 'doc-a',
      active: true,
      selected: true,
      readOnly: true,
      icon: 'book-open',
      sourceFile: { originalFilename: 'a.pdf' },
    })
    expect(sections[1].count).toBe(1)
    expect(sections[1].nodes?.[0]).toMatchObject({ id: 'folder-artifacts', kind: 'folder' })
    expect(sections[1].nodes?.[0].children?.[0]).toMatchObject({
      id: 'artifact-a',
      kind: 'artifact',
      badge: 'png',
      mimeType: 'image/png',
    })
    expect(sections[2].count).toBe(6)
    expect(sections[2].nodes?.map((node) => [node.id, node.label, node.kind, node.count])).toEqual([
      ['tag:event', 'event', 'tag', undefined],
      ['tag:todo', 'todo', 'tag', undefined],
      ['tag:decision', 'decision', 'tag', undefined],
      ['tag:tension', 'tension', 'tag', undefined],
      ['tag:pragma', 'pragma', 'tag', 4],
      ['tag:shrubbery', 'shrubbery', 'tag', 2],
    ])
  })

  it('builds document trees with folders first and invalid parents at root', () => {
    const nodes = sidebarDocumentTree(
      [
        { id: 'doc-root', label: 'Root doc', parentId: null, order: 1, readOnly: false, sourceFile: null },
        { id: 'doc-child', label: 'Child doc', parentId: 'folder-child', order: 1, readOnly: false, sourceFile: null },
        { id: 'doc-orphan', label: 'Orphan doc', parentId: 'missing-folder', order: 0, readOnly: false, sourceFile: null },
      ],
      [
        { id: 'folder-root', label: 'Root folder', parentId: null, order: 2, section: 'documents' },
        { id: 'folder-child', label: 'Child folder', parentId: 'folder-root', order: 1, section: 'documents' },
      ],
      'doc-child',
    )

    expect(nodes.map((node) => [node.id, node.kind])).toEqual([
      ['folder-root', 'folder'],
      ['doc-orphan', 'document'],
      ['doc-root', 'document'],
    ])
    expect(nodes[0]).toMatchObject({ id: 'folder-root', expanded: true })
    expect(nodes[0].children?.[0]).toMatchObject({ id: 'folder-child', expanded: true })
    expect(nodes[0].children?.[0].children?.[0]).toMatchObject({ id: 'doc-child', active: true })
  })

  it('builds artifact trees with first-class artifacts only', () => {
    const nodes = sidebarArtifactTree(
      [
        {
          id: 'artifact-root',
          label: 'Root image',
          parentId: null,
          order: 2,
          mimeType: 'image/png',
          status: 'ready',
          fileType: 'png',
        },
        {
          id: 'artifact-child',
          label: 'Child sketch',
          parentId: 'folder-art',
          order: 1,
          mimeType: 'application/vnd.excalidraw+json',
          status: 'processing',
        },
        {
          id: 'artifact-ingested',
          label: 'Imported PDF',
          parentId: null,
          order: 0,
          mimeType: 'application/pdf',
          status: 'ready',
          ingestedDocumentId: 'doc-pdf',
        },
      ],
      [{ id: 'folder-art', label: 'Canvases', parentId: null, order: 1, section: 'artifacts' }],
      'artifact-child',
    )

    expect(nodes.map((node) => [node.id, node.kind])).toEqual([
      ['folder-art', 'folder'],
      ['artifact-root', 'artifact'],
    ])
    expect(nodes[0]).toMatchObject({ id: 'folder-art', expanded: true })
    expect(nodes[0].children?.[0]).toMatchObject({
      id: 'artifact-child',
      active: true,
      selected: true,
      badge: 'processing',
      status: 'processing',
    })
  })

  it('derives move dialog folder options and descendant exclusions from sidebar sections', () => {
    const sections = sidebarSectionsFromDocuments(
      [{ id: 'doc-a', label: 'A', parentId: 'folder-child', order: 1, readOnly: false, sourceFile: null }],
      null,
      [],
      [
        { id: 'folder-root', label: 'Root', parentId: null, order: 1, section: 'documents' },
        { id: 'folder-child', label: 'Child', parentId: 'folder-root', order: 2, section: 'documents' },
        { id: 'folder-artifacts', label: 'Media', parentId: null, order: 1, section: 'artifacts' },
      ],
      new Set(['folder-root', 'folder-artifacts']),
      [
        {
          id: 'artifact-a',
          label: 'Image',
          parentId: 'folder-artifacts',
          order: 1,
          mimeType: 'image/png',
          status: 'ready',
        },
      ],
    )

    expect(sidebarFolderOptionsFromSections(sections)).toEqual([
      { id: 'folder-artifacts', name: 'Media', parentId: null, section: 'artifacts' },
      { id: 'folder-child', name: 'Child', parentId: 'folder-root', section: 'documents' },
      { id: 'folder-root', name: 'Root', parentId: null, section: 'documents' },
    ])
    expect(sidebarFolderMoveExcludeIds(sections, 'folder-root')).toEqual(['folder-root', 'folder-child'])
  })

  it('loads folders, documents, and tags using GRAPH-scoped projection helpers', async () => {
    const calls: Array<{ graphId: string; sparql: string }> = []
    const rest: SidebarDocumentRest = {
      async query(graphId, sparql) {
        calls.push({ graphId, sparql })
        if (sparql === tagListSparql('graph-a')) {
          return {
            rows: [
              {
                tag: '"pragma"',
                count: '"2"^^<http://www.w3.org/2001/XMLSchema#integer>',
              },
            ],
          }
        }
        if (sparql === sidebarArtifactListSparql('graph-a')) {
          return {
            rows: [
              {
                artifact: '<urn:mnemosyne:local:graph:graph-a:artifact:artifact-a>',
                label: '"Image A"',
                order: '"1"^^<http://www.w3.org/2001/XMLSchema#integer>',
                mimeType: '"image/png"',
                status: '"ready"',
                fileType: '"png"',
              },
            ],
          }
        }
        if (sparql === sidebarFolderListSparql('graph-a')) {
          return {
            rows: [
              {
                folder: '<urn:mnemosyne:local:graph:graph-a:folder:folder-a>',
                label: '"Folder A"',
                order: '"1"^^<http://www.w3.org/2001/XMLSchema#integer>',
                section: '"documents"',
              },
            ],
          }
        }
        return {
          rows: [
            {
              doc: '<urn:mnemosyne:local:document:doc-a>',
              label: '"A"',
              parent: '<urn:mnemosyne:local:graph:graph-a:folder:folder-a>',
              order: '"1"^^<http://www.w3.org/2001/XMLSchema#integer>',
            },
          ],
        }
      },
    }

    const sections = await loadSidebarSections(rest, 'graph-a', 'doc-a')
    expect(calls).toEqual([
      { graphId: 'graph-a', sparql: sidebarDocumentListSparql('graph-a') },
      { graphId: 'graph-a', sparql: sidebarFolderListSparql('graph-a') },
      { graphId: 'graph-a', sparql: sidebarArtifactListSparql('graph-a') },
      { graphId: 'graph-a', sparql: tagListSparql('graph-a') },
    ])
    expect(sections[0].nodes?.[0]).toMatchObject({
      id: 'folder-a',
      label: 'Folder A',
      kind: 'folder',
      expanded: true,
    })
    expect(sections[0].nodes?.[0].children?.[0]).toMatchObject({
      id: 'doc-a',
      label: 'A',
      active: true,
      selected: true,
    })
    expect(sections[1].nodes?.find((node) => node.id === 'artifact-a')).toMatchObject({
      id: 'artifact-a',
      kind: 'artifact',
      badge: 'png',
    })
    expect(sections[2].nodes?.find((node) => node.id === 'tag:pragma')).toMatchObject({
      label: 'pragma',
      count: 2,
    })
  })
})
