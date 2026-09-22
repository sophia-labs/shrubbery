import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import { html } from 'lit'
import {
  applyEditorMaterial,
  applySkin,
  applyTheme,
  isVisualIdentitySkin,
} from '@shrubbery/tokens'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { mountOrganismAppRoute } from '../cell/app-routes.js'
import {
  createDefaultSettingsService,
  readAppearancePreferences,
  resolveThemePreference,
  type OrganismSettingsService,
} from '../cell/settings-service.js'
import { GardendSettingsOperations } from '../cell/settings-operations.js'
import { GardendLocalAiSettings } from '../cell/local-ai-settings.js'
import type { AiProvider, ProviderSecretStore } from '../cell/provider-secret-store.js'

const GRAPH_ID = 'settings-browser'
const root = document.querySelector<HTMLElement>('#settings-harness-root')!
const failure = document.querySelector<HTMLElement>('#settings-harness-failure')!

let ready = false
let error: string | null = null
let settingsLoads = 0
let historyReads = 0
let authenticatedRequests = 0
let obsidianPolls = 0
let notionPolls = 0
let savedExports = 0
let duplicateJobs = 0
let graphImportJobs = 0
let restoreStarts = 0
let createdRestorePoints = 0
let closeCalls = 0
let providerSecretWrites = 0
let providerSecretDeletes = 0
let semanticConfigWrites = 0
let pdfPipelineWrites = 0
let semanticIndexStarts = 0
let semanticIndexPolls = 0
let openRouterConfigured = false
const requestedPaths: string[] = []
const backendContractViolations: string[] = []
let restorePoints = [{
  restorePointId: 'rp-browser',
  timestamp: '2026-07-10T12:00:00.000Z',
  label: 'Browser checkpoint',
  trigger: 'manual',
  documentCount: 2,
  sizeBytes: 1024,
  isLatest: true,
}]
const jobResults = new Map<string, Record<string, unknown>>()

interface SettingsHarnessState {
  readonly ready: boolean
  readonly error: string | null
  readonly settingsLoads: number
  readonly historyReads: number
  readonly authenticatedRequests: number
  readonly savedExports: number
  readonly duplicateJobs: number
  readonly graphImportJobs: number
  readonly restoreStarts: number
  readonly createdRestorePoints: number
  readonly closeCalls: number
  readonly providerSecretWrites: number
  readonly providerSecretDeletes: number
  readonly semanticConfigWrites: number
  readonly pdfPipelineWrites: number
  readonly semanticIndexStarts: number
  readonly requestedPaths: readonly string[]
  readonly backendContractViolations: readonly string[]
}

declare global {
  interface Window {
    readonly __settingsHarness?: { readonly state: SettingsHarnessState }
  }
}

function state(): SettingsHarnessState {
  return Object.freeze({
    ready,
    error,
    settingsLoads,
    historyReads,
    authenticatedRequests,
    savedExports,
    duplicateJobs,
    graphImportJobs,
    restoreStarts,
    createdRestorePoints,
    closeCalls,
    providerSecretWrites,
    providerSecretDeletes,
    semanticConfigWrites,
    pdfPipelineWrites,
    semanticIndexStarts,
    requestedPaths: Object.freeze([...requestedPaths]),
    backendContractViolations: Object.freeze([...backendContractViolations]),
  })
}

