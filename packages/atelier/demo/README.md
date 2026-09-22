# mn-vtuber demo

A standalone Vite page that puppets `<mn-vtuber>` (this package) live and shows
the nucleus VTuber-control-RDF round-trip (`serializeVtuberControlChannelsToTriples`
↔ `parseVtuberControlOverlay`) — the sliders write N-Triples, the N-Triples drive
the avatar. It is **not** in the pnpm workspace; run it directly:

```bash
pnpm dlx vite --config packages/atelier/demo/vite.config.ts   # then open the printed URL and set a .vrm Model URL
```
