# Iteration 4 — Emporium: general primitives + live vocab-catalogue + curl faces

**Date:** 2026-06-20
**Branch:** `main` · **Commits:** `3930e6b` (4a) → `4577f2a` (4b) → `cd0171f` (4c)
**Tests:** 442/442 green (347 baseline preserved + 95 new)

Iteration 4 turns the Emporium from a skin-name into a *rendered, navigable, live-read* vocabulary catalogue. It does this three ways at once — as **general Lit primitives**, as a **live DOM view** wired to a real `gardend` cell, and as **curl-able content-negotiated faces** — all off the same real registry, with no mocks.

---

## What was built

### 4a — General primitives + Emporium accent (`3930e6b`)

**(A) Emporium accent = purple-400 `#9472CE`.** Set in *one place* in `@shrubbery/tokens` — `skin-emporium.css` (`--emporium-accent` + the channel triple `148 114 206` + the interactive washes), the `EMPORIUM_ACCENT` constants, and re-pinned token tests. Vera's pick of purple-**400** over purple-500; the deeper purples remain the strong/active shoulders. Live-verified: computed `--mn-color-accent` on a real `mn-chip` in Chromium = `#9472CE`.

**(B) Five general primitives**, lifted from garden's *pure, read-only* `wf-*` primitives and generalized into `@shrubbery/components`:

| New component | Lift source | Generalization |
|---|---|---|
| `mn-chip` | `wf-chip` | Dropped the wf variant set + `modelGlyph()`; one orthogonal `tone` prop (neutral/accent/success/warning/danger/muted) |
| `mn-badge` | `wf-integrity-badge` | Dropped `IntegrityState` enum + sha-drift labels + the hardcoded terracotta `#b3401f`; caller supplies `label`/`state`; generic `mn-badge-action` event |
| `mn-sparkline` | `wf-sparkline` | **Rebound off garden's `--mn-color-primary-*` ramp** (which would NOT recolor under Emporium) onto `--mn-color-accent` + a `tone` prop |
| `mn-ribbon` | `wf-phase-ribbon` | Dropped the `WfPhase` type; takes general `MnRibbonSegment[]`; tints across the skin ACCENT role ramp; `mn-ribbon-select` event |
| `mn-card` | (none — generalizes the hand-rolled catalogue card) | Header/body/footer slots; interactive `mn-card-activate` + keyboard |

All five are **token-driven** (every color routes through skin role tokens — `--mn-color-{surface,text,border,accent,success,warning,danger,...}` — no hardcoded hex anywhere) and **skin-aware** (`:host([data-skin='emporium'])` → square shoulders + uppercase; recolor per skin *for free* via the inherited token cascade). NONE of garden's `wf-*` *viz shells* were ported — only the pure leaf primitives.

