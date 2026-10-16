/**
 * TipTap Search Extension
 *
 * Provides in-document search with highlighting via ProseMirror decorations.
 * Highlights all matches and allows navigating between them.
 *
 * Bringing the current match into view is this plugin's job, not
 * `tr.scrollIntoView()`'s. ProseMirror only scrolls to the selection when the
 * DOM selection is inside the editor (prosemirror-view scrollToSelection), and
 * while you type in the find bar it is in the find bar's input. So every
 * command that moves to a match marks the transaction `reveal`, and the plugin
 * view scrolls the current match's decoration into view after the update.
 *
 * The scroll runs after ProseMirror's update finishes, never inside it. Plugin
 * views update inside updateStateInner, and right after them ProseMirror puts
 * the scroll position back where it was before the redraw (resetScrollPos ->
 * restoreScrollStack, which keeps the text under the viewport from jumping).
 * In Safari and the desktop app's WKWebView that restore found its anchor
 * inside the editor's shadow root and undid every reveal: the match far down
 * the page stayed off screen until find closed (2026-10-07).
 * Chromium, Firefox and Playwright's WebKit did not restore, so their tests
 * passed. The scroll sets the container's scrollTop, found by a walk that
 * crosses shadow roots.
 *
 * Folded outliner blocks are hidden (display: none), so a match inside one has
 * nothing to scroll to. Typing never edits the document: while you type, the
 * current match is the first one outside any fold. Moving to a match on
 * purpose (next, previous, go-to, replace) opens the folds above it, the same
 * edit as clicking their fold arrows.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findParentIndex, getHiddenIndexSet, getOutlinerBlocks, isCollapsed } from '../outliner-tree'

/** The nearest ancestor that scrolls vertically, crossing shadow roots. */
export function scrollContainerOf(element: Element): HTMLElement | null {
  let node: Element | null = element.parentElement ?? ((element.getRootNode() as ShadowRoot).host ?? null)
  while (node) {
    if (node instanceof HTMLElement) {
      const overflowY = getComputedStyle(node).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    }
    node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host ?? null)
  }
  return null
}

/** Centre `element` in its scroll container by setting scrollTop directly. */
export function revealInScrollContainer(element: HTMLElement): void {
  const container = scrollContainerOf(element)
  if (!container) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    return
  }
  const target = element.getBoundingClientRect()
  const box = container.getBoundingClientRect()
  const offset = target.top - box.top - (container.clientHeight - target.height) / 2
  const max = container.scrollHeight - container.clientHeight
  container.scrollTop = Math.max(0, Math.min(max, container.scrollTop + offset))
}

export interface SearchOptions {
  searchTerm: string
  caseSensitive: boolean
  currentIndex: number
}

export interface SearchResult {
  from: number
  to: number
}

export interface SearchStorage {
  results: SearchResult[]
  currentIndex: number
}

export const searchPluginKey = new PluginKey('search')

/**
 * Find all occurrences of a search term in the document.
 */
function findMatches(doc: any, searchTerm: string, caseSensitive: boolean): SearchResult[] {
  if (!searchTerm || searchTerm.length === 0) {
    return []
  }

  const results: SearchResult[] = []
  const normalizedSearch = caseSensitive ? searchTerm : searchTerm.toLowerCase()

  doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      const text = caseSensitive ? node.text : node.text.toLowerCase()
      let index = 0

      while ((index = text.indexOf(normalizedSearch, index)) !== -1) {
        results.push({
          from: pos + index,
          to: pos + index + searchTerm.length,
        })
        index += 1 // Move forward to find overlapping matches
      }
    }
  })

  return results
}

/** Index of the outliner block holding `pos`, or -1. */
function blockIndexAt(blocks: ReturnType<typeof getOutlinerBlocks>, pos: number): number {
  return blocks.findIndex(block => block.pos <= pos && pos < block.end)
}

/** The first result not hidden inside a folded block, or 0 when all are. */
function firstVisibleResult(doc: any, results: SearchResult[]): number {
  const blocks = getOutlinerBlocks(doc)
  const hidden = getHiddenIndexSet(blocks)
  if (hidden.size === 0) return 0
  const index = results.findIndex(result => !hidden.has(blockIndexAt(blocks, result.from)))
  return index === -1 ? 0 : index
}

/** Open every folded ancestor of the block holding `pos`. */
function unfoldAround(tr: Transaction, pos: number): void {
  const blocks = getOutlinerBlocks(tr.doc)
  const index = blockIndexAt(blocks, pos)
  if (index === -1) return
  for (let parent = findParentIndex(blocks, index); parent !== -1; parent = findParentIndex(blocks, parent)) {
    const block = blocks[parent]!
    if (isCollapsed(block.node)) tr.setNodeMarkup(block.pos, null, { ...block.node.attrs, collapsed: false })
  }
}

