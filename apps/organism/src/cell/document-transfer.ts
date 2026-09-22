/**
 * Browser-side document transfer for the Organism cell shell.
 *
 * Garden's transfer routes are deliberately shell concerns: multipart bytes,
 * bearer headers, job polling, the Clipboard API, and object-URL downloads must
 * never enter the backend-free Shrubbery packages.  This module keeps those
 * concerns beside the concrete gardend contract while presenting small,
 * testable upload/import/export operations to main.ts.
 */

import type { MnExportDialog } from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'

export const DOCUMENT_IMPORT_ACCEPT = [
  '.pdf',
  '.epub',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.xml',
  '.log',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.ini',
  '.cfg',
  '.conf',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.less',
  '.sh',
  '.sql',
  '.graphql',
  '.gql',
  '.toml',
].join(',')

export type DocumentExportFormat = 'markdown' | 'html' | 'xml'
export type DocumentExportTheme = 'garden' | 'manuscript' | 'dusk' | 'meridian' | 'vesper'
export type TransferJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface TransferProgress {
  readonly jobId: string
  readonly status: TransferJobStatus
  readonly message?: string
  readonly percent?: number
}

export interface UploadedDocument {
  readonly file: File
  readonly documentId: string
  readonly title: string
  readonly fileType: string
  readonly readOnly: boolean
  readonly sourceFile: Record<string, unknown> | null
  readonly jobId: string | null
}

export interface FailedDocumentUpload {
  readonly file: File
  readonly error: Error
}

export interface UploadBatchResult {
  readonly succeeded: readonly UploadedDocument[]
  readonly failed: readonly FailedDocumentUpload[]
  readonly skipped: readonly File[]
  readonly cancelled: boolean
}

export interface ImportedArtifactDocument {
  readonly artifactId: string
  readonly documentId: string
  readonly title: string
  readonly readOnly: boolean
  readonly jobId: string | null
}

export interface ImportWebClipOptions {
  readonly title?: string
  readonly folderId?: string | null
  /**
   * Deterministic/pre-fetched HTML. Production normally omits this and lets
   * the cell fetch the URL; browser and real-cell acceptance harnesses supply
   * it so tests never depend on the public internet.
   */
  readonly html?: string
  readonly signal?: AbortSignal
}

export interface ImportYouTubeClipOptions {
  readonly title?: string
  readonly folderId?: string | null
  readonly languages?: readonly string[]
  readonly mode?: 'readable' | 'timestamped'
  readonly chunkSeconds?: number
  readonly showRanges?: boolean
  readonly signal?: AbortSignal
}

export interface ImportedWebClip {
  readonly documentId: string
  readonly status: 'complete'
  readonly warnings: readonly string[]
}

export interface ExportedDocument {
  readonly blob: Blob
  readonly filename: string
  readonly format: DocumentExportFormat
  readonly contentType: string
}

export interface UploadFilesOptions {
  readonly parentId?: string | null
  readonly parentIdForFile?: (file: File) => string | null | undefined
  readonly signal?: AbortSignal
  readonly onFileStart?: (file: File, index: number, total: number) => void
  readonly onProgress?: (file: File, progress: TransferProgress) => void
}

export interface ImportArtifactOptions {
  readonly title?: string
  readonly parentId?: string | null
  readonly readOnly?: boolean
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: TransferProgress) => void
}

export interface ExportDocumentOptions {
  readonly format: DocumentExportFormat
  readonly theme?: DocumentExportTheme
  readonly title?: string
  readonly signal?: AbortSignal
}

export interface GardendDocumentTransferOptions {
  readonly fetch?: typeof fetch
  readonly pollIntervalMs?: number
  readonly jobTimeoutMs?: number
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /**
   * Browser-native parser used for binary office/book formats. `false` exists
   * only as an explicit compatibility escape hatch for contract probes against
   * older cells; production defaults to the built-in parser so uploads never
   * enter gardend's currently non-conforming numeric source-size path.
   */
  readonly binaryParser?: BrowserBinaryDocumentParser | false
}

export type BrowserBinaryFileType = 'pdf' | 'epub' | 'docx'

export interface ParsedBrowserBinaryDocument {
  readonly fileType: BrowserBinaryFileType
  readonly title: string
  readonly markdown: string
  readonly warnings: readonly string[]
}

export type BrowserBinaryDocumentParser = (
  file: File,
  signal?: AbortSignal,
) => Promise<ParsedBrowserBinaryDocument>

interface JobEnvelope {
  readonly job_id?: unknown
  readonly jobId?: unknown
  readonly status?: unknown
  readonly detail?: unknown
  readonly progress?: unknown
  readonly error?: unknown
  readonly links?: unknown
  readonly documentId?: unknown
  readonly document_id?: unknown
  readonly title?: unknown
  readonly fileType?: unknown
  readonly file_type?: unknown
  readonly readOnly?: unknown
  readonly read_only?: unknown
  readonly sourceFile?: unknown
  readonly source_file?: unknown
  readonly [key: string]: unknown
}

interface JobTerminal {
  readonly submit: JobEnvelope
  readonly status: JobEnvelope | null
  readonly result: JobEnvelope | null
}

export class DocumentTransferError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly payload?: unknown,
  ) {
    super(message)
    this.name = 'DocumentTransferError'
  }
}

export class DocumentTransferCancelledError extends Error {
  constructor(message = 'Document transfer cancelled') {
    super(message)
    this.name = 'AbortError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
    : []
}

function jobIdOf(envelope: JobEnvelope): string | null {
  return stringValue(envelope.job_id) ?? stringValue(envelope.jobId)
}

function jobStatusOf(envelope: JobEnvelope): TransferJobStatus | null {
  const raw = stringValue(envelope.status)?.toLocaleLowerCase()
  return raw === 'queued' || raw === 'running' || raw === 'succeeded' || raw === 'failed' || raw === 'cancelled'
    ? raw
    : null
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return []
  const out = [value]
  for (const key of ['detail', 'result', 'result_inline', 'resultInline', 'document']) {
    const child = value[key]
    if (isRecord(child)) out.push(...nestedRecords(child))
  }
  return out
}

function firstNestedString(envelopes: readonly (JobEnvelope | null)[], keys: readonly string[]): string | null {
  for (const envelope of envelopes) {
    for (const record of nestedRecords(envelope)) {
      for (const key of keys) {
        const value = stringValue(record[key])
        if (value) return value
      }
    }
  }
  return null
}

function firstNestedBoolean(envelopes: readonly (JobEnvelope | null)[], keys: readonly string[]): boolean | null {
  for (const envelope of envelopes) {
    for (const record of nestedRecords(envelope)) {
      for (const key of keys) {
        const value = booleanValue(record[key])
        if (value !== null) return value
      }
    }
  }
  return null
}

function firstNestedRecord(envelopes: readonly (JobEnvelope | null)[], keys: readonly string[]): Record<string, unknown> | null {
  for (const envelope of envelopes) {
    for (const record of nestedRecords(envelope)) {
      for (const key of keys) {
        const value = recordValue(record[key])
        if (value) return value
      }
    }
  }
  return null
}

function basenameWithoutExtension(filename: string): string {
  const stripped = filename.replace(/\.[^.]+$/, '').trim()
  return stripped || filename || 'Untitled'
}

async function blobBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DocumentTransferCancelledError()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (signal?.aborted) throw new DocumentTransferCancelledError()
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function transferArtifactId(): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `document-import-${id}`
}

