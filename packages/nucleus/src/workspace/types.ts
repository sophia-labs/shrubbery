/**
 * WorkspaceConfig type family — a TS mirror of the sux: ontology rendering subset.
 *
 * These types describe what the workspace rendering engine needs to lay out and
 * render panels. They are plain data (no methods), deep-freezable, and designed
 * to be the identical runtime form whether produced by the build-time generator
 * or a future live Y.js/agent write.
 *
 * IDs use the bare local name with the sux: prefix stripped:
 *   'region-right-rail', 'panel-chat', 'dim-skin', etc.
 *
 * Increment 1 consumes: panels[id].renderedByComponent (right-rail lookup only).
 * All other fields are modelled for contract stability — widening to the center,
 * left, split-tree, and live-agent paths without reshaping the type.
 */

export type DockState = 'docked' | 'stacked'
export type SplitOrientation = 'horizontal' | 'vertical'

/**
 * An app id — a value of the 4th `app` config dimension (WP0.0). Selects which
 * per-app region-set the interpreter walks (e.g. 'garden', 'choreograph').
 * Bare local name, sux: prefix stripped — same convention as region/panel ids.
 */
export type AppId = string

/**
 * A right-rail panel id — the panels the interpreter routes through the
 * right-rail island (resolvePanelTag → PANEL_ID_TO_SUX).
 *
 * Extracted into the nucleus (shrubbery) from garden's `src/types/session.ts`:
 * this was the SOLE outward edge from the workspace engine into the rest of
 * garden's `src/`. Cutting it here is what makes the nucleus a pure island.
 *
 * `'none'` is not a PanelId. The Garden shell's scalar mode uses
 * `RightPanelMode = PanelId | 'none'`; `right-panel-grammar.ts` owns that
 * interaction contract.
 */
export type PanelId = 'chat' | 'comments' | 'wires' | 'inspector' | 'graph'

/**
 * A docked panel as the interpreter needs it to render.
 * Mirrors sux:Panel (rendering subset).
 */
export interface PanelConfig {
  /** Local id, sux: prefix stripped — e.g. 'panel-chat'. */
  readonly id: string
  /** sux:rdfs:label — human label (chrome/aria; not load-bearing for the body). */
  readonly label: string
  /** sux:renderedByComponent — the custom-element tag, e.g. 'mn-chat-panel'. */
  readonly renderedByComponent: string
  /** sux:dockState — 'docked' | 'stacked'. */
  readonly dockState: DockState
  /** sux:defaultVisible. */
  readonly defaultVisible: boolean
}

/**
 * The semantic job a region performs in the rendered workspace Surface.
 *
 * This is graph-authored presentation metadata, not an authorization role.
 * It lets downstream apps place a trusted, app-owned component in the main
 * workspace without teaching the generic runtime that component's tag name.
 */
export type SurfaceRegionRole = 'center' | 'sidebar' | 'right' | 'other'

/**
 * Who chooses the content shown inside a semantic Surface region.
 *
 * `routed` leaves the region to the shell's navigation state (home, document,
 * tag lens, and other route faces). `configured` makes the component declared
 * by the graph the region's content authority. The property is optional so
 * every pre-existing WorkspaceConfig keeps its legacy routing behavior.
 */
export type SurfaceRegionMode = 'routed' | 'configured'

/**
 * A region (node in the layout tree).
 * Mirrors sux:Region (rendering subset).
 */
export interface RegionConfig {
  /** Local id — e.g. 'region-right-rail'. */
  readonly id: string
  readonly label: string
  /**
   * sux:childRegion — AUTHORITATIVE single nesting edge (linear spine in
   * GardenDefault). null when the region has no child (leaf of the spine or
   * chrome region with no child).
   */
  readonly childRegion: string | null
  /** sux:order — SECONDARY sort key only; never authoritative for nesting. */
  readonly order: number
  readonly splitOrientation: SplitOrientation
  readonly collapsible: boolean
  readonly resizable: boolean
  /** sux:sizeFraction — split position hint (consumed by increment 2 for split position). */
  readonly sizeFraction: number | null
  /** sux:dockState on the region (right-rail = 'stacked'); null when unset. */
  readonly dockState: DockState | null
  /** sux:docksPanel — panel ids docked here, id-sorted for determinism. */
  readonly docksPanel: readonly string[]
  /**
   * sux:renderedByComponent — the custom-element tag for chrome regions
   * (e.g. 'mn-top-bar', 'mn-bottom-bar'). null for content regions whose
   * content tag is resolved via docksPanel → panel.renderedByComponent.
   * Added in increment 2 to allow the interpreter to stamp chrome surfaces
   * from config.
   */
  readonly renderedByComponent: string | null
  /**
   * sux:surfaceRole — OPTIONAL semantic Surface role. When absent, the runtime
   * preserves the legacy component/dock-state inference for old graphs.
   */
  readonly surfaceRole?: SurfaceRegionRole | null
  /**
   * sux:surfaceMode — OPTIONAL content-selection policy. `configured` prevents
   * shell route state from replacing the graph-authored component; absent (or
   * `routed`) preserves the legacy host-navigation slot.
   */
  readonly surfaceMode?: SurfaceRegionMode | null
  /**
   * sux:fragmentSurface — OPTIONAL surface IRI for a region whose subtree is
   * a graph-authored layout fragment (marker: `renderedByComponent` =
   * 'sh-layout-dashboard'): the SUBJECT whose `ux:layoutJson` literal (in the
   * graph's `:ux:config` slot) authors this region's subtree. Absent means
   * the shell applies its default surface IRI — back-compat with the deployed
   * observatory seed, which predates this predicate. Stored VERBATIM (an
   * absolute IRI, never localId-shortened); serialized as an IRI object.
   */
  readonly fragmentSurface?: string | null
}

