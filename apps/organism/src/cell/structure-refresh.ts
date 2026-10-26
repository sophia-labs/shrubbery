/**
 * What the shell does about `mn-editor-structure-change` (typing, caret moves,
 * mount). It used to run a whole-shell render 140 ms after every typing pause.
 * The only things in the shell that follow the document as it is typed are:
 *
 * - the heading list (pane-header TOC trigger and dropdown, outline panel),
 * - the document graph panel, when open,
 * - the word/character count in the bottom bar.
 *
 * So: a full render only when the headings changed (or the graph panel is
 * open), and otherwise just the bottom-bar count, set directly. Selection-only
 * events keep their old rule (render at 0 ms if the outline or graph panel is
 * open).
 */
export type StructureChangeReason = 'mounted' | 'transaction' | 'selection'

export interface StructureRefreshPorts {
  graphWantsRefresh(): boolean
  outlineWantsRefresh(): boolean
  /** The whole-shell render (`rerenderCurrentSource`). */
  fullRender(): void
  /** Update just the document statistics in the bottom bar. */
  refreshStats(): void
}

export interface StructureRefreshTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const STRUCTURE_REFRESH_DEBOUNCE_MS = 140

const defaultTimers: StructureRefreshTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface StructureRefresher {
  handle(reason: StructureChangeReason, headingsChanged: boolean): void
  cancel(): void
}

export function createStructureRefresher(
  ports: StructureRefreshPorts,
  timers: StructureRefreshTimers = defaultTimers,
): StructureRefresher {
  let timer: unknown = null
  let pendingFull = false
  let pendingStats = false

  const run = (): void => {
    timer = null
    const full = pendingFull
    const stats = pendingStats
    pendingFull = false
    pendingStats = false
    if (full) ports.fullRender()
    else if (stats) ports.refreshStats()
  }

  return {
    handle(reason, headingsChanged) {
      const graph = ports.graphWantsRefresh()
      let delay = STRUCTURE_REFRESH_DEBOUNCE_MS
      if (reason === 'selection') {
        if (!graph && !ports.outlineWantsRefresh()) return
        pendingFull = true
        delay = 0
      } else if (headingsChanged || graph) {
        pendingFull = true
      } else {
        pendingStats = true
      }
      if (timer !== null) timers.clear(timer)
      timer = timers.set(run, delay)
    },
    cancel() {
      if (timer !== null) timers.clear(timer)
      timer = null
      pendingFull = false
      pendingStats = false
    },
  }
}
