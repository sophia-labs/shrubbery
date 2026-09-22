import {
  DEFAULT_CENTER_PANES_CAPABILITIES,
  PRIMARY_CENTER_PANE_ID,
  SECONDARY_CENTER_PANE_ID,
  type CenterPaneCapabilities,
  type CenterPaneId,
  type CenterPaneLocation,
  type CenterPaneNavigationState,
  type CenterPanePosture,
  type CenterPaneProjection,
  type CenterPanesCapabilities,
  type CenterPanesIntent,
  type CenterPanesProjection,
  type CenterPanesState,
} from './center-panes-contract.js'

export const CENTER_PANE_HISTORY_LIMIT = 50
export const DEFAULT_CENTER_DIVIDER_PERCENT = 50
export const MIN_CENTER_DIVIDER_PERCENT = 20
export const MAX_CENTER_DIVIDER_PERCENT = 80

export interface CreateCenterPanesStateOptions {
  readonly graphId?: string | null
  readonly primaryPaneId?: CenterPaneId
  readonly secondaryPaneId?: CenterPaneId
  readonly primaryLocation?: CenterPaneLocation
  readonly secondaryLocation?: CenterPaneLocation | null
  readonly activePaneId?: CenterPaneId
  readonly dividerPercent?: number
  readonly posture?: CenterPanePosture
}

export interface CenterPaneProjectionOptions {
  readonly capabilities?: Partial<CenterPanesCapabilities>
  readonly paneCapabilities?: Readonly<Record<CenterPaneId, Partial<CenterPaneCapabilities>>>
  readonly dividerMinPercent?: number
  readonly dividerMaxPercent?: number
}

export function homeLocation(graphId: string | null = null): CenterPaneLocation {
  return { kind: 'home', graphId, title: 'Home' }
}

export function centerPaneLocationKey(location: CenterPaneLocation): string {
  return location.kind === 'document'
    ? `document:${location.graphId}:${location.documentId}`
    : `home:${location.graphId ?? ''}`
}

export function sameCenterPaneLocation(a: CenterPaneLocation, b: CenterPaneLocation): boolean {
  return centerPaneLocationKey(a) === centerPaneLocationKey(b)
}

export function clampCenterDivider(
  value: number,
  min = MIN_CENTER_DIVIDER_PERCENT,
  max = MAX_CENTER_DIVIDER_PERCENT,
): number {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  if (!Number.isFinite(value)) return DEFAULT_CENTER_DIVIDER_PERCENT
  return Math.min(high, Math.max(low, Math.round(value * 100) / 100))
}

function pane(
  id: CenterPaneId,
  position: CenterPaneNavigationState['position'],
  current: CenterPaneLocation,
): CenterPaneNavigationState {
  return { id, position, current, back: [], forward: [] }
}

export function createCenterPanesState(
  options: CreateCenterPanesStateOptions = {},
): CenterPanesState {
  const primaryPaneId = options.primaryPaneId ?? PRIMARY_CENTER_PANE_ID
  const secondaryPaneId = options.secondaryPaneId ?? SECONDARY_CENTER_PANE_ID
  if (primaryPaneId === secondaryPaneId) {
    throw new Error('Center pane ids must be distinct')
  }
  const primary = pane(
    primaryPaneId,
    'primary',
    options.primaryLocation ?? homeLocation(options.graphId ?? null),
  )
  const secondary = options.secondaryLocation == null
    ? null
    : pane(secondaryPaneId, 'secondary', options.secondaryLocation)
  const requestedActive = options.activePaneId
  const activePaneId = secondary && requestedActive === secondary.id ? secondary.id : primary.id
  return {
    primary,
    secondaryPaneId,
    secondary,
    activePaneId,
    dividerPercent: clampCenterDivider(options.dividerPercent ?? DEFAULT_CENTER_DIVIDER_PERCENT),
    posture: options.posture ?? 'workspace',
  }
}

export function centerPaneById(
  state: CenterPanesState,
  paneId: CenterPaneId,
): CenterPaneNavigationState | null {
  if (state.primary.id === paneId) return state.primary
  if (state.secondary?.id === paneId) return state.secondary
  return null
}

function replacePane(
  state: CenterPanesState,
  next: CenterPaneNavigationState,
): CenterPanesState {
  if (next.id === state.primary.id) return { ...state, primary: next }
  if (next.id === state.secondary?.id) return { ...state, secondary: next }
  return state
}

function pushBounded(
  history: readonly CenterPaneLocation[],
  location: CenterPaneLocation,
): readonly CenterPaneLocation[] {
  const next = [...history, location]
  return next.length > CENTER_PANE_HISTORY_LIMIT
    ? next.slice(next.length - CENTER_PANE_HISTORY_LIMIT)
    : next
}

function openInPane(
  current: CenterPaneNavigationState,
  location: CenterPaneLocation,
): CenterPaneNavigationState {
  if (sameCenterPaneLocation(current.current, location)) return current
  return {
    ...current,
    current: location,
    back: pushBounded(current.back, current.current),
    forward: [],
  }
}

export function focusCenterPane(state: CenterPanesState, paneId: CenterPaneId): CenterPanesState {
  return centerPaneById(state, paneId) && state.activePaneId !== paneId
    ? { ...state, activePaneId: paneId }
    : state
}

