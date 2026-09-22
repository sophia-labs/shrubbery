/**
 * Shell-owned Choreograph Studio effects.
 *
 * The Shrubbery components are deliberately controlled views. This module is
 * the concrete Garden-compatible host controller: it reads the run index,
 * resolves the frozen wf:Run/wf:AgentRun provenance projection, and consumes
 * Contract A telemetry over the gateway's authenticated SSE route with a JSON
 * poll fallback.
 */

import type {
  WfAgentRun,
  WfChoreographStatus,
  WfRunComparison,
  WfRunListItem,
  WfRunProvenance,
  WfStudioDataStatus,
  WfTelemetryNode,
  WfTelemetryPhase,
  WfTelemetryRun,
  WfWorkflowAnatomy,
  WfWorkflowDefinition,
  WfWorkflowGate,
  WfWorkflowLaunchDetail,
} from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'

type StudioContract = Pick<ShrubberyContract, 'auth' | 'runtime' | 'rest'>

export interface ChoreographStudioServiceOptions {
  readonly fetch?: typeof fetch
  readonly pollIntervalMs?: number
  readonly setTimeout?: typeof globalThis.setTimeout
  readonly clearTimeout?: typeof globalThis.clearTimeout
}

export type ChoreographRunListRead =
  | { readonly kind: 'ok'; readonly runs: readonly WfRunListItem[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly error: string }

export type ChoreographProvenanceRead =
  | { readonly kind: 'ok'; readonly provenance: WfRunProvenance }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly error: string }

