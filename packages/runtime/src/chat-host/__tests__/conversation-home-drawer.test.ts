/**
 * conversation-home-drawer.test.ts — the Chat history drawer as ONE conversation home.
 *
 * NO MOCKS. Everything is real: the real <sh-chat-host> mounted through the real
 * mountChatHost, the real <sh-chat-panel> (also the imported reader, in its
 * transcript-only posture), the real local ChatService, a real in-memory
 * implementation of the archive interface that fails and waits on command, and a
 * real recording implementation of the Save to Garden port.
 *
 * HONEST CAVEAT: happy-dom has no layout engine and DOMPurify is unreliable under
 * it. Touch-target size is therefore asserted on the shipped stylesheet text, and
 * hostile HTML inside MESSAGE bodies is proven inert in the jsdom kernel test
 * (chat-panel-reader-xss.test.ts). Here hostile text is used in TITLES, which the
 * drawer draws with plain text bindings, and as plain injected instructions.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { html, render, type CSSResult, type CSSResultGroup, type TemplateResult } from 'lit'
import type { ShChatPanel } from '@shrubbery/chat-kernel'
import type { ChatService } from '../../chat-services/chat-service.js'
import { ArchiveRequestError } from '../../chat-services/conversation-archive.js'
import type { ConversationSummary } from '../../chat-services/conversation-home.js'
import type { ContinueConversationIntent } from '../../chat-services/imported-reader.js'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import type { MarkdownFile } from '../../chat-services/conversation-export.js'
import {
  ADVERSARIAL,
  MemoryArchive,
  RecordingPort,
  archiveMessage,
  at,
  cid,
  importedItem,
  rid,
  sampleConversation,
} from '../../chat-services/__tests__/archive-fixtures.js'
import { ShChatHost } from '../chat-host.js'
import { CHAT_CONTINUE_EVENT, type ConversationHomePorts } from '../conversation-home-ports.js'
import { mountChatHost } from '../mount-chat-host.js'

const NOW = new Date(2026, 8, 28, 15, 0).getTime()

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  window.sessionStorage.clear()
  delete (window as { __home_pwned?: number }).__home_pwned
})

// ── harness ────────────────────────────────────────────────────────────────

interface Boot {
  container: HTMLElement
  host: ShChatHost
  panel: ShChatPanel
  service: ChatService
  sessionIds: string[]
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function settle(host: ShChatHost): Promise<void> {
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

async function boot(options: {
  archive?: MemoryArchive
  /** A synthetic live list. Omitted: the real sessions the service holds. */
  live?: readonly ConversationSummary[]
  sessions?: string[]
  ports?: ConversationHomePorts
} = {}): Promise<Boot> {
  const service = makeLocalChatService()
  if (options.archive) Object.defineProperty(service, 'archive', { value: options.archive })
  if (options.live) Object.defineProperty(service, 'listConversations', { value: async () => options.live })
  const sessionIds: string[] = []
  for (const title of options.sessions ?? ['Current chat']) sessionIds.push((await service.createSession({ title })).id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const ports: ConversationHomePorts = { now: () => NOW, ...options.ports }
  // The host sits inside an element: a template that is only one child binding is parsed by
  // happy-dom into a stray `<?>` node and the host never appears.
  render(html`<div>${mountChatHost(service, sessionIds[0] ?? null, { conversationHome: ports }) as unknown as TemplateResult}</div>`, container)
  const host = container.querySelector('#sh-chat-host') as ShChatHost
  await settle(host)
  return { container, host, panel: host.panel!, service, sessionIds }
}

const root = (host: ShChatHost): ShadowRoot => host.shadowRoot!
const drawerOf = (host: ShChatHost): HTMLElement | null => root(host).querySelector('[data-chat-history-drawer]')
const normalize = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
const rowIds = (host: ShChatHost): (string | null)[] =>
  Array.from(root(host).querySelectorAll('[data-chat-history-row]')).map(row => row.getAttribute('data-chat-history-row'))
const rowOf = (host: ShChatHost, id: string): HTMLElement => byAttr(root(host), 'data-chat-history-row', id) as HTMLElement
const click = (element: Element | null): void => { (element as HTMLElement).click() }
/** Find by an attribute's exact value. Ids here are URNs with colons, so this does not lean on a selector parser. */
const byAttr = (scope: ParentNode, name: string, value: string): HTMLElement | null =>
  Array.from(scope.querySelectorAll<HTMLElement>(`[${name}]`)).find(element => element.getAttribute(name) === value) ?? null

async function openDrawer(host: ShChatHost): Promise<HTMLElement> {
  await host.panel!.onSessionAction?.({ type: 'open-history' })
  await until(() => drawerOf(host) !== null)
  await settle(host)
  return drawerOf(host)!
}

async function type(host: ShChatHost, query: string): Promise<void> {
  const input = root(host).querySelector('[data-chat-history-search]') as HTMLInputElement
  input.value = query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle(host)
}

async function openImported(host: ShChatHost, id: string): Promise<HTMLElement> {
  click(byAttr(root(host), 'data-chat-history-open', id))
  await until(() => root(host).querySelector('[data-chat-reader]') !== null)
  await settle(host)
  return root(host).querySelector('[data-chat-reader]') as HTMLElement
}

/** The reader's real <sh-chat-panel>, once it holds `count` messages and has drawn them. */
async function readerPanel(host: ShChatHost, count: number): Promise<ShChatPanel> {
  await until(() => root(host).querySelector('[data-chat-reader] sh-chat-panel') !== null)
  const panel = root(host).querySelector('[data-chat-reader] sh-chat-panel') as ShChatPanel
  await until(() => panel.messages.length === count)
  await settle(host)
  await panel.updateComplete
  return panel
}

const KIMI_CHAT = importedItem(7, {
  revision: { revisionId: rid(7), title: 'Kimi chat', messageCount: 3, partCount: 9 },
  firstOccurredAt: at(2026, 3, 3, 14, 5),
  lastOccurredAt: at(2026, 3, 3, 14, 7),
  models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
  attributionBasis: 'account header',
})
const kimiArchive = (extra: ConstructorParameters<typeof MemoryArchive>[0] = {}) =>
  new MemoryArchive({ items: [KIMI_CHAT], messages: { [cid(7)]: sampleConversation() }, ...extra })

// ── one list ───────────────────────────────────────────────────────────────

describe('one conversation home', () => {
  it('lists live and imported chats in one list, newest first, each with its real date', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { lastOccurredAt: at(2026, 9, 27, 10), models: [{ id: 'moonshotai/kimi-k2.5', provider: null }], attributionBasis: 'account header' }),
        importedItem(2, { lastOccurredAt: at(2026, 8, 1, 10) }),
      ],
    })
    const { host } = await boot({
      archive,
      live: [
        { id: 'live-new', kind: 'live', title: 'Fresh chat', updatedAt: at(2026, 9, 28, 14, 30) },
        { id: 'live-old', kind: 'live', title: 'organism-chat', updatedAt: at(2026, 8, 15, 9) },
      ],
    })
    const drawer = await openDrawer(host)
    expect(rowIds(host)).toEqual(['live-new', cid(1), 'live-old', cid(2)])
    const text = (id: string) => normalize(rowOf(host, id).textContent)
    expect(text('live-new')).toContain('Fresh chat')
    expect(text('live-new')).toContain('30 min ago')
    expect(text(cid(1))).toContain('Yesterday')
    expect(text(cid(1))).toContain('4 messages')
    expect(text(cid(1))).toContain('∿ Kimi K2.5')
    expect(text(cid(2))).toContain('Aug 1')
    // An old live chat has no stored title: it is untitled, with its date, and never the shell's label.
    expect(text('live-old')).toContain('Untitled chat')
    expect(text('live-old')).toContain('Aug 15')
    expect(normalize(drawer.textContent)).not.toContain('organism-chat')
  })

  it('marks an import as imported in a quiet line of its own, and never marks a live chat that way', async () => {
    const { host } = await boot({
      archive: new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) })] }),
      live: [{ id: 'live-1', kind: 'live', title: 'Mine', updatedAt: at(2026, 9, 28) }],
    })
    await openDrawer(host)
    expect(normalize(rowOf(host, cid(1)).querySelector('.history-provenance')?.textContent)).toBe('Imported from the old garden')
    expect(rowOf(host, 'live-1').querySelector('.history-provenance')).toBeNull()
    expect(rowOf(host, cid(1)).getAttribute('data-chat-history-kind')).toBe('imported')
    expect(rowOf(host, 'live-1').getAttribute('data-chat-history-kind')).toBe('live')
  })

  it('never offers Rename or Delete on an import, which is read-only', async () => {
    const { host } = await boot({ archive: new MemoryArchive({ items: [importedItem(1)] }), live: [] })
    await openDrawer(host)
    const row = rowOf(host, cid(1))
    expect(row.querySelector('[data-chat-history-rename]')).toBeNull()
    expect(row.querySelector('[data-chat-history-delete]')).toBeNull()
  })

  it('groups a sub-agent conversation under the conversation that started it, until a search flattens them', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { lastOccurredAt: at(2026, 9, 27) }),
        importedItem(2, { lastOccurredAt: at(2026, 9, 26), parentConversationId: cid(1) }),
        importedItem(3, { lastOccurredAt: at(2026, 9, 25), parentConversationId: cid(1) }),
      ],
    })
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    expect(rowIds(host)).toEqual([cid(1)])
    const toggle = byAttr(root(host), 'data-chat-history-children', cid(1)) as HTMLElement
    expect(normalize(toggle.textContent)).toBe('2 sub-agent conversations')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    click(toggle)
    await settle(host)
    expect(rowIds(host)).toEqual([cid(1), cid(3), cid(2)])
    expect(rowOf(host, cid(3)).hasAttribute('data-chat-history-child')).toBe(true)
    expect(byAttr(root(host), 'data-chat-history-children', cid(1))!.getAttribute('aria-expanded')).toBe('true')
    await type(host, 'imported')
    expect(rowIds(host)).toEqual([cid(1), cid(2), cid(3)])
    expect(root(host).querySelector('[data-chat-history-children]')).toBeNull()
  })

  it('keeps Rename and Delete, and the title a person gave, on a live chat', async () => {
    const { host, sessionIds } = await boot({ sessions: ['Alpha', 'Beta'] })
    await openDrawer(host)
    expect(rowIds(host)).toHaveLength(2)
    const row = rowOf(host, sessionIds[1])
    expect(row.querySelector(`[data-chat-history-rename="${sessionIds[1]}"]`)).not.toBeNull()
    expect(row.querySelector(`[data-chat-history-delete="${sessionIds[1]}"]`)).not.toBeNull()
    expect(normalize(row.textContent)).toContain('Beta')
  })

  it('starts renaming an untitled chat from an empty box, not from the words "Untitled chat"', async () => {
    const { host, sessionIds } = await boot({ sessions: ['organism-chat'] })
    await openDrawer(host)
    expect(normalize(rowOf(host, sessionIds[0]).textContent)).toContain('Untitled chat')
    click(root(host).querySelector(`[data-chat-history-rename="${sessionIds[0]}"]`))
    await settle(host)
    const input = root(host).querySelector('[data-chat-history-rename-input]') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Untitled chat')
  })
})

