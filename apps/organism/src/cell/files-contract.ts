/**
 * The shell's client for the cell's Files contract, version 1 (CONTRACT-files v1, kept outside this repository).
 *
 * Bytes and file entries go over the cell's HTTP routes with the shell's bearer (`cellAuthHeaders`); folders go through
 * the MCP folder tools in the `artifacts` section (the Files pane's tree); folder-view preferences are read with
 * `GET /navigation/{g}/file-views` and written with the `source_push` tool. Nothing here parses, converts or imports a
 * file into a document, and nothing depends on the offline mirror's `source_pull`.
 */
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { cellAuthHeaders } from './cell-auth-headers.js'
import {
  createSidebarFolder, deleteSidebarFolder, moveSidebarDocument, moveSidebarFolder, renameSidebarDocument, renameSidebarFolder,
  type SidebarMutationMcp,
} from './sidebar-mutations.js'
import { FILES_DEFAULT_MAX_UPLOAD_BYTES } from './files-policy.js'

export const FILES_CONTRACT_VERSION = 1

/**
 * The routes the shell asks the cell for in the one tree, in one place so the cell's answer is a one-line change here. The artifact
 * routes (`navigation/{g}/trash`, `.../restore`) are today's; the document and purge routes are the ask.
 */
export const PLACE_ROUTES = {
  trashDocument: (graphId: string, documentId: string): string[] => ['navigation', graphId, 'documents', documentId],
  restoreDocument: (graphId: string, documentId: string): string[] => ['navigation', graphId, 'trash', documentId, 'restore'],
  purge: (graphId: string, id: string): string[] => ['navigation', graphId, 'trash', id],
} as const

/** What a cell that serves Files says about itself (CONTRACT-files §1). */
export interface FilesAdvert {
  readonly version: 1
  readonly maxUploadBytes: number
  readonly parsing: boolean
  readonly folderViews: { readonly vocab: string; readonly version: string } | null
  /**
   * One tree (plans/2026-10-08-one-tree.md). What the cell says it can do beyond the v1 contract; absent means it cannot, and the
   * shell says so instead of trying: `anyFolder` (a file may live in any folder, a document in any folder), `documentTrash`
   * (documents go to the one Trash and come back), `purge` (Delete forever from the Trash).
   */
  readonly anyFolder: boolean
  readonly documentTrash: boolean
  readonly purge: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The capability rule (CONTRACT-files §1): no `files` key, or `files.version` absent or not 1, hides the Files pane. A cap
 * that is missing or nonsensical falls back to the contract's 50 MiB, never to something larger.
 */
export function readFilesAdvert(capabilities: unknown): FilesAdvert | null {
  const files = record(record(capabilities)?.files)
  if (!files || files.version !== FILES_CONTRACT_VERSION) return null
  const cap = files.maxUploadBytes
  const views = record(files.folderViews)
  return {
    version: 1,
    maxUploadBytes: typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? cap : FILES_DEFAULT_MAX_UPLOAD_BYTES,
    parsing: files.parsing === true,
    folderViews: views && text(views.vocab) && text(views.version) ? { vocab: String(views.vocab), version: String(views.version) } : null,
    anyFolder: files.anyFolder === true,
    documentTrash: files.documentTrash === true,
    // The cell lists its purge route as a string (`DELETE /navigation/{graph_id}/trash/{artifact_id}`); a boolean says the same.
    purge: files.purge === true || (typeof files.purge === 'string' && files.purge.length > 0),
  }
}

/** A file as the cell returns it (CONTRACT-files §2, "artifact value"). */
export interface FilesArtifact {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly order: number
  readonly fileType: string
  readonly status: string
  readonly mimeType: string
  readonly sizeBytes: number | null
  readonly originalFilename: string
}

export interface FilesTrashItem {
  /** What the item is: the trash holds documents and files together. */
  readonly kind: 'document' | 'artifact'
  readonly artifactId: string
  readonly label: string
  readonly originalFilename: string
  readonly mimeType: string
  readonly sizeBytes: number | null
  readonly fileType: string
  readonly parentId: string | null
  readonly trashedAt: string
}

export interface FileViewsFace {
  readonly objectKey: string
  readonly vocab: string
  readonly class: string
  readonly objectId: string
  readonly sourceVersion: string
  readonly record: Readonly<Record<string, unknown>>
  readonly reconciliationStrategy: string
  readonly operationId?: string
  readonly conflictId?: string | null
}

export interface FileViewsRead {
  readonly graphId: string
  readonly graphIncarnation: string
  readonly revision: number
  readonly available: boolean
  readonly code: string | null
  readonly sourceRegistry: readonly Readonly<Record<string, unknown>>[]
  readonly currentState: readonly FileViewsFace[]
}

export interface FileViewsOperation {
  readonly kind: 'currentState'
  readonly operationId: string
  readonly vocab: string
  readonly class: string
  readonly objectId: string
  readonly baseVersion: string
  readonly record: Readonly<Record<string, unknown>>
}

export interface FileViewsReceipt {
  readonly operationId: string
  readonly status: string
  readonly acceptedRevision: number
  readonly outcome: { readonly outcome: string; readonly sourceVersion?: string; readonly conflictId?: string }
}

export interface FileViewsPushResult {
  readonly revision: number
  readonly receipts: readonly FileViewsReceipt[]
}

/** A refusal the cell gave, by its machine `code` and HTTP status (branch on these, never on the sentence). */
export class FilesContractError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message)
    this.name = 'FilesContractError'
  }
}

