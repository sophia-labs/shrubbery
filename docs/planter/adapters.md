# PLANTER — the strangle ledger

`@shrubbery/source` (`packages/source/`) is the ONE hoisted adapters package
(R3). This is the ledger of what was hoisted from where, what was
deliberately left behind, and what stays a frozen fork with a named
retirement plan. It also carries the readPath deployment matrix and the
authz SEAM this slice is honest about not having closed.

## Hoist provenance — exact, per file

| Hoisted module | Base | Folded contributions |
|---|---|---|
| `transport/mcp-client.ts` | `apps/organism/src/cell/loopback-mcp.ts` | rhizome's `structuredContent`-first result handling (`garden-client.ts:145-165`); unified transport config (`{mcpUrl, token?, origin?, fetch?, transport?}`, replacing `LoopbackTransport`/`EmporiumTransport`/`GardenClientConfig`) |
| `transport/parse-term.ts` | `apps/rhizome/src/garden-client.ts:60-92` | as-is (`parseTerm`) |
| `transport/wait-healthy.ts` | `apps/rhizome/src/garden-client.ts:135-142` | as-is (`waitHealthy(baseUrl, {timeoutMs, intervalMs})`) |
| `gateway/gateway-transport.ts` | `apps/organism/src/cell/gateway-transport.ts` | as-is (per-request `auth.whenReady()`+`token()`; `GatewayHttpError` preserved as the taxonomy carrier) |
| `gateway/cognito-auth-session.ts` | `apps/organism/src/cell/cognito-auth-session.ts` | as-is (injectable fetch/storage/timers) |
| `gardend/gardend-source.ts` | `apps/organism/src/cell/gardend-contract.ts` (LoopbackRestClient read path) | **atelier's contribution**: the generic `dump(graphId, sourceGraphIri)` primitive (hosted shape, `hosted-gateway-contract.ts:89-108`) expressed on the loopback path — `read(graphIri)` subsumes `dumpUxConfig` AND atelier's `:ux:control` read |
| `fossil/fossil-source.ts` | modeled on `apps/organism` harness `in-memory-cell-contract.ts` | reduced to the `TripleSource` surface + the D2 fossil doctrine (capture-time-or-refuse) |
| `store/source-store.ts` | `apps/organism/src/cell/session-store.ts` (`CellConfigRead.readAt` is `TripleRead.readAt`'s direct ancestor) | first-class EMPTY pre-check + 1:1 taxonomy classification |
| `node/spawn-gardend.ts`, `node/seed.ts` | `apps/organism/src/cell/spawn-gardend.ts` (the newer copy, with the `cwd:profileDir` fastembed-cache fix) | seed split into its own module; gateway seeding variant added |
| `emporium/client.ts`, `emporium/store.ts` | `apps/organism/src/cell/emporium-client.ts` / `emporium-store.ts` | as-is (U10, §5 of the design) |

Every hoisted file carries a provenance header of the form:

```
HOISTED from apps/organism/src/cell/<file> @ b2f408e — organism's copy is
frozen under active swarm ownership; @shrubbery/source is the sole external
adapter-consumption convention. Organism's migration is a named follow-up
slice.
```

## Deliberately NOT copied (unanimous judge veto of the D2 wholesale-copy design)

The `WireWriter`, both CRDT backends (gateway/loopback), the full
`GardendContract`/`HostedGatewayContract` assemblies, app-routes,
public-shell, and `session-store`'s full contract machinery. Planter is a
**read-only** host — none of that is write-path or shell capability this
slice has a consumer for, and copying it wholesale is exactly the drift
surface that rotted atelier's fork (see below).

### The WireWriter echo-parse doctrine — RECORDED, not implemented

Two `WireWriter` implementations exist in the frozen organism fork today, and
they disagree on what to do when a `create_wires` call doesn't hand back an
id the caller already minted:

- `LoopbackWireWriter.create()` (`apps/organism/src/cell/gardend-contract.ts:194-215`)
  falls back to `params.wireId ?? ''` — silently returns an **empty string**
  wire id when the cell doesn't echo one.
- `HostedGatewayWireWriter.create()` (`apps/organism/src/cell/hosted-gateway-contract.ts:128-150`)
  parses the cell's response for the echoed id (`createdWireId(gatewayMcpText(result))`)
  and **throws** (`'HostedGatewayWireWriter.create(): cell did not return a wire id'`)
  when neither the caller-minted id nor an echoed one exists.

The hosted arm's discipline is the one worth keeping — a silent empty-string
id is exactly the kind of dishonest fallback this campaign's no-mocks
doctrine forbids elsewhere; an honest throw is strictly better than a
wire that silently can't be addressed again. **This is recorded, not
implemented**: `@shrubbery/source` has no `WireWriter` at all (planter never
writes wires), so there is nothing to fix yet. When a future write-capable
consumer of `@shrubbery/source` needs wire creation, it should build ONE
`WireWriter` with the hosted arm's echo-parse-or-throw discipline, not
`LoopbackWireWriter`'s `?? ''` fallback — this paragraph is that decision,
made once, for whoever builds it.

### Atelier's frozen `src/cell` fork

`apps/atelier/src/cell/` (`gardend-contract.ts`, `loopback-crdt-backend.ts`,
`loopback-mcp.ts`, `session-store.ts`, `spawn-gardend.ts`) is a second,
independently-drifted copy of the same organism lineage — **not** migrated
this slice, **not** touched (it is red on an unrelated artifact-PUT defect,
see below). Its one capability that mattered to this slice (`:ux:control`
reads) is preserved without copying it: `@shrubbery/source`'s
`read(graphIri)` is generic over sibling named graphs, so it subsumes both
`dumpUxConfig` and atelier's `:ux:control` read as the same primitive with a
different `graphIri` argument. Atelier's migration to `@shrubbery/source`
rides the organism follow-up slice (design §11 item 6 — Vera's green light).

### The pre-existing atelier artifact-PUT SHACL drift (cross-repo, carried into this ledger)

`apps/atelier/tests/vtuber-appearance-mirror.integration.test.ts`'s MIRROR
test (`(4) MIRROR: renders the current appearance and archives the portrait
as a real cell artifact`) is **pre-existing red**, not this campaign's to
fix — U0 already changed the test to capture and surface the response body
rather than hide it. The failure: `PUT
/navigation/{graphId}/artifacts/{artifactId}` (the loopback navigation
route, the one write path that pairs with `read_artifact` for fresh binary
content) returns **HTTP 400**, not 200, with a gardend-side SHACL validation
rejection naming the `emporium-workspace` vocab and `Expected datatype:
xsd:string`. This is a **cross-repo** contract drift between the current
gardend binary's SHACL enforcement on artifact PUT and whatever shape the
`emporium-workspace` vocab's SHACL shapes now expect for that write — garden
changed underneath a still-passing-when-last-verified atelier test. It is
carried forward here as a strangle-ledger item (this package touches
adjacent territory — the same gardend binary, adjacent artifact/emporium
machinery) and separately into
`eschaton-gateway-read-seam-memo.md` as a cross-repo item for whoever owns
the gardend SHACL enforcement side. **Not fixed here** — no-mocks and
scope discipline both forbid patching around a cross-repo contract drift
inside a docs-and-vocab unit.

### The two retired negotiates

Both pre-existing `negotiate` copies are gone: `apps/rhizome/src/negotiate.ts`
(deleted, `server.ts` repointed) and `apps/storybook/conneg/negotiate.ts`
(deleted, `server.ts`/`build-static.ts` repointed — `conneg/**` is NOT under
the frozen `stories/**`). Exactly one survives:
`packages/render/src/negotiate.ts`, exported from the render index, returning
the superset `NegotiationResult = {path, target, query, pinned}` (rhizome's
`query: URLSearchParams` + storybook's `pinned`). Both apps' existing
negotiate tests now run against the hoisted function unmodified — behavior is
pinned byte-identical, not merely "similar."

### The emporium convention supersession

Before this slice, `apps/emporium` was organism's only external consumer of
`@shrubbery/organism/cell/*` (verified: `shell.ts:42,47`;
`emporium-shell.integration.test.ts:26-27`;
`emporium-graph-view.integration.test.ts:31-32`; `package.json:20`). U10
migrated all four import sites to `@shrubbery/source/emporium` +
`@shrubbery/source/node`, added a grep-gate
(`apps/emporium/tests/no-organism-imports.test.ts`) pinning zero
`@shrubbery/organism` import specifiers in `apps/emporium`, and bundled the
R9 count-derivation fix (live-derived expected node/edge counts instead of a
fossilized `9/14`). After this unit, organism's exports map has **zero**
external consumers — deprecated-in-place, not removed (`apps/organism`
stays byte-untouched; `git diff --stat` proves it). `vocab-views.ts` did
**not** migrate into the package — it imports Lit and side-effect-imports
`@shrubbery/components`, so it moved to `apps/emporium/src/vocab-views.ts`
instead, keeping `@shrubbery/source`'s `"."` barrel Lit-free.

### Nucleus `StoreStatus` `'empty'` absorption — ledgered, not decided

The canonical `StoreStatus` (`'idle'|'loading'|'ready'|'error'`,
`reactive-store.ts:34`) is load-bearing and frozen-consumed (its doc comment
says members are string-compared; the runtime wire-mode controller is a
7-branch contention zone that is NO-TOUCH this campaign). `@shrubbery/source`
does NOT widen it. Instead `packages/source/src/store/source-store.ts`
defines a package-local `SourceStoreStatus =
'idle'|'loading'|'ready'|'empty'|'error'`, reusing the canonical member names
(never minting a fourth spelling like `'ok'`). **Whether `'empty'` is ever
absorbed into the canonical nucleus `StoreStatus`** is explicitly deferred to
whenever the runtime freeze lifts and the wire-mode-controller ownership
opens up again — not decided, not attempted, here.

### mem-* ISO timestamp carriers — follow-up, not converted this slice

The kind-reconciliation unit (U2) converted every epoch-ms-bearing carrier
this slice actually touches (`KnobResource.createdAt`), but the **mem-***
resources' ISO `createdAt` carriers — the as-of recomputation basis in
`apps/rhizome/src/memory-world.ts` (`mem:createdAt`, `MemRow.createdAt:
string`) and the same shape in `apps/rhizome/src/greenhouse-world.ts`'s
`MemRow` — stay ISO strings. Converting them is out of scope: they belong to
the rhizome memory-world surface, which this slice does not otherwise touch,
and "toward epoch-ms" (design §4c) is satisfied by converging every carrier
planter itself touches, not every carrier in the tree. Ledgered as a named
follow-up.

### JSON-LD body-testimony — follow-up, not implemented this slice

planter-server's testimony discipline (the six `X-Shrubbery-*` headers +
`Last-Modified`, set once before face dispatch) covers all four faces. The
markdown/HTML faces additionally carry a body-level capture footer, and the
turtle face carries a `#`-comment capture block. The **JSON-LD face's body
stays pure config this slice** — its testimony is headers-only. Making the
JSON-LD body itself carry capture testimony (e.g. a `prov:`-shaped
side-channel or an enclosing envelope) is a named later slice, not attempted
here — the render package's tested Link-set-parity invariant and the
`parseTurtle → parseTriplesToConfig` round-trip pin were the two things this
slice needed to keep intact, and neither requires touching the JSON-LD body
shape.

## The readPath deployment matrix

Every `TripleSource` adapter declares `liveness` (`'poll'` for all four live
adapters this slice; `'static'` for the fossil; `'push'` is a reserved,
unimplemented seam — no in-tree adapter can honestly declare it, since
gardend exposes no RDF-level change-notification surface). The
**hosted-gateway** adapter additionally declares a `readPath`, because it is
the only adapter with a real trust-boundary choice between two working read
paths:

| adapter | liveness | readPath | role required (gateway) | notes |
|---|---|---|---|---|
| `gardend-local` | `poll` | n/a (direct loopback) | none (loopback token only) | dev-mode default; `read`=`rdf_dump`, `select`=`sparql_query` |
| `hosted-gateway`, `readPath:'sparql'` (**the default**) | `poll` | `sparql` | **Viewer** | `POST {base}/o/{owner}/g/{id}{cellQueryRoute}`, default `/api/sparql/query`; Planter requires the exact typed owner and never falls back to the ownerless alias |
| `hosted-gateway`, `readPath:'mcp'` (explicit opt-in) | `poll` | `mcp` | **Editor** | `POST {base}/o/{owner}/g/{id}/mcp` (`rdf_dump`/`sparql_query`); richest read (native `nt`, true named-graph dump), but costs Editor today — see the authz SEAM below |
| `sparql` (generic SPARQL 1.1 Protocol) | `poll` | n/a | endpoint-defined (zero Sophia-isms; no gateway involved) | proven against the real oxigraph-WASM reference server, not gardend |
| `static-nt` (fossil) | `static` | n/a | n/a (no network) | `readAt` = capture time (invariant 7); construction refused without provenance |

Every deployment shape (planter-server, the SPA, a future static build)
defaults to `readPath:'sparql'` — the least-privilege choice. Escalating to
`'mcp'` is always an explicit boot-config act (`adapter:'hosted-gateway'`
with `readPath:'mcp'` named in `PlanterBootConfig`), never inferred.
For either hosted path, `PlanterBootConfig.owner` is mandatory and validated
against platform-next's typed principal grammar. Graph ID alone is not an
authority or a stable target.

## The authz SEAM (verbatim-cited)

`platform-next/gateway/src/authz.rs:58-72` (`required_role`):

```rust
pub fn required_role(method: &Method, upstream_path: &str, is_ws_upgrade: bool) -> Role {
    // A WS upgrade arrives as GET, but the channel itself carries writes, so it
    // must outrank the plain-GET rule below.
    if is_ws_upgrade {
        return Role::Editor;
    }

    match *method {
        Method::GET | Method::HEAD | Method::OPTIONS => Role::Viewer,
        Method::POST if is_read_only_post(upstream_path) => Role::Viewer,
        // SEAM (future): `/mcp` POSTs are uniformly `Editor` today. When we add
        // tool-level authorization, branch here on the JSON-RPC method/tool name
        // so read-only MCP tools (e.g. read_document, search_*) can be served to
        // viewers while write tools stay editor-gated. Until then, MCP is
        // treated as write because a single endpoint multiplexes both.
        _ => Role::Editor,
    }
}
```

`READ_ONLY_POST_PATHS` (`authz.rs:31-38`, the Viewer-eligible allowlist
`/api/sparql/query` belongs to, at `authz.rs:37`):

```rust
const READ_ONLY_POST_PATHS: &[&str] = &[
    "/graphs/query",
    "/api/graphs/query",
    "/search",
    "/search/blocks",
    "/search/hybrid",
    "/api/sparql/query",
    "/api/semantic/search",
];
```

Full discussion, the four unlocks, and consumers: `eschaton-gateway-read-seam-memo.md`.
