/**
 * Trusted stateless Planter render pool.
 *
 * Public clients never call this process directly. Platform-next first checks
 * the graph ACL for an exact `(owner principal, graph id)` route, replaces all
 * authority headers, and authenticates with `x-planter-internal-service`.
 * The pool calls the gateway back with its service token on behalf of that
 * already-proven user. Neither a browser nor a sandbox can supply credentials,
 * choose a graph by slug alone, or select an interpreter.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { TripleSourceError, uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  GARDEN_LAYOUT_SEED_SHA256,
  type SiteBundle,
  siteBundleForInterpreter,
  siteInterpreterCatalog,
} from '@shrubbery/site'
import {
  createHostedGatewaySource,
  normalizeGatewayBaseUrl,
  normalizeGatewayOwnerPrincipal,
  StaticAuth,
} from '@shrubbery/source'
import { handle } from './server.js'

const SITE_NS = 'http://sophia.ai/site#'
const GRAPH_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const ACTOR_RE = /^[A-Za-z0-9_.:-]{1,128}$/

export const PLANTER_POOL_HEADERS = Object.freeze({
  internalService: 'x-planter-internal-service',
  graphOwner: 'x-graph-owner',
  graphId: 'x-graph-id',
  actorSub: 'x-planter-actor-sub',
  publicReadToken: 'x-planter-public-read-token',
  interpreterPackage: 'x-site-interpreter-package',
  interpreterVersion: 'x-site-interpreter-version',
  bundleId: 'x-site-bundle-id',
  bundleVersion: 'x-site-bundle-version',
  layoutSha256: 'x-site-layout-sha256',
  definitionSha256: 'x-site-definition-sha256',
})

export interface PlanterPoolConfig {
  readonly gatewayOrigin: string
  readonly gatewayServiceToken: string
  readonly internalServiceSecret: string
  readonly fetch?: typeof fetch
}

interface TrustedRenderTarget {
  readonly owner: string
  readonly graphId: string
  readonly actorSub?: string
  readonly publicReadToken?: string
  readonly pin?: TrustedInterpreterPin
}

interface TrustedInterpreterPin {
  readonly packageName: string
  readonly version: string
  readonly bundleId: string
  readonly bundleVersion: string
  readonly layoutSha256: string
  readonly definitionSha256: string
}

function oneHeader(req: IncomingMessage, name: string, maxLength = 256): string | undefined {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return undefined
  const value = raw?.trim()
  return value && value.length <= maxLength ? value : undefined
}

function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!presented || !expected) return false
  const actualBytes = Buffer.from(presented)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function trustedTarget(req: IncomingMessage): TrustedRenderTarget {
  const ownerRaw = oneHeader(req, PLANTER_POOL_HEADERS.graphOwner)
  const graphId = oneHeader(req, PLANTER_POOL_HEADERS.graphId)
  const actorSub = oneHeader(req, PLANTER_POOL_HEADERS.actorSub)
  const publicReadToken = oneHeader(req, PLANTER_POOL_HEADERS.publicReadToken, 4096)
  if (!ownerRaw || !graphId || (!actorSub && !publicReadToken) || (actorSub && publicReadToken)) {
    throw new Error('trusted render request requires exact owner+graph and exactly one read authority')
  }
  const owner = normalizeGatewayOwnerPrincipal(ownerRaw)
  if (!GRAPH_ID_RE.test(graphId)) throw new Error(`trusted graph id '${graphId}' is invalid`)
  if (actorSub && !ACTOR_RE.test(actorSub)) throw new Error('trusted acting subject is invalid')
  if (actorSub) return { owner, graphId, actorSub }

  const values = {
    packageName: oneHeader(req, PLANTER_POOL_HEADERS.interpreterPackage),
    version: oneHeader(req, PLANTER_POOL_HEADERS.interpreterVersion),
    bundleId: oneHeader(req, PLANTER_POOL_HEADERS.bundleId),
    bundleVersion: oneHeader(req, PLANTER_POOL_HEADERS.bundleVersion),
    layoutSha256: oneHeader(req, PLANTER_POOL_HEADERS.layoutSha256),
    definitionSha256: oneHeader(req, PLANTER_POOL_HEADERS.definitionSha256),
  }
  if (Object.values(values).some(value => !value)) {
    throw new Error('public render authority requires a complete active interpreter pin')
  }
  if (!/^[0-9a-f]{64}$/.test(values.layoutSha256!) || !/^[0-9a-f]{64}$/.test(values.definitionSha256!)) {
    throw new Error('public render authority carries an invalid interpreter digest')
  }
  return {
    owner,
    graphId,
    publicReadToken,
    pin: values as TrustedInterpreterPin,
  }
}

function delegatedGatewayFetch(
  gatewayOrigin: string,
  actorSub: string,
  delegate: typeof fetch,
): typeof fetch {
  const base = new URL(`${normalizeGatewayBaseUrl(gatewayOrigin)}/`)
  return (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const target = new URL(raw)
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new TypeError('Planter pool refused a delegated request outside its configured gateway')
    }
    const headers = new Headers(init?.headers)
    headers.set('x-pn-on-behalf-of', actorSub)
    return delegate(input, { ...init, headers, redirect: 'error' })
  }) as typeof fetch
}

function literal(row: Readonly<Record<string, { readonly type: string; readonly value: string }>>, key: string): string {
  const term = row[key]
  if (term?.type !== 'literal' || !term.value) {
    throw new Error(`SiteDefinition query returned no literal ?${key}`)
  }
  return term.value
}

function iri(row: Readonly<Record<string, { readonly type: string; readonly value: string }>>, key: string): string {
  const term = row[key]
  if (term?.type !== 'iri' || !term.value) throw new Error(`SiteDefinition query returned no IRI ?${key}`)
  return term.value
}

/** Cross-host definition witness: a fixed ordered tuple, NUL-separated, so
 * Choreograph can independently derive the same digest without importing UI
 * code or relying on object-key insertion order. */
