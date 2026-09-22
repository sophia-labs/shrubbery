// @vitest-environment happy-dom

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNT, uxConfigGraphIri } from '@shrubbery/nucleus'
import { GARDEN_SITE_BUNDLE } from '@shrubbery/site/garden'
import { McpClient, type PlanterBootConfig } from '@shrubbery/source'
import {
  createGraphAndSeedUxConfig,
  loopbackSeedTarget,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '@shrubbery/source/node'
import { mountPlanter } from '../src/main.js'

const require_ = createRequire(import.meta.url)
const SEED_NT = readFileSync(
  require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_NT).length
const GARDEN_BIN = resolveGardendBin()
const GRAPH_ID = 'planter-garden-bundle-it'

function composed(type: string, detail?: unknown): CustomEvent {
  return new CustomEvent(type, { detail, bubbles: true, composed: true })
}

describe('REAL INTEGRATION — Garden bundle consumed by the generic Planter host', () => {
  let cell: GardendCell

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(`Garden bundle acceptance requires real gardend at ${GARDEN_BIN}`)
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(
      loopbackSeedTarget(cell),
      GRAPH_ID,
      SEED_NT,
      'Planter Garden Bundle IT',
    )
  }, 60_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('boots the declarative bundle, preserves Garden posture, handles chrome journeys, and re-reads a mutation', async () => {
    window.history.replaceState({}, '', '/workspace')
    const container = document.createElement('div')
    document.body.append(container)
    const config: PlanterBootConfig = {
      endpoint: cell.apiUrl,
      graph: GRAPH_ID,
      auth: { mode: 'dev', token: cell.token },
      adapter: 'gardend-local',
      pollMs: 60_000,
      bundle: 'garden',
    }
    const mount = await mountPlanter(container, config)
    try {
      expect(container.dataset.siteBundle).toBe(GARDEN_SITE_BUNDLE.id)
      expect(container.dataset.siteRoute).toBe('workspace')
      expect(mount.bundleState()).toMatchObject({
        skin: 'garden',
        theme: 'light',
        leftWidth: GARDEN_SITE_BUNDLE.panels.left.default,
        rightWidth: GARDEN_SITE_BUNDLE.panels.right.default,
      })
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(document.documentElement.hasAttribute('data-skin')).toBe(false)

      const app = container.querySelector('.app-container')
      expect(app).not.toBeNull()
      const leftSplit = container.querySelector('sl-split-panel[data-split-role="left"]')
      const rightSplit = container.querySelector('sl-split-panel[data-split-role="right"]')
      expect(leftSplit?.getAttribute('snap')).toBe(GARDEN_SITE_BUNDLE.panels.left.snap)
      expect(rightSplit?.getAttribute('snap')).toBe(GARDEN_SITE_BUNDLE.panels.right.snap)
      expect(leftSplit?.getAttribute('snap-threshold')).toBe(String(GARDEN_SITE_BUNDLE.panels.snapThreshold))

      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-skin-toggle'))
      expect(document.documentElement.dataset.skin).toBe('emporium')
      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-skin-toggle'))
      expect(document.documentElement.dataset.skin).toBe('98')
      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-skin-toggle'))
      expect(document.documentElement.dataset.skin).toBe('glass')
      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-theme-toggle'))
      expect(document.documentElement.dataset.theme).toBe('dark')

      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-settings-toggle'))
      const notice = container.querySelector<HTMLElement>('.planter-bundle-notice')!
      expect(notice.hidden).toBe(false)
      expect(notice.dataset.feature).toBe('settings')
      expect(notice.textContent).toContain('DEFERRED')
      expect(notice.textContent).toContain('secret store')

      container.querySelector('mn-top-bar')!.dispatchEvent(composed('mn-navigate-home'))
      expect(container.dataset.siteRoute).toBe('home')
      const home = container.querySelector('mn-home-view') as (HTMLElement & { graphId?: string }) | null
      expect(home).not.toBeNull()
      expect(home?.graphId).toBe(GRAPH_ID)

      const chip = container.querySelector<HTMLElement>('.planter-status-strip .mn-kind')!
      expect(chip.dataset.tripleCount).toBe(String(SEED_TRIPLE_COUNT))
      const graphIri = uxConfigGraphIri(GRAPH_ID)
      const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
      await mcp.toolsCall('sparql_update', {
        graphId: GRAPH_ID,
        update: `INSERT DATA { GRAPH <${graphIri}> { <urn:planter:garden-bundle:probe> <urn:planter:observed> "true" . } }`,
      })
      await mount.refresh()
      expect(container.querySelector<HTMLElement>('.planter-status-strip .mn-kind')?.dataset.tripleCount).toBe(
        String(SEED_TRIPLE_COUNT + 1),
      )
      expect(mount.status()?.kind).toBe('ok')
    } finally {
      mount.stop()
      container.remove()
    }
  }, 90_000)
})
