# Atelier Feed Lab

A deliberately disposable, standalone proof of concept for the VTuber video-feed
idea. The real VRM is rendered headlessly into a private deterministic source
plate, which a server-only endpoint sends to `gpt-image-2` alongside local prop
and scenery references. GPT Image produces four continuity anchors from one
camera plan; three exact first/last-frame Seedance 2.0 Fast jobs bridge those
anchors in parallel and the browser splices the resulting twelve-second story
into the local video feed. The source plate never enters the feed. There is no
Garden, Choreograph, or durable storage.

```bash
pnpm --dir apps/atelier-feed-lab dev
```

Open <http://localhost:5184>.

The OpenAI and OpenRouter credentials are read server-side from macOS Keychain.
To add the latter without writing it into the repository:

```bash
security add-generic-password -U -a vera -s 'OpenRouter API Key' -w '<key>'
```

## What is real

- A local visual catalog with stable character, prop, and scene IDs.
- A deterministic hidden source plate rendered from the real VRM fixture.
- A real `gpt-image-2` reference-edit call, authenticated from macOS Keychain.
- A local generated-output cache so the latest four-anchor storyboard survives
  Vite reloads.
- A real `gpt-image-2` storyboard pass with an explicit shot grammar: thirds,
  depth planes, a preserved axis, settled narrative beats, and one slow
  forward-left camera path.
- Three real asynchronous OpenRouter video jobs using
  `bytedance/seedance-2.0-fast`, each constrained by exact first and last frames,
  at 480p for four silent seconds.
- Server-side job polling, cost/latency capture, immediate MP4 download, byte-range
  serving, and restoration of the latest complete story after a reload.
- A shot request assembled from those references plus natural-language direction.
- A storyboard → parallel motion → ordered decode pipeline with explicit timing
  boundaries and a replay control.
- Double-buffered HTML video playout: idle video remains visible while a shot is
  prepared, then each arriving bridge is preloaded into the standby deck and
  spliced into the feed without showing the private source.
- Seamless generated-bridge handoffs and automatic return to an alternate idle
  loop after the story.

## The frontend is a Shrubbery surface

The UI is laid out and rendered by Shrubbery's own machinery — no hand-rolled
shell. The workspace shape (masthead / broadcast|director split / pipeline
band) lives in `src/layout/feed-lab.ux.nt`, a fossil-v1 N-Triples document in
the `sux:` vocabulary, authored in `src/layout/feed-lab-config.ts` and emitted
by `pnpm emit:layout`. Boot reads it through a real static `TripleSource`
(`staticNtSource`, the no-backend path PLANTER proved), decodes it with
`parseTriplesToConfig`, and hands it to `renderWorkspace` from
`@shrubbery/runtime`. The three app-owned leaves (`src/leaves/afl-broadcast`,
`afl-director`, `afl-pipeline`) are registered through the render gate and
upgrade in place; they compose `@shrubbery/components` primitives over the
`@shrubbery/tokens` vocabulary (default skin: `observatory`, the night-room
instrument identity — the masthead toggles skins and themes). The pipeline
orchestration itself is `src/director.ts`, semantically identical to the
original single-file app: same API calls, same synchronous story-order claim,
same failure behavior, same dual-deck playout contract.

## The catalog is a reference web

Catalog-as-data joins layout-as-data. The visual catalog is no longer two
hardcoded option rows: it is a web of reference entities — seven kinds
(character, wardrobe, prop, scene, atmosphere, technique, anchor) with
relations (`wears`, `holds`, `contains`, `variant-of`, `pairs-with`,
`embedded-in`), per-entity composition notes and preserve-list invariants —
authored in `src/catalog/reference-web-config.ts`, emitted by `pnpm emit:web`
into `src/catalog/reference-web.nt` (a fossil-v1 N-Triples document, the
authority) plus `src/catalog/reference-web.json` (the server's projection,
derived from re-parsing the fossil itself). The browser boots the web through
the same static `TripleSource` path as the layout. Entities whose reference
studies don't exist yet are **pending**: visible in the composer, honest about
needing a study, never selectable for spend.

The director rail carries a **pack composer** (section 04): browse by kind,
see relations, assemble an ordered role-labeled pack (identity > wardrobe >
prop > scene > atmosphere as prompt language), or take the `cactus story` /
`moon story` presets — which follow the web's own `pairs-with` wires. The
server validates packs against the web, compiles the labeled `Image k`
sections from entity language, and serves **`dry_run` composition**: the fully
composed call — every reference in order with its role, the complete prompt,
the input hash — with no provider call and no cost. Review-before-spend is
structural: an assembled pack cannot direct a story until its exact call has
been composed and read, and any edit reopens review. Requests without a `pack`
take the legacy three-reference path, byte-identical to before the web.

## What remains intentionally lightweight

- Idle coverage remains a small shelf of locally generated fixture MP4s.
- Jobs are kept in memory while active; the latest completed storyboard and its
  three cached clips survive a dev-server restart.
- OpenRouter receives the artistic anchors as inline data URLs. If an upstream
  provider stops accepting inline frame images, the prototype will need a
  short-lived signed asset URL.
- There is no speculative story queue, cancellation policy, or long-running
  scheduler yet.

The source plate is never under `public/`, never imported by browser code, and
never displayed by the page. Run `pnpm prepare:references` whenever the fixture
or deterministic render settings change. The catalog IDs and shot lineage can
later point at Meaningful Objects without changing the image or playout model.
