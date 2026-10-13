/**
 * Real Chromium + real gardend reproduction for the 2026-09-23 senderos
 * evidence-list loss (investigated 2026-09-25).
 *
 * An agent seeds a document through MCP with a block shape the web editor's
 * schema may not know (the W1 seed wrote nested `bulletList > listItem >
 * paragraph`). A human then OPENS the document in the SPA — no typing. The
 * journey reads the stored document back through MCP before and after the open
 * and fails if any top-level block (by data-block-id) or any text vanished.
 *
 * Env:
 *   GARDEN_BIN              gardend binary (real; no mock)
 *   UNKNOWN_BLOCKS_PAYLOADS comma-separated JSON files: either a battery (an
 *                           array of {id, title, via, body}; via =
 *                           write_document | insert_blocks | create_document_once)
 *                           or one W1-style `create_document_once` payload
 *                           ({title, tiptapJson}); default =
 *                           scripts/fixtures/unknown-blocks-battery.json
 *   UNKNOWN_BLOCKS_OUT      directory for before/after JSON transcripts
 *   UNKNOWN_BLOCKS_EXPECT   'loss' ⇒ exit 0 only when loss is observed (repro
 *                           mode); default 'preserve' ⇒ exit 1 on any loss
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import * as Y from 'yjs'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  resolveGardendBin,
  spawnGardend,
} from '../src/cell/spawn-gardend.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const payloadFiles = (process.env.UNKNOWN_BLOCKS_PAYLOADS
  ?? resolve(appDir, 'scripts/fixtures/unknown-blocks-battery.json')).split(',').filter(Boolean)
const outDir = process.env.UNKNOWN_BLOCKS_OUT ?? mkdtempSync(join(tmpdir(), 'unknown-blocks-'))
const expectLoss = process.env.UNKNOWN_BLOCKS_EXPECT === 'loss'
const graphId = 'unknown-blocks-proof'
const port = Number(process.env.SHRUBBERY_UNKNOWN_BLOCKS_PORT ?? 5231)
const settleMs = Number(process.env.UNKNOWN_BLOCKS_SETTLE_MS ?? 4000)
const require_ = createRequire(import.meta.url)
const seedPath = resolve(dirname(require_.resolve('@shrubbery/nucleus')), 'workspace/__generated__/garden-default.ux.nt')

interface Shape {
  readonly topIds: string[]
  readonly topTypes: Record<string, number>
  readonly text: string
  readonly xml: string
}

function shapeOf(update: Uint8Array): Shape {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    const frag = doc.getXmlFragment('content')
    const topIds: string[] = []
    const topTypes: Record<string, number> = {}
    for (const child of frag.toArray()) {
      if (child instanceof Y.XmlElement) {
        topTypes[child.nodeName] = (topTypes[child.nodeName] ?? 0) + 1
        const id = child.getAttribute('data-block-id')
        topIds.push(typeof id === 'string' ? id : `(${child.nodeName}:no-id)`)
      } else {
        topTypes['#text'] = (topTypes['#text'] ?? 0) + 1
      }
    }
    const xml = frag.toString()
    return { topIds, topTypes, text: xml.replace(/<[^>]+>/g, ''), xml }
  } finally {
    doc.destroy()
  }
}

let cell: GardendCell | null = null
let server: ViteDevServer | null = null
let browser: Browser | null = null
let loopbackPath: string | null = null
const pageErrors: string[] = []
const consoleLines: string[] = []
const results: Array<Record<string, unknown>> = []

mkdirSync(outDir, { recursive: true })
try {
  const binary = resolveGardendBin()
  if (!existsSync(binary)) throw new Error(`gardend not found at ${binary}`)
  cell = await spawnGardend({ bin: binary, readyTimeoutMs: 60_000 })
  loopbackPath = join(cell.profileDir, 'vite-loopback.json')
  process.env.GARDEND_LOOPBACK_MANIFEST = loopbackPath
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'))
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })

  interface Case { id: string; title: string; via: string; body: Record<string, unknown>; seedPath: string }
  const cases: Case[] = []
  for (const file of payloadFiles) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | Case[]
    if (Array.isArray(raw)) {
      for (const c of raw) cases.push({ ...c, seedPath: `${file}#${c.id}` })
    } else {
      cases.push({
        id: (raw.document_id as string | undefined) ?? basename(file, '.json'),
        title: raw.title as string, via: 'create_document_once',
        body: { tiptapJson: raw.tiptapJson }, seedPath: file,
      })
    }
  }
  const docs: Array<{ id: string; title: string; via: string; before: Shape; seedPath: string; writeError?: string }> = []
  for (const [index, c] of cases.entries()) {
    const id = c.id
    const via = c.via
    let writeError: string | undefined
    try {
      if (via === 'create_document_once') {
        const { incarnation } = await mcp.workspaceSnapshot(graphId)
        await mcp.toolsCall('create_document_once', {
          graph_id: graphId, document_id: id, title: c.title, order: index,
          tiptapJson: c.body.tiptapJson, graph_incarnation: incarnation,
        })
      } else {
        await mcp.toolsCall('create_document', { graphId, documentId: id, title: c.title })
        if (via === 'write_document') {
          await mcp.toolsCall('write_document', { graphId, documentId: id, ...c.body })
        } else if (via === 'insert_blocks') {
          await mcp.toolsCall('write_document', { graphId, documentId: id, content: `Anchor paragraph for ${id}.`, format: 'plain' })
          await mcp.toolsCall('insert_blocks', { graphId, documentId: id, ...c.body })
        } else {
          throw new Error(`unknown via ${via}`)
        }
      }
    } catch (error) {
      writeError = String(error).slice(0, 400)
    }
    let before: Shape
    try {
      const bytes = await mcp.documentUpdate(graphId, id)
      writeFileSync(join(outDir, `${id}.before.ydoc.bin`), bytes)
      before = shapeOf(bytes)
    } catch (error) {
      writeError = `${writeError ?? ''} | read: ${String(error).slice(0, 200)}`
      continue
    }
    const beforeJson = await mcp.toolsCall('read_document', { graphId, documentId: id, format: 'json', maxChars: 262144 }).catch(e => String(e))
    writeFileSync(join(outDir, `${id}.before.json`), JSON.stringify({ via, writeError, shape: before, read_document: beforeJson }, null, 2))
    docs.push({ id, title: c.title, via, before, seedPath: c.seedPath, writeError })
  }

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId,
  }, null, 2))
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  page.on('pageerror', e => pageErrors.push(e.stack ?? e.message))
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`) })
  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'domcontentloaded' })

  for (const doc of docs) {
   let openError: string | undefined
   try {
    const row = page.locator(`mn-sidebar-panel [data-node-id="${doc.id}"]`)
    await row.waitFor({ state: 'visible', timeout: 60_000 })
    await row.click()
    await page.waitForFunction(() => {
      const host = document.querySelector('sh-editor-host')
      const body = host?.shadowRoot?.querySelector('.ProseMirror')
      return host?.getAttribute('data-document-activation') === 'live' && (body?.textContent?.length ?? 0) > 0
    }, undefined, { timeout: 20_000 })
   } catch (error) {
    openError = String(error).split('\n')[0]
   }
    // Open only. No keystroke, no click inside the editor.
    await page.waitForTimeout(settleMs)
    const editorInfo = await page.evaluate(() => {
      const host = document.querySelector('sh-editor-host') as (HTMLElement & { liveEditor?: { getJSON?: () => { content?: Array<{ type: string }> } } }) | null
      const json = host?.liveEditor?.getJSON?.()
      const types: Record<string, number> = {}
      for (const n of json?.content ?? []) types[n.type] = (types[n.type] ?? 0) + 1
      return { editorTopTypes: types }
    })
    const after = shapeOf(await mcp.documentUpdate(graphId, doc.id))
    const afterJson = await mcp.toolsCall('read_document', { graphId, documentId: doc.id, format: 'json', maxChars: 262144 })
    writeFileSync(join(outDir, `${doc.id}.after.json`), JSON.stringify({ shape: after, read_document: afterJson, ...editorInfo }, null, 2))
    const lostIds = doc.before.topIds.filter(id => !after.topIds.includes(id))
    results.push({
      documentId: doc.id,
      via: doc.via,
      openError,
      writeError: doc.writeError,
      beforeXml: doc.before.xml.length < 600 ? doc.before.xml : undefined,
      afterXml: after.xml.length < 600 ? after.xml : undefined,
      seed: doc.seedPath,
      beforeTopBlocks: doc.before.topIds.length,
      afterTopBlocks: after.topIds.length,
      beforeTypes: doc.before.topTypes,
      afterTypes: after.topTypes,
      editorTopTypes: editorInfo.editorTopTypes,
      lostIds,
      lostChars: doc.before.text.length - after.text.length,
    })
  }

  const anyLoss = results.some(r => (r.lostIds as string[]).length > 0 || (r.lostChars as number) > 0)
  console.log(JSON.stringify({
    binary, results, anyLoss, pageErrors,
    consoleSample: consoleLines.slice(0, 20),
  }, null, 2))
  process.exitCode = expectLoss ? (anyLoss ? 0 : 1) : (anyLoss ? 1 : 0)
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (loopbackPath && existsSync(loopbackPath)) unlinkSync(loopbackPath)
  await cell?.kill().catch(() => undefined)
}
