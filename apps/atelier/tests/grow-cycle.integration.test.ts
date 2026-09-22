/**
 * REAL INTEGRATION — the G1 GROW CYCLE end to end, NO MOCKS.
 *
 * Mirrors the W0 linchpin (gardend-liveread.integration.test.ts) but drives the
 * REUSABLE host-side grow() (the READ → catalog-gate → spine-gate → additive-delta
 * → rdf_load → re-read path) instead of a hand-rolled rdf_load. It proves, against
 * a REAL headless gardend cell:
 *
 *   (a) GROW grows the real DOM: grow(add_root_region region-top-bar mn-top-bar)
 *       makes <header data-region="region-top-bar"><mn-top-bar> appear (null before).
 *   (b) ADDITIVITY SUPERSET REGRESSION: the re-read config's RootEntry index→region
 *       mapping is a strict SUPERSET of the seed's — NO existing {id}-root-{idx}
 *       triple changed VALUE (not merely that the triple count grew).
 *   (c) UNKNOWN-COMPONENT verb REJECTED ({ ok:false, gate:'catalog' }) and NOTHING
 *       written (countUxConfigTriples unchanged).
 *   (d) BROKEN-SPINE grow (a 2nd resizable root) REJECTED by the spine gate
 *       ({ ok:false, gate:'spine' }) and NOTHING written.
 *
 * It REQUIRES the real gardend binary (no-mock rule) — FAILS LOUDLY if absent.
 *
 * v1 = ADDITIVE grows only. Mutating-existing grows (resize/relocate via
 * literal-GRAPH DELETE/INSERT) are a LABELED follow-on, not exercised here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import {
  minimalTextPanelConfig,
  serializeConfigToTriples,
  triplesToNT,
  parseNT,
  uxConfigGraphIri,
  type Triple,
  type VerbSpec,
} from '@shrubbery/nucleus'
import { renderWorkspace, grow, type GrowCell } from '@shrubbery/runtime'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import { loadConfigFromCell, countUxConfigTriples } from '../src/cell/session-store.js'

const GRAPH_ID = 'shrubbery-atelier-grow-it'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

const SEED_NT = triplesToNT(serializeConfigToTriples(minimalTextPanelConfig()))

/** Wire the REAL cell + contract into the grow() port (no mocks). */
function realGrowCell(contract: GardendContract): GrowCell {
  return {
    async readConfig(graphId) {
      const read = await loadConfigFromCell(contract, graphId)
      return read.config
    },
    async loadDelta(graphId, nt, targetGraphIri) {
      await contract.mcp.toolsCall('rdf_load', {
        graphId,
        data: nt,
        format: 'application/n-triples',
        targetGraphIri,
      })
    },
  }
}

/** RootEntry index→region map, recovered from the serialized triples of a config. */
function rootEntryIndexMap(triples: readonly Triple[]): Map<number, string> {
  const atIndex = new Map<string, number>() // RootEntry IRI → atIndex
  const rootRegion = new Map<string, string>() // RootEntry IRI → rootRegion IRI
  for (const t of triples) {
    if (t.p.endsWith('#atIndex') && t.o.type === 'literal') atIndex.set(t.s, Number(t.o.value))
    if (t.p.endsWith('#rootRegion') && t.o.type === 'iri') rootRegion.set(t.s, t.o.value)
  }
  const m = new Map<number, string>()
  for (const [re, i] of atIndex) m.set(i, rootRegion.get(re)!)
  return m
}

