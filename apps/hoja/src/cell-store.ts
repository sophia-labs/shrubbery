import {
  type GatewayGraphInfo,
  GatewayMcpError,
  type GatewayMcpResult,
  type GatewayTransport,
  gatewayMcpText,
} from '@shrubbery/source/gateway'
import { firstLineTitle, snippetOf } from './notes.js'
import {
  requiredId,
  SeedConflictError,
  type SeedDoc,
  type SeedSaveInput,
  type SeedSaveResult,
  type SeedSearchHit,
  type SeedStore,
  type SeedSummary,
} from './seed-store.js'

export interface CellStoreGateway {
  graphs(): Promise<readonly GatewayGraphInfo[]>
  toolsCall(
    graphId: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<GatewayMcpResult>
}

export interface CellStoreOptions {
  readonly gateway: CellStoreGateway | GatewayTransport
  readonly graphId?: string
  readonly location?: Pick<Location, 'href'> | URL
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  readonly now?: () => number
  readonly idFactory?: (title: string) => string
  /** Entries per get_workspace page (the cell caps it at 200). */
  readonly workspacePageSize?: number
}

/** The fixed id Hoja gives the folder it creates for new leaves. */
export const HOJA_FOLDER_ID = 'folder-hoja'
export const HOJA_FOLDER_TITLE = 'Hoja'
/** Garden's daily-note root (garden frontend/src/lib/daily-note-folders.ts). */
const DAILY_NOTES_FOLDER_ID = 'folder-daily-notes'
/** Root folder titles vault imports file daily notes under (import_vault_ops.rs). */
const DAILY_NOTES_FOLDER_TITLES = new Set(['daily notes', 'journals'])
const MAX_WORKSPACE_DEPTH = 5
const MAX_SCOPE_FOLDER_WALKS = 500

interface Placement {
  readonly parentId: string | null
  readonly order: number | null
}

function placementOf(entry: Record<string, unknown>): Placement {
  const parentId = typeof entry.parentId === 'string' && entry.parentId ? entry.parentId : null
  const order = typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : null
  return { parentId, order }
}

interface HojaScope {
  readonly graphId: string
  readonly rows: readonly Record<string, unknown>[]
  readonly ids: Set<string>
  hojaFolderId: string | null
}

function isHojaFolder(folder: Record<string, unknown>): boolean {
  return stringField(folder, ['id']) === HOJA_FOLDER_ID
    || stringField(folder, ['title', 'name']).trim().toLocaleLowerCase() === HOJA_FOLDER_TITLE.toLocaleLowerCase()
}

function isDailyNotesFolder(folder: Record<string, unknown>): boolean {
  return stringField(folder, ['id']) === DAILY_NOTES_FOLDER_ID
    || DAILY_NOTES_FOLDER_TITLES.has(stringField(folder, ['title', 'name']).trim().toLocaleLowerCase())
}

/** Cloud-2 graph backend. Credentials remain in GatewayTransport/AuthProvider. */
export class CellStore implements SeedStore {
  readonly kind = 'cell' as const
  private readonly requestedGraphId: string
  private readonly location: Pick<Location, 'href'> | URL | undefined
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null
  private readonly now: () => number
  private readonly idFactory: (title: string) => string
  private resolvedGraph: GatewayGraphInfo | null = null
  /** The last scope this store computed; search filters against it. */
  private scope: HojaScope | null = null
  /**
   * Where each leaf sits in the workspace tree. write_document re-files the
   * document it writes at the root with a fresh order (gardend
   * workspace_ops.rs write_workspace_document sets parentId/order from the
   * write payload, and write_document's payload carries neither), so every
   * save puts the leaf back where it was.
   */
  private readonly placements = new Map<string, Placement>()
  /** Revision of each document as this client last read or wrote it. */
  private readonly revisions = new Map<string, number>()

  constructor(private readonly options: CellStoreOptions) {
    this.requestedGraphId = options.graphId?.trim() ?? ''
    this.location = options.location ?? browserLocation()
    this.storage = options.storage === undefined ? browserSessionStorage() : options.storage
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? defaultDocumentId
  }

  get activeGraphId(): string | null {
    return this.resolvedGraph?.graphId ?? null
  }

