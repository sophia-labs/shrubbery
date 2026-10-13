/** PDF effects belong to the shell, not the controlled original-view component. */
import type { PdfSourceAnchorV1 } from '@shrubbery/nucleus'
import { loadPdfJs } from './pdfjs-runtime.js'

export interface PdfPreviewRectangle {
  /** Percentages in the rendered, cropped and rotated page viewport. */
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface PdfRenderedPage {
  readonly pageNumber: number
  readonly width: number
  readonly height: number
  readonly blob: Blob
  readonly rectangles: readonly PdfPreviewRectangle[]
  readonly geometryMatches: boolean
}

export interface PdfOriginalPreview {
  readonly pageCount: number
  renderPage(pageNumber: number, anchor: PdfSourceAnchorV1 | null, signal: AbortSignal): Promise<PdfRenderedPage>
  destroy(): Promise<void>
}

export type PdfOriginalPreviewFactory = (bytes: Uint8Array, signal: AbortSignal) => Promise<PdfOriginalPreview>

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('PDF preview cancelled', 'AbortError')
}

function sameNumber(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9)
}

/** Compare source geometry before using it, even after the byte identity matches. */
export function pdfPageGeometryMatches(
  target: PdfSourceAnchorV1['targets'][number],
  page: { view: readonly number[]; rotate: number; userUnit: number },
): boolean {
  return page.view.length === 4
    && target.viewBox.every((value, index) => sameNumber(value, page.view[index]!))
    && target.rotation === ((page.rotate % 360) + 360) % 360
    && sameNumber(target.userUnit, page.userUnit)
}

/** Rasterization is bounded independently of an untrusted PDF's page size. */
export function pdfPreviewScale(width: number, height: number): number {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || !Number.isFinite(width * height)) throw new Error('PDF page dimensions are invalid.')
  return Math.min(2, 1960 / width, 4096 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)))
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PDF page could not be rendered.')), 'image/png')
  })
}

export const createPdfOriginalPreview: PdfOriginalPreviewFactory = async (bytes, signal) => {
  checkAbort(signal)
  const pdfjs = await loadPdfJs()
  checkAbort(signal)
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: false,
  })
  let disposed = false
  let destruction: Promise<void> | null = null
  const renders = new Set<{ cancel(): void }>()
  const destroy = (): Promise<void> => {
    disposed = true
    signal.removeEventListener('abort', abortLoad)
    for (const render of renders) render.cancel()
    destruction ??= loading.destroy().catch(() => undefined)
    return destruction
  }
  const abortLoad = (): void => { void destroy() }
  signal.addEventListener('abort', abortLoad, { once: true })
  try {
    const pdf = await loading.promise
    checkAbort(signal)
    if (disposed) throw new DOMException('PDF preview cancelled', 'AbortError')
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('PDF has no pages.')
    // Ownership transfers to the preview. The caller may cancel its first
    // page to select another; that must not destroy the whole loaded PDF.
    signal.removeEventListener('abort', abortLoad)
    return {
      pageCount: pdf.numPages,
      destroy,
      async renderPage(pageNumber, anchor, pageSignal) {
        checkAbort(pageSignal)
        if (disposed) throw new DOMException('PDF preview cancelled', 'AbortError')
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
          throw new Error('The requested PDF page does not exist.')
        }
        const page = await pdf.getPage(pageNumber)
        let canvas: HTMLCanvasElement | null = null
        try {
          checkAbort(pageSignal)
          if (disposed) throw new DOMException('PDF preview cancelled', 'AbortError')
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: pdfPreviewScale(base.width, base.height) })
          canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.ceil(viewport.width))
          canvas.height = Math.max(1, Math.ceil(viewport.height))
          const context = canvas.getContext('2d', { alpha: false })
          if (!context) throw new Error('Canvas 2D is unavailable for the PDF preview.')
          const task = page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' })
          renders.add(task)
          const cancel = (): void => task.cancel()
          pageSignal.addEventListener('abort', cancel, { once: true })
          try {
            await task.promise
          } finally {
            pageSignal.removeEventListener('abort', cancel)
            renders.delete(task)
          }
          checkAbort(pageSignal)
          const targets = anchor?.targets.filter(target => target.pageIndex === pageNumber - 1) ?? []
          const geometryMatches = targets.every(target => pdfPageGeometryMatches(target, page))
          const rectangles: PdfPreviewRectangle[] = []
          if (geometryMatches) {
            for (const target of targets) {
              for (const rect of target.rects) {
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([...rect])
                // The image uses integer canvas dimensions, including any subpixel margin.
                rectangles.push({
                  left: 100 * Math.min(x1!, x2!) / canvas.width,
                  top: 100 * Math.min(y1!, y2!) / canvas.height,
                  width: 100 * Math.abs(x2! - x1!) / canvas.width,
                  height: 100 * Math.abs(y2! - y1!) / canvas.height,
                })
              }
            }
          }
          const blob = await canvasBlob(canvas)
          checkAbort(pageSignal)
          if (disposed) throw new DOMException('PDF preview cancelled', 'AbortError')
          return { pageNumber, width: canvas.width, height: canvas.height, blob, rectangles, geometryMatches }
        } finally {
          if (canvas) { canvas.width = 0; canvas.height = 0 }
          page.cleanup()
        }
      },
    }
  } catch (error) {
    await destroy()
    throw error
  }
}
