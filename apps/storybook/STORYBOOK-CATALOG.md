# Storybook ⇄ Manifest: one catalog, two faces

_Iteration 3c. Where Shrubbery's Storybook and its component-library MANIFEST
stop being two things and become one catalog seen from two sides — the seed for
"Storybook-as-Emporium-catalog."_

## The premise (load-bearing)

Shrubbery already has a **registry-as-data manifest**:
`packages/nucleus/src/workspace/component-library.ts` → `COMPONENT_LIBRARY`,
a frozen `tag → { persistence, … }` table that the engine reads to decide how to
treat each component (stamp vs. position-anchor vs. float).

Storybook is the **rendered, reviewable** view of components.

These are **not two registries**. They are **one catalog with two faces**:

| Face | Source | Answers | Mutable by |
|------|--------|---------|-----------|
| **Manifest** | `COMPONENT_LIBRARY` (nucleus) | _What_ components exist, _how_ the engine treats them (persistence class), the binding seam | fixed code only |
| **Storybook** | the `.stories.ts` + the catalog grid | What each component _looks like_, rendered, skinnable, reviewable | tooling only |

The rule that ties them: **every manifested component must be visible in the
catalog** — built ones render live, unbuilt ones render as inert, clearly-labeled
placeholders (never faked).

## How coherence is enforced (no drift)

There is a single derived list — `apps/storybook/catalog/catalog-model.ts` →
`CATALOG_ENTRIES` — built **directly from** `COMPONENT_LIBRARY` (plus the
built component sets). Both faces read it:

```
COMPONENT_LIBRARY (manifest)
        │  derive
        ▼
   CATALOG_ENTRIES  ──────────────┐
        │                         │
        │ map → stories           │ assert coverage
        ▼                         ▼
 catalog.stories.ts        catalog-coherence.test.ts
 (the Storybook face)      (the guard: every manifested
                            component has an entry AND a story)
```

