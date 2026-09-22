/**
 * Cross-engine durability/atomicity proof for IndexedDbSourceMirrorStorage.
 *
 * A deterministic storage hook aborts real IndexedDB transactions at the same
 * completion boundary used by quota/serialization failures. The previously
 * committed epoch must remain byte-for-byte readable, a rejected outbox intent
 * must not appear, and a later successful epoch must cold-reopen without any
 * surviving JavaScript state. Both Chromium and WebKit run the proof because
 * macOS Tauri uses WKWebView.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  webkit,
  type BrowserContext,
  type Page,
} from 'playwright'
import { createServer, type Plugin, type ViteDevServer } from 'vite'

type JsonObject = Record<string, unknown>

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_IDB_CHAOS_PORT ?? 5237)
const runRoot = mkdtempSync(join(tmpdir(), 'shrubbery-idb-chaos.'))
const origin = `http://127.0.0.1:${port}`
const pageUrl = `${origin}/source-mirror-idb-chaos.html`
const mirrorKey = 'fault-user\u001ffault-graph'
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`source-mirror IndexedDB chaos assertion failed: ${message}`)
}

const harnessPage: Plugin = {
  name: 'source-mirror-idb-chaos-page',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/source-mirror-idb-chaos.html') {
        next()
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><meta charset="utf-8"><title>IndexedDB chaos</title>')
    })
  },
}

async function openHarness(
  context: BrowserContext,
): Promise<Page> {
  const page = await context.newPage()
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const module = await (0, eval)(
      'import("/src/cell/source-mirror-indexeddb.ts")',
    ) as {
      IndexedDbSourceMirrorStorage: new (
        factory: IDBFactory,
        hooks: {
          beforeTransactionComplete(
            kind: 'mirror' | 'outbox' | 'graph-lifecycle',
            transaction: IDBTransaction,
          ): void
        },
      ) => unknown
    }
    const state = window as unknown as {
      __sourceMirrorStorage: unknown
      __sourceMirrorAbortKind: string | null
    }
    state.__sourceMirrorAbortKind = null
    state.__sourceMirrorStorage = new module.IndexedDbSourceMirrorStorage(
      indexedDB,
      {
        beforeTransactionComplete(kind, transaction) {
          if (state.__sourceMirrorAbortKind !== kind) return
          state.__sourceMirrorAbortKind = null
          transaction.abort()
        },
      },
    )
  })
  return page
}

async function abortNext(
  page: Page,
  kind: 'mirror' | 'outbox' | 'graph-lifecycle',
): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __sourceMirrorAbortKind: string | null })
      .__sourceMirrorAbortKind = value
  }, kind)
}

async function commitMirror(
  page: Page,
  epoch: string,
  payloadBytes: number,
): Promise<void> {
  await page.evaluate(async ({ key, epochValue, size }) => {
    const storage = (window as unknown as {
      __sourceMirrorStorage: {
        commitMirror(record: unknown): Promise<void>
      }
    }).__sourceMirrorStorage
    await storage.commitMirror({
      key,
      userId: 'fault-user',
      graphId: 'fault-graph',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      epoch: epochValue,
      committedAt: 1,
      bundle: {
        epoch: epochValue,
        payload: new Uint8Array(size),
        sentinel: `sentinel:${epochValue}`,
      },
    })
  }, { key: mirrorKey, epochValue: epoch, size: payloadBytes })
}

async function readMirror(page: Page): Promise<JsonObject | null> {
  return page.evaluate(async (key) => {
    const storage = (window as unknown as {
      __sourceMirrorStorage: {
        readMirror(key: string): Promise<{
          epoch: string
          bundle: { epoch: string; payload: Uint8Array; sentinel: string }
        } | undefined>
      }
    }).__sourceMirrorStorage
    const record = await storage.readMirror(key)
    return record
      ? {
          epoch: record.epoch,
          bundleEpoch: record.bundle.epoch,
          payloadBytes: record.bundle.payload.byteLength,
          sentinel: record.bundle.sentinel,
        }
      : null
  }, mirrorKey)
}

async function putOutbox(page: Page): Promise<void> {
  await page.evaluate(async (key) => {
    const storage = (window as unknown as {
      __sourceMirrorStorage: {
        putOutbox(record: unknown): Promise<void>
      }
    }).__sourceMirrorStorage
    await storage.putOutbox({
      key: `${key}\u001fquota-operation`,
      mirrorKey: key,
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      operation: {
        kind: 'graphMetadata',
        operationId: 'fault-operation',
        title: 'must not become durable',
        padding: new Uint8Array(2 * 1024 * 1024),
      },
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
      attempts: 0,
    })
  }, mirrorKey)
}

/**
 * master §3 Slice 6: a `resolveCurrent` outbox write aborted at the
 * transaction boundary leaves no partial row. The storage layer's
 * `putOutbox` is generic over `operation.kind` (verified: `commitMirror`/
 * `putOutbox` above never branch on it) — so this exercises the SAME code
 * path the generic `graphMetadata` case above already proves atomic, but
 * with the actual `resolveCurrent` shape this slice's client authors,
 * naming the guarantee master's own text names rather than leaving it
 * merely implied by a differently-shaped operation.
 */
async function putResolveCurrentOutbox(page: Page): Promise<void> {
  await page.evaluate(async (key) => {
    const storage = (window as unknown as {
      __sourceMirrorStorage: {
        putOutbox(record: unknown): Promise<void>
      }
    }).__sourceMirrorStorage
    await storage.putOutbox({
      key: `${key}resolve-fault-operation`,
      mirrorKey: key,
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      operation: {
        kind: 'resolveCurrent',
        operationId: 'resolve-fault-operation',
        objectKey: 'vocabClassobject',
        conflictId: 'conflict-fault',
        chosenOperationId: 'op-must-not-become-durable',
      },
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
      attempts: 0,
    })
  }, mirrorKey)
}

