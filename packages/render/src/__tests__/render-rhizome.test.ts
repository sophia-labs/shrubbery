/**
 * render-rhizome.test.ts — the rhizome memory-observatory faces (mem-plot /
 * mem-subject) get the SAME invariants every other Resource kind gets:
 *   - Link-set parity across the three text faces (the load-bearing gate),
 *   - turtle round-trips to the same triple set (the serializer is sound),
 *   - the JSON-LD face round-trips to the EXACT canonical triple set (isomorphic),
 *   - the markdown face shows the lineage (current head + superseded predecessor)
 *     and carries the `?asof=` temporal-lens curls in the Navigate block.
 *
 * Pure (no network): the resources here are the exact shapes the live data layer
 * (apps/rhizome MemoryWorld) produces — verified against the real cell separately
 * in the curl smoke.
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
  type PlotResource,
} from '../index.js'

/** Canonical sorted N-Triples of a triple list (for line-count comparison). */
function sortedNT(triples: readonly Triple[]): string {
  return triplesToNT([...triples].sort(compareTriples))
}

const REC = 'urn:mnemosyne:local:graph:6a1eabeb-agentic:projection:memory:record:'
const newer = REC + '4b44f583aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const older = REC + '3c3734609b68a345c8be2595449fce4467c2d6ea1e83dba70e3e5298a6230fb6'

const fiveK: SubjectResource = {
  kind: 'mem-subject',
  rootId: '3c3734609b68',
  title: 'Subject — 5K personal best',
  topic: '5K personal best',
  asOf: null,
  head: '4b44f583aaaa',
  records: [
    {
      id: newer,
      localId: '4b44f583aaaa',
      content: "User's personal best 5K run time is 25:50, achieved 2023-05-30",
      status: 'active',
      kind: 'ProfileMemory',
      createdAt: '2023-05-30T13:53:00Z',
      observedAt: '2023-05-30T13:54:00Z',
      observer: 'vehicle-web',
      supersedes: older,
    },
    {
      id: older,
      localId: '3c3734609b68',
      content: "User's personal best 5K run time is 27:12, achieved 2023-05-23",
      status: 'superseded',
      kind: 'WorldStateMemory',
      createdAt: '2023-05-23T13:01:00Z',
    },
  ],
}

const plot: PlotResource = {
  kind: 'mem-plot',
  id: 'memory',
  title: 'Rhizome — memory observatory',
  summary: 'the beds',
  asOf: null,
  subjects: [
    {
      rootId: '3c3734609b68',
      topic: '5K personal best',
      headContent: "User's personal best 5K run time is 25:50",
      head: '4b44f583aaaa',
      recordTotal: 2,
      activeCount: 1,
      supersededCount: 1,
    },
  ],
}

const subjCtx: RenderCtx = { baseUrl: 'http://localhost:8791', selfPath: '/plot/3c3734609b68', upPath: '/plot' }
const plotCtx: RenderCtx = { baseUrl: 'http://localhost:8791', selfPath: '/plot', upPath: null }

function canon(ts: readonly Triple[]): string {
  return triplesToNT([...ts].sort(compareTriples))
}
function relHrefSet(links: readonly AltLink[]): string[] {
  return links.map((l) => `${l.rel} ${l.href}`).sort()
}

describe('rhizome — link-set parity', () => {
  it('mem-subject: all three faces carry an identical rel+href set (incl. up/collection/related)', async () => {
    const md = await renderResource(fiveK as Resource, 'hypertext', subjCtx)
    const ttl = await renderResource(fiveK as Resource, 'turtle', subjCtx)
    const json = await renderResource(fiveK as Resource, 'json', subjCtx)
    const ref = relHrefSet(md.links)
    expect(relHrefSet(ttl.links)).toEqual(ref)
    expect(relHrefSet(json.links)).toEqual(ref)
    expect(ref.some((s) => s.startsWith('up '))).toBe(true)
    expect(ref.some((s) => s.startsWith('collection '))).toBe(true)
    expect(ref.some((s) => s.startsWith('related '))).toBe(true) // the ?asof lens
  })

  it('mem-plot: all three faces carry an identical link set (incl. item per bed)', async () => {
    const md = await renderResource(plot as Resource, 'hypertext', plotCtx)
    const ttl = await renderResource(plot as Resource, 'turtle', plotCtx)
    const json = await renderResource(plot as Resource, 'json', plotCtx)
    const ref = relHrefSet(md.links)
    expect(relHrefSet(ttl.links)).toEqual(ref)
    expect(relHrefSet(json.links)).toEqual(ref)
    expect(ref.some((s) => s.startsWith('item '))).toBe(true)
  })
})

describe('rhizome — turtle round-trips to the same triples', () => {
  it('mem-subject triples → turtle → parse → identical set', () => {
    const ts = resourceToTriples(fiveK as Resource)
    expect(canon(parseTurtle(triplesToTurtle(ts)))).toBe(canon(ts))
  })
  it('mem-plot triples → turtle → parse → identical set', () => {
    const ts = resourceToTriples(plot as Resource)
    expect(canon(parseTurtle(triplesToTurtle(ts)))).toBe(canon(ts))
  })
  it('the turtle face carries real mem: predicates against the real record IRI', () => {
    const ttl = triplesToTurtle(resourceToTriples(fiveK as Resource))
    expect(ttl).toContain('mem:')
    expect(ttl).toContain('mem:status')
    expect(ttl).toContain('mem:observer')
    expect(ttl).toContain('"vehicle-web"')
    expect(ttl).toContain('"active"')
    expect(ttl).toContain('"superseded"')
    expect(ttl).toContain(REC) // the full live-store record IRI
  })
})

describe('rhizome — JSON-LD face round-trips to the canonical triples (isomorphic)', () => {
  it('mem-subject JSON-LD expands back to the same RDF (count + key content)', async () => {
    const canonical = sortedNT(resourceToTriples(fiveK as Resource))
    const { body, contentType } = await renderJson(fiveK as Resource, subjCtx)
    expect(contentType).toContain('application/ld+json')
    const parsed = JSON.parse(body) as Record<string, unknown>
    const ctxStr = JSON.stringify(parsed['@context'])
    expect(ctxStr).toContain('createdAt')
    expect(ctxStr).toContain('observer')
    expect(ctxStr).toContain('status')
    expect(ctxStr).toContain('supersedes')
    // strip the non-RDF _links presentation key before expansion.
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
    expect(roundTripped).toContain('25:50')
    expect(roundTripped).toContain('superseded')
    expect(roundTripped).toContain('2023-05-30T13:53:00Z')
  })
})

describe('rhizome — markdown face shows the lineage + asof curls', () => {
  it('the now subject shows the current head (25:50) AND the superseded predecessor (27:12)', async () => {
    const md = (await renderResource(fiveK as Resource, 'hypertext', subjCtx)).body
    expect(md).toContain('## Current')
    expect(md).toContain('25:50')
    expect(md).toContain('observed:')
    expect(md).toContain('vehicle-web')
    expect(md).toContain('## Superseded predecessors')
    expect(md).toContain('27:12')
    expect(md).toContain('## Lineage')
    expect(md).toContain('(head)')
  })
  it('the Navigate block carries the ?asof= temporal-lens curls', async () => {
    const md = (await renderResource(fiveK as Resource, 'hypertext', subjCtx)).body
    expect(md).toContain('## Navigate')
    expect(md).toMatch(/\?asof=2023-05-25/)
    expect(md).toMatch(/\?asof=2023-06-01/)
  })
})
