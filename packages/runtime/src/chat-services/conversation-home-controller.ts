/**
 * conversation-home-controller.ts — the data behind ONE conversation home.
 *
 * The Chat history drawer shows every conversation the person has, live and
 * imported, in one list. This controller owns what that list is made of: the live
 * source (the ChatService), the imported source (the account archive), the search
 * box, the filter and which parents are open. It touches no DOM. It lives as long
 * as the ChatService it was made for, so closing the drawer and opening it again
 * keeps the person's place, and the archive is read once, not once per opening.
 *
 * Rules carried here:
 *   - The two sources fail apart. A refused archive never takes the live list with
 *     it, and a failing live list never blanks the imports (or the other way round).
 *   - Every refusal is described by its own status (see describeArchiveFailure);
 *     none becomes a generic "could not be loaded".
 *   - With no imports there is no Imported section, no filter, and no sentence
 *     about imports: the list is simply the person's chats.
 *   - A late answer is never applied after the controller is disposed.
 */

import type { ChatService } from './chat-service.js'
import type { ArchivedConversation } from './conversation-archive.js'
import {
  buildHomeList,
  describeArchiveFailure,
  listLiveConversations,
  normalizeSearch,
  parseIso,
  type ArchiveFailure,
  type ConversationSummary,
  type HomeFilter,
  type HomeList,
} from './conversation-home.js'

export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface LiveLoad {
  readonly phase: LoadPhase
  readonly items: readonly ConversationSummary[]
  readonly error: string | null
}

export interface ImportedLoad {
  /** The state of the latest request, first page or later. */
  readonly phase: LoadPhase
  readonly items: readonly ArchivedConversation[]
  readonly nextCursor: string | null
  readonly failure: ArchiveFailure | null
  /** A first page has been read successfully at least once. */
  readonly loadedOnce: boolean
}

export interface ConversationHomeState {
  readonly live: LiveLoad
  readonly imported: ImportedLoad
  readonly query: string
  readonly filter: HomeFilter
  /** Ids of the parents whose sub-agent conversations are showing. */
  readonly expanded: ReadonlySet<string>
  readonly noticeDismissed: boolean
}

export interface ConversationHomeView {
  readonly list: HomeList
  readonly archiveAvailable: boolean
  /** At least one import is loaded: only then do the Imported filter and its words exist. */
  readonly hasImports: boolean
  readonly showFilter: boolean
  /** What the archive refused, in its own words; null when nothing is refused or it was dismissed. */
  readonly notice: ArchiveFailure | null
  readonly liveError: string | null
  /** Nothing to show yet, and something is on its way. */
  readonly loadingFirst: boolean
  readonly canLoadMore: boolean
  readonly loadingMore: boolean
  /** While searching with older chats still unloaded: how much the search covers. */
  readonly searchNote: string | null
  /** There is truly nothing: both sources answered, both are empty, nothing failed. */
  readonly empty: boolean
}

export interface ConversationFamily {
  readonly parent: ArchivedConversation | null
  /** Direct sub-agent conversations that are loaded, oldest first. */
  readonly children: readonly ArchivedConversation[]
}

