/**
 * Distributed-truth acceptance harness for cached-document offline mode.
 *
 * Real participants:
 *   - two independent persistent Chromium profiles (A and B);
 *   - one Node y-websocket client (C / presence observer);
 *   - Garden's MCP write/delete/recreate surface;
 *   - one real Gardend profile across process death and random-port/token boots.
 *
 * The harness intentionally partitions only `/cell/**`. The web shell still
 * loads from Vite, matching a bundled Tauri renderer whose local cell/network
 * is unavailable. Browser IndexedDB/localStorage and the renderer itself are
 * restarted while partitioned; no in-memory state is allowed to carry the test.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  chromium,
  webkit,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import WebSocket from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = 'offline-sync-later-proof'
const primaryDocumentId = 'distributed-truth'
const untouchedDocumentId = 'never-opened-offline'
const deletedDocumentId = 'delete-boundary'
const identityRaceDocumentId = 'identity-race'
const initialText = 'BASELINE'
const port = Number(process.env.SHRUBBERY_OFFLINE_SYNC_PORT ?? 5224)
const headed = process.env.SHRUBBERY_HEADED === '1'
const browserEngine = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (browserEngine !== 'chromium' && browserEngine !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const browserType = browserEngine === 'webkit' ? webkit : chromium
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')

const MARKERS = {
  a1: ' ‹A:offline:bold›',
  a2: ' ‹A:after-crash›',
  b1: ' ‹B:offline›',
  c1: ' ‹C:server-concurrent›',
  mcp1: 'MCP:block-concurrent',
  aRound2: ' ‹A:round2›',
  bRound2: ' ‹B:round2›',
  cRound2: ' ‹C:round2›',
  reboot: ' ‹B:across-gardend-crash›',
  deleted: ' ‹A:must-be-recovery-only›',
} as const

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`offline-sync assertion failed: ${message}`)
}

function canonicalDocumentTitleSparql(graph: string, document: string): string {
  return [
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT ?label',
    `WHERE { GRAPH <urn:mnemosyne:local:graph:${graph}:projection:workspace> {`,
    `  <urn:mnemosyne:local:document:${document}> dcterms:title ?label .`,
    '} }',
  ].join('\n')
}

const sleep = (ms: number): Promise<void> => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

async function waitFor<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (accept(last)) return last
    } catch (error) {
      lastError = error
    }
    await sleep(75)
  }
  throw new Error(
    `${label} timed out after ${timeoutMs} ms; last=${JSON.stringify(last)?.slice(0, 800)}`
    + `${lastError ? ` error=${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`,
  )
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1
}

function truthOf(update: Uint8Array): {
  readonly text: string
  readonly map: Readonly<Record<string, unknown>>
} {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return {
      text: doc.getXmlFragment('content').toString(),
      map: Object.fromEntries(doc.getMap('offlineHarness').entries()),
    }
  } finally {
    doc.destroy()
  }
}

function lastXmlText(parent: Y.XmlFragment | Y.XmlElement): Y.XmlText | null {
  const children = parent.toArray()
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child instanceof Y.XmlText) return child
    if (child instanceof Y.XmlElement) {
      const nested = lastXmlText(child)
      if (nested) return nested
    }
  }
  return null
}

function appendMarker(doc: Y.Doc, marker: string, mapKey: string): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment('content')
    let text = lastXmlText(fragment)
    if (!text) {
      const paragraph = new Y.XmlElement('paragraph')
      text = new Y.XmlText()
      paragraph.insert(0, [text])
      fragment.insert(fragment.length, [paragraph])
    }
    text.insert(text.length, marker)
    doc.getMap('offlineHarness').set(mapKey, marker)
  }, { kind: 'offline-harness-node-writer' })
}

function mcpFor(cell: GardendCell): LoopbackMcpClient {
  return new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
}

function publishLoopback(cell: GardendCell): void {
  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId,
  }, null, 2))
}

async function waitServerTruth(
  mcp: LoopbackMcpClient,
  documentId: string,
  markers: readonly string[],
  mapKeys: readonly string[],
  timeoutMs = 30_000,
): Promise<{
  readonly update: Uint8Array
  readonly incarnation: string | null
  readonly text: string
  readonly map: Readonly<Record<string, unknown>>
}> {
  return waitFor(async () => {
    const snapshot = await mcp.documentSnapshot(graphId, documentId)
    const truth = truthOf(snapshot.update)
    return {
      text: truth.text,
      map: truth.map,
      incarnation: snapshot.incarnation,
      update: snapshot.update,
    }
  }, value => (
    markers.every(marker => value.text.includes(marker))
    && mapKeys.every(key => Object.hasOwn(value.map, key))
  ), `server truth for ${documentId}`, timeoutMs)
}

interface NodePeer {
  readonly doc: Y.Doc
  readonly provider: WebsocketProvider
  destroy(): void
}

async function connectNodePeer(
  cell: GardendCell,
  documentId: string,
  label: string,
): Promise<NodePeer> {
  const token = cell.token
  class AuthorizedWebSocket extends WebSocket {
    constructor(address: string | URL, _protocols?: string | string[]) {
      super(address, [`bearer.${token}`])
    }
  }
  const doc = new Y.Doc()
  const wsBase = cell.apiUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  const provider = new WebsocketProvider(
    `${wsBase}/hocuspocus/docs/${encodeURIComponent(graphId)}`,
    documentId,
    doc,
    {
      WebSocketPolyfill: AuthorizedWebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    },
  )
  provider.awareness.setLocalStateField('user', {
    id: `node-${label}`,
    name: `Node ${label}`,
  })
  await waitFor(
    () => provider.synced,
    Boolean,
    `Node peer ${label} room sync`,
  )
  return {
    doc,
    provider,
    destroy(): void {
      provider.destroy()
      doc.destroy()
    },
  }
}

interface BrowserClient {
  readonly name: string
  readonly profileDir: string
  context: BrowserContext
  page: Page
  partitioned: boolean
  readonly pageErrors: string[]
  readonly consoleErrors: string[]
  readonly unexpectedFailures: string[]
  readonly documentSockets: string[]
  readonly serverDocumentConnections: string[]
  readonly routedDocumentSockets: Array<{
    readonly browser: WebSocketRoute
    readonly server: WebSocketRoute
  }>
}

async function launchBrowserClient(
  name: string,
  profileDir: string,
  partitioned: boolean,
): Promise<BrowserClient> {
  const client = {
    name,
    profileDir,
    context: null as unknown as BrowserContext,
    page: null as unknown as Page,
    partitioned,
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    unexpectedFailures: [] as string[],
    documentSockets: [] as string[],
    serverDocumentConnections: [] as string[],
    routedDocumentSockets: [] as Array<{
      readonly browser: WebSocketRoute
      readonly server: WebSocketRoute
    }>,
  }
  client.context = await browserType.launchPersistentContext(profileDir, {
    headless: !headed,
    viewport: { width: 1440, height: 920 },
  })
  client.page = client.context.pages()[0] ?? await client.context.newPage()
  const page = client.page
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  await page.route(url => url.pathname.startsWith('/cell/'), route => (
    client.partitioned
      ? route.abort('internetdisconnected')
      : route.continue()
  ))
  await page.routeWebSocket(/\/cell\/hocuspocus\//, socket => {
    if (client.partitioned) {
      void socket.close({ code: 1001, reason: `partitioned-${name}` })
    } else {
      client.serverDocumentConnections.push(socket.url())
      client.routedDocumentSockets.push({
        browser: socket,
        server: socket.connectToServer(),
      })
    }
  })
  page.on('pageerror', error => client.pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') client.consoleErrors.push(message.text())
  })
  page.on('requestfailed', request => {
    if (client.partitioned || request.url().endsWith('/favicon.ico')) return
    client.unexpectedFailures.push(
      `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`,
    )
  })
  page.on('websocket', socket => {
    if (socket.url().includes('/hocuspocus/docs/')) client.documentSockets.push(socket.url())
  })
  await page.goto(
    `http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`,
    { waitUntil: 'domcontentloaded' },
  )
  return client
}

async function workspaceCacheRecord(client: BrowserClient): Promise<unknown | null> {
  return client.page.evaluate(async expectedGraph => {
    if (
      typeof indexedDB.databases === 'function'
      && !(await indexedDB.databases()).some(
        database => database.name === 'shrubbery-session-activation-v1',
      )
    ) return null
    const request = indexedDB.open('shrubbery-session-activation-v1', 1)
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!db.objectStoreNames.contains('workspace-config')) return null
      const records = await new Promise<Array<{
        graphId?: string
        userId?: string
        read?: { activationSource?: string }
      }>>((resolveRecords, reject) => {
        const read = db.transaction('workspace-config').objectStore('workspace-config').getAll()
        read.onsuccess = () => resolveRecords(read.result)
        read.onerror = () => reject(read.error)
      })
      const hit = records.find(record => record.graphId === expectedGraph)
      return hit
        ? {
            graphId: hit.graphId,
            userId: hit.userId,
            activationSource: hit.read?.activationSource,
          }
        : null
    } finally {
      db.close()
    }
  }, graphId)
}

interface SourceMirrorRecord {
  readonly complete: boolean
  readonly graphId: string
  readonly graphIncarnation: string
  readonly epoch: string
  readonly manifestHash: string
  readonly memberCount: number
  readonly documentIds: readonly string[]
}

async function sourceMirrorRecord(client: BrowserClient): Promise<SourceMirrorRecord | null> {
  return client.page.evaluate(async expectedGraph => {
    if (
      typeof indexedDB.databases === 'function'
      && !(await indexedDB.databases()).some(
        database => database.name === 'shrubbery-source-mirror-v1',
      )
    ) return null
    const request = indexedDB.open('shrubbery-source-mirror-v1')
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!db.objectStoreNames.contains('mirrors')) return null
      const records = await new Promise<Array<{
        graphId?: string
        graphIncarnation?: string
        epoch?: string
        bundle?: {
          complete?: boolean
          documents?: Array<{ documentId?: string }>
          manifest?: {
            complete?: boolean
            sourceManifestHash?: string
            members?: unknown[]
          }
        }
      }>>((resolveRecords, reject) => {
        const read = db.transaction('mirrors').objectStore('mirrors').getAll()
        read.onsuccess = () => resolveRecords(read.result)
        read.onerror = () => reject(read.error)
      })
      const hit = records.find(record => record.graphId === expectedGraph)
      if (!hit?.bundle) return null
      return {
        complete: hit.bundle.complete === true && hit.bundle.manifest?.complete === true,
        graphId: hit.graphId ?? '',
        graphIncarnation: hit.graphIncarnation ?? '',
        epoch: hit.epoch ?? '',
        manifestHash: hit.bundle.manifest?.sourceManifestHash ?? '',
        memberCount: hit.bundle.manifest?.members?.length ?? 0,
        documentIds: (hit.bundle.documents ?? [])
          .map(document => document.documentId ?? '')
          .filter(Boolean)
          .sort(),
      }
    } finally {
      db.close()
    }
  }, graphId)
}

async function sourceOutboxRecords(client: BrowserClient): Promise<Array<{
  readonly kind: string
  readonly operationId: string
  readonly status: string
  readonly commandKind?: string
  readonly documentId?: string
  readonly payload?: unknown
}>> {
  return client.page.evaluate(async () => {
    if (
      typeof indexedDB.databases === 'function'
      && !(await indexedDB.databases()).some(
        database => database.name === 'shrubbery-source-mirror-v1',
      )
    ) return []
    const request = indexedDB.open('shrubbery-source-mirror-v1')
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!db.objectStoreNames.contains('outbox')) return []
      const records = await new Promise<Array<{
        status?: string
        operation?: {
          kind?: string
          operationId?: string
          commandKind?: string
          documentId?: string
          payload?: unknown
        }
      }>>((resolveRecords, reject) => {
        const read = db.transaction('outbox').objectStore('outbox').getAll()
        read.onsuccess = () => resolveRecords(read.result)
        read.onerror = () => reject(read.error)
      })
      return records.map(record => ({
        kind: record.operation?.kind ?? '',
        operationId: record.operation?.operationId ?? '',
        status: record.status ?? '',
        ...(record.operation?.commandKind
          ? { commandKind: record.operation.commandKind }
          : {}),
        ...(record.operation?.documentId
          ? { documentId: record.operation.documentId }
          : {}),
        ...(record.operation && Object.hasOwn(record.operation, 'payload')
          ? { payload: record.operation.payload }
          : {}),
      }))
    } finally {
      db.close()
    }
  })
}

async function sidebarNodeLabel(client: BrowserClient, nodeId: string): Promise<string> {
  return client.page.evaluate((id) => {
    const testimony = (
      window as unknown as {
        __shrubberySurfaceTestimony?: (
          nodeId: string,
        ) => { readonly label?: string }
      }
    ).__shrubberySurfaceTestimony?.(id)
    if (testimony?.label?.trim()) return testimony.label.trim()
    type ProjectedNode = {
      readonly id?: string
      readonly label?: string
      readonly children?: readonly ProjectedNode[]
    }
    const sidebar = document.querySelector('mn-sidebar-panel') as (
      HTMLElement & {
        readonly sections?: readonly {
          readonly nodes?: readonly ProjectedNode[]
        }[]
      }
    ) | null
    for (const section of sidebar?.sections ?? []) {
      const pending = [...(section.nodes ?? [])]
      while (pending.length > 0) {
        const node = pending.shift()
        if (!node) continue
        if (node.id === id) return node.label?.trim() ?? ''
        pending.unshift(...(node.children ?? []))
      }
    }
    const row = Array.from(
      sidebar?.shadowRoot?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [],
    ).find(candidate => candidate.dataset.nodeId === id)
    return row?.textContent?.trim() ?? ''
  }, nodeId)
}

async function browserDiagnostics(client: BrowserClient): Promise<unknown> {
  return client.page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : []
    return {
      url: location.href,
      title: document.title,
      body: document.body?.innerText?.slice(0, 2_000) ?? '',
      organismMode: document.body?.dataset.organismMode ?? null,
      status: document.querySelector('#status')?.textContent ?? null,
      hostHtml: document.querySelector('#host')?.innerHTML.slice(0, 2_000) ?? null,
      databases: databases.map(database => ({
        name: database.name,
        version: database.version,
      })),
      localStorage: Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index) ?? ''
          return [key, localStorage.getItem(key)]
        }),
      ),
    }
  }).catch(error => ({
    diagnosticError: error instanceof Error ? error.message : String(error),
  }))
}

async function restartBrowserClient(client: BrowserClient): Promise<BrowserClient> {
  const { name, profileDir, partitioned } = client
  await client.context.close()
  return launchBrowserClient(name, profileDir, partitioned)
}

async function setPartition(
  client: BrowserClient,
  partitioned: boolean,
  options: { readonly reload?: boolean } = {},
): Promise<void> {
  if (client.partitioned === partitioned) return
  if (partitioned) {
    // Close both ends of every routed socket before refusing new connections.
    // Playwright's context-wide offline switch does not reliably sever an
    // already-upgraded routed WebSocket.
    client.partitioned = true
    const routed = client.routedDocumentSockets.splice(
      0,
      client.routedDocumentSockets.length,
    )
    await Promise.allSettled(routed.flatMap(socket => [
      socket.browser.close({ code: 1001, reason: `partitioned-${client.name}` }),
      socket.server.close({ code: 1001, reason: `partitioned-${client.name}` }),
    ]))
    return
  }
  client.partitioned = false
  if (options.reload !== false) {
    await client.page.reload({ waitUntil: 'domcontentloaded' })
  }
  await client.page.evaluate(() => window.dispatchEvent(new Event('online')))
}

async function dispatchOpen(client: BrowserClient, documentId: string): Promise<void> {
  await client.page.evaluate(({ graph, document }) => {
    window.dispatchEvent(new CustomEvent('shrubbery:open-document', {
      detail: { graphId: graph, documentId: document },
    }))
  }, { graph: graphId, document: documentId })
}

async function openWarmDocument(client: BrowserClient, documentId: string): Promise<void> {
  const row = client.page.locator(`mn-sidebar-panel [data-node-id="${documentId}"]`)
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  await row.click()
  await waitBrowserTruth(client, [initialText], [], 'live')
}

async function hostState(client: BrowserClient): Promise<{
  readonly phase: string | null
  readonly durability: string | null
  readonly conflict: string | null
  readonly source: string | null
  readonly editable: string | null
  readonly text: string
  readonly map: Readonly<Record<string, unknown>>
  readonly json: unknown
}> {
  return client.page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as (HTMLElement & {
      hostState?: { provider?: { doc?: Y.Doc } }
      _editor?: { getJSON?: () => unknown }
    }) | null
    const body = host?.shadowRoot?.querySelector('.ProseMirror')
    const yDoc = host?.hostState?.provider?.doc
    return {
      phase: host?.getAttribute('data-document-activation') ?? null,
      durability: host?.getAttribute('data-document-durability') ?? null,
      conflict: host?.getAttribute('data-document-conflict') ?? null,
      source: host?.getAttribute('data-document-render-source') ?? null,
      editable: body?.getAttribute('contenteditable') ?? null,
      text: body?.textContent ?? '',
      map: yDoc ? Object.fromEntries(yDoc.getMap('offlineHarness').entries()) : {},
      json: host?._editor?.getJSON?.() ?? null,
    }
  })
}

async function waitBrowserTruth(
  client: BrowserClient,
  markers: readonly string[],
  mapKeys: readonly string[],
  phase?: 'live' | 'offline-clean' | 'offline-dirty' | 'conflict',
  timeoutMs = 30_000,
): Promise<Awaited<ReturnType<typeof hostState>>> {
  return waitFor(
    () => hostState(client),
    state => (
      (!phase || state.phase === phase)
      && markers.every(marker => state.text.includes(marker))
      && mapKeys.every(key => Object.hasOwn(state.map, key))
    ),
    `${client.name} browser truth (${phase ?? 'any'})`,
    timeoutMs,
  )
}

async function ensureOfflineDocument(
  client: BrowserClient,
  documentId: string,
  markers: readonly string[],
): Promise<void> {
  try {
    await waitBrowserTruth(client, markers, [], 'offline-clean', 5_000)
    return
  } catch {
    await dispatchOpen(client, documentId)
  }
  const state = await waitFor(
    () => hostState(client),
    value => (
      (value.phase === 'offline-clean' || value.phase === 'offline-dirty')
      && value.editable === 'true'
      && markers.every(marker => value.text.includes(marker))
    ),
    `${client.name} cold offline document activation`,
  )
  assert(state.source === 'indexeddb' || state.source === 'memory' || state.source === 'snapshot',
    `${client.name} rendered from a local source: ${JSON.stringify(state)}`)
}

async function editBrowser(
  client: BrowserClient,
  marker: string,
  mapKey: string,
  bold = false,
): Promise<void> {
  const body = client.page.locator('sh-editor-host .ProseMirror')
  await body.waitFor({ state: 'visible' })
  await client.page.evaluate(({ value, makeBold }) => {
    interface EditorChain {
      focus(position: string): EditorChain
      toggleBold(): EditorChain
      insertContent(content: string): EditorChain
      run(): boolean
    }
    const host = document.querySelector('sh-editor-host') as {
      _editor?: { chain(): EditorChain }
    } | null
    const editor = host?._editor
    if (!editor) throw new Error('offline harness could not reach the active TipTap editor')
    let chain = editor.chain().focus('end')
    if (makeBold) chain = chain.toggleBold()
    chain = chain.insertContent(value)
    if (makeBold) chain = chain.toggleBold()
    if (!chain.run()) throw new Error('offline harness TipTap insertion was rejected')
  }, { value: marker, makeBold: bold })
  await client.page.evaluate(({ key, value }) => {
    const host = document.querySelector('sh-editor-host') as {
      hostState?: { provider?: { doc?: Y.Doc } }
    } | null
    const yDoc = host?.hostState?.provider?.doc
    if (!yDoc) throw new Error('offline harness could not reach the active Y.Doc')
    yDoc.getMap('offlineHarness').set(key, value)
  }, { key: mapKey, value: marker })
  const state = await waitBrowserTruth(client, [marker], [mapKey], 'offline-dirty')
  await waitFor(
    () => hostState(client),
    value => value.durability === 'durable',
    `${client.name} local durability`,
  )
  assert(state.editable === 'true', `${client.name} stayed editable offline`)
}

async function documentCacheRecord(
  client: BrowserClient,
  documentId: string,
): Promise<{
  readonly authority: string
  readonly incarnation: string | null
  readonly bytes: number
} | null> {
  return client.page.evaluate(async expectedDocument => {
    const request = indexedDB.open('shrubbery-document-activation-v1', 2)
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const records = await new Promise<Array<{
        documentId?: string
        authority?: string
        incarnation?: string | null
        update?: ArrayBuffer
      }>>((resolveRecords, reject) => {
        const read = db.transaction('documents').objectStore('documents').getAll()
        read.onsuccess = () => resolveRecords(read.result)
        read.onerror = () => reject(read.error)
      })
      const record = records.find(value => value.documentId === expectedDocument)
      return record
        ? {
            authority: record.authority ?? '',
            incarnation: record.incarnation ?? null,
            bytes: record.update?.byteLength ?? 0,
          }
        : null
    } finally {
      db.close()
    }
  }, documentId)
}

async function recoveryRecords(
  client: BrowserClient,
  documentId: string,
): Promise<Array<{
  readonly reason: string
  readonly incarnation: string | null
  readonly update: number[]
}>> {
  return client.page.evaluate(async expectedDocument => {
    const request = indexedDB.open('shrubbery-document-activation-v1', 2)
    const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
      request.onsuccess = () => resolveDb(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolveRecords, reject) => {
        const read = db.transaction('recoveries').objectStore('recoveries').getAll()
        read.onsuccess = () => resolveRecords(
          (read.result as Array<{
            documentId?: string
            reason?: string
            incarnation?: string | null
            update?: ArrayBuffer
          }>)
            .filter(value => value.documentId === expectedDocument)
            .map(value => ({
              reason: value.reason ?? '',
              incarnation: value.incarnation ?? null,
              update: Array.from(new Uint8Array(value.update ?? new ArrayBuffer(0))),
            })),
        )
        read.onerror = () => reject(read.error)
      })
    } finally {
      db.close()
    }
  }, documentId)
}

async function waitAwareness(peer: NodePeer, count: number, label: string): Promise<void> {
  await waitFor(
    () => peer.provider.awareness.getStates().size,
    value => value === count,
    label,
  )
}

async function assertConverged(
  a: BrowserClient,
  b: BrowserClient,
  mcp: LoopbackMcpClient,
  markers: readonly string[],
  mapKeys: readonly string[],
): Promise<void> {
  const server = await waitServerTruth(mcp, primaryDocumentId, markers, mapKeys)
  const aState = await waitBrowserTruth(a, markers, mapKeys, 'live')
  const bState = await waitBrowserTruth(b, markers, mapKeys, 'live')
  for (const marker of markers) {
    assert(markerCount(server.text, marker) === 1, `server contains ${marker} exactly once`)
    assert(markerCount(aState.text, marker) === 1, `A contains ${marker} exactly once`)
    assert(markerCount(bState.text, marker) === 1, `B contains ${marker} exactly once`)
  }
  assert(
    JSON.stringify(Object.entries(aState.map).sort()) === JSON.stringify(Object.entries(bState.map).sort()),
    `browser maps converge: A=${JSON.stringify(aState.map)} B=${JSON.stringify(bState.map)}`,
  )
  for (const key of mapKeys) {
    assert(aState.map[key] === server.map[key], `A/server map value converges for ${key}`)
  }
}

async function expectIncarnationRejected(
  cell: GardendCell,
  documentId: string,
  incarnation: string,
): Promise<number> {
  const wsBase = cell.apiUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  const url = `${wsBase}/hocuspocus/docs/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}`
    + `?document_incarnation=${encodeURIComponent(incarnation)}`
  return new Promise((resolveStatus, reject) => {
    const socket = new WebSocket(url, [`bearer.${cell.token}`])
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('stale-incarnation WebSocket was not rejected'))
    }, 10_000)
    socket.once('open', () => {
      clearTimeout(timer)
      socket.terminate()
      reject(new Error('stale-incarnation WebSocket unexpectedly opened'))
    })
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      response.resume()
      resolveStatus(response.statusCode ?? 0)
    })
    socket.once('error', () => {
      // `unexpected-response` carries the status; ignore the follow-on error.
    })
  })
}

async function exerciseSnapshotIdentityRace(
  mcp: LoopbackMcpClient,
  rounds = 4,
): Promise<{ readonly rounds: number; readonly successfulReads: number; readonly notFoundReads: number }> {
  await mcp.toolsCall('write_document', {
    graphId,
    documentId: identityRaceDocumentId,
    content: 'RACE-0',
    awaitDurable: true,
  })
  let successfulReads = 0
  let notFoundReads = 0

  for (let round = 1; round <= rounds; round += 1) {
    const oldMarker = `RACE-${round - 1}`
    const newMarker = `RACE-${round}`
    const old = await waitServerTruth(mcp, identityRaceDocumentId, [oldMarker], [])
    assert(old.incarnation, `identity race ${round} has an old incarnation`)
    const samples: Array<{
      readonly incarnation: string
      readonly text: string
    }> = [{ incarnation: old.incarnation, text: old.text }]
    const unexpectedReaderErrors: string[] = []
    const captureSnapshot = async (delayMs: number): Promise<void> => {
      await sleep(delayMs)
      try {
        const snapshot = await mcp.documentSnapshot(graphId, identityRaceDocumentId)
        assert(snapshot.incarnation, `identity race ${round} response is fenced`)
        samples.push({
          incarnation: snapshot.incarnation,
          text: truthOf(snapshot.update).text,
        })
      } catch (error) {
        const failure = error as { status?: number; responseBody?: string }
        if (
          failure.status === 404
          || (
            failure.status === 400
            && failure.responseBody?.includes('document tombstoned')
          )
        ) {
          notFoundReads += 1
        } else {
          unexpectedReaderErrors.push(
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    }
    // Bounded staggered readers contend with both mutation roots without
    // starving the non-fair graph gate indefinitely.
    const readers = Array.from(
      { length: 48 },
      (_, index) => captureSnapshot(index % 12),
    )

    await sleep(2)
    await mcp.toolsCall('delete_document', {
      graphId,
      documentId: identityRaceDocumentId,
    })
    await mcp.toolsCall('write_document', {
      graphId,
      documentId: identityRaceDocumentId,
      content: newMarker,
      awaitDurable: true,
    })
    const replacement = await waitServerTruth(mcp, identityRaceDocumentId, [newMarker], [])
    assert(replacement.incarnation, `identity race ${round} has a replacement incarnation`)
    assert(replacement.incarnation !== old.incarnation,
      `identity race ${round} rotates the incarnation`)
    samples.push({ incarnation: replacement.incarnation, text: replacement.text })
    await Promise.all(readers)
    assert(
      unexpectedReaderErrors.length === 0,
      `identity race ${round} reader errors: ${unexpectedReaderErrors.join('; ')}`,
    )

    for (const sample of samples) {
      successfulReads += 1
      if (sample.incarnation === old.incarnation) {
        assert(sample.text.includes(oldMarker),
          `old incarnation ${round} never carries replacement bytes`)
        assert(!sample.text.includes(newMarker),
          `old incarnation ${round} excludes replacement marker`)
      } else if (sample.incarnation === replacement.incarnation) {
        assert(sample.text.includes(newMarker),
          `replacement incarnation ${round} carries replacement bytes`)
        assert(!sample.text.includes(oldMarker),
          `replacement incarnation ${round} never carries old bytes`)
      } else {
        throw new Error(
          `offline-sync assertion failed: identity race ${round} returned unknown incarnation ${sample.incarnation}`,
        )
      }
    }
  }

  return { rounds, successfulReads, notFoundReads }
}

async function hardKill(cell: GardendCell): Promise<void> {
  process.kill(cell.pid, 'SIGKILL')
  await waitFor(
    async () => {
      try {
        return !(await fetch(`${cell.apiUrl}/health`)).ok
      } catch {
        return true
      }
    },
    Boolean,
    'Gardend hard process death',
    10_000,
  )
  await cell.kill()
}

let server: ViteDevServer | null = null
let cell: GardendCell | null = null
let mcp: LoopbackMcpClient | null = null
let observer: NodePeer | null = null
let clientA: BrowserClient | null = null
let clientB: BrowserClient | null = null
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-offline-sync.'))
const loopbackPath = join(runRoot, 'vite-loopback.json')
const cellProfile = join(runRoot, 'gardend-profile')
const profileA = join(runRoot, `${browserEngine}-a`)
const profileB = join(runRoot, `${browserEngine}-b`)
const evidence: Record<string, unknown> = {}
const previousLoopbackManifest = process.env.GARDEND_LOOPBACK_MANIFEST

try {
  process.env.GARDEND_LOOPBACK_MANIFEST = loopbackPath
  const binary = resolve(resolveGardendBin())
  assert(existsSync(binary), `real Gardend binary exists at ${binary}`)
  const binarySha256 = createHash('sha256').update(readFileSync(binary)).digest('hex')
  cell = await spawnGardend({ bin: binary, profileDir: cellProfile, readyTimeoutMs: 45_000 })
  mcp = mcpFor(cell)
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'))
  await mcp.toolsCall('create_document', {
    graphId,
    documentId: primaryDocumentId,
    title: 'Distributed Truth',
  })
  await mcp.toolsCall('write_document', {
    graphId,
    documentId: primaryDocumentId,
    content: initialText,
    awaitDurable: true,
  })
  await waitServerTruth(mcp, primaryDocumentId, [initialText], [])
  await mcp.toolsCall('write_document', {
    graphId,
    documentId: untouchedDocumentId,
    content: 'SERVER-ONLY-UNTOUCHED',
    awaitDurable: true,
  })
  const untouchedServer = await waitServerTruth(
    mcp,
    untouchedDocumentId,
    ['SERVER-ONLY-UNTOUCHED'],
    [],
  )
  publishLoopback(cell)

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()

  clientA = await launchBrowserClient('A', profileA, false)
  clientB = await launchBrowserClient('B', profileB, false)
  await openWarmDocument(clientA, primaryDocumentId)
  await openWarmDocument(clientB, primaryDocumentId)
  const warmA = await waitFor(
    () => documentCacheRecord(clientA!, primaryDocumentId),
    record => record?.authority === 'live' && Boolean(record.incarnation),
    'A warm fenced cache',
  )
  const warmB = await waitFor(
    () => documentCacheRecord(clientB!, primaryDocumentId),
    record => record?.authority === 'live' && Boolean(record.incarnation),
    'B warm fenced cache',
  )
  assert(warmA?.incarnation === warmB?.incarnation, 'both browsers cache the same incarnation')
  const mirrorWarmA = await waitFor(
    () => sourceMirrorRecord(clientA!),
    record => (
      record?.complete === true
      && record.documentIds.includes(primaryDocumentId)
      && record.documentIds.includes(untouchedDocumentId)
      && Boolean(record.graphIncarnation)
      && Boolean(record.manifestHash)
    ),
    'A complete identity-fenced source mirror',
  )
  const mirrorWarmB = await waitFor(
    () => sourceMirrorRecord(clientB!),
    record => (
      record?.complete === true
      && record.documentIds.includes(primaryDocumentId)
      && record.documentIds.includes(untouchedDocumentId)
      && Boolean(record.graphIncarnation)
      && Boolean(record.manifestHash)
    ),
    'B complete identity-fenced source mirror',
  )
  assert(
    mirrorWarmA?.graphIncarnation === mirrorWarmB?.graphIncarnation,
    'both browsers mirror the same graph incarnation',
  )
  const untouchedWarmA = await waitFor(
    () => documentCacheRecord(clientA!, untouchedDocumentId),
    record => record?.authority === 'snapshot' && Boolean(record.incarnation),
    'A untouched document imported from complete mirror',
  )
  const untouchedWarmB = await waitFor(
    () => documentCacheRecord(clientB!, untouchedDocumentId),
    record => record?.authority === 'snapshot' && Boolean(record.incarnation),
    'B untouched document imported from complete mirror',
  )
  await waitFor(
    () => workspaceCacheRecord(clientA!),
    Boolean,
    'A validated workspace cache',
  )
  await waitFor(
    () => workspaceCacheRecord(clientB!),
    Boolean,
    'B validated workspace cache',
  )

  observer = await connectNodePeer(cell, primaryDocumentId, 'C')
  await waitAwareness(observer, 3, 'A + B + Node presence online')

  await setPartition(clientA, true)
  await setPartition(clientB, true)
  await waitAwareness(observer, 1, 'offline browsers publish zero server presence')
  const socketsBeforeColdA = clientA.documentSockets.length
  const socketsBeforeColdB = clientB.documentSockets.length

  clientA = await restartBrowserClient(clientA)
  clientB = await restartBrowserClient(clientB)
  const mirrorColdA = await sourceMirrorRecord(clientA)
  const mirrorColdB = await sourceMirrorRecord(clientB)
  const untouchedColdA = await documentCacheRecord(clientA, untouchedDocumentId)
  const untouchedColdB = await documentCacheRecord(clientB, untouchedDocumentId)
  await ensureOfflineDocument(clientA, primaryDocumentId, [initialText])
  await ensureOfflineDocument(clientB, primaryDocumentId, [initialText])
  assert(
    clientA.serverDocumentConnections.length === 0 && clientB.serverDocumentConnections.length === 0,
    `cold offline activation opened no server socket: A=${clientA.serverDocumentConnections.length}, B=${clientB.serverDocumentConnections.length}`,
  )
  evidence.coldOffline = {
    cacheA: warmA,
    cacheB: warmB,
    previousSocketCounts: [socketsBeforeColdA, socketsBeforeColdB],
    serverPresence: observer.provider.awareness.getStates().size,
  }
  evidence.mirrorCompleteness = {
    serverDocument: untouchedDocumentId,
    serverBytes: untouchedServer.update.length,
    warmCacheA: untouchedWarmA,
    warmCacheB: untouchedWarmB,
    coldCacheA: untouchedColdA,
    coldCacheB: untouchedColdB,
    warmMirrorA: mirrorWarmA,
    warmMirrorB: mirrorWarmB,
    coldMirrorA: mirrorColdA,
    coldMirrorB: mirrorColdB,
    untouchedSourceDurableInEveryClient:
      untouchedColdA != null && untouchedColdB != null,
    completeMirrorManifest:
      mirrorColdA?.complete === true
      && mirrorColdB?.complete === true
      && mirrorColdA.graphIncarnation === mirrorColdB.graphIncarnation
      && mirrorColdA.documentIds.includes(untouchedDocumentId)
      && mirrorColdB.documentIds.includes(untouchedDocumentId)
      && untouchedColdA != null
      && untouchedColdB != null,
    finding: 'both cold browser profiles retain the explicit complete manifest and the never-activated document body',
  }

  await editBrowser(clientA, MARKERS.a1, 'a1', true)
  await editBrowser(clientB, MARKERS.b1, 'b1')
  assert((await documentCacheRecord(clientA, primaryDocumentId))?.authority === 'offline',
    'A cache authority is offline after edit')
  assert((await documentCacheRecord(clientB, primaryDocumentId))?.authority === 'offline',
    'B cache authority is offline after edit')

  // Process/renderer restart after the durability testimony: no JS object may
  // carry A's edit into the next assertion.
  clientA = await restartBrowserClient(clientA)
  await ensureOfflineDocument(clientA, primaryDocumentId, [MARKERS.a1])
  await editBrowser(clientA, MARKERS.a2, 'a2')

  appendMarker(observer.doc, MARKERS.c1, 'c1')
  await waitServerTruth(mcp, primaryDocumentId, [MARKERS.c1], ['c1'])
  await mcp.toolsCall('insert_blocks', {
    graphId,
    documentId: primaryDocumentId,
    content: MARKERS.mcp1,
    format: 'markdown',
  })
  await waitServerTruth(mcp, primaryDocumentId, [MARKERS.c1, MARKERS.mcp1], ['c1'])

  await setPartition(clientA, false)
  await waitBrowserTruth(
    clientA,
    [MARKERS.a1, MARKERS.a2, MARKERS.c1, MARKERS.mcp1],
    ['a1', 'a2', 'c1'],
    'live',
  )
  await setPartition(clientB, false)
  const round1Markers = [MARKERS.a1, MARKERS.a2, MARKERS.b1, MARKERS.c1, MARKERS.mcp1]
  const round1Keys = ['a1', 'a2', 'b1', 'c1']
  await assertConverged(clientA, clientB, mcp, round1Markers, round1Keys)

  // Reconnect is idempotent: no-op disconnect/reconnect cycles cannot duplicate
  // any CRDT insertion.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await setPartition(clientA, true)
    await setPartition(clientA, false)
    await waitBrowserTruth(clientA, round1Markers, round1Keys, 'live')
  }
  await assertConverged(clientA, clientB, mcp, round1Markers, round1Keys)

  // Reverse delivery order on a second concurrent round.
  await setPartition(clientA, true)
  await setPartition(clientB, true)
  await editBrowser(clientA, MARKERS.aRound2, 'aRound2')
  await editBrowser(clientB, MARKERS.bRound2, 'bRound2')
  appendMarker(observer.doc, MARKERS.cRound2, 'cRound2')
  await waitServerTruth(mcp, primaryDocumentId, [MARKERS.cRound2], ['cRound2'])
  await setPartition(clientB, false)
  await waitBrowserTruth(clientB, [MARKERS.bRound2, MARKERS.cRound2], ['bRound2', 'cRound2'], 'live')
  await setPartition(clientA, false)
  const allMarkers = [...round1Markers, MARKERS.aRound2, MARKERS.bRound2, MARKERS.cRound2]
  const allKeys = [...round1Keys, 'aRound2', 'bRound2', 'cRound2']
  await assertConverged(clientA, clientB, mcp, allMarkers, allKeys)

  // One browser edits while Gardend dies. The cell profile, port, and token all
  // rotate; Vite rereads the loopback manifest for every HTTP/WS attempt.
  await setPartition(clientB, true)
  await editBrowser(clientB, MARKERS.reboot, 'reboot')
  await waitServerTruth(mcp, primaryDocumentId, allMarkers, allKeys)
  observer.destroy()
  observer = null
  await hardKill(cell)
  cell = await spawnGardend({ bin: binary, profileDir: cellProfile, readyTimeoutMs: 45_000 })
  publishLoopback(cell)
  mcp = mcpFor(cell)
  observer = await connectNodePeer(cell, primaryDocumentId, 'C-after-crash')
  await setPartition(clientB, false)
  await waitBrowserTruth(clientB, [MARKERS.reboot], ['reboot'], 'live')
  await waitBrowserTruth(clientA, allMarkers, allKeys, 'live')
  const postCrashMarkers = [...allMarkers, MARKERS.reboot]
  const postCrashKeys = [...allKeys, 'reboot']
  await assertConverged(clientA, clientB, mcp, postCrashMarkers, postCrashKeys)

  // A second process death proves the merged result is disk truth, not merely
  // a live room retained by the first replacement process.
  await waitServerTruth(mcp, primaryDocumentId, postCrashMarkers, postCrashKeys)
  observer.destroy()
  observer = null
  await hardKill(cell)
  cell = await spawnGardend({ bin: binary, profileDir: cellProfile, readyTimeoutMs: 45_000 })
  publishLoopback(cell)
  mcp = mcpFor(cell)
  await waitServerTruth(mcp, primaryDocumentId, postCrashMarkers, postCrashKeys)
  evidence.processRestart = {
    randomPort: cell.manifest.port,
    postCrashMarkerCount: postCrashMarkers.length,
  }

  evidence.snapshotIdentityRace = await exerciseSnapshotIdentityRace(mcp)

  // Delete wins over an offline client, but local work is recoverable and a
  // same-ID recreation receives a fresh fenced authority.
  await mcp.toolsCall('create_document', {
    graphId,
    documentId: deletedDocumentId,
    title: 'Delete Boundary',
  })
  await mcp.toolsCall('write_document', {
    graphId,
    documentId: deletedDocumentId,
    content: 'DELETE-BASELINE',
    awaitDurable: true,
  })
  await waitServerTruth(mcp, deletedDocumentId, ['DELETE-BASELINE'], [])
  await dispatchOpen(clientA, deletedDocumentId)
  await waitBrowserTruth(clientA, ['DELETE-BASELINE'], [], 'live')
  const deletedWarm = await waitFor(
    () => documentCacheRecord(clientA!, deletedDocumentId),
    record => record?.authority === 'live' && Boolean(record.incarnation),
    'deleted-document warm cache',
  )
  assert(deletedWarm?.incarnation, 'deleted-document cache has an incarnation')
  await setPartition(clientA, true)
  clientA = await restartBrowserClient(clientA)
  await ensureOfflineDocument(clientA, deletedDocumentId, ['DELETE-BASELINE'])
  await editBrowser(clientA, MARKERS.deleted, 'deletedLocal')

  await mcp.toolsCall('delete_document', {
    graphId,
    documentId: deletedDocumentId,
  })
  await waitFor(
    async () => {
      try {
        await mcp!.documentSnapshot(graphId, deletedDocumentId)
        return false
      } catch (error) {
        return (error as { status?: number }).status === 404
      }
    },
    Boolean,
    'canonical document tombstone',
  )
  await setPartition(clientA, false)
  const conflict = await waitBrowserTruth(
    clientA,
    ['DELETE-BASELINE', MARKERS.deleted],
    ['deletedLocal'],
    'conflict',
  )
  assert(conflict.conflict === 'deleted', `delete conflict is explicit: ${JSON.stringify(conflict)}`)
  assert(conflict.editable === 'false', 'deleted authority locks further editing')
  assert(await documentCacheRecord(clientA, deletedDocumentId) === null,
    'deleted primary cache cannot resurrect the document')
  const recoveries = await recoveryRecords(clientA, deletedDocumentId)
  assert(recoveries.length === 1, `exactly one recovery exists: ${JSON.stringify(recoveries.map(r => r.reason))}`)
  const recoveredTruth = truthOf(new Uint8Array(recoveries[0]!.update))
  assert(recoveredTruth.text.includes(MARKERS.deleted), 'recovery contains the offline edit')
  const staleStatus = await expectIncarnationRejected(
    cell,
    deletedDocumentId,
    deletedWarm.incarnation,
  )
  assert(staleStatus === 404 || staleStatus === 409, `stale room rejected with 404/409, got ${staleStatus}`)

  await mcp.toolsCall('write_document', {
    graphId,
    documentId: deletedDocumentId,
    content: 'FRESH-REPLACEMENT',
    awaitDurable: true,
  })
  const replacement = await waitServerTruth(mcp, deletedDocumentId, ['FRESH-REPLACEMENT'], [])
  assert(
    replacement.incarnation !== deletedWarm.incarnation,
    'same-ID recreation has a different incarnation',
  )
  assert(!replacement.text.includes(MARKERS.deleted), 'replacement did not absorb recovery state')
  await clientA.page.reload({ waitUntil: 'domcontentloaded' })
  await waitBrowserTruth(clientA, ['FRESH-REPLACEMENT'], [], 'live')
  const replacementBrowser = await hostState(clientA)
  assert(!replacementBrowser.text.includes(MARKERS.deleted), 'fresh browser activation excludes old recovery')
  const recoveryAfterReopen = await recoveryRecords(clientA, deletedDocumentId)
  assert(recoveryAfterReopen.length === 1, 'recovery remains available after safe replacement open')
  evidence.deletionBoundary = {
    staleStatus,
    oldIncarnation: deletedWarm.incarnation,
    newIncarnation: replacement.incarnation,
    recoveryBytes: recoveries[0]!.update.length,
  }

  // Audit the product mutation seam separately from the bounded document GO.
  // The complete mirror has a durable outbox, but a user-facing sidebar rename
  // is only fully offline when this intent reaches that outbox while every
  // `/cell/**` route is partitioned. Keep this as evidence rather than making
  // the document CRDT proof itself fail.
  const outboxBefore = await sourceOutboxRecords(clientA)
  await setPartition(clientA, true)
  await clientA.page.evaluate(({ documentId, currentTitle }) => {
    const sidebar = document.querySelector('mn-sidebar-panel')
    if (!sidebar) throw new Error('offline mutation audit could not find the sidebar')
    sidebar.dispatchEvent(new CustomEvent('mn-sidebar-action', {
      bubbles: true,
      composed: true,
      detail: {
        action: 'rename',
        nodeId: documentId,
        node: {
          id: documentId,
          label: currentTitle,
          kind: 'document',
          parentId: null,
          section: 'documents',
        },
        proposedLabel: 'Offline queued rename',
      },
    }))
  }, { documentId: primaryDocumentId, currentTitle: 'Distributed Truth' })
  await sleep(750)
  const outboxAfter = await sourceOutboxRecords(clientA)
  const offlineRenameQueued = outboxAfter.length > outboxBefore.length
  evidence.offlineMutationPrecheck = {
    outboxBefore,
    outboxAfter,
    offlineRenameQueued,
  }
  assert(offlineRenameQueued, 'offline sidebar rename reaches the durable source outbox')
  const optimisticLabel = await waitFor(
    () => sidebarNodeLabel(clientA!, primaryDocumentId),
    value => value.includes('Offline queued rename'),
    'offline rename projected into the active Surface',
  )

  // Kill every renderer object while the route remains partitioned. The
  // title must be reconstructed from mirror + outbox, not retained UI state.
  clientA = await restartBrowserClient(clientA)
  const coldOptimisticLabel = await waitFor(
    () => sidebarNodeLabel(clientA!, primaryDocumentId),
    value => value.includes('Offline queued rename'),
    'cold offline rename read-your-writes projection',
  )
  const coldOutbox = await sourceOutboxRecords(clientA)
  evidence.offlineMutationRouting = {
    intent: 'sidebar document rename while every cell route is partitioned',
    outboxBefore,
    outboxAfter,
    coldOutbox,
    offlineRenameQueued,
    optimisticLabel,
    coldOptimisticLabel,
    coldRestartReadYourWrites: coldOptimisticLabel.includes('Offline queued rename'),
    finding: offlineRenameQueued
      ? 'the user-facing mutation was durably accepted and cold-projected by the source mirror'
      : 'the user-facing mutation bypassed the source outbox and remained an online-only MCP call',
  }
  await setPartition(clientA, false, { reload: false })
  await waitFor(
    async () => {
      const current = await sourceOutboxRecords(clientA!)
      return current.some(record =>
        record.kind === 'crdtCommand'
        && record.status === 'applied'
        && !outboxBefore.some(previous => previous.operationId === record.operationId))
    },
    Boolean,
    'offline rename source receipt',
  )
  const canonicalRename = await waitFor(
    async () => mcp!.callTool('sparql_query', {
      graphId,
      query: canonicalDocumentTitleSparql(graphId, primaryDocumentId),
    }),
    result => JSON.stringify(result).includes('Offline queued rename'),
    'canonical projection witnesses offline rename',
  )
  ;(evidence.offlineMutationRouting as Record<string, unknown>).canonicalWitness =
    canonicalRename

  const formatted = await hostState(clientB)
  assert(
    JSON.stringify(formatted.json).includes('"type":"bold"'),
    'offline browser formatting survived distributed convergence',
  )
  assert(clientA.pageErrors.length === 0, `A page errors: ${clientA.pageErrors.join('\n')}`)
  assert(clientB.pageErrors.length === 0, `B page errors: ${clientB.pageErrors.join('\n')}`)
  assert(
    createHash('sha256').update(readFileSync(binary)).digest('hex') === binarySha256,
    'Gardend binary did not change during the browser proof',
  )

  const report = {
    ok: true,
    verdict: 'GO',
    scope: 'complete identity-fenced source mirror + offline document editing',
    provenance: {
      gardend: {
        path: binary,
        sha256: binarySha256,
      },
      browserEngine,
    },
    participants: [
      `persistent ${browserEngine} A`,
      `persistent ${browserEngine} B`,
      'Node y-websocket C',
      'MCP',
      'Gardend disk profile',
    ],
    scenarios: {
      coldRendererRestartOffline: true,
      editableBeforeNetwork: true,
      perEditIndexedDbDurability: true,
      concurrentOfflineClients: true,
      concurrentServerClient: true,
      concurrentMcpBlockWriter: true,
      reconnectOrders: ['A→B', 'B→A'],
      reconnectIdempotenceCycles: 3,
      hardGardendRestarts: 2,
      awarenessAbsentOffline: true,
      deleteWins: true,
      localRecoveryPreserved: true,
      sameIdRecreationFenced: true,
      snapshotDeleteRecreateAtomic: true,
      bodyFormattingAndIndependentYMap: true,
      untouchedDocumentProvesCompleteMirror: true,
      pendingProductReadYourWritesColdRestart: true,
      pendingProductIntentReconciles: true,
    },
    evidence,
    pageErrors: {
      A: clientA.pageErrors,
      B: clientB.pageErrors,
    },
  }
  const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(
    '[offline-sync-later:gardend] FAILED',
    error instanceof Error ? error.stack ?? error.message : error,
  )
  console.error(JSON.stringify({
    evidence,
    clientA: clientA && {
      partitioned: clientA.partitioned,
      pageErrors: clientA.pageErrors,
      consoleErrors: clientA.consoleErrors,
      unexpectedFailures: clientA.unexpectedFailures,
      sockets: clientA.documentSockets,
      diagnostics: await browserDiagnostics(clientA),
      workspaceCache: await workspaceCacheRecord(clientA).catch(() => null),
      documentCache: await documentCacheRecord(clientA, primaryDocumentId).catch(() => null),
    },
    clientB: clientB && {
      partitioned: clientB.partitioned,
      pageErrors: clientB.pageErrors,
      consoleErrors: clientB.consoleErrors,
      unexpectedFailures: clientB.unexpectedFailures,
      sockets: clientB.documentSockets,
      diagnostics: await browserDiagnostics(clientB),
      workspaceCache: await workspaceCacheRecord(clientB).catch(() => null),
      documentCache: await documentCacheRecord(clientB, primaryDocumentId).catch(() => null),
    },
  }, null, 2))
  throw error
} finally {
  observer?.destroy()
  await clientA?.context.close().catch(() => undefined)
  await clientB?.context.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  if (previousLoopbackManifest === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
  else process.env.GARDEND_LOOPBACK_MANIFEST = previousLoopbackManifest
  await cell?.kill().catch(() => undefined)
  rmSync(runRoot, { recursive: true, force: true })
}
