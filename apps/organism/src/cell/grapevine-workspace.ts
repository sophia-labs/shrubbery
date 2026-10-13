import type { WorkspaceConfig } from '@shrubbery/nucleus'

const views = new WeakMap<WorkspaceConfig, WorkspaceConfig>()

/** Host-only app composition. Never persist this view as the graph's layout. */
export function withGrapevineWorkspace(config: WorkspaceConfig): WorkspaceConfig {
  const dimension = config.dimensions['dim-app']
  // Custom app ownership and fullscreen layouts are deliberate; do not rewrite.
  if (!dimension || config.appRootRegions?.grapevine
    || dimension.values.some(value => value.literalValue === 'grapevine')
    || config.regions['region-grapevine-center']
    || config.regions['region-top-bar']?.renderedByComponent !== 'mn-top-bar'
    || config.regions['region-bottom-bar']?.renderedByComponent !== 'mn-bottom-bar') return config
  const previous = views.get(config)
  if (previous) return previous
  const view: WorkspaceConfig = {
    ...config,
    regions: {
      ...config.regions,
      'region-grapevine-center': {
        id: 'region-grapevine-center', label: 'Grapevine — conversation',
        childRegion: null, collapsible: false, dockState: null, docksPanel: [],
        order: 2, renderedByComponent: 'mn-grapevine-pane', resizable: true,
        sizeFraction: 0.8, splitOrientation: 'vertical',
      },
    },
    dimensions: {
      ...config.dimensions,
      'dim-app': { ...dimension, values: [...dimension.values, {
        id: 'val-app-grapevine', literalValue: 'grapevine',
        appliesAttribute: 'structural — selects the host Grapevine conversation pane',
      }] },
    },
    appRootRegions: {
      ...config.appRootRegions,
      grapevine: ['region-top-bar', 'region-grapevine-center', 'region-bottom-bar'],
    },
  }
  views.set(config, view)
  return view
}
