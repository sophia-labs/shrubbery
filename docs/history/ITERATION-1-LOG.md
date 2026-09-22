# Shrubbery — ITERATION-1 LOG

**Date:** 2026-06-19
**Branch:** `main` (shrubbery repo)
**Commits:** `8b7b08d` (1a) · `e725d70` (1b) · `984a613` (1c) — working tree clean

Shrubbery is the RDF→UI decomposition of garden's workspace shell into a clean,
backend-free island: a pure interpreter (nucleus), a store-free render host
(runtime), real chrome custom elements (components), and a runnable proof app
(organism). Iteration 1 took it from "split + fold" to "boots, renders real RDF,
upgrades real chrome, all green."

---

## 1. What was built

### 1a — Nucleus refactors (commit `8b7b08d`)

Two structural moves inside `@shrubbery/nucleus`, **zero behavior change**:

- **rdf-model split.** Created `src/workspace/rdf-model.ts` holding the GENERIC RDF
  substrate with **zero application-vocabulary knowledge**: `Term`/`Triple` types,
  term constructors (`I`, `L`, `Lint`, `Lbool`, `Ldec`), `termKey`/`compareTriples`
  ordering, the `isIri` guard, and the N-Triples codec `triplesToNT` + a newly
  **implemented** real `parseNT` (IRIs, plain/typed literals, escapes; skips
  comment/blank lines — a faithful inverse of `triplesToNT` for the subset this
  codebase emits). `ux-rdf.ts` keeps all `sux:` vocabulary knowledge and now
  imports the model + re-exports `termToNT`/`triplesToNT`/`parseNT`/`Term`/`Triple`
  so the WP0.1 test and the seed generator resolve unchanged. Seed regeneration
  produced **no diff** — byte-identical (`sha256 c45f838a…`).

- **Manifest fold.** Created `src/workspace/component-library.ts` owning
  `COMPONENT_LIBRARY` (`tag → {tag, persistence}`), `persistenceOf`,
  `isRegisteredComponent`, and the `Persistence` taxonomy — sourced from
  interpreter's former inline `PERSISTENCE_BY_TAG`. `interpreter.ts` now
  imports/re-exports the surface; the inline table is gone, so there is exactly
  **one table that cannot drift**. The old `component-library/manifest.ts` stub
  became a deprecated compat shim re-exporting the canonical surface.

New test files: `rdf-model.test.ts` (17) + `component-library.test.ts` (12).
The rdf-model test also asserts `rdf-model.ts` is **token-free** of
`sux`/`Workspace`/`sophia.ai-ux` — this caught and forced removal of three benign
vocabulary mentions left in comments.

### 1b — Runtime render host `@shrubbery/runtime` (commit `e725d70`)

The real `planFor → LayoutPlan → Lit DOM` render host, adapted from garden
app-shell's flag-on render path (`renderSpineForPlan` recursive childRegion-spine
walker + chrome composition + `engineRegionRole`/`resolveSurfaceTag` body
dispatch), **stripped of all store/auth/tauri/yjs/contract dependencies.**

Public surface: `renderWorkspace(config, opts)` renders into a DOM container;
`renderWorkspaceTemplate` returns a pure Lit `TemplateResult`; `engineRegionRole`
+ `RegionRole`/`RenderWorkspaceOptions` types are exported. Panel bodies are
inert `<tag></tag>` placeholders via nucleus `stampPanelBody` — un-lifted
components render as clearly-labeled inert elements (`data-region`/`data-role`),
**never faked content.** Depends ONLY on `@shrubbery/nucleus` + `lit`
(statically grep-verified).

### 1c — Chrome components + organism (commit `984a613`)