- `stories/catalog.stories.ts` **generates** the catalog grid + one per-entry
  story from `CATALOG_ENTRIES`. It is impossible to render the catalog and omit a
  manifested component, because the grid maps over the derived list. **No
  hand-written mock arg bags** — each card renders the real `@customElement` (or
  an inert placeholder if the tag isn't built in Shrubbery yet).
- `catalog/catalog-coherence.test.ts` is the **coherence TEST**: it asserts every
  `COMPONENT_LIBRARY` key has a catalog entry _and_ a generated story, that the
  per-entry stories cover the entries exactly, and that built/unbuilt is reported
  honestly (chrome is registered; the manifest panels are not yet lifted → inert).
  Add a manifest row without its catalog story and this test fails.

So the manifest is the source of truth; the catalog cannot silently fall behind.

### Today's catalog

| tag | face | manifested? | built in Shrubbery? | persistence |
|-----|------|-------------|---------------------|-------------|
| `mn-top-bar` | built-chrome | no¹ | **yes** (live) | stamp |
| `mn-bottom-bar` | built-chrome | no¹ | **yes** (live) | stamp |
| `mn-chip` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-badge` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-sparkline` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-ribbon` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-card` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-relations` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-graph` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-spinner` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-loading` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-empty-state` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-input` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-textarea` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-search-input` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-tooltip` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-avatar` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-panel-header` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-dropdown-button` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-inline-edit` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-toast` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-modal` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-dialog` | general-primitive | no¹ | **yes** (live) | stamp |
| `mn-document-editor` | manifest-panel | **yes** | no → inert placeholder | persistent-relocatable (B) |
| `mn-graph-panel` | manifest-panel | **yes** | **yes** (live) | persistent-non-relocatable |

¹ Chrome and general primitives are Class-A `stamp` by default and need no special
engine treatment, so they are not in the engine persistence manifest — but they
_are_ part of the one catalog, so the catalog face lists them.
`isRegisteredComponent` (manifested?) and `isBuilt` (rendered live?) are
deliberately **different questions**, and the catalog shows both.

## Skin × theme = RDF dimensions, not a Storybook gimmick

The Storybook toolbar globals (`skin`: garden/emporium, `theme`: light/dark) are
**the sux `ConfigDimensions`**. Selecting one calls `applySkinTheme` (from
`@shrubbery/tokens`), which stamps `data-skin` / `data-theme` on the preview root
via the exact `ConfigValue.appliesAttribute` rule the engine uses — and the whole
catalog re-skins through the real token cascade. The industry-standard Storybook
theme switcher _is_ our RDF dimension. Flip Skin to see Emporium's dark-purple
chrome rendered for review.

## The seed: Storybook-as-Emporium-catalog

This is the **seed**, not the building. Later, Emporium views will **incorporate
and mutate** these catalog components by **binding RDF** to them — config (which
panel docks where), data (what flows into a panel), and skin (how it looks) — so
a catalog component becomes a live, RDF-driven surface inside an Emporium. The
binding seam already exists in `component-library.ts` (see its header: "the seam
where Emporium packs will later bind components BY DATA").

**That binding flow is intentionally NOT built in 3c.** What 3c plants is the
prerequisite: a **coherent, complete catalog** with a manifest face and a
Storybook face that provably cannot drift. You can't bind RDF to a catalog you
can't trust to be complete; now it is.

## Real-browser guard (Playwright)

`@storybook/test-runner` drives a **real Chromium** against the built Storybook:

- `pnpm build-storybook` — builds the static catalog.
- `pnpm test-storybook:ci` — serves it and runs the test-runner: every story must
  render without error, and the **chrome stories are exercised across both
  skins** (`.storybook/test-runner.ts` flips the skin on the preview root and
  asserts the skin-aware chrome re-skins — the live `--mn-color-accent` differs
  between Garden and Emporium, a computed-style check only a real browser can
  make).
- `Regression/Fetch binding (9a3c9aa)` — a real-browser regression guard for the
  fetch-binding bug fixed in commit `9a3c9aa`. Its `play` step constructs the
  real `LoopbackMcpClient` in **browser `fetch` mode** and invokes the fetch path
  same-origin; pre-fix (unbound `globalThis.fetch`) this throws _"Illegal
  invocation"_ and fails. Verified to catch the regression (reverting the fix
  fails the guard; restoring it passes).

## Deferred (with reason)

**STRETCH: drive the iter-2 fetch path against a live `gardend` cell.** Deferred.
The defect `9a3c9aa` exposed was specifically the **browser fetch _binding_** —
which the regression guard above covers directly, in a real browser, without a
cell. Spinning a live `gardend` (a ~173 MB binary, random loopback port + bearer,
a same-origin Vite proxy wired into the Storybook dev server) inside the
Playwright flow is brittle and duplicates what already exists: the organism's
`tests/gardend-liveread.integration.test.ts` exercises a real cell round-trip
(node-http path), and `scripts/gardend-liveread.live.mts` is the runnable live
browser-path script. The remaining gap (the browser fetch binding) is guarded
here; the full live-cell-in-Storybook variant is a future iteration if a
browser-path live regression is ever needed in CI.

**EDITOR HOST (LIVE) — real-browser outliner and undo affordance audit.**
Covered. `stories/editor-host-live.stories.ts` still carries the rung-B2
probeable organism: the REAL `<sh-editor-host>` over a REAL `new Y.Doc()`.
It includes `OutlinerAffordanceAudit`, a browser-only `play()` check for the
Garden PR #4 live-audit geometry class: real `getBoundingClientRect()` geometry on
the fold button and block rows, parent fold strip not leaking into block-wire
requests while toggling collapse/expand, leaf gutter wire clicks still firing,
collapsed descendants hidden, collapsed-count pill staying inline with the parent row, and zoom breadcrumb
geometry/text after `zoomIntoBlock()`. `OutlinerInteractionAudit` covers the
remaining local-Playwright parity surface in the same real host/editor DOM:
keyboard fold activation, block-handle selection + Escape enter/clear semantics,
drag/drop indicator + child reparenting, shift-gutter zoom, and Home crumb zoom-out.
`OutlinerEscapeGateAudit` covers the shell-owned overlay gate: when the host passes
`isOverlayOpen`, Escape falls through instead of entering block selection. It also
includes `UndoKeystrokeAudit`; Storybook's Playwright `postVisit` hook drives
`page.keyboard.type()` followed by the platform undo chord (Meta-z on macOS, Ctrl-z
elsewhere) and asserts the live collaborative editor removes the browser-inserted
text. These checks stay in Storybook's Chromium lane because happy-dom returns zero
layout rects and cannot prove physical OS keymaps.

## Files

- `packages/nucleus/src/workspace/component-library.ts` — the MANIFEST (source of truth).
- `apps/storybook/catalog/catalog-model.ts` — the single derived catalog (the seam both faces read).
- `apps/storybook/stories/catalog.stories.ts` — the Storybook face (generated from the model).
- `apps/storybook/catalog/catalog-coherence.test.ts` — the coherence guard (manifest ⇄ catalog ⇄ stories).
- `apps/storybook/.storybook/{main,preview,test-runner}.ts` — Storybook + Playwright config.
- `apps/storybook/stories/fetch-binding-guard.stories.ts` — the 9a3c9aa real-browser regression guard.
