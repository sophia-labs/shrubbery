/**
 * WP0.0 — multi-region-set (per-app) type shape.
 *
 * Proves the structural support for the 4th `app` dimension:
 *   - planFor(config) is BYTE-IDENTICAL to planFor(config, 'garden') and to the
 *     canonical planFor(GARDEN_DEFAULT) — the no-app path is unchanged (WP2.1).
 *   - planFor(config, 'choreograph') walks a DIFFERENT spine (a real divergence).
 *   - An unknown app falls back to the default rootRegions.
 *   - validateConfig enforces I1/I6 INDEPENDENTLY per region-set, naming the
 *     offending app in the error.
 *
 * Pure: no DOM, no stores.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_APP_ID, deriveAppTabs, isAppDeclared, planFor, resolveRootRegions } from '../interpreter.js'
import { validateConfig } from '../validate.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import type { RegionConfig, WorkspaceConfig } from '../types.js'

/**
 * A resizable spine-head region for a second app, sharing garden's chrome.
 *
 * This is a SYNTHETIC fixture for the two-app divergence checks below; it shadows
 * the real `region-choreo-center` that P0 added to GARDEN_DEFAULT. Its
 * `renderedByComponent` is only a non-null I5 placeholder (planFor never reads it),
 * so the legacy 'wf-mission-control' tag here is harmless — the real region resolves
 * to the canonical 'wf-studio-shell' screen-router (pinned in the golden test).
 */
const CHOREO_CENTER: RegionConfig = {
  id: 'region-choreo-center',
  label: 'Choreograph Center (Mission Control)',
  childRegion: null,
  order: 2,
  splitOrientation: 'vertical',
  collapsible: false,
  resizable: true,
  sizeFraction: 0.8,
  dockState: null,
  docksPanel: [],
  renderedByComponent: 'wf-mission-control',
}

/** GARDEN_DEFAULT + a choreograph region-set over the SHARED regions map. */
function twoAppConfig(choreoRoots: readonly string[]): WorkspaceConfig {
  return {
    ...GARDEN_DEFAULT,
    regions: { ...GARDEN_DEFAULT.regions, 'region-choreo-center': CHOREO_CENTER },
    // default spine stays garden
    rootRegions: GARDEN_DEFAULT.rootRegions,
    appRootRegions: {
      garden: GARDEN_DEFAULT.rootRegions,
      choreograph: choreoRoots,
    },
  }
}

const VALID_CHOREO_ROOTS = ['region-top-bar', 'region-choreo-center', 'region-bottom-bar']

