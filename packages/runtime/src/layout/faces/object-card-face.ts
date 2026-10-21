/**
 * object-card-face.ts — the `object.card` face (typed objects architecture D7 "Layout leaves"): one typed object,
 * placed by a graph-authored layout like any other leaf, drawn by `<sh-object-view>`.
 *
 * Resource locator: `{kind:'graph', graphId, subjectIri}` (the subject is any absolute IRI of a typed resource — a run
 * item, a published object, a being; D6), or `{kind:'iri', iri}` with the closed `graphId` param naming the graph to
 * read. `urn:sophia:object:` URNs stay `card.object`'s (the source register), so this face refuses them.
 *
 * Reads through the `TypedObjectService` seam (`../../object-view/typed-object-service.ts`), which the shell supplies
 * per session (`WorkspaceFragmentsOptions.typedObjectService`). Writes nothing (D-12): the view emits
 * `sh-object-view-intent`, which crosses the leaf's shadow boundary to whatever host listens.
 *
 * Closed params: `slot` (`card` | `pane` | `inline`), `maxFields`, `graphId`.
 */
import type { StoreState } from '@shrubbery/nucleus'
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import { isAbsoluteIri } from '@shrubbery/nucleus/object-faces'
import type { ShObjectView } from '../../object-view/object-view-element.js'
import '../../object-view/object-view-element.js'
import { objectModelOfRead, type TypedObjectRead, type TypedObjectService } from '../../object-view/typed-object-service.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  refreshSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'

export const OBJECT_CARD_FACE_ID = 'object.card'
export const OBJECT_CARD_ADAPTER_ID = 'object.card.typed-object'

export interface ObjectCardParams {
  readonly slot?: 'card' | 'pane' | 'inline'
  readonly maxFields?: number
  readonly graphId?: string
}

/** A graph-parametrized store handle, as `card.subject`'s: a bare-IRI locator learns its graph from the params. */
export interface TypedObjectHandle {
  readonly iri: string
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<TypedObjectRead | null>
  run(graphId: string): Promise<TypedObjectRead | null>
}

function subjectOf(locator: ResourceLocator): { readonly iri: string; readonly graphId: string | null } | null {
  if (locator.kind === 'iri') return { iri: locator.iri, graphId: null }
  if (locator.kind === 'graph' && typeof locator.subjectIri === 'string') return { iri: locator.subjectIri, graphId: locator.graphId }
  return null
}

/** Any absolute IRI except the source register's object URNs (those are `card.object`'s). */
export function isObjectCardLocator(locator: ResourceLocator): boolean {
  const subject = subjectOf(locator)
  return subject !== null && isAbsoluteIri(subject.iri) && !subject.iri.startsWith('urn:sophia:object:')
}

function objectCardResourceKey(locator: ResourceLocator): ResourceKey {
  const subject = subjectOf(locator)
  if (!subject) throw new Error(`object.card: resource adapter given an unexpected locator (kind '${locator.kind}')`)
  return resourceKeyTuple('object-card', subject.graphId ?? undefined, subject.iri)
}

export function createObjectCardResourceAdapter(service: TypedObjectService): DerivedResourceAdapter<TypedObjectHandle> {
  return {
    adapterId: OBJECT_CARD_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isObjectCardLocator,
    resourceKey: objectCardResourceKey,
    async compute(locator, context) {
      const subject = subjectOf(locator)
      if (!subject) throw new Error('object.card: resource adapter given a locator with no subject')
      const stores = new Map<string, SurfaceResourceStore<TypedObjectRead | null>>()
      const store = (graphId: string): SurfaceResourceStore<TypedObjectRead | null> => {
        let existing = stores.get(graphId)
        if (!existing) {
          existing = createSurfaceResourceStore(() => service.read(graphId, subject.iri), context)
          stores.set(graphId, existing)
        }
        return existing
      }
      return { iri: subject.iri, locatorGraphId: subject.graphId, store, run: (graphId) => refreshSurfaceResourceStore(store(graphId)) }
    },
  }
}

function objectCardConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 140, overflow: 'scroll' }
}

export function createObjectCardFace(): FaceRegistration {
  return {
    faceId: OBJECT_CARD_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: OBJECT_CARD_ADAPTER_ID,
    accepts: isObjectCardLocator,
    paramsSchema: closedParamsSchema({
      slot: { type: 'enum', values: ['card', 'pane', 'inline'], optional: true },
      maxFields: { type: 'number', optional: true },
      graphId: { type: 'string', optional: true },
    }),
    constraints: objectCardConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = (descriptor.params ?? {}) as ObjectCardParams
      const handle = lease.value as TypedObjectHandle
      const view = document.createElement('sh-object-view') as ShObjectView
      view.tabIndex = 0
      view.faceSlot = params.slot ?? 'card'
      if (params.maxFields !== undefined) view.params = { maxFields: params.maxFields }
      const holder = document.createElement('div')
      holder.style.cssText = 'padding:8px;box-sizing:border-box;min-height:100%'
      const status = document.createElement('p')
      status.style.cssText = 'margin:0;color:var(--mn-color-text-secondary);font:var(--mn-text-sm,13px)/1.5 var(--mn-font-chrome)'
      status.textContent = 'Reading…'
      holder.append(status)
      target.replaceChildren(holder)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphId ?? handle.locatorGraphId
      if (!graphId) {
        status.textContent = 'object.card: no graph to read — pass a `graphId` param, or use a graph-scoped locator'
      } else {
        view.graphId = graphId
        const apply = (state: StoreState<TypedObjectRead | null>): void => {
          if (disposed) return
          holder.dataset.resourceState = state.status
          if (state.status === 'error') {
            status.textContent = state.error ?? 'This object could not be read.'
            holder.replaceChildren(status)
            return
          }
          if (state.status !== 'ready') return
          if (state.read === null) {
            status.textContent = `Not in this graph: ${handle.iri}`
            holder.replaceChildren(status)
            return
          }
          view.model = objectModelOfRead(state.read)
          if (view.parentNode !== holder) holder.replaceChildren(view)
        }
        unsubscribe = observeSurfaceResourceStore(handle.store(graphId), apply)
        await handle.store(graphId).refresh()
      }

      const faceView: FaceView = {
        focus() {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {},
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          holder.remove()
        },
      }
      return faceView
    },
  }
}