// ── no dead end ────────────────────────────────────────────────────────────

describe('no imports, no dead end', () => {
  it('has no Imported section, no filter and no word about imports when the archive is empty', async () => {
    const { host } = await boot({
      archive: new MemoryArchive({ items: [] }),
      live: [{ id: 'only', kind: 'live', title: 'Only chat', updatedAt: at(2026, 9, 28) }],
    })
    const drawer = await openDrawer(host)
    expect(root(host).querySelector('[data-chat-history-filter]')).toBeNull()
    expect(normalize(drawer.textContent).toLowerCase()).not.toContain('imported')
    expect(normalize(drawer.textContent)).not.toContain('No imported chats found.')
    expect(rowIds(host)).toEqual(['only'])
  })

  it('has none of it either when the service has no archive at all', async () => {
    const { host } = await boot({ sessions: ['Alpha'] })
    const drawer = await openDrawer(host)
    expect(root(host).querySelector('[data-chat-history-filter]')).toBeNull()
    expect(normalize(drawer.textContent).toLowerCase()).not.toContain('imported')
  })

  it('says there are no chats yet, and what to do, only when there truly are none', async () => {
    const { host } = await boot({ archive: new MemoryArchive({ items: [] }), live: [] })
    await openDrawer(host)
    expect(normalize(root(host).querySelector('[data-chat-history-empty]')?.textContent)).toBe('No chats yet. Choose New to start one.')
  })

  it('shows the filter once there is something to filter, and the filter narrows the list', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) })] })
    const { host } = await boot({ archive, live: [{ id: 'l1', kind: 'live', title: 'Mine', updatedAt: at(2026, 9, 28) }] })
    await openDrawer(host)
    const chip = (name: string) => root(host).querySelector(`[data-chat-history-filter-option="${name}"]`) as HTMLElement
    expect(chip('all').getAttribute('aria-pressed')).toBe('true')
    expect(normalize(chip('all').textContent)).toBe('All')
    expect(normalize(chip('live').textContent)).toBe('Current')
    expect(normalize(chip('imported').textContent)).toBe('Imported')
    click(chip('imported'))
    await settle(host)
    expect(rowIds(host)).toEqual([cid(1)])
    expect(chip('imported').getAttribute('aria-pressed')).toBe('true')
    click(chip('live'))
    await settle(host)
    expect(rowIds(host)).toEqual(['l1'])
  })
})

