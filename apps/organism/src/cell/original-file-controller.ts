/**
 * Shell-owned original-file acquisition and lifetime controller.
 *
 * The controlled <mn-original-viewer> never reaches for auth, fetch, object
 * URLs, or the filesystem. This controller supplies those effects through the
 * active Shrubbery contract and projects a plain value model into the keyed
 * editor host.
 */

import type { ShrubberyContract } from '@shrubbery/nucleus'
import type {
  EditorOriginalFileChapter,
  EditorOriginalFileView,
} from '@shrubbery/runtime'

type OriginalFileContract = Pick<ShrubberyContract, 'auth' | 'runtime'>

export interface OriginalFileUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface OriginalFileControllerOptions {
  readonly requestRender: () => void
  readonly fetch?: typeof fetch
  readonly url?: OriginalFileUrlApi
  readonly download?: (url: string, filename: string) => void
  readonly openExternal?: (url: string) => void
}

interface OriginalScope {
  readonly contract: OriginalFileContract
  readonly graphId: string
  readonly documentId: string
  readonly sourceFile: OriginalFileSourceMetadata
}

export interface OriginalFileSourceMetadata {
  readonly storageKey?: string | null
  readonly originalFilename?: string | null
  readonly mimeType?: string | null
  readonly sizeBytes?: number | null
  readonly fileType?: string | null
}

function sourceFingerprint(source: OriginalFileSourceMetadata): string {
  return [
    source.storageKey ?? '',
    source.originalFilename ?? '',
    source.mimeType ?? '',
    source.sizeBytes ?? '',
    source.fileType ?? '',
  ].join('\u0000')
}

interface LoadedOriginal {
  readonly filename: string
  readonly mimeType: string
  readonly fileType: string
  readonly title: string
  readonly text: string
  readonly srcdoc: string
  readonly chapters: readonly EditorOriginalFileChapter[]
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function basename(value: string): string {
  const clean = value.split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? ''
  return clean.split('/').filter(Boolean).at(-1) ?? ''
}

function safeFilename(value: string): string {
  return basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

function filenameFromDisposition(value: string | null): string {
  if (!value) return ''
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value)?.[1]?.trim()
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded.replace(/^"|"$/g, '')))
    } catch {
      // Fall through to the ordinary filename parameter.
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1]
  if (quoted) return safeFilename(quoted)
  const plain = /filename\s*=\s*([^;]+)/i.exec(value)?.[1]
  return safeFilename(plain?.trim().replace(/^"|"$/g, '') ?? '')
}

function extensionFrom(value: string): string {
  const name = basename(value)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLocaleLowerCase() : ''
}

