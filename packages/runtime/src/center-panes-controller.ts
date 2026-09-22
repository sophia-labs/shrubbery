import type { EditorHostBinding, EditorHostState } from './editor-host-binding.js'
import { NULL_EDITOR_HOST_STATE } from './editor-host-binding.js'
import {
  createCenterPanesState,
  projectCenterPanes,
  reduceCenterPanes,
  setCenterPanesPosture,
  type CenterPaneProjectionOptions,
  type CreateCenterPanesStateOptions,
} from './center-panes-model.js'
import type {
  CenterPaneId,
  CenterPanePosture,
  CenterPanesIntent,
  CenterPanesProjection,
  CenterPanesState,
} from './center-panes-contract.js'

export interface MutableEditorHostBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}

export function createMutableEditorHostBinding(
  initial: EditorHostState = NULL_EDITOR_HOST_STATE,
): MutableEditorHostBinding {
  let value = initial
  const subscribers = new Set<(next: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    set(next) {
      if (next === value) return
      value = next
      for (const callback of subscribers) callback(value)
    },
  }
}

export interface CenterPanesControllerOptions extends CreateCenterPanesStateOptions {
  readonly projection?: CenterPaneProjectionOptions
}

/**
 * Session-level pane controller. It owns only pane assignment/history/layout and
 * stable binding objects. A shell still resolves locations into ProviderHandles
 * and calls setEditorState(); the controller never opens or destroys a room.
 */
export class CenterPanesController {
  private current: CenterPanesState
  private projectionOptions: CenterPaneProjectionOptions
  private readonly stateSubscribers = new Set<(state: CenterPanesState) => void>()
  private readonly bindingByPane = new Map<CenterPaneId, MutableEditorHostBinding>()

  constructor(options: CenterPanesControllerOptions = {}) {
    this.current = createCenterPanesState(options)
    this.projectionOptions = options.projection ?? {}
    this.ensureBinding(this.current.primary.id)
    this.ensureBinding(this.current.secondaryPaneId)
  }

  get state(): CenterPanesState {
    return this.current
  }

  get projection(): CenterPanesProjection {
    return projectCenterPanes(this.current, this.projectionOptions)
  }

  get bindings(): ReadonlyMap<CenterPaneId, EditorHostBinding> {
    return this.bindingByPane
  }

  subscribe(callback: (state: CenterPanesState) => void): () => void {
    this.stateSubscribers.add(callback)
    return () => this.stateSubscribers.delete(callback)
  }

  dispatch(intent: CenterPanesIntent): CenterPanesState {
    return this.replaceState(reduceCenterPanes(this.current, intent))
  }

  replaceState(next: CenterPanesState): CenterPanesState {
    if (next === this.current) return this.current
    this.current = next
    this.ensureBinding(next.primary.id)
    if (next.secondary) this.ensureBinding(next.secondary.id)
    for (const callback of this.stateSubscribers) callback(next)
    return next
  }

  setPosture(posture: CenterPanePosture): CenterPanesState {
    return this.replaceState(setCenterPanesPosture(this.current, posture))
  }

  setProjectionOptions(options: CenterPaneProjectionOptions): void {
    this.projectionOptions = options
    for (const callback of this.stateSubscribers) callback(this.current)
  }

  bindingFor(paneId: CenterPaneId): MutableEditorHostBinding {
    return this.ensureBinding(paneId)
  }

  setEditorState(paneId: CenterPaneId, state: EditorHostState): void {
    this.ensureBinding(paneId).set(state)
  }

  private ensureBinding(paneId: CenterPaneId): MutableEditorHostBinding {
    const existing = this.bindingByPane.get(paneId)
    if (existing) return existing
    const binding = createMutableEditorHostBinding()
    this.bindingByPane.set(paneId, binding)
    return binding
  }
}
