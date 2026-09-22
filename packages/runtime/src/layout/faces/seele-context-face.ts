/**
 * seele-context-face.ts — the `seele.context` face and its resource adapter
 * (W8.1, the v1 stub mount).
 *
 * TWO REGISTRATIONS, NOT ONE. `LayoutResourceBroker.acquire()` throws
 * `UnknownResourceAdapterError` for any id that is not registered, so a face
 * naming an unbuilt adapter cannot mount at all (F14). Both halves live here
 * and are registered together by whoever assembles the workbench's registry.
 *
 * THE ADAPTER RETURNS THE HANDLE, NOT A SNAPSHOT. `DerivedResourceAdapter.
 * compute()` runs once per `acquire()` and the broker never re-runs it (C17),
 * so an adapter that resolved to a report OBJECT would produce a pane frozen
 * at mount time. It resolves to `SeeleWorkbenchReportHandle` — a stable
 * subscribable the mounted view re-reads — which is the same shape
 * `GridCollectionQueryHandle.run()` already establishes as the precedent for a
 * caller-re-evaluated resource.
 *
 * WHERE THE CONTROLLER COMES FROM. `packages/runtime` does not construct one:
 * a controller needs the compile route's URL and the identity of the leaf
 * holding the constitution, both of which are the HOST's knowledge (the same
 * reason `settings.page` takes an injected service rather than building one).
 * `createSeeleContextResourceAdapter` therefore takes a resolver
 * `(locator) => handle`, and the app supplies it — see
 * `apps/seele-workbench/src/main.ts`.
 *
 * WHY THIS FACE IS `'stamp'` AND NOT `'persistent-relocatable'`. It holds no
 * caret, no selection, no local editing lease — everything it shows is derived
 * from the handle, so a remount after a DOM relocation reproduces the exact
 * same pane from the exact same snapshot. `hoja.document` next door is
 * relocatable precisely because it does hold that state.
 *
 * NOT PROMOTED into `fragment-face-set.ts` (W6.6, deliberately deferred): a
 * graph-authored layout in the generic `?graph=` app still cannot mount this
 * face, because doing so would widen what EVERY graph-authored layout anywhere
 * may mount — an architectural decision that deserves its own ratification
 * rather than arriving as a side effect of the workbench.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
// Side-effect import: registers the <sh-seele-context-view> custom element.
import './seele-context-view-element.js'
import type { ShSeeleContextView } from './seele-context-view-element.js'
import type { SeeleWorkbenchReportHandle } from '../../seele/workbench-controller.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const SEELE_CONTEXT_FACE_ID = 'seele.context'
export const SEELE_CONTEXT_ADAPTER_ID = 'seele.context.compile'

/** The face's closed params (W8.1). `compileRouteId` is reserved for a host that mounts more than one route. */
const seeleContextParamsSchema = closedParamsSchema({
  contractName: { type: 'string' },
  compileRouteId: { type: 'string', optional: true },
})

function seeleContextResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'document') {
    throw new Error(`seele.context: resource adapter given a non-document locator (kind '${locator.kind}')`)
  }
  // Collision-safe tagged tuple, not a naive slash-join — see resource-key.ts.
  return resourceKeyTuple('document', locator.graphId, locator.documentId)
}

/** Resolves the workbench controller's handle for one constitution document. Host-supplied. */
export type SeeleWorkbenchHandleResolver = (
  locator: Extract<ResourceLocator, { kind: 'document' }>,
) => SeeleWorkbenchReportHandle

/**
 * The `seele.context.compile` adapter. `derived`, un-retained: the handle it
 * resolves to is owned by the host's controller, so there is nothing for the
 * broker to keep warm — the ref-counting that matters is the handle's own.
 */
export function createSeeleContextResourceAdapter(
  resolveHandle: SeeleWorkbenchHandleResolver,
): DerivedResourceAdapter<SeeleWorkbenchReportHandle> {
  return {
    adapterId: SEELE_CONTEXT_ADAPTER_ID,
    shape: 'derived',
    accepts: locator => locator.kind === 'document',
    resourceKey: seeleContextResourceKey,
    async compute(locator) {
      if (locator.kind !== 'document') throw new Error('unreachable: resourceKey already validated the kind')
      const handle = resolveHandle(locator)
      handle.retain()
      return handle
    },
    dispose(handle) {
      handle.release()
    },
  }
}

function seeleContextConstraints(): LeafConstraints {
  return { minWidth: 260, minHeight: 160, overflow: 'clip' }
}

/**
 * The `seele.context` `FaceRegistration`. `mount()` creates ONE fresh
 * `<sh-seele-context-view>` per leaf, seeds it with the handle's CURRENT
 * snapshot (so a pane mounted after a compile has already settled is populated
 * on its first frame rather than blank until the next edit), and follows the
 * handle from there.
 */
export function createSeeleContextFace(): FaceRegistration {
  return {
    faceId: SEELE_CONTEXT_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: SEELE_CONTEXT_ADAPTER_ID,
    accepts: locator => locator.kind === 'document',
    paramsSchema: seeleContextParamsSchema,
    constraints: seeleContextConstraints,
    mount(context) {
      const { target, descriptor, lease } = context
      if (descriptor.resource.kind !== 'document') {
        throw new Error(`seele.context: unexpected resource kind '${descriptor.resource.kind}'`)
      }
      const handle = lease.value as SeeleWorkbenchReportHandle
      const contractName = typeof descriptor.params?.contractName === 'string' ? descriptor.params.contractName : ''

      const view = document.createElement('sh-seele-context-view') as ShSeeleContextView
      view.tabIndex = 0
      view.contractName = contractName
      view.snapshot = handle.current()
      target.replaceChildren(view)

      const unsubscribe = handle.subscribe(snapshot => {
        view.snapshot = snapshot
      })

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
          // The element fills its wrapper via CSS (`:host { width/height: 100% }`).
        },
        serialize(): ViewDescriptor {
          // Nothing drifts locally in v1 — the mount-time descriptor IS the
          // current durable intent.
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          view.remove()
        },
      }
      return faceView
    },
  }
}
