/**
 * The Files pane's menus on one <mn-context-menu>. FilesShell asks for a menu (`items`, a position, `onSelect`); this
 * shows it and hands the chosen id back.
 *
 * <mn-context-menu> hides itself and says `mn-close` synchronously right after it says `mn-select`. A choice that opens
 * another menu ("Move to…" → the folders) therefore runs after the hide: otherwise the second menu is hidden the moment it
 * appears and its handler is cleared by the first menu's close.
 */
import type { MnContextMenu } from '@shrubbery/components'
import type { MenuItemEntry, MenuSelectDetail } from '@shrubbery/nucleus'
import type { FilesMenuItem } from './files-shell.js'

export interface FilesMenuRequest {
  readonly items: readonly FilesMenuItem[]
  readonly x: number
  readonly y: number
  readonly onSelect: (id: string) => void
}

export function filesMenuPresenter(menu: MnContextMenu): (request: FilesMenuRequest) => void {
  let pending: ((id: string) => void) | null = null
  menu.addEventListener('mn-select', ((event: CustomEvent<MenuSelectDetail>) => {
    const select = pending
    pending = null
    const id = event.detail.id
    if (select) setTimeout(() => select(id), 0)
  }) as EventListener)
  menu.addEventListener('mn-close', () => { pending = null })
  return request => {
    pending = request.onSelect
    menu.items = request.items.map(item => ({ id: item.id, label: item.label,
      ...(item.icon ? { icon: item.icon as NonNullable<MenuItemEntry['icon']> } : {}), ...(item.shortcut ? { shortcut: item.shortcut } : {}) }))
    menu.show({ x: request.x, y: request.y }, 'top-left')
  }
}
