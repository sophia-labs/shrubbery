/**
 * Development-only cloud-2 gateway proxy.
 *
 * A local Organism needs the production hosted transport in order to exercise
 * the same control-plane, MCP, document, and websocket routes as the deployed
 * app. Local agent/display proofs authenticate with Choreograph's service
 * credential, however, and that credential must never enter browser JS. This
 * Vite middleware keeps it server-side, replaces the browser's inert
 * development bearer, and supplies the explicit on-behalf-of subject expected
 * by the gateway.
 */

import type { EventEmitter } from 'node:events'
import { readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { basename } from 'node:path'
import httpProxy from 'http-proxy'

const MAX_TOKEN_BYTES = 64 * 1024
const DEFAULT_MOUNT_PATH = '/cloud2'

interface ConnectMiddlewareStack {
  use(
    middleware: (
      request: IncomingMessage,
      response: ServerResponse,
      next: () => void,
    ) => void,
  ): void
}

interface ViteDevServerLike {
  readonly middlewares: ConnectMiddlewareStack
  readonly httpServer: EventEmitter | null
}

export interface Cloud2ServiceProxyOptions {
  readonly gatewayBaseUrl: string
  readonly serviceTokenFile: string
  readonly onBehalfOf: string
  readonly mountPath?: string
  readonly websocket?: boolean
  /** Test-only escape hatch for a loopback upstream. */
  readonly allowInsecureUpstream?: boolean
}

export interface Cloud2ServiceProxyPlugin {
  readonly name: string
  readonly apply: 'serve'
  configureServer(server: ViteDevServerLike): void
}

function mountPath(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_MOUNT_PATH
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed
}

function gatewayOrigin(value: string, allowInsecure: boolean): string {
  const url = new URL(value.trim())
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Cloud-2 service proxy gateway must be an origin without credentials, path, query, or fragment')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:' && loopback)) {
    throw new Error('Cloud-2 service proxy gateway must use HTTPS')
  }
  return url.origin
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://vite.invalid').pathname
  } catch {
    return '/'
  }
}

function matchesMount(request: IncomingMessage, mount: string): boolean {
  const path = requestPath(request)
  return path === mount || path.startsWith(`${mount}/`)
}

function rewriteMount(request: IncomingMessage, mount: string): void {
  const raw = request.url ?? '/'
  if (raw === mount) {
    request.url = '/'
  } else if (raw.startsWith(`${mount}?`)) {
    request.url = `/${raw.slice(mount.length)}`
  } else if (raw.startsWith(`${mount}/`)) {
    request.url = raw.slice(mount.length) || '/'
  }
}

function readServiceToken(path: string): string {
  if (statSync(path).size > MAX_TOKEN_BYTES) throw new Error('service token file is oversized')
  const token = readFileSync(path, 'utf8').trim()
  if (!token) throw new Error('service token file is empty')
  return token
}

function unavailable(response: ServerResponse): void {
  if (response.writableEnded || response.destroyed) return
  const body = JSON.stringify({
    error: 'cloud2_service_proxy_unavailable',
    retryable: true,
    message: 'The local cloud-2 credential bridge is unavailable.',
  })
  response.statusCode = 503
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function closeUnavailable(socket: Socket): void {
  if (!socket.destroyed && socket.writable) socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
}

export function cloud2ServiceProxy(options: Cloud2ServiceProxyOptions): Cloud2ServiceProxyPlugin {
  const gateway = gatewayOrigin(options.gatewayBaseUrl, options.allowInsecureUpstream === true)
  const mount = mountPath(options.mountPath)
  const subject = options.onBehalfOf.trim()
  if (!subject || [...subject].some(character => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) {
    throw new Error('Cloud-2 service proxy on-behalf-of subject is invalid')
  }
  const secretBasename = basename(options.serviceTokenFile)

  return {
    name: 'shrubbery-cloud2-service-proxy',
    apply: 'serve',
    configureServer(server) {
      const proxy = httpProxy.createProxyServer()
      const requestHeaders = (): Record<string, string> => ({
        Authorization: `Bearer ${readServiceToken(options.serviceTokenFile)}`,
        'x-pn-on-behalf-of': subject,
        Origin: gateway,
      })

      server.middlewares.use((request, response, next) => {
        if (basename(requestPath(request)) === secretBasename) {
          response.statusCode = 404
          response.setHeader('Cache-Control', 'no-store')
          response.end('Not Found')
          return
        }
        if (!matchesMount(request, mount)) {
          next()
          return
        }
        try {
          rewriteMount(request, mount)
          proxy.web(request, response, {
            target: gateway,
            changeOrigin: true,
            headers: requestHeaders(),
            proxyTimeout: 90_000,
          }, () => unavailable(response))
        } catch {
          unavailable(response)
        }
      })

      if (!options.websocket || !server.httpServer) return
      const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
        if (!matchesMount(request, mount)) return
        socket.on('error', () => socket.destroy())
        try {
          rewriteMount(request, mount)
          proxy.ws(request, socket, head, {
            target: gateway,
            changeOrigin: true,
            headers: requestHeaders(),
            proxyTimeout: 90_000,
          }, () => closeUnavailable(socket))
        } catch {
          closeUnavailable(socket)
        }
      }
      server.httpServer.on('upgrade', onUpgrade)
      server.httpServer.once('close', () => server.httpServer?.off('upgrade', onUpgrade))
    },
  }
}
