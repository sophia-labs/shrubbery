import { triplesToNT } from '@shrubbery/nucleus'
import { buildDomainAgentSeedBundle, type DomainAgentBundleInput, type DomainAgentSeedBundle } from './agent-bundle.js'
import { buildDomainQueryCatalogue, domainCatalogueHeader } from './catalogue.js'
import {
  assertOneLayoutLiteral,
  type BuildDomainDashboardInput,
  buildDomainDashboard,
  type DomainDashboardProjection,
  dashboardToProjectionRecords,
} from './dashboard.js'
import {
  manifestProjectionGraphIri,
  manifestToNt,
  manifestToProjectionRecords,
  parseCapabilityManifest,
} from './manifest.js'
import type {
  DomainCapabilityManifest,
  DomainNamedQueryDefinition,
  DomainProjectionIngest,
  DomainQueryCatalogue,
} from './types.js'

export const DOMAIN_INSTANCE_SEED_SCHEMA = 'sophia.domain-instance-seed.v1' as const

export interface DomainRdfImport {
  readonly graphIri: string
  readonly mediaType: 'application/n-triples'
  readonly content: string
}

export interface DomainInstanceSeed {
  readonly schema: typeof DOMAIN_INSTANCE_SEED_SCHEMA
  readonly domain: string
  readonly graphId: string
  readonly manifest: DomainCapabilityManifest
  readonly catalogue: DomainQueryCatalogue
  readonly dashboard: DomainDashboardProjection
  readonly agent: DomainAgentSeedBundle
  readonly graphDocuments: Readonly<Record<string, string>>
  readonly authorityDocuments: Readonly<Record<string, string>>
  /** Garden-owned reserved projections, executed only by the provisioner. */
  readonly projectionIngests: readonly DomainProjectionIngest[]
  /** Exact N-Triples mirrors retained for local currency and audit proofs. */
  readonly rdfImports: readonly DomainRdfImport[]
}

export interface BuildDomainInstanceSeedInput {
  readonly domain: string
  readonly graphId: string
  readonly manifest: unknown
  readonly queries: readonly DomainNamedQueryDefinition[]
  readonly dashboard: Omit<BuildDomainDashboardInput, 'domain' | 'graphId' | 'catalogue'>
  readonly agent: DomainAgentBundleInput
  /** Domain-authored documents served beside the portable kit surfaces. */
  readonly additionalGraphDocuments?: Readonly<Record<string, string>>
}

/**
 * Materialize the complete portable payload a provisioner needs for a domain:
 * authored documents, deterministic RDF projections, dashboard, and the
 * graph-defined agent. This function has no cloud or Garden dependency.
 */
export function buildDomainInstanceSeed(input: BuildDomainInstanceSeedInput): DomainInstanceSeed {
  if (input.agent.homeGraphId !== input.graphId) throw new Error('domain and agent home graph disagree')
  const manifest = parseCapabilityManifest(input.manifest)
  const catalogue = buildDomainQueryCatalogue(input.domain, input.queries)
  const dashboard = buildDomainDashboard({
    ...input.dashboard,
    domain: input.domain,
    graphId: input.graphId,
    catalogue,
  })
  assertOneLayoutLiteral(dashboard.triples, dashboard.surfaceIri)
  const agent = buildDomainAgentSeedBundle(input.agent)
  const manifestNt = manifestToNt(manifest)
  const dashboardNt = `${triplesToNT(dashboard.triples)}\n`
  const graphDocuments: Record<string, string> = {
    'domain-capability-manifest': `${JSON.stringify(manifest, null, 2)}\n`,
    'domain-query-catalogue': `${JSON.stringify(catalogue, null, 2)}\n`,
    'domain-query-catalogue-readme': domainCatalogueHeader(catalogue),
    'domain-dashboard-layout': `${JSON.stringify(dashboard.layout, null, 2)}\n`,
    ...agent.homeDocuments,
  }
  for (const [documentId, content] of Object.entries(input.additionalGraphDocuments ?? {})) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(documentId)) {
      throw new Error(`additional graph document id '${documentId}' is not portable`)
    }
    if (!content.trim()) throw new Error(`additional graph document '${documentId}' is empty`)
    if (documentId in graphDocuments) throw new Error(`additional graph document '${documentId}' collides with a kit document`)
    graphDocuments[documentId] = content
  }
  return {
    schema: DOMAIN_INSTANCE_SEED_SCHEMA,
    domain: input.domain,
    graphId: input.graphId,
    manifest,
    catalogue,
    dashboard,
    agent,
    graphDocuments,
    authorityDocuments: agent.authorityDocuments,
    projectionIngests: [
      {
        graphIri: manifestProjectionGraphIri(input.graphId),
        vocab: 'sophia-domain-manifest',
        replaceClass: true,
        records: manifestToProjectionRecords(manifest),
      },
      {
        graphIri: `urn:mnemosyne:local:graph:${input.graphId}:projection:domain-dashboard`,
        vocab: 'sophia-domain-dashboard',
        replaceClass: true,
        records: dashboardToProjectionRecords(dashboard),
      },
    ],
    rdfImports: [
      {
        graphIri: manifestProjectionGraphIri(input.graphId),
        mediaType: 'application/n-triples',
        content: manifestNt,
      },
      {
        graphIri: `urn:mnemosyne:local:graph:${input.graphId}:projection:domain-dashboard`,
        mediaType: 'application/n-triples',
        content: dashboardNt,
      },
    ],
  }
}
