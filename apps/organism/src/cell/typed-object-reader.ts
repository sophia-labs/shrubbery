/**
 * The typed-object reader (typed objects architecture D6, revised 14:15; `plans/2026-10-20-typed-objects`): the
 * organism's implementation of the runtime's `TypedObjectService` seam, over the cell's own MCP tools.
 *
 * - **The object**: one `sparql_query` (`objectTriplesQuery`: the subject, its nested values three levels down, the
 *   label of the being that made it, every pattern inside `GRAPH ?g`).
 * - **Its class**: Emporium's own catalogue, `emporium_vocab` (§4 "Type catalogue"). The vocabulary list (no name)
 *   names each vocabulary's namespace; the one whose namespace prefixes the class IRI is read by name, and its
 *   additive `classCatalog` gives the class entry and its siblings (for nested values). Until gardend serves
 *   `classCatalog` (a read without it gives no entries), every object draws as the generic model; the reader starts
 *   using the catalogue as soon as an answer carries it, with no change here.
 * - **Where it is used**: `objectUsageQuery` (`<block> mdoc:embeds <iri>`, the objectEmbed projection).
 * - **Typed objects to embed** (`/object`): every subject typed by a graph-defined class (`urn:sophia:type:`), with
 *   its class label and its title by the class's presentation.
 *
 * Cached per graph: the vocabulary list and each vocabulary's catalogue for a minute (a failed list for that long
 * too, so a gardend without the tool is not asked on every card), an object read for fifteen seconds (ProseMirror
 * remakes node views freely; a document that redraws must not re-query), each with its read in flight shared.
 */

import {
  type ClassCatalogEntry,
  classCatalogFrom,
  classLabelOf,
  findClassEntry,
  objectTriplesQuery,
  objectUsageQuery,
  RDFS_LABEL,
  rowTerm,
  sparqlRows,
  triplesFromRows,
  typedObjectModel,
  typedObjectSearchQuery,
  typesOf,
  type VocabSummary,
  vocabForClass,
  vocabSummaries,
  WF,
} from '@shrubbery/nucleus/object-faces'
import { localName } from '@shrubbery/nucleus/value-faces'
import type { ObjectUsage, TypedObjectRead, TypedObjectService } from '@shrubbery/runtime'

