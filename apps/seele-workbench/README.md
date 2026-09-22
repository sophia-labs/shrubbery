# `@shrubbery/seele-workbench` — the vessel

A special Vite shrubbery app over a **local** `gardend` cell. Ratification
delta D17 (2026-08-03): local-first, with proper Tauri packaging as the
eventual path — **not** hosted, **not** wasm. Canary drops out of the
near-term sequencing entirely.

## What it is

Two leaves, side by side, over one document:

```
root  = split(axis: 'horizontal', startBasisPoints: 5800)   // left | right
  start = leaf{ faceId: 'hoja.document',  resource: {kind:'document', graphId, documentId} }
  end   = leaf{ faceId: 'seele.context',  resource: {kind:'document', graphId, documentId},
                params: { contractName: 'seele-core' } }
```

`horizontal` means start/end laid **left-to-right** — the axis naming is by
layout flow, not by divider direction, and Rev 1 of the suite had it inverted.
The geometry is asserted twice: once against the real solver
(`tests/seele-workbench-document.test.ts`) and once against real pixels in real
Chromium (`scripts/seele-workbench-gardend-browser.mts`).

The chrome carries a **reserved chat dock** — a labelled, empty, collapsed
strip where chat will eventually live. Zero machinery, by instruction.

## The loop

```
<sh-editor-host>            W14.1  getDocumentJSON / onDocumentContentChanged
  → projectSeeleSource      W14.2  exactly one `seele` fence; loud on 0 and on ≥2
  → POST /seele/compile     W7     a real `nature` binary, report relayed verbatim
  → workbench controller    W14    debounced, newest-wins, stale reports discarded
  → seele.context face      W8.1   diagnostics list + the five-state wax seal
```

## Running it

```sh
# 1. a local cell (any app's gardend:dev writes the manifest; point ours at it)
GARDEND_LOOPBACK_MANIFEST=../organism/.gardend-loopback.json pnpm dev

# 2. or the whole thing, end to end, against a cell this script spawns itself
pnpm test:browser
```

`NATURE_BIN` overrides the compiler path (default:
`/Users/vera/dev/sophia/nature/target/debug/nature`).

## What v1 deliberately does not do

Cards (W8.2), completions (W8.3), cursor coupling (W8.4), the declared-object
picker (W8.5), persistence acknowledgment (D18 chose *none* — the hosted path
has none to acknowledge), and the apply port (W9.4/W14.8). Each is a named
workstream. The chip has five states and no sixth; there is no durability glyph
and no warning tier, and `drift-state.ts` makes adding one a build error rather
than a quiet lie.
