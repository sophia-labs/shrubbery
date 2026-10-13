/**
 * ux-config.ts — AVIARY's layout, authored as a `sux:` WorkspaceConfig.
 *
 * This is the AUTHORING form only. It is never handed to `renderWorkspace`
 * directly: the shell serializes it to `sux:` triples (aigua-plugin.ts), serves
 * them over the read seam, and the browser reads them back through the REAL
 * codec — `ntHttpSource.read()` → `triplesOf` → `parseTriplesToConfig` →
 * `renderWorkspace` (which calls `planFor`). So the layout the user sees is
 * genuinely a projection of RDF, and a broken predicate breaks the page rather
 * than being quietly bypassed by an in-memory object.
 *
 * The interpreter contract this config satisfies (planFor / validateConfig):
 *   - EXACTLY ONE resizable root (I1) — `region-stage`, the spine head.
 *   - Chrome roots are `resizable: false`; `order` decides where planFor puts
 *     them: order < the head's → topChrome, order > → bottomChrome.
 *   - `region-rail` is chrome at order 1, so it renders as a vertical pane
 *     inside `.main` to the LEFT of the spine (the rhizome arrangement).
 *   - Every spine `sizeFraction` is in (0,1) (I6).
 *
 * The `dim-skin` / `dim-theme` dimensions are load-bearing, not decoration: the
 * app bar builds its appearance controls by READING THEM OUT OF THE GRAPH, with
 * each value's `appliesAttribute` taken verbatim from `@shrubbery/tokens`'s own
 * application map. Adding a skin is a triple, not a code change.
 */

import type { ConfigDimensionValue, WorkspaceConfig } from '@shrubbery/nucleus'
import { SKIN_APPLICATIONS, THEME_APPLICATIONS, type Skin, type Theme } from '@shrubbery/tokens'

// The render-gate registration for AVIARY's own tags. Imported (not inlined) so
// the authored config and the gated tag set are one fact — see aviary-tags.ts
// for why it does not live in this module the way rhizome's does.
export { AVIARY_TAGS } from './aviary-tags.js'

/**
 * The TOP BAR is deliberately not an app-owned tag: `mn-app-bar` is a real
 * vetted `@shrubbery/components` primitive that already does masthead + crumbs
 * + search + theme toggle + skin picker, so AVIARY wears it rather than growing a
 * fourth element of its own.
 */

/** The skins AVIARY offers, in the order the bar shows them. */
export const AVIARY_SKINS: readonly Skin[] = [
  'garden',
  'emporium',
  '98',
  'glass',
  'hotdog-stand',
  'research',
  'greenhouse',
  'observatory',
]
export const AVIARY_THEMES: readonly Theme[] = ['light', 'dark']

export const DEFAULT_SKIN: Skin = 'garden'
export const DEFAULT_THEME: Theme = 'light'

const skinValue = (skin: Skin): ConfigDimensionValue => ({
  id: `val-skin-${skin}`,
  literalValue: SKIN_APPLICATIONS[skin].literalValue,
  // VERBATIM from the tokens package — the graph and the applier cannot drift.
  appliesAttribute: SKIN_APPLICATIONS[skin].appliesAttribute,
})

const themeValue = (theme: Theme): ConfigDimensionValue => ({
  id: `val-theme-${theme}`,
  literalValue: THEME_APPLICATIONS[theme].literalValue,
  appliesAttribute: THEME_APPLICATIONS[theme].appliesAttribute,
})

/** The AVIARY workspace — the authoring form of the `:ux:config` graph. */
export function aviaryWorkspaceConfig(): WorkspaceConfig {
  return {
    id: 'Aviary',
    label: 'Aviary — aigua field-recording library',
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
      // The LEFT RAIL — chrome at order 1 (< the spine head's 2), so planFor
      // partitions it into topChrome and the runtime lays it out inside `.main`
      // to the left of the spine.
      'region-rail': {
        id: 'region-rail',
        label: 'Voices',
        childRegion: null,
        order: 1,
        splitOrientation: 'vertical',
        collapsible: false,
        resizable: false,
        sizeFraction: 0.22,
        dockState: null,
        docksPanel: ['panel-rail'],
        renderedByComponent: null,
      },
      // The single resizable root — the spine head (I1).
      'region-stage': {
        id: 'region-stage',
        label: 'Stage',
        childRegion: null,
        order: 2,
        splitOrientation: 'vertical',
        collapsible: false,
        resizable: true,
        sizeFraction: 0.86,
        dockState: null,
        docksPanel: ['panel-stage'],
        renderedByComponent: null,
      },
      // The transport — chrome at order 3 (> the head's 2) → bottomChrome.
      // The id is `region-bottom-bar` because the runtime's legacy frame gates
      // its <footer> on EXACTLY that id (render-workspace.ts's `hasBottomBar`);
      // the TAG is free, and `renderChromeSurface` falls through to
      // `stampPanelBody` for anything that is not mn-top-bar / mn-bottom-bar.
      'region-bottom-bar': {
        id: 'region-bottom-bar',
        label: 'Transport',
        childRegion: null,
        order: 3,
        splitOrientation: 'horizontal',
        collapsible: false,
        resizable: false,
        sizeFraction: 0.08,
        dockState: null,
        docksPanel: [],
        renderedByComponent: 'av-transport',
      },
    },
    panels: {
      'panel-rail': {
        id: 'panel-rail',
        label: 'Voices',
        dockState: 'docked',
        defaultVisible: true,
        renderedByComponent: 'av-rail',
      },
      'panel-stage': {
        id: 'panel-stage',
        label: 'Stage',
        dockState: 'docked',
        defaultVisible: true,
        renderedByComponent: 'av-stage',
      },
    },
    dimensions: {
      'dim-skin': {
        id: 'dim-skin',
        label: 'Skin',
        defaultValue: DEFAULT_SKIN,
        values: AVIARY_SKINS.map(skinValue),
      },
      'dim-theme': {
        id: 'dim-theme',
        label: 'Theme',
        defaultValue: DEFAULT_THEME,
        values: AVIARY_THEMES.map(themeValue),
      },
    },
    rootRegions: ['region-top-bar', 'region-rail', 'region-stage', 'region-bottom-bar'],
  }
}
