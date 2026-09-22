/**
 * Shell-owned Settings operations backed by gardend's authenticated REST API.
 *
 * The controlled settings component never sees fetch, bearer tokens, files, or
 * object URLs. This controller owns those effects and exposes a small immutable
 * snapshot that the settings service projects into rows/jobs.
 */

import type {
  MnSettingsActionDetail,
  MnSettingsJob,
  MnSettingsSection,
} from '@shrubbery/components'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import {
  GardendDocumentTransferService,
  pickDocumentFiles,
  saveBlob,
  type GardendDocumentTransferOptions,
} from './document-transfer.js'

export type SettingsOperationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface SettingsRestorePoint {
  readonly restorePointId: string
  readonly timestamp: string
  readonly label: string
  readonly trigger: string
  readonly documentCount: number
  readonly sizeBytes: number
  readonly isLatest: boolean
}

export interface SettingsOperationProgress {
  readonly id: string
  readonly label: string
  readonly sectionId: string
  readonly status: SettingsOperationStatus
  readonly detail: string
  readonly progress: number | null
}

export interface GardendSettingsOperationsSnapshot {
  readonly current: SettingsOperationProgress | null
  readonly restorePoints: readonly SettingsRestorePoint[]
  readonly historyStatus: 'idle' | 'loading' | 'ready' | 'error'
  readonly historyError: string
}

export interface PickSettingsFilesOptions {
  readonly accept: string
  readonly multiple: boolean
  readonly directory?: boolean
}

