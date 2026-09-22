import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const graphId = process.env.SOPHIA_NOTEBOOK_GRAPH_ID ?? 'prime-notebook-lab'
const url = process.env.SOPHIA_NOTEBOOK_URL ?? `http://127.0.0.1:5180/?graph=${graphId}`
const origin = new URL(url).origin
const uxGraph = `urn:mnemosyne:local:graph:${graphId}:ux:config`
const uxLayoutJson = 'http://mnemosyne.dev/ux#layoutJson'
const suxFragmentSurface = 'http://sophia.ai/ux#fragmentSurface'
let nextRpcId = 1

interface McpResult {
  readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  readonly structuredContent?: unknown
}

async function graphMcpUrl(): Promise<string> {
  const response = await fetch(`${origin}/cloud2/graphs`)
  const body = await response.text()
  assert.equal(response.ok, true, `GET /cloud2/graphs failed: ${response.status} ${body}`)
  const graphs = JSON.parse(body) as Array<{ graphId?: string; owner?: string }>
  const graph = graphs.find(candidate => candidate.graphId === graphId)
  assert.ok(graph, `graph ${graphId} is absent from GET /graphs`)
  assert.ok(graph.owner, `graph ${graphId} has no stable owner`)
  return `${origin}/cloud2/o/${encodeURIComponent(graph.owner)}/g/${encodeURIComponent(graphId)}/mcp`
}

async function callTool(mcpUrl: string, name: string, args: Record<string, unknown>): Promise<McpResult> {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextRpcId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await response.text()
  assert.equal(response.ok, true, `${name} failed over HTTP ${response.status}: ${body}`)
  const envelope = JSON.parse(body) as { result?: McpResult; error?: unknown }
  assert.equal(envelope.error, undefined, `${name} returned a JSON-RPC error: ${JSON.stringify(envelope.error)}`)
  assert.ok(envelope.result, `${name} returned no result`)
  return envelope.result
}

function resultBody<T>(result: McpResult): T {
  if (result.structuredContent) return result.structuredContent as T
  const text = result.content
    ?.filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('')
  assert.ok(text, 'MCP result carried neither structuredContent nor text')
  return JSON.parse(text) as T
}

function iriLexical(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is not an RDF term string`)
  assert.match(value, /^<[^>]+>$/, `${field} is not an IRI term`)
  return value.slice(1, -1)
}

function literalLexical(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is not an RDF term string`)
  assert.match(value, /^"/, `${field} is not a literal term`)
  return JSON.parse(value) as string
}

async function readAttachedLayout(mcpUrl: string): Promise<{ surfaceIri: string; layoutJson: string }> {
  const query = [
    'SELECT ?surface ?layoutJson WHERE {',
    `  GRAPH <${uxGraph}> {`,
    `    ?region <${suxFragmentSurface}> ?surface .`,
    `    ?surface <${uxLayoutJson}> ?layoutJson .`,
    '  }',
    '}',
  ].join('\n')
  const result = resultBody<{ rows?: Array<Record<string, unknown>> }>(
    await callTool(mcpUrl, 'sparql_query', { graphId, query }),
  )
  assert.equal(result.rows?.length, 1, `expected one attached notebook layout, got ${result.rows?.length ?? 0}`)
  const row = result.rows![0]!
  return {
    surfaceIri: iriLexical(row.surface, 'surface'),
    layoutJson: literalLexical(row.layoutJson, 'layoutJson'),
  }
}

async function replaceLayout(mcpUrl: string, surfaceIri: string, layoutJson: string): Promise<void> {
  const update = [
    'DELETE {',
    `  GRAPH <${uxGraph}> { <${surfaceIri}> <${uxLayoutJson}> ?oldLayout . }`,
    '}',
    'INSERT {',
    `  GRAPH <${uxGraph}> { <${surfaceIri}> <${uxLayoutJson}> ${JSON.stringify(layoutJson)} . }`,
    '}',
    'WHERE {',
    `  GRAPH <${uxGraph}> { <${surfaceIri}> <${uxLayoutJson}> ?oldLayout . }`,
    '}',
  ].join('\n')
  await callTool(mcpUrl, 'sparql_update', { graphId, update })
}

