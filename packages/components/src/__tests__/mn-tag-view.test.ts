/**
 * REAL component test — mn-tag-view read-only lens.
 *
 * The element is controlled data in, composed intents out. It does not know how
 * to query a cell or open a document by itself.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-tag-view.js'
import type {
  MnTagView,
  MnTagViewBlock,
  MnTagViewOpenBlockDetail,
  MnTagViewRefreshDetail,
} from '../mn-tag-view.js'

async function mount(setup?: (el: MnTagView) => void): Promise<MnTagView> {
  const el = document.createElement('mn-tag-view') as MnTagView
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnTagView) => el.shadowRoot!

const blocks: readonly MnTagViewBlock[] = [
  {
    id: 'doc-a:block-1',
    documentId: 'doc-a',
    documentTitle: 'Garden plan',
    blockId: 'block-1',
    text: 'First tagged block',
    type: 'paragraph',
  },
  {
    id: 'doc-a:block-2',
    documentId: 'doc-a',
    documentTitle: 'Garden plan',
    blockId: 'block-2',
    text: 'Second tagged block',
  },
  {
    id: 'doc-b:block-3',
    documentId: 'doc-b',
    documentTitle: 'Wire notes',
    blockId: 'block-3',
    text: 'Cross-document tag match',
  },
]

describe('mn-tag-view — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-tag-view')).toBeDefined()
  })

  it('renders loading, empty, and error states from controlled props', async () => {
    const el = await mount((node) => {
      node.tag = 'pragma'
      node.status = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()

    el.status = 'ready'
    el.blocks = []
    await el.updateComplete
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No blocks tagged #pragma')

    el.status = 'error'
    el.error = 'SPARQL failed'
    await el.updateComplete
    const empty = sr(el).querySelector('mn-empty-state')!
    expect(empty.getAttribute('title')).toBe('Could not load #pragma')
    expect(empty.getAttribute('description')).toBe('SPARQL failed')
  })

  it('groups ready blocks by source document and renders stable row ids', async () => {
    const el = await mount((node) => {
      node.tag = '#pragma'
      node.status = 'ready'
      node.blocks = blocks
    })

    expect(sr(el).querySelector('.title')?.textContent).toBe('#pragma')
    expect(Array.from(sr(el).querySelectorAll('.group')).map((group) => group.getAttribute('data-document-id'))).toEqual([
      'doc-a',
      'doc-b',
    ])
    expect(Array.from(sr(el).querySelectorAll('.group-title')).map((n) => n.textContent)).toEqual([
      'Garden plan',
      'Wire notes',
    ])
    expect(Array.from(sr(el).querySelectorAll('.block-row')).map((row) => row.getAttribute('data-block-id'))).toEqual([
      'block-1',
      'block-2',
      'block-3',
    ])
  })

  it('emits refresh and open-block intents without performing host work itself', async () => {
    const el = await mount((node) => {
      node.tag = 'pragma'
      node.status = 'ready'
      node.blocks = blocks
    })
    const refreshes: MnTagViewRefreshDetail[] = []
    const opens: MnTagViewOpenBlockDetail[] = []
    el.addEventListener('mn-tag-view-refresh', (event) => {
      refreshes.push((event as CustomEvent<MnTagViewRefreshDetail>).detail)
    })
    el.addEventListener('mn-tag-view-open-block', (event) => {
      opens.push((event as CustomEvent<MnTagViewOpenBlockDetail>).detail)
    })

    ;(sr(el).querySelector('[aria-label="Refresh tag"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-block-id="block-2"]') as HTMLButtonElement).click()

    expect(refreshes).toEqual([{ tagName: 'pragma' }])
    expect(opens).toEqual([
      {
        tagName: 'pragma',
        documentId: 'doc-a',
        blockId: 'block-2',
        block: blocks[1],
      },
    ])
  })
})
