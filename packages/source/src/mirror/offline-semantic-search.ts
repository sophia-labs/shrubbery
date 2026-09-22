import type { SourceSemanticCorpusEntry } from './source-mirror.js'

/**
 * Browser-safe, source-derived retrieval for a complete mirror epoch.
 *
 * This deliberately has no model or network dependency. It combines BM25
 * term evidence with a deterministic hashed word/character feature space, so
 * it remains useful for phrases, morphology, and small spelling differences
 * while partitioned. The index is disposable: callers rebuild it whenever
 * the enclosing source epoch changes.
 */

export interface OfflineSemanticSearchHit {
  readonly documentId: string
  readonly documentTitle: string
  readonly blockId: string
  readonly blockType: string
  readonly content: string
  readonly score: number
  readonly order: number
  readonly matchSource: 'offline-hybrid'
}

interface IndexedEntry {
  readonly source: SourceSemanticCorpusEntry
  readonly normalized: string
  readonly titleNormalized: string
  readonly tokens: readonly string[]
  readonly frequencies: ReadonlyMap<string, number>
  readonly vector: Float32Array
}

const VECTOR_DIMENSIONS = 512
const BM25_K1 = 1.2
const BM25_B = 0.75

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function stem(token: string): string {
  if (token.length <= 4) return token
  for (const suffix of ['ingly', 'edly', 'ation', 'ments', 'ment', 'ness', 'ing', 'ers', 'ies', 'ied', 'ed', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      if (suffix === 'ies' || suffix === 'ied') return `${token.slice(0, -suffix.length)}y`
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

function tokensOf(value: string): string[] {
  const normalized = normalizedText(value)
  if (!normalized) return []
  return normalized.split(' ').flatMap(token => {
    const root = stem(token)
    return root === token ? [token] : [token, root]
  })
}

function hashFeature(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function addFeature(vector: Float32Array, feature: string, weight: number): void {
  const hash = hashFeature(feature)
  const index = hash % VECTOR_DIMENSIONS
  vector[index] = (vector[index] ?? 0) + ((hash & 0x80000000) === 0 ? weight : -weight)
}

function featureVector(value: string): Float32Array {
  const normalized = normalizedText(value)
  const tokens = normalized ? normalized.split(' ') : []
  const vector = new Float32Array(VECTOR_DIMENSIONS)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    addFeature(vector, `w:${token}`, 1)
    const root = stem(token)
    if (root !== token) addFeature(vector, `s:${root}`, 0.75)
    if (index + 1 < tokens.length) addFeature(vector, `b:${token} ${tokens[index + 1]}`, 0.7)
    const padded = `  ${token}  `
    for (let offset = 0; offset + 3 <= padded.length; offset += 1) {
      addFeature(vector, `c:${padded.slice(offset, offset + 3)}`, 0.18)
    }
  }
  let magnitude = 0
  for (const component of vector) magnitude += component * component
  if (magnitude > 0) {
    const inverse = 1 / Math.sqrt(magnitude)
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = (vector[index] ?? 0) * inverse
    }
  }
  return vector
}

function cosine(left: Float32Array, right: Float32Array): number {
  let score = 0
  for (let index = 0; index < left.length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0)
  }
  return score
}

function frequencies(tokens: readonly string[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>()
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1)
  return result
}

export class OfflineSemanticSearchIndex {
  private readonly entries: readonly IndexedEntry[]
  private readonly documentFrequency = new Map<string, number>()
  private readonly averageLength: number

  constructor(corpus: readonly SourceSemanticCorpusEntry[]) {
    this.entries = corpus.map(source => {
      const tokens = tokensOf(`${source.documentTitle} ${source.content}`)
      const entry: IndexedEntry = {
        source,
        normalized: normalizedText(source.content),
        titleNormalized: normalizedText(source.documentTitle),
        tokens,
        frequencies: frequencies(tokens),
        vector: featureVector(`${source.documentTitle} ${source.content}`),
      }
      for (const token of new Set(tokens)) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1)
      }
      return entry
    })
    this.averageLength = this.entries.length === 0
      ? 1
      : this.entries.reduce((sum, entry) => sum + entry.tokens.length, 0) / this.entries.length
  }

  search(query: string, limit = 20): readonly OfflineSemanticSearchHit[] {
    const normalizedQuery = normalizedText(query)
    if (!normalizedQuery || limit <= 0 || this.entries.length === 0) return []
    const queryTokens = [...new Set(tokensOf(query))]
    const queryVector = featureVector(query)
    const count = this.entries.length
    const ranked = this.entries.map(entry => {
      let bm25 = 0
      for (const token of queryTokens) {
        const tf = entry.frequencies.get(token) ?? 0
        if (tf === 0) continue
        const df = this.documentFrequency.get(token) ?? 0
        const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5))
        const lengthNorm = 1 - BM25_B + BM25_B * entry.tokens.length / this.averageLength
        bm25 += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm)
      }
      const fuzzy = Math.max(0, cosine(queryVector, entry.vector))
      const phrase = entry.normalized.includes(normalizedQuery) ? 1 : 0
      const title = entry.titleNormalized.includes(normalizedQuery) ? 0.6 : 0
      return { entry, score: bm25 + fuzzy * 0.8 + phrase + title }
    })
    ranked.sort((left, right) =>
      right.score - left.score
      || left.entry.source.documentId.localeCompare(right.entry.source.documentId)
      || left.entry.source.order - right.entry.source.order
      || left.entry.source.blockId.localeCompare(right.entry.source.blockId))
    return ranked
      .filter(candidate => candidate.score > 0)
      .slice(0, Math.min(100, Math.floor(limit)))
      .map(({ entry, score }) => ({
        documentId: entry.source.documentId,
        documentTitle: entry.source.documentTitle,
        blockId: entry.source.blockId,
        blockType: entry.source.blockType,
        content: entry.source.content,
        score,
        order: entry.source.order,
        matchSource: 'offline-hybrid' as const,
      }))
  }
}

export function searchOfflineSemanticCorpus(
  corpus: readonly SourceSemanticCorpusEntry[],
  query: string,
  limit = 20,
): readonly OfflineSemanticSearchHit[] {
  return new OfflineSemanticSearchIndex(corpus).search(query, limit)
}
