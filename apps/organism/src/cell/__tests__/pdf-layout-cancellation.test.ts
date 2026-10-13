// @vitest-environment node
// These are mocked PDF.js lifecycle witnesses, NOT actual PDF extraction.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePdfFastTextDocument } from '../pdf-layout-parser.js'
import { loadPdfJs } from '../pdfjs-runtime.js'

vi.mock('../pdfjs-runtime.js', () => ({ loadPdfJs: vi.fn() }))
afterEach(() => vi.resetAllMocks())

describe('lightweight PDF lifecycle', () => {
  it('destroys a pending loading task on cancellation and removes its listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    let reject!: (error: Error) => void
    const promise = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise })
    const destroy = vi.fn(async () => { reject(new Error('worker destroyed')) })
    const getDocument = vi.fn(() => ({ promise, destroy }))
    vi.mocked(loadPdfJs).mockResolvedValue({ getDocument } as any)
    const parse = parsePdfFastTextDocument({ bytes: new Uint8Array([1]), fallbackTitle: 'pending', signal: controller.signal })
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce(), { interval: 1, timeout: 1000 })
    controller.abort()
    await expect(parse).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('does not turn cancellation during page extraction into a partial success', async () => {
    const controller = new AbortController()
    const cleanup = vi.fn()
    const destroy = vi.fn(async () => {})
    const page = {
      getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: async () => { controller.abort(); throw new Error('worker stopped') },
      cleanup,
    }
    vi.mocked(loadPdfJs).mockResolvedValue({
      getDocument: () => ({ promise: Promise.resolve({
        numPages: 1, getMetadata: async () => null, getPage: async () => page,
      }), destroy }),
    } as any)
    await expect(parsePdfFastTextDocument({ bytes: new Uint8Array([1]), fallbackTitle: 'pending', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalled()
  })

  it('retains a page failure as an explicit partial result with source-page identity', async () => {
    const cleanup = vi.fn()
    const destroy = vi.fn(async () => {})
    vi.mocked(loadPdfJs).mockResolvedValue({
      version: 'mock-lifecycle-only',
      getDocument: () => ({ promise: Promise.resolve({
        numPages: 2, getMetadata: async () => null,
        getPage: async (pageNumber: number) => ({
          view: [0, 0, 600, 800], rotate: 0, userUnit: 1,
          getViewport: () => ({ width: 600, height: 800 }),
          getTextContent: async () => {
            if (pageNumber === 1) throw new Error('selected page failure')
            return { styles: {}, items: [{ str: 'Retained second page', transform: [1, 0, 0, 12, 72, 650], width: 150, height: 12 }] }
          },
          cleanup,
        }),
      }), destroy }),
    } as any)
    const result = await parsePdfFastTextDocument({ bytes: new Uint8Array([1]), fallbackTitle: 'partial' })
    expect(result.extractionStatus).toBe('partial')
    expect(result.warnings).toEqual(['Page 1: text extraction failed (selected page failure)'])
    expect(result.tiptapJson.content![1]!.attrs).toMatchObject({ 'data-source-page': 2 })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(destroy).toHaveBeenCalledOnce()
  })
})
