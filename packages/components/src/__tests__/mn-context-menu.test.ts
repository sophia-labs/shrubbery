import { describe, expect, it, beforeEach } from 'vitest'
import type { MenuEntry, MenuSelectDetail } from '@shrubbery/nucleus'
import '../mn-context-menu.js'
import type { MnContextMenu } from '../mn-context-menu.js'

const ITEMS: readonly MenuEntry[] = [
  { type: 'header', content: 'Document' },
  { id: 'doc.open', label: 'Open', icon: 'file-text', shortcut: 'Enter' },
  { id: 'doc.disabled', label: 'Disabled', disabled: true },
  { type: 'divider' },
  { id: 'doc.delete', label: 'Delete', icon: 'trash', variant: 'danger' },
]

function nextTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

async function mountMenu(items: readonly MenuEntry[] = ITEMS): Promise<MnContextMenu> {
  const menu = document.createElement('mn-context-menu') as MnContextMenu
  menu.items = items
  document.body.appendChild(menu)
  await menu.updateComplete
  return menu
}

describe('mn-context-menu', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders Garden-style command entries from the shared MenuEntry model', async () => {
    const menu = await mountMenu()
    menu.show({ x: 32, y: 48 })
    await menu.updateComplete

    expect(menu.open).toBe(true)
    expect(menu.style.left).toBe('32px')
    expect(menu.style.top).toBe('48px')
    // Host-as-popover (layer-contract campaign): the host itself promotes to
    // the native top layer, escaping whatever stacking context it mounts in.
    expect(menu.hasAttribute('popover')).toBe(true)
    expect(menu.hasAttribute('popover-open')).toBe(true)
    expect(menu.shadowRoot!.querySelector('.menu-header-text')?.textContent).toBe('Document')
    expect(
      Array.from(menu.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-menu-item-id]')).map(
        (button) => button.dataset.menuItemId,
      ),
    ).toEqual(['doc.open', 'doc.disabled', 'doc.delete'])
    expect(menu.shadowRoot!.querySelector('[data-menu-item-id="doc.disabled"]')?.hasAttribute('disabled')).toBe(true)
    expect(menu.shadowRoot!.querySelector('[data-menu-item-id="doc.delete"]')?.classList.contains('danger')).toBe(true)
  })

  it('emits mn-select with modifiers and closes when an item is clicked', async () => {
    const menu = await mountMenu()
    const selected: MenuSelectDetail[] = []
    let closed = 0
    menu.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MenuSelectDetail>).detail)
    })
    menu.addEventListener('mn-close', () => {
      closed += 1
    })

    menu.show({ x: 16, y: 24 })
    await menu.updateComplete
    menu.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-menu-item-id="doc.delete"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }))
    await menu.updateComplete

    expect(selected).toEqual([
      {
        id: 'doc.delete',
        item: ITEMS[4],
        modifiers: { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false },
      },
    ])
    expect(menu.open).toBe(false)
    expect(menu.hasAttribute('popover-open')).toBe(false)
    expect(closed).toBe(1)
  })

  it('supports keyboard navigation across enabled items only', async () => {
    const menu = await mountMenu()
    const selected: string[] = []
    menu.addEventListener('mn-select', (event) => {
      selected.push((event as CustomEvent<MenuSelectDetail>).detail.id)
    })

    menu.show({ x: 0, y: 0 })
    await menu.updateComplete
    expect(menu.shadowRoot!.querySelector('[data-menu-item-id="doc.open"]')?.classList.contains('focused')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await menu.updateComplete
    expect(menu.shadowRoot!.querySelector('[data-menu-item-id="doc.delete"]')?.classList.contains('focused')).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, altKey: true }))
    await menu.updateComplete
    expect(selected).toEqual(['doc.delete'])
  })

  it('closes on Escape and outside pointer events', async () => {
    const menu = await mountMenu()
    let closed = 0
    menu.addEventListener('mn-close', () => {
      closed += 1
    })

    menu.show({ x: 8, y: 8 })
    await menu.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await menu.updateComplete

    expect(menu.open).toBe(false)
    expect(closed).toBe(1)

    menu.show({ x: 8, y: 8 })
    await menu.updateComplete
    await nextTick()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    await menu.updateComplete

    expect(menu.open).toBe(false)
    expect(closed).toBe(2)
  })

  it('clears popover state when disconnected while open, and does not resurrect it on reinsertion (regression r1)', async () => {
    const menu = await mountMenu()
    let closed = 0
    menu.addEventListener('mn-close', () => {
      closed += 1
    })

    menu.show({ x: 10, y: 10 })
    await menu.updateComplete
    expect(menu.open).toBe(true)
    expect(menu.hasAttribute('popover-open')).toBe(true)

    menu.remove()

    // The host IS the popover, so disconnectedCallback's hide() call must
    // synchronously reconcile both the popover attribute and `open` — a
    // dangling popover-open on a detached-but-still-flagged-open menu would
    // resurface pre-opened if anything ever reinserted it. hide() also
    // mirrors normal dismissal by emitting mn-close.
    expect(menu.hasAttribute('popover-open')).toBe(false)
    expect(menu.open).toBe(false)
    expect(closed).toBe(1)

    document.body.appendChild(menu)
    await menu.updateComplete

    // Reinsertion alone must not resurrect the menu — it stays closed until
    // show() is called again explicitly.
    expect(menu.open).toBe(false)
    expect(menu.hasAttribute('popover-open')).toBe(false)

    // Still fully functional after the round trip.
    menu.show({ x: 20, y: 20 })
    await menu.updateComplete
    expect(menu.open).toBe(true)
    expect(menu.hasAttribute('popover-open')).toBe(true)
  })
})
