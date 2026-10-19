/**
 * Comments drawn over an EPUB original by their quoted text, against the real
 * book: chapter I of Freud's *The Interpretation of Dreams* (Brill, 1913),
 * Project Gutenberg #66048, the EPUB the Freud demo imports
 * (`pg66048-images-3.epub`, sha256 90583955…a3309c). The fixture is that EPUB's
 * `OEBPS/45969567688998893_66048-h-6.htm.xhtml`, byte for byte
 * (sha256 bbdb7328…bb507f).
 *
 * The comments' block text below is the imported document's own block
 * (`block-c11fe9ee` in the demo graph): the import keeps the book's line
 * breaks, so the quote a comment stores has them too.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { documentQuoteState, quoteAnnotationsFor } from '../document-quote-sources.js'
import { OrganismOriginalFileController, type OriginalFileUrlApi } from '../original-file-controller.js'
import {
  markQuoteAnnotations,
  markToken,
  normalizeQuoteText,
  type SourceQuoteAnnotation,
} from '../source-quote-annotations.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHAPTER_ONE = readFileSync(join(HERE, 'fixtures/gutenberg-66048/chapter-1.xhtml'), 'utf8')

/** The imported document's block for the Meier paragraph, as gardend returns it. */
const MEIER_BLOCK = '“Meier (Versuch einer Erklärung des Nachtwandelns, Halle,\n1758, p. 33), once dreamed of being assaulted by several\npersons who threw him flat on the ground and drove a stake\ninto the ground between his big and second toes. While\nimagining this in his dream he suddenly awoke and felt a blade\nof straw sticking between his toes. The same author, according\nto Hemmings (Von den Traumen und Nachtwandeln,\nWeimar, 1784, p. 258) dreamed on another occasion that he\nwas being hanged when his shirt was pinned somewhat tight\naround his neck. Hauffbauer dreamed in his youth of having\nfallen from a high wall and found upon waking that the bedstead\nhad come apart, and that he had actually fallen to the\nfloor.... Gregory relates that he once applied a hot-water\nbottle to his feet, and dreamed of taking a trip to the summit\nof Mount Ætna, where he found the heat on the ground almost\nunbearable. After having applied a blistering plaster to his\nhead, a second man dreamed of being scalped by Indians; a\nthird, whose shirt was damp, dreamed of being dragged through\na stream. An attack of gout caused the patient to believe\nthat he was in the hands of the Inquisition, and suffering pains\nof torture (Macnish).”'

function chapterDocument(): Document {
  // The chapter's three stylesheet <link>s go: happy-dom's DOMParser would try to fetch them (a browser's does
  // not, and the viewer's cleaning pass removes them anyway). Nothing in the body is touched.
  return new DOMParser().parseFromString(CHAPTER_ONE.replace(/<link\b[^>]*>/g, ''), 'text/html')
}

function comment(id: string, quote: string, extra: Partial<SourceQuoteAnnotation> = {}): SourceQuoteAnnotation {
  return { id, kind: 'comment', quote, text: `Note on ${id}`, author: 'Vera', ...extra }
}

function marksOf(document: Document, id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('mark[data-annotation-ids]'))
    .filter(mark => (mark.getAttribute('data-annotation-ids') ?? '').split(' ').includes(markToken(id)))
}

