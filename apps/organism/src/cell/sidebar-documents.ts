/**
 * Sidebar document/tag projection for the Organism shell.
 *
 * Reads the same GRAPH-scoped workspace projection document list that wikilink
 * search uses, plus a small doc:hasTag aggregate for Garden's sidebar tag list,
 * then shapes both into the controlled `mn-sidebar-panel` data model. This
 * stays shell-side: components receive plain props, runtime stays a render host,
 * and no UI package reaches into a cell contract.
 */

import { workspaceProjectionGraphIri, type SidebarNode, type SidebarSection } from '@shrubbery/runtime'

interface QueryResult {
  readonly rows?: ReadonlyArray<Record<string, string>>
}

export interface SidebarDocumentRest {
  query(graphId: string, sparql: string): Promise<unknown>
}

export interface SidebarDocument {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly order: number
  /** Epoch milliseconds from doc:createdAt or an epoch-valued order fallback. */
  readonly createdAt?: number
  readonly readOnly: boolean
  readonly sourceFile: SidebarDocumentSourceFile | null
}

export interface SidebarDocumentSourceFile {
  readonly storageKey?: string
  readonly originalFilename?: string
  readonly mimeType?: string
  readonly sizeBytes?: number
  readonly fileType?: string
}

export interface SidebarFolder {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly order: number
  readonly section: 'documents' | 'artifacts'
}

export interface SidebarArtifact {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  readonly order: number
  readonly mimeType: string
  readonly status: string
  readonly fileType?: string | null
  readonly ingestedDocumentId?: string | null
}

export interface SidebarTag {
  readonly name: string
  readonly count?: number
}

export interface SidebarFolderOption {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly section: 'documents' | 'artifacts'
}

export const CORE_SIDEBAR_TAGS: readonly SidebarTag[] = [
  { name: 'event' },
  { name: 'todo' },
  { name: 'decision' },
  { name: 'tension' },
  { name: 'pragma' },
]
const CORE_TAG_ORDER = new Map(CORE_SIDEBAR_TAGS.map((tag, index) => [tag.name, index]))

function bareWorkspaceId(term: string, marker: 'document' | 'folder' | 'artifact'): string | null {
  const iri = term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
  if (marker === 'document') {
    const localDocumentPrefix = 'urn:mnemosyne:local:document:'
    if (iri.startsWith(localDocumentPrefix)) return iri.slice(localDocumentPrefix.length)
  }
  for (const needle of [`:${marker}:`, `:${marker === 'document' ? 'doc' : marker}:`]) {
    const index = iri.indexOf(needle)
    if (index >= 0) return iri.slice(index + needle.length)
  }
  return null
}

