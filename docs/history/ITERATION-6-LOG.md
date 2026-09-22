# Iteration 6 Log — apps/emporium dedicated product shell + anatomy graph view

**Date:** 2026-06-20
**Commits:** `4eb1963` (iter-6a), `3257eb6` (iter-6b) — on `main`
**Net test delta:** 469 → 522 (baseline at the start of 6a was already 492, not the stale 469 the prompt quoted)

---

## What was built

Iteration 6 turned the shrubbery Emporium work from "a live read rendered in the organism playground" into a **dedicated, designed product app** (`apps/emporium`) with a real anatomy graph view. It came in two commits.

### 6a — dedicated product shell + general top bar + nav/layout (`4eb1963`)

- **`apps/emporium` — a 4th shrubbery app.** A standalone Vite product app (its own `package.json`/`tsconfig`/`vite.config`/`vitest.config`/`index.html`/`main.ts`), added to the pnpm workspace. The document defaults to the **Emporium skin** (purple-400 `#9472CE`, Diatype, square 0px radius, tight 24px density) via `applySkinTheme`. It reads the **REAL** live `/emporium` vocab registry — no mocks, no fixtures.
- **`mn-app-bar` — a new GENERAL component** (`packages/components/src/mn-app-bar.ts`), not a copy of garden's bar. It lifts *more* of garden's real top-bar structure than the existing chrome `mn-top-bar`: masthead + glyph, a search/filter input, a controlled breadcrumb trail, and nav/actions slots. Skin-aware (mirrors ambient `[data-skin]`, lights up `:host([data-skin=emporium])` + role tokens), island-clean (no store/auth/tauri — the recursive island guard test covers it automatically). `mn-top-bar` left untouched. Catalogued in Storybook as `AppBar` + `AppBarSkinContrast` (both skins).
- **Shell / IA** — a packs **rail** (`rail-view.ts`: sidebar of live vocab packs with active-row state) + content area + breadcrumbs (Emporium → {pack} → {class}) + a tiny **hash-router** (`router.ts`) whose path grammar mirrors the curl URLs: `/emporium`, `/emporium/{pack}`, `/emporium/{pack}/{class}`. `shell.ts` wires the shared catalogue + pack-detail views, the search filter, and class deep-links.
- **Single-source-of-truth generalize move** — the shell-side live read + views were extracted into `@shrubbery/organism`'s package exports (`cell/emporium-client`, `cell/emporium-store`, `cell/spawn-gardend`, `cell/vocab-views`) and consumed by `apps/emporium`. The read stays shell-side; the pure library stays backend-free.

### 6b — anatomy graph view + polish (`3257eb6`)

- **`mn-graph` — a general, skin-aware, token-driven layered-DAG / class-graph component** (`packages/components/src/mn-graph.ts`). Classes are nodes; predicate-range edges are solid, CRDT-wire edges are dashed, discriminated **structurally** (no color code). Longest-path layering, cycle-safe, arrowheads, label chips. It carries no vocabulary, and its `MnGraphEdge` shape is superset-compatible with `mn-relations`' `MnRelation`, so **both views are fed by the one relationship read-model** (the render package's `VocabRelationship[]`) with no transform. It is a generalization of the layered-DAG idea, deliberately **not** a port of garden's `wf-anatomy-view` (read read-only, not lifted). Emits `mn-graph-node-select`. Island-clean.
- **Wired into pack-detail** (`vocab-views.ts`, shared from `@shrubbery/organism`) as a **LIST ↔ GRAPH toggle** in the RELATIONSHIPS section. The shell owns the toggle state and re-renders; graph nodes deep-link the class route.
- **Polish** — token-scale spacing/rhythm/typography in the Emporium skin; honest loading/empty/error/not-found states (glyph + title + verbatim read error); content enter transition + smooth scroll on class deep-links (both respect `prefers-reduced-motion`); breadcrumb/filter accent coherence; a framed dotted-grid graph well.

---

## Honest test counts

**522 tests passing / 0 failing across 8 packages** (`pnpm -r test:run`):

| Package | Tests |
|---|---|
| tokens | 23 |
| nucleus | 166 |
| render | 43 |
| runtime | 28 |
| components | 168 |
| organism | 18 |
| storybook | 62 |
| **emporium** | **14** |
| **Total** | **522** |

Trajectory across iter-6: **492 → 507 (6a: +15 `mn-app-bar` component) → +8 emporium-shell integration → 522 (6b: +24 `mn-graph` component, +6 emporium graph-view integration, +4 organism anatomy)**.

