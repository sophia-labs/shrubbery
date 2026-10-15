/**
 * The self-host chat's drawer and panel on the agent core, through the real <sh-chat-host> and the real
 * <sh-chat-panel> under it (NO MOCKS: the ride chat service talks to a gardend-shaped front and the ride v2
 * sim, both real HTTP servers).
 *
 *   - the history drawer's Rename and Delete reach vehicle-host (they used to stay in the browser, or be refused);
 *   - a conversation another browser of the same person drives opens read-only, with "Continue here", and the
 *     button takes it over;
 *   - "Branch from here" under one of the person's messages opens a new conversation holding the history before
 *     it, with that message in the composer; the drawer's Duplicate copies a conversation; the drawer says what
 *     each came from. A chat that cannot branch (the hosted and local ones) draws neither.
 */

import { html, render, type TemplateResult } from 'lit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createChatServiceStore } from '../chat-host/chat-service-store.js'
import type { ShChatHost } from '../chat-host/chat-host.js'
import { mountChatHost } from '../chat-host/mount-chat-host.js'
import { makeLocalChatService } from '../chat-services/local-chat-service.js'
import { makeRideChatService } from '../chat-services/ride-chat-service.js'
import { GardendFront, RideSim } from '../chat-services/__tests__/fixtures/ride-sim.js'

const GRAPH = 'atopile-led-badge'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
const page = (): HappyDomControl => globalThis.window as unknown as HappyDomControl

let sim: RideSim
let front: GardendFront
let originalUrl = ''
const cleanups: Array<() => void> = []

beforeEach(async () => {
  sim = new RideSim()
  await sim.start()
  front = new GardendFront(sim)
  await front.start()
  originalUrl = page().location.href
  page().happyDOM?.setURL(`${front.base}/`)
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ''
  page().happyDOM?.setURL(originalUrl)
  await front.stop()
  await sim.stop()
})

function browser(storage = new MemoryStorage()) {
  return makeRideChatService({
    baseUrl: front.vehicleBase,
    graphId: () => GRAPH,
    token: () => front.key,
    role: () => 'owner',
    storage,
    longPollMs: 500,
  })
}

