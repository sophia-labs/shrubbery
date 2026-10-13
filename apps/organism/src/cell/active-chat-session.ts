import type { ChatService } from '@shrubbery/runtime'

/** Reuse the active local chat slot across shell reloads; mint only when absent. */
export async function ensureActiveChatSession(
  service: ChatService,
  options: { readonly graphId: string; readonly title?: string | null },
): Promise<string> {
  const slot = service.activeSlot
  const slotted = service.slotSessions()[slot]
  if (slotted) {
    const sessions = await service.listSessions()
    if (sessions.some(session => session.id === slotted)) return slotted
    service.bindSlotSession(slot, null)
  }
  // No title of its own: a conversation is named by what is said in it.
  const session = await service.createSession({
    title: options.title ?? null,
    graphId: options.graphId,
  })
  service.bindSlotSession(slot, session.id)
  return session.id
}
