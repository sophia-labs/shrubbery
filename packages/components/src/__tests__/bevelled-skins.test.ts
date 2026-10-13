/**
 * REAL test of the shared bevelled-skin blocks — NO MOCKS. The components' "98" blocks (raised and
 * sunken, square, framed controls) are admitted to Hotdog Stand through ONE list (`bevelled-skins.ts`),
 * not through 18 new per-skin blocks. This reads the real stylesheets the components ship and the real
 * skin file, and checks the three things admission means:
 *
 *   1. the blocks that should wear the bevels are keyed on the shared list, for both skins;
 *   2. the blocks that must NOT (a menu is the Menu colour, white, not Button Face) are not;
 *   3. every `--mn-98-*` name those components read is answered by the skin — so a block never
 *      silently falls back to its Windows 95 default inside a Windows 3.1 skin.
 *
 * (The components package never imports token code — it is an island — so the skin file is READ here
 * as text, the way the real browser reads it.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CSSResultGroup } from 'lit'
import { BEVELLED, BEVELLED_SKIN_IDS, WINDOW_LISTED, WINDOW_LISTED_SKIN_IDS } from '../bevelled-skins.js'
import { MnButton } from '../mn-button.js'
import { MnIconButton } from '../mn-icon-button.js'
import { MnInput } from '../mn-input.js'
import { MnTextarea } from '../mn-textarea.js'
import { MnSearchInput } from '../mn-search-input.js'
import { MnCard } from '../mn-card.js'
import { MnPanelHeader } from '../mn-panel-header.js'
import { MnEditorToolbar } from '../mn-editor-toolbar.js'
import { MnEmptyState } from '../mn-empty-state.js'
import { MnLoading } from '../mn-loading.js'
import { MnContinuityStatus } from '../mn-continuity-status.js'
import { MnSidebarPanel } from '../mn-sidebar-panel.js'
import { MnToolbarOverflow } from '../mn-toolbar.js'
import { MnBottomBar } from '../mn-bottom-bar.js'
import { MnWorkspaceSelector } from '../mn-workspace-selector.js'
import { MnTopBar } from '../mn-top-bar.js'
import { MnAppBar } from '../mn-app-bar.js'
import { MnSettingsPage } from '../mn-settings-page.js'
import { MnContextMenu } from '../mn-context-menu.js'

const here = dirname(fileURLToPath(import.meta.url))
const SKIN_FILE = resolve(here, '../../../tokens/css/skin-hotdog-stand.css')

function rawCssOf(styles: CSSResultGroup | undefined): string {
  if (!styles) return ''
  if (Array.isArray(styles)) return styles.map(s => rawCssOf(s as CSSResultGroup)).join('\n')
  return (styles as unknown as { cssText: string }).cssText
}
/** The stylesheet with its whitespace collapsed, so a pin never depends on how a rule was wrapped. */
const cssTextOf = (styles: CSSResultGroup | undefined): string => rawCssOf(styles).replace(/\s+/g, ' ')

const LIST = ":is([data-skin='98'], [data-skin='hotdog-stand'])"
const host = (rest: string) => `:host(${LIST}) ${rest}`

// [component, a selector tail that must be keyed on the shared list]
const ADMITTED: ReadonlyArray<readonly [string, { styles?: CSSResultGroup }, string]> = [
  ['mn-button', MnButton, 'button {'],
  ['mn-icon-button', MnIconButton, 'button {'],
  ['mn-icon-button tooltip', MnIconButton, '.tooltip {'],
  ['mn-input', MnInput, '.input-wrap {'],
  ['mn-textarea', MnTextarea, '.wrap {'],
  ['mn-search-input', MnSearchInput, '.wrap {'],
  ['mn-card', MnCard, '.card {'],
  ['mn-panel-header', MnPanelHeader, ':is(.badge, .collapse-btn) {'],
  ['mn-editor-toolbar', MnEditorToolbar, '[data-read-only-badge]'],
  ['mn-empty-state', MnEmptyState, '.icon-container {'],
  ['mn-loading', MnLoading, '.dot'],
  ['mn-continuity-status', MnContinuityStatus, '.status {'],
  ['mn-sidebar-panel controls', MnSidebarPanel, ':is(.icon-button, .section-header, .node-menu, .column-row) {'],
  ['mn-sidebar-panel selection', MnSidebarPanel, ':is(.tree-row, .column-row):is(:hover'],
  ['mn-toolbar overflow', MnToolbarOverflow, '.overflow-button {'],
  ['mn-bottom-bar toggles', MnBottomBar, '.toggle-btn:hover'],
  ['mn-workspace-selector trigger', MnWorkspaceSelector, '.trigger {'],
  ['mn-top-bar actions', MnTopBar, '.action-btn {'],
  ['mn-app-bar actions', MnAppBar, '.action-btn {'],
  ['mn-settings-page navigation', MnSettingsPage, ".nav-item[data-active='true'] {"],
  ['mn-context-menu items', MnContextMenu, '.menu-item:hover'],
]

