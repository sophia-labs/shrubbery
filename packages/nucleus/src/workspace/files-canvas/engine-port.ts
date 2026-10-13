/**
 * The engine port of the Files canvas.
 *
 * Functions over a plain scene snapshot: bounds, rectangle hit-tests, spatial neighbours,
 * snapping, drop targets, connector routing with label de-collision (from scratch, and
 * incrementally after a move), tidy layout, free-slot search, fit-camera. Nothing here owns
 * state the caller can see, and no engine identifier, element object or scene JSON crosses the
 * port in either direction (rule 1).
 *
 * Rule 2: memoisation is the caller's. The host builds one `SceneSnapshot` per input change
 * and holds it; an engine-backed implementation may cache a translation keyed on the snapshot's
 * object identity (a `WeakMap`), never on anything else. Every answer is for the snapshot it was
 * asked about, as that snapshot is now, whatever was asked before: a snapshot is immutable by contract,
 * but an engine whose scene is a mutable editor core (Excalidraw's is, and its hit-test memo is
 * process-global) must not let a cache outlive the move that invalidated it, and that includes a move
 * made to the snapshot itself, in place, by a host that patches one rather than rebuild it during a
 * drag. So a translation cached on the identity is revalidated against the cards' rects at each call (a
 * linear pass, no dearer than the question), or it is not used. The differential suite asks the same
 * object again after patching its cards where they stand, over connected and unconnected scenes (the
 * hit-test-after-move cases of the suite exist for exactly this).
 *
 * Rule 2b: a drag is bracketed by `prepareDrag` and `releaseDrag`, and the canvas by `dispose`. An engine that keeps drag state
 * (Excalidraw's snap cache is process-global: primed at pointer-down, cleared at pointer-up, one drag per realm) implements them.
 * The interaction reducer is pure and never calls them: it returns them as effects (`prepareDrag` when a press that can drag begins,
 * so the engine is primed before the first snap; `releaseDrag` however the press or the drag ends; `disposeEngine` on destroy), and
 * the host runs them against its engine before it delivers the next event (`runEngineEffects` in interaction.ts). Both bracket calls
 * are idempotent, a second `prepareDrag` replaces the first, and an engine without them, or called without them, primes for the call
 * itself.
 *
 * Rule 3: one contract, an engine-backed implementation as the default, ours for the gaps. Vera's
 * ruling of 2026-10-03 (V1) is Excalidraw-first: an Excalidraw-backed implementation
 * (`engine-excalidraw.ts`, wave 1b; `engine-default.ts` loads it) is the default behind this port, and Files' own code fills
 * only what Excalidraw does not provide (`ENGINE_OWNERSHIP` says which is which). `engine-house.ts`
 * implements all eleven functions in plain TypeScript: for the 'ours' functions it IS the
 * implementation; for the 'engine' functions it is a TEST STAND-IN, the subject the suite is shown
 * to pass and fail on until the Excalidraw-backed one lands, and the fallback after. The suite takes
 * an engine as a parameter (`__tests__/support/engine-suite.ts`), so the Excalidraw-backed
 * implementation is held to the same properties, and to the house on the functions where the two
 * must agree exactly (`compareEngines`).
 */
import type { FileKey, WorkspaceFileRef } from '../folder-view-contract.js'
import type { Camera, Pt, Rect, Size } from './geometry.js'

export type { FileKey } from '../folder-view-contract.js'
export type { Camera, Pt, Rect, Size } from './geometry.js'

/**
 * What a card on the plane stands for.
 *  - `real`  : a file or folder of the viewed folder.
 *  - `ghost` : a contested candidate position for a real file, drawn beside the real card.
 *  - `draft` : a folder being named before it exists.
 */
export type SceneCardRole = 'real' | 'ghost' | 'draft'

export interface SceneGhost {
  readonly candidateId: string
  readonly origin: 'this-tab' | 'other'
  readonly label: string
  readonly at: number
}

