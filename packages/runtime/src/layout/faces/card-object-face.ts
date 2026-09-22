/**
 * card-object-face.ts — the `card.object` face (WS1 §6.3/§6.7/§6.9, master
 * spec §3 Slice 2 "the healthy card").
 *
 * The foundation deliverable: every current-state Meaningful Object becomes
 * humanly visible for the first time. Reads through the `SourceObjectService`
 * seam (`../source-object-service.js`) and renders the record generically —
 * kind inferred from the value's JSON type through a closed rule set (§6.9).
 * Contested is a STANCE of this same card, wired in master spec Slice 5 — see
 * `object-card-view-element.ts`'s own header for the exact split.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { DisplayKind } from '@shrubbery/nucleus'
import type { StoreState } from '@shrubbery/nucleus'
import {
  isCardObjectLocator,
  cardObjectResourceKey,
  objectKeyOf,
  parseObjectUrn,
  type CardObjectParams,
  type ObjectKeyParts,
  type SourceObjectRead,
  type SourceObjectService,
} from '../source-object-service.js'
// Side-effect import: registers the <sh-object-card-view> custom element.
import './object-card-view-element.js'
import type { ObjectCardField, ObjectCardProposal, ShObjectCardView } from './object-card-view-element.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
} from '../types.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  refreshSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'

export const CARD_OBJECT_FACE_ID = 'card.object'
export const CARD_OBJECT_ADAPTER_ID = 'card.object.source-object'

export type { CardObjectParams } from '../source-object-service.js'

// ── the adapter (§6.2.5) ────────────────────────────────────────────────────

export interface ObjectQueryHandle {
  readonly graphId: string
  /** `null` for the empty-selection leaf (no `subjectIri` on the locator). */
  readonly key: ObjectKeyParts | null
  readonly objectKey: string | null
  /** The canonical reactive store. `null` value = EMPTY (object not found, or nothing selected). */
  readonly store: SurfaceResourceStore<SourceObjectRead | null>
  /** Compatibility one-shot over the SAME store; never a second read path. */
  run(): Promise<SourceObjectRead | null>
}

function keyAndObjectKeyOf(locator: ResourceLocator): { readonly key: ObjectKeyParts | null; readonly objectKey: string | null } {
  const subjectIri = (locator as { readonly subjectIri?: string }).subjectIri
  if (subjectIri === undefined) return { key: null, objectKey: null }
  const parts = parseObjectUrn(subjectIri)
  if (!parts) throw new Error('card.object: resource adapter given a non-object locator')
  return { key: parts, objectKey: objectKeyOf(parts) }
}

/**
 * The `card.object` `DerivedResourceAdapter`. Unlike `card.subject`'s handle,
 * the store is NOT graph-parametrized — the graph is always in the locator
 * (D-2) — so `compute()` builds the single store directly (`obs.evidence-
 * chain`'s single-graph-locator shape, minus the graph-param indirection).
 */
export function createCardObjectResourceAdapter(objects: SourceObjectService): DerivedResourceAdapter<ObjectQueryHandle> {
  return {
    adapterId: CARD_OBJECT_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isCardObjectLocator,
    resourceKey: cardObjectResourceKey,
    async compute(locator, context) {
      const graphId = (locator as { readonly graphId: string }).graphId
      const { key, objectKey } = keyAndObjectKeyOf(locator)
      const store = createSurfaceResourceStore<SourceObjectRead | null>(
        () => (key ? objects.read(graphId, key) : Promise.resolve(null)),
        context,
      )
      return {
        graphId,
        key,
        objectKey,
        store,
        run: () => refreshSurfaceResourceStore(store),
      }
    },
  }
}

// ── field selection + kind inference (§6.9) ─────────────────────────────────

/** The ONLY schemes `inferFieldKind` ever classifies as `reference`. Closed. */
export const SAFE_REFERENCE_SCHEMES = ['http', 'https', 'mailto', 'urn'] as const
const SAFE_REFERENCE_SCHEME = /^(http|https|mailto|urn):/i

// ── per-class presentation growth path (WS1 §6.9 "The growth path, ships empty") ──

/**
 * A per-class presentation plan. CODE-owned (LAY-004): a layout document can
 * never supply one — it can only name `card.object` and pass the four params.
 * The generic path (above) is the only path exercised in v1, because the
 * register below ships empty; consulting it is future wiring, not this
 * fix's scope.
 */
export interface ObjectClassPresentation {
  readonly titleField?: string
  /** Ordered field keys; keys not listed still render, after these. NEVER hidden. */
  readonly fieldOrder?: readonly string[]
  /** Per-key kind override; must name one of the seven shipped DisplayKinds. */
  readonly kinds?: Readonly<Record<string, DisplayKind>>
  /** Per-key unit for `metric` fields (e.g. `characterWpm` -> 'wpm'). */
  readonly units?: Readonly<Record<string, string>>
}

/** v1 ships EMPTY. Adding an entry is a code change with its own test. */
export const OBJECT_CLASS_PRESENTATIONS: ReadonlyMap<string, ObjectClassPresentation> = new Map()

