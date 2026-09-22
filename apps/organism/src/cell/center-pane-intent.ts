import type {
  CenterPanesIntent,
  CenterPanesState,
} from '@shrubbery/runtime'

interface CenterPaneIntentController {
  readonly state: CenterPanesState
  dispatch(intent: CenterPanesIntent): CenterPanesState
}

/**
 * Dispatch a controlled center-pane intent and report whether it changed the
 * canonical session state. CenterPanesController deliberately preserves object
 * identity for reducer no-ops; shells must honor that signal before rebuilding
 * an editor surface in response to observational pointer/focus events.
 */
export function dispatchCenterPaneIntentChange(
  controller: CenterPaneIntentController,
  intent: CenterPanesIntent,
): boolean {
  const previous = controller.state
  return controller.dispatch(intent) !== previous
}