// ── refusals, each in its own words ────────────────────────────────────────

describe('what the archive refuses is said plainly, beside a live list that still works', () => {
  it.each([
    [401, 'signed_out', 'Your session expired', true],
    [403, 'human_user_required', 'not open to this sign-in', false],
    [410, 'conversation_archive_erased', 'were erased', false],
    [503, 'conversation_archive_busy', 'unavailable right now', true],
  ] as const)('a %i has its own notice', async (status, code, words, retryable) => {
    const archive = new MemoryArchive()
    archive.failNext('list', new ArchiveRequestError(status, code, `status ${status}`))
    const { host } = await boot({ archive, live: [{ id: 'mine', kind: 'live', title: 'My chat', updatedAt: at(2026, 9, 28) }] })
    await openDrawer(host)
    const notice = root(host).querySelector('[data-chat-history-notice]') as HTMLElement
    expect(notice).not.toBeNull()
    expect(normalize(notice.textContent)).toContain(words)
    expect(normalize(notice.textContent)).toContain('Your live chats are not affected.')
    expect(notice.getAttribute('data-kind')).not.toBe('unknown')
    expect(notice.querySelector('[data-chat-history-notice-retry]') !== null).toBe(retryable)
    expect(notice.querySelector('[data-chat-history-notice-dismiss]') !== null).toBe(!retryable)
    expect(rowIds(host)).toEqual(['mine'])
    expect(normalize(drawerOf(host)!.textContent)).not.toContain('No imported chats found')
  })

  it('tries again on request and brings the imports in', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) })] })
    archive.failNext('list')
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    click(root(host).querySelector('[data-chat-history-notice-retry]'))
    await until(() => root(host).querySelector('[data-chat-history-notice]') === null)
    await settle(host)
    expect(rowIds(host)).toEqual([cid(1)])
  })

  it('lets a refusal that cannot change be dismissed', async () => {
    const archive = new MemoryArchive()
    archive.failNext('list', new ArchiveRequestError(410, 'conversation_archive_erased', 'gone'))
    const { host } = await boot({ archive, live: [{ id: 'mine', kind: 'live', title: 'Mine', updatedAt: at(2026, 9, 28) }] })
    await openDrawer(host)
    click(root(host).querySelector('[data-chat-history-notice-dismiss]'))
    await settle(host)
    expect(root(host).querySelector('[data-chat-history-notice]')).toBeNull()
    expect(rowIds(host)).toEqual(['mine'])
  })

  it('says the live list could not be read, with a way to ask again, and leaves the imports where they are', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) })] })
    let failing = true
    const service = makeLocalChatService()
    Object.defineProperty(service, 'archive', { value: archive })
    Object.defineProperty(service, 'listConversations', {
      value: async () => {
        if (failing) throw new Error('graph list unavailable')
        return [{ id: 'l1', kind: 'live', title: 'Mine', updatedAt: at(2026, 9, 28) }] satisfies ConversationSummary[]
      },
    })
    const session = await service.createSession({ title: 'Current' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(html`<div>${mountChatHost(service, session.id, { conversationHome: { now: () => NOW } }) as unknown as TemplateResult}</div>`, container)
    const host = container.querySelector('#sh-chat-host') as ShChatHost
    await settle(host)
    await openDrawer(host)
    expect(normalize(root(host).querySelector('[data-chat-history-live-error]')?.textContent)).toContain('graph list unavailable')
    expect(rowIds(host)).toEqual([cid(1)])
    failing = false
    click(root(host).querySelector('[data-chat-history-live-retry]'))
    await until(() => root(host).querySelector('[data-chat-history-live-error]') === null)
    await settle(host)
    expect(rowIds(host)).toEqual(['l1', cid(1)])
  })
})

