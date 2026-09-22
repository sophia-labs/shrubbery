import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'

describe('renderWorkspace home + tenancy seams', () => {
  it('renders the controlled home in the center and forwards home intents', async () => {
    const intents: string[] = []
    const container = renderWorkspace(GARDEN_DEFAULT, {
      home: {
        graphId: 'graph-a',
        graphTitle: 'Graph A',
        resume: { graphId: 'graph-a', documentId: 'resume', title: 'Resume' },
        pinned: [{ graphId: 'graph-a', documentId: 'pinned', title: 'Pinned' }],
        onNewDocument: () => intents.push('new'),
        onOpenDocument: document => intents.push(`open:${document.documentId}`),
        onPinDocument: (document, pinned) => intents.push(`pin:${document.documentId}:${pinned}`),
      },
      dailyNotes: { todayKey: '2026-07-10' },
    })
    const home = container.querySelector('mn-home-view') as HTMLElement & {
      graphId: string
      pinned: Array<{ documentId: string }>
    }
    expect(home).not.toBeNull()
    expect(home.graphId).toBe('graph-a')
    expect(home.pinned.map(item => item.documentId)).toEqual(['pinned'])
    expect(container.querySelector('sh-editor-host')).toBeNull()
    home.dispatchEvent(new CustomEvent('mn-home-new-document', { bubbles: true }))
    home.dispatchEvent(new CustomEvent('mn-home-open-document', {
      detail: { document: { graphId: 'graph-a', documentId: 'resume', title: 'Resume' } },
      bubbles: true,
    }))
    home.dispatchEvent(new CustomEvent('mn-home-pin-document', {
      detail: { document: { graphId: 'graph-a', documentId: 'pinned', title: 'Pinned' }, pinned: false },
      bubbles: true,
    }))
    expect(intents).toEqual(['new', 'open:resume', 'pin:pinned:false'])
  })

  it('threads workspace rows and selector intents through the top bar', async () => {
    const intents: string[] = []
    const container = renderWorkspace(GARDEN_DEFAULT, {
      chrome: {
        activeWorkspaceId: 'graph-a',
        workspaceStatus: 'ready',
        workspaces: [
          { graphId: 'graph-a', title: 'Graph A', role: 'owner', cellState: 'running' },
          { graphId: 'graph-b', title: 'Graph B', role: 'editor', cellState: 'stopped' },
        ],
        onWorkspaceSelect: workspace => intents.push(`select:${workspace.graphId}`),
        onWorkspaceCreate: () => intents.push('create'),
        onWorkspaceDelete: workspace => intents.push(`delete:${workspace.graphId}`),
      },
    })
    const top = container.querySelector('mn-top-bar') as HTMLElement & {
      activeWorkspaceId: string
      workspaces: Array<{ graphId: string }>
    }
    expect(top.activeWorkspaceId).toBe('graph-a')
    expect(top.workspaces.map(item => item.graphId)).toEqual(['graph-a', 'graph-b'])
    top.dispatchEvent(new CustomEvent('mn-workspace-select', {
      detail: { workspace: { graphId: 'graph-b', title: 'Graph B', role: 'editor', cellState: 'stopped' } },
      bubbles: true,
    }))
    top.dispatchEvent(new CustomEvent('mn-workspace-delete', {
      detail: { workspace: { graphId: 'graph-a', title: 'Graph A', role: 'owner', cellState: 'running' } },
      bubbles: true,
    }))
    top.dispatchEvent(new CustomEvent('mn-workspace-create', { bubbles: true }))
    expect(intents).toEqual(['select:graph-b', 'delete:graph-a', 'create'])
  })

  it('threads controlled Quick Clip state and requests through the top bar', () => {
    const intents: string[] = []
    const container = renderWorkspace(GARDEN_DEFAULT, {
      chrome: {
        quickClip: {
          available: true,
          status: 'error',
          error: 'Extractor unavailable',
          onRequest: detail => intents.push(`${detail.kind}:${detail.url}`),
          onReset: () => intents.push('reset'),
        },
      },
    })
    const top = container.querySelector('mn-top-bar') as HTMLElement & {
      quickClipAvailable: boolean
      quickClipStatus: string
      quickClipError: string
    }
    expect(top.quickClipAvailable).toBe(true)
    expect(top.quickClipStatus).toBe('error')
    expect(top.quickClipError).toBe('Extractor unavailable')
    top.dispatchEvent(new CustomEvent('mn-quick-clip-request', {
      detail: { kind: 'web', url: 'https://example.com/article' },
      bubbles: true,
    }))
    top.dispatchEvent(new CustomEvent('mn-quick-clip-reset', { bubbles: true }))
    expect(intents).toEqual(['web:https://example.com/article', 'reset'])
  })
})
