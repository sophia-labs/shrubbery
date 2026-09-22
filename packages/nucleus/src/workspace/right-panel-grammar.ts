import type { PanelId } from './types.js'

/** The mutually-exclusive right-rail state used by the Garden shell. */
export type RightPanelMode = PanelId | 'none'

/** Garden's default contextual surface when the right rail is opened. */
export const DEFAULT_RIGHT_PANEL: PanelId = 'chat'

/**
 * Legacy Garden grammar: selecting the active surface closes the rail; selecting
 * another surface replaces it. This is deliberately not an additive toggle.
 */
export function selectRightPanel(current: RightPanelMode, next: PanelId): RightPanelMode {
  return current === next ? 'none' : next
}

/**
 * Convert the old array-shaped shell state to the scalar grammar. Existing
 * stacks are ordered by insertion, so the last entry is the most recently
 * selected surface and is the least surprising migration target.
 */
export function rightPanelModeFromPanels(panels: readonly PanelId[]): RightPanelMode {
  return panels.length > 0 ? panels[panels.length - 1] : 'none'
}

/** Compatibility projection for render hosts and older bridge consumers. */
export function panelsForRightPanelMode(mode: RightPanelMode): readonly PanelId[] {
  return mode === 'none' ? [] : [mode]
}