/** The text a comment's marks cover, in document order, whitespace collapsed. */
function markedText(document: Document, id: string): string {
  return marksOf(document, id).map(mark => mark.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
}

describe('quote matching on the real chapter I XHTML', () => {
  it('marks a quote that crosses an inline title, leaving the title element whole', () => {
    const document = chapterDocument()
    const drawn = markQuoteAnnotations(document, [
      // <cite><span lang="de">Versuch einer Erklärung des Nachtwandelns</span></cite>
      comment('meier-cite', 'Meier (Versuch einer Erklärung des Nachtwandelns, Halle,\n1758, p. 33), once dreamed'),
      // “<i><span lang="fr">moi splanchnique</span></i>,”
      comment('moi', 'the essence of our being—the “moi splanchnique,” as\nTissié terms it'),
    ])

    expect([...drawn.keys()].sort()).toEqual(['meier-cite', 'moi'])
    expect(markedText(document, 'meier-cite')).toBe('Meier (Versuch einer Erklärung des Nachtwandelns, Halle, 1758, p. 33), once dreamed')
    expect(markedText(document, 'moi')).toBe('the essence of our being—the “moi splanchnique,” as Tissié terms it')
    // One mark per text node: before the title, inside it, after it. No element was split or moved.
    const citeMarks = marksOf(document, 'meier-cite')
    expect(citeMarks.length).toBe(3)
    const cite = citeMarks[1]!.closest('cite')
    expect(cite?.textContent).toBe('Versuch einer Erklärung des Nachtwandelns')
    expect(cite?.querySelector('span[lang="de"] > mark')).not.toBeNull()
    const italic = marksOf(document, 'moi').map(mark => mark.closest('i')).find(Boolean)
    expect(italic?.textContent).toBe('moi splanchnique')
    expect(document.querySelectorAll('cite').length).toBe(chapterDocument().querySelectorAll('cite').length)
    expect(document.querySelector('style[data-mn-quote-marks]')).not.toBeNull()
  })

  it('matches the book’s curly quotes and apostrophes from a comment typed with straight ones', () => {
    const document = chapterDocument()
    const drawn = markQuoteAnnotations(document, [
      comment('noise', '"Every indistinctly perceived noise gives rise to corresponding dream pictures'),
      comment('apostrophe', "to one's knowledge and experience"),
    ])

    expect(drawn.has('noise')).toBe(true)
    expect(drawn.has('apostrophe')).toBe(true)
    // The marks cover the book's own characters.
    expect(markedText(document, 'noise')).toBe('“Every indistinctly perceived noise gives rise to corresponding dream pictures')
    expect(markedText(document, 'apostrophe')).toBe('to one’s knowledge and experience')
  })

  it('reads an ellipsis as the book’s dots, or as an elision of the text between', () => {
    const document = chapterDocument()
    const drawn = markQuoteAnnotations(document, [
      // The book has "floor.... Gregory" (a full stop and three dots), split by an empty page-number span.
      comment('ellipsis-char', 'he had actually fallen to the floor… Gregory relates'),
      // The comment leaves out "into the ground".
      comment('elision', 'drove a stake ... between his big and second toes'),
      // A typeset ellipsis, spaced.
      comment('spaced', 'actually fallen to the floor . . . Gregory'),
    ])

    expect(drawn.has('ellipsis-char')).toBe(true)
    expect(drawn.has('elision')).toBe(true)
    expect(markedText(document, 'ellipsis-char')).toBe('he had actually fallen to the floor.... Gregory relates')
    expect(markedText(document, 'elision')).toBe('drove a stake into the ground between his big and second toes')
    expect(markedText(document, 'spaced')).toBe('actually fallen to the floor.... Gregory')
    expect(normalizeQuoteText('floor . . . Gregory')).toBe(normalizeQuoteText('floor … Gregory'))
  })

  it('uses the comment’s block to choose among repeats of a short quote', () => {
    const withContext = chapterDocument()
    markQuoteAnnotations(withContext, [comment('repeat', 'in his dream', { context: MEIER_BLOCK })])
    const marks = marksOf(withContext, 'repeat')
    expect(marks.length).toBe(1)
    expect(marks[0]!.closest('p')?.textContent).toContain('felt a blade\nof straw')

    // Without its block, "in his dream" lands on its first occurrence (ten in this chapter), elsewhere.
    const withoutContext = chapterDocument()
    markQuoteAnnotations(withoutContext, [comment('repeat', 'in his dream')])
    expect(marksOf(withoutContext, 'repeat')[0]!.closest('p')?.textContent).not.toContain('blade')
  })

  it('reports a quote that is not in the chapter instead of dropping it', () => {
    const document = chapterDocument()
    const drawn = markQuoteAnnotations(document, [
      comment('found', 'drove a stake\ninto the ground between his big and second toes'),
      // Chapter VII's phrase; it is not in chapter I.
      comment('missing', 'the royal road to a knowledge of the unconscious'),
    ])

    expect(drawn.has('found')).toBe(true)
    expect(drawn.has('missing')).toBe(false)
    expect(marksOf(document, 'missing')).toEqual([])
  })
})

function contract(): Pick<ShrubberyContract, 'auth' | 'runtime'> {
  return {
    auth: {
      token: () => 'local-key',
      userId: () => 'reader-user',
      isAuthenticated: () => true,
      whenReady: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    runtime: {
      mode: () => 'local',
      isGateway: () => false,
      graphBaseUrl: () => '/cell',
    },
  }
}

/** The book's real chapter I in an EPUB of its own (the container and package are the minimum EPUB requires). */
function chapterOneEpub(): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Interpretation of Dreams</dc:title></metadata><manifest><item id="item9" href="45969567688998893_66048-h-6.htm.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="item9"/></spine></package>'),
    'OEBPS/45969567688998893_66048-h-6.htm.xhtml': strToU8(CHAPTER_ONE),
  })
}

