import { arrayAt, asRecord, firstNonBlankString, numberAt, stringAt, valueAt, type JsonRecord as NucleusJsonRecord } from '@shrubbery/nucleus'

export type JsonRecord = NucleusJsonRecord

const DEFAULT_LOCAL_CHOREOGRAPH_BASE_URL = 'http://127.0.0.1:3456'

export interface GreenhouseAuthConfig {
  readonly bearerToken?: string | null
  readonly internalServiceSecret?: string | null
  readonly userId?: string | null
}

export interface GreenhouseConfig {
  readonly baseUrl: string
  readonly agentId: string
  readonly clientId: string
  readonly authorId: string
  readonly role: string
  readonly pollMs: number
  readonly auth: GreenhouseAuthConfig
}

export interface GreenhouseAgentRecord extends JsonRecord {
  readonly agentId: string
  readonly handle: string
  readonly graphId: string
  readonly lifecycle: string
  readonly kindLine?: string
  readonly sessionCount?: number
  readonly careerTurns?: number
  readonly careerTokens?: number
  readonly careerMemories?: number
  readonly firstSessionAt?: number | string
  readonly model?: string
  readonly provider?: string
  readonly agentType?: string
  readonly workflowName?: string
  readonly activeSessionId?: string
  readonly activeRunId?: string
  readonly updatedAt?: number | string
  readonly createdAt?: number | string
}

export interface GreenhouseAgentListResponse {
  readonly agents: readonly GreenhouseAgentRecord[]
  readonly count: number
}

/**
 * One row of `GET /api/agents/:id/sessions` (the logbook skeleton, D1/D2). The
 * projection serves `objective`, `messageCount`, and `lastMessageAt` populated on
 * fresh sessions and honestly null on pre-migration rows — rendered as silence,
 * never backfilled or faked.
 */
export interface GreenhouseAgentSessionRecord extends JsonRecord {
  readonly sessionId: string
  readonly runId?: string | null
  readonly workflowName?: string | null
  readonly graphId?: string | null
  readonly model?: string | null
  readonly status?: string | null
  readonly objective?: string | null
  readonly messageCount?: number | null
  readonly lastMessageAt?: number | null
  readonly createdAt?: number | null
  readonly updatedAt?: number | null
}

export interface GreenhouseAgentSessionsResponse {
  readonly sessions: readonly GreenhouseAgentSessionRecord[]
  readonly count: number
}

export interface GreenhouseAgentSessionMessagesResponse {
  readonly session: JsonRecord | null
  readonly messages: readonly JsonRecord[]
  readonly count: number
}

/**
 * One row of `GET /api/agents/:id/incidents` (K3) — a witnessed terminal anomaly or
 * repeated tool failure. `ts`, `kind`, and `sessionId` are the card's read; `detail`
 * is the raw event payload, carried whole for the trace stance that will own it.
 */
export interface GreenhouseAgentIncident extends JsonRecord {
  readonly ts: number
  readonly kind: string
  readonly sessionId?: string | null
  readonly detail?: unknown
}

export interface GreenhouseAgentIncidentsResponse {
  readonly incidents: readonly GreenhouseAgentIncident[]
  readonly count: number
}

/**
 * One row of `GET /api/agents/:id/prompt-bindings` (K2) — the promotion chain,
 * newest-first. A superseded row carries its `activeUntil` (its retired date); the
 * active row carries `activeUntil: null`.
 */
export interface GreenhouseAgentPromptBinding extends JsonRecord {
  readonly bindingId: string
  readonly status?: string | null
  readonly snapshotId?: string | null
  readonly digest?: string | null
  readonly activeFrom?: number | null
  readonly activeUntil?: number | null
}

export interface GreenhouseAgentPromptBindingsResponse {
  readonly bindings: readonly GreenhouseAgentPromptBinding[]
  readonly count: number
}

export interface GreenhouseAgentSummary extends JsonRecord {
  readonly sessionId?: string
  readonly graphId?: string
  readonly workflowName?: string
  readonly label?: string
  readonly model?: string
}

export interface GreenhouseRunSummary extends JsonRecord {
  readonly runId?: string
  readonly graphId?: string
  readonly workflowName?: string
}

