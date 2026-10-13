/**
 * card-cuenta-face.ts — the `card.cuenta` face (el Despacho W1,
 * plans/2026-09-15-despacho-design.md §7): one bead of the cuentas
 * project-management vocabulary, rendered as a chapter with one act.
 *
 * Resource locator: EITHER `{kind:'iri', iri}` (+ the closed `graphIri`
 * param) OR `{kind:'graph', graphId, subjectIri}` — the same two shapes
 * `card.subject` accepts, for the same reason (a bare-iri locator is the
 * collection-bound item shape the grid renderer mints). A focus-driven
 * layout authors the subject as `{{focus}}`; `focus-binding.ts` substitutes
 * the session's focus before this face ever mounts, and an UNBOUND
 * placeholder paints an honest "this room has no focus" — never a query
 * over the literal text.
 *
 * Wraps the SAME production `QueryBlockService` every query face wraps, with
 * three fixed shapes from ../../despacho/cuenta-reading.ts folded into one
 * reading per store refresh. The ONE write path is the verb executor
 * (../../despacho/cuenta-verbs.ts): the view emits a typed `cuenta-word`
 * intent; this face runs validate → plan → dry run → apply through the
 * session's tool port and re-reads. A missing port is not an error state of
 * the face — the chapter still reads; the act says the session cannot carry
 * a word.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import {
  CUENTA_MAX_ROWS,
  cuentaEdgesQuery,
  cuentaPropertiesQuery,
  cuentaRendicionesQuery,
  readCuenta,
  type CuentaReading,
} from '../../despacho/cuenta-reading.js'
import {
  createCuentaVerbExecutor,
  type CuentaVerbExecutor,
  type CuentaVerbPort,
} from '../../despacho/cuenta-verbs.js'
// Side-effect import: registers the <sh-cuenta-chapter-view> custom element.
import './cuenta-chapter-view-element.js'
import type { CuentaChapterMode, CuentaWordDetail, ShCuentaChapterView } from './cuenta-chapter-view-element.js'
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

export const CARD_CUENTA_FACE_ID = 'card.cuenta'
const CARD_CUENTA_ADAPTER_ID = 'card.cuenta.bead-query'

export interface CardCuentaParams {
  readonly mode?: CuentaChapterMode
  readonly graphIri?: string
}

/**
 * The session's verb seam, resolved LATE (per call) so a session swap or a
 * port that arrives after mount is honoured — the same delegating shape the
 * engine's query/object/evidence services use.
 */
export interface CuentaVerbSeam {
  /** The live tool port, or null when this session cannot write (no live cell, read-only viewer…). */
  readonly port: () => CuentaVerbPort | null
  /** The viewer's identity as the session knows it — the witness of any word given here. */
  readonly witness: () => string | null
}

export interface CuentaQueryHandle {
  readonly subjectIri: string
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<CuentaReading>
  run(graphId: string): Promise<CuentaReading>
  executor(graphId: string): CuentaVerbExecutor | null
  witness(): string | null
}

function isCardCuentaLocator(locator: ResourceLocator): boolean {
  if (locator.kind === 'iri') return true
  if (locator.kind === 'graph') return typeof locator.subjectIri === 'string' && locator.subjectIri.length > 0
  return false
}

function subjectAndGraphOf(locator: ResourceLocator): { readonly subjectIri: string; readonly graphId: string | null } {
  if (locator.kind === 'iri') return { subjectIri: locator.iri, graphId: null }
  if (locator.kind === 'graph' && locator.subjectIri) return { subjectIri: locator.subjectIri, graphId: locator.graphId }
  throw new Error(`card.cuenta: resource adapter given an unexpected locator (kind '${locator.kind}')`)
}

function cardCuentaResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOf(locator)
  return resourceKeyTuple('card-cuenta', graphId ?? undefined, subjectIri)
}

/** No verb seam — the chapter reads, the act cannot be carried (tests, read-only hosts). */
export const NO_CUENTA_VERB_SEAM: CuentaVerbSeam = Object.freeze({ port: () => null, witness: () => null })

export function createCardCuentaResourceAdapter(
  service: QueryBlockService,
  verbs: CuentaVerbSeam = NO_CUENTA_VERB_SEAM,
): DerivedResourceAdapter<CuentaQueryHandle> {
  return {
    adapterId: CARD_CUENTA_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isCardCuentaLocator,
    resourceKey: cardCuentaResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOf(locator)
      const stores = new Map<string, SurfaceResourceStore<CuentaReading>>()
      const load = async (runGraphId: string): Promise<CuentaReading> => {
        const [properties, edges, rendiciones] = await Promise.all([
          service.run(runGraphId, cuentaPropertiesQuery(subjectIri), CUENTA_MAX_ROWS),
          service.run(runGraphId, cuentaEdgesQuery(subjectIri), CUENTA_MAX_ROWS),
          service.run(runGraphId, cuentaRendicionesQuery(subjectIri), CUENTA_MAX_ROWS),
        ])
        return readCuenta(subjectIri, properties, edges, rendiciones)
      }
      const store = (runGraphId: string): SurfaceResourceStore<CuentaReading> => {
        let existing = stores.get(runGraphId)
        if (!existing) {
          existing = createSurfaceResourceStore(() => load(runGraphId), context)
          stores.set(runGraphId, existing)
        }
        return existing
      }
      return {
        subjectIri,
        locatorGraphId: graphId,
        store,
        run: (runGraphId: string) => refreshSurfaceResourceStore(store(runGraphId)),
        executor(runGraphId: string) {
          const port = verbs.port()
          return port ? createCuentaVerbExecutor({ port, graphId: runGraphId }) : null
        },
        witness: () => verbs.witness(),
      }
    },
  }
}

function cardCuentaConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 160, overflow: 'clip' }
}

function cardCuentaParams(descriptor: ViewDescriptor): CardCuentaParams {
  return (descriptor.params ?? {}) as unknown as CardCuentaParams
}

/** The hyperlink that moves the room's focus: the CURRENT location with `focus` replaced — the shell's own contract for the cursor. */
export function focusHrefFrom(location: { readonly href: string }, iri: string): string {
  try {
    const url = new URL(location.href)
    url.searchParams.set('focus', iri)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return `?focus=${encodeURIComponent(iri)}`
  }
}

export function createCardCuentaFace(): FaceRegistration {
  return {
    faceId: CARD_CUENTA_FACE_ID,
    // A read snapshot plus a draft utterance the viewer may be typing: a
    // relocate re-mounts, so the draft is what a move would lose. Stamp
    // persistence (like card.subject) keeps the interpreter simple; the act
    // is short and a word is given in one sitting.
    persistence: 'stamp',
    resourceAdapterId: CARD_CUENTA_ADAPTER_ID,
    accepts: isCardCuentaLocator,
    paramsSchema: closedParamsSchema({
      mode: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardCuentaConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = cardCuentaParams(descriptor)
      const handle = lease.value as CuentaQueryHandle

      const view = document.createElement('sh-cuenta-chapter-view') as ShCuentaChapterView
      view.tabIndex = 0
      view.mode = params.mode === 'entry' ? 'entry' : 'chapter'
      view.subjectIri = handle.subjectIri
      view.status = 'loading'
      view.focusHref = (iri) => focusHrefFrom(window.location, iri)
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      let reading: CuentaReading | null = null

      const onWord = async (event: Event): Promise<void> => {
        const detail = (event as CustomEvent<CuentaWordDetail>).detail
        if (!graphId || !reading || disposed) return
        const executor = handle.executor(graphId)
        const witness = handle.witness()
        if (!executor || !witness) {
          view.verbState = { phase: 'refused', at: 'validate', message: 'this session cannot carry a word to the cell (no live tool port or no viewer identity)' }
          return
        }
        view.verbState = { phase: 'dry-run' }
        const spec = { verb: 'word', cuenta: reading.subject, word: detail.word, utterance: detail.utterance, witness }
        // The executor runs dry-run THEN apply; the view shows 'apply' once
        // the dry run passed — we learn that only by the outcome, so the
        // state flips on completion (the two phases are sub-second apart).
        const outcome = await executor.execute(spec, reading)
        if (disposed) return
        if (!outcome.ok) {
          view.verbState = { phase: 'refused', at: outcome.phase, message: outcome.message }
          return
        }
        view.verbState = { phase: 'applied', subjects: outcome.subjects }
        view.clearDraft()
        if (graphId) await handle.store(graphId).refresh()
      }
      view.addEventListener('cuenta-word', (event) => {
        void onWord(event)
      })

      if (!graphId) {
        view.status = 'error'
        view.error = 'card.cuenta: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else if (handle.subjectIri === FOCUS_PLACEHOLDER) {
        view.status = 'error'
        view.error = 'This room has no focus. Open a bead — add ?focus=<its IRI> to the address — and the chapter appears here.'
      } else {
        const store = handle.store(graphId)
        const applyState = (state: StoreState<CuentaReading>): void => {
          if (disposed) return
          view.dataset.resourceState = state.status
          view.canAct = handle.executor(graphId) !== null && handle.witness() !== null
          view.witness = handle.witness() ?? ''
          if (state.read !== null) {
            reading = state.read
            view.reading = state.read
            view.status = 'ready'
            if (state.status === 'ready') delete view.dataset.resourceStale
            else view.dataset.resourceStale = 'true'
            return
          }
          delete view.dataset.resourceStale
          if (state.status === 'error') {
            view.status = 'error'
            view.error = state.error ?? 'Unable to load this bead.'
          } else {
            view.status = 'loading'
          }
        }
        unsubscribe = observeSurfaceResourceStore(store, applyState)
        await store.refresh()
      }

      const faceView: FaceView = {
        focus(_request) {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // <sh-cuenta-chapter-view>'s :host fills 100%/100% via CSS — no-op (design §3.2).
        },
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
