/** Each file's last page and zoom, per viewer, in localStorage. Every access is guarded: storage can be absent, full or blocked. */
export interface PdfReaderMemory {
  readonly page: number
  /** 'page-width' | 'page-fit' | a scale like 1.25 */
  readonly zoom: string | number
}

const KEY = (fileKey: string) => `mn-pdf-reader:v1:${fileKey}`

export function readMemory(fileKey: string): PdfReaderMemory | null {
  if (!fileKey) return null
  try {
    const raw = globalThis.localStorage?.getItem(KEY(fileKey))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<PdfReaderMemory>
    const page = typeof v.page === 'number' && Number.isInteger(v.page) && v.page >= 1 ? v.page : 1
    const zoom = v.zoom === 'page-width' || v.zoom === 'page-fit' ? v.zoom : typeof v.zoom === 'number' && v.zoom >= 0.1 && v.zoom <= 8 ? v.zoom : 'page-width'
    return { page, zoom }
  } catch { return null }
}

export function writeMemory(fileKey: string, memory: PdfReaderMemory): void {
  if (!fileKey) return
  try { globalThis.localStorage?.setItem(KEY(fileKey), JSON.stringify(memory)) } catch { /* the reader works without it */ }
}
