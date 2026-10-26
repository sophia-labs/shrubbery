import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import type { AuthProvider } from '@shrubbery/nucleus'
import { GatewayTransport } from '../gateway-transport.js'
import { resolveHostedEntry } from '../hosted-entry-route.js'
import { redeemShareLinkFromLocation, showShareLinkLanding } from '../share-link-redemption.js'

const TOKEN = `shr_${'Q'.repeat(43)}`

class TestAuth implements AuthProvider {
  token(): string { return 'hosted-access-token' }
  userId(): string { return 'user:joiner' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}

/** A gateway twin speaking the real control-MCP wire for redeem_share_link. */
function gatewayTwin(outcome: { role: 'viewer' | 'editor' } | { code: number }) {
  const bodies: unknown[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const body = JSON.parse(String(init.body))
    bodies.push({ path: url.pathname, body, authorization: new Headers(init.headers).get('authorization') })
    if ('code' in outcome) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: outcome.code, message: 'graph not found' } })
    return Response.json({ jsonrpc: '2.0', id: body.id, result: { isError: false, structuredContent: {
      graph: { owner: 'user:vera', graphId: 'sophia-standard' }, generation: 1, role: outcome.role, route: '/o/user:vera/g/sophia-standard',
    } } })
  })
  const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test', auth: new TestAuth(), fetch: fetch as typeof globalThis.fetch })
  return { gateway, bodies, fetch }
}

afterEach(() => document.body.replaceChildren())

describe('share link landing', () => {
  it('ignores locations without a share fragment', async () => {
    const { gateway, fetch } = gatewayTwin({ role: 'viewer' })
    const replaceUrl = vi.fn()
    await expect(redeemShareLinkFromLocation({ location: new URL('https://garden.test/#block-1'), gateway, replaceUrl })).resolves.toBeNull()
    expect(replaceUrl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('scrubs the token from history before redeeming, then opens an editor link', async () => {
    const { gateway, bodies } = gatewayTwin({ role: 'editor' })
    const urls: string[] = []
    const landing = await redeemShareLinkFromLocation({
      location: new URL(`https://garden.test/#share=${TOKEN}`),
      gateway,
      replaceUrl: url => { urls.push(url.href); expect(bodies.length).toBeLessThanOrEqual(1) },
    })
    expect(urls[0]).toBe('https://garden.test/')
    expect(urls[1]).toBe('https://garden.test/?graph=sophia-standard')
    expect(urls.join(' ')).not.toContain('shr_')
    expect(landing).toEqual({ kind: 'joined', graphId: 'sophia-standard', owner: 'user:vera', role: 'editor' })
    expect(bodies).toEqual([{
      path: '/control/mcp',
      authorization: 'Bearer hosted-access-token',
      body: expect.objectContaining({ method: 'tools/call', params: { name: 'redeem_share_link', arguments: { token: TOKEN } } }),
    }])
  })

  it('lands a Viewer in the joined graph, read-only, and says so', async () => {
    const viewer = gatewayTwin({ role: 'viewer' })
    const urls: string[] = []
    const joined = await redeemShareLinkFromLocation({ location: new URL(`https://garden.test/#share=${TOKEN}`), gateway: viewer.gateway, replaceUrl: url => urls.push(url.href) })
    expect(joined).toEqual({ kind: 'joined', graphId: 'sophia-standard', owner: 'user:vera', role: 'viewer' })
    expect(urls).toEqual(['https://garden.test/', 'https://garden.test/?graph=sophia-standard'])
    expect(urls.join(' ')).not.toContain('shr_')
    // The landing then opens that graph: the entry route no longer refuses a Viewer.
    await expect(resolveHostedEntry({
      location: new URL(urls[1]),
      loadGraphs: async () => [{ graphId: 'sophia-standard', title: 'Standard', role: 'viewer', cellState: 'running' }],
    })).resolves.toEqual({ kind: 'graph', graphId: 'sophia-standard' })
    const toast = showShareLinkLanding(document, joined!)
    expect(toast.getAttribute('data-share-link-landing')).toBe('joined')
    expect(toast.type).toBe('success')
    expect(toast.message).toBe('You can view sophia-standard')
    expect(toast.description).toContain('read-only')
  })

  it('reports dead or malformed links without a request', async () => {
    const dead = gatewayTwin({ code: -32004 })
    const failed = await redeemShareLinkFromLocation({ location: new URL(`https://garden.test/#share=${TOKEN}`), gateway: dead.gateway, replaceUrl: () => undefined })
    expect(failed).toEqual({ kind: 'failed', message: expect.stringContaining('expired, was revoked') })

    const malformed = gatewayTwin({ role: 'viewer' })
    const scrubbed: string[] = []
    const bad = await redeemShareLinkFromLocation({ location: new URL('https://garden.test/#share=oops&x=1'), gateway: malformed.gateway, replaceUrl: url => scrubbed.push(url.href) })
    expect(bad).toEqual({ kind: 'failed', message: expect.stringContaining('malformed') })
    expect(scrubbed).toEqual(['https://garden.test/#x=1'])
    expect(malformed.fetch).not.toHaveBeenCalled()

    const toast = showShareLinkLanding(document, failed!)
    expect(toast.getAttribute('data-share-link-landing')).toBe('failed')
    expect(toast.type).toBe('warning')
  })

  it('sends an undirected root with only viewer-shared graphs to Home, not a read-only graph', async () => {
    const shared = [{ graphId: 'sophia-standard', title: 'Standard', role: 'viewer' as const, cellState: 'running' as const }]
    await expect(resolveHostedEntry({ location: new URL('https://garden.test/'), loadGraphs: async () => shared }))
      .resolves.toMatchObject({ kind: 'home' })
    await expect(resolveHostedEntry({
      location: new URL('https://garden.test/'),
      loadGraphs: async () => [...shared, { graphId: 'mine', title: 'Mine', role: 'owner' as const, cellState: 'stopped' as const }],
    })).resolves.toEqual({ kind: 'graph', graphId: 'mine' })
  })
})