describe('REAL INTEGRATION — G1 grow cycle: catalog + spine + additive gates over a live cell', () => {
  let cell: GardendCell
  let contract: GardendContract
  let port: GrowCell

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
    port = realGrowCell(contract)
  }, 60000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  // ── (c) + (d): the REJECTING grows run FIRST, while the seed is still pristine,
  //    so "nothing written" is checked against the original seed count. ──────────

  it('(c) an UNKNOWN-component verb is REJECTED by the catalog gate — nothing written', async () => {
    const before = await countUxConfigTriples(contract, GRAPH_ID)
    const spec: VerbSpec = { verb: 'add_root_region', regionId: 'region-evil', component: 'mn-evil' }
    const res = await grow(port, GRAPH_ID, spec)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('catalog')
    expect(res.error).toContain('mn-evil')
    // NOTHING written: the catalog rejection precedes any rdf_load.
    expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
  })

  it('(d) a BROKEN-SPINE grow is REJECTED by the spine gate — nothing written', async () => {
    const before = await countUxConfigTriples(contract, GRAPH_ID)
    // add_region of an UNROOTED region that names NO component and docks NO panel:
    // the catalog gate has nothing to check (no component named) and passes it to
    // the SPINE gate, which rejects it on I5 (no renderedByComponent, and no
    // docksPanel[0] → panel.renderedByComponent). This proves validateConfig is the
    // live spine gate INSIDE grow() and that a broken candidate is never written.
    //
    // (The catalog-admitted union is additive-safe-by-construction — add_root_region
    // forces resizable:false, so a 2nd resizable root I1 break is not even
    // expressible; the I1 spine branch is covered directly in the nucleus unit
    // suite. Here we drive the spine gate through the REAL cycle via the I5 case.)
    const spec: VerbSpec = {
      verb: 'add_region',
      regionId: 'region-orphan',
      placement: { kind: 'unrooted' },
    }
    const res = await grow(port, GRAPH_ID, spec)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.gate).toBe('spine')
    expect(res.error).toContain('I5')
    // NOTHING written: the spine rejection precedes serialize/rdf_load.
    expect(await countUxConfigTriples(contract, GRAPH_ID)).toBe(before)
  })

  // ── (a) + (b): the SUCCESSFUL additive grow. ──────────────────────────────────

  it('(a)+(b) grow(add_root_region region-top-bar mn-top-bar) grows the DOM additively', async () => {
    // BEFORE — the bar is absent in the live DOM, and capture the seed RootEntry map.
    const before = await loadConfigFromCell(contract, GRAPH_ID)
    const beforeDom = renderWorkspace(before.config)
    expect(beforeDom.querySelector('header[data-region="region-top-bar"] mn-top-bar')).toBeNull()
    const seedRootMap = rootEntryIndexMap(serializeConfigToTriples(before.config))
    const beforeCount = before.tripleCount

    // THE GROW — through the reusable cycle.
    const spec: VerbSpec = { verb: 'add_root_region', regionId: 'region-top-bar', component: 'mn-top-bar' }
    const res = await grow(port, GRAPH_ID, spec)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // (a) THE DOM GREW — the real registered chrome component now renders.
    const afterDom = renderWorkspace(res.config)
    expect(afterDom.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
    // The seed text region is still there (additive).
    expect(afterDom.querySelector('.split-pane[data-region="region-center"] mn-card')).not.toBeNull()
    // APPEND-ORDER rooting kept region-center first.
    expect(res.config.rootRegions).toEqual(['region-center', 'region-top-bar'])

    // The graph grew by exactly the delta count (the additive append).
    const reread = await loadConfigFromCell(contract, GRAPH_ID)
    expect(reread.tripleCount).toBe(beforeCount + parseNT(res.delta).length)

    // (b) ADDITIVITY SUPERSET REGRESSION — every seed (index → region) pair is
    //     UNCHANGED in the grown config (no positional RootEntry was overwritten).
    const grownRootMap = rootEntryIndexMap(serializeConfigToTriples(reread.config))
    for (const [idx, region] of seedRootMap) {
      expect(grownRootMap.get(idx), `RootEntry index ${idx} changed value`).toBe(region)
    }
    // And the grown map STRICTLY contains a new index the seed lacked (it grew).
    expect(grownRootMap.size).toBeGreaterThan(seedRootMap.size)
  })
})
