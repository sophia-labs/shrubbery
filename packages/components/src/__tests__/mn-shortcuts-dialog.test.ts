import { beforeEach, describe, expect, it } from 'vitest'
import {
  MnShortcutsDialog,
  formatShortcutLabel,
  type MnShortcutRunDetail,
} from '../mn-shortcuts-dialog.js'

const COMMANDS = [
  {
    id: 'panel.toggle.chat',
    label: 'Toggle Chat Panel',
    category: 'View',
    shortcut: 'Mod+Shift+C',
    keywords: ['assistant', 'panel'],
  },
  {
    id: 'editor.footnote',
    label: 'Insert Footnote',
    category: 'Editor',
    shortcut: 'Mod+Shift+F',
    keywords: ['note', 'citation'],
  },
  {
    id: 'document.open',
    label: 'Open Document',
    category: 'Document',
    shortcut: 'Enter',
    disabled: true,
  },
] as const

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnShortcutsDialog) => void): Promise<MnShortcutsDialog> {
  const el = document.createElement('mn-shortcuts-dialog') as MnShortcutsDialog
  el.commands = COMMANDS
  el.open = true
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-shortcuts-dialog', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('formats shortcuts with platform-specific modifiers', () => {
    expect(formatShortcutLabel('Mod+Shift+F', 'mac')).toBe('⌘⇧F')
    expect(formatShortcutLabel('Cmd+Alt+ArrowDown', 'mac')).toBe('⌘⌥↓')
    expect(formatShortcutLabel('Mod+Shift+F', 'windows')).toBe('Ctrl+Shift+F')
    expect(formatShortcutLabel('Enter', 'linux')).toBe('Enter')
  })

  it('renders grouped shortcut rows and mac keycaps', async () => {
    const el = await mount(dialog => {
      dialog.platform = 'mac'
    })

    expect(customElements.get('mn-shortcuts-dialog')).toBeDefined()
    expect(sr(el).querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Keyboard Shortcuts')
    expect(Array.from(sr(el).querySelectorAll('.category')).map(node => node.textContent)).toEqual([
      'View',
      'Editor',
      'Document',
    ])
    expect(Array.from(sr(el).querySelectorAll('.label')).map(node => node.textContent)).toEqual([
      'Toggle Chat Panel',
      'Insert Footnote',
      'Open Document',
    ])
    expect(sr(el).querySelector('kbd')?.textContent).toBe('⌘⇧C')
    expect(sr(el).querySelector<HTMLButtonElement>('.row[disabled]')?.textContent).toContain('Open Document')
  })

  it('filters by label, category, shortcut, and keywords', async () => {
    const el = await mount()
    const search = sr(el).querySelector('mn-search-input')!

    search.dispatchEvent(new CustomEvent('mn-input', { detail: { value: 'citation' }, bubbles: true, composed: true }))
    await el.updateComplete
    expect(Array.from(sr(el).querySelectorAll('.label')).map(node => node.textContent)).toEqual(['Insert Footnote'])

    search.dispatchEvent(new CustomEvent('mn-input', { detail: { value: 'view' }, bubbles: true, composed: true }))
    await el.updateComplete
    expect(Array.from(sr(el).querySelectorAll('.label')).map(node => node.textContent)).toEqual(['Toggle Chat Panel'])

    search.dispatchEvent(new CustomEvent('mn-input', { detail: { value: 'shift+f' }, bubbles: true, composed: true }))
    await el.updateComplete
    expect(Array.from(sr(el).querySelectorAll('.label')).map(node => node.textContent)).toEqual(['Insert Footnote'])
  })

  it('emits run intent for click and closes without executing disabled rows', async () => {
    const el = await mount()
    const runs: MnShortcutRunDetail[] = []
    el.addEventListener('mn-shortcut-run', event => {
      runs.push((event as CustomEvent<MnShortcutRunDetail>).detail)
    })

    sr(el).querySelectorAll<HTMLButtonElement>('.row')[1]!.click()
    await el.updateComplete
    expect(el.open).toBe(false)
    expect(runs.map(run => run.id)).toEqual(['editor.footnote'])

    el.open = true
    await el.updateComplete
    sr(el).querySelectorAll<HTMLButtonElement>('.row')[2]!.click()
    expect(runs.map(run => run.id)).toEqual(['editor.footnote'])
  })

  it('supports Escape close and Arrow/Enter keyboard execution', async () => {
    const el = await mount()
    const runs: MnShortcutRunDetail[] = []
    const closed: string[] = []
    el.addEventListener('mn-shortcut-run', event => {
      runs.push((event as CustomEvent<MnShortcutRunDetail>).detail)
    })
    el.addEventListener('mn-close', () => closed.push('close'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, metaKey: true }))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.id).toBe('editor.footnote')
    expect(runs[0]!.modifiers.metaKey).toBe(true)

    el.open = true
    await el.updateComplete
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(el.open).toBe(false)
    expect(closed).toEqual(['close'])
  })
})