export interface GreenhouseAgentWorldDoc extends JsonRecord {
  readonly agent: JsonRecord
  readonly status: JsonRecord
  readonly prompts: JsonRecord
  readonly toolbelt: JsonRecord
  readonly schemas: JsonRecord
  readonly world: JsonRecord
  readonly memory: JsonRecord
  readonly conversation: JsonRecord
  readonly runtime: JsonRecord
  readonly control: JsonRecord
  readonly collaborators: JsonRecord
  readonly codex: JsonRecord
  readonly ontology: JsonRecord
}

export interface GreenhouseAgentWorldResponse {
  readonly agent: JsonRecord
  readonly worldDoc: GreenhouseAgentWorldDoc
  readonly agentVisiblePacket: unknown
  readonly session: GreenhouseAgentSummary | null
  readonly run: GreenhouseRunSummary | null
}

export interface GreenhouseAgentSessionEvent {
  readonly sessionId?: string
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload?: unknown
}

export interface GreenhouseAgentWorldEventsResponse extends GreenhouseAgentWorldResponse {
  readonly events: readonly GreenhouseAgentSessionEvent[]
  readonly nextCursor: number
}

export interface GreenhouseAgentModelRequest {
  readonly authorId: string
  readonly model: string
  readonly provider: string
}

export interface GreenhouseAgentControlRequest {
  readonly clientId: string
  readonly action?: 'claim' | 'release'
}

export interface GreenhouseAgentSteerRequest {
  readonly clientId: string
  readonly text: string
  readonly commandId?: string
}

export interface GreenhouseAgentWorldMessageRequest {
  readonly authorId: string
  readonly role: string
  readonly visibility: string
  readonly text: string
  readonly autoTurn?: boolean
}

export interface GreenhouseAgentControlResponse {
  readonly applied: boolean
  readonly driver?: unknown
  readonly reason?: string
  readonly events: readonly GreenhouseAgentSessionEvent[]
  readonly document?: GreenhouseAgentWorldDoc
  readonly documentOp?: unknown
  readonly liveDelivery?: unknown
}

export interface GreenhouseAgentWorldMessageResponse extends GreenhouseAgentWorldResponse {
  readonly message?: JsonRecord
  readonly autoTurn?: unknown
}

