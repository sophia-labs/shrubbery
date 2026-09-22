/**
 * Public-shell adapter for the Organism shell.
 *
 * Garden's public shell mixed route detection, public HTTP reads, Y.Doc blob
 * decoding, wire-bundle shaping, URL updates, clipboard writes, and rendering in
 * one custom element. Shrubbery keeps the custom element controlled and
 * backend-free; this shell-side adapter owns the impure transport/projection
 * work and feeds plain props into <mn-public-shell>.
 */

import * as Y from 'yjs'
import type {
  MnPublicBlock,
  MnPublicDocument,
  MnPublicFolder,
  MnPublicInlineMark,
  MnPublicMarkType,
  MnPublicNav,
  MnPublicShell,
  MnPublicShellCopyCodeDetail,
  MnPublicShellOpenDocumentDetail,
  MnPublicTableCell,
  MnPublicTableRow,
  MnPublicWire,
  MnPublicWires,
} from '@shrubbery/components'

export interface PublicAccess {
  readonly token?: string | null
  readonly alias?: string | null
}

export interface PublicShellTransport {
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
}

export interface PublicAliasResolution {
  readonly alias: string
  readonly graph_id: string
}

export interface PublicWireSummary {
  readonly id?: string
  readonly predicate?: string
  readonly predicate_label?: string
  readonly other_document_id?: string
  readonly other_graph_id?: string
  readonly other_block_id?: string | null
  readonly other_title?: string | null
  readonly other_snippet?: string | null
  readonly local_block_id?: string | null
  readonly local_snippet?: string | null
}

export interface PublicWireBundleResponse {
  readonly outgoing_wires?: readonly PublicWireSummary[]
  readonly incoming_wires?: readonly PublicWireSummary[]
  readonly wired_block_ids?: readonly string[]
}

export interface PublicWorkspaceProjection {
  readonly nav: MnPublicNav
  readonly rawDocumentIdsByNormalized: ReadonlyMap<string, string>
}

export interface PublicDocumentSnapshot {
  readonly document: MnPublicDocument
  readonly wires: MnPublicWires | null
  readonly resolvedDocumentId: string
}

export interface PublicShellSnapshot extends PublicDocumentSnapshot {
  readonly nav: MnPublicNav
  readonly activeDocumentId: string
  readonly rawDocumentIdsByNormalized: ReadonlyMap<string, string>
}

export interface DetectedPublicRoute {
  readonly segment: string
  readonly alias: string
  readonly token: string | null
  readonly fallbackToken: string | null
  readonly initialDocumentId: string | null
  readonly tokenStrippedUrl: string | null
}

export interface ResolvedPublicRoute {
  readonly graphId: string
  readonly access: PublicAccess
  readonly initialDocumentId: string | null
  readonly mode: 'alias' | 'token'
}

export interface AttachPublicShellControllerOptions {
  readonly graphId: string
  readonly access?: PublicAccess | string | null
  readonly initialDocumentId?: string | null
  readonly transport?: PublicShellTransport
  readonly history?: Pick<History, 'pushState'> | null
  readonly location?: Pick<Location, 'href'> | URL | null
  readonly clipboard?: Pick<Clipboard, 'writeText'> | null
}

export interface PublicShellController {
  readonly ready: Promise<void>
  refresh(): Promise<void>
  openDocument(documentId: string, blockId?: string | null): Promise<void>
  destroy(): void
}

export interface MountPublicShellRouteOptions {
  readonly location?: Pick<Location, 'href' | 'pathname' | 'search'> | URL
  readonly history?: Pick<History, 'pushState' | 'replaceState'> | null
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  readonly transport?: PublicShellTransport
  readonly clipboard?: Pick<Clipboard, 'writeText'> | null
}

export interface PublicShellRouteMount {
  readonly route: DetectedPublicRoute
  readonly element: MnPublicShell
  readonly ready: Promise<void>
  destroy(): void
}