- **`@shrubbery/components`.** Two **real** backend-free chrome custom elements,
  `mn-top-bar` and `mn-bottom-bar`, with STRUCTURE lifted from garden's
  `src/components/layout/` (read-only) and **all** store/auth/controller/tauri
  reads dropped. Live-data areas (breadcrumb trail, item count, doc stats,
  presence/sync) are **inert named slots** (never faked); the app-switcher,
  theme/skin/settings buttons, and Files/Graph + Sophia/Comments/Wires toggles
  are kept as **real controlled chrome** (state from props, clicks emit composed
  events, no store mutation). Depends ONLY on `lit` (+ nucleus contract types).

  **Upgrade seam wired:** importing the package registers the two tags, so the
  host's stamped `<mn-top-bar>`/`<mn-bottom-bar>` (from `config.renderedByComponent`)
  **upgrade in place**, while un-named panels (`mn-sidebar-panel`, `mn-chat-panel`,
  `wf-studio-shell`, …) stay inert un-upgraded placeholders — proven end-to-end
  by `host-upgrade-wiring.test.ts`.

- **`apps/organism` (`@shrubbery/organism`).** A plain Vite app (no framework)
  that boots the **real** runtime host + chrome against **real** RDF. It imports
  the actual committed seed `.nt` via `@shrubbery/nucleus/seed/garden-default.ux.nt?raw`,
  parses it (`parseNT → parseTriplesToConfig`), renders the live workspace shell,
  and exposes a textarea + GARDEN_DEFAULT/VARIANT/seed + app selector that
  re-parse and re-render live. Parse/render errors surface verbatim with **no
  faked fallback** (shell left as-is).

### Test counts (honest)

Run model is **per-package** (`pnpm exec vitest run` inside each dir; aggregate
via `pnpm -r test:run`). A root `vitest projects` aggregate was deliberately NOT
adopted — it broke 3 nucleus byte-identity tests that read `process.cwd()`.

| Package | Tests | Files | Breakdown |
|---|---|---|---|
| `@shrubbery/nucleus` | **166 / 166** | 10 | 137 original (untouched, all green) + 29 new (17 rdf-model + 12 component-library) |
| `@shrubbery/runtime` | **28 / 28** | 3 | integration (real seed e2e) + functional/divergence (DEFAULT vs VARIANT) + island guard |
| `@shrubbery/components` | **32 / 32** | 4 | 12 mn-top-bar + 12 mn-bottom-bar (real shadow DOM) + 5 island + 6 host-upgrade-wiring |
| **TOTAL** | **226 / 226** | **17** | zero skips (`.skip`/`.todo`/`.only` = 0) |

Test taxonomy as the brief asks for it:
- **Unit:** nucleus rdf-model codec + component-library table shape/frozen-ness/semantics.
- **Integration:** runtime `render-workspace-integration` — real committed seed `.nt`
  → `parseNT` (227 triples) → `parseTriplesToConfig` → `planFor` → `renderWorkspace`
  → assert real region tree (6 regions, left→center→right spine, outer split 20 /
  inner right-split 75, inert panel tags present, collapse drops panes, choreograph
  app renders a different spine).
- **Functional:** runtime `render-workspace-divergence` — DEFAULT vs VARIANT diverge
  exactly on chrome existence / outer position / spine-order-and-leaf; invariant on
  the top bar.
- **Component:** components `mn-top-bar`/`mn-bottom-bar` — real shadow DOM,
  controlled-prop behavior, composed-event emission, inert-slot assertions; plus
  `host-upgrade-wiring` proving stamped tags upgrade and un-lifted panels don't.

`tsc --noEmit` is clean (exit 0) in all three packages.

### Organism build status

- **`vite build`: OK** — 41 modules transformed, ~78.6 kB JS bundle, `dist/`
  contains `index.html` + `assets/index-*.js`.
- **`vite dev`: boots** — HTTP 200 in ~3s, transpiles workspace packages from
  source, loads + parses the real committed seed `.nt`.
- It is a **real shell, not a testbed**: edit N-Triples in the textarea and watch
  the layout re-render; chrome upgrades in place; inert panels stay labeled inert.

---

## 2. Verdicts

### No-mock verdict: **CLEAN**

Zero mocking, pure real data flow, across all 226 tests.

- **No mocking framework.** `vi.mock` / `vi.spyOn` / `stub()` / `jest.mock` /
  `import.*mock` = **0 hits**. No sinon/nock/msw in any `package.json`. DOM is
  **happy-dom** (real W3C DOM with real shadow roots), not a hand-rolled mock.
