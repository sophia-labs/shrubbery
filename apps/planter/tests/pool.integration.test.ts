// @vitest-environment node

import type { Server } from 'node:http'
import { GARDEN_DEFAULT, serializeConfigToTriples, termToNT } from '@shrubbery/nucleus'
import { GARDEN_SITE_BUNDLE } from '@shrubbery/site'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPlanterPoolServer,
  PLANTER_POOL_HEADERS,
  pinnedSiteDefinitionDigest,
  poolConfigFromProcessEnv,
} from '../src/pool.js'

const INTERNAL_SECRET = 'pool-internal-secret'
const SERVICE_TOKEN = 'gateway-service-token'
const OWNER = 'user:specialist-sub'
const GRAPH = 'shrubbery-domain'
const DEFINITION_IRI = `urn:mnemosyne:local:graph:${GRAPH}:projection:site:definition:garden`

interface CapturedFetch {
  readonly url: string
  readonly authorization: string | null
  readonly onBehalfOf: string | null
  readonly query: string
}

function gatewayRowsFor(query: string): readonly Record<string, string>[] {
  if (query.includes('SiteDefinition')) {
    return [{
      definition: `<${DEFINITION_IRI}>`,
      bundleId: '"garden"',
      bundleVersion: '"0.1.0-local"',
      package: '"@shrubbery/planter"',
      version: '"0.0.0"',
      layoutSha: `"${GARDEN_SITE_BUNDLE.layoutSeedSha256}"`,
    }]
  }
  return serializeConfigToTriples(GARDEN_DEFAULT).map((triple) => ({
    s: `<${triple.s}>`,
    p: `<${triple.p}>`,
    o: termToNT(triple.o),
  }))
}

function publicHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  const definitionSha256 = pinnedSiteDefinitionDigest({
    definitionIri: DEFINITION_IRI,
    bundleId: 'garden',
    bundleVersion: '0.1.0-local',
    packageName: '@shrubbery/planter',
    version: '0.0.0',
    layoutSha256: GARDEN_SITE_BUNDLE.layoutSeedSha256,
  })
  return {
    [PLANTER_POOL_HEADERS.internalService]: INTERNAL_SECRET,
    [PLANTER_POOL_HEADERS.graphOwner]: OWNER,
    [PLANTER_POOL_HEADERS.graphId]: GRAPH,
    [PLANTER_POOL_HEADERS.publicReadToken]: 'signed-site-read-token',
    [PLANTER_POOL_HEADERS.interpreterPackage]: '@shrubbery/planter',
    [PLANTER_POOL_HEADERS.interpreterVersion]: '0.0.0',
    [PLANTER_POOL_HEADERS.bundleId]: 'garden',
    [PLANTER_POOL_HEADERS.bundleVersion]: '0.1.0-local',
    [PLANTER_POOL_HEADERS.layoutSha256]: GARDEN_SITE_BUNDLE.layoutSeedSha256,
    [PLANTER_POOL_HEADERS.definitionSha256]: definitionSha256,
    ...overrides,
  }
}

function mockGatewayFetch(captured: CapturedFetch[]): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const headers = new Headers(init?.headers)
    const parsed = JSON.parse(String(init?.body)) as { query: string }
    captured.push({
      url,
      authorization: headers.get('authorization'),
      onBehalfOf: headers.get('x-pn-on-behalf-of'),
      query: parsed.query,
    })
    return Response.json({ rows: gatewayRowsFor(parsed.query) })
  }) as typeof fetch
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('pool did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function trustedHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [PLANTER_POOL_HEADERS.internalService]: INTERNAL_SECRET,
    [PLANTER_POOL_HEADERS.graphOwner]: OWNER,
    [PLANTER_POOL_HEADERS.graphId]: GRAPH,
    [PLANTER_POOL_HEADERS.actorSub]: 'specialist-sub',
    ...overrides,
  }
}

let active: Server | undefined
afterEach(async () => {
  if (active) await close(active)
  active = undefined
})