export function pinnedSiteDefinitionDigest(input: {
  readonly definitionIri: string
  readonly bundleId: string
  readonly bundleVersion: string
  readonly packageName: string
  readonly version: string
  readonly layoutSha256: string
}): string {
  return createHash('sha256').update([
    input.definitionIri,
    input.bundleId,
    input.bundleVersion,
    input.packageName,
    input.version,
    input.layoutSha256,
  ].join('\0')).digest('hex')
}

/** Resolve and verify the graph-authored interpreter pin before asking the
 * renderer to interpret layout. Exactly one complete SiteDefinition is
 * accepted; missing, ambiguous, unsupported, or byte-drifted definitions are
 * loud refusals. */
export async function resolvePinnedSiteBundle(
  source: ReturnType<typeof createHostedGatewaySource>,
  graphId: string,
  trustedPin?: TrustedInterpreterPin,
): Promise<SiteBundle> {
  if (!source.select) throw new Error('Planter pool requires a SPARQL-capable TripleSource')
  const projection = `urn:mnemosyne:local:graph:${graphId}:projection:site`
  const rows = await source.select(`
SELECT ?definition ?bundleId ?bundleVersion ?package ?version ?layoutSha WHERE {
  GRAPH <${projection}> {
    ?definition a <${SITE_NS}SiteDefinition> ;
      <${SITE_NS}bundleId> ?bundleId ;
      <${SITE_NS}bundleVersion> ?bundleVersion ;
      <${SITE_NS}interpreterPackage> ?package ;
      <${SITE_NS}interpreterVersion> ?version ;
      <${SITE_NS}layoutSeedSha256> ?layoutSha .
  }
}
ORDER BY ?definition
LIMIT 2`)
  if (rows.rows.length !== 1) {
    throw new Error(`graph '${graphId}' must carry exactly one complete SiteDefinition (found ${rows.rows.length})`)
  }
  const row = rows.rows[0] as Readonly<Record<string, { readonly type: string; readonly value: string }>>
  const definitionIri = iri(row, 'definition')
  const packageName = literal(row, 'package')
  const version = literal(row, 'version')
  const bundle = siteBundleForInterpreter(packageName, version)
  const expected = {
    bundleId: bundle.id,
    bundleVersion: bundle.version,
    layoutSha: bundle.layoutSeedSha256,
  }
  const actual = {
    definitionIri,
    bundleId: literal(row, 'bundleId'),
    bundleVersion: literal(row, 'bundleVersion'),
    layoutSha: literal(row, 'layoutSha'),
  }
  if (
    actual.bundleId !== expected.bundleId
    || actual.bundleVersion !== expected.bundleVersion
    || actual.layoutSha !== expected.layoutSha
  ) {
    throw new Error(`SiteDefinition '${actual.bundleId}' does not match the reviewed interpreter bundle`)
  }
  if (trustedPin) {
    const definitionSha256 = pinnedSiteDefinitionDigest({
      definitionIri,
      bundleId: actual.bundleId,
      bundleVersion: actual.bundleVersion,
      packageName,
      version,
      layoutSha256: actual.layoutSha,
    })
    if (
      trustedPin.packageName !== packageName
      || trustedPin.version !== version
      || trustedPin.bundleId !== actual.bundleId
      || trustedPin.bundleVersion !== actual.bundleVersion
      || trustedPin.layoutSha256 !== actual.layoutSha
      || trustedPin.definitionSha256 !== definitionSha256
    ) {
      throw new Error('live SiteDefinition differs from the active published interpreter revision')
    }
  }
  // Keep this comparison independently visible at the host edge. A stale code
  // bundle cannot pass merely because its interpreter tuple was copied.
  if (bundle.layoutSeedSha256 !== GARDEN_LAYOUT_SEED_SHA256) {
    throw new Error('reviewed Garden layout seed pin is internally inconsistent')
  }
  return bundle
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(`${JSON.stringify(body)}\n`)
}

