/**
 * The conversation the shell opens at boot has no title of its own (NO MOCKS: a real
 * local chat service).
 *
 * Defect guarded (F-step-zero, Imported chats UX notes): the shell minted its boot
 * conversation with the placeholder title "organism-chat", so the list of current
 * chats showed one row with a generic name, and nothing ever replaced it. A
 * conversation with no title is named by what is said in it.
 */
import { makeLocalChatService } from '@shrubbery/runtime'
import { describe, expect, it } from 'vitest'
import { ensureActiveChatSession } from '../active-chat-session.js'

describe('ensureActiveChatSession — the boot conversation', () => {
  it('starts with no title of its own', async () => {
    const service = makeLocalChatService()
    const id = await ensureActiveChatSession(service, { graphId: 'sophia-cluster' })
    const session = (await service.listSessions()).find(candidate => candidate.id === id)
    expect(session).toBeDefined()
    expect(session!.title).toBeNull()
  })

  it('still takes a title the shell chooses to give it', async () => {
    const service = makeLocalChatService()
    const id = await ensureActiveChatSession(service, { graphId: 'sophia-cluster', title: 'Scratch' })
    expect((await service.listSessions()).find(candidate => candidate.id === id)!.title).toBe('Scratch')
  })

  it('reuses the conversation in the active slot rather than minting another', async () => {
    const service = makeLocalChatService()
    const first = await ensureActiveChatSession(service, { graphId: 'sophia-cluster' })
    const again = await ensureActiveChatSession(service, { graphId: 'sophia-cluster' })
    expect(again).toBe(first)
    expect(await service.listSessions()).toHaveLength(1)
  })
})
