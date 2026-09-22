/**
 * Authenticated gardend-backed Local AI settings.
 *
 * The Garden desktop settings page talks to these services through Tauri IPC.
 * A headless gardend cell exposes the same model, semantic-index, and ingestion
 * primitives over its loopback REST API. This controller keeps that transport
 * in the shell and projects only non-secret, render-ready rows into the
 * controlled settings component.
 */

import type {
  MnSettingsJob,
  MnSettingsSection,
} from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'

type LocalAiContract = Pick<ShrubberyContract, 'auth' | 'runtime'>

export interface GardendLocalAiSettingsOptions {
  readonly fetch?: typeof fetch
  readonly pollIntervalMs?: number
  readonly jobTimeoutMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

interface JsonRecord {
  readonly [key: string]: unknown
}

interface SemanticModelStatus extends JsonRecord {
  readonly modelId?: string
  readonly displayName?: string
  readonly providerId?: string
  readonly prepared?: boolean
  readonly loaded?: boolean
  readonly setupRequired?: boolean
  readonly runtimeAvailable?: boolean
  readonly effectiveBatchSize?: number
  readonly defaultBatchSize?: number
  readonly reason?: string | null
}

interface SemanticModelDescriptor extends JsonRecord {
  readonly modelId?: string
  readonly displayName?: string
  readonly selected?: boolean
  readonly recommended?: boolean
  readonly effectiveBatchSize?: number
  readonly defaultBatchSize?: number
}

interface SemanticIndexStatus extends JsonRecord {
  readonly documentCount?: number
  readonly blockCount?: number
  readonly staleDocumentCount?: number
  readonly indexedAt?: string | null
  readonly compatible?: boolean
  readonly reason?: string | null
}

interface PdfEngineDescriptor extends JsonRecord {
  readonly engineId?: string
  readonly label?: string
  readonly implemented?: boolean
  readonly available?: boolean
  readonly status?: string
}

interface PdfPreferenceOption extends JsonRecord {
  readonly engineId?: string
  readonly label?: string
  readonly description?: string
}

interface PdfPipelineStatus extends JsonRecord {
  readonly preferredEngineId?: string
  readonly effectiveEngineId?: string
  readonly effectiveReason?: string
  readonly platform?: string
  readonly engines?: readonly PdfEngineDescriptor[]
  readonly preferenceOptions?: readonly PdfPreferenceOption[]
}

interface IngestionApproach extends JsonRecord {
  readonly approachId?: string
  readonly label?: string
  readonly family?: string
  readonly status?: string
  readonly selectable?: boolean
}

interface DoclingRuntimeStatus extends JsonRecord {
  readonly prepared?: boolean
  readonly available?: boolean
  readonly supported?: boolean
  readonly setupRequired?: boolean
  readonly status?: string
  readonly reason?: string | null
}

type LocalAiOperationStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

interface LocalAiOperation {
  readonly id: string
  readonly label: string
  readonly status: LocalAiOperationStatus
  readonly detail: string
  readonly progress: number | null
  readonly backendJobId?: string | null
}

const MODEL_BATCH_SIZES = [1, 2, 4, 8, 16, 32, 64] as const
const LOAD_KEYS = ['model', 'models', 'index', 'approaches', 'docling', 'pdf'] as const
type LoadKey = (typeof LOAD_KEYS)[number]

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clampPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null
}

function errorText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return fallback
  for (const key of ['error', 'message', 'detail']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (isRecord(candidate)) {
      const nested = errorText(candidate, '')
      if (nested) return nested
    }
  }
  return fallback
}

async function responseValue(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const body = await response.text()
  if (!body.trim()) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

function modelReadiness(status: SemanticModelStatus | null): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!status) return { label: 'Unavailable', tone: 'danger' }
  if (status.prepared && status.loaded) return { label: 'Prepared and loaded', tone: 'success' }
  if (status.loaded) return { label: 'Loaded for this run', tone: 'success' }
  if (status.prepared) return { label: 'Prepared', tone: 'warning' }
  if (status.runtimeAvailable === false) return { label: 'Runtime unavailable', tone: 'danger' }
  return { label: 'Setup required', tone: 'warning' }
}