  /** The hosted workspace picker uses the same gateway directory as Garden. */
  workspaces(): Promise<readonly GatewayGraphInfo[]> {
    return this.options.gateway.graphs()
  }

  async switchGraph(graphId: string): Promise<void> {
    const graph = (await this.workspaces()).find(item => item.graphId === graphId)
    if (!graph) throw new Error(`Graph "${graphId}" is not available to this account.`)
    this.resolvedGraph = graph
    this.revisions.clear()
    this.placements.clear()
    this.scope = null
    this.storage?.setItem('shrubbery.hoja.active-graph', graph.graphId)
  }

  async list(): Promise<readonly SeedSummary[]> {
    const graph = await this.graph()
    const scope = await this.loadScope(graph.graphId)
    return scope.rows.map((raw, index) => seedSummary(raw, index, graph.role === 'viewer'))
      .sort((left, right) => right.modified_ms - left.modified_ms)
  }

  /**
   * Hoja's slice of the graph: daily notes, leaves at the root, and leaves
   * anywhere under a root folder titled "Hoja". The rest of the graph is
   * Garden's. `list_documents` carries no parent, so this walks the workspace
   * tree instead — the root one level deep, then each Hoja and daily-note
   * folder to the bottom (get_workspace depth is capped, so folders it
   * reports as collapsed are walked in turn).
   */
  private async loadScope(graphId: string): Promise<HojaScope> {
    const root = await this.workspaceEntries(graphId, null, 1)
    const rows = new Map<string, Record<string, unknown>>()
    const keep = (entry: Record<string, unknown>) => {
      const id = stringField(entry, ['documentId', 'id'])
      if (!id || rows.has(id)) return
      rows.set(id, entry)
      this.placements.set(id, placementOf(entry))
    }
    root.documents.forEach(keep)
    const hojaFolders = root.folders.filter(isHojaFolder)
    const dailyFolders = root.folders.filter(isDailyNotesFolder)
    for (const folder of [...hojaFolders, ...dailyFolders]) {
      (await this.folderDocuments(graphId, stringField(folder, ['id']))).forEach(keep)
    }
    const hojaFolderId = hojaFolders.map(folder => stringField(folder, ['id']))
      .sort((left, right) => Number(right === HOJA_FOLDER_ID) - Number(left === HOJA_FOLDER_ID))[0] ?? null
    const scope: HojaScope = { graphId, rows: [...rows.values()], ids: new Set(rows.keys()), hojaFolderId }
    this.scope = scope
    return scope
  }

  /** Every document under a folder (null: the whole graph), however deep. */
  private async folderDocuments(graphId: string, folderId: string | null): Promise<Record<string, unknown>[]> {
    const documents: Record<string, unknown>[] = []
    const queue: Array<string | null> = [folderId]
    const seen = new Set<string | null>()
    while (queue.length > 0 && seen.size < MAX_SCOPE_FOLDER_WALKS) {
      const next = queue.shift()!
      if (seen.has(next)) continue
      seen.add(next)
      const page = await this.workspaceEntries(graphId, next, MAX_WORKSPACE_DEPTH)
      documents.push(...page.documents)
      for (const folder of page.folders) {
        const collapsed = folder.collapsed
        if (collapsed && typeof collapsed === 'object') queue.push(stringField(folder, ['id']))
      }
    }
    return documents
  }

  /** One get_workspace view, followed to the end of its cursor. */
  private async workspaceEntries(
    graphId: string,
    folderId: string | null,
    depth: number,
  ): Promise<{ documents: Record<string, unknown>[], folders: Record<string, unknown>[] }> {
    const documents: Record<string, unknown>[] = []
    const folders: Record<string, unknown>[] = []
    let cursor: string | null = null
    for (let pages = 0; pages < 50; pages += 1) {
      const value = record(await this.callJson(graphId, 'get_workspace', {
        graphId, depth, limit: this.options.workspacePageSize ?? 200, ...(folderId ? { folderId } : {}), ...(cursor ? { cursor } : {}),
      }), 'get_workspace')
      for (const entry of Array.isArray(value.documents) ? value.documents : []) {
        if (entry && typeof entry === 'object') documents.push(entry as Record<string, unknown>)
      }
      for (const entry of Array.isArray(value.folders) ? value.folders : []) {
        if (entry && typeof entry === 'object') folders.push(entry as Record<string, unknown>)
      }
      const page = value.page && typeof value.page === 'object' ? value.page as Record<string, unknown> : null
      const next = typeof page?.nextCursor === 'string' ? page.nextCursor : null
      if (!page || page.complete !== false || !next || next === cursor) break
      cursor = next
    }
    return { documents, folders }
  }

