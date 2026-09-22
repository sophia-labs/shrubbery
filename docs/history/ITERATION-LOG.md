# Shrubbery — Iteration Log

> The frontend decomposition is run as a sequence of small, falsifiable lifts. Each
> iteration founds the smallest thing that can be *proven* to work, then is evaluated
> on purity / design / next-lift before the next lift is chosen. This file is the
> running record. Newest iteration on top.

---

## ITERATION 1c — Chrome components + the organism playground

**Date:** 2026-06-19
**Tests:** nucleus 166/166 · runtime 28/28 · components **32/32** (new) — all green.
Run per-package: `pnpm exec vitest run` in each package (aggregate via `pnpm -r test:run`).

**What was built:**

- **`packages/components` (`@shrubbery/components`)** — backend-free CHROME Lit
  components. Two REAL `@customElement`s lifted (structure only) from garden's
  `src/components/layout/`:
  - **`mn-top-bar`** — masthead(brand) → app-switcher → breadcrumbs(nav) → actions.
    Lifted from garden's 2889-line top-bar; DROPPED every store/controller
    (sessionStore, filesystemStore, billingStore, apiCacheStore, ApiClient,
    ThemeController, nativeBridge, runtimeConfig) + the share/members/clip panels
    + the dialogs + the Tauri drag-guard. The breadcrumb area (live workspace/doc
    data in garden) is an INERT `<slot name="breadcrumbs">`. The app-switcher +
    theme/skin/settings buttons are KEPT as real CONTROLLED chrome: state is from
    props, clicks emit composed events (`mn-app-change`, `mn-theme-toggle`, …) and
    mutate no store.
  - **`mn-bottom-bar`** — the 3-column grid (left / center / right). DROPPED every
    store (sessionStore, filesystemStore, globalStatusStore, documentStore) + the
    popovers + block-type/export + cloud-pill. The three data areas (item count /
    doc stats / presence+sync) are INERT slots. The Files/Graph + Sophia/Comments/
    Wires toggles are KEPT as real controlled chrome (props in, events out).
  - Depends ONLY on lit (+ nucleus for contract TYPES). NEVER stores/auth/tauri/
    runtime — **grep-verified** + enforced by `components-island.test.ts`.

- **Wiring (host upgrades chrome where config names it):** the runtime host already
  stamps `<mn-top-bar></mn-top-bar>` / `<mn-bottom-bar></mn-bottom-bar>` from
  `renderedByComponent`. Importing `@shrubbery/components` REGISTERS those tags, so
  the stamped elements UPGRADE in place. Un-named panels (mn-sidebar-panel,
  mn-chat-panel, …) stay un-upgraded inert placeholders — never faked.
  Proven headlessly by `host-upgrade-wiring.test.ts` (real seed → parse → host →
  DOM; only `mn-top-bar` + `mn-bottom-bar` upgrade, sidebar stays inert with no
  shadow root + zero children).

- **`apps/organism` (`@shrubbery/organism`)** — a PLAIN Vite app (no framework). Boots
  the real render host + chrome against real RDF: imports the REAL committed seed
  `.nt` via `@shrubbery/nucleus/seed/garden-default.ux.nt?raw` (new nucleus export),
  parses it (parseNT → parseTriplesToConfig), renders the live workspace shell, and
  exposes a textarea that re-parses + re-renders on edit + a GARDEN_DEFAULT /
  GARDEN_VARIANT / seed-nt + app(garden/choreograph) selector. Parse errors show
  verbatim; no fallback to faked data. `vite build` OK (41 modules, 78.6 kB);
  `vite dev` boots (HTTP 200 ~3s, transpiles workspace packages from source).

**Tests (all REAL, no mocks):**
- `mn-top-bar.test.ts` (12) + `mn-bottom-bar.test.ts` (12) — instantiate the real
  custom elements, assert real shadow DOM + controlled-prop behaviour + composed
  events + inert slots.
