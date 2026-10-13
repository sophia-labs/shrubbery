import type { WorkspaceConfig } from '@shrubbery/nucleus'

/**
 * Mithras Flow as an app in the Garden app picker (host-only composition).
 *
 * Flow is a React app carried verbatim (EF-9, "wrap React Flow, never
 * re-implement") and hosted by Shrubbery at `/flow/` (apps/flow, light-DOM
 * island, Flow's styles scoped + checksummed). The organism does not re-host
 * the island inside its own shadow-DOM workspace: `sh-guest-island`'s
 * light-scoped strategy injects the guest sheet into the TOP document, which
 * never cascades into a shadow tree (apps/flow/src/sh-flow-page.ts header).
 * So the Flow app's region renders `<sh-flow-app-frame>`, a same-origin frame
 * of the `/flow/` app on the SAME graph and the SAME cell proxy — Flow keeps
 * its own document, and its pixels stay Flow's.
 *
 * Off unless the build opts in (`VITE_SHRUBBERY_FLOW_APP=1`): an ordinary
 * Garden build is byte-for-byte unaffected. When on, a Garden-only config
 * (no app dimension; see default-workspace-ui.ts) gains a two-value app
 * dimension — Garden first, Flow second — and nothing else. Run it AFTER the
 * Grapevine compositions: those attach only to a config that already
 * declared an app dimension, and must not start appearing because Flow added one.
 */
export const FLOW_APP_ID = 'flow'
export const FLOW_REGION_ID = 'region-flow-center'
export const FLOW_FRAME_TAG = 'sh-flow-app-frame'

const views = new WeakMap<WorkspaceConfig, WorkspaceConfig>()

export function flowAppEnabled(env: Readonly<Record<string, unknown>>): boolean {
  const value = env.VITE_SHRUBBERY_FLOW_APP
  return typeof value === 'string' && value.trim() === '1'
}

/** Host-only app composition. Never persist this view as the graph's layout. */
export function withFlowWorkspace(config: WorkspaceConfig, enabled: boolean): WorkspaceConfig {
  if (!enabled) return config
  const dimension = config.dimensions['dim-app']
  // Custom app ownership and fullscreen layouts are deliberate; do not rewrite.
  if (config.appRootRegions?.[FLOW_APP_ID]
    || dimension?.values.some(value => value.literalValue === FLOW_APP_ID)
    || config.regions[FLOW_REGION_ID]
    || config.regions['region-top-bar']?.renderedByComponent !== 'mn-top-bar'
    || config.regions['region-bottom-bar']?.renderedByComponent !== 'mn-bottom-bar') return config
  const previous = views.get(config)
  if (previous) return previous
  const flowValue = {
    id: 'val-app-flow',
    literalValue: FLOW_APP_ID,
    appliesAttribute: 'structural — selects the host Mithras Flow board frame',
  }
  const appDimension = dimension
    ? { ...dimension, values: [...dimension.values, flowValue] }
    : {
        id: 'dim-app',
        label: 'App',
        defaultValue: 'garden',
        values: [
          {
            id: 'val-app-garden',
            literalValue: 'garden',
            appliesAttribute: 'structural — selects region-set via planFor (NOT a setAttribute)',
          },
          flowValue,
        ],
      }
  const view: WorkspaceConfig = {
    ...config,
    regions: {
      ...config.regions,
      [FLOW_REGION_ID]: {
        id: FLOW_REGION_ID, label: 'Mithras Flow — board',
        childRegion: null, collapsible: false, dockState: null, docksPanel: [],
        order: 2, renderedByComponent: FLOW_FRAME_TAG, resizable: true,
        sizeFraction: 0.8, splitOrientation: 'vertical',
      },
    },
    dimensions: { ...config.dimensions, 'dim-app': appDimension },
    appRootRegions: {
      ...config.appRootRegions,
      [FLOW_APP_ID]: ['region-top-bar', FLOW_REGION_ID, 'region-bottom-bar'],
    },
  }
  views.set(config, view)
  return view
}
