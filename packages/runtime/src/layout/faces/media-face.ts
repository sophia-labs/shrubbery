/**
 * media-face.ts — the `media.viewer` face (Builder-2 task brief guard rail 2:
 * "a GENUINELY-DIFFERENT top-level pane — an image/PDF/blob viewer over a
 * durable blob resource, with NO CRDT, NO provider, NO editor machinery, NO
 * toolbar").
 *
 * Resource shape: `durable` (guard rail 1) — a stable artifact identity
 * (`graphId` + `artifactId`), ref-counted by the broker across every leaf
 * that leases it, resolved ONCE per key into a real fetched `Blob` + object
 * URL, disposed (URL revoked) on last release. There is no live shared-
 * document room and no provider handle anywhere in this file or in
 * `media-view-element.ts` — that absence is what proves the broker's
 * `ResourceBroker`/`FaceRegistration` contract does not secretly bake in
 * document/CRDT assumptions.
 *
 * The actual byte fetch is behind an injected `ArtifactFetcher` seam (the
 * same shape as the existing `OriginalFileController`'s effects boundary in
 * apps/organism — auth/fetch/object-URL lifetime stay shell-owned; this
 * module only describes WHAT to fetch and HOW to key/dispose it). Tests
 * supply a REAL fetcher (real `fetch`, real bytes, real `Content-Type`) —
 * never a mocked resource.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
// Side-effect import: registers the <sh-media-view> custom element.
import './media-view-element.js'
import type { ShMediaView } from './media-view-element.js'
import { noFaceParams, type DurableResourceAdapter, type FaceRegistration, type FaceView, type LeafConstraints, type ResourceKey } from '../types.js'

export const MEDIA_VIEWER_FACE_ID = 'media.viewer'

/** Canonical, content-free locator scheme for a durable blob/artifact resource. */
const ARTIFACT_IRI_PREFIX = 'urn:sophia:artifact:'

export interface ArtifactRef {
  readonly graphId: string
  readonly artifactId: string
}

/**
 * Build the canonical `iri` locator value for an artifact — content-free (no
 * token, no URL). Each segment is `encodeURIComponent`-escaped BEFORE
 * joining with `:` (diff-review r2 WRONG: naive colon-joining is not
 * canonical — Phase 1 permits arbitrary non-empty identifiers, including
 * colons, so an unescaped join of `(graphId:'a:b', artifactId:'c')` and
 * `(graphId:'a', artifactId:'b:c')` would both produce the same iri).
 * `encodeURIComponent` escapes every literal `:` (`%3A`), so the single `:`
 * `parseArtifactIri` finds when splitting `rest` is always the real
 * separator, never one smuggled in from either segment's own content.
 */
export function artifactIri(ref: ArtifactRef): string {
  return `${ARTIFACT_IRI_PREFIX}${encodeURIComponent(ref.graphId)}:${encodeURIComponent(ref.artifactId)}`
}

/** Parse an artifact iri back into its ref, or `null` if it is not one of ours. */
export function parseArtifactIri(iri: string): ArtifactRef | null {
  if (!iri.startsWith(ARTIFACT_IRI_PREFIX)) return null
  const rest = iri.slice(ARTIFACT_IRI_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0 || sep === rest.length - 1) return null
  try {
    return { graphId: decodeURIComponent(rest.slice(0, sep)), artifactId: decodeURIComponent(rest.slice(sep + 1)) }
  } catch {
    return null // malformed percent-encoding — not one of ours, not a crash
  }
}

export interface ArtifactFetchResult {
  readonly blob: Blob
  readonly filename: string
  readonly mimeType: string
}

/** The shell-owned effects seam — auth/fetch stay outside this module (mirrors
 * apps/organism's `OriginalFileController` acquisition boundary). */
export interface ArtifactFetcher {
  fetchArtifact(ref: ArtifactRef): Promise<ArtifactFetchResult>
}

export interface BlobUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

function defaultUrlApi(): BlobUrlApi {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  }
}

/** True for the kinds `media-view-element.ts` renders as text (keep in sync with `inferMediaViewKind`). */
function looksLikeText(mimeType: string, filename: string): boolean {
  const mime = mimeType.toLowerCase()
  const ext = filename.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase() ?? ''
  return mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml', 'log'].includes(ext)
}

