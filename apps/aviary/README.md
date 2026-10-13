# AVIARY

A player for the **aigua** field-recording sample library — 7 bird-call voices,
their one-shot samples with the measurements the analysis pipeline actually
produced, the noise beds, the rendered pieces, the source recording, and the
analysis figures.

The point of the app is not that it plays audio. It is **what a player looks
like when it is built the Shrubbery way**: a graph, an interpreter, and a
component library, with the backend behind the seam.

## Run it

```bash
pnpm -C apps/aviary dev      # → http://localhost:5187/
```

That is the whole setup. No cell to spawn, no seed to write, no build step.
The library is read **in place** from `../../../mus/aigua` (a sibling checkout);
point somewhere else with `AIGUA_DIR=/path/to/aigua pnpm -C apps/aviary dev`.
Nothing is ever copied into this repo and nothing under `mus/` is written.

## What is actually happening

```
instrument.json + the aigua directory       (real files, read server-side)
     │  src/library/project.ts   — the MINT stage
     ▼
`aig:` triples ─────────────┐       `sux:` triples  (serializeConfigToTriples)
     │                      │              │  src/library/ux-config.ts
     │  GET /graph/library.nt        GET /graph/ux-config.nt
     ▼                      ▼              ▼
src/cell/nt-http-source.ts — a REAL TripleSource ('nt-http', liveness 'poll')
     │                                     │
 parseLibrary (this app's codec)   parseTriplesToConfig (nucleus's codec)
     │                                     │
     │                                planFor → LayoutPlan
     │                                     ▼
     └────────► props ────────►    renderWorkspace  → Lit DOM
```

Concretely:

- **The layout is RDF.** `src/library/ux-config.ts` is an *authoring* form only.
  The shell serializes it with nucleus's own `serializeConfigToTriples`, serves
  it as N-Triples, and the browser reads it back through `parseTriplesToConfig`
  → `renderWorkspace` → `planFor`. The `<header data-region="region-top-bar">`,
  the `.rail-pane`, the `.split-pane`, the `<footer>` — all of it is the
  interpreter's output, not markup in `index.html`.
- **The library is RDF too**, in its own `aig:` vocabulary
  (`src/library/vocab.ts`) in its own named graph. Same read seam, same `Triple`
  model, different ontology — `sux:` says how a workspace is laid out, `aig:`
  says what a sample library is.
- **The appearance controls come out of the graph.** The skin and theme lists
  the app bar offers are the `sux:ConfigDimension` values carried by the layout
  graph, each with its `appliesAttribute` taken verbatim from
  `@shrubbery/tokens`. Adding a skin is a triple.
- **The backend is shell-side.** `src/shell/aigua-plugin.ts` is the only thing
  that touches a filesystem, and `src/shell/audio-player.ts` owns the only
  `HTMLAudioElement`. The library packages see neither.
- **Three app-owned elements** (`av-rail`, `av-stage`, `av-transport`), vetted
  through `registerRenderableComponentTags`. Everything else is a real
  `@shrubbery/components` primitive: `mn-app-bar` is the chrome, `mn-card
  interactive` is a playable sample row (it brings `role="button"`, `tabindex`,
  and Enter/Space with it), `mn-chip` is a measurement, `mn-badge` is a count,
  `mn-panel-header` is a rail group, `mn-empty-state` is every absence.

## The three routes the shell serves

| Route | What |
|---|---|
| `GET /graph/library.nt` | the `aig:` projection, regenerated per request |
| `GET /graph/ux-config.nt` | the `sux:` projection of this app's layout |
| `GET /media/<relpath>` | the real `.wav` / `.png` bytes, with HTTP Range |

`render/` is **enumerated, never hardcoded** — a new piece dropped in there
appears within one poll interval (8 s), which is why the adapter honestly
declares `liveness: 'poll'` rather than pretending to be a fossil.

## No mocks, no silent fallbacks

There is no built-in library and no default layout. If the read seam fails, the
transport strip prints the `TripleSourceError` verbatim, the rail renders an
`mn-empty-state`, and the stage stays inert and labeled. A sample whose file is
missing from disk projects no media and renders as an unplayable row that says
so. Every measurement the pipeline did not produce renders as an em dash, never
a zero.

## Tests

```bash
pnpm -C apps/aviary test          # everything
pnpm -C apps/aviary test:browser  # just the real-Chromium suite
```

- `tests/library-projection.test.ts` — mint → wire → parse against the REAL
  aigua directory, cross-checked field by field against `instrument.json`.
- `tests/read-seam.test.ts` — the REAL middleware behind a REAL loopback HTTP
  server, read by the REAL adapter, and put through the repo's own
  **`@shrubbery/source/conformance`** acceptance kit. Also asserts that the
  served `sux:` graph parses and that `planFor` produces the expected spine.
- `tests/aviary-plays.browser.test.ts` — real Chromium over the real dev server:
  the interpreter frame renders, the app-owned tags upgrade, a click on a sample
  row attaches a real `/media/...` src, Chromium serves it 200/206, the element
  decodes it and `currentTime` advances, ArrowDown+Enter plays the next row, the
  figures decode, and the theme toggle and the skin picker repaint the shell.

## Known limits

- **Dev-server only.** The backend is Vite middleware, so `vite build` +
  `vite preview` produces a shell with no `/graph` and no `/media` — the same
  limitation `apps/rhizome`'s traces middleware documents. Serving a built
  AVIARY would need the middleware behind a standalone Node process.
- **`dom` face only.** The layout graph would render through
  `@shrubbery/render`'s hypertext/turtle/JSON-LD faces as-is, but the `aig:`
  library graph has no face registered, so there is no curl-able library view
  yet. The graph is already served as N-Triples at `/graph/library.nt`, which is
  the honest half of that story.
