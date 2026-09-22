/** The closed-catalog, read-only Face for a graph-projected Jupyter cell. */

import type { StoreState } from '@shrubbery/nucleus'
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import {
  plainQueryBlockTermValue,
  type QueryBlockResult,
  type QueryBlockService,
} from '../../editor-services/query-block-service.js'
import './compute-cell-view-element.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
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
import type { ComputeCellOutputView, ComputeCellViewModel, ShComputeCellView } from './compute-cell-view-element.js'

export const COMPUTE_CELL_FACE_ID = 'compute.cell'
export const COMPUTE_CELL_ADAPTER_ID = 'compute.cell.graph-query'
export const COMPUTE_NS = 'http://sophia.ai/compute#'
const SERVICE_MAX_ROWS = 1
const SPARQL_IRIREF_PUNCTUATION = new Set(['<', '>', '"', '{', '}', '|', '^', '`', '\\'])

export interface ComputeCellParams {
  readonly graphId: string
}

export interface ComputeCellQueryHandle {
  readonly cellIri: string
  store(graphId: string): SurfaceResourceStore<QueryBlockResult>
}

function isComputeCellLocator(locator: ResourceLocator): boolean {
  return locator.kind === 'iri' && locator.iri.length > 0 && [...locator.iri].every(character => {
    const code = character.charCodeAt(0)
    return code > 0x20 && code !== 0x7f && !SPARQL_IRIREF_PUNCTUATION.has(character)
  })
}

function cellIriOf(locator: ResourceLocator): string {
  if (!isComputeCellLocator(locator) || locator.kind !== 'iri') {
    throw new Error(`compute.cell: expected a non-empty IRI locator (got '${locator.kind}')`)
  }
  return locator.iri
}

function computeCellQuery(cellIri: string): string {
  return `PREFIX comp: <${COMPUTE_NS}>
SELECT ?cellRef ?ordinal ?generation ?source ?status ?executionCount ?outputsJson
       ?startedAt ?completedAt ?durationMs ?cellDigest
WHERE {
  GRAPH ?g {
    <${cellIri}> a comp:ComputeCell ;
      comp:cellRef ?cellRef ;
      comp:ordinal ?ordinal ;
      comp:generation ?generation ;
      comp:source ?source ;
      comp:status ?status ;
      comp:outputsJson ?outputsJson ;
      comp:startedAt ?startedAt ;
      comp:completedAt ?completedAt ;
      comp:durationMs ?durationMs ;
      comp:cellDigest ?cellDigest .
    OPTIONAL { <${cellIri}> comp:executionCount ?executionCount . }
  }
}
LIMIT 1`
}

export function createComputeCellResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<ComputeCellQueryHandle> {
  return {
    adapterId: COMPUTE_CELL_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isComputeCellLocator,
    resourceKey(locator): ResourceKey {
      return resourceKeyTuple('compute-cell', cellIriOf(locator))
    },
    async compute(locator, context) {
      const cellIri = cellIriOf(locator)
      const stores = new Map<string, SurfaceResourceStore<QueryBlockResult>>()
      return {
        cellIri,
        store(graphId: string) {
          let store = stores.get(graphId)
          if (!store) {
            store = createSurfaceResourceStore(
              () => service.run(graphId, computeCellQuery(cellIri), SERVICE_MAX_ROWS),
              context,
            )
            stores.set(graphId, store)
          }
          return store
        },
      }
    },
  }
}

function parseInteger(result: QueryBlockResult, field: string): number {
  if (result.resultKind !== 'bindings') throw new Error('compute.cell requires a SELECT bindings result')
  const raw = plainQueryBlockTermValue(result.rows[0]?.[field])
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`compute.cell has an invalid ${field}`)
  return value
}

function parseOutputs(raw: string): readonly ComputeCellOutputView[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('compute.cell outputsJson is not valid JSON')
  }
  if (!Array.isArray(value)) throw new Error('compute.cell outputsJson must be an array')
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('compute.cell outputsJson contains a non-object output')
    }
    const kind = (entry as Record<string, unknown>).kind
    if (kind !== 'stream' && kind !== 'display' && kind !== 'result' && kind !== 'error') {
      throw new Error('compute.cell outputsJson contains an unknown output kind')
    }
  }
  return value as ComputeCellOutputView[]
}

export function computeCellFromResult(result: QueryBlockResult, cellIri: string): ComputeCellViewModel {
  if (result.resultKind !== 'bindings') throw new Error('compute.cell requires a SELECT bindings result')
  const row = result.rows[0]
  if (!row) throw new Error('compute.cell resource was not found')
  const required = (field: string): string => {
    const value = plainQueryBlockTermValue(row[field])
    if (!value) throw new Error(`compute.cell is missing ${field}`)
    return value
  }
  const status = required('status')
  if (status !== 'ok' && status !== 'error' && status !== 'aborted') {
    throw new Error('compute.cell has an invalid status')
  }
  const executionCountRaw = plainQueryBlockTermValue(row.executionCount)
  return {
    cellIri,
    cellRef: required('cellRef'),
    ordinal: parseInteger(result, 'ordinal'),
    generation: parseInteger(result, 'generation'),
    source: required('source'),
    status,
    ...(executionCountRaw ? { executionCount: parseInteger(result, 'executionCount') } : {}),
    outputs: parseOutputs(required('outputsJson')),
    startedAt: parseInteger(result, 'startedAt'),
    completedAt: parseInteger(result, 'completedAt'),
    durationMs: parseInteger(result, 'durationMs'),
    cellDigest: required('cellDigest'),
  }
}

function constraints(): LeafConstraints {
  return { minWidth: 320, minHeight: 180, overflow: 'clip' }
}

function params(descriptor: ViewDescriptor): ComputeCellParams {
  return (descriptor.params ?? {}) as unknown as ComputeCellParams
}

export function createComputeCellFace(): FaceRegistration {
  return {
    faceId: COMPUTE_CELL_FACE_ID,
    persistence: 'stamp',
    resourceAdapterId: COMPUTE_CELL_ADAPTER_ID,
    accepts: isComputeCellLocator,
    paramsSchema: closedParamsSchema({ graphId: { type: 'string' } }),
    constraints,
    async mount({ target, descriptor, lease }) {
      const handle = lease.value as ComputeCellQueryHandle
      const graphId = params(descriptor).graphId
      const view = document.createElement('sh-compute-cell-view') as ShComputeCellView
      view.status = 'loading'
      target.replaceChildren(view)

      let disposed = false
      const store = handle.store(graphId)
      const unsubscribe = observeSurfaceResourceStore(store, (state: StoreState<QueryBlockResult>) => {
        if (disposed) return
        view.dataset.resourceState = state.status
        if (state.read !== null) {
          try {
            view.cell = computeCellFromResult(state.read, handle.cellIri)
            view.status = 'ready'
            view.error = ''
          } catch (error) {
            view.status = 'error'
            view.error = error instanceof Error ? error.message : String(error)
          }
          return
        }
        if (state.status === 'error') {
          view.status = 'error'
          view.error = state.error ?? 'Unable to load this notebook cell.'
        }
      })
      await store.refresh()

      const faceView: FaceView = {
        focus() {
          view.focus()
          return true
        },
        blur() { view.blur() },
        resize() {},
        serialize() { return descriptor },
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
