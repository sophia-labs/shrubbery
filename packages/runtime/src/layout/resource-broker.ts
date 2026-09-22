/**
 * resource-broker.ts — the AUTHORITATIVE resource seam (design §4.1; Builder-1
 * task brief guard rail 1).
 *
 * `LayoutResourceBroker` is the concrete `ResourceBroker`: a small registry of
 * `ResourceAdapter`s (bootstrap-only, mirrors `FaceRegistry`'s closed-catalog
 * discipline) plus the ref-counting/sharing policy itself.
 *
 *   - `durable` adapters: the broker keeps exactly ONE live `value` per
 *     `resourceKey`, ref-counted across every outstanding lease of that key.
 *     `adapter.load` runs once, on the key's first acquire; `adapter.dispose`
 *     runs once, when the last lease of that key releases (LAY-009). Two
 *     concurrent `acquire()` calls for a brand-new key share ONE in-flight
 *     `load` (no duplicate loads, no lost ref-counts) — see `pendingLoads`.
 *   - `derived` adapters: ordinary adapters keep the original
 *     fresh-per-acquire behavior. Adapters that declare `retainForMs`
 *     instead materialize one keyed value (normally a reactive
 *     `ShrubberyStore`) shared by concurrent leases and retained warm for an
 *     idle window. The value still has no durable domain identity: retention
 *     is an execution/cache policy, not persistence.
 *
 * This broker does NOT reimplement any existing pool's key/refcount logic
 * (task brief: "REUSE the existing EditorRoomPool... do NOT duplicate its
 * key/refcount logic"). It ref-counts at a different, generic granularity —
 * "how many LAYOUT LEASES currently reference this resourceKey" — which a
 * future `hoja.document` adapter composes ON TOP OF, not instead of,
 * `EditorRoomPool`'s own attachment-id accounting: that adapter's `load`
 * would call `pool.acquire(roomKey)` and its `dispose` would call
 * `pool.release(roomKey)`, delegating the actual provider lifecycle to the
 * pool while this broker independently tracks how many LEAVES hold a lease.
 */
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import { resourceKeyTuple } from './resource-key.js'
import { SurfaceActivationQueue } from './surface-activation.js'
import type {
  DerivedResourceAdapter,
  DurableResourceAdapter,
  ResourceAdapter,
  ResourceBroker,
  ResourceBrokerDiagnostics,
  ResourceKey,
  ResourceLease,
  SurfaceActivationScheduler,
} from './types.js'

export class DuplicateResourceAdapterError extends Error {
  constructor(readonly adapterId: string) {
    super(`resource adapter '${adapterId}' is already registered`)
    this.name = 'DuplicateResourceAdapterError'
  }
}

/**
 * Thrown by `acquire` when the CALLER-NAMED `adapterId` (diff-review r2
 * WRONG: bound to `FaceRegistration.resourceAdapterId`, never guessed by
 * scanning `accepts()`) is not registered on this broker at all.
 */
export class UnknownResourceAdapterError extends Error {
  constructor(readonly adapterId: string) {
    super(`no resource adapter is registered under id '${adapterId}'`)
    this.name = 'UnknownResourceAdapterError'
  }
}

/**
 * Thrown by `acquire` when the CALLER-NAMED `adapterId` IS registered but its
 * OWN `accepts(locator)` rejects the locator — a face declaring the wrong
 * `resourceAdapterId` for its resource kind (a programming/registration
 * error caught here rather than silently handing back a mismatched lease).
 */
export class ResourceAdapterLocatorMismatchError extends Error {
  constructor(readonly adapterId: string, readonly locator: ResourceLocator) {
    super(`resource adapter '${adapterId}' does not accept locator kind '${locator.kind}'`)
    this.name = 'ResourceAdapterLocatorMismatchError'
  }
}

interface DurableEntry {
  value: unknown
  refCount: number
  readonly adapter: DurableResourceAdapter
}

interface RetainedDerivedEntry {
  readonly value: unknown
  refCount: number
  readonly adapter: DerivedResourceAdapter
  evictionTimer: ReturnType<typeof setTimeout> | null
  /** Scope teardown requested while this value was active or still computing. */
  retireOnIdle: boolean
}

export interface LayoutResourceBrokerOptions {
  /** One broker-owned activation budget shared by all of its reactive resources. */
  readonly activation?: SurfaceActivationScheduler
}

/** One failed `adapter.dispose()` call, retained for `takeDisposalErrors()`. */
export interface ResourceDisposalError {
  readonly key: ResourceKey
  readonly error: unknown
}

