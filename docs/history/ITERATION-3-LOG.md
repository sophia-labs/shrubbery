# Shrubbery — Iteration 3 Log

**Date:** 2026-06-19
**Branch:** `main` (shrubbery is its own git repo with an "iteration N" commit convention)
**Commits:** 3a `143f5e9` · 3b `4a599f6` · 3c `417b457`

Iteration 3 took Shrubbery from "a backend-free component library with chrome" to
"a **skinnable** component library with a real design-token system, two skins
(Garden + a proposed Emporium), skin-aware chrome, a Storybook catalog derived
from the manifest, and a real-browser (Playwright) acceptance pass." It was
executed in three sub-steps (3a → 3b → 3c).

---

## 1. What was built

### 3a — Design-token system + Garden/Emporium skins (`143f5e9`)

Created **`@shrubbery/tokens`**: a layered CSS design-token system adapted (not
copied) from `garden/frontend/src/index.css`, with five tiers:

```
reference  (Tier 0, raw ramps — fern/cobalt/purple/parchment/ink/status)
   ↓
semantic   (Tier 1, role tokens — --mn-color-accent, --mn-row-height, …)
   ↓
component  (Tier 2, per-surface — chrome bars, controls)
   ↓
theme      ([data-theme=dark] overrides)
   ↓
skin       ([data-skin=garden|emporium] identity recolor + structure)
```

Plus a tiny TS applier (`src/index.ts` → `applySkinTheme({ skin, theme })`) that
stamps `[data-skin]` / `[data-theme]` on the root, tied to the sux
`ConfigValue.appliesAttribute` pattern. `skin` and `theme` are **orthogonal**
dimensions (Garden-dark, Emporium-light, etc. all compose).

Two skins:
- **Garden** (default — `[data-skin]` absent): fern accent, Literata, rounded
  shoulders, spacious rows, captioned labels.
- **Emporium** (`[data-skin=emporium]`, with `[data-design=emporium]` alias): the
  sophia design-language **structure verbatim** (ABC Diatype, square / no-radius,
  tight 24px density, icon-only labels, stronger Albers rules, cool Swiss
  surfaces) — with **only** the accent/identity ramp recolored from cobalt to a
  new dark-purple ramp (see §2).

Also wired the real `tokens.css` + a live skin/theme picker into `apps/organism`
(replacing the old cosmetic stub token block), and stood up a net-new Storybook
(`@storybook/web-components-vite`) with skin × theme toolbar globals and Tokens /
Chrome / Workspace stories.

### 3b — Skin-aware chrome (`4a599f6`)

Made `mn-top-bar` and `mn-bottom-bar` consume the skin **role tokens**
(`--mn-control-height` / `--mn-row-height`, `--mn-radius-control` /
`--mn-radius-surface`, `--mn-label-display`, `--mn-chrome-rule` / `--mn-rule-line`)
instead of hardcoded `32px / 18px / radius-md`. There is **no per-skin color code
in the components** — accent/font/surface flow in for free through inherited
`--mn-*` custom properties.

