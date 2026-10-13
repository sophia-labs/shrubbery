import type { CanvasEngine, FileKey, SceneSnapshot } from '../../engine-port.js'
import { houseEngine } from '../../engine-house.js'

export interface PrimedEngine extends CanvasEngine {
  /** Every lifecycle call, in order, with the moving set it was given. */
  readonly calls: string[]
  isPrimed(): boolean
}

/**
 * An engine with the one constraint of Excalidraw's snapping that matters to the reducer: its reference points live
 * in a process-global cache that must be primed at the start of a drag and cleared at the end, and unprimed it snaps to
 * nothing. Everything else is the house engine. It is a real engine with a real constraint, not a mock: the suite uses
 * it to prove the reducer primes before the first snap and releases however a drag ends.
 */
/** What a primed cache is valid for: where every card is. (A host keeps one snapshot per input change; a test host rebuilds one per event.) */
const geometryOf = (scene: SceneSnapshot): string => scene.cards.map((c) => `${c.key}:${c.rect.x},${c.rect.y}`).join('|')

export function primedSnapEngine(base: CanvasEngine = houseEngine): PrimedEngine {
  let primed: { geometry: string; moving: ReadonlySet<FileKey> } | null = null
  const calls: string[] = []
  return {
    ...base,
    calls,
    isPrimed: () => primed !== null,
    prepareDrag(scene, moving) { calls.push(`prepare:${[...moving].sort().length}`); primed = { geometry: geometryOf(scene), moving: new Set(moving) } },
    releaseDrag() { calls.push('release'); primed = null },
    dispose() { calls.push('dispose'); primed = null },
    snap(scene, moving, delta, opts) {
      // Primed for this layout and this moving set, or no snapping at all.
      const ready = primed && primed.geometry === geometryOf(scene) && moving.length === primed.moving.size && moving.every((k) => primed!.moving.has(k))
      return ready ? base.snap(scene, moving, delta, opts) : { delta, guides: [] }
    },
  }
}
