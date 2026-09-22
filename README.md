# shrubbery

A pure **RDF → UI** interpreter and a vetted component library. Render a workspace, a vocabulary catalogue — in time, any site — *from RDF triples*, with the backend injected, not baked in, and a beautiful face for **humans, machines, and agents** alike.

## The idea

> Emporium **mints** the triples → a cell **stores** them → the **interpreter** consumes them → the renderers project them to a **target**.

*Shrubbery* is the frontend ontology (`sux:`) plus this rendering substrate. The render **target is a parameter**: the same plan renders to **`dom`** (Lit), **`hypertext`** (beautiful curl-able markdown + HATEOAS links), **`turtle`** (RDF), or **`json`** (JSON-LD). Extracted from `garden/frontend`; part of the Sophia project. North star: a site is a *graph + an interpreter + a component library*, not hardcoded pages — and it's **`curl`-navigable** because agents browse by following links. The full "how it fits together" map is [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Layout (10 packages · 8 apps)

### Library (pure, backend-free) — `packages/`

| Package | One line |
|---|---|
| **`nucleus`** | The engine: `planFor → LayoutPlan` (`interpreter.ts` + persistence taxonomy), the RDF↔config codec (`rdf-model.ts`/`ux-rdf.ts`, N-Triples), the class→component manifest, and `contract.ts` — the ONE injected backend interface (+ the `TripleSource` read seam). Deps: `lit`. |
| **`runtime`** | The render host: `planFor → LayoutPlan → Lit DOM` (the `dom` face). `renderWorkspace(config)`. Deps: `nucleus`, `chat-kernel`, `editor-kernel`, `lit` (`source` is a *test-only* devDep). |
| **`render`** | The Lit-free render-target core: `turtle` / compacted-JSON-LD / beautiful-markdown faces + FAIR-Signposting links + the ONE pure `negotiate`. Deps: `nucleus`, `jsonld`. |
| **`components`** | Backend-free, skin-aware Lit components: chrome (`mn-top-bar`, `mn-app-bar`, …) + primitives (`mn-chip`, `mn-card`, `mn-graph`, `mn-relations`, …). Deps: `nucleus`, `lit`, plus canvas/graph libs (`three`, `fabric`, `lucide`) — never stores/auth/tauri. Catalogued in Storybook. |
| **`atelier-vtuber`** | `<mn-vtuber>` — the WebGL/VRM avatar puppet, split out of `components` for its heavier `three`/`@pixiv/three-vrm` footprint. Deps: `components`, `nucleus`. (Standalone demo: `packages/atelier/demo/`.) |
| **`tokens`** | The layered design-token CSS (reference → semantic → component → theme → skin) + a tiny `{skin,theme} → root-attributes` map. Six skins: **garden** (fern, default), **emporium** (purple `#9472CE`, Diatype), **98** (classic desktop), **glass** (translucent desktop), **research** (SRS scholar desk), **greenhouse** (sans research workspace); theme light/dark orthogonal. No backend/stores/lit. |
| **`source`** | Where triples come from: `TripleSource` adapter factories (static-nt fossil now; gardend-local / hosted-gateway / sparql-http), the boot factory + auth union, the config store, and the conformance kit. The `.` entry is browser-safe and depends on `nucleus` ONLY. |
| **`site`** | Declarative Shrubbery product bundles — routes, faces, appearance, and feature posture over a canonical RDF workspace layout (Garden is the first). Deps: `nucleus`, `tokens`. |
| **`chat-kernel`** | Pure chat render kernel — Garden's chat projector + render-data types + the `ChatEvent` union, relocated verbatim with their couplings severed. No stores/SSE/yjs/auth/tauri. Leaf. |
| **`editor-kernel`** | Pure TipTap/ProseMirror editor kernel — custom Garden extensions ported verbatim, couplings severed. No yjs/collab/stores/fetchers/UI pickers. Leaf. |

### Apps (shells — backend lives here, behind the contract) — `apps/`

