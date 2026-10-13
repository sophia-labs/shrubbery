import { describe, expect, it } from 'vitest'

import { parsePageMarkdown, serializePageMarkdown } from '../page-markdown.js'

describe('Hoja page Markdown fallback', () => {
  it('restores headings, paragraph indent, and wikilink targets from a Markdown-only seed', () => {
    const source = '# Field notes\n\n  Return to [[First light]].'
    const document = parsePageMarkdown(source, [{ label: 'First light', targetDocId: 'first-light', targetGraphId: null }])

    expect(document.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(document.content?.[1]).toMatchObject({ type: 'paragraph', attrs: { indent: 1 } })
    expect(document.content?.[1]?.content?.some(node =>
      node.type === 'wikilink' && node.attrs?.targetDocId === 'first-light',
    )).toBe(true)
    expect(serializePageMarkdown(document)).toBe(source)
  })
})
