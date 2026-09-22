/**
 * gardend-liveread.live.mts — the RUNNABLE live test (real infra) equivalent of
 * the integration test, for environments where the vitest runner cannot spawn
 * the gardend binary. It does EXACTLY the same end-to-end path against a REAL
 * gardend — NO MOCKS — and exits non-zero on any mismatch.
 *
 * Spawn → seed real 275-triple :ux:config → read back THROUGH the contract
 * (loadConfigFromCell + SPARQL COUNT) → parse → renderWorkspace into a real DOM
 * (happy-dom registered here) → assert 6 regions / 7 panels / chrome / spine →
 * kill cell + remove temp profile.
 *
 * Run: pnpm gardend:live   (or: GARDEN_BIN=/path tsx scripts/gardend-liveread.live.mts)
 */

// MUST be first: installs the happy-dom DOM globals BEFORE lit-html (pulled in
// transitively below) captures `document` at its module-eval time.
import './happy-dom-globals.mjs'

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { parseNT, parseTriplesToConfig } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { spawnGardend, createGraphAndSeedUxConfig, resolveGardendBin, type GardendCell } from '../src/cell/spawn-gardend.js'
import { createGardendContract } from '../src/cell/gardend-contract.js'
import { loadConfigFromCell, countUxConfigTriples } from '../src/cell/session-store.js'

const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const SEED_NT_PATH = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const GRAPH_ID = 'shrubbery-liveread'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

async function main(): Promise<void> {
  const bin = resolveGardendBin()
  if (!existsSync(bin)) throw new Error(`gardend binary not found at ${bin} (set GARDEN_BIN)`)
  const SEED_NT = readFileSync(SEED_NT_PATH, 'utf8')
  assert(parseNT(SEED_NT).length === 275, 'seed is the real 275-triple body')

  let cell: GardendCell | undefined
  try {
    console.log('[live] spawning real gardend…')
    cell = await spawnGardend()
    console.log(`[live] up pid=${cell.pid} api=${cell.apiUrl}`)
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT)
    console.log('[live] seeded :ux:config (275 triples)')

    const contract = createGardendContract({
      transport: { mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' },
    })

    const read = await loadConfigFromCell(contract, GRAPH_ID)
    assert(read.tripleCount === 275, `rdf_dump body = 275 (got ${read.tripleCount})`)
    const sparqlCount = await countUxConfigTriples(contract, GRAPH_ID)
    assert(sparqlCount === 275, `SPARQL COUNT = 275 (got ${sparqlCount})`)
    console.log(`[live] read back 275 triples via BOTH paths (rdf_dump=${read.tripleCount}, sparql=${sparqlCount})`)

    const config = read.config
    assert(config.id === 'GardenDefault', 'config.id = GardenDefault')
    assert(Object.keys(config.regions).length === 6, `6 regions (got ${Object.keys(config.regions).length})`)
    assert(Object.keys(config.panels).length === 7, `7 panels (got ${Object.keys(config.panels).length})`)

    const container = renderWorkspace(config)
    const app = container.querySelector('.app-container')
    assert(app, '.app-container rendered')
    assert(app!.querySelector('header[data-region="region-top-bar"] mn-top-bar'), 'top bar chrome')
    assert(app!.querySelector('footer[data-region="region-bottom-bar"] mn-bottom-bar'), 'bottom bar chrome')
    const panes = Array.from(app!.querySelectorAll('.split-pane[data-region]')).map(el => el.getAttribute('data-region'))
    assert(JSON.stringify(panes) === JSON.stringify(['region-left-rail', 'region-center', 'region-right-rail']), `spine order (got ${panes})`)
    assert(app!.querySelectorAll('sl-split-panel').length === 2, '2 nested split-panels')
    console.log('[live] rendered real DOM: 6 regions / 7 panels / chrome / 3-deep spine — OK')

    console.log('LIVE_READ_CONFIRMED')
  } finally {
    if (cell) await cell.kill()
    console.log('[live] cell killed + temp profile removed')
  }
}

main().catch(err => {
  console.error('[live] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