export interface GardendSettingsOperationsOptions {
  readonly fetch?: typeof fetch
  readonly transfer?: Pick<GardendDocumentTransferService, 'uploadFiles'>
  readonly transferOptions?: GardendDocumentTransferOptions
  readonly pickFiles?: (options: PickSettingsFilesOptions) => Promise<readonly File[] | null>
  readonly prompt?: (message: string, initialValue?: string) => string | null | Promise<string | null>
  readonly confirm?: (options: {
    readonly title: string
    readonly message: string
    readonly confirmLabel: string
  }) => boolean | Promise<boolean>
  readonly save?: (blob: Blob, filename: string) => void
  readonly pollIntervalMs?: number
  readonly jobTimeoutMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

interface JsonRecord {
  readonly [key: string]: unknown
}

interface JobResult {
  readonly status: JsonRecord
  readonly result: JsonRecord | null
}

const SETTINGS_DOCUMENT_ACCEPT = [
  '.pdf', '.epub', '.docx', '.md', '.markdown', '.txt', '.html', '.htm',
  '.xml', '.log', '.csv', '.json', '.yaml', '.yml', '.ini', '.cfg',
  '.conf', '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.scss', '.less',
  '.sh', '.sql', '.graphql', '.gql', '.toml',
].join(',')

const ARCHIVE_ACTIONS = new Set([
  'import-obsidian',
  'import-notion',
  'import-roam',
])

const GRAPH_ACTIONS = new Set([
  'duplicate-graph',
  'export-graph',
  'import-graph',
])

const HISTORY_ACTIONS = new Set([
  'refresh-history',
  'create-restore-point',
])

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nested(record: JsonRecord, ...keys: string[]): JsonRecord {
  for (const key of keys) {
    const value = record[key]
    if (isRecord(value)) return value
  }
  return {}
}

function firstText(records: readonly JsonRecord[], keys: readonly string[]): string {
  for (const record of records) {
    for (const key of keys) {
      const value = text(record[key])
      if (value) return value
    }
  }
  return ''
}

function errorText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!isRecord(value)) return fallback
  for (const key of ['error', 'message', 'detail']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (isRecord(candidate)) {
      const nestedMessage = errorText(candidate, '')
      if (nestedMessage) return nestedMessage
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

function safeGraphFilename(graphId: string, extension: string): string {
  const base = graphId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'graph'
  return `${base}.${extension}`
}

function graphIdFromFilename(file: File): string {
  const base = file.name.replace(/(?:\.tar\.gz|\.tgz|\.gz)$/i, '')
  return base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-graph'
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function parseRestorePoint(value: unknown): SettingsRestorePoint | null {
  if (!isRecord(value)) return null
  const restorePointId = text(value.restorePointId ?? value.restore_point_id)
  if (!restorePointId) return null
  const createdAt = value.timestamp ?? value.createdAt ?? value.created_at
  const timestamp = typeof createdAt === 'number'
    ? new Date(createdAt).toISOString()
    : text(createdAt)
  return Object.freeze({
    restorePointId,
    timestamp,
    label: text(value.label) || restorePointId,
    trigger: text(value.trigger) || 'manual',
    documentCount: finiteNumber(value.documentCount ?? value.document_count),
    sizeBytes: finiteNumber(value.sizeBytes ?? value.size_bytes),
    isLatest: value.isLatest === true || value.is_latest === true,
  })
}

function operationJob(current: SettingsOperationProgress | null): MnSettingsJob[] {
  if (!current) return []
  return [{
    id: current.id,
    label: current.label,
    status: current.status,
    detail: current.detail,
    progress: current.progress,
    disabled: true,
  }]
}

function actionDescription(actionId: string): string {
  switch (actionId) {
    case 'duplicate-graph': return 'Create an independent copy through gardend’s graph duplication job.'
    case 'export-graph': return 'Export the active graph’s RDF dataset as a downloaded TriG file.'
    case 'import-graph': return 'Import a Garden graph archive (.tar.gz) into a new graph ID.'
    case 'import-files': return 'Choose documents and hand them to the existing authenticated Garden import pipeline.'
    case 'import-obsidian': return 'Import an Obsidian or Logseq vault ZIP; wikilinks become wires.'
    case 'import-notion': return 'Import a Notion Markdown & CSV export ZIP.'
    case 'import-roam': return 'Import a Roam Research JSON export ZIP.'
    case 'refresh-history': return 'Reload graph restore points from gardend.'
    case 'create-restore-point': return 'Capture a new graph-wide restore point before risky work.'
    default: return ''
  }
}

function disabledDescription(actionId: string, runtimeMode: 'local' | 'hosted'): string {
  switch (actionId) {
    case 'rename-graph':
      return 'Unavailable: graph rename is not exposed through the shell’s workspace identity handoff.'
    case 'manage-billing':
      return runtimeMode === 'local'
        ? 'Unavailable in the local Garden runtime.'
        : 'Unavailable: no billing portal handoff is configured for this shell.'
    case 'refresh-usage':
      return 'Unavailable: no authoritative usage summary service is configured.'
    case 'clear-local-cache':
      return 'Unavailable: Garden does not expose a safe graph-independent cache purge route.'
    case 'graph-maintenance':
      return 'Unavailable: gardend has no single graph-maintenance job contract.'
    default:
      return 'Unavailable in this runtime.'
  }
}

export class GardendSettingsOperations {
  private readonly fetchImpl: typeof fetch
  private readonly transfer: Pick<GardendDocumentTransferService, 'uploadFiles'>
  private readonly pickFiles: (options: PickSettingsFilesOptions) => Promise<readonly File[] | null>
  private readonly promptValue: NonNullable<GardendSettingsOperationsOptions['prompt']>
  private readonly confirmValue: NonNullable<GardendSettingsOperationsOptions['confirm']>
  private readonly saveValue: NonNullable<GardendSettingsOperationsOptions['save']>
  private readonly pollIntervalMs: number
  private readonly jobTimeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly subscribers = new Set<() => void>()
  private current: SettingsOperationProgress | null = null
  private restorePoints: readonly SettingsRestorePoint[] = Object.freeze([])
  private historyStatus: GardendSettingsOperationsSnapshot['historyStatus'] = 'idle'
  private historyError = ''
  private historyLoadedAt = 0

  constructor(
    private readonly contract: Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'>,
    readonly graphId: string,
    private readonly documentId: string | null,
    private readonly runtimeMode: 'local' | 'hosted',
    options: GardendSettingsOperationsOptions = {},
  ) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('GardendSettingsOperations: fetch is unavailable')
    this.fetchImpl = fetchImpl.bind(globalThis)
    this.transfer = options.transfer ?? new GardendDocumentTransferService(contract, {
      ...options.transferOptions,
      fetch: options.transferOptions?.fetch ?? fetchImpl,
    })
    this.pickFiles = options.pickFiles ?? (input => pickDocumentFiles({
      accept: input.accept,
      multiple: input.multiple,
      directory: input.directory,
    }))
    this.promptValue = options.prompt ?? ((message, initialValue = '') => contract.ui.prompt
      ? contract.ui.prompt({ title: message, value: initialValue })
      : (globalThis.prompt?.(message, initialValue) ?? null))
    this.confirmValue = options.confirm ?? (input => contract.ui.confirm({
      title: input.title,
      message: input.message,
      confirmLabel: input.confirmLabel,
      cancelLabel: 'Cancel',
    }))
    this.saveValue = options.save ?? ((blob, filename) => saveBlob(blob, filename))
    this.pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 500)
    this.jobTimeoutMs = Math.max(1, options.jobTimeoutMs ?? 15 * 60_000)
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.now = options.now ?? Date.now
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  snapshot(): GardendSettingsOperationsSnapshot {
    return Object.freeze({
      current: this.current ? Object.freeze({ ...this.current }) : null,
      restorePoints: this.restorePoints,
      historyStatus: this.historyStatus,
      historyError: this.historyError,
    })
  }

  supports(actionId: string): boolean {
    return actionId === 'import-files'
      || ARCHIVE_ACTIONS.has(actionId)
      || GRAPH_ACTIONS.has(actionId)
      || HISTORY_ACTIONS.has(actionId)
      || actionId.startsWith('restore-point:')
  }

  private emit(): void {
    for (const callback of this.subscribers) callback()
  }

  private setCurrent(next: SettingsOperationProgress | null): void {
    this.current = next ? Object.freeze({ ...next }) : null
    this.emit()
  }

  private start(id: string, label: string, sectionId: string, detail: string): void {
    this.setCurrent({ id, label, sectionId, status: 'running', detail, progress: 0 })
  }

  private update(detail: string, progress: number | null = null, status: SettingsOperationStatus = 'running'): void {
    if (!this.current) return
    this.setCurrent({ ...this.current, detail, progress, status })
  }

  private succeed(detail: string): void {
    this.update(detail, 100, 'succeeded')
  }

  private fail(error: unknown): void {
    this.update(error instanceof Error ? error.message : String(error), null, 'failed')
  }

  private cancel(detail = 'Cancelled by the user.'): void {
    this.update(detail, null, 'cancelled')
  }

  private apiBase(): string {
    const base = this.contract.runtime.graphBaseUrl(this.graphId).replace(/\/+$/, '')
    if (!base) throw new Error(`No API base is available for graph ${this.graphId}`)
    return base
  }

  private headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers(extra)
    const token = this.contract.auth.token()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const userId = this.contract.auth.userId()
    if (userId) headers.set('X-User-ID', userId)
    return headers
  }

  private async request(path: string, init: RequestInit = {}, label = 'Settings operation'): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase()}${path}`, {
      ...init,
      headers: this.headers(Object.fromEntries(new Headers(init.headers).entries())),
    })
    const payload = await responseValue(response)
    if (!response.ok) {
      throw new Error(errorText(payload, `${label} failed: HTTP ${response.status}`))
    }
    return payload
  }

  private async json(path: string, method: 'POST' | 'PUT', body: unknown, label: string): Promise<unknown> {
    return this.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, label)
  }

  private async submitMultipart(path: string, file: File, fields: Readonly<Record<string, string>>, label: string): Promise<JsonRecord> {
    const form = new FormData()
    form.append('file', file)
    for (const [name, value] of Object.entries(fields)) {
      if (value.trim()) form.append(name, value.trim())
    }
    return asRecord(await this.request(path, { method: 'POST', body: form }, label))
  }

  private async waitForJob(submit: JsonRecord, label: string): Promise<JobResult> {
    const jobId = text(submit.job_id ?? submit.jobId)
    if (!jobId) throw new Error(`${label} did not return a job_id`)
    const startedAt = this.now()
    let status = submit
    while (true) {
      if (this.now() - startedAt > this.jobTimeoutMs) throw new Error(`${label} timed out`)
      status = asRecord(await this.request(`/graphs/jobs/${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
      }, `Read ${label} status`))
      const phase = text(status.status).toLowerCase()
      const progress = nested(status, 'progress')
      const percent = typeof progress.percent === 'number' ? progress.percent : null
      const message = text(progress.message) || `${label}: ${phase || 'running'}`
      this.update(message, percent, phase === 'queued' ? 'queued' : 'running')
      if (phase === 'failed' || phase === 'cancelled') {
        throw new Error(errorText(status.error ?? status.detail, `${label} ${phase}`))
      }
      if (phase === 'succeeded') {
        const resultPayload = await this.request(`/graphs/jobs/${encodeURIComponent(jobId)}/result`, {
          cache: 'no-store',
        }, `Read ${label} result`)
        return { status, result: isRecord(resultPayload) ? resultPayload : null }
      }
      await this.sleep(this.pollIntervalMs)
    }
  }

  private async chooseOne(accept: string): Promise<File | null> {
    const files = await this.pickFiles({ accept, multiple: false })
    return files?.[0] ?? null
  }

  private async importFiles(): Promise<void> {
    this.start('import-files', 'Import files', 'imports', 'Waiting for files…')
    const files = await this.pickFiles({ accept: SETTINGS_DOCUMENT_ACCEPT, multiple: true })
    if (!files?.length) {
      this.cancel()
      return
    }
    this.update(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`, 0)
    const result = await this.transfer.uploadFiles(this.graphId, files, {
      onFileStart: (file, index, total) => {
        this.update(`Importing ${file.name} (${index + 1}/${total})`, total ? (index / total) * 100 : 0)
      },
      onProgress: (file, progress) => {
        this.update(progress.message || `Importing ${file.name}`, progress.percent ?? null, progress.status)
      },
    })
    if (result.cancelled) {
      this.cancel(`Cancelled after importing ${result.succeeded.length} file${result.succeeded.length === 1 ? '' : 's'}.`)
      return
    }
    if (result.failed.length) {
      throw new Error(
        `Imported ${result.succeeded.length}; ${result.failed.length} failed: ${result.failed.map(item => `${item.file.name}: ${item.error.message}`).join('; ')}`,
      )
    }
    this.succeed(`Imported ${result.succeeded.length} file${result.succeeded.length === 1 ? '' : 's'}${result.skipped.length ? `; skipped ${result.skipped.length}` : ''}.`)
  }

  private async importArchive(kind: 'obsidian' | 'notion' | 'roam'): Promise<void> {
    const label = kind === 'obsidian' ? 'Import Obsidian vault' : kind === 'notion' ? 'Import Notion archive' : 'Import Roam archive'
    this.start(`import-${kind}`, label, 'imports', 'Waiting for a ZIP archive…')
    const file = await this.chooseOne('.zip,application/zip')
    if (!file) {
      this.cancel()
      return
    }
    this.update(`Uploading ${file.name}…`, 5)
    const submit = await this.submitMultipart(
      `/graphs/${encodeURIComponent(this.graphId)}/imports/${kind}`,
      file,
      {},
      label,
    )
    const terminal = await this.waitForJob(submit, label)
    const result = terminal.result ?? nested(terminal.status, 'detail', 'result_inline', 'resultInline')
    const documents = finiteNumber(result.documentsCreated ?? result.documents_created)
    const wires = finiteNumber(result.wiresCreated ?? result.wires_created)
    this.succeed(`${label} complete: ${documents} document${documents === 1 ? '' : 's'}, ${wires} wire${wires === 1 ? '' : 's'}.`)
  }

  private async duplicateGraph(): Promise<void> {
    this.start('duplicate-graph', 'Duplicate graph', 'graph-ops', 'Waiting for a new graph ID…')
    const suggested = `${this.graphId}-copy`
    const newGraphId = text(await this.promptValue('New graph ID', suggested))
    if (!newGraphId) {
      this.cancel()
      return
    }
    const newTitle = text(await this.promptValue('New graph title (optional)', ''))
    this.update(`Duplicating ${this.graphId} as ${newGraphId}…`, 5)
    const submit = asRecord(await this.json(
      `/graphs/${encodeURIComponent(this.graphId)}/duplicate`,
      'POST',
      { new_graph_id: newGraphId, ...(newTitle ? { new_title: newTitle } : {}) },
      'Duplicate graph',
    ))
    const terminal = await this.waitForJob(submit, 'Duplicate graph')
    const result = terminal.result ?? nested(terminal.status, 'detail', 'result_inline', 'resultInline')
    const resultId = text(result.newGraphId ?? result.new_graph_id) || newGraphId
    this.succeed(`Duplicate complete: ${resultId}.`)
  }

  private async exportGraph(): Promise<void> {
    this.start('export-graph', 'Export graph', 'graph-ops', `Exporting ${this.graphId} as TriG…`)
    const submit = asRecord(await this.json(
      `/graphs/${encodeURIComponent(this.graphId)}/export`,
      'POST',
      { include_artifacts: false },
      'Export graph',
    ))
    const terminal = await this.waitForJob(submit, 'Export graph')
    const result = terminal.result ?? nested(terminal.status, 'detail', 'result_inline', 'resultInline')
    const data = typeof result.data === 'string' ? result.data : ''
    if (!data) throw new Error('Export graph completed without RDF data')
    const mediaType = text(result.mediaType ?? result.media_type) || 'application/trig'
    const filename = safeGraphFilename(this.graphId, 'trig')
    this.saveValue(new Blob([data], { type: mediaType }), filename)
    const quads = finiteNumber(result.quadCount ?? result.quad_count)
    this.succeed(`Exported ${quads} quad${quads === 1 ? '' : 's'} to ${filename}.`)
  }

  private async importGraph(): Promise<void> {
    this.start('import-graph', 'Import graph archive', 'graph-ops', 'Waiting for a Garden graph archive…')
    const file = await this.chooseOne('.tar.gz,.tgz,application/gzip')
    if (!file) {
      this.cancel()
      return
    }
    const newGraphId = text(await this.promptValue('Imported graph ID', graphIdFromFilename(file)))
    if (!newGraphId) {
      this.cancel()
      return
    }
    const newTitle = text(await this.promptValue('Imported graph title (optional)', ''))
    this.update(`Uploading ${file.name} as ${newGraphId}…`, 5)
    const submit = await this.submitMultipart('/graphs/import', file, {
      new_graph_id: newGraphId,
      ...(newTitle ? { new_title: newTitle } : {}),
    }, 'Import graph archive')
    const terminal = await this.waitForJob(submit, 'Import graph archive')
    const result = terminal.result ?? nested(terminal.status, 'detail', 'result_inline', 'resultInline')
    const resultId = text(result.graphId ?? result.graph_id ?? result.newGraphId ?? result.new_graph_id) || newGraphId
    this.succeed(`Graph archive imported as ${resultId}.`)
  }

  async refreshHistory(emit = true): Promise<void> {
    this.historyStatus = 'loading'
    this.historyError = ''
    if (emit) this.emit()
    try {
      const payload = asRecord(await this.request(
        `/v1/time-travel/${encodeURIComponent(this.graphId)}/restore-points?limit=50`,
        { cache: 'no-store' },
        'Load graph history',
      ))
      const values = Array.isArray(payload.restorePoints)
        ? payload.restorePoints
        : Array.isArray(payload.restore_points) ? payload.restore_points : []
      this.restorePoints = Object.freeze(values.map(parseRestorePoint).filter((item): item is SettingsRestorePoint => Boolean(item)))
      this.historyStatus = 'ready'
      this.historyLoadedAt = this.now()
    } catch (error) {
      this.historyStatus = 'error'
      this.historyError = error instanceof Error ? error.message : String(error)
    }
    if (emit) this.emit()
  }

  async ensureHistoryLoaded(): Promise<void> {
    if (this.historyStatus === 'loading') return
    if (this.historyStatus === 'ready' && this.now() - this.historyLoadedAt < 10_000) return
    await this.refreshHistory(false)
  }

  private async createRestorePoint(): Promise<void> {
    this.start('create-restore-point', 'Create restore point', 'history', 'Waiting for an optional label…')
    const label = await this.promptValue('Restore point label (optional)', '')
    if (label === null) {
      this.cancel()
      return
    }
    this.update('Capturing graph-wide restore point…', 10)
    const result = asRecord(await this.json(
      `/v1/time-travel/${encodeURIComponent(this.graphId)}/restore-points`,
      'POST',
      { trigger: 'manual', ...(text(label) ? { label: text(label) } : {}) },
      'Create restore point',
    ))
    const point = parseRestorePoint(result)
    await this.refreshHistory(false)
    const createdLabel = point?.label ?? (text(result.restorePointId ?? result.restore_point_id) || 'successfully')
    this.succeed(`Created restore point ${createdLabel}.`)
  }

  private async restorePoint(restorePointId: string): Promise<void> {
    const point = this.restorePoints.find(item => item.restorePointId === restorePointId)
    this.start(`restore-point:${restorePointId}`, 'Restore graph', 'history', 'Waiting for confirmation…')
    const confirmed = await this.confirmValue({
      title: 'Restore graph',
      message: `Restore ${this.graphId} to ${point?.label ?? restorePointId} (${formatTimestamp(point?.timestamp ?? '')})? Gardend will capture a pre-restore backup first.`,
      confirmLabel: 'Restore graph',
    })
    if (!confirmed) {
      this.cancel()
      return
    }
    this.update(`Starting restore to ${point?.label ?? restorePointId}…`, 5)
    const started = asRecord(await this.json(
      `/v1/time-travel/${encodeURIComponent(this.graphId)}/restores`,
      'POST',
      { restorePointId, dryRun: false },
      'Restore graph',
    ))
    const operationId = text(started.operationId ?? started.operation_id)
    if (!operationId) throw new Error('Restore graph did not return an operationId')
    const startedAt = this.now()
    while (true) {
      if (this.now() - startedAt > this.jobTimeoutMs) throw new Error('Restore graph timed out')
      const status = asRecord(await this.request(
        `/v1/time-travel/${encodeURIComponent(this.graphId)}/restores/${encodeURIComponent(operationId)}`,
        { cache: 'no-store' },
        'Read restore status',
      ))
      const state = text(status.state).toLowerCase()
      const progress = typeof status.percent === 'number' ? status.percent : null
      this.update(text(status.message) || `Restore: ${state}`, progress)
      if (state === 'failed' || state === 'rolled_back') {
        throw new Error(errorText(status.error ?? status.detail, `Restore ${state}`))
      }
      if (state === 'succeeded') break
      await this.sleep(this.pollIntervalMs)
    }
    await this.refreshHistory(false)
    const restoredLabel = point?.label && point.label !== restorePointId
      ? `${point.label} (${restorePointId})`
      : restorePointId
    this.succeed(`Restored ${this.graphId} to ${restoredLabel}.`)
  }

  async action(detail: MnSettingsActionDetail): Promise<void> {
    try {
      if (detail.actionId === 'import-files') await this.importFiles()
      else if (detail.actionId === 'import-obsidian') await this.importArchive('obsidian')
      else if (detail.actionId === 'import-notion') await this.importArchive('notion')
      else if (detail.actionId === 'import-roam') await this.importArchive('roam')
      else if (detail.actionId === 'duplicate-graph') await this.duplicateGraph()
      else if (detail.actionId === 'export-graph') await this.exportGraph()
      else if (detail.actionId === 'import-graph') await this.importGraph()
      else if (detail.actionId === 'refresh-history') {
        this.start('refresh-history', 'Refresh graph history', 'history', 'Loading restore points…')
        await this.refreshHistory(false)
        if (this.historyStatus === 'error') throw new Error(this.historyError)
        this.succeed(`Loaded ${this.restorePoints.length} restore point${this.restorePoints.length === 1 ? '' : 's'}.`)
      } else if (detail.actionId === 'create-restore-point') await this.createRestorePoint()
      else if (detail.actionId.startsWith('restore-point:')) {
        await this.restorePoint(detail.actionId.slice('restore-point:'.length))
      } else {
        throw new Error(`Unsupported gardend Settings action: ${detail.actionId}`)
      }
    } catch (error) {
      this.fail(error)
    }
  }

  decorateSections(sections: readonly MnSettingsSection[]): readonly MnSettingsSection[] {
    const state = this.snapshot()
    return sections.map(section => {
      if (section.id === 'graph-ops') {
        const actions = (section.actions ?? []).map(action => ({
          ...action,
          disabled: GRAPH_ACTIONS.has(action.id) ? false : action.disabled,
          description: GRAPH_ACTIONS.has(action.id)
            ? actionDescription(action.id)
            : action.description,
        }))
        return {
          ...section,
          actions,
          jobs: state.current?.sectionId === section.id
            ? operationJob(state.current)
            : [],
        }
      }
      if (section.id === 'imports') {
        return {
          ...section,
          actions: (section.actions ?? []).map(action => ({
            ...action,
            disabled: action.id === 'import-files' || ARCHIVE_ACTIONS.has(action.id) ? false : action.disabled,
            description: actionDescription(action.id) || action.description,
          })),
          jobs: state.current?.sectionId === section.id ? operationJob(state.current) : [],
          notes: [
            'Archive imports run as real gardend jobs. Success is shown only after the terminal job result is readable.',
            ...(section.notes ?? []),
          ],
        }
      }
      if (section.id === 'history') {
        const points = state.restorePoints.slice(0, 10)
        const restoreActions = points.map(point => ({
          id: `restore-point:${point.restorePointId}`,
          label: `Restore “${point.label}”`,
          description: `${formatTimestamp(point.timestamp)} · ${point.documentCount} document${point.documentCount === 1 ? '' : 's'} · ${point.trigger}`,
          variant: 'danger' as const,
        }))
        const latest = state.restorePoints.find(point => point.isLatest) ?? state.restorePoints[0]
        return {
          ...section,
          metrics: [
            { id: 'restore-count', label: 'Restore points', value: String(state.restorePoints.length), tone: state.historyStatus === 'error' ? 'danger' : 'neutral' },
            { id: 'latest-restore', label: 'Latest', value: latest ? formatTimestamp(latest.timestamp) : 'None' },
          ],
          actions: [
            ...(section.actions ?? []).map(action => action.id === 'open-history'
              ? {
                  ...action,
                  disabled: !this.documentId,
                  description: this.documentId
                    ? 'Open snapshot history for the active document.'
                    : 'Unavailable: open a document before requesting document history.',
                }
              : action),
            { id: 'refresh-history', label: 'Refresh graph history', description: actionDescription('refresh-history') },
            { id: 'create-restore-point', label: 'Create restore point', description: actionDescription('create-restore-point') },
            ...restoreActions,
          ],
          jobs: state.current?.sectionId === section.id ? operationJob(state.current) : [],
          notes: [
            ...(state.historyStatus === 'error' ? [`History read failed: ${state.historyError}`] : []),
            ...(state.restorePoints.length > points.length ? [`Showing the newest ${points.length} of ${state.restorePoints.length} restore points.`] : []),
            'A graph restore is destructive, requires confirmation, and gardend captures a pre-restore backup before applying it.',
          ],
        }
      }
      if (section.id === 'billing') {
        return {
          ...section,
          actions: (section.actions ?? []).map(action => ({
            ...action,
            disabled: true,
            description: disabledDescription(action.id, this.runtimeMode),
          })),
        }
      }
      if (section.id === 'usage' || section.id === 'privacy') {
        return {
          ...section,
          actions: (section.actions ?? []).map(action => action.disabled
            ? { ...action, description: disabledDescription(action.id, this.runtimeMode) }
            : action),
        }
      }
      return section
    })
  }
}
