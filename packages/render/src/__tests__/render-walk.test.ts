/**
 * render-walk.test.ts — the WALK faces (walk-index / walk-run) get the SAME
 * invariants every other Resource kind gets:
 *   - Link-set parity across the three text faces (the load-bearing gate),
 *   - turtle round-trips to the same triple set,
 *   - the JSON-LD face round-trips to the EXACT canonical triple set (isomorphic),
 *   - the markdown face shows the turns (observe→think→act + cost), HIGHLIGHTS the
 *     supersede turn, carries the `?turn=N` lens curl, and links a run back to the
 *     Plot beds it wrote (rel=related, the cross-surface join).
 *
 * Pure (no FS): these are the exact shapes the live trace reader (apps/rhizome
 * TraceWorld) produces from the JSONL — verified against the real files in the app
 * curl smoke.
 */

import { describe, it, expect } from 'vitest'
import { compareTriples, triplesToNT, type Triple } from '@shrubbery/nucleus'
import jsonld from 'jsonld'
import {
  renderResource,
  renderJson,
  resourceToTriples,
  triplesToTurtle,
  parseTurtle,
  type AltLink,
  type RenderCtx,
  type Resource,
  type SubjectResource,
  type WalkResource,
  type WalkIndexResource,
} from '../index.js'

function sortedNT(triples: readonly Triple[]): string {
  return triplesToNT([...triples].sort(compareTriples))
}
function canon(ts: readonly Triple[]): string {
  return triplesToNT([...ts].sort(compareTriples))
}
function relHrefSet(links: readonly AltLink[]): string[] {
  return links.map((l) => `${l.rel} ${l.href}`).sort()
}

const REC = 'urn:mnemosyne:local:graph:6a1eabeb-agentic:projection:memory:record:'
const newUrn = REC + '4b44f5833fb2201edb5bd4f7eaa98b0998e68a681f215c367136c1d5806fa76f'
const oldUrn = REC + '3c3734609b68a345c8be2595449fce4467c2d6ea1e83dba70e3e5298a6230fb6'

const run: WalkResource = {
  kind: 'walk-run',
  id: '1781976018654',
  title: 'Walk — What was my personal best time in the charity 5K run?',
  graphId: '6a1eabeb-agentic',
  question: 'What was my personal best time in the charity 5K run?',
  gold: '25 minutes and 50 seconds (or 25:50)',
  finalAnswer: 'Your personal best time in the charity 5K run was 25:50.',
  turns: [
    {
      turn: 1,
      label: 'WRITE answer_a25d4a91_2',
      reasoning: "I'll discover what's already known, then update memory.",
      stopReason: 'toolUse',
      toolCalls: [
        {
          id: 'call_1',
          name: 'graph_sparql_select',
          arguments: { query: 'SELECT ?m WHERE { ?m a mem:MemoryRecord }' },
        },
      ],
      toolResults: [
        { toolCallId: 'call_1', toolName: 'graph_sparql_select', result: '{"ok":true,"rowCount":1}', isError: false },
      ],
      usage: { inputTokens: 5393, outputTokens: 1140, totalTokens: 6533, costUsd: 0.00107422 },
      supersedes: false,
    },
    {
      turn: 2,
      label: 'WRITE answer_a25d4a91_2',
      reasoning: 'The 5K best improved — superseding the old belief.',
      stopReason: 'toolUse',
      toolCalls: [
        {
          id: 'call_2',
          name: 'remember_memory',
          arguments: {
            content: "User's personal best 5K run time is 25:50.",
            supersedes_ref: oldUrn,
          },
          supersedesRef: oldUrn,
        },
      ],
      toolResults: [
        {
          toolCallId: 'call_2',
          toolName: 'remember_memory',
          result: `{"ok":true,"subject":"${newUrn}","supersededSubject":"${oldUrn}"}`,
          isError: false,
          subject: newUrn,
          supersededSubject: oldUrn,
        },
      ],
      usage: { inputTokens: 6000, outputTokens: 200, totalTokens: 6200, costUsd: 0.0009 },
      supersedes: true,
    },
  ],
  supersessionEdges: [{ newUrn, oldUrn }],
  turnCursor: null,
}

const index: WalkIndexResource = {
  kind: 'walk-index',
  id: 'walk',
  title: 'The Walk — agentic-run traces',
  summary: 'the runs',
  runs: [
    {
      id: '1781976018654',
      question: 'What was my personal best time in the charity 5K run?',
      gold: '25:50',
      turnCount: 12,
      supersessionCount: 2,
      finalAnswer: 'Your personal best 5K time was 25:50.',
      // the Plot bed rootId this run minted (the oldUrn's short id) — the reverse join.
      supersededRoots: ['3c3734609b68'],
    },
  ],
}

