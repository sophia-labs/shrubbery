import type { WorkspaceConfig } from '@shrubbery/nucleus'

/**
 * Read-only compatibility for graphs whose saved `:ux:config` predates modes
 * v1 (2026-09-22): their Choreograph region still names the retired
 * `wf-studio-shell` screen router. The Choreograph app now renders only the
 * modes surface, so the stale component name is projected to
 * `choreo-modes-surface` at read time. No graph write; any other component an
 * author chose for the region is left alone.
 */
export function withChoreographModesRegion(config: WorkspaceConfig): WorkspaceConfig {
  const region = config.regions['region-choreo-center']
  if (region?.renderedByComponent !== 'wf-studio-shell') return config
  return {
    ...config,
    regions: {
      ...config.regions,
      'region-choreo-center': { ...region, renderedByComponent: 'choreo-modes-surface' },
    },
  }
}
