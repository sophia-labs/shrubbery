/**
 * card-inbox-face.ts — the `card.inbox` face (el Despacho W4,
 * plans/2026-09-15-despacho-operational-memo.md §3 W4): one person's inbox
 * as a room — gates awaiting their word, unanswered letters to the seats
 * they convene, returns they have not read — with the one act `read`.
 *
 * Resource locator: `{kind:'iri', iri}` where the IRI names the room (any
 * absolute IRI; by convention `urn:sophia:despacho:room:inbox`) — the room
 * is not a subject in the graph, the viewer is. WHOSE inbox comes from the
 * closed params: `owner` (the cuentas office name, default "vera") and
 * `convenes` (comma-separated seat IRIs the owner convenes; default the
 * register's root seat `…:correo:seat:sophia` — Vera has no correo seat of
 * her own; letters to her are addressed to the seat that convened her, and
 * the room says so). The reader whose Lecturas clear the returns is the
 * session's witness — never a param, so no one reads as someone else.
 *
 * Reads through the same `QueryBlockService` every query face wraps
 * (three fixed shapes in ../../despacho/inbox-reading.ts; explicit graph
 * IRIs so the S0 room mirror answers them locally); writes ONLY through the
 * inbox verb executor (../../despacho/inbox-verbs.ts) via the session's
 * tool port — the same `CuentaVerbSeam` card.cuenta uses.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import {
  correoGraphIri,
  cuentasGraphIri,
  INBOX_MAX_ROWS,
  inboxGatesQuery,
  inboxLettersQuery,
  inboxReturnsQuery,
  readInbox,
  type InboxReading,
} from '../../despacho/inbox-reading.js'
import { createInboxVerbExecutor, type InboxVerbExecutor } from '../../despacho/inbox-verbs.js'
import { COR_NS } from '../../despacho/seat-reading.js'
// Side-effect import: registers the <sh-inbox-room-view> custom element.
import './inbox-room-view-element.js'
import type { InboxReadDetail, InboxReadState, ShInboxRoomView } from './inbox-room-view-element.js'
import { focusHrefFrom, NO_CUENTA_VERB_SEAM, type CuentaVerbSeam } from './card-cuenta-face.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  refreshSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'
import { plainQueryBlockTermValue } from '../../editor-services/query-block-service.js'

export const CARD_INBOX_FACE_ID = 'card.inbox'
const CARD_INBOX_ADAPTER_ID = 'card.inbox.room-query'

export const DEFAULT_INBOX_OWNER = 'vera'

export interface CardInboxParams {
  readonly owner?: string
  /** Comma-separated seat IRIs. */
  readonly convenes?: string
  readonly graphIri?: string
}

export interface InboxQueryHandle {
  readonly roomIri: string
  /** A reading keyed by (graph, owner, convened seats, reader). */
  store(graphId: string, owner: string, seats: readonly string[], reader: string): SurfaceResourceStore<InboxReading>
  seatTitles(graphId: string, seats: readonly string[]): Promise<ReadonlyMap<string, string>>
  executor(graphId: string): InboxVerbExecutor | null
  witness(): string | null
}

function isCardInboxLocator(locator: ResourceLocator): boolean {
  return locator.kind === 'iri' && typeof locator.iri === 'string' && locator.iri.length > 0
}

function cardInboxResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'iri') throw new Error(`card.inbox: unexpected locator kind '${locator.kind}'`)
  return resourceKeyTuple('card-inbox', undefined, locator.iri)
}

