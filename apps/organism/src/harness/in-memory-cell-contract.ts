/**
 * Deterministic browser-only cell contract used by the Organism Playwright page.
 *
 * It deliberately models the two properties that lightweight fetch mocks tend to
 * erase:
 *   - document/wire reads live in the cell-canonical *named* workspace graph;
 *   - editor state travels through real Y.Doc/Awareness ProviderHandles.
 *
 * The SPARQL surface is a fixture evaluator, not a second general-purpose parser.
 * It recognizes the production adapter query families used by the harness and
 * rejects GRAPH-less reads. A real-gardend lane can replace this whole class with
 * createGardendContract without changing the page controller.
 */

import { html } from 'lit'
import {
  createWireModeController,
  type AuthProvider,
  type BlockScore,
  type CrdtBackend,
  type RestClient,
  type RuntimeModeProvider,
  type SalienceUserValueRequest,
  type SalienceService,
  type ShrubberyContract,
  type Telemetry,
  type UiServices,
  type WireCreateRequest,
  type WireModeController,
  type WireWriter,
} from '@shrubbery/nucleus'
import { workspaceProjectionGraphIri } from '@shrubbery/runtime'
import { InProcessCrdtBackend } from '@shrubbery/runtime/harness/in-process-crdt-backend'

const DOC_NS = 'http://mnemosyne.dev/doc#'
const WIRE_NS = 'http://mnemosyne.ai/vocab#'

export interface InMemoryBlockSeed {
  readonly id: string
  readonly type?: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly text: string
  readonly level?: number
  readonly order?: number
}

export interface InMemoryDocumentSeed {
  readonly id: string
  readonly title: string
  readonly parentId?: string | null
  readonly order?: number
  readonly tags?: readonly string[]
  readonly blocks?: readonly InMemoryBlockSeed[]
  /** TipTap JSON used only to initialize the real CRDT room in the page. */
  readonly content: Readonly<Record<string, unknown>>
  readonly readOnly?: boolean
  /** Optional original bytes served by the authenticated browser-cell fixture. */
  readonly original?: InMemoryOriginalFileSeed | null
}

export interface InMemoryOriginalFileSeed {
  readonly filename: string
  readonly mimeType: string
  readonly body: string | Uint8Array
}

export interface InMemoryFolderSeed {
  readonly id: string
  readonly title: string
  readonly parentId?: string | null
  readonly order?: number
  readonly section?: 'documents' | 'artifacts'
}

export interface InMemoryArtifactSeed {
  readonly id: string
  readonly filename: string
  readonly mimeType: string
  readonly status?: string
  readonly fileType?: string
  readonly parentId?: string | null
  readonly order?: number
}

export interface InMemoryCellSeed {
  readonly graphId: string
  readonly title: string
  readonly documents: readonly InMemoryDocumentSeed[]
  readonly folders?: readonly InMemoryFolderSeed[]
  readonly artifacts?: readonly InMemoryArtifactSeed[]
}

export interface InMemoryWireRecord extends WireCreateRequest {
  readonly graphId: string
  readonly wireId: string
}

export interface InMemoryCellSnapshot {
  readonly graphId: string
  readonly documentIds: readonly string[]
  readonly wires: readonly InMemoryWireRecord[]
  readonly queryCount: number
  readonly updateCount: number
  readonly telemetryCount: number
  readonly originalFetchCount: number
  readonly authenticatedOriginalFetchCount: number
}

function namedNode(value: string): string {
  return `<${value}>`
}

function literal(value: string | number | boolean): string {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `"${escaped}"`
}

function documentIri(id: string): string {
  return `urn:mnemosyne:local:document:${id}`
}

function folderIri(graphId: string, id: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:folder:${id}`
}

function artifactIri(graphId: string, id: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:artifact:${id}`
}

function blockType(type: InMemoryBlockSeed['type']): string {
  switch (type) {
    case 'heading': return `${DOC_NS}Heading`
    case 'listItem': return `${DOC_NS}ListItem`
    case 'blockquote': return `${DOC_NS}Blockquote`
    case 'codeBlock': return `${DOC_NS}CodeBlock`
    default: return `${DOC_NS}Paragraph`
  }
}

function freezeWire(record: InMemoryWireRecord): InMemoryWireRecord {
  return Object.freeze({ ...record })
}