function indexReadiness(status: SemanticIndexStatus | null): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!status) return { label: 'Unavailable', tone: 'danger' }
  if (status.compatible === false) return { label: 'Incompatible', tone: 'danger' }
  if (finiteNumber(status.staleDocumentCount) > 0) return { label: 'Stale', tone: 'warning' }
  if (stringValue(status.indexedAt)) return { label: 'Ready', tone: 'success' }
  return { label: 'Not built', tone: 'neutral' }
}

function formatCount(value: unknown, singular: string, plural = `${singular}s`): string {
  const count = finiteNumber(value)
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

export class GardendLocalAiSettings {
  private readonly fetchImpl: typeof fetch
  private readonly pollIntervalMs: number
  private readonly jobTimeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly subscribers = new Set<() => void>()
  private readonly errors = new Map<LoadKey | 'operation', string>()
  private loaded = false
  private loading = false
  private modelStatus: SemanticModelStatus | null = null
  private models: readonly SemanticModelDescriptor[] = []
  private indexStatus: SemanticIndexStatus | null = null
  private approaches: readonly IngestionApproach[] = []
  private doclingStatus: DoclingRuntimeStatus | null = null
  private pdfStatus: PdfPipelineStatus | null = null
  private operation: LocalAiOperation | null = null

  constructor(
    private readonly contract: LocalAiContract,
    private readonly graphId: string,
    options: GardendLocalAiSettingsOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('GardendLocalAiSettings: fetch is unavailable')
    this.fetchImpl = fetchImpl.bind(globalThis)
    this.pollIntervalMs = options.pollIntervalMs ?? 750
    this.jobTimeoutMs = options.jobTimeoutMs ?? 10 * 60_000
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.now = options.now ?? Date.now
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private emit(): void {
    for (const callback of this.subscribers) callback()
  }

  private apiBase(): string {
    const base = this.contract.runtime.graphBaseUrl(this.graphId).replace(/\/+$/, '')
    if (!base) throw new Error(`No Local AI API base is available for graph ${this.graphId}`)
    return base
  }

  private headers(extra: HeadersInit = {}): Headers {
    const headers = new Headers(extra)
    const token = this.contract.auth.token()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const userId = this.contract.auth.userId()
    if (userId) headers.set('X-User-ID', userId)
    return headers
  }

  private async request(path: string, init: RequestInit = {}, label = 'Local AI request'): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase()}${path}`, {
      ...init,
      headers: this.headers(init.headers),
      cache: init.cache ?? 'no-store',
    })
    const payload = await responseValue(response)
    if (!response.ok) throw new Error(errorText(payload, `${label} failed: HTTP ${response.status}`))
    return payload
  }

  private async json(path: string, method: 'POST' | 'PUT', body: unknown, label: string): Promise<unknown> {
    return this.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, label)
  }

  private async read<T>(key: LoadKey, path: string): Promise<T | null> {
    try {
      const value = await this.request(path, {}, `Read ${key}`)
      this.errors.delete(key)
      return value as T
    } catch (error) {
      this.errors.set(key, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async ensureLoaded(force = false): Promise<void> {
    if (this.loading || (this.loaded && !force)) return
    this.loading = true
    const [model, approaches, docling, pdf] = await Promise.all([
      this.read<SemanticModelStatus>('model', '/api/semantic/model/status'),
      this.read<readonly IngestionApproach[]>('approaches', '/api/artifacts/ingestion/approaches'),
      this.read<DoclingRuntimeStatus>('docling', '/api/artifacts/ingestion/docling/status'),
      this.read<PdfPipelineStatus>('pdf', '/api/artifacts/ingestion/pdf/pipeline'),
    ])
    const [models, index] = model
      ? await Promise.all([
          this.read<readonly SemanticModelDescriptor[]>('models', '/api/semantic/models'),
          this.read<SemanticIndexStatus>('index', `/api/semantic/index/status/${encodeURIComponent(this.graphId)}`),
        ])
      : [null, null]
    if (!model) {
      // Model/catalog/index all resolve through the same constituted embedder
      // selection. One truthful model error is more useful than three identical
      // 500s and prevents Settings refreshes from hammering a known-broken seam.
      this.errors.delete('models')
      this.errors.delete('index')
    }
    this.modelStatus = isRecord(model) ? model : null
    this.models = Array.isArray(models) ? models.filter(isRecord) : []
    this.indexStatus = isRecord(index) ? index : null
    this.approaches = Array.isArray(approaches) ? approaches.filter(isRecord) : []
    this.doclingStatus = isRecord(docling) ? docling : null
    this.pdfStatus = isRecord(pdf) ? pdf : null
    this.loading = false
    this.loaded = true
  }

  handlesSelect(settingId: string): boolean {
    return settingId === 'semanticModel' || settingId === 'semanticBatchSize' || settingId === 'pdfEngine'
  }

  handlesJob(jobId: string): boolean {
    return jobId === 'prepare-semantic-model'
      || jobId === 'refresh-semantic-index'
      || jobId === 'prepare-docling'
      || jobId === 'refresh-local-ai'
  }

  private selectedModel(): SemanticModelDescriptor | null {
    const selectedId = stringValue(this.modelStatus?.modelId)
    return this.models.find(model => model.selected)
      ?? this.models.find(model => stringValue(model.modelId) === selectedId)
      ?? this.models[0]
      ?? null
  }

  private currentBatchSize(): number {
    const model = this.selectedModel()
    return finiteNumber(this.modelStatus?.effectiveBatchSize)
      || finiteNumber(model?.effectiveBatchSize)
      || finiteNumber(this.modelStatus?.defaultBatchSize)
      || finiteNumber(model?.defaultBatchSize)
      || 4
  }

  async select(settingId: string, value: string): Promise<void> {
    this.errors.delete('operation')
    try {
      if (settingId === 'semanticModel') {
        const result = await this.json('/api/semantic/model/config', 'PUT', {
          modelId: value,
          batchSize: this.currentBatchSize(),
        }, 'Save embedding model')
        this.modelStatus = isRecord(result) ? result : this.modelStatus
      } else if (settingId === 'semanticBatchSize') {
        const modelId = stringValue(this.selectedModel()?.modelId ?? this.modelStatus?.modelId)
        if (!modelId) throw new Error('No embedding model is available to configure.')
        const result = await this.json('/api/semantic/model/config', 'PUT', {
          modelId,
          batchSize: Math.max(1, Math.min(64, Number.parseInt(value, 10) || 1)),
        }, 'Save embedding batch size')
        this.modelStatus = isRecord(result) ? result : this.modelStatus
      } else if (settingId === 'pdfEngine') {
        const result = await this.json('/api/artifacts/ingestion/pdf/pipeline', 'PUT', {
          preferredEngineId: value,
        }, 'Save PDF ingestion engine')
        this.pdfStatus = isRecord(result) ? result : this.pdfStatus
      }
    } catch (error) {
      this.errors.set('operation', error instanceof Error ? error.message : String(error))
    }
    await this.ensureLoaded(true)
  }

  private setOperation(operation: LocalAiOperation | null): void {
    this.operation = operation ? Object.freeze({ ...operation }) : null
    this.emit()
  }

  private patchOperation(patch: Partial<LocalAiOperation>): void {
    if (!this.operation) return
    this.setOperation({ ...this.operation, ...patch })
  }

  private async prepareSemanticModel(): Promise<void> {
    this.setOperation({
      id: 'prepare-semantic-model',
      label: 'Prepare embedding model',
      status: 'running',
      detail: 'Preparing the selected model in the local cache…',
      progress: null,
    })
    const result = await this.request('/api/semantic/model/prepare', { method: 'POST' }, 'Prepare embedding model')
    this.modelStatus = isRecord(result) ? result : this.modelStatus
    this.patchOperation({ status: 'succeeded', detail: 'Embedding model prepared and loaded.', progress: 100 })
  }

  private async refreshSemanticIndex(): Promise<void> {
    if (this.operation?.id === 'refresh-semantic-index'
      && (this.operation.status === 'queued' || this.operation.status === 'running')
      && this.operation.backendJobId) {
      await this.request(
        `/api/semantic/index/refresh/jobs/${encodeURIComponent(this.operation.backendJobId)}`,
        { method: 'DELETE' },
        'Cancel semantic index refresh',
      )
      this.patchOperation({ status: 'cancelled', detail: 'Semantic index refresh cancelled.', progress: null })
      return
    }

    this.setOperation({
      id: 'refresh-semantic-index',
      label: 'Refresh graph semantic index',
      status: 'queued',
      detail: `Queuing semantic indexing for ${this.graphId}…`,
      progress: 0,
    })
    const submit = await this.json('/api/semantic/index/refresh/jobs', 'POST', {
      graphId: this.graphId,
      flushBoundary: 'required',
    }, 'Start semantic index refresh')
    if (!isRecord(submit)) throw new Error('Semantic index refresh returned an invalid job envelope.')
    const jobId = stringValue(submit.job_id ?? submit.jobId)
    if (!jobId) throw new Error('Semantic index refresh did not return a job_id.')
    this.patchOperation({ backendJobId: jobId })

    const startedAt = this.now()
    while (true) {
      if (this.now() - startedAt > this.jobTimeoutMs) throw new Error('Semantic index refresh timed out.')
      const payload = await this.request(
        `/api/semantic/index/refresh/jobs/${encodeURIComponent(jobId)}`,
        {},
        'Read semantic index refresh',
      )
      if (!isRecord(payload)) throw new Error('Semantic index job returned an invalid status.')
      const status = stringValue(payload.status).toLowerCase()
      const progress = isRecord(payload.progress) ? payload.progress : {}
      const detail = stringValue(progress.message) || `Semantic index refresh ${status || 'running'}.`
      const percent = clampPercent(progress.percent)
      if (status === 'failed') throw new Error(errorText(payload, 'Semantic index refresh failed.'))
      if (status === 'cancelled') {
        this.patchOperation({ status: 'cancelled', detail, progress: percent })
        return
      }
      if (status === 'succeeded') {
        this.patchOperation({ status: 'succeeded', detail, progress: 100 })
        return
      }
      this.patchOperation({ status: status === 'queued' ? 'queued' : 'running', detail, progress: percent })
      await this.sleep(this.pollIntervalMs)
    }
  }

  private async prepareDocling(): Promise<void> {
    this.setOperation({
      id: 'prepare-docling',
      label: 'Prepare Docling runtime',
      status: 'running',
      detail: 'Preparing the local Docling runtime…',
      progress: null,
    })
    const result = await this.request('/api/artifacts/ingestion/docling/prepare', { method: 'POST' }, 'Prepare Docling runtime')
    this.doclingStatus = isRecord(result) ? result : this.doclingStatus
    this.patchOperation({ status: 'succeeded', detail: 'Docling runtime status refreshed.', progress: 100 })
  }

  async job(jobId: string): Promise<void> {
    this.errors.delete('operation')
    if (jobId === 'refresh-local-ai') {
      await this.ensureLoaded(true)
      return
    }
    try {
      if (jobId === 'prepare-semantic-model') await this.prepareSemanticModel()
      else if (jobId === 'refresh-semantic-index') await this.refreshSemanticIndex()
      else if (jobId === 'prepare-docling') await this.prepareDocling()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.errors.set('operation', message)
      if (this.operation?.id === jobId) this.patchOperation({ status: 'failed', detail: message, progress: null })
    }
    await this.ensureLoaded(true)
  }

  private operationJob(id: string, fallback: MnSettingsJob): MnSettingsJob {
    if (this.operation?.id !== id) return fallback
    return {
      id,
      label: this.operation.label,
      status: this.operation.status,
      detail: this.operation.detail,
      progress: this.operation.progress,
      actionLabel: this.operation.status === 'queued' || this.operation.status === 'running'
        ? (id === 'refresh-semantic-index' ? 'Cancel' : null)
        : fallback.actionLabel,
      disabled: (this.operation.status === 'queued' || this.operation.status === 'running')
        && id !== 'refresh-semantic-index',
    }
  }

  decorateSection(base: MnSettingsSection): MnSettingsSection {
    const model = this.selectedModel()
    const modelState = modelReadiness(this.modelStatus)
    const indexState = indexReadiness(this.indexStatus)
    const effectivePdfId = stringValue(this.pdfStatus?.effectiveEngineId)
    const effectivePdf = this.pdfStatus?.engines?.find(engine => stringValue(engine.engineId) === effectivePdfId)
    const availableApproaches = this.approaches.filter(approach => approach.selectable !== false && approach.status === 'available')
    const metrics: Array<NonNullable<MnSettingsSection['metrics']>[number]> = []
    if (this.modelStatus) {
      metrics.push({
        id: 'semantic-model-status',
        label: 'Embedding model',
        value: stringValue(model?.displayName ?? this.modelStatus.displayName ?? model?.modelId ?? this.modelStatus.modelId) || 'Unknown',
        detail: modelState.label,
        tone: modelState.tone,
      })
    }
    if (this.indexStatus) {
      metrics.push({
        id: 'semantic-index-status',
        label: 'Graph index',
        value: formatCount(this.indexStatus.blockCount, 'block'),
        detail: `${indexState.label} · ${formatCount(this.indexStatus.documentCount, 'document')}${finiteNumber(this.indexStatus.staleDocumentCount) ? ` · ${formatCount(this.indexStatus.staleDocumentCount, 'stale document')}` : ''}`,
        tone: indexState.tone,
      })
    }
    if (this.pdfStatus) {
      metrics.push({
        id: 'pdf-pipeline-status',
        label: 'PDF pipeline',
        value: stringValue(effectivePdf?.label) || effectivePdfId || 'Unknown',
        detail: stringValue(this.pdfStatus.effectiveReason) || stringValue(this.pdfStatus.platform),
        tone: effectivePdf?.available === false ? 'warning' : 'neutral',
      })
    }
    if (this.approaches.length) {
      metrics.push({
        id: 'ingestion-approaches',
        label: 'Local importers',
        value: `${availableApproaches.length} available`,
        detail: availableApproaches.map(approach => stringValue(approach.label)).filter(Boolean).join(', '),
      })
    }

    const selects: Array<NonNullable<MnSettingsSection['selects']>[number]> = []
    if (this.models.length && model) {
      selects.push({
        id: 'semanticModel',
        label: 'Embedding model',
        description: 'Choose the local model used for semantic block search.',
        value: stringValue(model.modelId),
        options: this.models
          .map(candidate => ({
            value: stringValue(candidate.modelId),
            label: `${stringValue(candidate.displayName) || stringValue(candidate.modelId)}${candidate.recommended ? ' · recommended' : ''}`,
          }))
          .filter(option => option.value),
        disabled: this.loading || this.operation?.status === 'running',
      })
      selects.push({
        id: 'semanticBatchSize',
        label: 'Embedding batch size',
        description: 'Lower values use less memory; higher values may index faster.',
        value: String(this.currentBatchSize()),
        options: MODEL_BATCH_SIZES.map(value => ({ value: String(value), label: String(value) })),
        disabled: this.loading || this.operation?.status === 'running',
      })
    }
    const implementedEngineIds = new Set(
      (this.pdfStatus?.engines ?? [])
        .filter(engine => engine.implemented !== false)
        .map(engine => stringValue(engine.engineId)),
    )
    const pdfOptions = (this.pdfStatus?.preferenceOptions ?? [])
      .filter(option => option.engineId === 'auto' || implementedEngineIds.has(stringValue(option.engineId)))
      .map(option => ({ value: stringValue(option.engineId), label: stringValue(option.label) || stringValue(option.engineId) }))
      .filter(option => option.value)
    if (pdfOptions.length) {
      selects.push({
        id: 'pdfEngine',
        label: 'PDF ingestion',
        description: 'Choose the preferred parser. Unavailable runtimes fall back explicitly.',
        value: stringValue(this.pdfStatus?.preferredEngineId) || 'auto',
        options: pdfOptions,
        disabled: this.loading,
      })
    }

    const jobs: MnSettingsJob[] = []
    if (this.modelStatus && this.models.length) {
      jobs.push(this.operationJob('prepare-semantic-model', {
        id: 'prepare-semantic-model',
        label: 'Prepare embedding model',
        status: this.modelStatus.prepared ? 'ready' : 'idle',
        detail: stringValue(this.modelStatus.reason) || `${modelState.label}. Model files stay in the local model cache.`,
        actionLabel: this.modelStatus.prepared ? 'Load again' : 'Prepare',
        disabled: this.modelStatus.runtimeAvailable === false || this.loading,
      }))
    }
    if (this.indexStatus) {
      jobs.push(this.operationJob('refresh-semantic-index', {
        id: 'refresh-semantic-index',
        label: 'Refresh graph semantic index',
        status: this.indexStatus.indexedAt ? (finiteNumber(this.indexStatus.staleDocumentCount) ? 'idle' : 'ready') : 'idle',
        detail: stringValue(this.indexStatus.reason) || `Flush persisted document projections, then index ${this.graphId}.`,
        actionLabel: 'Refresh',
        disabled: this.loading || this.modelStatus?.runtimeAvailable === false,
      }))
    }
    if (this.doclingStatus?.supported !== false) {
      const available = this.doclingStatus?.available === true
      jobs.push(this.operationJob('prepare-docling', {
        id: 'prepare-docling',
        label: 'Prepare Docling runtime',
        status: available ? 'ready' : 'idle',
        detail: stringValue(this.doclingStatus?.reason) || (available ? 'Docling is available.' : 'Prepare the accurate local PDF parser.'),
        actionLabel: available ? 'Probe again' : 'Prepare',
        disabled: this.loading,
      }))
    }
    jobs.push({
      id: 'refresh-local-ai',
      label: 'Refresh runtime status',
      status: this.loading ? 'running' : 'idle',
      detail: this.loading ? 'Reading model, index, and ingestion state…' : 'Read current state from the local cell.',
      actionLabel: 'Refresh',
      disabled: this.loading,
    })

    const notes = [...(base.notes ?? [])]
    for (const key of LOAD_KEYS) {
      const message = this.errors.get(key)
      if (message) notes.push(`${key === 'pdf' ? 'PDF pipeline' : key === 'index' ? 'Semantic index' : key === 'model' || key === 'models' ? 'Embedding runtime' : key === 'approaches' ? 'Importer catalog' : 'Docling runtime'}: ${message}`)
    }
    const operationError = this.errors.get('operation')
    if (operationError) notes.push(`Last operation: ${operationError}`)
    if (this.doclingStatus?.supported === false && stringValue(this.doclingStatus.reason)) {
      notes.push(`Docling is unavailable on this platform: ${stringValue(this.doclingStatus.reason)}`)
    }

    return {
      ...base,
      wide: false,
      metrics,
      selects,
      jobs,
      notes,
    }
  }
}
