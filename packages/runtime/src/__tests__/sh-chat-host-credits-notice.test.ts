/**
 * The credits notice through the real <sh-chat-host> and the real <sh-chat-panel> under it
 * (NO MOCKS: a real local chat service and a real notice source, a small object with real state,
 * which is all the contract asks of the shell).
 *
 * The host does not own the notice's words, its date or the memory of who dismissed it: the shell
 * does, and hands the host a source it can read, dismiss and listen to. What the host owns is
 * where it appears (the one slot above the composer), that it appears only when asked for, that
 * "Dismiss" reaches the source and the notice goes, that "Details" is the same seam as "Add
 * credits" (it raises `sh-chat-add-credits`, the shell opens Billing), and that it lets go of a
 * source it no longer has.
 */

import { html, render, type nothing } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHAT_ADD_CREDITS_EVENT,
  mountChatHost,
  type ChatAddCreditsDetail,
  type ChatHostCredits,
} from '../index.js'
import type { ShChatHost } from '../index.js'
import type { ChatCreditsNoticeSource, ChatCreditsNoticeView } from '../chat-services/chat-billing.js'
import type { CreditsFacts } from '../chat-services/credits-facts.js'
import { makeHostedChatService } from '../chat-services/hosted-chat-service.js'
import { ChoreographSim, DOMAIN_WORKFLOW, workspaceWorkflow } from '../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes } from '../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { makeLocalChatService } from '../chat-services/local-chat-service.js'

const VIEW: ChatCreditsNoticeView = {
  id: 'credits-start:October 12, 2026',
  title: 'Credits start on October 12, 2026.',
  paragraphs: [
    "Sophia's chat and agents run on AI models that cost real money, so from October 12, 2026 each message uses credits from your balance.",
    'Most messages cost a fraction of a cent to a few cents.',
    'Credits are prepaid and non-refundable.',
  ],
}

/**
 * What a shell's source does, with real state: the words now, a dismissal, and who is listening. It is
 * handed the facts the chat last read off the balance (null before the first read), as every source is, and
 * remembers the last it was handed so a test can say what the chat told it.
 */
class NoticeSource implements ChatCreditsNoticeSource {
  private view: ChatCreditsNoticeView | null
  private readonly listeners = new Set<() => void>()
  dismissals = 0
  readonly factsSeen: Array<CreditsFacts | null> = []
  readonly dismissedWith: Array<CreditsFacts | null> = []
  constructor(view: ChatCreditsNoticeView | null) { this.view = view }
  current(facts: CreditsFacts | null): ChatCreditsNoticeView | null { this.factsSeen.push(facts); return this.view }
  dismiss(facts: CreditsFacts | null): void { this.dismissals += 1; this.dismissedWith.push(facts); this.view = null; this.emit() }
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }
  say(view: ChatCreditsNoticeView | null): void { this.view = view; this.emit() }
  get listening(): number { return this.listeners.size }
  private emit(): void { for (const listener of [...this.listeners]) listener() }
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

interface Rig {
  readonly container: HTMLElement
  readonly host: ShChatHost
  readonly heard: ChatAddCreditsDetail[]
  mountWith(credits: ChatHostCredits | undefined): Promise<void>
}

