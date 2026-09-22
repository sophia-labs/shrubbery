# Shrubbery — Iteration 2 Log

**Date:** 2026-06-19
**Theme:** gardend live-read — first real backend coupling, shell-side
**Commits:** `f33ffbc` (probe recipe), `c6e9ec3` (build) on `shrubbery` main
**Verdict:** GREEN. No mocks. Library stayed pure. Live read confirmed against a real headless gardend.

---

## 1. What was built

Iteration 2 took the layout engine proven in iteration 1 and fed it from a **real** Garden cell — not a fixture, not a stub. Everything new lives in `apps/organism` (the shell); the library packages were not touched.

### (A) Shell-side gardend contract + session-store

A concrete `ShrubberyContract` backed by a local `gardend` over its loopback HTTP/MCP surface. The contract is the only thing in the app that knows the backend exists; the library consumes the *interface* (`packages/nucleus/src/contract.ts`) and never the implementation.

- `apps/organism/src/cell/gardend-contract.ts` — concrete `ShrubberyContract`: `AuthProvider` (loopback bearer), `RestClient` (`sparql_query`/`sparql_update` + `rdf_dump` of `:ux:config`), `RuntimeModeProvider` (mode `'local'`). CRDT and UI services are **honest "not wired this iteration" throwers** — never faked, never silently no-op.
- `apps/organism/src/cell/loopback-mcp.ts` — low-level MCP JSON-RPC 2.0 client. Splits transports: `node:http` in Node, same-origin `fetch` in the browser. (Node 25's undici drops the `Authorization` header on loopback POSTs — see frictions.) Errors surface verbatim via an `McpError` class.
- `apps/organism/src/cell/session-store.ts` — store-factory pattern: `createSessionStore(contract)` / `loadConfigFromCell(contract)`. Reads `:ux:config` → `parseNT` → `parseTriplesToConfig` → `WorkspaceConfig`, with manual refresh + optional poll. Read-only (CONFIG only). Errors are surfaced verbatim in store state (`status='error'`, `error=<real message>`); there is **no built-in config fallback**.
- `apps/organism/src/cell/spawn-gardend.ts` — Node-only helper encoding the proven spawn recipe (env-only config, fresh `mktemp` profile, `loopback.json` discovery, `/health` poll, `create_graph` + `rdf_load` seeding).

### (B) Organism live mode + Vite proxy + dev script

- `apps/organism/src/main.ts` — new source mode **"gardend cell (live)"**. Selecting it builds a gardend-backed contract (browser transport = same-origin `/cell` proxy, token injected server-side), reads `:ux:config` from the live cell, and renders the result through `@shrubbery/runtime` with read status visible (last-read time, triple count, errors verbatim, no faked fallback).
- `apps/organism/vite.config.ts` — `/cell` dev proxy. Reads `.gardend-loopback.json` **server-side** at config time (port + token never reach browser JS) and injects `Authorization: Bearer <token>` on every proxied request. The browser issues same-origin `POST /cell/mcp`; the proxy forwards to `http://127.0.0.1:<port>/mcp` with the bearer attached.
- Dev scripts: `gardend:dev` (spawn + seed a cell, write the loopback file the proxy reads) and `gardend:live` (a runnable, real-infra end-to-end equivalent of the integration test).

### (C) Real integration test

`apps/organism/tests/gardend-liveread.integration.test.ts` — exercises the whole vertical against the **real** debug binary:

1. Spawn a real `gardend` cell (fresh temp profile, env-only).
2. Seed the real **227-triple** `garden-default.ux.nt` body into a live `:ux:config` named graph via `rdf_load(targetGraphIri=...)`.
3. Read it back through the contract via **both** paths:
   - `rdf_dump(sourceGraphIri=...)` → N-Triples body line count = **227** (byte-exact, 0 set-diff vs seed)
   - `sparql_query SELECT COUNT(*) WHERE { GRAPH <...> { ?s ?p ?o } }` → `rows[0].n` = **227**
   - (Both ignore the misleading envelope `quadCount=235` — see gotcha.)
4. Parse via production code (`parseNT` → `parseTriplesToConfig`), then `planFor` → `renderWorkspace`.
5. Assert the real happy-dom DOM: 6 regions / 7 panels / chrome (`mn-top-bar` + `mn-bottom-bar`) / 3-deep spine with split positions 20/75.
6. Kill the cell and remove the temp profile on teardown.

### Honest test counts

| Package | Files | Tests | Notes |
|---|---:|---:|---|
| `@shrubbery/nucleus` | 10 | 166 | library, untouched |
| `@shrubbery/runtime` | 3 | 28 | library, untouched |
| `@shrubbery/components` | 4 | 32 | library, untouched |
| `apps/organism` | 1 | 6 | **real gardend integration test** |
| **Total** | **18** | **232** | all green |

- The organism's 6 tests **are** the real-gardend test — they spawn the actual binary, not a mock.
- `pnpm gardend:live` (runnable real-infra equivalent) also passed end-to-end → `LIVE_READ_CONFIRMED`.
- `tsc --noEmit` clean across all packages + organism.
- `vite build` succeeds: 46 modules transformed, `dist/index.html` 7.72 kB + `dist/assets/index-*.js` 85.66 kB. (The `node:http`/`node:https` externalization warnings are benign — they sit behind a guarded dynamic import in the Node branch the browser never executes, because the browser takes the `fetch` path when `process.versions.node` is undefined.)

---

## 2. The no-mock verdict and the boundary verdict

### No-mock: CLEAN

The live-read path runs against a real headless gardend, reads real `:ux:config` triples, parses them through the production read path, and renders to a real happy-dom DOM. All errors surface verbatim with no faked fallback.

- The 227-triple seed is real: `garden-default.ux.nt` = 233 lines (6 comment lines), 227 non-comment lines = the authoritative seed body.
- Read back via two independent paths, both = 227.
- Parsed by the same production parsers used by seed mode.
- **Guard against silent regression:** the test fails *loudly* when the binary is absent — no skip, no mock fallback:
  > `Error: gardend binary not found at /nonexistent. This test REQUIRES the real binary (no-mock rule). Set GARDEN_BIN, or run the live script: ...`
- Loopback MCP errors are surfaced verbatim; the store preserves the error string; there is no fallback to a hardcoded config when reads fail.

### Boundary: library stayed pure

The contract interface (`packages/nucleus/src/contract.ts`) is a pure abstraction — `AuthProvider`, `RestClient`, `CrdtBackend`, `RuntimeModeProvider`, `UiServices`. The library depends only on that interface; every concrete implementation lives shell-side in `apps/organism/src/cell/`.

- **`packages/` files modified by this iteration: 0.** The build commit `c6e9ec3` contains zero `packages/` files.
- Library dependencies remain only `lit` (+ `@shrubbery/nucleus` for runtime/components). Grep-verified: no imports of `node:http` / `node:https` / `loopback` / `gardend` / `spawn` / `auth` / `token` / `fetch` anywhere in library source.
- The browser never sees backend infrastructure (port, bearer token, loopback URLs) — the Vite proxy injects the bearer server-side, and the browser only ever issues same-origin `/cell/*` calls.

The shell got backend-aware; the library stayed an island. That was the whole point of the boundary.

---

## 3. How to run it

### Prerequisites
- A working `gardend` binary. Default discovery path: `/Users/vera/dev/sophia/garden/src-tauri/target/debug/gardend` (Mach-O x86_64, ~173 MB, the proven path). Override with `GARDEN_BIN`.
- `pnpm install` at the shrubbery root (root `package.json` has `pnpm.onlyBuiltDependencies: ['esbuild']`, required so tsx's esbuild binary links — see frictions).

### Run the real integration test
```
cd /Users/vera/dev/sophia/shrubbery/apps/organism
pnpm test:run        # spawns a real gardend, seeds 227 triples, reads back via both paths, renders, asserts DOM
```

### Run the live read end-to-end (no test runner)
```
cd /Users/vera/dev/sophia/shrubbery/apps/organism
pnpm gardend:live    # prints LIVE_READ_CONFIRMED on success
```

### Watch the live read in the organism (browser)
```
cd /Users/vera/dev/sophia/shrubbery/apps/organism
pnpm gardend:dev     # spawns + seeds a cell, writes .gardend-loopback.json (the file the Vite proxy reads)
pnpm dev             # Vite on :5180; reads .gardend-loopback.json server-side, proxies /cell -> the cell
# open http://localhost:5180, select source = "gardend cell (live)"
#   -> the layout renders from the live cell; read status shows last-read time + triple count (227)
```
The browser POSTs same-origin `/cell/mcp` with **no** bearer in the request; the proxy injects it server-side and forwards to `http://127.0.0.1:<port>/mcp`. (Verified separately: a same-origin POST carrying no bearer still returns the cell's data because the proxy adds it.)

### Spawn recipe (reference)
`gardend` takes **no CLI args** — env-only. Use a fresh temp profile per run (stale rocksdb lock → spawn hangs):
```
PROFILE_DIR=$(mktemp -d /tmp/gardend-cell.XXXXXX)
GARDEN_PROFILE_DIR="$PROFILE_DIR" \
GARDEN_LOOPBACK_HOST=127.0.0.1 \
GARDEN_LOOPBACK_PORT=0 \
GARDEN_LOOPBACK_TOKEN=<caller-uuid> \
  "$GARDEN_BIN" &
# read $PROFILE_DIR/loopback.json (CAMELCASE: {port, apiUrl, mcpUrl, token})
# readiness = loopback.json exists AND GET {apiUrl}/health is 2xx (health is unauthenticated)
# SIGTERM tears the cell down; rm -rf "$PROFILE_DIR" on teardown
```
Full working reference: `apps/organism/scripts/probe-gardend-liveread.sh`.

---

## 4. ITERATION-3 recommendation — the first real panel

**Lift the sidebar / filesystem tree (`mn-sidebar-panel`) as the first backend-coupled panel.**

Today every content region renders as an inert `<tag></tag>` placeholder. Only chrome (`mn-top-bar`, `mn-bottom-bar`, lifted in 1c) is real. Iteration 3 makes one panel populate from backend state, proving the shell → contract → component → events data flow once, so it can be repeated for chat / comments / wires later.

### Why the sidebar first
- **Read-mostly, no write, no CRDT.** A file list is the simplest backend coupling: fetch → tree → render. Strictly smaller than chat (message streams) or the document editor (TipTap + CRDT, deferred Class B).
- **Visually obvious.** A real tree in the left rail makes the "live read" claim viscerally true; inert placeholders don't.
- **Isolated.** `region-left-rail` is a single column; its only outputs are select/toggle events bubbled to the shell. It doesn't touch the center or right rail.
- **Unblocks downstream.** Once this seam works, chat/comments/wires reuse the exact shape with more async complexity.

### The ship (pure addition)
- **`packages/components/src/mn-sidebar-panel.ts`** — `@customElement` accepting an injected `contract` property; calls `contract.fs.list()` on load; renders a recursive tree; emits `mn-file-select(detail.path)` and `mn-folder-toggle(detail.path)`; shows loading + error states (no fake fallback); read-only this iteration (no create/delete/rename). Depends only on `lit` + contract types — grep-verified island.
- **`packages/components/src/__tests__/mn-sidebar-panel.test.ts`** — 6–8 tests: tree structure renders; file click emits `mn-file-select` with correct path; folder click emits `mn-folder-toggle`; loading branch; error branch.
- **`packages/nucleus`** — widen the contract with a `FileSystemService` type (`list(path?) => Promise<FileEntry[]>`, `FileEntry = { name, path, kind: 'file'|'dir', childCount? }`). **Capability stub** — names the seam, library still never consumes it; only the organism does.
- **`apps/organism/src/main.ts`** — inject the live contract into the sidebar element when "gardend cell (live)" is active; sidebar's load reads from the live cell.
- **`apps/organism/tests/sidebar-filesystem-tree.integration.test.ts`** — spawn a real gardend (reuse `spawnGardend`), back the sidebar with a small (3–5 entry) fake tree to prove component wiring, render, assert tree + events. (Reading a *real* Garden filesystem is deferred to S4/S5; this proves the seam.)

### Acceptance check (all must hold)
1. `pnpm -C packages/components test` → `mn-sidebar-panel.test.ts` PASS (6–8 tests: structure, events, loading, error).
2. `cd apps/organism && pnpm test:run` → integration test PASS (mocked-tree contract → sidebar renders + events fire over a real spawned cell).
3. `pnpm gardend:live` + organism running → select "gardend cell (live)" → sidebar populates with the tree; clicks bubble to the shell.
4. `vite build` in the organism → clean, no new errors.
5. `grep -r "y-websocket\|sessionStore\|filesystemStore\|nativeBridge" packages/components` → empty (component stays an island).
6. `tsc --noEmit` across all packages → clean.
7. Sidebar select/toggle events reach the shell (shell `console.log`s them; real routing to the document/session store is out of scope this iteration).

---

## 5. Awkward things to carry forward

These are real, load-bearing, and will bite the next person who forgets them.

1. **The +8 quadCount discrepancy is real.** `rdf_load`/`sparql_query`/`rdf_dump` response *envelopes* report `quadCount=235`, but the `:ux:config` graph holds exactly **227** triples. The +8 is response-envelope/result-set machinery, not loaded data. Always trust the `rdf_dump` body line count and the SPARQL `rows[0].n` binding (both 227) — **never** the `quadCount` field. The code and tests already do this; don't "fix" it back.

2. **Node 25 undici drops the bearer.** Raw native `fetch` with the loopback bearer → 401 "missing bearer token"; `node:http` with the identical bearer → 200; `curl` → 200. `LoopbackMcpClient` uses `node:http` in Node and `fetch` only in the browser (same-origin `/cell`, no bearer in JS). Don't collapse them back to one transport.

3. **`typeof window` is the wrong Node signal.** happy-dom (the test env) defines `window`, so `typeof window === 'undefined'` misfires. The Node/browser switch keys on `process.versions.node` only (the browser Vite build never defines it).

4. **RDF lands in named graphs, never the default graph.** Always `GRAPH <urn:mnemosyne:local:graph:{graph_id}:ux:config> { ... }`-wrap reads and pass `targetGraphIri`/`sourceGraphIri` on load/dump. A bare `SELECT ?s ?p ?o` sees the (empty) default graph and returns nothing. The named-graph IRI pattern is `urn:mnemosyne:local:graph:{graph_id}:ux:config`. A graph-less `INSERT DATA` is auto-rerouted into `:user:rdf` by the authority gate — always name the `:ux:config` graph explicitly when seeding.

5. **The graph dir must exist before any RDF op.** All RDF ops call `existing_graph_dir` and error otherwise. Call `create_graph` once first (snake_case args: `graph_id`, `title`). Note the casing split: `create_graph` is **snake_case**; `rdf_load`/`rdf_dump`/`sparql_query` use **camelCase** (`graphId`, `targetGraphIri`, `sourceGraphIri`). Don't mix them.

6. **Fresh temp profile per run is mandatory.** A stale rocksdb lock in a reused profile makes the spawn fail/hang. `mktemp -d` each run; `rm -rf` on teardown.

7. **loopback.json can land a beat before /health serves.** Poll both (file exists AND `/health` 2xx) before issuing requests. `GARDEN_LOOPBACK_PORT=0` means OS-assigned — read the chosen port from `loopback.json` (camelCase keys), never hardcode.

8. **Toolchain pins that are easy to undo by accident:**
   - vitest 4 imports vite's `./module-runner` subpath (vite 6+ only). The organism has vite 5, so it's pinned to **vitest ^3.2.6**. Library packages have no vite, so vitest 4 works there. Keep them split.
   - tsx's esbuild (0.28.1) vs vite's esbuild (0.21.5): pnpm blocks esbuild's postinstall by default, leaving the 0.28.1 platform binary unlinked. Fixed via root `package.json` `pnpm.onlyBuiltDependencies: ['esbuild']` + reinstall. Don't drop that key.
   - lit-html captures `const d = document` at module-eval time, so the standalone live script must install happy-dom globals **before** lit is transitively imported — done via a side-effect module (`happy-dom-globals.mts`) imported first. tsx needs the specifier written as `./happy-dom-globals.mjs` (it maps `.mjs`→`.mts`, not `.js`→`.mts`).
   - Vite ESM config has no `__dirname`; loopback-file resolution uses `fileURLToPath(import.meta.url)`.

9. **CORS was a red herring.** The gardend loopback already serves permissive CORS (tower_http `CorsLayer::very_permissive`): preflight OPTIONS → 200, ACAO mirrors the browser Origin, `credentials: true`. The Vite proxy's real jobs are (a) keep the random port + bearer out of browser JS, (b) inject the bearer server-side, (c) make the browser issue same-origin calls. It is **not** defeating CORS.

10. **Parallel-process hygiene.** A sibling process was running the release-examples gardend (`/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend`, PID 50621, NOT mine) with `gardend-ultra-*` temp profiles. Those are untouched. Name your own profiles distinctly (`gardend-cell.*`) and only kill PIDs/profiles you spawned. There's a newer release-examples binary (60 MB, Jun 19) with the same env contract, but the proven path this session is the **debug** binary; it was the one exercised.

11. **macOS has no `timeout` binary.** Guard long ops with `curl -m` and bounded poll loops, not coreutils `timeout`.

12. **Stale vite procs can squat port 5180** serving an old config without the proxy. If the proxy "doesn't work," kill stray vite procs and clear `node_modules/.vite` before debugging further.
