/**
 * @shrubbery/source/node — the EXPLICIT node-only subpath (design §2.1).
 *
 * Spawn/seed/fossil-io helpers that use node builtins statically
 * (child_process, fs, path…). Deliberately NOT reachable from the
 * browser-safe '.' barrel — tests/browser-safety.test.ts proves the split.
 */

export * from './spawn-gardend.js'
export * from './seed.js'
export * from './fossil-io.js'
