/**
 * bouquet-smoke.test.ts — THE BOUQUET (constellation reader) render smoke (happy-dom).
 *
 * Vera's standing rule: smoke against real functions + real data (NO MOCK). This
 * drives the SAME render path the browser shell uses — the LIVE :projection:memory
 * of graph `6a1eabeb-agentic` → world.bouquet() → the rich BouquetResource → the
 * lifted <rz-bouquet> constellation reader → deep HTML — and asserts the ergonomics
 * landed:
 *
 *   (P0) the CURRENT head '25:50' is the DOMINANT focal element — it renders in the
 *        focal `.bq-head-content` (the single largest string), annotated current.
 *   (P5) the struck predecessor '27:12' is in the dimmed lineage — a `<s class=
 *        "bq-pred-content">` row, NOT in the focal head.
 *   (P4) a 'why' annotation (the quiet details layer) renders for the head.
 *   (icons) the kind glyphs render as inline <svg>, and NO emoji survives.
 *   (P6 as-of) recomputing as-of 2023-05-25 moves the focal head to '27:12'.
 *
 * Self-SKIPS (not fails) if the cell is unreachable — honoring NO-MOCK without
 * coupling CI to a live cell. Boot it read-only with:
 *   GARDEND_PORT=7090 GARDEND_TOKEN=bench-token \
 *     bash choreograph/scripts/longmemeval/boot-gardend.sh
 */

import { beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '../rz-bouquet.js'
import { GardenClient } from '../garden-client.js'
import { MemoryWorld } from '../memory-world.js'
import { renderBouquetResourceDomString } from '../render-dom.js'

const GRAPH = process.env.RHIZOME_GRAPH ?? '6a1eabeb-agentic'
const ROOT = process.env.RHIZOME_BOUQUET_ROOT ?? '3c3734609b68'
const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token
const world = new MemoryWorld(client, GRAPH)

// The emoji literals that must NEVER survive into the rendered constellation.
const EMOJI = ['☀️', '🌙', '👁', '⚙', '🌱', '⧉', '⌕', '✕', '◆', '🪟', '⟲', '⚠', '🌸']

let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
})

describe('BOUQUET SMOKE — the constellation reader (live cell, rz-bouquet)', () => {
  it('blooms 25:50 as the dominant focal head; keeps 27:12 struck in the lineage', async (ctx) => {
    if (!cellUp) {
      console.warn(`[bouquet-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[bouquet-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    // Live read (now): the rich BouquetResource for the 5K belief.
    const bouquet = await world.bouquet(ROOT, null)
    expect(bouquet, `a bouquet must assemble for bed ${ROOT}`).toBeTruthy()
    expect(bouquet!.currentHead.content, 'the current head is the 25:50 record').toContain('25:50')

    const html = await renderBouquetResourceDomString(bouquet!)

    // (P0) 25:50 is the DOMINANT focal element: it renders in the focal head content
    // (the single largest string), under data-why="current" + data-arrived.
    expect(html).toContain('25:50')
    expect(html, 'the head must render in the focal bq-head-content').toMatch(
      /class="bq-head-content"[^>]*>[^<]*25:50/,
    )
    expect(html, 'the focal head must be annotated current + arrival-armed').toMatch(/data-why="current"/)
    expect(html).toMatch(/data-arrived/)
    // It is the ANSWER eyebrow + the success badge (kind), not a competing element.
    expect(html).toContain('the answer')

    // (P5) 27:12 is the dimmed struck predecessor in the lineage — a <s class=
    // "bq-pred-content"> row, dated, present (never hidden).
    expect(html).toContain('27:12')
    expect(html, 'the predecessor must render struck in the lineage').toMatch(
      /<s class="bq-pred-content">[^<]*27:12/,
    )
    // … and 27:12 is NOT in the focal head (it is not the answer now).
    expect(html).not.toMatch(/class="bq-head-content"[^>]*>[^<]*27:12/)
    // The lineage arm is present (the resolved-conflict zone) with a predecessor row.
    expect(html).toMatch(/data-arm="lineage"/)
    expect(html).toMatch(/data-why="resolved-conflict"/)

    // (P4) a 'why' quiet-layer annotation rendered (the details summary copy).
    expect(html, 'the head carries a why details layer').toMatch(/data-why-detail="current"/)
    expect(html).toContain("why it's here")

    // (icons) the kind glyphs render as inline <svg> (the lucide port, never emoji).
    expect(html, 'kind glyphs render as inline svg').toMatch(/<svg[^>]*class="mn-icon"/)
    for (const e of EMOJI) {
      expect(html.includes(e), `emoji ${e} must be gone from the constellation`).toBe(false)
    }

    // The evidence arm is present (a count handle or an honest absence — both real).
    expect(html).toMatch(/data-arm="evidence"/)
    // The retrieval-reasoning footer (the read-side analog of the Walk's reasoning).
    expect(html).toMatch(/data-retrieval/)
    expect(html).toContain('lineage-head')

    // (P0/P2) READING ORDER + the stable skeleton: the focal head comes FIRST, the
    // lineage below it, the evidence floor last, the reasoning at the very bottom —
    // top-of-order is spent on the answer (the dominant element), so the gist is one
    // fixation. The arms live in fixed zones across reads.
    const iHead = html.indexOf('bq-head-content')
    const iLineage = html.indexOf('data-arm="lineage"')
    const iEvidence = html.indexOf('data-arm="evidence"')
    const iRetrieval = html.indexOf('data-retrieval')
    expect(iHead).toBeGreaterThanOrEqual(0)
    expect(iHead, 'the focal head is top of reading order').toBeLessThan(iLineage)
    expect(iLineage, 'the lineage sits above the evidence floor').toBeLessThan(iEvidence)
    expect(iEvidence, 'the read reasoning is the quiet bottom layer').toBeLessThan(iRetrieval)
  }, 30_000)

  it('as-of 2023-05-25 recomputes the focal head to 27:12 (object constancy lens)', async (ctx) => {
    if (!cellUp) ctx.skip(`[bouquet-smoke] cell at ${client.base} is down (NO MOCK).`)

    const then = await world.bouquet(ROOT, '2023-05-25')
    expect(then, 'the bouquet must assemble as-of 2023-05-25').toBeTruthy()
    // The head RECOMPUTES to 27:12 (created 2023-05-23 ≤ T) — currency from createdAt,
    // NOT the mutated mem:status flag.
    expect(then!.currentHead.content, 'as-of 2023-05-25 the head is the 27:12 record').toContain('27:12')

    const html = await renderBouquetResourceDomString(then!)
    // As-of-then, 27:12 BLOOMS as the focal head; the as-of lens chip is shown.
    expect(html, 'as-of 2023-05-25 the 27:12 head must be the focal head').toMatch(
      /class="bq-head-content"[^>]*>[^<]*27:12/,
    )
    expect(html).toContain('as-of 2023-05-25')
  }, 30_000)
})