const mcpUrl = await graphMcpUrl()
const original = await readAttachedLayout(mcpUrl)
const originalDoc = JSON.parse(original.layoutJson) as {
  rootNodeId: string
  nodes: Record<string, Record<string, unknown>>
  updatedAt: string
}
const root = originalDoc.nodes[originalDoc.rootNodeId]
assert.equal(root?.kind, 'grid', 'attached notebook root is not a grid')
const originalFlow = root.flow
const originalMinCellWidth = root.minCellWidth
const proofMinCellWidth = 777
const revisedJson = JSON.stringify({
  ...originalDoc,
  nodes: {
    ...originalDoc.nodes,
    [originalDoc.rootNodeId]: {
      ...root,
      flow: 'reflow',
      minCellWidth: proofMinCellWidth,
      gridRevision: Number(root.gridRevision ?? 0) + 1,
    },
  },
  updatedAt: new Date().toISOString(),
})

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

const gridInterior = page.locator(
  '[data-layout-node-id="frag:region-center:notebook-cells"] [data-layout-grid-interior="true"]',
)
let revised = false
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('sh-compute-cell-view').first().waitFor({ state: 'visible', timeout: 30_000 })
  await gridInterior.waitFor({ state: 'attached', timeout: 30_000 })
  assert.equal(await page.locator('#cell-poll').isChecked(), true, 'live config polling is not enabled')
  const sentinel = `config-refresh-${Date.now()}`
  await page.evaluate(value => { document.documentElement.dataset.configRefreshSentinel = value }, sentinel)

  const before = await gridInterior.evaluate(element => (element as HTMLElement).style.gridTemplateColumns)
  assert.equal(before, originalFlow === 'stack' ? '1fr' : `repeat(auto-fill, minmax(${originalMinCellWidth}px, 1fr))`)

  await replaceLayout(mcpUrl, original.surfaceIri, revisedJson)
  revised = true
  const authoritativeRevision = await readAttachedLayout(mcpUrl)
  assert.equal(authoritativeRevision.surfaceIri, original.surfaceIri)
  assert.equal(authoritativeRevision.layoutJson, revisedJson, 'the revised ux:layoutJson did not land')
  await page.waitForFunction(
    expected => (document.querySelector('#seed-editor') as HTMLTextAreaElement | null)?.value.includes(expected) === true,
    `\\"minCellWidth\\":${proofMinCellWidth}`,
    { timeout: 20_000 },
  )
  await page.waitForFunction(
    expected => document.querySelector<HTMLElement>(
      '[data-layout-node-id="frag:region-center:notebook-cells"] [data-layout-grid-interior="true"]',
    )?.style.gridTemplateColumns.includes(`${expected}px`) === true,
    proofMinCellWidth,
    { timeout: 20_000 },
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.configRefreshSentinel),
    sentinel,
    'the app reloaded instead of refreshing the graph-authored config in place',
  )

  await replaceLayout(mcpUrl, original.surfaceIri, original.layoutJson)
  await page.waitForFunction(
    expected => document.querySelector<HTMLElement>(
      '[data-layout-node-id="frag:region-center:notebook-cells"] [data-layout-grid-interior="true"]',
    )?.style.gridTemplateColumns === expected,
    before,
    { timeout: 20_000 },
  )
  const restored = await readAttachedLayout(mcpUrl)
  assert.deepEqual(restored, original, 'the authoritative ux:layoutJson literal was not restored exactly')
  revised = false
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])
  console.log(JSON.stringify({
    url,
    graphId,
    surfaceIri: original.surfaceIri,
    before,
    changedTo: `repeat(auto-fill, minmax(${proofMinCellWidth}px, 1fr))`,
    restoredTo: before,
    fullAppReload: false,
    pageErrors,
    consoleErrors,
  }, null, 2))
} finally {
  if (revised) await replaceLayout(mcpUrl, original.surfaceIri, original.layoutJson)
  await browser.close()
}