function isSafeReferenceValue(value: string): boolean {
  return SAFE_REFERENCE_SCHEME.test(value) && value.includes(':')
}

/** Pure. The CLOSED inference rule set — code, never data (§6.9). */
export function inferFieldKind(value: unknown): DisplayKind {
  if (value === null || value === undefined) return 'state'
  if (typeof value === 'number' && Number.isFinite(value)) return 'metric'
  if (typeof value === 'boolean') return 'state'
  if (typeof value === 'string') {
    if (isSafeReferenceValue(value)) return 'reference'
    if (value.includes('\n') || value.length > 120) return 'prose'
    return 'state'
  }
  // array / object
  return 'prose'
}

function formatFieldValue(value: unknown, kind: DisplayKind): string {
  if (value === null || value === undefined) return ''
  if (kind === 'prose' && (Array.isArray(value) || typeof value === 'object')) return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/**
 * Mirror path: the record key verbatim. Authority path: `decodeAuthorityRecord`
 * (`apps/organism/src/cell/source-object-runtime.ts`) keys the record by the
 * predicate IRI verbatim (§6.2.3) — shortened here to the last `#`- or
 * `/`-delimited segment for display; the full IRI stays in `fullLabel`
 * (`title=`). No CURIE expansion — the runtime layer has no prefix registry
 * (`card-subject-face.ts:27-31`'s own reasoning).
 */
function shortLabel(key: string, provenance: SourceObjectProvenanceLike): string {
  if (provenance !== 'authority-projection') return key
  const cut = Math.max(key.lastIndexOf('#'), key.lastIndexOf('/'))
  return cut >= 0 && cut < key.length - 1 ? key.slice(cut + 1) : key
}

type SourceObjectProvenanceLike = SourceObjectRead['provenance']

function toField(key: string, value: unknown, provenance: SourceObjectProvenanceLike): ObjectCardField {
  const kind = inferFieldKind(value)
  const absent = value === null || value === undefined
  const nested = !absent && kind === 'prose' && (Array.isArray(value) || typeof value === 'object')
  return {
    label: shortLabel(key, provenance),
    fullLabel: key,
    value: formatFieldValue(value, kind),
    kind,
    unit: undefined,
    href: kind === 'reference' && typeof value === 'string' ? value : undefined,
    absent,
    nested,
  }
}

function parseFieldAllowList(fields: string | undefined): readonly string[] | null {
  if (!fields) return null
  const parsed = fields
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)
  return parsed.length > 0 ? parsed : null
}

/** Normalizes `params.maxFields` per §6.7: negative/fractional input is never a silent "unlimited". */
function normalizedMaxFields(maxFields: number | undefined): number {
  if (maxFields === undefined) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(maxFields))
}

export interface ObjectCardSelection {
  readonly title: string
  readonly fields: readonly ObjectCardField[]
  readonly shownOf: number
}

/**
 * Pure — exported for unit testing (§6.9). Ordering is lexicographic by key,
 * always (client-stated, not an accident of `serde_json`'s map order).
 * `titleField` matches a record key exactly (mirror path) or a full predicate
 * IRI exactly (authority path); no match ⇒ the title is `objectId`.
 */
export function selectObjectCardFields(read: SourceObjectRead, params: CardObjectParams): ObjectCardSelection {
  const allowList = parseFieldAllowList(params.fields)
  const keys = Object.keys(read.record)
    .filter((key) => !allowList || allowList.includes(key))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const cap = normalizedMaxFields(params.maxFields)
  const shownKeys = keys.slice(0, Number.isFinite(cap) ? cap : keys.length)
  const fields = shownKeys.map((key) => toField(key, read.record[key], read.provenance))
  const titleValue = params.titleField !== undefined ? read.record[params.titleField] : undefined
  const title = typeof titleValue === 'string' && titleValue.length > 0 ? titleValue : read.objectId
  return { title, fields, shownOf: keys.length }
}

/**
 * A proposal's own record, flattened through the SAME per-field rule set
 * (§6.9) the head record uses — no `titleField`/`fields`/`maxFields`
 * slicing: a proposal's inline disclosure always shows its complete record
 * (WS1 §6.5's "Show full record"), never a truncated one.
 */
function candidateFields(record: Readonly<Record<string, unknown>>, provenance: SourceObjectProvenanceLike): readonly ObjectCardField[] {
  return Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => toField(key, record[key], provenance))
}

// ── strategy label mapping (§7.5, WS1 §3 correction 6) ──────────────────────

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  producerDirected: 'producer-directed',
  contested: 'contested',
  causalLww: 'causal last-write',
  evidenceWeighted: 'evidence-weighted',
  codeBacked: 'code-backed',
}

function strategyLabel(wire: string | undefined): string {
  if (!wire) return ''
  return STRATEGY_LABELS[wire] ?? wire
}

// ── the FaceRegistration (§6.3) ─────────────────────────────────────────────

function cardObjectConstraints(): LeafConstraints {
  // The element's own `.stage` owns overflow:auto — 'clip' avoids a redundant
  // outer scrollbar. Larger minimums than card.subject's 200x120 account for
  // the footer testimony (and, from Slice 5, the proposals section).
  return { minWidth: 260, minHeight: 160, overflow: 'clip' }
}

