import type {
  CenterPaneLocation,
  CenterPaneNavigationState,
  CenterPanePosture,
  CenterPanesState,
} from './center-panes-contract.js'
import {
  CENTER_PANE_HISTORY_LIMIT,
  clampCenterDivider,
} from './center-panes-model.js'

export const CENTER_PANES_SESSION_SCHEMA_VERSION = 1
export const CENTER_PANES_SESSION_STORAGE_PREFIX = 'shrubbery:center-panes:v1'

export interface CenterPanesSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

interface CenterPanesSessionEnvelope {
  readonly version: typeof CENTER_PANES_SESSION_SCHEMA_VERSION
  readonly graphId: string
  readonly state: CenterPanesState
}

const POSTURES = new Set<CenterPanePosture>([
  'workspace',
  'left-collapsed',
  'right-collapsed',
  'both-collapsed',
  'zen',
  'compact',
])

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function location(value: unknown, graphId: string): CenterPaneLocation | null {
  const candidate = record(value)
  if (!candidate) return null
  if (candidate.kind === 'home') {
    if (candidate.graphId !== null && candidate.graphId !== graphId) return null
    return {
      kind: 'home',
      graphId,
      ...(typeof candidate.title === 'string' ? { title: candidate.title } : {}),
    }
  }
  if (candidate.kind !== 'document' || candidate.graphId !== graphId) return null
  const documentId = nonEmptyString(candidate.documentId)
  if (!documentId) return null
  return {
    kind: 'document',
    graphId,
    documentId,
    title: typeof candidate.title === 'string' ? candidate.title : documentId,
  }
}

function history(value: unknown, graphId: string): readonly CenterPaneLocation[] | null {
  if (!Array.isArray(value)) return null
  const parsed: CenterPaneLocation[] = []
  for (const item of value.slice(-CENTER_PANE_HISTORY_LIMIT)) {
    const parsedLocation = location(item, graphId)
    if (!parsedLocation) return null
    parsed.push(parsedLocation)
  }
  return parsed
}

function pane(
  value: unknown,
  position: CenterPaneNavigationState['position'],
  graphId: string,
): CenterPaneNavigationState | null {
  const candidate = record(value)
  if (!candidate || candidate.position !== position) return null
  const id = nonEmptyString(candidate.id)
  const current = location(candidate.current, graphId)
  const back = history(candidate.back, graphId)
  const forward = history(candidate.forward, graphId)
  if (!id || !current || !back || !forward) return null
  return { id, position, current, back, forward }
}

export function normalizeCenterPanesSessionState(
  value: unknown,
  graphId: string,
): CenterPanesState | null {
  if (!graphId) return null
  const candidate = record(value)
  if (!candidate) return null
  const primary = pane(candidate.primary, 'primary', graphId)
  const secondaryPaneId = nonEmptyString(candidate.secondaryPaneId)
  const secondary = candidate.secondary === null
    ? null
    : pane(candidate.secondary, 'secondary', graphId)
  const activePaneId = nonEmptyString(candidate.activePaneId)
  const posture = typeof candidate.posture === 'string' && POSTURES.has(candidate.posture as CenterPanePosture)
    ? candidate.posture as CenterPanePosture
    : null
  if (
    !primary
    || !secondaryPaneId
    || primary.id === secondaryPaneId
    || (secondary && secondary.id !== secondaryPaneId)
    || !activePaneId
    || (activePaneId !== primary.id && activePaneId !== secondary?.id)
    || typeof candidate.dividerPercent !== 'number'
    || !posture
  ) {
    return null
  }
  return {
    primary,
    secondaryPaneId,
    secondary,
    activePaneId,
    dividerPercent: clampCenterDivider(candidate.dividerPercent),
    posture,
  }
}

export function encodeCenterPanesSession(graphId: string, state: CenterPanesState): string {
  const normalized = normalizeCenterPanesSessionState(state, graphId)
  if (!normalized) throw new Error('Cannot persist center-pane state outside its graph session')
  const envelope: CenterPanesSessionEnvelope = {
    version: CENTER_PANES_SESSION_SCHEMA_VERSION,
    graphId,
    state: normalized,
  }
  return JSON.stringify(envelope)
}

export function decodeCenterPanesSession(raw: string, graphId: string): CenterPanesState | null {
  try {
    const envelope = record(JSON.parse(raw))
    if (
      !envelope
      || envelope.version !== CENTER_PANES_SESSION_SCHEMA_VERSION
      || envelope.graphId !== graphId
    ) {
      return null
    }
    return normalizeCenterPanesSessionState(envelope.state, graphId)
  } catch {
    return null
  }
}

export function centerPanesSessionStorageKey(graphId: string): string {
  if (!graphId) throw new Error('Center-pane session graphId must not be empty')
  return `${CENTER_PANES_SESSION_STORAGE_PREFIX}:${encodeURIComponent(graphId)}`
}

/** Browser-global-free adapter; the shell chooses sessionStorage vs another authority. */
export class CenterPanesSessionRepository {
  constructor(private readonly storage: CenterPanesSessionStorage | null) {}

  load(graphId: string): CenterPanesState | null {
    if (!this.storage) return null
    try {
      const raw = this.storage.getItem(centerPanesSessionStorageKey(graphId))
      return raw === null ? null : decodeCenterPanesSession(raw, graphId)
    } catch {
      return null
    }
  }

  save(graphId: string, state: CenterPanesState): boolean {
    if (!this.storage) return false
    try {
      this.storage.setItem(
        centerPanesSessionStorageKey(graphId),
        encodeCenterPanesSession(graphId, state),
      )
      return true
    } catch {
      return false
    }
  }

  clear(graphId: string): void {
    try {
      this.storage?.removeItem?.(centerPanesSessionStorageKey(graphId))
    } catch { /* storage is best-effort session state */ }
  }
}
