import type {
  BridgeLine,
  BridgeOperation,
  BridgeProjection,
  BridgeSupportLevel,
  GardenBlock,
  GardenDocument,
  JsonRecord,
  VehicleActivityItem,
  VehicleAgentListResponse,
  VehicleAgentRecord,
  VehicleAgentSessionEvent,
  VehicleAgentSummary,
  VehicleAgentWorldDoc,
  VehicleAgentWorldEventsResponse,
  VehicleAgentWorldResponse,
  VehicleAuthConfig,
  VehicleConfig,
  VehicleControlResponse,
  VehicleOntologyEdge,
  VehicleOntologyNode,
  VehiclePane,
  VehiclePaneKind,
  VehicleRunAgentsResponse,
  VehicleRunListResponse,
  VehicleRunSummary,
  VehicleSession,
  VehicleTurnContextPreview,
  VehicleTurnPreviewResponse,
  VehicleWorkflowListResponse,
  VehicleWorkflowOntologyFact,
  VehicleWorkflowOntologyModel,
  VehicleWorkflowRecord,
  VehicleWorkflowRunResponse,
} from './types.js'

export interface VehicleService {
  readonly mode: 'fixture' | 'fetch'
  readonly baseUrl: string
  listAgents(limit?: number): Promise<VehicleAgentListResponse>
  listWorkflows(limit?: number): Promise<VehicleWorkflowListResponse>
  listRuns(limit?: number): Promise<VehicleRunListResponse>
  listRunAgents(runId: string): Promise<VehicleRunAgentsResponse>
  readAgentWorld(agentId: string): Promise<VehicleAgentWorldResponse>
  previewTurnContext(agentId: string, request: VehicleTurnPreviewRequest): Promise<VehicleTurnPreviewResponse>
  pollAgentWorld(agentId: string, cursor: number): Promise<VehicleAgentWorldEventsResponse>
  postMessage(agentId: string, request: VehicleWorldMessageRequest): Promise<VehicleAgentWorldResponse>
  postComment(agentId: string, request: VehicleWorldCommentRequest): Promise<VehicleAgentWorldResponse>
  saveSystemPrompt(agentId: string, request: VehicleSystemPromptRequest): Promise<VehicleAgentWorldResponse>
  promoteSystemPrompt(agentId: string, graphId?: string | null): Promise<VehicleAgentWorldResponse>
  setAgentModel(agentId: string, request: VehicleAgentModelRequest): Promise<VehicleAgentWorldResponse>
  claimDriver(agentId: string, clientId: string, release: boolean): Promise<VehicleControlResponse>
  steer(agentId: string, clientId: string, text: string, commandId?: string | null): Promise<VehicleControlResponse>
  startWorkflow(
    workflow: VehicleWorkflowRecord,
    objective: string,
    agent?: VehicleAgentRecord | null,
  ): Promise<VehicleWorkflowRunResponse>
  startConversation(agent: VehicleAgentRecord, objective: string): Promise<VehicleWorkflowRunResponse>
  readVehicleSession(sessionId?: string | null): Promise<VehicleSession>
  submitCockpitInput(actor: string, text: string, sessionId?: string | null): Promise<VehicleSession>
  readBridgeProjection(documentId?: string | null): Promise<BridgeProjection>
  applyBridgeOperation(operation: BridgeOperation): Promise<BridgeProjection>
}

export interface VehicleWorldMessageRequest {
  readonly authorId: string
  readonly role: string
  readonly visibility: string
  readonly text: string
  readonly contextPreview?: VehicleTurnContextOverride | null
}

export interface VehicleTurnContextOverride {
  readonly systemPrompt?: string
  readonly latestMessage?: JsonRecord
  readonly agentVisiblePacket?: unknown
  readonly turnPrompt?: string
}

export interface VehicleTurnPreviewRequest {
  readonly authorId: string
  readonly role: string
  readonly visibility: string
  readonly text: string
  readonly contextPreview?: VehicleTurnContextOverride | null
}

export interface VehicleWorldCommentRequest {
  readonly authorId: string
  readonly text: string
  readonly visibility: string
  readonly kind: string
}

export interface VehicleSystemPromptRequest {
  readonly authorId: string
  readonly title?: string | null
  readonly text: string
}

export interface VehicleAgentModelRequest {
  readonly authorId: string
  readonly model: string
  readonly provider?: string | null
}

export const ROOM_TABS = ['activity', 'tools', 'comments', 'world', 'cockpit', 'bridge', 'prompt', 'schema', 'debug'] as const
const DEFAULT_LOCAL_CHOREOGRAPH_BASE_URL = 'http://127.0.0.1:3456'

export function readVehicleConfig(search = globalThis.location?.search ?? ''): VehicleConfig {
  const params = new URLSearchParams(search)
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  const fixtureParam = params.get('fixture')
  const fixture = fixtureParam === '1' || fixtureParam === 'true'
  const configuredBaseUrl = params.get('baseUrl') || env.VITE_VEHICLE_API_BASE_URL || null
  const baseUrl =
    configuredBaseUrl ?? (fixture ? '' : DEFAULT_LOCAL_CHOREOGRAPH_BASE_URL)
  const useLocalDevAuth =
    !fixture &&
    /^https?:\/\/(?:127\.0\.0\.1|localhost):3456\/?$/.test(baseUrl) &&
    !params.get('bearerToken') &&
    !params.get('internalServiceSecret') &&
    !env.VITE_CHOREOGRAPH_BEARER_TOKEN &&
    !env.VITE_CHOREOGRAPH_INTERNAL_SERVICE_SECRET
  return {
    baseUrl,
    fixture,
    clientId: params.get('clientId') ?? env.VITE_VEHICLE_CLIENT_ID ?? 'vehicle-web',
    authorId: params.get('authorId') ?? env.VITE_VEHICLE_AUTHOR_ID ?? 'vera',
    role: params.get('role') ?? env.VITE_VEHICLE_ROLE ?? 'user',
    pollMs: Number(params.get('pollMs') ?? env.VITE_VEHICLE_POLL_MS ?? '5000') || 5000,
    auth: {
      bearerToken: params.get('bearerToken') ?? env.VITE_CHOREOGRAPH_BEARER_TOKEN ?? null,
      internalServiceSecret:
        params.get('internalServiceSecret') ??
        env.VITE_CHOREOGRAPH_INTERNAL_SERVICE_SECRET ??
        (useLocalDevAuth ? 'dev-internal-secret' : null),
      userId: params.get('userId') ?? env.VITE_CHOREOGRAPH_USER_ID ?? (useLocalDevAuth ? 'vehicle-local-user' : null),
    },
  }
}

export function createVehicleService(config: VehicleConfig): VehicleService {
  if (config.fixture) return new FixtureVehicleService()
  return new FetchVehicleService(config.baseUrl, config.auth)
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    const record = asRecord(current)
    if (!(key in record)) return undefined
    current = record[key]
  }
  return current
}

export function stringAt(value: unknown, path: readonly string[]): string | null {
  const field = valueAt(value, path)
  if (typeof field === 'string') return field
  if (typeof field === 'number' || typeof field === 'boolean') return String(field)
  return null
}

export function arrayAt<T = unknown>(value: unknown, path: readonly string[]): T[] {
  const field = valueAt(value, path)
  return Array.isArray(field) ? (field as T[]) : []
}

export function compactJson(value: unknown, maxLength = 240): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return ''
  return truncate(text, maxLength)
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

export function agentDisplayName(agent: VehicleAgentRecord): string {
  return agent.handle || agent.agentId || agent.workflowName || 'agent'
}

export function agentSelector(agent: VehicleAgentRecord): string {
  return agent.agentId || agent.handle
}

export function workflowName(agent: VehicleAgentRecord): string | null {
  return agent.workflowName || agent.agentType || agent.handle || agent.agentId || null
}

export function agentSummarySelector(agent: VehicleAgentSummary): string | null {
  return agent.agentId || agent.label || agent.sessionId || null
}

export function driverLabel(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return stringAt(record, ['clientId']) ?? stringAt(record, ['holder'])
}

export function conversationMessages(world: VehicleAgentWorldResponse | null): JsonRecord[] {
  if (!world) return []
  return arrayAt<JsonRecord>(world.worldDoc.conversation, ['messages'])
}

export function projectWorkflowRecords(
  runs: readonly VehicleRunSummary[],
  agents: readonly VehicleAgentRecord[],
  definitions: readonly VehicleWorkflowRecord[] = [],
): VehicleWorkflowRecord[] {
  type MutableWorkflow = {
    workflowId: string
    label: string
    description?: string | null
    whenToUse?: string | null
    definitionSubject: string
    sourceKind: VehicleWorkflowRecord['sourceKind']
    identityKind: VehicleWorkflowRecord['identityKind']
    graphIds: Set<string>
    runs: VehicleRunSummary[]
    agents: VehicleAgentRecord[]
    phaseCount: number | null
    agentNodeCount: number | null
    archetypeUris: Set<string>
    binding: VehicleWorkflowRecord['binding']
    draft: VehicleWorkflowRecord['draft']
    runStatistics: VehicleWorkflowRecord['runStatistics']
    status: string
    updatedAt: number | null
    totalTokens: number
    ontology: JsonRecord
  }
  const byId = new Map<string, MutableWorkflow>()
  const ensure = (id: string, base?: Partial<VehicleWorkflowRecord>): MutableWorkflow => {
    const workflowId = id || 'untitled workflow'
    const existing = byId.get(workflowId)
    if (existing) {
      if (base) mergeWorkflowDefinition(existing, base)
      return existing
    }
    const next: MutableWorkflow = {
      workflowId,
      label: base?.label ?? workflowId,
      description: base?.description,
      whenToUse: base?.whenToUse,
      definitionSubject: base?.definitionSubject ?? workflowDefinitionSubject(workflowId),
      sourceKind: base?.sourceKind ?? 'current-state',
      identityKind: base?.identityKind ?? 'doc-uri',
      graphIds: new Set(base?.graphIds ?? []),
      runs: [],
      agents: [],
      phaseCount: base?.phaseCount ?? null,
      agentNodeCount: base?.agentNodeCount ?? null,
      archetypeUris: new Set(base?.archetypeUris ?? []),
      binding: base?.binding ?? null,
      draft: base?.draft ?? null,
      runStatistics: base?.runStatistics ?? null,
      status: base?.status ?? 'ready',
      updatedAt: null,
      totalTokens: 0,
      ontology: { ...(base?.ontology ?? {}) },
    }
    byId.set(workflowId, next)
    return next
  }

  for (const definition of definitions) {
    ensure(definition.workflowId, definition)
  }

  for (const run of runs) {
    const workflow = ensure(run.workflowName || 'untitled workflow')
    workflow.runs.push(run)
    if (run.graphId) workflow.graphIds.add(run.graphId)
    workflow.totalTokens += run.totalTokens ?? 0
    workflow.updatedAt = Math.max(workflow.updatedAt ?? 0, run.updatedAt ?? run.startedAt ?? 0) || workflow.updatedAt
  }

  for (const agent of agents) {
    const workflow = ensure(workflowName(agent) ?? agent.agentType ?? 'agent workflow')
    if (!workflow.agents.some((item) => agentSelector(item) === agentSelector(agent))) workflow.agents.push(agent)
    if (agent.graphId) workflow.graphIds.add(agent.graphId)
    workflow.updatedAt = Math.max(workflow.updatedAt ?? 0, agent.updatedAt ?? agent.createdAt ?? 0) || workflow.updatedAt
  }

  return [...byId.values()]
    .map((workflow) => {
      const sortedRuns = workflow.runs
        .slice()
        .sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0))
      const sortedAgents = workflow.agents
        .slice()
        .sort((a, b) => agentDisplayName(a).localeCompare(agentDisplayName(b)))
      const runIds = sortedRuns.map((run) => run.runId)
      const agentIds = sortedAgents.map((agent) => agentSelector(agent))
      const graphIds = [...workflow.graphIds].sort()
      const computedStatistics = {
        runCount: sortedRuns.length,
        latestRunStatus: sortedRuns[0]?.status ?? null,
        lastRunAt: sortedRuns[0]?.updatedAt ?? sortedRuns[0]?.startedAt ?? null,
        medianRunTokens: median(sortedRuns.map((run) => run.totalTokens).filter((value): value is number => typeof value === 'number')),
        derivedFromQuery: 'workflow_book.runStatistics(wf:Run, wf:AgentRun, wf:PageTurnDecision history for workflow)',
      }
      const statistics = sortedRuns.length ? computedStatistics : workflow.runStatistics ?? computedStatistics
      const draft = workflow.draft ?? workflowDraftFromDefinition(workflow)
      return {
        workflowId: workflow.workflowId,
        label: workflow.label,
        description: workflow.description,
        whenToUse: workflow.whenToUse,
        definitionSubject: workflow.definitionSubject,
        sourceKind: workflow.sourceKind,
        identityKind: workflow.identityKind,
        graphIds,
        status: workflowStatus(
          [...sortedRuns.map((run) => run.status), ...sortedAgents.map((agent) => agent.status ?? agent.lifecycle)],
          workflow.status,
        ),
        runCount: sortedRuns.length,
        agentCount: sortedAgents.length,
        totalTokens: workflow.totalTokens,
        latestRunId: sortedRuns[0]?.runId ?? null,
        activeRunId: sortedAgents.find((agent) => !!agent.activeRunId)?.activeRunId ?? sortedRuns[0]?.runId ?? null,
        agentIds,
        runIds,
        phaseCount: workflow.phaseCount,
        agentNodeCount: workflow.agentNodeCount,
        archetypeUris: [...workflow.archetypeUris].sort(),
        binding: workflow.binding,
        draft,
        runStatistics: statistics,
        updatedAt: workflow.updatedAt,
        ontology: {
          ...workflow.ontology,
          className: 'wf:Workflow',
          workflowId: workflow.workflowId,
          label: workflow.label,
          sourceKind: workflow.sourceKind,
          identityKind: workflow.identityKind,
          definitionSubject: workflow.definitionSubject,
          predicates: {
            'rdf:type': 'wf:Workflow',
            'wf:name': workflow.label,
            'wf:description': workflow.description,
            'wf:whenToUse': workflow.whenToUse,
            'wf:seededFrom': [...workflow.archetypeUris].sort(),
            'wf:hasRun': runIds,
            'wf:hasAgent': agentIds,
            'mnemo:graph': graphIds,
          },
          source: 'greenhouse.workflow-index',
        },
      } satisfies VehicleWorkflowRecord
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.label.localeCompare(b.label))
}