| App | One line |
|---|---|
| **`organism`** | The live RDF→UI playground (the "organism") — a plain Vite app that boots the REAL render host + chrome against REAL RDF (library literals / a committed seed / a live `gardend` cell). **The CI-gated authoritative shell** (see Status). No mock. |
| **`emporium`** | The **Emporium app** — a dedicated Vite product shell (app bar + packs rail + breadcrumbs + hash router) rendering the live vocabulary catalogue → pack anatomy (predicates / enums / wires / relationships / minting) with a `LIST | GRAPH` view. Emporium skin; reads a REAL gardend cell over `/cell`. |
| **`planter`** | **PLANTER** — the generic curl-able host: `negotiate → resolve the resource LIVE from ANY @shrubbery/source TripleSource → render face`. Four conneg faces + an SPA; renders any bound `TripleSource` as a Shrubbery site (the host never knows which adapter it holds). See [`docs/planter/`](docs/planter/README.md). |
| **`rhizome`** | **RHIZOME** — the read-only memory observatory; renders a gardend cell's `:projection:memory` graph (subject-beds, lineage, supersession, the `?asof` temporal lens) as curl-able resources via `@shrubbery/render`'s mem faces. |
| **`greenhouse`** | **Greenhouse v1** — a live-only scientist's workbench for Choreograph agents (greenhouse skin). The **current** Greenhouse (see the two-Greenhouses note below). |
| **`vehicle`** | The **earlier "Greenhouse app"** — a browser AgentWorld cockpit for Choreograph agents, built from the SRS workspace + shared chat primitives. Named `@shrubbery/vehicle`; **superseded by `apps/greenhouse`**. |
| **`atelier`** | The **ATELIER** — the minimal "plain text" Sophia: a single text region (no chrome) booted from the REAL render host against a REAL local gardend cell's `:ux:config`. No backend mock, no fake config. |
| **`storybook`** | The component catalogue — the REAL chrome components under the REAL design tokens (skin × light/dark theme as toolbar globals) + the local content-negotiation server (`conneg/`) that serves the curl faces. |

> **Two "Greenhouse"s, disambiguated.** The name is historically overloaded.
> **`apps/vehicle`** (npm `@shrubbery/vehicle`) is the *earlier* line — the
> AgentWorld cockpit for the SRS/Vehicle work, and its own README even titles
> itself "Greenhouse". **`apps/greenhouse`** (npm `@shrubbery/greenhouse`) is
> **Greenhouse v1**, the later live-only Choreograph workbench that supersedes
> it (its slice log cites the `greenhouse-v1-doctrine` and the now-archived
> Greenhouse *v0* census). When a doc says "Greenhouse" unqualified and recent,
> it means `apps/greenhouse`.

## Principles

