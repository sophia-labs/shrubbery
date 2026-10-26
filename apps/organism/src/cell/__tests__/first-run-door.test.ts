import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import { hostedSignUpLocation, safeAuthReturnUrl } from '../auth-navigation.js'
import { GatewayTransport, type GatewayGraphInfo } from '../gateway-transport.js'
import { resolveHostedEntry } from '../hosted-entry-route.js'

const catalog: readonly GatewayGraphInfo[] = [
  { graphId: 'stopped', title: 'Stopped', role: 'owner', cellState: 'stopped' },
  { graphId: 'viewer', title: 'Viewer', role: 'viewer', cellState: 'running' },
  { graphId: 'running', title: 'Running', role: 'editor', cellState: 'running' },
]

function directory(body: unknown, status = 200, token = 'synthetic-id-token') {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
  const gateway = new GatewayTransport({
    gatewayBaseUrl: 'https://gateway.test',
    auth: {
      token: () => token || undefined,
      userId: () => 'synthetic-user',
      isAuthenticated: () => Boolean(token),
      whenReady: async () => {},
      onChange: () => () => {},
    },
    fetch: fetch as typeof globalThis.fetch,
  })
  return { gateway, fetch }
}

describe('hosted first-run door', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

  it('turns a successful empty root catalog into usable Home without creating or selecting a graph', async () => {
    const { gateway, fetch } = directory([])
    const entry = await resolveHostedEntry({
      location: new URL('https://app.test/'),
      storedGraphId: 'stale-prior-selection',
      loadGraphs: () => gateway.graphs(),
    })
    expect(entry.kind).toBe('home')
    if (entry.kind !== 'home') throw new Error('Expected the account Home route')
    expect(entry.location.href).toBe('https://app.test/home')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://gateway.test/graphs', expect.objectContaining({
      method: 'GET',
    }))

    const host = document.createElement('div')
    document.body.append(host)
    const create = vi.fn(async () => {})
    const startOnboarding = vi.fn(async () => {})
    const openGraph = vi.fn()
    const mount = mountOrganismAppRoute(host, {
      location: entry.location,
      gardenHomeService: {
        load: async () => ({ account: { userId: 'synthetic-user', displayName: 'New arrival' }, workspaces: [] }),
        create,
        startOnboarding,
        openGraph,
      },
    })
    cleanups.push(() => { mount?.destroy(); host.remove() })
    expect(mount?.route.kind).toBe('home')
    await mount!.ready
    const home = host.querySelector('mn-garden-home')!
    await home.updateComplete
    expect(home.status).toBe('ready')
    expect(home.workspaces).toEqual([])
    const createButton = [...home.shadowRoot!.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Create graph'))!
    expect(createButton).toBeDefined()
    expect(createButton.disabled).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(startOnboarding).not.toHaveBeenCalled()
    expect(openGraph).not.toHaveBeenCalled()
    createButton.click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(startOnboarding).not.toHaveBeenCalled()
    expect(openGraph).not.toHaveBeenCalled()
  })

  it('waits for the catalog instead of treating an unresolved request as an empty account', async () => {
    let deliver!: (graphs: readonly GatewayGraphInfo[]) => void
    const pending = new Promise<readonly GatewayGraphInfo[]>(resolve => { deliver = resolve })
    const settled = vi.fn()
    const result = resolveHostedEntry({ location: new URL('https://app.test/'), loadGraphs: () => pending })
    void result.then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    deliver([catalog[2]])
    await expect(result).resolves.toEqual({ kind: 'graph', graphId: 'running' })
  })

  it.each([
    ['/', undefined, 'running'],
    ['/', 'stopped', 'stopped'],
    ['/', 'missing', 'running'],
    ['/?graph=stopped', 'running', 'stopped'],
    ['/?graph_id=stopped', 'running', 'stopped'],
    ['/g/stopped?doc=retained#block-1', 'running', 'stopped'],
    ['/g/stopped?graph=running', 'running', 'stopped'],
    ['/settings?graph=stopped', 'running', 'stopped'],
  ])('preserves existing selection at %s with stored %s', async (path, storedGraphId, graphId) => {
    await expect(resolveHostedEntry({
      location: new URL(path, 'https://app.test'),
      storedGraphId,
      loadGraphs: async () => catalog,
    })).resolves.toEqual({ kind: 'graph', graphId })
  })

  it.each([
    '/?graph=missing', '/?graph_id=missing', '/?graph=', '/?graph_id=',
    '/g/missing', '/g/%E0%A4%A', '/settings', '/?view=settings',
    '/?doc=existing', '/#existing-block',
  ])('does not replace explicit or malformed destination %s with Home', async path => {
    await expect(resolveHostedEntry({
      location: new URL(path, 'https://app.test'),
      loadGraphs: async () => [],
    })).rejects.toThrow(/not available|No Garden graphs|valid graph id/)
  })

  it('preserves a missing explicit graph refusal even when another graph exists', async () => {
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/?graph=missing'),
      loadGraphs: async () => catalog,
    })).rejects.toThrow('Graph "missing" is not available')
  })

  it.each(['/g/missing', '/g/%E0%A4%A'])('refuses explicit path %s instead of opening a different graph', async path => {
    await expect(resolveHostedEntry({
      location: new URL(path, 'https://app.test'),
      storedGraphId: 'stopped',
      loadGraphs: async () => catalog,
    })).rejects.toThrow(/not available|valid graph id/)
  })

  it('does not fetch or offer Home when the authentication token is unavailable', async () => {
    const { gateway, fetch } = directory([], 200, '')
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/'), loadGraphs: () => gateway.graphs(),
    })).rejects.toThrow('authentication token is unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends an undirected root with only Viewer graphs to Home, and opens a directed Viewer graph', async () => {
    // Graphs shared with everyone signed in appear as Viewer in every
    // catalog; they are not the account's own workspaces, so an undirected
    // root lands on Home. Asked for by name, a Viewer graph opens (read-only).
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/'),
      loadGraphs: async () => [catalog[1]],
    })).resolves.toMatchObject({ kind: 'home' })
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/?graph=viewer'),
      loadGraphs: async () => [catalog[1]],
    })).resolves.toEqual({ kind: 'graph', graphId: 'viewer' })
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/g/viewer'),
      loadGraphs: async () => [catalog[1]],
    })).resolves.toEqual({ kind: 'graph', graphId: 'viewer' })
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/?doc=d1'),
      storedGraphId: 'viewer',
      loadGraphs: async () => [catalog[1]],
    })).resolves.toEqual({ kind: 'graph', graphId: 'viewer' })
  })

  it.each([401, 403, 500])('does not turn an HTTP %s catalog refusal into Home', async status => {
    const { gateway } = directory({ message: 'Catalog unavailable' }, status)
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/'), loadGraphs: () => gateway.graphs(),
    })).rejects.toMatchObject({ name: 'GatewayHttpError', status })
  })

  it.each([null, {}, { graphs: [] }, { items: null }, [{ graphId: 'incomplete' }]])(
    'does not turn malformed catalog %j into Home', async body => {
      const { gateway } = directory(body)
      await expect(resolveHostedEntry({
        location: new URL('https://app.test/'), loadGraphs: () => gateway.graphs(),
      })).rejects.toThrow('Gateway GET /graphs')
    },
  )

  it('preserves the exact network failure', async () => {
    const error = new TypeError('Network failed')
    await expect(resolveHostedEntry({
      location: new URL('https://app.test/'),
      loadGraphs: async () => { throw error },
    })).rejects.toBe(error)
  })

  it('binds both hosted landing signup anchors to the current app and preserves a safe return target', async () => {
    const location = new URL('https://app.test/garden?returnTo=%2Fg%2Fshared%3Fdoc%3Dretained%23block-1')
    const host = document.createElement('div')
    document.body.append(host)
    const mount = mountOrganismAppRoute(host, {
      location,
      gardenAppHref: hostedSignUpLocation(location).href,
    })
    cleanups.push(() => { mount?.destroy(); host.remove() })
    await mount!.ready
    const landing = host.querySelector('garden-landing')!
    await landing.updateComplete
    const anchors = [...landing.shadowRoot!.querySelectorAll<HTMLAnchorElement>('a.btn-primary')]
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      const target = new URL(anchor.href)
      expect(target.origin).toBe('https://app.test')
      expect(target.pathname).toBe('/signup')
      expect(safeAuthReturnUrl(target)).toBe('/g/shared?doc=retained#block-1')
    }
  })

  it('retains the reusable landing default for hosts without an app override', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const mount = mountOrganismAppRoute(host, { location: new URL('https://example.test/garden') })
    cleanups.push(() => { mount?.destroy(); host.remove() })
    await mount!.ready
    const landing = host.querySelector('garden-landing')!
    await landing.updateComplete
    expect(landing.appHref).toBe('https://garden.sophia-labs.com/app')
  })

  it('retains default root auth return behavior for existing accounts', () => {
    expect(hostedSignUpLocation(new URL('https://app.test/garden')).href).toBe('https://app.test/signup')
    expect(safeAuthReturnUrl(new URL('https://app.test/signin'))).toBe('/')
    expect(safeAuthReturnUrl(new URL('https://app.test/signup'))).toBe('/')
  })

  it.each([
    'https://elsewhere.test/g', '//elsewhere.test/g', '/\\elsewhere.test/g',
    'javascript:alert(1)', 'relative/path', '/safe\u0000bad',
  ])('refuses unsafe signup/auth return target %j', returnTo => {
    const location = new URL('https://app.test/garden')
    location.searchParams.set('returnTo', returnTo)
    const signup = hostedSignUpLocation(location)
    expect(signup.href).toBe('https://app.test/signup')
    expect(safeAuthReturnUrl(location)).toBe('/')
  })
})