/**
 * A single allowed value for a ConfigDimension.
 * Mirrors sux:ConfigValue (rendering subset).
 */
export interface ConfigDimensionValue {
  /** Local id — e.g. 'val-skin-garden'. */
  readonly id: string
  /** sux:literalValue — e.g. 'garden'. */
  readonly literalValue: string
  /**
   * sux:appliesAttribute — the CSS/DOM hook, VERBATIM from the graph.
   * DOCUMENTATION ONLY in increment 1 — never applied by the interpreter.
   * e.g. '[data-skin=emporium]', '[data-skin=98]', or the Garden
   * '[data-skin] absent (removeAttribute)' convention.
   * The stores (session-store, theme-store) remain the SOLE appliers.
   */
  readonly appliesAttribute: string
}

/**
 * A configuration dimension (skin / posture / theme).
 * Mirrors sux:ConfigDimension + its allowed values.
 */
export interface ConfigDimension {
  /** Local id — e.g. 'dim-skin'. */
  readonly id: string
  readonly label: string
  /** sux:defaultValue resolved to that value's literalValue, e.g. 'garden'. */
  readonly defaultValue: string
  /**
   * Allowed values, deterministically ordered:
   * ordinalIndex asc (posture), then literalValue asc (skin/theme fallback).
   */
  readonly values: readonly ConfigDimensionValue[]
}

/**
 * A directed, typed edge between two face IDs — the `:ux:config` form of a
 * cross-pane selection coupling (comments→inspector, graph→editor, …). `from`
 * and `to` are bare face ids in the `face:<id>` id-space (the sux: prefix is
 * stripped on parse); `predicate` is a plain literal the edge-interpreter
 * switches on at runtime (`drivesSelection` | `reveals` | …), so adding or
 * retargeting a coupling is one triple, no ontology lookup. Mirrors
 * sux:ConfigEdge.
 */
export interface ConfigEdge {
  /** Source face id — e.g. 'face:comments'. */
  readonly from: string
  /** Target face id — e.g. 'face:inspector'. */
  readonly to: string
  /** Runtime predicate literal — 'drivesSelection' | 'reveals' | …. */
  readonly predicate: string
}

/**
 * Top-level workspace config.
 * Mirrors sux:Workspace (rendering subset).
 */
export interface WorkspaceConfig {
  /** Local id — 'GardenDefault'. */
  readonly id: string
  readonly label: string
  /** sux:renderedByComponent — 'app-shell'. */
  readonly renderedByComponent: string
  /**
   * All regions, keyed by id (lookup table).
   * Nesting is expressed via RegionConfig.childRegion, NOT by map nesting.
   */
  readonly regions: Readonly<Record<string, RegionConfig>>
  /** All panels, keyed by id. */
  readonly panels: Readonly<Record<string, PanelConfig>>
  /** The 3 config dimensions, keyed by id. */
  readonly dimensions: Readonly<Record<string, ConfigDimension>>
  /**
   * Root region ids: regions that appear in no other region's childRegion.
   * Sorted by order asc, then id asc (order is secondary sort only).
   *
   * This is the DEFAULT (single-app / garden) spine. When `appRootRegions` is
   * present, this equals appRootRegions[defaultApp].
   */
  readonly rootRegions: readonly string[]
  /**
   * Per-app root-region selectors — the structural support for the 4th `app`
   * dimension (WP0.0). The `regions` map above is the SHARED lookup table for
   * ALL apps: shell-chrome regions (top-bar, bottom-bar) are reused across apps,
   * and each app's content regions live alongside them. An app's spine is the
   * set reachable by walking childRegion from its own root list.
   *
   * ABSENT ⇒ single-app config: only the top-level `rootRegions` spine exists
   * (this is GARDEN_DEFAULT today, and `planFor(config)` is byte-identical to
   * `planFor(config, 'garden')`). When the `app` dimension selects an app present
   * here, `planFor(config, app)` walks `appRootRegions[app]`; an unknown app
   * falls back to `rootRegions`.
   *
   * INVARIANT (validateConfig): EACH region-set — `rootRegions` and every
   * `appRootRegions[*]` — independently satisfies I1 (exactly one resizable
   * root) and I6 (spine sizeFraction in (0,1)). The global invariants I2
   * (acyclic), I3 (no dangling refs) and I5 (component-resolvable) hold over the
   * shared `regions` map once.
   */
  readonly appRootRegions?: Readonly<Record<AppId, readonly string[]>>
  /**
   * Directed selection-hub edges between face IDs (semantic edge overlay,
   * slice 1). The edge-interpreter reads these to install cross-pane behavior
   * (a triple installs a coupling); `mn-relations` projects the same list into
   * the visible overlay. ABSENT ⇒ no lifted couplings (all glue stays
   * imperative). Ordered — serialized as indexed sux:ConfigEdge nodes.
   */
  readonly edges?: readonly ConfigEdge[]
}
