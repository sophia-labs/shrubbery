/**
 * greenhouse-smoke.test.ts — THE GREENHOUSE render smoke (happy-dom, live cell).
 *
 * Vera's standing rule: smoke against real functions + real data (NO MOCK). This
 * drives the SAME render path the browser shell uses — the LIVE :projection:memory of
 * graph `6a1eabeb-world` (the messy EntRes case) → greenhouse-world (the knobs + the
 * DERIVED meters) → the GreenhouseResource → the lifted <rz-greenhouse> → deep HTML —
 * and asserts the design's ergonomics landed:
 *
 *   (P0) the MARQUEE supersession miss-meter is the focal element + reads RED + names
 *        BOTH offenders verbatim — "27:12 AND 25:50 (user · 5K-PB)".
 *   (§4b) the entity-resolution DISTINCT-SUBJECT meter shows >1 (the fragmentation).
 *   (merge-ghost) a [merge] affordance is planted ("these N look like one user·5K-PB").
 *   (P1) the family common-region zones render (CLIMATE / JUDGMENT / REACH / …).
 *   (icons) the knob glyphs render as inline <svg>, and NO emoji survives.
 *   (P7) a clean knob's meter is a green tick (not an alarm widget).
 *
 * Self-SKIPS (not fails) if the cell is unreachable — honoring NO-MOCK without
 * coupling CI to a live cell. Boot it read-only with:
 *   GARDEND_PORT=7090 GARDEND_TOKEN=bench-token \
 *     bash choreograph/scripts/longmemeval/boot-gardend.sh
 *
 * It is READ-ONLY (the marquee + meters are derived reads) — it does NOT merge, so it
 * leaves WORLD in its original messy state (the demo still shows the problem).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '../rz-greenhouse.js'
import { GardenClient } from '../garden-client.js'
import { GreenhouseWorld } from '../greenhouse-world.js'
import { EntityResolver } from '../entity-resolution.js'
import { renderGreenhouseDomString } from '../render-dom.js'
import type { GhostCluster } from '../greenhouse-views.js'

const GRAPH = process.env.RHIZOME_GREENHOUSE_GRAPH ?? '6a1eabeb-world'
const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token
const world = new GreenhouseWorld(client, GRAPH)
const resolver = new EntityResolver(client, GRAPH)

// The emoji literals that must NEVER survive into the rendered Greenhouse.
const EMOJI = ['☀️', '🌙', '👁', '⚙', '🌱', '⧉', '⌕', '✕', '🪟', '⟲', '🌸', '🌡', '⚖️']

/** Build the ghost clusters the same way the shell does (for the merge-ghost). */
async function ghostsFor(): Promise<GhostCluster[]> {
  const [clusters, edges] = await Promise.all([
    resolver.detectDuplicates(),
    resolver.sameSubjectEdges(),
  ])
  const merged = new Set(edges.map((e) => e.from))
  return clusters.map((c) => ({
    signature: c.signature,
    label: c.label,
    recIris: c.records.map((r) => r.iri),
    n: c.records.length,
    merged: c.records.filter((r) => r.iri !== c.canonical).every((r) => merged.has(r.iri)),
  }))
}

let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
  if (cellUp) {
    // CLEANUP: ensure WORLD is in its messy state (no sameSubjectAs edges) so the
    // marquee + distinct meters read the fragmentation, not a prior merge.
    for (const e of await resolver.sameSubjectEdges()) await resolver.deleteEdge(e.from, e.to)
  }
})

afterAll(async () => {
  // Leave WORLD in its ORIGINAL messy state (no edges) so the live demo still shows
  // the problem — the post-merge test below merges + must always undo itself.
  if (cellUp) for (const e of await resolver.sameSubjectEdges()) await resolver.deleteEdge(e.from, e.to)
})

