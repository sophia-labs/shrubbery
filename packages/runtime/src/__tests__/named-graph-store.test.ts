/**
 * named-graph-store.test.ts — STANDALONE regression proof that the L2a harness
 * enforces NAMED-GRAPH semantics (the load-bearing property the prior fake lacked).
 *
 * This test does NOT exercise any adapter. It exercises ONLY the harness, to prove
 * the substrate has the one property that makes the adapter tests meaningful:
 *
 *   - a SELECT WITHOUT a GRAPH clause returns ZERO rows (data is in the named graph,
 *     not the default graph — exactly the cell's verbatim-query semantics); AND
 *   - the SAME SELECT WRAPPED in GRAPH <…:projection:workspace> returns the seeded rows.
 *
 * If this property ever regresses (e.g. someone swaps in a union-default-graph store or
 * a regex fake), THIS test fails first — before any adapter test can be fooled into a
 * false green. The store under test is a REAL Oxigraph engine (the same engine gardend
 * embeds), so the property is intrinsic, not asserted by fiat.
 */

import { describe, it, expect } from 'vitest'
import {
  seedWorkspaceStore,
  queryStore,
  workspaceProjectionGraphIri,
  documentSubject,
} from './named-graph-store.js'

const GRAPH_ID = 'graph-a'
const WS = workspaceProjectionGraphIri(GRAPH_ID)

const DOCS = [
  { id: 'doc-1', title: 'Alpha' },
  { id: 'doc-2', title: 'Beta' },
  { id: 'doc-3' }, // no title — proves the optional dcterms:title path
]

describe('L2a harness — REAL named-graph store (regression proof)', () => {
  it('the workspace projection graph IRI is the cell-canonical name', () => {
    expect(WS).toBe('urn:mnemosyne:local:graph:graph-a:projection:workspace')
  })

  it('a no-GRAPH SELECT returns ZERO rows (data lives in the named graph)', () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    // Deliberately GRAPH-less — this is the mistake the harness must punish.
    const noGraph = queryStore(
      store,
      'SELECT ?s WHERE { ?s a <http://mnemosyne.dev/doc#TipTapDocument> }',
    )
    expect(noGraph.rows).toEqual([])
  })

  it('a GRAPH-scoped SELECT returns exactly the seeded document rows', () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const scoped = queryStore(
      store,
      `SELECT ?s WHERE { GRAPH <${WS}> { ?s a <http://mnemosyne.dev/doc#TipTapDocument> } }`,
    )
    const subjects = scoped.rows.map((r) => r.s).sort()
    expect(subjects).toEqual(
      ['doc-1', 'doc-2', 'doc-3'].map((id) => `<${documentSubject(id)}>`).sort(),
    )
  })

  it('term.to_string() shaping matches the cell (NamedNode → <uri>, Literal → "value")', () => {
    const store = seedWorkspaceStore(GRAPH_ID, DOCS)
    const scoped = queryStore(
      store,
      `SELECT ?s ?t WHERE { GRAPH <${WS}> { ?s <http://purl.org/dc/terms/title> ?t } }`,
    )
    const byTitle = Object.fromEntries(scoped.rows.map((r) => [r.t, r.s]))
    expect(byTitle['"Alpha"']).toBe(`<${documentSubject('doc-1')}>`)
    expect(byTitle['"Beta"']).toBe(`<${documentSubject('doc-2')}>`)
    // doc-3 has no title triple → absent from the title-bearing solution set.
    expect(scoped.rows).toHaveLength(2)
  })

  it('a GRAPH-scoped INSERT lands in the named graph and is visible only GRAPH-scoped', () => {
    const store = seedWorkspaceStore(GRAPH_ID, [])
    store.update(
      `INSERT DATA { GRAPH <${WS}> { <urn:mnemosyne:local:graph:graph-a:wire:w1> a <http://mnemosyne.ai/vocab#Wire> } }`,
    )
    const scoped = queryStore(
      store,
      `SELECT ?w WHERE { GRAPH <${WS}> { ?w a <http://mnemosyne.ai/vocab#Wire> } }`,
    )
    expect(scoped.rows.map((r) => r.w)).toEqual([
      '<urn:mnemosyne:local:graph:graph-a:wire:w1>',
    ])
    const noGraph = queryStore(store, 'SELECT ?w WHERE { ?w a <http://mnemosyne.ai/vocab#Wire> }')
    expect(noGraph.rows).toEqual([])
  })
})