async function rig(credits: ChatHostCredits | undefined): Promise<Rig> {
  const service = makeLocalChatService()
  const session = await service.createSession({ title: 'credits-notice-host' })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const mountWith = async (next: ChatHostCredits | undefined): Promise<void> => {
    render(html`<div class="main">${mountChatHost(service, session.id, { credits: next }) as unknown as typeof nothing}</div>`, container)
    const host = container.querySelector('#sh-chat-host') as ShChatHost
    await host.updateComplete
    await until(() => host.store?.getState().conversationState === 'ready')
    await host.updateComplete
  }
  await mountWith(credits)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  const heard: ChatAddCreditsDetail[] = []
  const listener = (event: Event): void => { heard.push((event as CustomEvent<ChatAddCreditsDetail>).detail) }
  document.addEventListener(CHAT_ADD_CREDITS_EVENT, listener)
  cleanups.push(() => document.removeEventListener(CHAT_ADD_CREDITS_EVENT, listener))
  return { container, host, heard, mountWith }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const slot = (host: ShChatHost): HTMLElement | null => host.panel?.querySelector<HTMLElement>('.composer-notice') ?? null
const buttons = (host: ShChatHost): string[] => Array.from(slot(host)?.querySelectorAll('button') ?? []).map(button => squash(button.textContent))

describe('the credits notice in the host', () => {
  it('shows nothing when the shell grants no notice (the voices release as it was)', async () => {
    const { host } = await rig({ canAddCredits: true })
    await host.updateComplete
    expect(slot(host)).toBeNull()
  })

  it('shows the heads-up in the one slot: the title, the first paragraph, Details and Dismiss', async () => {
    const source = new NoticeSource(VIEW)
    const { host } = await rig({ canAddCredits: true, notice: source })
    await until(() => slot(host) !== null)

    expect(slot(host)!.getAttribute('data-notice-id')).toBe('credits-notice')
    const said = squash(slot(host)!.textContent)
    expect(said).toContain('Credits start on October 12, 2026.')
    expect(said).toContain('each message uses credits from your balance')
    // The rest of the words are Billing's: the chat's slot is a pointer, not the whole notice.
    expect(said).not.toContain('non-refundable')
    expect(buttons(host)).toEqual(['Details', 'Dismiss'])
  })

  it('puts the notice away when the person dismisses it: the source is told, once, and the slot empties', async () => {
    const source = new NoticeSource(VIEW)
    const { host } = await rig({ canAddCredits: true, notice: source })
    await until(() => slot(host) !== null)

    slot(host)!.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click()
    await until(() => slot(host) === null)
    expect(source.dismissals).toBe(1)
  })

  it('sends "Details" the way "Add credits" goes: the shell is asked to open Billing, with nothing to arm', async () => {
    const source = new NoticeSource(VIEW)
    const { host, heard } = await rig({ canAddCredits: true, notice: source })
    await until(() => slot(host) !== null)

    slot(host)!.querySelector<HTMLButtonElement>('.banner-action:not([data-notice-dismiss])')!.click()
    expect(heard).toHaveLength(1)
    expect(heard[0].source).toBe('notice')
    // Looking is not buying: the notice is not a refusal, so it names no shortfall.
    expect(source.dismissals).toBe(0)
    expect(slot(host)).not.toBeNull()
  })

  it('offers no Details where the shell cannot take the person to Billing, but can still be put away', async () => {
    const source = new NoticeSource(VIEW)
    const { host } = await rig({ notice: source })
    await until(() => slot(host) !== null)
    expect(buttons(host)).toEqual(['Dismiss'])
  })

  it('is read live: new words replace the old ones, and the source saying nothing empties the slot', async () => {
    const source = new NoticeSource(VIEW)
    const { host } = await rig({ canAddCredits: true, notice: source })
    await until(() => slot(host) !== null)

    source.say({ ...VIEW, id: 'credits-start:October 19, 2026', title: 'Credits start on October 19, 2026.' })
    await until(() => squash(slot(host)?.textContent).includes('October 19, 2026'))

    source.say(null)
    await until(() => slot(host) === null)
  })

  it('listens to the source it has, only that one, and lets go of it when it goes', async () => {
    const first = new NoticeSource(VIEW)
    const second = new NoticeSource({ ...VIEW, id: 'other', title: 'Another notice.' })
    const { host, mountWith, container } = await rig({ canAddCredits: true, notice: first })
    await until(() => slot(host) !== null)
    expect(first.listening).toBe(1)

    await mountWith({ canAddCredits: true, notice: second })
    await until(() => squash(slot(host)?.textContent).includes('Another notice.'))
    expect(first.listening).toBe(0)
    expect(second.listening).toBe(1)

    await mountWith(undefined)
    await until(() => slot(host) === null)
    expect(second.listening).toBe(0)

    await mountWith({ notice: second })
    await until(() => slot(host) !== null)
    container.remove()
    host.remove()
    expect(second.listening).toBe(0)
  })
})

describe('the facts the chat read off the balance reach the shell’s source', () => {
  const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'
  const sims: ChoreographSim[] = []
  afterEach(async () => { for (const sim of sims.splice(0)) await sim.stop() })

  class MemoryStorage {
    readonly values = new Map<string, string>()
    getItem(key: string): string | null { return this.values.get(key) ?? null }
    setItem(key: string, value: string): void { this.values.set(key, value) }
    removeItem(key: string): void { this.values.delete(key) }
  }

  async function hosted(body: unknown, source: NoticeSource): Promise<ShChatHost> {
    const sim = new ChoreographSim()
    sims.push(sim)
    const routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    routes.balance = { status: 200, body }
    await sim.start()
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20261003',
      userId: () => USER,
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    await service.probeCapabilities!()
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(html`<div class="main">${mountChatHost(service, created.id, { credits: { showBalance: true, canAddCredits: true, notice: source } }) as unknown as typeof nothing}</div>`, container)
    const host = container.querySelector('#sh-chat-host') as ShChatHost
    await host.updateComplete
    await until(() => host.store?.getState().conversationState === 'ready')
    return host
  }

  it('is handed null until the balance has been read, and the facts of that read after it', async () => {
    const source = new NoticeSource(VIEW)
    await hosted(SobremesaRoutes.balanceBody(USER, 970_000, { gateMode: 'observe', feeBps: 1500, creditsStartDate: '2026-10-12' }), source)
    await until(() => source.factsSeen.some(facts => facts !== null))
    expect(source.factsSeen[0]).toBeNull()
    expect(source.factsSeen.at(-1)).toEqual({ feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' })
  })

  it('is handed null for good by a backend that says nothing of the regime: there is nothing to know', async () => {
    const source = new NoticeSource(VIEW)
    const host = await hosted(SobremesaRoutes.balanceBody(USER, 970_000), source)
    await until(() => host.store?.getState().accountNote != null)
    expect(source.factsSeen.length).toBeGreaterThan(0)
    expect(source.factsSeen.every(facts => facts === null)).toBe(true)
  })

  it('tells the source which facts the notice was shown under when it is dismissed', async () => {
    const source = new NoticeSource(VIEW)
    const host = await hosted(SobremesaRoutes.balanceBody(USER, 970_000, { gateMode: 'observe', feeBps: 1500, creditsStartDate: '2026-10-12' }), source)
    await until(() => source.factsSeen.some(facts => facts !== null))
    await until(() => host.panel?.querySelector('.composer-notice[data-notice-id="credits-notice"]') != null)
    host.panel!.querySelector<HTMLButtonElement>('[data-notice-dismiss]')!.click()
    expect(source.dismissedWith).toEqual([{ feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' }])
  })
})
