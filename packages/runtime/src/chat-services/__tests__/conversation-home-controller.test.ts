/**
 * conversation-home-controller.test.ts — the data behind the one conversation home.
 *
 * NO MOCKS. The live source is the REAL local ChatService (its `listConversations`
 * is set to a real function where a test needs specific dates or a failure); the
 * imported source is a REAL in-memory implementation of the archive interface that
 * pages like the gateway and can be told to fail or to wait (archive-fixtures.ts).
 */
import { describe, expect, it } from 'vitest'
import { ArchiveRequestError } from '../conversation-archive.js'
import type { ChatService } from '../chat-service.js'
import type { ConversationSummary } from '../conversation-home.js'
import { createConversationHomeController } from '../conversation-home-controller.js'
import { makeLocalChatService } from '../local-chat-service.js'
import { MemoryArchive, at, cid, importedItem } from './archive-fixtures.js'

function serviceWith(archive?: MemoryArchive): ChatService {
  const service = makeLocalChatService()
  if (archive) Object.defineProperty(service, 'archive', { value: archive })
  return service
}

/** Give the service a real `listConversations` with exactly these live conversations. */
function defineLive(service: ChatService, list: () => readonly ConversationSummary[]): { calls: () => number } {
  let calls = 0
  Object.defineProperty(service, 'listConversations', {
    value: async () => {
      calls += 1
      return list()
    },
  })
  return { calls: () => calls }
}

const live = (id: string, updatedAt: string, title: string | null = id): ConversationSummary =>
  ({ id, kind: 'live', title, updatedAt })

describe('one list: live and imported together, by real date', () => {
  it('orders both kinds newest first and shows the Imported filter', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { lastOccurredAt: at(2026, 9, 27) }),
        importedItem(2, { lastOccurredAt: at(2026, 8, 1) }),
      ],
    })
    const service = serviceWith(archive)
    defineLive(service, () => [live('live-new', at(2026, 9, 28)), live('live-old', at(2026, 8, 15))])
    const home = createConversationHomeController(service)
    await home.open()
    const view = home.view()
    expect(view.list.rows.map(row => row.key)).toEqual(['live:live-new', `imported:${cid(1)}`, 'live:live-old', `imported:${cid(2)}`])
    expect(view.hasImports).toBe(true)
    expect(view.showFilter).toBe(true)
    expect(view.notice).toBeNull()
    expect(view.empty).toBe(false)
  })

  it('has no Imported section at all when the archive holds nothing, and says nothing about it', async () => {
    const service = serviceWith(new MemoryArchive({ items: [] }))
    defineLive(service, () => [live('only', at(2026, 9, 28), 'Only chat')])
    const home = createConversationHomeController(service)
    await home.open()
    const view = home.view()
    expect(view.hasImports).toBe(false)
    expect(view.showFilter).toBe(false)
    expect(view.notice).toBeNull()
    expect(view.list.rows.map(row => row.title)).toEqual(['Only chat'])
  })

  it('has no imported anything when the service has no archive', async () => {
    const service = serviceWith()
    defineLive(service, () => [live('a', at(2026, 9, 28))])
    const home = createConversationHomeController(service)
    await home.open()
    expect(home.view().archiveAvailable).toBe(false)
    expect(home.view().hasImports).toBe(false)
    expect(home.getState().imported.phase).toBe('idle')
    expect(home.view().list.rows).toHaveLength(1)
  })

  it('says "no chats yet" only when there really is nothing, not while loading and not on a failure', async () => {
    const archive = new MemoryArchive({ items: [] })
    const service = serviceWith(archive)
    defineLive(service, () => [])
    const home = createConversationHomeController(service)
    const release = archive.hold('list')
    const opening = home.open()
    expect(home.view().loadingFirst).toBe(true)
    expect(home.view().empty).toBe(false)
    release()
    await opening
    expect(home.view().loadingFirst).toBe(false)
    expect(home.view().empty).toBe(true)

    const refused = new MemoryArchive()
    refused.failNext('list', new ArchiveRequestError(410, 'conversation_archive_erased', 'gone'))
    const other = createConversationHomeController(Object.defineProperty(serviceWith(), 'archive', { value: refused }))
    await other.open()
    expect(other.view().empty).toBe(false)
    expect(other.view().notice?.kind).toBe('erased')
  })

  it('gives a legacy live chat its date and an honest name, never the label the shell once minted', async () => {
    const service = serviceWith()
    defineLive(service, () => [
      live('c2chat-old', at(2026, 9, 20), 'organism-chat'),
      live('c2chat-blank', at(2026, 9, 19), null),
      live('c2chat-real', at(2026, 9, 18), 'Deploy notes'),
    ])
    const home = createConversationHomeController(service)
    await home.open()
    const rows = home.view().list.rows
    expect(rows.map(row => row.title)).toEqual(['Untitled chat', 'Untitled chat', 'Deploy notes'])
    expect(rows[0].dateIso).toBe(at(2026, 9, 20))
    expect(rows.some(row => row.title === 'organism-chat')).toBe(false)
    // No stored model: nothing is invented.
    expect(rows[0].models).toEqual([])
  })
})

