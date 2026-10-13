import { createHash } from 'node:crypto'
import {
  type AgentStudioProfileV1,
  canonicalJson,
  createSophiaClusterLeadProfile,
  SOPHIA_1_RESIDENT_IDENTITY,
  SOPHIA_CLUSTER_LEAD_HARNESS,
} from '@shrubbery/domain-kit/agent-studio'
import type { GatewayGraphInfo, GatewayMcpResult } from '@shrubbery/source/gateway'
import { gatewayMcpText } from '@shrubbery/source/gateway'
import {
  AGENT_STUDIO_GRAPH_ID,
  type AgentStudioActiveDefinition,
  AgentStudioApi,
  AgentStudioConflictError,
  type AgentStudioSnapshot,
} from '../src/cell/agent-studio-api.js'

export const SOPHIA_CLUSTER_AGENT_STUDIO_GATEWAY = 'https://api.canary.sophia-labs.com'
export const SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH = 'observatory'
export const SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT = 53

export type SophiaClusterAgentStudioAction = 'inspect' | 'save' | 'publish'

export interface SophiaClusterAgentStudioGateway {
  graphs(): Promise<readonly GatewayGraphInfo[]>
  bindGraphOwner(graphId: string, owner: string): void
  toolsCall(
    graphId: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<GatewayMcpResult>
}

export interface SophiaClusterAgentStudioConfirmation {
  readonly profileDigest: string
  readonly profileRevision: number
  readonly activeDefinitionRevision?: number | 'absent'
}

export interface SophiaClusterAgentStudioOperation {
  /** Omitted means the read-only inspect operation. */
  readonly action?: SophiaClusterAgentStudioAction
  readonly runtimeBundleDigest: string
  readonly confirmation?: SophiaClusterAgentStudioConfirmation
  readonly now?: () => number
}

export interface BoundedDocumentTestimony {
  readonly revision: number | null
  readonly digest: string | null
}

export interface SophiaClusterAgentStudioSummary {
  readonly schema: 'sophia.agent-studio-operator-summary.v1'
  readonly action: SophiaClusterAgentStudioAction
  readonly writes: 'none' | 'draft-only' | 'publication'
  readonly coordinates: {
    readonly gateway: typeof SOPHIA_CLUSTER_AGENT_STUDIO_GATEWAY
    readonly homeGraphId: typeof AGENT_STUDIO_GRAPH_ID
    readonly authorityGraphId: typeof SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH
    readonly ownerPrincipalDigest: string
  }
  readonly candidate: {
    readonly digest: string
    readonly matchesLiveProfile: boolean
    readonly registeredName: typeof SOPHIA_1_RESIDENT_IDENTITY.registeredName
    readonly agentId: typeof SOPHIA_CLUSTER_LEAD_HARNESS.agentId
    readonly runtimeBundleDigest: string
    readonly toolCount: typeof SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT
  }
  readonly liveProfile: BoundedDocumentTestimony
  readonly previousActiveDefinition: BoundedDocumentTestimony
  readonly resultingProfile: BoundedDocumentTestimony
  readonly resultingActiveDefinition: BoundedDocumentTestimony
  readonly publication?: {
    readonly publicationId: string
    readonly digest: string
  }
  readonly invariants: {
    readonly fixedGateway: true
    readonly ownerBoundGraphs: true
    readonly exactIdentity: true
    readonly exactRuntimeBundle: true
    readonly exactToolCount: true
    readonly casFenced: true
    readonly previousActiveRetainedByRevision: boolean
  }
}

/**
 * Run the deliberately narrow Sophia-1 Agent Studio operation. `inspect` is
 * the default at the CLI boundary and has no write path. Save and publish are
 * separate operations so a human can inspect the reread revision between them.
 */
export async function operateSophiaClusterAgentStudio(
  gateway: SophiaClusterAgentStudioGateway,
  operation: SophiaClusterAgentStudioOperation,
): Promise<SophiaClusterAgentStudioSummary> {
  const action = operation.action ?? 'inspect'
  const ownerPrincipal = await bindReviewedCoordinates(gateway)
  const candidate = createSophiaClusterLeadProfile({
    ownerPrincipal,
    runtimeBundleDigest: operation.runtimeBundleDigest,
  })
  assertReviewedCandidate(candidate, operation.runtimeBundleDigest)

  const api = new AgentStudioApi(new HostedAgentStudioMcp(gateway), operation.now)
  const before = await api.load()
  const candidateDigest = digestCanonical(candidate)
  const candidateMatches = before.profile.canonicalContent === canonicalJson(candidate)
  const previousActive = testimony(before.activeDefinition)

  if (action === 'inspect') {
    if (operation.confirmation !== undefined) {
      throw new Error('Inspect mode does not accept mutation confirmation')
    }
    return summary({
      action,
      ownerPrincipal,
      candidate,
      candidateDigest,
      candidateMatches,
      before,
      after: before,
      previousActive,
    })
  }

  const confirmation = requireConfirmation(operation.confirmation)
  assertConfirmation(candidateDigest, before, confirmation, action)

  if (action === 'save') {
    const after = await api.saveDraft(candidate, before.profile)
    return summary({
      action,
      ownerPrincipal,
      candidate,
      candidateDigest,
      candidateMatches,
      before,
      after,
      previousActive,
    })
  }

  if (!candidateMatches) {
    throw new AgentStudioConflictError(
      'Live Agent Studio profile does not match the reviewed candidate; run the separate Save operation first',
    )
  }
  const result = await api.publish(before.profile)
  return summary({
    action,
    ownerPrincipal,
    candidate,
    candidateDigest,
    candidateMatches,
    before,
    after: result.snapshot,
    previousActive,
    publication: {
      publicationId: result.publication.publicationId,
      digest: normalizeDigest(result.publication.digest),
    },
  })
}

class HostedAgentStudioMcp {
  constructor(private readonly gateway: SophiaClusterAgentStudioGateway) {}

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const graphId = typeof args.graphId === 'string' ? args.graphId.trim() : ''
    if (!graphId) throw new Error(`Hosted Agent Studio ${name} call requires graphId`)
    const result = await this.gateway.toolsCall(graphId, name, args)
    if (result.structuredContent !== undefined) return result.structuredContent
    const text = gatewayMcpText(result)
    return text ? JSON.parse(text) as unknown : undefined
  }
}

