import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { createCenterPanesState, focusCenterPane, projectCenterPanes } from '../center-panes-model.js'
import {
  renderWorkspace,
  workspaceSurfaceReady,
  type CenterPaneCloseIntentDetail,
  type CenterPaneFocusIntentDetail,
  type CenterPaneOpenIntentDetail,
  type CenterPaneResizeIntentDetail,
  type WorkspaceCenterPanesOptions,
} from '../index.js'
import type { WorkspaceSurfaceElement } from '../layout/workspace-surface-element.js'

/** Closure recorder — the no-mocks stand-in for an intent-callback sink. */
function recorder<T>(): { readonly calls: T[]; readonly fn: (detail: T) => void } {
  const calls: T[] = []
  return { calls, fn: detail => { calls.push(detail) } }
}

function centerOptions(
  dividerPercent: number,
  onClose: (detail: CenterPaneCloseIntentDetail) => void = () => {},
  onResize: (detail: CenterPaneResizeIntentDetail) => void = () => {},
): WorkspaceCenterPanesOptions {
  const state = createCenterPanesState({
    graphId: 'graph-a',
    secondaryLocation: { kind: 'home', graphId: 'graph-a', title: 'Second path' },
    dividerPercent,
  })
  return {
    projection: projectCenterPanes(state),
    editorHosts: new Map(),
    onClose,
    onResize,
  }
}

