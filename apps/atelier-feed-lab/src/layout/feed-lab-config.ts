/**
 * feed-lab-config.ts — the Atelier feed lab's workspace shape, as CONFIG.
 *
 * This is the AUTHORING form of the layout. The app does NOT boot from this
 * literal: `scripts/emit-layout.mts` serializes it (nucleus ux-rdf codec) into
 * `src/layout/feed-lab.ux.nt` — a fossil-v1 N-Triples document — and main.ts
 * reads THAT through a real static TripleSource (`staticNtSource`, the same
 * no-backend read path PLANTER proved) and `parseTriplesToConfig`. Layout is
 * data; this file is where the data is written down.
 *
 * The interpreter contract (see apps/rhizome/src/rhizome-config.ts):
 *   - EXACTLY ONE resizable:true ROOT region (invariant I1) — here
 *     `region-broadcast`, the spine head. Its childRegion chain expresses the
 *     broadcast | director split; the split position falls out of the two
 *     sizeFractions (0.66 / 0.34 → 66%).
 *   - `region-top-bar` (order 0, chrome) renders `mn-app-bar` — the product
 *     masthead, branded in main.ts after the stamp.
 *   - `region-bottom-bar` (order 4, chrome) docks the pipeline band. The
 *     runtime's bottom chrome is gated on that exact region id.
 *
 * The three afl-* leaves are APP-OWNED tags (defined in src/leaves/), opted
 * through the render gate here at trusted import time — the frozen garden
 * catalog rightly does not enumerate them. An off-catalog tag arriving from
 * data still resolves to an inert placeholder.
 */

import type { WorkspaceConfig } from '@shrubbery/nucleus'
import { registerRenderableComponentTags } from '@shrubbery/nucleus'

registerRenderableComponentTags(['afl-broadcast', 'afl-director', 'afl-pipeline'])

/** The graph id the fossil claims; purely local, no cell anywhere. */
export const FEED_LAB_GRAPH_ID = 'atelier-feed-lab'

export const FEED_LAB: WorkspaceConfig = {
  id: 'AtelierFeedLab',
  label: 'Atelier feed lab — agent-directed video playout',
  renderedByComponent: 'app-shell',
  regions: {
    'region-top-bar': {
      id: 'region-top-bar',
      label: 'Masthead',
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
    // The spine head — the single resizable root (I1). Splits against the
    // director rail via childRegion; 0.66 vs 0.34 → the 66% divider.
    'region-broadcast': {
      id: 'region-broadcast',
      label: 'Broadcast',
      childRegion: 'region-director',
      order: 2,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 0.66,
      dockState: null,
      docksPanel: ['panel-broadcast'],
      renderedByComponent: null,
    },
    // The director rail — a spine MEMBER (broadcast's childRegion), not a root.
    'region-director': {
      id: 'region-director',
      label: 'Director',
      childRegion: null,
      order: 3,
      splitOrientation: 'vertical',
      collapsible: false,
      resizable: true,
      sizeFraction: 0.34,
      dockState: null,
      docksPanel: ['panel-director'],
      renderedByComponent: null,
    },
    // Bottom chrome — the rolling-generation pipeline band. The runtime keys
    // bottom chrome on this exact region id.
    'region-bottom-bar': {
      id: 'region-bottom-bar',
      label: 'Pipeline',
      childRegion: null,
      order: 4,
      splitOrientation: 'horizontal',
      collapsible: false,
      resizable: false,
      sizeFraction: 0.1,
      dockState: null,
      docksPanel: ['panel-pipeline'],
      renderedByComponent: null,
    },
  },
  panels: {
    'panel-broadcast': {
      id: 'panel-broadcast',
      label: 'Live composition',
      dockState: 'docked',
      defaultVisible: true,
      renderedByComponent: 'afl-broadcast',
    },
    'panel-director': {
      id: 'panel-director',
      label: 'Sequence director',
      dockState: 'docked',
      defaultVisible: true,
      renderedByComponent: 'afl-director',
    },
    'panel-pipeline': {
      id: 'panel-pipeline',
      label: 'Rolling generation',
      dockState: 'docked',
      defaultVisible: true,
      renderedByComponent: 'afl-pipeline',
    },
  },
  dimensions: {},
  rootRegions: ['region-top-bar', 'region-broadcast', 'region-bottom-bar'],
}