// ── search, paging and state ───────────────────────────────────────────────

describe('search and state', () => {
  it('searches every loaded title, live and imported, with accents and case folded', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { revision: { revisionId: rid(1), title: 'Configuración del jardín', messageCount: 2, partCount: 2 } }),
        importedItem(2),
      ],
    })
    const { host } = await boot({ archive, live: [{ id: 'l1', kind: 'live', title: 'Deploy to Sirin box', updatedAt: at(2026, 9, 28) }] })
    await openDrawer(host)
    await type(host, 'CONFIGURACION')
    expect(rowIds(host)).toEqual([cid(1)])
    await type(host, 'sirin')
    expect(rowIds(host)).toEqual(['l1'])
    await type(host, 'zzz')
    expect(rowIds(host)).toEqual([])
    expect(normalize(root(host).querySelector('[data-chat-history-empty]')?.textContent)).toBe('No chats match “zzz”.')
    await type(host, '')
    expect(rowIds(host)).toHaveLength(3)
  })

  it('pages older chats in, and says how much a search covers until they are all in', async () => {
    const archive = new MemoryArchive({ pageSize: 2, items: [1, 2, 3, 4].map(n => importedItem(n, { lastOccurredAt: at(2026, 9, 20 - n) })) })
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    expect(rowIds(host)).toEqual([cid(1), cid(2)])
    await type(host, 'imported')
    expect(normalize(root(host).querySelector('[data-chat-history-search-note]')?.textContent)).toBe('Search covers the 2 conversations loaded so far.')
    click(root(host).querySelector('[data-chat-history-more]'))
    await until(() => rowIds(host).length === 4)
    await settle(host)
    expect(rowIds(host)).toEqual([cid(1), cid(2), cid(3), cid(4)])
    expect(root(host).querySelector('[data-chat-history-more]')).toBeNull()
    expect(root(host).querySelector('[data-chat-history-search-note]')).toBeNull()
  })

  it('keeps the search, the filter and the loaded imports when the drawer is closed and opened again, and never disturbs the chat behind it', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) }), importedItem(2, { lastOccurredAt: at(2026, 9, 26) })] })
    const { host, panel, sessionIds } = await boot({ archive, live: [] })
    await openDrawer(host)
    click(root(host).querySelector('[data-chat-history-filter-option="imported"]'))
    await settle(host)
    await type(host, 'imported')
    click(root(host).querySelector('[data-chat-history-close]'))
    await settle(host)
    expect(drawerOf(host)).toBeNull()
    await openDrawer(host)
    expect((root(host).querySelector('[data-chat-history-search]') as HTMLInputElement).value).toBe('imported')
    expect(root(host).querySelector('[data-chat-history-filter-option="imported"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(archive.countOf('list')).toBe(1)
    expect(host.store!.getState().sessionId).toBe(sessionIds[0])
    expect(host.panel).toBe(panel)
  })

  it('keeps an imported conversation open across closing the drawer', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    await openDrawer(host)
    await openImported(host, cid(7))
    click(root(host).querySelector('[data-chat-history-close]'))
    await settle(host)
    await openDrawer(host)
    expect(root(host).querySelector('[data-chat-reader]')).not.toBeNull()
  })
})

// ── keyboard and touch ─────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const focusablesOf = (drawer: HTMLElement): HTMLElement[] =>
  Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => !element.hasAttribute('hidden'))
const tab = (target: Element, shiftKey = false): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, composed: true, cancelable: true }))
}

