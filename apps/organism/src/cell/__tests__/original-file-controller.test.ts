import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import {
  OrganismOriginalFileController,
  type OriginalFileUrlApi,
} from '../original-file-controller.js'

function contract(base = 'https://gateway.test/g/graph%20one'): Pick<ShrubberyContract, 'auth' | 'runtime'> {
  return {
    auth: {
      token: () => 'fresh-id-token',
      userId: () => 'reader-user',
      isAuthenticated: () => true,
      whenReady: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    runtime: {
      mode: () => 'hosted',
      isGateway: () => true,
      graphBaseUrl: () => base,
    },
  }
}

function urlHarness() {
  const created: Blob[] = []
  const revoked: string[] = []
  const api: OriginalFileUrlApi = {
    createObjectURL(blob) {
      created.push(blob)
      return `blob:original-${created.length}`
    },
    revokeObjectURL(url) { revoked.push(url) },
  }
  return { api, created, revoked }
}

function binaryResponse(
  body: BlobPart,
  mimeType: string,
  filename: string,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': mimeType,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('OrganismOriginalFileController', () => {
  it('treats repeated empty/home scopes as idempotent instead of scheduling a render loop', () => {
    const requestRender = vi.fn()
    const controller = new OrganismOriginalFileController({
      requestRender,
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
    })

    controller.setScope(contract('/cell'), 'g', null)
    controller.setScope(contract('/cell'), 'g', '')
    controller.setScope(null, '', null)

    expect(requestRender).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ available: false, active: false, status: 'idle' })
  })

  it('does not advertise an original for a document without persisted source metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const controller = new OrganismOriginalFileController({ requestRender: vi.fn(), fetch })
    controller.setScope(contract('/cell'), 'g', 'ordinary-doc')

    expect(controller.snapshot()).toMatchObject({
      available: false,
      active: false,
      graphId: '',
      documentId: '',
    })
    await controller.toggle()
    expect(fetch).not.toHaveBeenCalled()

    controller.setScope(contract('/cell'), 'g', 'mime-only', { mimeType: 'application/pdf' })
    expect(controller.snapshot().available).toBe(false)
  })

  it('authenticates against the graph base, decodes text, downloads, and revokes on scope change', async () => {
    const urls = urlHarness()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return binaryResponse('# Original\n\nBrowser-backed source.', 'text/markdown', 'Source Notes.md')
    }) as unknown as typeof globalThis.fetch
    const downloads: Array<{ url: string; filename: string }> = []
    const opened: string[] = []
    const controller = new OrganismOriginalFileController({
      requestRender: vi.fn(),
      fetch,
      url: urls.api,
      download: (url, filename) => downloads.push({ url, filename }),
      openExternal: url => opened.push(url),
    })

    controller.setScope(contract(), 'graph one', 'doc/alpha', {
      storageKey: 'local://artifacts/source-notes',
      originalFilename: 'Source Notes.md',
      mimeType: 'text/markdown',
      fileType: 'md',
    })
    await controller.toggle()

    expect(calls[0]?.url).toBe(
      'https://gateway.test/g/graph%20one/artifacts/graph%20one/documents/doc%2Falpha/download-original?inline=true',
    )
    const headers = calls[0]?.init?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer fresh-id-token')
    expect(headers.get('X-User-ID')).toBe('reader-user')
    expect(calls[0]?.init?.credentials).toBe('same-origin')
    expect(controller.snapshot()).toMatchObject({
      active: true,
      status: 'ready',
      filename: 'Source Notes.md',
      mimeType: 'text/markdown',
      fileType: 'md',
      text: '# Original\n\nBrowser-backed source.',
      src: '',
      downloadable: true,
    })
    controller.download()
    controller.openExternal()
    expect(downloads).toEqual([{ url: 'blob:original-1', filename: 'Source Notes.md' }])
    expect(opened).toEqual(['blob:original-1'])

    controller.setScope(contract(), 'graph one', 'doc-beta', {
      storageKey: 'local://artifacts/beta',
      originalFilename: 'beta.md',
    })
    expect(urls.revoked).toEqual(['blob:original-1'])
    expect(controller.snapshot()).toMatchObject({ active: false, status: 'idle', documentId: 'doc-beta' })
  })

  it('surfaces 404 as honestly unavailable without manufacturing a Blob URL', async () => {
    const urls = urlHarness()
    const controller = new OrganismOriginalFileController({
      requestRender: vi.fn(),
      fetch: vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof globalThis.fetch,
      url: urls.api,
    })
    controller.setScope(contract('/cell'), 'g', 'missing', {
      storageKey: 'local://artifacts/stale',
      originalFilename: 'stale.pdf',
    })
    await controller.toggle()

    expect(controller.snapshot()).toMatchObject({
      active: true,
      status: 'unavailable',
      error: 'No original file is attached to this document.',
      downloadable: false,
      externalOpenable: false,
    })
    expect(urls.created).toHaveLength(0)
  })

  it('follows a persisted local artifact source when gardend has not copied document-original bytes', async () => {
    const calls: string[] = []
    const controller = new OrganismOriginalFileController({
      requestRender: vi.fn(),
      fetch: async (input) => {
        calls.push(String(input))
        if (calls.length === 1) return new Response('No document original', { status: 404 })
        return binaryResponse('artifact bytes', 'application/pdf', 'paper.pdf')
      },
      url: urlHarness().api,
    })
    controller.setScope(contract('/cell'), 'graph a', 'doc-a', {
      storageKey: 'local://artifacts/artifact%2Fa/original/paper.pdf',
      originalFilename: 'paper.pdf',
      mimeType: 'application/pdf',
      fileType: 'pdf',
    })

    await controller.toggle()

    expect(calls).toEqual([
      '/cell/artifacts/graph%20a/documents/doc-a/download-original?inline=true',
      '/cell/artifacts/graph%20a/artifact%2Fa/download?inline=true',
    ])
    expect(controller.snapshot()).toMatchObject({ status: 'ready', filename: 'paper.pdf', downloadable: true })
  })

  it('aborts and ignores a stale response when the provider/document scope changes', async () => {
    const urls = urlHarness()
    let resolveFetch!: (value: Response) => void
    let observedSignal: AbortSignal | undefined
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined
      return new Promise<Response>(resolve => { resolveFetch = resolve })
    }) as unknown as typeof globalThis.fetch
    const controller = new OrganismOriginalFileController({ requestRender: vi.fn(), fetch, url: urls.api })
    const stableContract = contract('/cell')
    controller.setScope(stableContract, 'g', 'doc-a', {
      storageKey: 'local://artifacts/a',
      originalFilename: 'a.pdf',
    })
    const pending = controller.toggle()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)

    controller.setScope(stableContract, 'g', 'doc-b', {
      storageKey: 'local://artifacts/b',
      originalFilename: 'b.pdf',
    })
    expect(observedSignal?.aborted).toBe(true)
    resolveFetch(binaryResponse('late body', 'text/plain', 'late.txt'))
    await pending

    expect(controller.snapshot()).toMatchObject({ documentId: 'doc-b', active: false, status: 'idle' })
    expect(urls.created).toHaveLength(0)
  })

  it('sanitizes hosted HTML and revokes its download URL on destroy', async () => {
    const urls = urlHarness()
    const source = '<!doctype html><html><body><h1 onclick="steal()">Safe title</h1><script>steal()</script><img src="https://tracker.invalid/pixel" onerror="steal()"><a href="javascript:steal()">bad</a></body></html>'
    const controller = new OrganismOriginalFileController({
      requestRender: vi.fn(),
      fetch: vi.fn(async () => binaryResponse(source, 'text/html', 'page.html')) as unknown as typeof globalThis.fetch,
      url: urls.api,
    })
    controller.setScope(contract('/cell'), 'g', 'html-doc', {
      storageKey: 'local://artifacts/html',
      originalFilename: 'hosted.html',
      mimeType: 'text/html',
      fileType: 'html',
    })
    await controller.toggle()
    const snapshot = controller.snapshot()

    expect(snapshot.error).toBe('')
    expect(snapshot.status).toBe('ready')
    expect(snapshot.srcdoc).toContain('Safe title')
    expect(snapshot.srcdoc).toContain('Content-Security-Policy')
    expect(snapshot.srcdoc).not.toContain('<script')
    expect(snapshot.srcdoc).not.toContain('onclick=')
    expect(snapshot.srcdoc).not.toContain('tracker.invalid')
    expect(snapshot.srcdoc).not.toContain('javascript:')
    controller.destroy()
    expect(urls.revoked).toEqual(['blob:original-1'])
  })

  it('builds a safe ordered EPUB chapter preview from the existing fflate substrate', async () => {
    const urls = urlHarness()
    const epub = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
        <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
          <rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>`),
      'OEBPS/book.opf': strToU8(`<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Reader Fixture</dc:title></metadata>
          <manifest>
            <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
            <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine><itemref idref="two"/><itemref idref="one"/></spine>
        </package>`),
      'OEBPS/one.xhtml': strToU8('<html><head><title>First</title></head><body><p>First chapter.</p></body></html>'),
      'OEBPS/two.xhtml': strToU8('<html><head><title>Second</title></head><body><p>Second chapter.</p><script>bad()</script></body></html>'),
    })
    const controller = new OrganismOriginalFileController({
      requestRender: vi.fn(),
      fetch: vi.fn(async () => binaryResponse(epub, 'application/epub+zip', 'fixture.epub')) as unknown as typeof globalThis.fetch,
      url: urls.api,
    })
    controller.setScope(contract('/cell'), 'g', 'epub-doc', {
      storageKey: 'local://artifacts/epub',
      originalFilename: 'fixture.epub',
      mimeType: 'application/epub+zip',
      fileType: 'epub',
    })
    await controller.toggle()
    const snapshot = controller.snapshot()

    expect(snapshot.error).toBe('')
    expect(snapshot).toMatchObject({
      status: 'ready',
      title: 'Reader Fixture',
      selectedChapterId: 'two',
    })
    expect(snapshot.chapters.map(chapter => chapter.title)).toEqual(['Second', 'First'])
    expect(snapshot.chapters[0]?.srcdoc).toContain('Second chapter.')
    expect(snapshot.chapters[0]?.srcdoc).not.toContain('<script')
    controller.selectChapter('one')
    expect(controller.snapshot().selectedChapterId).toBe('one')
  })
})
