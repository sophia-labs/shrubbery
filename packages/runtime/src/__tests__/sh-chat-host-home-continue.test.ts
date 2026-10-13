/**
 * Old chats become resumable chats: an imported conversation, opened in the history drawer, continued in a
 * new chat, through the real <sh-chat-host> (NO MOCKS).
 *
 * EVERYTHING BUT THE PEOPLE IS REAL. The host, the drawer and its reader, the chooser it raises, the
 * <sh-chat-panel> under them, the hosted service and the archive client it reads with are the shipped ones; the
 * archive is answered on a real socket in the gateway's own wire shapes (`fixtures/archive-routes.ts`: the sidecar
 * fields on the list, the revision list's audience, a message page with its page-level voice map), beside the scripted
 * Choreograph whose seed store and launch admission are the live host's (`fixtures/sobremesa-routes.ts`). So what is
 * held here is the whole path a person walks: a row in the one home, the reader, "Continue with…", the voice, the
 * window and the seam, the first message, the seed, the launch, the reply.
 *
 * Doctrine (`plans/2026-09-28-sobremesa-release.md` section 4) is tested, not recited: no copy brings anyone back,
 * the old turns keep their own voice and the new voice is named, an account's own conversations are the only ones
 * ever offered, and nothing of an old conversation is written to a graph.
 */

import { html, render, type nothing } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../chat-services/hosted-chat-service.js'
import type { ChatService } from '../chat-services/chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  costedTurn,
  workspaceWorkflow,
} from '../chat-services/__tests__/fixtures/choreograph-sim.js'
import {
  ArchiveRoutes,
  conversationUrn,
  revisionIdOf,
  type ImportedConversation,
} from '../chat-services/__tests__/fixtures/archive-routes.js'
import { holdingResponse } from '../chat-services/__tests__/fixtures/slow-network.js'
import { SobremesaRoutes } from '../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { mountChatHost, type ShChatHost } from '../index.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = 'probe'
const GRAPH = 'atelier-20261001'
const T0 = Date.UTC(2026, 0, 5, 12, 0)
const KIMI_K25 = 'moonshotai/kimi-k2.5'

/** A short conversation that ended on an old Kimi, as the sidecar gateway lists and serves it. */
const KIMI_CHAT: ImportedConversation = {
  number: 7,
  title: 'Monads, again',
  attributionBasis: 'direct-identity',
  turns: [
    { role: 'user', text: 'What is a monad?', at: T0 },
    { role: 'assistant', text: 'A monad is a design pattern.', at: T0 + 30_000, model: { id: KIMI_K25, provider: 'openrouter' } },
    { role: 'user', text: 'And a functor?', at: T0 + 60_000 },
    { role: 'assistant', text: 'Something that maps.', at: T0 + 90_000, model: { id: KIMI_K25, provider: 'openrouter' } },
  ],
}

afterEach(() => {
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

const rigs: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of rigs.splice(0)) await stop()
})

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
const shadow = (host: ShChatHost): ShadowRoot => host.shadowRoot!
const byAttr = (scope: ParentNode, name: string, value: string): HTMLElement | null =>
  Array.from(scope.querySelectorAll<HTMLElement>(`[${name}]`)).find(element => element.getAttribute(name) === value) ?? null
const drawer = (host: ShChatHost): HTMLElement | null => shadow(host).querySelector('[data-chat-history-drawer]')
const reader = (host: ShChatHost): HTMLElement | null => shadow(host).querySelector('[data-chat-reader]')
const continueButton = (host: ShChatHost): HTMLButtonElement | null =>
  shadow(host).querySelector<HTMLButtonElement>('[data-chat-reader-continue]')
const chooser = (host: ShChatHost): HTMLElement | null => shadow(host).querySelector('sh-continue-chooser')
const sheet = (host: ShChatHost): HTMLElement | null =>
  chooser(host)?.shadowRoot?.querySelector<HTMLElement>('[data-continue-chooser]') ?? null
const optionKeys = (host: ShChatHost): string[] =>
  Array.from(sheet(host)?.querySelectorAll<HTMLElement>('[data-voice-option]') ?? []).map(node => node.dataset.voiceOption ?? '')
const optionInput = (host: ShChatHost, key: string): HTMLInputElement =>
  sheet(host)!.querySelector<HTMLInputElement>(`[data-voice-option="${key}"] input[type="radio"]`)!
const chooserDone = (host: ShChatHost): Promise<boolean> =>
  (chooser(host) as unknown as { updateComplete: Promise<boolean> }).updateComplete