async function until(predicate: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function conversation(svc: ReturnType<typeof browser>, question: string, answer: string): Promise<string> {
  const store = createChatServiceStore(svc)
  const { id } = await svc.createSession({ title: null })
  store.setSession(id)
  await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
  sim.scripts.push([{ kind: 'say', text: answer }])
  store.send(question)
  await until(() => store.getState().streaming, 'the reply to start')
  await until(() => !store.getState().streaming, 'the reply to end')
  store.dispose()
  return id
}

async function mount(svc: ReturnType<typeof browser>, sessionId: string): Promise<ShChatHost> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(html`<div>${mountChatHost(svc, sessionId) as unknown as TemplateResult}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await host.updateComplete
  await until(() => host.store?.getState().conversationState === 'ready', 'the host to load')
  await host.updateComplete
  cleanups.push(() => host.store?.dispose())
  return host
}

const root = (host: ShChatHost): ShadowRoot => host.shadowRoot!
const byAttr = (scope: ParentNode, name: string, value: string): HTMLElement | null =>
  Array.from(scope.querySelectorAll<HTMLElement>(`[${name}]`)).find(element => element.getAttribute(name) === value) ?? null
const rows = (host: ShChatHost): (string | null)[] =>
  Array.from(root(host).querySelectorAll('[data-chat-history-row]')).map(row => row.getAttribute('data-chat-history-row'))
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

async function settle(host: ShChatHost): Promise<void> {
  await host.updateComplete
  await Promise.resolve()
  await host.updateComplete
}

describe('the history drawer on the agent core', () => {
  it('renames and deletes on vehicle-host, and a deleted active conversation is replaced', async () => {
    const svc = browser()
    const first = await conversation(svc, 'Which part regulates the 3.3 V rail?', 'The TPS63020.')
    const second = await conversation(svc, 'Which part charges the battery?', 'The BQ25185.')
    const host = await mount(svc, first)
    await host.panel!.onSessionAction?.({ type: 'open-history' })
    await until(() => rows(host).length === 2, 'the drawer to list both')

    // Rename the second.
    byAttr(root(host), 'data-chat-history-rename', second)!.click()
    await settle(host)
    const input = root(host).querySelector('[data-chat-history-rename-input]') as HTMLInputElement
    input.value = 'Charging'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle(host)
    ;(root(host).querySelector('[data-chat-history-rename-save]') as HTMLElement).click()
    await until(() => sim.sessions.get(second)?.title === 'Charging', 'the name to reach the host')
    await until(() => squash(byAttr(root(host), 'data-chat-history-row', second)?.textContent).includes('Charging'), 'the row to show the name')
    expect(squash(root(host).querySelector('.history-status.error')?.textContent)).toBe('')

    // Delete it.
    byAttr(root(host), 'data-chat-history-delete', second)!.click()
    await until(() => sim.trash.has(second), 'the conversation to reach the trash')
    await until(() => !rows(host).includes(second), 'the row to go')
    expect(squash(root(host).querySelector('.history-status.error')?.textContent)).not.toContain('cannot be deleted')

    // Delete the one on screen: the host starts a new conversation in its place.
    const created = sim.received.filter(item => item.method === 'POST' && item.path === '/sessions').length
    byAttr(root(host), 'data-chat-history-delete', first)!.click()
    await until(() => sim.trash.has(first), 'the active conversation to reach the trash')
    await until(() => host.store?.getState().sessionId !== first, 'a new conversation in its place')
    expect(sim.received.filter(item => item.method === 'POST' && item.path === '/sessions')).toHaveLength(created + 1)
    expect(host.store?.getState().readOnly).toBe(false)
  })
})

describe('a conversation another browser of the same person drives', () => {
  it('opens read-only with "Continue here", and the button takes it over', async () => {
    const elsewhere = browser()
    const id = await conversation(elsewhere, 'Which part charges the battery?', 'The BQ25185.')
    const here = browser()
    const host = await mount(here, id)
    const notice = () => host.panel?.querySelector<HTMLElement>('.composer-notice') ?? null
    await until(() => notice() !== null, 'the notice')
    expect(notice()!.getAttribute('data-notice-id')).toBe('driver-elsewhere')
    expect(squash(notice()!.textContent)).toContain('This conversation is open in another tab or browser.')
    expect(squash(host.panel?.querySelector('.connection-banner.readonly')?.textContent)).toContain('This conversation is open in another tab or browser.')
    expect(host.panel!.readOnly).toBe(true)
    // The conversation is shown, not a blank new one.
    expect(squash(host.panel?.textContent)).toContain('The BQ25185.')

    const button = Array.from(notice()!.querySelectorAll('button')).find(candidate => squash(candidate.textContent) === 'Continue here')
    expect(button).toBeDefined()
    button!.click()
    await until(() => sim.sessions.get(id)?.lease?.clientId === here.clientId, 'the lease to move here')
    await until(() => notice() === null && host.panel!.readOnly === false, 'the panel to drive')
    expect(sim.sessions.get(id)?.events.some(event => event.type === 'lease.revoked' && event.payload.clientId === elsewhere.clientId)).toBe(true)
  })
})

describe('branches in the panel and the drawer', () => {
  it('"Branch from here": a new conversation with the history before the message, the message in the composer', async () => {
    const svc = browser()
    const store = createChatServiceStore(svc)
    const { id } = await svc.createSession({ title: null })
    svc.bindSlotSession(0, id)
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    for (const [question, answer] of [['Which part regulates the 3.3 V rail?', 'The TPS63020.'], ['And which charges the battery?', 'The BQ25185.']] as const) {
      sim.scripts.push([{ kind: 'say', text: answer }])
      store.send(question)
      await until(() => store.getState().streaming, 'the reply to start')
      await until(() => !store.getState().streaming, 'the reply to end')
    }
    store.dispose()
    const host = await mount(svc, id)
    const branchButtons = () => Array.from(host.panel!.querySelectorAll<HTMLButtonElement>('.message.user [data-message-branch]'))
    await until(() => branchButtons().length === 2, 'a Branch button under each of the person’s messages')
    expect(host.panel!.querySelectorAll('.message.assistant [data-message-branch]')).toHaveLength(0)

    branchButtons()[1]!.click()
    await until(() => host.store?.getState().sessionId !== id, 'the branch to open')
    const branchId = host.store!.getState().sessionId as string
    expect(sim.sessions.get(branchId)?.parent).toMatchObject({ sessionId: id, kind: 'fork' })
    await until(() => host.store?.getState().conversationState === 'ready' && host.store.getState().messages.length === 2, 'the branch to load')
    await settle(host)
    expect(host.store!.getState().messages.map(message => message.content)).toEqual(['Which part regulates the 3.3 V rail?', 'The TPS63020.'])
    expect(host.panel!.draft).toBe('And which charges the battery?')
    expect(host.panel!.readOnly).toBe(false)
    expect(host.store!.service.slotSessions()[host.store!.service.activeSlot]).toBe(branchId)

    // The drawer lists both, the branch saying what it came from.
    await host.panel!.onSessionAction?.({ type: 'open-history' })
    await until(() => rows(host).includes(branchId) && rows(host).includes(id), 'the drawer to list both')
    expect(squash(byAttr(root(host), 'data-chat-history-lineage', id)?.textContent)).toBe('↳ branched from Which part regulates the 3.3 V rail?')
    expect(byAttr(root(host), 'data-chat-history-row', id)?.querySelector('[data-chat-history-lineage]')).toBeNull()

    // Duplicate the original from the drawer: the copy opens here, and says what it copies.
    byAttr(root(host), 'data-chat-history-duplicate', id)!.click()
    await until(() => sim.commandsOf('clone').length === 1, 'the clone to reach the host')
    await until(() => ![id, branchId].includes(host.store?.getState().sessionId as string), 'the copy to open')
    const copyId = host.store!.getState().sessionId as string
    await until(() => rows(host).includes(copyId), 'the drawer to list the copy')
    expect(squash(byAttr(root(host), 'data-chat-history-row', copyId)?.textContent)).toContain('Copy of Which part regulates the 3.3 V rail?')
    expect(squash(byAttr(root(host), 'data-chat-history-lineage', id)?.textContent)).toBeTruthy()
    const lineages = Array.from(root(host).querySelectorAll('[data-chat-history-lineage]')).map(node => squash(node.textContent))
    expect(lineages.sort()).toEqual(['↳ branched from Which part regulates the 3.3 V rail?', '↳ duplicated from Which part regulates the 3.3 V rail?'])
  })

  it('draws neither Branch nor Duplicate for a chat that cannot branch', async () => {
    const local = makeLocalChatService()
    const { id } = await local.createSession({ title: 'local' })
    const host = await mount(local as unknown as ReturnType<typeof browser>, id)
    expect(host.panel!.messageActions).toEqual(['copy'])
    await host.panel!.onSessionAction?.({ type: 'open-history' })
    await settle(host)
    expect(root(host).querySelector('[data-chat-history-duplicate]')).toBeNull()
  })
})