export type ChoreographWorkflowRead =
  | { readonly kind: 'ok'; readonly workflows: readonly WfWorkflowDefinition[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly error: string }

export type ChoreographWorkflowLaunch =
  | { readonly kind: 'ok'; readonly runId: string }
  | { readonly kind: 'error'; readonly error: string }

interface ChoreographRunDetail {
  readonly runId: string
  readonly workflowName: string | null
  readonly status: string
  readonly durationMs: number | null
  readonly agentCount: number | null
  readonly totalTokens: number | null
  readonly synthesisDocId: string | null
}

type ChoreographRunDetailRead =
  | { readonly kind: 'ok'; readonly detail: ChoreographRunDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly error: string }

export interface ChoreographTelemetrySnapshot {
  readonly status: WfChoreographStatus
  readonly error: string
  readonly run: WfTelemetryRun | null
  readonly liveMessage: string
}

export interface ChoreographStudioSnapshot {
  readonly historyStatus: WfChoreographStatus
  readonly historyError: string
  readonly historyRuns: readonly WfRunListItem[]
  readonly monitorStatus: WfChoreographStatus
  readonly monitorError: string
  readonly provenance: WfRunProvenance | null
  readonly telemetry: WfTelemetryRun | null
  readonly liveMessage: string
  readonly workflowStatus: WfStudioDataStatus
  readonly workflowError: string
  readonly workflows: readonly WfWorkflowDefinition[]
  readonly selectedWorkflowName: string
  readonly launchPending: boolean
  readonly launchError: string
  readonly launchedRunId: string
  readonly anatomyStatus: WfStudioDataStatus
  readonly anatomyError: string
  readonly anatomy: WfWorkflowAnatomy | null
  readonly gatesStatus: WfStudioDataStatus
  readonly gatesError: string
  readonly gates: readonly WfWorkflowGate[]
  readonly compareStatus: WfStudioDataStatus
  readonly compareError: string
  readonly comparePending: boolean
  readonly comparison: WfRunComparison | null
}

type TelemetryListener = (snapshot: ChoreographTelemetrySnapshot) => void
type StudioListener = (snapshot: ChoreographStudioSnapshot) => void

interface ContractATelemetryEvent {
  readonly type?: string
  readonly runId?: string
  readonly workflowName?: string
  readonly seq?: number
  readonly ts?: number | string
  readonly phaseIndex?: number
  readonly phaseTitle?: string
  readonly nodeId?: string
  readonly status?: string
  readonly resultRef?: string
  readonly payload?: unknown
}

interface MutableTelemetryNode {
  id: string
  label: string
  status: string
  outputFragment: string | null
  resultDetail: string | null
  resultRef: string | null
}

interface MutableTelemetryPhase {
  phaseIndex: number
  label: string
  status: string
  nodes: Map<string, MutableTelemetryNode>
}

interface MutableTelemetryRun {
  runId: string
  workflowName: string
  status: string
  phases: Map<number, MutableTelemetryPhase>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function routeBase(contract: StudioContract, graphId: string): string {
  return contract.runtime.graphBaseUrl(graphId).replace(/\/+$/, '')
}

async function authHeaders(contract: StudioContract, accept: string): Promise<Record<string, string>> {
  await contract.auth.whenReady()
  const headers: Record<string, string> = {
    Accept: accept,
  }
  // The hosted gateway derives the actor from the Cognito bearer token. Sending
  // a browser-controlled identity header here both duplicates that authority and
  // adds a CORS-preflight header the public gateway intentionally rejects. A
  // local loopback cell still consumes the session identity header directly.
  if (contract.runtime.mode() === 'local') {
    headers['X-User-ID'] = contract.auth.userId()
  }
  const token = contract.auth.token()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function normalizeRun(value: unknown): WfRunListItem | null {
  const row = object(value)
  const runId = text(row.runId) ?? text(row.run_id)
  if (!runId) return null
  return {
    runId,
    workflowName: text(row.workflowName) ?? text(row.workflow_name),
    status: text(row.status) ?? 'unknown',
    startedAt: finite(row.startedAt) ?? finite(row.started_at),
    durationMs: finite(row.durationMs) ?? finite(row.duration_ms),
  }
}

function normalizeWorkflow(value: unknown): WfWorkflowDefinition | null {
  const row = object(value)
  const name = text(row.name)
  if (!name) return null
  const phases = Array.isArray(row.phases)
    ? row.phases
      .map((value) => {
        const phase = object(value)
        const title = text(phase.title)
        return title ? { title, detail: text(phase.detail) } : null
      })
      .filter((phase): phase is { title: string; detail: string | null } => phase != null)
    : undefined
  return {
    name,
    description: text(row.description),
    whenToUse: text(row.whenToUse) ?? text(row.when_to_use),
    ...(phases ? { phases } : {}),
  }
}

function normalizeRunDetail(value: unknown): ChoreographRunDetail | null {
  const body = object(value)
  const row = object(body.run ?? body.header ?? value)
  const runId = text(row.runId) ?? text(row.run_id)
  if (!runId) return null
  return {
    runId,
    workflowName: text(row.workflowName) ?? text(row.workflow_name),
    status: text(row.status) ?? 'unknown',
    durationMs: finite(row.durationMs) ?? finite(row.duration_ms),
    agentCount: finite(row.agentCount) ?? finite(row.agent_count),
    totalTokens: finite(row.totalTokens) ?? finite(row.total_tokens),
    synthesisDocId: text(row.synthesisDocId) ?? text(row.synthesis_doc_id),
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = object(await response.clone().json())
    const error = body.error
    if (typeof error === 'string' && error.trim()) return error.trim()
    return text(object(error).message) ?? fallback
  } catch {
    return fallback
  }
}

function sparqlLiteralValue(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  if (raw.startsWith('<') && raw.endsWith('>')) return raw.slice(1, -1)
  if (!raw.startsWith('"')) return raw

  let escaped = false
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      try {
        return JSON.parse(raw.slice(0, index + 1)) as string
      } catch {
        return raw.slice(1, index)
      }
    }
  }
  return raw
}

function sparqlNumber(raw: unknown): number | null {
  const value = sparqlLiteralValue(raw)
  return value == null ? null : finite(value)
}

function resultRows(value: unknown): readonly Record<string, string>[] {
  const envelope = object(value)
  if (Array.isArray(envelope.rows)) {
    return envelope.rows.filter((row): row is Record<string, string> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    )
  }
  const nested = object(envelope.result)
  return Array.isArray(nested.rows)
    ? nested.rows.filter((row): row is Record<string, string> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    )
    : []
}

function userRdfGraphIri(graphId: string): string {
  if (/[<>]/.test(graphId)) throw new Error('Graph id contains characters that cannot appear in its RDF graph IRI.')
  return `urn:mnemosyne:local:graph:${graphId}:user:rdf`
}

function runHeaderSparql(graphId: string, runId: string): string {
  return `PREFIX wf: <http://mnemosyne.dev/workflow#>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT DISTINCT ?run ?runId ?workflowName ?status ?durationMs ?startedAt
FROM <${userRdfGraphIri(graphId)}>
WHERE {
  ?run a wf:Run ; wf:runId ?runId .
  FILTER(STR(?runId) = ${JSON.stringify(runId)})
  OPTIONAL { ?run wf:workflowName ?workflowName }
  OPTIONAL { ?run wf:status ?status }
  OPTIONAL { ?run wf:durationMs ?durationMs }
  OPTIONAL { ?run prov:startedAtTime ?startedAt }
}`
}

function agentRunsSparql(graphId: string, runId: string): string {
  return `PREFIX wf: <http://mnemosyne.dev/workflow#>
SELECT DISTINCT ?agent ?label ?state ?durationMs ?startedAt
FROM <${userRdfGraphIri(graphId)}>
WHERE {
  ?run a wf:Run ; wf:runId ?runId .
  FILTER(STR(?runId) = ${JSON.stringify(runId)})
  ?agent a wf:AgentRun ; wf:partOfRun ?run .
  OPTIONAL { ?agent wf:label ?label }
  OPTIONAL { ?agent wf:state ?state }
  OPTIONAL { ?agent wf:durationMs ?durationMs }
  OPTIONAL { ?agent wf:startedAt ?startedAt }
}
ORDER BY ?startedAt ?label`
}

function statusRank(value: string | null): number {
  switch ((value ?? '').toLowerCase()) {
    case 'failed':
      return 7
    case 'completed':
    case 'finished':
      return 6
    case 'paused':
      return 5
    case 'stopped':
      return 4
    case 'running':
    case 'active':
      return 3
    case 'queued':
      return 2
    default:
      return 1
  }
}

function preferredStatus(values: readonly (string | null)[]): string {
  return values.reduce<string | null>(
    (best, value) => statusRank(value) > statusRank(best) ? value : best,
    null,
  ) ?? 'unknown'
}

function earliest(values: readonly (string | null)[]): string | null {
  const candidates = values.filter((value): value is string => value != null)
  return candidates.sort((left, right) => {
    const leftTime = Date.parse(left)
    const rightTime = Date.parse(right)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime
    return left.localeCompare(right)
  })[0] ?? null
}

function maximum(values: readonly (number | null)[]): number | null {
  const candidates = values.filter((value): value is number => value != null)
  return candidates.length ? Math.max(...candidates) : null
}

function detailText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function cloneTelemetry(run: MutableTelemetryRun | null): WfTelemetryRun | null {
  if (!run) return null
  const phases: WfTelemetryPhase[] = [...run.phases.values()]
    .sort((a, b) => a.phaseIndex - b.phaseIndex)
    .map((phase) => ({
      phaseIndex: phase.phaseIndex,
      label: phase.label,
      status: phase.status,
      nodes: [...phase.nodes.values()].map((node): WfTelemetryNode => ({
        id: node.id,
        label: node.label,
        status: node.status,
        outputFragment: node.outputFragment,
        resultDetail: node.resultDetail,
        resultRef: node.resultRef,
        detailStatus: node.resultDetail == null ? 'idle' : 'ready',
      })),
    }))
  return {
    runId: run.runId,
    workflowName: run.workflowName,
    status: run.status,
    phases,
  }
}

/** Authenticated Contract A SSE consumer with an automatic JSON poll fallback. */
export class ChoreographTelemetryConnection {
  private readonly listeners = new Set<TelemetryListener>()
  private readonly seen = new Set<number>()
  private readonly fetchImpl: typeof fetch
  private readonly schedule: typeof globalThis.setTimeout
  private readonly unschedule: typeof globalThis.clearTimeout
  private readonly pollIntervalMs: number
  private snapshot: ChoreographTelemetrySnapshot = {
    status: 'idle',
    error: '',
    run: null,
    liveMessage: '',
  }
  private mutableRun: MutableTelemetryRun | null = null
  private abort: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private nextSeq = 0
  private closed = false

  constructor(
    private readonly contract: StudioContract,
    private readonly graphId: string,
    private readonly runId: string,
    options: ChoreographStudioServiceOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Choreograph telemetry requires fetch.')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
    this.pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 2_000)
    this.schedule = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
    this.unschedule = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  }

  getState(): ChoreographTelemetrySnapshot {
    return this.snapshot
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.closed) return
    const generation = ++this.generation
    this.stopTransport()
    this.abort = new AbortController()
    this.patch({ status: 'connecting', error: '', liveMessage: 'Connecting to run telemetry' })
    await this.openSse(generation, this.abort.signal)
  }

  retry(): void {
    if (this.closed) return
    void this.start()
  }

  close(): void {
    this.closed = true
    this.generation += 1
    this.stopTransport()
    this.listeners.clear()
  }

  private stopTransport(): void {
    this.abort?.abort()
    this.abort = null
    if (this.timer != null) {
      this.unschedule(this.timer)
      this.timer = null
    }
  }

  private current(generation: number): boolean {
    return !this.closed && generation === this.generation
  }

  private patch(patch: Partial<ChoreographTelemetrySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  private endpoint(since = this.nextSeq): string {
    return `${routeBase(this.contract, this.graphId)}/workflows/runs/${encodeURIComponent(this.runId)}/events?since=${since}`
  }

  private async openSse(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.fetchImpl(this.endpoint(), {
        headers: await authHeaders(this.contract, 'text/event-stream'),
        cache: 'no-store',
        signal,
      })
      if (!this.current(generation)) return
      if (response.status === 404) {
        this.patch({ status: 'unavailable', error: '', liveMessage: 'Run telemetry is not available yet' })
        this.schedulePoll(generation)
        return
      }
      if (!response.ok) throw new Error(`Run telemetry request failed (${response.status}).`)

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream') || !response.body) {
        await this.consumeJson(response)
        if (this.current(generation) && !this.terminal()) this.schedulePoll(generation)
        return
      }

      this.patch({ status: 'ready', error: '', liveMessage: 'Live telemetry connected' })
      await this.consumeSse(response.body, generation)
      if (this.current(generation) && !this.terminal()) {
        this.patch({ status: 'connecting', liveMessage: 'Live stream ended; polling for updates' })
        this.schedulePoll(generation, 0)
      }
    } catch (error) {
      if (!this.current(generation) || signal.aborted) return
      this.patch({
        status: 'connecting',
        error: message(error),
        liveMessage: 'Live stream interrupted; polling for updates',
      })
      this.schedulePoll(generation, 0)
    }
  }

  private async consumeSse(stream: ReadableStream<Uint8Array>, generation: number): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (this.current(generation)) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          this.consumeSseFrame(frame)
          boundary = buffer.indexOf('\n\n')
        }
        if (done) break
      }
      if (buffer.trim()) this.consumeSseFrame(buffer)
    } finally {
      reader.releaseLock()
    }
  }

  private consumeSseFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    try {
      this.applyEvent(JSON.parse(data) as ContractATelemetryEvent)
    } catch {
      // A malformed event is isolated to its frame; later cursor events remain usable.
    }
  }

  private async consumeJson(response: Response): Promise<void> {
    const value = await response.json() as unknown
    const events = Array.isArray(value) ? value : object(value).events
    if (Array.isArray(events)) {
      for (const event of events) this.applyEvent(object(event) as ContractATelemetryEvent)
    }
    const cursor = finite(response.headers.get('x-next-since'))
    if (cursor != null) this.nextSeq = Math.max(this.nextSeq, Math.trunc(cursor))
  }

  private schedulePoll(generation: number, delay = this.pollIntervalMs): void {
    if (!this.current(generation) || this.terminal() || this.timer != null) return
    this.timer = this.schedule(() => {
      this.timer = null
      void this.poll(generation)
    }, delay)
  }

  private async poll(generation: number): Promise<void> {
    if (!this.current(generation)) return
    try {
      const response = await this.fetchImpl(this.endpoint(), {
        headers: await authHeaders(this.contract, 'application/json'),
        cache: 'no-store',
        signal: this.abort?.signal,
      })
      if (!this.current(generation)) return
      if (response.status === 404) {
        this.patch({ status: 'unavailable', error: '', liveMessage: 'Waiting for run telemetry' })
      } else if (!response.ok) {
        this.patch({ status: 'error', error: `Run telemetry poll failed (${response.status}).`, liveMessage: '' })
      } else {
        await this.consumeJson(response)
        this.patch({
          status: 'ready',
          error: '',
          liveMessage: this.terminal() ? this.terminalMessage() : 'Polling live telemetry',
        })
      }
    } catch (error) {
      if (!this.current(generation) || this.abort?.signal.aborted) return
      this.patch({ status: 'error', error: message(error), liveMessage: 'Retrying run telemetry' })
    }
    this.schedulePoll(generation)
  }

  private terminal(): boolean {
    return ['completed', 'finished', 'failed', 'stopped', 'paused'].includes(this.mutableRun?.status ?? '')
  }

  private finishOutstanding(run: MutableTelemetryRun): void {
    const successful = run.status === 'completed' || run.status === 'finished'
    for (const phase of run.phases.values()) {
      if (phase.status === 'active' || phase.status === 'unknown') {
        phase.status = successful ? 'exited' : run.status
      }
      for (const node of phase.nodes.values()) {
        if (node.status === 'queued' || node.status === 'running' || node.status === 'unknown') {
          node.status = successful ? 'finished' : run.status
        }
      }
    }
  }

  private terminalMessage(): string {
    switch (this.mutableRun?.status) {
      case 'completed':
      case 'finished':
        return 'Run completed'
      case 'failed':
        return 'Run failed'
      case 'stopped':
        return 'Run stopped'
      case 'paused':
        return 'Run paused'
      default:
        return 'Run finished'
    }
  }

  private ensureRun(event: ContractATelemetryEvent): MutableTelemetryRun {
    if (!this.mutableRun) {
      this.mutableRun = {
        runId: text(event.runId) ?? this.runId,
        workflowName: text(event.workflowName) ?? this.runId,
        status: 'running',
        phases: new Map(),
      }
    }
    if (text(event.workflowName)) this.mutableRun.workflowName = text(event.workflowName) as string
    return this.mutableRun
  }

  private ensurePhase(run: MutableTelemetryRun, event: ContractATelemetryEvent): MutableTelemetryPhase {
    const phaseIndex = Math.trunc(finite(event.phaseIndex) ?? 0)
    let phase = run.phases.get(phaseIndex)
    if (!phase) {
      phase = {
        phaseIndex,
        label: text(event.phaseTitle) ?? (phaseIndex ? `Phase ${phaseIndex}` : 'Run'),
        status: 'unknown',
        nodes: new Map(),
      }
      run.phases.set(phaseIndex, phase)
    }
    if (text(event.phaseTitle)) phase.label = text(event.phaseTitle) as string
    return phase
  }

  private ensureNode(phase: MutableTelemetryPhase, event: ContractATelemetryEvent): MutableTelemetryNode {
    const id = text(event.nodeId) ?? 'run'
    let node = phase.nodes.get(id)
    if (!node) {
      node = {
        id,
        label: id,
        status: 'unknown',
        outputFragment: null,
        resultDetail: null,
        resultRef: null,
      }
      phase.nodes.set(id, node)
    }
    return node
  }

  private applyEvent(event: ContractATelemetryEvent): void {
    if (text(event.runId) !== this.runId) return
    const seq = finite(event.seq)
    if (seq == null || this.seen.has(seq)) return
    this.seen.add(seq)
    this.nextSeq = Math.max(this.nextSeq, Math.trunc(seq) + 1)

    const run = this.ensureRun(event)
    switch (event.type) {
      case 'run.started':
        run.status = 'running'
        break
      case 'run.finished':
        run.status = text(event.status) ?? 'finished'
        this.finishOutstanding(run)
        break
      case 'phase.entered':
        this.ensurePhase(run, event).status = 'active'
        break
      case 'phase.exited':
        this.ensurePhase(run, event).status = 'exited'
        break
      case 'node.queued':
      case 'node.started':
      case 'node.output':
      case 'node.finished':
      case 'node.failed': {
        const phase = this.ensurePhase(run, event)
        const node = this.ensureNode(phase, event)
        node.status = event.type === 'node.queued'
          ? 'queued'
          : event.type === 'node.started' || event.type === 'node.output'
            ? 'running'
            : event.type === 'node.failed' || event.status === 'failed'
              ? 'failed'
              : 'finished'
        node.resultRef = text(event.resultRef) ?? node.resultRef
        const detail = detailText(event.payload)
        if (detail != null) {
          node.resultDetail = detail
          if (event.type === 'node.output') node.outputFragment = detail
        }
        break
      }
      default:
        break
    }

    this.patch({
      status: 'ready',
      error: '',
      run: cloneTelemetry(run),
      liveMessage: this.terminal() ? this.terminalMessage() : 'Live telemetry connected',
    })
  }
}