export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PublicApiError'
  }
}

const DEFAULT_BASE_URL = '/cell'
const KNOWN_MARKS = new Set<MnPublicMarkType>([
  'bold',
  'italic',
  'strike',
  'code',
  'highlight',
  'link',
  'wikilink',
  'fontSize',
])

function accessObject(access: PublicAccess | string | null | undefined): PublicAccess {
  if (typeof access === 'string') return { token: access }
  return access ?? {}
}

export function buildPublicHeaders(access?: PublicAccess | string | null): HeadersInit {
  const normalized = accessObject(access)
  const token = (normalized.token ?? '').trim()
  const alias = (normalized.alias ?? '').trim()
  if (token) return { 'X-Public-Token': token }
  if (alias) return { 'X-Public-Alias': alias }
  return {}
}

function baseUrl(transport?: PublicShellTransport): string {
  return (transport?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

function fetcher(transport?: PublicShellTransport): typeof fetch {
  const fn = transport?.fetch ?? globalThis.fetch
  if (typeof fn !== 'function') {
    throw new PublicApiError('No fetch implementation available for public shell transport', 500)
  }
  return fn.bind(globalThis) as typeof fetch
}

function publicUrl(path: string, transport?: PublicShellTransport): string {
  return `${baseUrl(transport)}${path.startsWith('/') ? path : `/${path}`}`
}

async function errorDetail(res: Response): Promise<string> {
  let detail = `HTTP ${res.status}`
  try {
    const body = (await res.clone().json()) as { detail?: unknown; message?: unknown }
    const candidate = body?.detail ?? body?.message
    if (typeof candidate === 'string' && candidate.trim()) detail = candidate.trim()
  } catch {
    try {
      const text = await res.text()
      if (text.trim()) detail = text.trim()
    } catch {
      /* keep HTTP fallback */
    }
  }
  return detail
}

export async function publicFetchBlob(
  path: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
): Promise<Uint8Array> {
  const res = await fetcher(transport)(publicUrl(path, transport), {
    method: 'GET',
    headers: buildPublicHeaders(access),
  })
  if (!res.ok) throw new PublicApiError(await errorDetail(res), res.status)
  return new Uint8Array(await res.arrayBuffer())
}

export async function publicFetchJson<T>(
  path: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
): Promise<T> {
  const res = await fetcher(transport)(publicUrl(path, transport), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...buildPublicHeaders(access),
    },
  })
  if (!res.ok) throw new PublicApiError(await errorDetail(res), res.status)
  return (await res.json()) as T
}

export function fetchPublicWorkspaceBlob(
  graphId: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
): Promise<Uint8Array> {
  return publicFetchBlob(`/documents/${encodeURIComponent(graphId)}/workspace/blob`, access, transport)
}

export function fetchPublicDocumentBlob(
  graphId: string,
  documentId: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
): Promise<Uint8Array> {
  return publicFetchBlob(
    `/documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}/blob`,
    access,
    transport,
  )
}

export function fetchPublicWireBundle(
  graphId: string,
  documentId: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
): Promise<PublicWireBundleResponse> {
  return publicFetchJson<PublicWireBundleResponse>(
    `/wires/${encodeURIComponent(graphId)}/document/${encodeURIComponent(documentId)}/bundle`,
    access,
    transport,
  )
}

