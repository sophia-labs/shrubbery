/**
 * mutations.ts — the pure, typed verbs that reshape a live WorkspaceConfig.
 *
 * Each verb is `(config, ...args) => WorkspaceConfig`: an immutable spread that
 * returns a NEW deep-frozen config. The input is never mutated (it is itself
 * frozen — these verbs operate on the projected liveConfig). The output is the
 * candidate config that session-store.setWorkspaceConfig runs through
 * validateConfig before committing to Y.js.
 *
 * The verbs are STRUCTURAL only — they never touch panel→component tables,
 * dimensions, or transient tab state. The agent reshapes WHICH region sits
 * WHERE and HOW BIG; it never rewrites the fixed code-level component maps.
 *
 * Pure: no DOM, no stores, no Y.js. config in, frozen config out.
 *
 * Verbs:
 *   resize(config, regionId, fraction)        — set a region's sizeFraction.
 *   toggleBar(config, barRegionId, present)   — add/remove a chrome root region.
 *   relocateRegion(config, regionId, newParentRegionId)
 *                                             — rewrite the childRegion spine so
 *                                               regionId becomes newParent's child.
 *   addPanel(config, panel)                   — pure append to panels{}.
 *   addRegion(config, region, parentRegionId?)— add to regions{}; splice as a
 *                                               child when a parent is given.
 *   addRootRegion(config, region)             — APPEND-ORDER root: push region.id
 *                                               at the END of rootRegions (never
 *                                               re-derive/order-sort — that would
 *                                               reorder positional RootEntry
 *                                               indices and clobber the seed root).
 *
 * THE ADD VERBS ARE ADDITIVE-SAFE BY CONSTRUCTION. The critical one is
 * addRootRegion: RootEntry IRIs are POSITIONAL ({id}-root-{idx}, ux-rdf.ts), so
 * appending at the END leaves every existing index's triples byte-identical — the
 * grow delta is then a pure strict-superset append and growDeltaNT never throws.
 * Order-sorting a new lower-`order` root would REORDER indices = overwrite the
 * seed's root-0 → the additive guard throws. So addRootRegion NEVER calls
 * deriveRootRegions.
 */

import type { PanelConfig, RegionConfig, WorkspaceConfig } from './types.js'
import { deepFreeze } from './deep-freeze.js'

/**
 * Re-derive THE DEFAULT rootRegions from the region map, scoped to the regions
 * that belong to the current default spine.
 *
 * A root is a region in scope that is referenced as NO in-scope region's
 * childRegion target. Sorted by order asc, then id asc (order is the secondary
 * sort key; matches the generator's rule).
 *
 * SCOPING (WP0.0): the `regions` map is SHARED across all apps — once a non-garden
 * app contributes a region outside the default spine (e.g. `region-choreo-center`,
 * which is no app's childRegion target), the naive "any region with no parent is a
 * root" derivation would wrongly splice that foreign head into the DEFAULT
 * rootRegions and break I1 (two resizable roots). These verbs reshape ONLY the
 * default spine, so the candidate set is the existing default `scope`: the prior
 * `rootRegions` plus everything reachable by walking childRegion from them. Foreign
 * app heads stay out of scope and are left untouched in `appRootRegions`.
 */
function deriveRootRegions(
  regions: Record<string, RegionConfig>,
  priorRoots: readonly string[],
): string[] {
  // Build the in-scope set: prior roots + their childRegion-spine descendants
  // (restricted to regions still present after the mutation).
  const scope = new Set<string>()
  for (const root of priorRoots) {
    let cursor: string | null = root
    while (cursor !== null && regions[cursor] && !scope.has(cursor)) {
      scope.add(cursor)
      cursor = regions[cursor].childRegion
    }
  }
  const referenced = new Set<string>()
  for (const id of scope) {
    const child = regions[id].childRegion
    if (child !== null && scope.has(child)) referenced.add(child)
  }
  return [...scope]
    .filter((id) => !referenced.has(id))
    .sort((a, b) => {
      const oa = regions[a].order
      const ob = regions[b].order
      if (oa !== ob) return oa - ob
      return a < b ? -1 : a > b ? 1 : 0
    })
}

