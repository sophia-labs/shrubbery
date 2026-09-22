import { describe, expect, it } from 'vitest'
import { FilePaneController, type FilePaneStorageLike } from './file-pane-controller.js'

function memoryStorage(): FilePaneStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('FilePaneController', () => {
  it('keeps preferences and navigation graph-scoped', () => {
    const storage = memoryStorage()
    const controller = new FilePaneController(storage)
    controller.setSort('alpha', { criterion: 'connectivity', direction: 'desc', foldersFirst: true })
    controller.setColumnPath('alpha', { sectionId: 'documents', folderIds: ['one', 'two'] })
    controller.setSelection('alpha', { ids: ['doc-a', 'doc-b'], nodes: [], anchorId: 'doc-a' })

    expect(controller.snapshot('alpha')).toMatchObject({
      sort: { criterion: 'connectivity', direction: 'desc' },
      selectedIds: ['doc-a', 'doc-b'],
      columnPaths: { documents: ['one', 'two'] },
    })
    expect(controller.snapshot('beta')).toMatchObject({
      sort: { criterion: 'manual', direction: 'asc' },
      selectedIds: [],
      columnPaths: {},
    })
  })

  it('restores only the v1 clean-state schema and normalizes corrupt values', () => {
    const storage = memoryStorage()
    const first = new FilePaneController(storage)
    first.setGrouping('graph', { separateArtifacts: false, showFolders: true })
    first.setSelection('graph', { ids: ['doc', 'doc'], nodes: [], anchorId: 'doc' })

    const restored = new FilePaneController(storage).snapshot('graph')
    expect(restored.grouping).toEqual({ separateArtifacts: false, showFolders: true })
    expect(restored.selectedIds).toEqual(['doc'])

    storage.data.set('shrubbery:file-pane:v1:broken', '{not-json')
    expect(new FilePaneController(storage).snapshot('broken')).toMatchObject({
      sort: { criterion: 'manual', direction: 'asc', foldersFirst: true },
      grouping: { separateArtifacts: true, showFolders: true },
    })
  })
})