describe('WP0.0 — per-app region-sets', () => {
  it('planFor(config) === planFor(config, "garden") === planFor(GARDEN_DEFAULT) (no-app path unchanged)', () => {
    const config = twoAppConfig(VALID_CHOREO_ROOTS)
    const noApp = planFor(config)
    const gardenApp = planFor(config, 'garden')
    const canonical = planFor(GARDEN_DEFAULT)
    expect(noApp).toEqual(gardenApp)
    expect(noApp).toEqual(canonical)
    expect(noApp.spineHeadId).toBe('region-left-rail')
  })

  it('planFor(config, "choreograph") walks a different spine', () => {
    const config = twoAppConfig(VALID_CHOREO_ROOTS)
    const choreo = planFor(config, 'choreograph')
    expect(choreo.spineHeadId).toBe('region-choreo-center')
    expect(choreo).not.toEqual(planFor(config, 'garden'))
    // top-bar + bottom-bar are shared chrome on both apps
    expect(choreo.topChrome).toEqual(['region-top-bar'])
    expect(choreo.bottomChrome).toEqual(['region-bottom-bar'])
  })

  it('an unknown app falls back to the default rootRegions', () => {
    const config = twoAppConfig(VALID_CHOREO_ROOTS)
    expect(resolveRootRegions(config, 'nope')).toBe(config.rootRegions)
    expect(planFor(config, 'nope')).toEqual(planFor(config))
  })

  it('resolveRootRegions: garden + no-app ⇒ always the default set (garden absent from appRootRegions)', () => {
    // GARDEN_DEFAULT now carries appRootRegions.choreograph (P0) but DELIBERATELY
    // no 'garden' entry, so the default app and the no-app path both fall back to
    // rootRegions by identity — the no-app invariant survives the new set.
    expect(resolveRootRegions(GARDEN_DEFAULT, 'garden')).toBe(GARDEN_DEFAULT.rootRegions)
    expect(resolveRootRegions(GARDEN_DEFAULT)).toBe(GARDEN_DEFAULT.rootRegions)
  })

  it('validateConfig passes a valid two-app config', () => {
    expect(validateConfig(twoAppConfig(VALID_CHOREO_ROOTS))).toEqual({ ok: true })
  })

  it('validateConfig enforces I1 per app-set and names the app', () => {
    // choreograph set has TWO resizable roots (region-choreo-center + region-left-rail)
    const broken = twoAppConfig(['region-choreo-center', 'region-left-rail'])
    const verdict = validateConfig(broken)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.error).toContain('I1 spine-head')
      expect(verdict.error).toContain("app 'choreograph'")
      expect(verdict.error).toContain('found 2')
    }
  })

  // ── WP2.1 — the dim-app dimension + active-app → planFor selection ─────────
  describe('WP2.1 — active-app selection (the dim-app dimension)', () => {
    it('GARDEN_DEFAULT now carries the dim-app dimension (default garden, structural)', () => {
      const dim = GARDEN_DEFAULT.dimensions['dim-app']
      expect(dim).toBeDefined()
      expect(dim.defaultValue).toBe('garden')
      // STRUCTURAL — never a DOM/CSS hook (read by planFor, not stamped).
      for (const v of dim.values) {
        expect(v.appliesAttribute).not.toMatch(/\[data-/)
      }
    })

    it('adding dim-app to dimensions does not change the plan (dimensions never feed planFor)', () => {
      // planFor reads regions/rootRegions only; dimensions are inert for the plan.
      expect(validateConfig(GARDEN_DEFAULT)).toEqual({ ok: true })
      expect(planFor(GARDEN_DEFAULT)).toEqual(planFor(GARDEN_DEFAULT, 'garden'))
      expect(planFor(GARDEN_DEFAULT).spineHeadId).toBe('region-left-rail')
    })

    it('the active app (default garden) → garden region-set, byte-identical to no-app', () => {
      // Mirrors the app-shell call site: planFor(config, activeApp) with the
      // default activeApp='garden'. With no appRootRegions, parity holds.
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      const activeApp = GARDEN_DEFAULT.dimensions['dim-app'].defaultValue
      expect(activeApp).toBe('garden')
      expect(planFor(config, activeApp)).toEqual(planFor(config))
      expect(planFor(config, activeApp)).toEqual(planFor(GARDEN_DEFAULT))
    })

    it('a non-default active app selects its OWN region-set when present', () => {
      // The headline: the active app threads through to a different spine.
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      expect(planFor(config, 'choreograph').spineHeadId).toBe('region-choreo-center')
      expect(planFor(config, 'choreograph')).not.toEqual(planFor(config, 'garden'))
    })

    it('choreograph on GARDEN_DEFAULT now walks its OWN region-set (P0 — region-choreo-center)', () => {
      // P0 minted appRootRegions.choreograph on GARDEN_DEFAULT, so the active app
      // 'choreograph' threads through to region-choreo-center — a real divergence
      // from the garden spine, byte-different from the no-app path.
      const choreo = planFor(GARDEN_DEFAULT, 'choreograph')
      expect(choreo.spineHeadId).toBe('region-choreo-center')
      expect(choreo).not.toEqual(planFor(GARDEN_DEFAULT))
      // shared chrome brackets the choreo-center head on both sides
      expect(choreo.topChrome).toEqual(['region-top-bar'])
      expect(choreo.bottomChrome).toEqual(['region-bottom-bar'])
    })

    it('an app NOT listed in appRootRegions still falls back to garden (WP2.1 safety)', () => {
      // The fallback guarantee survives: any app without its own set resolves to
      // rootRegions. 'garden' itself is the canonical case (no garden entry).
      expect(planFor(GARDEN_DEFAULT, 'garden')).toEqual(planFor(GARDEN_DEFAULT))
      expect(planFor(GARDEN_DEFAULT, 'unlisted-app')).toEqual(planFor(GARDEN_DEFAULT))
    })
  })

  // ── Slice 10 — isAppDeclared / deriveAppTabs (the confess-absence primitives) ──
  // A DIFFERENT question from resolveRootRegions/planFor's tolerant fallback
  // above, deliberately left untouched by this whole file's other assertions.
  describe('Slice 10 — isAppDeclared / deriveAppTabs', () => {
    it('DEFAULT_APP_ID is "garden"', () => {
      expect(DEFAULT_APP_ID).toBe('garden')
    })

    it('undefined and the default app are always declared, even with no appRootRegions at all', () => {
      expect(isAppDeclared(GARDEN_DEFAULT, undefined)).toBe(true)
      // GARDEN_DEFAULT itself carries appRootRegions.choreograph (P0); use a
      // config with NONE at all (the Observatory's shape) to prove the
      // fallback-free default still holds.
      const singleApp: WorkspaceConfig = { ...GARDEN_DEFAULT, appRootRegions: undefined }
      expect(isAppDeclared(singleApp, undefined)).toBe(true)
      expect(isAppDeclared(singleApp, 'garden')).toBe(true)
    })

    it('an app present in appRootRegions is declared', () => {
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      expect(isAppDeclared(config, 'choreograph')).toBe(true)
    })

    it('an app absent from appRootRegions — and NOT the default — is undeclared (the Observatory bug)', () => {
      const singleApp: WorkspaceConfig = { ...GARDEN_DEFAULT, appRootRegions: undefined }
      expect(isAppDeclared(singleApp, 'choreograph')).toBe(false)
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      expect(isAppDeclared(config, 'not-a-real-app')).toBe(false)
    })

    it('deriveAppTabs on a single-app config (no appRootRegions) yields exactly [garden]', () => {
      const singleApp: WorkspaceConfig = { ...GARDEN_DEFAULT, appRootRegions: undefined }
      expect(deriveAppTabs(singleApp)).toEqual(['garden'])
    })

    it('deriveAppTabs puts the default app first, then declared apps in order', () => {
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      expect(deriveAppTabs(config)).toEqual(['garden', 'choreograph'])
    })

    it('deriveAppTabs never duplicates the default app when a config declares its own garden entry', () => {
      const config: WorkspaceConfig = {
        ...GARDEN_DEFAULT,
        appRootRegions: { garden: GARDEN_DEFAULT.rootRegions, choreograph: VALID_CHOREO_ROOTS },
      }
      expect(deriveAppTabs(config)).toEqual(['garden', 'choreograph'])
    })

    it('deriveAppTabs puts the default app first even when appRootRegions declares it AFTER another key (Final repair, finding 3)', () => {
      const config: WorkspaceConfig = {
        ...GARDEN_DEFAULT,
        appRootRegions: { choreograph: VALID_CHOREO_ROOTS, garden: GARDEN_DEFAULT.rootRegions },
      }
      expect(deriveAppTabs(config)).toEqual(['garden', 'choreograph'])
    })

    it('every id deriveAppTabs returns is, by construction, declared', () => {
      const config = twoAppConfig(VALID_CHOREO_ROOTS)
      for (const app of deriveAppTabs(config)) {
        expect(isAppDeclared(config, app)).toBe(true)
      }
    })
  })

  it('validateConfig still emits the unlabelled message for the default set', () => {
    // default rootRegions broken to two resizable roots; no appRootRegions
    const broken: WorkspaceConfig = {
      ...GARDEN_DEFAULT,
      rootRegions: ['region-left-rail', 'region-center'], // both resizable
    }
    const verdict = validateConfig(broken)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      // byte-identical to the pre-WP0.0 message (no app suffix)
      expect(verdict.error).toBe(
        'I1 spine-head: expected exactly one resizable root, found 2 (region-left-rail, region-center)',
      )
    }
  })
})
