import { describe, expect, it } from 'vitest'
import type { WorkspaceComment } from '@shrubbery/runtime'
import { annotationRange, quoteTextIndex, readerColor, selectionQuote, type ReaderAnnotation } from '../reader-model.js'
import { readerAnnotationsFor } from '../reader-annotations.js'

const chapter = (html: string): HTMLElement => {
  const element = document.createElement('article')
  element.innerHTML = html
  document.body.replaceChildren(element)
  return element
}

const annotation = (quote: string, extra: Partial<ReaderAnnotation> = {}): ReaderAnnotation =>
  ({ id: 'a', kind: 'highlight', quote, color: 'yellow', ...extra })

describe('the Reader finds a quote in the text it shows', () => {
  it('turns a quote that spans markup and a line break into one range over those words', () => {
    const root = chapter('<p>Aristotle asserts that the dream is of <i>demoniacal</i>, though not\nof divine nature.</p>')
    const range = annotationRange(quoteTextIndex(root), annotation('dream is of demoniacal, though not of divine'))
    expect(range?.toString()).toBe('dream is of demoniacal, though not\nof divine')
  })

  it('forgives a copied quote: curly quotes, an em dash written as two hyphens, extra spaces', () => {
    const root = chapter('<p>He said “wait”—and the dream ended.</p>')
    expect(annotationRange(quoteTextIndex(root), annotation('said "wait"--and  the dream'))?.toString()).toBe('said “wait”—and the dream')
  })

  it('picks among repeats by the words around the quote', () => {
    const root = chapter('<p>The first dream was short.</p><p>Later, the dream was long and strange.</p>')
    const range = annotationRange(quoteTextIndex(root), annotation('the dream', { prefix: 'Later,', suffix: 'was long' }))
    expect(range?.startContainer.parentElement?.textContent).toContain('Later')
  })

  it('reports a quote that is not there as not found', () => {
    const root = chapter('<p>Nothing about sleep here.</p>')
    expect(annotationRange(quoteTextIndex(root), annotation('the hot iron'))).toBeNull()
  })

  it('reads a selection as its quote and the words around it', () => {
    const root = chapter('<p>In the following pages I shall prove that there exists a psychological technique.</p>')
    const text = root.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(text, text.data.indexOf('I shall'))
    range.setEnd(text, text.data.indexOf(' that'))
    expect(selectionQuote(root, range)).toEqual({ quote: 'I shall prove', prefix: 'In the following pages', suffix: 'that there exists a psychological technique.' })
  })
})

describe('a selection across the lines of a PDF text layer', () => {
  // pdf.js lays a page's text out as one span per run, with <br> between lines and nothing else: no space, no newline.
  const layer = (): HTMLElement => chapter(
    '<div class="textLayer"><span>Riddhi J. Pitliya1,6, Conor Heins1,7,8,9, Brennan Klein1,10, Beren Millidge1,11,</span><br>'
    + '<span>Dalton A.R. Sakthivadivel</span><span>†1,12,13,14, Toby St Clere Smithe1,6,15,</span></div>',
  )

  it('quotes the words with a space where the lines meet, and finds that quote again on the page', () => {
    const root = layer()
    const spans = root.querySelectorAll('span')
    const range = document.createRange()
    range.setStart(spans[0]!.firstChild!, spans[0]!.textContent!.indexOf('Brennan'))
    range.setEnd(spans[1]!.firstChild!, 'Dalton A.R.'.length)
    const quoted = selectionQuote(root, range)
    expect(quoted?.quote).toBe('Brennan Klein1,10, Beren Millidge1,11, Dalton A.R.')
    expect(quoted?.prefix).toBe('Riddhi J. Pitliya1,6, Conor Heins1,7,8,9,')
    expect(annotationRange(quoteTextIndex(root), annotation(quoted!.quote, quoted!))?.toString()).toBe('Brennan Klein1,10, Beren Millidge1,11,Dalton A.R.')
  })

  it('still finds a quote saved with the lines run together (as the first Reader stored them)', () => {
    const root = layer()
    expect(annotationRange(quoteTextIndex(root), annotation('Beren Millidge1,11,Dalton A.R. Sakthivadivel'))?.toString())
      .toBe('Beren Millidge1,11,Dalton A.R. Sakthivadivel')
  })
})

describe('the document\'s comments, as the Reader draws them', () => {
  const comment = (fields: Partial<WorkspaceComment> & Pick<WorkspaceComment, 'id'>): WorkspaceComment =>
    ({ author: 'You', text: '', createdAt: 0, resolved: false, ...fields })

  it('keeps a highlight\'s colour and page, and a person\'s note as theirs', () => {
    const drawn = readerAnnotationsFor([
      comment({ id: 'h', kind: 'highlight', quotedText: 'Designing Ecosystems', color: 'blue', anchor: { page: 1, prefix: '', suffix: 'of Intelligence' }, madeInReader: true }),
      comment({ id: 'n', text: 'the seed of the wager', quotedText: 'Aristotle asserts', color: 'green', anchor: { chapter: 7 }, madeInReader: true }),
    ], null)
    expect(drawn).toMatchObject([
      { id: 'h', kind: 'highlight', color: 'blue', place: { kind: 'page', page: 1 }, suffix: 'of Intelligence', mine: true, text: null },
      { id: 'n', kind: 'comment', color: 'green', place: { kind: 'chapter', chapterIndex: 7 }, text: 'the seed of the wager', mine: true },
    ])
  })

  it('shows an agent\'s finding under the name it gave, signed by the person who published it, and not theirs to recolour', () => {
    const [finding] = readerAnnotationsFor([
      comment({ id: 'f', author: 'Owner', claimedAuthor: 'Sleepers, catalogued', text: 'Sleeper: Giron', quotedText: 'He left his knee exposed' }),
    ], null)
    expect(finding).toMatchObject({ kind: 'comment', author: 'Sleepers, catalogued', signedBy: 'Owner', mine: false, color: 'yellow', place: null })
  })

  it('leaves out resolved comments and comments with no quote to place', () => {
    expect(readerAnnotationsFor([comment({ id: 'r', resolved: true, quotedText: 'x y' }), comment({ id: 'q', text: 'no quote' })], null)).toEqual([])
  })

  it('reads an unknown colour as yellow', () => {
    expect(readerColor('chartreuse')).toBe('yellow')
    expect(readerColor('pink')).toBe('pink')
  })
})
