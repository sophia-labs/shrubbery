/**
 * Context-menu row contrast harness: ONE real <mn-context-menu> on a bare page, so a real Chromium can measure what its
 * highlighted row actually paints, skin by skin and theme by theme (scripts/context-menu-row-contrast-browser.mts). No
 * cell and no shell: the menu is the unit under test. Dev-server-only, like the other *-harness.html pages.
 *
 * The rows carry every kind of child a row can have: a label, an icon, a check, a shortcut, a submenu arrow, and a
 * danger variant. The skins under test are the shared bevelled list itself (BEVELLED_SKIN_IDS), so a skin admitted to
 * that list is put under this test by the admission.
 */
import '@shrubbery/tokens/tokens.css'
import { BEVELLED_SKIN_IDS, type MnContextMenu, type MnContextMenuEntry } from '@shrubbery/components'

const ITEMS: readonly MnContextMenuEntry[] = [
  { type: 'header', content: 'Document' },
  { id: 'rename', label: 'Rename…', icon: 'pencil', shortcut: 'F2' },
  { id: 'wrap', label: 'Wrap lines', icon: 'file-text', checked: true },
  { id: 'move', label: 'Move to folder…', icon: 'folder', submenu: [{ id: 'move-here', label: 'Here' }] },
  { type: 'divider' },
  { id: 'export', label: 'Export', icon: 'download', shortcut: '⌘E' },
  { id: 'delete', label: 'Delete', icon: 'trash', variant: 'danger', shortcut: '⌫' },
]

declare global {
  interface Window {
    __contextMenuHarness?: { ready: true; skins: readonly string[]; items: number; open(): void; close(): void }
  }
}

const menu = document.createElement('mn-context-menu') as MnContextMenu
menu.items = ITEMS
document.body.append(menu)

window.__contextMenuHarness = {
  ready: true,
  skins: [...BEVELLED_SKIN_IDS],
  items: ITEMS.filter(entry => !('type' in entry)).length,
  open: () => menu.show({ x: 48, y: 48 }, 'top-left'),
  close: () => menu.hide(),
}
