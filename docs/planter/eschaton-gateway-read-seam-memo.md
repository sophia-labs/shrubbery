# Memo — gateway read-seam gaps for a Viewer-role read path

**For:** Eschaton (cloud transition owner). **From:** the PLANTER slice
(planter-server / SPA, `apps/planter` + `@shrubbery/source`).
**Status:** memo, not code — everything here is a request/observation about
`platform-next`, which this slice only read (never edited; per root
`CLAUDE.md`, cloud transition is Eschaton's). Nothing in this slice depends
on any of these unlocks landing — the hosted-gateway adapter already defaults
to the best available path (`readPath:'sparql'`) and documents the cost of
the alternative (`readPath:'mcp'`). This memo exists so that cost, and the
four unlocks that would remove it, are named in one place.

## Context: why this memo exists

A Shrubbery **site** is meant to be a published, agent-discoverable,
potentially-anonymous-readable thing (a curl-able resource, `docs/planter/
README.md`'s four faces). The gateway's authorization model, as it stands
today, makes that harder than it needs to be in four independent ways. None
of these are bugs — they are documented, deliberate scope cuts in
`platform-next` (the SEAM comment below says so explicitly) — but they are
the gap between "planter can render any TripleSource" and "a published
Shrubbery site can be read anonymously, cheaply, and cacheably from a CDN."

## 1. Tool-level authz on `/g/{id}/mcp` — the SEAM, verbatim

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

**Consequence today:** every MCP tool call — including read-only ones
(`sparql_query`, `rdf_dump`, `read_document`, `search_*`) — costs **Editor**
role, because `/g/{id}/mcp` is one endpoint multiplexing read and write JSON-RPC
methods, and the gateway can't see inside the JSON-RPC body to tell them
apart at the routing layer. **Consumer named:** `@shrubbery/source`'s
`hosted-gateway` adapter's `readPath:'mcp'` arm — it is explicit opt-in,
documented as "For authoring/operator deployments that knowingly hold an
Editor credential" (`gateway-source.ts`), precisely because of this SEAM.
`readPath:'sparql'` (the default) sidesteps it entirely by using the
Viewer-eligible `POST /api/sparql/query` cell route instead — but that route
gives up MCP's richer native-`nt` dump and true named-graph semantics. **The
unlock:** branch on the JSON-RPC method/tool name once tool-level
authorization exists, so read-only MCP tools become Viewer-eligible while
write tools stay Editor-gated — exactly what the SEAM comment already says.
Consumers who would immediately benefit: any hosted-gateway deployment that
wants MCP's richer read shape without granting Editor to a mere reader
(planter's `readPath:'mcp'` opt-in becomes safe to make the default).

## 2. Anonymous-Viewer grant class for published sites

Today's anonymous surface is exactly two shapes
(`platform-next/gateway/src/routes.rs:182-213`, `is_public_cell_path`):
`GET /g/{id}/health` and query-signed `GET
/g/{id}/artifacts/{graph}/images/{image}?token=..&exp=..`. Anonymous requests
**never spawn cells** — a deliberate denial-of-wallet guard
(`routes.rs:627-631`: "Anonymous requests exist only for the public
cell-health probe ... a denial-of-wallet vector. Authorization is skipped for
them by contract" — and the anonymous health-probe path explicitly refuses
to spawn: `"cell not running (anonymous health probes do not spawn cells)"`,
`routes.rs:675`).

**Consequence:** there is no anonymous-Viewer grant class at all for reading
a graph's actual content — every real read needs a credential today, even
for a graph its owner wants public. **Consumer named:** a published
Shrubbery site (planter-server or the static-build later slice) whose owner
wants it readable by an anonymous visitor or crawler. **The unlock:** a
flagged-public-graph grant class that treats anonymous GETs on the
Viewer-eligible allowlist (`/api/sparql/query`, etc.) as Viewer-role for
graphs explicitly marked public — **with the existing denial-of-wallet guard
rethought, not removed**: a pre-warmed/cached-cell tier (rather than
spawn-on-anonymous-GET) would let a public read succeed without reopening the
spawn-on-demand cost surface the current guard exists to close.

## 3. `PN_CORS_ORIGINS` for CDN/SPA origins

`helm/platform-next/values.yaml:66-67`: `corsOrigins: []` — "empty disables
the CORS layer entirely" (the values file's own comment). The gateway
service's CORS middleware reads `PN_CORS_ORIGINS`
(`helm/platform-next/templates/gateway.yaml:215-217`, only rendered when
`corsOrigins` is non-empty).

**Consequence:** a browser-hosted planter SPA (deployment shape 3,
`deployment.md`) served from any origin other than the gateway's own will
fail CORS preflight against every environment using the current default —
local docker-desktop (verified: this slice's own P2.5 runbook needs it) AND,
presumably, canary, unless it is already set there (not verified this
session — read-only reference only). **Consumer named:** any CDN-served
static build or SPA deployment of a Shrubbery site, plus this slice's own
env-gated P2.5 test tier. **The unlock:** set `PN_CORS_ORIGINS` to include
the CDN/SPA origin(s) for any environment meant to serve a browser-hosted
planter deployment.

## 4. A cacheable GET read route with ETag = content sha

No route in `platform-next` today serves graph content as a cacheable GET
with an ETag. The closest existing precedent for the discipline is
Emporium's own golden-pack serving convention (`served_at: "/emporium/vocab/
{name}/{version}", ETag = sha` — see the `shrubbery-site` vocab draft's own
`registration.served_at` field, `docs/planter/site-vocab/
shrubbery-site.golden.json`), which this memo proposes generalizing to graph
reads.

**Consequence:** every planter read today is either a POST (MCP or the
SPARQL route — neither cacheable by a CDN edge, both requiring
per-request auth resolution) or an anonymous GET restricted to health/signed
images. There is no GET route a CloudFront distribution could cache a
published site's content behind. **Consumer named:** the future
`build-static.mts` route×face static build (design §7, D17, named later
slice) and any CDN-fronted live-read deployment of a Shrubbery site — both
want "serve this graph's current triples" to be a cacheable GET, not a POST.
**The unlock:** a `GET /g/{id}/api/sparql/query`-shaped (or dedicated) read
route with `ETag` set to a content hash of the response body, so CloudFront
(or any HTTP cache) can validate/revalidate without re-hitting the cell on
every request.

## 5. WP5.1 seeding gap

`platform-next/gateway/src/ux_seed.rs` builds the idempotent
`:ux:config`-seeding SPARQL (`build_ux_config_seed`/`default_ux_config_seed`)
but its own module doc says, verbatim: *"NOT WIRED here — the create-flow
insertion point (status-gated, after the cell-create response) is WP5.1."*
**Zero callers exist anywhere in `platform-next` today** (confirmed:
`ux_seed` is registered as a module in `lib.rs` and nowhere else invoked).
Its `default_ux_config_seed` fallback body
(`DEFAULT_UX_CONFIG_BODY_NT`) is exactly **4 triples** — one `Workspace`
type declaration, a `localId`, an `rdfs:label`, and one
`renderedByComponent` tag — with **zero regions, zero panels**. If WP5.1 were
wired using only this fallback body (rather than the WP0.2-generated full
default), a freshly-created graph would present as a workspace with no
navigable regions at all.

**Consequence:** a freshly-provisioned graph's `:ux:config` graph is
genuinely empty until something else seeds it — planter's own `EMPTY` store
status (first-class, never an error) is the correct honest response to this
today, and `apps/planter/scripts/seed.mts` is the documented, explicit,
never-automatic affordance for a human/operator to fix it. **Consumer
named:** any newly-provisioned graph's planter-server or SPA read — it will
render the `'empty'` panel ("0 triples — seed with `pnpm --dir apps/planter
seed …`") until seeded, which is honest but not what a "just-created site
already has a default layout" UX would want. **The unlock:** wire WP5.1's
insertion point (status-gated, after the cell-create response) using the
FULL WP0.2-generated default body (matching build-time `GARDEN_DEFAULT`),
not the 4-triple fallback — the module doc already names this as the
intended eventual behavior.

## What is NOT in this memo

Prioritization of these four unlocks against the rest of the cloud-2
maturation backlog is a cloud-ownership conversation (design §11 item 7) —
this memo states the gaps and their consumers, not an order to fix them in.
Nothing here should be read as blocking on Eschaton; the hosted-gateway
adapter's `readPath:'sparql'` default already works around #1 today, and
none of #2–#5 have any planter code depending on their existence.
