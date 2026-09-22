/**
 * wire-mode-controller.ts — default in-memory WireModeController.
 *
 * The nucleus ships the canonical implementation so every shell composes the
 * same state machine; shells only inject the WireWriter on construction. A
 * shell that needs different storage (persisted across reloads, broadcast to
 * other tabs, etc.) is free to implement WireModeController itself, but this
 * default is correct for the single-tab in-process case (which is every shell
 * today).
 *
 * State machine:
 *   - INACTIVE (initial): view().isActive === false; all fields null.
 *   - ACTIVE: enter() sets source + config + activeHostId, isActive=true.
 *   - exit() returns to INACTIVE.
 *   - transferActiveHost() rebinds activeHostId without changing source/config.
 *   - enter() while ACTIVE replaces source + config + activeHostId (matches
 *     prod's Cmd+Shift+; behavior — re-opening the advanced menu mid-mode
 *     overrides the predicate / direction selection without exiting first).
 *   - commit() calls wire.create with direction-aware source/target swap and
 *     bidirectional flag, then exits on success. Throws on inactive.
 */

import type {
  WireCreateRequest,
  WireModeConfig,
  WireModeController,
  WireModeSource,
  WireModeTarget,
  WireModeView,
  WireWriter,
} from './contract.js'

const INACTIVE_VIEW: WireModeView = {
  isActive: false,
  source: null,
  config: null,
  activeHostId: null,
}

export interface CreateWireModeControllerOptions {
  /** The wire writer commit() delegates to. */
  readonly wire: WireWriter
}

export function createWireModeController(
  opts: CreateWireModeControllerOptions,
): WireModeController {
  let state: WireModeView = INACTIVE_VIEW
  const subscribers = new Set<(view: WireModeView) => void>()
  // True while a commit()'s wire.create is in flight. Guards against a second
  // commit (double Enter, or a repeated switcher target event) firing a
  // duplicate wire.create before the first resolves and resets state.
  let committing = false

  const emit = (): void => {
    for (const cb of subscribers) cb(state)
  }

  return {
    view: () => state,

    subscribe: (cb) => {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },

    enter: (source: WireModeSource, config: WireModeConfig, hostId: string): void => {
      state = { isActive: true, source, config, activeHostId: hostId }
      emit()
    },

    exit: (): void => {
      if (!state.isActive) return
      state = INACTIVE_VIEW
      emit()
    },

    transferActiveHost: (hostId: string): void => {
      if (!state.isActive) return
      if (state.activeHostId === hostId) return
      state = { ...state, activeHostId: hostId }
      emit()
    },

    commit: async (target: WireModeTarget): Promise<{ wireId: string }> => {
      if (!state.isActive || !state.source || !state.config) {
        throw new Error('WireModeController.commit(): wire mode is not active')
      }
      if (committing) {
        throw new Error('WireModeController.commit(): a commit is already in flight')
      }
      committing = true
      // Capture the source we are committing for. If enter() replaces the
      // session or exit() clears it while wire.create is in flight, the
      // post-await finalize must NOT clobber the new/cleared state — it would
      // either stomp a replaced session (the Mod-Shift-; re-open-mid-commit
      // path) or double-emit a teardown exit() already fired.
      const committedSource = state.source
      try {
        const { predicate, direction } = state.config
        const bidirectional = direction === 'bidirectional'
        const swap = direction === 'reverse'
        const apiSource = swap ? target : state.source
        const apiTarget = swap ? state.source : target
        const params: WireCreateRequest = {
          sourceDocumentId: apiSource.documentId,
          targetDocumentId: apiTarget.documentId,
          targetGraphId: apiTarget.graphId,
          bidirectional,
          predicate,
          ...(apiSource.blockId ? { sourceBlockId: apiSource.blockId } : {}),
          ...(apiTarget.blockId ? { targetBlockId: apiTarget.blockId } : {}),
        }
        // Cross-graph wires are not a supported product feature, so apiSource
        // and apiTarget always share a graph in practice; wire.create routes to
        // that one graph's workspace. (If cross-graph reverse is ever supported,
        // revisit which workspace materializes a swapped wire — Vera's call.)
        const result = await opts.wire.create(apiSource.graphId, params)
        if (state.source === committedSource) {
          state = INACTIVE_VIEW
          emit()
        }
        return result
      } finally {
        committing = false
      }
    },
  }
}