export async function resolvePublicAlias(
  alias: string,
  transport?: PublicShellTransport,
): Promise<PublicAliasResolution> {
  const res = await fetcher(transport)(publicUrl(`/public-aliases/${encodeURIComponent(alias)}`, transport), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new PublicApiError(await errorDetail(res), res.status)
  return (await res.json()) as PublicAliasResolution
}

export function extractEntityId(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  const match = raw.startsWith('urn:')
    ? raw.match(/:(?:folder|artifact|doc|document):(.+)$/)
    : null
  const entity = match ? match[1] : raw
  const hashIndex = entity.indexOf('#')
  const trimmed = hashIndex >= 0 ? entity.slice(0, hashIndex) : entity
  return trimmed.trim() || null
}

function extractBlockId(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const blockMarker = '#block-'
  const blockIndex = raw.indexOf(blockMarker)
  if (blockIndex >= 0) return raw.slice(blockIndex + blockMarker.length) || null
  const hashIndex = raw.indexOf('#')
  if (hashIndex >= 0) return raw.slice(hashIndex + 1) || null
  return raw
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function booleanAttr(value: unknown): boolean | null {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return null
}

function attrsOf(element: Y.XmlElement): Record<string, unknown> {
  return element.getAttributes() as Record<string, unknown>
}

function blockIdFromAttrs(attrs: Record<string, unknown>, order: number): string {
  return textValue(attrs['data-block-id'], textValue(attrs.blockId, textValue(attrs.id, `block-${order}`)))
}

export function readPublicWorkspaceProjection(graphId: string, blob: Uint8Array): PublicWorkspaceProjection {
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, blob)
    const foldersMap = ydoc.getMap<Y.Map<unknown>>('folders')
    const docsMap = ydoc.getMap<Y.Map<unknown>>('documents')
    const rawDocumentIdsByNormalized = new Map<string, string>()

    const folders: MnPublicFolder[] = Array.from(foldersMap.entries())
      .filter(([, value]) => value instanceof Y.Map)
      .map(([rawId, value]) => {
        const section = value.get('section')
        return {
          id: extractEntityId(rawId) ?? rawId,
          label: textValue(value.get('name'), rawId),
          parentId: extractEntityId(value.get('parentId') as string | null),
          order: numberValue(value.get('order')),
          section: section === 'artifacts' ? 'artifacts' : 'documents',
        }
      })
      .filter((folder) => folder.section !== 'artifacts')
      .map(({ section: _section, ...folder }) => folder)

    const documents = Array.from(docsMap.entries())
      .filter(([, value]) => value instanceof Y.Map)
      .map(([rawId, value]) => {
        const id = extractEntityId(rawId) ?? rawId
        if (!rawDocumentIdsByNormalized.has(id)) rawDocumentIdsByNormalized.set(id, rawId)
        return {
          id,
          title: textValue(value.get('title'), 'Untitled'),
          parentId: extractEntityId(value.get('parentId') as string | null),
          order: numberValue(value.get('order')),
          updatedAt: value.get('updatedAt') as number | string | Date | null | undefined,
        }
      })

    return {
      nav: {
        graphId,
        title: graphId,
        folders,
        documents,
      },
      rawDocumentIdsByNormalized,
    }
  } finally {
    ydoc.destroy()
  }
}

export function readPublicWorkspaceNav(graphId: string, blob: Uint8Array): MnPublicNav {
  return readPublicWorkspaceProjection(graphId, blob).nav
}

export function readPublicDocument(
  documentId: string,
  blob: Uint8Array,
  navTitle?: string | null,
): MnPublicDocument {
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, blob)
    const blocks = extractPublicBlocks(ydoc.getXmlFragment('content'))
    const title =
      (navTitle ?? '').trim() ||
      blocks.find((block) => block.type === 'heading')?.content?.trim() ||
      blocks[0]?.content?.trim() ||
      'Untitled'
    const updatedAt = ydoc.getMap<unknown>('meta').get('updatedAt') as number | string | Date | null | undefined
    return { id: extractEntityId(documentId) ?? documentId, title, blocks, updatedAt }
  } finally {
    ydoc.destroy()
  }
}

