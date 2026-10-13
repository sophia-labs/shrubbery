/**
 * A cell-shaped MCP caller over a REAL SPARQL engine (Oxigraph, the same
 * engine gardend embeds). `sparql_query` returns the gardend envelope
 * (`{ rows: [{ var: term.toString() }] }` — gardend serializes terms with the
 * same Oxigraph `to_string`), `sparql_update` executes for real, and
 * `tools/list` returns descriptors shaped exactly like gardend's
 * (`_meta["sophia.local.requiredScopes"]`), with scopes copied from
 * garden/parity/local-loopback-surface.json.
 */
import { Store } from 'oxigraph'

export interface CellCall {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

function tool(name: string, scopes: readonly string[], description = `${name} tool`): Record<string, unknown> {
  return {
    name,
    description,
    inputSchema: { type: 'object' },
    _meta: {
      'sophia.local.requiredScopes': scopes,
      'sophia.local.scopeMode': 'all',
      'sophia.local.requiredScopeMode': 'all',
    },
  }
}

/** A slice of the live gardend catalogue (real names, real scopes). */
export const CELL_TOOLS: readonly Record<string, unknown>[] = [
  tool('list_graphs', ['graphs.read']),
  tool('read_document', ['documents.read']),
  tool('get_workspace', ['documents.read']),
  tool('write_document', ['documents.write.crdt']),
  tool('sparql_query', ['rdf.query']),
  tool('sparql_update', ['rdf.update']),
  tool('rdf_dump', ['rdf.dump']),
  tool('semantic_search', ['search.semantic.read']),
  tool('search_documents', ['search.lexical.read']),
  tool('recall', ['memory.read']),
  tool('remember', ['memory.write']),
  tool('delete', ['documents.delete.crdt', 'workspace.delete.crdt', 'wires.delete', 'graphs.delete']),
  tool('query_graph', ['rdf.query', 'jobs.read']),
]

export class OxigraphMcpCell {
  readonly store = new Store()
  readonly calls: CellCall[] = []
  /** When set, the next sparql_query answer carries this cell warning. */
  warning: string | null = null

  constructor(private readonly tools: readonly Record<string, unknown>[] = CELL_TOOLS) {}

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push({ name, args })
    if (name === 'sparql_query') {
      const result = this.store.query(String(args.query))
      if (!Array.isArray(result)) throw new Error('sparql_query: only SELECT is used by the modes surface')
      const rows = (result as Map<string, { toString(): string }>[]).map(binding =>
        Object.fromEntries([...binding.entries()].map(([key, term]) => [key, term.toString()])))
      const warning = this.warning
      this.warning = null
      return warning ? { rows, warnings: [warning] } : { rows }
    }
    if (name === 'sparql_update') {
      this.store.update(String(args.update))
      return { ok: true }
    }
    throw new Error(`OxigraphMcpCell: tool '${name}' is not served`)
  }

  async toolsList(): Promise<readonly Record<string, unknown>[]> {
    this.calls.push({ name: 'tools/list', args: {} })
    return this.tools
  }

  /** Every triple in one named graph, as sorted N-Triples-ish lines. */
  triples(graphIri: string): string[] {
    return this.store
      .match(null, null, null, null)
      .filter(quad => quad.graph.value === graphIri)
      .map(quad => `${quad.subject.toString()} ${quad.predicate.toString()} ${quad.object.toString()}`)
      .sort()
  }
}
