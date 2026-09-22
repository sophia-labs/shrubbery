import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../mn-mobile-file-list.js'
import type {
  MnMobileDocumentOpenDetail,
  MnMobileFileActionDetail,
  MnMobileFileList,
  MnMobileFileNode,
  MnMobileFileNodeDetail,
  MnMobileFileRetryDetail,
  MnMobileFileViewDetail,
  MnMobileWorkspaceDetail,
} from '../mn-mobile-file-list.js'
import type { MnContinuityStatus } from '../mn-continuity-status.js'

const nodes: readonly MnMobileFileNode[] = [
  {
    id: 'folder-projects',
    label: 'Projects',
    type: 'folder',
    children: [
      { id: 'doc-plan', label: 'Garden parity plan', type: 'document' },
      { id: 'doc-reference', label: 'Reference', type: 'document', readOnly: true },
    ],
  },
  { id: 'doc-inbox', label: 'Inbox', type: 'document' },
]

async function mount(setup?: (element: MnMobileFileList) => void): Promise<MnMobileFileList> {
  const element = document.createElement('mn-mobile-file-list') as MnMobileFileList
  setup?.(element)
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

function shadow(element: MnMobileFileList): ShadowRoot {
  return element.shadowRoot!
}

describe('mn-mobile-file-list mobile interaction contract', () => {
  beforeAll(() => {
    expect(customElements.get('mn-mobile-file-list')).toBeDefined()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses native controls for rows and exposes expanded and current state', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.expandedFolderIds = ['folder-projects']
      node.activeDocumentId = 'doc-plan'
    })
    const toggles: MnMobileFileNodeDetail[] = []
    const opens: MnMobileDocumentOpenDetail[] = []
    element.addEventListener('mn-mobile-folder-toggle', event => {
      toggles.push((event as CustomEvent<MnMobileFileNodeDetail>).detail)
    })
    element.addEventListener('document-open', event => {
      opens.push((event as CustomEvent<MnMobileDocumentOpenDetail>).detail)
    })

    const folder = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="folder-projects"]')!
    const activeDocument = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="doc-plan"]')!
    const readOnlyDocument = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="doc-reference"]')!

    expect(folder.tagName).toBe('BUTTON')
    expect(folder.tabIndex).toBe(0)
    expect(folder.getAttribute('aria-expanded')).toBe('true')
    expect(shadow(element).getElementById(folder.getAttribute('aria-controls')!)).not.toBeNull()
    expect(activeDocument.tagName).toBe('BUTTON')
    expect(activeDocument.getAttribute('aria-current')).toBe('page')
    expect(readOnlyDocument.hasAttribute('aria-current')).toBe(false)

    folder.focus()
    folder.click()
    await element.updateComplete
    expect(toggles).toEqual([{ nodeId: 'folder-projects', nodeType: 'folder' }])
    expect(folder.getAttribute('aria-expanded')).toBe('false')
    expect(shadow(element).getElementById(folder.getAttribute('aria-controls')!)?.hidden).toBe(true)

    element.expandedFolderIds = ['folder-projects']
    await element.updateComplete
    const refreshedReadOnly = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="doc-reference"]')!
    refreshedReadOnly.focus()
    refreshedReadOnly.click()
    expect(opens).toEqual([{ documentId: 'doc-reference', readOnly: true }])
  })

  it('keeps an explicit action affordance on every item and presents a named modal action sheet', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.expandedFolderIds = ['folder-projects']
    })
    const actions: MnMobileFileActionDetail[] = []
    let activeAtAction: Element | null = null
    element.addEventListener('mn-mobile-file-action', event => {
      activeAtAction = shadow(element).activeElement
      actions.push((event as CustomEvent<MnMobileFileActionDetail>).detail)
    })

    const rows = Array.from(shadow(element).querySelectorAll<HTMLButtonElement>('[data-node-id]'))
    const overflow = Array.from(shadow(element).querySelectorAll<HTMLButtonElement>('.row-more'))
    expect(overflow).toHaveLength(rows.length)
    expect(overflow.map(button => button.getAttribute('aria-label'))).toContain('More actions for Garden parity plan')
    expect(overflow.every(button => button.getAttribute('aria-haspopup') === 'dialog')).toBe(true)

    const planOverflow = shadow(element).querySelector<HTMLButtonElement>('[data-action-for="doc-plan"]')!
    planOverflow.focus()
    planOverflow.click()
    await element.updateComplete

    const dialog = shadow(element).querySelector<HTMLElement>('.ctx-sheet')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = shadow(element).getElementById(dialog.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Garden parity plan')
    expect(shadow(element).activeElement).toBe(shadow(element).querySelector('.ctx-item'))
    expect(dialog.textContent).toContain('Move to folder…')
    expect(dialog.textContent).toContain('Choose a new location for “Garden parity plan”.')
    expect(dialog.textContent).toContain('Removes “Garden parity plan” from this graph. This cannot be undone here.')

    const cancel = shadow(element).querySelector<HTMLButtonElement>('.ctx-cancel')!
    cancel.focus()
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(shadow(element).activeElement).toBe(shadow(element).querySelector('.ctx-item'))

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await element.updateComplete
    expect(shadow(element).querySelector('.ctx-sheet')).toBeNull()
    expect(shadow(element).activeElement).toBe(planOverflow)

    planOverflow.click()
    await element.updateComplete
    shadow(element).querySelectorAll<HTMLButtonElement>('.ctx-item')[1]!.click()
    await element.updateComplete
    expect(actions).toEqual([{ action: 'move', nodeId: 'doc-plan', nodeType: 'document' }])
    expect(activeAtAction).toBe(planOverflow)
    expect(shadow(element).activeElement).toBe(planOverflow)
  })

  it('renames in place with explicit controls, trimmed validation, and predictable focus recovery', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.expandedFolderIds = ['folder-projects']
    })
    const actions: MnMobileFileActionDetail[] = []
    element.addEventListener('mn-mobile-file-action', event => {
      actions.push((event as CustomEvent<MnMobileFileActionDetail>).detail)
    })

    shadow(element).querySelector<HTMLButtonElement>('[data-action-for="doc-plan"]')!.click()
    await element.updateComplete
    shadow(element).querySelector<HTMLButtonElement>('.ctx-item')!.click()
    await element.updateComplete

    const editor = shadow(element).querySelector<HTMLFormElement>('[data-rename-for="doc-plan"]')!
    const input = editor.querySelector<HTMLInputElement>('.rename-input')!
    const cancel = editor.querySelector<HTMLButtonElement>('.rename-cancel')!
    const save = editor.querySelector<HTMLButtonElement>('.rename-save')!
    expect(shadow(element).querySelector('.ctx-sheet')).toBeNull()
    expect(editor.getAttribute('aria-label')).toBe('Rename document “Garden parity plan”')
    expect(input.getAttribute('aria-label')).toBe('New name for Garden parity plan')
    expect(shadow(element).activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Garden parity plan'.length)
    expect(cancel.textContent).toBe('Cancel')
    expect(save.textContent).toBe('Save')

    input.value = '   '
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await element.updateComplete
    expect(actions).toEqual([])
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(editor.querySelector('[role="alert"]')?.textContent).toBe('Name can’t be empty.')
    expect(shadow(element).activeElement).toBe(input)

    input.value = '  Garden parity plan, revised  '
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await element.updateComplete
    expect(actions).toEqual([{
      action: 'rename',
      nodeId: 'doc-plan',
      nodeType: 'document',
      proposedLabel: 'Garden parity plan, revised',
    }])
    expect(shadow(element).querySelector('[data-rename-for="doc-plan"]')).toBeNull()
    expect(shadow(element).activeElement).toBe(
      shadow(element).querySelector('[data-action-for="doc-plan"]'),
    )

    shadow(element).querySelector<HTMLButtonElement>('[data-action-for="doc-plan"]')!.click()
    await element.updateComplete
    shadow(element).querySelector<HTMLButtonElement>('.ctx-item')!.click()
    await element.updateComplete
    const cancelInput = shadow(element).querySelector<HTMLInputElement>('.rename-input')!
    cancelInput.value = 'A name that should not leave the editor'
    cancelInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    cancelInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    await element.updateComplete
    expect(actions).toHaveLength(1)
    expect(shadow(element).querySelector('[data-rename-for="doc-plan"]')).toBeNull()
    expect(shadow(element).activeElement).toBe(
      shadow(element).querySelector('[data-action-for="doc-plan"]'),
    )
  })

  it('explains that non-empty folder deletion is refused before emitting the destructive intent', async () => {
    const element = await mount(node => {
      node.nodes = nodes
    })
    const actions: MnMobileFileActionDetail[] = []
    element.addEventListener('mn-mobile-file-action', event => {
      actions.push((event as CustomEvent<MnMobileFileActionDetail>).detail)
    })

    shadow(element).querySelector<HTMLButtonElement>('[data-action-for="folder-projects"]')!.click()
    await element.updateComplete
    const destructive = shadow(element).querySelector<HTMLButtonElement>('.ctx-item[data-destructive="true"]')!
    expect(destructive.textContent).toContain('Delete folder')
    expect(destructive.textContent).toContain('Garden will refuse while it contains items.')
    destructive.click()
    await element.updateComplete
    expect(actions).toEqual([{ action: 'delete', nodeId: 'folder-projects', nodeType: 'folder' }])
  })

  it('keeps the long-press rename path touch-safe and returns focus to the originating row', async () => {
    vi.useFakeTimers()
    const element = await mount(node => {
      node.nodes = nodes
      node.expandedFolderIds = ['folder-projects']
    })
    const row = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="doc-plan"]')!
    const touchStart = new Event('touchstart', {
      bubbles: true,
      composed: true,
      cancelable: true,
    }) as TouchEvent
    Object.defineProperty(touchStart, 'touches', {
      value: [{ clientX: 24, clientY: 80 }],
    })

    row.dispatchEvent(touchStart)
    vi.advanceTimersByTime(500)
    await element.updateComplete
    expect(shadow(element).querySelector('.ctx-sheet')).not.toBeNull()

    shadow(element).querySelector<HTMLButtonElement>('.ctx-item')!.click()
    await element.updateComplete
    expect(shadow(element).activeElement).toBe(shadow(element).querySelector('.rename-input'))
    shadow(element).querySelector<HTMLButtonElement>('.rename-cancel')!.click()
    await element.updateComplete
    expect(shadow(element).activeElement).toBe(
      shadow(element).querySelector('[data-node-id="doc-plan"]'),
    )
  })

  it('labels the workspace chooser, manages focus, and preserves controlled intents', async () => {
    const element = await mount(node => {
      node.currentGraphTitle = 'Garden Workspace'
      node.activeGraphId = 'garden'
      node.workspaces = [
        { graphId: 'garden', title: 'Garden Workspace' },
        { graphId: 'shrubbery', title: 'Shrubbery Lab' },
        { graphId: 'offline', title: 'Offline', disabled: true, disabledReason: 'Unavailable' },
      ]
    })
    const selected: MnMobileWorkspaceDetail[] = []
    element.addEventListener('mn-mobile-workspace-select', event => {
      selected.push((event as CustomEvent<MnMobileWorkspaceDetail>).detail)
    })

    const trigger = shadow(element).querySelector<HTMLButtonElement>('.workspace-btn')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    trigger.focus()
    trigger.click()
    await element.updateComplete
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const dialog = shadow(element).querySelector<HTMLElement>('.ws-sheet')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(shadow(element).getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Workspaces')
    const activeWorkspace = shadow(element).querySelector<HTMLButtonElement>('[data-graph-id="garden"]')!
    expect(activeWorkspace.getAttribute('aria-current')).toBe('true')
    expect(shadow(element).activeElement).toBe(activeWorkspace)
    expect(shadow(element).querySelector<HTMLButtonElement>('[data-graph-id="offline"]')!.disabled).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await element.updateComplete
    expect(shadow(element).querySelector('.ws-sheet')).toBeNull()
    expect(shadow(element).activeElement).toBe(trigger)

    trigger.click()
    await element.updateComplete
    shadow(element).querySelector<HTMLButtonElement>('[data-graph-id="shrubbery"]')!.click()
    await element.updateComplete
    expect(selected).toEqual([{ graphId: 'shrubbery' }])
    expect(shadow(element).activeElement).toBe(trigger)
  })

  it('exposes labelled search and mutually exclusive view state without owning data', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.searchQuery = 'garden'
    })
    const views: MnMobileFileViewDetail[] = []
    const searches: string[] = []
    element.addEventListener('mn-mobile-file-view-change', event => {
      views.push((event as CustomEvent<MnMobileFileViewDetail>).detail)
    })
    element.addEventListener('mn-mobile-file-search-change', event => {
      searches.push((event as CustomEvent<{ query: string }>).detail.query)
    })

    const search = shadow(element).querySelector<HTMLInputElement>('.search-input')!
    const clear = shadow(element).querySelector<HTMLButtonElement>('.search-clear')!
    const [folders, recents] = Array.from(shadow(element).querySelectorAll<HTMLButtonElement>('.toggle-btn'))
    expect(search.getAttribute('aria-label')).toBe('Search folders and documents')
    expect(clear.getAttribute('aria-label')).toBe('Clear search')
    expect(folders.getAttribute('aria-pressed')).toBe('true')
    expect(recents.getAttribute('aria-pressed')).toBe('false')

    recents.focus()
    recents.click()
    await element.updateComplete
    expect(views).toEqual([{ view: 'recents' }])
    expect(folders.getAttribute('aria-pressed')).toBe('false')
    expect(recents.getAttribute('aria-pressed')).toBe('true')

    clear.click()
    await element.updateComplete
    expect(searches).toEqual([''])
    expect(shadow(element).querySelector('.search-clear')).toBeNull()
  })

  it('renders a shared loading status and stable skeleton before content arrives', async () => {
    const element = await mount(node => {
      node.status = 'loading'
    })

    const status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="content"]')!
    await status.updateComplete
    expect(status.state).toBe('loading')
    expect(status.label).toBe('Loading documents\u2026')
    expect(status.detail).toBe('Reading this workspace.')
    expect(status.shadowRoot!.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true')
    expect(shadow(element).querySelector('[data-mobile-file-state="loading"]')).not.toBeNull()
    expect(shadow(element).querySelectorAll('.skeleton-row')).toHaveLength(5)
    expect(shadow(element).querySelector('[data-mobile-file-state="empty"]')).toBeNull()
  })

  it('keeps cached rows visible offline and translates the shared action into reconnect intent', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.status = 'offline'
    })
    const reconnects: unknown[] = []
    const leakedGenericActions: unknown[] = []
    element.addEventListener('mn-mobile-file-reconnect', event => reconnects.push((event as CustomEvent).detail))
    element.addEventListener('continuity-action', event => leakedGenericActions.push(event))

    expect(shadow(element).querySelector('[data-node-id="folder-projects"]')).not.toBeNull()
    const status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="content"]')!
    await status.updateComplete
    expect(status.state).toBe('offline')
    expect(status.detail).toContain('last available documents')
    status.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()

    expect(reconnects).toEqual([{}])
    expect(leakedGenericActions).toEqual([])
  })

  it('surfaces an unavailable workspace with controlled copy and a content retry intent', async () => {
    const element = await mount(node => {
      node.status = 'error'
      node.statusDetail = 'The workspace service did not respond.'
    })
    const retries: MnMobileFileRetryDetail[] = []
    element.addEventListener('mn-mobile-file-retry', event => {
      retries.push((event as CustomEvent<MnMobileFileRetryDetail>).detail)
    })

    const status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="content"]')!
    await status.updateComplete
    expect(status.state).toBe('error')
    expect(status.detail).toBe('The workspace service did not respond.')
    expect(shadow(element).querySelector('[data-mobile-file-state="error"]')?.textContent).toContain('workspace is unchanged')
    status.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()
    expect(retries).toEqual([{ target: 'content' }])
  })

  it('keeps a destructive target stable and distinguishes success, rejection, and ambiguous delivery', async () => {
    const element = await mount(node => {
      node.nodes = nodes
      node.operation = {
        id: 'delete-inbox-1',
        action: 'delete',
        state: 'pending',
        nodeId: 'doc-inbox',
        label: 'Inbox',
      }
    })
    const retries: MnMobileFileRetryDetail[] = []
    element.addEventListener('mn-mobile-file-retry', event => {
      retries.push((event as CustomEvent<MnMobileFileRetryDetail>).detail)
    })

    const row = shadow(element).querySelector<HTMLButtonElement>('[data-node-id="doc-inbox"]')!
    expect(row.disabled).toBe(true)
    expect(row.getAttribute('aria-busy')).toBe('true')
    expect(row.textContent).toContain('Working\u2026')
    expect(shadow(element).querySelector<HTMLButtonElement>('[data-action-for="doc-inbox"]')!.disabled).toBe(true)
    let status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="operation"]')!
    await status.updateComplete
    expect(status.state).toBe('saving')
    expect(status.label).toBe('Deleting Inbox\u2026')

    element.operation = {
      id: 'delete-inbox-1',
      action: 'delete',
      state: 'terminal-error',
      nodeId: 'doc-inbox',
      label: 'Inbox',
      message: 'Inbox could not be deleted.',
      retryable: true,
    }
    await element.updateComplete
    status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="operation"]')!
    await status.updateComplete
    expect(shadow(element).querySelector('[data-node-id="doc-inbox"]')).not.toBeNull()
    expect(status.state).toBe('error')
    expect(status.label).toBe('Couldn\u2019t delete Inbox')
    expect(status.detail).toBe('Inbox could not be deleted.')
    status.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()
    expect(retries).toEqual([{ target: 'operation', operationId: 'delete-inbox-1' }])

    element.operation = {
      id: 'delete-inbox-1',
      action: 'delete',
      state: 'success',
      nodeId: 'doc-inbox',
      label: 'Inbox',
    }
    await element.updateComplete
    status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="operation"]')!
    await status.updateComplete
    expect(status.state).toBe('ready')
    expect(status.label).toBe('Deleted Inbox')
    expect(status.actionLabel).toBe('')

    element.operation = {
      id: 'delete-inbox-1',
      action: 'delete',
      state: 'indeterminate',
      nodeId: 'doc-inbox',
      label: 'Inbox',
    }
    await element.updateComplete
    status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="operation"]')!
    await status.updateComplete
    expect(status.state).toBe('error')
    expect(status.label).toBe('Status not confirmed for Inbox')
    expect(status.detail).toContain('may still finish')
    expect(status.actionLabel).toBe('Check files')
    status.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()
    expect(retries).toEqual([
      { target: 'operation', operationId: 'delete-inbox-1' },
      { target: 'reconcile', operationId: 'delete-inbox-1' },
    ])
  })

  it('preserves cached workspaces while loading and exposes chooser retry without closing the modal', async () => {
    const element = await mount(node => {
      node.workspaces = [{ graphId: 'garden', title: 'Garden' }]
      node.workspaceLoading = true
    })
    const retries: MnMobileFileRetryDetail[] = []
    element.addEventListener('mn-mobile-file-retry', event => {
      retries.push((event as CustomEvent<MnMobileFileRetryDetail>).detail)
    })

    shadow(element).querySelector<HTMLButtonElement>('.workspace-btn')!.click()
    await element.updateComplete
    const loading = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="workspaces"]')!
    expect(loading.state).toBe('loading')
    expect(shadow(element).querySelector('[data-graph-id="garden"]')).not.toBeNull()

    element.workspaceLoading = false
    element.workspaceError = 'Workspace catalog timed out.'
    await element.updateComplete
    const error = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="workspaces"]')!
    await error.updateComplete
    error.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click()
    expect(retries).toEqual([{ target: 'workspaces' }])
    expect(shadow(element).querySelector('.ws-sheet')).not.toBeNull()
  })

  it('keeps a nested continuity action inside the workspace modal focus loop', async () => {
    const element = await mount(node => {
      node.workspaceError = 'Workspace catalog timed out.'
      node.allowNewWorkspace = false
    })

    shadow(element).querySelector<HTMLButtonElement>('.workspace-btn')!.click()
    await element.updateComplete
    const status = shadow(element).querySelector<MnContinuityStatus>('mn-continuity-status[data-scope="workspaces"]')!
    await status.updateComplete
    const retry = status.shadowRoot!.querySelector<HTMLButtonElement>('button')!
    const close = shadow(element).querySelector<HTMLButtonElement>('.ws-sheet-close')!

    retry.focus()
    retry.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    expect(shadow(element).activeElement).toBe(close)

    close.focus()
    close.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    }))
    expect(status.shadowRoot!.activeElement).toBe(retry)
  })
})
