/**
 * validateConfig — the COMMIT GATE for live WorkspaceConfig writes.
 *
 * A config is mutated by the pure verbs in mutations.ts and written to Y.js by
 * session-store.setWorkspaceConfig. Between mutation and commit, this function
 * is the single chokepoint that REJECTS structurally-broken configs LOUDLY
 * (returns { ok: false, error }) so a bad config never reaches the renderer.
 *
 * THE BRICK-STOPPER (I2): planFor / walkSpine / subtreeFraction (interpreter.ts)
 * have NO cycle guard — a cyclic childRegion chain bricks the WHOLE shell with a
 * RangeError (stack overflow). This validator walks the RAW config.regions[*]
 * .childRegion edges with a visited-set BEFORE planFor is ever called. It must
 * NOT call planFor — a post-plan walk is too late (no plan exists for a cyclic
 * config; planFor would already have thrown).
 *
 * Pure: no DOM, no stores, no planFor. config in, verdict out.
 *
 * Invariants enforced:
 *   I1 — exactly one resizable root in rootRegions (the single spine head).
 *   I2 — ACYCLIC childRegion spine (raw-edge cycle walk, visited-set).
 *   I3 — no dangling refs: every childRegion target + every docksPanel id exists.
 *   I5 — every region is resolvable to a component: renderedByComponent set, OR
 *        docksPanel[0] → panel.renderedByComponent set.
 *   I6 — sizeFraction in (0,1) for spine regions (the regions on a spine walk).
 *   I7 — every STAMPED component tag (panel.renderedByComponent + region
 *        .renderedByComponent) is on-catalog AND grammar-valid (the render gate).
 *        I5 only proves a tag RESOLVES; I7 proves it names a real, vetted, well-
 *        formed custom element — so the commit gate agrees with the render gate
 *        (interpreter.stampPanelBody) and an injected/off-catalog tag is rejected
 *        here instead of resolving to a placeholder at render time.
 *   I8 — every selection-edge endpoint resolves to a REGISTERED face id. Both
 *        edge.from and edge.to must be in KNOWN_FACE_IDS — mirroring the shell's
 *        EDGE_FACES keys — so the commit gate agrees with the interpreter's
 *        runtime face resolution (which silently SKIPS an edge whose from/to is
 *        not a FacePort key), exactly as I7 agrees with stampPanelBody. Predicate
 *        is deliberately NOT gated: the interpreter tolerates unknown predicates
 *        by design (navigatesTo was a documented no-op before it installed), so
 *        rejecting them would kill legitimately forward-declared couplings.
 *   I9 — an authored sux:surfaceRole is one of the closed presentation roles.
 *        This is checked after RDF parsing because external triples are not
 *        protected by TypeScript's SurfaceRegionRole union.
 *   I10 — an authored sux:surfaceMode is one of the closed content-selection
 *         policies, for the same untrusted-graph reason as I9.
 */

import type { RegionConfig, WorkspaceConfig } from './types.js'
import { isRenderableComponentTag } from './known-components.js'
import { KNOWN_FACE_IDS } from './known-faces.js'

export type ValidateResult = { ok: true } | { ok: false; error: string }

/**
 * Validate ONE region-set (a root list over the shared `regions` map) against
 * the per-set invariants I1 (exactly one resizable root) and I6 (spine
 * sizeFraction in (0,1)), plus root existence. WP0.0: a config may carry N
 * per-app region-sets that each independently satisfy these.
 *
 * `label` names the set in error messages — '' for the default `rootRegions`
 * (byte-identical to the pre-WP0.0 messages), `app 'x'` for a per-app set.
 *
 * Pure; no DOM, no stores, no planFor.
 */