function unquoteLiteral(term: string): string {
  if (term[0] !== '"') return term
  let out = ''
  for (let i = 1; i < term.length; i++) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[i + 1]
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''
      i++
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

function parseCount(term: string | undefined): number | undefined {
  if (!term) return undefined
  const match = /^"?(\d+)"?(?:\^\^<[^>]+>)?$/.exec(term.trim())
  if (!match) return undefined
  const count = Number.parseInt(match[1], 10)
  return Number.isFinite(count) ? count : undefined
}

function parseOrder(term: string | undefined): number {
  if (!term) return 0
  const match = /^"?(-?\d+(?:\.\d+)?)"?(?:\^\^<[^>]+>)?$/.exec(term.trim())
  if (!match) return 0
  const order = Number.parseFloat(match[1])
  return Number.isFinite(order) ? order : 0
}

function parseBoolean(term: string | undefined): boolean {
  if (!term) return false
  const value = unquoteLiteral(term).replace(/\^\^<[^>]+>$/, '').trim().toLowerCase()
  return value === 'true' || value === '1'
}

function optionalText(term: string | undefined): string | undefined {
  if (!term) return undefined
  const value = unquoteLiteral(term).trim()
  return value || undefined
}

function optionalNumber(term: string | undefined): number | undefined {
  if (!term) return undefined
  const match = /^"?(-?\d+(?:\.\d+)?)"?(?:\^\^<[^>]+>)?$/.exec(term.trim())
  if (!match) return undefined
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? value : undefined
}

function parseTimestamp(term: string | undefined): number | undefined {
  if (!term) return undefined
  const raw = unquoteLiteral(term).trim()
  if (!raw) return undefined
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric >= 0) return numeric
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function sourceFileFromRow(row: Record<string, string>): SidebarDocumentSourceFile | null {
  const storageKey = optionalText(row.sourceStorageKey)
  const originalFilename = optionalText(row.sourceOriginalFilename)
  const mimeType = optionalText(row.sourceMimeType)
  const sizeBytes = optionalNumber(row.sourceContentSize)
  const fileType = optionalText(row.sourceFileType)
  const sourceFile: SidebarDocumentSourceFile = {
    ...(storageKey ? { storageKey } : {}),
    ...(originalFilename ? { originalFilename } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(fileType ? { fileType } : {}),
  }
  return Object.keys(sourceFile).length > 0 ? sourceFile : null
}

function normalizeTagName(term: string): string | null {
  const name = unquoteLiteral(term).trim().replace(/^#/, '').toLowerCase()
  return /^[a-z0-9_-]+$/.test(name) ? name : null
}

export function sidebarDocumentFromRow(row: Record<string, string>): SidebarDocument | null {
  const id = row.doc ? bareWorkspaceId(row.doc, 'document') : null
  if (!id) return null
  const order = parseOrder(row.order)
  const createdAt = parseTimestamp(row.createdAt) ?? (order >= 1_000_000_000_000 ? order : undefined)
  return {
    id,
    label: row.label ? unquoteLiteral(row.label) : 'Untitled',
    parentId: row.parent ? bareWorkspaceId(row.parent, 'folder') : null,
    order,
    ...(createdAt === undefined ? {} : { createdAt }),
    readOnly: parseBoolean(row.readOnly),
    sourceFile: sourceFileFromRow(row),
  }
}

export function sidebarFolderFromRow(row: Record<string, string>): SidebarFolder | null {
  const id = row.folder ? bareWorkspaceId(row.folder, 'folder') : null
  if (!id) return null
  const section = row.section ? unquoteLiteral(row.section) : 'documents'
  return {
    id,
    label: row.label ? unquoteLiteral(row.label) : 'Untitled Folder',
    parentId: row.parent ? bareWorkspaceId(row.parent, 'folder') : null,
    order: parseOrder(row.order),
    section: section === 'artifacts' ? 'artifacts' : 'documents',
  }
}

export function sidebarArtifactFromRow(row: Record<string, string>): SidebarArtifact | null {
  const id = row.artifact ? bareWorkspaceId(row.artifact, 'artifact') : null
  if (!id) return null
  return {
    id,
    label: row.label ? unquoteLiteral(row.label) : 'Untitled Artifact',
    parentId: row.parent ? bareWorkspaceId(row.parent, 'folder') : null,
    order: parseOrder(row.order),
    mimeType: row.mimeType ? unquoteLiteral(row.mimeType) : 'application/octet-stream',
    status: row.status ? unquoteLiteral(row.status) : 'ready',
    fileType: row.fileType ? unquoteLiteral(row.fileType) : null,
    ingestedDocumentId: row.ingestedDoc ? bareWorkspaceId(row.ingestedDoc, 'document') : null,
  }
}

export function sidebarDocumentListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>',
    'SELECT ?doc (COALESCE(?dctitle, ?doctitle, "Untitled") AS ?label) ?parent ?order ?createdAt ?readOnly ?sourceStorageKey ?sourceOriginalFilename ?sourceMimeType ?sourceContentSize ?sourceFileType',
    `WHERE { GRAPH <${ws}> {`,
    '  ?doc a doc:TipTapDocument .',
    '  OPTIONAL { ?doc dcterms:title ?dctitle }',
    '  OPTIONAL { ?doc doc:title ?doctitle }',
    '  OPTIONAL { ?doc nfo:belongsToContainer ?parent }',
    '  OPTIONAL { ?doc doc:order ?order }',
    '  OPTIONAL { ?doc doc:createdAt ?createdAt }',
    '  OPTIONAL { ?doc doc:readOnly ?readOnly }',
    '  OPTIONAL { ?doc doc:sourceStorageKey ?sourceStorageKey }',
    '  OPTIONAL { ?doc doc:sourceOriginalFilename ?sourceOriginalFilename }',
    '  OPTIONAL { ?doc doc:sourceMimeType ?sourceMimeType }',
    '  OPTIONAL { ?doc doc:sourceContentSize ?sourceContentSize }',
    '  OPTIONAL { ?doc doc:sourceFileType ?sourceFileType }',
    '} }',
    'ORDER BY ?order LCASE(STR(?label))',
  ].join('\n')
}

export function sidebarFolderListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>',
    'SELECT ?folder (COALESCE(?name, "Untitled Folder") AS ?label) ?parent ?order ?section',
    `WHERE { GRAPH <${ws}> {`,
    '  ?folder a doc:Folder .',
    '  OPTIONAL { ?folder nfo:fileName ?name }',
    '  OPTIONAL { ?folder nfo:belongsToContainer ?parent }',
    '  OPTIONAL { ?folder doc:order ?order }',
    '  OPTIONAL { ?folder doc:section ?section }',
    '} }',
    'ORDER BY ?order LCASE(STR(?label))',
  ].join('\n')
}