describe('the original viewer draws a document’s comments over its EPUB', () => {
  it('marks the chapter inside the frame’s own policy, escapes the comment, and reports what it could not find', async () => {
    const epub = chapterOneEpub()
    const urls: OriginalFileUrlApi = { createObjectURL: () => 'blob:chapter-one', revokeObjectURL: () => undefined }
    let renders = 0
    const controller = new OrganismOriginalFileController({
      requestRender: () => { renders += 1 },
      url: urls,
      fetch: async () => new Response(epub.slice().buffer, {
        status: 200,
        headers: { 'content-type': 'application/epub+zip', 'content-disposition': 'inline; filename="pg66048-images-3.epub"' },
      }),
    })
    controller.setScope(contract(), 'freud-dreams', 'doc-5ca098bcf9024343952d2789d060f543', {
      storageKey: 'local://artifacts/freud/original/pg66048-images-3.epub',
      originalFilename: 'pg66048-images-3.epub',
      mimeType: 'application/epub+zip',
      fileType: 'epub',
    })
    const hostile = '"><script>parent.alert(1)</script><img src=x onerror=alert(2)>'
    controller.setAnnotations([
      comment('comment-meier-stake', 'drove a stake\ninto the ground between his big and second toes', { context: MEIER_BLOCK, text: hostile }),
      comment('comment-royal-road', 'the royal road to a knowledge of the unconscious'),
    ])
    await controller.toggle()

    const view = controller.snapshot()
    expect(view.status).toBe('ready')
    expect(view.annotationSupport).toBe('display')
    expect(view.annotations.map(item => [item.id, item.anchor, item.chapterId])).toEqual([
      ['comment-meier-stake', 'found', 'item9'],
      ['comment-royal-road', 'not-found', null],
    ])
    expect(view.annotations[0]).toMatchObject({ kind: 'comment', author: 'Vera', body: hostile })

    const srcdoc = view.chapters[0]!.srcdoc ?? ''
    const framed = new DOMParser().parseFromString(srcdoc, 'text/html')
    // The policy stays the frame's first word; the marks and their style come after it.
    expect(framed.head.firstElementChild?.getAttribute('charset')).toBe('utf-8')
    expect(framed.head.children[1]?.getAttribute('content')).toBe("default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:")
    expect(framed.querySelectorAll('script, iframe, object, embed, link, base, form').length).toBe(0)
    expect(framed.querySelectorAll('[onerror], [onload]').length).toBe(0)
    expect(markedText(framed, 'comment-meier-stake')).toBe('drove a stake into the ground between his big and second toes')
    // The comment's words are an attribute value, never markup.
    expect(marksOf(framed, 'comment-meier-stake')[0]!.getAttribute('title')).toBe(`Vera: ${hostile}`)
    // Its quote mark is escaped, so it cannot close the attribute it is in.
    expect(srcdoc).not.toContain('"><script>')
    expect(marksOf(framed, 'comment-royal-road')).toEqual([])

    // The same comments again change nothing; a resolved or removed one is taken off.
    const before = renders
    controller.setAnnotations([
      comment('comment-meier-stake', 'drove a stake\ninto the ground between his big and second toes', { context: MEIER_BLOCK, text: hostile }),
      comment('comment-royal-road', 'the royal road to a knowledge of the unconscious'),
    ])
    expect(renders).toBe(before)
    controller.setAnnotations([])
    expect(renders).toBe(before + 1)
    expect(controller.snapshot().annotations).toEqual([])
    expect(controller.snapshot().chapters[0]!.srcdoc).not.toContain('<mark')
    controller.destroy()
  })
})

describe('the open document’s side: comments and highlights from its Y.Doc', () => {
  it('reads each block’s text and each highlighted run, and gives every unresolved comment its block', () => {
    // The imported Meier paragraph, as the editor stores it: a block element with a text whose runs carry marks.
    const doc = new Y.Doc()
    const content = doc.getXmlFragment('content')
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.setAttribute('data-block-id', 'block-c11fe9ee')
    const text = new Y.XmlText()
    paragraph.insert(0, [text])
    content.insert(0, [paragraph])
    text.insert(0, MEIER_BLOCK)
    const straw = MEIER_BLOCK.indexOf('felt a blade\nof straw')
    text.format(straw, 'felt a blade\nof straw'.length, { highlight: { color: null } })

    const state = documentQuoteState(doc)
    expect(state.blockText.get('block-c11fe9ee')).toBe(MEIER_BLOCK)
    expect(state.highlights).toEqual([
      { id: 'highlight:block-c11fe9ee:0', kind: 'highlight', quote: 'felt a blade\nof straw', context: MEIER_BLOCK },
    ])

    const annotations = quoteAnnotationsFor([
      { id: 'c-open', author: 'Vera', text: 'Straw', quotedText: 'in his dream', createdAt: 1, blockId: 'block-c11fe9ee' },
      { id: 'c-resolved', author: 'Vera', text: 'Done', quotedText: 'stake', createdAt: 2, resolved: true },
      { id: 'c-unquoted', author: 'Lucy', text: 'On the whole chapter', createdAt: 3 },
    ], state)
    expect(annotations.map(item => [item.id, item.kind, item.context === MEIER_BLOCK])).toEqual([
      ['c-open', 'comment', true],
      ['c-unquoted', 'comment', false],
      ['highlight:block-c11fe9ee:0', 'highlight', true],
    ])

    // Drawn on the real chapter: the comment lands in the Meier paragraph (not the first "in his dream"), the
    // highlight on the straw, and the comment with no quote is not drawn, so the viewer reports it.
    const chapter = chapterDocument()
    const drawn = markQuoteAnnotations(chapter, annotations)
    expect([...drawn.keys()].sort()).toEqual(['c-open', 'highlight:block-c11fe9ee:0'])
    expect(marksOf(chapter, 'c-open')[0]!.closest('p')?.textContent).toContain('blade')
    expect(markedText(chapter, 'highlight:block-c11fe9ee:0')).toBe('felt a blade of straw')
    expect(marksOf(chapter, 'highlight:block-c11fe9ee:0')[0]!.getAttribute('data-kind')).toBe('highlight')
  })
})
