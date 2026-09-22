/**
 * REAL integration test — THE W0 LINCHPIN, end to end, NO MOCKS.
 *
 * This is the whole thesis of the atelier demo with ZERO chat/agent/gateway/Linux:
 *
 *   1. Stand up a REAL headless gardend cell (fresh temp profile).
 *   2. SEED its :ux:config NAMED graph with the MINIMAL one-text-panel config
 *      (minimalTextPanelConfig → serialize → N-Triples → rdf_load).
 *   3. LIVE-READ it back THROUGH the shell-side ShrubberyContract (loadConfigFromCell)
 *      and render it via @shrubbery/runtime → assert the bare ONE-text-panel, NO-chrome
 *      DOM (one <mn-card> in region-center, no <header>/<footer>).
 *   4. OUT-OF-BAND, append the grow-triples (the additive RootEntry delta that puts
 *      region-top-bar into rootRegions) to the SAME :ux:config graph via the SAME
 *      admitted literal rdf_load form the seed uses.
 *   5. RE-READ through the contract (exactly what the EXISTING startPoll(3000) does) →
 *      re-render → assert the NEW <header data-region="region-top-bar"><mn-top-bar>
 *      now appears (it was null before). THE DOM GREW from a pure out-of-band graph
 *      write — no UI action, no second app, no agent.
 *
 * It REQUIRES the real gardend binary (no-mock rule). If the binary cannot be
 * found/spawned this suite FAILS LOUDLY rather than faking a cell — there is no
 * stubbed HTTP and no fake config payload anywhere on this path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import {
  minimalTextPanelConfig,
  grownTextPanelConfig,
  serializeConfigToTriples,
  triplesToNT,
  parseNT,
  parseTriplesToConfig,
  uxConfigGraphIri,
} from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import { loadConfigFromCell, countUxConfigTriples } from '../src/cell/session-store.js'
import { McpError } from '../src/cell/loopback-mcp.js'
import { growDeltaNT } from './grow-delta.js'

/** The bare graph ROOT IRI — a RESERVED authority graph the cell must protect. */
const reservedRootIri = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}`
/** A `:projection:*` IRI — also RESERVED (the materialized read-only plane). */
const reservedProjectionIri = (graphId: string): string =>
  `urn:mnemosyne:local:graph:${graphId}:projection:workspace`

const GRAPH_ID = 'shrubbery-atelier-it'

// The integration test needs the real binary. We let the suite run and FAIL if
// the binary is absent (no-mock rule).
const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

const SEED_NT = triplesToNT(serializeConfigToTriples(minimalTextPanelConfig()))

describe('REAL INTEGRATION — atelier W0: minimal one-text-panel live-read + out-of-band GROW', () => {
  let cell: GardendCell
  let contract: GardendContract

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN, or run the live cell: pnpm gardend:dev`,
      )
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT)
    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
    })
  }, 60000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('the minimal seed body round-trips through parse to the one-text-panel config', () => {
    const config = parseTriplesToConfig(parseNT(SEED_NT))
    expect(config.id).toBe('MinimalTextPanel')
    // region-top-bar is MODELLED but NOT rooted in the seed (present-but-unrendered).
    expect(Object.keys(config.regions).sort()).toEqual(['region-center', 'region-top-bar'])
    expect(config.rootRegions).toEqual(['region-center'])
    expect(config.panels['panel-text'].renderedByComponent).toBe('mn-card')
  })

  it('reads the minimal :ux:config back from the live cell via BOTH read paths', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    expect(read.graphIri).toBe(`urn:mnemosyne:local:graph:${GRAPH_ID}:ux:config`)
    expect(read.tripleCount).toBe(parseNT(SEED_NT).length)
    const sparqlCount = await countUxConfigTriples(contract, GRAPH_ID)
    expect(sparqlCount).toBe(read.tripleCount)
  })

  it('the live config renders the BARE one-text-panel DOM — one <mn-card>, NO chrome', async () => {
    const read = await loadConfigFromCell(contract, GRAPH_ID)
    expect(read.config.rootRegions).toEqual(['region-center'])

    const container = renderWorkspace(read.config)
    const appContainer = container.querySelector('.app-container')!
    expect(appContainer).not.toBeNull()
    expect(appContainer.querySelector('.main')).not.toBeNull()

    // NO chrome: no banner, no footer, no split-panels (single leaf spine).
    expect(appContainer.querySelector('header[data-region="region-top-bar"]')).toBeNull()
    expect(appContainer.querySelector('footer')).toBeNull()
    expect(appContainer.querySelector('sl-split-panel')).toBeNull()

    // Exactly ONE spine pane (region-center) with the real text-panel component.
    const panes = Array.from(appContainer.querySelectorAll('.split-pane[data-region]')).map(el =>
      el.getAttribute('data-region'),
    )
    expect(panes).toEqual(['region-center'])
    expect(appContainer.querySelector('.split-pane[data-region="region-center"] mn-card')).not.toBeNull()
  })

  it('THE GROW: an out-of-band additive rdf_load makes the DOM grow on re-read', async () => {
    // ── BEFORE: the bar is absent (asserted from a fresh live read + render). ──
    const before = await loadConfigFromCell(contract, GRAPH_ID)
    const beforeDom = renderWorkspace(before.config)
    expect(
      beforeDom.querySelector('header[data-region="region-top-bar"] mn-top-bar'),
    ).toBeNull()

    // ── THE OUT-OF-BAND WRITE: append the grow delta (region-top-bar RootEntry) ──
    // SAME admitted literal form the seed uses: rdf_load with a literal
    // targetGraphIri at :ux:config (additive — the cell's load_from_slice never
    // clears the target graph). NOT a variable GRAPH, NOT a CLEAR/DROP.
    const delta = growDeltaNT(minimalTextPanelConfig(), grownTextPanelConfig())
    expect(delta.length).toBeGreaterThan(0) // there IS a delta to write
    await contract.mcp.toolsCall('rdf_load', {
      graphId: GRAPH_ID,
      data: delta,
      format: 'application/n-triples',
      targetGraphIri: uxConfigGraphIri(GRAPH_ID),
    })

    // ── THE RE-READ: exactly what startPoll(3000)'s refresh() does — re-dump the
    //    now-larger graph, re-parse, re-plan, re-render. (We call it directly; the
    //    live browser/dev path drives the same loadConfigFromCell on the timer.) ──
    const after = await loadConfigFromCell(contract, GRAPH_ID)

    // The graph grew (the delta triples were appended).
    expect(after.tripleCount).toBe(before.tripleCount + parseNT(delta).length)
    // region-top-bar is now ROOTED (parseTriplesToConfig rebuilt rootRegions from
    // the now-two RootEntry nodes).
    expect([...after.config.rootRegions].sort()).toEqual(['region-center', 'region-top-bar'])

    // ── AFTER: the DOM GREW — the real registered chrome component now renders. ──
    const afterDom = renderWorkspace(after.config)
    const banner = afterDom.querySelector('header[data-region="region-top-bar"] mn-top-bar')
    expect(banner).not.toBeNull()
    // The one text region is still there (the grow is purely additive).
    expect(afterDom.querySelector('.split-pane[data-region="region-center"] mn-card')).not.toBeNull()
  })

  // ── ADVERSARIAL GATE ────────────────────────────────────────────────────────
  //
  // The grow above succeeds ONLY because it uses the admitted literal-graph form.
  // The cell's authority gate (rdf_authority.rs::validate_sparql_update_authority)
  // must REJECT the dangerous forms — and the rejection must SURFACE (a thrown
  // McpError, never a silent no-op). We drive each rejected form against the SAME
  // live cell and assert (a) it throws, (b) the error message is non-empty (the
  // real cell's validation message, surfaced verbatim), and (c) the :ux:config
  // graph is UNCHANGED — proving nothing slipped past the gate.
  describe('the cell REJECTS dangerous writes and the failure surfaces (not silent)', () => {
    it('rejects CLEAR ALL — destructive, must not silently wipe', async () => {
      const before = await countUxConfigTriples(contract, GRAPH_ID)
      let threw: unknown
      try {
        await contract.rest.update(GRAPH_ID, 'CLEAR ALL')
      } catch (e) {
        threw = e
      }
      expect(threw).toBeInstanceOf(McpError)
      expect((threw as McpError).message.length).toBeGreaterThan(0)
      // The graph is untouched — the rejection was real, not a half-applied write.
      expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
    })

    it('rejects DROP NAMED targeting the reserved graph root', async () => {
      const before = await countUxConfigTriples(contract, GRAPH_ID)
      let threw: unknown
      try {
        await contract.rest.update(GRAPH_ID, `DROP NAMED <${reservedRootIri(GRAPH_ID)}>`)
      } catch (e) {
        threw = e
      }
      expect(threw).toBeInstanceOf(McpError)
      expect((threw as McpError).message.length).toBeGreaterThan(0)
      expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
    })

    it('rejects a VARIABLE GRAPH delete (GRAPH ?g — broad/unscoped)', async () => {
      const before = await countUxConfigTriples(contract, GRAPH_ID)
      let threw: unknown
      try {
        await contract.rest.update(
          GRAPH_ID,
          'DELETE { GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } }',
        )
      } catch (e) {
        threw = e
      }
      expect(threw).toBeInstanceOf(McpError)
      expect((threw as McpError).message.length).toBeGreaterThan(0)
      expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
    })

    it('rejects a VARIABLE WITH update (WITH ?g — broad/unscoped)', async () => {
      const before = await countUxConfigTriples(contract, GRAPH_ID)
      let threw: unknown
      try {
        await contract.rest.update(
          GRAPH_ID,
          'WITH ?g DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }',
        )
      } catch (e) {
        threw = e
      }
      expect(threw).toBeInstanceOf(McpError)
      expect((threw as McpError).message.length).toBeGreaterThan(0)
      expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
    })

    it('rejects an INSERT DATA into a reserved :projection: graph (literal but reserved)', async () => {
      const before = await countUxConfigTriples(contract, GRAPH_ID)
      let threw: unknown
      try {
        await contract.rest.update(
          GRAPH_ID,
          `INSERT DATA { GRAPH <${reservedProjectionIri(GRAPH_ID)}> { <urn:s> <urn:p> <urn:o> } }`,
        )
      } catch (e) {
        threw = e
      }
      expect(threw).toBeInstanceOf(McpError)
      expect((threw as McpError).message.length).toBeGreaterThan(0)
      expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
    })

    it('CONTRAST: the SAME-cell admitted literal :ux:config write still SUCCEEDS', async () => {
      // The gate is not blanket-deny: an INSERT DATA into the literal, non-reserved
      // :ux:config graph (a no-op idempotent triple already present from the grow)
      // is ADMITTED — proving the rejections above are targeted, not a dead cell.
      await expect(
        contract.rest.update(
          GRAPH_ID,
          `INSERT DATA { GRAPH <${uxConfigGraphIri(GRAPH_ID)}> { ` +
            `<urn:atelier:adversarial-probe> <urn:atelier:p> "ok" } }`,
        ),
      ).resolves.toBeUndefined()
    })
  })

  it('the contract reports runtime mode "local" and is authenticated', () => {
    expect(contract.runtime.mode()).toBe('local')
    expect(contract.runtime.isGateway()).toBe(false)
    expect(contract.auth.isAuthenticated()).toBe(true)
    expect(contract.auth.token()).toBe(cell.token)
  })
})
