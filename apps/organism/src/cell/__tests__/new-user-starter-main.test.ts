import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { redeemShareLinkFromLocation, showShareLinkLanding } from '../share-link-redemption.js'
import { detectOrganismAppRoute } from '../app-routes.js'
import { gardenGraphLocation } from '../garden-home-route.js'
import { mountGardenHomeRoute } from '../garden-home-route.js'
import { resolveHostedEntry } from '../hosted-entry-route.js'
import { confirmedStarterPreference, type StarterStartupPreference } from '../new-user-starter-startup.js'
import type { GatewayGraphInfo } from '../gateway-transport.js'
import { graphRefOwner, localGraphKey, parseLocalGraphKey } from '@shrubbery/source/graph-ref'

// Execute actual caller functions with bounded synthetic dependencies, without
// importing main's eager app bootstrap or touching browser/account state.
const source = ts.createSourceFile('main.ts', readFileSync(resolve('src/main.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
function actualFunction(name: string, context: Record<string, unknown>): (...args: unknown[]) => Promise<unknown> {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name)!
  const script = ts.transpileModule(`globalThis.invoke = ${node.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(script, context)
  return context.invoke as (...args: unknown[]) => Promise<unknown>
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  return { promise: new Promise<T>((settle, refuse) => { resolve = settle; reject = refuse }), resolve: (value: T) => resolve(value), reject: (error: Error) => reject(error) }
}
const workspace = { owner: 'user:synthetic-native', graphId: 'starter', generation: 4 }
const row: GatewayGraphInfo = { ...workspace, title: 'My Garden', role: 'owner', cellState: 'stopped' }
const oldRow = { ...row, graphId: 'existing' }
function selector(options: { graphs?: readonly GatewayGraphInfo[]; stored?: string; path?: string } = {}) {
  let current = true
  const preference: StarterStartupPreference = { workspace, isCurrent: () => current }
  const context = {
    window: { location: new URL(options.path ?? '/', 'https://app.test') },
    refreshHostedGraphs: vi.fn(async () => options.graphs ?? [oldRow, row]),
    storedHostedGraphId: () => options.stored ?? '',
    confirmedStarterPreference, resolveHostedEntry,
    cellGraphId: { value: 'unchanged' }, currentGraphId: 'unchanged', persistHostedGraphSelection: vi.fn(),
    // main's graph-key helpers, over the real graph-ref functions: the signed-in account owns the starter.
    hostedSelf: () => 'synthetic-native',
    hostedGraphKey: (graph: GatewayGraphInfo) => localGraphKey({ owner: graphRefOwner(graph.owner, 'synthetic-native'), graphId: graph.graphId }, 'synthetic-native'),
    parseLocalGraphKey,
    currentGraphOwner: null as string | null,
    deploymentContract: null,
    hostedContractForOwner: vi.fn(() => null),
  }
  const invoke = actualFunction('selectHostedEntry', context)
  return { context, preference, invoke: () => invoke(preference), stale: () => { current = false } }
}

describe('actual hosted starter selection caller', () => {
  it('waits for a fresh exact directory row before preferring the starter over ordinary fallback', async () => {
    const test = selector()
    const directory = deferred<readonly GatewayGraphInfo[]>()
    test.context.refreshHostedGraphs.mockImplementation(() => directory.promise)
    const pending = test.invoke()
    expect(test.context.persistHostedGraphSelection).not.toHaveBeenCalled()
    directory.resolve([oldRow, row])
    await expect(pending).resolves.toEqual({ kind: 'graph', graphId: 'starter' })
    expect(test.context.refreshHostedGraphs).toHaveBeenCalledExactlyOnceWith(false)
    expect(test.context.persistHostedGraphSelection).toHaveBeenCalledExactlyOnceWith('starter')
  })

  it('does not let a stale captured preference fall through to normal selection after a pending directory read', async () => {
    const test = selector({ graphs: [row] })
    const directory = deferred<readonly GatewayGraphInfo[]>()
    test.context.refreshHostedGraphs.mockImplementation(() => directory.promise)
    const pending = test.invoke()
    test.stale()
    directory.resolve([row])
    await expect(pending).rejects.toThrow('changed')
    expect(test.context.persistHostedGraphSelection).not.toHaveBeenCalled()
    expect(test.context.currentGraphId).toBe('unchanged')
  })

  it.each([
    { stored: 'existing', path: '/', expected: 'existing' },
    { stored: '', path: '/g/existing', expected: 'existing' },
    { stored: '', path: '/?graph=existing&doc=exact', expected: 'existing' },
  ])('preserves a deliberate existing selection: %j', async options => {
    const test = selector(options)
    await expect(test.invoke()).resolves.toEqual({ kind: 'graph', graphId: options.expected })
    expect(test.context.persistHostedGraphSelection).toHaveBeenCalledExactlyOnceWith(options.expected)
  })

  it.each([undefined, 5])('does not promote an unconfirmed generation %j', async generation => {
    const test = selector({ graphs: [oldRow, { ...row, generation }] })
    await expect(test.invoke()).resolves.toEqual({ kind: 'graph', graphId: 'existing' })
  })

  it('preserves directory refusal instead of navigating from a retained starter result', async () => {
    const test = selector()
    test.context.refreshHostedGraphs.mockRejectedValue(new Error('directory unavailable'))
    await expect(test.invoke()).rejects.toThrow('directory unavailable')
    expect(test.context.persistHostedGraphSelection).not.toHaveBeenCalled()
  })
})

describe('actual guarded directory publication and completion consumers', () => {
  function directoryCaller() {
    let token = 'captured'
    const gateway = { adoptGraphDirectory: vi.fn(), bindGraphOwner: vi.fn() }
    const contract = { auth: { userId: () => 'native', token: () => token, isAuthenticated: () => true }, gateway,
      sourceMirror: { openGraphLifecycle: vi.fn(async () => ({ records: () => [] })), rest: { graphs: vi.fn(async () => []) } } }
    const context = {
      hostedGatewayContract: contract, deploymentConfig: { mode: 'hosted', gatewayBaseUrl: 'https://gateway.test' },
      hostedGraphs: [oldRow], hostedGraphsStatus: 'ready', hostedGraphsError: '', store: null,
      hostedDirectoryReadId: 0,
      readCapturedHostedDirectory: vi.fn(async () => [row]), mergeHostedWorkspaceCreations: (rows: unknown) => rows,
      rerenderCurrentSource: vi.fn(),
    }
    return { context, contract, invoke: actualFunction('refreshHostedGraphs', context), switchToken: () => { token = 'new-token' } }
  }

  it('adopts a complete current directory once without making per-row permanent bindings', async () => {
    const test = directoryCaller()
    await test.invoke(false)
    expect(test.contract.gateway.adoptGraphDirectory).toHaveBeenCalledExactlyOnceWith([row])
    expect(test.contract.gateway.bindGraphOwner).not.toHaveBeenCalled()
    expect(test.context.hostedGraphs).toEqual([row])
  })

  it.each(['read', 'lifecycle'])('does not adopt or publish an old-account catalog after a pending %s', async phase => {
    const test = directoryCaller()
    const read = deferred<GatewayGraphInfo[]>()
    const lifecycle = deferred<{ records: () => never[] }>()
    if (phase === 'read') test.context.readCapturedHostedDirectory.mockImplementation(() => read.promise)
    else test.contract.sourceMirror.openGraphLifecycle.mockImplementation(() => lifecycle.promise)
    const pending = test.invoke(false)
    const refused = expect(pending).rejects.toThrow('changed')
    if (phase === 'lifecycle') await vi.waitFor(() => expect(test.contract.sourceMirror.openGraphLifecycle).toHaveBeenCalledTimes(1))
    test.switchToken()
    read.resolve([row]); lifecycle.resolve({ records: () => [] })
    await refused
    expect(test.contract.gateway.adoptGraphDirectory).not.toHaveBeenCalled()
    expect(test.contract.gateway.bindGraphOwner).not.toHaveBeenCalled()
    expect(test.context.hostedGraphs).toEqual([oldRow])
    expect(test.contract.sourceMirror.rest.graphs).not.toHaveBeenCalled()
  })

  it.each(['success', 'error'])('does not adopt or publish an older same-account directory %s', async outcome => {
    const test = directoryCaller()
    const old = deferred<GatewayGraphInfo[]>()
    test.context.readCapturedHostedDirectory.mockImplementationOnce(() => old.promise)
    const first = test.invoke(false)
    const refused = expect(first).rejects.toThrow('superseded')
    await test.invoke(false)
    if (outcome === 'success') old.resolve([oldRow])
    else old.reject(new Error('old network failure'))
    await refused
    expect(test.context.hostedGraphs).toEqual([row])
    expect(test.context.hostedGraphsStatus).toBe('ready')
    expect(test.contract.gateway.adoptGraphDirectory).toHaveBeenCalledExactlyOnceWith([row])
    expect(test.contract.sourceMirror.rest.graphs).not.toHaveBeenCalled()
  })

  it.each(['success', 'error'])('does not let an older mounted Home load %s replace a completion refresh', async outcome => {
    const old = deferred<{ account: { userId: string; displayName: string }; workspaces: GatewayGraphInfo[] }>()
    const latest = { account: { userId: 'native', displayName: 'Synthetic' }, workspaces: [row] }
    const host = document.createElement('div')
    document.body.append(host)
    const load = vi.fn(async () => latest).mockImplementationOnce(() => old.promise)
    const mount = mountGardenHomeRoute(host, { load, openGraph: vi.fn() })
    const page = host.querySelector('mn-garden-home')!
    page.dispatchEvent(new CustomEvent('mn-garden-home-refresh'))
    await vi.waitFor(() => expect(page.workspaces).toEqual([row]))
    if (outcome === 'success') old.resolve({ ...latest, workspaces: [] })
    else old.reject(new Error('old error'))
    await mount.ready
    expect(page.status).toBe('ready')
    expect(page.error).toBe('')
    expect(page.workspaces).toEqual([row])
    mount.destroy(); host.remove()
  })

  it('updates a mounted Home through its real existing refresh intent after slow completion, without navigation or seeding', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const load = vi.fn(async () => ({ account: { userId: 'native', displayName: 'Synthetic' }, workspaces: [] as GatewayGraphInfo[] }))
    const openGraph = vi.fn()
    const mount = mountGardenHomeRoute(host, { load, openGraph })
    await mount.ready
    const completion = deferred<unknown>()
    const context = { hostedStarterRunId: 1, hostEl: host, CustomEvent, refreshHostedGraphs: vi.fn(async () => []) }
    const invoke = actualFunction('refreshAfterHostedStarter', context)
    invoke({ initial: Promise.resolve(null), done: completion.promise, isCurrent: () => true }, 1)
    load.mockResolvedValue({ account: { userId: 'native', displayName: 'Synthetic' }, workspaces: [row] })
    completion.resolve({ status: 'client-observed-complete', workspace })
    await vi.waitFor(() => expect(host.querySelector('mn-garden-home')!.workspaces).toEqual([row]))
    expect(load).toHaveBeenCalledTimes(2)
    expect(openGraph).not.toHaveBeenCalled()
    expect(context.refreshHostedGraphs).not.toHaveBeenCalled()
    mount.destroy(); host.remove()
  })

  it.each(['stale-session', 'old-run', 'disabled', 'already-selected'])('does not refresh on %s completion', async reason => {
    const host = document.createElement('div')
    const refresh = vi.fn(async () => [])
    const context = { hostedStarterRunId: reason === 'old-run' ? 2 : 1, hostEl: host, CustomEvent, refreshHostedGraphs: refresh }
    actualFunction('refreshAfterHostedStarter', context)({
      initial: Promise.resolve(reason === 'already-selected' ? { workspace } : null),
      done: Promise.resolve(reason === 'disabled' ? { status: 'unavailable', code: 'starter_disabled' } : { status: 'attention', workspace }),
      isCurrent: () => reason !== 'stale-session',
    }, 1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(refresh).not.toHaveBeenCalled()
  })
})

function bootFixture(path = '/', authenticated = true) {
  const location = new URL(path, 'https://app.test')
  const auth = { isAuthenticated: () => authenticated }
  const initial = deferred<StarterStartupPreference | null>()
  const handle = { initial: initial.promise, done: Promise.resolve({ status: 'not-applicable', reason: 'old' }), isCurrent: () => true, cancel: vi.fn() }
  const context = {
    // The hosted build: bootOrganism's self-host branch (main.ts `SELF_HOST`) is off.
    SELF_HOST: false,
    URL, URLSearchParams, applyCurrent: vi.fn(), gardenGraphLocation,
    window: { location, localStorage: { getItem: () => null, setItem: vi.fn() }, history: { state: null, replaceState: vi.fn() } },
    document: { body: { dataset: {} }, title: '' }, cellGraphId: { value: '' }, currentGraphId: '',
    sourceSelect: { value: '' }, cellControls: { hidden: true },
    bootstrapTauriLocalCell: vi.fn(async (): Promise<unknown> => null), bootPublicShellRoute: vi.fn(() => false),
    deploymentConfig: { mode: 'hosted', gatewayBaseUrl: 'https://gateway.test', cognito: { region: 'test', clientId: 'synthetic' } },
    deploymentContract: null, hostedGatewayContract: {}, hostedAuthSession: auth,
    hostedStarterStartup: null as unknown, hostedStarterRunId: 0,
    starterStartupNotice: { show: vi.fn(), destroy: vi.fn() },
    prepareHostedDeployment: vi.fn(async () => {}), detectOrganismAppRoute,
    signInLocation: (returnTo: string) => new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, location),
    bootOrganismAppRoute: vi.fn((_location?: URL) => true), settingsCellGraph: () => null,
    startHostedStarter: vi.fn((_options: unknown) => handle), selectHostedEntry: vi.fn(async () => ({ kind: 'graph', graphId: 'selected' })),
    refreshAfterHostedStarter: vi.fn(),
    startCellMode: vi.fn(), ok: vi.fn(), err: vi.fn(), loadPreset: vi.fn(),
    // The real share-link landing: with no `#share=` fragment it is a no-op.
    redeemShareLinkFromLocation, showShareLinkLanding,
    stopHostedStarterStartup: () => {},
  }
  context.stopHostedStarterStartup = actualFunction('stopHostedStarterStartup', context) as () => void
  const invoke = actualFunction('bootOrganism', context)
  return { context, initial, handle, invoke, signOut: () => { authenticated = false } }
}

describe('actual main hosted starter startup join', () => {
  it.each(['/sign-in', '/sign-up', '/landing', '/privacy'])('does not start a starter on a public/auth destination %s', async path => {
    const test = bootFixture(path)
    // /landing and /privacy represent the public route kinds independently of
    // route naming; exact deployment route matching is tested by app-routes.
    if (path === '/landing' || path === '/privacy') test.context.detectOrganismAppRoute = () => ({ kind: path === '/landing' ? 'landing' : 'legal' } as ReturnType<typeof detectOrganismAppRoute>)
    await test.invoke()
    expect(test.context.startHostedStarter).not.toHaveBeenCalled()
  })

  it('does not start a starter before authentication', async () => {
    const test = bootFixture('/g/existing?doc=exact', false)
    await test.invoke()
    expect(test.context.startHostedStarter).not.toHaveBeenCalled()
    expect(test.context.selectHostedEntry).not.toHaveBeenCalled()
    expect(test.context.bootOrganismAppRoute.mock.calls[0][0]!.searchParams.get('returnTo')).toBe('/g/existing?doc=exact')
  })

  it('does not start hosted onboarding inside the native Tauri branch', async () => {
    const test = bootFixture()
    test.context.bootstrapTauriLocalCell.mockResolvedValue({ contract: {}, graphId: 'native', seededUxConfig: false })
    await test.invoke()
    expect(test.context.startHostedStarter).not.toHaveBeenCalled()
    expect(test.context.prepareHostedDeployment).not.toHaveBeenCalled()
  })

  it('keeps explicit Home in Home and does not wait for the background done result', async () => {
    const test = bootFixture('/home')
    test.initial.resolve(null)
    await test.invoke()
    expect(test.context.startHostedStarter).toHaveBeenCalledTimes(1)
    expect(test.context.selectHostedEntry).not.toHaveBeenCalled()
    expect(test.context.bootOrganismAppRoute).toHaveBeenCalledTimes(1)
  })

  it('passes the bounded initial result to the real selection seam and binds notice/host lifetime', async () => {
    const test = bootFixture()
    const pending = test.invoke()
    await vi.waitFor(() => expect(test.context.startHostedStarter).toHaveBeenCalledTimes(1))
    const captured = test.context.startHostedStarter.mock.calls[0][0] as unknown as { isHostCurrent(): boolean; onNotice(value: unknown): void }
    expect(test.context.selectHostedEntry).not.toHaveBeenCalled()
    const preference = { workspace, isCurrent: () => true }
    test.initial.resolve(preference)
    await pending
    expect(test.context.selectHostedEntry).toHaveBeenCalledExactlyOnceWith(preference)
    captured.onNotice({ kind: 'attention' })
    expect(test.context.starterStartupNotice.show).toHaveBeenCalledTimes(1)
    test.context.stopHostedStarterStartup()
    captured.onNotice(null)
    expect(test.context.starterStartupNotice.show).toHaveBeenCalledTimes(1)
    expect(test.handle.cancel).toHaveBeenCalledTimes(1)
    test.context.hostedGatewayContract = { replaced: true }
    expect(captured.isHostCurrent()).toBe(false)
  })

  it('arms completion refresh only after initial route selection, so it cannot supersede that awaited directory read', async () => {
    const test = bootFixture()
    const selected = deferred<{ kind: string; graphId: string }>()
    test.context.selectHostedEntry.mockImplementation(() => selected.promise)
    test.initial.resolve(null)
    const pending = test.invoke()
    await vi.waitFor(() => expect(test.context.selectHostedEntry).toHaveBeenCalledTimes(1))
    expect(test.context.refreshAfterHostedStarter).not.toHaveBeenCalled()
    selected.resolve({ kind: 'graph', graphId: 'selected' })
    await pending
    expect(test.context.refreshAfterHostedStarter).toHaveBeenCalledExactlyOnceWith(test.handle, test.context.hostedStarterRunId)
  })

  it('signs out during the initial wait without entering a workspace', async () => {
    const test = bootFixture()
    const pending = test.invoke()
    await vi.waitFor(() => expect(test.context.startHostedStarter).toHaveBeenCalledTimes(1))
    test.signOut()
    test.initial.resolve(null)
    await pending
    expect(test.context.selectHostedEntry).not.toHaveBeenCalled()
    expect(test.context.bootOrganismAppRoute).toHaveBeenCalledTimes(1)
  })
})