export class LayoutResourceBroker implements ResourceBroker {
  private readonly activation: SurfaceActivationScheduler
  private readonly adapters: ResourceAdapter[] = []
  private readonly durableEntries = new Map<ResourceKey, DurableEntry>()
  /** In-flight first-load promises, keyed by resourceKey — dedupes a concurrent double-acquire of a brand-new key. */
  private readonly pendingLoads = new Map<ResourceKey, Promise<DurableEntry>>()
  /** Optional retained-derived values. Ordinary derived adapters never enter this map. */
  private readonly retainedDerivedEntries = new Map<ResourceKey, RetainedDerivedEntry>()
  /** Concurrent first acquisition of one retained-derived key shares one compute. */
  private readonly pendingRetainedDerivedLoads = new Map<ResourceKey, Promise<RetainedDerivedEntry>>()
  /** Rotated whenever a host retires its session/auth scope. */
  private retainedEpoch = 0
  /** Outstanding disposals a test/caller can await deterministically via `settled()`. Never awaited internally — `release()` is a synchronous, non-blocking contract. */
  private readonly pendingDisposals = new Set<Promise<unknown>>()
  /** Failed disposals retained until drained by `takeDisposalErrors()` (diff-review r2 WRONG: "retain/report disposal errors"). */
  private readonly disposalErrors: ResourceDisposalError[] = []
  private outstandingLeaseCount = 0

  constructor(options: LayoutResourceBrokerOptions = {}) {
    this.activation = options.activation ?? new SurfaceActivationQueue()
  }

  /**
   * Run one adapter's `dispose(value, key)` as a NEVER-SYNCHRONOUSLY-THROWING
   * disposal (diff-review r2 WRONG: "lease release can still throw
   * synchronously ... such a throw aborts the outer disposal loop"). The
   * PREVIOUS shape was `Promise.resolve(adapter.dispose(value, key))` — that
   * still calls `adapter.dispose(...)` SYNCHRONOUSLY, as a plain function
   * call, BEFORE `Promise.resolve` ever sees a value; a synchronous throw
   * inside `dispose` therefore propagates straight out of `release()` itself,
   * past the `finally` block in `layout-interpreter.ts`'s
   * `teardownMountedLeaf` that calls `lease.release()` with no try/catch
   * around it — recreating the exact unretryable partial-cleanup failure the
   * interpreter's own `dispose()`/`pruneStale()` loops were hardened against.
   * Scheduling the CALL ITSELF inside `Promise.resolve().then(...)` defers it
   * to a microtask, so a synchronous throw becomes an ordinary promise
   * rejection — `release()` can never throw, full stop, regardless of
   * whether the adapter's `dispose` is sync-throwing, async-rejecting, or
   * well-behaved. Every disposal is tracked in `pendingDisposals` (for
   * `settled()`) and a rejection is retained in `disposalErrors` (for
   * `takeDisposalErrors()`) rather than silently swallowed.
   */
  private runDisposal(key: ResourceKey, dispose: () => void | Promise<void>): void {
    const disposal = Promise.resolve().then(dispose)
    this.pendingDisposals.add(disposal)
    disposal
      .catch((error: unknown) => {
        this.disposalErrors.push({ key, error })
      })
      .finally(() => {
        this.pendingDisposals.delete(disposal)
      })
  }

  registerAdapter(adapter: ResourceAdapter): void {
    if (this.adapters.some((existing) => existing.adapterId === adapter.adapterId)) {
      throw new DuplicateResourceAdapterError(adapter.adapterId)
    }
    if (
      adapter.shape === 'derived'
      && adapter.retainForMs !== undefined
      && (!Number.isFinite(adapter.retainForMs) || adapter.retainForMs < 0)
    ) {
      throw new Error(`resource adapter '${adapter.adapterId}' retainForMs must be a non-negative finite number`)
    }
    this.adapters.push(adapter)
  }

  /**
   * `adapterId` is REQUIRED (diff-review r2 WRONG: "the broker silently
   * selects the first adapter whose accepts() returns true"). The broker
   * looks up EXACTLY that registered adapter — never scans for the first one
   * whose `accepts()` happens to return true — then still calls that named
   * adapter's OWN `accepts(locator)` as a mismatch guard.
   */
  async acquire(locator: ResourceLocator, adapterId: string): Promise<ResourceLease> {
    const adapter = this.adapters.find((candidate) => candidate.adapterId === adapterId)
    if (!adapter) throw new UnknownResourceAdapterError(adapterId)
    if (!adapter.accepts(locator)) throw new ResourceAdapterLocatorMismatchError(adapterId, locator)
    return adapter.shape === 'durable'
      ? this.acquireDurable(adapter, locator)
      : adapter.retainForMs === undefined
        ? this.acquireDerived(adapter, locator)
        : this.acquireRetainedDerived(adapter, locator)
  }

