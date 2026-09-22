import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  get as httpGet,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket, WebSocketServer } from 'ws'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface ObservedRequest {
  readonly kind: 'http' | 'ws'
  readonly path: string
  readonly authorization: string | undefined
  readonly host: string | undefined
  readonly origin: string | undefined
}

class MockLoopbackTarget {
  readonly seen: ObservedRequest[] = []
  readonly token: string
  readonly webSockets = new WebSocketServer({ noServer: true })
  private readonly server: Server
  private closed = false
  apiUrl = ''

  constructor(readonly name: string) {
    this.token = `token-${name}-${randomUUID()}`
    this.server = createHttpServer((request, response) => {
      this.record('http', request)
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ target: this.name, path: request.url }))
    })
    this.server.on('upgrade', (request, socket, head) => {
      this.record('ws', request)
      this.webSockets.handleUpgrade(request, socket, head, webSocket => {
        this.webSockets.emit('connection', webSocket, request)
      })
    })
    this.webSockets.on('connection', webSocket => {
      webSocket.on('message', value => {
        webSocket.send(JSON.stringify({ target: this.name, echo: value.toString() }))
      })
    })
  }

  private record(kind: 'http' | 'ws', request: IncomingMessage): void {
    this.seen.push({
      kind,
      path: request.url ?? '',
      authorization: request.headers.authorization,
      host: request.headers.host,
      origin: request.headers.origin,
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolveListen, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('mock loopback target did not bind')
    this.apiUrl = `http://127.0.0.1:${address.port}`
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const client of this.webSockets.clients) client.terminate()
    await new Promise<void>(resolveClose => this.webSockets.close(() => resolveClose()))
    await new Promise<void>(resolveClose => this.server.close(() => resolveClose()))
  }
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not reserve Vite port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

interface HttpResult {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly text: string
}

async function get(url: string, headers?: Record<string, string>): Promise<HttpResult> {
  return await new Promise((resolveResponse, reject) => {
    const request = httpGet(url, { headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.once('end', () => {
        resolveResponse({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.setTimeout(5_000, () => request.destroy(new Error(`GET ${url} timed out`)))
    request.once('error', reject)
  })
}

function writeManifest(path: string, endpoint: { apiUrl: string; token: string }): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(endpoint))
  renameSync(temporary, path)
}

async function proxiedWebSocket(url: string): Promise<{ target: string; echo: string; protocol: string }> {
  return await new Promise((resolveSocket, reject) => {
    const socket = new NodeWebSocket(url, ['garden-sync'], {
      origin: 'http://127.0.0.1:browser-port',
    })
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('proxied websocket timed out'))
    }, 5_000)
    socket.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    socket.once('open', () => socket.send('round-trip'))
    socket.once('message', raw => {
      clearTimeout(timer)
      const value = JSON.parse(raw.toString()) as { target: string; echo: string }
      const protocol = socket.protocol
      socket.close()
      resolveSocket({ ...value, protocol })
    })
  })
}

async function rejectedWebSocketStatus(url: string): Promise<number> {
  return await new Promise((resolveStatus, reject) => {
    const socket = new NodeWebSocket(url)
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('unavailable websocket did not terminate'))
    }, 2_000)
    socket.once('open', () => reject(new Error('unavailable websocket unexpectedly opened')))
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      const status = response.statusCode ?? 0
      response.resume()
      socket.terminate()
      resolveStatus(status)
    })
    socket.once('error', error => {
      if ((error as Error).message.includes('Unexpected server response')) return
      clearTimeout(timer)
      reject(error)
    })
  })
}

