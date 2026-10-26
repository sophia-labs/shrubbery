/**
 * REAL component test: the panel groups and sorts the whole tree once per input change, not once per
 * `willUpdate`, `render` and key handler. The memo key is the sections array, sort, grouping and locale
 * (group labels are read through t()).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { localeSource } from '@shrubbery/nucleus'
import '../mn-sidebar-panel.js'
import type { MnSidebarPanel, MnSidebarSection } from '../mn-sidebar-panel.js'

type WithDisplay = Omit<MnSidebarPanel, '_displaySections'> & { _displaySections(): MnSidebarSection[] }

function sections(): MnSidebarSection[] {
  return [{ id: 'documents', label: 'Documents', icon: 'file-text', nodes: [
    { id: 'b', label: 'Beta', kind: 'document' },
    { id: 'a', label: 'Alpha', kind: 'document' },
  ] }]
}

async function mount(initial: readonly MnSidebarSection[]): Promise<WithDisplay> {
  const el = document.createElement('mn-sidebar-panel') as unknown as WithDisplay
  el.sections = initial
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-sidebar-panel display memo', () => {
  afterEach(() => {
    localeSource.set('en')
    document.body.replaceChildren()
  })

  it('returns the same grouped and sorted sections until an input changes', async () => {
    const input = sections()
    const el = await mount(input)
    el.sort = { criterion: 'alphabetical', direction: 'asc', foldersFirst: true }
    await el.updateComplete
    const first = el._displaySections()
    expect(first[0]!.nodes!.map(node => node.id)).toEqual(['a', 'b'])
    expect(el._displaySections()).toBe(first)
    expect(el._displaySections()).toBe(first)

    el.sections = sections()
    await el.updateComplete
    const second = el._displaySections()
    expect(second).not.toBe(first)
    expect(el._displaySections()).toBe(second)

    el.sort = { ...el.sort, direction: 'desc' }
    await el.updateComplete
    const third = el._displaySections()
    expect(third).not.toBe(second)
    expect(third[0]!.nodes!.map(node => node.id)).toEqual(['b', 'a'])

    el.grouping = { ...el.grouping, showFolders: !el.grouping.showFolders }
    await el.updateComplete
    expect(el._displaySections()).not.toBe(third)
  })

  it('recomputes when the locale changes, so translated group labels never go stale', async () => {
    const el = await mount([])
    const english = el._displaySections()
    expect(el._displaySections()).toBe(english)
    localeSource.set('ja')
    await el.updateComplete
    expect(el._displaySections()).not.toBe(english)
  })
})
