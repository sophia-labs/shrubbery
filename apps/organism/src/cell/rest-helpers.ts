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
import { cellAuthHeaders } from './cell-auth-headers.js'
import { ARTIFACT_TEXT_MAX_BYTES, ArtifactTextReadError, type ArtifactTextSnapshot } from './artifact-live-preview.js'
import { sha256Digest } from '@shrubbery/nucleus/web-crypto'

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
  const headers = cellRequestHeaders(contract)

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
  return cellAuthHeaders(contract)
}

export async function fetchArtifactBlob(contract: CellContract, graphId: string, artifactId: string): Promise<Blob> {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  const response = await fetch(
    `${apiBase}/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/download`,
    { headers: artifactRequestHeaders(contract), cache: 'no-store' },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `artifact download failed: ${response.status}`)
  }
  return response.blob()
}

/** Authoritative bounded UTF-8 read, never the mutable download cache or RDF. */
export async function fetchArtifactText(
  contract: CellContract,
  graphId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<ArtifactTextSnapshot> {
  const response = await fetch(
    graphCellUrl(contract, graphId, `/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/text`),
    { headers: artifactRequestHeaders(contract), cache: 'no-store', signal },
  )
  if (!response.ok) {
    throw new ArtifactTextReadError(`Artifact read failed (HTTP ${response.status}).`, [401, 403, 404, 410].includes(response.status))
  }
  // JSON escaping can multiply a UTF-8 byte by six. Bound even a faulty server
  // before parsing; the stricter content-byte limit is enforced again below.
  const limit = ARTIFACT_TEXT_MAX_BYTES * 6 + 8192
  const reader = response.body?.getReader()
  if (!reader) throw new ArtifactTextReadError('Artifact response has no body.', true)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) throw new ArtifactTextReadError('Artifact response exceeds the text limit.', true)
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: ArtifactTextSnapshot
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ArtifactTextSnapshot }
  catch { throw new ArtifactTextReadError('Artifact text response is malformed.', true) }
  if (!value || value.graphId !== graphId || value.artifactId !== artifactId
    || typeof value.graphIncarnation !== 'string' || !value.graphIncarnation.trim()
    || typeof value.filename !== 'string' || typeof value.text !== 'string'
    || typeof value.mimeType !== 'string' || !/^\s*text\/html\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(value.mimeType)
    || !/^[0-9a-f]{64}$/.test(value.contentHashSha256 ?? '')) {
    throw new ArtifactTextReadError('Artifact response does not describe this HTML artifact.', true)
  }
  const content = new TextEncoder().encode(value.text)
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content) !== value.text) {
    throw new ArtifactTextReadError('Artifact text is not exact valid UTF-8.', true)
  }
  if (content.byteLength > ARTIFACT_TEXT_MAX_BYTES || value.sizeBytes !== content.byteLength) {
    throw new ArtifactTextReadError('Artifact text size is invalid or too large.', true)
  }
  const digest = new Uint8Array(await sha256Digest(content))
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== value.contentHashSha256) throw new ArtifactTextReadError('Artifact content does not match its committed hash.', true)
  return value
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

class ArtifactTextRestoreOutcomeError extends Error {}

/** A text restore is a guarded write against the bytes the person confirmed.
 * Never fall back to the legacy restore endpoint and never retry a POST here.
 */
export async function restoreArtifactTextRevision(
  contract: CellContract,
  snapshot: ArtifactTextSnapshot,
  revisionId: string,
  operationId: string,
): Promise<void> {
  if (!snapshot.graphId || !snapshot.artifactId || !snapshot.graphIncarnation.trim()
    || !/^[a-f0-9]{64}$/.test(snapshot.contentHashSha256) || !revisionId || !operationId) {
    throw new Error('A verified current artifact identity is required to restore text.')
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 15_000)
  try {
    const response = await fetch(graphCellUrl(contract, snapshot.graphId,
      `/artifacts/${encodeURIComponent(snapshot.graphId)}/${encodeURIComponent(snapshot.artifactId)}/text/restore`), {
      method: 'POST', cache: 'no-store', signal: abort.signal,
      headers: { ...artifactRequestHeaders(contract), 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphIncarnation: snapshot.graphIncarnation,
        expectedContentSha256: snapshot.contentHashSha256, operationId, revisionId }),
    })
    if (!response.ok) {
      throw new ArtifactTextRestoreOutcomeError(`Text restore was not confirmed (HTTP ${response.status}). Refresh and inspect the artifact before trying again. Operation: ${operationId}`)
    }
    const receipt = await response.json() as Record<string, unknown>
    if (!receipt || receipt.status !== 'committed' || receipt.artifactId !== snapshot.artifactId
      || receipt.graphIncarnation !== snapshot.graphIncarnation || receipt.operationId !== operationId
      || typeof receipt.contentHashSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.contentHashSha256)
      || receipt.refreshPending !== false) {
      throw new ArtifactTextRestoreOutcomeError(`Text restore returned an unverified receipt. Refresh and inspect the artifact. Operation: ${operationId}`)
    }
  } catch (error) {
    if (error instanceof ArtifactTextRestoreOutcomeError) throw error
    throw new ArtifactTextRestoreOutcomeError(`Text restore outcome is uncertain. Refresh and inspect before retrying. Operation: ${operationId}`, { cause: error })
  } finally { clearTimeout(timer) }
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