/** Select the match at `pos` after opening the folds that hide it. */
function moveToMatch(tr: Transaction, pos: number): void {
  unfoldAround(tr, pos)
  tr.setSelection(TextSelection.create(tr.doc, pos))
}

/**
 * Create decorations for all search matches.
 */
function createDecorations(
  doc: any,
  results: SearchResult[],
  currentIndex: number
): DecorationSet {
  const decorations: Decoration[] = results.map((result, index) => {
    const isCurrentMatch = index === currentIndex
    return Decoration.inline(result.from, result.to, {
      class: isCurrentMatch ? 'search-match search-match-current' : 'search-match',
    })
  })

  return DecorationSet.create(doc, decorations)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      /**
       * Set the search term and find all matches.
       */
      setSearchTerm: (searchTerm: string, caseSensitive?: boolean) => ReturnType
      /**
       * Clear the search.
       */
      clearSearch: () => ReturnType
      /**
       * Go to the next search result.
       */
      nextSearchResult: () => ReturnType
      /**
       * Go to the previous search result.
       */
      prevSearchResult: () => ReturnType
      /**
       * Go to a specific search result by index.
       */
      goToSearchResult: (index: number) => ReturnType
      /**
       * Replace the current search result.
       */
      replaceCurrentSearchResult: (replaceWith: string) => ReturnType
      /**
       * Replace all search results.
       */
      replaceAllSearchResults: (replaceWith: string) => ReturnType
    }
  }
}