function validateRootSet(
  regions: Readonly<Record<string, RegionConfig>>,
  rootRegions: readonly string[],
  label: string,
): ValidateResult {
  const suffix = label ? ` (${label})` : ''

  // Root existence (a dangling root = config corruption). Confirm first so the
  // resizable filter + spine walk below can trust every root resolves.
  for (const id of rootRegions) {
    if (!regions[id]) {
      return { ok: false, error: `I3 dangling ref: rootRegion '${id}'${suffix} does not exist` }
    }
  }

  // ── I1 — exactly one resizable root in this set ──────────────────────────
  const resizableRoots = rootRegions.filter((id) => regions[id]?.resizable === true)
  if (resizableRoots.length !== 1) {
    return {
      ok: false,
      error: `I1 spine-head${suffix}: expected exactly one resizable root, found ${resizableRoots.length} (${resizableRoots.join(', ') || 'none'})`,
    }
  }

  // ── I6 — sizeFraction in (0,1) for spine regions reachable from this head ─
  // (Chrome roots are sized by CSS, not the split tree, so they are not gated.)
  let cursor: string | null = resizableRoots[0]
  while (cursor !== null) {
    const region: RegionConfig | undefined = regions[cursor]
    if (!region) break
    const frac = region.sizeFraction
    if (frac === null || !(frac > 0 && frac < 1)) {
      return {
        ok: false,
        error: `I6 sizeFraction out of range${suffix}: spine region '${cursor}' sizeFraction=${frac} (must be in (0,1))`,
      }
    }
    cursor = region.childRegion
  }

  return { ok: true }
}

/**
 * Validate a WorkspaceConfig against the live-commit invariants.
 * Returns the FIRST violation found (fail-fast), or { ok: true }.
 */