export function sidebarArtifactListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>',
    'PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>',
    'SELECT ?artifact (COALESCE(?filename, "Untitled Artifact") AS ?label) ?parent ?order ?mimeType ?status ?fileType ?ingestedDoc',
    `WHERE { GRAPH <${ws}> {`,
    '  ?artifact a doc:Artifact .',
    '  OPTIONAL { ?artifact nfo:fileName ?filename }',
    '  OPTIONAL { ?artifact nfo:belongsToContainer ?parent }',
    '  OPTIONAL { ?artifact doc:order ?order }',
    '  OPTIONAL { ?artifact nie:mimeType ?mimeType }',
    '  OPTIONAL { ?artifact doc:status ?status }',
    '  OPTIONAL { ?artifact doc:fileType ?fileType }',
    '  OPTIONAL { ?artifact doc:ingestedDocId ?ingestedDoc }',
    '} }',
    'ORDER BY ?order LCASE(STR(?label))',
  ].join('\n')
}

export function tagListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT ?tag (COUNT(DISTINCT ?subject) AS ?count)',
    `WHERE { GRAPH <${ws}> {`,
    '  ?subject doc:hasTag ?tag .',
    '} }',
    'GROUP BY ?tag',
    'ORDER BY LCASE(STR(?tag))',
  ].join('\n')
}

export function sidebarTagFromRow(row: Record<string, string>): SidebarTag | null {
  const name = row.tag ? normalizeTagName(row.tag) : null
  if (!name) return null
  return {
    name,
    count: parseCount(row.count),
  }
}

function sidebarSectionsFromTags(tags: readonly SidebarTag[]): SidebarSection {
  const observed = new Map<string, number | undefined>()
  for (const tag of tags) {
    observed.set(tag.name, tag.count)
  }

  const coreNames = new Set(CORE_SIDEBAR_TAGS.map((tag) => tag.name))
  const merged: SidebarTag[] = CORE_SIDEBAR_TAGS.map((tag) => ({
    name: tag.name,
    count: observed.get(tag.name),
  }))
  for (const tag of tags) {
    if (coreNames.has(tag.name)) continue
    merged.push(tag)
  }
  merged.sort((a, b) => {
    const ai = CORE_TAG_ORDER.get(a.name)
    const bi = CORE_TAG_ORDER.get(b.name)
    if (ai !== undefined || bi !== undefined) return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER)
    return a.name.localeCompare(b.name)
  })

  const nodes: SidebarNode[] = merged.map((tag) => ({
    id: `tag:${tag.name}`,
    label: tag.name,
    kind: 'tag',
    icon: 'hash',
    count: typeof tag.count === 'number' && tag.count > 0 ? tag.count : undefined,
  }))
  return {
    id: 'tags',
    label: 'Tags',
    icon: 'hash',
    nodes,
    count: nodes.length,
    emptyLabel: 'No tags in this graph',
  }
}

