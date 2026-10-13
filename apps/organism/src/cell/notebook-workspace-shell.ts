import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'

const views = new WeakMap<WorkspaceConfig, { notebook: WorkspaceConfig; routed: WorkspaceConfig }>()

function isBareNotebookSeed(config: WorkspaceConfig): boolean {
  const center = config.regions['region-center']
  return config.id === 'AgentNotebookWorkspace'
    && config.renderedByComponent === 'app-shell'
    && Object.keys(config.regions).length === 1
    && config.rootRegions.length === 1 && config.rootRegions[0] === 'region-center'
    && Object.keys(config.panels).length === 0
    && Object.keys(config.appRootRegions ?? {}).length === 0
    && (config.edges?.length ?? 0) === 0
    && center?.id === 'region-center' && center.childRegion === null
    && center.docksPanel.length === 0 && center.resizable && !center.collapsible
    && center.surfaceMode == null && center.surfaceRole == null
    && center.renderedByComponent === 'sh-layout-dashboard'
    && Boolean(center.fragmentSurface?.startsWith('urn:sophia:ux:surface:agent-notebook:'))
}

/**
 * Add host navigation around the original bare AgentNotebookWorkspace seed.
 * This is a view, not a migration: never pass it to a graph config writer.
 * The notebook's authored fragment is untouched. An explicit host route may
 * temporarily replace its center; returning to graph Home restores the same
 * fragment. Other custom/fullscreen or already-framed configurations retain
 * their existing behavior and object identity.
 */
export function withNotebookWorkspaceShell(
  config: WorkspaceConfig,
  options: { readonly preferHostRoute?: boolean } = {},
): WorkspaceConfig {
  if (!isBareNotebookSeed(config)) return config
  let cached = views.get(config)
  if (!cached) {
    const notebook: WorkspaceConfig = {
      ...config,
      regions: {
        'region-top-bar': GARDEN_DEFAULT.regions['region-top-bar'],
        'region-left-rail': GARDEN_DEFAULT.regions['region-left-rail'],
        'region-center': { ...config.regions['region-center'], order: 2 },
        'region-bottom-bar': GARDEN_DEFAULT.regions['region-bottom-bar'],
      },
      panels: { 'panel-sidebar': GARDEN_DEFAULT.panels['panel-sidebar'] },
      rootRegions: ['region-top-bar', 'region-left-rail', 'region-bottom-bar'],
      edges: GARDEN_DEFAULT.edges?.filter(edge => edge.from === 'face:sidebar'
        && edge.to === 'face:editor' && edge.predicate === 'navigatesTo'),
    }
    const routed: WorkspaceConfig = {
      ...notebook,
      regions: {
        ...notebook.regions,
        'region-center': { ...GARDEN_DEFAULT.regions['region-center'], childRegion: null },
      },
      panels: { ...notebook.panels, 'panel-editor': GARDEN_DEFAULT.panels['panel-editor'] },
    }
    cached = { notebook, routed }
    views.set(config, cached)
  }
  return options.preferHostRoute ? cached.routed : cached.notebook
}