describe('keyboard and touch', () => {
  it('traps Tab in the drawer, and the trap reaches the search box, the filter and the rows', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 27) })] })
    const { host } = await boot({ archive, live: [{ id: 'l1', kind: 'live', title: 'Mine', updatedAt: at(2026, 9, 28) }] })
    const drawer = await openDrawer(host)
    const focusables = focusablesOf(drawer)
    const has = (selector: string) => focusables.some(element => element.matches(selector))
    expect(has('[data-chat-history-search]')).toBe(true)
    expect(has('[data-chat-history-filter-option="imported"]')).toBe(true)
    expect(has('[data-chat-history-select="l1"]')).toBe(true)
    expect(focusables.some(element => element.getAttribute('data-chat-history-open') === cid(1))).toBe(true)
    const first = focusables[0]
    const last = focusables.at(-1)!
    last.focus()
    tab(last)
    expect(root(host).activeElement).toBe(first)
    first.focus()
    tab(first, true)
    expect(root(host).activeElement).toBe(last)
  })

  it('traps Tab across the imported reader too, including the controls inside the transcript', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    const drawer = await openDrawer(host)
    await openImported(host, cid(7))
    await readerPanel(host, 3)
    const focusables = focusablesOf(drawer)
    expect(focusables.some(element => element.closest('sh-chat-panel') !== null)).toBe(true)
    expect(focusables.some(element => element.matches('[data-chat-reader-back]'))).toBe(true)
    const last = focusables.at(-1)!
    last.focus()
    tab(last)
    expect(root(host).activeElement).toBe(focusables[0])
  })

  it('closes on Escape and hands focus back to where it came from, as before', async () => {
    const { host, panel } = await boot({ archive: new MemoryArchive({ items: [importedItem(1)] }), live: [] })
    const opener = panel.querySelector('.super-bar-identity') as HTMLButtonElement
    opener.focus()
    opener.click()
    await until(() => drawerOf(host) !== null)
    await settle(host)
    expect(root(host).activeElement).toBe(drawerOf(host))
    drawerOf(host)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    await settle(host)
    expect(drawerOf(host)).toBeNull()
    expect(root(host).activeElement).toBe(opener)
  })

  it('shows the shipped stylesheet a 44 px floor for every control in the drawer on touch and small screens', () => {
    const cssTextOf = (group: CSSResultGroup): string => (Array.isArray(group) ? group.map(cssTextOf).join('\n') : (group as CSSResult).cssText)
    const css = cssTextOf(ShChatHost.styles)
    const start = css.indexOf('@media (max-width: 600px), (pointer: coarse) {')
    expect(start, 'expected a coarse-pointer media block').toBeGreaterThan(-1)
    const open = css.indexOf('{', start)
    let depth = 0
    let end = open
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') {
        depth -= 1
        if (depth === 0) { end = index; break }
      }
    }
    const block = css.slice(open + 1, end)
    expect(block).toContain('min-height: 44px')
    for (const selector of [
      '.history-button',
      '.history-chip',
      '.history-select',
      '.history-input',
      '.history-more',
      '.history-notice button',
      '.history-children-toggle',
      '.history-reader-bar .history-button',
      '.save-choice',
      '.save-dialog .history-button',
      '.history-drawer sh-chat-panel .message-action-btn',
      '.history-drawer sh-chat-panel .tool-call-header',
      '.history-drawer sh-chat-panel .reasoning-header',
      '.history-drawer sh-chat-panel .code-copy-btn',
    ]) {
      expect(block, `${selector} needs the 44 px floor`).toContain(selector)
    }
  })
})

// ── the imported reader ────────────────────────────────────────────────────

describe('the imported reader is the chat panel, read-only', () => {
  it('opens as a transcript-only <sh-chat-panel> with real dates, voice marks, reasoning and tool cards', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    const panel = await readerPanel(host, 3)
    expect(panel.transcriptOnly).toBe(true)
    expect(panel.readOnly).toBe(true)
    expect(panel.assistantLabel).toBe('Assistant')
    expect(panel.querySelectorAll('.message')).toHaveLength(3)
    expect(panel.querySelector('hoja-editor')).toBeNull()
    expect(panel.querySelector('.composer')).toBeNull()
    expect(panel.querySelector('.message-time')).toBeNull()
    expect(Array.from(panel.querySelectorAll('.message-annotation')).map(node => node.textContent)).toEqual([
      'Mar 3, 2026, 2:05 PM',
      'Mar 3, 2026, 2:06 PM · voice: Kimi K2.5 · source-recorded',
      'Mar 3, 2026, 2:07 PM · voice not recorded',
    ])
    expect(panel.querySelector('.reasoning-header')).not.toBeNull()
    expect(panel.querySelector('.tool-call')).not.toBeNull()
    expect(panel.textContent).not.toContain('Sophia')
    // Only Copy is offered under an assistant turn.
    expect(Array.from(panel.querySelectorAll('.message-action-btn')).map(button => button.getAttribute('aria-label'))).toEqual(['Copy message', 'Copy message'])
    // A retained tool call with no output says so when it is opened.
    click(panel.querySelector('.tool-call-header'))
    await panel.updateComplete
    expect(panel.querySelector('.tool-output-missing')?.textContent).toBe('Output not retained.')
    expect(reader.getAttribute('data-status')).toBe('ready')
  })

  it('says where it came from, when, in whose voice, how much of it is here, and what may be missing', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 3)
    const field = (name: string) => normalize(reader.querySelector(`[data-chat-reader-${name}]`)?.textContent)
    expect(field('title')).toBe('Kimi chat')
    expect(field('provenance')).toBe('Imported from the old garden · account header')
    expect(field('range')).toBe('Mar 3, 2026')
    expect(field('voices')).toBe('Voice: Kimi K2.5')
    expect(field('count')).toBe('3 of 3 messages')
    expect(field('note')).toContain('may be missing')
    expect(field('note')).not.toMatch(/opencode|sqlite|export\.v1|inferred/i)
    expect(normalize(reader.textContent)).not.toContain('cloud1-opencode-archive')
  })

  it('says "voice not recorded" when the gateway recorded no model for the conversation', async () => {
    const item = importedItem(8, { revision: { revisionId: rid(8), title: 'Old chat', messageCount: 1, partCount: 1 } })
    const archive = new MemoryArchive({ items: [item], messages: { [cid(8)]: [archiveMessage('o1', 'assistant', 'From long ago.')] } })
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(8))
    const panel = await readerPanel(host, 1)
    expect(normalize(reader.querySelector('[data-chat-reader-voices]')?.textContent)).toBe('Voice not recorded')
    expect(Array.from(panel.querySelectorAll('.message-annotation')).map(node => node.textContent)).toEqual(['Time not recorded · voice not recorded'])
  })

  it('reads on, a page at a time', async () => {
    const { host } = await boot({ archive: kimiArchive({ messagePageSize: 2 }), live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    const panel = await readerPanel(host, 2)
    expect(normalize(reader.querySelector('[data-chat-reader-count]')?.textContent)).toBe('2 of 3 messages')
    click(reader.querySelector('[data-chat-reader-more]'))
    await until(() => panel.messages.length === 3)
    await settle(host)
    expect(normalize(root(host).querySelector('[data-chat-reader-count]')?.textContent)).toBe('3 of 3 messages')
    expect(root(host).querySelector('[data-chat-reader-more]')).toBeNull()
  })

  it('goes back to the list and puts focus on the conversation it came from', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    await openDrawer(host)
    await openImported(host, cid(7))
    expect(root(host).activeElement).toBe(root(host).querySelector('[data-chat-reader-back]'))
    click(root(host).querySelector('[data-chat-reader-back]'))
    await settle(host)
    expect(root(host).querySelector('[data-chat-reader]')).toBeNull()
    expect(rowIds(host)).toEqual([cid(7)])
    expect(root(host).activeElement).toBe(byAttr(root(host), 'data-chat-history-open', cid(7)))
  })

  it('shows the sub-agent conversations under their parent, and the way back up from one of them', async () => {
    const parent = importedItem(1, { revision: { revisionId: rid(1), title: 'Main thread', messageCount: 1, partCount: 1 }, lastOccurredAt: at(2026, 9, 27) })
    const child = importedItem(2, { revision: { revisionId: rid(2), title: 'Explore agent', messageCount: 1, partCount: 1 }, lastOccurredAt: at(2026, 9, 26), parentConversationId: cid(1) })
    const archive = new MemoryArchive({
      items: [parent, child],
      messages: { [cid(1)]: [archiveMessage('p1', 'user', 'Start.')], [cid(2)]: [archiveMessage('c1', 'assistant', 'Explored.')] },
    })
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(1))
    await readerPanel(host, 1)
    expect(normalize(reader.querySelector('[data-chat-reader-children]')?.textContent)).toContain('Explore agent')
    click(byAttr(reader, 'data-chat-reader-child', cid(2)))
    await until(() => normalize(root(host).querySelector('[data-chat-reader-title]')?.textContent) === 'Explore agent')
    await readerPanel(host, 1)
    expect(normalize(root(host).querySelector('[data-chat-reader-parent]')?.textContent)).toContain('Main thread')
    click(root(host).querySelector('[data-chat-reader-parent]'))
    await until(() => normalize(root(host).querySelector('[data-chat-reader-title]')?.textContent) === 'Main thread')
  })

  it.each([
    [410, 'were erased', false],
    [403, 'not open to this sign-in', false],
    [503, 'unavailable right now', true],
  ] as const)('a %i on opening says so in its own words', async (status, words, retryable) => {
    const archive = kimiArchive()
    archive.failNext('messages', new ArchiveRequestError(status, null, `status ${status}`))
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await until(() => reader.querySelector('[data-chat-reader-error]') !== null)
    const error = reader.querySelector('[data-chat-reader-error]') as HTMLElement
    expect(normalize(error.textContent)).toContain(words)
    expect(error.querySelector('[data-chat-reader-retry]') !== null).toBe(retryable)
  })

  it('retries a failed open and reads the conversation', async () => {
    const archive = kimiArchive()
    archive.failNext('messages')
    const { host } = await boot({ archive, live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await until(() => reader.querySelector('[data-chat-reader-retry]') !== null)
    click(reader.querySelector('[data-chat-reader-retry]'))
    await readerPanel(host, 3)
    expect(root(host).querySelector('[data-chat-reader-error]')).toBeNull()
  })
})