function transferDocumentId(): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `doc-${id.replace(/-/g, '')}`
}

type CellWriteFormat = 'plain' | 'markdown' | 'html' | 'xml'

function textWriteFormat(filename: string, mimeType: string): CellWriteFormat | null {
  const extension = filename.toLocaleLowerCase().split('.').pop() ?? ''
  const normalizedMimeType = mimeType.toLocaleLowerCase().split(';', 1)[0]?.trim() ?? ''
  if (extension === 'md' || extension === 'markdown' || /markdown/i.test(mimeType)) return 'markdown'
  if (extension === 'html' || extension === 'htm' || /html/i.test(mimeType)) return 'html'
  if (
    extension === 'xml'
    || normalizedMimeType === 'application/xml'
    || normalizedMimeType === 'text/xml'
    || normalizedMimeType.endsWith('+xml')
  ) return 'xml'
  const textExtensions = new Set([
    'txt', 'log', 'csv', 'json', 'yaml', 'yml', 'ini', 'cfg', 'conf',
    'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'sh', 'bash',
    'zsh', 'fish', 'sql', 'graphql', 'gql', 'toml', 'env', 'properties',
    'gitignore', 'dockerignore', 'editorconfig',
  ])
  return mimeType.startsWith('text/') || textExtensions.has(extension) ? 'plain' : null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DocumentTransferCancelledError()
}

function extensionOf(filename: string): string {
  return filename.toLocaleLowerCase().split('.').pop() ?? ''
}

function browserBinaryFileType(file: File): BrowserBinaryFileType | null {
  const extension = extensionOf(file.name)
  if (extension === 'pdf' || extension === 'epub' || extension === 'docx') return extension
  const mimeType = file.type.toLocaleLowerCase()
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/epub+zip') return 'epub'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  return null
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]<>])/g, '\\$1')
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

interface PdfTextItemLike {
  readonly str?: unknown
  readonly transform?: unknown
  readonly hasEOL?: unknown
}

let pdfJsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null

async function loadPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      const maybeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
      if (worker.default) {
        const workerSrc = maybeProcess?.versions?.node && worker.default.startsWith('/@fs/')
          ? `file://${worker.default.slice('/@fs'.length)}`
          : worker.default
        if (!(maybeProcess?.versions?.node && workerSrc.startsWith('/node_modules/'))) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
        }
      }
      return pdfjs
    })
  }
  return pdfJsPromise
}

function pdfItemCoordinate(item: PdfTextItemLike, index: number): number {
  const transform = Array.isArray(item.transform) ? item.transform : []
  const value = transform[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function pdfPageText(items: readonly unknown[]): string {
  const rows = new Map<number, Array<{ x: number; text: string; eol: boolean }>>()
  for (const candidate of items) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as PdfTextItemLike
    if (typeof item.str !== 'string' || !item.str.trim()) continue
    const y = Math.round(pdfItemCoordinate(item, 5) * 2) / 2
    const row = rows.get(y) ?? []
    row.push({ x: pdfItemCoordinate(item, 4), text: item.str.trim(), eol: item.hasEOL === true })
    rows.set(y, row)
  }
  return [...rows.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, row]) => row
      .sort((left, right) => left.x - right.x)
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n')
}

async function parsePdfInBrowser(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedBrowserBinaryDocument> {
  throwIfAborted(signal)
  const pdfjs = await loadPdfJs()
  throwIfAborted(signal)
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: false,
  })
  try {
    const pdf = await loadingTask.promise
    const pages: string[] = []
    const warnings: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(signal)
      const page = await pdf.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const extracted = pdfPageText(content.items)
        if (extracted) pages.push(extracted)
        else warnings.push(`Page ${pageNumber} did not contain extractable text`)
      } finally {
        page.cleanup()
      }
    }
    const title = basenameWithoutExtension(file.name)
    const body = pages
      .map((page, index) => `${pages.length > 1 ? `## Page ${index + 1}\n\n` : ''}${escapeMarkdownText(page)}`)
      .join('\n\n')
    const markdown = body
      ? `# ${escapeMarkdownText(title)}\n\n${body}\n`
      : `# ${escapeMarkdownText(title)}\n\n[No text could be extracted. This PDF may require OCR.]\n`
    if (!body) warnings.push('No text extracted; OCR is not available in the browser fast path')
    return { fileType: 'pdf', title, markdown, warnings }
  } finally {
    await loadingTask.destroy().catch(() => undefined)
  }
}

function normalizedXmlName(value: string): string {
  return value.toLocaleLowerCase().split(':').pop() ?? value.toLocaleLowerCase()
}

function xmlElements(root: ParentNode, localName: string): Element[] {
  const normalized = normalizedXmlName(localName)
  return Array.from(root.querySelectorAll('*'))
    .filter(element => normalizedXmlName(element.localName) === normalized)
}

function xmlAttribute(element: Element | undefined, localName: string): string | null {
  if (!element) return null
  const normalized = normalizedXmlName(localName)
  for (const attribute of Array.from(element.attributes)) {
    if (normalizedXmlName(attribute.localName) === normalized) return attribute.value
  }
  return null
}

function parseXml(value: string, label: string): Document {
  if (typeof DOMParser === 'undefined') throw new Error(`${label}: DOMParser is unavailable`)
  const document = new DOMParser().parseFromString(value, 'application/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) throw new Error(`${label}: ${parserError.textContent?.trim() || 'invalid XML'}`)
  return document
}

function normalizeArchivePath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function joinArchivePath(directory: string, value: string): string {
  return normalizeArchivePath(directory ? `${directory}/${value}` : value)
}

function archiveDirectory(value: string): string {
  const normalized = normalizeArchivePath(value)
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

function archiveText(entries: Record<string, Uint8Array>, requestedPath: string): string | null {
  const normalized = normalizeArchivePath(requestedPath)
  const candidates = [normalized]
  try {
    candidates.push(decodeURIComponent(normalized))
  } catch {
    // Retain the literal archive path for malformed percent escapes.
  }
  for (const candidate of candidates) {
    const bytes = entries[candidate]
      ?? Object.entries(entries).find(([key]) => key.toLocaleLowerCase() === candidate.toLocaleLowerCase())?.[1]
    if (bytes) return new TextDecoder().decode(bytes)
  }
  return null
}

function markdownInlineFromHtml(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const element = node as Element
  const tag = element.localName.toLocaleLowerCase()
  const children = Array.from(element.childNodes).map(markdownInlineFromHtml).join('')
  if (tag === 'br') return '\n'
  if (tag === 'strong' || tag === 'b') return children.trim() ? `**${children.trim()}**` : ''
  if (tag === 'em' || tag === 'i') return children.trim() ? `*${children.trim()}*` : ''
  if (tag === 'code') return children.trim() ? `\`${children.trim().replace(/`/g, '\\`')}\`` : ''
  if (tag === 'a') {
    const href = element.getAttribute('href')?.trim()
    return href && children.trim() ? `[${children.trim()}](${href})` : children
  }
  if (tag === 'img') return element.getAttribute('alt')?.trim() ?? ''
  return children
}

