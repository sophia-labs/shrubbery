/**
 * The Reader's EPUB → book parser, against real books: Freud's *The Interpretation of Dreams* (Brill, 1913),
 * Project Gutenberg #66048, the EPUB the Freud demo imports (`pg66048-images-3.epub`, sha256 90583955…a3309c),
 * and small EPUBs built here with fflate, each a real zip a reader would open.
 */

import { existsSync, readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { printedPages, readEpubBook, readerAnchorId, readerChapterId, type ReaderBook, type ReaderTocEntry } from '../epub-book.js'

const FREUD_EPUB = process.env.FREUD_EPUB
  ?? '/Users/vera/dev/sophia/plans/2026-10-18-freud-demo/source/epub/pg66048-images-3.epub'

/** A real 1×1 PNG. */
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

const ALLOWED_ELEMENTS = new Set([
  'p', 'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'i', 'b', 'strong', 'small', 'sub', 'sup', 's', 'u', 'del', 'ins', 'mark', 'abbr', 'cite', 'q', 'dfn',
  'code', 'kbd', 'samp', 'var', 'pre', 'blockquote', 'br', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'col', 'colgroup',
  'figure', 'figcaption', 'img', 'a', 'ruby', 'rt', 'rp', 'wbr', 'bdi', 'bdo', 'time',
])
const ALLOWED_ATTRIBUTES = new Set([
  'id', 'class', 'lang', 'dir', 'title', 'alt', 'colspan', 'rowspan', 'width', 'height', 'data-epub-type',
  'start', 'reversed', 'scope', 'datetime', 'href', 'src', 'rel',
  'data-rd-chapter', 'data-rd-anchor', 'data-rd-external', 'data-page',
])

const parsed = new Map<string, HTMLElement>()

/** Chapter html parsed the way the Reader's `unsafeHTML` will parse it (once per html: Freud's chapters are large). */
function fragment(html: string): HTMLElement {
  let body = parsed.get(html)
  if (!body) {
    body = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html').body
    parsed.set(html, body)
  }
  return body
}

function textOf(html: string): string {
  return (fragment(html).textContent ?? '').replace(/\s+/g, ' ')
}

function idsOf(html: string): Set<string> {
  return new Set(Array.from(fragment(html).querySelectorAll('[id]')).map(element => element.id))
}

function flatten(entries: readonly ReaderTocEntry[]): ReaderTocEntry[] {
  return entries.flatMap(entry => [entry, ...flatten(entry.children)])
}

/** Every element and attribute in `html` is on the allowlist; no href/src is executable or remote. */
function expectAllowlisted(html: string): void {
  for (const element of Array.from(fragment(html).querySelectorAll('*'))) {
    expect(ALLOWED_ELEMENTS, `element <${element.localName}>`).toContain(element.localName)
    for (const attribute of Array.from(element.attributes)) {
      expect(ALLOWED_ATTRIBUTES, `attribute ${attribute.name} on <${element.localName}>`).toContain(attribute.name)
    }
    const href = element.getAttribute('href')
    if (href !== null) expect(href).toMatch(/^(?:#|https?:|mailto:)/)
    const src = element.getAttribute('src')
    if (src !== null) expect(src).toMatch(/^data:image\//)
  }
}

interface InternalLinkAudit {
  readonly total: number
  readonly toChapterStart: number
  readonly resolved: number
  readonly unresolved: readonly { from: number; href: string }[]
}

function auditInternalLinks(book: ReaderBook): InternalLinkAudit {
  const ids = book.chapters.map(chapter => idsOf(chapter.html))
  let total = 0
  let toChapterStart = 0
  let resolved = 0
  const unresolved: { from: number; href: string }[] = []
  for (const chapter of book.chapters) {
    for (const anchor of Array.from(fragment(chapter.html).querySelectorAll('a[data-rd-chapter]'))) {
      total += 1
      const target = Number(anchor.getAttribute('data-rd-chapter'))
      const id = anchor.getAttribute('data-rd-anchor') ?? ''
      const href = anchor.getAttribute('href') ?? ''
      expect(Number.isInteger(target) && target >= 0 && target < book.chapters.length).toBe(true)
      expect(href).toBe(`#${id || readerChapterId(target)}`)
      if (!id) {
        toChapterStart += 1
        resolved += 1
      } else if (ids[target]!.has(id)) resolved += 1
      else unresolved.push({ from: chapter.index, href })
    }
  }
  return { total, toChapterStart, resolved, unresolved }
}

// ---------------------------------------------------------------------------------------------------------------
// Building small EPUBs

function containerXml(packagePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${packagePath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
}

function buildEpub(packagePath: string, files: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  const zippable: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml(packagePath)),
  }
  for (const [path, content] of Object.entries(files)) zippable[path] = typeof content === 'string' ? strToU8(content) : content
  return zipSync(zippable)
}

function xhtml(title: string, body: string, lang = 'en'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
<body>${body}</body>
</html>`
}

// ---------------------------------------------------------------------------------------------------------------
// Freud

describe.skipIf(!existsSync(FREUD_EPUB))('readEpubBook — The Interpretation of Dreams (Gutenberg #66048)', () => {
  let book: ReaderBook
  let spineCount = 0

  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(FREUD_EPUB))
    const opf = new TextDecoder().decode(unzipSync(bytes)['OEBPS/content.opf'])
    spineCount = opf.match(/<itemref\b/g)?.length ?? 0
    book = await readEpubBook(bytes, 'pg66048-images-3.epub')
  })

  it('reads the package metadata and the cover', () => {
    expect(book.title).toBe('The Interpretation of Dreams')
    expect(book.author).toContain('Freud')
    expect(book.language).toBe('en')
    expect(book.publisher).toBe('')
    expect(book.version).toBe('3.0')
    expect(book.cover).toMatch(/^data:image\/jpeg;base64,\/9j\//)
  })

  it('has one chapter per spine item, in spine order', () => {
    expect(spineCount).toBe(21)
    expect(book.chapters).toHaveLength(spineCount)
    book.chapters.forEach((chapter, index) => expect(chapter.index).toBe(index))
    expect(book.chapters[0]!.path).toBe('OEBPS/wrap0000.xhtml')
    expect(book.chapters[1]!.id).toBe('pg-header')
    expect(book.chapters.at(-1)!.id).toBe('pg-footer')
  })

  it('takes the nested TOC from the EPUB3 nav', () => {
    expect(book.tocSource).toBe('nav')
    expect(book.toc.length).toBe(16)
    const method = book.toc.find(entry => entry.label === 'II METHOD OF DREAM INTERPRETATION')!
    expect(method.children.map(child => child.label)).toEqual([
      'THE ANALYSIS OF A SAMPLE DREAM', 'Dream of July 23–24, 1895', 'Analysis',
    ])
    const dreamWork = book.toc.find(entry => entry.label === 'VI THE DREAM-WORK')!
    expect(dreamWork.children).toHaveLength(9)
    // "(f) Absurd Dreams" is under VI in the TOC but lives in the next file.
    expect(dreamWork.children[6]!.chapterIndex).toBe(dreamWork.chapterIndex + 1)
    // Every TOC anchor is an id in the chapter it names.
    for (const entry of flatten(book.toc)) {
      expect(entry.anchor).not.toBeNull()
      expect(idsOf(book.chapters[entry.chapterIndex]!.html).has(entry.anchor!), entry.label).toBe(true)
    }
  })

  it('titles chapters from the TOC, then headings, then <title>', () => {
    const titles = book.chapters.map(chapter => chapter.title)
    expect(titles[0]).toBe('Cover')
    expect(titles[7]).toBe('I THE SCIENTIFIC LITERATURE ON THE PROBLEMS OF THE DREAM')
    expect(titles[8]).toBe('II METHOD OF DREAM INTERPRETATION')
    // Not in the TOC and without a heading (the second half of chapter V; the end of the index with the
    // footnotes): their <title>.
    expect(titles[12]).toBe('V THE MATERIAL AND SOURCES OF DREAMS')
    expect(titles[19]).toBe('INDEX')
  })

  it('contains nothing executable and nothing outside the allowlist', () => {
    for (const chapter of book.chapters) {
      expect(chapter.html).not.toMatch(/<script/i)
      expect(chapter.html).not.toMatch(/style=/i)
      expect(chapter.html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i)
      expect(chapter.html).not.toMatch(/<link|<meta|<svg/i)
      expectAllowlisted(chapter.html)
    }
  })

  it('inlines every image as a data: URL, the svg-wrapped cover included', () => {
    let images = 0
    for (const chapter of book.chapters) {
      for (const image of Array.from(fragment(chapter.html).querySelectorAll('img'))) {
        images += 1
        expect(image.getAttribute('src')).toMatch(/^data:image\//)
      }
    }
    expect(images).toBe(4) // the cover + three figures
    expect(fragment(book.chapters[0]!.html).querySelector('img')?.getAttribute('src')).toBe(book.cover)
  })

  it('rewrites every internal link to an id that exists in the chapter it names', () => {
    const audit = auditInternalLinks(book)
    console.info(`[epub-book] Freud internal links: ${audit.total} total, ${audit.resolved} resolve `
      + `(${audit.toChapterStart} to a chapter start), ${audit.unresolved.length} do not`
      + (audit.unresolved.length ? `: ${JSON.stringify(audit.unresolved.slice(0, 10))}` : ''))
    expect(audit.total).toBeGreaterThan(2000)
    expect(audit.unresolved).toEqual([])
    // The external links stay external.
    const external = book.chapters.flatMap(chapter => Array.from(fragment(chapter.html).querySelectorAll('a[data-rd-external]')))
    expect(external.length).toBeGreaterThan(0)
    for (const anchor of external) expect(anchor.getAttribute('href')).toMatch(/^https:\/\/www\.gutenberg\.org/)
  })

  it('turns the printed-page markers into empty rd-pagenum spans, in increasing order', () => {
    const pages = printedPages(book)
    expect(pages.length).toBe(518)
    const numbers = pages.map(page => page.page).filter(page => /^\d+$/.test(page)).map(Number)
    expect(numbers[0]).toBe(1)
    for (let index = 1; index < numbers.length; index += 1) expect(numbers[index]).toBeGreaterThan(numbers[index - 1]!)
    for (const page of pages) {
      const marker = fragment(book.chapters[page.chapterIndex]!.html).querySelector(`[id="${page.anchor}"]`)
      expect(marker?.className).toBe('rd-pagenum')
      expect(marker?.getAttribute('data-page')).toBe(page.page)
      expect(marker?.childNodes.length).toBe(0)
    }
    expect(pages.find(page => page.page === '1')?.anchor).toBe(readerAnchorId(7, 'Page_1'))
    for (const chapter of book.chapters) expect(chapter.html).not.toMatch(/\[Pg\s/)
  })

  it('keeps the text of chapter I', () => {
    const chapter = book.chapters.find(candidate => candidate.title.startsWith('I THE SCIENTIFIC LITERATURE'))!
    const text = textOf(chapter.html)
    expect(text).toContain('In the following pages I shall prove that there exists a psychological technique by which dreams may be interpreted')
    expect(text).toContain('The first book in which the dream is treated as an object of psychology seems to be that of Aristotle')
    expect(chapter.wordCount).toBeGreaterThan(30000)
    // The XHTML's empty anchor <a id="rD"/> stays empty (an HTML parse would make it swallow the footnote call).
    expect(chapter.html).toContain(`<a id="${readerAnchorId(7, 'rD')}"></a>`)
  })

  it('reads XML empty elements as empty: the header\'s <div/> does not swallow the transcriber\'s note', () => {
    expect(book.chapters[1]!.html).toContain('</header><div></div>\n<div class="tnotes covernote">')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Small EPUBs

describe('readEpubBook — an EPUB3 with a nested nav', () => {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="es">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:4b1e6a1e-0000-4000-8000-000000000001</dc:identifier>
    <dc:title>Ficciones de prueba</dc:title>
    <dc:creator>Jorge Luis Borges</dc:creator>
    <dc:creator>Second Author</dc:creator>
    <dc:language>es</dc:language>
    <dc:publisher>Sur</dc:publisher>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/three.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="notes" linear="no"/>
    <itemref idref="c3"/>
  </spine>
</package>`
  const nav = xhtml('Índice', `
<nav epub:type="landmarks"><ol><li><a href="text/one.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc" id="toc"><h1>Índice</h1>
  <ol>
    <li><span>Primera parte</span>
      <ol>
        <li><a href="text/one.xhtml">Tlön, Uqbar</a>
          <ol>
            <li><a href="text/one.xhtml#s1">I</a></li>
            <li><a href="text/one.xhtml#s%202">II</a></li>
          </ol>
        </li>
        <li><a href="text/two.xhtml#top">El jardín de senderos</a></li>
      </ol>
    </li>
    <li><a href="text/three.xhtml">La biblioteca</a></li>
  </ol>
</nav>`, 'es')
  const files = {
    'OEBPS/package.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/images/cover.png': PNG,
    'OEBPS/text/one.xhtml': xhtml('one', `<h1>Tlön</h1><p id="s1">Primero.</p><p id="s 2">Segundo, <a href="two.xhtml#top">al jardín</a> y <a href="#s1">atrás</a>.</p><img src="../images/cover.png" alt="mapa"/>`, 'es'),
    'OEBPS/text/two.xhtml': xhtml('two', `<h2 id="top">El jardín</h2><p>Texto <a href="notes.xhtml#n1" epub:type="noteref">1</a> y <a href="three.xhtml">la biblioteca</a>.</p>`, 'es'),
    'OEBPS/text/notes.xhtml': xhtml('Notas', `<aside id="n1" epub:type="footnote"><p>Una nota.</p></aside>`, 'es'),
    'OEBPS/text/three.xhtml': xhtml('three', `<p>Sin encabezado.</p>
<epub:switch id="eq"><epub:case required-namespace="http://www.w3.org/1998/Math/MathML"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></epub:case><epub:default><p class="eq">x al cuadrado</p></epub:default></epub:switch>`, 'es'),
  }

  let book: ReaderBook
  beforeAll(async () => { book = await readEpubBook(buildEpub('OEBPS/package.opf', files), 'ficciones.epub') })

  it('reads metadata and the EPUB3 cover-image', () => {
    expect(book).toMatchObject({ title: 'Ficciones de prueba', author: 'Jorge Luis Borges', language: 'es', publisher: 'Sur', version: '3.0' })
    expect(book.cover).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
  })

  it('keeps the nav nesting, a heading-only entry, fragment anchors, and ignores the landmarks nav', () => {
    expect(book.tocSource).toBe('nav')
    expect(book.toc).toHaveLength(2)
    const [part, library] = book.toc
    expect(part).toMatchObject({ label: 'Primera parte', chapterIndex: 0, anchor: null })
    expect(part!.children.map(child => child.label)).toEqual(['Tlön, Uqbar', 'El jardín de senderos'])
    const tlon = part!.children[0]!
    expect(tlon).toMatchObject({ chapterIndex: 0, anchor: null })
    expect(tlon.children).toEqual([
      { label: 'I', chapterIndex: 0, anchor: readerAnchorId(0, 's1'), children: [] },
      { label: 'II', chapterIndex: 0, anchor: readerAnchorId(0, 's 2'), children: [] },
    ])
    expect(part!.children[1]).toMatchObject({ chapterIndex: 1, anchor: readerAnchorId(1, 'top') })
    expect(library).toMatchObject({ label: 'La biblioteca', chapterIndex: 3, anchor: null })
    for (const entry of flatten(book.toc)) {
      if (entry.anchor) expect(idsOf(book.chapters[entry.chapterIndex]!.html).has(entry.anchor)).toBe(true)
    }
  })

  it('includes the non-linear spine item in spine order and titles chapters', () => {
    expect(book.chapters.map(chapter => [chapter.id, chapter.linear])).toEqual([['c1', true], ['c2', true], ['notes', false], ['c3', true]])
    // A heading-only TOC entry does not title a chapter; its linked child does.
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['Tlön, Uqbar', 'El jardín de senderos', 'Notas', 'La biblioteca'])
    expect(book.chapters[0]!.language).toBe('es')
  })

  it('rewrites links within and across chapters, and resolves images relative to the chapter', () => {
    const one = fragment(book.chapters[0]!.html)
    const [toTwo, back] = Array.from(one.querySelectorAll('a'))
    expect(toTwo!.getAttribute('href')).toBe(`#${readerAnchorId(1, 'top')}`)
    expect(toTwo!.getAttribute('data-rd-chapter')).toBe('1')
    expect(toTwo!.getAttribute('data-rd-anchor')).toBe(readerAnchorId(1, 'top'))
    expect(back!.getAttribute('href')).toBe(`#${readerAnchorId(0, 's1')}`)
    expect(back!.getAttribute('data-rd-chapter')).toBe('0')
    expect(one.querySelector('img')!.getAttribute('src')).toBe(book.cover)
    expect(one.querySelector('img')!.getAttribute('alt')).toBe('mapa')

    const two = fragment(book.chapters[1]!.html)
    const [note, library] = Array.from(two.querySelectorAll('a'))
    expect(note!.getAttribute('data-rd-chapter')).toBe('2')
    expect(note!.getAttribute('data-epub-type')).toBe('noteref')
    expect(library!.getAttribute('href')).toBe(`#${readerChapterId(3)}`)
    expect(library!.getAttribute('data-rd-anchor')).toBe('')
    expect(fragment(book.chapters[2]!.html).querySelector('aside')!.getAttribute('data-epub-type')).toBe('footnote')
    // epub:switch renders its epub:default fallback, never the epub:case content.
    expect(book.chapters[3]!.html).toContain('<p class="eq">x al cuadrado</p>')
    expect(book.chapters[3]!.html).not.toMatch(/<math|<mi|switch|case/)
    expect(auditInternalLinks(book).unresolved).toEqual([])
  })
})

describe('readEpubBook — an EPUB2 with an NCX', () => {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Book</dc:title>
    <dc:creator opf:role="aut">A. Writer</dc:creator>
    <dc:language>en-GB</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="Images/cover.png" media-type="image/png"/>
    <item id="ch1" href="Text/ch1.html" media-type="application/xhtml+xml"/>
    <item id="ch2" href="Text/ch2.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="x"/></head>
  <docTitle><text>Old Book</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>  Chapter
        One </text></navLabel>
      <content src="Text/ch1.html"/>
      <navPoint id="n1a" playOrder="2">
        <navLabel><text>A section</text></navLabel>
        <content src="Text/ch1.html#sec-a"/>
        <navPoint id="n1a1" playOrder="3">
          <navLabel><text>A subsection</text></navLabel>
          <content src="Text/ch1.html#sub"/>
        </navPoint>
      </navPoint>
    </navPoint>
    <navPoint id="n2" playOrder="4">
      <navLabel><text>Chapter Two</text></navLabel>
      <content src="Text/ch2.html#Page_13"/>
    </navPoint>
  </navMap>
</ncx>`
  // Gutenberg HTML's page markers, in two of their shapes, and an HTML-only entity (&nbsp;) in XHTML.
  const ch1 = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch1</title></head><body>
<p><span class="pagenum"><a id="Page_12">[Pg 12]</a></span>It was a dark night.</p>
<h2 id="sec-a">A section</h2>
<p id="sub">See <a href="ch2.html#Page_13">page 13</a>, <a href="#sec-a">above</a>, <a href="../Images/cover.png"><img src="../Images/cover.png" alt="cover"/></a>.</p>
<pre>
  indented</pre>
</body></html>`
  const ch2 = `<html><head><title>ch2</title></head><body>
<p><span class="pagenum" id="Page_13">[13]</span>Morning came&nbsp;at last.<br>
<a name="Page_14"></a><span class="pagenum">[Pg 14]</span>The end.</p>
<table><tr><th scope="col" colspan="2" style="color:red">Head</th></tr><tr><td rowspan="x2">a</td><td>b</td></tr></table>
</body></html>`
  let book: ReaderBook
  beforeAll(async () => {
    book = await readEpubBook(buildEpub('content.opf', {
      'content.opf': opf,
      'toc.ncx': ncx,
      'Images/cover.png': PNG,
      'Text/ch1.html': ch1,
      'Text/ch2.html': ch2,
    }), 'old-book.epub')
  })

  it('reads the EPUB2 cover meta and metadata', () => {
    expect(book).toMatchObject({ title: 'Old Book', author: 'A. Writer', language: 'en-GB', publisher: '', version: '2.0' })
    expect(book.cover).toMatch(/^data:image\/png;base64,/)
  })

  it('takes the nested TOC from the NCX navMap', () => {
    expect(book.tocSource).toBe('ncx')
    expect(book.toc).toEqual([
      {
        label: 'Chapter One', chapterIndex: 0, anchor: null, children: [
          {
            label: 'A section', chapterIndex: 0, anchor: readerAnchorId(0, 'sec-a'), children: [
              { label: 'A subsection', chapterIndex: 0, anchor: readerAnchorId(0, 'sub'), children: [] },
            ],
          },
        ],
      },
      { label: 'Chapter Two', chapterIndex: 1, anchor: readerAnchorId(1, 'Page_13'), children: [] },
    ])
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['Chapter One', 'Chapter Two'])
  })

  it('converts Gutenberg HTML page markers and keeps their ids as link targets', () => {
    expect(printedPages(book)).toEqual([
      { chapterIndex: 0, page: '12', anchor: readerAnchorId(0, 'Page_12') },
      { chapterIndex: 1, page: '13', anchor: readerAnchorId(1, 'Page_13') },
      { chapterIndex: 1, page: '14', anchor: readerAnchorId(1, 'rd-pg-0') },
    ])
    expect(book.chapters[0]!.html).toContain(`<span class="rd-pagenum" data-page="12" id="${readerAnchorId(0, 'Page_12')}"></span>It was a dark night.`)
    for (const chapter of book.chapters) expect(textOf(chapter.html)).not.toMatch(/\[(?:Pg )?1\d\]/)
    expect(fragment(book.chapters[1]!.html).textContent).toContain('Morning came\u00a0at last.')
    expect(idsOf(book.chapters[1]!.html).has(readerAnchorId(1, 'Page_14'))).toBe(true) // <a name="Page_14">
  })

  it('rewrites links, unlinks an image link, keeps <pre> text and table attributes', () => {
    const one = fragment(book.chapters[0]!.html)
    const [toPage, above, imageLink] = Array.from(one.querySelectorAll('a'))
    expect(toPage!.getAttribute('href')).toBe(`#${readerAnchorId(1, 'Page_13')}`)
    expect(toPage!.getAttribute('data-rd-chapter')).toBe('1')
    expect(above!.getAttribute('href')).toBe(`#${readerAnchorId(0, 'sec-a')}`)
    expect(imageLink!.hasAttribute('href')).toBe(false)
    expect(imageLink!.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(book.chapters[0]!.html).toContain('<pre>\n  indented</pre>')
    const th = fragment(book.chapters[1]!.html).querySelector('th')!
    expect([th.getAttribute('scope'), th.getAttribute('colspan'), th.hasAttribute('style')]).toEqual(['col', '2', false])
    expect(fragment(book.chapters[1]!.html).querySelector('td')!.hasAttribute('rowspan')).toBe(false)
    expect(auditInternalLinks(book).unresolved).toEqual([])
  })
})

describe('readEpubBook — a hostile chapter', () => {
  const hostileBody = `
<p onclick="alert(1)" style="background:url(javascript:alert(2))" class="ok rd-pagenum bad.class" id="p1">Plain words: javascript: is only text here, and so is &lt;script&gt;alert(0)&lt;/script&gt;.</p>
<script>alert(3)</script>
<script src="https://evil.example/x.js"/>
<img src="missing.png" onerror="alert(4)" alt="gone"/>
<img src="https://evil.example/pixel.png" alt="remote"/>
<img src="javascript:alert(5)" alt="js"/>
<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCg2KTwvc2NyaXB0Pg==" alt="data-html"/>
<a href="javascript:alert(7)">js link</a>
<a href=" JaVa&#x09;ScRiPt:alert(8)">tabbed js link</a>
<a href="data:text/html,&lt;script&gt;alert(9)&lt;/script&gt;">data link</a>
<a href="vbscript:msgbox(10)">vb link</a>
<a href="//evil.example/">protocol-relative</a>
<a href="https://example.org/ok" onmouseover="alert(11)" target="_top">fine external</a>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(12)"><script>alert(13)</script><text>svg words</text></svg>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext><style>*{}</style>math</mtext></math>
<iframe src="https://evil.example/" srcdoc="&lt;script&gt;alert(14)&lt;/script&gt;"></iframe>
<object data="x.swf"><embed src="x.swf"/></object>
<form action="https://evil.example/"><input name="q" autofocus="autofocus" onfocus="alert(15)"/><button formaction="https://evil.example/">go</button></form>
<details open="open" ontoggle="alert(16)"><summary>kept summary</summary>kept details</details>
<font color="red"><center>unwrapped center</center></font>
<video poster="x.png" onerror="alert(17)"><source src="x.mp4"/></video>
<noscript><p title="&lt;/noscript&gt;&lt;img src=x onerror=alert(18)&gt;">noscript</p></noscript>
<template><img src="x" onerror="alert(19)"/></template>
<base href="https://evil.example/"/>
<meta http-equiv="refresh" content="0;url=https://evil.example/"/>
<div title="&quot; onmouseover=&quot;alert(20)" lang="en&quot; onclick=&quot;x" dir="sideways">quoted title</div>
<ol start="3" reversed="reversed" type="i"><li>three</li></ol>
<p><a id="x" name="y" href="#p1" ping="https://evil.example/">self link</a></p>`

  it('emits none of it, as XHTML and as HTML', async () => {
    for (const [label, chapter, href] of [
      ['xhtml', xhtml('Hostile', hostileBody), 'hostile.xhtml'],
      // Not well formed (an unclosed <br>): read as HTML.
      ['html', `<html><head><title>Hostile</title></head><body><br>${hostileBody}</body></html>`, 'hostile.html'],
    ] as const) {
      const bytes = buildEpub('package.opf', {
        'package.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Hostile</dc:title></metadata>
<manifest><item id="h" href="${href}" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="h"/></spine></package>`,
        [href]: chapter,
      })
      const book = await readEpubBook(bytes, 'hostile.epub')
      const html = book.chapters[0]!.html
      expect(html, label).not.toMatch(/<script|<iframe|<object|<embed|<form|<input|<button|<svg|<math|<style|<video|<source|<template|<noscript|<base|<meta|<link|<font|<center|<details/i)
      // Attribute values are always double-quoted with `"` escaped, so blanking them leaves only names and tags.
      const markup = html.replace(/="[^"]*"/g, '=""')
      expect(markup, label).not.toMatch(/<[^>]*\s(?:on[a-z]+|style|srcdoc|action|formaction|ping|target|poster|name|type)\s*=/i)
      expect(html, label).not.toMatch(/(?:href|src)="\s*(?:javascript|vbscript|data:text)/i)
      expect(html, label).not.toContain('evil.example')
      expect(html, label).not.toContain('alert(1')
      expectAllowlisted(html)

      const body = fragment(html)
      expect(body.querySelectorAll('img[src]').length, label).toBe(0)
      expect(Array.from(body.querySelectorAll('img')).map(image => image.getAttribute('alt')), label).toEqual(['gone', 'remote', 'js', 'data-html'])
      expect(Array.from(body.querySelectorAll('a[href]')).map(anchor => anchor.getAttribute('href')), label)
        .toEqual(['https://example.org/ok', `#${readerAnchorId(0, 'p1')}`])
      expect(body.querySelector('a[data-rd-external]')?.getAttribute('rel'), label).toBe('noopener noreferrer')
      expect(body.querySelector('p')!.className, label).toBe('ok')
      const quoted = Array.from(body.querySelectorAll('div')).find(div => div.textContent === 'quoted title')!
      expect(quoted.getAttribute('title'), label).toBe('" onmouseover="alert(20)')
      expect([quoted.hasAttribute('lang'), quoted.hasAttribute('dir')], label).toEqual([false, false])
      expect(body.querySelector('ol')!.getAttribute('start'), label).toBe('3')
      expect(body.querySelector('ol')!.hasAttribute('reversed'), label).toBe(true)
      expect(body.querySelector(`a[id="${readerAnchorId(0, 'x')}"]`), label).not.toBeNull()

      // The text is the book's: kept, escaped, not rewritten.
      const text = textOf(html)
      expect(text, label).toContain('Plain words: javascript: is only text here, and so is <script>alert(0)</script>.')
      expect(text, label).toContain('kept summary')
      expect(text, label).toContain('unwrapped center')
      expect(text, label).not.toContain('svg words')
      expect(text, label).not.toContain('noscript')
    }
  })
})

describe('readEpubBook — no nav, no NCX', () => {
  it('makes one TOC entry per chapter, titled by heading, then <title>, then "Chapter N"', async () => {
    const book = await readEpubBook(buildEpub('book.opf', {
      'book.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>
<manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>`,
      'a.xhtml': xhtml('Title A', '<h3>Heading <span class="pagenum">[Pg 5]</span>A<br/>Line two</h3><p>x</p>'),
      'b.xhtml': xhtml('Title B', '<p>no heading</p>'),
      'c.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><h1> </h1><p>nothing</p></body></html>`,
    }), 'Untitled Thing.epub')
    expect(book.title).toBe('Untitled Thing')
    expect(book.tocSource).toBe('spine')
    expect(book.cover).toBeNull()
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['Heading A Line two', 'Title B', 'Chapter 3'])
    expect(book.toc).toEqual([
      { label: 'Heading A Line two', chapterIndex: 0, anchor: null, children: [] },
      { label: 'Title B', chapterIndex: 1, anchor: null, children: [] },
      { label: 'Chapter 3', chapterIndex: 2, anchor: null, children: [] },
    ])
    expect(book.chapters.map(chapter => chapter.wordCount)).toEqual([5, 2, 1])
  })

  it('makes an image or SVG spine item a chapter holding that picture', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    const book = await readEpubBook(buildEpub('p.opf', {
      'p.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>
<manifest><item id="plate" href="plate.png" media-type="image/png"/><item id="map" href="map.svg" media-type="image/svg+xml"/><item id="t" href="t.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="plate"/><itemref idref="map"/><itemref idref="t"/></spine></package>`,
      'plate.png': PNG,
      'map.svg': svg,
      't.xhtml': xhtml('Text', '<p>words</p>'),
    }), 'plates.epub')
    expect(book.chapters.map(chapter => chapter.html.match(/^<img src="data:(image\/[a-z+]+);base64,/)?.[1] ?? chapter.html.trim()))
      .toEqual(['image/png', 'image/svg+xml', '<p>words</p>'])
  })

  it('namespaces anchors per chapter', () => {
    expect(readerAnchorId(3, 'Page_12')).toBe('rd-c3-Page_12')
    expect(readerAnchorId(3, '')).toBe('rd-c3')
    expect(readerChapterId(0)).toBe('rd-c0')
  })
})
