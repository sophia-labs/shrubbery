import { beforeEach, describe, expect, it } from 'vitest'
import { MNEMO_NS } from '@shrubbery/nucleus'
import '../mn-advanced-wire-menu.js'
import type {
  MnAdvancedWireMenu,
  MnAdvancedWireMenuConfirmDetail,
} from '../mn-advanced-wire-menu.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnAdvancedWireMenu) => void): Promise<MnAdvancedWireMenu> {
  const el = document.createElement('mn-advanced-wire-menu') as MnAdvancedWireMenu
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-advanced-wire-menu', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders the default Garden predicate taxonomy and initial direction', async () => {
    const el = await mount()

    expect(customElements.get('mn-advanced-wire-menu')).toBeDefined()
    expect(sr(el).querySelector('[data-wire-advanced-menu]')).not.toBeNull()
    expect(Array.from(sr(el).querySelectorAll('.group-title')).map(node => node.textContent)).toEqual([
      'Default',
      'Ground',
      'Critique',
      'Genesis',
      'Structure',
    ])
    expect(sr(el).querySelector('[data-predicate-uri="http://mnemosyne.ai/vocab#relatedTo"]')?.textContent).toBe(
      'is related to',
    )
    expect(
      sr(el)
        .querySelector('[data-wire-advanced-direction="forward"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('selects predicate and direction, then emits confirm detail', async () => {
    const el = await mount()
    const confirmed: MnAdvancedWireMenuConfirmDetail[] = []
    el.addEventListener('mn-wire-options-confirm', event => {
      confirmed.push((event as CustomEvent<MnAdvancedWireMenuConfirmDetail>).detail)
    })

    sr(el)
      .querySelector<HTMLButtonElement>(`[data-predicate-uri="${MNEMO_NS}supports"]`)!
      .click()
    await el.updateComplete
    expect(
      sr(el)
        .querySelector(`[data-predicate-uri="${MNEMO_NS}supports"]`)
        ?.getAttribute('aria-pressed'),
    ).toBe('true')

    sr(el).querySelector<HTMLButtonElement>('[data-wire-advanced-direction="bidirectional"]')!.click()
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('[data-wire-advanced-confirm]')!.click()

    expect(el.open).toBe(false)
    expect(confirmed).toEqual([
      {
        predicate: `${MNEMO_NS}supports`,
        direction: 'bidirectional',
        bidirectional: true,
      },
    ])
  })

  it('close controls emit mn-close without confirm', async () => {
    const el = await mount()
    const closed: string[] = []
    const confirmed: MnAdvancedWireMenuConfirmDetail[] = []
    el.addEventListener('mn-close', () => closed.push('close'))
    el.addEventListener('mn-wire-options-confirm', event => {
      confirmed.push((event as CustomEvent<MnAdvancedWireMenuConfirmDetail>).detail)
    })

    sr(el).querySelector<HTMLButtonElement>('[data-wire-advanced-close]')!.click()
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])
    expect(confirmed).toEqual([])

    el.open = true
    await el.updateComplete
    sr(el).querySelector<HTMLButtonElement>('[data-wire-advanced-cancel]')!.click()
    expect(closed).toEqual(['close', 'close'])
  })

  it('supports custom predicate groups from a shell', async () => {
    const el = await mount(menu => {
      menu.groups = [
        {
          name: 'Custom',
          description: 'Graph local predicates',
          predicates: [
            { uri: 'urn:test:clarifies', label: 'clarifies', description: 'A clarifies B' },
          ],
        },
      ]
    })

    expect(Array.from(sr(el).querySelectorAll('.group-title')).map(node => node.textContent)).toEqual(['Custom'])
    expect(sr(el).querySelector('[data-predicate-uri="urn:test:clarifies"]')?.textContent).toBe('clarifies')
  })

  it('Escape closes and Enter confirms the current selection', async () => {
    const el = await mount()
    const confirmed: MnAdvancedWireMenuConfirmDetail[] = []
    const closed: string[] = []
    el.addEventListener('mn-close', () => closed.push('close'))
    el.addEventListener('mn-wire-options-confirm', event => {
      confirmed.push((event as CustomEvent<MnAdvancedWireMenuConfirmDetail>).detail)
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])

    el.open = true
    el.selectedPredicate = `${MNEMO_NS}qualifies`
    el.direction = 'reverse'
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(confirmed).toEqual([
      {
        predicate: `${MNEMO_NS}qualifies`,
        direction: 'reverse',
        bidirectional: false,
      },
    ])
  })

  it('R cycles direction forward → reverse → bidirectional → forward', async () => {
    const el = await mount()
    expect(el.direction).toBe('forward')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    expect(el.direction).toBe('reverse')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    expect(el.direction).toBe('bidirectional')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    expect(el.direction).toBe('forward')
  })

  it('R is case-insensitive (Shift-R also cycles)', async () => {
    const el = await mount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', bubbles: true, cancelable: true }))
    expect(el.direction).toBe('reverse')
  })

  it('Mod-R does NOT cycle (so it does not fight browser reload)', async () => {
    const el = await mount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true }))
    expect(el.direction).toBe('forward')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(el.direction).toBe('forward')
  })

  it('R does nothing when the menu is closed', async () => {
    const el = await mount()
    el.open = false
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
    expect(el.direction).toBe('forward')
  })
})
