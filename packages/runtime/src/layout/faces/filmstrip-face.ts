/**
 * `obs.filmstrip` — a graph-indexed, privately-resolved evidence face.
 *
 * The query result contains only Observatory `test.beat` coordinates. Fat
 * browser evidence stays private and is fetched through a host-supplied
 * EvidenceService after the gateway has checked graph ACL + run ownership.
 * Object URLs are view-local and revoked on dispose; neither Cognito tokens
 * nor S3 credentials enter layout data or image URLs.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { QueryBlockResult, QueryBlockRow, QueryBlockService } from '../../editor-services/query-block-service.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { isQueryLocator } from './query-handle-resource-adapter.js'

export const FILMSTRIP_FACE_ID = 'obs.filmstrip'
export const FILMSTRIP_ADAPTER_ID = 'obs.filmstrip.evidence-query'

const SHA256 = /^[a-f0-9]{64}$/
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const S3_URI = /^s3:\/\/[a-z0-9][a-z0-9.-]{2,62}\/[A-Za-z0-9._/@%+=,:~-]{1,1024}$/
const SERVICE_MAX_ROWS = 24
const MANIFEST_MAX_BYTES = 1024 * 1024

export interface FilmstripEvidenceRef {
  readonly uri: string
  readonly sha256: string
  readonly bytes?: number
  readonly mediaType?: string
}

export interface FilmstripEvidenceService {
  read(graphId: string, runId: string, ref: FilmstripEvidenceRef): Promise<Blob>
}

export interface FilmstripCoordinate {
  readonly capturedAt: string
  readonly graphId: string
  readonly runId: string
  readonly scenarioId: string
  readonly beatId: string
  readonly engine: 'chromium' | 'camoufox'
  readonly operation: string
  readonly manifest: FilmstripEvidenceRef
}

export type FilmstripFrame = FilmstripCoordinate &
  ({ readonly status: 'ready'; readonly screenshot: Blob } | { readonly status: 'error'; readonly error: string })

export interface FilmstripResource {
  readonly frames: readonly FilmstripFrame[]
}

function filmstripResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isQueryLocator(locator)) throw new Error('obs.filmstrip requires a query resource')
  return resourceKeyTuple('obs-filmstrip', locator.graphId, locator.queryId, locator.revision)
}

/** Parse only the bounded, content-free testimony schema emitted by Choreograph. */
export function parseFilmstripCoordinates(result: QueryBlockResult): readonly FilmstripCoordinate[] {
  if (result.resultKind !== 'bindings') {
    throw new Error(`obs.filmstrip only renders SELECT results (got ${result.resultKind})`)
  }
  const coordinates: FilmstripCoordinate[] = []
  for (const row of result.rows.slice(0, SERVICE_MAX_ROWS)) {
    const payloadText = term(row, 'payloadJson')
    const capturedAt = term(row, 'capturedAt')
    const graphId = term(row, 'graphId')
    if (!payloadText || !capturedAt || !graphId || !/^obs-hoja-[A-Za-z0-9._-]+$/.test(graphId)) continue
    let payload: unknown
    try {
      payload = JSON.parse(payloadText)
    } catch {
      continue
    }
    const record = asRecord(payload)
    // Garden stores the canonical CaptureEvent wire payload, whose contract
    // keys are snake_case. Camel aliases are rolling-deploy compatibility for
    // pre-materialized local fixtures only.
    const runId = opaque(record?.run_id ?? record?.runId)
    const scenarioId = opaque(record?.scenario_id ?? record?.scenarioId)
    const beatId = opaque(record?.beat_id ?? record?.beatId)
    const engine = record?.engine === 'chromium' || record?.engine === 'camoufox' ? record.engine : undefined
    const operation = opaque(record?.operation)
    const manifest = thinRef(
      record?.evidence_uri ?? record?.evidenceUri,
      record?.evidence_sha256 ?? record?.evidenceSha256,
    )
    if (!runId || !scenarioId || !beatId || !engine || !operation || !manifest) continue
    coordinates.push({ capturedAt, graphId, runId, scenarioId, beatId, engine, operation, manifest })
  }
  return coordinates
}

export function createFilmstripResourceAdapter(
  queries: QueryBlockService,
  resolver: QueryTextResolver,
  evidence: FilmstripEvidenceService,
): DerivedResourceAdapter<FilmstripResource> {
  return {
    adapterId: FILMSTRIP_ADAPTER_ID,
    shape: 'derived',
    accepts: isQueryLocator,
    resourceKey: filmstripResourceKey,
    async compute(locator) {
      if (!isQueryLocator(locator)) throw new Error('unreachable: filmstrip locator was already validated')
      const result = await queries.run(locator.graphId, resolver.resolve(locator), SERVICE_MAX_ROWS)
      const coordinates = parseFilmstripCoordinates(result)
      const frames = await Promise.all(coordinates.map(coordinate => resolveFrame(evidence, coordinate.graphId, coordinate)))
      return Object.freeze({ frames: Object.freeze(frames) })
    },
  }
}

