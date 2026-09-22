/**
 * store-scope.ts — StoreScope + BranchContext: the typed (store, branch) handle,
 * a PURE projection over the EXISTING interpreter app mechanism.
 *
 * Module name is `store-scope.ts` (NOT `context.ts` — render owns that name for
 * the JSON-LD @context). This is the "which app/branch is this config store
 * bound to" value, formalized WITHOUT forking the interpreter:
 *
 *   - BranchContext names the existing resolveRootRegions(config, app?) /
 *     planFor(config, app?) `app` argument AS A VALUE. `app` undefined ⇒ the
 *     default config.rootRegions spine. It invents no parallel app-routing.
 *   - StoreScope = (config store, branch). Shells build it; the kernel reads it.
 *   - rootRegionsForScope threads the existing interpreter seam; null when the
 *     store is not ready (no fake config substituted).
 *
 * This is read-only over validate.ts's per-appRootRegions invariants (I1/I6) —
 * it rides the seam, never widens it.
 */

import type { AppId, WorkspaceConfig } from './workspace/types.js'
import { resolveRootRegions } from './workspace/interpreter.js'
import type { ShrubberyStore, StoreState } from './reactive-store.js'

/**
 * The active branch = which appRootRegions set the interpreter resolves.
 * `app` undefined ⇒ config.rootRegions (the default / garden spine).
 *
 * This is the EXISTING `app` selector (resolveRootRegions/planFor) named as a
 * value — NOT a new routing concept and NOT a store registry.
 */
export interface BranchContext {
  readonly app?: AppId
}

/**
 * Binds a config store to a branch. Pure projection: a typed handle a
 * createXStore(contract) world threads, pairing the reactive WorkspaceConfig
 * source with the active app/branch.
 */
export interface StoreScope {
  readonly config: ShrubberyStore<WorkspaceConfig>
  readonly branch: BranchContext
}

/**
 * Resolve the root regions for a scope's CURRENT state + branch IF ready —
 * threading the existing interpreter seam, never forking it. Returns null when
 * the store is not ready or carries no config (no fake config substituted).
 */
export function rootRegionsForScope(scope: StoreScope): readonly string[] | null {
  const s: StoreState<WorkspaceConfig> = scope.config.get()
  if (s.status !== 'ready' || !s.read) return null
  return resolveRootRegions(s.read, scope.branch.app)
}
