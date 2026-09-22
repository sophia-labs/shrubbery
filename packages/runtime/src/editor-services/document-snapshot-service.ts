/**
 * document-snapshot-service.ts — the document version-history REST transport.
 *
 * WHY THIS FILE EXISTS: `apps/organism/src/main.ts` already calls this exact
 * REST surface (`documentSnapshotBaseUrl`/`fetchDocumentSnapshotJson`/
 * `fetchDocumentSnapshotText`/`fetchDocumentSnapshotVoid` + its own
 * `HostedDocumentSnapshotEntry` normalizer) to drive the production
 * `mn-doc-history-panel` modal takeover — but only as private, app-local
 * functions closed over `OrganismCellContract`. The `doc.history` P2 face
 * (`layout/faces/doc-history-face.ts`) needs the SAME transport from inside
 * `@shrubbery/runtime`, which cannot import an app. This module is that
 * transport, hoisted to the same real routes/behavior (mirrors
 * `collab/editor-room-pool.ts`'s own "hoisted... verbatim" precedent), but
 * decoupled from any one app's contract type: it takes a minimal
 * `DocumentSnapshotTransport` (a base URL resolver + a headers() supplier)
 * rather than `OrganismCellContract`/`ShrubberyContract` directly, so any
 * caller — the harness's same-origin `/cell` proxy today, a hosted gateway
 * contract tomorrow — can satisfy it without a new nucleus contract field.
 *
 * `apps/organism/src/main.ts`'s own copy is UNTOUCHED by this file (this
 * wave's rule is "change of mount, not rewrite" — de-duplicating the
 * monolith's inline copy is a separate, later cleanup, not attempted here).
 * Every route/verb/query-param below is byte-for-byte the same contract
 * organism's inline version already exercises in production.
 */
import type { DocHistorySnapshot } from '../render-workspace.js'

export interface DocumentSnapshotTransport {
  /** Same-origin or absolute REST base for `graphId` — NO trailing slash guaranteed by the caller. */
  resolveBaseUrl(graphId: string): string
  /** Extra request headers (auth) — called fresh per request, never cached. */
  headers(): Record<string, string>
}

export interface DocumentSnapshotListResult {
  readonly snapshots: readonly DocHistorySnapshot[]
  readonly totalCount: number
}

export interface DocumentSnapshotService {
  list(graphId: string, documentId: string, limit?: number): Promise<DocumentSnapshotListResult>
  readText(graphId: string, documentId: string, snapshotId: string): Promise<string>
  readHtml(graphId: string, documentId: string, snapshotId: string): Promise<string>
  /** POST a manual snapshot of the document's CURRENT persisted state. Returns the new snapshot's id, when the response carries one. */
  save(graphId: string, documentId: string): Promise<string | null>
  /** Copy a snapshot into a labeled, retained bookmark. */
  bookmark(graphId: string, documentId: string, snapshotId: string, label: string): Promise<void>
  remove(graphId: string, documentId: string, snapshotId: string): Promise<void>
}

// ── wire shape (mirrors organism's HostedDocumentSnapshotEntry exactly) ────

