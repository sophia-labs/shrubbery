/** Controller refusal/lifetime tests. The renderer is an explicit test adapter, not PDF visual proof. */
import { describe, expect, it, vi } from 'vitest'
import { encodePdfSourceAnchor, sha256PdfSourceBytes, type PdfSourceAnchorV1, type ShrubberyContract } from '@shrubbery/nucleus'
import type { EditorPdfSourceLocation } from '@shrubbery/runtime'
import { OrganismOriginalFileController } from '../original-file-controller.js'
import type { PdfOriginalPreview, PdfRenderedPage } from '../pdf-original-preview.js'

const bytes = new TextEncoder().encode('original fixture bytes')
const text = 'The mapped passage.'
const contract: Pick<ShrubberyContract, 'auth' | 'runtime'> = {
  auth: { token: () => 'fixture', userId: () => 'reader', isAuthenticated: () => true, whenReady: async () => undefined, onChange: () => () => undefined },
  runtime: { mode: () => 'hosted', isGateway: () => true, graphBaseUrl: () => 'https://fixture.test/g/g' },
}
async function anchor(): Promise<PdfSourceAnchorV1> {
  return { version: 1, source: { sha256: await sha256PdfSourceBytes(bytes), byteLength: bytes.length, artifactId: 'artifact-1', revisionId: 'rev-1' },
    textSha256: await sha256PdfSourceBytes(new TextEncoder().encode(text)), relation: 'derived-from', precision: 'block',
    extraction: { approach: 'pdf-fast-text', version: '1' }, targets: [{ pageIndex: 1, space: 'pdf-user-space', viewBox: [0, 0, 600, 800], userUnit: 1, rotation: 0, rects: [[30, 500, 300, 520], [30, 470, 280, 490]] }] }
}
function location(value: PdfSourceAnchorV1, currentText = text): EditorPdfSourceLocation {
  return { blockId: 'passage', rawAnchor: encodePdfSourceAnchor(value), text: currentText, pageNumber: 2 }
}
function rendered(pageNumber: number, geometryMatches = true): PdfRenderedPage {
  return { pageNumber, width: 600, height: 800, blob: new Blob(['raster']), geometryMatches,
    rectangles: [{ left: 5, top: 35, width: 45, height: 3 }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function harness(options: { body?: Uint8Array; preview?: PdfOriginalPreview; factory?: (signal: AbortSignal) => Promise<PdfOriginalPreview>; responseStatus?: number } = {}) {
  const calls: string[] = [], created: Blob[] = [], revoked: string[] = []
  const preview = options.preview ?? { pageCount: 3, renderPage: vi.fn(async (n: number) => rendered(n)), destroy: vi.fn(async () => undefined) }
  const factory = vi.fn(async (_bytes: Uint8Array, signal: AbortSignal) => options.factory ? options.factory(signal) : preview)
  const controller = new OrganismOriginalFileController({
    requestRender: vi.fn(), pdfPreview: factory,
    fetch: async (url, init) => {
      calls.push(String(url))
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture')
      return new Response(new Uint8Array(options.body ?? bytes), { status: options.responseStatus ?? 200, headers: { 'content-type': 'application/pdf' } })
    },
    url: { createObjectURL: blob => { created.push(blob); return `blob:fixture-${created.length}` }, revokeObjectURL: url => { revoked.push(url) } },
  })
  controller.setScope(contract, 'g', 'doc', { originalFilename: 'paper.pdf', fileType: 'pdf' })
  return { controller, preview, factory, calls, created, revoked }
}

describe('verified original PDF navigation', () => {
  it('uses the exact revision, verifies bytes and text, shows the correct page, and disposes page rasters', async () => {
    const value = await anchor(), h = harness()
    await h.controller.toggle(location(value))
    expect(h.calls).toEqual(['https://fixture.test/g/g/artifacts/g/artifact-1/revisions/rev-1/download?inline=true'])
    expect(h.controller.snapshot()).toMatchObject({ status: 'ready', pdfPageNumber: 2, pdfPageCount: 3, pdfSourceMapping: { status: 'mapped', pages: [2] } })
    expect(h.controller.snapshot().pdfPages?.[0]?.rectangles).toHaveLength(1)
    await h.controller.selectPage(3)
    expect(h.controller.snapshot().pdfPageNumber).toBe(3)
    expect(h.revoked).toContain('blob:fixture-2')
    await h.controller.toggle()
    expect(h.controller.snapshot()).toMatchObject({ active: false, status: 'idle', pdfPageCount: 0 })
    expect(h.preview.destroy).toHaveBeenCalledTimes(1)
    expect(h.revoked.sort()).toEqual(['blob:fixture-1', 'blob:fixture-2', 'blob:fixture-3'])
  })

  it.each(['hash', 'length'] as const)('refuses precise highlights when original %s disagrees', async kind => {
    const value = await anchor()
    if (kind === 'hash') value.source.sha256 = 'a'.repeat(64)
    else value.source.byteLength += 1
    const h = harness()
    await h.controller.toggle(location(value))
    expect(h.controller.snapshot().pdfSourceMapping?.status).toBe('source-mismatch')
    expect(h.controller.snapshot().pdfPages?.[0]?.rectangles).toEqual([])
    expect(h.controller.snapshot().pdfPageNumber).toBe(1)
    expect(h.controller.snapshot().downloadable).toBe(true)
    h.controller.destroy()
  })

  it('marks an edited passage instead of claiming a current exact text match', async () => {
    const h = harness()
    await h.controller.toggle(location(await anchor(), 'Changed words.'))
    expect(h.controller.snapshot().pdfSourceMapping).toMatchObject({ status: 'edited' })
    expect(h.controller.snapshot().pdfPages?.[0]?.rectangles).toHaveLength(1)
    h.controller.destroy()
  })

  it.each([
    ['unmapped', undefined, 2], ['invalid', '{bad', 1], ['unsupported', '{"version":2}', 1],
  ] as const)('distinguishes %s metadata without inventing geometry', async (status, rawAnchor, pageNumber) => {
    const h = harness()
    await h.controller.toggle({ blockId: 'p', rawAnchor, text, pageNumber: 2 })
    expect(h.controller.snapshot().pdfSourceMapping?.status).toBe(status)
    expect(h.controller.snapshot().pdfPageNumber).toBe(pageNumber)
    expect(h.controller.snapshot().pdfPages?.[0]?.rectangles).toEqual([])
    h.controller.destroy()
  })

  it('refuses a nonexistent page and actual crop/rotation disagreement', async () => {
    const value = await anchor()
    value.targets = [{ ...value.targets[0]!, pageIndex: 99 }]
    const h = harness()
    await h.controller.toggle(location(value))
    expect(h.controller.snapshot().pdfSourceMapping?.status).toBe('invalid')
    expect(h.controller.snapshot().pdfPages?.[0]?.rectangles).toEqual([])
    h.controller.destroy()
    const wrong = harness({ preview: { pageCount: 3, destroy: async () => undefined, renderPage: async n => rendered(n, false) } })
    await wrong.controller.toggle(location(await anchor()))
    expect(wrong.controller.snapshot().pdfSourceMapping?.status).toBe('invalid')
    expect(wrong.controller.snapshot().pdfPages?.[0]?.rectangles).toEqual([])
    wrong.controller.destroy()
  })

  it('does not silently fall back to a mutable current original when its exact revision is missing', async () => {
    const h = harness({ responseStatus: 404 })
    await h.controller.toggle(location(await anchor()))
    expect(h.calls).toHaveLength(1)
    expect(h.factory).not.toHaveBeenCalled()
    expect(h.controller.snapshot()).toMatchObject({ status: 'unavailable', downloadable: false })
    h.controller.destroy()
  })

  it('destroys a late PDF load after changing documents without publishing its result', async () => {
    const pending = deferred<PdfOriginalPreview>(), started = deferred<AbortSignal>()
    const late = { pageCount: 3, destroy: vi.fn(async () => undefined), renderPage: vi.fn(async (n: number) => rendered(n)) }
    const h = harness({ factory: signal => { started.resolve(signal); return pending.promise } })
    const load = h.controller.toggle(location(await anchor()))
    const signal = await started.promise
    h.controller.setScope(contract, 'g', 'next', { originalFilename: 'next.pdf' })
    pending.resolve(late)
    await load
    expect(signal.aborted).toBe(true)
    expect(late.destroy).toHaveBeenCalledTimes(1)
    expect(late.renderPage).not.toHaveBeenCalled()
    expect(h.controller.snapshot()).toMatchObject({ documentId: 'next', active: false, pdfPages: [] })
    expect(h.revoked).toEqual(['blob:fixture-1'])
    h.controller.destroy()
  })

  it('ignores an older page render after a newer page request', async () => {
    const second = deferred<PdfRenderedPage>(), started = deferred<AbortSignal>()
    const preview: PdfOriginalPreview = { pageCount: 3, destroy: async () => undefined, renderPage: async (n, _a, signal) => {
      if (n === 2) { started.resolve(signal); return second.promise }
      return rendered(n)
    } }
    const h = harness({ preview })
    await h.controller.toggle()
    const old = h.controller.selectPage(2)
    const oldSignal = await started.promise
    await h.controller.selectPage(3)
    second.resolve(rendered(2))
    await old
    expect(oldSignal.aborted).toBe(true)
    expect(h.controller.snapshot()).toMatchObject({ status: 'ready', pdfPageNumber: 3 })
    expect(h.controller.snapshot().pdfPages?.[0]?.pageNumber).toBe(3)
    expect(h.created).toHaveLength(3)
    h.controller.destroy()
  })
})
