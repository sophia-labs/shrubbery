/**
 * The Files center route (CONTRACT-files rudiments, design §12.1): when the shell supplies `files`, the center is the
 * Files pane, on the Surface path and on the legacy path alike, and no editor host is mounted under it. The Files
 * section of the left tree can carry one action, which leaves as an intent. Real renderWorkspace into happy-dom.
 */
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady, type WorkspaceFilesOptions } from '../index.js'
import type { WorkspaceSurfaceElement } from '../layout/workspace-surface-element.js'

function filesOptions(partial: Partial<WorkspaceFilesOptions> = {}): WorkspaceFilesOptions {
  const noop = () => {}
  return {
    graphId: 'graph-a',
    breadcrumbs: [{ id: null, label: 'Files' }],
    face: 'list',
    iconSize: 'medium',
    snapToGrid: false,
    canvas: null,
    rows: [{ key: 'artifact:file-1', label: 'report.pdf', kind: 'file', type: 'PDF', selected: false }],
    preview: null,
    canUpload: true,
    canCreate: true,
    canChangeView: true,
    maxUploadLabel: '50 MB',
    status: { text: '1 item', message: '', undoLabel: null },
    onNavigate: noop, onUpload: noop, onNewFolder: noop, onFace: noop, onIconSize: noop, onSnapToGrid: noop, onUndo: noop,
    onClosePreview: noop,
    ...partial,
  }
}

describe('the Files center route', () => {
  it('on the Surface path is one center leaf holding the Files pane, with no editor host under it', async () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { surface: true, files: filesOptions() })
    await workspaceSurfaceReady(container)
    const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
    const layout = surface.surfaceDocument()!
    expect(layout.nodes['workspace-center-files']).toMatchObject({ kind: 'leaf' })
    const pane = container.querySelector('section.mn-files-pane')
    expect(pane).not.toBeNull()
    expect(pane!.getAttribute('data-graph-id')).toBe('graph-a')
    expect(pane!.closest('[data-surface-part="center-route"]')).not.toBeNull()
    expect(container.querySelector('#mn-editor-host')).toBeNull()
  })

  it('is an explicit navigation, so it wins over Home', async () => {
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      files: filesOptions(),
      home: { graphId: 'graph-a', status: 'ready', documents: [], recent: [], pinned: [] } as never,
    })
    await workspaceSurfaceReady(container)
    const layout = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!.surfaceDocument()!
    expect(layout.nodes['workspace-center-files']).toBeDefined()
    expect(layout.nodes['workspace-center-home']).toBeUndefined()
  })

  it('on the legacy path renders the pane in the center region', () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { files: filesOptions() })
    const center = container.querySelector('.split-pane[data-region="region-center"]')!
    expect(center.querySelector('section.mn-files-pane')).not.toBeNull()
    expect(container.querySelector('#mn-editor-host')).toBeNull()
  })

  it('without `files` nothing of the pane is drawn', async () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { surface: true })
    await workspaceSurfaceReady(container)
    expect(container.querySelector('section.mn-files-pane')).toBeNull()
  })
})

describe('the left tree section action', () => {
  it('leaves as an intent with the section and the action', async () => {
    const seen: { sectionId: string; actionId: string }[] = []
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      sidebar: {
        sections: [{ id: 'artifacts', label: 'Files', icon: 'folder', nodes: [], action: { id: 'open-files', label: 'Open Files', icon: 'folder' } }],
        onSectionAction: detail => { seen.push({ sectionId: detail.sectionId, actionId: detail.actionId }) },
      },
    })
    await workspaceSurfaceReady(container)
    const panel = container.querySelector('mn-sidebar-panel')!
    panel.dispatchEvent(new CustomEvent('mn-sidebar-section-action', {
      detail: { sectionId: 'artifacts', actionId: 'open-files' }, bubbles: true, composed: true,
    }))
    expect(seen).toEqual([{ sectionId: 'artifacts', actionId: 'open-files' }])
  })
})