async function bindReviewedCoordinates(gateway: SophiaClusterAgentStudioGateway): Promise<string> {
  const graphs = await gateway.graphs()
  const home = exactGraph(graphs, AGENT_STUDIO_GRAPH_ID)
  const authority = exactGraph(graphs, SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH)
  if (!home.owner || !authority.owner) {
    throw new Error('Gateway did not supply owner authority for both reviewed Agent Studio graphs')
  }
  if (home.owner !== authority.owner) {
    throw new Error('Sophia home and Observatory authority graphs do not have the same owner principal')
  }
  if (!canWrite(home) || !canWrite(authority)) {
    throw new Error('Current gateway identity lacks write authority for both reviewed Agent Studio graphs')
  }
  gateway.bindGraphOwner(AGENT_STUDIO_GRAPH_ID, home.owner)
  gateway.bindGraphOwner(SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH, authority.owner)
  return home.owner
}

function exactGraph(graphs: readonly GatewayGraphInfo[], graphId: string): GatewayGraphInfo {
  const matches = graphs.filter(graph => graph.graphId === graphId)
  if (matches.length !== 1) {
    throw new Error(`Gateway must expose exactly one owner-bound '${graphId}' graph (found ${matches.length})`)
  }
  return matches[0]
}

function canWrite(graph: GatewayGraphInfo): boolean {
  return graph.role === 'owner' || graph.role === 'editor'
}

function assertReviewedCandidate(profile: AgentStudioProfileV1, requestedRuntimeDigest: string): void {
  const normalizedRuntime = normalizeDigest(requestedRuntimeDigest)
  const exactIdentity =
    profile.registeredName === SOPHIA_1_RESIDENT_IDENTITY.registeredName
    && SOPHIA_CLUSTER_LEAD_HARNESS.agentId === SOPHIA_1_RESIDENT_IDENTITY.agentId
    && profile.home.graphId === SOPHIA_1_RESIDENT_IDENTITY.homeGraphId
    && profile.ontology.harness.objectId === SOPHIA_CLUSTER_LEAD_HARNESS.harnessId
  if (!exactIdentity) throw new Error('Reviewed Sophia-1 resident identity invariant failed')
  if (profile.grantAuthority.graphId !== SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH) {
    throw new Error('Reviewed Sophia-1 grant authority invariant failed')
  }
  if (
    profile.runtimes.pilot.bundle.digest !== normalizedRuntime
    || profile.runtimes.emanation.bundle.digest !== normalizedRuntime
  ) {
    throw new Error('Reviewed Sophia-1 runtime bundle invariant failed')
  }
  if (profile.tools.length !== SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT) {
    throw new Error(`Reviewed Sophia-1 tool invariant failed: expected ${SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT}`)
  }
  const names = new Set(profile.tools.map(tool => tool.name))
  if (names.size !== SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT) {
    throw new Error('Reviewed Sophia-1 tool manifest contains duplicate names')
  }
}