export class ChoreographStudioService {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly contract: StudioContract,
    private readonly options: ChoreographStudioServiceOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Choreograph Studio requires fetch.')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }

  async loadRuns(graphId: string, signal?: AbortSignal): Promise<ChoreographRunListRead> {
    const id = graphId.trim()
    if (!id) return { kind: 'error', error: 'A graph is required to list workflow runs.' }
    const query = new URLSearchParams({ graph_id: id, limit: '200' })
    try {
      const response = await this.fetchImpl(`${routeBase(this.contract, id)}/workflows/runs?${query}`, {
        headers: await authHeaders(this.contract, 'application/json'),
        cache: 'no-store',
        signal,
      })
      if (response.status === 404) return { kind: 'unavailable' }
      if (!response.ok) return { kind: 'error', error: `Workflow run list failed (${response.status}).` }
      const body = object(await response.json())
      const values = Array.isArray(body.runs) ? body.runs : Array.isArray(body.items) ? body.items : []
      const runs = values.map(normalizeRun).filter((run): run is WfRunListItem => run != null)
      return { kind: 'ok', runs }
    } catch (error) {
      if (signal?.aborted) return { kind: 'error', error: 'Workflow run list request was cancelled.' }
      return { kind: 'error', error: message(error) }
    }
  }

