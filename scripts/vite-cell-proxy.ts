import { readFileSync, statSync } from 'node:fs'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { basename } from 'node:path'
import httpProxy from 'http-proxy'

const DEFAULT_MOUNT_PATH = '/cell'
const DEFAULT_RETRY_AFTER_SECONDS = 1
const DEFAULT_UPSTREAM_TIMEOUT_MS = 2_000
const MAX_MANIFEST_BYTES = 64 * 1024

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

export interface CellProxyEndpoint {
  readonly apiUrl: string
  readonly token: string
}

export interface DynamicCellProxyOptions {
  /** Server-only gardend manifest. It is re-read for every request/upgrade. */
  readonly manifestPath: string
  /** Browser-visible same-origin mount. Defaults to `/cell`. */
  readonly mountPath?: string
  /** Enable doc/workspace y-websocket forwarding. */
  readonly websocket?: boolean
  /** Preserve the loopback WS origin contract. */
  readonly websocketOrigin?: string
  /** Optional dynamic fallback (used by the Rhizome bench cell). */
  readonly fallback?: () => CellProxyEndpoint | undefined
  /** Bound an unresponsive stale target. Defaults to two seconds. */
  readonly upstreamTimeoutMs?: number
}

export interface DynamicCellProxyPlugin {
  readonly name: string
  readonly apply: 'serve'
  configureServer(server: ViteDevServerLike): void
}

type ManifestFailureReason =
  | 'loopback_manifest_missing'
  | 'loopback_manifest_invalid'
  | 'loopback_target_unsafe'
  | 'cell_upstream_unavailable'

type EndpointResolution =
  | { readonly ok: true; readonly endpoint: CellProxyEndpoint }
  | { readonly ok: false; readonly reason: ManifestFailureReason }

function normalizeMountPath(value: string | undefined): string {
  const mount = value?.trim() || DEFAULT_MOUNT_PATH
  const prefixed = mount.startsWith('/') ? mount : `/${mount}`
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed
}

function validateLoopbackEndpoint(value: unknown): EndpointResolution {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'loopback_manifest_invalid' }
  }
  const manifest = value as { apiUrl?: unknown; token?: unknown }
  if (typeof manifest.apiUrl !== 'string' || typeof manifest.token !== 'string') {
    return { ok: false, reason: 'loopback_manifest_invalid' }
  }
  const token = manifest.token.trim()
  if (!token || token.length > 16_384) {
    return { ok: false, reason: 'loopback_manifest_invalid' }
  }

  let url: URL
  try {
    url = new URL(manifest.apiUrl)
  } catch {
    return { ok: false, reason: 'loopback_target_unsafe' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'loopback_target_unsafe' }
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const loopback = hostname === 'localhost'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  if (!loopback || url.username || url.password) {
    return { ok: false, reason: 'loopback_target_unsafe' }
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    return { ok: false, reason: 'loopback_target_unsafe' }
  }

  return { ok: true, endpoint: { apiUrl: url.origin, token } }
}

function resolveEndpoint(options: DynamicCellProxyOptions): EndpointResolution {
  let reason: ManifestFailureReason = 'loopback_manifest_missing'
  try {
    if (statSync(options.manifestPath).size > MAX_MANIFEST_BYTES) {
      reason = 'loopback_manifest_invalid'
    } else {
      const parsed: unknown = JSON.parse(readFileSync(options.manifestPath, 'utf8'))
      const validation = validateLoopbackEndpoint(parsed)
      if (validation.ok) return validation
      reason = validation.reason
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    reason = code === 'ENOENT' ? 'loopback_manifest_missing' : 'loopback_manifest_invalid'
  }

  try {
    const fallback = options.fallback?.()
    if (fallback) {
      const validation = validateLoopbackEndpoint(fallback)
      if (validation.ok) return validation
    }
  } catch {
    return { ok: false, reason: 'loopback_manifest_invalid' }
  }
  return { ok: false, reason }
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://vite.invalid').pathname
  } catch {
    return '/'
  }
}

function requestBasename(request: IncomingMessage): string {
  const path = requestPath(request)
  try {
    return basename(decodeURIComponent(path))
  } catch {
    return basename(path)
  }
}

function matchesMount(request: IncomingMessage, mountPath: string): boolean {
  const path = requestPath(request)
  return path === mountPath || path.startsWith(`${mountPath}/`)
}

function rewriteMount(request: IncomingMessage, mountPath: string): void {
  const raw = request.url ?? '/'
  if (raw === mountPath) {
    request.url = '/'
    return
  }
  if (raw.startsWith(`${mountPath}?`)) {
    request.url = `/${raw.slice(mountPath.length)}`
    return
  }
  if (raw.startsWith(`${mountPath}/`)) {
    request.url = raw.slice(mountPath.length) || '/'
  }
}