/** Fixed local auth: enough to exercise the production AuthProvider contract. */
class HarnessAuth implements AuthProvider {
  token(): string | undefined { return 'browser-harness-token' }
  userId(): string { return 'browser-harness-user' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(_cb: () => void): () => void { return () => undefined }
}

class HarnessRuntime implements RuntimeModeProvider {
  mode(): 'local' { return 'local' }
  isGateway(): boolean { return false }
  graphBaseUrl(graphId: string): string {
    return `/browser-harness/cell/g/${encodeURIComponent(graphId)}`
  }
}

export class InMemoryCellContract implements ShrubberyContract {
  readonly auth: AuthProvider = new HarnessAuth()
  readonly crdt: CrdtBackend
  readonly runtime: RuntimeModeProvider = new HarnessRuntime()
  readonly ui: UiServices = {
    confirm: async () => true,
    icon: (name) => html`<span aria-hidden="true" data-harness-icon=${name}>${name}</span>`,
    presenceColors: Object.freeze(['#2563eb', '#16a34a', '#c026d3']),
  }
  readonly native = undefined
  readonly telemetry: Telemetry
  readonly rest: RestClient
  readonly wire: WireWriter
  readonly wireMode: WireModeController
  readonly salience: SalienceService

  private readonly documents = new Map<string, InMemoryDocumentSeed>()
  private readonly folders: readonly InMemoryFolderSeed[]
  private readonly artifacts: readonly InMemoryArtifactSeed[]
  private readonly wires = new Map<string, InMemoryWireRecord>()
  private readonly blockScores = new Map<string, BlockScore>()
  private readonly queries: string[] = []
  private readonly updates: string[] = []
  private readonly telemetryEvents: Array<{ event: string; props?: Readonly<Record<string, unknown>> }> = []
  private originalFetches = 0
  private authenticatedOriginalFetches = 0
  private wireSequence = 0

  constructor(readonly seed: InMemoryCellSeed) {
    for (const document of seed.documents) this.documents.set(document.id, document)
    this.folders = seed.folders ?? []
    this.artifacts = seed.artifacts ?? []
    this.crdt = new InProcessCrdtBackend({
      userId: this.auth.userId(),
      presenceColor: this.ui.presenceColors[0],
    })
    this.telemetry = {
      track: (event, props) => this.telemetryEvents.push({ event, props }),
    }
    this.rest = {
      graphs: async () => ({
        graphs: [{ id: this.seed.graphId, title: this.seed.title }],
      }),
      query: async (graphId, sparql) => this.query(graphId, sparql),
      update: async (graphId, sparql) => this.update(graphId, sparql),
    }
    this.wire = {
      create: async (graphId, params) => this.createWire(graphId, params),
      delete: async (graphId, wireId) => this.deleteWire(graphId, wireId),
    }
    this.wireMode = createWireModeController({ wire: this.wire })
    this.salience = {
      getScores: async (graphId, documentId) => this.getScores(graphId, documentId),
      setUserValue: async (graphId, params) => this.setUserValue(graphId, params),
    }
  }

