/**
 * REAL component test — the Files tree (review G1 / P0.2, V4 / P1.12). NO MOCKS:
 * the real `mn-sidebar-panel`, real `mn-badge` and `mn-file-glyph`, in happy-dom.
 *
 * The incident. The fixture stored the sentence "Saved in this browser" in each
 * file's lifecycle `status`. The tree rendered any status as a badge that never
 * shrank (`flex-shrink: 0`) next to a label allowed to shrink to nothing
 * (`min-width: 0`), so all six rows read "SAVED IN THIS BROWSER" and no name, and
 * a search for "therm" showed a row with no name either. The repair has two
 * halves, tested here: `status` is lifecycle and a ready file draws no badge; and
 * the tree guarantees the label whatever a producer sends.
 *
 * Layout cannot run in happy-dom, so the label floor and the badge's
 * shrink-and-ellipsize are asserted on the shipped CSS here, and measured in
 * real Chromium by the round's browser witness (tree rows at 236 px).
 */
import { afterEach, describe, expect, it } from 'vitest'
import '../mn-sidebar-panel.js'
import type { MnBadge } from '../mn-badge.js'
import type { MnFileGlyph } from '../mn-file-glyph.js'
import type { MnSidebarNode, MnSidebarPanel, MnSidebarSection } from '../mn-sidebar-panel.js'

afterEach(() => document.body.replaceChildren())

async function mount(setup: (el: MnSidebarPanel) => void): Promise<MnSidebarPanel> {
  const el = document.createElement('mn-sidebar-panel') as MnSidebarPanel
  setup(el)
  document.body.append(el)
  await el.updateComplete
  return el
}

const sr = (el: MnSidebarPanel) => el.shadowRoot!
const row = (el: MnSidebarPanel, id: string) => sr(el).querySelector<HTMLElement>(`.tree-row[data-node-id="${id}"]`)!
const badgeOf = (el: MnSidebarPanel, id: string) => row(el, id).querySelector<MnBadge>('.badge')
const glyphOf = (el: MnSidebarPanel, id: string) => row(el, id).querySelector<MnFileGlyph>('mn-file-glyph')
const cssText = (el: MnSidebarPanel) => [(el.constructor as { styles?: unknown }).styles].flat()
  .map(s => (s as { cssText?: string }).cssText ?? '').join('\n')

/** Six PDFs named like the review's fixture, each ready, shaped as the fixture shell sends them. */
const names = [
  'TPS62840 buck converter datasheet rev C.pdf', 'Enclosure drawing v4 (final, approved by Lucy).pdf',
  'Field notes 2026-09-18.pdf', 'Supplier quote Q-88123.pdf',
  'Thermal test report - batch 7 - 2026-09-30 - preliminary results for review.pdf', 'BOM.pdf',
]
const pdf = (id: string, label: string, extra: Partial<MnSidebarNode> = {}): MnSidebarNode =>
  ({ id, label, kind: 'artifact', fileType: 'pdf', status: 'ready', ...extra })
const readyFiles = (): MnSidebarSection[] => [{ id: 'artifacts', label: 'Files', icon: 'file-text',
  nodes: names.map((label, i) => pdf(`artifact:${i}`, label)) }]

