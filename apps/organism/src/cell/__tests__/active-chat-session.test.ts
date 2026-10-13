import { describe, expect, it, vi } from 'vitest'
import type { ChatService } from '@shrubbery/runtime'
import { ensureActiveChatSession } from '../active-chat-session.js'

function service(slotted: string | null, listed: string[]): ChatService {
  return {
    activeSlot: 0,
    slotSessions: () => [slotted, null, null],
    listSessions: vi.fn(async () => listed.map(id => ({
      id, title: null, created_at: '', updated_at: '',
    }))),
    createSession: vi.fn(async () => ({
      id: 'c2chat-new', title: null, created_at: '', updated_at: '',
    })),
    bindSlotSession: vi.fn(),
  } as unknown as ChatService
}

describe('ensureActiveChatSession', () => {
  it('reuses a valid active slot without minting another descriptor', async () => {
    const value = service('c2chat-existing', ['c2chat-existing'])
    await expect(ensureActiveChatSession(value, { graphId: 'sophia-cluster' }))
      .resolves.toBe('c2chat-existing')
    expect(value.createSession).not.toHaveBeenCalled()
    expect(value.bindSlotSession).not.toHaveBeenCalled()
  })

  it('replaces an absent or stale slot with one new local descriptor', async () => {
    const value = service('c2chat-stale', [])
    await expect(ensureActiveChatSession(value, { graphId: 'sophia-cluster' }))
      .resolves.toBe('c2chat-new')
    expect(value.createSession).toHaveBeenCalledOnce()
    expect(value.bindSlotSession).toHaveBeenNthCalledWith(1, 0, null)
    expect(value.bindSlotSession).toHaveBeenNthCalledWith(2, 0, 'c2chat-new')
  })
})
