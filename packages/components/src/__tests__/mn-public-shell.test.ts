/**
 * REAL component test - mn-public-shell controlled public workspace surface.
 *
 * The element renders caller-owned public navigation/document/wire data and
 * emits intents. It does not decode Yjs, call public APIs, mutate URL state, or
 * attach Garden stores.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { projectPublicShellGraph } from '../mn-public-shell.js'
import type {
  MnPublicDocument,
  MnPublicNav,
  MnPublicShell,
  MnPublicShellCopyCodeDetail,
  MnPublicShellOpenDocumentDetail,
  MnPublicShellViewDetail,
  MnPublicWires,
} from '../mn-public-shell.js'

async function mount(setup?: (el: MnPublicShell) => void): Promise<MnPublicShell> {
  const el = document.createElement('mn-public-shell') as MnPublicShell
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnPublicShell) => el.shadowRoot!

const nav: MnPublicNav = {
  graphId: 'graph-public',
  title: 'Published Garden',
  folders: [{ id: 'folder-notes', label: 'Notes', order: 1 }],
  documents: [
    { id: 'doc-home', title: 'Welcome', order: 0, updatedAt: '2026-06-23T12:00:00Z' },
    { id: 'doc-notes', title: 'Wire notes', parentId: 'folder-notes', order: 0 },
  ],
}

const documentData: MnPublicDocument = {
  id: 'doc-home',
  title: 'Welcome',
  updatedAt: '2026-06-23T12:00:00Z',
  blocks: [
    { id: 'block-title', type: 'heading', level: 2, order: 0, content: 'Public brief' },
    {
      id: 'block-body',
      type: 'paragraph',
      order: 1,
      content: 'Read the linked note and source.',
      marks: [
        { type: 'bold', start: 0, end: 4 },
        { type: 'wikilink', start: 9, end: 20, targetDocumentId: 'doc-notes' },
        { type: 'link', start: 25, end: 31, href: 'https://sophia-labs.com' },
      ],
    },
    { id: 'block-code', type: 'code', order: 2, content: 'const publicGraph = true' },
  ],
}

const wires: MnPublicWires = {
  wiredBlockIds: ['block-body'],
  outgoing: [
    {
      id: 'wire-1',
      predicateLabel: 'supports',
      otherDocumentId: 'doc-notes',
      otherTitle: 'Wire notes',
      otherBlockId: 'block-target',
      otherSnippet: 'A related public note.',
      localBlockId: 'block-body',
    },
  ],
  incoming: [],
}

describe('mn-public-shell - real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-public-shell')).toBeDefined()
  })

  it('renders loading and error states from controlled status', async () => {
    const el = await mount((node) => {
      node.status = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()

    el.status = 'error'
    el.error = 'Share token expired'
    await el.updateComplete

    const empty = sr(el).querySelector('mn-empty-state')!
    expect(empty.getAttribute('title')).toBe('Public workspace unavailable')
    expect(empty.getAttribute('description')).toBe('Share token expired')
  })

  it('renders public nav tree and emits document-open intents', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.nav = nav
      node.document = documentData
    })
    const opens: MnPublicShellOpenDocumentDetail[] = []
    el.addEventListener('mn-public-shell-open-document', (event) => {
      opens.push((event as CustomEvent<MnPublicShellOpenDocumentDetail>).detail)
    })

    expect(sr(el).querySelector('.workspace-title')?.textContent).toBe('Published Garden')
    expect(sr(el).querySelector('[data-document-id="doc-home"]')?.getAttribute('aria-current')).toBe('page')

    ;(sr(el).querySelector('.folder-button') as HTMLButtonElement).click()
    await el.updateComplete
    ;(sr(el).querySelector('[data-document-id="doc-notes"]') as HTMLButtonElement).click()

    expect(opens).toEqual([{ documentId: 'doc-notes', blockId: null, source: 'nav' }])
  })

  it('projects the public nav tree plus the loaded wire bundle into an honest graph slice', () => {
    const projection = projectPublicShellGraph(nav, documentData, wires)

    expect(projection.documentCount).toBe(2)
    expect(projection.wireCount).toBe(1)
    expect(projection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'graph:graph-public', kind: 'graph', label: 'Published Garden' }),
      expect.objectContaining({ id: 'folder:folder-notes', kind: 'folder', label: 'Notes' }),
      expect.objectContaining({ id: 'document:doc-home', kind: 'document', documentId: 'doc-home' }),
      expect.objectContaining({ id: 'document:doc-notes', kind: 'document', documentId: 'doc-notes' }),
    ]))
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'graph:graph-public', to: 'folder:folder-notes', predicate: 'contains' }),
      expect.objectContaining({ from: 'folder:folder-notes', to: 'document:doc-notes', predicate: 'contains' }),
      expect.objectContaining({
        from: 'document:doc-home',
        to: 'document:doc-notes',
        predicate: 'supports',
        kind: 'wire',
      }),
    ]))
  })

  it('renders the built-in accessible 3-D graph and opens a connected document through its keyboard surface', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.nav = nav
      node.document = documentData
      node.wires = wires
    })
    const opens: MnPublicShellOpenDocumentDetail[] = []
    const views: MnPublicShellViewDetail[] = []
    el.addEventListener('mn-public-shell-open-document', (event) => {
      opens.push((event as CustomEvent<MnPublicShellOpenDocumentDetail>).detail)
    })
    el.addEventListener('mn-public-shell-view-change', (event) => {
      views.push((event as CustomEvent<MnPublicShellViewDetail>).detail)
    })

    ;(sr(el).querySelector('[data-view-toggle]') as HTMLButtonElement).click()
    await el.updateComplete

    const region = sr(el).querySelector('[role="region"][aria-label="Public graph"]')
    const panel = sr(el).querySelector('mn-graph-panel') as HTMLElement & {
      updateComplete: Promise<boolean>
      nodes: readonly unknown[]
      edges: readonly unknown[]
    }
    expect(region).not.toBeNull()
    expect(panel).not.toBeNull()
    await panel.updateComplete
    expect(panel.nodes).toHaveLength(4)
    expect(panel.edges).toHaveLength(4)

    const graph = panel.shadowRoot!.querySelector('mn-graph-three') as HTMLElement & { updateComplete: Promise<boolean> }
    expect(graph).not.toBeNull()
    await graph.updateComplete
    const connected = graph.shadowRoot!.querySelector(
      'button[aria-label="Wire notes"][data-accessible-node="document:doc-notes"]',
    ) as HTMLButtonElement | null
    expect(connected).not.toBeNull()
    connected!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await el.updateComplete

    expect(el.view).toBe('document')
    expect(views).toEqual([{ view: 'graph' }, { view: 'document' }])
    expect(opens).toEqual([{ documentId: 'doc-notes', blockId: null, source: 'graph' }])
    expect(sr(el).querySelector('.doc-title')?.textContent).toBe('Welcome')
  })

  it('renders document blocks, safe marks, and block wire indicators', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.nav = nav
      node.document = documentData
      node.wires = wires
    })

    expect(sr(el).querySelector('.doc-title')?.textContent).toBe('Welcome')
    expect(sr(el).querySelector('h2')?.textContent).toBe('Public brief')
    expect(sr(el).querySelector('strong')?.textContent).toBe('Read')
    expect(sr(el).querySelector('.wikilink')?.textContent).toBe('linked note')
    expect(sr(el).querySelector('a')?.getAttribute('href')).toBe('https://sophia-labs.com/')
    expect(sr(el).querySelector('[data-block-id="block-body"]')?.getAttribute('data-wired')).toBe('true')
    expect(sr(el).querySelector('.wire-dot')).not.toBeNull()
  })

  it('emits wikilink, wire, view-change, refresh, and copy-code intents', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.nav = nav
      node.document = documentData
      node.wires = wires
    })
    const opens: MnPublicShellOpenDocumentDetail[] = []
    const views: MnPublicShellViewDetail[] = []
    const copies: MnPublicShellCopyCodeDetail[] = []
    let refreshes = 0
    el.addEventListener('mn-public-shell-open-document', (event) => {
      opens.push((event as CustomEvent<MnPublicShellOpenDocumentDetail>).detail)
    })
    el.addEventListener('mn-public-shell-view-change', (event) => {
      views.push((event as CustomEvent<MnPublicShellViewDetail>).detail)
    })
    el.addEventListener('mn-public-shell-copy-code', (event) => {
      copies.push((event as CustomEvent<MnPublicShellCopyCodeDetail>).detail)
    })
    el.addEventListener('mn-public-shell-refresh', () => {
      refreshes += 1
    })

    const wireCard = sr(el).querySelector('.wire-card') as HTMLButtonElement | null
    expect(wireCard).not.toBeNull()

    wireCard!.click()
    ;(sr(el).querySelector('.wikilink') as HTMLButtonElement).click()
    ;(Array.from(sr(el).querySelectorAll('.view-button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Graph view'))!
      .click()
    ;(sr(el).querySelector('[aria-label="Refresh public workspace"]') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.copy-button') as HTMLButtonElement).click()

    expect(opens).toEqual([
      { documentId: 'doc-notes', blockId: 'block-target', source: 'wire' },
      { documentId: 'doc-notes', blockId: null, source: 'wikilink' },
    ])
    expect(views).toEqual([{ view: 'graph' }])
    expect(refreshes).toBe(1)
    expect(copies).toEqual([{ blockId: 'block-code', content: 'const publicGraph = true' }])
  })
})
