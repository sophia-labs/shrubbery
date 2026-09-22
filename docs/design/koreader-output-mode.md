# Shrubbery KOReader output mode — implemented foundation

**Status:** integrated; live Gardend and official KOReader emulator validated
2026-07-31
**Target:** Linux e-ink devices running KOReader, including a personal custom
reader and jailbroken Kindle development hardware
**Packages:** `@shrubbery/koreader`, `@shrubbery/sophia-koreader`

## 1. Decision

KOReader is modeled as a **packaged Shrubbery output target**, not as a fifth
member of `@shrubbery/render`'s content-negotiated `RenderTarget` union.

The existing four faces have a strong invariant:

```text
one Resource + one RenderTarget
    → one serialized body
    → one content type
    → one alternate-link set
```

A KOReader application has a different cardinality and lifecycle:

```text
one ReaderLibrary
    → one versioned manifest
    → one library index
    → N semantic XHTML documents
    → N semantic JSON sidecars
    → one stateful native Lua host
```

Pretending this is another MIME face would weaken the existing face contract,
make content negotiation lie about what a response contains, and couple a
pure renderer to installation and synchronization concerns. The draft instead
adds a sibling pure package and an app shell.

## 2. Placement in Shrubbery

```text
packages/koreader
  Pure, DOM-free, network-free artifact renderer.

apps/sophia-koreader
  Source and deployment shell:
  - discovers a local Gardend through its loopback manifest or reads a
    graph-scoped gateway root;
  - reads Garden document metadata plus canonical TipTap XML, the older
    hosted-block projection, or a static ReaderLibrary;
  - writes/serves the artifact;
  - carries the native KOReader plugin source.
```

This preserves Shrubbery's central backend rule. The pure package only accepts
ordinary data. HTTP, bearer credentials, filesystems and KOReader APIs live in
an app shell.

The package intentionally does not broaden `TripleSource`. `TripleSource`
speaks RDF universals and named graphs. Garden document envelopes are a
separate projection contract. The first implementation uses `ReaderLibrary` as
the data boundary and keeps the Garden adapter structural. A formal
`ReaderSource` interface should be hoisted only when a second real source needs
the same lifecycle methods.

## 3. End-to-end flow

```text
Garden Y.Doc authority
    ↓ materialization
Garden document index + envelope metadata + canonical TipTap XML export
    ↓ app-side Garden adapter
ReaderLibrary
    ↓ @shrubbery/koreader
KoreaderArtifact
    ├── manifest.json
    ├── index.xhtml
    ├── documents/{stable-id}.xhtml
    └── models/{stable-id}.json
    ↓ HTTP(S)
Sophia KOReader plugin
    ↓ Garden revision + projection-version comparison; atomic cache updates
local XHTML
    ↓ KOReader filemanagerutil.openFile
Cool Reader Engine / KOReader reader UI
```

The e-reader never hosts Yjs, Oxigraph, TipTap or a Garden cell merely to read.
It consumes cold projection data. Garden remains responsible for translating
any later reader-state writes into its authoritative mutation path.

## 4. Reader model

The target uses a deliberately closed, small model:

```text
ReaderLibrary
  id, graphId, title
  documents[]

ReaderDocument
  id, graphId, title, revision
  timestamps, snippet, parentId, readOnly
  blocks[]

ReaderBlock
  stable id
  heading | paragraph | bullet | numbered | todo | quote | code |
  divider | image | math
  text, order, parentId, level, checked, language
  marks[]

ReaderMark
  UTF-16 start/end offsets
  type
  optional URL or target document ID
```

The Garden adapter uses the hosted-shaped envelope for identity, revision and
other metadata. In canonical XML mode it replaces the envelope's flattened
blocks with the document's `/export?format=xml` fragment. The XML parser
preserves stable block IDs, heading and list levels, todo state and supported
inline mark offsets. It accepts fragments by adding an inert synthetic root and
refuses malformed XML, doctypes, processing instructions and inputs over 8 MiB.
The older hosted-block mode remains available for deployments without the
export route. Unknown block types degrade to paragraphs rather than inventing
target-specific semantics. Malformed required fields and invalid mark ranges
are refused.

## 5. XHTML doctrine

XHTML is the native handoff format because KOReader already knows how to open
and paginate it through its reflowable document engine. The target therefore
does not implement page layout.

The XHTML renderer provides:

- stable `id` and `data-sophia-*` attributes for every block;
- document, graph and revision metadata;
- semantic heading/list/code/quote elements;
- grouped adjacent lists;
- deterministic handling of overlapping marks;
- local wiki links between stable cached filenames;
- stable Library/position/Previous/Next navigation across the sorted
  manuscript shelf;
- a Sophia-derived monochrome manuscript system: editorial serif hierarchy,
  utility labels, quiet rules, bookplate rhythm and intentional empty states;
- no JavaScript;
- escaped text and attributes;
- rejection of executable or traversal-style local URLs.

A JSON sidecar containing the exact normalized `ReaderDocument` is emitted
beside every XHTML document. The first plugin does not yet interpret the
sidecar, but synchronizing it now establishes the future annotation and
re-anchoring boundary without changing the feed protocol later.

## 6. Manifest protocol

Schema:

```text
urn:sophia:shrubbery:koreader:manifest:v0.1
```

