import type { CanvasEngine } from '../../engine-port.js'
import { IDENTITY_CAMERA } from '../../geometry.js'

/**
 * An engine that answers every question with nothing: no bounds, no hits, no routes. It is the red
 * witness of the port suite (`FILES_CANVAS_ENGINE=naive`), proof that the suite can fail, and the base
 * the differential harness's self-test breaks on purpose.
 */
export const naiveEngine: CanvasEngine = {
  bounds: () => null,
  hitRect: () => [],
  spatialNeighbor: () => null,
  readingOrder: () => [],
  snap: (_scene, _moving, delta) => ({ delta, guides: [] }),
  dropTarget: () => null,
  route: () => new Map(),
  reroute: () => new Map(),
  tidy: () => new Map(),
  nextFreeSlot: () => ({ x: 0, y: 0 }),
  fitCamera: () => IDENTITY_CAMERA,
}
