/**
 * media-face.test.ts — the `media.viewer` face against a REAL HTTP server
 * serving real bytes with real headers (a real PNG, a real text file, a
 * real-shaped PDF stub) — no `vi.mock`, no faked Response/Blob. Proves:
 *
 *   - the durable resource shape (guard rail 1): one real fetch per
 *     resourceKey, shared across every leaf referencing the same artifact,
 *     released exactly once on last release;
 *   - guard rail 2, concretely: the mounted element is NOT `sh-editor-host`,
 *     has no ProseMirror/contenteditable node and no `<button>` (no toolbar)
 *     anywhere in its shadow root, and the face/adapter/view source carries
 *     no CRDT/provider token.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  deepFreeze,
  type LayoutDocument,
} from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import {
  artifactIri,
  createMediaFace,
  createMediaResourceAdapter,
  MEDIA_VIEWER_FACE_ID,
  parseArtifactIri,
  type ArtifactFetchResult,
  type ArtifactFetcher,
  type ArtifactRef,
  type BlobUrlApi,
} from '../media-face.js'

// A real, valid 1x1 transparent PNG (not a stub — genuine PNG magic bytes + IHDR/IDAT/IEND).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const TEXT_BODY = 'hello from a real text artifact\nsecond line\n'
const PDF_BODY = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

const GRAPH_ID = 'g1'

let server: Server
let baseUrl: string

function routeFor(artifactId: string): { body: Buffer; contentType: string; filename: string } | null {
  if (artifactId === 'img-1') return { body: PNG_1X1, contentType: 'image/png', filename: 'cat.png' }
  if (artifactId === 'txt-1') return { body: Buffer.from(TEXT_BODY, 'utf8'), contentType: 'text/plain', filename: 'notes.txt' }
  if (artifactId === 'pdf-1') return { body: Buffer.from(PDF_BODY, 'utf8'), contentType: 'application/pdf', filename: 'report.pdf' }
  return null
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const artifactId = (req.url ?? '').replace(/^\/+/, '')
    const route = routeFor(artifactId)
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (!route) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('Content-Type', route.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${route.filename}"`)
    res.end(route.body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function filenameFromDisposition(value: string | null): string {
  const match = value ? /filename="?([^"]+)"?/.exec(value) : null
  return match?.[1] ?? ''
}

/** A REAL fetcher — hits the real server above with real `fetch`, no stubbing of Response/Blob. */
function realFetcher(): ArtifactFetcher & { readonly calls: ArtifactRef[] } {
  const calls: ArtifactRef[] = []
  return {
    calls,
    async fetchArtifact(ref: ArtifactRef): Promise<ArtifactFetchResult> {
      calls.push(ref)
      const res = await fetch(`${baseUrl}/${ref.artifactId}`)
      if (!res.ok) throw new Error(`fetch ${ref.artifactId}: HTTP ${res.status}`)
      const blob = await res.blob()
      return {
        blob,
        filename: filenameFromDisposition(res.headers.get('content-disposition')) || ref.artifactId,
        mimeType: res.headers.get('content-type') ?? blob.type,
      }
    },
  }
}

/** The REAL object-URL API, instrumented with counters — never a faked blob: URL. */
function countingUrlApi(): BlobUrlApi & { created: string[]; revoked: string[] } {
  const created: string[] = []
  const revoked: string[] = []
  return {
    created,
    revoked,
    createObjectURL: (blob) => {
      const url = URL.createObjectURL(blob)
      created.push(url)
      return url
    },
    revokeObjectURL: (url) => {
      revoked.push(url)
      URL.revokeObjectURL(url)
    },
  }
}

