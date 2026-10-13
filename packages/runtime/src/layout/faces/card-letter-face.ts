/**
 * card-letter-face.ts — the `card.letter` face (el Despacho W2): one letter
 * of the Demi correspondence register (`cor:Letter`) as a page. Same two
 * locator shapes as `card.seat`; reads through the SAME production
 * `QueryBlockService`, four fixed shapes from ../../despacho/letter-reading.ts
 * folded into one reading per refresh. No write path this wave.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import {
  LETTER_MAX_ROWS,
  letterAcksQuery,
  letterPartiesQuery,
  letterPropertiesQuery,
  letterRepliesQuery,
  readLetter,
  type LetterReading,
} from '../../despacho/letter-reading.js'
// Side-effect import: registers the <sh-letter-page-view> custom element.
import './letter-page-view-element.js'
import type { LetterViewMode, ShLetterPageView } from './letter-page-view-element.js'
import { focusHrefFrom } from './card-cuenta-face.js'
import { isSubjectLocator, subjectAndGraphOfLocator } from './card-seat-face.js'
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

export const CARD_LETTER_FACE_ID = 'card.letter'
const CARD_LETTER_ADAPTER_ID = 'card.letter.letter-query'

export interface CardLetterParams {
  readonly mode?: LetterViewMode
  readonly graphIri?: string
}

export interface LetterQueryHandle {
  readonly subjectIri: string
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<LetterReading>
  run(graphId: string): Promise<LetterReading>
}

function cardLetterResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_LETTER_FACE_ID)
  return resourceKeyTuple('card-letter', graphId ?? undefined, subjectIri)
}

export function createCardLetterResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<LetterQueryHandle> {
  return {
    adapterId: CARD_LETTER_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isSubjectLocator,
    resourceKey: cardLetterResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_LETTER_FACE_ID)
      const stores = new Map<string, SurfaceResourceStore<LetterReading>>()
      const load = async (runGraphId: string): Promise<LetterReading> => {
        const [properties, parties, replies, acks] = await Promise.all([
          service.run(runGraphId, letterPropertiesQuery(subjectIri), LETTER_MAX_ROWS),
          service.run(runGraphId, letterPartiesQuery(subjectIri), 1),
          service.run(runGraphId, letterRepliesQuery(subjectIri), LETTER_MAX_ROWS),
          service.run(runGraphId, letterAcksQuery(subjectIri), LETTER_MAX_ROWS),
        ])
        return readLetter(subjectIri, properties, parties, replies, acks)
      }
      const store = (runGraphId: string): SurfaceResourceStore<LetterReading> => {
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

function cardLetterConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 120, overflow: 'clip' }
}

export function createCardLetterFace(): FaceRegistration {
  return {
    faceId: CARD_LETTER_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: CARD_LETTER_ADAPTER_ID,
    accepts: isSubjectLocator,
    paramsSchema: closedParamsSchema({
      mode: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardLetterConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = (descriptor.params ?? {}) as unknown as CardLetterParams
      const handle = lease.value as LetterQueryHandle
      const view = document.createElement('sh-letter-page-view') as ShLetterPageView
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
        view.error = 'card.letter: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else if (handle.subjectIri === FOCUS_PLACEHOLDER) {
        view.status = 'error'
        view.error = 'This room has no focus. Open a letter — add ?focus=<its IRI> to the address — and the page appears here.'
      } else {
        const store = handle.store(graphId)
        unsubscribe = observeSurfaceResourceStore(store, (state: StoreState<LetterReading>) => {
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
            view.error = state.error ?? 'Unable to load this letter.'
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
