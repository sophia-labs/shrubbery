# RHIZOME v1 — the read-only memory observatory

RHIZOME renders a live **gardend cell's `:projection:memory`** named graph as a
browsable, content-negotiating surface. It is the `dom` + `curl`/`turtle`/`json`
faces of one memory world: the **subject-beds** (each a lineage chain — a current
head with its superseded predecessors), and the **`?asof` temporal lens** that
recomputes "what was current as-of T" from `mem:createdAt`, not from the store's
mutated `mem:status` flag.

It is **read-only**. No DeepSeek, no writes, no judgment — it observes the cell.

## The two faces, one interpreter (the agent-native heart)

The same resource, negotiated by `Accept`:

| You are…                       | You get…                                                        |
|--------------------------------|-----------------------------------------------------------------|
| a bare `curl`                  | a beautiful **Markdown** page (Current / Superseded / Lineage / Navigate) |
| `curl -H "Accept: text/turtle"`| **RDF/Turtle** with the store's real `mem:` predicates           |
| `curl -H "Accept: application/ld+json"` | **JSON-LD** (`@context` + `@graph` + `_links`)          |
| a **browser** (`Accept: text/html`) | the **DOM observatory** — THE PLOT (bloomed heads over a dimmed, struck SOIL of superseded records) / THE BOUQUET (a subject's constellation, each record annotated *why*) / THE SCRUBBER (the as-of lens) |

Every face advertises the SAME FAIR Signposting / RFC 8288 `Link` set (the
parity invariant). Explicit `.ttl` / `.json` / `.md` / `.html` extensions pin a
face; `?asof=YYYY-MM-DD` is honored on every read.

There is exactly ONE data path: `MemoryWorld` over the gardend `/mcp` SPARQL wire
(the same wire `choreograph/scripts/longmemeval/gardend.ts` uses). The curl faces
and the DOM faces render the SAME live resources — no second model, no snapshot.

## Run it

The observatory reads a running gardend cell. Boot it read-only (idempotent — it
may already be up; check `curl -fsS http://127.0.0.1:7090/health` first):

```sh
GARDEND_BIN=/Users/vera/dev/sophia/garden/src-tauri/target/release/examples/gardend \
GARDEND_PORT=7090 GARDEND_TOKEN=bench-token \
  bash /Users/vera/dev/sophia/choreograph/scripts/longmemeval/boot-gardend.sh
# (to stop: kill "$(cat /Users/vera/dev/lme-bench/out/gardend.pid)")
```

### The conneg server (curl + DOM, ONE port)

```sh
GARDEND_PORT=7090 GARDEND_TOKEN=bench-token RHIZOME_GRAPH=6a1eabeb-agentic \
PORT=8791 pnpm -C apps/rhizome serve
```

Then:

```sh
curl http://localhost:8791/plot                          # the index of subject-beds (markdown)
curl http://localhost:8791/plot/3c3734609b68             # the 5K-PB bed (25:50 current, 27:12 superseded)
curl 'http://localhost:8791/plot/3c3734609b68?asof=2023-05-25'   # as-of then → head recomputes to 27:12
curl -H "Accept: text/turtle" http://localhost:8791/plot/3c3734609b68   # RDF/Turtle
curl -H "Accept: text/html"   http://localhost:8791/plot/3c3734609b68   # the DOM observatory
```

### The browser shell (DOM only, live refetch)

```sh
GARDEND_PORT=7090 GARDEND_TOKEN=bench-token pnpm -C apps/rhizome dev   # → http://localhost:5185
```

The browser reaches the cell over a same-origin `/cell` Vite proxy that injects the
bearer server-side (the token never reaches browser JS).

### Tests

```sh
pnpm -C apps/rhizome typecheck                            # green
GARDEND_PORT=7090 GARDEND_TOKEN=bench-token pnpm -C apps/rhizome smoke   # DOM smoke vs the REAL cell
pnpm --filter @shrubbery/render test:run                  # the render-union faces (incl. rhizome)
```

The smoke self-skips (it does not fail) when the cell is unreachable, honoring the
NO-MOCK rule without coupling CI to a live cell.

## What it touches

RHIZOME is an **additive app** (`apps/rhizome`). The one shared package it extends
is `@shrubbery/render`: the `Resource` union gains `mem-plot` / `mem-subject` (the
design's named net-new contribution — the triple / hypertext / links branches for
the memory world). Everything else lives in this app.

## What works vs. what's deferred

**Works (v1):**
- Live read of `:projection:memory` over the gardend `/mcp` SPARQL wire (no mocks).
- All four curl faces (markdown / turtle / json-ld / html) + the FAIR Link set,
  served from ONE conneg server, negotiated by `Accept`.
- The DOM observatory (PLOT / BOUQUET / SCRUBBER), rendered server-side via the
  SAME render path the browser uses, emitted as Declarative Shadow DOM (a browser
  re-hydrates the shadow trees natively; a bare `curl -H "Accept: text/html"` still
  sees every bloom + soil row inline).
- The `?asof` temporal lens on every face — heads recomputed from `mem:createdAt` +
  lineage-root grouping, NOT the globally-mutated `mem:status` flag (verified: as-of
  2023-05-25 the 5K head is 27:12 whose status flag reads `superseded`).

**Deferred:**
- **The Greenhouse write-through cliff (WP5.2).** RHIZOME is read-only by design;
  there is no write/edit path into memory from the observatory.
- **Live push.** "Live" is refetch-on-flush (the browser shell re-reads on intent;
  the server reads per-request). There is no subscription/streaming from the cell.
- **Production curl faces.** The conneg server is a local/dev surface. Deploying the
  curl faces (e.g. behind the gateway with content negotiation) is held for
  deploy-safety — not wired in v1.

## Implementation notes worth knowing

- **DOM server transform.** The `dom` face renders the real Lit observatory
  server-side via a lazily-created Vite SSR dev server (`dom-server.ts`). This is
  deliberate: `@shrubbery/components` use Lit 3 **standard** decorators, which Vite's
  esbuild transform compiles correctly, whereas raw `tsx` honors each package's
  `experimentalDecorators:true` tsconfig and emits the legacy helper Lit rejects.
  happy-dom is installed onto the runtime (`dom-globals.ts`, the vitest pattern)
  before lit-html loads, and lit is forced through the SSR transform
  (`ssr.noExternal`) so it captures the live `document`.
- **Read-only honored.** The cell holds exactly 5 `mem:MemoryRecord`s before and
  after any number of observatory requests.