Version `1` contains:

- a separately bumped projection version for cache-invalidating renderer
  migrations;
- library identity and `index.xhtml` path;
- generation timestamp;
- explicit capability posture;
- document ID, title and revision;
- remote XHTML and model paths;
- stable local XHTML and model filenames;
- optional snippet and update timestamp.

The plugin validates the closed path grammar before any write. It downloads
changed/missing documents and sidecars to `.part` files, renames each into
place, refreshes the index, and writes the new manifest last. A failed sync can
leave harmless unreferenced new files, but it cannot activate a catalogue that
points at absent content.

## 7. Native KOReader application boundary

The plugin owns a focused Sophia application surface while leaving document
rendering to KOReader:

- `_meta.lua` declares the plugin;
- `main.lua` owns startup, resume state, menu/dispatcher actions and sync;
- `sophia_home.lua` composes the full-screen native e-ink home;
- `resources/sophia-sprout.svg` carries the botanical bookplate mark;
- `sophia_client.lua` owns HTTP/HTTPS reads and timeouts;
- `sophia_store.lua` owns KOReader data-directory paths and atomic files.

It uses KOReader's own abstractions for:

- plugin discovery and per-plugin Lua module paths;
- settings storage;
- network activation;
- e-ink-native messages and input dialogs;
- full-screen widgets, focus and touch handling;
- opening XHTML in the current Reader or FileManager context.

It does **not** draw pages itself. Once a file is opened, KOReader owns the
reading experience, including typography, dictionaries, selection,
highlights, bookmarks and last position. KOReader also owns its standard
confirmation before following a cross-file link to another cached manuscript.

## 8. Identity and position

Stable local filenames are derived from Garden document IDs, not titles. Block
anchors are derived from Garden block IDs. This gives the first two pieces of a
future round-trip position:

```json
{
  "documentId": "doc-a",
  "documentRevision": 42,
  "blockId": "block-f83a",
  "start": 17,
  "end": 61,
  "quote": "selected text",
  "prefix": "context before",
  "suffix": "context after"
}
```

The redundant quote/context selector is necessary because a KOReader xpointer
and a Garden block offset can both become stale after edits. Progress can ship
with a looser block-plus-offset mapping. Highlight write-back should wait for a
real spike against KOReader's current sidecar/xpointer representation.

## 9. Security posture

The current reader foundation is appropriate for personal development, not a
public token flow.

Implemented controls:

- read-only GET/HEAD feed server;
- path traversal fences in the server and artifact writer;
- strict manifest path grammar on the device;
- no active content in generated XHTML;
- HTTP and HTTPS support;
- bearer token never emitted into the feed.
- local credentials are read from Gardend's per-run loopback manifest;
- non-loopback credentials can be read from a token file and never need to
  appear in process arguments;
- destructive artifact replacement refuses filesystem roots, source-tree
  ancestors and repository paths outside the app's `dist/` directory.

Known debt:

- the plugin stores its optional bearer token in KOReader's ordinary Lua
  settings file;
- no device pairing, scoped grant issuance or revocation UI exists yet;
- remote image mirroring is not implemented.

The next authentication slice should use a short pairing code and a narrow,
revocable Viewer grant held by the reader service, plus an encrypted-at-rest
device secret where the Linux platform permits.

## 10. Acceptance gates for this slice

The draft is acceptable when:

1. strict TypeScript compilation passes for both package and app;
2. package tests cover Garden normalization, stable paths, escaping, marks,
   URL refusal and artifact cardinality;
3. every generated `.xhtml` parses as XML;
4. every Lua source parses successfully;
5. manifest references resolve to generated files;
6. the sample plugin directory has the exact `.koplugin` shape KOReader loads;
7. a local feed can be served and fetched over the documented route;
8. a real Gardend loopback document projection renders into a complete feed;
9. no existing Shrubbery `RenderTarget` or face behavior changes;
10. the pinned official KOReader Linux release loads the plugin and native home;
11. live sync, offline cache, home-to-document opening, resume state and the
    document-to-home fallback route work in the visible emulator;
12. a multi-document canonical TipTap XML corpus visibly preserves headings,
    lists, quotes, inline marks and stable semantic sidecars in KOReader.

## 11. Next slices

### Slice 2 — live reader service

Replace build-time Garden reads with a small authenticated service that renders
manifest and document resources on demand, supports ETags and exposes one
reader-specific Viewer grant. Keep the static artifact path as an offline and
test fixture.

### Slice 3 — assets and full document fidelity

Extend the canonical XML projection with information not yet carried into the
closed reader model: footnotes, richer math, annotations and exact nested
structure. Mirror image assets into the artifact rather than depending on
remote URLs, and package an e-ink-appropriate fallback font for ornamental
Unicode and emoji.

### Slice 4 — reader state

Add a separate `ReaderStateService` and offline operation queue for progress,
bookmarks, notes and highlights. Garden must translate these operations through
its authoritative mutation services; the plugin must never update projection
RDF directly.

### Slice 5 — deeper Sophia-native surfaces

Extend the implemented Sophia home with graph and memory projections: related
reading, saved SPARQL trails, agent-generated packets and “ask Sophia about this
passage” actions, while leaving ordinary document reading inside KOReader.
