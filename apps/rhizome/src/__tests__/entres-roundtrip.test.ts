/**
 * entres-roundtrip.test.ts — the ENTITY-RESOLUTION merge/collapse round-trip smoke
 * against the REAL gardend cell (NO MOCK — Vera's standing rule).
 *
 * The LIVE-WRITE centerpiece, exercised end-to-end on the demo graphs:
 *   6a1eabeb-world   — the messy EntRes case (3 separate active 5K beds).
 *   6a1eabeb-agentic — the clean control (one bed, 25:50 active / 27:12 superseded).
 *
 * The test is SAFE + self-cleaning: it CLEANS the stray probe edge first, runs the
 * merge → collapse → unmerge round-trip, and ALWAYS leaves WORLD:entity-links EMPTY
 * (the original messy state, so the demo still shows the problem). It self-SKIPS
 * (not fails) when the cell is down. Boot it read/write with:
 *   GARDEND_PORT=7090 GARDEND_TOKEN=bench-token \
 *     bash choreograph/scripts/longmemeval/boot-gardend.sh
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GardenClient } from '../garden-client.js'
import { MemoryWorld } from '../memory-world.js'
import { EntityResolver } from '../entity-resolution.js'

const WORLD = process.env.RHIZOME_WORLD ?? '6a1eabeb-world'
const AGENTIC = process.env.RHIZOME_AGENTIC ?? '6a1eabeb-agentic'

const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token
const world = new MemoryWorld(client, WORLD)
const res = new EntityResolver(client, WORLD)

let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
  if (cellUp) {
    // CLEANUP: remove ANY pre-existing edge so the round-trip starts clean.
    for (const e of await res.sameSubjectEdges()) await res.deleteEdge(e.from, e.to)
  }
})

afterAll(async () => {
  // Leave WORLD in its ORIGINAL messy state: no sameSubjectAs edges.
  if (cellUp) for (const e of await res.sameSubjectEdges()) await res.deleteEdge(e.from, e.to)
})

describe('ENTITY RESOLUTION — detect → merge → collapse → unmerge (live WORLD)', () => {
  it('cleans the stray probe edge', async (ctx) => {
    if (!cellUp) ctx.skip(`[entres-roundtrip] cell down — skipped (NO MOCK).`)
    const edges = await res.sameSubjectEdges()
    expect(edges, 'no stray edges after cleanup').toHaveLength(0)
  }, 30_000)

  it('DETECT flags the 5K cluster (≥2)', async (ctx) => {
    if (!cellUp) ctx.skip(`[entres-roundtrip] cell down — skipped (NO MOCK).`)
    const clusters = await res.detectDuplicates()
    const fiveK = clusters.find((c) => c.signature === 'user·5k-pb')
    expect(fiveK, 'the 5K cluster must be flagged').toBeTruthy()
    expect(fiveK!.records.length).toBeGreaterThanOrEqual(2)
    // the canonical (merge head) is the newest concrete-value record: 25:50.
    const canon = fiveK!.records.find((r) => r.iri === fiveK!.canonical)
    expect(canon?.content).toContain('25:50')
  }, 30_000)

  it('MERGE collapses the 5K records to ONE bed; UNMERGE restores 3', async (ctx) => {
    if (!cellUp) ctx.skip(`[entres-roundtrip] cell down — skipped (NO MOCK).`)

    // BASELINE — 3 separate active beds, distinct-subject meter is RED (3).
    const basePlot = await world.plot(null)
    const baseFiveKRows = basePlot.subjects.filter((s) => /5k|25:50|27:12/i.test(s.headContent))
    expect(baseFiveKRows.length, '5K is fragmented across ≥2 beds pre-merge').toBeGreaterThanOrEqual(2)
    const baseMeter = await world.distinctSubjectMeter('5k')
    expect(baseMeter.count).toBeGreaterThanOrEqual(2)
    expect(baseMeter.green).toBe(false)

    // MERGE — write sameSubjectAs into the :entity-links sidecar (NO :projection write).
    const fiveK = (await res.detectDuplicates()).find((c) => c.signature === 'user·5k-pb')!
    const recIris = fiveK.records.map((r) => r.iri)
    const written = await res.merge(recIris)
    expect(written.length, 'edges written = members minus canonical').toBe(recIris.length - 1)

    // COLLAPSE — the plot reads the edges and unions the 5K beds into ONE.
    const mergedPlot = await world.plot(null)
    const fiveKBed = mergedPlot.subjects.find((s) => /25:50/i.test(s.headContent))
    expect(fiveKBed, 'a single collapsed 5K bed headed by 25:50').toBeTruthy()
    expect(fiveKBed!.recordTotal).toBe(recIris.length) // 3
    expect(fiveKBed!.headContent, 'head is the newest concrete value 25:50').toContain('25:50')

    // the chain: head 25:50 first, 27:12 a predecessor (not the head).
    const subj = await world.subject(fiveKBed!.rootId, null)
    expect(subj!.records[0].content, 'head record first').toContain('25:50')
    const headRec = subj!.records.find((r) => r.localId === subj!.head)
    expect(headRec!.content).toContain('25:50')
    const pred = subj!.records.find((r) => r.content.includes('27:12'))
    expect(pred, '27:12 is in the collapsed bed').toBeTruthy()
    expect(pred!.localId, '27:12 is NOT the head — a predecessor').not.toBe(subj!.head)

    // distinct-subject meter → 1 (GREEN).
    const mergedMeter = await world.distinctSubjectMeter('5k')
    expect(mergedMeter.count).toBe(1)
    expect(mergedMeter.green).toBe(true)

    // 5K beds collapsed from N → 1 (the fragmentation healed).
    const mergedFiveKRows = mergedPlot.subjects.filter((s) => /5k|25:50|27:12/i.test(s.headContent))
    expect(mergedFiveKRows.length).toBe(1)

    // UNMERGE — DELETE the edges → back to N separate active beds.
    const removed = await res.unmerge(recIris)
    expect(removed.length).toBe(written.length)
    const restoredMeter = await world.distinctSubjectMeter('5k')
    expect(restoredMeter.count).toBe(baseMeter.count)
    expect(restoredMeter.green).toBe(false)
    expect(await res.sameSubjectEdges(), 'sidecar empty after unmerge').toHaveLength(0)
  }, 60_000)
})

describe('ENTITY RESOLUTION — control: 6a1eabeb-agentic is unchanged (no edges)', () => {
  it('plot() is byte-identical before/after; the supersede bed is intact', async (ctx) => {
    if (!cellUp) ctx.skip(`[entres-roundtrip] cell down — skipped (NO MOCK).`)
    const aWorld = new MemoryWorld(client, AGENTIC)
    const aRes = new EntityResolver(client, AGENTIC)
    expect(await aRes.sameSubjectEdges(), 'control has NO entity-links').toHaveLength(0)

    const a1 = JSON.stringify(await aWorld.plot(null))
    const a2 = JSON.stringify(await aWorld.plot(null))
    expect(a1, 'agentic plot byte-identical across reads (no-op collapse)').toBe(a2)

    // the genuine supersede chain remains ONE bed (25:50 active / 27:12 superseded).
    const plot = await aWorld.plot(null)
    const bed = plot.subjects.find((s) => s.headContent.includes('25:50'))
    expect(bed, 'agentic 5K supersede bed present').toBeTruthy()
    expect(bed!.activeCount).toBe(1)
    expect(bed!.supersededCount).toBe(1)
    expect(bed!.recordTotal).toBe(2)
  }, 30_000)
})
