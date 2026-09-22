/**
 * REAL component test — mn-sidebar-panel left rail shell.
 *
 * NO MOCKS: mounts the real backend-free custom element and drives DOM events
 * through its shadow tree. Data is prop-injected and actions leave as composed
 * intents; the component never reaches a host-side source by itself.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-sidebar-panel.js'
import type { MnBadge } from '../mn-badge.js'
import type {
  MnSidebarActionDetail,
  MnSidebarColumnPathChangeDetail,
  MnSidebarGroupingChangeDetail,
  MnSidebarNodeDetail,
  MnSidebarNodeDropDetail,
  MnSidebarPanel,
  MnSidebarSection,
  MnSidebarSelectionDetail,
  MnSidebarSortChangeDetail,
} from '../mn-sidebar-panel.js'

async function mount(setup?: (el: MnSidebarPanel) => void): Promise<MnSidebarPanel> {
  const el = document.createElement('mn-sidebar-panel') as MnSidebarPanel
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnSidebarPanel) => el.shadowRoot!

const sections: readonly MnSidebarSection[] = [
  {
    id: 'documents',
    label: 'Documents',
    icon: 'file-text',
    nodes: [
      {
        id: 'folder-1',
        label: 'Projects',
        kind: 'folder',
        expanded: true,
        children: [
          { id: 'doc-a', label: 'Garden parity plan', kind: 'document', badge: 'md' },
          { id: 'doc-b', label: 'Wire audit', kind: 'document' },
        ],
      },
      { id: 'artifact-1', label: 'Workflow map', kind: 'artifact', count: 3 },
    ],
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: 'hash',
    nodes: [{ id: 'tag-shrubbery', label: 'shrubbery', kind: 'tag', count: 8 }],
  },
]

describe('mn-sidebar-panel — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-sidebar-panel')).toBeDefined()
  })

  it('upgrades the tag and renders the Garden left-rail structure without data', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(sr(el).querySelector('.sidebar-header')).not.toBeNull()
    expect(sr(el).querySelector('.search-input')).not.toBeNull()
    expect(
      Array.from(sr(el).querySelectorAll('.section-heading')).map((heading) =>
        heading.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Documents', 'Tags'])
    expect(Array.from(sr(el).querySelectorAll('.empty')).map((n) => n.textContent?.trim())).toEqual([
      'No documents',
      'No tags',
    ])
  })

  it('renders controlled sections, nested tree rows, selected state, badges, and counts', async () => {
    const el = await mount((node) => {
      node.sections = sections
      node.selectedId = 'doc-a'
      node.activeId = 'artifact-1'
    })

    const rows = Array.from(sr(el).querySelectorAll('[data-node-id]')) as HTMLElement[]
    expect(rows.map((row) => row.getAttribute('data-node-id'))).toEqual([
      'folder-1',
      'doc-a',
      'doc-b',
      'artifact-1',
      'tag-shrubbery',
    ])
    expect(rows.find((row) => row.getAttribute('data-node-id') === 'doc-a')?.classList.contains('selected')).toBe(true)
    expect(rows.find((row) => row.getAttribute('data-node-id') === 'artifact-1')?.classList.contains('active')).toBe(true)
    // The plain <span class="badge"> was upgraded to a real <mn-badge>
    // (master §3 Slice 4) — its text is the LABEL PROPERTY, rendered inside
    // its own shadow root, not the host's light-DOM textContent.
    expect((sr(el).querySelector('.badge') as MnBadge | null)?.label).toBe('md')
    expect(sr(el).querySelector('[data-node-id="tag-shrubbery"] .node-count')?.textContent).toBe('8')
  })

  // ── source-state badges (master §3 Slice 4) — decorated onto document
  //    nodes by `decorateSidebarSectionsWithSourceState` (apps/organism);
  //    this component only needs to RENDER `badgeTone`/`badge` faithfully,
  //    in BOTH the tree and columns presentations. ────────────────────────

  const sourceStateSections: readonly MnSidebarSection[] = [
    {
      id: 'documents',
      label: 'Documents',
      icon: 'file-text',
      nodes: [
        { id: 'doc-pending', label: 'Draft', kind: 'document', badge: 'Pending', badgeTone: 'active', sourceState: 'pending' },
        { id: 'doc-parked', label: 'Old draft', kind: 'document', badge: 'Parked', badgeTone: 'warning', sourceState: 'parked' },
      ],
    },
  ]

  it('tree presentation: badgeTone drives the real <mn-badge> state, sourceState rides as a data attribute', async () => {
    const el = await mount((node) => { node.sections = sourceStateSections })
    const pending = sr(el).querySelector('[data-node-id="doc-pending"] .badge') as MnBadge
    const parked = sr(el).querySelector('[data-node-id="doc-parked"] .badge') as MnBadge
    expect(pending.state).toBe('active')
    expect(pending.label).toBe('Pending')
    expect(pending.getAttribute('data-source-state')).toBe('pending')
    expect(parked.state).toBe('warning')
    expect(parked.getAttribute('data-source-state')).toBe('parked')
  })

  it('columns presentation: the SAME badgeTone/sourceState decoration renders (a second, independent template)', async () => {
    const el = await mount((node) => {
      node.sections = sourceStateSections
      node.presentation = 'columns'
    })
    const pending = sr(el).querySelector('[data-column-node][data-node-id="doc-pending"] .badge') as MnBadge
    expect(pending.state).toBe('active')
    expect(pending.label).toBe('Pending')
    expect(pending.getAttribute('data-source-state')).toBe('pending')
  })

  it('filters rows locally from the controlled data and preserves matching ancestors', async () => {
    const el = await mount((node) => {
      node.sections = sections
      node.searchQuery = 'parity'
    })

    const rows = Array.from(sr(el).querySelectorAll('[data-node-id]')) as HTMLElement[]
    expect(rows.map((row) => row.getAttribute('data-node-id'))).toEqual(['folder-1', 'doc-a'])
  })

  it('emits composed search, header-action, section, node, and menu intents', async () => {
    const el = await mount((node) => {
      node.sections = sections
    })
    const searches: string[] = []
    const actions: MnSidebarActionDetail[] = []
    const opens: MnSidebarNodeDetail[] = []
    const intents: MnSidebarNodeDetail[] = []
    const intentEnds: MnSidebarNodeDetail[] = []
    const toggles: MnSidebarNodeDetail[] = []
    const sectionToggles: Array<{ id: string; collapsed: boolean }> = []
    el.addEventListener('mn-sidebar-search-change', (event) => {
      searches.push((event as CustomEvent<{ query: string }>).detail.query)
    })
    el.addEventListener('mn-sidebar-action', (event) => {
      actions.push((event as CustomEvent<MnSidebarActionDetail>).detail)
    })
    el.addEventListener('mn-sidebar-node-open', (event) => {
      opens.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-node-intent', (event) => {
      intents.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-node-intent-end', (event) => {
      intentEnds.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-node-toggle', (event) => {
      toggles.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-section-toggle', (event) => {
      sectionToggles.push((event as CustomEvent<{ id: string; collapsed: boolean }>).detail)
    })

    const input = sr(el).querySelector('.search-input') as HTMLInputElement
    input.value = 'wire'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    ;(sr(el).querySelector('[aria-label="New document"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.section-header') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-node-id="folder-1"] .expand') as HTMLButtonElement).click()
    const documentRow = sr(el).querySelector('[data-node-id="doc-a"]') as HTMLElement
    documentRow.dispatchEvent(
      new Event('pointerenter'),
    )
    documentRow.dispatchEvent(new Event('pointerleave'))
    documentRow.click()
    ;(sr(el).querySelector('[data-node-id="doc-a"] .node-menu') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, clientX: 72, clientY: 96 }),
    )

    expect(searches).toEqual(['wire'])
    expect(actions[0]).toEqual({ action: 'new-document' })
    expect(sectionToggles[0]).toMatchObject({ id: 'documents', collapsed: true })
    expect(toggles[0]).toMatchObject({ id: 'folder-1' })
    expect(opens[0]).toMatchObject({ id: 'doc-a' })
    expect(intents[0]).toMatchObject({ id: 'doc-a' })
    expect(intentEnds[0]).toMatchObject({ id: 'doc-a' })
    expect(actions[1]).toMatchObject({ action: 'node-menu', nodeId: 'doc-a', clientX: 72, clientY: 96 })
  })

  it('implements roving ARIA-tree focus, hierarchy arrows, Home/End, typeahead, and Enter activation', async () => {
    const el = await mount((node) => { node.sections = sections })
    await el.updateComplete
    const opens: string[] = []
    const toggles: string[] = []
    const actions: Array<{ action: string; nodeId?: string }> = []
    el.addEventListener('mn-sidebar-node-open', event => {
      opens.push((event as CustomEvent<MnSidebarNodeDetail>).detail.id)
    })
    el.addEventListener('mn-sidebar-node-toggle', event => {
      toggles.push((event as CustomEvent<MnSidebarNodeDetail>).detail.id)
    })
    el.addEventListener('mn-sidebar-action', event => {
      actions.push((event as CustomEvent<MnSidebarActionDetail>).detail)
    })

    const row = (id: string) => sr(el).querySelector(`[data-node-id="${id}"]`) as HTMLElement
    expect(row('folder-1').tabIndex).toBe(0)
    expect(row('doc-a').tabIndex).toBe(-1)

    row('folder-1').focus()
    row('folder-1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await el.updateComplete
    expect(row('doc-a').tabIndex).toBe(0)
    expect(row('doc-a').classList.contains('focused')).toBe(true)

    row('doc-a').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await el.updateComplete
    expect(row('folder-1').tabIndex).toBe(0)

    row('folder-1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(toggles).toEqual(['folder-1'])

    row('folder-1').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await el.updateComplete
    expect(row('tag-shrubbery').tabIndex).toBe(0)

    row('tag-shrubbery').dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))
    await el.updateComplete
    expect(row('doc-b').tabIndex).toBe(0)

    row('doc-b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(opens).toEqual(['doc-b'])

    el.activeId = 'doc-a'
    await el.updateComplete
    row('doc-b').dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    row('doc-b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(actions.map(({ action, nodeId }) => [action, nodeId])).toEqual([
      ['rename', 'doc-a'],
      ['delete', 'doc-b'],
    ])
  })

  it('emits a geometric before/inside/after drop intent without performing a mutation', async () => {
    const el = await mount((node) => { node.sections = sections })
    const drops: MnSidebarNodeDropDetail[] = []
    el.addEventListener('mn-sidebar-node-drop', event => {
      drops.push((event as CustomEvent<MnSidebarNodeDropDetail>).detail)
    })

    const source = sr(el).querySelector('[data-node-id="doc-a"]') as HTMLElement
    const target = sr(el).querySelector('[data-node-id="folder-1"]') as HTMLElement
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, right: 240, bottom: 28, left: 0, width: 240, height: 28, toJSON() {} }),
    })
    const values = new Map<string, string>()
    const transfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData(type: string, value: string) { values.set(type, value) },
      getData(type: string) { return values.get(type) ?? '' },
    } as unknown as DataTransfer
    const dispatchDrag = (element: HTMLElement, type: string, clientY = 0): void => {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as DragEvent
      Object.defineProperties(event, {
        dataTransfer: { configurable: true, value: transfer },
        clientY: { configurable: true, value: clientY },
      })
      element.dispatchEvent(event)
    }

    dispatchDrag(source, 'dragstart')
    dispatchDrag(target, 'dragover', 14)
    await el.updateComplete
    expect(target.classList.contains('drop-inside')).toBe(true)
    dispatchDrag(target, 'drop', 14)

    expect(drops).toHaveLength(1)
    expect(drops[0]).toMatchObject({
      sourceId: 'doc-a',
      targetId: 'folder-1',
      position: 'inside',
    })
    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.dropEffect).toBe('move')
  })

  it('accepts an OS file drop anywhere in the content area (not internal node-reorder drag) and shows a drop-active overlay', async () => {
    const el = await mount((node) => { node.sections = sections })
    const drops: FileList[] = []
    el.addEventListener('mn-sidebar-file-drop', event => {
      drops.push((event as CustomEvent<FileList>).detail)
    })

    const content = sr(el).querySelector('.sidebar-content') as HTMLElement
    const files = [new File(['a'], 'a.md'), new File(['b'], 'b.txt')]
    const fileList = { ...files, length: files.length, item: (i: number) => files[i] ?? null } as unknown as FileList
    const dispatchFileDrag = (type: string): void => {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        value: { types: ['Files'], files: fileList, dropEffect: 'none' },
      })
      content.dispatchEvent(event)
    }

    dispatchFileDrag('dragover')
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).not.toBeNull()

    dispatchFileDrag('drop')
    await el.updateComplete
    expect(drops).toHaveLength(1)
    expect(drops[0].length).toBe(2)
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).toBeNull() // clears after drop

    // An internal node-reorder drag (no 'Files' type) must NOT trigger a file-drop intent.
    const internalEvent = new Event('drop', { bubbles: true, cancelable: true, composed: true }) as DragEvent
    Object.defineProperty(internalEvent, 'dataTransfer', {
      configurable: true,
      value: { types: ['text/plain', 'application/x-shrubbery-sidebar-node'], files: { length: 0 } },
    })
    content.dispatchEvent(internalEvent)
    expect(drops).toHaveLength(1) // unchanged
  })

  it('accepts an OS file drop targeted directly at a tree row, not just the container gaps between rows', async () => {
    const el = await mount((node) => { node.sections = sections })
    const drops: FileList[] = []
    el.addEventListener('mn-sidebar-file-drop', event => {
      drops.push((event as CustomEvent<FileList>).detail)
    })

    const row = sr(el).querySelector('[data-node-id="doc-a"]') as HTMLElement
    const files = [new File(['a'], 'a.md')]
    const fileList = { ...files, length: files.length, item: (i: number) => files[i] ?? null } as unknown as FileList
    const dispatchFileDrag = (type: string): void => {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        value: { types: ['Files'], files: fileList, dropEffect: 'none' },
      })
      row.dispatchEvent(event)
    }

    dispatchFileDrag('dragover')
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).not.toBeNull()

    dispatchFileDrag('drop')
    await el.updateComplete
    expect(drops).toHaveLength(1)
  })

  it('ignores OS file drops when capabilities.upload is false, and clears an active overlay if upload is revoked mid-drag', async () => {
    const el = await mount((node) => {
      node.sections = sections
      node.capabilities = { upload: false }
    })
    const drops: FileList[] = []
    el.addEventListener('mn-sidebar-file-drop', event => {
      drops.push((event as CustomEvent<FileList>).detail)
    })

    const content = sr(el).querySelector('.sidebar-content') as HTMLElement
    const files = [new File(['a'], 'a.md')]
    const fileList = { ...files, length: files.length, item: (i: number) => files[i] ?? null } as unknown as FileList
    const dispatchFileDrag = (type: string): void => {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        value: { types: ['Files'], files: fileList, dropEffect: 'none' },
      })
      content.dispatchEvent(event)
    }

    dispatchFileDrag('dragover')
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).toBeNull()

    dispatchFileDrag('drop')
    await el.updateComplete
    expect(drops).toHaveLength(0)

    // Grant upload capability and confirm the overlay now shows.
    el.capabilities = { upload: true }
    await el.updateComplete
    dispatchFileDrag('dragover')
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).not.toBeNull()

    // Revoking capability mid-drag (overlay already active) must clear it.
    el.capabilities = { upload: false }
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.file-drop-overlay')).toBeNull()
  })

  it('switches to controlled Miller columns, emits path/sort/group intents, and makes search a third topology', async () => {
    const fileSections: readonly MnSidebarSection[] = [
      sections[0],
      {
        id: 'artifacts',
        label: 'Artifacts',
        nodes: [{ id: 'artifact-map', label: 'Workspace map', kind: 'artifact' }],
      },
    ]
    const paths: MnSidebarColumnPathChangeDetail[] = []
    const sorts: MnSidebarSortChangeDetail[] = []
    const groups: MnSidebarGroupingChangeDetail[] = []
    const el = await mount(node => {
      node.sections = fileSections
      node.presentation = 'columns'
    })
    el.addEventListener('mn-sidebar-column-path-change', event => {
      paths.push((event as CustomEvent<MnSidebarColumnPathChangeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-sort-change', event => {
      sorts.push((event as CustomEvent<MnSidebarSortChangeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-grouping-change', event => {
      groups.push((event as CustomEvent<MnSidebarGroupingChangeDetail>).detail)
    })

    expect(sr(el).querySelector('[data-file-pane-body="columns"]')).not.toBeNull()
    expect(sr(el).querySelectorAll('[data-columns-section="documents"] .column')).toHaveLength(1)
    ;(sr(el).querySelector('[data-column-node][data-node-id="folder-1"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(paths).toEqual([{ sectionId: 'documents', folderIds: ['folder-1'] }])
    expect(sr(el).querySelectorAll('[data-columns-section="documents"] .column')).toHaveLength(2)

    const sort = sr(el).querySelector('.sort-select') as HTMLSelectElement
    sort.value = 'connectivity'
    sort.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    ;(sr(el).querySelector('[aria-label="Show folders"]') as HTMLButtonElement).click()
    expect(sorts).toEqual([{
      sort: { criterion: 'connectivity', direction: 'desc', foldersFirst: true },
    }])
    expect(groups).toEqual([{
      grouping: { separateArtifacts: true, showFolders: false },
    }])

    const input = sr(el).querySelector('.search-input') as HTMLInputElement
    el.addEventListener('mn-sidebar-search-change', event => {
      el.searchQuery = (event as CustomEvent<{ query: string }>).detail.query
    })
    input.value = 'parity'
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await el.updateComplete
    expect(sr(el).querySelector('[data-file-pane-presentation="search-results"]')).not.toBeNull()
    expect(sr(el).querySelector('[data-file-pane-body="columns"]')).toBeNull()
    expect(Array.from(sr(el).querySelectorAll('[data-node-id]')).map(node => node.getAttribute('data-node-id')))
      .toEqual(['folder-1', 'doc-a'])
  })

  it('supports controlled multi-selection and honest operational/capability states', async () => {
    const selections: MnSidebarSelectionDetail[] = []
    const actions: MnSidebarActionDetail[] = []
    const el = await mount(node => {
      node.sections = sections
      node.status = 'reconnecting'
      node.storage = { usedBytes: 512, limitBytes: 1024, label: 'Cell storage' }
      node.capabilities = {
        createDocument: false,
        upload: false,
        createFolder: false,
        refresh: true,
        sort: true,
        group: true,
        multiSelect: true,
        dragDrop: false,
        contextMenu: true,
      }
    })
    el.addEventListener('mn-sidebar-selection-change', event => {
      selections.push((event as CustomEvent<MnSidebarSelectionDetail>).detail)
    })
    el.addEventListener('mn-sidebar-action', event => {
      actions.push((event as CustomEvent<MnSidebarActionDetail>).detail)
    })

    expect(sr(el).querySelector('[data-status="reconnecting"]')?.textContent).toContain('last synchronized')
    expect(sr(el).querySelector('[data-storage-percent="50"]')).not.toBeNull()
    expect(sr(el).querySelector('[aria-label="New document"]')).toBeNull()
    expect(sr(el).querySelector('[data-node-id="doc-a"]')?.getAttribute('draggable')).toBe('false')

    ;(sr(el).querySelector('[data-node-id="doc-a"]') as HTMLElement).click()
    ;(sr(el).querySelector('[data-node-id="doc-b"]') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, ctrlKey: true }),
    )
    await el.updateComplete
    expect(selections.at(-1)?.ids).toEqual(['doc-a', 'doc-b'])
    expect(sr(el).querySelector('.selection-copy')?.textContent).toBe('2 items selected')
    ;(sr(el).querySelector('[aria-label="Refresh files"]') as HTMLButtonElement).click()
    expect(actions.at(-1)).toEqual({ action: 'refresh' })
  })

  it('R22 (MO object-face integration spec, master §3 Slice 8, C-D26) — a readOnly row is never draggable and never emits hover/focus intent, even with dragDrop enabled', async () => {
    const readOnlySections: readonly MnSidebarSection[] = [
      {
        id: 'parked',
        label: 'Parked work',
        icon: 'package',
        nodes: [
          { id: 'parked:recovery-1', label: 'A previous life', kind: 'document', section: 'parked', readOnly: true, badge: 'Replaced' },
        ],
      },
    ]
    const el = await mount(node => {
      node.sections = readOnlySections
      node.capabilities = {
        createDocument: true,
        upload: true,
        createFolder: true,
        refresh: true,
        sort: true,
        group: true,
        multiSelect: true,
        dragDrop: true,
        contextMenu: true,
      }
    })
    const intents: MnSidebarNodeDetail[] = []
    const opens: MnSidebarNodeDetail[] = []
    el.addEventListener('mn-sidebar-node-intent', event => {
      intents.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })
    el.addEventListener('mn-sidebar-node-open', event => {
      opens.push((event as CustomEvent<MnSidebarNodeDetail>).detail)
    })

    const row = sr(el).querySelector('[data-node-id="parked:recovery-1"]') as HTMLElement
    // The row IS still clickable — `_openNode` deliberately still fires; a
    // parked row is meant to be opened, just never as a document editor.
    // The shell (not this component) decides where `section:'parked'` goes.
    row.click()
    expect(opens).toHaveLength(1)
    expect(opens[0]).toMatchObject({ id: 'parked:recovery-1' })

    row.dispatchEvent(new Event('pointerenter'))
    expect(intents).toHaveLength(0)
    row.dispatchEvent(new Event('focus'))
    expect(intents).toHaveLength(0)

    expect(row.getAttribute('draggable')).toBe('false')
  })
})