- **No fabricated contract.** `ShrubberyContract` is interface-only (defined in
  `nucleus/src/contract.ts`); `new ShrubberyContract` / `new AuthProvider` /
  `new CrdtBackend` = **0** anywhere. Shells inject implementations at the seam —
  not shrubbery's job.
- **Un-lifted panels are inert, not faked.** `stampPanelBody(tag)` emits exactly
  `<tag></tag>` (0 children, 0 data). Tests assert the un-upgraded `mn-sidebar-panel`
  has `customElements.get(...) === undefined`, `shadowRoot === null`,
  `children.length === 0`. The organism labels them `⟨ tag — inert placeholder ⟩`
  via CSS `::before` on `:not(:defined)`.
- **Integration reads the real seed end-to-end.** `readFileSync` of the real
  227-triple `garden-default.ux.nt` → real `parseNT` → real `parseTriplesToConfig`
  → real `renderWorkspace` → real DOM assertions. No synthetic fixtures in the hot path.
- **Organism reads real RDF and never fakes.** Vite `?raw` seed import → real parse
  cycle → real render; parse/render errors are surfaced verbatim with no fallback.

### Boundary / purity verdict: **VERIFIED CLEAN (pure islands)**

Strict, acyclic dependency hierarchy, empirically enforced by island tests:

```
nucleus    (island: only lit)
  ↑
runtime    (nucleus + lit)
  ↑
components (nucleus types + lit; runtime is dev/test-only)
  ↑
organism   (nucleus + runtime + components)
```

- **Nucleus** imports only `lit`; `rdf-model.ts` is token-free of any vocabulary
  (`sux`/`Workspace`/…), proven by test.
- **Runtime** island test confirms forbidden tokens absent: `zustand`,
  `sessionStore`, `filesystemStore`, `themeStore`, `yjs`/`Y.Doc`, `tauri`,
  `Cognito`, `WebSocket`, `EventSource`, `ShrubberyContract`, `AuthProvider`,
  `CrdtBackend`.
- **Components** island test confirms it imports only `lit` + nucleus (types),
  **never** `@shrubbery/runtime`, with comments stripped before the token scan so
  drop-list prose can't false-positive.
- No circular imports; no parent-directory escapes; no leaks — all couplings are
  within-package or intentional seams. Garden is untouched (read-only lift).

**Known hygiene debt (by design, deferred — not leaks):**
1. `deepFreeze` exists in 3 copies (now that nucleus is a package, a shared import
   is the correct future move; behavior pinned by tests).
2. `CrdtDoc`/`CrdtAwareness` typed as `unknown` to keep nucleus yjs-free — a
   deliberate weaker-typing-for-stronger-decoupling trade at the seam.
3. `interpreter.ts` still does ≥4 jobs (registry + config resolution + Lit
   stamping + layout projection); a components/config/layout-plan split is a
   candidate for later.

---

## 3. ITERATION-2 recommendation: live-read against a real cell

**WP5.2 — the live-read limb.** Replace the static committed seed as the
organism's data source with a **read of the real `:ux:config` from a real gardend
cell**, render it live, and re-read on a background poll. This is the **smallest
real-backend seam** that proves the full stack end-to-end while preserving the
no-mock rule.

### Shape (no new packages, no infra)

- **Default target: local gardend over loopback** (avoids gateway service-auth /
  cloud-2 complexity). The prebuilt binary exists at
  `garden/src-tauri/target/debug/gardend`. Boot with a profile dir + loopback
  host; it writes a manifest containing `port` + bearer `token`. Endpoint:
  `http://127.0.0.1:<port>/api`, auth `Authorization: Bearer <token>`.
  (Canary cell is a selectable secondary target.)
- **Organism gains a `config mode selector`** in the source panel:
  `[●] SEED_NT (static) | ( ) loopback-local | ( ) canary-cell`, plus a status
  panel (last read time, byte count, parse/render time, poll status, verbatim error).
- **`renderFromSource()` dispatcher:** static → parse the textarea; loopback →
  read the cell's `:ux:config` named graph, parse the returned RDF, render. The
  exact read route must be confirmed against the garden loopback contract — likely
  `POST /api/graphs/{id}/query` with SPARQL
  `SELECT * WHERE { GRAPH <:ux:config> { ?s ?p ?o } }`, or a `/config` shorthand if
  the parity surface exposes one.
