/**
 * Board layout with ELK: the presets, the board → graph plan and the result → board application, shared by every
 * canvas that lays a board out. Pure; the runtime's ELK host runs the engine (plans/2026-10-30-elk-layout/DESIGN.md).
 */
export * from './presets.js'
export * from './elements.js'
export * from './board-graph.js'
export * from './apply-layout.js'
export * from './reroute.js'
