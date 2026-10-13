// @vitest-environment node
//
// Node, not happy-dom: this suite drives a real loopback HTTP server, and
// happy-dom's fetch enforces browser CORS against `http://localhost/` — which
// would fail the request for a reason that has nothing to do with the seam.
// In the browser the same adapter only ever makes SAME-ORIGIN calls (the
// shell's own /graph routes), so no CORS question arises there either.

/**
 * The READ SEAM, end to end, with nothing stubbed.
 *
 * A REAL `node:http` server runs the REAL `aiguaMiddleware` over the REAL aigua
 * directory, and the REAL `ntHttpSource` adapter reads it over the loopback.
 * Then:
 *   - the repo's own `@shrubbery/source/conformance` kit is pointed at the
 *     adapter, so AVIARY's TripleSource is held to the same acceptance test the
 *     in-tree adapters are;
 *   - the `sux:` graph is parsed by nucleus's own `parseTriplesToConfig` and fed
 *     to the real `planFor`, proving the layout the user sees really is the
 *     interpreter's projection of RDF and not a TypeScript object in disguise.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  TripleSourceError,
  parseTriplesToConfig,
  planFor,
  triplesOf,
  uxConfigGraphIri,
} from '@shrubbery/nucleus'
import { runTripleSourceConformance } from '@shrubbery/source/conformance'
import { aiguaMiddleware } from '../src/shell/aigua-plugin.js'
import * as projector from '../src/shell/graph-projector.js'
import { ntHttpSource } from '../src/cell/nt-http-source.js'
import { AVIARY_GRAPH_ID, LIBRARY_GRAPH_IRI } from '../src/library/vocab.js'
import { projectLibrary } from '../src/library/project.js'
import { AIGUA_DIR } from '../vite.config.js'

const present = existsSync(join(AIGUA_DIR, 'instrument.json'))
const UX_GRAPH = uxConfigGraphIri(AVIARY_GRAPH_ID)

let server: Server
let base = ''

function graphsFor(origin: string): Record<string, string> {
  return {
    [LIBRARY_GRAPH_IRI]: `${origin}/graph/library.nt`,
    [UX_GRAPH]: `${origin}/graph/ux-config.nt`,
  }
}

beforeAll(async () => {
  const handler = aiguaMiddleware(AIGUA_DIR, async () => projector)
  server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404
      res.end('not a route this shell serves')
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

// ── The repo's own acceptance kit, pointed at AVIARY's adapter ───────────────

if (present) {
  runTripleSourceConformance(
    'nt-http (REAL middleware over the REAL aigua library, behind REAL loopback HTTP)',
    () => ntHttpSource({ graphs: graphsFor(base), endpoint: base }),
    {
      graphIri: LIBRARY_GRAPH_IRI,
      // Not a snapshot: the expected count is re-derived from the directory.
      get expectedTripleCount() {
        return projectLibrary(AIGUA_DIR).length
      },
      induceFailure: (source) => source.read('urn:aigua:graph:not-bound'),
    },
  )
}

describe.skipIf(!present)('AVIARY read seam', () => {
  it('testifies honestly: parsed count, live read time, both carriers agreeing', async () => {
    const source = ntHttpSource({ graphs: graphsFor(base), endpoint: base })
    const before = Date.now()
    const read = await source.read(LIBRARY_GRAPH_IRI)
    expect(read.graphIri).toBe(LIBRARY_GRAPH_IRI)
    // liveness 'poll' ⇒ readAt is READ-COMPLETION time, not a fossil capture.
    expect(read.readAt).toBeGreaterThanOrEqual(before)
    expect(read.tripleCount).toBe(triplesOf(read).length)
    expect(read.nt).toBeTypeOf('string')
    await source.close()
  })

  it('maps an unbound graph to not-found, not to an empty body', async () => {
    const source = ntHttpSource({ graphs: graphsFor(base), endpoint: base })
    await expect(source.read('urn:aigua:graph:nope')).rejects.toMatchObject({
      name: 'TripleSourceError',
      code: 'not-found',
    })
    await source.close()
  })

  it('surfaces a backend 503 verbatim as an unavailable TripleSourceError', async () => {
    // A REAL middleware over a directory that is not a library: the projection
    // refuses, the route answers 503, and the adapter must not soften it.
    const brokenHandler = aiguaMiddleware(join(AIGUA_DIR, '__no_such_dir__'), async () => projector)
    const broken = createServer((req, res) => brokenHandler(req, res, () => res.end()))
    await new Promise<void>((done) => broken.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${(broken.address() as AddressInfo).port}`
    const source = ntHttpSource({ graphs: graphsFor(origin), endpoint: origin })
    try {
      await source.read(LIBRARY_GRAPH_IRI)
      expect.unreachable('a missing library root must not read successfully')
    } catch (e) {
      expect(e).toBeInstanceOf(TripleSourceError)
      const error = e as TripleSourceError
      expect(error.code).toBe('unavailable')
      expect(error.status).toBe(503)
      expect(error.detail).toContain('instrument.json')
    }
    await source.close()
    await new Promise<void>((done) => broken.close(() => done()))
  })

  it('EMPTY is a successful read, not an error', async () => {
    // A real HTTP endpoint that legitimately holds nothing.
    const empty = createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/n-triples')
      res.end('')
    })
    await new Promise<void>((done) => empty.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`
    const source = ntHttpSource({ graphs: { 'urn:aigua:graph:empty': `${origin}/g.nt` } })
    const read = await source.read('urn:aigua:graph:empty')
    expect(read.tripleCount).toBe(0)
    await source.close()
    await new Promise<void>((done) => empty.close(() => done()))
  })

  it('serves the layout as sux: RDF that nucleus parses and planFor interprets', async () => {
    const source = ntHttpSource({ graphs: graphsFor(base), endpoint: base })
    const read = await source.read(UX_GRAPH)
    const config = parseTriplesToConfig(triplesOf(read))

    expect(config.id).toBe('Aviary')
    // The appearance controls are graph-authored, not hardcoded in the bar.
    expect(config.dimensions['dim-skin'].values.map((v) => v.literalValue)).toContain('emporium')
    expect(config.dimensions['dim-theme'].values.map((v) => v.literalValue)).toEqual(['light', 'dark'])

    const plan = planFor(config)
    // I1: exactly one resizable root, and it is the stage.
    expect(plan.spineHeadId).toBe('region-stage')
    expect(plan.topChrome).toEqual(['region-top-bar', 'region-rail'])
    expect(plan.bottomChrome).toEqual(['region-bottom-bar'])
    // A single-leaf spine — no sl-split-panel, so no Shoelace dependency.
    expect(plan.spine.kind).toBe('leaf')
    await source.close()
  })

  it('serves real audio bytes with Range support, and refuses to escape the root', async () => {
    const head = await fetch(`${base}/media/samples/buzz_01.wav`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('audio/wav')
    expect(head.headers.get('accept-ranges')).toBe('bytes')

    const ranged = await fetch(`${base}/media/samples/buzz_01.wav`, { headers: { Range: 'bytes=0-99' } })
    expect(ranged.status).toBe(206)
    expect((await ranged.arrayBuffer()).byteLength).toBe(100)

    const escaped = await fetch(`${base}/media/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
    expect(escaped.status).toBe(403)

    const notMedia = await fetch(`${base}/media/instrument.json`)
    expect(notMedia.status).toBe(415)
  })
})