- **No mocks.** Test real functions against real inputs; keep a runnable **organism** you can probe. Real DOM (happy-dom) and a real browser (Playwright/test-runner) are not mocks — a stubbed contract is. The **pure core holds this strictly**. The **app layer** carries a small, *frozen* set of stubs (the shells must boot without live infra somewhere), ratcheted by [`scripts/validate-no-mocks.mjs`](scripts/validate-no-mocks.mjs) so that set can only ever **shrink**, never grow. Unbuilt = inert, labeled placeholders. Errors surface verbatim, never a silent fallback.
- **The library is backend-free.** All auth / CRDT / HTTP / Tauri lives *shell-side* behind `ShrubberyContract` (`packages/nucleus/src/contract.ts`). The shells (garden desktop, cloud-2 cell SPA, choreograph Studio, organism, emporium, planter, …) inject an implementation. Why, and the four hard couplings it formalizes: see [`ARCHITECTURE.md`](ARCHITECTURE.md#the-one-backend-seam-and-why-the-library-is-backend-free).
- **Generalize, don't copy.** Components lifted from garden are rebound to skin role tokens and made general + catalogued — not app one-offs.

## Quickstart

```bash
pnpm install
pnpm test:source         # source-owned tests; no ambient Gardend binary
GARDEN_BIN=/path/to/gardend pnpm test:run # full Garden contract/integration suite
pnpm --filter @shrubbery/organism test:browser # real Chromium shell/settings/editor/art journey
```

Garden consumes this repository through the root composite action, pinned
to an immutable commit SHA. The action materializes the exact source
archive inside Garden's workflow; Garden then rebuilds it and records the
revision in its packaged bundle.

**The Emporium app** (live vocabulary catalogue, emporium skin):
```bash
pnpm -C apps/emporium gardend:dev   # terminal 1 — spawn+seed a current gardend cell (serves /emporium)
pnpm -C apps/emporium dev           # terminal 2 — the app; open the printed http://localhost:518x/
```

**Curl the catalogue** (the agent face — content-negotiated):
```bash
PORT=8842 pnpm -C apps/storybook conneg     # local server mimicking the CloudFront Accept→ext rewrite
curl localhost:8842/emporium                # → markdown (the pack catalogue) + a Navigate block
curl -H 'Accept: text/turtle' localhost:8842/emporium/workflow   # → RDF
curl -H 'Accept: application/ld+json' localhost:8842/emporium/workflow   # → JSON-LD
```

(`apps/organism` runs the same way for the workspace-shell playground; `apps/planter` serves the same four faces over any `TripleSource`.) Note: the Vite dev servers bind `[::1]` — use `localhost`, not `127.0.0.1`.

For the development-only Prime execution-journal topology—local Prime and
Choreograph, a real cloud-2 graph cell, and a local Organism display—follow the
[`Prime notebook local/cloud-2 runbook`](docs/design/prime-notebook-cloud2-local.md).

## Status

**Iterations 0–6 — the pure core → the Emporium** (each a workflow, each verified against real infra):

- **0** repo + pure nucleus (island) · **1** render host + chrome + organism · **2** real `gardend` live-read
- **3** design-token system + Garden/Emporium skins + Storybook (real-config stories, skin/theme toolbar = RDF dims, Playwright)
- **curl spike** the render-target core (`@shrubbery/render`) + conneg server (the curl/turtle/JSON-LD faces)
- **4** the live vocabulary catalogue rendered + general primitives lifted · **5** deepened pack-detail (full golden-contract anatomy)
- **6** **Emporium as a real app** (`apps/emporium`): app bar + rail + breadcrumbs + router + the anatomy graph view

**Since iteration 6** — the library grew a layout model and a fleet of new shells:

- **The Surface stack** — a first-class layout model in `nucleus`: `LayoutGridNode` + a grid/collection query seam, the faces MVP (`stat.scalar`, `chart.vega-lite`, `card.subject`), dashboard faces, and the hosted observatory dashboard page + real-Chromium flagship e2e in `organism`.
- **Surface Activation + complete offline source mirror** — bounded concurrent
  activation, retained derived stores, cache-first document editing, complete
  Meaningful Object source epochs, typed sync-later mutations, lifecycle
  fencing, and real Chromium/WebKit distributed-truth gates. Start with the
  [`review bundle`](docs/design/offline-source-mirror-review-bundle-20260730.md).
- **`apps/planter`** + **`@shrubbery/source`** / **`@shrubbery/site`** — the `TripleSource` read seam hoisted into its own adapters package, a generic curl-able host over *any* source, and declarative product bundles. The FID-004 live-read gate is **GREEN** (see [`docs/planter/`](docs/planter/README.md)).
- **`apps/rhizome`** — the read-only memory observatory over a cell's `:projection:memory` graph.
- **`apps/greenhouse`** (Greenhouse v1) + **`apps/vehicle`** + **`@shrubbery/chat-kernel`** / **`@shrubbery/editor-kernel`** / **`@shrubbery/atelier-vtuber`** — the Choreograph/AgentWorld shells and the pure kernels they stand on.
- **`apps/atelier`** — the minimal "plain text" live shell (the smallest real organism).

Dated per-iteration and per-slice worklogs — kept for provenance, not maintained — now live in [`docs/history/`](docs/history/README.md). The design lives in `sophia-code-lab` (the `curl-hypermedia-design` doc + the shrubbery/SRS/Greenhouse design set).

## Provenance

Extracted from `garden/frontend` (read-only — Garden was never modified). The name & idea descend from the 2025 Python prototype at `sophia-labs/shrubbery-2025` (`rhizome` / `mdttl`). Sophia project · `sophia-labs`.

## Licensing

Shrubbery is **source-available**, licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) — not open source / OSS. Non-commercial use, modification, and redistribution are permitted under those same terms; commercial use requires a separate agreement with the maintainers.

- [`LICENSE`](LICENSE) — full license text
- [`NOTICE.md`](NOTICE.md) — required notice and third-party attribution policy
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution scope and the public CI validation gates
- [`SECURITY.md`](SECURITY.md) — how to report vulnerabilities