export function extractPublicBlocks(fragment: Y.XmlFragment): MnPublicBlock[] {
  const blocks: MnPublicBlock[] = []
  let order = 0

  const appendBlock = (node: Y.XmlElement, fallbackListType?: 'bullet' | 'ordered' | 'task'): void => {
    const attrs = attrsOf(node)
    const blockId = blockIdFromAttrs(attrs, order)
    const indent = numberValue(attrs.indent ?? attrs['data-indent'])

    switch (node.nodeName) {
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const listType = node.nodeName === 'orderedList' ? 'ordered' : node.nodeName === 'taskList' ? 'task' : 'bullet'
        for (const child of node.toArray()) {
          if (child instanceof Y.XmlElement) appendBlock(child, listType)
        }
        break
      }
      case 'paragraph': {
        const { content, marks } = extractPublicInline(node)
        blocks.push({ id: blockId, type: 'paragraph', content, marks, order: order++, level: null })
        break
      }
      case 'heading': {
        const { content, marks } = extractPublicInline(node)
        blocks.push({
          id: blockId,
          type: 'heading',
          content,
          marks,
          order: order++,
          level: Math.min(Math.max(numberValue(attrs.level, 1), 1), 3),
        })
        break
      }
      case 'listItem': {
        const listType = textValue(attrs.listType, textValue(attrs['data-list-type'], fallbackListType ?? 'bullet'))
        const { content, marks } = extractPublicInline(node)
        blocks.push({
          id: blockId,
          type: listType === 'task' ? 'todo' : listType === 'ordered' ? 'numbered' : 'bullet',
          content,
          marks,
          order: order++,
          level: indent || null,
          checked: booleanAttr(attrs.checked),
        })
        break
      }
      case 'blockquote': {
        const { content, marks } = extractPublicInline(node)
        blocks.push({ id: blockId, type: 'quote', content, marks, order: order++ })
        break
      }
      case 'codeBlock': {
        const { content } = extractPublicInline(node)
        blocks.push({
          id: blockId,
          type: 'code',
          content,
          marks: [],
          order: order++,
          language: textValue(attrs.language) || null,
        })
        break
      }
      case 'queryBlock': {
        blocks.push({
          id: blockId,
          type: 'code',
          content: textValue(attrs.query),
          marks: [],
          order: order++,
          language: 'sparql',
        })
        break
      }
      case 'horizontalRule': {
        blocks.push({ id: blockId, type: 'divider', content: '', marks: [], order: order++ })
        break
      }
      case 'image': {
        const alt = textValue(attrs.alt)
        blocks.push({
          id: blockId,
          type: 'image',
          content: alt,
          marks: [],
          order: order++,
          src: textValue(attrs.src) || null,
          alt,
          size: textValue(attrs.size) || null,
        })
        break
      }
      case 'table': {
        const rows: MnPublicTableRow[] = []
        for (const rowNode of node.toArray()) {
          if (!(rowNode instanceof Y.XmlElement) || rowNode.nodeName !== 'tableRow') continue
          const cells: MnPublicTableCell[] = []
          for (const cellNode of rowNode.toArray()) {
            if (!(cellNode instanceof Y.XmlElement)) continue
            const isHeader = cellNode.nodeName === 'tableHeader'
            if (cellNode.nodeName !== 'tableCell' && !isHeader) continue
            const cellAttrs = attrsOf(cellNode)
            const paragraph = cellNode.toArray().find(
              (child): child is Y.XmlElement => child instanceof Y.XmlElement && child.nodeName === 'paragraph',
            )
            const extracted = paragraph ? extractPublicInline(paragraph) : { content: '', marks: [] }
            cells.push({
              isHeader,
              content: extracted.content,
              marks: extracted.marks,
              colspan: numberValue(cellAttrs.colspan, 1),
              rowspan: numberValue(cellAttrs.rowspan, 1),
            })
          }
          if (cells.length) rows.push({ cells })
        }
        blocks.push({ id: blockId, type: 'table', content: '', marks: [], order: order++, rows })
        break
      }
      default:
        break
    }
  }

  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) appendBlock(child)
  }

  return blocks
}

