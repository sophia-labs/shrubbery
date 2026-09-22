/** Graph-scoped home activity persisted by the shell, never inferred by components. */

import type { WorkspaceHomeDocument, WorkspaceHomeOptions } from '@shrubbery/runtime'

export interface HomeDocumentSource {
  readonly id: string
  readonly title: string
  readonly readOnly?: boolean
  /** Authoritative projected creation time, as epoch milliseconds. */
  readonly createdAt?: number
}

interface TimedDocumentRef {
  readonly documentId: string
  readonly timestamp: number
}

interface GraphActivity {
  readonly pinned: readonly string[]
  readonly recent: readonly TimedDocumentRef[]
  readonly created: readonly TimedDocumentRef[]
  readonly lastOpened: TimedDocumentRef | null
}

interface StoredActivity {
  readonly version: 1
  readonly graphs: Readonly<Record<string, GraphActivity>>
}

export interface HomeProjection extends Pick<WorkspaceHomeOptions, 'resume' | 'pinned' | 'newlyCreated' | 'recent' | 'dreamJournal'> {}

const EMPTY_GRAPH: GraphActivity = Object.freeze({ pinned: [], recent: [], created: [], lastOpened: null })
const MAX_ACTIVITY = 40

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function parseTimedRefs(value: unknown): TimedDocumentRef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: TimedDocumentRef[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    const documentId = typeof row.documentId === 'string' ? row.documentId.trim() : ''
    const timestamp = finiteTimestamp(row.timestamp)
    if (!documentId || timestamp === null || seen.has(documentId)) continue
    seen.add(documentId)
    rows.push({ documentId, timestamp })
  }
  return rows.slice(0, MAX_ACTIVITY)
}

function parseGraph(value: unknown): GraphActivity {
  if (!value || typeof value !== 'object') return EMPTY_GRAPH
  const row = value as Record<string, unknown>
  const pinned = Array.isArray(row.pinned)
    ? [...new Set(row.pinned.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim()))]
    : []
  const recent = parseTimedRefs(row.recent)
  const created = parseTimedRefs(row.created)
  const last = parseTimedRefs(row.lastOpened ? [row.lastOpened] : [])[0] ?? null
  return { pinned, recent, created, lastOpened: last }
}

function parseStored(raw: string | null): StoredActivity {
  if (!raw) return { version: 1, graphs: {} }
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return { version: 1, graphs: {} }
    const graphsValue = (value as Record<string, unknown>).graphs
    if (!graphsValue || typeof graphsValue !== 'object' || Array.isArray(graphsValue)) return { version: 1, graphs: {} }
    const graphs: Record<string, GraphActivity> = {}
    for (const [graphId, graph] of Object.entries(graphsValue as Record<string, unknown>)) {
      if (graphId.trim()) graphs[graphId] = parseGraph(graph)
    }
    return { version: 1, graphs }
  } catch {
    return { version: 1, graphs: {} }
  }
}

export class HomeActivityStore {
  private state: StoredActivity

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly key = 'shrubbery.organism.home-activity.v1',
  ) {
    this.state = parseStored(storage?.getItem(key) ?? null)
  }

  private graph(graphId: string): GraphActivity {
    return this.state.graphs[graphId] ?? EMPTY_GRAPH
  }

  private write(graphId: string, graph: GraphActivity): void {
    this.state = { version: 1, graphs: { ...this.state.graphs, [graphId]: graph } }
    try { this.storage?.setItem(this.key, JSON.stringify(this.state)) } catch { /* persistence is best effort */ }
  }

  markOpened(graphId: string, documentId: string, timestamp = Date.now()): void {
    const graph = this.graph(graphId)
    const ref = { documentId, timestamp }
    this.write(graphId, {
      ...graph,
      recent: [ref, ...graph.recent.filter(item => item.documentId !== documentId)].slice(0, MAX_ACTIVITY),
      lastOpened: ref,
    })
  }

  markCreated(graphId: string, documentId: string, timestamp = Date.now()): void {
    const graph = this.graph(graphId)
    const ref = { documentId, timestamp }
    this.write(graphId, {
      ...graph,
      created: [ref, ...graph.created.filter(item => item.documentId !== documentId)].slice(0, MAX_ACTIVITY),
      lastOpened: ref,
    })
  }

  setPinned(graphId: string, documentId: string, pinned: boolean): void {
    const graph = this.graph(graphId)
    const next = graph.pinned.filter(id => id !== documentId)
    if (pinned) next.unshift(documentId)
    this.write(graphId, { ...graph, pinned: next })
  }

  removeGraph(graphId: string): void {
    if (!(graphId in this.state.graphs)) return
    const graphs = { ...this.state.graphs }
    delete graphs[graphId]
    this.state = { version: 1, graphs }
    try { this.storage?.setItem(this.key, JSON.stringify(this.state)) } catch { /* best effort */ }
  }

  project(
    graphId: string,
    documents: readonly HomeDocumentSource[],
    options: { readonly dreamingEnabled?: boolean; readonly dreamJournalId?: string } = {},
  ): HomeProjection {
    const graph = this.graph(graphId)
    const byId = new Map(documents.map(document => [document.id, document]))
    const homeDocument = (documentId: string, timestamp?: number): WorkspaceHomeDocument | null => {
      const document = byId.get(documentId)
      return document ? {
        graphId,
        documentId,
        title: document.title || 'Untitled',
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(document.readOnly ? { readOnly: true } : {}),
      } : null
    }

    const pinned = graph.pinned.map(id => homeDocument(id)).filter((item): item is WorkspaceHomeDocument => item !== null)
    const pinnedIds = new Set(pinned.map(item => item.documentId))
    const recent = graph.recent
      .filter(item => !pinnedIds.has(item.documentId))
      .map(item => homeDocument(item.documentId, item.timestamp))
      .filter((item): item is WorkspaceHomeDocument => item !== null)
      .slice(0, 8)
    const recentIds = new Set(recent.map(item => item.documentId))
    const latestAcceptedTimestamp = Date.now() + 86_400_000
    const createdById = new Map<string, TimedDocumentRef>()
    for (const document of documents) {
      const timestamp = finiteTimestamp(document.createdAt)
      if (timestamp !== null && timestamp <= latestAcceptedTimestamp) {
        createdById.set(document.id, { documentId: document.id, timestamp })
      }
    }
    // A local creation event is more precise than an order-derived projection
    // fallback, so it wins for the same document while remaining graph-scoped.
    for (const created of graph.created) {
      if (created.timestamp <= latestAcceptedTimestamp) createdById.set(created.documentId, created)
    }
    const newlyCreated = [...createdById.values()]
      .filter(item => !pinnedIds.has(item.documentId) && !recentIds.has(item.documentId))
      .sort((left, right) => right.timestamp - left.timestamp)
      .map(item => homeDocument(item.documentId, item.timestamp))
      .filter((item): item is WorkspaceHomeDocument => item !== null)
      .slice(0, 5)
    const resume = graph.lastOpened ? homeDocument(graph.lastOpened.documentId, graph.lastOpened.timestamp) : null
    const dreamJournal = options.dreamingEnabled
      ? homeDocument(options.dreamJournalId ?? `${graphId}-dream-journal`)
      : null
    return { resume, pinned, newlyCreated, recent, dreamJournal }
  }
}
