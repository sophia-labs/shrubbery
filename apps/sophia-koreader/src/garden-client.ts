import {
  type ReaderDocument,
  type ReaderFolder,
  type ReaderLibrary,
  readerDocumentFromHostedEnvelope,
  readerDocumentFromTiptapXml,
} from '@shrubbery/koreader'

export type GardenDocumentSource = 'hosted-blocks' | 'tiptap-xml'

export interface GardenLibraryOptions {
  /** Cell root, e.g. http://127.0.0.1:7090/ or https://gateway/g/{graph}/. */
  readonly baseUrl: string
  readonly graphId: string
  readonly token?: string
  readonly title?: string
  readonly documentSource?: GardenDocumentSource
  readonly minimumContentCharacters?: number
  readonly fetch?: typeof fetch
  readonly concurrency?: number
  /** Load Garden's authoritative folders and document parentage. Defaults to true. */
  readonly includeNavigation?: boolean
}

export interface GardenWorkspaceCatalogueOptions {
  readonly baseUrl: string
  readonly token?: string
  readonly fetch?: typeof fetch
}

export interface GardenWorkspaceSummary {
  readonly graphId: string
  readonly title: string
  readonly status: string
}

/** Read the workspaces visible to the current Garden identity. */
export async function loadGardenWorkspaceCatalogue(
  options: GardenWorkspaceCatalogueOptions,
): Promise<readonly GardenWorkspaceSummary[]> {
  const base = normalizedBase(options.baseUrl)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('loadGardenWorkspaceCatalogue requires fetch')
  const raw = await fetchJson(
    fetchImpl,
    new URL('graphs/catalog', base),
    requestHeaders(options.token),
  )
  if (!Array.isArray(raw)) throw new TypeError('Garden graph catalogue must be an array')
  const workspaces = raw.map((value, index): GardenWorkspaceSummary => {
    const entry = asRecord(value, `graphs[${index}]`)
    const graphId = nonEmpty(entry.graph_id ?? entry.graphId, `graphs[${index}].graph_id`)
    const title = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : graphId
    const status = typeof entry.status === 'string' && entry.status.trim()
      ? entry.status.trim()
      : 'active'
    return { graphId, title, status }
  })
  const duplicate = firstDuplicate(workspaces.map((workspace) => workspace.graphId))
  if (duplicate) throw new TypeError(`Garden graph catalogue contains duplicate id: ${duplicate}`)
  return workspaces
}

/** Read Garden's existing hosted-shaped document API into the KOReader model. */
export async function loadGardenLibrary(options: GardenLibraryOptions): Promise<ReaderLibrary> {
  const graphId = nonEmpty(options.graphId, 'graphId')
  const base = normalizedBase(options.baseUrl)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('loadGardenLibrary requires fetch')
  const headers = requestHeaders(options.token)
  const documentSource = options.documentSource ?? 'hosted-blocks'
  const summariesUrl = new URL(`documents/${encodeURIComponent(graphId)}`, base)
  const navigationUrl = new URL(`navigation/${encodeURIComponent(graphId)}`, base)
  const [summariesRaw, navigationRaw] = await Promise.all([
    fetchJson(fetchImpl, summariesUrl, headers),
    options.includeNavigation === false
      ? Promise.resolve(undefined)
      : fetchJson(fetchImpl, navigationUrl, headers),
  ])
  if (!Array.isArray(summariesRaw)) {
    throw new TypeError('Garden document index must be an array')
  }
  const documentIds = summariesRaw.map((value, index) => {
    const summary = asRecord(value, `documents[${index}]`)
    return nonEmpty(summary.id, `documents[${index}].id`)
  })
  const duplicate = firstDuplicate(documentIds)
  if (duplicate) throw new TypeError(`Garden document index contains duplicate id: ${duplicate}`)
  const navigation = navigationRaw === undefined
    ? { folders: [] as ReaderFolder[], parentByDocumentId: new Map<string, string | undefined>() }
    : parseNavigation(navigationRaw, graphId)

  const projectedDocuments = await mapLimit(
    documentIds,
    normalizeConcurrency(options.concurrency),
    async (documentId): Promise<ReaderDocument> => {
      const url = new URL(
        `documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}`,
        base,
      )
      const document = readerDocumentFromHostedEnvelope(await fetchJson(fetchImpl, url, headers))
      const projected = documentSource === 'hosted-blocks'
        ? document
        : readerDocumentFromTiptapXml(
          document,
          await fetchDocumentXml(fetchImpl, base, graphId, documentId, options.token),
        )
      if (!navigation.parentByDocumentId.has(documentId)) return projected
      const { parentId: _parentId, ...withoutParent } = projected
      const parentId = navigation.parentByDocumentId.get(documentId)
      return parentId ? { ...withoutParent, parentId } : withoutParent
    },
  )
  const minimumContentCharacters = normalizeMinimumContentCharacters(
    options.minimumContentCharacters,
  )
  const documents = projectedDocuments.filter((document) =>
    document.blocks.reduce((total, block) => total + block.text.length, 0)
      >= minimumContentCharacters,
  )

  return {
    id: `garden:${graphId}`,
    graphId,
    title: options.title?.trim() || graphId,
    folders: navigation.folders,
    documents,
  }
}

