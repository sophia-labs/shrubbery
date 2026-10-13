/**
 * The connections between files of a graph, as the graph's own wires.
 *
 * A connection is a Garden wire (`create_wires`, read with `get_wires`, removed with `delete` of type `wires`, vocabulary from
 * `list_wire_predicates`), reached through the same cell client the rest of the Files shell uses: durable, shared with everyone who
 * can see the workspace, and visible on the other device. Nothing is kept in the browser.
 *
 * Mapping. A file's wire endpoint is its artifact id. A wire has a predicate and no label of its own, so the relation is the
 * predicate: a built-in one from the cell's vocabulary, or, for "Other...", a custom predicate minted from the words typed (the
 * cell lists custom predicates beside the built-in ones, and returns a readable label for each). Folders have no document or
 * artifact identity a wire attaches to, so a folder cannot be connected.
 */
import type { FileCanvasRelation } from '@shrubbery/nucleus'
import type { FilesClient } from './files-contract.js'

/** What the picker offers when the cell's vocabulary cannot be read (the same names the cell's built-ins use). */
export const FALLBACK_RELATIONS: readonly FileCanvasRelation[] = Object.freeze([
  { uri: 'relatedTo', label: 'is related to' }, { uri: 'supports', label: 'supports' }, { uri: 'contradicts', label: 'contradicts' },
  { uri: 'qualifies', label: 'qualifies' }, { uri: 'exemplifies', label: 'is an example of' }, { uri: 'partOf', label: 'is part of' },
  { uri: 'requires', label: 'requires' }, { uri: 'precedes', label: 'precedes' },
])

/** The built-in predicates worth a menu row, in the order they are offered. Every custom predicate in the graph follows. */
const OFFERED = ['relatedTo', 'supports', 'contradicts', 'qualifies', 'exemplifies', 'partOf', 'requires', 'causeOf', 'precedes']

export interface FileWire {
  readonly id: string
  /** Artifact ids. */
  readonly source: string
  readonly target: string
  readonly predicate: string
  readonly label: string
}

/** `isADraftOf` -> `is a draft of`. */
export function humanize(predicate: string): string {
  const short = predicate.split(/[#/]/).pop() ?? predicate
  return short.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
}

/** The words a person typed, as a camelCase predicate name: `Is a draft of` -> `isADraftOf`. */
export function customPredicate(words: string): string {
  const parts = words.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return parts.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('')
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export class FilesWires {
  constructor(private readonly client: FilesClient) {}

  /** The wires leaving any of `artifactIds` (a wire is listed once, by its source). */
  async list(graphId: string, artifactIds: readonly string[]): Promise<FileWire[]> {
    const seen = new Map<string, FileWire>()
    const reads = await Promise.all(artifactIds.map(documentId =>
      this.client.tool('get_wires', { graphId, documentId, direction: 'outgoing' }).catch((): Record<string, unknown> => ({}))))
    for (const read of reads) {
      for (const row of Array.isArray(read.wires) ? read.wires : []) {
        const w = row as Record<string, unknown>
        const id = str(w.id), source = str(w.sourceDocumentId), target = str(w.targetDocumentId)
        if (!id || !source || !target || (str(w.targetGraphId) ?? graphId) !== graphId) continue
        const predicate = str(w.predicate) ?? 'relatedTo'
        seen.set(id, { id, source, target, predicate, label: str(w.predicateLabel) ?? humanize(predicate) })
      }
    }
    return [...seen.values()]
  }

  /** Every wire at one item, both directions (a wire is listed once). */
  async around(graphId: string, artifactId: string): Promise<FileWire[]> {
    const read = await this.client.tool('get_wires', { graphId, documentId: artifactId, direction: 'both' }).catch((): Record<string, unknown> => ({}))
    const seen = new Map<string, FileWire>()
    for (const row of Array.isArray(read.wires) ? read.wires : []) {
      const w = row as Record<string, unknown>
      const id = str(w.id), source = str(w.sourceDocumentId), target = str(w.targetDocumentId)
      if (!id || !source || !target || (str(w.targetGraphId) ?? graphId) !== graphId) continue
      const predicate = str(w.predicate) ?? 'relatedTo'
      seen.set(id, { id, source, target, predicate, label: str(w.predicateLabel) ?? humanize(predicate) })
    }
    return [...seen.values()]
  }

  async relations(graphId: string): Promise<FileCanvasRelation[]> {
    try {
      const read = await this.client.tool('list_wire_predicates', { graphId })
      const all = (Array.isArray(read.predicates) ? read.predicates : []).flatMap(row => {
        const p = row as Record<string, unknown>
        return str(p.name) ? [{ uri: str(p.name)!, label: str(p.label) ?? humanize(str(p.name)!), category: str(p.category) }] : []
      })
      const offered = OFFERED.flatMap(name => all.filter(p => p.uri === name))
      const custom = all.filter(p => p.category === 'Custom')
      const out = [...offered, ...custom].map(({ uri, label }) => ({ uri, label }))
      return out.length ? out : [...FALLBACK_RELATIONS]
    } catch { return [...FALLBACK_RELATIONS] }
  }

  async create(graphId: string, graphIncarnation: string, wire: { id: string; source: string; target: string; predicate: string }): Promise<void> {
    await this.client.tool('create_wires', { graphId, ...(graphIncarnation ? { graphIncarnation } : {}),
      wires: [{ wireId: wire.id, sourceDocumentId: wire.source, targetDocumentId: wire.target, targetGraphId: graphId, predicate: wire.predicate, bidirectional: false }] })
  }

  async delete(graphId: string, wireId: string): Promise<void> {
    await this.client.tool('delete', { graphId, type: 'wires', wireId })
  }
}
