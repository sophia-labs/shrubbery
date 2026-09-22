import {
  documentFileName,
  documentModelFileName,
  documentModelPath,
  documentXhtmlPath,
  KOREADER_MANIFEST_SCHEMA,
  KOREADER_MANIFEST_VERSION,
  KOREADER_PROJECTION_VERSION,
  KOREADER_TARGET,
  type KoreaderArtifact,
  type KoreaderArtifactFile,
  type KoreaderManifest,
  type ReaderBlock,
  type ReaderDocument,
  type ReaderLibrary,
  type ReaderMark,
} from './model.js'
import { renderKoreaderLibraryIndex, renderKoreaderXhtml } from './xhtml.js'

export interface RenderKoreaderFeedOptions {
  /** Injectable for deterministic builds and tests. */
  readonly generatedAt?: string
  /** Optional canonical URL builder for document metadata. */
  readonly canonicalDocumentUrl?: (document: ReaderDocument) => string
  /** Relative path from this manifest to the root workspace catalogue. */
  readonly workspaceCataloguePath?: string
}

/** Render a complete, transport-neutral KOReader feed from a reader library. */
export function renderKoreaderFeed(
  library: ReaderLibrary,
  options: RenderKoreaderFeedOptions = {},
): KoreaderArtifact {
  assertLibrary(library)
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const sortedDocuments = [...library.documents].sort(compareDocuments)
  const manifest: KoreaderManifest = {
    schema: KOREADER_MANIFEST_SCHEMA,
    version: KOREADER_MANIFEST_VERSION,
    projectionVersion: KOREADER_PROJECTION_VERSION,
    generatedAt,
    library: {
      id: library.id,
      graphId: library.graphId,
      title: library.title,
      indexPath: 'index.xhtml',
    },
    workspaceCataloguePath: options.workspaceCataloguePath ?? 'workspaces.json',
    navigation: {
      folders: [...(library.folders ?? [])].sort(compareFolders),
    },
    capabilities: {
      semanticSidecars: true,
      crossDocumentLinks: true,
      remoteWrites: false,
    },
    documents: sortedDocuments.map((document) => ({
      id: document.id,
      graphId: document.graphId,
      title: document.title,
      revision: document.revision,
      ...optionalStringField('snippet', document.snippet),
      ...optionalStringField('updatedAt', document.updatedAt),
      ...optionalStringField('parentId', document.parentId),
      path: documentXhtmlPath(document.id),
      modelPath: documentModelPath(document.id),
      fileName: documentFileName(document.id),
      modelFileName: documentModelFileName(document.id),
      mediaType: 'application/xhtml+xml' as const,
    })),
  }

  const documentHref = (documentId: string): string => `./${documentFileName(documentId)}`
  const files: KoreaderArtifactFile[] = [
    {
      path: 'manifest.json',
      mediaType: 'application/json; charset=utf-8',
      body: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    {
      path: 'index.xhtml',
      mediaType: 'application/xhtml+xml; charset=utf-8',
      body: renderKoreaderLibraryIndex(library.title, sortedDocuments),
    },
  ]

  for (const [index, document] of sortedDocuments.entries()) {
    const previous = sortedDocuments[index - 1]
    const next = sortedDocuments[index + 1]
    files.push({
      path: documentXhtmlPath(document.id),
      mediaType: 'application/xhtml+xml; charset=utf-8',
      body: renderKoreaderXhtml(document, {
        libraryTitle: library.title,
        documentHref,
        navigation: {
          position: index + 1,
          total: sortedDocuments.length,
          ...(previous ? { previous: { id: previous.id, title: previous.title } } : {}),
          ...(next ? { next: { id: next.id, title: next.title } } : {}),
        },
        ...(options.canonicalDocumentUrl
          ? { canonicalUrl: options.canonicalDocumentUrl(document) }
          : {}),
      }),
    })
    files.push({
      path: documentModelPath(document.id),
      mediaType: 'application/json; charset=utf-8',
      body: `${JSON.stringify(document, null, 2)}\n`,
    })
  }

  return { target: KOREADER_TARGET, manifest, files }
}

function compareDocuments(left: ReaderDocument, right: ReaderDocument): number {
  const leftDate = left.updatedAt ?? ''
  const rightDate = right.updatedAt ?? ''
  if (leftDate !== rightDate) return rightDate.localeCompare(leftDate)
  return left.title.localeCompare(right.title)
}

function compareFolders(left: NonNullable<ReaderLibrary['folders']>[number], right: NonNullable<ReaderLibrary['folders']>[number]): number {
  if (left.order !== right.order) return left.order - right.order
  return left.label.localeCompare(right.label)
}

function assertLibrary(library: ReaderLibrary): void {
  assertNonEmpty(library.id, 'library.id')
  assertNonEmpty(library.graphId, 'library.graphId')
  assertNonEmpty(library.title, 'library.title')
  const folderIds = new Set<string>()
  for (const folder of library.folders ?? []) {
    assertNonEmpty(folder.id, 'folder.id')
    assertNonEmpty(folder.label, `folder ${folder.id}.label`)
    if (folder.graphId !== library.graphId) {
      throw new TypeError(
        `folder ${folder.id} belongs to graph ${folder.graphId}, expected ${library.graphId}`,
      )
    }
    if (!Number.isFinite(folder.order)) {
      throw new TypeError(`folder ${folder.id}.order must be finite`)
    }
    if (folderIds.has(folder.id)) throw new TypeError(`duplicate folder id: ${folder.id}`)
    folderIds.add(folder.id)
  }
  const ids = new Set<string>()
  for (const document of library.documents) {
    assertDocument(document, library.graphId)
    if (ids.has(document.id)) throw new TypeError(`duplicate document id: ${document.id}`)
    ids.add(document.id)
  }
}

function assertDocument(document: ReaderDocument, graphId: string): void {
  assertNonEmpty(document.id, 'document.id')
  assertNonEmpty(document.title, `document ${document.id}.title`)
  if (document.graphId !== graphId) {
    throw new TypeError(
      `document ${document.id} belongs to graph ${document.graphId}, expected ${graphId}`,
    )
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    throw new TypeError(`document ${document.id}.revision must be a non-negative integer`)
  }
  const blockIds = new Set<string>()
  for (const block of document.blocks) {
    assertBlock(block, document.id)
    if (blockIds.has(block.id)) {
      throw new TypeError(`duplicate block id ${block.id} in document ${document.id}`)
    }
    blockIds.add(block.id)
  }
}

function assertBlock(block: ReaderBlock, documentId: string): void {
  assertNonEmpty(block.id, `document ${documentId} block.id`)
  if (!Number.isFinite(block.order)) {
    throw new TypeError(`document ${documentId} block ${block.id}.order must be finite`)
  }
  for (const mark of block.marks) assertMark(mark, documentId, block.id, block.text.length)
}

function assertMark(mark: ReaderMark, documentId: string, blockId: string, textLength: number): void {
  if (
    !Number.isInteger(mark.start)
    || mark.start < 0
    || !Number.isInteger(mark.end)
    || mark.end < mark.start
    || mark.end > textLength
  ) {
    throw new TypeError(
      `document ${documentId} block ${blockId} carries an invalid mark range`,
    )
  }
}

function assertNonEmpty(value: string, path: string): void {
  if (!value.trim()) throw new TypeError(`${path} must be non-empty`)
}

function optionalStringField<Key extends string>(
  key: Key,
  value: string | undefined,
): { readonly [Property in Key]?: string } {
  return value === undefined
    ? {}
    : { [key]: value } as { [Property in Key]: string }
}