async function fetchDocumentXml(
  fetchImpl: typeof fetch,
  base: URL,
  graphId: string,
  documentId: string,
  token?: string,
): Promise<string> {
  const xmlUrl = new URL(
    `documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}/export`,
    base,
  )
  xmlUrl.searchParams.set('format', 'xml')
  return fetchText(fetchImpl, xmlUrl, requestHeaders(token, 'application/xml'))
}

function parseNavigation(
  value: unknown,
  graphId: string,
): { folders: ReaderFolder[]; parentByDocumentId: Map<string, string | undefined> } {
  const navigation = asRecord(value, 'navigation')
  const rawFolders = navigation.folders
  const rawDocuments = navigation.documents
  if (!Array.isArray(rawFolders)) throw new TypeError('Garden navigation folders must be an array')
  if (!Array.isArray(rawDocuments)) throw new TypeError('Garden navigation documents must be an array')
  const folders = rawFolders.map((value, index): ReaderFolder => {
    const folder = asRecord(value, `navigation.folders[${index}]`)
    const parentId = optionalNonEmpty(folder.parentId, `navigation.folders[${index}].parentId`)
    const order = typeof folder.order === 'number' && Number.isFinite(folder.order)
      ? folder.order
      : index
    return {
      id: nonEmpty(folder.id, `navigation.folders[${index}].id`),
      graphId,
      label: nonEmpty(folder.label, `navigation.folders[${index}].label`),
      ...(parentId ? { parentId } : {}),
      order,
      section: 'documents',
    }
  })
  const duplicateFolder = firstDuplicate(folders.map((folder) => folder.id))
  if (duplicateFolder) {
    throw new TypeError(`Garden navigation contains duplicate folder id: ${duplicateFolder}`)
  }
  const parentByDocumentId = new Map<string, string | undefined>()
  for (const [index, value] of rawDocuments.entries()) {
    const document = asRecord(value, `navigation.documents[${index}]`)
    const id = nonEmpty(document.id, `navigation.documents[${index}].id`)
    if (parentByDocumentId.has(id)) {
      throw new TypeError(`Garden navigation contains duplicate document id: ${id}`)
    }
    parentByDocumentId.set(
      id,
      optionalNonEmpty(document.parentId, `navigation.documents[${index}].parentId`),
    )
  }
  return { folders, parentByDocumentId }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: URL,
  headers: HeadersInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(`Garden read failed for ${url}: ${messageOf(error)}`, { cause: error })
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Garden read failed for ${url}: HTTP ${response.status}${body ? ` — ${body.slice(0, 500)}` : ''}`,
    )
  }
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    throw new Error(`Garden response from ${url} is not JSON: ${messageOf(error)}`, { cause: error })
  }
}

async function fetchText(
  fetchImpl: typeof fetch,
  url: URL,
  headers: HeadersInit,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    throw new Error(`Garden read failed for ${url}: ${messageOf(error)}`, { cause: error })
  }
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Garden read failed for ${url}: HTTP ${response.status}${body ? ` — ${body.slice(0, 500)}` : ''}`,
    )
  }
  return body
}

function requestHeaders(token?: string, accept = 'application/json'): HeadersInit {
  return {
    accept,
    ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
  }
}

function normalizedBase(value: string): URL {
  const base = new URL(nonEmpty(value, 'baseUrl'))
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new TypeError('baseUrl must use http or https')
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  base.search = ''
  base.hash = ''
  return base
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value.trim()
}

function optionalNonEmpty(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return nonEmpty(value, path)
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function normalizeConcurrency(value?: number): number {
  if (value === undefined) return 4
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new TypeError('concurrency must be an integer from 1 through 16')
  }
  return value
}

function normalizeMinimumContentCharacters(value?: number): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new TypeError('minimumContentCharacters must be an integer from 0 through 1000000')
  }
  return value
}

async function mapLimit<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      output[index] = await mapper(values[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
