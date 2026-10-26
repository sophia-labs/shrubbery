/**
 * bench-dashboard-face.ts — the `bench.dashboard` face (la Lente, 2026-10-25): the `perf` ledger graph as a layout leaf.
 *
 * Mounting. This is the graph-authored-fragment mechanism that already carries the Observatory (docs/design/
 * surface-unification.md): a graph's `:ux:config` declares a center region rendered by `sh-layout-dashboard`
 * with a `sux:fragmentSurface`, and a `ux:layoutJson` literal on that surface names faces from THIS closed catalogue
 * (`fragment-face-set.ts`). `bench.dashboard` joins the catalogue; `apps/organism/seeds/perf-workspace.ux.nt`
 * is the seed a graph named `perf` needs.
 *
 * Resource locator: `{kind:'graph', graphId}` (the ledger graph; a `subjectIri` is ignored). No params.
 * The adapter takes the production `QueryBlockService` (the seam every query-backed face reads through) and hands the
 * face a handle; the dashboard element does its own reads with the fixed, GRAPH-wrapped SPARQL of bench-model.ts.
 * Writes nothing.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import { resourceKeyTuple } from '../resource-key.js'
import { DEFAULT_SURFACE_RESOURCE_RETENTION_MS } from '../resource-store.js'
import {
  noFaceParams,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import './bench-dashboard-element.js'
import type { ShBenchDashboard } from './bench-dashboard-element.js'

export const BENCH_DASHBOARD_FACE_ID = 'bench.dashboard'
export const BENCH_DASHBOARD_ADAPTER_ID = 'bench.dashboard.ledger'

/** What the face receives from its adapter: the read seam and the ledger graph's id. */
export interface BenchLedgerHandle {
  readonly graphId: string
  readonly service: QueryBlockService
}

export function isBenchLedgerLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'graph' }> {
  return locator.kind === 'graph' && locator.graphId.length > 0
}

function benchResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isBenchLedgerLocator(locator)) {
    throw new Error(`bench.dashboard: resource adapter given an unexpected locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('bench-ledger', locator.graphId)
}

export function createBenchDashboardResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<BenchLedgerHandle> {
  return {
    adapterId: BENCH_DASHBOARD_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isBenchLedgerLocator,
    resourceKey: benchResourceKey,
    async compute(locator) {
      if (!isBenchLedgerLocator(locator)) throw new Error('unreachable: resourceKey already validated the kind')
      return { graphId: locator.graphId, service }
    },
  }
}

function benchConstraints(): LeafConstraints {
  return { minWidth: 480, minHeight: 320, overflow: 'scroll' }
}

export function createBenchDashboardFace(): FaceRegistration {
  return {
    faceId: BENCH_DASHBOARD_FACE_ID,
    // The dashboard re-reads the ledger when it mounts; nothing in it is worth protecting across a relocate.
    persistence: 'stamp',
    resourceAdapterId: BENCH_DASHBOARD_ADAPTER_ID,
    accepts: isBenchLedgerLocator,
    paramsSchema: noFaceParams,
    constraints: benchConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const handle = lease.value as BenchLedgerHandle
      const view = document.createElement('sh-bench-dashboard') as ShBenchDashboard
      view.tabIndex = 0
      view.graphId = handle.graphId
      view.service = handle.service
      target.replaceChildren(view)

      let disposed = false
      const faceView: FaceView = {
        focus() {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // The element fills its box with CSS; the interpreter already sized `target`. Writes no layout state.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          view.remove()
        },
      }
      return faceView
    },
  }
}
