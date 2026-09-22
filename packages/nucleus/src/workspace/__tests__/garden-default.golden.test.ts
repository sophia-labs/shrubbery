/**
 * Golden-object snapshot test for GARDEN_DEFAULT.
 *
 * Purpose: pin the WorkspaceConfig literal so any graph-side change that
 * reshapes the right-rail frame (or any other field) fails CI deterministically.
 * The golden is an inline literal here — the diff lands in the PR, not a .snap file.
 *
 * Gates:
 *   1. Deep-equals pin: GARDEN_DEFAULT must equal GOLDEN exactly.
 *   2. Frozen invariants: Object.isFrozen() on the root and nested objects.
 *   3. Right-rail tag pins: the 4 PanelId → renderedByComponent resolutions
 *      the interpreter depends on, asserted independently.
 */

import { describe, it, expect } from 'vitest'
import { GARDEN_DEFAULT } from '../garden-default.js'
import type { WorkspaceConfig } from '../types.js'

// ---------------------------------------------------------------------------
// GOLDEN — the committed inline literal.
// If the graph changes, update both garden-default.ts AND this object.
// ---------------------------------------------------------------------------
const GOLDEN: WorkspaceConfig = {
  id: 'GardenDefault',
  label: 'Garden Default Workspace',
  renderedByComponent: 'app-shell',

  regions: {
    'region-bottom-bar': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-bottom-bar',
      label: 'Bottom Bar (Status Bar)',
      order: 4,
      renderedByComponent: 'mn-bottom-bar',
      resizable: false,
      sizeFraction: 0.03,
      splitOrientation: 'horizontal',
    },
    'region-center': {
      childRegion: 'region-right-rail',
      collapsible: false,
      dockState: null,
      docksPanel: ['panel-editor'],
      id: 'region-center',
      label: 'Center (Editor / Home)',
      order: 2,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.6,
      splitOrientation: 'vertical',
    },
    'region-choreo-center': {
      childRegion: null,
      collapsible: false,
      dockState: null,
      docksPanel: [],
      id: 'region-choreo-center',
      label: 'Choreograph Center (Studio)',
      order: 2,
      renderedByComponent: 'wf-studio-shell',
      resizable: true,
      sizeFraction: 0.8,
      splitOrientation: 'vertical',
    },
    'region-left-rail': {
      childRegion: 'region-center',
      collapsible: true,
      dockState: null,
      docksPanel: ['panel-sidebar'],
      id: 'region-left-rail',
      label: 'Left Rail (Sidebar)',
      order: 1,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.2,
      splitOrientation: 'vertical',
    },
    'region-right-rail': {
      childRegion: null,
      collapsible: true,
      dockState: 'stacked',
      docksPanel: [
        'panel-chat',
        'panel-comments',
        'panel-graph',
        'panel-inspector',
        'panel-wires',
      ],
      id: 'region-right-rail',
      label: 'Right Rail (Composable Panel Stack)',
      order: 3,
      renderedByComponent: null,
      resizable: true,
      sizeFraction: 0.2,
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
    'dim-app': {
      defaultValue: 'garden',
      id: 'dim-app',
      label: 'App',
      values: [
        {
          appliesAttribute: 'structural — selects region-set via planFor (NOT a setAttribute)',
          id: 'val-app-garden',
          literalValue: 'garden',
        },
        {
          appliesAttribute: 'structural — selects choreograph region-set via planFor (appRootRegions.choreograph → region-choreo-center)',
          id: 'val-app-choreograph',
          literalValue: 'choreograph',
        },
      ],
    },
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

  rootRegions: ['region-top-bar', 'region-left-rail', 'region-bottom-bar'],

  appRootRegions: {
    choreograph: ['region-top-bar', 'region-choreo-center', 'region-bottom-bar'],
  },

  edges: [
    { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
    { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
    { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
    { from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' },
    { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
    { from: 'face:sidebar', to: 'face:inspector', predicate: 'drivesSelection' },
  ],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GARDEN_DEFAULT golden snapshot', () => {
  it('deep-equals the committed golden literal', () => {
    expect(GARDEN_DEFAULT).toEqual(GOLDEN)
  })

  describe('frozen invariants', () => {
    it('root object is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT)).toBe(true)
    })

    it('panels map is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.panels)).toBe(true)
    })

    it('individual panel objects are frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.panels['panel-chat'])).toBe(true)
      expect(Object.isFrozen(GARDEN_DEFAULT.panels['panel-inspector'])).toBe(true)
    })

    it('regions map is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.regions)).toBe(true)
    })

    it('individual region objects are frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.regions['region-right-rail'])).toBe(true)
    })

    it('dimensions map is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.dimensions)).toBe(true)
    })

    it('individual dimension value arrays are frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.dimensions['dim-posture'].values)).toBe(true)
    })

    it('rootRegions array is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.rootRegions)).toBe(true)
    })
  })

  describe('right-rail tag pins (load-bearing for increment 1 interpreter)', () => {
    it('panel-chat → mn-chat-panel', () => {
      expect(GARDEN_DEFAULT.panels['panel-chat'].renderedByComponent).toBe('mn-chat-panel')
    })

    it('panel-comments → mn-comments-panel', () => {
      expect(GARDEN_DEFAULT.panels['panel-comments'].renderedByComponent).toBe('mn-comments-panel')
    })

    it('panel-wires → mn-wires-panel', () => {
      expect(GARDEN_DEFAULT.panels['panel-wires'].renderedByComponent).toBe('mn-wires-panel')
    })

    it('panel-inspector → mn-inspector', () => {
      expect(GARDEN_DEFAULT.panels['panel-inspector'].renderedByComponent).toBe('mn-inspector')
    })

    it('panel-graph → mn-graph-panel', () => {
      expect(GARDEN_DEFAULT.panels['panel-graph'].renderedByComponent).toBe('mn-graph-panel')
    })
  })

  describe('structural invariants', () => {
    it('rootRegions contains exactly the non-child regions', () => {
      // childRegion targets in GardenDefault: region-center, region-right-rail
      // roots must NOT include those
      expect(GARDEN_DEFAULT.rootRegions).not.toContain('region-center')
      expect(GARDEN_DEFAULT.rootRegions).not.toContain('region-right-rail')
      // roots must include the three chrome/spine-head regions
      expect(GARDEN_DEFAULT.rootRegions).toContain('region-top-bar')
      expect(GARDEN_DEFAULT.rootRegions).toContain('region-left-rail')
      expect(GARDEN_DEFAULT.rootRegions).toContain('region-bottom-bar')
    })

    it('childRegion spine is left-rail → center → right-rail', () => {
      expect(GARDEN_DEFAULT.regions['region-left-rail'].childRegion).toBe('region-center')
      expect(GARDEN_DEFAULT.regions['region-center'].childRegion).toBe('region-right-rail')
      expect(GARDEN_DEFAULT.regions['region-right-rail'].childRegion).toBeNull()
    })

    it('right-rail dockState is stacked', () => {
      expect(GARDEN_DEFAULT.regions['region-right-rail'].dockState).toBe('stacked')
    })

    it('right-rail docksPanel contains all 5 ontology panels id-sorted', () => {
      expect(GARDEN_DEFAULT.regions['region-right-rail'].docksPanel).toEqual([
        'panel-chat',
        'panel-comments',
        'panel-graph',
        'panel-inspector',
        'panel-wires',
      ])
    })

    it('app dimension default is garden (structural — selects the region-set)', () => {
      expect(GARDEN_DEFAULT.dimensions['dim-app'].defaultValue).toBe('garden')
      // dim-app is STRUCTURAL — its appliesAttribute must NOT look like a DOM hook.
      for (const v of GARDEN_DEFAULT.dimensions['dim-app'].values) {
        expect(v.appliesAttribute).not.toMatch(/\[data-/)
        expect(v.appliesAttribute).toContain('structural')
      }
    })

    it('posture dimension default is manuscript', () => {
      expect(GARDEN_DEFAULT.dimensions['dim-posture'].defaultValue).toBe('manuscript')
    })

    it('skin dimension default is garden', () => {
      expect(GARDEN_DEFAULT.dimensions['dim-skin'].defaultValue).toBe('garden')
    })

    it('theme dimension default is system', () => {
      expect(GARDEN_DEFAULT.dimensions['dim-theme'].defaultValue).toBe('system')
    })

    it('posture values are ordinalIndex-sorted: manuscript(0) comfortable(1) application(2)', () => {
      const vals = GARDEN_DEFAULT.dimensions['dim-posture'].values
      expect(vals[0].literalValue).toBe('manuscript')
      expect(vals[1].literalValue).toBe('comfortable')
      expect(vals[2].literalValue).toBe('application')
    })
  })

  describe('chrome region tags (increment 2 — renderedByComponent on regions)', () => {
    it('region-top-bar renderedByComponent is mn-top-bar', () => {
      expect(GARDEN_DEFAULT.regions['region-top-bar'].renderedByComponent).toBe('mn-top-bar')
    })

    it('region-bottom-bar renderedByComponent is mn-bottom-bar', () => {
      expect(GARDEN_DEFAULT.regions['region-bottom-bar'].renderedByComponent).toBe('mn-bottom-bar')
    })

    it('content regions have null renderedByComponent', () => {
      expect(GARDEN_DEFAULT.regions['region-left-rail'].renderedByComponent).toBeNull()
      expect(GARDEN_DEFAULT.regions['region-center'].renderedByComponent).toBeNull()
      expect(GARDEN_DEFAULT.regions['region-right-rail'].renderedByComponent).toBeNull()
    })
  })

  describe('choreograph region-set (P0 — Studio app spine)', () => {
    it('appRootRegions has ONLY a choreograph set (garden stays absent ⇒ no-app parity)', () => {
      expect(GARDEN_DEFAULT.appRootRegions).toBeDefined()
      expect(Object.keys(GARDEN_DEFAULT.appRootRegions!)).toEqual(['choreograph'])
    })

    it('choreograph set = [top-bar, choreo-center, bottom-bar] (shared chrome + own head)', () => {
      expect(GARDEN_DEFAULT.appRootRegions!.choreograph).toEqual([
        'region-top-bar',
        'region-choreo-center',
        'region-bottom-bar',
      ])
    })

    it('region-choreo-center is the resizable, full-panel (leaf) spine head', () => {
      const r = GARDEN_DEFAULT.regions['region-choreo-center']
      expect(r.resizable).toBe(true)
      expect(r.childRegion).toBeNull()
      // I6: spine sizeFraction in (0,1).
      expect(r.sizeFraction! > 0 && r.sizeFraction! < 1).toBe(true)
    })

    it('region-choreo-center resolves to the wf-studio-shell screen-router', () => {
      expect(GARDEN_DEFAULT.regions['region-choreo-center'].renderedByComponent).toBe('wf-studio-shell')
    })
  })

  describe('selection-hub edges (semantic edge overlay, slices 1 + 2)', () => {
    it('carries exactly the six couplings, in order (3 Tier-A + 3 Tier-B)', () => {
      expect(GARDEN_DEFAULT.edges).toEqual([
        { from: 'face:comments', to: 'face:inspector', predicate: 'drivesSelection' },
        { from: 'face:graph', to: 'face:editor', predicate: 'reveals' },
        { from: 'face:comments', to: 'face:editor', predicate: 'reveals' },
        { from: 'face:graph', to: 'face:editor', predicate: 'navigatesTo' },
        { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
        { from: 'face:sidebar', to: 'face:inspector', predicate: 'drivesSelection' },
      ])
    })

    it('one source face can carry two predicates off two events (graph, sidebar)', () => {
      // graph drives both reveals (node-select) and navigatesTo (node-open);
      // sidebar drives both navigatesTo (doc-open) and drivesSelection (folder-open).
      const bySource = (id: string) =>
        (GARDEN_DEFAULT.edges ?? []).filter((e) => e.from === id).map((e) => e.predicate)
      expect(bySource('face:graph')).toEqual(['reveals', 'navigatesTo'])
      expect(bySource('face:sidebar')).toEqual(['navigatesTo', 'drivesSelection'])
    })

    it('the edges array is frozen', () => {
      expect(Object.isFrozen(GARDEN_DEFAULT.edges)).toBe(true)
    })
  })
})
