/**
 * sophia-home-face.ts — the `sophia.home` face (Builder-2 task brief item
 * (c)): the honest fallback the interpreter mounts when a leaf's descriptor
 * legitimately resolves to Phase 1's well-known home descriptor.
 *
 * Phase 1 (`@shrubbery/nucleus/layout`) already MINTS the `sophia.home`
 * descriptor — `createSophiaHomeDescriptor()` is what `close_leaf` swaps in
 * when the last leaf in a document closes (LAY-010: "a layout document
 * cannot have zero leaves... v1 uses replacement") — but Phase 1 has no real
 * face registry, so nothing actually RENDERS that descriptor until a P2 face
 * registration exists for it. Without one, `LayoutInterpreter.mountLeaf`
 * would hit `FaceRegistry.validate`'s `unregistered-face` branch and paint
 * `renderErrorLeaf` — a "face unavailable" error box — for what is actually a
 * perfectly legal, EXPECTED document state. That is exactly the wrong/blank
 * pane this module exists to prevent: `sophia.home` must be a REAL registered
 * face + a REAL registered resource adapter for its resource, same as any
 * other face, so LAY-010's replacement leaf renders an honest "nothing is
 * open" pane instead of an error.
 *
 * The resource itself (`SOPHIA_HOME_RESOURCE`, `urn:sophia:home`) is a
 * frozen, content-free, stable IRI Phase 1 already owns — this module's
 * adapter treats it as a trivial `durable` resource (guard rail 1): `load`
 * returns an empty marker value once per key, `dispose` is a no-op. There is
 * nothing to fetch, cache, or tear down; the "resource" exists only so the
 * face contract's acquire/release lifecycle stays uniform across every face,
 * home included.
 */
import {
  SOPHIA_HOME_FACE_ID,
  SOPHIA_HOME_RESOURCE,
  type ResourceLocator,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
// Side-effect import: registers the <sh-home-view> custom element.
import './home-view-element.js'
import type { ShHomeView } from './home-view-element.js'
import { noFaceParams, type DurableResourceAdapter, type FaceRegistration, type FaceView, type LeafConstraints, type ResourceKey } from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export { SOPHIA_HOME_FACE_ID }

// `SOPHIA_HOME_RESOURCE` is typed as the general `ResourceLocator` union (its
// declaration site in nucleus annotates the constant, widening the literal) —
// narrow it ONCE, here, rather than re-narrowing (or unsafely casting) at
// every use below. Throws at import time if nucleus's own invariant ever
// changes shape — an honest failure, not a silent one.
if (SOPHIA_HOME_RESOURCE.kind !== 'iri') {
  throw new Error("sophia.home: SOPHIA_HOME_RESOURCE is not iri-shaped — nucleus's own invariant broke")
}
const HOME_IRI: string = SOPHIA_HOME_RESOURCE.iri

function isHomeResource(locator: ResourceLocator): boolean {
  return locator.kind === 'iri' && locator.iri === HOME_IRI
}

function homeResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isHomeResource(locator)) {
    throw new Error(`sophia.home: resource adapter given an unexpected locator (kind '${locator.kind}')`)
  }
  // The only legal value here is the single frozen `HOME_IRI` constant, so
  // there is no variable-arity collision risk — routed through the shared
  // tuple encoder anyway for consistency with every other face's resourceKey.
  return resourceKeyTuple('iri', HOME_IRI)
}

/** Trivial durable resource — a stable, content-free marker; nothing to fetch or dispose. */
export function createSophiaHomeResourceAdapter(): DurableResourceAdapter<Readonly<Record<string, never>>> {
  return {
    adapterId: 'sophia.home.marker',
    shape: 'durable',
    accepts: isHomeResource,
    resourceKey: homeResourceKey,
    async load() {
      return Object.freeze({})
    },
    dispose() {
      // Nothing owns cleanup — there is no live handle, socket, or blob URL.
    },
  }
}

function sophiaHomeConstraints(): LeafConstraints {
  return { minWidth: 120, minHeight: 80, overflow: 'clip' }
}

/** The `sophia.home` `FaceRegistration` — a plain, honest "nothing open" pane. */
export function createSophiaHomeFace(): FaceRegistration {
  return {
    faceId: SOPHIA_HOME_FACE_ID,
    // A stable, content-free landmark — nothing local worth protecting.
    persistence: 'stamp',
    // Binds this face to the EXACT registered adapter it expects — see
    // createSophiaHomeResourceAdapter's own `adapterId` above (diff-review r2
    // WRONG: "the broker silently selects the first adapter whose accepts()
    // returns true").
    resourceAdapterId: 'sophia.home.marker',
    accepts: isHomeResource,
    paramsSchema: noFaceParams,
    constraints: sophiaHomeConstraints,
    mount(context) {
      const { target, descriptor } = context
      const view = document.createElement('sh-home-view') as ShHomeView
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
          // <sh-home-view>'s :host fills 100%/100% via CSS — no-op.
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
