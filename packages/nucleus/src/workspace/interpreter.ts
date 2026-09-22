/**
 * Workspace rendering-engine interpreter (increment 2 — widened: bars + sidebar + split-tree).
 *
 * Increment 1 (right-rail island):
 *   - resolvePanelTag(config, panelId): PanelId → config lookup → renderedByComponent.
 *   - stampPanelBody(tag): stamp a zero-prop custom-element body.
 *
 * Increment 2 (bars + sidebar + split-tree):
 *   - resolveSurfaceTag(config, surfaceId): resolve a chrome region's renderedByComponent.
 *   - planFor(config): WorkspaceSpinePlan — pure structural projection (no Lit, no DOM, no stores).
 *     Drives the divergence test and the flag-gated split-tree renderer.
 *
 * ALL functions here are pure (config in, value out). No Lit element, no store reads,
 * no DOM side-effects — except stampPanelBody/resolveSurfaceTag whose only output is a
 * TemplateResult (lit/static-html), which is itself a value.
 *
 * The panel→component and region→component tables are FIXED CODE, not agent-writable:
 * the agent reshapes WHICH panel docks WHERE; it never rewrites these maps nor how a
 * tag binds its props.
 */

import { html as staticHtml, unsafeStatic, type StaticValue } from 'lit/static-html.js'
import { html, type TemplateResult } from 'lit'
import type { AppId, PanelId, WorkspaceConfig } from './types.js'
import { isRenderableComponentTag } from './known-components.js'

// The persistence taxonomy + lookup now live in the folded component-library
// (component-library.ts) — a single source of per-tag metadata. Re-exported here
// so existing consumers that import `persistenceOf`/`Persistence` from the
// interpreter keep resolving. The agent reshapes WHICH region a panel docks in
// via config; it never edits the component library.
export { persistenceOf, isRegisteredComponent, COMPONENT_LIBRARY } from './component-library.js'
export type { Persistence, ComponentLibraryEntry } from './component-library.js'

/**
 * The FIXED, code-level, NOT-agent-writable map from app PanelId → sux panel id.
 *
 * `graph` routes to the modelled Garden graph panel; the Shrubbery lift is a
 * controlled Class-A panel, so it can participate in the ordinary right-rail
 * stack.
 */
const PANEL_ID_TO_SUX: Record<PanelId, string> = {
  chat: 'panel-chat',
  comments: 'panel-comments',
  wires: 'panel-wires',
  inspector: 'panel-inspector',
  graph: 'panel-graph',
}

/**
 * Resolve a right-rail PanelId to its component tag via the config.
 * Pure; returns null if the config lacks the panel (defensive fall-through).
 */
export function resolvePanelTag(config: WorkspaceConfig, panelId: PanelId): string | null {
  const suxId = PANEL_ID_TO_SUX[panelId]
  return config.panels[suxId]?.renderedByComponent ?? null
}

/**
 * Stamp a zero-prop custom-element body from a tag string.
 * Emits exactly `<tag></tag>` — DOM-identical to the literal arms.
 *
 * THE GRAPH→DOM SAFETY BOUNDARY. `tag` is a config/RDF-supplied string, and this
 * is the repo's ONLY `unsafeStatic` call site — so a raw tag reaching it is a
 * template-injection primitive (`div><img src=x onerror=…>` would be emitted as
 * live markup). We therefore stamp verbatim ONLY when `tag` passes the full
 * render gate (isRenderableComponentTag: strict custom-element grammar AND
 * catalog membership). Any other string — off-catalog, non-grammar, or an
 * injected fragment — resolves to an inert LABELED placeholder built with the
 * ordinary (auto-escaping) `html` tag, so the rejected string is bound as an
 * escaped attribute value and NEVER reaches `unsafeStatic`. This is
 * "unbuilt = inert, labeled placeholder", enforced by construction.
 */
export function stampPanelBody(tag: string): TemplateResult {
  if (!isRenderableComponentTag(tag)) return inertPlaceholder(tag)
  const t: StaticValue = unsafeStatic(tag)
  return staticHtml`<${t}></${t}>`
}