export const Search = Extension.create<SearchOptions, SearchStorage>({
  name: 'search',

  addOptions() {
    return {
      searchTerm: '',
      caseSensitive: false,
      currentIndex: 0,
    }
  },

  addStorage() {
    return {
      results: [],
      currentIndex: 0,
    }
  },

  addCommands() {
    return {
      setSearchTerm:
        (searchTerm: string, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          const results = findMatches(tr.doc, searchTerm, caseSensitive)

          this.storage.results = results
          this.storage.currentIndex = results.length > 0 ? firstVisibleResult(tr.doc, results) : -1

          tr.setMeta(searchPluginKey, {
            searchTerm,
            caseSensitive,
            results,
            currentIndex: this.storage.currentIndex,
            reveal: true,
          })

          // Move selection and scroll in the same transaction
          if (results.length > 0) {
            const firstResult = results[this.storage.currentIndex]!
            tr.setSelection(TextSelection.create(tr.doc, firstResult.from))
          }

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          this.storage.results = []
          this.storage.currentIndex = -1

          if (dispatch) {
            tr.setMeta(searchPluginKey, {
              searchTerm: '',
              results: [],
              currentIndex: -1,
            })
            dispatch(tr)
          }

          return true
        },

      nextSearchResult:
        () =>
        ({ tr, dispatch }) => {
          const results = this.storage.results
          if (results.length === 0) return false

          let nextIndex = this.storage.currentIndex + 1
          if (nextIndex >= results.length) {
            nextIndex = 0 // Wrap around
          }

          this.storage.currentIndex = nextIndex

          tr.setMeta(searchPluginKey, {
            results,
            currentIndex: nextIndex,
            reveal: true,
          })

          const result = results[nextIndex]
          moveToMatch(tr, result.from)

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },

      prevSearchResult:
        () =>
        ({ tr, dispatch }) => {
          const results = this.storage.results
          if (results.length === 0) return false

          let prevIndex = this.storage.currentIndex - 1
          if (prevIndex < 0) {
            prevIndex = results.length - 1 // Wrap around
          }

          this.storage.currentIndex = prevIndex

          tr.setMeta(searchPluginKey, {
            results,
            currentIndex: prevIndex,
            reveal: true,
          })

          const result = results[prevIndex]
          moveToMatch(tr, result.from)

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },

      goToSearchResult:
        (index: number) =>
        ({ tr, dispatch }) => {
          const results = this.storage.results
          if (results.length === 0 || index < 0 || index >= results.length) {
            return false
          }

          this.storage.currentIndex = index

          tr.setMeta(searchPluginKey, {
            results,
            currentIndex: index,
            reveal: true,
          })

          const result = results[index]
          moveToMatch(tr, result.from)

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },

      replaceCurrentSearchResult:
        (replaceWith: string) =>
        ({ state, tr, dispatch }) => {
          const results = this.storage.results
          if (results.length === 0) return false

          const currentIndex = this.storage.currentIndex
          if (currentIndex < 0 || currentIndex >= results.length) return false

          const pluginState = searchPluginKey.getState(state) as
            | { searchTerm?: string; caseSensitive?: boolean }
            | undefined
          const searchTerm = pluginState?.searchTerm ?? ''
          const caseSensitive = pluginState?.caseSensitive ?? false
          if (!searchTerm) return false

          const result = results[currentIndex]
          tr.insertText(replaceWith, result.from, result.to)

          const updatedResults = findMatches(tr.doc, searchTerm, caseSensitive)
          let nextIndex = currentIndex
          if (nextIndex >= updatedResults.length) nextIndex = updatedResults.length - 1
          if (nextIndex < 0 && updatedResults.length > 0) nextIndex = 0

          this.storage.results = updatedResults
          this.storage.currentIndex = nextIndex

          tr.setMeta(searchPluginKey, {
            searchTerm,
            caseSensitive,
            results: updatedResults,
            currentIndex: nextIndex,
            reveal: true,
          })

          if (nextIndex >= 0 && updatedResults[nextIndex]) {
            moveToMatch(tr, updatedResults[nextIndex].from)
          }

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },

      replaceAllSearchResults:
        (replaceWith: string) =>
        ({ state, tr, dispatch }) => {
          const results = this.storage.results
          if (results.length === 0) return false

          const pluginState = searchPluginKey.getState(state) as
            | { searchTerm?: string; caseSensitive?: boolean }
            | undefined
          const searchTerm = pluginState?.searchTerm ?? ''
          const caseSensitive = pluginState?.caseSensitive ?? false
          if (!searchTerm) return false

          const sortedResults = [...results].sort((a, b) => b.from - a.from)
          for (const result of sortedResults) {
            tr.insertText(replaceWith, result.from, result.to)
          }

          const updatedResults = findMatches(tr.doc, searchTerm, caseSensitive)
          const nextIndex = updatedResults.length > 0 ? 0 : -1

          this.storage.results = updatedResults
          this.storage.currentIndex = nextIndex

          tr.setMeta(searchPluginKey, {
            searchTerm,
            caseSensitive,
            results: updatedResults,
            currentIndex: nextIndex,
            reveal: true,
          })

          if (nextIndex >= 0 && updatedResults[nextIndex]) {
            moveToMatch(tr, updatedResults[nextIndex].from)
          }

          if (dispatch) {
            dispatch(tr)
          }

          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: searchPluginKey,
        view: () => ({
          update(view, prevState) {
            const next = searchPluginKey.getState(view.state) as { revealSeq?: number } | undefined
            const prev = searchPluginKey.getState(prevState) as { revealSeq?: number } | undefined
            if (!next?.revealSeq || next.revealSeq === prev?.revealSeq) return
            // After the update: see the header on resetScrollPos.
            queueMicrotask(() => {
              const current = view.dom.querySelector('.search-match-current')
              if (current instanceof HTMLElement) revealInScrollContainer(current)
            })
          },
        }),
        state: {
          init() {
            return {
              searchTerm: '',
              caseSensitive: false,
              results: [] as SearchResult[],
              currentIndex: -1,
              revealSeq: 0,
              decorations: DecorationSet.empty,
            }
          },
          apply(tr, state, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey)

            if (meta) {
              // Search term or results changed
              const decorations = createDecorations(
                newState.doc,
                meta.results || [],
                meta.currentIndex ?? -1
              )
              const { reveal, ...rest } = meta
              return {
                ...state,
                ...rest,
                revealSeq: reveal ? state.revealSeq + 1 : state.revealSeq,
                decorations,
              }
            }

            // Document changed - re-run search if we have a term
            if (tr.docChanged && state.searchTerm) {
              const results = findMatches(newState.doc, state.searchTerm, state.caseSensitive)
              extension.storage.results = results

              // Try to keep current index valid
              let currentIndex = state.currentIndex
              if (currentIndex >= results.length) {
                currentIndex = results.length - 1
              }
              if (currentIndex < 0 && results.length > 0) {
                currentIndex = 0
              }
              extension.storage.currentIndex = currentIndex

              const decorations = createDecorations(newState.doc, results, currentIndex)
              return {
                ...state,
                results,
                currentIndex,
                decorations,
              }
            }

            // Map decorations through document changes
            if (tr.docChanged) {
              return {
                ...state,
                decorations: state.decorations.map(tr.mapping, tr.doc),
              }
            }

            return state
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

export default Search
