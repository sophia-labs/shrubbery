/**
 * REAL component test — Garden editor-toolbar primitive substrate.
 *
 * NO MOCKS: mounts the real backend-free custom elements. These primitives do
 * not run editor commands; they preserve the DOM/control behavior the runtime
 * editor toolbar can compose next.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-button.js'
import '../mn-icon-button.js'
import '../mn-toolbar.js'
import type { MnButton } from '../mn-button.js'
import type { MnIconButton } from '../mn-icon-button.js'
import type {
  MnToolbar,
  MnToolbarGroup,
  MnToolbarOverflow,
  MnToolbarOverflowSelectDetail,
} from '../mn-toolbar.js'

function buttonRoot(el: MnButton): ShadowRoot {
  return el.shadowRoot!
}

function iconButtonRoot(el: MnIconButton): ShadowRoot {
  return el.shadowRoot!
}

async function mountButton(setup?: (el: MnButton) => void): Promise<MnButton> {
  const el = document.createElement('mn-button') as MnButton
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountIconButton(setup?: (el: MnIconButton) => void): Promise<MnIconButton> {
  const el = document.createElement('mn-icon-button') as MnIconButton
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function stubOffsetWidth(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'offsetWidth', {
    configurable: true,
    get: () => width,
  })
}

function forceOverflowMeasure(el: MnToolbarOverflow): void {
  ;(el as unknown as { measure: () => void }).measure()
}

async function afterRender(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function overflowAction(label: string, priority: string, width: number, shortcut?: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  button.setAttribute('aria-label', label)
  button.dataset.priority = priority
  if (shortcut) button.dataset.shortcut = shortcut
  stubOffsetWidth(button, width)
  return button
}

describe('mn-button / mn-icon-button / mn-toolbar primitives', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the toolbar primitive tags', () => {
    expect(customElements.get('mn-button')).toBeDefined()
    expect(customElements.get('mn-icon-button')).toBeDefined()
    expect(customElements.get('mn-toolbar')).toBeDefined()
    expect(customElements.get('mn-toolbar-group')).toBeDefined()
    expect(customElements.get('mn-toolbar-overflow')).toBeDefined()
  })

  it('mn-button renders label, icon, shortcut, toolbar pressed state, and bubbles native clicks', async () => {
    const el = await mountButton((node) => {
      node.variant = 'toolbar'
      node.size = 'sm'
      node.label = 'Bold'
      node.icon = 'bold'
      node.shortcut = 'Mod+B'
      node.pressed = true
    })
    const inner = buttonRoot(el).querySelector('button')!
    const clicks: Event[] = []
    el.addEventListener('click', (event) => clicks.push(event))

    expect(inner.getAttribute('aria-pressed')).toBe('true')
    expect(inner.getAttribute('aria-keyshortcuts')).toBe('Mod+B')
    expect(buttonRoot(el).querySelector('.button-label')?.textContent).toBe('Bold')
    expect(buttonRoot(el).querySelector('.button-shortcut')?.textContent).toBe('Mod+B')
    expect(buttonRoot(el).querySelector('.button-icon svg')).not.toBeNull()

    inner.click()
    expect(clicks).toHaveLength(1)
  })

  it('mn-button keep-focus prevents mousedown default and loading suppresses clicks', async () => {
    const el = await mountButton((node) => {
      node.label = 'Save'
      node.keepFocus = true
      node.loading = true
    })
    const inner = buttonRoot(el).querySelector('button')!
    const clicks: Event[] = []
    el.addEventListener('click', (event) => clicks.push(event))

    const down = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })
    expect(inner.dispatchEvent(down)).toBe(false)
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }))
    expect(clicks).toEqual([])
    expect(inner.getAttribute('aria-busy')).toBe('true')
  })

  it('mn-icon-button exposes accessible label, pressed state, tooltip, and keep-focus', async () => {
    const el = await mountIconButton((node) => {
      node.icon = 'italic'
      node.label = 'Italic'
      node.shortcut = 'Mod+I'
      node.pressed = true
      node.keepFocus = true
    })
    const inner = iconButtonRoot(el).querySelector('button')!

    expect(inner.getAttribute('aria-label')).toBe('Italic')
    expect(inner.getAttribute('aria-pressed')).toBe('true')
    expect(iconButtonRoot(el).querySelector('.icon-wrap svg')).not.toBeNull()

    const down = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })
    expect(inner.dispatchEvent(down)).toBe(false)

    expect(iconButtonRoot(el).querySelector('.tooltip')?.textContent).toContain('Italic')
    expect(iconButtonRoot(el).querySelector('.tooltip-shortcut')?.textContent).toBe('Mod+I')
  })

  it('mn-toolbar and mn-toolbar-group expose toolbar/group semantics while slotting controls', async () => {
    const toolbar = document.createElement('mn-toolbar') as MnToolbar
    toolbar.label = 'Editor formatting'
    const group = document.createElement('mn-toolbar-group') as MnToolbarGroup
    group.label = 'Inline'
    group.divider = true
    const bold = document.createElement('mn-icon-button') as MnIconButton
    bold.icon = 'bold'
    bold.label = 'Bold'
    group.appendChild(bold)
    toolbar.appendChild(group)
    document.body.appendChild(toolbar)
    await toolbar.updateComplete
    await group.updateComplete
    await bold.updateComplete

    expect(toolbar.getAttribute('role')).toBe('toolbar')
    expect(toolbar.getAttribute('aria-label')).toBe('Editor formatting')
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal')
    expect(group.shadowRoot!.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Inline')
    expect(group.shadowRoot!.querySelector('.label')?.textContent).toBe('Inline')
    expect(group.hasAttribute('divider')).toBe(true)
    expect(toolbar.querySelector('mn-icon-button')).toBe(bold)
  })

  it('mn-toolbar-overflow hides lower-priority slotted controls first', async () => {
    const overflow = document.createElement('mn-toolbar-overflow') as MnToolbarOverflow
    const low = overflowAction('Low', '0', 60, 'Mod+L')
    const mid = overflowAction('Mid', '1', 60)
    const high = overflowAction('High', '3', 60)
    stubOffsetWidth(overflow, 120)
    overflow.append(low, mid, high)
    document.body.appendChild(overflow)
    await overflow.updateComplete

    forceOverflowMeasure(overflow)
    await overflow.updateComplete
    await afterRender()

    expect(low.hasAttribute('data-overflow-hidden')).toBe(true)
    expect(mid.hasAttribute('data-overflow-hidden')).toBe(true)
    expect(high.hasAttribute('data-overflow-hidden')).toBe(false)
    expect(overflow.shadowRoot!.querySelector<HTMLButtonElement>('.overflow-button')?.hidden).toBe(false)
    const items = [...overflow.shadowRoot!.querySelectorAll('.menu-item')]
    expect(items.map((item) => item.querySelector('.item-label')?.textContent?.trim())).toEqual(['Low', 'Mid'])
    expect(items[0].querySelector('.item-shortcut')?.textContent?.trim()).toBe('Mod+L')
  })

  it('mn-toolbar-overflow suppresses the overflow button when controls fit', async () => {
    const overflow = document.createElement('mn-toolbar-overflow') as MnToolbarOverflow
    const first = overflowAction('First', '0', 40)
    const second = overflowAction('Second', '1', 40)
    stubOffsetWidth(overflow, 140)
    overflow.append(first, second)
    document.body.appendChild(overflow)
    await overflow.updateComplete

    forceOverflowMeasure(overflow)
    await overflow.updateComplete
    await afterRender()

    expect(first.hasAttribute('data-overflow-hidden')).toBe(false)
    expect(second.hasAttribute('data-overflow-hidden')).toBe(false)
    expect(overflow.shadowRoot!.querySelector<HTMLButtonElement>('.overflow-button')?.hidden).toBe(true)
  })

  it('mn-toolbar-overflow emits selection detail and clicks the original item', async () => {
    const overflow = document.createElement('mn-toolbar-overflow') as MnToolbarOverflow
    const hidden = overflowAction('Rename', '0', 80)
    const visible = overflowAction('Keep', '2', 80)
    let originalClicks = 0
    const details: MnToolbarOverflowSelectDetail[] = []
    hidden.addEventListener('click', () => {
      originalClicks += 1
    })
    overflow.addEventListener('mn-overflow-select', (event) => {
      details.push((event as CustomEvent<MnToolbarOverflowSelectDetail>).detail)
    })
    stubOffsetWidth(overflow, 100)
    overflow.append(hidden, visible)
    document.body.appendChild(overflow)
    await overflow.updateComplete

    forceOverflowMeasure(overflow)
    await overflow.updateComplete
    await afterRender()
    overflow.shadowRoot!.querySelector<HTMLButtonElement>('.overflow-button')!.click()
    await overflow.updateComplete
    // Layer-contract campaign: the overflow menu is a Popover-API element,
    // escaping whatever stacking context the host toolbar forms.
    const menu = overflow.shadowRoot!.querySelector('.menu')!
    expect(menu.hasAttribute('popover')).toBe(true)
    expect(menu.hasAttribute('popover-open')).toBe(true)
    overflow.shadowRoot!.querySelector<HTMLButtonElement>('.menu-item')!.click()
    await overflow.updateComplete

    expect(details).toHaveLength(1)
    expect(details[0].label).toBe('Rename')
    expect(details[0].item).toBe(hidden)
    expect(originalClicks).toBe(1)
    expect(overflow.shadowRoot!.querySelector('.overflow-button')?.getAttribute('aria-expanded')).toBe('false')
    expect(menu.hasAttribute('popover-open')).toBe(false)
  })

  it('mn-toolbar-overflow clears top-layer popover state when disconnected while open, and does not resurrect it on reinsertion (regression r1)', async () => {
    const overflow = document.createElement('mn-toolbar-overflow') as MnToolbarOverflow
    const low = overflowAction('Low', '0', 80)
    stubOffsetWidth(overflow, 40)
    overflow.append(low)
    document.body.appendChild(overflow)
    await overflow.updateComplete
    forceOverflowMeasure(overflow)
    await overflow.updateComplete
    await afterRender()

    overflow.shadowRoot!.querySelector<HTMLButtonElement>('.overflow-button')!.click()
    await overflow.updateComplete
    const menu = overflow.shadowRoot!.querySelector('.menu')!
    expect(menu.hasAttribute('popover-open')).toBe(true)

    overflow.remove()

    // Synchronous: closeMenu()'s direct menuPopover.hide() call (and, as a
    // second line of defense, the controller's own hostDisconnected()) hide
    // the popover ahead of any awaited re-render.
    expect(menu.hasAttribute('popover-open')).toBe(false)

    document.body.appendChild(overflow)
    await overflow.updateComplete
    expect(overflow.shadowRoot!.querySelector('.overflow-button')?.getAttribute('aria-expanded')).toBe('false')
    expect(overflow.shadowRoot!.querySelector('.menu')?.hasAttribute('popover-open')).toBe(false)

    // Still fully functional after the round trip.
    overflow.shadowRoot!.querySelector<HTMLButtonElement>('.overflow-button')!.click()
    await overflow.updateComplete
    expect(overflow.shadowRoot!.querySelector('.menu')?.hasAttribute('popover-open')).toBe(true)
  })
})
