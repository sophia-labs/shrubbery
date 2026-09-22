/**
 * minimal-text-panel.ts — the MINIMAL one-text-panel WorkspaceConfig builders.
 *
 * This is the seed for the `atelier` app (apps/atelier): the bare "plain text"
 * Sophia. NOT a regeneration of GARDEN_DEFAULT — a NET-NEW literal that the
 * interpreter renders as exactly ONE text region with NO chrome.
 *
 * `minimalTextPanelConfig()` returns a deep-frozen, validateConfig-passing config
 * whose ONLY root is `region-center` (resizable, a single leaf spine head docking
 * a `mn-card` "text panel"). It ALSO carries a present-but-unrooted
 * `region-top-bar` chrome region — modelled in `regions` but absent from
 * `rootRegions`, so planFor never renders it. That is what makes the W0 "grow"
 * gesture purely ADDITIVE: appending the RootEntry that puts `region-top-bar` into
 * the root set is the only delta needed for the top bar to render.
 *
 * `grownTextPanelConfig()` is the SAME config with `region-top-bar` added to
 * `rootRegions` — what the live config becomes after the out-of-band grow write.
 *
 * Why `mn-card`: it is a REAL registered @shrubbery/components element that stamps
 * as `<mn-card></mn-card>` in engine role 'other' (a plain zero-prop body) — a
 * real, upgrade-able element, not an inert `data-placeholder-for` stamp, and NOT
 * `mn-document-editor` (which would force the Class-B editor-host lift path) nor
 * `mn-sidebar-panel` (which would force role 'sidebar').
 *
 * Pure: no DOM, no stores, no network.
 */

import type { WorkspaceConfig } from './types.js'
import { deepFreeze } from './deep-freeze.js'

/**
 * The shared region/panel/dimension body of the minimal config. The two builders
 * differ ONLY in `rootRegions` (seed = center only; grown = center + top-bar), so
 * the grow delta is a pure append of one RootEntry.
 */
function baseFields(): Omit<WorkspaceConfig, 'rootRegions'> {
  return {
    id: 'MinimalTextPanel',
    label: 'Minimal Text Panel (Atelier)',
    renderedByComponent: 'app-shell',
    regions: {
      // The lone resizable spine head — a single leaf (childRegion null), so the
      // spine renders as one bare <div class="split-pane"> with the text body
      // inside (no sl-split-panel, no nesting). sizeFraction in (0,1) for I6.
      'region-center': {
        childRegion: null,
        collapsible: false,
        dockState: null,
        docksPanel: ['panel-text'],
        id: 'region-center',
        label: 'Center (Text)',
        order: 2,
        renderedByComponent: null,
        resizable: true,
        sizeFraction: 0.99,
        splitOrientation: 'vertical',
      },
      // Chrome top bar — PRESENT in the regions map but NOT a root (absent from
      // rootRegions in the seed). Non-resizable (so it stays chrome, not a second
      // spine head ⇒ I1 holds). order 0 < center's order 2, so once it IS rooted
      // planFor partitions it into topChrome regardless of RootEntry index order.
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
      // The "text panel" — a real registered, upgrade-able element (role 'other').
      'panel-text': {
        defaultVisible: true,
        dockState: 'docked',
        id: 'panel-text',
        label: 'Text',
        renderedByComponent: 'mn-card',
      },
    },
    dimensions: {},
  }
}

/**
 * The MINIMAL seed config: one text panel, NO chrome rendered.
 * rootRegions = ['region-center'] (root-0). region-top-bar is present-but-unrooted.
 */
export function minimalTextPanelConfig(): WorkspaceConfig {
  return deepFreeze({
    ...baseFields(),
    rootRegions: ['region-center'],
  })
}

/**
 * The GROWN config: the same minimal config with region-top-bar promoted into the
 * root set (appended at index 1 so the write is purely additive over the seed —
 * region-center stays root-0). planFor moves region-top-bar into topChrome by its
 * order (0 < center's 2), so it renders as the <header><mn-top-bar> banner.
 */
export function grownTextPanelConfig(): WorkspaceConfig {
  return deepFreeze({
    ...baseFields(),
    rootRegions: ['region-center', 'region-top-bar'],
  })
}
