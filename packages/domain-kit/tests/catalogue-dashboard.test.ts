import { describe, expect, it } from 'vitest'
import { buildDomainQueryCatalogue, domainCatalogueHeader, resolveDomainNamedQuery } from '../src/catalogue.js'
import {
  assertOneLayoutLiteral,
  buildDomainDashboard,
  dashboardToProjectionRecords,
  UX_NS,
} from '../src/dashboard.js'

const definitions = [
  {
    name: 'urn:sophia:query:shrub.coverage.percent',
    readerQuestion: 'How much of the capability manifest has current verdict coverage?',
    description: 'Coverage over distinct scoped manifest claims.',
    text: 'SELECT ?value WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> { ?s ?p ?o } }',
  },
  {
    name: 'urn:sophia:query:shrub.verdicts.recent',
    readerQuestion: 'What did the domain agent most recently prove?',
    description: 'Recent content-addressed verdicts.',
    text: 'SELECT ?item WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> { ?item a <http://sophia.ai/domain#Verdict> } }',
  },
  {
    name: 'urn:sophia:query:shrub.freshness.watermark',
    readerQuestion: 'How current is this dashboard testimony?',
    description: 'Latest domain verdict timestamp.',
    text: 'SELECT (MAX(?asOf) AS ?value) WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> { ?v <http://sophia.ai/domain#asOf> ?asOf } }',
    opensGroundingGap: 'Hosted T4 journeys remain intentionally BLOCKED until the public canary route is provisioned.',
  },
  {
    name: 'urn:sophia:query:shrub.claims.untested',
    readerQuestion: 'Which scopes remain untested?',
    description: 'Untested capability-mode-role queue.',
    text: 'SELECT ?item WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-manifest> { ?item ?p ?o } }',
  },
  {
    name: 'urn:sophia:query:shrub.evidence.recent',
    readerQuestion: 'Which evidence beats are recent?',
    description: 'Thin Observatory evidence coordinates.',
    text: 'SELECT ?item WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:obs:raw> { ?item ?p ?o } }',
  },
  {
    name: 'urn:sophia:query:shrub.verdicts.attention',
    readerQuestion: 'Which verdicts need attention?',
    description: 'Current FAIL and BLOCKED verdicts.',
    text: 'SELECT ?item WHERE { GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:domain-verdict> { ?item ?p ?o } }',
  },
] as const

describe('Domain Kit catalogue and dashboard conventions', () => {
  it('seals reader-question names and resolves only safe graph ids', () => {
    const catalogue = buildDomainQueryCatalogue('shrub', definitions)
    expect(catalogue.queries).toHaveLength(6)
    expect(domainCatalogueHeader(catalogue)).toContain('## Open grounding gaps')
    expect(resolveDomainNamedQuery(catalogue, definitions[0].name, 'shrubbery-domain')).not.toContain('{{graphId}}')
    expect(() => resolveDomainNamedQuery(catalogue, 'SELECT * WHERE {}', 'shrubbery-domain')).toThrow(/raw SPARQL/)
    expect(() => resolveDomainNamedQuery(catalogue, definitions[0].name, '../escape')).toThrow(/cannot be embedded/)
  })

  it('emits exactly one ux:layoutJson literal with an explicit freshness governor', () => {
    const catalogue = buildDomainQueryCatalogue('shrub', definitions)
    const dashboard = buildDomainDashboard({
      domain: 'shrub',
      graphId: 'shrubbery-domain',
      layoutId: 'shrub-domain-dashboard-v1',
      catalogue,
      stats: [{ id: 'coverage', label: 'Coverage', queryName: definitions[0].name, format: 'percent' }],
      verdictsQueryName: definitions[1].name,
      freshnessQueryName: definitions[2].name,
      generatedAt: '2026-08-03T12:00:00.000Z',
      maxAgeSeconds: 86400,
    })
    assertOneLayoutLiteral(dashboard.triples, dashboard.surfaceIri)
    expect(dashboard.triples.filter((triple) => triple.p === `${UX_NS}layoutJson`)).toHaveLength(1)
    expect(dashboard.freshness).toMatchObject({ policy: 'unknown-on-missing-or-error' })
    expect(dashboardToProjectionRecords(dashboard)).toEqual([
      expect.objectContaining({
        kind: 'DashboardSurface',
        localId: dashboard.surfaceIri,
        queryCatalogueDigest: dashboard.catalogueDigest,
        freshnessMaxAgeSeconds: 86400,
      }),
    ])
    expect(Object.keys(dashboard.layout).sort()).toEqual([
      'createdAt',
      'graphId',
      'layoutId',
      'nodes',
      'rootNodeId',
      'schemaVersion',
      'scope',
      'updatedAt',
    ])
  })

  it('composes the Shrubbery workbench from sealed queue, evidence, and attention queries', () => {
    const catalogue = buildDomainQueryCatalogue('shrub', definitions)
    const dashboard = buildDomainDashboard({
      domain: 'shrub',
      graphId: 'shrubbery-domain',
      layoutId: 'shrub-domain-dashboard-v1',
      catalogue,
      stats: [{ id: 'coverage', label: 'Coverage', queryName: definitions[0].name, format: 'percent' }],
      verdictsQueryName: definitions[1].name,
      freshnessQueryName: definitions[2].name,
      details: {
        queueQueryName: definitions[3].name,
        evidenceQueryName: definitions[4].name,
        evidenceGraphId: 'obs-hoja-canary',
        attentionQueryName: definitions[5].name,
      },
      generatedAt: '2026-08-03T12:00:00.000Z',
      maxAgeSeconds: 86400,
    })

    const serialized = JSON.stringify(dashboard.layout)
    expect(serialized).toContain('sparql.bindings-table')
    expect(serialized).toContain('obs.filmstrip')
    expect(serialized).toContain('card.subject')
    expect(serialized).toContain('obs-hoja-canary')
    expect(serialized).toContain(definitions[3].name)
    expect(serialized).toContain(definitions[4].name)
    expect(serialized).toContain(definitions[5].name)
  })
})