const bridge = {} as { readonly state: SettingsHarnessState }
Object.defineProperty(bridge, 'state', { enumerable: true, get: state })
Object.freeze(bridge)
Object.defineProperty(window, '__settingsHarness', { value: bridge })

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const backendFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.href)
  const headers = new Headers(init.headers)
  if (headers.get('authorization') !== 'Bearer settings-browser-token'
    || headers.get('x-user-id') !== 'settings-browser-user') {
    backendContractViolations.push(`Unauthenticated request: ${String(input)}`)
    return json({ error: 'Settings harness requires authenticated requests' }, 401)
  }
  authenticatedRequests += 1
  const method = init.method ?? 'GET'
  requestedPaths.push(`${method} ${url.pathname}`)

  if (method === 'GET' && url.pathname.endsWith('/api/semantic/model/status')) {
    return json({
      modelId: 'fastembed/bge-small-en-v1.5',
      displayName: 'BGE Small',
      providerId: 'fastembed',
      prepared: true,
      loaded: true,
      runtimeAvailable: true,
      effectiveBatchSize: 4,
    })
  }
  if (method === 'GET' && url.pathname.endsWith('/api/semantic/models')) {
    return json([
      { modelId: 'fastembed/bge-small-en-v1.5', displayName: 'BGE Small', selected: true, recommended: true, effectiveBatchSize: 4 },
      { modelId: 'candle/nomic-embed-text-v2-moe', displayName: 'Nomic V2 MoE', selected: false, effectiveBatchSize: 2 },
    ])
  }
  if (method === 'PUT' && url.pathname.endsWith('/api/semantic/model/config')) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.modelId !== 'candle/nomic-embed-text-v2-moe' || body.batchSize !== 4) {
      backendContractViolations.push(`Unexpected semantic config: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected semantic config' }, 400)
    }
    semanticConfigWrites += 1
    return json({
      modelId: body.modelId,
      displayName: 'Nomic V2 MoE',
      providerId: 'candle',
      prepared: false,
      loaded: false,
      runtimeAvailable: true,
      effectiveBatchSize: body.batchSize,
    })
  }
  if (method === 'GET' && url.pathname.endsWith(`/api/semantic/index/status/${GRAPH_ID}`)) {
    return json({
      documentCount: 2,
      blockCount: 9,
      staleDocumentCount: semanticIndexStarts ? 0 : 1,
      indexedAt: '2026-07-10T12:00:00.000Z',
      compatible: true,
    })
  }
  if (method === 'POST' && url.pathname.endsWith('/api/semantic/index/refresh/jobs')) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.graphId !== GRAPH_ID || body.flushBoundary !== 'required') {
      backendContractViolations.push(`Unexpected semantic index body: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected semantic index body' }, 400)
    }
    semanticIndexStarts += 1
    semanticIndexPolls = 0
    return json({ job_id: 'semantic-browser-job', status: 'queued' }, 202)
  }
  if (method === 'GET' && url.pathname.endsWith('/api/semantic/index/refresh/jobs/semantic-browser-job')) {
    semanticIndexPolls += 1
    return semanticIndexPolls === 1
      ? json({ job_id: 'semantic-browser-job', status: 'running', progress: { percent: 55, message: 'Embedding browser blocks' } })
      : json({ job_id: 'semantic-browser-job', status: 'succeeded', progress: { percent: 100, message: 'Browser index ready' } })
  }
  if (method === 'GET' && url.pathname.endsWith('/api/artifacts/ingestion/approaches')) {
    return json([
      { approachId: 'markdown.direct', label: 'Markdown Direct', family: 'markdown', status: 'available', selectable: true },
      { approachId: 'pdf.fast-text', label: 'PDF Fast Text', family: 'pdf', status: 'available', selectable: true },
    ])
  }
  if (method === 'GET' && url.pathname.endsWith('/api/artifacts/ingestion/docling/status')) {
    return json({ supported: false, available: false, status: 'unsupported', reason: 'Browser fixture platform has no Docling runtime' })
  }
  if (method === 'GET' && url.pathname.endsWith('/api/artifacts/ingestion/pdf/pipeline')) {
    return json({
      preferredEngineId: pdfPipelineWrites ? 'pdf.fast-text' : 'auto',
      effectiveEngineId: 'pdf.fast-text',
      effectiveReason: 'Browser fixture uses the available local baseline.',
      platform: 'browser-fixture',
      engines: [
        { engineId: 'pdf.fast-text', label: 'PDF Fast Text', implemented: true, available: true },
        { engineId: 'pdf.docling-accurate', label: 'Docling', implemented: true, available: false },
        { engineId: 'pdf.ocrmypdf-tesseract', label: 'OCRmyPDF', implemented: false, available: false },
      ],
      preferenceOptions: [
        { engineId: 'auto', label: 'Auto' },
        { engineId: 'pdf.fast-text', label: 'Fast Text' },
        { engineId: 'pdf.docling-accurate', label: 'Docling' },
        { engineId: 'pdf.ocrmypdf-tesseract', label: 'OCRmyPDF' },
      ],
    })
  }
  if (method === 'PUT' && url.pathname.endsWith('/api/artifacts/ingestion/pdf/pipeline')) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.preferredEngineId !== 'pdf.fast-text') {
      backendContractViolations.push(`Unexpected PDF pipeline config: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected PDF pipeline config' }, 400)
    }
    pdfPipelineWrites += 1
    return json({
      preferredEngineId: body.preferredEngineId,
      effectiveEngineId: body.preferredEngineId,
      effectiveReason: 'Browser PDF preference saved.',
      engines: [],
      preferenceOptions: [],
    })
  }

  if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/imports/obsidian`)) {
    return json({ job_id: 'job-obsidian', status: 'queued' }, 202)
  }
  if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/imports/notion`)) {
    return json({ job_id: 'job-notion', status: 'queued' }, 202)
  }
  if (url.pathname.endsWith('/graphs/jobs/job-obsidian')) {
    obsidianPolls += 1
    if (obsidianPolls === 1) {
      return json({
        job_id: 'job-obsidian',
        status: 'running',
        progress: { percent: 45, message: 'Parsing browser-vault.zip' },
      })
    }
    return json({
      job_id: 'job-obsidian',
      status: 'succeeded',
      progress: { percent: 100, message: 'Materialized imported documents' },
    })
  }
  if (url.pathname.endsWith('/graphs/jobs/job-obsidian/result')) {
    return json({ documentsCreated: 2, foldersCreated: 1, wiresCreated: 1, warnings: [] })
  }
  if (url.pathname.endsWith('/graphs/jobs/job-notion')) {
    notionPolls += 1
    return json({
      job_id: 'job-notion',
      status: 'failed',
      progress: { percent: 20, message: 'Reading archive' },
      error: 'Parser rejected corrupt-notion.zip',
    })
  }

  const resultMatch = /\/graphs\/jobs\/([^/]+)\/result$/.exec(url.pathname)
  if (method === 'GET' && resultMatch) return json(jobResults.get(resultMatch[1]!) ?? {})
  const statusMatch = /\/graphs\/jobs\/([^/]+)$/.exec(url.pathname)
  if (method === 'GET' && statusMatch && jobResults.has(statusMatch[1]!)) {
    return json({
      job_id: statusMatch[1],
      status: 'succeeded',
      progress: { percent: 100, message: 'Backend work completed' },
    })
  }

  if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/duplicate`)) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.new_graph_id !== 'settings-browser-copy' || body.new_title !== 'Settings browser copy') {
      backendContractViolations.push(`Unexpected duplicate body: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected duplicate body' }, 400)
    }
    duplicateJobs += 1
    jobResults.set('job-duplicate', { new_graph_id: 'settings-browser-copy' })
    return json({ job_id: 'job-duplicate', status: 'queued' }, 202)
  }
  if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/export`)) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.include_artifacts !== false || Object.keys(body).length !== 1) {
      backendContractViolations.push(`Unexpected export body: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected export body' }, 400)
    }
    jobResults.set('job-export', {
      format: 'trig',
      mediaType: 'application/trig',
      data: '<s> <p> <o> .\n',
      quadCount: 1,
    })
    return json({ job_id: 'job-export', status: 'queued' }, 202)
  }
  if (method === 'POST' && url.pathname.endsWith('/graphs/import')) {
    const form = init.body as FormData
    const archive = form.get('file')
    if (!(archive instanceof File)
      || archive.name !== 'garden-backup.tar.gz'
      || form.get('new_graph_id') !== 'settings-browser-imported'
      || form.get('new_title') !== 'Settings browser import') {
      backendContractViolations.push('Unexpected graph import multipart body')
      return json({ error: 'Unexpected graph import multipart body' }, 400)
    }
    graphImportJobs += 1
    jobResults.set('job-graph-import', { graph_id: 'settings-browser-imported' })
    return json({ job_id: 'job-graph-import', status: 'queued' }, 202)
  }

  if (method === 'GET' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restore-points`)) {
    historyReads += 1
    return json({
      restorePoints,
      nextCursor: null,
      totalCount: restorePoints.length,
    })
  }
  if (method === 'POST' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restore-points`)) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.trigger !== 'manual' || body.label !== 'Before browser mutation') {
      backendContractViolations.push(`Unexpected restore-point body: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected restore-point body' }, 400)
    }
    createdRestorePoints += 1
    const created = {
      restorePointId: 'rp-created',
      timestamp: '2026-07-10T13:00:00.000Z',
      label: 'Before browser mutation',
      trigger: 'manual',
      documentCount: 2,
      sizeBytes: 1536,
      isLatest: true,
    }
    restorePoints = [created, ...restorePoints.map(point => ({ ...point, isLatest: false }))]
    return json(created, 201)
  }
  if (method === 'POST' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restores`)) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    if (body.restorePointId !== 'rp-browser' || body.dryRun !== false) {
      backendContractViolations.push(`Unexpected restore body: ${JSON.stringify(body)}`)
      return json({ error: 'Unexpected restore body' }, 400)
    }
    restoreStarts += 1
    return json({ operationId: 'restore-browser', state: 'pending' }, 202)
  }
  if (method === 'GET' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restores/restore-browser`)) {
    return json({ operationId: 'restore-browser', state: 'succeeded', percent: 100, message: 'Restore verified' })
  }
  backendContractViolations.push(`Unhandled settings harness route: ${method} ${url.pathname}`)
  return json({ error: `Unhandled settings harness route: ${url.pathname}` }, 404)
}