describe('the Files tree: status is lifecycle, so a ready file draws no badge', () => {
  it('shows each ready file as its name and nothing else', async () => {
    const el = await mount(e => { e.sections = readyFiles() })
    for (const [i, label] of names.entries()) {
      expect(row(el, `artifact:${i}`).querySelector('.label')!.textContent).toBe(label)
      expect(badgeOf(el, `artifact:${i}`), label).toBeNull()
    }
  })

  it('draws a badge for a lifecycle state, and the name is still there beside it', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
        pdf('a', 'Datasheet.pdf', { status: 'uploading' }), pdf('b', 'Quote.pdf', { status: 'processing' }),
        pdf('c', 'Broken.pdf', { status: 'error' }), pdf('d', 'Scan.pdf', { status: 'unavailable' }),
      ] }]
    })
    expect(['a', 'b', 'c', 'd'].map(id => badgeOf(el, id)?.label)).toEqual(['uploading', 'processing', 'error', 'unavailable'])
    expect(['a', 'b', 'c', 'd'].map(id => row(el, id).querySelector('.label')!.textContent))
      .toEqual(['Datasheet.pdf', 'Quote.pdf', 'Broken.pdf', 'Scan.pdf'])
  })

  it('never turns persistence copy into a badge, even if a producer puts it in status', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
        pdf('a', 'Datasheet.pdf', { status: 'Saved in this browser' }), pdf('b', 'Quote.pdf', { status: 'Sample metadata' }),
      ] }]
    })
    expect(badgeOf(el, 'a')).toBeNull()
    expect(badgeOf(el, 'b')).toBeNull()
    expect(sr(el).textContent).not.toMatch(/saved in this browser/i)
  })

  it('still draws an explicit badge a producer chose (a document that is Pending or Parked)', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'documents', label: 'Documents', nodes: [
        { id: 'p', label: 'Draft', kind: 'document', badge: 'Pending', badgeTone: 'active', sourceState: 'pending' },
      ] }]
    })
    expect(badgeOf(el, 'p')?.label).toBe('Pending')
  })

  it('shows a searched-for name: "therm" leaves one row, and it carries the whole name', async () => {
    const el = await mount(e => { e.sections = readyFiles(); e.searchQuery = 'therm' })
    const rows = [...sr(el).querySelectorAll('.tree-row')]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.querySelector('.label')!.textContent).toBe(names[4])
    expect(rows[0]!.querySelector('.badge')).toBeNull()
  })
})

describe('the Files tree: the label is guaranteed, the badge gives way first (shipped CSS)', () => {
  const rule = (css: string, selector: string) =>
    css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
      .find(block => block.trim().split('{')[0]!.split(',').map(part => part.trim()).includes(selector)) ?? ''

  it('holds the label at no less than twelve characters, the width P0.2 promises', async () => {
    const label = rule(cssText(await mount(() => {})), '.label')
    expect(label).toMatch(/min-width:\s*12ch/)
    expect(label).not.toMatch(/min-width:\s*0\b/)
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('lets the badge shrink (it can no longer be flex-shrink: 0) and bounds it', async () => {
    const badge = rule(cssText(await mount(() => {})), '.badge')
    expect(badge).not.toMatch(/flex-shrink:\s*0/)
    expect(badge).toMatch(/flex:\s*0 1 auto/)
    expect(badge).toMatch(/min-width:\s*0/)
    expect(badge).toMatch(/max-width:\s*\d+%/)
  })

  it('ellipsizes the badge text through its part, so it ends in … instead of pushing the name out', async () => {
    const part = rule(cssText(await mount(() => {})), '.badge::part(badge)')
    expect(part).toMatch(/text-overflow:\s*ellipsis/)
    expect(part).toMatch(/overflow:\s*hidden/)
  })
})

describe('the Files tree uses the one glyph (V4)', () => {
  it('draws folders and files with mn-file-glyph at 16px, where it drew an amber folder and a diamond', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
        { id: 'folder:1', label: 'Datasheets', kind: 'folder', expanded: true, icon: 'folder', children: [pdf('artifact:1', 'One.pdf', { icon: 'diamond' })] },
      ] }]
    })
    const folder = glyphOf(el, 'folder:1')!, file = glyphOf(el, 'artifact:1')!
    expect([folder.kind, folder.size, file.kind, file.size]).toEqual(['folder', 16, 'file', 16])
    expect(file.type).toBe('pdf')
    expect(row(el, 'artifact:1').querySelector('.node-icon svg.mn-icon')).toBeNull()
  })

  it('leaves documents and tags on their icons', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'documents', label: 'Documents', nodes: [{ id: 'd', label: 'Notes', kind: 'document' }] },
        { id: 'tags', label: 'Tags', nodes: [{ id: 't', label: 'todo', kind: 'tag' }] }]
    })
    expect(glyphOf(el, 'd')).toBeNull()
    expect(row(el, 'd').querySelector('.node-icon svg')).not.toBeNull()
  })

  it('honours a producer’s own icon for a folder or file; only the generic defaults give way to the glyph', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
        { id: 'pinned', label: 'Pinned', kind: 'folder', icon: 'hash' }, { id: 'plain', label: 'Plain', kind: 'folder' },
      ] }]
    })
    expect(glyphOf(el, 'pinned')).toBeNull()
    expect(row(el, 'pinned').querySelector('.node-icon svg')).not.toBeNull()
    expect(glyphOf(el, 'plain')).not.toBeNull()
  })

  it('draws accent only for selection: a selected or active row selects its glyph', async () => {
    const el = await mount(e => { e.sections = readyFiles(); e.selectedIds = ['artifact:1']; e.activeId = 'artifact:3' })
    expect([0, 1, 2, 3].map(i => glyphOf(el, `artifact:${i}`)!.selected)).toEqual([false, true, false, true])
  })

  it('shows a lifecycle state with its own icon instead of the glyph', async () => {
    const el = await mount(e => { e.sections = [{ id: 'artifacts', label: 'Files', nodes: [pdf('a', 'Scan.pdf', { status: 'processing' }), pdf('b', 'Bad.pdf', { status: 'error' })] }] })
    expect(glyphOf(el, 'a')).toBeNull()
    expect(glyphOf(el, 'b')).toBeNull()
    expect(row(el, 'a').querySelector('.node-icon svg.mn-icon')).not.toBeNull()
    expect(row(el, 'b').querySelector('.node-icon svg.mn-icon')).not.toBeNull()
  })

  it('draws the same glyph in the column presentation', async () => {
    const el = await mount(e => {
      e.presentation = 'columns'
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
        { id: 'folder:1', label: 'Datasheets', kind: 'folder', children: [] }, pdf('artifact:1', 'One.pdf'),
      ] }]
    })
    const glyphs = [...sr(el).querySelectorAll<MnFileGlyph>('[data-column-node] mn-file-glyph')]
    expect(glyphs.map(g => [g.kind, g.size])).toEqual([['folder', 16], ['file', 16]])
  })
})

