/**
 * shell-named-query-registry.ts — the ONE named-query registry the shell's
 * workspace Surface resolves every graph-authored AND code-owned query
 * reference through (MO object-face integration spec, master §3 Slice 5).
 *
 * Composes the Observatory's nineteen (`observatory-surface-query-catalog.ts`
 * — the tabs-composed dashboard) with source-sync's two
 * (`source-sync-query-catalog.ts` — the contested wayfinding surface), THEN
 * seals. Two disjoint-named, independently-owned catalogues sharing one
 * sealed registry — exactly the composition `main.ts`'s own
 * `setWorkspaceNamedQueryRegistry` seam already expects (one registry per
 * process, injected once at module top level, per that seam's own comment).
 * Registering both sets into a FRESH `NamedQueryRegistry` (rather than
 * sealing one and asking the other to somehow extend it) is required:
 * `NamedQueryRegistry.register` throws once `seal()` has run.
 */
import { NamedQueryRegistry } from '@shrubbery/runtime/layout'
import { OBSERVATORY_SURFACE_NAMED_QUERIES } from './observatory-surface-query-catalog.js'
import { SOURCE_SYNC_NAMED_QUERIES } from './source-sync-query-catalog.js'

/**
 * A fresh, sealed registry holding the Observatory's nineteen queries UNION
 * source-sync's two — twenty-one names total, no overlap (`obs.*` vs
 * `sync.*` — disjoint prefixes by construction, and `NamedQueryRegistry`'s
 * own duplicate-name check would throw at boot if that ever stopped being
 * true).
 */
export function createShellNamedQueryRegistry(): NamedQueryRegistry {
  const registry = new NamedQueryRegistry()
  for (const definition of OBSERVATORY_SURFACE_NAMED_QUERIES) registry.register(definition)
  for (const definition of SOURCE_SYNC_NAMED_QUERIES) registry.register(definition)
  registry.seal()
  return registry
}
