# Sophia for KOReader

A native e-ink Sophia application built as a Shrubbery artifact target plus a
KOReader plugin. KOReader is the reading kernel; Sophia supplies the home,
library rhythm, live Garden projection and manuscript design.

```text
Garden document envelopes + canonical TipTap XML
        ↓
ReaderDocument / ReaderLibrary
        ↓
@shrubbery/koreader
        ↓
manifest.json + semantic XHTML + JSON sidecars
        + workspaces.json + Garden navigation tree
        ↓
Sophia KOReader plugin
        ↓
KOReader document engine
```

Garden remains the document and CRDT authority. Shrubbery owns the deterministic
projection into a reader artifact. The Lua plugin owns synchronization and the
offline cache. KOReader owns pagination, typography, dictionaries, bookmarks,
highlights and reading position.

## Why this is not a fifth content-negotiated face

`@shrubbery/render`'s existing targets each render one resource to one HTTP body.
KOReader requires a manifest, a library index, multiple documents, semantic
sidecars and a stateful native host. `@shrubbery/koreader` is therefore a
**packaged output target**, parallel in spirit to the DOM runtime, rather than a
new MIME type in the existing `RenderTarget` union.

## Build the fixture

```sh
pnpm --filter @shrubbery/sophia-koreader build
```

The output is `apps/sophia-koreader/dist/`:

```text
dist/
  INSTALL.txt
  feed/
    manifest.json
    workspaces.json
    index.xhtml
    documents/*.xhtml
    models/*.json
    workspaces/*/{manifest.json,index.xhtml,documents/*,models/*}
  sophia.koplugin/
    _meta.lua
    main.lua
    sophia_home.lua
    sophia_browse.lua
    sophia_nav.lua
    sophia_client.lua
    sophia_store.lua
    resources/sophia-sprout.svg
```

## Build from a live local Gardend

For the desktop/headless loopback, pass its manifest rather than copying its
per-run bearer token onto the command line. The manifest uses Garden's
camelCase `apiUrl` and `token` fields and is re-read on every build:

```sh
GARDEN_MANIFEST="$HOME/Library/Application Support/dev.sophia.garden/profiles/default/loopback.json"
pnpm --filter @shrubbery/sophia-koreader build -- \
  --garden-manifest "$GARDEN_MANIFEST" \
  --graph organism-dev \
  --garden-document-source tiptap-xml \
  --garden-all-workspaces \
  --title "Vera's Garden" \
  --out /tmp/sophia-koreader
```

`tiptap-xml` keeps the document envelope as the metadata authority, then reads
Garden's canonical `/export?format=xml` fragment for each document. The
converter preserves block IDs, headings, list levels, task state, quotes,
code, rules and inline marks. XML fragments are parsed beneath an inert root;
malformed XML, doctypes, processing instructions and oversized inputs are
refused.

Garden's `/navigation/{graph_id}` response supplies folders and document
parentage. `--garden-all-workspaces` also reads `/graphs/catalog` and packages
each readable, non-empty graph beneath the feed root. The generated
`workspaces.json` lets KOReader switch Garden workspaces without exposing the
device filesystem. Omit the flag for a single-workspace artifact.

For a presentation shelf, `--garden-minimum-characters 200` can omit empty or
diagram-only records without changing the source graph. Use
`--garden-document-source hosted-blocks` when targeting a Garden deployment
that does not yet expose canonical XML export.

The process refuses a missing/stale endpoint when it performs the first
document read. It does not log or persist the loopback token.

The live integration test exercises the same hosted projection and renders the
complete multi-file artifact in memory:

```sh
GARDEN_LOOPBACK_MANIFEST="$GARDEN_MANIFEST" \
GARDEN_GRAPH_ID=organism-dev \
GARDEN_DOCUMENT_SOURCE=tiptap-xml \
  pnpm --filter @shrubbery/sophia-koreader test:live:garden
```

## Build from a gateway graph root

The base URL must be the root that serves Garden's existing hosted-shaped
`/documents/{graph_id}` and `/documents/{graph_id}/{document_id}` routes. For a
platform gateway, that will normally be the graph-scoped `/g/{graph_id}/` root.

```sh
pnpm --filter @shrubbery/sophia-koreader build -- \
  --garden-base https://gateway.example/g/my-graph/ \
  --graph my-graph \
  --token-file "$VIEWER_TOKEN_FILE" \
  --title "Vera's Garden" \
  --out /tmp/sophia-koreader
```

