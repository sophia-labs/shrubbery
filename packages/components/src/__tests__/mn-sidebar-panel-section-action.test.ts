/**
 * REAL component test: a sidebar section may carry ONE action beside its header (the Files section's "Open Files").
 * The action is its own button, never nested in the header button; pressing it emits `mn-sidebar-section-action`
 * and does not collapse the section. A section without an action renders exactly as before.
 */
import { describe, expect, it } from 'vitest'
import '../mn-sidebar-panel.js'
import type { MnSidebarPanel, MnSidebarSection } from '../mn-sidebar-panel.js'

async function mount(sections: readonly MnSidebarSection[]): Promise<MnSidebarPanel> {
  const el = document.createElement('mn-sidebar-panel') as MnSidebarPanel
  el.sections = sections
  document.body.appendChild(el)
  await el.updateComplete
  return el
}
const sr = (el: MnSidebarPanel) => el.shadowRoot!

const FILES: MnSidebarSection = {
  id: 'artifacts', label: 'Files', icon: 'folder', nodes: [], emptyLabel: 'No files yet',
  action: { id: 'open-files', label: 'Open Files', icon: 'folder' },
}

describe('mn-sidebar-panel section action', () => {
  it('draws the action as its own labelled button beside the header', async () => {
    const el = await mount([FILES])
    const section = sr(el).querySelector('[data-section-id="artifacts"]')!
    const action = section.querySelector<HTMLButtonElement>('button.section-action')
    expect(action).not.toBeNull()
    expect(action!.getAttribute('aria-label')).toBe('Open Files')
    expect(action!.closest('.section-header')).toBeNull()
    expect(section.querySelector('.section-header')!.textContent).toContain('Files')
  })

  it('emits the action and leaves the section open', async () => {
    const el = await mount([FILES])
    const seen: unknown[] = []
    const toggles: unknown[] = []
    el.addEventListener('mn-sidebar-section-action', event => { seen.push((event as CustomEvent).detail) })
    el.addEventListener('mn-sidebar-section-toggle', event => { toggles.push((event as CustomEvent).detail) })
    sr(el).querySelector<HTMLButtonElement>('button.section-action')!.click()
    await el.updateComplete
    expect(seen).toEqual([{ sectionId: 'artifacts', actionId: 'open-files', section: FILES }])
    expect(toggles).toEqual([])
    expect(sr(el).querySelector('.section-header')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('a section without an action has no action button', async () => {
    const el = await mount([{ id: 'documents', label: 'Documents', icon: 'file-text', nodes: [] }])
    expect(sr(el).querySelector('button.section-action')).toBeNull()
  })
})
