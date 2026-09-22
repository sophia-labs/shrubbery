/**
 * Real multi-context presence lifecycle journey.
 *
 * Owns a fresh gardend process and three independent Chromium contexts. The
 * browser page disables y-websocket BroadcastChannel, so every observation
 * crosses gardend's WebSocket room. This is intentionally a behavioral proof,
 * not a DOM fixture: different users, same-user tabs, cursor/selection, normal
 * and hard close, reconnect, document/graph switch, and rapid reload.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright'
import { createServer as createViteServer, type ProxyOptions, type ViteDevServer } from 'vite'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

interface PersonSnapshot {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly humanId: string | null
  readonly sessionCount: number
  readonly deviceCount: number
  readonly isSelf: boolean
  readonly clientIds: readonly string[]
  readonly type: 'human' | 'agent'
  readonly sessions: ReadonlyArray<{
    readonly clientId: string
    readonly deviceId: string | null
    readonly hasCursor: boolean
    readonly isLocal: boolean
  }>
}

interface PresenceSnapshot {
  readonly room: { readonly graphId: string; readonly documentId: string } | null
  readonly status: string
  readonly synced: boolean
  readonly people: readonly PersonSnapshot[]
  readonly raw: ReadonlyArray<{
    readonly awarenessClientId: number
    readonly humanId: string | null
    readonly clientId: string | null
    readonly connectionEpoch: number | null
  }>
  readonly text: string
}

interface Actor {
  readonly label: string
  readonly context: BrowserContext
  readonly page: Page
}

async function waitForHarnessApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & {
    __presenceHarness?: unknown
  }).__presenceHarness), undefined, { timeout: 20_000 })
}

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphA = `presence-a-${randomUUID()}`
const graphB = `presence-b-${randomUUID()}`
const docA = 'shared-document'
const docB = 'other-document'
const marker = `presence cursor ${randomUUID()}`
const pageErrors: string[] = []
const consoleErrors: string[] = []
const verboseDiagnostics = process.env.SHRUBBERY_BROWSER_LOGS === '1'

const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const seedNt = readFileSync(seedPath, 'utf8')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`presence-browser-harness assertion failed: ${message}`)
}

const sleep = (ms: number): Promise<void> => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolveListen)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve Vite port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => {
    socket.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

function chromeExecutable(): string | undefined {
  const explicit = process.env.SHRUBBERY_CHROME_EXECUTABLE
    ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    assert(existsSync(explicit), `configured Chrome executable does not exist: ${explicit}`)
    return explicit
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'linux'
      ? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      : []
  return candidates.find(candidate => existsSync(candidate))
}

function liveCellProxy(cell: GardendCell): Record<string, ProxyOptions> {
  return {
    '/cell': {
      target: cell.apiUrl,
      changeOrigin: true,
      ws: true,
      rewrite: path => path.replace(/^\/cell/, ''),
      configure(proxy) {
        proxy.on('proxyReq', request => {
          request.setHeader('Authorization', `Bearer ${cell.token}`)
        })
        proxy.on('proxyReqWs', (request: { setHeader(name: string, value: string): void }) => {
          request.setHeader('Authorization', `Bearer ${cell.token}`)
          request.setHeader('Origin', 'http://127.0.0.1')
        })
      },
    },
  }
}

async function captureActor(
  browser: Browser,
  baseUrl: string,
  label: string,
  query: Record<string, string>,
): Promise<Actor> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 } })
  const page = await context.newPage()
  page.on('pageerror', error => {
    const detail = `${label}: ${error.stack ?? error.message}`
    pageErrors.push(detail)
    if (verboseDiagnostics) console.error(`[presence-pageerror] ${detail}`)
  })
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'assert') {
      const detail = `${label}: ${message.text()}`
      consoleErrors.push(detail)
      if (verboseDiagnostics) console.error(`[presence-console] ${detail}`)
    }
  })
  page.on('websocket', socket => {
    if (!verboseDiagnostics) return
    console.error(`[presence-websocket] ${label} opened ${socket.url()}`)
    socket.on('socketerror', error => console.error(`[presence-websocket] ${label} error ${error}`))
    socket.on('close', () => console.error(`[presence-websocket] ${label} closed ${socket.url()}`))
  })
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  const url = new URL('/presence-browser-harness.html', baseUrl)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  await page.goto(url.href, { waitUntil: 'commit' })
  await waitForHarnessApi(page)
  await waitForSnapshot(page, snapshot => snapshot.synced, `${label} initial sync`, 20_000)
  return { label, context, page }
}

async function snapshot(page: Page): Promise<PresenceSnapshot> {
  return page.evaluate(() => {
    const harness = (window as Window & {
      __presenceHarness?: { snapshot(): PresenceSnapshot }
    }).__presenceHarness
    if (!harness) throw new Error('presence harness API is unavailable')
    return harness.snapshot()
  })
}

async function waitForSnapshot(
  page: Page,
  predicate: (value: PresenceSnapshot) => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<{ snapshot: PresenceSnapshot; elapsedMs: number }> {
  const started = Date.now()
  let latest: PresenceSnapshot | null = null
  while (Date.now() - started < timeoutMs) {
    latest = await snapshot(page)
    if (predicate(latest)) return { snapshot: latest, elapsedMs: Date.now() - started }
    await sleep(40)
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms; latest=${JSON.stringify(latest)}`)
}

function person(value: PresenceSnapshot, humanId: string): PersonSnapshot | undefined {
  return value.people.find(candidate => candidate.humanId === humanId)
}

async function expectPeople(
  page: Page,
  expected: Readonly<Record<string, number>>,
  label: string,
  timeoutMs = 5_000,
): Promise<{ snapshot: PresenceSnapshot; elapsedMs: number }> {
  return waitForSnapshot(page, value => {
    if (value.people.length !== Object.keys(expected).length) return false
    return Object.entries(expected).every(([humanId, sessions]) =>
      person(value, humanId)?.sessionCount === sessions)
  }, label, timeoutMs)
}

async function call(page: Page, method: string, argument?: unknown): Promise<unknown> {
  return page.evaluate(async ({ methodName, value }) => {
    const harness = (window as Window & {
      __presenceHarness?: Record<string, (...args: unknown[]) => unknown>
    }).__presenceHarness
    if (!harness || typeof harness[methodName] !== 'function') {
      throw new Error(`presence harness method unavailable: ${methodName}`)
    }
    return harness[methodName](...(value === undefined ? [] : [value]))
  }, { methodName: method, value: argument })
}

const binary = resolveGardendBin()
assert(existsSync(binary), `gardend binary not found at ${binary}; set GARDEN_BIN to the patched build`)

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Browser | null = null
const actors: Actor[] = []

try {
  cell = await spawnGardend({ bin: binary, readyTimeoutMs: 30_000 })
  await createGraphAndSeedUxConfig(cell, graphA, seedNt, 'Presence lifecycle graph A')
  await createGraphAndSeedUxConfig(cell, graphB, seedNt, 'Presence lifecycle graph B')
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  for (const [graphId, documentId, title] of [
    [graphA, docA, 'Shared presence document'],
    [graphA, docB, 'Presence document-switch target'],
    [graphA, 'duplicate-tab-document', 'Duplicated-tab presence document'],
    [graphB, docA, 'Presence graph-switch target'],
  ] as const) {
    await mcp.toolsCall('create_document', { graphId, documentId, title })
  }

  const port = await freePort()
  vite = await createViteServer({
    root: appDir,
    configFile: false,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
      proxy: liveCellProxy(cell),
    },
    logLevel: 'warn',
  })
  await vite.listen()
  const baseUrl = `http://127.0.0.1:${port}`

  const executablePath = chromeExecutable()
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })

  const veraA = await captureActor(browser, baseUrl, 'vera-tab-a', {
    graph: graphA, doc: docA, human: 'vera', name: 'Vera', device: 'vera-device', client: 'vera-tab-a',
  })
  actors.push(veraA)
  const veraB = await captureActor(browser, baseUrl, 'vera-tab-b', {
    graph: graphA, doc: docA, human: 'vera', name: 'Vera', device: 'vera-device', client: 'vera-tab-b',
  })
  actors.push(veraB)
  const ada = await captureActor(browser, baseUrl, 'ada-tab-a', {
    graph: graphA, doc: docA, human: 'ada', name: 'Ada', device: 'ada-device', client: 'ada-tab-a',
  })
  actors.push(ada)

  const initial = await expectPeople(veraA.page, { vera: 2, ada: 1 }, 'different users + same-user tabs')
  assert(person(initial.snapshot, 'vera')?.isSelf === true, 'Vera group is not marked self in Vera tab')
  assert(person(initial.snapshot, 'vera')?.deviceCount === 1, 'same-device Vera tabs were not explained')
  assert(person(initial.snapshot, 'vera')?.clientIds.join(',') === 'vera-tab-a,vera-tab-b', 'tab identities lost')
  const groupedAvatar = veraA.page.locator('[data-presence-id="human:vera"]')
  await groupedAvatar.waitFor({ state: 'visible' })
  assert(await groupedAvatar.getAttribute('data-session-count') === '2', 'UI did not expose grouped tab count')
  assert((await groupedAvatar.getAttribute('title'))?.includes('2 tabs') === true, 'UI hover did not explain tabs')

  // Controlled self inspector: identity/type stay immutable, while the real
  // awareness name + color are editable and visible to a different user.
  await groupedAvatar.click()
  const selfInspector = veraA.page.locator('[data-presence-inspector="human:vera"]')
  await selfInspector.waitFor({ state: 'visible' })
  assert((await selfInspector.textContent())?.includes('2 live tabs across one device') === true,
    'same-human inspector did not explain grouped tabs/devices')
  assert((await selfInspector.textContent())?.includes('(you, other tab)') === true,
    'same-human inspector did not identify the other local tab')
  const selfName = selfInspector.locator('[data-presence-name]')
  await selfName.fill('Vera Prime')
  await selfName.press('Enter')
  await waitForSnapshot(ada.page, value => person(value, 'vera')?.name === 'Vera Prime',
    'remote self-name awareness update')
  await selfInspector.locator('[data-presence-color="#7c3aed"]').click()
  await waitForSnapshot(ada.page, value => person(value, 'vera')?.color === '#7c3aed',
    'remote self-color awareness update')
  await selfInspector.locator('.presence-inspector-close').click()

  // Real collaborative editor interaction and cursor label.
  await veraB.page.bringToFront()
  await call(veraB.page, 'insertText', marker)
  await waitForSnapshot(veraA.page, value => value.text.includes(marker), 'remote text convergence', 10_000)
  await call(veraB.page, 'focusSelection')
  await veraA.page.bringToFront()
  const remoteCursor = veraA.page.locator('.ProseMirror-yjs-cursor > div', { hasText: 'Vera' })
  await remoteCursor.waitFor({ state: 'attached', timeout: 10_000 })

  // Ada follows the exact Vera tab that owns the published cursor. The DOM key
  // is logical client identity, never display name/color.
  const adaVeraAvatar = ada.page.locator('[data-presence-id="human:vera"]')
  await adaVeraAvatar.click()
  const adaVeraInspector = ada.page.locator('[data-presence-inspector="human:vera"]')
  const veraBSession = adaVeraInspector.locator('[data-presence-client-id="vera-tab-b"]')
  await veraBSession.locator('.presence-follow').click()
  const followedVeraCursor = ada.page.locator(
    '.ProseMirror-yjs-cursor[data-presence-client-id="vera-tab-b"][data-presence-followed="true"]',
  )
  await followedVeraCursor.waitFor({ state: 'attached', timeout: 10_000 })
  assert(await followedVeraCursor.getAttribute('contenteditable') === 'false',
    'followed cursor is not opaque to mobile IME editing')
  assert((await veraBSession.locator('.presence-follow').textContent())?.trim() === 'Following',
    'follow control did not reflect controlled state')
  await veraBSession.locator('.presence-follow').click()

  // Human/agent truth plus bounded-avatar overflow in the real browser.
  const sophia = await captureActor(browser, baseUrl, 'sophia-agent', {
    graph: graphA, doc: docA, human: 'sophia-agent', name: 'Sophia',
    device: 'choreograph', client: 'agent-run-1', type: 'agent',
  })
  actors.push(sophia)
  const lin = await captureActor(browser, baseUrl, 'lin-tab-a', {
    graph: graphA, doc: docA, human: 'lin', name: 'Lin', device: 'lin-device', client: 'lin-tab-a',
  })
  actors.push(lin)
  const bob = await captureActor(browser, baseUrl, 'bob-tab-a', {
    graph: graphA, doc: docA, human: 'bob', name: 'Bob', device: 'bob-device', client: 'bob-tab-a',
  })
  actors.push(bob)
  await call(sophia.page, 'focusSelection')
  await expectPeople(veraA.page, {
    vera: 2, ada: 1, 'sophia-agent': 1, lin: 1, bob: 1,
  }, 'agent + overflow population')
  const overflowTrigger = veraA.page.locator('[data-presence-overflow]')
  assert(await overflowTrigger.textContent() === '+1', 'bounded avatar stack did not expose +1 overflow')
  await overflowTrigger.click()
  const overflowAgent = veraA.page.locator('[data-overflow-presence-id="agent:sophia-agent"]')
  await overflowAgent.waitFor({ state: 'visible' })
  await overflowAgent.click()
  const agentInspector = veraA.page.locator('[data-presence-inspector="agent:sophia-agent"]')
  await agentInspector.waitFor({ state: 'visible' })
  assert((await agentInspector.locator('[data-presence-actor-type]').textContent())?.trim() === 'Agent',
    'agent inspector did not state actor truth')
  assert(await agentInspector.locator('[data-presence-self-controls]').count() === 0,
    'agent inspector exposed human self-identity controls')
  await agentInspector.locator('.presence-follow').click()
  await veraA.page.locator(
    '.ProseMirror-yjs-cursor[data-presence-client-id="agent-run-1"][data-presence-followed="true"]',
  ).waitFor({ state: 'attached', timeout: 10_000 })
  await agentInspector.locator('.presence-follow').click()
  await agentInspector.locator('.presence-inspector-close').click()
  await call(sophia.page, 'normalClose')
  await call(lin.page, 'normalClose')
  await call(bob.page, 'normalClose')
  await expectPeople(veraA.page, { vera: 2, ada: 1 }, 'agent + overflow cleanup')

  await call(ada.page, 'normalClose')
  const normalClose = await expectPeople(veraA.page, { vera: 2 }, 'normal close cleanup')

  await call(veraB.page, 'hardClose')
  const hardClose = await expectPeople(veraA.page, { vera: 1 }, 'hard close cleanup', 5_000)

  await call(veraB.page, 'open', { graphId: graphA, documentId: docA })
  await expectPeople(veraA.page, { vera: 2 }, 'hard-closed tab reopen')
  const beforeReconnect = await snapshot(veraB.page)
  const beforeEpoch = beforeReconnect.raw.find(entry => entry.clientId === 'vera-tab-b')?.connectionEpoch ?? 0
  await call(veraB.page, 'dropTransport')
  const reconnected = await waitForSnapshot(veraB.page, value => {
    const epoch = value.raw.find(entry => entry.clientId === 'vera-tab-b')?.connectionEpoch ?? 0
    return value.synced && epoch > beforeEpoch
  }, 'transport reconnect epoch advancement', 10_000)
  await waitForSnapshot(veraA.page, value =>
    value.people.length === 1
      && person(value, 'vera')?.sessionCount === 2
      && value.raw.filter(entry => entry.humanId === 'vera').length === 2,
  'post-reconnect no duplicate self')

  await call(veraB.page, 'open', { graphId: graphA, documentId: docB })
  const docSwitchAway = await expectPeople(veraA.page, { vera: 1 }, 'document switch cleanup')
  await expectPeople(veraB.page, { vera: 1 }, 'document switch target room')
  await call(veraB.page, 'open', { graphId: graphA, documentId: docA })
  await expectPeople(veraA.page, { vera: 2 }, 'document switch return')

  await call(veraB.page, 'open', { graphId: graphB, documentId: docA })
  const graphSwitchAway = await expectPeople(veraA.page, { vera: 1 }, 'graph switch cleanup')
  await expectPeople(veraB.page, { vera: 1 }, 'graph switch target room')
  await call(veraB.page, 'open', { graphId: graphA, documentId: docA })
  await expectPeople(veraA.page, { vera: 2 }, 'graph switch return')

  let maxVeraRawEntries = 0
  const reloadEpochs: number[] = []
  for (let index = 0; index < 5; index += 1) {
    await veraB.page.reload({ waitUntil: 'commit' })
    await waitForHarnessApi(veraB.page)
    await waitForSnapshot(veraB.page, value => value.synced, `rapid reload ${index + 1} sync`, 20_000)
    const observer = await waitForSnapshot(veraA.page, value =>
      value.people.length === 1
        && person(value, 'vera')?.sessionCount === 2
        && value.raw.filter(entry => entry.humanId === 'vera').length === 2,
    `rapid reload ${index + 1} cleanup`, 5_000)
    const rawVera = observer.snapshot.raw.filter(entry => entry.humanId === 'vera').length
    maxVeraRawEntries = Math.max(maxVeraRawEntries, rawVera)
    assert(rawVera === 2, `rapid reload ${index + 1} left ${rawVera} raw Vera entries`)
    const own = await snapshot(veraB.page)
    reloadEpochs.push(own.raw.find(entry => entry.clientId === 'vera-tab-b')?.connectionEpoch ?? 0)
  }
  assert(reloadEpochs.every((epoch, index) => index === 0 || epoch > reloadEpochs[index - 1]),
    `reload epochs were not monotonic: ${reloadEpochs.join(',')}`)

  await call(veraB.page, 'hardClose')
  const finalHardClose = await expectPeople(veraA.page, { vera: 1 }, 'final bounded hard-close cleanup')
  await call(veraA.page, 'normalClose')

  // Real opener-created tab journey. Browsers clone the opener's sessionStorage
  // into the new context; the live localStorage lease must detect that copied
  // logical client ID and regenerate it before awareness publication.
  const duplicateOrigin = await captureActor(browser, baseUrl, 'duplicate-origin', {
    graph: graphA, doc: 'duplicate-tab-document', human: 'duplicate-user', name: 'Duplicate User',
  })
  actors.push(duplicateOrigin)
  const cloneMarker = randomUUID()
  await duplicateOrigin.page.evaluate(markerValue => {
    sessionStorage.setItem('presence-duplicate-clone-marker', markerValue)
  }, cloneMarker)
  const popupPromise = duplicateOrigin.context.waitForEvent('page')
  await duplicateOrigin.page.evaluate(() => {
    if (!window.open(location.href, '_blank')) throw new Error('window.open was blocked')
  })
  const duplicatePopup = await popupPromise
  duplicatePopup.on('pageerror', error => pageErrors.push(`duplicate-popup: ${error.stack ?? error.message}`))
  duplicatePopup.on('console', message => {
    if (message.type() === 'error' || message.type() === 'assert') {
      consoleErrors.push(`duplicate-popup: ${message.text()}`)
    }
  })
  await duplicatePopup.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  await waitForHarnessApi(duplicatePopup)
  await waitForSnapshot(duplicatePopup, value => value.synced, 'duplicate popup sync', 20_000)
  assert(await duplicatePopup.evaluate(() =>
    sessionStorage.getItem('presence-duplicate-clone-marker')) === cloneMarker,
  'opener journey did not actually clone sessionStorage')
  const duplicateGroup = await expectPeople(
    duplicateOrigin.page,
    { 'duplicate-user': 2 },
    'duplicated-tab identity regeneration',
    10_000,
  )
  const duplicatePerson = person(duplicateGroup.snapshot, 'duplicate-user')!
  assert(duplicatePerson.clientIds.length === 2
    && new Set(duplicatePerson.clientIds).size === 2,
  `duplicated tab did not regenerate client identity: ${duplicatePerson.clientIds.join(',')}`)
  const originLocalClient = duplicatePerson.sessions.find(session => session.isLocal)?.clientId
  const popupSnapshot = await snapshot(duplicatePopup)
  const popupLocalClient = person(popupSnapshot, 'duplicate-user')?.sessions
    .find(session => session.isLocal)?.clientId
  assert(Boolean(originLocalClient && popupLocalClient && originLocalClient !== popupLocalClient),
    `duplicated tabs share logical client identity: ${originLocalClient ?? 'none'}`)
  await call(duplicatePopup, 'hardClose')
  const duplicateCleanup = await expectPeople(
    duplicateOrigin.page,
    { 'duplicate-user': 1 },
    'duplicated-tab hard-close cleanup',
  )
  await duplicatePopup.close()
  await call(duplicateOrigin.page, 'normalClose')

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    backend: 'real-gardend',
    gardendBinary: binary,
    browser: executablePath ?? 'playwright-chromium',
    hmr: false,
    broadcastChannelDisabled: true,
    graphA,
    graphB,
    journeys: {
      differentUsers: true,
      sameUserTwoTabsGrouped: true,
      hoverExplainsTabs: true,
      remoteTextConverged: true,
      remoteCursorRendered: true,
      normalCloseCleanupMs: normalClose.elapsedMs,
      hardCloseCleanupMs: hardClose.elapsedMs,
      reconnectEpoch: {
        before: beforeEpoch,
        after: reconnected.snapshot.raw.find(entry => entry.clientId === 'vera-tab-b')?.connectionEpoch,
      },
      documentSwitchCleanupMs: docSwitchAway.elapsedMs,
      graphSwitchCleanupMs: graphSwitchAway.elapsedMs,
      rapidReloads: reloadEpochs.length,
      reloadEpochs,
      maxVeraRawEntries,
      finalHardCloseCleanupMs: finalHardClose.elapsedMs,
      duplicateTabSessionStorageCloned: true,
      duplicateTabClientIds: duplicatePerson.clientIds,
      duplicateTabHardCloseCleanupMs: duplicateCleanup.elapsedMs,
      agentInspectorAndFollow: true,
      boundedAvatarOverflow: true,
      selfProfileAwarenessUpdate: true,
    },
  }, null, 2)}\n`)
} finally {
  for (const actor of actors.reverse()) await actor.context.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  await cell?.kill().catch(() => undefined)
}

process.exit(0)