describe('dynamic Vite /cell proxy', () => {
  it('rotates HTTP+WS target/token without restarting Vite and fails explicitly', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'shrubbery-cell-proxy-'))
    const manifestPath = join(temp, '.gardend-loopback.json')
    const previousManifest = process.env.GARDEND_LOOPBACK_MANIFEST
    process.env.GARDEND_LOOPBACK_MANIFEST = manifestPath

    const first = new MockLoopbackTarget('first')
    const second = new MockLoopbackTarget('second')
    let vite: ViteDevServer | undefined
    try {
      await Promise.all([first.listen(), second.listen()])
      const vitePort = await freePort()
      vite = await createViteServer({
        root: appDir,
        configFile: resolve(appDir, 'vite.config.ts'),
        server: { host: '127.0.0.1', port: vitePort, strictPort: true },
        logLevel: 'silent',
      })
      await vite.listen()
      const httpBase = `http://127.0.0.1:${vitePort}`
      const wsBase = `ws://127.0.0.1:${vitePort}`

      const missingStarted = Date.now()
      const missing = await get(`${httpBase}/cell/health`)
      expect(missing.status).toBe(503)
      expect(Date.now() - missingStarted).toBeLessThan(1_500)
      expect(JSON.parse(missing.text)).toMatchObject({
        error: 'cell_proxy_unavailable',
        reason: 'loopback_manifest_missing',
        retryable: true,
      })
      expect(missing.headers['retry-after']).toBe('1')
      expect(await rejectedWebSocketStatus(`${wsBase}/cell/hocuspocus/workspace`)).toBe(503)

      writeFileSync(manifestPath, '{not-json')
      const invalid = await get(`${httpBase}/cell/health`)
      expect(invalid.status).toBe(503)
      expect(JSON.parse(invalid.text)).toMatchObject({ reason: 'loopback_manifest_invalid' })

      writeManifest(manifestPath, { apiUrl: first.apiUrl, token: '' })
      const missingToken = await get(`${httpBase}/cell/health`)
      expect(missingToken.status).toBe(503)
      expect(JSON.parse(missingToken.text)).toMatchObject({ reason: 'loopback_manifest_invalid' })

      writeManifest(manifestPath, { apiUrl: 'https://example.com', token: first.token })
      const unsafe = await get(`${httpBase}/cell/health`)
      expect(unsafe.status).toBe(503)
      expect(JSON.parse(unsafe.text)).toMatchObject({ reason: 'loopback_target_unsafe' })

      writeManifest(manifestPath, first)
      const firstHttp = await get(`${httpBase}/cell/inspect?generation=one`, {
        Authorization: 'Bearer browser-must-not-win',
        Origin: `http://127.0.0.1:${vitePort}`,
      })
      expect(firstHttp.status).toBe(200)
      const firstText = firstHttp.text
      expect(JSON.parse(firstText)).toEqual({ target: 'first', path: '/inspect?generation=one' })
      expect(firstText).not.toContain(first.token)
      expect(first.seen.at(-1)).toMatchObject({
        kind: 'http',
        path: '/inspect?generation=one',
        authorization: `Bearer ${first.token}`,
        host: new URL(first.apiUrl).host,
        origin: `http://127.0.0.1:${vitePort}`,
      })
      expect(await proxiedWebSocket(`${wsBase}/cell/socket?generation=one`)).toEqual({
        target: 'first',
        echo: 'round-trip',
        protocol: 'garden-sync',
      })
      expect(first.seen.at(-1)).toMatchObject({
        kind: 'ws',
        path: '/socket?generation=one',
        authorization: `Bearer ${first.token}`,
        host: new URL(first.apiUrl).host,
        origin: 'http://127.0.0.1',
      })

      // This is the gardend restart seam: only the manifest changes. The same
      // live Vite server must route the next HTTP request and WS upgrade to the
      // new port with the new bearer.
      writeManifest(manifestPath, second)
      const secondHttp = await get(`${httpBase}/cell/inspect?generation=two`)
      expect(secondHttp.status).toBe(200)
      const secondText = secondHttp.text
      expect(JSON.parse(secondText)).toEqual({ target: 'second', path: '/inspect?generation=two' })
      expect(secondText).not.toContain(second.token)
      expect(second.seen.at(-1)).toMatchObject({
        kind: 'http',
        authorization: `Bearer ${second.token}`,
        host: new URL(second.apiUrl).host,
      })
      expect(await proxiedWebSocket(`${wsBase}/cell/socket?generation=two`)).toEqual({
        target: 'second',
        echo: 'round-trip',
        protocol: 'garden-sync',
      })
      expect(second.seen.at(-1)).toMatchObject({
        kind: 'ws',
        authorization: `Bearer ${second.token}`,
        origin: 'http://127.0.0.1',
      })
      expect(first.seen).toHaveLength(2)
      expect(second.seen).toHaveLength(2)

      // The manifest itself remains server-only even though its conventional
      // filename looks like a file under the Vite root.
      const secret = await get(`${httpBase}/.gardend-loopback.json`)
      expect(secret.status).toBe(404)
      expect(secret.text).not.toContain(second.token)

      // A stale endpoint is bounded by the proxy and presented as the same
      // explicit retryable 503 instead of http-proxy's opaque 500.
      await first.close()
      writeManifest(manifestPath, first)
      const staleStarted = Date.now()
      const stale = await get(`${httpBase}/cell/health`)
      expect(stale.status).toBe(503)
      expect(Date.now() - staleStarted).toBeLessThan(2_500)
      expect(JSON.parse(stale.text)).toMatchObject({ reason: 'cell_upstream_unavailable' })
    } finally {
      await vite?.close()
      await Promise.all([first.close(), second.close()])
      try {
        unlinkSync(manifestPath)
      } catch {
        // Missing is the first tested state.
      }
      rmSync(temp, { recursive: true, force: true })
      if (previousManifest === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
      else process.env.GARDEND_LOOPBACK_MANIFEST = previousManifest
    }
  }, 30_000)
})