// A menu is the Menu colour (white, framed) in Windows 3.1, not Button Face: those containers keep
// the skin's own popover roles, so the 98 container blocks are NOT admitted. Their ITEMS are.
const NOT_ADMITTED: ReadonlyArray<readonly [string, { styles?: CSSResultGroup }, string]> = [
  ['mn-context-menu container', MnContextMenu, '.menu {'],
  ['mn-toolbar overflow menu', MnToolbarOverflow, '.menu {'],
  ['mn-workspace-selector menus', MnWorkspaceSelector, ".menu, :host([data-skin='98']) .action-menu {"],
  ['mn-top-bar app switcher', MnTopBar, '.app-switcher {'],
]

describe('bevelled skins: one list, two skins', () => {
  it('the shared list is exactly skin-98 and Hotdog Stand, and it renders as one :is() selector', () => {
    expect([...BEVELLED_SKIN_IDS]).toEqual(['98', 'hotdog-stand'])
    expect(BEVELLED.cssText).toBe(LIST)
  })

  it.each(ADMITTED)('%s is keyed on the shared list (and so wears the bevels in both skins)', (_name, component, tail) => {
    const css = cssTextOf(component.styles)
    expect(css).toContain(host(tail))
  })

  it.each(NOT_ADMITTED)('%s is not admitted: its container stays on the skin\'s own popover roles', (_name, component, tail) => {
    const css = cssTextOf(component.styles)
    expect(css).not.toContain(host(tail.replace(":host([data-skin='98']) ", `:host(${LIST}) `)))
    // …while the 98 container block itself is still there for 98 (nothing was weakened).
    expect(css).toContain(`:host([data-skin='98']) ${tail}`)
  })

  it('selection text is a token, never a hard-coded #fff: Highlight is yellow after hours, and white on yellow is 1.07:1', () => {
    for (const [name, component] of ADMITTED) {
      const css = cssTextOf(component.styles)
      expect(css, name).not.toMatch(/--mn-98-selection[^;}]*;\s*color:\s*#fff\b/)
    }
    expect(cssTextOf(MnContextMenu.styles)).toContain('color: var(--mn-98-selection-text, #fff)')
  })
})