export function openCenterPane(
  state: CenterPanesState,
  options: {
    readonly paneId: CenterPaneId
    readonly placement: 'active' | 'split'
    readonly location: CenterPaneLocation
    readonly activate?: boolean
  },
): CenterPanesState {
  if (options.placement === 'active') {
    const target = centerPaneById(state, options.paneId) ?? centerPaneById(state, state.activePaneId)
    if (!target) return state
    const next = replacePane(state, openInPane(target, options.location))
    return options.activate === false ? next : focusCenterPane(next, target.id)
  }

  if (!state.secondary) {
    const secondary = pane(state.secondaryPaneId, 'secondary', options.location)
    return {
      ...state,
      secondary,
      activePaneId: options.activate === false ? state.activePaneId : secondary.id,
    }
  }

  const target = state.activePaneId === state.secondary.id ? state.primary : state.secondary
  const next = replacePane(state, openInPane(target, options.location))
  return options.activate === false ? next : focusCenterPane(next, target.id)
}

export function closeCenterPane(state: CenterPanesState, paneId: CenterPaneId): CenterPanesState {
  if (!state.secondary || state.secondary.id !== paneId) return state
  return { ...state, secondary: null, activePaneId: state.primary.id }
}

export function navigateCenterPane(
  state: CenterPanesState,
  paneId: CenterPaneId,
  direction: 'back' | 'forward',
): CenterPanesState {
  const current = centerPaneById(state, paneId)
  if (!current) return state

  if (direction === 'back') {
    if (current.back.length === 0) return state
    const target = current.back[current.back.length - 1]!
    const nextPane: CenterPaneNavigationState = {
      ...current,
      current: target,
      back: current.back.slice(0, -1),
      forward: [current.current, ...current.forward].slice(0, CENTER_PANE_HISTORY_LIMIT),
    }
    return focusCenterPane(replacePane(state, nextPane), paneId)
  }

  if (current.forward.length === 0) return state
  const target = current.forward[0]!
  const nextPane: CenterPaneNavigationState = {
    ...current,
    current: target,
    back: pushBounded(current.back, current.current),
    forward: current.forward.slice(1),
  }
  return focusCenterPane(replacePane(state, nextPane), paneId)
}

export function resizeCenterPanes(
  state: CenterPanesState,
  dividerPercent: number,
  min = MIN_CENTER_DIVIDER_PERCENT,
  max = MAX_CENTER_DIVIDER_PERCENT,
): CenterPanesState {
  const next = clampCenterDivider(dividerPercent, min, max)
  return next === state.dividerPercent ? state : { ...state, dividerPercent: next }
}

export function setCenterPanesPosture(
  state: CenterPanesState,
  posture: CenterPanePosture,
): CenterPanesState {
  return state.posture === posture ? state : { ...state, posture }
}

export function reduceCenterPanes(
  state: CenterPanesState,
  intent: CenterPanesIntent,
): CenterPanesState {
  switch (intent.type) {
    case 'open':
      return intent.detail.location
        ? openCenterPane(state, {
            paneId: intent.detail.paneId,
            placement: intent.detail.placement,
            location: intent.detail.location,
            activate: intent.detail.activate,
          })
        : state
    case 'focus':
      return focusCenterPane(state, intent.detail.paneId)
    case 'close':
      return closeCenterPane(state, intent.detail.paneId)
    case 'navigate':
      return navigateCenterPane(state, intent.detail.paneId, intent.detail.direction)
    case 'resize':
      return resizeCenterPanes(state, intent.detail.dividerPercent)
  }
}

function defaultPaneCapabilities(position: 'primary' | 'secondary'): CenterPaneCapabilities {
  return {
    openDocument: true,
    navigate: true,
    close: position === 'secondary',
  }
}

function projectPane(
  paneState: CenterPaneNavigationState,
  state: CenterPanesState,
  overrides: Partial<CenterPaneCapabilities> | undefined,
): CenterPaneProjection {
  const capabilities = { ...defaultPaneCapabilities(paneState.position), ...overrides }
  return {
    ...paneState,
    active: state.activePaneId === paneState.id,
    title: paneState.current.title ?? (paneState.current.kind === 'home' ? 'Home' : 'Untitled'),
    canGoBack: capabilities.navigate && paneState.back.length > 0,
    canGoForward: capabilities.navigate && paneState.forward.length > 0,
    capabilities,
  }
}

export function projectCenterPanes(
  state: CenterPanesState,
  options: CenterPaneProjectionOptions = {},
): CenterPanesProjection {
  const capabilities: CenterPanesCapabilities = {
    ...DEFAULT_CENTER_PANES_CAPABILITIES,
    ...options.capabilities,
  }
  const dividerMinPercent = options.dividerMinPercent ?? MIN_CENTER_DIVIDER_PERCENT
  const dividerMaxPercent = options.dividerMaxPercent ?? MAX_CENTER_DIVIDER_PERCENT
  const panes = [
    projectPane(state.primary, state, options.paneCapabilities?.[state.primary.id]),
    ...(state.secondary
      ? [projectPane(state.secondary, state, options.paneCapabilities?.[state.secondary.id])]
      : []),
  ]
  const split = state.secondary !== null
  const commandAllowed = split ? capabilities.closeSplit : capabilities.split
  const disabledReason = split
    ? capabilities.closeSplitDisabledReason
    : capabilities.splitDisabledReason
  return {
    panes,
    activePaneId: state.activePaneId,
    dividerPercent: clampCenterDivider(state.dividerPercent, dividerMinPercent, dividerMaxPercent),
    dividerMinPercent,
    dividerMaxPercent,
    posture: state.posture,
    split,
    splitCommand: {
      action: split ? 'close' : 'open',
      pressed: split,
      label: split ? 'Close split view' : 'Split view',
      disabled: !commandAllowed,
      ...(disabledReason ? { disabledReason } : {}),
    },
    capabilities,
  }
}