describe('what the archive refuses is said in its own words, and the live list is never taken with it', () => {
  it.each([
    [401, 'signed_out', 'unauthorized', true],
    [403, 'human_user_required', 'forbidden', false],
    [410, 'conversation_archive_erased', 'erased', false],
    [503, 'conversation_archive_busy', 'unavailable', true],
  ] as const)('a %i is its own notice', async (status, code, kind, retryable) => {
    const archive = new MemoryArchive()
    archive.failNext('list', new ArchiveRequestError(status, code, `status ${status}`))
    const service = serviceWith(archive)
    defineLive(service, () => [live('mine', at(2026, 9, 28), 'My chat')])
    const home = createConversationHomeController(service)
    await home.open()
    const view = home.view()
    expect(view.notice?.kind).toBe(kind)
    expect(view.notice?.status).toBe(status)
    expect(view.notice?.retryable).toBe(retryable)
    expect(view.hasImports).toBe(false)
    expect(view.showFilter).toBe(false)
    expect(view.list.rows.map(row => row.title)).toEqual(['My chat'])
  })

  it('shows four different explanations for the four refusals', async () => {
    const titles = new Set<string>()
    for (const [status, code] of [[401, 'signed_out'], [403, 'human_user_required'], [410, 'conversation_archive_erased'], [503, 'conversation_archive_busy']] as const) {
      const archive = new MemoryArchive()
      archive.failNext('list', new ArchiveRequestError(status, code, 'x'))
      const home = createConversationHomeController(serviceWith(archive))
      await home.open()
      titles.add(home.view().notice!.title)
    }
    expect(titles.size).toBe(4)
  })

  it('tries again on request and clears the notice when the archive answers', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 1) })] })
    archive.failNext('list')
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    expect(home.view().notice?.kind).toBe('unavailable')
    await home.retryImported()
    expect(home.view().notice).toBeNull()
    expect(home.view().hasImports).toBe(true)
    expect(archive.countOf('list')).toBe(2)
  })

  it('asks a retryable failure again the next time the drawer opens, but never re-asks a refusal that cannot change', async () => {
    const busy = new MemoryArchive({ items: [importedItem(1)] })
    busy.failNext('list')
    const busyHome = createConversationHomeController(serviceWith(busy))
    await busyHome.open()
    await busyHome.open()
    expect(busy.countOf('list')).toBe(2)
    expect(busyHome.view().hasImports).toBe(true)

    const erased = new MemoryArchive({ items: [importedItem(1)] })
    erased.failNext('list', new ArchiveRequestError(410, 'conversation_archive_erased', 'gone'))
    const erasedHome = createConversationHomeController(serviceWith(erased))
    await erasedHome.open()
    await erasedHome.open()
    expect(erased.countOf('list')).toBe(1)
    expect(erasedHome.view().notice?.kind).toBe('erased')
  })

  it('lets a refusal that cannot change be dismissed, and brings a new failure back', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1)] })
    archive.failNext('list', new ArchiveRequestError(403, 'human_user_required', 'no'))
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    expect(home.view().notice?.kind).toBe('forbidden')
    home.dismissNotice()
    expect(home.view().notice).toBeNull()
    archive.failNext('list', new ArchiveRequestError(503, 'conversation_archive_busy', 'busy'))
    await home.retryImported()
    expect(home.view().notice?.kind).toBe('unavailable')
  })

  it('keeps the loaded imports when a later page fails, and retries that page', async () => {
    const archive = new MemoryArchive({ pageSize: 2, items: [importedItem(1), importedItem(2), importedItem(3)] })
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    archive.failNext('list')
    await home.loadMoreImported()
    expect(home.view().notice?.kind).toBe('unavailable')
    expect(home.getState().imported.items).toHaveLength(2)
    expect(home.view().hasImports).toBe(true)
    await home.retryImported()
    expect(home.getState().imported.items).toHaveLength(3)
    expect(home.view().notice).toBeNull()
  })

  it('reports a failing live list without blanking what was there, and leaves the imports alone', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 1) })] })
    const service = serviceWith(archive)
    let failing = false
    defineLive(service, () => {
      if (failing) throw new Error('graph list unavailable')
      return [live('a', at(2026, 9, 28), 'Alpha')]
    })
    const home = createConversationHomeController(service)
    await home.open()
    failing = true
    await home.refreshLive()
    const view = home.view()
    expect(view.liveError).toBe('graph list unavailable')
    expect(view.list.rows.map(row => row.title)).toEqual(['Alpha', 'Imported 1'])
  })
})

