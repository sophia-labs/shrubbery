# curl-catalog spike (B0 + B1)

One resource, four faces. The Shrubbery component catalog is now `curl`-able as
**markdown / Turtle / JSON-LD / HTML**, content-negotiated off a single triple
production, with FAIR Signposting Link headers so an agent (or a human with a
terminal) can traverse the whole thing. This was proven end-to-end **locally** —
nothing prod was touched. The real CloudFront/S3 deploy is a small, documented,
**gated** follow-up at the bottom.

Commits: `de76195` (B0), `b28690d` (B1), on `main` in `shrubbery/`.

---

## What was built

### B0 — render-target core (`packages/render`, NEW pure package)

A Lit-free, DOM-free, network-free package: `deps = @shrubbery/nucleus + jsonld`.
The whole thing is one idea: `renderResource(resource, target, ctx)` treats the
target as a parameter and dispatches.

- `target.ts` — the face enum (`turtle | json | hypertext`) + content-type map.
- `resource-triples.ts` — **one** triple production per resource (reuses nucleus
  `serializeConfigToTriples` for workspace configs). Both RDF faces consume it,
  so Turtle and JSON-LD can never disagree.
- `context.ts` — the JSON-LD `@context`, defined **once** and shared by every
  JSON-LD face (single source of truth for term names + datatype coercions).
- `turtle.ts` / `render-turtle.ts` — pretty Turtle via a real serializer + a
  matching parser that round-trips exactly.
- `render-json.ts` — compacted JSON-LD through the `jsonld` lib
  (`fromRDF → compact` against the shared context). `useNativeTypes: OFF` chosen
  so it stays browsable *and* round-trips to the exact same RDF.
- `render-hypertext.ts` — beautiful markdown (per-resource-kind shaping) + a
  copy-pasteable **Navigate** curl block + the alt-link set.
- `links.ts` — the alt-link set, computed **once**, byte-identical across all
  four faces (the Link-set parity invariant; it is a tested gate).

### B1 — catalog curl faces + local conneg server (`apps/storybook/conneg`)

- `negotiate.ts` — pure Accept→ext logic (default markdown; explicit `.ext`
  always wins). This is the exact rule the CloudFront function must mirror.
- `resources.ts` — wires the **REAL** catalog data (`CATALOG_ENTRIES`, derived
  from the component-library MANIFEST + the built chrome set) and the
  `GARDEN_DEFAULT` workspace into renderable resources. No mocks.
- `html-shell.ts` — shared HTML wrapper so the live server and the static
  builder emit byte-identical HTML.
- `server.ts` — a local content-negotiating dev server that **mimics the
  CloudFront viewer-request function + S3**: Accept→ext, default markdown,
  explicit `.ext` wins, FAIR Signposting `Link` headers
  (self/alternate/describedby/item), `Vary: Accept`.
- `build-static.ts` — the static face-multiplier. Writes the S3 object layout
  `<path>/index.{html,md,ttl,jsonld,json}` for every resource.

The catalog now has its **third and fourth faces** (curl-able RDF + hypertext)
alongside the two it already had (Storybook + the manifest), all derived from the
one `CATALOG_ENTRIES` list.

---

## Honest test counts

Re-ran `pnpm -r test:run` for this writeup — **all green**, full workspace:

| package | tests |
|---|---|
| `packages/tokens` | 23 |
| `packages/nucleus` | 166 |
| **`packages/render`** (NEW, B0) | **34** |
| `packages/runtime` | 28 |
| `packages/components` | 49 |
| `apps/organism` | 6 |
| **`apps/storybook`** (incl. conneg, B1) | **41** |
| **total** | **347** |

The pre-spike baseline was **283**; the spike added **+64 net** (render +34;
storybook conneg +30: 13 negotiate, 10 in-process HTTP server, 6 resources,
1 four-face static-build). The storybook total of 41 includes pre-existing
catalog tests (catalog-coherence = 11) plus the 30 new conneg tests.

`pnpm -r build` (tsc `--noEmit`) typechecks clean across all packages including
the new `@shrubbery/render`.

**Honest caveats on the counts:**
- `apps/storybook` has **no standalone `tsc`/typecheck** (no `typescript` dep —
  it's checked via storybook/vite + vitest's esbuild). The conneg `.ts` files run
  via `tsx` (no emit) and are type-exercised by the vitest run + the render
  package's own `tsc --noEmit`. Acceptable for tooling-level code, but it is not
  a full type-check of those files.
