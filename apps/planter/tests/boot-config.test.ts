// @vitest-environment node
//
// Pure config-resolution logic — URL/JSON/env parsing, no network to a real
// service (the priority-tier fetch itself is exercised against a REAL
// same-origin-shaped Response via a real node:http server in one test, never
// a stubbed fetch contract). The refuse-ambiguous-factory test drives the
// REAL `resolveAdapter`/`sourceFromBoot` (packages/source, already covered
// end-to-end against real infra by U3/U4/U6/U7's own suites) to confirm the
// SPA's resolved `PlanterBootConfig` shape composes with it correctly.

/**
 * boot-config.test.ts — U11 acceptance: the SPA's three-tier boot resolution
 * (URL params → /planter.config.json → VITE_PLANTER_* env vars), all three
 * `PlanterAuth` arms (none/dev/cognito), and the refuse-ambiguous factory.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BootConfigError, type PlanterBootConfig, resolveAdapter, sourceFromBoot } from '@shrubbery/source'
import { describe, expect, it } from 'vitest'
import {
  bootConfigFromEnv,
  bootConfigFromJson,
  bootConfigFromParams,
  resolveBootConfig,
} from '../src/main.js'
import { bootConfigFromProcessEnv } from '../src/server-boot.js'

// ── Tier 1 — URL params ──────────────────────────────────────────────────────

describe('bootConfigFromParams', () => {
  it('returns null when neither endpoint nor graph is present (defer to the next tier)', () => {
    expect(bootConfigFromParams('')).toBeNull()
    expect(bootConfigFromParams('?foo=bar')).toBeNull()
  })

  it('refuses a half-specified pair, naming both required fields', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell')).toThrow(BootConfigError)
    expect(() => bootConfigFromParams('?endpoint=/cell')).toThrow(/endpoint.*graph/)
    expect(() => bootConfigFromParams('?graph=g1')).toThrow(BootConfigError)
  })

  it("auth arm 'none' (the default when authMode is absent)", () => {
    const config = bootConfigFromParams('?endpoint=/cell&graph=g1')
    expect(config).toEqual({ endpoint: '/cell', graph: 'g1', auth: { mode: 'none' } })
  })

  it("auth arm 'dev' requires a token", () => {
    const config = bootConfigFromParams('?endpoint=/cell&graph=g1&authMode=dev&token=tok123')
    expect(config?.auth).toEqual({ mode: 'dev', token: 'tok123' })
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&authMode=dev')).toThrow(/'dev'/)
  })

  it("auth arm 'cognito' requires region + clientId (userPoolId optional)", () => {
    const config = bootConfigFromParams(
      '?endpoint=https://api.canary.sophia-labs.com&graph=g1&authMode=cognito&region=us-west-1&clientId=abc',
    )
    expect(config?.auth).toEqual({ mode: 'cognito', region: 'us-west-1', clientId: 'abc' })
    const withPool = bootConfigFromParams(
      '?endpoint=https://x&graph=g1&authMode=cognito&region=us-west-1&clientId=abc&userPoolId=pool1',
    )
    expect(withPool?.auth).toEqual({ mode: 'cognito', region: 'us-west-1', clientId: 'abc', userPoolId: 'pool1' })
    expect(() =>
      bootConfigFromParams('?endpoint=https://x&graph=g1&authMode=cognito&region=us-west-1'),
    ).toThrow(/'cognito'/)
  })

  it('refuses an unrecognized auth mode', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&authMode=bogus')).toThrow(/bogus/)
  })

  it('carries owner, adapter, pollMs, configGraphIri, readPath, and bundle through when given', () => {
    const config = bootConfigFromParams(
      '?endpoint=https://api.canary.sophia-labs.com&graph=g1&owner=agent%3Aphanes&adapter=hosted-gateway&pollMs=1500&configGraphIri=urn:x&readPath=sparql&bundle=garden',
    )
    expect(config).toEqual({
      endpoint: 'https://api.canary.sophia-labs.com',
      graph: 'g1',
      owner: 'agent:phanes',
      auth: { mode: 'none' },
      adapter: 'hosted-gateway',
      pollMs: 1500,
      configGraphIri: 'urn:x',
      readPath: 'sparql',
      bundle: 'garden',
    })
  })

  // ── HIGH-1: strict enum validation at the URL-params boundary ─────────────

  it('HIGH-1: refuses an unrecognized adapter value, naming the field and the offending value', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&adapter=not-a-real-adapter')).toThrow(
      BootConfigError,
    )
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&adapter=not-a-real-adapter')).toThrow(
      /not-a-real-adapter/,
    )
  })

  it('HIGH-1: refuses an unrecognized readPath value — never silently discarded', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&readPath=bogus-path')).toThrow(BootConfigError)
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&readPath=bogus-path')).toThrow(/bogus-path/)
  })

  it('refuses an unsafe bundle registry id at the URL boundary', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&bundle=../garden')).toThrow(/bundle/)
  })

  it('refuses an untyped or path-shaped owner at the URL boundary', () => {
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&owner=phanes')).toThrow(/owner/)
    expect(() => bootConfigFromParams('?endpoint=/cell&graph=g1&owner=user%3Avera%2Fother')).toThrow(/owner/)
  })
})

// ── Tier 2 — planter.config.json body ───────────────────────────────────────

describe('bootConfigFromJson', () => {
  it('refuses a non-object body', () => {
    expect(() => bootConfigFromJson(null)).toThrow(BootConfigError)
    expect(() => bootConfigFromJson([1, 2])).toThrow(BootConfigError)
    expect(() => bootConfigFromJson('a string')).toThrow(BootConfigError)
  })

  it("refuses a body missing 'endpoint' or 'graph'", () => {
    expect(() => bootConfigFromJson({ graph: 'g1' })).toThrow(/endpoint/)
    expect(() => bootConfigFromJson({ endpoint: '/cell' })).toThrow(/graph/)
  })

  it("defaults auth to 'none' when omitted (the committed planter.config.json shape)", () => {
    const config = bootConfigFromJson({ endpoint: '/cell', graph: 'planter-dev', adapter: 'gardend-local' })
    expect(config).toEqual({ endpoint: '/cell', graph: 'planter-dev', auth: { mode: 'none' }, adapter: 'gardend-local' })
  })

  it("auth arm 'dev' and 'cognito' parse from the nested auth object", () => {
    const dev = bootConfigFromJson({ endpoint: 'http://127.0.0.1:7090', graph: 'g1', auth: { mode: 'dev', token: 'tok' } })
    expect(dev.auth).toEqual({ mode: 'dev', token: 'tok' })
    const cognito = bootConfigFromJson({
      endpoint: 'https://api.canary.sophia-labs.com',
      graph: 'g1',
      auth: { mode: 'cognito', region: 'us-west-1', clientId: 'abc', userPoolId: 'pool1' },
    })
    expect(cognito.auth).toEqual({ mode: 'cognito', region: 'us-west-1', clientId: 'abc', userPoolId: 'pool1' })
  })

  // ── HIGH-1: strict enum validation + no auth downgrade at the JSON boundary

  it('HIGH-1: refuses an unrecognized adapter value, naming the field and the offending value', () => {
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', adapter: 'not-a-real-adapter' }),
    ).toThrow(BootConfigError)
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', adapter: 'not-a-real-adapter' }),
    ).toThrow(/not-a-real-adapter/)
  })

  it('HIGH-1: refuses a non-string adapter value (never silently dropped)', () => {
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', adapter: 42 })).toThrow(BootConfigError)
  })

  it('HIGH-1: refuses an unrecognized readPath value — never silently discarded', () => {
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', readPath: 'bogus-path' }),
    ).toThrow(BootConfigError)
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', readPath: 'bogus-path' }),
    ).toThrow(/bogus-path/)
  })

  it('refuses a non-string or unsafe bundle registry id at the JSON boundary', () => {
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', bundle: 42 })).toThrow(/bundle/)
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', bundle: '../garden' })).toThrow(/bundle/)
  })

  it('carries an exact typed owner and refuses malformed owner values at the JSON boundary', () => {
    expect(bootConfigFromJson({ endpoint: '/cell', graph: 'g1', owner: 'service:planter' }).owner)
      .toBe('service:planter')
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', owner: 42 })).toThrow(/owner/)
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', owner: ' user:vera' })).toThrow(/owner/)
  })

  it("HIGH-1: a malformed 'auth' value NEVER silently downgrades to mode 'none' — it refuses, naming the offending value", () => {
    // A string where an object was expected.
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: 'dev' })).toThrow(BootConfigError)
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: 'dev' })).toThrow(/'auth'/)
    // A number.
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: 123 })).toThrow(BootConfigError)
    // An array.
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: ['dev'] })).toThrow(BootConfigError)
    // null (explicit, distinct from omitted).
    expect(() => bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: null })).toThrow(BootConfigError)
    // A non-string `auth.mode` inside an otherwise object-shaped auth.
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: { mode: 42 } }),
    ).toThrow(BootConfigError)
    expect(() =>
      bootConfigFromJson({ endpoint: '/cell', graph: 'g1', auth: { mode: 42 } }),
    ).toThrow(/'auth\.mode'/)
  })
})

// ── Tier 3 — VITE_PLANTER_* env vars ────────────────────────────────────────

describe('bootConfigFromEnv', () => {
  it('returns null when neither var is present', () => {
    expect(bootConfigFromEnv({})).toBeNull()
    expect(bootConfigFromEnv({ SOME_OTHER: 'x' })).toBeNull()
  })

  it('refuses a half-specified pair', () => {
    expect(() => bootConfigFromEnv({ VITE_PLANTER_ENDPOINT: '/cell' })).toThrow(BootConfigError)
    expect(() => bootConfigFromEnv({ VITE_PLANTER_GRAPH: 'g1' })).toThrow(BootConfigError)
  })

  it("all three auth arms parse from VITE_PLANTER_AUTH_* vars", () => {
    expect(
      bootConfigFromEnv({ VITE_PLANTER_ENDPOINT: '/cell', VITE_PLANTER_GRAPH: 'g1' })?.auth,
    ).toEqual({ mode: 'none' })
    expect(
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: '/cell',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_AUTH_MODE: 'dev',
        VITE_PLANTER_AUTH_TOKEN: 'tok',
      })?.auth,
    ).toEqual({ mode: 'dev', token: 'tok' })
    expect(
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: 'https://api.canary.sophia-labs.com',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_AUTH_MODE: 'cognito',
        VITE_PLANTER_AUTH_REGION: 'us-west-1',
        VITE_PLANTER_AUTH_CLIENT_ID: 'abc',
      })?.auth,
    ).toEqual({ mode: 'cognito', region: 'us-west-1', clientId: 'abc' })
  })

  it('carries owner, adapter, readPath, and bundle through when given', () => {
    const config = bootConfigFromEnv({
      VITE_PLANTER_ENDPOINT: '/cell',
      VITE_PLANTER_GRAPH: 'g1',
      VITE_PLANTER_OWNER: 'organization:sophia-labs',
      VITE_PLANTER_ADAPTER: 'gardend-local',
      VITE_PLANTER_READ_PATH: 'sparql',
      VITE_PLANTER_BUNDLE: 'garden',
    })
    expect(config).toMatchObject({
      owner: 'organization:sophia-labs',
      adapter: 'gardend-local',
      readPath: 'sparql',
      bundle: 'garden',
    })
  })

  it('refuses malformed owner principals from env', () => {
    expect(() => bootConfigFromEnv({
      VITE_PLANTER_ENDPOINT: '/cell',
      VITE_PLANTER_GRAPH: 'g1',
      VITE_PLANTER_OWNER: 'service:',
    })).toThrow(/owner/)
  })

  // ── HIGH-1: strict enum validation at the env-var boundary ─────────────

  it('HIGH-1: refuses an unrecognized adapter value, naming the field and the offending value', () => {
    expect(() =>
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: '/cell',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_ADAPTER: 'not-a-real-adapter',
      }),
    ).toThrow(BootConfigError)
    expect(() =>
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: '/cell',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_ADAPTER: 'not-a-real-adapter',
      }),
    ).toThrow(/not-a-real-adapter/)
  })

  it('HIGH-1: refuses an unrecognized readPath value — never silently discarded', () => {
    expect(() =>
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: '/cell',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_READ_PATH: 'bogus-path',
      }),
    ).toThrow(BootConfigError)
    expect(() =>
      bootConfigFromEnv({
        VITE_PLANTER_ENDPOINT: '/cell',
        VITE_PLANTER_GRAPH: 'g1',
        VITE_PLANTER_READ_PATH: 'bogus-path',
      }),
    ).toThrow(/bogus-path/)
  })
})

describe('bootConfigFromProcessEnv', () => {
  it('carries the exact owner through the Node server boundary', () => {
    expect(bootConfigFromProcessEnv({
      PLANTER_ENDPOINT: 'https://api.canary.sophia-labs.com',
      PLANTER_GRAPH: 'phanes',
      PLANTER_OWNER: 'agent:phanes',
      PLANTER_ADAPTER: 'hosted-gateway',
    })).toMatchObject({
      graph: 'phanes',
      owner: 'agent:phanes',
      adapter: 'hosted-gateway',
    })
  })

  it('refuses an invalid owner at the Node server boundary', () => {
    expect(() => bootConfigFromProcessEnv({
      PLANTER_ENDPOINT: 'https://api.canary.sophia-labs.com',
      PLANTER_GRAPH: 'phanes',
      PLANTER_OWNER: 'phanes',
      PLANTER_ADAPTER: 'hosted-gateway',
    })).toThrow(/owner/)
  })
})

// ── resolveBootConfig — the priority ordering, against REAL fetches ────────

describe('resolveBootConfig — tier ordering', () => {
  it('URL params win outright, even with a config.json server available', async () => {
    const config = await resolveBootConfig({
      search: '?endpoint=/cell&graph=from-url',
      fetchConfig: () => {
        throw new Error('must not be called — URL params already resolved')
      },
    })
    expect(config.graph).toBe('from-url')
  })

  it('falls through to config.json when URL params are absent — a REAL http server, not a stub', async () => {
    let server: Server | undefined
    try {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ endpoint: '/cell', graph: 'from-json', auth: { mode: 'none' } }))
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      const config = await resolveBootConfig({
        search: '',
        fetchConfig: () => fetch(`http://127.0.0.1:${port}/planter.config.json`),
      })
      expect(config.graph).toBe('from-json')
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    }
  })

  it('falls through past a 404 config.json AND absent URL params to env vars', async () => {
    let server: Server | undefined
    try {
      server = createServer((_req, res) => {
        res.writeHead(404)
        res.end('not found')
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      const config = await resolveBootConfig({
        search: '',
        fetchConfig: () => fetch(`http://127.0.0.1:${port}/planter.config.json`),
        env: { VITE_PLANTER_ENDPOINT: '/cell', VITE_PLANTER_GRAPH: 'from-env' },
      })
      expect(config.graph).toBe('from-env')
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    }
  })

  it('falls through past a network-unreachable config.json fetch to env vars', async () => {
    const config = await resolveBootConfig({
      search: '',
      fetchConfig: () => Promise.reject(new Error('ECONNREFUSED (simulated unreachable dev server)')),
      env: { VITE_PLANTER_ENDPOINT: '/cell', VITE_PLANTER_GRAPH: 'from-env-2' },
    })
    expect(config.graph).toBe('from-env-2')
  })

  it('throws BootConfigError naming what is missing when NO tier resolves', async () => {
    await expect(
      resolveBootConfig({
        search: '',
        fetchConfig: () => Promise.reject(new Error('ECONNREFUSED')),
        env: {},
      }),
    ).rejects.toThrow(BootConfigError)
  })

  it('a malformed config.json body is a real error, NOT silently skipped to env', async () => {
    let server: Server | undefined
    try {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ graph: 'missing-endpoint' }))
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      await expect(
        resolveBootConfig({
          search: '',
          fetchConfig: () => fetch(`http://127.0.0.1:${port}/planter.config.json`),
          env: { VITE_PLANTER_ENDPOINT: '/cell', VITE_PLANTER_GRAPH: 'should-not-be-reached' },
        }),
      ).rejects.toThrow(/endpoint/)
    } finally {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve())
    }
  })
})

// ── The committed public/planter.config.json IS a valid tier-2 body ────────

describe('the committed apps/planter/public/planter.config.json', () => {
  it('parses as a valid boot config (gardend-local over the dev proxy, auth none)', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const path = fileURLToPath(new URL('../public/planter.config.json', import.meta.url))
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    const config = bootConfigFromJson(raw)
    expect(config).toEqual({
      endpoint: '/cell',
      graph: 'planter-dev',
      bundle: 'garden',
      adapter: 'gardend-local',
      auth: { mode: 'none' },
    })
  })
})

// ── Refuse-ambiguous factory — resolveBootConfig composes with sourceFromBoot

describe('refuse-ambiguous factory — a resolved boot config still refuses without a naming adapter', () => {
  it('a config with no adapter field and non-inferable endpoint/auth refuses, naming the field', async () => {
    const config: PlanterBootConfig = { endpoint: 'http://127.0.0.1:7090', graph: 'g1', auth: { mode: 'none' } }
    expect(() => resolveAdapter(config)).toThrow(BootConfigError)
    expect(() => resolveAdapter(config)).toThrow(/'adapter'/)
    await expect(sourceFromBoot(config)).rejects.toThrow(BootConfigError)
  })

  it('the SAME shape resolved through the URL-params tier refuses identically', async () => {
    const config = bootConfigFromParams('?endpoint=http://127.0.0.1:7090&graph=g1')!
    await expect(sourceFromBoot(config)).rejects.toThrow(/'adapter'/)
  })

  it('an explicit adapter on the resolved config always wins (no refusal)', () => {
    const config = bootConfigFromParams('?endpoint=http://127.0.0.1:7090&graph=g1&adapter=gardend-local')!
    expect(resolveAdapter(config)).toBe('gardend-local')
  })
})
