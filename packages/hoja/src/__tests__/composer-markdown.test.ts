import { describe, expect, it } from 'vitest'

import {
  collectWikiLinkReferences,
  parseComposerMarkdown,
  serializeComposerMarkdown,
} from '../composer-markdown.js'
import type { HojaJSONContent, HojaWikiLinkReference } from '../types.js'

function nodes(document: HojaJSONContent, type: string): HojaJSONContent[] {
  const found: HojaJSONContent[] = []
  const visit = (node: HojaJSONContent): void => {
    if (node.type === type) found.push(node)
    for (const child of node.content ?? []) visit(child)
  }
  visit(document)
  return found
}

describe('Hoja composer Markdown seam', () => {
  it('round-trips paragraphs, visible hard breaks, and the supported rich marks', () => {
    const value = [
      'A **bold** thought with _care_, `code`, and [a source](https://example.test/a).',
      'Same chat paragraph.',
      '',
      'A second paragraph.',
    ].join('\n')

    const document = parseComposerMarkdown(value)

    expect(nodes(document, 'paragraph')).toHaveLength(2)
    expect(nodes(document, 'hardBreak')).toHaveLength(1)
    expect(nodes(document, 'text').flatMap(node => node.marks ?? []).map(mark => mark.type)).toEqual(
      expect.arrayContaining(['bold', 'italic', 'code', 'link']),
    )
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('canonicalizes star italic without losing the mark', () => {
    const document = parseComposerMarkdown('*softly*')
    expect(nodes(document, 'text')[0]?.marks?.[0]?.type).toBe('italic')
    expect(serializeComposerMarkdown(document)).toBe('_softly_')
  })

  it('escapes literal Markdown punctuation instead of manufacturing formatting', () => {
    const value = String.raw`literal \*asterisk\* and \[bracket\]`
    const document = parseComposerMarkdown(value)
    expect(nodes(document, 'text').map(node => node.text).join('')).toBe(
      'literal *asterisk* and [bracket]',
    )
    expect(serializeComposerMarkdown(document)).toBe(value)
  })

  it('does not turn an unsafe URL into a link mark', () => {
    const document = parseComposerMarkdown('[click](javascript:alert(1))')
    expect(nodes(document, 'text').flatMap(node => node.marks ?? [])).toHaveLength(0)
    expect(serializeComposerMarkdown(document)).toContain(String.raw`\[click\]`)
  })

  it('round-trips canonical [[label]] wikilinks with host-provided target attrs', () => {
    const references: readonly HojaWikiLinkReference[] = [
      {
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      },
      {
        label: 'A block',
        targetDocId: 'doc:notes',
        targetGraphId: 'sophia-code-lab',
        targetBlockId: 'block:42',
        blockPreview: 'The useful paragraph',
      },
    ]
    const value = 'Ask [[Living Codex]] about [[A block]].'

    const document = parseComposerMarkdown(value, references)

    expect(serializeComposerMarkdown(document)).toBe(value)
    expect(collectWikiLinkReferences(document)).toEqual([
      { ...references[0], targetBlockId: null, blockPreview: null },
      references[1],
    ])
    expect(nodes(document, 'wikilink').map(node => node.attrs)).toEqual([
      expect.objectContaining({
        label: 'Living Codex',
        targetDocId: 'doc:living-codex',
        targetGraphId: 'sophia-code-lab',
      }),
      expect.objectContaining({
        label: 'A block',
        targetDocId: 'doc:notes',
        targetBlockId: 'block:42',
      }),
    ])
  })

  it('keeps unresolved [[label]] honest and never invents graph ids', () => {
    const document = parseComposerMarkdown('Look at [[Unresolved]].')

    expect(serializeComposerMarkdown(document)).toBe('Look at [[Unresolved]].')
    expect(collectWikiLinkReferences(document)).toEqual([
      {
        label: 'Unresolved',
        targetDocId: null,
        targetGraphId: null,
        targetBlockId: null,
        blockPreview: null,
      },
    ])
  })

  it('binds repeated labels in occurrence order rather than conflating them', () => {
    const bindings: readonly HojaWikiLinkReference[] = [
      { label: 'Notes', targetDocId: 'doc:one', targetGraphId: 'graph:a' },
      { label: 'Notes', targetDocId: 'doc:two', targetGraphId: 'graph:b' },
    ]
    const document = parseComposerMarkdown('[[Notes]] then [[Notes]]', bindings)

    expect(collectWikiLinkReferences(document).map(reference => reference.targetDocId)).toEqual([
      'doc:one',
      'doc:two',
    ])
  })
})
