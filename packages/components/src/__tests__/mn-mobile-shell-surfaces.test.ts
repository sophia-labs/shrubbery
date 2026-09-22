/**
 * REAL component tests for the mobile shell utility slice.
 *
 * The Garden originals either were pure tabs/error UI or owned shell side
 * effects directly. These tests prove the Shrubbery ports render real DOM from
 * controlled props and surface host intents instead of reaching stores.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import '../mn-mobile-tabs.js'
import '../mn-mobile-file-list.js'
import '../mn-error-boundary.js'
import type { MnMobileTabs, MnMobileTabDetail } from '../mn-mobile-tabs.js'
import type {
  MnMobileDocumentOpenDetail,
  MnMobileFileActionDetail,
  MnMobileFileList,
  MnMobileFileNode,
  MnMobileWorkspaceDetail,
} from '../mn-mobile-file-list.js'
import type { MnErrorBoundary } from '../mn-error-boundary.js'

async function mountTabs(setup?: (el: MnMobileTabs) => void): Promise<MnMobileTabs> {
  const el = document.createElement('mn-mobile-tabs') as MnMobileTabs
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountFileList(setup?: (el: MnMobileFileList) => void): Promise<MnMobileFileList> {
  const el = document.createElement('mn-mobile-file-list') as MnMobileFileList
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountError(setup?: (el: MnErrorBoundary) => void): Promise<MnErrorBoundary> {
  const el = document.createElement('mn-error-boundary') as MnErrorBoundary
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const text = (node: ParentNode) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const tree: readonly MnMobileFileNode[] = [
  {
    id: 'folder-projects',
    label: 'Projects',
    type: 'folder',
    children: [
      { id: 'doc-plan', label: 'Garden parity plan', type: 'document' },
      { id: 'doc-wire', label: 'Wire audit', type: 'document', readOnly: true },
    ],
  },
  { id: 'doc-inbox', label: 'Inbox', type: 'document' },
]

describe('mobile shell utility custom elements', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  beforeAll(() => {
    expect(customElements.get('mn-mobile-tabs')).toBeDefined()
    expect(customElements.get('mn-mobile-file-list')).toBeDefined()
    expect(customElements.get('mn-error-boundary')).toBeDefined()
  })

  it('mn-mobile-tabs renders stable primary destinations with navigation semantics', async () => {
    const el = await mountTabs((node) => {
      node.activeTab = 'home'
    })
    const seenChanges: MnMobileTabDetail[] = []
    const seenActive: Event[] = []
    el.addEventListener('navigation-change', (event) => {
      seenChanges.push((event as CustomEvent<MnMobileTabDetail>).detail)
    })
    el.addEventListener('active-tab-tap', (event) => {
      seenActive.push(event)
    })

    const buttons = Array.from(el.shadowRoot!.querySelectorAll('button'))
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Home',
      'Browse',
      'Sophia',
    ])
    expect(el.shadowRoot!.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary')
    expect(el.shadowRoot!.querySelector('[role="tablist"]')).toBeNull()
    expect(buttons.every(button => button.getAttribute('role') !== 'tab')).toBe(true)
    expect(buttons[0].getAttribute('aria-current')).toBe('page')
    expect(buttons[1].getAttribute('aria-current')).toBe('false')

    buttons[2].click()
    buttons[0].click()

    expect(seenChanges).toEqual([{ tab: 'sophia' }])
    expect(seenActive).toEqual([])
  })

  it('mn-mobile-tabs settles each render while preserving the tab-change animation', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('mn-mobile-tabs') as MnMobileTabs
    document.body.appendChild(el)

    expect(await el.updateComplete).toBe(true)
    expect(el.shadowRoot!.querySelectorAll('.tab-icon')[0].getAttribute('data-pop')).toBe('true')

    await vi.advanceTimersByTimeAsync(250)
    expect(await el.updateComplete).toBe(true)
    expect(el.shadowRoot!.querySelector('[data-pop="true"]')).toBeNull()

    el.activeTab = 'sophia'
    expect(await el.updateComplete).toBe(true)
    expect(el.shadowRoot!.querySelectorAll('.tab-icon')[2].getAttribute('data-pop')).toBe('true')

    await vi.advanceTimersByTimeAsync(250)
    expect(await el.updateComplete).toBe(true)
    expect(el.shadowRoot!.querySelector('[data-pop="true"]')).toBeNull()
    expect(warning.mock.calls.flat().join(' ')).not.toContain('scheduled an update')
  })

  it('mn-mobile-file-list renders controlled folders, filters locally, and emits document opens', async () => {
    const el = await mountFileList((node) => {
      node.currentGraphTitle = 'Garden Workspace'
      node.nodes = tree
      node.expandedFolderIds = ['folder-projects']
      node.activeDocumentId = 'doc-plan'
      node.workspaces = [{ graphId: 'graph-garden', title: 'Garden Workspace' }]
    })
    const opens: MnMobileDocumentOpenDetail[] = []
    const searches: string[] = []
    el.addEventListener('document-open', (event) => {
      opens.push((event as CustomEvent<MnMobileDocumentOpenDetail>).detail)
    })
    el.addEventListener('mn-mobile-file-search-change', (event) => {
      searches.push((event as CustomEvent<{ query: string }>).detail.query)
    })

    const rowsBefore = Array.from(el.shadowRoot!.querySelectorAll('[data-node-id]')) as HTMLElement[]
    expect(rowsBefore.map((row) => row.getAttribute('data-node-id'))).toEqual([
      'folder-projects',
      'doc-plan',
      'doc-wire',
      'doc-inbox',
    ])
    expect(el.shadowRoot!.querySelector('[data-node-id="doc-plan"]')?.getAttribute('data-active')).toBe('true')

    ;(el.shadowRoot!.querySelector('.search-input') as HTMLInputElement).value = 'wire'
    ;(el.shadowRoot!.querySelector('.search-input') as HTMLInputElement).dispatchEvent(
      new Event('input', { bubbles: true, composed: true }),
    )
    await el.updateComplete

    const rowsAfter = Array.from(el.shadowRoot!.querySelectorAll('[data-node-id]')) as HTMLElement[]
    expect(rowsAfter.map((row) => row.getAttribute('data-node-id'))).toEqual([
      'folder-projects',
      'doc-wire',
    ])

    ;(el.shadowRoot!.querySelector('[data-node-id="doc-wire"]') as HTMLElement).click()
    expect(searches).toEqual(['wire'])
    expect(opens).toEqual([{ documentId: 'doc-wire', readOnly: true }])
  })

  it('mn-mobile-file-list renders recents, workspace sheet, and context-menu host intents', async () => {
    const el = await mountFileList((node) => {
      node.view = 'recents'
      node.currentGraphTitle = 'Garden Workspace'
      node.activeGraphId = 'graph-garden'
      node.nodes = tree
      node.recents = [
        { docId: 'doc-plan', title: 'Garden parity plan', graphId: 'graph-garden', timestamp: Date.now() - 10 * 60_000 },
        { docId: 'doc-other', title: 'Other graph note', graphId: 'graph-other', timestamp: Date.now() - 10 * 60_000 },
      ]
      node.workspaces = [
        { graphId: 'graph-garden', title: 'Garden Workspace' },
        { graphId: 'graph-shrubbery', title: 'Shrubbery Lab' },
      ]
    })
    const selected: MnMobileWorkspaceDetail[] = []
    const created: unknown[] = []
    const actions: MnMobileFileActionDetail[] = []
    el.addEventListener('mn-mobile-workspace-select', (event) => {
      selected.push((event as CustomEvent<MnMobileWorkspaceDetail>).detail)
    })
    el.addEventListener('mn-mobile-workspace-create', (event) => {
      created.push(event)
    })
    el.addEventListener('mn-mobile-file-action', (event) => {
      actions.push((event as CustomEvent<MnMobileFileActionDetail>).detail)
    })

    expect(text(el.shadowRoot!.querySelector('.list')!)).toContain('Garden parity plan')
    expect(text(el.shadowRoot!.querySelector('.list')!)).not.toContain('Other graph note')

    ;(el.shadowRoot!.querySelector('.workspace-btn') as HTMLButtonElement).click()
    await el.updateComplete
    ;(el.shadowRoot!.querySelector('[data-graph-id="graph-shrubbery"]') as HTMLButtonElement).click()
    expect(selected).toEqual([{ graphId: 'graph-shrubbery' }])

    ;(el.shadowRoot!.querySelector('.workspace-btn') as HTMLButtonElement).click()
    await el.updateComplete
    ;(el.shadowRoot!.querySelector('.ws-new') as HTMLButtonElement).click()
    expect(created.length).toBe(1)

    el.view = 'folders'
    el.expandedFolderIds = ['folder-projects']
    await el.updateComplete
    ;(el.shadowRoot!.querySelector('[data-node-id="doc-plan"]') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: 42,
        clientY: 84,
      }),
    )
    await el.updateComplete
    ;(el.shadowRoot!.querySelector('.ctx-item[data-destructive="true"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(actions).toEqual([{ action: 'delete', nodeId: 'doc-plan', nodeType: 'document' }])
  })

  it('mn-error-boundary renders variant defaults, details, slot actions, and recovery intents', async () => {
    const el = await mountError((node) => {
      node.variant = 'network'
      node.title = ''
      node.message = 'The workspace could not be reached.'
      node.secondaryActionText = 'Go Home'
      node.showDetails = true
      node.errorStack = 'GET /graphs/garden timed out'
    })
    let primary = 0
    let secondary = 0
    el.addEventListener('mn-action', () => {
      primary += 1
    })
    el.addEventListener('mn-secondary-action', () => {
      secondary += 1
    })

    expect(text(el.shadowRoot!.querySelector('.title')!)).toBe('Connection Error')
    expect(text(el.shadowRoot!.querySelector('.message')!)).toBe('The workspace could not be reached.')

    ;(el.shadowRoot!.querySelector('.details-toggle') as HTMLButtonElement).click()
    await el.updateComplete
    expect(text(el.shadowRoot!.querySelector('.error-stack')!)).toBe('GET /graphs/garden timed out')

    ;(el.shadowRoot!.querySelector('.primary-action') as HTMLButtonElement).click()
    ;(el.shadowRoot!.querySelector('.secondary-action') as HTMLButtonElement).click()
    expect(primary).toBe(1)
    expect(secondary).toBe(1)
  })
})
