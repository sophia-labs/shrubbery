import { describe, expect, it } from 'vitest'
import {
  createSidebarDocument,
  createSidebarFolder,
  defaultSidebarIdFactory,
  deleteSidebarDocument,
  deleteSidebarFolder,
  moveSidebarDocument,
  moveSidebarFolder,
  makeSidebarDocumentEditable,
  renameSidebarDocument,
  renameSidebarFolder,
  SidebarMutationRejectedError,
  sidebarEntitySlug,
  type SidebarMutationMcp,
} from '../sidebar-mutations.js'

function recordingMcp(result: unknown = {}): SidebarMutationMcp & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    async toolsCall(name, args) {
      calls.push({ name, args })
      return result
    },
  }
}

describe('sidebar mutation adapter', () => {
  it('creates documents through Garden-compatible MCP arguments', async () => {
    const mcp = recordingMcp()
    const result = await createSidebarDocument(
      mcp,
      {
        graphId: ' graph-a ',
        title: ' Architecture Notes ',
        parentId: ' folder-a ',
      },
      { idFactory: () => 'doc-architecture-notes' },
    )

    expect(result).toEqual({ documentId: 'doc-architecture-notes' })
    expect(mcp.calls).toEqual([
      {
        name: 'create_document',
        args: {
          graphId: 'graph-a',
          documentId: 'doc-architecture-notes',
          title: 'Architecture Notes',
          parentId: 'folder-a',
          order: null,
          documentKind: null,
          dailyNoteDate: null,
          dailyNoteTimeZone: null,
        },
      },
    ])
  })

  it('creates folders with the documents section default', async () => {
    const mcp = recordingMcp()
    const result = await createSidebarFolder(
      mcp,
      {
        graphId: 'graph-a',
        name: 'Research',
      },
      { idFactory: () => 'folder-research' },
    )

    expect(result).toEqual({ folderId: 'folder-research' })
    expect(mcp.calls).toEqual([
      {
        name: 'create_folder',
        args: {
          graphId: 'graph-a',
          folderId: 'folder-research',
          name: 'Research',
          parentId: null,
          section: 'documents',
          order: null,
        },
      },
    ])
  })

  it('renames and deletes documents with the existing Garden MCP tools', async () => {
    const mcp = recordingMcp()

    await renameSidebarDocument(mcp, {
      graphId: 'graph-a',
      documentId: 'doc-a',
      title: 'Renamed',
    })
    await deleteSidebarDocument(mcp, {
      graphId: 'graph-a',
      documentId: 'doc-a',
    })

    expect(mcp.calls).toEqual([
      {
        name: 'rename',
        args: {
          graphId: 'graph-a',
          entityType: 'document',
          entityId: 'doc-a',
          newName: 'Renamed',
        },
      },
      {
        name: 'delete_document',
        args: {
          graphId: 'graph-a',
          documentId: 'doc-a',
        },
      },
    ])
  })

  it('renames and deletes folders with the existing Garden MCP tools', async () => {
    const mcp = recordingMcp()

    await renameSidebarFolder(mcp, {
      graphId: 'graph-a',
      folderId: 'folder-a',
      name: 'Research',
    })
    await deleteSidebarFolder(mcp, {
      graphId: 'graph-a',
      folderId: 'folder-a',
    })

    expect(mcp.calls).toEqual([
      {
        name: 'rename',
        args: {
          graphId: 'graph-a',
          entityType: 'folder',
          entityId: 'folder-a',
          newName: 'Research',
        },
      },
      {
        name: 'delete',
        args: {
          graphId: 'graph-a',
          type: 'folder',
          folderId: 'folder-a',
          cascade: false,
        },
      },
    ])
  })

  it('moves documents and folders with Garden-compatible MCP arguments', async () => {
    const mcp = recordingMcp()

    await moveSidebarDocument(mcp, {
      graphId: ' graph-a ',
      documentId: ' doc-a ',
      parentId: ' folder-b ',
    })
    await moveSidebarFolder(mcp, {
      graphId: 'graph-a',
      folderId: 'folder-a',
      parentId: null,
      order: 12,
    })

    expect(mcp.calls).toEqual([
      {
        name: 'move_documents',
        args: {
          graphId: 'graph-a',
          documentIds: ['doc-a'],
          parentId: 'folder-b',
          order: null,
        },
      },
      {
        name: 'move_folder',
        args: {
          graphId: 'graph-a',
          folderId: 'folder-a',
          newParentId: null,
          newOrder: 12,
        },
      },
    ])
  })

  it('parses Garden move results from MCP text content', async () => {
    const mcp = recordingMcp({
      content: [{
        type: 'text',
        text: JSON.stringify({ moved: ['doc-a'], missing: [], parentId: 'folder-b' }),
      }],
    })

    await expect(moveSidebarDocument(mcp, {
      graphId: 'graph-a',
      documentId: 'doc-a',
      parentId: 'folder-b',
    })).resolves.toEqual({
      moved: ['doc-a'],
      missing: [],
      parentId: 'folder-b',
    })
  })

  it('rejects a document move that Garden reports as missing', async () => {
    const mcp = recordingMcp({
      content: [{
        type: 'text',
        text: JSON.stringify({ moved: [], missing: ['doc-a'], parentId: 'folder-b' }),
      }],
    })

    const error = await moveSidebarDocument(mcp, {
      graphId: 'graph-a',
      documentId: 'doc-a',
      parentId: 'folder-b',
    }).catch(reason => reason)

    expect(error).toBeInstanceOf(SidebarMutationRejectedError)
    expect(error).toMatchObject({ mutationDelivery: 'rejected', retryable: false })
    expect(error.message).toContain('document is missing')
  })

  it('makes imported documents editable through gardend workspace CRDT authority', async () => {
    const mcp = recordingMcp()
    await makeSidebarDocumentEditable(mcp, {
      graphId: ' graph-a ',
      documentId: ' imported-pdf ',
    })
    expect(mcp.calls).toEqual([{
      name: 'make_document_editable',
      args: { graphId: 'graph-a', documentId: 'imported-pdf' },
    }])
  })

  it('normalizes local ids without backend imports', () => {
    expect(sidebarEntitySlug('  Garden: Focus + Plans!  ')).toBe('garden-focus-plans')
    expect(sidebarEntitySlug('---')).toBe('untitled')
    expect(defaultSidebarIdFactory('document', 'Garden Focus')).toMatch(/^doc-garden-focus-[a-z0-9-]+$/)
    expect(defaultSidebarIdFactory('folder', 'Garden Focus')).toMatch(/^folder-garden-focus-[a-z0-9-]+$/)
  })

  it('rejects blank required inputs before making MCP calls', async () => {
    const mcp = recordingMcp()

    await expect(createSidebarDocument(mcp, { graphId: 'graph-a', title: ' ' })).rejects.toThrow('title is required')
    await expect(renameSidebarDocument(mcp, { graphId: ' ', documentId: 'doc-a', title: 'A' })).rejects.toThrow(
      'graphId is required',
    )
    await expect(deleteSidebarFolder(mcp, { graphId: 'graph-a', folderId: ' ' })).rejects.toThrow(
      'folderId is required',
    )
    await expect(moveSidebarDocument(mcp, { graphId: 'graph-a', documentId: ' ', parentId: null })).rejects.toThrow(
      'documentId is required',
    )

    const validation = await createSidebarDocument(mcp, { graphId: 'graph-a', title: ' ' }).catch(error => error)
    expect(validation).toMatchObject({ mutationDelivery: 'rejected', retryable: true })

    expect(mcp.calls).toEqual([])
  })
})
