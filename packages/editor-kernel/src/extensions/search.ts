/**
 * TipTap Search Extension
 *
 * Provides in-document search with highlighting via ProseMirror decorations.
 * Highlights all matches and allows navigating between them.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
          this.storage.currentIndex = results.length > 0 ? 0 : -1

          tr.setMeta(searchPluginKey, {
            searchTerm,
            caseSensitive,
            results,
            currentIndex: this.storage.currentIndex,
          })

          // Move selection and scroll in the same transaction
          if (results.length > 0) {
            const firstResult = results[0]
            tr.setSelection(TextSelection.create(tr.doc, firstResult.from))
            tr.scrollIntoView()
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
          })

          const result = results[nextIndex]
          tr.setSelection(TextSelection.create(tr.doc, result.from))
          tr.scrollIntoView()

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
          })

          const result = results[prevIndex]
          tr.setSelection(TextSelection.create(tr.doc, result.from))
          tr.scrollIntoView()

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
          })

          const result = results[index]
          tr.setSelection(TextSelection.create(tr.doc, result.from))
          tr.scrollIntoView()

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
          })

          if (nextIndex >= 0 && updatedResults[nextIndex]) {
            tr.setSelection(TextSelection.create(tr.doc, updatedResults[nextIndex].from))
            tr.scrollIntoView()
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
          })

          if (nextIndex >= 0 && updatedResults[nextIndex]) {
            tr.setSelection(TextSelection.create(tr.doc, updatedResults[nextIndex].from))
            tr.scrollIntoView()
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
        state: {
          init() {
            return {
              searchTerm: '',
              caseSensitive: false,
              results: [] as SearchResult[],
              currentIndex: -1,
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
              return {
                ...state,
                ...meta,
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
