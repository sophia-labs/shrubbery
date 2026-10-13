/**
 * "Show info" (Finder's Get Info) for the Files pane: the facts of the selected items as one panel model, and the lazy reading of
 * what the shell does not already hold. The panel itself is `<mn-file-info>`; the shell owns when it opens and closes.
 *
 * What is free: the workspace tree (name, kind, location, size, type) and the place's batched evidence (a kind's own `info` block).
 * What is read once the panel is open, for the one selected item only: the listing's record (dates, who, digest), the file's revisions,
 * a document's digest (words) and the item's wires. Nothing here is asked per visible card.
 */
import { CORROBORATION_MARK, CORROBORATION_WORDS, type FileEvidence } from '@shrubbery/nucleus'
import type { WorkspaceFileInfoModel, WorkspaceFileInfoRow } from '@shrubbery/runtime'
import type { FilesClient } from './files-contract.js'
import type { FilesEntryKind } from './files-commands.js'
import { formatFileSize } from './files-policy.js'

/** What the panel reads for one item beyond the tree. A field the cell does not state stays null and its row is not drawn. */
export interface InfoDetail {
  readonly sizeBytes: number | null
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly createdBy: string | null
  readonly updatedBy: string | null
  readonly sha256: string | null
  readonly revisions: number | null
  readonly wordCount: number | null
}

export interface InfoWire {
  readonly id: string
  readonly direction: 'out' | 'in'
  readonly label: string
  /** The other end, as a tree key (`artifact:ID`), and its name. */
  readonly otherKey: string
  readonly otherName: string
}

export interface InfoItem {
  readonly key: string
  readonly kind: FilesEntryKind
  readonly id: string
  readonly label: string
  readonly mimeType: string | null
  /** The file-type caption ('PDF'), '' when unknown. */
  readonly caption: string
  readonly sizeBytes: number | null
}

