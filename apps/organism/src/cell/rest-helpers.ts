/**
 * Shell-side REST/fetch helpers for the gardend cell: artifact image upload,
 * artifact blob + revision history fetching, and the document-snapshot fetch
 * trio. Extracted verbatim from main.ts to shrink the god-file and sit next to
 * the rest of the already-tested cell/ tier.
 *
 * These are contract-parameterized and hold NO module-level state: every call
 * takes the cell contract explicitly. They are typed against `CellContract`
 * (not the organism's mcp-extended alias) because none of them read `.mcp` —
 * the honest minimal surface, so any cell-backed contract can drive them.
 *
 * Errors surface verbatim (the gardend error body or the HTTP status), never a
 * silent fallback — matching the shell's no-faked-fallback contract.
 */

import type { EditorImageInsert, ArtifactHistoryRevision, DocHistorySnapshot } from '@shrubbery/runtime'
import type { CellContract } from './session-store.js'
import { gardendResponseError } from './document-transfer.js'

const IMAGE_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function artifactUrl(apiBase: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${trimTrailingSlash(apiBase)}${path}`
}

export function graphCellUrl(contract: CellContract, graphId: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))}${suffix}`
}

function imageAltFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.type = 'file'
    input.accept = IMAGE_UPLOAD_ACCEPT
    input.style.display = 'none'
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}

export async function uploadImageForEditor(contract: CellContract, graphId: string, file: File): Promise<EditorImageInsert> {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  const headers: Record<string, string> = { 'X-User-ID': contract.auth.userId() }
  const token = contract.auth.token()
  if (token) headers.Authorization = `Bearer ${token}`

  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${apiBase}/artifacts/${encodeURIComponent(graphId)}/images/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await gardendResponseError(response, `image upload failed: HTTP ${response.status}`))
  }

  const result = await response.json() as { src?: unknown }
  if (typeof result.src !== 'string' || result.src.trim() === '') {
    throw new Error('image upload response did not include src')
  }
  return {
    src: artifactUrl(apiBase, result.src.trim()),
    alt: imageAltFromFileName(file.name),
    size: 'large',
  }
}

function artifactRequestHeaders(contract: CellContract): Record<string, string> {
  return cellRequestHeaders(contract)
}

export function cellRequestHeaders(contract: CellContract): Record<string, string> {
  const headers: Record<string, string> = { 'X-User-ID': contract.auth.userId() }
  const token = contract.auth.token()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchArtifactBlob(contract: CellContract, graphId: string, artifactId: string): Promise<Blob> {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  const response = await fetch(
    `${apiBase}/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/download`,
    { headers: artifactRequestHeaders(contract) },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact download failed: ${response.status}`)
  }
  return response.blob()
}

interface HostedArtifactRevisionEntry {
  readonly revision_id?: string
  readonly revisionId?: string
  readonly id?: string
  readonly created_at?: string | number
  readonly createdAt?: string | number
  readonly trigger?: string | null
  readonly label?: string | null
  readonly filename?: string | null
  readonly file_name?: string | null
  readonly mime_type?: string | null
  readonly mimeType?: string | null
  readonly size_bytes?: number | string | null
  readonly sizeBytes?: number | string | null
}

export interface HostedArtifactRevisionListResponse {
  readonly revisions?: readonly HostedArtifactRevisionEntry[]
}

function artifactRevisionBaseUrl(contract: CellContract, graphId: string, artifactId: string): string {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  return `${apiBase}/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/revisions`
}

export async function fetchArtifactRevisionList(
  contract: CellContract,
  graphId: string,
  artifactId: string,
): Promise<HostedArtifactRevisionListResponse> {
  const response = await fetch(artifactRevisionBaseUrl(contract, graphId, artifactId), {
    headers: artifactRequestHeaders(contract),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact revision list failed: ${response.status}`)
  }
  return response.json() as Promise<HostedArtifactRevisionListResponse>
}

export async function fetchArtifactRevisionBlob(
  contract: CellContract,
  graphId: string,
  artifactId: string,
  revisionId: string,
): Promise<Blob> {
  const response = await fetch(
    `${artifactRevisionBaseUrl(contract, graphId, artifactId)}/${encodeURIComponent(revisionId)}/download`,
    {
      headers: artifactRequestHeaders(contract),
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact revision download failed: ${response.status}`)
  }
  return response.blob()
}

export async function restoreArtifactRevision(
  contract: CellContract,
  graphId: string,
  artifactId: string,
  revisionId: string,
): Promise<void> {
  const response = await fetch(
    `${artifactRevisionBaseUrl(contract, graphId, artifactId)}/${encodeURIComponent(revisionId)}/restore`,
    {
      method: 'POST',
      headers: artifactRequestHeaders(contract),
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact revision restore failed: ${response.status}`)
  }
}

function dataUrlBase64Payload(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',')
  const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : ''
  if (!payload) throw new Error('artifact editor did not provide image data')
  return payload
}

