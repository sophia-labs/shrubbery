import { beforeEach, describe, expect, it } from 'vitest'
import type { MenuEntry, MenuSelectDetail } from '@shrubbery/nucleus'
import '../mn-panel-header.js'
import '../mn-dropdown-button.js'
import type { MnPanelHeader } from '../mn-panel-header.js'
import type { MnDropdownButton } from '../mn-dropdown-button.js'

const MENU_ENTRIES: readonly MenuEntry[] = [
  { type: 'header', content: 'Document' },
  { id: 'doc.open', label: 'Open', icon: 'file-text', shortcut: 'Enter', checked: true },
  { id: 'doc.disabled', label: 'Disabled', disabled: true },
  { type: 'divider' },
  { id: 'doc.delete', label: 'Delete', icon: 'trash', variant: 'danger' },
]

async function mountPanelHeader(setup?: (el: MnPanelHeader) => void): Promise<MnPanelHeader> {
  const el = document.createElement('mn-panel-header') as MnPanelHeader
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountDropdown(setup?: (el: MnDropdownButton) => void): Promise<MnDropdownButton> {
  const el = document.createElement('mn-dropdown-button') as MnDropdownButton
  el.entries = MENU_ENTRIES
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-panel-header / mn-dropdown-button Garden primitives', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers both custom-element tags', () => {
    expect(customElements.get('mn-panel-header')).toBeDefined()
    expect(customElements.get('mn-dropdown-button')).toBeDefined()
  })

  it('mn-panel-header renders title, slots, badge, and collapse intents', async () => {
    const el = await mountPanelHeader((node) => {
      node.title = 'Wires'
      node.count = 5
      node.collapsible = true
    })
    const events: string[] = []
    el.addEventListener('mn-collapse', (event) => {
      events.push(`collapse:${(event as CustomEvent<{ collapsed: boolean }>).detail.collapsed}`)
    })
    el.addEventListener('mn-expand', (event) => {
      events.push(`expand:${(event as CustomEvent<{ collapsed: boolean }>).detail.collapsed}`)
    })

    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Wires')
    expect(el.shadowRoot!.querySelector('.badge')?.textContent).toBe('5')
    expect(el.shadowRoot!.querySelector('slot[name="icon"]')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('slot[name="actions"]')).not.toBeNull()

    const button = el.shadowRoot!.querySelector<HTMLButtonElement>('.collapse-btn')!
    expect(button.getAttribute('aria-expanded')).toBe('true')
    button.click()
    await el.updateComplete
    expect(el.collapsed).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    el.shadowRoot!.querySelector<HTMLButtonElement>('.collapse-btn')!.click()
    await el.updateComplete
    expect(el.collapsed).toBe(false)
    expect(events).toEqual(['collapse:true', 'expand:false'])
  })

  it('mn-dropdown-button opens Garden-style menu entries from the shared MenuEntry model', async () => {
    const el = await mountDropdown((node) => {
      node.label = 'More'
      node.iconName = 'more-horizontal'
      node.selectedId = 'doc.open'
      node.variant = 'toolbar'
      node.size = 'sm'
    })
    const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!

    expect(trigger.textContent).toContain('More')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.classList.contains('variant-toolbar')).toBe(true)
    const menuPopover = el.shadowRoot!.querySelector('.menu-popover')!
    expect(menuPopover.hasAttribute('popover')).toBe(true)
    expect(menuPopover.hasAttribute('popover-open')).toBe(false)

    trigger.click()
    await el.updateComplete

    expect(el.open).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(menuPopover.hasAttribute('popover-open')).toBe(true)
    expect(el.shadowRoot!.querySelector('.menu-header')?.textContent).toBe('Document')
    expect(
      Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-menu-item-id]')).map(
        (button) => button.dataset.menuItemId,
      ),
    ).toEqual(['doc.open', 'doc.disabled', 'doc.delete'])
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.open"]')?.classList.contains('selected')).toBe(true)
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.open"] .item-check svg')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.disabled"]')?.hasAttribute('disabled')).toBe(true)
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.delete"]')?.classList.contains('danger')).toBe(true)
  })

  it('mn-dropdown-button emits mn-select with modifiers and closes when an item is clicked', async () => {
    const el = await mountDropdown((node) => {
      node.label = 'Actions'
    })
    const selected: MenuSelectDetail[] = []
    let closed = 0
    el.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MenuSelectDetail>).detail)
    })
    el.addEventListener('mn-close', () => {
      closed += 1
    })

    el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await el.updateComplete
    el.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-menu-item-id="doc.delete"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }))
    await el.updateComplete

    expect(selected).toEqual([
      {
        id: 'doc.delete',
        item: MENU_ENTRIES[4],
        modifiers: { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false },
      },
    ])
    expect(el.open).toBe(false)
    expect(closed).toBe(1)
  })

  it('mn-dropdown-button supports keyboard navigation across enabled items only', async () => {
    const el = await mountDropdown()
    const selected: string[] = []
    el.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MenuSelectDetail>).detail.id)
    })

    el.shadowRoot!
      .querySelector<HTMLButtonElement>('.trigger')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(el.open).toBe(true)
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.open"]')?.classList.contains('focused')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[data-menu-item-id="doc.delete"]')?.classList.contains('focused')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, altKey: true }))
    await el.updateComplete
    expect(selected).toEqual(['doc.delete'])
    expect(el.open).toBe(false)
  })

  it('mn-dropdown-button respects disabled triggers and closes on Escape or outside pointerdown', async () => {
    const disabled = await mountDropdown((node) => {
      node.disabled = true
    })
    disabled.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await disabled.updateComplete
    expect(disabled.open).toBe(false)

    const el = await mountDropdown()
    el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await el.updateComplete
    expect(el.open).toBe(false)

    el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await el.updateComplete
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))
    await el.updateComplete
    expect(el.open).toBe(false)
  })

  it('clears top-layer popover state when disconnected while open, and does not resurrect it on reinsertion (regression r1)', async () => {
    const el = await mountDropdown((node) => {
      node.label = 'More'
    })
    el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await el.updateComplete
    const menuPopover = el.shadowRoot!.querySelector('.menu-popover')!
    expect(menuPopover.hasAttribute('popover-open')).toBe(true)

    el.remove()

    // Synchronous: hostDisconnected() hides the popover directly on the
    // captured DOM node, ahead of any awaited re-render.
    expect(menuPopover.hasAttribute('popover-open')).toBe(false)

    await el.updateComplete
    expect(el.open).toBe(false)
    expect(el.shadowRoot!.querySelector('.trigger')?.getAttribute('aria-expanded')).toBe('false')

    document.body.append(el)
    await el.updateComplete
    expect(el.open).toBe(false)
    expect(el.shadowRoot!.querySelector('.menu-popover')?.hasAttribute('popover-open')).toBe(false)

    // Still fully functional after the round trip.
    el.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await el.updateComplete
    expect(el.open).toBe(true)
    expect(el.shadowRoot!.querySelector('.menu-popover')?.hasAttribute('popover-open')).toBe(true)
  })
})