export interface SceneCard {
  /** Unique within a snapshot. Real: `fileKey(ref)`. Ghosts and drafts have derived keys (`ghostKey`, `draftKey`). */
  readonly key: FileKey
  readonly kind: 'folder' | 'file'
  readonly role: SceneCardRole
  /** The file a real or ghost card stands for; null for a draft. */
  readonly ref: WorkspaceFileRef | null
  /** The full name (the display string with a middle ellipsis comes from `labels.ts`). */
  readonly label: string
  /** Scene units; from the placement record, the chosen contested candidate, the draft, or an auto-slot. */
  readonly rect: Rect
  /** The glyph box, for routing to avoid. */
  readonly glyph: Rect
  /** False = auto-slotted, no placement record. */
  readonly placed: boolean
  /** Contested or pending elsewhere: cannot be dragged. Ghosts are always locked. */
  readonly locked: boolean
  readonly ghost: SceneGhost | null
  readonly draftId: string | null
}

export interface SceneConnector {
  readonly id: string
  readonly from: FileKey
  readonly to: FileKey
  readonly label: string
}

export interface SceneSnapshot {
  /** z-order = array order; the last card is topmost. */
  readonly cards: readonly SceneCard[]
  readonly byKey: ReadonlyMap<FileKey, SceneCard>
  readonly connectors: readonly SceneConnector[]
  /** From `iconSize`. */
  readonly cardSize: Size
  /** `snapToGrid ? grid step : null`. */
  readonly grid: number | null
  /** Width of the slot lattice for cards without a placement (the host may fit it to the pane). */
  readonly slotColumns: number
}

export interface SnapGuide {
  readonly axis: 'x' | 'y'
  /** The coordinate of the guide line on its axis. */
  readonly at: number
  /** Extent along the other axis, `from <= to`. */
  readonly from: number
  readonly to: number
}