- `components-island.test.ts` (5) — static guard: imports = lit/nucleus only, NEVER
  `@shrubbery/runtime`, no backend-coupling tokens (comments stripped so the
  drop-list prose doesn't false-positive).
- `host-upgrade-wiring.test.ts` (6) — the host↔chrome upgrade seam, end-to-end.

**Frictions / decisions:**
- Root `pnpm exec vitest run` via a `vitest.config.ts` `projects` aggregate BROKE 3
  nucleus tests that read `process.cwd()/src/workspace/...` (load-bearing per the
  iteration-0 note). Kept the per-package run model (`pnpm -r test:run`) instead of
  touching nucleus tests — nucleus stays 166/166 untouched.
- Island token-guard initially flagged the components' own "what was DROPPED" prose
  (sessionStore, ThemeController, …). Fixed by stripping comments before the scan
  (guard tests executable code, not the absence-notes) + de-naming stores in the
  inline HTML `<!-- -->` comments inside templates.
- Wiring test timed out until the container was CONNECTED to the document — custom
  elements only run connectedCallback (→ shadowRoot) when in the document tree, just
  like the organism's mounted `#host`.

---

## ITERATION 0 — Found the repo + extract the pure nucleus

**Date:** 2026-06-19
**Commit:** `78828ad` — "iteration 0: scaffold shrubbery + extract pure nucleus" (branch `main`, working tree clean)
**Plan SoR:** `/Users/vera/dev/sophia/plans/shrubbery-frontend-decomposition-20260619.md`

### 1. What was founded (honest)

A new git repo + minimal pnpm workspace at `/Users/vera/dev/sophia/shrubbery`:

```
shrubbery/
├─ .gitignore
├─ package.json            (private root; pnpm workspace host)
├─ pnpm-workspace.yaml      ('packages/*')
├─ pnpm-lock.yaml           (committed; pnpm install succeeded, no network friction)
├─ README.md
└─ packages/
   └─ nucleus/              (@shrubbery/nucleus — the pure RDF→UI engine)
      ├─ package.json
      ├─ tsconfig.json
      ├─ vitest.config.ts
      ├─ component-library/manifest.ts          (Emporium-readiness stub)
      ├─ scripts/generate-garden-default.mts    (seed generator)
      └─ src/
         ├─ index.ts
         ├─ contract.ts                          (interface-only backend seam, §3)
         └─ workspace/
            ├─ interpreter.ts   types.ts   validate.ts   mutations.ts
            ├─ ux-rdf.ts        deep-freeze.ts
            ├─ garden-default.ts  garden-variant.ts
            ├─ index.ts
            ├─ __generated__/garden-default.ux.nt   (seed artifact)
            └─ __tests__/  (8 island test files + setup.ts)
```

**Extraction method.** The 8 engine source files + the `__generated__/garden-default.ux.nt`
seed + the `generate-garden-default.mts` generator were **copied verbatim** out of
`garden/frontend/src/workspace`. Garden was never modified — verified:
`git status frontend/src/workspace` in `~/dev/sophia/garden` → clean.

**The one knot cut.** The engine had a single outward edge:
`interpreter.ts`'s `import type { PanelId } from '../types/session.js'`. `PanelId`
(`'chat' | 'comments' | 'wires' | 'inspector'`) was inlined into
`nucleus/src/workspace/types.ts` and the import re-pointed to `./types.js`. That was
the only semantic edit to copied code.

**Added (new, not copied):**
- `src/contract.ts` — interface-only seam per plan §3 (AuthProvider, CrdtBackend,
  RuntimeModeProvider, UiServices, RestClient, NativeBridge?, Telemetry?,
  ReactiveSource<T>, ShrubberyContract). Zero runtime: 0 `export const`/`class`/`function`.
- `component-library/manifest.ts` — stub seeded from interpreter's `PERSISTENCE_BY_TAG`.

#### Nucleus-is-island status: **PROVEN**
- `grep -rn "from '../..'" packages/nucleus/src` → **0 matches** (no parent-directory escapes). Re-run and confirmed this iteration.
- Non-test sources use only `./` sibling imports.
- External dep set (read from actual imports, confirmed against `package.json`):
  - **prod:** `lit` (frame-divergence test renders Lit templates; `stampPanelBody` emits Lit)
  - **dev:** `typescript`, `vitest`, `tsx`, `@types/node`, `happy-dom`
  - **No yjs. No tauri. No window/document/localStorage/fetch at module scope.** Confirmed.

#### Build / test result (re-run this iteration, not reported secondhand)
- `pnpm vitest run` → **137 passed (137), 8 test files passed (8)**. 0 failures, 0 skips.
- `tsc --noEmit` → **clean (exit 0)**.
- Generator round-trips **byte-identically** to garden's committed `garden-default.ux.nt`
  (asserted by `ux-rdf.test.ts`; the test passes).

**Honest caveat — "build" is a typecheck, not an emit.** The nucleus uses `.js` import
specifiers under `moduleResolution: bundler` + `allowImportingTsExtensions` (garden/Vite
convention). So `build` == `tsc --noEmit`, a *gate*, not a `dist/`. App-shells will
consume the TS source directly via `workspace:*`. A real emit (tsc emit / tsup) is
**deferred** — and that is fine for iteration 0 because nothing consumes the package yet.

**Honest caveat — 3 of garden's 11 engine tests were deliberately NOT brought in.**
They are genuinely garden-coupled (they exercise garden's *render host*, not the pure
engine), confirmed to still live in garden:
- `engine-editor-host.test.ts` — `readFileSync` of `src/app-shell.ts`; asserts against garden's app-shell source text.
- `engine-node-identity.test.ts` — imports `../../stores/editor-session-store` + `@tiptap/y-tiptap`.
- `engine-live-mutation.test.ts` — imports `../../app-shell` + `../../stores/session-store`.

Leaving them in garden is correct, **not a faked pass**. The 8 island tests
(interpreter / validate / mutations / ux-rdf / persistence / divergence / multiapp /
golden) fully cover the pure engine. The 137 count is real, all-island, zero-skip.

**Honest caveat — two minor, intentional impurities carried over verbatim:**
1. `garden-default.ts` and `garden-variant.ts` each inline a private `deepFreeze()`
   copy (the shared one is `deep-freeze.ts`). Duplication is intentional in garden
   ("generated/fixture files stand alone"); carried over un-deduped to keep the
   extraction a pure copy. **(Flagged for fix — see §4.)**
2. The plan's §3 types `CrdtBackend` with concrete `Y.Doc`/`Awareness`. To keep the
   nucleus yjs-free, `CrdtDoc`/`CrdtAwareness` are modeled as **opaque `unknown`**
   handles a shell binds to yjs at runtime. Faithful to the seam; slightly weaker
   typing. **(Deliberate; not changing.)**

---

### 2. Evaluation verdict

| Axis | Verdict | Evidence |
|------|---------|----------|
| **Purity** | **PASS — clean island.** | 0 parent-escapes; deps = `{lit}` + dev tooling; no yjs/tauri/globals; 10 public fns are total pure (config→value, no side effects); contract.ts is 100% interface. CRDT types opaque. |
| **Design** | **SOUND, with hygiene debt.** | Boundary cut at exactly one knot (PanelId). But the extraction is a *faithful copy*, so it inherited garden's seams un-refactored: `interpreter.ts` does ≥4 jobs (registry + config resolution + Lit stamping + layout projection); `ux-rdf.ts` conflates a generic RDF model with sux:-schema binding; the manifest is duplicated as both `PERSISTENCE_BY_TAG` and `component-library/manifest.ts`; `deepFreeze` exists in 3 copies. None of these are *leaks* — they're carved-too-coarse modules. Fixable cheaply, lower risk before more code lands than after. |
| **Next-lift readiness** | **READY.** | The interpreter is proven (137 tests). The single missing mechanical piece is the **render host** (`LayoutPlan → DOM`). The contract seam exists but has never been *exercised* by a running consumer. Nothing downstream depends on the nucleus yet, so this is the cheapest possible moment to both (a) lift, and (b) make pre-lift design corrections. |

**Overall:** Iteration 0 did exactly its job — it founded a falsifiable island and proved
it. The engine *computes* correctly; what's unproven is that the engine + contract +
a renderer are *mechanically composable*. That is precisely what iteration 1 must
falsify.

---

### 3. Recommended ITERATION-1 lift

**Lift: "Mock contract + render host → first smoke test."**
Smallest valuable, strictly-ascending-risk, zero garden impact. It produces the first
*observable working thing*: a real DOM tree built from RDF config through the contract.

**Why this and not the alternatives:**
- *Tokens/CSS consolidation* — low risk but unlocks nothing about the library; garden stays pixel-identical.
- *Mock-contract test harness alone* — tests the contract shape but never produces a render.
- **Render host + mock contract** — turns `planFor(GARDEN_DEFAULT) → LayoutPlan → Lit → DOM` into a *true statement instead of a promise*, and is the first thing to exercise the contract seam under a running consumer. The interpreter half is already proven; the renderer is the one missing mechanical link.

**Ships (new package `packages/runtime/`, plus a one-component `packages/components/`):**
- `runtime/src/renderer.ts` — `planFor(config) → LayoutPlan → Lit render → DOM` (the split-tree walk + region stamping; lift the renderer loop out of garden `app-shell.ts`).
- `runtime/src/positioning-math.ts` — region constraints / child-budget math (pure; from garden's region-constraint logic).
- `runtime/src/mock-contract.ts` — a complete in-memory `ShrubberyContract` (fake tokens, opaque in-memory CRDT handle, stub UI services). No network, no yjs required.
- `components/src/stub-bar.ts` — one Class-A "stamp" component that reads UI services from the injected contract (e.g. icon/confirm), proving injection works. A stub, not garden's full `mn-top-bar`.
- Reuse garden's `engine-frame-divergence.test.ts` happy-dom + Lit pattern as the harness template.

**Acceptance check (binary, must all hold):**
1. `pnpm -C packages/runtime test` → smoke test **PASS**: `render(renderer(GARDEN_DEFAULT, mockContract))` yields a non-empty DOM tree with the expected region stubs, no thrown errors, no unresolved tags.
2. Contract injection proven: the stub component, constructed with `mockContract`, renders content sourced from a contract method (e.g. a `ui.icon(...)` call is observable in its shadow DOM).
3. `tsc --noEmit` clean across `runtime` + `components`; **runtime declares no dep on yjs/tauri/stores** — it casts the opaque `CrdtDoc` only at the shell seam, never imports yjs.
4. `grep -r "y-websocket\|cognito\|tauri-bridge\|sessionStore" packages/runtime packages/components` → **empty**.
5. No garden regression: `garden/frontend` still builds/renders identically (nucleus copy unchanged; no re-export wired yet). `git status` in garden stays clean.

If 1–5 hold, the nucleus + contract + renderer architecture is **mechanically sound**,
proven before a single real shell file is touched.

---

### 4. Design changes to make BEFORE lifting more

These are cheap now (nothing consumes the nucleus) and get costly once `runtime` +
shells bind to the current shapes. Do the **high-leverage four (a–d) before iteration 1**;
defer the rest as hygiene.

**DO NOW (pre-iteration-1):**

- **a. Dedupe `deepFreeze` → one shared util.** Three copies today (deep-freeze.ts +
  inline in garden-default.ts + garden-variant.ts). Make `deep-freeze.ts` the single
  source; have all consumers import it. The "fixtures must stand alone" rationale does
  not survive the move out of garden — in a real package, a shared util import is correct.
  *(Risk: none; the 137 tests pin behavior.)*

- **b. Split `interpreter.ts` by responsibility** before `runtime` imports it, so the
  renderer pulls from a *truly pure* `layout-plan.ts` and the Lit-coupled `stampPanelBody`
  is visibly separated:
  - `component-library.ts` (registry: persistenceOf, isRegisteredComponent)
  - `config.ts` (resolvePanelTag, resolveSurfaceTag)
  - `layout-plan.ts` (planFor + LayoutPlan types — pure, no Lit)
  - `interpreter.ts` → façade re-export + `stampPanelBody` (the only Lit-coupled bit)
  *(Risk: low — import renames; same behavior, same tests.)*

- **c. Collapse the manifest duplication.** `PERSISTENCE_BY_TAG` (interpreter) and
  `component-library/manifest.ts` are two copies of one table. Fold into a single
  `component-library.ts`; have the registry be the one source `persistenceOf` reads,
  and re-export from the old path so the package `exports` map stays stable. Do this
  *with* (b). *(Risk: low.)*

- **d. Split `ux-rdf.ts` into `rdf-model.ts` (generic Term/Triple/NT serde) + `ux-rdf.ts`
  (sux:-schema binding).** The generic model will be reused for `:ux:wfstate` and memory
  vocabs; splitting now avoids a later duplication. Keep `ux-rdf.test.ts`'s
  `process.cwd()/src/workspace/__generated__/...` path intact — it's load-bearing for
  the byte-identity check. *(Risk: none; internal refactor.)*

**DEFER (hygiene, after iteration 1 proves the architecture):**
- Validator combinator pattern (I1–I7 as composable functions) — do it when I7
  "component is registered" actually lands (Emporium, S7).
- Dimension-id semantic types (`AppDimension`, etc.) — when the app-dimension routing
  gets real consumers.
- `@internal` annotations splitting public vs. test-only exports on `src/index.ts`.
- `LayoutService`/`PositionAnchor` contract addition — when Class-B/C float positioning
  is implemented (S6).
- Test reorg by layer + a `__tests__/README.md` test-pyramid note.
- Naming glossary (sux: / WorkspaceConfig / Shrubbery / nucleus) in docs.

**Keep as-is (deliberate, do NOT change):**
- Opaque `CrdtDoc`/`CrdtAwareness` (`unknown`) — weaker typing, stronger decoupling; the
  shell binds yjs at the seam. This is the intended design, not debt.
- `.js` specifiers + `tsc --noEmit` gate — correct for a source-consumed library; shells own bundling.

---

*End of Iteration 0.*
