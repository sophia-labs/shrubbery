import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderWorkspace,
  type WorkspaceAccessAddDetail,
  type WorkspaceAccessInvitationCancelDetail,
  type WorkspaceAccessInviteDetail,
  type WorkspaceAccessRemoveDetail,
  type WorkspaceAccessRoleChangeDetail,
  type WorkspaceGeneralAccessChangeDetail,
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

  it('forwards share-by-email, invitation-cancel and general-access intents', () => {
    const intents: unknown[] = []
    const access = {
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentRole: 'owner' as const,
      status: 'ready' as const,
      grants: [],
      onInvite: (detail: WorkspaceAccessInviteDetail) => intents.push(['invite', detail]),
      onInvitationCancel: (detail: WorkspaceAccessInvitationCancelDetail) => intents.push(['cancel', detail]),
      onGeneralAccessChange: (detail: WorkspaceGeneralAccessChangeDetail) => intents.push(['general', detail]),
    }
    const container = renderWorkspace(GARDEN_DEFAULT, { chrome: { access } })
    const top = container.querySelector('mn-top-bar') as HTMLElement
    const send = (name: string, detail: unknown) => top.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
    send('mn-access-invite', { email: 'ada@example.test', role: 'viewer' })
    send('mn-access-invitation-cancel', { invitationId: 'inv-1' })
    send('mn-access-general-change', { access: 'public' })
    expect(intents).toEqual([
      ['invite', { email: 'ada@example.test', role: 'viewer' }],
      ['cancel', { invitationId: 'inv-1' }],
      ['general', { access: 'public' }],
    ])
  })

  it('keeps the access manager absent when the shell supplies no hosted grant capability', () => {
    const container = renderWorkspace(GARDEN_DEFAULT, { chrome: { access: null } })
    const top = container.querySelector('mn-top-bar') as HTMLElement & { access?: unknown }
    expect(top.access).toBeNull()
  })
})
