/**
 * "Continue with…" through the real <sh-chat-host>, the real chooser it raises, the real
 * <sh-chat-panel> under it, the real hosted service, a real in-memory archive and a
 * scripted Choreograph and gateway over a real socket (NO MOCKS).
 *
 * The voice is chosen at the seam. "Same voice as before" is offered only where the
 * catalogue really carries that model (or, failing that, its nearest neighbour, said
 * so) and is never chosen for the person; the House default is. Where the host cannot
 * carry a seed the person is told, in words, before anything happens.
 */

import { html, render, type nothing } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHAT_CONTINUE_WITH_EVENT,
  CHAT_OPEN_ORIGINAL_EVENT,
  makeLocalChatService,
  mountChatHost,
  type ChatService,
  type ContinueIntent,
} from '../index.js'
import type { ShChatHost } from '../index.js'
import { makeHostedChatService } from '../chat-services/hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  workspaceWorkflow,
} from '../chat-services/__tests__/fixtures/choreograph-sim.js'
import {
  CONVERSATION_ID,
  MemoryArchive,
  REVISION_ID,
  turn,
  type FixtureMessage,
} from '../chat-services/__tests__/fixtures/memory-archive.js'
import { SobremesaRoutes } from '../chat-services/__tests__/fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const T0 = Date.UTC(2026, 0, 5, 12, 0)

function conversationOn(model: string | null): FixtureMessage[] {
  const voice = model ? { id: model, provider: 'opencode' } : undefined
  return [
    turn(0, 'user', 'What is a monad?', { at: T0 }),
    turn(1, 'assistant', 'A monad is a design pattern.', { at: T0 + 30_000, ...(voice ? { voice } : {}) }),
    turn(2, 'user', 'And a functor?', { at: T0 + 60_000 }),
    turn(3, 'assistant', 'Something that maps.', { at: T0 + 90_000, ...(voice ? { voice } : {}) }),
  ]
}

afterEach(() => {
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const chatHost = (container: HTMLElement) => container.querySelector('#sh-chat-host') as ShChatHost | null

function mountHost(container: HTMLElement, service: ChatService, sessionId: string): void {
  render(html`<div class="main">${mountChatHost(service, sessionId) as unknown as typeof nothing}</div>`, container)
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const chooser = (host: ShChatHost): HTMLElement | null =>
  host.shadowRoot?.querySelector<HTMLElement>('sh-continue-chooser') ?? null
const sheet = (host: ShChatHost): HTMLElement | null =>
  chooser(host)?.shadowRoot?.querySelector<HTMLElement>('[data-continue-chooser]') ?? null
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
const optionKeys = (host: ShChatHost): string[] =>
  Array.from(sheet(host)?.querySelectorAll<HTMLElement>('[data-voice-option]') ?? []).map(node => node.dataset.voiceOption ?? '')
const optionInput = (host: ShChatHost, key: string): HTMLInputElement =>
  sheet(host)!.querySelector<HTMLInputElement>(`[data-voice-option="${key}"] input[type="radio"]`)!
const notice = (host: ShChatHost): string => squash(sheet(host)?.querySelector('[data-continue-notice]')?.textContent)

interface Rig {
  readonly sim: ChoreographSim
  readonly routes: SobremesaRoutes
  readonly service: ChatService
  readonly host: ShChatHost
  readonly intent: ContinueIntent
  readonly bootId: string
}

const rigs: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of rigs.splice(0)) await stop()
})

