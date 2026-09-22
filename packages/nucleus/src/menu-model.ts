/**
 * Shared menu data model for command-bearing surfaces.
 *
 * This is intentionally UI-free. Components can widen the `custom` renderer
 * type at their boundary if they need framework-specific templates.
 */

export type IconName = string

export interface MenuItemEntry {
  readonly id: string
  readonly label: string
  readonly icon?: IconName
  readonly shortcut?: string
  readonly checked?: boolean
  readonly disabled?: boolean
  readonly variant?: 'default' | 'danger'
  readonly submenu?: readonly MenuEntry[]
}

export interface MenuDivider {
  readonly type: 'divider'
}

export interface MenuHeader {
  readonly type: 'header'
  readonly content: string
}

export interface MenuCustomEntry {
  readonly type: 'custom'
  readonly render: () => unknown
}

export type MenuEntry = MenuItemEntry | MenuDivider | MenuHeader | MenuCustomEntry

export function isMenuDivider(entry: MenuEntry): entry is MenuDivider {
  return 'type' in entry && entry.type === 'divider'
}

export function isMenuHeader(entry: MenuEntry): entry is MenuHeader {
  return 'type' in entry && entry.type === 'header'
}

export function isMenuCustom(entry: MenuEntry): entry is MenuCustomEntry {
  return 'type' in entry && entry.type === 'custom'
}

export function isMenuItem(entry: MenuEntry): entry is MenuItemEntry {
  return !('type' in entry)
}

export interface MenuSelectModifiers {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

export interface MenuSelectDetail {
  readonly id: string
  readonly item: MenuItemEntry
  readonly modifiers: MenuSelectModifiers
}