// ── Continue with… ─────────────────────────────────────────────────────────

describe('Continue with…', () => {
  it('is not offered when nothing can continue a conversation', async () => {
    const { host } = await boot({ archive: kimiArchive(), live: [] })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 3)
    expect(reader.querySelector('[data-chat-reader-continue]')).toBeNull()
  })

  it('emits the intent with the conversation, the revision, the title and how much was loaded, then closes the drawer', async () => {
    const intents: ContinueConversationIntent[] = []
    const { host, container } = await boot({
      archive: kimiArchive({ messagePageSize: 2 }),
      live: [],
      ports: { onContinue: async intent => { intents.push(intent) } },
    })
    const events: ContinueConversationIntent[] = []
    container.addEventListener(CHAT_CONTINUE_EVENT, ((event: CustomEvent<ContinueConversationIntent>) => { events.push(event.detail) }) as EventListener)
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 2)
    const button = reader.querySelector('[data-chat-reader-continue]') as HTMLElement
    expect(normalize(button.textContent)).toBe('Continue with…')
    click(button)
    await until(() => intents.length === 1)
    expect(intents[0]).toEqual({ conversationId: cid(7), revisionId: rid(7), title: 'Kimi chat', messagesLoaded: 2 })
    expect(events).toEqual(intents)
    await until(() => drawerOf(host) === null)
  })

  it('stays open and says why when the continuation is refused', async () => {
    const { host } = await boot({
      archive: kimiArchive(),
      live: [],
      ports: { onContinue: async () => { throw new Error('This assistant cannot continue conversations yet.') } },
    })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 3)
    click(reader.querySelector('[data-chat-reader-continue]'))
    await until(() => root(host).querySelector('[data-chat-reader-action-error]') !== null)
    expect(normalize(root(host).querySelector('[data-chat-reader-action-error]')?.textContent)).toContain('This assistant cannot continue conversations yet.')
    expect(drawerOf(host)).not.toBeNull()
  })
})

// ── Save to Garden and Download as Markdown ────────────────────────────────

const FIELD = { graphId: 'field-notes', title: 'Field notes' }
const HOME = { graphId: 'home', title: 'Home' }
const dialogOf = (host: ShChatHost): HTMLElement | null => root(host).querySelector('[data-chat-save-dialog]')
const choose = async (host: ShChatHost, graphId: string): Promise<void> => {
  const radio = root(host).querySelector(`[data-chat-save-target="${graphId}"]`) as HTMLInputElement
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  await settle(host)
}