function artifactFrom(value: unknown): FilesArtifact {
  const r = record(value)
  const id = text(r?.id)
  if (!r || !id) throw new FilesContractError('The cell returned a file without an id.', 502, null)
  const size = r.sizeBytes ?? r.size
  return {
    id,
    label: text(r.label) ?? text(r.originalFilename) ?? id,
    parentId: text(r.parentId),
    order: typeof r.order === 'number' ? r.order : 0,
    fileType: text(r.fileType) ?? 'unknown',
    status: text(r.status) ?? 'ready',
    mimeType: text(r.mimeType) ?? 'application/octet-stream',
    sizeBytes: typeof size === 'number' && Number.isFinite(size) ? size : null,
    originalFilename: text(r.originalFilename) ?? text(r.label) ?? id,
  }
}

/** The JSON value inside an MCP text-content envelope, as both cell transports return it. */
function mcpJson(result: unknown): Record<string, unknown> | null {
  const r = record(result)
  const content = r?.content
  if (Array.isArray(content)) {
    const joined = content.map(item => record(item)).filter(item => item?.type === 'text' && typeof item.text === 'string')
      .map(item => item!.text as string).join('')
    if (joined) {
      try { const parsed = record(JSON.parse(joined)); if (parsed) return record(parsed.value) ?? parsed } catch { /* opaque success */ }
    }
  }
  return record(r?.value) ?? r
}

export interface FilesClientOptions {
  readonly fetch?: typeof fetch
}

