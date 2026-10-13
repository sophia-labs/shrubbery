/**
 * Per-browser-tab panel layout state for the Organism shell.
 *
 * Garden owns these values in its per-tab session Y.Map. Organism does not have
 * that session document, so sessionStorage is the closest honest authority: it
 * survives a reload, is isolated between tabs, and never promotes transient
 * collapse/width state into the workspace RDF configuration.
 *
 * The record is scoped PER APP (`panelLayoutStorageKey`). Garden and every
 * other app each read and write their own key, so a pixel width dragged
 * in one app can never leak into another's default geometry — the historical
 * bug this guards against was every app sharing one unscoped record, which
 * meant a second app rendered with Garden's saved/default pixel widths instead of its
 * own `sizeFraction`-driven proportions.
 */

import { GARDEN_SITE_BUNDLE } from '@shrubbery/site/garden'

export interface PanelLayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface OrganismPanelLayoutState {
  /** `null` = no saved pixel override; the region's own `sizeFraction` drives it. */
  readonly leftPanelWidth: number | null
  readonly rightPanelWidth: number | null
  readonly leftCollapsed: boolean
  readonly leftExpanded: boolean
  readonly rightCollapsed: boolean
}

/**
 * Garden's key, unchanged since before per-app scoping existed. This IS the
 * migration: Garden keeps reading/writing exactly where it always has, so
 * every previously saved Garden width keeps loading as Garden's. Every other
 * app gets its own suffixed key via `panelLayoutStorageKey` and can never read
 * or write Garden's record, or another app's.
 */
export const PANEL_LAYOUT_STORAGE_KEY = 'shrubbery.organism.panel-layout.v1'

/** The app id that owns the unscoped legacy key. */
const GARDEN_APP_ID = 'garden'

/** Per-app storage key. Garden's stays the bare legacy key; every other app is suffixed. */
export function panelLayoutStorageKey(app: string | undefined): string {
  return !app || app === GARDEN_APP_ID ? PANEL_LAYOUT_STORAGE_KEY : `${PANEL_LAYOUT_STORAGE_KEY}.${app}`
}

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

/**
 * The layout every app OTHER than Garden starts from: no inherited pixel
 * width, so the app's own region `sizeFraction` drives the split — until that app's user resizes a divider and earns
 * its own saved pixels under its own key.
 */
export const APP_NATIVE_PANEL_LAYOUT: OrganismPanelLayoutState = Object.freeze({
  leftPanelWidth: null,
  rightPanelWidth: null,
  leftCollapsed: false,
  leftExpanded: false,
  rightCollapsed: false,
})

/** The state an app should start from before its own storage key has ever been written. */
export function defaultPanelLayoutForApp(app: string | undefined): OrganismPanelLayoutState {
  return !app || app === GARDEN_APP_ID ? DEFAULT_PANEL_LAYOUT : APP_NATIVE_PANEL_LAYOUT
}

function normalizedWidth(value: unknown, fallback: number | null, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function normalizePanelLayoutState(
  value: unknown,
  fallback: OrganismPanelLayoutState = DEFAULT_PANEL_LAYOUT,
): OrganismPanelLayoutState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const leftCollapsed = source.leftCollapsed === true
  const leftExpanded = !leftCollapsed && source.leftExpanded === true
  return {
    leftPanelWidth: normalizedWidth(source.leftPanelWidth, fallback.leftPanelWidth, GARDEN_SITE_BUNDLE.panels.left.min, GARDEN_SITE_BUNDLE.panels.left.max),
    rightPanelWidth: normalizedWidth(source.rightPanelWidth, fallback.rightPanelWidth, GARDEN_SITE_BUNDLE.panels.right.min, GARDEN_SITE_BUNDLE.panels.right.max),
    leftCollapsed,
    leftExpanded,
    rightCollapsed: leftExpanded || source.rightCollapsed === true,
  }
}

export function readPanelLayoutState(
  storage: PanelLayoutStorage | null | undefined,
  key = PANEL_LAYOUT_STORAGE_KEY,
  fallback: OrganismPanelLayoutState = DEFAULT_PANEL_LAYOUT,
): OrganismPanelLayoutState {
  if (!storage) return { ...fallback }
  try {
    const raw = storage.getItem(key)
    return raw ? normalizePanelLayoutState(JSON.parse(raw), fallback) : { ...fallback }
  } catch {
    return { ...fallback }
  }
}

export function writePanelLayoutState(
  storage: PanelLayoutStorage | null | undefined,
  state: OrganismPanelLayoutState,
  key = PANEL_LAYOUT_STORAGE_KEY,
): void {
  if (!storage) return
  try {
    // Fallback = the state itself: an already-`null` width (no override earned
    // yet in this app) must stay `null`, never get coerced to Garden's pixel
    // default just because it round-trips through normalization here.
    storage.setItem(key, JSON.stringify(normalizePanelLayoutState(state, state)))
  } catch {
    // Persistence is best effort. The in-memory tab state remains operational.
  }
}
