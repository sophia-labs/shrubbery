/**
 * REAL gardend protocol oracle for HostedGatewayContract.
 *
 * A tiny local HTTP path-rewriter stands in only for the gateway's already-
 * tested `/g/{id}` prefix stripping and cell-token swap. The target is a real
 * fresh gardend process, so MCP payload names/arguments/results are not mocked.
 * This intentionally does NOT claim to prove Cognito validation, ACLs, ALB
 * WebSocket behavior, or Kubernetes cell orchestration.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthProvider } from '@shrubbery/nucleus'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import {
  createHostedGatewayContract,
  type HostedGatewayContract,
} from '../src/cell/hosted-gateway-contract.js'

const GRAPH_ID = 'shrubbery-hosted-gateway-it'
const DOC_SOURCE = 'hosted-source'
const DOC_TARGET = 'hosted-target'
const USER_TOKEN = 'integration-user-token'
const SEED_NT = '<urn:hosted:subject> <urn:hosted:predicate> "through-gateway" .\n'
const GARDEN_BIN = resolveGardendBin()

class StaticAuth implements AuthProvider {
  token(): string { return USER_TOKEN }
  userId(): string { return 'integration-user' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => {} }
}

function readRequest(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function forwardMcp(cell: GardendCell, body: string): Promise<{ status: number; body: string; contentType: string }> {
  const target = new URL(cell.mcpUrl)
  return new Promise((resolve, reject) => {
    const upstream = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cell.token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        Origin: 'http://127.0.0.1',
      },
    }, response => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { responseBody += chunk })
      response.on('end', () => resolve({
        status: response.statusCode ?? 500,
        body: responseBody,
        contentType: String(response.headers['content-type'] ?? 'application/json'),
      }))
    })
    upstream.on('error', reject)
    upstream.end(body)
  })
}

/** Node HTTP fetch adapter (happy-dom's browser fetch intentionally enforces CORS). */
const nodeFetch: typeof globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input))
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const body = typeof init.body === 'string' ? init.body : undefined
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: init.method ?? 'GET',
      headers,
    }, response => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { responseBody += chunk })
      response.on('end', () => resolve(new Response(responseBody, {
        status: response.statusCode ?? 500,
        headers: response.headers as Record<string, string>,
      })))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('REAL INTEGRATION — hosted gateway contract speaks the gardend cell protocol', () => {
  let cell: GardendCell
  let shim: Server
  let contract: HostedGatewayContract
  const seen: Array<{ method: string; path: string; authorization: string | undefined }> = []

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(`gardend binary not found at ${GARDEN_BIN}; set GARDEN_BIN to override`)
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT, 'Hosted Gateway Integration')

    shim = createServer((req, res) => {
      void (async () => {
        const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          })
          res.end()
          return
        }
        seen.push({
          method: req.method ?? '',
          path,
          authorization: req.headers.authorization,
        })
        if (req.headers.authorization !== `Bearer ${USER_TOKEN}`) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(JSON.stringify({ error: 'missing test user bearer' }))
          return
        }
        if (req.method === 'GET' && path === '/graphs') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          })
          res.end(JSON.stringify([{
            graphId: GRAPH_ID,
            title: 'Hosted Gateway Integration',
            cellState: 'running',
            role: 'owner',
          }]))
          return
        }
        if (req.method === 'POST' && path === `/g/${GRAPH_ID}/mcp`) {
          const body = await readRequest(req)
          const upstream = await forwardMcp(cell, body)
          res.writeHead(upstream.status, {
            'Content-Type': upstream.contentType,
            'Access-Control-Allow-Origin': '*',
          })
          res.end(upstream.body)
          return
        }
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify({ error: `unexpected shim route ${req.method} ${path}` }))
      })().catch(error => {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      shim.once('error', reject)
      shim.listen(0, '127.0.0.1', resolve)
    })
    const address = shim.address() as AddressInfo
    contract = createHostedGatewayContract({
      gatewayBaseUrl: `http://127.0.0.1:${address.port}`,
      auth: new StaticAuth(),
      fetch: nodeFetch,
    })
  }, 40000)

  afterAll(async () => {
    contract?.crdt.destroyAll()
    if (shim) await new Promise<void>(resolve => shim.close(() => resolve()))
    if (cell) await cell.kill()
  })

  it('uses the root control-plane route and the graph-scoped MCP route with the user bearer', async () => {
    await expect(contract.rest.graphs()).resolves.toEqual([{
      graphId: GRAPH_ID,
      title: 'Hosted Gateway Integration',
      cellState: 'running',
      role: 'owner',
    }])

    const result = await contract.restConcrete.query(
      GRAPH_ID,
      `SELECT ?s WHERE { GRAPH <${uxConfigGraphIri(GRAPH_ID)}> { ?s ?p ?o } }`,
    )
    expect(result.rows?.[0]?.s).toContain('urn:hosted:subject')

    expect(seen.slice(0, 2)).toEqual([
      { method: 'GET', path: '/graphs', authorization: `Bearer ${USER_TOKEN}` },
      { method: 'POST', path: `/g/${GRAPH_ID}/mcp`, authorization: `Bearer ${USER_TOKEN}` },
    ])
  })

  it('dumps, updates, and writes/deletes wires through real gardend MCP tools', async () => {
    const dump = await contract.restConcrete.dumpUxConfig(GRAPH_ID)
    expect(dump.data).toContain('through-gateway')

    await contract.restConcrete.update(
      GRAPH_ID,
      'INSERT DATA { GRAPH <urn:hosted:write> { <urn:s> <urn:p> "written" } }',
    )
    const written = await contract.restConcrete.query(
      GRAPH_ID,
      'SELECT ?o WHERE { GRAPH <urn:hosted:write> { <urn:s> <urn:p> ?o } }',
    )
    expect(written.rows?.[0]?.o).toContain('written')

    await contract.gateway.toolsCall(GRAPH_ID, 'create_document', {
      graphId: GRAPH_ID,
      documentId: DOC_SOURCE,
      title: 'Source',
    })
    await contract.gateway.toolsCall(GRAPH_ID, 'create_document', {
      graphId: GRAPH_ID,
      documentId: DOC_TARGET,
      title: 'Target',
    })
    await expect(contract.wire.create(GRAPH_ID, {
      sourceDocumentId: DOC_SOURCE,
      targetDocumentId: DOC_TARGET,
      wireId: 'hosted-wire',
      predicate: 'supports',
    })).resolves.toEqual({ wireId: 'hosted-wire' })
    await expect(contract.wire.delete(GRAPH_ID, 'hosted-wire')).resolves.toBeUndefined()

    expect(seen.filter(call => call.path === `/g/${GRAPH_ID}/mcp`).length).toBeGreaterThanOrEqual(8)
    expect(seen.every(call => call.authorization === `Bearer ${USER_TOKEN}`)).toBe(true)
  })
})