- `apps/storybook` has no `build` script (only `build-storybook`), so it is not
  one of the 7 projects in `pnpm -r build`.

---

## The LITERAL curl commands to try it

```bash
# from the repo root
cd /Users/vera/dev/sophia/shrubbery

# 1. start the local conneg server (pick any free port)
PORT=8842 pnpm --dir apps/storybook curl-catalog:serve
# (leave it running; open a second terminal for the curls below)
```

Then, against `http://localhost:8842`:

```bash
# THE DEFAULT — bare curl returns beautiful markdown + a Navigate curl block
curl http://localhost:8842/catalog

# show the headers too — FAIR Signposting Link set + Vary: Accept
curl -D - http://localhost:8842/catalog

# FACE 1 — Turtle (RDF)
curl -H "Accept: text/turtle" http://localhost:8842/catalog

# FACE 2 — JSON-LD (with shared @context)
curl -H "Accept: application/ld+json" http://localhost:8842/catalog

# FACE 3 — HTML
curl -H "Accept: text/html" http://localhost:8842/catalog

# explicit .ext ALWAYS wins over Accept
curl -H "Accept: text/html" http://localhost:8842/catalog.ttl   # -> turtle

# HATEOAS — follow a Navigate link straight out of the markdown
curl http://localhost:8842/catalog/mn-graph-panel
```

Or skip the server and **build the static S3 layout** to disk:

```bash
OUT=/tmp/conneg-static pnpm --dir apps/storybook curl-catalog:build
# writes /tmp/conneg-static/catalog/index.{html,md,ttl,jsonld,json}, one dir per resource
```

### Observed output (re-run for this writeup, port 8842)

Bare `curl http://localhost:8842/catalog` — `content-type: text/markdown;
charset=utf-8`, `vary: Accept`, and a `link:` header carrying the full set:

```
link: <…/catalog>; rel="self"; type="text/markdown…",
      <…/catalog.md>; rel="alternate"; type="text/markdown…",
      <…/catalog.ttl>; rel="describedby"; type="text/turtle…",
      <…/catalog.json>; rel="alternate"; type="application/ld+json…",
      <…/catalog.html>; rel="alternate"; type="text/html…",
      <…/catalog/mn-top-bar>; rel="item"; …  (one rel=item per component)
```

Body (head):

```
# Shrubbery Component Catalog

The component library, derived from the engine MANIFEST + the built chrome set …

**4 components.**

## Components
| Component | Class | Manifested | Built | Notes |
| [`mn-top-bar`](…/catalog/mn-top-bar)        | A | no  | yes | Chrome top bar … |
| [`mn-bottom-bar`](…/catalog/mn-bottom-bar)  | A | no  | yes | Chrome bottom bar … |
| [`mn-document-editor`](…/catalog/mn-document-editor) | B | yes | no  | Class B … |
| [`mn-graph-panel`](…/catalog/mn-graph-panel)| C | yes | no  | Class C (WebGL) … |

## Navigate
```
curl …/catalog                                       # this page (markdown)
curl …/catalog/mn-top-bar                            # open mn-top-bar
curl -H "Accept: text/turtle" …/catalog              # as RDF/Turtle
curl -H "Accept: application/ld+json" …/catalog       # as JSON-LD
```
```

Content-types observed (one URL, four faces, plus the override):

```
(bare)                          -> text/markdown; charset=utf-8      # default
Accept: text/turtle             -> text/turtle; charset=utf-8
Accept: application/ld+json      -> application/ld+json; charset=utf-8
Accept: text/html               -> text/html; charset=utf-8
Accept: text/html  /catalog.ttl -> text/turtle; charset=utf-8        # .ext wins
```

---

## No-mock / boundary verdict

**No mocks of the domain data.** The catalog faces are rendered from the REAL
`CATALOG_ENTRIES` (derived from the component-library MANIFEST + the built chrome
set) and the REAL `GARDEN_DEFAULT` workspace. The triples are produced by the
real nucleus serializer. The JSON-LD compaction goes through the real `jsonld`
library, and it round-trips: compacted JSON-LD expands (via `jsonld.toRDF`) to the
**exact same triple set** the Turtle face emits. B1 also got an **independent**
RDF parse via `uv run --with rdflib` (catalog Turtle = 40 triples; catalog
JSON-LD expands to 40 triples; workspace Turtle = 227 triples) — i.e. validated
by a parser that is not the render package's own round-trip test.