async function resolveFrame(
  evidence: FilmstripEvidenceService,
  graphId: string,
  coordinate: FilmstripCoordinate,
): Promise<FilmstripFrame> {
  try {
    const manifestBlob = await evidence.read(graphId, coordinate.runId, coordinate.manifest)
    if (manifestBlob.size > MANIFEST_MAX_BYTES) throw new Error('manifest exceeds 1 MiB')
    const manifest = asRecord(JSON.parse(await manifestBlob.text()))
    if (
      manifest?.schema !== 'sophia.browser-evidence-beat.v1'
      || manifest.runId !== coordinate.runId
      || manifest.scenarioId !== coordinate.scenarioId
      || manifest.beatId !== coordinate.beatId
      || manifest.engine !== coordinate.engine
    ) {
      throw new Error('manifest identity does not match testimony')
    }
    const screenshot = fullRef(asRecord(manifest.evidence)?.screenshot)
    if (screenshot?.mediaType !== 'image/png') throw new Error('manifest has no valid PNG screenshot ref')
    const screenshotBlob = await evidence.read(graphId, coordinate.runId, screenshot)
    return { ...coordinate, status: 'ready', screenshot: screenshotBlob }
  } catch (error) {
    return {
      ...coordinate,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function term(row: QueryBlockRow, name: string): string | undefined {
  const value = row[name]?.value
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function opaque(value: unknown): string | undefined {
  return typeof value === 'string' && OPAQUE_ID.test(value) ? value : undefined
}

function thinRef(uri: unknown, sha256: unknown): FilmstripEvidenceRef | undefined {
  if (typeof uri !== 'string' || !S3_URI.test(uri)) return undefined
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return undefined
  return { uri, sha256 }
}

function fullRef(value: unknown): FilmstripEvidenceRef | undefined {
  const record = asRecord(value)
  const thin = thinRef(record?.uri, record?.sha256)
  if (!thin || !Number.isSafeInteger(record?.bytes) || (record?.bytes as number) < 0) return undefined
  if (typeof record?.mediaType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(record.mediaType)) return undefined
  return { ...thin, bytes: record.bytes as number, mediaType: record.mediaType }
}

function filmstripConstraints(): LeafConstraints {
  return { minWidth: 320, minHeight: 180, overflow: 'clip' }
}

export function createFilmstripFace(): FaceRegistration {
  return {
    faceId: FILMSTRIP_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: FILMSTRIP_ADAPTER_ID,
    accepts: isQueryLocator,
    paramsSchema: closedParamsSchema({ title: { type: 'string', optional: true } }),
    constraints: filmstripConstraints,
    mount({ target, descriptor, lease }) {
      const resource = lease.value as FilmstripResource
      const title = typeof descriptor.params?.title === 'string' ? descriptor.params.title : 'Recent Hoja evidence'
      const urls: string[] = []
      const stage = document.createElement('section')
      stage.dataset.obsFilmstrip = 'true'
      stage.setAttribute('aria-label', title)
      stage.style.cssText = 'box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:12px;background:var(--mn-surface-1,#111);color:var(--mn-text,#eee)'
      const heading = document.createElement('h3')
      heading.textContent = title
      heading.style.cssText = 'margin:0 0 10px;font:600 14px/1.3 system-ui'
      stage.append(heading)
      const strip = document.createElement('div')
      strip.style.cssText = 'display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,34%);gap:12px;overflow-x:auto;padding-bottom:6px'
      if (resource.frames.length === 0) {
        const empty = document.createElement('p')
        empty.textContent = 'No evidenced Hoja beats are present in the raw retention window.'
        strip.append(empty)
      }
      for (const frame of resource.frames) {
        strip.append(renderFrame(frame, urls))
      }
      stage.append(strip)
      target.replaceChildren(stage)
      let disposed = false
      const view: FaceView = {
        focus() {
          stage.tabIndex = 0
          stage.focus()
          return true
        },
        blur() {
          stage.blur()
        },
        resize() {},
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          for (const url of urls) URL.revokeObjectURL(url)
          stage.remove()
        },
      }
      return view
    },
  }
}

function renderFrame(frame: FilmstripFrame, urls: string[]): HTMLElement {
  const figure = document.createElement('figure')
  figure.style.cssText = 'margin:0;border:1px solid var(--mn-border,#333);border-radius:8px;overflow:hidden;background:var(--mn-surface-2,#181818)'
  if (frame.status === 'ready') {
    const url = URL.createObjectURL(frame.screenshot)
    urls.push(url)
    const image = document.createElement('img')
    image.src = url
    image.alt = `${frame.operation} beat ${frame.beatId} in ${frame.engine}`
    image.loading = 'lazy'
    image.style.cssText = 'display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#000'
    figure.append(image)
  } else {
    const error = document.createElement('div')
    error.textContent = `Evidence unavailable: ${frame.error}`
    error.style.cssText = 'box-sizing:border-box;min-height:140px;padding:16px;color:var(--mn-danger,#f88)'
    figure.append(error)
  }
  const caption = document.createElement('figcaption')
  caption.textContent = `${frame.engine} · ${frame.operation} · ${frame.beatId} · ${frame.capturedAt}`
  caption.style.cssText = 'padding:8px;font:12px/1.4 system-ui;overflow-wrap:anywhere'
  figure.append(caption)
  return figure
}
