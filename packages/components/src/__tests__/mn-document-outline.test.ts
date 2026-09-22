/** Real Happy DOM contract for the controlled left-rail document outline panel. */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import '../mn-document-outline.js'
import type {
  MnDocumentOutline,
  MnOutlineCommandDetail,
  MnOutlineNavigateDetail,
} from '../mn-document-outline.js'

async function mount(setup?: (el: MnDocumentOutline) => void): Promise<MnDocumentOutline> {
  const el = document.createElement('mn-document-outline') as MnDocumentOutline
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnDocumentOutline) => el.shadowRoot!

afterEach(() => { document.body.innerHTML = '' })

const HEADINGS = [
  { id: 'block-h1', level: 1, text: 'Intro' },
  { id: 'block-h2', level: 2, text: 'Details' },
  { id: 'block-h3', level: 3, text: 'Sub-detail' },
] as const

describe('mn-document-outline — controlled left-rail outline panel', () => {
  beforeAll(() => {
    expect(customElements.get('mn-document-outline')).toBeDefined()
  })

  it('shows a "no document open" empty state when documentOpen is false', async () => {
    const el = await mount()
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No document open')
    expect(sr(el).querySelector('.headings')).toBeNull()
  })

  it('shows a "no headings yet" empty state for an open document with none', async () => {
    const el = await mount((node) => { node.documentOpen = true })
    expect(sr(el).querySelector('mn-empty-state')?.getAttribute('title')).toBe('No headings yet')
  })

  it('renders headings indented by level, most-indented first-level being level 1', async () => {
    const el = await mount((node) => {
      node.documentOpen = true
      node.headings = HEADINGS
    })
    const entries = Array.from(sr(el).querySelectorAll('.heading-entry')) as HTMLButtonElement[]
    expect(entries.map((entry) => entry.textContent)).toEqual(['Intro', 'Details', 'Sub-detail'])
    expect(entries.map((entry) => entry.getAttribute('data-heading-id'))).toEqual([
      'block-h1',
      'block-h2',
      'block-h3',
    ])
    // Level 1 has the smallest inset; deeper levels indent further.
    expect(entries[0].style.paddingInlineStart).not.toBe(entries[1].style.paddingInlineStart)
  })

  it('marks the entry matching activeHeadingId as aria-current', async () => {
    const el = await mount((node) => {
      node.documentOpen = true
      node.headings = HEADINGS
      node.activeHeadingId = 'block-h2'
    })
    const entries = Array.from(sr(el).querySelectorAll('.heading-entry')) as HTMLButtonElement[]
    expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual(['false', 'true', 'false'])
  })

  it('clicking a heading entry emits mn-outline-navigate with its block id', async () => {
    const el = await mount((node) => {
      node.documentOpen = true
      node.headings = HEADINGS
    })
    const navigations: MnOutlineNavigateDetail[] = []
    el.addEventListener('mn-outline-navigate', (event) => {
      navigations.push((event as CustomEvent<MnOutlineNavigateDetail>).detail)
    })
    ;(sr(el).querySelector('[data-heading-id="block-h2"]') as HTMLButtonElement).click()
    expect(navigations).toEqual([{ blockId: 'block-h2' }])
  })

  it('renders all 9 outliner command buttons and emits mn-outline-command on click', async () => {
    const el = await mount((node) => { node.documentOpen = true })
    const commandDetails: MnOutlineCommandDetail[] = []
    el.addEventListener('mn-outline-command', (event) => {
      commandDetails.push((event as CustomEvent<MnOutlineCommandDetail>).detail)
    })

    const buttons = sr(el).querySelectorAll('[data-outline-command]')
    expect(buttons.length).toBe(9)

    ;(sr(el).querySelector('[data-outline-command="zoomIn"]') as HTMLElement).click()
    ;(sr(el).querySelector('[data-outline-command="collapseAll"]') as HTMLElement).click()
    expect(commandDetails).toEqual([{ command: 'zoomIn' }, { command: 'collapseAll' }])
  })

  it('disables the command buttons when no document is open', async () => {
    const el = await mount()
    const first = sr(el).querySelector('[data-outline-command="zoomIn"]') as HTMLElement & { disabled: boolean }
    expect(first.disabled).toBe(true)
  })
})
