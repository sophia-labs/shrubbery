import { describe, expect, it } from 'vitest'
import { NamedQueryRegistry, isNamedQueryRef } from '@shrubbery/runtime/layout'
import { buildObservatorySurfaceDocument } from './observatory-surface-document.js'
import { createObservatorySurfaceNamedQueryRegistry } from './observatory-surface-query-catalog.js'

/**
 * The Observatory surface document and its named-query catalogue are a MATCHED
 * PAIR, and nothing in the type system says so: the document stores each query
 * as an opaque `urn:sophia:query:*` ref, and the text lives in the catalogue.
 * Ship the document against a host whose registry lacks the catalogue and every
 * pane renders `resource-unavailable` — no type error, no failing test, no
 * console error that names the cause.
 *
 * That is not hypothetical. On 2026-07-28 the document was seeded as the
 * Observatory graph's `ux:layoutJson` while the workspace surface still built
 * its resolver around an EMPTY sealed registry, and the live canary dashboard
 * came up blank on every tile. The `rawTextPolicy: 'allow-raw'` escape hatch is
 * what made it invisible: the previous layout carried inline SPARQL, so it kept
 * working, and only ref-based layouts broke.
 *
 * These tests pin the pairing itself.
 */
const GRAPH_ID = 'observatory'

const collectQueryIds = (node: unknown, out: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const child of node) collectQueryIds(child, out)
    return out
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.kind === 'query' && typeof record.queryId === 'string') out.push(record.queryId)
    for (const value of Object.values(record)) collectQueryIds(value, out)
  }
  return out
}

describe('observatory surface document ↔ named-query catalogue', () => {
  it('states every query as a named ref, never as inline SPARQL text', () => {
    const queryIds = collectQueryIds(buildObservatorySurfaceDocument(GRAPH_ID))
    expect(queryIds.length).toBeGreaterThan(0)
    // A mix would be worse than either pure form: it renders correctly against a
    // registry-less host for exactly the tiles that happen to be inline, which
    // reads as "mostly working" rather than as a missing catalogue.
    expect(queryIds.filter(id => !isNamedQueryRef(id))).toEqual([])
  })

  it('resolves every one of those refs through the catalogue registry', () => {
    const registry = createObservatorySurfaceNamedQueryRegistry()
    const queryIds = collectQueryIds(buildObservatorySurfaceDocument(GRAPH_ID))
    const unresolved: string[] = []
    for (const id of queryIds) {
      try {
        const text = registry.resolve(id, GRAPH_ID)
        if (!text || text.trim().length === 0) unresolved.push(`${id} (empty)`)
      } catch (error) {
        unresolved.push(`${id} (${(error as Error).message})`)
      }
    }
    expect(unresolved).toEqual([])
  })

  it('resolves to SPARQL that actually reads the Observatory projection graphs', () => {
    // Resolution succeeding is not enough — a ref could resolve to syntactically
    // valid SPARQL that names no graph and therefore returns nothing, which
    // presents as the same empty dashboard this file exists to prevent.
    const registry = createObservatorySurfaceNamedQueryRegistry()
    const queryIds = collectQueryIds(buildObservatorySurfaceDocument(GRAPH_ID))
    const projectionRoot = `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:`
    const graphless = queryIds.filter(id => !registry.resolve(id, GRAPH_ID).includes(projectionRoot))
    expect(graphless).toEqual([])
  })

  it('an EMPTY registry fails every ref — the live failure, reproduced', () => {
    // The negative control. If this ever passes, the refs are being satisfied by
    // something other than the catalogue and the tests above prove nothing.
    const empty = new NamedQueryRegistry()
    empty.seal()
    const queryIds = collectQueryIds(buildObservatorySurfaceDocument(GRAPH_ID))
    const resolvedAnyway = queryIds.filter(id => {
      try {
        empty.resolve(id, GRAPH_ID)
        return true
      } catch {
        return false
      }
    })
    expect(resolvedAnyway).toEqual([])
  })
})
