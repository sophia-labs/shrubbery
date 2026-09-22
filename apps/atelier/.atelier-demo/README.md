# Atelier — honest demo

A small cell-backed demo of the Atelier avatar workstream (design:
`atelier-avatar-suite-design-20260706` in the `sophia-code-lab` graph). Every panel
is a shipped achievement — nothing staged, nothing borrowed.

## What it shows

- **the puppet** — our committed `seed-san.vrm` fixture rendered by the carved
  `@shrubbery/atelier-vtuber` (`mn-vtuber`). The status line is the component's real
  detail (`status: ready`, mesh counts) — the true VRM, never the fallback rig.
  (The robot arm + backpack are part of Seed-san itself — VRM consortium sample,
  author VirtualCast, Inc. — not anything the demo adds.)
- **set_appearance** — the exact six fields the S2 verb governs (four tints,
  skinWarmth, expression). Every control drives the **real `set_vtuber_appearance`
  verb** (`growVtuberAppearance → sparql_update`), not client-side state.
- **:ux:control** — the running cell's **own N-Triples**, read back by `rdf_dump`
  after each write. Drag a control, watch the graph change. No cell → the honest
  live-read error, never a fallback.
- **license testimony** — the fixture's VRM meta extracted by `glb-inspect`
  (credit, permissions, license URL). The demo *displays the required credit* —
  practicing the license-as-testimony principle, not just describing it.
- **the mirror** — S3 (`render_portrait`) made visible. "render mirror" POSTs
  `/mirror` (a vite-plugin route, server-side only — `renderPortrait` spawns
  playwright+vite and can't run in this tab); that handler reflects the cell's
  current `:ux:control` appearance, renders it with the REAL headless mirror,
  archives the PNG as a real artifact on the cell (`PUT /navigation/.../
  artifacts/{id}` — see `packages/atelier/src/mirror-artifact.ts`'s module doc
  for why not the MCP `upload_artifact` tool), and shows the result with its
  artifact id + sha256. **"The mirror is an artifact."**

Switch the fixture dropdown to `avatar-sample-a.vrm` to load a **VRM 0.x** model and
watch the inspector re-read the older `*UssageName` meta.

## Run it

Two terminals, from `apps/atelier`:

```bash
pnpm gardend:dev     # terminal 1 — spawns + seeds a real gardend cell, writes .gardend-loopback.json
pnpm atelier-demo    # terminal 2 — vite on http://localhost:5178/.atelier-demo/
```

The demo's vite config reads `.gardend-loopback.json` server-side and proxies
same-origin `/cell/*` to the cell (port + token never reach browser JS), exactly
like the parent app. Stop the cell with Ctrl-C in terminal 1 (removes the temp
profile). `seed.mts` is a standalone Node helper that seeds/reads the channel via
the shipped serializer — handy for verifying the round-trip outside the browser.

## Known wart

On reload the control inputs reset to their HTML defaults while the cell persists
the last-written values, so a control and the graph can momentarily disagree until
touched. Left as-is deliberately (the cell's persistence is honest); initializing
the controls from the cell on load is a small future polish.

> This is a peek/dev harness, not a product surface. The committed product artifacts
> are the packages, the verb, the mirror, and their tests. The showroom microsite
> (design §5 / S6) is the from-scratch rebuild of this app, later.
