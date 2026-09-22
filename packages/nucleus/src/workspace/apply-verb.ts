/**
 * apply-verb.ts — the AUTHORITATIVE catalog gate (security layer 2 of 4).
 *
 * `applyVerb(config, spec)` takes a CLOSED, discriminated `VerbSpec` and returns
 * either `{ ok: true, config }` (the rebuilt candidate) or `{ ok: false, error }`.
 * It is the ONLY place the component allowlist (KNOWN_COMPONENTS) is enforced:
 *
 *   Layer 1 — VerbSpec is a CLOSED discriminated union. The security boundary is
 *     BY SHAPE: no field carries raw N-Triples, freeform SPARQL, or a component-map
 *     mutation. The agent can only name a verb, ids, a placement, and a component
 *     TAG — never inject arbitrary RDF or rewrite the component table.
 *   Layer 2 (HERE) — every verb that introduces a component (add_panel,
 *     add_region, add_root_region) is REJECTED before any RegionConfig/PanelConfig
 *     is built when its component ∉ KNOWN_COMPONENTS. Reject pre-construction:
 *     nothing is built, nothing leaks into the candidate config.
 *   Layer 3 — `grow()` runs `validateConfig` on the candidate as the next HARD
 *     gate (spine invariants). applyVerb does NOT self-validate; it is the catalog
 *     layer, validateConfig is the spine layer, and neither subsumes the other.
 *   Layer 4 — the cell's authority gate (rdf_authority.rs) rejects reserved /
 *     :projection: / variable-GRAPH writes at load time. Pre-exists + tested.
 *
 * PURE: no DOM, no stores, no network. config + spec in, verdict out. The verbs
 * it delegates to (mutations.ts addPanel / addRegion / addRootRegion / dockPanel-
 * by-relocate / toggleBar) are themselves pure and additive-safe.
 *
 * v1 SCOPE — ADDITIVE grows only: add_panel, add_region, add_root_region,
 * dock_panel, and toggle_bar(present:false). Mutating-existing grows (resize /
 * relocate via literal-GRAPH DELETE/INSERT) are a LABELED follow-on, not in this
 * union. toggle_bar(present:true) is intentionally NOT an add verb (it is a no-op
 * for an unrooted bar — deriveRootRegions only walks childRegion from EXISTING
 * roots, so a chrome bar that is not yet a root is never picked up; use
 * add_root_region to root a bar).
 */

import type { PanelConfig, RegionConfig, WorkspaceConfig } from './types.js'
import { addPanel, addRegion, addRootRegion, toggleBar } from './mutations.js'
import { isKnownComponent } from './known-components.js'

/**
 * Where to place a region added by `add_region`:
 *   - `{ kind: 'child', parentRegionId }` — splice as that parent's child.
 *   - `{ kind: 'unrooted' }` — add present-but-unreachable (rooted later).
 */
export type RegionPlacement =
  | { readonly kind: 'child'; readonly parentRegionId: string }
  | { readonly kind: 'unrooted' }

/**
 * The CLOSED, discriminated grow verb union — the security boundary BY SHAPE.
 *
 * No member carries raw N-Triples, freeform SPARQL, or a component-table mutation.
 * The only component reference is a string TAG, which applyVerb gates against the
 * KNOWN_COMPONENTS catalog before building anything.
 */
export type VerbSpec =
  | { readonly verb: 'add_panel'; readonly panelId: string; readonly component: string; readonly label?: string }
  | {
      readonly verb: 'add_region'
      readonly regionId: string
      readonly placement: RegionPlacement
      readonly component?: string
      readonly docksPanelId?: string
      readonly label?: string
    }
  | { readonly verb: 'add_root_region'; readonly regionId: string; readonly component: string; readonly label?: string }
  | { readonly verb: 'dock_panel'; readonly regionId: string; readonly panelId: string }
  | { readonly verb: 'toggle_bar'; readonly barRegionId: string; readonly present: false }

/** The result of applying one verb: the rebuilt candidate config, or a rejection. */
export type ApplyVerbResult =
  | { readonly ok: true; readonly config: WorkspaceConfig }
  | { readonly ok: false; readonly error: string }

/** Reject any tag not in the frozen catalog. The single allowlist chokepoint. */
function gateComponent(tag: string): { ok: true } | { ok: false; error: string } {
  if (!isKnownComponent(tag)) {
    return {
      ok: false,
      error: `catalog gate: component '${tag}' is not in KNOWN_COMPONENTS — rejected before construction`,
    }
  }
  return { ok: true }
}