function htmlToMarkdown(value: string): { title: string | null; markdown: string } {
  if (typeof DOMParser === 'undefined') throw new Error('HTML parser is unavailable')
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('script, style, noscript, template, nav').forEach(node => node.remove())
  const title = document.querySelector('title')?.textContent?.trim()
    ?? document.querySelector('h1')?.textContent?.trim()
    ?? null
  const blocks: string[] = []
  const roots = Array.from(document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table'))
    .filter(element => !element.parentElement?.closest('p,li,blockquote,pre,table'))
  for (const element of roots) {
    const tag = element.localName.toLocaleLowerCase()
    const text = cleanExtractedText(markdownInlineFromHtml(element))
    if (!text) continue
    if (/^h[1-6]$/.test(tag)) blocks.push(`${'#'.repeat(Number(tag.slice(1)))} ${text}`)
    else if (tag === 'li') blocks.push(`- ${text}`)
    else if (tag === 'blockquote') blocks.push(text.split('\n').map(line => `> ${line}`).join('\n'))
    else if (tag === 'pre') blocks.push(`\`\`\`\n${element.textContent?.trim() ?? ''}\n\`\`\``)
    else if (tag === 'table') blocks.push(text)
    else blocks.push(text)
  }
  if (blocks.length === 0) {
    const text = cleanExtractedText(document.body.textContent ?? '')
    if (text) blocks.push(text)
  }
  return { title, markdown: blocks.join('\n\n') }
}

async function unzipBrowserDocument(file: File, signal?: AbortSignal): Promise<Record<string, Uint8Array>> {
  throwIfAborted(signal)
  const { unzipSync } = await import('fflate')
  throwIfAborted(signal)
  try {
    return unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    throw new DocumentTransferError(
      `Cannot open ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function parseEpubInBrowser(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedBrowserBinaryDocument> {
  const entries = await unzipBrowserDocument(file, signal)
  const containerXml = archiveText(entries, 'META-INF/container.xml')
  if (!containerXml) throw new DocumentTransferError(`${file.name} is missing META-INF/container.xml`)
  const container = parseXml(containerXml, 'EPUB container')
  const rootfilePath = xmlAttribute(xmlElements(container, 'rootfile')[0], 'full-path')?.trim()
  if (!rootfilePath) throw new DocumentTransferError(`${file.name} does not declare an EPUB package document`)
  const packageXml = archiveText(entries, rootfilePath)
  if (!packageXml) throw new DocumentTransferError(`${file.name} is missing ${rootfilePath}`)
  const packageDocument = parseXml(packageXml, 'EPUB package')
  const packageDirectory = archiveDirectory(rootfilePath)
  const bookTitle = xmlElements(packageDocument, 'title')[0]?.textContent?.trim()
    || basenameWithoutExtension(file.name)
  const manifest = new Map<string, { href: string; path: string; mediaType: string }>()
  for (const item of xmlElements(packageDocument, 'item')) {
    const id = item.getAttribute('id')?.trim()
    const href = item.getAttribute('href')?.trim()
    if (!id || !href) continue
    manifest.set(id, {
      href,
      path: joinArchivePath(packageDirectory, href),
      mediaType: item.getAttribute('media-type')?.trim().toLocaleLowerCase() ?? '',
    })
  }
  const spine = xmlElements(packageDocument, 'itemref')
    .map(item => item.getAttribute('idref')?.trim() ?? '')
    .filter(Boolean)
  const ordered = (spine.length ? spine.map(id => manifest.get(id)).filter(Boolean) : [...manifest.values()])
    .filter((item): item is { href: string; path: string; mediaType: string } => Boolean(item))
    .filter(item => /(?:xhtml|html|xml)/.test(item.mediaType) || /\.(?:xhtml|html?|xml)$/i.test(item.href))
  const chapters: string[] = []
  const warnings: string[] = []
  for (const item of ordered) {
    throwIfAborted(signal)
    const html = archiveText(entries, item.path)
    if (!html) {
      warnings.push(`Missing EPUB spine item: ${item.href}`)
      continue
    }
    const parsed = htmlToMarkdown(html)
    if (!parsed.markdown.trim()) continue
    const chapterTitle = parsed.title ?? basenameWithoutExtension(item.href.split('/').pop() ?? item.href)
    chapters.push(`## ${escapeMarkdownText(chapterTitle)}\n\n${parsed.markdown}`)
  }
  if (chapters.length === 0) throw new DocumentTransferError(`${file.name} does not contain readable EPUB chapters`)
  return {
    fileType: 'epub',
    title: bookTitle,
    markdown: `# ${escapeMarkdownText(bookTitle)}\n\n${chapters.join('\n\n')}\n`,
    warnings,
  }
}

function docxParagraphText(paragraph: Element): string {
  const visit = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (node.nodeType !== 1) return ''
    const element = node as Element
    const localName = normalizedXmlName(element.localName)
    if (localName === 'tab') return '\t'
    if (localName === 'br' || localName === 'cr') return '\n'
    if (localName === 't') return element.textContent ?? ''
    return Array.from(element.childNodes).map(visit).join('')
  }
  return cleanExtractedText(Array.from(paragraph.childNodes).map(visit).join(''))
}

async function parseDocxInBrowser(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedBrowserBinaryDocument> {
  const entries = await unzipBrowserDocument(file, signal)
  const documentXml = archiveText(entries, 'word/document.xml')
  if (!documentXml) throw new DocumentTransferError(`${file.name} is missing word/document.xml`)
  const document = parseXml(documentXml, 'DOCX document')
  const rawParagraphs = documentXml.match(
    /<(?:[\w.-]+:)?p(?=[\s>])[\s\S]*?<\/(?:[\w.-]+:)?p>/gi,
  ) ?? []
  const blocks: string[] = []
  const paragraphs = xmlElements(document, 'p')
  const declaredTitleIndex = rawParagraphs.findIndex(raw =>
    /pStyle[^>]+(?:[\w.-]+:)?val\s*=\s*["'](?:Title|Heading\s*1)["']/i.test(raw),
  )
  let documentTitle = declaredTitleIndex >= 0 && paragraphs[declaredTitleIndex]
    ? docxParagraphText(paragraphs[declaredTitleIndex]) || null
    : null
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    throwIfAborted(signal)
    const text = docxParagraphText(paragraph)
    if (!text) continue
    const rawParagraph = rawParagraphs[index] ?? paragraph.outerHTML
    const style = xmlAttribute(xmlElements(paragraph, 'pStyle')[0], 'val')
      ?? /pStyle[^>]+(?:[\w.-]+:)?val\s*=\s*["']([^"']+)["']/i.exec(rawParagraph)?.[1]
      ?? ''
    const headingMatch = /heading\s*([1-6])/i.exec(style)
    if (/^title$/i.test(style)) {
      documentTitle ??= text
      blocks.push(`# ${escapeMarkdownText(text)}`)
    } else if (headingMatch) {
      const level = Math.max(1, Math.min(6, Number(headingMatch[1])))
      if (level === 1) documentTitle ??= text
      blocks.push(`${'#'.repeat(level)} ${escapeMarkdownText(text)}`)
    } else if (xmlElements(paragraph, 'numPr').length > 0 || /<(?:[\w.-]+:)?numPr\b/i.test(rawParagraph)) {
      blocks.push(`- ${escapeMarkdownText(text)}`)
    } else {
      blocks.push(escapeMarkdownText(text))
    }
  }
  if (blocks.length === 0) throw new DocumentTransferError(`${file.name} does not contain readable DOCX paragraphs`)
  const title = documentTitle ?? basenameWithoutExtension(file.name)
  if (!blocks[0]?.startsWith('# ')) blocks.unshift(`# ${escapeMarkdownText(title)}`)
  return { fileType: 'docx', title, markdown: `${blocks.join('\n\n')}\n`, warnings: [] }
}

/**
 * Garden-equivalent browser parser used to keep binary imports functional
 * while gardend's workspace vocabulary rejects its own numeric size metadata.
 * Parsing happens entirely in the browser; original bytes still live in the
 * cell's artifact store and the resulting document keeps that source link.
 */
export async function parseBrowserBinaryDocument(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedBrowserBinaryDocument> {
  const fileType = browserBinaryFileType(file)
  if (!fileType) throw new DocumentTransferError(`Unsupported binary document type: ${file.name}`)
  if (fileType === 'pdf') return parsePdfInBrowser(file, signal)
  if (fileType === 'epub') return parseEpubInBrowser(file, signal)
  return parseDocxInBrowser(file, signal)
}

function extensionForFormat(format: DocumentExportFormat): string {
  return format === 'markdown' ? 'md' : format
}

export function safeDownloadFilename(value: string, fallback = 'Untitled'): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\-\s]+|[.\s]+$/g, '')
    .trim()
  return normalized || fallback
}

