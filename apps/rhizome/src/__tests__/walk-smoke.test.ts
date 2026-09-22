/**
 * walk-smoke.test.ts — THE WALK surface end-to-end over the REAL trace files.
 *
 * NO MOCK: drives the SAME data + render path the browser/conneg server use,
 * against the REAL agentic-run JSONL traces at RHIZOME_RUNS_DIR (default
 * lme-bench/out/runs). Three checks (each self-skips honestly if the run file is
 * absent — NO-MOCK, not faked):
 *
 *   (a) DATA — TraceWorld.walk() lists the runs; TraceWorld.trace(<run>) parses
 *       the turns AND surfaces the run_end supersession edge (the supersede moment).
 *   (b) MARKDOWN FACE — renderResource(walk-run, 'hypertext') shows the turns +
 *       the supersede highlight (the curl face an agent reads).
 *   (c) DOM FACE — happy-dom render of <rz-walk> for that run shows the turn cards
 *       and the tool calls (graph_sparql_select, remember_memory).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '../rz-walk.js'
import { renderResource, type Resource } from '@shrubbery/render'
import { TraceWorld, runsDir } from '../trace-world.js'
import { renderWalkRunDomString } from '../render-dom.js'
import { access } from 'node:fs/promises'

// The supersession run named in the grounding.
const RUN_ID = '1781976018654'
const world = new TraceWorld()

let dirOk = false
beforeAll(async () => {
  dirOk = await access(runsDir())
    .then(() => true)
    .catch(() => false)
})

describe('WALK — data layer over the REAL trace files', () => {
  // 60s: walk() parses the REAL corpus at runsDir(), which grows with every bench
  // campaign (845MB / 234 runs as of 2026-07-12) — a fixed 5s budget can't scale
  // with real data.
  it('walk() lists runs; trace(<run>) parses turns + the supersession edge', { timeout: 60_000 }, async (ctx) => {
    if (!dirOk) {
      ctx.skip(`[walk-smoke] runs dir ${runsDir()} absent — skipped (NO MOCK).`)
    }
    const index = await world.walk()
    expect(index.kind).toBe('walk-index')
    expect(index.runs.length).toBeGreaterThan(0)

    const run = await world.trace(RUN_ID)
    if (!run) {
      ctx.skip(`[walk-smoke] run ${RUN_ID} not on disk — skipped (NO MOCK).`)
      return
    }
    // The turns parsed (the ribbon).
    expect(run.turns.length).toBeGreaterThan(0)
    expect(run.question).toContain('5K')
    // The supersession edge is present (the run_end edges → the Plot beds).
    expect(run.supersessionEdges.length).toBeGreaterThan(0)
    const e = run.supersessionEdges[0]
    expect(e.newUrn).toContain(':record:')
    expect(e.oldUrn).toContain(':record:')
    // At least one turn carries the supersede MOMENT (a remember w/ supersedes_ref).
    expect(run.turns.some((t) => t.supersedes)).toBe(true)
    // The tool calls round-trip: a SPARQL select + a remember are present.
    const names = run.turns.flatMap((t) => t.toolCalls.map((c) => c.name))
    expect(names).toContain('graph_sparql_select')
    expect(names).toContain('remember_memory')
    // The 25:50 answer made it into the final answer.
    expect(run.finalAnswer).toContain('25:50')
  })
})

describe('WALK — markdown face shows the turns + the supersede highlight', () => {
  it('renderResource(walk-run, hypertext) shows the turns + "met its past self"', { timeout: 60_000 }, async (ctx) => {
    if (!dirOk) ctx.skip(`[walk-smoke] runs dir ${runsDir()} absent — skipped (NO MOCK).`)
    const run = await world.trace(RUN_ID)
    if (!run) {
      ctx.skip(`[walk-smoke] run ${RUN_ID} not on disk — skipped (NO MOCK).`)
      return
    }
    const md = (
      await renderResource(run as Resource, 'hypertext', {
        baseUrl: 'http://localhost:8791',
        selfPath: `/walk/${RUN_ID}`,
        upPath: '/walk',
        plotPath: '/plot',
      })
    ).body
    expect(md).toContain('## Turns')
    expect(md).toContain('graph_sparql_select')
    expect(md).toContain('remember_memory')
    expect(md).toContain('met its past self') // the supersede highlight
    expect(md).toContain('## Supersessions') // the run_end edges → the Plot beds
  })
})

describe('WALK — DOM face (happy-dom) renders the turn cards + tool calls', () => {
  it('rz-walk for the run shows turn cards + graph_sparql_select / remember_memory', { timeout: 60_000 }, async (ctx) => {
    if (!dirOk) ctx.skip(`[walk-smoke] runs dir ${runsDir()} absent — skipped (NO MOCK).`)
    const run = await world.trace(RUN_ID)
    if (!run) {
      ctx.skip(`[walk-smoke] run ${RUN_ID} not on disk — skipped (NO MOCK).`)
      return
    }
    const html = await renderWalkRunDomString(run)
    // The ribbon + per-turn cards rendered.
    expect(html).toMatch(/data-walk-run/)
    expect(html).toMatch(/data-turn=/)
    // The tool calls appear (the act of observe→think→act).
    expect(html).toContain('graph_sparql_select')
    expect(html).toContain('remember_memory')
    // The supersede moment is highlighted ("met its past self" badge).
    expect(html).toContain('met its past self')
    // The run-level supersession edges rendered (→ the Plot beds).
    expect(html).toMatch(/data-edge/)
  })
})