describe('paging, search and sub-agent conversations', () => {
  it('pages the archive, appends without repeating, and stops at the end', async () => {
    const archive = new MemoryArchive({ pageSize: 2, items: [1, 2, 3, 4, 5].map(n => importedItem(n)) })
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    expect(home.view().canLoadMore).toBe(true)
    await home.loadMoreImported()
    await home.loadMoreImported()
    expect(home.getState().imported.items.map(item => item.conversationId)).toEqual([1, 2, 3, 4, 5].map(cid))
    expect(home.view().canLoadMore).toBe(false)
    expect(archive.calls.filter(call => call.startsWith('list:'))).toEqual(['list:', 'list:2', 'list:4'])
    await home.loadMoreImported()
    expect(archive.countOf('list')).toBe(3)
  })

  it('never lists a conversation twice when pages overlap, and does not ask twice at once', async () => {
    const archive = new MemoryArchive({ pageSize: 2, items: [importedItem(1), importedItem(2), importedItem(3)] })
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    // Something was added in front, so the next page starts with a conversation already loaded.
    archive.items = [importedItem(0), ...archive.items]
    const release = archive.hold('list')
    const first = home.loadMoreImported()
    const second = home.loadMoreImported()
    release()
    await Promise.all([first, second])
    expect(home.getState().imported.items.map(item => item.conversationId)).toEqual([1, 2, 3].map(cid))
    expect(archive.countOf('list')).toBe(2)
  })

  it('searches titles across live and imported, flat, with accents and case folded', async () => {
    const archive = new MemoryArchive({
      items: [importedItem(1, { revision: { revisionId: '1'.padStart(64, '0'), title: 'Configuración del jardín', messageCount: 2, partCount: 2 } }), importedItem(2)],
    })
    const service = serviceWith(archive)
    defineLive(service, () => [live('l1', at(2026, 9, 28), 'Deploy to Sirin box')])
    const home = createConversationHomeController(service)
    await home.open()
    home.setQuery('CONFIGURACION')
    expect(home.view().list.searching).toBe(true)
    expect(home.view().list.rows.map(row => row.title)).toEqual(['Configuración del jardín'])
    home.setQuery('sirin')
    expect(home.view().list.rows.map(row => row.id)).toEqual(['l1'])
    home.setQuery('imported')
    expect(home.view().list.rows.map(row => row.id)).toEqual([cid(2)])
  })

  it('says how much the search covers while older chats are still unloaded', async () => {
    const archive = new MemoryArchive({ pageSize: 2, items: [1, 2, 3, 4].map(n => importedItem(n)) })
    const service = serviceWith(archive)
    defineLive(service, () => [live('l1', at(2026, 9, 28), 'Alpha')])
    const home = createConversationHomeController(service)
    await home.open()
    expect(home.view().searchNote).toBeNull()
    home.setQuery('a')
    expect(home.view().searchNote).toBe('Search covers the 3 conversations loaded so far.')
    await home.loadMoreImported()
    expect(home.view().searchNote).toBeNull()
  })

  it('filters by kind, and keeps sub-agent conversations under their parent until a search flattens them', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { lastOccurredAt: at(2026, 9, 27) }),
        importedItem(2, { lastOccurredAt: at(2026, 9, 26), parentConversationId: cid(1) }),
      ],
    })
    const service = serviceWith(archive)
    defineLive(service, () => [live('l1', at(2026, 9, 28))])
    const home = createConversationHomeController(service)
    await home.open()
    expect(home.view().list.rows.map(row => row.id)).toEqual(['l1', cid(1)])
    expect(home.view().list.rows[1].children.map(child => child.id)).toEqual([cid(2)])
    home.setFilter('imported')
    expect(home.view().list.rows.map(row => row.id)).toEqual([cid(1)])
    home.setFilter('live')
    expect(home.view().list.rows.map(row => row.id)).toEqual(['l1'])
    home.setFilter('all')
    home.setQuery('imported')
    expect(home.view().list.rows.map(row => row.id)).toEqual([cid(1), cid(2)])
    expect(home.view().list.rows.every(row => row.children.length === 0)).toBe(true)
  })

  it('remembers which parents are open, and describes one imported conversation\'s loaded family', async () => {
    const archive = new MemoryArchive({
      items: [
        importedItem(1, { lastOccurredAt: at(2026, 9, 27) }),
        importedItem(2, { lastOccurredAt: at(2026, 9, 26), parentConversationId: cid(1) }),
        importedItem(3, { lastOccurredAt: at(2026, 9, 25), parentConversationId: cid(1) }),
        importedItem(4, { parentConversationId: cid(99) }),
      ],
    })
    const home = createConversationHomeController(serviceWith(archive))
    await home.open()
    expect(home.getState().expanded.has(cid(1))).toBe(false)
    home.toggleExpanded(cid(1))
    expect(home.getState().expanded.has(cid(1))).toBe(true)
    home.toggleExpanded(cid(1))
    expect(home.getState().expanded.has(cid(1))).toBe(false)

    expect(home.familyOf(cid(1)).parent).toBeNull()
    expect(home.familyOf(cid(1)).children.map(item => item.conversationId)).toEqual([cid(3), cid(2)])
    expect(home.familyOf(cid(2)).parent?.conversationId).toBe(cid(1))
    // A parent that is not loaded is simply unknown; nothing is guessed.
    expect(home.familyOf(cid(4)).parent).toBeNull()
    expect(home.itemById(cid(3))?.revision.title).toBe('Imported 3')
    expect(home.itemById('nope')).toBeNull()
  })
})