/**
 * Apply ONE structural verb to a config, enforcing the catalog allowlist.
 *
 * Returns the rebuilt candidate ({ ok: true }) or a rejection ({ ok: false })
 * with a human-readable reason. The switch is EXHAUSTIVE: the `default` arm
 * rejects any unknown/forged verb discriminant (defence in depth — TS already
 * forbids it at compile time, but a hostile JSON payload at the choreograph seam
 * could carry one).
 */
export function applyVerb(config: WorkspaceConfig, spec: VerbSpec): ApplyVerbResult {
  switch (spec.verb) {
    case 'add_panel': {
      const gate = gateComponent(spec.component)
      if (!gate.ok) return gate
      const panel: PanelConfig = {
        id: spec.panelId,
        label: spec.label ?? spec.panelId,
        renderedByComponent: spec.component,
        dockState: 'docked',
        defaultVisible: true,
      }
      return { ok: true, config: addPanel(config, panel) }
    }

    case 'add_region': {
      // Catalog-gate the chrome component if one is named (a content region with a
      // dockedPanel carries no component of its own — it resolves via the panel).
      if (spec.component !== undefined) {
        const gate = gateComponent(spec.component)
        if (!gate.ok) return gate
      }
      const region: RegionConfig = {
        id: spec.regionId,
        label: spec.label ?? spec.regionId,
        childRegion: null,
        order: 1,
        splitOrientation: 'vertical',
        collapsible: false,
        resizable: false,
        sizeFraction: null,
        dockState: null,
        docksPanel: spec.docksPanelId ? [spec.docksPanelId] : [],
        renderedByComponent: spec.component ?? null,
      }
      const parentRegionId =
        spec.placement.kind === 'child' ? spec.placement.parentRegionId : undefined
      return { ok: true, config: addRegion(config, region, parentRegionId) }
    }

    case 'add_root_region': {
      const gate = gateComponent(spec.component)
      if (!gate.ok) return gate
      const existing = config.regions[spec.regionId]
      if (existing) {
        // ROOT-THE-EXISTING shape (the W0 grow): the region is already in the map
        // (e.g. the seed's present-but-unrooted region-top-bar). We must NOT rebuild
        // its body — doing so would OVERWRITE its existing triples (sizeFraction,
        // order, …) and break additivity (the grow delta would have to delete the
        // seed's region body). So we root the EXISTING region UNCHANGED.
        //
        // But the existing region MUST be non-resizable chrome (I1: exactly one
        // resizable root). A resizable existing region cannot be rooted as a 2nd
        // spine head — reject here so the catalog/shape layer catches it (the spine
        // gate would also catch it, but rejecting pre-write keeps the gate honest).
        if (existing.resizable) {
          return {
            ok: false,
            error: `add_root_region: region '${spec.regionId}' is resizable — cannot root a 2nd resizable spine head (I1)`,
          }
        }
        return { ok: true, config: addRootRegion(config, existing) }
      }
      // NEW region: build a NON-RESIZABLE chrome root (I1: the existing seed head
      // stays the sole resizable root; this new one is chrome). sizeFraction null —
      // chrome roots are CSS-sized, not part of the split tree, and validateConfig's
      // I6 walk does not gate chrome roots.
      const region: RegionConfig = {
        id: spec.regionId,
        label: spec.label ?? spec.regionId,
        childRegion: null,
        order: 0,
        splitOrientation: 'horizontal',
        collapsible: false,
        resizable: false,
        sizeFraction: null,
        dockState: null,
        docksPanel: [],
        renderedByComponent: spec.component,
      }
      return { ok: true, config: addRootRegion(config, region) }
    }

    case 'dock_panel': {
      // No new component → no catalog check. Append panelId to the region's
      // docksPanel (the panel + its component were vetted by an earlier add_panel).
      const region = config.regions[spec.regionId]
      if (!region) {
        return { ok: false, error: `dock_panel: region '${spec.regionId}' does not exist` }
      }
      if (!config.panels[spec.panelId]) {
        return { ok: false, error: `dock_panel: panel '${spec.panelId}' does not exist` }
      }
      if (region.docksPanel.includes(spec.panelId)) {
        return { ok: true, config } // idempotent: already docked
      }
      const regions = {
        ...config.regions,
        [spec.regionId]: {
          ...region,
          docksPanel: [...region.docksPanel, spec.panelId],
        },
      }
      return { ok: true, config: { ...config, regions } }
    }

    case 'toggle_bar': {
      // present:false only (the union forbids true) — remove shared chrome.
      return { ok: true, config: toggleBar(config, spec.barRegionId, false) }
    }

    default: {
      // Exhaustiveness guard + defence against a forged discriminant.
      const forged = spec as { verb?: unknown }
      return { ok: false, error: `unknown verb: ${JSON.stringify(forged.verb)}` }
    }
  }
}