/** Everything a person can read right now: the drawer, the reader, the chooser and the chat. */
function everythingSaid(host: ShChatHost): string {
  return squash([
    drawer(host)?.textContent,
    chooser(host)?.shadowRoot?.textContent,
    host.panel?.textContent,
  ].join(' '))
}

interface Rig {
  readonly sim: ChoreographSim
  readonly routes: SobremesaRoutes
  readonly archive: ArchiveRoutes
  readonly service: ChatService
  readonly host: ShChatHost
  readonly bootId: string
}

async function rig(options: {
  registry?: { inference?: boolean; seed?: boolean; host?: { limits?: Record<string, number> } }
  conversations?: ImportedConversation[]
  /** Where a downloaded file is handed (the shell's way to give the person a file). */
  download?: (file: { filename: string; text: string }) => void
  /** The `fetch` the service is given (a real one, made slow or lossy by a fixture). */
  fetchImpl?: typeof fetch
  /** How the catalogue of voices answers (a stale one is offered as none). */
  catalogue?: { stale?: boolean }
  /** The sidecar gateway before its backfill has run: no summary for any conversation (hash order, no dates, no voices). */
  rowless?: boolean
} = {}): Promise<Rig> {
  const sim = new ChoreographSim()
  const routes = new SobremesaRoutes(sim)
  if (options.catalogue) routes.catalogueOptions = options.catalogue
  const archive = new ArchiveRoutes(sim, { userId: USER })
  archive.conversations = options.conversations ?? [KIMI_CHAT]
  if (options.rowless) archive.summaries = false
  sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow(options.registry ?? { inference: true, seed: true, host: {} })]
  sim.queueTurn(costedTurn('We were on functors.', 640, { model: KIMI_K25 }))
  await sim.start()
  rigs.push(() => sim.stop())
  const service = makeHostedChatService({
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => GRAPH,
    userId: () => USER,
    token: () => 'jwt',
    storage: new MemoryStorage(),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
  await service.probeCapabilities!()
  const boot = await service.createSession()
  service.bindSlotSession(0, boot.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const ports = options.download ? { conversationHome: { download: options.download } } : {}
  render(html`<div class="main">${mountChatHost(service, boot.id, ports) as unknown as typeof nothing}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await host.updateComplete
  await until(() => host.store?.getState().conversationState === 'ready')
  return { sim, routes, archive, service, host, bootId: boot.id }
}

async function openDrawer(host: ShChatHost): Promise<void> {
  await host.panel!.onSessionAction?.({ type: 'open-history' })
  await until(() => drawer(host) !== null)
}

/** Open the first imported conversation in the reader and wait until its messages are drawn. */
async function openReader(host: ShChatHost, number = 7, messages = 4): Promise<void> {
  await openDrawer(host)
  const open = () => byAttr(shadow(host), 'data-chat-history-open', conversationUrn(number))
  await until(() => open() !== null)
  open()!.click()
  await until(() => reader(host) !== null)
  await until(() => (shadow(host).querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === messages)
}

async function startContinuing(host: ShChatHost): Promise<void> {
  continueButton(host)!.click()
  await until(() => optionKeys(host).length > 0)
}

async function confirm(host: ShChatHost, key: 'same' | 'house' | 'closest' = 'same'): Promise<void> {
  optionInput(host, key).click()
  await chooserDone(host)
  sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-confirm]')!.click()
  await until(() => chooser(host) === null)
}

describe('Continue with… in the reader of an imported conversation', () => {
  it('is offered once the host says it can carry a seed, and only then', async () => {
    const { host } = await rig()
    await openReader(host)
    const button = continueButton(host)
    expect(button).not.toBeNull()
    expect(squash(button!.textContent)).toBe('Continue with…')
    // Beside the reader's other actions, which it does not replace.
    expect(shadow(host).querySelector('[data-chat-reader-save]')).not.toBeNull()
    expect(shadow(host).querySelector('[data-chat-reader-download]')).not.toBeNull()
  })

  it('is not offered by a host that does not advertise `seed` (today’s host drops the key and would start a plain chat)', async () => {
    const { host } = await rig({ registry: { inference: true } })
    await openReader(host)
    expect(continueButton(host)).toBeNull()
    expect(shadow(host).querySelector('[data-chat-reader-save]')).not.toBeNull()
  })

  it('is not offered while the conversation is still loading, nor after it could not be read', async () => {
    const { host, archive } = await rig()
    await openDrawer(host)
    await until(() => byAttr(shadow(host), 'data-chat-history-open', conversationUrn(7)) !== null)
    archive.refuse = { status: 403, code: 'conversation_archive_scope_refused' }
    byAttr(shadow(host), 'data-chat-history-open', conversationUrn(7))!.click()
    await until(() => shadow(host).querySelector('[data-chat-reader-error]') !== null)
    expect(continueButton(host)).toBeNull()
  })

  it('is never offered for a conversation that is not the account’s own (another owner, or nobody’s)', async () => {
    // The list only ever carries the account's own; a conversation whose revision list names another owner is refused
    // by the archive client, and with it goes the button.
    const { host } = await rig({ conversations: [{ ...KIMI_CHAT, owner: 'someone-else' }] })
    await openDrawer(host)
    await until(() => byAttr(shadow(host), 'data-chat-history-open', conversationUrn(7)) !== null)
    byAttr(shadow(host), 'data-chat-history-open', conversationUrn(7))!.click()
    await until(() => shadow(host).querySelector('[data-chat-reader-error]') !== null)
    expect(continueButton(host)).toBeNull()
  })

  it('is refused, with nothing of the conversation read, when asked for a conversation that is not the account’s own', async () => {
    // A shell (or a stale tab) can raise the intent without ever opening the reader.
    const { host, archive } = await rig({ conversations: [{ ...KIMI_CHAT, owner: 'someone-else' }] })
    void host.continueWith({ conversationId: conversationUrn(7), revisionId: revisionIdOf(7), title: 'Monads, again', messagesLoaded: 4 })
    await until(() => sheet(host)?.querySelector('[data-continue-error]') !== null && sheet(host) !== null)
    expect(squash(sheet(host)!.querySelector('[data-continue-error]')?.textContent)).not.toBe('')
    expect(archive.messageRequests).toEqual([])
    expect(optionKeys(host)).toEqual([])
  })
})

describe('Continue with… while no catalogue of voices is on offer', () => {
  // Defect guarded: the chooser said "This workspace’s own voice will pick it up." and Confirm was then refused with
  // "That voice is not on offer." The live catalogue answered HTTP 200 with `stale: true` at 16:54 on 2026-10-01 (fresh
  // at 16:21), and a stale catalogue is offered as none.
  it('says the workspace’s own voice will pick it up, and Confirm does exactly that', async () => {
    const { host, routes, sim } = await rig({ catalogue: { stale: true } })
    await openReader(host)
    continueButton(host)!.click()
    await until(() => sheet(host)?.querySelector('[data-continue-confirm]') != null)
    expect(optionKeys(host)).toEqual([])
    expect(squash(sheet(host)!.textContent)).toContain('This workspace’s own voice will pick it up.')
    expect(squash(sheet(host)!.querySelector('[data-continue-notice]')?.textContent)).toBe(
      'Continuing sends this conversation to OpenRouter and the model provider behind it.',
    )
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-confirm]')!.click()
    await until(() => chooser(host) === null)

    // The chat is open below the window, with no refusal anywhere, and the seam names what picked it up.
    await until(() => drawer(host) === null)
    await until(() => host.store!.getState().messages.length === 4)
    expect(host.store!.getState().sessionTitle).toBe('Monads, again · continued')
    const panel = host.panel!
    await until(() => panel.querySelector('.seam-line') !== null)
    expect(squash(panel.querySelector('.seam-line')?.textContent)).toMatch(/^— .*\d{4} · picked up with House default —$/)
    expect(squash(everythingSaid(host))).not.toContain('not on offer')
    expect(routes.seeds).toEqual([])
    expect(sim.invocations()).toEqual([])

    // And the first message carries the window and names no voice, as an ordinary first message does.
    host.store!.send('So where were we?')
    await until(() => sim.invocations().length === 1)
    expect(routes.seeds).toHaveLength(1)
    expect(sim.invocations()[0].body.input.seed).toMatchObject({ window: { kept: 4, omitted: 0, total: 4 } })
    expect(sim.invocations()[0].body.input.inference).toBeUndefined()
  })
})

describe('the home against the sidecar gateway before its backfill has run', () => {
  // The state of the LIVE gateway from the moment the home gateway rolled (its `/version` read 1359636 at 16:54 on 2026-10-01)
  // until `pn-conversation-sidecar-backfill` has written the derived rows: `order=recent` is answered 200 in HASH order with
  // `orderingFallback: "summaries-unavailable"`, the cursor it mints is a conversation id, a recency request that carries it is
  // served in hash order again (`hash-cursor`), no item carries a date, a model or a parent, and a page says `voice: null`.
  const many = (count: number): ImportedConversation[] =>
    Array.from({ length: count }, (_, index) => ({
      number: 100 + index,
      title: `Old chat ${index + 1}`,
      turns: [
        { role: 'user' as const, text: `Question ${index + 1}`, at: T0 + index * 60_000 },
        { role: 'assistant' as const, text: `Answer ${index + 1}`, at: T0 + index * 60_000 + 5_000, model: { id: KIMI_K25, provider: 'openrouter' } },
      ],
    }))
  const importedRows = (host: ShChatHost): string[] =>
    Array.from(shadow(host).querySelectorAll<HTMLElement>('[data-chat-history-kind="imported"]')).map(row => row.getAttribute('data-chat-history-row') ?? '')

  it('lists every import across its pages, once each, none dated, and says nothing is wrong', async () => {
    const { host, archive } = await rig({ conversations: many(60), rowless: true })
    await openDrawer(host)
    await until(() => importedRows(host).length === 50)
    // The first request asked for recency and was answered in hash order: the second page follows the conversation-id
    // cursor it was given, in one piece, and asks nothing the gateway would refuse.
    const lists = archive.requests.filter(request => request.route === '/me/conversations')
    expect(lists[0].query.get('order')).toBe('recent')
    expect(lists[0].query.get('after')).toBeNull()
    await until(() => shadow(host).querySelector('[data-chat-history-more]') !== null)
    ;(shadow(host).querySelector('[data-chat-history-more]') as HTMLButtonElement).click()
    await until(() => importedRows(host).length === 60)
    const rows = importedRows(host)
    expect(new Set(rows).size).toBe(60)
    expect(rows).toEqual(Array.from({ length: 60 }, (_, index) => conversationUrn(100 + index)))
    const second = archive.requests.filter(request => request.route === '/me/conversations')[1]
    expect(second.query.get('after')).toBe(conversationUrn(149))
    expect(shadow(host).querySelector('[data-chat-history-more]')).toBeNull()
    // Nothing is dated, and the home says so row by row; no notice, no error, no dead button.
    const metas = Array.from(shadow(host).querySelectorAll<HTMLElement>('[data-chat-history-kind="imported"] .history-meta')).map(node => squash(node.textContent))
    expect(metas).toHaveLength(60)
    expect(metas.every(meta => meta.startsWith('No date recorded'))).toBe(true)
    expect(shadow(host).querySelector('[data-chat-history-notice]')).toBeNull()
    expect(shadow(host).querySelector('[data-chat-history-live-error]')).toBeNull()
  })

  it('still reads a conversation (with its own message dates) and continues it, offering no "same voice" it cannot name', async () => {
    const { host, routes, sim } = await rig({ conversations: many(3), rowless: true })
    await openReader(host, 100, 2)
    const panel = shadow(host).querySelector('[data-chat-reader] sh-chat-panel') as unknown as HTMLElement
    // The messages carry the archive's own dates, whatever the list could say; no voice was derived, and the reader says that.
    expect(squash(panel.textContent)).toContain('Question 1')
    expect(squash(panel.textContent)).toContain('voice not recorded')
    expect(continueButton(host)).not.toBeNull()
    await startContinuing(host)
    // Nothing was derived for this revision, so there is nothing to call "the same voice": the House default is chosen.
    expect(optionKeys(host)).toEqual(['house', 'other'])
    expect(optionInput(host, 'house').checked).toBe(true)
    await confirm(host, 'house')
    await until(() => host.store!.getState().messages.length === 2)
    host.store!.send('Carry on.')
    await until(() => sim.invocations().length === 1)
    expect(routes.seeds).toHaveLength(1)
    // The seed names no model for the old assistant: none was recorded.
    expect(JSON.stringify(routes.seeds[0].body)).not.toContain('"voice"')
  })
})

describe('a conversation recorded the way the live archive records them', () => {
  // The backfill's own list (2026-10-01, 4,784 recovered voices): bare model ids under the legacy provider "mnemosyne",
  // Kimi K2.5 and K2.6 for 92% of them. The catalogue writes `moonshotai/kimi-k2.6`; the seed must carry what the source
  // recorded, the launch what the catalogue calls it.
  const REAL_KIMI: ImportedConversation = {
    number: 31,
    title: 'Port the parser',
    turns: [
      { role: 'user', text: 'Port the parser to Rust.', at: T0 },
      { role: 'assistant', text: 'Starting with the tokenizer.', at: T0 + 30_000, model: { id: 'kimi-k2.6', provider: 'mnemosyne' } },
      { role: 'user', text: 'And the grammar?', at: T0 + 60_000 },
      { role: 'assistant', text: 'A recursive-descent one.', at: T0 + 90_000, model: { id: 'kimi-k2.6', provider: 'mnemosyne' } },
    ],
  }

  it('offers the same voice, named from today’s catalogue; the seed carries the recorded id, the launch the catalogue’s', async () => {
    const { host, routes, sim } = await rig({ conversations: [REAL_KIMI] })
    await openReader(host, 31, 4)
    await startContinuing(host)
    expect(optionKeys(host)).toEqual(['same', 'house', 'other'])
    expect(squash(sheet(host)!.querySelector('[data-voice-option="same"]')!.textContent)).toContain('Same voice as before (source-recorded)')
    expect(squash(sheet(host)!.querySelector('[data-voice-option="same"]')!.textContent)).toContain('Kimi K2.6')
    await confirm(host, 'same')
    await until(() => host.store!.getState().messages.length === 4)
    const panel = host.panel!
    expect(Array.from(panel.querySelectorAll('.message.window .message-voice')).map(node => squash(node.textContent))).toEqual([
      'voice: Kimi K2.6 · source-recorded',
      'voice: Kimi K2.6 · source-recorded',
    ])
    host.store!.send('Where did we stop?')
    await until(() => sim.invocations().length === 1)
    expect((routes.seeds[0].body as { messages: Array<{ voice?: unknown }> }).messages.filter(message => message.voice).map(message => message.voice))
      .toEqual([{ model: 'kimi-k2.6' }, { model: 'kimi-k2.6' }])
    expect(sim.invocations()[0].body.input.inference).toEqual({ provider: 'openrouter', model: 'moonshotai/kimi-k2.6' })
    expect(routes.admitted[0].briefing.framing).toContain('Its model was recorded at the source as kimi-k2.6.')
  })
})

describe('a list read while the gateway’s derived rows change', () => {
  // The gateway answers 409 `conversation_archive_cursor_expired` to a recency cursor it can no longer continue and asks
  // for the list to start again from the first page (`G-gateway-return.md` 1.1). The backfill that is about to run, or a
  // rollback of the gateway, is exactly when that happens to a person who has the drawer open.
  const dated = (count: number): ImportedConversation[] =>
    Array.from({ length: count }, (_, index) => ({
      number: 200 + index,
      title: `Dated chat ${index + 1}`,
      turns: [
        { role: 'user' as const, text: `Question ${index + 1}`, at: T0 + index * 3_600_000 },
        { role: 'assistant' as const, text: `Answer ${index + 1}`, at: T0 + index * 3_600_000 + 5_000, model: { id: KIMI_K25, provider: 'openrouter' } },
      ],
    }))
  const rowsOf = (host: ShChatHost): string[] =>
    Array.from(shadow(host).querySelectorAll<HTMLElement>('[data-chat-history-kind="imported"]')).map(row => row.getAttribute('data-chat-history-row') ?? '')

  it('starts the list again from its first page, in what order the gateway now serves, and tells nobody it failed', async () => {
    const { host, archive } = await rig({ conversations: dated(60) })
    await openDrawer(host)
    await until(() => rowsOf(host).length === 50)
    await until(() => shadow(host).querySelector('[data-chat-history-more]') !== null)
    // Newest first while recency lasted: the newest dated chat (number 259) is the first row.
    expect(rowsOf(host)[0]).toBe(conversationUrn(259))

    archive.expireNextRecencyCursor()
    ;(shadow(host).querySelector('[data-chat-history-more]') as HTMLButtonElement).click()
    // The 409 is followed by the first page again, which the gateway now serves in hash order (no summaries).
    const listRequests = () => archive.requests.filter(request => request.route === '/me/conversations')
    await until(() => listRequests().length >= 3)
    expect(listRequests()[1].query.get('after')).toMatch(/^r1\./)
    expect(listRequests()[2].query.get('after')).toBeNull()
    await until(() => shadow(host).querySelector('[data-chat-history-more]') !== null && rowsOf(host).length === 50)
    expect(shadow(host).querySelector('[data-chat-history-notice]')).toBeNull()
    expect(new Set(rowsOf(host)).size).toBe(50)
    // And the list goes on from there: the rest arrives, once each, and the button goes.
    ;(shadow(host).querySelector('[data-chat-history-more]') as HTMLButtonElement).click()
    await until(() => rowsOf(host).length === 60)
    expect(new Set(rowsOf(host)).size).toBe(60)
    expect(shadow(host).querySelector('[data-chat-history-more]')).toBeNull()
    expect(shadow(host).querySelector('[data-chat-history-notice]')).toBeNull()
  })
})

describe('the chooser opens above the drawer, and Cancel returns to the reader', () => {
  it('reads the conversation, then offers the voices: the source’s own named as recorded, the House default chosen', async () => {
    const { host } = await rig()
    await openReader(host)
    await startContinuing(host)
    // The drawer is still there beneath it: this is a question about the conversation being read. It is out of reach
    // (inert) while the question is open: two dialogs are not both modal, and nothing under the sheet can be pressed or tabbed to.
    expect(drawer(host)).not.toBeNull()
    expect(reader(host)).not.toBeNull()
    expect(drawer(host)!.hasAttribute('inert')).toBe(true)
    const text = squash(sheet(host)!.textContent)
    expect(text).toContain('Continue “Monads, again”')
    expect(text).toContain('All 4 messages will be carried over.')
    expect(optionKeys(host)).toEqual(['same', 'house', 'other'])
    expect(squash(sheet(host)!.querySelector('[data-voice-option="same"]')!.textContent)).toContain('Same voice as before (source-recorded)')
    // Never chosen for the person.
    expect(optionInput(host, 'house').checked).toBe(true)
    expect(optionInput(host, 'same').checked).toBe(false)
    expect(squash(sheet(host)!.querySelector('[data-continue-notice]')?.textContent)).toBe(
      'Continuing sends this conversation to Google through OpenRouter.',
    )
  })

  it('sends nothing and makes nothing on Cancel, and gives focus back to Continue', async () => {
    const { host, sim, routes, service, bootId } = await rig()
    await openReader(host)
    await startContinuing(host)
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-cancel]')!.click()
    await until(() => chooser(host) === null)
    expect(reader(host)).not.toBeNull()
    expect(drawer(host)!.hasAttribute('inert')).toBe(false)
    expect(shadow(host).activeElement).toBe(continueButton(host))
    expect(routes.seeds).toEqual([])
    expect(sim.received.filter(item => item.method === 'POST')).toEqual([])
    expect((await service.listSessions()).map(session => session.id)).toEqual([bootId])
  })

  it('stays cancelled when the conversation finishes being read after the person has cancelled', async () => {
    // Defect guarded: Cancel during "Reading the conversation…" closed the sheet, and the read that was still on its way then
    // opened it again, over a person who had gone back to the reader.
    const hold = holdingResponse(request => /\/messages$/.test(request.url.pathname))
    const { host, archive } = await rig({ fetchImpl: hold.fetchImpl })
    await openReader(host)
    hold.arm()
    continueButton(host)!.click()
    await until(() => chooser(host) !== null)
    await hold.reached
    expect(squash(sheet(host)!.textContent)).toContain('Reading the conversation')
    sheet(host)!.querySelector<HTMLButtonElement>('[data-continue-cancel]')!.click()
    await until(() => chooser(host) === null)
    hold.release()
    await until(() => archive.messageRequests.length >= 2)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(chooser(host)).toBeNull()
    expect(reader(host)).not.toBeNull()
    // And a second try, started afterwards, is a fresh one.
    continueButton(host)!.click()
    await until(() => optionKeys(host).length > 0)
  })

  it('cancels on Escape without closing the drawer behind it', async () => {
    const { host } = await rig()
    await openReader(host)
    await startContinuing(host)
    sheet(host)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    await until(() => chooser(host) === null)
    expect(drawer(host)).not.toBeNull()
    expect(reader(host)).not.toBeNull()
  })
})

describe('a continued chat', () => {
  it('opens below the window it was given: the old turns keep their dates and their own voice, the seam names the new one', async () => {
    const { host, routes, sim, bootId } = await rig()
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')

    // The drawer is closed and the reader left: the person is in the new chat.
    await until(() => drawer(host) === null)
    const state = host.store!.getState()
    expect(state.sessionId).not.toBe(bootId)
    await until(() => host.store!.getState().messages.length === 4)
    expect(state.sessionTitle).toBe('Monads, again · continued')

    const panel = host.panel!
    await until(() => panel.querySelectorAll('.message.window').length === 4)
    // Exactly the window that was read, read-only, with its own marks and the source's own dates.
    expect(Array.from(panel.querySelectorAll('.message.window .message-content')).map(node => squash(node.textContent))).toEqual([
      'What is a monad?',
      'A monad is a design pattern.',
      'And a functor?',
      'Something that maps.',
    ])
    expect(Array.from(panel.querySelectorAll('.message.window .message-voice')).map(node => squash(node.textContent))).toEqual([
      'voice: Kimi K2.5 · source-recorded',
      'voice: Kimi K2.5 · source-recorded',
    ])
    // Nobody pretends to be anybody: the old assistant is called what it is.
    expect(Array.from(panel.querySelectorAll('.message.window.assistant .message-author')).map(node => squash(node.textContent)))
      .toEqual(['Earlier assistant', 'Earlier assistant'])
    expect(squash(panel.querySelector('.window-note')?.textContent)).toContain('The whole conversation is included')
    expect(squash(panel.querySelector('.window-note')?.textContent)).toContain('open the original')
    // The seam: dated, naming the voice that picked it up, and where the window goes.
    expect(squash(panel.querySelector('.seam-line')?.textContent)).toMatch(/^— .*\d{4} · picked up with Kimi K2\.5 —$/)
    expect(squash(panel.querySelector('.seam-notice')?.textContent)).toBe('Continuing sends this conversation to Moonshot through OpenRouter.')
    // And it is a chat nobody has said anything in: nothing has left the browser.
    expect(routes.seeds).toEqual([])
    expect(sim.invocations()).toEqual([])
  })

  it('sends the first message: the window to the seed store, then a launch that names it; the reply carries the voice that spoke', async () => {
    const { host, routes, sim } = await rig()
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')
    await until(() => host.store!.getState().messages.length === 4)

    host.store!.send('So where were we?')
    await until(() => sim.invocations().length === 1)
    await until(() => host.store!.getState().messages.filter(message => message.origin !== 'window' && message.role === 'assistant' && message.content).length === 1)

    // The store took exactly the window, in the live contract's shape, with the source's dates and models on it.
    expect(routes.seeds).toHaveLength(1)
    expect(routes.seeds[0].body).toEqual({
      schema: 'sophia.chat-seed.v1',
      messages: [
        { role: 'user', text: 'What is a monad?', occurredAt: new Date(T0).toISOString() },
        { role: 'assistant', text: 'A monad is a design pattern.', occurredAt: new Date(T0 + 30_000).toISOString(), voice: { model: KIMI_K25 } },
        { role: 'user', text: 'And a functor?', occurredAt: new Date(T0 + 60_000).toISOString() },
        { role: 'assistant', text: 'Something that maps.', occurredAt: new Date(T0 + 90_000).toISOString(), voice: { model: KIMI_K25 } },
      ],
    })
    // The launch names it: digest, bytes, where it came from, the window as counts, the title, the voice.
    const [launch] = sim.invocations()
    expect(launch.body.input.seed).toEqual({
      seedDigest: routes.seeds[0].digest,
      bytes: routes.seeds[0].bytes,
      continuesConversation: { archiveConversationUrn: conversationUrn(7), revisionId: revisionIdOf(7) },
      window: { kept: 4, omitted: 0, total: 4 },
      title: 'Monads, again · continued',
    })
    expect(launch.body.input.title).toBe('Monads, again · continued')
    expect(launch.body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K25 })
    expect(JSON.stringify(launch.body)).not.toContain('A monad is a design pattern.')

    // The continuing assistant is told when the old conversation was held and which model spoke in it, and that
    // it was not that model: what it is told is what the host derives from what the browser sent.
    expect(routes.admitted).toHaveLength(1)
    const { briefing } = routes.admitted[0]
    expect(briefing.framing).toContain('held 2026-01-05–2026-01-05 in the old Garden and imported read-only')
    expect(briefing.framing).toContain(`Its model was recorded at the source as ${KIMI_K25}.`)
    expect(briefing.framing).toContain('You were not part of it.')

    // Its reply is its own: marked with the voice that spoke, below the seam, apart from the old marks.
    const panel = host.panel!
    await until(() => panel.querySelectorAll('.message.assistant:not(.window) .message-voice').length === 1)
    expect(squash(panel.querySelector('.message.assistant:not(.window) .message-voice')?.textContent)).toBe('voice: Kimi K2.5')
    expect(panel.querySelectorAll('.message.window')).toHaveLength(4)
  })

  it('writes nothing of the old conversation anywhere but the seed store and the launch', async () => {
    const { host, sim } = await rig()
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')
    host.store!.send('So where were we?')
    await until(() => sim.invocations().length === 1)
    await until(() => host.store!.getState().messages.some(message => message.origin !== 'window' && message.role === 'assistant' && message.content))
    const written = sim.received.filter(item => item.method !== 'GET' && item.method !== 'OPTIONS').map(item => item.route)
    for (const route of written) {
      expect(route === '/chat-seeds' || route === '/invocations' || /^\/agent-sessions\/[^/]+\/(driver|commands)$/.test(route), route).toBe(true)
    }
    // A graph's documents (MCP, RDF) are never touched.
    expect(sim.received.some(item => /\/mcp|\/sparql|\/documents|\/rdf/.test(item.route))).toBe(false)
  })

  it('saves what was said in it, not the window: the old conversation stays where it is, and the file says so', async () => {
    const files: Array<{ filename: string; text: string }> = []
    const { host, sim } = await rig({ download: file => files.push(file) })
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')
    host.store!.send('So where were we?')
    await until(() => sim.invocations().length === 1)
    await until(() => host.store!.getState().messages.some(message => message.origin !== 'window' && message.role === 'assistant' && message.content))
    await host.panel!.onHeaderAction?.('save-garden')
    await until(() => shadow(host).querySelector('[data-chat-save-download]') !== null)
    ;(shadow(host).querySelector('[data-chat-save-download]') as HTMLButtonElement).click()
    await until(() => files.length === 1)
    expect(files[0].text).not.toContain('A monad is a design pattern')
    expect(files[0].text).not.toContain('What is a monad?')
    expect(files[0].text).toContain('So where were we?')
    expect(files[0].text).toContain('We were on functors.')
    expect(files[0].text).toContain('This conversation continued “Monads, again”, imported from the old garden. The 4 earlier messages it was given are not copied here')
  })

  it('opens the original from the seam: the reader on the conversation it picked up', async () => {
    const { host } = await rig()
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')
    await until(() => host.panel!.querySelector('.window-open-original') !== null)
    ;(host.panel!.querySelector('.window-open-original') as HTMLButtonElement).click()
    await until(() => reader(host) !== null)
    await until(() => squash(reader(host)!.textContent).includes('Monads, again'))
    expect(drawer(host)).not.toBeNull()
    expect(squash(shadow(host).querySelector('[data-chat-reader-provenance]')?.textContent)).toContain('Imported from the old garden')
    // The whole original is there to read, not the window.
    await until(() => (shadow(host).querySelector('[data-chat-reader] sh-chat-panel') as { messages?: unknown[] } | null)?.messages?.length === 4)
  })
})

describe('when the gateway turns out to have no seed route (the registry still says the host carries one)', () => {
  it('refuses in words, with nothing sent, and never starts a plain chat in its place', async () => {
    // The only way to learn that a POST route exists is to POST to it, and a POST before the first message would break
    // the one promise this feature makes first: nothing of the old conversation leaves the browser until the person
    // sends their own message. So the person is told at that moment, before the first message goes anywhere.
    const { host, routes, sim } = await rig()
    await openReader(host)
    await startContinuing(host)
    await confirm(host, 'same')
    routes.seedRoute = false
    host.store!.send('So where were we?')
    await until(() => host.store!.getState().sendState === 'error')
    const state = host.store!.getState()
    expect(state.sendError).toMatch(/cannot pick up an earlier conversation/i)
    expect(state.retainedDraft).toBe('So where were we?')
    expect(sim.invocations()).toEqual([])
    expect(state.messages.every(message => message.origin === 'window')).toBe(true)
  })
})

describe('the words around it', () => {
  it('never says anyone is back, revived or brought back, in any phase of the walk', async () => {
    const forbidden = /\b(is back|are back|welcome back|revive\w*|resurrect\w*|bring(?:s|ing)? (?:him |her |it |them )?back|brought (?:him |her |it |them )?back|reincarnat\w*|lives? again)\b/i
    const { host, sim } = await rig()
    const seen: string[] = []
    await openDrawer(host)
    seen.push(everythingSaid(host))
    await until(() => byAttr(shadow(host), 'data-chat-history-open', conversationUrn(7)) !== null)
    seen.push(everythingSaid(host))
    await openReader(host)
    seen.push(everythingSaid(host))
    continueButton(host)!.click()
    seen.push(everythingSaid(host))
    await until(() => optionKeys(host).length > 0)
    seen.push(everythingSaid(host))
    await confirm(host, 'same')
    await until(() => host.store!.getState().messages.length === 4)
    seen.push(everythingSaid(host))
    host.store!.send('Are you Kimi?')
    await until(() => sim.invocations().length === 1)
    await until(() => host.store!.getState().messages.some(message => message.origin !== 'window' && message.role === 'assistant' && message.content))
    seen.push(everythingSaid(host))
    for (const [index, text] of seen.entries()) expect(text.match(forbidden)?.[0], `phase ${index}`).toBeUndefined()
  })
})
