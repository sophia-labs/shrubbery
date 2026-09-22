/**
 * GARDEN_DEFAULT — the CANONICAL WorkspaceConfig source (hand-maintained).
 *
 * Post-D1 there is NO global `sophia-ux` graph: workspace config lives per-cell,
 * and THIS frozen TS literal is the single source of truth. The old "regenerate
 * this file FROM the sophia-ux graph" lineage is obsolete — do NOT regenerate
 * this literal from a graph.
 *
 * The build-time literal and the SERVER SEED are the same data in two encodings.
 * `scripts/generate-garden-default.mjs` runs the OPPOSITE direction of the old
 * generator: it emits the deterministic N-Triples SEED BODY *from* GARDEN_DEFAULT
 * (via the WP0.1 contract serializeConfigToTriples → triplesToNT) into the
 * committed artifact `src/workspace/__generated__/garden-default.ux.nt` — the body
 * the gateway seed / WP5.1 / the Rust `ux_seed.rs` insert into a cell's
 * `:ux:config` graph. That generator also asserts the round-trip
 * (serialize → parse → deepEqual GARDEN_DEFAULT), so the literal and the seed are
 * provably ONE source. Edit GARDEN_DEFAULT, then `pnpm generate:ux-seed`.
 *
 * Field conventions (kept stable so the serialized seed is byte-deterministic):
 *   - sux: prefix stripped from all ids
 *   - childRegion is AUTHORITATIVE for nesting (order is secondary sort only)
 *   - docksPanel arrays are id-sorted (deterministic)
 *   - dimension values ordered ordinalIndex asc, then literalValue asc
 *   - rootRegions are explicit (NOT derived); order asc then id asc
 *   - all keys in fixed alphabetical field order
 *   - deep-frozen at module level
 *
 * Region order values:
 *   region-top-bar=0, region-left-rail=1, region-center=2,
 *   region-right-rail=3, region-bottom-bar=4  (clean, no duplicates)
 */

import type { WorkspaceConfig } from './types.js'

// ---------------------------------------------------------------------------
// deepFreeze helper — recursively Object.freeze an object graph.
// No Object.freeze precedent in src/ yet; ships here as a private util.
// ---------------------------------------------------------------------------
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj as object)) {
    const val = (obj as Record<string, unknown>)[key]
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val)
    }
  }
  return obj
}