  async loadWorkflows(graphId: string, signal?: AbortSignal): Promise<ChoreographWorkflowRead> {
    const id = graphId.trim()
    if (!id) return { kind: 'error', error: 'A graph is required to load the workflow registry.' }
    try {
      const response = await this.fetchImpl(`${routeBase(this.contract, id)}/workflows`, {
        headers: await authHeaders(this.contract, 'application/json'),
        cache: 'no-store',
        signal,
      })
      if (response.status === 404) return { kind: 'unavailable' }
      if (!response.ok) {
        return {
          kind: 'error',
          error: await responseError(response, `Workflow registry failed (${response.status}).`),
        }
      }
      const body = object(await response.json())
      const values = Array.isArray(body.workflows) ? body.workflows : Array.isArray(body.items) ? body.items : []
      const workflows = values
        .map(normalizeWorkflow)
        .filter((workflow): workflow is WfWorkflowDefinition => workflow != null)
      return { kind: 'ok', workflows }
    } catch (error) {
      if (signal?.aborted) return { kind: 'error', error: 'Workflow registry request was cancelled.' }
      return { kind: 'error', error: message(error) }
    }
  }

  async launchWorkflow(detail: WfWorkflowLaunchDetail): Promise<ChoreographWorkflowLaunch> {
    const graphId = detail.graphId.trim()
    const workflowName = detail.workflowName.trim()
    if (!graphId || !workflowName) {
      return { kind: 'error', error: 'A graph and workflow are required to launch a run.' }
    }
    try {
      const headers = await authHeaders(this.contract, 'application/json')
      headers['Content-Type'] = 'application/json'
      const response = await this.fetchImpl(`${routeBase(this.contract, graphId)}/workflows/run`, {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({
          ...detail.inputs,
          workflow_name: workflowName,
          graph_id: graphId,
        }),
      })
      if (!response.ok) {
        return {
          kind: 'error',
          error: await responseError(response, `Workflow launch failed (${response.status}).`),
        }
      }
      const body = object(await response.json())
      const runId = text(body.runId) ?? text(body.run_id)
      return runId
        ? { kind: 'ok', runId }
        : { kind: 'error', error: 'Choreograph accepted the request without returning a run id.' }
    } catch (error) {
      return { kind: 'error', error: message(error) }
    }
  }