async function outboxCount(page: Page): Promise<number> {
  return page.evaluate(async (key) => {
    const storage = (window as unknown as {
      __sourceMirrorStorage: {
        listOutbox(key: string): Promise<readonly unknown[]>
      }
    }).__sourceMirrorStorage
    return (await storage.listOutbox(key)).length
  }, mirrorKey)
}

let server: ViteDevServer | null = null
let context: BrowserContext | null = null

try {
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    plugins: [harnessPage],
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
    },
    logLevel: 'warn',
  })
  await server.listen()

  const engines = [
    { name: 'chromium', browser: chromium },
    { name: 'webkit', browser: webkit },
  ] as const
  const engineEvidence: JsonObject[] = []
  for (const engine of engines) {
    const profileDir = join(runRoot, `${engine.name}-profile`)
    context = await engine.browser.launchPersistentContext(profileDir, { headless: true })
    let page = await openHarness(context)
    await commitMirror(page, 'epoch-old', 1_024)
    const before = await readMirror(page)
    assert(before?.epoch === 'epoch-old', `${engine.name}: baseline mirror commits`)
    assert(
      before?.sentinel === 'sentinel:epoch-old',
      `${engine.name}: baseline sentinel is readable`,
    )

    await abortNext(page, 'mirror')
    let mirrorAbortRejected = false
    let mirrorAbortError = ''
    try {
      await commitMirror(page, 'epoch-aborted', 256 * 1024)
    } catch (error) {
      mirrorAbortRejected = true
      mirrorAbortError = error instanceof Error ? error.message : String(error)
    }
    assert(mirrorAbortRejected, `${engine.name}: aborted mirror transaction rejects`)
    const afterRejectedMirror = await readMirror(page)
    assert(
      afterRejectedMirror?.epoch === 'epoch-old',
      `${engine.name}: transaction abort preserves previous epoch`,
    )
    assert(
      afterRejectedMirror?.sentinel === 'sentinel:epoch-old',
      `${engine.name}: transaction abort preserves the complete previous value`,
    )
    assert(
      afterRejectedMirror?.payloadBytes === 1_024,
      `${engine.name}: transaction abort exposes no partial replacement`,
    )

    await abortNext(page, 'outbox')
    let outboxAbortRejected = false
    let outboxAbortError = ''
    try {
      await putOutbox(page)
    } catch (error) {
      outboxAbortRejected = true
      outboxAbortError = error instanceof Error ? error.message : String(error)
    }
    assert(outboxAbortRejected, `${engine.name}: aborted outbox transaction rejects`)
    assert(
      await outboxCount(page) === 0,
      `${engine.name}: rejected outbox intent is not exposed as durable`,
    )

    // master §3 Slice 6: the SAME atomicity guarantee, named for the
    // actual `resolveCurrent` shape the client now authors.
    await abortNext(page, 'outbox')
    let resolveCurrentAbortRejected = false
    let resolveCurrentAbortError = ''
    try {
      await putResolveCurrentOutbox(page)
    } catch (error) {
      resolveCurrentAbortRejected = true
      resolveCurrentAbortError = error instanceof Error ? error.message : String(error)
    }
    assert(resolveCurrentAbortRejected, `${engine.name}: an aborted resolveCurrent outbox write rejects`)
    assert(
      await outboxCount(page) === 0,
      `${engine.name}: the aborted resolveCurrent write leaves no partial row`,
    )

    await commitMirror(page, 'epoch-new', 256 * 1024)
    const beforeColdRestart = await readMirror(page)
    assert(
      beforeColdRestart?.epoch === 'epoch-new',
      `${engine.name}: mirror advances after the injected fault clears`,
    )

    await context.close()
    context = null
    context = await engine.browser.launchPersistentContext(profileDir, { headless: true })
    page = await openHarness(context)
    const cold = await readMirror(page)
    assert(
      cold?.epoch === 'epoch-new',
      `${engine.name}: cold browser profile reopens the committed epoch`,
    )
    assert(
      cold?.bundleEpoch === 'epoch-new',
      `${engine.name}: cold profile reopens the matching complete value`,
    )
    assert(
      cold?.payloadBytes === 256 * 1024,
      `${engine.name}: cold profile reopens all committed bytes`,
    )
    engineEvidence.push({
      engine: engine.name,
      mirrorAbortRejected,
      mirrorAbortError,
      priorEpochPreserved: afterRejectedMirror?.epoch === 'epoch-old',
      partialMirrorExposed: false,
      outboxAbortRejected,
      outboxAbortError,
      rejectedOutboxExposed: false,
      resolveCurrentAbortRejected,
      resolveCurrentAbortError,
      rejectedResolveCurrentExposed: false,
      coldEpoch: cold?.epoch,
      coldPayloadBytes: cold?.payloadBytes,
    })
    await context.close()
    context = null
  }

  const report = {
    ok: true,
    verdict: 'GO',
    scope: 'real Chromium + WebKit IndexedDB transaction atomicity and cold durability',
    evidence: {
      origin,
      engines: engineEvidence,
    },
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (context) await context.close().catch(() => {})
  if (server) await server.close().catch(() => {})
  if (process.env.SHRUBBERY_KEEP_TRUTH_PROFILE === '1') {
    process.stderr.write(`[source-mirror-idb-chaos] kept ${runRoot}\n`)
  } else {
    rmSync(runRoot, { recursive: true, force: true })
  }
}