describe('Save to Garden, for a live chat', () => {
  async function liveWithTurn(options: { ports: ConversationHomePorts }) {
    const world = await boot({ sessions: ['Deploy notes'], ...options })
    world.host.store!.send('How do I roll the gateway?')
    await until(() => world.host.store!.getState().messages.some(message => message.role === 'assistant' && message.content.includes('You said: How do I roll the gateway?')))
    await settle(world.host)
    return world
  }
  const saveButton = (panel: ShChatPanel) => panel.querySelector('.icon-button[aria-label="Save chat to Garden"]') as HTMLButtonElement

  it('hides Read aloud and Regenerate on a live reply, and keeps Copy', async () => {
    const { panel } = await liveWithTurn({ ports: {} })
    await panel.updateComplete
    expect(Array.from(panel.querySelectorAll('.message-action-btn')).map(button => button.getAttribute('aria-label'))).toEqual(['Copy message'])
  })

  it('asks where to copy it, promises exactly what a copy means, and saves only after the person chooses and confirms', async () => {
    const port = new RecordingPort([FIELD, HOME])
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: port } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => dialogOf(host) !== null)
    await settle(host)
    const targets = Array.from(root(host).querySelectorAll('[data-chat-save-target]')).map(input => input.getAttribute('data-chat-save-target'))
    expect(targets).toEqual(['field-notes', 'home'])
    // Nothing is chosen for the person, so nothing is promised yet and Save cannot be pressed.
    expect(root(host).querySelector('[data-chat-save-copy]')).toBeNull()
    expect((root(host).querySelector('[data-chat-save-confirm]') as HTMLButtonElement).disabled).toBe(true)
    await choose(host, 'home')
    expect(normalize(root(host).querySelector('[data-chat-save-copy]')?.textContent)).toBe('Copies this conversation into Home. Everyone with access there can read it.')
    await choose(host, 'field-notes')
    expect(normalize(root(host).querySelector('[data-chat-save-copy]')?.textContent)).toBe('Copies this conversation into Field notes. Everyone with access there can read it.')
    expect(port.saved).toEqual([])
    click(root(host).querySelector('[data-chat-save-confirm]'))
    await until(() => port.saved.length === 1)
    await until(() => normalize(root(host).querySelector('[data-chat-save-status]')?.textContent).startsWith('Saved to Field notes'))
    expect(port.saved[0]).toMatchObject({ workspaceId: 'field-notes', workspaceTitle: 'Field notes', title: 'Deploy notes', kind: 'live' })
    expect(port.saved[0].markdown).toContain('How do I roll the gateway?')
    expect(port.saved[0].markdown).toContain('You said: How do I roll the gateway?')
    click(root(host).querySelector('[data-chat-save-open]'))
    expect(port.opened).toEqual([{ workspaceId: 'field-notes', documentId: 'doc-saved-1' }])
  })

  it('preselects a single workspace but still waits for Save', async () => {
    const port = new RecordingPort([HOME])
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: port } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => dialogOf(host) !== null)
    await until(() => root(host).querySelector('[data-chat-save-copy]') !== null)
    expect(normalize(root(host).querySelector('[data-chat-save-copy]')?.textContent)).toBe('Copies this conversation into Home. Everyone with access there can read it.')
    expect(port.saved).toEqual([])
  })

  it('says a refused save was refused, and can try again', async () => {
    const port = new RecordingPort([HOME])
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: port } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => root(host).querySelector('[data-chat-save-copy]') !== null)
    port.refuseNext(new Error('You need Editor access to Home.'))
    click(root(host).querySelector('[data-chat-save-confirm]'))
    await until(() => normalize(root(host).querySelector('[data-chat-save-status]')?.textContent).includes('You need Editor access to Home.'))
    click(root(host).querySelector('[data-chat-save-confirm]'))
    await until(() => normalize(root(host).querySelector('[data-chat-save-status]')?.textContent).startsWith('Saved to Home'))
    expect(port.saved).toHaveLength(2)
  })

  it('says there is nowhere the person can write, rather than showing an empty list', async () => {
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: new RecordingPort([]) } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => dialogOf(host) !== null)
    await until(() => root(host).querySelector('[data-chat-save-none]') !== null)
    expect(normalize(root(host).querySelector('[data-chat-save-none]')?.textContent)).toBe('You do not have a workspace you can write to yet.')
    expect(root(host).querySelectorAll('[data-chat-save-target]')).toHaveLength(0)
  })

  it('closes on Escape without closing anything else, and gives focus back', async () => {
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: new RecordingPort([HOME]) } })
    await panel.updateComplete
    const opener = saveButton(panel)
    opener.focus()
    click(opener)
    await until(() => dialogOf(host) !== null)
    await settle(host)
    dialogOf(host)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }))
    await settle(host)
    expect(dialogOf(host)).toBeNull()
    expect(root(host).activeElement).toBe(opener)
    expect(host.panel).toBe(panel)
  })

  it('offers Download as Markdown from the same dialog, and hands the host a file named for the title and the day', async () => {
    const downloads: MarkdownFile[] = []
    const port = new RecordingPort([HOME])
    const { host, panel } = await liveWithTurn({ ports: { saveToGarden: port, download: file => { downloads.push(file) } } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => dialogOf(host) !== null)
    click(root(host).querySelector('[data-chat-save-download]'))
    await until(() => downloads.length === 1)
    expect(downloads[0].filename).toBe('deploy-notes-2026-09-28.md')
    expect(downloads[0].mimeType).toBe('text/markdown;charset=utf-8')
    expect(downloads[0].text).toContain('# Deploy notes')
    expect(downloads[0].text).toContain('How do I roll the gateway?')
    expect(port.saved).toEqual([])
  })

  it('offers only the download when the shell gave no way to save into a workspace', async () => {
    const downloads: MarkdownFile[] = []
    const { host, panel } = await liveWithTurn({ ports: { download: file => { downloads.push(file) } } })
    await panel.updateComplete
    click(saveButton(panel))
    await until(() => dialogOf(host) !== null)
    await settle(host)
    expect(root(host).querySelector('[data-chat-save-target]')).toBeNull()
    expect(root(host).querySelector('[data-chat-save-confirm]')).toBeNull()
    expect(normalize(root(host).querySelector('[data-chat-save-none]')?.textContent)).toBe('Saving into a workspace is not available here.')
    click(root(host).querySelector('[data-chat-save-download]'))
    await until(() => downloads.length === 1)
  })
})

