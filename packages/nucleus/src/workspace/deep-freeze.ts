/**
 * deepFreeze — recursively Object.freeze an object graph.
 *
 * The live-config substrate (mutations, session-store sync) and the generated
 * GARDEN_DEFAULT all need the same recursive freeze. GARDEN_DEFAULT and
 * GARDEN_VARIANT each ship a private copy (they are generated / fixture files
 * that must stand alone); this is the shared util for hand-written runtime code.
 *
 * Pure: no DOM, no stores. Idempotent (re-freezing a frozen graph is a no-op).
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj as object)) {
    const val = (obj as Record<string, unknown>)[key]
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val)
    }
  }
  return obj
}
