/**
 * Shell-side sidebar write adapter for a gardend cell.
 *
 * The components emit plain intentions (`new-document`, `node-menu`, etc.).
 * This file is the cell boundary: it maps those intentions to Garden-compatible
 * MCP tool names and camelCase arguments. No UI component imports MCP or cell
 * transport code.
 */
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

export interface SidebarMutationMcp {
  toolsCall(name: string, args: Record<string, unknown>): Promise<unknown>
}

export type SidebarMutationEntity = 'document' | 'folder'
export type SidebarIdFactory = (entity: SidebarMutationEntity, label: string) => string

export interface SidebarMutationOptions {
  readonly idFactory?: SidebarIdFactory
}

/**
 * A mutation was rejected before Garden accepted it as successful. The marker is
 * structural so the mobile flow can classify this without importing a concrete
 * loopback or gateway transport class.
 */
export class SidebarMutationRejectedError extends Error {
  readonly mutationDelivery = 'rejected' as const

  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'SidebarMutationRejectedError'
  }
}

export interface CreateSidebarDocumentInput {
  readonly graphId: string
  readonly title: string
  readonly documentId?: string | null
  readonly parentId?: string | null
  readonly order?: number | null
  readonly documentKind?: string | null
  readonly dailyNoteDate?: string | null
  readonly dailyNoteTimeZone?: string | null
  /**
   * What gardend does when `documentId` already names a document. Unset, it
   * refuses (create never takes over a document, 2026-10-14); `keep` returns
   * the existing one untouched, for "make sure it exists".
   */
  readonly ifExists?: 'keep' | null
  /** A public Sophia's visitor: send no id; gardend names the document and says which (`documentId`). */
  readonly serverNamed?: boolean
}

export interface CreateSidebarFolderInput {
  readonly graphId: string
  readonly name: string
  readonly folderId?: string | null
  readonly parentId?: string | null
  readonly section?: string | null
  readonly order?: number | null
}

export interface RenameSidebarDocumentInput {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
}

export interface RenameSidebarFolderInput {
  readonly graphId: string
  readonly folderId: string
  readonly name: string
}

export interface DeleteSidebarDocumentInput {
  readonly graphId: string
  readonly documentId: string
}

export interface DeleteSidebarFolderInput {
  readonly graphId: string
  readonly folderId: string
  readonly cascade?: boolean
}

export interface MoveSidebarDocumentInput {
  readonly graphId: string
  readonly documentId: string
  readonly parentId: string | null
  readonly order?: number | null
}

export interface MoveSidebarDocumentResult {
  /** Null means the transport did not expose Garden's structured move result. */
  readonly moved: readonly string[] | null
  /** Null means the transport did not expose Garden's structured move result. */
  readonly missing: readonly string[] | null
  readonly parentId: string | null
}

export interface MoveSidebarFolderInput {
  readonly graphId: string
  readonly folderId: string
  readonly parentId: string | null
  readonly order?: number | null
}

export interface MakeSidebarDocumentEditableInput {
  readonly graphId: string
  readonly documentId: string
}

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new SidebarMutationRejectedError(`${label} is required`, true)
  return trimmed
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Extract the JSON value from the MCP text-content envelope used by both cell transports. */
function mutationResponseValue(result: unknown): Record<string, unknown> | null {
  const resultRecord = recordValue(result)
  const content = resultRecord?.content
  if (Array.isArray(content)) {
    const text = content
      .map(item => recordValue(item))
      .filter((item): item is Record<string, unknown> => item?.type === 'text' && typeof item.text === 'string')
      .map(item => item.text as string)
      .join('')
    if (text) {
      try {
        const parsed = recordValue(JSON.parse(text))
        if (parsed) return recordValue(parsed.value) ?? parsed
      } catch {
        // An opaque successful response is still successful; only a structured
        // `missing` result authorizes us to reject the move as not applied.
      }
    }
  }
  return recordValue(resultRecord?.value) ?? resultRecord
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return null
  return value
}

export function sidebarEntitySlug(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'untitled'
}

function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

export const defaultSidebarIdFactory: SidebarIdFactory = (entity, label) => {
  const prefix = entity === 'document' ? 'doc' : 'folder'
  return `${prefix}-${sidebarEntitySlug(label)}-${uniqueSuffix()}`
}

function idFor(
  entity: SidebarMutationEntity,
  label: string,
  provided: string | null | undefined,
  opts: SidebarMutationOptions,
): string {
  return optionalTrimmed(provided) ?? (opts.idFactory ?? defaultSidebarIdFactory)(entity, label)
}

export async function createSidebarDocument(
  mcp: SidebarMutationMcp,
  input: CreateSidebarDocumentInput,
  opts: SidebarMutationOptions = {},
): Promise<{ documentId: string; existed: boolean }> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const title = requiredTrimmed(input.title, 'title')
  // A public Sophia's visitor never names a new document: gardend gives it its id.
  const documentId = input.serverNamed ? undefined : idFor('document', title, input.documentId, opts)
  const result = await mcp.toolsCall('create_document', {
    graphId,
    ...(documentId ? { documentId } : {}),
    title,
    parentId: optionalTrimmed(input.parentId),
    order: input.order ?? null,
    documentKind: optionalTrimmed(input.documentKind),
    dailyNoteDate: optionalTrimmed(input.dailyNoteDate),
    dailyNoteTimeZone: optionalTrimmed(input.dailyNoteTimeZone),
    ...(input.ifExists ? { ifExists: input.ifExists } : {}),
  })
  const existed = typeof result === 'object' && result !== null && (result as { existed?: unknown }).existed === true
  if (documentId) return { documentId, existed }
  const named = createdDocumentId(result)
  if (!named) throw new Error('gardend did not say which document it made')
  return { documentId: named, existed }
}

