/**
 * What the shell lets the chat do about credits reaches the real <sh-chat-host>.
 *
 * NO MOCKS: the production renderWorkspace(), the production mountChatHost(), a real local
 * ChatService and the real <sh-chat-host>. The chat has had its credit controls built and
 * switched off since the voices release: `showBalance` and `canAddCredits` default to false and
 * no caller set either, so the balance line and "Add credits" could never appear. The credits
 * release is the shell turning them on, for a hosted account only, through one option.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'
import { makeLocalChatService } from '../chat-services/local-chat-service.js'
import { mountChatHost } from '../chat-host/mount-chat-host.js'
import type { ShChatHost } from '../chat-host/chat-host.js'
import { html, render } from 'lit'

const chatHost = (container: HTMLElement): ShChatHost | null => container.querySelector('#sh-chat-host') as ShChatHost | null

async function settle(container: HTMLElement): Promise<void> {
  const host = chatHost(container)
  if (!host) return
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('chatHost.credits on the workspace', () => {
  it('leaves the voices release as it was when the shell says nothing: no balance line, no Add credits', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-default' })
    const container = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id } })
    document.body.appendChild(container)
    await settle(container)

    expect(chatHost(container)!.showBalance).toBe(false)
    expect(chatHost(container)!.canAddCredits).toBe(false)
  })

  it('threads chatHost.credits through to the real sh-chat-host, on every path that mounts it', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-threaded' })
    const credits = { showBalance: true, canAddCredits: true }

    const region = renderWorkspace(GARDEN_DEFAULT, { chatHost: { service, sessionId: session.id, credits } })
    document.body.appendChild(region)
    await settle(region)
    expect(chatHost(region)!.showBalance).toBe(true)
    expect(chatHost(region)!.canAddCredits).toBe(true)

    const panel = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id, credits },
      chrome: { rightPanel: 'chat' },
    })
    document.body.appendChild(panel)
    await settle(panel)
    expect(chatHost(panel)!.showBalance).toBe(true)
    expect(chatHost(panel)!.canAddCredits).toBe(true)
  })

  it('switches the two controls independently: a balance line without a button, and the reverse', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-independent' })

    const balanceOnly = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id, credits: { showBalance: true } },
    })
    document.body.appendChild(balanceOnly)
    await settle(balanceOnly)
    expect(chatHost(balanceOnly)!.showBalance).toBe(true)
    expect(chatHost(balanceOnly)!.canAddCredits).toBe(false)
    balanceOnly.remove()

    const buttonOnly = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id, credits: { canAddCredits: true } },
    })
    document.body.appendChild(buttonOnly)
    await settle(buttonOnly)
    expect(chatHost(buttonOnly)!.showBalance).toBe(false)
    expect(chatHost(buttonOnly)!.canAddCredits).toBe(true)
  })

  it('threads the credits notice source through as well, so the shell’s one object is the host’s', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-notice-threaded' })
    const notice = {
      current: () => null,
      dismiss: () => undefined,
      subscribe: () => () => undefined,
    }
    const container = renderWorkspace(GARDEN_DEFAULT, {
      chatHost: { service, sessionId: session.id, credits: { canAddCredits: true, notice } },
    })
    document.body.appendChild(container)
    await settle(container)
    expect(chatHost(container)!.creditsNotice).toBe(notice)
  })

  it('takes the controls back when a later render says the shell cannot sell credits (a person signed out, a local workspace)', async () => {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-withdrawn' })
    const container = document.createElement('div')
    document.body.appendChild(container)

    render(html`<div class="main">${mountChatHost(service, session.id, { credits: { showBalance: true, canAddCredits: true } }) as never}</div>`, container)
    await settle(container)
    expect(chatHost(container)!.canAddCredits).toBe(true)

    render(html`<div class="main">${mountChatHost(service, session.id) as never}</div>`, container)
    await settle(container)
    expect(chatHost(container)!.showBalance).toBe(false)
    expect(chatHost(container)!.canAddCredits).toBe(false)
  })
})