function cardObjectParams(descriptor: ViewDescriptor): CardObjectParams {
  return (descriptor.params ?? {}) as unknown as CardObjectParams
}

/**
 * A contest's candidates -> the view's `ObjectCardProposal[]` (WS1 §6.5,
 * master §2.11). In WIRE order (D-14) — hash order, never re-sorted by time
 * (there is no time to sort by). `expanded` is deliberately never set here:
 * it is client-local disclosure state the VIEW ELEMENT owns (LAY-009), not
 * something a fresh read from the face could know or should overwrite.
 */
function candidateProposals(read: SourceObjectRead): readonly ObjectCardProposal[] {
  if (!read.contest) return []
  const projectedOperationId = read.contest.projectedOperationId
  return read.contest.candidates.map(
    (candidate): ObjectCardProposal => ({
      operationId: candidate.operationId,
      sourceVersion: candidate.sourceVersion,
      baseVersion: candidate.baseVersion,
      record: candidate.record,
      fields: candidateFields(candidate.record, read.provenance),
      projected: candidate.operationId === projectedOperationId,
      ...(candidate.clientId !== undefined ? { observer: candidate.clientId } : {}),
      ...(candidate.causalOrder !== undefined ? { causalOrder: candidate.causalOrder } : {}),
    }),
  )
}

function applyRead(view: ShObjectCardView, read: SourceObjectRead | null, params: CardObjectParams): void {
  if (read === null) {
    view.status = 'empty'
    return
  }
  const selection = selectObjectCardFields(read, params)
  view.objectKey = read.objectKey
  view.vocab = read.vocab
  view.className_ = read.class
  view.objectId = read.objectId
  view.title = selection.title
  view.fields = selection.fields
  view.shownOf = selection.shownOf
  view.provenance = read.provenance
  view.reconciliationStrategy = strategyLabel(read.reconciliationStrategy)
  view.sourceVersion = read.sourceVersion ?? ''
  view.lastWriter = read.lastWriter?.clientId ?? ''
  view.lastWriterOperationId = read.lastWriter?.operationId ?? ''
  view.unavailable = read.unavailable
  view.epoch = read.epoch ?? ''
  // Contested posture (Slice 5, WS1 §6.5). Driven by `conflictId`, NOT
  // `contest` — `contest` can be legitimately absent even when `conflictId`
  // is set (the degraded case; `read.unavailable` names it 'contest').
  // Gating on `contest !== undefined` instead would render a genuinely
  // contested object as clean, silently.
  view.stance = read.conflictId !== undefined ? 'contested' : null
  view.provisionalHead = read.conflictId !== undefined
  view.conflictId = read.conflictId ?? ''
  view.contestReason = read.contest?.reason ?? ''
  view.showProposals = params.showProposals ?? true
  view.proposals = candidateProposals(read)
  view.status = 'ready'
}

export function createCardObjectFace(): FaceRegistration {
  return {
    faceId: CARD_OBJECT_FACE_ID,
    persistence: 'stamp', // D-11: a record snapshot, cheap to recompute.
    resourceAdapterId: CARD_OBJECT_ADAPTER_ID,
    accepts: isCardObjectLocator,
    paramsSchema: closedParamsSchema({
      titleField: { type: 'string', optional: true },
      fields: { type: 'string', optional: true },
      showProposals: { type: 'boolean', optional: true },
      maxFields: { type: 'number', optional: true },
    }),
    constraints: cardObjectConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = cardObjectParams(descriptor)
      const handle = lease.value as ObjectQueryHandle

      const view = document.createElement('sh-object-card-view') as ShObjectCardView
      view.tabIndex = 0
      view.status = handle.key ? 'loading' : 'empty'
      view.objectId = handle.key?.objectId ?? ''
      view.vocab = handle.key?.vocab ?? ''
      view.className_ = handle.key?.class ?? ''
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      if (handle.key) {
        // Keyed on `state.status`, never `state.read !== null` — `T` here
        // (`SourceObjectRead | null`) legitimately carries `null` as a
        // SUCCESSFUL read (EMPTY: the object does not exist), which is
        // structurally indistinguishable from "no read has landed yet" once
        // collapsed into a bare null check. `status` is the one honest
        // discriminator between the two.
        const applyState = (state: StoreState<SourceObjectRead | null>): void => {
          if (disposed) return
          view.dataset.resourceState = state.status
          switch (state.status) {
            case 'ready':
              applyRead(view, state.read, params)
              delete view.dataset.resourceStale
              return
            case 'error':
              view.status = 'error'
              view.error = state.error ?? 'Unable to load this resource.'
              delete view.dataset.resourceStale
              return
            default:
              view.status = 'loading'
          }
        }
        unsubscribe = observeSurfaceResourceStore(handle.store, applyState)
        await handle.store.refresh()
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
          // <sh-object-card-view>'s :host fills 100%/100% via CSS; the
          // interpreter already sized `target`. MUST NOT write layout state
          // (design §3.2) — no-op.
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

export type { ObjectCardField } from './object-card-view-element.js'