  async loadRunDetail(graphId: string, runId: string): Promise<ChoreographRunDetailRead> {
    const graph = graphId.trim()
    const run = runId.trim()
    if (!graph || !run) return { kind: 'not-found' }
    try {
      const response = await this.fetchImpl(
        `${routeBase(this.contract, graph)}/workflows/runs/${encodeURIComponent(run)}`,
        {
          headers: await authHeaders(this.contract, 'application/json'),
          cache: 'no-store',
        },
      )
      if (response.status === 404) return { kind: 'not-found' }
      if (!response.ok) {
        return {
          kind: 'error',
          error: await responseError(response, `Workflow run detail failed (${response.status}).`),
        }
      }
      const detail = normalizeRunDetail(await response.json())
      return detail
        ? { kind: 'ok', detail }
        : { kind: 'error', error: 'Workflow run detail did not contain a run header.' }
    } catch (error) {
      return { kind: 'error', error: message(error) }
    }
  }

  async loadProvenance(graphId: string, runId: string): Promise<ChoreographProvenanceRead> {
    const graph = graphId.trim()
    const run = runId.trim()
    if (!graph || !run) return { kind: 'not-found' }
    try {
      const headerRows = resultRows(await this.contract.rest.query(graph, runHeaderSparql(graph, run)))
      if (!headerRows.length) return { kind: 'not-found' }
      const runIds = headerRows.map((row) => sparqlLiteralValue(row.runId))
      const workflowNames = headerRows.map((row) => sparqlLiteralValue(row.workflowName))
      const statuses = headerRows.map((row) => sparqlLiteralValue(row.status))
      const startedAts = headerRows.map((row) => sparqlLiteralValue(row.startedAt))
      const durations = headerRows.map((row) => sparqlNumber(row.durationMs))
      const agentRows = resultRows(await this.contract.rest.query(graph, agentRunsSparql(graph, run)))
      const byAgent = new Map<string, Record<string, string>[]>()
      for (const row of agentRows) {
        const id = sparqlLiteralValue(row.agent)
        if (!id) continue
        const values = byAgent.get(id) ?? []
        values.push(row)
        byAgent.set(id, values)
      }
      const agents: WfAgentRun[] = [...byAgent.entries()].map(([id, rows]) => ({
        id,
        label: rows.map((row) => sparqlLiteralValue(row.label)).find((value) => value != null) ?? null,
        status: preferredStatus(rows.map((row) => sparqlLiteralValue(row.state))),
        startedAt: earliest(rows.map((row) => sparqlLiteralValue(row.startedAt))),
        durationMs: maximum(rows.map((row) => sparqlNumber(row.durationMs))),
      }))
      return {
        kind: 'ok',
        provenance: {
          runId: runIds.find((value) => value != null) ?? run,
          workflowName: workflowNames.find((value) => value != null) ?? run,
          status: preferredStatus(statuses),
          startedAt: earliest(startedAts),
          durationMs: maximum(durations),
          agentRuns: agents,
        },
      }
    } catch (error) {
      return { kind: 'error', error: message(error) }
    }
  }

