/**
 * boot-factory.test.ts — sourceFromBoot's R8 refusal semantics + the auth
 * union, against REAL artifacts (a real fossil file on disk, the real seed
 * body — no mocks).
 *
 *   - explicit `adapter` ALWAYS wins over both inference rules;
 *   - exactly two inference rules: 'static:' → static-nt, cognito →
 *     hosted-gateway;
 *   - any other adapter-less config is REFUSED with an error naming the
 *     'adapter' field;
 *   - the static-nt branch is fully wired end-to-end (fossil v1 header →
 *     StaticNtSource → the canonical seed, readAt = capture time);
 *   - ALL FOUR adapters are now wired (U7 landed hosted-gateway last) — no
 *     not-wired throws remain in sourceFromBoot;
 *   - createAuthProvider: dev → StaticAuth, none → AnonymousAuth, cognito →
 *     a REAL (offline-safe, storageless-in-Node) CognitoAuthSession.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNT, uxConfigGraphIri } from '@shrubbery/nucleus'
import { describe, expect, it } from 'vitest'
import {
  BootConfigError,
  bootGraphIri,
  createAuthProvider,
  DEFAULT_SUGGESTED_POLL_MS,
  type HostedGatewaySourceDescription,
  type PlanterBootConfig,
  resolveAdapter,
  type SparqlSourceDescription,
  serializeFossil,
  sourceFromBoot,
} from '../src/index.js'

const require = createRequire(import.meta.url)
const SEED_BODY = readFileSync(
  require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length
const GRAPH_IRI = uxConfigGraphIri('g1')
const CAPTURED_AT = Date.UTC(2026, 5, 1, 12, 0, 0)

const DEV_AUTH = { mode: 'dev', token: 'bench-token' } as const
const COGNITO_AUTH = {
  mode: 'cognito',
  region: 'us-west-1',
  clientId: 'test-client',
} as const

/** A REAL fossil file on disk: the canonical seed under a v1 header. */
function writeRealFossil(): string {
  const dir = mkdtempSync(join(tmpdir(), 'planter-fossil-'))
  const path = join(dir, 'g1-ux-config.nt')
  writeFileSync(
    path,
    serializeFossil(
      { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT, source: 'gardend-local http://127.0.0.1:7090' },
      SEED_BODY,
    ),
    'utf8',
  )
  return path
}

describe('resolveAdapter — explicit wins, two inference rules, refuse-ambiguous', () => {
  it('explicit adapter always wins (even over both inference rules at once)', () => {
    expect(
      resolveAdapter({ endpoint: 'static:/tmp/x.nt', graph: 'g1', auth: COGNITO_AUTH, adapter: 'gardend-local' }),
    ).toBe('gardend-local')
    expect(
      resolveAdapter({ endpoint: 'static:/tmp/x.nt', graph: 'g1', auth: DEV_AUTH, adapter: 'sparql' }),
    ).toBe('sparql')
    expect(
      resolveAdapter({ endpoint: 'http://127.0.0.1:7090', graph: 'g1', auth: DEV_AUTH, adapter: 'gardend-local' }),
    ).toBe('gardend-local')
  })

  it("rule 1: endpoint 'static:…' infers static-nt", () => {
    expect(resolveAdapter({ endpoint: 'static:/tmp/x.nt', graph: 'g1', auth: DEV_AUTH })).toBe('static-nt')
    expect(resolveAdapter({ endpoint: 'static:https://cdn.example/f.nt', graph: 'g1', auth: { mode: 'none' } })).toBe('static-nt')
  })

  it("rule 2: auth.mode 'cognito' infers hosted-gateway", () => {
    expect(
      resolveAdapter({ endpoint: 'https://api.canary.sophia-labs.com', graph: 'g1', auth: COGNITO_AUTH }),
    ).toBe('hosted-gateway')
  })

  it("rule 1 beats rule 2 ('static:' + cognito → static-nt)", () => {
    expect(resolveAdapter({ endpoint: 'static:/tmp/x.nt', graph: 'g1', auth: COGNITO_AUTH })).toBe('static-nt')
  })

  it("any other adapter-less config is refused, naming the 'adapter' field", () => {
    const ambiguous: PlanterBootConfig[] = [
      { endpoint: 'http://127.0.0.1:7090', graph: 'g1', auth: DEV_AUTH },
      { endpoint: 'https://api.canary.sophia-labs.com', graph: 'g1', auth: { mode: 'none' } },
      { endpoint: 'http://fuseki.example/ds/sparql', graph: 'g1', auth: DEV_AUTH },
    ]
    for (const config of ambiguous) {
      expect(() => resolveAdapter(config)).toThrow(BootConfigError)
      expect(() => resolveAdapter(config)).toThrow(/'adapter'/)
    }
  })

  it('HIGH-1: refuses an explicit adapter value outside PLANTER_ADAPTERS — a boot-input boundary the type system alone cannot guard (a caller casting an untrusted string bypasses it)', () => {
    const bogus = {
      endpoint: 'http://127.0.0.1:7090',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'not-a-real-adapter',
    } as unknown as PlanterBootConfig
    expect(() => resolveAdapter(bogus)).toThrow(BootConfigError)
    expect(() => resolveAdapter(bogus)).toThrow(/not-a-real-adapter/)
  })
})