> Note: the prompt's "469" baseline is stale. The actual green baseline entering 6a was **492** (6a's own context recorded the 469→492 jump); verified by running the suite before starting.

### Live integration tests (real cell, zero mocks)

The emporium package's 14 tests are split across two files, **both of which spawn a REAL current-release `gardend` cell** and assert against the live 2-pack catalogue (`workflow` + `sophia-memory-core`):

- **`tests/emporium-shell.integration.test.ts`** (8 tests) — boots the shell against the real cell; asserts the live 2-pack catalogue renders in rail + content, rail→pack nav switches to the real pack-detail view, breadcrumbs/route/rail-active-state track, class deep-links resolve, and search narrows live data. Empty/error states are honest, never faked.
- **`tests/emporium-graph-view.integration.test.ts`** (6 tests) — drives the shell to the workflow pack, flips to GRAPH, and asserts the LIVE class graph to real DOM: **9 explicit class nodes, 14 edges (9 predicate + 5 wire)**, the specific `AgentNode → wf:partOfWorkflow → Workflow` predicate edge and the `flowsInto` wire edge, layered columns, interactive node deep-link, and a reversible toggle.

The 4 new organism anatomy tests likewise spawn a real cell and assert against the live workflow pack (9 classes / 14 relationships).

**Verified out-of-band:** `tsc --noEmit` clean (emporium + components + organism + storybook); `pnpm build` (vite) succeeds (~115 KB gzip bundle); `pnpm build-storybook` succeeds with both new bar stories catalogued; the Vite `/cell` proxy serves the 2 real packs live over `localhost:5181`.

---

## HOW TO RUN `apps/emporium`

Two terminals. The cell must be a **current release `gardend`**; point at it explicitly with `GARDEN_BIN`.

**Terminal 1 — start the live cell:**
```sh
cd /Users/vera/dev/sophia/shrubbery/apps/emporium
GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend pnpm gardend:dev
```
This spawns a real `gardend` and writes a loopback manifest (`.gardend-loopback.json`) with the port/token (kept server-side). If you have not built the cell, build it first from the garden repo with `./src-tauri/build-gardend-headless.sh` (or `cargo build --release --example gardend`).

**Terminal 2 — start the app:**
```sh
cd /Users/vera/dev/sophia/shrubbery/apps/emporium
pnpm dev
```
Then open **http://localhost:5181**. The Vite dev server's `/cell` proxy injects the loopback auth header and forwards to the running cell, so the shell reads the live `/emporium` registry.

**Per-package tests** (these spawn their own cell — same `GARDEN_BIN` requirement):
```sh
cd /Users/vera/dev/sophia/shrubbery/apps/emporium
GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend pnpm test:run
```

> Gotchas surfaced this iteration: Vite binds IPv6 localhost only — use `localhost`/`[::1]`, not `127.0.0.1`. Background `gardend` launched with a bare `&` gets reaped between tool calls; run it as a persistent process.

---

## Verdicts

**Real-app verdict — PASS (with one honest gap).** `apps/emporium` is a genuine, designed product shell, not a playground tab. It has a coherent purple Emporium identity (Diatype, square controls, tight density), a masthead bar with live-status badge, a packs rail with active state, breadcrumb + hash-router navigation that mirrors the curl URLs, a catalogue, a full pack-detail anatomy (stats, namespaces, mint rules, per-class predicates, relationships), an interactive layered-DAG graph view, and real polish (enter transition, smooth scroll, reduced-motion respect). It boots against a real cell and passes 14 integration tests with zero mocks.
*The gap:* the **store concept** is visual identity + IA only. The rail is a generic sidebar and the cards are vocabulary-schema displays — there is no app-store affordance language yet (no featured carousel, no icons/screenshots, no per-pack "Install / Use" action). It reads as "a beautiful, live vocabulary browser," not yet "Sophia's knowledge app store."

**No-mock verdict — PASS.** No fixtures, no fake catalogues, no stubbed reads anywhere in the shipped path or the tests. Every integration test spawns a real release `gardend` and asserts against the live 2-pack catalogue. Empty/loading/error/not-found states render honestly — read errors surface verbatim with a hint to start a cell; unknown packs/classes show a glyph + "not in the live catalogue" rather than faked data.