describe('Planter stateless pool', () => {
  it('reports process health without a target, credential, or upstream read', async () => {
    const calls: CapturedFetch[] = []
    active = createPlanterPoolServer({
      gatewayOrigin: 'https://gateway.example.test',
      gatewayServiceToken: SERVICE_TOKEN,
      internalServiceSecret: INTERNAL_SECRET,
      fetch: mockGatewayFetch(calls),
    })
    const base = await listen(active)
    const response = await fetch(`${base}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      service: 'planter-pool',
      interpreters: [{ packageName: '@shrubbery/planter', version: '0.0.0', bundleId: 'garden' }],
    })
    expect(calls).toEqual([])
  })

  it('reads the graph pin then renders through only the exact owner route and delegated user', async () => {
    const calls: CapturedFetch[] = []
    active = createPlanterPoolServer({
      gatewayOrigin: 'https://gateway.example.test',
      gatewayServiceToken: SERVICE_TOKEN,
      internalServiceSecret: INTERNAL_SECRET,
      fetch: mockGatewayFetch(calls),
    })
    const base = await listen(active)
    const response = await fetch(`${base}/workspace.json`, {
      headers: trustedHeaders({ accept: 'application/ld+json' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-shrubbery-bundle')).toBe('garden')
    expect((await response.json()) as object).toHaveProperty('@context')
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe(
        'https://gateway.example.test/o/user%3Aspecialist-sub/g/shrubbery-domain/api/sparql/query',
      )
      expect(call.authorization).toBe(`Bearer ${SERVICE_TOKEN}`)
      expect(call.onBehalfOf).toBe('specialist-sub')
    }
    expect(calls[0]?.query).toContain(':projection:site')
    expect(calls[1]?.query).toContain(':ux:config')
  })

  it('refuses missing internal auth and ownerless targets before any gateway call', async () => {
    const calls: CapturedFetch[] = []
    active = createPlanterPoolServer({
      gatewayOrigin: 'https://gateway.example.test',
      gatewayServiceToken: SERVICE_TOKEN,
      internalServiceSecret: INTERNAL_SECRET,
      fetch: mockGatewayFetch(calls),
    })
    const base = await listen(active)
    const unauthenticated = await fetch(`${base}/workspace`, {
      headers: trustedHeaders({ [PLANTER_POOL_HEADERS.internalService]: 'wrong' }),
    })
    expect(unauthenticated.status).toBe(401)
    const ownerless = await fetch(`${base}/workspace`, {
      headers: {
        [PLANTER_POOL_HEADERS.internalService]: INTERNAL_SECRET,
        [PLANTER_POOL_HEADERS.graphId]: GRAPH,
        [PLANTER_POOL_HEADERS.actorSub]: 'specialist-sub',
      },
    })
    expect(ownerless.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('uses a scoped public-read lease without impersonating a user and enforces the active pin', async () => {
    const calls: CapturedFetch[] = []
    active = createPlanterPoolServer({
      gatewayOrigin: 'https://gateway.example.test',
      gatewayServiceToken: SERVICE_TOKEN,
      internalServiceSecret: INTERNAL_SECRET,
      fetch: mockGatewayFetch(calls),
    })
    const base = await listen(active)
    const response = await fetch(`${base}/workspace.json`, { headers: publicHeaders() })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.authorization).toBe('Bearer signed-site-read-token')
      expect(call.onBehalfOf).toBeNull()
    }

    calls.length = 0
    const drifted = await fetch(`${base}/workspace.json`, {
      headers: publicHeaders({ [PLANTER_POOL_HEADERS.interpreterVersion]: '0.0.1' }),
    })
    expect(drifted.status).toBe(409)
    expect(await drifted.json()).toMatchObject({ error: 'site_interpreter_refused' })
    expect(calls).toHaveLength(1)
  })

  it('refuses an unsupported graph-authored interpreter instead of selecting latest', async () => {
    const calls: CapturedFetch[] = []
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      const headers = new Headers(init?.headers)
      const parsed = JSON.parse(String(init?.body)) as { query: string }
      calls.push({
        url,
        authorization: headers.get('authorization'),
        onBehalfOf: headers.get('x-pn-on-behalf-of'),
        query: parsed.query,
      })
      return Response.json({ rows: [{
        definition: `<${DEFINITION_IRI}>`,
        bundleId: '"garden"', bundleVersion: '"0.1.0-local"',
        package: '"@shrubbery/planter"', version: '"latest"',
        layoutSha: `"${GARDEN_SITE_BUNDLE.layoutSeedSha256}"`,
      }] })
    }) as typeof fetch
    active = createPlanterPoolServer({
      gatewayOrigin: 'https://gateway.example.test',
      gatewayServiceToken: SERVICE_TOKEN,
      internalServiceSecret: INTERNAL_SECRET,
      fetch: fetchImpl,
    })
    const base = await listen(active)
    const response = await fetch(`${base}/workspace`, { headers: trustedHeaders() })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'site_interpreter_refused' })
    expect(calls).toHaveLength(1)
  })

  it('requires all three secret-bearing process bindings', () => {
    expect(() => poolConfigFromProcessEnv({})).toThrow(
      /PLANTER_GATEWAY_ORIGIN, PLANTER_GATEWAY_SERVICE_TOKEN, PLANTER_INTERNAL_SERVICE_SECRET/,
    )
  })
})