describe('renderWorkspace Surface production path', () => {
  it('routes the entire main pane through one recursive LayoutDocument', async () => {
    const close = recorder<CenterPaneCloseIntentDetail>()
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      centerPanes: centerOptions(57, close.fn),
      chrome: { rightPanel: 'comments' },
    })
    await workspaceSurfaceReady(container)

    const frame = container.querySelector<HTMLElement>('.app-container')!
    const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
    expect(frame.dataset.workspaceRenderer).toBe('surface')
    expect(surface).not.toBeNull()
    expect(container.querySelector('sl-split-panel')).toBeNull()
    expect(container.querySelector('sh-center-panes')).toBeNull()

    const layout = surface.surfaceDocument()!
    expect(layout.rootNodeId).toBe('workspace-spine:region-left-rail')
    expect(layout.nodes['center-root-split']).toMatchObject({
      kind: 'split',
      axis: 'horizontal',
      startBasisPoints: 5700,
    })
    expect(layout.nodes['center-primary:frame']).toMatchObject({ kind: 'split', axis: 'vertical' })
    expect(layout.nodes['workspace-right-stack:0']).toBeUndefined()
    expect(layout.nodes['workspace-panel:right']).toMatchObject({ kind: 'leaf' })

    expect(container.querySelector('[data-surface-part="sidebar"] mn-sidebar-panel')).not.toBeNull()
    expect(container.querySelector('[data-surface-part="sidebar"]')?.getAttribute('role')).toBe('navigation')
    expect(container.querySelector('[data-panel="chat"]')).toBeNull()
    expect(container.querySelector('[data-panel="comments"] mn-comments-panel')).not.toBeNull()
    expect(container.querySelectorAll('[data-surface-part="right-panel"][role="complementary"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-surface-part="pane-header"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-surface-part="center-content"]')).toHaveLength(2)

    container.querySelector<HTMLButtonElement>('[data-pane-close="center-secondary"]')!.click()
    expect(close.calls).toEqual([{ paneId: 'center-secondary', reason: 'pane-command' }])
  })

  it('reconciles ratio changes by stable leaf id without remounting pane content', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(45),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const primaryBefore = container.querySelector('[data-layout-node-id="center-primary"]')
      const surfaceBefore = surface

      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(65),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)

      const surfaceAfter = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const primaryAfter = container.querySelector('[data-layout-node-id="center-primary"]')
      expect(surfaceAfter).toBe(surfaceBefore)
      expect(primaryAfter).toBe(primaryBefore)
      expect(surfaceAfter.surfaceDocument()!.nodes['center-root-split']).toMatchObject({
        kind: 'split',
        startBasisPoints: 6500,
      })
    } finally {
      container.remove()
    }
  })

  it('does not reactivate or rebuild an already-active editor for its pointerdown and focusin', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      const state = createCenterPanesState({ graphId: 'graph-a' })
      let renderCount = 0
      const onFocus = recorder<CenterPaneFocusIntentDetail>()
      const draw = (): void => {
        renderCount += 1
        renderWorkspace(GARDEN_DEFAULT, {
          container,
          surface: true,
          centerPanes: {
            projection: projectCenterPanes(state),
            editorHosts: new Map(),
            // Model the Organism owner: every focus intent would synchronously
            // perform another controlled workspace render.
            onFocus: detail => {
              onFocus.fn(detail)
              draw()
            },
          },
          chrome: { rightPanels: ['chat'] },
        })
      }

      draw()
      await workspaceSurfaceReady(container)
      const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
      const editorHost = container.querySelector<HTMLElement>(
        '[data-layout-node-id="center-primary"] sh-editor-host',
      )!
      let readyEvents = 0
      surface.addEventListener('sh-workspace-surface-ready', () => { readyEvents += 1 })

      editorHost.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
      editorHost.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
      await Promise.resolve()
      await Promise.resolve()

      expect(onFocus.calls).toHaveLength(0)
      expect(renderCount).toBe(1)
      expect(readyEvents).toBe(0)
      expect(container.querySelector('[data-layout-node-id="center-primary"] sh-editor-host')).toBe(editorHost)
    } finally {
      container.remove()
    }
  })

  it('filters header command focus and activates an inactive editor only once across pointerdown and focusin', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      let state = createCenterPanesState({
        graphId: 'graph-a',
        secondaryLocation: { kind: 'home', graphId: 'graph-a', title: 'Second path' },
        activePaneId: 'center-secondary',
      })
      let renderCount = 0
      const onFocus = recorder<CenterPaneFocusIntentDetail>()
      const draw = (): void => {
        renderCount += 1
        renderWorkspace(GARDEN_DEFAULT, {
          container,
          surface: true,
          centerPanes: {
            projection: projectCenterPanes(state),
            editorHosts: new Map(),
            onFocus: detail => {
              onFocus.fn(detail)
              state = focusCenterPane(state, detail.paneId)
              draw()
            },
          },
          chrome: { rightPanels: ['chat'] },
        })
      }

      draw()
      await workspaceSurfaceReady(container)
      const headerCommand = container.querySelector<HTMLElement>('[data-pane-open="center-primary"]')!
      headerCommand.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
      headerCommand.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
      expect(onFocus.calls).toHaveLength(0)
      expect(renderCount).toBe(1)

      const editorHost = container.querySelector<HTMLElement>(
        '[data-layout-node-id="center-primary"] sh-editor-host',
      )!
      editorHost.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
      // The pointer intent synchronously projects this pane as active. The
      // browser's ensuing focusin must observe that state and remain inert.
      editorHost.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
      await workspaceSurfaceReady(container)

      expect(onFocus.calls).toEqual([{ paneId: 'center-primary', reason: 'pointer' }])
      expect(renderCount).toBe(2)
      expect(container.querySelector('[data-layout-node-id="center-primary"] sh-editor-host')).toBe(editorHost)
    } finally {
      container.remove()
    }
  })

  it('lets an inactive empty-pane open command activate through its complete open intent only', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      const state = createCenterPanesState({
        graphId: 'graph-a',
        secondaryLocation: { kind: 'home', graphId: 'graph-a', title: 'Second path' },
        activePaneId: 'center-secondary',
      })
      let renderCount = 0
      const onFocus = recorder<CenterPaneFocusIntentDetail>()
      const onOpen = recorder<CenterPaneOpenIntentDetail>()
      const draw = (): void => {
        renderCount += 1
        renderWorkspace(GARDEN_DEFAULT, {
          container,
          surface: true,
          centerPanes: {
            projection: projectCenterPanes(state),
            editorHosts: new Map(),
            onFocus: detail => {
              onFocus.fn(detail)
              draw()
            },
            onOpen: onOpen.fn,
          },
          chrome: { rightPanels: ['chat'] },
        })
      }

      draw()
      await workspaceSurfaceReady(container)
      const open = container.querySelector<HTMLButtonElement>(
        '[data-layout-node-id="center-primary"] .surface-pane-empty .empty-open',
      )!
      open.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
      open.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))

      expect(onFocus.calls).toHaveLength(0)
      expect(renderCount).toBe(1)

      open.click()
      expect(onOpen.calls).toEqual([{
        paneId: 'center-primary',
        placement: 'active',
        reason: 'choose-document',
        activate: true,
      }])
    } finally {
      container.remove()
    }
  })

  it.each([
    {
      role: 'left' as const,
      splitId: 'workspace-spine:region-left-rail',
      splitWidth: 1_000,
      nextBasisPoints: 3_200,
      expectedWidth: 320,
    },
    {
      role: 'right' as const,
      splitId: 'workspace-spine:region-center',
      splitWidth: 760,
      nextBasisPoints: 6_000,
      expectedWidth: 304,
    },
  ])('keeps a committed $role panel width in the model used by ResizeObserver rebuilds', async ({
    role,
    splitId,
    splitWidth,
    nextBasisPoints,
    expectedWidth,
  }) => {
    const onReposition = recorder<{ role: string; width: number; position: number; size: number }>()
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      panelLayout: {
        leftWidth: 240,
        rightWidth: 280,
        onReposition: onReposition.fn,
      },
      chrome: { rightPanels: ['chat'] },
    })
    await workspaceSurfaceReady(container)

    const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
    const model = surface.model!
    const before = model.build(1_000, 700)
    const split = before.document.nodes[splitId]
    expect(split?.kind).toBe('split')
    if (!split || split.kind !== 'split') throw new Error(`${splitId} is not a split`)

    model.onRatioChange?.({
      host: surface,
      document: before.document,
      operation: { op: 'set_ratio', splitId, startBasisPoints: nextBasisPoints },
      split: { ...split, startBasisPoints: nextBasisPoints },
      source: 'pointer',
      phase: 'commit',
      splitBox: { left: 0, top: 0, width: splitWidth, height: 700 },
    }, before.metadata)

    expect(onReposition.calls.at(-1)).toMatchObject({ role, width: expectedWidth })
    const rebuilt = model.build(1_000, 701)
    expect(rebuilt.document.nodes[splitId]).toMatchObject({
      kind: 'split',
      startBasisPoints: nextBasisPoints,
    })
  })

  it('persists the nested right width after the left divider changes its containing box', async () => {
    const onReposition = recorder<{ role: string; width: number; position: number; size: number }>()
    const container = renderWorkspace(GARDEN_DEFAULT, {
      surface: true,
      panelLayout: { leftWidth: 240, rightWidth: 420, onReposition: onReposition.fn },
      chrome: { rightPanels: ['chat'] },
    })
    await workspaceSurfaceReady(container)
    const surface = container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')!
    const model = surface.model!
    const built = model.build(1_000, 700)
    const leftSplit = built.document.nodes['workspace-spine:region-left-rail']
    if (!leftSplit || leftSplit.kind !== 'split') throw new Error('left Surface split is missing')

    const rightLeaf = surface.querySelector<HTMLElement>(
      '[data-layout-node-kind="leaf"][data-role="right"]',
    )!
    const rightSplit = surface.querySelector<HTMLElement>(
      '[data-layout-node-kind="split"][data-layout-node-id="workspace-spine:region-center"]',
    )!
    rightLeaf.style.width = '394px'
    rightSplit.style.width = '760px'

    model.onRatioChange?.({
      host: surface,
      document: built.document,
      operation: { op: 'set_ratio', splitId: leftSplit.id, startBasisPoints: 3_200 },
      split: { ...leftSplit, startBasisPoints: 3_200 },
      source: 'pointer',
      phase: 'commit',
      splitBox: { left: 0, top: 0, width: 1_000, height: 700 },
    }, built.metadata)

    await Promise.resolve()
    await workspaceSurfaceReady(container)
    await Promise.resolve()
    expect(onReposition.calls.at(-1)).toEqual({
      role: 'right',
      width: 394,
      position: (394 / 760) * 100,
      size: 760,
    })
  })

  it('replaces a pane-home face with its editor face when a secondary document opens', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(50),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      const secondaryBefore = container.querySelector('[data-layout-node-id="center-secondary"]')
      const secondaryHostBefore = secondaryBefore?.querySelector('sh-editor-host')
      expect(secondaryBefore).not.toBeNull()
      expect(secondaryHostBefore).not.toBeNull()
      expect(secondaryBefore?.querySelector('[data-pane-home="center-secondary"]')).not.toBeNull()

      const documentState = createCenterPanesState({
        graphId: 'graph-a',
        secondaryLocation: {
          kind: 'document',
          graphId: 'graph-a',
          documentId: 'doc-beta',
          title: 'Beta notebook',
        },
        activePaneId: 'center-secondary',
        dividerPercent: 50,
      })
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: {
          projection: projectCenterPanes(documentState),
          editorHosts: new Map(),
        },
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)

      const secondaryAfter = container.querySelector('[data-layout-node-id="center-secondary"]')
      expect(secondaryAfter).toBe(secondaryBefore)
      expect(secondaryAfter?.querySelector('sh-editor-host')).toBe(secondaryHostBefore)
      expect(secondaryAfter?.querySelector('[data-pane-home="center-secondary"]')).toBeNull()
      expect(
        container.querySelector<WorkspaceSurfaceElement>('sh-workspace-surface')
          ?.surfaceDocument()?.nodes['center-secondary'],
      ).toMatchObject({
        kind: 'leaf',
        descriptorRevision: 0,
        descriptor: {
          faceId: 'garden.pane-editor',
          resource: { kind: 'iri', iri: 'urn:shrubbery:surface:center-pane:center-secondary' },
        },
      })
    } finally {
      container.remove()
    }
  })

  it('preserves interpreter-owned wrapper metadata when a face is replaced', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      renderWorkspace(GARDEN_DEFAULT, {
        container,
        surface: true,
        centerPanes: centerOptions(50),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)
      const wrapperBefore = container.querySelector<HTMLElement>('[data-layout-node-id="workspace-panel:right"]')!
      expect(wrapperBefore.dataset.layoutNodeKind).toBe('leaf')

      const commentsInChatSlot = {
        ...GARDEN_DEFAULT,
        panels: {
          ...GARDEN_DEFAULT.panels,
          'panel-chat': {
            ...GARDEN_DEFAULT.panels['panel-chat'],
            renderedByComponent: 'mn-comments-panel',
          },
        },
      }
      renderWorkspace(commentsInChatSlot, {
        container,
        surface: true,
        centerPanes: centerOptions(50),
        chrome: { rightPanels: ['chat'] },
      })
      await workspaceSurfaceReady(container)

      const wrapperAfter = container.querySelector<HTMLElement>('[data-layout-node-id="workspace-panel:right"]')!
      expect(wrapperAfter).toBe(wrapperBefore)
      expect(wrapperAfter.dataset.layoutNodeKind).toBe('leaf')
      expect(wrapperAfter.dataset.layoutNodeId).toBe('workspace-panel:right')
      expect(wrapperAfter.dataset.surfaceTag).toBe('mn-comments-panel')
      expect(wrapperAfter.querySelector('mn-comments-panel')).not.toBeNull()
    } finally {
      container.remove()
    }
  })
})
