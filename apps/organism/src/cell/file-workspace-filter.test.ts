import { describe, expect, it } from 'vitest'
import { projectFileWorkspace, fileWorkspaceActions, fileWorkspaceInspector } from './file-workspace.js'
import { filterFileWorkspace } from './file-workspace-filter.js'

describe('Files filtered selection scope', () => {
  const view = () => projectFileWorkspace([{ id: 'artifacts', label: 'Files', nodes: [
    { id: 'one', kind: 'artifact', label: 'Power.pdf' },
    { id: 'two', kind: 'artifact', label: 'Thermal.pdf' },
  ] }], null, ['artifact:one'])
  it('removes hidden selected files from actions and inspector before a different visible file is clicked', () => {
    const filtered = filterFileWorkspace(view(), 'Thermal')
    expect(filtered.nodes.map(node => node.id)).toEqual(['artifact:two'])
    expect(filtered.selection).toEqual([])
    expect(fileWorkspaceActions(filtered, true).find(action => action.id === 'rename')).toMatchObject({ disabled: true })
    expect(fileWorkspaceInspector(filtered).identity.title).not.toBe('Power.pdf')
  })
  it('keeps a matching selected file and does not resurrect a pruned selection when search clears', () => {
    expect(filterFileWorkspace(view(), 'POWER').selection).toEqual(['artifact:one'])
    const pruned = filterFileWorkspace(view(), 'Thermal')
    expect(filterFileWorkspace(pruned, '').selection).toEqual([])
  })
})
