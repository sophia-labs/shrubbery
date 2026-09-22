import { compareTriples, I, L, type Triple } from '@shrubbery/nucleus'
import {
  createExactParamsSchema,
  createFaceAllowListPredicate,
  createValidatedLayoutDocument,
  type LayoutDocument,
} from '@shrubbery/nucleus/layout'
import { stableJson } from './canonical.js'
import { RDF_TYPE } from './manifest.js'
import type { DomainProjectionRecord, DomainQueryCatalogue } from './types.js'

export const UX_NS = 'http://sophia.ai/ux#'
const DOMAIN_NS = 'http://sophia.ai/domain#'
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'

const DOMAIN_DASHBOARD_FACE_IDS = new Set(['stat.scalar', 'sparql.bindings-table', 'obs.filmstrip', 'card.subject'])
const isDomainDashboardFace = createFaceAllowListPredicate([
  {
    faceId: 'stat.scalar',
    validateParams: createExactParamsSchema({
      label: { type: 'string' },
      unit: { type: 'string', optional: true },
      format: { type: 'enum', values: ['number', 'usd', 'ms', 'dateTimeRelative'], optional: true },
      refreshSeconds: { type: 'number', optional: true },
    }),
  },
  {
    faceId: 'sparql.bindings-table',
    validateParams: createExactParamsSchema({
      maxRows: { type: 'number', optional: true },
      subjectField: { type: 'string', optional: true },
    }),
  },
  {
    faceId: 'obs.filmstrip',
    validateParams: createExactParamsSchema({ title: { type: 'string', optional: true } }),
  },
  {
    faceId: 'card.subject',
    validateParams: createExactParamsSchema({
      titleField: { type: 'string' },
      fields: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
  },
])

export interface DomainDashboardStat {
  readonly id: string
  readonly label: string
  readonly queryName: string
  readonly format: 'number' | 'percent' | 'ms' | 'usd' | 'text' | 'dateTimeRelative'
  readonly refreshSeconds?: number
}

export interface DomainDashboardDetailPanels {
  readonly queueQueryName: string
  readonly evidenceQueryName: string
  readonly evidenceGraphId: string
  readonly attentionQueryName: string
  readonly evidenceTitle?: string
}

export interface BuildDomainDashboardInput {
  readonly domain: string
  readonly graphId: string
  readonly layoutId: string
  readonly surfaceIri?: string
  readonly catalogue: DomainQueryCatalogue
  readonly stats: readonly DomainDashboardStat[]
  readonly verdictsQueryName: string
  readonly freshnessQueryName: string
  readonly details?: DomainDashboardDetailPanels
  readonly generatedAt: string
  readonly maxAgeSeconds: number
}

export interface DomainDashboardProjection {
  readonly surfaceIri: string
  readonly catalogueDigest: string
  readonly layout: LayoutDocument
  readonly freshness: {
    readonly queryId: string
    readonly generatedAt: string
    readonly maxAgeSeconds: number
    readonly policy: 'unknown-on-missing-or-error'
  }
  readonly triples: readonly Triple[]
}

export function buildDomainDashboard(input: BuildDomainDashboardInput): DomainDashboardProjection {
  if (input.catalogue.domain !== input.domain) throw new Error('dashboard and catalogue domains disagree')
  if (!Number.isSafeInteger(input.maxAgeSeconds) || input.maxAgeSeconds < 1) {
    throw new Error('dashboard maxAgeSeconds must be a positive integer')
  }
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error('dashboard generatedAt must be an ISO date-time')
  const queryNames = new Set(input.catalogue.queries.map((query) => query.name))
  const dashboardQueries = [
    input.verdictsQueryName,
    input.freshnessQueryName,
    ...input.stats.map((stat) => stat.queryName),
    ...(input.details
      ? [input.details.queueQueryName, input.details.evidenceQueryName, input.details.attentionQueryName]
      : []),
  ]
  for (const queryName of dashboardQueries) {
    if (!queryNames.has(queryName)) throw new Error(`dashboard query '${queryName}' is absent from the sealed catalogue`)
  }
  if (input.details && !/^[a-z0-9-]{1,40}$/.test(input.details.evidenceGraphId)) {
    throw new Error(`dashboard evidence graph '${input.details.evidenceGraphId}' cannot be routed safely`)
  }
  const rootNodeId = `${input.domain}-dashboard`
  const statsNodeId = `${rootNodeId}-stats`
  const verdictsNodeId = `${rootNodeId}-verdicts`
  const contentNodeId = `${rootNodeId}-content`
  const queueStackNodeId = `${rootNodeId}-queue-stack`
  const evidenceStackNodeId = `${rootNodeId}-evidence-stack`
  const queueNodeId = `${rootNodeId}-queue`
  const evidenceNodeId = `${rootNodeId}-evidence`
  const attentionNodeId = `${rootNodeId}-attention`
  const rootEndNodeId = input.details ? contentNodeId : verdictsNodeId
  const layout = {
    schemaVersion: 1,
    layoutId: input.layoutId,
    scope: 'workspace',
    graphId: input.graphId,
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        kind: 'split',
        id: rootNodeId,
        axis: 'vertical',
        startNodeId: statsNodeId,
        endNodeId: rootEndNodeId,
        startBasisPoints: input.details ? 2800 : 4200,
      },
      [statsNodeId]: {
        kind: 'grid',
        id: statsNodeId,
        flow: 'reflow',
        minCellWidth: 220,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: input.stats.map((stat) => ({
            id: stat.id,
            descriptor: {
              schemaVersion: 1,
              faceId: 'stat.scalar',
              resource: { kind: 'query', graphId: input.graphId, queryId: stat.queryName },
              params: statScalarParams(stat),
            },
          })),
        },
      },
      [verdictsNodeId]: {
        kind: 'leaf',
        id: verdictsNodeId,
        descriptor: {
          schemaVersion: 1,
          faceId: 'sparql.bindings-table',
          resource: { kind: 'query', graphId: input.graphId, queryId: input.verdictsQueryName },
          params: { maxRows: 100, subjectField: 'item' },
        },
        descriptorRevision: 0,
      },
      ...(input.details
        ? {
            [contentNodeId]: {
              kind: 'split',
              id: contentNodeId,
              axis: 'horizontal',
              startNodeId: queueStackNodeId,
              endNodeId: evidenceStackNodeId,
              startBasisPoints: 5200,
            },
            [queueStackNodeId]: {
              kind: 'split',
              id: queueStackNodeId,
              axis: 'vertical',
              startNodeId: queueNodeId,
              endNodeId: verdictsNodeId,
              startBasisPoints: 5000,
            },
            [evidenceStackNodeId]: {
              kind: 'split',
              id: evidenceStackNodeId,
              axis: 'vertical',
              startNodeId: evidenceNodeId,
              endNodeId: attentionNodeId,
              startBasisPoints: 5800,
            },
            [queueNodeId]: {
              kind: 'leaf',
              id: queueNodeId,
              descriptor: {
                schemaVersion: 1,
                faceId: 'sparql.bindings-table',
                resource: { kind: 'query', graphId: input.graphId, queryId: input.details.queueQueryName },
                params: { maxRows: 100, subjectField: 'item' },
              },
              descriptorRevision: 0,
            },
            [evidenceNodeId]: {
              kind: 'leaf',
              id: evidenceNodeId,
              descriptor: {
                schemaVersion: 1,
                faceId: 'obs.filmstrip',
                resource: {
                  kind: 'query',
                  graphId: input.details.evidenceGraphId,
                  queryId: input.details.evidenceQueryName,
                },
                params: { title: input.details.evidenceTitle ?? 'Latest acceptance evidence' },
              },
              descriptorRevision: 0,
            },
            [attentionNodeId]: {
              kind: 'grid',
              id: attentionNodeId,
              flow: 'reflow',
              minCellWidth: 260,
              gridRevision: 0,
              children: {
                kind: 'collection',
                collection: { kind: 'query', graphId: input.graphId, queryId: input.details.attentionQueryName },
                itemFaceId: 'card.subject',
                itemParams: {
                  titleField: `${DOMAIN_NS}capabilityId`,
                  fields: `${DOMAIN_NS}outcome,${DOMAIN_NS}reason,${DOMAIN_NS}asOf`,
                  graphIri: input.graphId,
                },
                maxItems: 20,
                refreshSeconds: 300,
              },
            },
          }
        : {}),
    },
    createdAt: input.generatedAt,
    updatedAt: input.generatedAt,
  } as LayoutDocument
  const validated = createValidatedLayoutDocument(layout, {
    isFaceRegistered: isDomainDashboardFace,
    isFaceGridEligible: (faceId) => DOMAIN_DASHBOARD_FACE_IDS.has(faceId),
  })
  if (!validated.ok) {
    throw new Error(`generated domain dashboard is invalid: ${validated.diagnostics.map((item) => item.code).join(', ')}`)
  }
  const freshness = {
    queryId: input.freshnessQueryName,
    generatedAt: input.generatedAt,
    maxAgeSeconds: input.maxAgeSeconds,
    policy: 'unknown-on-missing-or-error' as const,
  }
  const surfaceIri = input.surfaceIri ?? `urn:sophia:ux:surface:${input.domain}-dashboard`
  const triples: Triple[] = [
    { s: surfaceIri, p: RDF_TYPE, o: I(`${UX_NS}DashboardSurface`) },
    { s: surfaceIri, p: `${UX_NS}layoutJson`, o: L(stableJson(validated.doc)) },
    { s: surfaceIri, p: `${DOMAIN_NS}queryCatalogueDigest`, o: L(input.catalogue.digest) },
    { s: surfaceIri, p: `${DOMAIN_NS}freshnessQuery`, o: L(input.freshnessQueryName) },
    { s: surfaceIri, p: `${DOMAIN_NS}freshnessPolicy`, o: L(freshness.policy) },
    { s: surfaceIri, p: `${DOMAIN_NS}freshnessGeneratedAt`, o: L(input.generatedAt, XSD_DATE_TIME) },
    { s: surfaceIri, p: `${DOMAIN_NS}freshnessMaxAgeSeconds`, o: L(String(input.maxAgeSeconds), 'http://www.w3.org/2001/XMLSchema#integer') },
  ].sort(compareTriples)
  return { surfaceIri, catalogueDigest: input.catalogue.digest, layout: validated.doc, freshness, triples }
}

