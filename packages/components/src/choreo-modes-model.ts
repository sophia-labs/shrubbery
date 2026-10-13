/**
 * choreo-modes-model — the pure data model of Choreograph modes v1.
 *
 * A mode is a subset of the MCP tool surface plus permissions (access ceiling,
 * optional graph fence, approval-required tools). Choreograph's enforcement
 * reads exactly the triples this module writes; the contract is:
 *
 *   <urn:sophia:mode:{slug}> a agt:Mode ; rdfs:label "…" ;
 *       agt:access "read"|"write" ;            (exactly one)
 *       agt:allowsTool "exact_name" ;          (0..n, exact names, no wildcards)
 *       agt:graphScope <urn:graph:{graphId}> ; (0..n)
 *       agt:requiresApproval "name" ;          (0..n, ⊆ allowsTool)
 *       agt:imageTransform "…" .               (0..1, preserved on re-save)
 *   <urn:sophia:agent:{agentId}> agt:defaultMode <m> ; agt:mayUseMode <m> .
 *
 * all in the graph's user named graph `urn:mnemosyne:local:graph:{graphId}:user:rdf`.
 *
 * BACKEND-FREE: no MCP, no fetch. The SPARQL text is built here so it can be
 * proven against a real SPARQL engine; the shell sends it through its own
 * MCP caller.
 */

export const AGT_NS = 'http://mnemosyne.dev/agent#'
export const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
export const MODE_IRI_PREFIX = 'urn:sophia:mode:'
export const AGENT_IRI_PREFIX = 'urn:sophia:agent:'
export const GRAPH_SCOPE_IRI_PREFIX = 'urn:graph:'

export type ModeAccess = 'read' | 'write'
export type ToolEffect = 'read' | 'write'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const GRAPH_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/
// An IRI we are willing to splice between <>: absolute, no whitespace and none
// of the characters the SPARQL IRIREF production forbids.
const SAFE_IRI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/

/** One tool of the live catalogue, as the editor shows it. */
export interface ChoreoToolDescriptor {
  readonly name: string
  readonly description: string
  readonly scopes: readonly string[]
  readonly effect: ToolEffect
  /** Group key: the first required scope's family, else the tool-name family. */
  readonly family: string
}

export interface ChoreoToolGroup {
  readonly family: string
  readonly tools: readonly ChoreoToolDescriptor[]
}

export interface ChoreoMode {
  readonly iri: string
  readonly slug: string
  readonly label: string
  readonly access: ModeAccess
  readonly allowsTools: readonly string[]
  /** Graph ids (the `{graphId}` of each `<urn:graph:{graphId}>`). */
  readonly graphScopes: readonly string[]
  readonly requiresApproval: readonly string[]
  readonly imageTransform: string | null
}

export interface ChoreoAgent {
  readonly iri: string
  readonly agentId: string
  readonly label: string | null
  readonly defaultMode: string | null
  readonly mayUseModes: readonly string[]
  /** Optional authored/runtime profile evidence. Absent on the modes-only RDF read. */
  readonly dossier?: ChoreoAgentDossier
}

/** Presentation evidence only: these references never expand a runtime grant. */
export interface ChoreoAgentDossier {
  readonly sourceLabel: string
  readonly role?: string
  readonly summary?: string
  readonly homeGraphId?: string
  readonly model?: string
  readonly ontology?: {
    readonly geist?: string
    readonly prompt?: string
    readonly skills?: readonly string[]
    readonly harness?: string
    readonly toolManifest?: string
    readonly toolGrant?: string
    readonly runtimeProfile?: string
  }
}

export interface ChoreoModesSnapshot {
  readonly modes: readonly ChoreoMode[]
  readonly agents: readonly ChoreoAgent[]
}

/**
 * The port the surface drives. The shell implements it over the active
 * graph's MCP (tools/list, sparql_query, sparql_update).
 */
export interface ChoreoModesPort {
  readonly graphId: string
  catalogue(): Promise<readonly ChoreoToolDescriptor[]>
  load(): Promise<ChoreoModesSnapshot>
  saveMode(mode: ChoreoModeDraft): Promise<void>
  deleteMode(modeIri: string): Promise<void>
  saveAgentModes(agentIri: string, defaultMode: string | null, mayUseModes: readonly string[]): Promise<void>
}

/** What the editor hands to save; `imageTransform` is never set by the editor. */
export interface ChoreoModeDraft {
  readonly slug: string
  readonly label: string
  readonly access: ModeAccess
  readonly allowsTools: readonly string[]
  readonly graphScopes: readonly string[]
  readonly requiresApproval: readonly string[]
}

