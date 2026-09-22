/**
 * GARDEN_VARIANT — a hand-authored, deliberately-different WorkspaceConfig.
 *
 * NOT generated. NOT wired into app-shell's runtime path. Exists ONLY as the
 * generality fixture for the divergence test (engine-divergence.test.ts).
 *
 * Diverges from GARDEN_DEFAULT on 3 axes, each exercising one increment-2 code path:
 *
 * 1. Split-tree divergence — spine reorder + widened left rail:
 *    Spine: left-rail → RIGHT-RAIL → center  (vs left-rail → center → right-rail)
 *    sizeFractions: left=0.35, right=0.20, center=0.45  (vs 0.20 / 0.20 / 0.60)
 *    => outer position: 0.35/1.00 × 100 = 35  (vs 20)
 *    => inner position: 0.20/(0.20+0.45) × 100 ≈ 30.77  (vs 75)
 *
 * 2. Chrome divergence — drop region-bottom-bar from rootRegions:
 *    The variant has no status bar. The walk must emit no bottom-bar surface.
 *
 * 3. Panel-order divergence — swap two right-rail panels' order in docksPanel:
 *    panel-inspector before panel-chat (vs panel-chat first in id-sort order).
 *    Asserts the docked-panel ordering is read from config, not hardcoded.
 */

import type { WorkspaceConfig } from './types.js'

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj as object)) {
    const val = (obj as Record<string, unknown>)[key]
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val)
    }
  }
  return obj
}

export const GARDEN_VARIANT: WorkspaceConfig = deepFreeze({
  id: 'GardenVariant',
  label: 'Garden Variant (Divergence Test Fixture)',
  renderedByComponent: 'app-shell',

  regions: {
    // axis 2: no region-bottom-bar
    'region-center': {
      // axis 1: center is now the CHILD of right-rail (leaf of spine)
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: ['panel-editor'],
      id: 'region-center',
      label: 'Center (Editor / Home)',
      order: 3,
      renderedByComponent: null,
      resizable: true,
      // axis 1: widened left, narrowed center
      sizeFraction: 0.45,
      splitOrientation: 'vertical',
    },
    'region-left-rail': {
      // axis 1: spine head — left-rail → right-rail (was left-rail → center)
      childRegion: 'region-right-rail',
      collapsible: true,
      dockState: null,
      docksPanel: ['panel-sidebar'],
      id: 'region-left-rail',
      label: 'Left Rail (Sidebar)',
      order: 1,
      renderedByComponent: null,
      resizable: true,
      // axis 1: wider left
      sizeFraction: 0.35,
      splitOrientation: 'vertical',
    },
    'region-right-rail': {
      // axis 1: right-rail now points to center as its child
      childRegion: 'region-center',
      collapsible: true,
      dockState: 'stacked',
      // axis 3: inspector first (not alpha-sorted) to prove order is config-driven
      docksPanel: [
        'panel-inspector',
        'panel-chat',
        'panel-comments',
        'panel-graph',
        'panel-wires',
      ],
      id: 'region-right-rail',
      label: 'Right Rail (Composable Panel Stack)',
      order: 2,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.20,
      splitOrientation: 'vertical',
    },
    'region-top-bar': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-top-bar',
      label: 'Top Bar',
      order: 0,
      renderedByComponent: 'mn-top-bar',
      resizable: false,
      sizeFraction: 0.04,
      splitOrientation: 'horizontal',
    },
  },

  panels: {
    'panel-chat': {
      defaultVisible: true,
      dockState: 'stacked',
      id: 'panel-chat',
      label: 'Chat Panel',
      renderedByComponent: 'mn-chat-panel',
    },
    'panel-comments': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-comments',
      label: 'Comments Panel',
      renderedByComponent: 'mn-comments-panel',
    },
    'panel-editor': {
      defaultVisible: true,
      dockState: 'docked',
      id: 'panel-editor',
      label: 'Document Editor Panel',
      renderedByComponent: 'mn-document-editor',
    },
    'panel-graph': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-graph',
      label: 'Graph Panel',
      renderedByComponent: 'mn-graph-panel',
    },
    'panel-inspector': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-inspector',
      label: 'Inspector Panel',
      renderedByComponent: 'mn-inspector',
    },
    'panel-sidebar': {
      defaultVisible: true,
      dockState: 'docked',
      id: 'panel-sidebar',
      label: 'Sidebar Panel',
      renderedByComponent: 'mn-sidebar-panel',
    },
    'panel-wires': {
      defaultVisible: false,
      dockState: 'stacked',
      id: 'panel-wires',
      label: 'Wires Panel',
      renderedByComponent: 'mn-wires-panel',
    },
  },

  dimensions: {
    'dim-posture': {
      defaultValue: 'manuscript',
      id: 'dim-posture',
      label: 'Posture',
      values: [
        {
          appliesAttribute: '[data-posture=manuscript]',
          id: 'val-posture-manuscript',
          literalValue: 'manuscript',
        },
        {
          appliesAttribute: '[data-posture=comfortable]',
          id: 'val-posture-comfortable',
          literalValue: 'comfortable',
        },
        {
          appliesAttribute: '[data-posture=application]',
          id: 'val-posture-application',
          literalValue: 'application',
        },
      ],
    },
    'dim-skin': {
      defaultValue: 'garden',
      id: 'dim-skin',
      label: 'Skin',
      values: [
        {
          appliesAttribute: '[data-skin] absent (removeAttribute)',
          id: 'val-skin-garden',
          literalValue: 'garden',
        },
        {
          appliesAttribute: '[data-skin=emporium]',
          id: 'val-skin-emporium',
          literalValue: 'emporium',
        },
        {
          appliesAttribute: '[data-skin=98]',
          id: 'val-skin-98',
          literalValue: '98',
        },
        {
          appliesAttribute: '[data-skin=glass]',
          id: 'val-skin-glass',
          literalValue: 'glass',
        },
      ],
    },
    'dim-theme': {
      defaultValue: 'system',
      id: 'dim-theme',
      label: 'Theme',
      values: [
        {
          appliesAttribute: '[data-theme=dark]',
          id: 'val-theme-dark',
          literalValue: 'dark',
        },
        {
          appliesAttribute: '[data-theme=light]',
          id: 'val-theme-light',
          literalValue: 'light',
        },
        {
          appliesAttribute: 'resolved at runtime via prefers-color-scheme',
          id: 'val-theme-system',
          literalValue: 'system',
        },
      ],
    },
  },

  // axis 2: no region-bottom-bar (only top-bar + spine-head left-rail)
  rootRegions: ['region-top-bar', 'region-left-rail'],
})