  private async acquireDurable(adapter: DurableResourceAdapter, locator: ResourceLocator): Promise<ResourceLease> {
    // Namespaced by adapterId (diff-review r2 WRONG's own "namespace cache
    // keys by adapter identity" — the fix's second half): even though
    // `acquire()` now resolves an adapter by EXACT id rather than a
    // first-match scan, this Map is shared across every registered adapter.
    // Namespacing means two DIFFERENT adapters can never collide in
    // `durableEntries`/`pendingLoads` even if their own `resourceKey`
    // implementations ever happened to produce the same raw string for
    // logically different resources — the same collision-safety
    // `resource-key.ts` already gives individual faces, applied one level up.
    const key = resourceKeyTuple(adapter.adapterId, adapter.resourceKey(locator))
    let entry = this.durableEntries.get(key)
    if (!entry) {
      let inflight = this.pendingLoads.get(key)
      if (!inflight) {
        inflight = adapter.load(locator).then(
          (value) => {
            const fresh: DurableEntry = { value, refCount: 0, adapter }
            this.durableEntries.set(key, fresh)
            this.pendingLoads.delete(key)
            return fresh
          },
          (error: unknown) => {
            this.pendingLoads.delete(key)
            throw error
          },
        )
        this.pendingLoads.set(key, inflight)
      }
      entry = await inflight
    }
    entry.refCount += 1
    this.outstandingLeaseCount += 1

    let released = false
    const lease: ResourceLease = {
      key,
      shape: 'durable',
      value: entry.value,
      get released() {
        return released
      },
      release: (): void => {
        if (released) return
        released = true
        this.outstandingLeaseCount -= 1
        const current = this.durableEntries.get(key)
        if (!current) return // already fully released by a prior race; nothing to do (idempotent)
        current.refCount -= 1
        if (current.refCount <= 0) {
          this.durableEntries.delete(key)
          this.runDisposal(key, () => current.adapter.dispose(current.value, key))
        }
      },
    }
    return lease
  }

  private async acquireDerived(adapter: DerivedResourceAdapter, locator: ResourceLocator): Promise<ResourceLease> {
    // Namespaced by adapterId — see `acquireDurable`'s identical comment.
    // Derived leases are never shared/cached by key (no cross-caller
    // dedupe), but `key` is still reported on the lease/in diagnostics, so it
    // gets the same collision-safety treatment for consistency.
    const key = resourceKeyTuple(adapter.adapterId, adapter.resourceKey(locator))
    const value = await adapter.compute(locator, { activation: this.activation })
    this.outstandingLeaseCount += 1

    let released = false
    const lease: ResourceLease = {
      key,
      shape: 'derived',
      value,
      get released() {
        return released
      },
      release: (): void => {
        if (released) return
        released = true
        this.outstandingLeaseCount -= 1
        if (adapter.dispose) {
          this.runDisposal(key, () => adapter.dispose!(value, key))
        }
      },
    }
    return lease
  }