async function rig(options: {
  registry?: { inference?: boolean; seed?: boolean }
  messages?: FixtureMessage[]
  archive?: MemoryArchive
  windowLimits?: { maxBytes: number; maxMessageChars: number }
} = {}): Promise<Rig> {
  const sim = new ChoreographSim()
  const routes = new SobremesaRoutes(sim)
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow(options.registry ?? { inference: true, seed: true })]
  await sim.start()
  rigs.push(() => sim.stop())
  const archive = options.archive ?? new MemoryArchive(options.messages ?? conversationOn('moonshotai/kimi-k2.5'))
  const service = makeHostedChatService({
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => 'atelier-20260929',
    userId: () => 'probe',
    token: () => 'jwt',
    storage: new MemoryStorage(),
    archive,
    ...(options.windowLimits ? { windowLimits: options.windowLimits } : {}),
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
  await service.probeCapabilities!()
  const boot = await service.createSession()
  service.bindSlotSession(0, boot.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountHost(container, service, boot.id)
  const host = chatHost(container)!
  await host.updateComplete
  await until(() => host.store?.getState().conversationState === 'ready')
  return {
    sim,
    routes,
    service,
    host,
    bootId: boot.id,
    intent: { conversationId: CONVERSATION_ID, revisionId: REVISION_ID, title: archive.title, messagesLoaded: 4 },
  }
}

describe('the chooser at the seam', () => {
  it('offers the same voice as before, names it as recorded, and never chooses it for the person', async () => {
    const { host, intent } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)

    const dialog = sheet(host)!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(squash(dialog.textContent)).toContain('Monads, again')
    expect(optionKeys(host)).toEqual(['same', 'house', 'other'])
    expect(squash(dialog.querySelector('[data-voice-option="same"]')!.textContent))
      .toContain('Same voice as before (source-recorded)')
    expect(squash(dialog.querySelector('[data-voice-option="same"]')!.textContent)).toContain('Kimi K2.5')
    // The House default is what stands unless the person chooses otherwise.
    expect(optionInput(host, 'house').checked).toBe(true)
    expect(optionInput(host, 'same').checked).toBe(false)
    expect(notice(host)).toBe('Continuing sends this conversation to Google through OpenRouter.')
  })

  it('says how much of the conversation is carried over, and how much is not', async () => {
    const long = new MemoryArchive(
      Array.from({ length: 300 }, (_, index) =>
        turn(index, index % 2 === 0 ? 'user' : 'assistant', `${index % 2 === 0 ? 'user' : 'assistant'} ${index}: ${'x'.repeat(190)}`)),
    )
    const { host, intent } = await rig({ archive: long, windowLimits: { maxBytes: 30_000, maxMessageChars: 4_000 } })
    void host.continueWith(intent)
    await until(() => sheet(host)?.querySelector('[data-continue-window]') != null)
    const line = squash(sheet(host)!.querySelector('[data-continue-window]')!.textContent)
    const parsed = /^(\d+) of 300 messages will be carried over: the first, and the most recent\. (\d+) earlier messages are not included\.$/.exec(line)
    expect(parsed).not.toBeNull()
    expect(Number(parsed![1]) + Number(parsed![2])).toBe(300)
    expect(Number(parsed![2])).toBeGreaterThan(100)
  })

  it('names the whole conversation when it all fits', async () => {
    const { host, intent } = await rig()
    void host.continueWith(intent)
    await until(() => sheet(host)?.querySelector('[data-continue-window]') != null)
    expect(squash(sheet(host)!.querySelector('[data-continue-window]')!.textContent)).toBe('All 4 messages will be carried over.')
  })

  it('names where the window goes for the voice that is picked, and changes when the pick does', async () => {
    const { host, intent } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    optionInput(host, 'same').click()
    await (chooser(host) as unknown as { updateComplete: Promise<boolean> }).updateComplete
    expect(notice(host)).toBe('Continuing sends this conversation to Moonshot through OpenRouter.')
    optionInput(host, 'house').click()
    await (chooser(host) as unknown as { updateComplete: Promise<boolean> }).updateComplete
    expect(notice(host)).toBe('Continuing sends this conversation to Google through OpenRouter.')
  })

  it('offers the nearest voice, said as such, when the source’s own model is gone from the catalogue', async () => {
    const { host, intent } = await rig({ messages: conversationOn('kimi-k2') })
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    expect(optionKeys(host)).toEqual(['closest', 'house', 'other'])
    const text = squash(sheet(host)!.querySelector('[data-voice-option="closest"]')!.textContent)
    expect(text).toContain('Closest available')
    expect(text).toContain('Kimi K2.6')
    expect(text).not.toContain('Same voice as before')
    expect(optionInput(host, 'closest').checked).toBe(false)
  })

  it('offers no "same voice" when the source recorded no model, or one with nothing like it', async () => {
    const unrecorded = await rig({ messages: conversationOn(null) })
    void unrecorded.host.continueWith(unrecorded.intent)
    await until(() => optionKeys(unrecorded.host).length > 0)
    expect(optionKeys(unrecorded.host)).toEqual(['house', 'other'])
    const alien = await rig({ messages: conversationOn('llama-3-70b') })
    void alien.host.continueWith(alien.intent)
    await until(() => optionKeys(alien.host).length > 0)
    expect(optionKeys(alien.host)).toEqual(['house', 'other'])
  })

  it('lists every voice on offer under "Another voice…", grouped by maker, and picks one from there', async () => {
    const { host, intent } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    const select = sheet(host)!.querySelector<HTMLSelectElement>('[data-voice-option="other"] select')!
    const values = Array.from(select.querySelectorAll('option')).map(option => option.value)
    expect(values).toContain('moonshotai/kimi-k3')
    expect(values).toContain('anthropic/claude-sonnet-4.5')
    expect(Array.from(select.querySelectorAll('optgroup')).map(group => group.label)).toContain('Moonshot')
    select.value = 'moonshotai/kimi-k3'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await (chooser(host) as unknown as { updateComplete: Promise<boolean> }).updateComplete
    expect(optionInput(host, 'other').checked).toBe(true)
    expect(notice(host)).toBe('Continuing sends this conversation to Moonshot through OpenRouter.')
  })

  it('opens the continued conversation in the chosen voice, bound to the active slot, sending nothing', async () => {
    const { host, intent, service, sim, routes, bootId } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    optionInput(host, 'same').click()
    await (chooser(host) as unknown as { updateComplete: Promise<boolean> }).updateComplete
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-confirm]')!.click()
    await until(() => chooser(host) === null)

    const state = host.store!.getState()
    expect(state.sessionId).not.toBe(bootId)
    expect(service.slotSessions()[0]).toBe(state.sessionId)
    await until(() => host.store!.getState().messages.length === 4)
    expect(host.store!.getState().messages.every(message => message.origin === 'window')).toBe(true)
    expect(host.store!.getState().seam).toMatchObject({ voiceLabel: 'Kimi K2.5', originalTitle: 'Monads, again' })
    expect(host.store!.getState().sessionTitle).toBe('Monads, again · continued')
    // Nothing has left the browser.
    expect(routes.seeds).toEqual([])
    expect(sim.received.filter(item => item.method === 'POST')).toEqual([])
    // The panel shows the count, the window, the dated seam and the notice.
    const panel = host.panel!
    expect(panel.querySelector('.window-note')).not.toBeNull()
    expect(panel.querySelectorAll('.message.window')).toHaveLength(4)
    expect(squash(panel.querySelector('.seam-line')?.textContent)).toMatch(/^— .*picked up with Kimi K2\.5 —$/)
    expect(squash(panel.querySelector('.seam-notice')?.textContent)).toBe(
      'Continuing sends this conversation to Moonshot through OpenRouter.',
    )
  })

  it('stays where it was, and makes nothing, when the person cancels', async () => {
    const { host, intent, service, bootId } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-cancel]')!.click()
    await until(() => chooser(host) === null)
    expect(host.store!.getState().sessionId).toBe(bootId)
    expect((await service.listSessions()).map(session => session.id)).toEqual([bootId])
  })

  it('cancels on Escape', async () => {
    const { host, intent, bootId } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    sheet(host)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    await until(() => chooser(host) === null)
    expect(host.store!.getState().sessionId).toBe(bootId)
  })

  it('answers the "continue" event a reader raises, the same as the method', async () => {
    const { host, intent } = await rig()
    host.dispatchEvent(new CustomEvent(CHAT_CONTINUE_WITH_EVENT, { detail: intent, bubbles: true, composed: true }))
    await until(() => optionKeys(host).length > 0)
    expect(sheet(host)).not.toBeNull()
  })

  it('ignores an event that is not an intent', async () => {
    const { host } = await rig()
    host.dispatchEvent(new CustomEvent(CHAT_CONTINUE_WITH_EVENT, { detail: { hello: 'world' }, bubbles: true, composed: true }))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(chooser(host)).toBeNull()
  })
})