export function contentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const encoded = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return safeDownloadFilename(decodeURIComponent(encoded.replace(/^"|"$/g, '')))
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }
  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
  const bare = header.match(/filename\s*=\s*([^;\s]+)/i)?.[1]
  const value = quoted ?? bare
  return value ? safeDownloadFilename(value) : null
}

export function shouldSkipDocumentImportFile(file: File): boolean {
  const normalizedPath = documentImportRelativePath(file).toLocaleLowerCase()
  const normalizedName = file.name.toLocaleLowerCase()
  return normalizedPath.startsWith('__macosx/')
    || normalizedPath.includes('/__macosx/')
    || normalizedName === '.ds_store'
    || normalizedName === 'thumbs.db'
    || normalizedName === 'desktop.ini'
    || normalizedName.startsWith('._')
}

export function documentImportRelativePath(file: File): string {
  const relative = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : ''
  return (relative || file.name).replace(/\\/g, '/').replace(/^\/+/, '')
}

export function documentImportDirectoryParts(file: File): string[] {
  const parts = documentImportRelativePath(file).split('/').filter(Boolean)
  parts.pop()
  return parts
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DocumentTransferCancelledError())
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      reject(new DocumentTransferCancelledError())
    }, { once: true })
  })
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim()
  if (isRecord(payload)) {
    const detail = payload.detail
    if (isRecord(detail)) {
      for (const key of ['message', 'error']) {
        const value = stringValue(detail[key])
        if (value) return value
      }
    }
    for (const key of ['detail', 'message', 'error']) {
      const value = stringValue(payload[key])
      if (value) return value
    }
  }
  return fallback
}

/** Parse loopback, gateway, and plain HTTP error bodies through one contract. */
export async function gardendResponseError(response: Response, fallback: string): Promise<string> {
  const payload = await responsePayload(response)
  if (typeof payload === 'string' && /^\s*</.test(payload)) return fallback
  return errorMessage(payload, fallback)
}

function parsedHttpUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new DocumentTransferError('Enter a valid http:// or https:// URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DocumentTransferError('Enter a valid http:// or https:// URL')
  }
  return parsed
}

