import { describe, expect, it } from 'vitest'
import type { FilePaneSection } from '@shrubbery/nucleus'
import { fileActionScope, fileWorkspaceInspector, projectFileWorkspace, validateFileMove } from './file-workspace.js'

// The prototype's version of these tests drove the harness fixture's direct-Yjs store; the shell never uses that
// store, so these drive the projection with the sidebar sections the shell actually hands it.
function sections(): FilePaneSection[] {
  return [
    { id: 'documents', label: 'Documents', nodes: [
      { id: 'power', label: 'Power', kind: 'folder', children: [
        { id: 'connectors', label: 'Connectors', kind: 'folder', children: [] },
        { id: 'notes', label: 'Power notes', kind: 'document' },
      ] },
      { id: 'archive', label: 'Archive', kind: 'folder', children: [] },
    ] },
    { id: 'artifacts', label: 'Files', nodes: [
      { id: 'pdf-1', label: 'Connector.pdf', kind: 'artifact', sourceFile: { sizeBytes: 1024, originalFilename: 'Connector.pdf' } },
      { id: 'pdf-2', label: 'Power.pdf', kind: 'artifact', sourceFile: { sizeBytes: 2048, originalFilename: 'Power.pdf' } },
    ] },
  ]
}

describe('Files uses the workspace projection', () => {
  it('keeps folder scope recursive and deduplicates a file selected with its ancestor', () => {
    const view = projectFileWorkspace(sections(), null, ['folder:power', 'document:notes'])
    expect(fileActionScope(view, view.selection).map(e => e.node.id)).toEqual(['notes'])
    const files = projectFileWorkspace(sections(), null, ['artifact:pdf-1', 'artifact:pdf-2'])
    expect(fileWorkspaceInspector(files).identity.chips).toContainEqual({ label: 'Size', value: '3 KB' })
  })

  it('uses distinct identities when a document and an artifact share a raw id', () => {
    const view = projectFileWorkspace([
      { id: 'documents', label: 'Documents', nodes: [{ id: 'one', label: 'Notes', kind: 'document' }] },
      { id: 'artifacts', label: 'Files', nodes: [{ id: 'one', label: 'Original.pdf', kind: 'artifact' }] },
    ], null, ['document:one', 'artifact:one'])
    expect(view.entries.size).toBe(2)
    expect(fileActionScope(view, view.selection)).toHaveLength(2)
  })

  it('shows a folder with its breadcrumbs and its location', () => {
    const view = projectFileWorkspace(sections(), 'folder:connectors', [])
    expect(view.breadcrumbs.map(c => c.label)).toEqual(['Files', 'Power', 'Connectors'])
    expect(fileWorkspaceInspector(view).identity.chips).toContainEqual({ label: 'Location', value: 'Files / Power' })
  })

  it('rejects a folder moved inside itself and a selection that has changed', () => {
    const view = projectFileWorkspace(sections(), null, [])
    expect(() => validateFileMove(view, ['folder:power'], 'folder:connectors')).toThrow('inside itself')
    expect(() => validateFileMove(view, ['folder:power', 'missing'], 'folder:archive')).toThrow('selection has changed')
    expect(() => validateFileMove(view, ['document:notes'], 'artifact:pdf-1')).toThrow('no longer available')
    expect(() => validateFileMove(view, ['folder:power'], 'folder:archive')).not.toThrow()
  })

  it('falls back to Files and clears stale selection when the viewed folder has gone', () => {
    const view = projectFileWorkspace(sections(), 'folder:deleted', ['folder:deleted'])
    expect(view.folderId).toBeNull()
    expect(view.selection).toEqual([])
  })
})