/**
 * resize — set `regionId`'s sizeFraction to `fraction`.
 *
 * Pure spread; does NOT clamp or validate the fraction (validateConfig's I6 is
 * the gate). No-op-shaped (returns a fresh frozen config) when regionId is
 * absent — the missing region simply isn't rewritten.
 */
export function resize(
  config: WorkspaceConfig,
  regionId: string,
  fraction: number,
): WorkspaceConfig {
  const existing = config.regions[regionId]
  const regions: Record<string, RegionConfig> = { ...config.regions }
  if (existing) {
    regions[regionId] = { ...existing, sizeFraction: fraction }
  }
  return deepFreeze({
    ...config,
    regions,
  })
}

/**
 * toggleBar — add (`present=true`) or remove (`present=false`) a chrome region
 * from the root set.
 *
 * A "bar" is a chrome region (top-bar / bottom-bar): it lives in rootRegions and
 * has no childRegion edge (it is not part of the resizable spine). This verb
 * flips its membership and re-derives rootRegions from the resulting region map.
 *
 *   present=false — splice the bar out: remove its region entry entirely.
 *     (A chrome bar has childRegion=null, so removing it cannot orphan a spine.)
 *   present=true  — the bar must already exist in config.regions to be (re)added.
 *     If it exists it is included in the re-derived rootRegions; if it does not,
 *     this is a no-op-shaped fresh config (nothing to add from thin air).
 *
 * rootRegions is always re-derived from the region map (never hand-spliced).
 *
 * WP0.0: bars are SHARED chrome reused across app region-sets. Removing a bar's
 * region entry therefore also prunes it from EVERY `appRootRegions[*]` set, so no
 * app set is left with an I3 dangling root reference to the now-deleted region.
 */
export function toggleBar(
  config: WorkspaceConfig,
  barRegionId: string,
  present: boolean,
): WorkspaceConfig {
  const regions: Record<string, RegionConfig> = { ...config.regions }

  if (!present) {
    // Remove the bar region entirely. Any region that pointed AT it as a child
    // would have been a spine edge — but a chrome bar is never a childRegion
    // target, so no rewrite of sibling edges is needed.
    delete regions[barRegionId]
  }
  // present=true is a no-op on the region map: the bar (if it exists) is already
  // in `regions` and will be picked up by deriveRootRegions. If it doesn't exist
  // we have nothing to materialize.

  // Keep per-app sets consistent: a removed shared bar must leave every app set.
  // (present=true never deletes a region, so the sets are untouched in that arm.)
  const appRootRegions = !present
    ? pruneRegionFromAppSets(config.appRootRegions, barRegionId)
    : config.appRootRegions

  return deepFreeze({
    ...config,
    regions,
    rootRegions: deriveRootRegions(regions, config.rootRegions),
    ...(appRootRegions ? { appRootRegions } : {}),
  })
}

/**
 * Remove `regionId` from every per-app root list, dropping any set that becomes
 * empty and the whole `appRootRegions` key if nothing remains. Returns undefined
 * when there were no app sets to begin with (so the caller omits the key).
 */