  /** Same-origin binary route used by the real Chromium reader journey. */
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://browser-harness.local')
    const match = /\/artifacts\/([^/]+)\/documents\/([^/]+)\/download-original$/.exec(url.pathname)
    if (!match) return new Response('Harness route not found', { status: 404 })
    this.originalFetches += 1
    const headers = new Headers(init?.headers)
    const authenticated = headers.get('Authorization') === 'Bearer browser-harness-token'
      && headers.get('X-User-ID') === this.auth.userId()
    if (!authenticated) return new Response('Harness original route requires auth', { status: 401 })
    this.authenticatedOriginalFetches += 1
    const graphId = decodeURIComponent(match[1] ?? '')
    const documentId = decodeURIComponent(match[2] ?? '')
    if (graphId !== this.seed.graphId) return new Response('Unknown graph', { status: 404 })
    const original = this.documents.get(documentId)?.original
    if (!original) return new Response('No original file', { status: 404 })
    const body = typeof original.body === 'string'
      ? original.body
      : original.body.buffer.slice(
          original.body.byteOffset,
          original.body.byteOffset + original.body.byteLength,
        ) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': original.mimeType,
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(original.filename)}`,
      },
    })
  }

  documentSeed(documentId: string): InMemoryDocumentSeed {
    const document = this.documents.get(documentId)
    if (!document) throw new Error(`InMemoryCellContract: unknown document ${documentId}`)
    return document
  }

  documentSeeds(): readonly InMemoryDocumentSeed[] {
    return Object.freeze([...this.documents.values()])
  }

  addDocument(document: InMemoryDocumentSeed): void {
    if (this.documents.has(document.id)) {
      throw new Error(`InMemoryCellContract: document already exists ${document.id}`)
    }
    this.documents.set(document.id, document)
  }

  makeDocumentEditable(documentId: string): void {
    const document = this.documentSeed(documentId)
    this.documents.set(documentId, { ...document, readOnly: false })
  }

  snapshot(): InMemoryCellSnapshot {
    return Object.freeze({
      graphId: this.seed.graphId,
      documentIds: Object.freeze([...this.documents.keys()]),
      wires: Object.freeze([...this.wires.values()].map(freezeWire)),
      queryCount: this.queries.length,
      updateCount: this.updates.length,
      telemetryCount: this.telemetryEvents.length,
      originalFetchCount: this.originalFetches,
      authenticatedOriginalFetchCount: this.authenticatedOriginalFetches,
    })
  }

  destroy(): void {
    ;(this.crdt as InProcessCrdtBackend).destroyAll()
  }

  private assertGraph(graphId: string): void {
    if (graphId !== this.seed.graphId) {
      throw new Error(`InMemoryCellContract: unknown graph ${graphId}`)
    }
  }

  private assertNamedWorkspaceGraph(graphId: string, sparql: string): void {
    const graph = workspaceProjectionGraphIri(graphId)
    if (!sparql.includes(`GRAPH <${graph}>`)) {
      throw new Error(
        `InMemoryCellContract: workspace query must target GRAPH <${graph}>`,
      )
    }
  }

  private query(graphId: string, sparql: string): unknown {
    this.assertGraph(graphId)
    this.assertNamedWorkspaceGraph(graphId, sparql)
    this.queries.push(sparql)

    if (sparql.includes('?folder a doc:Folder')) return this.folderRows(graphId)
    if (sparql.includes('?artifact a doc:Artifact')) return this.artifactRows(graphId)
    if (sparql.includes('COUNT(DISTINCT ?subject) AS ?count')) return this.tagRows()
    if (sparql.includes('SELECT DISTINCT ?block ?blockId')) return this.blockRows(sparql)
    if (sparql.includes('?wire') && sparql.includes('Wire')) return this.wireRows(graphId)
    if (sparql.includes('?doc a doc:TipTapDocument')) return this.documentRows(graphId)

    throw new Error(
      `InMemoryCellContract: unsupported fixture query family: ${sparql.split('\n')[0] ?? sparql}`,
    )
  }

  private update(graphId: string, sparql: string): void {
    this.assertGraph(graphId)
    this.assertNamedWorkspaceGraph(graphId, sparql)
    this.updates.push(sparql)
  }

  private documentRows(graphId: string): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const rows = [...this.documents.values()]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title))
      .map((document) => ({
        doc: namedNode(documentIri(document.id)),
        label: literal(document.title),
        ...(document.parentId
          ? { parent: namedNode(folderIri(graphId, document.parentId)) }
          : {}),
        order: literal(document.order ?? 0),
        readOnly: literal(document.readOnly ?? false),
        ...(document.original
          ? {
              sourceStorageKey: literal(`local://documents/${document.id}/original/${document.original.filename}`),
              sourceOriginalFilename: literal(document.original.filename),
              sourceMimeType: literal(document.original.mimeType),
              sourceFileType: literal(document.original.filename.split('.').pop() ?? ''),
            }
          : {}),
      }))
    return {
      result_type: 'solutions',
      variables: [
        'doc', 'label', 'parent', 'order', 'readOnly', 'sourceStorageKey',
        'sourceOriginalFilename', 'sourceMimeType', 'sourceFileType',
      ],
      rows,
    }
  }

  private folderRows(graphId: string): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const rows = this.folders.map((folder) => ({
      folder: namedNode(folderIri(graphId, folder.id)),
      label: literal(folder.title),
      ...(folder.parentId ? { parent: namedNode(folderIri(graphId, folder.parentId)) } : {}),
      order: literal(folder.order ?? 0),
      section: literal(folder.section ?? 'documents'),
    }))
    return { result_type: 'solutions', variables: ['folder', 'label', 'parent', 'order', 'section'], rows }
  }

  private artifactRows(graphId: string): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const rows = this.artifacts.map((artifact) => ({
      artifact: namedNode(artifactIri(graphId, artifact.id)),
      label: literal(artifact.filename),
      ...(artifact.parentId ? { parent: namedNode(folderIri(graphId, artifact.parentId)) } : {}),
      order: literal(artifact.order ?? 0),
      mimeType: literal(artifact.mimeType),
      status: literal(artifact.status ?? 'ready'),
      ...(artifact.fileType ? { fileType: literal(artifact.fileType) } : {}),
    }))
    return { result_type: 'solutions', variables: ['artifact', 'label', 'parent', 'order', 'mimeType', 'status', 'fileType'], rows }
  }

  private tagRows(): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const counts = new Map<string, number>()
    for (const document of this.documents.values()) {
      for (const tag of document.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({
      tag: literal(tag),
      count: literal(count),
    }))
    return { result_type: 'solutions', variables: ['tag', 'count'], rows }
  }

  private blockRows(sparql: string): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const match = /BIND\(<urn:mnemosyne:local:document:([^>]+)> AS \?docUri\)/.exec(sparql)
    const document = match ? this.documents.get(match[1]!) : undefined
    const rows = (document?.blocks ?? []).map((block, index) => ({
      block: namedNode(`${documentIri(document!.id)}#block-${block.id}`),
      blockId: literal(block.id),
      text: literal(block.text),
      type: namedNode(blockType(block.type)),
      ...(block.level === undefined ? {} : { level: literal(block.level) }),
      order: literal(block.order ?? index),
      siblingOrder: literal(block.order ?? index),
    }))
    return { result_type: 'solutions', variables: ['block', 'blockId', 'text', 'type', 'level', 'order', 'siblingOrder'], rows }
  }

  private wireRows(graphId: string): { result_type: 'solutions'; variables: string[]; rows: Array<Record<string, string>> } {
    const rows = [...this.wires.values()].map((wire) => ({
      wire: namedNode(`urn:mnemosyne:local:graph:${graphId}:wire:${wire.wireId}`),
      sourceDocument: namedNode(documentIri(wire.sourceDocumentId)),
      targetDocument: namedNode(documentIri(wire.targetDocumentId)),
      predicate: namedNode(wire.predicate ?? `${WIRE_NS}relatedTo`),
      bidirectional: literal(wire.bidirectional ?? false),
    }))
    return { result_type: 'solutions', variables: ['wire', 'sourceDocument', 'targetDocument', 'predicate', 'bidirectional'], rows }
  }

  private createWire(graphId: string, params: WireCreateRequest): { wireId: string } {
    this.assertGraph(graphId)
    if (!this.documents.has(params.sourceDocumentId)) {
      throw new Error(`InMemoryCellContract: unknown source document ${params.sourceDocumentId}`)
    }
    if (!this.documents.has(params.targetDocumentId)) {
      throw new Error(`InMemoryCellContract: unknown target document ${params.targetDocumentId}`)
    }
    const wireId = params.wireId?.trim() || `harness-wire-${++this.wireSequence}`
    this.wires.set(wireId, freezeWire({ graphId, wireId, ...params }))
    return { wireId }
  }

  private deleteWire(graphId: string, wireId: string): void {
    this.assertGraph(graphId)
    this.wires.delete(wireId)
  }

  /** In-memory stand-in for the cell's computed per-document score view. */
  private getScores(graphId: string, documentId: string): readonly BlockScore[] {
    this.assertGraph(graphId)
    return Object.freeze(
      [...this.blockScores.values()].filter((score) => score.documentId === documentId),
    )
  }

  /** In-memory stand-in for the cell's restricted user-value replace path. */
  private setUserValue(graphId: string, params: SalienceUserValueRequest): BlockScore {
    this.assertGraph(graphId)
    const existing = this.blockScores.get(params.blockId)
    const score: BlockScore = {
      blockId: params.blockId,
      documentId: params.documentId,
      cumulativeImportance: existing?.cumulativeImportance ?? 0,
      cumulativeValence: existing?.cumulativeValence ?? 0,
      rawImportanceSum: existing?.rawImportanceSum ?? 0,
      rawValenceSum: existing?.rawValenceSum ?? 0,
      importanceCount: existing?.importanceCount ?? 0,
      valenceCount: existing?.valenceCount ?? 0,
      compositeScore: existing?.compositeScore ?? 0,
      blockWireCount: existing?.blockWireCount ?? 0,
      docWireCount: existing?.docWireCount ?? 0,
      lastValuatedAt: existing?.lastValuatedAt ?? null,
      userImportance: params.importance,
      userValence: params.valence,
    }
    this.blockScores.set(params.blockId, score)
    return score
  }
}