export function extractPublicInline(element: Y.XmlElement): { content: string; marks: MnPublicInlineMark[] } {
  let content = ''
  let charOffset = 0
  const ranges: Array<{ type: MnPublicMarkType; start: number; end: number; attrs: Record<string, unknown> }> = []

  const visit = (node: Y.XmlElement | Y.XmlText): void => {
    if (node instanceof Y.XmlText) {
      const deltas = node.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>
      for (const delta of deltas) {
        if (typeof delta.insert !== 'string') continue
        const start = charOffset
        const end = start + delta.insert.length
        content += delta.insert
        charOffset = end
        for (const [rawType, rawAttrs] of Object.entries(delta.attributes ?? {})) {
          if (!rawType || rawAttrs === false || rawAttrs == null) continue
          const attrs = typeof rawAttrs === 'object' ? (rawAttrs as Record<string, unknown>) : {}
          const type = rawType === 'textStyle' && attrs.fontSize ? 'fontSize' : rawType
          if (!KNOWN_MARKS.has(type as MnPublicMarkType)) continue
          ranges.push({ type: type as MnPublicMarkType, start, end, attrs })
        }
      }
      return
    }

    if (node.nodeName === 'wikilink') {
      const attrs = attrsOf(node)
      const label = textValue(attrs.label, textValue(attrs['data-label'], 'link'))
      const targetDocumentId = extractEntityId(
        textValue(attrs.targetDocId, textValue(attrs['data-target-doc-id'])) || null,
      )
      const displayText = `[[${label}]]`
      const start = charOffset
      const end = start + displayText.length
      content += displayText
      charOffset = end
      if (targetDocumentId) {
        ranges.push({ type: 'wikilink', start, end, attrs: { targetDocumentId, label } })
      }
      return
    }

    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) visit(child)
    }
  }

  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) visit(child)
  }

  return {
    content,
    marks: ranges.map((range) => ({
      type: range.type,
      start: range.start,
      end: range.end,
      href: typeof range.attrs.href === 'string' ? range.attrs.href : null,
      targetDocumentId: extractEntityId(
        (range.attrs.targetDocumentId as string | undefined) ??
          (range.attrs.targetDocId as string | undefined) ??
          (range.attrs.target_doc_id as string | undefined) ??
          null,
      ),
      label: typeof range.attrs.label === 'string' ? range.attrs.label : null,
      size: typeof range.attrs.fontSize === 'string' ? range.attrs.fontSize : null,
    })),
  }
}

export function projectPublicWireBundle(bundle: PublicWireBundleResponse | null | undefined): MnPublicWires {
  const mapWire = (wire: PublicWireSummary): MnPublicWire => {
    const otherDocumentId = extractEntityId(wire.other_document_id) ?? wire.other_document_id ?? ''
    return {
      id: wire.id ?? `${wire.predicate ?? wire.predicate_label ?? 'wire'}:${otherDocumentId}`,
      predicateLabel: wire.predicate_label ?? wire.predicate ?? 'related',
      otherDocumentId,
      otherTitle: wire.other_title ?? null,
      otherBlockId: extractBlockId(wire.other_block_id),
      otherSnippet: wire.other_snippet ?? null,
      localBlockId: extractBlockId(wire.local_block_id),
    }
  }

  return {
    wiredBlockIds: (bundle?.wired_block_ids ?? []).map((id) => extractBlockId(id) ?? id),
    outgoing: (bundle?.outgoing_wires ?? []).map(mapWire).filter((wire) => wire.otherDocumentId),
    incoming: (bundle?.incoming_wires ?? []).map(mapWire).filter((wire) => wire.otherDocumentId),
  }
}

function firstDocumentId(nav: MnPublicNav): string | null {
  const docs = [...(nav.documents ?? [])].sort((a, b) => {
    const ao = numberValue(a.order)
    const bo = numberValue(b.order)
    return ao - bo || a.title.localeCompare(b.title)
  })
  const root = docs.find((doc) => !doc.parentId)
  return root?.id ?? docs[0]?.id ?? null
}

