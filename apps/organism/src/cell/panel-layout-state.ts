/**
 * Per-browser-tab panel layout state for the Organism shell.
 *
 * Garden owns these values in its per-tab session Y.Map. Organism does not have
 * that session document, so sessionStorage is the closest honest authority: it
 * survives a reload, is isolated between tabs, and never promotes transient
 * collapse/width state into the workspace RDF configuration.
 */

import { GARDEN_SITE_BUNDLE } from '@shrubbery/site/garden'

export interface PanelLayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface OrganismPanelLayoutState {
  readonly leftPanelWidth: number
  readonly rightPanelWidth: number
  readonly leftCollapsed: boolean
  readonly leftExpanded: boolean
  readonly rightCollapsed: boolean
}

export const PANEL_LAYOUT_STORAGE_KEY = 'shrubbery.organism.panel-layout.v1'

/**
 * User-requested discrete snapping over Garden's persisted min/default/max
 * pixel widths. Garden provides these width modes and clamps but does not bind
 * Shoelace snap points itself; the explicit snapping is a ratified port
 * extension, not a claim of byte-identical Garden policy.
 */
export const LEFT_PANEL_SNAP = GARDEN_SITE_BUNDLE.panels.left.snap
export const RIGHT_PANEL_SNAP = GARDEN_SITE_BUNDLE.panels.right.snap
export const PANEL_SNAP_THRESHOLD_PX = GARDEN_SITE_BUNDLE.panels.snapThreshold

export const DEFAULT_PANEL_LAYOUT: OrganismPanelLayoutState = Object.freeze({
  leftPanelWidth: GARDEN_SITE_BUNDLE.panels.left.default,
  rightPanelWidth: GARDEN_SITE_BUNDLE.panels.right.default,
  leftCollapsed: false,
  leftExpanded: false,
  rightCollapsed: false,
})

function normalizedWidth(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function normalizePanelLayoutState(value: unknown): OrganismPanelLayoutState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const leftCollapsed = source.leftCollapsed === true
  const leftExpanded = !leftCollapsed && source.leftExpanded === true
  return {
    leftPanelWidth: normalizedWidth(source.leftPanelWidth, DEFAULT_PANEL_LAYOUT.leftPanelWidth, GARDEN_SITE_BUNDLE.panels.left.min, GARDEN_SITE_BUNDLE.panels.left.max),
    rightPanelWidth: normalizedWidth(source.rightPanelWidth, DEFAULT_PANEL_LAYOUT.rightPanelWidth, GARDEN_SITE_BUNDLE.panels.right.min, GARDEN_SITE_BUNDLE.panels.right.max),
    leftCollapsed,
    leftExpanded,
    rightCollapsed: leftExpanded || source.rightCollapsed === true,
  }
}

export function readPanelLayoutState(
  storage: PanelLayoutStorage | null | undefined,
  key = PANEL_LAYOUT_STORAGE_KEY,
): OrganismPanelLayoutState {
  if (!storage) return { ...DEFAULT_PANEL_LAYOUT }
  try {
    const raw = storage.getItem(key)
    return raw ? normalizePanelLayoutState(JSON.parse(raw)) : { ...DEFAULT_PANEL_LAYOUT }
  } catch {
    return { ...DEFAULT_PANEL_LAYOUT }
  }
}

export function writePanelLayoutState(
  storage: PanelLayoutStorage | null | undefined,
  state: OrganismPanelLayoutState,
  key = PANEL_LAYOUT_STORAGE_KEY,
): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(normalizePanelLayoutState(state)))
  } catch {
    // Persistence is best effort. The in-memory tab state remains operational.
  }
}
