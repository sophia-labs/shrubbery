import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  createSophiaClusterLeadProfile,
  SOPHIA_CLUSTER_LEAD_HARNESS,
} from '@shrubbery/domain-kit/agent-studio'
import { chromium } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dynamicCellProxy } from '../../../scripts/vite-cell-proxy.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  resolveGardendBin,
  spawnGardend,
} from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'sophia-cluster'
const AUTHORITY_GRAPH_ID = 'observatory'
const PROFILE_ID = 'agent-studio-profile'
const HARNESS_ID = 'sophia-cluster-lead-harness-v1'
const DEFINITION_ID = 'domain-agent-definition'
const OWNER = 'user:vera'
const RUNTIME_DIGEST = process.env.SOPHIA_AGENT_RUNTIME_BUNDLE_DIGEST
  ?? 'sha256:b4204cf4d26f9d2d1e8495d948e628fafb3e188ea28fb1a75f8b5853eeb306a7'
const TIMEOUT_MS = 30_000

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const uxSeed = readFileSync(resolve(appDir, 'seeds/sophia-cluster-workspace.ux.nt'), 'utf8')
const manifestDir = mkdtempSync(resolve(tmpdir(), 'shrubbery-agent-studio.'))
const manifestPath = resolve(manifestDir, 'loopback.json')
const screenshotPath = process.env.SOPHIA_AGENT_STUDIO_SCREENSHOT
  ?? resolve(tmpdir(), 'sophia-cluster-agent-studio.png')

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
let cleanupError: unknown = null
let runError: unknown = null

