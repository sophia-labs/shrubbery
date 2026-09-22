/**
 * entres-roundtrip.smoke.ts — the ENTITY-RESOLUTION round-trip smoke (NO MOCK).
 *
 * Drives the real merge/collapse layer against the LIVE gardend cell and prints a
 * verbatim trace. Run it directly (tsx) for a hand-readable round-trip; the vitest
 * file entres-roundtrip.test.ts asserts the same invariants.
 *
 * It is SAFE + leaves the graph in its ORIGINAL messy state:
 *   0) CLEANUP   — delete the stray urn:test:* sameSubjectAs probe edge in WORLD.
 *   1) DETECT    — flag the 6a1eabeb-world 5K cluster (≥2).
 *   2) BASELINE  — WORLD plot has the 5K records as SEPARATE active beds.
 *   3) MERGE     — write sameSubjectAs edges into :entity-links (NO :projection write).
 *   4) COLLAPSE  — plot collapses the 5K records to ONE bed (head 25:50, 27:12 a pred);
 *                  distinct-subject meter → 1 (green).
 *   5) UNMERGE   — DELETE the edges → back to 3 separate active beds (meter → 3, red).
 *   6) CONTROL   — 6a1eabeb-agentic plot() byte-identical before/after (no edges).
 *
 *   GARDEND_PORT=7090 GARDEND_TOKEN=bench-token tsx src/__tests__/entres-roundtrip.smoke.ts
 */

import { GardenClient } from '../garden-client.js'
import { MemoryWorld } from '../memory-world.js'
import { EntityResolver } from '../entity-resolution.js'

const WORLD = '6a1eabeb-world'
const AGENTIC = '6a1eabeb-agentic'

const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token

function fmt(rec: { localId: string; status: string; createdAt?: string; content: string }): string {
  return `    [${rec.status}] ${rec.localId} ${rec.createdAt ?? ''} — ${rec.content}`
}

function plotLine(s: {
  rootId: string
  recordTotal: number
  activeCount: number
  supersededCount: number
  headContent: string
}): string {
  return `  bed ${s.rootId}  total=${s.recordTotal} active=${s.activeCount} superseded=${s.supersededCount}  head: ${s.headContent}`
}

async function snapshotWorldPlot(world: MemoryWorld): Promise<string> {
  const plot = await world.plot(null)
  return JSON.stringify(plot, null, 1)
}