describe('state that survives closing and reopening the drawer', () => {
  it('refreshes the live list every time but reads the archive once, and keeps query, filter and open parents', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1, { lastOccurredAt: at(2026, 9, 1) })] })
    const service = serviceWith(archive)
    const source = defineLive(service, () => [live('a', at(2026, 9, 28), 'Alpha')])
    const home = createConversationHomeController(service)
    await home.open()
    home.setQuery('imp')
    home.setFilter('imported')
    home.toggleExpanded(cid(1))
    await home.open()
    expect(source.calls()).toBe(2)
    expect(archive.countOf('list')).toBe(1)
    expect(home.getState().query).toBe('imp')
    expect(home.getState().filter).toBe('imported')
    expect(home.getState().expanded.has(cid(1))).toBe(true)
  })

  it('tells subscribers about every change, and stops when they leave', async () => {
    const home = createConversationHomeController(serviceWith(new MemoryArchive({ items: [importedItem(1)] })))
    let heard = 0
    const stop = home.subscribe(() => { heard += 1 })
    await home.open()
    const afterOpen = heard
    expect(afterOpen).toBeGreaterThan(0)
    home.setQuery('x')
    expect(heard).toBe(afterOpen + 1)
    stop()
    home.setQuery('y')
    expect(heard).toBe(afterOpen + 1)
  })

  it('ignores an answer that arrives after it was disposed', async () => {
    const archive = new MemoryArchive({ items: [importedItem(1)] })
    const home = createConversationHomeController(serviceWith(archive))
    let heard = 0
    home.subscribe(() => { heard += 1 })
    const release = archive.hold('list')
    const opening = home.open()
    const before = heard
    home.dispose()
    release()
    await opening
    expect(home.getState().imported.items).toEqual([])
    expect(heard).toBe(before)
  })
})