describe('when the conversation cannot be continued', () => {
  it('tells the person in words, with nothing sent and nothing made, when the host cannot carry a seed', async () => {
    const { host, intent, service, routes, sim, bootId } = await rig({ registry: { inference: true } })
    void host.continueWith(intent)
    await until(() => sheet(host)?.querySelector('[data-continue-error]') != null)
    const alert = sheet(host)!.querySelector('[data-continue-error]')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(squash(alert.textContent)).toMatch(/cannot pick up an earlier conversation yet\. Nothing was sent\./)
    expect(sheet(host)!.querySelector('[data-continue-confirm]')).toBeNull()
    expect((await service.listSessions()).map(session => session.id)).toEqual([bootId])
    expect(routes.seeds).toEqual([])
    expect(sim.received.filter(item => item.method === 'POST')).toEqual([])
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-cancel]')!.click()
    await until(() => chooser(host) === null)
  })

  it('tells the person when the service has no way to continue at all (the local service)', async () => {
    const service = makeLocalChatService()
    const boot = await service.createSession({ title: 't' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    mountHost(container, service, boot.id)
    const host = chatHost(container)!
    await host.updateComplete
    void host.continueWith({ conversationId: CONVERSATION_ID, revisionId: REVISION_ID, title: 'Old', messagesLoaded: 1 })
    await until(() => sheet(host)?.querySelector('[data-continue-error]') != null)
    expect(squash(sheet(host)!.querySelector('[data-continue-error]')!.textContent))
      .toMatch(/cannot pick up an earlier conversation/)
  })

  it('tells the person when the old conversation cannot be read, and makes nothing', async () => {
    const broken = new MemoryArchive(conversationOn(null), { failAtCursor: 0 })
    const { host, intent, service, bootId } = await rig({ archive: broken })
    void host.continueWith(intent)
    await until(() => sheet(host)?.querySelector('[data-continue-error]') != null)
    expect(squash(sheet(host)!.querySelector('[data-continue-error]')!.textContent)).toMatch(/could not be loaded/)
    expect((await service.listSessions()).map(session => session.id)).toEqual([bootId])
  })
})

describe('the way back to the original', () => {
  it('tells the shell which conversation "open the original" means, without knowing how the shell opens it', async () => {
    const { host, intent } = await rig()
    void host.continueWith(intent)
    await until(() => optionKeys(host).length > 0)
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-confirm]')!.click()
    await until(() => chooser(host) === null)
    await until(() => host.panel!.querySelector('.window-open-original') != null)

    const heard: unknown[] = []
    host.addEventListener(CHAT_OPEN_ORIGINAL_EVENT, event => heard.push((event as CustomEvent).detail))
    host.panel!.querySelector<HTMLButtonElement>('.window-open-original')!.click()
    expect(heard).toEqual([{
      archiveConversationUrn: CONVERSATION_ID,
      revisionId: REVISION_ID,
      title: 'Monads, again',
    }])
  })
})