function navTitle(nav: MnPublicNav, documentId: string): string | null {
  const target = extractEntityId(documentId) ?? documentId
  return nav.documents?.find((doc) => (extractEntityId(doc.id) ?? doc.id) === target)?.title ?? null
}

function documentCandidates(
  requestedDocumentId: string,
  rawDocumentIdsByNormalized?: ReadonlyMap<string, string>,
): string[] {
  const requested = requestedDocumentId.trim()
  const normalized = extractEntityId(requested) ?? requested
  return [...new Set([normalized, requested, rawDocumentIdsByNormalized?.get(normalized) ?? ''].filter(Boolean))]
}

export async function loadPublicDocumentSnapshot(
  graphId: string,
  nav: MnPublicNav,
  documentId: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
  rawDocumentIdsByNormalized?: ReadonlyMap<string, string>,
): Promise<PublicDocumentSnapshot> {
  let lastError: unknown = null
  for (const candidate of documentCandidates(documentId, rawDocumentIdsByNormalized)) {
    try {
      const [blob, wires] = await Promise.all([
        fetchPublicDocumentBlob(graphId, candidate, access, transport),
        fetchPublicWireBundle(graphId, candidate, access, transport).catch(() => null),
      ])
      const canonicalId = extractEntityId(candidate) ?? candidate
      return {
        document: readPublicDocument(canonicalId, blob, navTitle(nav, canonicalId)),
        wires: wires ? projectPublicWireBundle(wires) : null,
        resolvedDocumentId: canonicalId,
      }
    } catch (error) {
      lastError = error
      if (!(error instanceof PublicApiError) || error.status !== 404) throw error
    }
  }
  throw lastError ?? new PublicApiError('Failed to load public document', 404)
}

export async function loadPublicWorkspaceSnapshot(
  graphId: string,
  access?: PublicAccess | string | null,
  transport?: PublicShellTransport,
  initialDocumentId?: string | null,
): Promise<PublicShellSnapshot> {
  const workspaceBlob = await fetchPublicWorkspaceBlob(graphId, access, transport)
  const projection = readPublicWorkspaceProjection(graphId, workspaceBlob)
  const activeDocumentId = (initialDocumentId ?? '').trim() || firstDocumentId(projection.nav)
  if (!activeDocumentId) {
    return {
      nav: projection.nav,
      activeDocumentId: '',
      rawDocumentIdsByNormalized: projection.rawDocumentIdsByNormalized,
      resolvedDocumentId: '',
      document: { id: '', title: 'Untitled', blocks: [] },
      wires: null,
    }
  }
  const snapshot = await loadPublicDocumentSnapshot(
    graphId,
    projection.nav,
    activeDocumentId,
    access,
    transport,
    projection.rawDocumentIdsByNormalized,
  )
  return {
    nav: projection.nav,
    activeDocumentId: snapshot.resolvedDocumentId,
    rawDocumentIdsByNormalized: projection.rawDocumentIdsByNormalized,
    ...snapshot,
  }
}

export function detectPublicRoute(
  locationLike: Pick<Location, 'href' | 'pathname' | 'search'> | URL,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): DetectedPublicRoute | null {
  const url = locationLike instanceof URL ? locationLike : new URL(locationLike.href)
  const [, mode, encodedSegment] = url.pathname.split('/')
  if (mode !== 'public' || !encodedSegment) return null

  const segment = decodeURIComponent(encodedSegment)
  const tokenParam = url.searchParams.get('public_token')?.trim() || null
  const storageKey = `mn-public-token:${segment}`
  const storedToken = storage?.getItem(storageKey)?.trim() || null
  if (tokenParam) storage?.setItem(storageKey, tokenParam)

  const stripped = tokenParam ? new URL(url.href) : null
  stripped?.searchParams.delete('public_token')

  return {
    segment,
    alias: segment,
    token: tokenParam ?? storedToken,
    fallbackToken: tokenParam ?? storedToken,
    initialDocumentId: url.searchParams.get('doc')?.trim() || null,
    tokenStrippedUrl: stripped?.toString() ?? null,
  }
}

