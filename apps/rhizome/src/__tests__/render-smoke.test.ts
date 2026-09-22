/**
 * render-smoke.test.ts — THE RENDER SMOKE against the REAL cell (NO MOCK).
 *
 * Vera's standing rule: smoke against real functions + real data. This test:
 *   1) reads the LIVE :projection:memory of graph `6a1eabeb-agentic` via the SAME
 *      slice-1 data layer (MemoryWorld over the gardend /mcp wire),
 *   2) renders THE PLOT to a DOM string through the SAME render path the browser
 *      shell uses (renderWorkspace + the lifted <rz-observatory> → deep HTML),
 *   3) asserts "25:50" is a BLOOMED head and "27:12" is in the SOIL layer.
 *
 * It self-SKIPS (not fails) if the cell is unreachable — honoring NO-MOCK without
 * coupling CI to a live cell. Boot it read-only with:
 *   GARDEND_PORT=7090 GARDEND_TOKEN=bench-token \
 *     bash choreograph/scripts/longmemeval/boot-gardend.sh
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { GardenClient } from '../garden-client.js'
import { MemoryWorld, projectionMemoryIri, salientTerms } from '../memory-world.js'
import type { MemoryRecord } from '@shrubbery/render'
import { renderBouquetDomString, renderPlotDomString } from '../render-dom.js'

const GRAPH = process.env.RHIZOME_GRAPH ?? '6a1eabeb-agentic'
const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token
const world = new MemoryWorld(client, GRAPH)

let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
})

describe('RENDER SMOKE — THE PLOT for a real cell', () => {
  it('flows a live mem:observer binding through allRecords() into MemoryRecord', async (ctx) => {
    if (!cellUp) {
      console.warn(`[render-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[render-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    const rows = await client.select(
      GRAPH,
      `PREFIX mem: <http://mnemosyne.dev/memory#>
SELECT ?rec ?observer
FROM <${projectionMemoryIri(GRAPH)}>
WHERE {
  ?rec a mem:MemoryRecord ;
       mem:observer ?observer .
}
LIMIT 1`,
    )
    const expected = rows[0]
    if (!expected) {
      console.warn(`[render-smoke] graph ${GRAPH} has no mem:observer triples — skipping observer flow assertion (NO MOCK).`)
      ctx.skip(`[render-smoke] graph ${GRAPH} has no mem:observer triples (NO MOCK).`)
    }

    const record = (await world.allRecords()).find((r) => r.id === expected.rec.value)
    expect(record, 'the observed live record must be present in allRecords()').toBeTruthy()
    expect(record!.observer, 'allRecords() carries the live mem:observer binding').toBe(expected.observer.value)
  }, 30_000)

  it('exercises the live bouquet evidence query path through MemoryWorld', async (ctx) => {
    if (!cellUp) {
      console.warn(`[render-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[render-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    const roots = await world.subjectIds()
    for (const root of roots) {
      const subject = await world.subject(root, null)
      const head = subject?.records.find((r) => r.localId === subject.head)
      if (!head || salientTerms(head.content).length === 0) continue

      const bouquet = await world.bouquet(root, null)
      expect(bouquet, `bouquet must assemble for live bed ${root}`).toBeTruthy()
      expect(bouquet!.evidence, 'evidenceFor() returns the live episodic floor array, empty or populated').toEqual(
        expect.any(Array),
      )
      return
    }

    console.warn(`[render-smoke] graph ${GRAPH} has no heads with salient terms — skipping evidence path assertion (NO MOCK).`)
    ctx.skip(`[render-smoke] graph ${GRAPH} has no heads with salient terms (NO MOCK).`)
  }, 30_000)

  it('blooms 25:50 as the current head and keeps 27:12 in the soil layer', async (ctx) => {
    if (!cellUp) {
      console.warn(`[render-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[render-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    // Live read (now): the resolved plot + each bed's full chain (the soil).
    const plot = await world.plot(null)
    const chains = new Map<string, readonly MemoryRecord[]>()
    for (const s of plot.subjects) {
      const sub = await world.subject(s.rootId, null)
      if (sub) chains.set(s.rootId, sub.records)
    }

    const fiveK = plot.subjects.find((s) => s.headContent.includes('25:50'))
    expect(fiveK, 'a 5K bed with the 25:50 head must be present').toBeTruthy()

    const html = await renderPlotDomString(plot, chains)

    // 25:50 BLOOMS: it must appear inside a `bloom-content` (the prominent head),
    // never struck. Match the exact bloom-content cell that carries it.
    expect(html).toContain('25:50')
    expect(html, 'the 25:50 head must render in a bloom-content (bloomed)').toMatch(
      /class="bloom-content"[^>]*>[^<]*25:50/,
    )

    // 27:12 is in the dimmed SOIL layer: a struck `<s class="soil-content">` inside
    // a `data-soil-record` row — present (never hidden), dated, struck.
    expect(html).toContain('27:12')
    expect(html, 'the 27:12 predecessor must render struck in the soil layer').toMatch(
      /<s class="soil-content">[^<]*27:12/,
    )
    // And it is NOT bloomed (never appears in a bloom-content).
    expect(html).not.toMatch(/class="bloom-content"[^>]*>[^<]*27:12/)
  }, 30_000)
})

describe('RENDER SMOKE — THE BOUQUET + THE SCRUBBER (as-of) for a real cell', () => {
  it('annotates current vs resolved-conflict and recomputes the head as-of T', async (ctx) => {
    if (!cellUp) ctx.skip(`[render-smoke] cell at ${client.base} is down (NO MOCK).`)

    // Find the 5K bed root.
    const nowPlot = await world.plot(null)
    const fiveK = nowPlot.subjects.find((s) => s.headContent.includes('25:50'))
    expect(fiveK).toBeTruthy()
    const root = fiveK!.rootId

    // BOUQUET (now): 25:50 = current, 27:12 = resolved-conflict.
    const subjNow = await world.subject(root, null)
    expect(subjNow).toBeTruthy()
    const bqNow = await renderBouquetDomString(subjNow!)
    expect(bqNow).toContain('25:50')
    expect(bqNow).toContain('27:12')
    expect(bqNow).toMatch(/data-why="current"/)
    expect(bqNow).toMatch(/data-why="resolved-conflict"/)

    // SCRUBBER as-of the OLD world (2023-05-25): the head RECOMPUTES to 27:12
    // (created 2023-05-23 ≤ T) — proving currency comes from createdAt, NOT the
    // mutated mem:status flag (25:50, created 2023-05-30, is "not yet minted").
    const subjThen = await world.subject(root, '2023-05-25')
    expect(subjThen).toBeTruthy()
    const head = subjThen!.records.find((r) => r.localId === subjThen!.head)
    expect(head?.content, 'as-of 2023-05-25 the head must be the 27:12 record').toContain('27:12')

    const plotThen = await world.plot('2023-05-25')
    const chainsThen = new Map<string, readonly MemoryRecord[]>()
    for (const s of plotThen.subjects) {
      const sub = await world.subject(s.rootId, '2023-05-25')
      if (sub) chainsThen.set(s.rootId, sub.records)
    }
    const htmlThen = await renderPlotDomString(plotThen, chainsThen)
    // As-of-then, 27:12 BLOOMS (the old world's current head) — recomputed from
    // createdAt, not the status flag.
    expect(htmlThen, 'as-of 2023-05-25 the 5K head 27:12 must be bloomed').toMatch(
      /class="bloom-content"[^>]*>[^<]*27:12/,
    )
  }, 30_000)
})