/** The `documentId` of a `create_document` answer: the tools/call result's `structuredContent`, or its JSON text. */
function createdDocumentId(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const record = result as { documentId?: unknown; structuredContent?: unknown; content?: unknown }
  const direct = (value: unknown): string | null => {
    const id = typeof value === 'object' && value !== null ? (value as { documentId?: unknown }).documentId : undefined
    return typeof id === 'string' && id.trim() ? id.trim() : null
  }
  const found = direct(record) ?? direct(record.structuredContent)
  if (found) return found
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      const text = typeof item === 'object' && item !== null ? (item as { text?: unknown }).text : undefined
      if (typeof text !== 'string') continue
      try { const id = direct(JSON.parse(text)); if (id) return id } catch { /* not JSON */ }
    }
  }
  return null
}

export async function createSidebarFolder(
  mcp: SidebarMutationMcp,
  input: CreateSidebarFolderInput,
  opts: SidebarMutationOptions = {},
): Promise<{ folderId: string }> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const name = requiredTrimmed(input.name, 'name')
  const folderId = idFor('folder', name, input.folderId, opts)
  await mcp.toolsCall('create_folder', {
    graphId,
    folderId,
    name,
    parentId: optionalTrimmed(input.parentId),
    section: optionalTrimmed(input.section) ?? 'documents',
    order: input.order ?? null,
  })
  return { folderId }
}

export async function renameSidebarDocument(
  mcp: SidebarMutationMcp,
  input: RenameSidebarDocumentInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const documentId = requiredTrimmed(input.documentId, 'documentId')
  const title = requiredTrimmed(input.title, 'title')
  await mcp.toolsCall('rename', {
    graphId,
    entityType: 'document',
    entityId: documentId,
    newName: title,
  })
}

export async function renameSidebarFolder(
  mcp: SidebarMutationMcp,
  input: RenameSidebarFolderInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const folderId = requiredTrimmed(input.folderId, 'folderId')
  const name = requiredTrimmed(input.name, 'name')
  await mcp.toolsCall('rename', {
    graphId,
    entityType: 'folder',
    entityId: folderId,
    newName: name,
  })
}

export async function deleteSidebarDocument(
  mcp: SidebarMutationMcp,
  input: DeleteSidebarDocumentInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const documentId = requiredTrimmed(input.documentId, 'documentId')
  await mcp.toolsCall('delete_document', {
    graphId,
    documentId,
  })
}

export async function deleteSidebarFolder(
  mcp: SidebarMutationMcp,
  input: DeleteSidebarFolderInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const folderId = requiredTrimmed(input.folderId, 'folderId')
  await mcp.toolsCall('delete', {
    graphId,
    type: 'folder',
    folderId,
    cascade: input.cascade ?? false,
  })
}

export async function moveSidebarDocument(
  mcp: SidebarMutationMcp,
  input: MoveSidebarDocumentInput,
): Promise<MoveSidebarDocumentResult> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const documentId = requiredTrimmed(input.documentId, 'documentId')
  const parentId = optionalTrimmed(input.parentId)
  const response = await mcp.toolsCall('move_documents', {
    graphId,
    documentIds: [documentId],
    parentId,
    order: input.order ?? null,
  })
  const result = mutationResponseValue(response)
  const moved = stringList(result?.moved)
  const missing = stringList(result?.missing)
  if (missing?.includes(documentId)) {
    throw new SidebarMutationRejectedError(
      `Garden could not move ${documentId} because the document is missing. Refresh the file list before trying again.`,
    )
  }
  return {
    moved,
    missing,
    parentId: typeof result?.parentId === 'string' ? result.parentId : parentId,
  }
}

export async function moveSidebarFolder(
  mcp: SidebarMutationMcp,
  input: MoveSidebarFolderInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const folderId = requiredTrimmed(input.folderId, 'folderId')
  await mcp.toolsCall('move_folder', {
    graphId,
    folderId,
    newParentId: optionalTrimmed(input.parentId),
    newOrder: input.order ?? null,
  })
}

/**
 * Clear an imported document's read-only flag through gardend's authoritative
 * workspace-CRDT mutation. The tool flushes the workspace projection before it
 * resolves; callers may safely refresh their read model after this promise.
 */
export async function makeSidebarDocumentEditable(
  mcp: SidebarMutationMcp,
  input: MakeSidebarDocumentEditableInput,
): Promise<void> {
  const graphId = requiredTrimmed(input.graphId, 'graphId')
  const documentId = requiredTrimmed(input.documentId, 'documentId')
  await mcp.toolsCall('make_document_editable', { graphId, documentId })
}
