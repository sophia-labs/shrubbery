import { describe, expect, it, vi } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { GardendLocalAiSettings } from '../local-ai-settings.js'

const GRAPH_ID = 'local-ai-graph'
const BASE = `https://cell.example/g/${GRAPH_ID}`

function contract(): Pick<ShrubberyContract, 'auth' | 'runtime'> {
  return {
    auth: {
      token: () => 'local-ai-token',
      userId: () => 'local-ai-user',
      isAuthenticated: () => true,
      whenReady: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    runtime: {
      mode: () => 'local',
      isGateway: () => false,
      graphBaseUrl: () => BASE,
    },
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface RecordedRequest {
  readonly path: string
  readonly method: string
  readonly body: unknown
  readonly authorization: string | null
  readonly userId: string | null
}

function backend(overrides: Record<string, (request: RecordedRequest) => Response> = {}) {
  const requests: RecordedRequest[] = []
  let indexPolls = 0
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const request: RecordedRequest = {
      path: url.pathname,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null,
      authorization: new Headers(init.headers).get('authorization'),
      userId: new Headers(init.headers).get('x-user-id'),
    }
    requests.push(request)
    const key = `${request.method} ${request.path}`
    if (overrides[key]) return overrides[key]!(request)

    if (request.path.endsWith('/api/semantic/model/status')) return json({
      modelId: 'fastembed/bge-small-en-v1.5',
      displayName: 'BGE Small',
      providerId: 'fastembed',
      prepared: true,
      loaded: true,
      runtimeAvailable: true,
      effectiveBatchSize: 4,
    })
    if (request.path.endsWith('/api/semantic/models')) return json([
      {
        modelId: 'fastembed/bge-small-en-v1.5',
        displayName: 'BGE Small',
        selected: true,
        recommended: true,
        effectiveBatchSize: 4,
      },
      {
        modelId: 'candle/nomic-embed-text-v2-moe',
        displayName: 'Nomic V2 MoE',
        selected: false,
      },
    ])
    if (request.path.endsWith(`/api/semantic/index/status/${GRAPH_ID}`)) return json({
      documentCount: 3,
      blockCount: 17,
      staleDocumentCount: 1,
      indexedAt: '2026-07-11T12:00:00.000Z',
      compatible: true,
    })
    if (request.path.endsWith('/api/artifacts/ingestion/approaches')) return json([
      { approachId: 'markdown.direct', label: 'Markdown Direct', family: 'markdown', status: 'available', selectable: true },
      { approachId: 'pdf.fast-text', label: 'PDF Fast Text', family: 'pdf', status: 'available', selectable: true },
      { approachId: 'pdf.ocr', label: 'OCR candidate', family: 'pdf', status: 'candidate', selectable: false },
    ])
    if (request.path.endsWith('/api/artifacts/ingestion/docling/status')) return json({
      supported: false,
      available: false,
      status: 'unsupported',
      reason: 'unsupported on this fixture platform',
    })
    if (request.path.endsWith('/api/artifacts/ingestion/pdf/pipeline')) return json({
      preferredEngineId: 'auto',
      effectiveEngineId: 'pdf.fast-text',
      effectiveReason: 'Auto selected the available baseline.',
      platform: 'fixture',
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
    if (request.method === 'PUT' && request.path.endsWith('/api/semantic/model/config')) return json({
      modelId: String((request.body as Record<string, unknown>).modelId),
      displayName: 'Configured model',
      effectiveBatchSize: Number((request.body as Record<string, unknown>).batchSize),
      prepared: false,
      loaded: false,
      runtimeAvailable: true,
    })
    if (request.method === 'PUT' && request.path.endsWith('/api/artifacts/ingestion/pdf/pipeline')) return json({
      preferredEngineId: String((request.body as Record<string, unknown>).preferredEngineId),
      effectiveEngineId: 'pdf.fast-text',
      effectiveReason: 'Fixture preference saved.',
      engines: [],
      preferenceOptions: [],
    })
    if (request.method === 'POST' && request.path.endsWith('/api/semantic/index/refresh/jobs')) {
      return json({ job_id: 'semantic-job-1', status: 'queued' }, 202)
    }
    if (request.path.endsWith('/api/semantic/index/refresh/jobs/semantic-job-1')) {
      indexPolls += 1
      return indexPolls === 1
        ? json({ job_id: 'semantic-job-1', status: 'running', progress: { percent: 45, message: 'Embedding blocks' } })
        : json({ job_id: 'semantic-job-1', status: 'succeeded', progress: { percent: 100, message: 'Index ready' } })
    }
    return json({ error: `Unhandled ${key}` }, 404)
  })
  return { fetch, requests }
}

const emptySection = {
  id: 'local-ai',
  title: 'Local AI',
  description: 'Local model and ingestion state.',
} as const

describe('GardendLocalAiSettings', () => {
  it('projects real model, index, and ingestion state without advertising unwired engines', async () => {
    const fixture = backend()
    const settings = new GardendLocalAiSettings(contract(), GRAPH_ID, { fetch: fixture.fetch })
    await settings.ensureLoaded()
    const section = settings.decorateSection(emptySection)

    expect(fixture.requests).toHaveLength(6)
    expect(fixture.requests.every(request => request.authorization === 'Bearer local-ai-token')).toBe(true)
    expect(fixture.requests.every(request => request.userId === 'local-ai-user')).toBe(true)
    expect(section.wide).toBe(false)
    expect(section.metrics?.map(metric => [metric.id, metric.value])).toEqual([
      ['semantic-model-status', 'BGE Small'],
      ['semantic-index-status', '17 blocks'],
      ['pdf-pipeline-status', 'PDF Fast Text'],
      ['ingestion-approaches', '2 available'],
    ])
    expect(section.selects?.find(select => select.id === 'semanticModel')?.options).toEqual([
      { value: 'fastembed/bge-small-en-v1.5', label: 'BGE Small · recommended' },
      { value: 'candle/nomic-embed-text-v2-moe', label: 'Nomic V2 MoE' },
    ])
    expect(section.selects?.find(select => select.id === 'pdfEngine')?.options.map(option => option.value)).toEqual([
      'auto', 'pdf.fast-text', 'pdf.docling-accurate',
    ])
    expect(JSON.stringify(section)).not.toContain('pdf.ocrmypdf-tesseract')
    expect(section.jobs?.map(job => job.id)).toEqual([
      'prepare-semantic-model', 'refresh-semantic-index', 'refresh-local-ai',
    ])
    expect(section.notes).toContain('Docling is unavailable on this platform: unsupported on this fixture platform')
  })

  it('persists model, batch, and PDF choices through exact authenticated gardend routes', async () => {
    const fixture = backend()
    const settings = new GardendLocalAiSettings(contract(), GRAPH_ID, { fetch: fixture.fetch })
    await settings.ensureLoaded()
    await settings.select('semanticModel', 'candle/nomic-embed-text-v2-moe')
    await settings.select('semanticBatchSize', '8')
    await settings.select('pdfEngine', 'pdf.docling-accurate')

    const writes = fixture.requests.filter(request => request.method === 'PUT')
    expect(writes).toEqual([
      expect.objectContaining({
        path: `/g/${GRAPH_ID}/api/semantic/model/config`,
        body: { modelId: 'candle/nomic-embed-text-v2-moe', batchSize: 4 },
      }),
      expect.objectContaining({
        path: `/g/${GRAPH_ID}/api/semantic/model/config`,
        body: { modelId: 'fastembed/bge-small-en-v1.5', batchSize: 8 },
      }),
      expect.objectContaining({
        path: `/g/${GRAPH_ID}/api/artifacts/ingestion/pdf/pipeline`,
        body: { preferredEngineId: 'pdf.docling-accurate' },
      }),
    ])
  })

  it('runs and polls semantic indexing as a cancellable backend job', async () => {
    const fixture = backend()
    const settings = new GardendLocalAiSettings(contract(), GRAPH_ID, {
      fetch: fixture.fetch,
      pollIntervalMs: 0,
      sleep: async () => undefined,
    })
    await settings.ensureLoaded()
    await settings.job('refresh-semantic-index')

    const submit = fixture.requests.find(request => request.method === 'POST'
      && request.path.endsWith('/api/semantic/index/refresh/jobs'))
    expect(submit?.body).toEqual({ graphId: GRAPH_ID, flushBoundary: 'required' })
    const section = settings.decorateSection(emptySection)
    expect(section.jobs?.find(job => job.id === 'refresh-semantic-index')).toMatchObject({
      status: 'succeeded',
      detail: 'Index ready',
      progress: 100,
    })
  })

  it('keeps partial runtime failures visible instead of replacing real ingestion state with defaults', async () => {
    const failure = { error: 'constitution is absent' }
    const fixture = backend({
      [`GET /g/${GRAPH_ID}/api/semantic/model/status`]: () => json(failure, 500),
      [`GET /g/${GRAPH_ID}/api/semantic/models`]: () => json(failure, 500),
      [`GET /g/${GRAPH_ID}/api/semantic/index/status/${GRAPH_ID}`]: () => json(failure, 500),
    })
    const settings = new GardendLocalAiSettings(contract(), GRAPH_ID, { fetch: fixture.fetch })
    await settings.ensureLoaded()
    const section = settings.decorateSection(emptySection)

    expect(section.metrics?.map(metric => metric.id)).toEqual([
      'pdf-pipeline-status', 'ingestion-approaches',
    ])
    expect(section.metrics?.find(metric => metric.id === 'semantic-model-status')).toBeUndefined()
    expect(fixture.requests).toHaveLength(4)
    expect(section.notes?.filter(note => note.includes('constitution is absent'))).toHaveLength(1)
    expect(JSON.stringify(section)).not.toContain('768')
    expect(JSON.stringify(section)).not.toContain('fastembed')
  })
})