function mergeWorkflowDefinition(target: {
  label: string
  description?: string | null
  whenToUse?: string | null
  definitionSubject: string
  sourceKind: VehicleWorkflowRecord['sourceKind']
  identityKind: VehicleWorkflowRecord['identityKind']
  graphIds: Set<string>
  phaseCount: number | null
  agentNodeCount: number | null
  archetypeUris: Set<string>
  binding: VehicleWorkflowRecord['binding']
  draft: VehicleWorkflowRecord['draft']
  runStatistics: VehicleWorkflowRecord['runStatistics']
  status: string
  updatedAt: number | null
  ontology: JsonRecord
}, source: Partial<VehicleWorkflowRecord>): void {
  target.label = source.label ?? target.label
  target.description = source.description ?? target.description
  target.whenToUse = source.whenToUse ?? target.whenToUse
  target.definitionSubject = source.definitionSubject ?? target.definitionSubject
  target.sourceKind = source.sourceKind ?? target.sourceKind
  target.identityKind = source.identityKind ?? target.identityKind
  for (const graphId of source.graphIds ?? []) target.graphIds.add(graphId)
  target.phaseCount = source.phaseCount ?? target.phaseCount
  target.agentNodeCount = source.agentNodeCount ?? target.agentNodeCount
  for (const archetypeUri of source.archetypeUris ?? []) target.archetypeUris.add(archetypeUri)
  target.binding = source.binding ?? target.binding
  target.draft = source.draft ?? target.draft
  target.runStatistics = source.runStatistics ?? target.runStatistics
  target.status = source.status ?? target.status
  target.updatedAt = Math.max(target.updatedAt ?? 0, source.updatedAt ?? 0) || target.updatedAt
  target.ontology = { ...target.ontology, ...(source.ontology ?? {}) }
}

function workflowDefinitionSubject(workflowId: string): string {
  return `urn:sophia:wf:workflow:${encodeURIComponent(workflowId)}`
}

function makeWorkflowRecord(input: {
  readonly workflowId: string
  readonly label?: string
  readonly description?: string | null
  readonly whenToUse?: string | null
  readonly graphIds?: readonly string[]
  readonly agentIds?: readonly string[]
  readonly runIds?: readonly string[]
  readonly updatedAt?: number | null
}): VehicleWorkflowRecord {
  const definitionSubject = workflowDefinitionSubject(input.workflowId)
  return {
    workflowId: input.workflowId,
    label: input.label ?? input.workflowId,
    description: input.description,
    whenToUse: input.whenToUse,
    definitionSubject,
    sourceKind: 'current-state',
    identityKind: 'doc-uri',
    graphIds: input.graphIds ?? [],
    status: 'ready',
    runCount: input.runIds?.length ?? 0,
    agentCount: input.agentIds?.length ?? 0,
    totalTokens: 0,
    latestRunId: input.runIds?.[0] ?? null,
    activeRunId: input.runIds?.[0] ?? null,
    agentIds: input.agentIds ?? [],
    runIds: input.runIds ?? [],
    phaseCount: 1,
    agentNodeCount: Math.max(1, input.agentIds?.length ?? 0),
    archetypeUris: [],
    binding: null,
    draft: null,
    runStatistics: null,
    updatedAt: input.updatedAt ?? null,
    ontology: {
      className: 'wf:Workflow',
      definitionSubject,
      source: 'greenhouse.workflow-fallback',
    },
  }
}

function workflowDraftFromDefinition(workflow: {
  readonly definitionSubject: string
  readonly phaseCount: number | null
  readonly binding: VehicleWorkflowRecord['binding']
}): NonNullable<VehicleWorkflowRecord['draft']> {
  const gaps: {
    gapKind: string
    gapTarget: string
    gapBlocking: boolean
    rationale?: string | null
  }[] = []
  if (!workflow.phaseCount) {
    gaps.push({
      gapKind: 'wf:phase.missing',
      gapTarget: workflow.definitionSubject,
      gapBlocking: true,
      rationale: 'wf:Workflow requires at least one wf:Phase.',
    })
  }
  if (!workflow.binding) {
    gaps.push({
      gapKind: 'wf:WorkflowBinding.missing',
      gapTarget: workflow.definitionSubject,
      gapBlocking: false,
      rationale: 'No callable wf:WorkflowBinding is indexed for this workflow yet.',
    })
  }
  return {
    runnable: gaps.every((gap) => !gap.gapBlocking),
    gaps,
    warnings: [],
    derivedFromQuery: 'workflow_authoring_session.draft(definition subject, composition events, workflow contract)',
  }
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function workflowStatus(values: readonly string[], fallback = 'ready'): string {
  const normalized = values.map((value) => value.toLowerCase())
  if (normalized.some((value) => value === 'running' || value === 'active')) return 'running'
  if (normalized.some((value) => value === 'paused')) return 'paused'
  if (normalized.some((value) => value === 'waiting' || value === 'idle' || value === 'ready')) return 'ready'
  if (normalized.some((value) => value === 'completed')) return 'completed'
  return normalized[0] || fallback
}

export function projectWorkflowOntology(
  world: VehicleAgentWorldResponse | null,
  agent?: VehicleAgentRecord | null,
): VehicleWorkflowOntologyModel {
  if (!world) return { nodes: [], edges: [], facts: [], shapeFailures: [] }
  const worldDoc = world.worldDoc
  const ontology = asRecord(worldDoc.ontology)
  const status = asRecord(worldDoc.status)
  const runtime = asRecord(worldDoc.runtime)
  const prompt = asRecord(valueAt(worldDoc.prompts, ['system']))
  const binding = asRecord(valueAt(prompt, ['binding']))
  const promptDocument = asRecord(valueAt(ontology, ['promptDocument']))
  const toolbelt = asRecord(worldDoc.toolbelt)
  const conformsTo = asRecord(valueAt(ontology, ['conformsTo']))
  const shapeFailures = arrayAt<JsonRecord>(ontology, ['shapeFailures'])
  const sessionRecord = asRecord(world.session ?? {})

  const workflowName =
    world.run?.workflowName ??
    world.session?.workflowName ??
    agent?.workflowName ??
    stringAt(world.agent, ['workflowName']) ??
    stringAt(worldDoc.agent, ['workflowName']) ??
    stringAt(runtime, ['workflowName']) ??
    'workflow'
  const graphId =
    world.run?.graphId ??
    world.session?.graphId ??
    agent?.graphId ??
    stringAt(status, ['graphId']) ??
    stringAt(worldDoc.agent, ['graphId']) ??
    '-'
  const runId = world.run?.runId ?? stringAt(status, ['activeRunId']) ?? stringAt(runtime, ['runId']) ?? 'run'
  const sessionId = world.session?.sessionId ?? stringAt(status, ['activeSessionId']) ?? stringAt(runtime, ['sessionId'])
  const agentUri =
    stringAt(ontology, ['agentUri']) ??
    agent?.agentUri ??
    stringAt(worldDoc.agent, ['agentUri']) ??
    stringAt(world.agent, ['agentUri'])
  const activeSessionUri = stringAt(ontology, ['activeSessionUri'])
  const activeRunUri = stringAt(ontology, ['activeRunUri'])
  const agentId =
    agent?.agentId ??
    stringAt(worldDoc.agent, ['agentId']) ??
    stringAt(world.agent, ['agentId']) ??
    stringAt(sessionRecord, ['agentId']) ??
    'agent'
  const model =
    modelFromRecord(asRecord(agent ?? {})) ??
    modelFromRecord(asRecord(world.agent)) ??
    modelFromRecord(status) ??
    modelFromRecord(worldDoc.agent) ??
    modelFromRecord(sessionRecord) ??
    '-'
  const provider =
    agent?.provider ??
    stringAt(world.agent, ['provider']) ??
    stringAt(status, ['provider']) ??
    stringAt(binding, ['provider']) ??
    (model !== '-' ? providerForModel(model) : null)
  const bindingId = stringAt(binding, ['bindingId']) ?? stringAt(promptDocument, ['bindingId'])
  const snapshotId = stringAt(binding, ['snapshotId']) ?? stringAt(promptDocument, ['snapshotId'])
  const documentId =
    stringAt(promptDocument, ['documentId']) ??
    stringAt(binding, ['documentId']) ??
    stringAt(valueAt(prompt, ['document']), ['documentId'])
  const manifestId = stringAt(toolbelt, ['manifestId'])
  const tools = arrayAt<JsonRecord>(toolbelt, ['tools'])
  const messages = conversationMessages(world)
  const events = arrayAt<JsonRecord>(worldDoc.runtime, ['recentEvents'])
  const projectionVocab = stringAt(conformsTo, ['projectionVocab'])
  const contract = stringAt(conformsTo, ['contract']) ?? worldDoc.schema
  const contractVersion = stringAt(conformsTo, ['version'])

  const nodes: VehicleOntologyNode[] = []
  const edges: VehicleOntologyEdge[] = []
  const addNode = (node: VehicleOntologyNode): void => {
    if (!nodes.some((item) => item.id === node.id)) nodes.push(node)
  }
  const addEdge = (edge: VehicleOntologyEdge): void => {
    if (!edges.some((item) => item.from === edge.from && item.to === edge.to && item.predicate === edge.predicate)) {
      edges.push(edge)
    }
  }

  addNode({
    id: 'wf:Workflow',
    label: 'wf:Workflow',
    note: workflowName,
    className: 'wf:Workflow',
    evidence: { workflowName },
  })
  addNode({
    id: 'wf:Run',
    label: 'wf:Run',
    note: runId,
    className: 'wf:Run',
    evidence: { runId, status: world.run?.status, graphId },
  })
  addNode({
    id: 'wf:AgentRun',
    label: 'wf:AgentRun',
    note: world.session?.nodeKey ?? world.session?.label ?? stringAt(runtime, ['nodeKey']) ?? 'agent node',
    className: 'wf:AgentRun',
    evidence: { nodeKey: world.session?.nodeKey ?? stringAt(runtime, ['nodeKey']), label: world.session?.label },
  })
  addNode({
    id: 'agt:Agent',
    label: 'agt:Agent',
    note: agentUri ?? agentId,
    className: 'agt:Agent',
    evidence: { agentId, agentUri, handle: agent?.handle ?? stringAt(worldDoc.agent, ['handle']) },
  })
  addNode({
    id: 'agt:Session',
    label: 'agt:Session',
    note: activeSessionUri ?? sessionId ?? 'no active session',
    className: 'agt:Session',
    evidence: { sessionId, activeSessionUri, model, provider },
  })
  addNode({
    id: 'agt:Run',
    label: 'agt:Run',
    note: activeRunUri ?? runId,
    className: 'agt:Run',
    evidence: { runId, activeRunUri, model, provider },
  })
  addNode({
    id: 'agt:Turn',
    label: 'agt:Turn',
    note: `${events.length || messages.length} recent events`,
    className: 'agt:Turn',
    evidence: { recentEvents: events.length, messages: messages.length },
  })
  addNode({
    id: 'agt:PromptBinding',
    label: 'Prompt Binding',
    note: compactParts([bindingId, model]),
    className: 'agt:PromptBinding',
    evidence: { bindingId, snapshotId, model, provider },
  })
  addNode({
    id: 'doc:Prompt',
    label: 'Prompt Doc',
    note: documentId ?? stringAt(prompt, ['title']) ?? 'system prompt',
    className: 'doc:Prompt',
    evidence: { documentId, snapshotId, digest: stringAt(prompt, ['digest']) },
  })
  addNode({
    id: 'agt:ToolManifest',
    label: 'Tool Manifest',
    note: compactParts([manifestId, tools.length ? `${tools.length} tools` : null]),
    className: 'agt:ToolManifest',
    evidence: { manifestId, manifestHash: stringAt(toolbelt, ['manifestHash']), toolCount: tools.length },
  })
  addNode({
    id: 'agt:Capability',
    label: 'Capabilities',
    note: compactParts([
      stringAt(toolbelt, ['toolMode']),
      stringAt(toolbelt, ['mcpProfile']),
      stringAt(toolbelt, ['counts', 'mounted']) ? `${stringAt(toolbelt, ['counts', 'mounted'])} mounted` : null,
    ]),
    className: 'agt:Capability',
    evidence: { toolMode: stringAt(toolbelt, ['toolMode']), mcpProfile: stringAt(toolbelt, ['mcpProfile']) },
  })
  addNode({
    id: 'agt:SessionState',
    label: 'Session State',
    note: compactParts([world.session?.status ?? stringAt(runtime, ['status']), driverLabel(valueAt(worldDoc.control, ['driverLease']))]),
    className: 'agt:SessionState',
    evidence: { status: world.session?.status ?? stringAt(runtime, ['status']), control: worldDoc.control },
  })
  addNode({
    id: 'mnemo:Graph',
    label: 'Graph',
    note: graphId,
    className: 'mnemo:Graph',
    evidence: { graphId },
  })
  addNode({
    id: 'contract:AgentWorld',
    label: 'Contract',
    note: compactParts([contract, contractVersion, projectionVocab]),
    className: 'contract:AgentWorld',
    evidence: { contract, version: contractVersion, projectionVocab },
  })
  addNode({
    id: 'shape:Gate',
    label: shapeFailures.length ? 'Shape Drift' : 'Shape Gate',
    note: shapeFailures.length ? `${shapeFailures.length} failure(s)` : 'conformant',
    className: 'shape:Gate',
    evidence: { failures: shapeFailures },
  })

  addEdge({ from: 'wf:Workflow', to: 'wf:Run', predicate: 'wf:hasRun', kind: 'predicate' })
  addEdge({ from: 'wf:Run', to: 'wf:AgentRun', predicate: 'wf:hasAgentRun', kind: 'predicate' })
  addEdge({ from: 'wf:AgentRun', to: 'agt:Turn', predicate: 'agt:realizedBy', kind: 'predicate' })
  addEdge({ from: 'agt:Turn', to: 'agt:Run', predicate: 'agt:inRun', kind: 'predicate' })
  addEdge({ from: 'agt:Run', to: 'agt:Session', predicate: 'agt:ofSession', kind: 'predicate' })
  addEdge({ from: 'agt:Session', to: 'agt:Agent', predicate: 'agt:ofAgent', kind: 'predicate' })
  addEdge({ from: 'agt:Session', to: 'agt:PromptBinding', predicate: 'agt:systemPromptBinding', kind: 'wire' })
  addEdge({ from: 'agt:PromptBinding', to: 'doc:Prompt', predicate: 'agt:systemPromptDocument', kind: 'wire' })
  addEdge({ from: 'agt:Agent', to: 'agt:ToolManifest', predicate: 'agt:toolManifest', kind: 'wire' })
  addEdge({ from: 'agt:ToolManifest', to: 'agt:Capability', predicate: 'agt:capability', kind: 'wire' })
  addEdge({ from: 'agt:Session', to: 'agt:SessionState', predicate: 'agt:state', kind: 'wire' })
  addEdge({ from: 'agt:Session', to: 'mnemo:Graph', predicate: 'mnemo:graph', kind: 'wire' })
  addEdge({ from: 'agt:SessionState', to: 'contract:AgentWorld', predicate: 'conformsTo', kind: 'predicate' })
  addEdge({ from: 'contract:AgentWorld', to: 'shape:Gate', predicate: 'validatedBy', kind: 'predicate' })

  const facts: VehicleWorkflowOntologyFact[] = [
    { label: 'workflow', value: workflowName },
    { label: 'wf run', value: runId },
    { label: 'agt session', value: activeSessionUri ?? sessionId ?? '-' },
    { label: 'agt run', value: activeRunUri ?? runId },
    { label: 'agent witness', value: agentUri ?? agentId },
    { label: 'model', value: compactParts([provider, model]) || '-' },
    { label: 'prompt binding', value: bindingId ?? '-' },
    { label: 'contract', value: compactParts([contract, contractVersion]) || '-', tone: 'good' },
    {
      label: 'shape gate',
      value: shapeFailures.length ? `${shapeFailures.length} failure(s)` : 'conformant',
      tone: shapeFailures.length ? 'danger' : 'good',
    },
  ]

  return { nodes, edges, facts, shapeFailures }
}

export function activityItems(events: readonly VehicleAgentSessionEvent[]): VehicleActivityItem[] {
  return events.flatMap((event, eventIndex) => {
    const item = activityItem(event, eventIndex)
    return item ? [item] : []
  })
}

export interface AgentJournalProjectionInput {
  readonly world: VehicleAgentWorldResponse | null
  readonly agent?: VehicleAgentRecord | null
  readonly events: readonly VehicleAgentSessionEvent[]
  readonly now?: number
}

export function agentJournalItems(input: AgentJournalProjectionInput): VehicleActivityItem[] {
  const eventItems = activityItems(input.events)
  const projected = projectedAgentOntologyItems(input)
  const byId = new Map<string, VehicleActivityItem>()
  for (const item of [...projected, ...eventItems]) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => {
    const delta = (a.event.ts || 0) - (b.event.ts || 0)
    if (delta !== 0) return delta
    return a.seq - b.seq
  })
}