function requireConfirmation(
  confirmation: SophiaClusterAgentStudioConfirmation | undefined,
): SophiaClusterAgentStudioConfirmation {
  if (!confirmation) {
    throw new Error('Mutation requires profile digest and revision confirmation from a prior inspect')
  }
  return confirmation
}

function assertConfirmation(
  candidateDigest: string,
  before: AgentStudioSnapshot,
  confirmation: SophiaClusterAgentStudioConfirmation,
  action: Exclude<SophiaClusterAgentStudioAction, 'inspect'>,
): void {
  if (confirmation.profileDigest !== candidateDigest) {
    throw new AgentStudioConflictError('Confirmed candidate digest does not match the reviewed profile')
  }
  if (before.profile.revision === null) {
    throw new Error('Live profile exposes no durable revision; refusing operator mutation')
  }
  if (confirmation.profileRevision !== before.profile.revision) {
    throw new AgentStudioConflictError('Confirmed profile revision is stale')
  }
  if (action === 'publish') {
    const expected = confirmation.activeDefinitionRevision
    if (expected === undefined) {
      throw new Error('Publish requires explicit active-definition revision confirmation')
    }
    const actual = before.activeDefinition?.revision ?? 'absent'
    if (actual !== expected) {
      throw new AgentStudioConflictError('Confirmed active-definition revision is stale')
    }
  } else if (confirmation.activeDefinitionRevision !== undefined) {
    throw new Error('Save confirmation must not include an active-definition revision')
  }
}

function summary(input: {
  action: SophiaClusterAgentStudioAction
  ownerPrincipal: string
  candidate: AgentStudioProfileV1
  candidateDigest: string
  candidateMatches: boolean
  before: AgentStudioSnapshot
  after: AgentStudioSnapshot
  previousActive: BoundedDocumentTestimony
  publication?: { readonly publicationId: string; readonly digest: string }
}): SophiaClusterAgentStudioSummary {
  return {
    schema: 'sophia.agent-studio-operator-summary.v1',
    action: input.action,
    writes: input.action === 'inspect' ? 'none' : input.action === 'save' ? 'draft-only' : 'publication',
    coordinates: {
      gateway: SOPHIA_CLUSTER_AGENT_STUDIO_GATEWAY,
      homeGraphId: AGENT_STUDIO_GRAPH_ID,
      authorityGraphId: SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH,
      ownerPrincipalDigest: digestText(input.ownerPrincipal),
    },
    candidate: {
      digest: input.candidateDigest,
      matchesLiveProfile: input.candidateMatches,
      registeredName: SOPHIA_1_RESIDENT_IDENTITY.registeredName,
      agentId: SOPHIA_CLUSTER_LEAD_HARNESS.agentId,
      runtimeBundleDigest: input.candidate.runtimes.pilot.bundle.digest,
      toolCount: SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT,
    },
    liveProfile: testimony(input.before.profile),
    previousActiveDefinition: input.previousActive,
    resultingProfile: testimony(input.after.profile),
    resultingActiveDefinition: testimony(input.after.activeDefinition),
    ...(input.publication ? { publication: input.publication } : {}),
    invariants: {
      fixedGateway: true,
      ownerBoundGraphs: true,
      exactIdentity: true,
      exactRuntimeBundle: true,
      exactToolCount: true,
      casFenced: true,
      previousActiveRetainedByRevision: input.previousActive.revision !== null,
    },
  }
}

function testimony(document: AgentStudioActiveDefinition | AgentStudioSnapshot['profile'] | null): BoundedDocumentTestimony {
  return document === null
    ? { revision: null, digest: null }
    : { revision: document.revision, digest: digestText(document.canonicalContent) }
}

function digestCanonical(value: unknown): string {
  return digestText(canonicalJson(value))
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function normalizeDigest(value: string): string {
  const normalized = value.startsWith('sha256:') ? value : `sha256:${value}`
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) throw new Error('Runtime bundle digest must be sha256:<64 lowercase hex>')
  return normalized
}

export function parseRevision(value: string, label: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a non-negative integer`)
  const revision = Number(value)
  if (!Number.isSafeInteger(revision)) throw new Error(`${label} is too large`)
  return revision
}

export function parseActiveRevision(value: string): number | 'absent' {
  return value === 'absent' ? value : parseRevision(value, 'active definition revision')
}
