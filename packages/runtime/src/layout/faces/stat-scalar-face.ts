/**
 * stat-scalar-face.ts — the `stat.scalar` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4).
 *
 * Wraps the SAME PRODUCTION `QueryBlockService` `sparql.bindings-table` wraps
 * (`../../editor-services/query-block-service.js`, over a REAL `RestClient`)
 * — this module adds NO query execution logic of its own. What's different
 * from `sparql.bindings-table` is the resource shape: this face carries a
 * `refreshSeconds` param, so its resource adapter
 * (`query-handle-resource-adapter.ts`) hands back a retained reactive store
 * rather than a frozen `QueryBlockResult`. `mount()` observes the warm
 * snapshot immediately, requests the first refresh through the Surface
 * activation queue, then owns its own poll cadence.
 *
 * Resource locator: `{ kind: 'query', graphId, queryId }` — `queryId` IS the
 * raw SPARQL text for v1, exactly as `sparql.bindings-table` documents (no
 * named/persisted query registry exists yet).
 */
import type { ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import { plainQueryBlockTermValue, type QueryBlockResult, type QueryBlockService } from '../../editor-services/query-block-service.js'
// Side-effect import: registers the <sh-stat-scalar-view> custom element.
import './stat-scalar-view-element.js'
import type { ShStatScalarView, StatDeltaDirection, StatDeltaTone } from './stat-scalar-view-element.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
} from '../types.js'
import { createQueryHandleResourceAdapter, isQueryLocator, type QueryHandle } from './query-handle-resource-adapter.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import { observeSurfaceResourceStore } from '../resource-store.js'

export const STAT_SCALAR_FACE_ID = 'stat.scalar'
const STAT_SCALAR_ADAPTER_ID = 'stat.scalar.query-handle'

export type StatScalarFormat = 'number' | 'usd' | 'ms' | 'dateTimeRelative'
export type StatScalarDeltaFormat = 'number' | 'percent'
export type StatScalarDeltaGoodDirection = 'up' | 'down'

export interface StatScalarParams {
  readonly label: string
  readonly unit?: string
  readonly format?: StatScalarFormat
  readonly refreshSeconds?: number
  /**
   * The name of a SECOND bound SPARQL variable in the SAME first row as the
   * scalar value — e.g. `SELECT ?v ?delta WHERE {...}`. Absent (the default)
   * means "this query offers no delta"; the delta chip slot then simply does
   * not render (design note: honest absence, never a fabricated "+0").
   */
  readonly deltaColumn?: string
  readonly deltaFormat?: StatScalarDeltaFormat
  /**
   * Which direction of change counts as "good" for the RESERVED status tone
   * (dataviz non-negotiable: status colors are reserved, paired with an
   * icon/label, never color-alone). Defaults to 'up' — most counters read
   * "more is better" — a caller tracking e.g. an error rate sets 'down'.
   */
  readonly deltaGoodDirection?: StatScalarDeltaGoodDirection
  /**
   * The name of a bound SPARQL variable read across EVERY row of the result
   * (in the query's own row order — the author's `ORDER BY`, never
   * reordered here) to build the sparkline slot. Absent means "this query
   * offers no series"; fewer than 2 finite points also renders no sparkline
   * (a single point has no trend to draw).
   */
  readonly seriesColumn?: string
}

/** Thin wrapper over the shared query-handle adapter, under this face's own adapter id (see that module's header). */
export function createStatScalarResourceAdapter(service: QueryBlockService, resolver: QueryTextResolver): DerivedResourceAdapter<QueryHandle> {
  return createQueryHandleResourceAdapter(STAT_SCALAR_ADAPTER_ID, service, resolver)
}

/** Relative-time formatting (Intl-based, no invented calendar math) for `format: 'dateTimeRelative'`. */
function formatRelativeTime(date: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 60) return rtf.format(diffSeconds, 'second')
  const diffMinutes = Math.round(diffSeconds / 60)
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day')
  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month')
  return rtf.format(Math.round(diffMonths / 12), 'year')
}

/**
 * Pure — exported for unit testing. `raw` is already the plain display text
 * `formatQueryBlockTerm` produced for the first bound term; an unparseable
 * `raw` for a numeric/date format falls back to the raw text itself (honest,
 * never a fabricated "0" or "Invalid Date").
 */
