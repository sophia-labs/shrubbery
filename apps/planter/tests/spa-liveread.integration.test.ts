// @vitest-environment happy-dom
//
// happy-dom (not node): mounts the REAL @shrubbery/runtime renderWorkspace
// into a REAL DOM container, mirroring apps/organism/tests/gardend-liveread
// .integration.test.ts's environment choice — this is the DOM half of the
// same convergence claim, now through @shrubbery/source (the hoist's
// no-drift guard) and this SPA's own mountPlanter/read-status/testimony path
// instead of organism's frozen session-store.

/**
 * spa-liveread.integration.test.ts — U11 acceptance: the planter SPA against
 * a REAL spawned gardend cell, NO MOCKS.
 *
 * Proves:
 *   - a seeded graph mounts the 6-region / 7-panel GardenDefault workspace,
 *     rendered THROUGH @shrubbery/source (createGardendLocalSource ->
 *     classifyRead -> renderWorkspace, zero edits to NO-TOUCH runtime files);
 *   - the persistent testimony strip (`.mn-kind[data-kind="testimony"]`)
 *     carries readAt/kind/liveness (as `data-read-at`/`data-triple-count` +
 *     its rendered text);
 *   - a FRESH unseeded graph renders the EMPTY panel with the exact, runnable
 *     seed command — never a fabricated GARDEN_DEFAULT stand-in;
 *   - killing the cell then calling refresh() renders the error panel with
 *     errorKind 'unavailable' and the verbatim upstream message.
 *
 * Live-read acceptance claims are gated on FID-004 (U5, green — commit
 * 1de9062, gardend binary sha256 59cb506c…, 2026-07-11): the FID-004 gate
 * is what licenses claiming this live-read at all.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpClient, type PlanterBootConfig } from '@shrubbery/source'
import {
  createGraphAndSeedUxConfig,
  loopbackSeedTarget,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '@shrubbery/source/node'
import { parseNT } from '@shrubbery/nucleus'
import { mountPlanter } from '../src/main.js'

// Idempotent customElements.define: this is the only happy-dom file in this
// package (no shared vitest setupFiles wiring exists here — see
// apps/organism/tests/setup.ts for the precedent this mirrors), but a redefine
// guard costs nothing and protects against a future sibling happy-dom file
// re-importing @shrubbery/runtime's Lit components into the same registry.
const ce = globalThis.customElements
if (ce && typeof ce.define === 'function') {
  const original = ce.define.bind(ce)
  ce.define = function define(
    name: string,
    ctor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void {
    if (ce.get(name)) return
    original(name, ctor, options)
  }
}

const require_ = createRequire(import.meta.url)
const SEED_NT_PATH = require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt')
const SEED_NT = readFileSync(SEED_NT_PATH, 'utf8')
const SEED_TRIPLE_COUNT = parseNT(SEED_NT).length

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

const SEEDED_GRAPH = 'planter-spa-it'
const EMPTY_GRAPH = 'planter-spa-it-empty'

describe('REAL INTEGRATION — the planter SPA live-reads through @shrubbery/source', () => {
  let cell: GardendCell

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          '(no-mock rule). Set GARDEN_BIN to override.',
      )
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(loopbackSeedTarget(cell), SEEDED_GRAPH, SEED_NT, 'Planter SPA IT')
    const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.toolsCall('create_graph', { graph_id: EMPTY_GRAPH, title: 'Planter SPA Empty' })
  }, 40_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  function configFor(graph: string, endpoint: string, token: string): PlanterBootConfig {
    return {
      endpoint,
      graph,
      adapter: 'gardend-local',
      auth: { mode: 'dev', token },
      // Effectively disables the timer for the test's own pacing — every
      // state transition below is driven by an explicit refresh() call.
      pollMs: 60_000,
    }
  }

  it('the seed body we feed the cell is the real canonical committed body', () => {
    expect(parseNT(SEED_NT).length).toBe(SEED_TRIPLE_COUNT)
  })

  it('mounts the ready workspace (6 regions / 7 panels) rendered through @shrubbery/source, with the testimony strip present', async () => {
    const container = document.createElement('div')
    const mount = await mountPlanter(container, configFor(SEEDED_GRAPH, cell.apiUrl, cell.token))
    try {
      const status = mount.status()
      expect(status?.kind).toBe('ok')
      if (status?.kind !== 'ok') throw new Error('expected ok status')
      expect(Object.keys(status.config.regions).sort()).toEqual([
        'region-bottom-bar',
        'region-center',
        'region-choreo-center',
        'region-left-rail',
        'region-right-rail',
        'region-top-bar',
      ])
      expect(Object.keys(status.config.panels).length).toBe(7)

      const appContainer = container.querySelector('.app-container')!
      expect(appContainer).not.toBeNull()
      expect(appContainer.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
      expect(appContainer.querySelector('footer[data-region="region-bottom-bar"] mn-bottom-bar')).not.toBeNull()
      const panes = Array.from(appContainer.querySelectorAll('.split-pane[data-region]')).map((el) =>
        el.getAttribute('data-region'),
      )
      expect(panes).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])

      // The testimony strip — the first end-to-end consumer of kind.css.
      const chip = container.querySelector('.mn-kind[data-kind="testimony"]')
      expect(chip).not.toBeNull()
      expect(chip!.getAttribute('data-triple-count')).toBe(String(SEED_TRIPLE_COUNT))
      expect(Number(chip!.getAttribute('data-read-at'))).toBeGreaterThan(0)
      expect(chip!.textContent).toContain('gardend-local')
      expect(chip!.textContent).toContain('poll')
    } finally {
      mount.stop()
    }
  })

  it('a FRESH unseeded graph renders the EMPTY panel with the exact, runnable seed command (never a GARDEN_DEFAULT stand-in)', async () => {
    const container = document.createElement('div')
    const mount = await mountPlanter(container, configFor(EMPTY_GRAPH, cell.apiUrl, cell.token))
    try {
      expect(mount.status()?.kind).toBe('empty')
      const panel = container.querySelector('.planter-panel-empty')
      expect(panel).not.toBeNull()
      expect(panel!.getAttribute('data-kind')).toBe('state')
      const cmd = panel!.querySelector('.planter-seed-command')
      expect(cmd).not.toBeNull()
      expect(cmd!.textContent).toBe(`pnpm --dir apps/planter seed -- --graph ${EMPTY_GRAPH} --profile-dir <dir>`)
      // Never a fabricated fallback: the GardenDefault workspace id/label must
      // not appear anywhere in an EMPTY render.
      expect(container.textContent).not.toContain('GardenDefault')
      expect(container.textContent).not.toContain('GARDEN_DEFAULT')
    } finally {
      mount.stop()
    }
  })

  it(
    'a KILLED cell, then refresh(), renders the error panel: errorKind "unavailable", verbatim message',
    async () => {
      const victim = await spawnGardend()
      await createGraphAndSeedUxConfig(loopbackSeedTarget(victim), SEEDED_GRAPH, SEED_NT, 'Planter SPA Victim')
      const container = document.createElement('div')
      const mount = await mountPlanter(container, configFor(SEEDED_GRAPH, victim.apiUrl, victim.token))
      try {
        expect(mount.status()?.kind).toBe('ok')
        await victim.kill()
        await mount.refresh()
        const status = mount.status()
        expect(status?.kind).toBe('unavailable')
        if (status?.kind !== 'unavailable') throw new Error('expected unavailable status')

        const panel = container.querySelector('.planter-panel-error')
        expect(panel).not.toBeNull()
        expect(panel!.getAttribute('data-error-kind')).toBe('unavailable')
        expect(panel!.textContent).toContain(status.error.message)
        // A retry affordance is offered for 'unavailable' specifically.
        expect(panel!.querySelector('.planter-retry')).not.toBeNull()

        // MED-2: the strip still shows the PRIOR good read (retained per
        // SourceState's rule), now explicitly labeled STALE — never an
        // ordinary "read ..." value indistinguishable from a live one.
        const chip = container.querySelector('.mn-kind[data-kind="testimony"]')
        expect(chip!.getAttribute('data-stale')).toBe('true')
        expect(chip!.textContent).toContain('STALE')
      } finally {
        mount.stop()
      }
    },
    90_000,
  )
})
