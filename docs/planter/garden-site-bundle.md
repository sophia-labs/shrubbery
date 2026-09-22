# Garden as a Planter site bundle

`@shrubbery/site/garden` is the reusable Garden product description consumed by
the generic Planter host. It is not another shell. The bundle points at the
canonical `GARDEN_DEFAULT` object and generated seed, while Planter continues to
read the live `:ux:config` graph through `TripleSource` and render it through the
shared nucleus/runtime/component packages.

## Bundle structure

The bundle declares, as data:

- the canonical layout object and generated-seed SHA;
- the exact `@shrubbery/planter` interpreter version;
- Home and Workspace surfaces, with `/`, `/home`, and `/workspace` routes;
- the Markdown, Turtle, JSON-LD, and HTML face set;
- Garden/Sophia/98/Glass skins, light/dark themes, and the
  continuous/paper/classic-word editor-material axis;
- left/right panel min/default/max widths, Shoelace snap strings, and threshold;
- every component tag named by the layout, its npm package, persistence class,
  and whether Planter's read-only host can bind it live;
- a feature ledger that distinguishes supported read/host behavior from later
  write and native-service contracts.

`siteProjectionTriples()` deterministically renders the same declaration into
the registered `shrubbery-site` vocabulary using
`{graph_subject}:projection:site:*` subjects and references to the exact layout
nodes the Nucleus serializer emits. Garden's Emporium pack is the sole writer
of the reserved projection. `sitePublicationRouteTriples()` separately builds
host-owned name/path bindings to exact owner+graph tuples and refuses public
state without human approval testimony.

The existing Organism port consumes the bundle's appearance choices and panel
posture. This makes the bundle a source of product defaults shared by the rich
application and Planter rather than a copied demo configuration.

## Running it

The committed browser config selects the bundle for local development:

```sh
pnpm -C apps/planter dev
```

An explicit local boot uses the ordinary source bootstrap plus the bundle id:

```text
/workspace?endpoint=/cell&graph=my-graph&adapter=gardend-local&authMode=none&bundle=garden
```

For the Node/conneg server:

```sh
PLANTER_ENDPOINT=http://127.0.0.1:7090 \
PLANTER_GRAPH=my-graph \
PLANTER_ADAPTER=gardend-local \
PLANTER_AUTH_MODE=dev \
PLANTER_AUTH_TOKEN=... \
PLANTER_BUNDLE=garden \
pnpm -C apps/planter serve
```

For a hosted boot, `owner`/`PLANTER_OWNER` is mandatory alongside graph; Planter
refuses the legacy ownerless route. The bundle never contains a credential.
Runtime source testimony is rendered only after the caller supplies a redacted,
absolute endpoint IRI.

## What works in this slice

- live/fossil/gateway/SPARQL layout reads through `TripleSource`;
- poll-driven rerender with capture-age testimony;
- Garden structural workspace and honest empty/error states;
- the richer shared chrome components and Garden Home presentation;
- the four-way visual-identity cycle, dark mode, and editor-material tokens;
- controlled panel widths, collapse/expand, and discrete snap attributes;
- all declared routes through the SPA and all four faces through the server.

The real-browser proof runs a real gardend, Vite, and Chromium; exercises
Workspace, snap posture, Garden → Sophia → 98 → Glass, dark mode, the honest
Settings deferral, Home navigation, a real SPARQL mutation observed by polling,
and the killed-cell error path:

```sh
pnpm --filter @shrubbery/planter test:browser:garden
```

## Explicitly deferred

The generic Planter boundary does not yet own document/CRDT services, daily-note
creation, editor/chat/wire service bindings, operational Settings, local-AI or
keychain operations, the deployed render pool/gateway route, or static
route×face publication. Those capabilities are named in
`GARDEN_SITE_BUNDLE.features`; unsupported controls surface a deferred
capability notice rather than pretending to work.
