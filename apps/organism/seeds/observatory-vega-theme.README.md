# `ux:vegaTheme` — chart grammar as data

This directory has one deployed seed (`observatory-workspace.ux.nt`, the
`sux:Workspace` region config) and, as of this pass, one NEW convention this
file documents: `ux:vegaTheme`, an OPTIONAL graph-authored override for the
house Vega-Lite chart theme every `chart.vega-lite` face on a graph draws
from. There is no `.nt` seed for it — the whole point of this convention is
that **no graph needs to author one**. The in-repo default
(`packages/runtime/src/editor-services/vega-theme.ts`'s `buildVegaTheme`)
already makes every existing chart in `observatory-dashboard-document.ts`
conform, in both light and dark mode, with zero graph authoring. This file is
for the graph that wants to deviate from the default.

## The convention

Same subject, same named graph, sibling predicate to `ux:layoutJson` — see
`apps/organism/src/harness/observatory-layout-source.ts`'s own header for the
full rationale (this file mirrors it, not duplicates it):

| | |
|---|---|
| subject | `<urn:sophia:ux:surface:observatory-dashboard>` (or any other `sux:fragmentSurface` IRI) |
| predicate | `ux:vegaTheme`  (`PREFIX ux: <http://mnemosyne.dev/ux#>`) |
| named graph | `urn:mnemosyne:local:graph:{graph_id}:ux:config` — the SAME `:ux:config` slot `ux:layoutJson` and the `sux:` workspace-config vocabulary already share |
| value | ONE string literal: a JSON-serialized, PARTIAL Vega-Lite theme override |

It is a **sibling** triple, never nested inside the `ux:layoutJson` JSON
itself — re-authoring the theme never touches (or risks corrupting) the
layout document's own uniqueness/validation contract, and the two can be
authored independently by different tools/agents.

**Optional everywhere.** Unlike `ux:layoutJson` (whose absence is only a
non-error fallback for the one well-known default surface), a missing
`ux:vegaTheme` is a non-error fallback for **every** surface — a theme is
never required.

**Merge, not replace.** The parsed JSON object is merged one level deep over
the in-repo default (`buildVegaTheme(mode)`), key by key — you only need to
author the keys you actually want to change; everything else keeps the house
default. See `mergeVegaTheme` in `vega-theme.ts`.

**Closed at the top level, and closed HARDER on the color law.** Every
top-level key must be one of `VEGA_THEME_OVERRIDE_KEYS` (`font` / `view` /
`axis` / `legend` / `title` / `mark` / `bar` / `point` / `line` / `area`) —
an unknown key is rejected as an authoring error
(`validateVegaThemeOverride`, whose reason string the loader surfaces
verbatim), not silently dropped. Two further rejections are deliberate:

- **`range.*` and `background` are NOT graph-themable.** They ARE the chart
  color law — the machine-validated categorical/sequential/diverging
  palettes and the exact surface they were validated against. Palette-level
  theming stays closed until there is a runtime story for re-validating an
  authored palette the way the house one was validated (CVD simulation +
  contrast, both modes); a JSON literal in a graph can carry hexes, but
  nothing at load time can today prove they keep the laws.
- **Mark colors (`color`/`fill`/`stroke` under `mark`/`bar`/`point`/`line`/
  `area`/`view`) are NOT graph-themable** — a mark color is a palette
  assignment by another door.

What remains — deliberately — is the STYLE surface: typography, sizes,
padding, orientation, and axis/grid/legend style (including their hairline
grid/label inks, which are chrome, not data encoding).

**Style colors still come from published values.** Where a style key does
carry a color (e.g. `axis.gridColor`), copy the exact literal value of a
published `packages/tokens` step and say which one — the same
copy-with-provenance discipline `vega-theme.ts` itself uses. Hand-picked
hexes bypass the contrast validation the rest of the theme was checked
against.

## Example literal (the JSON value of the `ux:vegaTheme` triple)

```json
{
  "axis": {
    "gridColor": "rgba(64, 61, 56, 0.11)"
  },
  "legend": {
    "orient": "top"
  }
}
```

(That `gridColor` is a copy of the published light-mode
`--mn-color-border-subtle` literal — `packages/tokens/css/semantic.css` —
promoting the grid from the house theme's fainter recessive step to the full
hairline-border step. Copied value + named provenance, never an eyeballed
hex.)

## Authoring it durably

Read: `loadObservatoryVegaTheme` (`observatory-layout-source.ts`) — same
honest trichotomy as the layout loader (`source: 'graph' | 'fallback'`, or
throws on a real authoring error — see that function's own doc comment).

Write: `persistVegaTheme` / `buildVegaThemePersistUpdate`
(`observatory-layout-sink.ts`) — the same `DELETE WHERE` + `INSERT DATA`
replace-not-append shape `persistLayoutDocument` uses, targeting the sibling
predicate. Example (pseudocode):

```ts
import { persistVegaTheme } from '../harness/observatory-layout-sink.js'

await persistVegaTheme(rest, { graphId }, {
  // the published light-mode --mn-color-border-subtle literal (see above)
  axis: { gridColor: 'rgba(64, 61, 56, 0.11)' },
})
```

A raw `sparql_update` (e.g. via MCP, for a one-off manual seed) looks like:

```sparql
PREFIX ux: <http://mnemosyne.dev/ux#>
DELETE WHERE {
  GRAPH <urn:mnemosyne:local:graph:{graph_id}:ux:config> {
    <urn:sophia:ux:surface:observatory-dashboard> ux:vegaTheme ?vegaTheme .
  }
} ;
INSERT DATA {
  GRAPH <urn:mnemosyne:local:graph:{graph_id}:ux:config> {
    <urn:sophia:ux:surface:observatory-dashboard> ux:vegaTheme
      "{\"axis\":{\"gridColor\":\"rgba(64, 61, 56, 0.11)\"}}" .
  }
}
```

## Where it actually applies

`apps/organism/src/cell/workspace-fragments.ts`'s `#load()` fetches
`ux:vegaTheme` in parallel with `ux:layoutJson` (same subject, one round
trip's worth of extra latency avoided) and stores it ON the region's own
state (`WorkspaceFragmentRegion.vegaTheme`). The theme is SCOPED, never
global:

1. `render-workspace.ts` registers each render pass's per-REGION themes
   against the surface root element (`setVegaThemeScopeOverrides` in
   `packages/runtime/src/editor-services/query-block-vega.ts`) — always the
   CURRENT pass's map, so a dropped region/session clears with the pass
   that dropped it;
2. every `chart.vega-lite` mount resolves its OWN region's theme by walking
   the composed tree from the chart to its `frag:{regionId}:…` wrapper and
   the nearest registered scope root (`resolveVegaThemeOverride`).

Two fragment regions with DIFFERENT `ux:vegaTheme` literals therefore each
get their own theme; charts outside any fragment region (an editor
QueryBlock, a standalone harness) always keep the pure house theme.