export async function resolvePublicRoute(
  route: DetectedPublicRoute,
  transport?: PublicShellTransport,
): Promise<ResolvedPublicRoute> {
  try {
    const resolved = await resolvePublicAlias(route.alias, transport)
    return {
      graphId: resolved.graph_id,
      access: { alias: route.alias },
      initialDocumentId: route.initialDocumentId,
      mode: 'alias',
    }
  } catch (error) {
    if (!route.fallbackToken) throw error
    return {
      graphId: route.segment,
      access: { token: route.fallbackToken },
      initialDocumentId: route.initialDocumentId,
      mode: 'token',
    }
  }
}

function updateShell(
  element: MnPublicShell,
  snapshot: { nav: MnPublicNav; document: MnPublicDocument; wires: MnPublicWires | null },
): void {
  element.nav = snapshot.nav
  element.document = snapshot.document
  element.wires = snapshot.wires
  element.error = ''
  element.status = 'ready'
}

function setShellError(element: MnPublicShell, error: unknown, fallback: string): void {
  element.status = 'error'
  element.error = error instanceof Error && error.message ? error.message : fallback
}

function updateHistoryDoc(
  history: Pick<History, 'pushState'> | null | undefined,
  locationLike: Pick<Location, 'href'> | URL | null | undefined,
  documentId: string,
): void {
  if (!history || !locationLike || !documentId) return
  const url = locationLike instanceof URL ? new URL(locationLike.href) : new URL(locationLike.href)
  url.searchParams.set('doc', documentId)
  history.pushState({}, '', url.toString())
}