/**
 * The inert, labeled stand-in for a tag that failed the render gate. Built with
 * the auto-escaping `html` tag (NOT static-html): `mn-inert-placeholder` is a
 * fixed literal and the rejected tag is a bound attribute value that Lit escapes,
 * so no attacker-controlled string can break out into markup. The element is
 * deliberately unregistered — it renders as an empty inert box, an honest
 * placeholder rather than a silently-stamped raw string or a thrown crash.
 */
function inertPlaceholder(tag: string): TemplateResult {
  return html`<mn-inert-placeholder data-rejected-tag=${tag} role="note"></mn-inert-placeholder>`
}

// ─── Increment 2: surface resolver ───────────────────────────────────────────

/**
 * Resolve a chrome region's component tag.
 *
 * Resolution rule (one pass):
 *   1. region.renderedByComponent if set (chrome regions: top-bar, bottom-bar)
 *   2. panels[region.docksPanel[0]].renderedByComponent if docksPanel is non-empty
 *      (content regions: left-rail → panel-sidebar, right-rail → selected panel, etc.)
 *   3. null if neither applies.
 *
 * Pure; no DOM, no stores.
 */
export function resolveSurfaceTag(config: WorkspaceConfig, regionId: string): string | null {
  const region = config.regions[regionId]
  if (!region) return null
  if (region.renderedByComponent) return region.renderedByComponent
  const firstPanel = region.docksPanel[0]
  if (firstPanel) return config.panels[firstPanel]?.renderedByComponent ?? null
  return null
}

// ─── Increment 2: pure layout plan ───────────────────────────────────────────

/**
 * A leaf node in the layout plan — a region with no split (no child in the walk).
 */
export interface LeafNode {
  readonly kind: 'leaf'
  readonly regionId: string
}

/**
 * A split node — one sl-split-panel. The start-slot is the current region's
 * content; the end-slot is the recursive subtree.
 *
 * position: the start-slot's percentage of this split's total extent (0–100),
 *   rounded to 2 decimal places. Computed as:
 *   startFraction / (startFraction + endSubtreeFraction) × 100
 */
export interface SplitNode {
  readonly kind: 'split'
  readonly regionId: string      // the start-slot region
  readonly position: number      // sl-split-panel initial position (0–100, rounded)
  readonly child: WorkspaceSpinePlanNode // the end-slot subtree
}

export type WorkspaceSpinePlanNode = SplitNode | LeafNode

/**
 * The full layout plan — the output of planFor(config).
 * Drives both the divergence test and the flag-gated lit renderer.
 */
export interface WorkspaceSpinePlan {
  /** Chrome regions that bracket .main BEFORE it (order < spineHead.order). */
  readonly topChrome: readonly string[]
  /** Chrome regions that bracket .main AFTER it (order > spineHead.order). */
  readonly bottomChrome: readonly string[]
  /** The recursive split-tree rooted at the spine head. */
  readonly spine: WorkspaceSpinePlanNode
  /** The spine head region id (the one resizable root). */
  readonly spineHeadId: string
}

/**
 * Hard cap on childRegion spine depth. A well-formed linear spine is a handful
 * of regions deep; this bound sits orders of magnitude above any real config and
 * exists ONLY as a last-resort brake. validateConfig I2 is the real cycle gate,
 * but it runs on the WRITE/grow path only — the READ path (cell → renderer) may
 * skip it, so `walkSpine`/`subtreeFraction` must NOT stack-overflow on a cyclic
 * or pathologically deep config that slips through. On a cycle or an overrun the
 * walk terminates the spine (as a leaf / bounded sum) instead of bricking the
 * shell with a RangeError. Defense in depth: this holds EVEN IF validateConfig
 * was never called.
 */
const MAX_SPINE_DEPTH = 1024

/**
 * Sum the sizeFractions of a region and all its spine descendants.
 * Used for the position renormalization math (§3.3 of the design doc).
 *
 * Pure recursion over childRegion. The `seen` set + depth cap are the brake: a
 * revisited region (cycle) or an overrun contributes nothing further and stops
 * the recursion — bounded, never a stack overflow (see MAX_SPINE_DEPTH).
 */