function extensionForMime(mimeType: string): string {
  const mime = mimeType.split(';', 1)[0]!.trim().toLocaleLowerCase()
  const extensions: Readonly<Record<string, string>> = {
    'application/pdf': 'pdf',
    'application/epub+zip': 'epub',
    'text/html': 'html',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/json': 'json',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  }
  return extensions[mime] ?? ''
}

function inferredFileType(filename: string, mimeType: string): string {
  return extensionFrom(filename) || extensionForMime(mimeType)
}

function isHtml(filename: string, mimeType: string): boolean {
  const ext = extensionFrom(filename)
  return mimeType.toLocaleLowerCase().includes('html') || ext === 'html' || ext === 'htm'
}

function isText(filename: string, mimeType: string): boolean {
  const ext = extensionFrom(filename)
  return mimeType.toLocaleLowerCase().startsWith('text/') || [
    'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'log', 'yaml', 'yml', 'toml',
  ].includes(ext)
}

function isEpub(filename: string, mimeType: string): boolean {
  return mimeType.toLocaleLowerCase().includes('epub') || extensionFrom(filename) === 'epub'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Strip executable markup before DOMParser sees it. Browsers keep DOMParser
 * documents inert, but lightweight DOM implementations have historically run
 * inline scripts while parsing; the second DOM walk below remains authoritative.
 */
function inertMarkupSource(value: string): string {
  return value
    .replace(/<(script|iframe|frame|object|embed|style|form|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|frame|object|embed|link|meta|base|input|button|textarea|select)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '')
}

function safeSrcdoc(
  source: string,
  title: string,
  resolveImage?: (src: string) => string | null,
): string {
  if (typeof DOMParser === 'undefined') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><pre>${escapeHtml(source)}</pre></body></html>`
  }
  const parsed = new DOMParser().parseFromString(inertMarkupSource(source), 'text/html')
  const root = parsed.documentElement ?? parsed.appendChild(parsed.createElement('html'))
  const head = parsed.head ?? root.insertBefore(parsed.createElement('head'), root.firstChild)
  if (!parsed.body) root.append(parsed.createElement('body'))
  parsed.querySelectorAll('script,style,iframe,frame,object,embed,base,form,input,button,textarea,select,link,meta[http-equiv]').forEach(node => node.remove())
  for (const element of Array.from(parsed.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase()
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'action' || name === 'formaction') {
        element.removeAttribute(attribute.name)
      }
    }
    if (element.localName === 'img') {
      const src = element.getAttribute('src')?.trim() ?? ''
      const resolved = resolveImage?.(src) ?? (/^data:image\//i.test(src) ? src : null)
      if (resolved) element.setAttribute('src', resolved)
      else element.removeAttribute('src')
    } else if (element.hasAttribute('src')) {
      element.removeAttribute('src')
    }
    if (element.localName === 'a') {
      const href = element.getAttribute('href')?.trim() ?? ''
      if (!href.startsWith('#')) element.removeAttribute('href')
    } else if (element.hasAttribute('href')) {
      element.removeAttribute('href')
    }
  }

  const charset = parsed.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const csp = parsed.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:")
  head.prepend(csp)
  head.prepend(charset)
  const existingTitle = head.querySelector('title')
  if (!existingTitle) {
    const titleElement = parsed.createElement('title')
    titleElement.textContent = title
    head.append(titleElement)
  }
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}

function archivePath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function archiveDirectory(value: string): string {
  const normalized = archivePath(value)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function joinArchivePath(base: string, value: string): string {
  return archivePath(`${base}/${decodeURIComponent(value.split(/[?#]/, 1)[0] ?? '')}`)
}

function entryAt(entries: Readonly<Record<string, Uint8Array>>, path: string): Uint8Array | null {
  const normalized = archivePath(path)
  return entries[normalized]
    ?? Object.entries(entries).find(([key]) => archivePath(key).toLocaleLowerCase() === normalized.toLocaleLowerCase())?.[1]
    ?? null
}

function xmlElements(document: Document, localName: string): Element[] {
  return Array.from(document.getElementsByTagName('*')).filter(
    element => element.localName.split(':').at(-1)?.toLocaleLowerCase() === localName.toLocaleLowerCase(),
  )
}

function parseXml(source: string, label: string): Document {
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error(`${label} is malformed`)
  return document
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunk)))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

function mimeForPath(path: string): string {
  const extension = extensionFrom(path)
  const values: Readonly<Record<string, string>> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  }
  return values[extension] ?? 'application/octet-stream'
}

async function epubPreview(bytes: Uint8Array, filename: string): Promise<{
  readonly title: string
  readonly chapters: readonly EditorOriginalFileChapter[]
}> {
  if (typeof DOMParser === 'undefined') throw new Error('EPUB preview requires a DOM parser')
  const { unzipSync, strFromU8 } = await import('fflate')
  const entries = unzipSync(bytes)
  const containerBytes = entryAt(entries, 'META-INF/container.xml')
  if (!containerBytes) throw new Error('EPUB is missing META-INF/container.xml')
  const container = parseXml(strFromU8(containerBytes), 'EPUB container')
  const packagePath = xmlElements(container, 'rootfile')[0]?.getAttribute('full-path')?.trim() ?? ''
  const packageBytes = entryAt(entries, packagePath)
  if (!packagePath || !packageBytes) throw new Error('EPUB package document is unavailable')
  const packageDocument = parseXml(strFromU8(packageBytes), 'EPUB package')
  const packageDirectory = archiveDirectory(packagePath)
  const title = xmlElements(packageDocument, 'title')[0]?.textContent?.trim()
    || basename(filename).replace(/\.epub$/i, '')
    || 'EPUB'
  const manifest = new Map<string, { id: string; href: string; path: string; mediaType: string }>()
  for (const item of xmlElements(packageDocument, 'item')) {
    const id = item.getAttribute('id')?.trim() ?? ''
    const href = item.getAttribute('href')?.trim() ?? ''
    if (!id || !href) continue
    manifest.set(id, {
      id,
      href,
      path: joinArchivePath(packageDirectory, href),
      mediaType: item.getAttribute('media-type')?.trim() ?? '',
    })
  }
  const spineIds = xmlElements(packageDocument, 'itemref')
    .map(item => item.getAttribute('idref')?.trim() ?? '')
    .filter(Boolean)
  const ordered = (spineIds.length > 0 ? spineIds.map(id => manifest.get(id)) : [...manifest.values()])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter(item => /(?:xhtml|html|xml)/i.test(item.mediaType) || /\.(?:xhtml|html?|xml)$/i.test(item.href))
  const chapters: EditorOriginalFileChapter[] = []
  for (const item of ordered) {
    const chapterBytes = entryAt(entries, item.path)
    if (!chapterBytes) continue
    const source = strFromU8(chapterBytes)
    const chapterDocument = new DOMParser().parseFromString(inertMarkupSource(source), 'text/html')
    const chapterTitle = chapterDocument.querySelector('title,h1,h2')?.textContent?.trim()
      || basename(item.href).replace(/\.[^.]+$/, '')
      || `Chapter ${chapters.length + 1}`
    const directory = archiveDirectory(item.path)
    const srcdoc = safeSrcdoc(source, chapterTitle, src => {
      if (/^data:image\//i.test(src)) return src
      if (!src || /^(?:https?:|javascript:|file:|blob:)/i.test(src)) return null
      const resourcePath = joinArchivePath(directory, src)
      const resource = entryAt(entries, resourcePath)
      return resource ? bytesToDataUrl(resource, mimeForPath(resourcePath)) : null
    })
    chapters.push(Object.freeze({ id: item.id || item.path, title: chapterTitle, srcdoc }))
  }
  if (chapters.length === 0) throw new Error('EPUB contains no readable chapters')
  return { title, chapters: Object.freeze(chapters) }
}

function defaultDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'download'
  anchor.rel = 'noopener'
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function defaultOpenExternal(url: string): void {
  globalThis.open?.(url, '_blank', 'noopener,noreferrer')
}

function defaultUrlApi(): OriginalFileUrlApi {
  return {
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
  }
}

function originalUrl(scope: OriginalScope): string {
  const base = trimSlash(scope.contract.runtime.graphBaseUrl(scope.graphId))
  if (!base) throw new Error(`No API base is available for graph ${scope.graphId}`)
  return `${base}/artifacts/${encodeURIComponent(scope.graphId)}/documents/${encodeURIComponent(scope.documentId)}/download-original?inline=true`
}

function artifactOriginalUrl(scope: OriginalScope): string | null {
  const storageKey = scope.sourceFile.storageKey?.trim() ?? ''
  const match = /^local:\/\/artifacts\/([^/]+)\/original\//.exec(storageKey)
  if (!match?.[1]) return null
  let artifactId = match[1]
  try {
    artifactId = decodeURIComponent(artifactId)
  } catch {
    // Keep the literal id; encodeURIComponent below still makes the URL safe.
  }
  const base = trimSlash(scope.contract.runtime.graphBaseUrl(scope.graphId))
  if (!base) return null
  return `${base}/artifacts/${encodeURIComponent(scope.graphId)}/${encodeURIComponent(artifactId)}/download?inline=true`
}

function responseError(status: number): string {
  if (status === 404) return 'No original file is attached to this document.'
  if (status === 401 || status === 403) return 'You do not have access to this original file.'
  return `The original file could not be loaded (HTTP ${status}).`
}

export class OrganismOriginalFileController {
  private readonly fetchImpl: typeof fetch
  private readonly urlApi: OriginalFileUrlApi
  private readonly downloadEffect: (url: string, filename: string) => void
  private readonly openExternalEffect: (url: string) => void
  private scope: OriginalScope | null = null
  private active = false
  private status: EditorOriginalFileView['status'] = 'idle'
  private error = ''
  private filename = ''
  private mimeType = ''
  private fileType = ''
  private title = ''
  private src = ''
  private srcdoc = ''
  private text = ''
  private chapters: readonly EditorOriginalFileChapter[] = []
  private selectedChapterId = ''
  private objectUrl = ''
  private abort: AbortController | null = null
  private sequence = 0
  private destroyed = false

  constructor(private readonly options: OriginalFileControllerOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Original-file controller requires fetch')
    this.fetchImpl = fetchImpl.bind(globalThis)
    this.urlApi = options.url ?? defaultUrlApi()
    this.downloadEffect = options.download ?? defaultDownload
    this.openExternalEffect = options.openExternal ?? defaultOpenExternal
  }

  private render(): void {
    if (!this.destroyed) this.options.requestRender()
  }

  private cancelLoad(): void {
    this.sequence += 1
    this.abort?.abort()
    this.abort = null
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return
    this.urlApi.revokeObjectURL(this.objectUrl)
    this.objectUrl = ''
  }

  private clearLoaded(): void {
    this.revokeObjectUrl()
    this.status = 'idle'
    this.error = ''
    this.filename = ''
    this.mimeType = ''
    this.fileType = ''
    this.title = ''
    this.src = ''
    this.srcdoc = ''
    this.text = ''
    this.chapters = []
    this.selectedChapterId = ''
  }

  setScope(
    contract: OriginalFileContract | null,
    graphId: string,
    documentId: string | null,
    sourceFile: OriginalFileSourceMetadata | null = null,
  ): void {
    if (this.destroyed) return
    const nextGraph = graphId.trim()
    const nextDocument = documentId?.trim() ?? ''
    const hasSource = Boolean(
      sourceFile?.storageKey?.trim()
      || sourceFile?.originalFilename?.trim(),
    )
    const nextScope = contract && nextGraph && nextDocument && sourceFile && hasSource
      ? { contract, graphId: nextGraph, documentId: nextDocument, sourceFile }
      : null
    const same = this.scope === null
      ? nextScope === null
      : nextScope !== null
        && this.scope.contract === nextScope.contract
        && this.scope.graphId === nextScope.graphId
        && this.scope.documentId === nextScope.documentId
        && sourceFingerprint(this.scope.sourceFile) === sourceFingerprint(nextScope.sourceFile)
    if (same) return
    this.cancelLoad()
    this.clearLoaded()
    this.active = false
    this.scope = nextScope
    this.render()
  }

  releaseScope(graphId: string, documentId: string | null): void {
    if (this.scope?.graphId !== graphId || this.scope.documentId !== documentId) return
    this.setScope(null, '', null)
  }

  snapshot(): EditorOriginalFileView {
    const source = this.scope?.sourceFile
    const sourceFilename = source?.originalFilename?.trim() ?? ''
    const sourceMimeType = source?.mimeType?.trim() ?? ''
    const sourceFileType = source?.fileType?.trim() ?? ''
    return Object.freeze({
      available: this.scope !== null,
      active: this.active,
      status: this.status,
      graphId: this.scope?.graphId ?? '',
      documentId: this.scope?.documentId ?? '',
      title: this.title || sourceFilename,
      filename: this.filename || sourceFilename,
      fileType: this.fileType || sourceFileType,
      mimeType: this.mimeType || sourceMimeType,
      src: this.src,
      srcdoc: this.srcdoc,
      text: this.text,
      error: this.error,
      selectedChapterId: this.selectedChapterId,
      downloadable: this.status === 'ready' && Boolean(this.objectUrl),
      externalOpenable: this.status === 'ready' && Boolean(this.objectUrl),
      chapters: this.chapters,
      annotations: Object.freeze([]),
      annotationSupport: 'unavailable',
    })
  }

  async toggle(): Promise<void> {
    if (!this.scope || this.destroyed) return
    if (this.active) {
      this.cancelLoad()
      this.active = false
      this.clearLoaded()
      this.render()
      return
    }
    this.active = true
    this.render()
    await this.load()
  }

  async reload(): Promise<void> {
    if (!this.scope || this.destroyed) return
    if (!this.active) this.active = true
    await this.load()
  }

  selectChapter(chapterId: string): void {
    if (!this.chapters.some(chapter => chapter.id === chapterId)) return
    this.selectedChapterId = chapterId
    this.render()
  }

  download(): void {
    if (!this.objectUrl || this.status !== 'ready') return
    this.downloadEffect(this.objectUrl, this.filename || 'download')
  }

  openExternal(): void {
    if (!this.objectUrl || this.status !== 'ready') return
    this.openExternalEffect(this.objectUrl)
  }

  private async load(): Promise<void> {
    const scope = this.scope
    if (!scope || this.destroyed) return
    this.cancelLoad()
    this.clearLoaded()
    this.active = true
    this.status = 'loading'
    this.render()
    const sequence = ++this.sequence
    const abort = new AbortController()
    this.abort = abort
    try {
      await scope.contract.auth.whenReady()
      if (sequence !== this.sequence || abort.signal.aborted) return
      const headers = new Headers({ Accept: '*/*' })
      const token = scope.contract.auth.token()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const userId = scope.contract.auth.userId()
      if (userId) headers.set('X-User-ID', userId)
      const request: RequestInit = {
        method: 'GET',
        headers,
        signal: abort.signal,
        credentials: 'same-origin',
      }
      let response = await this.fetchImpl(originalUrl(scope), request)
      // Browser-parsed PDF/EPUB/DOCX imports persist their source bytes as an
      // artifact and link that artifact through sourceFile.storageKey. Current
      // gardend does not duplicate those bytes into documents/:id/original, so
      // the document-original route honestly returns 404. Follow the persisted
      // artifact link rather than probing an unrelated id or hiding the source.
      const artifactUrl = response.status === 404 ? artifactOriginalUrl(scope) : null
      if (artifactUrl) response = await this.fetchImpl(artifactUrl, request)
      if (sequence !== this.sequence || abort.signal.aborted) return
      if (!response.ok) {
        this.status = response.status === 404 ? 'unavailable' : 'error'
        this.error = responseError(response.status)
        this.render()
        return
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (sequence !== this.sequence || abort.signal.aborted) return
      const mimeType = (response.headers.get('content-type')?.split(';', 1)[0]?.trim()
        || 'application/octet-stream').toLocaleLowerCase()
      const dispositionName = filenameFromDisposition(response.headers.get('content-disposition'))
      const extension = extensionForMime(mimeType)
      const filename = dispositionName || `${scope.documentId}-original${extension ? `.${extension}` : ''}`
      const fileType = inferredFileType(filename, mimeType)
      let loaded: LoadedOriginal = {
        filename,
        mimeType,
        fileType,
        title: filename,
        text: '',
        srcdoc: '',
        chapters: [],
      }
      if (isEpub(filename, mimeType)) {
        const preview = await epubPreview(bytes, filename)
        loaded = { ...loaded, title: preview.title, chapters: preview.chapters }
      } else if (isHtml(filename, mimeType)) {
        const source = new TextDecoder('utf-8').decode(bytes)
        loaded = { ...loaded, srcdoc: safeSrcdoc(source, filename) }
      } else if (isText(filename, mimeType)) {
        loaded = { ...loaded, text: new TextDecoder('utf-8').decode(bytes) }
      }
      if (sequence !== this.sequence || abort.signal.aborted) return
      const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const objectUrl = this.urlApi.createObjectURL(new Blob([blobBytes], { type: mimeType }))
      if (sequence !== this.sequence || abort.signal.aborted) {
        this.urlApi.revokeObjectURL(objectUrl)
        return
      }
      this.objectUrl = objectUrl
      this.filename = loaded.filename
      this.mimeType = loaded.mimeType
      this.fileType = loaded.fileType
      this.title = loaded.title
      this.text = loaded.text
      this.srcdoc = loaded.srcdoc
      this.chapters = loaded.chapters
      this.selectedChapterId = loaded.chapters[0]?.id ?? ''
      this.src = loaded.text || loaded.srcdoc || loaded.chapters.length > 0 ? '' : objectUrl
      this.status = 'ready'
      this.error = ''
      this.render()
    } catch (error) {
      if (sequence !== this.sequence || abort.signal.aborted) return
      this.status = 'error'
      this.error = error instanceof Error ? error.message : String(error)
      this.render()
    } finally {
      if (this.abort === abort) this.abort = null
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.cancelLoad()
    this.clearLoaded()
    this.scope = null
    this.active = false
    this.destroyed = true
  }
}