export function formatStatScalarValue(raw: string, format: StatScalarFormat | undefined, now: Date = new Date()): string {
  if (format === 'usd') {
    const n = Number(raw)
    return Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : raw
  }
  if (format === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : raw
  }
  if (format === 'ms') {
    const n = Number(raw)
    return Number.isFinite(n) ? `${new Intl.NumberFormat('en-US').format(n)} ms` : raw
  }
  if (format === 'dateTimeRelative') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? raw : formatRelativeTime(date, now)
  }
  return raw
}

/**
 * Pure — exported for unit testing. `raw` is the delta term's PLAIN lexical
 * value (`plainQueryBlockTermValue`'s output). An unparseable delta falls
 * back to the raw text itself — honest, mirrors `formatStatScalarValue`'s
 * own "never a fabricated value" rule.
 */
export function formatStatDeltaValue(raw: string, format: StatScalarDeltaFormat | undefined): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const magnitude = new Intl.NumberFormat('en-US', { maximumFractionDigits: format === 'percent' ? 1 : 2 }).format(
    Math.abs(n),
  )
  const suffix = format === 'percent' ? '%' : ''
  if (n > 0) return `+${magnitude}${suffix}`
  if (n < 0) return `-${magnitude}${suffix}`
  return `${magnitude}${suffix}`
}