/** The seats a comma-separated param names; empty/blank → the register's root seat for this graph. */
export function convenedSeats(graphId: string, convenes: string | undefined): readonly string[] {
  const listed = (convenes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return listed.length > 0 ? listed : [`${correoGraphIri(graphId)}:seat:sophia`]
}

export function createCardInboxResourceAdapter(
  service: QueryBlockService,
  verbs: CuentaVerbSeam = NO_CUENTA_VERB_SEAM,
): DerivedResourceAdapter<InboxQueryHandle> {
  return {
    adapterId: CARD_INBOX_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isCardInboxLocator,
    resourceKey: cardInboxResourceKey,
    async compute(locator, context) {
      if (locator.kind !== 'iri') throw new Error('card.inbox: iri locator expected')
      const stores = new Map<string, SurfaceResourceStore<InboxReading>>()
      const load = async (graphId: string, owner: string, seats: readonly string[], reader: string): Promise<InboxReading> => {
        const cuentas = cuentasGraphIri(graphId)
        const correo = correoGraphIri(graphId)
        const [gates, letters, returns] = await Promise.all([
          service.run(graphId, inboxGatesQuery(cuentas, owner), INBOX_MAX_ROWS * 4),
          service.run(graphId, inboxLettersQuery(correo, seats), INBOX_MAX_ROWS),
          service.run(graphId, inboxReturnsQuery(cuentas, reader), INBOX_MAX_ROWS),
        ])
        return readInbox(owner, seats, reader, gates, letters, returns)
      }
      return {
        roomIri: locator.iri,
        store(graphId, owner, seats, reader) {
          const key = JSON.stringify([graphId, owner, seats, reader])
          let existing = stores.get(key)
          if (!existing) {
            existing = createSurfaceResourceStore(() => load(graphId, owner, seats, reader), context)
            stores.set(key, existing)
          }
          return existing
        },
        async seatTitles(graphId, seats) {
          const titles = new Map<string, string>()
          if (seats.length === 0) return titles
          const values = seats.map((s) => `<${s}>`).join(' ')
          const result = await service.run(
            graphId,
            `SELECT ?seat ?title WHERE { GRAPH <${correoGraphIri(graphId)}> { VALUES ?seat { ${values} } ?seat <${COR_NS}title> ?title } }`,
            seats.length,
          )
          if (result.resultKind === 'bindings') {
            for (const row of result.rows) {
              const seat = plainQueryBlockTermValue(row.seat)
              const title = plainQueryBlockTermValue(row.title)
              if (seat && title) titles.set(seat, title)
            }
          }
          return titles
        },
        executor(graphId) {
          const port = verbs.port()
          return port ? createInboxVerbExecutor({ port, graphId }) : null
        },
        witness: () => verbs.witness(),
      }
    },
  }
}

function cardInboxConstraints(): LeafConstraints {
  return { minWidth: 280, minHeight: 200, overflow: 'clip' }
}

function cardInboxParams(descriptor: ViewDescriptor): CardInboxParams {
  return (descriptor.params ?? {}) as unknown as CardInboxParams
}

export function createCardInboxFace(): FaceRegistration {
  return {
    faceId: CARD_INBOX_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: CARD_INBOX_ADAPTER_ID,
    accepts: isCardInboxLocator,
    paramsSchema: closedParamsSchema({
      owner: { type: 'string', optional: true },
      convenes: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardInboxConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = cardInboxParams(descriptor)
      const handle = lease.value as InboxQueryHandle
      const view = document.createElement('sh-inbox-room-view') as ShInboxRoomView
      view.tabIndex = 0
      view.status = 'loading'
      view.focusHref = (iri) => focusHrefFrom(window.location, iri)
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? null
      const owner = params.owner?.trim() || DEFAULT_INBOX_OWNER
      const readStates = new Map<string, InboxReadState>()
      const setReadState = (iri: string, state: InboxReadState): void => {
        readStates.set(iri, state)
        view.readStates = new Map(readStates)
      }

      const onRead = async (event: Event): Promise<void> => {
        const { rendicion } = (event as CustomEvent<InboxReadDetail>).detail
        if (!graphId || disposed) return
        const executor = handle.executor(graphId)
        const reader = handle.witness()
        if (!executor || !reader) {
          setReadState(rendicion, { phase: 'refused', at: 'validate', message: 'this session cannot carry a reading to the cell (no live tool port or no viewer identity)' })
          return
        }
        setReadState(rendicion, { phase: 'dry-run' })
        const outcome = await executor.execute({ verb: 'read', rendicion, reader })
        if (disposed) return
        if (!outcome.ok) {
          setReadState(rendicion, { phase: 'refused', at: outcome.phase, message: outcome.message })
          return
        }
        setReadState(rendicion, { phase: 'applied', subjects: outcome.subjects })
        const seats = convenedSeats(graphId, params.convenes)
        await handle.store(graphId, owner, seats, reader).refresh()
      }
      view.addEventListener('inbox-read', (event) => {
        void onRead(event)
      })

      if (!graphId) {
        view.status = 'error'
        view.error = 'card.inbox: no graph to query — pass a `graphIri` param'
      } else {
        const seats = convenedSeats(graphId, params.convenes)
        const reader = handle.witness() ?? ''
        const store = handle.store(graphId, owner, seats, reader)
        void handle
          .seatTitles(graphId, seats)
          .then((titles) => {
            if (!disposed) view.seatTitles = titles
          })
          .catch(() => {})
        const applyState = (state: StoreState<InboxReading>): void => {
          if (disposed) return
          view.dataset.resourceState = state.status
          view.canAct = handle.executor(graphId) !== null && handle.witness() !== null
          view.witness = handle.witness() ?? ''
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
            view.error = state.error ?? 'Unable to open the inbox.'
          } else {
            view.status = 'loading'
          }
        }
        unsubscribe = observeSurfaceResourceStore(store, applyState)
        await refreshSurfaceResourceStore(store)
      }

      const faceView: FaceView = {
        focus(_request) {
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
