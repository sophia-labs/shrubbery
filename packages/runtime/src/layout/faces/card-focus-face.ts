/**
 * card-focus-face.ts — the `card.focus` face (el Despacho W2): the thing
 * under the cursor, AS WHAT IT IS. A focus-driven room has one cursor and
 * several kinds of thing it can rest on — a bead, a seat, a letter — and a
 * layout that names `{{focus}}` should not have to guess which. This face
 * asks the graph one question (../../despacho/focus-probe.ts: the subject's
 * `rdf:type`s) and then mounts the matching face — `card.cuenta`,
 * `card.seat`, `card.letter` — with that face's own resource handle, so the
 * chapter, the character or the page renders exactly as it would have under
 * its own face id. In `entry` mode it lets a collection grid mix kinds: a
 * grid of "things that point at the focus" may hold beads and letters.
 *
 * It composes the three adapters (their `compute` is lazy — no query runs
 * until a store is observed) and delegates `mount` with the SAME context and
 * a lease whose value is the inner handle: the interpreter still owns the
 * outer lease's lifetime. The verb seam reaches `card.cuenta` unchanged.
 * A subject of none of the three kinds is said so, with the types it does
 * carry — never a blank pane.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import { FOCUS_PROBE_MAX_ROWS, classifyFocus, focusTypesQuery, type FocusKind, type FocusProbe } from '../../despacho/focus-probe.js'
import {
  NO_CUENTA_VERB_SEAM,
  createCardCuentaFace,
  createCardCuentaResourceAdapter,
  type CuentaVerbSeam,
} from './card-cuenta-face.js'
import { createCardSeatFace, createCardSeatResourceAdapter, isSubjectLocator, subjectAndGraphOfLocator } from './card-seat-face.js'
import { createCardLetterFace, createCardLetterResourceAdapter } from './card-letter-face.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceMountContext,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import { FOCUS_PLACEHOLDER } from '../named-query-registry.js'

export const CARD_FOCUS_FACE_ID = 'card.focus'
const CARD_FOCUS_ADAPTER_ID = 'card.focus.typed-query'

export interface CardFocusParams {
  readonly mode?: 'chapter' | 'entry'
  readonly graphIri?: string
}

export interface FocusResolution {
  readonly probe: FocusProbe
  /** The inner face's resource handle for the matching kind; null for `unknown`. */
  readonly inner: unknown
}

export interface FocusQueryHandle {
  readonly subjectIri: string
  readonly locatorGraphId: string | null
  /** Probe once per graph (memoized) and hand back the matching inner handle. */
  resolve(graphId: string): Promise<FocusResolution>
}

function cardFocusResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_FOCUS_FACE_ID)
  return resourceKeyTuple('card-focus', graphId ?? undefined, subjectIri)
}

export function createCardFocusResourceAdapter(
  service: QueryBlockService,
  verbs: CuentaVerbSeam = NO_CUENTA_VERB_SEAM,
): DerivedResourceAdapter<FocusQueryHandle> {
  const cuenta = createCardCuentaResourceAdapter(service, verbs)
  const seat = createCardSeatResourceAdapter(service)
  const letter = createCardLetterResourceAdapter(service)
  return {
    adapterId: CARD_FOCUS_ADAPTER_ID,
    shape: 'derived',
    retainForMs: cuenta.retainForMs,
    accepts: isSubjectLocator,
    resourceKey: cardFocusResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOfLocator(locator, CARD_FOCUS_FACE_ID)
      const resolutions = new Map<string, Promise<FocusResolution>>()
      const resolve = (runGraphId: string): Promise<FocusResolution> => {
        let pending = resolutions.get(runGraphId)
        if (!pending) {
          pending = (async () => {
            const types = await service.run(runGraphId, focusTypesQuery(subjectIri), FOCUS_PROBE_MAX_ROWS)
            const probe = classifyFocus(subjectIri, types)
            const innerAdapter = probe.kind === 'cuenta' ? cuenta : probe.kind === 'seat' ? seat : probe.kind === 'letter' ? letter : null
            const inner = innerAdapter ? await innerAdapter.compute(locator, context) : null
            return { probe, inner }
          })()
          resolutions.set(runGraphId, pending)
          // A failed probe must not be memoized as the room's permanent answer.
          pending.catch(() => resolutions.delete(runGraphId))
        }
        return pending
      }
      return { subjectIri, locatorGraphId: graphId, resolve }
    },
  }
}

function cardFocusConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 120, overflow: 'clip' }
}

function unknownView(target: HTMLElement, subject: string, kinds: readonly string[], mode: 'chapter' | 'entry'): FaceView {
  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.setAttribute('role', 'region')
  stage.dataset.stance = 'dispatch'
  stage.dataset.subject = subject
  stage.dataset.focusKind = 'unknown'
  stage.style.cssText = 'padding:16px;color:var(--mn-color-text-muted);font:13px/1.5 var(--mn-font-chrome,system-ui,sans-serif);overflow:auto;height:100%;box-sizing:border-box'
  const what = kinds.length > 0 ? `It is typed ${kinds.map((k) => k.replace(/^.*[#/]/, '')).join(', ')}.` : 'It carries no rdf:type in this graph.'
  stage.textContent =
    mode === 'entry'
      ? `${subject} — not a bead, a seat or a letter. ${what}`
      : `The focus ${subject} is not a bead, a seat or a letter of this room. ${what} El Despacho knows how to open beads (cuentas), seats and letters (correo).`
  target.replaceChildren(stage)
  return {
    focus() {
      return false
    },
    blur() {},
    resize() {},
    serialize(): ViewDescriptor {
      throw new Error('card.focus: unknown-kind view has no descriptor of its own')
    },
    dispose() {
      stage.remove()
    },
  }
}

function errorView(target: HTMLElement, message: string): FaceView {
  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.dataset.stance = 'dispatch'
  stage.style.cssText = 'padding:16px;color:var(--mn-color-danger-strong);font:13px/1.5 var(--mn-font-chrome,system-ui,sans-serif)'
  stage.textContent = message
  target.replaceChildren(stage)
  return {
    focus() {
      return false
    },
    blur() {},
    resize() {},
    serialize(): ViewDescriptor {
      throw new Error('card.focus: error view has no descriptor of its own')
    },
    dispose() {
      stage.remove()
    },
  }
}

export function createCardFocusFace(): FaceRegistration {
  const inner: Readonly<Record<Exclude<FocusKind, 'unknown'>, FaceRegistration>> = {
    cuenta: createCardCuentaFace(),
    seat: createCardSeatFace(),
    letter: createCardLetterFace(),
  }
  return {
    faceId: CARD_FOCUS_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: CARD_FOCUS_ADAPTER_ID,
    accepts: isSubjectLocator,
    paramsSchema: closedParamsSchema({
      mode: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardFocusConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = (descriptor.params ?? {}) as unknown as CardFocusParams
      const mode = params.mode === 'entry' ? 'entry' : 'chapter'
      const handle = lease.value as FocusQueryHandle
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      if (!graphId) return errorView(target, 'card.focus: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator')
      if (handle.subjectIri === FOCUS_PLACEHOLDER) {
        return errorView(target, 'This room has no focus. Open a bead, a seat or a letter — add ?focus=<its IRI> to the address — and it appears here.')
      }
      let resolution: FocusResolution
      try {
        resolution = await handle.resolve(graphId)
      } catch (error) {
        return errorView(target, `card.focus: could not ask the graph what the focus is: ${error instanceof Error ? error.message : String(error)}`)
      }
      target.dataset.focusKind = resolution.probe.kind
      if (resolution.probe.kind === 'unknown' || resolution.inner === null) {
        return unknownView(target, handle.subjectIri, resolution.probe.types, mode)
      }
      const face = inner[resolution.probe.kind]
      // Delegate with the SAME context and a lease carrying the inner handle;
      // the interpreter still owns the outer lease's release.
      const delegated: FaceMountContext = { ...context, lease: { ...lease, value: resolution.inner } }
      const view = await face.mount(delegated)
      return {
        focus: (request) => view.focus(request),
        blur: () => view.blur(),
        resize: (box, constraints) => view.resize(box, constraints),
        serialize: () => descriptor,
        dispose: (reason) => view.dispose(reason),
      }
    },
  }
}