async function scrollToPublicBlock(element: MnPublicShell, blockId: string | null | undefined): Promise<void> {
  const raw = (blockId ?? '').trim()
  if (!raw) return
  await element.updateComplete
  const variants = new Set([raw, `block-${raw}`, raw.replace(/^block-/, '')])
  for (const variant of variants) {
    const escapeCss = (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape
    const escaped = typeof escapeCss === 'function'
      ? (escapeCss as (value: string) => string)(variant)
      : variant.replace(/["\\]/g, '\\$&')
    const target = element.shadowRoot?.querySelector(`[data-block-id="${escaped}"]`) as HTMLElement | null
    if (!target) continue
    target.scrollIntoView({ block: 'center' })
    return
  }
}

export function attachPublicShellController(
  element: MnPublicShell,
  options: AttachPublicShellControllerOptions,
): PublicShellController {
  const access = accessObject(options.access)
  const transport = options.transport
  const history = options.history ?? (typeof window !== 'undefined' ? window.history : null)
  const locationLike = options.location ?? (typeof window !== 'undefined' ? window.location : null)
  const clipboard = options.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : null)

  let destroyed = false
  let requestToken = 0
  let nav: MnPublicNav | null = null
  let rawDocumentIdsByNormalized: ReadonlyMap<string, string> = new Map()
  let activeDocumentId = (options.initialDocumentId ?? '').trim()

  const run = async (work: (token: number) => Promise<void>): Promise<void> => {
    const token = ++requestToken
    try {
      await work(token)
    } catch (error) {
      if (!destroyed && token === requestToken) setShellError(element, error, 'Failed to load public workspace')
    }
  }

  const refresh = (): Promise<void> =>
    run(async (token) => {
      element.status = 'loading'
      const snapshot = await loadPublicWorkspaceSnapshot(options.graphId, access, transport, activeDocumentId)
      if (destroyed || token !== requestToken) return
      nav = snapshot.nav
      rawDocumentIdsByNormalized = snapshot.rawDocumentIdsByNormalized
      activeDocumentId = snapshot.resolvedDocumentId
      updateShell(element, snapshot)
    })

  const openDocument = (documentId: string, blockId?: string | null): Promise<void> =>
    run(async (token) => {
      const requested = extractEntityId(documentId) ?? documentId.trim()
      if (!requested) return
      if (!nav) {
        element.status = 'loading'
        const snapshot = await loadPublicWorkspaceSnapshot(options.graphId, access, transport, requested)
        if (destroyed || token !== requestToken) return
        nav = snapshot.nav
        rawDocumentIdsByNormalized = snapshot.rawDocumentIdsByNormalized
        activeDocumentId = snapshot.resolvedDocumentId
        updateShell(element, snapshot)
        updateHistoryDoc(history, locationLike, activeDocumentId)
        await scrollToPublicBlock(element, blockId)
        return
      }
      element.status = 'loading'
      const snapshot = await loadPublicDocumentSnapshot(
        options.graphId,
        nav,
        requested,
        access,
        transport,
        rawDocumentIdsByNormalized,
      )
      if (destroyed || token !== requestToken) return
      activeDocumentId = snapshot.resolvedDocumentId
      updateShell(element, { nav, document: snapshot.document, wires: snapshot.wires })
      updateHistoryDoc(history, locationLike, activeDocumentId)
      await scrollToPublicBlock(element, blockId)
    })

  const onOpen = (event: Event): void => {
    const detail = (event as CustomEvent<MnPublicShellOpenDocumentDetail>).detail
    void openDocument(detail.documentId, detail.blockId)
  }
  const onRefresh = (): void => {
    void refresh()
  }
  const onCopyCode = (event: Event): void => {
    const detail = (event as CustomEvent<MnPublicShellCopyCodeDetail>).detail
    if (detail.content && clipboard?.writeText) void clipboard.writeText(detail.content)
  }

  element.addEventListener('mn-public-shell-open-document', onOpen)
  element.addEventListener('mn-public-shell-refresh', onRefresh)
  element.addEventListener('mn-public-shell-copy-code', onCopyCode)

  const ready = refresh()

  return {
    ready,
    refresh,
    openDocument,
    destroy() {
      destroyed = true
      requestToken += 1
      element.removeEventListener('mn-public-shell-open-document', onOpen)
      element.removeEventListener('mn-public-shell-refresh', onRefresh)
      element.removeEventListener('mn-public-shell-copy-code', onCopyCode)
    },
  }
}

export function mountPublicShellRoute(
  host: HTMLElement,
  options: MountPublicShellRouteOptions = {},
): PublicShellRouteMount | null {
  const locationLike = options.location ?? (typeof window !== 'undefined' ? window.location : undefined)
  if (!locationLike) return null
  const route = detectPublicRoute(
    locationLike,
    options.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null),
  )
  if (!route) return null

  const history = options.history ?? (typeof window !== 'undefined' ? window.history : null)
  const routeUrl = route.tokenStrippedUrl ?? locationLike.href
  if (route.tokenStrippedUrl && history && 'replaceState' in history) {
    history.replaceState({}, '', route.tokenStrippedUrl)
  }

  const element = document.createElement('mn-public-shell') as MnPublicShell
  element.status = 'loading'
  host.replaceChildren(element)

  let destroyed = false
  let controller: PublicShellController | null = null
  const ready = (async () => {
    try {
      const resolved = await resolvePublicRoute(route, options.transport)
      if (destroyed) return
      controller = attachPublicShellController(element, {
        graphId: resolved.graphId,
        access: resolved.access,
        initialDocumentId: resolved.initialDocumentId,
        transport: options.transport,
        history,
        location: new URL(routeUrl),
        clipboard: options.clipboard,
      })
      await controller.ready
    } catch (error) {
      if (!destroyed) setShellError(element, error, 'Failed to load public workspace')
    }
  })()

  return {
    route,
    element,
    ready,
    destroy() {
      destroyed = true
      controller?.destroy()
      element.remove()
    },
  }
}