// ── effect class + grouping ────────────────────────────────────────────────

/**
 * Effect class from tools/list `_meta["sophia.local.requiredScopes"]`: "read"
 * iff every scope is `*.read`, `rdf.query`, or `rdf.dump`; no scopes ⇒ "write".
 */
export function toolEffect(scopes: readonly string[]): ToolEffect {
  if (scopes.length === 0) return 'write'
  return scopes.every(scope => scope.endsWith('.read') || scope === 'rdf.query' || scope === 'rdf.dump')
    ? 'read'
    : 'write'
}

export function toolFamily(name: string, scopes: readonly string[]): string {
  const first = scopes[0]?.split('.')[0]
  if (first) return first
  const prefix = name.split('_')[0]
  return prefix || name
}

/** Normalize raw MCP `tools/list` entries into sorted descriptors. */
export function describeTools(raw: readonly unknown[]): ChoreoToolDescriptor[] {
  const byName = new Map<string, ChoreoToolDescriptor>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name || byName.has(name)) continue
    const meta = record._meta && typeof record._meta === 'object' ? record._meta as Record<string, unknown> : {}
    const rawScopes = meta['sophia.local.requiredScopes']
    const scopes = Array.isArray(rawScopes) ? rawScopes.filter((s): s is string => typeof s === 'string') : []
    byName.set(name, {
      name,
      description: typeof record.description === 'string' ? record.description : '',
      scopes,
      effect: toolEffect(scopes),
      family: toolFamily(name, scopes),
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function groupTools(tools: readonly ChoreoToolDescriptor[]): ChoreoToolGroup[] {
  const groups = new Map<string, ChoreoToolDescriptor[]>()
  for (const tool of tools) {
    const list = groups.get(tool.family) ?? []
    list.push(tool)
    groups.set(tool.family, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, list]) => ({ family, tools: list.sort((a, b) => a.name.localeCompare(b.name)) }))
}

/** A tool counts toward a mode only when it is in the catalogue and allowed by the ceiling. */
export function isToolEffective(tool: ChoreoToolDescriptor | undefined, access: ModeAccess): boolean {
  return Boolean(tool) && (access === 'write' || tool!.effect === 'read')
}

/** "exposes N of M tools": N = chosen tools effective under the access ceiling. */
export function effectiveToolCount(
  mode: Pick<ChoreoModeDraft, 'access' | 'allowsTools'>,
  catalogue: readonly ChoreoToolDescriptor[],
): number {
  const byName = new Map(catalogue.map(tool => [tool.name, tool]))
  return [...new Set(mode.allowsTools)].filter(name => isToolEffective(byName.get(name), mode.access)).length
}

// ── identifiers ────────────────────────────────────────────────────────────

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

export function isValidGraphId(graphId: string): boolean {
  return GRAPH_ID_RE.test(graphId)
}

export function isValidToolName(name: string): boolean {
  return TOOL_NAME_RE.test(name)
}

/** Derive a slug from a human label: lowercase, dashes, 64 chars max. */
export function slugify(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug
}

export function modeIri(slug: string): string {
  if (!isValidSlug(slug)) throw new Error(`Invalid mode slug '${slug}'`)
  return `${MODE_IRI_PREFIX}${slug}`
}

export function modeSlugFromIri(iri: string): string | null {
  if (!iri.startsWith(MODE_IRI_PREFIX)) return null
  const slug = iri.slice(MODE_IRI_PREFIX.length)
  return isValidSlug(slug) ? slug : null
}

export function agentIdFromIri(iri: string): string {
  return iri.startsWith(AGENT_IRI_PREFIX) ? iri.slice(AGENT_IRI_PREFIX.length) : iri
}

export function userGraphIri(graphId: string): string {
  if (!isValidGraphId(graphId)) throw new Error(`Invalid graph id '${graphId}'`)
  return `urn:mnemosyne:local:graph:${graphId}:user:rdf`
}

export function graphScopeIri(graphId: string): string {
  if (!isValidGraphId(graphId)) throw new Error(`Invalid graph scope '${graphId}'`)
  return `${GRAPH_SCOPE_IRI_PREFIX}${graphId}`
}

export function graphIdFromScopeIri(iri: string): string | null {
  if (!iri.startsWith(GRAPH_SCOPE_IRI_PREFIX)) return null
  const id = iri.slice(GRAPH_SCOPE_IRI_PREFIX.length)
  return isValidGraphId(id) ? id : null
}

/** `<iri>` after validation; throws on anything that could break out of the IRIREF. */
export function sparqlIri(iri: string): string {
  if (!SAFE_IRI_RE.test(iri)) throw new Error(`Refusing unsafe IRI '${iri}'`)
  return `<${iri}>`
}

/** A SPARQL string literal with quotes, backslashes and control characters escaped. */
export function sparqlLiteral(value: string): string {
  let out = '"'
  for (const ch of value) {
    switch (ch) {
      case '\\': out += '\\\\'; break
      case '"': out += '\\"'; break
      case '\n': out += '\\n'; break
      case '\r': out += '\\r'; break
      case '\t': out += '\\t'; break
      case '\b': out += '\\b'; break
      case '\f': out += '\\f'; break
      default: {
        const code = ch.codePointAt(0)!
        out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : ch
      }
    }
  }
  return `${out}"`
}

// ── validation ─────────────────────────────────────────────────────────────

export interface ModeDraftIssues {
  readonly errors: readonly string[]
  /** Chosen tool names absent from the live catalogue (rejected at save). */
  readonly unknownTools: readonly string[]
  /** Chosen write-class tools that the read ceiling makes ineffective. */
  readonly ineffectiveTools: readonly string[]
}

export function validateModeDraft(
  draft: ChoreoModeDraft,
  catalogue: readonly ChoreoToolDescriptor[],
): ModeDraftIssues {
  const errors: string[] = []
  const byName = new Map(catalogue.map(tool => [tool.name, tool]))
  if (!draft.label.trim()) errors.push('A mode needs a name.')
  if (!isValidSlug(draft.slug)) errors.push('The mode id must be 1–64 characters of a–z, 0–9 and dashes, starting with a letter or digit.')
  if (draft.access !== 'read' && draft.access !== 'write') errors.push('Access must be read or write.')
  const unknownTools = [...new Set(draft.allowsTools)].filter(name => !byName.has(name))
  if (unknownTools.length > 0) {
    errors.push(`Remove tools the cell does not offer: ${unknownTools.join(', ')}.`)
  }
  const invalidNames = draft.allowsTools.filter(name => !isValidToolName(name))
  if (invalidNames.length > 0) errors.push(`Tool names must be exact names: ${invalidNames.join(', ')}.`)
  const allowed = new Set(draft.allowsTools)
  const strayApprovals = draft.requiresApproval.filter(name => !allowed.has(name))
  if (strayApprovals.length > 0) {
    errors.push(`Approval-required tools must be chosen tools: ${strayApprovals.join(', ')}.`)
  }
  const badScopes = draft.graphScopes.filter(id => !isValidGraphId(id))
  if (badScopes.length > 0) errors.push(`Invalid graph ids: ${badScopes.join(', ')}.`)
  const ineffectiveTools = draft.access === 'read'
    ? [...allowed].filter(name => byName.get(name)?.effect === 'write')
    : []
  return { errors, unknownTools, ineffectiveTools }
}

export interface AgentModesIssues {
  readonly errors: readonly string[]
}

export function validateAgentModes(defaultMode: string | null, mayUseModes: readonly string[]): AgentModesIssues {
  const errors: string[] = []
  if (defaultMode && !mayUseModes.includes(defaultMode)) {
    errors.push('The default mode must be one of the allowed modes.')
  }
  return { errors }
}

// ── SPARQL: reads ──────────────────────────────────────────────────────────

const PREFIXES = `PREFIX agt: <${AGT_NS}>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n`

/**
 * One row per (mode, predicate, object) in the user named graph. Paged with an
 * explicit ORDER BY/LIMIT/OFFSET because cells clamp result sizes silently.
 */
export function modesQuery(graphId: string, limit: number, offset: number): string {
  const g = sparqlIri(userGraphIri(graphId))
  return `${PREFIXES}SELECT ?mode ?p ?o WHERE {
  GRAPH ?g {
    ?mode a agt:Mode .
    ?mode ?p ?o .
    FILTER(?p IN (rdfs:label, agt:access, agt:allowsTool, agt:graphScope, agt:requiresApproval, agt:imageTransform))
  }
  FILTER(?g = ${g})
} ORDER BY ?mode ?p ?o LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`
}

/** Agents typed anywhere in the graph, with a label if one exists. */
export function agentsQuery(limit: number, offset: number): string {
  return `${PREFIXES}SELECT ?agent (SAMPLE(?l) AS ?label) WHERE {
  GRAPH ?g { ?agent a agt:Agent . }
  OPTIONAL { GRAPH ?lg { ?agent rdfs:label ?l . } }
} GROUP BY ?agent ORDER BY ?agent LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`
}

/** Agent → mode assignments in the user named graph. */
export function assignmentsQuery(graphId: string, limit: number, offset: number): string {
  const g = sparqlIri(userGraphIri(graphId))
  return `${PREFIXES}SELECT ?agent ?p ?mode WHERE {
  GRAPH ?g {
    ?agent ?p ?mode .
    FILTER(?p IN (agt:defaultMode, agt:mayUseMode))
  }
  FILTER(?g = ${g})
} ORDER BY ?agent ?p ?mode LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`
}

/** The current imageTransform of one mode (to preserve it across a re-save). */
export function imageTransformQuery(graphId: string, iri: string): string {
  const g = sparqlIri(userGraphIri(graphId))
  return `${PREFIXES}SELECT ?t WHERE {
  GRAPH ?g { ${sparqlIri(iri)} agt:imageTransform ?t . }
  FILTER(?g = ${g})
} LIMIT 1`
}

// ── SPARQL: writes ─────────────────────────────────────────────────────────

/**
 * Replace a mode: `DELETE WHERE` every triple of the subject, then
 * `INSERT DATA` the new object. `imageTransform` (read back by the caller
 * just before saving) is carried over so a re-save never drops it.
 */
export function modeSaveUpdate(graphId: string, draft: ChoreoModeDraft, imageTransform: string | null): string {
  const g = sparqlIri(userGraphIri(graphId))
  const m = sparqlIri(modeIri(draft.slug))
  const allowed = [...new Set(draft.allowsTools)]
  for (const name of allowed) if (!isValidToolName(name)) throw new Error(`Invalid tool name '${name}'`)
  const allowedSet = new Set(allowed)
  const approvals = [...new Set(draft.requiresApproval)]
  for (const name of approvals) if (!allowedSet.has(name)) throw new Error(`Approval tool '${name}' is not an allowed tool`)
  if (draft.access !== 'read' && draft.access !== 'write') throw new Error(`Invalid access '${String(draft.access)}'`)
  const label = draft.label.trim()
  if (!label) throw new Error('A mode needs a label')
  const lines = [
    `${m} a agt:Mode .`,
    `${m} rdfs:label ${sparqlLiteral(label)} .`,
    `${m} agt:access ${sparqlLiteral(draft.access)} .`,
    ...allowed.map(name => `${m} agt:allowsTool ${sparqlLiteral(name)} .`),
    ...[...new Set(draft.graphScopes)].map(id => `${m} agt:graphScope ${sparqlIri(graphScopeIri(id))} .`),
    ...approvals.map(name => `${m} agt:requiresApproval ${sparqlLiteral(name)} .`),
    ...(imageTransform !== null ? [`${m} agt:imageTransform ${sparqlLiteral(imageTransform)} .`] : []),
  ]
  return `${PREFIXES}DELETE WHERE { GRAPH ${g} { ${m} ?p ?o } };
INSERT DATA { GRAPH ${g} {
  ${lines.join('\n  ')}
} }`
}

/** Delete a mode and every agent reference to it. */
export function modeDeleteUpdate(graphId: string, iri: string): string {
  const g = sparqlIri(userGraphIri(graphId))
  const m = sparqlIri(iri)
  return `${PREFIXES}DELETE WHERE { GRAPH ${g} { ${m} ?p ?o } };
DELETE WHERE { GRAPH ${g} { ?agent agt:defaultMode ${m} } };
DELETE WHERE { GRAPH ${g} { ?agent agt:mayUseMode ${m} } }`
}

/** Replace one agent's default + allowed modes, leaving every other triple alone. */
export function agentModesUpdate(
  graphId: string,
  agentIri: string,
  defaultMode: string | null,
  mayUseModes: readonly string[],
): string {
  const issues = validateAgentModes(defaultMode, mayUseModes)
  if (issues.errors.length > 0) throw new Error(issues.errors.join(' '))
  const g = sparqlIri(userGraphIri(graphId))
  const a = sparqlIri(agentIri)
  const lines = [
    ...(defaultMode ? [`${a} agt:defaultMode ${sparqlIri(defaultMode)} .`] : []),
    ...[...new Set(mayUseModes)].map(mode => `${a} agt:mayUseMode ${sparqlIri(mode)} .`),
  ]
  const deletes = `${PREFIXES}DELETE WHERE { GRAPH ${g} { ${a} agt:defaultMode ?x } };
DELETE WHERE { GRAPH ${g} { ${a} agt:mayUseMode ?x } }`
  return lines.length > 0
    ? `${deletes};\nINSERT DATA { GRAPH ${g} {\n  ${lines.join('\n  ')}\n} }`
    : deletes
}

// ── SPARQL: row parsing ────────────────────────────────────────────────────

/** A cell row term (N-Triples-ish: `<iri>`, `"lit"`, `"lit"@en`, `"1"^^<dt>`) → IRI or null. */
export function termIri(term: string | undefined): string | null {
  return term?.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : null
}

/** A cell row term → its lexical value (IRIs come back bare). */
export function termValue(term: string | undefined): string | null {
  if (term === undefined) return null
  if (!term.startsWith('"')) return termIri(term) ?? term
  let out = ''
  for (let i = 1; i < term.length; i += 1) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[++i]
      if (next === 'u' || next === 'U') {
        const width = next === 'u' ? 4 : 8
        out += String.fromCodePoint(Number.parseInt(term.slice(i + 1, i + 1 + width), 16))
        i += width
        continue
      }
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next === 'b' ? '\b' : next === 'f' ? '\f' : next ?? ''
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

export type SparqlRow = Readonly<Record<string, string>>

export function modesFromRows(rows: readonly SparqlRow[]): ChoreoMode[] {
  interface Acc { label: string | null; access: string[]; tools: string[]; scopes: string[]; approvals: string[]; transform: string | null }
  const byIri = new Map<string, Acc>()
  for (const row of rows) {
    const iri = termIri(row.mode)
    const p = termIri(row.p)
    if (!iri || !p) continue
    const acc = byIri.get(iri) ?? { label: null, access: [], tools: [], scopes: [], approvals: [], transform: null }
    byIri.set(iri, acc)
    const value = termValue(row.o)
    if (value === null) continue
    if (p === RDFS_LABEL) acc.label ??= value
    else if (p === `${AGT_NS}access`) acc.access.push(value)
    else if (p === `${AGT_NS}allowsTool`) acc.tools.push(value)
    else if (p === `${AGT_NS}graphScope`) {
      const id = graphIdFromScopeIri(value)
      if (id) acc.scopes.push(id)
    } else if (p === `${AGT_NS}requiresApproval`) acc.approvals.push(value)
    else if (p === `${AGT_NS}imageTransform`) acc.transform ??= value
  }
  const modes: ChoreoMode[] = []
  for (const [iri, acc] of byIri) {
    const slug = modeSlugFromIri(iri) ?? iri
    // Fail closed: anything but exactly one "write" reads as a read ceiling.
    const access: ModeAccess = acc.access.length === 1 && acc.access[0] === 'write' ? 'write' : 'read'
    modes.push({
      iri,
      slug,
      label: acc.label ?? slug,
      access,
      allowsTools: [...new Set(acc.tools)].sort(),
      graphScopes: [...new Set(acc.scopes)].sort(),
      requiresApproval: [...new Set(acc.approvals)].sort(),
      imageTransform: acc.transform,
    })
  }
  return modes.sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri))
}

