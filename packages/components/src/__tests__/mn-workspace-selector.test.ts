import { afterEach, describe, expect, it } from 'vitest'
import '../mn-workspace-selector.js'
import {
  projectWorkspaceCatalog,
  workspaceActionCapability,
  workspaceDisplayPath,
  workspaceLifecycleLabel,
  type MnWorkspaceSelector,
  type MnWorkspaceSummary,
} from '../mn-workspace-selector.js'

async function mount(setup: (element: MnWorkspaceSelector) => void): Promise<MnWorkspaceSelector> {
  const element = document.createElement('mn-workspace-selector') as MnWorkspaceSelector
  setup(element)
  document.body.append(element)
  await element.updateComplete
  return element
}

async function open(element: MnWorkspaceSelector): Promise<ShadowRoot> {
  ;(element.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click()
  await element.updateComplete
  return element.shadowRoot!
}

const workspaces: readonly MnWorkspaceSummary[] = [
  { graphId: 'owned-a', title: 'Alpha Garden', role: 'owner', cellState: 'running', path: ['Vera', 'Research'] },
  { graphId: 'shared-b', title: 'Shared Notes', role: 'editor', cellState: 'stopped', path: ['Eschaton', 'Commons'] },
  { graphId: 'owned-c', title: 'Code Lab', role: 'owner', cellState: 'starting' },
  {
    graphId: 'shared-d',
    title: 'Archive',
    role: 'viewer',
    cellState: 'running',
    disabled: true,
    disabledReason: 'Read-only gateway access is not available yet.',
  },
]

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.removeAttribute('data-theme')
})

describe('workspace selector catalog model', () => {
  it('projects stable owned/shared groups and preserves honest hierarchy/lifecycle data', () => {
    const catalog = projectWorkspaceCatalog(workspaces)
    expect(catalog.groups.map(group => [group.kind, group.label])).toEqual([
      ['owned', 'My Workspaces'],
      ['shared', 'Shared with me'],
    ])
    expect(catalog.owned.map(workspace => workspace.graphId)).toEqual(['owned-a', 'owned-c'])
    expect(catalog.shared.map(workspace => workspace.graphId)).toEqual(['shared-b', 'shared-d'])
    expect(workspaceDisplayPath(workspaces[0]!)).toEqual(['Vera', 'Research'])
    expect(workspaceDisplayPath({ graphId: 'raw-id', title: 'Readable', role: 'owner', cellState: 'running' })).toEqual(['raw-id'])
    expect(workspaceLifecycleLabel('running')).toBeNull()
    expect(workspaceLifecycleLabel('stopped')).toBe('Cell asleep')
  })

  it('keeps rename/leave absent unless a host explicitly supports them', () => {
    expect(workspaceActionCapability(workspaces[0]!, 'delete')).toEqual({ available: true })
    expect(workspaceActionCapability(workspaces[0]!, 'rename')).toEqual({ available: false })
    expect(workspaceActionCapability(workspaces[1]!, 'leave')).toEqual({ available: false })
    const strict: MnWorkspaceSummary = {
      ...workspaces[0]!,
      capabilities: { rename: { available: true }, delete: { available: false } },
    }
    expect(workspaceActionCapability(strict, 'rename')).toEqual({ available: true })
    expect(workspaceActionCapability(strict, 'delete')).toEqual({ available: false })
  })
})

