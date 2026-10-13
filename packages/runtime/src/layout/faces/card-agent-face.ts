/**
 * card-agent-face.ts — the `card.agent` face (el Despacho W11, the roster
 * pokédex): one seat of the correo canon as a CATALOGUE ENTRY, the seat's
 * elder sibling. Same resource shapes as `card.seat` (a bare `iri` locator
 * with the closed `graphIri` param — the collection-bound item shape the
 * gallery grid mints — or a graph-scoped subject), the same six seat shapes
 * from ../../despacho/seat-reading.ts, plus the two entry shapes from
 * ../../despacho/agent-reading.ts (runs by state over every run; supersession
 * both ways), folded into one `AgentEntry` per refresh. `mode: 'tile'` is the
 * gallery's tile. No write path.
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
} from '../../despacho/seat-reading.js'
import { agentLineageQuery, agentRunStatsQuery, readAgent, type AgentEntry } from '../../despacho/agent-reading.js'
// Side-effect import: registers the <sh-agent-entry-view> custom element.
import './agent-entry-view-element.js'
import type { AgentViewMode, ShAgentEntryView } from './agent-entry-view-element.js'
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

export const CARD_AGENT_FACE_ID = 'card.agent'
const CARD_AGENT_ADAPTER_ID = 'card.agent.entry-query'

export interface CardAgentParams {
  readonly mode?: AgentViewMode
  readonly graphIri?: string
}

export interface AgentQueryHandle {
  readonly subjectIri: string
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<AgentEntry>
  run(graphId: string): Promise<AgentEntry>
}

function cardAgentResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_AGENT_FACE_ID)
  return resourceKeyTuple('card-agent', graphId ?? undefined, subjectIri)
}

export function createCardAgentResourceAdapter(service: QueryBlockService, now: () => Date = () => new Date()): DerivedResourceAdapter<AgentQueryHandle> {
  return {
    adapterId: CARD_AGENT_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isSubjectLocator,
    resourceKey: cardAgentResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_AGENT_FACE_ID)
      const stores = new Map<string, SurfaceResourceStore<AgentEntry>>()
      const load = async (runGraphId: string): Promise<AgentEntry> => {
        const [properties, counts, runs, held, peers, capabilities, stats, lineage] = await Promise.all([
          service.run(runGraphId, seatPropertiesQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCountsQuery(subjectIri), 1),
          service.run(runGraphId, seatRunsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatHeldBeadsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCorrespondentsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, seatCapabilitiesQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, agentRunStatsQuery(subjectIri), SEAT_MAX_ROWS),
          service.run(runGraphId, agentLineageQuery(subjectIri), SEAT_MAX_ROWS),
        ])
        const seat = readSeat(subjectIri, properties, counts, runs, held, peers, capabilities)
        return readAgent(seat, stats, lineage, now())
      }
      const store = (runGraphId: string): SurfaceResourceStore<AgentEntry> => {
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

function cardAgentConstraints(descriptor: ViewDescriptor): LeafConstraints {
  const mode = (descriptor.params as { readonly mode?: string } | undefined)?.mode
  return mode === 'tile' ? { minWidth: 180, minHeight: 96, overflow: 'clip' } : { minWidth: 260, minHeight: 140, overflow: 'clip' }
}

export function createCardAgentFace(): FaceRegistration {
  return {
    faceId: CARD_AGENT_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: CARD_AGENT_ADAPTER_ID,
    accepts: isSubjectLocator,
    paramsSchema: closedParamsSchema({
      mode: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardAgentConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = (descriptor.params ?? {}) as unknown as CardAgentParams
      const handle = lease.value as AgentQueryHandle
      const view = document.createElement('sh-agent-entry-view') as ShAgentEntryView
      view.tabIndex = 0
      view.mode = params.mode === 'tile' ? 'tile' : 'chapter'
      view.subjectIri = handle.subjectIri
      view.status = 'loading'
      view.focusHref = (iri) => focusHrefFrom(window.location, iri)
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      if (!graphId) {
        view.status = 'error'
        view.error = 'card.agent: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else if (handle.subjectIri === FOCUS_PLACEHOLDER) {
        view.status = 'error'
        view.error = 'No entry is open. Choose one in the gallery — or add ?focus=<its IRI> to the address — and it appears here.'
      } else {
        const store = handle.store(graphId)
        unsubscribe = observeSurfaceResourceStore(store, (state: StoreState<AgentEntry>) => {
          if (disposed) return
          view.dataset.resourceState = state.status
          if (state.read !== null) {
            view.entry = state.read
            view.status = 'ready'
            if (state.status === 'ready') delete view.dataset.resourceStale
            else view.dataset.resourceStale = 'true'
            return
          }
          delete view.dataset.resourceStale
          if (state.status === 'error') {
            view.status = 'error'
            view.error = state.error ?? 'Unable to load this entry.'
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
