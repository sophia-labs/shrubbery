/**
 * Credits through the real <sh-chat-host>, the real <sh-chat-panel> under it, the real
 * hosted service and a scripted Choreograph and gateway over a real socket (NO MOCKS).
 *
 * The host does not know how credits are bought. "Add credits" is a seam: the host raises
 * `sh-chat-add-credits` (bubbling, composed), says what the person needs to know (their
 * balance, what one message needs), and the shell that owns Settings, Billing takes it
 * from there. Each test names the defect it guards: a button that goes nowhere, a
 * refusal that loses the person's words, a chip that says nothing.
 */

import { html, render, type nothing } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHAT_ADD_CREDITS_EVENT,
  mountChatHost,
  type ChatService,
} from '../index.js'
import type { ShChatHost } from '../index.js'
import { makeHostedChatService } from '../chat-services/hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  costedTurn,
  delta,
  started,
  turnDone,
  workspaceWorkflow,
} from '../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes } from '../chat-services/__tests__/fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'

afterEach(() => {
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const chatHost = (container: HTMLElement) => container.querySelector('#sh-chat-host') as ShChatHost | null

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

interface AddCreditsDetail {
  readonly source: string
  readonly balanceMicroUsd: number | null
  readonly requiredMicroUsd: number | null
}

interface Rig {
  readonly sim: ChoreographSim
  readonly routes: SobremesaRoutes
  readonly service: ChatService
  readonly host: ShChatHost
  readonly heard: AddCreditsDetail[]
}

const rigs: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of rigs.splice(0)) await stop()
})

