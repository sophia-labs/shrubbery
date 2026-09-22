/**
 * define-guest-face.ts — S1 item 2: `defineGuestFace` turns a
 * framework-neutral `GuestAppModule` (guest-app.ts) into a real, closed
 * `FaceRegistration` (`../types.js`) — the ONE bridge between "a guest app
 * exports `mount(container, ctx)`" and "the face registry can register,
 * seal, validate, and mount it like any other face."
 *
 * FLOW-EF-10 (AMENDED, contracts/shrubbery.md §"Sources"/spec/flow-living-
 * spec-v0.md:103): "Every face declares its source of convergence as one of
 * four closed rungs, enforced at descriptor validation ... acceptance: a
 * face registered without the rung is rejected at boot." The RATIFIED four
 * rungs (spec/flow-courtship-r2-o-garden--o-shrubbery-joint.md §FLOW-GS-1;
 * "locally-derived" over "local-only" per steward-flow-faces' settled §3.5):
 * `room-projected | store-queried | artifact-backed | locally-derived`. The
 * nucleus-level half of EF-10 (a `VIEW_DESCRIPTOR_KEYS` member plus a check
 * at `validate.ts`) is explicitly OUT of this unit's scope (S1's "What" is
 * `packages/runtime/src/layout/hosts/`, new files only) — what S1 owes is
 * the narrower clause the brief itself states: "Unknown or missing
 * `convergence` rung -> throws at definition time ... rejected at boot, not
 * at paint." `defineGuestFace` is that boot-time gate: the check below runs
 * eagerly, in the body of `defineGuestFace` itself, never deferred into
 * `mount()`.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { GuestAppModule, GuestHostContext } from './guest-app.js'
import { validateGuestModule } from './guest-app.js'
import type { GuestCssStrategy } from './sh-guest-island.js'
// Side-effect import: registers the <sh-guest-island> custom element.
import './sh-guest-island.js'
import type { ShGuestIsland } from './sh-guest-island.js'
import type { ClosedFaceParamsSchema, FaceMountContext, FacePersistence, FaceRegistration, FaceView } from '../types.js'

/**
 * The four closed rungs a registered guest face declares as its source of
 * convergence (FLOW-EF-10). `defineGuestFace` treats an unknown or missing
 * value as a boot-time programming error, not a runtime branch a caller is
 * expected to handle — see `DefineGuestFaceOptions.convergence`'s doc.
 */
export const GUEST_CONVERGENCE_RUNGS = ['room-projected', 'store-queried', 'artifact-backed', 'locally-derived'] as const

export type GuestConvergenceRung = (typeof GUEST_CONVERGENCE_RUNGS)[number]

function isGuestConvergenceRung(value: unknown): value is GuestConvergenceRung {
  return typeof value === 'string' && (GUEST_CONVERGENCE_RUNGS as readonly string[]).includes(value)
}

export interface DefineGuestFaceOptions {
  readonly faceId: string
  readonly guest: GuestAppModule
  /** One of `GUEST_CONVERGENCE_RUNGS` (FLOW-EF-10) — an unknown/missing value throws HERE, at definition time, not at first mount. */
  readonly convergence: GuestConvergenceRung
  readonly cssStrategy: GuestCssStrategy
  readonly persistence: FacePersistence
  readonly resourceAdapterId: string
  readonly accepts: (locator: ResourceLocator) => boolean
  readonly paramsSchema: ClosedFaceParamsSchema
}

/**
 * A `FaceView` a caller holding the CONCRETE return value of `defineGuestFace`'s
 * `mount()` can also push a live `GuestHostContext` update through — `update`
 * is not part of the `FaceView` interface the interpreter itself calls (the
 * interpreter only ever calls `focus`/`blur`/`resize`/`serialize`/`dispose`);
 * it forwards to the mounted guest's own optional `GuestMount.update`, a
 * no-op when the guest declared none.
 */
export interface GuestFaceView extends FaceView {
  update(next: Partial<GuestHostContext>): void
}

function baseFromParams(descriptor: ViewDescriptor): string {
  const params = descriptor.params as { readonly base?: unknown } | undefined
  return typeof params?.base === 'string' ? params.base : '/'
}

/**
 * Builds a valid `FaceRegistration` whose `mount(ctx)`:
 *  1. creates a `<sh-guest-island>` host element, configured for this face's
 *     `cssStrategy`/`faceId`/the guest's own `styles`, and swaps it into the
 *     leaf's `target` (`context.target.replaceChildren(island)`);
 *  2. asks the island for the element the guest owns entirely
 *     (`island.mountPoint()`) and builds a `GuestHostContext` around it —
 *     `container` = that element, `base` = the descriptor's own `params.base`
 *     (defaulting to `'/'`), `backend` = the resource lease's value (`ctx`),
 *     `signal` = a fresh `AbortController`'s signal, aborted on dispose;
 *  3. calls `guest.mount(...)`, awaiting it (a guest may mount sync or
 *     async);
 *  4. returns a `FaceView` (as a `GuestFaceView`) whose `dispose(reason)`
 *     aborts the signal, calls the guest's own `unmount()` exactly once, and
 *     removes the island from `target` — and whose bonus `update(next)`
 *     forwards a partial context to the guest's own optional
 *     `GuestMount.update`.
 *
 * The host never paints by SPARQL and never awaits a durable write on the
 * pointer path (FLOW-GS-11/FLOW-SCENE-7) — nothing here does either: `resize`
 * is a no-op (the island fills its container by CSS; the guest measures its
 * own real layout, light DOM), and there is no per-frame work of any kind.
 */
export function defineGuestFace(options: DefineGuestFaceOptions): FaceRegistration {
  if (!isGuestConvergenceRung(options.convergence)) {
    throw new Error(
      `defineGuestFace('${options.faceId}'): convergence must be one of [${GUEST_CONVERGENCE_RUNGS.join(', ')}] ` +
        `(FLOW-EF-10 — a face registered without a valid rung is rejected at boot, not at paint); got ${JSON.stringify(options.convergence)}`,
    )
  }
  if (!validateGuestModule(options.guest)) {
    throw new Error(`defineGuestFace('${options.faceId}'): guest module failed validateGuestModule's runtime shape check`)
  }

  const { faceId, guest, cssStrategy, persistence, resourceAdapterId, accepts, paramsSchema } = options

  return {
    faceId,
    persistence,
    resourceAdapterId,
    accepts,
    paramsSchema,
    async mount(context: FaceMountContext): Promise<GuestFaceView> {
      const island = document.createElement('sh-guest-island') as ShGuestIsland
      island.cssStrategy = cssStrategy
      island.faceId = faceId
      island.guestStyles = guest.styles
      context.target.replaceChildren(island)
      const container = island.mountPoint()

      const abortController = new AbortController()
      let currentContext: GuestHostContext = {
        container,
        base: baseFromParams(context.descriptor),
        backend: context.lease.value,
        signal: abortController.signal,
      }

      const guestMount = await guest.mount(currentContext)
      let disposed = false

      const view: GuestFaceView = {
        focus() {
          return true
        },
        blur() {},
        resize() {
          // no-op — the island fills its container by CSS (100%/100%); the
          // guest measures its own real layout inside its own light-DOM
          // subtree, exactly the Excalidraw precedent.
        },
        serialize() {
          return context.descriptor
        },
        update(next: Partial<GuestHostContext>) {
          if (disposed) return
          currentContext = { ...currentContext, ...next }
          guestMount.update?.(currentContext)
        },
        dispose() {
          if (disposed) return
          disposed = true
          abortController.abort()
          guestMount.unmount()
          island.remove()
        },
      }
      return view
    },
  }
}