// ---------------------------------------------------------------------------
// GardenDefault — the frozen WorkspaceConfig literal.
// ---------------------------------------------------------------------------
export const GARDEN_DEFAULT: WorkspaceConfig = deepFreeze({
  id: 'GardenDefault',
  label: 'Garden Default Workspace',
  renderedByComponent: 'app-shell',

  // ── Regions ──────────────────────────────────────────────────────────────
  // childRegion spine (authoritative for nesting):
  //   region-left-rail → region-center → region-right-rail
  // region-top-bar and region-bottom-bar are chrome (no childRegion edge).
  // rootRegions = [region-top-bar, region-left-rail, region-bottom-bar]
  //   (top-bar=0, left-rail=1, bottom-bar=4 by order; center + right-rail
  //    are children in the spine and thus NOT roots)
  regions: {
    'region-bottom-bar': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-bottom-bar',
      label: 'Bottom Bar (Status Bar)',
      order: 4,
      renderedByComponent: 'mn-bottom-bar',
      resizable: false,
      sizeFraction: 0.03,
      splitOrientation: 'horizontal',
    },
    'region-center': {
      childRegion: 'region-right-rail',
      collapsible: false,
      dockState: null,
      docksPanel: ['panel-editor'],
      id: 'region-center',
      label: 'Center (Editor / Home)',
      order: 2,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.6,
      splitOrientation: 'vertical',
    },
    // region-choreo-center — the Choreograph (Studio) app's spine head. It lives
    // in the SHARED regions map alongside garden's content regions; only the
    // choreograph region-set (appRootRegions.choreograph) walks it. It is the
    // single resizable root of that set (I1), childRegion null (full-panel leaf
    // spine), order 2 so it sits BETWEEN the shared top-bar (0) and bottom-bar (4)
    // chrome → topChrome=[top-bar], bottomChrome=[bottom-bar] in planFor. Its
    // sizeFraction is in (0,1) to satisfy I6 for the choreograph spine.
    // renderedByComponent 'wf-studio-shell' is the screen-router (P0) the engine
    // stamps for this region; the garden default spine never references it.
    'region-choreo-center': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-choreo-center',
      label: 'Choreograph Center (Studio)',
      order: 2,
      renderedByComponent: 'wf-studio-shell',
      resizable: true,
      sizeFraction: 0.8,
      splitOrientation: 'vertical',
    },
    'region-left-rail': {
      childRegion: 'region-center',
      collapsible: true,
      dockState: null,
      docksPanel: ['panel-sidebar'],
      id: 'region-left-rail',
      label: 'Left Rail (Sidebar)',
      order: 1,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.2,
      splitOrientation: 'vertical',
    },
    'region-right-rail': {
      childRegion: null,
      collapsible: true,
      dockState: 'stacked',
      docksPanel: [
        'panel-chat',
        'panel-comments',
        'panel-graph',
        'panel-inspector',
        'panel-wires',
      ],
      id: 'region-right-rail',
      label: 'Right Rail (Composable Panel Stack)',
      order: 3,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.2,
      splitOrientation: 'vertical',
    },
    'region-top-bar': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-top-bar',
      label: 'Top Bar',
      order: 0,
      renderedByComponent: 'mn-top-bar',
      resizable: false,
      sizeFraction: 0.04,
      splitOrientation: 'horizontal',
    },
  },

  // ── Panels ───────────────────────────────────────────────────────────────
  // All 7 panels from the graph, keyed by local id.
  panels: {
    'panel-chat': {
      defaultVisible: true,
      dockState: 'stacked',
      id: 'panel-chat',
      label: 'Chat Panel',
      renderedByComponent: 'mn-chat-panel',
    },
    'panel-comments': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-comments',
      label: 'Comments Panel',
      renderedByComponent: 'mn-comments-panel',
    },
    'panel-editor': {
      defaultVisible: true,
      dockState: 'docked',
      id: 'panel-editor',
      label: 'Document Editor Panel',
      renderedByComponent: 'mn-document-editor',
    },
    'panel-graph': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-graph',
      label: 'Graph Panel',
      renderedByComponent: 'mn-graph-panel',
    },
    'panel-inspector': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-inspector',
      label: 'Inspector Panel',
      renderedByComponent: 'mn-inspector',
    },
    'panel-sidebar': {
      defaultVisible: true,
      dockState: 'docked',
      id: 'panel-sidebar',
      label: 'Sidebar Panel',
      renderedByComponent: 'mn-sidebar-panel',
    },
    'panel-wires': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-wires',
      label: 'Wires Panel',
      renderedByComponent: 'mn-wires-panel',
    },
  },

  // ── Config Dimensions ────────────────────────────────────────────────────
  // 4 dimensions: dim-app (structural), dim-posture (ordinal), dim-skin (enum),
  // dim-theme (enum). appliesAttribute is VERBATIM from the graph for the three
  // STYLE dimensions — DOCUMENTATION ONLY; the stores (session-store,
  // theme-store) are the SOLE appliers at runtime. This config layer is a no-op
  // for those three (no setAttribute sites).
  //
  // dim-app is DIFFERENT: it is STRUCTURAL, not a DOM/CSS hook. Its value is the
  // active app (from the session address {app}, P1) and is read by planFor to
  // select the per-app region-set (appRootRegions[app]). It is NEVER stamped as
  // an attribute. Its appliesAttribute string documents this so no future code
  // mistakes it for a [data-app=…] hook. defaultValue 'garden' ⇒ planFor falls
  // back to rootRegions (GARDEN_DEFAULT carries no appRootRegions) ⇒ the plan is
  // byte-identical to the no-app path (WP2.1 parity).
  dimensions: {
    'dim-app': {
      defaultValue: 'garden',
      id: 'dim-app',
      label: 'App',
      // STRUCTURAL — read by planFor (selects the region-set), NOT a setAttribute.
      // 'choreograph' now has its own appRootRegions set (P0): planFor(config,
      // 'choreograph') walks region-choreo-center. 'garden' has NO appRootRegions
      // entry on purpose, so it falls back to rootRegions (the no-app invariant).
      values: [
        {
          appliesAttribute: 'structural — selects region-set via planFor (NOT a setAttribute)',
          id: 'val-app-garden',
          literalValue: 'garden',
        },
        {
          appliesAttribute: 'structural — selects choreograph region-set via planFor (appRootRegions.choreograph → region-choreo-center)',
          id: 'val-app-choreograph',
          literalValue: 'choreograph',
        },
      ],
    },
    'dim-posture': {
      defaultValue: 'manuscript',
      id: 'dim-posture',
      label: 'Posture',
      // sorted by ordinalIndex asc: manuscript=0, comfortable=1, application=2
      values: [
        {
          appliesAttribute: '[data-posture=manuscript]',
          id: 'val-posture-manuscript',
          literalValue: 'manuscript',
        },
        {
          appliesAttribute: '[data-posture=comfortable]',
          id: 'val-posture-comfortable',
          literalValue: 'comfortable',
        },
        {
          appliesAttribute: '[data-posture=application]',
          id: 'val-posture-application',
          literalValue: 'application',
        },
      ],
    },
    'dim-skin': {
      defaultValue: 'garden',
      id: 'dim-skin',
      label: 'Skin',
      // enum (no ordinalIndex) — global visual identities
      values: [
        {
          appliesAttribute: '[data-skin] absent (removeAttribute)',
          id: 'val-skin-garden',
          literalValue: 'garden',
        },
        {
          appliesAttribute: '[data-skin=emporium]',
          id: 'val-skin-emporium',
          literalValue: 'emporium',
        },
        {
          appliesAttribute: '[data-skin=98]',
          id: 'val-skin-98',
          literalValue: '98',
        },
        {
          appliesAttribute: '[data-skin=glass]',
          id: 'val-skin-glass',
          literalValue: 'glass',
        },
      ],
    },
    'dim-theme': {
      defaultValue: 'system',
      id: 'dim-theme',
      label: 'Theme',
      // enum (no ordinalIndex) — sorted literalValue asc: dark, light, system
      values: [
        {
          appliesAttribute: '[data-theme=dark]',
          id: 'val-theme-dark',
          literalValue: 'dark',
        },
        {
          appliesAttribute: '[data-theme=light]',
          id: 'val-theme-light',
          literalValue: 'light',
        },
        {
          appliesAttribute: 'resolved at runtime via prefers-color-scheme',
          id: 'val-theme-system',
          literalValue: 'system',
        },
      ],
    },
  },

  // ── Root Regions ─────────────────────────────────────────────────────────
  // The DEFAULT (single-app / garden) spine. Regions not referenced as any
  // childRegion target on the garden spine:
  //   region-top-bar (order=0), region-left-rail (order=1), region-bottom-bar (order=4)
  // region-center and region-right-rail are children in the spine → NOT roots.
  // region-choreo-center is NOT a garden root (it belongs to the choreograph
  // region-set below) — it is shared in the regions map but off the default spine.
  rootRegions: ['region-top-bar', 'region-left-rail', 'region-bottom-bar'],

  // ── Per-App Root Regions (WP0.0) ───────────────────────────────────────────
  // Each app's spine is the set reachable by walking childRegion from its own
  // root list over the SHARED regions map. ONLY the non-garden apps are listed
  // here: 'garden' is INTENTIONALLY absent so the no-app / default-app path stays
  // byte-identical to `rootRegions` (resolveRootRegions falls back to it), which
  // is the engine-multiapp no-app invariant — planFor(config) === planFor(config,
  // 'garden') === planFor(GARDEN_DEFAULT). The choreograph set reuses the shared
  // top-bar + bottom-bar chrome and inserts region-choreo-center (the single
  // resizable spine head, I1) between them. validateConfig checks I1 + I6 on this
  // set independently of the default set.
  appRootRegions: {
    choreograph: ['region-top-bar', 'region-choreo-center', 'region-bottom-bar'],
  },

  // ── Selection-hub edges (semantic edge overlay, slices 1 + 2) ──────────────
  // The cross-pane couplings, lifted from imperative glue in
  // apps/organism/src/main.ts into typed, directed triples the edge-interpreter
  // reads to install behavior (and mn-relations renders as a diagram). from/to
  // are face ids in the `face:<id>` id-space (DISTINCT from panel ids); predicate
  // is the plain literal the interpreter switches on:
  //   - comments →drivesSelection→ inspector: a comment pick publishes a
  //     SelectedObject the inspector reflects (replaces handleCommentSelect's
  //     `currentInspectorSelection = {kind:'comment'}` stamp).
  //   - graph →reveals→ editor: a graph node pick imperatively focuses its block
  //     (replaces handleGraphPanelNodeSelect → focusGraphBlock).
  //   - comments →reveals→ editor: a comment pick scrolls the editor to it
  //     (replaces handleCommentSelect → setActiveComment(id,{scroll:true})).
  // Slice 2 adds three Tier-B couplings — navigatesTo is a THIRD, bus-bypassing
  // behavior (like reveals) that reads the source's OPEN event (distinct from
  // select) and SWAPS the target's active surface:
  //   - graph →navigatesTo→ editor: a graph node-OPEN (mn-graph-panel-node-open,
  //     distinct from node-select above) opens the doc as the active surface
  //     (replaces handleGraphPanelNodeOpen → openDocumentFromShell). Same source
  //     face as the reveals edge — one face, two predicates off two events.
  //   - sidebar →navigatesTo→ editor: a sidebar doc-OPEN opens the doc (replaces
  //     handleSidebarNodeOpen's document branch → openCellDocument).
  //   - sidebar →drivesSelection→ inspector: a sidebar FOLDER-open publishes a
  //     SelectedFolder the inspector reflects (replaces the folder branch's
  //     `currentInspectorSelection = {kind:'folder'}` stamp). Same source face as
  //     the navigatesTo edge — one face, two predicates off two open branches.
  // Order is authoritative (serialized as indexed sux:ConfigEdge nodes); edges
  // sharing a source face stay distinct (kept apart by atIndex).
  edges: [
    { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
    { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
    { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
    { from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' },
    { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
    { from: 'face:sidebar', to: 'face:inspector', predicate: 'drivesSelection' },
  ],
})