  connect(graphId: string, runId: string): ChoreographTelemetryConnection {
    return new ChoreographTelemetryConnection(this.contract, graphId.trim(), runId.trim(), this.options)
  }
}

const EMPTY_STUDIO_SNAPSHOT: ChoreographStudioSnapshot = {
  historyStatus: 'idle',
  historyError: '',
  historyRuns: [],
  monitorStatus: 'idle',
  monitorError: '',
  provenance: null,
  telemetry: null,
  liveMessage: '',
  workflowStatus: 'idle',
  workflowError: '',
  workflows: [],
  selectedWorkflowName: '',
  launchPending: false,
  launchError: '',
  launchedRunId: '',
  anatomyStatus: 'idle',
  anatomyError: '',
  anatomy: null,
  gatesStatus: 'idle',
  gatesError: '',
  gates: [],
  compareStatus: 'idle',
  compareError: '',
  comparePending: false,
  comparison: null,
}

/** Lifecycle/controller used by the URL-level Studio mount. */
export class ChoreographStudioController {
  private readonly listeners = new Set<StudioListener>()
  private snapshot: ChoreographStudioSnapshot = EMPTY_STUDIO_SNAPSHOT
  private telemetry: ChoreographTelemetryConnection | null = null
  private unsubscribeTelemetry: (() => void) | null = null
  private historyAbort: AbortController | null = null
  private workflowAbort: AbortController | null = null
  private runGeneration = 0
  private activeGraphId = ''
  private activeRunId = ''
  private destroyed = false

  constructor(private readonly service: ChoreographStudioService) {}

  getState(): ChoreographStudioSnapshot {
    return this.snapshot
  }

