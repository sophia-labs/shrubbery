/**
 * REAL component test - mn-original-viewer controlled original-file surface.
 *
 * The element renders caller-owned preview data and emits composed intents. It
 * does not read native files, refresh URLs, run pdfjs, build EPUB previews, or
 * decorate annotations by itself.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import '../mn-original-viewer.js'
import type {
  MnOriginalViewer,
  MnOriginalViewerAnnotationDetail,
  MnOriginalViewerChapterDetail,
  MnOriginalViewerIntentDetail,
} from '../mn-original-viewer.js'

async function mount(setup?: (el: MnOriginalViewer) => void): Promise<MnOriginalViewer> {
  const el = document.createElement('mn-original-viewer') as MnOriginalViewer
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnOriginalViewer) => el.shadowRoot!

describe('mn-original-viewer - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-original-viewer')).toBeDefined()
  })

  it('renders loading and error states from controlled status props', async () => {
    const el = await mount((node) => {
      node.status = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()

    el.status = 'error'
    el.error = 'read failed'
    await el.updateComplete
    const empty = sr(el).querySelector('mn-empty-state')!
    expect(empty.getAttribute('title')).toBe('Original file failed')
    expect(empty.getAttribute('description')).toBe('read failed')
  })

  it('renders text originals and emits reload/download intents', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.kind = 'text'
      node.graphId = 'graph-a'
      node.documentId = 'doc-a'
      node.filename = 'notes.txt'
      node.text = 'Original text body'
      node.downloadable = true
    })
    const reloads: MnOriginalViewerIntentDetail[] = []
    const downloads: MnOriginalViewerIntentDetail[] = []
    el.addEventListener('mn-original-viewer-reload', (event) => {
      reloads.push((event as CustomEvent<MnOriginalViewerIntentDetail>).detail)
    })
    el.addEventListener('mn-original-viewer-download', (event) => {
      downloads.push((event as CustomEvent<MnOriginalViewerIntentDetail>).detail)
    })

    expect(sr(el).querySelector('.source-pre')?.textContent).toBe('Original text body')
    ;(sr(el).querySelector('[aria-label="Reload original file"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[aria-label="Download original file"]') as HTMLButtonElement).click()

    expect(reloads).toEqual([{ graphId: 'graph-a', documentId: 'doc-a' }])
    expect(downloads).toEqual([{ graphId: 'graph-a', documentId: 'doc-a' }])
  })

  it('renders iframe HTML and annotation rail as controlled data', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.kind = 'html'
      node.graphId = 'graph-a'
      node.documentId = 'doc-a'
      node.filename = 'source.html'
      node.srcdoc = '<h1>Original</h1>'
      node.annotations = [
        { id: 'ann-1', label: 'Source comment', quote: 'Important sentence', pageNumber: 2 },
      ]
    })
    const annotations: MnOriginalViewerAnnotationDetail[] = []
    el.addEventListener('mn-original-viewer-annotation-select', (event) => {
      annotations.push((event as CustomEvent<MnOriginalViewerAnnotationDetail>).detail)
    })

    const frame = sr(el).querySelector('iframe') as HTMLIFrameElement
    expect(frame).not.toBeNull()
    expect(frame.srcdoc).toBe('<h1>Original</h1>')
    expect(sr(el).querySelector('.annotation-rail')?.textContent).toContain('Important sentence')

    ;(sr(el).querySelector('[data-annotation-id="ann-1"]') as HTMLButtonElement).click()
    expect(annotations[0]).toMatchObject({
      graphId: 'graph-a',
      documentId: 'doc-a',
      annotationId: 'ann-1',
    })
  })

  it('renders EPUB chapters and emits chapter selection intents', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.kind = 'epub'
      node.graphId = 'graph-a'
      node.documentId = 'doc-a'
      node.title = 'Book'
      node.chapters = [
        { id: 'c1', title: 'Intro', text: 'Intro text' },
        { id: 'c2', title: 'Chapter Two', text: 'Second text' },
      ]
    })
    const chapters: MnOriginalViewerChapterDetail[] = []
    el.addEventListener('mn-original-viewer-chapter-select', (event) => {
      chapters.push((event as CustomEvent<MnOriginalViewerChapterDetail>).detail)
    })

    expect(sr(el).querySelector('.source-pre')?.textContent).toBe('Intro text')
    const chapterTwo = Array.from(sr(el).querySelectorAll('.chapter-button')).find((button) => button.textContent === 'Chapter Two') as HTMLButtonElement
    chapterTwo.click()

    expect(chapters[0]).toMatchObject({
      graphId: 'graph-a',
      documentId: 'doc-a',
      chapterId: 'c2',
    })
  })

  it('renders controlled PDF page previews and file fallback actions', async () => {
    const pdf = await mount((node) => {
      node.status = 'ready'
      node.kind = 'pdf'
      node.filename = 'paper.pdf'
      node.pages = [
        { pageNumber: 1, width: 612, height: 792, imageUrl: 'data:image/png;base64,abc' },
        { pageNumber: 2, width: 612, height: 792 },
      ]
    })
    expect(sr(pdf).querySelectorAll('.pdf-page')).toHaveLength(2)
    expect(sr(pdf).querySelector('.pdf-image')?.getAttribute('src')).toBe('data:image/png;base64,abc')
    expect(sr(pdf).querySelector('.pdf-placeholder')?.textContent).toContain('Page 2')

    const file = await mount((node) => {
      node.status = 'ready'
      node.kind = 'file'
      node.graphId = 'graph-a'
      node.documentId = 'doc-file'
      node.filename = 'archive.zip'
      node.externalOpenable = true
    })
    const opens: MnOriginalViewerIntentDetail[] = []
    file.addEventListener('mn-original-viewer-open-external', (event) => {
      opens.push((event as CustomEvent<MnOriginalViewerIntentDetail>).detail)
    })

    const open = Array.from(sr(file).querySelectorAll('button')).find((button) => button.textContent?.includes('Open')) as HTMLButtonElement
    open.click()
    expect(opens).toEqual([{ graphId: 'graph-a', documentId: 'doc-file' }])
  })
})