function unavailableBody(reason: ManifestFailureReason): string {
  const manifestProblem = reason.startsWith('loopback_manifest_') || reason === 'loopback_target_unsafe'
  return JSON.stringify({
    error: 'cell_proxy_unavailable',
    reason,
    retryable: true,
    message: manifestProblem
      ? 'Garden cell connection data is not ready; start or restart gardend and retry.'
      : 'The Garden cell is not accepting connections yet; retry shortly.',
  })
}

function sendHttpUnavailable(response: ServerResponse, reason: ManifestFailureReason): void {
  if (response.writableEnded || response.destroyed) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  const body = unavailableBody(reason)
  response.statusCode = 503
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Retry-After', String(DEFAULT_RETRY_AFTER_SECONDS))
  response.end(body)
}

function sendWebSocketUnavailable(socket: Socket, reason: ManifestFailureReason): void {
  if (socket.destroyed || !socket.writable) return
  const body = unavailableBody(reason)
  socket.end([
    'HTTP/1.1 503 Service Unavailable',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Cache-Control: no-store',
    `Retry-After: ${DEFAULT_RETRY_AFTER_SECONDS}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n'))
}

function proxyHeaders(endpoint: CellProxyEndpoint, websocketOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${endpoint.token}`,
  }
  if (websocketOrigin) headers.Origin = websocketOrigin
  return headers
}

/**
 * Vite dev middleware whose upstream is intentionally absent at construction.
 * Each HTTP request and WS upgrade gets one manifest snapshot and supplies its
 * target + bearer as per-call http-proxy options. A gardend restart therefore
 * cannot leave Vite holding stale coordinates, and target/token cannot cross
 * between concurrent requests during rotation.
 */
export function dynamicCellProxy(options: DynamicCellProxyOptions): DynamicCellProxyPlugin {
  const mountPath = normalizeMountPath(options.mountPath)
  const websocketOrigin = options.websocketOrigin ?? 'http://127.0.0.1'
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const secretBasename = basename(options.manifestPath)

  return {
    name: 'shrubbery-dynamic-cell-proxy',
    apply: 'serve',
    configureServer(server) {
      // No constructor target: the request-local target passed to web()/ws()
      // below is authoritative. This avoids Vite's static ProxyOptions capture.
      const proxy = httpProxy.createProxyServer()

      server.middlewares.use((request, response, next) => {
        // The standard manifest lives under the Vite root. Keep its bearer out
        // of browser fetches even if Vite's static-file policy changes.
        if (requestBasename(request) === secretBasename) {
          response.statusCode = 404
          response.setHeader('Cache-Control', 'no-store')
          response.end('Not Found')
          return
        }
        if (!matchesMount(request, mountPath)) {
          next()
          return
        }

        const resolution = resolveEndpoint(options)
        if (resolution.ok === false) {
          sendHttpUnavailable(response, resolution.reason)
          return
        }
        rewriteMount(request, mountPath)
        proxy.web(request, response, {
          target: resolution.endpoint.apiUrl,
          changeOrigin: true,
          headers: proxyHeaders(resolution.endpoint),
          proxyTimeout: upstreamTimeoutMs,
        }, () => {
          sendHttpUnavailable(response, 'cell_upstream_unavailable')
        })
      })

      if (!options.websocket || !server.httpServer) return
      const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
        if (!matchesMount(request, mountPath)) return
        // A client that resets its upgraded socket (a stale tab reconnecting
        // after a dev-server restart, a hard close mid-frame) emits 'error'
        // on this bare Socket. Without a listener that is an unhandled
        // 'error' event and it KILLS the dev server (observed: ECONNRESET →
        // process exit 1). The proxy.ws callback below only covers the
        // upstream side; the client side is ours to guard.
        socket.on('error', () => socket.destroy())
        const resolution = resolveEndpoint(options)
        if (resolution.ok === false) {
          sendWebSocketUnavailable(socket, resolution.reason)
          return
        }
        rewriteMount(request, mountPath)
        proxy.ws(request, socket, head, {
          target: resolution.endpoint.apiUrl,
          changeOrigin: true,
          headers: proxyHeaders(resolution.endpoint, websocketOrigin),
          proxyTimeout: upstreamTimeoutMs,
        }, () => {
          sendWebSocketUnavailable(socket, 'cell_upstream_unavailable')
        })
      }
      server.httpServer.on('upgrade', onUpgrade)
      server.httpServer.once('close', () => {
        server.httpServer?.off('upgrade', onUpgrade)
      })
    },
  }
}