function subtreeFraction(
  config: WorkspaceConfig,
  regionId: string,
  seen: Set<string> = new Set<string>(),
): number {
  if (seen.has(regionId) || seen.size >= MAX_SPINE_DEPTH) return 0
  const region = config.regions[regionId]
  if (!region) return 0
  seen.add(regionId)
  const own = region.sizeFraction ?? 0
  if (!region.childRegion) return own
  return own + subtreeFraction(config, region.childRegion, seen)
}

/**
 * Walk the childRegion spine from `regionId`, emitting a WorkspaceSpinePlanNode tree.
 * Does NOT special-case the center editor — that's the renderer's concern.
 * Pure: config in, plan out.
 *
 * The `seen` set (region ids already on THIS walk) + depth cap are the brake:
 * if the next hop was already visited (a cycle) or the cap is blown, the spine
 * terminates as a leaf here rather than recursing without bound. For every
 * well-formed acyclic config the brake never fires and the plan is byte-identical
 * to the pre-guard output.
 */
function walkSpine(
  config: WorkspaceConfig,
  regionId: string,
  seen: Set<string> = new Set<string>(),
): WorkspaceSpinePlanNode {
  const region = config.regions[regionId]
  if (!region || !region.childRegion || seen.has(regionId) || seen.size >= MAX_SPINE_DEPTH) {
    return { kind: 'leaf', regionId }
  }
  seen.add(regionId)
  const childId = region.childRegion

  // Position = start-region fraction / (start + all-end-descendants fractions) × 100
  const startFrac = region.sizeFraction ?? 0
  const endFrac = subtreeFraction(config, childId)
  const total = startFrac + endFrac
  const rawPosition = total > 0 ? (startFrac / total) * 100 : 50
  const position = Math.round(rawPosition * 100) / 100  // round to 2dp

  return {
    kind: 'split',
    regionId,
    position,
    child: walkSpine(config, childId, seen),
  }
}

/**
 * Resolve the root-region list for an app (WP0.0).
 *
 * Returns the app's per-app root list when `app` is given AND present in
 * `config.appRootRegions`; otherwise the default top-level `config.rootRegions`.
 * `planFor(config)` (no app) and any unknown app both resolve to
 * `config.rootRegions` — so the garden path is byte-identical (WP2.1 parity).
 *
 * Pure; no DOM, no stores.
 */
export function resolveRootRegions(config: WorkspaceConfig, app?: AppId): readonly string[] {
  if (app !== undefined && config.appRootRegions) {
    const set = config.appRootRegions[app]
    if (set) return set
  }
  return config.rootRegions
}

/**
 * The canonical default-app id — the app whose spine IS `config.rootRegions`
 * itself. GARDEN_DEFAULT deliberately carries no `appRootRegions.garden` entry
 * (the no-app/'garden' parity invariant, WP2.1) — every config nonetheless
 * "declares" this one app, by construction, since `rootRegions` always exists.
 */
export const DEFAULT_APP_ID: AppId = 'garden'

/**
 * Does `config` actually declare a surface for `app`? (Slice 10 — confess-
 * absence, `06-observatory-app-dimension-defect.md` D2.)
 *
 * This is a DIFFERENT question from what `resolveRootRegions`/`planFor` answer.
 * Those two are the tolerant engine primitives WP2.1 pins on purpose ("an
 * unknown app falls back to the default rootRegions" — `engine-multiapp.test.ts`
 * "WP2.1 safety") and this function leaves that contract untouched. It exists
 * for the ONE caller that must NOT take the fallback: a chrome that reached an
 * app value it did not itself offer (a stale `app` in shell state, a hand-typed
 * URL) needs to know BEFORE calling `planFor` whether it is about to paper over
 * an absence, so it can confess it instead.
 *
 * `undefined` (no app selected) and `DEFAULT_APP_ID` are always declared. Any
 * other app is declared only when it is a key of `config.appRootRegions`.
 */