describe('mn-workspace-selector', () => {
  it('renders light owned/shared groups, paths, role gates, lifecycle, and disabled reasons', async () => {
    const element = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owned-a'
      selector.workspaces = workspaces
    })
    const root = await open(element)

    expect(root.querySelector('[data-group="owned"] .group-heading')?.textContent).toBe('My Workspaces')
    expect(root.querySelector('[data-group="shared"] .group-heading')?.textContent).toBe('Shared with me')
    expect(root.querySelector('[data-graph-id="owned-a"] .path-line')?.textContent).toContain('Vera')
    expect(root.querySelector('[data-graph-id="shared-b"] .role')?.textContent).toBe('Editor')
    expect(root.querySelector('[data-graph-id="shared-d"] .role')?.textContent).toBe('Viewer')
    expect(root.querySelector('[data-graph-id="shared-b"] .lifecycle')?.textContent).toBe('Cell asleep')
    expect(root.querySelector('[data-graph-id="owned-a"] .lifecycle')).toBeNull()
    expect(root.querySelector('[data-graph-id="shared-d"] .disabled-reason')?.textContent).toContain('Read-only gateway')
    expect((root.querySelector('[data-graph-id="shared-d"] .select') as HTMLButtonElement).disabled).toBe(true)

    // Owner-delete is the existing real adapter capability. Unsupported rename
    // and viewer/editor management are absent, not pretend disabled buttons.
    expect(root.querySelectorAll('.more')).toHaveLength(2)
    ;(root.querySelector('[data-graph-id="owned-a"] .more') as HTMLButtonElement).click()
    await element.updateComplete
    expect(root.querySelectorAll('.action-item')).toHaveLength(1)
    expect(root.querySelector('.action-item')?.getAttribute('data-action')).toBe('delete')
    expect(root.textContent).not.toContain('Rename unavailable')
  })

  it('renders the "moved on without you" lifetime chip, keeps the row selectable, and leaves an unremarkable summary byte-identical (master §3 Slice 7)', async () => {
    const fenced: MnWorkspaceSummary = {
      ...workspaces[0]!,
      graphId: 'owned-fenced',
      lifetime: { kind: 'moved-on', previousIncarnation: 'a1b2c3d4', parkedDocuments: 1, parkedOperations: 2 },
    }
    const before = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owned-a'
      selector.workspaces = workspaces
    })
    const unremarkableRoot = await open(before)
    const unremarkableHtml = unremarkableRoot.querySelector('[data-graph-id="owned-a"]')?.outerHTML

    const element = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owned-a'
      selector.workspaces = [...workspaces, fenced]
    })
    const root = await open(element)

    // A summary with no `lifetime` at all renders byte-identically to before
    // this slice — the field is purely additive.
    expect(root.querySelector('[data-graph-id="owned-a"]')?.outerHTML).toBe(unremarkableHtml)

    expect(root.querySelector('[data-graph-id="owned-fenced"] .lifetime')?.textContent).toBe('Moved on without you')
    expect(root.querySelector('[data-graph-id="owned-fenced"]')?.getAttribute('data-lifetime')).toBe('moved-on')
    const button = root.querySelector('[data-graph-id="owned-fenced"] .select') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toContain('Moved on without you')
    // Confessing absence means LISTING it, not greying it out (D2) — the
    // row stays fully selectable.
    expect(button.disabled).toBe(false)

    button.click()
    await element.updateComplete
    expect(root.querySelector('[data-graph-id="owned-fenced"]')?.getAttribute('data-pending')).toBe('true')
  })

  it('emits a controlled select intent and keeps the old selection visible until host convergence', async () => {
    const element = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owned-a'
      selector.workspaces = workspaces
    })
    const selected: string[] = []
    element.addEventListener('mn-workspace-select', event => selected.push((event as CustomEvent).detail.workspace.graphId))
    const root = await open(element)

    ;(root.querySelector('[data-graph-id="shared-b"] .select') as HTMLButtonElement).click()
    await element.updateComplete
    expect(selected).toEqual(['shared-b'])
    expect(element.activeGraphId).toBe('owned-a')
    expect(root.querySelector('.trigger-label')?.textContent).toBe('Alpha Garden')
    expect(root.querySelector('.progress')?.textContent).toContain('Switching to Shared Notes')
    expect(root.querySelector('.menu')).not.toBeNull()

    element.busyGraphId = 'shared-b'
    await element.updateComplete
    expect(root.querySelector('[data-graph-id="shared-b"]')?.getAttribute('data-pending')).toBe('true')

    element.activeGraphId = 'shared-b'
    element.busyGraphId = ''
    await element.updateComplete
    await element.updateComplete
    expect(root.querySelector('.menu')).toBeNull()
    expect(root.querySelector('.trigger-label')?.textContent).toBe('Shared Notes')
  })

  it('emits only explicit typed management intents and preserves legacy delete/create events', async () => {
    const explicit: readonly MnWorkspaceSummary[] = [
      {
        graphId: 'owner',
        title: 'Owner',
        role: 'owner',
        cellState: 'running',
        capabilities: { rename: { available: true }, delete: { available: true } },
      },
      {
        graphId: 'shared',
        title: 'Shared',
        role: 'editor',
        cellState: 'running',
        capabilities: { leave: { available: true } },
      },
    ]
    const element = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owner'
      selector.workspaces = explicit
    })
    const events: string[] = []
    for (const name of ['rename', 'delete', 'leave'] as const) {
      element.addEventListener(`mn-workspace-${name}`, event => {
        events.push(`${name}:${(event as CustomEvent).detail.workspace.graphId}`)
      })
    }
    element.addEventListener('mn-workspace-create', () => events.push('create'))

    let root = await open(element)
    ;(root.querySelector('[data-graph-id="owner"] .more') as HTMLButtonElement).click()
    await element.updateComplete
    expect(Array.from(root.querySelectorAll('.action-item')).map(item => item.getAttribute('data-action'))).toEqual(['rename', 'delete'])
    ;(root.querySelector('.action-item[data-action="rename"]') as HTMLButtonElement).click()
    expect(events).toEqual(['rename:owner'])

    root = await open(element)
    ;(root.querySelector('[data-graph-id="shared"] .more') as HTMLButtonElement).click()
    await element.updateComplete
    ;(root.querySelector('.action-item[data-action="leave"]') as HTMLButtonElement).click()
    expect(events).toEqual(['rename:owner', 'leave:shared'])

    root = await open(element)
    ;(root.querySelector('.create') as HTMLButtonElement).click()
    expect(events).toEqual(['rename:owner', 'leave:shared', 'create'])
  })

  it('covers loading/error/empty truth, refresh, outside close, and keyboard escape', async () => {
    const element = await mount(selector => {
      selector.status = 'idle'
      selector.workspaces = []
    })
    let refreshes = 0
    element.addEventListener('mn-workspace-refresh', () => { refreshes += 1 })
    const trigger = element.shadowRoot!.querySelector('.trigger') as HTMLButtonElement

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await element.updateComplete
    expect(refreshes).toBe(1)
    expect(element.shadowRoot!.querySelector('.state')?.textContent).toContain('Loading')

    element.status = 'error'
    element.error = 'Catalog failed honestly.'
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('Catalog failed honestly')
    ;(element.shadowRoot!.querySelector('.retry') as HTMLButtonElement).click()
    expect(refreshes).toBe(2)

    element.shadowRoot!.querySelector('.menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await element.updateComplete
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    trigger.click()
    await element.updateComplete
    element.status = 'ready'
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.state')?.textContent).toContain('No workspaces found')

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    await element.updateComplete
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('mirrors all selector skins and themes for coherent shadow-DOM styling', async () => {
    document.documentElement.dataset.skin = 'glass'
    document.documentElement.dataset.theme = 'dark'
    const element = await mount(selector => {
      selector.status = 'ready'
      selector.workspaces = workspaces
    })
    expect(element.getAttribute('data-skin')).toBe('glass')
    expect(element.getAttribute('data-theme')).toBe('dark')

    document.documentElement.dataset.skin = '98'
    document.documentElement.dataset.theme = 'light'
    await new Promise(resolve => setTimeout(resolve, 0))
    await element.updateComplete
    expect(element.getAttribute('data-skin')).toBe('98')
    expect(element.getAttribute('data-theme')).toBe('light')
  })

  it('promotes the open workspace menu into the top layer (regression: canary clip-under-doc-bar)', async () => {
    // Collision geometry: a low-capped stacking-context island (mn-top-bar :host
    // z-index:2) hosting the selector, plus a sibling root-level stacking context
    // (the concordance .pane-header z-index:3) that used to paint OVER the
    // trapped menu. Scene-setting; the executable assertion is the top-layer
    // contract (see DIAGNOSIS.md Part 1).
    const island = document.createElement('div')
    island.style.cssText = 'position:relative; z-index:2'
    const sibling = document.createElement('div')
    sibling.style.cssText = 'position:relative; z-index:3'
    document.body.append(island, sibling)

    const element = document.createElement('mn-workspace-selector') as MnWorkspaceSelector
    element.status = 'ready'
    element.workspaces = workspaces
    element.activeGraphId = 'owned-a'
    island.append(element)
    await element.updateComplete
    ;(element.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click()
    await element.updateComplete

    const menu = element.shadowRoot!.querySelector('.menu') as HTMLElement
    expect(menu).not.toBeNull()
    // FIX: the menu is a Popover-API element — the native top layer escapes
    // ancestor z-index/overflow/transform, so the z-2 island no longer traps
    // it under the z-3 sibling.
    expect(menu.hasAttribute('popover')).toBe(true)
    const nativeOpen = (() => {
      try {
        return menu.matches(':popover-open')
      } catch {
        return false
      }
    })()
    expect(nativeOpen || menu.hasAttribute('popover-open')).toBe(true)
  })

  it('clears top-layer popover state when disconnected while open, and does not resurrect it on reinsertion (regression r1)', async () => {
    const element = await mount(selector => {
      selector.status = 'ready'
      selector.activeGraphId = 'owned-a'
      selector.workspaces = workspaces
    })
    const root = await open(element)
    const menu = root.querySelector('.menu') as HTMLElement
    expect(menu).not.toBeNull()
    expect(menu.hasAttribute('popover-open')).toBe(true)

    element.remove()

    // hostDisconnected() hides the popover SYNCHRONOUSLY (it operates on the
    // captured DOM node directly, not through Lit's async render cycle) —
    // observable immediately, before any awaited re-render.
    expect(menu.hasAttribute('popover-open')).toBe(false)

    // `setOpen(false)` in disconnectedCallback reconciles the reactive
    // `open` state too; that surfaces once the (async) re-render settles —
    // Lit keeps processing pending updates even while disconnected.
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('.trigger')?.getAttribute('aria-expanded')).toBe('false')

    document.body.append(element)
    await element.updateComplete

    // Reinsertion alone must not resurrect the menu: `open` was reconciled
    // to false on disconnect, so the conditional render omits `.menu`
    // entirely until the trigger is clicked again.
    expect(element.shadowRoot!.querySelector('.menu')).toBeNull()

    // The selector must still be fully functional after the round trip.
    const reopened = await open(element)
    expect(reopened.querySelector('.menu')).not.toBeNull()
    expect(reopened.querySelector('.menu')?.hasAttribute('popover-open')).toBe(true)
  })
})
