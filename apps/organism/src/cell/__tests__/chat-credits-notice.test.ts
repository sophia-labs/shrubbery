/**
 * The credits notice as the shell builds it, through the real chat host (NO MOCKS: the real notice
 * source with the release's real wording, over real storage semantics, mounted into the real
 * <sh-chat-host> over a real chat service whose balance is read through the one seam a service has,
 * `balance()`; the HTTP read itself is held by the runtime's own suite against a real socket).
 *
 * This is the acceptance the shell cares about (Vera, 2026-10-03): the date and the fee are what the
 * BACKEND says on the balance, nothing is shown until it names a date, a person who put the notice away
 * does not see it again, a different person on the same browser does, and a date the backend moves is
 * a new notice.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { html, render, type nothing } from 'lit'
import {
  CHAT_ADD_CREDITS_EVENT,
  makeLocalChatService,
  mountChatHost,
  type ChatAddCreditsDetail,
  type CreditsFacts,
  type ShChatHost,
} from '@shrubbery/runtime'
import { createCreditsNoticeSource, type CreditsNoticeStorage } from '../credits-notice.js'

class MemoryStorage implements CreditsNoticeStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
const OBSERVING: CreditsFacts = { feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' }

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** A chat whose balance the backend answers with `facts` (null: an older backend that says none of it). */
async function openChat(source: ReturnType<typeof createCreditsNoticeSource>, facts: CreditsFacts | null): Promise<ShChatHost> {
  const base = makeLocalChatService()
  const service = Object.assign(Object.create(base), {
    balance: async () => ({
      initialized: true,
      balanceMicroUsd: 970_000,
      canMakeRequests: true,
      ...(facts ? { facts } : {}),
    }),
  })
  const session = await service.createSession({ title: 'credits-notice' })
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(html`<div class="main">${mountChatHost(service, session.id, { credits: { showBalance: true, canAddCredits: true, notice: source } }) as unknown as typeof nothing}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await host.updateComplete
  await until(() => host.store?.getState().conversationState === 'ready')
  // The balance line is what shows the first read has been taken.
  await until(() => host.store?.getState().accountNote != null)
  await host.updateComplete
  return host
}

const slot = (host: ShChatHost): HTMLElement | null => host.panel?.querySelector<HTMLElement>('.composer-notice') ?? null

afterEach(() => { document.body.innerHTML = ''; window.sessionStorage.clear() })

describe('the credits notice in the chat, from the shell’s own source and the backend’s facts', () => {
  it('says what the backend says: its date, its fee, and where the details are', async () => {
    const host = await openChat(createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' }), OBSERVING)
    await until(() => slot(host) !== null)

    const said = squash(slot(host)!.textContent)
    expect(said).toContain('Credits start on October 12, 2026.')
    expect(said).toContain("You pay the model's price plus a 15% service fee.")
    expect(Array.from(slot(host)!.querySelectorAll('button')).map(button => squash(button.textContent))).toEqual(['Details', 'Dismiss'])
  })

  it('states the fee the backend states, so the flip to 20% needs no rebuild', async () => {
    const host = await openChat(createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' }), { ...OBSERVING, feeBps: 2000, gateMode: 'enforce' })
    await until(() => slot(host) !== null)
    expect(squash(slot(host)!.textContent)).toContain('a 20% service fee')
    expect(squash(slot(host)!.textContent)).not.toContain('15%')
  })

  it('leaves the fee sentence out where the backend names a date and no fee', async () => {
    const host = await openChat(createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' }), { ...OBSERVING, feeBps: null })
    await until(() => slot(host) !== null)
    expect(squash(slot(host)!.textContent)).toContain('Credits start on October 12, 2026.')
    expect(squash(slot(host)!.textContent)).not.toMatch(/service fee|\d+%/)
  })

  it('shows nothing until the backend names a date: absent until it is set, and never a raw brace', async () => {
    for (const facts of [{ ...OBSERVING, startDate: null }, null]) {
      document.body.innerHTML = ''
      const host = await openChat(createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' }), facts)
      await host.updateComplete
      expect(slot(host)).toBeNull()
      expect(squash(host.panel!.textContent)).not.toMatch(/[{}]/)
    }
  })

  it('is put away for good by the person who put it away, on the next visit too', async () => {
    const storage = new MemoryStorage()
    const first = await openChat(createCreditsNoticeSource({ storage, userId: () => 'alice' }), OBSERVING)
    await until(() => slot(first) !== null)
    slot(first)!.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click()
    await until(() => slot(first) === null)

    document.body.innerHTML = ''
    const again = await openChat(createCreditsNoticeSource({ storage, userId: () => 'alice' }), OBSERVING)
    await again.updateComplete
    expect(slot(again)).toBeNull()
  })

  it('is still told to the next person who signs in on the same browser', async () => {
    const storage = new MemoryStorage()
    const alice = await openChat(createCreditsNoticeSource({ storage, userId: () => 'alice' }), OBSERVING)
    await until(() => slot(alice) !== null)
    slot(alice)!.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click()
    await until(() => slot(alice) === null)

    document.body.innerHTML = ''
    const bob = await openChat(createCreditsNoticeSource({ storage, userId: () => 'bob' }), OBSERVING)
    await until(() => slot(bob) !== null)
    expect(squash(slot(bob)!.textContent)).toContain('Credits start on October 12, 2026.')
  })

  it('tells a person again when the backend moves the date: a new date is a new notice', async () => {
    const storage = new MemoryStorage()
    const first = await openChat(createCreditsNoticeSource({ storage, userId: () => 'alice' }), OBSERVING)
    await until(() => slot(first) !== null)
    slot(first)!.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click()
    await until(() => slot(first) === null)

    document.body.innerHTML = ''
    const later = await openChat(createCreditsNoticeSource({ storage, userId: () => 'alice' }), { ...OBSERVING, startDate: 'October 19, 2026' })
    await until(() => slot(later) !== null)
    expect(squash(slot(later)!.textContent)).toContain('Credits start on October 19, 2026.')
  })

  it('sends "Details" to the shell as a request to open Billing, naming no shortfall', async () => {
    const heard: ChatAddCreditsDetail[] = []
    const listener = (event: Event): void => { heard.push((event as CustomEvent<ChatAddCreditsDetail>).detail) }
    document.addEventListener(CHAT_ADD_CREDITS_EVENT, listener)
    try {
      const host = await openChat(createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' }), OBSERVING)
      await until(() => slot(host) !== null)
      slot(host)!.querySelector<HTMLButtonElement>('.banner-action:not([data-notice-dismiss])')!.click()
      expect(heard.map(detail => detail.source)).toEqual(['notice'])
    } finally {
      document.removeEventListener(CHAT_ADD_CREDITS_EVENT, listener)
    }
  })
})
