/**
 * selection-bus.ts — the single reactive selection hub the edge-interpreter
 * publishes to and each `drivesSelection`/`reflects` target subscribes from.
 *
 * Semantic edge overlay, slice 1. This lifts Garden's implicit
 * "select event → currentInspectorSelection = … → rerender" coupling out of
 * imperative glue and into ONE reactive source: a source face's select event
 * publishes a `SelectedObject` tagged with its source face, and only targets of
 * edges from that face receive it. Global subscribers still observe every
 * selection so diagnostics such as the edge overlay remain a plain
 * `ReactiveSource` consumer.
 *
 * Identity currency is the EXISTING `SelectedObject` discriminated union
 * (selection.ts — graph/document/block/comment/folder/artifact variants), NOT
 * an RDF node IRI: panes speak bare strings (`mn-graph` `node.id` is a local
 * join-key), so the bus carries the shape the panes already exchange.
 *
 * Shape reuses `createWireModeController` (a `let state` + `Set<subscriber>` +
 * `emit()`) over the `ReactiveSource<T>` contract, adding `publish()`. The bus
 * is NOT a replacement for `let currentInspectorSelection` — `inspector.reflect`
 * is one ADDITIONAL writer alongside the deferred handlers that keep writing it
 * directly (a behavior-preserving two-write-path).
 *
 * Pure: no DOM, no stores, no network.
 */

import type { ReactiveSource } from './contract.js'
import type { SelectedObject } from './selection.js'

export interface SelectionBus extends ReactiveSource<SelectedObject | null> {
  /** Push an unattributed selection to global subscribers; `null` clears it. */
  publish(sel: SelectedObject | null): void
  /** Push a selection to global subscribers and subscribers scoped to `source`. */
  publishFrom(source: string, sel: SelectedObject | null): void
  /** Subscribe only to selections attributed to `source`. */
  subscribeFrom(source: string, cb: (value: SelectedObject | null) => void): () => void
}

/**
 * Create an in-memory selection bus seeded with `initial` (default `null` — no
 * selection). `get()` reflects the last publish; `subscribe(cb)` observes every
 * publication, while `subscribeFrom(source, cb)` observes only publications
 * attributed to that source.
 *
 * Each notification snapshots its subscriber set and captures the value being
 * delivered. A callback may therefore synchronously unsubscribe itself, install
 * a replacement, or publish another value without extending or changing the
 * in-flight delivery. This is load-bearing when a reflect callback rerenders the
 * shell and reinstalls the edge interpreter synchronously.
 */
export function createSelectionBus(
  initial: SelectedObject | null = null,
): SelectionBus {
  let state = initial
  const subscribers = new Set<(value: SelectedObject | null) => void>()
  const sourceSubscribers = new Map<string, Set<(value: SelectedObject | null) => void>>()

  const notify = (
    callbacks: readonly ((value: SelectedObject | null) => void)[],
    value: SelectedObject | null,
  ): void => {
    for (const cb of callbacks) cb(value)
  }

  const publish = (sel: SelectedObject | null, source?: string): void => {
    state = sel

    // Snapshot BOTH groups before invoking either. A global observer is allowed
    // to synchronously reinstall source-scoped routes without making the new
    // route part of this publication.
    const globalSnapshot = [...subscribers]
    const sourceSnapshot = source === undefined
      ? []
      : [...(sourceSubscribers.get(source) ?? [])]

    notify(globalSnapshot, sel)
    notify(sourceSnapshot, sel)
  }

  return {
    get: () => state,

    subscribe: (cb) => {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },

    subscribeFrom: (source, cb) => {
      let callbacks = sourceSubscribers.get(source)
      if (!callbacks) {
        callbacks = new Set()
        sourceSubscribers.set(source, callbacks)
      }
      callbacks.add(cb)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        callbacks.delete(cb)
        if (callbacks.size === 0 && sourceSubscribers.get(source) === callbacks) {
          sourceSubscribers.delete(source)
        }
      }
    },

    publish: (sel) => publish(sel),
    publishFrom: (source, sel) => publish(sel, source),
  }
}
