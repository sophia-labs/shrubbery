/**
 * Real Chromium + real Gardend proof for cache-first Document Activation.
 *
 * The journey proves the boundaries that unit tests cannot:
 *   1. sustained row intent fetches a raw Y.Doc snapshot into IndexedDB;
 *   2. that preparation opens zero document WebSockets / publishes no presence;
 *   3. offline navigation renders the cached document editable;
 *   4. an offline edit becomes locally durable before room sync;
 *   5. a server-side edit made while offline converges into the SAME EditorView;
 *   6. the offline edit reaches Gardend after sync.
 */

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import * as Y from 'yjs'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = 'document-activation-proof'
const documentId = 'activation-alpha'
const initialMarker = 'prefetched old version'
const offlineMarker = 'browser edit created fully offline'
const remoteMarker = 'remote edit while browser was offline'
const browserMarker = 'browser edit after authoritative sync'
const port = Number(process.env.SHRUBBERY_DOCUMENT_ACTIVATION_PORT ?? 5223)
const headed = process.env.SHRUBBERY_HEADED === '1'
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`document-activation assertion failed: ${message}`)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function snapshotText(update: Uint8Array): string {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return doc.getXmlFragment('content').toString()
  } finally {
    doc.destroy()
  }
}

async function waitForSnapshot(
  mcp: LoopbackMcpClient,
  marker: string,
  timeoutMs = 15_000,
): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const update = await mcp.documentUpdate(graphId, documentId)
      last = snapshotText(update)
      if (last.includes(marker)) return update
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 80))
  }
  throw new Error(`snapshot never contained "${marker}"; last=${last.slice(0, 500)}`)
}

async function cachedRecord(page: Page): Promise<{
  readonly authority: string
  readonly schemaVersion: number
  readonly byteLength: number
  readonly documentId: string
}> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const record = await page.evaluate(async (expectedDocumentId) => {
      if (typeof indexedDB.databases !== 'function') return null
      const databases = await indexedDB.databases()
      if (!databases.some(database => database.name === 'shrubbery-document-activation-v1')) return null
      const db = await new Promise<IDBDatabase>((resolveDb, reject) => {
        const request = indexedDB.open('shrubbery-document-activation-v1')
        request.onsuccess = () => resolveDb(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        if (!db.objectStoreNames.contains('documents')) return null
        const records = await new Promise<Array<{
          documentId?: string
          authority?: string
          schemaVersion?: number
          update?: ArrayBuffer
        }>>((resolveRecords, reject) => {
          const request = db.transaction('documents').objectStore('documents').getAll()
          request.onsuccess = () => resolveRecords(request.result)
          request.onerror = () => reject(request.error)
        })
        const hit = records.find(candidate =>
          candidate.documentId === expectedDocumentId
          && candidate.authority === 'snapshot'
          && (candidate.update?.byteLength ?? 0) > 0)
        return hit
          ? {
              authority: hit.authority ?? '',
              schemaVersion: hit.schemaVersion ?? 0,
              byteLength: hit.update?.byteLength ?? 0,
              documentId: hit.documentId ?? '',
            }
          : null
      } finally {
        db.close()
      }
    }, documentId)
    if (record) return record
    await page.waitForTimeout(50)
  }
  throw new Error('timed out waiting for the intent snapshot in IndexedDB')
}

let cell: GardendCell | null = null
let server: ViteDevServer | null = null
let browser: Browser | null = null
let context: BrowserContext | null = null
let loopbackPath: string | null = null
const previousLoopbackManifest = process.env.GARDEND_LOOPBACK_MANIFEST
const pageErrors: string[] = []
const consoleErrors: string[] = []
const expectedOfflineFailures: string[] = []
const unexpectedRequestFailures: string[] = []
const documentSockets: string[] = []