function pruneRegionFromAppSets(
  appRootRegions: WorkspaceConfig['appRootRegions'],
  regionId: string,
): WorkspaceConfig['appRootRegions'] {
  if (!appRootRegions) return undefined
  const next: Record<string, readonly string[]> = {}
  for (const app of Object.keys(appRootRegions)) {
    const pruned = appRootRegions[app].filter((id) => id !== regionId)
    if (pruned.length > 0) next[app] = pruned
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * relocateRegion — make `regionId` the child of `newParentRegionId`, rewriting
 * the linear childRegion spine so it stays connected and acyclic.
 *
 * Edge surgery (three rewrites):
 *   1. SPLICE OUT of old position: the region that currently points at regionId
 *      (its old parent) is rewired to point at regionId's former child — so the
 *      old chain closes over the gap.
 *   2. ADOPT new child: regionId's new childRegion becomes newParent's former
 *      child (regionId is inserted directly under newParent).
 *   3. NEW parent edge: newParent.childRegion becomes regionId.
 *
 * rootRegions is re-derived from the rewritten region map.
 *
 * Defensive no-ops (return a fresh frozen config unchanged-in-shape):
 *   - regionId or newParentRegionId absent.
 *   - regionId === newParentRegionId (cannot parent to self).
 *   - newParent is ALREADY regionId's parent (newParent.childRegion === regionId)
 *     — the region is already where it would be moved; nothing to do.
 *
 * NOTE: relocating regionId under its OWN current child (newParent ===
 * regionId.childRegion) is a LEGITIMATE swap, NOT a no-op — the splice logic
 * + the `newParentFormerChild === regionId` special case below handle it
 * acyclically (it is the spine-reorder the divergence fixture exercises).
 */
export function relocateRegion(
  config: WorkspaceConfig,
  regionId: string,
  newParentRegionId: string,
): WorkspaceConfig {
  const region = config.regions[regionId]
  const newParent = config.regions[newParentRegionId]

  // Defensive guards — return a structurally-fresh frozen clone unchanged.
  if (
    !region ||
    !newParent ||
    regionId === newParentRegionId ||
    newParent.childRegion === regionId
  ) {
    return deepFreeze({ ...config, regions: { ...config.regions } })
  }

  const regions: Record<string, RegionConfig> = {}
  for (const id of Object.keys(config.regions)) {
    regions[id] = { ...config.regions[id] }
  }

  const regionFormerChild = region.childRegion
  const newParentFormerChild = newParent.childRegion

  // 1. SPLICE OUT: rewire regionId's OLD parent (if any) to skip over regionId.
  //    The old parent is the region whose childRegion === regionId.
  for (const id of Object.keys(regions)) {
    if (id === regionId) continue
    if (regions[id].childRegion === regionId) {
      regions[id] = { ...regions[id], childRegion: regionFormerChild }
    }
  }

  // 2 + 3. Insert regionId directly under newParent.
  //    Re-read after splice in case newParent WAS regionId's old parent (then
  //    its childRegion was just set to regionFormerChild above; we overwrite it
  //    to regionId here, and regionId adopts that former child below).
  const newParentAfterSplice = regions[newParentRegionId]
  regions[newParentRegionId] = {
    ...newParentAfterSplice,
    childRegion: regionId,
  }
  regions[regionId] = {
    ...regions[regionId],
    // regionId adopts newParent's former child. Special case: if newParent was
    // regionId's OLD parent, newParentFormerChild === regionId — adopting that
    // would self-loop, so fall back to regionId's own former child instead.
    childRegion:
      newParentFormerChild === regionId ? regionFormerChild : newParentFormerChild,
  }

  return deepFreeze({
    ...config,
    regions,
    rootRegions: deriveRootRegions(regions, config.rootRegions),
  })
}

// ── ADD verbs (additive-only; v1 grow surface) ────────────────────────────────

/**
 * addPanel — pure append to `config.panels`.
 *
 * A panel is a pure lookup-table entry (no spine edge), so adding one is ALWAYS
 * invariant-safe on its own: it cannot create a cycle (I2), dangle a ref (I3 —
 * nothing points at it until a region docks it), or change the resizable-root
 * count (I1). The catalog gate (applyVerb) is what vets `panel.renderedByComponent`
 * before this is ever called; this verb is purely structural.
 *
 * Idempotent-overwrite by id: re-adding the same id replaces that entry.
 */
export function addPanel(config: WorkspaceConfig, panel: PanelConfig): WorkspaceConfig {
  return deepFreeze({
    ...config,
    panels: { ...config.panels, [panel.id]: panel },
  })
}

/**
 * addRegion — add `region` to `config.regions`.
 *
 * When `parentRegionId` is given AND that parent exists, splice `region` in as the
 * parent's child: the new region adopts the parent's former childRegion, and the
 * parent's childRegion is rewired to the new region (mirrors relocateRegion's
 * adopt-then-point edge surgery, so the spine stays a connected linear chain).
 * When no parent is given (or the named parent is absent), the region is added as
 * an UNROOTED entry in the map — present but rendered by nothing until a later
 * addRootRegion / dock makes it reachable (exactly the seed's present-but-unrooted
 * region-top-bar shape).
 *
 * rootRegions is NEVER touched here (a spliced child is not a root; an unrooted
 * add is not a root) — rooting is addRootRegion's job, on the append path.
 */
export function addRegion(
  config: WorkspaceConfig,
  region: RegionConfig,
  parentRegionId?: string,
): WorkspaceConfig {
  const regions: Record<string, RegionConfig> = { ...config.regions }
  const parent = parentRegionId ? regions[parentRegionId] : undefined

  if (parent && parentRegionId) {
    // Splice as the parent's child: region adopts parent's former child, parent
    // now points at region. Force the new region's childRegion to the adopted one
    // (ignore any incoming childRegion on `region` so the spine cannot fork).
    regions[region.id] = { ...region, childRegion: parent.childRegion }
    regions[parentRegionId] = { ...parent, childRegion: region.id }
  } else {
    // Unrooted add: present in the map, reachable from no spine until rooted.
    regions[region.id] = region
  }

  return deepFreeze({ ...config, regions })
}

/**
 * addRootRegion — root `region` by APPENDING its id at the END of rootRegions.
 *
 * THE FATAL FIX (RUNG G1). RootEntry IRIs are POSITIONAL — ux-rdf.ts emits
 * `{config.id}-root-{idx}` keyed on the ARRAY POSITION, with that node's atIndex
 * and rootRegion object both derived from idx. Appending at the end leaves every
 * existing index's three triples (rdf:type RootEntry, atIndex, rootRegion)
 * byte-identical, so the serialized grow is a PURE STRICT-SUPERSET append and
 * growDeltaNT's additive guard never fires.
 *
 * We DO NOT call deriveRootRegions here. deriveRootRegions order-sorts by
 * (order asc, id asc); a new chrome bar with a LOWER order (e.g. region-top-bar
 * order 0 < region-center order 2) would be placed at index 0, shifting the seed's
 * resizable head to index 1 — that REWRITES `{id}-root-0`'s rootRegion object
 * (region-center → region-top-bar), the seed triple is LOST, and growDeltaNT
 * throws "grow is not additive". Append-order avoids this entirely; planFor
 * partitions chrome by region.order (NOT by RootEntry index), so append-order
 * renders IDENTICALLY while staying additive.
 *
 * The new root MUST be non-resizable chrome (I1: exactly one resizable root) —
 * the catalog gate (applyVerb.add_root_region) builds it with resizable:false; if
 * a caller hands a resizable region here, validateConfig (the spine gate, run next
 * in grow()) rejects the candidate. This verb does not self-validate.
 */
export function addRootRegion(config: WorkspaceConfig, region: RegionConfig): WorkspaceConfig {
  // IDEMPOTENT: re-rooting an already-rooted region is a no-op, so re-running the
  // same grow never appends a duplicate RootEntry. (The present-but-unrooted case —
  // region in regions{} but not in rootRegions — still gets rooted below.)
  if (config.rootRegions.includes(region.id)) return config
  const regions = { ...config.regions, [region.id]: region }
  return deepFreeze({
    ...config,
    regions,
    // APPEND-ORDER — never deriveRootRegions, never order-sort.
    rootRegions: [...config.rootRegions, region.id],
  })
}