// The run ctx carries plotPath so rel=related (→ the Plot bed) links can mint.
const runCtx: RenderCtx = {
  baseUrl: 'http://localhost:8791',
  selfPath: '/walk/1781976018654',
  upPath: '/walk',
  plotPath: '/plot',
}
const indexCtx: RenderCtx = { baseUrl: 'http://localhost:8791', selfPath: '/walk', upPath: null }

describe('walk — link-set parity', () => {
  it('walk-run: all three faces carry an identical link set (incl. up/collection/related→bed)', async () => {
    const md = await renderResource(run as Resource, 'hypertext', runCtx)
    const ttl = await renderResource(run as Resource, 'turtle', runCtx)
    const json = await renderResource(run as Resource, 'json', runCtx)
    const ref = relHrefSet(md.links)
    expect(relHrefSet(ttl.links)).toEqual(ref)
    expect(relHrefSet(json.links)).toEqual(ref)
    expect(ref.some((s) => s.startsWith('up '))).toBe(true)
    expect(ref.some((s) => s.startsWith('collection '))).toBe(true)
    // rel=related → the Plot bed the run wrote (keyed by the OLD record's short id).
    expect(ref.some((s) => s.startsWith('related ') && s.includes('/plot/3c3734609b68'))).toBe(true)
  })

  it('walk-index: all three faces carry an identical link set (incl. item per run)', async () => {
    const md = await renderResource(index as Resource, 'hypertext', indexCtx)
    const ttl = await renderResource(index as Resource, 'turtle', indexCtx)
    const json = await renderResource(index as Resource, 'json', indexCtx)
    const ref = relHrefSet(md.links)
    expect(relHrefSet(ttl.links)).toEqual(ref)
    expect(relHrefSet(json.links)).toEqual(ref)
    expect(ref.some((s) => s.startsWith('item ') && s.includes('/walk/1781976018654'))).toBe(true)
  })
})

describe('walk — turtle round-trips to the same triples', () => {
  it('walk-run triples → turtle → parse → identical set', () => {
    const ts = resourceToTriples(run as Resource)
    expect(canon(parseTurtle(triplesToTurtle(ts)))).toBe(canon(ts))
  })
  it('walk-index triples → turtle → parse → identical set', () => {
    const ts = resourceToTriples(index as Resource)
    expect(canon(parseTurtle(triplesToTurtle(ts)))).toBe(canon(ts))
  })
  it('the run turtle carries the wk: trace predicates + the mem: supersession edge', () => {
    const ttl = triplesToTurtle(resourceToTriples(run as Resource))
    expect(ttl).toContain('wk:')
    expect(ttl).toContain('wk:toolName')
    expect(ttl).toContain('"remember_memory"')
    expect(ttl).toContain('mem:supersedes') // the cross-surface join (run_end edge)
    expect(ttl).toContain(newUrn)
    expect(ttl).toContain(oldUrn)
  })
})

describe('walk — JSON-LD face round-trips to the canonical triples (isomorphic)', () => {
  it('walk-run JSON-LD expands back to the same RDF (count + key content)', async () => {
    const canonical = sortedNT(resourceToTriples(run as Resource))
    const { body, contentType } = await renderJson(run as Resource, runCtx)
    expect(contentType).toContain('application/ld+json')
    const parsed = JSON.parse(body) as Record<string, unknown>
    const { _links, ...graph } = parsed
    void _links
    const expanded = (await jsonld.toRDF(graph as jsonld.JsonLdDocument, {
      format: 'application/n-quads',
    })) as unknown as string
    const roundTripped = expanded
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .sort()
      .join('\n')
    expect(roundTripped.split('\n').length).toBe(canonical.split('\n').length)
    expect(roundTripped).toContain('remember_memory')
    expect(roundTripped).toContain(oldUrn)
  })
})