export interface SnapResult {
  /** The delta to apply instead of the raw one. */
  readonly delta: Pt
  readonly guides: readonly SnapGuide[]
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface ConnectorPath {
  readonly id: string
  /** Orthogonal polyline in scene units, at least two points. */
  readonly points: readonly Pt[]
  readonly start: { readonly side: Side; readonly at: Pt }
  readonly end: { readonly side: Side; readonly at: Pt }
  /** On the path, after de-collision with the other labels. */
  readonly labelAnchor: Pt
}

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface CanvasEngine {
  /** The smallest rect holding every card, or null for an empty scene. */
  bounds(scene: SceneSnapshot): Rect | null
  /** Keys of the cards a rect touches (`intersect`) or holds (`contain`), in z-order. */
  hitRect(scene: SceneSnapshot, rect: Rect, mode: 'intersect' | 'contain'): readonly FileKey[]
  /** The card an arrow key moves focus to: a 90-degree cone, nearest first, falling back to reading order. */
  spatialNeighbor(scene: SceneSnapshot, from: FileKey, dir: Direction): FileKey | null
  /** Rows then columns: for Home/End, range selection and the accessible order. */
  readingOrder(scene: SceneSnapshot): readonly FileKey[]
  /** Alignment guides and optional grid snapping for a drag of `moving` by `delta`. */
  snap(scene: SceneSnapshot, moving: readonly FileKey[], delta: Pt, opts: { readonly threshold: number }): SnapResult
  /** A folder card under `at`, never one of `moving`; the topmost of overlapping folders. */
  dropTarget(scene: SceneSnapshot, moving: readonly FileKey[], at: Pt): FileKey | null
  /** Orthogonal routes for every connector whose endpoints are in the scene, with label anchors de-collided. */
  route(scene: SceneSnapshot, opts: { readonly pad: number }): ReadonlyMap<string, ConnectorPath>
  /**
   * What moving `moved` changes. `scene` is the snapshot after the move, `previous` the routes before it.
   *
   * The contract. For every connector touched by a moved card (an endpoint is a moved card, or it touches a card that such a
   * connector touches, so its attachment point on a shared side shifts) or newly blocked by one (a moved card has come to rest on
   * its previous route), `points`, `start` and `end` equal what `route(scene)` gives that connector: an engine keeps no history in a
   * route, and a blocked route is started again from the elbow, not mended where it was. Its `labelAnchor` need not equal the
   * from-scratch placement, because unchanged labels stay pinned where they were, for stability, and a recomputed label is
   * placed around them; but it must be a valid de-collided placement: no overlap with a card glyph or another connector's label,
   * and within the route's label region, a point of the connector's own route (`labelCandidates`). The labels it is placed
   * around are the kept ones, then the recomputed ones in id order; where the route has no free spot the least bad one is taken,
   * as `route` takes it (a glyph before another label).
   *
   * Every other connector keeps the very object it had in `previous`, so a host patches only what changed; one may still detour
   * round a card that has since gone, which is valid and merely longer than it need be. The result lists every connector of
   * `scene`, each attached to the edges it names, and none crosses a glyph box (as `route` guarantees, when cards do not overlap).
   * The suite holds an engine to all of this (`__tests__/support/reroute-contract.ts`).
   */
  reroute(scene: SceneSnapshot, moved: ReadonlySet<FileKey>, previous: ReadonlyMap<string, ConnectorPath>, opts: { readonly pad: number }): ReadonlyMap<string, ConnectorPath>
  /** A stable row-major grid in current reading order; only real, unlocked cards get a position. */
  tidy(scene: SceneSnapshot, opts: { readonly origin: Pt; readonly gap: number; readonly columns?: number }): ReadonlyMap<FileKey, Pt>
  /**
   * Where a new card goes. Without `region`: the first empty slot of the lattice in reading order at or after `near` (null: from the
   * first slot). With `region`, the part of the scene a person is looking at: the first empty cell wholly inside it, in reading order,
   * on the lattice's grid without its column bound (the same pitch and phase, so the card lines up with the ones the lattice laid
   * out), so the card is where they are looking even when that is beyond the lattice's columns; and when no cell inside is empty, the
   * empty cell that needs the smallest pan to be shown in full (never one above or left of the lattice's first cell and the view's
   * first row and column), so that revealing it moves the view as little as possible. `near` is not used with a region.
   */
  nextFreeSlot(scene: SceneSnapshot, near: Pt | null, gap: number, region?: Rect): Pt
  fitCamera(bounds: Rect, viewport: Size, inset: number, zoomMax: number): Camera

  /** Optional lifecycle (rule 2b): run by the host on the reducer's effects, never by the reducer. */
  prepareDrag?(scene: SceneSnapshot, moving: readonly FileKey[]): void
  releaseDrag?(): void
  /** The engine is done for good: release whatever it holds (timers, caches). */
  dispose?(): void
}

/**
 * Who is expected to implement each function once the Excalidraw-backed engine lands.
 *  - 'engine': Excalidraw has the capability, in the split packages `@excalidraw/{element,math,common}` pinned at
 *    0.18.0-4ce38fb (see SPIKE-headless-engine.md): `bounds` is `getCommonBounds`, `hitRect` and the engine's own
 *    picking are `hitElementItself` over a linear scan, `snap` is the vendored `snapping.ts` over a primed
 *    `SnapCache` (hence the drag lifecycle), `route` and `reroute` are bound arrows kept attached by
 *    `scene.mutateElement` + `updateBoundElements`. Files adds on top only what the engine lacks, and the house
 *    code for it is exported separately (`avoidObstacles`, `placeLabels` in engine-route.ts): obstacle avoidance
 *    (an engine route avoids only its own two bound shapes), label de-collision, facing-side policy.
 *  - 'ours': Excalidraw has nothing equivalent (drop-target semantics, focus navigation, reading order,
 *    tidy, free-slot search over the folder lattice, fit-camera under the clamped zoom).
 * The house implementations of the 'engine' functions are test stand-ins.
 */
export type EngineOwner = 'engine' | 'ours'
export const ENGINE_OWNERSHIP: Readonly<Record<Exclude<keyof CanvasEngine, 'prepareDrag' | 'releaseDrag' | 'dispose'>, EngineOwner>> = Object.freeze({
  bounds: 'engine', hitRect: 'engine', snap: 'engine', route: 'engine', reroute: 'engine',
  dropTarget: 'ours', spatialNeighbor: 'ours', readingOrder: 'ours', tidy: 'ours', nextFreeSlot: 'ours', fitCamera: 'ours',
})

/** The eleven functions of the port, for suites that must check an implementation is complete. */
export const CANVAS_ENGINE_FUNCTIONS = [
  'bounds', 'hitRect', 'spatialNeighbor', 'readingOrder', 'snap', 'dropTarget', 'route', 'reroute', 'tidy', 'nextFreeSlot', 'fitCamera',
] as const satisfies readonly (keyof CanvasEngine)[]
