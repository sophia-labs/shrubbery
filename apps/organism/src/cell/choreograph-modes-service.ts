/**
 * ChoreographModesService — the Choreograph modes surface's port over the
 * active graph's MCP.
 *
 * Reads: `tools/list` (the live catalogue, effect class from
 * `_meta["sophia.local.requiredScopes"]`) and `sparql_query` (always
 * `GRAPH ?g`-wrapped and explicitly paged — cells clamp result sizes
 * silently). Writes: `sparql_update` into the graph's user named graph
 * `urn:mnemosyne:local:graph:{graphId}:user:rdf`, the exact triples
 * Choreograph's enforcement reads (see `choreo-modes-model` in
 * @shrubbery/components for the contract and the SPARQL text).
 *
 * Both cell contracts reach this through `contract.rawMcp`: the hosted one
 * POSTs to the gateway `/o/{owner}/g/{graph}/mcp`, the local one to the
 * gardend loopback `/mcp`.
 */
import {
  type ChoreoModeDraft,
  type ChoreoModesPort,
  type ChoreoModesSnapshot,
  type ChoreoToolDescriptor,
  type SparqlRow,
  agentModesUpdate,
  agentsFromRows,
  agentsQuery,
  assignmentsQuery,
  describeTools,
  imageTransformQuery,
  isValidGraphId,
  modeDeleteUpdate,
  modeIri,
  modeSaveUpdate,
  modesFromRows,
  modesQuery,
  termValue,
  validateModeDraft,
} from '@shrubbery/components'

export interface ChoreographModesMcp {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
  /** MCP `tools/list` for the graph (the loopback client ignores the argument). */
  toolsList?(graphId: string): Promise<readonly unknown[]>
}

export interface ChoreographModesServiceOptions {
  /** Rows per sparql_query page (explicit LIMIT/OFFSET). */
  readonly pageSize?: number
  /** Upper bound on pages per read, so a runaway graph cannot spin forever. */
  readonly maxPages?: number
}

const DEFAULT_PAGE_SIZE = 200
const DEFAULT_MAX_PAGES = 50

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function resultRows(value: unknown): SparqlRow[] {
  const envelope = object(value)
  const rows = Array.isArray(envelope.rows) ? envelope.rows : object(envelope.result).rows
  if (!Array.isArray(rows)) {
    throw new Error('sparql_query returned no rows array')
  }
  // The cell announces a clamped answer only in `warnings`; a partial mode
  // list would silently drop tools or agents, so refuse it.
  const warnings = Array.isArray(envelope.warnings) ? envelope.warnings : object(envelope.result).warnings
  if (Array.isArray(warnings) && warnings.some(w => typeof w === 'string' && /truncated/i.test(w))) {
    throw new Error(`sparql_query result was truncated by the cell: ${warnings.join('; ')}`)
  }
  return rows.filter((row): row is SparqlRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
}

export class ChoreographModesService implements ChoreoModesPort {
  private readonly pageSize: number
  private readonly maxPages: number

  constructor(
    private readonly mcp: ChoreographModesMcp,
    readonly graphId: string,
    options: ChoreographModesServiceOptions = {},
  ) {
    if (!isValidGraphId(graphId)) throw new Error(`Invalid graph id '${graphId}'`)
    this.pageSize = Math.max(1, Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE))
    this.maxPages = Math.max(1, Math.trunc(options.maxPages ?? DEFAULT_MAX_PAGES))
  }

  async catalogue(): Promise<readonly ChoreoToolDescriptor[]> {
    if (typeof this.mcp.toolsList !== 'function') {
      throw new Error('This runtime does not expose MCP tools/list')
    }
    return describeTools(await this.mcp.toolsList(this.graphId))
  }

  async load(): Promise<ChoreoModesSnapshot> {
    const [modeRows, agentRows, assignmentRows] = await Promise.all([
      this.paged((limit, offset) => modesQuery(this.graphId, limit, offset)),
      this.paged((limit, offset) => agentsQuery(limit, offset)),
      this.paged((limit, offset) => assignmentsQuery(this.graphId, limit, offset)),
    ])
    return { modes: modesFromRows(modeRows), agents: agentsFromRows(agentRows, assignmentRows) }
  }

  /** Validate against the LIVE catalogue, keep any imageTransform, then replace the mode. */
  async saveMode(draft: ChoreoModeDraft): Promise<void> {
    const issues = validateModeDraft(draft, await this.catalogue())
    if (issues.errors.length > 0) throw new Error(issues.errors.join(' '))
    const current = await this.query(imageTransformQuery(this.graphId, modeIri(draft.slug)))
    const imageTransform = current.length > 0 ? termValue(current[0]!.t) : null
    await this.update(modeSaveUpdate(this.graphId, draft, imageTransform))
  }

  async deleteMode(iri: string): Promise<void> {
    await this.update(modeDeleteUpdate(this.graphId, iri))
  }

  async saveAgentModes(agentIri: string, defaultMode: string | null, mayUseModes: readonly string[]): Promise<void> {
    await this.update(agentModesUpdate(this.graphId, agentIri, defaultMode, mayUseModes))
  }

  private async paged(build: (limit: number, offset: number) => string): Promise<SparqlRow[]> {
    const rows: SparqlRow[] = []
    for (let page = 0; page < this.maxPages; page += 1) {
      const batch = await this.query(build(this.pageSize, page * this.pageSize))
      rows.push(...batch)
      if (batch.length < this.pageSize) return rows
    }
    throw new Error(`Modes read exceeded ${this.maxPages * this.pageSize} rows`)
  }

  private async query(query: string): Promise<SparqlRow[]> {
    return resultRows(await this.mcp.callTool('sparql_query', { graphId: this.graphId, query }))
  }

  private async update(update: string): Promise<void> {
    await this.mcp.callTool('sparql_update', { graphId: this.graphId, update })
  }
}
