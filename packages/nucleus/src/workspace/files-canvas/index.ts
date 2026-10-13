/**
 * The Files canvas, pure layer: geometry, the engine port and its house implementation, the scene
 * builder, label display, and the interaction reducer. DOM-free and React-free; runnable in node.
 * Import it as `@shrubbery/nucleus/files-canvas`.
 */
export * from './geometry.js'
export * from './engine-port.js'
export { houseEngine } from './engine-house.js'
export { loadDefaultEngine, type LoadedEngine } from './engine-default.js'
export { avoidObstacles, baseElbows, labelBox, labelCandidates, placeLabels, rerouteScene, routeScene } from './engine-route.js'
export * from './journal.js'
export * from './interaction.js'
export * from './scene.js'
export * from './labels.js'
