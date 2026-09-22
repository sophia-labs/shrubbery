/** Hosted implementation of the runtime's private `obs.filmstrip` byte seam. */
import type { FilmstripEvidenceRef, FilmstripEvidenceService } from '@shrubbery/runtime/layout'

const SHA256 = /^[a-f0-9]{64}$/
const FETCH_TIMEOUT_MS = 30_000

export interface HostedEvidenceServiceOptions {
  readonly gatewayBaseUrl: string
  /** Resolve the canonical owner-scoped graph root after GET /graphs has bound it. */
  readonly graphBaseUrl?: (graphId: string) => string
  readonly token: () => string | undefined
  readonly fetch?: typeof fetch
}

export function createHostedEvidenceService(options: HostedEvidenceServiceOptions): FilmstripEvidenceService {
  const base = options.gatewayBaseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('Evidence gateway base URL must be absolute')
  const gatewayOrigin = new URL(base).origin
  const fetchImpl = (options.fetch ?? globalThis.fetch).bind(globalThis) as typeof fetch
  return {
    async read(graphId, runId, ref) {
      const token = options.token()?.trim()
      if (!token) throw new Error('Evidence access requires an authenticated hosted session')
      validateRef(ref)
      const resolvedGraphBase = options.graphBaseUrl
        ? options.graphBaseUrl(graphId).trim().replace(/\/+$/, '')
        : `${base}/g/${encodeURIComponent(graphId)}`
      const resolved = new URL(resolvedGraphBase)
      if (resolved.origin !== gatewayOrigin || resolved.search || resolved.hash) {
        throw new Error('Evidence graph route must stay on the configured gateway origin')
      }
      const url = new URL(
        `${resolvedGraphBase}/workflows/runs/${encodeURIComponent(runId)}/evidence`,
      )
      url.searchParams.set('uri', ref.uri)
      url.searchParams.set('sha256', ref.sha256)
      if (ref.bytes !== undefined && ref.mediaType !== undefined) {
        url.searchParams.set('bytes', String(ref.bytes))
        url.searchParams.set('media_type', ref.mediaType)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) throw new Error(`Evidence request failed (${response.status})`)
      const blob = await response.blob()
      if (ref.bytes !== undefined && blob.size !== ref.bytes) {
        throw new Error('Evidence response length does not match its manifest ref')
      }
      const digest = await sha256Hex(await blob.arrayBuffer())
      if (digest !== ref.sha256) throw new Error('Evidence response digest does not match its ref')
      return blob
    },
  }
}

function validateRef(ref: FilmstripEvidenceRef): void {
  if (!ref || typeof ref !== 'object') throw new Error('Invalid evidence ref')
  if (typeof ref.uri !== 'string' || !ref.uri.startsWith('s3://') || ref.uri.length > 2048) {
    throw new Error('Invalid evidence URI')
  }
  if (!SHA256.test(ref.sha256)) throw new Error('Invalid evidence digest')
  if ((ref.bytes === undefined) !== (ref.mediaType === undefined)) {
    throw new Error('Evidence bytes and mediaType must be supplied together')
  }
  if (ref.bytes !== undefined && (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0)) {
    throw new Error('Invalid evidence length')
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
