import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-wikilink-picker.js'
import type {
  MnWikiLinkPicker,
  MnWikiLinkPickerPhaseRequestDetail,
  MnWikiLinkPickerQueryDetail,
  MnWikiLinkPickerSelectDetail,
} from '../mn-wikilink-picker.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnWikiLinkPicker) => void): Promise<MnWikiLinkPicker> {
  const el = document.createElement('mn-wikilink-picker') as MnWikiLinkPicker
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-wikilink-picker', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders Garden document candidates with stable picker hooks', async () => {
    const el = await mount(picker => {
      picker.query = 'arch'
      picker.documents = [
        { id: 'doc-architecture', label: 'Architecture', type: 'document' },
        { id: 'doc-arch-notes', label: 'Arch Notes', type: 'document' },
      ]
    })

    expect(customElements.get('mn-wikilink-picker')).toBeDefined()
    expect(sr(el).querySelector('[data-wikilink-picker]')).not.toBeNull()
    expect((sr(el).querySelector('[data-wikilink-search]') as HTMLInputElement).value).toBe('arch')
    expect(
      Array.from(sr(el).querySelectorAll('[data-wikilink-candidate]')).map(node => [
        node.getAttribute('data-doc-id'),
        node.textContent?.trim(),
      ]),
    ).toEqual([
      ['doc-architecture', 'Architecture'],
      ['doc-arch-notes', 'Arch Notes'],
    ])
    expect(sr(el).querySelector('[data-wikilink-candidate]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('navigates by keyboard and emits selected document detail', async () => {
    const el = await mount(picker => {
      picker.documents = [
        { id: 'doc-architecture', label: 'Architecture', type: 'document' },
        { id: 'doc-billing', label: 'Billing', type: 'document' },
      ]
    })
    const selected: MnWikiLinkPickerSelectDetail[] = []
    el.addEventListener('mn-wikilink-select', event => {
      selected.push((event as CustomEvent<MnWikiLinkPickerSelectDetail>).detail)
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(
      sr(el).querySelectorAll('[data-wikilink-candidate]')[1]?.getAttribute('aria-selected'),
    ).toBe('true')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(selected).toEqual([
      {
        document: { id: 'doc-billing', label: 'Billing', type: 'document' },
      },
    ])
  })

  it('emits query and phase request intents without doing shell work', async () => {
    const el = await mount(picker => {
      picker.documents = [{ id: 'doc-architecture', label: 'Architecture', type: 'document' }]
    })
    const queries: MnWikiLinkPickerQueryDetail[] = []
    const phases: MnWikiLinkPickerPhaseRequestDetail[] = []
    el.addEventListener('mn-wikilink-query', event => {
      queries.push((event as CustomEvent<MnWikiLinkPickerQueryDetail>).detail)
    })
    el.addEventListener('mn-wikilink-phase-request', event => {
      phases.push((event as CustomEvent<MnWikiLinkPickerPhaseRequestDetail>).detail)
    })

    const input = sr(el).querySelector('[data-wikilink-search]') as HTMLInputElement
    input.value = 'billing'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    expect(queries).toEqual([{ query: 'billing', phase: 'document' }])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(phases).toEqual([
      {
        phase: 'block',
        document: { id: 'doc-architecture', label: 'Architecture', type: 'document' },
        block: undefined,
      },
    ])
  })

  it('renders block and predicate phases from controlled data', async () => {
    const el = await mount(picker => {
      picker.phase = 'block'
      picker.selectedDocument = { id: 'doc-architecture', label: 'Architecture', type: 'document' }
      picker.blocks = [
        { id: 'block-h1', type: 'heading', level: 1, text: 'Overview', preview: 'Overview' },
        { id: 'block-p', type: 'paragraph', text: 'Longer paragraph', preview: 'Longer paragraph...' },
      ]
    })

    // A block row is its text once: no type icon, no H badge, no preview line
    // repeating the same words (2026-10-14). Headings go by weight.
    const heading = sr(el).querySelector('[data-block-id="block-h1"]')!
    const paragraph = sr(el).querySelector('[data-block-id="block-p"]')!
    expect(heading.textContent!.trim()).toBe('Overview')
    expect(heading.querySelector('.block-text')!.hasAttribute('data-heading')).toBe(true)
    expect(heading.querySelector('.badge, .item-icon, .item-preview')).toBeNull()
    expect(paragraph.textContent!.trim()).toBe('Longer paragraph')
    expect(paragraph.querySelector('.block-text')!.hasAttribute('data-heading')).toBe(false)

    el.phase = 'predicate'
    el.predicates = [
      { uri: 'urn:test:related', label: 'is related to', category: 'Default' },
      { uri: 'urn:test:supports', label: 'supports', category: 'Ground', icon: 'scale' },
    ]
    await el.updateComplete

    expect(Array.from(sr(el).querySelectorAll('.predicate-group-label')).map(node => node.textContent?.trim())).toEqual([
      'Default',
      'Ground',
    ])
    expect(sr(el).querySelector('[data-predicate-uri="urn:test:supports"]')?.textContent).toContain('supports')
  })

  it('gives the wire flow its roomier container; the link flow keeps the compact one', async () => {
    const wire = await mount(picker => { picker.flow = 'wire' })
    expect(sr(wire).querySelector('.container')!.classList.contains('wire')).toBe(true)
    const link = await mount(picker => { picker.flow = 'link' })
    expect(sr(link).querySelector('.container')!.classList.contains('wire')).toBe(false)
  })

  it('keeps the rows on screen while a refresh loads, and spins only when empty', async () => {
    const el = await mount(picker => {
      picker.phase = 'block'
      picker.selectedDocument = { id: 'doc-a', label: 'A', type: 'document' }
      picker.blocks = [{ id: 'b1', type: 'paragraph', text: 'first' }]
      picker.loading = true
    })
    expect(sr(el).querySelector('[data-block-id="b1"]')).not.toBeNull()
    expect(sr(el).querySelector('.loading')).toBeNull()
    el.blocks = []
    await el.updateComplete
    expect(sr(el).querySelector('.loading')).not.toBeNull()
  })

  it('does not select a stale row with Enter while a block search is loading', async () => {
    const el = await mount(picker => {
      picker.phase = 'block'
      picker.selectedDocument = { id: 'doc-a', label: 'A', type: 'document' }
      picker.blocks = [{ id: 'old', type: 'paragraph', text: 'from the last query' }]
      picker.loading = true
    })
    const selected: unknown[] = []
    el.addEventListener('mn-wikilink-select', event => selected.push((event as CustomEvent).detail))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(selected).toEqual([])
    el.loading = false
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(selected).toHaveLength(1)
  })

  it('Escape closes from document phase', async () => {
    const el = await mount()
    const closed: string[] = []
    el.addEventListener('mn-close', () => closed.push('close'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])
  })
})