export function isAppDeclared(config: WorkspaceConfig, app: AppId | undefined): boolean {
  if (app === undefined || app === DEFAULT_APP_ID) return true
  return config.appRootRegions?.[app] !== undefined
}

/**
 * The apps this config's chrome should offer as tabs: `DEFAULT_APP_ID` first,
 * then every other key of `config.appRootRegions` in declaration order. Every
 * config yields at least one tab — `[DEFAULT_APP_ID]` for a single-app config
 * with no `appRootRegions` at all (e.g. the Observatory's authored seed, which
 * declares zero `appRootRegions` entries — the fix for the dead choreograph
 * tab is that its chrome now offers exactly one tab, not two).
 *
 * Pure and structural — the SAME ground truth `resolveRootRegions` reads, so a
 * tab can never name an app the interpreter doesn't also know how to plan for,
 * and a real app can never be missing a tab. Ids only: labels/icons are a
 * presentation concern the render host adds (nucleus has no icon vocabulary).
 */
export function deriveAppTabs(config: WorkspaceConfig): readonly AppId[] {
  const declared = config.appRootRegions ? Object.keys(config.appRootRegions) : []
  // DEFAULT_APP_ID always leads, regardless of where (or whether) it appears
  // in `appRootRegions`'s own key order — Object.keys order reflects
  // authoring/insertion order, not the tab-order contract this function
  // promises, so a config that happens to declare its own `garden` entry
  // after another app must not leak that order into the tab list (Final
  // repair, finding 3).
  const rest = declared.filter(app => app !== DEFAULT_APP_ID)
  return [DEFAULT_APP_ID, ...rest]
}

/**
 * Pure structural projection: WorkspaceConfig → WorkspaceSpinePlan.
 *
 * This is THE acceptance-gate function. Two different configs MUST yield two
 * different plans; a GardenDefault-shaped facade would yield the same plan for
 * both and fail the divergence test.
 *
 * The optional `app` selects a per-app region-set (the 4th `app` dimension,
 * WP0.0). Omitted ⇒ the default `config.rootRegions` spine — `planFor(config)`
 * is byte-identical to `planFor(config, 'garden')` for a config whose default
 * IS the garden set.
 *
 * Algorithm:
 *   1. Resolve the app's root regions (resolveRootRegions).
 *   2. Partition them into chrome (resizable=false) and spine-heads (resizable=true).
 *   3. Identify the spine head (must be exactly one resizable root; the linear-spine invariant).
 *   4. Chrome roots with order < spineHead.order → topChrome; > → bottomChrome.
 *   5. Walk the childRegion spine from the head → spine plan node.
 */
export function planFor(config: WorkspaceConfig, app?: AppId): WorkspaceSpinePlan {
  const rootRegions = resolveRootRegions(config, app)

  // Partition rootRegions into chrome and spine-head candidates.
  let spineHeadId: string | null = null
  const chromeIds: string[] = []

  for (const id of rootRegions) {
    const region = config.regions[id]
    if (!region) continue
    if (region.resizable) {
      // The first (and by invariant, only) resizable root is the spine head.
      if (spineHeadId === null) spineHeadId = id
    } else {
      chromeIds.push(id)
    }
  }

  if (!spineHeadId) {
    // Degenerate config: no resizable root. Return a leaf of the first root.
    const fallbackId = rootRegions[0] ?? 'unknown'
    return { topChrome: [], bottomChrome: [], spine: { kind: 'leaf', regionId: fallbackId }, spineHeadId: fallbackId }
  }

  const spineHeadOrder = config.regions[spineHeadId]?.order ?? 0

  const topChrome = chromeIds
    .filter(id => (config.regions[id]?.order ?? 0) < spineHeadOrder)
    .sort((a, b) => (config.regions[a]?.order ?? 0) - (config.regions[b]?.order ?? 0))

  const bottomChrome = chromeIds
    .filter(id => (config.regions[id]?.order ?? 0) > spineHeadOrder)
    .sort((a, b) => (config.regions[a]?.order ?? 0) - (config.regions[b]?.order ?? 0))

  const spine = walkSpine(config, spineHeadId)

  return { topChrome, bottomChrome, spine, spineHeadId }
}
