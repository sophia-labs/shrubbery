import { describe, expect, it } from 'vitest'
import { readerAskText } from '../ask-text.js'

describe('readerAskText', () => {
  it('quotes a passage with its document and place', () => {
    expect(readerAskText({ quote: 'the  dream\nis a wish', scope: 'passage', where: 'page 12', title: 'The Interpretation of Dreams' }))
      .toBe('From "The Interpretation of Dreams", page 12:\n\n> the dream is a wish\n\n')
  })
  it('asks about a page or a chapter when nothing is selected', () => {
    expect(readerAskText({ quote: '', scope: 'page', where: 'page 3', title: 'Paper' })).toBe('About page 3 of "Paper": ')
    expect(readerAskText({ quote: '', scope: 'chapter', where: 'Preface', title: 'Book' })).toBe('About the chapter Preface of "Book": ')
  })
  it('keeps brackets out of the title and bounds the quote', () => {
    const text = readerAskText({ quote: 'x'.repeat(5000), scope: 'passage', where: 'ch. 1', title: '[[Odd]] title' })
    expect(text.startsWith('From "Odd title", ch. 1:')).toBe(true)
    expect(text.length).toBeLessThan(1300)
  })
})