export function isYouTubeClipUrl(rawUrl: string): boolean {
  try {
    const host = parsedHttpUrl(rawUrl).hostname.toLocaleLowerCase().replace(/^www\./, '')
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

function parseImportedClip(payload: unknown, response: Response, operation: string): ImportedWebClip {
  if (!isRecord(payload)) {
    throw new DocumentTransferError(`${operation} returned a malformed result`, response.status, payload)
  }
  const errors = stringArrayValue(payload.errors)
  const status = stringValue(payload.status)?.toLocaleLowerCase()
  if (status === 'error' || errors.length > 0) {
    throw new DocumentTransferError(
      errors.join('\n') || `${operation} failed with status ${status ?? 'unknown'}`,
      response.status,
      payload,
    )
  }
  const documentIds = stringArrayValue(payload.documentIds ?? payload.document_ids)
  if (status !== 'complete' || documentIds.length !== 1) {
    throw new DocumentTransferError(
      `${operation} completed without exactly one document id`,
      response.status,
      payload,
    )
  }
  return {
    documentId: documentIds[0]!,
    status: 'complete',
    warnings: stringArrayValue(payload.warnings),
  }
}

function progressFromEnvelope(jobId: string, envelope: JobEnvelope): TransferProgress {
  const progress = recordValue(envelope.progress)
  const percent = typeof progress?.percent === 'number' && Number.isFinite(progress.percent)
    ? progress.percent
    : undefined
  return {
    jobId,
    status: jobStatusOf(envelope) ?? 'running',
    ...(stringValue(progress?.message) ? { message: stringValue(progress?.message)! } : {}),
    ...(percent === undefined ? {} : { percent }),
  }
}

/**
 * Real gardend transfer client.  The injected contract supplies graph-scoped
 * base URLs and auth; an injected fetch makes both browser DOM and real-cell
 * harnesses deterministic without weakening the production path.
 */
export class GardendDocumentTransferService {
  private readonly fetchImpl: typeof fetch
  private readonly pollIntervalMs: number
  private readonly jobTimeoutMs: number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly binaryParser: BrowserBinaryDocumentParser | false

  constructor(
    private readonly contract: Pick<ShrubberyContract, 'auth' | 'runtime'>,
    options: GardendDocumentTransferOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('GardendDocumentTransferService: fetch is unavailable')
    this.fetchImpl = fetchImpl.bind(globalThis)
    this.pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 250)
    this.jobTimeoutMs = Math.max(1, options.jobTimeoutMs ?? 5 * 60_000)
    this.sleep = options.sleep ?? defaultSleep
    this.binaryParser = options.binaryParser ?? parseBrowserBinaryDocument
  }

  private apiBase(graphId: string): string {
    const value = this.contract.runtime.graphBaseUrl(graphId).replace(/\/+$/, '')
    if (!value) throw new Error(`No API base is available for graph ${graphId}`)
    return value
  }

  private headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers(extra)
    const token = this.contract.auth.token()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const userId = this.contract.auth.userId()
    if (userId) headers.set('X-User-ID', userId)
    return headers
  }

  private async checked(response: Response, operation: string): Promise<unknown> {
    const payload = await responsePayload(response)
    if (!response.ok) {
      throw new DocumentTransferError(
        errorMessage(payload, `${operation} failed: HTTP ${response.status}`),
        response.status,
        payload,
      )
    }
    return payload
  }

  private async cancelJobAtBase(apiBase: string, jobId: string): Promise<boolean> {
    const response = await this.fetchImpl(`${apiBase}/graphs/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    if (!response.ok) return false
    const payload = await responsePayload(response)
    return !isRecord(payload) || payload.cancelled !== false
  }

  async cancelJob(graphId: string, jobId: string): Promise<boolean> {
    return this.cancelJobAtBase(this.apiBase(graphId), jobId)
  }

  private async writeTextDocument(
    apiBase: string,
    graphId: string,
    input: {
      readonly title: string
      readonly content: string
      readonly format: CellWriteFormat
      readonly parentId?: string | null
      readonly readOnly?: boolean
      readonly signal?: AbortSignal
    },
  ): Promise<JobEnvelope> {
    const documentId = transferDocumentId()
    const response = await this.fetchImpl(`${apiBase}/api/crdt/operations`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        kind: 'document.write',
        graphId,
        documentId,
        payload: {
          documentId,
          title: input.title,
          content: input.content,
          format: input.format,
          parentId: input.parentId ?? null,
          readOnly: input.readOnly ?? false,
        },
      }),
      signal: input.signal,
    })
    const payload = await this.checked(response, `Write imported document "${input.title}"`)
    const envelope = isRecord(payload) ? payload as JobEnvelope : {}
    return { ...envelope, documentId: firstNestedString([envelope], ['documentId', 'document_id']) ?? documentId }
  }

  private async attachDocumentSource(
    apiBase: string,
    graphId: string,
    input: {
      readonly documentId: string
      readonly title: string
      readonly parentId?: string | null
      readonly readOnly: boolean
      readonly artifactId: string
      readonly filename: string
      readonly mimeType: string
      readonly fileType: BrowserBinaryFileType
      readonly signal?: AbortSignal
    },
  ): Promise<void> {
    const response = await this.fetchImpl(`${apiBase}/api/crdt/operations`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        kind: 'workspace.createDocument',
        graphId,
        documentId: input.documentId,
        payload: {
          documentId: input.documentId,
          title: input.title,
          parentId: input.parentId ?? null,
          readOnly: input.readOnly,
          sourceFile: {
            storageKey: `local://artifacts/${input.artifactId}/original/${input.filename}`,
            originalFilename: input.filename,
            mimeType: input.mimeType,
            fileType: input.fileType,
            // Deliberately no sizeBytes. Gardend currently emits it as
            // xsd:integer while emporium-workspace requires xsd:string.
          },
        },
      }),
      signal: input.signal,
    })
    await this.checked(response, `Link original source for "${input.title}"`)
  }

  private async updateArtifactDocumentLink(
    apiBase: string,
    graphId: string,
    artifactId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${apiBase}/navigation/${encodeURIComponent(graphId)}/artifacts/${encodeURIComponent(artifactId)}`
    const currentResponse = await this.fetchImpl(url, { headers: this.headers(), signal, cache: 'no-store' })
    const currentPayload = await this.checked(currentResponse, `Read staged artifact "${artifactId}"`)
    const metadata = isRecord(currentPayload) ? { ...currentPayload } : {}
    // See Atelier's conforming route composition: these numeric aliases would
    // rematerialize the currently-invalid xsd:integer nfo:fileSize triple.
    delete metadata.sizeBytes
    delete metadata.size_bytes
    delete metadata.sf_sizeBytes
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...metadata, ingestedDocId: documentId, updatedAt: Date.now() }),
      signal,
    })
    await this.checked(response, `Link staged artifact "${artifactId}"`)
  }

  private async waitForJob(
    apiBase: string,
    submit: JobEnvelope,
    signal: AbortSignal | undefined,
    onProgress?: (progress: TransferProgress) => void,
  ): Promise<JobTerminal> {
    const jobId = jobIdOf(submit)
    if (!jobId) return { submit, status: null, result: null }
    const startedAt = Date.now()

    const cancelAndThrow = async (): Promise<never> => {
      await this.cancelJobAtBase(apiBase, jobId).catch(() => false)
      throw new DocumentTransferCancelledError()
    }

    while (true) {
      if (signal?.aborted) return cancelAndThrow()
      if (Date.now() - startedAt > this.jobTimeoutMs) {
        await this.cancelJobAtBase(apiBase, jobId).catch(() => false)
        throw new DocumentTransferError(`Transfer job ${jobId} timed out`)
      }

      const response = await this.fetchImpl(`${apiBase}/graphs/jobs/${encodeURIComponent(jobId)}`, {
        headers: this.headers(),
        signal,
        cache: 'no-store',
      }).catch(async (error: unknown) => {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return cancelAndThrow()
        throw error
      })
      const status = await this.checked(response, `Read transfer job ${jobId}`) as JobEnvelope
      const phase = jobStatusOf(status)
      onProgress?.(progressFromEnvelope(jobId, status))

      if (phase === 'failed') {
        throw new DocumentTransferError(
          stringValue(status.error) ?? errorMessage(status.detail, `Transfer job ${jobId} failed`),
          undefined,
          status,
        )
      }
      if (phase === 'cancelled') throw new DocumentTransferCancelledError()
      if (phase === 'succeeded') {
        const resultResponse = await this.fetchImpl(`${apiBase}/graphs/jobs/${encodeURIComponent(jobId)}/result`, {
          headers: this.headers(),
          signal,
          cache: 'no-store',
        })
        const resultPayload = resultResponse.ok ? await responsePayload(resultResponse) : null
        return {
          submit,
          status,
          result: isRecord(resultPayload) ? resultPayload as JobEnvelope : null,
        }
      }

      await this.sleep(this.pollIntervalMs, signal).catch(async (error: unknown) => {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return cancelAndThrow()
        throw error
      })
    }
  }

  async uploadFile(
    graphId: string,
    file: File,
    options: Pick<UploadFilesOptions, 'parentId' | 'signal' | 'onProgress'> = {},
  ): Promise<UploadedDocument> {
    if (!graphId.trim()) throw new Error('uploadFile: graphId is required')
    if (file.size === 0) throw new DocumentTransferError(`Cannot import empty file "${file.name}"`)
    if (options.signal?.aborted) throw new DocumentTransferCancelledError()

    const apiBase = this.apiBase(graphId)
    // Garden's streaming /artifacts/:graph/upload route currently injects a
    // numeric sourceFile.sizeBytes into the workspace projection, while the
    // shipped emporium-workspace SHACL vocabulary requires xsd:string. Every
    // otherwise-valid upload therefore fails at projection time. Use the same
    // conforming two-route archive composition proven by Atelier: write bytes
    // as an artifact revision and register metadata WITHOUT sizeBytes. Text is
    // written directly; PDF/EPUB/DOCX use the browser parser below so the cell
    // never constructs the invalid numeric source-size projection.
    const artifactId = transferArtifactId()
    const title = basenameWithoutExtension(file.name)
    const mimeType = file.type || 'application/octet-stream'
    const encodedGraphId = encodeURIComponent(graphId)
    const encodedArtifactId = encodeURIComponent(artifactId)
    const dataBase64 = await blobBase64(file, options.signal)
    const revisionResponse = await this.fetchImpl(
      `${apiBase}/artifacts/${encodedGraphId}/${encodedArtifactId}/revisions`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dataBase64, mimeType, filename: file.name, label: title }),
        signal: options.signal,
      },
    )
    await this.checked(revisionResponse, `Archive "${file.name}"`)

    const navigationResponse = await this.fetchImpl(
      `${apiBase}/navigation/${encodedGraphId}/artifacts/${encodedArtifactId}`,
      {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          label: title,
          originalFilename: file.name,
          mimeType,
          status: 'ready',
          storageKey: `local://artifacts/${artifactId}/original/${file.name}`,
        }),
        signal: options.signal,
      },
    )
    await this.checked(navigationResponse, `Register "${file.name}"`)

    const writeFormat = textWriteFormat(file.name, mimeType)
    if (writeFormat) {
      options.onProgress?.(file, {
        jobId: artifactId,
        status: 'running',
        message: `Writing ${file.name}`,
        percent: 75,
      })
      const written = await this.writeTextDocument(apiBase, graphId, {
        title,
        content: await file.text(),
        format: writeFormat,
        parentId: options.parentId,
        readOnly: false,
        signal: options.signal,
      })
      const documentId = firstNestedString([written], ['documentId', 'document_id'])
      if (!documentId) throw new DocumentTransferError(`Import "${file.name}" completed without a document id`)
      await this.updateArtifactDocumentLink(apiBase, graphId, artifactId, documentId, options.signal)
      options.onProgress?.(file, {
        jobId: artifactId,
        status: 'succeeded',
        message: `Imported ${file.name}`,
        percent: 100,
      })
      return {
        file,
        documentId,
        title: firstNestedString([written], ['title']) ?? title,
        fileType: file.name.split('.').pop()?.toLocaleLowerCase() ?? 'txt',
        readOnly: false,
        sourceFile: {
          artifactId,
          originalFilename: file.name,
          mimeType,
          storageKey: `local://artifacts/${artifactId}/original/${file.name}`,
        },
        jobId: null,
      }
    }

    const binaryFileType = browserBinaryFileType(file)
    if (binaryFileType && this.binaryParser) {
      options.onProgress?.(file, {
        jobId: artifactId,
        status: 'running',
        message: `Parsing ${file.name}`,
        percent: 40,
      })
      const parsed = await this.binaryParser(file, options.signal)
      throwIfAborted(options.signal)
      options.onProgress?.(file, {
        jobId: artifactId,
        status: 'running',
        message: `Writing ${file.name}`,
        percent: 75,
      })
      const written = await this.writeTextDocument(apiBase, graphId, {
        title: parsed.title,
        content: parsed.markdown,
        format: 'markdown',
        parentId: options.parentId,
        readOnly: true,
        signal: options.signal,
      })
      const documentId = firstNestedString([written], ['documentId', 'document_id'])
      if (!documentId) throw new DocumentTransferError(`Import "${file.name}" completed without a document id`)
      await this.attachDocumentSource(apiBase, graphId, {
        documentId,
        title: parsed.title,
        parentId: options.parentId,
        readOnly: true,
        artifactId,
        filename: file.name,
        mimeType,
        fileType: parsed.fileType,
        signal: options.signal,
      })
      await this.updateArtifactDocumentLink(apiBase, graphId, artifactId, documentId, options.signal)
      options.onProgress?.(file, {
        jobId: artifactId,
        status: 'succeeded',
        message: parsed.warnings.length > 0
          ? `Imported ${file.name} with ${parsed.warnings.length} warning${parsed.warnings.length === 1 ? '' : 's'}`
          : `Imported ${file.name}`,
        percent: 100,
      })
      return {
        file,
        documentId,
        title: parsed.title,
        fileType: parsed.fileType,
        readOnly: true,
        sourceFile: {
          artifactId,
          originalFilename: file.name,
          mimeType,
          storageKey: `local://artifacts/${artifactId}/original/${file.name}`,
          fileType: parsed.fileType,
        },
        jobId: null,
      }
    }

    const importResponse = await this.fetchImpl(
      `${apiBase}/artifacts/${encodedGraphId}/${encodedArtifactId}/import`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title,
          ...(options.parentId ? { parentId: options.parentId } : {}),
          readOnly: true,
          useYdocPath: true,
        }),
        signal: options.signal,
      },
    )
    const submitPayload = await this.checked(importResponse, `Import "${file.name}"`)
    const submit = isRecord(submitPayload) ? submitPayload as JobEnvelope : {}
    const terminal = jobIdOf(submit)
      ? await this.waitForJob(apiBase, submit, options.signal, progress => options.onProgress?.(file, progress))
      : { submit, status: null, result: null }
    const envelopes = [terminal.result, terminal.status, terminal.submit]
    const documentId = firstNestedString(envelopes, ['documentId', 'document_id'])
    if (!documentId) {
      throw new DocumentTransferError(`Import "${file.name}" completed without a document id`, undefined, terminal)
    }
    return {
      file,
      documentId,
      title: firstNestedString(envelopes, ['title']) ?? title,
      fileType: firstNestedString(envelopes, ['fileType', 'file_type']) ?? file.name.split('.').pop()?.toLocaleLowerCase() ?? '',
      readOnly: firstNestedBoolean(envelopes, ['readOnly', 'read_only']) ?? true,
      sourceFile: firstNestedRecord(envelopes, ['sourceFile', 'source_file']),
      jobId: jobIdOf(submit),
    }
  }

  async uploadFiles(graphId: string, files: readonly File[], options: UploadFilesOptions = {}): Promise<UploadBatchResult> {
    const skipped = files.filter(shouldSkipDocumentImportFile)
    const uploadable = files.filter(file => !shouldSkipDocumentImportFile(file))
    const succeeded: UploadedDocument[] = []
    const failed: FailedDocumentUpload[] = []
    let cancelled = false

    for (let index = 0; index < uploadable.length; index += 1) {
      const file = uploadable[index]
      if (options.signal?.aborted) {
        cancelled = true
        break
      }
      options.onFileStart?.(file, index, uploadable.length)
      try {
        succeeded.push(await this.uploadFile(graphId, file, {
          parentId: options.parentIdForFile?.(file) ?? options.parentId,
          signal: options.signal,
          onProgress: options.onProgress,
        }))
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        if (normalized.name === 'AbortError') {
          cancelled = true
          break
        }
        failed.push({ file, error: normalized })
      }
    }

    return { succeeded, failed, skipped, cancelled }
  }

  async importArtifact(
    graphId: string,
    artifactId: string,
    options: ImportArtifactOptions = {},
  ): Promise<ImportedArtifactDocument> {
    if (!graphId.trim() || !artifactId.trim()) throw new Error('importArtifact: graphId and artifactId are required')
    if (options.signal?.aborted) throw new DocumentTransferCancelledError()
    const apiBase = this.apiBase(graphId)
    const readOnly = options.readOnly ?? false
    const artifactUrl = `${apiBase}/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/download`
    const artifactResponse = await this.fetchImpl(artifactUrl, {
      headers: this.headers(),
      signal: options.signal,
      cache: 'no-store',
    })
    if (!artifactResponse.ok) {
      const payload = await responsePayload(artifactResponse)
      throw new DocumentTransferError(
        errorMessage(payload, `Read artifact "${artifactId}" failed: HTTP ${artifactResponse.status}`),
        artifactResponse.status,
        payload,
      )
    }
    const filename = contentDispositionFilename(artifactResponse.headers.get('content-disposition')) ?? artifactId
    const mimeType = artifactResponse.headers.get('content-type') ?? 'application/octet-stream'
    const format = textWriteFormat(filename, mimeType)
    if (format) {
      const title = options.title ?? basenameWithoutExtension(filename)
      options.onProgress?.({ jobId: artifactId, status: 'running', message: `Importing ${title}`, percent: 50 })
      const written = await this.writeTextDocument(apiBase, graphId, {
        title,
        content: await artifactResponse.text(),
        format,
        parentId: options.parentId,
        readOnly,
        signal: options.signal,
      })
      const documentId = firstNestedString([written], ['documentId', 'document_id'])
      if (!documentId) throw new DocumentTransferError('Artifact import completed without a document id')
      await this.updateArtifactDocumentLink(apiBase, graphId, artifactId, documentId, options.signal)
      options.onProgress?.({ jobId: artifactId, status: 'succeeded', message: `Imported ${title}`, percent: 100 })
      return {
        artifactId,
        documentId,
        title: firstNestedString([written], ['title']) ?? title,
        readOnly,
        jobId: null,
      }
    }
    const response = await this.fetchImpl(
      `${apiBase}/artifacts/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}/import`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...(options.title ? { title: options.title } : {}),
          ...(options.parentId ? { parentId: options.parentId } : {}),
          readOnly,
          useYdocPath: true,
        }),
        signal: options.signal,
      },
    )
    const submitPayload = await this.checked(response, `Import artifact "${artifactId}"`)
    const submit = isRecord(submitPayload) ? submitPayload as JobEnvelope : {}
    const terminal = jobIdOf(submit)
      ? await this.waitForJob(apiBase, submit, options.signal, options.onProgress)
      : { submit, status: null, result: null }
    const envelopes = [terminal.result, terminal.status, terminal.submit]
    const documentId = firstNestedString(envelopes, ['documentId', 'document_id'])
    if (!documentId) {
      throw new DocumentTransferError(`Artifact import completed without a document id`, undefined, terminal)
    }
    return {
      artifactId,
      documentId,
      title: firstNestedString(envelopes, ['title']) ?? options.title ?? artifactId,
      readOnly: firstNestedBoolean(envelopes, ['readOnly', 'read_only']) ?? readOnly,
      jobId: jobIdOf(submit),
    }
  }

  /**
   * Import one URL through gardend's real web-clip extractor/write path.
   *
   * `graphBaseUrl()` already includes `/g/{graphId}` in hosted mode, so the
   * deliberately duplicated graph id below is the cell route, not a gateway
   * routing mistake: `/g/{graph}/graphs/{graph}/imports/clip`.
   */
  async importWebClip(
    graphId: string,
    url: string,
    options: ImportWebClipOptions = {},
  ): Promise<ImportedWebClip> {
    const normalizedGraphId = graphId.trim()
    if (!normalizedGraphId) throw new Error('importWebClip: graphId is required')
    const parsedUrl = parsedHttpUrl(url)
    if (options.signal?.aborted) throw new DocumentTransferCancelledError()

    const response = await this.fetchImpl(
      `${this.apiBase(normalizedGraphId)}/graphs/${encodeURIComponent(normalizedGraphId)}/imports/clip`,
      {
        method: 'POST',
        headers: this.headers({
          'Content-Type': 'application/json',
          Prefer: 'wait-for-flush',
        }),
        body: JSON.stringify({
          url: parsedUrl.href,
          ...(options.title?.trim() ? { title: options.title.trim() } : {}),
          ...(options.folderId?.trim() ? { folderId: options.folderId.trim() } : {}),
          ...(options.html?.trim() ? { html: options.html } : {}),
        }),
        signal: options.signal,
      },
    )
    const payload = await this.checked(response, `Clip ${parsedUrl.href}`)
    return parseImportedClip(payload, response, 'Web clip')
  }

  async importYouTubeClip(
    graphId: string,
    url: string,
    options: ImportYouTubeClipOptions = {},
  ): Promise<ImportedWebClip> {
    const normalizedGraphId = graphId.trim()
    if (!normalizedGraphId) throw new Error('importYouTubeClip: graphId is required')
    const parsedUrl = parsedHttpUrl(url)
    if (!isYouTubeClipUrl(parsedUrl.href)) {
      throw new DocumentTransferError('Enter a valid YouTube URL')
    }
    if (options.signal?.aborted) throw new DocumentTransferCancelledError()
    const languages = options.languages?.map(value => value.trim()).filter(Boolean)
    const response = await this.fetchImpl(
      `${this.apiBase(normalizedGraphId)}/graphs/${encodeURIComponent(normalizedGraphId)}/imports/youtube`,
      {
        method: 'POST',
        headers: this.headers({
          'Content-Type': 'application/json',
          Prefer: 'wait-for-flush',
        }),
        body: JSON.stringify({
          url: parsedUrl.href,
          ...(options.title?.trim() ? { title: options.title.trim() } : {}),
          ...(options.folderId?.trim() ? { folderId: options.folderId.trim() } : {}),
          ...(languages?.length ? { languages } : {}),
          mode: options.mode ?? 'readable',
          chunkSeconds: options.chunkSeconds ?? 30,
          showRanges: options.showRanges ?? false,
        }),
        signal: options.signal,
      },
    )
    const payload = await this.checked(response, `Import YouTube transcript ${parsedUrl.href}`)
    return parseImportedClip(payload, response, 'YouTube transcript import')
  }

  async exportDocument(
    graphId: string,
    documentId: string,
    options: ExportDocumentOptions,
  ): Promise<ExportedDocument> {
    if (!graphId.trim() || !documentId.trim()) throw new Error('exportDocument: graphId and documentId are required')
    const apiBase = this.apiBase(graphId)
    const params = new URLSearchParams({ format: options.format })
    if (options.format === 'html' && options.theme) params.set('theme', options.theme)
    const response = await this.fetchImpl(
      `${apiBase}/documents/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}/export?${params}`,
      { headers: this.headers(), signal: options.signal, cache: 'no-store' },
    )
    if (!response.ok) {
      const payload = await responsePayload(response)
      throw new DocumentTransferError(
        errorMessage(payload, `Export failed: HTTP ${response.status}`),
        response.status,
        payload,
      )
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    const filename = contentDispositionFilename(response.headers.get('content-disposition'))
      ?? `${safeDownloadFilename(options.title ?? documentId)}.${extensionForFormat(options.format)}`
    return { blob: await response.blob(), filename, format: options.format, contentType }
  }
}