Wired all five into the Storybook catalog under a new general-primitive face (real props, per-entry stories, extended catalog-coherence asserts they're built + catalogued).

### 4b — Live Emporium read + vocab-catalogue DOM render (`4577f2a`)

**Live read.** `apps/organism/src/cell/emporium-client.ts` (the shell-side `EmporiumClient`) reads the **live** registry off a spawned current-release cell: `GET /emporium/vocabs` + `GET /emporium/vocab/{name}/latest`. `emporium-store.ts` is a reactive shell store that reads the catalogue plus every pack's golden contract, so the list shows real per-pack class counts and detail renders instantly.

**Views.** `apps/organism/src/cell/vocab-views.ts` renders the **vocab-catalogue** (one `mn-card` per pack: name/version/namespace/class-count/sha as `mn-chip`/`mn-badge`) and the **pack-detail** (per-class `mn-card` with predicates/datatype/required/multi + the namespace table) — built purely from the generalized iter-4a components, skin-aware via inherited role tokens (Emporium purple for free). Empty state is honest, never faked.

**Wiring.** A new "Emporium catalogue (live)" source in `apps/organism` (`main.ts` + `index.html`) reads through the existing same-origin Vite `/cell` proxy and renders catalogue → detail with drill-down + back.

> Boundary note: the vocab DOM views could NOT live in `@shrubbery/components` (they consume `@shrubbery/render`'s `VocabPack` types, which the components-island guard forbids). They live shell-side in `apps/organism`. The general **primitives** stay in the library island; only the vocab-specific **view** is shell-side.

### 4c — Curl faces for the vocab catalogue (`cd0171f`)

The render core (`VocabResource`/`VocabPackResource`), the `RenderCtx` provider (`conneg/emporium.ts`), the route-table wiring, and the static four-face build were **already present from iter-4a** (verified real, not re-implemented). The genuine 4c gap closed: `conneg/server.test.ts` had **zero** Emporium coverage — the end-to-end curl HTTP path was never asserted. Added **9 tests** over the actual in-process conneg HTTP server: bare→markdown+Navigate, `Accept: turtle`→`emp:Catalog`+`emp:Vocabulary`, `Accept: ld+json` with shared `@context` + no-cross-face-drift, `Accept: html` shell with FAIR `<link>`s, `.ttl`-wins-over-Accept, `Vary: Accept` + `Link rel=item` per pack, the pack-item page rendering the real golden contract (`AgentNode`/`wf:agentType`) with up/collection nav, HATEOAS drill-down, and 404 for an unknown pack (no faked pack).

---

## The curl faces

One Emporium resource → four faces, content-negotiated, with FAIR Signposting:

```
curl http://localhost:8842/emporium                              # text/markdown — catalogue table + Navigate guide
curl -H "Accept: text/turtle"        http://localhost:8842/emporium   # emp: RDF/Turtle (emp:Catalog + emp:Vocabulary)
curl -H "Accept: application/ld+json" http://localhost:8842/emporium   # JSON-LD, shared @context, embedded _links
curl -H "Accept: text/html"          http://localhost:8842/emporium   # HTML shell with FAIR <link> set
curl http://localhost:8842/emporium.ttl                          # .ext WINS over Accept → text/turtle
curl http://localhost:8842/emporium/workflow                     # ITEM — the real golden contract (9 classes, AgentNode + predicates)
curl -D - http://localhost:8842/emporium                         # headers: Vary: Accept + Link rel=self/alternate/describedby/item
```

The bare page lists the **two real packs** (`workflow@1.0.0` sha `bc50e854`, `sophia-memory-core@1.0.0` sha `42b24ee3`). Item headers carry `rel=up` + `rel=collection`. HATEOAS verified: following a Navigate curl from `/emporium` resolves to the pack page.

Independent RDF round-trip (rdflib, `uv run --with rdflib`): catalogue Turtle = JSON-LD = 18 triples (isomorphic); workflow pack Turtle = JSON-LD = 493 triples (isomorphic). The JSON-LD round-trips to the exact same RDF as the Turtle.

---

## Test counts (honest)

**442 tests across 39 files, all green** (347 baseline → +95 over iter 4a/4b/4c):

| Package | Tests | Notes |
|---|---|---|
| tokens | 23 | skin-emporium accent re-pinned |
| nucleus | 166 | unchanged baseline |
| render | 40 | vocab faces (`render-vocab.test.ts`) + island guard |
| runtime | 28 | unchanged |
| components | 113 | 5 general primitives (both skins) + 2 chrome bars + island guard |
| organism | 15 | **3 real live-`gardend` integration suites** |
| storybook | 57 | catalog-coherence + conneg + build-static + **9 new server curl tests** |

**The live-gardend integration tests (no mocks).** `apps/organism/tests/`:
- `gardend-liveread.integration.test.ts` — spawns a real cell, reads `:ux:config` live.
- `emporium-liveread.integration.test.ts` — spawns a real cell, reads `/emporium` live (proves `workflow` + `sophia-memory-core` with real shas/classes).
- `emporium-catalogue-view.integration.test.ts` (5/5) — spawns a current `gardend`, reads `/emporium` live via the shell `EmporiumClient`, renders to **real DOM** (happy-dom), asserts the 2 real packs with real versions/shas/class-counts, renders `workflow/latest`'s classes (`AgentNode` + predicates), verifies the `onOpen`/`onBack` callbacks, and kills the cell on teardown.

**Real-browser (Playwright / Chromium):** 15 → 20 stories pass, including a new computed-style check that `mn-chip`'s resolved `--mn-color-accent` **differs** between Garden (fern) and Emporium (purple `#9472CE`) — re-skinning that only a real paint engine can verify.

**Build:** `pnpm -r build` (tsc `--noEmit` + Vite) and `pnpm -r test:run` both clean across all 7 packages.

---

## How to RUN it

All three commands are independent; the gardend binary must be the **current release example** (it predates `/emporium` in the stale debug build).

**1) Run the live integration tests (spawns a real cell for you):**

```bash
# DEFAULT_BIN already points at the release example, but you can set it explicitly:
export GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend

cd /Users/vera/dev/sophia/shrubbery
pnpm -r test:run                     # all 442, incl. the 3 live-gardend suites

# or just the live Emporium DOM suite:
cd /Users/vera/dev/sophia/shrubbery/apps/organism
npx vitest run tests/emporium-catalogue-view.integration.test.ts
```

**2) Run the organism (live Emporium catalogue in a browser):**

