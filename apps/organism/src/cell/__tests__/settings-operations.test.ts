import { describe, expect, it, vi } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import {
  GardendSettingsOperations,
  type PickSettingsFilesOptions,
} from '../settings-operations.js'
import { createDefaultSettingsService } from '../settings-service.js'

const GRAPH_ID = 'settings-oracle'
const BASE = `https://cell.example/g/${GRAPH_ID}`

function contract(): Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'> {
  return {
    auth: {
      token: () => 'settings-token',
      userId: () => 'settings-user',
      isAuthenticated: () => true,
      whenReady: () => Promise.resolve(),
      onChange: () => () => undefined,
    },
    runtime: {
      mode: () => 'local',
      isGateway: () => false,
      graphBaseUrl: () => BASE,
    },
    ui: {
      confirm: async () => true,
      icon: () => ({}) as never,
      presenceColors: [],
    },
  }
}

interface SeenRequest {
  readonly path: string
  readonly method: string
  readonly body: BodyInit | null | undefined
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function successfulBackend(): { fetch: typeof fetch; seen: SeenRequest[] } {
  const seen: SeenRequest[] = []
  const results = new Map<string, unknown>()
  let jobSequence = 0
  let restorePoints = [{
    restorePointId: 'rp-existing',
    timestamp: '2026-07-10T12:00:00.000Z',
    label: 'Existing checkpoint',
    trigger: 'manual',
    documentCount: 3,
    sizeBytes: 2048,
    isLatest: true,
  }]

  const submit = (result: unknown): Response => {
    const jobId = `job-${++jobSequence}`
    results.set(jobId, result)
    return json({ job_id: jobId, status: 'queued' }, 202)
  }

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer settings-token')
    expect(headers.get('x-user-id')).toBe('settings-user')
    const method = init.method ?? 'GET'
    const path = `${url.pathname}${url.search}`
    seen.push({ path, method, body: init.body })

    const statusMatch = /\/graphs\/jobs\/([^/]+)$/.exec(url.pathname)
    if (method === 'GET' && statusMatch) {
      return json({
        job_id: statusMatch[1],
        status: 'succeeded',
        progress: { percent: 100, message: 'Backend work completed' },
      })
    }
    const resultMatch = /\/graphs\/jobs\/([^/]+)\/result$/.exec(url.pathname)
    if (method === 'GET' && resultMatch) return json(results.get(resultMatch[1]!) ?? {})

    if (method === 'POST' && /\/imports\/(obsidian|notion|roam)$/.test(url.pathname)) {
      return submit({ documentsCreated: 2, foldersCreated: 1, wiresCreated: 1, warnings: [] })
    }
    if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/duplicate`)) {
      const body = JSON.parse(String(init.body)) as { new_graph_id: string }
      return submit({ new_graph_id: body.new_graph_id })
    }
    if (method === 'POST' && url.pathname.endsWith(`/graphs/${GRAPH_ID}/export`)) {
      return submit({ format: 'trig', mediaType: 'application/trig', data: '<s> <p> <o> .\n', quadCount: 1 })
    }
    if (method === 'POST' && url.pathname.endsWith('/graphs/import')) {
      const form = init.body as FormData
      return submit({ graph_id: String(form.get('new_graph_id')) })
    }
    if (method === 'GET' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restore-points`)) {
      return json({ restorePoints, nextCursor: null, totalCount: restorePoints.length })
    }
    if (method === 'POST' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restore-points`)) {
      const body = JSON.parse(String(init.body)) as { label?: string }
      const created = {
        restorePointId: 'rp-created',
        timestamp: '2026-07-10T13:00:00.000Z',
        label: body.label || 'rp-created',
        trigger: 'manual',
        documentCount: 3,
        sizeBytes: 4096,
        isLatest: true,
      }
      restorePoints = [created, ...restorePoints.map(point => ({ ...point, isLatest: false }))]
      return json(created, 201)
    }
    if (method === 'POST' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restores`)) {
      return json({ operationId: 'restore-op-1', state: 'pending' }, 202)
    }
    if (method === 'GET' && url.pathname.endsWith(`/v1/time-travel/${GRAPH_ID}/restores/restore-op-1`)) {
      return json({ operationId: 'restore-op-1', state: 'succeeded', percent: 100, message: 'Verified' })
    }
    return json({ error: `Unexpected ${method} ${url.pathname}` }, 404)
  }
  return { fetch, seen }
}

function file(name: string, body = 'fixture'): File {
  return new File([body], name, { type: name.endsWith('.zip') ? 'application/zip' : 'text/plain' })
}