try {
  const bin = resolveGardendBin()
  assert.equal(existsSync(bin), true, `real gardend binary does not exist: ${bin}`)
  cell = await bounded('gardend startup', spawnGardend({ bin, readyTimeoutMs: TIMEOUT_MS }))
  await bounded('workspace seed', createGraphAndSeedUxConfig(cell, GRAPH_ID, uxSeed, 'Sophia Cluster'))
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await call(mcp, 'create_graph', { graph_id: AUTHORITY_GRAPH_ID, title: 'Observatory' })
  const profile = createSophiaClusterLeadProfile({ ownerPrincipal: OWNER, runtimeBundleDigest: RUNTIME_DIGEST })
  await call(mcp, 'write_document', {
    graphId: GRAPH_ID,
    documentId: HARNESS_ID,
    title: 'Sophia Cluster lead Agent harness',
    content: canonicalJson(SOPHIA_CLUSTER_LEAD_HARNESS),
    expectedRevision: 0,
    awaitDurable: true,
  })
  await call(mcp, 'write_document', {
    graphId: GRAPH_ID,
    documentId: PROFILE_ID,
    title: 'Sophia Cluster lead Agent profile',
    content: canonicalJson(profile),
    expectedRevision: 0,
    awaitDurable: true,
  })

  writeFileSync(manifestPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }))
  vite = await bounded('Vite construction', createServer({
    root: appDir,
    configFile: false,
    plugins: [dynamicCellProxy({ manifestPath, websocket: true, upstreamTimeoutMs: TIMEOUT_MS })],
    optimizeDeps: { exclude: ['oxigraph'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    logLevel: 'warn',
  }))
  await bounded('Vite startup', vite.listen())
  const address = vite.httpServer?.address()
  assert.ok(address && typeof address !== 'string', 'Vite did not expose a receipt port')
  const origin = `http://127.0.0.1:${address.port}`

  browser = await chromium.launch({ headless: process.env.HEADED !== '1', timeout: TIMEOUT_MS })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(TIMEOUT_MS)
  page.setDefaultNavigationTimeout(TIMEOUT_MS)
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const requestFailures: string[] = []
  const responseErrors: string[] = []
  const requests: string[] = []
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
  page.on('request', request => requests.push(request.url()))
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))
  page.on('response', response => { if (response.status() >= 400) responseErrors.push(`${response.status()} ${response.url()}`) })

  await page.goto(`${origin}/?source=cell&graph=${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  const studio = page.locator('mn-agent-studio-editor')
  await studio.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const root = document.querySelector('mn-agent-studio-editor')?.shadowRoot
    return root?.textContent?.includes('Durable source') && root?.textContent?.includes('Runtime profiles')
  })
  assert.equal(await page.locator('mn-agent-studio-editor').count(), 1, 'workspace mounted more than one Agent Studio')
  const studioText = await studio.evaluate(element => element.shadowRoot?.textContent ?? '')
  for (const section of ['System prompt', 'Charter', 'Geist', 'Runtime profiles', 'Skills & harness', 'Tool manifest', 'Tool grant', 'Triggers']) {
    assert.ok(studioText.includes(section), `Agent Studio omitted ${section}`)
  }

  await studio.evaluate((element) => {
    const labels = [...element.shadowRoot!.querySelectorAll('label')]
    const input = labels.find(label => label.textContent?.includes('Display name'))?.querySelector('input')
    if (!input) throw new Error('Display name input is absent')
    input.value = 'Sophia Cluster Lead · Local Proof'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await studio.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('mn-agent-studio-editor')?.shadowRoot?.textContent?.includes('Draft saved and reread from Garden.'))
  await studio.getByText('New Sessions may use this version').locator('input').check()
  await studio.getByRole('button', { name: 'Publish', exact: true }).click()
  try {
    await page.waitForFunction(() => document.querySelector('mn-agent-studio-editor')?.shadowRoot?.textContent?.includes('Published asp_'))
  } catch (error) {
    const receiptText = await studio.evaluate(element => element.shadowRoot?.textContent ?? '')
    throw new Error(`Agent Studio publication did not settle: ${receiptText.slice(0, 2_000)}`, { cause: error })
  }

  const definition = await readJsonDocument(mcp, GRAPH_ID, DEFINITION_ID)
  assert.equal(definition.schema, 'sophia.domain-agent-definition.v2')
  assert.equal(definition.registeredName, 'sophia-cluster-lead')
  assert.equal((definition.models as Record<string, unknown>).pilot, 'gpt-5.6-sol')
  const grantRef = definition.grantRef as Record<string, unknown>
  assert.equal(grantRef.graphId, AUTHORITY_GRAPH_ID)
  const grant = await readJsonDocument(mcp, AUTHORITY_GRAPH_ID, String(grantRef.documentId))
  assert.equal(grant.schema, 'sophia.agent-toolbelt-grant.v1')

  const cellOrigin = new URL(cell.apiUrl).origin
  assert.equal(requests.some(url => url.startsWith(cellOrigin)), false, 'browser reached the token-bearing loopback directly')
  assert.equal(requests.some(url => url.includes(cell!.token)), false, 'browser URL leaked the cell token')
  assert.equal(requests.some(url => new URL(url).pathname === '/cell/mcp'), true, 'browser did not use the real same-origin MCP path')
  assert.deepEqual({ pageErrors, consoleErrors, requestFailures, responseErrors }, {
    pageErrors: [], consoleErrors: [], requestFailures: [], responseErrors: [],
  })
  await bounded('Agent Studio screenshot', page.screenshot({ path: screenshotPath, fullPage: true }))

  console.log(JSON.stringify({
    schema: 'sophia.agent-studio-browser-receipt.v1',
    graphId: GRAPH_ID,
    activeDefinition: DEFINITION_ID,
    agentId: definition.agentId,
    provider: (definition.models as Record<string, unknown>).provider,
    sections: 13,
    sameOriginMcpRequests: requests.filter(url => new URL(url).pathname === '/cell/mcp').length,
    directLoopbackRequests: 0,
    screenshotPath,
    errors: { page: 0, console: 0, request: 0, response: 0 },
  }, null, 2))
} catch (error) {
  runError = error
} finally {
  for (const cleanup of [
    async () => await browser?.close(),
    async () => await vite?.close(),
    async () => await cell?.kill(),
    async () => await rm(manifestDir, { recursive: true, force: true }),
  ]) {
    try { await bounded('receipt cleanup', cleanup()) } catch (error) { cleanupError ??= error }
  }
}

if (runError) throw runError
if (cleanupError) throw cleanupError

async function call(mcp: LoopbackMcpClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  return bounded(`${name} MCP call`, mcp.callTool(name, args))
}

async function readJsonDocument(mcp: LoopbackMcpClient, graphId: string, documentId: string): Promise<Record<string, unknown>> {
  const result = await call(mcp, 'read_document', { graphId, documentId, format: 'markdown' }) as Record<string, unknown>
  assert.equal(typeof result.content, 'string', `${graphId}/${documentId} returned no content`)
  const trimmed = (result.content as string).trim()
  const fenced = /^```json\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return JSON.parse(fenced?.[1] ?? trimmed) as Record<string, unknown>
}

async function bounded<T>(label: string, operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
