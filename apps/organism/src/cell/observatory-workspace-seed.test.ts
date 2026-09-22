/**
 * observatory-workspace-seed.test.ts — proves the committed seed artifact
 * (`apps/organism/seeds/observatory-workspace.ux.nt`) parses through the REAL
 * production read path into a valid dashboard-center workspace:
 *
 *   parseNT -> parseTriplesToConfig -> validateConfig (the exact pipeline
 *   loadConfigFromCell runs on a live cell read), plus planFor and the
 *   runtime's engineRegionRole so the seed provably renders as "top bar +
 *   dashboard center + optional chat rail" — no file-tree dependency.
 *
 * Also pins the ROUND-TRIP: serializeConfigToTriples(parsed) -> parse again ->
 * deepEqual, so the seed stays expressible in the one canonical sux: schema
 * (the marker is an ordinary region renderedByComponent literal, no vocabulary
 * additions).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  deriveAppTabs,
  isAppDeclared,
  parseNT,
  parseTriplesToConfig,
  planFor,
  resolveSurfaceTag,
  serializeConfigToTriples,
  validateConfig,
} from '@shrubbery/nucleus'
import { LAYOUT_DASHBOARD_COMPONENT, engineRegionRole, renderWorkspace } from '@shrubbery/runtime'
import { configDeclaresDashboardCenter } from './workspace-fragments.js'

const seedPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../seeds/observatory-workspace.ux.nt',
)

function parsedSeedConfig() {
  const nt = readFileSync(seedPath, 'utf8')
  return parseTriplesToConfig(parseNT(nt))
}

describe('observatory workspace seed (dashboard-center sux:Workspace)', () => {
  it('parses through the production read path and passes the commit-gate validator', () => {
    const config = parsedSeedConfig()
    expect(config.id).toBe('ObservatoryDefault')
    const verdict = validateConfig(config)
    expect(verdict).toEqual({ ok: true })
  })

  it('declares the dashboard center marker on region-center', () => {
    const config = parsedSeedConfig()
    expect(resolveSurfaceTag(config, 'region-center')).toBe(LAYOUT_DASHBOARD_COMPONENT)
    expect(configDeclaresDashboardCenter(config)).toBe(true)
    expect(engineRegionRole(config, 'region-center')).toBe('center')
  })

  it('plans as top-bar chrome + dashboard-center spine + stacked chat rail, with NO sidebar', () => {
    const config = parsedSeedConfig()
    const plan = planFor(config)
    expect(plan.topChrome).toContain('region-top-bar')
    expect(plan.spineHeadId).toBe('region-center')
    expect(engineRegionRole(config, 'region-right-rail')).toBe('right')
    // No file-tree dependency: nothing in the seed resolves to the sidebar panel.
    for (const regionId of Object.keys(config.regions)) {
      expect(resolveSurfaceTag(config, regionId)).not.toBe('mn-sidebar-panel')
    }
  })

  it('round-trips through the canonical sux: serializer without loss', () => {
    const config = parsedSeedConfig()
    const reparsed = parseTriplesToConfig(serializeConfigToTriples(config))
    expect(reparsed).toEqual(config)
  })

  // ── Final repair (Slice 10 finding 2) ──────────────────────────────────────
  // The Slice 10 confess-absence proof in
  // `packages/runtime/src/__tests__/render-workspace-integration.test.ts` used
  // `garden-default.ux.nt` (which DOES declare `appRootRegions.choreograph`)
  // for its "undeclared app" cases, exercising the general mechanism but never
  // the literal reported defect: `?graph=observatory`'s own seed — THIS file,
  // already proven above to parse via the real production path — declares
  // ZERO `appRootRegions` entries at all (confirmed live against the canary
  // cell, `06-observatory-app-dimension-defect.md`'s "Verification CLOSED"
  // section). These cases close that gap directly against the real committed
  // Observatory seed, no fabricated config.
  describe('Slice 10 — the Observatory seed itself never offers/renders the dead choreograph tab', () => {
    it('deriveAppTabs yields ONLY the default app — no choreograph tab is offered', () => {
      const config = parsedSeedConfig()
      expect(deriveAppTabs(config)).toEqual(['garden'])
    })

    it('choreograph is genuinely undeclared for this config', () => {
      const config = parsedSeedConfig()
      expect(isAppDeclared(config, 'choreograph')).toBe(false)
      expect(isAppDeclared(config, 'garden')).toBe(true)
      expect(isAppDeclared(config, undefined)).toBe(true)
    })

    it('requesting the choreograph app renders confess-absence, never the dashboard spine (the literal reported symptom, fixed)', () => {
      const config = parsedSeedConfig()
      const container = renderWorkspace(config, { app: 'choreograph' })
      const absent = container.querySelector('[data-workspace-renderer="app-absent"]')
      expect(absent).not.toBeNull()
      expect(absent!.getAttribute('data-missing-app')).toBe('choreograph')
      const empty = container.querySelector('mn-empty-state')
      expect(empty).not.toBeNull()
      expect(empty!.getAttribute('title')).toContain('choreograph')
      // Previously (the reported bug): "the usual dashboard keeps rendering."
      // Assert the dashboard-center marker is genuinely absent this time.
      expect(container.querySelector('[data-region="region-center"]')).toBeNull()
    })

    it('the real top bar renders with only the one config-derived tab (the switcher itself no longer offers a dead choreograph tab)', () => {
      const config = parsedSeedConfig()
      const container = renderWorkspace(config)
      const top = container.querySelector('mn-top-bar') as (HTMLElement & { apps?: readonly { id: string }[] }) | null
      expect(top).not.toBeNull()
      expect(top!.apps?.map(tab => tab.id)).toEqual(['garden'])
    })
  })
})
