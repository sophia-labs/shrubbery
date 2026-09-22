import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-zotero-library-panel.js'
import type {
  MnZoteroCollection,
  MnZoteroLibraryItem,
  MnZoteroLibraryOpenSourceDetail,
  MnZoteroLibraryPanel,
  MnZoteroLibrarySearchDetail,
  MnZoteroLibraryToggleCollectionDetail,
} from '../mn-zotero-library-panel.js'

const items: readonly MnZoteroLibraryItem[] = [
  { key: 'A1', title: 'Situated Cognition', creatorSummary: 'Brown et al.', year: '1989', itemType: 'journalArticle' },
  { key: 'B2', title: 'The Extended Mind', creatorSummary: 'Clark and Chalmers', year: '1998', itemType: 'article' },
]

const collections: readonly MnZoteroCollection[] = [
  { key: 'c-reading', name: 'Reading Notes', itemCount: 1 },
  { key: 'c-nested', name: 'Embodied Mind', parentKey: 'c-reading', itemCount: 1 },
]

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnZoteroLibraryPanel) => void): Promise<MnZoteroLibraryPanel> {
  const el = document.createElement('mn-zotero-library-panel') as MnZoteroLibraryPanel
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-zotero-library-panel', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders controlled browse data with collections and all items', async () => {
    const el = await mount(panel => {
      panel.collections = collections
      panel.expandedCollectionKeys = new Set(['c-reading', 'c-nested'])
      panel.collectionItems = new Map([['c-nested', [items[0]]]])
      panel.topItems = items
    })

    expect(customElements.get('mn-zotero-library-panel')).toBeDefined()
    expect(sr(el).querySelector('[data-zotero-library-panel]')).not.toBeNull()
    expect(Array.from(sr(el).querySelectorAll('[data-zotero-collection]')).map(row => [
      row.getAttribute('data-zotero-collection-key'),
      row.getAttribute('aria-expanded'),
      row.querySelector('.collection-name')?.textContent?.trim(),
    ])).toEqual([
      ['c-reading', 'true', 'Reading Notes'],
      ['c-nested', 'true', 'Embodied Mind'],
    ])
    expect(Array.from(sr(el).querySelectorAll('[data-zotero-item]')).map(row => [
      row.getAttribute('data-zotero-key'),
      row.querySelector('.title')?.textContent?.trim(),
      row.querySelector('.meta')?.textContent?.trim(),
    ])).toEqual([
      ['A1', 'Situated Cognition', 'Brown et al. - 1989'],
      ['A1', 'Situated Cognition', 'Brown et al. - 1989'],
      ['B2', 'The Extended Mind', 'Clark and Chalmers - 1998'],
    ])
  })

  it('renders search mode from shell-provided results and emits query intents', async () => {
    const el = await mount(panel => {
      panel.query = 'mind'
      panel.searchResults = [items[1]]
    })
    const searches: MnZoteroLibrarySearchDetail[] = []
    el.addEventListener('mn-zotero-library-search', event => {
      searches.push((event as CustomEvent<MnZoteroLibrarySearchDetail>).detail)
    })

    expect(Array.from(sr(el).querySelectorAll('[data-zotero-item]')).map(row => row.getAttribute('data-zotero-key'))).toEqual(['B2'])

    const input = sr(el).querySelector<HTMLInputElement>('[data-zotero-search]')!
    input.value = 'situated'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))

    expect(el.query).toBe('situated')
    expect(searches).toEqual([{ query: 'situated' }])
  })

  it('emits collection toggle intents instead of loading collection items itself', async () => {
    const el = await mount(panel => {
      panel.collections = collections
      panel.expandedCollectionKeys = []
    })
    const toggles: MnZoteroLibraryToggleCollectionDetail[] = []
    el.addEventListener('mn-zotero-library-toggle-collection', event => {
      toggles.push((event as CustomEvent<MnZoteroLibraryToggleCollectionDetail>).detail)
    })

    sr(el).querySelector<HTMLButtonElement>('[data-zotero-collection-key="c-reading"]')!.click()

    expect(toggles).toEqual([
      {
        key: 'c-reading',
        collection: collections[0],
        expanded: true,
      },
    ])
  })

  it('emits deterministic source-open detail for top, search, and collection rows', async () => {
    const el = await mount(panel => {
      panel.query = 'mind'
      panel.searchResults = [items[1]]
    })
    const opens: MnZoteroLibraryOpenSourceDetail[] = []
    el.addEventListener('mn-zotero-library-open-source', event => {
      opens.push((event as CustomEvent<MnZoteroLibraryOpenSourceDetail>).detail)
    })

    sr(el).querySelector<HTMLButtonElement>('[data-zotero-key="B2"]')!.click()

    el.query = ''
    el.topItems = [items[0]]
    el.collections = collections
    el.expandedCollectionKeys = new Set(['c-reading'])
    el.collectionItems = { 'c-reading': [items[1]] }
    await el.updateComplete

    sr(el).querySelector<HTMLButtonElement>('[data-zotero-key="A1"]')!.click()
    sr(el).querySelector<HTMLButtonElement>('[data-zotero-key="B2"]')!.click()

    expect(opens).toEqual([
      { item: items[1], zoteroKey: 'B2', artifactId: 'zot-B2', origin: 'search' },
      { item: items[0], zoteroKey: 'A1', artifactId: 'zot-A1', origin: 'top' },
      { item: items[1], zoteroKey: 'B2', artifactId: 'zot-B2', origin: 'collection', collectionKey: 'c-reading' },
    ])
  })

  it('renders controlled loading, searching, error, and empty states', async () => {
    const el = await mount(panel => {
      panel.loading = true
    })
    expect(sr(el).querySelector('.state')?.textContent).toBe('Loading...')

    el.loading = false
    el.error = 'Could not reach Zotero.'
    await el.updateComplete
    expect(sr(el).querySelector('.state.error')?.textContent).toBe('Could not reach Zotero.')

    el.query = 'missing'
    el.searching = true
    await el.updateComplete
    expect(sr(el).querySelector('.state')?.textContent).toBe('Searching...')

    el.searching = false
    await el.updateComplete
    expect(sr(el).querySelector('.state')?.textContent).toBe('No matches.')
  })
})
