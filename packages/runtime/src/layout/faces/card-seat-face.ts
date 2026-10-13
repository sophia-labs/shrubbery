/**
 * card-seat-face.ts — the `card.seat` face (el Despacho W2): one seat of the
 * Demi correspondence register (`cor:Seat`) as a character with a heartbeat.
 *
 * Resource locator: EITHER `{kind:'iri', iri}` (+ the closed `graphIri`
 * param) OR `{kind:'graph', graphId, subjectIri}` — the two shapes
 * `card.cuenta`/`card.subject` accept, for the same reason (a bare-iri
 * locator is the collection-bound item shape the grid renderer mints). Reads
 * through the SAME production `QueryBlockService`, five fixed shapes from
 * ../../despacho/seat-reading.ts folded into one reading per refresh. No
 * write path this wave.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import {
  SEAT_MAX_ROWS,
  readSeat,
  seatCapabilitiesQuery,
  seatCorrespondentsQuery,
  seatCountsQuery,
  seatHeldBeadsQuery,
  seatPropertiesQuery,
  seatRunsQuery,
  type SeatReading,
} from '../../despacho/seat-reading.js'
// Side-effect import: registers the <sh-seat-character-view> custom element.
import './seat-character-view-element.js'
import type { SeatViewMode, ShSeatCharacterView } from './seat-character-view-element.js'
import { focusHrefFrom } from './card-cuenta-face.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import { FOCUS_PLACEHOLDER } from '../named-query-registry.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  refreshSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'

export const CARD_SEAT_FACE_ID = 'card.seat'
const CARD_SEAT_ADAPTER_ID = 'card.seat.seat-query'

export interface CardSeatParams {
  readonly mode?: SeatViewMode
  readonly graphIri?: string
}

export interface SeatQueryHandle {
  readonly subjectIri: string
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<SeatReading>
  run(graphId: string): Promise<SeatReading>
}

export function isSubjectLocator(locator: ResourceLocator): boolean {
  if (locator.kind === 'iri') return true
  if (locator.kind === 'graph') return typeof locator.subjectIri === 'string' && locator.subjectIri.length > 0
  return false
}

export function subjectAndGraphOfLocator(locator: ResourceLocator, faceId: string): { readonly subjectIri: string; readonly graphId: string | null } {
  if (locator.kind === 'iri') return { subjectIri: locator.iri, graphId: null }
  if (locator.kind === 'graph' && locator.subjectIri) return { subjectIri: locator.subjectIri, graphId: locator.graphId }
  throw new Error(`${faceId}: resource adapter given an unexpected locator (kind '${locator.kind}')`)
}

function cardSeatResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_SEAT_FACE_ID)
  return resourceKeyTuple('card-seat', graphId ?? undefined, subjectIri)
}

export function createCardSeatResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<SeatQueryHandle> {
  return {
    adapterId: CARD_SEAT_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isSubjectLocator,
    resourceKey: cardSeatResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_SEAT_FACE_ID)
      const stores = new Map<string, SurfaceResourceStore<SeatReading>>()
      const load = async (runGraphId: string): Promise<SeatReading> => {
        const [properties, counts, runs, held, peers, capabilities] = await Promise.all([
          service.run(runGraphId, seatPropertiesQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCountsQuery(subjectIri), 1),
          service.run(runGraphId, seatRunsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatHeldBeadsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCorrespondentsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCapabilitiesQuery(subjectIri), SEAT_MAX_ROWS),
        ])
        return readSeat(subjectIri, properties, counts, runs, held, peers, capabilities)
      }
      const store = (runGraphId: string): SurfaceResourceStore<SeatReading> => {
        let existing = stores.get(runGraphId)
        if (!existing) {
          existing = createSurfaceResourceStore(() => load(runGraphId), context)
          stores.set(runGraphId, existing)
        }
        return existing
      }
      return { subjectIri, locatorGraphId: graphId, store, run: (runGraphId) => refreshSurfaceResourceStore(store(runGraphId)) }
    },
  }
}

function cardSeatConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 120, overflow: 'clip' }
}

export function createCardSeatFace(): FaceRegistration {
  return {
    faceId: CARD_SEAT_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: CARD_SEAT_ADAPTER_ID,
    accepts: isSubjectLocator,
    paramsSchema: closedParamsSchema({
      mode: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardSeatConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = (descriptor.params ?? {}) as unknown as CardSeatParams
      const handle = lease.value as SeatQueryHandle
      const view = document.createElement('sh-seat-character-view') as ShSeatCharacterView
      view.tabIndex = 0
      view.mode = params.mode === 'entry' ? 'entry' : 'chapter'
      view.subjectIri = handle.subjectIri
      view.status = 'loading'
      view.focusHref = (iri) => focusHrefFrom(window.location, iri)
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      if (!graphId) {
        view.status = 'error'
        view.error = 'card.seat: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else if (handle.subjectIri === FOCUS_PLACEHOLDER) {
        view.status = 'error'
        view.error = 'This room has no focus. Open a seat — add ?focus=<its IRI> to the address — and the character appears here.'
      } else {
        const store = handle.store(graphId)
        unsubscribe = observeSurfaceResourceStore(store, (state: StoreState<SeatReading>) => {
          if (disposed) return
          view.dataset.resourceState = state.status
          if (state.read !== null) {
            view.reading = state.read
            view.status = 'ready'
            if (state.status === 'ready') delete view.dataset.resourceStale
            else view.dataset.resourceStale = 'true'
            return
          }
          delete view.dataset.resourceStale
          if (state.status === 'error') {
            view.status = 'error'
            view.error = state.error ?? 'Unable to load this seat.'
          } else view.status = 'loading'
        })
        await store.refresh()
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
          view.remove()
        },
      }
      return faceView
    },
  }
}
