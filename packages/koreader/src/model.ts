/**
 * The KOReader target is an artifact target rather than a fifth HTTP face.
 *
 * Shrubbery's existing `RenderTarget` contract maps one Resource to one body,
 * content type and link set. A KOReader application needs a manifest, multiple
 * XHTML documents, semantic sidecars and a stateful Lua host. Keeping that
 * distinction explicit preserves the current content-negotiation invariant.
 */
export const KOREADER_TARGET = 'koreader' as const
export type KoreaderTarget = typeof KOREADER_TARGET

export const KOREADER_MANIFEST_SCHEMA = 'urn:sophia:shrubbery:koreader:manifest:v0.1'
export const KOREADER_MANIFEST_VERSION = 1 as const
/** Bump when equivalent Garden data must be reprojected into different reader files. */
export const KOREADER_PROJECTION_VERSION = 6 as const
export const KOREADER_WORKSPACE_CATALOGUE_SCHEMA =
  'urn:sophia:shrubbery:koreader:workspaces:v0.1'
export const KOREADER_WORKSPACE_CATALOGUE_VERSION = 1 as const

export type ReaderBlockType =
  | 'heading'
  | 'paragraph'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'
  | 'image'
  | 'math'

export interface ReaderMark {
  readonly id?: string
  readonly type: string
  /** UTF-16 offsets, matching JavaScript and ProseMirror string indexing. */
  readonly start: number
  readonly end: number
  readonly href?: string
  readonly targetDocumentId?: string
  readonly label?: string
}

export interface ReaderBlock {
  readonly id: string
  readonly type: ReaderBlockType
  readonly text: string
  readonly parentId?: string
  readonly order: number
  readonly level?: number
  readonly checked?: boolean
  readonly language?: string
  readonly marks: readonly ReaderMark[]
  readonly imageSrc?: string
  readonly altText?: string
}

export interface ReaderDocument {
  readonly id: string
  readonly graphId: string
  readonly title: string
  readonly revision: number
  readonly blocks: readonly ReaderBlock[]
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly snippet?: string
  readonly parentId?: string
  readonly readOnly: boolean
}

export interface ReaderFolder {
  readonly id: string
  readonly graphId: string
  readonly label: string
  readonly parentId?: string
  readonly order: number
  readonly section: 'documents'
}

export interface ReaderLibrary {
  readonly id: string
  readonly graphId: string
  readonly title: string
  readonly folders?: readonly ReaderFolder[]
  readonly documents: readonly ReaderDocument[]
}

export interface KoreaderManifestDocument {
  readonly id: string
  readonly graphId: string
  readonly title: string
  readonly revision: number
  readonly snippet?: string
  readonly updatedAt?: string
  readonly parentId?: string
  /** Relative to manifest.json. */
  readonly path: string
  /** Semantic sidecar relative to manifest.json. */
  readonly modelPath: string
  /** Stable local names used by the KOReader cache. */
  readonly fileName: string
  readonly modelFileName: string
  readonly mediaType: 'application/xhtml+xml'
}

export interface KoreaderManifest {
  readonly schema: typeof KOREADER_MANIFEST_SCHEMA
  readonly version: typeof KOREADER_MANIFEST_VERSION
  readonly projectionVersion: typeof KOREADER_PROJECTION_VERSION
  readonly generatedAt: string
  readonly library: {
    readonly id: string
    readonly graphId: string
    readonly title: string
    readonly indexPath: 'index.xhtml'
  }
  /** Relative to this manifest. The configured root feed owns the catalogue. */
  readonly workspaceCataloguePath: string
  readonly navigation: {
    readonly folders: readonly ReaderFolder[]
  }
  readonly capabilities: {
    readonly semanticSidecars: true
    readonly crossDocumentLinks: true
    readonly remoteWrites: false
  }
  readonly documents: readonly KoreaderManifestDocument[]
}

export interface KoreaderWorkspaceCatalogueEntry {
  readonly id: string
  readonly graphId: string
  readonly title: string
  /** Relative to the configured root manifest. */
  readonly manifestPath: string
  readonly documentCount: number
  readonly folderCount: number
}

export interface KoreaderWorkspaceCatalogue {
  readonly schema: typeof KOREADER_WORKSPACE_CATALOGUE_SCHEMA
  readonly version: typeof KOREADER_WORKSPACE_CATALOGUE_VERSION
  readonly generatedAt: string
  readonly activeWorkspaceId: string
  readonly workspaces: readonly KoreaderWorkspaceCatalogueEntry[]
}

export interface KoreaderArtifactFile {
  /** POSIX-style path relative to the feed root. */
  readonly path: string
  readonly mediaType: string
  readonly body: string
}

export interface KoreaderArtifact {
  readonly target: KoreaderTarget
  readonly manifest: KoreaderManifest
  readonly files: readonly KoreaderArtifactFile[]
}

/**
 * Stable, filesystem-safe encoding for document IDs.
 *
 * We retain a readable ASCII subset and encode every other Unicode code point
 * as `~hex~`. Very long IDs are truncated with a deterministic FNV-1a suffix.
 */
export function safeDocumentFileStem(documentId: string): string {
  const source = documentId.trim() || 'document'
  let encoded = ''
  for (const character of source) {
    if (/^[A-Za-z0-9._-]$/.test(character)) {
      encoded += character
    } else {
      encoded += `~${character.codePointAt(0)?.toString(16) ?? '0'}~`
    }
  }
  if (encoded.length <= 96) return encoded
  return `${encoded.slice(0, 80)}-${fnv1a32(source)}`
}

export function documentXhtmlPath(documentId: string): string {
  return `documents/${documentFileName(documentId)}`
}

export function documentModelPath(documentId: string): string {
  return `models/${documentModelFileName(documentId)}`
}

export function documentFileName(documentId: string): string {
  return `${safeDocumentFileStem(documentId)}.xhtml`
}

export function documentModelFileName(documentId: string): string {
  return `${safeDocumentFileStem(documentId)}.json`
}

/** XHTML id values need to start with a conservative name character. */
export function blockAnchor(blockId: string): string {
  return `sophia-block-${safeDocumentFileStem(blockId)}`
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