export interface PickDocumentFilesOptions {
  readonly document?: Document
  readonly accept?: string
  readonly multiple?: boolean
  readonly directory?: boolean
}

/** Open a browser file/folder picker and resolve null on an explicit cancel. */
export function pickDocumentFiles(options: PickDocumentFilesOptions = {}): Promise<readonly File[] | null> {
  const doc = options.document ?? document
  return new Promise(resolve => {
    const input = doc.createElement('input')
    let settled = false
    const finish = (files: readonly File[] | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.type = 'file'
    input.accept = options.accept ?? DOCUMENT_IMPORT_ACCEPT
    input.multiple = options.multiple ?? true
    input.hidden = true
    if (options.directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    doc.body.appendChild(input)
    input.click()
  })
}

export interface SaveBlobOptions {
  readonly document?: Document
  readonly createObjectURL?: (blob: Blob) => string
  readonly revokeObjectURL?: (url: string) => void
  readonly revokeDelayMs?: number
}

/** Download through a temporary same-document anchor; never navigates the app. */
export function saveBlob(blob: Blob, filename: string, options: SaveBlobOptions = {}): void {
  const doc = options.document ?? document
  const create = options.createObjectURL ?? URL.createObjectURL.bind(URL)
  const revoke = options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL)
  const url = create(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = safeDownloadFilename(filename)
  anchor.rel = 'noopener'
  anchor.hidden = true
  doc.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  globalThis.setTimeout(() => revoke(url), options.revokeDelayMs ?? 30_000)
}

export interface DocumentExportDialogControllerOptions {
  readonly save?: (blob: Blob, filename: string) => void
  readonly copy?: (text: string) => Promise<void>
  readonly print?: (dialog: MnExportDialog) => void
}

export interface OpenDocumentExportOptions {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
}

export interface DocumentExportDialogController {
  open(options: OpenDocumentExportOptions): Promise<void>
  close(): void
  destroy(): void
}

/**
 * Bind the already-lifted controlled export dialog to real cell exports.
 * Preview/theme changes are abortable and generation-gated, so a late response
 * can never populate a dialog for a different graph/document.
 */
export function attachDocumentExportDialog(
  dialog: MnExportDialog,
  service: Pick<GardendDocumentTransferService, 'exportDocument'>,
  options: DocumentExportDialogControllerOptions = {},
): DocumentExportDialogController {
  const save = options.save ?? ((blob, filename) => saveBlob(blob, filename))
  const copy = options.copy ?? (async text => {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard is unavailable')
    await globalThis.navigator.clipboard.writeText(text)
  })
  const print = options.print ?? (node => {
    const frame = node.shadowRoot?.querySelector<HTMLIFrameElement>('.preview-iframe')
    frame?.contentWindow?.print()
  })
  let current: OpenDocumentExportOptions | null = null
  let generation = 0
  let abort: AbortController | null = null
  let markdown: ExportedDocument | null = null
  let html: ExportedDocument | null = null

  const load = async (theme: DocumentExportTheme, includeMarkdown: boolean): Promise<void> => {
    if (!current) return
    const request = current
    const requestGeneration = ++generation
    abort?.abort()
    abort = new AbortController()
    dialog.loading = true
    dialog.error = ''
    dialog.copyStatus = 'idle'
    dialog.selectedTheme = theme
    try {
      const [nextHtml, nextMarkdown] = await Promise.all([
        service.exportDocument(request.graphId, request.documentId, {
          format: 'html',
          theme,
          title: request.title,
          signal: abort.signal,
        }),
        includeMarkdown
          ? service.exportDocument(request.graphId, request.documentId, {
              format: 'markdown',
              title: request.title,
              signal: abort.signal,
            })
          : Promise.resolve(markdown),
      ])
      if (requestGeneration !== generation || current !== request) return
      html = nextHtml
      markdown = nextMarkdown
      dialog.htmlContent = await nextHtml.blob.text()
      dialog.markdownAvailable = Boolean(markdown)
      dialog.loading = false
    } catch (error) {
      if (requestGeneration !== generation || current !== request) return
      if (error instanceof Error && error.name === 'AbortError') return
      dialog.loading = false
      dialog.error = error instanceof Error ? error.message : String(error)
      dialog.markdownAvailable = false
    }
  }

  const onClose = () => controller.close()
  const onTheme = (event: Event) => {
    const id = (event as CustomEvent<{ themeId?: string }>).detail?.themeId
    if (id === 'garden' || id === 'manuscript' || id === 'dusk' || id === 'meridian' || id === 'vesper') {
      void load(id, false)
    }
  }
  const onCopy = async () => {
    if (!markdown) return
    try {
      await copy(await markdown.blob.text())
      dialog.copyStatus = 'success'
    } catch {
      dialog.copyStatus = 'error'
    }
  }
  const onDownloadMarkdown = () => {
    if (markdown) save(markdown.blob, markdown.filename)
  }
  const onDownloadHtml = () => {
    if (html) save(html.blob, html.filename)
  }
  const onPrint = () => print(dialog)

  dialog.addEventListener('mn-export-close', onClose)
  dialog.addEventListener('mn-export-theme-select', onTheme)
  dialog.addEventListener('mn-export-copy-markdown', onCopy)
  dialog.addEventListener('mn-export-download-markdown', onDownloadMarkdown)
  dialog.addEventListener('mn-export-download-html', onDownloadHtml)
  dialog.addEventListener('mn-export-print', onPrint)

  const controller: DocumentExportDialogController = {
    async open(request) {
      current = request
      markdown = null
      html = null
      dialog.documentTitle = request.title
      dialog.htmlContent = ''
      dialog.error = ''
      dialog.copyStatus = 'idle'
      dialog.markdownAvailable = false
      dialog.open = true
      await load('garden', true)
    },
    close() {
      generation += 1
      abort?.abort()
      abort = null
      current = null
      markdown = null
      html = null
      dialog.open = false
      dialog.loading = false
    },
    destroy() {
      controller.close()
      dialog.removeEventListener('mn-export-close', onClose)
      dialog.removeEventListener('mn-export-theme-select', onTheme)
      dialog.removeEventListener('mn-export-copy-markdown', onCopy)
      dialog.removeEventListener('mn-export-download-markdown', onDownloadMarkdown)
      dialog.removeEventListener('mn-export-download-html', onDownloadHtml)
      dialog.removeEventListener('mn-export-print', onPrint)
    },
  }
  return controller
}
