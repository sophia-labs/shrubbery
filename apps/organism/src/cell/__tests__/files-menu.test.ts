/**
 * The Files pane's menus on the real <mn-context-menu>. The menu hides itself (and says `mn-close`) right after it says
 * `mn-select`, so a choice that opens another menu ("Move to…" → the folders) must open it after that, or the second
 * menu is hidden the moment it appears. Found by the real-browser witness (scripts/files-rudiments-browser.mts).
 */
import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { MnContextMenu } from '@shrubbery/components'
import { filesMenuPresenter } from '../files-menu.js'

const menus: MnContextMenu[] = []
afterEach(() => { for (const m of menus.splice(0)) m.remove() })

function menu(): MnContextMenu {
  const el = document.createElement('mn-context-menu') as MnContextMenu
  document.body.appendChild(el)
  menus.push(el)
  return el
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
async function choose(el: MnContextMenu, label: string): Promise<void> {
  await el.updateComplete
  const item = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent?.includes(label))
  if (!item) throw new Error(`no item ${label}`)
  item.click()
  await tick()
}

describe('filesMenuPresenter', () => {
  it('shows the items at the position and hands the chosen id to the caller', async () => {
    const el = menu()
    const present = filesMenuPresenter(el)
    const chosen: string[] = []
    present({ items: [{ id: 'open', label: 'Open' }, { id: 'remove', label: 'Move to trash' }], x: 40, y: 50, onSelect: id => chosen.push(id) })
    expect(el.open).toBe(true)
    await choose(el, 'Move to trash')
    expect(chosen).toEqual(['remove'])
    expect(el.open).toBe(false)
  })

  it('a choice that opens another menu shows that menu, and its choice arrives', async () => {
    const el = menu()
    const present = filesMenuPresenter(el)
    const chosen: string[] = []
    present({ items: [{ id: 'move-to', label: 'Move to…' }], x: 40, y: 50, onSelect: () => {
      present({ items: [{ id: 'folder:docs', label: 'Docs' }], x: 40, y: 50, onSelect: id => chosen.push(id) })
    } })
    await choose(el, 'Move to…')
    expect(el.open).toBe(true)
    await choose(el, 'Docs')
    expect(chosen).toEqual(['folder:docs'])
  })

  it('closing without a choice calls nothing, and the next menu still works', async () => {
    const el = menu()
    const present = filesMenuPresenter(el)
    const chosen: string[] = []
    present({ items: [{ id: 'a', label: 'A' }], x: 0, y: 0, onSelect: id => chosen.push(`first:${id}`) })
    el.hide()
    await tick()
    present({ items: [{ id: 'b', label: 'B' }], x: 0, y: 0, onSelect: id => chosen.push(`second:${id}`) })
    await choose(el, 'B')
    expect(chosen).toEqual(['second:b'])
  })
})