  subscribe(listener: StudioListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  async start(screen: string, graphId: string, runId: string): Promise<void> {
    const graph = graphId.trim()
    this.activateGraph(graph)
    const jobs: Promise<void>[] = [this.refreshWorkflows(graph)]
    if (screen === 'home' || screen === 'runs' || screen === 'compare') {
      jobs.push(this.refreshHistory(graph))
    }
    if (screen === 'run' && runId.trim()) jobs.push(this.openRun(graph, runId))
    await Promise.all(jobs)
  }

  async refreshHistory(graphId = this.activeGraphId): Promise<void> {
    if (this.destroyed) return
    const nextGraphId = graphId.trim()
    this.activateGraph(nextGraphId)
    this.historyAbort?.abort()
    const abort = new AbortController()
    this.historyAbort = abort
    this.patch({
      historyStatus: 'loading',
      historyError: '',
    })
    const result = await this.service.loadRuns(this.activeGraphId, abort.signal)
    if (this.destroyed || abort.signal.aborted || this.historyAbort !== abort) return
    if (result.kind === 'ok') {
      this.patch({
        historyStatus: result.runs.length ? 'ready' : 'empty',
        historyRuns: result.runs,
        historyError: '',
      })
    } else if (result.kind === 'unavailable') {
      this.patch({ historyStatus: 'unavailable', historyRuns: [], historyError: '' })
    } else {
      this.patch({ historyStatus: 'error', historyRuns: [], historyError: result.error })
    }
  }

  async refreshWorkflows(graphId = this.activeGraphId): Promise<void> {
    if (this.destroyed) return
    const graph = graphId.trim()
    this.activateGraph(graph)
    this.workflowAbort?.abort()
    const abort = new AbortController()
    this.workflowAbort = abort
    this.patch({ workflowStatus: 'loading', workflowError: '' })
    const result = await this.service.loadWorkflows(graph, abort.signal)
    if (this.destroyed || abort.signal.aborted || this.workflowAbort !== abort) return
    if (result.kind === 'ok') {
      const selected = this.snapshot.selectedWorkflowName
      this.patch({
        workflowStatus: result.workflows.length ? 'ready' : 'empty',
        workflowError: '',
        workflows: result.workflows,
        selectedWorkflowName: result.workflows.some((workflow) => workflow.name === selected)
          ? selected
          : result.workflows[0]?.name ?? '',
      })
    } else if (result.kind === 'unavailable') {
      this.patch({ workflowStatus: 'unavailable', workflowError: '', workflows: [] })
    } else {
      this.patch({ workflowStatus: 'error', workflowError: result.error, workflows: [] })
    }
  }

  async launchWorkflow(detail: WfWorkflowLaunchDetail): Promise<void> {
    if (this.destroyed) return
    this.activateGraph(detail.graphId.trim())
    this.patch({
      launchPending: true,
      launchError: '',
      launchedRunId: '',
      selectedWorkflowName: detail.workflowName,
    })
    const result = await this.service.launchWorkflow(detail)
    if (this.destroyed) return
    if (result.kind === 'error') {
      this.patch({ launchPending: false, launchError: result.error })
      return
    }
    this.patch({ launchPending: false, launchError: '', launchedRunId: result.runId })
    await Promise.all([
      this.refreshHistory(detail.graphId),
      this.openRun(detail.graphId, result.runId),
    ])
  }

  async loadAnatomy(graphId: string, workflowName: string): Promise<void> {
    if (this.destroyed) return
    const graph = graphId.trim()
    const name = workflowName.trim()
    this.activateGraph(graph)
    this.patch({ anatomyStatus: 'loading', anatomyError: '', anatomy: null })
    if (!name) {
      this.patch({ anatomyStatus: 'error', anatomyError: 'Choose a workflow.', anatomy: null })
      return
    }
    if (this.snapshot.workflowStatus !== 'ready' && this.snapshot.workflowStatus !== 'empty') {
      await this.refreshWorkflows(graph)
    }
    if (this.destroyed) return
    const workflow = this.snapshot.workflows.find((item) => item.name === name)
    if (!workflow) {
      this.patch({
        anatomyStatus: 'error',
        anatomyError: `Workflow ${name} is not present in the registry.`,
        anatomy: null,
      })
      return
    }
    this.patch({
      selectedWorkflowName: name,
      anatomyStatus: 'ready',
      anatomyError: '',
      anatomy: {
        name,
        description: workflow.description,
        phases: (workflow.phases ?? []).map((phase, index) => ({
          index: index + 1,
          title: phase.title,
          detail: phase.detail,
          nodes: [],
        })),
      },
    })
  }

  loadGates(graphId: string, workflowName: string): void {
    if (this.destroyed) return
    this.activateGraph(graphId.trim())
    this.patch({
      selectedWorkflowName: workflowName.trim(),
      gatesStatus: 'empty',
      gatesError: '',
      gates: [],
    })
  }

  async compareRuns(graphId: string, leftRunId: string, rightRunId: string): Promise<void> {
    if (this.destroyed) return
    const graph = graphId.trim()
    const left = leftRunId.trim()
    const right = rightRunId.trim()
    this.activateGraph(graph)
    this.patch({
      compareStatus: 'loading',
      compareError: '',
      comparePending: true,
      comparison: null,
    })
    const [leftRead, rightRead] = await Promise.all([
      this.service.loadRunDetail(graph, left),
      this.service.loadRunDetail(graph, right),
    ])
    if (this.destroyed) return
    if (leftRead.kind !== 'ok' || rightRead.kind !== 'ok') {
      const error = leftRead.kind === 'error'
        ? leftRead.error
        : rightRead.kind === 'error'
          ? rightRead.error
          : 'One or both workflow runs were not found.'
      this.patch({ compareStatus: 'error', compareError: error, comparePending: false })
      return
    }
    const fields: WfRunComparison['fields'] = [
      { label: 'Workflow', left: leftRead.detail.workflowName, right: rightRead.detail.workflowName },
      { label: 'Status', left: leftRead.detail.status, right: rightRead.detail.status },
      {
        label: 'Duration (ms)',
        left: leftRead.detail.durationMs,
        right: rightRead.detail.durationMs,
        delta: leftRead.detail.durationMs != null && rightRead.detail.durationMs != null
          ? rightRead.detail.durationMs - leftRead.detail.durationMs
          : null,
      },
      {
        label: 'Agents',
        left: leftRead.detail.agentCount,
        right: rightRead.detail.agentCount,
        delta: leftRead.detail.agentCount != null && rightRead.detail.agentCount != null
          ? rightRead.detail.agentCount - leftRead.detail.agentCount
          : null,
      },
      {
        label: 'Tokens',
        left: leftRead.detail.totalTokens,
        right: rightRead.detail.totalTokens,
        delta: leftRead.detail.totalTokens != null && rightRead.detail.totalTokens != null
          ? rightRead.detail.totalTokens - leftRead.detail.totalTokens
          : null,
      },
      {
        label: 'Synthesis document',
        left: leftRead.detail.synthesisDocId,
        right: rightRead.detail.synthesisDocId,
      },
    ]
    this.patch({
      compareStatus: 'ready',
      compareError: '',
      comparePending: false,
      comparison: { leftRunId: left, rightRunId: right, fields },
    })
  }

  async openRun(graphId: string, runId: string): Promise<void> {
    if (this.destroyed) return
    const graph = graphId.trim()
    const run = runId.trim()
    if (!graph || !run) {
      this.patch({ monitorStatus: 'error', monitorError: 'Graph id and run id are required.' })
      return
    }
    this.activateGraph(graph)
    this.activeRunId = run
    const generation = ++this.runGeneration
    this.closeTelemetry()
    this.patch({
      monitorStatus: 'connecting',
      monitorError: '',
      provenance: null,
      telemetry: null,
      liveMessage: 'Connecting to run telemetry',
    })

    this.telemetry = this.service.connect(graph, run)
    this.unsubscribeTelemetry = this.telemetry.subscribe((state) => {
      if (this.destroyed || generation !== this.runGeneration) return
      this.patch({
        monitorStatus: state.status,
        monitorError: state.error,
        telemetry: state.run,
        liveMessage: state.liveMessage,
      })
    })
    void this.telemetry.start()

    await this.loadProvenance(generation)
  }

  retry(): void {
    this.telemetry?.retry()
  }

  refreshProvenance(): Promise<void> {
    return this.loadProvenance(this.runGeneration)
  }

  destroy(): void {
    this.destroyed = true
    this.runGeneration += 1
    this.historyAbort?.abort()
    this.historyAbort = null
    this.workflowAbort?.abort()
    this.workflowAbort = null
    this.closeTelemetry()
    this.listeners.clear()
  }

  private closeTelemetry(): void {
    this.unsubscribeTelemetry?.()
    this.unsubscribeTelemetry = null
    this.telemetry?.close()
    this.telemetry = null
  }

  private activateGraph(graphId: string): boolean {
    if (graphId === this.activeGraphId) return false
    this.activeGraphId = graphId
    this.runGeneration += 1
    this.activeRunId = ''
    this.historyAbort?.abort()
    this.historyAbort = null
    this.workflowAbort?.abort()
    this.workflowAbort = null
    this.closeTelemetry()
    this.patch({
      historyStatus: 'idle',
      historyError: '',
      historyRuns: [],
      monitorStatus: 'idle',
      monitorError: '',
      provenance: null,
      telemetry: null,
      liveMessage: '',
      workflowStatus: 'idle',
      workflowError: '',
      workflows: [],
      selectedWorkflowName: '',
      launchPending: false,
      launchError: '',
      launchedRunId: '',
      anatomyStatus: 'idle',
      anatomyError: '',
      anatomy: null,
      gatesStatus: 'idle',
      gatesError: '',
      gates: [],
      compareStatus: 'idle',
      compareError: '',
      comparePending: false,
      comparison: null,
    })
    return true
  }

  private async loadProvenance(generation: number): Promise<void> {
    if (!this.activeGraphId || !this.activeRunId) return
    const provenance = await this.service.loadProvenance(this.activeGraphId, this.activeRunId)
    if (this.destroyed || generation !== this.runGeneration) return
    if (provenance.kind === 'ok') {
      this.patch({ provenance: provenance.provenance })
    } else if (provenance.kind === 'error') {
      this.patch({ monitorError: provenance.error })
    }
  }

  private patch(patch: Partial<ChoreographStudioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }
}
