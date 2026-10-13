/** Explicit PDF.js loading-task adapter: tests ownership, not PDF rendering. */
import { describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ loading: null as any }))
vi.mock('../pdfjs-runtime.js', () => ({ loadPdfJs: async () => ({ getDocument: () => fixture.loading }) }))
import { createPdfOriginalPreview } from '../pdf-original-preview.js'

describe('original PDF load and page ownership', () => {
  it('transfers a loaded PDF to the preview, so cancelling the first page does not destroy later pages', async () => {
    const destroy = vi.fn(async () => undefined)
    fixture.loading = { promise: Promise.resolve({ numPages: 2 }), destroy }
    const firstPage = new AbortController()
    const preview = await createPdfOriginalPreview(new Uint8Array([1]), firstPage.signal)
    firstPage.abort()
    expect(destroy).not.toHaveBeenCalled()
    await preview.destroy()
    await preview.destroy()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('still destroys a PDF loading task when cancelled before ownership transfers', async () => {
    let reject!: (error: Error) => void
    const promise = new Promise<never>((_resolve, fail) => { reject = fail })
    const destroy = vi.fn(async () => { reject(new DOMException('Cancelled', 'AbortError')) })
    fixture.loading = { promise, destroy }
    const abort = new AbortController()
    const loading = createPdfOriginalPreview(new Uint8Array([1]), abort.signal)
    await Promise.resolve()
    abort.abort()
    await expect(loading).rejects.toThrow('Cancelled')
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
