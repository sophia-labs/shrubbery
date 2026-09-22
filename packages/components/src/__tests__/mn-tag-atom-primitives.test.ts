/**
 * REAL component tests for Garden tag atom visuals.
 *
 * These components are pure UI: they render tag chip/autocomplete visuals and
 * emit click/hover intents, but own no editor ranges, lookup, or scheduling.
 */
import { afterEach, describe, expect, it } from 'vitest'
import '../mn-tag-chip-specimen.js'
import '../mn-tag-autocomplete-popover.js'
import type {
  MnTagAutocompleteHoverDetail,
  MnTagAutocompletePopover,
  MnTagAutocompleteSelectDetail,
  MnTagChipSpecimen,
  MnTagSuggestion,
} from '../index.js'

async function mountChip(setup?: (el: MnTagChipSpecimen) => void): Promise<MnTagChipSpecimen> {
  const el = document.createElement('mn-tag-chip-specimen') as MnTagChipSpecimen
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountPopover(setup?: (el: MnTagAutocompletePopover) => void): Promise<MnTagAutocompletePopover> {
  const el = document.createElement('mn-tag-autocomplete-popover') as MnTagAutocompletePopover
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-skin')
})

describe('mn-tag-chip-specimen', () => {
  it('registers and renders attrs name/date with Garden core class', async () => {
    const el = await mountChip((node) => {
      node.attrs = { name: 'todo', date: '2026-06-23' }
    })
    const chip = el.shadowRoot!.querySelector('.chip')!

    expect(customElements.get('mn-tag-chip-specimen')).toBeDefined()
    expect(chip.classList.contains('core-todo')).toBe(true)
    expect(el.shadowRoot!.querySelector('.name')?.textContent).toBe('#todo')
    expect(el.shadowRoot!.querySelector('.date')?.textContent).toBe('2026-06-23')
  })

  it('supports name/date properties and selected state', async () => {
    const el = await mountChip((node) => {
      node.name = '#decision'
      node.date = null
      node.selected = true
    })
    const chip = el.shadowRoot!.querySelector('.chip')!

    expect(chip.classList.contains('selected')).toBe(true)
    expect(chip.classList.contains('core-decision')).toBe(true)
    expect(el.shadowRoot!.querySelector('.date')).toBeNull()
    expect(el.hasAttribute('selected')).toBe(true)
  })

  it('mirrors the ambient Emporium skin without host imports', async () => {
    const host = document.createElement('div')
    host.setAttribute('data-skin', 'emporium')
    document.body.appendChild(host)
    const el = document.createElement('mn-tag-chip-specimen') as MnTagChipSpecimen
    el.name = 'pragma'
    host.appendChild(el)
    await el.updateComplete

    expect(el.getAttribute('data-skin')).toBe('emporium')
    expect(el.shadowRoot!.querySelector('.chip')?.classList.contains('core-pragma')).toBe(true)
  })
})

describe('mn-tag-autocomplete-popover', () => {
  const suggestions: readonly MnTagSuggestion[] = [
    { name: 'event', description: 'A scheduled happening.', isCore: true },
    { name: 'research', description: 'Custom graph tag.', isCore: false },
  ]

  it('registers and renders an empty state', async () => {
    const el = await mountPopover()

    expect(customElements.get('mn-tag-autocomplete-popover')).toBeDefined()
    expect(el.shadowRoot!.querySelector('.empty')?.textContent).toContain('No matching tags')
    expect(el.shadowRoot!.querySelectorAll('.item')).toHaveLength(0)
  })

  it('renders suggestions, selected state, descriptions, and hint row', async () => {
    const el = await mountPopover((node) => {
      node.items = suggestions
      node.selectedIndex = 1
    })
    const items = [...el.shadowRoot!.querySelectorAll('.item')]

    expect(items).toHaveLength(2)
    expect(items[0].classList.contains('core-event')).toBe(true)
    expect(items[1].classList.contains('selected')).toBe(true)
    expect(items[1].getAttribute('aria-selected')).toBe('true')
    expect(items[1].hasAttribute('data-tag-candidate')).toBe(true)
    expect(items[1].getAttribute('data-tag-name')).toBe('research')
    expect(items[1].querySelector('.name')?.textContent).toBe('research')
    expect(items[1].querySelector('.description')?.textContent).toBe('Custom graph tag.')
    expect(el.shadowRoot!.querySelector('.hint')?.textContent).toContain('insert')
  })

  it('emits composed select and hover events with index and item detail', async () => {
    const el = await mountPopover((node) => {
      node.items = suggestions
    })
    const selectDetails: MnTagAutocompleteSelectDetail[] = []
    const hoverDetails: MnTagAutocompleteHoverDetail[] = []
    el.addEventListener('mn-tag-autocomplete-select', (event) => {
      selectDetails.push((event as CustomEvent<MnTagAutocompleteSelectDetail>).detail)
    })
    el.addEventListener('mn-tag-autocomplete-hover', (event) => {
      hoverDetails.push((event as CustomEvent<MnTagAutocompleteHoverDetail>).detail)
    })

    const second = el.shadowRoot!.querySelectorAll<HTMLElement>('.item')[1]
    second.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }))
    const down = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })
    expect(second.dispatchEvent(down)).toBe(false)

    expect(hoverDetails).toEqual([{ index: 1, item: suggestions[1] }])
    expect(selectDetails).toEqual([{ index: 1, item: suggestions[1] }])
  })
})