describe('Save to Garden and Download, for an imported conversation', () => {
  it('reads every page first, then copies the whole conversation with its provenance and voice marks', async () => {
    const port = new RecordingPort([FIELD])
    const { host } = await boot({ archive: kimiArchive({ messagePageSize: 2 }), live: [], ports: { saveToGarden: port } })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 2)
    click(reader.querySelector('[data-chat-reader-save]'))
    await until(() => root(host).querySelector('[data-chat-save-copy]') !== null)
    click(root(host).querySelector('[data-chat-save-confirm]'))
    await until(() => port.saved.length === 1)
    const request = port.saved[0]
    expect(request).toMatchObject({ workspaceId: 'field-notes', title: 'Kimi chat', kind: 'imported' })
    expect(request.markdown).toContain('Imported from the old garden · account header')
    expect(request.markdown).toContain('voice: Kimi K2.5 · source-recorded')
    expect(request.markdown).toContain('voice not recorded')
    expect(request.markdown).toContain('And nothing else, and no recorded voice.')
    await readerPanel(host, 3)
  })

  it('downloads it as Markdown straight from the reader', async () => {
    const downloads: MarkdownFile[] = []
    const { host } = await boot({ archive: kimiArchive(), live: [], ports: { download: file => { downloads.push(file) } } })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 3)
    click(reader.querySelector('[data-chat-reader-download]'))
    await until(() => downloads.length === 1)
    expect(downloads[0].filename).toBe('kimi-chat-2026-09-28.md')
    expect(downloads[0].text).toContain('*Imported from the old garden · account header · 3 messages · Mar 3, 2026 · exported Sep 28, 2026*')
    expect(downloads[0].text).toContain('_Output not retained._')
  })

  it('does not start a second download while the first is still reading pages', async () => {
    const downloads: MarkdownFile[] = []
    const archive = kimiArchive({ messagePageSize: 2 })
    const { host } = await boot({ archive, live: [], ports: { download: file => { downloads.push(file) } } })
    await openDrawer(host)
    const reader = await openImported(host, cid(7))
    await readerPanel(host, 2)
    const release = archive.hold('messages')
    click(reader.querySelector('[data-chat-reader-download]'))
    await until(() => normalize(root(host).querySelector('[data-chat-reader-status]')?.textContent) === 'Preparing the download…')
    click(root(host).querySelector('[data-chat-reader-download]'))
    release()
    await until(() => downloads.length === 1)
    await settle(host)
    expect(downloads).toHaveLength(1)
    expect(normalize(root(host).querySelector('[data-chat-reader-status]')?.textContent)).toBe('Downloaded kimi-chat-2026-09-28.md.')
  })
})

// ── hostile data ───────────────────────────────────────────────────────────

describe('hostile data stays data', () => {
  it('draws a hostile title as plain text in the list and in the reader, and nothing runs or reacts', async () => {
    const hostile = importedItem(3, {
      revision: { revisionId: rid(3), title: ADVERSARIAL.titleHtml, messageCount: 1, partCount: 1 },
      lastOccurredAt: at(2026, 9, 27),
    })
    const archive = new MemoryArchive({
      items: [hostile],
      messages: { [cid(3)]: [archiveMessage('h1', 'user', ADVERSARIAL.injection, { occurredAt: at(2026, 9, 27, 9) })] },
    })
    const port = new RecordingPort([HOME])
    const { host } = await boot({
      archive,
      live: [{ id: 'live-h', kind: 'live', title: ADVERSARIAL.titleScript, updatedAt: at(2026, 9, 28) }],
      ports: { saveToGarden: port },
    })
    const drawer = await openDrawer(host)
    expect(drawer.querySelector('img')).toBeNull()
    expect(drawer.querySelector('script')).toBeNull()
    expect(normalize(rowOf(host, cid(3)).textContent)).toContain(ADVERSARIAL.titleHtml)
    expect(normalize(rowOf(host, 'live-h').textContent)).toContain(ADVERSARIAL.titleScript)
    await type(host, 'quarterly')
    expect(rowIds(host)).toEqual([cid(3)])
    await type(host, '')
    const reader = await openImported(host, cid(3))
    const panel = await readerPanel(host, 1)
    expect(reader.querySelector('img')).toBeNull()
    expect(normalize(reader.querySelector('[data-chat-reader-title]')?.textContent)).toBe(ADVERSARIAL.titleHtml)
    expect(panel.textContent).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS')
    expect((window as { __home_pwned?: number }).__home_pwned).toBeUndefined()
    // Reading a conversation that gives orders changes nothing: no save, no other request.
    expect(port.saved).toEqual([])
    expect(archive.calls).toEqual([`list:`, `revisions:${cid(3)}`, `messages:${cid(3)}:${rid(3)}:0`])
  })
})