export class FilesClient {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly contract: Pick<ShrubberyContract, 'auth' | 'runtime'>,
    private readonly mcp: SidebarMutationMcp,
    options: FilesClientOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('FilesClient: fetch is unavailable')
    this.fetchImpl = fetchImpl.bind(globalThis)
  }

  /** A cell tool by name (the graph's wires: `get_wires`, `create_wires`, `list_wire_predicates`, `delete`), as its JSON value. */
  async tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return mcpJson(await this.mcp.toolsCall(name, args)) ?? {}
  }

  private base(graphId: string): string {
    const value = this.contract.runtime.graphBaseUrl(graphId).replace(/\/+$/, '')
    if (!value) throw new Error(`No API base is available for graph ${graphId}`)
    return value
  }

  private path(graphId: string, ...segments: string[]): string {
    return `${this.base(graphId)}/${segments.map(encodeURIComponent).join('/')}`
  }

  private headers(extra: Record<string, string> = {}): Headers {
    return new Headers(cellAuthHeaders(this.contract, extra))
  }

  private async json(response: Response, what: string): Promise<Record<string, unknown>> {
    let payload: unknown = null
    const raw = await response.text()
    if (raw) { try { payload = JSON.parse(raw) } catch { payload = raw } }
    const r = record(payload)
    if (!response.ok) {
      throw new FilesContractError(text(r?.error) ?? `${what} failed (HTTP ${response.status}).`, response.status, text(r?.code))
    }
    return r ?? {}
  }

  /** CONTRACT-files §1. `null` when the cell does not serve Files (older than the contract): hide the pane. */
  async capabilities(graphId: string, signal?: AbortSignal): Promise<FilesAdvert | null> {
    const response = await this.fetchImpl(`${this.base(graphId)}/api/capabilities`, { headers: this.headers({ Accept: 'application/json' }),
      cache: 'no-store', signal })
    if (response.status === 404) return null
    return readFilesAdvert(await this.json(response, 'Reading the cell\'s capabilities'))
  }

  /** CONTRACT-files §3: one file, multipart, no parsing. A retry with the same `artifactId` and bytes is a replay. */
  async upload(graphId: string, file: File, options: { readonly parentId: string | null; readonly artifactId: string; readonly label?: string
    readonly signal?: AbortSignal }): Promise<FilesArtifact & { readonly replayed: boolean }> {
    const form = new FormData()
    form.append('file', file, file.name)
    if (options.parentId) form.append('parentId', options.parentId)
    if (options.label) form.append('label', options.label)
    form.append('artifactId', options.artifactId)
    let response: Response
    try {
      response = await this.fetchImpl(this.path(graphId, 'artifacts', graphId, 'files'), { method: 'POST', headers: this.headers(), body: form,
        signal: options.signal })
    } catch (error) {
      // "Treat a mid-send network error on an over-cap file as this refusal" (§3); otherwise it is what it is.
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new FilesContractError(`“${file.name}” could not be sent: ${error instanceof Error ? error.message : String(error)}`, 0, null)
    }
    const value = await this.json(response, `Uploading “${file.name}”`)
    return { ...artifactFrom(value), replayed: value.replayed === true }
  }

  /** CONTRACT-files §4: the stored bytes, fetched with the bearer (a bare URL would not carry it). */
  async download(graphId: string, artifactId: string, options: { readonly inline?: boolean; readonly signal?: AbortSignal } = {}): Promise<Blob> {
    const url = `${this.path(graphId, 'artifacts', graphId, artifactId, 'download')}${options.inline ? '?inline=1' : ''}`
    const response = await this.fetchImpl(url, { headers: this.headers({ Accept: '*/*' }), cache: 'no-store', signal: options.signal })
    if (!response.ok) await this.json(response, 'Downloading the file')
    const blob = await response.blob()
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim()
    return type && blob.type !== type ? new Blob([await blob.arrayBuffer()], { type }) : blob
  }

  /**
   * The stored bytes as they arrive: `onProgress(loaded, total)` after each chunk (`total` is 0 when the response states no length).
   * For a viewer that shows real progress; a cell that sends no stream falls back to one read.
   */
  async downloadBytes(graphId: string, artifactId: string, options: { readonly inline?: boolean; readonly signal?: AbortSignal
    readonly onProgress?: (loaded: number, total: number) => void } = {}): Promise<Uint8Array> {
    const url = `${this.path(graphId, 'artifacts', graphId, artifactId, 'download')}${options.inline ? '?inline=1' : ''}`
    const response = await this.fetchImpl(url, { headers: this.headers({ Accept: '*/*' }), cache: 'no-store', signal: options.signal })
    if (!response.ok) await this.json(response, 'Downloading the file')
    const total = Number(response.headers.get('content-length') ?? 0) || 0
    const reader = response.body?.getReader()
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      options.onProgress?.(bytes.length, bytes.length)
      return bytes
    }
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      options.onProgress?.(loaded, total)
    }
    const bytes = new Uint8Array(loaded)
    let at = 0
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
    return bytes
  }

  /**
   * What the listing (CONTRACT-files §2) says about one file: its size and when it last changed. For the file page of a
   * kind with no viewer, so its facts are known without fetching its bytes. Null when the listing does not have it.
   */
  async artifactInfo(graphId: string, artifactId: string, signal?: AbortSignal): Promise<{ readonly sizeBytes: number | null
    readonly updatedAt: string | null } | null> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId), { headers: this.headers({ Accept: 'application/json' }),
      cache: 'no-store', signal })
    const listing = await this.json(response, 'Reading the file list')
    const found = (Array.isArray(listing.artifacts) ? listing.artifacts : []).map(record).find(r => text(r?.id) === artifactId)
    if (!found) return null
    const size = found.sizeBytes ?? found.size
    return { sizeBytes: typeof size === 'number' && Number.isFinite(size) ? size : null, updatedAt: text(found.updatedAt) ?? text(found.createdAt) }
  }

  private async listing(graphId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId), { headers: this.headers({ Accept: 'application/json' }),
      cache: 'no-store', signal })
    return this.json(response, 'Reading the file list')
  }

  /** The listing's own record of one file or document (CONTRACT-files §2), as the cell states it; null when it does not have it. */
  async listingRecord(graphId: string, kind: 'artifact' | 'document', id: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const listing = await this.listing(graphId, signal)
    const rows = kind === 'artifact' ? listing.artifacts : listing.documents
    return (Array.isArray(rows) ? rows : []).map(record).find(r => text(r?.id) === id) ?? null
  }

  /** The size of every file in the listing, in one read (a folder's or a selection's total). */
  async listingSizes(graphId: string, signal?: AbortSignal): Promise<ReadonlyMap<string, number>> {
    const rows = (await this.listing(graphId, signal)).artifacts
    const sizes = new Map<string, number>()
    for (const r of (Array.isArray(rows) ? rows : []).map(record)) {
      const id = text(r?.id), size = r?.sizeBytes ?? r?.size
      if (id && typeof size === 'number' && Number.isFinite(size)) sizes.set(id, size)
    }
    return sizes
  }

  /** CONTRACT-files §5: rename and/or move; absent fields stay as they are. */
  async update(graphId: string, artifactId: string, patch: { readonly label?: string; readonly parentId?: string | null
    readonly order?: number }): Promise<FilesArtifact> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId, 'artifacts', artifactId), { method: 'PATCH',
      headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(patch) })
    return artifactFrom(await this.json(response, 'Changing the file'))
  }

  /** CONTRACT-files §6: the file leaves the workspace; its bytes and its last entry are kept for a restore. */
  async trash(graphId: string, artifactId: string): Promise<{ readonly trashedAt: string; readonly alreadyTrashed: boolean }> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId, 'artifacts', artifactId), { method: 'DELETE',
      headers: this.headers() })
    const value = await this.json(response, 'Moving the file to the trash')
    if (value.trashed !== true) throw new FilesContractError('The cell did not keep this file in the trash.', 502, null)
    return { trashedAt: text(value.trashedAt) ?? '', alreadyTrashed: value.alreadyTrashed === true }
  }

  /** The one Trash: files always; documents too when the cell's items say `kind: 'document'` (`id` or `documentId`). */
  async listTrash(graphId: string): Promise<readonly FilesTrashItem[]> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId, 'trash'), { headers: this.headers(), cache: 'no-store' })
    const value = await this.json(response, 'Reading the trash')
    return (Array.isArray(value.items) ? value.items : []).flatMap(item => {
      const r = record(item)
      const kind = r?.kind === 'document' ? 'document' as const : 'artifact' as const
      const id = text(kind === 'document' ? r?.documentId ?? r?.id : r?.artifactId ?? r?.id)
      if (!r || !id) return []
      return [{ kind, artifactId: id, label: text(r.label) ?? text(r.title) ?? id, originalFilename: text(r.originalFilename) ?? id, mimeType: text(r.mimeType) ?? '',
        sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : null, fileType: text(r.fileType) ?? 'unknown', parentId: text(r.parentId),
        trashedAt: text(r.trashedAt) ?? '' }]
    })
  }

  /** CONTRACT-files §6: back to its folder if that folder still exists, otherwise to the root. */
  async restore(graphId: string, artifactId: string): Promise<FilesArtifact & { readonly restoredToParentId: string | null }> {
    const response = await this.fetchImpl(this.path(graphId, 'navigation', graphId, 'trash', artifactId, 'restore'), { method: 'POST',
      headers: this.headers() })
    const value = await this.json(response, 'Restoring the file')
    return { ...artifactFrom(value), restoredToParentId: text(value.restoredToParentId) }
  }

  // --- documents in the one tree. These routes are the shell's ask of the cell (see PLACE_ROUTES); each is used only when the
  // --- cell's advert says it can, and a refusal that arrives anyway is turned into a sentence, never a silent failure.

  /** A document leaves the tree and the search for the Trash; its content and history are kept. */
  async trashDocument(graphId: string, documentId: string): Promise<{ readonly trashedAt: string }> {
    const response = await this.fetchImpl(this.path(graphId, ...PLACE_ROUTES.trashDocument(graphId, documentId)), { method: 'DELETE', headers: this.headers() })
    const value = await this.json(response, 'Moving the document to the trash')
    if (value.trashed !== true) throw new FilesContractError('The cell did not keep this document in the trash.', 502, null)
    return { trashedAt: text(value.trashedAt) ?? '' }
  }

  async restoreDocument(graphId: string, documentId: string): Promise<{ readonly restoredToParentId: string | null }> {
    const response = await this.fetchImpl(`${this.path(graphId, ...PLACE_ROUTES.restoreDocument(graphId, documentId))}?kind=document`, { method: 'POST',
      headers: this.headers() })
    const value = await this.json(response, 'Restoring the document')
    return { restoredToParentId: text(value.restoredToParentId) }
  }

  /** Delete forever, from the Trash: a file's bytes and entry, or a document with its history. Never undoable. */
  async purge(graphId: string, kind: 'document' | 'artifact', id: string): Promise<void> {
    const response = await this.fetchImpl(`${this.path(graphId, ...PLACE_ROUTES.purge(graphId, id))}?kind=${kind}`, { method: 'DELETE', headers: this.headers() })
    await this.json(response, 'Deleting forever')
  }

  /** Rename a document: the cell's existing document tool. */
  async renameDocument(graphId: string, documentId: string, title: string): Promise<void> {
    await renameSidebarDocument(this.mcp, { graphId, documentId, title })
  }

  /** Move a document: the cell's existing document tool. A refusal (an older cell's folder fence) says what to do. */
  async moveDocument(graphId: string, documentId: string, parentId: string | null): Promise<void> {
    await moveSidebarDocument(this.mcp, { graphId, documentId, parentId })
  }

  /** Files folders live in the `artifacts` section (CONTRACT-files §2, §6). */
  async createFolder(graphId: string, input: { readonly folderId: string; readonly name: string; readonly parentId: string | null
    readonly section?: 'documents' | 'artifacts' }): Promise<void> {
    await createSidebarFolder(this.mcp, { graphId, folderId: input.folderId, name: input.name, parentId: input.parentId, section: input.section ?? 'artifacts' })
  }

  async renameFolder(graphId: string, folderId: string, name: string): Promise<void> {
    await renameSidebarFolder(this.mcp, { graphId, folderId, name })
  }

  async moveFolder(graphId: string, folderId: string, parentId: string | null): Promise<void> {
    await moveSidebarFolder(this.mcp, { graphId, folderId, parentId })
  }

  /** Never a cascade: a cascade folder delete is not undoable (CONTRACT-files §6). The cell refuses a non-empty folder. */
  async deleteFolder(graphId: string, folderId: string): Promise<void> {
    await deleteSidebarFolder(this.mcp, { graphId, folderId, cascade: false })
  }

  /** CONTRACT-files §7, read. */
  async readFileViews(graphId: string, filter: { readonly folderKey?: string; readonly viewId?: string } = {}): Promise<FileViewsRead> {
    const query = new URLSearchParams()
    if (filter.folderKey) query.set('folderKey', filter.folderKey)
    if (filter.viewId) query.set('viewId', filter.viewId)
    const qs = query.toString()
    const response = await this.fetchImpl(`${this.path(graphId, 'navigation', graphId, 'file-views')}${qs ? `?${qs}` : ''}`, {
      headers: this.headers({ Accept: 'application/json' }), cache: 'no-store' })
    const value = await this.json(response, 'Reading the folder layout')
    const faces = (Array.isArray(value.currentState) ? value.currentState : []).flatMap(face => {
      const r = record(face)
      return r && text(r.objectId) && text(r.class) && record(r.record) ? [r as unknown as FileViewsFace] : []
    })
    return {
      graphId: text(value.graphId) ?? graphId,
      graphIncarnation: text(value.graphIncarnation) ?? '',
      revision: typeof value.revision === 'number' ? value.revision : 0,
      available: value.available !== false,
      code: text(value.code),
      sourceRegistry: (Array.isArray(value.sourceRegistry) ? value.sourceRegistry : []).flatMap(row => record(row) ? [record(row)!] : []),
      currentState: faces,
    }
  }

  /** CONTRACT-files §7, write: one `source_push` for a batch (a drag of several cards is one call, never one per frame). */
  async pushFileViews(graphId: string, graphIncarnation: string, operations: readonly FileViewsOperation[]): Promise<FileViewsPushResult> {
    let raw: unknown
    try { raw = await this.mcp.toolsCall('source_push', { graphId, graphIncarnation, operations }) } catch (error) {
      // The cell classifies a refusal in the JSON-RPC error's `data.code` (e.g. `source_bundle_too_large`, §7.1).
      const code = record(record(error)?.data)?.code
      if (typeof code === 'string' && code) throw new FilesContractError(error instanceof Error ? error.message : String(error), 0, code)
      throw error
    }
    const value = mcpJson(raw)
    const receipts = (Array.isArray(value?.receipts) ? value!.receipts : []).flatMap(row => {
      const r = record(row)
      const outcome = record(r?.outcome)
      if (!r || !text(r.operationId) || !outcome) return []
      return [{ operationId: String(r.operationId), status: text(r.status) ?? '', acceptedRevision: typeof r.acceptedRevision === 'number' ? r.acceptedRevision : 0,
        outcome: { outcome: text(outcome.outcome) ?? '', ...(text(outcome.sourceVersion) ? { sourceVersion: String(outcome.sourceVersion) } : {}),
          ...(text(outcome.conflictId) ? { conflictId: String(outcome.conflictId) } : {}) } }]
    })
    return { revision: typeof value?.revision === 'number' ? value.revision : 0, receipts }
  }
}