describe('bevelled skins: the skin answers every --mn-98-* name the shared blocks read', () => {
  const skin = readFileSync(SKIN_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const defined = new Set([...skin.matchAll(/(--mn-98-[\w-]+)\s*:/g)].map(m => m[1]))

  it('no admitted component reads a --mn-98-* name the skin leaves to its Windows 95 default', () => {
    const read = new Set<string>()
    for (const [, component] of ADMITTED) {
      for (const m of cssTextOf(component.styles).matchAll(/var\((--mn-98-[\w-]+)/g)) read.add(m[1])
    }
    const unanswered = [...read].filter(name => !defined.has(name)).sort()
    // --mn-98-desktop and -caption-end are skin-98's own (the teal desktop, the gradient's far end);
    // no admitted block reads them, and the skin has no use for them.
    expect(unanswered).toEqual([])
  })

  it('and answers them from its own slots — never a retyped colour', () => {
    for (const name of defined) {
      const value = skin.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))![1]
      expect(value, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    }
  })
})

describe('window lists: the sidebar paints its lists as Windows 3.1 list boxes, for the skins that ask', () => {
  const skin = readFileSync(SKIN_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const SELECTOR = ":host(:is([data-skin='hotdog-stand'])) :is(.section-body, .column-list) {"
  const css = cssTextOf(MnSidebarPanel.styles)
  const block = (): string => {
    const at = css.indexOf(SELECTOR)
    expect(at, 'the window-list block exists').toBeGreaterThanOrEqual(0)
    return css.slice(at + SELECTOR.length, css.indexOf('}', at))
  }

  it('the list is its own one-skin list, and renders as one :is() selector', () => {
    expect([...WINDOW_LISTED_SKIN_IDS]).toEqual(['hotdog-stand'])
    expect(WINDOW_LISTED.cssText).toBe(":is([data-skin='hotdog-stand'])")
  })

  it('a list is the list surface with the list ink, and the ink roles inside it are re-scoped to it', () => {
    const b = block()
    for (const decl of [
      'background: var(--mn-list-surface);',
      'color: var(--mn-list-ink);',
      '--mn-color-text-primary: var(--mn-list-ink);',
      '--mn-color-text-secondary: var(--mn-list-ink);',
      '--mn-color-text-tertiary: var(--mn-list-ink);',
      // the folder, artifact and error glyphs are drawn in warning, info and danger: on the Window they take the ink
      '--mn-color-text-warning: var(--mn-list-ink);',
      '--mn-color-info: var(--mn-list-ink);',
      '--mn-color-danger: var(--mn-list-ink);',
      '--mn-color-surface-hover: var(--mn-list-hover);',
      '--mn-color-surface-sunken: var(--mn-list-hover);',
    ]) expect(b, decl).toContain(decl)
  })

  it('selection inside a list is Highlight on Highlighted Text: the active row, the hovered row and the shared 98 selection', () => {
    const b = block()
    for (const decl of [
      '--mn-color-surface-accent-strong: var(--mn-list-selected-surface);',
      '--mn-color-text-accent: var(--mn-list-selected-ink);',
      '--mn-color-border-accent: var(--mn-list-selected-ink);',
      '--mn-98-selection: var(--mn-list-selected-surface);',
      '--mn-98-selection-text: var(--mn-list-selected-ink);',
    ]) expect(b, decl).toContain(decl)
  })

  it('every --mn-list-* name the sidebar reads is answered by the skin', () => {
    const read = new Set([...css.matchAll(/var\((--mn-list-[\w-]+)/g)].map(m => m[1]))
    expect(read.size).toBeGreaterThan(0)
    for (const name of read) expect(skin, name).toMatch(new RegExp(`${name}\\s*:`))
  })

  it('no other component paints Window lists, and the 98 skin never reads --mn-list-*', () => {
    for (const [name, component] of ADMITTED) {
      if (component === MnSidebarPanel) continue
      expect(cssTextOf(component.styles), name).not.toContain('--mn-list-')
    }
  })
})

describe('selected menu rows: nothing keeps a grey that was chosen for a white row (every bevelled skin)', () => {
  // The browser's text audit caught it first in Hotdog Stand: on the highlighted row of the context menu the row's own
  // colour switches to the selection text, but the shortcut ("F2"), the icon, the check and the submenu arrow each set
  // their own muted grey, so they stayed #383838 on Highlight black (1.8:1) and #e0e0e0 on Highlight yellow after hours
  // (1.2:1). 98 had the very same grey on its navy row (1.37:1). The fix rides the shared list, so both skins get it,
  // and so does any skin admitted to the list later. (The rendered contrast is measured in a real browser, by
  // apps/organism/scripts/context-menu-row-contrast-browser.mts: this file pins the structure.)
  const css = cssTextOf(MnContextMenu.styles)
  const RULE = host(':is(.menu-item:hover, .menu-item.focused) :is(.item-icon, .item-check, .submenu-icon, .item-shortcut) { color: var(--mn-98-selection-text, #fff); }')

  it('the row\'s icon, check, submenu arrow and shortcut take the selection text on a hovered or focused row, in every bevelled skin', () => {
    expect(css).toContain(RULE)
  })

  it('it is ONE rule on the shared list, not a copy per skin: no skin-keyed variant of it remains', () => {
    expect(css).not.toMatch(/:host\(\[data-skin='[\w-]+'\]\) :is\(\.menu-item/)
    expect(css.match(/:is\(\.item-icon, \.item-check, \.submenu-icon, \.item-shortcut\)/g) ?? []).toHaveLength(1)
  })
})
