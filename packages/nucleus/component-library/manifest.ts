/**
 * manifest.ts — DEPRECATED compatibility shim (iteration 1a).
 *
 * The component-library manifest was FOLDED into the canonical
 * `src/workspace/component-library.ts`, which is the single source of per-tag
 * component metadata (`COMPONENT_LIBRARY` / `persistenceOf` /
 * `isRegisteredComponent`). That module is also re-exported from
 * `@shrubbery/nucleus/workspace`.
 *
 * This file remains only so the `@shrubbery/nucleus/component-library/manifest`
 * export specifier keeps resolving. It re-exports the canonical surface and
 * provides backward-compatible aliases for the former stub's names. Prefer
 * importing from `@shrubbery/nucleus` (or `.../workspace`) directly.
 */

import {
  COMPONENT_LIBRARY,
  isRegisteredComponent,
  persistenceOf,
  type ComponentLibraryEntry,
  type Persistence,
} from '../src/workspace/component-library.js'

export {
  COMPONENT_LIBRARY,
  isRegisteredComponent,
  persistenceOf,
  type ComponentLibraryEntry,
  type Persistence,
} from '../src/workspace/component-library.js'

/** @deprecated Use `ComponentLibraryEntry` from `@shrubbery/nucleus`. */
export type ComponentManifestEntry = ComponentLibraryEntry

/** @deprecated Use `COMPONENT_LIBRARY` from `@shrubbery/nucleus`. */
export const COMPONENT_MANIFEST: Readonly<Record<string, ComponentLibraryEntry>> = COMPONENT_LIBRARY

/**
 * @deprecated Use `persistenceOf` / `isRegisteredComponent` from
 * `@shrubbery/nucleus`. Returns the canonical library entry for a registered
 * tag, or a synthesized Class-A entry for any unregistered tag (the same safe
 * default `persistenceOf` applies).
 */
export function manifestFor(tag: string): ComponentLibraryEntry {
  return isRegisteredComponent(tag) ? COMPONENT_LIBRARY[tag] : { tag, persistence: persistenceOf(tag) }
}
