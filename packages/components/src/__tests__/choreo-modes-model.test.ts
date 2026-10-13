/**
 * REAL tests of the Choreograph modes model and the surface's portless state.
 * The SPARQL text is exercised against a real engine in
 * apps/organism/src/cell/__tests__/choreograph-modes-service.test.ts.
 */
import { describe, expect, it } from 'vitest'
import '../choreo-modes-surface.js'
import type { ChoreoModesSurface } from '../choreo-modes-surface.js'
import {
  agentModesUpdate,
  describeTools,
  effectiveToolCount,
  groupTools,
  modeIri,
  modeSaveUpdate,
  modesFromRows,
  slugify,
  sparqlIri,
  sparqlLiteral,
  termValue,
  toolEffect,
  validateAgentModes,
  validateModeDraft,
} from '../choreo-modes-model.js'

const raw = (name: string, scopes?: string[]) => ({
  name,
  description: `${name} tool`,
  ...(scopes ? { _meta: { 'sophia.local.requiredScopes': scopes } } : {}),
})

const catalogue = describeTools([
  raw('read_document', ['documents.read']),
  raw('write_document', ['documents.write.crdt']),
  raw('sparql_query', ['rdf.query']),
  raw('rdf_dump', ['rdf.dump']),
  raw('query_graph', ['rdf.query', 'jobs.read']),
  raw('graph_intuition', ['search.semantic.read', 'services.proxy']),
  raw('mystery_tool'),
])

