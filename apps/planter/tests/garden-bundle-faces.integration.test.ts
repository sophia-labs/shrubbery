// @vitest-environment node

import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import { GARDEN_SITE_BUNDLE } from '@shrubbery/site/garden'
import { staticNtSource } from '@shrubbery/source'
import { createPlanterServer } from '../src/server.js'

const require_ = createRequire(import.meta.url)
const SEED_NT = readFileSync(require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'), 'utf8')
const GRAPH_ID = 'planter-garden-bundle-faces'

describe('Garden bundle routes use Planter four-face rendering', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const source = staticNtSource(SEED_NT, {
      graphIri: uxConfigGraphIri(GRAPH_ID),
      capturedAt: Date.UTC(2026, 6, 12, 12),
      source: 'garden-bundle-face-test',
    })
    server = createPlanterServer({ source, graphId: GRAPH_ID, bundle: GARDEN_SITE_BUNDLE })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  for (const route of GARDEN_SITE_BUNDLE.routes) {
    for (const face of GARDEN_SITE_BUNDLE.faces) {
      it(`${route.path} serves ${face.target} from the generic host`, async () => {
        const path = route.path === '/' ? '/' : `${route.path}${face.suffix}`
        const res = await fetch(`${base}${path}`, {
          ...(route.path === '/' ? { headers: { Accept: face.mediaType } } : {}),
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe(face.mediaType)
        expect(res.headers.get('x-shrubbery-source')).toBe('static-nt')
        expect(res.headers.get('x-shrubbery-bundle')).toBe('garden')
      })
    }
  }
})