**Boundary verdict — PASS.** The shell-side / library split held. All live reads, the cell spawn, and the HTTP proxy live shell-side (`@shrubbery/organism` exports consumed by the app). The library packages stay backend-free: `mn-app-bar` and `mn-graph` carry no store/auth/tauri/network and are covered by the recursive island guard test automatically. The relationship read-model is single-sourced — `mn-relations` (list) and `mn-graph` (graph) are both fed by the same `VocabRelationship[]` with no transform.

**Generality verdict — PASS.** `mn-app-bar` and `mn-graph` are generalizations, not ports. The bar lifts garden's top-bar *structure* and rebinds to general role tokens; the graph generalizes the layered-DAG idea rather than copying `wf-anatomy-view` (read read-only). Both are skin-aware via the token cascade (Garden fern ↔ Emporium purple) with no per-skin code, and the graph discriminates edge kinds structurally (solid vs dashed) rather than by color.

---

## Load-bearing findings (carry forward)

1. **happy-dom drops nested SVG built from Lit templates.** Both nested `svg` template fragments *and* dynamic `${array.map()}` interpolations placed inside an `<svg>` vanish under happy-dom — static `<defs>` rendered but every `.map()`-produced node/edge disappeared (0 nodes). Fix: build the entire `<svg>` subtree **imperatively with `createElementNS` in `updated()`**; let Lit own only the wrapper div. This is the robust pattern for any future SVG component in this stack. (Related, milder: happy-dom also fails to expand a nested template that follows an adjacent binding which can be `nothing` — `${maybe}${nestedTemplate}` renders 0 children; fix by wrapping both bindings in a parent element. Hit twice in 6a.)

2. **The workflow pack mixes two node spaces.** Predicate edges connect pack **classes** (all 9 endpoints are class names) but CRDT-wire edges connect **doc-kind** endpoints (e.g. `node doc → output doc`). Naive node auto-derivation produced 16 nodes (9 classes + 7 phantom wire endpoints), not 9. Resolved honestly: each node is tagged `origin = 'explicit' | 'derived'` (the view passes `pack.classes` as the explicit set; wire endpoints render as derived with muted dashed styling so no wire dangles). The test asserts exactly 9 explicit class nodes + >0 derived. No data faked.

---

## Iteration-7 recommendation

**Pick P1 + P2 together — they validate the core product loop.**

- **P1 — Vocab search wired to real backend content queries.** Today search is client-side string filtering (name/title/namespace). Add a `search(q)` RPC to the EmporiumStore contract that calls a real cell-side content search (SPARQL / full-text over RDF literals), render the results, and add an integration test (`search "agent"` → returns `AgentNode` + related live classes). This is the *first* backend-coupled feature — it proves the shell↔cell separation can grow past "read the registry" into "query the content." (~200–300 LOC.)

- **P2 — Gated prod deploy to `canary.sophia-labs.com/emporium`.** The app runs local-only today. Build `dist/`, stand up a gateway route to the SPA + the `/emporium/*` REST routes to a remote cell, and validate over TLS + Cognito (`curl https://api.canary.sophia-labs.com/emporium/vocabs` → live catalogue; SPA reads live packs in-browser). Proves the same-origin `/cell` proxy design works against a *remote* gateway-cell, not just loopback. (~50 LOC terraform/helm; **PAUSE for go-ahead before any apply/push per repo deploy-safety rules**.)

Both are no-mock acceptance: P1's test searches a live cell; P2 is validated against the real canary deploy.

**Then iter-8 (queued, not for 7):** **P3** the first mutation/editor panel (e.g. pack-title `PATCH` → cell persists → readback) to take the shell from read-only to CRUD, and **P4** a memory-pack-specific view that surfaces `sophia-memory-core` by its Perception/Memory/Judgment/Plan/Tool buckets — proving the catalogue can be domain-aware without losing generality.

---

## Files (absolute)

**New components (library):**
- `/Users/vera/dev/sophia/shrubbery/packages/components/src/mn-app-bar.ts`
- `/Users/vera/dev/sophia/shrubbery/packages/components/src/mn-graph.ts`

**App:**
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/src/main.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/src/shell.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/src/rail-view.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/src/router.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/index.html`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/vite.config.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/scripts/gardend-dev.mts`

**Shared shell-side library (organism exports):**
- `/Users/vera/dev/sophia/shrubbery/apps/organism/src/cell/vocab-views.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/organism/src/cell/emporium-store.ts`

**Integration tests (live, no-mock):**
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/tests/emporium-shell.integration.test.ts`
- `/Users/vera/dev/sophia/shrubbery/apps/emporium/tests/emporium-graph-view.integration.test.ts`
