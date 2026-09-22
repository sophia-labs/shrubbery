/**
 * immutable.ts — deep-freeze / deep-clone helpers enforcing structural
 * immutability for constructed `LayoutDocument`s and their leaf descriptors
 * (design §9.2 Phase 1 diff-review r1: "Every exported interface is
 * structurally frozen" was claimed by types.ts's header comment but never
 * actually implemented anywhere — a probe found the returned document, its
 * `nodes` map, and leaf descriptors all mutable, and mutating a CALLER's
 * original descriptor object after a successful operation silently corrupted
 * the "immutable" result because the leaf stored a live reference to it).
 *
 * `deepFreeze` mirrors workspace/deep-freeze.ts's existing idiom exactly
 * (recursive, `Object.isFrozen`-guarded so re-freezing is a cheap no-op) —
 * re-implemented here rather than imported so Phase 1 stays a self-contained
 * module family with no imports outside `src/layout/*.ts` (per the handoff's
 * scope boundary).
 *
 * `deepCloneJsonValue` clones a value that has ALREADY PASSED
 * validate.ts's closed/serializable shape check (`isClosedSerializableValue`)
 * — every caller here only clones AFTER that check, so it never has to reject
 * functions, class instances, or cycles itself; it just walks plain
 * arrays/objects/primitives.
 *
 * Pure: no DOM, no stores, no Y.js, no network.
 */

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key]
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child)
    }
  }
  return value
}

/**
 * Define an OWN data property named `key` on `target`, unconditionally —
 * never through [[Set]]. Builder P1 hardening (recheck, discovered via the
 * operations.ts `swap_nodes`/`toString` regression test's `__proto__`
 * sibling case): a genuinely ordinary JSON key such as `"__proto__"` (a
 * perfectly legal node id — `{"__proto__": {"kind":"leaf",...}}` round-trips
 * through `JSON.parse` as an own property, since `JSON.parse` itself uses
 * `CreateDataProperty` semantics) is squarely IN this module family's pinned
 * threat model (JSON-shaped input, not exotic in-process forgery) — but a
 * PLAIN bracket assignment in a loop, `clone[key] = value`, is a [[Set]]
 * operation, not [[DefineOwnProperty]]: when `key === '__proto__'` and
 * `clone` (a fresh `{}`) has no OWN `__proto__` property yet, [[Set]] walks
 * the prototype chain, finds `Object.prototype`'s inherited `__proto__`
 * ACCESSOR, and invokes its setter — which reparents `clone` to `value`
 * instead of creating an own key at all. The clone then silently loses that
 * entry (it becomes `clone`'s prototype, not an enumerable own property) and
 * gains `Object.getPrototypeOf(clone) !== Object.prototype`, which fails
 * `isPlainObject` downstream — turning a VALID document into one that spuriously
 * fails `LAY000_INVALID_NODES_MAP`. `Object.defineProperty` always performs
 * [[DefineOwnProperty]], which is immune to inherited accessors regardless of
 * the key's name — used everywhere this module builds a fresh object one key
 * at a time instead of via an object-literal spread (which is ALSO immune,
 * since `{...x, [k]: v}`'s computed property is defined via
 * `CreateDataPropertyOrThrow`, not [[Set]] — only a later, separate
 * assignment statement is the unsafe form).
 */
function defineOwnDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

/**
 * Recursively freeze `value` WITHOUT ever mutating an object the CALLER may
 * still hold a live, mutable reference to (Builder P1 hardening, finding 2:
 * "applyOperation deep-freezes node values still reachable from the caller's
 * mutable input graph — a pure reducer must NOT freeze caller-owned
 * objects"). `deepFreeze` above is safe ONLY when every object it will touch
 * is either already-frozen or was freshly built by this module family (never
 * aliased from caller state) — `createValidatedLayoutDocument` guarantees
 * that by cloning first. `operations.ts`'s `finalizeCandidate` candidate is
 * NOT that: a candidate's `nodes` map is a fresh spread, but most of its
 * VALUES (every node an operation did not touch this step) are the SAME
 * object references as the caller-supplied input `doc.nodes[id]` — calling
 * `Object.freeze` directly on those, as `deepFreeze` does, mutates (freezes)
 * whatever object graph the caller still owns, an observable side effect a
 * pure reducer must never have.
 *
 * This function is the fix: any subtree that is not ALREADY frozen is
 * deep-cloned first, and the FROZEN CLONE — never the original — is what
 * ends up reachable from the return value; an already-frozen subtree is
 * reused by reference as-is (re-freezing it is a no-op, and because it is
 * frozen nothing can be mutating it out from under us, so aliasing it is
 * exactly the "untouched node keeps its identity" contract LAY-002 already
 * relies on).
 *
 * This keeps the common case cheap: once a document has been through this
 * function once (or through `createValidatedLayoutDocument`), every
 * untouched node is already frozen, so a SUBSEQUENT `applyOperation` call
 * clones+freezes only the handful of nodes it actually changed — it never
 * re-walks or re-clones the whole tree. The clone cost only shows up on a
 * genuinely un-frozen input (e.g. the very first operation applied to a
 * hand-built document that never went through `createValidatedLayoutDocument`),
 * bounded by that document's own size, not by how many operations have run.
 */
export function freezeWithoutMutatingOwner<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeWithoutMutatingOwner(item))) as unknown as T
  }
  const clone: Record<string, unknown> = {}
  for (const key of Object.keys(value as object)) {
    defineOwnDataProperty(clone, key, freezeWithoutMutatingOwner((value as Record<string, unknown>)[key]))
  }
  return Object.freeze(clone) as T
}

/**
 * Structurally clone a plain JSON-shaped value (string / finite number /
 * boolean / null, a plain array of such, or a plain object of such,
 * recursively). ONLY ever call this on a value already proven closed by
 * validate.ts's `isClosedSerializableValue` (or a `ViewDescriptor` /
 * `LayoutDocument`, both of which are themselves closed/plain by
 * construction once validated) — it does not itself re-check.
 */
export function deepCloneJsonValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneJsonValue(item)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as object)) {
    defineOwnDataProperty(out, key, deepCloneJsonValue((value as Record<string, unknown>)[key]))
  }
  return out as T
}
