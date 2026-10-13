/**
 * Which engine a canvas runs on. The Excalidraw-backed one is the default (Vera, 2026-10-03: Excalidraw-first); it is loaded on
 * first use, so a route that never draws a canvas carries none of it, and the house engine is the answer when it cannot be
 * loaded (a failed chunk fetch, an environment the element modules do not run in). A host calls this once and holds the engine for the
 * life of the canvas, calling its `dispose` when the canvas goes (the engine keeps drag state in a process-global cache).
 *
 * Nothing else in this folder imports `engine-excalidraw.ts` statically, and none must: it is the one door.
 */

import { houseEngine } from './engine-house.js'
import type { CanvasEngine } from './engine-port.js'

export interface LoadedEngine {
  readonly engine: CanvasEngine
  /** Which one it is: a host shows nothing for it, but a receipt and a bug report say it. */
  readonly kind: 'excalidraw' | 'house'
  /** Set when the Excalidraw engine could not be loaded and the house engine stands in. */
  readonly reason: string | null
}

type Loader = () => Promise<{ createExcalidrawEngine: () => CanvasEngine }>

/** A canvas's own engine (not the realm's shared one): its drag state and translation are its own to dispose. */
export async function loadDefaultEngine(load: Loader = () => import('./engine-excalidraw.js')): Promise<LoadedEngine> {
  try {
    const { createExcalidrawEngine } = await load()
    return { engine: createExcalidrawEngine(), kind: 'excalidraw', reason: null }
  } catch (error) {
    return { engine: houseEngine, kind: 'house', reason: error instanceof Error ? error.message : String(error) }
  }
}