/** Pure — exported for unit testing. Zero (or unparseable) is honestly 'flat', never guessed as up/down. */
export function deriveStatDeltaDirection(raw: string): StatDeltaDirection {
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

/**
 * Pure — exported for unit testing. Draws ONLY from the reserved
 * good/bad/neutral status set — never a categorical series color (dataviz
 * non-negotiable). 'flat' is always 'neutral': a genuinely unchanged value
 * is not "good" or "bad" on its own.
 */
export function deriveStatDeltaTone(direction: StatDeltaDirection, goodDirection: StatScalarDeltaGoodDirection): StatDeltaTone {
  if (direction === 'flat') return 'neutral'
  return direction === goodDirection ? 'good' : 'bad'
}

export type StatScalarReading =
  | { readonly kind: 'value'; readonly raw: string }
  | { readonly kind: 'no-data' }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Pure — exported for unit testing. Classifies a real `QueryBlockResult` into
 * the THREE honest outcomes a scalar card can have. A query that matched
 * NOTHING is not the number zero: `plainQueryBlockTermValue(undefined)` is `''`
 * and `Number('')` is `0`, so before this function every empty Observatory
 * query painted a confident "0" / "$0.00" / "0 ms". Absence is now its own
 * state, distinguishable at the face boundary.
 */
export function statScalarReading(result: QueryBlockResult): StatScalarReading {
  if (result.resultKind === 'serialized') {
    return { kind: 'error',
      message: `stat.scalar only renders SELECT/ASK results (got a ${result.resultKind} result)` }
  }
  const column = result.columns[0]
  if (column === undefined) return { kind: 'no-data' }
  const row = result.rows[0]
  if (row === undefined) return { kind: 'no-data' }
  const term = row[column]
  if (term === undefined) return { kind: 'no-data' }
  return { kind: 'value', raw: plainQueryBlockTermValue(term) }
}

function statScalarConstraints(): LeafConstraints {
  return { minWidth: 160, minHeight: 96, overflow: 'clip' }
}

function statScalarParams(descriptor: ViewDescriptor): StatScalarParams {
  // paramsSchema already validated shape/types (label required) before
  // mount() is ever called (face-registry.ts's `validate` gate) — the cast
  // mirrors sparql-bindings-table-face.ts's own `displayMaxRows` idiom.
  return (descriptor.params ?? {}) as unknown as StatScalarParams
}

/**
 * The `stat.scalar` `FaceRegistration`. `mount()` installs the shell and
 * observes the retained store before awaiting its first queued refresh.
 * When `refreshSeconds` is positive it owns a real `setInterval` poll that
 * refreshes the SAME store and updates the SAME live view in place.
 * `refreshSeconds` absent or `<= 0` means load-once.
 *
 * A result that binds NOTHING lands in the `no-data` status, never a
 * formatted zero — see `statScalarReading`.
 */
export function createStatScalarFace(): FaceRegistration {
  return {
    faceId: STAT_SCALAR_FACE_ID,
    // A single formatted number; cheap to recompute, nothing local worth
    // protecting across a relocate (same classification as sparql.bindings-table).
    persistence: 'stamp',
    resourceAdapterId: STAT_SCALAR_ADAPTER_ID,
    accepts: isQueryLocator,
    paramsSchema: closedParamsSchema({
      label: { type: 'string' },
      unit: { type: 'string', optional: true },
      format: { type: 'enum', values: ['number', 'usd', 'ms', 'dateTimeRelative'], optional: true },
      refreshSeconds: { type: 'number', optional: true },
      deltaColumn: { type: 'string', optional: true },
      deltaFormat: { type: 'enum', values: ['number', 'percent'], optional: true },
      deltaGoodDirection: { type: 'enum', values: ['up', 'down'], optional: true },
      seriesColumn: { type: 'string', optional: true },
    }),
    constraints: statScalarConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = statScalarParams(descriptor)
      const store = lease.value as QueryHandle

      const view = document.createElement('sh-stat-scalar-view') as ShStatScalarView
      view.tabIndex = 0
      view.label = params.label
      view.status = 'loading'
      target.replaceChildren(view)

      let disposed = false
      let timer: ReturnType<typeof setInterval> | null = null

      const applyResult = (result: QueryBlockResult): void => {
        const reading = statScalarReading(result)
        if (reading.kind === 'error') {
          // CONSTRUCT/DESCRIBE is not a scalar — an honest error, not a
          // fabricated number (mirrors sparql.bindings-table's own
          // resultKind guard).
          view.status = 'error'
          view.error = reading.message
          return
        }
        if (reading.kind === 'no-data') {
          // A query that matched NOTHING — clear every derived slot so a
          // stale value from a previous poll tick cannot survive under an
          // absence (statScalarReading's own header: absence is not zero).
          view.value = ''
          view.unit = ''
          view.delta = null
          view.series = []
          view.status = 'no-data'
          return
        }
        // reading.kind === 'value' here — `statScalarReading` only returns
        // 'error' for a serialized result, so this re-derives that same
        // narrowing on `result` itself (needed below for the delta/series
        // reads, which the reading's own shape doesn't carry).
        if (result.resultKind === 'serialized') return
        const raw = reading.raw
        view.value = formatStatScalarValue(raw, params.format)
        // The unit rides SEPARATE from the hero numeral now — "set apart"
        // (brief) means its own typographic slot, not string concatenation.
        view.unit = params.unit ?? ''

        const deltaColumn = params.deltaColumn
        const deltaTerm = deltaColumn ? result.rows[0]?.[deltaColumn] : undefined
        const deltaRaw = deltaTerm ? plainQueryBlockTermValue(deltaTerm) : ''
        if (deltaColumn && deltaRaw !== '') {
          const direction = deriveStatDeltaDirection(deltaRaw)
          const tone = deriveStatDeltaTone(direction, params.deltaGoodDirection ?? 'up')
          view.delta = { text: formatStatDeltaValue(deltaRaw, params.deltaFormat), direction, tone }
        } else {
          // Honest absence — no deltaColumn configured, or this row didn't
          // bind it (e.g. an OPTIONAL that missed) — never a fabricated "+0".
          view.delta = null
        }

        const seriesColumn = params.seriesColumn
        view.series = seriesColumn
          ? result.rows
              .map((row) => Number(plainQueryBlockTermValue(row[seriesColumn])))
              .filter((n) => Number.isFinite(n))
          : []

        view.status = 'ready'
      }

      const applyState = (state: StoreState<QueryBlockResult>): void => {
        if (disposed) return
        view.dataset.resourceState = state.status
        if (state.read !== null) {
          applyResult(state.read)
          if (state.status === 'ready') delete view.dataset.resourceStale
          else view.dataset.resourceStale = 'true'
          return
        }
        delete view.dataset.resourceStale
        if (state.status === 'error') {
          view.status = 'error'
          view.error = state.error ?? 'Unable to load this resource.'
        } else {
          view.status = 'loading'
        }
      }
      const unsubscribe = observeSurfaceResourceStore(store, applyState)

      const runOnce = async (): Promise<void> => {
        if (disposed) return
        await store.refresh()
      }

      await runOnce()

      const refreshSeconds = params.refreshSeconds
      if (typeof refreshSeconds === 'number' && refreshSeconds > 0) {
        timer = setInterval(() => void runOnce(), Math.max(1, refreshSeconds) * 1000)
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
          // <sh-stat-scalar-view>'s :host fills 100%/100% via CSS; the
          // interpreter already sized `target`. MUST NOT write layout state
          // (design §3.2) — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          if (timer !== null) clearInterval(timer)
          unsubscribe()
          view.remove()
        },
      }
      return faceView
    },
  }
}