```bash
export GARDEN_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend
cd /Users/vera/dev/sophia/shrubbery
pnpm --dir apps/organism dev         # spawns the cell + Vite; pick "Emporium catalogue (live)" in the source selector
```

The organism reads through the same-origin Vite `/cell` proxy (token injected server-side); `spawn-gardend.ts` defaults to the release binary that serves `/emporium`.

**3) Run the curl server (content-negotiated faces):**

```bash
cd /Users/vera/dev/sophia/shrubbery/apps/storybook
PORT=8842 tsx conneg/server.ts
# then curl http://localhost:8842/emporium  (see "The curl faces" above)
```

Note: the conneg server runs in plain node with **no live cell**, so it serves from a committed verbatim capture of real cell output (`conneg/emporium-snapshot/`, regen via `curl-emporium:snapshot`). The capture was re-taken from a live release `gardend` and confirmed byte-identical (only reformatted). The **live wire read** is always the organism integration test, never a snapshot — the same boundary the curl-catalog spike drew.

---

## Verdicts

### No-mock — PASS
No mocks, no fabricated packs, no stubbed HTTP. The three organism suites spawn a **real `gardend`** and read the **live** `/emporium` registry; shas match the committed snapshot exactly (`bc50e854`, `42b24ee3`). Component tests use real DOM (happy-dom); re-skinning is verified in real Chromium (Playwright). Unbuilt things stay inert and labeled; empty states are honest; errors surface verbatim. The conneg snapshot is a *captured-real* registry (re-verified byte-identical to a live cell), never invented data.

### Boundary — HELD
The components-island guard (113 tests) stayed green: `@shrubbery/components` imports only `lit` + `@shrubbery/nucleus`. The vocab DOM views, which need `@shrubbery/render`'s types, were placed **shell-side** in `apps/organism` rather than leaking `@shrubbery/render` into the library island. The `SkinAware` mixin is backend-free (DOM-only MutationObserver; its only contract with `@shrubbery/tokens` is attribute + CSS-var *names*). Render package's network-free island guard also green.

