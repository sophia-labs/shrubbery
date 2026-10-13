// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FolderViewScope, WorkspaceFileRef } from '@shrubbery/nucleus'
import { resolveFilesMenuTarget } from './folder-view-menu-target.js'
const scope: FolderViewScope = { ownerId: 'owner', graphId: 'graph', graphIncarnation: 'original-life', folderId: 'folder',
  viewId: 'files-default', audience: { kind: 'shared' } }
const file: WorkspaceFileRef = { ownerId: scope.ownerId, graphId: scope.graphId, graphIncarnation: scope.graphIncarnation,
  kind: 'artifact', id: 'reused-id' }
describe('retained Files menu qualified target', () => {
  it('resolves the current qualified reference rather than the captured node', () => {
    const current = { ...file }
    expect(resolveFilesMenuTarget({ scope, file }, scope, [current])).toBe(current)
  })
  it('refuses a deleted, filtered or differently typed target with the same raw ID', () => {
    expect(resolveFilesMenuTarget({ scope, file }, scope, [])).toBeNull()
    expect(resolveFilesMenuTarget({ scope, file }, scope, [{ ...file, kind: 'document' }])).toBeNull()
  })
  it('refuses owner, lifetime, folder, view and audience transitions even if the raw ID survives', () => {
    const changed: FolderViewScope[] = [{ ...scope, ownerId: 'other' }, { ...scope, graphIncarnation: 'replacement-life' },
      { ...scope, folderId: null }, { ...scope, viewId: 'other-view' }, { ...scope, audience: { kind: 'personal', userId: 'reader' } }]
    for (const active of changed) expect(resolveFilesMenuTarget({ scope, file }, active,
      [{ ...file, ownerId: active.ownerId, graphIncarnation: active.graphIncarnation }])).toBeNull()
  })
})