export function activityItem(
  event: VehicleAgentSessionEvent,
  eventIndex: number,
): VehicleActivityItem | null {
  const payload = event.payload
  const turnId = stringAt(payload, ['turnId'])
  const toolName = stringAt(payload, ['toolName']) ?? 'tool'
  const message = asRecord(valueAt(payload, ['message']))
  switch (event.type) {
    case 'conversation.message.created': {
      const author =
        stringAt(message, ['authorId']) ??
        stringAt(message, ['author']) ??
        stringAt(message, ['role']) ??
        stringAt(payload, ['authorId']) ??
        'message'
      const role = stringAt(message, ['role']) ?? stringAt(payload, ['role']) ?? 'message'
      const text =
        stringAt(message, ['text']) ??
        stringAt(message, ['content']) ??
        stringAt(payload, ['text']) ??
        compactJson(message, 180)
      return makeActivity(event, eventIndex, 'message', `${author}/${role}`, text, 'completed')
    }
    case 'conversation.turn.queued':
      return makeActivity(event, eventIndex, 'turn', 'queued', turnId ? `turn ${shortId(turnId)}` : 'queued', 'idle')
    case 'conversation.turn.tool.started':
      return makeActivity(event, eventIndex, 'tool', toolName, toolCallSummary(payload), 'running')
    case 'conversation.turn.tool.completed':
      return makeActivity(event, eventIndex, 'tool', `${toolName} ok`, toolResultSummary(payload, false), 'completed')
    case 'conversation.turn.tool.failed':
      return makeActivity(event, eventIndex, 'tool', `${toolName} failed`, toolResultSummary(payload, true), 'error')
    case 'conversation.turn.agent.error':
      return makeActivity(event, eventIndex, 'agent', 'error', stringAt(payload, ['error']) ?? '', 'error')
    case 'conversation.turn.agent.truncated':
      return makeActivity(event, eventIndex, 'agent', 'truncated', stringAt(payload, ['preview']) ?? '', 'warning')
    case 'conversation.turn.sandbox.terminal': {
      const state = stringAt(payload, ['state']) ?? 'terminal'
      if (state === 'done') return null
      return makeActivity(
        event,
        eventIndex,
        'sandbox',
        state,
        stringAt(payload, ['result', 'output']) ?? '',
        'idle',
      )
    }
    case 'conversation.turn.completed':
      return makeActivity(event, eventIndex, 'turn', 'complete', turnSummary(payload), 'completed')
    case 'conversation.turn.failed':
      return makeActivity(
        event,
        eventIndex,
        'turn',
        'failed',
        stringAt(payload, ['error']) ?? stringAt(payload, ['reason']) ?? '',
        'error',
      )
    case 'agent.toolbelt.resolved':
      return makeActivity(event, eventIndex, 'tools', 'resolved', toolbeltSummary(payload), 'completed')
    case 'agent.prompt.system.updated':
      return makeActivity(
        event,
        eventIndex,
        'prompt',
        'system changed',
        promptEventSummary(payload),
        'completed',
      )
    case 'agent.prompt.system.promoted':
      return makeActivity(
        event,
        eventIndex,
        'prompt',
        'promoted to graph',
        promptEventSummary(payload),
        'completed',
      )
    case 'agent.model.changed':
      return makeActivity(event, eventIndex, 'agent', 'model changed', modelEventSummary(payload), 'completed')
    case 'agent.created':
      return makeActivity(event, eventIndex, 'agent', 'created', compactJson(payload, 180), 'completed')
    case 'agent.updated':
    case 'agent.lifecycle.changed':
      return makeActivity(event, eventIndex, 'agent', ontologyEventTitle(event.type), compactJson(payload, 180), 'completed')
    case 'control.driver-claimed':
    case 'control.driver-released':
    case 'control.driver.claimed':
    case 'control.driver.released':
    case 'control.steered':
      return makeActivity(event, eventIndex, 'control', event.type.replace('control.', ''), compactJson(payload, 180), 'completed')
    default:
      if (isOntologyHistoryEvent(event.type)) {
        return makeActivity(
          event,
          eventIndex,
          ontologyEventLabel(event.type),
          ontologyEventTitle(event.type),
          compactJson(payload, 180),
          ontologyEventStatus(event.type),
        )
      }
      return null
  }
}

function projectedAgentOntologyItems(input: AgentJournalProjectionInput): VehicleActivityItem[] {
  const { world, agent } = input
  if (!world) return []
  const now = input.now ?? Date.now()
  const firstEventTs = input.events[0]?.ts
  const currentAgent = asRecord(world.worldDoc.agent)
  const status = asRecord(world.worldDoc.status)
  const prompt = asRecord(valueAt(world.worldDoc.prompts, ['system']))
  const toolbelt = asRecord(world.worldDoc.toolbelt)
  const agentRecord = asRecord(agent ?? {})
  const graphId = stringAt(status, ['graphId']) ?? stringAt(currentAgent, ['graphId']) ?? world.run?.graphId ?? agent?.graphId
  const handle = agent?.handle ?? stringAt(currentAgent, ['handle']) ?? stringAt(world.agent, ['handle']) ?? 'agent'
  const model =
    modelFromRecord(agentRecord) ??
    modelFromRecord(asRecord(world.agent)) ??
    modelFromRecord(status) ??
    modelFromRecord(currentAgent) ??
    modelFromRecord(asRecord(world.session ?? {}))
  const updatedAt = firstTimestamp(
    agent?.updatedAt,
    valueAt(currentAgent, ['updatedAt']),
    valueAt(world.agent, ['updatedAt']),
    valueAt(status, ['updatedAt']),
  )
  const createdAt = firstTimestamp(
    agent?.createdAt,
    valueAt(agentRecord, ['createdAt']),
    valueAt(currentAgent, ['createdAt']),
    valueAt(world.agent, ['createdAt']),
    valueAt(status, ['createdAt']),
    world.run?.startedAt,
    firstEventTs,
  )
  const baseTs = createdAt ?? updatedAt ?? firstEventTs ?? now
  const items: VehicleActivityItem[] = [
    makeProjectionActivity(
      'agent-created',
      baseTs,
      createdAt ? 'agent.created.projected' : 'agent.observed.projected',
      'agent',
      createdAt ? 'created' : 'observed',
      compactParts([
        handle,
        agent?.agentType ?? stringAt(currentAgent, ['agentType']),
        agent?.workflowName ?? stringAt(currentAgent, ['workflowName']),
        model,
      ]),
      'completed',
    ),
  ]

  if (updatedAt) {
    items.push(
      makeProjectionActivity(
        'agent-updated',
        updatedAt,
        'agent.updated.projected',
        'agent',
        'updated',
        compactParts([
          agent?.lifecycle ?? stringAt(status, ['lifecycle']),
          agent?.status ?? stringAt(status, ['runtimeStatus']),
          agent?.activeRunId ?? stringAt(status, ['activeRunId']),
          agent?.activeSessionId ?? stringAt(status, ['activeSessionId']),
        ]),
        'completed',
      ),
    )
  }

  if (graphId) {
    items.push(
      makeProjectionActivity(
        'agent-graph',
        updatedAt ?? baseTs,
        'agent.graph.bound.projected',
        'graph',
        'bound',
        graphId,
        'completed',
      ),
    )
  }

  if (model) {
    items.push(
      makeProjectionActivity(
        'agent-model',
        updatedAt ?? baseTs,
        'agent.model.projected',
        'agent',
        'model',
        model,
        'completed',
      ),
    )
  }

  if (world.run?.runId) {
    items.push(
      makeProjectionActivity(
        'agent-run',
        world.run.startedAt ?? world.run.updatedAt ?? baseTs,
        'agent.run.projected',
        'run',
        world.run.status || 'active',
        compactParts([world.run.runId, world.run.workflowName, world.run.totalTokens ? `${world.run.totalTokens} tokens` : null]),
        world.run.status === 'failed' ? 'error' : world.run.status === 'running' ? 'running' : 'completed',
      ),
    )
  }

  const sessionId = world.session?.sessionId ?? stringAt(status, ['activeSessionId'])
  if (sessionId) {
    items.push(
      makeProjectionActivity(
        'agent-session',
        world.run?.updatedAt ?? updatedAt ?? baseTs,
        'agent.session.projected',
        'session',
        world.session?.status ?? 'active',
        compactParts([sessionId, world.session?.model, stringAt(status, ['activeSandboxId'])]),
        world.session?.status === 'failed' ? 'error' : 'completed',
      ),
    )
  }

  const promptDigest = stringAt(prompt, ['digest'])
  const promptUpdatedAt = firstTimestamp(valueAt(prompt, ['updatedAt']), valueAt(world.worldDoc.prompts, ['updatedAt']))
  if (promptDigest || stringAt(prompt, ['text'])) {
    items.push(
      makeProjectionActivity(
        'system-prompt',
        promptUpdatedAt ?? updatedAt ?? baseTs,
        'agent.prompt.system.projected',
        'prompt',
        promptUpdatedAt ? 'system changed' : 'system loaded',
        compactParts([
          stringAt(prompt, ['title']) ?? 'system prompt',
          promptDigest,
          stringAt(prompt, ['updatedBy']) ? `by ${stringAt(prompt, ['updatedBy'])}` : null,
        ]),
        'completed',
      ),
    )
  }

  const manifestId = stringAt(toolbelt, ['manifestId'])
  const toolCount = arrayAt<JsonRecord>(toolbelt, ['tools']).length
  if (manifestId || toolCount) {
    items.push(
      makeProjectionActivity(
        'toolbelt',
        updatedAt ?? baseTs,
        'agent.toolbelt.projected',
        'tools',
        'mounted',
        compactParts([manifestId, toolCount ? `${toolCount} declared` : null, stringAt(toolbelt, ['toolMode'])]),
        'completed',
      ),
    )
  }

  return items
}