describe('GardendSettingsOperations', () => {
  it('projects only real routes and does not manufacture unavailable controls', async () => {
    const backend = successfulBackend()
    const operations = new GardendSettingsOperations(contract(), GRAPH_ID, null, 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
    })
    const service = createDefaultSettingsService({ runtimeMode: 'local', operations })
    const snapshot = await service.load()

    const imports = snapshot.sections.find(section => section.id === 'imports')!
    expect(imports.actions?.map(action => [action.id, action.disabled])).toEqual([
      ['import-files', false],
      ['import-obsidian', false],
      ['import-notion', false],
      ['import-roam', false],
    ])
    expect(imports.notes?.join(' ')).toContain('terminal job result')

    const graphOps = snapshot.sections.find(section => section.id === 'graph-ops')!
    expect(graphOps.actions?.filter(action => !action.disabled).map(action => action.id)).toEqual([
      'duplicate-graph', 'export-graph', 'import-graph',
    ])
    expect(graphOps.actions?.find(action => action.id === 'rename-graph')).toBeUndefined()
    expect(graphOps.jobs).toEqual([])

    expect(snapshot.sections.find(section => section.id === 'billing')).toBeUndefined()
    expect(snapshot.sections.find(section => section.id === 'usage')).toBeUndefined()
    const history = snapshot.sections.find(section => section.id === 'history')!
    expect(history.actions?.find(action => action.id === 'open-history')).toBeUndefined()
    expect(history.actions?.find(action => action.id === 'restore-point:rp-existing')).toBeDefined()
  })

  it('hands ordinary files to the existing transfer service and exposes honest progress/success', async () => {
    const backend = successfulBackend()
    const imported = file('notes.md', '# Notes')
    const uploadFiles = vi.fn(async (_graphId, files: readonly File[], options: {
      onFileStart?: (file: File, index: number, total: number) => void
      onProgress?: (file: File, progress: { jobId: string; status: 'running'; percent: number; message: string }) => void
    }) => {
      options.onFileStart?.(files[0]!, 0, 1)
      options.onProgress?.(files[0]!, { jobId: 'upload-1', status: 'running', percent: 75, message: 'Writing notes.md' })
      return {
        succeeded: [{ file: files[0], documentId: 'doc-notes' }],
        failed: [],
        skipped: [],
        cancelled: false,
      }
    })
    const operations = new GardendSettingsOperations(contract(), GRAPH_ID, 'doc-active', 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles } as never,
      pickFiles: async () => [imported],
    })
    const statuses: string[] = []
    operations.subscribe(() => statuses.push(operations.snapshot().current?.status ?? 'none'))

    await operations.action({ sectionId: 'imports', actionId: 'import-files' })

    expect(uploadFiles).toHaveBeenCalledWith(GRAPH_ID, [imported], expect.any(Object))
    expect(statuses).toContain('running')
    expect(operations.snapshot().current).toMatchObject({
      status: 'succeeded',
      progress: 100,
      detail: 'Imported 1 file.',
    })
  })

  it('submits and waits for Obsidian, Notion, and Roam jobs through the exact multipart routes', async () => {
    const backend = successfulBackend()
    const queue = [file('obsidian.zip'), file('notion.zip'), file('roam.zip')]
    const pickCalls: PickSettingsFilesOptions[] = []
    const operations = new GardendSettingsOperations(contract(), GRAPH_ID, 'doc-active', 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
      pickFiles: async options => {
        pickCalls.push(options)
        return [queue.shift()!]
      },
      sleep: async () => undefined,
    })

    for (const kind of ['obsidian', 'notion', 'roam'] as const) {
      await operations.action({ sectionId: 'imports', actionId: `import-${kind}` })
      expect(operations.snapshot().current).toMatchObject({
        status: 'succeeded',
        detail: expect.stringContaining('2 documents, 1 wire'),
      })
    }

    expect(pickCalls.every(call => call.accept.includes('.zip') && call.multiple === false)).toBe(true)
    expect(backend.seen.filter(request => request.method === 'POST' && request.path.includes('/imports/')).map(request => request.path)).toEqual([
      `/g/${GRAPH_ID}/graphs/${GRAPH_ID}/imports/obsidian`,
      `/g/${GRAPH_ID}/graphs/${GRAPH_ID}/imports/notion`,
      `/g/${GRAPH_ID}/graphs/${GRAPH_ID}/imports/roam`,
    ])
  })

  it('duplicates, exports real TriG bytes, and imports a graph archive without claiming archive export', async () => {
    const backend = successfulBackend()
    const archive = file('garden-backup.tar.gz')
    const prompts = ['settings-copy', 'Settings Copy', 'settings-imported', 'Imported Settings']
    const saved: Array<{ blob: Blob; filename: string }> = []
    const operations = new GardendSettingsOperations(contract(), GRAPH_ID, 'doc-active', 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
      pickFiles: async () => [archive],
      prompt: async () => prompts.shift() ?? null,
      save: (blob, filename) => saved.push({ blob, filename }),
      sleep: async () => undefined,
    })

    await operations.action({ sectionId: 'graph-ops', actionId: 'duplicate-graph' })
    expect(operations.snapshot().current?.detail).toContain('settings-copy')
    const duplicate = backend.seen.find(request => request.path.endsWith(`/graphs/${GRAPH_ID}/duplicate`))!
    expect(JSON.parse(String(duplicate.body))).toEqual({
      new_graph_id: 'settings-copy',
      new_title: 'Settings Copy',
    })

    await operations.action({ sectionId: 'graph-ops', actionId: 'export-graph' })
    expect(saved).toHaveLength(1)
    expect(saved[0]!.filename).toBe('settings-oracle.trig')
    expect(await saved[0]!.blob.text()).toBe('<s> <p> <o> .\n')
    expect(operations.snapshot().current?.detail).toContain('1 quad')

    await operations.action({ sectionId: 'graph-ops', actionId: 'import-graph' })
    const graphImport = backend.seen.find(request => request.method === 'POST' && request.path.endsWith('/graphs/import'))!
    expect(graphImport.body).toBeInstanceOf(FormData)
    expect((graphImport.body as FormData).get('new_graph_id')).toBe('settings-imported')
    expect((graphImport.body as FormData).get('new_title')).toBe('Imported Settings')
    expect(operations.snapshot().current?.detail).toContain('settings-imported')
  })

  it('defaults promptValue to contract.ui.prompt (themed dialog), never a native window.prompt, when no override is given', async () => {
    const backend = successfulBackend()
    const promptCalls: Array<{ title?: string; value?: string }> = []
    const answers = ['settings-copy', 'Settings Copy']
    const nativePrompt = vi.spyOn(globalThis, 'prompt').mockImplementation(() => {
      throw new Error('should not fall back to native window.prompt when contract.ui.prompt is available')
    })
    const contractWithPrompt: Pick<ShrubberyContract, 'auth' | 'runtime' | 'ui'> = {
      ...contract(),
      ui: {
        confirm: async () => true,
        prompt: async (opts) => {
          promptCalls.push({ title: opts.title, value: opts.value })
          return answers.shift() ?? null
        },
        icon: () => ({}) as never,
        presenceColors: [],
      },
    }
    const operations = new GardendSettingsOperations(contractWithPrompt, GRAPH_ID, 'doc-active', 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
      sleep: async () => undefined,
    })

    await operations.action({ sectionId: 'graph-ops', actionId: 'duplicate-graph' })

    expect(nativePrompt).not.toHaveBeenCalled()
    expect(promptCalls).toEqual([
      { title: 'New graph ID', value: 'settings-oracle-copy' },
      { title: 'New graph title (optional)', value: '' },
    ])
    const duplicate = backend.seen.find(request => request.path.endsWith(`/graphs/${GRAPH_ID}/duplicate`))!
    expect(JSON.parse(String(duplicate.body))).toEqual({
      new_graph_id: 'settings-copy',
      new_title: 'Settings Copy',
    })
    nativePrompt.mockRestore()
  })

  it('loads, captures, and restores graph history only after explicit confirmation', async () => {
    const backend = successfulBackend()
    const confirmations: string[] = []
    const prompts = ['Before settings mutation']
    const operations = new GardendSettingsOperations(contract(), GRAPH_ID, 'doc-active', 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
      prompt: async () => prompts.shift() ?? null,
      confirm: async input => {
        confirmations.push(input.message)
        return true
      },
      sleep: async () => undefined,
    })

    await operations.ensureHistoryLoaded()
    expect(operations.snapshot().restorePoints.map(point => point.restorePointId)).toEqual(['rp-existing'])

    await operations.action({ sectionId: 'history', actionId: 'create-restore-point' })
    expect(operations.snapshot().current).toMatchObject({ status: 'succeeded' })
    expect(operations.snapshot().restorePoints[0]).toMatchObject({
      restorePointId: 'rp-created',
      label: 'Before settings mutation',
    })

    await operations.action({ sectionId: 'history', actionId: 'restore-point:rp-created' })
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toContain('pre-restore backup')
    expect(operations.snapshot().current).toMatchObject({
      status: 'succeeded',
      progress: 100,
      detail: expect.stringContaining('rp-created'),
    })
    expect(backend.seen.some(request => request.path.endsWith(`/v1/time-travel/${GRAPH_ID}/restores`))).toBe(true)
  })

  it('keeps cancellation and backend failure visible instead of reporting success', async () => {
    const backend = successfulBackend()
    const cancelled = new GardendSettingsOperations(contract(), GRAPH_ID, null, 'local', {
      fetch: backend.fetch,
      transfer: { uploadFiles: vi.fn() },
      pickFiles: async () => null,
    })
    await cancelled.action({ sectionId: 'imports', actionId: 'import-files' })
    expect(cancelled.snapshot().current).toMatchObject({ status: 'cancelled', progress: null })

    const failingFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer settings-token')
      return json({ detail: { message: `Backend refused ${new URL(String(input)).pathname}` } }, 422)
    }
    const failed = new GardendSettingsOperations(contract(), GRAPH_ID, null, 'local', {
      fetch: failingFetch,
      transfer: { uploadFiles: vi.fn() },
      prompt: () => 'settings-copy',
    })
    await failed.action({ sectionId: 'graph-ops', actionId: 'duplicate-graph' })
    expect(failed.snapshot().current).toMatchObject({
      status: 'failed',
      progress: null,
      detail: expect.stringContaining('Backend refused'),
    })
    expect(failed.snapshot().current?.detail).not.toContain('complete')
  })
})
