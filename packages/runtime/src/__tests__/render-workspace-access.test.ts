import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderWorkspace,
  type WorkspaceAccessAddDetail,
  type WorkspaceAccessRemoveDetail,
  type WorkspaceAccessRoleChangeDetail,
} from '../render-workspace.js'

describe('renderWorkspace hosted access seam', () => {
  it('reflects controlled grant state into the top bar and forwards member intents', () => {
    const intents: unknown[] = []
    const access = {
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentRole: 'owner' as const,
      status: 'ready' as const,
      grants: [{
        userId: 'owner-1',
        role: 'owner' as const,
        grantedAt: '2026-07-10T12:00:00Z',
        grantedBy: 'owner-1',
      }],
      onOpen: () => intents.push('open'),
      onRefresh: () => intents.push('refresh'),
      onAdd: (detail: WorkspaceAccessAddDetail) => intents.push(['add', detail]),
      onRoleChange: (detail: WorkspaceAccessRoleChangeDetail) => intents.push(['role', detail]),
      onRemove: (detail: WorkspaceAccessRemoveDetail) => intents.push(['remove', detail]),
    }
    const container = renderWorkspace(GARDEN_DEFAULT, { chrome: { access } })
    const top = container.querySelector('mn-top-bar') as HTMLElement & { access?: unknown }
    expect(top.access).toBe(access)

    top.dispatchEvent(new CustomEvent('mn-access-open', { bubbles: true, composed: true }))
    top.dispatchEvent(new CustomEvent('mn-access-refresh', { bubbles: true, composed: true }))
    top.dispatchEvent(new CustomEvent('mn-access-add', {
      detail: { userId: 'viewer-2', role: 'viewer' },
      bubbles: true,
      composed: true,
    }))
    top.dispatchEvent(new CustomEvent('mn-access-role-change', {
      detail: { userId: 'viewer-2', role: 'editor' },
      bubbles: true,
      composed: true,
    }))
    top.dispatchEvent(new CustomEvent('mn-access-remove', {
      detail: { userId: 'viewer-2' },
      bubbles: true,
      composed: true,
    }))
    expect(intents).toEqual([
      'open',
      'refresh',
      ['add', { userId: 'viewer-2', role: 'viewer' }],
      ['role', { userId: 'viewer-2', role: 'editor' }],
      ['remove', { userId: 'viewer-2' }],
    ])
  })

  it('keeps the access manager absent when the shell supplies no hosted grant capability', () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { chrome: { access: null } })
    const top = container.querySelector('mn-top-bar') as HTMLElement & { access?: unknown }
    expect(top.access).toBeNull()
  })
})