  async read(id: string): Promise<SeedDoc> {
    const graph = await this.graph()
    const documentId = requiredId(id)
    // Structure first: its revision is the one the user's edits build on.
    const structuralPage = await this.readContent(graph.graphId, documentId, 'json')
    const structural = JSON.parse(structuralPage.content) as { tiptapJson?: unknown, blocks?: unknown }
    const json = structural.tiptapJson
    const revision = structuralPage.revision
    if (revision !== null) this.revisions.set(documentId, revision)
    const hasStructure = Boolean(json && typeof json === 'object' && !Array.isArray(json))
    const hasBlocks = Array.isArray(structural.blocks) && structural.blocks.length > 0
    if (!hasStructure && !hasBlocks) {
      // A just-created leaf has no body yet: the cell answers tiptapJson null
      // (and its markdown projection falls back to the title). Open it empty.
      return { id: documentId, title: 'New leaf', markdown: '', json: emptyDocument(), ...(revision === null ? {} : { revision }) }
    }
    const markdown = (await this.readContent(graph.graphId, documentId, 'markdown')).content
    return {
      id: documentId,
      title: firstLineTitle(markdown),
      markdown,
      // Legacy bodies without a TipTap projection still open from markdown.
      ...(hasStructure ? { json } : {}),
      ...(revision === null ? {} : { revision }),
    }
  }

  /** Server revision of a document, read with a one-character page. */
  async revisionOf(id: string): Promise<number | null> {
    const graph = await this.graph()
    const value = record(await this.callJson(graph.graphId, 'read_document', {
      graphId: graph.graphId, documentId: requiredId(id), format: 'markdown', offset: 0, maxChars: 1,
    }), 'read_document')
    return revisionField(value)
  }

  /** Lexical search over block bodies; titles are filtered client-side. */
  async search(query: string): Promise<readonly SeedSearchHit[]> {
    const text = query.trim()
    if (!text) return []
    const graph = await this.graph()
    const scope = this.scope?.graphId === graph.graphId ? this.scope : await this.loadScope(graph.graphId)
    const value = record(await this.callJson(graph.graphId, 'search_blocks', {
      graphId: graph.graphId, query: text, mode: 'lexical', limit: 100,
    }), 'search_blocks')
    const rows = (Array.isArray(value.results) ? value.results : [])
      .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
    // A hit outside the cached scope may be a leaf written since the last
    // list; look once more before dropping it.
    const inScope = rows.some(row => !scope.ids.has(stringField(row, ['documentId', 'document_id'])))
      ? (await this.loadScope(graph.graphId)).ids
      : scope.ids
    const hits = new Map<string, SeedSearchHit>()
    for (const row of rows) {
      const id = stringField(row, ['documentId', 'document_id'])
      if (!id || hits.has(id) || !inScope.has(id)) continue
      const content = stringField(row, ['content']).replace(/\s+/g, ' ').trim()
      hits.set(id, {
        id,
        title: stringField(row, ['documentTitle', 'document_title']),
        snippet: content.length > 96 ? `${content.slice(0, 95)}…` : content,
      })
    }
    return [...hits.values()]
  }

  private async readContent(
    graphId: string,
    documentId: string,
    format: 'markdown' | 'json',
  ): Promise<{ content: string, revision: number | null }> {
    let offset = 0
    let content = ''
    let revision: number | null = null
    for (;;) {
      const value = record(await this.callJson(graphId, 'read_document', {
        graphId, documentId, format, offset, maxChars: 256 * 1024,
      }), 'read_document')
      if (offset === 0) revision = revisionField(value)
      const fragment = stringField(value, ['content'])
      content += fragment
      if (value.complete !== false) return { content, revision }
      const next = value.nextOffset
      if (typeof next !== 'number' || next <= offset) throw new Error(`cell read_document ${format} has an invalid page cursor`)
      offset = next
    }
  }