The token file is optional for unauthenticated development endpoints. Secret
contents never enter process arguments or generated feed files.

A pre-normalized `ReaderLibrary` JSON file can also be supplied:

```sh
pnpm --filter @shrubbery/sophia-koreader build -- \
  --input ./reader-library.json \
  --out /tmp/sophia-koreader
```

## Serve the generated feed

```sh
SOPHIA_KOREADER_FEED_DIR=/tmp/sophia-koreader/feed \
HOST=0.0.0.0 PORT=8787 \
  pnpm --filter @shrubbery/sophia-koreader serve
```

The server is deliberately small: GET/HEAD only, traversal-safe paths,
content types, ETags and revalidation. A production deployment can publish the
same static artifact through an ordinary object store or reverse proxy.

## See it in the KOReader emulator

The browser-visible harness pins KOReader's official Linux x86_64 `v2026.07`
release and verifies its SHA-256 before unpacking it. It runs KOReader's SDL
emulator in Docker behind a loopback-only noVNC page, mounts the Sophia plugin,
opens the native Sophia home after startup, and keeps KOReader state outside the
container so cache, resume and restart behavior can be tested.

With Docker running:

```sh
pnpm --filter @shrubbery/sophia-koreader build
apps/sophia-koreader/emulator/launch.sh
```

The second command opens `http://127.0.0.1:6080/vnc.html` in the default
browser. To launch a live-Gardend artifact instead of the fixture:

```sh
SOPHIA_KOREADER_FEED_DIR=/tmp/sophia-koreader/feed \
  apps/sophia-koreader/emulator/launch.sh
```

To exercise **Sync Garden**, serve that same directory on port 8787 as shown
above. The emulator preconfigures the plugin to read
`http://host.docker.internal:8787/manifest.json`; override `SOPHIA_FEED_URL`
when the feed is elsewhere. The browser UI and VNC port bind only to
`127.0.0.1` by default.

## Install in KOReader

Copy the generated `sophia.koplugin` directory into a KOReader `plugins/`
directory and restart KOReader. The final path must end in:

```text
plugins/sophia.koplugin/main.lua
```

Sophia opens as the startup surface with persistent **Home** and **Browse**
roots. Browse renders Garden folders/pages and opens an on-device Garden
workspace picker; local file paths are cache implementation details and never
appear in this flow. From an ordinary KOReader manuscript it is
also available at:

```text
More tools → Sophia → Open Sophia
```

Enter the full manifest URL, for example:

```text
http://192.168.1.20:8787/manifest.json
```

Choose **Settings** on the Sophia home and enter the manifest URL, then choose
**Sync Garden**. The plugin downloads documents when their Garden revision,
stable filename or Shrubbery projection version changes, caches semantic JSON
sidecars, activates a new manifest only after every referenced file is present,
and opens local XHTML through KOReader's normal reader path.

## Current capabilities

Implemented:

- Garden hosted-envelope metadata normalization and canonical TipTap XML
  projection.
- Stable document and block identities.
- Headings, paragraphs, grouped lists, todos, quotes, code and dividers.
- Deterministic inline-mark projection, including Garden wiki links.
- XHTML escaping and conservative URL handling.
- Static or live-Garden feed builds.
- Loopback manifest discovery and token-file authentication without secrets in
  process arguments.
- HTTP and HTTPS synchronization.
- Offline document and semantic-model cache.
- Native full-screen Sophia home with bookplate, resume action, manuscript
  shelf, sync and settings.
- Persistent native Home/Browse bar with clear active-root cues.
- Garden-native folder traversal, paging and honest empty-folder states.
- On-device workspace picker backed by the Garden graph catalogue and
  graph-scoped offline caches.
- Sophia-derived monochrome manuscript typography and empty-page states.
- Native KOReader fallback menu, library index and document opening.
- Stable Library/position/Previous/Next manuscript navigation, with KOReader's
  local-document confirmation at cross-file transitions.
- Revision- and projection-version-based incremental synchronization.

Deliberately deferred:

- Garden write-back for progress, bookmarks, highlights and notes.
- Image-asset mirroring, custom font packaging and full TipTap tree fidelity.
- Nested-list reconstruction from parent relationships.
- Pairing/device grants instead of a manually entered bearer token.
- Background or scheduled synchronization.
- Search and graph-derived related-reading views.

See `docs/design/koreader-output-mode.md` for the architectural boundary and
next slices. `docs/design/koreader-navigation-notes.md` records the navigation
doctrine carried over from Garden's mobile shell.