function resolutionStatus(error: unknown): number {
  if (error instanceof TripleSourceError) {
    if (error.code === 'unauthorized') return 401
    if (error.code === 'forbidden') return 403
    if (error.code === 'not-found') return 404
    if (error.code === 'unavailable') return 503
  }
  return 409
}

export function createPlanterPoolServer(config: PlanterPoolConfig): Server {
  const gatewayOrigin = normalizeGatewayBaseUrl(config.gatewayOrigin)
  if (!config.gatewayServiceToken) throw new Error('Planter pool gateway service token is empty')
  if (!config.internalServiceSecret) throw new Error('Planter pool internal service secret is empty')
  const delegateFetch = config.fetch ?? globalThis.fetch

  return createServer(async (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      json(res, 200, {
        ok: true,
        service: 'planter-pool',
        interpreters: siteInterpreterCatalog(),
      })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method_not_allowed' })
      return
    }
    if (!secretMatches(oneHeader(req, PLANTER_POOL_HEADERS.internalService), config.internalServiceSecret)) {
      json(res, 401, { error: 'internal_service_auth_required' })
      return
    }

    let target: TrustedRenderTarget
    try {
      target = trustedTarget(req)
    } catch (error) {
      json(res, 400, { error: 'invalid_trusted_target', message: error instanceof Error ? error.message : String(error) })
      return
    }

    const publicRead = target.publicReadToken
    const source = createHostedGatewaySource({
      endpoint: gatewayOrigin,
      owner: target.owner,
      graph: target.graphId,
      auth: new StaticAuth(publicRead ?? config.gatewayServiceToken, publicRead ? 'service:planter-public' : target.actorSub),
      readPath: 'sparql',
      fetch: publicRead ? delegateFetch : delegatedGatewayFetch(gatewayOrigin, target.actorSub!, delegateFetch),
    })
    try {
      const bundle = await resolvePinnedSiteBundle(source, target.graphId, target.pin)
      await handle(req, res, {
        source,
        graphId: target.graphId,
        configGraphIri: uxConfigGraphIri(target.graphId),
        authMode: 'service',
        bundle,
      })
    } catch (error) {
      if (!res.headersSent) {
        json(res, resolutionStatus(error), {
          error: 'site_interpreter_refused',
          message: error instanceof Error ? error.message : String(error),
        })
      } else {
        res.end()
      }
    } finally {
      await source.close()
    }
  })
}

export function poolConfigFromProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): PlanterPoolConfig {
  const gatewayOrigin = env.PLANTER_GATEWAY_ORIGIN
  const gatewayServiceToken = env.PLANTER_GATEWAY_SERVICE_TOKEN
  const internalServiceSecret = env.PLANTER_INTERNAL_SERVICE_SECRET
  const missing = [
    !gatewayOrigin ? 'PLANTER_GATEWAY_ORIGIN' : '',
    !gatewayServiceToken ? 'PLANTER_GATEWAY_SERVICE_TOKEN' : '',
    !internalServiceSecret ? 'PLANTER_INTERNAL_SERVICE_SECRET' : '',
  ].filter(Boolean)
  if (missing.length > 0) throw new Error(`Planter pool missing required environment: ${missing.join(', ')}`)
  return { gatewayOrigin: gatewayOrigin!, gatewayServiceToken: gatewayServiceToken!, internalServiceSecret: internalServiceSecret! }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const port = Number(process.env.PORT ?? 8793)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid PORT '${process.env.PORT}'`)
    createPlanterPoolServer(poolConfigFromProcessEnv(process.env)).listen(port, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log(`planter-pool listening on 0.0.0.0:${port}`)
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`planter-pool: failed to boot — ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
