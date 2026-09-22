# PLANTER — slice map + FID-004 live-read gate record

This directory is the PLANTER slice's own documentation, distinct from
`docs/acceptance/` (the garden-wide fidelity census — **NO-TOUCH**, see
`census-notes.md`). Full design: `DESIGN-20260711.md`. This file is the
orientation entry point.

## What PLANTER is

`packages/source` (`@shrubbery/source`) — one hoisted `TripleSource` adapters
package (gardend-local, hosted-gateway, generic SPARQL, static-nt fossil) —
and `apps/planter` — a generic curl-able + browsable host (`planter-server`'s
four conneg faces, the planter SPA) that renders **any** bound `TripleSource`
as a Shrubbery site. Nothing in the host knows which adapter it holds; the
`TripleSource` sub-contract (`packages/nucleus/src/triple-source.ts`) is the
seam.

`packages/site` (`@shrubbery/site`) now supplies code-reviewed declarative
product bundles. The first is Garden: it reuses the canonical layout/seed and
the rich shared component/visual system while declaring routes, faces,
appearance, panel posture, component bindings, and an honest capability ledger.
See `garden-site-bundle.md`.

## THE FID-004 GATE — status: GREEN

**No live-read claim in any doc, face, census note, or test name in this
slice precedes this record.** This is the single most load-bearing fact in
the slice: every "planter reads a real gardend cell and stays correct across
a restart" claim below — the four faces (U9), the SPA (U11), the
static/live parity test (U12) — rests on this probe having been run and
having passed, not on inference from the adapter code alone.

- **Probe:** `packages/source/tests/fid004-convergence.probe.test.ts` (the
  WF-D live-read gate, template commit `2ce2357`). Spawns a real gardend on a
  persistent temp profile; writes `:ux:config` triples through one authority
  via BOTH real write variants (`rdf_load` and a `sparql_update` `INSERT
  DATA` with a literal `GRAPH` target); reads back **cold** — a fresh
  `McpClient`/`TripleSource` per read, never the writer's connection — via
  BOTH read paths (`sparql_query` and `rdf_dump`); `SIGTERM`s the cell
  **without removing the profile**; respawns on the **same** profile (a fresh
  token proves it is a real second process); re-reads both variants via both
  paths. Asserts count parity AND term-for-term parse-equality (canonical
  N-Triples lines, sorted, compared) at every stage.
- **Result:** GREEN. 2 tests passed.
- **Binary:** `gardend` (garden's `src-tauri/target/release/examples/gardend`
  example binary), sha256
  `59cb506c47ccb3ec1289c568182f6215d6482c1de8d5bdbdc23acc7d950bb430`.
- **Date of the recorded green run:** 2026-07-11 (re-confirmed green again
  2026-07-12 against the same binary sha, during U13's own verification pass
  — `pnpm --filter @shrubbery/source exec vitest run
  tests/fid004-convergence.probe.test.ts`).

**What this proves:** `:ux:config` triples written via one authority
(gardend's real MCP surface) are visible to the SPARQL face — both cold (a
brand-new connection, never the writer's) and after a full cell restart on
the same on-disk profile. **What this does NOT prove:** anything about the
census's own FID-004 defect, which is a broader UI/collaborative-projection
convergence claim over documents/blocks/search, not this probe's narrower
`:ux:config`-triples-via-MCP claim. See `census-notes.md` for the boundary.

**If this probe ever goes red again:** per design §3.4/D11, that is a
garden-side regression to escalate as a memo, not a planter bug to route
around; host acceptance re-scopes to the fossil (`static-nt`) adapter only,
honestly labeled, until it is green again. No unit may re-add a live-read
claim while it is red.

## Slice map — where things live

| concern | location |
|---|---|
| `TripleSource` sub-contract (the seam) | `packages/nucleus/src/triple-source.ts` (exported from the nucleus barrel only) |
| kind-vocabulary reconciliation | `packages/nucleus/src/kinds/` (`DISPLAY_KINDS`, `format.ts` timestamp helpers) |
| the one hoisted adapters package | `packages/source/` (`@shrubbery/source`) — see `adapters.md` |
| negotiate (content negotiation) | `packages/render/src/negotiate.ts` — the ONE surviving copy (see `adapters.md`) |
| the generic host | `apps/planter/` — `server.ts` (four faces), SPA (`main.ts`), seed/dump CLIs |
| FID-004 gate | `packages/source/tests/fid004-convergence.probe.test.ts` |
| registered site projection vocabulary | `docs/planter/site-vocab/` — golden JSON + rationale |
| reusable Garden product bundle | `packages/site/src/garden.ts` + `garden-site-bundle.md` |
| deployment shapes + runbooks | `deployment.md` |
| the gateway read-seam memo (for Eschaton) | `eschaton-gateway-read-seam-memo.md` |
| census boundary note | `census-notes.md` |

## Running the pieces

```sh
# Unit/pure + fossil/gardend conformance suites (packages/source):
pnpm --filter @shrubbery/source exec vitest run

# The FID-004 gate on its own:
pnpm --filter @shrubbery/source exec vitest run tests/fid004-convergence.probe.test.ts

# planter-server (four faces) — boots through the SAME validated
# PlanterBootConfig resolution the SPA uses (HIGH-2): PLANTER_ENDPOINT/
# PLANTER_GRAPH are always required, and since 'gardend-local' has no
# inference rule (only 'static:' endpoints and auth.mode:'cognito' infer an
# adapter — boot.ts's two rules), PLANTER_ADAPTER must be given explicitly
# here too. A malformed/unrecognized value in ANY of these refuses, naming
# the field — never a hardcoded fallback, never an auth downgrade:
PLANTER_GRAPH=g1 PLANTER_ENDPOINT=http://127.0.0.1:7090 \
  PLANTER_ADAPTER=gardend-local PLANTER_AUTH_MODE=dev PLANTER_AUTH_TOKEN=bench-token \
  pnpm -C apps/planter serve

# ...or the static-nt fossil adapter, no credentials, no live process:
PLANTER_GRAPH=g1 PLANTER_ENDPOINT=static:/path/to/g1.nt PLANTER_ADAPTER=static-nt \
  pnpm -C apps/planter serve

# ...or behind platform-next's gateway (readPath defaults 'sparql'):
PLANTER_OWNER=agent:phanes PLANTER_GRAPH=g1 PLANTER_ENDPOINT=https://api.canary.sophia-labs.com \
  PLANTER_ADAPTER=hosted-gateway PLANTER_AUTH_MODE=dev PLANTER_AUTH_TOKEN=<editor-token> \
  pnpm -C apps/planter serve

# Seed a fresh graph with the current canonical garden-default fixture (against a
# local gardend's own profile dir — the --profile-dir arm):
pnpm -C apps/planter seed --graph g1 --profile-dir /path/to/gardend-profile

# ...or seed against ANY endpoint (gateway Editor write):
pnpm -C apps/planter seed --graph g1 --endpoint http://127.0.0.1:7090 --auth-mode dev --token bench-token

# Dump a fossil (provenance-headed .nt) from any TripleSource:
pnpm -C apps/planter dump --graph g1 --endpoint http://127.0.0.1:7090 --adapter gardend-local \
  --auth-mode dev --token bench-token --out /tmp/g1.nt

# apps/planter's own test suite (unit + integration; FID-004-dependent
# assertions inherit its green status):
pnpm --filter @shrubbery/planter exec vitest run
pnpm --filter @shrubbery/planter exec tsc --noEmit

# Real gardend + real Chromium over the Garden bundle:
pnpm --filter @shrubbery/planter test:browser:garden
```