function mediaDoc(ref: ArtifactRef, leafId = 'a'): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'media-only',
    scope: 'session',
    graphId: null,
    rootNodeId: leafId,
    nodes: {
      [leafId]: {
        kind: 'leaf',
        id: leafId,
        descriptor: { schemaVersion: 1, faceId: MEDIA_VIEWER_FACE_ID, resource: { kind: 'iri', iri: artifactIri(ref) } },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('artifact iri codec', () => {
  it('round-trips graphId/artifactId through the canonical iri', () => {
    const ref: ArtifactRef = { graphId: 'g1', artifactId: 'img-1' }
    expect(parseArtifactIri(artifactIri(ref))).toEqual(ref)
  })

  it('rejects a non-artifact iri', () => {
    expect(parseArtifactIri('urn:sophia:home')).toBeNull()
    expect(parseArtifactIri('urn:sophia:artifact:onlygraph')).toBeNull()
  })

  // diff-review r2 WRONG "one shared ProviderHandle per document key" — the
  // same collision class applies to artifactIri's own graphId:artifactId
  // join: a naive join would let (graphId:'a:b', artifactId:'c') and
  // (graphId:'a', artifactId:'b:c') collide into ONE iri, silently sharing a
  // broker durable entry (and hence a fetched blob) between distinct
  // artifacts.
  it('is collision-safe for delimiter-bearing graphId/artifactId AND round-trips them exactly', () => {
    const refAB_C: ArtifactRef = { graphId: 'a:b', artifactId: 'c' }
    const refA_BC: ArtifactRef = { graphId: 'a', artifactId: 'b:c' }
    const iriAB_C = artifactIri(refAB_C)
    const iriA_BC = artifactIri(refA_BC)
    expect(iriAB_C).not.toBe(iriA_BC)
    expect(parseArtifactIri(iriAB_C)).toEqual(refAB_C)
    expect(parseArtifactIri(iriA_BC)).toEqual(refA_BC)
  })
})

describe('media.viewer — real fetch, real image bytes, real mount', () => {
  it('mounts <sh-media-view> (never <sh-editor-host>) with the fetched blob URL + mime type', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const ref: ArtifactRef = { graphId: GRAPH_ID, artifactId: 'img-1' }
    const result = await interpreter.reconcile(mediaDoc(ref), { width: 400, height: 300 })
    expect(result.ok).toBe(true)
    expect(fetcher.calls).toEqual([ref])

    const wrapper = interpreter.leafWrapperElement('a')!
    const view = wrapper.querySelector('sh-media-view')
    expect(view).not.toBeNull()
    expect(wrapper.querySelector('sh-editor-host')).toBeNull()

    const mediaView = view as HTMLElement & { src: string; mimeType: string; filename: string; status: string }
    expect(mediaView.mimeType).toBe('image/png')
    expect(mediaView.filename).toBe('cat.png')
    expect(mediaView.src.startsWith('blob:')).toBe(true)
    expect(mediaView.status).toBe('ready')

    await interpreter.dispose()
  })

  it('renders a real <img> inside the shadow root for an image artifact', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(mediaDoc({ graphId: GRAPH_ID, artifactId: 'img-1' }), { width: 400, height: 300 })
    const view = interpreter.leafWrapperElement('a')!.querySelector('sh-media-view') as HTMLElement
    // Force Lit's async render to flush.
    await (view as unknown as { updateComplete: Promise<boolean> }).updateComplete

    const img = view.shadowRoot!.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')!.startsWith('blob:')).toBe(true)

    await interpreter.dispose()
  })

  it('renders real fetched text content for a text/plain artifact', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(mediaDoc({ graphId: GRAPH_ID, artifactId: 'txt-1' }), { width: 400, height: 300 })
    const view = interpreter.leafWrapperElement('a')!.querySelector('sh-media-view') as HTMLElement
    await (view as unknown as { updateComplete: Promise<boolean> }).updateComplete

    const pre = view.shadowRoot!.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toBe(TEXT_BODY)

    await interpreter.dispose()
  })

  // happy-dom actually attempts to NAVIGATE a connected <iframe src>, and its
  // fetch implementation does not support the blob: scheme — this logs a
  // harmless async DOMException to the console (it does not fail the test;
  // real `blob:` iframe navigation is real-browser territory, same class of
  // gap editor-host.ts's own "HONEST CAVEAT" comment documents for happy-dom).
  it('renders an iframe for a PDF artifact', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(mediaDoc({ graphId: GRAPH_ID, artifactId: 'pdf-1' }), { width: 400, height: 300 })
    const view = interpreter.leafWrapperElement('a')!.querySelector('sh-media-view') as HTMLElement
    await (view as unknown as { updateComplete: Promise<boolean> }).updateComplete

    const iframe = view.shadowRoot!.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('src')!.startsWith('blob:')).toBe(true)

    await interpreter.dispose()
  })
})

