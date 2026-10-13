import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrganismShellFeatureHost } from '../shell-features.js'
import { createShellContext } from '../shell-context.js'
import { mountOrganismAppRoute } from '../app-routes.js'
import type { MnSettingsPage } from '@shrubbery/components'

const GATEWAY = 'https://gateway.example.test'
const BASE = `${GATEWAY}/o/user%3Aowner-fixture/g/settings-fixture`
const MODEL = {
  providerId: 'remote-embeddings-pool', modelId: 'BAAI/bge-small-en-v1.5',
  displayName: 'Hosted BGE Small', prepared: true, loaded: true,
  runtimeAvailable: true, effectiveBatchSize: 4,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fixture(options: { operator?: boolean; role?: string; denyJob?: boolean; model?: unknown; index?: unknown; capability?: unknown;
  jobStatus?: unknown; changeSessionOnSubmit?: boolean } = {}) {
  const session = { subject: options.operator ? 'operator-subject' : 'ordinary-subject', token: 'fixture-token' }
  const access = { role: options.role ?? 'editor' }
  const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = []
  const callTool = vi.fn(async () => { throw new Error('No Phanes call expected') })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    requests.push({ url, method: init.method ?? 'GET', authorization: new Headers(init.headers).get('authorization'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null })
    if (url.endsWith('/me/capabilities')) return json(options.capability ?? {
      schema: 'sophia.me.capabilities.v1', subject: session.subject, capabilities: { phanesControl: options.operator === true },
    })
    if (url.endsWith('/api/semantic/model/status')) return json(options.model === undefined ? MODEL : options.model)
    if (url.endsWith('/api/semantic/models')) return json([{ modelId: 'local/other', displayName: 'Unselected local model', selected: false }])
    if (url.endsWith('/api/semantic/index/status/settings-fixture')) return json(options.index ?? {
      graphId: 'settings-fixture',
      exists: true, documentCount: 3, blockCount: 17, staleDocumentCount: 1,
      compatible: false, compatibilityReason: 'Index uses a previous model', indexedAt: '2026-09-01T00:00:00Z',
    })
    if (url.endsWith('/api/semantic/index/refresh/jobs')) {
      if (options.changeSessionOnSubmit) session.subject = 'another-session'
      return options.denyJob ? json({ error: 'Graph writer permission was revoked' }, 403)
        : json({ job_id: 'synthetic-index-job', status: 'queued' }, 202)
    }
    if (url.endsWith('/api/semantic/index/refresh/jobs/synthetic-index-job')) {
      return json(options.jobStatus ?? { job_id: 'synthetic-index-job', status: 'succeeded', progress: { percent: 100, message: 'Fixture index ready' } })
    }
    if (url.includes('/restore-points')) return json({ restorePoints: [], totalCount: 0 })
    return json({ error: 'Not exposed by this hosted fixture' }, 404)
  }))
  const contract = {
    auth: { token: () => session.token, userId: () => session.subject, whenReady: async () => {},
      isAuthenticated: () => true, onChange: () => () => {} },
    runtime: { graphBaseUrl: () => BASE, mode: () => 'hosted' as const, isGateway: () => true },
    gateway: { gatewayBaseUrl: GATEWAY, graphs: async () => [{ graphId: 'settings-fixture', owner: 'user:owner-fixture', role: access.role }] },
    rawMcp: { callTool },
    ui: { confirm: async () => true, icon: () => ({}) as never, presenceColors: [] },
  }
  const host = createOrganismShellFeatureHost()
  const context = createShellContext({ host: document.createElement('div'), graphId: 'settings-fixture', documentId: 'doc-fixture',
    app: 'garden', source: 'CELL_LIVE', deploymentMode: 'hosted', contract,
    location: new URL('https://ui.example.test/settings#local-ai'), rerender: vi.fn() })
  return { host, service: host.routeOptions(context, {}).settingsService!, requests, callTool, session, access }
}

afterEach(() => vi.unstubAllGlobals())

