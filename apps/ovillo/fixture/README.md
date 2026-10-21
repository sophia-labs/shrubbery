# The Ovillo app's fixture

**This is a fixture.** It stands in for the `ovillo` graph (built by the graph
builder in the ovillo repo, `site/graph/`) so the app, its tests and its stories
run without it. The playlist's `rdfs:comment` says FIXTURE, and the app's footer
and its about card say so whenever it is what they read.

Nothing in it is invented. Three pieces from the Ariadne renders of 2026-10-20,
written to the `ovl:` contract (hub `plans/2026-10-20-ovillo-sophia-app.md`) in
the same shapes the graph builder writes:

| piece | why it is here |
|---|---|
| Hilo de luz | one steel-string World, a score, a receipt, an energy trace |
| Gigante y juguete | two Worlds: two ledgers, an energy trace summed over both |
| Agua mansa | the bench: a bench run (pattern, pickup, patch, closure residual), no ledger, no trace |

- `ovillo.nt`: the `user:rdf` triples (157), built by `build_fixture.py` from the
  r4 site build's piece list, its gain-matched mp3s and trimmed receipts, the
  renders' wav files (peaks) and energy traces, the bench's render log and patch.
- `ux-config.nt`: the `:ux:config` graph, the app's own built-in layouts
  (`pnpm --filter @shrubbery/ovillo fixture:ux` writes it; `tests/layout.test.ts`
  keeps it identical to them).
- `site/media/<slug>.{mp3,peaks.json,energy.json}`, `site/scores/`, `site/receipts/`:
  the files the triples name. The mp3s are the bytes the r4 static site serves.

Rebuild (the inputs were in a session scratchpad; the outputs are what is committed):

```sh
uv run --no-project --with numpy --with soundfile python -I apps/ovillo/fixture/build_fixture.py \
  <pieces.json> <r4 site>/sounds <bench log> <ovillo repo>/site/patches apps/ovillo/fixture
```