describe('GREENHOUSE SMOKE — the cultivation knobs (live WORLD, rz-greenhouse)', () => {
  it('renders the marquee miss-meter RED, naming 27:12 AND 25:50 (user · 5K-PB)', async (ctx) => {
    if (!cellUp) {
      console.warn(`[greenhouse-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[greenhouse-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    // Live read (now): the GreenhouseResource for the messy WORLD graph.
    const greenhouse = await world.greenhouse(null)
    expect(greenhouse, 'a greenhouse must assemble').toBeTruthy()

    // The marquee is the focal supersession knob; its meter is RED (both-active leak).
    const focal = greenhouse.knobs.find((k) => k.focal)
    expect(focal, 'a focal marquee knob exists').toBeTruthy()
    expect(focal!.id).toBe('supersession-conservatism')
    expect(focal!.meter.green, 'the marquee meter is RED (under-superseding)').toBe(false)
    expect(focal!.meter.value, 'at least one (entity,attribute) leaks two heads').toBeGreaterThanOrEqual(1)
    const offenderText = focal!.meter.offenders.join(' ')
    expect(offenderText, 'names 27:12').toContain('27:12')
    expect(offenderText, 'names 25:50').toContain('25:50')
    expect(offenderText, 'names the user · 5K-PB subject').toMatch(/5K-PB|5k-pb/)

    const ghosts = await ghostsFor()
    const html = await renderGreenhouseDomString(greenhouse, ghosts)

    // (P0) the marquee renders as the focal danger band, naming BOTH offenders verbatim.
    expect(html, 'the marquee band renders').toMatch(/data-marquee/)
    expect(html, 'the marquee is the focal element').toMatch(/data-focal/)
    expect(html, 'the marquee reads the DANGER state').toMatch(/gh-marquee-danger/)
    expect(html, 'the verdict names UNDER-SUPERSEDING').toContain('UNDER-SUPERSEDING')
    expect(html, 'the offender row names 27:12').toMatch(/data-offender[^>]*>[^<]*27:12/)
    expect(html).toContain('27:12')
    expect(html).toContain('25:50')
    // both PBs named in ONE offender line (verbatim, the proof artifact).
    expect(html, 'both PBs in one both-active offender line').toMatch(/both active:[^<]*27:12[^<]*AND[^<]*25:50|both active:[^<]*25:50[^<]*AND[^<]*27:12/)

    // (§4b) the entity-resolution distinct-subject meter shows >1 (the fragmentation).
    const entRes = greenhouse.knobs.find((k) => k.id === 'entity-resolution')
    expect(entRes, 'the entity-resolution knob exists').toBeTruthy()
    expect(entRes!.meter.value, 'distinct-subjects > target (fragmented)').toBeGreaterThan(entRes!.meter.target)
    expect(entRes!.meter.green, 'the distinct meter is NOT green pre-merge').toBe(false)
    expect(entRes!.writeMode, 'entity-resolution WRITES FOR REAL').toBe('live')
    expect(html, 'the entity-resolution control renders').toMatch(/data-entres/)
    expect(html, 'the distinct-subject meter renders').toMatch(/data-distinct-meter/)

    // (merge-ghost) a [merge] affordance is planted for the 5K cluster.
    expect(html, 'a merge-ghost is planted').toMatch(/data-ghost=/)
    expect(html, 'a merge button is offered').toMatch(/data-merge=/)
    expect(html, 'the ghost names the look-alike count').toMatch(/look like one/)

    // (P1) the family common-region zones render in the stable order.
    expect(html, 'CLIMATE zone').toMatch(/data-family="CLIMATE"/)
    expect(html, 'JUDGMENT zone').toMatch(/data-family="JUDGMENT"/)
    expect(html, 'REACH zone').toMatch(/data-family="REACH"/)
    expect(html, 'LAWS zone').toMatch(/data-family="LAWS"/)
    expect(html, 'METER & SPEND zone').toMatch(/data-family="METER &amp; SPEND"|data-family="METER & SPEND"/)

    // (icons) the knob glyphs render as inline <svg> (the lucide port, never emoji).
    expect(html, 'glyphs render as inline svg').toMatch(/<svg[^>]*class="mn-icon"/)
    // (icons — the load-bearing one) the SVG must carry its LUCIDE PATH CHILDREN, not
    // be an empty <svg> envelope. Under happy-dom (the SSR/curl face) the old `svg`-tag
    // build dropped every child into the SVG foreign namespace → the verdict glyph, the
    // family glyphs, and the git-merge ghost icon ALL rendered empty (the redundant
    // VERDICT GLYPH the P0/A3 design promises silently degraded to colour+text-only).
    // Assert at least one mn-icon svg has a real child element (a <path>/<circle>/…).
    expect(
      html,
      'a focal/verdict glyph svg carries its lucide path children (not an empty envelope)',
    ).toMatch(/<svg[^>]*class="mn-icon"[^>]*>\s*<(?:path|circle|line|rect|polygon|polyline|ellipse)\b/)
    for (const e of EMOJI) {
      expect(html.includes(e), `emoji ${e} must be gone from the Greenhouse`).toBe(false)
    }

    // (P0/P2) reading order: the marquee comes FIRST, the families below it. Match the
    // data-attributes (markup), not the class names (which also appear in the <style>).
    const iMarquee = html.indexOf('data-marquee')
    const iFamilies = html.indexOf('data-families')
    expect(iMarquee).toBeGreaterThanOrEqual(0)
    expect(iFamilies).toBeGreaterThan(0)
    expect(iMarquee, 'the marquee is top of reading order').toBeLessThan(iFamilies)

    // (token discipline) NO hardcoded carmine hex leaked (the danger ROLE tokens carry it).
    expect(html.includes('#fef2f2'), 'no hardcoded danger surface hex').toBe(false)
    expect(html.includes('#991b1b') && !html.includes('var(--mn-color-danger'), 'danger uses role tokens').toBe(false)
  }, 30_000)

  it('AFTER a real merge: the Greenhouse DOM flips the distinct-meter 3→1 (green) + the ghost row offers [unmerge]', async (ctx) => {
    if (!cellUp) {
      console.warn(`[greenhouse-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[greenhouse-smoke] cell at ${client.base} is down (NO MOCK).`)
    }
    // Start clean (the marquee/distinct read the fragmentation), then do the REAL
    // merge and assert the SURFACE reflects the write — the missing end-to-end guard:
    // "the write is proven (entres-roundtrip); the surface's reflection of it is not".
    for (const e of await resolver.sameSubjectEdges()) await resolver.deleteEdge(e.from, e.to)

    // PRE-MERGE: the distinct-subject meter is RED (>1).
    const pre = await world.greenhouse(null)
    const preEntRes = pre.knobs.find((k) => k.id === 'entity-resolution')!
    expect(preEntRes.meter.green, 'distinct meter RED pre-merge').toBe(false)
    expect(preEntRes.meter.value, 'distinct subjects fragmented pre-merge').toBeGreaterThan(1)

    try {
      // THE REAL WRITE — merge the 5K cluster (sameSubjectAs edges into the sidecar).
      const fiveK = (await resolver.detectDuplicates()).find((c) => c.signature === 'user·5k-pb')!
      await resolver.merge(fiveK.records.map((r) => r.iri))

      // POST-MERGE: re-read the Greenhouse + the ghosts (exactly as the shell does).
      const post = await world.greenhouse(null)
      const postEntRes = post.knobs.find((k) => k.id === 'entity-resolution')!
      expect(postEntRes.meter.value, 'distinct meter collapsed to 1').toBe(1)
      expect(postEntRes.meter.green, 'distinct meter GREEN post-merge').toBe(true)

      const ghosts = await ghostsFor()
      const fiveKGhost = ghosts.find((g) => g.signature === 'user·5k-pb')
      expect(fiveKGhost?.merged, 'the 5K ghost reads as merged').toBe(true)

      // RENDER the Greenhouse DOM post-merge and assert the SURFACE reflects the write.
      const html = await renderGreenhouseDomString(post, ghosts)
      // the distinct-meter renders GREEN (the OK tick, value 1).
      expect(html, 'the distinct-subject meter renders').toMatch(/data-distinct-meter/)
      expect(html, 'the distinct-meter reads 1/1').toMatch(/1\/1/)
      // the ghost row flips its affordance to [unmerge].
      expect(html, 'the 5K ghost now offers [unmerge]').toMatch(/data-unmerge=/)
      expect(html, 'the 5K ghost row reads as merged').toMatch(/gh-ghost-merged/)
    } finally {
      // ALWAYS undo — leave WORLD messy (the demo still shows the problem).
      for (const e of await resolver.sameSubjectEdges()) await resolver.deleteEdge(e.from, e.to)
    }
    expect(await resolver.sameSubjectEdges(), 'WORLD restored to messy (no edges)').toHaveLength(0)
  }, 60_000)

  it('a clean knob (LAWS lifecycle) is a quiet green tick, not an alarm', async (ctx) => {
    if (!cellUp) {
      console.warn(`[greenhouse-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[greenhouse-smoke] cell at ${client.base} is down (NO MOCK).`)
    }
    const greenhouse = await world.greenhouse(null)
    const laws = greenhouse.knobs.find((k) => k.id === 'lifecycle')
    expect(laws, 'the lifecycle knob exists').toBeTruthy()
    expect(laws!.meter.green, 'the laws meter is clean (P7)').toBe(true)
    expect(laws!.writeMode, 'the laws are read-only by design').toBe('read-only')
    // the legend renders its five world-model classes.
    expect(laws!.laws.map((l) => l.kind)).toEqual(['Entity', 'Event', 'State', 'Relation', 'Disposition'])
  }, 30_000)
})
