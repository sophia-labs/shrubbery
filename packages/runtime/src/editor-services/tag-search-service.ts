/**
 * tag-search-service.ts — host-side tag suggestions over the workspace projection.
 *
 * The editor kernel emits only a structural `open-tag-picker` event. This
 * service owns the read side: core Garden tags plus observed `doc:hasTag`
 * values from the current graph's projection.
 */

import type { EditorScope, RestClient } from '@shrubbery/nucleus'
import {
  CORE_TAGS,
  filterTagSuggestions,
  mergeTagSources,
  type TagSuggestion,
} from '@shrubbery/editor-kernel'
import { workspaceProjectionGraphIri } from './sparql-terms.js'

interface SolutionsResult {
  rows?: Array<Record<string, string>>
}

export interface TagSearchService {
  suggest(query: string): Promise<TagSuggestion[]>
}

function unquoteLiteral(term: string): string {
  if (term[0] !== '"') return term
  let out = ''
  for (let i = 1; i < term.length; i++) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[i + 1]
      out +=
        next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''
      i++
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

export function normalizeTagSuggestionName(value: string): string | null {
  const name = unquoteLiteral(value).trim().replace(/^#/, '').toLowerCase()
  return /^[a-z0-9_-]+$/.test(name) ? name : null
}

export function tagSuggestionListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT DISTINCT ?tag',
    `WHERE { GRAPH <${ws}> {`,
    '  ?subject doc:hasTag ?tag .',
    '} }',
    'ORDER BY LCASE(STR(?tag))',
  ].join('\n')
}

export function tagSuggestionsFromRows(rows: readonly Record<string, string>[]): TagSuggestion[] {
  const tags: TagSuggestion[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.tag ? normalizeTagSuggestionName(row.tag) : null
    if (!name || seen.has(name)) continue
    seen.add(name)
    tags.push({ name, isCore: false })
  }
  return tags
}

export function makeTagSearchService(
  rest: RestClient,
  getScope: () => EditorScope,
): TagSearchService {
  return {
    async suggest(query: string): Promise<TagSuggestion[]> {
      const graphId = getScope().graphId
      if (!graphId) return filterTagSuggestions(CORE_TAGS, query)
      const result = (await rest.query(graphId, tagSuggestionListSparql(graphId))) as SolutionsResult
      return filterTagSuggestions(
        mergeTagSources(CORE_TAGS, tagSuggestionsFromRows(result.rows ?? [])),
        query,
      )
    },
  }
}
