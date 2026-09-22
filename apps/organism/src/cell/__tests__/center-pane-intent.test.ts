import { describe, expect, it } from 'vitest'
import {
  CenterPanesController,
  createCenterPanesState,
} from '@shrubbery/runtime'
import { dispatchCenterPaneIntentChange } from '../center-pane-intent.js'

describe('dispatchCenterPaneIntentChange', () => {
  it('classifies focus in the already-active pane as an observational no-op', () => {
    const controller = new CenterPanesController({
      graphId: 'garden',
      primaryLocation: {
        kind: 'document',
        graphId: 'garden',
        documentId: 'daily-note',
        title: 'Daily note',
      },
    })
    const state = controller.state

    expect(dispatchCenterPaneIntentChange(controller, {
      type: 'focus',
      detail: { paneId: state.primary.id, reason: 'focus' },
    })).toBe(false)
    expect(controller.state).toBe(state)
  })

  it('reports a real pane activation once and suppresses its duplicate focus event', () => {
    const controller = new CenterPanesController()
    controller.replaceState(createCenterPanesState({
      graphId: 'garden',
      secondaryLocation: {
        kind: 'document',
        graphId: 'garden',
        documentId: 'second-document',
        title: 'Second document',
      },
    }))
    const secondaryId = controller.state.secondary!.id

    expect(dispatchCenterPaneIntentChange(controller, {
      type: 'focus',
      detail: { paneId: secondaryId, reason: 'pointer' },
    })).toBe(true)
    const activeState = controller.state
    expect(activeState.activePaneId).toBe(secondaryId)

    expect(dispatchCenterPaneIntentChange(controller, {
      type: 'focus',
      detail: { paneId: secondaryId, reason: 'focus' },
    })).toBe(false)
    expect(controller.state).toBe(activeState)
  })

  it('suppresses duplicate resize commits after the input already updated state', () => {
    const controller = new CenterPanesController()

    expect(dispatchCenterPaneIntentChange(controller, {
      type: 'resize',
      detail: { dividerPercent: 62, source: 'pointer' },
    })).toBe(true)
    const resizedState = controller.state

    expect(dispatchCenterPaneIntentChange(controller, {
      type: 'resize',
      detail: { dividerPercent: 62, source: 'pointer' },
    })).toBe(false)
    expect(controller.state).toBe(resizedState)
  })
})