export function readGreenhouseConfig(search = globalThis.location?.search ?? ''): GreenhouseConfig {
  const params = new URLSearchParams(search)
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  const configuredBaseUrl = params.get('baseUrl') || env.VITE_GREENHOUSE_API_BASE_URL || null
  const baseUrl = configuredBaseUrl ?? DEFAULT_LOCAL_CHOREOGRAPH_BASE_URL
  const useLocalDevAuth =
    /^https?:\/\/(?:127\.0\.0\.1|localhost):3456\/?$/.test(baseUrl) &&
    !params.get('bearerToken') &&
    !params.get('internalServiceSecret') &&
    !env.VITE_CHOREOGRAPH_BEARER_TOKEN &&
    !env.VITE_CHOREOGRAPH_INTERNAL_SERVICE_SECRET

  return {
    baseUrl,
    agentId: params.get('agent') ?? params.get('agentId') ?? env.VITE_GREENHOUSE_AGENT_ID ?? 'learner-1',
    clientId: params.get('clientId') ?? env.VITE_GREENHOUSE_CLIENT_ID ?? 'vehicle-web',
    authorId: params.get('authorId') ?? env.VITE_GREENHOUSE_AUTHOR_ID ?? 'vera',
    role: params.get('role') ?? env.VITE_GREENHOUSE_ROLE ?? 'user',
    pollMs: Number(params.get('pollMs') ?? env.VITE_GREENHOUSE_POLL_MS ?? '5000') || 5000,
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

export function createGreenhouseService(config: GreenhouseConfig): GreenhouseService {
  return new GreenhouseService(config.baseUrl, config.auth)
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

export function driverLabel(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return stringAt(record, ['clientId']) ?? stringAt(record, ['holder'])
}

function normalizeAgentList(value: unknown): GreenhouseAgentListResponse {
  const record = asRecord(value)
  const agents = arrayAt<unknown>(record, ['agents']).map(normalizeAgentRecord)
  return {
    agents,
    count: Number(record.count ?? agents.length),
  }
}

function normalizeAgentRecord(value: unknown): GreenhouseAgentRecord {
  const record = asRecord(value)
  const model = modelFromRecord(record)
  return {
    ...(record as GreenhouseAgentRecord),
    agentId: stringAt(record, ['agentId']) ?? stringAt(record, ['agent_id']) ?? stringAt(record, ['id']) ?? '',
    handle: stringAt(record, ['handle']) ?? stringAt(record, ['label']) ?? '',
    graphId: stringAt(record, ['graphId']) ?? stringAt(record, ['graph_id']) ?? '',
    lifecycle: stringAt(record, ['lifecycle']) ?? stringAt(record, ['status']) ?? '',
    ...(model ? { model } : {}),
  }
}

function normalizeSessionRecord(value: unknown): GreenhouseAgentSessionRecord {
  const record = asRecord(value)
  return {
    ...(record as GreenhouseAgentSessionRecord),
    sessionId: stringAt(record, ['sessionId']) ?? stringAt(record, ['session_id']) ?? stringAt(record, ['id']) ?? '',
  }
}

function normalizeSessions(value: unknown): GreenhouseAgentSessionsResponse {
  const record = asRecord(value)
  const sessions = arrayAt<unknown>(record, ['sessions'])
    .map(normalizeSessionRecord)
    .filter((session) => session.sessionId)
  return { sessions, count: Number(record.count ?? sessions.length) }
}

function normalizeIncident(value: unknown): GreenhouseAgentIncident {
  const record = asRecord(value)
  return {
    ...(record as GreenhouseAgentIncident),
    ts: numberAt(record, ['ts']) ?? 0,
    kind: stringAt(record, ['kind']) ?? '',
    sessionId: stringAt(record, ['sessionId']),
    detail: record.detail,
  }
}

function normalizeIncidents(value: unknown): GreenhouseAgentIncidentsResponse {
  const record = asRecord(value)
  const incidents = arrayAt<unknown>(record, ['incidents'])
    .map(normalizeIncident)
    .filter((incident) => incident.kind && incident.ts > 0)
  return { incidents, count: Number(record.count ?? incidents.length) }
}

function normalizePromptBinding(value: unknown): GreenhouseAgentPromptBinding {
  const record = asRecord(value)
  return {
    ...(record as GreenhouseAgentPromptBinding),
    bindingId: stringAt(record, ['bindingId']) ?? '',
    status: stringAt(record, ['status']),
    snapshotId: stringAt(record, ['snapshotId']),
    digest: stringAt(record, ['digest']),
    activeFrom: numberAt(record, ['activeFrom']),
    activeUntil: numberAt(record, ['activeUntil']),
  }
}

function normalizePromptBindings(value: unknown): GreenhouseAgentPromptBindingsResponse {
  const record = asRecord(value)
  const bindings = arrayAt<unknown>(record, ['bindings'])
    .map(normalizePromptBinding)
    .filter((binding) => binding.bindingId)
  return { bindings, count: Number(record.count ?? bindings.length) }
}

function normalizeSessionMessages(value: unknown): GreenhouseAgentSessionMessagesResponse {
  const record = asRecord(value)
  const messages = arrayAt<unknown>(record, ['messages']).map((message) => asRecord(message))
  return {
    session: record.session ? asRecord(record.session) : null,
    messages,
    count: Number(record.count ?? messages.length),
  }
}

function normalizeWorldDoc(value: unknown): GreenhouseAgentWorldDoc {
  const record = asRecord(value)
  return {
    ...(record as GreenhouseAgentWorldDoc),
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

function normalizeWorld(value: unknown): GreenhouseAgentWorldResponse {
  const record = asRecord(value)
  return {
    agent: asRecord(record.agent),
    worldDoc: normalizeWorldDoc(record.worldDoc),
    agentVisiblePacket: record.agentVisiblePacket,
    session: record.session ? (asRecord(record.session) as GreenhouseAgentSummary) : null,
    run: record.run ? (asRecord(record.run) as GreenhouseRunSummary) : null,
  }
}

function normalizeEvent(value: unknown): GreenhouseAgentSessionEvent {
  const record = asRecord(value)
  return {
    ...(record as unknown as GreenhouseAgentSessionEvent),
    seq: Number(record.seq ?? 0),
    ts: Number(record.ts ?? 0),
    type: stringAt(record, ['type']) ?? '',
    payload: record.payload,
  }
}

function normalizeControlResponse(value: unknown): GreenhouseAgentControlResponse {
  const record = asRecord(value)
  return {
    applied: Boolean(record.applied),
    driver: record.driver,
    ...(record.reason ? { reason: String(record.reason) } : {}),
    events: arrayAt<unknown>(record, ['events']).map(normalizeEvent),
    ...(record.document ? { document: normalizeWorldDoc(record.document) } : {}),
    documentOp: record.documentOp,
    liveDelivery: record.liveDelivery,
  }
}

function isWorldResponse(value: unknown): boolean {
  const record = asRecord(value)
  return !!record.worldDoc
}

export class GreenhouseService {
  private readonly baseUrl: string
  private readonly auth: GreenhouseAuthConfig

  constructor(baseUrl: string, auth: GreenhouseAuthConfig = {}) {
    this.baseUrl = baseUrl.trim().replace(/\/$/, '')
    this.auth = auth
  }

  async listAgents(limit = 100): Promise<GreenhouseAgentListResponse> {
    return normalizeAgentList(await this.get(`/api/agents?limit=${limit}`))
  }

  async readAgentWorld(agentId: string): Promise<GreenhouseAgentWorldResponse> {
    return normalizeWorld(await this.get(`/api/agents/${encodeURIComponent(agentId)}/world`))
  }

  async listAgentSessions(agentId: string, limit = 50): Promise<GreenhouseAgentSessionsResponse> {
    return normalizeSessions(await this.get(`/api/agents/${encodeURIComponent(agentId)}/sessions?limit=${limit}`))
  }

  async readAgentSessionMessages(sessionId: string): Promise<GreenhouseAgentSessionMessagesResponse> {
    return normalizeSessionMessages(await this.get(`/api/agent-sessions/${encodeURIComponent(sessionId)}/messages`))
  }

  async listAgentIncidents(agentId: string, limit = 20): Promise<GreenhouseAgentIncidentsResponse> {
    return normalizeIncidents(await this.get(`/api/agents/${encodeURIComponent(agentId)}/incidents?limit=${limit}`))
  }

  async listAgentPromptBindings(agentId: string): Promise<GreenhouseAgentPromptBindingsResponse> {
    return normalizePromptBindings(await this.get(`/api/agents/${encodeURIComponent(agentId)}/prompt-bindings`))
  }

  async pollAgentWorld(agentId: string, cursor: number): Promise<GreenhouseAgentWorldEventsResponse> {
    const value = (await this.get(`/api/agents/${encodeURIComponent(agentId)}/world/events?cursor=${cursor}`)) as unknown
    const world = normalizeWorld(value)
    return {
      ...world,
      events: arrayAt<unknown>(value, ['events']).map(normalizeEvent),
      nextCursor: Number(valueAt(value, ['nextCursor']) ?? cursor),
    }
  }

  async setAgentModel(agentId: string, request: GreenhouseAgentModelRequest): Promise<GreenhouseAgentWorldResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/model`, request)
    return isWorldResponse(value) ? normalizeWorld(value) : this.readAgentWorld(agentId)
  }

  async claimAgentDriver(agentId: string, request: GreenhouseAgentControlRequest): Promise<GreenhouseAgentControlResponse> {
    return normalizeControlResponse(
      await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/driver`, { ...request, action: 'claim' }),
    )
  }

  async releaseAgentDriver(agentId: string, request: GreenhouseAgentControlRequest): Promise<GreenhouseAgentControlResponse> {
    return normalizeControlResponse(
      await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/driver`, { ...request, action: 'release' }),
    )
  }

  async steerAgent(agentId: string, request: GreenhouseAgentSteerRequest): Promise<GreenhouseAgentControlResponse> {
    return normalizeControlResponse(await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/steer`, request))
  }

  async sendAgentWorldMessage(
    agentId: string,
    request: GreenhouseAgentWorldMessageRequest,
  ): Promise<GreenhouseAgentWorldMessageResponse> {
    const value = await this.post(`/api/agents/${encodeURIComponent(agentId)}/world/messages`, request)
    const record = asRecord(value)
    const world = isWorldResponse(value) ? normalizeWorld(value) : await this.readAgentWorld(agentId)
    return {
      ...world,
      ...(record.message ? { message: asRecord(record.message) } : {}),
      ...(record.autoTurn ? { autoTurn: record.autoTurn } : {}),
    }
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
    if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}`)
    return (text ? JSON.parse(text) : {}) as T
  }
}
