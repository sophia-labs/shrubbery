/**
 * rhizome-config.ts — the WorkspaceConfig for the RHIZOME observatory shell.
 *
 * RHIZOME is a `@shrubbery/runtime` DOM app (the `dom` face of the same memory
 * world slice-1 renders to curl/turtle/json). The interpreter contract:
 *   - EXACTLY ONE resizable:true root region (the spine head; invariant I1).
 *     Here that is `region-observatory` — the single content surface that hosts
 *     the surface-switching shell (`rz-shell`).
 *   - chrome (top bar + LEFT RAIL) are non-resizable root regions, dropped from
 *     the spine. The top bar is order 0 (above the spine); the left rail is order
 *     1 (a vertical chrome rail rendered INSIDE `.main`, to the left of the spine
 *     head). region-observatory is order 2 — the single resizable spine head.
 *
 * The observatory region's panel is rendered by `rz-shell` — the thin CONTENT
 * HOST (defined in src/rz-shell.ts) that owns the cross-surface lens (the ?asof
 * scrubber) + the current surface, and SWITCHES the body between surfaces by
 * STATE (never a page swap): the Plot (`<rz-observatory>`, unchanged) and the
 * Walk (`<rz-walk>`, a stub for now). The left-rail panel is rendered by
 * `rz-rail` — a controlled nav listing the surfaces, emitting `rz-surface`.
 *
 * The COMPONENT_LIBRARY primitives (mn-card / mn-graph / mn-relations) are the
 * CONTENT inside the observatory region, not spine panels.
 *
 * `renderWorkspace` stamps the rail region as an inert `<rz-rail>` and the
 * observatory region as an inert `<rz-shell>`; they upgrade in place once
 * src/rz-rail.ts + src/rz-shell.ts are imported (the upgrade seam).
 */

import type { WorkspaceConfig } from '@shrubbery/nucleus'
import { registerRenderableComponentTags } from '@shrubbery/nucleus'

// RHIZOME is a downstream app with its OWN registered shell components (rz-shell,
// rz-rail — see src/rz-shell.ts / src/rz-rail.ts), which the nucleus's frozen
// garden catalog does not (and should not) enumerate. Vet them with the render
// gate here — at trusted import time, before renderWorkspace(RHIZOME) — so the
// interpreter stamps them verbatim instead of resolving them to inert
// placeholders. Only these app-owned tags are opted in; an off-catalog tag from
// an untrusted cell still fails the gate. (These are the two tags the config
// below stamps as region/panel renderedByComponent; the surfaces rz-shell hosts
// internally — rz-observatory, rz-walk — never flow through stampPanelBody.)
registerRenderableComponentTags(['rz-shell', 'rz-rail'])

export const RHIZOME: WorkspaceConfig = {
  id: 'Rhizome',
  label: 'Rhizome — memory observatory',
  renderedByComponent: 'app-shell',
  regions: {
    'region-top-bar': {
      id: 'region-top-bar',
      label: 'Top',
      childRegion: null,
      order: 0,
      splitOrientation: 'horizontal',
      collapsible: false,
      resizable: false,
      sizeFraction: 0.06,
      dockState: null,
      docksPanel: [],
      renderedByComponent: 'mn-app-bar',
    },
    // The LEFT RAIL — a non-resizable chrome root (like the top bar), order 1 so
    // it sits BELOW the spine head's order (2) → topChrome → the runtime renders
    // it as a vertical pane inside `.main`, to the LEFT of the spine. Mirrors
    // garden-default's region-left-rail, but as CHROME (not a resizable spine
    // member) so region-observatory stays the single resizable root (I1).
    'region-rail': {
      id: 'region-rail',
      label: 'Rail',
      childRegion: null,
      order: 1,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: false,
      sizeFraction: 0.16,
      dockState: null,
      docksPanel: ['panel-rail'],
      renderedByComponent: null,
    },
    'region-observatory': {
      id: 'region-observatory',
      label: 'Observatory',
      childRegion: null,
      order: 2,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 0.94,
      dockState: null,
      docksPanel: ['panel-observatory'],
      renderedByComponent: null,
    },
  },
  panels: {
    'panel-rail': {
      id: 'panel-rail',
      label: 'Rail',
      dockState: 'docked',
      defaultVisible: true,
      renderedByComponent: 'rz-rail',
    },
    'panel-observatory': {
      id: 'panel-observatory',
      label: 'Observatory',
      dockState: 'docked',
      defaultVisible: true,
      renderedByComponent: 'rz-shell',
    },
  },
  dimensions: {},
  rootRegions: ['region-top-bar', 'region-rail', 'region-observatory'],
}