export function validateConfig(config: WorkspaceConfig): ValidateResult {
  const regions = config.regions
  const panels = config.panels
  const rootRegions = config.rootRegions ?? []

  // ── I3 (part a) — dangling childRegion targets ────────────────────────────
  // Run the existence check first so the cycle walk below can trust every edge
  // target either resolves or is null.
  for (const id of Object.keys(regions)) {
    const region = regions[id]
    if (
      region.surfaceRole != null
      && !(['center', 'sidebar', 'right', 'other'] as const).includes(region.surfaceRole)
    ) {
      return {
        ok: false,
        error: `I9 invalid surfaceRole: region '${id}' surfaceRole='${String(region.surfaceRole)}'`,
      }
    }
    if (
      region.surfaceMode != null
      && !(['routed', 'configured'] as const).includes(region.surfaceMode)
    ) {
      return {
        ok: false,
        error: `I10 invalid surfaceMode: region '${id}' surfaceMode='${String(region.surfaceMode)}'`,
      }
    }
    if (region.childRegion !== null && !regions[region.childRegion]) {
      return {
        ok: false,
        error: `I3 dangling ref: region '${id}' childRegion '${region.childRegion}' does not exist`,
      }
    }
    // ── I3 (part b) — dangling docksPanel ids ──────────────────────────────
    for (const panelId of region.docksPanel) {
      if (!panels[panelId]) {
        return {
          ok: false,
          error: `I3 dangling ref: region '${id}' docksPanel '${panelId}' does not exist`,
        }
      }
    }
  }

  // ── I2 — ACYCLIC childRegion spine (THE BRICK-STOPPER) ─────────────────────
  // Walk the RAW childRegion edges from EVERY region with a visited-set. A cycle
  // anywhere in the graph (even off the spine head) would stack-overflow planFor,
  // so we don't restrict the walk to rootRegions. WITHOUT calling planFor.
  for (const startId of Object.keys(regions)) {
    const seen = new Set<string>()
    let cursor: string | null = startId
    while (cursor !== null) {
      if (seen.has(cursor)) {
        return {
          ok: false,
          error: `I2 cyclic childRegion spine: region '${cursor}' revisited (cycle through childRegion edges)`,
        }
      }
      seen.add(cursor)
      const region: RegionConfig | undefined = regions[cursor]
      // I3 already guaranteed the target exists (or is null) — narrow the type.
      cursor = region ? region.childRegion : null
    }
  }

  // ── I1 + I6 — per region-set (default + each per-app set; WP0.0) ───────────
  // I2/I3/I5 hold over the shared `regions` map once (above/below). I1 (one
  // resizable root) and I6 (spine sizeFraction) hold INDEPENDENTLY for the
  // default `rootRegions` and every `appRootRegions[*]`.
  const rootSets: Array<{ label: string; roots: readonly string[] }> = [
    { label: '', roots: rootRegions },
  ]
  if (config.appRootRegions) {
    for (const app of Object.keys(config.appRootRegions)) {
      rootSets.push({ label: `app '${app}'`, roots: config.appRootRegions[app] })
    }
  }
  for (const { label, roots } of rootSets) {
    const verdict = validateRootSet(regions, roots, label)
    if (!verdict.ok) return verdict
  }

  // ── I5 — every region resolvable to a component ────────────────────────────
  // renderedByComponent set (chrome) OR docksPanel[0] → panel.renderedByComponent set.
  for (const id of Object.keys(regions)) {
    const region = regions[id]
    if (region.renderedByComponent) continue
    const firstPanel = region.docksPanel[0]
    const viaPanel = firstPanel ? panels[firstPanel]?.renderedByComponent : null
    if (!viaPanel) {
      return {
        ok: false,
        error: `I5 unresolvable region: '${id}' has no renderedByComponent and no docksPanel[0] → panel.renderedByComponent`,
      }
    }
  }

  // ── I7 — every STAMPED component tag is on-catalog AND grammar-valid ────────
  // The tags that actually flow to interpreter.stampPanelBody → unsafeStatic are
  // panel.renderedByComponent (always set) and region.renderedByComponent (when
  // non-null). Gate exactly those via isRenderableComponentTag so a truthy-but-
  // off-catalog tag ('script', 'x-evil') or an injected fragment — which PASSES
  // I5 — is rejected at commit. config.renderedByComponent (the workspace ROOT,
  // e.g. 'app-shell') is the host shell element itself and is NEVER stamped
  // (resolveSurfaceTag/resolvePanelTag read only region/panel tags), so it is
  // deliberately OUT of scope here — gating it would reject every valid seed.
  for (const id of Object.keys(panels)) {
    const tag = panels[id].renderedByComponent
    if (!isRenderableComponentTag(tag)) {
      return {
        ok: false,
        error: `I7 off-catalog component: panel '${id}' renderedByComponent '${tag}' is not a vetted, grammar-valid custom-element tag`,
      }
    }
  }
  for (const id of Object.keys(regions)) {
    const tag = regions[id].renderedByComponent
    if (tag !== null && !isRenderableComponentTag(tag)) {
      return {
        ok: false,
        error: `I7 off-catalog component: region '${id}' renderedByComponent '${tag}' is not a vetted, grammar-valid custom-element tag`,
      }
    }
  }

  // ── I8 — every selection-edge endpoint resolves to a REGISTERED face ────────
  // The interpreter resolves edge.from/edge.to against the shell's FacePort map
  // and SILENTLY skips an edge whose endpoint is not a key. Gate both endpoints
  // against KNOWN_FACE_IDS (the nucleus mirror of EDGE_FACES) so a bogus face id
  // is rejected LOUDLY at commit instead of failing soft at install. Predicate is
  // NOT gated — unknown predicates are tolerated by design (see header).
  for (const edge of config.edges ?? []) {
    for (const faceId of [edge.from, edge.to]) {
      if (!KNOWN_FACE_IDS.has(faceId)) {
        return {
          ok: false,
          error: `I8 unresolvable face: edge '${edge.from}' -${edge.predicate}-> '${edge.to}' references face '${faceId}' which is not a registered face id`,
        }
      }
    }
  }

  return { ok: true }
}