**Where the boundary is honestly drawn.** This spike is a faithful **local
simulation** of the prod boundary, not the prod boundary itself:

- `server.ts` **mimics** the CloudFront viewer-request function + S3 object
  serving. It is not CloudFront. The Accept→ext rule lives in `negotiate.ts` as
  pure string logic precisely so it can be transcribed verbatim into the
  CloudFront JS — but that transcription has **not** happened yet.
- The static layout written by `build-static.ts` is the intended S3 layout, but
  it has **not** been synced to any bucket.
- Two honesty notes carried from B0: the conneg node tools deliberately **do not**
  side-effect-import `@shrubbery/components` (tsx/esbuild can't run Lit's
  decorator transform headless), so "is this component built?" is answered by a
  DOM-free `isBuiltStatic(entry)` that agrees with the live registry rather than
  by importing the registry. And the in-process HTTP probe tests are pinned to
  `// @vitest-environment node` because happy-dom's fetch enforces a browser
  same-origin policy that blocked the loopback probe.

So: the **render core and the negotiation logic are real and tested**; the
**prod transport is simulated**. The gap to prod is exactly the gated follow-up
below.

---

## GATED follow-up — deploy for real (needs a deploy-safety pause)

> ⚠️ **PAUSE.** Per the Sophia deployment-safety rule, do **not** run
> `terraform apply` or the S3 sync without showing the diff and getting explicit
> go-ahead. Nothing below has been applied. This section is the plan, not an act.

The target is the existing **wormnews** static stack (`wormnews/terraform`,
`wormnews/frontend/deploy.sh`) — S3 + CloudFront, distribution `E3TPXLU978JUQH`,
bucket `wormnews-frontend-…`, AWS profile `terraform-user`, region `us-west-1`.
Two small, load-bearing changes:

### 1. Extend the CloudFront viewer-request function

`wormnews/terraform/cloudfront.tf` already has a viewer-request function
`aws_cloudfront_function.url_rewrite` (lines 84–100) that does pretty-URL
rewriting. **Current code:**

```javascript
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (!uri.includes('.')) {
    request.uri += '/index.html';
  }
  return request;
}
```

This must be **extended** (not replaced wholesale — the SPA still needs its
`index.html` fallback) to do Accept→ext for extensionless paths, mirroring
`negotiate.ts`: default `index.md`; `text/turtle → index.ttl`;
`application/ld+json → index.jsonld`; `text/html → index.html`. Explicit `.ext`
must still win (i.e. only negotiate when the path has no extension). The Accept
header has to be forwarded to the function (it is on viewer-request) — but note
the existing `default_cache_behavior` does **not** vary the cache key on Accept,
which is fine *because the function rewrites to a concrete object path before the
cache lookup*, so each face caches as its own key. (`Vary: Accept` is still worth
emitting for crawlers — add it to the `response_headers_policy.security` block,
one place, all objects.)

> Sharp edge: the SPA `custom_error_response` entries (403/404 → `/index.html`,
> lines 142–153) interact with this. A missing negotiated object would currently
> fall through to the SPA HTML. Decide explicitly whether catalog 404s should
> 404 or fall to the SPA before applying.

### 2. Sync the static faces to S3

The four-face layout is already produced by `build-static.ts`. Upload it the way
`deploy.sh` already uploads (it currently `aws s3 sync`s `dist/` and invalidates
`/*`, lines 30–45) — but with **per-extension `--content-type`** so S3 serves the
right type for the `.md` / `.ttl` / `.jsonld` objects (the existing sync only
special-cases `*.html` and `*.json` caching, and would mislabel `.ttl`/`.md`/
`.jsonld` as `application/octet-stream`). Then invalidate (the existing script
already does `/*`).

### Pre-apply gate checklist

1. Show the CloudFront function **diff** (the extended Accept→ext handler).
2. Show the `response_headers_policy` diff (the added `Vary: Accept`).
3. Confirm the Accept→ext logic byte-matches `negotiate.ts` (the tested rule).
4. Confirm the S3 sync sets correct `--content-type` per extension.
5. Decide the catalog-404 vs SPA-fallback behavior.
6. Then, and only then: `terraform apply` + sync + invalidate, with go-ahead.

Reversibility: the function change is revertable by re-applying the old code; the
S3 objects are additive static files that don't touch the existing SPA. Low blast
radius — but it edits a function that runs on **every** request to wormnews.net,
which is why the pause is non-negotiable.