export interface MediaBlobResource {
  readonly objectUrl: string
  readonly filename: string
  readonly mimeType: string
  /** Populated only for text-shaped blobs (best-effort; empty otherwise). */
  readonly text: string
  readonly graphId: string
  readonly artifactId: string
}

function artifactResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'iri') throw new Error(`media.viewer: resource adapter given a non-iri locator (kind '${locator.kind}')`)
  const ref = parseArtifactIri(locator.iri)
  if (!ref) throw new Error(`media.viewer: '${locator.iri}' is not an artifact iri`)
  return locator.iri // already canonical and stable
}

/**
 * The durable-resource half: fetch once per key, revoke once on last release.
 * `urlApi` defaults to the real `URL.createObjectURL`/`revokeObjectURL`; tests
 * may inject a tracking double to assert revocation without touching global
 * state, but the FETCH itself is always real (no `blob:` stub is faked here).
 */
export function createMediaResourceAdapter(
  fetcher: ArtifactFetcher,
  urlApi: BlobUrlApi = defaultUrlApi(),
): DurableResourceAdapter<MediaBlobResource> {
  return {
    adapterId: 'media.viewer.artifact-fetch',
    shape: 'durable',
    accepts: (locator) => locator.kind === 'iri' && parseArtifactIri(locator.iri) !== null,
    resourceKey: artifactResourceKey,
    async load(locator) {
      if (locator.kind !== 'iri') throw new Error('unreachable: resourceKey already validated the kind')
      const ref = parseArtifactIri(locator.iri)
      if (!ref) throw new Error('unreachable: resourceKey already validated the iri shape')
      const { blob, filename, mimeType } = await fetcher.fetchArtifact(ref)
      const objectUrl = urlApi.createObjectURL(blob)
      const text = looksLikeText(mimeType, filename) ? await blob.text() : ''
      return { objectUrl, filename, mimeType, text, graphId: ref.graphId, artifactId: ref.artifactId }
    },
    dispose(value) {
      urlApi.revokeObjectURL(value.objectUrl)
    },
  }
}

function mediaViewerConstraints(): LeafConstraints {
  // <sh-media-view> owns its own internal overflow:auto stage — 'clip' avoids
  // a redundant outer scrollbar on top of the element's own.
  return { minWidth: 120, minHeight: 120, overflow: 'clip' }
}

/**
 * The `media.viewer` `FaceRegistration`. `mount()` creates ONE fresh
 * `<sh-media-view>` — a plain content pane, no CRDT/provider/toolbar — and
 * feeds it the already-fetched blob's plain properties.
 */
export function createMediaFace(): FaceRegistration {
  return {
    faceId: MEDIA_VIEWER_FACE_ID,
    // No caret/selection/undo-lease state — a fresh mount over the same
    // (broker-cached) blob is indistinguishable from the view that was there
    // before, so there is nothing worth protecting across a relocate.
    persistence: 'stamp',
    // Binds this face to the EXACT registered adapter it expects (diff-review
    // r2 WRONG: "the broker silently selects the first adapter whose
    // accepts() returns true") — see createMediaResourceAdapter's own
    // `adapterId` above.
    resourceAdapterId: 'media.viewer.artifact-fetch',
    accepts: (locator) => locator.kind === 'iri' && parseArtifactIri(locator.iri) !== null,
    paramsSchema: noFaceParams,
    constraints: mediaViewerConstraints,
    mount(context) {
      const { target, descriptor, lease } = context
      const value = lease.value as MediaBlobResource

      const view = document.createElement('sh-media-view') as ShMediaView
      view.src = value.objectUrl
      view.mimeType = value.mimeType
      view.filename = value.filename
      view.text = value.text
      view.status = 'ready'
      view.tabIndex = 0

      target.replaceChildren(view)

      let disposed = false
      const faceView: FaceView = {
        focus(_request) {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // <sh-media-view>'s :host fills 100%/100% via CSS; the interpreter
          // already sized `target`. MUST NOT write layout state — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          view.remove()
        },
      }
      return faceView
    },
  }
}
