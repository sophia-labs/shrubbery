# Ovillo

Pieces played by Ariadne Worlds, as a Sophia app. **Ovillo shows Ariadne only:
every sound comes out of an Ariadne World**, and the app plays nothing the graph
does not name as a render.

The heart is the gallery: playlists and a player in the spirit of Winamp and the
Milkdrop-era visualizers, drawn calmly in Sophia's language (`mn-audio-player`):
a numbered playlist with durations, a clock that flips to remaining time, a
waveform scrubber, a live spectrum and scope from the sound, and the visualizer
only Ariadne has, **the World's stored energy by body** (strings, box, room)
played in sync with the audio, the touches as marks and a light per string. Each
piece has a page: the player, its energy traces at full size, the World's ledger
(`mn-energy-ledger`), the instrument, the receipt, the score (read-only for now).

## Run it

```sh
pnpm --filter @shrubbery/ovillo dev                                   # http://localhost:5191/ (the fixture)
OVILLO_OUT=<ovillo repo>/site/graph/out pnpm --filter @shrubbery/ovillo dev   # the graph builder's graph
OVILLO_OUT=… OVILLO_GARDEND=http://127.0.0.1:7792 pnpm --filter @shrubbery/ovillo dev
#   then open http://localhost:5191/?source=gardend   (the graph read over SPARQL, as a visitor)
```

The built page, under the deployment's CSP (own-origin scripts only, no inline
script, `'wasm-unsafe-eval'`, `blob:` workers, inline styles):

```sh
pnpm --filter @shrubbery/ovillo build
pnpm --filter @shrubbery/ovillo serve -- --port 4180 [--gardend http://127.0.0.1:7792]
node apps/ovillo/scripts/browser-check.mjs 'http://127.0.0.1:4180/' <out-dir>   # muted headless Chrome over CDP
```

The engines are WebAssembly built in the ovillo repo and **never vendored here**: name the files and the
dev server serves them at `/wasm/`, and the build copies them into `dist/wasm/`:

```sh
OVILLO_MUS_WASM=<ovillo>/mus-rs/…/mus_wasm.wasm      # bash mus-rs/crates/mus-wasm/build.sh
OVILLO_BENCH_WASM=<ovillo>/site/bench/ovillo_web.wasm  # bash site/bench/build.sh
OVILLO_TRACT_WASM=<ovillo>/site/tract/tract.wasm
```

## Where the graph comes from

```
the `ovillo` graph (user:rdf) + its :ux:config
   │  'nt'      graph/ovillo.nt + graph/ux-config.nt beside the page   (src/nt-http-source.ts)
   │  'gardend' a public-mode gardend's /mcp, sparql_query, paged SELECTs (@shrubbery/source/gardend)
   ▼
graph-read.ts (read, or ORDER BY … LIMIT 1000 OFFSET n)  →  model.ts (the ovl: codec)
   ▼                                                         layout.ts (one LayoutDocument per route)
ovillo-app: mn-top-bar · ovillo-surface (LayoutInterpreter faces, faces.ts) · the testimony strip
```

`?source=nt|gardend` chooses (the build's default is `VITE_OVILLO_SOURCE`, else
`nt`); `?nt=`, `?ux=`, `?mcp=`, `?media=` move the files, the endpoint and the
media base. A visitor of a public gardend may not `rdf_dump`, so the app SELECTs.
The graph's canonical URLs (`https://ovillo.sophia-labs.com/media/…`) are fetched
from the page's own origin (`src/media.ts`), so they are same-origin and the Web
Audio tap hears them.

The layouts live in the graph's `:ux:config` as `ux:layoutJson` (the Koch
pattern); a route the graph has no layout for uses the app's built-in one and the
footer says `layout built-in`. To put the layouts in the graph:
`pnpm --filter @shrubbery/ovillo fixture:ux -- --stdout` prints the triples.

## Routes and mount points

| route | what |
|---|---|
| `#/` | the gallery: playlists, the player, the piece playing, about |
| `#/piece/<slug>` | the piece page |
| `#/bench` | **mount point** for `mn-ovillo-bench` (drawn when the tag is registered) |
| `#/tract` | **mount point** for `mn-ovillo-tract` |
| `#/score/<slug>` | the score editor: Hoja's MUS mode (`mountMusWorkbench`) on a MUS piece's score, checked as you type, rendered by its Ariadne World in a Worker (about a minute for a 30 s piece, with progress; "the first 2 bars" in seconds), the take in `mn-audio-player` with its energy and the receipt's ledger. Bench (JSON) scores stay read-only |

The shell owns one audio engine (`createAudioPlayer`, with the Web Audio tap) and
hands it to every player on the page, so playback carries across pages.

## The mark

An egg made out of one string ("ovillo" is a ball of thread, from the Latin for a
little egg): one continuous thread once around an egg, three windings across it,
and the loose end trailing out along the ground, like Ariadne's thread. It is one
path in `packages/components/src/ovillo-mark.ts` (the icon `ovillo`, the suite's
Ovillo entry, on the carmine tile `--mn-app-tile-ovillo`), drawn by
`scripts/ovillo-mark.py`. The same thread, as files for the static site and the TV app:

| file | what |
|---|---|
| `public/ovillo-mark.svg` | the thread alone, `currentColor` when inlined; carmine-700, carmine-300 in the dark |
| `public/favicon.svg` | the tile: the carmine diagonal, the thread in white |
| `public/tv-banner.png` | 320 × 180, the tile, the mark and "Ovillo" in Literata (`node scripts/render-banner.mjs`) |

`tests/mark.test.ts` keeps the files' path identical to the icon's.

## Tests

```sh
pnpm --filter @shrubbery/ovillo test                 # fixture; the gardend suite runs if one answers on :7792
OVILLO_OUT=<…/site/graph/out> pnpm --filter @shrubbery/ovillo test   # also the real graph
```

- `model.test.ts`: the codec on the fixture, field by field against its files; on the real graph with `OVILLO_OUT`.
- `layout.test.ts`: the layouts validate, the fixture's `:ux:config` is exactly them, routes round-trip.
- `read-seam.test.ts`: the nt-http adapter behind the real middleware through `@shrubbery/source/conformance`;
  the SELECT path against oxigraph; a real public-mode gardend as a visitor.
- `app.test.ts`: the whole shell in happy-dom over a real loopback server.

The fixture (`fixture/`, see its README) is three real Ariadne pieces, clearly a fixture.
