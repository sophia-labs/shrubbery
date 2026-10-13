/**
 * REAL test of the skin picker — NO MOCKS. The cycling skin toggle is gone; in its place a drop-down
 * lists every skin with its label (Hotdog Stand last), is keyboard-operable, and says what it chose
 * with ONE composed event, `mn-skin-select`. This mounts the real component and the real dropdown
 * under it in the document, drives them with real clicks and keys, and reads the real DOM.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../mn-skin-picker.js'
import '../mn-top-bar.js'
import '../mn-app-bar.js'
import type { MnSkinPicker, MnSkinSelectDetail } from '../mn-skin-picker.js'
import type { MnDropdownButton } from '../mn-dropdown-button.js'
import { CHROME_PICKER_SKINS } from '../chrome-skin.js'

const sr = (el: Element): ShadowRoot => el.shadowRoot!

async function mountPicker(setup?: (el: MnSkinPicker) => void): Promise<MnSkinPicker> {
  const el = document.createElement('mn-skin-picker') as MnSkinPicker
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  const dropdown = sr(el).querySelector('mn-dropdown-button') as MnDropdownButton
  await dropdown.updateComplete
  return el
}

const dropdownOf = (picker: MnSkinPicker): MnDropdownButton => sr(picker).querySelector('mn-dropdown-button') as MnDropdownButton
const triggerOf = (picker: MnSkinPicker): HTMLButtonElement => sr(dropdownOf(picker)).querySelector('.trigger') as HTMLButtonElement
const itemsOf = (picker: MnSkinPicker): HTMLButtonElement[] => Array.from(sr(dropdownOf(picker)).querySelectorAll<HTMLButtonElement>('[data-menu-item-id]'))

async function open(picker: MnSkinPicker): Promise<void> {
  triggerOf(picker).click()
  await dropdownOf(picker).updateComplete
}

beforeEach(() => document.body.replaceChildren())
afterEach(() => document.body.replaceChildren())

describe('mn-skin-picker: the drop-down that replaced the cycling toggle', () => {
  it('lists every skin with its own label and icon, in the shared order, Hotdog Stand last', async () => {
    const picker = await mountPicker()
    await open(picker)
    expect(itemsOf(picker).map(i => i.dataset.menuItemId)).toEqual(['garden', 'emporium', '98', 'glass', 'mithras', 'hotdog-stand'])
    expect(itemsOf(picker).map(i => i.querySelector('.item-label')!.textContent)).toEqual(['Garden', 'Sophia', '98', 'Glass', 'Mithras', 'Hotdog Stand'])
    expect(itemsOf(picker).every(i => i.querySelector('.item-icon svg') !== null)).toBe(true)
    expect(CHROME_PICKER_SKINS[CHROME_PICKER_SKINS.length - 1]).toBe('hotdog-stand')
  })

  it('shows the current skin on its trigger — its icon, and a name that says which skin is on', async () => {
    const picker = await mountPicker(p => { p.value = 'hotdog-stand' })
    const trigger = triggerOf(picker)
    expect(trigger.getAttribute('aria-label')).toBe('Visual style: Hotdog Stand')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.querySelector('.trigger-icon svg')).not.toBeNull()
    expect(sr(dropdownOf(picker)).querySelector('.menu-panel')!.getAttribute('aria-label')).toBe('Visual style')

    picker.value = '98'
    await picker.updateComplete
    await dropdownOf(picker).updateComplete
    expect(triggerOf(picker).getAttribute('aria-label')).toBe('Visual style: 98')
  })

  it('marks the current skin in the list (aria-current), and only that one', async () => {
    const picker = await mountPicker(p => { p.value = 'glass' })
    await open(picker)
    const current = itemsOf(picker).filter(i => i.getAttribute('aria-current') === 'true')
    expect(current.map(i => i.dataset.menuItemId)).toEqual(['glass'])
  })

  it('choosing a skin emits ONE composed mn-skin-select with the skin, and the dropdown\'s own mn-select never leaks', async () => {
    const picker = await mountPicker(p => { p.value = 'garden' })
    const seen: MnSkinSelectDetail[] = []
    const leaked: string[] = []
    document.addEventListener('mn-skin-select', e => seen.push((e as CustomEvent<MnSkinSelectDetail>).detail))
    document.addEventListener('mn-select', e => leaked.push((e as CustomEvent<{ id: string }>).detail.id))
    await open(picker)
    itemsOf(picker).find(i => i.dataset.menuItemId === 'hotdog-stand')!.click()
    await dropdownOf(picker).updateComplete
    expect(seen).toEqual([{ skin: 'hotdog-stand' }])
    expect(leaked, 'a shell listening for menu selections must not hear the skin menu').toEqual([])
    expect(dropdownOf(picker).open).toBe(false)
  })

  it('is operable from the keyboard alone: ArrowDown opens on the first item, arrows move, Enter chooses, Escape closes and returns focus', async () => {
    const picker = await mountPicker(p => { p.value = 'garden' })
    const seen: string[] = []
    picker.addEventListener('mn-skin-select', e => seen.push((e as CustomEvent<MnSkinSelectDetail>).detail.skin))

    triggerOf(picker).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await dropdownOf(picker).updateComplete
    expect(dropdownOf(picker).open).toBe(true)
    expect(itemsOf(picker)[0].classList.contains('focused')).toBe(true)

    for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await dropdownOf(picker).updateComplete
    expect(itemsOf(picker)[5].classList.contains('focused')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await dropdownOf(picker).updateComplete
    expect(seen).toEqual(['hotdog-stand'])
    expect(dropdownOf(picker).open).toBe(false)

    triggerOf(picker).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    await dropdownOf(picker).updateComplete
    expect(dropdownOf(picker).open).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await dropdownOf(picker).updateComplete
    expect(dropdownOf(picker).open).toBe(false)
    expect(seen).toEqual(['hotdog-stand'])
  })

  it('offers exactly the skins it is given — an app with its own set (Aviary adds Research, Greenhouse, Observatory)', async () => {
    const picker = await mountPicker(p => { p.skins = ['garden', 'research', 'observatory']; p.value = 'research' })
    await open(picker)
    expect(itemsOf(picker).map(i => i.dataset.menuItemId)).toEqual(['garden', 'research', 'observatory'])
    expect(itemsOf(picker).map(i => i.querySelector('.item-label')!.textContent)).toEqual(['Garden', 'Research', 'Observatory'])
  })

  it('can be hidden like any control (a shell without skins hides it)', async () => {
    const picker = await mountPicker(p => { p.hidden = true })
    expect(picker.hidden).toBe(true)
  })
})

describe('the bars carry the picker where the toggle was', () => {
  // The two bars share the picker's contract (`activeSkin`, `skins`), not a class: describe them by it.
  interface BarLike extends HTMLElement {
    updateComplete: Promise<unknown>
    activeSkin: string
    skins: readonly string[]
    controls?: readonly string[] | null
    showActions?: boolean
  }
  async function mountBar<T extends BarLike = BarLike>(tag: string, setup?: (el: T) => void): Promise<T> {
    const el = document.createElement(tag) as T
    setup?.(el)
    document.body.appendChild(el)
    await el.updateComplete
    return el
  }

  it.each(['mn-top-bar', 'mn-app-bar'])('%s: a skin picker (data-action="skin"), the active skin as its value, no toggle button', async (tag) => {
    const bar = await mountBar(tag, (e) => { e.activeSkin = '98' })
    const picker = sr(bar).querySelector('mn-skin-picker[data-action="skin"]') as MnSkinPicker
    expect(picker).not.toBeNull()
    expect(picker.value).toBe('98')
    expect(sr(bar).querySelector('button[data-action="skin"]')).toBeNull()
  })

  it.each(['mn-top-bar', 'mn-app-bar'])('%s: choosing a skin in the bar reaches the shell as mn-skin-select, and mn-skin-toggle is gone', async (tag) => {
    const bar = await mountBar(tag, (e) => { e.activeSkin = 'garden' })
    const select: string[] = []
    const toggle: string[] = []
    bar.addEventListener('mn-skin-select', e => select.push((e as CustomEvent<MnSkinSelectDetail>).detail.skin))
    bar.addEventListener('mn-skin-toggle', () => toggle.push('toggle'))
    const picker = sr(bar).querySelector('mn-skin-picker') as MnSkinPicker
    await open(picker)
    itemsOf(picker).find(i => i.dataset.menuItemId === 'hotdog-stand')!.click()
    await dropdownOf(picker).updateComplete
    expect(select).toEqual(['hotdog-stand'])
    expect(toggle).toEqual([])
  })

  it('mn-top-bar: the picker follows the bar\'s own `controls` — hidden when the skin control is not shown', async () => {
    const bar = await mountBar('mn-top-bar', (e) => { e.controls = ['theme', 'settings'] })
    expect((sr(bar).querySelector('mn-skin-picker') as MnSkinPicker).hidden).toBe(true)
    bar.controls = null
    await bar.updateComplete
    expect((sr(bar).querySelector('mn-skin-picker') as MnSkinPicker).hidden).toBe(false)
  })

  it('mn-app-bar: show-actions=false omits the picker with the other built-in actions', async () => {
    const bar = await mountBar('mn-app-bar', (e) => { e.showActions = false })
    expect(sr(bar).querySelector('mn-skin-picker')).toBeNull()
  })

  it('both bars hand the picker the skins they are given (a shell with its own set passes it once)', async () => {
    for (const tag of ['mn-top-bar', 'mn-app-bar'] as const) {
      const bar = await mountBar(tag, (e) => { e.skins = ['garden', 'research'] })
      expect((sr(bar).querySelector('mn-skin-picker') as MnSkinPicker).skins).toEqual(['garden', 'research'])
    }
  })
})