describe('sourceFromBoot', () => {
  it("'static:<file>' boots a fully-wired fossil source (canonical seed, readAt = capture)", async () => {
    const path = writeRealFossil()
    const source = await sourceFromBoot({
      endpoint: `static:${path}`,
      graph: 'g1',
      auth: { mode: 'none' },
    })
    expect(source.description.kind).toBe('static-nt')
    expect(source.description.liveness).toBe('static')
    const read = await source.read(GRAPH_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(read.readAt).toBe(CAPTURED_AT)
    expect(read.nt).toContain('# shrubbery fossil v1')
    await source.close()
  })

  it("'static:' over a headerless body refuses construction (provenance doctrine)", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'planter-fossil-'))
    const path = join(dir, 'headerless.nt')
    writeFileSync(path, '<urn:s> <urn:p> "o" .\n', 'utf8')
    await expect(
      sourceFromBoot({ endpoint: `static:${path}`, graph: 'g1', auth: { mode: 'none' } }),
    ).rejects.toThrow(/capture provenance/)
  })

  it('refuses the ambiguous config with the error naming the adapter field', async () => {
    await expect(
      sourceFromBoot({ endpoint: 'http://127.0.0.1:7090', graph: 'g1', auth: DEV_AUTH }),
    ).rejects.toThrow(/'adapter'/)
  })

  it('HIGH-1: an explicit adapter outside PLANTER_ADAPTERS refuses — never resolves to `undefined` off an unmatched switch branch', async () => {
    const bogus = {
      endpoint: 'http://127.0.0.1:7090',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'not-a-real-adapter',
    } as unknown as PlanterBootConfig
    await expect(sourceFromBoot(bogus)).rejects.toThrow(BootConfigError)
    await expect(sourceFromBoot(bogus)).rejects.toThrow(/not-a-real-adapter/)
  })

  it("'gardend-local' boots the U4 adapter (construction is offline-safe — no network until read)", async () => {
    const source = await sourceFromBoot({
      endpoint: 'http://127.0.0.1:7090',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'gardend-local',
      pollMs: 4000,
    })
    expect(source.description.kind).toBe('gardend-local')
    expect(source.description.liveness).toBe('poll')
    expect(source.description.sparql).toBe(true)
    expect(source.description.endpoint).toBe('http://127.0.0.1:7090/mcp')
    expect(source.description.suggestedPollMs).toBe(4000)
    expect(JSON.stringify(source.description)).not.toContain('bench-token')
    expect(typeof source.select).toBe('function')
    await source.close() // liveness is proven against a REAL cell in tests/gardend-conformance.integration.test.ts
  })

  it("MED-1: with NO boot pollMs, 'gardend-local' still declares the package's DEFAULT_SUGGESTED_POLL_MS (never undefined)", async () => {
    const source = await sourceFromBoot({
      endpoint: 'http://127.0.0.1:7090',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'gardend-local',
    })
    expect(source.description.suggestedPollMs).toBe(DEFAULT_SUGGESTED_POLL_MS)
    await source.close()
  })

  it("'sparql' boots the U6 adapter (construction is offline-safe — no network until read)", async () => {
    const source = await sourceFromBoot({
      endpoint: 'http://fuseki.example/ds/sparql',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'sparql',
      configGraphIri: 'urn:example:site',
      pollMs: 9000,
    })
    expect(source.description.kind).toBe('sparql-http')
    expect(source.description.liveness).toBe('poll')
    expect(source.description.sparql).toBe(true)
    expect(source.description.endpoint).toBe('http://fuseki.example/ds/sparql')
    expect((source.description as SparqlSourceDescription).graphIri).toBe('urn:example:site')
    expect(source.description.suggestedPollMs).toBe(9000)
    expect(JSON.stringify(source.description)).not.toContain('bench-token')
    expect(typeof source.select).toBe('function')
    await source.close() // liveness is proven against the REAL engine in tests/sparql-conformance.integration.test.ts
  })

  it("'hosted-gateway' boots the U7 adapter (construction is offline-safe — no network until read)", async () => {
    const source = await sourceFromBoot({
      endpoint: 'https://api.canary.sophia-labs.com',
      graph: 'g1',
      owner: 'agent:phanes',
      auth: COGNITO_AUTH,
      adapter: 'hosted-gateway',
      pollMs: 6000,
    })
    expect(source.description.kind).toBe('hosted-gateway')
    expect(source.description.liveness).toBe('poll')
    expect(source.description.sparql).toBe(true)
    expect(source.description.endpoint).toBe(
      'https://api.canary.sophia-labs.com/o/agent%3Aphanes/g/g1',
    )
    expect((source.description as HostedGatewaySourceDescription).owner).toBe('agent:phanes')
    expect((source.description as HostedGatewaySourceDescription).readPath).toBe('sparql')
    expect(source.description.suggestedPollMs).toBe(6000)
    expect(JSON.stringify(source.description)).not.toContain('bench-token')
    expect(typeof source.select).toBe('function')
    await source.close() // liveness is proven against a REAL gardend in tests/gateway-conformance.integration.test.ts
  })

  it("'hosted-gateway' honors an explicit readPath: 'mcp' override", async () => {
    const source = await sourceFromBoot({
      endpoint: 'https://api.canary.sophia-labs.com',
      graph: 'g1',
      owner: 'user:vera',
      auth: DEV_AUTH,
      adapter: 'hosted-gateway',
      readPath: 'mcp',
    })
    expect((source.description as HostedGatewaySourceDescription).readPath).toBe('mcp')
    await source.close()
  })

  it("'hosted-gateway' refuses an ownerless graph slug", async () => {
    await expect(sourceFromBoot({
      endpoint: 'https://api.canary.sophia-labs.com',
      graph: 'g1',
      auth: DEV_AUTH,
      adapter: 'hosted-gateway',
    })).rejects.toThrow(/exact 'owner'/)
  })
})