interface SidebarNodeDraft {
  readonly id: string
  readonly label: string
  readonly kind: 'folder' | 'document' | 'artifact'
  readonly icon: string
  readonly parentId: string | null
  readonly section: 'documents' | 'artifacts'
  readonly order: number
  readonly createdAt?: number
  readonly active?: boolean
  readonly selected?: boolean
  readonly readOnly?: boolean
  readonly sourceFile?: SidebarDocumentSourceFile | null
  readonly badge?: string | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  readonly status?: string | null
  readonly ingestedDocumentId?: string | null
  children: SidebarNodeDraft[]
}

function sortTreeNodes(nodes: SidebarNodeDraft[]): SidebarNodeDraft[] {
  return nodes.sort((a, b) => {
    const aFolder = a.kind === 'folder'
    const bFolder = b.kind === 'folder'
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return a.label.localeCompare(b.label)
  })
}

function draftContainsActive(node: SidebarNodeDraft, activeId: string | null): boolean {
  if (!activeId) return false
  if (node.id === activeId) return true
  return node.children.some((child) => draftContainsActive(child, activeId))
}

export function sidebarDocumentTree(
  docs: readonly SidebarDocument[],
  folders: readonly SidebarFolder[],
  activeId: string | null,
  expandedFolders: ReadonlySet<string> = new Set(),
): SidebarNode[] {
  const documentFolders = folders.filter((folder) => folder.section === 'documents')
  const folderNodeById = new Map<string, SidebarNodeDraft>()
  const roots: SidebarNodeDraft[] = []

  function pushChild(parentId: string | null, node: SidebarNodeDraft): void {
    const parent = parentId ? folderNodeById.get(parentId) : undefined
    if (parent && parent.id !== node.id) {
      parent.children.push(node)
      return
    }
    roots.push(node)
  }

  for (const folder of documentFolders) {
    folderNodeById.set(folder.id, {
      id: folder.id,
      label: folder.label || 'Untitled Folder',
      kind: 'folder',
      icon: 'folder',
      parentId: folder.parentId,
      section: 'documents',
      order: folder.order,
      children: [],
    })
  }

  for (const folder of documentFolders) {
    pushChild(folder.parentId, folderNodeById.get(folder.id)!)
  }

  for (const doc of docs) {
    pushChild(doc.parentId, {
      id: doc.id,
      label: doc.label || 'Untitled',
      kind: 'document',
      icon: doc.readOnly ? 'book-open' : 'file-text',
      parentId: doc.parentId,
      section: 'documents',
      order: doc.order,
      ...(doc.createdAt === undefined ? {} : { createdAt: doc.createdAt }),
      active: activeId === doc.id,
      selected: activeId === doc.id,
      readOnly: doc.readOnly,
      sourceFile: doc.sourceFile,
      children: [],
    })
  }

  function finalize(nodes: SidebarNodeDraft[]): SidebarNode[] {
    const sorted = sortTreeNodes(nodes)
    return sorted.map((node) => {
      if (node.kind !== 'folder') {
        return {
          id: node.id,
          label: node.label,
          kind: 'document',
          icon: node.icon,
          parentId: node.parentId,
          section: node.section,
          order: node.order,
          ...(node.createdAt === undefined ? {} : { createdAt: node.createdAt }),
          active: node.active,
          selected: node.selected,
          readOnly: node.readOnly,
          sourceFile: node.sourceFile,
        }
      }
      const children = finalize([...node.children])
      const expanded = expandedFolders.has(node.id) || node.children.some((child) => draftContainsActive(child, activeId))
      return {
        id: node.id,
        label: node.label,
        kind: 'folder',
        icon: node.icon,
        parentId: node.parentId,
        section: node.section,
        order: node.order,
        expanded,
        children,
      }
    })
  }

  return finalize(roots)
}