export interface InfoContext {
  readonly items: readonly InfoItem[]
  /** A folder id (null: the top of Files) → its path in words, for the Location row. */
  readonly location: (item: InfoItem) => { readonly text: string; readonly action: string }
  /** For a folder: how many items it holds directly, and the files in all of it. */
  readonly contents: (folderId: string) => { readonly direct: number; readonly files: number; readonly bytes: number; readonly unknown: number }
  /** For several: the files in all of the selection (folders included), and their known bytes. */
  readonly scope: () => { readonly files: number; readonly bytes: number; readonly unknown: number }
  readonly detail: InfoDetail | null
  readonly detailStatus: 'loading' | 'ready' | 'error'
  readonly wires: readonly InfoWire[] | null
  readonly evidence: FileEvidence | undefined
  readonly writable: boolean
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** The listing record, the revisions and the digest, folded into one detail. Each part degrades alone. */
export async function readInfoDetail(client: FilesClient, graphId: string, item: Pick<InfoItem, 'kind' | 'id' | 'sizeBytes'>): Promise<InfoDetail> {
  const empty: InfoDetail = { sizeBytes: item.sizeBytes, createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, sha256: null, revisions: null, wordCount: null }
  if (item.kind === 'folder') return empty
  const rec = await client.listingRecord(graphId, item.kind, item.id).catch(() => null)
  let detail: InfoDetail = { ...empty,
    sizeBytes: num(rec?.sizeBytes ?? rec?.size) ?? item.sizeBytes,
    createdAt: text(rec?.createdAt), updatedAt: text(rec?.updatedAt) ?? text(rec?.lastModified),
    createdBy: text(rec?.createdByName) ?? text(rec?.createdBy), updatedBy: text(rec?.updatedByName) ?? text(rec?.updatedBy),
    sha256: text(rec?.sha256) ?? text(rec?.contentHashSha256) ?? text(rec?.contentHash) }
  if (item.kind === 'artifact') {
    const [revisions, digest] = await Promise.all([
      client.tool('list_artifact_revisions', { graphId, artifactId: item.id }).then(r => (Array.isArray(r.revisions) ? r.revisions.length : null)).catch(() => null),
      detail.sha256 || (detail.sizeBytes ?? 0) > 8 * 1024 * 1024 ? Promise.resolve(detail.sha256) : sha256Of(client, graphId, item.id),
    ])
    detail = { ...detail, revisions, sha256: digest }
  } else {
    const digest = await client.tool('document_digest', { graphId, documentId: item.id }).catch((): Record<string, unknown> => ({}))
    const size = digest.size as Record<string, unknown> | undefined
    const fresh = digest.freshness as Record<string, unknown> | undefined
    detail = { ...detail, wordCount: num(size?.wordCount ?? size?.word_count),
      createdAt: detail.createdAt ?? text(fresh?.createdAt), updatedAt: detail.updatedAt ?? text(fresh?.updatedAt) }
  }
  return detail
}

/** The file's digest when the cell's listing does not state one: its bytes, hashed here (small files only). */
async function sha256Of(client: FilesClient, graphId: string, id: string): Promise<string | null> {
  try {
    const bytes = await (await client.download(graphId, id)).arrayBuffer()
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

/** "Oct 8, 2026, 3:04 PM". */
export function infoDate(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const row = (label: string, value: string | null | undefined, extra: Partial<WorkspaceFileInfoRow> = {}): WorkspaceFileInfoRow[] => value ? [{ label, text: value, ...extra }] : []

function kindWord(item: InfoItem): string {
  return item.kind === 'folder' ? 'Folder' : item.kind === 'document' ? 'Document' : item.caption ? `${item.caption} file` : 'File'
}

function sizeWords(bytes: number, files: number, unknown: number): string {
  if (!files) return '0 bytes'
  return `${formatFileSize(bytes)}${unknown ? ` (${plural(unknown, 'file')} unknown)` : ''}`
}

function byWhom(at: string | null, who: string | null): string | null {
  const when = infoDate(at)
  return when ? `${when}${who ? ` by ${who}` : ''}` : who ? `by ${who}` : null
}

/** The panel for the selection: one item in full, several as a summary. */
export function buildInfoModel(ctx: InfoContext): WorkspaceFileInfoModel | null {
  const { items } = ctx
  if (!items.length) return null
  if (items.length > 1) {
    const folders = items.filter(i => i.kind === 'folder').length
    const documents = items.filter(i => i.kind === 'document').length
    const files = items.length - folders - documents
    const scope = ctx.scope()
    const kinds = new Map<string, number>()
    for (const i of items) kinds.set(kindWord(i).replace(/ file$/, ''), (kinds.get(kindWord(i).replace(/ file$/, '')) ?? 0) + 1)
    return { title: plural(items.length, 'item'), typeLabel: [files ? plural(files, 'file') : '', documents ? plural(documents, 'document') : '', folders ? plural(folders, 'folder') : ''].filter(Boolean).join(' · '),
      icon: 'folder', sections: [{ id: 'summary', title: 'Selection', rows: [
        { label: 'Items', text: String(items.length) },
        { label: 'Total size', text: sizeWords(scope.bytes, scope.files, scope.unknown), title: folders ? 'Including everything inside the selected folders' : '' },
        { label: 'Kinds', text: [...kinds].map(([k, n]) => `${k} ${n}`).join(', ') },
      ] }] }
  }
  const item = items[0]!
  const d = ctx.detail
  const rows: WorkspaceFileInfoRow[] = []
  const loc = ctx.location(item)
  rows.push({ label: 'Kind', text: kindWord(item) }, { label: 'Where', text: loc.text, action: loc.action, title: 'Open this folder' })
  if (item.kind === 'folder') {
    const c = ctx.contents(item.id)
    rows.push({ label: 'Contains', text: `${plural(c.direct, 'item')}${c.files ? ` · ${plural(c.files, 'file')} in all` : ''}` },
      { label: 'Size', text: sizeWords(c.bytes, c.files, c.unknown) })
  } else {
    const size = d?.sizeBytes ?? item.sizeBytes
    rows.push(...row('Size', size === null ? null : formatFileSize(size)))
  }
  rows.push(...row('Created', byWhom(d?.createdAt ?? null, d?.createdBy ?? null)), ...row('Modified', byWhom(d?.updatedAt ?? null, d?.updatedBy ?? null)))
  rows.push({ label: 'ID', text: item.id, mono: true, copy: true })
  const sections: WorkspaceFileInfoModel['sections'][number][] = [{ id: 'general', title: 'General', rows }]
  if (item.kind === 'artifact') {
    sections.push({ id: 'file', title: 'File', rows: [
      ...row('MIME type', item.mimeType, { mono: true }),
      ...(d?.sha256 ? [{ label: 'SHA-256', text: `${d.sha256.slice(0, 8)}…${d.sha256.slice(-6)}`, mono: true, copy: true, copyText: d.sha256, title: d.sha256 }] : []),
      ...(d?.revisions !== null && d?.revisions !== undefined ? [{ label: 'Revisions', text: String(d.revisions) }] : []),
    ] })
  } else if (item.kind === 'document') {
    sections.push({ id: 'document', title: 'Document', rows: [
      ...(d?.wordCount !== null && d?.wordCount !== undefined ? [{ label: 'Words', text: new Intl.NumberFormat('en').format(d.wordCount) }] : []),
      ...row('Last edited', infoDate(d?.updatedAt ?? null)),
    ] })
  }
  if (ctx.evidence?.info) {
    for (const [n, section] of ctx.evidence.info.entries()) {
      sections.push({ id: `kind-${ctx.evidence.kind}-${n}`, title: section.title, rows: section.rows.map(r => ({ label: r.label, text: r.text,
        ...(r.mark ? { mark: CORROBORATION_MARK[r.mark], markTitle: CORROBORATION_WORDS[r.mark] } : {}), ...(r.mono ? { mono: true } : {}),
        ...(r.action ? { action: `kind:${r.action}` } : {}) })) })
    }
  }
  if (item.kind !== 'folder') {
    sections.push({ id: 'connections', title: 'Connections', ...(ctx.wires ? { count: ctx.wires.length } : {}),
      rows: (ctx.wires ?? []).map(w => ({ label: w.direction === 'out' ? `→ ${w.label}` : `← ${w.label}`, text: w.otherName, action: `goto:${w.otherKey}`,
        title: w.direction === 'out' ? `${item.label} ${w.label} ${w.otherName}` : `${w.otherName} ${w.label} ${item.label}` })),
      note: ctx.wires === null ? 'Reading connections…' : 'No connections.' })
  }
  return { title: item.label, typeLabel: kindWord(item), icon: item.kind === 'folder' ? 'folder' : 'file-text', renamable: ctx.writable, sections }
}