interface HostedDocumentSnapshotEntry {
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

interface HostedDocumentSnapshotListResponse {
  readonly snapshots?: readonly HostedDocumentSnapshotEntry[]
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function snapshotNumber(left: number | undefined, right: number | undefined): number | null {
  return typeof left === 'number' ? left : typeof right === 'number' ? right : null
}

/**
 * Real-cell finding: gardend's snapshot routes return `created_at` as a
 * bare epoch-milliseconds STRING (e.g. `"1784303881647"`), never ISO-8601.
 * `mn-doc-history-panel`'s own `timestamp()` helper handles a `number`
 * directly but runs a plain STRING through `Date.parse()` — which cannot
 * parse a bare numeric string (`Date.parse('1784303881647')` is `NaN`) and
 * silently falls back to epoch (renders "Dec 31, 1969"). Coerce a
 * purely-numeric string to a real number here so the panel's own
 * `typeof value === 'number'` branch is what actually renders it.
 * `apps/organism/src/main.ts`'s own inline copy of this normalizer carries
 * the identical bug — undiscovered until this face's real-cell proof
 * (`apps/organism/scripts/layout-workbench-gardend-browser.mts`) actually
 * looked at a rendered timestamp; worth the same fix there whenever that
 * copy is next touched.
 */
function normalizeCreatedAt(value: string): string | number {
  return /^\d+$/.test(value) ? Number(value) : value
}

function normalizeDocumentSnapshot(
  entry: HostedDocumentSnapshotEntry,
  fallbackGraphId: string,
  fallbackDocumentId: string,
): DocHistorySnapshot | null {
  const id = entry.snapshot_id ?? entry.snapshotId
  const rawCreatedAt = entry.created_at ?? entry.createdAt
  if (!id || !rawCreatedAt) return null
  return {
    id,
    graphId: entry.graph_id ?? entry.graphId ?? fallbackGraphId,
    documentId: entry.doc_id ?? entry.document_id ?? entry.documentId ?? fallbackDocumentId,
    label: entry.label ?? null,
    createdAt: normalizeCreatedAt(rawCreatedAt),
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

/** Build the real `@shrubbery/runtime` `DocumentSnapshotService` over `transport`. Every method is a real `fetch()` — no caching, no batching, no offline queue. */
export function createDocumentSnapshotService(
  transport: DocumentSnapshotTransport,
  fetchImpl: typeof fetch = fetch,
): DocumentSnapshotService {
  function baseUrl(graphId: string, documentId: string): string {
    const apiBase = trimTrailingSlash(transport.resolveBaseUrl(graphId))
    return `${apiBase}/v1/documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}/snapshots`
  }

  async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...transport.headers(), ...(init.headers ?? {}) },
      cache: init.cache ?? 'no-store',
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(detail || `snapshot request failed: ${response.status}`)
    }
    return response.json() as Promise<T>
  }

  async function requestText(url: string): Promise<string> {
    const response = await fetchImpl(url, { headers: transport.headers(), cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(detail || `snapshot read failed: ${response.status}`)
    }
    return response.text()
  }

  async function requestVoid(url: string, init: RequestInit): Promise<void> {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...transport.headers(), ...(init.headers ?? {}) },
      cache: init.cache ?? 'no-store',
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(detail || `snapshot request failed: ${response.status}`)
    }
  }

  return {
    async list(graphId, documentId, limit = 200) {
      const base = baseUrl(graphId, documentId)
      const cappedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
      const [list, count] = await Promise.all([
        requestJson<HostedDocumentSnapshotListResponse>(`${base}?limit=${cappedLimit}`),
        requestJson<{ count?: number }>(`${base}/count`).catch(() => ({ count: undefined })),
      ])
      const snapshots = (list.snapshots ?? [])
        .map((entry) => normalizeDocumentSnapshot(entry, graphId, documentId))
        .filter((snapshot): snapshot is DocHistorySnapshot => snapshot !== null)
      return { snapshots, totalCount: typeof count.count === 'number' ? count.count : snapshots.length }
    },
    readText(graphId, documentId, snapshotId) {
      return requestText(`${baseUrl(graphId, documentId)}/${encodeURIComponent(snapshotId)}/text`)
    },
    readHtml(graphId, documentId, snapshotId) {
      return requestText(`${baseUrl(graphId, documentId)}/${encodeURIComponent(snapshotId)}/html`)
    },
    async save(graphId, documentId) {
      const created = await requestJson<HostedDocumentSnapshotEntry>(baseUrl(graphId, documentId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      return created.snapshot_id ?? created.snapshotId ?? null
    },
    async bookmark(graphId, documentId, snapshotId, label) {
      await requestJson<HostedDocumentSnapshotEntry>(
        `${baseUrl(graphId, documentId)}/${encodeURIComponent(snapshotId)}/copy`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) },
      )
    },
    remove(graphId, documentId, snapshotId) {
      return requestVoid(`${baseUrl(graphId, documentId)}/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' })
    },
  }
}