  async create(): Promise<{ id: string }> {
    const graph = await this.editorGraph()
    const title = 'New leaf'
    const documentId = this.idFactory(title)
    const parentId = await this.hojaFolder(graph.graphId)
    const created = await this.callJson(graph.graphId, 'create_document', {
      graphId: graph.graphId,
      documentId,
      title,
      parentId,
    })
    const placed = created && typeof created === 'object' && !Array.isArray(created)
      ? placementOf(created as Record<string, unknown>)
      : { parentId, order: null }
    this.placements.set(documentId, { parentId, order: placed.order })
    this.revisions.set(documentId, 0)
    if (this.scope?.graphId === graph.graphId) this.scope.ids.add(documentId)
    return { id: documentId }
  }

  /** Where a leaf sits now: known from the last walk, else found in the tree. */
  private async placementOf(graphId: string, documentId: string): Promise<Placement | null> {
    const known = this.placements.get(documentId)
    if (known) return known
    const entry = (await this.folderDocuments(graphId, null))
      .find(row => stringField(row, ['documentId', 'id']) === documentId)
    if (!entry) return null
    const placement = placementOf(entry)
    this.placements.set(documentId, placement)
    return placement
  }

  /**
   * Undo write_document's re-filing. The move leaves the document's revision
   * alone, so the next fenced save still lines up. A failed move never fails
   * the save that already landed; the next save tries again.
   */
  private async restorePlacement(graphId: string, documentId: string, placement: Placement | null): Promise<void> {
    if (!placement) return
    try {
      await this.callJson(graphId, 'move_documents', {
        graphId,
        documentIds: [documentId],
        parentId: placement.parentId,
        ...(placement.order === null ? {} : { order: placement.order }),
      })
    } catch (error) {
      console.warn('[hoja] could not put the leaf back in its folder after saving', error)
    }
  }

  /**
   * The folder new leaves go into: the root "Hoja" folder the user already
   * has, else one Hoja makes under a fixed id, so two clients converge on the
   * same folder the way Garden's daily-note folders do.
   */
  private async hojaFolder(graphId: string): Promise<string> {
    const scope = await this.loadScope(graphId)
    if (scope.hojaFolderId) return scope.hojaFolderId
    await this.callJson(graphId, 'create_folder', {
      graphId, folderId: HOJA_FOLDER_ID, name: HOJA_FOLDER_TITLE, parentId: null,
    })
    scope.hojaFolderId = HOJA_FOLDER_ID
    return HOJA_FOLDER_ID
  }

  /**
   * Replace the document, fenced by the revision the user's edits build on.
   * The cell's write_document is whole-document (tiptapJson); it has no delta
   * form, so the payload is the full structure.
   */
  async save(id: string, input: SeedSaveInput): Promise<SeedSaveResult> {
    const graph = await this.editorGraph()
    const documentId = requiredId(id)
    if (!input.json || typeof input.json !== 'object' || Array.isArray(input.json)) {
      throw new Error('cell save requires TipTap document JSON')
    }
    const title = firstLineTitle(input.markdown)
    const expectedRevision = input.expectedRevision !== undefined
      ? input.expectedRevision
      : this.revisions.get(documentId) ?? null
    const placement = await this.placementOf(graph.graphId, documentId)
    let value: Record<string, unknown>
    try {
      value = record(await this.callJson(graph.graphId, 'write_document', {
        graphId: graph.graphId,
        documentId,
        title,
        tiptapJson: input.json,
        awaitDurable: true,
        ...(typeof expectedRevision === 'number' ? { expectedRevision } : {}),
      }), 'write_document')
    } catch (error) {
      if (error instanceof GatewayMcpError && /revision conflict/i.test(error.message)) {
        throw new SeedConflictError(documentId, error.message.replace(/^.*?revision conflict:?\s*/i, ''))
      }
      throw error
    }
    const revision = revisionField(value)
    if (revision !== null) this.revisions.set(documentId, revision)
    await this.restorePlacement(graph.graphId, documentId, placement)
    return {
      ok: value.success !== false,
      title: stringField(value, ['title']) || title,
      snippet: snippetOf(input.markdown),
      modified_ms: this.now(),
      ...(revision === null ? {} : { revision }),
    }
  }

