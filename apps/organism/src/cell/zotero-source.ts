/**
 * Shell-side Zotero source adapter.
 *
 * The controlled `mn-zotero-source-workbench` receives plain render props. This
 * file owns the local-cell HTTP shape: Zotero item JSON, source annotations,
 * incoming artifact wires, and idempotent source materialization.
 */

import type {
  CitationPickerItem,
  ZoteroSourceAnnotation,
  ZoteroSourceIncomingWire,
  ZoteroSourceItem,
} from '@shrubbery/runtime'
import type { ShrubberyContract } from '@shrubbery/nucleus'

type ZoteroCellContract = Pick<ShrubberyContract, 'auth' | 'runtime'>

export interface ZoteroSourceRead {
  readonly item: ZoteroSourceItem | null
  readonly annotations: readonly ZoteroSourceAnnotation[]
  readonly incomingWires: readonly ZoteroSourceIncomingWire[]
  readonly error: string | null
}

export const QUOTES_FROM_PREDICATE = 'http://mnemosyne.ai/vocab#quotesFrom'
export const CITES_EVIDENCE_PREDICATE = 'http://mnemosyne.ai/vocab#citesEvidence'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function headers(contract: ZoteroCellContract): Record<string, string> {
  const h: Record<string, string> = { 'X-User-ID': contract.auth.userId() }
  const token = contract.auth.token()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function fetchJson<T>(
  contract: ZoteroCellContract,
  graphId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiBase = trimTrailingSlash(contract.runtime.graphBaseUrl(graphId))
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...headers(contract),
      ...(init.headers ?? {}),
    },
    cache: init.cache ?? 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `Zotero request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function yearFrom(...values: unknown[]): string | null {
  for (const value of values) {
    const raw = text(value)
    if (!raw) continue
    const match = /\d{4}/.exec(raw)
    if (match) return match[0]
  }
  return null
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function tagsFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const raw = typeof entry === 'string' ? entry : objectValue(entry).tag
    const tag = text(raw)
    const key = tag?.toLowerCase()
    if (!tag || !key || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export function zoteroKeyFromArtifactId(artifactId: string): string {
  return artifactId.trim().replace(/^zot-/, '')
}

export function artifactIdFromZoteroKey(key: string): string {
  const clean = key.trim().replace(/^zot-/, '')
  return clean ? `zot-${clean}` : ''
}

export function normalizeZoteroItem(raw: unknown, fallbackKey: string): ZoteroSourceItem {
  const root = objectValue(raw)
  const data = objectValue(root.data)
  const meta = objectValue(root.meta)
  const key = text(root.key) ?? text(data.key) ?? fallbackKey
  return {
    key,
    title: text(data.title) ?? text(root.title) ?? null,
    label: text(root.label) ?? text(data.label) ?? null,
    itemType: text(data.itemType) ?? text(root.itemType) ?? null,
    creatorSummary: text(meta.creatorSummary) ?? text(root.creatorSummary) ?? null,
    year: yearFrom(meta.parsedDate, root.year, data.date),
    abstractNote: text(data.abstractNote) ?? text(root.abstractNote) ?? null,
    tags: tagsFrom(data.tags ?? root.tags),
  }
}

export function normalizeCitationSearchItem(raw: unknown): CitationPickerItem | null {
  const row = objectValue(raw)
  const key = text(row.key) ?? text(row.id)
  if (!key) return null
  return {
    key,
    title: text(row.title) ?? text(row.label) ?? key,
    citation: text(row.citation),
    itemType: text(row.itemType) ?? text(row.item_type),
    creatorSummary: text(row.creatorSummary) ?? text(row.creator_summary),
    year: yearFrom(row.year, row.date),
  }
}

export function normalizeZoteroAnnotation(raw: unknown): ZoteroSourceAnnotation | null {
  const row = objectValue(raw)
  const key = text(row.key) ?? text(row.id)
  if (!key) return null
  return {
    key,
    kind: text(row.kind) ?? 'annotation',
    text: text(row.text),
    comment: text(row.comment),
    color: text(row.color),
    page: text(row.page),
  }
}

export function normalizeIncomingWire(raw: unknown): ZoteroSourceIncomingWire | null {
  const row = objectValue(raw)
  const id = text(row.id) ?? text(row.wireId) ?? text(row.wire_id)
  if (!id) return null
  return {
    id,
    predicateLabel: text(row.predicateLabel) ?? text(row.predicate_label),
    otherDocumentId: text(row.otherDocumentId) ?? text(row.other_document_id),
    otherBlockId: text(row.otherBlockId) ?? text(row.other_block_id),
    otherTitle: text(row.otherTitle) ?? text(row.other_title),
    otherSnippet: text(row.otherSnippet) ?? text(row.other_snippet),
  }
}

export async function materializeZoteroSource(
  contract: ZoteroCellContract,
  graphId: string,
  zoteroKey: string,
): Promise<unknown> {
  return fetchJson<unknown>(
    contract,
    graphId,
    `/zotero/${encodeURIComponent(graphId)}/sources`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: zoteroKey }),
    },
  )
}

export function materializedSourceArtifactId(raw: unknown, fallbackKey: string): string {
  const row = objectValue(raw)
  return (
    text(row.artifactId) ??
    text(row.artifact_id) ??
    text(row.id) ??
    artifactIdFromZoteroKey(fallbackKey)
  )
}

export async function searchZoteroItems(
  contract: ZoteroCellContract,
  graphId: string,
  query: string,
  limit = 20,
): Promise<readonly CitationPickerItem[]> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) })
  const rows = await fetchJson<unknown[]>(
    contract,
    graphId,
    `/zotero/${encodeURIComponent(graphId)}/search?${qs.toString()}`,
  )
  return Array.isArray(rows)
    ? rows.map(normalizeCitationSearchItem).filter((item): item is CitationPickerItem => item !== null)
    : []
}

export interface ZoteroGroundingWireRequest {
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string | null
  readonly targetArtifactId: string
  readonly targetGraphId?: string | null
  readonly predicate?: string
}

export async function createZoteroGroundingWire(
  contract: ZoteroCellContract,
  graphId: string,
  request: ZoteroGroundingWireRequest,
): Promise<unknown> {
  return fetchJson<unknown>(
    contract,
    graphId,
    `/wires/${encodeURIComponent(graphId)}/document/${encodeURIComponent(request.sourceDocumentId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_block_id: request.sourceBlockId || null,
        target_kind: 'artifact',
        target_graph_id: request.targetGraphId || graphId,
        target_artifact_id: request.targetArtifactId,
        predicate: request.predicate ?? CITES_EVIDENCE_PREDICATE,
        bidirectional: false,
      }),
    },
  )
}

