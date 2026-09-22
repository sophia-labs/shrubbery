/**
 * Ordered lifecycle host for independently-owned Organism shell features.
 *
 * The hooks are intentionally synchronous and value-oriented.  A feature may
 * contribute controlled workspace/route options, attach to the active CRDT
 * provider, or perform DOM work after the real workspace render.  Provider
 * bindings are scoped to one editor claim and are torn down independently;
 * `destroy` remains the final app-lifetime cleanup.
 */

import type { ProviderHandle } from '@shrubbery/nucleus'
import type { RenderWorkspaceOptions } from '@shrubbery/runtime'
import type { MountOrganismAppRouteOptions } from './app-routes.js'
import type { ShellContext } from './shell-context.js'

export type ShellFeatureCleanup = () => void

export interface ShellFeature<TContract = unknown> {
  /** Stable diagnostic identity and deterministic registration key. */
  readonly id: string

  /**
   * Add or replace controlled workspace options. Hooks run in registration
   * order and receive the snapshot produced by every earlier feature.
   */
  workspaceSnapshot?(
    context: ShellContext<TContract>,
    snapshot: Readonly<RenderWorkspaceOptions>,
  ): Partial<RenderWorkspaceOptions> | void

  /** Add or replace top-level route-controller options in registration order. */
  routeOptions?(
    context: ShellContext<TContract>,
    options: Readonly<MountOrganismAppRouteOptions>,
  ): Partial<MountOrganismAppRouteOptions> | void

  /** Bind feature state to one live editor provider. May return claim cleanup. */
  bindProvider?(
    provider: ProviderHandle,
    context: ShellContext<TContract>,
  ): ShellFeatureCleanup | void

  /** Run after `renderWorkspace` and Organism's core DOM reflection complete. */
  afterWorkspaceRender?(
    context: ShellContext<TContract>,
    snapshot: Readonly<RenderWorkspaceOptions>,
  ): void

  /** Final app-lifetime cleanup. */
  destroy?(): void
}

export interface ShellFeatureHost<TContract = unknown> {
  workspaceSnapshot(
    context: ShellContext<TContract>,
    base: RenderWorkspaceOptions,
  ): RenderWorkspaceOptions
  routeOptions(
    context: ShellContext<TContract>,
    base: MountOrganismAppRouteOptions,
  ): MountOrganismAppRouteOptions
  bindProvider(
    provider: ProviderHandle,
    context: ShellContext<TContract>,
  ): ShellFeatureCleanup
  afterWorkspaceRender(
    context: ShellContext<TContract>,
    snapshot: Readonly<RenderWorkspaceOptions>,
  ): void
  destroy(): void
}

function validateFeatures<TContract>(features: readonly ShellFeature<TContract>[]): void {
  const ids = new Set<string>()
  for (const feature of features) {
    const id = feature.id.trim()
    if (!id) throw new Error('Organism shell features require a non-empty id')
    if (ids.has(id)) throw new Error(`Duplicate Organism shell feature id: ${id}`)
    ids.add(id)
  }
}
/** Create one app-lifetime host over an ordered, fixed feature set. */
export function createShellFeatureHost<TContract = unknown>(
  features: readonly ShellFeature<TContract>[] = [],
): ShellFeatureHost<TContract> {
  validateFeatures(features)
  const registered = [...features]
  const providerBindings = new Set<ShellFeatureCleanup>()
  let destroyed = false

  const assertActive = (): void => {
    if (destroyed) throw new Error('Organism shell feature host has been destroyed')
  }

  return {
    workspaceSnapshot(context, base) {
      assertActive()
      let snapshot: RenderWorkspaceOptions = { ...base }
      for (const feature of registered) {
        const contribution = feature.workspaceSnapshot?.(context, snapshot)
        if (contribution) snapshot = { ...snapshot, ...contribution }
      }
      return snapshot
    },

    routeOptions(context, base) {
      assertActive()
      let options: MountOrganismAppRouteOptions = { ...base }
      for (const feature of registered) {
        const contribution = feature.routeOptions?.(context, options)
        if (contribution) options = { ...options, ...contribution }
      }
      return options
    },

    bindProvider(provider, context) {
      assertActive()
      const cleanups: ShellFeatureCleanup[] = []
      try {
        for (const feature of registered) {
          const cleanup = feature.bindProvider?.(provider, context)
          if (cleanup) cleanups.push(cleanup)
        }
      } catch (error) {
        for (const cleanup of cleanups.reverse()) cleanup()
        throw error
      }

      let bound = true
      const unbind = (): void => {
        if (!bound) return
        bound = false
        providerBindings.delete(unbind)
        for (const cleanup of cleanups.reverse()) cleanup()
      }
      providerBindings.add(unbind)
      return unbind
    },

    afterWorkspaceRender(context, snapshot) {
      assertActive()
      for (const feature of registered) {
        feature.afterWorkspaceRender?.(context, snapshot)
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      for (const unbind of [...providerBindings].reverse()) unbind()
      for (const feature of registered.reverse()) feature.destroy?.()
    },
  }
}