function makeActivity(
  event: VehicleAgentSessionEvent,
  eventIndex: number,
  label: string,
  title: string,
  detail: string,
  status: VehicleActivityItem['status'],
): VehicleActivityItem {
  return {
    id: `${event.seq}:${event.type}`,
    eventIndex,
    seq: event.seq,
    origin: 'event',
    label,
    title,
    detail,
    status,
    event,
  }
}

function makeProjectionActivity(
  id: string,
  ts: number,
  type: string,
  label: string,
  title: string,
  detail: string,
  status: VehicleActivityItem['status'],
): VehicleActivityItem {
  return {
    id: `projection:${id}`,
    eventIndex: -1,
    seq: 0,
    origin: 'projection',
    label,
    title,
    detail,
    status,
    event: {
      sessionId: 'agent-ontology',
      seq: 0,
      ts,
      type,
      payload: { projected: true, detail },
    },
  }
}

function shortId(value: string): string {
  return truncate(value, 12)
}

function compactParts(parts: readonly unknown[]): string {
  return parts
    .map((part) => (part == null ? '' : String(part)))
    .filter((part) => part.trim())
    .join(' · ')
}

function firstTimestamp(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function promptEventSummary(payload: JsonRecord): string {
  return compactParts([
    stringAt(payload, ['digest']) ? `digest ${stringAt(payload, ['digest'])}` : null,
    stringAt(payload, ['chars']) ? `${stringAt(payload, ['chars'])} chars` : null,
    stringAt(payload, ['authorId']) ? `by ${stringAt(payload, ['authorId'])}` : null,
  ]) || compactJson(payload, 180)
}

function modelEventSummary(payload: JsonRecord): string {
  return compactParts([
    stringAt(payload, ['previousModel']) ?? stringAt(payload, ['from']),
    '->',
    stringAt(payload, ['model']) ?? stringAt(payload, ['to']),
    stringAt(payload, ['provider']) ? `via ${stringAt(payload, ['provider'])}` : null,
    stringAt(payload, ['authorId']) ? `by ${stringAt(payload, ['authorId'])}` : null,
  ]) || compactJson(payload, 180)
}

function isOntologyHistoryEvent(type: string): boolean {
  return /^(agent|prompt|ontology|graph|world|run|session|toolbelt)\./.test(type)
}

function ontologyEventLabel(type: string): string {
  const [head] = type.split('.')
  if (head === 'toolbelt') return 'tools'
  return head || 'event'
}

function ontologyEventTitle(type: string): string {
  const [, ...rest] = type.split('.')
  const raw = rest.length ? rest.join('.') : type
  return raw.replace(/[._-]+/g, ' ')
}

function ontologyEventStatus(type: string): VehicleActivityItem['status'] {
  if (/(failed|error)/.test(type)) return 'error'
  if (/blocked/.test(type)) return 'blocked'
  if (/(started|running)/.test(type)) return 'running'
  if (/truncated/.test(type)) return 'warning'
  return 'completed'
}

function toolCallSummary(payload: JsonRecord): string {
  const toolName = stringAt(payload, ['toolName']) ?? 'tool'
  const args = asRecord(valueAt(payload, ['args']))
  if (toolName === 'recall') return `query ${JSON.stringify(stringAt(args, ['query']) ?? '')}`
  if (toolName === 'search_documents') return `search ${JSON.stringify(stringAt(args, ['query']) ?? '')}`
  if (toolName === 'remember') return truncate(stringAt(args, ['content']) ?? 'write memory', 64)
  if (toolName === 'done') return truncate(stringAt(args, ['summary']) ?? 'finish turn', 64)
  return Object.keys(args).length ? compactJson(args, 80) : 'called'
}

function toolResultSummary(payload: JsonRecord, failed: boolean): string {
  const result = stringAt(payload, ['result']) ?? stringAt(payload, ['resultPreview']) ?? ''
  if (failed) return result ? `error ${truncate(result, 64)}` : 'error'
  return result ? truncate(result, 80) : 'complete'
}

function toolbeltSummary(payload: JsonRecord): string {
  const mounted = stringAt(payload, ['counts', 'mounted']) ?? `${arrayAt(payload, ['mountedTools']).length}`
  const declared = stringAt(payload, ['counts', 'declared']) ?? mounted
  const failures = stringAt(payload, ['counts', 'failures']) ?? '0'
  const mode = stringAt(payload, ['toolMode']) ?? '-'
  return failures !== '0'
    ? `${mounted}/${declared} mounted · ${failures} failed · ${mode}`
    : `${mounted}/${declared} mounted · ${mode}`
}

function turnSummary(payload: JsonRecord): string {
  const bits = []
  const tools = stringAt(payload, ['toolCalls'])
  const tokens = stringAt(payload, ['tokens'])
  if (tools) bits.push(`${tools} tools`)
  if (tokens) bits.push(`${tokens} tok`)
  return bits.length ? bits.join(' · ') : 'done'
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function normalizeWorld(value: unknown): VehicleAgentWorldResponse {
  const record = asRecord(value)
  return {
    agent: asRecord(record.agent),
    worldDoc: normalizeWorldDoc(record.worldDoc),
    agentVisiblePacket: record.agentVisiblePacket,
    session: record.session ? (record.session as VehicleAgentSummary) : null,
    run: record.run ? (record.run as VehicleRunSummary) : null,
  }
}

function normalizeAgentList(value: unknown): VehicleAgentListResponse {
  const record = asRecord(value)
  const agents = arrayAt<unknown>(record, ['agents']).map(normalizeAgentRecord)
  return {
    agents,
    count: Number(record.count ?? agents.length),
  }
}

function normalizeAgentRecord(value: unknown): VehicleAgentRecord {
  const record = asRecord(value)
  const model = modelFromRecord(record)
  return {
    ...(record as unknown as VehicleAgentRecord),
    agentId: stringAt(record, ['agentId']) ?? stringAt(record, ['agent_id']) ?? stringAt(record, ['id']) ?? '',
    handle: stringAt(record, ['handle']) ?? stringAt(record, ['label']) ?? '',
    graphId: stringAt(record, ['graphId']) ?? stringAt(record, ['graph_id']) ?? '-',
    lifecycle: stringAt(record, ['lifecycle']) ?? stringAt(record, ['status']) ?? 'dormant',
    ...(model ? { model } : {}),
  }
}

function normalizeWorkflowList(value: unknown): VehicleWorkflowListResponse {
  const record = asRecord(value)
  const workflows = arrayAt<unknown>(record, ['workflows']).map(normalizeWorkflowRecord)
  return {
    workflows,
    count: Number(record.count ?? workflows.length),
  }
}

function normalizeWorkflowRecord(value: unknown): VehicleWorkflowRecord {
  const record = asRecord(value)
  const runIds = workflowStringList(record, 'runIds', 'run_ids')
  const agentIds = workflowStringList(record, 'agentIds', 'agent_ids')
  const graphIds = workflowStringList(record, 'graphIds', 'graph_ids')
  const workflowId =
    stringAt(record, ['workflowId']) ??
    stringAt(record, ['workflow_id']) ??
    stringAt(record, ['id']) ??
    stringAt(record, ['name']) ??
    stringAt(record, ['label']) ??
    'workflow'
  const label = stringAt(record, ['label']) ?? stringAt(record, ['name']) ?? workflowId
  const definitionSubject =
    stringAt(record, ['definitionSubject']) ??
    stringAt(record, ['definition_subject']) ??
    workflowDefinitionSubject(workflowId)
  return {
    workflowId,
    label,
    description: stringAt(record, ['description']),
    whenToUse: stringAt(record, ['whenToUse']) ?? stringAt(record, ['when_to_use']),
    definitionSubject,
    sourceKind: workflowSourceKind(stringAt(record, ['sourceKind']) ?? stringAt(record, ['source_kind'])),
    identityKind: workflowIdentityKind(stringAt(record, ['identityKind']) ?? stringAt(record, ['identity_kind'])),
    graphIds,
    status: stringAt(record, ['status']) ?? 'ready',
    runCount: Number(record.runCount ?? record.run_count ?? runIds.length),
    agentCount: Number(record.agentCount ?? record.agent_count ?? agentIds.length),
    totalTokens: Number(record.totalTokens ?? record.total_tokens ?? 0),
    latestRunId: stringAt(record, ['latestRunId']) ?? stringAt(record, ['latest_run_id']),
    activeRunId: stringAt(record, ['activeRunId']) ?? stringAt(record, ['active_run_id']),
    agentIds,
    runIds,
    phaseCount: Number(record.phaseCount ?? record.phase_count ?? 0) || null,
    agentNodeCount: Number(record.agentNodeCount ?? record.agent_node_count ?? 0) || null,
    archetypeUris: workflowStringList(record, 'archetypeUris', 'archetype_uris'),
    binding: normalizeWorkflowBinding(record.binding ?? record.workflowBinding ?? record.workflow_binding, workflowId),
    draft: normalizeWorkflowDraft(record.draft),
    runStatistics: normalizeWorkflowRunStatistics(record.runStatistics ?? record.run_statistics),
    updatedAt: Number(record.updatedAt ?? record.updated_at ?? 0) || null,
    ontology: asRecord(record.ontology),
  }
}

function workflowStringList(record: JsonRecord, camelKey: string, snakeKey: string): string[] {
  const value = record[camelKey] ?? record[snakeKey]
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function workflowSourceKind(value: string | null): VehicleWorkflowRecord['sourceKind'] {
  if (value === 'event-log' || value === 'derived' || value === 'current-state') return value
  return 'current-state'
}

function workflowIdentityKind(value: string | null): VehicleWorkflowRecord['identityKind'] {
  if (value === 'logical-id' || value === 'event-id' || value === 'resolve-by-query' || value === 'urn-template') {
    return value
  }
  return 'doc-uri'
}

function normalizeWorkflowBinding(value: unknown, workflowId: string): VehicleWorkflowRecord['binding'] {
  const record = asRecord(value)
  if (!Object.keys(record).length) return null
  const inputSchema = record.inputSchema ?? record.input_schema
  const outputSchema = record.outputSchema ?? record.output_schema
  return {
    bindingId:
      stringAt(record, ['bindingId']) ??
      stringAt(record, ['binding_id']) ??
      `${workflowId}:binding`,
    operationId: stringAt(record, ['operationId']) ?? stringAt(record, ['operation_id']),
    executor: stringAt(record, ['executor']) ?? 'choreograph',
    workflowName: stringAt(record, ['workflowName']) ?? stringAt(record, ['workflow_name']) ?? workflowId,
    inputSchema: typeof inputSchema === 'string' ? inputSchema : asRecord(inputSchema),
    outputSchema: typeof outputSchema === 'string' ? outputSchema : asRecord(outputSchema),
    requiresAuth: typeof record.requiresAuth === 'boolean'
      ? record.requiresAuth
      : typeof record.requires_auth === 'boolean'
        ? record.requires_auth
        : null,
  }
}

function normalizeWorkflowDraft(value: unknown): VehicleWorkflowRecord['draft'] {
  const record = asRecord(value)
  if (!Object.keys(record).length) return null
  const gaps = arrayAt<JsonRecord>(record, ['gaps']).map((gap) => ({
    gapKind: stringAt(gap, ['gapKind']) ?? stringAt(gap, ['gap_kind']) ?? 'wf:gap',
    gapTarget: stringAt(gap, ['gapTarget']) ?? stringAt(gap, ['gap_target']) ?? '-',
    gapBlocking: valueAt(gap, ['gapBlocking']) === true || valueAt(gap, ['gap_blocking']) === true,
    rationale: stringAt(gap, ['rationale']),
  }))
  return {
    runnable: valueAt(record, ['runnable']) === true,
    gaps,
    warnings: arrayAt<unknown>(record, ['warnings']).map((item) => String(item)),
    derivedFromQuery:
      stringAt(record, ['derivedFromQuery']) ??
      stringAt(record, ['derived_from_query']) ??
      'workflow_authoring_session.draft(definition subject, composition events, workflow contract)',
  }
}

function normalizeWorkflowRunStatistics(value: unknown): VehicleWorkflowRecord['runStatistics'] {
  const record = asRecord(value)
  if (!Object.keys(record).length) return null
  return {
    runCount: Number(record.runCount ?? record.run_count ?? 0),
    latestRunStatus: stringAt(record, ['latestRunStatus']) ?? stringAt(record, ['latest_run_status']),
    lastRunAt: Number(record.lastRunAt ?? record.last_run_at ?? 0) || null,
    medianRunTokens: Number(record.medianRunTokens ?? record.median_run_tokens ?? 0) || null,
    derivedFromQuery:
      stringAt(record, ['derivedFromQuery']) ??
      stringAt(record, ['derived_from_query']) ??
      'workflow_book.runStatistics(wf:Run, wf:AgentRun, wf:PageTurnDecision history for workflow)',
  }
}

function normalizeWorldDoc(value: unknown): VehicleAgentWorldDoc {
  const record = asRecord(value)
  return {
    schema: stringAt(record, ['schema']) ?? 'choreograph.agent_world.v1',
    agent: asRecord(record.agent),
    status: asRecord(record.status),
    prompts: asRecord(record.prompts),
    toolbelt: asRecord(record.toolbelt),
    schemas: asRecord(record.schemas),
    world: asRecord(record.world),
    memory: asRecord(record.memory),
    conversation: asRecord(record.conversation),
    runtime: asRecord(record.runtime),
    control: asRecord(record.control),
    collaborators: asRecord(record.collaborators),
    codex: asRecord(record.codex),
    ontology: asRecord(record.ontology),
  }
}

export function projectVehicleSession(value: unknown): VehicleSession {
  const record = asRecord(value)
  const session = asRecord(record.session)
  const document = asRecord(record.document)
  const control = asRecord(valueAt(document, ['control']))
  const driverLease = asRecord(valueAt(control, ['driverLease']))
  const revision = Number(record.documentRevision ?? valueAt(document, ['collab', 'revision']) ?? 0)
  const sessionId = stringAt(session, ['sessionId']) ?? stringAt(document, ['sessionId']) ?? 'agent-session'
  const graphId = stringAt(session, ['graphId']) ?? stringAt(document, ['source', 'graphId']) ?? '-'
  const source = asRecord(valueAt(document, ['source']))
  const runtime = asRecord(valueAt(document, ['runtime']))
  return {
    sessionId,
    graphId,
    runId: stringAt(session, ['runId']) ?? stringAt(source, ['runId']),
    workflowName: stringAt(session, ['workflowName']) ?? stringAt(source, ['workflowName']),
    agentId: stringAt(session, ['agentId']) ?? stringAt(source, ['agentId']),
    agentLabel: stringAt(session, ['label']) ?? stringAt(source, ['label']),
    model:
      firstNonBlankString(
        modelFromRecord(session),
        modelFromRecord(source),
        modelFromRecord(runtime),
        modelFromRecord(asRecord(valueAt(session, ['result']))),
        modelFromRecord(asRecord(valueAt(document, ['prompts', 'system', 'binding']))),
      ) ??
      knownAgentModel([
        stringAt(session, ['workflowName']),
        stringAt(source, ['workflowName']),
        stringAt(session, ['label']),
        stringAt(source, ['label']),
        stringAt(session, ['agentId']),
      ]) ??
      '',
    status: stringAt(session, ['status']) ?? stringAt(runtime, ['status']),
    sandboxId: stringAt(session, ['sandboxId']) ?? stringAt(runtime, ['sandboxId']),
    revision,
    driver: {
      holder: driverLabel(driverLease) ?? 'unclaimed',
      epoch: Number(valueAt(driverLease, ['epoch']) ?? revision),
      expiresAt: stringAt(driverLease, ['expiresAt']),
    },
    presences: projectVehiclePresences(session, document),
    panes: projectVehiclePanes(session, document, revision),
    transcript: projectVehicleTranscript(document),
    inputDraft: '',
    pendingControlEvents: arrayAt<JsonRecord>(control, ['steeringQueue']).map((item) => ({
      actor: stringAt(item, ['clientId']) ?? stringAt(item, ['actor']) ?? 'driver',
      text: stringAt(item, ['text']) ?? compactJson(item, 160),
    })),
  }
}

function projectVehiclePresences(session: JsonRecord, document: JsonRecord): VehicleSession['presences'] {
  const sessionId = stringAt(session, ['sessionId']) ?? stringAt(document, ['sessionId']) ?? 'session'
  const label = stringAt(session, ['label']) ?? stringAt(document, ['source', 'label']) ?? 'agent'
  const status = stringAt(session, ['status']) ?? stringAt(document, ['runtime', 'status']) ?? 'attached'
  return [
    {
      userId: stringAt(session, ['agentId']) ?? sessionId,
      displayName: label,
      focus: status,
    },
  ]
}

function projectVehiclePanes(
  session: JsonRecord,
  document: JsonRecord,
  revision: number,
): VehicleSession['panes'] {
  const panes: VehiclePane[] = arrayAt<JsonRecord>(document, ['view', 'panes']).map((pane) => {
    const kind = (stringAt(pane, ['kind']) ?? 'agent') as VehiclePaneKind
    return {
      paneId: stringAt(pane, ['id']) ?? kind,
      kind,
      title: titleCase(kind),
      state: stringAt(session, ['status']) ?? stringAt(document, ['runtime', 'status']),
    }
  })
  const prompt = asRecord(valueAt(document, ['prompts', 'system']))
  const promptText = stringAt(prompt, ['text'])
  if (promptText) {
    panes.push({
      paneId: 'prompt:system',
      kind: 'prompt',
      title: stringAt(prompt, ['title']) ?? 'System prompt',
      state: stringAt(prompt, ['digest']) ?? null,
      output: promptText,
    })
  }
  const runtime = asRecord(valueAt(document, ['runtime']))
  panes.push({
    paneId: 'runtime',
    kind: 'runtime',
    title: 'Runtime',
    state: stringAt(runtime, ['status']) ?? stringAt(session, ['status']) ?? null,
    output: `revision ${revision}${stringAt(runtime, ['sandboxId']) ? ` · ${stringAt(runtime, ['sandboxId'])}` : ''}`,
  })
  return panes
}

function projectVehicleTranscript(document: JsonRecord): VehicleSession['transcript'] {
  const transcript = asRecord(valueAt(document, ['transcript']))
  const items = asRecord(valueAt(transcript, ['items']))
  return arrayAt<string>(transcript, ['order']).map((id, index) => {
    const item = asRecord(items[id])
    return {
      seq: index + 1,
      source: stringAt(item, ['role']) ?? stringAt(item, ['kind']) ?? 'event',
      text: stringAt(item, ['text']) ?? compactJson(item, 240),
    }
  })
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function firstNonBlankString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

export function modelFromRecord(record: JsonRecord | null | undefined): string | null {
  if (!record) return null
  return firstNonBlankString(
    stringAt(record, ['model']),
    stringAt(record, ['modelId']),
    stringAt(record, ['model_id']),
    stringAt(record, ['llmModel']),
    stringAt(record, ['providerModel']),
    stringAt(record, ['inferenceModel']),
    stringAt(record, ['binding', 'model']),
    stringAt(record, ['identityMaterial', 'model']),
    stringAt(record, ['config', 'model']),
    stringAt(record, ['metadata', 'model']),
    stringAt(record, ['result', 'model']),
  )
}

export function knownAgentModel(values: readonly (string | null | undefined)[]): string | null {
  const normalized = values
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase())
  if (normalized.some((value) => value === 'learner-1' || value.includes('learner-1'))) {
    return 'deepseek-v4-pro'
  }
  return null
}

function providerForModel(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('deepseek')) return 'deepseek'
  if (/^claude-/.test(lower)) return 'anthropic'
  if (/^gpt-|^o[13]-/.test(lower)) return 'openai'
  if (/^gemini-/.test(lower)) return 'google'
  if (/^kimi-/.test(lower)) return 'moonshot'
  if (lower.includes(':')) return lower.split(':', 1)[0] || 'unknown'
  return 'unknown'
}

function isWorldResponse(value: unknown): boolean {
  return !!valueAt(value, ['worldDoc'])
}

export class FetchVehicleService implements VehicleService {
  readonly mode = 'fetch' as const
  readonly baseUrl: string
  private readonly auth: VehicleAuthConfig

  constructor(baseUrl: string, auth: VehicleAuthConfig = {}) {
    this.baseUrl = baseUrl.trim().replace(/\/$/, '')
    this.auth = auth
  }

  async listAgents(limit = 100): Promise<VehicleAgentListResponse> {
    return normalizeAgentList(await this.get(`/api/agents?limit=${limit}`))
  }

  async listWorkflows(limit = 50): Promise<VehicleWorkflowListResponse> {
    try {
      return normalizeWorkflowList(await this.get(`/api/workflows?limit=${limit}`))
    } catch {
      const [agents, runs] = await Promise.all([this.listAgents(100), this.listRuns(limit)])
      const workflows = projectWorkflowRecords(runs.runs, agents.agents).slice(0, limit)
      return { workflows, count: workflows.length }
    }
  }

  async listRuns(limit = 20): Promise<VehicleRunListResponse> {
    return this.get(`/api/workflows/runs?limit=${limit}`)
  }

  async listRunAgents(runId: string): Promise<VehicleRunAgentsResponse> {
    return this.get(`/api/workflows/runs/${encodeURIComponent(runId)}/agents`)
  }

  async readAgentWorld(agentId: string): Promise<VehicleAgentWorldResponse> {
    return normalizeWorld(await this.get(`/api/agents/${encodeURIComponent(agentId)}/world`))
  }

  async previewTurnContext(agentId: string, request: VehicleTurnPreviewRequest): Promise<VehicleTurnPreviewResponse> {
    return this.post(`/api/agents/${encodeURIComponent(agentId)}/world/turn-preview`, request)
  }

  async pollAgentWorld(agentId: string, cursor: number): Promise<VehicleAgentWorldEventsResponse> {
    const value = (await this.get(`/api/agents/${encodeURIComponent(agentId)}/world/events?cursor=${cursor}`)) as unknown
    const world = normalizeWorld(value)
    return {
      ...world,
      events: arrayAt<VehicleAgentSessionEvent>(value, ['events']),
      nextCursor: Number(valueAt(value, ['nextCursor']) ?? cursor),
    }
  }

  async postMessage(agentId: string, request: VehicleWorldMessageRequest): Promise<VehicleAgentWorldResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/messages`, request)
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async postComment(agentId: string, request: VehicleWorldCommentRequest): Promise<VehicleAgentWorldResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/comments`, request)
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async saveSystemPrompt(agentId: string, request: VehicleSystemPromptRequest): Promise<VehicleAgentWorldResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/prompts/system`, request)
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async promoteSystemPrompt(agentId: string, graphId?: string | null): Promise<VehicleAgentWorldResponse> {
    const query =
      graphId && graphId !== '-'
        ? `?graph_id=${encodeURIComponent(graphId)}`
        : ''
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/prompts/system/promote${query}`, {})
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async setAgentModel(agentId: string, request: VehicleAgentModelRequest): Promise<VehicleAgentWorldResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/model`, request)
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async claimDriver(agentId: string, clientId: string, release: boolean): Promise<VehicleControlResponse> {
    return this.post(`/api/agents/${encodeURIComponent(agentId)}/world/driver`, {
      clientId,
      action: release ? 'release' : 'claim',
    })
  }

  async steer(agentId: string, clientId: string, text: string, commandId?: string | null): Promise<VehicleControlResponse> {
    return this.post(`/api/agents/${encodeURIComponent(agentId)}/world/steer`, {
      clientId,
      text,
      ...(commandId ? { commandId } : {}),
    })
  }

  async startWorkflow(
    workflow: VehicleWorkflowRecord,
    objective: string,
    agent?: VehicleAgentRecord | null,
  ): Promise<VehicleWorkflowRunResponse> {
    const graphId = workflow.graphIds[0] ?? agent?.graphId
    if (!graphId) throw new Error(`workflow ${workflow.label} has no graph binding`)
    return this.post('/api/workflows/run', {
      workflow_name: workflow.workflowId || workflow.label,
      graph_id: graphId,
      workflow_args: { objective },
    })
  }

  async startConversation(agent: VehicleAgentRecord, objective: string): Promise<VehicleWorkflowRunResponse> {
    const name = workflowName(agent)
    if (!name) throw new Error('agent has no workflow name, type, handle, or id')
    return this.post('/api/workflows/run', {
      workflow_name: name,
      graph_id: agent.graphId,
      workflow_args: { objective },
    })
  }

  async readVehicleSession(sessionId?: string | null): Promise<VehicleSession> {
    if (!sessionId) throw new Error('No active Choreograph agent session is selected.')
    return projectVehicleSession(
      await this.get(`/api/agent-sessions/${encodeURIComponent(sessionId)}`),
    )
  }

  async submitCockpitInput(actor: string, text: string, sessionId?: string | null): Promise<VehicleSession> {
    if (!sessionId) throw new Error('No active Choreograph agent session is selected.')
    await this.post(`/api/agent-sessions/${encodeURIComponent(sessionId)}/driver`, {
      clientId: actor,
      action: 'claim',
    })
    await this.post(`/api/agent-sessions/${encodeURIComponent(sessionId)}/steer`, {
      clientId: actor,
      text,
      commandId: `vehicle-${Date.now().toString(36)}`,
    })
    return this.readVehicleSession(sessionId)
  }

  async readBridgeProjection(): Promise<BridgeProjection> {
    throw new Error('Vehicle bridge projection is local-only in this Shrubbery app; no Choreograph HTTP bridge endpoint is available yet.')
  }

  async applyBridgeOperation(): Promise<BridgeProjection> {
    throw new Error('Vehicle bridge mutations are local-only in this Shrubbery app; no Choreograph HTTP bridge endpoint is available yet.')
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.auth.bearerToken) headers.Authorization = `Bearer ${this.auth.bearerToken}`
    if (this.auth.internalServiceSecret) {
      headers['X-Internal-Service'] = this.auth.internalServiceSecret
      if (this.auth.userId) headers['X-User-ID'] = this.auth.userId
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as T
  }
}

export class FixtureVehicleService implements VehicleService {
  readonly mode = 'fixture' as const
  readonly baseUrl = 'fixture://vehicle'
  private seq = 8
  private workflowDefinitions: VehicleWorkflowRecord[] = makeFixtureWorkflowDefinitions()
  private agents: VehicleAgentRecord[] = [
    {
      agentId: 'agent-research-1',
      agentUri: 'agent://research-1',
      handle: 'research-room',
      agentType: 'research',
      workflowName: 'sophia-research-service',
      graphId: 'sophia-code-lab',
      provider: 'openai',
      model: 'gpt-5',
      lifecycle: 'running',
      activeSessionId: 'session-research-1',
      activeRunId: 'run-srs-vehicle',
      activeSandboxId: 'sandbox-a',
      status: 'listening',
      createdAt: Date.now() - 1000 * 60 * 30,
      updatedAt: Date.now(),
    },
    {
      agentId: 'agent-scout-2',
      agentUri: 'agent://scout-2',
      handle: 'paper-scout',
      agentType: 'scout',
      workflowName: 'paper-adapter-scout',
      graphId: 'sophia-code-lab',
      provider: 'anthropic',
      model: 'claude-sonnet',
      lifecycle: 'idle',
      activeSessionId: 'session-scout-2',
      activeRunId: 'run-paper-scout',
      status: 'waiting',
      createdAt: Date.now() - 1000 * 60 * 54,
      updatedAt: Date.now() - 120000,
    },
  ]
  private runs: VehicleRunSummary[] = [
    {
      runId: 'run-srs-vehicle',
      workflowName: 'sophia-research-service',
      graphId: 'sophia-code-lab',
      status: 'running',
      agentCount: 1,
      totalTokens: 18240,
      startedAt: Date.now() - 1000 * 60 * 20,
      updatedAt: Date.now() - 1000 * 18,
    },
    {
      runId: 'run-paper-scout',
      workflowName: 'paper-adapter-scout',
      graphId: 'sophia-code-lab',
      status: 'paused',
      agentCount: 1,
      totalTokens: 9330,
      startedAt: Date.now() - 1000 * 60 * 48,
      updatedAt: Date.now() - 1000 * 60 * 6,
    },
  ]
  private world: VehicleAgentWorldResponse = makeFixtureWorld()
  private events: VehicleAgentSessionEvent[] = makeFixtureEvents()
  private session: VehicleSession = makeFixtureSession()
  private bridgeDocument: GardenDocument = makeFixtureGardenDocument()
  private bridgeRevision = 0

  async listAgents(): Promise<VehicleAgentListResponse> {
    return clone({ agents: this.agents, count: this.agents.length })
  }

  async listWorkflows(): Promise<VehicleWorkflowListResponse> {
    const workflows = projectWorkflowRecords(this.runs, this.agents, this.workflowDefinitions)
    return clone({ workflows, count: workflows.length })
  }

  async listRuns(): Promise<VehicleRunListResponse> {
    return clone({ runs: this.runs, count: this.runs.length })
  }

  async listRunAgents(runId: string): Promise<VehicleRunAgentsResponse> {
    const run = this.runs.find((item) => item.runId === runId) ?? this.runs[0]
    const agent = this.agents.find((item) => item.activeRunId === runId) ?? this.agents[0]
    return clone({
      run,
      agents: [
        {
          sessionId: agent.activeSessionId ?? '',
          runId,
          workflowName: agent.workflowName ?? '',
          graphId: agent.graphId,
          nodeKey: 'research',
          label: agent.handle,
          agentId: agent.agentId,
          model: agent.model ?? '',
          status: agent.status ?? '',
        },
      ],
    })
  }

  async readAgentWorld(_agentId?: string): Promise<VehicleAgentWorldResponse> {
    return clone(this.world)
  }

  async previewTurnContext(_agentId: string, request: VehicleTurnPreviewRequest): Promise<VehicleTurnPreviewResponse> {
    const latestMessage = {
      id: `preview-${this.seq + 1}`,
      role: request.role,
      authorId: request.authorId,
      text: request.text || 'Preview the next AgentWorld turn.',
      createdAt: Date.now(),
      refs: [],
      visibility: request.visibility,
      ...request.contextPreview?.latestMessage,
    }
    const agentVisiblePacket = request.contextPreview?.agentVisiblePacket ?? this.world.agentVisiblePacket ?? {}
    const packetJson = JSON.stringify(agentVisiblePacket, null, 2)
    const systemPrompt =
      request.contextPreview?.systemPrompt ?? stringAt(this.world.worldDoc.prompts, ['system', 'text']) ?? ''
    const turnPrompt =
      request.contextPreview?.turnPrompt ??
      [
        `You are ${stringAt(this.world.agent, ['handle']) ?? 'research-room'}, continuing an interactive Vehicle AgentWorld room.`,
        'Use the AgentWorld packet as shared state. Only agent-visible messages and notes are included.',
        'Respond to the latest user message as one concise room turn. Use Mnemosyne tools if they help.',
        '',
        'Latest user message:',
        JSON.stringify(latestMessage, null, 2),
        '',
        'Agent-visible world packet:',
        packetJson,
      ].join('\n')
    const preview: VehicleTurnContextPreview = {
      schema: 'sophia.agent-world-turn-context-preview.v0',
      mode: 'agent-world-room-turn',
      turnId: `turn-${this.seq + 1}`,
      systemPrompt,
      latestMessage,
      agentVisiblePacket,
      turnPrompt,
      turnPromptSections: {},
      constraints: arrayAt(asRecord(valueAt(this.world.agentVisiblePacket, ['world'])), ['constraints']),
      tools: arrayAt(this.world.agentVisiblePacket, ['toolbelt']),
      promptDigest: `fixture-${hashString(systemPrompt)}`,
      packetDigest: `fixture-${hashString(packetJson)}`,
      turnPromptDigest: `fixture-${hashString(turnPrompt)}`,
    }
    return clone({ preview, ...this.world })
  }

  async pollAgentWorld(_agentId: string, cursor: number): Promise<VehicleAgentWorldEventsResponse> {
    const events = this.events.filter((event) => event.seq > cursor)
    return clone({
      ...this.world,
      events,
      nextCursor: this.events.reduce((max, event) => Math.max(max, event.seq), cursor),
    })
  }

  async postMessage(_agentId: string, request: VehicleWorldMessageRequest): Promise<VehicleAgentWorldResponse> {
    this.appendMessage({
      id: `msg-${this.seq + 1}`,
      authorId: request.authorId,
      role: request.role,
      visibility: request.visibility,
      text: request.text,
      ts: Date.now(),
    })
    this.pushEvent('conversation.message.created', {
      message: { authorId: request.authorId, role: request.role, text: request.text },
    })
    const turnId = `turn-${this.seq + 1}`
    this.pushEvent('conversation.turn.queued', { turnId })
    this.pushEvent('conversation.turn.tool.started', {
      turnId,
      toolCallId: `${turnId}:recall`,
      toolName: 'recall',
      args: { query: truncate(request.text, 80) },
    })
    this.pushEvent('conversation.turn.tool.completed', {
      turnId,
      toolCallId: `${turnId}:recall`,
      toolName: 'recall',
      result: 'Fixture recall checked the room context before replying.',
    })
    this.appendMessage({
      id: `msg-${this.seq + 1}`,
      authorId: 'research-room',
      role: 'agent',
      visibility: 'agent-visible',
      text: `Received. I will fold "${truncate(request.text, 72)}" into the room state.`,
      ts: Date.now(),
    })
    this.pushEvent('conversation.message.created', {
      message: {
        authorId: 'research-room',
        role: 'agent',
        text: `Received. I will fold "${truncate(request.text, 72)}" into the room state.`,
      },
    })
    return clone(this.world)
  }

  async postComment(_agentId: string, request: VehicleWorldCommentRequest): Promise<VehicleAgentWorldResponse> {
    const codex = { ...this.world.worldDoc.codex }
    const comments = arrayAt<JsonRecord>(codex, ['comments'])
    codex.comments = [
      ...comments,
      {
        id: `comment-${this.seq + 1}`,
        authorId: request.authorId,
        text: request.text,
        visibility: request.visibility,
        kind: request.kind,
        ts: Date.now(),
      },
    ]
    this.world = { ...this.world, worldDoc: { ...this.world.worldDoc, codex } }
    this.pushEvent('control.steered', { comment: { authorId: request.authorId, text: request.text } })
    return clone(this.world)
  }

  async saveSystemPrompt(_agentId: string, request: VehicleSystemPromptRequest): Promise<VehicleAgentWorldResponse> {
    const trimmed = request.text.trimEnd()
    if (!trimmed.trim()) throw new Error('System prompt cannot be empty.')
    const digest = `fixture-${hashString(trimmed)}`
    const prompts = {
      ...this.world.worldDoc.prompts,
      system: {
        ...asRecord(valueAt(this.world.worldDoc.prompts, ['system'])),
        title: request.title || stringAt(this.world.worldDoc.prompts, ['system', 'title']) || 'System prompt',
        kind: 'system',
        text: trimmed,
        digest,
        updatedAt: Date.now(),
        updatedBy: request.authorId,
      },
      effectivePromptDigest: digest,
    }
    this.world = { ...this.world, worldDoc: { ...this.world.worldDoc, prompts } }
    this.pushEvent('agent.prompt.system.updated', {
      authorId: request.authorId,
      digest,
      chars: trimmed.length,
    })
    return clone(this.world)
  }

  async promoteSystemPrompt(_agentId: string): Promise<VehicleAgentWorldResponse> {
    const prompt = asRecord(valueAt(this.world.worldDoc.prompts, ['system']))
    this.pushEvent('agent.prompt.system.promoted', {
      digest: stringAt(prompt, ['digest']) ?? null,
      chars: (stringAt(prompt, ['text']) ?? '').length,
    })
    return clone(this.world)
  }

  async setAgentModel(agentId: string, request: VehicleAgentModelRequest): Promise<VehicleAgentWorldResponse> {
    const model = request.model.trim()
    if (!model) throw new Error('Agent model cannot be empty.')
    const previousModel =
      modelFromRecord(asRecord(this.agents.find((agent) => agent.agentId === agentId || agent.handle === agentId))) ??
      modelFromRecord(asRecord(this.world.agent)) ??
      modelFromRecord(this.world.worldDoc.status) ??
      modelFromRecord(this.world.worldDoc.agent)
    const provider = request.provider ?? providerForModel(model)
    this.agents = this.agents.map((agent) =>
      agent.agentId === agentId || agent.handle === agentId
        ? { ...agent, model, provider, updatedAt: Date.now() }
        : agent,
    )
    this.session = { ...this.session, model }
    this.world = {
      ...this.world,
      agent: { ...this.world.agent, model, provider },
      session: this.world.session ? { ...this.world.session, model } : this.world.session,
      worldDoc: {
        ...this.world.worldDoc,
        agent: { ...this.world.worldDoc.agent, model, provider, updatedAt: Date.now() },
        status: { ...this.world.worldDoc.status, model, provider, updatedAt: Date.now() },
      },
    }
    this.pushEvent('agent.model.changed', {
      authorId: request.authorId,
      previousModel: previousModel ?? null,
      model,
      provider,
    })
    return clone(this.world)
  }

  async claimDriver(_agentId: string, clientId: string, release: boolean): Promise<VehicleControlResponse> {
    const control = { ...this.world.worldDoc.control }
    control.driverLease = release ? null : { holder: clientId, clientId, epoch: Number(valueAt(control, ['driverLease', 'epoch']) ?? 0) + 1 }
    this.world = { ...this.world, worldDoc: { ...this.world.worldDoc, control } }
    const event = this.pushEvent(release ? 'control.driver-released' : 'control.driver-claimed', {
      driverLease: control.driverLease,
    })
    return clone({ applied: true, driver: release ? null : clientId, events: [event], document: control })
  }

  async steer(_agentId: string, clientId: string, text: string, commandId?: string | null): Promise<VehicleControlResponse> {
    const control = { ...this.world.worldDoc.control }
    const queue = arrayAt<JsonRecord>(control, ['steeringQueue'])
    const steering = {
      id: commandId || `steer-${this.seq + 1}`,
      clientId,
      text,
      ts: Date.now(),
    }
    control.steeringQueue = [...queue, steering]
    this.world = { ...this.world, worldDoc: { ...this.world.worldDoc, control } }
    const event = this.pushEvent('control.steered', { steering })
    return clone({ applied: true, driver: driverLabel(control.driverLease), events: [event], document: control })
  }

  async startWorkflow(
    workflow: VehicleWorkflowRecord,
    objective: string,
    agent?: VehicleAgentRecord | null,
  ): Promise<VehicleWorkflowRunResponse> {
    const selectedAgent =
      agent ??
      this.agents.find((item) => workflowName(item) === workflow.workflowId || workflowName(item) === workflow.label) ??
      this.agents.find((item) => workflow.agentIds.includes(agentSelector(item))) ??
      this.agents[0]
    if (!selectedAgent) throw new Error(`workflow ${workflow.label} has no local agent binding`)
    return clone(this.startFixtureRun(workflow, selectedAgent, objective))
  }

  async startConversation(agent: VehicleAgentRecord, objective: string): Promise<VehicleWorkflowRunResponse> {
    const workflowId = workflowName(agent) ?? agent.handle
    const workflow =
      projectWorkflowRecords(this.runs, this.agents, this.workflowDefinitions).find(
        (item) => item.workflowId === workflowId || item.label === workflowId,
      ) ??
      makeWorkflowRecord({
        workflowId,
        label: workflowId,
        graphIds: [agent.graphId],
        agentIds: [agentSelector(agent)],
      })
    return clone(this.startFixtureRun(workflow, agent, objective))
  }

  private startFixtureRun(
    workflow: VehicleWorkflowRecord,
    agent: VehicleAgentRecord,
    objective: string,
  ): VehicleWorkflowRunResponse {
    const runId = `run-${Date.now()}`
    const currentOntology = asRecord(this.world.worldDoc.ontology)
    const activeSessionUri =
      stringAt(currentOntology, ['activeSessionUri']) ??
      `urn:sophia:agent:${agent.agentId}:session:${this.world.session?.sessionId ?? 'session'}`
    const run: VehicleRunSummary = {
      runId,
      workflowName: workflow.workflowId,
      graphId: workflow.graphIds[0] ?? agent.graphId,
      status: 'running',
      agentCount: 1,
      totalTokens: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.runs = [run, ...this.runs]
    this.agents = this.agents.map((item) =>
      agentSelector(item) === agentSelector(agent)
        ? { ...item, activeRunId: runId, workflowName: workflow.workflowId, updatedAt: Date.now() }
        : item,
    )
    this.world = {
      ...this.world,
      run,
      agent: { ...this.world.agent, workflowName: workflow.workflowId },
      session: this.world.session ? { ...this.world.session, runId, workflowName: workflow.workflowId } : this.world.session,
      worldDoc: {
        ...this.world.worldDoc,
        agent: { ...this.world.worldDoc.agent, workflowName: workflow.workflowId },
        status: {
          ...this.world.worldDoc.status,
          activeRunId: runId,
          lifecycle: 'running',
          summary: objective,
        },
        runtime: { ...this.world.worldDoc.runtime, workflowName: workflow.workflowId, runId },
        ontology: {
          ...this.world.worldDoc.ontology,
          activeSessionUri,
          activeRunUri: `${activeSessionUri}:run:${runId}`,
          workflowDefinition: {
            workflowId: workflow.workflowId,
            definitionSubject: workflow.definitionSubject,
            archetypeUris: workflow.archetypeUris,
          },
        },
      },
    }
    this.appendMessage({
      id: `msg-${this.seq + 1}`,
      authorId: 'vehicle',
      role: 'system',
      text: `Started a fresh conversation: ${objective}`,
      visibility: 'human-only',
      ts: Date.now(),
    })
    this.pushEvent('workflow.run.started', { runId, workflowId: run.workflowName, objective })
    this.pushEvent('conversation.turn.queued', { turnId: `turn-${runId}`, objective })
    return { runId, status: 'running', graphId: run.graphId, workflowId: run.workflowName }
  }

  async readVehicleSession(): Promise<VehicleSession> {
    return clone(this.session)
  }

  async submitCockpitInput(actor: string, text: string): Promise<VehicleSession> {
    const trimmed = text.trim()
    if (!trimmed) return clone(this.session)
    if (this.session.driver.holder !== actor) {
      this.session = {
        ...this.session,
        pendingControlEvents: [...this.session.pendingControlEvents, { actor, text: trimmed }],
      }
      throw new Error(`driver lease is held by ${this.session.driver.holder}; ${actor} cannot submit input`)
    }

    const seq = this.session.transcript.length + 1
    const event = {
      seq,
      source: 'mock-pi',
      text: `mock-pi echoed for ${this.session.graphId}: ${trimmed}`,
    }
    this.session = {
      ...this.session,
      transcript: [...this.session.transcript, event],
      panes: this.session.panes.map((pane) =>
        pane.kind === 'pi-terminal'
          ? { ...pane, state: 'ran', output: [pane.output, `> ${trimmed}`, event.text].filter(Boolean).join('\n') }
          : pane,
      ),
      inputDraft: '',
    }
    this.pushEvent('conversation.turn.sandbox.terminal', {
      state: 'output',
      result: { output: event.text },
    })
    return clone(this.session)
  }

  async readBridgeProjection(documentId?: string | null): Promise<BridgeProjection> {
    if (documentId && documentId !== this.bridgeDocument.documentId) {
      throw new Error(`document ${documentId} not found`)
    }
    return clone(projectGardenDocument(this.bridgeDocument, this.bridgeRevision))
  }

  async applyBridgeOperation(operation: BridgeOperation): Promise<BridgeProjection> {
    this.bridgeDocument = applyBridgeOperationToDocument(this.bridgeDocument, operation)
    this.bridgeRevision += 1
    this.pushEvent('vehicle.bridge.mutated', {
      operation,
      documentId: this.bridgeDocument.documentId,
      revision: this.bridgeRevision,
    })
    return clone(projectGardenDocument(this.bridgeDocument, this.bridgeRevision))
  }

  private appendMessage(message: JsonRecord): void {
    const conversation = { ...this.world.worldDoc.conversation }
    const messages = arrayAt<JsonRecord>(conversation, ['messages'])
    conversation.messages = [...messages, message]
    this.world = { ...this.world, worldDoc: { ...this.world.worldDoc, conversation } }
  }

  private pushEvent(type: string, payload: JsonRecord): VehicleAgentSessionEvent {
    this.seq += 1
    const event: VehicleAgentSessionEvent = {
      sessionId: 'session-research-1',
      seq: this.seq,
      ts: Date.now(),
      type,
      payload,
    }
    this.events = [...this.events, event]
    return event
  }
}

export function projectGardenDocument(document: GardenDocument, revision = 0): BridgeProjection {
  const lines = document.blocks.map((block) => bridgeLineFromBlock(block))
  return {
    formatVersion: 1,
    documentId: document.documentId,
    title: document.title,
    revision,
    tiptapJson: {
      type: 'doc',
      content: document.blocks.map((block) => blockToTiptap(block)),
    },
    lines,
    unsupported: document.blocks
      .filter((block) => supportFor(block.kind) !== 'editable-text')
      .map((block) => ({
        blockId: block.blockId,
        nodeType: block.kind,
        reason: `${block.kind} is preserved as ${supportFor(block.kind)}`,
      })),
  }
}

function bridgeLineFromBlock(block: GardenBlock): BridgeLine {
  return {
    blockId: block.blockId,
    nodeType: block.kind,
    text: block.text,
    support: supportFor(block.kind),
    attrs: block.attrs ?? {},
    marks: [],
  }
}

function supportFor(kind: string): BridgeSupportLevel {
  if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(kind)) return 'editable-text'
  if (['horizontalRule', 'image', 'mathBlock', 'footnote', 'wikilink', 'mathInline', 'hardBreak'].includes(kind)) return 'command-only'
  if (['table', 'tableRow', 'tableHeader', 'tableCell', 'queryBlock'].includes(kind)) return 'read-only-opaque'
  return 'hidden-metadata'
}

function blockToTiptap(block: GardenBlock): JsonRecord {
  const attrs = { ...(block.attrs ?? {}), 'data-block-id': block.blockId }
  if (block.kind === 'heading') {
    return { type: 'heading', attrs: { level: Number(block.attrs?.level ?? 2), ...attrs }, content: textContent(block.text) }
  }
  if (block.kind === 'codeBlock') {
    return { type: 'codeBlock', attrs, content: textContent(block.text) }
  }
  if (supportFor(block.kind) !== 'editable-text') {
    return { type: block.kind, attrs }
  }
  return { type: block.kind, attrs, content: textContent(block.text) }
}

function textContent(text: string): JsonRecord[] {
  return text ? [{ type: 'text', text }] : []
}

function applyBridgeOperationToDocument(document: GardenDocument, operation: BridgeOperation): GardenDocument {
  const blocks = [...document.blocks]
  const index = operation.type === 'insert-block' ? -1 : blocks.findIndex((block) => block.blockId === operation.blockId)
  if (operation.type !== 'insert-block' && index < 0) throw new Error(`block ${operation.blockId} not found`)

  switch (operation.type) {
    case 'replace-block-text':
      blocks[index] = { ...blocks[index], text: operation.text }
      break
    case 'insert-text':
      blocks[index] = { ...blocks[index], text: insertUtf16(blocks[index].text, operation.offsetUtf16, operation.text) }
      break
    case 'delete-text':
      blocks[index] = { ...blocks[index], text: deleteUtf16(blocks[index].text, operation.offsetUtf16, operation.lenUtf16) }
      break
    case 'split-block': {
      const block = blocks[index]
      const [left, right] = splitUtf16(block.text, operation.offsetUtf16)
      blocks[index] = { ...block, text: left }
      blocks.splice(index + 1, 0, {
        ...block,
        blockId: operation.newBlockId || `${block.blockId}-split-${Date.now()}`,
        text: right,
      })
      break
    }
    case 'join-next': {
      const next = blocks[index + 1]
      if (!next) throw new Error(`block ${operation.blockId} has no next block`)
      blocks[index] = { ...blocks[index], text: `${blocks[index].text}${next.text}` }
      blocks.splice(index + 1, 1)
      break
    }
    case 'insert-block': {
      const afterIndex = operation.afterBlockId
        ? blocks.findIndex((block) => block.blockId === operation.afterBlockId)
        : -1
      if (operation.afterBlockId && afterIndex < 0) throw new Error(`block ${operation.afterBlockId} not found`)
      blocks.splice(afterIndex + 1, 0, operation.block)
      break
    }
    case 'delete-block':
      blocks.splice(index, 1)
      break
    case 'move-block': {
      const [block] = blocks.splice(index, 1)
      const afterIndex = operation.afterBlockId
        ? blocks.findIndex((candidate) => candidate.blockId === operation.afterBlockId)
        : -1
      if (operation.afterBlockId && afterIndex < 0) throw new Error(`block ${operation.afterBlockId} not found`)
      blocks.splice(afterIndex + 1, 0, block)
      break
    }
    case 'set-block-attrs':
      blocks[index] = { ...blocks[index], attrs: { ...(blocks[index].attrs ?? {}), ...operation.attrs } }
      break
  }

  return { ...document, blocks }
}

function insertUtf16(text: string, offset: number, value: string): string {
  const chars = Array.from(text)
  const clamped = Math.max(0, Math.min(offset, chars.length))
  return `${chars.slice(0, clamped).join('')}${value}${chars.slice(clamped).join('')}`
}

function deleteUtf16(text: string, offset: number, length: number): string {
  const chars = Array.from(text)
  const start = Math.max(0, Math.min(offset, chars.length))
  const end = Math.max(start, Math.min(start + length, chars.length))
  return `${chars.slice(0, start).join('')}${chars.slice(end).join('')}`
}

function splitUtf16(text: string, offset: number): [string, string] {
  const chars = Array.from(text)
  const clamped = Math.max(0, Math.min(offset, chars.length))
  return [chars.slice(0, clamped).join(''), chars.slice(clamped).join('')]
}

function makeFixtureWorkflowDefinitions(): VehicleWorkflowRecord[] {
  const graphIds = ['sophia-code-lab']
  const now = Date.now()
  const definition = (
    workflowId: string,
    label: string,
    description: string,
    whenToUse: string,
    opts: {
      readonly phaseCount?: number
      readonly agentNodeCount?: number
      readonly archetypeUris?: readonly string[]
      readonly runnable?: boolean
      readonly operationId?: string
      readonly inputSchema?: JsonRecord
      readonly outputSchema?: JsonRecord
      readonly updatedAtOffsetMs?: number
    } = {},
  ): VehicleWorkflowRecord => {
    const definitionSubject = workflowDefinitionSubject(workflowId)
    const phaseCount = opts.phaseCount ?? 1
    const agentNodeCount = opts.agentNodeCount ?? 1
    const gaps = opts.runnable === false
      ? [
          {
            gapKind: 'wf:scriptBlock',
            gapTarget: definitionSubject,
            gapBlocking: true,
            rationale: 'Bind a Garden source block before this workflow can be executed.',
          },
        ]
      : []
    return {
      workflowId,
      label,
      description,
      whenToUse,
      definitionSubject,
      sourceKind: 'current-state',
      identityKind: 'doc-uri',
      graphIds,
      status: opts.runnable === false ? 'draft' : 'ready',
      runCount: 0,
      agentCount: 0,
      totalTokens: 0,
      latestRunId: null,
      activeRunId: null,
      agentIds: [],
      runIds: [],
      phaseCount,
      agentNodeCount,
      archetypeUris: opts.archetypeUris ?? [],
      binding: opts.runnable === false
        ? null
        : {
            bindingId: `${workflowId}:binding`,
            operationId: opts.operationId ?? workflowId,
            executor: 'choreograph',
            workflowName: workflowId,
            inputSchema: opts.inputSchema ?? {
              type: 'object',
              properties: { objective: { type: 'string' } },
              required: ['objective'],
            },
            outputSchema: opts.outputSchema ?? {
              type: 'object',
              properties: { runId: { type: 'string' }, status: { type: 'string' } },
              required: ['runId', 'status'],
            },
            requiresAuth: true,
          },
      draft: {
        runnable: gaps.length === 0,
        gaps,
        warnings: [],
        derivedFromQuery: 'workflow_authoring_session.draft(definition subject, composition events, workflow contract)',
      },
      runStatistics: {
        runCount: 0,
        latestRunStatus: null,
        lastRunAt: null,
        medianRunTokens: null,
        derivedFromQuery: 'workflow_book.runStatistics(wf:Run, wf:AgentRun, wf:PageTurnDecision history for workflow)',
      },
      updatedAt: now - (opts.updatedAtOffsetMs ?? 0),
      ontology: {
        className: 'wf:Workflow',
        source: 'emporium.workflow.golden.fixture',
        requiredPredicates: ['wf:name', 'wf:description', 'wf:phase', 'wf:scriptBlock', 'wf:scriptSha256'],
      },
    }
  }
  return [
    definition(
      'do-chat-turn',
      'Do a chat turn',
      'Append one user-visible turn, let the selected agent reason, call tools if needed, and write the response back into the AgentWorld conversation.',
      'Use when a person sends a message and expects the agent to advance the shared room state.',
      {
        archetypeUris: ['urn:sophia:wf:archetype:conversation-turn'],
        operationId: 'doChatTurn',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            visibility: { type: 'string', enum: ['agent-visible', 'human-only'] },
          },
          required: ['message'],
        },
      },
    ),
    definition(
      'read-book',
      'Read a book',
      'Coordinate a long-form reading workflow: ingest or bind a source, move through sections, collect notes, and synthesize durable memory.',
      'Use when the work is book-scale and needs checkpoints, citations, and retained observations.',
      {
        phaseCount: 4,
        agentNodeCount: 3,
        archetypeUris: ['urn:sophia:wf:archetype:longform-reading'],
        operationId: 'readBook',
        inputSchema: {
          type: 'object',
          properties: {
            sourceDocumentId: { type: 'string' },
            objective: { type: 'string' },
          },
          required: ['sourceDocumentId', 'objective'],
        },
        updatedAtOffsetMs: 1000 * 60 * 7,
      },
    ),
    definition(
      'read-paper',
      'Read a paper',
      'Read an academic paper, extract claims, methods, evidence, and open questions, then return a concise research note.',
      'Use for paper-scale source reading where method/evidence fidelity matters.',
      {
        phaseCount: 3,
        agentNodeCount: 2,
        archetypeUris: ['urn:sophia:wf:archetype:paper-reading'],
        operationId: 'readPaper',
        updatedAtOffsetMs: 1000 * 60 * 12,
      },
    ),
    definition(
      'sophia-research-service',
      'Sophia Research Service',
      'Run the SRS research-room loop: inspect graph context, use tools inline, and keep the driver oriented around evidence.',
      'Use when Greenhouse is acting as a research service over a Sophia graph.',
      {
        phaseCount: 3,
        agentNodeCount: 1,
        archetypeUris: ['urn:sophia:wf:archetype:research-service'],
        operationId: 'sophiaResearchService',
        updatedAtOffsetMs: 1000 * 18,
      },
    ),
    definition(
      'paper-adapter-scout',
      'Paper Adapter Scout',
      'Scout paper-wrapper and arXiv-adapter surfaces, identify viable integrations, and report implementation options.',
      'Use when a research connector needs fast ecosystem reconnaissance.',
      {
        phaseCount: 2,
        agentNodeCount: 1,
        archetypeUris: ['urn:sophia:wf:archetype:connector-scout'],
        operationId: 'paperAdapterScout',
        updatedAtOffsetMs: 1000 * 60 * 6,
      },
    ),
    definition(
      'compose-workflow',
      'Compose a workflow',
      'Open a wf:AuthoringSession and append wf:CompositionEvent gestures until a wf:Workflow definition is runnable.',
      'Use when the task is to author or revise the workflow itself.',
      {
        phaseCount: 0,
        agentNodeCount: 0,
        runnable: false,
        archetypeUris: ['urn:sophia:wf:archetype:workflow-authoring'],
        updatedAtOffsetMs: 1000 * 60 * 18,
      },
    ),
  ]
}

function makeFixtureSession(): VehicleSession {
  return {
    sessionId: 'vehicle-local-session',
    graphId: 'sophia-code-lab',
    runId: 'run-srs-vehicle',
    workflowName: 'sophia-research-service',
    agentId: 'agent-research-1',
    agentLabel: 'research-room',
    model: 'gpt-5',
    status: 'running',
    sandboxId: 'sandbox-research-1',
    revision: 1,
    driver: { holder: 'vehicle-web', epoch: 1, expiresAt: null },
    presences: [
      { userId: 'vera', displayName: 'Vera', focus: 'agent' },
      { userId: 'codex', displayName: 'Codex', focus: 'bridge' },
    ],
    panes: [
      { paneId: 'agent-1', kind: 'agent', title: 'Pi agent', state: 'ready', output: 'Agent room attached.' },
      {
        paneId: 'doc-1',
        kind: 'vim-garden-document',
        title: 'Garden document via Neovim',
        mode: 'vim',
        command: 'nvim',
        args: ['vehicle-demo'],
        state: 'projected',
        output: '3 block extmarks tracked by block_id.',
      },
      {
        paneId: 'choreo-1',
        kind: 'choreograph-terminal',
        title: 'Choreograph attach',
        mode: 'choreograph',
        command: 'vehicle',
        args: ['agent-watch'],
        state: 'watching',
        output: 'watching AgentWorld events',
      },
      {
        paneId: 'pi-1',
        kind: 'pi-terminal',
        title: 'Pi terminal',
        mode: 'pi',
        command: 'pi',
        args: ['agent'],
        state: 'idle',
        output: 'mock-pi ready',
      },
    ],
    transcript: [{ seq: 1, source: 'mock-pi', text: 'Vehicle session initialized for sophia-code-lab.' }],
    inputDraft: '',
    pendingControlEvents: [],
  }
}

function makeFixtureGardenDocument(): GardenDocument {
  return {
    documentId: 'vehicle-demo',
    title: 'Vehicle bridge demo',
    blocks: [
      {
        blockId: 'block-purpose',
        kind: 'heading',
        text: 'Vehicle as the SRS room substrate',
        attrs: { level: 2 },
      },
      {
        blockId: 'block-plan',
        kind: 'paragraph',
        text: 'The bridge preserves block identity while exposing editable text lines.',
      },
      {
        blockId: 'block-code',
        kind: 'codeBlock',
        text: 'vehicle bridge apply --operation replace-block-text',
        attrs: { language: 'sh' },
      },
      {
        blockId: 'block-image',
        kind: 'image',
        text: '',
        attrs: { src: 'fixture://agent-world.png', alt: 'opaque image node' },
      },
    ],
  }
}

function makeFixtureWorld(): VehicleAgentWorldResponse {
  return {
    agent: {
      agentId: 'agent-research-1',
      agentUri: 'urn:sophia:agent:agent-research-1',
      handle: 'research-room',
      workflowName: 'sophia-research-service',
      agentType: 'research',
      graphId: 'sophia-code-lab',
      provider: 'openai',
      model: 'gpt-5',
    },
    session: {
      sessionId: 'session-research-1',
      runId: 'run-srs-vehicle',
      workflowName: 'sophia-research-service',
      graphId: 'sophia-code-lab',
      nodeKey: 'research',
      label: 'research-room',
      agentId: 'agent-research-1',
      model: 'gpt-5',
      status: 'running',
    },
    run: {
      runId: 'run-srs-vehicle',
      workflowName: 'sophia-research-service',
      graphId: 'sophia-code-lab',
      status: 'running',
      agentCount: 1,
      totalTokens: 18240,
    },
    worldDoc: {
      schema: 'choreograph.agent_world.v1',
      agent: {
        handle: 'research-room',
        workflowName: 'sophia-research-service',
        graphId: 'sophia-code-lab',
        model: 'gpt-5',
      },
      status: {
        lifecycle: 'running',
        runtimeStatus: 'watching',
        activeSessionId: 'session-research-1',
        activeRunId: 'run-srs-vehicle',
        activeSandboxId: 'sandbox-a',
        graphId: 'sophia-code-lab',
        model: 'gpt-5',
        summary: 'Port Vehicle into a Shrubbery/SRS-compatible agent room.',
      },
      prompts: {
        system: {
          title: 'Vehicle room prompt',
          kind: 'system',
          digest: 'prompt-digest-vehicle-001',
          text: 'Stay oriented to the AgentWorld, surface tool provenance, and accept steering from the driver.',
          document: {
            documentId: 'agent-prompt-research-room-system',
            snapshotId: 'aps_fixture_research_room',
          },
          binding: {
            bindingId: 'apb_fixture_research_room',
            documentId: 'agent-prompt-research-room-system',
            snapshotId: 'aps_fixture_research_room',
            provider: 'openai',
            model: 'gpt-5',
          },
        },
        activeObjective: {
          title: 'Current objective',
          kind: 'objective',
          text: 'Assess Vehicle as the eventual SRS room substrate.',
        },
        effectivePromptDigest: 'effective-prompt-digest-vehicle-001',
      },
      toolbelt: {
        schema: 'choreograph.toolbelt.v1',
        manifestId: 'srs-room-tools',
        manifestHash: '1f70b4db4377a3d8b12dd919f44a8d09',
        toolMode: 'agent-world',
        mcpProfile: 'sophia-code-lab',
        counts: { declared: 5, mounted: 4, used: 2, hidden: 1, denied: 0, failed: 0 },
        tools: [
          {
            name: 'recall',
            state: 'used',
            access: 'read',
            risk: 'low',
            available: true,
            recentUses: 2,
            description: 'Search the room memory queue.',
          },
          {
            name: 'search_blocks',
            state: 'mounted',
            access: 'read',
            risk: 'low',
            available: true,
            recentUses: 1,
            description: 'Find blocks across SRS and Vehicle documents.',
          },
          {
            name: 'papers.search',
            state: 'declared',
            access: 'read',
            risk: 'low',
            available: false,
            recentUses: 0,
            description: 'Stubbed papers adapter seam from SRS.',
            requiresProvenance: { required: true, acceptedSourceKinds: ['paper', 'preprint'] },
          },
        ],
      },
      schemas: {
        AgentWorld: 'agent, status, prompts, toolbelt, conversation, control, codex',
        Control: 'driverLease, steeringQueue',
        ConversationMessage: 'authorId, role, visibility, text',
      },
      world: { name: 'SRS Vehicle room', roomKind: 'agent-world' },
      memory: { queueDepth: 4, graphId: 'sophia-code-lab' },
      conversation: {
        messages: [
          {
            id: 'msg-1',
            authorId: 'vera',
            role: 'user',
            visibility: 'agent-visible',
            text: 'Let us turn the best Vehicle state into a real Shrubbery app.',
            ts: Date.now() - 240000,
          },
          {
            id: 'msg-2',
            authorId: 'research-room',
            role: 'agent',
            visibility: 'agent-visible',
            text: 'I can map the TUI room into SRS primitives: lobby, chat, activity trace, world panes, and driver controls.',
            ts: Date.now() - 180000,
          },
        ],
      },
      runtime: { pollMs: 5000, transport: 'fixture' },
      control: {
        driverLease: { holder: 'vehicle-web', clientId: 'vehicle-web', epoch: 1 },
        steeringQueue: [{ id: 'steer-1', clientId: 'vehicle-web', text: 'Lean on SRS components.', ts: Date.now() - 120000 }],
      },
      collaborators: { viewers: ['vera', 'codex'] },
      codex: {
        comments: [
          {
            id: 'comment-1',
            authorId: 'codex',
            kind: 'comment',
            visibility: 'human-only',
            text: 'Fixture mode is local, but the service seam mirrors Choreograph endpoints.',
          },
        ],
      },
      ontology: {
        room: 'VehicleAgentWorld',
        agentUri: 'urn:sophia:agent:agent-research-1',
        activeSessionUri: 'urn:sophia:agent:agent-research-1:session:session-research-1',
        activeRunUri: 'urn:sophia:agent:agent-research-1:session:session-research-1:run:run-srs-vehicle',
        conformsTo: {
          contract: 'sophia.agent-world-doc.v0',
          version: 'v0',
          projectionVocab: 'wf-agent-world-runtime',
        },
        shapeFailures: [],
        promptDocument: {
          documentId: 'agent-prompt-research-room-system',
          snapshotId: 'aps_fixture_research_room',
          bindingId: 'apb_fixture_research_room',
        },
        documentBackend: {
          backend: 'oplog',
          roomId: 'choreograph:agent-session:session-research-1',
          revision: 1,
        },
        documentOps: [],
      },
    },
  }
}

function makeFixtureEvents(): VehicleAgentSessionEvent[] {
  const base = Date.now() - 260000
  return [
    {
      sessionId: 'session-research-1',
      seq: 1,
      ts: base,
      type: 'agent.toolbelt.resolved',
      payload: { counts: { declared: 5, mounted: 4, failures: 0 }, toolMode: 'agent-world' },
    },
    {
      sessionId: 'session-research-1',
      seq: 2,
      ts: base + 20000,
      type: 'conversation.message.created',
      payload: {
        message: {
          authorId: 'vera',
          role: 'user',
          text: 'Let us turn the best Vehicle state into a real Shrubbery app.',
        },
      },
    },
    {
      sessionId: 'session-research-1',
      seq: 3,
      ts: base + 45000,
      type: 'conversation.turn.queued',
      payload: { turnId: 'turn-shrubbery-vehicle' },
    },
    {
      sessionId: 'session-research-1',
      seq: 4,
      ts: base + 60000,
      type: 'conversation.turn.tool.started',
      payload: { turnId: 'turn-shrubbery-vehicle', toolName: 'search_blocks', args: { query: 'SRS shrubberyification Vehicle' } },
    },
    {
      sessionId: 'session-research-1',
      seq: 5,
      ts: base + 82000,
      type: 'conversation.turn.tool.completed',
      payload: { turnId: 'turn-shrubbery-vehicle', toolName: 'search_blocks', result: 'Found reusable SRS workspace/chat/trace primitives.' },
    },
    {
      sessionId: 'session-research-1',
      seq: 6,
      ts: base + 110000,
      type: 'conversation.message.created',
      payload: {
        message: {
          authorId: 'research-room',
          role: 'agent',
          text: 'I can map the TUI room into SRS primitives: lobby, chat, activity trace, world panes, and driver controls.',
        },
      },
    },
    {
      sessionId: 'session-research-1',
      seq: 7,
      ts: base + 150000,
      type: 'control.steered',
      payload: { steering: { id: 'steer-1', clientId: 'vehicle-web', text: 'Lean on SRS components.' } },
    },
  ]
}