- **`startAutoSync(interval=5s)` in loopback mode:** background poll; re-render on
  change. Graceful fallback: if gardend is down or the manifest is stale, stay on
  SEED_NT (static) and log the error — the UI never hangs or fakes data.
- **A thin loopback-transport module** inside the organism (fetch wrapper +
  manifest parsing). No Node scripts, no new deps.

### Acceptance check

1. Boot gardend locally with a seed graph.
2. Organism reads that graph's `:ux:config` from loopback and renders the shell.
3. Mutate the config via garden's UI / CLI.
4. **Auto-sync detects the change and the organism re-renders to match** (the
   load-bearing assertion).
5. `mn-top-bar`/`mn-bottom-bar` remain live (upgraded chrome); un-lifted panels
   (`wf-studio-shell`, etc.) stay inert.
6. Still **no mocks**: the organism connects to a real cell; if it isn't running,
   it falls back to SEED_NT rather than fabricating a response.

This proves: the organism can READ from a real backend cell (live, not mock); the
host re-renders on live config changes (reactivity); the chrome-upgrade seam works
against real backend state; and the organism is the real shell — loadable in dev,
later deployable as a cell's built-in UI.

---

## 4. What proved awkward to carry into iteration 2

- **The contract is still interface-only — by design, but iter 2 forces the first
  concrete binding.** `ShrubberyContract`/`AuthProvider`/`CrdtBackend` have never
  been instantiated. The live-read limb needs a real read path (auth header + a
  query/route). The cleanest move keeps that binding **outside** the islands (in
  the organism's loopback-transport module), so nucleus/runtime/components stay
  pure — but it is the first place the seam stops being purely notional, and the
  contract shape will get pressure-tested for the first time.

- **The exact garden loopback read route for `:ux:config` is unverified.** It's
  documented loosely (API-INTERFACING.md / garden loopback-security.md) but the
  precise endpoint — `POST /api/graphs/{id}/query` with a SPARQL `GRAPH <:ux:config>`
  select vs. a `/config` shorthand — must be confirmed against the live parity
  surface before WP5.2 can be deterministic. (The `garden-local-api` skill is the
  tool for that confirmation.)

- **Reactivity is currently driven by a textarea, not by data.** The organism
  re-renders on local input (250 ms debounce). Iter 2 needs change detection on
  **remote** state (a poll diff, eventually a subscription). The textarea path is a
  decent scaffold but the auto-sync loop + change-detection + status surfacing is
  genuinely new code, and "re-render only on actual change" is the subtle part.

- **happy-dom's connected-element requirement is a real gotcha to remember.**
  Custom elements only run `connectedCallback` → first render → `shadowRoot` when
  the container is in the document tree. `renderWorkspace` defaults to a
  **detached** div, so the wiring test had to append the container to `document.body`
  first. Any iter-2 test (or headless harness) that asserts on upgraded chrome must
  mount into the document — easy to trip over again.

- **The per-package test-run model is load-bearing and must not be "tidied" into a
  root aggregate.** A root `vitest projects` aggregate breaks 3 nucleus
  byte-identity tests that read `process.cwd()`. Iter 2 must keep running
  `pnpm exec vitest run` per package (aggregate via `pnpm -r test:run`) — a tempting
  but wrong cleanup.

- **A pre-existing untracked `ITERATION-LOG.md`** (note: different filename than
  this `ITERATION-1-LOG.md`) was left in the tree by earlier work and untouched
  across 1a/1b. Worth reconciling so the two logs don't drift or confuse.

- **The chrome lift is structural-only on purpose, and the gap will widen.**
  Garden's `mn-top-bar` (~2889 lines) and `mn-bottom-bar` (~1080 lines) are deeply
  store-entangled; shrubbery deliberately shipped minimal real chrome that lifts
  STRUCTURE with all data areas as inert slots. Iter 2's live data will start
  filling those slots — re-establishing exactly the store coupling that was stripped,
  except now it must flow through the contract seam, not a direct store import. That
  re-coupling discipline is the main thing to hold the line on.