export function agentsFromRows(agentRows: readonly SparqlRow[], assignmentRows: readonly SparqlRow[]): ChoreoAgent[] {
  const agents = new Map<string, { label: string | null; defaults: string[]; allowed: string[] }>()
  for (const row of agentRows) {
    const iri = termIri(row.agent)
    if (!iri) continue
    const existing = agents.get(iri)
    const label = termValue(row.label)
    agents.set(iri, { label: existing?.label ?? (label || null), defaults: [], allowed: [] })
  }
  for (const row of assignmentRows) {
    const iri = termIri(row.agent)
    const p = termIri(row.p)
    const mode = termIri(row.mode)
    const agent = iri ? agents.get(iri) : undefined
    if (!agent || !p || !mode) continue
    if (p === `${AGT_NS}defaultMode`) agent.defaults.push(mode)
    else if (p === `${AGT_NS}mayUseMode`) agent.allowed.push(mode)
  }
  return [...agents.entries()]
    .map(([iri, value]) => ({
      iri,
      agentId: agentIdFromIri(iri),
      label: value.label,
      defaultMode: value.defaults.sort()[0] ?? null,
      mayUseModes: [...new Set(value.allowed)].sort(),
    }))
    .sort((a, b) => (a.label ?? a.agentId).localeCompare(b.label ?? b.agentId))
}
