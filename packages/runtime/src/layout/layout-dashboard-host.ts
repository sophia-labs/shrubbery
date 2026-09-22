/**
 * layout-dashboard-host.ts — the serialized FRAGMENT-REGION marker.
 *
 * `LAYOUT_DASHBOARD_COMPONENT` ('sh-layout-dashboard') is the config MARKER: a
 * `sux:` WorkspaceConfig region whose `renderedByComponent` names this tag
 * declares "this region's subtree is a graph-authored layout fragment"
 * (`ux:layoutJson` under the region's `sux:fragmentSurface`, or the shell's
 * default surface). The tag is in the nucleus KNOWN_COMPONENTS catalog (so
 * validateConfig I7 admits a cell-authored config carrying it) and round-trips
 * through the existing serialize/parse pair as an ordinary region
 * `renderedByComponent` literal.
 *
 * HISTORY: this module once ALSO defined a custom HOST ELEMENT of the same
 * tag, whose one job was to drive a shell-supplied opaque dashboard mount (a
 * NESTED `LayoutInterpreter` behind a `mount(target) → { destroy() }` seam).
 * The Surface unification removed that path entirely: a fragment region's
 * document is now SPLICED into the ONE workspace Surface LayoutDocument
 * (`render-workspace.ts` + `fragment-splice.ts`), mounted by the same
 * interpreter as every other leaf. The marker name is retained VERBATIM — the
 * deployed observatory seed (and any other graph authored against it) keeps
 * rendering with zero migration. No custom element is registered under this
 * tag anymore; the tag never reaches the DOM on the Surface path (the marker
 * is consumed at assembly), and the legacy non-Surface path stamps it as the
 * same honest inert placeholder it always stamped for unregistered tags.
 */

/** The serialized fragment-region config marker. */
export const LAYOUT_DASHBOARD_COMPONENT = 'sh-layout-dashboard'
