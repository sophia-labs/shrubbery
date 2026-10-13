import { describe, expect, it } from 'vitest'
import {
  CLOUDFLARE_ACCESS_LOGOUT_PATH,
  SELF_HOST_KEY_STORAGE_KEY,
  SelfHostSettingsService,
  claimSelfHostKey,
  isPermissionRefusal,
  keyFromPastedText,
  parseSelfHostDescriptor,
  selfHostBuild,
  selfHostTransport,
  type SelfHostSession,
} from '../self-host.js'
import { LoopbackHttpError, McpError } from '../loopback-mcp.js'

function freshStorage(): Storage {
  window.localStorage.removeItem(SELF_HOST_KEY_STORAGE_KEY)
  return window.localStorage
}

function session(auth: 'cloudflare-access' | 'key', email: string | null, exits: string[]): SelfHostSession {
  return {
    descriptor: { kind: 'gardend-self-host', version: '0.1.2', auth, user: email ? { email } : null },
    origin: 'http://127.0.0.1:7091',
    auth,
    token: auth === 'key' ? 'k-123' : undefined,
    userId: email ?? 'garden-self-host',
    email,
    signOut: () => { exits.push(auth === 'cloudflare-access' ? CLOUDFLARE_ACCESS_LOGOUT_PATH : '/') },
  }
}

describe('self-host build flavor', () => {
  it('is on only for VITE_SHRUBBERY_SELF_HOST=1, so the hosted build never asks for /self-host.json', () => {
    expect(selfHostBuild({ VITE_SHRUBBERY_SELF_HOST: '1' })).toBe(true)
    expect(selfHostBuild({ VITE_SHRUBBERY_SELF_HOST: ' 1 ' })).toBe(true)
    expect(selfHostBuild({ VITE_SHRUBBERY_SELF_HOST: '0' })).toBe(false)
    expect(selfHostBuild({ VITE_SHRUBBERY_SELF_HOST: 'true' })).toBe(false)
    expect(selfHostBuild({ VITE_GATEWAY_BASE_URL: 'https://api.sirin.sophia-labs.com' })).toBe(false)
    expect(selfHostBuild(undefined)).toBe(false)
  })

  it('reads the /self-host.json contract and refuses anything else', () => {
    expect(parseSelfHostDescriptor({ kind: 'gardend-self-host', version: '0.1.2', auth: 'key', user: null }))
      .toEqual({ kind: 'gardend-self-host', version: '0.1.2', auth: 'key', user: null })
    expect(parseSelfHostDescriptor({
      kind: 'gardend-self-host', version: '0.1.2', auth: 'cloudflare-access', user: { email: ' lucy@example.com ' },
    }).user).toEqual({ email: 'lucy@example.com' })
    // An SPA fallback answering index.html as JSON would not get this far, but a stray object must not either.
    expect(() => parseSelfHostDescriptor({ auth: 'key' })).toThrow(/not a gardend self-host descriptor/)
    expect(() => parseSelfHostDescriptor({ kind: 'gardend-self-host', auth: 'cookie' })).toThrow(/unknown auth mode/)
    expect(() => parseSelfHostDescriptor([])).toThrow(/not a JSON object/)
  })

  it('talks to gardend at the root of this origin, with the bearer only when there is a key', () => {
    expect(selfHostTransport('https://sophia.example.com/', undefined)).toEqual({
      mcpUrl: 'https://sophia.example.com/mcp',
      healthUrl: 'https://sophia.example.com/health',
      transport: 'fetch',
    })
    expect(selfHostTransport('http://127.0.0.1:7091', 'k-123').token).toBe('k-123')
  })
})

describe('a member\'s refusals', () => {
  it('recognises gardend refusing a scope, and nothing else', () => {
    // What gardend answers a member (an Access login outside the admin list) for rdf_load and create_graph.
    expect(isPermissionRefusal(new McpError('MCP error for rdf_load: loopback token missing required scope rdf.load', -32003))).toBe(true)
    expect(isPermissionRefusal(new McpError('MCP error for create_graph: loopback token missing required scope graphs.write', -32003))).toBe(true)
    expect(isPermissionRefusal(new LoopbackHttpError('PUT', '/graphs/g/ui/custom-css', 403, 'forbidden'))).toBe(true)
    expect(isPermissionRefusal(new McpError('MCP HTTP 500 for rdf_load: boom', 500))).toBe(false)
    expect(isPermissionRefusal(new Error('network down'))).toBe(false)
    expect(isPermissionRefusal('missing required scope')).toBe(false)
  })
})

