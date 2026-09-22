/**
 * media-face-internal.ts — F6 quarantine (repair round 3, faces-mvp review
 * finding F6): `media.viewer`'s face + element, reachable ONLY via this
 * explicitly-internal module path — never from the ratified
 * `@shrubbery/runtime/layout` public barrel (`layout/index.ts` re-exporting
 * `faces/index.ts`).
 *
 * `media.viewer` is real, tested, and NOT deleted —
 * `plans/shrubbery-surface-north-star-20260716.md` §2.1 names it the Wave-2
 * STATIC-resource-shape template ("STATIC (3): artifact view, artifact
 * editor (sub-mode), original-file view. ← the MVP's media face is the
 * template."). It is simply not part of the ratified v1 P2 catalog (design
 * §9.2 Phase 2's "exactly hoja.document, sparql.bindings-table, sophia.home")
 * — a casual consumer of `@shrubbery/runtime/layout` must not reach it by
 * accident.
 *
 * The ONLY registered consumer is `apps/organism/src/harness/layout-
 * workbench-main.ts` (the workbench harness), which imports this exact
 * subpath deliberately (see its own registration comment). Promoting
 * `media.viewer` to the production catalog requires either an explicit
 * authority revision from Vera, or extracting/sharing the production
 * `mn-original-viewer` artifact viewer in its place — see `media-face.ts`'s
 * own header for the cross-package restructuring that would take.
 */
export {
  MEDIA_VIEWER_FACE_ID,
  artifactIri,
  parseArtifactIri,
  createMediaFace,
  createMediaResourceAdapter,
  type ArtifactRef,
  type ArtifactFetcher,
  type ArtifactFetchResult,
  type BlobUrlApi,
  type MediaBlobResource,
} from './media-face.js'
export { ShMediaView, inferMediaViewKind, type MediaViewKind, type MediaViewStatus } from './media-view-element.js'
