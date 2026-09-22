/**
 * Pure helpers for host-owned tag autocomplete.
 *
 * Garden's full TagSuggestion extension owns a popup and custom-tag fetcher, so
 * the extension itself remains outside the pure kernel. These helpers are the
 * backend-free part of that flow: core tag vocabulary, filtering, and the
 * heading-safe `#` trigger gate from the outliner-audit PR.
 */

export interface TagSuggestion {
  /** Lowercase tag name, without the leading "#". */
  readonly name: string
  /** One-line secondary copy for suggestion UIs. */
  readonly description?: string
  /** Whether this is one of Garden's built-in tags. */
  readonly isCore: boolean
}

export const CORE_TAGS: readonly TagSuggestion[] = [
  {
    name: 'event',
    description: 'A scheduled happening, with a date.',
    isCore: true,
  },
  {
    name: 'todo',
    description: 'An action item.',
    isCore: true,
  },
  {
    name: 'decision',
    description: 'A choice made, with rationale captured.',
    isCore: true,
  },
  {
    name: 'tension',
    description: 'An unresolved contradiction or open problem.',
    isCore: true,
  },
  {
    name: 'pragma',
    description: 'Operational knowledge: deploy, debug, configure.',
    isCore: true,
  },
]

export function isValidTagQuery(query: string): boolean {
  if (query === '') return true
  return /^[a-zA-Z0-9_-]+$/.test(query)
}

/**
 * Should a tag autocomplete open for the matched trigger text?
 *
 * Suppress bare "#", "##", and "# " so Markdown heading input rules keep
 * priority. Open only once the user has typed at least one valid tag-name
 * character after "#".
 */
export function shouldShowTagSuggestion(matchedText: string): boolean {
  const query = matchedText.startsWith('#') ? matchedText.slice(1) : matchedText
  return query.length >= 1 && isValidTagQuery(query)
}

export function filterTagSuggestions(
  items: readonly TagSuggestion[],
  query: string,
): TagSuggestion[] {
  if (!query) return [...items]
  const q = query.toLowerCase()
  const prefix: TagSuggestion[] = []
  const substring: TagSuggestion[] = []
  for (const item of items) {
    const name = item.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(item)
    else if (name.includes(q)) substring.push(item)
  }
  return [...prefix, ...substring]
}

export function mergeTagSources(
  core: readonly TagSuggestion[],
  custom: readonly TagSuggestion[],
): TagSuggestion[] {
  const byName = new Map<string, TagSuggestion>()
  for (const item of core) byName.set(item.name, item)
  for (const item of custom) {
    const existing = byName.get(item.name)
    if (existing) {
      byName.set(item.name, {
        ...existing,
        description: item.description || existing.description,
      })
    } else {
      byName.set(item.name, item)
    }
  }
  return [...byName.values()]
}