describe('the Files tree: a file that is uploading or processing shows a real progress glyph', () => {
  const progress = (el: MnSidebarPanel, id: string) => row(el, id).querySelector('.node-icon')!
  const states = async () => mount(e => {
    e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
      pdf('up', 'Uploading.pdf', { status: 'uploading' }), pdf('work', 'Processing.pdf', { status: 'processing' }),
      pdf('bad', 'Broken.pdf', { status: 'error' }),
    ] }]
  })

  it('draws a drawn icon, not the blank placeholder the unknown name "loader" used to produce', async () => {
    const el = await states()
    for (const id of ['up', 'work', 'bad']) {
      expect(progress(el, id).querySelector('svg.mn-icon'), `${id} has a real svg`).not.toBeNull()
      expect(progress(el, id).querySelector('.icon-placeholder'), `${id} has no placeholder`).toBeNull()
      expect(progress(el, id).querySelectorAll('svg path, svg circle, svg line').length, `${id} draws something`).toBeGreaterThan(0)
    }
  })

  it('uses the spinner for uploading and processing (the same drawing), and a different one for error', async () => {
    const el = await states()
    const shape = (id: string) => progress(el, id).querySelector('svg')!.innerHTML
    expect(shape('up')).toBe(shape('work'))
    expect(shape('up')).not.toBe(shape('bad'))
  })

  it('draws the loading surface of an empty tree with the same real spinner', async () => {
    const el = await mount(e => { e.sections = []; e.status = 'loading' })
    const surface = sr(el).querySelector('[data-sidebar-state="loading"]')!
    expect(surface.querySelector('svg.mn-icon')).not.toBeNull()
    expect(surface.querySelector('.icon-placeholder')).toBeNull()
  })

  it('has no blank icon in any state the panel can be in', async () => {
    for (const status of ['idle', 'loading', 'reconnecting', 'disconnected', 'error', 'ready'] as const) {
      const el = await mount(e => { e.status = status; e.error = 'Could not load'; e.sections = status === 'ready' ? readyFiles() : [] })
      expect(sr(el).querySelectorAll('.icon-placeholder').length, `status=${status}`).toBe(0)
      el.remove()
    }
  })

  it('is information in colour whatever kind of row it is on, and keeps the row’s ink on a bevelled highlight (98, Hotdog Stand)', async () => {
    const css = cssText(await mount(() => {})).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.tree-row\[data-status='uploading'\] \.node-icon, \.tree-row\[data-status='processing'\] \.node-icon \{[^}]*color: var\(--mn-color-info/)
    expect(css).toMatch(/\.tree-row\[data-status='error'\] \.node-icon \{[^}]*color: var\(--mn-color-danger/)
    expect(css).toMatch(/:host\(:is\(\[data-skin='98'\], \[data-skin='hotdog-stand'\]\)\) :is\(\.tree-row, \.column-row\):is\([^)]*\) :is\(\.node-icon, \.state-icon\) \{[^}]*color: inherit/)
  })

  it('takes its colour from the row, a token, and stops pulsing when motion is reduced', async () => {
    const css = cssText(await mount(() => {}))
    expect(css.replace(/\s+/g, ' ')).toMatch(/\.node-icon \{[^}]*color: var\(--mn-color-text-secondary/)
    expect(css.replace(/\s+/g, ' ')).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*data-status='uploading'\] \.node-icon[^}]*animation: none/)
  })
})

