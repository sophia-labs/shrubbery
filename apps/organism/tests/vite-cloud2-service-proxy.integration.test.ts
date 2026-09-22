import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, get as httpGet, type IncomingMessage, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { cloud2ServiceProxy } from '../../../scripts/vite-cloud2-service-proxy.js'

interface SeenRequest {
  readonly path: string
  readonly authorization: string | undefined
  readonly onBehalfOf: string | undefined
  readonly origin: string | undefined
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not reserve Vite port')
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
  return address.port
}

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return await new Promise((resolveResponse, reject) => {
    const request = httpGet(url, { headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.once('end', () => resolveResponse({
        status: response.statusCode ?? 0,
        text: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.setTimeout(5_000, () => request.destroy(new Error(`GET ${url} timed out`)))
    request.once('error', reject)
  })
}

describe('development Vite cloud-2 service proxy', () => {
  it('keeps the service bearer server-side and injects the acting subject', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'shrubbery-cloud2-proxy-'))
    const tokenFile = join(temp, `.service-${randomUUID()}.token`)
    const token = `service-${randomUUID()}`
    const subject = 'e9e949fe-0091-7015-0ab8-10bf259084ab'
    writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
    const seen: SeenRequest[] = []
    const upstream: Server = createHttpServer((request: IncomingMessage, response) => {
      seen.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        onBehalfOf: request.headers['x-pn-on-behalf-of'] as string | undefined,
        origin: request.headers.origin,
      })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, path: request.url }))
    })
    let vite: ViteDevServer | undefined
    try {
      await new Promise<void>((resolveListen, reject) => {
        upstream.once('error', reject)
        upstream.listen(0, '127.0.0.1', resolveListen)
      })
      const upstreamAddress = upstream.address()
      if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('upstream did not bind')
      const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`
      const vitePort = await freePort()
      vite = await createViteServer({
        configFile: false,
        plugins: [cloud2ServiceProxy({
          gatewayBaseUrl: upstreamOrigin,
          serviceTokenFile: tokenFile,
          onBehalfOf: subject,
          allowInsecureUpstream: true,
        })],
        server: { host: '127.0.0.1', port: vitePort, strictPort: true },
        logLevel: 'silent',
      })
      await vite.listen()
      const base = `http://127.0.0.1:${vitePort}`

      const result = await get(`${base}/cloud2/g/prime-notebook-lab/mcp?probe=1`, {
        Authorization: 'Bearer browser-must-not-win',
      })
      expect(result.status).toBe(200)
      expect(JSON.parse(result.text)).toEqual({ ok: true, path: '/g/prime-notebook-lab/mcp?probe=1' })
      expect(result.text).not.toContain(token)
      expect(seen).toEqual([{
        path: '/g/prime-notebook-lab/mcp?probe=1',
        authorization: `Bearer ${token}`,
        onBehalfOf: subject,
        origin: upstreamOrigin,
      }])

      const secret = await get(`${base}/${tokenFile.split('/').at(-1)}`)
      expect(secret.status).toBe(404)
      expect(secret.text).not.toContain(token)

      unlinkSync(tokenFile)
      const unavailable = await get(`${base}/cloud2/g/prime-notebook-lab/mcp`)
      expect(unavailable.status).toBe(503)
      expect(JSON.parse(unavailable.text)).toMatchObject({
        error: 'cloud2_service_proxy_unavailable',
        retryable: true,
      })
    } finally {
      await vite?.close()
      await new Promise<void>(resolveClose => upstream.close(() => resolveClose()))
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('rejects a plaintext non-loopback gateway', () => {
    expect(() => cloud2ServiceProxy({
      gatewayBaseUrl: 'http://example.test',
      serviceTokenFile: '/tmp/service.token',
      onBehalfOf: 'subject',
    })).toThrow(/must use HTTPS/)
  })
})