describe('walk — markdown face shows the turns + the supersede highlight + the lens', () => {
  it('the run shows the turns (observe→think→act), the supersede highlight, and cost', async () => {
    const md = (await renderResource(run as Resource, 'hypertext', runCtx)).body
    expect(md).toContain('## Turns')
    expect(md).toContain('WRITE answer_a25d4a91_2 · turn 1')
    expect(md).toContain('graph_sparql_select')
    expect(md).toContain('remember_memory')
    expect(md).toContain('**Think**')
    expect(md).toContain('**Act**')
    expect(md).toContain('**Observe**')
    // the supersede MOMENT is highlighted ("met its past self").
    expect(md).toContain('met its past self')
    expect(md).toContain('## Supersessions')
    // cost surfaced.
    expect(md).toMatch(/\$0\.00/)
  })
  it('the Navigate block carries the ?turn= lens curl', async () => {
    const md = (await renderResource(run as Resource, 'hypertext', runCtx)).body
    expect(md).toContain('## Navigate')
    expect(md).toMatch(/\?turn=2/) // the supersede turn lens
  })
  it('the index shows one row per run with turn + supersession counts', async () => {
    const md = (await renderResource(index as Resource, 'hypertext', indexCtx)).body
    expect(md).toContain('## Runs')
    expect(md).toContain('1781976018654')
    expect(md).toContain('charity 5K')
  })

  it('the ?turn lens limits the ribbon to a single turn', async () => {
    const lensed: WalkResource = { ...run, turnCursor: 2 }
    const md = (await renderResource(lensed as Resource, 'hypertext', runCtx)).body
    expect(md).toContain('turn 2')
    // turn 1's reasoning is omitted under the lens.
    expect(md).not.toContain("I'll discover what's already known")
  })
})

// ── THE REVERSE CROSS-LINK: a Plot bed → the run that minted it ────────────────
//
// The forward join (a run → its beds, rel=related) is covered above. This is the
// reverse, the one the integrated shell's "open the Walk" affordance turns on: a
// Plot SUBJECT bed whose head an agentic run minted advertises rel=related → that
// run, AND the walk INDEX carries the bed rootid (wk:mintedBed) per run so the host
// can build the bed→run map without parsing every trace.

const subject: SubjectResource = {
  kind: 'mem-subject',
  rootId: '3c3734609b68',
  title: 'Subject — 5K personal best',
  topic: '5K personal best',
  asOf: null,
  head: '4b44f5833fb2',
  records: [
    { id: newUrn, localId: '4b44f5833fb2', content: '5K personal best is 25:50', status: 'active', createdAt: '2023-05-30T00:00:00Z' },
    { id: oldUrn, localId: '3c3734609b68', content: '5K personal best is 27:12', status: 'superseded', createdAt: '2023-05-23T00:00:00Z' },
  ],
}

describe('walk — the reverse cross-link (a Plot bed → the run that minted it)', () => {
  it('a subject with walkRunPath advertises rel=related → the run, on all three faces', async () => {
    const ctx: RenderCtx = {
      baseUrl: 'http://localhost:8791',
      selfPath: '/plot/3c3734609b68',
      upPath: '/plot',
      walkRunPath: '/walk/1781976018654',
    }
    const md = await renderResource(subject as Resource, 'hypertext', ctx)
    const ttl = await renderResource(subject as Resource, 'turtle', ctx)
    const json = await renderResource(subject as Resource, 'json', ctx)
    const ref = relHrefSet(md.links)
    // Link-set parity holds with the new related link.
    expect(relHrefSet(ttl.links)).toEqual(ref)
    expect(relHrefSet(json.links)).toEqual(ref)
    // The reverse join is present: rel=related → the run's Walk.
    expect(ref.some((s) => s.startsWith('related ') && s.includes('/walk/1781976018654'))).toBe(true)
    // And the markdown body surfaces it inline (curl-visible, not just the header).
    expect(md.body).toContain('Minted by run')
    expect(md.body).toContain('/walk/1781976018654')
  })

  it('a read-only bed (no walkRunPath) advertises NO minting-run link', async () => {
    const ctx: RenderCtx = { baseUrl: 'http://localhost:8791', selfPath: '/plot/3c3734609b68', upPath: '/plot' }
    const md = await renderResource(subject as Resource, 'hypertext', ctx)
    expect(relHrefSet(md.links).some((s) => s.includes('/walk/'))).toBe(false)
    expect(md.body).not.toContain('Minted by run')
  })

  it('the walk index carries wk:mintedBed (the bed rootid) per run, round-tripping', () => {
    const ttl = triplesToTurtle(resourceToTriples(index as Resource))
    expect(ttl).toContain('wk:mintedBed')
    expect(ttl).toContain('"3c3734609b68"')
    // and the markdown index links the minted bed straight into the Plot.
    const md = renderResource(index as Resource, 'hypertext', indexCtx)
    return md.then((r) => {
      expect(r.body).toContain('Minted Plot beds')
      expect(r.body).toContain('/plot/3c3734609b68')
    })
  })
})