describe('bootGraphIri', () => {
  it('defaults to uxConfigGraphIri(graph)', () => {
    expect(bootGraphIri({ endpoint: 'x', graph: 'g1', auth: { mode: 'none' } })).toBe(GRAPH_IRI)
  })
  it('configGraphIri overrides (non-Mnemosyne stores)', () => {
    expect(
      bootGraphIri({ endpoint: 'x', graph: 'g1', auth: { mode: 'none' }, configGraphIri: 'urn:x:y' }),
    ).toBe('urn:x:y')
  })
})

describe('createAuthProvider — the R8 auth union', () => {
  it("'dev' → StaticAuth carrying the real token", async () => {
    const auth = createAuthProvider(DEV_AUTH)
    expect(auth.token()).toBe('bench-token')
    expect(auth.isAuthenticated()).toBe(true)
    expect(auth.userId()).toBe('dev')
    await auth.whenReady()
    const off = auth.onChange(() => {})
    expect(typeof off).toBe('function')
    off()
  })

  it("'none' → AnonymousAuth (no credential, honestly unauthenticated)", async () => {
    const auth = createAuthProvider({ mode: 'none' })
    expect(auth.token()).toBeUndefined()
    expect(auth.isAuthenticated()).toBe(false)
    expect(auth.userId()).toBe('anonymous')
    await auth.whenReady()
  })

  it("'cognito' → a REAL CognitoAuthSession, offline-safe (no signed-in tokens yet)", async () => {
    const auth = createAuthProvider(COGNITO_AUTH)
    expect(auth.token()).toBeUndefined()
    expect(auth.isAuthenticated()).toBe(false)
    await auth.whenReady() // gates restore(); no stored tokens (and no cloud call) → settles anonymous
    expect(auth.userId()).toBe('')
    const off = auth.onChange(() => {})
    expect(typeof off).toBe('function')
    off()
  })
})