describe('choreo-modes-model', () => {
  it('classifies effect from required scopes: *.read, rdf.query, rdf.dump are read; none is write', () => {
    expect(toolEffect(['documents.read'])).toBe('read')
    expect(toolEffect(['rdf.query', 'jobs.read'])).toBe('read')
    expect(toolEffect(['rdf.dump'])).toBe('read')
    expect(toolEffect(['rdf.update'])).toBe('write')
    expect(toolEffect(['search.semantic.read', 'services.proxy'])).toBe('write')
    expect(toolEffect([])).toBe('write')
    expect(catalogue.find(tool => tool.name === 'mystery_tool')).toMatchObject({ effect: 'write', family: 'mystery' })
  })

  it('groups the catalogue by scope family, sorted', () => {
    expect(groupTools(catalogue).map(group => [group.family, group.tools.map(tool => tool.name)])).toEqual([
      ['documents', ['read_document', 'write_document']],
      ['mystery', ['mystery_tool']],
      ['rdf', ['query_graph', 'rdf_dump', 'sparql_query']],
      ['search', ['graph_intuition']],
    ])
  })

  it('counts only tools effective under the access ceiling', () => {
    const allowsTools = ['read_document', 'write_document', 'sparql_query', 'not_live']
    expect(effectiveToolCount({ access: 'read', allowsTools }, catalogue)).toBe(2)
    expect(effectiveToolCount({ access: 'write', allowsTools }, catalogue)).toBe(3)
  })

  it('derives slugs and refuses invalid ones', () => {
    expect(slugify('  Field Researcher — Ñandú!  ')).toBe('field-researcher-nandu')
    expect(slugify('x'.repeat(80))).toHaveLength(64)
    expect(modeIri('reader')).toBe('urn:sophia:mode:reader')
    expect(() => modeIri('-bad')).toThrow(/Invalid mode slug/)
    expect(() => modeIri('Bad')).toThrow(/Invalid mode slug/)
  })

  it('escapes literals and refuses unsafe IRIs', () => {
    expect(sparqlLiteral('a "b" \\ c\nd\te\u0001')).toBe('"a \\"b\\" \\\\ c\\nd\\te\\u0001"')
    expect(termValue(sparqlLiteral('a "b" \\ c\nd\te\u0001'))).toBe('a "b" \\ c\nd\te\u0001')
    expect(termValue('"hola"@es')).toBe('hola')
    expect(sparqlIri('urn:sophia:agent:scout')).toBe('<urn:sophia:agent:scout>')
    for (const bad of ['urn:x> } ; DROP ALL ; <urn:y', 'not an iri', 'urn:a"b', 'relative/path']) {
      expect(() => sparqlIri(bad)).toThrow(/unsafe IRI/)
    }
  })

  it('validates drafts: unknown tools, stray approvals, bad graph ids, read-ceiling warnings', () => {
    const issues = validateModeDraft({
      slug: 'editor', label: 'Editor', access: 'read',
      allowsTools: ['read_document', 'write_document', 'gone_tool'],
      graphScopes: ['sophia-cluster', 'bad id'],
      requiresApproval: ['write_document', 'sparql_query'],
    }, catalogue)
    expect(issues.unknownTools).toEqual(['gone_tool'])
    expect(issues.ineffectiveTools).toEqual(['write_document'])
    expect(issues.errors.join(' ')).toMatch(/gone_tool/)
    expect(issues.errors.join(' ')).toMatch(/Approval-required tools must be chosen tools: sparql_query/)
    expect(issues.errors.join(' ')).toMatch(/Invalid graph ids: bad id/)
    expect(validateModeDraft({
      slug: 'ok', label: 'OK', access: 'write', allowsTools: ['write_document'], graphScopes: [], requiresApproval: ['write_document'],
    }, catalogue).errors).toEqual([])
    expect(validateAgentModes('urn:sophia:mode:a', ['urn:sophia:mode:b']).errors).toHaveLength(1)
    expect(validateAgentModes(null, []).errors).toEqual([])
  })

  it('builds the contract update: DELETE WHERE then INSERT DATA in the user graph, imageTransform carried', () => {
    const update = modeSaveUpdate('graph-a', {
      slug: 'reader', label: 'Reader', access: 'read', allowsTools: ['read_document'], graphScopes: ['sophia-cluster'], requiresApproval: [],
    }, 'sepia')
    expect(update).toContain('DELETE WHERE { GRAPH <urn:mnemosyne:local:graph:graph-a:user:rdf> { <urn:sophia:mode:reader> ?p ?o } };')
    expect(update).toContain('INSERT DATA { GRAPH <urn:mnemosyne:local:graph:graph-a:user:rdf> {')
    expect(update).toContain('<urn:sophia:mode:reader> agt:graphScope <urn:graph:sophia-cluster> .')
    expect(update).toContain('<urn:sophia:mode:reader> agt:imageTransform "sepia" .')
    expect(() => modeSaveUpdate('graph-a', {
      slug: 'reader', label: 'Reader', access: 'read', allowsTools: ['read_document'], graphScopes: [], requiresApproval: ['write_document'],
    }, null)).toThrow(/not an allowed tool/)
    expect(agentModesUpdate('graph-a', 'urn:sophia:agent:scout', null, [])).not.toContain('INSERT DATA')
  })

  it('reads modes fail-closed: anything but exactly one "write" is a read ceiling', () => {
    const agt = 'http://mnemosyne.dev/agent#'
    const rows = [
      { mode: '<urn:sophia:mode:x>', p: `<${agt}access>`, o: '"write"' },
      { mode: '<urn:sophia:mode:x>', p: `<${agt}access>`, o: '"read"' },
      { mode: '<urn:sophia:mode:y>', p: `<${agt}access>`, o: '"write"' },
    ]
    expect(modesFromRows(rows).map(mode => [mode.slug, mode.access, mode.label])).toEqual([
      ['x', 'read', 'x'],
      ['y', 'write', 'y'],
    ])
  })
})

describe('choreo-modes-surface without a port', () => {
  it('renders the idle state and no editor', async () => {
    const el = document.createElement('choreo-modes-surface') as ChoreoModesSurface
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[data-state="idle"]')?.textContent).toContain('Open a graph')
    expect(el.shadowRoot!.querySelector('[aria-label="Mode editor"]')).toBeNull()
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.disabled).toBe(true)
    el.remove()
  })
})