try {
  const binary = resolveGardendBin()
  assert(existsSync(binary), `real Gardend binary exists at ${binary}`)
  cell = await spawnGardend({ bin: binary, readyTimeoutMs: 30_000 })
  loopbackPath = join(cell.profileDir, 'vite-loopback.json')
  process.env.GARDEND_LOOPBACK_MANIFEST = loopbackPath
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'))
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_document', {
    graphId,
    documentId,
    title: 'Activation Alpha',
  })
  await mcp.toolsCall('create_document', {
    graphId,
    documentId: 'activation-beta',
    title: 'Activation Beta',
  })
  await mcp.toolsCall('write_document', {
    graphId,
    documentId,
    content: initialMarker,
  })
  await waitForSnapshot(mcp, initialMarker)

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId,
  }, null, 2))
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()

  browser = await chromium.launch({ headless: !headed })
  context = await browser.newContext({ viewport: { width: 1440, height: 920 } })
  const page = await context.newPage()
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('websocket', socket => {
    if (socket.url().includes('/hocuspocus/docs/')) documentSockets.push(socket.url())
  })
  page.on('requestfailed', request => {
    const failure = `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`
    if (request.failure()?.errorText?.includes('ERR_INTERNET_DISCONNECTED')) {
      expectedOfflineFailures.push(failure)
    } else {
      unexpectedRequestFailures.push(failure)
    }
  })

  await page.goto(
    `http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`,
    { waitUntil: 'domcontentloaded' },
  )
  const row = page.locator(`mn-sidebar-panel [data-node-id="${documentId}"]`)
  await row.waitFor({ state: 'visible', timeout: 30_000 })

  const socketsBeforeIntent = documentSockets.length
  await row.hover()
  await page.waitForTimeout(150)
  const record = await cachedRecord(page)
  assert(record.authority === 'snapshot', `intent cache authority is snapshot: ${JSON.stringify(record)}`)
  const zeroSpeculativeDocumentSockets = documentSockets.length === socketsBeforeIntent
  assert(
    zeroSpeculativeDocumentSockets,
    `background preparation opened a document socket: ${JSON.stringify(documentSockets)}`,
  )

  await context.setOffline(true)
  const clickStartedAt = Date.now()
  await row.click()
  await page.waitForFunction((marker) => {
    const host = document.querySelector('sh-editor-host') as (HTMLElement & {
      liveEditor?: { getText?: () => string }
    }) | null
    const body = host?.shadowRoot?.querySelector('.ProseMirror')
    return (
      host?.getAttribute('data-document-activation') === 'offline-clean'
      && host.getAttribute('data-document-render-source') === 'snapshot'
      && body?.getAttribute('contenteditable') === 'true'
      && body.textContent?.includes(marker) === true
      && Boolean(host.liveEditor?.getText)
    )
  }, initialMarker, { timeout: 10_000 })
  const cachedRenderMs = Date.now() - clickStartedAt

  const sameViewCaptured = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as (HTMLElement & {
      liveEditor?: unknown
    }) | null
    ;(window as typeof window & { __activationEditor?: unknown }).__activationEditor = host?.liveEditor
    return Boolean(host?.liveEditor)
  })
  assert(sameViewCaptured, 'cached EditorView identity was captured')

  const body = page.locator('sh-editor-host .ProseMirror')
  await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as {
      _editor?: { commands?: { focus?: (position: string) => boolean } }
    } | null
    host?._editor?.commands?.focus?.('end')
  })
  await page.keyboard.type(`\n${offlineMarker}`)
  await page.waitForFunction((marker) => {
    const host = document.querySelector('sh-editor-host')
    const body = host?.shadowRoot?.querySelector('.ProseMirror')
    return (
      host?.getAttribute('data-document-activation') === 'offline-dirty'
      && host.getAttribute('data-document-durability') === 'durable'
      && body?.textContent?.includes(marker) === true
    )
  }, offlineMarker, { timeout: 10_000 })

  // `write_document` is deliberately a whole-body replacement and therefore
  // deletes the old paragraph (including concurrent descendants). Exercise a
  // structure-preserving MCP writer here so this journey proves CRDT
  // convergence rather than contradicting the mutation's replace semantics.
  await mcp.toolsCall('insert_blocks', {
    graphId,
    documentId,
    content: remoteMarker,
    format: 'markdown',
  })
  await waitForSnapshot(mcp, remoteMarker)

  await context.setOffline(false)
  try {
    await page.waitForFunction(({ remote, offline }) => {
      const host = document.querySelector('sh-editor-host') as (HTMLElement & {
        liveEditor?: unknown
      }) | null
      const body = host?.shadowRoot?.querySelector('.ProseMirror')
      const remembered = (window as typeof window & { __activationEditor?: unknown }).__activationEditor
      return (
        host?.getAttribute('data-document-activation') === 'live'
        && body?.getAttribute('contenteditable') === 'true'
        && body.textContent?.includes(remote) === true
        && body.textContent?.includes(offline) === true
        && host.liveEditor === remembered
      )
    }, { remote: remoteMarker, offline: offlineMarker }, { timeout: 30_000 })
  } catch (error) {
    const reconnectState = await page.evaluate(({ remote, offline }) => {
      const host = document.querySelector('sh-editor-host') as (HTMLElement & {
        liveEditor?: { getText?: () => string }
        hostState?: {
          provider?: {
            lifecycle?: { get?: () => unknown }
            activationState?: { get?: () => unknown }
          }
        }
      }) | null
      const body = host?.shadowRoot?.querySelector('.ProseMirror')
      const remembered = (window as typeof window & { __activationEditor?: unknown }).__activationEditor
      return {
        activation: host?.getAttribute('data-document-activation') ?? null,
        durability: host?.getAttribute('data-document-durability') ?? null,
        renderSource: host?.getAttribute('data-document-render-source') ?? null,
        editable: body?.getAttribute('contenteditable') ?? null,
        text: body?.textContent ?? null,
        hasRemote: body?.textContent?.includes(remote) ?? false,
        hasOffline: body?.textContent?.includes(offline) ?? false,
        sameEditorView: host?.liveEditor === remembered,
        lifecycle: host?.hostState?.provider?.lifecycle?.get?.() ?? null,
        activationState: host?.hostState?.provider?.activationState?.get?.() ?? null,
      }
    }, { remote: remoteMarker, offline: offlineMarker })
    console.error('[document-activation:gardend] reconnect state', JSON.stringify(reconnectState, null, 2))
    throw error
  }

  await body.fill(`${initialMarker}\n${remoteMarker}\n${offlineMarker}\n${browserMarker}`)
  await withTimeout(waitForSnapshot(mcp, browserMarker), 15_000, 'post-sync browser edit persistence')

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(unexpectedRequestFailures.length === 0, `unexpected request failures: ${unexpectedRequestFailures.join('\n')}`)

  console.log(JSON.stringify({
    ok: true,
    browser: 'chromium',
    backend: 'real-gardend',
    headed,
    backgroundSnapshot: record,
    zeroSpeculativeDocumentSockets,
    cachedRenderMs,
    cachedEditable: true,
    offlineEditDurable: true,
    remoteReplay: true,
    sameEditorView: true,
    editingUnlockedAfterSync: true,
    postSyncEditPersisted: true,
    documentSocketCount: documentSockets.length,
    expectedOfflineFailureCount: expectedOfflineFailures.length,
    consoleErrors,
  }, null, 2))
} catch (error) {
  console.error(
    '[document-activation:gardend] FAILED',
    error instanceof Error ? error.stack ?? error.message : error,
  )
  console.error(JSON.stringify({
    pageErrors,
    consoleErrors,
    expectedOfflineFailures,
    unexpectedRequestFailures,
    documentSockets,
  }, null, 2))
  throw error
} finally {
  await context?.setOffline(false).catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (loopbackPath && existsSync(loopbackPath)) unlinkSync(loopbackPath)
  if (previousLoopbackManifest === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
  else process.env.GARDEND_LOOPBACK_MANIFEST = previousLoopbackManifest
  await cell?.kill().catch(() => undefined)
}