export interface McpToolPort {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

export interface TypedObjectHit {
  readonly iri: string
  readonly classIri: string
  readonly classLabel: string
  readonly title: string
}

export interface ClassLookup {
  readonly entry: ClassCatalogEntry | null
  readonly catalog: readonly ClassCatalogEntry[]
}

export interface TypedObjectReader extends TypedObjectService {
  usedIn(graphId: string, iri: string): Promise<readonly ObjectUsage[]>
  /** The class's catalogue entry and its vocabulary's other classes; null entry: no catalogue serves it yet. */
  classEntry(graphId: string, classIri: string): Promise<ClassLookup>
  /** Every typed object of the graph's own classes, for `/object`. */
  search(graphId: string): Promise<readonly TypedObjectHit[]>
  /** Drop what is cached for a graph (or all), so the next read asks the cell. */
  forget(graphId?: string): void
}

export interface TypedObjectReaderOptions {
  readonly now?: () => number
  readonly objectTtlMs?: number
  readonly vocabTtlMs?: number
}

const WF_ITEM = `${WF}Item`
const WF_UNFIT = `${WF}Unfit`

interface Entry<T> {
  readonly at: number
  readonly value: Promise<T>
}

export function makeTypedObjectReader(port: McpToolPort, options: TypedObjectReaderOptions = {}): TypedObjectReader {
  const now = options.now ?? (() => Date.now())
  const objectTtl = options.objectTtlMs ?? 15_000
  const vocabTtl = options.vocabTtlMs ?? 60_000
  const objects = new Map<string, Entry<TypedObjectRead | null>>()
  const lists = new Map<string, Entry<readonly VocabSummary[]>>()
  const catalogs = new Map<string, Entry<readonly ClassCatalogEntry[]>>()

  const cached = <T>(map: Map<string, Entry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> => {
    const hit = map.get(key)
    if (hit && now() - hit.at < ttl) return hit.value
    const value = load()
    map.set(key, { at: now(), value })
    // A failed read is not kept past its moment: the next ask tries again (a failed LIST is kept, below).
    value.catch(() => {
      if (map.get(key)?.value === value) map.delete(key)
    })
    return value
  }

  const sparql = async (graphId: string, query: string): Promise<readonly Record<string, unknown>[]> =>
    sparqlRows(await port.callTool('sparql_query', { graphId, query }))

  const vocabList = (graphId: string): Promise<readonly VocabSummary[]> =>
    cached(lists, graphId, vocabTtl, async () => {
      try {
        return vocabSummaries(await port.callTool('emporium_vocab', { graphId }))
      } catch {
        // No catalogue to read (a gardend without the tool, or one that refuses): the generic model, for a minute.
        return []
      }
    })

  const vocabCatalog = (graphId: string, vocab: VocabSummary): Promise<readonly ClassCatalogEntry[]> =>
    cached(catalogs, `${graphId}\u0000${vocab.name}\u0000${vocab.version ?? 'latest'}`, vocabTtl, async () => {
      try {
        return classCatalogFrom(await port.callTool('emporium_vocab', { graphId, name: vocab.name, ...(vocab.version ? { version: vocab.version } : {}) }))
      } catch {
        return []
      }
    })

  const classEntry = async (graphId: string, classIri: string): Promise<ClassLookup> => {
    const vocab = vocabForClass(await vocabList(graphId), classIri)
    if (!vocab) return { entry: null, catalog: [] }
    const catalog = await vocabCatalog(graphId, vocab)
    return { entry: findClassEntry(catalog, classIri), catalog }
  }

  const read = (graphId: string, iri: string): Promise<TypedObjectRead | null> =>
    cached(objects, `${graphId}\u0000${iri}`, objectTtl, async () => {
      const triples = triplesFromRows(await sparql(graphId, objectTriplesQuery(iri)))
      if (!triples.some((t) => t.s === iri)) return null
      const types = typesOf(iri, triples)
      // Its class: the first of its types a catalogue serves; the run bookkeeping types are never its class.
      for (const type of types.filter((t) => t !== WF_ITEM && t !== WF_UNFIT)) {
        const found = await classEntry(graphId, type)
        if (found.entry) return { graphId, iri, types, triples, contract: found.entry, catalog: found.catalog }
      }
      return { graphId, iri, types, triples, contract: null, catalog: [] }
    })

  const usedIn = async (graphId: string, iri: string): Promise<readonly ObjectUsage[]> => {
    const out = new Map<string, ObjectUsage>()
    for (const row of await sparql(graphId, objectUsageQuery(iri))) {
      const documentId = rowTerm(row.documentId)?.value
      if (!documentId || out.has(documentId)) continue
      const blockId = rowTerm(row.nodeId)?.value ?? null
      out.set(documentId, { documentId, blockId })
    }
    return [...out.values()]
  }

  const search = async (graphId: string): Promise<readonly TypedObjectHit[]> => {
    const rows = await sparql(graphId, typedObjectSearchQuery())
    let found = rows
      .map((row) => ({ iri: rowTerm(row.s)?.value ?? '', classIri: rowTerm(row.c)?.value ?? '' }))
      .filter((hit) => hit.iri && hit.classIri)
    // A nested value (`<parent>/<key>`) is part of its parent, not an object to embed on its own.
    const subjects = new Set(found.map((hit) => hit.iri))
    const parentOf = (iri: string): boolean => {
      for (let cut = iri.lastIndexOf('/'); cut > 0; cut = iri.lastIndexOf('/', cut - 1)) if (subjects.has(iri.slice(0, cut))) return true
      return false
    }
    found = found.filter((hit) => !parentOf(hit.iri))
    const classes = [...new Set(found.map((hit) => hit.classIri))]
    const entries = new Map<string, ClassCatalogEntry | null>()
    for (const classIri of classes) entries.set(classIri, (await classEntry(graphId, classIri)).entry)
    // Each object's title: its class's presentation title field, else a label triple.
    const titlePredicates = new Set<string>([RDFS_LABEL])
    for (const entry of entries.values()) {
      const key = entry?.presentation?.title
      const field = key ? entry?.fields.find((f) => f.key === key) : undefined
      if (field) titlePredicates.add(field.iri)
    }
    const titles = new Map<string, string>()
    if (found.length) {
      const values = [...titlePredicates].map((p) => `<${p}>`).join(' ')
      const query = `SELECT ?s ?p ?t WHERE { VALUES ?p { ${values} } GRAPH ?g { ?s a ?c ; ?p ?t FILTER(STRSTARTS(STR(?c), "urn:sophia:type:")) } } LIMIT 2000`
      for (const row of await sparql(graphId, query)) {
        const s = rowTerm(row.s)?.value
        const t = rowTerm(row.t)?.value
        if (s && t && !titles.has(s)) titles.set(s, t)
      }
    }
    // With no presentation to name a title, the object's own model does (its label, else its first short field), for the
    // first sixty; past those, the IRI's local name.
    const untitled = found.filter((hit) => !titles.has(hit.iri)).slice(0, 60)
    await Promise.all(untitled.map(async (hit) => {
      const one = await read(graphId, hit.iri).catch(() => null)
      if (one) titles.set(hit.iri, typedObjectModel(one).title)
    }))
    return found.map((hit) => ({
      ...hit,
      classLabel: classLabelOf(hit.classIri, entries.get(hit.classIri) ?? null),
      title: titles.get(hit.iri) ?? localName(hit.iri),
    }))
  }

  return {
    read,
    usedIn,
    classEntry,
    search,
    forget(graphId) {
      for (const map of [objects, lists, catalogs] as Map<string, unknown>[]) {
        for (const key of [...map.keys()]) if (!graphId || key === graphId || key.startsWith(`${graphId}\u0000`)) map.delete(key)
      }
    },
  }
}