export async function postArtifactRevision(
  contract: CellContract,
  graphId: string,
  artifactId: string,
  dataUrl: string,
  mimeType: string,
  label: string,
): Promise<void> {
  const response = await fetch(artifactRevisionBaseUrl(contract, graphId, artifactId), {
    method: 'POST',
    headers: {
      ...artifactRequestHeaders(contract),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ dataBase64: dataUrlBase64Payload(dataUrl), mimeType, label }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact revision save failed: ${response.status}`)
  }
}

function revisionString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function revisionNumber(left: number | string | null | undefined, right: number | string | null | undefined): number | null {
  const value = left ?? right
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeArtifactRevision(entry: HostedArtifactRevisionEntry): ArtifactHistoryRevision | null {
  const revisionId = revisionString(entry.revision_id) ?? revisionString(entry.revisionId) ?? revisionString(entry.id)
  if (!revisionId) return null
  return {
    revisionId,
    createdAt: entry.created_at ?? entry.createdAt ?? Date.now(),
    trigger: revisionString(entry.trigger) ?? undefined,
    label: revisionString(entry.label),
    filename: revisionString(entry.filename) ?? revisionString(entry.file_name),
    mimeType: revisionString(entry.mime_type) ?? revisionString(entry.mimeType),
    sizeBytes: revisionNumber(entry.size_bytes, entry.sizeBytes),
  }
}

export interface HostedDocumentSnapshotEntry {
  readonly snapshot_id?: string
  readonly snapshotId?: string
  readonly graph_id?: string
  readonly graphId?: string
  readonly doc_id?: string
  readonly document_id?: string
  readonly documentId?: string
  readonly created_at?: string
  readonly createdAt?: string
  readonly tier?: string | null
  readonly label?: string | null
  readonly is_manual?: boolean
  readonly isManual?: boolean
  readonly snapshot_count?: number
  readonly snapshotCount?: number
  readonly chars_added?: number
  readonly charsAdded?: number
  readonly chars_removed?: number
  readonly charsRemoved?: number
  readonly blocks_added?: number
  readonly blocksAdded?: number
  readonly blocks_removed?: number
  readonly blocksRemoved?: number
  readonly blocks_modified?: number
  readonly blocksModified?: number
}

export interface HostedDocumentSnapshotListResponse {
  readonly snapshots?: readonly HostedDocumentSnapshotEntry[]
}

function documentSnapshotBaseUrl(contract: CellContract, graphId: string, documentId: string): string {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  return `${apiBase}/v1/documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}/snapshots`
}

export async function fetchDocumentSnapshotJson<T>(
  contract: CellContract,
  graphId: string,
  documentId: string,
  suffix = '',
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${documentSnapshotBaseUrl(contract, graphId, documentId)}${suffix}`, {
    ...init,
    headers: {
      ...cellRequestHeaders(contract),
      ...(init.headers ?? {}),
    },
    cache: init.cache ?? 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `snapshot request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function fetchDocumentSnapshotText(
  contract: CellContract,
  graphId: string,
  documentId: string,
  snapshotId: string,
  format: 'text' | 'html',
): Promise<string> {
  const response = await fetch(
    `${documentSnapshotBaseUrl(contract, graphId, documentId)}/${encodeURIComponent(snapshotId)}/${format}`,
    {
      headers: cellRequestHeaders(contract),
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `snapshot ${format} read failed: ${response.status}`)
  }
  return response.text()
}

export async function fetchDocumentSnapshotVoid(
  contract: CellContract,
  graphId: string,
  documentId: string,
  suffix: string,
  init: RequestInit,
): Promise<void> {
  const response = await fetch(`${documentSnapshotBaseUrl(contract, graphId, documentId)}${suffix}`, {
    ...init,
    headers: {
      ...cellRequestHeaders(contract),
      ...(init.headers ?? {}),
    },
    cache: init.cache ?? 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `snapshot request failed: ${response.status}`)
  }
}

function snapshotNumber(left: number | undefined, right: number | undefined): number | null {
  return typeof left === 'number' ? left : typeof right === 'number' ? right : null
}

export function normalizeDocumentSnapshot(
  entry: HostedDocumentSnapshotEntry,
  fallbackGraphId: string,
  fallbackDocumentId: string,
): DocHistorySnapshot | null {
  const id = entry.snapshot_id ?? entry.snapshotId
  const createdAt = entry.created_at ?? entry.createdAt
  if (!id || !createdAt) return null
  return {
    id,
    graphId: entry.graph_id ?? entry.graphId ?? fallbackGraphId,
    documentId: entry.doc_id ?? entry.document_id ?? entry.documentId ?? fallbackDocumentId,
    label: entry.label ?? null,
    createdAt,
    tier: entry.tier ?? null,
    isManual: entry.is_manual ?? entry.isManual ?? false,
    snapshotCount: snapshotNumber(entry.snapshot_count, entry.snapshotCount),
    charsAdded: snapshotNumber(entry.chars_added, entry.charsAdded),
    charsRemoved: snapshotNumber(entry.chars_removed, entry.charsRemoved),
    blocksAdded: snapshotNumber(entry.blocks_added, entry.blocksAdded),
    blocksRemoved: snapshotNumber(entry.blocks_removed, entry.blocksRemoved),
    blocksModified: snapshotNumber(entry.blocks_modified, entry.blocksModified),
  }
}