const contract: Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'> = {
  auth: {
    token: () => 'settings-browser-token',
    userId: () => 'settings-browser-user',
    isAuthenticated: () => true,
    whenReady: () => Promise.resolve(),
    onChange: () => () => undefined,
  },
  runtime: {
    mode: () => 'local',
    isGateway: () => false,
    graphBaseUrl: () => `/settings-harness/cell/g/${GRAPH_ID}`,
  },
  ui: {
    confirm: async () => true,
    icon: name => html`<span>${name}</span>`,
    presenceColors: ['#2563eb'],
  },
}

const operations = new GardendSettingsOperations(contract, GRAPH_ID, 'doc-browser', 'local', {
  fetch: backendFetch,
  pollIntervalMs: 250,
  jobTimeoutMs: 10_000,
  prompt: message => {
    if (message === 'New graph ID') return 'settings-browser-copy'
    if (message === 'New graph title (optional)') return 'Settings browser copy'
    if (message === 'Imported graph ID') return 'settings-browser-imported'
    if (message === 'Imported graph title (optional)') return 'Settings browser import'
    if (message === 'Restore point label (optional)') return 'Before browser mutation'
    return null
  },
  save: () => { savedExports += 1 },
})
const localAi = new GardendLocalAiSettings(contract, GRAPH_ID, {
  fetch: backendFetch,
  pollIntervalMs: 25,
  jobTimeoutMs: 5_000,
})
const providerSecrets: ProviderSecretStore = {
  providers: ['openrouter'],
  storageLabel: 'browser fixture keychain',
  async status() {
    return { openrouter: openRouterConfigured }
  },
  async store(provider: AiProvider, secret: string) {
    if (provider !== 'openrouter') throw new Error('Browser fixture only accepts OpenRouter')
    if (secret !== 'browser-secret-never-projected') throw new Error('Browser fixture received the wrong transient secret')
    providerSecretWrites += 1
    openRouterConfigured = true
  },
  async delete(provider: AiProvider) {
    if (provider !== 'openrouter') throw new Error('Browser fixture only accepts OpenRouter')
    providerSecretDeletes += 1
    openRouterConfigured = false
  },
}