  /**
   * Retained-derived is the broker's background-store path: same key/in-flight
   * sharing discipline as durable resources, but the value may outlive its
   * last visible lease for an adapter-declared idle window. Query adapters use
   * this for reactive `ShrubberyStore` values; ordinary derived adapters omit
   * `retainForMs` and retain their original fresh-per-acquire behavior.
   */
  private async acquireRetainedDerived(
    adapter: DerivedResourceAdapter,
    locator: ResourceLocator,
  ): Promise<ResourceLease> {
    const key = resourceKeyTuple(adapter.adapterId, String(this.retainedEpoch), adapter.resourceKey(locator))
    let entry = this.retainedDerivedEntries.get(key)

    // The pre-existing isStale seam now has one conservative meaning: an idle
    // cached value may be replaced on a later acquire. Never split a value
    // while another live lease still observes it.
    if (entry && entry.refCount === 0 && adapter.isStale?.(entry.value, locator)) {
      this.evictRetainedDerived(key, entry)
      entry = undefined
    }

    if (!entry) {
      let inflight = this.pendingRetainedDerivedLoads.get(key)
      if (!inflight) {
        inflight = adapter.compute(locator, { activation: this.activation }).then(
          (value) => {
            const fresh: RetainedDerivedEntry = {
              value,
              refCount: 0,
              adapter,
              evictionTimer: null,
              retireOnIdle: false,
            }
            this.retainedDerivedEntries.set(key, fresh)
            this.pendingRetainedDerivedLoads.delete(key)
            return fresh
          },
          (error: unknown) => {
            this.pendingRetainedDerivedLoads.delete(key)
            throw error
          },
        )
        this.pendingRetainedDerivedLoads.set(key, inflight)
      }
      entry = await inflight
    }

    if (entry.evictionTimer !== null) {
      clearTimeout(entry.evictionTimer)
      entry.evictionTimer = null
    }
    entry.refCount += 1
    this.outstandingLeaseCount += 1

    let released = false
    const lease: ResourceLease = {
      key,
      shape: 'derived',
      value: entry.value,
      get released() {
        return released
      },
      release: (): void => {
        if (released) return
        released = true
        this.outstandingLeaseCount -= 1
        const current = this.retainedDerivedEntries.get(key)
        if (!current || current !== entry) return
        current.refCount -= 1
        if (current.refCount > 0) return
        if (current.retireOnIdle) {
          this.evictRetainedDerived(key, current)
          return
        }

        const retainForMs = Math.max(0, Math.trunc(adapter.retainForMs ?? 0))
        if (retainForMs === 0) {
          queueMicrotask(() => {
            const latest = this.retainedDerivedEntries.get(key)
            if (latest === current && latest.refCount === 0) {
              this.evictRetainedDerived(key, latest)
            }
          })
          return
        }
        current.evictionTimer = setTimeout(() => {
          const latest = this.retainedDerivedEntries.get(key)
          if (latest === current && latest.refCount === 0) {
            this.evictRetainedDerived(key, latest)
          }
        }, retainForMs)
      },
    }
    return lease
  }

  private evictRetainedDerived(key: ResourceKey, entry: RetainedDerivedEntry): void {
    if (this.retainedDerivedEntries.get(key) !== entry) return
    if (entry.evictionTimer !== null) clearTimeout(entry.evictionTimer)
    entry.evictionTimer = null
    this.retainedDerivedEntries.delete(key)
    if (entry.adapter.dispose) {
      this.runDisposal(key, () => entry.adapter.dispose!(entry.value, key))
    }
  }

  /**
   * Retire every retained value for session/scope teardown. Idle entries
   * leave immediately; active or still-computing entries leave on their last
   * release, so a race cannot repopulate a detached Surface.
   */
  clearRetained(): void {
    // New acquisitions enter a distinct namespace immediately, even while an
    // old scope still has live leases winding down.
    this.retainedEpoch += 1
    for (const [key, entry] of Array.from(this.retainedDerivedEntries)) {
      entry.retireOnIdle = true
      if (entry.refCount === 0) this.evictRetainedDerived(key, entry)
    }
    for (const [key, pending] of this.pendingRetainedDerivedLoads) {
      void pending.then(
        (entry) => {
          if (this.retainedDerivedEntries.get(key) !== entry) return
          entry.retireOnIdle = true
          if (entry.refCount === 0) this.evictRetainedDerived(key, entry)
        },
        () => {},
      )
    }
  }

  diagnostics(): ResourceBrokerDiagnostics {
    const durableRefCounts: Record<ResourceKey, number> = {}
    for (const [key, entry] of this.durableEntries) durableRefCounts[key] = entry.refCount
    const retainedDerivedRefCounts: Record<ResourceKey, number> = {}
    for (const [key, entry] of this.retainedDerivedEntries) {
      retainedDerivedRefCounts[key] = entry.refCount
    }
    return {
      durableRefCounts: Object.freeze(durableRefCounts),
      retainedDerivedRefCounts: Object.freeze(retainedDerivedRefCounts),
      outstandingLeases: this.outstandingLeaseCount,
      disposalErrorCount: this.disposalErrors.length,
    }
  }

  /**
   * Drain and return every disposal failure retained since the last call
   * (diff-review r2 WRONG: "retain/report disposal errors"). A caller that
   * never calls this simply accumulates an inspectable log — errors are
   * never silently dropped, but they also never re-throw on their own
   * (`release()` itself is a synchronous, non-throwing contract; see
   * `runDisposal`).
   */
  takeDisposalErrors(): readonly ResourceDisposalError[] {
    return this.disposalErrors.splice(0, this.disposalErrors.length)
  }

  /** Resolves once every disposal triggered so far has completed — deterministic hook for tests exercising an async `dispose`. */
  async settled(): Promise<void> {
    await this.activation.whenIdle()
    if (this.pendingRetainedDerivedLoads.size > 0) {
      await Promise.allSettled(Array.from(this.pendingRetainedDerivedLoads.values()))
    }
    while (this.pendingDisposals.size > 0) {
      await Promise.allSettled(Array.from(this.pendingDisposals))
    }
  }
}