describe('hosted settings production composition', () => {
  it('exposes the actual hosted embedding model and graph index, not a local catalog fallback', async () => {
    const test = fixture()
    try {
      const snapshot = await test.service.load()
      const section = snapshot.sections.find(section => section.id === 'local-ai')
      expect(section).toBeDefined()
      expect(section?.title).toBe('Embeddings')
      expect(section?.metrics?.find(metric => metric.id === 'semantic-model-status')?.value).toBe('Hosted BGE Small')
      expect(section?.jobs?.find(job => job.id === 'refresh-semantic-index')?.detail).toContain('Index uses a previous model')
      expect(section?.selects?.some(select => select.id === 'semanticModel' && !select.disabled)).not.toBe(true)
      expect(section?.jobs?.some(job => job.id === 'prepare-semantic-model' && !job.disabled)).not.toBe(true)
      expect(test.requests.some(request => request.url === `${BASE}/api/semantic/model/status`)).toBe(true)
      expect(test.requests.every(request => request.authorization === 'Bearer fixture-token')).toBe(true)
      expect(test.requests.every(request => request.method === 'GET')).toBe(true)
    } finally { test.host.destroy() }
  })

  it('does not grant Phanes from transport availability, even on a direct settings link', async () => {
    const test = fixture()
    try {
      const snapshot = await test.service.load()
      expect(snapshot.sections.some(section => section.id === 'phanes')).toBe(false)
      expect(test.service.phanesControl).toBeUndefined()
      expect(test.callTool).not.toHaveBeenCalled()
      const element = document.createElement('div')
      document.body.appendChild(element)
      const mount = mountOrganismAppRoute(element, { settingsService: test.service,
        location: new URL('https://ui.example.test/settings?settings=phanes') })!
      await mount.ready
      const page = element.querySelector<MnSettingsPage>('mn-settings-page')!
      await page.updateComplete
      expect(page.activeSection).toBe('account')
      expect(page.shadowRoot?.querySelector('[data-section-id="phanes"]')).toBeNull()
      expect(element.querySelector('mn-phanes-control-editor')).toBeNull()
      expect(test.callTool).not.toHaveBeenCalled()
      mount.destroy()
      element.remove()
    } finally { test.host.destroy() }
  })

  it('renders Embeddings navigation and the real controlled status through the Settings route', async () => {
    const test = fixture()
    const element = document.createElement('div')
    document.body.appendChild(element)
    const mount = mountOrganismAppRoute(element, { settingsService: test.service,
      location: new URL('https://ui.example.test/settings#local-ai') })!
    try {
      await mount.ready
      const page = element.querySelector<MnSettingsPage>('mn-settings-page')!
      await page.updateComplete
      expect(page.shadowRoot?.querySelector('[data-section-id="local-ai"]')?.textContent).toContain('Embeddings')
      expect(page.shadowRoot?.textContent).toContain('Hosted BGE Small')
      expect(page.shadowRoot?.textContent).toContain('remote-embeddings-pool')
      expect(page.shadowRoot?.textContent).not.toContain('Prepare Docling')
    } finally { mount.destroy(); element.remove(); test.host.destroy() }
  })

  it('admits the server-authorized operator settings slot, not a name or email match', async () => {
    const test = fixture({ operator: true })
    try {
      const snapshot = await test.service.load()
      expect(snapshot.sections.some(section => section.id === 'phanes')).toBe(true)
      expect(test.service.phanesControl).toBeDefined()
      test.session.token = ''
      expect(test.service.phanesControl).toBeUndefined()
      expect((await test.service.load()).sections.some(section => section.id === 'phanes')).toBe(false)
    } finally { test.host.destroy() }
  })

  it('runs a writer’s graph-scoped index job through acceptance and completion receipts only', async () => {
    const test = fixture()
    try {
      await test.service.load()
      await test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })
      const post = test.requests.find(request => request.method === 'POST')!
      expect(post.url).toBe(`${BASE}/api/semantic/index/refresh/jobs`)
      expect(post.body).toEqual({ graphId: 'settings-fixture', flushBoundary: 'required' })
      expect(test.requests.some(request => request.url === `${BASE}/api/semantic/index/refresh/jobs/synthetic-index-job`)).toBe(true)
      const section = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(section.jobs?.find(job => job.id === 'refresh-semantic-index')).toMatchObject({ status: 'succeeded', detail: 'Fixture index ready' })
      for (const settingId of ['semanticModel', 'semanticBatchSize']) {
        await expect(test.service.select({ sectionId: 'local-ai', settingId, value: 'unapproved' })).rejects.toThrow('service-managed')
      }
      await expect(test.service.job({ sectionId: 'local-ai', jobId: 'prepare-semantic-model' })).rejects.toThrow('prepared by the service')
      expect(test.requests.filter(request => request.method !== 'GET')).toHaveLength(1)
      test.access.role = 'viewer'
      const demoted = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(demoted.jobs?.find(job => job.id === 'refresh-semantic-index')?.disabled).toBe(true)
    } finally { test.host.destroy() }
  })

  it('keeps Viewer status visible but refuses both the control and a direct mutation intent', async () => {
    const test = fixture({ role: 'viewer' })
    try {
      const section = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(section.metrics?.find(metric => metric.id === 'semantic-index-status')).toBeDefined()
      expect(section.jobs?.find(job => job.id === 'refresh-semantic-index')?.disabled).toBe(true)
      await expect(test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })).rejects.toThrow('editor or owner')
      expect(test.requests.every(request => request.method === 'GET')).toBe(true)
    } finally { test.host.destroy() }
  })

  it('rechecks a writer hint and preserves a backend denial as failed, never succeeded', async () => {
    const test = fixture({ denyJob: true })
    try {
      await test.service.load()
      test.access.role = 'viewer'
      await expect(test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })).rejects.toThrow('editor or owner')
      expect(test.requests.every(request => request.method === 'GET')).toBe(true)
      test.access.role = 'editor'
      await test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })
      const section = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(section.jobs?.find(job => job.id === 'refresh-semantic-index')).toMatchObject({ status: 'failed', detail: 'Graph writer permission was revoked' })
    } finally { test.host.destroy() }
  })

  it.each([
    { jobStatus: { job_id: 'other-job', status: 'succeeded' } },
    { jobStatus: { job_id: 'synthetic-index-job', status: 'mysterious' } },
    { changeSessionOnSubmit: true },
  ])('refuses a false job completion or cross-session job continuation: %j', async options => {
    const test = fixture(options)
    try {
      await test.service.load()
      await test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })
      const section = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(section.jobs?.find(job => job.id === 'refresh-semantic-index')?.status).toBe('failed')
      if (options.changeSessionOnSubmit) expect(test.requests.some(request => request.url.endsWith('/jobs/synthetic-index-job'))).toBe(false)
    } finally { test.host.destroy() }
  })

  it.each([
    { model: null }, { model: { code: 'graph_activating', pollUrl: '/activations/fixture' } },
    { index: { graphId: 'wrong-graph', exists: true, compatible: true, documentCount: 0, blockCount: 0, staleDocumentCount: 0 } },
    { index: { graphId: 'settings-fixture', exists: true, compatible: true, documentCount: '3', blockCount: 0, staleDocumentCount: 0 } },
  ])('does not advertise healthy or writable embeddings from malformed/status-mismatched data: %j', async options => {
    const test = fixture(options)
    try {
      const section = (await test.service.load()).sections.find(section => section.id === 'local-ai')!
      expect(section.jobs?.some(job => job.id === 'refresh-semantic-index' && !job.disabled)).not.toBe(true)
      expect(section.notes?.join(' ')).toContain('invalid')
      await expect(test.service.job({ sectionId: 'local-ai', jobId: 'refresh-semantic-index' })).rejects.toThrow('must be available')
      expect(test.requests.every(request => request.method === 'GET')).toBe(true)
    } finally { test.host.destroy() }
  })
})