const storedAppearance = readAppearancePreferences(window.localStorage)
for (const target of [document.documentElement, document.body]) {
  applySkin({ skin: storedAppearance.skin, target })
  applyTheme({ theme: resolveThemePreference(storedAppearance.theme), target })
}

const concrete = createDefaultSettingsService({
  runtimeMode: 'local',
  userName: 'Browser user',
  userEmail: 'browser@example.test',
  apiBaseUrl: `/settings-harness/cell/g/${GRAPH_ID}`,
  mcpUrl: `/settings-harness/cell/g/${GRAPH_ID}/mcp`,
  operations,
  localAi,
  providerSecrets,
  storage: window.localStorage,
  promptSecret: () => 'browser-secret-never-projected',
  onPreferenceChange: detail => {
    if ('value' in detail && detail.settingId === 'skin') {
      const skin = isVisualIdentitySkin(detail.value) ? detail.value : 'garden'
      applySkin({ skin })
      applySkin({ skin, target: document.body })
    } else if ('value' in detail && detail.settingId === 'theme') {
      const preference = detail.value === 'light' || detail.value === 'dark'
        ? detail.value
        : 'system'
      const theme = resolveThemePreference(preference)
      applyTheme({ theme })
      applyTheme({ theme, target: document.body })
    } else if ('value' in detail && detail.settingId === 'editorMaterial') {
      const material = detail.value === 'paper' || detail.value === 'classic-word'
        ? detail.value
        : 'continuous'
      applyEditorMaterial({ material })
    }
  },
})
const service: OrganismSettingsService = {
  async load() {
    settingsLoads += 1
    return concrete.load()
  },
  toggle: detail => concrete.toggle(detail),
  select: detail => concrete.select(detail),
  secret: detail => concrete.secret(detail),
  action: detail => concrete.action(detail),
  job: detail => concrete.job(detail),
  subscribe: callback => concrete.subscribe(callback),
}

try {
  const mount = mountOrganismAppRoute(root, {
    location: new URL('/settings#imports', window.location.href),
    settingsService: service,
    onClose: () => { closeCalls += 1 },
  })
  if (!mount) throw new Error('Settings route did not mount')
  await mount.ready
  ready = true
} catch (cause) {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  failure.hidden = false
  failure.textContent = error
}