export interface ConversationHomeController {
  getState(): ConversationHomeState
  view(): ConversationHomeView
  subscribe(listener: () => void): () => void
  /** Called every time the drawer opens: refreshes the live list, reads the archive if it never was. */
  open(): Promise<void>
  refreshLive(): Promise<void>
  loadMoreImported(): Promise<void>
  /** Asks again for the page that failed (the first, or the next). */
  retryImported(): Promise<void>
  setQuery(query: string): void
  setFilter(filter: HomeFilter): void
  toggleExpanded(conversationId: string): void
  dismissNotice(): void
  itemById(conversationId: string): ArchivedConversation | null
  familyOf(conversationId: string): ConversationFamily
  dispose(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createConversationHomeController(service: ChatService): ConversationHomeController {
  const archive = service.archive ?? null
  let disposed = false
  let liveGeneration = 0
  let importedInFlight: Promise<void> | null = null
  let state: ConversationHomeState = {
    live: { phase: 'idle', items: [], error: null },
    imported: { phase: 'idle', items: [], nextCursor: null, failure: null, loadedOnce: false },
    query: '',
    filter: 'all',
    expanded: new Set<string>(),
    noticeDismissed: false,
  }
  const listeners = new Set<() => void>()

  function commit(next: Partial<ConversationHomeState>): void {
    if (disposed) return
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener()
  }

  async function refreshLive(): Promise<void> {
    if (disposed) return
    const generation = ++liveGeneration
    commit({ live: { ...state.live, phase: 'loading', error: null } })
    try {
      const items = await listLiveConversations(service)
      if (disposed || generation !== liveGeneration) return
      commit({ live: { phase: 'ready', items, error: null } })
    } catch (error) {
      if (disposed || generation !== liveGeneration) return
      // What was listed before stays on screen; the failure is said beside it.
      commit({ live: { phase: 'error', items: state.live.items, error: messageOf(error) } })
    }
  }

  /** `restart`: the first page read again in place of a list that could not be continued; it replaces what was loaded. */
  async function fetchImportedPage(cursor: string | null, restart = false): Promise<void> {
    if (!archive) return
    commit({ imported: { ...state.imported, phase: 'loading', failure: null } })
    try {
      const page = await archive.list(cursor ?? undefined)
      if (disposed) return
      const known = new Set(restart ? [] : state.imported.items.map(item => item.conversationId))
      const fresh = page.items.filter(item => !known.has(item.conversationId))
      commit({
        imported: { phase: 'ready', items: restart ? fresh : [...state.imported.items, ...fresh], nextCursor: page.nextCursor, failure: null, loadedOnce: true },
      })
    } catch (error) {
      if (disposed) return
      const failure = describeArchiveFailure(error)
      // A recency cursor the gateway can no longer continue (the derived rows it orders by changed under a list being
      // read: the backfill ran, or the gateway was rolled back) is answered 409 `conversation_archive_cursor_expired`, and
      // the list is to start again from its first page (`G-gateway-return.md` 1.1). Do that, once, in place of a failure no
      // "Try again" could ever clear; what was on screen stays until the first page arrives, and replaces it.
      if (cursor !== null && !restart && failure.status === 409 && failure.code === 'conversation_archive_cursor_expired') {
        return fetchImportedPage(null, true)
      }
      // Whatever was loaded stays; a new failure is news again, even if the last was dismissed.
      commit({ imported: { ...state.imported, phase: 'error', failure }, noticeDismissed: false })
    }
  }

  /** One archive request at a time: a second ask joins the first. */
  function loadImportedPage(cursor: string | null): Promise<void> {
    if (!archive || disposed) return Promise.resolve()
    if (importedInFlight) return importedInFlight
    const run = fetchImportedPage(cursor)
    importedInFlight = run
    void run.then(() => { if (importedInFlight === run) importedInFlight = null })
    return run
  }

  function ensureImported(): Promise<void> {
    if (!archive) return Promise.resolve()
    const { phase, failure, loadedOnce } = state.imported
    if (phase === 'loading') return importedInFlight ?? Promise.resolve()
    // A first page that failed for a reason that can pass is asked again; a refusal that cannot change is not.
    if (!loadedOnce && (phase === 'idle' || (phase === 'error' && failure?.retryable === true))) return loadImportedPage(null)
    return Promise.resolve()
  }

  function open(): Promise<void> {
    if (disposed) return Promise.resolve()
    const live = refreshLive()
    const imported = ensureImported()
    return Promise.all([live, imported]).then(() => undefined)
  }

  function loadMoreImported(): Promise<void> {
    if (!archive || disposed) return Promise.resolve()
    if (importedInFlight) return importedInFlight
    const cursor = state.imported.nextCursor
    return cursor === null ? Promise.resolve() : loadImportedPage(cursor)
  }

  function retryImported(): Promise<void> {
    if (!archive || disposed) return Promise.resolve()
    if (importedInFlight) return importedInFlight
    const { loadedOnce, nextCursor } = state.imported
    if (loadedOnce) return nextCursor === null ? Promise.resolve() : loadImportedPage(nextCursor)
    return loadImportedPage(null)
  }

  function view(): ConversationHomeView {
    const { live, imported, query, filter, noticeDismissed } = state
    const hasImports = imported.items.length > 0
    const list = buildHomeList({ live: live.items, imported: imported.items, query, filter: hasImports ? filter : 'all' })
    const notice = imported.failure && !noticeDismissed ? imported.failure : null
    const anythingLoaded = live.items.length > 0 || imported.items.length > 0
    const loading = live.phase === 'loading' || imported.phase === 'loading'
    const settled = live.phase !== 'idle' && live.phase !== 'loading'
      && imported.phase !== 'loading' && (archive ? imported.phase !== 'idle' : true)
    const canLoadMore = imported.nextCursor !== null
    const loaded = live.items.length + imported.items.length
    return {
      list,
      archiveAvailable: archive !== null,
      hasImports,
      showFilter: hasImports,
      notice,
      liveError: live.error,
      loadingFirst: !anythingLoaded && loading,
      canLoadMore,
      loadingMore: imported.phase === 'loading' && imported.loadedOnce,
      searchNote: normalizeSearch(query) !== '' && canLoadMore
        ? `Search covers the ${loaded} conversation${loaded === 1 ? '' : 's'} loaded so far.`
        : null,
      empty: settled && !anythingLoaded && notice === null && live.error === null,
    }
  }

  function itemById(conversationId: string): ArchivedConversation | null {
    return state.imported.items.find(item => item.conversationId === conversationId) ?? null
  }

  function familyOf(conversationId: string): ConversationFamily {
    const item = itemById(conversationId)
    const parent = item?.parentConversationId ? itemById(item.parentConversationId) : null
    const children = state.imported.items
      .map((child, index) => ({ child, index, time: parseIso(child.lastOccurredAt ?? child.firstOccurredAt) }))
      .filter(entry => entry.child.parentConversationId === conversationId)
      .sort((a, b) => {
        if (a.time === null && b.time === null) return a.index - b.index
        if (a.time === null) return 1
        if (b.time === null) return -1
        return a.time - b.time || a.index - b.index
      })
      .map(entry => entry.child)
    return { parent, children }
  }

  return {
    getState: () => state,
    view,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open,
    refreshLive,
    loadMoreImported,
    retryImported,
    setQuery(query) {
      if (query !== state.query) commit({ query })
    },
    setFilter(filter) {
      if (filter !== state.filter) commit({ filter })
    },
    toggleExpanded(conversationId) {
      const expanded = new Set(state.expanded)
      if (expanded.has(conversationId)) expanded.delete(conversationId)
      else expanded.add(conversationId)
      commit({ expanded })
    },
    dismissNotice() {
      if (!state.noticeDismissed) commit({ noticeDismissed: true })
    },
    itemById,
    familyOf,
    dispose() {
      disposed = true
      listeners.clear()
    },
  }
}