  private async editorGraph(): Promise<GatewayGraphInfo> {
    const graph = await this.graph()
    if (graph.role === 'viewer') throw new Error(`Graph "${graph.graphId}" is read-only for this account.`)
    return graph
  }

  private async graph(): Promise<GatewayGraphInfo> {
    if (this.resolvedGraph) return this.resolvedGraph
    const graphs = await this.options.gateway.graphs()
    const graphId = selectCellGraphId({
      graphs,
      requestedGraphId: this.requestedGraphId,
      location: this.location,
      storedGraphId: this.storage?.getItem('shrubbery.hoja.active-graph') ?? '',
    })
    if (!graphId) throw new Error('No Garden graphs are available to this account.')
    const graph = graphs.find(item => item.graphId === graphId)
    if (!graph) throw new Error(`Graph "${graphId}" is not available to this account.`)
    this.resolvedGraph = graph
    this.storage?.setItem('shrubbery.hoja.active-graph', graph.graphId)
    return graph
  }

  private async callJson(
    graphId: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return parseMcpJson(tool, await this.options.gateway.toolsCall(graphId, tool, args))
  }
}

export function selectCellGraphId(options: {
  readonly graphs: readonly GatewayGraphInfo[]
  readonly requestedGraphId?: string
  readonly location?: Pick<Location, 'href'> | URL
  readonly storedGraphId?: string
}): string | null {
  const fromUrl = graphIdFromLocation(options.location)
  const requested = fromUrl || options.requestedGraphId?.trim() || options.storedGraphId?.trim() || ''
  if (requested) {
    if (!options.graphs.some(graph => graph.graphId === requested)) {
      throw new Error(`Graph "${requested}" is not available to this account.`)
    }
    return requested
  }
  return options.graphs.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')?.graphId
    ?? options.graphs.find(graph => graph.role !== 'viewer')?.graphId
    ?? options.graphs.find(graph => graph.cellState === 'running')?.graphId
    ?? options.graphs[0]?.graphId
    ?? null
}

function parseMcpJson(tool: string, result: GatewayMcpResult): unknown {
  const text = gatewayMcpText(result).trim()
  if (!text) throw new Error(`cell ${tool} returned no textual result`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`cell ${tool} returned invalid JSON`)
  }
}

function seedSummary(value: unknown, index: number, graphReadOnly: boolean): SeedSummary {
  const row = record(value, `list_documents row ${index}`)
  const id = stringField(row, ['document_id', 'documentId', 'id'])
  if (!id) throw new Error(`cell list_documents row ${index} has no document id`)
  const body = stringField(row, ['body', 'markdown', 'content'])
  const updated = row.updated_at ?? row.updatedAt
  return {
    id,
    title: stringField(row, ['title']) || firstLineTitle(body),
    snippet: snippetOf(body),
    modified_ms: timestampMs(updated),
    readOnly: graphReadOnly || row.read_only === true || row.readOnly === true,
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`cell ${label} returned a non-object`)
  }
  return value as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    if (typeof value[name] === 'string') return value[name]
  }
  return ''
}

/** Cells report epoch milliseconds as a digit string; older rows use ISO. */
export function timestampMs(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const text = value.trim()
  if (/^\d+$/.test(text)) {
    const epoch = Number(text)
    // Seconds-precision epochs are 10 digits; milliseconds are 13.
    return text.length <= 10 ? epoch * 1000 : epoch
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function revisionField(value: Record<string, unknown>): number | null {
  const revision = value.revision
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : null
}

function emptyDocument(): { type: 'doc', content: Array<{ type: 'paragraph' }> } {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

function defaultDocumentId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'leaf'
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `doc-${slug}-${suffix}`
}

function graphIdFromLocation(location: Pick<Location, 'href'> | URL | undefined): string {
  if (!location) return ''
  try {
    const url = location instanceof URL ? location : new URL(location.href)
    return (url.searchParams.get('graph') ?? url.searchParams.get('graph_id') ?? '').trim()
  } catch {
    return ''
  }
}

function browserLocation(): Pick<Location, 'href'> | undefined {
  try { return globalThis.location } catch { return undefined }
}

function browserSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return globalThis.sessionStorage } catch { return null }
}
