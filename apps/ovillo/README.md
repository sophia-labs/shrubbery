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

## The deployable bundle

One directory that is a public-mode gardend's `siteDir` for the graph `ovillo`: the built app (reading the graph from
the same origin's `/mcp`), the graph builder's `media/`, `scores/`, `receipts/`, `llms.txt` and `index.md` (gardend
serves the markdown twin to an `Accept` that is not HTML), the graph as N-Triples in `graph/`, and the engines in
`wasm/`. The page carries the deploy CSP as a meta tag (own-origin scripts, `'wasm-unsafe-eval'`, `blob:` workers,
inline styles); `MANIFEST.sha256` and `bundle.json` say what went in.

```sh
OVILLO_OUT=<ovillo>/site/graph/out OVILLO_MUS_WASM=… OVILLO_BENCH_WASM=… OVILLO_TRACT_WASM=… \
  pnpm --filter @shrubbery/ovillo bundle -- --out <dir>
# then public.json: {"graphs": ["ovillo"], "siteDir": "<dir>"}, and the graph loaded (user:rdf and :ux:config)
```

gardend's site serving answers a Range request with the whole file, so the media is not seekable when gardend
serves it: put `/media/` behind the front proxy's file server (or give gardend Range) when this is deployed.

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
| `#/piece/<slug>` | the piece page. A piece whose score is a note list (`ovillo-notes-tsv`: the trombone v1, played by a Rust example, not `mus render`) shows the list as a table with the render's measurement beside it (`ovl:analysis`), its receipt's own figures, the World's stored energy at both ends, and says what its receipt does not state |
| `#/bench` | `mn-ovillo-bench` (Class C, loaded on demand): the live bench, ovillo-web in an AudioWorklet via `addWasmWorklet`, in Sophia's controls: the strings to pluck (Z–N), the guitarist's patterns, pickup, tempo, master, the configuration map (string body → B♭ bore), knobs, the World's energy, the spectrum, DSP load and the live closure residual, and the graph's bench scores. Quiet until a gesture |
| `#/tract` | `mn-ovillo-tract` (Class C, three.js, loaded on demand): the vocal tract as a true `mus_ariadne` World (ovillo `main` 80c4325), its program ported line for line into the element (`tract-engine.js`) and its worklet verbatim: the organ, the cross-section, the orbs, consonants and touch constrictions, presets, the books and the DSP load, its about text; Sophia's controls around it. `?lite=1` light mode, `?tv=1` TV mode with `window.ovilloTV(key)`, `?mute=1` a hard lock. Quiet until START |
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
- `trombone.test.ts` (with `OVILLO_OUT` naming a graph that has `trombone-solo`): a piece whose score is a note list
  (`ovillo-notes-tsv`, a World a Rust example plays): the codec, the note list against its file and its measurement, and
  the piece page in the shell. `OVILLO_CHECK_PIECE=trombone-solo node scripts/browser-check.mjs …` walks the same page
  in Chrome and plays it, muted.

The fixture (`fixture/`, see its README) is three real Ariadne pieces, clearly a fixture.
