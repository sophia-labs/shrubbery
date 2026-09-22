/**
 * REAL integration test — the gardend live-read, end to end, NO MOCKS.
 *
 * This stands up a REAL headless gardend cell (fresh temp profile), seeds its
 * :ux:config NAMED graph with the REAL 275-triple committed seed body, then
 * reads it back THROUGH the shell-side ShrubberyContract (createGardendContract
 * → loadConfigFromCell), parses it via the production read path, plans + renders
 * it through @shrubbery/runtime, and asserts the REAL happy-dom DOM (6 regions /
 * 7 panels / chrome). The cell is killed and its temp profile removed on
 * teardown.
 *
 * It REQUIRES the real gardend binary (real infra, per the no-mock rule). If the
 * binary cannot be found/spawned this suite FAILS LOUDLY rather than faking a
 * cell — and the equivalent runnable live script lives at
 * apps/organism/scripts/gardend-liveread.live.mjs. There is no stubbed HTTP and
 * no fake config payload anywhere in this path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { parseTriplesToConfig, parseNT } from '@shrubbery/nucleus'
import { makeQueryBlockService, renderWorkspace } from '@shrubbery/runtime'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import { loadConfigFromCell, countUxConfigTriples } from '../src/cell/session-store.js'

// Anchor on the LINKED nucleus package so the seed path resolves under the pnpm
// workspace symlink (same approach as the runtime integration test).
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const nucleusSrcDir = dirname(nucleusEntry)
const SEED_NT_PATH = resolve(nucleusSrcDir, 'workspace/__generated__/garden-default.ux.nt')
const SEED_NT = readFileSync(SEED_NT_PATH, 'utf8')
const EXPECTED_SEED_TRIPLES = 275

const GRAPH_ID = 'shrubbery-organism-it'

// The integration test needs the real binary. We let the suite run and FAIL if
// the binary is absent (no-mock rule). Guard the spawn so a missing binary gives
// a crisp message pointing at the runnable live script.
const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

describe('REAL INTEGRATION — gardend live-read of :ux:config through the contract', () => {
  let cell: GardendCell
  let contract: GardendContract

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN, or run the live script: ` +
          `node apps/organism/scripts/gardend-liveread.live.mjs`,
      )
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT)
    // Node-side transport: direct loopback URL + bearer + origin (mirrors neem-rs).
    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
    })
  }, 40000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('the seed body we feed the cell is the real 275-triple committed body', () => {
    const triples = parseNT(SEED_NT)
    expect(triples.length).toBe(EXPECTED_SEED_TRIPLES)
  })

  it('reads :ux:config back from the live cell — 275 triples via BOTH read paths', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    // rdf_dump body line count is authoritative (NOT the envelope quadCount).
    expect(read.tripleCount).toBe(EXPECTED_SEED_TRIPLES)
    expect(read.graphIri).toBe(`urn:mnemosyne:local:graph:${GRAPH_ID}:ux:config`)
    // SPARQL COUNT over the GRAPH-wrapped named graph must agree.
    const sparqlCount = await countUxConfigTriples(contract, GRAPH_ID)
    expect(sparqlCount).toBe(EXPECTED_SEED_TRIPLES)
  })

  it('the live-read N-Triples re-parse to the GardenDefault config shape', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    const config = read.config
    expect(config.id).toBe('GardenDefault')
    expect(config.renderedByComponent).toBe('app-shell')
    // 6 real regions.
    expect(Object.keys(config.regions).sort()).toEqual([
      'region-bottom-bar',
      'region-center',
      'region-choreo-center',
      'region-left-rail',
      'region-right-rail',
      'region-top-bar',
    ])
    // 7 panels in the garden default.
    expect(Object.keys(config.panels).length).toBe(7)
  })

  it('the LIVE config renders the real workspace DOM (chrome + 3-deep spine)', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    // planFor runs inside renderWorkspace; this is the full production render path.
    const container = renderWorkspace(read.config)
    const appContainer = container.querySelector('.app-container')!
    expect(appContainer).not.toBeNull()
    expect(appContainer.querySelector('.main')).not.toBeNull()

    // chrome: top + bottom bar present with their resolved tags.
    expect(appContainer.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
    expect(appContainer.querySelector('footer[data-region="region-bottom-bar"] mn-bottom-bar')).not.toBeNull()

    // spine: 3 panes in order (left → center → right).
    const panes = Array.from(appContainer.querySelectorAll('.split-pane[data-region]')).map(el =>
      el.getAttribute('data-region'),
    )
    expect(panes).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])

    // nested split-panels (outer 20 / inner right-split 75).
    expect(appContainer.querySelectorAll('sl-split-panel').length).toBe(2)
    const inner = appContainer.querySelector('sl-split-panel.right-split')!
    expect(inner.getAttribute('position')).toBe('75')

    // panel tags resolved INERT (no faked bodies).
    expect(appContainer.querySelector('mn-sidebar-panel')).not.toBeNull()
    const editor = appContainer.querySelector('mn-document-editor')!
    expect(editor.children.length).toBe(0)
    expect(appContainer.querySelector('mn-chat-panel')).not.toBeNull()
  })

  it('the contract reports runtime mode "local" and is authenticated', () => {
    expect(contract.runtime.mode()).toBe('local')
    expect(contract.runtime.isGateway()).toBe(false)
    expect(contract.auth.isAuthenticated()).toBe(true)
    expect(contract.auth.token()).toBe(cell.token)
  })

  it('parse round-trip: the live N-Triples re-parse equals the dumped body length', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    // Re-parse the dumped body independently and confirm it matches.
    const reparsed = parseTriplesToConfig(parseNT(read.nt))
    expect(reparsed.id).toBe(read.config.id)
    expect(Object.keys(reparsed.regions).length).toBe(Object.keys(read.config.regions).length)
  })

  it('executes a read-only QueryBlock through the real cell contract', async () => {
    const query = `
      SELECT ?s ?p ?o WHERE {
        GRAPH <urn:mnemosyne:local:graph:${GRAPH_ID}:ux:config> { ?s ?p ?o }
      }
      LIMIT 3
    `
    const result = await makeQueryBlockService(contract.rest).run(GRAPH_ID, query, 3)
    expect(result.resultKind).toBe('bindings')
    if (result.resultKind !== 'bindings') throw new Error('expected QueryBlock bindings')
    expect(result.rows).toHaveLength(3)
    expect(result.columns).toEqual(expect.arrayContaining(['s', 'p', 'o']))
    expect(result.rows[0].s.value).toBeTruthy()
  })
})
