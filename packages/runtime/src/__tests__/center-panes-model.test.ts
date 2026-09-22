import { describe, expect, it } from 'vitest'
import {
  CENTER_PANE_HISTORY_LIMIT,
  closeCenterPane,
  createCenterPanesState,
  navigateCenterPane,
  openCenterPane,
  projectCenterPanes,
  resizeCenterPanes,
  setCenterPanesPosture,
} from '../center-panes-model.js'
import { CenterPanesController } from '../center-panes-controller.js'
import type { CenterPaneDocumentLocation } from '../center-panes-contract.js'

const documentLocation = (documentId: string): CenterPaneDocumentLocation => ({
  kind: 'document',
  graphId: 'garden',
  documentId,
  title: `Document ${documentId}`,
})
describe('center-panes pure session model', () => {
  it('opens a truthful second pane with stable ids and closes only that pane', () => {
    const initial = createCenterPanesState({
      primaryPaneId: 'pane-a',
      secondaryPaneId: 'pane-b',
      primaryLocation: documentLocation('alpha'),
    })
    const split = openCenterPane(initial, {
      paneId: 'pane-a',
      placement: 'split',
      location: documentLocation('beta'),
    })

    expect(split.primary.id).toBe('pane-a')
    expect(split.secondary?.id).toBe('pane-b')
    expect(split.secondary?.current).toEqual(documentLocation('beta'))
    expect(split.activePaneId).toBe('pane-b')
    expect(projectCenterPanes(split).splitCommand).toMatchObject({
      action: 'close',
      pressed: true,
      label: 'Close split view',
      disabled: false,
    })

    expect(closeCenterPane(split, 'pane-a')).toBe(split)
    const closed = closeCenterPane(split, 'pane-b')
    expect(closed.primary).toBe(split.primary)
    expect(closed.secondary).toBeNull()
    expect(closed.activePaneId).toBe('pane-a')
    expect(projectCenterPanes(closed).splitCommand).toMatchObject({
      action: 'open',
      pressed: false,
      label: 'Split view',
    })

    const reopened = openCenterPane(closed, {
      paneId: 'pane-a',
      placement: 'split',
      location: documentLocation('gamma'),
    })
    expect(reopened.secondary?.id).toBe('pane-b')
  })

  it('keeps back/forward history independent for both panes', () => {
    let state = createCenterPanesState({
      primaryLocation: documentLocation('alpha'),
      secondaryLocation: documentLocation('beta'),
    })
    const primaryId = state.primary.id
    const secondaryId = state.secondary!.id

    state = openCenterPane(state, {
      paneId: primaryId,
      placement: 'active',
      location: documentLocation('alpha-2'),
    })
    state = openCenterPane(state, {
      paneId: secondaryId,
      placement: 'active',
      location: documentLocation('beta-2'),
    })

    expect(state.primary.back.map((location) => location.kind === 'document' && location.documentId))
      .toEqual(['alpha'])
    expect(state.secondary?.back.map((location) => location.kind === 'document' && location.documentId))
      .toEqual(['beta'])

    state = navigateCenterPane(state, primaryId, 'back')
    expect(state.primary.current).toEqual(documentLocation('alpha'))
    expect(state.secondary?.current).toEqual(documentLocation('beta-2'))
    expect(state.secondary?.back).toHaveLength(1)

    state = navigateCenterPane(state, primaryId, 'forward')
    expect(state.primary.current).toEqual(documentLocation('alpha-2'))
    expect(state.secondary?.current).toEqual(documentLocation('beta-2'))
  })

  it('bounds history, clamps divider geometry, and preserves layout across posture', () => {
    let state = createCenterPanesState({ primaryLocation: documentLocation('seed') })
    for (let index = 0; index < CENTER_PANE_HISTORY_LIMIT + 12; index += 1) {
      state = openCenterPane(state, {
        paneId: state.primary.id,
        placement: 'active',
        location: documentLocation(`doc-${index}`),
      })
    }
    expect(state.primary.back).toHaveLength(CENTER_PANE_HISTORY_LIMIT)

    state = resizeCenterPanes(state, 97)
    expect(state.dividerPercent).toBe(80)
    state = resizeCenterPanes(state, -4)
    expect(state.dividerPercent).toBe(20)
    state = setCenterPanesPosture(state, 'left-collapsed')
    expect(state.dividerPercent).toBe(20)
    expect(state.posture).toBe('left-collapsed')
  })

  it('keeps one stable reactive editor binding object per pane', () => {
    const controller = new CenterPanesController({
      primaryPaneId: 'stable-primary',
      secondaryPaneId: 'stable-secondary',
      primaryLocation: documentLocation('alpha'),
    })
    const primary = controller.bindingFor('stable-primary')
    const secondary = controller.bindingFor('stable-secondary')
    const opened = openCenterPane(controller.state, {
      paneId: 'stable-primary',
      placement: 'split',
      location: documentLocation('beta'),
    })
    controller.replaceState(opened)

    expect(controller.bindingFor('stable-primary')).toBe(primary)
    expect(controller.bindingFor('stable-secondary')).toBe(secondary)
    controller.replaceState(closeCenterPane(controller.state, 'stable-secondary'))
    expect(controller.bindingFor('stable-secondary')).toBe(secondary)
  })
})
