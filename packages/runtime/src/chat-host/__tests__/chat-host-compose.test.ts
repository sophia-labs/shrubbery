/**
 * chat-host-compose.test.ts — the shell asks the chat to put words in the composer (a passage quoted from the Reader).
 * NO MOCKS: the real <sh-chat-host> through the real mountChatHost, the real <sh-chat-panel>, the real local ChatService.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { html, render, type TemplateResult } from 'lit'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import { ShChatHost } from '../chat-host.js'
import { CHAT_COMPOSE_EVENT } from '../chat-host.js'
import { mountChatHost } from '../mount-chat-host.js'

afterEach(() => { document.body.innerHTML = ''; window.sessionStorage.clear(); window.localStorage.clear() })

async function boot(): Promise<ShChatHost> {
  const service = makeLocalChatService()
  const session = await service.createSession({ title: 'Reading' })
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(html`<div>${mountChatHost(service, session.id) as unknown as TemplateResult}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await host.updateComplete
  await Promise.resolve()
  await host.updateComplete
  return host
}

const offer = (text: string): { text: string; handled: boolean } => {
  const detail = { text, handled: false }
  document.dispatchEvent(new CustomEvent(CHAT_COMPOSE_EVENT, { detail }))
  return detail
}

describe('mn-chat-compose', () => {
  it('puts the words in the draft of the conversation shown, and says it took them', async () => {
    const host = await boot()
    const detail = offer('From "Dreams", page 12:\n\n> a quoted passage\n\n')
    expect(detail.handled).toBe(true)
    await host.updateComplete
    expect(host.panel!.draft).toContain('> a quoted passage')
    expect(host.panel!.draft).toContain('From "Dreams", page 12')
  })

  it('adds to what is already written, on a new paragraph, and never sends', async () => {
    const host = await boot()
    offer('first')
    offer('second')
    await host.updateComplete
    expect(host.panel!.draft).toBe('first\n\nsecond')
  })

  it('is not handled when there is no host (nobody to take it)', () => {
    expect(offer('nobody home').handled).toBe(false)
  })

  it('ignores empty text', async () => {
    const host = await boot()
    expect(offer('   ').handled).toBe(false)
    expect(host.panel!.draft ?? '').toBe('')
  })
})
