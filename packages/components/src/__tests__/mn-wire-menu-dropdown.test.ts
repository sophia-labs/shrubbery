import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-wire-menu-dropdown.js'
import type {
  MnWireMenuActionDetail,
  MnWireMenuAddDetail,
  MnWireMenuDropdown,
  MnWireMenuWire,
} from '../mn-wire-menu-dropdown.js'

const billingWire: MnWireMenuWire = {
  id: 'wire-billing',
  predicate: 'http://mnemosyne.ai/vocab#supports',
  predicateLabel: 'supports',
  otherDocumentId: 'doc-billing',
  otherGraphId: 'graph-a',
  otherBlockId: 'block-b',
  otherTitle: 'Billing',
  otherSnippet: 'Invoice review notes',
}

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnWireMenuDropdown) => void): Promise<MnWireMenuDropdown> {
  const el = document.createElement('mn-wire-menu-dropdown') as MnWireMenuDropdown
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-wire-menu-dropdown', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('renders existing flat wires using the Garden dropdown tag', async () => {
    const el = await mount(menu => {
      menu.wires = [billingWire]
    })

    expect(customElements.get('mn-wire-menu-dropdown')).toBeDefined()
    expect(sr(el).querySelector('[data-wire-menu-dropdown]')).not.toBeNull()
    expect(sr(el).querySelector('[data-wire-menu-item]')?.getAttribute('data-wire-id')).toBe('wire-billing')
    expect(sr(el).querySelector('[data-wire-navigate]')?.textContent).toContain('Billing')
    expect(sr(el).querySelector('[data-wire-navigate]')?.textContent).toContain('supports')
    expect(sr(el).querySelector('[data-wire-navigate]')?.textContent).toContain('Invoice review notes')
  })

  it('emits navigate and delete intents with the selected wire', async () => {
    const el = await mount(menu => {
      menu.wires = [billingWire]
    })
    const navigated: MnWireMenuActionDetail[] = []
    const deleted: MnWireMenuActionDetail[] = []
    el.addEventListener('mn-wire-menu-navigate', event => {
      navigated.push((event as CustomEvent<MnWireMenuActionDetail>).detail)
    })
    el.addEventListener('mn-wire-menu-delete', event => {
      deleted.push((event as CustomEvent<MnWireMenuActionDetail>).detail)
    })

    sr(el).querySelector<HTMLButtonElement>('[data-wire-navigate]')!.click()
    sr(el).querySelector<HTMLButtonElement>('[data-wire-delete]')!.click()

    expect(navigated).toEqual([{ wire: billingWire, direction: 'flat' }])
    expect(deleted).toEqual([{ wire: billingWire, direction: 'flat' }])
  })

  it('renders outgoing and incoming sections when shell supplies grouped wires', async () => {
    const incoming: MnWireMenuWire = {
      id: 'wire-incoming',
      predicateLabel: 'critiques',
      otherDocumentId: 'doc-review',
      otherTitle: 'Review',
    }
    const el = await mount(menu => {
      menu.wires = []
      menu.outgoingWires = [billingWire]
      menu.incomingWires = [incoming]
    })

    expect(Array.from(sr(el).querySelectorAll('.section-title')).map(node => node.textContent)).toEqual([
      'Outgoing (1)',
      'Incoming (1)',
    ])
    expect(Array.from(sr(el).querySelectorAll('[data-wire-menu-item]')).map(node => node.getAttribute('data-wire-id'))).toEqual([
      'wire-billing',
      'wire-incoming',
    ])
  })

  it('Escape closes and optional add emits modifier detail', async () => {
    const el = await mount(menu => {
      menu.wires = [billingWire]
      menu.showAdd = true
    })
    const closed: string[] = []
    const adds: MnWireMenuAddDetail[] = []
    el.addEventListener('mn-close', () => closed.push('close'))
    el.addEventListener('mn-wire-menu-add', event => {
      adds.push((event as CustomEvent<MnWireMenuAddDetail>).detail)
    })

    sr(el).querySelector<HTMLButtonElement>('[data-wire-menu-add]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true, metaKey: true }),
    )
    expect(adds).toEqual([{ shiftKey: true, altKey: false, ctrlKey: false, metaKey: true }])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])
  })

  it('renders empty state without shell data', async () => {
    const el = await mount()

    expect(sr(el).querySelector('.empty')?.textContent).toBe('No wires from this block')
  })
})