describe('media.viewer — durable resource sharing + teardown (guard rail 1)', () => {
  it('two leaves referencing the same artifact fetch exactly once and share the exact object URL', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const ref: ArtifactRef = { graphId: GRAPH_ID, artifactId: 'img-1' }
    const doc: LayoutDocument = deepFreeze({
      schemaVersion: 1,
      layoutId: 'two-media',
      scope: 'session',
      graphId: null,
      rootNodeId: 'split',
      nodes: {
        split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'a', endNodeId: 'b', startBasisPoints: 5000 },
        a: {
          kind: 'leaf',
          id: 'a',
          descriptor: { schemaVersion: 1, faceId: MEDIA_VIEWER_FACE_ID, resource: { kind: 'iri', iri: artifactIri(ref) } },
          descriptorRevision: 0,
        },
        b: {
          kind: 'leaf',
          id: 'b',
          descriptor: { schemaVersion: 1, faceId: MEDIA_VIEWER_FACE_ID, resource: { kind: 'iri', iri: artifactIri(ref) } },
          descriptorRevision: 0,
        },
      },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    })

    const result = await interpreter.reconcile(doc, { width: 800, height: 300 })
    expect(result.ok).toBe(true)
    // ONE real fetch, even though two leaves reference the same artifact.
    expect(fetcher.calls).toHaveLength(1)

    const viewA = interpreter.leafWrapperElement('a')!.querySelector('sh-media-view') as HTMLElement & { src: string }
    const viewB = interpreter.leafWrapperElement('b')!.querySelector('sh-media-view') as HTMLElement & { src: string }
    expect(viewA.src).toBe(viewB.src) // the exact same object URL

    await interpreter.dispose()
  })

  it('revokes the object URL exactly once, only after the LAST release', async () => {
    const fetcher = realFetcher()
    const urlApi = countingUrlApi()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, urlApi))
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const ref: ArtifactRef = { graphId: GRAPH_ID, artifactId: 'img-1' }

    await interpreter.reconcile(mediaDoc(ref), { width: 400, height: 300 })
    expect(urlApi.created).toHaveLength(1)
    expect(urlApi.revoked).toHaveLength(0)

    await interpreter.dispose()
    await broker.settled()
    expect(urlApi.revoked).toEqual(urlApi.created)
  })
})

describe('media.viewer — guard rail 2: genuinely no CRDT/provider/toolbar', () => {
  it('the mounted shadow root has no contenteditable/ProseMirror node and no <button> (no toolbar)', async () => {
    const fetcher = realFetcher()
    const registry = new FaceRegistry()
    registry.register(createMediaFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createMediaResourceAdapter(fetcher, countingUrlApi()))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(mediaDoc({ graphId: GRAPH_ID, artifactId: 'img-1' }), { width: 400, height: 300 })
    const view = interpreter.leafWrapperElement('a')!.querySelector('sh-media-view') as HTMLElement
    await (view as unknown as { updateComplete: Promise<boolean> }).updateComplete

    expect(view.shadowRoot!.querySelector('[contenteditable]')).toBeNull()
    expect(view.shadowRoot!.querySelector('.ProseMirror')).toBeNull()
    expect(view.shadowRoot!.querySelectorAll('button')).toHaveLength(0)

    await interpreter.dispose()
  })

  it('the face/adapter/view source carries no CRDT/provider token', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const relative of ['../media-face.ts', '../media-view-element.ts']) {
      const src = readFileSync(resolve(here, relative), 'utf8')
      for (const token of ['ProviderHandle', 'CrdtRoom', 'CrdtBackend', 'Y.Doc', 'EditorRoomPool', 'sh-editor-host', 'yjs']) {
        expect(src.includes(token)).toBe(false)
      }
    }
  })
})
