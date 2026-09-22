import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-citation-picker.js'
import type {
  MnCitationItem,
  MnCitationPickDetail,
  MnCitationPicker,
  MnCitationSearchDetail,
} from '../mn-citation-picker.js'

const items: readonly MnCitationItem[] = [
  {
    key: 'A1',
    title: 'Situated Cognition',
    citation: 'Brown, Collins, and Duguid (1989)',
    itemType: 'journalArticle',
  },
  {
    key: 'B2',
    title: 'The Extended Mind',
    citation: 'Clark and Chalmers (1998)',
    itemType: 'article',
  },
]

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnCitationPicker) => void): Promise<MnCitationPicker> {
  const el = document.createElement('mn-citation-picker') as MnCitationPicker
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-citation-picker', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders controlled Zotero-style citation results', async () => {
    const el = await mount(picker => {
      picker.query = 'mind'
      picker.results = items
    })

    expect(customElements.get('mn-citation-picker')).toBeDefined()
    expect(sr(el).querySelector('[data-citation-picker]')).not.toBeNull()
    expect((sr(el).querySelector('[data-citation-search]') as HTMLInputElement).value).toBe('mind')
    expect(Array.from(sr(el).querySelectorAll('[data-citation-row]')).map(row => [
      row.getAttribute('data-citation-key'),
      row.querySelector('.title')?.textContent?.trim(),
      row.querySelector('.meta')?.textContent?.trim(),
    ])).toEqual([
      ['A1', 'Situated Cognition', 'Brown, Collins, and Duguid (1989) - journalArticle'],
      ['B2', 'The Extended Mind', 'Clark and Chalmers (1998) - article'],
    ])
    expect(sr(el).querySelector('[data-citation-key="A1"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('emits search intents without owning Zotero transport', async () => {
    const el = await mount()
    const searches: MnCitationSearchDetail[] = []
    el.addEventListener('mn-citation-search', event => {
      searches.push((event as CustomEvent<MnCitationSearchDetail>).detail)
    })

    const input = sr(el).querySelector<HTMLInputElement>('[data-citation-search]')!
    input.value = 'embodied'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))

    expect(el.query).toBe('embodied')
    expect(searches).toEqual([{ query: 'embodied' }])
  })

  it('supports keyboard selection, pick intent, and close aliases', async () => {
    const el = await mount(picker => {
      picker.query = 'mind'
      picker.results = items
    })
    const picks: MnCitationPickDetail[] = []
    const closed: string[] = []
    el.addEventListener('mn-citation-pick', event => {
      picks.push((event as CustomEvent<MnCitationPickDetail>).detail)
    })
    el.addEventListener('close', () => closed.push('close'))
    el.addEventListener('mn-close', () => closed.push('mn-close'))

    sr(el)
      .querySelector<HTMLElement>('[data-citation-picker]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(sr(el).querySelector('[data-citation-key="B2"]')?.getAttribute('aria-selected')).toBe('true')

    sr(el)
      .querySelector<HTMLElement>('[data-citation-picker]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(picks).toEqual([{ item: items[1] }])
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close', 'mn-close'])
  })

  it('renders loading, empty, and error states from controlled props', async () => {
    const el = await mount(picker => {
      picker.query = 'source'
      picker.loading = true
    })
    expect(sr(el).querySelector('.state')?.textContent).toBe('Searching...')

    el.loading = false
    el.results = []
    await el.updateComplete
    expect(sr(el).querySelector('.state')?.textContent).toBe('No matches.')

    el.error = 'Could not reach Zotero.'
    await el.updateComplete
    expect(sr(el).querySelector('.state')?.textContent).toBe('Could not reach Zotero.')
  })

  it('Escape and the close button close the modal', async () => {
    const el = await mount()
    const closed: string[] = []
    el.addEventListener('mn-close', () => closed.push('mn-close'))

    sr(el)
      .querySelector<HTMLElement>('[data-citation-picker]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['mn-close'])

    el.open = true
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('[data-citation-close]')!.click()
    expect(el.open).toBe(false)
    expect(closed).toEqual(['mn-close', 'mn-close'])
  })
})