export async function loadZoteroSource(
  contract: ZoteroCellContract,
  graphId: string,
  artifactId: string,
  zoteroKey = zoteroKeyFromArtifactId(artifactId),
): Promise<ZoteroSourceRead> {
  const key = zoteroKey.trim()
  if (!key) throw new Error(`Zotero source artifact has no key: ${artifactId}`)
  const [itemRes, wiresRes, annotationsRes] = await Promise.allSettled([
    fetchJson<unknown>(contract, graphId, `/zotero/items/${encodeURIComponent(key)}`),
    fetchJson<unknown[]>(contract, graphId, `/wires/${encodeURIComponent(graphId)}/artifact/${encodeURIComponent(artifactId)}/incoming`),
    fetchJson<unknown[]>(contract, graphId, `/zotero/${encodeURIComponent(graphId)}/sources/${encodeURIComponent(key)}/annotations`),
  ])

  const item = itemRes.status === 'fulfilled' ? normalizeZoteroItem(itemRes.value, key) : null
  const incomingWires = wiresRes.status === 'fulfilled' && Array.isArray(wiresRes.value)
    ? wiresRes.value.map(normalizeIncomingWire).filter((wire): wire is ZoteroSourceIncomingWire => wire !== null)
    : []
  const annotations = annotationsRes.status === 'fulfilled' && Array.isArray(annotationsRes.value)
    ? annotationsRes.value.map(normalizeZoteroAnnotation).filter((annotation): annotation is ZoteroSourceAnnotation => annotation !== null)
    : []

  const errors = [itemRes, wiresRes, annotationsRes]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
  return {
    item,
    incomingWires,
    annotations,
    error: errors.length ? errors.join('\n') : null,
  }
}