/** Build the one record accepted by `sophia-domain-dashboard`. */
export function dashboardToProjectionRecords(
  projection: DomainDashboardProjection,
): readonly DomainProjectionRecord[] {
  return [
    {
      kind: 'DashboardSurface',
      localId: projection.surfaceIri,
      layoutJson: stableJson(projection.layout),
      queryCatalogueDigest: projection.catalogueDigest,
      freshnessQuery: projection.freshness.queryId,
      freshnessPolicy: projection.freshness.policy,
      freshnessGeneratedAt: projection.freshness.generatedAt,
      freshnessMaxAgeSeconds: projection.freshness.maxAgeSeconds,
    },
  ]
}

function statScalarParams(stat: DomainDashboardStat): Readonly<Record<string, unknown>> {
  const refreshSeconds = stat.refreshSeconds ?? 300
  if (stat.format === 'percent') {
    return { label: stat.label, unit: '%', format: 'number', refreshSeconds }
  }
  if (stat.format === 'text') return { label: stat.label, refreshSeconds }
  return { label: stat.label, format: stat.format, refreshSeconds }
}

export function assertOneLayoutLiteral(triples: readonly Triple[], surfaceIri: string): void {
  const layouts = triples.filter((triple) => triple.s === surfaceIri && triple.p === `${UX_NS}layoutJson`)
  if (layouts.length !== 1 || layouts[0].o.type !== 'literal') {
    throw new Error(`dashboard surface '${surfaceIri}' must carry exactly one ux:layoutJson literal`)
  }
}