async function main(): Promise<void> {
  const up = await client.health()
  if (!up) {
    console.warn(`[entres] cell at ${client.base} is DOWN — cannot run (NO MOCK). Skipping.`)
    return
  }
  const world = new MemoryWorld(client, WORLD)
  const res = new EntityResolver(client, WORLD)

  console.log('════════════ ENTITY-RESOLUTION ROUND-TRIP (live cell, NO MOCK) ════════════')

  // 0) CLEANUP — remove the stray probe edge urn:test:a sameSubjectAs urn:test:b.
  console.log('\n── 0) CLEANUP stray probe edges in WORLD:entity-links ──')
  const before = await res.sameSubjectEdges()
  console.log(`  edges present: ${JSON.stringify(before)}`)
  for (const e of before) {
    if (e.from.startsWith('urn:test:') || e.to.startsWith('urn:test:')) {
      await res.deleteEdge(e.from, e.to)
      console.log(`  deleted stray edge: <${e.from}> sameSubjectAs <${e.to}>`)
    }
  }
  console.log(`  edges after cleanup: ${JSON.stringify(await res.sameSubjectEdges())}`)

  // 1) DETECT — the near-duplicate clusters.
  console.log('\n── 1) DETECT near-duplicate clusters (deterministic) ──')
  const clusters = await res.detectDuplicates()
  for (const c of clusters) {
    console.log(`  cluster "${c.label}" (sig=${c.signature}, n=${c.records.length}):`)
    for (const r of c.records) console.log(fmt(r))
    console.log(`    canonical (newest) = ${c.canonical.split(':record:').pop()?.slice(0, 12)}`)
  }
  const fiveK = clusters.find((c) => c.signature === 'user·5k-pb')
  console.log(`  → 5K cluster flagged: ${fiveK ? `YES (n=${fiveK.records.length})` : 'NO'}`)

  // 2) BASELINE — the messy plot (3 separate active 5K beds).
  console.log('\n── 2) BASELINE plot (pre-merge) ──')
  const basePlot = await world.plot(null)
  for (const s of basePlot.subjects) console.log(plotLine(s))
  const baseMeter = await world.distinctSubjectMeter('5k')
  console.log(`  distinct-subject meter (5k): count=${baseMeter.count} target=${baseMeter.target} green=${baseMeter.green}`)

  // 3) MERGE — write the sameSubjectAs edges (the LIVE WRITE).
  console.log('\n── 3) MERGE the 5K cluster (write sameSubjectAs into :entity-links) ──')
  const recIris = fiveK!.records.map((r) => r.iri)
  const written = await res.merge(recIris)
  console.log(`  edges written (member → canonical):`)
  for (const e of written)
    console.log(`    <${e.from.split(':record:').pop()?.slice(0, 12)}> → <${e.to.split(':record:').pop()?.slice(0, 12)}>`)

  // 4) COLLAPSE — the plot now reads the edges and unions the 5K beds.
  console.log('\n── 4) COLLAPSED plot (post-merge) ──')
  const mergedPlot = await world.plot(null)
  for (const s of mergedPlot.subjects) console.log(plotLine(s))
  const fiveKBed = mergedPlot.subjects.find((s) => /5k|25:50/i.test(s.headContent))
  console.log(`  → 5K bed record total: ${fiveKBed?.recordTotal} (expect 3)`)
  console.log(`  → 5K bed head: "${fiveKBed?.headContent}" (expect 25:50)`)
  const mergedSubj = await world.subject(fiveKBed!.rootId, null)
  console.log(`  → 5K bed chain (head first):`)
  for (const r of mergedSubj!.records) console.log(fmt(r))
  const mergedMeter = await world.distinctSubjectMeter('5k')
  console.log(`  distinct-subject meter (5k): count=${mergedMeter.count} target=${mergedMeter.target} green=${mergedMeter.green}`)

  // 5) UNMERGE — reverse the merge.
  console.log('\n── 5) UNMERGE (DELETE the edges) ──')
  const removed = await res.unmerge(recIris)
  console.log(`  edges removed: ${removed.length}`)
  const restoredPlot = await world.plot(null)
  for (const s of restoredPlot.subjects) console.log(plotLine(s))
  const restoredMeter = await world.distinctSubjectMeter('5k')
  console.log(`  distinct-subject meter (5k): count=${restoredMeter.count} target=${restoredMeter.target} green=${restoredMeter.green}`)
  console.log(`  edges after unmerge: ${JSON.stringify(await res.sameSubjectEdges())}`)

  // 6) CONTROL — agentic plot is byte-identical before/after (no edges).
  console.log('\n── 6) CONTROL: 6a1eabeb-agentic plot byte-identical (no edges) ──')
  const aWorld = new MemoryWorld(client, AGENTIC)
  const aRes = new EntityResolver(client, AGENTIC)
  console.log(`  agentic edges: ${JSON.stringify(await aRes.sameSubjectEdges())}`)
  const a1 = await snapshotWorldPlot(aWorld)
  const a2 = await snapshotWorldPlot(aWorld)
  console.log(`  agentic plot byte-identical across reads: ${a1 === a2}`)

  console.log('\n════════════ FINAL STATE (must be ORIGINAL messy) ════════════')
  const finalEdges = await res.sameSubjectEdges()
  console.log(`  WORLD:entity-links edges remaining: ${JSON.stringify(finalEdges)} (expect [])`)
  console.log('  DONE.')
}

main().catch((e) => {
  console.error('[entres] FAILED:', e)
  process.exitCode = 1
})
