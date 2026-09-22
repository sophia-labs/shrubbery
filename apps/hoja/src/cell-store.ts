import {
  type GatewayGraphInfo,
  type GatewayMcpResult,
  type GatewayTransport,
  gatewayMcpText,
} from '@shrubbery/source/gateway'
import { firstLineTitle, snippetOf } from './notes.js'
import {
  requiredId,
  type SeedDoc,
  type SeedSaveInput,
  type SeedSaveResult,
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

  async list(): Promise<readonly SeedSummary[]> {
    const graph = await this.graph()
    const value = await this.callJson(graph.graphId, 'list_documents', { graphId: graph.graphId })
    if (!Array.isArray(value)) throw new Error('cell list_documents returned a non-array')
    return value.map((raw, index) => seedSummary(raw, index, graph.role === 'viewer'))
      .sort((left, right) => right.modified_ms - left.modified_ms)
  }

  async read(id: string): Promise<SeedDoc> {
    const graph = await this.graph()
    const documentId = requiredId(id)
    const value = record(await this.callJson(graph.graphId, 'read_document', {
      graphId: graph.graphId,
      documentId,
      format: 'markdown',
    }), 'read_document')
    const markdown = stringField(value, ['content'])
    return {
      id: stringField(value, ['document_id', 'documentId']) || documentId,
      title: stringField(value, ['title']) || firstLineTitle(markdown),
      markdown,
    }
  }

  async create(): Promise<{ id: string }> {
    const graph = await this.editorGraph()
    const title = 'New leaf'
    const documentId = this.idFactory(title)
    await this.callJson(graph.graphId, 'create_document', {
      graphId: graph.graphId,
      documentId,
      title,
    })
    return { id: documentId }
  }

  async save(id: string, input: SeedSaveInput): Promise<SeedSaveResult> {
    const graph = await this.editorGraph()
    const documentId = requiredId(id)
    if (!input.json || typeof input.json !== 'object' || Array.isArray(input.json)) {
      throw new Error('cell save requires TipTap document JSON')
    }
    const title = firstLineTitle(input.markdown)
    const value = record(await this.callJson(graph.graphId, 'write_document', {
      graphId: graph.graphId,
      documentId,
      title,
      tiptapJson: input.json,
      awaitDurable: true,
    }), 'write_document')
    return {
      ok: value.success !== false,
      title: stringField(value, ['title']) || title,
      snippet: snippetOf(input.markdown),
      modified_ms: this.now(),
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
  const updated = stringField(row, ['updated_at', 'updatedAt'])
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

function timestampMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
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