describe('the open-URL key', () => {
  it('takes #key= on first load, stores it, and strips it from the address', () => {
    const storage = freshStorage()
    const replaced: string[] = []
    const key = claimSelfHostKey(new URL('http://127.0.0.1:7091/#key=abc%2B123'), storage, url => replaced.push(url))
    expect(key).toBe('abc+123')
    expect(storage.getItem(SELF_HOST_KEY_STORAGE_KEY)).toBe('abc+123')
    expect(replaced).toEqual(['/'])
  })

  it('keeps the rest of the fragment and the query', () => {
    const storage = freshStorage()
    const replaced: string[] = []
    claimSelfHostKey(new URL('http://127.0.0.1:7091/g/garden?r=wires#key=abc&evidence=c1'), storage, url => replaced.push(url))
    expect(replaced).toEqual(['/g/garden?r=wires#evidence=c1'])
  })

  it('uses the stored key on later loads and leaves other fragments alone', () => {
    const storage = freshStorage()
    storage.setItem(SELF_HOST_KEY_STORAGE_KEY, 'stored-key')
    const replaced: string[] = []
    expect(claimSelfHostKey(new URL('http://127.0.0.1:7091/#/ops-health'), storage, url => replaced.push(url))).toBe('stored-key')
    expect(replaced).toEqual([])
  })

  it('has no key when neither the address nor the browser holds one', () => {
    expect(claimSelfHostKey(new URL('http://127.0.0.1:7091/'), freshStorage(), () => {})).toBeNull()
  })

  it('accepts the pasted link, the fragment, or the bare key', () => {
    expect(keyFromPastedText('http://127.0.0.1:7091/#key=abc')).toBe('abc')
    expect(keyFromPastedText('#key=abc')).toBe('abc')
    expect(keyFromPastedText('key=abc')).toBe('abc')
    expect(keyFromPastedText('  abc  ')).toBe('abc')
    expect(keyFromPastedText('http://127.0.0.1:7091/')).toBeNull()
    expect(keyFromPastedText('not a key')).toBeNull()
    expect(keyFromPastedText('')).toBeNull()
  })
})

describe('Settings over a self-host', () => {
  it('shows the Access email and signs out through Cloudflare Access', async () => {
    const exits: string[] = []
    const service = new SelfHostSettingsService(
      { runtimeMode: 'local', storage: null, userName: 'lucy@example.com' },
      session('cloudflare-access', 'lucy@example.com', exits),
    )
    const snapshot = await service.load()
    expect(snapshot.userEmail).toBe('lucy@example.com')
    const account = snapshot.sections.find(section => section.id === 'account')!
    expect(account.metrics?.find(metric => metric.id === 'identity')?.value).toBe('lucy@example.com')
    expect(account.metrics?.find(metric => metric.id === 'sign-in')?.value).toBe('Cloudflare Access')
    expect(account.actions?.map(action => action.label)).toEqual(['Sign out'])
    // No hosted surfaces: no billing, no usage, no provider keys.
    expect(snapshot.sections.map(section => section.id)).not.toContain('billing')
    expect(snapshot.sections.map(section => section.id)).not.toContain('usage')
    await service.action({ sectionId: 'account', actionId: 'sign-out' })
    expect(exits).toEqual([CLOUDFLARE_ACCESS_LOGOUT_PATH])
  })

  it('offers to forget the key in key mode', async () => {
    const exits: string[] = []
    const service = new SelfHostSettingsService({ runtimeMode: 'local', storage: null }, session('key', null, exits))
    const account = (await service.load()).sections.find(section => section.id === 'account')!
    expect(account.actions?.map(action => action.label)).toEqual(['Forget this key'])
    await service.action({ sectionId: 'account', actionId: 'sign-out' })
    expect(exits).toEqual(['/'])
  })
})