/** `gateMode`: the regime the backend names (default `enforce`: these tests are about it); `null` names none (an older backend). */
async function rig(
  balanceMicroUsd: number,
  options: { canAddCredits?: boolean; showBalance?: boolean; gateMode?: 'observe' | 'enforce' | null } = {},
): Promise<Rig> {
  const sim = new ChoreographSim()
  const routes = new SobremesaRoutes(sim)
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
  const gateMode = options.gateMode === undefined ? 'enforce' : options.gateMode
  routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, balanceMicroUsd, gateMode === null ? {} : { gateMode }) }
  await sim.start()
  rigs.push(() => sim.stop())
  const service = makeHostedChatService({
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => 'atelier-20260929',
    userId: () => USER,
    token: () => 'jwt',
    storage: new MemoryStorage(),
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
  await service.probeCapabilities!()
  const boot = await service.createSession()
  service.bindSlotSession(0, boot.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  render(html`<div class="main">${mountChatHost(service, boot.id) as unknown as typeof nothing}</div>`, container)
  const host = chatHost(container)!
  // The shell that can take the person to Billing says so; most of these tests are about that shell.
  if (options.canAddCredits !== undefined) host.canAddCredits = options.canAddCredits
  else host.canAddCredits = true
  // Most of these tests are about the shell that shows the balance (the credits release); the voices
  // release keeps the host default, which shows each reply's cost but no balance line.
  host.showBalance = options.showBalance ?? true
  await host.updateComplete
  await until(() => host.store?.getState().conversationState === 'ready')
  // Heard where the shell hears it: on the document, past the host's own shadow root.
  const heard: AddCreditsDetail[] = []
  const listener = (event: Event): void => { heard.push((event as CustomEvent<AddCreditsDetail>).detail) }
  document.addEventListener(CHAT_ADD_CREDITS_EVENT, listener)
  rigs.push(async () => document.removeEventListener(CHAT_ADD_CREDITS_EVENT, listener))
  return { sim, routes, service, host, heard }
}

const notice = (host: ShChatHost): HTMLElement | null => host.panel?.querySelector<HTMLElement>('.composer-notice') ?? null

describe('the event that goes to whoever sells credits', () => {
  it('is named as the seam the billing shell listens for', () => {
    expect(CHAT_ADD_CREDITS_EVENT).toBe('sh-chat-add-credits')
  })

  it('is raised by the refusal banner with the balance and what one message needs, and reaches the document', async () => {
    const { sim, host, heard } = await rig(3_800)
    sim.invocation = () => ({
      status: 402,
      body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
    })
    host.store!.send('Hello there')
    await until(() => notice(host) !== null)

    expect(squash(notice(host)!.textContent)).toContain("You're out of credits. Your message is saved. Add credits to continue.")
    notice(host)!.querySelector<HTMLButtonElement>('.banner-action')!.click()
    expect(heard).toEqual([{ source: 'refusal', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 }])
  })

  it('is raised by the balance line’s own button, with the same facts', async () => {
    const { host, heard } = await rig(3_800)
    await until(() => host.panel?.querySelector('[data-account-action="add-credits"]') != null)
    host.panel!.querySelector<HTMLButtonElement>('[data-account-action="add-credits"]')!.click()
    // 15,000 tokens in and 256 out on House, plus the 20% fee: what one message needs.
    expect(heard).toEqual([{ source: 'balance-line', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 }])
  })

  it('is offered in observe mode too, where the balance cannot pay for one message: as a balance, not as a refusal', async () => {
    const { host, heard } = await rig(3_800, { gateMode: 'observe' })
    await until(() => host.panel?.querySelector('[data-account-action="add-credits"]') != null)
    const note = squash(host.panel!.querySelector('[data-account-note]')!.textContent)
    expect(note).toContain('Running low')
    expect(note).toContain('$0.0038')
    expect(note).not.toMatch(/out of credits/i)
    host.panel!.querySelector<HTMLButtonElement>('[data-account-action="add-credits"]')!.click()
    expect(heard).toEqual([{ source: 'balance-line', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 }])
  })

  it('offers the button only where the person can act on it: not on "Running low"', async () => {
    const { host } = await rig(210_000)
    await until(() => host.panel?.querySelector('[data-account-note]') != null)
    expect(squash(host.panel!.querySelector('[data-account-note]')!.textContent)).toContain('Running low')
    expect(host.panel!.querySelector('[data-account-action]')).toBeNull()
  })
})

describe('the words the person typed', () => {
  it('come back into the composer when the message is refused for credit', async () => {
    const { sim, host } = await rig(3_800)
    sim.invocation = () => ({
      status: 402,
      body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
    })
    host.store!.send('Hello there')
    await until(() => notice(host) !== null)
    expect(host.panel!.draft).toBe('Hello there')
    // No error line beside the banner: it is one refusal, said once.
    expect(host.panel!.querySelector('.send-continuity')).toBeNull()
  })
})

describe('the chip beside a reply', () => {
  it('says what the reply settled at, quietly, and only beside replies', async () => {
    const { sim, host } = await rig(970_000)
    sim.queueTurn(costedTurn('Hello there.', 848))
    host.store!.send('Hi')
    await until(() => !host.store!.getState().streaming && host.store!.getState().messages.length >= 2)
    // The chip is drawn once the reply is finished: wait for it, not for the bubble.
    await until(() => host.panel!.querySelectorAll('.message-annotation').length >= 1)
    const chips = Array.from(host.panel!.querySelectorAll<HTMLElement>('.message-annotation'))
    expect(chips.map(chip => squash(chip.textContent))).toEqual(['$0.0008'])
    expect(chips[0].closest('.message')!.classList.contains('assistant')).toBe(true)
  })

  it('does not print a chip for a reply that cost nothing to say', async () => {
    const { sim, host } = await rig(970_000)
    sim.queueTurn({ answer: 'Hi.', stages: [[started(), delta('Hi.'), turnDone(), completed('Hi.')]] })
    host.store!.send('Hi')
    await until(() => !host.store!.getState().streaming && host.store!.getState().messages.length >= 2)
    // Look only once the finished reply is on the screen, so an absent chip means something.
    await until(() => host.panel!.querySelector('.message.assistant') != null && !host.panel!.querySelector('.message.assistant .message-bubble.streaming'))
    await until(() => squash(host.panel!.textContent).includes('Hi.'))
    expect(host.panel!.querySelectorAll('.message-annotation')).toHaveLength(0)
  })
})

describe('a chat that reached its size limit', () => {
  it('starts a new chat from the notice’s own button', async () => {
    const { sim, host } = await rig(970_000)
    sim.queueTurn({
      answer: 'Cut off',
      stages: [[
        started(),
        delta('Cut off'),
        { type: 'budget.exhausted', value: { output: 'Cut off', turns: 24 } },
        turnDone(),
        completed('Cut off'),
      ]],
    })
    host.store!.send('Tell me everything')
    await until(() => notice(host) !== null)
    const before = host.store!.getState().sessionId
    notice(host)!.querySelector<HTMLButtonElement>('.banner-action')!.click()
    await until(() => host.store!.getState().sessionId !== before)
    await until(() => host.store!.getState().conversationState === 'ready')
    expect(host.store!.getState().messages).toEqual([])
    expect(host.store!.getState().composerNotice).toBeNull()
  })
})

describe('a shell that cannot take the person to add credits (the default)', () => {
  // The release that ships the picker ships no purchase and enforces nothing: a button that goes
  // nowhere is dead UI, and nothing in this panel may be.
  const addCreditsControls = (host: ShChatHost): Element[] => [
    ...host.panel!.querySelectorAll('[data-account-action], .banner-action, .account-note-action'),
  ].filter(element => /add credits/i.test(element.textContent ?? '') || element.getAttribute('data-account-action') === 'add-credits')

  it('is the default of the host itself', () => {
    const fresh = document.createElement('sh-chat-host') as ShChatHost
    expect(fresh.canAddCredits).toBe(false)
  })

  it('shows the balance as a plain figure with no button, even at or below the smallest call', async () => {
    const { host } = await rig(3_800, { canAddCredits: false })
    await until(() => host.panel?.querySelector('[data-account-note]') != null)
    expect(squash(host.panel!.querySelector('[data-account-note]')!.textContent)).toBe('Running low $0.0038')
    expect(addCreditsControls(host)).toEqual([])
  })

  it('says a refusal for credit in its own words, with no button to go nowhere', async () => {
    const { sim, host, heard } = await rig(3_800, { canAddCredits: false })
    sim.invocation = () => ({
      status: 402,
      body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
    })
    host.store!.send('Hello there')
    await until(() => notice(host) !== null)
    expect(squash(notice(host)!.textContent)).toContain("You're out of credits. Your message is saved. Add credits to continue.")
    expect(addCreditsControls(host)).toEqual([])
    expect(heard).toEqual([])
  })

  it('gives the button back the moment the shell says it can take the person there', async () => {
    const { host, heard } = await rig(3_800, { canAddCredits: false })
    await until(() => host.panel?.querySelector('[data-account-note]') != null)
    expect(addCreditsControls(host)).toEqual([])
    host.canAddCredits = true
    await until(() => host.panel?.querySelector('[data-account-action="add-credits"]') != null)
    host.panel!.querySelector<HTMLButtonElement>('[data-account-action="add-credits"]')!.click()
    expect(heard).toHaveLength(1)
    expect(squash(host.panel!.querySelector('[data-account-note]')!.textContent)).toContain('Out of credits')
  })
})

describe('the voices release, which shows each cost but no balance (the host default)', () => {
  it('is the default of the host itself', () => {
    const fresh = document.createElement('sh-chat-host') as ShChatHost
    expect(fresh.showBalance).toBe(false)
  })

  it('keeps the cost chip beside the reply and draws no balance line', async () => {
    const { sim, host } = await rig(970_000, { showBalance: false, canAddCredits: false })
    sim.queueTurn(costedTurn('Hello there.', 848))
    host.store!.send('Hi')
    await until(() => host.panel!.querySelectorAll('.message-annotation').length >= 1)
    expect(squash(host.panel!.querySelector('.message-annotation')!.textContent)).toBe('$0.0008')
    expect(host.panel!.querySelector('[data-account-note]')).toBeNull()
  })

  it('shows the balance the moment a shell turns it on', async () => {
    const { sim, host } = await rig(970_000, { showBalance: false, canAddCredits: false })
    // A settled turn means the balance has been read, so an absent line means hidden, not unloaded.
    sim.queueTurn(costedTurn('Hello there.', 848))
    host.store!.send('Hi')
    await until(() => host.panel!.querySelectorAll('.message-annotation').length >= 1)
    expect(host.panel!.querySelector('[data-account-note]')).toBeNull()
    host.showBalance = true
    await until(() => host.panel?.querySelector('[data-account-note]') != null)
    expect(squash(host.panel!.querySelector('[data-account-note]')!.textContent)).toBe('Credit $0.97')
  })
})