describe('the Files tree: a state gives way to an icon with a name, never to "UN…"', () => {
  const names = (el: MnSidebarPanel, id: string) => ({
    trail: row(el, id).querySelector('.trail'),
    label: row(el, id).querySelector('.trail > .label')?.textContent,
    text: row(el, id).querySelector<MnBadge>('.trail > .state > mn-badge.state-text'),
    icon: row(el, id).querySelector('.trail > .state > .state-icon'),
    lead: row(el, id).querySelector('.node-icon'),
  })
  const rows = async () => mount(e => {
    e.sections = [{ id: 'artifacts', label: 'Files', nodes: [
      pdf('gone', 'Display datasheet.pdf', { status: 'unavailable' }), pdf('up', 'Uploading.pdf', { status: 'uploading' }),
      pdf('work', 'Processing.pdf', { status: 'processing' }), pdf('bad', 'Broken.pdf', { status: 'error' }),
      pdf('odd', 'Odd.pdf', { status: 'needs-review' }), pdf('fine', 'Quiet.pdf'),
      { id: 'doc', label: 'Draft', kind: 'document', badge: 'Pending', badgeTone: 'active', sourceState: 'pending' },
    ] }]
  })

  it('wraps the name and its state in one trail, the width the state is judged against', async () => {
    const el = await rows()
    for (const id of ['gone', 'up', 'work', 'bad', 'odd', 'fine', 'doc']) expect(names(el, id).trail, id).not.toBeNull()
    expect(names(el, 'gone').label).toBe('Display datasheet.pdf')
  })

  it('draws a state the file keeps its glyph for as a text badge AND an icon, each with one job', async () => {
    const { text, icon, lead } = names(await rows(), 'gone')
    expect(text?.label).toBe('unavailable')
    expect(text?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('role')).toBe('img')
    expect(icon?.getAttribute('aria-label')).toBe('Unavailable')
    expect(icon?.getAttribute('title')).toBe('Unavailable')
    expect(icon?.querySelector('svg.mn-icon')).not.toBeNull()
    expect(icon?.querySelector('.icon-placeholder')).toBeNull()
    expect(lead?.getAttribute('aria-hidden')).toBe('true')
  })

  it('lets the leading icon be the state where the state replaces it: named, with a tooltip, and no second icon', async () => {
    const el = await rows()
    for (const [id, name] of [['up', 'Uploading'], ['work', 'Processing'], ['bad', 'Error']] as const) {
      const { lead, icon, text } = names(el, id)
      expect(lead?.getAttribute('role'), id).toBe('img')
      expect(lead?.getAttribute('aria-label'), id).toBe(name)
      expect(lead?.getAttribute('title'), id).toBe(name)
      expect(lead?.hasAttribute('aria-hidden'), id).toBe(false)
      expect(icon, `${id} has no trailing duplicate`).toBeNull()
      expect(text?.getAttribute('aria-hidden'), id).toBe('true')
    }
  })

  it('names an unfamiliar one-word state too, with a generic icon', async () => {
    const { icon, text } = names(await rows(), 'odd')
    expect(text?.label).toBe('needs-review')
    expect(icon?.getAttribute('aria-label')).toBe('Needs-review')
    expect(icon?.querySelector('svg.mn-icon')).not.toBeNull()
  })

  it('draws nothing for a ready file: no badge, no icon, nothing to announce', async () => {
    const { text, icon, lead } = names(await rows(), 'fine')
    expect(text).toBeNull()
    expect(icon).toBeNull()
    expect(lead?.getAttribute('aria-hidden')).toBe('true')
    expect(row(await rows(), 'fine').querySelector('.badge')).toBeNull()
  })

  it('leaves a producer’s own badge as it was: its text, shrinking, with the whole word in its title', async () => {
    const el = await rows()
    const badge = row(el, 'doc').querySelector<MnBadge>('.trail > .badge')!
    expect(badge.label).toBe('Pending')
    expect(badge.getAttribute('title')).toBe('Pending')
    expect(badge.classList.contains('state-text')).toBe(false)
    expect(badge.hasAttribute('aria-hidden')).toBe(false)
    expect(row(el, 'doc').querySelector('.state-icon')).toBeNull()
  })

  it('keeps one state when production sends the state as both status and badge (artifactBadge does)', async () => {
    const el = await mount(e => {
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [pdf('a', 'Scan.pdf', { status: 'unavailable', badge: 'unavailable' })] }]
    })
    expect(row(el, 'a').querySelectorAll('.badge')).toHaveLength(1)
    expect(row(el, 'a').querySelector('.state-text')).not.toBeNull()
    expect(row(el, 'a').querySelector('.state-icon')).not.toBeNull()
  })

  it('draws the same states in the column presentation', async () => {
    const el = await mount(e => {
      e.presentation = 'columns'
      e.sections = [{ id: 'artifacts', label: 'Files', nodes: [pdf('gone', 'Display datasheet.pdf', { status: 'unavailable' }), pdf('up', 'Uploading.pdf', { status: 'uploading' })] }]
    })
    const column = (id: string) => sr(el).querySelector(`[data-column-node][data-node-id="${id}"]`)!
    expect(column('gone').querySelector('.trail > .state > .state-text')).not.toBeNull()
    expect(column('gone').querySelector('.trail > .state > .state-icon[aria-label="Unavailable"]')).not.toBeNull()
    expect(column('up').querySelector('.node-icon[aria-label="Uploading"]')).not.toBeNull()
  })

  describe('shipped CSS (the layout itself is measured in Chromium by the round’s witness)', () => {
    const flat = async () => cssText(await mount(() => {})).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ')

    it('makes the trail the container the state is judged against, and holds the name’s floor on it', async () => {
      const css = await flat()
      expect(css).toMatch(/\.trail \{[^}]*container-type: inline-size/)
      expect(css).toMatch(/\.trail \{[^}]*min-width: 12ch/)
      expect(css).toMatch(/\.label \{[^}]*min-width: 12ch/)
    })

    it('shows the text badge where it fits whole, and the icon where it does not: one or the other', async () => {
      const css = await flat()
      // Wide: the icon is only visually hidden (still named for assistive technology), never display: none.
      expect(css).toMatch(/\.state-icon \{[^}]*clip-path: inset\(50%\)/)
      expect(css).not.toMatch(/\.state-icon \{[^}]*display: none/)
      const start = css.search(/@container tree-trail \(max-width: \d+px\) \{/)
      expect(start, 'a container query on the trail hands the state to the icon below a width').toBeGreaterThanOrEqual(0)
      let depth = 0, end = start
      for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}' && --depth === 0) { end = i; break }
      }
      const rule = css.slice(start, end)
      expect(rule).toMatch(/\.badge\.state-text \{[^}]*display: none/)
      expect(rule).toMatch(/\.state-icon \{[^}]*display: inline-flex/)
      expect(rule).toMatch(/\.state-icon \{[^}]*clip-path: none/)
      // The threshold leaves room for the name's twelve characters (about 90px) and a state word beside them.
      const width = Number(rule.match(/max-width: (\d+)px/)![1])
      expect(width).toBeGreaterThanOrEqual(200)
      expect(width).toBeLessThan(260)
    })

    it('lets a text state badge be its whole word (it is only shown where it fits)', async () => {
      expect(await flat()).toMatch(/\.badge\.state-text \{[^}]*max-width: none/)
    })
  })
})