function artifactBadge(artifact: SidebarArtifact): string | null {
  if (artifact.status && artifact.status !== 'ready') return artifact.status
  if (artifact.fileType) return artifact.fileType
  const subtype = artifact.mimeType.split('/')[1]?.split(/[+;]/)[0]
  if (!subtype || subtype === 'octet-stream') return null
  return subtype.slice(0, 10)
}

export function sidebarArtifactTree(
  artifacts: readonly SidebarArtifact[],
  folders: readonly SidebarFolder[],
  activeId: string | null = null,
  expandedFolders: ReadonlySet<string> = new Set(),
): SidebarNode[] {
  const artifactFolders = folders.filter((folder) => folder.section === 'artifacts')
  const folderNodeById = new Map<string, SidebarNodeDraft>()
  const roots: SidebarNodeDraft[] = []

  function pushChild(parentId: string | null, node: SidebarNodeDraft): void {
    const parent = parentId ? folderNodeById.get(parentId) : undefined
    if (parent && parent.id !== node.id) {
      parent.children.push(node)
      return
    }
    roots.push(node)
  }

  for (const folder of artifactFolders) {
    folderNodeById.set(folder.id, {
      id: folder.id,
      label: folder.label || 'Untitled Folder',
      kind: 'folder',
      icon: 'folder',
      parentId: folder.parentId,
      section: 'artifacts',
      order: folder.order,
      children: [],
    })
  }

  for (const folder of artifactFolders) {
    pushChild(folder.parentId, folderNodeById.get(folder.id)!)
  }

  for (const artifact of artifacts) {
    if (artifact.ingestedDocumentId) continue
    pushChild(artifact.parentId, {
      id: artifact.id,
      label: artifact.label || artifact.id,
      kind: 'artifact',
      icon: 'diamond',
      parentId: artifact.parentId,
      section: 'artifacts',
      order: artifact.order,
      active: activeId === artifact.id,
      selected: activeId === artifact.id,
      badge: artifactBadge(artifact),
      mimeType: artifact.mimeType,
      fileType: artifact.fileType ?? null,
      status: artifact.status,
      ingestedDocumentId: artifact.ingestedDocumentId ?? null,
      children: [],
    })
  }

  function finalize(nodes: SidebarNodeDraft[]): SidebarNode[] {
    const sorted = sortTreeNodes(nodes)
    return sorted.map((node) => {
      if (node.kind !== 'folder') {
        return {
          id: node.id,
          label: node.label,
          kind: 'artifact',
          icon: node.icon,
          parentId: node.parentId,
          section: node.section,
          order: node.order,
          active: node.active,
          selected: node.selected,
          badge: node.badge,
          mimeType: node.mimeType,
          fileType: node.fileType,
          status: node.status,
          ingestedDocumentId: node.ingestedDocumentId,
        }
      }
      const children = finalize([...node.children])
      const expanded = expandedFolders.has(node.id) || node.children.some((child) => draftContainsActive(child, activeId))
      return {
        id: node.id,
        label: node.label,
        kind: 'folder',
        icon: node.icon,
        parentId: node.parentId,
        section: node.section,
        order: node.order,
        expanded,
        children,
      }
    })
  }

  return finalize(roots)
}

function nodeSection(node: SidebarNode, fallback: 'documents' | 'artifacts'): 'documents' | 'artifacts' {
  return node.section === 'artifacts' ? 'artifacts' : fallback
}

