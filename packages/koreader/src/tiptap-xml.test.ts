import { describe, expect, it } from 'vitest'
import type { ReaderDocument } from './model.js'
import { readerDocumentFromTiptapXml } from './tiptap-xml.js'

const document: ReaderDocument = {
  id: 'doc-xml',
  graphId: 'garden-xml',
  title: 'An actual Garden document',
  revision: 7,
  readOnly: false,
  blocks: [],
}

describe('readerDocumentFromTiptapXml', () => {
  it('projects canonical Garden XML into stable reader blocks and UTF-16 marks', () => {
    const projected = readerDocumentFromTiptapXml(document, `
      <heading data-block-id="heading-1" level="1">A Message from Sophia</heading>
      <paragraph data-block-id="paragraph-1">Hello, <bold>curious 🌱 human</bold>!</paragraph>
      <horizontalRule data-block-id="rule-1"></horizontalRule>
      <listItem data-block-id="list-1" indent="1" listType="bullet">
        <paragraph data-block-id="nested-1"><italic>Real</italic> document content</paragraph>
      </listItem>
      <blockquote data-block-id="quote-1">
        <paragraph data-block-id="nested-2">The cheese looked through me.</paragraph>
      </blockquote>
    `)

    expect(projected.blocks.map(({ id, type, text }) => ({ id, type, text }))).toEqual([
      { id: 'heading-1', type: 'heading', text: 'A Message from Sophia' },
      { id: 'paragraph-1', type: 'paragraph', text: 'Hello, curious 🌱 human!' },
      { id: 'rule-1', type: 'divider', text: '' },
      { id: 'list-1', type: 'bullet', text: 'Real document content' },
      { id: 'quote-1', type: 'quote', text: 'The cheese looked through me.' },
    ])
    expect(projected.blocks[0].level).toBe(1)
    expect(projected.blocks[1].marks).toEqual([
      { type: 'bold', start: 7, end: 23 },
    ])
    expect(projected.blocks[3].level).toBe(2)
    expect(projected.blocks[3].marks).toEqual([
      { type: 'italic', start: 0, end: 4 },
    ])
  })

  it('understands list containers, links, tasks and code nested in quotes', () => {
    const projected = readerDocumentFromTiptapXml(document, `
      <doc>
        <orderedList>
          <listItem data-block-id="ordered-1"><paragraph>Visit <link href="https://example.com">the source</link>.</paragraph></listItem>
        </orderedList>
        <taskList>
          <taskItem checked="true" data-block-id="task-1"><paragraph>Read it</paragraph></taskItem>
        </taskList>
        <blockquote data-block-id="quote-code"><codeBlock language="text">Garden → Reader</codeBlock></blockquote>
      </doc>
    `)
    expect(projected.blocks.map((block) => block.type)).toEqual(['numbered', 'todo', 'quote'])
    expect(projected.blocks[0].marks).toEqual([
      { type: 'link', start: 6, end: 16, href: 'https://example.com' },
    ])
    expect(projected.blocks[1].checked).toBe(true)
    expect(projected.blocks[2].marks).toEqual([
      { type: 'code', start: 0, end: 15 },
    ])
  })

  it('refuses malformed, active or oversized XML', () => {
    expect(() => readerDocumentFromTiptapXml(document, '<paragraph>broken')).toThrow(
      'Invalid TipTap XML',
    )
    expect(() => readerDocumentFromTiptapXml(document, '<!DOCTYPE doc><paragraph>x</paragraph>'))
      .toThrow('doctype')
    expect(() => readerDocumentFromTiptapXml(document, '<?work x?><paragraph>x</paragraph>'))
      .toThrow('processing instructions')
    expect(() => readerDocumentFromTiptapXml(document, 'x'.repeat(8 * 1024 * 1024 + 1)))
      .toThrow('exceeds')
  })
})