### Generality — PASS
All five primitives are genuinely general, token-driven, and skin-aware, with **no Emporium-specific one-offs**. Grep confirms: no hardcoded hex in component source (only `background: transparent`); `#9472CE` lives ONLY in `skin-emporium.css`, never in a component; glyphs are generic (`◆ ● ⚠ ✓`). The critical `mn-sparkline` rebound moved it off garden's non-role `--mn-color-primary-*` ramp onto `--mn-color-accent` so it recolors per skin (test asserts `stroke` no longer matches `/primary-5\d\d/`). Every primitive is tested in BOTH skins (unit) and the re-skin is proven by a real-browser computed-style diff (Garden fern ≠ Emporium purple). The lifted components are fit for reuse in any catalogue or shell that pulls `@shrubbery/components`.

---

## Frictions (load-bearing, for the next iterator)

- **happy-dom rendering quirks** forced portable authoring patterns: it mis-parses two adjacent Lit dynamic template parts at a render-root boundary (→ wrap `mn-ribbon` render in a single root `<div>`; render `mn-chip`/`mn-badge` glyph as an always-present `:empty`-collapsing span, not a `nothing` ternary); it silently DROPS Lit's nested `svg` fragment tag (→ author `mn-sparkline`'s polyline/circle directly in the html template); and it doesn't reliably fire `slotchange` for declarative slots (→ `mn-card` detects empty header/footer via `assignedNodes()` in `firstUpdated()` AND keeps the listener). All render correctly in real Chromium too.
- **garden's `wf-*` hardcode garden's own `--mn-color-primary-*` ramp** (not skin role tokens) and the success/danger/warning roles are `--mn-color-{success,danger,warning}{,-strong,-surface,-border}` (no `-500/-600`). All tones were rebound to real role tokens.
- **`spawn-gardend.ts` `DEFAULT_BIN` pointed at the STALE debug binary** (predates `/emporium`). Updated the default to the release example binary; all cells now spawn the current binary.
- **Static-build link edge (gated follow-up, not a bug):** `build-static` with a `BASE_URL` ending in the gateway prefix `/g/emporium` produces doubled paths (`/g/emporium/emporium/workflow`) because the resource id is itself `emporium`. Localhost + the live conneg server (request-host, no `/g/` prefix) are correct. A real CloudFront/gateway deploy must reconcile the gateway graph-prefix with the `/emporium` resource path — same gated follow-up noted in `CURL-CATALOG-SPIKE.md`. No prod infra touched.
- **Backgrounding the dev server via the tool was flaky** (detached shells lost `tsx` on PATH). The curl proof was captured against a genuinely live `:8842` server; the in-process `server.test.ts` is the durable, reproducible proof.

---

## Iteration 5 recommendation

**Start with Pack-Detail depth: wires + predicate anatomy.** It's the highest-value completion of the catalogue UX (semantics = what makes it useful), has the tightest scope (~2-3h), and unblocks the deploy.

The current pack-detail shows classes + their predicates (name/datatype/required/multi) but NOT the semantic anatomy: which predicates link to which classes (wires) or the predicate's `rdfs:range`. Proposed:

- Extend the `VocabPack` shape in `@shrubbery/render` to carry wire metadata (predicate → target-class) from the golden contract.
- Add a per-class "wires" table showing outbound predicates + their target classes as clickable `mn-chip`s; an optional "anatomy" panel showing the full predicate signature (name → datatype → range).
- New integration test: the `workflow` pack's wires render correctly (e.g. `AgentNode.partOfWorkflow` → `Workflow`).
- **Acceptance:** clicking a wire-predicate chip navigates to its target class within pack-detail (in-page drill).

**Then** the gated **S3/CloudFront deploy** (~3-4h): build the four faces into an S3-shaped static layout, wire `pn-gateway`'s `/emporium` route through CloudFront with Cognito ACL (Vera's sub only, initially), reconcile the gateway graph-prefix vs. the `/emporium` resource path (the doubled-path edge above), and re-run the curl proof against `https://api.canary.sophia-labs.com/emporium`. **Defer** the `sophia-memory-core` live-projection viewport (Option 3) — beautiful but needs cross-project coordination (gardend `:projection:memory` + the nomos graph) and can ship later.