export function sidebarFolderOptionsFromSections(sections: readonly SidebarSection[]): SidebarFolderOption[] {
  const options: SidebarFolderOption[] = []

  function visit(node: SidebarNode, parentId: string | null, section: 'documents' | 'artifacts'): void {
    const currentSection = nodeSection(node, section)
    if (node.kind === 'folder') {
      options.push({
        id: node.id,
        name: node.label || node.id,
        parentId: node.parentId ?? parentId,
        section: currentSection,
      })
    }
    for (const child of node.children ?? []) {
      visit(child, node.kind === 'folder' ? node.id : parentId, currentSection)
    }
  }

  for (const section of sections) {
    const folderSection = section.id === 'artifacts' ? 'artifacts' : 'documents'
    for (const node of section.nodes ?? []) {
      visit(node, null, folderSection)
    }
  }

  return options.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.name.localeCompare(b.name)
  })
}

export function sidebarFolderMoveExcludeIds(sections: readonly SidebarSection[], folderId: string): string[] {
  const exclude = new Set<string>()

  function collectFolderDescendants(node: SidebarNode): void {
    for (const child of node.children ?? []) {
      if (child.kind === 'folder') {
        exclude.add(child.id)
        collectFolderDescendants(child)
      }
    }
  }

  function find(node: SidebarNode): boolean {
    if (node.id === folderId && node.kind === 'folder') {
      exclude.add(node.id)
      collectFolderDescendants(node)
      return true
    }
    return (node.children ?? []).some(find)
  }

  for (const section of sections) {
    if ((section.nodes ?? []).some(find)) break
  }

  return [...exclude]
}

export function sidebarSectionsFromDocuments(
  docs: readonly SidebarDocument[],
  activeId: string | null,
  tags: readonly SidebarTag[] = [],
  folders: readonly SidebarFolder[] = [],
  expandedFolders: ReadonlySet<string> = new Set(),
  artifacts: readonly SidebarArtifact[] = [],
  activeArtifactId: string | null = null,
): SidebarSection[] {
  const nodes = sidebarDocumentTree(docs, folders, activeId, expandedFolders)
  const artifactNodes = sidebarArtifactTree(artifacts, folders, activeArtifactId, expandedFolders)
  return [
    {
      id: 'documents',
      label: 'Documents',
      icon: 'file-text',
      nodes,
      count: docs.length,
      emptyLabel: 'No documents in this graph',
    },
    {
      id: 'artifacts',
      label: 'Artifacts',
      icon: 'diamond',
      nodes: artifactNodes,
      count: artifacts.filter((artifact) => !artifact.ingestedDocumentId).length,
      emptyLabel: 'No artifacts in this graph',
    },
    sidebarSectionsFromTags(tags),
  ]
}

export async function loadSidebarSections(
  rest: SidebarDocumentRest,
  graphId: string,
  activeId: string | null,
  expandedFolders: ReadonlySet<string> = new Set(),
): Promise<SidebarSection[]> {
  const [docResult, folderResult, artifactResult, tagResult] = (await Promise.all([
    rest.query(graphId, sidebarDocumentListSparql(graphId)),
    rest.query(graphId, sidebarFolderListSparql(graphId)),
    rest.query(graphId, sidebarArtifactListSparql(graphId)),
    rest.query(graphId, tagListSparql(graphId)),
  ])) as [QueryResult, QueryResult, QueryResult, QueryResult]
  const docs: SidebarDocument[] = []
  for (const row of docResult.rows ?? []) {
    const doc = sidebarDocumentFromRow(row)
    if (doc) docs.push(doc)
  }
  const folders: SidebarFolder[] = []
  for (const row of folderResult.rows ?? []) {
    const folder = sidebarFolderFromRow(row)
    if (folder) folders.push(folder)
  }
  const artifacts: SidebarArtifact[] = []
  for (const row of artifactResult.rows ?? []) {
    const artifact = sidebarArtifactFromRow(row)
    if (artifact) artifacts.push(artifact)
  }
  const tags: SidebarTag[] = []
  for (const row of tagResult.rows ?? []) {
    const tag = sidebarTagFromRow(row)
    if (tag) tags.push(tag)
  }
  return sidebarSectionsFromDocuments(docs, activeId, tags, folders, expandedFolders, artifacts)
}