Added a backend-free **`SkinAware`** mixin (`packages/components/src/skin-aware.ts`,
`lit` type-import only) that mirrors the nearest-ancestor / `<html>` skin/theme
attributes onto each component's own host and observes the root via
`MutationObserver`, so `:host([data-skin=emporium])` lights up **portably** (no
`:host-context()`, which Firefox lacks and happy-dom can't compute) and the skin
difference is **DOM-observable without a paint engine**. Captions are wrapped in
label spans gated by `--mn-label-display`; the caption text stays in the DOM for
a11y even when display-toggled off.

### 3c — Storybook catalog seed + Playwright (`417b457`)

The load-bearing net-new work was **catalog coherence**:
- `apps/storybook/catalog/catalog-model.ts` derives `CATALOG_ENTRIES` straight
  from the component-library `MANIFEST` (`COMPONENT_LIBRARY`) plus the built-chrome
  set.
- `apps/storybook/stories/catalog.stories.ts` **generates** the catalog grid + one
  per-entry story from that model — no hand-written arg bags. Built chrome renders
  live; manifested-but-unbuilt panels render as **inert placeholders**.
- `apps/storybook/catalog/catalog-coherence.test.ts` (11 tests) asserts every
  manifested component has both a catalog entry and a generated story — so
  Storybook and the manifest are provably **one catalog with two faces that can't
  drift**.

Plus the real-browser layer: added `@storybook/test-runner` (Playwright /
Chromium). `build-storybook` + `test-storybook:ci` serve the static catalog and
render all stories in a real browser; a test-runner hook exercises the chrome
stories across **both** skins and asserts the live `--mn-color-accent` differs
Garden vs Emporium (a computed-style check only a real browser can make). Also
added a **fetch-binding regression guard** (`fetch-binding-guard.stories.ts`) for
the `9a3c9aa` bug — it runs the real `LoopbackMcpClient` browser-fetch path
same-origin and was verified to **fail when the fix is reverted, pass when
restored**.

### Honest test / build counts

| Suite | Tests | Notes |
|-------|------:|-------|
| `@shrubbery/tokens` | 23 | net-new in 3a (CSS var resolver, purple ramp, Emporium blocks, dark overrides) |
| `@shrubbery/nucleus` | 166 | untouched |
| `@shrubbery/runtime` | 28 | untouched |
| `@shrubbery/components` | 49 | 32 prior + 17 new (3b skin-aware) |
| `apps/organism` | 6 | untouched at library level |
| `apps/storybook` | 11 | net-new in 3c (catalog coherence) |
| **Total unit (vitest)** | **283** | green |

- **Baseline correction:** the prompt quoted 232 prior tests; the actual baseline
  entering 3a was already higher. The honest arc is **232 → 255 (3a, +23) → 272
  (3b, +17) → 283 (3c, +11)**.
- **Real-browser (Playwright via `@storybook/test-runner`, Chromium):** **15/15
  stories pass** across 5 suites, including the chrome stories in both skins and
  the `9a3c9aa` fetch-binding regression guard.
- **Builds:** `pnpm -r build` typechecks clean (`tsc --noEmit` exit 0 across
  packages); `apps/organism` Vite build emits `dist/`; `build-storybook` emits
  `storybook-static/` (gitignored); `storybook dev` serves HTTP 200.

> **Testing honesty caveat (load-bearing):** happy-dom does **not** resolve CSS
> `var()` / cascade across `[data-skin=…]` attribute selectors, and
> `getComputedStyle` returns nothing for custom-property chains. So the unit tests
> assert (a) the **CSS source** — parsed + `var()`-resolved through the ramp — and
> (b) the skin-awareness **wiring** (mirrored host attributes differ per skin,
> shadow CSS consumes the role tokens). The actual **computed** re-skin (live
> `--mn-color-accent` differing per skin) is asserted **only** in the real
> Chromium Playwright pass — which is exactly why 3c added it.

---

## 2. The proposed dark-purple ramp (PROPOSAL — for Vera to review rendered)

> **This is a PROPOSAL, not a final palette.** The structure of the Emporium skin
> is locked (it is the sophia design language verbatim); only the **accent hue**
> is up for review. The hexes below were chosen so Vera can tune them in **one
> place** (`packages/tokens/css/reference.css` → `--mn-ref-purple-*`, mirrored in
> `src/index.ts`) after seeing them rendered.

### The exact ramp implemented

```
--mn-ref-purple-50:  #F5F3FB
--mn-ref-purple-100: #E9E3F6
--mn-ref-purple-200: #D2C4ED
--mn-ref-purple-300: #B59FE0    ← rule-strong (Albers frame), dark-theme accent
--mn-ref-purple-400: #9472CE
--mn-ref-purple-500: #6D28D9    ← accent (light theme)
--mn-ref-purple-600: #5B21B6
--mn-ref-purple-700: #4C1D95    ← accent-strong (light theme)
--mn-ref-purple-800: #3B1577
--mn-ref-purple-900: #2A0E57
```

### How it maps to roles

| Role token | Light theme | Dark theme |
|------------|-------------|------------|
| `--mn-color-accent` | `purple-500` **#6D28D9** | lightened to `purple-300` **#B59FE0** |
| `--mn-color-accent-strong` | `purple-700` **#4C1D95** | (dark override) |
| `--mn-color-rule-strong` (Albers frame) | `purple-300` **#B59FE0** | — |
| top-bar BG (light) | `purple-50` **#F5F3FB** | cool dark Swiss surface |
| top-bar text (light) | `purple-700` **#4C1D95** | cool light on cool dark |

The dark-theme accent is **lightened** to `purple-300` for contrast on a dark
ground — directly mirroring how garden lightens its cobalt accent in dark mode.

### How to view it rendered (please do this before signing off)

1. Run Storybook (see §4).
2. In the Storybook toolbar, set the **Skin** global to **`emporium`** and toggle
   **Theme** between **light** and **dark**.
3. Look at, in order:
   - **Tokens → Emporium Purple Ramp** — the raw swatches + the live semantic
     roles (`--mn-color-accent`, `accent-strong`, `rule-strong`) resolved through
     the cascade.
   - **Chrome → Skin Contrast** — Garden and Emporium top/bottom bars side by side
     in their own `[data-skin]` hosts; the accent, frame rule, density, radius,
     font, and label treatment all change.
   - **Workspace** — the full shell under Emporium.
4. Or in `apps/organism` (the live shell): run it and flip the chrome
   skin/theme toggle — `applySkinTheme()` re-skins through the real token cascade.

If the accent reads too violet / too dark / too saturated, tune **only**
`--mn-ref-purple-500` (light accent) and `--mn-ref-purple-300` (frame + dark
accent) in `reference.css`; everything else is derived.

---

## 3. Verdicts

### No-mock — **PASS**

- Storybook stories render from **real** config / real custom elements — no
  hand-written mock arg bags. The catalog grid is **generated from the manifest**;
  chrome stories render the real `mn-top-bar` / `mn-bottom-bar`; the Workspace
  story renders the real `GARDEN_DEFAULT` / `GARDEN_VARIANT` library configs via
  the real `renderWorkspace`; the Tokens stories render live CSS vars resolved
  from the real cascade.
- Manifested-but-unbuilt panels (`mn-document-editor`, `mn-graph-panel`) render as
  **inert, labeled placeholders** — never faked content.
- The skin re-color is verified in a **real browser** (Playwright computed-style),
  not asserted from a mock.
- The `9a3c9aa` regression guard runs the **real** `LoopbackMcpClient` browser
  fetch path.

### Boundary — **PASS**

- The pure library (`nucleus` / `runtime` / `components` / `tokens`) stays
  **backend-free**. The ISLAND test enforces `lit` + `nucleus` (types) only; zero
  imports of gardend / HTTP / auth / Tauri / stores / MCP. `skin-aware.ts` uses a
  `lit` **type-import only**.
- The skin contract crosses the boundary as **CSS-var + attribute names only** —
  components cannot import `@shrubbery/tokens` (island guard forbids it), so there
  is no runtime coupling between tokens and components.
- Storybook / Playwright config lives at **app/tooling level** (`apps/storybook/`),
  not in `packages/`. The toolbar globals **are** the sux `ConfigDimensions`
  (stamped via `ConfigValue.appliesAttribute`, re-skinning through the real
  cascade).

### Catalog coherence — **PASS**

- The manifest (`COMPONENT_LIBRARY` in `packages/nucleus`) is the single
  source of truth. `CATALOG_ENTRIES` is **derived** from it (manifest + built
  chrome). Both faces — the Storybook grid and the coherence test — read this one
  list.
- 11 coherence tests assert: every manifested component has a catalog entry **and**
  a generated per-entry story; per-entry stories cover entries exactly (no drift,
  no stray exports); every entry has a matching CSF export; built chrome is
  registered; unbuilt panels are honestly **not** registered.
- Net effect: **add a manifest row → catalog grid + per-entry story + coherence
  assertion all pick it up automatically; the catalog cannot silently fall behind
  the manifest.**

---

## 4. How to run Storybook

From the repo root (`/Users/vera/dev/sophia/shrubbery`):

```bash
# install (workspace-wide, pnpm only — never npm)
pnpm install

# dev server (hot reload) — http://localhost:6010
pnpm --dir apps/storybook storybook

# static build → apps/storybook/storybook-static (gitignored)
pnpm --dir apps/storybook build-storybook

# real-browser acceptance (Playwright/Chromium against the static build)
pnpm --dir apps/storybook build-storybook
pnpm --dir apps/storybook test-storybook:ci
```

In the running Storybook, use the **Skin** (`garden` / `emporium`) and **Theme**
(`light` / `dark`) toolbar globals to switch axes — they apply via the real
`applySkinTheme()` through the real token cascade. To review the purple proposal,
set Skin = **emporium** and open **Tokens → Emporium Purple Ramp** and **Chrome →
Skin Contrast** (see §2).

---

## 5. Iteration-4 recommendation: lift the first REAL panel into the framework

The token system is proven and both chrome skins are live, but the catalog today
is **chrome + placeholders**. The next step is **not** cosmetic refinement — it is
the first **real, backend-coupled, skin-aware panel**, with a no-mock acceptance
gate. This is what lifts the abstraction from "a catalog of placeholders" to "a
catalog of real, wired, skin-aware panels that actually edit data."

**Lift `mn-document-editor` first** (the simpler manifested panel — TipTap,
DOM-bound state, **no** GPU/WebGL context lifecycle, unlike `mn-graph-panel`):

1. **Port the real component** into `packages/components/src/mn-document-editor.ts`
   from garden's document panel — real TipTap, real Y.Doc CRDT, real Hocuspocus
   transport to a gardend cell (loopback or live). Zero mocking. Lands both skins
   (Garden: Literata, spacious, light frame · Emporium: Diatype, tight 24px rows,
   square, dark-purple frame). **Note** this is the panel that will most stress the
   island boundary — keep CRDT/transport wiring at the `apps/organism` shell layer
   and the component consuming injected state, so the island guard still holds.
2. **Auto-wire the catalog**: mark `mn-document-editor` as `isBuilt`. Because the
   catalog is derived, the grid + per-entry story update with no hand-written CSF;
   `catalog-coherence.test.ts` auto-asserts the entry is now live (and catches a
   forgotten import).
3. **Real-browser acceptance** (extend `.storybook/test-runner.ts`): type a
   character into the live editor, assert it lands in the doc state, **flip the
   skin mid-edit**, and assert the editor re-skins (font / frame / density)
   **without losing the character**. The edit itself is the regression guard.

This proves the real backend-wiring path (CRDT transport + gardend loopback +
in-browser state mutation under Playwright) and the skin-aware-panel path (a
document editor is far more token-surface than chrome: toolbar, gutter, editable
body), and it establishes the **acceptance-gate pattern** for every future panel —
without taking on `mn-graph-panel`'s THREE.js/WebGL lifecycle yet (that's
iteration 5). It also unblocks **Emporium bind-by-data**: once panels are real,
Emporium packs can mutate them by RDF (config what docks where, data what flows
in, skin how it looks).
